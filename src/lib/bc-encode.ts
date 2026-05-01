/**
 * BC3 (DXT5) encoder — pure JS, 4×4 block compressor for the diffuse
 * texture pipeline. Quality is "passable" rather than artist-grade —
 * we do simple min-max endpoint selection per block, not the iterative
 * least-squares refinement that high-end compressors use. For the dirt
 * + camo + bortnummer content we paint, the visual difference from a
 * hand-tuned compressor is invisible at gameplay distance.
 *
 * Output layout per 4×4 block (16 bytes, BC3):
 *   8 bytes alpha block: a0, a1, then 6 bytes of 3-bit indices (16 pixels)
 *   8 bytes colour block: c0 (RGB565), c1 (RGB565), then 4 bytes of 2-bit
 *                         indices (16 pixels)
 *
 * The `alpha endpoints unused-mode` (a0 ≤ a1) indicates implicit 0/255
 * extra palette entries; we always use the a0 > a1 branch (8-step linear
 * interpolation, no special slots) for simplicity.
 */

/** Encode a flat RGBA Uint8ClampedArray (width × height × 4) into BC3 bytes. */
export function encodeBc3(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const blocksW = Math.max(1, Math.ceil(width / 4))
  const blocksH = Math.max(1, Math.ceil(height / 4))
  const out = new Uint8Array(blocksW * blocksH * 16)
  const block = new Uint8Array(64)  // 4×4 RGBA pixels = 64 bytes
  let dst = 0
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      // Gather the block into a contiguous buffer (handles edge clamping)
      for (let py = 0; py < 4; py++) {
        const sy = Math.min(by * 4 + py, height - 1)
        for (let px = 0; px < 4; px++) {
          const sx = Math.min(bx * 4 + px, width - 1)
          const si = (sy * width + sx) * 4
          const di = (py * 4 + px) * 4
          block[di    ] = rgba[si    ]
          block[di + 1] = rgba[si + 1]
          block[di + 2] = rgba[si + 2]
          block[di + 3] = rgba[si + 3]
        }
      }
      writeAlphaBlock(block, out, dst);  dst += 8
      writeColourBlock(block, out, dst); dst += 8
    }
  }
  return out
}

/** BC4-style alpha block: 8-bit endpoints + 3-bit per-pixel indices. */
function writeAlphaBlock(block: Uint8Array, out: Uint8Array, dst: number) {
  let aMin = 255, aMax = 0
  for (let i = 0; i < 16; i++) {
    const a = block[i * 4 + 3]
    if (a < aMin) aMin = a
    if (a > aMax) aMax = a
  }
  // Ensure a0 > a1 path (8-stop interpolation, no implicit 0/255 slots)
  if (aMin === aMax) {
    // Constant alpha — every index = 0, palette[0] = aMax
    out[dst    ] = aMax
    out[dst + 1] = aMin
    for (let i = 2; i < 8; i++) out[dst + i] = 0
    return
  }
  out[dst    ] = aMax
  out[dst + 1] = aMin
  // Build the 8-entry palette
  const pal = new Uint8Array(8)
  pal[0] = aMax; pal[1] = aMin
  for (let i = 1; i <= 6; i++) pal[i + 1] = ((7 - i) * aMax + i * aMin) / 7
  // For each pixel pick the closest palette entry
  const idx = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    const a = block[i * 4 + 3]
    let best = 0, bestD = 1e9
    for (let p = 0; p < 8; p++) {
      const d = Math.abs(a - pal[p])
      if (d < bestD) { bestD = d; best = p }
    }
    idx[i] = best
  }
  // Pack: 16 indices × 3 bits = 48 bits = 6 bytes
  let lo = 0, hi = 0
  for (let i = 0; i < 8; i++) lo |= (idx[i] & 7) << (i * 3)
  for (let i = 0; i < 8; i++) hi |= (idx[i + 8] & 7) << (i * 3)
  out[dst + 2] = lo & 0xff
  out[dst + 3] = (lo >>> 8) & 0xff
  out[dst + 4] = (lo >>> 16) & 0xff
  out[dst + 5] = hi & 0xff
  out[dst + 6] = (hi >>> 8) & 0xff
  out[dst + 7] = (hi >>> 16) & 0xff
}

