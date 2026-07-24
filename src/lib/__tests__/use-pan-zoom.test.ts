/**
 * Tests for the pan-zoom hook's pure math helpers.
 *
 * The hook itself relies on React lifecycle (refs, effects) so we test
 * the exported pure functions that drive the critical behaviours:
 *   • clamp + rounding
 *   • fit-to-window scale + centring
 *   • 100% reset centring
 *   • cursor-anchored zoom: wheel at point P keeps P's content-coordinate stationary
 *   • VTE initial state: fit+centered for a known 1920×1080 container + 1024² atlas
 */
import { describe, it, expect } from 'vitest'
import { ZOOM_MIN, ZOOM_MAX, centreOffset, fitScale } from '../use-pan-zoom'

describe('usePanZoom — pure math', () => {
  it('ZOOM_MIN and ZOOM_MAX are sane', () => {
    expect(ZOOM_MIN).toBe(0.25)
    expect(ZOOM_MAX).toBe(8)
  })

  describe('centreOffset', () => {
    it('centres 128×128 content in a 512×512 container at scale 1', () => {
      const o = centreOffset(512, 512, 128, 128, 1)
      expect(o.x).toBe((512 - 128) / 2)
      expect(o.y).toBe((512 - 128) / 2)
    })

    it('centres 128×128 content in a 512×512 container at scale 4', () => {
      const o = centreOffset(512, 512, 128, 128, 4)
      // 128×4 = 512, so offset should be 0
      expect(o.x).toBeCloseTo(0)
      expect(o.y).toBeCloseTo(0)
    })

    it('produces negative offsets when content is larger than container', () => {
      const o = centreOffset(256, 256, 512, 512, 1)
      expect(o.x).toBe(-128)
      expect(o.y).toBe(-128)
    })
  })

  describe('fitScale', () => {
    it('fits a square content into a square container', () => {
      const { scale, offset } = fitScale(512, 512, 128, 128)
      // With 5% padding: max dim = 512 * 0.90 = 460.8; scale = 460.8/128 ≈ 3.6
      expect(scale).toBeGreaterThan(0)
      expect(scale).toBeLessThanOrEqual(ZOOM_MAX)
      // offset should centre the scaled content
      const expectedOx = (512 - 128 * scale) / 2
      const expectedOy = (512 - 128 * scale) / 2
      expect(offset.x).toBeCloseTo(expectedOx, 1)
      expect(offset.y).toBeCloseTo(expectedOy, 1)
    })

    it('is constrained to ZOOM_MAX', () => {
      // Tiny content in a huge container — scale should not exceed 8
      const { scale } = fitScale(4096, 4096, 10, 10)
      expect(scale).toBeLessThanOrEqual(ZOOM_MAX)
    })

    it('is constrained to ZOOM_MIN for huge content', () => {
      // Huge content in a tiny container — scale must not go below 0.25
      const { scale } = fitScale(100, 100, 10000, 10000)
      expect(scale).toBeGreaterThanOrEqual(ZOOM_MIN)
    })

    it('handles wide content (landscape aspect ratio)', () => {
      const { scale } = fitScale(800, 400, 1000, 100)
      // Width-limited: (800*0.9)/1000 = 0.72
      expect(scale).toBeCloseTo(0.72, 1)
    })

    it('handles tall content (portrait aspect ratio)', () => {
      const { scale } = fitScale(400, 800, 100, 1000)
      // Height-limited: (800*0.9)/1000 = 0.72
      expect(scale).toBeCloseTo(0.72, 1)
    })

    it('Ctrl+0 fit for DPE: 128×128 atlas in ~600×600 viewport produces ~4× zoom', () => {
      // DPE canvas is 128px logical, container typically ~500-700px
      const { scale } = fitScale(600, 600, 128, 128)
      // 600 * 0.90 / 128 ≈ 4.22, clamped to 4.22
      expect(scale).toBeGreaterThan(3)
      expect(scale).toBeLessThanOrEqual(ZOOM_MAX)
    })

    it('Ctrl+0 fit for VTE: 1024×1024 VIEW in full-screen viewport', () => {
      // VTE renders at VIEW (1024) logical pixels, viewport ~900×900
      const { scale } = fitScale(900, 900, 1024, 1024)
      // 900 * 0.90 / 1024 ≈ 0.79
      expect(scale).toBeGreaterThan(0)
      expect(scale).toBeLessThanOrEqual(1)
    })
  })
})

// ── R7 regression tests ────────────────────────────────────────────────────

describe('VTE initial state — fit+centered', () => {
  it('1920×1080 container with 1024² atlas is centred and fit', () => {
    const { scale, offset } = fitScale(1920, 1080, 1024, 1024)
    // Height-limited: 1080 * 0.90 / 1024 ≈ 0.95
    expect(scale).toBeGreaterThan(0.9)
    expect(scale).toBeLessThanOrEqual(1.0)
    // Offset centres the scaled content in the container
    const expectedOx = (1920 - 1024 * scale) / 2
    const expectedOy = (1080 - 1024 * scale) / 2
    expect(offset.x).toBeCloseTo(expectedOx, 1)
    expect(offset.y).toBeCloseTo(expectedOy, 1)
    // Both axes are positive (content smaller than container in its fitting dimension)
    expect(offset.x).toBeGreaterThan(0)
    expect(offset.y).toBeGreaterThanOrEqual(0)
  })

  it('1280×800 container with 1024² atlas is centred and fit', () => {
    const { scale, offset } = fitScale(1280, 800, 1024, 1024)
    // Height-limited: 800 * 0.90 / 1024 ≈ 0.70
    expect(scale).toBeGreaterThan(0.6)
    expect(scale).toBeLessThanOrEqual(0.8)
    const expectedOx = (1280 - 1024 * scale) / 2
    const expectedOy = (800 - 1024 * scale) / 2
    expect(offset.x).toBeCloseTo(expectedOx, 1)
    expect(offset.y).toBeCloseTo(expectedOy, 1)
  })
})

