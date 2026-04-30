/**
 * Pure-JS BC1 / BC3 (DXT1 / DXT5) decoder.
 *
 * The editor needs CPU-side RGBA pixels of the diffuse texture so we can
 * paint decals on top of it via Canvas2D and feed the result back as a
 * Three.js CanvasTexture. The compressed-texture path is faster on the GPU
 * but doesn't let us read pixels back. Software decoding once at vehicle-
 * load time is fine — it's well under 100 ms even for 2048² BC3 (the worst
 * case in CoH2's set).
 *
 * Format references:
 *   BC1:  Microsoft S3TC §6.1  (1-bit alpha, 8-byte block)
 *   BC3:  Microsoft S3TC §6.4  (8-bit alpha + BC1 colour, 16-byte block)
 */

/** Decode a BC1 (DXT1) byte stream → RGBA Uint8ClampedArray. */
export function decodeBc1(src: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  const blocksW = Math.max(1, Math.ceil(width / 4))
  const blocksH = Math.max(1, Math.ceil(height / 4))
  let srcOff = 0
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      decodeColourBlock(src, srcOff, false, bx * 4, by * 4, width, height, out)
      srcOff += 8
    }
  }
  return out
}

/** Decode a BC3 (DXT5) byte stream → RGBA Uint8ClampedArray. */
export function decodeBc3(src: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  const blocksW = Math.max(1, Math.ceil(width / 4))
  const blocksH = Math.max(1, Math.ceil(height / 4))
  let srcOff = 0
  const alphaBuf = new Uint8Array(16)
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      // Alpha block (8 bytes)
      decodeAlphaBlock(src, srcOff, alphaBuf)
      srcOff += 8
      // Colour block (8 bytes, no 1-bit alpha — solid mode)
      decodeColourBlock(src, srcOff, true, bx * 4, by * 4, width, height, out, alphaBuf)
      srcOff += 8
    }
  }
  return out
}

function decodeAlphaBlock(src: Uint8Array, off: number, alphaBuf: Uint8Array) {
  const a0 = src[off], a1 = src[off + 1]
  const palette = new Uint8Array(8)
  palette[0] = a0; palette[1] = a1
  if (a0 > a1) {
    palette[2] = (6 * a0 + 1 * a1) / 7
    palette[3] = (5 * a0 + 2 * a1) / 7
    palette[4] = (4 * a0 + 3 * a1) / 7
    palette[5] = (3 * a0 + 4 * a1) / 7
    palette[6] = (2 * a0 + 5 * a1) / 7
    palette[7] = (1 * a0 + 6 * a1) / 7
  } else {
    palette[2] = (4 * a0 + 1 * a1) / 5
    palette[3] = (3 * a0 + 2 * a1) / 5
    palette[4] = (2 * a0 + 3 * a1) / 5
    palette[5] = (1 * a0 + 4 * a1) / 5
    palette[6] = 0
    palette[7] = 255
  }
  // 48 bits of indices (6 bytes)
  let idxLow = src[off + 2] | (src[off + 3] << 8) | (src[off + 4] << 16)
  let idxHigh = src[off + 5] | (src[off + 6] << 8) | (src[off + 7] << 16)
  for (let i = 0; i < 8; i++) {
    alphaBuf[i] = palette[idxLow & 7]; idxLow >>>= 3
  }
  for (let i = 8; i < 16; i++) {
    alphaBuf[i] = palette[idxHigh & 7]; idxHigh >>>= 3
  }
}

/** Decode a 4×4 colour block. If `bc3`, ignore the colour-block alpha; the
 *  caller fills alpha from the alphaBuf arg. */
function decodeColourBlock(
  src: Uint8Array, off: number, bc3: boolean,
  x0: number, y0: number, width: number, height: number,
  out: Uint8ClampedArray, alphaBuf?: Uint8Array,
) {
  const c0 = src[off] | (src[off + 1] << 8)
  const c1 = src[off + 2] | (src[off + 3] << 8)
  const r0 = ((c0 >> 11) & 0x1f) << 3
  const g0 = ((c0 >> 5)  & 0x3f) << 2
  const b0 = ((c0)       & 0x1f) << 3
  const r1 = ((c1 >> 11) & 0x1f) << 3
  const g1 = ((c1 >> 5)  & 0x3f) << 2
  const b1 = ((c1)       & 0x1f) << 3
  const palette = [
    r0 | (r0 >> 5), g0 | (g0 >> 6), b0 | (b0 >> 5), 255,
    r1 | (r1 >> 5), g1 | (g1 >> 6), b1 | (b1 >> 5), 255,
    0, 0, 0, 255,
    0, 0, 0, 255,
  ]
  if (bc3 || c0 > c1) {
    palette[ 8] = (palette[0] * 2 + palette[4]) / 3
    palette[ 9] = (palette[1] * 2 + palette[5]) / 3
    palette[10] = (palette[2] * 2 + palette[6]) / 3
    palette[12] = (palette[0] + palette[4] * 2) / 3
    palette[13] = (palette[1] + palette[5] * 2) / 3
    palette[14] = (palette[2] + palette[6] * 2) / 3
  } else {
    palette[ 8] = (palette[0] + palette[4]) / 2
    palette[ 9] = (palette[1] + palette[5]) / 2
    palette[10] = (palette[2] + palette[6]) / 2
    palette[12] = 0; palette[13] = 0; palette[14] = 0; palette[15] = 0  // BC1 punchthrough
  }
  let idx = src[off + 4] | (src[off + 5] << 8) | (src[off + 6] << 16) | (src[off + 7] << 24)
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const code = (idx >>> ((py * 4 + px) * 2)) & 3
      const x = x0 + px, y = y0 + py
      if (x >= width || y >= height) continue
      const di = (y * width + x) * 4
      out[di    ] = palette[code * 4    ]
      out[di + 1] = palette[code * 4 + 1]
      out[di + 2] = palette[code * 4 + 2]
      out[di + 3] = bc3 && alphaBuf
        ? alphaBuf[py * 4 + px]
        : palette[code * 4 + 3]
    }
  }
}

/** Decode RGT (already extracted to BC bytes + dimensions + format) into an
 *  HTMLCanvasElement we can re-read and draw on with Canvas2D. */
export function bcToCanvas(
  pixels: Uint8Array, width: number, height: number, fourCC: 'DXT1' | 'DXT5',
): HTMLCanvasElement {
  const rgba = fourCC === 'DXT1'
    ? decodeBc1(pixels, width, height)
    : decodeBc3(pixels, width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  // ImageData expects a Uint8ClampedArray with a plain ArrayBuffer; copy in
  // case the buffer is shared (TS strict won't accept SharedArrayBuffer).
  const data = new Uint8ClampedArray(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer)
  const img = new ImageData(data, width, height)
  ctx.putImageData(img, 0, 0)
  return canvas
}
