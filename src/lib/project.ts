/**
 * `.coh2skin` project format. Stores everything needed to recreate the
 * user's editing state: pack metadata, per-vehicle decal placements,
 * reference-pack selection, and palette overrides.
 *
 * The format is plain JSON wrapped with a magic header for sniffing.
 *
 * Persistence:
 *   - Browser localStorage holds the *active* project so an accidental
 *     refresh never loses work.
 *   - The user explicitly saves to disk via download (`Save .coh2skin`).
 *   - Loading from disk overwrites the active project after a confirm.
 */

export type DecalType = 'shield' | 'number' | 'name' | 'kills' | 'cross'
export interface Decal {
  id: number
  type: DecalType
  /** UV pixel coords in 2048² space. */
  x: number
  y: number
  /** Rotation in degrees (canvas rotation, applied in UV space). */
  rot: number
  /** Visual size; for text it's font px, for shield/cross it's edge px,
   *  for kills it's the rings column width. */
  size: number
  /** Per-decal text override (number, name, kills count). If null we use
   *  the project default for this vehicle. */
  text?: string | null
  /** Number of kill rings (kills decals only). */
  kills?: number
}

export interface VehicleProject {
  /** Vehicle entity id (matches lib/vehicles.ts). */
  id: string
  /** User override for the tac number, falls back to defaultTac. */
  tac: string | null
  /** Vehicle name printed on the hull (italic serif decal). */
  name: string | null
  /** All placed decals for this vehicle, in z-order (later = on top). */
  decals: Decal[]
}

export interface Palette {
  /** Brigade orange — fill colour for numbers AND shield orange band. */
  orange: string
  /** Off-white — outline colour for numbers AND shield middle band. */
  white: string
  /** Dark blue — bottom band of the shield. */
  blue: string
}

export interface Coh2SkinProject {
  /** Magic for file sniffing on load. */
  magic: 'coh2-skin-project'
  version: 1
  /** Display title shown in the in-game customization panel. */
  packName: string
  /** Long description (multiline) for the panel. */
  packDescription: string
  /** Author credit. */
  author: string
  /** Per-vehicle state, keyed by vehicle id. */
  vehicles: Record<string, VehicleProject>
  /** Reference pack picked in the editor; null = none. Stored by Steam
   *  Workshop ID (matches the .sga filename stem). */
  refPackId: string | null
  /** Palette colours (per-pack constant — number and shield share). */
  palette: Palette
  /** Last-edited vehicle id (so we restore where the user left off). */
  lastVehicleId: string | null
  /** Optional ISO timestamp for ordering / display. */
  modifiedAt: string
}

const STORAGE_KEY = 'coh2-skin-active-project'

export const DEFAULT_PALETTE: Palette = {
  orange: '#B84F12',
  white:  '#C8C0AF',
  blue:   '#1B3A6E',
}

export function newProject(packName = 'My Skin Pack'): Coh2SkinProject {
  return {
    magic: 'coh2-skin-project',
    version: 1,
    packName,
    packDescription: 'A custom CoH2 skin pack made with the community editor.',
    author: 'Anonymous',
    vehicles: {},
    refPackId: null,
    palette: { ...DEFAULT_PALETTE },
    lastVehicleId: null,
    modifiedAt: new Date().toISOString(),
  }
}

/** Ensure a vehicle entry exists in the project, returning it. */
export function getOrInitVehicle(p: Coh2SkinProject, id: string): VehicleProject {
  if (!p.vehicles[id]) {
    p.vehicles[id] = { id, tac: null, name: null, decals: [] }
  }
  return p.vehicles[id]
}

/** Save the active project to localStorage. Throttled by the caller. */
export function persistActive(p: Coh2SkinProject) {
  try {
    p.modifiedAt = new Date().toISOString()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch (e) {
    console.warn('persistActive failed', e)
  }
}

/** Load the active project from localStorage, or null if none / parse fail. */
export function loadActive(): Coh2SkinProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.magic !== 'coh2-skin-project') return null
    return parsed as Coh2SkinProject
  } catch {
    return null
  }
}

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
  return parsed as Coh2SkinProject
}

function sanitiseFilename(s: string) {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '-').slice(0, 64) || 'project'
}
