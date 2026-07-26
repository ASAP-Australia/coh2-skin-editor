/**
 * LAYER B — camo placement / armor-protection verifier (all 61 vehicles).
 *
 * Proves claim C2 of artifacts/e2e-plan/PLAN.md and the user's hard design
 * rule — **camo must never touch tracks, wheels or stowed equipment** — on
 * EVERY vehicle, using the PRODUCTION `buildCamoExclusionMask`, not a
 * re-implementation.
 *
 * Two properties per vehicle, both gated:
 *   1. ARMOR PROTECTION — the mask must not overlap the armor UV islands.
 *      (The shipped P0 erased 88.7% of armor on average; see PLAN §2d.)
 *   2. CLASSIFICATION COVERAGE — every submesh must be explicitly present in
 *      camo-vehicle-map.json, so nothing silently falls back to regex.
 *
 * Reported (not gated): mask coverage, and whether genuine fittings are still
 * masked — a mask that protects armor by masking *nothing* would be a
 * regression in the opposite direction, so `maskedVehicles` is surfaced.
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
  buildCamoExclusionMask, camoClassForMesh, EXCLUDED_CLASSES, MASK_SIZE as S,
  CAMO_VEHICLE_MAP, vehicleMapKey, meshMapKey,
} from '../src/lib/camo-mask'

const INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES = path.join(INSTALL, 'CoH2/Archives')
const IDS = process.env.VEHICLES ? process.env.VEHICLES.split(',') : null

/**
 * Gate: fraction of armor texels the mask may overlap.
 *
 * WHY 15% AND NOT ~0%. Two effects put a floor on this that is NOT a defect:
 *  - **Boundary sharing.** Adjacent UV islands share edge texels; rasterising a
 *    fitting island necessarily marks texels the armor island also covers.
 *    Measured: tiger 1.44% undilated / 1.72% dilated — so dilation contributes
 *    only ~0.3pp and the rest is packing adjacency.
 *  - **Merged-mesh overlap.** On MRGM-v8 models the single body mesh has a
 *    large UV footprint that legitimately spans a fitting's island
 *    (m21_mortar_halftrack: 7.80%, the `m1_81mm_mortar` submesh).
 *
 * The gate exists to catch a REGRESSION to the shipped bug class, which sat at
 * 40–100% armor erased (fleet mean 88.7%). 15% keeps ~2.5x margin below the
 * cheapest real failure while tolerating packing physics. Chasing ~0% here
 * would mean tuning the threshold to the data — the mistake Layer A already
 * made once (see PLAN §2d "GATING PHILOSOPHY").
 *
 * Mean and max are reported so silent drift is still visible.
 */
const MAX_ARMOR_ERASED = 0.15

function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => { const end = e ?? st.size, len = Math.max(0, end - s)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len) fs.readSync(fd, b, 0, len, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob }
  return { name: path.basename(fp), size: st.size, slice } as unknown as File
}
const cache = new Map<string, any>()
async function openArchive(n: string) {
  if (cache.has(n)) return cache.get(n)
  let a = null; try { a = await SgaArchive.open(shim(path.join(ARCHIVES, n))) } catch { a = null }
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

/** Rasterise UV0 triangles of a mesh list → bitmap of covered texels. */
function raster(meshes: any[]) {
  const c = createCanvas(S, S); const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, S, S); ctx.fillStyle = '#fff'
  for (const m of meshes) {
    const g = m.geometry; const at = g?.getAttribute?.('uv'); if (!at) continue
    const uv = at.array as ArrayLike<number>; const idx = g.getIndex?.()
    const px = (i: number) => uv[i * 2] * S, py = (i: number) => (1 - uv[i * 2 + 1]) * S
    const tri = (a: number, b: number, cc: number) => {
      ctx.beginPath(); ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b)); ctx.lineTo(px(cc), py(cc)); ctx.closePath(); ctx.fill()
    }
    if (idx) { const ia = idx.array as ArrayLike<number>; for (let t = 0; t + 2 < ia.length; t += 3) tri(ia[t], ia[t + 1], ia[t + 2]) }
    else for (let v = 0; v + 2 < at.count; v += 3) tri(v, v + 1, v + 2)
  }
  const d = ctx.getImageData(0, 0, S, S).data
  const bm = new Uint8Array(S * S); let n = 0
  for (let i = 0, j = 0; i < d.length; i += 4, j++) if (d[i + 3] >= 250) { bm[j] = 1; n++ }
  return { bm, n }
}

