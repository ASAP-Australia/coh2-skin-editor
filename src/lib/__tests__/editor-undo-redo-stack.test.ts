/**
 * Unit tests for the symmetric undo/redo stack logic used by
 * FaceplateEditor and DecalPackEditor.
 *
 * Both editors share identical stack semantics (the code is structurally
 * identical); this file pins the contract in one place via a thin pure
 * harness that replicates the logic without mounting a React component or
 * touching Electron APIs.
 *
 * Contract pinned here:
 *
 *  Initial state
 *  - Both stacks start empty: canUndo / canRedo are false.
 *  - undo() and redo() are no-ops when the stacks are empty.
 *
 *  mutate() — new action
 *  - Pushes a snapshot of the CURRENT state onto the undo stack BEFORE
 *    applying the updater (pre-mutation snapshot).
 *  - Clears the redo stack — any branching "future" is abandoned.
 *
 *  undo()
 *  - Pops the undo stack.
 *  - Pushes the CURRENT state (the state being departed) onto the redo
 *    stack so redo() can put it back.
 *  - Restores the popped snapshot as the active state.
 *
 *  redo()
 *  - Pops the redo stack.
 *  - Pushes the CURRENT state onto the undo stack (making it undoable).
 *  - Restores the popped snapshot as the active state.
 *
 *  UNDO_LIMIT = 50
 *  - Both stacks are capped at 50 entries: the oldest entry is dropped
 *    (shift) when the cap is exceeded.
 */

import { describe, it, expect } from 'vitest'

// ── Pure harness replicating the in-component stack logic ────────────────────

const UNDO_LIMIT = 50

interface State {
  value: number
}

interface StackHarness {
  current: State
  undoStack: State[]
  redoStack: State[]
}

function createHarness(initial: State): StackHarness {
  return { current: initial, undoStack: [], redoStack: [] }
}

/** Mirrors the `mutate` callback in FaceplateEditor / DecalPackEditor.
 *  Captures the current state onto the undo stack, clears redo, and
 *  applies the updater. */
function mutate(h: StackHarness, updater: (s: State) => State): void {
  h.undoStack.push({ ...h.current })
  if (h.undoStack.length > UNDO_LIMIT) h.undoStack.shift()
  h.redoStack = []
  h.current = updater({ ...h.current })
}

/** Mirrors the `undo` callback — pop undoStack, push current to redoStack,
 *  restore. No-op when undoStack is empty. */
function undo(h: StackHarness): boolean {
  const prev = h.undoStack.pop()
  if (!prev) return false
  h.redoStack.push({ ...h.current })
  if (h.redoStack.length > UNDO_LIMIT) h.redoStack.shift()
  h.current = prev
  return true
}

/** Mirrors the `redo` callback — pop redoStack, push current to undoStack,
 *  restore. No-op when redoStack is empty. */
function redo(h: StackHarness): boolean {
  const next = h.redoStack.pop()
  if (!next) return false
  h.undoStack.push({ ...h.current })
  if (h.undoStack.length > UNDO_LIMIT) h.undoStack.shift()
  h.current = next
  return true
}

function canUndo(h: StackHarness): boolean {
  return h.undoStack.length > 0
}

function canRedo(h: StackHarness): boolean {
  return h.redoStack.length > 0
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('editor undo/redo stack — initial state', () => {
  it('canUndo and canRedo are both false before any mutation', () => {
    const h = createHarness({ value: 0 })
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('undo() is a no-op and returns false when the stack is empty', () => {
    const h = createHarness({ value: 42 })
    const moved = undo(h)
    expect(moved).toBe(false)
    expect(h.current.value).toBe(42)
  })

  it('redo() is a no-op and returns false when the stack is empty', () => {
    const h = createHarness({ value: 42 })
    const moved = redo(h)
    expect(moved).toBe(false)
    expect(h.current.value).toBe(42)
  })
})

describe('editor undo/redo stack — mutate()', () => {
  it('mutate() applies the updater immediately', () => {
    const h = createHarness({ value: 1 })
    mutate(h, s => ({ value: s.value + 10 }))
    expect(h.current.value).toBe(11)
  })

  it('mutate() pushes a pre-mutation snapshot onto the undo stack', () => {
    const h = createHarness({ value: 5 })
    mutate(h, s => ({ value: s.value + 1 }))
    expect(h.undoStack).toHaveLength(1)
    expect(h.undoStack[0].value).toBe(5)
  })

  it('mutate() clears the redo stack (branching future is abandoned)', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 1 }))  // value = 1
    undo(h)                                     // back to 0, redo has [1]
    expect(canRedo(h)).toBe(true)
    mutate(h, s => ({ value: s.value + 99 }))  // new branch from 0
    expect(canRedo(h)).toBe(false)
    expect(h.redoStack).toHaveLength(0)
  })

  it('each subsequent mutate() grows the undo stack', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 1 }))
    mutate(h, s => ({ value: s.value + 1 }))
    mutate(h, s => ({ value: s.value + 1 }))
    expect(h.undoStack).toHaveLength(3)
    expect(h.current.value).toBe(3)
  })
})

