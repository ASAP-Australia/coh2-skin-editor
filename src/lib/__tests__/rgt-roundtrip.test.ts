/**
 * Roundtrip tests for `rgt-writer.ts` (canvasToRgt) and `rgt.ts` (decodeRgt).
 *
 * Strategy:
 *   - Build canvases with the node-canvas package (already a devDep).
 *   - Call canvasToRgt() to produce a Chunky byte stream.
 *   - Feed the result into decodeRgt() and assert the decoded fields match.
 *   - For format codes the writer does not emit (BC1, sRGB variants), craft
 *     minimal hand-rolled RGT byte streams and parse them directly.
 *
 * We do NOT import rgtToCompressedTexture — it needs DDSLoader / Three.js
 * GPU objects that don't exist in jsdom. decodeRgt is the focus.
 *
 * Reference to writer source: src/lib/rgt-writer.ts
 * Reference to reader source:  src/lib/rgt.ts
 */

import { describe, it, expect } from 'vitest'
import { createCanvas, ImageData as CanvasImageData } from 'canvas'
import { deflate } from 'pako'
import { decodeRgt, classifyTextureFormat } from '../rgt'
import { canvasToRgt } from '../rgt-writer'
import { parseChunky, findChunk } from '../chunky'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const enc = new TextEncoder()

/** Write a u32 LE into buf at offset. */
function pu32(buf: Uint8Array, off: number, val: number): void {
  const v = new DataView(buf.buffer, buf.byteOffset)
  v.setUint32(off, val, true)
}

/** Read a u32 LE from buf at offset. */
function gu32(buf: Uint8Array, off: number): number {
  return new DataView(buf.buffer, buf.byteOffset).getUint32(off, true)
}

/**
 * Build a minimal but valid RGT byte stream with a custom format code.
 *
 * We build only the top mip (mipCount=1, payload = zlib(pixels)) so that
 * decodeRgt's "last mip = top mip" logic is exercised for every format code.
 *
 * Pixel bytes must have the correct byte-count for the declared format so the
 * reader's format-detection heuristic matches:
 *   BC1 (DXT1): blocksW × blocksH × 8  bytes
 *   BC3 (DXT5): blocksW × blocksH × 16 bytes
 */
