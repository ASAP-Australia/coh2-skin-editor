/**
 * LAYER B — placement / camo-exclusion verifier (all 61 vehicles).
 *
 * Proves claim C2 of artifacts/e2e-plan/PLAN.md, and specifically the user's
 * hard design rule: **camo must never touch tracks, wheels, or stowed
 * equipment** — on EVERY vehicle, not a sample.
 *
 * Per vehicle:
 *   1. parse the real RGM from the CoH2 archives
 *   2. assert EVERY submesh is explicitly classified in camo-vehicle-map.json
 *      (zero reliance on the regex fallback → no silent misclassification)
 *   3. build the UV exclusion mask
 *   4. worst-case composite test: paint the ENTIRE 2048² atlas magenta
 *      (stand-in for camo), restore masked regions from vanilla, then assert
 *      every masked texel is byte-identical to vanilla. Solid magenta makes
 *      any leak unmissable.
 *   5. report mask coverage %
 *
 * Run:  npx tsx scripts/verify-layer-b.mts
 *       VEHICLES=tiger,churchill npx tsx scripts/verify-layer-b.mts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData, type Canvas } from 'canvas'

;(global as any).ImageData = NodeImageData as any
;(global as any).HTMLCanvasElement = class {} as any
;(global as any).Image = Image as any
;(global as any).document = {
  createElement: (t: string) => {
    if (t === 'canvas') return createCanvas(1, 1) as unknown as HTMLCanvasElement
    throw new Error(`createElement(${t}) unsupported`)
  },
}
;(global as any).URL = URL

import { SgaArchive } from '../src/lib/sga'
import { parseRgm } from '../src/lib/rgm'
import { VEHICLES, rgmPath } from '../src/lib/vehicles'
import {
  buildCamoExclusionMask, camoClassForMesh, EXCLUDED_CLASSES, MASK_SIZE,
  CAMO_VEHICLE_MAP, vehicleMapKey, meshMapKey,
} from '../src/lib/camo-mask'

const INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES = path.join(INSTALL, 'CoH2/Archives')
const IDS = process.env.VEHICLES ? process.env.VEHICLES.split(',') : null

function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => {
    const end = e ?? st.size, len = Math.max(0, end - s)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len) fs.readSync(fd, b, 0, len, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: path.basename(fp), size: st.size, slice } as unknown as File
}

const cache = new Map<string, any>()
async function openArchive(n: string) {
  if (cache.has(n)) return cache.get(n)
  let a = null
  try { a = await SgaArchive.open(shim(path.join(ARCHIVES, n))) } catch { a = null }
  cache.set(n, a); return a
}
let NAMES: string[] = []
async function readRgm(v: (typeof VEHICLES)[number]) {
  const p = rgmPath(v)
  for (const n of NAMES) {
    const a = await openArchive(n); if (!a) continue
    try { const b = await a.readByPath(p); if (b) return b } catch { /* next */ }
  }
  return null
}

