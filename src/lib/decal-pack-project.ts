/**
 * `.coh2decalpack` project format.
 *
 * Stores everything needed to recreate a Relic-format Decal Pack the user is
 * composing in the DecalPackEditor: pack metadata + an ordered collection of
 * individual decals. Each decal is an independent 128×128 image (with optional
 * per-decal crop transform applied at export time).
 *
 * This format is parallel to `coh2-faceplate-project` but conceptually
 * different: a faceplate composes many image *layers* into one output canvas,
 * whereas a decal pack carries many independent *decals*, each of which
 * becomes its own texture file in the output SGA. The same UI primitives
 * (ImageDropZone, ImageLibraryPanel, project persistence) are reused — only
 * the canvas semantics and export pipeline differ.
 *
 * Persistence layout mirrors the faceplate project:
 *   - localStorage active project key: `coh2-decalpack-active-project`
 *   - localStorage per-project key:    `coh2.decalpack.<id>`
 *   - recent list key:                  `coh2.recentDecalPacks`
 *
 * Magic header (`coh2-decalpack-project`) lets `readProjectFile` sniff
 * skin-pack vs faceplate vs decal-pack vs garbage on load.
 *
 * Canvas: each decal is rendered at `DECAL_PACK_SIZE` × `DECAL_PACK_SIZE` px.
 * Relic's stock decal templates are 128×128; we follow that convention so
 * the engine accepts every output without per-decal size assertions.
 */

/** Canonical per-decal canvas dimensions. Matches Relic's decal pack
 *  template — every emitted decal texture is exactly this size. */
export const DECAL_PACK_SIZE = 128

export interface DecalSourceImage {
  /** Stable id; referenced by Decal entries via sourceImageId. */
  id: string
  /** User-friendly label (filename when added, editable in UI). */
  name: string
  /** Base64 data: URL of the source image bytes. PNG/JPG/SVG/WEBP all work. */
  dataUrl: string
  /** Natural pixel dimensions of the source. Used for the per-decal crop UI. */
  width: number
  height: number
}

/**
 * A single decal entry in the pack. Each decal becomes its own texture file
 * in the output SGA at export time.
 *
 * Position/scale/rotation are expressed in the per-decal 128×128 canvas
 * coordinate space, NOT the original source-image space. This matches how
 * FaceplateLayer stores layer geometry and means the editor's transform
 * handles work the same way for both editors.
 */
/** Edge-stroke descriptor for decals. Mirrors `LayerStroke` in
 *  faceplate-project.ts (kept duplicated rather than imported so each project
 *  format remains self-describing). Width 0 / missing = no stroke. */
export interface DecalStroke {
  color: string
  width: number
}

/**
 * Photoshop-style blend mode for a decal. Mirrors `BlendMode` in
 * faceplate-project.ts (kept duplicated rather than imported so each project
 * format remains self-describing and can evolve independently).
 *
 * Values map 1:1 to `CanvasRenderingContext2D.globalCompositeOperation`.
 * Identity = 'normal' (absent field = no-op). v4 addition.
 */
export type DecalBlendMode =
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

/**
 * Paintable alpha mask for a decal. Mirrors `LayerMask` in
 * faceplate-project.ts (kept duplicated so each project format remains
 * self-describing). White = visible, black = hidden. v4 addition.
 *
 * Only affects the in-editor preview composite — each decal still exports as
 * an independent texture without the mask baked in (mask baking deferred to
 * a future export-pipeline wave).
 */
export interface DecalMask {
  /** Base64 PNG data URL of a greyscale (or alpha-channel) mask.
   *  Same dimensions as the decal's rendered bounding box at scale=1. */
  dataUrl: string
  /** When true, mask is treated as inverted (black = visible). */
  invert?: boolean
  /** When false, mask is disabled temporarily for preview purposes.
   *  Defaults to enabled (true) when absent. */
  enabled?: boolean
}

/** Tint descriptor: multiplies the decal source by a single colour while
 *  preserving its alpha. Strength 0 = original, 1 = fully tinted. Useful for
 *  recolouring a black-and-white emblem to a faction colour without authoring
 *  a separate source asset. */
export interface DecalTint {
  color: string
  /** 0..1 mix between original and pure-tint pixel. */
  strength: number
}

/** Per-decal lock flags — mirrors BaseLayer.lockFlags in faceplate-project.ts.
 *  Kept as a local type (not imported) so each project format remains
 *  self-describing and can evolve independently. */
export interface DecalLockFlags {
  /** When true, drag-move events are ignored. */
  position?: boolean
  /** When true, resize handles maintain the decal's width/height ratio. */
  aspect?: boolean
}

