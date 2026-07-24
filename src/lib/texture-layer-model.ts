/**
 * Texture editor layer model.
 *
 * The skin/texture editor uses a minimal two-layer stack:
 *
 *   BaseDiffuseLayer (kind: 'base-diffuse')
 *     — wraps the vehicle's vanilla diffuse texture (vanillaDiffuseRef).
 *       Rebuilt on every model-load / season-switch.
 *
 *   TexturePaintLayer (kind: 'paint')
 *     — wraps the live paint canvas (baseDiffuseRef). The user paints here.
 *       persistBrushStroke() snapshots this to customDiffuseUrl.
 *
 * The compositor writes into overlayCanvasRef (stable identity — never
 * replaced, only drawn into). The Viewport CanvasTexture picks it up via
 * the overlayDirty / overlayVersion signal path.
 *
 * Incremental-paint optimisation (mandatory — see IMPLEMENTATION_PLAN.md §Phase2):
 *   • onStrokeBegin  → snapshot layers BELOW paint into belowPaintSnapshotRef (one composeLayers call)
 *   • per-dab        → blit belowPaintSnapshotRef + baseDiffuseRef → overlayCanvasRef (two drawImages)
 *   • onStrokeEnd    → run full composeLayers into overlayCanvasRef, then persistBrushStroke()
 *
 * Do NOT touch mod-export.ts, sga-writer.ts, rgt-writer.ts, or faceplate-mod-build.ts.
 */

import type { BaseLayer, GenericLayerProject } from '@/lib/layer-compositor'

/** A layer that wraps the vanilla vehicle diffuse texture. */
export interface BaseDiffuseLayer extends BaseLayer {
  kind: 'base-diffuse'
  // Data source: vanillaDiffuseRef (owned by Editor.tsx).
  // No extra fields — the live canvas reference is passed to textureRenderLayer.
}

/**
 * A layer that wraps the live paint canvas (baseDiffuseRef).
 * The user paints directly onto this canvas; it is NOT a dataUrl layer.
 */
export interface TexturePaintLayer extends BaseLayer {
  kind: 'paint'
  // Data source: baseDiffuseRef (owned by Editor.tsx).
  // No extra fields — the canvas reference is passed to textureRenderLayer.
}

/** Union of all texture layer kinds. */
export type TextureLayer = BaseDiffuseLayer | TexturePaintLayer

/**
 * Minimal project-shape for the texture editor compositor.
 * Extends GenericLayerProject so it works with composeLayers.
 *
 * canvasW / canvasH are always 2048 for the diffuse atlas.
 */
export interface TextureLayerProject extends GenericLayerProject<TextureLayer> {
  canvasW: 2048
  canvasH: 2048
}

/**
 * Factory: build the canonical two-layer stack for the texture editor.
 * Layer order: BaseDiffuse (bottom) → PaintLayer (top).
 */
export function makeTextureLayerProject(): TextureLayerProject {
  const baseDiffuse: BaseDiffuseLayer = {
    id: 'base-diffuse',
    kind: 'base-diffuse',
    visible: true,
    opacity: 1,
  }
  const paint: TexturePaintLayer = {
    id: 'paint',
    kind: 'paint',
    visible: true,
    opacity: 1,
  }
  return {
    layers: [baseDiffuse, paint],
    images: {},
    backgroundColor: null,
    canvasW: 2048,
    canvasH: 2048,
  }
}

/**
 * The renderLayer callback for the texture editor's composeLayers call.
 *
 * Called by composeLayers for each visible TextureLayer.  The host-owned
 * canvases (vanillaDiffuse for BaseDiffuseLayer, baseDiffuse for
 * TexturePaintLayer) are provided via the closure.
 *
 * @param vanillaDiffuse  Pristine vehicle diffuse (read-only snapshot).
 * @param baseDiffuse     Live user-paint canvas.
 */
export function makeTextureRenderLayer(
  vanillaDiffuse: HTMLCanvasElement | null,
  baseDiffuse: HTMLCanvasElement | null,
) {
  return async function textureRenderLayer(
    ctx: CanvasRenderingContext2D,
    layer: TextureLayer,
    _byId: Map<string, HTMLImageElement>,
    _canvasW: number,
    _canvasH: number,
    _prevLayerCanvas: HTMLCanvasElement | null,
  ): Promise<HTMLCanvasElement | null> {
    if (layer.kind === 'base-diffuse') {
      const src = vanillaDiffuse
      if (!src) return null
      ctx.globalAlpha = layer.opacity ?? 1
      ctx.drawImage(src, 0, 0)
      ctx.globalAlpha = 1
      return null
    }
    if (layer.kind === 'paint') {
      const src = baseDiffuse
      if (!src) return null
      ctx.globalAlpha = layer.opacity ?? 1
      ctx.drawImage(src, 0, 0)
      ctx.globalAlpha = 1
      return null
    }
    return null
  }
}
