/**
 * `.coh2skin` project format. Stores everything needed to recreate the
 * user's editing state: pack metadata, per-vehicle decal placements,
 * reference-pack selection, and palette overrides.
 *
 * The format is plain JSON wrapped with a magic header for sniffing.
 *
 * Persistence:
 *   - Browser localStorage holds the *active* project so an accidental
 *     refresh never loses work. Each project is stored under a per-id
 *     key (`coh2.project.<id>`), with `coh2-skin-active-project` pointing
 *     at the active id.
 *   - The user explicitly saves to disk via download (`Save .coh2skin`).
 *   - Loading from disk overwrites the active project after a confirm.
 */

import type { CamoPreset } from './camo-generator'
import type { Faction } from './vehicles'
import { VEHICLES } from './vehicles'

/** C3/C5/C6/C7 — reference to the template a pack was seeded from / is
 *  associated with. `kind` mirrors TemplatePicker's TemplateKind. */
export interface ProjectTemplateRef {
  /** 'blank' | a saved project id | 'stock:<faction>/<vehicleId>' | 'workshop:<id>' */
  id: string
  kind: 'blank' | 'saved' | 'stock' | 'workshop'
  /** Human-readable label captured at selection time. */
  name: string
}

export type DecalType = 'shield' | 'number' | 'name' | 'kills' | 'cross' | 'image'
export interface Decal {
  id: number
  type: DecalType
  /** UV pixel coords in 2048 squared space. */
  x: number
  y: number
  /** Rotation in degrees (canvas rotation, applied in UV space). */
  rot: number
  /** Visual size; for text it's font px, for shield/cross it's edge px,
   *  for kills it's the rings column width, for image it's the longest edge. */
  size: number
  /** Per-decal text override (number, name, kills count). If null we use
   *  the project default for this vehicle. */
  text?: string | null
  /** Number of kill rings (kills decals only). */
  kills?: number
  /** For image decals — references a CustomImage by id (we keep the actual
   *  base64 bytes in p.images so multiple decals can share one source). */
  imageId?: string
  /** For image decals — opacity 0-1. */
  opacity?: number
  /** Mirror the decal horizontally. */
  flipH?: boolean
  /** Mirror the decal vertically. */
  flipV?: boolean
}

export interface CustomImage {
  /** Stable id used by image-typed decals to reference this asset. */
  id: string
  /** User-friendly label shown in the library. */
  name: string
  /** Base64-encoded image (data: URL). PNG/JPG/SVG all work. */
  dataUrl: string
  /** Width / height in source pixels — handy for default sizing. */
  width: number
  height: number
  /** True when this image was imported as a pre-drawn decal stamp (not a camo diffuse). */
  isDecalStamp?: boolean
}

/** Per-vehicle decal + camo state. Stored in both the live editing layer
 *  (`project.vehicles`) and inside export slot snapshots (`slot.state.vehicles`). */
export interface VehicleProject {
  /** Vehicle entity id (matches lib/vehicles.ts). */
  id: string
  /** User override for the tac number, falls back to defaultTac. */
  tac: string | null
  /** Vehicle name printed on the hull (italic serif decal). */
  name: string | null
  /** All placed decals for this vehicle, in z-order (later = on top). */
  decals: Decal[]
  /** Per-vehicle main-decal override. Null = use faction default. */
  mainDecalId?: number | null
  /** AI-generated or user-uploaded custom diffuse texture (data URL or path). */
  customDiffuseUrl?: string | null
  /** Procedural camo preset applied to this vehicle. */
  camoPreset?: CamoPreset | null
}

/** Faction-level defaults applied to every vehicle of that faction when no
 *  per-vehicle override exists. Mirrors the VehicleProject shape so
 *  `effectiveCamoPreset` / `effectiveMainDecalId` can use the same merge logic. */
export interface FactionDefault {
  camoPreset: CamoPreset | null
  customDiffuseUrl: string | null
  decals: Decal[]
  mainDecalId: number | null
}

