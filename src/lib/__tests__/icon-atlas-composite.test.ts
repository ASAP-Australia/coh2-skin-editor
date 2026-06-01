/**
 * Unit tests for compositeIconAtlas.
 *
 * Pixel round-trip tests exercise the full pipeline:
 *   template DDS (sentinel colour) → compositeIconAtlas → decode → pixel sample
 *
 * Environment notes:
 *   - jsdom does NOT provide `ImageData` as a global constructor; we polyfill
 *     it with canvas package's `ImageData` (same approach as rgt-roundtrip.test.ts).
 *   - jsdom's `HTMLImageElement.onload` does NOT fire for data: URLs; we
 *     polyfill `globalThis.Image` with node-canvas's Image class, which does
 *     fire onload (same approach as end-to-end-claude-produced-mods.test.ts).
 *   - `document.createElement('canvas')` DOES work in jsdom when node-canvas
 *     is installed, so no polyfill is needed for canvas itself.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { compositeIconAtlas, ATLAS_W, ATLAS_H, SLOT_RECTS_FOR_TEST } from '../icon-atlas-composite'
import { encodeBc3 } from '../bc-encode'
import { wrapBc3InDds } from '../faceplate-mod-build'
import { decodeBc3 } from '../bc-decode'
import type { ExportSlot } from '../project'

// ── Polyfills (scoped to this test file) ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCanvas = require('canvas') as typeof import('canvas')

let _savedImage: typeof globalThis.Image | undefined
let _savedImageData: unknown

beforeAll(() => {
  // 1. Polyfill globalThis.Image with node-canvas's Image so that
  //    `new Image(); img.onload = ...; img.src = dataUrl` fires correctly.
  _savedImage = globalThis.Image
  ;(globalThis as unknown as Record<string, unknown>).Image =
    nodeCanvas.Image as unknown as typeof Image

  // 2. Polyfill globalThis.ImageData with canvas package's ImageData.
  //    jsdom does not expose ImageData as a constructor; the production code's
  //    `new ImageData(data, w, h)` call would throw without this.
  _savedImageData = (globalThis as unknown as Record<string, unknown>).ImageData
  ;(globalThis as unknown as Record<string, unknown>).ImageData =
    nodeCanvas.ImageData as unknown
})

afterAll(() => {
  if (_savedImage) {
    ;(globalThis as unknown as Record<string, unknown>).Image = _savedImage
  }
  ;(globalThis as unknown as Record<string, unknown>).ImageData = _savedImageData
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlot(
  season: 'summer' | 'winter',
  slotIdx: number,
  slotIcon: string | null = null,
): ExportSlot {
  return {
    id: `${season}-${slotIdx}`,
    season,
    slotIdx,
    label: `Test ${season} ${slotIdx}`,
    state: { vehicles: {}, factionDefaults: {} },
    factions: [],
    slotIcon,
  }
}

/** Build a synthetic 1008×384 DXT5 DDS filled with a solid RGBA colour. */
function makeSolidDds(r: number, g: number, b: number, a = 255): Uint8Array {
  const rgba = new Uint8ClampedArray(ATLAS_W * ATLAS_H * 4)
  for (let i = 0; i < ATLAS_W * ATLAS_H; i++) {
    rgba[i * 4 + 0] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = a
  }
  const bc3 = encodeBc3(rgba, ATLAS_W, ATLAS_H)
  return wrapBc3InDds(bc3, ATLAS_W, ATLAS_H)
}

/** Build a 256×256 solid-colour PNG data URL via node-canvas. */
function solidPngDataUrl(r: number, g: number, b: number): string {
  const c = nodeCanvas.createCanvas(256, 256)
  const ctx = c.getContext('2d')
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, 256, 256)
  return c.toDataURL('image/png')
}

/** Decode a DDS produced by compositeIconAtlas back to RGBA. */
function decodeDds(dds: Uint8Array): Uint8ClampedArray {
  if (dds.length < 128) throw new Error('DDS too short')
  const payload = dds.slice(128)
  return decodeBc3(payload, ATLAS_W, ATLAS_H)
}

