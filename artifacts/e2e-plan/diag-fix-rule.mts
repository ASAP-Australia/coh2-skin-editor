/**
 * FINAL FIX CANDIDATE — fully rule-based, no hand-picked mesh names.
 *
 * A submesh contributes to the camo exclusion mask only if ALL hold:
 *   1. its class is in EXCLUDED_CLASSES, and
 *   2. it is NOT 'wreck'            (wreck reuses the intact hull's UV layout), and
 *   3. its UVs stay within [0,1]    (tiling ⇒ samples its own texture, e.g. treads), and
 *   4. its own UV island covers < AREA_MAX of the atlas
 *      (a genuine small fitting never spans the texture; anything that does is
 *       misclassified body geometry — this is what caught churchill's
 *       geo_hullgun_01/_02 without naming them).
 *
 * Run: npx tsx artifacts/e2e-plan/diag-fix-rule.mts
 */
import * as fs from 'node:fs'; import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'
;(global as any).ImageData = NodeImageData as any
;(global as any).HTMLCanvasElement = class {} as any
;(global as any).Image = Image as any
;(global as any).document = { createElement: (t: string) => { if (t === 'canvas') return createCanvas(1, 1) as any; throw new Error(t) } }
;(global as any).URL = URL

import { SgaArchive } from '../../src/lib/sga'
import { parseRgm } from '../../src/lib/rgm'
import { VEHICLES, rgmPath } from '../../src/lib/vehicles'
import { camoClassForMesh, EXCLUDED_CLASSES } from '../../src/lib/camo-mask'

const A = '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
const S = 2048          // final mask resolution
const SP = 512          // cheap probe resolution for per-mesh area
const AREA_MAX = 0.20   // rule 4 threshold

function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => { const end = e ?? st.size, len = Math.max(0, end - s)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len) fs.readSync(fd, b, 0, len, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob }
  return { name: path.basename(fp), size: st.size, slice } as unknown as File
}
function ext(m: any) {
  const at = m.geometry?.getAttribute?.('uv'); if (!at) return null
  const uv = at.array as ArrayLike<number>; let u0 = 9, u1 = -9, v0 = 9, v1 = -9
  for (let k = 0; k < at.count; k++) { const u = uv[k * 2], v = uv[k * 2 + 1]
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v }
  return { u0, u1, v0, v1 }
}
function raster(ms: any[], size = S) {
  const c = createCanvas(size, size); const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#fff'
  for (const m of ms) {
    const g = m.geometry; const at = g?.getAttribute?.('uv'); if (!at) continue
    const uv = at.array as ArrayLike<number>; const idx = g.getIndex?.()
    const px = (i: number) => uv[i * 2] * size, py = (i: number) => (1 - uv[i * 2 + 1]) * size
    const tri = (a: number, b: number, cc: number) => { ctx.beginPath(); ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b)); ctx.lineTo(px(cc), py(cc)); ctx.closePath(); ctx.fill() }
    if (idx) { const ia = idx.array as ArrayLike<number>; for (let t = 0; t + 2 < ia.length; t += 3) tri(ia[t], ia[t + 1], ia[t + 2]) }
    else for (let v = 0; v + 2 < at.count; v += 3) tri(v, v + 1, v + 2)
  }
  const d = ctx.getImageData(0, 0, size, size).data
  const bm = new Uint8Array(size * size); let n = 0
  for (let i = 0, j = 0; i < d.length; i += 4, j++) if (d[i + 3] >= 250) { bm[j] = 1; n++ }
  return { bm, n, frac: n / (size * size) }
}
function isMaskable(m: any, v: any) {
  const c = camoClassForMesh(m, v.id, v.faction)
  if (!EXCLUDED_CLASSES.has(c)) return false        // 1
  if (c === 'wreck') return false                    // 2
  const e = ext(m); if (!e) return false             // 3
  if (!(e.u0 >= -0.05 && e.u1 <= 1.05 && e.v0 >= -0.05 && e.v1 <= 1.05)) return false
  return raster([m], SP).frac < AREA_MAX             // 4
}
;(async () => {
  const names = fs.readdirSync(A).filter(f => f.endsWith('.sga'))
  const rows: any[] = []
  for (const v of VEHICLES) {
    let meshes: any[] | null = null
    for (const n of names) {
      let a: any; try { a = await SgaArchive.open(shim(path.join(A, n))) } catch { continue }
      try { const b = await a.readByPath(rgmPath(v)); if (b) { meshes = (parseRgm(b) as any).meshes; break } } catch {}
    }
    if (!meshes) { console.log(`${v.id.padEnd(26)} no rgm`); continue }
    const cls = (m: any) => camoClassForMesh(m, v.id, v.faction as any)
    const armor = meshes.filter(m => !EXCLUDED_CLASSES.has(cls(m)))
    const RA = raster(armor); const aN = RA.n || 1
    const OLD = raster(meshes.filter(m => EXCLUDED_CLASSES.has(cls(m))))
    const NEW = raster(meshes.filter(m => isMaskable(m, v)))
    const ov = (bm: Uint8Array) => { let n = 0; for (let i = 0; i < RA.bm.length; i++) if (RA.bm[i] && bm[i]) n++; return n }
    const before = ov(OLD.bm) / aN * 100, after = ov(NEW.bm) / aN * 100
    rows.push({ id: v.id, faction: v.faction, before: +before.toFixed(1), after: +after.toFixed(1), maskPct: +(NEW.frac * 100).toFixed(2) })
    console.log(`${v.id.padEnd(26)} ${v.faction.padEnd(12)} erased ${before.toFixed(1).padStart(5)}% -> ${after.toFixed(1).padStart(5)}%   mask ${(NEW.frac * 100).toFixed(1).padStart(5)}%`)
  }
  fs.writeFileSync('artifacts/e2e-plan/fix-rule-results.json', JSON.stringify(rows, null, 1))
  const after = rows.map(r => r.after)
  console.log(`\n=== RULE-BASED FIX · ${rows.length} vehicles ===`)
  console.log(`  mean erased ${(after.reduce((a, b) => a + b, 0) / after.length).toFixed(2)}%   max ${Math.max(...after).toFixed(1)}%   >5%: ${after.filter(x => x > 5).length}`)
})()
