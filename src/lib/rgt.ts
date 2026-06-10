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
import {
  classifyTextureFormat,
  finishRgtDecode,
  parseRgtHeader,
  type DecodedRgt,
  type RgtHeader,
} from './rgt-core'

// Re-export the THREE-free core surface so existing importers of '@/lib/rgt'
// (Viewport, tests) keep working unchanged.
export { classifyTextureFormat, finishRgtDecode, parseRgtHeader }
export type { DecodedRgt, RgtHeader }

export function decodeRgt(buf: ArrayBuffer | Uint8Array): DecodedRgt {
  const { width, height, formatCode, compressed } = parseRgtHeader(buf)
  let inflated: Uint8Array
  try { inflated = inflate(compressed) }
  catch (e) { throw new Error(`Failed to inflate top mip: ${(e as Error).message}`, { cause: e }) }
  return finishRgtDecode(inflated, width, height, formatCode)
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
