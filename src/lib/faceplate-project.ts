/**
 * `.coh2faceplate` project format.
 *
 * Stores everything needed to recreate a custom player faceplate the user is
 * composing in the FaceplateEditor: pack metadata + an ordered stack of image
 * layers, each with its own transform (x, y, rotation, scale, opacity) and a
 * reference into a shared image library (so two layers can reuse one source).
 *
 * Persistence:
 *   - Browser localStorage holds the active faceplate project so an accidental
 *     refresh never loses work. Keyed by project id under
 *     `coh2.faceplate.<id>`, with `coh2-faceplate-active-project` pointing at
 *     the active id. Mirrors the skin-pack project's storage layout so the
 *     same recent-projects UI can index both kinds.
 *   - The user explicitly saves to disk via download (`Save .coh2faceplate`).
 *
 * Magic header (`coh2-faceplate-project`) lets `readProjectFile` sniff
 * skin-pack vs faceplate vs garbage on load.
 *
 * The canvas the user paints onto is fixed at FACEPLATE_CANVAS px square.
 * Layer positions are stored in canvas-pixel coordinates (top-left origin,
 * matching native 2D canvas). At export time we render at this exact
 * resolution then resize to whatever the install pipeline asks for.
 */

/** Canonical banner canvas dimensions. The in-game engine samples a 624×204
 *  sub-rect from the packed faceplate atlas (verified across three published
 *  reference mods — see faceplate-templates.ts). We paint at this exact
 *  resolution so the editor matches the target aspect and the export fills
 *  the engine's display rect with no letterboxing.
 *
 *  Previous releases used 600×170 — that left 24 columns + 34 rows of
 *  unpainted atlas pixels INSIDE the engine's sample region, presenting as
 *  visible black borders in-game. Migration to v2 below scales any v1 layer
 *  coordinates by (624/600, 204/170) so existing projects survive the
 *  resize. */
export const FACEPLATE_BANNER_W = 624
export const FACEPLATE_BANNER_H = 204

export interface FaceplateImage {
  /** Stable id used by layers to reference this asset. */
  id: string
  /** User-friendly label (filename when added, editable in UI). */
  name: string
  /** Base64 data: URL of the source image bytes. PNG/JPG/SVG/WEBP all work. */
  dataUrl: string
  /** Natural pixel dimensions of the source. Used to compute default scale
   *  on first placement so a small icon doesn't fill the whole canvas. */
  width: number
  height: number
}

/**
 * Photoshop-style blend modes for layer compositing. Values map 1:1 to
 * `CanvasRenderingContext2D.globalCompositeOperation` so the composer can
 * directly assign `ctx.globalCompositeOperation = layer.blendMode ?? 'normal'`
 * without any translation step.
 *
 * Identity = 'normal' — the canvas default. Omitting the field or setting it
 * to 'normal' produces identical rendering to pre-v6 projects.
 */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

/** All supported blend modes as a readonly array — used to populate the UI
 *  blend-mode dropdown in the tool peels (Wave 2). */
export const BLEND_MODES: readonly BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const

/**
 * Paintable alpha mask applied on top of a rendered layer. White pixels =
 * fully visible, black pixels = fully hidden. The composer scales the mask
 * to fit the layer's bounding box at the layer's rendered size.
 *
 * Supported on ImageLayer and PaintLayer in v6. TextLayer and ShapeLayer
 * support is deferred to Wave 3 (TODO).
 */
export interface LayerMask {
  /** Base64 PNG data URL of a greyscale (or alpha-channel) mask. White =
   *  fully visible, black = fully hidden. Same dimensions as the layer's
   *  rendered bounding box at scale=1 — the composer scales it to match. */
  dataUrl: string
  /** When true, mask is treated as inverted (black = visible). */
  invert?: boolean
  /** When false, mask is hidden temporarily so the user can preview without
   *  it. Defaults to enabled (true) when absent. */
  enabled?: boolean
}

/**
 * Gradient fill for ShapeLayer — overrides `fillColor` when present. Two
 * kinds are supported: linear (directional) and radial (centre-out). Stops
 * define the colour sequence along the gradient axis.
 */
export interface GradientFill {
  /** 'linear' = directional, 'radial' = centre-out. */
  kind: 'linear' | 'radial'
  /** Angle in degrees (linear only). 0 = left-to-right, 90 = top-to-bottom.
   *  Ignored for radial gradients. */
  angle?: number
  /** Two or more colour stops. `position` is 0..1 along the gradient axis. */
  stops: Array<{ color: string; position: number }>
}

/**
 * Drop-shadow descriptor shared by every layer kind. Maps 1:1 to Canvas2D
 * `ctx.shadowOffsetX/Y/Blur/Color`, so the composer pipeline can apply it
 * uniformly to images, text, and shapes. Omitted = no shadow. Setting `blur`
 * + zero offsets produces an outer glow; setting `offsetX/Y` non-zero gives
 * a classic drop-shadow.
 */
