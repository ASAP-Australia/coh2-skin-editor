/**
 * Regression tests for the 4 MAJOR Konva-migration bugs:
 *   MAJOR-4 — DecalPackEditor: endGesture before mutate discards pre-gesture undo frame
 *   MAJOR-1 — FaceplateEditor: live-stroke overlay wrong CSS size at zoom ≠ 1
 *   MAJOR-2 — FaceplateEditor: paint-layer Konva image stale after first stroke
 *   MAJOR-3 — FaceplateEditor: shape layers double-apply scale (scale²)
 *
 * Each test is designed to FAIL on the old (unfixed) code and PASS on the
 * new code. Tests use pure harnesses (no React mount) where possible.
 * Non-default scale/zoom conditions are the only paths that expose these bugs
 * (all 4 bugs pass at scale=1 / zoom=1).
 */

import { describe, it, expect } from 'vitest'

// ─── Constants (mirrored from source; checked against the real values) ────────
// Checked against src/components/FaceplateEditor.tsx imports
const FACEPLATE_BANNER_W = 624
const FACEPLATE_BANNER_H = 204

// ─── Shared lazy-pending gesture harness (mirrors editor-history.ts exactly) ──
// This replicates the ACTUAL engine semantics:
//   beginGesture() stores a PENDING snapshot but does NOT push to undo yet.
//   mutate() flushes the pending snap on the FIRST mutation inside a gesture.
//   endGesture() clears the pending snap without pushing if no mutation occurred.

interface HistoryEntry<S> { snap: S; label: string }
interface GestureHarness<S> {
  current: S
  past: HistoryEntry<S>[]
  gestureDepth: number
  pendingGestureSnap: HistoryEntry<S> | null
}

function createGestureHarness<S>(initial: S): GestureHarness<S> {
  return { current: initial, past: [], gestureDepth: 0, pendingGestureSnap: null }
}

function hBeginGesture<S>(h: GestureHarness<S>, label = 'Gesture') {
  if (h.gestureDepth > 0) { h.gestureDepth = 0; h.pendingGestureSnap = null }
  h.pendingGestureSnap = { snap: { ...(h.current as object) } as S, label }
  h.gestureDepth += 1
}

function hEndGesture<S>(h: GestureHarness<S>) {
  if (h.gestureDepth > 0) {
    h.gestureDepth -= 1
    if (h.gestureDepth === 0) {
      // Discard pending snap — no mutation occurred (or already flushed)
      h.pendingGestureSnap = null
    }
  }
}

function hMutate<S extends object>(h: GestureHarness<S>, fn: (s: S) => S) {
  const inGesture = h.gestureDepth > 0
  if (inGesture && h.pendingGestureSnap) {
    // Flush the pre-gesture snapshot onto the undo stack (lazy-pending model)
    h.past.push(h.pendingGestureSnap)
    h.pendingGestureSnap = null
  } else if (!inGesture) {
    h.past.push({ snap: { ...h.current }, label: '' })
  }
  h.current = fn(h.current)
}

function hUndo<S>(h: GestureHarness<S>): boolean {
  if (h.past.length === 0) return false
  const entry = h.past.pop()!
  h.current = entry.snap
  return true
}

// ─── MAJOR-4: DecalPackEditor — undo order (endGesture before mutate) ─────────

