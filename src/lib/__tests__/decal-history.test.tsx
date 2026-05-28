/**
 * Tests for `useDecalHistory` — the snapshot-based undo/redo stack the
 * skin-pack Editor uses to back out of decal mutations.
 *
 * Contract pinned here:
 *
 *  Initial state
 *  - On mount, both `canUndo()` and `canRedo()` return false (no
 *    snapshots yet). `undo()` and `redo()` return null in that state
 *    instead of throwing.
 *
 *  Commit semantics
 *  - `commit(label)` snapshots the CURRENT vehicle state (the project's
 *    decals + mainDecalId for the current vehicle), then a subsequent
 *    mutation can be safely undone back to that snapshot.
 *  - Each commit clears the redo stack — a new action invalidates the
 *    future. (The classic "branch from middle of undo history" reset.)
 *
 *  Undo / redo cycle
 *  - `undo()` reverts the project to the most recent committed snapshot
 *    AND pushes the current (post-mutation) state onto the redo stack
 *    so a subsequent `redo()` re-applies the mutation.
 *  - `canUndo()` is false once every committed snapshot has been
 *    rewound; `canRedo()` then mirrors the redo-stack non-emptiness.
 *  - Successive redos walk the future stack newest-first.
 *
 *  History size cap
 *  - `MAX_HISTORY` is 50 — committing 51 snapshots keeps only the most
 *    recent 50 (oldest dropped from the front). `canUndo` stays true
 *    while the stack is at the cap.
 *
 *  Re-entrancy guard
 *  - During the React state update queued by `applySnapshot`, calling
 *    `commit()` is a no-op (the `applyingRef` gate). Without this,
 *    the very setProject() that applies an undo would itself trigger
 *    a `commit()` from any effect listening on the state — pushing a
 *    spurious entry. The test pins that pattern by calling commit()
 *    immediately after undo() in the same microtask.
 *
 *  Per-vehicle scope
 *  - Snapshots carry their `vehicleId`. Switching vehicles between
 *    commit and undo still rewinds the ORIGINAL vehicle (not the
 *    currently-selected one) — the project's `vehicles` map is
 *    addressed by snapshot.vehicleId.
 *
 *  Test infra: React 19 createRoot + act. The hook is exercised via a
 *  tiny harness component that exposes the returned `DecalHistory`
 *  through a ref.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import { newProject, type Coh2SkinProject } from '@/lib/project'
import { useDecalHistory, type DecalHistory } from '@/lib/decal-history'

// React 19 act opt-in.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── Harness ─────────────────────────────────────────────────────────────────
// Renders a minimal component that wires useDecalHistory into a
// project useState + a vehicle-id getter, and exposes the returned API
// + the latest project snapshot through refs so the test can call
// `history.commit('…')` directly.

interface Handle {
  history: DecalHistory
  getProject: () => Coh2SkinProject
  setProject: (updater: (p: Coh2SkinProject) => Coh2SkinProject) => void
  setVehicleId: (id: string) => void
}

function Harness({
  initialVehicleId,
  onReady,
}: {
  initialVehicleId: string
  onReady: (h: Handle) => void
}): ReactNode {
  const [project, setProject] = useState<Coh2SkinProject>(() => newProject('Test'))
  const [vehicleId, setVehicleId] = useState(initialVehicleId)

  // Latest-value tracking refs. We keep them up to date inside a layout
  // effect so getProject() / getVehicleId() always read the value the
  // most recent render produced — without reading `.current` during
  // render (the react-hooks/refs lint rule).
  const projectRef = useRef(project)
  const vehicleIdRef = useRef(vehicleId)
  useEffect(() => {
    projectRef.current = project
  }, [project])
  useEffect(() => {
    vehicleIdRef.current = vehicleId
  }, [vehicleId])

  const history = useDecalHistory(
    () => projectRef.current,
    setProject,
    () => vehicleIdRef.current,
  )

  // Yield the handle once after the first commit. Calling onReady from
  // an effect ensures the parent test never touches refs during render
  // and that the rendered output has been committed before the test
  // exercises history operations.
  useEffect(() => {
    onReady({
      history,
      getProject: () => projectRef.current,
      setProject: updater => setProject(p => updater(p)),
      setVehicleId,
    })
    // The handle's `history` object is stable across renders (it's the
    // same `DecalHistory` from useDecalHistory), so re-emitting on
    // re-render isn't useful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(initialVehicleId = 'panther_pz4'): Handle {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  let captured: Handle | null = null
  act(() => {
    root!.render(
      createElement(Harness, {
        initialVehicleId,
        onReady: h => {
          captured = h
        },
      }),
    )
  })
  if (!captured) throw new Error('Harness did not yield a handle')
  return captured
}

beforeEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
})

// ── Helpers ─────────────────────────────────────────────────────────────────

function placeDecal(handle: Handle, vehicleId: string, decalId: number, label: string) {
  // commit() first (pre-mutation snapshot), THEN mutate.
  act(() => {
    handle.history.commit(label)
  })
  act(() => {
    handle.setProject(p => {
      const v = p.vehicles[vehicleId] ?? { id: vehicleId, tac: null, name: null, decals: [] }
      const next = structuredClone(p)
      const nv = next.vehicles[vehicleId] ?? { id: vehicleId, tac: null, name: null, decals: [] }
      nv.decals = [
        ...v.decals,
        {
          id: decalId,
          type: 'shield',
          x: 100,
          y: 100,
          rot: 0,
          size: 64,
        },
      ]
      next.vehicles[vehicleId] = nv
      return next
    })
  })
}

function decalsForVehicle(handle: Handle, vehicleId: string): number[] {
  return (handle.getProject().vehicles[vehicleId]?.decals ?? []).map(d => d.id)
}

async function flushMicrotask() {
  // applySnapshot clears the re-entrancy gate on a Promise.resolve().then(…).
  await act(async () => {
    await Promise.resolve()
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useDecalHistory — initial state', () => {
  it('canUndo() and canRedo() both return false before any commit', () => {
    const h = mount()
    expect(h.history.canUndo()).toBe(false)
    expect(h.history.canRedo()).toBe(false)
  })

  it('undo() returns null when there is nothing to undo', () => {
    const h = mount()
    expect(h.history.undo()).toBeNull()
  })

  it('redo() returns null when there is nothing to redo', () => {
    const h = mount()
    expect(h.history.redo()).toBeNull()
  })
})

describe('useDecalHistory — commit semantics', () => {
  it('committing once flips canUndo() to true but canRedo() stays false', () => {
    const h = mount()
    act(() => h.history.commit('initial'))
    expect(h.history.canUndo()).toBe(true)
    expect(h.history.canRedo()).toBe(false)
  })

  it('a fresh commit clears the redo stack (cannot redo after committing post-undo)', async () => {
    const h = mount()
    placeDecal(h, 'panther_pz4', 1, 'place 1')
    placeDecal(h, 'panther_pz4', 2, 'place 2')
    act(() => {
      h.history.undo()
    })
    await flushMicrotask()
    expect(h.history.canRedo()).toBe(true)
    // New commit invalidates the future.
    placeDecal(h, 'panther_pz4', 3, 'place 3')
    expect(h.history.canRedo()).toBe(false)
  })
})

describe('useDecalHistory — undo / redo cycle', () => {
  it('undo() reverts the most recent mutation', async () => {
    const h = mount()
    placeDecal(h, 'panther_pz4', 1, 'place 1')
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([1])
    act(() => {
      h.history.undo()
    })
    await flushMicrotask()
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([])
  })

  it('redo() re-applies the most recent undone mutation', async () => {
    const h = mount()
    placeDecal(h, 'panther_pz4', 1, 'place 1')
    act(() => {
      h.history.undo()
    })
    await flushMicrotask()
    act(() => {
      h.history.redo()
    })
    await flushMicrotask()
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([1])
  })

  it('undo → redo → undo cycles cleanly across multiple commits', async () => {
    const h = mount()
    placeDecal(h, 'panther_pz4', 1, 'place 1')
    placeDecal(h, 'panther_pz4', 2, 'place 2')
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([1, 2])
    act(() => h.history.undo())
    await flushMicrotask()
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([1])
    act(() => h.history.undo())
    await flushMicrotask()
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([])
    expect(h.history.canUndo()).toBe(false)
    expect(h.history.canRedo()).toBe(true)
    act(() => h.history.redo())
    await flushMicrotask()
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([1])
    act(() => h.history.redo())
    await flushMicrotask()
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([1, 2])
    expect(h.history.canRedo()).toBe(false)
  })

  it('canRedo() flips to true after undo() and back to false once everything is redone', async () => {
    const h = mount()
    placeDecal(h, 'panther_pz4', 1, 'place 1')
    act(() => h.history.undo())
    await flushMicrotask()
    expect(h.history.canRedo()).toBe(true)
    act(() => h.history.redo())
    await flushMicrotask()
    expect(h.history.canRedo()).toBe(false)
  })

  it('undo() returns the snapshot it just applied (with the recorded label)', async () => {
    const h = mount()
    placeDecal(h, 'panther_pz4', 1, 'place shield')
    let returned: ReturnType<DecalHistory['undo']> = null
    act(() => {
      returned = h.history.undo()
    })
    await flushMicrotask()
    expect(returned).not.toBeNull()
    expect(returned!.label).toBe('place shield')
    expect(returned!.vehicleId).toBe('panther_pz4')
  })
})

describe('useDecalHistory — MAX_HISTORY cap', () => {
  it('commits beyond the 50-entry cap drop the OLDEST entries (FIFO trim)', () => {
    const h = mount()
    // Commit 51 entries — the very first one must fall off the front.
    for (let i = 0; i < 51; i++) {
      act(() => h.history.commit(`commit-${i}`))
    }
    // canUndo stays true while the stack is at the cap.
    expect(h.history.canUndo()).toBe(true)
    // Now walk back exactly 50 undos — each peels off one entry.
    for (let i = 0; i < 50; i++) {
      act(() => {
        h.history.undo()
      })
    }
    // After 50 undos the stack should be empty (the 51st commit's
    // oldest sibling — commit-0 — was dropped, so we never had 51
    // undo-able entries).
    expect(h.history.canUndo()).toBe(false)
  })
})

describe('useDecalHistory — per-vehicle scope', () => {
  it('switching vehicles after a commit still rewinds the ORIGINAL vehicle', async () => {
    const h = mount('panther_pz4')
    placeDecal(h, 'panther_pz4', 1, 'place on panther')
    // Switch to a different vehicle.
    act(() => h.setVehicleId('tiger_pz6'))
    // Place a decal on the new vehicle without going through the
    // history (we want to verify undo() doesn't touch this).
    act(() => {
      h.setProject(p => {
        const next = structuredClone(p)
        next.vehicles['tiger_pz6'] = {
          id: 'tiger_pz6',
          tac: null,
          name: null,
          decals: [
            {
              id: 99,
              type: 'shield',
              x: 0,
              y: 0,
              rot: 0,
              size: 32,
            },
          ],
        }
        return next
      })
    })
    // Undo — must rewind the PANTHER (the commit was scoped to it),
    // not the currently-active tiger.
    act(() => h.history.undo())
    await flushMicrotask()
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([])
    expect(decalsForVehicle(h, 'tiger_pz6')).toEqual([99])
  })
})

describe('useDecalHistory — re-entrancy guard', () => {
  it('commit() called inside the applySnapshot microtask is a no-op (no spurious entry)', async () => {
    const h = mount()
    placeDecal(h, 'panther_pz4', 1, 'place 1')
    // Two committed snapshots so we can confirm exactly one undo is
    // consumed (rather than zero or two).
    placeDecal(h, 'panther_pz4', 2, 'place 2')

    // Synchronously call commit() right after undo(): under the gate,
    // commit() should be ignored because applyingRef is still true at
    // this point (it clears on the next microtask).
    act(() => {
      h.history.undo()
      h.history.commit('spurious')
    })
    await flushMicrotask()

    // After the suppressed commit, we should still be able to redo
    // back to the place-2 state (the spurious commit didn't clear the
    // redo stack).
    expect(h.history.canRedo()).toBe(true)
    act(() => h.history.redo())
    await flushMicrotask()
    expect(decalsForVehicle(h, 'panther_pz4')).toEqual([1, 2])
  })
})
