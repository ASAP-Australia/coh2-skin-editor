/**
 * Node test harness for the export pipeline.
 *
 * Calls the same TypeScript code the browser uses (sga-writer / rgt-writer /
 * bc-encode / chunky / sga / rgt / bc-decode) against the user's real CoH2
 * install on disk, with thin Node shims for HTMLCanvasElement (via node-canvas)
 * and FileSystemDirectoryHandle (via fs).
 *
 * Outputs a complete CoH2-loadable `.sga` file that the user drops into
 * `~/.local/share/Steam/steamapps/compatdata/231430/.../mods/skins/`.
 *
 * Usage:
 *   # via env vars (recommended — npm strips unknown --flags before tsx sees them)
 *   COH2_INSTALL=~/.local/share/Steam/steamapps/common/Company\ of\ Heroes\ 2 \
 *     OUT=/tmp/pack.sga npx tsx tools/test-export.ts
 *
 *   # or via CLI args after a `--` so npm doesn't eat them
 *   npx tsx tools/test-export.ts -- \
 *     --install ~/.local/share/Steam/steamapps/common/Company\ of\ Heroes\ 2 \
 *     --out /tmp/pack.sga
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData, type Canvas } from 'canvas'

;(global as any).ImageData = NodeImageData as any

// Shim HTMLCanvasElement / Image so the browser libs work in Node.
// node-canvas's Canvas exposes the same getContext('2d') API; we just need
// the libs to *think* they have a real DOM Canvas.
;(global as any).HTMLCanvasElement = class {} as any
;(global as any).Image = Image as any
;(global as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return createCanvas(1, 1) as unknown as HTMLCanvasElement
    if (tag === 'a') return { click() {}, href: '', download: '' }
    throw new Error(`document.createElement(${tag}) not supported in Node shim`)
  },
}
;(global as any).URL = URL
// node 20+ has globalThis.crypto.getRandomValues already; nothing to do.

// Now we can import the lib code
import { SgaArchive } from '../src/lib/sga'
import { decodeRgt } from '../src/lib/rgt'
import { bcToCanvas } from '../src/lib/bc-decode'
import { canvasToRgt } from '../src/lib/rgt-writer'
import { buildSga, type SgaInputFile } from '../src/lib/sga-writer'
import { paintDecals, type RenderContext } from '../src/lib/decal-painter'
import { VEHICLES, type VehicleSpec } from '../src/lib/vehicles'
import { buildDutchBrigadeDemo } from '../src/lib/demo-project'
import { type Coh2SkinProject } from '../src/lib/project'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag)
  if (i >= 0) return process.argv[i + 1] ?? ''
  return fallback ?? ''
}
// CLI args win, then env vars, then a sensible default. npm strips unknown
// --flags so prefer the env-var or `--` form documented at the top.
const INSTALL = arg('--install', process.env.COH2_INSTALL || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2')
const OUT = arg('--out', process.env.OUT || '/tmp/test-pack.sga')

// ---------------------------------------------------------------------------
// Demo project (with extra creative decals to exercise every code path)
// ---------------------------------------------------------------------------

function buildTestProject(): Coh2SkinProject {
  // Start from the Dutch Brigade demo, then upgrade Tiger I with every decal
  // type (shield + number + name + kills + cross + image) at varied positions
  // so the export pipeline exercises all the renderers + the BC3 encoder
  // hits high-frequency content (text edges).
  const p = buildDutchBrigadeDemo()
  p.packName = 'Editor Test Pack'
  p.packDescription = 'Built end-to-end via the Node test harness — proves the SGA + RGT + BC3 pipeline produces a CoH2-loadable mod with no Mod Tools touched.'
  p.author = 'Test harness'
  // Add a balkenkreuz to every German vehicle
  for (const id of Object.keys(p.vehicles)) {
    const veh = p.vehicles[id]
    if (!veh) continue
    const nextId = Math.max(0, ...veh.decals.map(d => d.id)) + 1
    veh.decals.push({
      id: nextId, type: 'cross', x: 1700, y: 1200, rot: 0, size: 110,
    })
  }
  return p
}

// ---------------------------------------------------------------------------
// Pipeline (Node version of mod-export.ts)
// ---------------------------------------------------------------------------

const TEMPLATE_GUID = '935a02ef44344ea29108b57b9cb7b9f5'
const TEMPLATE_DIR = path.join(process.cwd(), 'public/template')
const TEMPLATE_FILES = [
  '935a02ef44344ea29108b57b9cb7b9f5.info',
  'attrib/skin_pack/german/caf_ss3_summer_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_light.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_medium.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_light.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_medium.rgd',
  'english/english.ucs',
  'ui/bin/935a02ef44344ea29108b57b9cb7b9f5.gfx',
]

function freshGuid(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(b as Uint8Array, (x: number) => x.toString(16).padStart(2, '0')).join('')
}

function rewriteGuid(buf: Uint8Array, newGuid: string): Uint8Array {
  const enc = new TextEncoder()
  const oldB = enc.encode(TEMPLATE_GUID)
  const newB = enc.encode(newGuid)
  const out = new Uint8Array(buf)
  let i = 0
  outer: while (i <= out.length - oldB.length) {
    for (let k = 0; k < oldB.length; k++) {
      if (out[i + k] !== oldB[k]) { i++; continue outer }
    }
    for (let k = 0; k < newB.length; k++) out[i + k] = newB[k]
    i += newB.length
  }
  return out
}

function rewriteInfo(buf: Uint8Array, name: string, desc: string): Uint8Array {
  let text = new TextDecoder().decode(buf)
  text = text.replace(/name\s*=\s*"[^"]*"/, `name = "${name.replace(/"/g, '\\"')}"`)
  text = text.replace(/description\s*=\s*"[^"]*"/, `description = "${desc.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
  return new TextEncoder().encode(text)
}

/** Lazy-read shim: only loads the bytes the SGA reader asks for. CoH2's
 *  ArtArmies.sga is 2.9 GB so we cannot just slurp it via fs.readFileSync. */
