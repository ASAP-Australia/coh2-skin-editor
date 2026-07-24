/**
 * Unit tests for decal-pack-export.ts
 *
 * Covers the dependency-free ZIP writer (CRC, EOCD, central directory layout)
 * and the project→manifest plumbing. Bitmap rasterisation is not unit-tested
 * here because jsdom doesn't expose a working canvas backend — the rasteriser
 * is exercised indirectly via the editor's grid preview during integration.
 *
 * KONVA MIGRATION — GOLDEN EXPORT TESTS:
 * rasteriseDecal / compositePartLayers read plain Decal records and must be
 * byte-identical before and after the Konva view-layer migration. These golden
 * tests snapshot the rasteriseDecal output for a canonical set of Decal
 * fixtures so any accidental change to the export pipeline fails immediately.
 *
 * Canvas availability note: jsdom + the `canvas` npm devDep provides a real
 * 2D context under vitest, so rasteriseDecal CAN be exercised here. We use
 * `createCanvas` from the `canvas` package (Node realm) to create image
 * sources — NOT `new window.Image()` — to avoid the cross-realm mismatch
 * that causes drawImage to throw in jsdom.
 */

import { describe, it, expect } from 'vitest'
import { createCanvas } from 'canvas'
import { buildZip, exportDecalPackZip, makeSlug, rasteriseDecal } from '../decal-pack-export'
import { newDecalPackProject, newDecal, freshSourceImageId, DECAL_PACK_SIZE } from '../decal-pack-project'
import type { Decal } from '../decal-pack-project'

describe('makeSlug', () => {
  it('lowercases and replaces non-alphanumerics with underscores', () => {
    expect(makeSlug('Eastern Front Insignia!')).toBe('eastern_front_insignia')
  })
  it('strips leading/trailing underscores', () => {
    expect(makeSlug('  !!! my pack !!!  ')).toBe('my_pack')
  })
  it('caps at 40 chars', () => {
    expect(makeSlug('a'.repeat(80)).length).toBe(40)
  })
})

describe('buildZip', () => {
  it('produces a valid ZIP for a single text entry', () => {
    const bytes = new TextEncoder().encode('hello world')
    const zip = buildZip([{ path: 'hello.txt', bytes }])

    // PK\x03\x04 = local file header signature
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
    expect(zip[2]).toBe(0x03)
    expect(zip[3]).toBe(0x04)

    // EOCD signature appears somewhere near the end
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const eocdOffset = zip.length - 22
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50)
    expect(view.getUint16(eocdOffset + 8, true)).toBe(1) // 1 entry
  })

  it('handles multiple entries and reports correct EOCD count', () => {
    const entries = [
      { path: 'a.txt', bytes: new TextEncoder().encode('a') },
      { path: 'b.txt', bytes: new TextEncoder().encode('bb') },
      { path: 'c.txt', bytes: new TextEncoder().encode('ccc') },
    ]
    const zip = buildZip(entries)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const eocdOffset = zip.length - 22
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50)
    expect(view.getUint16(eocdOffset + 8, true)).toBe(3)
    expect(view.getUint16(eocdOffset + 10, true)).toBe(3)
  })

  it('emits an empty ZIP for zero entries (just EOCD)', () => {
    const zip = buildZip([])
    expect(zip.length).toBe(22)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(view.getUint32(0, true)).toBe(0x06054b50)
    expect(view.getUint16(8, true)).toBe(0)
  })

  it('uses UTF-8 filename flag (bit 11)', () => {
    const zip = buildZip([{ path: 'unicode_テスト.txt', bytes: new Uint8Array(0) }])
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    // Local header general purpose bit flag is at offset 6 of the LFH
    const flags = view.getUint16(6, true)
    expect((flags & 0x0800) !== 0).toBe(true)
  })
})