export interface Decal {
  /** Stable id; also used to derive the texture filename inside the SGA. */
  id: string
  /** User-facing label (also the in-game decal name). */
  name: string
  /** Reference into project.sourceImages. */
  sourceImageId: string
  /** Centre x of the source image inside the 128×128 canvas. */
  x: number
  /** Centre y of the source image inside the 128×128 canvas. */
  y: number
  /** Rotation in degrees, clockwise. */
  rotation: number
  /** Uniform scale multiplier. 1 = source pixels render 1:1. */
  scale: number
  /** Layer opacity 0..1. */
  opacity: number
  /** When true, drawn horizontally flipped. */
  flipH: boolean
  /** When true, drawn vertically flipped. */
  flipV: boolean
  /** When false, excluded from the export and grid preview. */
  visible: boolean
  /** Optional fine-grained lock controls for position and aspect ratio.
   *  Omitted = fully unlocked. */
  locked?: DecalLockFlags
  /** Optional edge stroke drawn around the decal's alpha silhouette. */
  stroke?: DecalStroke
  /** Optional tint multiplier (recolour the source image). */
  tint?: DecalTint
  /**
   * Brightness adjustment applied at render time via CSS filter / canvas
   * ctx.filter. Range 0–200 where 100 = identity (no change). Values below
   * 100 darken; above 100 brighten. Defaults to 100 when absent.
   */
  brightness?: number
  /**
   * Contrast adjustment applied at render time via CSS filter / canvas
   * ctx.filter. Range 0–200 where 100 = identity (no change). Values below
   * 100 reduce contrast; above 100 increase it. Defaults to 100 when absent.
   */
  contrast?: number
  /**
   * Saturation (colour intensity) adjustment applied at render time via CSS
   * filter / canvas ctx.filter. Range 0–200 where 100 = identity (no change).
   * 0 = fully greyscale; 200 = double-saturated. Defaults to 100 when absent.
   */
  saturation?: number
  /**
   * Photoshop-style blend mode for this decal's compositing step. Identity =
   * 'normal' (absent = no-op). Maps directly to
   * `CanvasRenderingContext2D.globalCompositeOperation`. v4 addition.
   */
  blendMode?: DecalBlendMode
  /**
   * Optional paintable alpha mask. White = fully visible, black = fully hidden.
   * `enabled !== false` to activate; `invert` reverses the sense. v4 addition.
   *
   * NOTE: this only affects the in-editor preview. Each decal is exported as an
   * independent texture — mask baking into the exported PNG is deferred to a
   * future export-pipeline wave.
   */
  mask?: DecalMask
  /**
   * When true, this decal is clipped to the alpha of the previous (lower)
   * decal in the `decals` array — a "clipping mask" effect during in-editor
   * preview. Identity = false (absent). v4 addition.
   *
   * NOTE: this only affects in-editor preview, not the exported textures.
   * Each decal exports as an independent texture, so clipping is only
   * meaningful during the preview composite step.
   */
  clippedToDecalBelow?: boolean
}

/** Identity-valued defaults for the optional decal modifier fields. The
 *  rasteriser checks against these to skip work entirely when a field is at
 *  identity (e.g. width 0 stroke or strength 0 tint). Exported so the tool
 *  peels can seed sliders consistently. */
export const DECAL_STROKE_DEFAULTS: DecalStroke = { color: '#000000', width: 0 }
export const DECAL_TINT_DEFAULTS: DecalTint = { color: '#ffffff', strength: 0 }

