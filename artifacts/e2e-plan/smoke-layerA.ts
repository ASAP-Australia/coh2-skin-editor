/**
 * SMOKE TEST for Layer A of the E2E verification plan.
 *
 * Question it answers: what is the REAL per-texel error introduced by the
 * production encode path (canvasToRgt → BC1) so Layer A's pass/fail
 * thresholds can be calibrated from data instead of guessed.
 *
 * Method (uses the exact production libs, no re-implementation):
 *   vanilla _dif.rgt  →  decodeRgt + bcToCanvas   → canvas A  (reference)
 *   canvas A          →  canvasToRgt              → rgt bytes (what we ship)
 *   rgt bytes         →  decodeRgt + bcToCanvas   → canvas B  (what the game samples)
 *   compare A vs B per channel; classify outliers as edge-adjacent vs interior.
 *
 * Interior outliers are the dangerous class: BC1 block artifacts cluster on
 * high-contrast edges, so an isolated FLAT-region outlier implies a real bug.
 *
 * Run:
 *   cd /var/home/jflessenkemper/dev/coh2-skin-editor && \
 *     npx tsx artifacts/e2e-plan/smoke-layerA.ts
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
    throw new Error(`createElement(${tag}) unsupported`)
  },
}
;(global as any).URL = URL

import { SgaArchive } from '../../src/lib/sga'
import { decodeRgt } from '../../src/lib/rgt'
import { bcToCanvas } from '../../src/lib/bc-decode'
import { canvasToRgt } from '../../src/lib/rgt-writer'
import { VEHICLES } from '../../src/lib/vehicles'
import { OUTPUT_BASENAME, vehicleFolder, textureBaseNamesFor } from '../../src/lib/mod-export'

const INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES = path.join(INSTALL, 'CoH2/Archives')
const SAMPLE = (process.env.VEHICLES || 'tiger,t34,sherman').split(',')

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

/** Find a vehicle's vanilla _dif.rgt by scanning every archive (general, not faction-hardcoded). */
async function findVanillaDif(id: string): Promise<{ bytes: Uint8Array; internal: string } | null> {
  const v = VEHICLES.find(x => x.id === id)
  if (!v) return null
  const folder = vehicleFolder(id)
  const bases = textureBaseNamesFor(id)
  const archives = fs.readdirSync(ARCHIVES).filter(f => f.toLowerCase().endsWith('.sga'))
  for (const name of archives) {
    let a
    try { a = await SgaArchive.open(nodeFileShim(path.join(ARCHIVES, name))) } catch { continue }
    for (const base of bases) {
      const p = `art/armies/${v.faction}/vehicles/${folder}/${base}_dif.rgt`
      try {
        const b = await a.readByPath(p)
        if (b) return { bytes: b, internal: `${base}_dif` }
      } catch { /* keep scanning */ }
    }
  }
  return null
}

function toRGBA(c: Canvas) {
  const ctx = c.getContext('2d')
  return ctx.getImageData(0, 0, c.width, c.height).data
}

function analyse(A: Uint8ClampedArray, B: Uint8ClampedArray, w: number, h: number) {
  const diffs: number[] = []
  let sum = 0, n = 0, max = 0
  const bad: Array<{ x: number; y: number; d: number; grad: number }> = []
  // local gradient on A → decide edge vs flat
  const lum = (i: number) => 0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      let d = 0
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A[i + c] - B[i + c]))
      sum += d; n++; diffs.push(d)
      if (d > max) max = d
      if (d >= 24) {
        const g = Math.max(
          Math.abs(lum(i) - lum(i - 4)), Math.abs(lum(i) - lum(i + 4)),
          Math.abs(lum(i) - lum(i - w * 4)), Math.abs(lum(i) - lum(i + w * 4)),
        )
        bad.push({ x, y, d, grad: g })
      }
    }
  }
  diffs.sort((a, b) => a - b)
  const pct = (p: number) => diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * p))]
  const interior = bad.filter(b => b.grad < 8)
  return {
    mean: sum / n, p50: pct(0.5), p99: pct(0.99), p999: pct(0.999), max,
    over24: bad.length, over24Interior: interior.length,
    interiorPct: bad.length ? (interior.length / bad.length) * 100 : 0,
  }
}

async function main() {
  console.log(`Layer A calibration — install: ${INSTALL}\n`)
  const rows: string[] = []
  for (const id of SAMPLE) {
    const found = await findVanillaDif(id)
    if (!found) { console.log(`${id.padEnd(10)} SKIP (vanilla _dif not found)`); continue }
    const rgtA = decodeRgt(found.bytes)
    const cvA = bcToCanvas(rgtA.pixels, rgtA.width, rgtA.height, rgtA.fourCC) as unknown as Canvas
    const A = toRGBA(cvA)

    const reBytes = canvasToRgt(cvA as unknown as HTMLCanvasElement, found.internal)
    const rgtB = decodeRgt(reBytes)
    const cvB = bcToCanvas(rgtB.pixels, rgtB.width, rgtB.height, rgtB.fourCC) as unknown as Canvas
    const B = toRGBA(cvB)

    if (cvA.width !== cvB.width || cvA.height !== cvB.height) {
      console.log(`${id.padEnd(10)} FAIL dimension mismatch ${cvA.width}x${cvA.height} vs ${cvB.width}x${cvB.height}`)
      continue
    }
    const r = analyse(A, B, cvA.width, cvA.height)
    console.log(
      `${id.padEnd(10)} ${cvA.width}x${cvA.height} ${String(rgtA.fourCC).padEnd(5)} ` +
      `mean ${r.mean.toFixed(2)}  p50 ${r.p50}  p99 ${r.p99}  p99.9 ${r.p999}  max ${r.max}  ` +
      `|Δ|≥24: ${r.over24} (interior ${r.over24Interior}, ${r.interiorPct.toFixed(1)}%)`,
    )
    rows.push(JSON.stringify({ id, ...r, w: cvA.width, fourCC: rgtA.fourCC }))
  }
  const out = path.join(process.cwd(), 'artifacts/e2e-plan/smoke-layerA-results.jsonl')
  fs.writeFileSync(out, rows.join('\n') + '\n')
  console.log(`\nwrote ${out}`)
  console.log('\nInterpretation: BC1 error should concentrate on EDGES. A high interior-outlier')
  console.log('percentage would mean the encoder is degrading flat regions → real bug.')
}
main().catch(e => { console.error(e); process.exit(1) })
