// decode.worker.ts — RGT inflate + BC1/BC3 decode in a Web Worker.
// Only pure typed-array operations; no DOM, no Three.js, no Node APIs.
import { inflate } from 'pako'
import { decodeBc1, decodeBc3 } from './bc-decode'
import { finishRgtDecode } from './rgt-core'

/**
 * Pre-inflated path: the main thread already inflated the mip bytes and just
 * wants the BC decode offloaded. `pixels` are raw DXT block bytes.
 */
interface DecodeRequest {
  id: number
  pixels: ArrayBuffer // transferred — zero copy
  width: number
  height: number
  fourCC: 'DXT1' | 'DXT5'
}

/**
 * Combined path (hot warmup): the main thread did only the cheap chunky header
 * parse and ships the still-COMPRESSED top-mip bytes. The worker inflates,
 * strips the optional per-mip header, classifies the format, and BC-decodes —
 * keeping the ~3s zlib inflate AND the BC decode entirely off the main thread
 * in a single round-trip.
 */
interface DecodeFullRequest {
  id: number
  compressed: ArrayBuffer // transferred — zero copy
  width: number
  height: number
  formatCode: number
}

interface DecodeResponse {
  id: number
  rgba: ArrayBuffer // transferred — zero copy
  /** Only present for the combined path — the classification the worker chose. */
  isSRGB?: boolean
  fourCC?: 'DXT1' | 'DXT5'
}

function isFull(d: DecodeRequest | DecodeFullRequest): d is DecodeFullRequest {
  return (d as DecodeFullRequest).compressed !== undefined
}

self.onmessage = (e: MessageEvent<DecodeRequest | DecodeFullRequest>) => {
  const data = e.data
  if (isFull(data)) {
    const { id, compressed, width, height, formatCode } = data
    const inflated = inflate(new Uint8Array(compressed))
    const rgt = finishRgtDecode(inflated, width, height, formatCode)
    const rgba = rgt.fourCC === 'DXT1'
      ? decodeBc1(rgt.pixels, rgt.width, rgt.height)
      : decodeBc3(rgt.pixels, rgt.width, rgt.height)
    const res: DecodeResponse = {
      id,
      rgba: rgba.buffer as ArrayBuffer,
      isSRGB: rgt.isSRGB,
      fourCC: rgt.fourCC,
    }
    ;(self as unknown as Worker).postMessage(res, [res.rgba])
    return
  }

  const { id, pixels, width, height, fourCC } = data
  const src = new Uint8Array(pixels)
  const rgba = fourCC === 'DXT1'
    ? decodeBc1(src, width, height)
    : decodeBc3(src, width, height)
  // Transfer the underlying buffer to the main thread — zero copy.
  const res: DecodeResponse = { id, rgba: rgba.buffer as ArrayBuffer }
  ;(self as unknown as Worker).postMessage(res, [res.rgba])
}