function buildRgt(opts: {
  width: number
  height: number
  formatCode: number // 13 | 15 | 22 | 24 | …
  pixels: Uint8Array // raw BC-encoded bytes for the top mip (no 16-byte header)
}): Uint8Array {
  const { width, height, formatCode, pixels } = opts

  // ── TFMT payload (25 bytes, same layout as rgt-writer.ts) ──
  const tfmt = new Uint8Array(25)
  const tfmtV = new DataView(tfmt.buffer)
  tfmtV.setUint32(0, width, true)
  tfmtV.setUint32(4, height, true)
  tfmtV.setUint32(8, 1, true)
  tfmtV.setUint32(12, 2, true)
  tfmtV.setUint32(16, formatCode, true)
  tfmtV.setUint32(20, 0, true)
  tfmt[24] = 1

  // ── TMAN payload: 1 mip ──
  const compressed = deflate(pixels, { level: 1 })
  const tmanSize = 4 + 8 * 1 // mipCount=1
  const tman = new Uint8Array(tmanSize)
  const tmanV = new DataView(tman.buffer)
  tmanV.setUint32(0, 1, true) // mipCount
  tmanV.setUint32(4, pixels.length, true) // unc size
  tmanV.setUint32(8, compressed.length, true) // cmp size

  // ── TDAT payload ──
  const tdat = compressed

  // ── Chunk serialisation helpers (mirror rgt-writer.ts) ──
  function chunkHeader(
    kind: 'DATA' | 'FOLD',
    fcc: string,
    ver: number,
    name: string,
    payloadLen: number,
  ): Uint8Array {
    const nameBytes = name ? enc.encode(name + '\0') : new Uint8Array(0)
    const hdr = new Uint8Array(28 + nameBytes.length)
    const hv = new DataView(hdr.buffer)
    hdr.set(enc.encode(kind), 0)
    hdr.set(enc.encode((fcc + '    ').slice(0, 4)), 4)
    hv.setUint32(8, ver, true)
    hv.setUint32(12, payloadLen, true)
    hv.setUint32(16, nameBytes.length, true)
    hv.setUint32(20, 0xffffffff, true)
    hv.setUint32(24, 0, true)
    if (nameBytes.length) hdr.set(nameBytes, 28)
    return hdr
  }

  function dataChunk(fcc: string, ver: number, name: string, payload: Uint8Array): Uint8Array {
    const h = chunkHeader('DATA', fcc, ver, name, payload.length)
    const out = new Uint8Array(h.length + payload.length)
    out.set(h, 0)
    out.set(payload, h.length)
    return out
  }

  function foldChunk(fcc: string, ver: number, name: string, children: Uint8Array): Uint8Array {
    const h = chunkHeader('FOLD', fcc, ver, name, children.length)
    const out = new Uint8Array(h.length + children.length)
    out.set(h, 0)
    out.set(children, h.length)
    return out
  }

  function concat(...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((s, p) => s + p.length, 0)
    const out = new Uint8Array(total)
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }

  const dxtcChildren = concat(
    dataChunk('TFMT', 1, '', tfmt),
    dataChunk('TMAN', 1, '', tman),
    dataChunk('TDAT', 1, '', tdat),
  )
  const dxtc = foldChunk('DXTC', 3, '', dxtcChildren)
  const txtr = foldChunk('TXTR', 1, '<unnamed spooge object>', dxtc)
  const tsetData = dataChunk('DATA', 3, '', new Uint8Array(8))
  const tset = foldChunk('TSET', 1, 'art\\test\\entity_dif', concat(tsetData, txtr))

  // Minimal FBIF
  const op = enc.encode('generic-image to data-rgt')
  const fbifPayload = new Uint8Array(4 + op.length + 20)
  const fbifV = new DataView(fbifPayload.buffer)
  fbifV.setUint32(0, op.length, true)
  fbifPayload.set(op, 4)
  const fbif = dataChunk('FBIF', 2, 'FileBurnInfo', fbifPayload)

  // File header (36 bytes)
  const fileHeader = new Uint8Array(36)
  fileHeader.set(enc.encode('Relic Chunky'), 0)
  fileHeader[12] = 0x0d
  fileHeader[13] = 0x0a
  fileHeader[14] = 0x1a
  fileHeader[15] = 0
  const fhV = new DataView(fileHeader.buffer)
  fhV.setUint32(16, 3, true)
  fhV.setUint32(20, 1, true)
  fhV.setUint32(24, 0x24, true)
  fhV.setUint32(28, 0x1c, true)
  fhV.setUint32(32, 1, true)

  const body = concat(fbif, tset)
  return concat(fileHeader, body)
}

// (an earlier draft had a `makeRgba` helper here for pixel-content tests;
// the current test set uses `solidCanvas` instead so it was removed to
// satisfy `noUnusedLocals`.)

/** Make zeroed BC1 pixel bytes for a given width×height texture. */
function dummyBc1(width: number, height: number): Uint8Array {
  const bw = Math.max(1, Math.ceil(width / 4))
  const bh = Math.max(1, Math.ceil(height / 4))
  return new Uint8Array(bw * bh * 8)
}

/** Make zeroed BC3 pixel bytes for a given width×height texture. */
function dummyBc3(width: number, height: number): Uint8Array {
  const bw = Math.max(1, Math.ceil(width / 4))
  const bh = Math.max(1, Math.ceil(height / 4))
  return new Uint8Array(bw * bh * 16)
}

