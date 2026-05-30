/**
 * Headless signed-template patcher.
 *
 * Reads the pre-signed template SGA, iterates all 94 RGT slots from the
 * manifest, composes a vanilla diffuse for each vehicle/season, generates a
 * fixed-size RGT (compress:false), and overwrites the slot payload in the
 * template buffer.  The RSA signature is preserved because the TOC/header
 * bytes are never touched.
 *
 * Usage:
 *   npx tsx tools/patch-signed-pack.mts
 *
 * Output: out/verification/signed/<numericId>.sga
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'

// ---------------------------------------------------------------------------
// Node shims (same pattern as test-export.ts and generate-all-artifacts.ts)
// ---------------------------------------------------------------------------
;(global as any).ImageData = NodeImageData as any
;(global as any).HTMLCanvasElement = class {} as any
;(global as any).Image = Image as any
;(global as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return createCanvas(1, 1) as unknown as HTMLCanvasElement
    if (tag === 'a') return { click() {}, href: '', download: '' }
    throw new Error(`document.createElement(${tag}) not supported in Node shim`)
  },
}
;(global as any).URL = URL

// ---------------------------------------------------------------------------
// Library imports (after shims)
// ---------------------------------------------------------------------------
import { SgaArchive } from '../src/lib/sga.js'
import { decodeRgt } from '../src/lib/rgt.js'
import { bcToCanvas } from '../src/lib/bc-decode.js'
import { encodeBc3 } from '../src/lib/bc-encode.js'
import { VEHICLES } from '../src/lib/vehicles.js'
import {
  freshPackId,
  vehicleFolder,
  textureBaseNamesFor,
  factionSgaCandidates,
} from '../src/lib/mod-export.js'

// ---------------------------------------------------------------------------
// Minimal BC3 RGT builder (compress:false, BC3/DXT5 = format 15)
// The template was built with BC3 RGTs (~4 MB each for 2048²). The current
// canvasToRgt() uses BC1 (format 13) which produces ~2 MB — wrong size for
// slot-patching. We build the RGT directly here using the same Chunky tree
// structure that canvasToRgt uses, but with encodeBc3 and format code 15.
// ---------------------------------------------------------------------------

function concatChunks(parts: Uint8Array[]): Uint8Array {
  let total = 0; for (const p of parts) total += p.length
  const out = new Uint8Array(total); let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// ---------------------------------------------------------------------------
// Chunky v3 helpers — mirrors rgt-writer.ts exactly, but uses BC3 (format 15)
// ---------------------------------------------------------------------------
function _enc(s: string) { return new TextEncoder().encode(s) }

// Chunk header: kind(4)+fcc(4)+ver(4)+paylen(4)+namelen(4)+unknownA(4)+unknownB(4)+name(N)
// Names are null-terminated when non-empty (matching rgt-writer.ts).
function rgtChunkHeader(kind: 'DATA' | 'FOLD', fcc: string, version: number, name: string, payloadLen: number): Uint8Array {
  const nameBytes = name ? _enc(name + '\0') : new Uint8Array(0)
  const out = new Uint8Array(28 + nameBytes.length)
  const v = new DataView(out.buffer)
  out.set(_enc(kind), 0)
  out.set(_enc((fcc + '    ').slice(0, 4)), 4)
  v.setUint32(8, version, true)
  v.setUint32(12, payloadLen, true)
  v.setUint32(16, nameBytes.length, true)
  v.setUint32(20, 0xffffffff, true)
  v.setUint32(24, 0, true)
  if (nameBytes.length) out.set(nameBytes, 28)
  return out
}
function rgtDataChunk(fcc: string, version: number, name: string, payload: Uint8Array): Uint8Array {
  const head = rgtChunkHeader('DATA', fcc, version, name, payload.length)
  const out = new Uint8Array(head.length + payload.length)
  out.set(head); out.set(payload, head.length); return out
}
function rgtFoldChunk(fcc: string, version: number, name: string, children: Uint8Array): Uint8Array {
  const head = rgtChunkHeader('FOLD', fcc, version, name, children.length)
  const out = new Uint8Array(head.length + children.length)
  out.set(head); out.set(children, head.length); return out
}

/** Build a BC3/DXT5 RGT with compress:false.
 *  Mirrors rgt-writer.ts canvasToRgt but uses encodeBc3 + format code 15.
 *  Produces the same byte length as the template's signed slots (~4 MB for 2048²). */
