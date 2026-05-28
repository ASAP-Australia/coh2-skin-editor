/**
 * Relic Generic Texture (.rgt) decoder.
 *
 * RGT is a Relic Chunky v3 container wrapping zlib-compressed DXT-encoded
 * texture mip pyramids. We decode the largest mip into a Uint8Array of
 * DXT bytes plus a synthesised DDS header, then hand it to a CompressedTexture
 * via Three.js's DDSLoader.
 *
 * Format walk:
 *   FOLD/TSET → FOLD/TXTR → FOLD/DXTC →
 *     DATA/TFMT (width, height, format)
 *     DATA/TMAN (mip table: per-mip { uncompressed, compressed } pairs)
 *     DATA/TDAT (concatenated zlib blocks, smallest mip first)
 *
 * Format codes (CoH2):
 *   13 → BC1 (DXT1)  — 8 bytes per 4×4 block
 *   15 → BC3 (DXT5)  — 16 bytes per 4×4 block
 *
 * We decompress only the largest mip and hand it off as-is. DDSLoader takes
 * the synthetic .dds bytes and the GPU does the BC decode.
 */

import * as THREE from 'three'
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js'
import { inflate } from 'pako'
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

export function decodeRgt(buf: ArrayBuffer | Uint8Array): DecodedRgt {
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
  let pixels: Uint8Array
  try { pixels = inflate(compressed) }
  catch (e) { throw new Error(`Failed to inflate top mip: ${(e as Error).message}`, { cause: e }) }

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

/** Convert decoded RGT into a Three.js CompressedTexture. */
export function rgtToCompressedTexture(rgt: DecodedRgt): THREE.CompressedTexture {
  // Synthesise a minimal DDS file the DDSLoader can parse, then use it.
  const dds = synthesiseDds(rgt)
  const ab = new ArrayBuffer(dds.byteLength)
  new Uint8Array(ab).set(dds)
  const loader = new DDSLoader()
  const parsed = loader.parse(ab, false)
  const tex = new THREE.CompressedTexture(
    parsed.mipmaps as ImageData[],
    parsed.width, parsed.height,
    parsed.format as THREE.CompressedPixelFormat, THREE.UnsignedByteType,
  )
  tex.minFilter = THREE.LinearFilter   // single mip — no mipmapping artifacts
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  tex.flipY = true   // CoH2 RGM UVs are D3D-style; we already flipped V on import
                     // — but DDSLoader doesn't flip, so we ask Three.js to.
                     // Combined with the V flip in rgm.ts this matches the original.
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** Build a 128-byte DDS header followed by the BC-encoded pixel bytes. */
function synthesiseDds(rgt: DecodedRgt): Uint8Array {
  const blocks = Math.max(1, Math.ceil(rgt.width / 4)) * Math.max(1, Math.ceil(rgt.height / 4))
  const blockSize = rgt.fourCC === 'DXT1' ? 8 : 16
  const out = new Uint8Array(128 + rgt.pixels.length)
  const v = new DataView(out.buffer)
  // Magic
  out.set([0x44, 0x44, 0x53, 0x20], 0)  // 'DDS '
  v.setUint32(4, 124, true)             // header size
  v.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, true)  // CAPS|HEIGHT|WIDTH|PIXELFORMAT|LINEARSIZE
  v.setUint32(12, rgt.height, true)
  v.setUint32(16, rgt.width, true)
  v.setUint32(20, blocks * blockSize, true)
  // mipmap count = 0 (we embed only the top mip)
  v.setUint32(28, 0, true)
  // pixel format at offset 76: size, flags, fourCC
  v.setUint32(76, 32, true)             // size
  v.setUint32(80, 0x4, true)            // FOURCC flag
  const fourCC = rgt.fourCC === 'DXT1' ? [0x44, 0x58, 0x54, 0x31] : [0x44, 0x58, 0x54, 0x35]
  out.set(fourCC, 84)
  v.setUint32(108, 0x1000, true)        // caps: TEXTURE
  // copy pixels
  out.set(rgt.pixels, 128)
  return out
}
