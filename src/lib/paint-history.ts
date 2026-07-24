/**
 * paint-history — a framework-agnostic, memory-bounded undo/redo ring for the
 * vehicle texture painter (R4: non-destructive editing affordances).
 *
 * WHY A SEPARATE PRIMITIVE
 * ------------------------
 * The project-level history (`editor-history.ts` → `decal-history.ts`) restores
 * decal state + a persisted diffuse *data-URL* per vehicle and is wired into the
 * global Editor. This class is a smaller, self-contained model for the paint
 * surface itself: it stores raw pixel snapshots of the paint canvas so a stroke
 * can be reverted without round-tripping through PNG encode/decode, and it is
 * pure (no React, no DOM) so its push / undo / redo / cap semantics are unit
 * testable in isolation.
 *
 * MEMORY BOUND (the important part)
 * ---------------------------------
 * A single 2048² RGBA snapshot is 2048 * 2048 * 4 = 16 MiB. A naive "keep the
 * last 25 snapshots" cap would be 400 MiB — unacceptable. This ring is bounded
 * by BOTH:
 *   • a byte budget (`maxBytes`, default 128 MiB ≈ 8 full-atlas snapshots), and
 *   • a hard frame count (`maxFrames`, default 25),
 * whichever binds first. On overflow the OLDEST undo frame is evicted (its bytes
 * are subtracted and the buffer is released for GC). Because eviction only ever
 * drops the deepest-undo frame, recent undo depth is preserved under pressure —
 * you simply lose the ability to undo very old strokes, which is the correct
 * degradation for a painter.
 *
 * SNAPSHOTS
 * ---------
 * A snapshot is an opaque `PaintSnapshot` carrying an RGBA byte buffer plus its
 * dimensions. The class never touches a canvas — the caller captures pixels
 * (e.g. `ctx.getImageData(...).data`) at stroke-begin and applies a restored
 * snapshot (`ctx.putImageData(...)`) on undo/redo. This keeps the model testable
 * with plain typed arrays and lets the caller decide full-canvas vs dirty-region
 * snapshots (both satisfy the `bytes` contract).
 */

export interface PaintSnapshot {
  /** RGBA pixel bytes (length === width * height * 4). */
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  /** Human-readable label, e.g. "Paint" / "Erase" / "Clear". */
  readonly label: string
}

export interface PaintHistoryOptions {
  /**
   * Total byte budget across all retained undo frames. Default 128 MiB.
   * At 16 MiB / full 2048² frame this is ~8 frames; smaller (dirty-region)
   * snapshots fit proportionally more.
   */
  maxBytes?: number
  /** Hard cap on retained undo frames regardless of size. Default 25. */
  maxFrames?: number
}

const MIB = 1024 * 1024
const DEFAULT_MAX_BYTES = 128 * MIB
const DEFAULT_MAX_FRAMES = 25

function snapshotBytes(s: PaintSnapshot): number {
  // Track the logical RGBA payload (width*height*4). data.byteLength would also
  // work, but computing from dimensions keeps the accounting stable even if a
  // caller passes a view with extra backing capacity.
  return s.width * s.height * 4
}

/**
 * Bounded undo/redo stack of paint-canvas pixel snapshots.
 *
 * Model: `past` holds committed states (past[last] = most recent), `future`
 * holds undone states available for redo (future[0] = next redo). Pushing a new
 * snapshot clears the redo future — the standard linear-history contract.
 */
export class PaintHistory {
  private past: PaintSnapshot[] = []
  private future: PaintSnapshot[] = []
  private bytes = 0
  private readonly maxBytes: number
  private readonly maxFrames: number

  constructor(opts: PaintHistoryOptions = {}) {
    this.maxBytes = Math.max(1, opts.maxBytes ?? DEFAULT_MAX_BYTES)
    this.maxFrames = Math.max(1, opts.maxFrames ?? DEFAULT_MAX_FRAMES)
  }

  /**
   * Push a snapshot of the canvas state onto the undo stack. Clears the redo
   * future. Evicts oldest frames until both the byte budget and frame cap hold.
   *
   * Call this BEFORE mutating the canvas for a new stroke (it records the state
   * you will be able to return to), OR after — the model is agnostic; the caller
   * decides the convention. VehicleTextureEditor pushes the pre-stroke state.
   */
  push(snap: PaintSnapshot): void {
    // A new committed action invalidates the redo future.
    this.future = []
    this.past.push(snap)
    this.bytes += snapshotBytes(snap)
    this.trim()
  }

  /** True if there is at least one frame to undo to. */
  canUndo(): boolean {
    return this.past.length > 0
  }

  /** True if there is at least one undone frame to redo. */
  canRedo(): boolean {
    return this.future.length > 0
  }

  /**
   * Undo: move the most-recent past frame to the redo future and return it so
   * the caller can restore its pixels. Returns null when nothing to undo.
   *
   * `current` is the live canvas state, captured here so redo can return to it.
   * (Symmetric with redo; keeps the ring self-consistent regardless of caller
   * bookkeeping.) When omitted, the popped frame is still moved to `future` so a
   * plain undo/redo round-trip works — pass `current` when the live pixels have
   * diverged from the last pushed frame (they always do after a fresh stroke).
   */
  undo(current?: PaintSnapshot): PaintSnapshot | null {
    const frame = this.past.pop()
    if (!frame) return null
    this.bytes -= snapshotBytes(frame)
    // The state we are leaving becomes redo-able. Prefer the caller's live
    // snapshot; fall back to the popped frame so a bare undo()/redo() still
    // round-trips in tests and no-current callers.
    this.future.unshift(current ?? frame)
    // future is bounded by the same caps (it holds real pixel buffers too).
    this.trimFuture()
    return frame
  }

  /**
   * Redo: move the next future frame back onto the past stack and return it for
   * restoration. Returns null when nothing to redo.
   */
  redo(current?: PaintSnapshot): PaintSnapshot | null {
    const frame = this.future.shift()
    if (!frame) return null
    // The state we are leaving becomes undo-able again.
    this.past.push(current ?? frame)
    this.bytes += snapshotBytes(current ?? frame)
    this.trim()
    return frame
  }

  /** Drop all history and release buffers. */
  clear(): void {
    this.past = []
    this.future = []
    this.bytes = 0
  }

  /** Number of undo frames currently retained. */
  get length(): number {
    return this.past.length
  }

  /** Total bytes retained across undo frames (for tests / diagnostics). */
  get byteSize(): number {
    return this.bytes
  }

  /** Label of the frame the next undo() would return, or null. */
  peekUndoLabel(): string | null {
    return this.past.length ? this.past[this.past.length - 1].label : null
  }

  /** Label of the frame the next redo() would return, or null. */
  peekRedoLabel(): string | null {
    return this.future.length ? this.future[0].label : null
  }

  /** Evict oldest undo frames until byte + frame caps both hold. */
  private trim(): void {
    while (this.past.length > this.maxFrames && this.past.length > 1) {
      const dropped = this.past.shift()!
      this.bytes -= snapshotBytes(dropped)
    }
    while (this.bytes > this.maxBytes && this.past.length > 1) {
      const dropped = this.past.shift()!
      this.bytes -= snapshotBytes(dropped)
    }
  }

  /** Keep the redo future bounded too (it holds live pixel buffers). */
  private trimFuture(): void {
    while (this.future.length > this.maxFrames) {
      this.future.pop() // drop the oldest (deepest) redo frame
    }
  }
}
