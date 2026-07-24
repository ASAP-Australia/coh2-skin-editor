/**
 * probe-tc1-detail.mts — Deep dive into TEXCOORD1 for Tiger geo_Hull and M4A3E8
 *
 * For Tiger geo_Hull and Easy8 main hull:
 *   1. Decode TC0 and TC1 side by side for first 20 verts
 *   2. Identify which hull submesh is the main paintable body
 *   3. Compute TC1 cluster stats per submesh
 *   4. Check if TC1 wide spread (like 0.753x0.961) is concentrated or spread
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
const SGA_FILES = ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga']

const TARGETS = [
  { label: 'Tiger geo_Hull', sgaSearch: 'ArtHigh.sga', rgm: 'art/armies/german/vehicles/tiger/tiger.rgm', mesh: 'geo_Hull' },
  { label: 'Easy8 - all hull', sgaSearch: 'ArtHighXP1.sga', rgm: 'art/armies/aef/vehicles/m4a3e8_sherman_easy_8/m4a3e8_sherman_easy_8.rgm', mesh: null },
  { label: 'T34 main body',   sgaSearch: 'ArtHigh.sga', rgm: 'art/armies/soviet/vehicles/t34_76/t34_76.rgm', mesh: null },
]

interface InputElt { semantic: number; format: number; size: number }

function formatSize(fmt: number): number {
  switch (fmt) {
    case 2: return 4; case 3: return 8; case 4: return 12; case 5: return 16; case 13: return 4
    default: throw new Error(`Unknown format ${fmt}`)
  }
}

function decodeUVFromLayout(view: DataView, base: number, elt: InputElt, offset: number): { u: number; v: number } {
  const b = base + offset
  if (elt.format === 3) return { u: view.getFloat32(b, true), v: view.getFloat32(b + 4, true) }
  if (elt.format === 2) return { u: view.getUint8(b + 2) / 255, v: view.getUint8(b + 1) / 255 }
  return { u: NaN, v: NaN }
}

interface SubInfo {
  name: string
  stride: number
  numVerts: number
  layout: InputElt[]
  vbuf: Uint8Array
}

function extractAllSubmeshes(u8: Uint8Array): SubInfo[] {
  const { root } = parseChunky(u8)
  const results: SubInfo[] = []

  function tryParseTrimBody(r: Reader, numInput: number): { layout: InputElt[]; nv: number; st: number; vbuf: Uint8Array } | null {
    if (numInput === 0 || numInput > 32) return null
    const layout: InputElt[] = []
    try {
      for (let i = 0; i < numInput; i++) {
        const semantic = r.u32(); r.skip(4); const format = r.u32()
        layout.push({ semantic, format, size: formatSize(format) })
      }
    } catch { return null }
    const computedStride = layout.reduce((s, e) => s + e.size, 0)
    const nv = r.u32(); const st = r.u32()
    if (st !== computedStride || nv === 0 || nv > 1_000_000) return null
    const vbuf = r.bytes(nv * st)
    return { layout, nv, st, vbuf }
  }

  function walk(chunks: Chunk[], parentName: string) {
    for (const c of chunks) {
      if (c.kind !== 'FOLD') continue
      if (c.fourCC === 'TRIM' || c.fourCC === 'MRGM') {
        const dc = c.children.find(ch => ch.kind === 'DATA' && ch.fourCC === 'DATA')
        if (!dc) continue
        try {
          let parsed: { layout: InputElt[]; nv: number; st: number; vbuf: Uint8Array } | null = null
          if (c.fourCC === 'TRIM' && dc.version === 5) {
            // Try variant A (8-byte prefix)
            const rA = new Reader(u8, dc.payloadOffset + 8); parsed = tryParseTrimBody(rA, rA.u32())
            if (!parsed) { const rB = new Reader(u8, dc.payloadOffset); parsed = tryParseTrimBody(rB, rB.u32()) }
          } else if (c.fourCC === 'MRGM' && dc.version === 8) {
            const r = new Reader(u8, dc.payloadOffset); r.skip(1)
            const nObj = r.u32()
            for (let i = 0; i < nObj; i++) {
              const ni = r.u32(); r.skip(ni * 2 + 12 + 1)
              const nl = r.u32(); r.skip(nl)
            }
            const ni = r.u32()
            const layout: InputElt[] = []
            for (let i = 0; i < ni; i++) {
              const s = r.u32(); r.skip(4); const f = r.u32()
              layout.push({ semantic: s, format: f, size: formatSize(f) })
            }
            const nv = r.u32(); const st = r.u32()
            const cs = layout.reduce((s, e) => s + e.size, 0)
            if (st === cs && nv > 0 && nv < 1_000_000) {
              parsed = { layout, nv, st, vbuf: r.bytes(nv * st) }
            }
          }
          if (parsed) results.push({ name: parentName || c.name, stride: parsed.st, numVerts: parsed.nv, layout: parsed.layout, vbuf: parsed.vbuf })
        } catch { /* skip */ }
      } else {
        const nm = (c.fourCC === 'MESH' || c.fourCC === 'MGRP') ? (c.name || parentName) : parentName
        walk(c.children, nm)
      }
    }
  }
  walk(root, '')
  return results
}

