/**
 * Tests for king-tiger-decal-bake.ts
 *
 * Verifies the pure-canvas composite logic:
 *   (a) Output canvas is 2048×2048
 *   (b) The decal is drawn into the expected pixel rect (hullSideRight)
 *
 * jsdom provides a basic Canvas 2D implementation. We create small
 * stand-in canvases rather than loading the real 2048² assets.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { bakeDecalOntoKingTigerDiffuse, HULL_SIDE_RIGHT_RECT } from '../king-tiger-decal-bake'

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

  it('(b) decal is drawn at the hullSideRight pixel rect', async () => {
    const result = await bakeDecalOntoKingTigerDiffuse(vanillaCanvas, decalCanvas)

    // Sample a pixel inside the decal zone — should be the decal's red colour
    const { x, y } = HULL_SIDE_RIGHT_RECT
    const insidePixel = readPixel(result, x + 10, y + 10)
    // Red channel should be dominant (decal red overlaid on grey base)
    expect(insidePixel[0]).toBeGreaterThan(200)  // R high
    expect(insidePixel[1]).toBeLessThan(50)       // G low
    expect(insidePixel[2]).toBeLessThan(50)       // B low
    expect(insidePixel[3]).toBe(255)              // fully opaque
  })

  it('(b) pixels OUTSIDE the decal zone retain the vanilla colour', async () => {
    const result = await bakeDecalOntoKingTigerDiffuse(vanillaCanvas, decalCanvas)

    // Sample a pixel well outside the hullSideRight zone
    // hullSideRight is at x=896,y=1152,w=512,h=512 — pick x=100, y=100
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
})
