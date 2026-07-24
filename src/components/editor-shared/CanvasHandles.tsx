/**
 * CanvasHandles — resize and rotate handles rendered over the selected layer
 * in screen space. Handles always appear axis-aligned (no layer-rotation
 * applied to the handle ring), which is the standard editor convention.
 *
 * Resize model (post v1.0):
 *   • Non-uniform (when `scaleY` is provided): width and height move
 *     independently. Corner handles change BOTH axes; edge handles change one.
 *     The handle the user grabbed tracks the cursor exactly (no averaging) by
 *     anchoring the opposite corner/edge of the bbox and computing the new
 *     layer size + center from the live pointer position.
 *   • Uniform (when `scaleY` is absent): stays uniform — corner-handle
 *     uniform scaling using bbox width as the reference dimension for
 *     cursor-relative growth.
 *
 * Props are geometry-only (no layer type coupling) so this component works
 * with both FaceplateLayer (via FPE adapter) and Decal (via DPE adapter).
 */

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

/** Smallest scale factor the user can shrink a layer to. Below this the
 *  layer becomes a sub-pixel hairline and the handles can't be re-grabbed,
 *  so we clamp at 5% — generous for design work, tight enough that the
 *  handles never overlap each other. */
const MIN_SCALE = 0.05

/** Update sent back to the editor on every resize-drag tick. Includes the
 *  new scale(s) AND the new center, because non-uniform resize keeps the
 *  opposite-corner anchored — which shifts the layer's geometric center as
 *  the bbox grows. The editor merges this onto the layer via `{...l,...t}`. */
export interface ResizeTransform {
  /** New X-axis scale (always sent). */
  scale: number
  /** New Y-axis scale. Sent when the component received a `scaleY` prop
   *  (non-uniform resize mode); omitted for uniform resize. */
  scaleY?: number
  /** New layer center X in canvas-space pixels. */
  x: number
  /** New layer center Y in canvas-space pixels. */
  y: number
}

export interface CanvasHandlesProps {
  /** Layer center X in canvas-space pixels. */
  x: number
  /** Layer center Y in canvas-space pixels. */
  y: number
  /** Layer rotation in degrees (clockwise). */
  rotation: number
  /** Current X-axis scale (uniform when scaleY absent). */
  scale: number
  /** Current Y-axis scale. Provide for non-uniform (image) layers; omit for
   *  uniform (text/decal) layers. When absent the component uses uniform
   *  resize: only `scale` is emitted, not `scaleY`. */
  scaleY?: number
  viewScale: number
  /** Pre-computed screen-space bbox width for the layer. */
  bboxW: number
  /** Pre-computed screen-space bbox height for the layer. */
  bboxH: number
  /** Called with the new transform on every resize-drag tick. */
  onResize: (transform: ResizeTransform) => void
  /** Called with the new rotation in degrees during a rotate drag. */
  onRotate: (rotation: number) => void
  /** Optional gesture boundary callbacks — fired once at handle pointerdown
   *  and once at pointerup so the parent can group the whole drag as a single
   *  undo frame. */
  onGestureStart?: () => void
  onGestureEnd?: () => void
}

