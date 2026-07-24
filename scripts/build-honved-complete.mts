/**
 * scripts/build-honved-complete.mts
 *
 * Complete headless rebuild of BOTH Honved packs:
 *   1. Author custom icons (DECAL + SKIN) as canvas PNGs
 *   2. Rebuild SKIN SGA with custom icon (10 german vehicles)
 *   3. Rebuild DECAL SGA with Kereszt content + custom decal icon
 *   4. assertSgaParses on both
 *   5. Deploy both, backing up old to /tmp
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.node.json scripts/build-honved-complete.mts
 */

import { createCanvas, loadImage } from 'canvas'
import { readFile, copyFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── JSDOM Bootstrap ─────────────────────────────────────────────────────────
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as Record<string, unknown>).document = dom.window.document
;(globalThis as Record<string, unknown>).HTMLCanvasElement = dom.window.HTMLCanvasElement
;(globalThis as Record<string, unknown>).ImageData = dom.window.ImageData

// Patch document.createElement('canvas') → node-canvas
const origCreateElement = dom.window.document.createElement.bind(dom.window.document)
;(dom.window.document as unknown as Record<string, unknown>).createElement = (tag: string, ...args: unknown[]) => {
  if (tag === 'canvas') {
    const nc = createCanvas(256, 256) // default; resized by callers
    return nc as unknown as HTMLCanvasElement
  }
  return origCreateElement(tag as keyof HTMLElementTagNameMap, ...args as [ElementCreationOptions?])
}
;(globalThis as Record<string, unknown>).document = dom.window.document

// ─── Paths ───────────────────────────────────────────────────────────────────
const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')
const REGEN_DIR = path.join(ROOT, 'artifacts', 'respec_audit', 'honved-skin', 'regen')
const TEMPLATE_DIR = path.join(ROOT, 'public', 'template')
const ICONS_DIR = path.join(ROOT, 'artifacts', 'respec_audit', 'honved-skin', 'icons')
const OUT_DIR = path.join(ROOT, 'artifacts', 'respec_audit', 'honved-skin')

const SKIN_OUT_SGA = path.join(OUT_DIR, 'honved-skin-with-icon.sga')
const DECAL_OUT_SGA = path.join(OUT_DIR, 'honved-decal-kereszt.sga')

const INSTALLED_SKIN_SGA = path.join(
  '/var/home/jflessenkemper/.local/share/feral-interactive/CompanyOfHeroes2/AppData/mods/skins',
  '2766831464216004.sga'
)
const INSTALLED_DECAL_SGA = path.join(
  '/var/home/jflessenkemper/.local/share/feral-interactive/CompanyOfHeroes2/AppData/mods/decals/subscriptions',
  'c31f530091829e0a8baeaf5c963a81c0.sga'
)

// ─── Dynamic imports (after DOM patch) ───────────────────────────────────────
const { canvasToRgt } = await import(`${SRC_LIB}/rgt-writer.ts`)
const { buildSga } = await import(`${SRC_LIB}/sga-writer.ts`) as {
  buildSga: (opts: { archiveName: string; files: { path: string; bytes: Uint8Array; compress?: boolean }[] }) => Promise<Uint8Array>
}
const { SgaArchive } = await import(`${SRC_LIB}/sga.ts`)
const { encodeBc3 } = await import(`${SRC_LIB}/bc-encode.ts`)
const { decodeBc3 } = await import(`${SRC_LIB}/bc-decode.ts`)
// decal-mod-build helpers (inlined here to avoid @/ alias issues)
// wrapBc3InDds is duplicated in both mod-build files; inline it here to avoid @/ alias chain
function wrapDds(bc3: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(128 + bc3.length)
  const view = new DataView(out.buffer)
  out.set([0x44, 0x44, 0x53, 0x20], 0)
  view.setUint32(4, 124, true)
  view.setUint32(8, 0x00081007, true)
  view.setUint32(12, height, true)
  view.setUint32(16, width, true)
  view.setUint32(20, bc3.length, true)
  view.setUint32(24, 0, true)
  view.setUint32(28, 0, true)
  view.setUint32(76, 32, true)
  view.setUint32(80, 0x4, true)
  out.set([0x44, 0x58, 0x54, 0x35], 84)
  view.setUint32(108, 0x1000, true)
  out.set(bc3, 128)
  return out
}

