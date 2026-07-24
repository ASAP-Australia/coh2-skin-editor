/**
 * High-level "Export skin pack" pipeline.
 *
 * Inputs:
 *   - The user's project (decal placements + custom images + palette)
 *   - The user's CoH2 install handle (so we can read the vanilla diffuse
 *     for each vehicle and composite decals on top)
 *   - The bundled template files (info, .rgd, .ucs) we extracted from a
 *     working Workshop pack and ship in `public/template/`
 *
 * Output:
 *   - A complete .sga byte stream the user drops into
 *     `…/Documents/My Games/Company of Heroes 2/mods/skins/`
 *
 * Mod identification:
 *   We generate a fresh 32-hex-char modguid per export, so successive
 *   exports never collide with each other or the template's source mod.
 *   The modguid is woven into:
 *       - the .info filename
 *       - every skin-pack texture path
 *       - the UI icon filename (if any)
 *       - the .info content (where the template referenced its old guid)
 *
 * Texture compositing path:
 *   1. Open the relevant SGA in the user's CoH2 install (ArtHigh / ArtArmies)
 *   2. Extract the vanilla diffuse RGT
 *   3. Software-decode BC1/BC3 → 2D canvas
 *   4. Paint the user's decals on top via decal-painter
 *   5. Re-encode the canvas back to BC3 → RGT
 *   6. Write the RGT into the SGA at the canonical path
 */

import { locateArchives } from './coh2-fs'
import { SgaArchive } from './sga'
import { decodeRgt } from './rgt'
import { bcToCanvas } from './bc-decode'
import { canvasToRgt } from './rgt-writer'
import { buildSga, type SgaInputFile } from './sga-writer'
import { paintDecals, preloadDecalImages, type RenderContext } from './decal-painter'
import { findVehicleSpec, inferProjectFactions, vehicleFolder, vehiclesForFaction, rgmPath, type Faction } from './vehicles'
import type { Coh2SkinProject } from './project'
import { effectiveCustomDiffuseUrl, effectiveCamoPreset } from './project'
import { generateCamo, applyWeathering, CAMO_OVERLAY_ALPHA } from './camo-generator'
import { parseRgm } from './rgm'
import { buildCamoExclusionMask } from './camo-mask'
import { compositeIconAtlas } from './icon-atlas-composite'

const TEMPLATE_GUID = '935a02ef44344ea29108b57b9cb7b9f5'
const TEMPLATE_FILES = [
  '935a02ef44344ea29108b57b9cb7b9f5.info',
  'attrib/skin_pack/german/caf_ss3_summer_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_light.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_medium.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_light.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_medium.rgd',
  'english/english.ucs',
  `ui/bin/${TEMPLATE_GUID}.gfx`,
  `ui/assets/textures/${TEMPLATE_GUID}_i1.dds`,
]

/** Generate a fresh 32-hex-char mod GUID. Cryptographically random. */
export function freshModGuid(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** Generate a fresh numeric pack ID for use as the on-disk filename.
 *
 *  CoH2's engine scans `mods/skins/` for `%I64u.sga` (i.e. unsigned 64-bit
 *  decimal integer + .sga). Anything else — including hex-GUID filenames —
 *  is silently ignored. We pick a value that:
 *    - Is a valid u64 (so the printf scan matches).
 *    - Sits well above the highest live Steam Workshop file ID (~5×10^9 in
 *      late 2025) but well below 2^53 so it round-trips through JS Number.
 *    - Is unlikely to collide with any concurrently-installed Workshop
 *      subscription (Workshop won't allocate IDs in this range any time
 *      soon — Workshop file-ID counter increments by 1 per upload).
 *
 *  We use a millisecond timestamp × 1000 + random salt → ~16 decimal digits,
 *  values around 1.7×10^15 today. Comfortably out of Workshop range and
 *  always unique per export. */
export function freshPackId(): string {
  const now = Date.now()                         // ms since epoch (~1.7e12)
  const salt = Math.floor(Math.random() * 1000)  // 0..999
  return String(now * 1000 + salt)               // ~1.7e15
}

/** SGA archives most likely to contain the diffuse RGTs for a given faction. */
export function factionSgaCandidates(faction: string): string[] {
  switch (faction) {
    case 'german':       return ['ArtGermanEF.sga', 'ArtArmies.sga', 'ArtHigh.sga']
    case 'west_german':  return ['ArtWestGerman.sga', 'ArtHighXP1.sga', 'ArtArmies.sga']
    case 'soviet':       return ['ArtSovietEF.sga', 'ArtArmies.sga', 'ArtHigh.sga']
    case 'aef':          return ['ArtAEFSkins.sga', 'ArtAEF.sga', 'ArtHighXP1.sga']
    case 'british':      return ['ArtBritish.sga', 'ArtHighXP2.sga']
    default:             return ['ArtArmies.sga', 'ArtHigh.sga']
  }
}

// vehicleFolder + VEHICLE_FOLDER_ALIAS moved to ./vehicles so the mesh loader
// (vehicles.rgmPath) can use them without a circular import. Re-exported here
// for existing callers (stock-skins, build-template, tools, tests).
export { vehicleFolder, VEHICLE_FOLDER_ALIAS } from './vehicles'

