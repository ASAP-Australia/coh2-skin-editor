/**
 * king-tiger-decal-bake.ts
 *
 * Pure-function canvas compositor: takes a vanilla vehicle diffuse texture
 * and a rasterised decal canvas, and returns a 2048×2048 baked canvas with
 * the decal drawn into the specified UV pixel rect.
 *
 * Generic entry point: `bakeDecalOntoDiffuse(vanillaDiffuse, decalCanvas, rect)`
 * King-Tiger-specific entry point (preserved for external callers):
 *   `bakeDecalOntoKingTigerDiffuse(vanillaDiffuse, decalCanvas)`
 *   — delegates to the generic form with the canonical hullSideRight rect.
 *
 * The pixel rect for the King Tiger hullSideRight is {x:896, y:1152, w:512, h:512}
 * in the 2048×2048 texture space, confirmed by the king_tiger_sdkfz_182.json
 * UV region map and cross-referenced against the SS Totenkopf skin's
 * known decal placements.
 *
 * No Three.js dependency — this is plain-canvas work that can be tested
 * in jsdom without a GL context.
 */

import kingTigerUvRegions from '@/lib/vehicle-uv-regions/king_tiger_sdkfz_182.json'

/** The pixel rect in the 2048×2048 diffuse texture where the decal lands. */
export const HULL_SIDE_RIGHT_RECT = kingTigerUvRegions.semanticRegions.hullSideRight as {
  x: number
  y: number
  w: number
  h: number
}

/** Pixel rectangle in 2048×2048 texture space. */
export interface DecalBakeRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Fraction of the rect width that the badge occupies.
 *
 * Derived from the King Tiger ground truth: the Balkenkreuz cross is ~110 px
 * inside a 360 px rect (SS Totenkopf skin, see uv-mapping-diag.md Finding 5).
 * 110 / 360 ≈ 0.306 → rounded to 0.31 for a slightly generous but still
 * badge-sized result.  This constant applies universally to every authored
 * rect and to the DEFAULT_BADGE_RECT, so all vehicles get correctly-sized
 * badges regardless of rect dimensions.
 *
 * Effect on key vehicles:
 *   King Tiger  360×340 rect → ~112×107 px badge  (ground truth 110×110 ✓)
 *   Tiger       320×320 rect → ~99×99 px badge
 *   Sherman E8  320×320 rect → ~99×99 px badge
 *   Default     320×312 rect → ~99×97 px badge
 */
export const BADGE_FRACTION = 0.31

/** Minimum and maximum badge dimension in pixels (sanity clamp). */
const BADGE_MIN_PX = 32
const BADGE_MAX_PX = 256

/**
 * Generic: composite `decalCanvas` onto a copy of `baseDiffuse` at an
 * arbitrary pixel rect, and return the resulting 2048×2048 canvas.
 *
 * The decal is drawn as a correctly-sized BADGE (≈BADGE_FRACTION of rect width)
 * centred on the rect's centre point, preserving the decal's aspect ratio.
 * This prevents the old behaviour of stretching the decal to fill the entire
 * rect (which produced a ~3× over-sized "flat sticker" appearance).
 *
 * @param baseDiffuse  The 2048×2048 base diffuse. Accepts both
 *                     HTMLImageElement and HTMLCanvasElement.
 * @param decalCanvas  The rasterised decal (any size — scaled to badge size).
 * @param rect         Pixel rect in the 2048×2048 diffuse that CENTRES the badge.
 *                     The badge is drawn at BADGE_FRACTION of rect.w, centred.
 * @returns            A new 2048×2048 canvas with the decal composited in.
 */
export function bakeDecalOntoDiffuse(
  baseDiffuse: HTMLImageElement | HTMLCanvasElement,
  decalCanvas: HTMLCanvasElement | OffscreenCanvas,
  rect: DecalBakeRect,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = 2048
  out.height = 2048
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D context for decal bake canvas')

  // 1. Draw the base diffuse as the base layer
  ctx.drawImage(baseDiffuse, 0, 0, 2048, 2048)

  // 2. Compute badge dimensions: BADGE_FRACTION of the rect's width,
  //    with height scaled to preserve the decal's aspect ratio.
  //    Both dimensions are clamped to sane bounds and must stay within the atlas.
  const decalW = (decalCanvas as HTMLCanvasElement).width  || 128
  const decalH = (decalCanvas as HTMLCanvasElement).height || 128
  const aspect = decalW / decalH

  let badgeW = Math.round(rect.w * BADGE_FRACTION)
  let badgeH = Math.round(badgeW / aspect)

  // Clamp to sane pixel bounds
  badgeW = Math.max(BADGE_MIN_PX, Math.min(BADGE_MAX_PX, badgeW))
  badgeH = Math.max(BADGE_MIN_PX, Math.min(BADGE_MAX_PX, Math.round(badgeW / aspect)))

  // Centre the badge on the rect's centre point
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const bakeX = Math.round(cx - badgeW / 2)
  const bakeY = Math.round(cy - badgeH / 2)

  // Clamp to atlas bounds (ensure badge stays within 2048×2048)
  const clampedX = Math.max(0, Math.min(2048 - badgeW, bakeX))
  const clampedY = Math.max(0, Math.min(2048 - badgeH, bakeY))

  // 3. Overlay the badge-sized decal, centred on the rect.
  //    Use 'source-over' (default) so decal alpha composites naturally.
  //    'high' quality (typically bicubic) preserves detail without harsh
  //    nearest-neighbour aliasing on antialiased artwork.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(decalCanvas as CanvasImageSource, clampedX, clampedY, badgeW, badgeH)

  return out
}

/**
 * Composite `decalCanvas` onto a copy of `vanillaDiffuse` at the
 * King Tiger's hullSideRight pixel rect, and return the resulting 2048×2048 canvas.
 *
 * Preserved for existing callers (vehicle-3d-renderer.ts, tests). Delegates
 * to the generic `bakeDecalOntoDiffuse` with the canonical King Tiger rect.
 *
 * @param vanillaDiffuse  The 2048×2048 vanilla diffuse image. Accepts
 *                        both HTMLImageElement and HTMLCanvasElement so
 *                        callers can pass either a decoded <img> or an
 *                        already-composited canvas.
 * @param decalCanvas     The rasterised decal (128×128 from rasteriseDecal
 *                        or any size — it will be scaled to fill the rect).
 * @returns               A new 2048×2048 canvas with the decal applied.
 */
export async function bakeDecalOntoKingTigerDiffuse(
  vanillaDiffuse: HTMLImageElement | HTMLCanvasElement,
  decalCanvas: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  return bakeDecalOntoDiffuse(vanillaDiffuse, decalCanvas, HULL_SIDE_RIGHT_RECT)
}
