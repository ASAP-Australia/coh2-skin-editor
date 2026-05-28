/**
 * Freehand brush helpers for the 2048² diffuse canvas.
 *
 * The Editor owns the offscreen canvas; brush state lives in component
 * state. These helpers are stateless — caller passes everything needed
 * for a stroke segment. We DON'T touch project state here; the Editor is
 * responsible for snapshotting the canvas to customDiffuseUrl on stroke
 * end so the painted result persists.
 *
 * Coordinate convention: caller passes `{ x, y }` in 2048² canvas space
 * (NOT UV). Editor converts UV → canvas via `x = u * 2048, y = (1 - v) * 2048`
 * to match the rest of the decal pipeline.
 *
 * ## Brush modes
 * - `'paint'` (default): fills the dab area with `settings.color` blended
 *   at `settings.opacity`, with optional feathered edge via `settings.softness`.
 * - `'erase'`: restores pixels to the vanilla diffuse within the dab radius
 *   instead of painting a new colour. Requires `vanillaSource` to be passed;
 *   if it is absent the call is a no-op so callers never need to guard
 *   against a missing ref. Undo/redo behaviour is identical to paint — the
 *   Editor snapshots history before the stroke begins.
 */

export interface BrushSettings {
  size: number // diameter in canvas pixels (8–512)
  color: string // CSS color (#RRGGBB or rgba(...))
  softness: number // 0..1 — feathered edge falloff
  opacity: number // 0..1
  /**
   * Brush mode. `'paint'` (default) draws colour onto the canvas.
   * `'erase'` restores pixels to the vanilla diffuse within the brush
   * radius — effectively "undoing" paint strokes locally without touching
   * the undo history (which tracks whole strokes, not individual pixels).
   */
  mode?: 'paint' | 'erase'
  /**
   * Horizontal symmetry. When `true`, every dab/segment is mirrored across
   * the vertical centre line of the canvas (`x' = canvasWidth - x`). Useful
   * for vehicle skins where the left and right halves of the chassis share
   * UV space and the user wants to paint a stripe / number / camo pattern
   * that looks the same from both sides. Defaults to `false` so plain
   * one-handed painting is the no-surprise default; the "Edit texture" pill
   * surfaces this toggle so the user can opt in (and the user's bedtime
   * request was explicitly to make it _disableable_ — which it is, by
   * default, here).
   */
  symmetric?: boolean
  /**
   * Width of the underlying canvas in pixels. Only consulted when
   * `symmetric === true` to compute the mirrored x coordinate. Defaults
   * to 2048 (the CoH2 diffuse atlas size) but is exposed so tests and
   * the FaceplateEditor (1024² atlas) can override it.
   */
  canvasWidth?: number
}

export const DEFAULT_BRUSH: BrushSettings = {
  size: 64,
  color: '#7a8a4e',
  softness: 0.45,
  opacity: 0.85,
}

/**
 * Paint a single dab at (x, y). Used both for the leading-edge of a stroke
 * and for "click to dab" interactions.
 *
 * When `s.mode === 'erase'`, pixels within the brush radius are replaced
 * with those from `vanillaSource` (the unmodified CoH2 diffuse). A radial
 * clip mask is applied so only the circular brush area is affected; the
 * `s.softness` value is honoured by partially restoring pixels at the
 * perimeter via a temporary off-screen canvas that fades the copy-operation.
 * If `vanillaSource` is null the call is a no-op (defensive — callers
 * always pass it when erasing, but the guard prevents hard crashes if the
 * model hasn't loaded yet).
 */