/**
 * Basename aliases — CoH2 names a handful of textures differently from the
 * vehicle id (e.g. elefant/elefant_hull_dif.rgt, panther_ausf_g/panther_dif.rgt,
 * centaur_aa/centaur_aa_dif.rgt). The read pipeline tries each candidate in
 * order; the write pipeline uses only the first (canonical) entry.
 *
 * Confirmed against official Relic SGA archives (ArtGermanEF, ArtWestGerman,
 * ArtSovietEF, ArtAEFSkins, ArtAEF, ArtBritish).
 */
export function textureBaseNamesFor(vehicleId: string): string[] {
  const aliases: Record<string, string[]> = {
    // Genuine basename-differs-from-id cases (game uses a different name):
    elefant:             ['elefant_hull', 'elefant'],
    ostwind_flak_panzer: ['ostwind', 'ostwind_flak_panzer'],
    sdkfz_222:           ['sdkfz221', 'sdkfz_222'],
    panther_ausf_g:      ['panther', 'panther_ausf_g'],
    halftrack:           ['halftrack', 'halftrack_sdkfz_251'],
    // Folder-alias vehicles: their basename matches the real folder name, not vSpec.id
    centaur:             ['centaur_aa'],
    t_34_85:             ['t_34_85'],       // basename is t_34_85, folder is t34_85
    valentine:           ['valentine_command'],
  }
  return aliases[vehicleId] ?? [vehicleId]
}

export interface ExportProgress {
  phase: 'init' | 'composite' | 'pack' | 'done' | 'error'
  message: string
  current?: number
  total?: number
}

export interface ExportResult {
  bytes: Uint8Array
  /** Suggested download filename. Engine ignores this — it scans on
   *  `<numericId>.sga` only (see freshPackId()). Use `numericId` when
   *  installing in-place. */
  filename: string
  /** Internal 32-hex GUID — woven into RGT subdir names, .info filename,
   *  and the .ucs locale strings. Independent of the on-disk filename. */
  modGuid: string
  /** Numeric u64 pack ID — the filename CoH2's engine actually scans for
   *  (`%I64u.sga` printf pattern in mods\\skins\\). Always use this when
   *  writing the SGA into the user's mods folder. */
  numericId: string
  textureCount: number
}

/**
 * Collect the complete set of vehicle IDs that should appear in the export.
 *
 * This mirrors the logic `effectiveCustomDiffuseUrl` (project.ts) uses for
 * the editor preview — the export must never omit a vehicle that the editor
 * shows as skinned.  Three cases are covered:
 *
 * 1. Per-vehicle entries (`project.vehicles`): included when they have decals
 *    OR a per-vehicle customDiffuseUrl.
 * 2. Unvisited vehicles whose FACTION has a `factionDefaults[f].customDiffuseUrl`
 *    set (via the Generate-modal 'faction' or 'all' scope).  These vehicles
 *    were never navigated to, so they have no `project.vehicles` entry, but
 *    the editor preview correctly shows them skinned — the export must too.
 * 3. Vehicles already in `project.vehicles` are not double-counted even when
 *    they would also match a faction default (Set dedup).
 */
export function collectExportVehicleIds(project: Coh2SkinProject): string[] {
  const ids = new Set<string>()

  // Case 1: per-vehicle entries with something to render. A procedural camo
  // preset (camoPreset) counts too — the export composer regenerates it over
  // the vanilla diffuse, so a camo-only vehicle IS a real, exportable skin
  // (matches the editor preview, which resurrects camo from camoPreset).
  for (const [id, veh] of Object.entries(project.vehicles)) {
    if ((veh?.decals?.length ?? 0) > 0 || !!veh?.customDiffuseUrl || !!veh?.camoPreset) {
      ids.add(id)
    }
  }

  // Case 2: unvisited vehicles covered by a faction-default diffuse OR camo.
  for (const [faction, fd] of Object.entries(project.factionDefaults ?? {})) {
    if (!fd?.customDiffuseUrl && !fd?.camoPreset) continue
    for (const vSpec of vehiclesForFaction(faction as Faction)) {
      // effective{CustomDiffuseUrl,CamoPreset} would return the faction default
      // for this vehicle because it has no per-vehicle override. Include it
      // unless the per-vehicle entry already supplies its own diffuse/camo
      // (which supersedes the faction default and is included above).
      const perVeh = project.vehicles[vSpec.id]
      if (perVeh?.customDiffuseUrl || perVeh?.camoPreset) continue
      ids.add(vSpec.id)
    }
  }

  return Array.from(ids)
}

/**
 * Load + parse the vehicle's RGM from the install and build its armor-only
 * camo exclusion mask (opaque where camo must NOT paint: tracks / wheels /
 * running gear / wreck / stowed equipment). Returns null when the RGM can't be
 * located or the vehicle has no excluded submeshes. Uses the same faction SGA
 * candidate list as the diffuse read (ArtHigh/ArtArmies are in it for meshes).
 */
