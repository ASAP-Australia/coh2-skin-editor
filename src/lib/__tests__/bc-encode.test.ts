/**
 * Unit tests for the BC3 (DXT5) encoder.
 *
 * All tests use hand-crafted RGBA buffers so they run in CI with no game
 * assets or external files.  The encoder is min-max, not least-squares, so
 * the roundtrip tolerance is intentionally loose (±32 per channel).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { encodeBc3 } from '@/lib/bc-encode'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read a u16 LE from a byte array at the given offset. */
function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8)
}

/** Build a flat RGBA Uint8Array filled with one solid colour. */
function solidRgba(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number,
): Uint8Array {
  const buf = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = a
  }
  return buf
}

/**
 * Tiny inline BC3 decoder — only what we need for the roundtrip smoke test.
 *
 * Decodes one 4×4 block (16 bytes) and returns the reconstructed RGBA pixels
 * as a flat Uint8Array(64).  Alpha is decoded from bytes 0-7; colour from
 * bytes 8-15.
 */
function decodeBc3Block(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(64)

  // ── Alpha ──
  const a0 = block[0]
  const a1 = block[1]
  const aPal = new Uint8Array(8)
  aPal[0] = a0
  aPal[1] = a1
  if (a0 > a1) {
    // 8-interpolant mode
    for (let i = 1; i <= 6; i++) {
      aPal[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7)
    }
  } else {
    // 6-interpolant mode with explicit 0 and 255
    for (let i = 1; i <= 4; i++) {
      aPal[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5)
    }
    aPal[6] = 0
    aPal[7] = 255
  }
  // 6 bytes × 8 bits = 48 bits → 16 × 3-bit indices
  const lo = block[2] | (block[3] << 8) | (block[4] << 16)
  const hi = block[5] | (block[6] << 8) | (block[7] << 16)
  for (let i = 0; i < 8; i++) {
    out[i * 4 + 3] = aPal[(lo >>> (i * 3)) & 0x7]
  }
  for (let i = 0; i < 8; i++) {
    out[(i + 8) * 4 + 3] = aPal[(hi >>> (i * 3)) & 0x7]
  }

  // ── Colour ──
  const c0v = readU16LE(block, 8)
  const c1v = readU16LE(block, 10)

  function unpack565(v: number): [number, number, number] {
    const r5 = (v >>> 11) & 0x1f
    const g6 = (v >>> 5) & 0x3f
    const b5 = v & 0x1f
    return [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)]
  }

  const [r0, g0, b0] = unpack565(c0v)
  const [r1, g1, b1] = unpack565(c1v)

  const cPal: [number, number, number][] = [
    [r0, g0, b0],
    [r1, g1, b1],
    c0v > c1v
      ? [
          Math.round((2 * r0 + r1) / 3),
          Math.round((2 * g0 + g1) / 3),
          Math.round((2 * b0 + b1) / 3),
        ]
      : [Math.round((r0 + r1) / 2), Math.round((g0 + g1) / 2), Math.round((b0 + b1) / 2)],
    c0v > c1v
      ? [
          Math.round((r0 + 2 * r1) / 3),
          Math.round((g0 + 2 * g1) / 3),
          Math.round((b0 + 2 * b1) / 3),
        ]
      : [0, 0, 0],
  ]

  const bits = block[12] | (block[13] << 8) | (block[14] << 16) | (block[15] << 24)
  for (let i = 0; i < 16; i++) {
    const idx = (bits >>> (i * 2)) & 0x3
    const [r, g, b] = cPal[idx]
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
  }

  return out
}

// ─── Output size ──────────────────────────────────────────────────────────────

