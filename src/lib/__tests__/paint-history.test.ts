/**
 * Tests for paint-history.ts — the memory-bounded undo/redo ring used by the
 * vehicle texture painter (R4).
 *
 * Covers:
 *  (1) push / canUndo / canRedo basics
 *  (2) undo → redo round-trip returns the same snapshots (LIFO)
 *  (3) a new push after an undo clears the redo future
 *  (4) frame-count cap evicts the OLDEST undo frame
 *  (5) byte budget cap evicts oldest frames and keeps byteSize within budget
 *  (6) labels: peekUndoLabel / peekRedoLabel track the stacks
 *  (7) clear() empties both stacks and byte accounting
 */

import { describe, it, expect } from 'vitest'
import { PaintHistory, type PaintSnapshot } from '../paint-history'

/** Build a tiny snapshot with a recognizable first byte so we can assert identity. */
function snap(label: string, marker: number, w = 2, h = 2): PaintSnapshot {
  const data = new Uint8ClampedArray(w * h * 4)
  data[0] = marker
  return { data, width: w, height: h, label }
}

describe('PaintHistory — basics', () => {
  it('starts empty', () => {
    const h = new PaintHistory()
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
    expect(h.length).toBe(0)
    expect(h.undo()).toBeNull()
    expect(h.redo()).toBeNull()
  })

  it('push enables undo but not redo', () => {
    const h = new PaintHistory()
    h.push(snap('Paint', 1))
    expect(h.canUndo()).toBe(true)
    expect(h.canRedo()).toBe(false)
    expect(h.length).toBe(1)
  })
})

describe('PaintHistory — undo / redo round-trip', () => {
  it('undo returns most-recent frame; redo returns it back (LIFO)', () => {
    const h = new PaintHistory()
    const a = snap('A', 10)
    const b = snap('B', 20)
    h.push(a)
    h.push(b)

    // Undo pops B (most recent), passing the live state as `current` for redo.
    const live = snap('live', 99)
    const undone = h.undo(live)
    expect(undone).toBe(b)
    expect(h.canRedo()).toBe(true)

    // Redo returns the live state we handed to undo.
    const redone = h.redo()
    expect(redone).toBe(live)
    expect(h.canRedo()).toBe(false)
    expect(h.canUndo()).toBe(true)
  })

  it('undo twice walks down the stack in LIFO order', () => {
    const h = new PaintHistory()
    const a = snap('A', 1)
    const b = snap('B', 2)
    const c = snap('C', 3)
    h.push(a); h.push(b); h.push(c)

    expect(h.undo()).toBe(c)
    expect(h.undo()).toBe(b)
    expect(h.undo()).toBe(a)
    expect(h.canUndo()).toBe(false)
    expect(h.undo()).toBeNull()
  })
})

describe('PaintHistory — redo invalidation', () => {
  it('a new push after undo clears the redo future', () => {
    const h = new PaintHistory()
    h.push(snap('A', 1))
    h.push(snap('B', 2))
    h.undo(snap('live', 9))
    expect(h.canRedo()).toBe(true)

    h.push(snap('C', 3))
    expect(h.canRedo()).toBe(false)
    expect(h.peekUndoLabel()).toBe('C')
  })
})

describe('PaintHistory — frame-count cap', () => {
  it('evicts the oldest frame beyond maxFrames', () => {
    const h = new PaintHistory({ maxFrames: 3, maxBytes: Number.MAX_SAFE_INTEGER })
    const frames = [snap('F0', 0), snap('F1', 1), snap('F2', 2), snap('F3', 3)]
    frames.forEach(f => h.push(f))

    // Only the last 3 survive.
    expect(h.length).toBe(3)
    // Deepest undo is F1 (F0 evicted); walk down and confirm.
    expect(h.undo()).toBe(frames[3])
    expect(h.undo()).toBe(frames[2])
    expect(h.undo()).toBe(frames[1])
    expect(h.canUndo()).toBe(false) // F0 was evicted
  })
})

describe('PaintHistory — byte budget cap', () => {
  it('evicts oldest frames to stay within maxBytes and reports byteSize', () => {
    // Each 2x2 RGBA snapshot = 2*2*4 = 16 bytes. Budget of 40 bytes => at most 2
    // frames (32 bytes) fit; a 3rd push evicts the oldest.
    const h = new PaintHistory({ maxBytes: 40, maxFrames: 100 })
    expect(h.byteSize).toBe(0)

    h.push(snap('A', 1)) // 16
    expect(h.byteSize).toBe(16)
    h.push(snap('B', 2)) // 32
    expect(h.byteSize).toBe(32)
    h.push(snap('C', 3)) // would be 48 > 40 → evict oldest (A) back to 32
    expect(h.byteSize).toBe(32)
    expect(h.length).toBe(2)

    // A is gone; only C then B remain undo-able.
    expect(h.peekUndoLabel()).toBe('C')
  })

  it('full-atlas math: a 128 MiB budget holds ~8 frames of 16 MiB', () => {
    const MIB = 1024 * 1024
    const h = new PaintHistory({ maxBytes: 128 * MIB, maxFrames: 25 })
    // Simulate 2048² frames WITHOUT allocating 160 MiB of real buffers: report
    // the logical size via width/height, backed by a 1-byte array (the model
    // computes bytes from dimensions, not data.byteLength).
    const big = (label: string): PaintSnapshot => ({
      data: new Uint8ClampedArray(1),
      width: 2048,
      height: 2048,
      label,
    })
    for (let i = 0; i < 12; i++) h.push(big(`P${i}`))
    // 128 MiB / 16 MiB = 8 frames retained.
    expect(h.length).toBe(8)
    expect(h.byteSize).toBeLessThanOrEqual(128 * MIB)
  })
})

describe('PaintHistory — labels & clear', () => {
  it('peekUndoLabel / peekRedoLabel track the stacks', () => {
    const h = new PaintHistory()
    expect(h.peekUndoLabel()).toBeNull()
    expect(h.peekRedoLabel()).toBeNull()

    h.push(snap('Paint', 1))
    h.push(snap('Erase', 2))
    expect(h.peekUndoLabel()).toBe('Erase')

    h.undo(snap('live', 9))
    expect(h.peekUndoLabel()).toBe('Paint')
    expect(h.peekRedoLabel()).toBe('live')
  })

  it('clear() empties both stacks and byte accounting', () => {
    const h = new PaintHistory()
    h.push(snap('A', 1))
    h.push(snap('B', 2))
    h.undo(snap('live', 9))
    h.clear()

    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
    expect(h.length).toBe(0)
    expect(h.byteSize).toBe(0)
  })
})