export default function CanvasHandles({
  x: layerX,
  y: layerY,
  rotation: layerRotation,
  scale,
  scaleY: scaleYProp,
  viewScale,
  bboxW,
  bboxH,
  onResize,
  onRotate,
  onGestureStart,
  onGestureEnd,
}: CanvasHandlesProps) {
  const isNonUniform = scaleYProp !== undefined

  const baseW = bboxW
  const baseH = bboxH
  const cx = layerX * viewScale
  const cy = layerY * viewScale

  /**
   * 8-handle resize. The handle the user grabs is pinned to the cursor:
   *
   *   • Corner handles (tl/tr/bl/br) drive BOTH X and Y. The opposite
   *     corner stays anchored, so the layer's center shifts by half the
   *     bbox growth on each axis.
   *   • Edge handles (n/s/e/w) drive ONE axis. The opposite edge stays
   *     anchored, so the layer's center shifts by half the growth on that
   *     axis only.
   *
   * For non-uniform layers (image) we emit independent `scale` (X) and
   * `scaleY` so the user can freely stretch dimensions. For uniform layers
   * (text/decal) we only emit `scale` (uniform), so the handle that tracks
   * the cursor exactly is the dominant axis — diagonal corner drags use the
   * X-axis cursor delta as the reference, edge drags use whichever axis
   * they belong to.
   */
  type CornerKey = 'tl' | 'tr' | 'bl' | 'br'
  type EdgeKey = 'n' | 's' | 'e' | 'w'
  type HandleKey = CornerKey | EdgeKey

  const handleResize = (which: HandleKey) => (ev: ReactPointerEvent) => {
    ev.stopPropagation()
    onGestureStart?.()

    // Sign of each axis component for this handle. 0 means "this axis
    // doesn't move" (used by N/S → only Y matters; E/W → only X matters).
    const sx =
      which === 'tr' || which === 'br' || which === 'e'
        ? 1
        : which === 'tl' || which === 'bl' || which === 'w'
          ? -1
          : 0
    const sy =
      which === 'bl' || which === 'br' || which === 's'
        ? 1
        : which === 'tl' || which === 'tr' || which === 'n'
          ? -1
          : 0

    // ── Capture-time snapshot ──
    const startPointerX = ev.clientX
    const startPointerY = ev.clientY
    const startScaleX = scale
    const startScaleY = scaleYProp ?? scale
    const startCx = layerX
    const startCy = layerY
    // Un-scaled base dimensions in canvas-space: back-compute from the
    // current screen-space bbox and the current scale.
    const startBaseW = Math.max(baseW / viewScale / startScaleX, 1)
    const startBaseH = Math.max(baseH / viewScale / startScaleY, 1)

    const onMove = (e: PointerEvent) => {
      // Pointer delta from drag start, in canvas-space pixels.
      const dxCanvas = (e.clientX - startPointerX) / viewScale
      const dyCanvas = (e.clientY - startPointerY) / viewScale

      if (isNonUniform) {
        // ── Non-uniform resize (image-like): per-axis scale ──
        // Compute new on-canvas bbox dimensions. sx/sy = 0 (edge handle
        // perpendicular to this axis) leaves the dim unchanged.
        const requestedW = startBaseW * startScaleX + sx * dxCanvas
        const requestedH = startBaseH * startScaleY + sy * dyCanvas
        // Clamp to a minimum so the layer never inverts or vanishes.
        const newW = Math.max(requestedW, startBaseW * MIN_SCALE)
        const newH = Math.max(requestedH, startBaseH * MIN_SCALE)
        const newScaleX = newW / startBaseW
        const newScaleY = newH / startBaseH

        // Anchored opposite corner/edge → center shifts by half the
        // ACTUAL (post-clamp) growth in each active axis. Using actual
        // rather than requested growth keeps the handle pinned to the
        // cursor for the unclamped case and gracefully stops moving when
        // the user shrinks past minimum.
        const actualDxW = newW - startBaseW * startScaleX
        const actualDyH = newH - startBaseH * startScaleY
        const newCx = startCx + sx * (actualDxW / 2)
        const newCy = startCy + sy * (actualDyH / 2)

        onResize({ scale: newScaleX, scaleY: newScaleY, x: newCx, y: newCy })
        return
      }

      // ── Uniform resize ──
      // Pick a reference dimension + cursor delta so the dominant axis
      // tracks the cursor. Corners use whichever cursor axis moved more
      // (so a diagonal drag still feels responsive); edges use their
      // single active axis.
      const isCorner = sx !== 0 && sy !== 0
      const useX = isCorner ? Math.abs(dxCanvas) >= Math.abs(dyCanvas) : sx !== 0
      const refDim = useX ? startBaseW : startBaseH
      const refDelta = useX ? sx * dxCanvas : sy * dyCanvas
      const newScale = Math.max(MIN_SCALE, startScaleX + refDelta / refDim)
      // Center shift uses the same active-axis half-growth rule as image,
      // but driven by the single uniform scale so X and Y bbox grow in
      // lockstep with the font size.
      const actualDxW = startBaseW * (newScale - startScaleX)
      const actualDyH = startBaseH * (newScale - startScaleX)
      const newCx = startCx + sx * (actualDxW / 2)
      const newCy = startCy + sy * (actualDyH / 2)
      onResize({ scale: newScale, x: newCx, y: newCy })
    }
    const onUp = () => {
      onGestureEnd?.()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const handleRotate = (ev: ReactPointerEvent) => {
    ev.stopPropagation()
    onGestureStart?.()
    const rect = (ev.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const startAngle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX)
    const startRot = layerRotation
    const onMove = (e: PointerEvent) => {
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX)
      const delta = ((angle - startAngle) * 180) / Math.PI
      onRotate(startRot + delta)
    }
    const onUp = () => {
      onGestureEnd?.()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const wrap: CSSProperties = {
    position: 'absolute',
    left: cx - baseW / 2,
    top: cy - baseH / 2,
    width: baseW,
    height: baseH,
    pointerEvents: 'none',
  }

  const handle: CSSProperties = {
    position: 'absolute',
    width: 12,
    height: 12,
    background: 'rgba(120,180,255,0.95)',
    border: '1.5px solid #fff',
    borderRadius: '50%',
    pointerEvents: 'auto',
    cursor: 'nwse-resize',
    transform: 'translate(-50%, -50%)',
  }

  return (
    <div style={wrap}>
      {/* Corner handles — diagonal resize */}
      <div
        style={{ ...handle, left: 0, top: 0 }}
        onPointerDown={handleResize('tl')}
        aria-label="Resize top-left"
      />
      <div
        style={{ ...handle, left: '100%', top: 0, cursor: 'nesw-resize' }}
        onPointerDown={handleResize('tr')}
        aria-label="Resize top-right"
      />
      <div
        style={{ ...handle, left: 0, top: '100%', cursor: 'nesw-resize' }}
        onPointerDown={handleResize('bl')}
        aria-label="Resize bottom-left"
      />
      <div
        style={{ ...handle, left: '100%', top: '100%' }}
        onPointerDown={handleResize('br')}
        aria-label="Resize bottom-right"
      />
      {/* Midpoint handles — single-axis resize. */}
      <div
        style={{ ...handle, left: '50%', top: 0, cursor: 'ns-resize' }}
        onPointerDown={handleResize('n')}
        aria-label="Resize top"
      />
      <div
        style={{ ...handle, left: '50%', top: '100%', cursor: 'ns-resize' }}
        onPointerDown={handleResize('s')}
        aria-label="Resize bottom"
      />
      <div
        style={{ ...handle, left: '100%', top: '50%', cursor: 'ew-resize' }}
        onPointerDown={handleResize('e')}
        aria-label="Resize right"
      />
      <div
        style={{ ...handle, left: 0, top: '50%', cursor: 'ew-resize' }}
        onPointerDown={handleResize('w')}
        aria-label="Resize left"
      />
      {/* Rotate handle — sits above the bbox, white to distinguish from
          the blue resize ring. */}
      <div
        style={{
          ...handle,
          left: '50%',
          top: -28,
          cursor: 'crosshair',
          background: '#fff',
        }}
        onPointerDown={handleRotate}
        title="Drag to rotate"
        aria-label="Rotate"
      />
    </div>
  )
}
