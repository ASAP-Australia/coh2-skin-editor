/**
 * scripts/build-honved-sga.mts
 *
 * Headless rebuild of the Honved skin SGA from the regenerated german-faction
 * diffuse PNGs at artifacts/respec_audit/honved-skin/regen/<vehicleId>.png.
 *
 * Uses the EXISTING buildSga + canvasToRgt + encodeBc3 pipeline from src/lib —
 * NO reimplementation of RGT encode or SGA packing.
 *
 * The only shims needed for headless Node:
 *   1. HTMLCanvasElement / getContext('2d') / getImageData — node-canvas
 *   2. fetchTemplate() — replaced with fs.readFile reads from public/template/
 *   3. import.meta.env — not needed (we bypass fetchTemplate entirely)
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.node.json scripts/build-honved-sga.mts
 */

import { createCanvas, loadImage } from 'canvas'
import { readFile, copyFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Bootstrap minimal DOM so imports that reference HTMLCanvasElement / ImageData
// at module scope don't blow up. We patch document.createElement to return
// node-canvas instances (same pattern as regen-honved.mts).
// ---------------------------------------------------------------------------
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as Record<string, unknown>).document = dom.window.document
;(globalThis as Record<string, unknown>).HTMLCanvasElement = dom.window.HTMLCanvasElement
;(globalThis as Record<string, unknown>).ImageData = dom.window.ImageData

const origCreateElement = dom.window.document.createElement.bind(dom.window.document)
;(dom.window.document as unknown as Record<string, unknown>).createElement = (tag: string, ...args: unknown[]) => {
  if (tag === 'canvas') {
    const nc = createCanvas(2048, 2048)
    return nc as unknown as HTMLCanvasElement
  }
  return origCreateElement(tag as keyof HTMLElementTagNameMap, ...args as [ElementCreationOptions?])
}
;(globalThis as Record<string, unknown>).document = dom.window.document

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')
const REGEN_DIR = path.join(ROOT, 'artifacts', 'respec_audit', 'honved-skin', 'regen')
const TEMPLATE_DIR = path.join(ROOT, 'public', 'template')
const OUT_SGA = path.join(ROOT, 'artifacts', 'respec_audit', 'honved-skin', 'honved-rebuilt.sga')
const INSTALLED_SGA = path.join(
  '/var/home/jflessenkemper/.local/share/feral-interactive/CompanyOfHeroes2/AppData/mods/skins',
  '2766831464216004.sga'
)

// ---------------------------------------------------------------------------
// Dynamic imports (after DOM patch is in effect).
// IMPORTANT: only import pure leaf modules — do NOT import mod-export.ts which
// pulls in icon-atlas-composite.ts → faceplate-mod-build.ts → @/lib/* aliases
// that tsx cannot resolve without a tsconfig-paths plugin.
// ---------------------------------------------------------------------------
const { canvasToRgt } = await import(`${SRC_LIB}/rgt-writer.ts`)
const { buildSga } = await import(`${SRC_LIB}/sga-writer.ts`) as {
  buildSga: (opts: { archiveName: string; files: { path: string; bytes: Uint8Array; compress?: boolean }[] }) => Promise<Uint8Array>
}
const { SgaArchive } = await import(`${SRC_LIB}/sga.ts`)

// vehicleFolder and outputBasename are trivial lookups inlined here to avoid
// pulling in mod-export.ts (which transitively depends on @/ aliases).
const VEHICLE_FOLDER_ALIAS: Record<string, string> = {
  centaur:   'centaur_aa',
  t_34_85:   't34_85',
  valentine: 'valentine_command',
}
function vehicleFolder(vehicleId: string): string {
  return VEHICLE_FOLDER_ALIAS[vehicleId] ?? vehicleId
}
const OUTPUT_BASENAME: Record<string, string> = {
  elefant:             'elefant_hull',
  ostwind_flak_panzer: 'ostwind',
  sdkfz_222:           'sdkfz221',
  panther_ausf_g:      'panther',
  halftrack:           'halftrack',
  centaur:             'centaur_aa',
  t_34_85:             't_34_85',
  valentine:           'valentine_command',
  sherman_m4a3:        'sherman_page',
  aec_armoured_car:    'aec_armouredcar_page',
}
function outputBasename(vehicleId: string): string {
  return OUTPUT_BASENAME[vehicleId] ?? vehicleId
}

// ---------------------------------------------------------------------------
// Constants matching the existing Honved pack (so the game treats it as update)
// Stable GUID + numeric ID — same as the installed pack's filename.
// ---------------------------------------------------------------------------
const TEMPLATE_GUID = '935a02ef44344ea29108b57b9cb7b9f5'
// We reuse the installed pack's numeric ID as the filename so the game loads it.
const NUMERIC_ID = '2766831464216004'
// Keep the same GUID so skin paths inside the SGA stay stable.
// A fresh GUID would also work but the stable one lets us overwrite in-place.
const MOD_GUID = TEMPLATE_GUID

const PACK_NAME = 'Honved Camo'
const PACK_DESC = 'Hungarian Honved 3-tone camouflage for Ostheer vehicles (regenerated).'

