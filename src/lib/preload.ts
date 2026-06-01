/**
 * Faction-vehicle preload pipeline.
 *
 * Kicks off when the user picks a faction in `FactionPicker`. Runs in
 * parallel with `NewProjectForm` so by the time the user submits the
 * form, most or all of the faction's RGM + diffuse RGT bytes are warm
 * in JS memory (and in the OS FS cache).
 *
 * What we do
 * ----------
 * 1. Locate `…/CoH2/Archives` once (cached).
 * 2. Open the small set of SGAs that are likely to contain the faction's
 *    vehicle meshes/textures. Each SGA is parsed once and cached in a
 *    module-level Map keyed by filename — Viewport reads from this same
 *    cache via `getPreloadedArchive`, so subsequent vehicle loads skip
 *    the ~hundred-MB TOC parse.
 * 3. For each vehicle in the faction, fetch the RGM bytes (and a best-
 *    guess diffuse RGT) and stash them in a path → bytes map.
 *
 * The function is idempotent — calling it twice for the same faction is
 * cheap (everything is cache-hit). Calling for a different faction
 * preserves the prior caches; we never evict.
 *
 * Errors during preload are non-fatal. We log them and continue. The
 * worst case is that Viewport falls back to its existing SGA-search
 * path on demand (no regression).
 */

import { locateArchives } from './coh2-fs'
import { SgaArchive } from './sga'
import { getBlueprintIndex } from './blueprint-resolver'
import { VEHICLES, rgmPath, type Faction, type VehicleSpec } from './vehicles'

/** Per-faction list of SGAs worth opening. Order isn't critical. */
const FACTION_SGAS: Record<Faction, string[]> = {
  german: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtGermanEF.sga'],
  west_german: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtWestGerman.sga'],
  soviet: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtSovietEF.sga'],
  aef: [
    'ArtHigh.sga',
    'ArtHighXP1.sga',
    'ArtHighXP2.sga',
    'ArtArmies.sga',
    'ArtAEF.sga',
    'ArtAEFSkins.sga',
  ],
  british: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga', 'ArtBritish.sga'],
}

// ── Module-level caches ────────────────────────────────────────────────────
// Keyed by SGA filename (e.g. "ArtGermanEF.sga"). Survives across renders
// for the lifetime of the page.
const archiveCache = new Map<string, SgaArchive>()
// Keyed by full SGA path (e.g. "art/armies/german/vehicles/tiger/tiger.rgm").
// Lower-cased to match SGA's internal canonicalisation.
const bytesCache = new Map<string, Uint8Array>()

/** Look up a cached archive without forcing a load — Viewport uses this. */
export function getPreloadedArchive(name: string): SgaArchive | null {
  return archiveCache.get(name) ?? null
}

/** Look up cached bytes for a full SGA-relative path. */
export function getPreloadedBytes(path: string): Uint8Array | null {
  return bytesCache.get(path.toLowerCase()) ?? null
}

/** Stash an archive in the cache. Used by both this module and (optionally)
 *  Viewport to share its on-demand opens with the next preload run. */
export function cacheArchive(name: string, archive: SgaArchive): void {
  if (!archiveCache.has(name)) archiveCache.set(name, archive)
}

/** Store bytes for a file path so subsequent items skip the IPC read. */
export function cacheBytes(path: string, bytes: Uint8Array): void {
  const key = path.toLowerCase()
  if (!bytesCache.has(key)) bytesCache.set(key, bytes)
}

export interface PreloadProgress {
  /** Phase: opening archives, then reading vehicle bytes. */
  phase: 'archives' | 'vehicles' | 'done'
  /** What's being processed right now (filename or vehicle id). */
  current: string
  /** 0…1, monotonic across phases. */
  fraction: number
}

export interface PreloadResult {
  faction: Faction
  archivesOpened: string[]
  vehiclesPreloaded: string[]
  errors: { path: string; message: string }[]
}

/**
 * Preload SGAs + vehicle RGM bytes for a faction. The promise resolves
 * once everything that *could* be cached has been attempted. Caller can
 * proceed even if some vehicles failed — Viewport falls back gracefully.
 *
 * @param root        the user's CoH2 install handle (from ConnectScreen)
 * @param faction     which faction to preload
 * @param onProgress  optional progress callback (for the loading wheel)
 */