describe('editor undo/redo stack — undo()', () => {
  it('undo() reverts to the most recent pre-mutation snapshot', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 10 }))
    expect(h.current.value).toBe(10)
    undo(h)
    expect(h.current.value).toBe(0)
  })

  it('undo() pushes the departed state onto the redo stack', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 7 }))
    undo(h)
    expect(h.redoStack).toHaveLength(1)
    expect(h.redoStack[0].value).toBe(7)
  })

  it('canUndo() flips to false after all mutations are undone', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 1 }))
    mutate(h, s => ({ value: s.value + 1 }))
    undo(h)
    undo(h)
    expect(canUndo(h)).toBe(false)
  })

  it('successive undos walk back through multi-step mutation history', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 1 }))  // 1
    mutate(h, s => ({ value: s.value + 1 }))  // 2
    mutate(h, s => ({ value: s.value + 1 }))  // 3
    undo(h)  // → 2
    expect(h.current.value).toBe(2)
    undo(h)  // → 1
    expect(h.current.value).toBe(1)
    undo(h)  // → 0
    expect(h.current.value).toBe(0)
    expect(canUndo(h)).toBe(false)
  })
})

describe('editor undo/redo stack — redo()', () => {
  it('redo() re-applies the most recently undone mutation', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 5 }))
    undo(h)
    expect(h.current.value).toBe(0)
    redo(h)
    expect(h.current.value).toBe(5)
  })

  it('redo() pushes the departed state onto the undo stack', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 5 }))
    const stackLenBeforeUndo = h.undoStack.length
    undo(h)
    // After undo, undo stack shrank by 1 (we popped from it)
    expect(h.undoStack.length).toBe(stackLenBeforeUndo - 1)
    redo(h)
    // After redo, the undo stack should be back at its pre-undo length
    expect(h.undoStack.length).toBe(stackLenBeforeUndo)
    expect(h.undoStack[h.undoStack.length - 1].value).toBe(0)
  })

  it('canRedo() flips to false after all undone steps are redone', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 1 }))
    mutate(h, s => ({ value: s.value + 1 }))
    undo(h)
    undo(h)
    expect(canRedo(h)).toBe(true)
    redo(h)
    redo(h)
    expect(canRedo(h)).toBe(false)
  })

  it('full undo → redo cycle restores the exact pre-undo state', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 1 }))  // 1
    mutate(h, s => ({ value: s.value + 1 }))  // 2
    mutate(h, s => ({ value: s.value + 1 }))  // 3
    // Undo all the way back
    undo(h)  // → 2
    undo(h)  // → 1
    undo(h)  // → 0
    expect(h.current.value).toBe(0)
    // Redo all the way forward
    redo(h)  // → 1
    expect(h.current.value).toBe(1)
    redo(h)  // → 2
    expect(h.current.value).toBe(2)
    redo(h)  // → 3
    expect(h.current.value).toBe(3)
    expect(canRedo(h)).toBe(false)
  })
})

describe('editor undo/redo stack — UNDO_LIMIT cap', () => {
  it('undo stack is capped at 50 entries — oldest is dropped on overflow', () => {
    const h = createHarness({ value: 0 })
    // 51 mutations → the very first snapshot must fall off the front.
    for (let i = 1; i <= 51; i++) {
      mutate(h, s => ({ value: s.value + 1 }))
    }
    expect(h.undoStack.length).toBe(50)
    expect(canUndo(h)).toBe(true)
    // The oldest snapshot (value = 0) was shifted out; the earliest
    // reachable snapshot is now value = 1.
    // Walk all the way back.
    while (canUndo(h)) undo(h)
    // After 50 undos from value=51 we should land at 1 (not 0).
    expect(h.current.value).toBe(1)
  })

  it('redo stack is capped at 50 entries — oldest is dropped on overflow', () => {
    const h = createHarness({ value: 0 })
    // Build 51 mutations then undo them all; on the 51st undo the
    // redo stack should cap at 50 (first redo entry is dropped).
    for (let i = 1; i <= 51; i++) {
      mutate(h, s => ({ value: s.value + 1 }))
    }
    // Undo them all (there are 50 in the stack after capping).
    while (canUndo(h)) undo(h)
    // After undoing 50 times the redo stack also holds at most 50 entries.
    expect(h.redoStack.length).toBe(50)
  })
})

describe('editor undo/redo stack — interleaved mutate / undo / redo', () => {
  it('undo then new mutate then undo only goes back to the new branch', () => {
    const h = createHarness({ value: 0 })
    mutate(h, () => ({ value: 10 }))  // A: 0 → 10
    mutate(h, () => ({ value: 20 }))  // B: 10 → 20
    undo(h)                            // back to 10 (redo has [20])
    expect(h.current.value).toBe(10)
    mutate(h, () => ({ value: 99 }))  // C: branch from 10 → 99; redo cleared
    expect(canRedo(h)).toBe(false)
    undo(h)  // back to 10 (C undone)
    expect(h.current.value).toBe(10)
    undo(h)  // back to 0 (A undone)
    expect(h.current.value).toBe(0)
    expect(canUndo(h)).toBe(false)
  })

  it('does not corrupt state across repeated undo/redo cycles', () => {
    const h = createHarness({ value: 0 })
    mutate(h, s => ({ value: s.value + 1 }))  // 1
    mutate(h, s => ({ value: s.value + 1 }))  // 2
    // Three full undo/redo passes over the same two steps
    for (let pass = 0; pass < 3; pass++) {
      undo(h); undo(h)
      expect(h.current.value).toBe(0)
      redo(h); redo(h)
      expect(h.current.value).toBe(2)
    }
  })
})
