/**
 * probe-uv-channels.mts — Badge/decal UV channel survey
 *
 * For each of 4 test vehicles, dumps:
 *   - every TEXCOORD semantic present in every submesh
 *   - for TEXCOORD1 (sem=9) and any other non-zero TEXCOORDs: value range,
 *     non-zero fraction, distinctness vs TEXCOORD0, UV bounding box
 *
 * Usage: cd /var/home/jflessenkemper/dev/coh2-skin-editor && npx tsx scripts/probe-uv-channels.mts
 *
 * Output: /tmp/coh2-evidence/uv-channel/dump.json + console summary
 */

import fs from 'fs'
import path from 'path'
import { SgaArchive } from '../src/lib/sga'
import { parseChunky, findAllChunks, Reader, type Chunk } from '../src/lib/chunky'

// ── Node File shim ──────────────────────────────────────────────────────────────
function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size
    const len = Math.max(0, e - start)
    return {
      arrayBuffer: async () => {
        const b = Buffer.alloc(len)
        if (len > 0) fs.readSync(fd, b, 0, len, start)
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
      },
    } as Blob
  }
  return { name: path.basename(fp), size: stat.size, slice } as unknown as File
}

// ── Config ──────────────────────────────────────────────────────────────────────
const ARCH = '/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
const SGAFILES = [
  'ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga',
  'ArtGermanEF.sga', 'ArtSovietEF.sga', 'ArtBritish.sga', 'ArtAEF.sga', 'ArtArmies.sga',
]

const VEHICLES: Array<{ label: string; path: string }> = [
  { label: 'Tiger (german)',        path: 'art/armies/german/vehicles/tiger/tiger.rgm' },
  { label: 'T-34/76 (soviet)',      path: 'art/armies/soviet/vehicles/t34_76/t34_76.rgm' },
  { label: 'M4A3E8 Easy8 (us/aef)', path: 'art/armies/aef/vehicles/m4a3e8_sherman_easy_8/m4a3e8_sherman_easy_8.rgm' },
  { label: 'Cromwell (british)',    path: 'art/armies/british/vehicles/cromwell/cromwell.rgm' },
]

const OUT_DIR = '/tmp/coh2-evidence/uv-channel'
fs.mkdirSync(OUT_DIR, { recursive: true })

// ── SEMANTIC names ──────────────────────────────────────────────────────────────
// From rgm.ts + Corsix fxinfo.ext (TEXCOORD9=14)
const SEMANTIC_NAME: Record<number, string> = {
  0: 'POSITION', 1: 'BLENDINDICES', 2: 'BLENDWEIGHT', 3: 'NORMAL',
  4: 'BINORMAL', 5: 'TANGENT', 6: 'COLOR',
  8: 'TEXCOORD0', 9: 'TEXCOORD1', 10: 'TEXCOORD2', 11: 'TEXCOORD3',
  12: 'TEXCOORD4', 13: 'TEXCOORD5', 14: 'TEXCOORD9',  // Corsix: TEXCOORD9=14
}

// ── Format sizes ────────────────────────────────────────────────────────────────
function formatSize(fmt: number): number {
  switch (fmt) {
    case 2:  return 4   // R8G8B8A8
    case 3:  return 8   // R32G32_FLOAT
    case 4:  return 12  // R32G32B32_FLOAT
    case 5:  return 16  // R32G32B32A32_FLOAT
    case 13: return 4   // R8G8B8A8_UINT
    default: throw new Error(`Unknown format ${fmt}`)
  }
}

interface InputElt { semantic: number; format: number; size: number }

// ── Parse input layout ──────────────────────────────────────────────────────────
function parseInputLayout(r: Reader, numInput: number): InputElt[] | null {
  if (numInput === 0 || numInput > 32) return null
  const layout: InputElt[] = []
  try {
    for (let i = 0; i < numInput; i++) {
      const semantic = r.u32()
      r.skip(4)  // semantic index
      const format = r.u32()
      layout.push({ semantic, format, size: formatSize(format) })
    }
  } catch { return null }
  return layout
}