async function buildVehicleCamoMask(
  vSpec: { id: string; faction: Faction },
  archives: { handle: FileSystemDirectoryHandle; cache: Map<string, SgaArchive> },
): Promise<HTMLCanvasElement | null> {
  const meshPath = rgmPath(vSpec as Parameters<typeof rgmPath>[0])
  for (const sgaName of factionSgaCandidates(vSpec.faction)) {
    let a = archives.cache.get(sgaName)
    if (!a) {
      try {
        const fh = await archives.handle.getFileHandle(sgaName)
        a = await SgaArchive.open(await fh.getFile())
        archives.cache.set(sgaName, a)
      } catch { continue }
    }
    const bytes = await a.readByPath(meshPath)
    if (!bytes) continue
    try {
      const model = parseRgm(bytes)
      return buildCamoExclusionMask(model.meshes, vSpec.id, vSpec.faction)
    } catch (e) {
      console.warn('[mod-export] camo mask: parseRgm failed for', vSpec.id, e)
      return null
    }
  }
  return null
}

/**
 * Restore the pristine vanilla diffuse over the excluded (mask-opaque) UV
 * regions so camo / imported diffuse never lands on tracks / wheels / running
 * gear / wreck / stowed equipment. Draws a vanilla patch clipped to the mask
 * on top of the composited canvas. No-op when mask or vanilla is missing.
 */
export function restoreExcludedRegions(
  ctx: CanvasRenderingContext2D,
  vanilla: HTMLCanvasElement,
  mask: HTMLCanvasElement | null,
  size = 2048,
): void {
  if (!mask) return
  const patch = document.createElement('canvas')
  patch.width = patch.height = size
  const pctx = patch.getContext('2d')!
  pctx.drawImage(vanilla, 0, 0, size, size)
  pctx.globalCompositeOperation = 'destination-in'
  pctx.drawImage(mask, 0, 0, size, size)
  pctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(patch, 0, 0)
}

/**
 * Locate + software-decode a vehicle's VANILLA diffuse RGT from the install into
 * a fresh 2048² canvas. Shared by both the fast (custom-diffuse) and slow
 * (procedural) paths in composeVehicleDiffuse. Returns null when the RGT can't be
 * located (unknown vehicle / missing archive). Tries each faction SGA candidate
 * and each basename alias, exactly as the slow path did inline.
 */
async function decodeVanillaDiffuse(
  vSpec: { id: string; faction: Faction },
  archives: { handle: FileSystemDirectoryHandle; cache: Map<string, SgaArchive> },
): Promise<HTMLCanvasElement | null> {
  const sgaCandidates = factionSgaCandidates(vSpec.faction)
  const baseNames = textureBaseNamesFor(vSpec.id)
  let rgtBytes: Uint8Array | null = null
  outer: for (const sgaName of sgaCandidates) {
    let a = archives.cache.get(sgaName)
    if (!a) {
      try {
        const fh = await archives.handle.getFileHandle(sgaName)
        a = await SgaArchive.open(await fh.getFile())
        archives.cache.set(sgaName, a)
      } catch { continue }
    }
    for (const base of baseNames) {
      const difPath = `art/armies/${vSpec.faction}/vehicles/${vehicleFolder(vSpec.id)}/${base}_dif.rgt`
      const b = await a.readByPath(difPath)
      if (b) { rgtBytes = b; break outer }
    }
  }
  if (!rgtBytes) return null
  const rgt = decodeRgt(rgtBytes)
  const decoded = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
  // Normalise to 2048² so callers can composite/restore at a single resolution.
  const out = document.createElement('canvas')
  out.width = out.height = 2048
  out.getContext('2d')!.drawImage(decoded, 0, 0, 2048, 2048)
  return out
}

/** Compose the live decal canvas for a single vehicle by:
 *   - locating its diffuse RGT in the user's CoH2 install
 *   - software-decoding BC bytes → 2048² 2D canvas
 *   - painting the user's decals on top with decal-painter
 *  Returns null when the vehicle has zero decals AND no custom diffuse
 *  (template-baked or user-uploaded). A template-only vehicle with a
 *  customDiffuseUrl but no placed decals IS exported so the chosen
 *  template skin appears in-game (R5). */