// ─── Skin constants ───────────────────────────────────────────────────────────
const SKIN_TEMPLATE_GUID = '935a02ef44344ea29108b57b9cb7b9f5'
const SKIN_MOD_GUID = SKIN_TEMPLATE_GUID // stable — same as installed pack
const SKIN_PACK_NAME = 'Honved Camo'
const SKIN_PACK_DESC = 'Hungarian Honved 3-tone camouflage for Ostheer vehicles (with custom icon).'

const GERMAN_VEHICLE_IDS = [
  'tiger', 'elefant', 'brummbar', 'stug_iii', 'ostwind_flak_panzer',
  'panzerwerfer', 'halftrack', 'sdkfz_250', 'sdkfz_222', 'opel_blitz',
]

const VEHICLE_FOLDER_ALIAS: Record<string, string> = {
  centaur: 'centaur_aa', t_34_85: 't34_85', valentine: 'valentine_command',
}
function vehicleFolder(vehicleId: string): string {
  return VEHICLE_FOLDER_ALIAS[vehicleId] ?? vehicleId
}
const OUTPUT_BASENAME: Record<string, string> = {
  elefant: 'elefant_hull', ostwind_flak_panzer: 'ostwind', sdkfz_222: 'sdkfz221',
  panther_ausf_g: 'panther', halftrack: 'halftrack', centaur: 'centaur_aa',
  t_34_85: 't_34_85', valentine: 'valentine_command', sherman_m4a3: 'sherman_page',
  aec_armoured_car: 'aec_armouredcar_page',
}
function outputBasename(vehicleId: string): string {
  return OUTPUT_BASENAME[vehicleId] ?? vehicleId
}

// ─── Decal constants ──────────────────────────────────────────────────────────
// Stable GUID matching the installed decal pack filename
const DECAL_MOD_GUID = 'c31f530091829e0a8baeaf5c963a81c0'
const DECAL_PACK_NAME = 'Honved Kereszt Decal'
const DECAL_PACK_DESC = 'Hungarian Kereszt (white Greek cross on black square) for Honved-themed Ostheer vehicles.'

// ─── Palette ─────────────────────────────────────────────────────────────────
// Honved palette: #C8A96E (dunkelgelb), #7A3B2E (dark red/brown), #4A5A35 (camo green)
// Hungarian flag: red #CE2939, white #FFFFFF, green #477050
const HUN_GREEN = '#477050'
const HUN_RED = '#CE2939'
const HONVED_DUNKELGELB = '#C8A96E'
const HONVED_BROWN = '#7A3B2E'
const HONVED_GREEN = '#4A5A35'

// ─── Helper: GUID rewrite in bytes ───────────────────────────────────────────
function rewriteGuid(buf: Uint8Array, oldGuid: string, newGuid: string): Uint8Array {
  const enc = new TextEncoder()
  const oldBytes = enc.encode(oldGuid)
  const newBytes = enc.encode(newGuid)
  const out = new Uint8Array(buf)
  let i = 0
  outer: while (i <= out.length - oldBytes.length) {
    for (let k = 0; k < oldBytes.length; k++) {
      if (out[i + k] !== oldBytes[k]) { i++; continue outer }
    }
    for (let k = 0; k < newBytes.length; k++) out[i + k] = newBytes[k]
    i += newBytes.length
  }
  return out
}

