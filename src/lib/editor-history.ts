/**
 * Shared history/undo engine for all three editors.
 *
 * Key design decisions:
 *  - Dual ref stacks (past/future) trimmed from the front at the depth limit.
 *  - New undoable action clears redo stack.
 *  - `applyingRef` re-entrancy gate with microtask reset prevents commit()
 *    during undo/redo restore from pushing spurious entries.
 *  - Gesture support: beginGesture/endGesture wrap a multi-tick interaction
 *    so the whole drag/stroke/transform = ONE undo frame.
 *  - Custom adapter lets callers store a projection (Snap) instead of the
 *    full state (S), useful when canvas pixel data is carried alongside state.
 */

import { useCallback, useRef } from 'react'

export interface HistoryAdapter<S, Snap = S> {
  capture: (current: S, label: string) => Snap
  restore: (current: S, snap: Snap) => S
}

export interface HistoryEngine<S> {
  /** FPE/DPE style: push prev state (or prev snapshot) BEFORE applying fn. */
  mutate(fn: (prev: S) => S, opts?: { undoable?: boolean }): void
  /** Skin-editor style: explicitly snapshot current state before caller mutates. */
  commit(label: string): void
  /**
   * One undo frame per gesture: beginGesture pushes ONE frame (pre-gesture
   * state); all mutate()/commit() calls until endGesture are suppressed.
   * Re-entrant (counter), unbalanced-safe.
   */
  beginGesture(label?: string): void
  endGesture(): void
  undo(): { label: string } | null
  redo(): { label: string } | null
  canUndo(): boolean
  canRedo(): boolean
}

/** Identity adapter — when no adapter is provided, Snap = S */
function identityAdapter<S>(): HistoryAdapter<S, S> {
  return {
    capture: (current) => current,
    restore: (_current, snap) => snap,
  }
}

