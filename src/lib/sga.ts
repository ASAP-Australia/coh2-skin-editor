/**
 * SGA v7 archive reader (CoH2 era).
 *
 * Layout (header 12 + 140 bytes, then TOC):
 *   8   "_ARCHIVE"
 *   2   major (7)
 *   2   minor (0)
 * 128   archive name (UTF-16-LE, padded with NULs)
 *   4   header_size  (TOC bytes following the header)
 *   4   data_pos     (absolute offset where compressed file payloads begin)
 *   4   reserved (must be 1)
 *
 * After the 152-byte header lives the TOC header (32 bytes):
 *   4   drive_pos        offset of drive-def array, relative to header_pos
 *   4   drive_count
 *   4   folder_pos
 *   4   folder_count
 *   4   file_pos
 *   4   file_count
 *   4   name_pos         offset of names section
 *   4   name_count       number of strings (NUL-terminated, concatenated)
 *
 * Then drive defs (148 bytes each: 64s alias, 64s name, 5×u32 ranges),
 * folder defs (20 bytes each: name_pos, folder_first, folder_last, file_first, file_last),
 * file defs (30 bytes each: namePos, dataPos, storeLength (compressed), length (uncompressed),
 *            mod_time, verification, storage, crc, hash_pos — see FileDef interface),
 * names (concatenated NUL-terminated).
 *
 * File payloads at `data_pos + fileDef.dataPos` are zlib-deflated when
 * storage ∈ {1,2}, raw when storage == 0.
 *
 * Verified against several CoH2 SGAs (workshop skin packs, ArtArmies,
 * ArtHigh) by our Python implementation.
 */

import { inflateRaw, inflate } from 'pako'

export interface SgaFile {
  /** Full path inside the archive, slash-separated. */
  path: string
  /** Lazy reader: invoke to actually decompress + return the bytes. */
  read: () => Promise<Uint8Array>
  /** Uncompressed size in bytes. */
  length: number
}

interface FileDef {
  namePos: number
  dataPos: number
  length: number
  storeLength: number
  storage: number
}
interface FolderDef {
  namePos: number
  folderFirst: number
  folderLast: number
  fileFirst: number
  fileLast: number
}

export class SgaArchive {
  readonly archiveName: string
  private readonly file: File
  private readonly dataPos: number
  private readonly folders: FolderDef[]
  private readonly files: FileDef[]
  private readonly nameAtOffset: Map<number, string>

  private constructor(
    archiveName: string,
    file: File,
    dataPos: number,
    folders: FolderDef[],
    files: FileDef[],
    nameAtOffset: Map<number, string>,
  ) {
    this.archiveName = archiveName
    this.file = file
    this.dataPos = dataPos
    this.folders = folders
    this.files = files
    this.nameAtOffset = nameAtOffset
  }

  /** Open + parse the SGA's TOC. The data block stays on disk; file payloads
   *  are read lazily as the caller asks for specific paths. */
  static async open(file: File): Promise<SgaArchive> {
    // Header: 12 + 128 + 12 = 152 bytes
    const headerBytes = new Uint8Array(await file.slice(0, 152).arrayBuffer())
    if (
      String.fromCharCode(...headerBytes.subarray(0, 8)) !== '_ARCHIVE'
    ) throw new Error('Not an SGA file (bad magic)')
    const view = new DataView(headerBytes.buffer)
    const major = view.getUint16(8, true)
    if (major !== 7) throw new Error(`SGA v${major} not supported (only v7)`)

    const archiveName = decodeUtf16Le(headerBytes.subarray(12, 12 + 128))

    const headerSize = view.getUint32(140, true)
    const dataPos = view.getUint32(144, true)
    const rsv = view.getUint32(148, true)
    if (rsv !== 1) throw new Error(`SGA reserved field expected 1, got ${rsv}`)

    const headerPos = 152  // TOC follows header
    // Read [headerPos, headerPos + headerSize) into memory — this is the TOC
    const tocBytes = new Uint8Array(
      await file.slice(headerPos, headerPos + headerSize).arrayBuffer(),
    )
    const toc = new DataView(tocBytes.buffer)

    const drivePos = toc.getUint32(0, true)
    const driveCount = toc.getUint32(4, true)
    const folderPos = toc.getUint32(8, true)
    const folderCount = toc.getUint32(12, true)
    const filePos = toc.getUint32(16, true)
    const fileCount = toc.getUint32(20, true)
    const namePos = toc.getUint32(24, true)
    const nameCount = toc.getUint32(28, true)

    // Drives — 148 bytes each. Not currently consulted (we use the file
    // table directly), but parsed for spec adherence + future cross-drive
    // lookups (some SGAs split data across drives like attrib/locale/data).
    void drivePos; void driveCount

    // Folders — 20 bytes each
    const folders: FolderDef[] = []
    for (let i = 0; i < folderCount; i++) {
      const o = folderPos + i * 20
      folders.push({
        namePos: toc.getUint32(o, true),
        folderFirst: toc.getUint32(o + 4, true),
        folderLast: toc.getUint32(o + 8, true),
        fileFirst: toc.getUint32(o + 12, true),
        fileLast: toc.getUint32(o + 16, true),
      })
    }

    // Files — 30 bytes each
    const files: FileDef[] = []
    for (let i = 0; i < fileCount; i++) {
      const o = filePos + i * 30
      files.push({
        namePos: toc.getUint32(o, true),
        dataPos: toc.getUint32(o + 4, true),
        storeLength: toc.getUint32(o + 8, true),  // compressed on-disk size
        length: toc.getUint32(o + 12, true),       // uncompressed size
        // 4 bytes mod_time (skipped at offset +16)
        // 1 byte verification at +20, 1 byte storage at +21
        storage: tocBytes[o + 21],
        // 4 bytes crc at +22, 4 bytes hash_pos at +26 — not needed
      })
    }

    // Names — read sequentially until we've collected `nameCount` strings.
    const nameAtOffset = new Map<number, string>()
    {
      let cur = namePos
      let collected = 0
      const td = new TextDecoder('utf-8', { fatal: false })
      while (cur < tocBytes.length && collected < nameCount) {
        let endIx = cur
        while (endIx < tocBytes.length && tocBytes[endIx] !== 0) endIx++
        const rel = cur - namePos
        nameAtOffset.set(rel, td.decode(tocBytes.subarray(cur, endIx)))
        cur = endIx + 1
        collected++
      }
    }

    void headerPos
    return new SgaArchive(archiveName, file, dataPos, folders, files, nameAtOffset)
  }