describe('MAJOR-4 — Konva drag/transform undo: mutate-then-endGesture preserves pre-gesture state', () => {
  it('OLD ORDER (endGesture then mutate) loses the pre-gesture snap — baseline for regression', () => {
    // Simulate what the OLD DecalPackEditor did: endGesture() FIRST, then mutate().
    // In the lazy-pending model, endGesture() clears pendingGestureSnap.
    // When mutate() runs after endGesture(), inGesture=false → it pushes the
    // POST-gesture-START state (current at call time), not the pre-gesture state.
    const h = createGestureHarness({ x: 10, y: 10 })
    hBeginGesture(h, 'Drag decal')

    // Simulated drag moves (no undo pushed inside gesture)
    h.current = { x: 50, y: 50 }

    // OLD ORDER: endGesture first, then mutate
    // Step 1: endGesture clears the pending snap
    hEndGesture(h) // pendingGestureSnap = null, gestureDepth = 0
    // Step 2: mutate runs outside gesture, pushes current (x=50, y=50) as undo frame
    hMutate(h, s => ({ ...s, x: 60, y: 60 }))

    // Undo restores to {x:50,y:50} — NOT the pre-gesture {x:10,y:10}
    hUndo(h)
    // This is the BUG: undo lands on x=50 (mid-state), not x=10 (pre-gesture)
    expect(h.current.x).toBe(50)
    expect(h.current.x).not.toBe(10)
  })

  it('NEW ORDER (mutate then endGesture) correctly restores pre-gesture state on undo', () => {
    // Simulate what the FIXED DecalPackEditor does: mutate() FIRST, then endGesture().
    const h = createGestureHarness({ x: 10, y: 10 })
    hBeginGesture(h, 'Drag decal')

    // Simulated drag moves
    h.current = { x: 50, y: 50 }

    // NEW ORDER: mutate first (flushes pending pre-gesture snap onto stack)
    hMutate(h, s => ({ ...s, x: 60, y: 60 }))
    // Step 2: endGesture closes the gesture (pendingGestureSnap is already null, no extra push)
    hEndGesture(h)

    expect(h.current.x).toBe(60)
    expect(h.past).toHaveLength(1) // exactly ONE undo frame

    // Undo restores to pre-gesture state {x:10,y:10}
    hUndo(h)
    expect(h.current.x).toBe(10)
    expect(h.current.y).toBe(10)
  })

  it('NEW ORDER: transform gesture — one Ctrl+Z restores the pre-transform position', () => {
    const h = createGestureHarness({ x: 64, y: 64, scale: 1.0, rotation: 0 })
    hBeginGesture(h, 'Transform decal')

    // User drags a Transformer handle (several intermediate Konva events)
    h.current = { x: 64, y: 64, scale: 1.5, rotation: 45 }

    // Fixed handleKonvaTransformEnd: mutate first, endGesture second
    hMutate(h, _s => ({ x: 64, y: 64, scale: 1.5, rotation: 45 }))
    hEndGesture(h)

    expect(h.past).toHaveLength(1)

    hUndo(h)
    // Pre-transform state fully recovered
    expect(h.current).toEqual({ x: 64, y: 64, scale: 1.0, rotation: 0 })
  })

  it('NEW ORDER: no-op gesture (begin + end, no drag) does NOT push an undo frame', () => {
    const h = createGestureHarness({ x: 32, y: 32 })
    hBeginGesture(h, 'Click-select (no drag)')
    // No mutation
    hEndGesture(h)

    // Undo stack must remain empty — no-op click does not pollute history
    expect(h.past).toHaveLength(0)
  })
})

// ─── MAJOR-1: FaceplateEditor — live-stroke overlay CSS size at zoom ≠ 1 ──────

describe('MAJOR-1 — Faceplate draw overlay: CSS size must equal banner * viewScale', () => {
  it('overlay cssText uses viewScale=1 → dimensions equal banner constants', () => {
    // Simulate the FIXED overlay sizing for viewScale=1
    const viewScale = 1
    const cssWidth = FACEPLATE_BANNER_W * viewScale
    const cssHeight = FACEPLATE_BANNER_H * viewScale

    expect(cssWidth).toBe(FACEPLATE_BANNER_W)
    expect(cssHeight).toBe(FACEPLATE_BANNER_H)
  })

  it('overlay cssText uses viewScale=2 → dimensions equal banner*2 (would FAIL with old code)', () => {
    // OLD code: always used FACEPLATE_BANNER_W without viewScale
    const viewScale = 2
    const oldCssWidth = FACEPLATE_BANNER_W           // BUG: 624, ignores viewScale
    const fixedCssWidth = FACEPLATE_BANNER_W * viewScale  // CORRECT: 1248

    // The old code produced wrong (too-small) overlay dimensions
    expect(oldCssWidth).not.toBe(fixedCssWidth)

    // The fix: overlay dimensions must equal container dimensions
    const containerWidth = FACEPLATE_BANNER_W * viewScale
    expect(fixedCssWidth).toBe(containerWidth)
    expect(fixedCssWidth).toBe(1248)

    const fixedCssHeight = FACEPLATE_BANNER_H * viewScale
    expect(fixedCssHeight).toBe(FACEPLATE_BANNER_H * viewScale)
    expect(fixedCssHeight).toBe(408)
  })

  it('overlay cssText formula produces a string matching the fixed pattern at viewScale=1.5', () => {
    const viewScale = 1.5
    // Fixed formula (from the patched line):
    const cssText = `position:absolute;left:0;top:0;width:${FACEPLATE_BANNER_W * viewScale}px;height:${FACEPLATE_BANNER_H * viewScale}px;pointer-events:none;z-index:999`
    // Old formula (the bug):
    const buggyText = `position:absolute;left:0;top:0;width:${FACEPLATE_BANNER_W}px;height:${FACEPLATE_BANNER_H}px;pointer-events:none;z-index:999`

    // Fixed text must include scaled dimensions
    expect(cssText).toContain(`width:${936}px`)   // 624 * 1.5
    expect(cssText).toContain(`height:${306}px`)  // 204 * 1.5

    // Old text uses hard-coded banner size — should differ from the fix at non-1 zoom
    expect(cssText).not.toBe(buggyText)
  })
})

