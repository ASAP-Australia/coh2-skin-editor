/**
 * scripts/regen-honved.mts
 *
 * Headless Honved skin regeneration for all Ostheer (german faction) vehicles.
 *
 * Pipeline per vehicle:
 *   1. Load stock diffuse from training/dataset/canonical/full/german_<id>.png
 *      (these are the pre-decoded 2048×2048 PNGs — no SGA/RGT decode needed)
 *   2. Load body mask from training/dataset/masks/full/german_<id>.png
 *      (white = armor, black = equipment)
 *   3. Run generateCamo(maskedMode=true, maskCanvas) with honved_summer preset
 *      → camo blobs clipped to armor-only pixels; equipment left transparent
 *   4. Composite: draw vanilla diffuse first, then camo canvas on top (source-over)
 *   5. applyWeathering(ctx, W, H, seed) — dust, grime, chips, exhaust, sun fade,
 *      period desaturation
 *   6. Stamp Hungarian Kereszt (tmpl_honved_kereszt) on hull-right UV rect
 *      (from vehicle-uv-registry or DEFAULT_BADGE_RECT fallback)
 *   7. Stamp white tactical number on a separate rect (tac-number quadrant)
 *   8. Write PNG to artifacts/respec_audit/honved-skin/regen/<vehicleId>.png
 *
 * NODE ENVIRONMENT NOTES:
 *   - Uses jsdom + node-canvas (already devDeps used by vitest)
 *   - No Electron, no renderer, no GPU, no Workers (inflate-pool falls back to
 *     synchronous pako when Worker is absent — tested in vitest already)
 *   - No SGA reads required (canonical PNGs are authoritative)
 *
 * Run:
 *   cd /var/home/jflessenkemper/dev/coh2-skin-editor
 *   npx tsx --tsconfig tsconfig.node.json scripts/regen-honved.mts
 *
 * Note: tsx path-alias support (@/) requires tsconfig paths — we use relative
 * imports inside src/ to avoid needing a separate tsconfig-paths plugin here.
 */

import { createCanvas, loadImage, type Canvas, type CanvasRenderingContext2D as NodeCtx2D } from 'canvas'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Bootstrap jsdom so DOM APIs (document.createElement, ImageData, etc.) are
// available — the camo-generator and related libs call them at module scope.
// ---------------------------------------------------------------------------
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as Record<string, unknown>).document = dom.window.document
;(globalThis as Record<string, unknown>).HTMLCanvasElement = dom.window.HTMLCanvasElement
;(globalThis as Record<string, unknown>).ImageData = dom.window.ImageData

// ---------------------------------------------------------------------------
// Patch document.createElement('canvas') to return node-canvas instances
// so the camo-generator draws real pixels rather than jsdom stubs.
// ---------------------------------------------------------------------------
const origCreateElement = dom.window.document.createElement.bind(dom.window.document)
;(dom.window.document as unknown as Record<string, unknown>).createElement = (tag: string, ...args: unknown[]) => {
  if (tag === 'canvas') {
    // Return a node-canvas that is compatible with the Canvas2D API used by
    // generateCamo / applyWeathering. Default size 2048×2048; caller resizes.
    const nc = createCanvas(2048, 2048)
    // Add the minimal HTMLCanvasElement surface the generator needs:
    //   .getContext('2d') → already there on node-canvas
    //   .width / .height → already there
    return nc as unknown as HTMLCanvasElement
  }
  return origCreateElement(tag as keyof HTMLElementTagNameMap, ...args as [ElementCreationOptions?])
}
// Patch globalThis.document too so imports that call document.createElement see it.
;(globalThis as Record<string, unknown>).document = dom.window.document

// ---------------------------------------------------------------------------
// Now import the pipeline modules (after patching so any top-level calls work)
// ---------------------------------------------------------------------------
// We use relative paths from scripts/ → src/lib/
const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')

// Dynamic imports so the DOM patch above is in effect first.
const { generateCamo, applyWeathering } = await import(`${SRC_LIB}/camo-generator.ts`)
const { VEHICLES } = await import(`${SRC_LIB}/vehicles.ts`)
const { DECAL_TEMPLATES } = await import(`${SRC_LIB}/decal-templates.ts`)
const { resolveDecalUvRect, DEFAULT_BADGE_RECT } = await import(`${SRC_LIB}/vehicle-uv-registry.ts`)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANONICAL_DIR = path.join(ROOT, 'training', 'dataset', 'canonical', 'full')
const MASK_DIR      = path.join(ROOT, 'training', 'dataset', 'masks', 'full')
const OUT_DIR       = path.join(ROOT, 'artifacts', 'respec_audit', 'honved-skin', 'regen')

const ATLAS_SIZE = 2048

// honved_summer preset — sourced directly from camo-generator.ts BASE_PRESETS
const HONVED_PRESET = {
  label: 'Honved Hungarian 3-tone (Ostheer only)',
  style: 'hardEdge' as const,
  colors: ['#C8A96E', '#7A3B2E', '#4A5A35'] as [string, string, string],
  seed: 42, scale: 0.95, rotation: 0, blur: 0,
  maskedMode: true,
  factionScope: 'german',
}

