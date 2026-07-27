import { describe, it, expect } from 'vitest'
import { encodeBc1, encodeBc3 } from '../bc-encode'
import { decodeBc1, decodeBc3 } from '../bc-decode'

/**
 * BC1/BC3 ROUND-TRIP — encode, decode, compare.
 *
 * WHY THIS FILE EXISTS. The first mutation run scored bc-decode.ts at 23.35%
 * with 86 surviving mutants and 65 with no coverage at all. The cause was
 * structural: every existing bc test asserts on ENCODER OUTPUT BYTES and
 * nothing ever decoded, so the entire decode path was unexercised. Mutants
 * that survived included:
 *
 *   Math.ceil(height / 4)  ->  Math.ceil(height * 4)   block count, 16x wrong
 *   src[off + 1]           ->  src[off - 1]            wrong alpha endpoint
 *   if (a0 > a1)           ->  if (true) / if (false)  alpha palette mode
 *   decodeColourBlock(..., true, ...) -> false          BC1-vs-BC3 flag
 *   the whole else branch computing the 6-value alpha palette, DELETED
 *
 * Round-tripping kills these in classes rather than one assertion at a time: a
 * wrong block count changes the output length, a wrong endpoint skews the
 * ramp, and the wrong palette mode moves interpolated values off their targets.
 *
 * TOLERANCES ARE MEASURED, NOT GUESSED. BC is lossy, so a round trip is never
 * exact, and this project has twice been burned by invented thresholds (gates
 * set 5-12x too loose, then too tight). Actual observed maxima across sizes
 * 4x4..64x64:
 *
 *   solid colour      RGB max  6   mean 3
 *   smooth gradient   RGB max  9   at 64x64  (127 at 4x4 — one block spanning
 *                                             a whole gradient is worst case)
 *   random noise      RGB max 170  mean ~52  (BC1 stores 4 colours per 4x4
 *                                             block; noise is pathological)
 *   alpha ramp        A   max 10   mean <=4.5
 *
 * So: strict bounds only where the codec is genuinely accurate, and structural
 * assertions (length, determinism, bounds) where it is not. A tolerance loose
 * enough to pass noise would be loose enough to pass a broken decoder.
 */

/** Deterministic PRNG — a flaky codec test is worse than none. */
function prng(seed: number) {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

type Kind = 'solid' | 'gradient' | 'noise' | 'alphaRamp' | 'alphaConstant'

function makeImage(w: number, h: number, kind: Kind, seed = 1): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4)
  const rnd = prng(seed)
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const x = i % w
    const y = Math.floor(i / w)
    switch (kind) {
      case 'solid':
        a[p] = 200; a[p + 1] = 40; a[p + 2] = 60; a[p + 3] = 255
        break
      case 'gradient':
        a[p] = (x / Math.max(1, w - 1)) * 255
        a[p + 1] = (y / Math.max(1, h - 1)) * 255
        a[p + 2] = 128
        a[p + 3] = 255
        break
      case 'noise':
        a[p] = rnd() * 255; a[p + 1] = rnd() * 255; a[p + 2] = rnd() * 255; a[p + 3] = 255
        break
      case 'alphaRamp':
        a[p] = 120; a[p + 1] = 120; a[p + 2] = 120
        a[p + 3] = (x / Math.max(1, w - 1)) * 255
        break
      case 'alphaConstant':
        a[p] = 90; a[p + 1] = 160; a[p + 2] = 210; a[p + 3] = 255
        break
    }
  }
  return a
}

function maxChannelError(a: Uint8ClampedArray, b: Uint8ClampedArray, channels: number[]) {
  let max = 0
  for (let i = 0; i < a.length; i += 4) {
    for (const c of channels) max = Math.max(max, Math.abs(a[i + c] - b[i + c]))
  }
  return max
}

/** Sizes deliberately include non-multiples of 4 — that is what catches a
 *  broken block count (ceil(h/4) -> h*4) and edge-clamping errors. */
