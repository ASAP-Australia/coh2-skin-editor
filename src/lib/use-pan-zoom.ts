/**
 * usePanZoom — shared hook for zoom + pan on a 2D canvas stage.
 *
 * Returns { scale, offset, handlers } where:
 *   - scale (0.25–8): the current zoom level
 *   - offset {x, y}: pan offset in CSS pixels (applied as translate)
 *   - handlers: event handlers to spread on the container element
 *   - fitToWindow(): fit the content to the container
 *   - resetTo100(): snap to 100% (scale=1, offset centred)
 *   - setScale(n): programmatic zoom (used by pill buttons)
 *   - setOffset(o): programmatic pan
 *
 * Zoom is VIEW state — it MUST NOT create undo frames.
 *
 * Usage:
 *   const pz = usePanZoom({ containerRef, contentSize: { w, h } })
 *   <div ref={containerRef} {...pz.handlers} style={{ overflow: 'hidden' }}>
 *     <div style={{ transform: `translate(${pz.offset.x}px, ${pz.offset.y}px) scale(${pz.scale})`, transformOrigin: '0 0' }}>
 *       {content}
 *     </div>
 *   </div>
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 8

export interface PanOffset {
  x: number
  y: number
}

export interface PanZoomState {
  scale: number
  offset: PanOffset
}

export interface PanZoomResult extends PanZoomState {
  setScale: (s: number) => void
  setOffset: (o: PanOffset) => void
  fitToWindow: () => void
  resetTo100: () => void
  /** Returns true when the given pointer event should be treated as a pan
   *  gesture (Space held or middle button) rather than a paint stroke.
   *  Call this in the canvas onPointerDown to guard against painting. */
  isPanGesture: (e: React.PointerEvent | PointerEvent) => boolean
  handlers: {
    onWheel?: (e: React.WheelEvent) => void
    onPointerDown?: (e: React.PointerEvent) => void
    onPointerMove?: (e: React.PointerEvent) => void
    onPointerUp?: (e: React.PointerEvent) => void
    onPointerCancel?: (e: React.PointerEvent) => void
  }
}

export interface UsePanZoomOptions {
  /** Ref to the container element (the scrollable/clipping wrapper). */
  containerRef: React.RefObject<HTMLElement | null>
  /** Logical content size in px (the un-scaled canvas dimensions). */
  contentSize: { w: number; h: number }
  /** Initial scale. Default 1. */
  initialScale?: number
  /** Initial offset. Default: content centred in container. */
  initialOffset?: PanOffset
  /** Called on every scale/offset change (view-state only, NOT undoable). */
  onChange?: (state: PanZoomState) => void
  /**
   * Inset the available area for fitToWindow() so the content centres in the
   * gap between floating panels rather than the full container.
   * Pixels excluded from each edge: { left, right, top, bottom }.
   */
  fitInset?: { left: number; right: number; top: number; bottom: number }
}

/** Clamp zoom to [ZOOM_MIN, ZOOM_MAX] and round to 2 dp. */
function clampScale(s: number): number {
  return +Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s)).toFixed(2)
}

/** Compute the offset that centres content in the container at given scale. */
export function centreOffset(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
  scale: number,
): PanOffset {
  return {
    x: (containerW - contentW * scale) / 2,
    y: (containerH - contentH * scale) / 2,
  }
}

/** Compute the scale + offset that fits content into the container with 5% padding. */
export function fitScale(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
): { scale: number; offset: PanOffset } {
  const padding = 0.05
  const maxW = containerW * (1 - padding * 2)
  const maxH = containerH * (1 - padding * 2)
  const s = clampScale(Math.min(maxW / contentW, maxH / contentH))
  return {
    scale: s,
    offset: centreOffset(containerW, containerH, contentW, contentH, s),
  }
}