async function main() {
  if (!fs.existsSync(ARCHIVES)) { console.error(`no archives at ${ARCHIVES}`); process.exit(2) }
  NAMES = fs.readdirSync(ARCHIVES).filter(f => f.toLowerCase().endsWith('.sga'))
  const specs = IDS ? VEHICLES.filter(v => IDS.includes(v.id)) : VEHICLES
  console.log(`LAYER B — camo armor-protection · ${specs.length} vehicles`)
  console.log(`gates: armor erased < ${(MAX_ARMOR_ERASED * 100).toFixed(0)}% (regression gate; see header) · zero unmapped submeshes\n`)

  const results: any[] = []
  let pass = 0, fail = 0, skip = 0, masked = 0
  for (const v of specs) {
    const label = `${v.id.padEnd(26)} ${v.faction.padEnd(12)}`
    try {
      const buf = await readRgm(v)
      if (!buf) { console.log(`${label} SKIP (rgm not found)`); results.push({ id: v.id, status: 'SKIP' }); skip++; continue }
      const meshes: any[] = (parseRgm(buf) as any).meshes ?? []
      if (!meshes.length) { console.log(`${label} SKIP (no meshes)`); results.push({ id: v.id, status: 'SKIP' }); skip++; continue }

      // (2) classification coverage — explicit map, no silent regex fallback
      const row = CAMO_VEHICLE_MAP[vehicleMapKey(v.id, v.faction as any)]
      const unmapped = meshes.filter(m => !row || row[meshMapKey(m)] === undefined)
        .map(m => meshMapKey(m) || '(unnamed)')

      // (1) armor protection — PRODUCTION mask vs independently rasterised armor
      const armor = meshes.filter(m => !EXCLUDED_CLASSES.has(camoClassForMesh(m, v.id, v.faction as any)))
      const RA = raster(armor)
      // Dilated mask = what ships (4px ring prevents camo halos at fitting
      // borders). Undilated = the true UV footprint. GATE on the undilated
      // figure: dilation adjacency is intentional and unavoidable, so gating
      // on it would just be fitting the threshold to the data.
      const mask = buildCamoExclusionMask(meshes as any, v.id, v.faction as any)
      const maskRaw = buildCamoExclusionMask(meshes as any, v.id, v.faction as any, S, 0)
      const erasedOf = (mk: any) => {
        if (!mk) return { erased: 0, frac: 0 }
        const md = (mk as unknown as Canvas).getContext('2d').getImageData(0, 0, S, S).data
        let erased = 0, mpx = 0
        for (let i = 0, j = 0; i < md.length; i += 4, j++) {
          if (md[i + 3] < 250) continue
          mpx++
          if (RA.bm[j]) erased++
        }
        return { erased, frac: RA.n ? erased / RA.n : 0, maskFrac: mpx / (S * S) }
      }
      if (mask) masked++
      const dil = erasedOf(mask) as any
      const rawM = erasedOf(maskRaw) as any
      const erasedFrac = rawM.frac                 // gated
      const erasedDilated = dil.frac               // reported
      const maskFrac = dil.maskFrac ?? 0
      const ok = unmapped.length === 0 && erasedFrac < MAX_ARMOR_ERASED
      ok ? pass++ : fail++
      console.log(
        `${label} ${ok ? 'PASS' : 'FAIL'}  meshes ${String(meshes.length).padStart(3)}  ` +
        `armor-erased(raw) ${(erasedFrac * 100).toFixed(2).padStart(5)}%  (dilated ${(erasedDilated * 100).toFixed(2)}%)  mask ${(maskFrac * 100).toFixed(2).padStart(5)}%` +
        (unmapped.length ? `  UNMAPPED(${unmapped.length}): ${unmapped.slice(0, 3).join(',')}` : ''),
      )
      results.push({ id: v.id, faction: v.faction, status: ok ? 'PASS' : 'FAIL', meshes: meshes.length, armorErasedPct: +(erasedFrac * 100).toFixed(3), armorErasedDilatedPct: +(erasedDilated * 100).toFixed(3), maskPct: +(maskFrac * 100).toFixed(3), unmapped })
    } catch (e: any) {
      console.log(`${label} ERROR ${e?.message ?? e}`)
      results.push({ id: v.id, status: 'ERROR', error: String(e?.message ?? e) }); fail++
    }
  }
  const out = path.join(process.cwd(), 'artifacts/e2e-plan/layerB-results.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ gate: MAX_ARMOR_ERASED, results }, null, 1))
  const erased = results.filter(r => r.armorErasedPct !== undefined).map(r => r.armorErasedPct)
  console.log(`\n=== LAYER B: ${pass} PASS · ${fail} FAIL · ${skip} SKIP (of ${specs.length}) ===`)
  if (erased.length) console.log(`  armor erased: mean ${(erased.reduce((a, b) => a + b, 0) / erased.length).toFixed(3)}%  max ${Math.max(...erased).toFixed(2)}%`)
  console.log(`  vehicles with a non-empty mask: ${masked}/${specs.length} (0% mask is correct for merged-mesh models — PLAN §2e)`)
  console.log(`wrote ${out}`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