// SVG → node-canvas image helper
// node-canvas requires explicit width/height attrs on the <svg> element.
async function svgToCanvas(svg: string, w: number, h: number): Promise<Canvas> {
  // Inject width/height into the opening <svg tag so node-canvas can render it.
  const withSize = svg.replace(
    /^<svg([^>]*?)>/,
    `<svg$1 width="${w}" height="${h}">`,
  )
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(withSize).toString('base64')}`
  const img = await loadImage(dataUrl)
  const cv = createCanvas(w, h)
  cv.getContext('2d').drawImage(img as unknown as Parameters<NodeCtx2D['drawImage']>[0], 0, 0, w, h)
  return cv
}

// ---------------------------------------------------------------------------
// Load the Honved decal SVGs once
// ---------------------------------------------------------------------------

const keresztTempl = DECAL_TEMPLATES.find((t: { id: string }) => t.id === 'tmpl_honved_kereszt')
const tacNumTempl  = DECAL_TEMPLATES.find((t: { id: string }) => t.id === 'tmpl_honved_tac_number')

if (!keresztTempl || !tacNumTempl) {
  throw new Error('Could not find tmpl_honved_kereszt or tmpl_honved_tac_number in DECAL_TEMPLATES')
}

// Pre-render decal SVGs to node-canvas images (150×150 for Kereszt, 180×90 for tac)
const KERESZT_SIZE = 150
const TAC_W = 180, TAC_H = 90
const keresztCanvas = await svgToCanvas(keresztTempl.svg, KERESZT_SIZE, KERESZT_SIZE)
const tacCanvas     = await svgToCanvas(tacNumTempl.svg, TAC_W, TAC_H)

// ---------------------------------------------------------------------------
// Per-vehicle processing
// ---------------------------------------------------------------------------

interface Result {
  vehicleId: string
  outPath: string
  hasMask: boolean
  hasCanonical: boolean
  skipped: boolean
  error?: string
}

const germanVehicles = (VEHICLES as Array<{ id: string; faction: string; defaultTac: string }>)
  .filter(v => v.faction === 'german')

await mkdir(OUT_DIR, { recursive: true })

const results: Result[] = []

for (const veh of germanVehicles) {
  const id = veh.id
  const canonPath = path.join(CANONICAL_DIR, `german_${id}.png`)
  const maskPath  = path.join(MASK_DIR,      `german_${id}.png`)
  const outPath   = path.join(OUT_DIR, `${id}.png`)

  const hasCanonical = existsSync(canonPath)
  const hasMask      = existsSync(maskPath)

  if (!hasCanonical) {
    console.warn(`[WARN] ${id}: no canonical PNG at ${canonPath} — skipping`)
    results.push({ vehicleId: id, outPath, hasMask, hasCanonical: false, skipped: true,
      error: 'missing canonical PNG' })
    continue
  }

  try {
    // ── Stage A: load stock diffuse ──────────────────────────────────────────
    const vanillaImg = await loadImage(canonPath)
    const W = ATLAS_SIZE, H = ATLAS_SIZE

    // Final composite canvas
    const finalCanvas = createCanvas(W, H)
    const finalCtx = finalCanvas.getContext('2d') as unknown as NodeCtx2D

    // Draw vanilla diffuse as base
    finalCtx.drawImage(vanillaImg as unknown as Parameters<NodeCtx2D['drawImage']>[0], 0, 0, W, H)

    // ── Stage B+C: generate masked Honved camo ───────────────────────────────
    // The camo generator needs HTMLCanvasElement-shaped objects.
    // We provide node-canvas instances (duck-typed).
    const camoCanvas = createCanvas(W, H)

    let maskCanvas: Canvas | null = null
    if (hasMask) {
      const maskImg = await loadImage(maskPath)
      maskCanvas = createCanvas(W, H)
      const mctx = maskCanvas.getContext('2d') as unknown as NodeCtx2D
      mctx.drawImage(maskImg as unknown as Parameters<NodeCtx2D['drawImage']>[0], 0, 0, W, H)
    }

    // generateCamo expects HTMLCanvasElement — node-canvas is compatible.
    generateCamo(
      camoCanvas as unknown as HTMLCanvasElement,
      HONVED_PRESET,
      maskCanvas as unknown as HTMLCanvasElement | null,
    )

    // Composite camo over vanilla (source-over — camo transparent where mask=0)
    finalCtx.globalCompositeOperation = 'source-over'
    finalCtx.drawImage(camoCanvas as unknown as Parameters<NodeCtx2D['drawImage']>[0], 0, 0)

    // ── Stage D+E+F: weathering ──────────────────────────────────────────────
    applyWeathering(finalCtx as unknown as CanvasRenderingContext2D, W, H, HONVED_PRESET.seed)

    // ── Stage G: markings ────────────────────────────────────────────────────
    // Resolve hull-side UV rect for Kereszt placement (registry or default)
    const hullRect = resolveDecalUvRect(id)

    // Stamp Kereszt at hull-right-side rect center
    const kx = hullRect.x + (hullRect.w - KERESZT_SIZE) / 2
    const ky = hullRect.y + (hullRect.h - KERESZT_SIZE) / 2
    finalCtx.globalCompositeOperation = 'source-over'
    finalCtx.globalAlpha = 1
    finalCtx.drawImage(
      keresztCanvas as unknown as Parameters<NodeCtx2D['drawImage']>[0],
      Math.round(kx), Math.round(ky), KERESZT_SIZE, KERESZT_SIZE,
    )

    // Mirror Kereszt to left hull side (mirror the x coordinate)
    // Left hull side: x = W - (hullRect.x + hullRect.w), symmetric placement
    const leftHullX = W - hullRect.x - hullRect.w
    const leftKx = leftHullX + (hullRect.w - KERESZT_SIZE) / 2
    finalCtx.drawImage(
      keresztCanvas as unknown as Parameters<NodeCtx2D['drawImage']>[0],
      Math.round(leftKx), Math.round(ky), KERESZT_SIZE, KERESZT_SIZE,
    )

    // Tactical number — turret/upper band: place at ~30% from top, left-of-center
    // Use DEFAULT_BADGE_RECT.y - TAC_H as turret side approximation when no
    // per-vehicle override exists. For now: upper-left quadrant 10%×(rect.y - 120)
    const tacX = Math.round(W * 0.10)
    const tacY = Math.round(hullRect.y - TAC_H - 20)
    const safeTacY = Math.max(10, tacY)
    finalCtx.drawImage(
      tacCanvas as unknown as Parameters<NodeCtx2D['drawImage']>[0],
      tacX, safeTacY, TAC_W, TAC_H,
    )

    // ── Write PNG ────────────────────────────────────────────────────────────
    const pngBuf = finalCanvas.toBuffer('image/png')
    await writeFile(outPath, pngBuf)

    console.log(`[OK] ${id} → ${path.relative(ROOT, outPath)}${hasMask ? '' : ' [NO MASK — camo covers equipment]'}`)
    results.push({ vehicleId: id, outPath, hasMask, hasCanonical: true, skipped: false })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ERR] ${id}: ${msg}`)
    results.push({ vehicleId: id, outPath, hasMask, hasCanonical: true, skipped: false, error: msg })
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const produced  = results.filter(r => !r.skipped && !r.error)
const noMask    = results.filter(r => !r.hasMask)
const errored   = results.filter(r => r.error)
const skipped   = results.filter(r => r.skipped)

