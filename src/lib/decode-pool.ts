// decode-pool.ts — Small round-robin pool of BC decode workers.
// Keeps BC1/BC3 decompression off the main thread; canvas painting and
// Three.js texture creation stay on the main thread (DOM/WebGL required).

import type { DecodedRgt, RgtHeader } from './rgt'

/** Result of the combined inflate+BC-decode off-thread path. */
export interface DecodedRgba {
  rgba: Uint8ClampedArray
  width: number
  height: number
  isSRGB: boolean
  fourCC: 'DXT1' | 'DXT5'
}

interface WorkerResponse {
  id: number
  rgba: ArrayBuffer
  isSRGB?: boolean
  fourCC?: 'DXT1' | 'DXT5'
}

interface PendingTask {
  resolve: (res: WorkerResponse) => void
  reject: (err: Error) => void
}

// Size the pool to the host's logical cores so the Connect-time full-fleet
// warmup can saturate all available threads. BC decode is pure CPU; the cap
// keeps us from spawning an absurd number of workers on big machines, and the
// floor guarantees parallelism even when hardwareConcurrency is unreported.
const POOL_SIZE = Math.max(
  2,
  Math.min(8, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4),
)
let nextId = 0
const pending = new Map<number, PendingTask>()
const workers: Worker[] = []
let workerIdx = 0

function createWorker(): Worker {
  const w = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const task = pending.get(e.data.id)
    if (!task) return
    pending.delete(e.data.id)
    task.resolve(e.data)
  }
  w.onerror = (e: ErrorEvent) => {
    console.error('[decode-pool] worker error:', e.message)
    // Reject any tasks assigned to this worker that are still pending.
    // We can't easily know which tasks are on which worker, so reject all
    // pending to avoid hanging Promises. This is a fatal worker crash — rare.
    for (const [id, task] of pending) {
      pending.delete(id)
      task.reject(new Error(`[decode-pool] worker crashed: ${e.message}`))
    }
  }
  return w
}

function getWorker(): Worker {
  if (workers.length < POOL_SIZE) {
    const w = createWorker()
    workers.push(w)
    return w
  }
  // Round-robin across the pool.
  const w = workers[workerIdx % POOL_SIZE]
  workerIdx++
  return w
}

/**
 * Decode BC1/BC3 pixels off the main thread.
 *
 * The `rgt.pixels` buffer is TRANSFERRED to the worker — do not access
 * `rgt.pixels` after calling this function (the buffer will be detached).
 * Returns a Promise that resolves with the decoded RGBA bytes.
 */
export function decodeRgtOffThread(rgt: DecodedRgt): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve: r => resolve(new Uint8ClampedArray(r.rgba)), reject })
    const w = getWorker()
    // Slice out an owned ArrayBuffer to transfer (rgt.pixels may be a view
    // into a larger buffer; we must transfer exactly the pixel bytes).
    // After transfer, rgt.pixels.buffer is detached — caller must not reuse it.
    const buf = rgt.pixels.buffer.slice(
      rgt.pixels.byteOffset,
      rgt.pixels.byteOffset + rgt.pixels.byteLength,
    ) as ArrayBuffer
    w.postMessage(
      { id, pixels: buf, width: rgt.width, height: rgt.height, fourCC: rgt.fourCC },
      [buf],
    )
  })
}

/**
 * Combined inflate + BC-decode off the main thread.
 *
 * Pass the cheap header parse (`parseRgtHeader(bytes)`); this transfers the
 * still-COMPRESSED top-mip bytes to a worker which inflates, strips the per-mip
 * header, classifies the format and BC-decodes — so neither the ~3s zlib
 * inflate nor the BC decode ever runs on the main thread. This is the hot
 * Connect-screen warmup path.
 *
 * The `header.compressed` buffer is sliced into an owned buffer before transfer,
 * so the caller's original `bytes` are NOT detached and remain reusable.
 * Returns the decoded RGBA plus the classification the worker chose.
 */
export function decodeRgtFullOffThread(header: RgtHeader): Promise<DecodedRgba> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, {
      resolve: r =>
        resolve({
          rgba: new Uint8ClampedArray(r.rgba),
          width: header.width,
          height: header.height,
          isSRGB: r.isSRGB ?? true,
          fourCC: r.fourCC ?? 'DXT5',
        }),
      reject,
    })
    const w = getWorker()
    const src = header.compressed
    const buf = src.buffer.slice(
      src.byteOffset,
      src.byteOffset + src.byteLength,
    ) as ArrayBuffer
    w.postMessage(
      { id, compressed: buf, width: header.width, height: header.height, formatCode: header.formatCode },
      [buf],
    )
  })
}