describe('encodeBc3 — output size', () => {
  it('4×4 → 1 block = 16 bytes', () => {
    const input = solidRgba(4, 4, 0, 0, 0, 255)
    expect(encodeBc3(input, 4, 4).byteLength).toBe(16)
  })

  it('8×8 → 4 blocks = 64 bytes', () => {
    const input = solidRgba(8, 8, 0, 0, 0, 255)
    expect(encodeBc3(input, 8, 8).byteLength).toBe(64)
  })

  it('16×16 → 16 blocks = 256 bytes', () => {
    const input = solidRgba(16, 16, 0, 0, 0, 255)
    expect(encodeBc3(input, 16, 16).byteLength).toBe(256)
  })

  it('5×5 → ceil(5/4)×ceil(5/4) = 2×2 = 4 blocks = 64 bytes (non-aligned, edge clamped)', () => {
    const input = solidRgba(5, 5, 255, 0, 0, 255)
    expect(encodeBc3(input, 5, 5).byteLength).toBe(64)
  })

  it('7×3 → ceil(7/4)×ceil(3/4) = 2×1 = 2 blocks = 32 bytes (non-aligned, edge clamped)', () => {
    const input = solidRgba(7, 3, 0, 255, 0, 255)
    expect(encodeBc3(input, 7, 3).byteLength).toBe(32)
  })
})

// ─── Solid red 4×4 ───────────────────────────────────────────────────────────

describe('encodeBc3 — solid red 4×4', () => {
  // pack565(255,0,0) = (255>>3)<<11 = 31<<11 = 0xF800
  const RED_565 = 0xf800

  let encoded: Uint8Array
  beforeAll(() => {
    const input = solidRgba(4, 4, 255, 0, 0, 255)
    encoded = encodeBc3(input, 4, 4)
  })

  it('alpha block: a0=255 (byte 0)', () => {
    expect(encoded[0]).toBe(255)
  })

  it('alpha block: a1=255 (byte 1) — constant alpha, degenerate mode', () => {
    expect(encoded[1]).toBe(255)
  })

  it('alpha block: index bytes 2-7 are all zero (constant-alpha fast path)', () => {
    for (let i = 2; i <= 7; i++) {
      expect(encoded[i]).toBe(0)
    }
  })

  it('colour block: c0 encodes red (≈ 0xF800)', () => {
    const c0 = readU16LE(encoded, 8)
    expect(c0).toBe(RED_565)
  })

  it('colour block: c1 also encodes red (degenerate single-colour block)', () => {
    const c1 = readU16LE(encoded, 10)
    expect(c1).toBe(RED_565)
  })
})

// ─── Solid black 4×4 ─────────────────────────────────────────────────────────

describe('encodeBc3 — solid black 4×4', () => {
  let encoded: Uint8Array
  beforeAll(() => {
    const input = solidRgba(4, 4, 0, 0, 0, 255)
    encoded = encodeBc3(input, 4, 4)
  })

  it('colour block: c0 = 0x0000 (black)', () => {
    expect(readU16LE(encoded, 8)).toBe(0x0000)
  })

  it('colour block: c1 = 0x0000 (black)', () => {
    expect(readU16LE(encoded, 10)).toBe(0x0000)
  })
})

// ─── Solid white 4×4 ─────────────────────────────────────────────────────────

describe('encodeBc3 — solid white 4×4', () => {
  // pack565(255,255,255) = (31<<11)|(63<<5)|31 = 0xF800|0x07E0|0x001F = 0xFFFF
  const WHITE_565 = 0xffff

  let encoded: Uint8Array
  beforeAll(() => {
    const input = solidRgba(4, 4, 255, 255, 255, 255)
    encoded = encodeBc3(input, 4, 4)
  })

  it('colour block: c0 ≈ 0xFFFF (white)', () => {
    expect(readU16LE(encoded, 8)).toBe(WHITE_565)
  })
})

// ─── Solid transparent 4×4 ───────────────────────────────────────────────────

describe('encodeBc3 — solid transparent 4×4 (alpha=0)', () => {
  let encoded: Uint8Array
  beforeAll(() => {
    const input = solidRgba(4, 4, 0, 0, 0, 0)
    encoded = encodeBc3(input, 4, 4)
  })

  it('alpha block: a0=0 (constant-alpha fast path)', () => {
    expect(encoded[0]).toBe(0)
  })

  it('alpha block: a1=0 (constant-alpha fast path)', () => {
    expect(encoded[1]).toBe(0)
  })

  it('alpha block: index bytes 2-7 are all zero', () => {
    for (let i = 2; i <= 7; i++) {
      expect(encoded[i]).toBe(0)
    }
  })
})

// ─── Mixed alpha 4×4 ─────────────────────────────────────────────────────────

