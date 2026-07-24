/**
 * probe-mrgm-tc1-per-submesh.mts
 *
 * TASK: Resolve MRGM v8 TC1 ambiguity for T-34/76, Cromwell, and two more
 * MRGM v8 vehicles. The merged body submesh showed TC1 spanning full UV space
 * (0–1 × 0–1), but that was measured on the AGGREGATE merged mesh.
 *
 * This script probes TC1 PER-SUBMESH (each MRGM "object" group) to determine
 * whether each submesh's TC1 is tight (badge cluster) or wide (not badge UV).
 *
 * A TC1 cluster width/height < 0.15 in BOTH axes = "tight badge cluster".
 * Anything wider = "wide, not a dedicated badge UV for this submesh".
 *
 * Additionally: for tight clusters, what atlas cell do they map to?
 * The Tiger/Easy8 cluster is U∈[0.286,0.337]×V∈[0.039,0.086].
 * If MRGM submeshes land in the same cell → same badge channel, just aggregated.
 *
 * Run: npx tsx scripts/probe-mrgm-tc1-per-submesh.mts
 */
import fs from 'fs'
import path from 'path'
import { SgaArchive } from '../src/lib/sga.js'
import { parseChunky, Reader, type Chunk } from '../src/lib/chunky.js'

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
  return { name: fp, size: stat.size, slice } as unknown as File
}

const ARCH = '/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'

interface InputElt { semantic: number; format: number; size: number }

function formatSize(fmt: number): number {
  switch (fmt) {
    case 2:  return 4
    case 3:  return 8
    case 4:  return 12
    case 5:  return 16
    case 13: return 4
    default: throw new Error(`Unknown DXGI format ${fmt}`)
  }
}

/**
 * Parse an MRGM v8 DATA chunk. Returns one entry per Object group,
 * each with its own index range but sharing the flat vertex buffer.
 * We analyse TC1 stats per group (simulating per-submesh UV ranges).
 */
function parseMrgmV8(u8: Uint8Array, chunk: Chunk): Array<{
  groupName: string
  numIndices: number
  tc1Min: { u: number; v: number }
  tc1Max: { u: number; v: number }
  tc1W: number
  tc1H: number
  tc1Present: boolean
}> | null {
  try {
    const r = new Reader(u8, chunk.payloadOffset)
    r.skip(1) // unknown leading byte
    const numObjects = r.u32()

    const groups: Array<{ name: string; indices: Uint16Array }> = []
    for (let i = 0; i < numObjects; i++) {
      const ni = r.u32()
      const indices = new Uint16Array(ni)
      for (let k = 0; k < ni; k++) indices[k] = r.u16()
      r.skip(12) // 3 floats
      r.skip(1)
      const name = r.lpstr()
      groups.push({ name, indices })
    }

    const numInput = r.u32()
    const inputLayout: InputElt[] = []
    for (let i = 0; i < numInput; i++) {
      const semantic = r.u32()
      r.skip(4)
      const format = r.u32()
      inputLayout.push({ semantic, format, size: formatSize(format) })
    }

    const numVerts = r.u32()
    const stride = r.u32()
    const computedStride = inputLayout.reduce((s, e) => s + e.size, 0)
    if (stride !== computedStride) return null
    const vbuf = r.bytes(numVerts * stride)

    // Find TC1 offset in the layout
    let tc1Off = -1
    let tc1Elt: InputElt | null = null
    let cursor = 0
    for (const elt of inputLayout) {
      if (elt.semantic === 9) { tc1Off = cursor; tc1Elt = elt }
      cursor += elt.size
    }

    if (tc1Off < 0 || !tc1Elt) {
      // No TC1 in this mesh
      return groups.map(g => ({
        groupName: g.name,
        numIndices: g.indices.length,
        tc1Min: { u: NaN, v: NaN },
        tc1Max: { u: NaN, v: NaN },
        tc1W: NaN,
        tc1H: NaN,
        tc1Present: false,
      }))
    }

    const view = new DataView(vbuf.buffer, vbuf.byteOffset, vbuf.byteLength)
    const tc1EltFinal = tc1Elt

    // For each group: collect unique vertex indices referenced, compute TC1 stats
    return groups.map(g => {
      const visited = new Set<number>()
      for (const idx of g.indices) visited.add(idx)

      let uMin = Infinity, uMax = -Infinity
      let vMin = Infinity, vMax = -Infinity

      for (const vi of visited) {
        if (vi >= numVerts) continue
        const base = vi * stride + tc1Off
        let u: number, v: number
        if (tc1EltFinal.format === 3) {
          u = view.getFloat32(base, true)
          v = view.getFloat32(base + 4, true)
        } else {
          // format 2: R8G8B8A8 packed, same decode as TC0 in rgm.ts
          u = vbuf[base + 2] / 255
          v = vbuf[base + 1] / 255  // raw V (not flipped here — just measuring range)
        }
        if (!isNaN(u) && !isNaN(v)) {
          uMin = Math.min(uMin, u); uMax = Math.max(uMax, u)
          vMin = Math.min(vMin, v); vMax = Math.max(vMax, v)
        }
      }

      return {
        groupName: g.name,
        numIndices: g.indices.length,
        tc1Min: { u: uMin, v: vMin },
        tc1Max: { u: uMax, v: vMax },
        tc1W: uMax - uMin,
        tc1H: vMax - vMin,
        tc1Present: true,
      }
    })
  } catch (e) {
    console.error('parseMrgmV8 failed:', e)
    return null
  }
}