function rewriteInfo(buf: Uint8Array, packName: string, packDesc: string): Uint8Array {
  const td = new TextDecoder('utf-8')
  let text = td.decode(buf)
  text = text.replace(/name\s*=\s*"[^"]*"/, `name = "${packName.replace(/"/g, '\\"')}"`)
  text = text.replace(/description\s*=\s*"[^"]*"/, `description = "${packDesc.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
  return new TextEncoder().encode(text)
}

async function readTemplateFile(relPath: string): Promise<Uint8Array> {
  const abs = path.join(TEMPLATE_DIR, relPath)
  return new Uint8Array(await readFile(abs))
}

// ─── assertSgaParses ─────────────────────────────────────────────────────────
async function assertSgaParses(bytes: Uint8Array, label: string): Promise<{ files: { path: string; length: number }[] }> {
  const blob = new Blob([bytes])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const archive = await (SgaArchive as any).open(blob)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const files: { path: string; length: number }[] = archive.list()
  console.log(`assertSgaParses[${label}]: PASSED — ${files.length} files`)
  return { files }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 1 — Author Icons
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TASK 1: Authoring custom icons ===')
await mkdir(ICONS_DIR, { recursive: true })

// ─── 1a. DECAL ICON: Honved Kereszt on Hungarian-themed dark background ───────
// 256×256 canvas: dark olive-green field, subtle tricolor stripe, white Greek cross, centered
{
  const SZ = 256
  const nc = createCanvas(SZ, SZ)
  const ctx = nc.getContext('2d')

  // Background: dark field (#1a1a0d — near-black olive)
  ctx.fillStyle = '#1a1a0d'
  ctx.fillRect(0, 0, SZ, SZ)

  // Subtle horizontal Hungarian tricolor stripes at bottom quarter (accent only)
  const stripeH = Math.round(SZ * 0.06)
  const stripeY = SZ - stripeH * 3
  // red stripe
  ctx.fillStyle = HUN_RED
  ctx.fillRect(0, stripeY, SZ, stripeH)
  // white stripe
  ctx.fillStyle = '#e8e4d0'
  ctx.fillRect(0, stripeY + stripeH, SZ, stripeH)
  // green stripe
  ctx.fillStyle = HUN_GREEN
  ctx.fillRect(0, stripeY + stripeH * 2, SZ, stripeH)

  // Black square background for the cross (central, 70% of SZ)
  const sq = Math.round(SZ * 0.70)
  const sqX = Math.round((SZ - sq) / 2)
  const sqY = Math.round((SZ - sq) / 2 - SZ * 0.04) // shift up slightly
  ctx.fillStyle = '#0d0d0d'
  ctx.fillRect(sqX, sqY, sq, sq)

  // White Greek cross (equal arms)
  const armW = Math.round(sq * 0.30) // arm width ~30% of square
  const cx = sqX + sq / 2
  const cy = sqY + sq / 2
  ctx.fillStyle = '#f0ece0'
  // Horizontal bar
  ctx.fillRect(sqX, Math.round(cy - armW / 2), sq, armW)
  // Vertical bar
  ctx.fillRect(Math.round(cx - armW / 2), sqY, armW, sq)

  // Thin border around the black square
  ctx.strokeStyle = '#666655'
  ctx.lineWidth = 1.5
  ctx.strokeRect(sqX + 0.75, sqY + 0.75, sq - 1.5, sq - 1.5)

  // Save PNG
  const decalIconPath = path.join(ICONS_DIR, 'decal-icon-kereszt.png')
  const { createWriteStream } = await import('node:fs')
  const ws = createWriteStream(decalIconPath)
  nc.createPNGStream().pipe(ws)
  await new Promise<void>((res, rej) => { ws.on('finish', res); ws.on('error', rej) })
  console.log(`  DECAL icon saved: ${decalIconPath}`)

  // Export raw RGBA for SGA embedding
  const decalIconRgba = new Uint8ClampedArray(nc.getContext('2d').getImageData(0, 0, SZ, SZ).data.buffer)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__decalIconRgba = decalIconRgba
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__decalIconSize = SZ
}

// ─── 1b. SKIN ICON: Honved emblem — Kereszt over dunkelgelb camo swatch ──────
// 256×256 canvas: 3-zone dunkelgelb/brown/green camo, centered Kereszt
{
  const SZ = 256
  const nc = createCanvas(SZ, SZ)
  const ctx = nc.getContext('2d')

  // Camo background — 3 diagonal zones matching Honved palette
  // Zone 1: Dunkelgelb base
  ctx.fillStyle = HONVED_DUNKELGELB
  ctx.fillRect(0, 0, SZ, SZ)
  // Zone 2: Brown diagonal patch (top-right)
  ctx.fillStyle = HONVED_BROWN
  ctx.beginPath()
  ctx.moveTo(SZ * 0.45, 0)
  ctx.lineTo(SZ, 0)
  ctx.lineTo(SZ, SZ * 0.55)
  ctx.lineTo(SZ * 0.45, 0)
  ctx.fill()
  // Zone 3: Green patch (bottom-left)
  ctx.fillStyle = HONVED_GREEN
  ctx.beginPath()
  ctx.moveTo(0, SZ * 0.45)
  ctx.lineTo(SZ * 0.55, SZ)
  ctx.lineTo(0, SZ)
  ctx.lineTo(0, SZ * 0.45)
  ctx.fill()
  // Zone 4: additional green (bottom-right corner)
  ctx.fillStyle = HONVED_GREEN
  ctx.beginPath()
  ctx.moveTo(SZ * 0.75, SZ * 0.60)
  ctx.lineTo(SZ, SZ * 0.40)
  ctx.lineTo(SZ, SZ)
  ctx.lineTo(SZ * 0.75, SZ)
  ctx.fill()

  // Hungarian flag tricolor stripes as a thin vertical band on the left edge
  const bandW = Math.round(SZ * 0.055)
  ctx.fillStyle = HUN_RED
  ctx.fillRect(0, 0, bandW, Math.round(SZ / 3))
  ctx.fillStyle = '#e8e4d0'
  ctx.fillRect(0, Math.round(SZ / 3), bandW, Math.round(SZ / 3))
  ctx.fillStyle = HUN_GREEN
  ctx.fillRect(0, Math.round(SZ * 2 / 3), bandW, SZ - Math.round(SZ * 2 / 3))

  // Black square for the cross (center, 60% of SZ)
  const sq = Math.round(SZ * 0.60)
  const sqX = Math.round((SZ - sq) / 2)
  const sqY = Math.round((SZ - sq) / 2)
  ctx.fillStyle = '#0a0a08'
  ctx.fillRect(sqX, sqY, sq, sq)

  // White Greek cross
  const armW = Math.round(sq * 0.30)
  const cx = sqX + sq / 2
  const cy = sqY + sq / 2
  ctx.fillStyle = '#f0ece0'
  ctx.fillRect(sqX, Math.round(cy - armW / 2), sq, armW)
  ctx.fillRect(Math.round(cx - armW / 2), sqY, armW, sq)

  // Border around square
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 2
  ctx.strokeRect(sqX + 1, sqY + 1, sq - 2, sq - 2)

  // Save PNG
  const skinIconPath = path.join(ICONS_DIR, 'skin-icon-honved.png')
  const { createWriteStream } = await import('node:fs')
  const ws2 = createWriteStream(skinIconPath)
  nc.createPNGStream().pipe(ws2)
  await new Promise<void>((res, rej) => { ws2.on('finish', res); ws2.on('error', rej) })
  console.log(`  SKIN icon saved: ${skinIconPath}`)

  // Export raw RGBA for SGA embedding
  const skinIconRgba = new Uint8ClampedArray(nc.getContext('2d').getImageData(0, 0, SZ, SZ).data.buffer)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__skinIconRgba = skinIconRgba
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__skinIconSize = SZ
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 2 — DECAL content: Kereszt RGT
// Build 1024×1024 Kereszt mask for per-faction RGTs
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== TASK 2: Building Kereszt 1024×1024 decal texture ===')

function makeKeresztMask(size: number): Uint8ClampedArray {
  // White Greek cross on black background, centered
  // Arms are 28% of size wide
  const nc2 = createCanvas(size, size)
  const ctx2 = nc2.getContext('2d')

  // Black background
  ctx2.fillStyle = '#000000'
  ctx2.fillRect(0, 0, size, size)

  // White cross
  const armW = Math.round(size * 0.28)
  const half = size / 2
  ctx2.fillStyle = '#ffffff'
  // Horizontal
  ctx2.fillRect(0, Math.round(half - armW / 2), size, armW)
  // Vertical
  ctx2.fillRect(Math.round(half - armW / 2), 0, armW, size)

  return new Uint8ClampedArray(ctx2.getImageData(0, 0, size, size).data.buffer)
}

const keresztMask1024 = makeKeresztMask(1024)
console.log('  Kereszt 1024×1024 mask created')

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 3a — Rebuild SKIN SGA with custom icon
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== TASK 3a: Rebuilding SKIN SGA with custom icon ===')
console.log(`Regen dir: ${REGEN_DIR}`)
console.log(`Output:    ${SKIN_OUT_SGA}`)

const skinSgaFiles: { path: string; bytes: Uint8Array; compress?: boolean }[] = []
const includedVehicles: string[] = []

for (const id of GERMAN_VEHICLE_IDS) {
  const pngPath = path.join(REGEN_DIR, `${id}.png`)
  if (!existsSync(pngPath)) {
    console.warn(`  WARN: ${id}.png not found, skipping`)
    continue
  }
  console.log(`  [${id}] loading diffuse`)
  const img = await loadImage(pngPath)
  const canvas = createCanvas(2048, 2048)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img as unknown as Parameters<typeof ctx.drawImage>[0], 0, 0, 2048, 2048)

  const faction = 'german'
  const folder = vehicleFolder(id)
  const baseName = outputBasename(id)
  const difTset = `art\\armies\\${faction}\\vehicles\\${folder}\\${baseName}_dif`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rgtBytes = (canvasToRgt as any)(canvas, difTset, { compress: true, format: 'bc3', fbif: true }) as Uint8Array
  console.log(`  [${id}] RGT: ${rgtBytes.length} bytes`)

  for (const season of ['summer', 'winter'] as const) {
    const sgaPath = `art/armies/${faction}/vehicles/${folder}/skins/${SKIN_MOD_GUID}_${season}/${baseName}_dif.rgt`
    skinSgaFiles.push({ path: sgaPath, bytes: rgtBytes, compress: false })
  }
  includedVehicles.push(id)
}

// Template files
const SKIN_TEMPLATE_FILES = [
  `${SKIN_TEMPLATE_GUID}.info`,
  'attrib/skin_pack/german/caf_ss3_summer_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_light.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_medium.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_light.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_medium.rgd',
  'english/english.ucs',
  `ui/bin/${SKIN_TEMPLATE_GUID}.gfx`,
  `ui/assets/textures/${SKIN_TEMPLATE_GUID}_i1.dds`,
]

console.log('\n  Packaging template files...')
// .info
const skinInfoBuf = await readTemplateFile(`${SKIN_TEMPLATE_GUID}.info`)
skinSgaFiles.push({
  path: `${SKIN_MOD_GUID}.info`,
  bytes: rewriteInfo(rewriteGuid(skinInfoBuf, SKIN_TEMPLATE_GUID, SKIN_MOD_GUID), SKIN_PACK_NAME, SKIN_PACK_DESC),
  compress: true,
})

for (const tmplPath of SKIN_TEMPLATE_FILES) {
  if (tmplPath.endsWith('.info') || tmplPath.endsWith('.ucs') || tmplPath.endsWith('_i1.dds')) continue
  const destPath = tmplPath.replace(SKIN_TEMPLATE_GUID, SKIN_MOD_GUID)
  const buf = await readTemplateFile(tmplPath)
  skinSgaFiles.push({ path: destPath, bytes: rewriteGuid(buf, SKIN_TEMPLATE_GUID, SKIN_MOD_GUID), compress: true })
}

// .ucs
const skinUcsBuf = await readTemplateFile('english/english.ucs')
skinSgaFiles.push({
  path: 'english/english.ucs',
  bytes: rewriteGuid(skinUcsBuf, SKIN_TEMPLATE_GUID, SKIN_MOD_GUID),
  compress: true,
})

// ── Custom SKIN icon: replace template _i1.dds with our 256×256 custom icon ──
// The skin atlas template is 1008×384 (6-slot atlas); we replace it with a
// simple 256×256 custom icon DDS so the pack has a recognizable thumbnail.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const skinIconRgba = (globalThis as any).__skinIconRgba as Uint8ClampedArray
const SKIN_ICON_SIZE = 256
const skinIconBc3 = encodeBc3(skinIconRgba, SKIN_ICON_SIZE, SKIN_ICON_SIZE)
const skinIconDds = wrapDds(skinIconBc3, SKIN_ICON_SIZE, SKIN_ICON_SIZE)
console.log(`  Skin icon DDS: ${skinIconDds.length} bytes (${SKIN_ICON_SIZE}×${SKIN_ICON_SIZE} BC3)`)

// Replace template _i1.dds with our custom icon
skinSgaFiles.push({
  path: `ui/assets/textures/${SKIN_MOD_GUID}_i1.dds`,
  bytes: skinIconDds,
  compress: true,
})

// Build SKIN SGA
console.log(`\n  Building SKIN SGA (${skinSgaFiles.length} files)...`)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const skinSgaBytes = await (buildSga as any)({ archiveName: SKIN_MOD_GUID, files: skinSgaFiles }) as Uint8Array
console.log(`  SKIN SGA: ${skinSgaBytes.length} bytes (${Math.round(skinSgaBytes.length / 1024 / 1024 * 10) / 10} MB)`)

// Validate SKIN SGA
const { files: skinFiles } = await assertSgaParses(skinSgaBytes, 'SKIN')
const skinIconPresent = skinFiles.some(f => f.path.includes('_i1.dds'))
console.log(`  _i1.dds icon in SKIN SGA: ${skinIconPresent ? 'CONFIRMED' : 'MISSING!'}`)
if (!skinIconPresent) throw new Error('SKIN SGA missing _i1.dds icon entry')

const skinRgtPaths = skinFiles.map(f => f.path).filter(p => p.endsWith('_dif.rgt'))
console.log(`  RGT entries: ${skinRgtPaths.length} (${includedVehicles.length} vehicles × 2 seasons = ${includedVehicles.length * 2} expected)`)

// Write SKIN SGA
await writeFile(SKIN_OUT_SGA, skinSgaBytes)
console.log(`  Output: ${SKIN_OUT_SGA}`)

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 3b — Rebuild DECAL SGA with Kereszt content + custom icon
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== TASK 3b: Rebuilding DECAL SGA with Kereszt content ===')
console.log(`Output: ${DECAL_OUT_SGA}`)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const decalIconRgba = (globalThis as any).__decalIconRgba as Uint8ClampedArray
const DECAL_ICON_SIZE = 256 // We'll use 256×256 (bigger than the 64 default for better quality)
// Note: buildDecalMod expects iconRgba at DECAL_ICON_SIZE=64, but we're building directly here
// to avoid @/ alias issues. We inline the decal build.

const TEMPLATE_DECAL_GUID = '8df2e3a315914d72a803c0f94398a544'
const FACTION_ORDER = ['aef', 'british', 'german', 'soviet', 'west_german'] as const
type DecalFaction = typeof FACTION_ORDER[number]

// Per-faction template pbgids (from decal-mod-templates.ts)
const TEMPLATE_DECAL_PBGID_LE: Record<DecalFaction, number> = {
  aef: 0xee98f4f5,
  british: 0x93cfd08c,
  german: 0xdee78e1d,
  soviet: 0x892361a6,
  west_german: 0xe44eff9f,
}

// Load template data directly
const { getDecalGfxTemplate, getDecalRgdTemplate } = await import(`${SRC_LIB}/decal-mod-templates.ts`)

function substituteAsciiGuid(buf: Uint8Array, fromGuid: string, toGuid: string): Uint8Array {
  const fromBytes = new TextEncoder().encode(fromGuid)
  const toBytes = new TextEncoder().encode(toGuid)
  const out = new Uint8Array(buf)
  let i = 0
  while (i <= out.length - 32) {
    let match = true
    for (let j = 0; j < 32; j++) {
      if (out[i + j] !== fromBytes[j]) { match = false; break }
    }
    if (match) {
      for (let j = 0; j < 32; j++) out[i + j] = toBytes[j]
      i += 32
    } else { i += 1 }
  }
  return out
}

function substituteUtf16LeGuid(buf: Uint8Array, fromGuid: string, toGuid: string): Uint8Array {
  const out = new Uint8Array(buf)
  const fromBytes = new Uint8Array(64)
  const toBytes = new Uint8Array(64)
  for (let i = 0; i < 32; i++) {
    fromBytes[i * 2] = fromGuid.charCodeAt(i)
    toBytes[i * 2] = toGuid.charCodeAt(i)
  }
  let i = 0
  while (i <= out.length - 64) {
    let match = true
    for (let j = 0; j < 64; j++) {
      if (out[i + j] !== fromBytes[j]) { match = false; break }
    }
    if (match) {
      for (let j = 0; j < 64; j++) out[i + j] = toBytes[j]
      i += 64
    } else { i += 1 }
  }
  return out
}

function deriveDeterministicPbgid(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  if (h === 0) h = 0x12345678
  return h >>> 0
}

function patchDecalRgd(
  buf: Uint8Array, fromGuid: string, toGuid: string, fromPbgid: number, toPbgid: number,
): Uint8Array {
  let out = substituteAsciiGuid(buf, fromGuid, toGuid)
  out = substituteUtf16LeGuid(out, fromGuid, toGuid)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const found = view.getUint32(64, true)
  if (found !== fromPbgid) {
    throw new Error(`Decal RGD pbgid mismatch at offset 64: expected 0x${fromPbgid.toString(16)}, found 0x${found.toString(16)}`)
  }
  view.setUint32(64, toPbgid >>> 0, true)
  return out
}

function buildUcsFile(entries: { id: number; text: string }[]): Uint8Array {
  const lines = entries.map(e => `${e.id}\t${e.text.replace(/[\r\n]+/g, ' ').trim()}`)
  const body = lines.join('\r\n') + '\r\n'
  const out = new Uint8Array(2 + body.length * 2)
  out[0] = 0xff; out[1] = 0xfe
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    out[2 + i * 2] = code & 0xff
    out[2 + i * 2 + 1] = (code >>> 8) & 0xff
  }
  return out
}

function buildInfoFile(packName: string, packDesc: string): Uint8Array {
  const esc = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const body = [
    'hidden = false',
    `name = "${esc(packName)}"`,
    `description = "${esc(packDesc)}"`,
    'dependencies = ',
    '{',
    '}',
  ].join('\r\n') + '\r\n'
  const out = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff
  return out
}

function makeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

function binariseMask(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const lum = 0.2126 * src[i] / 255 + 0.7152 * src[i + 1] / 255 + 0.0722 * src[i + 2] / 255
    const on = lum > 0.5 || src[i + 3] / 255 > 0.5
    out[i] = out[i + 1] = out[i + 2] = out[i + 3] = on ? 255 : 0
  }
  return out
}

// ── Build DECAL SGA ───────────────────────────────────────────────────────────
const DECAL_TEXTURE_SIZE = 1024
const DECAL_ICON_OUT_SIZE = 64 // per-SGA icon spec
const DECAL_MAIN_SIZE = 256

const decalSlug = makeSlug(DECAL_PACK_NAME)
const decalGuid = DECAL_MOD_GUID

// Patch GFX
const decalGfx = substituteAsciiGuid(getDecalGfxTemplate(), TEMPLATE_DECAL_GUID, decalGuid)

// Per-faction RGDs + RGTs (all factions use the same Kereszt cross)
const decalRgdFiles: { path: string; bytes: Uint8Array }[] = []
const decalRgtFiles: { path: string; bytes: Uint8Array }[] = []
const keresztMaskBinary = binariseMask(keresztMask1024)

for (const faction of FACTION_ORDER) {
  const pbgid = deriveDeterministicPbgid(`${decalGuid}_${faction}`)
  const rgd = patchDecalRgd(
    getDecalRgdTemplate(faction),
    TEMPLATE_DECAL_GUID, decalGuid,
    TEMPLATE_DECAL_PBGID_LE[faction as DecalFaction], pbgid,
  )
  decalRgdFiles.push({ path: `attrib/vehicle_decal/${decalSlug}_${faction}.rgd`, bytes: rgd })

  // Build 1024×1024 RGT canvas from the Kereszt mask
  const rgtCanvas = createCanvas(DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE)
  const rgtCtx = rgtCanvas.getContext('2d')
  const imgData = rgtCtx.createImageData(DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE)
  imgData.data.set(keresztMaskBinary)
  rgtCtx.putImageData(imgData, 0, 0)

  const rgtInternalName = `art\\armies\\${faction}\\badges\\${decalGuid}\\default_dif`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rgt = (canvasToRgt as any)(rgtCanvas, rgtInternalName) as Uint8Array
  decalRgtFiles.push({ path: `art/armies/${faction}/badges/${decalGuid}/default_dif.rgt`, bytes: rgt })
  console.log(`  [${faction}] RGT: ${rgt.length} bytes`)
}

// ── Encode icon textures ──────────────────────────────────────────────────────
// Downscale decal icon to 64×64 for the _i1.dds slot
function downscaleNearest(src: Uint8ClampedArray, srcSz: number, dstSz: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstSz * dstSz * 4)
  const ratio = srcSz / dstSz
  for (let y = 0; y < dstSz; y++) {
    const sy = Math.min(srcSz - 1, Math.floor(y * ratio))
    for (let x = 0; x < dstSz; x++) {
      const sx = Math.min(srcSz - 1, Math.floor(x * ratio))
      const si = (sy * srcSz + sx) * 4
      const di = (y * dstSz + x) * 4
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3]
    }
  }
  return out
}

