/**
 * Vehicle silhouette icon resolver.
 *
 * The tile-icon compositor (step 7) needs a small image for the
 * top-left badge. We use the real CoH2 in-game unit portrait icons
 * extracted from UIHigh.sga (see `tools/PORTRAIT_EXTRACTION_NOTES.md`
 * and `tools/write-vehicle-portraits.mts`).
 *
 * Cascade:
 *   1. Project cache (data URL stored on save, survives reloads).
 *   2. Bundled built-in icon under `/icons/vehicles/<id>.png`.
 *      65 of 66 VEHICLES entries have a real CoH2 portrait bundled
 *      in `public/icons/vehicles/` (64×64 px, extracted from the
 *      Scaleform atlas via `tools/extract-portrait-atlas-map.mts` +
 *      `tools/write-vehicle-portraits.mts`). Coverage: 98%.
 *      The fetch tries `/<faction>_<id>.png` first and falls back to
 *      `/<id>.png` — this gives factions that share a filesystem id
 *      (e.g. german/halftrack vs soviet/halftrack, both Lend-Lease /
 *      Sd.Kfz. 251 variants) a way to ship distinct portraits without
 *      changing the on-disk model paths.
 *   3. Stock-SGA probe — extracts symbols from the user's live
 *      CoH2 install via the Scaleform GFX decoder in gfx-bitmaps.ts.
 *      Partial coverage: coh2bob.swf (DLC unit icons) resolves;
 *      coh2ui.gfx (base-game portraits, handled by the bundled
 *      icons in step 2) uses a different encoding path.
 *   4. Offscreen Three.js render (registered at runtime via
 *      `registerThreeRenderer` so this module stays Three-free and
 *      tree-shakes cleanly on the server build).
 *   5. Procedural placeholder — a faction-coloured rounded square
 *      with the vehicle's initial, generated inline as an SVG data
 *      URL. Deterministic, instant, never fails.
 *
 * The cascade is wrapped by `resolveVehicleIcon` which short-circuits
 * on the first hit and writes the result back into the project cache.
 */

import type { Coh2SkinProject } from './project'
import { VEHICLES, type Faction } from './vehicles'
import { FACTION_COLORS } from './factions'
import { SgaArchive } from './sga'
import { locateArchives } from './coh2-fs'
import { extractGfxBitmaps, bitmapToDataUrl, type GfxBitmap } from './gfx-bitmaps'

/** Three.js renderer plug — Step 9 registers a callback that produces
 *  a transparent-bg PNG of the vehicle model. Lazy-registered to keep
 *  Three out of this module's import graph. */
type ThreeRendererFn = (vehicleId: string) => Promise<string | null>
let threeRenderer: ThreeRendererFn | null = null
export function registerThreeRenderer(fn: ThreeRendererFn | null): void {
  threeRenderer = fn
}

// ─────────────────────────────────────────────────────────────────────────
// Cache layer — read / write on the project object
// ─────────────────────────────────────────────────────────────────────────

export function getCachedVehicleIcon(p: Coh2SkinProject, vehicleId: string): string | null {
  return p.vehicleIcons[vehicleId] ?? null
}

/** Write to cache. Caller is responsible for triggering a project
 *  persist; we mutate in place so it batches with whatever update is
 *  in flight. */
export function setCachedVehicleIcon(p: Coh2SkinProject, vehicleId: string, dataUrl: string): void {
  p.vehicleIcons[vehicleId] = dataUrl
}

// ─────────────────────────────────────────────────────────────────────────
// Sources — each returns a data URL or null
// ─────────────────────────────────────────────────────────────────────────

/** Try a bundled icon under public/icons/vehicles/. Done with `fetch`
 *  so a 404 short-circuits cleanly without throwing a load error in
 *  the console (we swallow non-200s here).
 *
 *  Faction-prefix priority: when a faction is supplied we try
 *  `<faction>_<vehicleId>.png` FIRST, then fall back to the bare
 *  `<vehicleId>.png`. This prevents an asset collision when two factions
 *  share the same filesystem `id` — e.g. both `german/halftrack`
 *  (Sd.Kfz. 251) and `soviet/halftrack` (Lend-Lease M3) live under the
 *  same `id`, so without the prefix the Soviet entry would silently
 *  pick up the German Sd.Kfz. 251 icon. A faction-prefixed PNG simply
 *  needs to be dropped into `public/icons/vehicles/` to override the
 *  bare-id fallback; if it's absent we degrade gracefully to the
 *  shared icon, then on to the runtime Three.js render, then to the
 *  procedural placeholder.
 *
 *  IMPORTANT: validate the response is actually an image. `vite preview`
 *  and many static hosts (GitHub Pages, Netlify, Cloudflare Pages) serve
 *  the SPA fallback `index.html` with `200 OK` for unknown paths. Without
 *  this guard, an HTML body was being base64-wrapped as a data URL and
 *  handed to `<img src>`, which then rendered the browser's broken-image
 *  icon on every vehicle pill in demo mode. */