function canvasToRgtBc3(canvas: ReturnType<typeof createCanvas>, internalName: string): Uint8Array {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const dxt = encodeBc3(img.data, width, height)

  const mipCount = Math.floor(Math.log2(Math.max(width, height))) + 1
  const mips: { unc: number; cmp: Uint8Array }[] = []
  for (let i = 0; i < mipCount - 1; i++) mips.push({ unc: 0, cmp: new Uint8Array(0) })
  mips.push({ unc: dxt.length, cmp: dxt })

  // TFMT: format 15 = BC3 linear (DXT5)
  const tfmt = new Uint8Array(25)
  const tfmtView = new DataView(tfmt.buffer)
  tfmtView.setUint32(0, width, true)
  tfmtView.setUint32(4, height, true)
  tfmtView.setUint32(8, 1, true)
  tfmtView.setUint32(12, 2, true)
  tfmtView.setUint32(16, 15, true)   // BC3 (DXT5)
  tfmtView.setUint32(20, 0, true)
  tfmt[24] = 1

  const tman = new Uint8Array(4 + 8 * mipCount)
  const tmanView = new DataView(tman.buffer)
  tmanView.setUint32(0, mipCount, true)
  for (let i = 0; i < mipCount; i++) {
    tmanView.setUint32(4 + i * 8, mips[i]!.unc, true)
    tmanView.setUint32(4 + i * 8 + 4, mips[i]!.cmp.length, true)
  }

  let tdatSize = 0; for (const m of mips) tdatSize += m.cmp.length
  const tdat = new Uint8Array(tdatSize)
  { let o = 0; for (const m of mips) { tdat.set(m.cmp, o); o += m.cmp.length } }

  const dxtcChildren = concatChunks([
    rgtDataChunk('TFMT', 1, '', tfmt),
    rgtDataChunk('TMAN', 1, '', tman),
    rgtDataChunk('TDAT', 1, '', tdat),
  ])
  const dxtc = rgtFoldChunk('DXTC', 3, '', dxtcChildren)
  const txtr = rgtFoldChunk('TXTR', 1, '<unnamed spooge object>', dxtc)
  const tsetData = rgtDataChunk('DATA', 3, '', new Uint8Array(8))
  const tsetChildren = concatChunks([tsetData, txtr])
  const tset = rgtFoldChunk('TSET', 1, internalName, tsetChildren)

  // File header: 36 bytes (Chunky v3)
  // NOTE: the signed template was built WITHOUT an FBIF chunk; we omit it
  // here so the generated RGT size matches the template's slot size exactly.
  const fileHdr = new Uint8Array(36)
  fileHdr.set(_enc('Relic Chunky'), 0)
  fileHdr[12] = 0x0d; fileHdr[13] = 0x0a; fileHdr[14] = 0x1a; fileHdr[15] = 0
  const fhv = new DataView(fileHdr.buffer)
  fhv.setUint32(16, 3, true)
  fhv.setUint32(20, 1, true)
  fhv.setUint32(24, 0x24, true)
  fhv.setUint32(28, 0x1c, true)
  fhv.setUint32(32, 1, true)

  const out = new Uint8Array(fileHdr.length + tset.length)
  out.set(fileHdr); out.set(tset, fileHdr.length)
  return out
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const COH2_INSTALL =
  process.env.COH2_INSTALL ||
  '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES_DIR = path.join(COH2_INSTALL, 'CoH2/Archives')

const TEMPLATE_PATH = path.resolve('tools/templates/signed/template_0001.sga')
const MANIFEST_PATH = path.resolve('public/keys/manifest.json')
const OUT_DIR = path.resolve('out/verification/signed')

// ---------------------------------------------------------------------------
// Lazy SGA reader shim (same pattern as test-export.ts)
// ---------------------------------------------------------------------------
function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size
    const len = Math.max(0, e - start)
    return {
      arrayBuffer: async () => {
        const buf = Buffer.alloc(len)
        if (len > 0) fs.readSync(fd, buf, 0, len, start)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      },
    } as Blob
  }
  return { name: path.basename(fp), size: stat.size, slice } as unknown as File
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // ── 1. Read manifest ───────────────────────────────────────────────────
  console.log('Reading manifest…')
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const key = manifest.keys[0]
  console.log(`  key guid: ${key.guid}  file: ${key.file}`)
  const rgtFiles: Record<string, { offset: number; length: number; storeLength: number; storage: number }> =
    key.rgtFiles
  const slotPaths = Object.keys(rgtFiles)
  console.log(`  slots in manifest: ${slotPaths.length}`)

  // ── 2. Read template into a mutable buffer ──────────────────────────────
  console.log(`Reading template: ${TEMPLATE_PATH}`)
  const templateStat = fs.statSync(TEMPLATE_PATH)
  console.log(`  size: ${(templateStat.size / 1024 / 1024).toFixed(1)} MB`)
  const templateBuf = fs.readFileSync(TEMPLATE_PATH)
  const sgaBytes = new Uint8Array(templateBuf.buffer, templateBuf.byteOffset, templateBuf.byteLength)

  // ── 3. Build a lookup: folder → VehicleSpec ────────────────────────────
  // We need to map the slot's vehicle folder name back to a VehicleSpec so we
  // can find the right SGA archive.
  // The template may use the un-aliased vehicle id as the folder name (e.g.
  // 'centaur' instead of 'centaur_aa'); add both forms.
  const folderToVehicleId = new Map<string, string>()
  for (const v of VEHICLES) {
    folderToVehicleId.set(vehicleFolder(v.id), v.id)  // aliased folder name
    folderToVehicleId.set(v.id, v.id)                 // raw vehicle id (template may use this)
  }

  // ── 4. Open SGA archive cache ──────────────────────────────────────────
  const sgaCache = new Map<string, SgaArchive>()
  async function getArchive(name: string): Promise<SgaArchive | null> {
    if (sgaCache.has(name)) return sgaCache.get(name)!
    const fp = path.join(ARCHIVES_DIR, name)
    if (!fs.existsSync(fp)) return null
    try {
      const arch = await SgaArchive.open(nodeFileShim(fp))
      sgaCache.set(name, arch)
      return arch
    } catch {
      return null
    }
  }

  // ── 5. Patch each slot ─────────────────────────────────────────────────
  // Slot path format: art/armies/<faction>/vehicles/<folder>/skins/<guid>_<season>/<basename>_dif.rgt
  let patched = 0
  let skipped = 0
  const skippedReasons: string[] = []

  for (const slotPath of slotPaths) {
    const entry = rgtFiles[slotPath]

    // Parse the slot path
    // e.g. art/armies/aef/vehicles/m10_tank_destroyer/skins/b3a...aa_summer/m10_dif.rgt
    const parts = slotPath.split('/')
    // parts: ['art','armies',<faction>,'vehicles',<folder>,'skins',<guid_season>,<basename_dif.rgt>]
    if (parts.length < 8) {
      skipped++
      skippedReasons.push(`${slotPath}: unexpected path format`)
      continue
    }
    const faction = parts[2]!
    const folder = parts[4]!
    const guidSeason = parts[6]! // e.g. b3a13cce63965c6bbf1f74568a6081aa_summer
    const season = guidSeason.endsWith('_winter') ? 'winter' : 'summer'
    const fileBasename = parts[7]! // e.g. m10_dif.rgt  or m15_aa_halftrack_dif.rgt

    // Strip _dif.rgt suffix to get the texture basename
    const oldBasename = fileBasename.replace(/_dif\.rgt$/, '')

    // Map folder → vehicleId
    const vehicleId = folderToVehicleId.get(folder)
    if (!vehicleId) {
      skipped++
      skippedReasons.push(`${slotPath}: no vehicle in catalog for folder '${folder}'`)
      continue
    }

    // Find the vanilla diffuse RGT from the CoH2 archives
    const sgaCandidates = factionSgaCandidates(faction)
    const baseNames = textureBaseNamesFor(vehicleId)

    // For folder-alias vehicles the template uses the un-aliased id as the
    // folder (e.g. 'centaur'), but the archive stores under the aliased name
    // (e.g. 'centaur_aa'). Try both.
    const aliasedFolder = vehicleFolder(vehicleId)
    const foldersToTry = folder === aliasedFolder ? [folder] : [folder, aliasedFolder]

    let rgtBytes: Uint8Array | null = null
    outer: for (const sgaName of sgaCandidates) {
      const arch = await getArchive(sgaName)
      if (!arch) continue
      for (const tryFolder of foldersToTry) {
        for (const base of baseNames) {
          const difPath = `art/armies/${faction}/vehicles/${tryFolder}/${base}_dif.rgt`
          const b = await arch.readByPath(difPath)
          if (b) { rgtBytes = b; break outer }
        }
      }
    }

    if (!rgtBytes) {
      skipped++
      skippedReasons.push(`${slotPath}: diffuse RGT not found in CoH2 archives (faction=${faction}, folder=${folder})`)
      continue
    }

    // Decode → canvas
    let baseCanvas: ReturnType<typeof bcToCanvas>
    try {
      const rgt = decodeRgt(rgtBytes)
      baseCanvas = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
    } catch (e) {
      skipped++
      skippedReasons.push(`${slotPath}: decode error: ${e}`)
      continue
    }

    // Composite to 2048² (vanilla only — content doesn't matter for load test)
    const out = createCanvas(2048, 2048)
    const ctx = out.getContext('2d')
    ctx.drawImage(baseCanvas as unknown as Parameters<typeof ctx.drawImage>[0], 0, 0, 2048, 2048)

    // Build difTset path — use the slot's own basename so it's internally
    // consistent with the template's TOC baked paths.
    // e.g. art\armies\aef\vehicles\m10_tank_destroyer\m10_dif
    const difTset = `art\\armies\\${faction}\\vehicles\\${folder}\\${oldBasename}_dif`

    // Generate BC3 RGT (compress:false, format 15) — must match the template
    // slot size (~4 MB for 2048² BC3).  canvasToRgt() now uses BC1 (~2 MB)
    // which would not match; we use our local BC3 builder instead.
    let generatedRgt: Uint8Array
    try {
      generatedRgt = canvasToRgtBc3(out, difTset)
    } catch (e) {
      skipped++
      skippedReasons.push(`${slotPath}: canvasToRgt error: ${e}`)
      continue
    }

    // Assert size matches
    if (generatedRgt.length !== entry.length) {
      skipped++
      skippedReasons.push(
        `${slotPath}: RGT size mismatch — generated ${generatedRgt.length}, expected ${entry.length}`
      )
      continue
    }

    // Overwrite in template buffer
    sgaBytes.set(generatedRgt, entry.offset)
    patched++
    process.stdout.write(`\r  patched: ${patched}  skipped: ${skipped}   `)
  }
  console.log()

  // ── 6. Write output ────────────────────────────────────────────────────
  const numericId = freshPackId()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const outPath = path.join(OUT_DIR, `${numericId}.sga`)
  fs.writeFileSync(outPath, Buffer.from(sgaBytes))
  const outStat = fs.statSync(outPath)

  // ── 7. Report ──────────────────────────────────────────────────────────
  console.log('\n=== patch-signed-pack results ===')
  console.log(`  Slots total   : ${slotPaths.length}`)
  console.log(`  Slots patched : ${patched}`)
  console.log(`  Slots skipped : ${skipped}`)
  console.log(`  Output        : ${outPath}`)
  console.log(`  Output size   : ${(outStat.size / 1024 / 1024).toFixed(1)} MB`)

  if (skippedReasons.length > 0) {
    console.log('\nSkipped slot details:')
    for (const r of skippedReasons) console.log(`  SKIP: ${r}`)
  }

  console.log('\nRun verify-signed-patch.mts next to confirm TOC/signature integrity.')
}

main().catch(err => { console.error(err); process.exit(1) })