export interface LayerShadow {
  /** Horizontal shadow offset in canvas pixels (positive = right). */
  offsetX: number
  /** Vertical shadow offset in canvas pixels (positive = down). */
  offsetY: number
  /** Gaussian blur radius in canvas pixels. 0 = sharp shadow. */
  blur: number
  /** Shadow colour (CSS hex or rgba). Alpha is honoured. */
  color: string
}

/** Identity values for the shadow primitive. A layer with `shadow: { ...this }`
 *  reads as "no shadow" — the composer skips the call when all four are at
 *  identity. Used to seed sliders in the Shadow tool peel. */
export const LAYER_SHADOW_DEFAULTS: LayerShadow = {
  offsetX: 0,
  offsetY: 0,
  blur: 0,
  color: 'rgba(0,0,0,0.5)',
}

/** Per-layer lock flags controlling position and aspect-ratio constraints. */
export interface LayerLockFlags {
  /** When true, drag-move events are ignored — the layer cannot be repositioned. */
  position?: boolean
  /** When true, resize handles maintain the layer's width/height ratio. */
  aspect?: boolean
}

interface BaseLayer {
  /** Stable id used by selection / z-order / delete operations. */
  id: string
  /** Center position in canvas pixels (origin top-left). Storing the center
   *  rather than the top-left simplifies rotate-about-center math. */
  x: number
  y: number
  /** Rotation in degrees, clockwise. */
  rotation: number
  /** Horizontal scale multiplier. 1 = source pixels render 1:1 on the X
   *  axis. For text layers this acts as a uniform font-size multiplier
   *  (text resize is always uniform — `scaleY` is ignored on TextLayer). */
  scale: number
  /** Layer opacity 0..1. */
  opacity: number
  /** When true, locked from selection in the editor (legacy boolean form).
   *  As of v5 this field is superseded by the `lockFlags` object — callers
   *  should prefer `lockFlags.position` for position locking. The legacy
   *  boolean is retained for backwards compatibility and treated as
   *  `lockFlags.position === true` during render. */
  locked: boolean
  /** Optional fine-grained lock controls. Position and aspect locks can be
   *  toggled independently from the layer strip. Omitted = unlocked. */
  lockFlags?: LayerLockFlags
  /** When false, hidden from the canvas. */
  visible: boolean
  /** Optional drop-shadow effect (works for image, text, and shape layers).
   *  Omitted = no shadow. New layers leave this undefined until the user
   *  touches a Shadow tool slider. */
  shadow?: LayerShadow
  /** Photoshop-style blend mode for this layer. Identity = 'normal' (the
   *  Canvas2D default). When absent the composer uses 'normal'. Maps
   *  directly to `ctx.globalCompositeOperation`. v6 addition. */
  blendMode?: BlendMode
  /** Optional paintable alpha mask. White = visible, black = hidden.
   *  The composer scales the mask dataUrl to match the layer's rendered
   *  bounding box. `enabled !== false` to activate. v6 addition.
   *
   *  Supported on ImageLayer and PaintLayer in this wave. TextLayer and
   *  ShapeLayer mask support is deferred to Wave 3 (TODO). */
  mask?: LayerMask
  /** When true, this layer is clipped to the alpha of the layer immediately
   *  below it in render order — a Photoshop "clipping mask" style effect.
   *  Identity = false (absent). v6 addition.
   *
   *  Supported on ImageLayer and PaintLayer in this wave. TextLayer and
   *  ShapeLayer clipping support is deferred to Wave 3 (TODO). */
  clippedToLayerBelow?: boolean
}

/**
 * Photoshop-style adjustment stack applied to a single image layer. All
 * fields map 1:1 to CSS / Canvas2D `filter` operators so we can run the
 * same composition on the DOM (live preview) and on a canvas (export PNG)
 * without rewriting the math.
 *
 * All fields are optional and identity-valued defaults are documented so
 * a layer with `filters: {}` reads identically to a layer with no filters
 * at all. This keeps the file format backwards-compatible — a v3 project
 * loads into older editors as if the field weren't there.
 */
export interface ImageLayerFilters {
  /** brightness() — 0 = black, 1 = identity, 2 = double. */
  brightness?: number
  /** contrast() — 1 = identity. Below 1 flattens, above 1 punches. */
  contrast?: number
  /** saturate() — 1 = identity, 0 = greyscale. */
  saturate?: number
  /** hue-rotate() degrees — 0 = identity. Wraps every 360°. */
  hueRotate?: number
  /** blur() pixels — 0 = sharp. */
  blur?: number
  /** sepia() — 0 = none, 1 = full sepia. */
  sepia?: number
  /** grayscale() — 0 = none, 1 = full B&W. */
  grayscale?: number
  /** invert() — 0 = none, 1 = full inversion. */
  invert?: number
  /** Grain / film-noise intensity. 0 = none (identity), 1 = maximum grain.
   *  Values are applied post-filter as a per-pixel ImageData pass by the
   *  composer — NOT as a CSS `filter()` operator (noise has no CSS equivalent),
   *  so `imageFilterCss()` intentionally omits this field. v6 addition. */
  noise?: number
}