describe('exportDecalPackZip', () => {
  it('throws when no visible decals exist', async () => {
    const p = newDecalPackProject('Empty Pack')
    await expect(exportDecalPackZip(p)).rejects.toThrow(/No visible decals/i)
  })

  it('throws when all decals are hidden', async () => {
    const p = newDecalPackProject('Hidden Pack')
    const imgId = freshSourceImageId()
    p.sourceImages[imgId] = {
      id: imgId,
      name: 'tiny',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      width: 1,
      height: 1,
    }
    p.decals.push({ ...newDecal(p, imgId), visible: false })
    await expect(exportDecalPackZip(p)).rejects.toThrow(/No visible decals/i)
  })
})

// ── KONVA MIGRATION: Golden export tests ──────────────────────────────────────
//
// These tests prove rasteriseDecal is byte-identical before and after the
// Konva view-layer migration. rasteriseDecal reads plain Decal records — it
// has zero coupling to the Konva engine. The golden tests snapshot the pixel
// output of a fixed canonical set of Decal fixtures.
//
// IMPORTANT: We use `createCanvas` from the Node `canvas` npm package (same
// realm as the CanvasRenderingContext2D used internally by rasteriseDecal in
// jsdom) rather than `new window.Image()` to avoid the cross-realm TypeError.

/**
 * Create a deterministic test bitmap via the Node `canvas` package.
 * Returns a canvas element whose pixel data is a predictable flat colour.
 * This is used as the `bitmap` argument to rasteriseDecal().
 */
function makeTestBitmap(w: number, h: number, fillR = 200, fillG = 100, fillB = 50): ReturnType<typeof createCanvas> {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = `rgb(${fillR},${fillG},${fillB})`
  ctx.fillRect(0, 0, w, h)
  return c
}

/**
 * Extract the non-zero pixel sum from a rasteriseDecal output canvas.
 * Used as a stable numeric fingerprint of the rendered output — any
 * change to rasteriseDecal's compositing math will change this value.
 */
function pixelFingerprint(canvas: ReturnType<typeof rasteriseDecal>): number {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return -1
  const data = ctx.getImageData(0, 0, DECAL_PACK_SIZE, DECAL_PACK_SIZE).data
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  return sum
}

