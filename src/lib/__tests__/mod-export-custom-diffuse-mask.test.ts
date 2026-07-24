/**
 * mod-export-custom-diffuse-mask.test.ts
 *
 * Regression for the custom-diffuse export masking gap.
 *
 * `composeVehicleDiffuse` (mod-export.ts) has a fast path for a user-uploaded /
 * pasted / AI-generated full-image diffuse (`customDiffuseUrl`). It draws that
 * image WHOLE onto the 2048² export canvas — which would also texture the
 * tracks / wheels / running gear / wreck / stowed equipment, something the user
 * reported looks wrong. The live editor preview (applyCamoImage in Editor.tsx)
 * masks the uploaded image at render time and never bakes the mask into the
 * stored URL, so the fast path must re-apply it: decode the vanilla diffuse and
 * restore it over the excluded UV regions on top of the custom image
 * (via `restoreExcludedRegions`).
 *
 * This test pins that guarantee at the level of the load-bearing helper the
 * fast path now calls: after drawing a full-image custom diffuse and then
 * restoring excluded regions with a vanilla + exclusion mask, the excluded
 * (track) region is byte-identical to vanilla while the armor region keeps the
 * custom image untouched.
 */
import { describe, it, expect } from 'vitest'
import { restoreExcludedRegions } from '../mod-export'

/** A solid-colour NxN canvas. */
function solid(size: number, r: number, g: number, b: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, size, size)
  return c
}

/**
 * An exclusion mask (opaque white where camo/custom must be erased, transparent
 * elsewhere) with a single opaque rectangle covering the "track" region.
 */
function maskWithRect(
  size: number,
  x: number, y: number, w: number, h: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x, y, w, h)
  return c
}

function pixel(c: HTMLCanvasElement, px: number, py: number): [number, number, number, number] {
  const d = c.getContext('2d')!.getImageData(px, py, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

describe('custom-diffuse export: excluded region restored to vanilla', () => {
  const SIZE = 128 // small stand-in for the 2048² atlas — geometry is identical
  // Track region = a rect in the lower-left; everything else is armor.
  const TRACK = { x: 8, y: 96, w: 32, h: 24 }
  // A point squarely inside the track region, and one squarely in the armor.
  const TRACK_PT: [number, number] = [TRACK.x + 4, TRACK.y + 4]
  const ARMOR_PT: [number, number] = [64, 32]

  it('leaves the track region byte-identical to vanilla and keeps the custom image on armor', () => {
    // Vanilla diffuse (what the tracks must look like) and the user's custom
    // full-image diffuse (a different solid colour so we can tell them apart).
    const vanilla = solid(SIZE, 30, 40, 50)
    const custom = solid(SIZE, 200, 10, 120)
    const mask = maskWithRect(SIZE, TRACK.x, TRACK.y, TRACK.w, TRACK.h)

    // Reproduce the fast path: draw the custom image whole, then restore
    // excluded regions from vanilla.
    const out = document.createElement('canvas')
    out.width = out.height = SIZE
    const ctx = out.getContext('2d')!
    ctx.drawImage(custom, 0, 0, SIZE, SIZE)
    restoreExcludedRegions(ctx, vanilla, mask, SIZE)

    // Track region → byte-identical to vanilla (custom image erased there).
    expect(pixel(out, ...TRACK_PT)).toEqual(pixel(vanilla, ...TRACK_PT))
    // Armor region → still the custom image (untouched by the restore).
    expect(pixel(out, ...ARMOR_PT)).toEqual(pixel(custom, ...ARMOR_PT))
  })

  it('is a no-op when the mask is null (vehicle has no excluded submeshes)', () => {
    const vanilla = solid(SIZE, 30, 40, 50)
    const custom = solid(SIZE, 200, 10, 120)

    const out = document.createElement('canvas')
    out.width = out.height = SIZE
    const ctx = out.getContext('2d')!
    ctx.drawImage(custom, 0, 0, SIZE, SIZE)
    restoreExcludedRegions(ctx, vanilla, null, SIZE)

    // Nothing restored → the whole canvas is still the custom image.
    expect(pixel(out, ...TRACK_PT)).toEqual(pixel(custom, ...TRACK_PT))
    expect(pixel(out, ...ARMOR_PT)).toEqual(pixel(custom, ...ARMOR_PT))
  })
})