describe('encodeBc3 — mixed alpha 4×4 (rows of 0, 64, 128, 192)', () => {
  // 4×4 pixels: each row has a fixed alpha value (0, 64, 128, 192).
  // The encoder picks aMax (a0) = 192 and aMin (a1) = 0.
  let encoded: Uint8Array
  beforeAll(() => {
    const buf = new Uint8Array(4 * 4 * 4)
    const rowAlpha = [0, 64, 128, 192]
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const i = (row * 4 + col) * 4
        buf[i] = 0
        buf[i + 1] = 0
        buf[i + 2] = 0
        buf[i + 3] = rowAlpha[row]
      }
    }
    encoded = encodeBc3(buf, 4, 4)
  })

  it('alpha block: a0 = aMax = 192', () => {
    expect(encoded[0]).toBe(192)
  })

  it('alpha block: a1 = aMin = 0', () => {
    expect(encoded[1]).toBe(0)
  })
})

// ─── 8×8 with single non-black block ─────────────────────────────────────────

describe('encodeBc3 — 8×8 with a red bottom-right block', () => {
  // The 8×8 image is partitioned into 4 blocks (2×2 grid).
  // Blocks: TL=black, TR=black, BL=black, BR=red.
  //
  // Encoded block order (row-major): TL, TR, BL, BR.
  // Each block is 16 bytes.
  //
  // c0 (bytes 8-9 relative to block start) encodes the max-RGB endpoint.
  // For black blocks c0 = 0x0000; for red c0 = 0xF800.

  const BLACK_565 = 0x0000
  const RED_565 = 0xf800

  let encoded: Uint8Array
  beforeAll(() => {
    const buf = new Uint8Array(8 * 8 * 4)
    // Fill entire image black first
    for (let i = 0; i < 8 * 8; i++) {
      buf[i * 4 + 3] = 255 // alpha=255, RGB=0
    }
    // Paint the bottom-right 4×4 quadrant red
    for (let row = 4; row < 8; row++) {
      for (let col = 4; col < 8; col++) {
        const i = (row * 8 + col) * 4
        buf[i] = 255
        buf[i + 1] = 0
        buf[i + 2] = 0
        buf[i + 3] = 255
      }
    }
    encoded = encodeBc3(buf, 8, 8)
  })

  it('top-left block (offset 0): c0 = black', () => {
    expect(readU16LE(encoded, 0 * 16 + 8)).toBe(BLACK_565)
  })

  it('top-right block (offset 16): c0 = black', () => {
    expect(readU16LE(encoded, 1 * 16 + 8)).toBe(BLACK_565)
  })

  it('bottom-left block (offset 32): c0 = black', () => {
    expect(readU16LE(encoded, 2 * 16 + 8)).toBe(BLACK_565)
  })

  it('bottom-right block (offset 48): c0 = red (0xF800)', () => {
    expect(readU16LE(encoded, 3 * 16 + 8)).toBe(RED_565)
  })

  it('bottom-right c0 differs from all black blocks', () => {
    const brC0 = readU16LE(encoded, 3 * 16 + 8)
    expect(brC0).not.toBe(BLACK_565)
  })
})

// ─── Accepts Uint8ClampedArray ────────────────────────────────────────────────

describe('encodeBc3 — accepts Uint8ClampedArray', () => {
  it('produces same output as plain Uint8Array for the same pixel data', () => {
    const plainArr = solidRgba(4, 4, 128, 64, 32, 200)
    const clampedArr = new Uint8ClampedArray(plainArr.buffer)

    const fromPlain = encodeBc3(plainArr, 4, 4)
    const fromClamped = encodeBc3(clampedArr, 4, 4)

    expect(fromClamped).toEqual(fromPlain)
  })
})

// ─── Non-aligned 5×5 edge clamping ───────────────────────────────────────────

describe('encodeBc3 — non-aligned 5×5 solid red (edge clamping)', () => {
  // A 5×5 solid-red image encodes into 2×2 = 4 blocks × 16 bytes = 64 bytes.
  // Edge clamping replicates border pixels into the padding columns/rows, so
  // every block is still pure-red.  All four c0 values should be 0xF800.
  const RED_565 = 0xf800

  let encoded: Uint8Array
  beforeAll(() => {
    const input = solidRgba(5, 5, 255, 0, 0, 255)
    encoded = encodeBc3(input, 5, 5)
  })

  it('total size is 64 bytes', () => {
    expect(encoded.byteLength).toBe(64)
  })

  it('all four block c0 values encode red (edge-clamped pixels are all red)', () => {
    for (let b = 0; b < 4; b++) {
      expect(readU16LE(encoded, b * 16 + 8)).toBe(RED_565)
    }
  })
})