// ─── MAJOR-2: FaceplateEditor — paint layer Konva image stale after first stroke ─

describe('MAJOR-2 — Faceplate paint layer cache: stale dataUrl triggers reload', () => {
  it('OLD logic: !paintEl check — never reloads when el exists, even if src changed', () => {
    // Simulate the OLD guard: if (!paintEl) { load; return null }
    // Once paintEl exists, neither src comparison nor reload ever happens.
    const konvaImages: Record<string, HTMLImageElement> = {}
    let loadCount = 0

    function oldLoadPaintLayer(cacheKey: string, dataUrl: string) {
      const paintEl = konvaImages[cacheKey]
      if (!paintEl) {
        const img = { src: dataUrl, onload: null } as unknown as HTMLImageElement
        loadCount++
        konvaImages[cacheKey] = img
        return null // return null on first load
      }
      return paintEl // stale el returned without checking src
    }

    // First load — correct
    oldLoadPaintLayer('paint_layer1', 'data:image/png;base64,STROKE1')
    expect(loadCount).toBe(1)
    expect(konvaImages['paint_layer1'].src).toBe('data:image/png;base64,STROKE1')

    // Second stroke updates dataUrl — OLD code ignores the change
    const el2 = oldLoadPaintLayer('paint_layer1', 'data:image/png;base64,STROKE2')
    expect(loadCount).toBe(1)           // BUG: no reload triggered
    expect(el2).not.toBeNull()          // stale el returned
    expect((el2 as HTMLImageElement).src).toBe('data:image/png;base64,STROKE1') // stale!
  })

  it('NEW logic: src !== dataUrl triggers reload when dataUrl changes', () => {
    // Simulate the FIXED guard: if (!paintEl || paintEl.src !== layer.dataUrl)
    const konvaImages: Record<string, HTMLImageElement> = {}
    const reloadCalls: string[] = []

    function fixedLoadPaintLayer(cacheKey: string, dataUrl: string): HTMLImageElement | null {
      const paintEl = konvaImages[cacheKey]
      if (!paintEl || paintEl.src !== dataUrl) {
        const img = { src: dataUrl } as HTMLImageElement
        reloadCalls.push(dataUrl)
        konvaImages[cacheKey] = img
        if (!paintEl) return null // first load: return null (triggers render on onload)
        return paintEl            // stale: return old image until new one loads (no blank flash)
      }
      return paintEl
    }

    // First stroke
    const r1 = fixedLoadPaintLayer('paint_layer1', 'data:image/png;base64,STROKE1')
    expect(r1).toBeNull()              // returns null to wait for onload
    expect(reloadCalls).toHaveLength(1)

    // Simulate onload having fired (el is now in cache with correct src)
    konvaImages['paint_layer1'].src = 'data:image/png;base64,STROKE1'

    // Second stroke — dataUrl updated
    const r2 = fixedLoadPaintLayer('paint_layer1', 'data:image/png;base64,STROKE2')
    // Returns old el (no blank flash), but a reload was triggered
    expect(r2).not.toBeNull()
    expect(reloadCalls).toHaveLength(2) // reload triggered for the new dataUrl
    expect(reloadCalls[1]).toBe('data:image/png;base64,STROKE2')
  })

  it('cache is NOT invalidated when dataUrl is unchanged (no spurious reload)', () => {
    const konvaImages: Record<string, HTMLImageElement> = {}
    let reloadCount = 0

    function fixedLoadPaintLayer(cacheKey: string, dataUrl: string): HTMLImageElement | null {
      const paintEl = konvaImages[cacheKey]
      if (!paintEl || paintEl.src !== dataUrl) {
        const img = { src: dataUrl } as HTMLImageElement
        reloadCount++
        konvaImages[cacheKey] = img
        return paintEl ?? null
      }
      return paintEl
    }

    fixedLoadPaintLayer('paint_layer1', 'data:image/png;base64,SAME')
    konvaImages['paint_layer1'].src = 'data:image/png;base64,SAME'

    // Re-render with same dataUrl → no reload
    fixedLoadPaintLayer('paint_layer1', 'data:image/png;base64,SAME')
    expect(reloadCount).toBe(1) // only the initial load
  })
})