  /** Return all files in the archive, with lazy readers. */
  list(): SgaFile[] {
    const out: SgaFile[] = []
    for (let i = 0; i < this.files.length; i++) {
      const f = this.files[i]
      const fname = this.nameAtOffset.get(f.namePos) ?? `<file_${i}>`
      // Find owning folder to build the path
      const folderName = this.folderForFile(i)
      const path = (folderName ? folderName + '/' : '') + fname
      const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '')
      out.push({
        path: cleanPath,
        length: f.length,
        read: () => this.readFile(f),
      })
    }
    return out
  }

  /** Read a single file by full path. Returns null if not found. */
  async readByPath(path: string): Promise<Uint8Array | null> {
    const target = path.replace(/\\/g, '/').replace(/^\/+/, '')
    for (let i = 0; i < this.files.length; i++) {
      const f = this.files[i]
      const fname = this.nameAtOffset.get(f.namePos) ?? ''
      const folderName = this.folderForFile(i)
      const full = (folderName ? folderName + '/' : '') + fname
      if (full.replace(/\\/g, '/') === target) return this.readFile(f)
    }
    return null
  }

  private folderForFile(fileIndex: number): string {
    // SGA folders form a hierarchy; root/drive folders cover the whole file
    // range and child folders cover subranges. We want the SMALLEST range
    // (= most specific = leaf folder), not the first match. Picking the
    // first match returns the root drive folder, so paths come back as
    // just "tiger.rgm" instead of "art/armies/german/vehicles/tiger/tiger.rgm".
    let bestRange = Infinity
    let bestName = ''
    for (const fld of this.folders) {
      if (fld.fileFirst <= fileIndex && fileIndex < fld.fileLast) {
        const range = fld.fileLast - fld.fileFirst
        if (range < bestRange) {
          bestRange = range
          bestName = this.nameAtOffset.get(fld.namePos) ?? ''
        }
      }
    }
    return bestName
  }

  private async readFile(f: FileDef): Promise<Uint8Array> {
    const start = this.dataPos + f.dataPos
    const end = start + f.storeLength
    const raw = new Uint8Array(await this.file.slice(start, end).arrayBuffer())
    if (f.storage === 0) return raw
    if (f.storage === 1 || f.storage === 2) {
      // Relic uses zlib (deflate with header) — pako.inflate handles either
      try {
        return inflate(raw)
      } catch {
        return inflateRaw(raw)
      }
    }
    throw new Error(`Unknown storage type ${f.storage}`)
  }
}

function decodeUtf16Le(bytes: Uint8Array): string {
  // Find first NUL pair; UTF-16 strings are NUL-terminated for purposes of display
  let end = bytes.length
  for (let i = 0; i < bytes.length; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) { end = i; break }
  }
  return new TextDecoder('utf-16le', { fatal: false }).decode(bytes.subarray(0, end))
}
