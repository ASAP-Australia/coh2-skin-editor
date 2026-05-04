/**
 * build-manifest.ts — parse signed template SGAs and emit public/keys/manifest.json.
 *
 * Run AFTER Workshop publication: copy signed SGAs from Steam subscription dir
 * into tools/templates/signed/, then:
 *
 *   npx tsx tools/build-manifest.ts [--signed tools/templates/signed] [--out public/keys]
 *
 * For each signed SGA, the tool:
 *   1. Reads the SGA file header to find data_pos (absolute offset of data block).
 *   2. Walks the TOC file records to locate every .rgt entry.
 *   3. Computes the absolute byte offset of each RGT in the file (data_pos + file.dataPos).
 *   4. Emits manifest.json: a list of key entries with per-file { offset, length } maps.
 *
 * manifest.json is consumed by src/lib/mod-export.ts at export time:
 *   - fetch the SGA file
 *   - overwrite RGT bytes at the recorded offset
 *   - write patched SGA to mods/skins/
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const SIGNED_DIR = arg('--signed', path.join(process.cwd(), 'tools/templates/signed'))
const OUT_DIR = arg('--out', path.join(process.cwd(), 'public/keys'))

// ---------------------------------------------------------------------------
// SGA v7 parser (TOC only)
// ---------------------------------------------------------------------------
interface SgaFileEntry {
  path: string      // full slash-separated path inside the archive
  offset: number    // absolute byte offset in the SGA file (data_pos + file.dataPos)
  length: number    // uncompressed length
  storeLength: number // on-disk (possibly compressed) length
  storage: number   // 0=raw, 2=zlib
}

function parseSga(buf: Buffer): { guid: string; files: SgaFileEntry[] } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const dec = new TextDecoder('utf-8')
  const dec16 = new TextDecoder('utf-16le')

  // ---- File header (152 bytes) — matches sga-writer.ts exactly ----
  //   0   8  "_ARCHIVE"
  //   8   2  major version (u16 LE) = 7
  //  10   2  minor version (u16 LE) = 0
  //  12 128  archive name (UTF-16-LE, 64 chars, NUL-padded)
  // 140   4  header_size  (u32 LE) — TOC byte count
  // 144   4  data_pos_abs (u32 LE) — absolute offset of data block
  // 148   4  reserved = 1
  const magic = dec.decode(buf.slice(0, 8))
  if (magic !== '_ARCHIVE') throw new Error('Not an SGA file')

  // Archive name: 128-byte UTF-16-LE field at offset 12 (64 wide chars)
  const nameRaw = buf.slice(12, 140)
  let nameEnd = 128
  for (let i = 0; i < 128; i += 2) {
    if (nameRaw[i] === 0 && nameRaw[i + 1] === 0) { nameEnd = i; break }
  }
  const guid = dec16.decode(nameRaw.slice(0, nameEnd)).toLowerCase().replace(/-/g, '')

  // data_pos at offset 144
  const dataPos = dv.getUint32(144, true)

  // TOC starts at 152; TOC header is 40 bytes
  const TOC_BASE = 152
  const drivePos   = dv.getUint32(TOC_BASE +  0, true)
  const driveCount = dv.getUint32(TOC_BASE +  4, true)
  const folderPos  = dv.getUint32(TOC_BASE +  8, true)
  const filePos    = dv.getUint32(TOC_BASE + 16, true)
  const fileCount  = dv.getUint32(TOC_BASE + 20, true)
  const namePos    = dv.getUint32(TOC_BASE + 24, true)

  // All TOC section offsets are relative to TOC_BASE
  const FILE_RECORD_SIZE = 30
  const files: SgaFileEntry[] = []

  // Read names section lazily — given namePos offset, read NUL-terminated string
  const readName = (relOffset: number): string => {
    const base = TOC_BASE + namePos + relOffset
    let end = base
    while (end < buf.length && buf[end] !== 0) end++
    return dec.decode(buf.slice(base, end))
  }

  // Build folder path map: folderIndex → full path string
  const FOLDER_RECORD_SIZE = 20
  const folderPaths: string[] = []
  {
    const folderBase = TOC_BASE + folderPos
    // folder count — need to derive from file records or drive records
    // Just build it lazily from file record folderIndex pointers.
    // We'll read folder name_pos entries up front.
    // Since we don't have the count directly, use driveCount drives:
    // each drive has folder_first..folder_last range.
    const DRIVE_RECORD_SIZE = 148
    let maxFolderIdx = 0
    for (let d = 0; d < driveCount; d++) {
      const dBase = TOC_BASE + drivePos + d * DRIVE_RECORD_SIZE
      const fl = dv.getUint32(dBase + 128 + 4, true) // folder_last
      if (fl > maxFolderIdx) maxFolderIdx = fl
    }
    for (let fi = 0; fi < maxFolderIdx; fi++) {
      const fBase = folderBase + fi * FOLDER_RECORD_SIZE
      const np = dv.getUint32(fBase, true)
      folderPaths.push(readName(np))
    }
  }

  // Read file records
  const fileBase = TOC_BASE + filePos
  for (let i = 0; i < fileCount; i++) {
    const fBase = fileBase + i * FILE_RECORD_SIZE
    const nameOff  = dv.getUint32(fBase +  0, true)
    const fileDPos = dv.getUint32(fBase +  4, true)   // relative to data block
    const storeLen = dv.getUint32(fBase +  8, true)
    const rawLen   = dv.getUint32(fBase + 12, true)
    // modified_seconds at +16, verification at +20, storage at +21, crc32 at +22
    const storage  = buf[fBase + 21]
    // hash_pos at +26

    const basename = readName(nameOff)

    // Find which folder owns this file by scanning folderPaths
    // (file records themselves don't directly store folder index in SGA v7 —
    //  the folder record stores file_first..file_last ranges instead)
    // We'll resolve folder paths after building the folder→file map.
    files.push({
      path: basename,   // placeholder; resolved below
      offset: dataPos + fileDPos,
      length: rawLen,
      storeLength: storeLen,
      storage,
    })
  }

  // Resolve full paths: walk folder records and assign folder path to files
  {
    const folderBase = TOC_BASE + folderPos
    const FOLDER_RECORD_SIZE = 20
    for (let fi = 0; fi < folderPaths.length; fi++) {
      const fBase = folderBase + fi * FOLDER_RECORD_SIZE
      const fileFirst = dv.getUint32(fBase + 12, true)
      const fileLast  = dv.getUint32(fBase + 16, true)
      const folderPath = folderPaths[fi]
      for (let j = fileFirst; j < fileLast && j < files.length; j++) {
        const baseName = files[j].path
        files[j].path = folderPath ? `${folderPath}/${baseName}` : baseName
      }
    }
  }

  return { guid, files }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = () => {
  if (!fs.existsSync(SIGNED_DIR)) {
    console.error(`Signed templates directory not found: ${SIGNED_DIR}`)
    console.error('Run build-template.ts first, publish to Workshop, then copy signed SGAs here.')
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const sgaFiles = fs.readdirSync(SIGNED_DIR)
    .filter(f => f.endsWith('.sga'))
    .sort()

  if (sgaFiles.length === 0) {
    console.error(`No .sga files found in ${SIGNED_DIR}`)
    process.exit(1)
  }

  console.log(`Parsing ${sgaFiles.length} signed SGA(s)…\n`)

  const keys: Array<{
    id: string
    guid: string
    file: string
    rgtFiles: Record<string, { offset: number; length: number; storeLength: number; storage: number }>
  }> = []

  for (const sgaName of sgaFiles) {
    const sgaPath = path.join(SIGNED_DIR, sgaName)
    const buf = fs.readFileSync(sgaPath)
    console.log(`  ${sgaName}  (${(buf.length / 1024 / 1024).toFixed(2)} MB)`)

    let parsed: ReturnType<typeof parseSga>
    try {
      parsed = parseSga(buf)
    } catch (e) {
      console.error(`    ERROR: ${(e as Error).message}`)
      continue
    }

    const rgtFiles: Record<string, { offset: number; length: number; storeLength: number; storage: number }> = {}
    let rgtCount = 0
    for (const f of parsed.files) {
      if (f.path.endsWith('.rgt')) {
        rgtFiles[f.path] = { offset: f.offset, length: f.length, storeLength: f.storeLength, storage: f.storage }
        rgtCount++
      }
    }

    const id = sgaName.replace(/\.sga$/, '')
    keys.push({ id, guid: parsed.guid, file: sgaName, rgtFiles })
    console.log(`    guid=${parsed.guid}  rgt files=${rgtCount}  total files=${parsed.files.length}`)
  }

  const manifest = {
    generated: new Date().toISOString(),
    version: 1,
    keys,
  }

  const outPath = path.join(OUT_DIR, 'manifest.json')
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2))
  console.log(`\n✓ manifest.json → ${outPath}  (${keys.length} key(s))`)
  console.log('\nNext step: copy the signed SGAs into public/keys/, then run the app.')
}

main()