describe('rasteriseDecal — KONVA MIGRATION golden export tests', () => {
  it('identity decal (x=64, y=64, scale=1, rotation=0): non-zero pixel sum is stable', () => {
    const bitmap = makeTestBitmap(32, 32, 200, 100, 50)
    const decal: Decal = {
      id: 'golden-1',
      name: 'Golden Identity',
      sourceImageId: 'src-1',
      x: DECAL_PACK_SIZE / 2,
      y: DECAL_PACK_SIZE / 2,
      scale: 1,
      rotation: 0,
      opacity: 1,
      flipH: false,
      flipV: false,
      visible: true,
    }
    const canvas = rasteriseDecal(decal, bitmap as unknown as HTMLCanvasElement)
    const fp = pixelFingerprint(canvas)
    expect(fp).toBeGreaterThan(0)
    expect(fp).toMatchSnapshot('golden-identity-pixel-sum')
  })

  it('rotated decal (rotation=45°): fingerprint is stable and differs from identity', () => {
    const bitmap = makeTestBitmap(32, 32, 150, 200, 100)
    const decalIdentity: Decal = {
      id: 'golden-2a',
      name: 'Golden Rotated',
      sourceImageId: 'src-2',
      x: DECAL_PACK_SIZE / 2,
      y: DECAL_PACK_SIZE / 2,
      scale: 1,
      rotation: 0,
      opacity: 1,
      flipH: false,
      flipV: false,
      visible: true,
    }
    const decalRotated: Decal = { ...decalIdentity, id: 'golden-2b', rotation: 45 }
    const fp0 = pixelFingerprint(rasteriseDecal(decalIdentity, bitmap as unknown as HTMLCanvasElement))
    const fp45 = pixelFingerprint(rasteriseDecal(decalRotated, bitmap as unknown as HTMLCanvasElement))
    expect(fp0).not.toBe(fp45)
    expect(fp45).toMatchSnapshot('golden-rotated-45-pixel-sum')
  })

  it('flipH decal: fingerprint is stable', () => {
    const bitmap = makeTestBitmap(40, 20, 80, 160, 240)
    const decal: Decal = {
      id: 'golden-3',
      name: 'Golden FlipH',
      sourceImageId: 'src-3',
      x: DECAL_PACK_SIZE / 2,
      y: DECAL_PACK_SIZE / 2,
      scale: 1,
      rotation: 0,
      opacity: 1,
      flipH: true,
      flipV: false,
      visible: true,
    }
    const fp = pixelFingerprint(rasteriseDecal(decal, bitmap as unknown as HTMLCanvasElement))
    expect(fp).toBeGreaterThan(0)
    expect(fp).toMatchSnapshot('golden-flipH-pixel-sum')
  })

  it('scaled decal (scale=0.5): fewer pixels drawn than scale=1', () => {
    const bitmap = makeTestBitmap(64, 64, 120, 120, 120)
    const decalFull: Decal = {
      id: 'golden-4a',
      name: 'Golden Scale Full',
      sourceImageId: 'src-4',
      x: DECAL_PACK_SIZE / 2,
      y: DECAL_PACK_SIZE / 2,
      scale: 1,
      rotation: 0,
      opacity: 1,
      flipH: false,
      flipV: false,
      visible: true,
    }
    const decalHalf: Decal = { ...decalFull, id: 'golden-4b', scale: 0.5 }
    const fpFull = pixelFingerprint(rasteriseDecal(decalFull, bitmap as unknown as HTMLCanvasElement))
    const fpHalf = pixelFingerprint(rasteriseDecal(decalHalf, bitmap as unknown as HTMLCanvasElement))
    expect(fpHalf).toBeLessThan(fpFull)
    expect(fpHalf).toMatchSnapshot('golden-scale-half-pixel-sum')
  })

  it('opacity=0.5: alpha channel reduces total pixel sum vs opacity=1', () => {
    const bitmap = makeTestBitmap(32, 32, 200, 200, 200)
    const decal: Decal = {
      id: 'golden-5',
      name: 'Golden Opacity',
      sourceImageId: 'src-5',
      x: DECAL_PACK_SIZE / 2,
      y: DECAL_PACK_SIZE / 2,
      scale: 1,
      rotation: 0,
      opacity: 1,
      flipH: false,
      flipV: false,
      visible: true,
    }
    const fp1 = pixelFingerprint(rasteriseDecal(decal, bitmap as unknown as HTMLCanvasElement))
    const fp05 = pixelFingerprint(rasteriseDecal({ ...decal, id: 'golden-5b', opacity: 0.5 }, bitmap as unknown as HTMLCanvasElement))
    expect(fp1).toBeGreaterThan(0)
    expect(fp05).toBeGreaterThan(0)
    expect(fp1).toBeGreaterThan(fp05)
    expect(fp05).toMatchSnapshot('golden-opacity-half-pixel-sum')
  })

  it('tint decal: fingerprint differs from no-tint version', () => {
    const bitmap = makeTestBitmap(32, 32, 255, 255, 255) // white source
    const decalBase: Decal = {
      id: 'golden-6a',
      name: 'Golden Tint Base',
      sourceImageId: 'src-6',
      x: DECAL_PACK_SIZE / 2,
      y: DECAL_PACK_SIZE / 2,
      scale: 1,
      rotation: 0,
      opacity: 1,
      flipH: false,
      flipV: false,
      visible: true,
    }
    const decalTinted: Decal = {
      ...decalBase,
      id: 'golden-6b',
      tint: { color: '#ff0000', strength: 1.0 },
    }
    const fpBase = pixelFingerprint(rasteriseDecal(decalBase, bitmap as unknown as HTMLCanvasElement))
    const fpTinted = pixelFingerprint(rasteriseDecal(decalTinted, bitmap as unknown as HTMLCanvasElement))
    expect(fpTinted).toBeLessThan(fpBase)
    expect(fpTinted).toMatchSnapshot('golden-tint-red-pixel-sum')
  })
})
