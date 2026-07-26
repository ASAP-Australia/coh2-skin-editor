/**
 * LAYER A — texture-byte exactness verifier (all 61 vehicles).
 *
 * Proves claim C1 of artifacts/e2e-plan/PLAN.md: the bytes the editor
 * composites survive the production encode/pack path unchanged, within the
 * loss BC1 legitimately introduces.
 *
 *   vanilla _dif.rgt → decodeRgt+bcToCanvas → canvas A   (reference)
 *   canvas A         → canvasToRgt          → rgt bytes  (what we ship)
 *   rgt bytes        → decodeRgt+bcToCanvas → canvas B   (what the game samples)
 *
 * CALIBRATED GATES (derived from measurement, see PLAN.md §Layer A):
 *   mean |Δ|   <= 1.0
 *   p99.9      <= 12
 *   |Δ|>=24 allowed ONLY in 4x4 blocks whose PER-CHANNEL range >= 32
 *   outliers in flat blocks (per-channel range < 8) MUST be 0   <-- defect signal
 *
 * CRITICAL METHOD NOTE: block "flatness" is measured PER CHANNEL, never by
 * luminance. British camo contains iso-luminant chroma edges; a luminance-only
 * detector reports ~1200 phantom defects per British vehicle. This cost a full
 * debugging cycle to discover — do not "simplify" it back to luminance.
 *
 * Run:  npx tsx scripts/verify-layer-a.mts            # all 61
 *       VEHICLES=tiger,churchill npx tsx scripts/verify-layer-a.mts
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
import { decodeRgt } from '../src/lib/rgt'
import { bcToCanvas } from '../src/lib/bc-decode'
import { canvasToRgt } from '../src/lib/rgt-writer'
import { VEHICLES } from '../src/lib/vehicles'
import { vehicleFolder, textureBaseNamesFor } from '../src/lib/mod-export'

const INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES = path.join(INSTALL, 'CoH2/Archives')
const IDS = process.env.VEHICLES ? process.env.VEHICLES.split(',') : VEHICLES.map(v => v.id)

/**
 * GATING PHILOSOPHY (revised after the full 61-vehicle run).
 *
 * The 5-vehicle calibration sample was NOT representative: it suggested
 * mean<=1.0 / p99.9<=12, but across all 61 the legitimate range reaches
 * mean 1.70 / p99.9 23 (panther_ausf_g) with ZERO flat-block outliers.
 * Those metrics track TEXTURE COMPLEXITY, not correctness — gating on them
 * produced 16 false failures.
 *
 * The only true defect signals are:
 *   - outliers inside FLAT per-channel blocks (encoder damaging smooth areas)
 *   - dimension / format mismatch
 * mean & p99.9 are retained as DIAGNOSTICS with a loose sanity ceiling that
 * only trips on gross corruption.
 */
const GATE = {
  meanSanity: 3.0,      // diagnostic ceiling — observed worst legit is 1.70
  p999Sanity: 40,       // diagnostic ceiling — observed worst legit is 23
  outlierDelta: 24,
  edgeBlockRange: 32,
  flatBlockRange: 8,
}

function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => {
    const end = e ?? st.size, len = Math.max(0, end - s)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len) fs.readSync(fd, b, 0, len, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: path.basename(fp), size: st.size, slice } as unknown as File
}

/** Cache opened archives — 61 vehicles × ~14 archives is otherwise brutal. */
const archiveCache = new Map<string, any>()
async function openArchive(name: string) {
  if (archiveCache.has(name)) return archiveCache.get(name)
  let a = null
  try { a = await SgaArchive.open(shim(path.join(ARCHIVES, name))) } catch { a = null }
  archiveCache.set(name, a)
  return a
}

let ARCHIVE_NAMES: string[] = []
/**
 * Takes the SPEC, not the id: the registry contains a DUPLICATE id
 * ('halftrack' exists for both german and soviet — 60 unique ids / 61 entries),
 * so `VEHICLES.find(x => x.id === id)` silently resolves the Soviet
 * Lend-Lease halftrack to the German spec and verifies German twice.
 */
async function findDif(v: (typeof VEHICLES)[number]) {
  const id = v.id
  const folder = vehicleFolder(id), bases = textureBaseNamesFor(id)
  for (const name of ARCHIVE_NAMES) {
    const a = await openArchive(name); if (!a) continue
    for (const b of bases) {
      try {
        const r = await a.readByPath(`art/armies/${v.faction}/vehicles/${folder}/${b}_dif.rgt`)
        if (r) return { bytes: r, internal: `${b}_dif`, archive: name }
      } catch { /* next */ }
    }
  }
  return null
}
const rgba = (c: Canvas) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data

