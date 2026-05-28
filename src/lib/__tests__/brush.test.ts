import { describe, it, expect, vi } from 'vitest'
import { withAlpha, paintBrushDab, paintBrushSegment, type BrushSettings } from '../brush'

describe('withAlpha', () => {
  it('converts 6-digit hex to rgba with the given alpha', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)')
  })

  it('converts black hex correctly', () => {
    expect(withAlpha('#000000', 1)).toBe('rgba(0,0,0,1)')
  })

  it('converts white hex correctly', () => {
    expect(withAlpha('#ffffff', 0)).toBe('rgba(255,255,255,0)')
  })

  it('returns 3-digit hex unchanged (not handled by withAlpha)', () => {
    // withAlpha only handles 7-char #RRGGBB; 3-digit hex falls through
    expect(withAlpha('#f00', 0.5)).toBe('#f00')
  })

  it('returns already-rgba input unchanged', () => {
    // already-rgba input is not a 7-char # string, so it passes through
    const input = 'rgba(255,0,0,1)'
    expect(withAlpha(input, 0.5)).toBe(input)
  })

  it('returns arbitrary non-hex color strings unchanged', () => {
    expect(withAlpha('red', 0.3)).toBe('red')
  })
})

// ── Eraser mode ───────────────────────────────────────────────────────────────

/** Minimal stub for CanvasRenderingContext2D — only the surface used by
 *  paintBrushDab in erase mode (save/restore/clip/arc/globalAlpha/drawImage). */
function makeCtx() {
  const calls: string[] = []
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    beginPath: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    globalAlpha: 1,
    drawImage: vi.fn(() => calls.push('drawImage')),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    _calls: calls,
  }
  return ctx as unknown as CanvasRenderingContext2D & { _calls: string[] }
}

/** Minimal HTMLCanvasElement stub. paintBrushDab only calls
 *  createElement('canvas') internally (in the soft-erase branch) and
 *  uses its getContext('2d'). We provide a factory that returns a canvas-
 *  like object with a mocked getContext. */