export function useHistoryEngine<S, Snap = S>(
  getState: () => S,
  setState: React.Dispatch<React.SetStateAction<S>>,
  options?: {
    adapter?: HistoryAdapter<S, Snap>
    limit?: number
    onPersist?: (next: S) => void
    onAfterRestore?: (snap: Snap) => void
  },
): HistoryEngine<S> {
  const limit = options?.limit ?? 50
  const adapterRef = useRef<HistoryAdapter<S, Snap>>(
    (options?.adapter ?? identityAdapter<S>()) as HistoryAdapter<S, Snap>
  )
  adapterRef.current = (options?.adapter ?? identityAdapter<S>()) as HistoryAdapter<S, Snap>

  // past[0] = oldest, past[past.length-1] = most recent
  const pastRef = useRef<Array<{ snap: Snap; label: string }>>([])
  // future[0] = most recent undo (next redo), future[last] = oldest undo
  const futureRef = useRef<Array<{ snap: Snap; label: string }>>([])

  // Gate: prevent commit()/mutate() from firing during undo/redo restore
  const applyingRef = useRef(false)

  // Gesture counter — >0 means a gesture is in progress
  const gestureDepthRef = useRef(0)
  // Label captured at gesture start
  const gestureLabelRef = useRef<string>('Gesture')
  // Pending gesture snapshot: captured at beginGesture but only pushed onto the
  // undo stack on the FIRST mutation inside the gesture. This prevents no-op
  // clicks from littering the undo stack and wiping the redo stack.
  const pendingGestureSnapRef = useRef<{ snap: Snap; label: string } | null>(null)

  const onPersistRef = useRef(options?.onPersist)
  onPersistRef.current = options?.onPersist
  const onAfterRestoreRef = useRef(options?.onAfterRestore)
  onAfterRestoreRef.current = options?.onAfterRestore

  /** Push a snapshot onto the undo stack, clearing redo. */
  const pushToUndo = useCallback(
    (snap: Snap, label: string) => {
      const past = pastRef.current
      past.push({ snap, label })
      if (past.length > limit) past.shift()
      futureRef.current = []
    },
    [limit],
  )

  const beginGesture = useCallback((label?: string) => {
    // Defensive self-heal: if gestureDepth is already >0 (e.g. pointercancel was
    // lost and endGesture never ran), reset it so this new gesture gets a clean frame.
    if (gestureDepthRef.current > 0) {
      gestureDepthRef.current = 0
      pendingGestureSnapRef.current = null
    }
    if (gestureDepthRef.current === 0) {
      // Capture a snapshot NOW but store it as pending — only push onto the undo
      // stack when the first mutation actually occurs. This way a no-op click
      // (begin + end with no mutate) never creates an undo frame or clears redo.
      if (!applyingRef.current) {
        const current = getState()
        const snap = adapterRef.current.capture(current, label ?? 'Gesture')
        gestureLabelRef.current = label ?? 'Gesture'
        pendingGestureSnapRef.current = { snap, label: label ?? 'Gesture' }
      }
    }
    gestureDepthRef.current += 1
  }, [getState])

  const endGesture = useCallback(() => {
    if (gestureDepthRef.current > 0) {
      gestureDepthRef.current -= 1
      // If the gesture ended with no mutations (no-op click), discard the
      // pending snap so no undo frame is created and the redo stack is preserved.
      if (gestureDepthRef.current === 0) {
        pendingGestureSnapRef.current = null
      }
    }
  }, [])

  const mutate = useCallback(
    (fn: (prev: S) => S, opts?: { undoable?: boolean }) => {
      const undoable = opts?.undoable !== false
      const inGesture = gestureDepthRef.current > 0

      // If there is a pending gesture snapshot (lazy-pushed by beginGesture),
      // flush it now on the FIRST mutation inside the gesture so the undo frame
      // is only created when the gesture actually mutates state.
      if (inGesture && pendingGestureSnapRef.current) {
        const pending = pendingGestureSnapRef.current
        pendingGestureSnapRef.current = null
        pushToUndo(pending.snap, pending.label)
      }

      let persistTarget: S | null = null
      setState(prev => {
        if (undoable && !applyingRef.current && !inGesture) {
          const snap = adapterRef.current.capture(prev, '')
          const past = pastRef.current
          past.push({ snap, label: '' })
          if (past.length > limit) past.shift()
          futureRef.current = []
        }
        const next = fn(prev)
        // Persist OUTSIDE the updater (see microtask below). The updater must
        // stay a pure state transition: onPersist runs side effects
        // (localStorage write + scheduleLiveSync) and scheduleLiveSync notifies
        // a useSyncExternalStore (useLiveSync). Firing it here — while the
        // updater executes during React's render phase — schedules a store
        // re-render mid-render ("Cannot update a component while rendering a
        // different component"). Capturing `next` and persisting in a microtask
        // moves the side effect safely after commit.
        persistTarget = next
        return next
      })
      // Persist after the setState call returns, off React's render phase.
      // Mirrors the undo/redo path which already defers via Promise.resolve().
      if (persistTarget !== null) {
        const target = persistTarget
        Promise.resolve().then(() => onPersistRef.current?.(target))
      }
    },
    [setState, limit, pushToUndo],
  )

  const commit = useCallback(
    (label: string) => {
      if (applyingRef.current) return
      if (gestureDepthRef.current > 0) return // gesture in progress — suppress
      const current = getState()
      const snap = adapterRef.current.capture(current, label)
      pushToUndo(snap, label)
    },
    [getState, pushToUndo],
  )

  const undo = useCallback((): { label: string } | null => {
    const past = pastRef.current
    if (past.length === 0) return null

    const entry = past[past.length - 1]
    pastRef.current = past.slice(0, -1)

    applyingRef.current = true
    let persistTarget: S | null = null
    setState(current => {
      // Push current state onto redo before restoring
      const currentSnap = adapterRef.current.capture(current, entry.label)
      const future = futureRef.current
      future.unshift({ snap: currentSnap, label: entry.label })
      if (future.length > limit) future.pop()

      const next = adapterRef.current.restore(current, entry.snap)
      // Persist OUTSIDE the updater — see the note in mutate(). scheduleLiveSync
      // notifies a useSyncExternalStore and must not run during render.
      persistTarget = next
      return next
    })
    Promise.resolve().then(() => {
      applyingRef.current = false
      if (persistTarget !== null) onPersistRef.current?.(persistTarget)
      onAfterRestoreRef.current?.(entry.snap)
    })

    return { label: entry.label }
  }, [setState, limit])

  const redo = useCallback((): { label: string } | null => {
    const future = futureRef.current
    if (future.length === 0) return null

    const entry = future[0]
    futureRef.current = future.slice(1)

    applyingRef.current = true
    let persistTarget: S | null = null
    setState(current => {
      // Push current state onto undo before restoring
      const currentSnap = adapterRef.current.capture(current, entry.label)
      const past = pastRef.current
      past.push({ snap: currentSnap, label: entry.label })
      if (past.length > limit) past.shift()

      const next = adapterRef.current.restore(current, entry.snap)
      // Persist OUTSIDE the updater — see the note in mutate(). scheduleLiveSync
      // notifies a useSyncExternalStore and must not run during render.
      persistTarget = next
      return next
    })
    Promise.resolve().then(() => {
      applyingRef.current = false
      if (persistTarget !== null) onPersistRef.current?.(persistTarget)
      onAfterRestoreRef.current?.(entry.snap)
    })

    return { label: entry.label }
  }, [setState, limit])

  const canUndo = useCallback(() => pastRef.current.length > 0, [])
  const canRedo = useCallback(() => futureRef.current.length > 0, [])

  return {
    mutate,
    commit,
    beginGesture,
    endGesture,
    undo,
    redo,
    canUndo,
    canRedo,
  }
}