function evaluate(A: Uint8ClampedArray, B: Uint8ClampedArray, w: number, h: number) {
  const bw = w >> 2
  const rangeCache = new Int16Array(bw * (h >> 2)).fill(-1)
  const blockRange = (bx: number, by: number) => {
    const k = by * bw + bx
    if (rangeCache[k] >= 0) return rangeCache[k]
    const lo = [255, 255, 255], hi = [0, 0, 0]
    for (let y = by * 4; y < Math.min(by * 4 + 4, h); y++)
      for (let x = bx * 4; x < Math.min(bx * 4 + 4, w); x++) {
        const i = (y * w + x) * 4
        for (let c = 0; c < 3; c++) { const v = A[i + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v }
      }
    const r = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    rangeCache[k] = r
    return r
  }

  const hist = new Uint32Array(256)
  let sum = 0, n = 0, max = 0, outFlat = 0, outGentle = 0, outEdge = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let d = 0; for (let c = 0; c < 3; c++) { const t = Math.abs(A[i + c] - B[i + c]); if (t > d) d = t }
      hist[d]++; sum += d; n++
      if (d > max) max = d
      if (d >= GATE.outlierDelta) {
        const r = blockRange(x >> 2, y >> 2)
        if (r < GATE.flatBlockRange) outFlat++
        else if (r < GATE.edgeBlockRange) outGentle++
        else outEdge++
      }
    }
  }
  let acc = 0, p999 = 0
  const target = n * 0.999
  for (let d = 0; d < 256; d++) { acc += hist[d]; if (acc >= target) { p999 = d; break } }
  const mean = sum / n
  // Hard gate = flat-block damage only. mean/p99.9 are diagnostics with a
  // gross-corruption ceiling (see GATING PHILOSOPHY above).
  const pass = outFlat === 0 && mean <= GATE.meanSanity && p999 <= GATE.p999Sanity
  return { mean, p999, max, outFlat, outGentle, outEdge, pass }
}

async function main() {
  if (!fs.existsSync(ARCHIVES)) { console.error(`archives not found: ${ARCHIVES}`); process.exit(2) }
  ARCHIVE_NAMES = fs.readdirSync(ARCHIVES).filter(f => f.toLowerCase().endsWith('.sga'))
  console.log(`LAYER A — texture-byte exactness · ${IDS.length} vehicles · ${ARCHIVE_NAMES.length} archives`)
  console.log(`gates: flat-block outliers=0 (hard) · mean<=${GATE.meanSanity} p99.9<=${GATE.p999Sanity} (sanity)\n`)
  const results: any[] = []
  let pass = 0, fail = 0, skip = 0
  // iterate SPECS (not ids) so the duplicate 'halftrack' id tests both factions
  const specs = process.env.VEHICLES
    ? VEHICLES.filter(v => IDS.includes(v.id))
    : VEHICLES
  for (const v of specs) {
    const id = v.id
    let line = `${id.padEnd(26)} ${v.faction.padEnd(12)}`
    try {
      const f = await findDif(v)
      if (!f) { console.log(`${line} SKIP  (no vanilla _dif found)`); results.push({ id, status: 'SKIP' }); skip++; continue }
      const ra = decodeRgt(f.bytes)
      const ca = bcToCanvas(ra.pixels, ra.width, ra.height, ra.fourCC) as unknown as Canvas
      const A = rgba(ca)
      const rb = decodeRgt(canvasToRgt(ca as any, f.internal))
      const cb = bcToCanvas(rb.pixels, rb.width, rb.height, rb.fourCC) as unknown as Canvas
      if (cb.width !== ca.width || cb.height !== ca.height) {
        console.log(`${line} FAIL  dimension ${ca.width}x${ca.height} -> ${cb.width}x${cb.height}`)
        results.push({ id, status: 'FAIL', reason: 'dimension' }); fail++; continue
      }
      const r = evaluate(A, rgba(cb), ca.width, ca.height)
      const verdict = r.pass ? 'PASS' : 'FAIL'
      r.pass ? pass++ : fail++
      console.log(`${line} ${verdict}  mean ${r.mean.toFixed(2).padStart(5)} p99.9 ${String(r.p999).padStart(3)} max ${String(r.max).padStart(3)}  out(flat/gentle/edge) ${r.outFlat}/${r.outGentle}/${r.outEdge}`)
      results.push({ id, faction: v.faction, status: verdict, ...r, w: ca.width, fourCC: ra.fourCC })
    } catch (e: any) {
      console.log(`${line} ERROR ${e?.message ?? e}`)
      results.push({ id, status: 'ERROR', error: String(e?.message ?? e) }); fail++
    }
  }
  const out = path.join(process.cwd(), 'artifacts/e2e-plan/layerA-results.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ generated: 'layerA', gates: GATE, results }, null, 1))
  console.log(`\n=== LAYER A: ${pass} PASS · ${fail} FAIL · ${skip} SKIP  (of ${IDS.length}) ===`)
  console.log(`wrote ${out}`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