export interface Coh2DecalPackProject {
  /** Magic for file sniffing on load. */
  magic: 'coh2-decalpack-project'
  /** Steam Workshop item ID, set after a successful publish via
   *  PublishToWorkshopDialog. Absent / undefined = not yet published.
   *  ≤5×10⁹ = real Workshop ID; ≥1×10¹⁵ = fake locally-generated ID. */
  workshopId?: string
  /** Schema version.
   *  - v1: original; no per-decal stroke or tint.
   *  - v2: introduced optional `stroke` and `tint` on each Decal. Old projects
   *        load forward unchanged — both fields are optional with identity
   *        defaults.
   *  - v3: introduced optional `brightness`, `contrast`, and `saturation` on
   *        each Decal. Migration fills missing fields with identity value 100.
   *  - v4: introduced optional `blendMode`, `mask`, and `clippedToDecalBelow`
   *        on each Decal. All new fields are optional with identity defaults —
   *        no-op migration stamp only.
   *  - v5: introduced optional `packIcon` field — a user-supplied image
   *        (data URL, rendered at 64×64) that overrides the auto-generated
   *        icon the engine uses for the decal pack panel thumbnail.
   *        Optional field, no migration needed. */
  version: 5
  /** Stable unique id; generated once in newDecalPackProject(). */
  id: string
  /** Display title for the in-game decal-pack panel and recent list. */
  packName: string
  /** Long description (multiline) for the in-game panel. */
  packDescription: string
  /** Author credit. */
  author: string
  /**
   * Optional pack icon — a user-supplied image (base64 data URL) that
   * overrides the auto-generated icon the engine uses for the decal pack
   * panel thumbnail. Absent / undefined falls back to the engine default of
   * sampling the first decal in the pack. Added in schema v5.
   *
   * Why this exists: the first-decal thumbnail is rarely a good representative
   * icon for the pack as a whole. Letting the user supply a purpose-built icon
   * (logo, monogram, faction crest) makes the pack chip readable at a glance.
   *
   * Stored as a data URL so projects remain self-contained (no separate
   * image-id reference into `sourceImages` — that table is for decal sources).
   */
  packIcon?: string
  /** All source image assets in the project. Decals reference these by id. */
  sourceImages: Record<string, DecalSourceImage>
  /** Ordered list of decals. Order = pack-display order in-game. */
  decals: Decal[]
  /** Currently-edited decal id; drives the editor canvas focus. null if none. */
  activeDecalId: string | null
  /** ISO timestamp of the last save — drives the recent-projects ordering. */
  modifiedAt: string
}

const ACTIVE_KEY = 'coh2-decalpack-active-project'
const PROJECT_KEY_PREFIX = 'coh2.decalpack.'
const RECENT_KEY = 'coh2.recentDecalPacks'
const RECENT_MAX = 12

export function newDecalPackProject(packName = 'My Decal Pack'): Coh2DecalPackProject {
  return {
    magic: 'coh2-decalpack-project',
    version: 5,
    id: 'dp_' + Math.random().toString(36).slice(2, 12),
    packName,
    packDescription: 'A custom CoH2 decal pack made with the community modding tool.',
    author: 'Anonymous',
    sourceImages: {},
    decals: [],
    activeDecalId: null,
    modifiedAt: new Date().toISOString(),
  }
}

export function freshDecalId(): string {
  return 'decal_' + Math.random().toString(36).slice(2, 10)
}

export function freshSourceImageId(): string {
  return 'dpimg_' + Math.random().toString(36).slice(2, 10)
}

/**
 * Create a new Decal with a sensible default transform so the source image
 * fills ~80% of the 128² canvas centred. Mirrors FaceplateEditor's
 * `makeDefaultLayer` heuristic so the user experience is consistent across
 * both editors.
 */
export function newDecal(p: Coh2DecalPackProject, sourceImageId: string, name?: string): Decal {
  const img = p.sourceImages[sourceImageId]
  const target = DECAL_PACK_SIZE * 0.8
  const longestSide = img ? Math.max(img.width, img.height, 1) : target
  const scale = target / longestSide
  return {
    id: freshDecalId(),
    name: name ?? img?.name ?? 'Untitled decal',
    sourceImageId,
    x: DECAL_PACK_SIZE / 2,
    y: DECAL_PACK_SIZE / 2,
    rotation: 0,
    scale,
    opacity: 1,
    flipH: false,
    flipV: false,
    visible: true,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Image library management.
// Mirrors the helpers in faceplate-project.ts so the shared ImageDropZone /
// ImageLibraryPanel components can be wired to either project shape via the
// `onImport(blob, name)` callback pattern.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Read a Blob into a base64 data URL plus natural width/height, then
 * register it in the project's source-image library. Returns the new
 * source image id. Mutates the project in place — the caller is
 * responsible for wrapping in a structuredClone if immutability matters.
 */
export async function addDecalSourceImageFromBlob(
  p: Coh2DecalPackProject,
  blob: Blob,
  name?: string,
): Promise<string> {
  const dataUrl = await blobToDataUrl(blob)
  const { width, height } = await measureImage(dataUrl)
  const id = freshSourceImageId()
  p.sourceImages[id] = {
    id,
    name: name ?? `Image ${Object.keys(p.sourceImages).length + 1}`,
    dataUrl,
    width,
    height,
  }
  return id
}

export async function addDecalSourceImageFromFile(
  p: Coh2DecalPackProject,
  file: File,
): Promise<string> {
  // Strip directory + extension for a friendlier default decal name.
  const friendly = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')
  return addDecalSourceImageFromBlob(p, file, friendly)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Image decode failed'))
    img.src = dataUrl
  })
}

