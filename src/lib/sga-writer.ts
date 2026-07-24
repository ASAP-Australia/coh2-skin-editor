/**
 * SGA v7 writer — pure JS, browser-safe.
 *
 * Inverse of `sga.ts`. Takes a flat list of files (path + raw bytes) and
 * produces a single Uint8Array containing a complete CoH2-compatible SGA
 * archive that the game's loader treats identically to a Workshop pack.
 *
 * Layout (matches what we read in `sga.ts`):
 *
 *   152 bytes: file header
 *      8   "_ARCHIVE"
 *      4   version (uint16 major=7, uint16 minor=0)
 *    256   archive name (UTF-16-LE, NUL-padded)
 *      4   header_size = TOC byte count
 *      4   data_pos    = absolute file offset where the data block begins
 *      4   reserved = 1
 *
 *   TOC (header_size bytes):
 *      32  toc header (drive_pos/count, folder_pos/count, file_pos/count,
 *                      name_pos/count — offsets are relative to header start)
 *     drives  148 bytes each:
 *               64   alias            (e.g. "data")
 *               64   name             (same)
 *                4   folder_first
 *                4   folder_last
 *                4   file_first
 *                4   file_last
 *                4   root_folder
 *     folders  20 bytes each:
 *                4   name_pos       (rel to start of names section)
 *                4   folder_first
 *                4   folder_last
 *                4   file_first
 *                4   file_last
 *     files    30 bytes each:
 *                4   name_pos
 *                4   data_pos       (rel to data_pos in file header)
 *                4   store_length   (compressed on-disk size)
 *                4   length         (uncompressed size)
 *                4   modified_seconds
 *                1   verification
 *                1   storage   (0 raw, 1/2 zlib-deflated)
 *                4   crc32
 *                4   hash_pos
 *     names    NUL-terminated UTF-8 strings, packed
 *
 *   Data block: zlib-compressed (or raw) file payloads, in file order.
 *
 * Key constraints we respect for in-game compatibility:
 *   - Folder records cover the parent of every file with a contiguous
 *     [file_first, file_last) range. We achieve this by sorting files by
 *     their path and grouping by directory.
 *   - The directory tree is flat: we emit one folder per unique parent
 *     directory and one root drive ("data"). This is what every Workshop
 *     pack we sampled does — CoH2 doesn't care about deep folder nesting
 *     in the TOC, only the file paths.
 */

import { deflate } from 'pako'
import { sha1 } from './sha1'

/** Per-file verification scheme for SGA v7.
 *
 *  Reverse-engineered byte-for-byte from the ModBuilder-burned win-condition
 *  reference (`asap_verify.burned.sga`, GUID ae9c499b…) and the working
 *  subscribed gamemode `1660217730.sga` (2026-07-19). The engine's lobby scanner
 *  REQUIRES these per-file verification hashes for win-condition (`.win`/`.scar`)
 *  files — an archive that mounts + boots but writes `verification=none` for
 *  everything is dropped from the Win-Condition dropdown even after the Gen4/5/6
 *  drive-layout / entity_replacements / CRLF fixes.
 *
 *  Values (the literal bytes written into file-record offset +20):
 *   - `'none'`        → 0. No hash. `hash_pos=0`. Skin/decal/faceplate default —
 *                       these load fine unsigned and MUST stay byte-unchanged.
 *   - `'crc_blocks'`  → 1. NO separate hash block. The file record's `crc32`
 *                       field (offset +22) = CRC32 over the STORED (compressed)
 *                       bytes IS the verification. `hash_pos=0`. Used by the
 *                       `info` TOC (`.info`, `.dds`, `.tga`).
 *   - `'sha1_blocks'` → 4. SHA-1 (20 bytes) over the STORED (compressed) bytes,
 *                       one hash per `blockSize` (262144) block, appended to a
 *                       contiguous hash table that begins at TOC `sig_offset`.
 *                       The record's `hash_pos` (offset +26) = this file's byte
 *                       offset within that table (0, 20, 40, …). The `crc32`
 *                       field is ALSO set to crc(stored). Used by the `data` TOC
 *                       (`.win`, `.scar`).
 *
 *  NOTE: the reference always sets the `crc32` field to crc over STORED bytes for
 *  files that carry verification. For `'none'` files we keep the legacy crc-over-
 *  RAW to preserve byte-identical skin/decal/faceplate output. */
