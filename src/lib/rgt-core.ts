/**
 * THREE-free core of the RGT decoder.
 *
 * Everything here is pure typed-array work (chunky parse, mip-table read,
 * inflate-result post-processing, format classification) so it can run BOTH on
 * the main thread (via rgt.ts) and inside a Web Worker (decode.worker.ts) —
 * letting the hot warmup path fold the zlib inflate + BC decode into a single
 * off-thread round-trip without dragging Three.js into the worker bundle.
 *
 * The Three.js-dependent helpers (rgtToCompressedTexture / synthesiseDds) stay
 * in rgt.ts, which re-exports this module's surface for backwards compat.
 */

import { parseChunky, findChunk } from './chunky'

export interface DecodedRgt {
  width: number
  height: number
  fourCC: 'DXT1' | 'DXT5'
  /** Raw format code from the TFMT chunk (e.g. 13 = BC1 linear, 15 = BC3 linear). */
  formatCode: number
  /** True when the format code indicates sRGB colour space (codes 22, 24). */
  isSRGB: boolean
  /** Raw BC-encoded pixel bytes for the largest mip. */
  pixels: Uint8Array
}

/** Cheap RGT header parse: chunky walk + mip table, WITHOUT inflating. */
export interface RgtHeader {
  width: number
  height: number
  formatCode: number
  /** Still zlib-compressed bytes for the largest mip (a view into `buf`). */
  compressed: Uint8Array
}

/** Map a CoH2 TFMT format code to a BC variant + sRGB flag.
 *
 * Known codes (from corsix/coh2-explorer texture_loader.cpp lines 73–101):
 *   13 → BC1 linear (DXT1)    22 → BC1 sRGB
 *   15 → BC3 linear (DXT5)    24 → BC3 sRGB
 * All other codes (including BC2=14/23, BC7=16/25, uncompressed formats)
 * return null — the caller falls back to the byte-count heuristic. */
export function classifyTextureFormat(
  code: number,
): { fourCC: 'DXT1' | 'DXT5'; isSRGB: boolean } | null {
  switch (code) {
    case 13: return { fourCC: 'DXT1', isSRGB: false }
    case 22: return { fourCC: 'DXT1', isSRGB: true  }
    case 15: return { fourCC: 'DXT5', isSRGB: false }
    case 24: return { fourCC: 'DXT5', isSRGB: true  }
    default: return null
  }
}

export function parseRgtHeader(buf: ArrayBuffer | Uint8Array): RgtHeader {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const { root } = parseChunky(u8)
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)

  const tfmt = findChunk(root, 'TFMT')
  const tman = findChunk(root, 'TMAN')
  const tdat = findChunk(root, 'TDAT')
  if (!tfmt || !tman || !tdat) {
    throw new Error('RGT missing TFMT/TMAN/TDAT chunks')
  }

  // TFMT layout: u32 width, u32 height, u32 ?, u32 ?, u32 formatCode, …
  const width = view.getUint32(tfmt.payloadOffset, true)
  const height = view.getUint32(tfmt.payloadOffset + 4, true)
  const formatCode = view.getUint32(tfmt.payloadOffset + 16, true)

  // TMAN: u32 mip_count, then per-mip { u32 uncompressed_size, u32 compressed_size }
  const mipCount = view.getUint32(tman.payloadOffset, true)
  let cursor = tman.payloadOffset + 4
  const mips: { unc: number; cmp: number }[] = []
  for (let i = 0; i < mipCount; i++) {
    const unc = view.getUint32(cursor, true); cursor += 4
    const cmp = view.getUint32(cursor, true); cursor += 4
    mips.push({ unc, cmp })
  }

  // TDAT contains concatenated zlib blocks, smallest mip first → largest last.
  // We only want the largest.
  let offset = 0
  for (let i = 0; i < mips.length - 1; i++) offset += mips[i].cmp
  const last = mips[mips.length - 1]
  const compressed = u8.subarray(tdat.payloadOffset + offset, tdat.payloadOffset + offset + last.cmp)
  return { width, height, formatCode, compressed }
}

/**
 * Finish a decode from already-inflated mip bytes: strip the optional per-mip
 * header and classify the BC format. Pure typed-array work (no THREE, no
 * inflate) so it can run either on the main thread or inside a worker.
 */
export function finishRgtDecode(
  inflated: Uint8Array,
  width: number,
  height: number,
  formatCode: number,
): DecodedRgt {
  let pixels = inflated
  // Strip optional 16-byte per-mip header when present. Real CoH2 RGTs sometimes
  // prepend a per-mip header: [4 zero bytes | width u32LE | height u32LE | 4 bytes | 0x?? 0x20].
  // We detect it by checking that bytes[4..7] == width and bytes[8..11] == height.
  if (pixels.length >= 16) {
    const hdrView = new DataView(pixels.buffer, pixels.byteOffset)
    const hdrW = hdrView.getUint32(4, true)
    const hdrH = hdrView.getUint32(8, true)
    if (hdrW === width && hdrH === height) {
      pixels = pixels.subarray(16)
    }
  }

  // Try the authoritative format-code table first; fall back to byte-count
  // heuristic for codes not in the table (more robust for future format codes).
  // Unknown format codes default to isSRGB=true (most real-world diffuse maps
  // use sRGB colour space; safer default than false).
  const classified = classifyTextureFormat(formatCode)
  const blocks = Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4))
  const isBc1Heuristic = Math.abs(pixels.length - blocks * 8) < Math.abs(pixels.length - blocks * 16)
  const fourCC = classified?.fourCC ?? (isBc1Heuristic ? 'DXT1' : 'DXT5')
  const isSRGB = classified?.isSRGB ?? true  // unknown codes → assume sRGB

  return { width, height, fourCC, formatCode, isSRGB, pixels }
}