/** Edge-stroke descriptor for ImageLayer and ShapeLayer. Width is in
 *  canvas-space pixels; colour is a CSS hex/rgba string. `width === 0` or
 *  the entire object missing = no stroke. */
export interface LayerStroke {
  color: string
  width: number
}

/** Identity values for the stroke primitive — width 0 means "no stroke",
 *  matching the composer's skip condition. Used to seed the Stroke tool
 *  peel sliders. */
export const LAYER_STROKE_DEFAULTS: LayerStroke = {
  color: '#000000',
  width: 0,
}

export interface ImageLayer extends BaseLayer {
  kind: 'image'
  /** Image asset reference into project.images. */
  imageId: string
  /** Vertical scale multiplier. Independent from `scale` so the user can
   *  freely stretch an image's height without changing its width. Optional
   *  for backwards compatibility — pre-v3 projects only stored uniform
   *  `scale`, so `scaleY ?? scale` is the canonical read pattern. New
   *  layers created after this field landed set it explicitly equal to
   *  `scale` so both fields are always populated going forward. */
  scaleY?: number
  /** When true, the layer is drawn horizontally flipped (negative scaleX). */
  flipH: boolean
  /** When true, drawn vertically flipped. */
  flipV: boolean
  /** Optional photo-editing filter stack. Omitted = no filters applied,
   *  same render path as a flat image. New layers created after this
   *  field landed leave it undefined until the user touches a slider; the
   *  defaults below in IMAGE_LAYER_FILTER_DEFAULTS are the identity. */
  filters?: ImageLayerFilters
  /** Optional edge stroke. The composer renders the image normally then
   *  draws a per-pixel stroke around the alpha edge. Width 0 / undefined =
   *  no stroke. */
  stroke?: LayerStroke
}

/** Geometric primitive kinds supported by ShapeLayer. Each renders via a
 *  closed Canvas2D path with both fill and (optional) stroke. */
export type ShapeKind = 'rectangle' | 'circle' | 'chevron' | 'star' | 'shield'

/** A vector shape layer — useful for decorative bars, faction-style chevrons,
 *  shields, and stars. Rendered procedurally so resolution-independent. */
export interface ShapeLayer extends BaseLayer {
  kind: 'shape'
  /** Which geometric primitive to draw. */
  shapeType: ShapeKind
  /** Box width in canvas pixels (before `scale` applies). The shape is
   *  drawn centred on (x, y). */
  width: number
  /** Box height in canvas pixels (before `scale` applies). */
  height: number
  /** Fill colour (CSS hex or rgba). Ignored when `gradientFill` is present. */
  fillColor: string
  /** Optional edge stroke. */
  stroke?: LayerStroke
  /** Optional gradient fill — overrides `fillColor` when present. v6 addition.
   *  The composer builds a Canvas2D gradient from `stops` and assigns it as
   *  `ctx.fillStyle` before filling the shape path. */
  gradientFill?: GradientFill
}

/** Identity values for every filter slot. Used to seed sliders and to
 *  decide whether a filter slot is "in use" (any field !== identity).
 *  `noise` is 0 (no grain) — the identity for the post-filter noise pass. */
export const IMAGE_LAYER_FILTER_DEFAULTS: Required<ImageLayerFilters> = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  hueRotate: 0,
  blur: 0,
  sepia: 0,
  grayscale: 0,
  invert: 0,
  noise: 0,
}

/**
 * Fold an ImageLayerFilters object into a CSS `filter` property value
 * suitable for both CSS (`<img style={{filter}}>`) and Canvas2D
 * (`ctx.filter = ...`). Returns 'none' when no filter is active so we
 * don't pay the GPU cost of an identity filter graph.
 */
export function imageFilterCss(f: ImageLayerFilters | undefined): string {
  if (!f) return 'none'
  const parts: string[] = []
  const b = f.brightness
  if (b != null && b !== 1) parts.push(`brightness(${b})`)
  const c = f.contrast
  if (c != null && c !== 1) parts.push(`contrast(${c})`)
  const s = f.saturate
  if (s != null && s !== 1) parts.push(`saturate(${s})`)
  const h = f.hueRotate
  if (h != null && h !== 0) parts.push(`hue-rotate(${h}deg)`)
  const bl = f.blur
  if (bl != null && bl !== 0) parts.push(`blur(${bl}px)`)
  const se = f.sepia
  if (se != null && se !== 0) parts.push(`sepia(${se})`)
  const g = f.grayscale
  if (g != null && g !== 0) parts.push(`grayscale(${g})`)
  const i = f.invert
  if (i != null && i !== 0) parts.push(`invert(${i})`)
  return parts.length ? parts.join(' ') : 'none'
}