export type SgaVerification = 'none' | 'crc_blocks' | 'sha1_blocks'

/** SGA v7 block size for per-block verification hashes. 262144 = 256 KB —
 *  the `blocksize` in every ModBuilder `ArchiveDefinition.txt` and the
 *  `page_size` (0x00040000) in every CoH2 SGA TOC header. */
const SGA_BLOCK_SIZE = 262144

export interface SgaInputFile {
  /** Slash-separated path inside the archive (e.g. "art/armies/.../tiger_dif.rgt"). */
  path: string
  bytes: Uint8Array
  /** Default true (zlib deflate, storage=2). Set false for already-compressed
   *  payloads or tiny files where compression doesn't help. */
  compress?: boolean
  /** Explicit storage-type. Overrides `compress` when set:
   *   - `'stream'` → storage=1 (zlib STREAM_COMPRESS). REQUIRED for CoH2 files
   *     the engine string-indexes at load time (`.ucs` locale entries, and —
   *     verified 2026-07-19 — win-condition `.win` files: every working gamemode
   *     mod stores `.win` with storage=1; storage=2 makes the engine silently
   *     drop the entry from the lobby Win-Condition dropdown, exactly like the
   *     `.ucs` storage=2 "No Key" locale-index failure documented in sga.ts).
   *   - `'buffer'` → storage=2 (zlib BUFFER_COMPRESS), identical to `compress: true`.
   *   - `'raw'`    → storage=0 (uncompressed), identical to `compress: false`. */
  storage?: 'stream' | 'buffer' | 'raw'
  /** Per-file verification scheme (TOC file-record offset +20 + optional hash
   *  block). Accepts the named scheme (`'none'`/`'crc_blocks'`/`'sha1_blocks'`)
   *  or the raw numeric byte for backward compatibility (0/1/4).
   *
   *  CoH2 gamemode mods REQUIRE this to list in the lobby: `.win`/`.scar` use
   *  `'sha1_blocks'` (4), `.info` uses `'crc_blocks'` (1). Defaults to `'none'`
   *  (0) — what skin/decal/faceplate packs use; keep it so their output stays
   *  byte-identical. See {@link SgaVerification}. */
  verification?: SgaVerification | number
}

/** Normalize a {@link SgaInputFile.verification} value (named or raw numeric)
 *  to the canonical scheme. Unknown numeric values fall back to `'none'` unless
 *  they are a recognized hash byte. */
function normalizeVerification(v: SgaVerification | number | undefined): SgaVerification {
  if (v === undefined) return 'none'
  if (v === 'none' || v === 'crc_blocks' || v === 'sha1_blocks') return v
  if (v === 4) return 'sha1_blocks'
  if (v === 1) return 'crc_blocks'
  return 'none'
}

/** The literal `verification` byte written at file-record offset +20. */
const VERIFICATION_BYTE: Record<SgaVerification, number> = {
  none: 0,
  crc_blocks: 1,
  sha1_blocks: 4,
}

