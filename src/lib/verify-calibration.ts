/**
 * verify-calibration.ts — shared calibration-decal definition for the VISUAL
 * unwrap verifier (Phase 2).
 *
 * The calibration decal is a high-contrast, fully-opaque square split into FOUR
 * solid-colour quadrants. The quadrant colours make orientation / mirroring
 * detectable in the rendered frame WITHOUT template matching: we simply classify
 * each differing pixel to its nearest quadrant colour and compare the TL vs BR
 * centroids (TL must land above-and-left of BR when the decal renders upright).
 *
 * This module is consumed by BOTH:
 *   • the browser (AuditRunner's verify mode) — to rasterise the calibration
 *     square into the badge-cluster cell of a 2048² transparent wrapper canvas,
 *     replicating Editor.tsx's `badgeDecalSource` construction exactly, so the
 *     REAL onBeforeCompile TC1 badge shader in Viewport is exercised.
 *   • Node (scripts/verify-unwrap-visual.mts) — to classify footprint pixels by
 *     quadrant for the ORIENTATION assertion.
 *
 * Keep this file dependency-free (no DOM / no Node APIs at module scope) so it
 * imports cleanly in both environments.
 */

/** RGB triple, 0-255. */
export type Rgb = readonly [number, number, number]

/**
 * The four quadrant colours. Chosen to be maximally separated in RGB so that
 * even after sRGB → linear → tone-map → sRGB round-tripping through the real
 * render pipeline they remain unambiguously classifiable, and so none collides
 * with typical tank-hull greys/greens or the sky/ground background.
 *
 *   TL = magenta   TR = cyan
 *   BL = yellow    BR = green
 */
export const QUADRANT_COLORS = {
  TL: [255, 0, 255] as Rgb, // magenta
  TR: [0, 255, 255] as Rgb, // cyan
  BL: [255, 255, 0] as Rgb, // yellow
  BR: [0, 200, 0]   as Rgb, // green
} as const

export type Quadrant = keyof typeof QUADRANT_COLORS

/** Ordered list for iteration / nearest-colour classification. */
export const QUADRANT_LIST: Quadrant[] = ['TL', 'TR', 'BL', 'BR']

/**
 * Badge-cluster cell in a 2048² atlas, IDENTICAL to Editor.tsx's local-pack
 * `badgeDecalSource` construction (Editor.tsx ~line 891). The calibration
 * square is drawn ONLY into this cell; everything else is transparent so the
 * TC1 shader's bounds-check gates it to badge-cluster geometry only.
 */
export const BADGE_CELL = { x: 586, y: 80, w: 104, h: 96 } as const

/** Canonical wrapper-canvas size (matches Editor.tsx local-pack path). */
export const WRAPPER_SIZE = 2048

/**
 * Fraction of the badge cell the calibration square fills, CENTERED, with
 * transparent margins around it. A REAL decal/insignia does NOT fill the whole
 * badge cell — the app draws badges at BADGE_FRACTION≈0.31 of the rect
 * (king-tiger-decal-bake.ts) and real insignia PNGs carry transparent
 * backgrounds. A fully-opaque cell-filling square would paint EVERY body
 * polygon whose baked TC1 falls anywhere inside the badge cell, manufacturing a
 * whole-hull "smear" that a real (mostly-transparent) badge would never produce.
 *
 * We inset to 0.6 — big enough that the four quadrants stay unambiguously
 * classifiable in the render, small enough to leave a transparent frame so the
 * footprint reflects a realistic badge landing (and genuine smears — geometry
 * mapping to the badge CENTRE — still show up).
 */
export const CAL_CELL_FILL = 0.6

/**
 * Draw the four-quadrant calibration square into `ctx` filling the rect
 * (x, y, w, h). Fully opaque. Pure Canvas2D — works with the browser
 * CanvasRenderingContext2D and the `canvas` npm package's context alike.
 */
export function drawCalibrationSquare(
  ctx: {
    fillStyle: string | CanvasGradient | CanvasPattern
    fillRect(x: number, y: number, w: number, h: number): void
  },
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const hw = Math.floor(w / 2)
  const hh = Math.floor(h / 2)
  const rgb = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`
  // TL
  ctx.fillStyle = rgb(QUADRANT_COLORS.TL)
  ctx.fillRect(x, y, hw, hh)
  // TR
  ctx.fillStyle = rgb(QUADRANT_COLORS.TR)
  ctx.fillRect(x + hw, y, w - hw, hh)
  // BL
  ctx.fillStyle = rgb(QUADRANT_COLORS.BL)
  ctx.fillRect(x, y + hh, hw, h - hh)
  // BR
  ctx.fillStyle = rgb(QUADRANT_COLORS.BR)
  ctx.fillRect(x + hw, y + hh, w - hw, h - hh)
}

/**
 * Build the calibration `badgeDecalSource` wrapper canvas exactly as Editor.tsx
 * builds a local-pack badge source: a WRAPPER_SIZE² transparent canvas with the
 * four-quadrant calibration square rasterised ONLY into BADGE_CELL. BROWSER
 * ONLY (uses document.createElement).
 *
 * Passing the returned canvas as Viewport's `badgeDecalSource` prop routes it
 * through the real TC1 onBeforeCompile shader (flipY=false upload), which is the
 * exact pipeline this verifier must exercise.
 */
export function buildCalibrationWrapperCanvas(): HTMLCanvasElement {
  const wrapper = document.createElement('canvas')
  wrapper.width = wrapper.height = WRAPPER_SIZE
  const ctx = wrapper.getContext('2d')!
  ctx.clearRect(0, 0, WRAPPER_SIZE, WRAPPER_SIZE)
  // Centre the four-quadrant square within the badge cell at CAL_CELL_FILL of
  // the cell, leaving a transparent margin (mimics a real insignia's transparent
  // background — see CAL_CELL_FILL). This prevents a fully-opaque cell from
  // manufacturing a whole-hull smear on vehicles whose body TC1 clips the cell.
  const w = Math.round(BADGE_CELL.w * CAL_CELL_FILL)
  const h = Math.round(BADGE_CELL.h * CAL_CELL_FILL)
  const x = BADGE_CELL.x + Math.round((BADGE_CELL.w - w) / 2)
  const y = BADGE_CELL.y + Math.round((BADGE_CELL.h - h) / 2)
  drawCalibrationSquare(ctx, x, y, w, h)
  return wrapper
}

/**
 * Classify an (r,g,b) pixel to the nearest quadrant colour, or null if it is
 * closer to "not a calibration colour" than to any quadrant. Uses squared
 * Euclidean distance in RGB with a hard cutoff so hull/background pixels that
 * merely happen to differ between base and cal frames (AA fringes, shadow
 * shifts) are not misattributed to a quadrant.
 *
 * `maxDist2` is the squared-distance cutoff (default tuned for post-tonemap
 * colours — a pixel must be within ~130 units per-channel-ish of a quadrant
 * colour to count).
 */
export function classifyQuadrant(
  r: number, g: number, b: number,
  maxDist2 = 130 * 130,
): Quadrant | null {
  let best: Quadrant | null = null
  let bestD = Infinity
  for (const q of QUADRANT_LIST) {
    const [qr, qg, qb] = QUADRANT_COLORS[q]
    const dr = r - qr, dg = g - qg, db = b - qb
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) { bestD = d; best = q }
  }
  if (bestD > maxDist2) return null
  return best
}
