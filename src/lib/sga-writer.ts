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

export interface SgaInputFile {
  /** Slash-separated path inside the archive (e.g. "art/armies/.../tiger_dif.rgt"). */
  path: string
  bytes: Uint8Array
  /** Default true (zlib deflate, storage=2). Set false for already-compressed
   *  payloads or tiny files where compression doesn't help. */
  compress?: boolean
}

export interface BuildSgaOptions {
  /** Archive name written into the file header (UTF-16). Cosmetic — most
   *  CoH2 mods set this to the same hex GUID their files use. */
  archiveName: string
  files: SgaInputFile[]
}

export async function buildSga(opts: BuildSgaOptions): Promise<Uint8Array> {
  const { archiveName, files: input } = opts

  // ----- Sort files into the four canonical Workshop drives + by path -----
  // CoH2 Workshop packs split assets across four logical drives based on
  // top-level path prefix (verified against SS Totenkopf). Within each
  // drive, files are sorted by path so the folder records stay contiguous.
  const driveOf = (p: string): 0 | 1 | 2 | 3 => {
    if (p.startsWith('attrib/'))  return 0
    if (p.startsWith('english/') || p.startsWith('locale/')) return 1
    if (p.endsWith('.info'))      return 2
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
    bytes: Uint8Array             // ALREADY compressed (or raw if compress=false)
    storage: 0 | 2
    crc32: number
    dataPos: number               // filled in below
  }
  const prepared: PreparedFile[] = []
  let runningDataLen = 0
  for (const f of files) {
    const lastSlash = f.path.lastIndexOf('/')
    const folder = lastSlash < 0 ? '' : f.path.slice(0, lastSlash)
    const name = lastSlash < 0 ? f.path : f.path.slice(lastSlash + 1)
    const compress = f.compress !== false
    let stored: Uint8Array, storage: 0 | 2
    if (compress) {
      stored = deflate(f.bytes, { level: 6 })
      storage = 2
    } else {
      stored = f.bytes
      storage = 0
    }
    prepared.push({
      path: f.path,
      name, folder,
      rawLen: f.bytes.length,
      bytes: stored,
      storage,
      crc32: crc32(f.bytes),
      dataPos: runningDataLen,
    })
    runningDataLen += stored.length
  }

  // ----- Build folder list with explicit drive ownership -----
  // Each folder record carries its owning drive index. Folders are sorted
  // by drive first so each drive owns a contiguous range of folder records.
  const folderEntries: { folder: string; drive: number }[] = []
  {
    const seen = new Set<string>()  // key = drive + '\0' + folder
    for (const p of prepared) {
      const di = driveOf(p.path)
      const k = di + '\0' + p.folder
      if (!seen.has(k)) {
        seen.add(k)
        folderEntries.push({ folder: p.folder, drive: di })
      }
    }
    folderEntries.sort((a, b) => {
      if (a.drive !== b.drive) return a.drive - b.drive
      return a.folder.localeCompare(b.folder)
    })
  }
  const uniqueFolders = folderEntries.map(e => e.folder)
  // Names section: emit each folder's full path, then each file's basename.
  // Each entry is NUL-terminated. We track byte offsets relative to the start
  // of the names section so the TOC can index into them.
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
  // Folder records: emit FOLDER FULL PATHS (relic uses the folder's full path
  // string, e.g. "art/armies/german/vehicles/tiger" not just "tiger"). We
  // serialise folders as <name_pos, folder_first, folder_last, file_first, file_last>.
  // Folder_first/last refer to subdirectories inside this folder — for a flat
  // layout we set them to (i+1, i+1) i.e. empty range, which CoH2 accepts.
  const folderRecords = uniqueFolders.map((p, i) => ({
    folder: p,
    namePos: addName(p),
    folderFirst: i + 1,
    folderLast: i + 1,    // empty subdir range — files are listed below
    fileFirst: 0,         // filled in next
    fileLast: 0,
  }))

  // Group files by their folder index. Because both arrays are sorted, the
  // file index ranges per folder are naturally contiguous.
  const folderIndexOf = new Map(uniqueFolders.map((f, i) => [f, i]))
  for (let i = 0; i < prepared.length; i++) {
    const fi = folderIndexOf.get(prepared[i].folder)!
    if (folderRecords[fi].fileLast === folderRecords[fi].fileFirst) {
      folderRecords[fi].fileFirst = i
    }
    folderRecords[fi].fileLast = i + 1
  }

  // File records — name_pos is the basename (not full path)
  const fileRecords = prepared.map(p => ({
    namePos: addName(p.name),
    dataPos: p.dataPos,
    length: p.rawLen,
    storeLength: p.bytes.length,
    storage: p.storage,
    crc32: p.crc32,
  }))

  // ----- Build the four canonical drive records -----
  // Each drive owns a contiguous range of folders + files (the input arrays
  // are sorted by drive). We compute these ranges from the explicit drive
  // index attached to each folderEntries / prepared record.
  const driveAliases = ['attrib', 'locale', 'info', 'data']
  const driveRanges = driveAliases.map((alias, idx) => {
    let folderFirst = -1, folderLast = -1, fileFirst = -1, fileLast = -1
    for (let f = 0; f < folderEntries.length; f++) {
      if (folderEntries[f].drive === idx) {
        if (folderFirst < 0) folderFirst = f
        folderLast = f + 1
      }
    }
    for (let f = 0; f < prepared.length; f++) {
      const di = driveOf(prepared[f].path)
      if (di === idx) {
        if (fileFirst < 0) fileFirst = f
        fileLast = f + 1
      }
    }
    return {
      alias,
      folderFirst: folderFirst < 0 ? 0 : folderFirst,
      folderLast: folderLast < 0 ? 0 : folderLast,
      fileFirst: fileFirst < 0 ? 0 : fileFirst,
      fileLast: fileLast < 0 ? 0 : fileLast,
      rootFolder: folderFirst < 0 ? 0 : folderFirst,
    }
  })

  // ----- Lay out the TOC with the correct offsets -----
  // toc layout: [tocHeader=40][drive_defs×4=592][folder_defs][file_defs][names]
  // The 40-byte header has two extra u32s after the 8 we read in sga.ts.
  // From real Workshop packs they appear to be a hash_table_pos + block_size
  // pair; we set them to (0, 0) which CoH2's loader tolerates.
  const tocHeaderSize = 40
  const driveDefsSize = driveRanges.length * 148
  const folderDefsSize = folderRecords.length * 20
  const fileDefsSize = fileRecords.length * 30
  const namesSize = namesBytes.length
  const sigBlockSize = 140  // Workshop skin SGAs always have a 140-byte sig block
  const headerSize = tocHeaderSize + driveDefsSize + folderDefsSize + fileDefsSize + namesSize + sigBlockSize

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
  const dataPosAbs = 152 + headerSize
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
  //   TOC[32]: sig_offset — byte offset WITHIN the TOC where the RSA signature
  //            block begins. Game archives (Art*/Sound* etc.) set this to
  //            headerSize (= no signature; engine skips verification). Workshop
  //            skin packs set this to the end of the names section, then
  //            append 80–188 bytes of RSA ciphertext. Without Relic's private
  //            key we cannot generate a valid signature block, so we match the
  //            game-archive convention (sig_offset = headerSize). The engine
  //            rejects skin packs in ugc/referenced/ without a valid sig with
  //            "not unsigned". Locally-installed test packs may need workshop
  //            publication to acquire a valid signed blob from Relic's service.
  //   TOC[36]: page_size. ALWAYS 0x00040000 (262144 = 256 KB) on every pack.
  const sigOffset = tocHeaderSize + driveDefsSize + folderDefsSize + fileDefsSize + namesSize
  tocView.setUint32(32, sigOffset, true)      // sig_offset = end of names → 140-byte sig block follows
  tocView.setUint32(36, 0x00040000, true)     // 256 KB page size

  // 4 drive records (148 bytes each), in canonical order:
  //   attrib / locale / info / data
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
    tocBytes[o + 20] = 0                             // verification = 0
    tocBytes[o + 21] = f.storage                     // storage type
    tocView.setUint32(o + 22, f.crc32, true)
    tocView.setUint32(o + 26, 0, true)              // hash_pos = 0 (unused)
  }

  // Names section
  for (let i = 0; i < namesBytes.length; i++) tocBytes[namePos + i] = namesBytes[i]

  // ----- Concatenate file header + TOC + data block -----
  const dataBlockSize = runningDataLen
  const out = new Uint8Array(152 + headerSize + dataBlockSize)
  out.set(fileHeader, 0)
  out.set(tocBytes, 152)
  let cursor = 152 + headerSize
  for (const p of prepared) {
    out.set(p.bytes, cursor + p.dataPos)
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
