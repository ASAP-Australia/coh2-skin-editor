/**
 * snap-guides.ts — shared snap-to-alignment helper used by FaceplateEditor
 * and DecalPackEditor during Select-tool layer/decal drags.
 *
 * Pure functions only — no React, no DOM. Safe to unit-test with vitest.
 */

/** A single alignment axis to snap towards. */
export interface SnapTarget {
  /** 'x' = vertical guide line (snap the dragged item's X coordinate).
   *  'y' = horizontal guide line (snap the dragged item's Y coordinate). */
  kind: 'x' | 'y'
  /** The canvas-space pixel value to snap to. */
  value: number
  /** Human-readable label for debugging / tooltips. */
  label?: string
}

/** Result returned by `applySnap`. */
export interface SnapResult {
  /** Final X coordinate after snapping (or the original if no X snap fired). */
  snappedX: number
  /** Final Y coordinate after snapping (or the original if no Y snap fired). */
  snappedY: number
  /** Every target whose axis was within `threshold` pixels of the candidate.
   *  Empty array when nothing snapped. */
  firedTargets: SnapTarget[]
}

/**
 * Apply snap logic to a candidate position.
 *
 * For each axis ('x' / 'y') independently, find all targets within
 * `threshold` pixels and snap to the nearest one. Both axes are resolved
 * separately so the result can snap in X but not Y (or both simultaneously).
 *
 * @param candidateX  Would-be X position (canvas-space pixels).
 * @param candidateY  Would-be Y position (canvas-space pixels).
 * @param targets     Alignment targets to consider.
 * @param threshold   Maximum distance (pixels) for a snap to fire. Default 6.
 */
export function applySnap(
  candidateX: number,
  candidateY: number,
  targets: SnapTarget[],
  threshold = 6,
): SnapResult {
  const firedTargets: SnapTarget[] = []

  // ── X axis ───────────────────────────────────────────────────────────────
  const xTargets = targets.filter(t => t.kind === 'x')
  let snappedX = candidateX
  let bestXDist = threshold // strict: must be < threshold, we start at threshold
  for (const t of xTargets) {
    const dist = Math.abs(candidateX - t.value)
    if (dist < bestXDist) {
      bestXDist = dist
      snappedX = t.value
    }
  }
  // Collect all X targets within threshold (may be more than the one we snapped to).
  for (const t of xTargets) {
    if (Math.abs(candidateX - t.value) < threshold) {
      firedTargets.push(t)
    }
  }

  // ── Y axis ───────────────────────────────────────────────────────────────
  const yTargets = targets.filter(t => t.kind === 'y')
  let snappedY = candidateY
  let bestYDist = threshold
  for (const t of yTargets) {
    const dist = Math.abs(candidateY - t.value)
    if (dist < bestYDist) {
      bestYDist = dist
      snappedY = t.value
    }
  }
  for (const t of yTargets) {
    if (Math.abs(candidateY - t.value) < threshold) {
      firedTargets.push(t)
    }
  }

  return { snappedX, snappedY, firedTargets }
}
