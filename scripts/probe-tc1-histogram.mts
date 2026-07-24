/**
 * probe-tc1-histogram.mts
 * For Tiger geo_Hull and T34 T34_76_Healthy: compute a histogram of TC1 UV values
 * to understand whether there are discrete badge-atlas slots or it's a full UV map.
 * Also decode TC1 raw bytes to understand the format.
 */
import fs from 'fs'
import path from 'path'
import { SgaArchive } from '../src/lib/sga'
import { parseChunky, Reader, type Chunk } from '../src/lib/chunky'

function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size; const len = Math.max(0, e - start)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len > 0) fs.readSync(fd, b, 0, len, start); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: fp, size: stat.size, slice } as unknown as File
}

const ARCH = '/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'

interface InputElt { semantic: number; format: number; size: number }
function formatSize(fmt: number): number {
  switch (fmt) {
    case 2: return 4; case 3: return 8; case 4: return 12; case 5: return 16; case 13: return 4
    default: throw new Error(`fmt ${fmt}`)
  }
}

interface SubInfo { name: string; stride: number; numVerts: number; layout: InputElt[]; vbuf: Uint8Array }

function extractSubs(u8: Uint8Array, targetName: string): SubInfo[] {
  const { root } = parseChunky(u8)
  const results: SubInfo[] = []
  function tryParse(r: Reader, n: number): { layout: InputElt[]; nv: number; st: number; vbuf: Uint8Array } | null {
    if (n === 0 || n > 32) return null
    const layout: InputElt[] = []
    try { for (let i = 0; i < n; i++) { const s = r.u32(); r.skip(4); const f = r.u32(); layout.push({ semantic: s, format: f, size: formatSize(f) }) } } catch { return null }
    const cs = layout.reduce((s, e) => s + e.size, 0)
    const nv = r.u32(); const st = r.u32()
    if (st !== cs || nv === 0 || nv > 1_000_000) return null
    return { layout, nv, st, vbuf: r.bytes(nv * st) }
  }
  function walk(chunks: Chunk[], pn: string) {
    for (const c of chunks) {
      if (c.kind !== 'FOLD') continue
      if (c.fourCC === 'TRIM' || c.fourCC === 'MRGM') {
        const dc = c.children.find(ch => ch.kind === 'DATA' && ch.fourCC === 'DATA')
        if (!dc) continue
        const meshName = pn || c.name
        if (targetName && meshName !== targetName) { walk(c.children, pn); continue }
        try {
          let p: ReturnType<typeof tryParse> = null
          if (c.fourCC === 'TRIM' && dc.version === 5) {
            const rA = new Reader(u8, dc.payloadOffset + 8); p = tryParse(rA, rA.u32())
            if (!p) { const rB = new Reader(u8, dc.payloadOffset); p = tryParse(rB, rB.u32()) }
          } else if (c.fourCC === 'MRGM' && dc.version === 8) {
            const r = new Reader(u8, dc.payloadOffset); r.skip(1)
            const nObj = r.u32(); for (let i = 0; i < nObj; i++) { const ni = r.u32(); r.skip(ni*2+13); const nl=r.u32(); r.skip(nl) }
            const ni = r.u32(); const layout: InputElt[] = []
            for (let i = 0; i < ni; i++) { const s=r.u32(); r.skip(4); const f=r.u32(); layout.push({semantic:s,format:f,size:formatSize(f)}) }
            const nv=r.u32(); const st=r.u32(); const cs=layout.reduce((s,e)=>s+e.size,0)
            if (st===cs && nv>0 && nv<1_000_000) p={layout,nv,st,vbuf:r.bytes(nv*st)}
          }
          if (p) results.push({ name: meshName, stride: p.st, numVerts: p.nv, layout: p.layout, vbuf: p.vbuf })
        } catch { /* skip */ }
      } else {
        const nm = (c.fourCC==='MESH'||c.fourCC==='MGRP') ? (c.name||pn) : pn
        walk(c.children, nm)
      }
    }
  }
  walk(root, '')
  return results
}

async function loadRgm(sgaN: string, rgmPath: string): Promise<Uint8Array | null> {
  const fp = path.join(ARCH, sgaN)
  if (!fs.existsSync(fp)) return null
  const a = await SgaArchive.open(nodeFileShim(fp))
  return a.readByPath(rgmPath)
}