// ───────────────────────────────────────────────────────────────────────────
// localStorage persistence.
// Same per-id-snapshot layout as the faceplate project so the unified
// Recent-projects UI on StartScreen can index both kinds.
// ───────────────────────────────────────────────────────────────────────────

export function projectStorageKey(id: string): string {
  return PROJECT_KEY_PREFIX + id
}

export function saveDecalPackToLocal(p: Coh2DecalPackProject): void {
  try {
    localStorage.setItem(projectStorageKey(p.id), JSON.stringify(p))
    localStorage.setItem(ACTIVE_KEY, p.id)
    touchRecent(p)
  } catch {
    // localStorage may throw QuotaExceededError on large image libraries.
    // The caller will catch via the UI's autosave handler — failure here
    // is non-fatal because the user can always Save to disk.
  }
}

export function loadActiveDecalPackFromLocal(): Coh2DecalPackProject | null {
  try {
    const id = localStorage.getItem(ACTIVE_KEY)
    if (!id) return null
    const raw = localStorage.getItem(projectStorageKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Coh2DecalPackProject
    if (parsed?.magic !== 'coh2-decalpack-project') return null
    return migrateDecalPackProject(parsed)
  } catch {
    return null
  }
}

/** Migrate a parsed decal-pack project to the current schema.
 *  v1 → v2: stamp `version: 2` so subsequent saves drop the legacy version.
 *  All v2 additions (stroke, tint) are optional fields with identity
 *  defaults, so old decals load forward without any geometric change.
 *  v2 → v3: stamp `version: 3` and ensure brightness / contrast / saturation
 *  exist on every decal (default 100 = identity). The fields are optional in
 *  the TypeScript type so v3 projects with all-defaults round-trip without
 *  extra bytes; migration only writes them when a decal is missing them
 *  entirely (i.e. was authored before v3).
 *  v3 → v4: stamp `version: 4`. All v4 additions (blendMode, mask,
 *  clippedToDecalBelow) are optional with identity defaults — no field
 *  writes needed, stamp only. */
function migrateDecalPackProject(raw: Coh2DecalPackProject): Coh2DecalPackProject {
  const incoming = typeof raw.version === 'number' ? raw.version : 1
  if (incoming < 2) {
    ;(raw as { version: number }).version = 2
  }
  if (incoming < 3) {
    ;(raw as { version: number }).version = 3
    // Stamp identity values on pre-v3 decals that have no adjustment fields.
    for (const decal of raw.decals) {
      if (decal.brightness === undefined) decal.brightness = 100
      if (decal.contrast === undefined) decal.contrast = 100
      if (decal.saturation === undefined) decal.saturation = 100
    }
  }
  if (incoming < 4) {
    // v3 → v4: all new fields (blendMode, mask, clippedToDecalBelow) are
    // optional with identity defaults — no field writes needed, stamp only.
    ;(raw as { version: number }).version = 4
  }
  if (incoming < 5) {
    // v4 → v5: packIcon is optional with no identity value — stamp only.
    ;(raw as { version: number }).version = 5
  }
  return raw
}

/** Load a decal pack project from its per-id snapshot without changing the
 *  active-project pointer. Returns null if the snapshot has been evicted. */
export function loadDecalPackById(id: string): Coh2DecalPackProject | null {
  try {
    const raw = localStorage.getItem(projectStorageKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Coh2DecalPackProject
    if (parsed?.magic !== 'coh2-decalpack-project') return null
    return migrateDecalPackProject(parsed)
  } catch {
    return null
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Recent-projects list.
// ───────────────────────────────────────────────────────────────────────────

export interface RecentDecalPack {
  id: string
  packName: string
  decalCount: number
  lastEditedAt: string
  /** Tiny data: URL preview thumbnail for the hover-preview in
   *  TemplatePicker. Populated lazily by `updateRecentDecalPackThumbnail`
   *  after the editor composes the first decal preview. Null until the
   *  user has opened the pack at least once with a decal present. */
  thumbnail?: string | null
}

function touchRecent(p: Coh2DecalPackProject): void {
  try {
    const list = readRecent()
    // Preserve any prior thumbnail across touch — composing is async and
    // happens after touchRecent fires, so we don't want every save to
    // wipe the hover-preview image until the next compose lands.
    const priorThumb = list.find(r => r.id === p.id)?.thumbnail ?? null
    const filtered = list.filter(r => r.id !== p.id)
    filtered.unshift({
      id: p.id,
      packName: p.packName,
      decalCount: p.decals.length,
      lastEditedAt: new Date().toISOString(),
      thumbnail: priorThumb,
    })
    localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, RECENT_MAX)))
  } catch {
    // swallow; non-fatal
  }
}

/** Replace the thumbnail for a given decal pack's recent entry (no-op if
 *  the pack isn't in the recent list). Called by DecalPackEditor after
 *  composing the first decal preview — mirrors
 *  updateRecentFaceplateThumbnail in faceplate-project.ts. */
export function updateRecentDecalPackThumbnail(id: string, thumbnail: string): void {
  try {
    const entries = readRecent()
    if (!entries.some(e => e.id === id)) return
    const next = entries.map(e => (e.id === id ? { ...e, thumbnail } : e))
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* swallow — best effort */
  }
}

export function readRecent(): RecentDecalPack[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    return JSON.parse(raw) as RecentDecalPack[]
  } catch {
    return []
  }
}

