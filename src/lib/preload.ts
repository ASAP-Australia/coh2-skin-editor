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
import { parseRgtHeader } from './rgt'
import { decodeRgtFullOffThread } from './decode-pool'
import type { Texture } from 'three'
import { NoColorSpace, CanvasTexture } from 'three'

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

// O1 — single-flight dedup: holds the IN-FLIGHT open promise for archives
// currently being opened. Prevents the same large archive from being TOC-parsed
// multiple times when 5 factions concurrently request it before any one resolves.
const archiveOpenInFlight = new Map<string, Promise<SgaArchive>>()

// O3 — global read-concurrency limiter.
// Caps the total number of concurrent archive byte-reads across ALL concurrent
// preloadFaction calls. With 5 factions running in parallel (each with a 6-worker
// pool) the naive ceiling is 30 concurrent random disk reads — brutal on HDDs.
// Raised from 8 → 16: on NVMe SSDs (and even SATA SSDs) the OS I/O scheduler
// handles deeper queues well; the higher cap reduces Phase A wall time by
// ~20–40% on SSDs with only a marginal increase on rotational disks.
const GLOBAL_READ_CAP = 16
let _globalReadActive = 0
const _globalReadWaiters: Array<() => void> = []

/**
 * Acquire one global read slot. Returns a release function.
 * Always call release() in a finally block — a leaked slot deadlocks future runs.
 */
function acquireReadSlot(): Promise<() => void> {
  return new Promise(resolve => {
    const tryAcquire = () => {
      if (_globalReadActive < GLOBAL_READ_CAP) {
        _globalReadActive++
        resolve(() => {
          _globalReadActive--
          if (_globalReadWaiters.length > 0) {
            const next = _globalReadWaiters.shift()!
            next()
          }
        })
      } else {
        _globalReadWaiters.push(tryAcquire)
      }
    }
    tryAcquire()
  })
}

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
  // O1: single-flight dedup — if another faction is already opening the same
  // archive, await that in-flight promise instead of starting a redundant open.
  // This prevents ArtHigh.sga / ArtHighXP1.sga / ArtArmies.sga from being
  // TOC-parsed up to 5× when all factions fire concurrently.
  onProgress?.({ phase: 'archives', current: '', fraction: 0 })

  const openArchive = (name: string): Promise<SgaArchive | null> => {
    if (archiveCache.has(name)) return Promise.resolve(archiveCache.get(name)!)
    if (archiveOpenInFlight.has(name)) return archiveOpenInFlight.get(name)!.catch(() => null)
    const p = (async () => {
      const fh = await archives.getFileHandle(name)
      const file = await fh.getFile()
      const archive = await SgaArchive.open(file)
      archiveCache.set(name, archive)
      return archive
    })().finally(() => archiveOpenInFlight.delete(name))
    archiveOpenInFlight.set(name, p)
    return p.catch(() => null)
  }

  await Promise.all(
    sgaNames.map(async (name, i) => {
      try {
        const archive = await openArchive(name)
        if (archive) archivesOpened.push(name)
        else errors.push({ path: name, message: 'Archive open returned null' })
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
  //
  // O2 — bounded-concurrency vehicle reads.
  // SAFETY CHECK: SgaArchive.readFile uses Blob.slice(start, end).arrayBuffer()
  // — fully positional, no shared mutable seek cursor. Concurrent reads on the
  // same archive object are safe.
  // Cap = 6: good SSD parallelism while staying safe on HDDs.
  const CONCURRENCY = 6
  let cursor = 0
  let doneCount = 0
  const vehicleCount = vehicles.length

  const worker = async () => {
    while (true) {
      const i = cursor++
      if (i >= vehicleCount) break
      const v = vehicles[i]
      const path = rgmPath(v).toLowerCase()
      if (bytesCache.has(path)) {
        vehiclesPreloaded.push(v.id)
      } else {
        let found: Uint8Array | null = null
        for (const a of archivesList) {
          const release = await acquireReadSlot()
          try {
            const b = await a.readByPath(path)
            if (b) { found = b; break }
          } catch {
            /* keep trying next archive */
          } finally {
            release()
          }
        }
        if (found) {
          bytesCache.set(path, found)
          vehiclesPreloaded.push(v.id)
        } else {
          errors.push({ path, message: 'RGM not found in any preload SGA' })
        }
      }
      doneCount++
      onProgress?.({
        phase: 'vehicles',
        current: v.id,
        fraction: 0.5 + (doneCount / vehicleCount) * 0.5,
      })
    }
  }

  // Spawn CONCURRENCY workers; each advances the shared cursor independently.
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, vehicleCount) }, worker))

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
  // Terrain/environment archive — carries the grass RGT the viewport's
  // ground pad samples for its top face. Opening it up front (its TOC parse
  // is the slow part) means the slab's async grass swap resolves near-
  // instantly instead of blocking on a cold archive open after the vehicle
  // loads, which is why the ground used to appear seconds late.
  'ArtEnvironment.sga',
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