// ── Extract all submesh data from a chunky tree ─────────────────────────────────
interface SubmeshInfo {
  name: string
  numVerts: number
  stride: number
  semantics: number[]     // all semantic ids present in layout
  layout: InputElt[]
  vertexBuffer: Uint8Array
}

function extractSubmeshes(u8: Uint8Array): SubmeshInfo[] {
  const { root } = parseChunky(u8)
  const results: SubmeshInfo[] = []

  function walkMeshes(chunks: Chunk[], parentName: string) {
    for (const c of chunks) {
      if (c.kind !== 'FOLD') continue
      if (c.fourCC === 'MRGM' || c.fourCC === 'TRIM') {
        const dataChunk = c.children.find(ch => ch.kind === 'DATA' && ch.fourCC === 'DATA')
        if (!dataChunk) continue

        try {
          let layout: InputElt[] | null = null
          let numVerts = 0
          let stride = 0
          let vbuf: Uint8Array | null = null

          if (c.fourCC === 'MRGM' && dataChunk.version === 8) {
            // MRGM v8: skip 1 byte, read num_objects, skip objects, then numInput
            const r = new Reader(u8, dataChunk.payloadOffset)
            r.skip(1)
            const numObjects = r.u32()
            for (let i = 0; i < numObjects; i++) {
              const ni = r.u32()
              r.skip(ni * 2 + 12 + 1)  // indices + 3 floats + 1 byte
              const nlen = r.u32(); r.skip(nlen)  // lpstr name
            }
            const numInput = r.u32()
            layout = parseInputLayout(r, numInput)
            if (!layout) continue
            numVerts = r.u32()
            stride = r.u32()
            const computedStride = layout.reduce((s, e) => s + e.size, 0)
            if (stride !== computedStride) continue
            vbuf = r.bytes(numVerts * stride)

          } else if (c.fourCC === 'TRIM' && dataChunk.version === 5) {
            // TRIM v5: try variant A (8-byte prefix), then variant B (no prefix)
            function tryParse(startOffset: number): { layout: InputElt[]; numVerts: number; stride: number; vbuf: Uint8Array } | null {
              const r2 = new Reader(u8, startOffset)
              const numInput = r2.u32()
              const l = parseInputLayout(r2, numInput)
              if (!l) return null
              const computedStride = l.reduce((s, e) => s + e.size, 0)
              const nv = r2.u32()
              const st = r2.u32()
              if (st !== computedStride || nv === 0 || nv > 1_000_000) return null
              const vb = r2.bytes(nv * st)
              return { layout: l, numVerts: nv, stride: st, vbuf: vb }
            }

            // Try variant A: skip 8 bytes first
            const parseA = tryParse(dataChunk.payloadOffset + 8)
            const parseB = parseA ?? tryParse(dataChunk.payloadOffset)
            const parsed = parseB
            if (!parsed) continue
            layout = parsed.layout
            numVerts = parsed.numVerts
            stride = parsed.stride
            vbuf = parsed.vbuf
          } else {
            continue
          }

          if (!layout || !vbuf) continue

          results.push({
            name: parentName || c.name,
            numVerts,
            stride,
            semantics: layout.map(e => e.semantic),
            layout,
            vertexBuffer: vbuf,
          })
        } catch (e) {
          // skip bad submesh
        }
      } else {
        const nm = (c.fourCC === 'MESH' || c.fourCC === 'MGRP') ? (c.name || parentName) : parentName
        walkMeshes(c.children, nm)
      }
    }
  }

  walkMeshes(root, '')
  return results
}

// ── UV stats for a given semantic ───────────────────────────────────────────────
interface UvStats {
  semantic: number
  semanticName: string
  format: number
  offset: number  // byte offset within stride
  nonZeroFrac: number
  uMin: number; uMax: number; vMin: number; vMax: number
  uMean: number; vMean: number
  distinctFromTC0: boolean | null  // null if no TC0 present
  clusterWidth: number  // uMax-uMin
  clusterHeight: number  // vMax-vMin
  sampleCount: number
}