function makeVanillaCanvas() {
  const vanillaCtx = {
    drawImage: vi.fn(),
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
  const canvas = {
    width: 2048,
    height: 2048,
    getContext: vi.fn(() => vanillaCtx),
  } as unknown as HTMLCanvasElement
  return canvas
}

describe('paintBrushDab — erase mode', () => {
  const baseSettings: BrushSettings = {
    size: 64,
    color: '#ff0000',
    softness: 0,
    opacity: 1,
    mode: 'erase',
  }

  it('is a no-op when vanillaSource is null', () => {
    const ctx = makeCtx()
    paintBrushDab(ctx, 100, 100, baseSettings, null)
    // Nothing should have been drawn
    expect(ctx.drawImage).not.toHaveBeenCalled()
    expect(ctx.fill).not.toHaveBeenCalled()
  })

  it('is a no-op when vanillaSource is undefined', () => {
    const ctx = makeCtx()
    paintBrushDab(ctx, 100, 100, baseSettings, undefined)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('calls save/restore and draws from vanilla canvas when provided (hard edge)', () => {
    const ctx = makeCtx()
    const vanilla = makeVanillaCanvas()
    paintBrushDab(ctx, 100, 100, { ...baseSettings, softness: 0 }, vanilla)
    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
    // drawImage called with the vanilla canvas source
    expect(ctx.drawImage).toHaveBeenCalledWith(vanilla, 0, 0)
  })

  it('does NOT paint colour in erase mode', () => {
    const ctx = makeCtx()
    const vanilla = makeVanillaCanvas()
    paintBrushDab(ctx, 100, 100, baseSettings, vanilla)
    // fill() is only called in paint mode — should not appear in erase mode
    expect(ctx.fill).not.toHaveBeenCalled()
  })
})

describe('paintBrushSegment — erase mode forwarding', () => {
  it('passes vanillaSource to each dab along the segment', () => {
    const ctx = makeCtx()
    const vanilla = makeVanillaCanvas()
    const s: BrushSettings = { size: 64, color: '#00ff00', softness: 0, opacity: 1, mode: 'erase' }
    // Short segment of 1 step so we get exactly one dab call.
    paintBrushSegment(ctx, 0, 0, 1, 0, s, vanilla)
    // ctx.save must have been called (erase path calls save/restore per dab)
    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.drawImage).toHaveBeenCalledWith(vanilla, 0, 0)
  })

  it('is a no-op for the erase path when vanillaSource is omitted', () => {
    const ctx = makeCtx()
    const s: BrushSettings = { size: 64, color: '#00ff00', softness: 0, opacity: 1, mode: 'erase' }
    paintBrushSegment(ctx, 0, 0, 10, 0, s)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})

// ── Horizontal symmetry (v1.0 Edit-Texture flow) ──────────────────────────────
//
// The user's bedtime request was that symmetry must be disable-able from
// the Edit-Texture entry point. Default is OFF, and the symmetric option
// mirrors each dab across the canvas centre line. The tests below pin the
// arc-call positions, since paintBrushDab calls `ctx.arc(x, y, r, …)` once
// per dab — for a symmetric dab we expect exactly two arcs at the mirrored
// x coordinates, and for a non-symmetric dab exactly one arc.

describe('paintBrushDab — horizontal symmetry', () => {
  const baseSettings: BrushSettings = {
    size: 64,
    color: '#0000ff',
    softness: 0,
    opacity: 1,
  }

  it('non-symmetric dab paints once at the given x (no mirror)', () => {
    const ctx = makeCtx()
    paintBrushDab(ctx, 500, 1024, baseSettings)
    // `arc` is called once for the single dab.
    expect(ctx.arc).toHaveBeenCalledTimes(1)
    expect(ctx.arc).toHaveBeenCalledWith(500, 1024, 32, 0, Math.PI * 2)
  })

  it('symmetric dab paints twice — at x and at (canvasWidth - x)', () => {
    const ctx = makeCtx()
    const s: BrushSettings = { ...baseSettings, symmetric: true } // canvasWidth defaults to 2048
    paintBrushDab(ctx, 500, 1024, s)
    expect(ctx.arc).toHaveBeenCalledTimes(2)
    // First dab at the original (x, y), second at (2048 - x, y).
    expect(ctx.arc).toHaveBeenNthCalledWith(1, 500, 1024, 32, 0, Math.PI * 2)
    expect(ctx.arc).toHaveBeenNthCalledWith(2, 1548, 1024, 32, 0, Math.PI * 2)
  })

  it('respects custom canvasWidth for the mirror reflection', () => {
    const ctx = makeCtx()
    const s: BrushSettings = { ...baseSettings, symmetric: true, canvasWidth: 1024 }
    paintBrushDab(ctx, 256, 512, s)
    // Mirror across a 1024-wide canvas → 1024 - 256 = 768.
    expect(ctx.arc).toHaveBeenNthCalledWith(2, 768, 512, 32, 0, Math.PI * 2)
  })

  it('does NOT double-stamp at the canvas centre line', () => {
    const ctx = makeCtx()
    const s: BrushSettings = { ...baseSettings, symmetric: true }
    // 1024 is the centre of a 2048-wide canvas — mirror is itself.
    paintBrushDab(ctx, 1024, 1024, s)
    expect(ctx.arc).toHaveBeenCalledTimes(1)
  })
})

describe('paintBrushSegment — horizontal symmetry', () => {
  it('every dab in a segment is mirrored when symmetric is true', () => {
    const ctx = makeCtx()
    const s: BrushSettings = {
      size: 64,
      color: '#ff00ff',
      softness: 0,
      opacity: 1,
      symmetric: true,
    }
    // Step is size/4 = 16 over a length of 64 → 4 dabs → 8 arc calls.
    paintBrushSegment(ctx, 100, 100, 164, 100, s)
    expect(ctx.arc).toHaveBeenCalledTimes(8)
  })
})