/** Read RGBA at pixel (x, y) from a flat ATLAS_W×ATLAS_H RGBA buffer. */
function readPixel(rgba: Uint8ClampedArray, x: number, y: number): [number, number, number, number] {
  const idx = (y * ATLAS_W + x) * 4
  return [rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]]
}

/** Assert a channel is within ±tol of expected (BC3 is lossy). */
function approx(actual: number, expected: number, tol = 40): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol)
}

describe('compositeIconAtlas', () => {
  it('throws (not silently corrupts) when given a non-DXT5 DDS', async () => {
    const badDds = new Uint8Array(256).fill(0)
    const slots: ExportSlot[] = [
      makeSlot('summer', 0, 'data:image/png;base64,abc'),
      makeSlot('summer', 1, null),
      makeSlot('summer', 2, null),
      makeSlot('winter', 0, null),
      makeSlot('winter', 1, null),
      makeSlot('winter', 2, null),
    ]
    await expect(compositeIconAtlas(badDds, slots)).rejects.toThrow('DXT5')
  })
})

describe('SLOT_RECTS_FOR_TEST — atlas rect table', () => {
  it('has exactly 6 entries', () => {
    expect(SLOT_RECTS_FOR_TEST).toHaveLength(6)
  })

  it('all portrait rects fit within the 1008×384 atlas', () => {
    for (const { portrait: [x, y, w, h] } of SLOT_RECTS_FOR_TEST) {
      expect(x + w).toBeLessThanOrEqual(ATLAS_W)
      expect(y + h).toBeLessThanOrEqual(ATLAS_H)
    }
  })

  it('all standard rects fit within the 1008×384 atlas', () => {
    for (const { standard: [x, y, w, h] } of SLOT_RECTS_FOR_TEST) {
      expect(x + w).toBeLessThanOrEqual(ATLAS_W)
      expect(y + h).toBeLessThanOrEqual(ATLAS_H)
    }
  })

  it('slot 0 (summer/light) standard rect matches design doc (x=504 y=192 w=64 h=64)', () => {
    expect(SLOT_RECTS_FOR_TEST[0].standard).toEqual([504, 192, 64, 64])
  })

  it('slot 0 (summer/light) portrait rect matches design doc (x=504 y=0 w=250 h=190)', () => {
    expect(SLOT_RECTS_FOR_TEST[0].portrait).toEqual([504, 0, 250, 190])
  })

  it('slot 5 (winter/heavy) standard rect matches design doc (x=768 y=192 w=64 h=64)', () => {
    expect(SLOT_RECTS_FOR_TEST[5].standard).toEqual([768, 192, 64, 64])
  })
})

// ── Pixel round-trip tests ────────────────────────────────────────────────────
//
// Strategy:
//   • Template DDS: 1008×384, solid MAGENTA (255,0,255) — the sentinel colour.
//   • One slot (summer/medium = atlas index 1) gets a solid GREEN (0,255,0)
//     256×256 PNG data URL as its slotIcon. All others have no icon.
//   • After compositeIconAtlas we decode the output DDS and sample pixels.
//   • ASSERT green at the center of the customised slot's standard and portrait
//     rects; assert sentinel magenta at the center of an untouched slot's rect.
//   • Tolerance ±40 per channel to accommodate BC3 lossy compression.