// Analyze TC1 — unique value clusters for a submesh
function analyzeTc1(sm: SubInfo, label: string) {
  let tc1Off = 0, tc1Elt: InputElt | null = null
  let byteOff = 0
  for (const elt of sm.layout) {
    if (elt.semantic === 9) { tc1Off = byteOff; tc1Elt = elt }
    byteOff += elt.size
  }
  if (!tc1Elt) { console.log(`  ${label}: no TC1`); return }

  const view = new DataView(sm.vbuf.buffer, sm.vbuf.byteOffset, sm.vbuf.byteLength)
  const fmt = tc1Elt.format

  // Unique raw bytes for TC1 (format=2 → 4 bytes at b0..b3)
  const uniqueRaw = new Map<string, number>()
  const tc1Values: {u: number; v: number}[] = []
  for (let vi = 0; vi < sm.numVerts; vi++) {
    const b = vi * sm.stride + tc1Off
    let u: number, v: number
    if (fmt === 2) {
      const b0=view.getUint8(b),b1=view.getUint8(b+1),b2=view.getUint8(b+2),b3=view.getUint8(b+3)
      const rawKey = `${b0},${b1},${b2},${b3}`
      uniqueRaw.set(rawKey, (uniqueRaw.get(rawKey) ?? 0) + 1)
      // Decode as per rgm.ts: u=b2/255, v=1-b1/255 (but we'll show raw v without flip to see atlas coords)
      u = b2 / 255; v = b1 / 255
    } else if (fmt === 3) {
      u = view.getFloat32(b, true); v = view.getFloat32(b+4, true)
      const key = `${u.toFixed(4)},${v.toFixed(4)}`
      uniqueRaw.set(key, (uniqueRaw.get(key) ?? 0) + 1)
    } else { u = 0; v = 0 }
    tc1Values.push({ u, v })
  }

  // U histogram buckets (10 bins)
  const uBins = new Array(10).fill(0)
  const vBins = new Array(10).fill(0)
  let uMin=Infinity,uMax=-Infinity,vMin=Infinity,vMax=-Infinity
  for (const {u,v} of tc1Values) {
    uMin=Math.min(uMin,u); uMax=Math.max(uMax,u)
    vMin=Math.min(vMin,v); vMax=Math.max(vMax,v)
    uBins[Math.min(9,Math.floor(u*10))]++
    vBins[Math.min(9,Math.floor(v*10))]++
  }

  console.log(`\n  ${label}: n=${sm.numVerts} TC1-fmt=${fmt}  U=[${uMin.toFixed(3)},${uMax.toFixed(3)}] V=[${vMin.toFixed(3)},${vMax.toFixed(3)}]`)
  console.log(`    Unique TC1 raw values: ${uniqueRaw.size}`)
  console.log(`    U histogram (bins 0.0-0.1, 0.1-0.2, ...): ${uBins.join(' ')}`)
  console.log(`    V histogram (bins 0.0-0.1, 0.1-0.2, ...): ${vBins.join(' ')}`)
  // Show top 10 most common raw values
  const sorted = [...uniqueRaw.entries()].sort((a,b) => b[1]-a[1]).slice(0,10)
  console.log(`    Top-10 raw values (value: count):`)
  for (const [raw, count] of sorted) {
    console.log(`      [${raw}]: ${count} (${(count/sm.numVerts*100).toFixed(1)}%)`)
  }
}

// ── Tiger geo_Hull ────────────────────────────────────────────────────────────
console.log('\n=== Tiger geo_Hull ===')
const tigerBytes = await loadRgm('ArtHigh.sga', 'art/armies/german/vehicles/tiger/tiger.rgm')
if (tigerBytes) {
  const subs = extractSubs(tigerBytes, 'geo_Hull')
  for (const sm of subs) analyzeTc1(sm, sm.name)
}

// ── T34 main hull ─────────────────────────────────────────────────────────────
console.log('\n=== T34 T34_76_Healthy ===')
const t34Bytes = await loadRgm('ArtHigh.sga', 'art/armies/soviet/vehicles/t34_76/t34_76.rgm')
if (t34Bytes) {
  const subs = extractSubs(t34Bytes, 'merged material-[t34_76,T34_76_Healthy]')
  for (const sm of subs) analyzeTc1(sm, sm.name)
}

// ── Easy8 CRS_Orphan01 ─────────────────────────────────────────────────────────
console.log('\n=== M4A3E8 CRS_Orphan01 ===')
const e8Bytes = await loadRgm('ArtHighXP1.sga', 'art/armies/aef/vehicles/m4a3e8_sherman_easy_8/m4a3e8_sherman_easy_8.rgm')
if (e8Bytes) {
  const subs = extractSubs(e8Bytes, 'CRS_Orphan01')
  for (const sm of subs) analyzeTc1(sm, sm.name)
}

console.log('\nDone.')