export interface TextLayer extends BaseLayer {
  kind: 'text'
  /** The text content. Use \n for line breaks. */
  text: string
  /** CSS font-family stack. */
  fontFamily: string
  /** Font size in canvas-space pixels. */
  fontSize: number
  /** CSS font-weight: 400 / 600 / 700 / 900. */
  fontWeight: number
  /** CSS font-style. */
  fontStyle: 'normal' | 'italic'
  /** Fill colour as CSS hex string (e.g. '#ffffff'). */
  color: string
  /** Text alignment. */
  align: 'left' | 'center' | 'right'
  /** Stroke colour as CSS hex. Empty string = no stroke. */
  strokeColor: string
  /** Stroke width in canvas-space pixels. 0 = no stroke. */
  strokeWidth: number
  /** Letter spacing in canvas-space pixels. 0 = normal. Optional for back-compat. */
  letterSpacing?: number
  /** Line height multiplier (e.g. 1.2 = 120%). Optional for back-compat. */
  lineHeight?: number
  /** Optional silhouette stroke drawn around the text's alpha footprint.
   *  This is semantically DIFFERENT from `strokeColor`/`strokeWidth` above:
   *  those apply a per-character text stroke (drawn at glyph outlines),
   *  whereas this `stroke` applies a blur-expanded silhouette border around
   *  the entire rendered text block.
   *
   *  Implementation note (Wave 1 simple version): the composer draws
   *  `ctx.strokeText` with a wider `lineWidth` than the per-character stroke.
   *  A true offscreen-canvas silhouette stroke is deferred to Wave 2 (TODO). */
  stroke?: LayerStroke
}

/**
 * Raster paint layer — a 624×204 transparent bitmap the user draws onto with
 * the Draw tool. Stored as a base64 PNG data URL so it round-trips through
 * JSON / localStorage without loss.
 */
export interface PaintLayer extends BaseLayer {
  kind: 'paint'
  /** Base64 PNG data URL of the rasterized paint strokes. */
  dataUrl: string
  /** Layer width — always FACEPLATE_BANNER_W (624). */
  width: 624
  /** Layer height — always FACEPLATE_BANNER_H (204). */
  height: 204
  /** Optional silhouette stroke drawn around the paint layer's alpha
   *  footprint. The composer renders the paint bitmap to an offscreen canvas,
   *  extracts the silhouette via `filter: blur(N) + globalCompositeOperation:
   *  'source-out'`, and composites the tinted result behind the paint fill.
   *  v6 addition. */
  stroke?: LayerStroke
}

/**
 * Group layer — contains zero or more child layer ids, composited in order
 * under the group's own opacity. Adding a group allows bulk-move, lock, and
 * show/hide on a set of layers without converting them to a flat raster.
 *
 * Composition: each child layer is rendered in sequence (bottom-to-top)
 * into an offscreen canvas at the group's opacity, then the result is
 * blended into the scene. The group's x/y/rotation/scale are identity
 * (groups don't have their own transform — they inherit from children).
 *
 * Schema v5 addition.
 */
export interface GroupLayer {
  kind: 'group'
  id: string
  name: string
  visible: boolean
  opacity: number
  /** Optional fine-grained lock flags (mirrors BaseLayer.lockFlags). */
  lockFlags?: LayerLockFlags
  /** Ordered list of child layer ids (bottom-to-top render order). */
  childIds: string[]
  /** When true, the layer strip shows this group collapsed. */
  collapsed?: boolean
}

export type FaceplateLayer = ImageLayer | TextLayer | ShapeLayer | PaintLayer | GroupLayer