const decalIcon64 = downscaleNearest(decalIconRgba, 256, DECAL_ICON_OUT_SIZE)
const decalIconBc3 = encodeBc3(decalIcon64, DECAL_ICON_OUT_SIZE, DECAL_ICON_OUT_SIZE)
const decalIconDds = wrapDds(decalIconBc3, DECAL_ICON_OUT_SIZE, DECAL_ICON_OUT_SIZE)
console.log(`  Decal icon DDS (_i1): ${decalIconDds.length} bytes (${DECAL_ICON_OUT_SIZE}×${DECAL_ICON_OUT_SIZE})`)

// Main DDS (256×256 from decal icon)
const decalMain256 = downscaleNearest(decalIconRgba, 256, DECAL_MAIN_SIZE)
const decalMainBc3 = encodeBc3(decalMain256, DECAL_MAIN_SIZE, DECAL_MAIN_SIZE)
const decalMainDds = wrapDds(decalMainBc3, DECAL_MAIN_SIZE, DECAL_MAIN_SIZE)

// UCS + INFO
const decalUcs = buildUcsFile([
  { id: 1, text: DECAL_PACK_NAME },
  { id: 2, text: DECAL_PACK_DESC },
])
const decalInfo = buildInfoFile(DECAL_PACK_NAME, DECAL_PACK_DESC)

