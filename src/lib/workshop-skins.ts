/**
 * workshop-skins.ts — faction-tag the user's *subscribed* Steam Workshop skin
 * archives so they can appear in the inventory-style template picker alongside
 * the stock game camos.
 *
 * WHY: request #3 ("any camo that appears in my inventory in game for that
 * faction") covers BOTH the stock game skins AND the workshop camos the user
 * is subscribed to. The stock half is handled statically by stock-skins.ts.
 * The workshop half needs real archive inspection: a `WorkshopItem` from the
 * native bridge carries only `{ id, dir, sgaPath }` — no faction — so we crack
 * each `.sga` open, read its TOC paths, and infer the faction(s) and target
 * vehicle(s) from the canonical engine layout:
 *
 *     art/armies/<faction>/vehicles/<folder>/...
 *
 * DETECTION ONLY — no payloads are decompressed. `SgaArchive.open()` parses the
 * table-of-contents lazily (a few KB of ranged IPC reads), then `listPaths()`
 * gives every internal path string. We regex those for the armies layout. This
 * keeps the popular case (a handful of subscribed skins) cheap enough to run
 * when the identity popover opens.
 *
 * RESULT CACHE: scanning is memoised at module scope keyed by the workshop
 * root, because the popover can mount/unmount repeatedly and the subscribed set
 * rarely changes within a session. Call {@link clearWorkshopSkinCache} after a
 * (re)subscribe if a refresh is ever needed.
 */

import { detectWorkshopPath, listWorkshopItems, nativeFileFromPath } from '@/lib/native-fs'
import { SgaArchive } from '@/lib/sga'
import { VEHICLES, vehicleFolder, type Faction } from '@/lib/vehicles'

// Engine faction tokens as they appear under art/armies/<token>/.
const FACTION_TOKENS: Faction[] = ['german', 'west_german', 'soviet', 'aef', 'british']
const FACTION_TOKEN_SET = new Set<string>(FACTION_TOKENS)

/** Matches `art/armies/<faction>/vehicles/<folder>/` anywhere in a path. */
const ARMIES_RE = /art\/armies\/([a-z_]+)\/vehicles\/([^/]+)\//i

export interface WorkshopSkin {
  /** Picker id: `workshop:<numericId>`. */
  id: string
  /** Numeric Workshop item id. */
  itemId: string
  /** Display label, e.g. "Workshop #1234567890". */
  name: string
  /** Absolute path to the backing .sga. */
  sgaPath: string
  /** Faction(s) the archive paints. Usually one; multi-faction packs exist. */
  factions: Faction[]
  /** Catalogue vehicle ids detected inside the archive (best-effort). */
  vehicleIds: string[]
}

// Reverse map: on-disk folder → catalogue vehicle id (folder-alias aware).
// Built once. Multiple ids can share a folder only across factions; we keep
// the first and rely on faction filtering downstream to disambiguate.
const FOLDER_TO_VEHICLE = (() => {
  const m = new Map<string, string>()
  for (const v of VEHICLES) {
    const f = vehicleFolder(v.id)
    if (!m.has(f)) m.set(f, v.id)
  }
  return m
})()

/**
 * Inspect one workshop archive: open its TOC and infer faction(s) + vehicle(s)
 * from internal `art/armies/...` paths. Returns null when the archive can't be
 * opened or contains no recognisable army art (e.g. a non-skin mod).
 */
async function inspectArchive(item: { id: string; sgaPath: string }): Promise<WorkshopSkin | null> {
  let file: File | null
  try {
    file = await nativeFileFromPath(item.sgaPath)
  } catch {
    return null
  }
  if (!file) return null

  let paths: string[]
  try {
    const archive = await SgaArchive.open(file)
    paths = archive.listPaths()
  } catch (e) {
    console.warn('[workshop-skins] failed to open', item.sgaPath, e)
    return null
  }

  const factions = new Set<Faction>()
  const vehicleIds = new Set<string>()
  for (const p of paths) {
    const m = ARMIES_RE.exec(p.replace(/\\/g, '/'))
    if (!m) continue
    const tok = m[1].toLowerCase()
    if (!FACTION_TOKEN_SET.has(tok)) continue
    factions.add(tok as Faction)
    const veh = FOLDER_TO_VEHICLE.get(m[2].toLowerCase())
    if (veh) vehicleIds.add(veh)
  }

  if (factions.size === 0) return null

  return {
    id: `workshop:${item.id}`,
    itemId: item.id,
    name: `Workshop #${item.id}`,
    sgaPath: item.sgaPath,
    factions: [...factions],
    vehicleIds: [...vehicleIds],
  }
}

// Module-scope memo keyed by workshop root.
const cache = new Map<string, Promise<WorkshopSkin[]>>()

/** Drop the memoised scan (e.g. after the user subscribes to new content). */
export function clearWorkshopSkinCache(): void {
  cache.clear()
}

/**
 * Enumerate the user's subscribed workshop skin archives, faction-tagged.
 *
 * Returns [] outside Electron, when no workshop folder is found, or when no
 * subscribed item is a recognisable skin archive. Results are memoised per
 * workshop root for the session.
 */
export async function listWorkshopSkins(): Promise<WorkshopSkin[]> {
  const root = await detectWorkshopPath()
  if (!root) return []

  const cached = cache.get(root)
  if (cached) return cached

  const job = (async () => {
    const items = await listWorkshopItems(root)
    const withSga = items.filter(
      (i): i is { id: string; dir: string; sgaPath: string } => !!i.sgaPath,
    )
    const inspected = await Promise.all(
      withSga.map(i => inspectArchive({ id: i.id, sgaPath: i.sgaPath })),
    )
    return inspected.filter((s): s is WorkshopSkin => s !== null)
  })()

  cache.set(root, job)
  try {
    return await job
  } catch (e) {
    // Don't poison the cache on transient failure — allow a later retry.
    cache.delete(root)
    console.warn('[workshop-skins] scan failed', e)
    return []
  }
}

/**
 * Faction-filtered convenience: only the workshop skins that paint `faction`.
 * When `faction` is undefined (legacy callers/tests) every detected skin is
 * returned.
 */
export async function listWorkshopSkinsForFaction(faction?: Faction): Promise<WorkshopSkin[]> {
  const all = await listWorkshopSkins()
  if (!faction) return all
  return all.filter(s => s.factions.includes(faction))
}