async function composeVehicleDiffuse(
  _root: FileSystemDirectoryHandle,
  project: Coh2SkinProject,
  vehicleId: string,
  archives: { handle: FileSystemDirectoryHandle; cache: Map<string, SgaArchive> },
  factionHints?: Faction[],
): Promise<{ canvas: HTMLCanvasElement; difTset: string } | null> {
  const veh = project.vehicles[vehicleId]
  const vSpec = findVehicleSpec(vehicleId, factionHints)
  if (!vSpec) return null
  // Resolve the effective custom diffuse: per-vehicle override first, then
  // faction-default (set by the Generate modal's 'faction'/'all' scope).
  const resolvedDiffuseUrl = effectiveCustomDiffuseUrl(project, vehicleId, vSpec.faction)
  // A custom diffuse (upload/AI/template bake) always wins over a procedural
  // camo preset — applyCamo nulls customDiffuseUrl when it sets a preset — so
  // camo only applies when there's no resolved diffuse. Mirrors the editor's
  // effective-livery resolution (effectiveCamoPreset).
  const resolvedCamoPreset = resolvedDiffuseUrl
    ? null
    : effectiveCamoPreset(project, vehicleId, vSpec.faction)
  const vehicleDecals = veh?.decals ?? []
  // Skip vehicles with no decals, no custom diffuse (template bake/upload), and
  // no camo preset. Use the effective resolvers so faction-default livery
  // (diffuse OR camo) is not missed.
  if (vehicleDecals.length === 0 && !resolvedDiffuseUrl && !resolvedCamoPreset) return null

  // Composite to a 2048² canvas regardless of source resolution — that's
  // what the CoH2 RGT pipeline wants for skin packs.
  const out = document.createElement('canvas')
  out.width = out.height = 2048
  const ctx = out.getContext('2d')!

  const customDiffuseUrl = resolvedDiffuseUrl
  if (customDiffuseUrl) {
    // Fast path: a custom diffuse is already available (AI-generated or
    // user-uploaded / pasted). Load it as an image and draw it whole onto the
    // canvas. This bypasses the SGA read + BC decode of the vanilla texture.
    await new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, 0, 0, 2048, 2048); resolve() }
      img.onerror = reject
      img.src = customDiffuseUrl
    })

    // ARMOR-ONLY: the stored customDiffuseUrl is the RAW user image — the live
    // editor preview (applyCamoImage in Editor.tsx) masks it at RENDER time and
    // never bakes the mask into the persisted URL. So drawing it whole here
    // would texture the tracks / wheels / running gear / wreck / stowed
    // equipment, which the user reported looks wrong. Match the preview: decode
    // the vanilla diffuse and restore it over the excluded UV regions on top of
    // the custom image. Only pays the SGA read + BC decode + RGM parse when the
    // vehicle actually HAS excluded submeshes (mask is null → no-op, no cost).
    //
    // Best-effort: if the mesh/vanilla can't be loaded or decoded (missing RGM,
    // unsupported BC decode in a headless env, …) we fall back to the whole
    // custom image rather than aborting the whole vehicle's export. In the real
    // browser/Electron runtime the decode succeeds and the mask is applied.
    try {
      const mask = await buildVehicleCamoMask(vSpec, archives)
      if (mask) {
        const vanilla = await decodeVanillaDiffuse(vSpec, archives)
        if (vanilla) restoreExcludedRegions(ctx, vanilla, mask)
      }
    } catch (e) {
      console.warn('[mod-export] custom-diffuse exclusion restore skipped for', vSpec.id, e)
    }
  } else {
    // Slow path: locate the vanilla diffuse RGT in the CoH2 install, decode
    // the BC-compressed pixels, and draw them onto the canvas.
    //
    // ArtGermanEF / ArtWestGerman / ArtSovietEF / ArtAEFSkins / ArtBritish are
    // the per-faction texture archives; ArtHigh / ArtArmies hold the *meshes*.
    // For ~4 vehicles the texture file basename differs from the entity id
    // (e.g. elefant/<elefant_hull>_dif.rgt) — decodeVanillaDiffuse tries each.
    const baseCanvas = await decodeVanillaDiffuse(vSpec, archives)
    if (!baseCanvas) return null
    ctx.drawImage(baseCanvas, 0, 0, 2048, 2048)

    // Procedural camo preset: composite it over the just-drawn vanilla diffuse,
    // mirroring the editor's renderCamoPresetToOverlay (Editor.tsx) so the
    // exported skin pixel-matches the live preview. Only runs on the slow path
    // because a custom diffuse (fast path) already supersedes any camo preset.
    if (resolvedCamoPreset) {
      const W = 2048, H = 2048
      const camo = document.createElement('canvas')
      camo.width = camo.height = W
      if (resolvedCamoPreset.maskedMode) {
        // Masked path: camo patches over the vanilla base, restricted to the
        // already-opaque body pixels via source-atop, at CAMO_OVERLAY_ALPHA so
        // stock shading/panel lines stay partly visible. Then weathering.
        generateCamo(camo, resolvedCamoPreset, null)
        ctx.globalCompositeOperation = 'source-atop'
        ctx.globalAlpha = CAMO_OVERLAY_ALPHA
        ctx.drawImage(camo, 0, 0)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        applyWeathering(ctx, W, H, resolvedCamoPreset.seed)
      } else {
        // Legacy path: opaque camo multiplied over the vanilla diffuse.
        generateCamo(camo, resolvedCamoPreset)
        ctx.globalCompositeOperation = 'multiply'
        ctx.drawImage(camo, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
      }

      // ARMOR-ONLY: restore vanilla over the excluded UV regions (tracks /
      // wheels / running gear / wreck / stowed equipment) so camo + weathering
      // never lands on them. `baseCanvas` is the pristine, unmodified 2048²
      // vanilla diffuse (we only ever drew it INTO `out`'s ctx, never onto it),
      // so it can be used directly as the restore source.
      const mask = await buildVehicleCamoMask(vSpec, archives)
      restoreExcludedRegions(ctx, baseCanvas, mask)
    }
  }

  // Paint decals (veh may be undefined for unvisited vehicles that only have
  // a faction-default diffuse — safe-default to empty decals + spec tac).
  const renderCtx: RenderContext = {
    ctx, palette: project.palette,
    defaultTac: vSpec.defaultTac,
    vehicleName: veh?.name ?? '',
    tac: veh?.tac ?? vSpec.defaultTac,
    images: project.images ?? {},
  }
  // Ensure every image decal is decoded BEFORE the single synchronous paint —
  // otherwise an undecoded image would export as a placeholder and the texture
  // would not pixel-match the editor preview.
  await preloadDecalImages(vehicleDecals, project.images ?? {})
  paintDecals(renderCtx, vehicleDecals, null)

  // The TSET name CoH2 expects — backslash-separated, no extension.
  // Use vehicleFolder + outputBasename so the path matches the real on-disk layout.
  const folder = vehicleFolder(vSpec.id)
  const baseName = outputBasename(vSpec.id)
  const difTset = `art\\armies\\${vSpec.faction}\\vehicles\\${folder}\\${baseName}_dif`
  return { canvas: out, difTset }
}

