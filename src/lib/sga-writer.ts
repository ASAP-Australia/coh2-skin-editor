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
 *                4   length         (uncompressed)
 *                4   store_length   (compressed)
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

  // ----- Sort files by path so directory grouping is contiguous -----
  const files = [...input].sort((a, b) => a.path.localeCompare(b.path))

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

  // ----- Build the names section + a path→offset map -----
  // We emit one entry per unique folder (grouped) + the basename of every file.
  const uniqueFolders: string[] = []
  {
    const seen = new Set<string>()
    for (const p of prepared) {
      if (!seen.has(p.folder)) { seen.add(p.folder); uniqueFolders.push(p.folder) }
    }
    uniqueFolders.sort()
  }
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

  // ----- Lay out the TOC with the correct offsets -----
  // toc layout: [tocHeader=32][drive_def×1=148][folder_defs][file_defs][names]
  const tocHeaderSize = 32
  const driveDefsSize = 148
  const folderDefsSize = folderRecords.length * 20
  const fileDefsSize = fileRecords.length * 30
  const namesSize = namesBytes.length
  const headerSize = tocHeaderSize + driveDefsSize + folderDefsSize + fileDefsSize + namesSize

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

  // TOC header
  tocView.setUint32( 0, drivePos, true)
  tocView.setUint32( 4, 1, true)              // 1 drive
  tocView.setUint32( 8, folderPos, true)
  tocView.setUint32(12, folderRecords.length, true)
  tocView.setUint32(16, filePos, true)
  tocView.setUint32(20, fileRecords.length, true)
  tocView.setUint32(24, namePos, true)
  tocView.setUint32(28, fileRecords.length + folderRecords.length, true)  // "name count" (entries)

  // Drive record (148 bytes)
  // alias "data", name "data" — matches every Workshop pack we sampled
  const aliasBytes = enc.encode('data')
  tocBytes.set(aliasBytes, drivePos)
  tocBytes.set(aliasBytes, drivePos + 64)
  tocView.setUint32(drivePos + 128, 0, true)                     // folder_first
  tocView.setUint32(drivePos + 132, folderRecords.length, true)  // folder_last
  tocView.setUint32(drivePos + 136, 0, true)                     // file_first
  tocView.setUint32(drivePos + 140, fileRecords.length, true)    // file_last
  tocView.setUint32(drivePos + 144, 0, true)                     // root_folder

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
    tocView.setUint32(o + 8,  f.length, true)
    tocView.setUint32(o + 12, f.storeLength, true)
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
