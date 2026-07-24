/**
 * Public surface of the shared layer-compositor core.
 *
 * Re-exports the generic model types and the composeLayers function.
 * Each editor (faceplate, decal, texture) imports from this barrel and
 * supplies its own renderLayer callback.
 */

export type { BaseLayer, GenericLayerProject } from './layer-model'
export { BLEND_MODES } from './layer-model'
export type { BlendMode, LayerShadow, LayerMask, ImageLayerFilters } from './layer-model'
export { composeLayers } from './compose-canvas'
