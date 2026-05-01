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
import { paintDecals, type RenderContext } from './decal-painter'
import { VEHICLES } from './vehicles'
import type { Coh2SkinProject } from './project'

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
]

/** Generate a fresh 32-hex-char mod GUID. Cryptographically random. */
export function freshModGuid(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** Map the project's vehicle id → on-disk SGA path + faction folder used by
 *  CoH2's skin-pack convention. */
function rgmPathFor(vehicleId: string): string | null {
  const v = VEHICLES.find(x => x.id === vehicleId)
  if (!v) return null
  return `art/armies/${v.faction}/vehicles/${v.id}/${v.id}.rgm`
}

/** SGA archives most likely to contain the diffuse RGTs for a given faction. */
function factionSgaCandidates(faction: string): string[] {
  switch (faction) {
    case 'german':       return ['ArtGermanEF.sga', 'ArtArmies.sga', 'ArtHigh.sga']
    case 'west_german':  return ['ArtWestGerman.sga', 'ArtHighXP1.sga', 'ArtArmies.sga']
    case 'soviet':       return ['ArtSovietEF.sga', 'ArtArmies.sga', 'ArtHigh.sga']
    case 'aef':          return ['ArtAEFSkins.sga', 'ArtAEF.sga', 'ArtHighXP1.sga']
    case 'british':      return ['ArtBritish.sga', 'ArtHighXP2.sga']
    default:             return ['ArtArmies.sga', 'ArtHigh.sga']
  }
}

/** Filename aliases — CoH2 names a handful of textures differently from the
 *  entity directory (e.g. elefant/elefant_hull_dif.rgt, panther_ausf_g/
 *  panther_dif.rgt). The export pipeline tries each candidate in order. */
function textureBaseNamesFor(vehicleId: string): string[] {
  const aliases: Record<string, string[]> = {
    elefant:               ['elefant_hull', 'elefant'],
    ostwind_flak_panzer:   ['ostwind', 'ostwind_flak_panzer'],
    sdkfz_222:             ['sdkfz221', 'sdkfz_222'],
    panther_ausf_g:        ['panther', 'panther_ausf_g'],
    halftrack:             ['halftrack', 'halftrack_sdkfz_251'],
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
  filename: string
  modGuid: string
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
): Promise<{ canvas: HTMLCanvasElement; difTset: string } | null> {
  const veh = project.vehicles[vehicleId]
  if (!veh || veh.decals.length === 0) return null
  const vSpec = VEHICLES.find(v => v.id === vehicleId)
  if (!vSpec) return null

  // The diffuse RGT lives in a faction-specific SGA in CoH2's install layout.
  // ArtGermanEF / ArtWestGerman / ArtSovietEF / ArtAEFSkins / ArtBritish are
  // the per-faction texture archives; ArtHigh / ArtArmies hold the *meshes*.
  // For ~4 vehicles the texture file basename differs from the entity id
  // (e.g. elefant/<elefant_hull>_dif.rgt). Try each candidate basename.
  const sgaCandidates = factionSgaCandidates(vSpec.faction)
  const baseNames = textureBaseNamesFor(vSpec.id)
  let sga: SgaArchive | null = null
  let rgtBytes: Uint8Array | null = null
  let usedBase = vSpec.id
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
      const difPath = `art/armies/${vSpec.faction}/vehicles/${vSpec.id}/${base}_dif.rgt`
      const b = await a.readByPath(difPath)
      if (b) { sga = a; rgtBytes = b; usedBase = base; break outer }
    }
  }
  if (!sga || !rgtBytes) return null

  const rgt = decodeRgt(rgtBytes)
  const baseCanvas = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)

  // Composite to a 2048² canvas regardless of source resolution — that's
  // what the CoH2 RGT pipeline wants for skin packs.
  const out = document.createElement('canvas')
  out.width = out.height = 2048
  const ctx = out.getContext('2d')!
  ctx.drawImage(baseCanvas, 0, 0, 2048, 2048)

  // Paint decals
  const renderCtx: RenderContext = {
    ctx, palette: project.palette,
    defaultTac: vSpec.defaultTac,
    vehicleName: veh.name ?? '',
    tac: veh.tac ?? vSpec.defaultTac,
    images: project.images ?? {},
  }
  paintDecals(renderCtx, veh.decals, null)

  // The TSET name CoH2 expects — backslash-separated, no extension
  const difTset = `art\\armies\\${vSpec.faction}\\vehicles\\${vSpec.id}\\${vSpec.id}_dif`
  return { canvas: out, difTset }
}

/** Fetch the bundled template files from the deployed app's `/template/`. */
async function fetchTemplate(): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  const base = (import.meta as any).env?.BASE_URL ?? '/'
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

/** Top-level export. Streams progress events to the UI. */
export async function exportSkinPack(
  root: FileSystemDirectoryHandle,
  project: Coh2SkinProject,
  onProgress: (p: ExportProgress) => void,
): Promise<ExportResult> {
  onProgress({ phase: 'init', message: 'Locating CoH2 archives…' })
  const archHandle = await locateArchives(root)
  if (!archHandle) throw new Error('Could not locate CoH2/Archives folder under the install handle.')

  onProgress({ phase: 'init', message: 'Loading template…' })
  const tmpl = await fetchTemplate()

  const newGuid = freshModGuid()
  const archives = { handle: archHandle, cache: new Map<string, SgaArchive>() }

  // Composite each vehicle's diffuse + decals
  const vehicleIds = Object.keys(project.vehicles).filter(id => (project.vehicles[id]?.decals?.length ?? 0) > 0)
  if (vehicleIds.length === 0) {
    throw new Error('Project has no vehicles with decals. Add at least one decal first.')
  }
  const sgaFiles: SgaInputFile[] = []

  for (let i = 0; i < vehicleIds.length; i++) {
    const id = vehicleIds[i]
    onProgress({ phase: 'composite', message: `Compositing ${id}`, current: i + 1, total: vehicleIds.length })
    const composed = await composeVehicleDiffuse(root, project, id, archives)
    if (!composed) continue
    // Encode + wrap as RGT, and add for both summer + winter slots.
    const rgtBytes = canvasToRgt(composed.canvas, composed.difTset)
    const vSpec = VEHICLES.find(v => v.id === id)!
    for (const season of ['summer', 'winter'] as const) {
      const path = `art/armies/${vSpec.faction}/vehicles/${vSpec.id}/skins/${newGuid}_${season}/${vSpec.id}_dif.rgt`
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
  for (const path of TEMPLATE_FILES) {
    if (path.endsWith('.info') || path.endsWith('.ucs')) continue
    sgaFiles.push({ path, bytes: tmpl[path], compress: true })
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
    filename: `${slug(project.packName)}_${newGuid.slice(0, 8)}.sga`,
    modGuid: newGuid,
    textureCount: vehicleIds.length,
  }
}

function slug(s: string) {
  return s.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 32) || 'skinpack'
}