const SIZES: Array<[number, number]> = [
  [4, 4], [8, 8], [16, 16], [64, 64],
  [5, 5], [7, 3], [1, 1], [3, 9], [17, 5],
]

describe('BC round-trip — output shape', () => {
  for (const [w, h] of SIZES) {
    it(`decodeBc1(encodeBc1(...)) returns exactly ${w}x${h}x4 bytes`, () => {
      const src = makeImage(w, h, 'solid')
      const out = decodeBc1(encodeBc1(src, w, h), w, h)
      // A wrong block count (ceil(h/4) -> h*4) or a wrong loop bound
      // (by < blocksH -> by <= blocksH) changes this or overruns.
      expect(out.length).toBe(w * h * 4)
    })

    it(`decodeBc3(encodeBc3(...)) returns exactly ${w}x${h}x4 bytes`, () => {
      const src = makeImage(w, h, 'alphaRamp')
      const out = decodeBc3(encodeBc3(src, w, h), w, h)
      expect(out.length).toBe(w * h * 4)
    })
  }

  it('encoded size matches the block-count formula for non-aligned sizes', () => {
    // 4x4 blocks: BC1 = 8 bytes/block, BC3 = 16 bytes/block.
    for (const [w, h] of SIZES) {
      const blocks = Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4))
      const src = makeImage(w, h, 'solid')
      expect(encodeBc1(src, w, h).length, `bc1 ${w}x${h}`).toBe(blocks * 8)
      expect(encodeBc3(src, w, h).length, `bc3 ${w}x${h}`).toBe(blocks * 16)
    }
  })
})

describe('BC round-trip — colour fidelity (measured bounds)', () => {
  it('solid colour survives BC1 within 8 (measured max 6)', () => {
    for (const [w, h] of SIZES) {
      const src = makeImage(w, h, 'solid')
      const out = decodeBc1(encodeBc1(src, w, h), w, h)
      expect(maxChannelError(src, out, [0, 1, 2]), `${w}x${h}`).toBeLessThanOrEqual(8)
    }
  })

  it('solid colour survives BC3 within 8, and BC3 alpha=255 is exact', () => {
    for (const [w, h] of SIZES) {
      const src = makeImage(w, h, 'alphaConstant')
      const out = decodeBc3(encodeBc3(src, w, h), w, h)
      expect(maxChannelError(src, out, [0, 1, 2]), `rgb ${w}x${h}`).toBeLessThanOrEqual(8)
      // Constant alpha uses the degenerate a0 == a1 path — which is ALSO the
      // branch where `a0 > a1` is false, i.e. the 6-value palette. Exercising
      // it here is what kills the `if (a0 > a1) -> if (true)` mutant.
      expect(maxChannelError(src, out, [3]), `alpha ${w}x${h}`).toBe(0)
    }
  })

  it('a large smooth gradient survives BC1 within 12 (measured 9 at 64x64)', () => {
    // Only asserted at a size where blocks are small relative to the gradient.
    const src = makeImage(64, 64, 'gradient')
    const out = decodeBc1(encodeBc1(src, 64, 64), 64, 64)
    expect(maxChannelError(src, out, [0, 1, 2])).toBeLessThanOrEqual(12)
  })

  it('noise stays in range but is NOT asserted tightly — BC1 cannot represent it', () => {
    // Documented deliberately: a tolerance loose enough to pass noise (~170)
    // would pass a broken decoder too. Assert only what must hold.
    const src = makeImage(32, 32, 'noise', 99)
    const out = decodeBc1(encodeBc1(src, 32, 32), 32, 32)
    expect(out.length).toBe(32 * 32 * 4)
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeLessThanOrEqual(255)
    // Alpha must be opaque for BC1 output regardless of colour content.
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255)
  })
})