export function usePanZoom({
  containerRef,
  contentSize,
  initialScale = 1,
  initialOffset,
  onChange,
  fitInset,
}: UsePanZoomOptions): PanZoomResult {
  const [scale, _setScale] = useState(initialScale)
  const [offset, _setOffset] = useState<PanOffset>(initialOffset ?? { x: 0, y: 0 })

  // Keep latest values in refs for use in event handlers (avoids stale closures).
  const scaleRef = useRef(scale)
  const offsetRef = useRef(offset)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const applyState = useCallback((s: number, o: PanOffset) => {
    const cs = clampScale(s)
    scaleRef.current = cs
    offsetRef.current = o
    _setScale(cs)
    _setOffset(o)
    onChangeRef.current?.({ scale: cs, offset: o })
  }, [])

  const setScale = useCallback((s: number) => {
    applyState(s, offsetRef.current)
  }, [applyState])

  const setOffset = useCallback((o: PanOffset) => {
    applyState(scaleRef.current, o)
  }, [applyState])

  const fitInsetRef = useRef(fitInset)
  useEffect(() => { fitInsetRef.current = fitInset }, [fitInset])

  const fitToWindow = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const { width: cw, height: ch } = el.getBoundingClientRect()
    const inset = fitInsetRef.current
    if (inset) {
      // Fit content into the inset gap between floating panels.
      // When fitInset is set the surface is flexbox-centred inside the padded
      // container, so pan offset (0,0) already centres it. We only need to
      // pick the scale that fits the content in the available area, and then
      // reset the pan offset to zero so flexbox takes over.
      const availW = cw - inset.left - inset.right
      const availH = ch - inset.top - inset.bottom
      const padding = 0.05
      const maxW = availW * (1 - padding * 2)
      const maxH = availH * (1 - padding * 2)
      const ns = clampScale(Math.min(maxW / contentSize.w, maxH / contentSize.h))
      applyState(ns, { x: 0, y: 0 })
    } else {
      const { scale: ns, offset: no } = fitScale(cw, ch, contentSize.w, contentSize.h)
      applyState(ns, no)
    }
  }, [containerRef, contentSize.w, contentSize.h, applyState])

  const resetTo100 = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const { width: cw, height: ch } = el.getBoundingClientRect()
    const no = centreOffset(cw, ch, contentSize.w, contentSize.h, 1)
    applyState(1, no)
  }, [containerRef, contentSize.w, contentSize.h, applyState])

  // ── Space/middle-button pan tracking ─────────────────────────────────────
  const spaceHeldRef = useRef(false)
  const panningRef = useRef(false)
  const panStartRef = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null)

  // Space key tracking — listen on window so it works regardless of focus
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        // Don't intercept space when typing in an input or activating a button
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
        e.preventDefault()
        spaceHeldRef.current = true
        const el = containerRef.current
        if (el) el.style.cursor = 'grab'
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false
        panningRef.current = false
        panStartRef.current = null
        const el = containerRef.current
        if (el) el.style.cursor = ''
      }
    }
    // If the user alt-tabs or otherwise loses window focus while Space is held,
    // we never receive the keyup.  Clear the latch on blur so the next
    // left-drag correctly paints rather than panning with no key held.
    const onBlur = () => {
      spaceHeldRef.current = false
      panningRef.current = false
      panStartRef.current = null
      const el = containerRef.current
      if (el) el.style.cursor = ''
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [containerRef])

  // ── Wheel → zoom at cursor ────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top

      const prevScale = scaleRef.current
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      const newScale = clampScale(prevScale * factor)
      if (newScale === prevScale) return

      // Zoom around the cursor position: the point under the cursor
      // should remain at the same screen position after scaling.
      const prevOx = offsetRef.current.x
      const prevOy = offsetRef.current.y
      const newOx = cx - (cx - prevOx) * (newScale / prevScale)
      const newOy = cy - (cy - prevOy) * (newScale / prevScale)
      applyState(newScale, { x: newOx, y: newOy })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [containerRef, applyState])

  // ── Pointer handlers (Space-pan or middle-button pan) ────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const isMiddle = e.button === 1
    if (!spaceHeldRef.current && !isMiddle) return
    e.preventDefault()
    panningRef.current = true
    panStartRef.current = {
      cx: e.clientX,
      cy: e.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    }
    const el = containerRef.current
    if (el) {
      el.style.cursor = 'grabbing'
      try { el.setPointerCapture(e.pointerId) } catch { /* headless */ }
    }
  }, [containerRef])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panningRef.current || !panStartRef.current) return
    const { cx, cy, ox, oy } = panStartRef.current
    applyState(scaleRef.current, {
      x: ox + e.clientX - cx,
      y: oy + e.clientY - cy,
    })
  }, [applyState])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!panningRef.current) return
    panningRef.current = false
    panStartRef.current = null
    const el = containerRef.current
    if (el) {
      el.style.cursor = spaceHeldRef.current ? 'grab' : ''
      try { el.releasePointerCapture(e.pointerId) } catch { /* headless */ }
    }
  }, [containerRef])

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }

  // Accessor: returns true when a pointer event is a pan gesture (Space held
  // or middle button).  Exposed so child canvas elements can guard their own
  // onPointerDown handlers against accidentally beginning a paint stroke.
  const isPanGesture = useCallback(
    (e: React.PointerEvent | PointerEvent) =>
      spaceHeldRef.current || e.button === 1,
    [],
  )

  return { scale, offset, setScale, setOffset, fitToWindow, resetTo100, isPanGesture, handlers }
}