function computeUvStats(sm: SubmeshInfo, targetSemantic: number): UvStats | null {
  // Find offset of target semantic
  let offset = 0
  let found: InputElt | null = null
  for (const elt of sm.layout) {
    if (elt.semantic === targetSemantic) { found = elt; break }
    offset += elt.size
  }
  if (!found) return null

  // Also get TC0 for comparison
  let tc0Offset = 0
  let hasTc0 = false
  for (const elt of sm.layout) {
    if (elt.semantic === 8) { hasTc0 = true; break }
    tc0Offset += elt.size
  }

  const view = new DataView(sm.vertexBuffer.buffer, sm.vertexBuffer.byteOffset, sm.vertexBuffer.byteLength)
  const stride = sm.stride
  const n = sm.numVerts

  let uSum = 0, vSum = 0
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
  let nonZeroCount = 0
  let diffFromTc0 = 0

  const decodeUV = (base: number, elt: InputElt, o: number): { u: number; v: number } => {
    const b = base + o
    if (elt.format === 3) {
      return { u: view.getFloat32(b, true), v: view.getFloat32(b + 4, true) }
    } else if (elt.format === 2) {
      // UNORM8 pair (same packed format as TEXCOORD0 in rgm.ts)
      return { u: view.getUint8(b + 2) / 255, v: view.getUint8(b + 1) / 255 }
    }
    return { u: 0, v: 0 }
  }

  for (let v = 0; v < n; v++) {
    const base = v * stride
    const { u, v: vv } = decodeUV(base, found, offset)
    if (!isFinite(u) || !isFinite(vv)) continue
    if (Math.abs(u) > 1e-6 || Math.abs(vv) > 1e-6) nonZeroCount++
    uSum += u; vSum += vv
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u)
    vMin = Math.min(vMin, vv); vMax = Math.max(vMax, vv)

    if (hasTc0) {
      const tc0 = decodeUV(base, sm.layout.find(e => e.semantic === 8)!, tc0Offset)
      const du = Math.abs(u - tc0.u), dv = Math.abs(vv - tc0.v)
      if (du > 0.01 || dv > 0.01) diffFromTc0++
    }
  }

  const distinct = hasTc0 ? (diffFromTc0 / n > 0.1) : null

  return {
    semantic: targetSemantic,
    semanticName: SEMANTIC_NAME[targetSemantic] ?? `SEM_${targetSemantic}`,
    format: found.format,
    offset,
    nonZeroFrac: n > 0 ? nonZeroCount / n : 0,
    uMin: uMin === Infinity ? 0 : uMin,
    uMax: uMax === -Infinity ? 0 : uMax,
    vMin: vMin === Infinity ? 0 : vMin,
    vMax: vMax === -Infinity ? 0 : vMax,
    uMean: n > 0 ? uSum / n : 0,
    vMean: n > 0 ? vSum / n : 0,
    distinctFromTC0: distinct,
    clusterWidth:  uMax === -Infinity ? 0 : uMax - uMin,
    clusterHeight: vMax === -Infinity ? 0 : vMax - vMin,
    sampleCount: n,
  }
}

// ── Open SGA and find RGM ───────────────────────────────────────────────────────
async function loadRgm(rgmPath: string): Promise<{ bytes: Uint8Array; foundIn: string } | null> {
  const allSgas = SGAFILES.map(n => path.join(ARCH, n)).filter(fp => fs.existsSync(fp))
  for (const fp of allSgas) {
    const a = await SgaArchive.open(nodeFileShim(fp))
    const b = await a.readByPath(rgmPath)
    if (b) return { bytes: b, foundIn: path.basename(fp) }
  }
  return null
}

// ── Main ────────────────────────────────────────────────────────────────────────
const report: Record<string, unknown> = {}

console.log('\n=== CoH2 Badge/Decal UV Channel Probe ===\n')