export interface BuildSgaOptions {
  /** Archive name written into the file header (UTF-16). Cosmetic — most
   *  CoH2 mods set this to the same hex GUID their files use. */
  archiveName: string
  files: SgaInputFile[]
  /** Drive layout for the TOC.
   *
   *  - `'skin'` (DEFAULT) — the 4 canonical drives `attrib`/`locale`/`info`/
   *    `data`, in that order, always emitted even when empty. This is the layout
   *    every real skin / decal / faceplate pack uses; keep it for those paths.
   *
   *  - `'gamemode'` — exactly 2 drives `data`(0) then `info`(1), NO attrib/locale.
   *    This is the layout ALL FIVE working subscribed win-condition mods use
   *    (`353675196` / `333857863` / `481822725` / `606599092` / `1660217730`);
   *    verified by byte-level TOC dump 2026-07-19. `.win`/`.scar` sit on the
   *    `data` drive; the root `<GUID>.info` + `preview.tga` on the `info` drive.
   *
   *  ROOT CAUSE (2026-07-19, Gen4): CoH2's win-condition scanner only registers a
   *  mod into the lobby dropdown when the archive's PRIMARY drive is `data`
   *  (drive index 0, root folder 0). With the extra leading `attrib`+`locale`
   *  drives, `data` is pushed to index 3 and the `.win` entries are never
   *  string-indexed into the dropdown — the mod loads + boots but is silently
   *  UNLISTED. Gen3 (4 drives + `.win` storage=1) proved storage alone is NOT
   *  enough; the drive layout is the decisive field.
   *
   *  BOOT-SAFETY: the 2-drive layout is boot-safe *only in `data`-first order*.
   *  A 2026-07-19 `dropEmptyDrives` attempt (Gen2) emitted the remaining drives in
   *  canonical INDEX order → `info`(0)+`data`(1), which shifted the TOC index
   *  bases the engine walks and crashed at boot (`'<GUID>.info' is corrupt!`,
   *  archive.cpp/130). This layout emits `data` FIRST, `info` SECOND — matching
   *  the 5 working mods that all boot cleanly. */
  driveLayout?: 'skin' | 'gamemode'
}

