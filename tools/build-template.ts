/**
 * build-template.ts — generate N unsigned template SGAs for Workshop publication.
 *
 * Each template SGA contains placeholder textures (solid colour) for every
 * vehicle in the catalog, stored UNCOMPRESSED so the byte length is fully
 * deterministic. After publishing via Mod Tools, Relic appends the 140-byte
 * RSA sig block and the signed SGA becomes a "key" the app can patch.
 *
 * Usage:
 *   npx tsx tools/build-template.ts [--count 1] [--out tools/templates]
 *
 * Each template is written as: tools/templates/template_NNNN.sga
 * A seeds file is written to: tools/templates/seeds.json
 * (seeds.json maps template index → { guid, vehicles })
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
    throw new Error(`createElement(${tag}) not supported`)
  },
}
;(global as any).URL = URL

import { canvasToRgt } from '../src/lib/rgt-writer'
import { buildSga, type SgaInputFile } from '../src/lib/sga-writer'
import { VEHICLES } from '../src/lib/vehicles'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const COUNT = parseInt(arg('--count', '1'), 10)
const OUT_DIR = arg('--out', path.join(process.cwd(), 'tools/templates'))

const TEMPLATE_DIR = path.join(process.cwd(), 'public/template')
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
  'ui/bin/935a02ef44344ea29108b57b9cb7b9f5.gfx',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

/** Paint a solid-colour 2048×2048 canvas and encode it as an uncompressed RGT.
 *  The output length is fully deterministic (content-independent BC3). */
function placeholderRgt(difTset: string): Uint8Array {
  const canvas = createCanvas(2048, 2048)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3d5a3e'   // CoH2-ish grey-green
  ctx.fillRect(0, 0, 2048, 2048)
  return canvasToRgt(canvas as unknown as HTMLCanvasElement, difTset, { compress: false })
}

/** Output basename aliases — the filename inside the skin folder must match
 *  the vehicle's actual texture basename in the game archives. */
const OUTPUT_BASENAME: Record<string, string> = {
  elefant:               'elefant_hull',
  ostwind_flak_panzer:   'ostwind',
  sdkfz_222:             'sdkfz221',
  panther_ausf_g:        'panther',
  halftrack:             'halftrack',
  sdkfz_250:             'sdkfz250',
  king_tiger_sdkfz_182:  'kingtiger',
  puma_sdkfz_234:        'puma',
  jagdtiger:             'jagdtiger',
  jagdpanzer_iv_sdkfz_162: 'jagdpanzer_iv',
  panzer_ii_luchs_sdkfz_123: 'luchs',
  panzer_iv_sdkfz_ausf_i: 'panzeriv',
  m4a3e8_sherman_easy_8: 'm4a3e8_sherman',
  m4a3_sherman_76mm:     'm4a3_sherman_76',
  m4a1_sherman_calliope: 'm4a1_calliope',
  m10_tank_destroyer:    'm10',
  m36_tank_destroyer:    'm36',
  m15a1_aa_halftrack:    'm15_aa_halftrack',
  sherman_firefly:       'firefly',
}

function outputBasename(vehicleId: string): string {
  return OUTPUT_BASENAME[vehicleId] ?? vehicleId
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // Pre-generate one placeholder RGT (solid colour, same colour for all vehicles).
  // All vehicles use the same source canvas size (2048²) so the output byte
  // length is identical for every entry — confirmed below.
  console.log('Pre-generating placeholder RGT (fixed size)…')
  const dummyCanvas = createCanvas(2048, 2048)
  const dummyCtx = dummyCanvas.getContext('2d')
  dummyCtx.fillStyle = '#3d5a3e'
  dummyCtx.fillRect(0, 0, 2048, 2048)
  const dummyRgt = canvasToRgt(dummyCanvas as unknown as HTMLCanvasElement, 'placeholder', { compress: false })
  console.log(`  Placeholder RGT size: ${dummyRgt.length} bytes (${(dummyRgt.length / 1024 / 1024).toFixed(2)} MB)`)

  // Load template helper files
  const templateBytes: Record<string, Uint8Array> = {}
  for (const p of TEMPLATE_FILES) {
    const fp = path.join(TEMPLATE_DIR, p)
    if (fs.existsSync(fp)) templateBytes[p] = new Uint8Array(fs.readFileSync(fp))
    else console.warn(`  WARN: missing template file ${p}`)
  }

  const seeds: Array<{ index: number; guid: string; rgtSize: number }> = []

  for (let n = 1; n <= COUNT; n++) {
    const guid = freshGuid()
    const idx = String(n).padStart(4, '0')
    console.log(`\nTemplate ${idx}/${COUNT}  guid=${guid}`)

    const sgaFiles: SgaInputFile[] = []

    // Add one uncompressed RGT per vehicle × 2 seasons
    for (const vSpec of VEHICLES) {
      const baseName = outputBasename(vSpec.id)
      const difTset = `art\\armies\\${vSpec.faction}\\vehicles\\${vSpec.id}\\${baseName}_dif`
      // Generate per-vehicle RGT (same fixed size, different internal name only)
      const rgtBytes = canvasToRgt(
        dummyCanvas as unknown as HTMLCanvasElement,
        difTset,
        { compress: false },
      )
      for (const season of ['summer', 'winter'] as const) {
        const sgaPath = `art/armies/${vSpec.faction}/vehicles/${vSpec.id}/skins/${guid}_${season}/${baseName}_dif.rgt`
        sgaFiles.push({ path: sgaPath, bytes: rgtBytes, compress: false })
      }
      process.stdout.write(`  ${vSpec.id}\n`)
    }

    // Template files with GUID rewrite
    for (const p of TEMPLATE_FILES) {
      const raw = templateBytes[p]
      if (!raw) continue
      if (p.endsWith('.info')) {
        sgaFiles.push({
          path: p.replace(TEMPLATE_GUID, guid),
          bytes: rewriteInfo(rewriteGuid(raw, guid), `Template ${idx}`, `Pre-signed key template ${idx} — patch me`),
          compress: true,
        })
      } else if (p.endsWith('.ucs')) {
        sgaFiles.push({ path: 'english/english.ucs', bytes: rewriteGuid(raw, guid), compress: true })
      } else if (p.includes(TEMPLATE_GUID)) {
        sgaFiles.push({ path: p.replace(TEMPLATE_GUID, guid), bytes: raw, compress: true })
      } else {
        sgaFiles.push({ path: p, bytes: raw, compress: true })
      }
    }

    console.log(`  Building SGA (${sgaFiles.length} files)…`)
    const sgaBytes = await buildSga({ archiveName: guid, files: sgaFiles })
    const outPath = path.join(OUT_DIR, `template_${idx}.sga`)
    fs.writeFileSync(outPath, Buffer.from(sgaBytes))
    console.log(`  ✓ ${outPath}  (${(sgaBytes.length / 1024 / 1024).toFixed(2)} MB)`)

    seeds.push({ index: n, guid, rgtSize: dummyRgt.length })
  }

  // Write seeds file
  const seedsPath = path.join(OUT_DIR, 'seeds.json')
  fs.writeFileSync(seedsPath, JSON.stringify({ generated: new Date().toISOString(), seeds }, null, 2))
  console.log(`\n✓ seeds.json written to ${seedsPath}`)
  console.log('\nNext step: publish each template_NNNN.sga via CoH2 Mod Tools,')
  console.log('then run: npx tsx tools/build-manifest.ts')
}

main().catch(err => { console.error(err); process.exit(1) })