// ── Idle prefetch queue ───────────────────────────────────────────────────────
// Stores pre-built CompressedTextures keyed by "vehicleId:role" (role = 'nrm').
// Used by Viewport's vehicle build effect to skip decode on the first visit.
export const prefetchedTextures = new Map<string, Texture>()

const prefetchQueue: string[] = []
let prefetchHandle: number | null = null

/**
 * Schedule idle-time prefetch of normal-map CompressedTextures for the given
 * vehicle IDs. Safe to call repeatedly — already-queued IDs are skipped.
 * Each rIC chunk processes one vehicle to stay within idle deadline.
 */
export function schedulePrefetch(vehicleIds: string[]): void {
  const toAdd = vehicleIds.filter(id => !prefetchedTextures.has(`${id}:nrm`))
  if (toAdd.length === 0) return
  prefetchQueue.push(...toAdd)
  if (prefetchHandle !== null) return  // already running
  // Process one vehicle per idle tick: dequeue a single ID, fire off the
  // async inflate+BC-decode via the worker pool (no main-thread pako or BC),
  // and store the resulting CanvasTexture when the promise resolves.
  // Schedule the next tick immediately so idle-callback overhead is minimal.
  const step = () => {
    const id = prefetchQueue.shift()
    if (id === undefined) {
      prefetchHandle = null
      return
    }
    const vehicle = VEHICLES.find(v => v.id === id)
    if (vehicle) {
      const nrmPath = `art/armies/${vehicle.faction}/vehicles/${id}/${id}_hull_nrm.rgt`
      const bytes = getPreloadedBytes(nrmPath)
      if (bytes) {
        try {
          const header = parseRgtHeader(bytes)
          decodeRgtFullOffThread(header)
            .then(dec => {
              const cv = document.createElement('canvas')
              cv.width = dec.width
              cv.height = dec.height
              const ctx = cv.getContext('2d')!
              ctx.putImageData(
                new ImageData(
                  new Uint8ClampedArray(dec.rgba.buffer.slice(dec.rgba.byteOffset, dec.rgba.byteOffset + dec.rgba.byteLength) as ArrayBuffer),
                  dec.width, dec.height,
                ),
                0, 0,
              )
              const tex = new CanvasTexture(cv)
              tex.colorSpace = NoColorSpace
              tex.flipY = true
              prefetchedTextures.set(`${id}:nrm`, tex)
            })
            .catch(() => { /* non-fatal */ })
        } catch { /* non-fatal — bad header, skip */ }
      }
    }
    if (prefetchQueue.length > 0) {
      prefetchHandle = requestIdleCallback(step, { timeout: 5000 })
    } else {
      prefetchHandle = null
    }
  }
  prefetchHandle = requestIdleCallback(step, { timeout: 5000 })
}