/**
 * Return EVERY healthy decal-pack project the user has saved, regardless
 * of whether it's still in the 12-entry recent registry.
 *
 * Mirrors `listAllSkinProjects()` / `listAllFaceplates()`. The recent
 * registry caps at RECENT_MAX = 12, but per-id snapshots
 * (`coh2.decalpack.<id>`) are kept indefinitely. The clone-template
 * picker and Saved Projects list both want the full set. Validity is
 * gated by `loadDecalPackById` — broken entries (missing key, parse
 * fail, wrong magic, schema reject) are silently excluded so the picker
 * never surfaces a pack that crashes the editor on click.
 *
 * `lastEditedAt` is an ISO string on this schema (not ms-since-epoch
 * like the other two). We preserve that contract — fall back to the
 * project's own `modifiedAt` when the registry has no cached value.
 */
export function listAllDecalPacks(): RecentDecalPack[] {
  const entries: RecentDecalPack[] = []
  try {
    const cached = new Map<string, RecentDecalPack>(readRecent().map(r => [r.id, r]))
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PROJECT_KEY_PREFIX)) continue
      const id = key.slice(PROJECT_KEY_PREFIX.length)
      const project = loadDecalPackById(id)
      if (!project) continue // broken — drop it
      const fromRegistry = cached.get(id)
      // Use the storage-key `id` (the suffix of the localStorage key), NOT
      // `project.id` from the JSON body. On legacy, hand-edited, or renamed
      // snapshots the body id can drift from the storage key. The routing
      // path (handlePickDecalPack → loadDecalPackById) keys on the storage
      // suffix, so the row id here must match it — otherwise clicking a
      // drifted row loads from a different (or missing) slot and silently
      // no-ops with a null return.
      entries.push({
        id,
        packName: project.packName || fromRegistry?.packName || 'Untitled pack',
        decalCount: project.decals.length,
        lastEditedAt: fromRegistry?.lastEditedAt ?? project.modifiedAt ?? '',
        thumbnail: fromRegistry?.thumbnail ?? null,
      })
    }
  } catch {
    /* swallow — non-critical */
  }
  // ISO-string sort: lexicographic order matches chronological order for
  // ISO-8601 timestamps, so this is correct without parsing.
  entries.sort((a, b) => (b.lastEditedAt ?? '').localeCompare(a.lastEditedAt ?? ''))
  return entries
}

/** Remove a decal pack from the recent-decal-packs registry AND delete
 *  its per-id snapshot. Used by the "trash" affordance on the Saved
 *  Projects list. Safe to call for an id that's already gone. */
export function removeRecentDecalPack(id: string): void {
  try {
    const entries = readRecent().filter(r => r.id !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
  } catch {
    /* swallow — non-critical */
  }
  try {
    localStorage.removeItem(projectStorageKey(id))
  } catch {
    /* swallow — non-critical */
  }
}

// ───────────────────────────────────────────────────────────────────────────
// File save / load (download + import via drag-drop).
// ───────────────────────────────────────────────────────────────────────────

export function downloadDecalPack(p: Coh2DecalPackProject): void {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${p.packName.replace(/[^a-z0-9_-]+/gi, '_')}.coh2decalpack`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Parse a previously-downloaded `.coh2decalpack` JSON file. Returns null if
 *  the magic header doesn't match (so the caller can try other formats). */
export function tryParseDecalPackFile(text: string): Coh2DecalPackProject | null {
  try {
    const parsed = JSON.parse(text) as Coh2DecalPackProject
    if (parsed?.magic !== 'coh2-decalpack-project') return null
    return migrateDecalPackProject(parsed)
  } catch {
    return null
  }
}