function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size
    const len = Math.max(0, e - start)
    return {
      arrayBuffer: async () => {
        const buf = Buffer.alloc(len)
        if (len > 0) fs.readSync(fd, buf, 0, len, start)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      },
    } as Blob
  }
  return { name: path.basename(fp), size: stat.size, slice } as unknown as File
}
async function readSgaSomewhere(archives: string, name: string): Promise<SgaArchive | null> {
  const fp = path.join(archives, name)
  if (!fs.existsSync(fp)) return null
  return SgaArchive.open(nodeFileShim(fp))
}

async function compositeVehicle(
  archives: string,
  vSpec: VehicleSpec,
  project: Coh2SkinProject,
  cache: Map<string, SgaArchive>,
): Promise<{ canvas: Canvas; difTset: string } | null> {
  const veh = project.vehicles[vSpec.id]
  if (!veh || veh.decals.length === 0) return null
  const sgaCandidates = vSpec.faction === 'german' ? ['ArtGermanEF.sga', 'ArtArmies.sga']
    : vSpec.faction === 'west_german' ? ['ArtWestGerman.sga', 'ArtHighXP1.sga']
    : vSpec.faction === 'soviet' ? ['ArtSovietEF.sga']
    : vSpec.faction === 'aef' ? ['ArtAEFSkins.sga', 'ArtAEF.sga']
    : vSpec.faction === 'british' ? ['ArtBritish.sga'] : ['ArtArmies.sga']
  // Filename aliases — a few entities use different basenames on disk
  // sourceAliases: ordered list of basenames to try when reading from the game archive
  const sourceAliases: Record<string, string[]> = {
    elefant: ['elefant_hull', 'elefant'],
    ostwind_flak_panzer: ['ostwind', 'ostwind_flak_panzer'],
    sdkfz_222: ['sdkfz221', 'sdkfz_222'],
    panther_ausf_g: ['panther', 'panther_ausf_g'],
  }
  // outputBasename: the filename the game expects inside the skin folder
  const outputBasename: Record<string, string> = {
    elefant: 'elefant_hull',
    ostwind_flak_panzer: 'ostwind',
    sdkfz_222: 'sdkfz221',
    panther_ausf_g: 'panther',
    halftrack: 'halftrack',
    sdkfz_250: 'sdkfz250',
    king_tiger_sdkfz_182: 'kingtiger',
    puma_sdkfz_234: 'puma',
    jagdtiger: 'jagdtiger',
    jagdpanzer_iv_sdkfz_162: 'jagdpanzer_iv',
    panzer_ii_luchs_sdkfz_123: 'luchs',
    panzer_iv_sdkfz_ausf_i: 'panzeriv',
    m4a3e8_sherman_easy_8: 'm4a3e8_sherman',
    m4a3_sherman_76mm: 'm4a3_sherman_76',
    m4a1_sherman_calliope: 'm4a1_calliope',
    m10_tank_destroyer: 'm10',
    m36_tank_destroyer: 'm36',
    m15a1_aa_halftrack: 'm15_aa_halftrack',
    sherman_firefly: 'firefly',
  }
  const baseNames = sourceAliases[vSpec.id] ?? [vSpec.id]
  const outBase = outputBasename[vSpec.id] ?? vSpec.id
  let sga: SgaArchive | null = null
  let rgtBytes: Uint8Array | null = null
  outer: for (const sgaName of sgaCandidates) {
    let a = cache.get(sgaName)
    if (!a) {
      a = await readSgaSomewhere(path.join(archives, 'CoH2/Archives'), sgaName)
      if (!a) continue
      cache.set(sgaName, a)
    }
    for (const base of baseNames) {
      const difPath = `art/armies/${vSpec.faction}/vehicles/${vSpec.id}/${base}_dif.rgt`
      const b = await a.readByPath(difPath)
      if (b) { sga = a; rgtBytes = b; break outer }
    }
  }
  if (!sga || !rgtBytes) return null

  const rgt = decodeRgt(rgtBytes)
  // Software-decode BC bytes → canvas
  const baseCanvas = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
  // Composite to 2048² canvas regardless of source res
  const out = createCanvas(2048, 2048)
  const ctx = out.getContext('2d')
  ctx.drawImage(baseCanvas as unknown as Canvas, 0, 0, 2048, 2048)
  const renderCtx: RenderContext = {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    palette: project.palette,
    defaultTac: vSpec.defaultTac,
    vehicleName: veh.name ?? '',
    tac: veh.tac ?? vSpec.defaultTac,
    images: project.images ?? {},
  }
  paintDecals(renderCtx, veh.decals, null)
  return { canvas: out, difTset: `art\\armies\\${vSpec.faction}\\vehicles\\${vSpec.id}\\${outBase}_dif`, outBase }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log(`install:    ${INSTALL}`)
  console.log(`output:     ${OUT}`)
  console.log()
  const project = buildTestProject()
  const cache = new Map<string, SgaArchive>()
  const newGuid = freshGuid()
  // Numeric u64 pack ID — what the engine scans for as `%I64u.sga` in
  // mods\skins\. Matches freshPackId() in src/lib/mod-export.ts.
  const numericId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000))
  console.log(`mod guid:   ${newGuid}`)
  console.log(`pack id:    ${numericId}  (engine-scannable filename)`)
  console.log(`pack name:  ${project.packName}`)
  console.log()
  const sgaFiles: SgaInputFile[] = []

  const editedIds = Object.keys(project.vehicles).filter(id =>
    (project.vehicles[id]?.decals?.length ?? 0) > 0)
  console.log(`Compositing ${editedIds.length} vehicle(s)…`)
  let composed = 0, skipped: string[] = []
  const t0 = Date.now()
  for (const id of editedIds) {
    const vSpec = VEHICLES.find(v => v.id === id)
    if (!vSpec) { skipped.push(`${id} (unknown)`); continue }
    const tStart = Date.now()
    const c = await compositeVehicle(INSTALL, vSpec, project, cache)
    if (!c) { skipped.push(id); continue }
    composed++
    const rgtBytes = canvasToRgt(c.canvas as unknown as HTMLCanvasElement, c.difTset)
    for (const season of ['summer', 'winter'] as const) {
      sgaFiles.push({
        path: `art/armies/${vSpec.faction}/vehicles/${vSpec.id}/skins/${newGuid}_${season}/${c.outBase}_dif.rgt`,
        bytes: rgtBytes, compress: false,
      })
    }
    process.stdout.write(`  ✓ ${vSpec.id.padEnd(28)} ${(Date.now() - tStart).toString().padStart(5)}ms\n`)
  }
  console.log()
  console.log(`Composited ${composed}/${editedIds.length} (${(Date.now() - t0)/1000}s)`)
  if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`)

  console.log('Reading template…')
  for (const p of TEMPLATE_FILES) {
    const fp = path.join(TEMPLATE_DIR, p)
    if (!fs.existsSync(fp)) { console.log(`  WARN missing template ${p}`); continue }
    const raw = new Uint8Array(fs.readFileSync(fp))
    if (p.endsWith('.info')) {
      sgaFiles.push({
        path: `${newGuid}.info`,
        bytes: rewriteInfo(raw, project.packName, project.packDescription),
        compress: true,
      })
    } else if (p.endsWith('.ucs')) {
      sgaFiles.push({ path: 'english/english.ucs', bytes: rewriteGuid(raw, newGuid), compress: true })
    } else if (p.includes(TEMPLATE_GUID)) {
      // Other GUID-named files — rewrite the filename
      const newPath = p.replace(TEMPLATE_GUID, newGuid)
      sgaFiles.push({ path: newPath, bytes: raw, compress: true })
    } else {
      sgaFiles.push({ path: p, bytes: raw, compress: true })
    }
  }
  console.log(`Total file count in SGA: ${sgaFiles.length}`)
  console.log('Building SGA…')
  const sgaBytes = await buildSga({ archiveName: newGuid, files: sgaFiles })
  fs.writeFileSync(OUT, Buffer.from(sgaBytes))
  const mb = (sgaBytes.length / 1024 / 1024).toFixed(2)
  console.log(`\n✓ Wrote ${OUT}  (${mb} MB, ${sgaBytes.length} bytes)`)
  console.log(`\nTo install for CoH2, copy as <numericId>.sga (engine scans %I64u.sga only):`)
  console.log(`  cp ${OUT} "$HOME/.steam/steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins/${numericId}.sga"`)
}

main().catch(err => { console.error(err); process.exit(1) })
