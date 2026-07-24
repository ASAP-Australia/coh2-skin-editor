/**
 * Atlas-parts bake helpers for v1.3.0 per-faction × per-part decal system.
 *
 * `compositePartLayers` — renders a list of Decal layers into a part-sized RGBA buffer.
 * `partsForBake`        — returns per-part, per-faction RGBAs ready for BuildDecalModInput.partRgbas.
 */

import { type Coh2DecalPackProject, ATLAS_PART_DEFS } from '@/lib/decal-pack-project'
import { type DecalFaction, FACTION_ORDER } from '@/lib/decal-mod-templates'
import { rasteriseDecal, decodeSourceImage } from '@/lib/decal-pack-export'
import { DECAL_PACK_SIZE } from '@/lib/decal-pack-project'

// ── compositePartLayers ──────────────────────────────────────────────────────

/**
 * Composite a list of Decal layers into a `partW × partH` RGBA buffer.
 *
 * Each layer is rasterised at 128×128 (DECAL_PACK_SIZE) — the same size
 * used by the existing editor canvas. The 128×128 output is then blitted
 * onto the part canvas at the layer's (x, y) centre position, which is in
 * part-local pixel space. This preserves the existing rasteriseDecal contract
 * without modification.
 *
 * Returns a blank buffer if `layers` is empty or no canvas API is available.
 */
export async function compositePartLayers(
  layers: import('@/lib/decal-pack-project').Decal[],
  partW: number,
  partH: number,
  sourceImages: Coh2DecalPackProject['sourceImages'],
): Promise<Uint8ClampedArray> {
  if (typeof document === 'undefined') {
    return new Uint8ClampedArray(partW * partH * 4)
  }
  const canvas = document.createElement('canvas')
  canvas.width = partW
  canvas.height = partH
  const ctx = canvas.getContext('2d')
  if (!ctx) return new Uint8ClampedArray(partW * partH * 4)

  const bitmapCache = new Map<string, ImageBitmap | HTMLImageElement>()

  for (const layer of layers) {
    if (!layer.visible) continue
    const src = sourceImages[layer.sourceImageId]
    if (!src) continue

    // Decode the source image via the shared, SVG-safe, fully-decoded helper.
    // (Insignia sources are SVG data URLs; createImageBitmap on a dimensionless
    // SVG throws "InvalidStateError: The source image could not be decoded" —
    // decodeSourceImage routes SVG through an <img>+decode() path instead.)
    let bitmap: ImageBitmap | HTMLImageElement
    const cached = bitmapCache.get(src.id)
    if (cached) {
      bitmap = cached
    } else {
      bitmap = await decodeSourceImage(src.dataUrl)
    }
    bitmapCache.set(src.id, bitmap)

    // Rasterise at 128×128 (the existing contract).
    const layerCanvas = rasteriseDecal(layer, bitmap)

    // Blit into part canvas at the layer's part-local centre.
    // layer.x / layer.y are in DECAL_PACK_SIZE space (128 units).
    // We map them 1:1 to the part canvas pixels — the editor stores
    // coordinates in the same pixel space as the part region dimensions.
    ctx.drawImage(
      layerCanvas as CanvasImageSource,
      layer.x - DECAL_PACK_SIZE / 2,
      layer.y - DECAL_PACK_SIZE / 2,
      DECAL_PACK_SIZE,
      DECAL_PACK_SIZE,
    )
  }

  return ctx.getImageData(0, 0, partW, partH).data
}

// ── partsForBake ─────────────────────────────────────────────────────────────

/**
 * Produce the `partRgbas` structure expected by `BuildDecalModInput`.
 *
 * For each part index (0..5):
 *   - Render `part.shared` into a `partW × partH` RGBA (stored as `shared`).
 *   - For each faction that has an override, render `part.overrides[faction]`
 *     into an equal-sized RGBA (stored as `faction`).
 *
 * If the project is pre-v6 (no `parts` field), falls back to legacy behaviour:
 * returns `undefined` so callers use the old `decalRgba` path.
 */
export async function partsForBake(
  project: Coh2DecalPackProject,
): Promise<Array<Partial<Record<DecalFaction | 'shared', Uint8ClampedArray>>> | undefined> {
  if (!project.parts) return undefined   // legacy project — caller uses decalRgba

  const result: Array<Partial<Record<DecalFaction | 'shared', Uint8ClampedArray>>> = []

  for (let pi = 0; pi < project.parts.length; pi++) {
    const part = project.parts[pi]
    const def = ATLAS_PART_DEFS[pi]
    if (!def) { result.push({}); continue }
    const { w, h } = def.region

    const entry: Partial<Record<DecalFaction | 'shared', Uint8ClampedArray>> = {}

    // Shared layers.
    entry.shared = await compositePartLayers(part.shared, w, h, project.sourceImages)

    // Per-faction overrides.
    if (part.overrides) {
      for (const faction of FACTION_ORDER) {
        const overrideLayers = part.overrides[faction]
        if (overrideLayers && overrideLayers.length > 0) {
          entry[faction] = await compositePartLayers(overrideLayers, w, h, project.sourceImages)
        }
      }
    }

    result.push(entry)
  }

  return result
}