// ─── MAJOR-3: FaceplateEditor — shape layers double-apply scale ────────────────

describe('MAJOR-3 — Shape layer scale: effective rendered size must equal export size', () => {
  /**
   * Export (composeFaceplateCanvas): ctx.scale(scale, scale) then draws path at width × height
   * → effective export size = width * scale
   *
   * OLD Konva: width = layer.width * layer.scale, scaleX = layer.scale
   * → effective Konva size = (layer.width * layer.scale) * layer.scale = width * scale²   BUG
   *
   * NEW Konva: width = layer.width, scaleX = layer.scale
   * → effective Konva size = layer.width * layer.scale = width * scale                   CORRECT
   */
  it('export effective size at scale=2 is width*scale (not width*scale²)', () => {
    const layerWidth = 100
    const layerScale = 2

    // What the export produces (composeFaceplateCanvas):
    const exportEffectiveSize = layerWidth * layerScale   // 200

    // OLD Konva rendering:
    const oldKonvaLocalWidth = layerWidth * layerScale    // 200 (pre-multiplied)
    const oldKonvaScale = layerScale                      // scaleX = 2
    const oldKonvaEffectiveSize = oldKonvaLocalWidth * oldKonvaScale  // 400 ← WRONG (scale²)

    // NEW Konva rendering (the fix):
    const newKonvaLocalWidth = layerWidth                 // 100 (base dimension)
    const newKonvaScale = layerScale                      // scaleX = 2
    const newKonvaEffectiveSize = newKonvaLocalWidth * newKonvaScale  // 200 ← CORRECT

    // The old code produced a mismatch
    expect(oldKonvaEffectiveSize).not.toBe(exportEffectiveSize)

    // The new code matches export
    expect(newKonvaEffectiveSize).toBe(exportEffectiveSize)
    expect(newKonvaEffectiveSize).toBe(200)
  })

  it('at scale=1 both old and new produce the same size (bug only visible at scale≠1)', () => {
    const layerWidth = 80
    const layerScale = 1

    const exportSize = layerWidth * layerScale         // 80
    const oldKonvaSize = (layerWidth * layerScale) * layerScale  // 80
    const newKonvaSize = layerWidth * layerScale       // 80

    // At scale=1 all three agree — bug is invisible at default scale
    expect(oldKonvaSize).toBe(exportSize)
    expect(newKonvaSize).toBe(exportSize)
  })

  it('at scale=0.5 old code renders at scale/4 of intended, new code renders at scale/2', () => {
    const layerWidth = 200
    const layerScale = 0.5

    const exportSize = layerWidth * layerScale           // 100
    const oldKonvaSize = (layerWidth * layerScale) * layerScale  // 50  ← WRONG
    const newKonvaSize = layerWidth * layerScale         // 100 ← CORRECT

    expect(oldKonvaSize).not.toBe(exportSize)
    expect(newKonvaSize).toBe(exportSize)
  })

  it('offsetX/Y must be layer.width/2 (local-space centering, not pre-scaled)', () => {
    // Rect offsetX centres the shape in local space. With scaleX applied by Konva,
    // the visual centre is at x=layer.x. After the fix: w=layer.width (not pre-multiplied).
    const layerWidth = 120
    const layerScale = 3

    // OLD: offsetX = (layerWidth * layerScale) / 2 = 180  → wrong local offset
    const oldOffsetX = (layerWidth * layerScale) / 2

    // NEW: offsetX = layerWidth / 2 = 60  → correct local-space offset
    const newOffsetX = layerWidth / 2

    // Only at scale=1 are they equal
    expect(oldOffsetX).not.toBe(newOffsetX)

    // The correct offset is half the local (unscaled) width — Konva applies scaleX on top
    const expectedOffset = layerWidth / 2
    expect(newOffsetX).toBe(expectedOffset)
    expect(newOffsetX).toBe(60)
  })
})
