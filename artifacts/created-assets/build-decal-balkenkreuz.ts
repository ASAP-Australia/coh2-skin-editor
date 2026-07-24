/**
 * Headless builder for a national-insignia DECAL PACK ("Balkenkreuz Test").
 *
 * Adapts the canvas/fs shim setup from tools/test-export.ts and calls the
 * exact production lib `buildDecalMod` (src/lib/decal-mod-build.ts) that the
 * DecalPackEditor / LiveSync pipeline uses. Produces a real, game-loadable
 * 15-file decal-pack SGA on disk and round-trips it through SgaArchive.open.
 *
 * Badge art: the built-in "balkenkreuz" insignia (public/insignia/balkenkreuz.svg),
 * rendered bold + centered into the badge UV cell of the 1024² per-faction RGT.
 *
 * Run:
 *   cd /var/home/jflessenkemper/dev/coh2-skin-editor && \
 *     npx tsx artifacts/created-assets/build-decal-balkenkreuz.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, Image, ImageData as NodeImageData, loadImage } from 'canvas'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Canvas / DOM shims (mirrors tools/test-export.ts) ───────────────────────
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

// ── Lib imports (after shims) ───────────────────────────────────────────────
import {
  buildDecalMod,
  DECAL_ICON_SIZE,
  DECAL_MAIN_SIZE,
  DECAL_TEXTURE_SIZE,
} from '../../src/lib/decal-mod-build'
import { SgaArchive } from '../../src/lib/sga'
import type { Coh2DecalPackProject } from '../../src/lib/decal-pack-project'

const REPO = path.resolve(__dirname, '../..')
const OUT = path.join(REPO, 'artifacts/created-assets/decal-balkenkreuz.sga')
const BALKENKREUZ_SVG = path.join(REPO, 'public/insignia/balkenkreuz.svg')

// Badge UV cell in a 2048² atlas (verify-calibration.ts BADGE_CELL), scaled to
// the 1024² per-faction RGT (÷2): {x:293, y:40, w:52, h:48} — matches PLAN §2.
const BADGE_CELL_2048 = { x: 586, y: 80, w: 104, h: 96 } as const
const SCALE = DECAL_TEXTURE_SIZE / 2048 // 1024/2048 = 0.5
const CELL = {
  x: Math.round(BADGE_CELL_2048.x * SCALE),
  y: Math.round(BADGE_CELL_2048.y * SCALE),
  w: Math.round(BADGE_CELL_2048.w * SCALE),
  h: Math.round(BADGE_CELL_2048.h * SCALE),
}
// Real badges DON'T fill the whole cell (see CAL_CELL_FILL / BADGE_FRACTION).
// Fill ~0.72 of the cell so the cross is bold and high-contrast but leaves a
// small transparent frame (avoids the whole-hull "smear" from a cell-filling
// opaque square). The mask is binarised white-on-black by the builder anyway.
const CELL_FILL = 0.72

/**
 * node-canvas refuses to rasterise an SVG that has no width/height attributes
 * on the root <svg> (the built-in insignia use viewBox only). Inject explicit
 * pixel dimensions matching the viewBox, then load as a data URL so loadImage
 * can decode it. Rendered at high res (512) so scaling into the small badge
 * cell stays crisp.
 */
const SVG_RASTER_SIZE = 512
async function loadBalkenkreuz() {
  let svg = fs.readFileSync(BALKENKREUZ_SVG, 'utf8')
  // Insert width/height right after the opening <svg tag if absent.
  if (!/<svg[^>]*\bwidth=/.test(svg)) {
    svg = svg.replace(
      /<svg([^>]*)>/,
      `<svg$1 width="${SVG_RASTER_SIZE}" height="${SVG_RASTER_SIZE}">`,
    )
  }
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  return loadImage(dataUrl)
}

async function renderBadgeRgba(): Promise<Uint8ClampedArray> {
  // 1024² transparent canvas; draw the balkenkreuz centered in the badge cell.
  const canvas = createCanvas(DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE)
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE)

  const img = await loadBalkenkreuz()
  const dw = Math.round(CELL.w * CELL_FILL)
  const dh = Math.round(CELL.h * CELL_FILL)
  // The balkenkreuz artwork is square (viewBox 0 0 100 100). Use the smaller of
  // the two cell dims so it stays square/undistorted, centered in the cell.
  const side = Math.min(dw, dh)
  const dx = CELL.x + Math.round((CELL.w - side) / 2)
  const dy = CELL.y + Math.round((CELL.h - side) / 2)
  ctx.drawImage(img as unknown as any, dx, dy, side, side)

  const data = ctx.getImageData(0, 0, DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE).data
  return new Uint8ClampedArray(data.buffer.slice(0))
}

