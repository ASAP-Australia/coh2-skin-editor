/**
 * artifacts/created-assets/build-iron-test-faceplate.mts
 *
 * Headless build of a real, game-loadable CoH2 faceplate SGA — "Iron Test
 * Faceplate" — via the repo's first-class lib path (buildFaceplateMod), the
 * exact same authoring lib the FaceplateEditor uses in-app.
 *
 * Design (per PLAN §3):
 *   - 692×204 packed atlas (BC3/DXT5).
 *   - 624×204 banner sub-rect: a mid-tone brushed-steel field (reads against
 *     dark CoH2 menu chrome) with the pack title.
 *   - Top-right 64×64 icon sub-rect (ICON_RECT, x=624): a BOLD iron-cross
 *     focal mark on a dark plate — that sub-rect IS the scoreboard/inventory
 *     icon the engine samples.
 *   - Key content kept a few px inside the outer edge (gold hover frame
 *     overhangs ~11px wide / ~4px tall).
 *
 * Output SGA layout (6-file v7, verified by round-trip):
 *   attrib/faceplate/<slug>_faceplate.rgd
 *   english/english.ucs
 *   <guid>.info
 *   <slug>.dds                          (root preview, required by engine)
 *   ui/assets/textures/<guid>_i1.dds    (BC3/DXT5 692×204 atlas)
 *   ui/bin/<guid>.gfx
 *
 * Run from the project root:
 *   npx tsx artifacts/created-assets/build-iron-test-faceplate.mts
 *
 * Imports use explicit absolute src/lib/*.ts paths (the tsx-friendly pattern
 * from scripts/verify-faceplate.mts) — tsx does not resolve the vite `@/`
 * alias for dynamic imports.
 */