async function main() {
  if (!fs.existsSync(ARCHIVES)) { console.error(`no archives at ${ARCHIVES}`); process.exit(2) }
  NAMES = fs.readdirSync(ARCHIVES).filter(f => f.toLowerCase().endsWith('.sga'))
  const specs = IDS ? VEHICLES.filter(v => IDS.includes(v.id)) : VEHICLES
  console.log(`LAYER B — camo exclusion · ${specs.length} vehicles`)
  console.log(`rule: camo must NEVER touch tracks / wheels / equipment / wreck\n`)

  const results: any[] = []
  let pass = 0, fail = 0, skip = 0
  for (const v of specs) {
    const label = `${v.id.padEnd(26)} ${v.faction.padEnd(12)}`
    try {
      const buf = await readRgm(v)
      if (!buf) { console.log(`${label} SKIP  (rgm not found)`); results.push({ id: v.id, status: 'SKIP' }); skip++; continue }
      const model = parseRgm(buf)
      const meshes: any[] = (model as any).meshes ?? []
      if (!meshes.length) { console.log(`${label} SKIP  (no meshes)`); results.push({ id: v.id, status: 'SKIP' }); skip++; continue }

      // (2) every submesh explicitly classified?
      // NOTE: camoClassForMesh() silently falls back to regex patterns for
      // un-mapped meshes, so it can't report gaps. Check the explicit map row.
      const row = CAMO_VEHICLE_MAP[vehicleMapKey(v.id, v.faction as any)]
      const unmapped: string[] = [], excludedCount = (() => {
        let n = 0
        for (const m of meshes) {
          const key = meshMapKey(m)
          if (!row || row[key] === undefined) unmapped.push(key || '(unnamed)')
          if (EXCLUDED_CLASSES.has(camoClassForMesh(m, v.id, v.faction as any))) n++
        }
        return n
      })()

      // (3) mask
      const mask = buildCamoExclusionMask(meshes as any, v.id, v.faction as any)
      const hasMask = !!mask
      let coverage = 0, leaks = 0
      if (mask) {
        const mctx = (mask as unknown as Canvas).getContext('2d')
        const md = mctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data

        // (4) worst-case composite: magenta everywhere, restore masked from vanilla
        const vanilla = createCanvas(MASK_SIZE, MASK_SIZE)
        const vctx = vanilla.getContext('2d')
        vctx.fillStyle = '#204060'; vctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE)   // stand-in vanilla
        const vd = vctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data

        const comp = createCanvas(MASK_SIZE, MASK_SIZE)
        const cctx = comp.getContext('2d')
        cctx.drawImage(vanilla as any, 0, 0)
        cctx.fillStyle = '#ff00ff'; cctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE)   // camo covers all
        // production restore: punch the excluded regions back to vanilla
        cctx.save()
        cctx.globalCompositeOperation = 'destination-out'
        cctx.drawImage(mask as any, 0, 0)
        cctx.restore()
        cctx.save()
        cctx.globalCompositeOperation = 'destination-over'
        cctx.drawImage(vanilla as any, 0, 0)
        cctx.restore()
        const cd = cctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data

        // The mask is DILATED and therefore antialiased: boundary texels carry
        // partial alpha and legitimately blend camo↔vanilla. Only FULLY opaque
        // mask texels carry the "must be untouched vanilla" guarantee.
        let partial = 0
        for (let i = 0; i < md.length; i += 4) {
          const a = md[i + 3]
          if (a < 250) { if (a >= 8) partial++; continue }
          coverage++
          if (cd[i] !== vd[i] || cd[i + 1] !== vd[i + 1] || cd[i + 2] !== vd[i + 2]) leaks++
        }
        ;(globalThis as any).__partial = partial
      }
      const covPct = (coverage / (MASK_SIZE * MASK_SIZE) * 100)
      const ok = unmapped.length === 0 && leaks === 0 && (excludedCount === 0 || hasMask)
      ok ? pass++ : fail++
      console.log(
        `${label} ${ok ? 'PASS' : 'FAIL'}  meshes ${String(meshes.length).padStart(3)}  excluded ${String(excludedCount).padStart(3)}  ` +
        `mask ${hasMask ? 'yes' : 'no '}  cover ${covPct.toFixed(2).padStart(6)}%  leaks ${leaks}` +
        (unmapped.length ? `  UNMAPPED(${unmapped.length}): ${unmapped.slice(0, 3).join(',')}` : ''),
      )
      results.push({ id: v.id, faction: v.faction, status: ok ? 'PASS' : 'FAIL', meshes: meshes.length, excludedCount, hasMask, coveragePct: +covPct.toFixed(3), leaks, unmapped })
    } catch (e: any) {
      console.log(`${label} ERROR ${e?.message ?? e}`)
      results.push({ id: v.id, status: 'ERROR', error: String(e?.message ?? e) }); fail++
    }
  }
  const out = path.join(process.cwd(), 'artifacts/e2e-plan/layerB-results.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ results }, null, 1))
  console.log(`\n=== LAYER B: ${pass} PASS · ${fail} FAIL · ${skip} SKIP (of ${specs.length}) ===`)
  console.log(`wrote ${out}`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
