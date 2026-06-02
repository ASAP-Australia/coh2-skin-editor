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
import { findVehicleSpec, inferProjectFactions, vehicleFolder, type Faction } from './vehicles'
import type { Coh2SkinProject } from './project'
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

/** Compose the live decal canvas for a single vehicle by:
 *   - locating its diffuse RGT in the user's CoH2 install
 *   - software-decoding BC bytes → 2048² 2D canvas
 *   - painting the user's decals on top with decal-painter
 *  Returns null when the vehicle has zero decals (skip — saves time/space). */
async function composeVehicleDiffuse(
  _root: FileSystemDirectoryHandle,
  project: Coh2SkinProject,
  vehicleId: string,
  archives: { handle: FileSystemDirectoryHandle; cache: Map<string, SgaArchive> },
  factionHints?: Faction[],
): Promise<{ canvas: HTMLCanvasElement; difTset: string } | null> {
  const veh = project.vehicles[vehicleId]
  if (!veh || veh.decals.length === 0) return null
  const vSpec = findVehicleSpec(vehicleId, factionHints)
  if (!vSpec) return null

  // Composite to a 2048² canvas regardless of source resolution — that's
  // what the CoH2 RGT pipeline wants for skin packs.
  const out = document.createElement('canvas')
  out.width = out.height = 2048
  const ctx = out.getContext('2d')!

  const customDiffuseUrl = veh.customDiffuseUrl ?? null
  if (customDiffuseUrl) {
    // Fast path: a custom diffuse is already available (AI-generated or
    // user-uploaded). Load it as an image and draw it onto the canvas.
    // This bypasses the SGA read + BC decode entirely.
    await new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, 0, 0, 2048, 2048); resolve() }
      img.onerror = reject
      img.src = customDiffuseUrl
    })
  } else {
    // Slow path: locate the vanilla diffuse RGT in the CoH2 install, decode
    // the BC-compressed pixels, and draw them onto the canvas.
    //
    // ArtGermanEF / ArtWestGerman / ArtSovietEF / ArtAEFSkins / ArtBritish are
    // the per-faction texture archives; ArtHigh / ArtArmies hold the *meshes*.
    // For ~4 vehicles the texture file basename differs from the entity id
    // (e.g. elefant/<elefant_hull>_dif.rgt). Try each candidate basename.
    const sgaCandidates = factionSgaCandidates(vSpec.faction)
    const baseNames = textureBaseNamesFor(vSpec.id)
    let sga: SgaArchive | null = null
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
        if (b) { sga = a; rgtBytes = b; break outer }
      }
    }
    if (!sga || !rgtBytes) return null

    const rgt = decodeRgt(rgtBytes)
    const baseCanvas = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
    ctx.drawImage(baseCanvas, 0, 0, 2048, 2048)
  }

  // Paint decals
  const renderCtx: RenderContext = {
    ctx, palette: project.palette,
    defaultTac: vSpec.defaultTac,
    vehicleName: veh.name ?? '',
    tac: veh.tac ?? vSpec.defaultTac,
    images: project.images ?? {},
  }
  // Ensure every image decal is decoded BEFORE the single synchronous paint —
  // otherwise an undecoded image would export as a placeholder and the texture
  // would not pixel-match the editor preview.
  await preloadDecalImages(veh.decals, project.images ?? {})
  paintDecals(renderCtx, veh.decals, null)

  // The TSET name CoH2 expects — backslash-separated, no extension.
  // Use vehicleFolder + outputBasename so the path matches the real on-disk layout.
  const folder = vehicleFolder(vSpec.id)
  const baseName = outputBasename(vSpec.id)
  const difTset = `art\\armies\\${vSpec.faction}\\vehicles\\${folder}\\${baseName}_dif`
  return { canvas: out, difTset }
}

/** Fetch the bundled template files from the deployed app's `/template/`. */
async function fetchTemplate(): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
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

/** Check whether a signed key pool is available in the app's static assets. */
export async function hasKeyPool(): Promise<boolean> {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  try {
    // Must verify both the manifest AND the actual template SGA exist.
    // manifest.json ships in the repo (describes the key layout), but
    // template_0001.sga is large (~377 MB) and must be generated separately
    // via tools/publish-templates.sh before a local-install build is possible.
    const manifestOk = await fetch(`${base}keys/manifest.json`, { method: 'HEAD' }).then(r => r.ok)
    if (!manifestOk) return false
    return fetch(`${base}keys/template_0001.sga`, { method: 'HEAD' }).then(r => r.ok)
  } catch {
    return false
  }
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
  const sgaResp = await fetch(`${base}keys/${key.file}`)
  if (!sgaResp.ok) throw new Error(`Failed to fetch key SGA: HTTP ${sgaResp.status}`)
  const sgaBytes = new Uint8Array(await sgaResp.arrayBuffer())

  onProgress({ phase: 'init', message: 'Locating CoH2 archives…' })
  const archHandle = await locateArchives(root)
  if (!archHandle) throw new Error('Could not locate CoH2/Archives folder under the install handle.')

  const archives = { handle: archHandle, cache: new Map<string, SgaArchive>() }
  const vehicleIds = Object.keys(project.vehicles).filter(id => (project.vehicles[id]?.decals?.length ?? 0) > 0)
  if (vehicleIds.length === 0) {
    throw new Error('Project has no vehicles with decals. Add at least one decal first.')
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

    // Generate fixed-size RGT (compress:false → deterministic BC3 byte length)
    const rgtBytes = canvasToRgt(composed.canvas, difTset, { compress: false })

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

  onProgress({ phase: 'init', message: 'Locating CoH2 archives…' })
  const archHandle = await locateArchives(root)
  if (!archHandle) throw new Error('Could not locate CoH2/Archives folder under the install handle.')

  onProgress({ phase: 'init', message: 'Loading template…' })
  const tmpl = await fetchTemplate()

  const newGuid = stableModGuid ?? freshModGuid()
  const numericId = stableNumericId ?? freshPackId()
  const archives = { handle: archHandle, cache: new Map<string, SgaArchive>() }

  // Composite each vehicle's diffuse + decals
  const vehicleIds = Object.keys(project.vehicles).filter(id => (project.vehicles[id]?.decals?.length ?? 0) > 0)
  if (vehicleIds.length === 0) {
    throw new Error('Project has no vehicles with decals. Add at least one decal first.')
  }
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

