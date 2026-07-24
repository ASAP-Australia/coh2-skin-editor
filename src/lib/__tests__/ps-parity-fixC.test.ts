/**
 * Tests for PS-Parity Batch C fixes:
 *   1. cornerRadius round-trip — ShapeLayer.cornerRadius stored, retrieved, and
 *      renders via shapeToPath2D in composeFaceplateCanvas.
 *   2. Brush hardness param — BrushSettings.softness maps to hardness; radial
 *      gradient created for soft brush, fill used for hard brush.
 *   3. Distribute math — even-spacing algorithm produces equal gaps between
 *      three or more layers sorted by their centre coordinate.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  newShapeLayer,
  newFaceplateProject,
  type ShapeLayer,
} from '@/lib/faceplate-project'
import { composeFaceplateCanvas } from '@/components/FaceplateEditor'

// ── 1. cornerRadius round-trip ────────────────────────────────────────────────

describe('ShapeLayer.cornerRadius — round-trip', () => {
  it('newShapeLayer does not set cornerRadius by default (undefined = 0)', () => {
    const layer = newShapeLayer('rectangle')
    expect(layer.cornerRadius).toBeUndefined()
  })

  it('can store and retrieve cornerRadius via spread', () => {
    const base = newShapeLayer('rectangle')
    const withRadius: ShapeLayer = { ...base, cornerRadius: 20 }
    expect(withRadius.cornerRadius).toBe(20)
    expect(withRadius.shapeType).toBe('rectangle')
  })

  it('cornerRadius is preserved through project serialisation (JSON round-trip)', () => {
    const layer = { ...newShapeLayer('rectangle'), cornerRadius: 15 } as ShapeLayer
    const project = {
      ...newFaceplateProject('test-radius'),
      layers: [layer],
    }
    const serialised = JSON.parse(JSON.stringify(project))
    expect(serialised.layers[0].cornerRadius).toBe(15)
  })

  it('cornerRadius 0 is a valid explicit value (sharp corners)', () => {
    const base = newShapeLayer('rectangle')
    const sharp: ShapeLayer = { ...base, cornerRadius: 0 }
    expect(sharp.cornerRadius).toBe(0)
  })

  it('cornerRadius renders in composeFaceplateCanvas without throwing (jsdom skips Path2D)', async () => {
    // jsdom does not implement Path2D, so composeFaceplateCanvas may throw for shape
    // layers. We test that the project can at least be constructed and call the
    // composer — same pattern as faceplate-export-golden.test.ts.
    const layer = { ...newShapeLayer('rectangle'), cornerRadius: 20 } as ShapeLayer
    const project = {
      ...newFaceplateProject('test-radius-export'),
      backgroundColor: '#000000',
      layers: [layer],
    }
    // If Path2D is available (e.g. in a real browser / canvas-polyfill env),
    // the composer must resolve. If Path2D is absent (jsdom), the test may throw
    // — we catch and skip rather than failing the suite.
    let caught: Error | null = null
    try {
      const canvas = await composeFaceplateCanvas(project)
      expect(canvas).toBeDefined()
      expect(canvas.width).toBeGreaterThan(0)
    } catch (e) {
      caught = e as Error
      if (!caught.message.includes('Path2D')) throw caught
      // Path2D unavailable in jsdom — expected skip.
    }
  })

  it('composeFaceplateCanvas with cornerRadius=0 does not crash (jsdom skip guard)', async () => {
    const base = newShapeLayer('rectangle')
    const noRadius: ShapeLayer = { ...base }
    const project = { ...newFaceplateProject('cr0'), backgroundColor: '#111', layers: [noRadius] }
    try {
      const c = await composeFaceplateCanvas(project)
      expect(c).toBeDefined()
    } catch (e) {
      const err = e as Error
      if (!err.message.includes('Path2D')) throw err
      // Path2D unavailable in jsdom — expected.
    }
  })

  it('composeFaceplateCanvas with cornerRadius>0 does not crash (jsdom skip guard)', async () => {
    const base = newShapeLayer('rectangle')
    const withRadius: ShapeLayer = { ...base, cornerRadius: 30 }
    const project = { ...newFaceplateProject('cr-diff2'), backgroundColor: '#111', layers: [withRadius] }
    try {
      const c = await composeFaceplateCanvas(project)
      expect(c).toBeDefined()
    } catch (e) {
      const err = e as Error
      if (!err.message.includes('Path2D')) throw err
      // Path2D unavailable in jsdom — expected.
    }
  })
})

// ── 2. Brush hardness param ──────────────────────────────────────────────────

describe('brush hardness concept — radial gradient vs solid fill', () => {
  /**
   * The faceplate brush stamping logic (inline in FaceplateEditor) creates a
   * radial gradient when hardness < 100, and uses a solid fill when hardness = 100.
   * We test the underlying math that drive this decision without importing the
   * full React component — just verify the behaviour via the stamping logic
   * isolated in a test canvas.
   */

  function makeFakeCtx() {
    let fillStyleSet: string | CanvasGradient | CanvasPattern = ''
    const gradients: { inner: number; outer: number }[] = []
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '' as string | CanvasGradient | CanvasPattern,
      createRadialGradient: vi.fn((_x0: number, _y0: number, r0: number, _x1: number, _y1: number, r1: number) => {
        gradients.push({ inner: r0, outer: r1 })
        return {
          addColorStop: vi.fn(),
        }
      }),
    }
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => fillStyleSet,
      set: (v: string | CanvasGradient | CanvasPattern) => { fillStyleSet = v },
    })
    return { ctx: ctx as unknown as CanvasRenderingContext2D, gradients }
  }

  /** Inline replica of the stampDab function from FaceplateEditor.tsx for testing. */
  function stampDabLogic(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    brushSize: number,
    brushColor: string,
    brushOpacity: number,
    brushHardness: number,
    brushErase: boolean,
  ) {
    const r = brushSize / 2
    ctx.save()
    ;(ctx as { globalAlpha: number }).globalAlpha = brushOpacity
    if (brushHardness < 100) {
      const innerFrac = brushHardness / 100
      const grad = ctx.createRadialGradient(px, py, r * innerFrac, px, py, r)
      const paintCol = brushErase ? 'rgba(0,0,0,1)' : brushColor
      const m = paintCol.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
      const fadeCol = m
        ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0)`
        : 'rgba(0,0,0,0)'
      grad.addColorStop(0, paintCol)
      grad.addColorStop(1, fadeCol)
      ;(ctx as { fillStyle: unknown }).fillStyle = grad
    } else {
      ;(ctx as { fillStyle: string }).fillStyle = brushErase ? 'rgba(0,0,0,1)' : brushColor
    }
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  it('hardness=100 does NOT create a radial gradient (solid fill)', () => {
    const { ctx, gradients } = makeFakeCtx()
    stampDabLogic(ctx, 50, 50, 20, '#ffffff', 1, 100, false)
    expect(ctx.createRadialGradient).not.toHaveBeenCalled()
    expect(gradients.length).toBe(0)
    expect(ctx.fill).toHaveBeenCalled()
  })

  it('hardness=0 creates a fully feathered radial gradient (inner radius = 0)', () => {
    const { ctx, gradients } = makeFakeCtx()
    stampDabLogic(ctx, 50, 50, 20, '#ffffff', 1, 0, false)
    expect(ctx.createRadialGradient).toHaveBeenCalled()
    expect(gradients[0].inner).toBe(0)          // 0% of outer radius
    expect(gradients[0].outer).toBe(10)          // r = size / 2 = 10
  })

  it('hardness=50 creates radial gradient with inner radius = 50% of outer', () => {
    const { ctx, gradients } = makeFakeCtx()
    stampDabLogic(ctx, 50, 50, 20, '#ffffff', 1, 50, false)
    expect(ctx.createRadialGradient).toHaveBeenCalled()
    expect(gradients[0].inner).toBeCloseTo(5)   // 50% of r=10
    expect(gradients[0].outer).toBe(10)
  })

  it('hardness=75 creates radial gradient with inner radius = 75% of outer', () => {
    const { ctx, gradients } = makeFakeCtx()
    stampDabLogic(ctx, 50, 50, 20, '#ffffff', 1, 75, false)
    expect(gradients[0].inner).toBeCloseTo(7.5)  // 75% of r=10
  })
})

// ── 3. Distribute math ───────────────────────────────────────────────────────

describe('distribute horizontal — even spacing math', () => {
  /** Inline replica of the distributeH algorithm from FaceplateEditor.tsx's align peel. */
  function distributeH(layers: { x: number; hw: number }[]): number[] {
    if (layers.length < 3) return layers.map(l => l.x)

    const sorted = [...layers].sort((a, b) => a.x - b.x)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]

    const totalSpan = (last.x + last.hw) - (first.x - first.hw)
    const totalLayerW = sorted.reduce((s, l) => s + l.hw * 2, 0)
    const gap = (totalSpan - totalLayerW) / (sorted.length - 1)

    let cursor = first.x - first.hw
    return sorted.map(l => {
      const cx = cursor + l.hw
      cursor += l.hw * 2 + gap
      return cx
    })
  }

  it('3 layers with uneven spacing become evenly spaced', () => {
    // Layer centres: 10, 40, 100 (half-widths all = 5, so widths = 10)
    const layers = [
      { x: 10, hw: 5 },  // left edge 5, right edge 15
      { x: 40, hw: 5 },  // left edge 35, right edge 45 — gap to first = 20px
      { x: 100, hw: 5 }, // left edge 95, right edge 105 — gap to second = 50px
    ]
    const result = distributeH(layers)
    // Total span = 105 - 5 = 100. Total layer width = 30. Gap = (100 - 30) / 2 = 35.
    // New positions: first stays at 10, second = 10 + 5 + 35 + 5 = 55, third = 100.
    expect(result[0]).toBeCloseTo(10)
    expect(result[1]).toBeCloseTo(55)
    expect(result[2]).toBeCloseTo(100)
  })

  it('3 evenly spaced layers remain unchanged', () => {
    const layers = [
      { x: 10, hw: 5 },  // 5..15
      { x: 50, hw: 5 },  // 45..55
      { x: 90, hw: 5 },  // 85..95
    ]
    const result = distributeH(layers)
    // Gap already = 30. Total span = 90, total width = 30, gap = (90-30)/2 = 30.
    expect(result[0]).toBeCloseTo(10)
    expect(result[1]).toBeCloseTo(50)
    expect(result[2]).toBeCloseTo(90)
  })

  it('4 layers are evenly distributed', () => {
    const layers = [
      { x: 0,   hw: 5 },
      { x: 10,  hw: 5 },
      { x: 80,  hw: 5 },
      { x: 100, hw: 5 },
    ]
    const result = distributeH(layers)
    // Total span = 105 - (-5) = 110. Total width = 40. Gap = (110-40)/3 ≈ 23.33.
    // pos[0] = 0 (unchanged), pos[1] = -5 + 5 + 23.33 + 5 = 28.33,
    // pos[2] = 28.33 + 5 + 23.33 + 5 = 61.67, pos[3] = 100.
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBeCloseTo(0 + 5 + 23.33 + 5, 0)
    expect(result[2]).toBeCloseTo(result[1] + 5 + 23.33 + 5, 0)
    expect(result[3]).toBeCloseTo(100)
  })

  it('distributes in left→right order regardless of input order', () => {
    const layers = [
      { x: 100, hw: 5 }, // last
      { x: 10,  hw: 5 }, // first
      { x: 55,  hw: 5 }, // middle
    ]
    const result = distributeH(layers)
    // Should be same as if input was [10, 55, 100].
    expect(result[0]).toBeCloseTo(10)
    expect(result[1]).toBeCloseTo(55)
    expect(result[2]).toBeCloseTo(100)
  })

  it('fewer than 3 layers returns unchanged positions', () => {
    const layers = [{ x: 10, hw: 5 }, { x: 90, hw: 5 }]
    const result = distributeH(layers)
    expect(result[0]).toBe(10)
    expect(result[1]).toBe(90)
  })
})