/** Byte-by-byte equality for two Uint8Arrays. Used in place of Node's
 *  `Buffer.from(a).equals(Buffer.from(b))` so this test file stays free
 *  of node-only types. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Create a node-canvas filled with a solid RGBA colour. */
function solidCanvas(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number,
): HTMLCanvasElement {
  const c = createCanvas(width, height)
  const ctx = c.getContext('2d')
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  }
  // Use canvas-package ImageData (node-canvas recognises it; plain objects fail)
  ctx.putImageData(new CanvasImageData(data, width, height), 0, 0)
  return c as unknown as HTMLCanvasElement
}

// ─── canvasToRgt + decodeRgt roundtrips ──────────────────────────────────────

describe('canvasToRgt + decodeRgt roundtrip', () => {
  describe('4×4 RGBA canvas (square power-of-two)', () => {
    it('decoded width and height match the source canvas', () => {
      const canvas = solidCanvas(4, 4, 255, 0, 0, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      const decoded = decodeRgt(rgt)
      expect(decoded.width).toBe(4)
      expect(decoded.height).toBe(4)
    })

    it('decoded fourCC is DXT1 (writer uses BC1/format code 13 for binary mask RGTs)', () => {
      const canvas = solidCanvas(4, 4, 0, 255, 0, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      const decoded = decodeRgt(rgt)
      expect(decoded.fourCC).toBe('DXT1')
    })

    it('formatCode is 13 (BC1 linear) as written by rgt-writer', () => {
      const canvas = solidCanvas(4, 4, 0, 0, 255, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      const decoded = decodeRgt(rgt)
      expect(decoded.formatCode).toBe(13)
    })

    it('isSRGB is false for format code 13 (linear)', () => {
      // classifyTextureFormat(13) = { fourCC: 'DXT1', isSRGB: false }
      // decodeRgt uses classified.isSRGB, not the ?? true fallback.
      const canvas = solidCanvas(4, 4, 100, 150, 200, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      const decoded = decodeRgt(rgt)
      expect(decoded.isSRGB).toBe(false)
    })

    it('pixel byte count matches expected BC1 blocks for 4×4', () => {
      // 4×4 = 1×1 blocks × 8 bytes/block = 8 bytes (BC1 is half of BC3)
      const canvas = solidCanvas(4, 4, 200, 100, 50, 200)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      const decoded = decodeRgt(rgt)
      const expectedBytes = 1 * 1 * 8
      expect(decoded.pixels.length).toBe(expectedBytes)
    })

    it('pixel bytes are a non-empty Uint8Array', () => {
      const canvas = solidCanvas(4, 4, 77, 88, 99, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      const decoded = decodeRgt(rgt)
      expect(decoded.pixels).toBeInstanceOf(Uint8Array)
      expect(decoded.pixels.length).toBeGreaterThan(0)
    })
  })

  describe('16×8 non-square canvas (wide)', () => {
    it('decoded width=16 height=8', () => {
      const canvas = solidCanvas(16, 8, 128, 64, 32, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\wide_dif')
      const decoded = decodeRgt(rgt)
      expect(decoded.width).toBe(16)
      expect(decoded.height).toBe(8)
    })

    it('pixel byte count = 4 blocks × 2 blocks × 8 bytes = 64', () => {
      const canvas = solidCanvas(16, 8, 200, 100, 50, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\wide_dif')
      const decoded = decodeRgt(rgt)
      // 16px/4 = 4 blocks wide, 8px/4 = 2 blocks tall → 4×2×8 = 64 (BC1)
      expect(decoded.pixels.length).toBe(64)
    })
  })

  describe('8×16 non-square canvas (tall)', () => {
    it('decoded width=8 height=16', () => {
      const canvas = solidCanvas(8, 16, 64, 128, 200, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\tall_dif')
      const decoded = decodeRgt(rgt)
      expect(decoded.width).toBe(8)
      expect(decoded.height).toBe(16)
    })

    it('pixel byte count = 2 blocks wide × 4 blocks tall × 8 bytes = 64', () => {
      const canvas = solidCanvas(8, 16, 60, 70, 80, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\tall_dif')
      const decoded = decodeRgt(rgt)
      // BC1: 2×4 = 8 blocks × 8 bytes = 64
      expect(decoded.pixels.length).toBe(64)
    })
  })

  describe('compress:false option (raw BC3, no zlib — key-pool patch mode)', () => {
    it('compress:false output is still a valid Chunky file (parses with parseChunky)', () => {
      const canvas = solidCanvas(8, 8, 200, 150, 100, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false })
      // parseChunky must not throw — the file structure is still valid Chunky v3
      expect(() => parseChunky(rgt)).not.toThrow()
    })

    it('compress:false output has the Relic Chunky magic header', () => {
      const canvas = solidCanvas(8, 8, 0, 128, 255, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false })
      const magic = String.fromCharCode(...rgt.slice(0, 12))
      expect(magic).toBe('Relic Chunky')
    })

    it('compress:false output is a Uint8Array larger than the file header (36 bytes)', () => {
      const canvas = solidCanvas(8, 8, 100, 200, 50, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false })
      expect(rgt).toBeInstanceOf(Uint8Array)
      expect(rgt.length).toBeGreaterThan(36)
    })

    it('compress:false TMAN mip entry has non-zero cmp_size matching raw pixel bytes', () => {
      // In raw mode the top-mip "cmp" blob is the raw BC1 bytes, not deflated.
      // BC1 for 8×8: 2×2 blocks × 8 bytes = 32 bytes.
      const canvas = solidCanvas(8, 8, 50, 100, 150, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif', { compress: false })
      const { root } = parseChunky(rgt)
      const tman = findChunk(root, 'TMAN')
      expect(tman).not.toBeNull()
      const v = new DataView(rgt.buffer, rgt.byteOffset)
      const mipCount = v.getUint32(tman!.payloadOffset, true)
      // The LAST entry is the top mip. Its cmp_size == raw BC1 pixel size (no zlib header).
      const lastIdx = mipCount - 1
      const cmpSize = v.getUint32(tman!.payloadOffset + 4 + lastIdx * 8 + 4, true)
      // 8×8 BC1: ceil(8/4)×ceil(8/4) = 2×2 = 4 blocks × 8 = 32 bytes
      expect(cmpSize).toBe(32)
    })
  })

  describe('mip chain — mipCount is computed and embedded correctly', () => {
    it('4×4 canvas produces mipCount = floor(log2(4))+1 = 3 mips in TMAN', () => {
      const canvas = solidCanvas(4, 4, 10, 20, 30, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      // Parse TMAN manually to count mips
      const { root } = parseChunky(rgt)
      const tman = findChunk(root, 'TMAN')
      expect(tman).not.toBeNull()
      const mipCount = new DataView(rgt.buffer, rgt.byteOffset).getUint32(tman!.payloadOffset, true)
      expect(mipCount).toBe(3)
    })

    it('8×8 canvas produces mipCount = floor(log2(8))+1 = 4 mips in TMAN', () => {
      const canvas = solidCanvas(8, 8, 10, 20, 30, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      const { root } = parseChunky(rgt)
      const tman = findChunk(root, 'TMAN')
      expect(tman).not.toBeNull()
      const mipCount = new DataView(rgt.buffer, rgt.byteOffset).getUint32(tman!.payloadOffset, true)
      expect(mipCount).toBe(4)
    })

    it('16×8 canvas produces mipCount = floor(log2(16))+1 = 5 mips in TMAN', () => {
      const canvas = solidCanvas(16, 8, 10, 20, 30, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\wide_dif')
      const { root } = parseChunky(rgt)
      const tman = findChunk(root, 'TMAN')
      expect(tman).not.toBeNull()
      const mipCount = new DataView(rgt.buffer, rgt.byteOffset).getUint32(tman!.payloadOffset, true)
      // max(16,8)=16 → floor(log2(16))+1 = 4+1 = 5
      expect(mipCount).toBe(5)
    })

    it('decodeRgt reads only the top (last) mip regardless of chain length', async () => {
      // A 16×16 canvas has mipCount=5. decodeRgt must skip the 4 smaller mips
      // and decompress only the last one. Verify pixel byte count matches top mip.
      const canvas = solidCanvas(16, 16, 80, 160, 240, 255)
      const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
      const decoded = decodeRgt(rgt)
      // 16×16 → 4×4 blocks → 4×4×8 = 128 bytes for BC1
      expect(decoded.pixels.length).toBe(128)
    })
  })
})

// ─── Hand-crafted RGT: format code tests ─────────────────────────────────────

describe('decodeRgt with hand-crafted format codes', () => {
  describe('format code 13 — BC1 linear (DXT1)', () => {
    it('fourCC is DXT1', () => {
      const pixels = dummyBc1(4, 4)
      const rgt = buildRgt({ width: 4, height: 4, formatCode: 13, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.fourCC).toBe('DXT1')
    })

    it('isSRGB is false', () => {
      const pixels = dummyBc1(4, 4)
      const rgt = buildRgt({ width: 4, height: 4, formatCode: 13, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.isSRGB).toBe(false)
    })

    it('formatCode is 13', () => {
      const pixels = dummyBc1(4, 4)
      const rgt = buildRgt({ width: 4, height: 4, formatCode: 13, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.formatCode).toBe(13)
    })

    it('pixel count = 1 block × 8 bytes for 4×4 BC1', () => {
      const pixels = dummyBc1(4, 4)
      const rgt = buildRgt({ width: 4, height: 4, formatCode: 13, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.pixels.length).toBe(8)
    })
  })

  describe('format code 22 — BC1 sRGB (DXT1)', () => {
    it('fourCC is DXT1', () => {
      const pixels = dummyBc1(8, 8)
      const rgt = buildRgt({ width: 8, height: 8, formatCode: 22, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.fourCC).toBe('DXT1')
    })

    it('isSRGB is true', () => {
      const pixels = dummyBc1(8, 8)
      const rgt = buildRgt({ width: 8, height: 8, formatCode: 22, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.isSRGB).toBe(true)
    })

    it('formatCode is 22', () => {
      const pixels = dummyBc1(8, 8)
      const rgt = buildRgt({ width: 8, height: 8, formatCode: 22, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.formatCode).toBe(22)
    })
  })

  describe('format code 15 — BC3 linear (DXT5)', () => {
    it('fourCC is DXT5', () => {
      const pixels = dummyBc3(8, 8)
      const rgt = buildRgt({ width: 8, height: 8, formatCode: 15, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.fourCC).toBe('DXT5')
    })

    it('isSRGB is false', () => {
      const pixels = dummyBc3(8, 8)
      const rgt = buildRgt({ width: 8, height: 8, formatCode: 15, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.isSRGB).toBe(false)
    })
  })

  describe('format code 24 — BC3 sRGB (DXT5)', () => {
    it('fourCC is DXT5', () => {
      const pixels = dummyBc3(4, 4)
      const rgt = buildRgt({ width: 4, height: 4, formatCode: 24, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.fourCC).toBe('DXT5')
    })

    it('isSRGB is true', () => {
      const pixels = dummyBc3(4, 4)
      const rgt = buildRgt({ width: 4, height: 4, formatCode: 24, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.isSRGB).toBe(true)
    })

    it('formatCode is 24', () => {
      const pixels = dummyBc3(4, 4)
      const rgt = buildRgt({ width: 4, height: 4, formatCode: 24, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.formatCode).toBe(24)
    })
  })

  describe('unknown format code — fallback to byte-count inference', () => {
    it('unknown code with BC3-sized pixels → DXT5, isSRGB defaults to true', () => {
      // Code 99 is unknown → classified = null → isSRGB = true (fallback)
      const pixels = dummyBc3(8, 8)
      const rgt = buildRgt({ width: 8, height: 8, formatCode: 99, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.fourCC).toBe('DXT5')
      expect(decoded.isSRGB).toBe(true)
    })

    it('unknown code with BC1-sized pixels → DXT1, isSRGB defaults to true', () => {
      const pixels = dummyBc1(8, 8)
      const rgt = buildRgt({ width: 8, height: 8, formatCode: 99, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.fourCC).toBe('DXT1')
      expect(decoded.isSRGB).toBe(true)
    })
  })

  describe('non-square hand-crafted textures', () => {
    it('16×8 BC3 texture: width=16 height=8 preserved', () => {
      const pixels = dummyBc3(16, 8)
      const rgt = buildRgt({ width: 16, height: 8, formatCode: 24, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.width).toBe(16)
      expect(decoded.height).toBe(8)
    })

    it('16×8 BC3: pixel count = 4×2 blocks × 16 bytes = 128', () => {
      const pixels = dummyBc3(16, 8)
      const rgt = buildRgt({ width: 16, height: 8, formatCode: 24, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.pixels.length).toBe(128)
    })

    it('8×16 BC1: pixel count = 2×4 blocks × 8 bytes = 64', () => {
      const pixels = dummyBc1(8, 16)
      const rgt = buildRgt({ width: 8, height: 16, formatCode: 13, pixels })
      const decoded = decodeRgt(rgt)
      expect(decoded.pixels.length).toBe(64)
    })
  })
})

// ─── 16-byte mip header stripping ────────────────────────────────────────────

describe('decodeRgt: 16-byte per-mip header stripping', () => {
  it('strips the header when present and decoded pixels have correct length', () => {
    // Build BC3 bytes with a 16-byte header prepended.
    // Header layout: 4 zero bytes | width u32LE | height u32LE | 4 zero bytes | 0x00 0x20
    const W = 8,
      H = 8
    const rawPixels = dummyBc3(W, H) // 4×16 = 64 bytes
    const header = new Uint8Array(16)
    pu32(header, 4, W)
    pu32(header, 8, H)
    header[14] = 0x20 // observed signature tail

    const pixelsWithHeader = new Uint8Array(16 + rawPixels.length)
    pixelsWithHeader.set(header, 0)
    pixelsWithHeader.set(rawPixels, 16)

    const rgt = buildRgt({ width: W, height: H, formatCode: 15, pixels: pixelsWithHeader })
    const decoded = decodeRgt(rgt)

    // Reader should strip the header: resultant pixel count = raw BC3 size
    expect(decoded.pixels.length).toBe(rawPixels.length)
  })

  it('does NOT strip when header width/height do not match TFMT', () => {
    // Put a header whose embedded w/h mismatch the TFMT → stripping skipped.
    const W = 8,
      H = 8
    const rawPixels = dummyBc3(W, H)
    const header = new Uint8Array(16)
    pu32(header, 4, 99) // wrong width
    pu32(header, 8, 99) // wrong height

    const pixelsWithBadHeader = new Uint8Array(16 + rawPixels.length)
    pixelsWithBadHeader.set(header, 0)
    pixelsWithBadHeader.set(rawPixels, 16)

    const rgt = buildRgt({ width: W, height: H, formatCode: 15, pixels: pixelsWithBadHeader })
    const decoded = decodeRgt(rgt)

    // Header NOT stripped — pixel length = 16 + rawPixels.length
    expect(decoded.pixels.length).toBe(16 + rawPixels.length)
  })
})

// ─── Reader error handling ────────────────────────────────────────────────────

describe('decodeRgt: reader rejects malformed input', () => {
  it('throws on non-Chunky bytes (bad magic)', () => {
    const bad = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
    expect(() => decodeRgt(bad)).toThrow(/Relic Chunky|bad magic/i)
  })

  it('throws on truncated buffer (correct magic, truncated body)', () => {
    // Relic Chunky magic = "Relic Chunky\r\n\x1a\0" — 16 bytes.
    const stub = new Uint8Array(20)
    stub.set(enc.encode('Relic Chunky'), 0)
    stub[12] = 0x0d
    stub[13] = 0x0a
    stub[14] = 0x1a
    stub[15] = 0
    // version = 3 (LE u32 at offset 16)
    stub[16] = 3
    // No chunks → decodeRgt finds no TFMT/TMAN/TDAT
    expect(() => decodeRgt(stub)).toThrow(/TFMT\/TMAN\/TDAT|missing|version.*not supported/i)
  })

  it('throws on empty Uint8Array', () => {
    expect(() => decodeRgt(new Uint8Array(0))).toThrow()
  })

  it('throws "Failed to inflate" when TDAT contains corrupted zlib data', () => {
    // Build a valid-structured RGT but corrupt the zlib stream in TDAT so
    // pako.inflate throws, exercising the catch branch on rgt.ts:122.
    const W = 4,
      H = 4
    // Build a real RGT first, then corrupt the TDAT payload bytes.
    const pixels = dummyBc3(W, H)
    const rgt = buildRgt({ width: W, height: H, formatCode: 15, pixels })
    // Find TDAT chunk and overwrite its payload with garbage bytes.
    // The TDAT payload starts right after the chunk header; we can locate it
    // by parsing the chunky first, then mutating the buffer copy.
    const mutable = new Uint8Array(rgt)
    const { root } = parseChunky(mutable)
    const tdat = findChunk(root, 'TDAT')!
    // Overwrite the first 8 bytes of the payload with non-zlib bytes (0xDE 0xAD…)
    for (let i = 0; i < Math.min(8, tdat.payloadSize); i++) {
      mutable[tdat.payloadOffset + i] = 0xde
    }
    expect(() => decodeRgt(mutable)).toThrow(/Failed to inflate/)
  })

  it('throws on missing TFMT/TMAN/TDAT chunks (valid Chunky, empty TSET)', () => {
    // Build a valid Chunky v3 with an empty FOLD/TSET that has no DATA children.
    // (an earlier draft also built the full archive here as a positive
    // control; removed since we only need the empty-TSET negative path.)
    const tset = (() => {
      function chunkHeader(
        kind: 'DATA' | 'FOLD',
        fcc: string,
        ver: number,
        payloadLen: number,
      ): Uint8Array {
        const hdr = new Uint8Array(28)
        const hv = new DataView(hdr.buffer)
        hdr.set(enc.encode(kind), 0)
        hdr.set(enc.encode((fcc + '    ').slice(0, 4)), 4)
        hv.setUint32(8, ver, true)
        hv.setUint32(12, payloadLen, true)
        hv.setUint32(20, 0xffffffff, true)
        return hdr
      }
      // Empty FOLD TSET with zero payload
      return chunkHeader('FOLD', 'TSET', 1, 0)
    })()

    const fileHeader = new Uint8Array(36)
    fileHeader.set(enc.encode('Relic Chunky'), 0)
    fileHeader[12] = 0x0d
    fileHeader[13] = 0x0a
    fileHeader[14] = 0x1a
    fileHeader[15] = 0
    const fhV = new DataView(fileHeader.buffer)
    fhV.setUint32(16, 3, true)
    fhV.setUint32(20, 1, true)
    fhV.setUint32(24, 0x24, true)
    fhV.setUint32(28, 0x1c, true)
    fhV.setUint32(32, 1, true)

    const out = new Uint8Array(fileHeader.length + tset.length)
    out.set(fileHeader, 0)
    out.set(tset, fileHeader.length)
    expect(() => decodeRgt(out)).toThrow(/TFMT\/TMAN\/TDAT/)
  })
})

// ─── Writer output structure ──────────────────────────────────────────────────

describe('canvasToRgt: output structure', () => {
  it('output starts with Relic Chunky magic', () => {
    const canvas = solidCanvas(4, 4, 100, 100, 100, 255)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
    const magic = String.fromCharCode(...rgt.slice(0, 12))
    expect(magic).toBe('Relic Chunky')
  })

  it('output is a Uint8Array with length > 36 (more than the file header)', () => {
    const canvas = solidCanvas(4, 4, 255, 255, 0, 255)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
    expect(rgt).toBeInstanceOf(Uint8Array)
    expect(rgt.length).toBeGreaterThan(36)
  })

  it('Chunky version field is 3', () => {
    const canvas = solidCanvas(8, 8, 0, 200, 100, 255)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
    const version = gu32(rgt, 16)
    expect(version).toBe(3)
  })

  it('contains FBIF chunk (required for engine to load custom skins)', () => {
    const canvas = solidCanvas(8, 8, 40, 80, 160, 255)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
    const { root } = parseChunky(rgt)
    const fbif = findChunk(root, 'FBIF')
    expect(fbif).not.toBeNull()
    expect(fbif!.kind).toBe('DATA')
  })

  it('contains TSET FOLD chunk wrapping TXTR', () => {
    const canvas = solidCanvas(4, 4, 60, 120, 180, 255)
    const rgt = canvasToRgt(canvas, 'art\\test\\entity_dif')
    const { root } = parseChunky(rgt)
    const tset = findChunk(root, 'TSET')
    expect(tset).not.toBeNull()
    expect(tset!.kind).toBe('FOLD')
  })

  it('TSET name matches the internalName argument', () => {
    const name = 'art\\armies\\commonwealth\\engineer_dif'
    const canvas = solidCanvas(4, 4, 90, 45, 180, 255)
    const rgt = canvasToRgt(canvas, name)
    const { root } = parseChunky(rgt)
    const tset = findChunk(root, 'TSET')
    expect(tset!.name).toBe(name)
  })

  it('canvasToRgt with different internalNames produces different byte streams', () => {
    const canvas = solidCanvas(4, 4, 10, 20, 30, 255)
    const a = canvasToRgt(canvas, 'art\\test\\unit_a_dif')
    const b = canvasToRgt(canvas, 'art\\test\\unit_b_dif')
    // Different name → different bytes (name is embedded in TSET).
    // Use a pure JS byte-by-byte comparison so we don't pull Node's
    // `Buffer` global into a strict-mode-typed test file.
    expect(bytesEqual(a, b)).toBe(false)
  })
})

// ─── classifyTextureFormat ↔ decodeRgt isSRGB/fourCC consistency ──────────────

describe('isSRGB and fourCC consistency with classifyTextureFormat', () => {
  const cases: [number, 'DXT1' | 'DXT5', boolean][] = [
    [13, 'DXT1', false],
    [15, 'DXT5', false],
    [22, 'DXT1', true],
    [24, 'DXT5', true],
  ]

  it.each(cases)(
    'format code %i → fourCC=%s isSRGB=%s (same as classifyTextureFormat)',
    (code, expectedFourCC, expectedSRGB) => {
      const pixelFn = expectedFourCC === 'DXT1' ? dummyBc1 : dummyBc3
      const pixels = pixelFn(4, 4)
      const rgt = buildRgt({ width: 4, height: 4, formatCode: code, pixels })
      const decoded = decodeRgt(rgt)

      const classified = classifyTextureFormat(code)!
      expect(decoded.fourCC).toBe(classified.fourCC)
      expect(decoded.isSRGB).toBe(classified.isSRGB)
      expect(decoded.fourCC).toBe(expectedFourCC)
      expect(decoded.isSRGB).toBe(expectedSRGB)
    },
  )
})