export interface Coh2FaceplateProject {
  /** Magic for file sniffing on load. */
  magic: 'coh2-faceplate-project'
  /** Steam Workshop item ID, set after a successful publish via
   *  PublishToWorkshopDialog. Absent / undefined = not yet published.
   *  ≤5×10⁹ = real Workshop ID; ≥1×10¹⁵ = fake locally-generated ID. */
  workshopId?: string
  /** Stable 32-hex-char mod-identity GUID. Generated ONCE when the project is
   *  created and reused on every export/publish so the built SGA keeps the
   *  SAME internal mod identity (attrib pbgid, `.gfx` + `.dds` asset paths)
   *  across rebuilds.
   *
   *  WHY THIS MATTERS: CoH2 registers a faceplate in its in-game customisation
   *  pool by the attribute pbgid, which `faceplate-mod-build` derives
   *  deterministically from this GUID. A previous bug generated a FRESH random
   *  GUID on every build, so each republish produced a different pbgid — the
   *  engine treated it as a brand-new attribute, orphaning the prior
   *  registration, and the faceplate silently failed to appear in-game.
   *  Pinning the GUID to the project makes every rebuild a true in-place
   *  update of one stable faceplate.
   *
   *  Optional only for backwards-compat with pre-GUID projects —
   *  `migrateFaceplateProject` backfills one on load. */
  guid?: string
  /** Schema version.
   *  - v1: original 600×170 canvas.
   *  - v2: canvas resized to 624×204; layer x/y migrated by (1.04, 1.20).
   *  - v3: introduced ShapeLayer + per-layer drop-shadow + per-image edge
   *        stroke. Old projects load forward without any geometric change
   *        — the new fields are all optional with identity defaults.
   *  - v4: introduced PaintLayer + TextLayer.letterSpacing/lineHeight.
   *        All new fields optional with identity defaults (no-op migration).
   *  - v5: introduced GroupLayer + BaseLayer.lockFlags. All new fields
   *        optional with identity defaults — no-op migration stamp only.
   *  - v6: introduced BaseLayer.blendMode, BaseLayer.mask, BaseLayer.clippedToLayerBelow,
   *        ImageLayerFilters.noise, ShapeLayer.gradientFill, PaintLayer.stroke,
   *        TextLayer.stroke. All new fields are optional with identity defaults
   *        — no-op migration stamp only.
   *  - v7: introduced optional `inventoryIcon` field — a user-supplied image
   *        (data URL, rendered at 64×64) that overrides the auto-generated
   *        icon-sub-rect thumbnail the engine samples for the inventory +
   *        player profile chip. Absent / undefined falls back to the v1-v6
   *        behaviour of downsampling the banner into the icon region.
   *        Optional field, no migration needed. */
  version: 7
  /** Stable unique id; generated once in newFaceplateProject(). */
  id: string
  /** Display title used in the in-game customization panel and recent list. */
  packName: string
  /** Long description (multiline) for the in-game panel. */
  packDescription: string
  /** Author credit. */
  author: string
  /** Optional canvas background colour (CSS hex). null = transparent. */
  backgroundColor: string | null
  /** All image assets in the project. Layers reference these by id. */
  images: Record<string, FaceplateImage>
  /** Ordered list of layers, bottom-first (last in array renders on top). */
  layers: FaceplateLayer[]
  /**
   * Optional inventory icon — a user-supplied image (base64 data URL) that
   * overrides the auto-generated 64×64 thumbnail the engine samples for the
   * player profile + inventory chip. Absent / undefined falls back to a
   * downsample of the banner. Added in schema v7.
   *
   * Why this exists: the auto-downsample is almost always blurry because the
   * banner is a wide rectangular composition that doesn't crop cleanly to a
   * square 64×64 thumbnail. Letting the user supply a purpose-built icon
   * (logo, monogram, faction crest) makes the inventory chip readable.
   *
   * Stored as a data URL so projects remain self-contained (no separate
   * image-id reference into `images` — that table is for canvas layers).
   */
  inventoryIcon?: string
  /**
   * Whether the user has clicked the title pill at least once since this
   * faceplate was created. Drives the one-time BorderBeam hint on new packs.
   *
   * - `false` — freshly created; beam shown until first title click.
   * - `true`  — user has acknowledged; beam never shown again.
   * - `undefined` (absent) — loaded from storage before this field existed;
   *   treated as `true` (no beam for pre-existing faceplates).
   */
  titleAcknowledged?: boolean
  /** Persisted editor zoom level (0.5–8). Absent = default 1.75. */
  editorZoom?: number
  /** ISO timestamp of the last save — drives the recent-projects ordering. */
  modifiedAt: string
}

const ACTIVE_KEY = 'coh2-faceplate-active-project'
const PROJECT_KEY_PREFIX = 'coh2.faceplate.'
const RECENT_KEY = 'coh2.recentFaceplates'
const RECENT_MAX = 12

/** Generate a stable 32-hex-char mod-identity GUID for a faceplate project.
 *  Mirrors `generateGuid()` in faceplate-mod-build.ts but is kept inline here
 *  so the lightweight project model never has to pull in the heavy build
 *  module (bc-encode, sga-writer, pako) just to mint an id at creation time. */
