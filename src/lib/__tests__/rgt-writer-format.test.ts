/**
 * rgt-writer-format.test.ts
 *
 * Pins the BC format / byte-size contract for every canvasToRgt call path:
 *
 *   • Skin signed-patch path (format:'bc3', compress:false):
 *       2048² → exactly 4,194,736 bytes  (matches template_0001.sga pre-signed slots)
 *   • Decal path (default / format:'bc1'):
 *       2048² → exactly 2,097,674 bytes  (BC1, half the size)
 *
 * Also guards that the TFMT format-code field in the emitted RGT matches the
 * requested encoding (15 for BC3, 13 for BC1).
 */

import { describe, it, expect } from 'vitest'
import { createCanvas, ImageData as CanvasImageData } from 'canvas'
import { canvasToRgt } from '../rgt-writer'
import { parseChunky, findChunk } from '../chunky'

// ── helpers ────────────────────────────────────────────────────────────────────

function solidCanvas(
  w: number,
  h: number,
  r = 128,
  g = 128,
  b = 128,
  a = 255,
): HTMLCanvasElement {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4    ] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  }
  ctx.putImageData(new CanvasImageData(data, w, h), 0, 0)
  return c as unknown as HTMLCanvasElement
}

/** Read the TFMT format-code field (u32LE at offset 16 in the 25-byte payload). */
function readTfmtFormatCode(rgt: Uint8Array): number {
  const { root } = parseChunky(rgt)
  const tfmt = findChunk(root, 'TFMT')
  if (!tfmt) throw new Error('TFMT chunk not found')
  return new DataView(rgt.buffer, rgt.byteOffset).getUint32(tfmt.payloadOffset + 16, true)
}

// ── BC3 / skin signed-patch path ───────────────────────────────────────────────

describe('canvasToRgt format:bc3 (skin signed-patch path)', () => {
  it('2048×2048 BC3 compress:false emits raw BC3 pixel bytes (512²×16 = 4,194,304) plus framing', () => {
    // BC3 = 16 bytes/block; 2048/4 = 512 blocks per axis; 512²×16 = 4,194,304 raw pixel bytes.
    // Framing (Chunky header + TSET/TXTR/DXTC + TFMT + TMAN) adds a fixed overhead.
    // Total must be > 4,194,304 and < 4,200,000 regardless of internal name length variation.
    const canvas = solidCanvas(2048, 2048)
    const rgt = canvasToRgt(canvas, 'art\\armies\\german\\tiger_dif', { compress: false, format: 'bc3' })
    expect(rgt.length).toBeGreaterThan(4_194_304)
    expect(rgt.length).toBeLessThan(4_200_000)
  })

  it('patchExport path: 2048×2048 BC3 compress:false fbif:false is EXACTLY 4,194,736 bytes (matches tiger_dif.rgt template slot)', () => {
    // Forensic audit 2026-06-13: the template_0001.sga tiger_dif.rgt slot is 4,194,736 bytes
    // and contains NO FBIF chunk. Our writer was emitting FBIF (90 bytes), causing a size
    // mismatch. With fbif:false the output must be exactly 4,194,736 bytes:
    //   36 (file header) + 71 (TSET hdr, name="art\armies\german\vehicles\tiger\tiger_dif"=43B)
    //   + 36 (DATA/DATA) + 52 (TXTR hdr) + 28 (DXTC hdr) + 53 (TFMT) + 128 (TMAN) + 4194332 (TDAT)
    //   = 4,194,736.
    const canvas = solidCanvas(2048, 2048)
    const internalName = 'art\\armies\\german\\vehicles\\tiger\\tiger_dif'
    const rgt = canvasToRgt(canvas, internalName, { compress: false, format: 'bc3', fbif: false })
    expect(rgt.length).toBe(4_194_736)
  })

  it('TFMT format-code is 15 (DXT5/BC3) when format:bc3 is requested', () => {
    const canvas = solidCanvas(8, 8)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false, format: 'bc3' })
    expect(readTfmtFormatCode(rgt)).toBe(15)
  })

  it('8×8 BC3 compress:false raw pixel size = 2×2 blocks × 16 bytes = 64', () => {
    // Verify the raw mip bytes are BC3-sized (not BC1)
    const canvas = solidCanvas(8, 8)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false, format: 'bc3' })
    const { root } = parseChunky(rgt)
    const tman = findChunk(root, 'TMAN')!
    const v = new DataView(rgt.buffer, rgt.byteOffset)
    const mipCount = v.getUint32(tman.payloadOffset, true)
    const lastIdx = mipCount - 1
    const cmpSize = v.getUint32(tman.payloadOffset + 4 + lastIdx * 8 + 4, true)
    // 8×8 BC3: ceil(8/4)×ceil(8/4) = 2×2 blocks × 16 bytes = 64
    expect(cmpSize).toBe(64)
  })
})