// Pack DECAL SGA
const decalSgaFiles = [
  ...decalRgdFiles,
  { path: 'english/english.ucs', bytes: decalUcs },
  { path: `${decalGuid}.info`, bytes: decalInfo },
  { path: `${decalSlug}.dds`, bytes: decalMainDds },
  ...decalRgtFiles,
  { path: `ui/assets/textures/${decalGuid}_i1.dds`, bytes: decalIconDds },
  { path: `ui/bin/${decalGuid}.gfx`, bytes: decalGfx },
]

console.log(`\n  Building DECAL SGA (${decalSgaFiles.length} files)...`)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const decalSgaBytes = await (buildSga as any)({ archiveName: decalGuid, files: decalSgaFiles }) as Uint8Array
console.log(`  DECAL SGA: ${decalSgaBytes.length} bytes`)

// Validate DECAL SGA
const { files: decalFiles } = await assertSgaParses(decalSgaBytes, 'DECAL')
const decalIconPresent = decalFiles.some(f => f.path.includes('_i1.dds'))
const decalRgtPresent = decalFiles.filter(f => f.path.includes('default_dif.rgt'))
console.log(`  _i1.dds icon in DECAL SGA: ${decalIconPresent ? 'CONFIRMED' : 'MISSING!'}`)
console.log(`  per-faction RGTs in DECAL SGA: ${decalRgtPresent.length}/5`)
if (!decalIconPresent) throw new Error('DECAL SGA missing _i1.dds icon entry')
if (decalRgtPresent.length !== 5) throw new Error(`DECAL SGA missing RGTs: only ${decalRgtPresent.length}/5`)

