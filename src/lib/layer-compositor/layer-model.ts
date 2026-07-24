/**
 * Generic layer-compositor model types.
 *
 * Re-exports the generic primitives that are already defined in
 * faceplate-project.ts so the compositor and generic panels can consume
 * them without directly importing from a faceplate-specific module.
 *
 * faceplate-project.ts keeps its own copies until a future phase explicitly
 * swaps them over.  This file does NOT duplicate logic — it is a re-export
 * bridge only.
 */

// Re-export the generic blend-mode primitives.
export type { BlendMode } from '@/lib/faceplate-project'
export { BLEND_MODES } from '@/lib/faceplate-project'
// Re-export the shared layer-effect types.
export type { LayerShadow } from '@/lib/faceplate-project'
export type { LayerMask } from '@/lib/faceplate-project'
export type { ImageLayerFilters } from '@/lib/faceplate-project'

/**
 * The minimal layer contract the generic compositor and panels need.
 *
 * Mirrors the fields from `BaseLayer` in faceplate-project.ts that
 * composeLayers, LayersPanel, and PropertiesPanel actually touch.
 * Faceplate/decal/texture meta fields (`guid`, `magic`, `parts`, etc.)
 * remain in their respective project types.
 */
export interface BaseLayer {
  id: string
  visible: boolean
  opacity: number
  blendMode?: import('@/lib/faceplate-project').BlendMode
  shadow?: import('@/lib/faceplate-project').LayerShadow
  mask?: import('@/lib/faceplate-project').LayerMask
  clippedToLayerBelow?: boolean
  name?: string
}

/**
 * Minimal project shape the compositor and generic panels need.
 *
 * Carries only what `composeLayers`, `LayersPanel`, and `PropertiesPanel`
 * require.  All faceplate/decal/texture meta fields (`guid`, `magic`,
 * `parts`, `vehicles`, etc.) remain in their respective project types.
 */
export interface GenericLayerProject<L extends { id: string; visible: boolean }> {
  layers: L[]
  images: Record<string, { id: string; dataUrl: string; name: string }>
  backgroundColor?: string | null
}