export function freshFaceplateGuid(): string {
  const bytes = new Uint8Array(16)
  const g = globalThis as { crypto?: Crypto }
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  for (let i = 0; i < 16; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

export function newFaceplateProject(packName = 'My Faceplate'): Coh2FaceplateProject {
  return {
    magic: 'coh2-faceplate-project',
    version: 7,
    id: 'fp_' + Math.random().toString(36).slice(2, 12),
    // Stable mod identity — minted once, reused on every build so the
    // in-game attribute pbgid never churns (see the `guid` field docs).
    guid: freshFaceplateGuid(),
    packName,
    packDescription: 'A custom CoH2 player faceplate made with the community modding tool.',
    author: 'Anonymous',
    backgroundColor: null,
    images: {},
    layers: [],
    // inventoryIcon omitted — defaults to undefined, falls back to
    // auto-downsample of the banner. User can opt in via the Live Sync
    // popover's "Inventory icon" picker.
    modifiedAt: new Date().toISOString(),
    titleAcknowledged: false,
  }
}

/** Generate a stable id for a new layer. Layer ids only need to be unique
 *  within a single project, so a short base36 token is plenty. */
export function freshLayerId(): string {
  return 'layer_' + Math.random().toString(36).slice(2, 10)
}

/** Same for image library entries. */
export function freshImageId(): string {
  return 'fpimg_' + Math.random().toString(36).slice(2, 10)
}

/** Create a new ImageLayer with sensible defaults centred at canvas origin.
 *  The caller should set x/y to the desired canvas centre after creation. */
export function newImageLayer(imageId: string): ImageLayer {
  return {
    kind: 'image',
    id: freshLayerId(),
    imageId,
    x: FACEPLATE_BANNER_W / 2,
    y: FACEPLATE_BANNER_H / 2,
    rotation: 0,
    scale: 1,
    scaleY: 1,
    opacity: 1,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
  }
}

/**
 * Create an ImageLayer with a sensible auto-scale so the longest side fits
 * inside ~80% of the banner height. Centred on the banner. This is the
 * default placement used whenever an image is dragged / pasted / picked into
 * the editor.
 *
 * Exported so callers outside FaceplateEditor (e.g. DecalPackEditor) can
 * reuse the same sizing heuristic without duplicating the maths.
 */
export function makeDefaultLayer(p: Coh2FaceplateProject, imageId: string): ImageLayer {
  const img = p.images[imageId]
  const target = FACEPLATE_BANNER_H * 0.8
  const longestSide = img ? Math.max(img.width, img.height, 1) : target
  const scale = target / longestSide
  return {
    kind: 'image',
    id: freshLayerId(),
    imageId,
    x: FACEPLATE_BANNER_W / 2,
    y: FACEPLATE_BANNER_H / 2,
    rotation: 0,
    scale,
    scaleY: scale,
    opacity: 1,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
  }
}

/** Create a new ShapeLayer with sensible defaults centred on the canvas.
 *  Default size is a quarter of the banner so the user sees a visible primitive
 *  immediately; they can resize via transform handles. Default fill is the
 *  CoH2 in-game accent orange so it's visually distinct from white text. */
export function newShapeLayer(shapeType: ShapeKind = 'rectangle'): ShapeLayer {
  return {
    kind: 'shape',
    id: freshLayerId(),
    shapeType,
    width: FACEPLATE_BANNER_W * 0.25,
    height: FACEPLATE_BANNER_H * 0.5,
    fillColor: '#d97706',
    x: FACEPLATE_BANNER_W / 2,
    y: FACEPLATE_BANNER_H / 2,
    rotation: 0,
    scale: 1,
    opacity: 1,
    locked: false,
    visible: true,
  }
}

/** Create a new TextLayer with sensible defaults centred on the canvas. */
export function newTextLayer(text = 'Your text'): TextLayer {
  return {
    kind: 'text',
    id: freshLayerId(),
    text,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 48,
    fontWeight: 700,
    fontStyle: 'normal',
    color: '#ffffff',
    align: 'center',
    strokeColor: '',
    strokeWidth: 0,
    x: FACEPLATE_BANNER_W / 2,
    y: FACEPLATE_BANNER_H / 2,
    rotation: 0,
    scale: 1,
    opacity: 1,
    locked: false,
    visible: true,
  }
}

/** Create a new GroupLayer. The group starts with no children — the caller
 *  should populate `childIds` by moving existing layer ids into it. */
export function newGroupLayer(name = 'Group'): GroupLayer {
  return {
    kind: 'group',
    id: freshLayerId(),
    name,
    visible: true,
    opacity: 1,
    childIds: [],
    collapsed: false,
  }
}

/** Create a new PaintLayer with an empty transparent 624×204 bitmap.
 *  The data URL encodes a 1×1 transparent PNG scaled at render time —
 *  in practice the editor draws into an offscreen canvas and replaces
 *  `dataUrl` on pointerup, so the initial data URL is only held briefly. */
export function newPaintLayer(): PaintLayer {
  // Smallest valid transparent PNG (1×1 pixel, 68 bytes).
  const BLANK_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  return {
    kind: 'paint',
    id: freshLayerId(),
    dataUrl: BLANK_PNG,
    width: FACEPLATE_BANNER_W as 624,
    height: FACEPLATE_BANNER_H as 204,
    x: FACEPLATE_BANNER_W / 2,
    y: FACEPLATE_BANNER_H / 2,
    rotation: 0,
    scale: 1,
    opacity: 1,
    locked: false,
    visible: true,
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────

/** Snapshot the active faceplate project to localStorage. */
export function persistFaceplate(p: Coh2FaceplateProject): void {
  try {
    p.modifiedAt = new Date().toISOString()
    const json = JSON.stringify(p)
    localStorage.setItem(PROJECT_KEY_PREFIX + p.id, json)
    localStorage.setItem(ACTIVE_KEY, p.id)
    trackRecentFaceplate(p)
  } catch (e) {
    console.warn('persistFaceplate failed', e)
  }
}

/** Load the active faceplate project (if any). Returns null when no
 *  project has been persisted yet or the snapshot has been evicted. */
export function loadActiveFaceplate(): Coh2FaceplateProject | null {
  try {
    const id = localStorage.getItem(ACTIVE_KEY)
    if (!id) return null
    return loadFaceplateById(id)
  } catch {
    return null
  }
}

/** Load a faceplate project from its per-id snapshot. */
export function loadFaceplateById(id: string): Coh2FaceplateProject | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY_PREFIX + id)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.magic !== 'coh2-faceplate-project') return null
    return migrateFaceplateProject(parsed)
  } catch {
    return null
  }
}