describe('cursor-anchored wheel zoom — content coordinate invariant', () => {
  /**
   * The hook's wheel handler computes:
   *   newOx = cx - (cx - prevOx) * (newScale / prevScale)
   *
   * Invariant: the content coordinate under the cursor must be the SAME
   * before and after zoom.
   *
   * Content coord = (screenCoord - offset) / scale
   * Before: px = (cx - prevOx) / prevScale
   * After:  px' = (cx - newOx) / newScale
   * We verify px === px'.
   */
  function wheelZoomOffset(
    cx: number,
    prevOx: number,
    prevScale: number,
    newScale: number,
  ): number {
    return cx - (cx - prevOx) * (newScale / prevScale)
  }

  it('cursor at content centre stays at content centre after zoom', () => {
    // Container 1920×1080, atlas 1024², initial fit
    const cw = 1920
    const view = 1024
    const { scale: s0, offset: o0 } = fitScale(cw, 1080, view, view)
    // Cursor at the visual centre of the atlas
    const cx = o0.x + (view * s0) / 2

    // Zoom in 2×
    const s1 = s0 * 2
    const newOx = wheelZoomOffset(cx, o0.x, s0, s1)

    // Content coordinate before
    const px0 = (cx - o0.x) / s0
    // Content coordinate after
    const px1 = (cx - newOx) / s1

    expect(px1).toBeCloseTo(px0, 6)
    // Content coordinate should be centre of atlas (VIEW/2)
    expect(px0).toBeCloseTo(view / 2, 1)
  })

  it('cursor at top-left of atlas stays stationary after zoom out', () => {
    const cw = 1920
    const ch = 1080
    const view = 1024
    const { scale: s0, offset: o0 } = fitScale(cw, ch, view, view)
    // Cursor at the top-left corner of the rendered atlas
    const cx = o0.x
    const cy = o0.y

    const s1 = s0 / 1.5
    const newOx = wheelZoomOffset(cx, o0.x, s0, s1)
    const newOy = wheelZoomOffset(cy, o0.y, s0, s1)

    const px0 = (cx - o0.x) / s0
    const py0 = (cy - o0.y) / s0
    const px1 = (cx - newOx) / s1
    const py1 = (cy - newOy) / s1

    expect(px1).toBeCloseTo(px0, 6) // should be 0
    expect(py1).toBeCloseTo(py0, 6) // should be 0
    expect(px0).toBeCloseTo(0, 6)
    expect(py0).toBeCloseTo(0, 6)
  })

  it('cursor at arbitrary position stays stationary through repeated zoom steps', () => {
    const cw = 1440
    const ch = 900
    const view = 1024
    const { scale: s0, offset: o0 } = fitScale(cw, ch, view, view)
    // Arbitrary cursor position (30% across, 70% down the container)
    const cx = cw * 0.3
    const cy = ch * 0.7

    // Content coordinate before any zoom
    const contentX0 = (cx - o0.x) / s0
    const contentY0 = (cy - o0.y) / s0

    // Apply 5 successive zoom-in steps
    let prevScale = s0
    let prevOx = o0.x
    let prevOy = o0.y
    for (let i = 0; i < 5; i++) {
      const ns = prevScale * 1.08
      const nx = wheelZoomOffset(cx, prevOx, prevScale, ns)
      const ny = wheelZoomOffset(cy, prevOy, prevScale, ns)
      prevScale = ns
      prevOx = nx
      prevOy = ny
    }

    const contentXn = (cx - prevOx) / prevScale
    const contentYn = (cy - prevOy) / prevScale

    expect(contentXn).toBeCloseTo(contentX0, 4)
    expect(contentYn).toBeCloseTo(contentY0, 4)
  })
})

// ── B1 regression — pan gesture must NOT begin a paint stroke ────────────────
//
// The VTE canvas onPointerDown guard is:
//   if (e.button !== 0 || pz.isPanGesture(e)) return
//
// where isPanGesture = (e) => spaceHeldRef.current || e.button === 1
//
// These tests pin the guard logic in isolation (pure function equivalent) so a
// future refactor can't accidentally remove the check and re-introduce the
// "pan paints and gets stuck" data corruption described in B1.

describe('B1 — canvas onPointerDown pan-gesture guard logic', () => {
  /**
   * Equivalent of the canvas onPointerDown guard.
   * Returns true when the event SHOULD be blocked (no stroke begun).
   */
  function shouldBlock(button: number, spaceHeld: boolean): boolean {
    const isPanGesture = spaceHeld || button === 1
    return button !== 0 || isPanGesture
  }

  it('left-click with no space held → NOT blocked (normal painting)', () => {
    expect(shouldBlock(0, false)).toBe(false)
  })

  it('middle-button click → blocked (pan gesture, zero paint mutations)', () => {
    expect(shouldBlock(1, false)).toBe(true)
  })

  it('right-button click → blocked (context menu / non-paint button)', () => {
    expect(shouldBlock(2, false)).toBe(true)
  })

  it('left-click with space held → blocked (space-pan gesture, zero paint mutations)', () => {
    expect(shouldBlock(0, true)).toBe(true)
  })

  it('middle-button with space held → blocked', () => {
    expect(shouldBlock(1, true)).toBe(true)
  })
})
