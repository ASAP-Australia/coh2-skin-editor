/**
 * Headless build: a REAL CoH2-loadable vehicle SKIN (.sga) for the Tiger I.
 *
 * Follows artifacts/asset-authoring/PLAN.md §4 (CREATE-A-SKIN):
 *   - decode the vanilla Tiger diffuse (2048² _dif) from the user's real
 *     CoH2 install,
 *   - composite the built-in PROCEDURAL CAMO (german ambush preset) over it
 *     using the editor's exact masked/source-atop recipe
 *     (Editor.tsx renderCamoPresetToOverlay, 949-988) so panel lines / rivets
 *     survive (maskedMode + source-atop + weathering),
 *   - encode → _dif.rgt (BC1/DXT1) via canvasToRgt,
 *   - pack the 4-drive skin SGA via buildSga with the shipped template files,
 *   - write it under a numeric %I64u.sga filename (engine-scannable).
 *
 * This reuses the exact canvas/fs shim setup + lib signatures from
 * tools/test-export.ts (the first-class Node export harness); the ONLY change
 * is the diffuse authoring step (camo instead of decals) and Tiger-only scope.
 *
 * Run:
 *   cd /var/home/jflessenkemper/dev/coh2-skin-editor && \
 *     npx tsx artifacts/created-assets/build-tiger-camo-skin.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData, type Canvas } from 'canvas'

// ---- DOM / canvas shims (verbatim from tools/test-export.ts) ---------------
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

// ---- Real lib imports ------------------------------------------------------
import { SgaArchive } from '../../src/lib/sga'
import { decodeRgt } from '../../src/lib/rgt'
import { bcToCanvas } from '../../src/lib/bc-decode'
import { canvasToRgt } from '../../src/lib/rgt-writer'
import { buildSga, type SgaInputFile } from '../../src/lib/sga-writer'
import { VEHICLES, rgmPath } from '../../src/lib/vehicles'
import { parsePrompt, generateCamo, applyWeathering, CAMO_OVERLAY_ALPHA } from '../../src/lib/camo-generator'
import { parseRgm } from '../../src/lib/rgm'
import { buildCamoExclusionMask } from '../../src/lib/camo-mask'
import { OUTPUT_BASENAME, vehicleFolder, textureBaseNamesFor, freshPackId, freshModGuid } from '../../src/lib/mod-export'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const OUT_DIR = '/var/home/jflessenkemper/dev/coh2-skin-editor/artifacts/created-assets'
const VEHICLE_ID = 'tiger'                // Tiger I — repo ground-truth vehicle
const CAMO_PROMPT = 'german ambush'       // PLAN §4 preset (german_ambush)
const PACK_NAME = 'Tiger Ambush Camo'
const PACK_DESC = 'Procedural German ambush camo composited over the vanilla Tiger I diffuse (masked source-atop preserves panel lines). Built headless via the skin-editor lib path.'

const TEMPLATE_GUID = '935a02ef44344ea29108b57b9cb7b9f5'
const TEMPLATE_DIR = path.join(process.cwd(), 'public/template')
const TEMPLATE_FILES = [
  '935a02ef44344ea29108b57b9cb7b9f5.info',
  'attrib/skin_pack/german/caf_ss3_summer_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_light.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_medium.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_light.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_medium.rgd',
  'english/english.ucs',
  'ui/bin/935a02ef44344ea29108b57b9cb7b9f5.gfx',
]

// ---------------------------------------------------------------------------
// Template rewriters (verbatim behaviour from tools/test-export.ts)
// ---------------------------------------------------------------------------
function rewriteGuid(buf: Uint8Array, newGuid: string): Uint8Array {
  const enc = new TextEncoder()
  const oldB = enc.encode(TEMPLATE_GUID)
  const newB = enc.encode(newGuid)
  const out = new Uint8Array(buf)
  let i = 0
  outer: while (i <= out.length - oldB.length) {
    for (let k = 0; k < oldB.length; k++) {
      if (out[i + k] !== oldB[k]) { i++; continue outer }
    }
    for (let k = 0; k < newB.length; k++) out[i + k] = newB[k]
    i += newB.length
  }
  return out
}
function rewriteInfo(buf: Uint8Array, name: string, desc: string): Uint8Array {
  let text = new TextDecoder().decode(buf)
  text = text.replace(/name\s*=\s*"[^"]*"/, `name = "${name.replace(/"/g, '\\"')}"`)
  text = text.replace(/description\s*=\s*"[^"]*"/, `description = "${desc.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
  return new TextEncoder().encode(text)
}

// ---------------------------------------------------------------------------
// Lazy Node File shim so the SGA reader can page in from the 2.9 GB archives.
// (verbatim from tools/test-export.ts)
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
// Load the vanilla Tiger diffuse from the real install → 2048² canvas.
// ---------------------------------------------------------------------------
async function loadVanillaDiffuse(): Promise<{ canvas: Canvas; difTset: string; outBase: string }> {
  const vSpec = VEHICLES.find(v => v.id === VEHICLE_ID)
  if (!vSpec) throw new Error(`vehicle ${VEHICLE_ID} not in registry`)
  const archivesDir = path.join(INSTALL, 'CoH2/Archives')
  // German faction texture archive (see factionSgaCandidates('german')).
  const sgaCandidates = ['ArtGermanEF.sga', 'ArtArmies.sga', 'ArtHigh.sga']
  const baseNames = textureBaseNamesFor(vSpec.id)
  const outBase = OUTPUT_BASENAME[vSpec.id] ?? vSpec.id
  const folder = vehicleFolder(vSpec.id)

  let rgtBytes: Uint8Array | null = null
  outer: for (const sgaName of sgaCandidates) {
    const fp = path.join(archivesDir, sgaName)
    if (!fs.existsSync(fp)) continue
    const a = await SgaArchive.open(nodeFileShim(fp))
    for (const base of baseNames) {
      const difPath = `art/armies/${vSpec.faction}/vehicles/${folder}/${base}_dif.rgt`
      const b = await a.readByPath(difPath)
      if (b) { rgtBytes = b; break outer }
    }
  }
  if (!rgtBytes) throw new Error(`could not locate vanilla ${VEHICLE_ID} _dif.rgt in ${archivesDir}`)

  const rgt = decodeRgt(rgtBytes)
  const baseCanvas = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
  const out = createCanvas(2048, 2048)
  const ctx = out.getContext('2d')
  ctx.drawImage(baseCanvas as unknown as Canvas, 0, 0, 2048, 2048)
  console.log(`  vanilla diffuse: ${rgt.width}x${rgt.height} ${rgt.fourCC} → 2048² canvas`)
  const difTset = `art\\armies\\${vSpec.faction}\\vehicles\\${folder}\\${outBase}_dif`
  return { canvas: out, difTset, outBase }
}

// ---------------------------------------------------------------------------
// Load + parse the Tiger RGM and build its armor-only camo exclusion mask
// (opaque where camo must NOT paint: tracks / wheels / running gear / wreck).
// ---------------------------------------------------------------------------
async function loadCamoMask(): Promise<Canvas | null> {
  const vSpec = VEHICLES.find(v => v.id === VEHICLE_ID)
  if (!vSpec) return null
  const archivesDir = path.join(INSTALL, 'CoH2/Archives')
  const meshPath = rgmPath(vSpec)
  for (const sgaName of ['ArtHigh.sga', 'ArtArmies.sga', 'ArtGermanEF.sga']) {
    const fp = path.join(archivesDir, sgaName)
    if (!fs.existsSync(fp)) continue
    const a = await SgaArchive.open(nodeFileShim(fp))
    const bytes = await a.readByPath(meshPath)
    if (!bytes) continue
    const model = parseRgm(bytes)
    const mask = buildCamoExclusionMask(model.meshes)
    return mask as unknown as Canvas | null
  }
  return null
}

// ---------------------------------------------------------------------------
// Composite procedural camo over the vanilla diffuse.
// Mirrors Editor.tsx renderCamoPresetToOverlay masked branch:
//   base = vanilla, camo drawn source-atop @ CAMO_OVERLAY_ALPHA, then weather,
//   then restore vanilla over the armor-exclusion mask (tracks/wheels/equip).
// ---------------------------------------------------------------------------
function applyCamo(base: Canvas, mask: Canvas | null): void {
  const W = 2048, H = 2048
  const cctx = base.getContext('2d')

  // Snapshot pristine vanilla BEFORE compositing so we can restore excluded
  // regions afterwards.
  let vanillaSnap: Canvas | null = null
  if (mask) {
    vanillaSnap = createCanvas(W, H)
    vanillaSnap.getContext('2d').drawImage(base as unknown as Canvas, 0, 0)
  }

  // Force maskedMode so we use the source-atop panel-line-preserving path
  // (the plan's requirement); german_ambush is not maskedMode by default.
  const preset = { ...parsePrompt(CAMO_PROMPT), maskedMode: true }
  console.log(`  camo preset: "${preset.label}" style=${preset.style} seed=${preset.seed} maskedMode=${preset.maskedMode}`)

  // 1. camo blob canvas (transparent bg, no opaque fill — maskedMode)
  const camo = createCanvas(W, H)
  generateCamo(camo as unknown as HTMLCanvasElement, preset, null)

  // 2. draw camo over vanilla, restricted to opaque body pixels via source-atop
  cctx.globalCompositeOperation = 'source-atop'
  cctx.globalAlpha = CAMO_OVERLAY_ALPHA
  cctx.drawImage(camo as unknown as Canvas, 0, 0)
  cctx.globalAlpha = 1
  cctx.globalCompositeOperation = 'source-over'

  // 3. procedural weathering pass (dust, grime, chips, exhaust, sun, desat)
  applyWeathering(cctx as unknown as CanvasRenderingContext2D, W, H, preset.seed)

  // 4. ARMOR-ONLY: restore vanilla over the excluded UV regions so camo +
  //    weathering never lands on tracks / wheels / running gear / equipment.
  if (mask && vanillaSnap) {
    const patch = createCanvas(W, H)
    const pctx = patch.getContext('2d')
    pctx.drawImage(vanillaSnap as unknown as Canvas, 0, 0)
    pctx.globalCompositeOperation = 'destination-in'
    pctx.drawImage(mask as unknown as Canvas, 0, 0, W, H)
    pctx.globalCompositeOperation = 'source-over'
    cctx.drawImage(patch as unknown as Canvas, 0, 0)
    console.log('  applied armor-only camo exclusion mask (tracks/wheels/equip preserved)')
  } else {
    console.log('  WARN: no camo exclusion mask — camo painted on entire body')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  console.log(`install:  ${INSTALL}`)
  console.log(`out dir:  ${OUT_DIR}`)
  console.log(`vehicle:  ${VEHICLE_ID}`)
  console.log()

  const modGuid = freshModGuid()
  const numericId = freshPackId()
  console.log(`mod guid: ${modGuid}`)
  console.log(`pack id:  ${numericId}  (%I64u.sga engine-scannable filename)`)
  console.log()

  console.log('Loading vanilla diffuse…')
  const { canvas, outBase } = await loadVanillaDiffuse()

  console.log('Building armor-only camo exclusion mask…')
  const camoMask = await loadCamoMask()

  console.log('Applying procedural camo…')
  applyCamo(canvas, camoMask)

  console.log('Encoding _dif.rgt (BC1/DXT1)…')
  const vSpec = VEHICLES.find(v => v.id === VEHICLE_ID)!
  const folder = vehicleFolder(vSpec.id)
  // internal TSET name the engine expects (backslash-separated, no ext).
  const difInternal = `art\\armies\\${vSpec.faction}\\vehicles\\${folder}\\${outBase}_dif`
  const rgtBytes = canvasToRgt(canvas as unknown as HTMLCanvasElement, difInternal)
  console.log(`  _dif.rgt: ${rgtBytes.length} bytes`)

  // Assemble SGA file list: per-season skin RGTs + template files.
  const sgaFiles: SgaInputFile[] = []
  for (const season of ['summer', 'winter'] as const) {
    sgaFiles.push({
      path: `art/armies/${vSpec.faction}/vehicles/${folder}/skins/${modGuid}_${season}/${outBase}_dif.rgt`,
      bytes: rgtBytes,
      compress: false,
    })
  }

  console.log('Reading template…')
  for (const p of TEMPLATE_FILES) {
    const fp = path.join(TEMPLATE_DIR, p)
    if (!fs.existsSync(fp)) { console.log(`  WARN missing template ${p}`); continue }
    const raw = new Uint8Array(fs.readFileSync(fp))
    if (p.endsWith('.info')) {
      sgaFiles.push({ path: `${modGuid}.info`, bytes: rewriteInfo(raw, PACK_NAME, PACK_DESC), compress: true })
    } else if (p.endsWith('.ucs')) {
      sgaFiles.push({ path: 'english/english.ucs', bytes: rewriteGuid(raw, modGuid), compress: true })
    } else if (p.includes(TEMPLATE_GUID)) {
      sgaFiles.push({ path: p.replace(TEMPLATE_GUID, modGuid), bytes: raw, compress: true })
    } else {
      sgaFiles.push({ path: p, bytes: raw, compress: true })
    }
  }
  console.log(`  SGA file count: ${sgaFiles.length}`)

  console.log('Building SGA…')
  const sgaBytes = await buildSga({ archiveName: modGuid, files: sgaFiles })

  const numericPath = path.join(OUT_DIR, `${numericId}.sga`)
  const namedPath = path.join(OUT_DIR, 'tiger-ambush-camo.sga')
  fs.writeFileSync(numericPath, Buffer.from(sgaBytes))
  fs.writeFileSync(namedPath, Buffer.from(sgaBytes))
  const mb = (sgaBytes.length / 1024 / 1024).toFixed(2)
  console.log(`\n✓ Wrote ${numericPath}  (${mb} MB, ${sgaBytes.length} bytes)`)
  console.log(`✓ Wrote ${namedPath}  (clear-name copy)`)

  // -------------------------------------------------------------------------
  // VALIDATE: round-trip the produced SGA through SgaArchive.open and list.
  // -------------------------------------------------------------------------
  console.log('\nValidating (round-trip SgaArchive.open)…')
  const rt = await SgaArchive.open(nodeFileShim(numericPath))
  const paths = rt.listPaths().sort()
  console.log(`  internal files (${paths.length}):`)
  for (const p of paths) console.log(`    ${p}`)

  // Sanity: confirm both season _dif.rgt entries + the 4 identity/template files.
  const expectSeasons = ['summer', 'winter'].map(s =>
    `art/armies/${vSpec.faction}/vehicles/${folder}/skins/${modGuid}_${s}/${outBase}_dif.rgt`)
  const missing: string[] = []
  for (const e of [...expectSeasons, `${modGuid}.info`, 'english/english.ucs']) {
    if (!paths.some(pp => pp.toLowerCase() === e.toLowerCase())) missing.push(e)
  }
  // confirm the RGT decodes back to a 2048² BC1 texture
  const readBack = await rt.readByPath(expectSeasons[0])
  let rgtOk = false, rgtInfo = ''
  if (readBack) {
    const d = decodeRgt(readBack)
    rgtOk = d.width === 2048 && d.height === 2048
    rgtInfo = `${d.width}x${d.height} ${d.fourCC}`
  }

  console.log(`\n  season RGTs present: ${expectSeasons.every(e => paths.map(x=>x.toLowerCase()).includes(e.toLowerCase()))}`)
  console.log(`  round-trip RGT decode: ${rgtInfo} (2048² ok=${rgtOk})`)
  if (missing.length) {
    console.log(`  MISSING expected files: ${missing.join(', ')}`)
    console.log('\nRESULT: FAIL')
    process.exit(1)
  }
  if (!rgtOk) {
    console.log('  RGT did not decode to 2048²')
    console.log('\nRESULT: FAIL')
    process.exit(1)
  }
  console.log('\nRESULT: PASS — real CoH2-loadable Tiger skin SGA produced and round-trip-validated.')
  console.log(`\nInstall (copy the numeric-id file — engine scans %I64u.sga only):`)
  console.log(`  cp "${numericPath}" ".../My Games/Company of Heroes 2/mods/skins/${numericId}.sga"`)
}

main().catch(err => { console.error(err); process.exit(1) })