/** Fetch the bundled template files from the deployed app's `/template/`.
 *
 * In packaged Electron the renderer loads from `file://` so a bare
 * `fetch('/template/…')` resolves to `file:///template/…` — wrong path,
 * always fails. When `window.electronAPI` is present we instead resolve
 * the template directory relative to the current HTML page (e.g.
 * `file:///path/to/dist/index.html` → `dist/template/`) and read each
 * file via the native-fs `readFile` IPC bridge, which is already used for
 * all other Electron file I/O. In a browser / test environment we fall
 * back to the standard `fetch` path.
 */
async function fetchTemplate(): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}

  // Electron production path: derive the bundled dist dir from the current page
  // URL and read files via the IPC bridge. window.location.pathname in Electron
  // production builds is the absolute POSIX path of the loaded index.html, e.g.
  //   /home/user/.../dist/index.html
  // so dirname(pathname) gives the dist root.
  // In Electron dev mode the page is served by Vite at http://localhost:5173/,
  // so window.location.protocol is 'http:' rather than 'file:'. Use the fetch
  // path in that case (Vite serves /template/* from public/template/).
  if (typeof window !== 'undefined' && window.electronAPI && window.location.protocol === 'file:') {
    const pagePath = window.location.pathname // e.g. /abs/path/to/dist/index.html
    // Strip the filename to get the containing directory.
    const distDir = pagePath.replace(/\/[^/]*$/, '') // e.g. /abs/path/to/dist
    for (const filePath of TEMPLATE_FILES) {
      const absPath = `${distDir}/template/${filePath}`
      const buf = await window.electronAPI.readFile(absPath)
      out[filePath] = new Uint8Array(buf)
    }
    return out
  }

  // Browser / dev-server path: use fetch with the Vite BASE_URL.
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  for (const path of TEMPLATE_FILES) {
    const url = `${base}template/${path}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Failed to fetch template/${path}: HTTP ${r.status}`)
    out[path] = new Uint8Array(await r.arrayBuffer())
  }
  return out
}

/** Replace every occurrence of TEMPLATE_GUID in a UTF-8 byte buffer with the
 *  user's fresh modguid. Both are 32 hex chars (16 bytes), so byte offsets
 *  inside the .rgd binary stay constant. */
function rewriteGuid(buf: Uint8Array, newGuid: string): Uint8Array {
  const enc = new TextEncoder()
  const oldBytes = enc.encode(TEMPLATE_GUID)
  const newBytes = enc.encode(newGuid)
  const out = new Uint8Array(buf.length)
  out.set(buf)
  let i = 0
  outer: while (i <= out.length - oldBytes.length) {
    for (let k = 0; k < oldBytes.length; k++) {
      if (out[i + k] !== oldBytes[k]) { i++; continue outer }
    }
    for (let k = 0; k < newBytes.length; k++) out[i + k] = newBytes[k]
    i += newBytes.length
  }
  return out
}