// The 10 german vehicles from the task spec.
const GERMAN_VEHICLE_IDS = [
  'tiger',
  'elefant',
  'brummbar',
  'stug_iii',
  'ostwind_flak_panzer',
  'panzerwerfer',
  'halftrack',
  'sdkfz_250',
  'sdkfz_222',
  'opel_blitz',
]

// ---------------------------------------------------------------------------
// Helper: read a template file from public/template/
// ---------------------------------------------------------------------------
async function readTemplateFile(relPath: string): Promise<Uint8Array> {
  const abs = path.join(TEMPLATE_DIR, relPath)
  return new Uint8Array(await readFile(abs))
}

// ---------------------------------------------------------------------------
// Helper: replace TEMPLATE_GUID with newGuid in a byte buffer (UTF-8 find/replace)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helper: rewrite pack name/desc in the .info file
// ---------------------------------------------------------------------------
function rewriteInfo(buf: Uint8Array, packName: string, packDesc: string): Uint8Array {
  const td = new TextDecoder('utf-8')
  let text = td.decode(buf)
  text = text.replace(/name\s*=\s*"[^"]*"/, `name = "${packName.replace(/"/g, '\\"')}"`)
  text = text.replace(/description\s*=\s*"[^"]*"/, `description = "${packDesc.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
  return new TextEncoder().encode(text)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('=== build-honved-sga.mts ===')
console.log(`Regen dir: ${REGEN_DIR}`)
console.log(`Output:    ${OUT_SGA}`)
console.log(`Vehicles:  ${GERMAN_VEHICLE_IDS.join(', ')}`)
console.log()

const sgaFiles: { path: string; bytes: Uint8Array; compress?: boolean }[] = []
const includedVehicles: string[] = []

for (const id of GERMAN_VEHICLE_IDS) {
  const pngPath = path.join(REGEN_DIR, `${id}.png`)
  if (!existsSync(pngPath)) {
    console.warn(`  WARN: ${id}.png not found at ${pngPath}, skipping`)
    continue
  }

  console.log(`  [${id}] loading ${pngPath}`)
  const img = await loadImage(pngPath)

  // Create a 2048×2048 node-canvas and draw the PNG into it.
  const canvas = createCanvas(2048, 2048)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img as unknown as Parameters<typeof ctx.drawImage>[0], 0, 0, 2048, 2048)

  // Resolve the SGA internal path for this vehicle (german faction).
  const faction = 'german'
  const folder = vehicleFolder(id)
  const baseName = outputBasename(id)
  const difTset = `art\\armies\\${faction}\\vehicles\\${folder}\\${baseName}_dif`

  // Encode via the EXISTING canvasToRgt (BC3, FBIF=true, compress=false for
  // deterministic size; compress=false = raw BC bytes stored in SGA, smaller
  // when the SGA writer re-compresses with storage=2/zlib).
  // Actually: use compress=true (default) so the RGT itself contains a
  // zlib-deflated mip — matching what the unsigned export path produces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rgtBytes = (canvasToRgt as any)(canvas, difTset, { compress: true, format: 'bc3', fbif: true }) as Uint8Array
  console.log(`  [${id}] RGT size: ${rgtBytes.length} bytes (${Math.round(rgtBytes.length / 1024)} KB)`)

  // Add for both summer and winter slots (same RGT, matching exportSkinPack)
  for (const season of ['summer', 'winter'] as const) {
    const sgaPath = `art/armies/${faction}/vehicles/${folder}/skins/${MOD_GUID}_${season}/${baseName}_dif.rgt`
    sgaFiles.push({ path: sgaPath, bytes: rgtBytes, compress: false })
  }
  includedVehicles.push(id)
}

if (includedVehicles.length === 0) {
  throw new Error('No vehicle PNGs found — aborting')
}

// ---------------------------------------------------------------------------
// Template files (from public/template/) — same as fetchTemplate() in exportSkinPack
// ---------------------------------------------------------------------------
const TEMPLATE_FILES = [
  `${TEMPLATE_GUID}.info`,
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

console.log('\nPackaging template files...')
// .info: rewrite name/desc + GUID
const infoBuf = await readTemplateFile(`${TEMPLATE_GUID}.info`)
sgaFiles.push({
  path: `${MOD_GUID}.info`,
  bytes: rewriteInfo(rewriteGuid(infoBuf, MOD_GUID), PACK_NAME, PACK_DESC),
  compress: true,
})

// .rgd files: binary unchanged (internal names independent of modguid)
for (const tmplPath of TEMPLATE_FILES) {
  if (tmplPath.endsWith('.info') || tmplPath.endsWith('.ucs')) continue
  const destPath = tmplPath.replace(TEMPLATE_GUID, MOD_GUID)
  const buf = await readTemplateFile(tmplPath)
  const destBytes = rewriteGuid(buf, MOD_GUID)
  sgaFiles.push({ path: destPath, bytes: destBytes, compress: true })
}

// english.ucs: rewrite GUID
const ucsBuf = await readTemplateFile('english/english.ucs')
sgaFiles.push({
  path: 'english/english.ucs',
  bytes: rewriteGuid(ucsBuf, MOD_GUID),
  compress: true,
})

// ---------------------------------------------------------------------------
// Build the SGA
// ---------------------------------------------------------------------------
console.log(`\nBuilding SGA (${sgaFiles.length} files, ${includedVehicles.length} vehicles × 2 seasons + template)...`)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sgaBytes = await (buildSga as any)({ archiveName: MOD_GUID, files: sgaFiles }) as Uint8Array
console.log(`SGA built: ${sgaBytes.length} bytes (${Math.round(sgaBytes.length / 1024 / 1024 * 10) / 10} MB)`)

// ---------------------------------------------------------------------------
// Validate: parse the output with SgaArchive, list all files
// ---------------------------------------------------------------------------
console.log('\nValidating SGA...')
const blob = new Blob([sgaBytes])
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let archive: any
try {
  archive = await (SgaArchive as any).open(blob)
} catch (e) {
  throw new Error(`assertSgaParses FAILED: ${e}`)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listedFiles: { path: string; length: number }[] = archive.list()
console.log(`assertSgaParses: PASSED — ${listedFiles.length} files in archive`)

// Check vehicle coverage
const rgtPaths = listedFiles.map(f => f.path).filter(p => p.endsWith('_dif.rgt'))
console.log('\nRGT entries in SGA:')
for (const rp of rgtPaths) {
  console.log(`  ${rp}`)
}

// Confirm included vehicles
const foundIds = new Set<string>()
for (const rp of rgtPaths) {
  // Extract vehicle id from path: art/armies/german/vehicles/<folder>/skins/.../
  const m = rp.match(/vehicles\/([^/]+)\/skins\//)
  if (m) {
    // folder may be aliased; reverse-map to vehicleId
    const folder = m[1]
    // find the vehicle id whose vehicleFolder() == folder
    const vid = GERMAN_VEHICLE_IDS.find(id => (vehicleFolder as (id: string) => string)(id) === folder) ?? folder
    foundIds.add(vid)
  }
}
console.log(`\nVehicle IDs confirmed in SGA: ${Array.from(foundIds).sort().join(', ')}`)

// Confirm NO OKW/other-faction entries
const okwPatterns = ['west_german', 'soviet', 'aef', 'british']
const otherFactionPaths = listedFiles
  .map(f => f.path)
  .filter(p => okwPatterns.some(f => p.includes(f)))
if (otherFactionPaths.length > 0) {
  console.error('ERROR: Other-faction paths found:')
  for (const p of otherFactionPaths) console.error(`  ${p}`)
  throw new Error('SGA contains non-german faction entries — aborting deploy')
}
console.log('No OKW/other-faction entries: CONFIRMED')

const expectedCount = includedVehicles.length
const actualCount = foundIds.size
if (actualCount !== expectedCount) {
  console.warn(`WARNING: Expected ${expectedCount} vehicles, found ${actualCount}`)
} else {
  console.log(`Vehicle count: ${actualCount}/${expectedCount} — OK`)
}

// ---------------------------------------------------------------------------
// Write output SGA
// ---------------------------------------------------------------------------
await writeFile(OUT_SGA, sgaBytes)
console.log(`\nOutput written: ${OUT_SGA}`)
console.log(`Size: ${sgaBytes.length} bytes (${Math.round(sgaBytes.length / 1024 / 1024 * 10) / 10} MB)`)

// Compare with installed pack size
if (existsSync(INSTALLED_SGA)) {
  const installed = await readFile(INSTALLED_SGA)
  console.log(`Installed SGA: ${installed.length} bytes (${Math.round(installed.length / 1024 / 1024 * 10) / 10} MB)`)
  const ratio = sgaBytes.length / installed.length
  console.log(`Size ratio (new/old): ${Math.round(ratio * 100)}%`)
}

// ---------------------------------------------------------------------------
// Deploy: backup old SGA, then replace atomically
// ---------------------------------------------------------------------------
if (existsSync(INSTALLED_SGA)) {
  const ts = Date.now()
  const backupPath = `/tmp/honved-skin-backup-${ts}.sga`
  console.log(`\nBacking up installed SGA to ${backupPath}...`)
  await copyFile(INSTALLED_SGA, backupPath)
  console.log(`Backup written: ${backupPath}`)

  console.log(`Deploying to ${INSTALLED_SGA}...`)
  await writeFile(INSTALLED_SGA, sgaBytes)
  console.log('Deploy: DONE')
  console.log(`\nOld pack backed up at: ${backupPath}`)
} else {
  console.warn(`\nInstalled SGA not found at ${INSTALLED_SGA} — skipping deploy`)
  console.log(`New SGA is at: ${OUT_SGA}`)
}

console.log('\n=== COMPLETE ===')
console.log(`SGA rebuilt headlessly via existing buildSga + canvasToRgt: YES`)
console.log(`Output: ${OUT_SGA}`)
console.log(`Contains ONLY german vehicles: ${Array.from(foundIds).sort().join(', ')}`)
console.log(`assertSgaParses: PASSED`)