/** BC1 colour block (BC3's colour subblock is identical, sans 1-bit alpha). */
function writeColourBlock(block: Uint8Array, out: Uint8Array, dst: number) {
  // Pick endpoints: project each pixel onto the RGB principal axis; the two
  // extremes of the projection are the endpoints. Cheap approximation: use
  // the bounding box's longest axis. Good enough for camo/dirt/decals.
  let r0 = 255, g0 = 255, b0 = 255
  let r1 = 0,   g1 = 0,   b1 = 0
  for (let i = 0; i < 16; i++) {
    const r = block[i * 4    ]
    const g = block[i * 4 + 1]
    const b = block[i * 4 + 2]
    if (r < r0) r0 = r; if (r > r1) r1 = r
    if (g < g0) g0 = g; if (g > g1) g1 = g
    if (b < b0) b0 = b; if (b > b1) b1 = b
  }
  // Quantise to 565
  const c0_565 = pack565(r1, g1, b1)
  const c1_565 = pack565(r0, g0, b0)
  out[dst    ] =  c0_565        & 0xff
  out[dst + 1] = (c0_565 >>> 8) & 0xff
  out[dst + 2] =  c1_565        & 0xff
  out[dst + 3] = (c1_565 >>> 8) & 0xff
  // Build 4-entry palette in 8-bit RGB (for index lookup)
  const pal = new Uint8Array(16)
  unpack565(c0_565, pal, 0); unpack565(c1_565, pal, 4)
  if (c0_565 > c1_565) {
    pal[ 8] = (2 * pal[0] + pal[4]) / 3
    pal[ 9] = (2 * pal[1] + pal[5]) / 3
    pal[10] = (2 * pal[2] + pal[6]) / 3
    pal[12] = (pal[0] + 2 * pal[4]) / 3
    pal[13] = (pal[1] + 2 * pal[5]) / 3
    pal[14] = (pal[2] + 2 * pal[6]) / 3
  } else {
    pal[ 8] = (pal[0] + pal[4]) / 2
    pal[ 9] = (pal[1] + pal[5]) / 2
    pal[10] = (pal[2] + pal[6]) / 2
    pal[12] = 0; pal[13] = 0; pal[14] = 0
  }
  // Pick closest palette index for each pixel (sum-of-squared-differences)
  let bits = 0
  for (let i = 0; i < 16; i++) {
    const r = block[i * 4    ]
    const g = block[i * 4 + 1]
    const b = block[i * 4 + 2]
    let best = 0, bestD = 1e9
    for (let p = 0; p < 4; p++) {
      const dr = r - pal[p * 4    ]
      const dg = g - pal[p * 4 + 1]
      const db = b - pal[p * 4 + 2]
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) { bestD = d; best = p }
    }
    bits |= (best & 3) << (i * 2)
  }
  out[dst + 4] =  bits         & 0xff
  out[dst + 5] = (bits >>>  8) & 0xff
  out[dst + 6] = (bits >>> 16) & 0xff
  out[dst + 7] = (bits >>> 24) & 0xff
}

function pack565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
}
function unpack565(v: number, dst: Uint8Array, off: number) {
  const r5 = (v >>> 11) & 0x1f
  const g6 = (v >>> 5)  & 0x3f
  const b5 = v          & 0x1f
  dst[off    ] = (r5 << 3) | (r5 >> 2)
  dst[off + 1] = (g6 << 2) | (g6 >> 4)
  dst[off + 2] = (b5 << 3) | (b5 >> 2)
  dst[off + 3] = 255
}