/** Read a `.coh2faceplate` file from disk. Validates magic.
 *  Also migrates old-format layers (no `kind` field) to `kind: 'image'`. */
export async function readFaceplateFile(file: File): Promise<Coh2FaceplateProject> {
  const text = await file.text()
  const parsed = JSON.parse(text)
  if (parsed?.magic !== 'coh2-faceplate-project') {
    throw new Error('Not a valid .coh2faceplate file (missing magic header).')
  }
  return migrateFaceplateProject(parsed)
}

/** Migrate a raw parsed project object to the current schema.
 *
 *  Two evolutions handled here:
 *    1. Pre-v1 projects had layers without an explicit `kind` field — treat
 *       those as image layers (text layers were added later).
 *    2. v1 → v2: the canvas resized from 600×170 to 624×204 to match the
 *       engine's actual banner display rect. Layer x/y are stored in canvas
 *       pixels, so we scale them up by (624/600, 204/170) ≈ (1.04, 1.20) to
 *       preserve the user's existing composition relative to the new canvas
 *       extents. Text-layer `fontSize` and image-layer `scale` are likewise
 *       relative to canvas pixels, but we leave them alone — bumping their
 *       size to match the new canvas would change the apparent text/image
 *       size in the engine (which renders the atlas at a fixed display
 *       size), so preserving them produces a faithful rerender. */
function migrateFaceplateProject(raw: unknown): Coh2FaceplateProject {
  // Use a plain object type for migration to avoid discriminated union spread issues.
  type RawLayer = Record<string, unknown>
  const p = raw as {
    layers?: RawLayer[]
    version?: number
  } & Omit<Coh2FaceplateProject, 'layers' | 'version'>

  if (Array.isArray(p.layers)) {
    p.layers = p.layers.map((l: RawLayer) => {
      if (!l['kind']) {
        return { ...l, kind: 'image' } as unknown as RawLayer
      }
      return l
    })
  }

  // v1 → v2: scale layer coordinates from the old 600×170 canvas into the
  // new 624×204 canvas. Missing/0/1 version is treated as v1.
  const incomingVersion = typeof p.version === 'number' ? p.version : 1
  if (incomingVersion < 2 && Array.isArray(p.layers)) {
    const sx = FACEPLATE_BANNER_W / 600
    const sy = FACEPLATE_BANNER_H / 170
    p.layers = p.layers.map((l: RawLayer) => {
      const x = typeof l['x'] === 'number' ? (l['x'] as number) * sx : l['x']
      const y = typeof l['y'] === 'number' ? (l['y'] as number) * sy : l['y']
      return { ...l, x, y }
    })
  }
  // v2 → v3: introduced ShapeLayer + per-layer shadow + per-image edge stroke.
  // All new fields are optional with identity-valued defaults, so old projects
  // load forward unchanged.
  // v3 → v4: introduced PaintLayer + TextLayer.letterSpacing/lineHeight.
  // All new fields are optional with identity-valued defaults, so old projects
  // load forward unchanged.
  // v4 → v5: introduced GroupLayer + BaseLayer.lockFlags. All new fields are
  // optional with identity-valued defaults — no-op migration stamp only.
  // v5 → v6: introduced BaseLayer.blendMode, BaseLayer.mask,
  // BaseLayer.clippedToLayerBelow, ImageLayerFilters.noise,
  // ShapeLayer.gradientFill, PaintLayer.stroke, TextLayer.stroke.
  // All new fields are optional with identity-valued defaults — no-op
  // migration stamp only.
  // v6 → v7: introduced optional `inventoryIcon` field for user-supplied
  // 64×64 thumbnail. Field is optional with no default — absent means
  // fall back to banner downsample. No structural migration needed.
  ;(p as { version: number }).version = 7

  // Backfill a stable mod-identity GUID for any project saved before the
  // `guid` field existed (or with a malformed value). From this load onward
  // the project keeps ONE identity, so every rebuild is a true in-place
  // update and the in-game attribute pbgid stops churning. Pre-existing
  // projects that were previously published with the old random-GUID-per-build
  // behaviour are re-pinned here; the user's next publish lands as a clean,
  // stable faceplate.
  const guidHolder = p as { guid?: unknown }
  if (typeof guidHolder.guid !== 'string' || !/^[0-9a-f]{32}$/.test(guidHolder.guid)) {
    guidHolder.guid = freshFaceplateGuid()
  }

  return p as unknown as Coh2FaceplateProject
}

// ─── Recent faceplates registry ───────────────────────────────────────────

export interface RecentFaceplateEntry {
  id: string
  name: string
  /** ms since epoch at last save. */
  lastEditedAt: number
  layerCount: number
  /** Tiny base64 thumbnail of the composed canvas (≤64 px) — populated by
   *  the editor on save so the recent list can show a real preview. */
  thumbnail: string | null
}

