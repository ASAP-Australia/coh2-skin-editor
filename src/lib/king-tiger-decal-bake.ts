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
 * Generic: composite `decalCanvas` onto a copy of `baseDiffuse` at an
 * arbitrary pixel rect, and return the resulting 2048×2048 canvas.
 *
 * @param baseDiffuse  The 2048×2048 base diffuse. Accepts both
 *                     HTMLImageElement and HTMLCanvasElement.
 * @param decalCanvas  The rasterised decal (any size — scaled to fill rect).
 * @param rect         Pixel rect in the 2048×2048 diffuse where the decal lands.
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

  // 2. Overlay the decal at the specified rect, scaled to fill it.
  //    Use 'source-over' (default) so decal alpha composites naturally.
  //    The source (rasteriseDecal output) is typically 128×128 being enlarged
  //    to a 320–512px atlas rect.  The browser default (bilinear / 'low')
  //    produces a visibly blurry result; 'high' (typically bicubic or better)
  //    and especially `imageSmoothingEnabled = false` (nearest-neighbour) both
  //    preserve sharper edges.  For pixel-art / vector-derived decals — which
  //    are the common case — nearest-neighbour gives the cleanest upscale;
  //    if the source image is already large and antialiased, 'high' is better.
  //    We choose 'high' as the default because it preserves detail without the
  //    harsh aliasing of nearest-neighbour on rotated/antialiased artwork.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const { x, y, w, h } = rect
  ctx.drawImage(decalCanvas as CanvasImageSource, x, y, w, h)

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
