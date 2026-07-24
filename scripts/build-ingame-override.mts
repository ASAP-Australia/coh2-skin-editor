/**
 * scripts/build-ingame-override.mts
 *
 * GLOBAL vanilla-art OVERRIDE builder (Option B). Packs a standalone skin-drive
 * SGA whose `data` drive carries our custom art at the EXACT VANILLA BASE PATHS
 * (no GUID / no _summer loadout subfolder), so the CoH2 VFS overlays it on the
 * base ArtGermanEF.sga for ALL default (no-loadout) German Tigers in a match —
 * bypassing the War Spoils loadout equip entirely.
 *
 *   MECHANISM: RelicCoH2.module declares SkinPackFolder = mods\skins; the engine
 *   scans mods\skins\ for %I64u.sga and mounts each pack's `data` drive as a
 *   path-keyed overlay on the base data VFS ([data:common:01] → ArtGermanEF.sga
 *   et al.). A file at a base path WINS over the base archive at that path.
 *   War Spoils skins are GUID-scoped (…/skins/<guid>_summer/…) so the server
 *   loadout picks them; the vanilla NO-LOADOUT default is …/tiger_dif.rgt with
 *   NO guid subfolder — override THAT and every Tiger shows it, globally.
 *
 *   VANILLA BASE PATHS (verified verbatim from the real archives via
 *   scripts/probe-vanilla-override-paths.mts, both in ArtGermanEF.sga):
 *     (2a) camo diffuse : art/armies/german/vehicles/tiger/tiger_dif.rgt   2048² DXT1
 *     (2b) badge atlas  : art/armies/german/badges/default_dif.rgt         1024² DXT1
 *
 *   CAMO: reuses the masked german_ambush compose from
 *     artifacts/created-assets/build-tiger-camo-skin.ts (per-vehicle camo
 *     exclusion mask so camo never lands on tracks/wheels/equipment).
 *   BADGE: composites the balkenkreuz into the badge UV cell of the VANILLA
 *     German atlas (so every OTHER insignia cell in the shared atlas is
 *     preserved) — cell = BADGE_CELL/2 at 1024²  {x:293,y:40,w:52,h:48}.
 *
 * NON-DESTRUCTIVE: writes artifacts + (by default) installs to mods\skins\.
 * Set NO_INSTALL=1 to skip the copy. Does NOT launch the game or touch Steam.
 *
 * Run: npx tsx scripts/build-ingame-override.mts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, Image, ImageData as NodeImageData, loadImage, type Canvas } from 'canvas'

// ── canvas / DOM shims (verbatim from tools/test-export.ts) ─────────────────
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

// ── real lib imports (after shims) ──────────────────────────────────────────
import { SgaArchive } from '../src/lib/sga'
import { decodeRgt } from '../src/lib/rgt'
import { bcToCanvas } from '../src/lib/bc-decode'
import { canvasToRgt } from '../src/lib/rgt-writer'
import { buildSga, type SgaInputFile } from '../src/lib/sga-writer'
import { VEHICLES, rgmPath, vehicleFolder } from '../src/lib/vehicles'
import { parsePrompt, generateCamo, applyWeathering, CAMO_OVERLAY_ALPHA } from '../src/lib/camo-generator'
import { parseRgm } from '../src/lib/rgm'
import { buildCamoExclusionMask } from '../src/lib/camo-mask'
import { textureBaseNamesFor, freshPackId } from '../src/lib/mod-export'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')

// ── config ──────────────────────────────────────────────────────────────────
const INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES = path.join(INSTALL, 'CoH2/Archives')
const OUT_DIR = path.join(REPO, 'artifacts/created-assets/ingame-override')

const VEHICLE_ID = 'tiger'
const CAMO_PROMPT = 'german ambush'
const BALKENKREUZ_SVG = path.join(REPO, 'public/insignia/balkenkreuz.svg')

// VANILLA BASE PATHS (verified). These are the internal SGA paths our data drive
// carries so the VFS overlay replaces the base-game art globally.
const VANILLA_TIGER_DIF = 'art/armies/german/vehicles/tiger/tiger_dif.rgt'   // 2a — 2048² DXT1
const VANILLA_GERMAN_BADGE = 'art/armies/german/badges/default_dif.rgt'      // 2b — 1024² DXT1
// Internal TSET names the engine expects inside each RGT (backslash, no ext).
const TIGER_DIF_TSET = 'art\\armies\\german\\vehicles\\tiger\\tiger_dif'
const GERMAN_BADGE_TSET = 'art\\armies\\german\\badges\\default_dif'

// Badge UV cell — BADGE_CELL {586,80,104,96} at 2048², ÷2 for the 1024² atlas.
const BADGE_CELL_1024 = { x: 293, y: 40, w: 52, h: 48 } as const
const CELL_FILL = 0.72
const SVG_RASTER_SIZE = 512

// ── Node File shim so the SGA reader can page in from the multi-GB archives ──
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

// ── read a vanilla RGT → 2D canvas at its native size ───────────────────────
async function loadVanillaRgtCanvas(internalPath: string, sgaOrder: string[]): Promise<{ canvas: Canvas; w: number; h: number; fourCC: string }> {
  for (const sgaName of sgaOrder) {
    const fp = path.join(ARCHIVES, sgaName)
    if (!fs.existsSync(fp)) continue
    const a = await SgaArchive.open(nodeFileShim(fp))
    const bytes = await a.readByPath(internalPath)
    if (!bytes) continue
    const rgt = decodeRgt(bytes)
    const base = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
    const out = createCanvas(rgt.width, rgt.height)
    out.getContext('2d').drawImage(base as unknown as Canvas, 0, 0)
    return { canvas: out, w: rgt.width, h: rgt.height, fourCC: rgt.fourCC }
  }
  throw new Error(`vanilla RGT not found: ${internalPath}`)
}

// ── build the Tiger armor-only camo exclusion mask from its RGM ─────────────
async function loadCamoMask(): Promise<Canvas | null> {
  const vSpec = VEHICLES.find(v => v.id === VEHICLE_ID)!
  const meshPath = rgmPath(vSpec)
  for (const sgaName of ['ArtHigh.sga', 'ArtArmies.sga', 'ArtGermanEF.sga']) {
    const fp = path.join(ARCHIVES, sgaName)
    if (!fs.existsSync(fp)) continue
    const a = await SgaArchive.open(nodeFileShim(fp))
    const bytes = await a.readByPath(meshPath)
    if (!bytes) continue
    const model = parseRgm(bytes)
    return buildCamoExclusionMask(model.meshes) as unknown as Canvas | null
  }
  return null
}

// ── composite masked german_ambush camo over the vanilla diffuse ────────────
// Mirrors artifacts/created-assets/build-tiger-camo-skin.ts applyCamo() exactly.
function applyCamo(base: Canvas, mask: Canvas | null): void {
  const W = base.width, H = base.height
  const cctx = base.getContext('2d')
  let vanillaSnap: Canvas | null = null
  if (mask) {
    vanillaSnap = createCanvas(W, H)
    vanillaSnap.getContext('2d').drawImage(base as unknown as Canvas, 0, 0)
  }
  const preset = { ...parsePrompt(CAMO_PROMPT), maskedMode: true }
  console.log(`  camo preset: "${preset.label}" style=${preset.style} seed=${preset.seed} maskedMode=${preset.maskedMode}`)
  const camo = createCanvas(W, H)
  generateCamo(camo as unknown as HTMLCanvasElement, preset, null)
  cctx.globalCompositeOperation = 'source-atop'
  cctx.globalAlpha = CAMO_OVERLAY_ALPHA
  cctx.drawImage(camo as unknown as Canvas, 0, 0)
  cctx.globalAlpha = 1
  cctx.globalCompositeOperation = 'source-over'
  applyWeathering(cctx as unknown as CanvasRenderingContext2D, W, H, preset.seed)
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

// ── load the balkenkreuz SVG (node-canvas needs explicit width/height) ──────
async function loadBalkenkreuz() {
  let svg = fs.readFileSync(BALKENKREUZ_SVG, 'utf8')
  if (!/<svg[^>]*\bwidth=/.test(svg)) {
    svg = svg.replace(/<svg([^>]*)>/, `<svg$1 width="${SVG_RASTER_SIZE}" height="${SVG_RASTER_SIZE}">`)
  }
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  return loadImage(dataUrl)
}

// ── composite the balkenkreuz into the badge cell of the VANILLA atlas ──────
// Keeps every OTHER cell of the shared atlas intact (unlike the decal-pack path
// which starts from a fresh transparent atlas). Only the national-insignia cell
// is repainted so the global override doesn't blank other emblems.
async function applyBalkenkreuz(atlas: Canvas): Promise<void> {
  const ctx = atlas.getContext('2d')
  const img = await loadBalkenkreuz()
  const cell = BADGE_CELL_1024
  const dw = Math.round(cell.w * CELL_FILL)
  const dh = Math.round(cell.h * CELL_FILL)
  const side = Math.min(dw, dh)
  const dx = cell.x + Math.round((cell.w - side) / 2)
  const dy = cell.y + Math.round((cell.h - side) / 2)
  // Clear just the badge cell first, then draw the cross, so the new insignia
  // fully replaces the vanilla emblem in that cell (no ghosting through).
  ctx.clearRect(cell.x, cell.y, cell.w, cell.h)
  ctx.drawImage(img as unknown as any, dx, dy, side, side)
  console.log(`  balkenkreuz composited into badge cell {${cell.x},${cell.y},${cell.w},${cell.h}} (side=${side}px, fill=${CELL_FILL})`)
}

const main = async () => {
  console.log('install : ', INSTALL)
  console.log('out dir : ', OUT_DIR)
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // ── (2a) CAMO DIFFUSE at the vanilla base Tiger path ──────────────────────
  console.log('\n[1/4] Loading vanilla Tiger diffuse…')
  const { canvas: difCanvas, w: dw, h: dh, fourCC: difCC } =
    await loadVanillaRgtCanvas(VANILLA_TIGER_DIF, ['ArtGermanEF.sga', 'ArtArmies.sga', 'ArtHigh.sga'])
  console.log(`  vanilla ${VANILLA_TIGER_DIF}: ${dw}x${dh} ${difCC}`)
  console.log('[2/4] Building camo exclusion mask + compositing masked german_ambush camo…')
  const camoMask = await loadCamoMask()
  applyCamo(difCanvas, camoMask)
  const difRgt = canvasToRgt(difCanvas as unknown as HTMLCanvasElement, TIGER_DIF_TSET) // BC1 default + FBIF
  console.log(`  camo _dif.rgt: ${difRgt.length} bytes (BC1/DXT1, FBIF preamble)`)

  // ── (2b) BADGE ATLAS at the vanilla base German badge path ────────────────
  console.log('\n[3/4] Loading vanilla German badge atlas + compositing balkenkreuz…')
  const { canvas: badgeCanvas, w: bw, h: bh, fourCC: badgeCC } =
    await loadVanillaRgtCanvas(VANILLA_GERMAN_BADGE, ['ArtGermanEF.sga', 'ArtArmies.sga', 'ArtHigh.sga'])
  console.log(`  vanilla ${VANILLA_GERMAN_BADGE}: ${bw}x${bh} ${badgeCC}`)
  await applyBalkenkreuz(badgeCanvas)
  const badgeRgt = canvasToRgt(badgeCanvas as unknown as HTMLCanvasElement, GERMAN_BADGE_TSET) // BC1 + FBIF
  console.log(`  badge default_dif.rgt: ${badgeRgt.length} bytes (BC1/DXT1, FBIF preamble)`)

  // ── pack the override SGA ─────────────────────────────────────────────────
  // Skin drive layout (attrib/locale/info/data). Both override RGTs ride the
  // `data` drive at their VANILLA BASE PATHS. compress:false → store raw (RGT is
  // already a compressed DXT container). verification defaults to 'none' → the
  // legacy [Sig:0] skin layout that loads locally.
  console.log('\n[4/4] Packing override SGA (data drive @ vanilla base paths)…')
  const files: SgaInputFile[] = [
    { path: VANILLA_TIGER_DIF, bytes: difRgt, compress: false },
    { path: VANILLA_GERMAN_BADGE, bytes: badgeRgt, compress: false },
  ]
  const numericId = freshPackId()
  const archiveName = numericId
  const sga = await buildSga({ archiveName, files })   // driveLayout defaults to 'skin'
  const OUT_SGA = path.join(OUT_DIR, `${numericId}.sga`)
  const NAMED_SGA = path.join(OUT_DIR, 'tiger-global-override.sga')
  fs.writeFileSync(OUT_SGA, Buffer.from(sga))
  fs.writeFileSync(NAMED_SGA, Buffer.from(sga))
  console.log(`  wrote ${OUT_SGA} (${(sga.length / 1024 / 1024).toFixed(2)} MB)`)
  console.log(`  wrote ${NAMED_SGA} (clear-name copy)`)

  // ── VALIDATE: round-trip; override files present at exact vanilla paths ────
  console.log('\nValidating (round-trip SgaArchive.open)…')
  const rt = await SgaArchive.open(nodeFileShim(OUT_SGA))
  const paths = rt.listPaths().sort()
  console.log(`  internal files (${paths.length}):`)
  for (const p of paths) console.log('    ', p)

  const difBack = await rt.readByPath(VANILLA_TIGER_DIF)
  const badgeBack = await rt.readByPath(VANILLA_GERMAN_BADGE)
  let difOk = false, badgeOk = false, difInfo = '', badgeInfo = ''
  if (difBack) { const d = decodeRgt(difBack); difOk = d.width === 2048 && d.height === 2048 && d.fourCC === 'DXT1'; difInfo = `${d.width}x${d.height} ${d.fourCC}` }
  if (badgeBack) { const d = decodeRgt(badgeBack); badgeOk = d.width === 1024 && d.height === 1024 && d.fourCC === 'DXT1'; badgeInfo = `${d.width}x${d.height} ${d.fourCC}` }

  const pathsOk = paths.length === 2
    && paths.includes(VANILLA_TIGER_DIF)
    && paths.includes(VANILLA_GERMAN_BADGE)
  console.log(`\n  both override files at EXACT vanilla paths: ${pathsOk ? 'YES' : 'NO'}`)
  console.log(`  camo diffuse round-trip:  ${difInfo}  (2048² DXT1 ok=${difOk})`)
  console.log(`  badge atlas round-trip:   ${badgeInfo}  (1024² DXT1 ok=${badgeOk})`)
  if (!pathsOk || !difOk || !badgeOk) { console.log('\nRESULT: FAIL'); process.exit(1) }
  console.log('\nRESULT: PASS — global-override SGA produced + round-trip validated.')

  // ── INSTALL to mods\skins\ (unless NO_INSTALL=1) ──────────────────────────
  const SKINS_DIR = '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins'
  if (process.env.NO_INSTALL === '1') {
    console.log(`\n[install] skipped (NO_INSTALL=1). Manual install:`)
    console.log(`  cp "${OUT_SGA}" "${SKINS_DIR}/${numericId}.sga"`)
  } else if (!fs.existsSync(SKINS_DIR)) {
    console.log(`\n[install] skins dir missing: ${SKINS_DIR} — skipped. Manual:`)
    console.log(`  cp "${OUT_SGA}" "<mods>/skins/${numericId}.sga"`)
  } else {
    const dest = path.join(SKINS_DIR, `${numericId}.sga`)
    fs.copyFileSync(OUT_SGA, dest)
    console.log(`\n[install] copied to ${dest}`)
    console.log(`  (engine scans mods\\skins\\ for %I64u.sga — numeric filename ${numericId} matches)`)
  }

  console.log('\n[done] Global override built.')
  console.log(`  numericId          : ${numericId}`)
  console.log(`  camo path (2a)     : ${VANILLA_TIGER_DIF}`)
  console.log(`  badge path (2b)    : ${VANILLA_GERMAN_BADGE}`)
}

main().catch(err => { console.error(err); process.exit(1) })