/** Replace the pack's display name + description in the .info file. */
function rewriteInfo(buf: Uint8Array, packName: string, packDesc: string): Uint8Array {
  const td = new TextDecoder('utf-8')
  let text = td.decode(buf)
  text = text.replace(/name\s*=\s*"[^"]*"/, `name = "${packName.replace(/"/g, '\\"')}"`)
  text = text.replace(/description\s*=\s*"[^"]*"/, `description = "${packDesc.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
  return new TextEncoder().encode(text)
}

// ---------------------------------------------------------------------------
// Output basename aliases — canonical write-side basenames for exported RGTs.
// Confirmed against official Relic SGA archives (see VEHICLE_FOLDER_ALIAS above
// for folder-alias vehicles). Any id NOT in this map uses its own id as basename.
// ---------------------------------------------------------------------------

/**
 * Maps vehicle id → canonical _dif basename as expected by the CoH2 engine.
 * Only entries where the basename differs from the vehicle id are listed.
 *
 * Confirmed sources:
 *  - "genuine" aliases (elefant_hull, sdkfz221, ostwind, panther): ArtGermanEF / ArtWestGerman
 *  - folder-alias vehicles (centaur_aa, t_34_85, valentine_command): ArtBritish / ArtSovietEF
 *  - formerly wrong entries corrected from ArtWestGerman / ArtAEF / ArtAEFSkins / ArtBritish
 */
export const OUTPUT_BASENAME: Record<string, string> = {
  // Genuine basename-differs-from-id (real game uses different texture name):
  elefant:                   'elefant_hull',
  ostwind_flak_panzer:       'ostwind',
  sdkfz_222:                 'sdkfz221',
  panther_ausf_g:            'panther',
  halftrack:                 'halftrack',
  // Folder-alias vehicles: basename equals the real folder name (not vSpec.id):
  centaur:                   'centaur_aa',
  t_34_85:                   't_34_85',        // folder = t34_85, basename = t_34_85
  valentine:                 'valentine_command',
  // Non-standard diffuse basenames (verified from CoH2 SGAs 2026-06):
  sherman_m4a3:              'sherman_page',
  aec_armoured_car:          'aec_armouredcar_page',
}

/** Returns the canonical output basename for a vehicle id (write-side, single value). */
export function outputBasename(vehicleId: string): string {
  return OUTPUT_BASENAME[vehicleId] ?? vehicleId
}

// ---------------------------------------------------------------------------
// Manifest types (mirrors build-manifest.ts output)
// ---------------------------------------------------------------------------
interface ManifestRgtEntry {
  offset: number
  length: number
  storeLength: number
  storage: number
}
interface ManifestKey {
  id: string
  guid: string
  file: string
  rgtFiles: Record<string, ManifestRgtEntry>
}
interface Manifest {
  version: number
  keys: ManifestKey[]
}

/**
 * Check whether the signing key manifest is available in the app's static
 * assets. This is the ONLY gate for the signed (Workshop-publish) export path.
 *
 * Renamed from `hasKeyPool` (which incorrectly also checked for
 * template_0001.sga — conflating the signing-key requirement with the
 * template-SGA requirement).  The template SGA is now always bundled via
 * electron-builder extraResources and resolved at runtime via
 * `resolveTemplateSgaPath()`; its presence is no longer used to gate
 * any export path.
 *
 * Summary of the two independent dependencies:
 *   • template_0001.sga  — needed by patchExport to PATCH a pre-signed SGA
 *     in-place (Workshop publish path). Bundled via extraResources.
 *   • manifest.json + keys — needed by patchExport to know WHICH slots to
 *     patch (offset/length per vehicle). Only required for Workshop signing.
 *   • exportSkinPack (unsigned) — needs NEITHER: it builds its own SGA from
 *     scratch using only the small dist/template/ scaffolding files.
 */
export async function hasSigningKeys(): Promise<boolean> {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  try {
    return fetch(`${base}keys/manifest.json`, { method: 'HEAD' }).then(r => r.ok)
  } catch {
    return false
  }
}

/** @deprecated Use {@link hasSigningKeys} instead. */
export const hasKeyPool = hasSigningKeys

/**
 * Resolve the absolute path to template_0001.sga.
 *
 * In packaged Electron the file is bundled as an extraResource at
 * `<resourcesPath>/keys/template_0001.sga` — outside the asar, so Electron
 * can read it without asar extraction overhead.
 *
 * In a browser / dev-server context the path is null (the caller should
 * instead use fetch(`${base}keys/template_0001.sga`) directly).
 */
export async function resolveTemplateSgaPath(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.electronAPI) {
    try {
      const resourcesPath = await window.electronAPI.getResourcesPath()
      return `${resourcesPath}/keys/template_0001.sga`
    } catch {
      return null
    }
  }
  return null
}

/**
 * Export using pre-signed key-pool SGAs.
 *
 * Fetches a signed template SGA, overwrites each vehicle's RGT data in-place,
 * and returns the patched bytes. The RSA signature (which covers the TOC only,
 * not the data section) stays valid because the TOC is never modified.
 */
export async function patchExport(
  root: FileSystemDirectoryHandle,
  project: Coh2SkinProject,
  onProgress: (p: ExportProgress) => void,
  /** Stable numeric id to use as the SGA filename (for overwrite-in-place Live Sync). */
  stableNumericId?: string,
): Promise<ExportResult> {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'

  onProgress({ phase: 'init', message: 'Loading key manifest…' })
  const manifestResp = await fetch(`${base}keys/manifest.json`)
  if (!manifestResp.ok) throw new Error('Key manifest not found — falling back to unsigned export')
  const manifest: Manifest = await manifestResp.json()
  if (!manifest.keys?.length) throw new Error('Key manifest is empty')

  // Pick the first available key
  const key = manifest.keys[0]

  onProgress({ phase: 'init', message: `Fetching signed template (${key.file})…` })

  // In packaged Electron the template SGA lives at
  // `<resourcesPath>/keys/template_0001.sga` (extraResources, outside asar).
  // In a browser / dev-server it is served as a static asset.
  let sgaBytes: Uint8Array
  const templateNativePath = await resolveTemplateSgaPath()
  if (templateNativePath && typeof window !== 'undefined' && window.electronAPI) {
    const buf = await window.electronAPI.readFile(templateNativePath)
    sgaBytes = new Uint8Array(buf)
  } else {
    const sgaResp = await fetch(`${base}keys/${key.file}`)
    if (!sgaResp.ok) throw new Error(`Failed to fetch key SGA: HTTP ${sgaResp.status}`)
    sgaBytes = new Uint8Array(await sgaResp.arrayBuffer())
  }

  onProgress({ phase: 'init', message: 'Locating CoH2 archives…' })
  const archHandle = await locateArchives(root)
  if (!archHandle) throw new Error('Could not locate CoH2/Archives folder under the install handle.')

  const archives = { handle: archHandle, cache: new Map<string, SgaArchive>() }
  // Include vehicles with placed decals OR a custom diffuse (template-baked or
  // user-uploaded) so template-only vehicles are exported in-game (R5).
  // collectExportVehicleIds also catches unvisited vehicles whose faction has
  // a factionDefaults diffuse (MAJOR-2 fix).
  const vehicleIds = collectExportVehicleIds(project)
  if (vehicleIds.length === 0) {
    throw new Error('Project has no vehicles with decals or a chosen template. Add at least one decal or select a template first.')
  }
  const factionHintsPatch = inferProjectFactions(vehicleIds)

  let textureCount = 0

  for (let i = 0; i < vehicleIds.length; i++) {
    const id = vehicleIds[i]
    onProgress({ phase: 'composite', message: `Compositing ${id}`, current: i + 1, total: vehicleIds.length })

    const composed = await composeVehicleDiffuse(root, project, id, archives, factionHintsPatch)
    if (!composed) continue

    const vSpec = findVehicleSpec(id, factionHintsPatch)
    if (!vSpec) continue
    const baseName = outputBasename(id)
    const folder = vehicleFolder(id)
    const difTset = `art\\armies\\${vSpec.faction}\\vehicles\\${folder}\\${baseName}_dif`

    // Generate fixed-size RGT for the pre-signed template slots.
    // MUST use format:'bc3' (DXT5, format code 15) — the bundled template_0001.sga
    // was built with BC3/4,194,736-byte slots per 2048² RGT. RSA signatures in the
    // template are uncracked so we cannot regenerate them; we MUST match the size.
    // compress:false → deterministic byte length (no zlib variance).
    const rgtBytes = canvasToRgt(composed.canvas, difTset, { compress: false, format: 'bc3', fbif: false })

    // Overwrite both summer and winter slots in the template
    for (const season of ['summer', 'winter'] as const) {
      const sgaPath = `art/armies/${vSpec.faction}/vehicles/${folder}/skins/${key.guid}_${season}/${baseName}_dif.rgt`
      const entry = key.rgtFiles[sgaPath]
      if (!entry) {
        console.warn(`patchExport: no manifest entry for ${sgaPath}`)
        continue
      }
      if (rgtBytes.length !== entry.length) {
        throw new Error(
          `RGT size mismatch for ${id} ${season}: generated ${rgtBytes.length}, expected ${entry.length}. ` +
          'Template may have been built with a different version of the RGT writer.'
        )
      }
      sgaBytes.set(rgtBytes, entry.offset)
    }
    textureCount++
  }

  const numericId = stableNumericId ?? freshPackId()
  onProgress({ phase: 'done', message: 'Done', current: vehicleIds.length, total: vehicleIds.length })
  return {
    bytes: sgaBytes,
    filename: `${numericId}.sga`,
    modGuid: key.guid,
    numericId,
    textureCount,
  }
}

/** Top-level export. Streams progress events to the UI. */
export async function exportSkinPack(
  root: FileSystemDirectoryHandle,
  project: Coh2SkinProject,
  onProgress: (p: ExportProgress) => void,
  /** Which export slot index to use for the vehicle state; undefined = use project.vehicles. */
  _targetSlot?: number,
  /** Stable numeric id to use as the SGA filename (for overwrite-in-place Live Sync). */
  stableNumericId?: string,
  /** Stable mod GUID to use for internal asset paths (for overwrite-in-place Live Sync). */
  stableModGuid?: string,
): Promise<ExportResult> {
  // ── Input validation (must happen BEFORE any async I/O) ──
  if (_targetSlot !== undefined && (_targetSlot < 0 || _targetSlot > 5)) {
    throw new Error(`Invalid targetSlot ${_targetSlot}: must be 0–5`)
  }
  if (stableNumericId !== undefined) {
    if (!/^\d+$/.test(stableNumericId) || /^0\d/.test(stableNumericId)) {
      throw new Error(
        `Invalid numericIdOverride "${stableNumericId}": must be a non-empty string of digits with no leading zeros`,
      )
    }
  }
  if (stableModGuid !== undefined) {
    if (!/^[0-9a-f]{32}$/.test(stableModGuid)) {
      throw new Error(
        `Invalid modGuidOverride "${stableModGuid}": must be exactly 32 lowercase hex characters`,
      )
    }
  }

  // Composite each vehicle's diffuse + decals.
  // Include vehicles with placed decals OR a custom diffuse (template-baked or
  // user-uploaded) so template-only vehicles are exported in-game (R5).
  // collectExportVehicleIds also catches unvisited vehicles whose faction has
  // a factionDefaults diffuse (MAJOR-2 fix).
  // Check BEFORE locateArchives so "empty project" gives a meaningful error fast.
  const vehicleIds = collectExportVehicleIds(project)
  if (vehicleIds.length === 0) {
    throw new Error('Project has no vehicles with decals or a chosen template. Add at least one decal or select a template first.')
  }

  onProgress({ phase: 'init', message: 'Locating CoH2 archives…' })
  const archHandle = await locateArchives(root)
  if (!archHandle) throw new Error('Could not locate CoH2/Archives folder under the install handle.')

  onProgress({ phase: 'init', message: 'Loading template…' })
  const tmpl = await fetchTemplate()

  const newGuid = stableModGuid ?? freshModGuid()
  const numericId = stableNumericId ?? freshPackId()
  const archives = { handle: archHandle, cache: new Map<string, SgaArchive>() }
  // Infer factions from the project so shared vehicle ids (e.g. 'halftrack'
  // appears in both german and soviet) are resolved to the right faction.
  const factionHints = inferProjectFactions(vehicleIds)
  const sgaFiles: SgaInputFile[] = []

  for (let i = 0; i < vehicleIds.length; i++) {
    const id = vehicleIds[i]
    onProgress({ phase: 'composite', message: `Compositing ${id}`, current: i + 1, total: vehicleIds.length })
    const composed = await composeVehicleDiffuse(root, project, id, archives, factionHints)
    if (!composed) continue
    // Encode + wrap as RGT, and add for both summer + winter slots.
    const rgtBytes = canvasToRgt(composed.canvas, composed.difTset)
    const vSpec = findVehicleSpec(id, factionHints)!
    const outBase = outputBasename(id)
    const outFolder = vehicleFolder(id)
    for (const season of ['summer', 'winter'] as const) {
      const path = `art/armies/${vSpec.faction}/vehicles/${outFolder}/skins/${newGuid}_${season}/${outBase}_dif.rgt`
      sgaFiles.push({ path, bytes: rgtBytes, compress: false })
    }
  }

  // Add template files with GUID + name rewrites
  onProgress({ phase: 'pack', message: 'Packaging .info + .rgd + locale…' })
  // .info file: rename + rewrite content
  sgaFiles.push({
    path: `${newGuid}.info`,
    bytes: rewriteInfo(tmpl[`${TEMPLATE_GUID}.info`], project.packName, project.packDescription),
    compress: true,
  })
  // .rgd files: keep paths + binary unchanged (their internal "caf_ss3_*"
  // names are independent of modguid). The user's pack will register under
  // these same skin-pack ids — meaning multiple packs from this exporter
  // would conflict if the user has both subscribed simultaneously. That's
  // a v2 problem: rewrite the binary chunk to use unique names + recompute
  // the embedded CRC. Single-pack-active is the v1 contract.
  //
  // UI icon files (.gfx + _i1.dds): rename GUID in the path. The .gfx binary
  // may reference the old GUID internally so rewrite it too.
  for (const tmplPath of TEMPLATE_FILES) {
    if (tmplPath.endsWith('.info') || tmplPath.endsWith('.ucs')) continue
    // Rewrite GUID in the path (for .gfx and _i1.dds which are named after the GUID)
    const destPath = tmplPath.replace(TEMPLATE_GUID, newGuid)

    // If this is the atlas DDS and any slot has a custom icon, composite them.
    if (tmplPath.endsWith('_i1.dds') && project.exportSlots.some(s => s.slotIcon)) {
      let atlasBytes: Uint8Array
      try {
        atlasBytes = await compositeIconAtlas(tmpl[tmplPath], project.exportSlots)
      } catch (err) {
        console.warn('icon-atlas-composite: falling back to template DDS —', err)
        atlasBytes = rewriteGuid(tmpl[tmplPath], newGuid)
      }
      sgaFiles.push({ path: destPath, bytes: atlasBytes, compress: true })
      continue
    }

    // Also rewrite GUID references inside the bytes (e.g. .gfx may reference the GUID)
    const destBytes = rewriteGuid(tmpl[tmplPath], newGuid)
    sgaFiles.push({ path: destPath, bytes: destBytes, compress: true })
  }
  // english.ucs: rewrite GUID references (paths inside the file might use it)
  sgaFiles.push({
    path: 'english/english.ucs',
    bytes: rewriteGuid(tmpl['english/english.ucs'], newGuid),
    compress: true,
  })

  onProgress({ phase: 'pack', message: 'Building SGA…' })
  const sgaBytes = await buildSga({ archiveName: newGuid, files: sgaFiles })

  onProgress({ phase: 'done', message: 'Done', current: vehicleIds.length, total: vehicleIds.length })
  return {
    bytes: sgaBytes,
    // Numeric filename so the engine actually picks it up. The display name
    // is preserved inside the .info — only the on-disk filename has to be
    // numeric for `mods\\skins\\` scanning to match.
    filename: `${numericId}.sga`,
    modGuid: newGuid,
    numericId,
    textureCount: vehicleIds.length,
  }
}

