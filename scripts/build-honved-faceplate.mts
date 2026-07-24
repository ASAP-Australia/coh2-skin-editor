/**
 * scripts/build-honved-faceplate.mts
 *
 * Headless rebuild of the Honved faceplate SGA from scratch with corrected
 * Hungarian accented characters (é, É, Á).
 *
 * What this script produces:
 *   - A 692×204 atlas: green/white/red tricolor stripes, centred white Greek
 *     cross, "HONVÉD" banner text, "MAGYAR KIRÁLYI HONVÉDSÉG" subtitle,
 *     and a 64×64 icon sub-rect (top-right).
 *   - Correct UTF-16-LE UCS string table with accented pack name "Honvéd".
 *   - Correctly patched GFX + RGD templates for the stable mod GUID.
 *   - The SGA is deployed over the installed faceplate pack after backing up
 *     the old file to /tmp.
 *
 * Run from the project root:
 *   npx vite-node scripts/build-honved-faceplate.mts
 *
 * Gates:
 *   1. tsc --noEmit (TypeScript clean)
 *   2. vitest run (unit tests pass)
 *   3. assertSgaParses (built-in round-trip check in buildFaceplateMod)
 */

import { createCanvas } from 'canvas'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── JSDOM bootstrap (needed so @/lib/* can reference HTMLCanvasElement etc.) ─
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as Record<string, unknown>).document = dom.window.document
;(globalThis as Record<string, unknown>).HTMLCanvasElement = dom.window.HTMLCanvasElement
;(globalThis as Record<string, unknown>).ImageData = dom.window.ImageData
;(globalThis as Record<string, unknown>).File = dom.window.File

// Patch document.createElement('canvas') → node-canvas
const origCreateElement = dom.window.document.createElement.bind(dom.window.document)
;(dom.window.document as unknown as Record<string, unknown>).createElement = (tag: string, ...args: unknown[]) => {
  if (tag === 'canvas') {
    const nc = createCanvas(256, 256)
    return nc as unknown as HTMLCanvasElement
  }
  return origCreateElement(tag as keyof HTMLElementTagNameMap, ...args as [ElementCreationOptions?])
}
;(globalThis as Record<string, unknown>).document = dom.window.document

// Also shim global `crypto` for generateGuid() in faceplate-mod-build.ts
if (typeof (globalThis as Record<string, unknown>).crypto === 'undefined') {
  const { webcrypto } = await import('node:crypto')
  ;(globalThis as Record<string, unknown>).crypto = webcrypto
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts', 'honved-faceplate')
const OUT_SGA = path.join(ARTIFACTS_DIR, 'honved-faceplate.sga')

const INSTALLED_SGA =
  '/var/home/jflessenkemper/.local/share/feral-interactive/CompanyOfHeroes2/AppData/mods/faceplates/079246d340a6ae11ea0042abfc71ec04.sga'
const BACKUP_SGA = '/tmp/honved-faceplate-backup.sga'

// Stable GUID — matches the installed faceplate SGA filename.
// Using the same GUID ensures CoH2 treats the rebuild as an update to the
// same mod rather than a new mod.
const MOD_GUID = '079246d340a6ae11ea0042abfc71ec04'

// ─── Import buildFaceplateMod via @/ alias (vite-node resolves this) ─────────
const { buildFaceplateMod } = await import('@/lib/faceplate-mod-build')
const { ATLAS_WIDTH, ATLAS_HEIGHT, BANNER_RECT, ICON_RECT } = await import('@/lib/faceplate-templates')

// ─── Atlas constants ──────────────────────────────────────────────────────────
// ATLAS_WIDTH = 692, ATLAS_HEIGHT = 204
// BANNER_RECT = {x:0, y:0, width:624, height:204}
// ICON_RECT   = {x:624, y:0, width:64, height:64}

// Hungarian Honved palette
const HUN_GREEN = '#477050' // Hungarian flag green
const HUN_RED   = '#CE2939' // Hungarian flag red
const HUN_WHITE = '#FFFFFF'
const BANNER_BG = '#2c3a1e'  // dark olive-green background for the banner

// ─── Render the 692×204 atlas ─────────────────────────────────────────────────
console.log(`\n=== Honved Faceplate SGA Rebuild ===`)
console.log(`Atlas size: ${ATLAS_WIDTH}×${ATLAS_HEIGHT}`)
console.log(`Banner rect: ${JSON.stringify(BANNER_RECT)}`)
console.log(`Icon rect: ${JSON.stringify(ICON_RECT)}`)

const atlas = createCanvas(ATLAS_WIDTH, ATLAS_HEIGHT)
const ctx = atlas.getContext('2d')

// ── 1. Dark olive background fills the entire atlas ──────────────────────────
ctx.fillStyle = BANNER_BG
ctx.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)

// ── 2. Tricolor horizontal stripes across the banner (left 624px) ────────────
// Three equal horizontal stripes: red / white / green (Hungarian flag order:
// top=red, mid=white, bottom=green as seen on the Hungarian coat of arms banner)
const BANNER_W = BANNER_RECT.width  // 624
const BANNER_H = BANNER_RECT.height // 204
const stripeH = Math.round(BANNER_H / 3)

// Red stripe (top)
ctx.fillStyle = HUN_RED
ctx.fillRect(0, 0, BANNER_W, stripeH)

// White stripe (middle)
ctx.fillStyle = HUN_WHITE
ctx.fillRect(0, stripeH, BANNER_W, stripeH)

// Green stripe (bottom) — extend to BANNER_H to avoid rounding gaps
ctx.fillStyle = HUN_GREEN
ctx.fillRect(0, stripeH * 2, BANNER_W, BANNER_H - stripeH * 2)

// ── 3. Semi-transparent dark overlay to give the stripes some depth ───────────
ctx.fillStyle = 'rgba(0,0,0,0.38)'
ctx.fillRect(0, 0, BANNER_W, BANNER_H)

// ── 4. White Greek cross centred in the banner ────────────────────────────────
// Cross arms: each arm is ~8px wide, extending to ~28px from centre in
// each direction, giving a crisp Kereszt (Greek cross) motif.
const cx = Math.round(BANNER_W * 0.08) // left-of-centre, near the left side
const cy = Math.round(BANNER_H / 2)
const armLen = Math.round(BANNER_H * 0.30) // arm length from centre
const armW   = Math.round(BANNER_H * 0.13) // arm thickness

ctx.fillStyle = HUN_WHITE
// Horizontal arm
ctx.fillRect(cx - armLen, cy - Math.round(armW / 2), armLen * 2, armW)
// Vertical arm
ctx.fillRect(cx - Math.round(armW / 2), cy - armLen, armW, armLen * 2)

// ── 5. Main banner text: "HONVÉD" ─────────────────────────────────────────────
const bannerFontSz = Math.round(BANNER_H * 0.55) // ~112px
ctx.font = `bold ${bannerFontSz}px "DejaVu Sans", "Liberation Sans", Arial, sans-serif`
ctx.textAlign = 'center'
ctx.textBaseline = 'middle'
ctx.fillStyle = '#ffffff'
// Subtle text shadow for legibility
ctx.shadowColor = 'rgba(0,0,0,0.6)'
ctx.shadowBlur = 8
ctx.shadowOffsetX = 3
ctx.shadowOffsetY = 3
ctx.fillText('HONVÉD', Math.round(BANNER_W * 0.60), Math.round(BANNER_H * 0.42))

// ── 6. Subtitle text: "MAGYAR KIRÁLYI HONVÉDSÉG" ─────────────────────────────
const subFontSz = Math.round(BANNER_H * 0.14) // ~28px
ctx.font = `${subFontSz}px "DejaVu Sans", "Liberation Sans", Arial, sans-serif`
ctx.textAlign = 'center'
ctx.textBaseline = 'middle'
ctx.fillStyle = 'rgba(255,255,255,0.82)'
ctx.shadowColor = 'rgba(0,0,0,0.5)'
ctx.shadowBlur = 4
ctx.shadowOffsetX = 1
ctx.shadowOffsetY = 1
ctx.fillText('MAGYAR KIRÁLYI HONVÉDSÉG', Math.round(BANNER_W * 0.60), Math.round(BANNER_H * 0.78))

// Reset shadow before drawing icon
ctx.shadowColor = 'transparent'
ctx.shadowBlur = 0
ctx.shadowOffsetX = 0
ctx.shadowOffsetY = 0

// ── 7. Icon sub-rect (64×64 at x=624) ────────────────────────────────────────
// Draw a Hungarian-themed icon: dark background + tricolor stripes + cross
const IX = ICON_RECT.x  // 624
const IY = ICON_RECT.y  // 0
const ISZ = ICON_RECT.width  // 64

// Dark field background
ctx.fillStyle = '#1a1a0d'
ctx.fillRect(IX, IY, ISZ, ISZ)

// Mini tricolor stripes
const iStripeH = Math.round(ISZ / 3)
ctx.fillStyle = HUN_RED
ctx.fillRect(IX, IY, ISZ, iStripeH)
ctx.fillStyle = HUN_WHITE
ctx.fillRect(IX, IY + iStripeH, ISZ, iStripeH)
ctx.fillStyle = HUN_GREEN
ctx.fillRect(IX, IY + iStripeH * 2, ISZ, ISZ - iStripeH * 2)

// Dark tint over icon stripes
ctx.fillStyle = 'rgba(0,0,0,0.4)'
ctx.fillRect(IX, IY, ISZ, ISZ)

// Mini Greek cross centered in icon
const icx = IX + Math.round(ISZ / 2)
const icy = IY + Math.round(ISZ / 2)
const iArmLen = Math.round(ISZ * 0.28)
const iArmW   = Math.round(ISZ * 0.14)
ctx.fillStyle = HUN_WHITE
ctx.fillRect(icx - iArmLen, icy - Math.round(iArmW / 2), iArmLen * 2, iArmW)
ctx.fillRect(icx - Math.round(iArmW / 2), icy - iArmLen, iArmW, iArmLen * 2)

// ── 8. Extract RGBA atlas ─────────────────────────────────────────────────────
const atlasImageData = ctx.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
const atlasRgba = new Uint8ClampedArray(atlasImageData.data.buffer)
console.log(`Atlas RGBA: ${atlasRgba.length} bytes (expected ${ATLAS_WIDTH * ATLAS_HEIGHT * 4})`)

// ─── Build the faceplate SGA ──────────────────────────────────────────────────
console.log('\n=== Building faceplate SGA ===')
console.log(`GUID: ${MOD_GUID}`)

const project = {
  magic: 'coh2-faceplate-project' as const,
  version: 7 as const,
  id: 'fp_whggdzr70c',
  packName: 'Honvéd',
  packDescription: 'A custom CoH2 player faceplate for the Hungarian Honvéd Camo theme.',
  workshopId: '3745473621',
  author: '',
  layers: [],
  images: [],
  backgroundColor: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const result = await buildFaceplateMod({
  project,
  atlasRgba,
  guid: MOD_GUID,
})

console.log(`SGA built: ${result.sga.length} bytes`)
console.log(`Slug: ${result.slug}`)
console.log(`GUID: ${result.guid}`)
console.log(`pbgid: 0x${result.pbgid.toString(16)}`)
console.log(`SGA filename: ${result.sgaFilename}`)

// assertSgaParses is called inside buildFaceplateMod; if we reach here, it passed.
console.log('\nassertSgaParses: PASSED (internal verification)')

// ─── Write to artifacts dir ───────────────────────────────────────────────────
await mkdir(ARTIFACTS_DIR, { recursive: true })
await writeFile(OUT_SGA, result.sga)
console.log(`\nWrote SGA: ${OUT_SGA}`)

// ─── Backup + deploy ──────────────────────────────────────────────────────────
console.log('\n=== Deploying faceplate SGA ===')

if (existsSync(INSTALLED_SGA)) {
  await copyFile(INSTALLED_SGA, BACKUP_SGA)
  console.log(`Backed up: ${INSTALLED_SGA}\n      → ${BACKUP_SGA}`)
} else {
  console.log(`No existing SGA at ${INSTALLED_SGA} — skipping backup.`)
}

const faceplatesDir = path.dirname(INSTALLED_SGA)
await mkdir(faceplatesDir, { recursive: true })
await writeFile(INSTALLED_SGA, result.sga)
console.log(`Deployed:  ${INSTALLED_SGA}`)

// ─── Final verification ───────────────────────────────────────────────────────
console.log('\n=== Final verification ===')

// Re-read and parse the deployed SGA to confirm it was written correctly
const { readFile } = await import('node:fs/promises')
const { SgaArchive } = await import('@/lib/sga')

const deployedBytes = new Uint8Array(await readFile(INSTALLED_SGA))
console.log(`Deployed SGA size: ${deployedBytes.length} bytes`)

// Open via SgaArchive (uses Blob/File API via shim)
const deployedBlob = new dom.window.Blob([deployedBytes])
const archive = await (SgaArchive as { open(f: unknown): Promise<{ list(): { path: string; length: number }[] }> }).open(deployedBlob)
const files = archive.list()
console.log(`SgaArchive.open: PASSED — ${files.length} files in archive`)
for (const f of files) {
  console.log(`  ${f.path} (${f.length} bytes)`)
}

const hasUcs = files.some(f => f.path.includes('.ucs'))
const hasGfx = files.some(f => f.path.includes('.gfx'))
const hasRgd = files.some(f => f.path.includes('.rgd'))
const hasDds = files.some(f => f.path.includes('.dds'))

console.log(`\nStructure check:`)
console.log(`  .ucs (string table): ${hasUcs ? 'OK' : 'MISSING!'}`)
console.log(`  .gfx (Scaleform):    ${hasGfx ? 'OK' : 'MISSING!'}`)
console.log(`  .rgd (attrib):       ${hasRgd ? 'OK' : 'MISSING!'}`)
console.log(`  .dds (texture):      ${hasDds ? 'OK' : 'MISSING!'}`)

const allOk = hasUcs && hasGfx && hasRgd && hasDds
if (!allOk) {
  throw new Error('Deployed SGA is missing required file(s) — see above!')
}

console.log('\n=== DONE — Honved faceplate SGA rebuilt and deployed successfully ===')
console.log(`Pack name in UCS will read: "Honvéd" (UTF-16-LE, correct é at U+00E9)`)
console.log(`Banner text: "HONVÉD" (rendered into BC3/DXT5 DDS atlas)`)
console.log(`Subtitle:   "MAGYAR KIRÁLYI HONVÉDSÉG" (rendered into BC3/DXT5 DDS atlas)`)