function trackRecentFaceplate(p: Coh2FaceplateProject): void {
  try {
    const entries = getRecentFaceplates()
    const entry: RecentFaceplateEntry = {
      id: p.id,
      name: p.packName,
      lastEditedAt: Date.now(),
      layerCount: p.layers.length,
      // The editor calls updateRecentFaceplateThumbnail() separately
      // after composing — initial entry has no thumbnail.
      thumbnail: entries.find(e => e.id === p.id)?.thumbnail ?? null,
    }
    const filtered = entries.filter(e => e.id !== p.id)
    const updated = [entry, ...filtered].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))
  } catch (e) {
    console.warn('trackRecentFaceplate failed', e)
  }
}

/** Replace the thumbnail for a given faceplate's recent entry (no-op if
 *  it's no longer in the list). Called by FaceplateEditor after a save
 *  once it has composed the canvas to a data URL. */
export function updateRecentFaceplateThumbnail(id: string, thumbnail: string): void {
  try {
    const entries = getRecentFaceplates()
    const next = entries.map(e => (e.id === id ? { ...e, thumbnail } : e))
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* swallow — non-critical */
  }
}

export function getRecentFaceplates(): RecentFaceplateEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as RecentFaceplateEntry[]
  } catch {
    return []
  }
}

/**
 * Return EVERY healthy faceplate project the user has saved, regardless
 * of whether it's still in the 12-entry recent registry.
 *
 * Mirrors `listAllSkinProjects()` over in `project.ts` — same rationale:
 * `trackRecentFaceplate` caps the registry at RECENT_MAX (12) but the
 * per-id snapshots (`coh2.faceplate.<id>`) are kept indefinitely. The
 * "clone template" picker and the Saved Projects list both want the full
 * set, so we walk localStorage by key prefix here and validate each via
 * `loadFaceplateById` — broken entries (missing key, JSON parse fail,
 * wrong magic, schema reject) are silently dropped so the picker never
 * surfaces a faceplate that would crash the editor on click.
 *
 * Sort: lastEditedAt descending (registry value when present, otherwise
 * synthesised from the project's `modifiedAt` ISO timestamp).
 */
export function listAllFaceplates(): RecentFaceplateEntry[] {
  const entries: RecentFaceplateEntry[] = []
  try {
    const cached = new Map<string, RecentFaceplateEntry>(getRecentFaceplates().map(e => [e.id, e]))
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PROJECT_KEY_PREFIX)) continue
      const id = key.slice(PROJECT_KEY_PREFIX.length)
      const project = loadFaceplateById(id)
      if (!project) continue // broken — drop it
      const fromRegistry = cached.get(id)
      entries.push({
        id: project.id,
        name: project.packName || fromRegistry?.name || 'Untitled faceplate',
        lastEditedAt:
          fromRegistry?.lastEditedAt ??
          (() => {
            const t = Date.parse(project.modifiedAt ?? '')
            return Number.isFinite(t) ? t : 0
          })(),
        layerCount: project.layers.length,
        thumbnail: fromRegistry?.thumbnail ?? null,
      })
    }
  } catch {
    /* swallow — non-critical */
  }
  entries.sort((a, b) => b.lastEditedAt - a.lastEditedAt)
  return entries
}

/** Clear the workshopId from a faceplate project in localStorage without
 *  otherwise mutating the project or affecting the recent registry. Used
 *  by the "Delete from Workshop" affordance after a successful Workshop
 *  deletion — the project stays local but is treated as unpublished. */
export function clearFaceplateWorkshopId(id: string): void {
  try {
    const raw = localStorage.getItem(PROJECT_KEY_PREFIX + id)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed?.magic !== 'coh2-faceplate-project') return
    delete parsed.workshopId
    localStorage.setItem(PROJECT_KEY_PREFIX + id, JSON.stringify(parsed))
  } catch {
    /* swallow — non-critical */
  }
}

/** Remove a faceplate project from the recent-faceplates registry AND
 *  delete its per-id snapshot. Used by the "trash" affordance on the
 *  Saved Projects list. Safe to call for an id that's already gone. */
export function removeRecentFaceplate(id: string): void {
  try {
    const entries = getRecentFaceplates().filter(e => e.id !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
  } catch {
    /* swallow — non-critical */
  }
  try {
    localStorage.removeItem(`${PROJECT_KEY_PREFIX}${id}`)
  } catch {
    /* swallow — non-critical */
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Read an image File into the project's image library. Returns the new
 *  image id so the caller can immediately push a layer that references it. */
export async function addFaceplateImageFromFile(
  p: Coh2FaceplateProject,
  file: File,
): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error)
    r.readAsDataURL(file)
  })
  const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
    const img = new Image()
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => rej(new Error('Image failed to load'))
    img.src = dataUrl
  })
  const id = freshImageId()
  p.images[id] = {
    id,
    name: file.name || 'pasted-image',
    dataUrl,
    width: dims.w,
    height: dims.h,
  }
  return id
}

/** Same but for a raw Blob (clipboard paste produces blobs, not Files,
 *  in some browsers). */
export async function addFaceplateImageFromBlob(
  p: Coh2FaceplateProject,
  blob: Blob,
  name = 'pasted-image',
): Promise<string> {
  const file = new File([blob], name, { type: blob.type })
  return addFaceplateImageFromFile(p, file)
}
