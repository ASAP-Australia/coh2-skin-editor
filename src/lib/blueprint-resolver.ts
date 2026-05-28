/**
 * Blueprint name → RGM path resolver.
 *
 * CoH2 SGB scenes only carry blueprint *names* (e.g. `pine_russia_spring_01`,
 * `cottage_eastfront_01`). The matching `.ebps` blueprint lives in `Data.sga`
 * and references a model path; following that link properly means parsing
 * the binary blueprint table — which we don't (yet) have a parser for.
 *
 * Pragmatic alternative: scan the art SGAs for any RGM whose folder or
 * basename matches the blueprint name, then return the first hit. CoH2's
 * art tree is consistently `art/scenery/<group>/<name>/<name>.rgm`, so
 * this resolves the vast majority of placeable scenery in one TOC scan
 * per archive.
 *
 * The index is built lazily on first call and cached in a module-level
 * Map for the lifetime of the page. Subsequent calls are O(1) lookups.
 */

import { locateArchives } from './coh2-fs'
import { SgaArchive } from './sga'
import { getPreloadedArchive, cacheArchive } from './preload'

/** SGAs likely to contain scenery / structure RGMs. Ordered most-likely
 *  first so the index walk hits the densest archive early. */
const SCENERY_SGAS = [
  'ArtHigh.sga',
  'ArtHighXP1.sga',
  'ArtHighXP2.sga',
  // Mission-specific archives carry per-campaign scenery (cathedrals,
  // unique buildings, story props).
  'ArtMissionXP1.sga',
  'ArtMissionXP2.sga',
  // Faction archives sometimes carry shared structures (HQ buildings,
  // emplacements).
  'ArtArmies.sga',
  'ArtGermanEF.sga',
  'ArtSovietEF.sga',
  'ArtAEF.sga',
  'ArtBritish.sga',
  'ArtWestGerman.sga',
]

/** Patterns that flag an RGM as a destroyed/proxy/effect variant — we
 *  exclude these from the index so we don't accidentally resolve a
 *  blueprint to its "wreck" mesh. */
const SKIP_PATH_PATTERNS = [
  /\bdestroyed\b/i,
  /\bdestruction\b/i,
  /\bwreck\b/i,
  /\bproxy\b/i,
  /\bcollision\b/i,
  /\bphysics\b/i,
  /\bshadow\b/i,
  /\bremains\b/i,
]

interface IndexEntry {
  /** Lower-cased SGA-relative path, forward slashes. */
  path: string
  /** SGA filename ("ArtHigh.sga"). */
  sga: string
}

interface BlueprintIndex {
  /** Map: lower-cased basename (without `.rgm`) → first match. CoH2 RGMs
   *  follow `<dir>/<name>/<name>.rgm`, so the basename is the typical
   *  blueprint key. */
  byBasename: Map<string, IndexEntry>
  /** Map: lower-cased *folder name* → first match. Some blueprints are
   *  named after the folder (`cottage_01` is the folder, file may be
   *  `cottage_01_main.rgm`); covers that variant. */
  byFolder: Map<string, IndexEntry>
}

let indexPromise: Promise<BlueprintIndex | null> | null = null

/**
 * Lazily build (and cache) the global blueprint→RGM index. First call
 * pays the cost of opening every art SGA's TOC (~300 ms total for 6
 * archives, dominated by the largest); subsequent calls return the
 * cached map immediately.
 *
 * Returns null if the user's install can't be located — caller falls
 * back to the stand-in geometry path.
 */
export function getBlueprintIndex(root: FileSystemDirectoryHandle): Promise<BlueprintIndex | null> {
  if (indexPromise) return indexPromise
  indexPromise = buildIndex(root).catch(e => {
    console.warn('[blueprint-resolver] index build failed:', e)
    return null
  })
  return indexPromise
}

async function buildIndex(root: FileSystemDirectoryHandle): Promise<BlueprintIndex | null> {
  const archives = await locateArchives(root).catch(() => null)
  if (!archives) return null

  const byBasename = new Map<string, IndexEntry>()
  const byFolder = new Map<string, IndexEntry>()

  for (const sgaName of SCENERY_SGAS) {
    let archive = getPreloadedArchive(sgaName)
    if (!archive) {
      try {
        const fh = await archives.getFileHandle(sgaName)
        const file = await fh.getFile()
        archive = await SgaArchive.open(file)
        cacheArchive(sgaName, archive)
      } catch {
        // SGA not present in this install (e.g. missing campaign).
        continue
      }
    }

    const files = archive.list()
    for (const f of files) {
      if (!f.path.toLowerCase().endsWith('.rgm')) continue
      const path = f.path.toLowerCase().replace(/\\/g, '/')
      if (SKIP_PATH_PATTERNS.some(re => re.test(path))) continue

      const segs = path.split('/')
      const file = segs[segs.length - 1]
      const basename = file.replace(/\.rgm$/, '')
      const folder = segs.length >= 2 ? segs[segs.length - 2] : ''

      const entry: IndexEntry = { path, sga: sgaName }
      if (basename && !byBasename.has(basename)) byBasename.set(basename, entry)
      if (folder && !byFolder.has(folder)) byFolder.set(folder, entry)
    }
  }

  // (Verbose index-summary log removed for v1.0 — the resolver is a hot
  // startup path and the summary was only useful while debugging RGM
  // discovery. Failure paths in the callers still warn.)
  return { byBasename, byFolder }
}
