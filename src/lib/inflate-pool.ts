// inflate-pool.ts — Small round-robin pool of pako inflate workers.
// Keeps zlib decompression off the main thread during SGA file reads so that
// CSS animations (spinner, BorderBeam) stay smooth at 60fps while vehicle
// data loads in the Connect screen's 'preloading' phase.
//
// Mirrors decode-pool.ts structure exactly; pool size matches to avoid
// oversubscription alongside the existing BC-decode pool.

import { inflate, inflateRaw } from 'pako'

interface PendingTask {
  resolve: (data: Uint8Array) => void
  reject: (err: Error) => void
}

// Match decode-pool.ts sizing: floor at 2, cap at 8, default to cores/2 so
// we don't oversubscribe the decode pool running alongside this one.
const POOL_SIZE = Math.max(
  2,
  Math.min(4, Math.floor(((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) / 2)),
)

// Worker availability guard — safe in Node/test environments where Worker is absent.
const WORKERS_AVAILABLE = typeof Worker !== 'undefined'

let nextId = 0
const pending = new Map<number, PendingTask>()
const workers: Worker[] = []
let workerIdx = 0

function createWorker(): Worker {
  // Mirror decode-pool.ts exactly: new Worker(new URL(...), { type: 'module' })
  const w = new Worker(new URL('./inflate.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<{ id: number; inflated: ArrayBuffer; error?: string }>) => {
    const task = pending.get(e.data.id)
    if (!task) return
    pending.delete(e.data.id)
    if (e.data.error) {
      task.reject(new Error(`[inflate-pool] worker error: ${e.data.error}`))
    } else {
      task.resolve(new Uint8Array(e.data.inflated))
    }
  }
  w.onerror = (e: ErrorEvent) => {
    console.error('[inflate-pool] worker error:', e.message)
    // Reject all pending tasks on a fatal worker crash (rare).
    for (const [id, task] of pending) {
      pending.delete(id)
      task.reject(new Error(`[inflate-pool] worker crashed: ${e.message}`))
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
 * Inflate zlib/deflate-compressed bytes off the main thread.
 *
 * FALLBACK: if Worker is unavailable (Node/test environment) this falls back
 * to synchronous pako.inflate so correctness never regresses.
 *
 * TRANSFER SAFETY: the caller must ensure `compressed` is an owned
 * ArrayBuffer (not a view into a larger shared buffer). If the source buffer
 * is aliased, copy it with `.slice()` before calling this function — once
 * transferred the original buffer is neutered.
 *
 * @param compressed  Owned ArrayBuffer containing zlib or raw deflate bytes.
 * @returns           Promise resolving to the inflated Uint8Array.
 */
export function inflateOffThread(compressed: ArrayBuffer): Promise<Uint8Array> {
  // Sync fallback for Node/test environments.
  if (!WORKERS_AVAILABLE) {
    try {
      return Promise.resolve(inflate(new Uint8Array(compressed)))
    } catch {
      return Promise.resolve(inflateRaw(new Uint8Array(compressed)))
    }
  }

  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const w = getWorker()
    // Transfer the buffer to the worker — zero copy.
    w.postMessage({ id, compressed }, [compressed])
  })
}