console.log('\n=== Honved Regen Summary ===')
console.log(`German vehicles total : ${germanVehicles.length}`)
console.log(`PNGs produced         : ${produced.length}`)
console.log(`Missing mask (no clip): ${noMask.length}${noMask.length ? ' — ' + noMask.map(r => r.vehicleId).join(', ') : ''}`)
console.log(`Errored               : ${errored.length}${errored.length ? ' — ' + errored.map(r => r.vehicleId + ': ' + r.error).join('; ') : ''}`)
console.log(`Skipped (no canonical): ${skipped.length}${skipped.length ? ' — ' + skipped.map(r => r.vehicleId).join(', ') : ''}`)
console.log(`Output dir            : ${OUT_DIR}`)

// Sample paths for key vehicles
const KEY = ['tiger', 'stug_iii', 'brummbar', 'elefant', 'panzerwerfer']
const foundKeys = KEY.filter(k => produced.find(r => r.vehicleId === k))
if (foundKeys.length) {
  console.log('\nSample output paths:')
  for (const k of foundKeys) {
    console.log(`  ${k}: ${path.join(OUT_DIR, k + '.png')}`)
  }
}

// SGA build headless assessment
console.log('\n=== SGA Build Headless Assessment ===')
console.log('The buildSkinMod pipeline (mod-export.ts:buildSkinMod) requires:')
console.log('  1. rgt-writer.ts:canvasToRgt — uses canvas.toDataURL + pako.deflate → pure Node-compatible')
console.log('  2. sga-writer.ts:buildSga    — pure typed-array, no DOM/GPU required')
console.log('  3. bc-encode.ts              — pure typed-array BC1/BC3 encoder')
console.log('  4. installRoot FileSystemDirectoryHandle — needs OPFS/Electron FS handle for READ')
console.log('     BUT: for write-only (building the SGA from our canvas), we skip the vanilla-read')
console.log('     step (we already have the composited canvas here).')
console.log('VERDICT: SGA build IS headless-capable for the output side.')
console.log('  Blocked only by FileSystemDirectoryHandle for the attrib template files.')
console.log('  The template SGA (tools/templates/template_0001.sga) IS on disk — can open with fs.readFile.')
console.log('  → Headless SGA build is POSSIBLE with a small fs-shim (Blob from readFile).')
console.log('  → Not implemented in this script (out of scope per instructions) but no renderer needed.')
console.log('  → If needed: wrap each readFile buffer in a Blob and pass to SgaArchive.open().')