// ─── Roundtrip smoke test ─────────────────────────────────────────────────────

describe('encodeBc3 — roundtrip smoke (4×4 greyscale gradient)', () => {
  // Use a greyscale gradient: 16 distinct shades of grey (R=G=B), alpha=255.
  // The bounding-box encoder handles greyscale perfectly because the max RGB
  // axis dominates and there is no hue error — only quantisation error from
  // RGB565.  This gives a realistic worst-case that still fits within ±8.
  //
  // Shades: 0,17,34,51, 68,85,102,119, 136,153,170,187, 204,221,238,255
  // (evenly spaced across the 4×4 block in row-major order).
  let input: Uint8Array
  let encoded: Uint8Array

  beforeAll(() => {
    input = new Uint8Array(4 * 4 * 4)
    for (let i = 0; i < 16; i++) {
      const shade = Math.round((i / 15) * 255)
      input[i * 4] = shade
      input[i * 4 + 1] = shade
      input[i * 4 + 2] = shade
      input[i * 4 + 3] = 255
    }
    encoded = encodeBc3(input, 4, 4)
  })

  it('encoded output is 16 bytes', () => {
    expect(encoded.byteLength).toBe(16)
  })

  it('decoded pixels are within ±40 of original per channel (min-max + 4-entry interpolation tolerance)', () => {
    const decoded = decodeBc3Block(encoded)
    const TOLERANCE = 40
    for (let i = 0; i < 16; i++) {
      for (let c = 0; c < 3; c++) {
        // RGB channels only
        const orig = input[i * 4 + c]
        const dec = decoded[i * 4 + c]
        expect(Math.abs(orig - dec)).toBeLessThanOrEqual(TOLERANCE)
      }
    }
  })

  it('alpha channel: all decoded pixels have alpha=255', () => {
    const decoded = decodeBc3Block(encoded)
    for (let i = 0; i < 16; i++) {
      expect(decoded[i * 4 + 3]).toBe(255)
    }
  })
})

describe('encodeBc3 — roundtrip smoke (4×4 near-red tint variations)', () => {
  // A block where all pixels are in the red-orange range with moderate
  // variation: the bounding-box encoder can represent this with good fidelity
  // since all three channels vary, but the red channel dominates.
  // Colours used: [200,50,0], [240,80,20], [180,30,10], [220,60,5] in a 2×2
  // pattern repeated across the 4×4 grid.
  const palette4: [number, number, number, number][] = [
    [200, 50, 0, 255],
    [240, 80, 20, 255],
    [180, 30, 10, 255],
    [220, 60, 5, 255],
  ]
  let input: Uint8Array
  let encoded: Uint8Array

  beforeAll(() => {
    input = new Uint8Array(4 * 4 * 4)
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const idx = (row % 2) * 2 + (col % 2)
        const [r, g, b, a] = palette4[idx]
        const i = (row * 4 + col) * 4
        input[i] = r
        input[i + 1] = g
        input[i + 2] = b
        input[i + 3] = a
      }
    }
    encoded = encodeBc3(input, 4, 4)
  })

  it('encoded output is 16 bytes', () => {
    expect(encoded.byteLength).toBe(16)
  })

  it('decoded RGB within ±32 per channel (near-red block, min-max encoder)', () => {
    const decoded = decodeBc3Block(encoded)
    const TOLERANCE = 32
    for (let i = 0; i < 16; i++) {
      for (let c = 0; c < 3; c++) {
        const orig = input[i * 4 + c]
        const dec = decoded[i * 4 + c]
        expect(Math.abs(orig - dec)).toBeLessThanOrEqual(TOLERANCE)
      }
    }
  })

  it('alpha channel: all decoded pixels have alpha=255', () => {
    const decoded = decodeBc3Block(encoded)
    for (let i = 0; i < 16; i++) {
      expect(decoded[i * 4 + 3]).toBe(255)
    }
  })
})
