/**
 * Headless artifact generator for verification.
 *
 * Generates:
 *   out/verification/faceplates/<faction>_faceplate.sga  (5 files)
 *   out/verification/decals/decal_pack.sga               (1 file)
 *   out/verification/skins/<numericId>_<faction>.sga     (5 files)
 *
 * Usage:
 *   COH2_INSTALL=~/.local/share/... OUT_DIR=out/verification npx tsx tools/generate-all-artifacts.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData, type Canvas } from 'canvas'

;(global as any).ImageData = NodeImageData as any
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

// Now import project libs
import { SgaArchive } from '../src/lib/sga'
import { decodeRgt } from '../src/lib/rgt'
import { bcToCanvas } from '../src/lib/bc-decode'
import { canvasToRgt } from '../src/lib/rgt-writer'
import { buildSga, type SgaInputFile } from '../src/lib/sga-writer'
import { VEHICLES, type VehicleSpec } from '../src/lib/vehicles'
import { buildFaceplateMod } from '../src/lib/faceplate-mod-build'
import { wrapBc3InDds } from '../src/lib/faceplate-mod-build'
import { encodeBc3 } from '../src/lib/bc-encode'
import { buildDecalMod } from '../src/lib/decal-mod-build'
import { newFaceplateProject } from '../src/lib/faceplate-project'
import { newDecalPackProject } from '../src/lib/decal-pack-project'
import { freshPackId, freshModGuid, OUTPUT_BASENAME, vehicleFolder } from '../src/lib/mod-export'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COH2_INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const OUT_DIR = process.env.OUT_DIR || 'out/verification'

const WIKINGER_BASE = path.join(COH2_INSTALL, 'userdata/209941315/ugc/referenced')

// Wikinger SGA paths per faction
const WIKINGER_SGAS: Record<string, string> = {
  german:      path.join(WIKINGER_BASE, '1669111214256583712/mods/skins/Wikinger Skins.sga'),
  west_german: path.join(WIKINGER_BASE, '1789595341930052156/mods/skins/Wikinger Skins OKW.sga'),
  soviet:      path.join(WIKINGER_BASE, '789756827192794018/mods/skins/Wikinger Soviet Skins.sga'),
  aef:         path.join(WIKINGER_BASE, '1728801381585855727/mods/skins/Wikinger Skins US.sga'),
  british:     path.join(WIKINGER_BASE, '1756940317247941225/mods/skins/Wikinger Skins British.sga'),
  extra:       path.join(WIKINGER_BASE, '1764867756234976550/mods/skins/Wikinger Skins Extra.sga'),
}

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

// OUTPUT_BASENAME and vehicleFolder are imported from mod-export (single source of truth)

// ---------------------------------------------------------------------------
// Shim helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Faceplate generation
// ---------------------------------------------------------------------------

async function generateFaceplates(): Promise<void> {
  console.log('\n=== Generating Faceplates ===')
  const outDir = path.join(OUT_DIR, 'faceplates')
  fs.mkdirSync(outDir, { recursive: true })

  const factionColors: Record<string, [number, number, number]> = {
    german:      [128, 128, 128],
    west_german: [ 64,  64,  64],
    soviet:      [180,  20,  20],
    aef:         [100, 120,  50],
    british:     [200, 160,  80],
  }

  for (const faction of ['german', 'west_german', 'soviet', 'aef', 'british'] as const) {
    const proj = newFaceplateProject(`Test Faceplate - ${faction}`)
    const [r, g, b] = factionColors[faction]
    // Exactly 692 × 204 × 4 = 565024 bytes
    const atlas = new Uint8ClampedArray(692 * 204 * 4)
    for (let i = 0; i < 692 * 204; i++) {
      atlas[i * 4 + 0] = r
      atlas[i * 4 + 1] = g
      atlas[i * 4 + 2] = b
      atlas[i * 4 + 3] = 255
    }

    const result = await buildFaceplateMod({ project: proj, atlasRgba: atlas })
    const outPath = path.join(outDir, `${faction}_faceplate.sga`)
    fs.writeFileSync(outPath, Buffer.from(result.sga))
    console.log(`  OK ${faction}_faceplate.sga  guid=${result.guid}  slug=${result.slug}`)
  }
}

// ---------------------------------------------------------------------------
// Decal pack generation
// ---------------------------------------------------------------------------

async function generateDecals(): Promise<void> {
  console.log('\n=== Generating Decal Pack ===')
  const outDir = path.join(OUT_DIR, 'decals')
  fs.mkdirSync(outDir, { recursive: true })

  const proj = newDecalPackProject('Test Decal Pack')
  // iconRgba: 64×64×4
  const iconRgba = new Uint8ClampedArray(64 * 64 * 4)
  for (let i = 0; i < 64 * 64; i++) {
    iconRgba[i * 4 + 0] = (i % 64) * 4
    iconRgba[i * 4 + 1] = Math.floor(i / 64) * 4
    iconRgba[i * 4 + 2] = 128
    iconRgba[i * 4 + 3] = 255
  }
  // decalRgba: 1024×1024×4
  const decalRgba = new Uint8ClampedArray(1024 * 1024 * 4).fill(200)

  const result = await buildDecalMod({ project: proj, iconRgba, decalRgba })
  const outPath = path.join(outDir, 'decal_pack.sga')
  fs.writeFileSync(outPath, Buffer.from(result.sga))
  console.log(`  OK decal_pack.sga  guid=${result.guid}`)
}

// ---------------------------------------------------------------------------
// Vehicle skin generation
// ---------------------------------------------------------------------------

async function generateSkins(): Promise<void> {
  console.log('\n=== Generating Vehicle Skins ===')
  const outDir = path.join(OUT_DIR, 'skins')
  fs.mkdirSync(outDir, { recursive: true })

  // Build a synthesized DDS icon for skin SGAs
  const iconRgba = new Uint8ClampedArray(64 * 64 * 4).fill(128)
  iconRgba.forEach((_, i) => { if (i % 4 === 3) iconRgba[i] = 255 })
  const iconDds = wrapBc3InDds(encodeBc3(iconRgba, 64, 64), 64, 64)

  for (const faction of ['german', 'west_german', 'soviet', 'aef', 'british'] as const) {
    const newGuid = freshModGuid()
    const numericId = freshPackId()
    const sgaFiles: SgaInputFile[] = []

    // Open Wikinger SGA for this faction
    const wikiPath = WIKINGER_SGAS[faction]
    let wikinger: SgaArchive | null = null
    let wikiPaths: string[] = []
    if (fs.existsSync(wikiPath)) {
      try {
        wikinger = await SgaArchive.open(nodeFileShim(wikiPath))
        wikiPaths = wikinger.listPaths()
      } catch (e) {
        console.warn(`  WARN could not open Wikinger SGA for ${faction}: ${e}`)
      }
    } else {
      console.warn(`  WARN Wikinger SGA not found: ${wikiPath}`)
    }

    // Also open Extra SGA for supplemental coverage
    let extraWikinger: SgaArchive | null = null
    let extraPaths: string[] = []
    const extraPath = WIKINGER_SGAS.extra
    if (fs.existsSync(extraPath)) {
      try {
        extraWikinger = await SgaArchive.open(nodeFileShim(extraPath))
        extraPaths = extraWikinger.listPaths()
      } catch (e) {
        console.warn(`  WARN could not open Wikinger Extra SGA: ${e}`)
      }
    }

    const factionVehicles = VEHICLES.filter(v => v.faction === faction)
    console.log(`\n  ${faction}: ${factionVehicles.length} vehicles`)

    for (const vSpec of factionVehicles) {
      const outBase = OUTPUT_BASENAME[vSpec.id] ?? vSpec.id
      const outFolder = vehicleFolder(vSpec.id)

      let rgtCanvas: Canvas | null = null

      // Try to find and decode Wikinger RGT for this vehicle.
      // Search by real folder name (outFolder) AND by basename so folder-alias
      // vehicles (centaur→centaur_aa, t_34_85→t34_85, valentine→valentine_command)
      // are found correctly in Wikinger SGAs.
      const candidateMatch = wikiPaths.find(p =>
        p.includes(`/vehicles/${outFolder}/`) && p.endsWith('_dif.rgt')
      ) ?? wikiPaths.find(p =>
        p.endsWith(`${outBase}_dif.rgt`)
      ) ?? extraPaths.find(p =>
        p.includes(`/vehicles/${outFolder}/`) && p.endsWith('_dif.rgt')
      ) ?? extraPaths.find(p =>
        p.endsWith(`${outBase}_dif.rgt`)
      )

      if (candidateMatch) {
        try {
          const sourceArchive = wikiPaths.includes(candidateMatch) ? wikinger! : extraWikinger!
          const bytes = await sourceArchive.readByPath(candidateMatch)
          if (bytes) {
            const rgt = decodeRgt(bytes)
            rgtCanvas = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC) as unknown as Canvas
          }
        } catch (e) {
          console.warn(`    WARN could not decode Wikinger RGT for ${vSpec.id}: ${e}`)
        }
      }

      // Synthesized fallback
      if (!rgtCanvas) {
        rgtCanvas = createCanvas(2048, 2048)
        const ctx = rgtCanvas.getContext('2d')
        ctx.fillStyle = '#808080'
        ctx.fillRect(0, 0, 2048, 2048)
        console.log(`    SYNTH ${vSpec.id} — no Wikinger RGT found or decode failed; using grey solid`)
      } else {
        console.log(`    OK ${vSpec.id} -> ${outBase}`)
      }

      // Convert to RGT — use real folder + basename for the TSET path
      const difTset = `art\\armies\\${faction}\\vehicles\\${outFolder}\\${outBase}_dif`
      const rgtBytes = canvasToRgt(rgtCanvas as unknown as HTMLCanvasElement, difTset)

      // Add summer + winter entries under the real on-disk folder
      for (const season of ['summer', 'winter'] as const) {
        sgaFiles.push({
          path: `art/armies/${faction}/vehicles/${outFolder}/skins/${newGuid}_${season}/${outBase}_dif.rgt`,
          bytes: rgtBytes,
          compress: false,
        })
      }
    }

    // Add template files
    for (const p of TEMPLATE_FILES) {
      const fp = path.join(TEMPLATE_DIR, p)
      if (!fs.existsSync(fp)) {
        console.warn(`    WARN missing template ${p}`)
        continue
      }
      const raw = new Uint8Array(fs.readFileSync(fp))
      if (p.endsWith('.info')) {
        sgaFiles.push({
          path: `${newGuid}.info`,
          bytes: rewriteInfo(raw, `Test Skin Pack - ${faction}`, `Verification test skin pack for ${faction}`),
          compress: true,
        })
      } else if (p.endsWith('.ucs')) {
        sgaFiles.push({ path: 'english/english.ucs', bytes: rewriteGuid(raw, newGuid), compress: true })
      } else if (p.includes(TEMPLATE_GUID)) {
        const newPath = p.replace(TEMPLATE_GUID, newGuid)
        sgaFiles.push({ path: newPath, bytes: rewriteGuid(raw, newGuid), compress: true })
      } else {
        sgaFiles.push({ path: p, bytes: raw, compress: true })
      }
    }

    // Add icon DDS
    sgaFiles.push({
      path: `ui/assets/textures/${newGuid}_i1.dds`,
      bytes: iconDds,
      compress: true,
    })

    console.log(`  Building SGA for ${faction}: ${sgaFiles.length} files`)
    const sgaBytes = await buildSga({ archiveName: newGuid, files: sgaFiles })
    const outPath = path.join(outDir, `${numericId}_${faction}.sga`)
    fs.writeFileSync(outPath, Buffer.from(sgaBytes))
    console.log(`  OK ${path.basename(outPath)}  (${(sgaBytes.length / 1024).toFixed(0)} KB)`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`COH2_INSTALL: ${COH2_INSTALL}`)
  console.log(`OUT_DIR:      ${OUT_DIR}`)
  fs.mkdirSync(path.join(OUT_DIR, 'faceplates'), { recursive: true })
  fs.mkdirSync(path.join(OUT_DIR, 'decals'), { recursive: true })
  fs.mkdirSync(path.join(OUT_DIR, 'skins'), { recursive: true })

  await generateFaceplates()
  await generateDecals()
  await generateSkins()

  console.log('\n=== Generation complete ===')
}

main().catch(err => { console.error(err); process.exit(1) })