export interface Palette {
  /** Brigade orange — fill colour for numbers AND shield orange band. */
  orange: string
  /** Off-white — outline colour for numbers AND shield middle band. */
  white: string
  /** Dark blue — bottom band of the shield. */
  blue: string
}

/** AI generation session — keyed by session id, stores the prompt + results
 *  so users can browse past generations without re-running. */
export interface GenerationSession {
  id: string
  prompt: string
  /** ISO timestamp. */
  createdAt: string
  results: { imageBase64: string; camoPreset?: CamoPreset }[]
}

/** Slot state snapshot — deep clone of the live vehicles + factionDefaults
 *  taken when the user switches slots. Allows switching between 6 seasonal
 *  colour schemes without losing any work. */
export interface ExportSlotState {
  vehicles: Record<string, VehicleProject>
  factionDefaults: Partial<Record<Faction, FactionDefault | null>>
}

/** One of the 6 export slots (3 summer + 3 winter). Each slot holds an
 *  independent snapshot of the vehicles/decal state so users can author
 *  distinct seasonal camo schemes. */
export interface ExportSlot {
  /** Stable slot id — deterministic from season + slotIdx so it survives
   *  serialise/parse round-trips without UUID generation. */
  id: string
  /** Which seasonal row this slot lives in. */
  season: 'summer' | 'winter'
  /** 0-based position within the seasonal row (0 = left/light, 2 = right/heavy). */
  slotIdx: number
  /** User-editable label. Defaults to e.g. "Summer 1". */
  label: string
  /** Deep-cloned live state at last sync-to-slot. */
  state: ExportSlotState
  /** Which CoH2 factions are represented in this slot's state (derived on sync). */
  factions: Faction[]
  /** Slot-level main-decal override. Null = derive from primary vehicle. */
  mainDecalId?: number | null
  /** Optional user-supplied thumbnail (256x256 data URL). If present, shown
   *  instead of the procedurally composed tile icon. */
  slotIcon?: string | null
  /** Optional long-form description for this slot (shown in the hover card). */
  description?: string
  /** Optional author credit shown on the export tile and in-game preview. */
  authorCredit?: string
}