export async function preloadFaction(
  root: FileSystemDirectoryHandle,
  faction: Faction,
  onProgress?: (p: PreloadProgress) => void,
): Promise<PreloadResult> {
  const errors: { path: string; message: string }[] = []
  const archivesOpened: string[] = []
  const vehiclesPreloaded: string[] = []

  const archives = await locateArchives(root).catch(() => null)
  if (!archives) {
    return {
      faction,
      archivesOpened,
      vehiclesPreloaded,
      errors: [{ path: 'Archives', message: 'Archives folder not found' }],
    }
  }

  const sgaNames = FACTION_SGAS[faction]
  // Phase 1 — open archives in parallel so the slow TOC parses overlap.
  // Each open is independent; no shared state until the cache write.
  onProgress?.({ phase: 'archives', current: '', fraction: 0 })
  await Promise.all(
    sgaNames.map(async (name, i) => {
      if (archiveCache.has(name)) {
        archivesOpened.push(name)
        onProgress?.({
          phase: 'archives',
          current: name,
          fraction: 0.05 + (i / sgaNames.length) * 0.45,
        })
        return
      }
      try {
        const fh = await archives.getFileHandle(name)
        const file = await fh.getFile()
        const archive = await SgaArchive.open(file)
        archiveCache.set(name, archive)
        archivesOpened.push(name)
      } catch (e) {
        errors.push({ path: name, message: (e as Error)?.message ?? String(e) })
      }
      onProgress?.({
        phase: 'archives',
        current: name,
        fraction: 0.05 + ((i + 1) / sgaNames.length) * 0.45,
      })
    }),
  )

  // Phase 2 — read each vehicle's RGM bytes from whichever archive contains
  // them. Diffuse RGTs are skipped here because the path requires a parsed
  // RGM to resolve aliases; Viewport's existing flow handles that quickly
  // once the archive is hot in our cache.
  const vehicles: VehicleSpec[] = VEHICLES.filter(v => v.faction === faction)
  const archivesList = sgaNames
    .map(n => archiveCache.get(n))
    .filter((a): a is SgaArchive => a != null)

  // The full [0.5..1.0] range now belongs to vehicle reads — the demo-scene
  // phase that used to occupy the last 5% has been removed (the demo scene
  // itself is gone from the editor).
  const vehiclesShare = 0.5
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i]
    const path = rgmPath(v).toLowerCase()
    onProgress?.({
      phase: 'vehicles',
      current: v.id,
      fraction: 0.5 + (i / vehicles.length) * vehiclesShare,
    })
    if (bytesCache.has(path)) {
      vehiclesPreloaded.push(v.id)
      continue
    }
    let found: Uint8Array | null = null
    for (const a of archivesList) {
      try {
        const b = await a.readByPath(path)
        if (b) {
          found = b
          break
        }
      } catch {
        /* keep trying */
      }
    }
    if (found) {
      bytesCache.set(path, found)
      vehiclesPreloaded.push(v.id)
    } else {
      errors.push({ path, message: 'RGM not found in any preload SGA' })
    }
  }

  onProgress?.({ phase: 'done', current: '', fraction: 1 })
  return { faction, archivesOpened, vehiclesPreloaded, errors }
}

/**
 * Open the always-needed Art*.sga archives plus the scenery-only ones
 * the blueprint resolver scans. Used by App's installRoot effect to warm
 * the cache before the user reaches the faction picker, so by the time
 * the editor mounts:
 *
 *  - per-faction preload only touches its own faction-specific SGA
 *    (ArtHigh* and ArtArmies are already cached)
 *  - the blueprint→RGM index has already been built (one TOC walk
 *    across every scenery archive — ~300 ms when cold), so the entity
 *    upgrade pipeline in Viewport starts swapping stand-ins for real
 *    RGM geometry on its first tick instead of paying that cost during
 *    the user-visible scene load.
 *
 * The SGA opens run in parallel — they're independent, the slow part
 * is each archive's TOC parse, and they overlap cleanly.
 *
 * Idempotent — every call short-circuits on cache hits. Safe to call
 * multiple times (App fires it once per `installRoot` effect run).
 */
const COMMON_ARCHIVES = [
  // Cross-faction vehicle / high-LOD archives — used by every faction's
  // preload, so opening them up front pays off immediately.
  'ArtHigh.sga',
  'ArtHighXP1.sga',
  'ArtHighXP2.sga',
  'ArtArmies.sga',
  // Scenery-bearing archives the blueprint resolver scans for tree /
  // building / fence RGMs. Mission* carry the per-campaign unique props
  // (cathedrals, story buildings); faction Art*EF/AEF/British/WestGerman
  // carry shared structures (HQs, emplacements). Some installs may ship
  // without XP1/XP2 mission archives — absence is non-fatal.
  'ArtMissionXP1.sga',
  'ArtMissionXP2.sga',
  'ArtGermanEF.sga',
  'ArtSovietEF.sga',
  'ArtAEF.sga',
  'ArtBritish.sga',
  'ArtWestGerman.sga',
]

export async function preloadCommonArchives(
  root: FileSystemDirectoryHandle,
  onProgress?: (p: { current: string; fraction: number }) => void,
): Promise<{ opened: string[]; errors: { path: string; message: string }[] }> {
  const errors: { path: string; message: string }[] = []
  const opened: string[] = []
  const archives = await locateArchives(root).catch(() => null)
  if (!archives) {
    return { opened, errors: [{ path: 'Archives', message: 'Archives folder not found' }] }
  }
  // Open every archive in parallel — disk reads overlap, TOC parses
  // are independent, and the per-archive cache write is the only
  // shared state (Map.set is safe under cooperative scheduling).
  let done = 0
  await Promise.all(
    COMMON_ARCHIVES.map(async name => {
      if (archiveCache.has(name)) {
        opened.push(name)
        done++
        onProgress?.({ current: name, fraction: done / COMMON_ARCHIVES.length })
        return
      }
      try {
        const fh = await archives.getFileHandle(name)
        const file = await fh.getFile()
        const archive = await SgaArchive.open(file)
        archiveCache.set(name, archive)
        opened.push(name)
      } catch (e) {
        // Mission/faction archives are sometimes missing on stripped
        // installs — log but don't fail the warm-up.
        errors.push({ path: name, message: (e as Error)?.message ?? String(e) })
      }
      done++
      onProgress?.({ current: name, fraction: done / COMMON_ARCHIVES.length })
    }),
  )

  // With every scenery archive cached, kick off the blueprint→RGM
  // index build. It walks each TOC once and stores the basename /
  // folder maps in module-level state so Viewport's per-blueprint
  // resolution calls are O(1). Fire-and-forget — failures are logged
  // inside getBlueprintIndex and the upgrade pipeline gracefully falls
  // back to stand-in geometry if the index is null.
  void getBlueprintIndex(root).catch(() => null)

  onProgress?.({ current: '', fraction: 1 })
  return { opened, errors }
}

/** Manual cache reset — exported for tests / dev tooling. Not used in prod. */
export function clearPreloadCache() {
  archiveCache.clear()
  bytesCache.clear()
}
