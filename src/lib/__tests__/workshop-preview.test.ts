/**
 * Unit tests for workshop-preview.ts helpers.
 *
 * `findOpaqueBbox` and `cropToOpaqueBbox` are DOM-level helpers that work on
 * HTMLCanvasElement (jsdom + node-canvas). `generateWorkshopPreview` requires
 * OffscreenCanvas.convertToBlob which is not available in jsdom, so it is not
 * tested here — the bbox helpers that power it are tested instead.
 */

import { describe, it, expect } from 'vitest'
import { findOpaqueBbox, cropToOpaqueBbox } from '../workshop-preview'

// ── Canvas test helpers ───────────────────────────────────────────────────────

/** Create an HTMLCanvasElement filled entirely with transparent pixels. */
function makeBlankCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  // jsdom default: fully transparent, no need to clearRect.
  return c
}

/**
 * Paint a rectangle of solid opaque colour into a canvas.
 * Returns the canvas for chaining.
 */
function paintRect(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  color = '#ff0000',
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
  return canvas
}

// ── findOpaqueBbox ────────────────────────────────────────────────────────────

describe('findOpaqueBbox', () => {
  it('returns null for a fully transparent canvas', () => {
    const c = makeBlankCanvas(64, 64)
    expect(findOpaqueBbox(c)).toBeNull()
  })

  it('returns null when opaque pixels fill the entire canvas', () => {
    const c = makeBlankCanvas(32, 32)
    paintRect(c, 0, 0, 32, 32)
    expect(findOpaqueBbox(c)).toBeNull()
  })

  it('finds bbox for a small rect in the centre of a larger canvas', () => {
    // 200×200 canvas, opaque rect at (80, 60, 40, 30)
    const c = makeBlankCanvas(200, 200)
    paintRect(c, 80, 60, 40, 30)
    const bbox = findOpaqueBbox(c)
    expect(bbox).not.toBeNull()
    expect(bbox!.x).toBe(80)
    expect(bbox!.y).toBe(60)
    expect(bbox!.w).toBe(40)
    expect(bbox!.h).toBe(30)
  })

  it('finds bbox for pixels touching the top-left corner', () => {
    const c = makeBlankCanvas(100, 100)
    paintRect(c, 0, 0, 20, 20)
    const bbox = findOpaqueBbox(c)
    // Top-left fills from (0,0) with size 20×20 — that's not the full canvas.
    expect(bbox).not.toBeNull()
    expect(bbox!.x).toBe(0)
    expect(bbox!.y).toBe(0)
    expect(bbox!.w).toBe(20)
    expect(bbox!.h).toBe(20)
  })

  it('finds bbox for scattered individual pixels', () => {
    const c = makeBlankCanvas(100, 100)
    // Paint single pixels at (10,10) and (90,80)
    paintRect(c, 10, 10, 1, 1)
    paintRect(c, 90, 80, 1, 1)
    const bbox = findOpaqueBbox(c)
    expect(bbox).not.toBeNull()
    expect(bbox!.x).toBe(10)
    expect(bbox!.y).toBe(10)
    expect(bbox!.w).toBe(81)  // 90 - 10 + 1
    expect(bbox!.h).toBe(71)  // 80 - 10 + 1
  })
})

// ── cropToOpaqueBbox ──────────────────────────────────────────────────────────

describe('cropToOpaqueBbox', () => {
  it('returns the original canvas when fully transparent (no crop)', () => {
    const c = makeBlankCanvas(128, 128)
    const result = cropToOpaqueBbox(c)
    expect(result).toBe(c)
  })

  it('returns the original canvas when opaque pixels fill the entire area', () => {
    const c = makeBlankCanvas(64, 64)
    paintRect(c, 0, 0, 64, 64)
    const result = cropToOpaqueBbox(c)
    expect(result).toBe(c)
  })

  it('crops to the opaque region and the output has the correct dimensions', () => {
    // 500×500 canvas with art only at (100, 150, 200, 100)
    const c = makeBlankCanvas(500, 500)
    paintRect(c, 100, 150, 200, 100)
    const result = cropToOpaqueBbox(c)
    expect(result).not.toBe(c)
    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
  })

  it('simulates the decal double-padding scenario: cropped output fills more of a 1024px canvas', () => {
    // Simulate a 128×128 rasteriseDecal output where the art is a 40×30 rect
    // centered at (44,49) — i.e. small art in a large transparent canvas.
    const rendered = makeBlankCanvas(128, 128)
    paintRect(rendered, 44, 49, 40, 30)

    const cropped = cropToOpaqueBbox(rendered)
    // Cropped should be 40×30 (just the art).
    expect(cropped.width).toBe(40)
    expect(cropped.height).toBe(30)

    // Verify that the 1024×1024 preview would fill at least 80% of one axis.
    // With 10% padding: maxDim = 1024 * 0.8 = 819.2
    // scale = 819.2 / max(40, 30) = 819.2 / 40 = 20.48
    // dstW = 40 * 20.48 = 819, dstH = 30 * 20.48 = 614
    // Ratio of dstW to 1024 = ~80%
    const PREVIEW_SIZE = 1024
    const PAD = PREVIEW_SIZE * 0.1
    const maxDim = PREVIEW_SIZE - PAD * 2
    const scale = Math.min(maxDim / cropped.width, maxDim / cropped.height)
    const dstLonger = Math.max(cropped.width, cropped.height) * scale
    expect(dstLonger / PREVIEW_SIZE).toBeGreaterThanOrEqual(0.8)
  })
})
