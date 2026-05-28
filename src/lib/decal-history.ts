/**
 * Snapshot-based undo/redo for per-vehicle decal state.
 *
 * Usage:
 *   const history = useDecalHistory(project, setProject, vehicleId)
 *   // Before mutating decals:
 *   history.commit('Place decal')
 *   // Then do the mutation as usual.
 *
 * The hook is re-entrant-safe: `commit()` is gated by `applyingRef` so
 * applying an undo/redo snapshot never pushes a spurious entry.
 */

import { useCallback, useRef } from 'react'
import type { Coh2SkinProject, Decal } from './project'
import { getOrInitVehicle } from './project'

export interface EditSnapshot {
  /** Vehicle id the edit belongs to. */
  vehicleId: string
  /** Copy of decals at this point in history. */
  decals: Decal[]
  /** Per-vehicle mainDecalId at this point. */
  mainDecalId: number | null
  /** Human-readable label, e.g. "Place decal". */
  label: string
}

const MAX_HISTORY = 50

export interface DecalHistory {
  /** Push a snapshot of the current vehicle state onto the undo stack.
   *  Clears the redo (future) stack. No-op while an undo/redo is being applied. */
  commit: (label: string) => void
  /** Undo the last committed action. */
  undo: () => EditSnapshot | null
  /** Redo the previously undone action. */
  redo: () => EditSnapshot | null
  canUndo: () => boolean
  canRedo: () => boolean
}

export function useDecalHistory(
  getProject: () => Coh2SkinProject,
  setProject: React.Dispatch<React.SetStateAction<Coh2SkinProject>>,
  getVehicleId: () => string,
): DecalHistory {
  // past[0] = oldest, past[past.length-1] = most recent
  const pastRef = useRef<EditSnapshot[]>([])
  // future[0] = most recent undo (next redo), future[last] = oldest undo
  const futureRef = useRef<EditSnapshot[]>([])
  // Gate: prevent commit() from firing during applySnapshot
  const applyingRef = useRef(false)

  /** Capture the current vehicle's decal state. */
  const captureSnapshot = useCallback(
    (label: string): EditSnapshot => {
      const project = getProject()
      const vehicleId = getVehicleId()
      const veh = getOrInitVehicle(project, vehicleId)
      return {
        vehicleId,
        decals: structuredClone(veh.decals),
        mainDecalId: veh.mainDecalId ?? null,
        label,
      }
    },
    [getProject, getVehicleId],
  )

  /** Apply a snapshot to the project. */
  const applySnapshot = useCallback(
    (snap: EditSnapshot) => {
      applyingRef.current = true
      setProject(p => {
        const copy = structuredClone(p)
        const veh = getOrInitVehicle(copy, snap.vehicleId)
        veh.decals = structuredClone(snap.decals)
        veh.mainDecalId = snap.mainDecalId
        return copy
      })
      // We schedule the flag reset on the next microtask so it clears after
      // React has processed the setState call.
      Promise.resolve().then(() => {
        applyingRef.current = false
      })
    },
    [setProject],
  )

  const commit = useCallback(
    (label: string) => {
      if (applyingRef.current) return
      const snap = captureSnapshot(label)
      const past = pastRef.current
      // Avoid spread+slice: push in place, then trim from the front if needed.
      past.push(snap)
      if (past.length > MAX_HISTORY) past.shift()
      // Clear redo stack — a new action invalidates future.
      futureRef.current = []
    },
    [captureSnapshot],
  )

  const undo = useCallback((): EditSnapshot | null => {
    const past = pastRef.current
    if (past.length === 0) return null
    // The most-recent past entry IS the state we want to revert TO
    // (we committed before the mutation, so past.last = pre-mutation state).
    const target = past[past.length - 1]
    pastRef.current = past.slice(0, -1)
    // Capture current state into future before applying
    const current = captureSnapshot(target.label)
    futureRef.current = [current, ...futureRef.current]
    applySnapshot(target)
    return target
  }, [captureSnapshot, applySnapshot])

  const redo = useCallback((): EditSnapshot | null => {
    const future = futureRef.current
    if (future.length === 0) return null
    const target = future[0]
    futureRef.current = future.slice(1)
    // Capture current state into past before applying
    const current = captureSnapshot(target.label)
    const past = pastRef.current
    past.push(current)
    if (past.length > MAX_HISTORY) past.shift()
    applySnapshot(target)
    return target
  }, [captureSnapshot, applySnapshot])

  const canUndo = useCallback(() => pastRef.current.length > 0, [])
  const canRedo = useCallback(() => futureRef.current.length > 0, [])

  return { commit, undo, redo, canUndo, canRedo }
}
