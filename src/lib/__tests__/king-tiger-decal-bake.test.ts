/**
 * Tests for king-tiger-decal-bake.ts
 *
 * Verifies the pure-canvas composite logic:
 *   (a) Output canvas is 2048×2048
 *   (b) The decal is drawn as a correctly-sized BADGE centred on the rect's
 *       centre point (P0 fix — was: stretched to fill the entire rect).
 *   (c) The rect's TOP-LEFT corner is NOT painted (badge is smaller than rect).
 *
 * jsdom provides a basic Canvas 2D implementation. We create small
 * stand-in canvases rather than loading the real 2048² assets.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { bakeDecalOntoKingTigerDiffuse, HULL_SIDE_RIGHT_RECT, BADGE_FRACTION } from '../king-tiger-decal-bake'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create an HTMLCanvasElement filled with a solid colour. */
function solidCanvas(width: number, height: number, r: number, g: number, b: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, width, height)
  return c
}

/** Read the RGBA pixel at (x, y) from a canvas. */
function readPixel(canvas: HTMLCanvasElement, x: number, y: number): [number, number, number, number] {
  const ctx = canvas.getContext('2d')!
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bakeDecalOntoKingTigerDiffuse', () => {
  let vanillaCanvas: HTMLCanvasElement
  let decalCanvas: HTMLCanvasElement

  beforeEach(() => {
    // Vanilla diffuse: solid dark grey (60,60,60) 2048×2048
    vanillaCanvas = solidCanvas(2048, 2048, 60, 60, 60)
    // Decal: solid bright red (255,0,0) 128×128
    decalCanvas = solidCanvas(128, 128, 255, 0, 0)
  })

  it('(a) output canvas is 2048×2048', async () => {
    const result = await bakeDecalOntoKingTigerDiffuse(vanillaCanvas, decalCanvas)
    expect(result.width).toBe(2048)
    expect(result.height).toBe(2048)
  })

  // P0 fix: decal is now drawn as a badge centred on the rect, NOT stretched to fill it.
  // KT rect: {x:410, y:1320, w:360, h:340}. Centre = (590, 1490).
  // Badge size: BADGE_FRACTION × 360 ≈ 112 px (aspect 1:1 for a square 128×128 decal).
  // Badge bounds: x≈534..646, y≈1434..1546.
  // Sampling the CENTRE of the rect should be inside the badge.
  it('(b) decal is drawn as a badge centred on the rect (P0 fix: badge-sized, not fill-the-rect)', async () => {
    const result = await bakeDecalOntoKingTigerDiffuse(vanillaCanvas, decalCanvas)

    // Centre of the KT hullSideRight rect — always inside the badge
    const cx = Math.round(HULL_SIDE_RIGHT_RECT.x + HULL_SIDE_RIGHT_RECT.w / 2)
    const cy = Math.round(HULL_SIDE_RIGHT_RECT.y + HULL_SIDE_RIGHT_RECT.h / 2)
    const centrePixel = readPixel(result, cx, cy)
    // Decal red should dominate at the badge centre
    expect(centrePixel[0]).toBeGreaterThan(200)  // R high
    expect(centrePixel[1]).toBeLessThan(50)       // G low
    expect(centrePixel[2]).toBeLessThan(50)       // B low
    expect(centrePixel[3]).toBe(255)              // fully opaque
  })

  // P0 fix: the top-left corner of the rect should NOT be painted — the badge is smaller.
  it('(c) rect top-left corner is vanilla (badge does not fill the entire rect)', async () => {
    const result = await bakeDecalOntoKingTigerDiffuse(vanillaCanvas, decalCanvas)

    // Top-left of hullSideRight rect: (410, 1320).
    // Badge starts at ~(534,1434) — well inside the rect — so (410,1320) stays vanilla grey.
    const cornerPixel = readPixel(result, HULL_SIDE_RIGHT_RECT.x + 5, HULL_SIDE_RIGHT_RECT.y + 5)
    expect(cornerPixel[0]).toBeCloseTo(60, 0)  // vanilla grey, not red
    expect(cornerPixel[1]).toBeCloseTo(60, 0)
    expect(cornerPixel[2]).toBeCloseTo(60, 0)
  })

  it('(b) pixels well outside the rect retain the vanilla colour', async () => {
    const result = await bakeDecalOntoKingTigerDiffuse(vanillaCanvas, decalCanvas)

    // Sample a pixel far from hullSideRight — x=100, y=100
    const outsidePixel = readPixel(result, 100, 100)
    // Should still be the vanilla dark grey
    expect(outsidePixel[0]).toBeCloseTo(60, 0)
    expect(outsidePixel[1]).toBeCloseTo(60, 0)
    expect(outsidePixel[2]).toBeCloseTo(60, 0)
  })

  it('HULL_SIDE_RIGHT_RECT exports the correct pixel rect from the JSON (Wikinger ground truth)', () => {
    // Updated to Wikinger OKW skin ground truth: cross+number zone confirmed visually.
    // Previous hand-authored value {896,1152,512,512} was incorrect per Wikinger evidence.
    expect(HULL_SIDE_RIGHT_RECT).toMatchObject({
      x: 410,
      y: 1320,
      w: 360,
      h: 340,
    })
  })

  it('BADGE_FRACTION constant is exported and equals 0.31', () => {
    expect(BADGE_FRACTION).toBe(0.31)
  })
})