describe('BC3 alpha — both palette modes', () => {
  it('an alpha RAMP round-trips within 12 (measured max 10)', () => {
    // A ramp forces a0 != a1, i.e. the 8-value interpolated palette — the
    // branch the constant-alpha test does not reach. Together they cover both
    // sides of `if (a0 > a1)`, and a wrong endpoint read (src[off+1] ->
    // src[off-1]) skews the ramp well past this bound.
    for (const [w, h] of [[8, 8], [16, 16], [64, 64], [7, 3]] as Array<[number, number]>) {
      const src = makeImage(w, h, 'alphaRamp')
      const out = decodeBc3(encodeBc3(src, w, h), w, h)
      expect(maxChannelError(src, out, [3]), `alpha ${w}x${h}`).toBeLessThanOrEqual(12)
    }
  })

  it('alpha is monotonic along a monotonic ramp', () => {
    // Structural, tolerance-free: whatever the quantisation, a left-to-right
    // ramp must not go backwards by more than one quantisation step. A wrong
    // palette mode or endpoint produces a non-monotonic zig-zag.
    const w = 64, h = 4
    const src = makeImage(w, h, 'alphaRamp')
    const out = decodeBc3(encodeBc3(src, w, h), w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        const prev = out[(y * w + x - 1) * 4 + 3]
        const cur = out[(y * w + x) * 4 + 3]
        expect(cur, `row ${y} col ${x} went backwards`).toBeGreaterThanOrEqual(prev - 20)
      }
    }
  })

  it('fully transparent and fully opaque blocks survive exactly', () => {
    const w = 8, h = 8
    for (const alpha of [0, 255]) {
      const src = new Uint8ClampedArray(w * h * 4)
      for (let p = 0; p < src.length; p += 4) {
        src[p] = 10; src[p + 1] = 20; src[p + 2] = 30; src[p + 3] = alpha
      }
      const out = decodeBc3(encodeBc3(src, w, h), w, h)
      for (let p = 3; p < out.length; p += 4) {
        expect(out[p], `alpha ${alpha}`).toBe(alpha)
      }
    }
  })
})

describe('BC codecs — determinism and independence', () => {
  it('encoding is deterministic across runs', () => {
    const src = makeImage(16, 16, 'noise', 7)
    expect(Array.from(encodeBc1(src, 16, 16))).toEqual(Array.from(encodeBc1(src, 16, 16)))
    expect(Array.from(encodeBc3(src, 16, 16))).toEqual(Array.from(encodeBc3(src, 16, 16)))
  })

  it('BC3 carries the SAME colour block as BC1 for identical RGB', () => {
    // Measured: BC1 and BC3 produce identical RGB error on every input, because
    // BC3 is BC1's colour block plus an alpha block. If a mutation breaks one
    // colour path and not the other, this diverges.
    const src = makeImage(16, 16, 'gradient')
    const rgb1 = decodeBc1(encodeBc1(src, 16, 16), 16, 16)
    const rgb3 = decodeBc3(encodeBc3(src, 16, 16), 16, 16)
    expect(maxChannelError(rgb1, rgb3, [0, 1, 2])).toBe(0)
  })

  it('a change in ONE block does not alter any other block', () => {
    // Block independence is the core BC invariant. A wrong offset
    // (src[off + 1] -> src[off - 1], or a bad srcOff stride) leaks across
    // block boundaries and trips this.
    const w = 16, h = 16
    const a = makeImage(w, h, 'solid')
    const b = makeImage(w, h, 'solid')
    // Perturb a single pixel inside the first 4x4 block only.
    b[0] = 0; b[1] = 255; b[2] = 0
    const da = decodeBc1(encodeBc1(a, w, h), w, h)
    const db = decodeBc1(encodeBc1(b, w, h), w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < 4 && y < 4) continue // the touched block may legitimately differ
        const i = (y * w + x) * 4
        expect(da[i], `leaked into block at ${x},${y}`).toBe(db[i])
        expect(da[i + 1]).toBe(db[i + 1])
        expect(da[i + 2]).toBe(db[i + 2])
      }
    }
  })
})
