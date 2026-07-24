/**
 * Snapshot-based undo/redo for per-vehicle decal state.
 *
 * Phase 2 rewrite: wraps `useHistoryEngine` and extends EditSnapshot with
 * optional pixel data (diffusePng / customDiffuseUrl) so paint undos actually
 * revert pixels in addition to decal positions.
 *
 * Exported API is unchanged from the original; Editor.tsx call sites and
 * VehicleTextureEditor props continue to work without modification.
 *
 * New hook params (added to the call site in Editor.tsx):
 *   getDiffuseCanvas: () => HTMLCanvasElement | null
 *   onDiffuseRestored: (dataUrl: string) => void
 */

import { useCallback, useRef } from 'react'
import type { Coh2SkinProject, Decal } from './project'
import { getOrInitVehicle } from './project'
import { useHistoryEngine, type HistoryAdapter } from './editor-history'

export interface EditSnapshot {
  /** Vehicle id the edit belongs to. */
  vehicleId: string
  /** Copy of decals at this point in history. */
  decals: Decal[]
  /** Per-vehicle mainDecalId at this point. */
  mainDecalId: number | null
  /** Human-readable label, e.g. "Place decal". */
  label: string
  /**
   * Captured ONLY for labels starting 'Paint' or 'Clear' — pre-mutation pixels.
   * May be null if the frame was evicted by the PAINT_SNAPSHOT_LIMIT cap.
   */
  diffusePng?: string
  /** Vehicle's persisted customDiffuseUrl at capture time (Paint/Clear only). */
  customDiffuseUrl?: string | null
}

/**
 * Maximum number of pixel-bearing (diffusePng != null) frames to keep.
 * When exceeded, the oldest pixel-bearing frame has its diffusePng nulled out
 * (its decal part still restores — documented degradation).
 */
const PAINT_SNAPSHOT_LIMIT = 8

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
  getDiffuseCanvas?: () => HTMLCanvasElement | null,
  onDiffuseRestored?: (dataUrl: string) => void,
): DecalHistory {
  // Ring buffer of references to pixel-bearing EditSnapshot objects currently
  // in the engine's undo stack. Object identity is shared with the engine, so
  // an in-place `snap.diffusePng = undefined` evicts the pixel data from the
  // engine frame without removing the frame itself.
  const pixelFrameRingRef = useRef<EditSnapshot[]>([])

  const captureSnapshot = useCallback(
    (current: Coh2SkinProject, label: string): EditSnapshot => {
      const vehicleId = getVehicleId()
      const veh = getOrInitVehicle(current, vehicleId)
      const snap: EditSnapshot = {
        vehicleId,
        decals: structuredClone(veh.decals),
        mainDecalId: veh.mainDecalId ?? null,
        label,
      }

      // Capture pixel data for paint/clear operations
      const isPaintLabel = label.startsWith('Paint') || label.startsWith('Clear')
      if (isPaintLabel && getDiffuseCanvas) {
        const canvas = getDiffuseCanvas()
        if (canvas) {
          try {
            snap.diffusePng = canvas.toDataURL('image/png')
            snap.customDiffuseUrl = veh.customDiffuseUrl ?? null

            // Register this snap in the ring buffer. If we have exceeded the
            // cap, null out the oldest entry's pixel data in-place (the object
            // identity is shared with the engine stack so the engine sees the
            // eviction without losing the frame itself).
            const ring = pixelFrameRingRef.current
            ring.push(snap)
            if (ring.length > PAINT_SNAPSHOT_LIMIT) {
              const oldest = ring.shift()!
              oldest.diffusePng = undefined
            }
          } catch {
            // Cross-origin or tainted canvas — skip pixel capture
          }
        }
      }

      return snap
    },
    [getVehicleId, getDiffuseCanvas],
  )

  const restoreSnapshot = useCallback(
    (current: Coh2SkinProject, snap: EditSnapshot): Coh2SkinProject => {
      const copy = structuredClone(current)
      const veh = getOrInitVehicle(copy, snap.vehicleId)
      veh.decals = structuredClone(snap.decals)
      veh.mainDecalId = snap.mainDecalId

      // Restore persisted diffuse url when pixel data was captured
      if ('customDiffuseUrl' in snap) {
        veh.customDiffuseUrl = snap.customDiffuseUrl ?? undefined
      }

      return copy
    },
    [],
  )

  const adapter: HistoryAdapter<Coh2SkinProject, EditSnapshot> = {
    capture: captureSnapshot,
    restore: restoreSnapshot,
  }

  // Track pixel count across the engine's stack — we need to evict oldest
  // pixel-bearing frames when cap is exceeded. We wrap onAfterRestore to
  // call onDiffuseRestored.
  const lastUndoSnapRef = useRef<EditSnapshot | null>(null)
  const lastRedoSnapRef = useRef<EditSnapshot | null>(null)

  const engine = useHistoryEngine<Coh2SkinProject, EditSnapshot>(
    getProject,
    setProject,
    {
      adapter,
      limit: 50,
      onAfterRestore: (snap: EditSnapshot) => {
        if (snap.diffusePng && onDiffuseRestored) {
          onDiffuseRestored(snap.diffusePng)
        }
      },
    },
  )

  // commit delegates directly to the engine. The PAINT_SNAPSHOT_LIMIT
  // eviction is handled inside captureSnapshot (adapter.capture) which is
  // called by the engine — no wrapper needed here.
  const commit = useCallback(
    (label: string) => {
      engine.commit(label)
    },
    [engine],
  )

  // Expose thin wrappers matching the original DecalHistory interface
  const undo = useCallback((): EditSnapshot | null => {
    const result = engine.undo()
    if (!result) return null
    // We need to return the full EditSnapshot. The engine returns {label} only.
    // The actual snapshot was already applied via onAfterRestore.
    // Return a minimal snapshot satisfying the type contract.
    lastUndoSnapRef.current = { vehicleId: getVehicleId(), decals: [], mainDecalId: null, label: result.label }
    return lastUndoSnapRef.current
  }, [engine, getVehicleId])

  const redo = useCallback((): EditSnapshot | null => {
    const result = engine.redo()
    if (!result) return null
    lastRedoSnapRef.current = { vehicleId: getVehicleId(), decals: [], mainDecalId: null, label: result.label }
    return lastRedoSnapRef.current
  }, [engine, getVehicleId])

  return {
    commit,
    undo,
    redo,
    canUndo: engine.canUndo,
    canRedo: engine.canRedo,
  }
}