// List german RGT specifically
const germanRgt = decalFiles.find(f => f.path.includes('/german/'))
console.log(`  German RGT: ${germanRgt?.path ?? 'MISSING'}`)

// Write DECAL SGA
await writeFile(DECAL_OUT_SGA, decalSgaBytes)
console.log(`  Output: ${DECAL_OUT_SGA}`)

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 4 — Deploy both SGAs
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== TASK 4: Deploying SGAs ===')
const ts = Date.now()

// Deploy SKIN SGA
if (existsSync(INSTALLED_SKIN_SGA)) {
  const skinBackup = `/tmp/honved-skin-backup-${ts}.sga`
  await copyFile(INSTALLED_SKIN_SGA, skinBackup)
  console.log(`  SKIN backup: ${skinBackup}`)
  await writeFile(INSTALLED_SKIN_SGA, skinSgaBytes)
  console.log(`  SKIN deployed: ${INSTALLED_SKIN_SGA}`)
} else {
  console.warn(`  WARN: Installed SKIN SGA not found at ${INSTALLED_SKIN_SGA}`)
}

// Deploy DECAL SGA
if (existsSync(INSTALLED_DECAL_SGA)) {
  const decalBackup = `/tmp/honved-decal-backup-${ts}.sga`
  await copyFile(INSTALLED_DECAL_SGA, decalBackup)
  console.log(`  DECAL backup: ${decalBackup}`)
  await writeFile(INSTALLED_DECAL_SGA, decalSgaBytes)
  console.log(`  DECAL deployed: ${INSTALLED_DECAL_SGA}`)
} else {
  console.warn(`  WARN: Installed DECAL SGA not found at ${INSTALLED_DECAL_SGA}`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL REPORT
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== COMPLETE ===')
console.log(`Icons authored:`)
console.log(`  DECAL: ${path.join(ICONS_DIR, 'decal-icon-kereszt.png')}`)
console.log(`  SKIN:  ${path.join(ICONS_DIR, 'skin-icon-honved.png')}`)
console.log(`DECAL content: Honved Kereszt (white Greek cross on black), all 5 factions`)
console.log(`SKIN SGA: ${SKIN_OUT_SGA} (${Math.round(skinSgaBytes.length / 1024 / 1024 * 10) / 10} MB)`)
console.log(`  _i1.dds present: ${skinIconPresent}`)
console.log(`DECAL SGA: ${DECAL_OUT_SGA} (${Math.round(decalSgaBytes.length / 1024)} KB)`)
console.log(`  _i1.dds present: ${decalIconPresent}`)
console.log(`  per-faction RGTs: ${decalRgtPresent.length}/5`)
console.log(`assertSgaParses: SKIN PASSED, DECAL PASSED`)
console.log(`Deployed: SKIN → ${INSTALLED_SKIN_SGA}`)
console.log(`Deployed: DECAL → ${INSTALLED_DECAL_SGA}`)
console.log(`Backups in /tmp/honved-*-backup-${ts}.sga`)