async function loadRgm(sgaFile: string, rgmPath: string): Promise<Uint8Array | null> {
  const fp = path.join(ARCH, sgaFile)
  if (!fs.existsSync(fp)) return null
  const a = await SgaArchive.open(nodeFileShim(fp))
  return a.readByPath(rgmPath)
}

for (const target of TARGETS) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`TARGET: ${target.label}`)

  const bytes = await loadRgm(target.sgaSearch, target.rgm)
  if (!bytes) { console.log('NOT FOUND'); continue }

  const submeshes = extractAllSubmeshes(bytes)
  const filterSubs = target.mesh
    ? submeshes.filter(s => s.name === target.mesh)
    : submeshes.filter(s => !/(track|tread|wreck|critical)/i.test(s.name) && s.numVerts > 100)

  for (const sm of filterSubs.slice(0, 8)) {
    // Find layout offsets
    let tc0Off = -1, tc1Off = -1
    let tc0Elt: InputElt | null = null, tc1Elt: InputElt | null = null
    let byteOff = 0
    for (const elt of sm.layout) {
      if (elt.semantic === 8) { tc0Off = byteOff; tc0Elt = elt }
      if (elt.semantic === 9) { tc1Off = byteOff; tc1Elt = elt }
      byteOff += elt.size
    }

    const hasTc1 = tc1Off >= 0 && tc1Elt !== null
    if (!hasTc1) {
      console.log(`  ${sm.name.padEnd(40)} n=${sm.numVerts}  NO TC1`)
      continue
    }

    const view = new DataView(sm.vbuf.buffer, sm.vbuf.byteOffset, sm.vbuf.byteLength)
    const stride = sm.stride

    // Compute TC0 and TC1 range
    let u0min = Infinity, u0max = -Infinity, v0min = Infinity, v0max = -Infinity
    let u1min = Infinity, u1max = -Infinity, v1min = Infinity, v1max = -Infinity
    let nonZero1 = 0

    const sample0s: {u: number; v: number}[] = []
    const sample1s: {u: number; v: number}[] = []

    for (let vi = 0; vi < sm.numVerts; vi++) {
      const base = vi * stride
      if (tc0Elt) {
        const { u, v } = decodeUVFromLayout(view, base, tc0Elt, tc0Off)
        u0min = Math.min(u0min, u); u0max = Math.max(u0max, u)
        v0min = Math.min(v0min, v); v0max = Math.max(v0max, v)
        if (vi < 5) sample0s.push({ u, v })
      }
      const { u, v } = decodeUVFromLayout(view, base, tc1Elt!, tc1Off)
      if (Math.abs(u) > 1e-6 || Math.abs(v) > 1e-6) nonZero1++
      u1min = Math.min(u1min, u); u1max = Math.max(u1max, u)
      v1min = Math.min(v1min, v); v1max = Math.max(v1max, v)
      if (vi < 5) sample1s.push({ u, v })
    }

    const tc1W = u1max - u1min, tc1H = v1max - v1min
    console.log(`  ${sm.name.padEnd(40)} n=${sm.numVerts.toString().padStart(5)}  TC0=[${u0min.toFixed(3)},${u0max.toFixed(3)}]x[${v0min.toFixed(3)},${v0max.toFixed(3)}]  TC1=[${u1min.toFixed(3)},${u1max.toFixed(3)}]x[${v1min.toFixed(3)},${v1max.toFixed(3)}]  TC1-clust=${tc1W.toFixed(3)}x${tc1H.toFixed(3)}  TC1-nonZero=${(nonZero1/sm.numVerts*100).toFixed(0)}%`)

    // Sample first 5 verts
    console.log(`    First 5 verts TC0/TC1:`)
    for (let i = 0; i < Math.min(5, sm.numVerts); i++) {
      const base = i * stride
      const tc0 = tc0Elt ? decodeUVFromLayout(view, base, tc0Elt, tc0Off) : { u: NaN, v: NaN }
      const tc1 = decodeUVFromLayout(view, base, tc1Elt!, tc1Off)
      console.log(`      v${i}: TC0=(${tc0.u.toFixed(4)}, ${tc0.v.toFixed(4)})  TC1=(${tc1.u.toFixed(4)}, ${tc1.v.toFixed(4)})`)
    }
  }
}

console.log('\nDone.')