async function tryBundledIcon(
  vehicleId: string,
  faction: Faction | null = null,
): Promise<string | null> {
  const candidates: string[] = []
  if (faction) candidates.push(`${faction}_${vehicleId}`)
  candidates.push(vehicleId)
  for (const slug of candidates) {
    const hit = await tryBundledIconSlug(slug)
    if (hit) return hit
  }
  return null
}

/** Inner: fetch + image-validation for a single candidate slug. */
async function tryBundledIconSlug(slug: string): Promise<string | null> {
  try {
    const r = await fetch(`/icons/vehicles/${slug}.png`)
    if (!r.ok) return null
    // SPA fallback guard — only accept genuine image content. We check the
    // server's Content-Type rather than sniffing magic bytes because
    // production builds gzip/encode the body asynchronously and probing
    // bytes here would force a full decode just to reject.
    const ct = r.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/')) return null
    const blob = await r.blob()
    // Belt-and-braces: also verify the blob's MIME type. Some servers send
    // a generic `application/octet-stream` for PNGs and the Blob constructor
    // derives the type from the response's Content-Type header — if both
    // disagree we'd rather drop through to the procedural placeholder than
    // ship a corrupt-looking icon.
    if (blob.type && !blob.type.startsWith('image/')) return null
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

// Memoised stock-SGA symbol table. The first lookup pays the cost of opening
// UIHigh.sga and inflating ~21 MB of zlib-compressed Flash; every subsequent
// lookup is an O(1) Map hit. We cache *failures* too — if the SGA isn't
// reachable on this install, we shouldn't keep retrying on every render.
let stockSymbolPromise: Promise<Map<string, GfxBitmap> | null> | null = null
let stockSymbolRoot: FileSystemDirectoryHandle | null = null

async function loadStockSymbols(
  installRoot: FileSystemDirectoryHandle,
): Promise<Map<string, GfxBitmap> | null> {
  // Re-bind cache when the user switches installs (rare but possible).
  if (stockSymbolRoot !== installRoot) {
    stockSymbolRoot = installRoot
    stockSymbolPromise = null
  }
  if (stockSymbolPromise) return stockSymbolPromise

  stockSymbolPromise = (async () => {
    const archives = await locateArchives(installRoot).catch(() => null)
    if (!archives) return null

    const symbols = new Map<string, GfxBitmap>()
    // coh2bob.swf has the Battle-of-Bulge DLC unit icons (M3 Halftrack, M10
    // Wolverine, Pak Howitzer, doctrine perk icons, etc.). coh2cloud.swf is
    // storefront chrome — we include it for the faction watermark and
    // intel-bulletin icon but it has no unit portraits.
    const sources = ['UIHigh.sga', 'UILow.sga']
    for (const sgaName of sources) {
      try {
        const fh = await archives.getFileHandle(sgaName)
        const file = await fh.getFile()
        const sga = await SgaArchive.open(file)
        for (const path of ['ui/bin/coh2bob.swf', 'ui/bin/coh2cloud.swf']) {
          try {
            const buf = await sga.readByPath(path)
            if (!buf) continue
            const bm = await extractGfxBitmaps(buf)
            for (const [name, b] of bm) {
              if (!symbols.has(name)) symbols.set(name, b)
            }
          } catch {
            // Per-asset failures are tolerated — partial coverage is better
            // than none, and the cascade falls through to the placeholder
            // for any unmatched vehicle.
          }
        }
        // First archive that opens successfully wins; UIHigh and UILow carry
        // the same symbol set (just different resolutions of the atlas DDS).
        if (symbols.size > 0) break
      } catch {
        // Try the next archive
      }
    }
    return symbols.size > 0 ? symbols : null
  })()
  return stockSymbolPromise
}

/** Pick the best symbol name for a given vehicle ID. The naming convention
 *  used by Relic's UI exports puts ability/unit icons under `Icons_units_<id>`
 *  with a `Icons_abilities_*` and `Icons_perks_*` neighbour for related
 *  glyphs. We try a sequence from most-specific to most-permissive. */
function symbolCandidatesForVehicle(vehicleId: string, faction: Faction): string[] {
  return [
    `Icons_units_${vehicleId}`,
    `Icons_portraits_vehicle_${faction}_${vehicleId}_s_portrait`,
    `Icons_portraits_vehicle_${faction}_${vehicleId}_w_portrait`,
    `Icons_portraits_vehicle_${faction}_${vehicleId}_portrait`,
    `Icons_portraits_${faction}_${vehicleId}`,
    `BattleOfTheBulge_vehicle_${faction}_${vehicleId}`,
  ]
}

/** Stock-SGA extractor.
 *
 *  Pulls unit/portrait bitmaps from the user's CoH2 install via the
 *  Scaleform GFX/SWF decoder in `src/lib/gfx-bitmaps.ts`.
 *
 *  Coverage note: base-game vehicle portraits (Tiger, Panther, etc.)
 *  from `coh2ui.gfx` are handled by the bundled PNG icons in
 *  `public/icons/vehicles/` (step 2), which short-circuits before
 *  this step for those vehicles. This step adds coverage for DLC-era
 *  unit icons from `coh2bob.swf` (`Icons_units_*` symbols) that
 *  aren't in the bundled set. These use standard zlib-compressed SWF
 *  with inline DefineBitsLossless2 bitmaps, which extractGfxBitmaps()
 *  handles natively.
 *
 *  Unresolved vehicles fall through to `tryThreeRender` (live 3D
 *  thumbnail) or the procedural silhouette placeholder. */
async function tryStockSgaIcon(
  installRoot: FileSystemDirectoryHandle | null,
  vehicleId: string,
  faction: Faction,
): Promise<string | null> {
  if (!installRoot) return null
  try {
    const symbols = await loadStockSymbols(installRoot)
    if (!symbols) return null
    for (const candidate of symbolCandidatesForVehicle(vehicleId, faction)) {
      const bm = symbols.get(candidate)
      if (bm) return await bitmapToDataUrl(bm)
    }
    // Case-insensitive fallback — Relic mixes Pascal_Case and lower_case.
    const wantedLowers = symbolCandidatesForVehicle(vehicleId, faction).map(s => s.toLowerCase())
    for (const [name, bm] of symbols) {
      if (wantedLowers.includes(name.toLowerCase())) return await bitmapToDataUrl(bm)
    }
    return null
  } catch {
    return null
  }
}

/** Offscreen Three.js render. Delegates to the registered callback;
 *  if no renderer is set (e.g. during SSR or before the viewport is
 *  ready), returns null. */
async function tryThreeRender(vehicleId: string): Promise<string | null> {
  if (!threeRenderer) return null
  try {
    return await threeRenderer(vehicleId)
  } catch {
    return null
  }
}

/** Last-resort procedural placeholder. Faction-coloured rounded square
 *  with a vehicle-class silhouette and the display-name initial, rendered
 *  as an inline SVG and returned as a data URL. Deterministic per
 *  `(vehicleId, faction)` so the UI is consistent run-to-run.
 *
 *  The silhouette is a stylised tank/halftrack/plane shape (chosen from
 *  `VehicleSpec.class`) that gives the user at-a-glance recognition of
 *  the vehicle type without needing the actual Relic UI portrait. The
 *  initial sits below the silhouette as a secondary identifier when
 *  several heavy tanks (e.g. Tiger, IS-2, Pershing) need to be told
 *  apart in the same panel. */
export function procedurallyDrawIcon(vehicleId: string, faction: Faction): string {
  const spec = VEHICLES.find(v => v.id === vehicleId)
  const initial = (spec?.displayName ?? vehicleId).trim()[0]?.toUpperCase() ?? '?'
  const fill = FACTION_COLORS[faction] ?? 'oklch(0.4 0 0)'
  const silhouette = silhouetteFor(spec?.class ?? 'medium')
  // Use SVG (not canvas) so the result is crisp at any resolution and
  // doesn't depend on devicePixelRatio. Encoded as a data URL so it
  // can drop into an <img src> or be passed to drawImage().
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    `<rect width="64" height="64" rx="10" ry="10" fill="${fill}"/>`,
    // Subtle inner glow so the silhouette has something to read against.
    `<rect x="3" y="3" width="58" height="58" rx="8" ry="8" `,
    `fill="none" stroke="white" stroke-opacity="0.08" stroke-width="1"/>`,
    silhouette,
    // Initial as a small badge in the bottom-right corner.
    `<text x="56" y="58" text-anchor="end" dominant-baseline="alphabetic" `,
    `font-family="system-ui, -apple-system, Segoe UI, sans-serif" `,
    `font-size="14" font-weight="700" fill="white" opacity="0.85">${escapeXml(initial)}</text>`,
    `</svg>`,
  ].join('')
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** Pick a silhouette path matching the vehicle class.
 *
 *  Each silhouette is rendered in a stylised top-down view at 80%
 *  opacity white so it reads against any faction colour. The shapes are
 *  intentionally simple — we're communicating *category* (heavy / medium
 *  / light / utility / super-heavy / aircraft) at a glance, not trying
 *  to depict a specific model. */
function silhouetteFor(cls: 'heavy' | 'medium' | 'light' | 'utility' | 'super_heavy'): string {
  const stroke = 'white'
  const fill = 'white'
  const opacity = '0.78'
  // Common open/close to avoid repeating attrs.
  const g = (body: string) =>
    `<g fill="${fill}" stroke="${stroke}" stroke-opacity="${opacity}" fill-opacity="${opacity}" stroke-linejoin="round" stroke-width="0.5">${body}</g>`

  switch (cls) {
    case 'super_heavy':
      // Long, wide hull + boxy casemate (Jagdtiger / Elefant silhouette).
      return g(
        `<rect x="8"  y="22" width="48" height="18" rx="2" />` + // hull
          `<rect x="18" y="14" width="28" height="10" rx="1" />` + // casemate
          `<rect x="42" y="17" width="14" height="4"  />` + // gun
          `<rect x="6"  y="40" width="52" height="3" rx="1" />`, // track
      )
    case 'heavy':
      // Wide hull + round turret + long barrel (Tiger / IS-2).
      return g(
        `<rect  x="10" y="24" width="44" height="16" rx="2" />` + // hull
          `<circle cx="26" cy="24" r="8" />` + // turret
          `<rect  x="32" y="22" width="22" height="4" />` + // barrel
          `<rect  x="8"  y="40" width="48" height="3" rx="1" />`, // track
      )
    case 'medium':
      // Slimmer hull + medium turret (T-34 / Sherman).
      return g(
        `<rect  x="12" y="26" width="40" height="14" rx="2" />` + // hull
          `<circle cx="26" cy="26" r="7" />` + // turret
          `<rect  x="32" y="24" width="18" height="3" />` + // barrel
          `<rect  x="10" y="40" width="44" height="3" rx="1" />`, // track
      )
    case 'light':
      // Small hull + small turret + short barrel (Stuart / Luchs).
      return g(
        `<rect  x="16" y="28" width="32" height="12" rx="2" />` + // hull
          `<circle cx="28" cy="28" r="5" />` + // turret
          `<rect  x="32" y="27" width="12" height="2.5" />` + // barrel
          `<rect  x="14" y="40" width="36" height="3" rx="1" />`, // track
      )
    case 'utility':
      // Halftrack-style: cab + open bed, half wheels half tracks.
      return g(
        `<rect x="12" y="22" width="14" height="16" rx="2" />` + // cab
          `<rect x="26" y="26" width="24" height="12" rx="1" />` + // bed
          `<circle cx="16" cy="42" r="3" />` + // front wheel
          `<rect  x="28" y="40" width="22" height="3" rx="1" />`, // rear track
      )
    default:
      return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Cascade orchestrator
// ─────────────────────────────────────────────────────────────────────────

interface ResolveOpts {
  /** Required to probe the stock install archive. If null we skip
   *  that source entirely. */
  installRoot?: FileSystemDirectoryHandle | null
  /** When true (default), persist the resolved icon back into
   *  `project.vehicleIcons` so subsequent lookups are O(1). Set to
   *  false for one-off use (e.g. rendering a preview that shouldn't
   *  pollute the saved project). */
  cache?: boolean
}

/** Resolve the best icon available for a vehicle, going through every
 *  source in order. Always returns *something* — the procedural
 *  placeholder is the floor. */
export async function resolveVehicleIcon(
  project: Coh2SkinProject,
  vehicleId: string,
  faction: Faction,
  opts: ResolveOpts = {},
): Promise<string> {
  const cache = opts.cache ?? true

  // 1. Cache
  const cached = getCachedVehicleIcon(project, vehicleId)
  if (cached) return cached

  // 2. Bundled icon (cheap fetch — short-circuits on 404). The
  //    resolver tries `<faction>_<id>.png` first so two factions
  //    sharing the same filesystem id (e.g. german/halftrack vs
  //    soviet/halftrack) can carry distinct portraits.
  const bundled = await tryBundledIcon(vehicleId, faction)
  if (bundled) {
    if (cache) setCachedVehicleIcon(project, vehicleId, bundled)
    return bundled
  }

  // 3. Stock-SGA probe — extracts from the user's UIHigh.sga via the
  //    Scaleform GFX decoder. Partial coverage (see tryStockSgaIcon's
  //    docstring), but free per-vehicle wins for the icons we can read.
  const stock = await tryStockSgaIcon(opts.installRoot ?? null, vehicleId, faction)
  if (stock) {
    if (cache) setCachedVehicleIcon(project, vehicleId, stock)
    return stock
  }

  // 4. Three.js render (set up in step 9)
  const rendered = await tryThreeRender(vehicleId)
  if (rendered) {
    if (cache) setCachedVehicleIcon(project, vehicleId, rendered)
    return rendered
  }

  // 5. Procedural placeholder — never null
  return procedurallyDrawIcon(vehicleId, faction)
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error ?? new Error('FileReader failed'))
    r.readAsDataURL(blob)
  })
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    c =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  )
}