export function paintBrushDab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: BrushSettings,
  vanillaSource?: HTMLCanvasElement | null,
): void {
  // Horizontal symmetry: paint the primary dab at (x, y) and a mirrored
  // dab at (canvasWidth - x, y). Implemented by recursing into ourselves
  // with `symmetric` stripped so we never loop forever. We deliberately
  // stamp two separate dabs (rather than mirroring the canvas) so the
  // erase-mode `vanillaSource` lookup still maps to the right pixel on
  // each side, and the radial gradient lands at the correct centre.
  if (s.symmetric) {
    const w = s.canvasWidth ?? 2048
    const mirrored = w - x
    const noSym: BrushSettings = { ...s, symmetric: false }
    paintBrushDab(ctx, x, y, noSym, vanillaSource)
    // Avoid double-stamping at the centre line where x === mirrored.
    if (Math.abs(mirrored - x) > 0.5) {
      paintBrushDab(ctx, mirrored, y, noSym, vanillaSource)
    }
    return
  }

  const r = s.size / 2

  if (s.mode === 'erase') {
    // Erase mode: composite a circular patch from vanillaSource onto ctx.
    // We use a temporary canvas to build a feathered mask so that softness
    // still creates a smooth edge when erasing, mirroring paint behaviour.
    if (!vanillaSource) return
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.clip()

    if (s.softness > 0) {
      // Build a temporary canvas the size of the bounding box, draw the
      // vanilla patch into it, then use a radial-gradient mask for feathering.
      const diameter = Math.ceil(s.size) + 2
      const tmp = document.createElement('canvas')
      tmp.width = tmp.height = diameter
      const tctx = tmp.getContext('2d')!
      const ox = Math.round(x - diameter / 2)
      const oy = Math.round(y - diameter / 2)
      tctx.drawImage(vanillaSource, ox, oy, diameter, diameter, 0, 0, diameter, diameter)
      // Apply a radial gradient as destination-in mask (feathered alpha).
      const cx = diameter / 2
      const grad = tctx.createRadialGradient(cx, cx, r * (1 - s.softness), cx, cx, r)
      grad.addColorStop(0, `rgba(0,0,0,${s.opacity})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      tctx.globalCompositeOperation = 'destination-in'
      tctx.fillStyle = grad
      tctx.fillRect(0, 0, diameter, diameter)
      // Stamp the feathered patch back onto the target canvas.
      ctx.drawImage(tmp, ox, oy)
    } else {
      // Hard edge — copy vanilla pixels directly inside the clipped circle.
      ctx.globalAlpha = s.opacity
      ctx.drawImage(vanillaSource, 0, 0)
    }

    ctx.restore()
    return
  }

  // ── paint mode (default) ──────────────────────────────────────────────
  ctx.save()
  ctx.globalAlpha = s.opacity
  if (s.softness > 0) {
    const grad = ctx.createRadialGradient(x, y, r * (1 - s.softness), x, y, r)
    grad.addColorStop(0, s.color)
    grad.addColorStop(1, withAlpha(s.color, 0))
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = s.color
  }
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Paint a stroke segment from (x0, y0) to (x1, y1) by stamping dabs along
 * a line at a step size proportional to the brush radius. This gives a
 * smooth continuous look even when the input pointer events arrive
 * sparsely (which they do during fast drags).
 *
 * When `s.mode === 'erase'`, `vanillaSource` is forwarded to each dab
 * so the erase path can restore vanilla pixels along the entire segment.
 */
export function paintBrushSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  s: BrushSettings,
  vanillaSource?: HTMLCanvasElement | null,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const dist = Math.hypot(dx, dy)
  // Step at quarter-radius so soft brushes blend evenly; clamp to 1 px so
  // we don't divide by zero for stationary input.
  const step = Math.max(1, s.size / 4)
  const n = Math.max(1, Math.ceil(dist / step))
  // Symmetric segments are handled by `paintBrushDab` recursively — each
  // dab in the loop fires its own mirrored twin, so we don't have to plot
  // a separate mirrored polyline here. (Plotting the polyline explicitly
  // would also work, but would double the per-pointer-event canvas-state
  // saves/restores, hurting drag-paint throughput on big brushes.)
  for (let i = 1; i <= n; i++) {
    const t = i / n
    paintBrushDab(ctx, x0 + dx * t, y0 + dy * t, s, vanillaSource)
  }
}

/**
 * Sample the pixel under (x, y) and return it as #RRGGBB. Used for an
 * eyedropper tool that pairs naturally with the brush.
 */
export function samplePixel(ctx: CanvasRenderingContext2D, x: number, y: number): string {
  const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
  return (
    '#' +
    d[0].toString(16).padStart(2, '0') +
    d[1].toString(16).padStart(2, '0') +
    d[2].toString(16).padStart(2, '0')
  )
}

/** Insert alpha into a #RRGGBB string → 'rgba(r,g,b,a)'. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  return color
}