export interface Coh2SkinProject {
  /** Magic for file sniffing on load. */
  magic: 'coh2-skin-project'
  version: 2
  /** Stable project id — generated once on project creation. */
  id: string
  /** Display title shown in the in-game customization panel. */
  packName: string
  /** Long description (multiline) for the panel. */
  packDescription: string
  /** Author credit. */
  author: string
  /** A2: false on a freshly-created pack so the centre title pill shows the
   *  first-open BorderBeam beam (mirrors decal/faceplate packs); flipped to
   *  true the first time the user opens the title popover. Undefined on
   *  legacy projects = treated as already acknowledged (no beam). */
  titleAcknowledged?: boolean
  /** C3/C6/C7: the template this pack was seeded from / is associated with.
   *  Shown + re-selectable in the centre-title identity popover. `kind`
   *  mirrors TemplatePicker's TemplateKind. Undefined on legacy projects =
   *  treated as a blank canvas. */
  template?: ProjectTemplateRef
  /** Quick-pick reference to a decal pack the user associated with this skin
   *  pack via the bottom-bar decal-pack pill. Decal packs ship as a SEPARATE
   *  CoH2 mod, so this is an association/quick-access record (not merged into
   *  the skin export). Undefined = no decal pack chosen. */
  decalPackRef?: { id: string; name: string }
  /** Decal preview scope chosen via the bottom-bar decal pill. 'vehicle' = preview
   *  the decal only on `decalScopeVehicleId`; 'all' (default when undefined) = preview
   *  on every vehicle. Affects PREVIEW only — decal packs export as a separate mod. */
  decalScope?: 'vehicle' | 'all'
  /** When decalScope === 'vehicle', the vehicle id the decal preview is pinned to. */
  decalScopeVehicleId?: string
  /** Steam Workshop item ID, set after a successful publish via
   *  PublishToWorkshopDialog. Absent / undefined = not yet published.
   *  ≤5×10⁹ = real Workshop ID (safe to call update); ≥1×10¹⁵ = fake
   *  locally-generated ID from freshPackId() (treat as unpublished). */
  workshopId?: string
  /** Per-vehicle state, keyed by vehicle id (live editing layer). */
  vehicles: Record<string, VehicleProject>
  /** Per-faction defaults for the live editing layer. */
  factionDefaults: Partial<Record<Faction, FactionDefault | null>>
  /** Reference pack picked in the editor; null = none. */
  refPackId: string | null
  /** Palette colours (per-pack constant — number and shield share). */
  palette: Palette
  /** Last-edited vehicle id (so we restore where the user left off). */
  lastVehicleId: string | null
  /** Optional ISO timestamp for ordering / display. */
  modifiedAt: string
  /** Custom decal-image library. Persists with the project so loaded
   *  projects bring their decal artwork along. */
  images: Record<string, CustomImage>
  /** Vehicle icon cache (data URLs). Avoids re-extracting from SGAs on reload. */
  vehicleIcons: Record<string, string>
  /** The 6 export slots (3 summer + 3 winter). */
  exportSlots: ExportSlot[]
  /** Index of the currently active export slot. */
  activeSlotIdx: number
  /** AI generation sessions keyed by session id. */
  generationSessions: Record<string, GenerationSession>
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const ACTIVE_ID_KEY = 'coh2-skin-active-project'
const PROJECT_KEY_PREFIX = 'coh2.project.'
const RECENT_KEY = 'coh2.recentProjects'
const RECENT_MAX = 12

export const DEFAULT_PALETTE: Palette = {
  orange: '#B84F12',
  white:  '#C8C0AF',
  blue:   '#1B3A6E',
}

// ---------------------------------------------------------------------------
// ExportSlot helpers
// ---------------------------------------------------------------------------

function makeExportSlot(season: 'summer' | 'winter', slotIdx: number): ExportSlot {
  return {
    id: `${season}-${slotIdx}`,
    season,
    slotIdx,
    label: `${season === 'summer' ? 'Summer' : 'Winter'} ${slotIdx + 1}`,
    state: { vehicles: {}, factionDefaults: {} },
    factions: [],
    mainDecalId: null,
    slotIcon: null,
  }
}

function makeDefaultSlots(): ExportSlot[] {
  return [
    makeExportSlot('summer', 0),
    makeExportSlot('summer', 1),
    makeExportSlot('summer', 2),
    makeExportSlot('winter', 0),
    makeExportSlot('winter', 1),
    makeExportSlot('winter', 2),
  ]
}

// ---------------------------------------------------------------------------
// Project factory
// ---------------------------------------------------------------------------

export function newProject(packName = 'My Skin Pack'): Coh2SkinProject {
  return {
    magic: 'coh2-skin-project',
    version: 2,
    id: 'proj_' + Math.random().toString(36).slice(2, 10),
    packName,
    packDescription: 'A custom CoH2 skin pack made with the community editor.',
    author: 'Anonymous',
    titleAcknowledged: false,
    template: { id: 'blank', kind: 'blank', name: 'Blank canvas' },
    vehicles: {},
    factionDefaults: {},
    refPackId: null,
    palette: { ...DEFAULT_PALETTE },
    lastVehicleId: null,
    modifiedAt: new Date().toISOString(),
    images: {},
    vehicleIcons: {},
    exportSlots: makeDefaultSlots(),
    activeSlotIdx: 0,
    generationSessions: {},
  }
}

// ---------------------------------------------------------------------------
// Template cloning (C5 seed half — pick a template → fresh editable project)
// ---------------------------------------------------------------------------

/** Stock template id format is `stock:<faction>/<vehicleId>`. Parse it back
 *  into its parts, validating against the VEHICLES catalog. Returns null when
 *  the id is malformed or names an unknown vehicle. */
export function parseStockTemplateId(
  id: string,
): { faction: Faction; vehicleId: string } | null {
  if (!id.startsWith('stock:')) return null
  const rest = id.slice('stock:'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  const faction = rest.slice(0, slash)
  const vehicleId = rest.slice(slash + 1)
  const v = VEHICLES.find(x => x.id === vehicleId && x.faction === faction)
  if (!v) return null
  return { faction: v.faction, vehicleId: v.id }
}

/**
 * Parse a workshop template id of the form `workshop:<itemId>::<vehicleId>`.
 * The optional `::<vehicleId>` suffix lets the picker target the vehicle the
 * subscribed camo paints (detected from the archive's internal art paths).
 * Returns null for ids that aren't workshop ids.
 */
export function parseWorkshopTemplateId(
  id: string,
): { itemId: string; vehicleId: string | null } | null {
  if (!id.startsWith('workshop:')) return null
  const rest = id.slice('workshop:'.length)
  const sep = rest.indexOf('::')
  if (sep < 0) return { itemId: rest, vehicleId: null }
  return { itemId: rest.slice(0, sep), vehicleId: rest.slice(sep + 2) || null }
}

/**
 * Produce a FRESH, editable skin project seeded from `template`.
 *
 *   • 'blank'    → an empty project (same as `newProject`), tagged blank.
 *   • 'saved'    → a deep CLONE of the saved project `template.id`: identical
 *                  content (vehicles / palette / images / slots), but a brand
 *                  new `id`, `workshopId` cleared (a clone is unpublished), and
 *                  `template` pointing back at its source. The clone is fully
 *                  independent — mutating it never touches the original.
 *   • 'stock'    → a fresh empty project pre-targeted at the stock vehicle
 *                  (`lastVehicleId`); the stock diffuse loads through the
 *                  editor's normal SGA pipeline when that vehicle opens.
 *   • 'workshop' → not yet supported (TemplatePicker hides the kind); falls
 *                  back to blank so the caller never gets null for a real pick.
 *
 * Returns null ONLY when a 'saved' source id can't be loaded (deleted/corrupt)
 * — callers should fall back to `newProject()` in that case.
 */
export function cloneSkinProjectFromTemplate(
  template: ProjectTemplateRef,
): Coh2SkinProject | null {
  const freshId = () => 'proj_' + Math.random().toString(36).slice(2, 10)

  if (template.kind === 'saved') {
    const source = loadById(template.id)
    if (!source) return null
    const clone: Coh2SkinProject = structuredClone(source)
    clone.id = freshId()
    clone.workshopId = undefined
    clone.titleAcknowledged = false
    clone.modifiedAt = new Date().toISOString()
    clone.template = { id: template.id, kind: 'saved', name: template.name }
    return clone
  }

  if (template.kind === 'stock') {
    const parsed = parseStockTemplateId(template.id)
    const p = newProject()
    p.id = freshId()
    p.template = { id: template.id, kind: 'stock', name: template.name }
    if (parsed) p.lastVehicleId = parsed.vehicleId
    return p
  }

  if (template.kind === 'workshop') {
    // Subscribed in-game camo. We can't yet extract the workshop diffuse as an
    // editable base (that pipeline hasn't landed), so this behaves like the
    // 'stock' path: a fresh project pre-targeted at the vehicle the camo
    // paints, so the editor opens on the right model.
    const parsed = parseWorkshopTemplateId(template.id)
    const p = newProject()
    p.id = freshId()
    p.template = { id: template.id, kind: 'workshop', name: template.name }
    if (parsed?.vehicleId) p.lastVehicleId = parsed.vehicleId
    return p
  }

  // 'blank' fallback.
  const p = newProject()
  p.id = freshId()
  p.template = { id: 'blank', kind: 'blank', name: template.name || 'Blank canvas' }
  return p
}

// ---------------------------------------------------------------------------
// Vehicle + faction-default accessors
// ---------------------------------------------------------------------------

/** Ensure a vehicle entry exists in the project, returning it. */
export function getOrInitVehicle(p: Coh2SkinProject, id: string): VehicleProject {
  if (!p.vehicles[id]) {
    p.vehicles[id] = { id, tac: null, name: null, decals: [] }
  }
  return p.vehicles[id]
}

/** Ensure a faction-default entry exists in the project, returning it. */
export function getOrInitFactionDefault(p: Coh2SkinProject, faction: Faction): FactionDefault {
  if (!p.factionDefaults[faction]) {
    p.factionDefaults[faction] = {
      camoPreset: null,
      customDiffuseUrl: null,
      decals: [],
      mainDecalId: null,
    }
  }
  return p.factionDefaults[faction] as FactionDefault
}

// ---------------------------------------------------------------------------
// Effective-value helpers (vehicle override > faction default > null)
// ---------------------------------------------------------------------------

/** Return the effective CamoPreset for a vehicle: per-vehicle override
 *  first, then faction default, then null. */
export function effectiveCamoPreset(
  p: Coh2SkinProject,
  vehicleId: string,
  faction: Faction,
): CamoPreset | null {
  const v = p.vehicles[vehicleId]
  if (v?.camoPreset !== undefined && v.camoPreset !== null) return v.camoPreset
  return p.factionDefaults[faction]?.camoPreset ?? null
}

/** Return the effective custom diffuse URL for a vehicle. */
export function effectiveCustomDiffuseUrl(
  p: Coh2SkinProject,
  vehicleId: string,
  faction: Faction,
): string | null {
  const v = p.vehicles[vehicleId]
  if (v?.customDiffuseUrl !== undefined && v.customDiffuseUrl !== null) return v.customDiffuseUrl
  return p.factionDefaults[faction]?.customDiffuseUrl ?? null
}

/** Return the effective main decal id for a vehicle. */
export function effectiveMainDecalId(
  p: Coh2SkinProject,
  vehicleId: string,
  faction: Faction,
): number | null {
  const v = p.vehicles[vehicleId]
  if (v?.mainDecalId !== undefined && v.mainDecalId !== null) return v.mainDecalId
  return p.factionDefaults[faction]?.mainDecalId ?? null
}

// ---------------------------------------------------------------------------
// Slot sync helpers
// ---------------------------------------------------------------------------

/** Copy the live vehicles + factionDefaults into the active export slot.
 *  The slot's `state` is replaced with a deep clone so subsequent live edits
 *  don't alias into the snapshot. Also updates `slot.factions`. */
export function syncLiveStateToActiveSlot(p: Coh2SkinProject): void {
  const slot = p.exportSlots[p.activeSlotIdx]
  if (!slot) return
  slot.state = {
    vehicles: structuredClone(p.vehicles),
    factionDefaults: structuredClone(p.factionDefaults),
  }
  // Derive which factions are represented in the snapshot.
  // Use factionDefaults keys as the authoritative faction list —
  // vehicle ids alone don't pin a faction without a catalogue lookup.
  const factionSet = new Set<Faction>()
  for (const f of Object.keys(slot.state.factionDefaults) as Faction[]) {
    factionSet.add(f)
  }
  slot.factions = Array.from(factionSet)
}

/** Restore the live vehicles + factionDefaults from the given slot index,
 *  and update `p.activeSlotIdx`. The live state is replaced with a deep
 *  clone of the slot snapshot. */
export function loadSlotIntoLiveState(p: Coh2SkinProject, slotIdx: number): void {
  const slot = p.exportSlots[slotIdx]
  if (!slot) return
  p.activeSlotIdx = slotIdx
  p.vehicles = structuredClone(slot.state.vehicles)
  p.factionDefaults = structuredClone(slot.state.factionDefaults)
}

// ---------------------------------------------------------------------------
// Image library
// ---------------------------------------------------------------------------

/** Add an image to the library. Returns the new image id. */
export async function addImageFromFile(p: Coh2SkinProject, file: File): Promise<string> {
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
  const id = 'img_' + Math.random().toString(36).slice(2, 10)
  p.images[id] = {
    id, name: file.name || 'pasted-image',
    dataUrl, width: dims.w, height: dims.h,
  }
  return id
}

/** Decode a Blob from a clipboard event (paste) the same way as a file. */
export async function addImageFromBlob(p: Coh2SkinProject, blob: Blob, name = 'pasted'): Promise<string> {
  const file = new File([blob], name + (blob.type === 'image/png' ? '.png' : ''), { type: blob.type })
  return addImageFromFile(p, file)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Save the active project to localStorage under its per-id key AND update
 *  the active-id pointer. Throttled by the caller. */
export function persistActive(p: Coh2SkinProject) {
  try {
    p.modifiedAt = new Date().toISOString()
    localStorage.setItem(ACTIVE_ID_KEY, p.id)
    localStorage.setItem(`${PROJECT_KEY_PREFIX}${p.id}`, JSON.stringify(p))
    trackRecentProject(p)
  } catch (e) {
    console.warn('persistActive failed', e)
  }
}

/** Load the active project from localStorage, or null if none / parse fail. */
export function loadActive(): Coh2SkinProject | null {
  try {
    const id = localStorage.getItem(ACTIVE_ID_KEY)
    if (!id) {
      // Legacy: try the old flat key.
      const raw = localStorage.getItem('coh2-skin-active-project')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (parsed?.magic !== 'coh2-skin-project') return null
      return parsed as Coh2SkinProject
    }
    return loadById(id)
  } catch {
    return null
  }
}

/** Load a project by id from localStorage. Returns null on failure. */
export function loadById(id: string): Coh2SkinProject | null {
  try {
    const raw = localStorage.getItem(`${PROJECT_KEY_PREFIX}${id}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.magic !== 'coh2-skin-project') return null
    return migrateProject(parsed as Coh2SkinProject)
  } catch {
    return null
  }
}

/** Migrate older project versions to the current schema in-place. */
function migrateProject(p: Coh2SkinProject): Coh2SkinProject {
  // Ensure all fields introduced after v1 exist.
  if (!p.id) p.id = 'proj_' + Math.random().toString(36).slice(2, 10)
  if (!p.vehicleIcons) p.vehicleIcons = {}
  if (!p.exportSlots || p.exportSlots.length === 0) p.exportSlots = makeDefaultSlots()
  if (p.activeSlotIdx === undefined) p.activeSlotIdx = 0
  if (!p.generationSessions) p.generationSessions = {}
  if (!p.factionDefaults) p.factionDefaults = {}
  return p
}

// ---------------------------------------------------------------------------
// Recent-projects registry
// ---------------------------------------------------------------------------

/** Entry in the recent-projects registry (capped list for quick display). */
export interface RecentProjectEntry {
  id: string
  name: string
  lastEditedAt: number
  /** Faction of the project (inferred from the first vehicle's faction). */
  faction: Faction
  /** Vehicle count in the project. */
  vehicleCount: number
  /** Data URL of the first vehicleIcon in the cache, or null. */
  thumbnail: string | null
}

/** Read the recent-projects registry from localStorage. */
export function getRecentProjects(): RecentProjectEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as RecentProjectEntry[]
  } catch {
    return []
  }
}

/** Update (or insert) the recent-registry entry for `p`. Caps at RECENT_MAX
 *  entries by evicting the oldest. */
export function trackRecentProject(p: Coh2SkinProject): void {
  try {
    const existing = getRecentProjects()
    const existingEntry = existing.find(e => e.id === p.id)
    // Derive thumbnail: use the first vehicleIcons entry, or preserve the
    // previously-tracked thumbnail when the cache is transiently empty.
    const iconValues = Object.values(p.vehicleIcons)
    const newThumb = iconValues.length > 0 ? iconValues[0] : null
    const thumbnail = newThumb ?? existingEntry?.thumbnail ?? null
    const vehicleCount = Object.keys(p.vehicles).length
    const entry: RecentProjectEntry = {
      id: p.id,
      name: p.packName,
      lastEditedAt: Date.now(),
      // Preserve any faction the UI previously recorded; default to german
      // for projects that have never been faction-tagged.
      faction: existingEntry?.faction ?? 'german',
      vehicleCount,
      thumbnail,
    }
    const filtered = existing.filter(e => e.id !== p.id)
    const next = [entry, ...filtered].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch (e) {
    console.warn('trackRecentProject failed', e)
  }
}

/** Return every healthy skin project stored in localStorage. Walks the
 *  per-id `coh2.project.*` keys (NOT the capped recent registry) so
 *  projects that fell off the recent list still appear. Broken/corrupt
 *  snapshots are silently excluded. Result is sorted by lastEditedAt
 *  descending (newest first). */
export function listAllSkinProjects(): RecentProjectEntry[] {
  const entries: RecentProjectEntry[] = []
  try {
    const cached = new Map<string, RecentProjectEntry>(
      getRecentProjects().map(e => [e.id, e]),
    )
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PROJECT_KEY_PREFIX)) continue
      const id = key.slice(PROJECT_KEY_PREFIX.length)
      const project = loadById(id)
      if (!project) continue
      const fromRegistry = cached.get(id)
      const vehicleCount = Object.keys(project.vehicles).length
      entries.push({
        id: project.id,
        name: project.packName || fromRegistry?.name || 'Untitled pack',
        lastEditedAt:
          fromRegistry?.lastEditedAt ??
          (() => {
            const t = Date.parse(project.modifiedAt ?? '')
            return Number.isFinite(t) ? t : 0
          })(),
        faction: fromRegistry?.faction ?? 'german',
        vehicleCount,
        thumbnail: fromRegistry?.thumbnail ?? null,
      })
    }
  } catch {
    /* swallow — non-critical */
  }
  entries.sort((a, b) => b.lastEditedAt - a.lastEditedAt)
  return entries
}

/** Clear the workshopId from a skin project in localStorage without
 *  otherwise mutating the project or affecting the recent registry. Used
 *  by the "Delete from Workshop" affordance after a successful Workshop
 *  deletion — the project stays local but is treated as unpublished. */
export function clearSkinWorkshopId(id: string): void {
  try {
    const raw = localStorage.getItem(`${PROJECT_KEY_PREFIX}${id}`)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed?.magic !== 'coh2-skin-project') return
    delete parsed.workshopId
    localStorage.setItem(`${PROJECT_KEY_PREFIX}${id}`, JSON.stringify(parsed))
  } catch {
    /* swallow — non-critical */
  }
}

/** Remove a skin project from the recent registry AND delete its per-id
 *  snapshot. Used by the trash affordance on the Saved Projects list. */
export function removeRecentProject(id: string): void {
  try {
    const entries = getRecentProjects().filter(e => e.id !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
  } catch {
    /* swallow */
  }
  try {
    localStorage.removeItem(`${PROJECT_KEY_PREFIX}${id}`)
  } catch {
    /* swallow */
  }
}

// ---------------------------------------------------------------------------
// relTime — tiny relative-time formatter
// ---------------------------------------------------------------------------

/** Format a millisecond timestamp as a human-readable relative time string. */
export function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  const days = Math.floor(d / 86_400_000)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

// ---------------------------------------------------------------------------
// Download / read from disk
// ---------------------------------------------------------------------------

/** Trigger a download of the project as a `.coh2skin` file. */
export function downloadProject(p: Coh2SkinProject) {
  const filename = sanitiseFilename(p.packName) + '.coh2skin'
  const json = JSON.stringify(p, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Read a `.coh2skin` file the user picked from disk. Validates magic. */
export async function readProjectFile(file: File): Promise<Coh2SkinProject> {
  const text = await file.text()
  const parsed = JSON.parse(text)
  if (parsed?.magic !== 'coh2-skin-project') {
    throw new Error('Not a valid .coh2skin file (missing magic header).')
  }
  return migrateProject(parsed as Coh2SkinProject)
}

function sanitiseFilename(s: string) {
  // eslint-disable-next-line no-control-regex -- \x00-\x1f are valid binary control chars to strip from filenames
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '-').slice(0, 64) || 'project'
}