import { createCanvas } from 'canvas'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── JSDOM bootstrap (so @/lib/* can reference HTMLCanvasElement etc.) ─────────
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as Record<string, unknown>).document = dom.window.document
;(globalThis as Record<string, unknown>).HTMLCanvasElement = dom.window.HTMLCanvasElement
;(globalThis as Record<string, unknown>).ImageData = dom.window.ImageData
;(globalThis as Record<string, unknown>).File = dom.window.File
;(globalThis as Record<string, unknown>).Blob = dom.window.Blob

// Patch document.createElement('canvas') → node-canvas
const origCreateElement = dom.window.document.createElement.bind(dom.window.document)
;(dom.window.document as unknown as Record<string, unknown>).createElement = (
  tag: string,
  ...args: unknown[]
) => {
  if (tag === 'canvas') return createCanvas(256, 256) as unknown as HTMLCanvasElement
  return origCreateElement(tag as keyof HTMLElementTagNameMap, ...(args as [ElementCreationOptions?]))
}

// Shim global `crypto` for generateGuid() in faceplate-mod-build.ts
if (typeof (globalThis as Record<string, unknown>).crypto === 'undefined') {
  const { webcrypto } = await import('node:crypto')
  ;(globalThis as Record<string, unknown>).crypto = webcrypto
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')
const OUT_SGA = path.join(HERE, 'faceplate-test.sga')

// ─── Import the REAL libs via explicit absolute .ts paths ─────────────────────
const { buildFaceplateMod } = await import(`${SRC_LIB}/faceplate-mod-build.ts`)
const { ATLAS_WIDTH, ATLAS_HEIGHT, BANNER_RECT, ICON_RECT } = await import(
  `${SRC_LIB}/faceplate-templates.ts`
)
const { SgaArchive } = await import(`${SRC_LIB}/sga.ts`)

// ─── Stable mod GUID (32 lowercase hex) ───────────────────────────────────────
const MOD_GUID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

// ─── Palette ──────────────────────────────────────────────────────────────────
const STEEL_DARK = '#3a4048' // mid-tone steel (base field)
const STEEL_MID = '#565e68'
const STEEL_LIGHT = '#6f7883'
const ACCENT_GOLD = '#c9a24b' // muted gold accent line
const PLATE_DARK = '#14161a' // icon plate background
const IRON_WHITE = '#f2f0ea' // iron-cross fill
const IRON_EDGE = '#0c0d10' // iron-cross outline

// ─── Render the 692×204 atlas ─────────────────────────────────────────────────
console.log('\n=== Iron Test Faceplate — headless build ===')
console.log(`Atlas: ${ATLAS_WIDTH}×${ATLAS_HEIGHT}  banner=${JSON.stringify(BANNER_RECT)}  icon=${JSON.stringify(ICON_RECT)}`)

const atlas = createCanvas(ATLAS_WIDTH, ATLAS_HEIGHT)
const ctx = atlas.getContext('2d')

const BW = BANNER_RECT.width // 624
const BH = BANNER_RECT.height // 204

// 0. Fill the entire atlas (incl. dead padding) dark so no black-border artifacts.
ctx.fillStyle = STEEL_DARK
ctx.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)

// 1. Mid-tone brushed-steel field across the banner (vertical light→dark).
const field = ctx.createLinearGradient(0, 0, 0, BH)
field.addColorStop(0, STEEL_LIGHT)
field.addColorStop(0.5, STEEL_MID)
field.addColorStop(1, STEEL_DARK)
ctx.fillStyle = field
ctx.fillRect(0, 0, BW, BH)

// 2. Fine horizontal brushed-metal streaks (deterministic — no RNG jitter).
const band = ctx.getImageData(0, 0, BW, BH)
const bd = band.data
for (let y = 0; y < BH; y++) {
  const streak = ((y * 53) % 13) - 6 // −6..+6, banded by row
  for (let x = 0; x < BW; x++) {
    const i = (y * BW + x) * 4
    bd[i] = Math.max(0, Math.min(255, bd[i] + streak))
    bd[i + 1] = Math.max(0, Math.min(255, bd[i + 1] + streak))
    bd[i + 2] = Math.max(0, Math.min(255, bd[i + 2] + streak))
  }
}
ctx.putImageData(band, 0, 0)

// 3. Gold accent rule under the title + a thin inner frame kept inside the
//    gold hover-frame overhang (~11px wide / ~4px tall) so nothing clips.
ctx.strokeStyle = ACCENT_GOLD
ctx.lineWidth = 3
ctx.strokeRect(14, 8, BW - 28, BH - 16)

// 4. Title text — bold white serif-ish sans, drop-shadowed for dark-chrome
//    separation, left of the icon cell.
ctx.fillStyle = IRON_WHITE
ctx.textAlign = 'left'
ctx.textBaseline = 'middle'
ctx.shadowColor = 'rgba(0,0,0,0.65)'
ctx.shadowBlur = 8
ctx.shadowOffsetX = 2
ctx.shadowOffsetY = 3
ctx.font = `bold ${Math.round(BH * 0.42)}px "DejaVu Sans", "Liberation Sans", Arial, sans-serif`
ctx.fillText('IRON', Math.round(BW * 0.06), Math.round(BH * 0.40))
ctx.font = `${Math.round(BH * 0.16)}px "DejaVu Sans", "Liberation Sans", Arial, sans-serif`
ctx.fillStyle = 'rgba(242,240,234,0.85)'
ctx.fillText('TEST FACEPLATE', Math.round(BW * 0.063), Math.round(BH * 0.72))

// reset shadow
ctx.shadowColor = 'transparent'
ctx.shadowBlur = 0
ctx.shadowOffsetX = 0
ctx.shadowOffsetY = 0

// 5. ICON SUB-RECT (top-right 64×64 at x=624) — bold iron-cross focal mark.
const IX = ICON_RECT.x // 624
const IY = ICON_RECT.y // 0
const ISZ = ICON_RECT.width // 64

// Dark plate so the mark reads as a crisp scoreboard icon.
ctx.fillStyle = PLATE_DARK
ctx.fillRect(IX, IY, ISZ, ISZ)
// subtle inner bevel
ctx.strokeStyle = 'rgba(201,162,75,0.55)'
ctx.lineWidth = 2
ctx.strokeRect(IX + 3, IY + 3, ISZ - 6, ISZ - 6)

// Iron cross: 4 flared arms (pattée) centred in the cell. Draw the black
// edge first (slightly larger), then the white fill on top → bold binary
// silhouette that survives BC3 + RTS downscale.
const cx = IX + ISZ / 2
const cy = IY + ISZ / 2
function ironCross(reach: number, waist: number, flare: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  // For each of the 4 arms, build a flared-tip trapezoid via 2 points at the
  // waist and 2 flared points at the tip, rotating 90° each arm.
  for (let a = 0; a < 4; a++) {
    const ang = (a * Math.PI) / 2
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    // local coords: along = outward axis, perp = sideways
    const pts: [number, number][] = [
      [waist, waist],
      [reach, flare],
      [reach, -flare],
      [waist, -waist],
    ]
    pts.forEach(([along, perp], k) => {
      const px = cx + along * ca - perp * sa
      const py = cy + along * sa + perp * ca
      if (a === 0 && k === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
  }
  ctx.closePath()
  ctx.fill('evenodd')
}
// black edge (outline), then white fill inset
ironCross(28, 5, 15, IRON_EDGE)
ironCross(25, 4, 12.5, IRON_WHITE)

// ─── Extract RGBA atlas ───────────────────────────────────────────────────────
const atlasImageData = ctx.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
const atlasRgba = new Uint8ClampedArray(atlasImageData.data.buffer)
if (atlasRgba.length !== ATLAS_WIDTH * ATLAS_HEIGHT * 4) {
  throw new Error(`atlas RGBA is ${atlasRgba.length}, expected ${ATLAS_WIDTH * ATLAS_HEIGHT * 4}`)
}
console.log(`Atlas RGBA: ${atlasRgba.length} bytes OK`)

// ─── Build the faceplate SGA via the REAL lib ─────────────────────────────────
const project = {
  magic: 'coh2-faceplate-project' as const,
  version: 7 as const,
  id: 'fp_irontest01',
  guid: MOD_GUID,
  packName: 'Iron Test Faceplate',
  packDescription: 'A test faceplate built headlessly via the CoH2 community modding tool lib path.',
  author: '',
  layers: [],
  images: [],
  backgroundColor: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

console.log('\n=== buildFaceplateMod ===')
const result = await buildFaceplateMod({ project, atlasRgba, guid: MOD_GUID })
console.log(`SGA built: ${result.sga.length} bytes`)
console.log(`slug=${result.slug}  guid=${result.guid}  pbgid=0x${result.pbgid.toString(16)}  filename=${result.sgaFilename}`)
console.log('assertSgaParses (internal): PASSED')

await mkdir(HERE, { recursive: true })
await writeFile(OUT_SGA, result.sga)
console.log(`\nWrote SGA → ${OUT_SGA}`)

// ─── VALIDATE: round-trip the written SGA through SgaArchive.open ──────────────
console.log('\n=== Round-trip validation (SgaArchive.open) ===')
const onDisk = new Uint8Array(await readFile(OUT_SGA))
console.log(`On-disk size: ${onDisk.length} bytes`)
const blob = new dom.window.Blob([onDisk])
const archive = await (
  SgaArchive as { open(f: unknown): Promise<{ list(): { path: string; length: number }[] }> }
).open(blob)
const files = archive.list()
console.log(`SgaArchive.open PASSED — ${files.length} files:`)
for (const f of files) console.log(`  ${f.path} (${f.length} bytes)`)

// ─── Assert the exact 6-file v7 layout from PLAN §3 ───────────────────────────
const slug = result.slug
const expected = [
  `attrib/faceplate/${slug}_faceplate.rgd`,
  `english/english.ucs`,
  `${MOD_GUID}.info`,
  `${slug}.dds`,
  `ui/assets/textures/${MOD_GUID}_i1.dds`,
  `ui/bin/${MOD_GUID}.gfx`,
]
const gotPaths = new Set(files.map((f) => f.path.replace(/\\/g, '/').toLowerCase()))
const missing = expected.filter((p) => !gotPaths.has(p.toLowerCase()))
console.log(`\nLayout assertion (${expected.length} expected files):`)
for (const p of expected) console.log(`  ${gotPaths.has(p.toLowerCase()) ? 'OK  ' : 'MISS'} ${p}`)
if (missing.length) throw new Error(`Missing expected files: ${missing.join(', ')}`)
if (files.length !== 6) throw new Error(`Expected exactly 6 files, got ${files.length}`)

console.log('\n=== PASS — Iron Test Faceplate SGA built, written, and round-trip verified (6/6 files) ===')