export async function buildSga(opts: BuildSgaOptions): Promise<Uint8Array> {
  const { archiveName, files: input } = opts
  const layout = opts.driveLayout ?? 'skin'

  // ----- Per-layout drive configuration -----
  // `driveAliases` is indexed by the LOCAL drive index that `driveOf` returns;
  // the emit order is exactly this array order (index 0 first). `activeDrives`
  // is just [0..n-1] over that array.
  //
  //   'skin'     — 4 canonical drives attrib(0)/locale(1)/info(2)/data(3).
  //   'gamemode' — 2 drives data(0)/info(1). MUST stay data-first (boot-safety);
  //                see the BuildSgaOptions.driveLayout doc for the full rationale.
  const driveAliases = layout === 'gamemode'
    ? ['data', 'info']
    : ['attrib', 'locale', 'info', 'data']

  // Map a file path to its LOCAL drive index within `driveAliases`.
  // Both layouts route root-level files (no '/') to the `info` drive and
  // sub-pathed files to the `data` drive; the 'skin' layout additionally
  // splits attrib/ and locale/english prefixes into their own leading drives.
  const driveOf = (p: string): number => {
    if (layout === 'gamemode') {
      // data(0): game\..., scar\...  |  info(1): root-level <GUID>.info + preview.tga
      return p.includes('/') ? 0 : 1
    }
    if (p.startsWith('attrib/'))  return 0
    if (p.startsWith('english/') || p.startsWith('locale/')) return 1
    if (!p.includes('/'))         return 2  // root-level files (e.g. <guid>.info, <slug>.dds) → info drive
    return 3
  }
  const files = [...input].sort((a, b) => {
    const da = driveOf(a.path), db = driveOf(b.path)
    if (da !== db) return da - db
    return a.path.localeCompare(b.path)
  })

  // ----- Compress every payload up front so we know data_pos / lengths -----
  type PreparedFile = {
    path: string
    name: string                  // basename
    folder: string                // dir
    rawLen: number
    bytes: Uint8Array             // ALREADY compressed (or raw if storage=0)
    storage: 0 | 1 | 2
    verification: SgaVerification
    crc32: number
    /** For `'sha1_blocks'`: the per-256KB-block SHA-1 hashes concatenated
     *  (20 bytes each) over the STORED bytes. Empty otherwise. */
    sha1Blocks: Uint8Array
    /** Byte offset of this file's hashes within the drive/TOC hash table.
     *  Filled in below when the hash table is laid out. */
    hashPos: number
    dataPos: number               // filled in below
  }
  const prepared: PreparedFile[] = []
  let runningDataLen = 0
  for (const f of files) {
    const lastSlash = f.path.lastIndexOf('/')
    const folder = lastSlash < 0 ? '' : f.path.slice(0, lastSlash)
    const name = lastSlash < 0 ? f.path : f.path.slice(lastSlash + 1)
    // Resolve the storage type. Explicit `storage` wins; otherwise fall back to
    // the legacy `compress` boolean (true → storage=2, false → storage=0).
    // storage=1 and storage=2 are both zlib-deflated on disk — they differ only
    // in the TOC storage byte the engine uses to pick its decode/index path.
    let storage: 0 | 1 | 2
    if (f.storage === 'stream') storage = 1
    else if (f.storage === 'buffer') storage = 2
    else if (f.storage === 'raw') storage = 0
    else storage = f.compress === false ? 0 : 2
    const stored = storage === 0 ? f.bytes : deflate(f.bytes, { level: 6 })
    const verification = normalizeVerification(f.verification)

    // CRC + SHA-1 discipline, byte-matched to the ModBuilder reference:
    //   - verified files ('crc_blocks'/'sha1_blocks'): crc32 over the STORED
    //     (compressed) bytes — this is what the reference always writes.
    //   - 'none' files (skins/decals/faceplates): keep the legacy crc-over-RAW
    //     so their output stays byte-identical (they load fine in-game as-is).
    const crc32Field = verification === 'none' ? crc32(f.bytes) : crc32(stored)

    // sha1_blocks: one SHA-1 (20 bytes) per 262144-byte block of the STORED
    // data, concatenated. Small files → a single block → a single 20-byte hash.
    let sha1Blocks = new Uint8Array(0)
    if (verification === 'sha1_blocks') {
      const nBlocks = Math.max(1, Math.ceil(stored.length / SGA_BLOCK_SIZE))
      sha1Blocks = new Uint8Array(nBlocks * 20)
      for (let b = 0; b < nBlocks; b++) {
        const blk = stored.subarray(b * SGA_BLOCK_SIZE, (b + 1) * SGA_BLOCK_SIZE)
        sha1Blocks.set(sha1(blk), b * 20)
      }
    }

    prepared.push({
      path: f.path,
      name, folder,
      rawLen: f.bytes.length,
      bytes: stored,
      storage,
      verification,
      crc32: crc32Field,
      sha1Blocks,
      hashPos: 0,
      dataPos: runningDataLen,
    })
    runningDataLen += stored.length
  }

  // ----- Lay out the sha1_blocks hash table -----
  // The ModBuilder reference stores all `sha1_blocks` hashes in ONE contiguous
  // table that begins at TOC `sig_offset` (end of the names section). Each file's
  // `hash_pos` is its byte offset within that table (0, 20, 40, …). `crc_blocks`
  // and `none` files carry NO table bytes and keep `hash_pos = 0`. Files are
  // walked in `prepared` (drive, path)-sorted order, exactly as they are emitted.
  const hashTableChunks: Uint8Array[] = []
  let hashTableLen = 0
  for (const p of prepared) {
    if (p.verification === 'sha1_blocks' && p.sha1Blocks.length > 0) {
      p.hashPos = hashTableLen
      hashTableChunks.push(p.sha1Blocks)
      hashTableLen += p.sha1Blocks.length
    } else {
      p.hashPos = 0
    }
  }
  const hashTable = new Uint8Array(hashTableLen)
  {
    let o = 0
    for (const c of hashTableChunks) { hashTable.set(c, o); o += c.length }
  }

  // ----- Names section helper -----
  // NUL-terminated UTF-8 strings, packed. Offsets are relative to the start of
  // the names section so the TOC can index into them. Folder name strings are
  // emitted first (in folder order), then file basenames.
  const nameToOffset = new Map<string, number>()
  const namesBytes: number[] = []
  const enc = new TextEncoder()
  const addName = (s: string): number => {
    if (nameToOffset.has(s)) return nameToOffset.get(s)!
    const off = namesBytes.length
    nameToOffset.set(s, off)
    for (const b of enc.encode(s)) namesBytes.push(b)
    namesBytes.push(0)
    return off
  }

  // ----- Build a proper folder TREE per drive -----
  //
  // CoH2's loader requires the COMPLETE folder hierarchy with WINDOWS BACKSLASH
  // separators — not the flat, forward-slash, leaf-only layout we used before
  // (which the engine rejects with "invalid file structure / <name> not
  // permitted"). Each drive must contain:
  //   - an empty-string root folder ("")
  //   - every intermediate ancestor folder ("ui", "ui\\assets", …)
  //   - the leaf folders that directly hold files ("ui\\assets\\textures")
  // Folder name strings use backslashes ("attrib\\faceplate"). Folders are
  // ordered by an "allocate all of a node's children contiguously, THEN
  // DFS-recurse into each child" traversal, which yields the contiguous
  // sub-folder index ranges the engine walks. This was reverse-engineered
  // byte-for-byte from real Steam-subscribed reference packs (HK416V2 +
  // clarkson faceplates, HeinzBeanz decal) — see /tmp/sga-dump2.mjs.
  type FolderNode = {
    path: string                 // forward-slash internal key ("" = drive root)
    name: string                 // backslash display name ("" for root)
    drive: number
    children: FolderNode[]
    index: number
    subStart: number
    subEnd: number
    fileFirst: number
    fileLast: number
  }

  // Emit every drive in `driveAliases`, in array order (index 0 first). For
  // 'skin' this is the 4 canonical drives attrib/locale/info/data; for
  // 'gamemode' it is data/info (data first — required for lobby listing AND
  // boot-safety; see BuildSgaOptions.driveLayout). `driveAliases` is defined
  // near the top of buildSga alongside `driveOf`.
  const activeDrives = driveAliases.map((_, i) => i)
  const driveTrees = new Map<number, FolderNode>()
  for (const di of activeDrives) {
    const root: FolderNode = {
      path: '', name: '', drive: di, children: [],
      index: -1, subStart: 0, subEnd: 0, fileFirst: 0, fileLast: 0,
    }
    const byPath = new Map<string, FolderNode>([['', root]])
    const ensure = (fwdPath: string): FolderNode => {
      const existing = byPath.get(fwdPath)
      if (existing) return existing
      const slash = fwdPath.lastIndexOf('/')
      const parent = ensure(slash < 0 ? '' : fwdPath.slice(0, slash))
      const node: FolderNode = {
        path: fwdPath,
        name: fwdPath.replace(/\//g, '\\'),
        drive: di, children: [],
        index: -1, subStart: 0, subEnd: 0, fileFirst: 0, fileLast: 0,
      }
      byPath.set(fwdPath, node)
      parent.children.push(node)
      return node
    }
    // Gather this drive's leaf folders (every file's parent dir) and create the
    // full ancestor chain for each. Sort leaves so the tree is deterministic.
    const leafPaths = new Set<string>()
    for (const p of prepared) {
      if (driveOf(p.path) === di) leafPaths.add(p.folder)
    }
    for (const lp of [...leafPaths].sort()) if (lp !== '') ensure(lp)
    // Children of every node sorted by path (matches reference ordering).
    for (const node of byPath.values()) {
      node.children.sort((a, b) => a.path.localeCompare(b.path))
    }
    driveTrees.set(di, root)
  }

  // Allocate global folder indices: per drive, root first, then the
  // "children-block-then-recurse" traversal. Records sub-folder ranges.
  const folderNodesInOrder: FolderNode[] = []
  let folderCounter = 0
  const driveFolderRanges = new Map<number, { first: number; last: number; root: number }>()
  for (const di of activeDrives) {
    const root = driveTrees.get(di)!
    const driveFirst = folderCounter
    root.index = folderCounter++
    folderNodesInOrder.push(root)
    const allocate = (node: FolderNode) => {
      node.subStart = folderCounter
      for (const c of node.children) {
        c.index = folderCounter++
        folderNodesInOrder.push(c)
      }
      node.subEnd = folderCounter
      for (const c of node.children) allocate(c)
    }
    allocate(root)
    driveFolderRanges.set(di, { first: driveFirst, last: folderCounter, root: driveFirst })
  }

  // Assign per-folder file ranges + per-drive file ranges. Files (`prepared`)
  // are sorted by (drive, path), so each folder's files are contiguous and each
  // drive occupies a contiguous file window. Empty folders (roots/intermediates
  // with no direct files) get [driveFileStart, driveFileStart) — matching the
  // reference packs exactly.
  const driveFileRanges = new Map<number, { first: number; last: number }>()
  let fileCursor = 0
  for (const di of activeDrives) {
    const driveFileStart = fileCursor
    for (const node of folderNodesInOrder) {
      if (node.drive !== di) continue
      let first = -1, last = -1
      for (let i = 0; i < prepared.length; i++) {
        if (driveOf(prepared[i].path) === di && prepared[i].folder === node.path) {
          if (first < 0) first = i
          last = i + 1
        }
      }
      if (first < 0) {
        // Empty folder (root/intermediate with no DIRECT files). The engine's
        // folder-tree walk anchors such a folder's [fileFirst, fileLast) EMPTY
        // range at the index of the FIRST file anywhere in its SUBTREE (itself
        // or any descendant folder), NOT at the drive's first file. Verified
        // byte-for-byte across every working win-condition mod + the ModBuilder
        // burn: the intermediate `scar` folder is stamped file[N..N] where N is
        // where `scar\winconditions`'s files begin (burn N=1, 333857863 N=10,
        // 353675196 N=18, 606599092 N=20), NOT file[0..0]. The Gen10 build's
        // wrong file[0..0] anchor (from the old driveFileStart fallback) put the
        // `scar` folder's empty range at the `.win` (index 0) instead of the
        // `.scar` (index 1), corrupting the scanner's walk of the scar subtree so
        // the win-condition `.scar` was never enumerated → the mode MOUNTED
        // clean [Sig:0] but was DROPPED from the lobby Win-Condition dropdown.
        // Anchor at the subtree's first file: the smallest file index whose path
        // lives under this folder's prefix (folder.path + '/'), or driveFileStart
        // when the subtree is genuinely file-less.
        const prefix = node.path === '' ? '' : node.path + '/'
        let subFirst = -1
        for (let i = 0; i < prepared.length; i++) {
          if (driveOf(prepared[i].path) !== di) continue
          const p = prepared[i].path
          if (prefix === '' ? true : p.startsWith(prefix)) { subFirst = i; break }
        }
        const anchor = subFirst < 0 ? driveFileStart : subFirst
        node.fileFirst = anchor
        node.fileLast = anchor
      }
      else { node.fileFirst = first; node.fileLast = last }
    }
    let count = 0
    for (const p of prepared) if (driveOf(p.path) === di) count++
    driveFileRanges.set(di, { first: driveFileStart, last: driveFileStart + count })
    fileCursor += count
  }

  // Folder records, in allocation order. name_pos = backslash folder path.
  const folderRecords = folderNodesInOrder.map(node => ({
    namePos: addName(node.name),
    folderFirst: node.subStart,
    folderLast: node.subEnd,
    fileFirst: node.fileFirst,
    fileLast: node.fileLast,
  }))

  // File records — name_pos is the basename (not full path)
  const fileRecords = prepared.map(p => ({
    namePos: addName(p.name),
    dataPos: p.dataPos,
    length: p.rawLen,
    storeLength: p.bytes.length,
    storage: p.storage,
    verification: VERIFICATION_BYTE[p.verification],
    crc32: p.crc32,
    hashPos: p.hashPos,
  }))

  // ----- Drive records (per `driveAliases`; 'skin'=attrib/locale/info/data,
  // 'gamemode'=data/info) -----
  const driveRanges = activeDrives.map(di => ({
    alias: driveAliases[di],
    folderFirst: driveFolderRanges.get(di)!.first,
    folderLast: driveFolderRanges.get(di)!.last,
    fileFirst: driveFileRanges.get(di)!.first,
    fileLast: driveFileRanges.get(di)!.last,
    rootFolder: driveFolderRanges.get(di)!.root,
  }))

  // ----- Lay out the TOC with the correct offsets -----
  // toc layout: [tocHeader=40][drive_defs×N][folder_defs][file_defs][names][hashTable]
  // The 40-byte header's last two u32s are sig_offset + page_size (see below).
  //
  // The `sha1_blocks` HASH TABLE sits at `sig_offset` (end of the names section),
  // exactly where a Workshop skin pack's 140-byte RSA sig block would go. For a
  // gamemode mod the hash table replaces that sig block: byte-for-byte the same
  // slot the ModBuilder reference uses. For a skin/decal/faceplate pack (all
  // files `verification='none'`) the table is empty, so we keep a 140-byte
  // zero-filled block there to preserve byte-identical legacy output.
  const tocHeaderSize = 40
  const driveDefsSize = driveRanges.length * 148
  const folderDefsSize = folderRecords.length * 20
  const fileDefsSize = fileRecords.length * 30
  const namesSize = namesBytes.length
  // When any file carries sha1_blocks the trailing region is the real hash table;
  // otherwise fall back to the legacy 140-byte zero sig block (unchanged skins).
  const trailingSize = hashTableLen > 0 ? hashTableLen : 140
  const headerSize = tocHeaderSize + driveDefsSize + folderDefsSize + fileDefsSize + namesSize + trailingSize

  // Offsets are RELATIVE TO HEADER START (which the reader takes as 0
  // when iterating). header_pos in the reader is `152` (file header size),
  // and TOC offsets are relative to that.
  const drivePos    = tocHeaderSize
  const folderPos   = drivePos + driveDefsSize
  const filePos     = folderPos + folderDefsSize
  const namePos     = filePos + fileDefsSize

  // ----- File header (152 bytes) -----
  const fileHeader = new Uint8Array(152)
  const fhView = new DataView(fileHeader.buffer)
  fileHeader.set([0x5f,0x41,0x52,0x43,0x48,0x49,0x56,0x45], 0)  // "_ARCHIVE"
  fhView.setUint16(8, 7, true)            // major
  fhView.setUint16(10, 0, true)           // minor
  // archive name UTF-16-LE, 128 bytes (64 chars). Matches the reader.
  const nameUtf16 = new Uint8Array(128)
  const nameStr = archiveName.slice(0, 63)
  for (let i = 0; i < nameStr.length; i++) {
    nameUtf16[i * 2] = nameStr.charCodeAt(i) & 0xff
    nameUtf16[i * 2 + 1] = (nameStr.charCodeAt(i) >> 8) & 0xff
  }
  fileHeader.set(nameUtf16, 12)
  fhView.setUint32(140, headerSize, true)
  const dataPosAbs = 152 + headerSize + 256  // standard 256-byte gap between TOC end and data block
  fhView.setUint32(144, dataPosAbs, true)
  fhView.setUint32(148, 1, true)          // reserved must be 1

  // ----- TOC bytes -----
  const tocBytes = new Uint8Array(headerSize)
  const tocView = new DataView(tocBytes.buffer)

  // TOC header (40 bytes)
  tocView.setUint32( 0, drivePos, true)
  tocView.setUint32( 4, driveRanges.length, true)
  tocView.setUint32( 8, folderPos, true)
  tocView.setUint32(12, folderRecords.length, true)
  tocView.setUint32(16, filePos, true)
  tocView.setUint32(20, fileRecords.length, true)
  tocView.setUint32(24, namePos, true)
  tocView.setUint32(28, fileRecords.length + folderRecords.length, true)
  // Final two u32s of the 40-byte TOC header:
  //
  //   TOC[32]: sig_offset — byte offset WITHIN the TOC (= end of the names
  //            section) where the trailing block begins. This slot is polymorphic:
  //            * gamemode packs with sha1_blocks files: it is the START of the
  //              per-file SHA-1 hash TABLE (each file's `hash_pos` indexes into
  //              it). Byte-for-byte the layout the ModBuilder-burned reference and
  //              working subscribed win-condition mods use.
  //            * skin/decal/faceplate packs (all files 'none'): a 140-byte
  //              zero-filled block, matching the legacy unsigned skin layout that
  //              loads in-game as `[Sig:0]`.
  //            (Relic-signed Workshop packs put 80–188 bytes of RSA ciphertext
  //            here instead — a separate, uncracked signing step; verification
  //            hashes are NOT the RSA signature.)
  //   TOC[36]: page_size. ALWAYS 0x00040000 (262144 = 256 KB) on every pack;
  //            equals the per-block size of the sha1_blocks/crc_blocks hashes.
  const sigOffset = tocHeaderSize + driveDefsSize + folderDefsSize + fileDefsSize + namesSize
  tocView.setUint32(32, sigOffset, true)      // sig_offset = end of names → hash table / sig block follows
  tocView.setUint32(36, 0x00040000, true)     // 256 KB page size

  // Drive records (148 bytes each), in `driveAliases` order:
  //   'skin' → attrib / locale / info / data ; 'gamemode' → data / info
  for (let i = 0; i < driveRanges.length; i++) {
    const o = drivePos + i * 148
    const dr = driveRanges[i]
    const aliasBytes = enc.encode(dr.alias)
    tocBytes.set(aliasBytes, o)
    tocBytes.set(aliasBytes, o + 64)
    tocView.setUint32(o + 128, dr.folderFirst, true)
    tocView.setUint32(o + 132, dr.folderLast, true)
    tocView.setUint32(o + 136, dr.fileFirst, true)
    tocView.setUint32(o + 140, dr.fileLast, true)
    tocView.setUint32(o + 144, dr.rootFolder, true)
  }

  // Folder records
  for (let i = 0; i < folderRecords.length; i++) {
    const o = folderPos + i * 20
    const f = folderRecords[i]
    tocView.setUint32(o,      f.namePos, true)
    tocView.setUint32(o + 4,  f.folderFirst, true)
    tocView.setUint32(o + 8,  f.folderLast, true)
    tocView.setUint32(o + 12, f.fileFirst, true)
    tocView.setUint32(o + 16, f.fileLast, true)
  }

  // File records
  for (let i = 0; i < fileRecords.length; i++) {
    const o = filePos + i * 30
    const f = fileRecords[i]
    tocView.setUint32(o,      f.namePos, true)
    tocView.setUint32(o + 4,  f.dataPos, true)
    tocView.setUint32(o + 8,  f.storeLength, true)   // compressed on-disk size
    tocView.setUint32(o + 12, f.length, true)         // uncompressed size
    tocView.setUint32(o + 16, 0, true)              // modified_seconds = 0
    tocBytes[o + 20] = f.verification & 0xff         // verification byte
    tocBytes[o + 21] = f.storage                     // storage type
    tocView.setUint32(o + 22, f.crc32, true)
    tocView.setUint32(o + 26, f.hashPos, true)      // hash_pos = offset into hash table
  }

  // Names section
  for (let i = 0; i < namesBytes.length; i++) tocBytes[namePos + i] = namesBytes[i]

  // sha1_blocks hash table — written immediately after the names section, at
  // `sig_offset`. Empty for all-'none' packs (legacy 140-byte zero block stays).
  if (hashTableLen > 0) {
    tocBytes.set(hashTable, sigOffset)
  }

  // ----- Concatenate file header + TOC + 256-byte gap + data block -----
  const dataBlockSize = runningDataLen
  const out = new Uint8Array(dataPosAbs + dataBlockSize)
  out.set(fileHeader, 0)
  out.set(tocBytes, 152)
  // The 256-byte gap (bytes 152+headerSize .. dataPosAbs-1) stays zero-filled.
  for (const p of prepared) {
    out.set(p.bytes, dataPosAbs + p.dataPos)
  }
  return out
}


// ----- CRC-32 (IEEE 802.3, used by zlib) ---------------------------------
// Reference values match the Python zlib.crc32 we used for verification.
let crcTable: Uint32Array | null = null
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      crcTable[i] = c
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}
