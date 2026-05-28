/**
 * king-tiger-decal-bake.ts
 *
 * Pure-function canvas compositor: takes the vanilla King Tiger diffuse
 * texture and a rasterised decal canvas, and returns a 2048×2048 baked
 * canvas with the decal drawn into the canonical decal anchor zone
 * (hullSideRight in the UV regions map).
 *
 * The pixel rect for hullSideRight is {x:896, y:1152, w:512, h:512} in
 * the 2048×2048 texture space, confirmed by the king_tiger_sdkfz_182.json
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

/**
 * Composite `decalCanvas` onto a copy of `vanillaDiffuse` at the
 * hullSideRight pixel rect, and return the resulting 2048×2048 canvas.
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
  const out = document.createElement('canvas')
  out.width = 2048
  out.height = 2048
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D context for king tiger bake canvas')

  // 1. Draw the vanilla diffuse as the base layer
  ctx.drawImage(vanillaDiffuse, 0, 0, 2048, 2048)

  // 2. Overlay the decal into hullSideRight, scaled to fill the rect.
  //    Use 'source-over' (default) so decal alpha composites naturally.
  const { x, y, w, h } = HULL_SIDE_RIGHT_RECT
  ctx.drawImage(decalCanvas, x, y, w, h)

  return out
}
