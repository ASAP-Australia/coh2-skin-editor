// inflate.worker.ts — pako inflate/inflateRaw in a Web Worker.
// Keeps zlib decompression off the main thread so CSS/spinner animations
// stay smooth while SGA vehicle bytes are being read during preloading.
// Only pure typed-array operations; no DOM, no Node APIs.
import { inflate, inflateRaw } from 'pako'

interface InflateRequest {
  id: number
  compressed: ArrayBuffer // transferred — zero copy
}

interface InflateResponse {
  id: number
  inflated: ArrayBuffer // transferred — zero copy
  error?: string
}

self.onmessage = (e: MessageEvent<InflateRequest>) => {
  const { id, compressed } = e.data
  const src = new Uint8Array(compressed)
  let result: Uint8Array
  try {
    // Mirror the same try/catch fallback as the sync path in sga.ts:
    // try zlib inflate first (header present), fall back to raw deflate.
    try {
      result = inflate(src)
    } catch {
      result = inflateRaw(src)
    }
  } catch (err: unknown) {
    const res: InflateResponse = {
      id,
      inflated: new ArrayBuffer(0),
      error: err instanceof Error ? err.message : String(err),
    }
    ;(self as unknown as Worker).postMessage(res, [res.inflated])
    return
  }
  // Slice out an owned ArrayBuffer so we can transfer without neutering a
  // view into a larger buffer that might be aliased elsewhere.
  const owned = result.buffer.slice(
    result.byteOffset,
    result.byteOffset + result.byteLength,
  ) as ArrayBuffer
  const res: InflateResponse = { id, inflated: owned }
  ;(self as unknown as Worker).postMessage(res, [res.inflated])
}
