/**
 * Resolve the Churchill anomaly found by smoke-layerA.ts.
 *
 * Hypothesis 1: churchill's texture genuinely round-trips badly (real defect).
 * Hypothesis 2: the smoke test's edge-classifier is too naive — it uses a
 *   1-pixel neighbour gradient, but BC1 quantises per 4x4 BLOCK, so a smooth
 *   gradient reads as "flat" while banding legitimately.
 *
 * This re-classifies every high-delta texel by the RANGE WITHIN ITS 4x4 BC1
 * BLOCK. If outliers concentrate in high-range blocks, H2 wins (classifier bug,
 * not a texture defect) and the Layer A detector must be fixed before shipping.
 *
 * Run: npx tsx artifacts/e2e-plan/diag-churchill.ts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData, type Canvas } from 'canvas'

;(global as any).ImageData = NodeImageData as any
;(global as any).HTMLCanvasElement = class {} as any
;(global as any).Image = Image as any
;(global as any).document = { createElement: (t: string) => { if (t === 'canvas') return createCanvas(1, 1) as any; throw new Error(t) } }
;(global as any).URL = URL

import { SgaArchive } from '../../src/lib/sga'
import { decodeRgt } from '../../src/lib/rgt'
import { bcToCanvas } from '../../src/lib/bc-decode'
import { canvasToRgt } from '../../src/lib/rgt-writer'
import { VEHICLES } from '../../src/lib/vehicles'
import { vehicleFolder, textureBaseNamesFor } from '../../src/lib/mod-export'

const INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES = path.join(INSTALL, 'CoH2/Archives')
const IDS = (process.env.VEHICLES || 'churchill,tiger').split(',')

function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => {
    const end = e ?? st.size, len = Math.max(0, end - s)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len) fs.readSync(fd, b, 0, len, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: path.basename(fp), size: st.size, slice } as unknown as File
}

async function findDif(id: string) {
  const v = VEHICLES.find(x => x.id === id); if (!v) return null
  const folder = vehicleFolder(id), bases = textureBaseNamesFor(id)
  for (const name of fs.readdirSync(ARCHIVES).filter(f => f.toLowerCase().endsWith('.sga'))) {
    let a; try { a = await SgaArchive.open(shim(path.join(ARCHIVES, name))) } catch { continue }
    for (const b of bases) {
      try { const r = await a.readByPath(`art/armies/${v.faction}/vehicles/${folder}/${b}_dif.rgt`); if (r) return { bytes: r, internal: `${b}_dif` } } catch {}
    }
  }
  return null
}
const rgba = (c: Canvas) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data

async function run(id: string) {
  const f = await findDif(id); if (!f) { console.log(`${id}: not found`); return }
  const ra = decodeRgt(f.bytes)
  const ca = bcToCanvas(ra.pixels, ra.width, ra.height, ra.fourCC) as unknown as Canvas
  const A = rgba(ca)
  const rb = decodeRgt(canvasToRgt(ca as any, f.internal))
  const cb = bcToCanvas(rb.pixels, rb.width, rb.height, rb.fourCC) as unknown as Canvas
  const B = rgba(cb)
  const w = ca.width, h = ca.height

  // per-4x4-block range of the SOURCE — MAX over R,G,B individually.
  // (luminance-only range is misleading: a block can be luminance-flat but
  //  chroma-varying, which BC1's 5:6:5 endpoints quantise coarsely.)
  const blockRange = (bx: number, by: number) => {
    const lo = [255, 255, 255], hi = [0, 0, 0]
    for (let y = by * 4; y < Math.min(by * 4 + 4, h); y++) {
      for (let x = bx * 4; x < Math.min(bx * 4 + 4, w); x++) {
        const i = (y * w + x) * 4
        for (let c = 0; c < 3; c++) {
          const v = A[i + c]
          if (v < lo[c]) lo[c] = v
          if (v > hi[c]) hi[c] = v
        }
      }
    }
    return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  }
  const cache = new Map<number, number>()
  const br = (bx: number, by: number) => {
    const k = by * (w >> 2) + bx
    let v = cache.get(k); if (v === undefined) { v = blockRange(bx, by); cache.set(k, v) }
    return v
  }

  const buckets = { flatBlock: 0, gentle: 0, edgeBlock: 0 }
  let outliers = 0, alphaSuspect = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A[i + c] - B[i + c]))
      if (d < 24) continue
      outliers++
      if (A[i + 3] < 250 || B[i + 3] < 250) alphaSuspect++
      const r = br(x >> 2, y >> 2)
      if (r < 8) buckets.flatBlock++
      else if (r < 32) buckets.gentle++
      else buckets.edgeBlock++
    }
  }
  console.log(`\n=== ${id} (${w}x${h} ${ra.fourCC}) ===`)
  console.log(`  outliers |Δ|>=24 : ${outliers}`)
  if (outliers) {
    const p = (n: number) => `${n} (${(n / outliers * 100).toFixed(1)}%)`
    console.log(`  in TRULY FLAT block (range<8)  : ${p(buckets.flatBlock)}   <-- real defect signal`)
    console.log(`  in GENTLE gradient (8..32)     : ${p(buckets.gentle)}   <-- BC1 banding, expected`)
    console.log(`  in HIGH-CONTRAST block (>=32)  : ${p(buckets.edgeBlock)}   <-- BC1 edge artifact, expected`)
    console.log(`  involving non-opaque alpha     : ${p(alphaSuspect)}`)
  }
}
;(async () => { for (const id of IDS) await run(id) })().catch(e => { console.error(e); process.exit(1) })