async function loadRgm(sgas: string[], rgmPath: string): Promise<Uint8Array | null> {
  for (const sgaFile of sgas) {
    const fp = path.join(ARCH, sgaFile)
    if (!fs.existsSync(fp)) continue
    try {
      const a = await SgaArchive.open(nodeFileShim(fp))
      const bytes = await a.readByPath(rgmPath)
      if (bytes) return bytes
    } catch { /* try next */ }
  }
  return null
}

function walkMrgmChunks(chunks: Chunk[], u8: Uint8Array, vehicleLabel: string): void {
  for (const c of chunks) {
    if (c.kind !== 'FOLD') continue
    if (c.fourCC === 'MRGM') {
      const dc = c.children.find(ch => ch.kind === 'DATA' && ch.fourCC === 'DATA')
      if (!dc || dc.version !== 8) continue
      const label = c.name || vehicleLabel

      console.log(`\n  [MRGM v8] ${label}`)
      const groups = parseMrgmV8(u8, dc)
      if (!groups) { console.log('    parse failed'); continue }

      for (const g of groups) {
        if (!g.tc1Present) {
          console.log(`    ${g.groupName.padEnd(50)} n_idx=${g.numIndices.toString().padStart(6)}  NO TC1`)
          continue
        }
        const tight = g.tc1W < 0.15 && g.tc1H < 0.15
        const CLUSTER_TAG = tight ? '<<TIGHT>>' : '  wide  '
        console.log(
          `    ${g.groupName.padEnd(50)} n_idx=${g.numIndices.toString().padStart(6)}` +
          `  TC1=[${g.tc1Min.u.toFixed(3)},${g.tc1Max.u.toFixed(3)}]x[${g.tc1Min.v.toFixed(3)},${g.tc1Max.v.toFixed(3)}]` +
          `  W=${g.tc1W.toFixed(3)} H=${g.tc1H.toFixed(3)}  ${CLUSTER_TAG}`
        )
      }
    } else {
      walkMrgmChunks(c.children, u8, vehicleLabel)
    }
  }
}

// Targets: T-34/76, Cromwell, ISU-152 (soviet heavy), IS-2 (soviet heavy)
// All four are expected to be MRGM v8 or may have mixed TRIM+MRGM
const TARGETS = [
  { label: 'T-34/76 (soviet)',       sgas: ['ArtHigh.sga'],     rgm: 'art/armies/soviet/vehicles/t34_76/t34_76.rgm' },
  { label: 'Cromwell (british)',      sgas: ['ArtHighXP2.sga', 'ArtBritish.sga'], rgm: 'art/armies/british/vehicles/cromwell/cromwell.rgm' },
  { label: 'IS-2 (soviet)',           sgas: ['ArtHigh.sga'],     rgm: 'art/armies/soviet/vehicles/is2m_heavy_tank/is2m_heavy_tank.rgm' },
  { label: 'ISU-152 (soviet)',        sgas: ['ArtHigh.sga'],     rgm: 'art/armies/soviet/vehicles/isu152/isu152.rgm' },
  // Also check one known TRIM v5 for calibration
  { label: 'Tiger (TRIM v5 ref)',     sgas: ['ArtHigh.sga'],     rgm: 'art/armies/german/vehicles/tiger/tiger.rgm' },
]

for (const target of TARGETS) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`VEHICLE: ${target.label}`)
  const bytes = await loadRgm(target.sgas, target.rgm)
  if (!bytes) { console.log('  NOT FOUND in any SGA'); continue }

  const { root } = parseChunky(bytes)
  walkMrgmChunks(root, bytes, target.label)
}

console.log('\n\nDone.')