describe('compositeIconAtlas — pixel round-trip', () => {
  // Slot 1 (summer/medium): portrait [252,192,250,190], standard [702,192,64,64]
  // Slot 5 (winter/heavy):  portrait [756,0,250,190],   standard [768,192,64,64]

  it('GREEN icon lands in the correct standard rect (slot 1, summer/medium)', async () => {
    const MAGENTA = { r: 255, g: 0, b: 255 }
    const GREEN = { r: 0, g: 255, b: 0 }

    const templateDds = makeSolidDds(MAGENTA.r, MAGENTA.g, MAGENTA.b)
    const greenPng = solidPngDataUrl(GREEN.r, GREEN.g, GREEN.b)

    const slots: ExportSlot[] = [
      makeSlot('summer', 0),
      makeSlot('summer', 1, greenPng),  // atlas index 1 → standard [702,192,64,64]
      makeSlot('summer', 2),
      makeSlot('winter', 0),
      makeSlot('winter', 1),
      makeSlot('winter', 2),
    ]

    const resultDds = await compositeIconAtlas(templateDds, slots)
    const rgba = decodeDds(resultDds)

    // Center of slot 1 standard rect: x=702+32=734, y=192+32=224
    const [r, g, b] = readPixel(rgba, 734, 224)
    approx(r, GREEN.r)       // red channel ≈ 0
    approx(g, GREEN.g, 30)   // green channel ≈ 255 (dominant)
    approx(b, GREEN.b)       // blue channel ≈ 0
    expect(g).toBeGreaterThan(r + 80)  // green clearly dominant over red
    expect(g).toBeGreaterThan(b + 80)  // green clearly dominant over blue
  }, 30_000)

  it('GREEN icon lands in the correct portrait rect (slot 1, summer/medium)', async () => {
    const MAGENTA = { r: 255, g: 0, b: 255 }
    const GREEN = { r: 0, g: 255, b: 0 }

    const templateDds = makeSolidDds(MAGENTA.r, MAGENTA.g, MAGENTA.b)
    const greenPng = solidPngDataUrl(GREEN.r, GREEN.g, GREEN.b)

    const slots: ExportSlot[] = [
      makeSlot('summer', 0),
      makeSlot('summer', 1, greenPng),  // atlas index 1 → portrait [252,192,250,190]
      makeSlot('summer', 2),
      makeSlot('winter', 0),
      makeSlot('winter', 1),
      makeSlot('winter', 2),
    ]

    const resultDds = await compositeIconAtlas(templateDds, slots)
    const rgba = decodeDds(resultDds)

    // Center of slot 1 portrait rect: x=252+125=377, y=192+95=287
    const [r, g, b] = readPixel(rgba, 377, 287)
    approx(r, GREEN.r)
    approx(g, GREEN.g, 30)
    approx(b, GREEN.b)
    expect(g).toBeGreaterThan(r + 80)
    expect(g).toBeGreaterThan(b + 80)
  }, 30_000)

  it('un-customised slot retains the SENTINEL colour (slot 5, winter/heavy standard)', async () => {
    const MAGENTA = { r: 255, g: 0, b: 255 }
    const GREEN = { r: 0, g: 255, b: 0 }

    const templateDds = makeSolidDds(MAGENTA.r, MAGENTA.g, MAGENTA.b)
    const greenPng = solidPngDataUrl(GREEN.r, GREEN.g, GREEN.b)

    const slots: ExportSlot[] = [
      makeSlot('summer', 0),
      makeSlot('summer', 1, greenPng),
      makeSlot('summer', 2),
      makeSlot('winter', 0),
      makeSlot('winter', 1),
      makeSlot('winter', 2),  // atlas index 5 → standard [768,192,64,64] — no icon
    ]

    const resultDds = await compositeIconAtlas(templateDds, slots)
    const rgba = decodeDds(resultDds)

    // Center of slot 5 standard rect: x=768+32=800, y=192+32=224
    const [r, g, b] = readPixel(rgba, 800, 224)
    approx(r, MAGENTA.r, 30)  // red ≈ 255
    approx(g, MAGENTA.g, 30)  // green ≈ 0
    approx(b, MAGENTA.b, 30)  // blue ≈ 255
    expect(r).toBeGreaterThan(g + 80)  // sentinel red dominant over green
    expect(b).toBeGreaterThan(g + 80)  // sentinel blue dominant over green
  }, 30_000)
})