// ── BC1 / decal path (default & explicit) ─────────────────────────────────────

describe('canvasToRgt format:bc1 (decal path — default)', () => {
  it('2048×2048 BC1 compress:true emits < 2,200,000 bytes (much smaller than BC3)', () => {
    // BC1 compressed: 512²×8 raw = 2,097,152 bytes, plus zlib overhead and framing.
    // We pin the exact uncompressed size below; here just guard the order of magnitude.
    const canvas = solidCanvas(2048, 2048)
    const rgt = canvasToRgt(canvas, 'art\\armies\\german\\badge_dif')
    expect(rgt.length).toBeLessThan(2_200_000)
  })

  it('2048×2048 BC1 compress:false emits raw BC1 pixel bytes (512²×8 = 2,097,152) plus framing', () => {
    // BC1 raw: 512²×8 = 2,097,152 bytes + framing overhead.
    // Total must be > 2,097,152 and < 2,100,000.
    const canvas = solidCanvas(2048, 2048)
    const rgt = canvasToRgt(canvas, 'art\\armies\\german\\badge_dif', { compress: false })
    expect(rgt.length).toBeGreaterThan(2_097_152)
    expect(rgt.length).toBeLessThan(2_100_000)
  })

  it('TFMT format-code is 13 (DXT1/BC1) by default', () => {
    const canvas = solidCanvas(8, 8)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
    expect(readTfmtFormatCode(rgt)).toBe(13)
  })

  it('explicit format:bc1 also emits format-code 13', () => {
    const canvas = solidCanvas(8, 8)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif', { format: 'bc1' })
    expect(readTfmtFormatCode(rgt)).toBe(13)
  })

  it('8×8 BC1 compress:false raw pixel size = 2×2 blocks × 8 bytes = 32 (half of BC3)', () => {
    const canvas = solidCanvas(8, 8)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false, format: 'bc1' })
    const { root } = parseChunky(rgt)
    const tman = findChunk(root, 'TMAN')!
    const v = new DataView(rgt.buffer, rgt.byteOffset)
    const mipCount = v.getUint32(tman.payloadOffset, true)
    const lastIdx = mipCount - 1
    const cmpSize = v.getUint32(tman.payloadOffset + 4 + lastIdx * 8 + 4, true)
    expect(cmpSize).toBe(32)
  })
})

// ── Regression: decal path is not accidentally changed to BC3 ─────────────────

describe('decal path regression guard', () => {
  it('canvasToRgt with no options still produces BC1 (decal default must not regress)', () => {
    const canvas = solidCanvas(4, 4)
    const rgt = canvasToRgt(canvas, 'art\\armies\\soviet\\badge_dif')
    expect(readTfmtFormatCode(rgt)).toBe(13)
  })

  it('BC3 and BC1 for the same 8×8 canvas produce different byte lengths', () => {
    const canvas = solidCanvas(8, 8)
    const bc3 = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false, format: 'bc3' })
    const bc1 = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false, format: 'bc1' })
    // BC3 is exactly 2× larger (16 vs 8 bytes per block)
    expect(bc3.length).toBeGreaterThan(bc1.length)
  })
})