for (const veh of VEHICLES) {
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`VEHICLE: ${veh.label}`)
  console.log(`RGM:     ${veh.path}`)

  const loaded = await loadRgm(veh.path)
  if (!loaded) {
    console.log('  NOT FOUND in any SGA')
    report[veh.label] = { error: 'RGM not found' }
    continue
  }
  console.log(`  Found in: ${loaded.foundIn} (${loaded.bytes.length} bytes)`)

  const submeshes = extractSubmeshes(loaded.bytes)
  console.log(`  Submeshes: ${submeshes.length}`)

  // Gather all unique semantics across ALL submeshes
  const allSemantics = new Set<number>()
  for (const sm of submeshes) sm.semantics.forEach(s => allSemantics.add(s))

  const hullSubs = submeshes.filter(s => /hull/i.test(s.name))
  console.log(`  Hull submeshes: ${hullSubs.map(s => s.name).join(', ') || '(none)'}`)

  console.log(`  All semantics across all submeshes:`)
  for (const sem of [...allSemantics].sort((a,b) => a-b)) {
    const name = SEMANTIC_NAME[sem] ?? `SEM_${sem}`
    console.log(`    ${sem.toString().padStart(3)}: ${name}`)
  }

  // Check for TEXCOORD channels above TC0 (sem 8) — these are the candidates
  const extraTcSemantics = [...allSemantics].filter(s => s > 8)

  const vehReport: Record<string, unknown> = {
    foundIn: loaded.foundIn,
    bytesSize: loaded.bytes.length,
    submeshCount: submeshes.length,
    allSemantics: [...allSemantics].sort((a, b) => a-b).map(s => ({ id: s, name: SEMANTIC_NAME[s] ?? `SEM_${s}` })),
    extraTcSemantics,
  }

  if (extraTcSemantics.length === 0) {
    console.log(`\n  NO secondary TEXCOORD channels found (only TEXCOORD0 for diffuse UV).`)
    vehReport['verdict'] = 'NO_SECONDARY_TC'
  } else {
    console.log(`\n  Secondary TEXCOORD semantics found: ${extraTcSemantics.map(s => SEMANTIC_NAME[s] ?? `SEM_${s}`).join(', ')}`)
    const extraTcStats: Record<string, unknown> = {}

    for (const sem of extraTcSemantics) {
      const semName = SEMANTIC_NAME[sem] ?? `SEM_${sem}`
      console.log(`\n  ── ${semName} (semantic=${sem}) ──`)

      // Focus on hull submeshes, fall back to all
      const targetSubs = hullSubs.length > 0 ? hullSubs : submeshes.slice(0, 5)
      const semStats: Record<string, unknown>[] = []

      for (const sm of targetSubs) {
        if (!sm.semantics.includes(sem)) {
          console.log(`    ${sm.name}: semantic absent`)
          continue
        }
        const stats = computeUvStats(sm, sem)
        if (!stats) { console.log(`    ${sm.name}: decode failed`); continue }

        console.log(`    ${sm.name.padEnd(30)} n=${stats.sampleCount}  nonZero=${(stats.nonZeroFrac*100).toFixed(1)}%  ` +
          `U=[${stats.uMin.toFixed(3)},${stats.uMax.toFixed(3)}]  V=[${stats.vMin.toFixed(3)},${stats.vMax.toFixed(3)}]  ` +
          `clust=${stats.clusterWidth.toFixed(3)}x${stats.clusterHeight.toFixed(3)}  ` +
          `distinctFromTC0=${stats.distinctFromTC0}`)
        semStats.push(stats as unknown as Record<string, unknown>)
      }

      extraTcStats[semName] = semStats
    }

    vehReport['extraTcStats'] = extraTcStats
  }

  // Also print layout of first hull submesh for reference
  const refSub = hullSubs[0] ?? submeshes[0]
  if (refSub) {
    console.log(`\n  Layout of "${refSub.name}" (stride=${refSub.stride}):`)
    let byteOff = 0
    for (const elt of refSub.layout) {
      const semName = SEMANTIC_NAME[elt.semantic] ?? `SEM_${elt.semantic}`
      console.log(`    @${byteOff.toString().padStart(3)}: sem=${elt.semantic} (${semName.padEnd(14)}) fmt=${elt.format} size=${elt.size}`)
      byteOff += elt.size
    }
  }

  report[veh.label] = vehReport
}

// ── Save JSON dump ──────────────────────────────────────────────────────────────
const outPath = path.join(OUT_DIR, 'dump.json')
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(`\n\nFull dump saved to: ${outPath}`)
console.log('=== Done ===')