async function renderIconRgba(): Promise<Uint8ClampedArray> {
  // 64×64 inventory thumbnail: balkenkreuz filling ~80% of the icon, centered.
  const canvas = createCanvas(DECAL_ICON_SIZE, DECAL_ICON_SIZE)
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, DECAL_ICON_SIZE, DECAL_ICON_SIZE)
  const img = await loadBalkenkreuz()
  const side = Math.round(DECAL_ICON_SIZE * 0.8)
  const off = Math.round((DECAL_ICON_SIZE - side) / 2)
  ctx.drawImage(img as unknown as any, off, off, side, side)
  const data = ctx.getImageData(0, 0, DECAL_ICON_SIZE, DECAL_ICON_SIZE).data
  return new Uint8ClampedArray(data.buffer.slice(0))
}

function nonTransparentCount(rgba: Uint8ClampedArray): number {
  let n = 0
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 127) n++
  return n
}

const main = async () => {
  console.log('Repo:   ', REPO)
  console.log('Output: ', OUT)
  console.log('Badge cell (1024²):', JSON.stringify(CELL))

  const project: Coh2DecalPackProject = {
    magic: 'coh2-decalpack-project',
    version: 5,
    id: 'dp_balkenkreuz_test',
    packName: 'Balkenkreuz Test',
    packDescription:
      'National-insignia decal pack built headlessly via buildDecalMod. ' +
      'Wehrmacht balkenkreuz centered in the badge UV cell for all five factions.',
    author: 'headless-harness',
    // v5 project: decals array carries the source decal list. The RGT art is
    // supplied directly via decalRgba below, so an empty decals array is fine
    // for the build (buildDecalMod reads packName/packDescription + the RGBAs).
    decals: [],
    sourceImages: {},
  } as unknown as Coh2DecalPackProject

  const iconRgba = await renderIconRgba()
  const decalRgba = await renderBadgeRgba()

  console.log(`icon  RGBA: ${iconRgba.length} bytes (expect ${DECAL_ICON_SIZE ** 2 * 4}), opaque px=${nonTransparentCount(iconRgba)}`)
  console.log(`decal RGBA: ${decalRgba.length} bytes (expect ${DECAL_TEXTURE_SIZE ** 2 * 4}), opaque px=${nonTransparentCount(decalRgba)}`)
  if (nonTransparentCount(decalRgba) === 0) throw new Error('badge RGBA is fully transparent — SVG render failed')

  console.log('\nBuilding decal SGA via buildDecalMod…')
  const result = await buildDecalMod({ project, iconRgba, decalRgba })

  fs.writeFileSync(OUT, Buffer.from(result.sga))
  const kb = (result.sga.length / 1024).toFixed(1)
  console.log(`\n✓ Wrote ${OUT}  (${kb} KB, ${result.sga.length} bytes)`)
  console.log(`  guid:        ${result.guid}`)
  console.log(`  slug:        ${result.slug}`)
  console.log(`  sgaFilename: ${result.sgaFilename}`)
  console.log(`  pbgids:      ${JSON.stringify(result.pbgids)}`)

  // ── Round-trip validation ────────────────────────────────────────────────
  console.log('\nRound-tripping through SgaArchive.open…')
  const buf = result.sga.buffer.slice(
    result.sga.byteOffset,
    result.sga.byteOffset + result.sga.byteLength,
  ) as ArrayBuffer
  const file = new File([buf], 'decal-balkenkreuz.sga', { type: 'application/octet-stream' })
  const archive = await SgaArchive.open(file)
  const list = archive.list()
  console.log(`\nInternal files (${list.length}):`)
  for (const e of list) console.log('  ' + e.path)

  // ── Layout assertions vs PLAN §2 expected 15-file layout ─────────────────
  const g = result.guid
  const s = result.slug
  const expected = [
    `attrib/vehicle_decal/${s}_aef.rgd`,
    `attrib/vehicle_decal/${s}_british.rgd`,
    `attrib/vehicle_decal/${s}_german.rgd`,
    `attrib/vehicle_decal/${s}_soviet.rgd`,
    `attrib/vehicle_decal/${s}_west_german.rgd`,
    `english/english.ucs`,
    `${g}.info`,
    `${s}.dds`,
    `art/armies/aef/badges/${g}/default_dif.rgt`,
    `art/armies/british/badges/${g}/default_dif.rgt`,
    `art/armies/german/badges/${g}/default_dif.rgt`,
    `art/armies/soviet/badges/${g}/default_dif.rgt`,
    `art/armies/west_german/badges/${g}/default_dif.rgt`,
    `ui/assets/textures/${g}_i1.dds`,
    `ui/bin/${g}.gfx`,
  ]
  const paths = new Set(list.map(e => e.path))
  const missing = expected.filter(p => !paths.has(p))
  const extra = list.map(e => e.path).filter(p => !expected.includes(p))
  console.log(`\nExpected 15 files. Got ${list.length}.`)
  if (missing.length) console.log('  MISSING:', missing)
  if (extra.length) console.log('  EXTRA:  ', extra)

  const ok = list.length === 15 && missing.length === 0 && extra.length === 0
  console.log(`\nLayout match: ${ok ? 'PASS ✓' : 'FAIL ✗'}`)
  if (!ok) process.exit(2)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
