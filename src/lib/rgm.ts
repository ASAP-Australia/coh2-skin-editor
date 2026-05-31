/**
 * Relic Geometry Model (.rgm) loader.
 *
 * Decodes a Chunky-wrapped CoH2 mesh file into a list of Three.js
 * BufferGeometry instances (one per submesh, with material slot info).
 *
 * Format reference: github.com/corsix/coh2-formats + corsix/coh2-explorer's
 * model.cpp (the only known complete reference implementation), augmented
 * with hex-level verification against a real Tiger.rgm pulled from CoH2's
 * ArtHigh.sga. Two terminal mesh paths exist in CoH2 files:
 *
 *   FOLD/MESH → FOLD/MGRP → ... → FOLD/MRGM → DATA/DATA v8     (newer)
 *   FOLD/MESH → FOLD/MGRP → ... → FOLD/TRIM → DATA/DATA v5     (older, common)
 *
 * The Tiger uses TRIM v5 throughout. T-34/76 has both. Loaders for both
 * versions live below; the dispatcher picks based on the chunk version.
 *
 * Coordinate system note: Essence engine is left-handed Y-up (D3D-style),
 * Three.js is right-handed Y-up. We convert by negating Z on positions/
 * normals/tangents and flipping every triangle's winding (swap indices
 * 1 and 2). UVs get V flipped (D3D top-left origin → GL bottom-left).
 */

import * as THREE from 'three'
import { parseChunky, findAllChunks, Reader, type Chunk } from './chunky'

/** A submesh extracted from an .rgm. One mesh node = one renderable piece. */
export interface RgmMesh {
  /** Hierarchy name from the FOLD/MESH wrapper (e.g. "geo_Hull", "geo_Turret"). */
  name: string
  /** Three.js geometry, ready to construct a Mesh from. */
  geometry: THREE.BufferGeometry
  /** Material name as stored in the file (e.g. "MAT_Tiger_tread_L"); null if
   *  the chunk didn't carry one (TRIM v5 sometimes omits). */
  materialName: string | null
}

export interface RgmModel {
  /** Submeshes in walk order. */
  meshes: RgmMesh[]
  /** Texture-set names referenced by the model (e.g. "art\\armies\\german
   *  \\vehicles\\tiger\\tiger_dif") — used later to fetch RGT files. */
  textureSets: string[]
  /** Material definitions — keyed by name. Texture slot strings are inside
   *  the params array (caller resolves by string-matching). */
  materials: Map<string, { shader: string; params: { key: string; type: number; value: unknown }[] }>
}

// ----------------------------------------------------------------------------
// Public entry
// ----------------------------------------------------------------------------

export function parseRgm(buf: ArrayBuffer | Uint8Array): RgmModel {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const { root } = parseChunky(u8)

  // Texture sets and materials live as siblings of the mesh under FOLD/MODL.
  const tsetChunks = findAllChunks(root, 'TSET')
  const textureSets = tsetChunks.map(c => c.name)

  const mtrlChunks = findAllChunks(root, 'MTRL')
  const materials = new Map<string, RgmModel['materials'] extends Map<string, infer V> ? V : never>()
  for (const m of mtrlChunks) {
    materials.set(m.name, parseMtrl(u8, m))
  }

  // Walk the mesh tree. Two terminal types: MRGM (v3) and TRIM (any version).
  // We collect them with their FOLD/MESH parent name as the submesh name.
  const meshes: RgmMesh[] = []
  walkMeshes(root, '', (node, parentName) => {
    const dataChunk = node.children.find(c => c.kind === 'DATA' && c.fourCC === 'DATA')
    if (!dataChunk) return
    try {
      let payload: ParsedMeshData
      if (node.fourCC === 'MRGM' && dataChunk.version === 8) {
        payload = parseMrgmDataV8(u8, dataChunk)
      } else if (node.fourCC === 'TRIM' && dataChunk.version === 5) {
        payload = parseTrimDataV5(u8, dataChunk)
      } else {
        return  // Unknown variant — skip silently
      }
      const geo = buildGeometry(payload)

      // Only add meshes with actual geometry (skip empty/degenerate meshes)
      if (geo.attributes.position && (geo.attributes.position as THREE.BufferAttribute).count > 0) {
        meshes.push({
          name: parentName || node.name,
          geometry: geo,
          materialName: payload.materialName,
        })
      } else {
        console.warn('[rgm] skipping degenerate mesh (no vertices)', node.name || parentName)
      }
    } catch (err) {
      // Bad / unsupported submesh — log and continue so the rest of the model still loads
      console.warn('[rgm] skipping submesh', node.name || parentName, err)
    }
  })

  return { meshes, textureSets, materials }
}

function walkMeshes(
  chunks: Chunk[],
  parentName: string,
  visit: (node: Chunk, parentName: string) => void,
) {
  for (const c of chunks) {
    if (c.kind !== 'FOLD') continue
    if (c.fourCC === 'MRGM' || c.fourCC === 'TRIM') {
      visit(c, parentName)
    } else {
      const nm = c.fourCC === 'MESH' || c.fourCC === 'MGRP' ? (c.name || parentName) : parentName
      walkMeshes(c.children, nm, visit)
    }
  }
}

// ----------------------------------------------------------------------------
// Material parser (shared between v5/v8 paths)
// ----------------------------------------------------------------------------

function parseMtrl(u8: Uint8Array, mtrl: Chunk) {
  let shader = ''
  const params: { key: string; type: number; value: unknown }[] = []
  for (const c of mtrl.children) {
    if (c.kind !== 'DATA') continue
    if (c.fourCC === 'INFO') {
      const r = new Reader(u8, c.payloadOffset)
      shader = r.lpstr()
    } else if (c.fourCC === ' VAR' || c.fourCC === 'VAR ') {
      // (key:lpstr, type:u32, value: depends on type)
      const r = new Reader(u8, c.payloadOffset)
      const key = r.lpstr()
      const type = r.u32()
      let value: unknown = null
      // Type table from corsix/coh2-formats material spec:
      //   0=int32, 1=float, 2=string, 3=texture, 4=float[4],
      //   5=texture(?), 6=bool(?), 9=texture-asciiz (most common)
      try {
        if (type === 9 || type === 2 || type === 3 || type === 5) {
          value = r.lpstr()
        } else if (type === 1) {
          value = r.f32()
        } else if (type === 4) {
          value = [r.f32(), r.f32(), r.f32(), r.f32()]
        } else if (type === 0 || type === 6) {
          value = r.i32()
        }
      } catch {/* unknown payload — leave null */}
      params.push({ key, type, value })
    }
  }
  return { shader, params }
}

// ----------------------------------------------------------------------------
// Vertex/index payload — the heart of the loader
// ----------------------------------------------------------------------------

const SEMANTIC = {
  POSITION: 0, BLENDINDICES: 1, BLENDWEIGHT: 2, NORMAL: 3, BINORMAL: 4,
  TANGENT: 5, COLOR: 6, TEXCOORD0: 8, TEXCOORD1: 9, TEXCOORD2: 10,
} as const

interface InputElt {
  semantic: number
  format: number
  /** Byte size derived from `format`. */
  size: number
}
interface ParsedMeshData {
  inputLayout: InputElt[]
  vertexStride: number
  vertexCount: number
  vertexBuffer: Uint8Array
  /** Concatenated indices for ALL submesh objects. */
  indices: Uint16Array
  /** [start, count] pairs into `indices` — each is a separate submesh group
   *  within this mesh (for MRGM v8; v5 produces a single group). */
  groups: { start: number; count: number; name: string }[]
  /** Material name, if the chunk carried one. */
  materialName: string | null
}

/** DXGI format → byte size + decoder hint. We only support what CoH2 uses. */
function formatSize(fmt: number): number {
  switch (fmt) {
    case 2:  return 4   // R8G8B8A8 (UNORM/SNORM/UINT — all 4 bytes)
    case 3:  return 8   // R32G32_FLOAT (UVs, sometimes color)
    case 4:  return 12  // R32G32B32_FLOAT (positions, normals)
    case 5:  return 16  // R32G32B32A32_FLOAT
    case 13: return 4   // R8G8B8A8_UINT (bone indices)
    default: throw new Error(`Unknown DXGI format code ${fmt}`)
  }
}

/** MRGM v8 path — used by some CoH2 vehicles (T-34 for example). Order:
 *  unk u8, num_objects u32, Object[num_objects], num_input u32, InputElt[],
 *  num_vertices u32, vertex_stride u32, vertex_buffer, ..., material name,
 *  bones, trailer. */
function parseMrgmDataV8(u8: Uint8Array, chunk: Chunk): ParsedMeshData {
  const r = new Reader(u8, chunk.payloadOffset)
  r.skip(1)  // unknown leading byte
  const numObjects = r.u32()

  // Each Object: u32 num_indices, u16[num_indices], 3×float, u8, lpstr name
  const groups: ParsedMeshData['groups'] = []
  let totalIdx = 0
  const idxBuffers: Uint16Array[] = []
  for (let i = 0; i < numObjects; i++) {
    const ni = r.u32()
    const buf = new Uint16Array(ni)
    for (let k = 0; k < ni; k++) buf[k] = r.u16()
    r.skip(12)  // 3 unknown floats (centroid?)
    r.skip(1)   // unknown byte
    const name = r.lpstr()
    groups.push({ start: totalIdx, count: ni, name })
    idxBuffers.push(buf)
    totalIdx += ni
  }
  const indices = new Uint16Array(totalIdx)
  let off = 0
  for (const b of idxBuffers) { indices.set(b, off); off += b.length }

  const numInput = r.u32()
  const inputLayout: InputElt[] = []
  for (let i = 0; i < numInput; i++) {
    const semantic = r.u32()
    r.skip(4)  // unknown (semantic_index reservation per spec)
    const format = r.u32()
    inputLayout.push({ semantic, format, size: formatSize(format) })
  }

  const numVerts = r.u32()
  const stride = r.u32()
  const computedStride = inputLayout.reduce((s, e) => s + e.size, 0)
  if (stride !== computedStride) {
    throw new Error(`MRGM v8 stride mismatch: stored=${stride}, computed=${computedStride}`)
  }
  const vbuf = r.bytes(numVerts * stride)

  // Trailer: skip 4 bytes, read material name (lpstr)
  let materialName: string | null = null
  try {
    r.skip(4)
    materialName = r.lpstr()
  } catch {/* trailer optional */}

  return {
    inputLayout, vertexStride: stride, vertexCount: numVerts,
    vertexBuffer: vbuf, indices, groups, materialName,
  }
}

/** TRIM v5 path — used by Tiger and many CoH2 vehicles. Order verified by
 *  hex-dump: u32(=5), u32(=0), num_input u32, InputElt[], num_vertices,
 *  vertex_stride, vertex_buffer, num_indices, u16[num_indices], ... */
function parseTrimDataV5(u8: Uint8Array, chunk: Chunk): ParsedMeshData {
  const r = new Reader(u8, chunk.payloadOffset)

  // Diagnostic: dump first 32 bytes of the DATA chunk in hex
  const diagHex: string[] = []
  for (let i = 0; i < Math.min(32, chunk.payloadSize); i += 4) {
    const val = new DataView(u8.buffer, u8.byteOffset + chunk.payloadOffset + i, 4).getUint32(0, true)
    diagHex.push(`${val.toString(16).padStart(8, '0')}`)
  }
  console.log('[TRIM v5] payload hex:', diagHex.join(' '))

  const v1 = r.u32()  // u32 = 5 (header marker)
  const v2 = r.u32()  // u32 = 0 (reserved?)
  const numInput = r.u32()

  // Diagnostic: log header values
  if (v1 !== 5 || v2 !== 0 || numInput > 100) {
    console.warn(`[TRIM v5] Unusual header: v1=${v1} (expected 5), v2=${v2} (expected 0), numInput=${numInput}`)
  }

  // Sanity check: if numInput looks wrong, we might have a format variant
  if (numInput === 0 || numInput > 100) {
    console.warn(`[TRIM v5] Suspicious numInput=${numInput}, might be a format variant. Attempting fallback...`)
    // For now, treat as unsupported variant
    return {
      inputLayout: [],
      vertexStride: 0,
      vertexCount: 0,
      vertexBuffer: new Uint8Array(0),
      indices: new Uint16Array(0),
      groups: [],
      materialName: null,
    }
  }

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

  console.log(`[TRIM v5] numInput=${numInput}, numVerts=${numVerts}, stride=${stride}, computed=${computedStride}`)

  // If stride mismatches significantly, the format might be different
  // Some TRIM v5 variants (like King Tiger) may have packed data
  let actualStride = stride
  if (stride !== computedStride && stride !== 0) {
    console.warn(`[TRIM v5] stride mismatch: stored=${stride}, computed=${computedStride} (using stored)`)
    actualStride = stride
  }

  // Safety check: if stride is 0 or vertices would overflow, bail out
  if (actualStride === 0 || numVerts === 0 || numVerts > 1000000) {
    console.warn(`[TRIM v5] Invalid vertex parameters: numVerts=${numVerts}, stride=${actualStride}`)
    return {
      inputLayout: [],
      vertexStride: 0,
      vertexCount: 0,
      vertexBuffer: new Uint8Array(0),
      indices: new Uint16Array(0),
      groups: [],
      materialName: null,
    }
  }

  const vbuf = r.bytes(numVerts * actualStride)
  const numIdx = r.u32()

  console.log(`[TRIM v5] numIndices=${numIdx}`)

  // Safety check: if no indices, this is an empty mesh
  if (numIdx === 0 || numIdx > 10000000) {
    console.warn(`[TRIM v5] No indices or invalid count: ${numIdx}`)
    return {
      inputLayout,
      vertexStride: actualStride,
      vertexCount: numVerts,
      vertexBuffer: vbuf,
      indices: new Uint16Array(0),
      groups: [],
      materialName: null,
    }
  }

  const indices = new Uint16Array(numIdx)
  for (let k = 0; k < numIdx; k++) indices[k] = r.u16()

  return {
    inputLayout, vertexStride: stride, vertexCount: numVerts,
    vertexBuffer: vbuf, indices,
    groups: [{ start: 0, count: numIdx, name: '' }],
    materialName: null,
  }
}

// ----------------------------------------------------------------------------
// Geometry construction (handed-ness fix happens here)
// ----------------------------------------------------------------------------

function buildGeometry(p: ParsedMeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const view = new DataView(p.vertexBuffer.buffer, p.vertexBuffer.byteOffset, p.vertexBuffer.byteLength)

  const positions = new Float32Array(p.vertexCount * 3)
  let normals: Float32Array | null = null
  let uvs: Float32Array | null = null

  // Diagnostic: check if we have any data to work with
  if (p.vertexCount === 0 || p.indices.length === 0) {
    console.warn(`[buildGeometry] Empty mesh: ${p.vertexCount} vertices, ${p.indices.length} indices`)
  }

  // Compute per-element offset within stride
  let cursor = 0
  const offsets = p.inputLayout.map(e => { const o = cursor; cursor += e.size; return o })

  for (let v = 0; v < p.vertexCount; v++) {
    const base = v * p.vertexStride
    for (let i = 0; i < p.inputLayout.length; i++) {
      const elt = p.inputLayout[i]
      const o = base + offsets[i]
      switch (elt.semantic) {
        case SEMANTIC.POSITION:
          if (elt.format === 4) {
            positions[v * 3 + 0] = view.getFloat32(o,     true)
            positions[v * 3 + 1] = view.getFloat32(o + 4, true)
            positions[v * 3 + 2] = -view.getFloat32(o + 8, true)  // LH→RH: flip Z
          }
          break
        case SEMANTIC.NORMAL:
          if (!normals) normals = new Float32Array(p.vertexCount * 3)
          if (elt.format === 4) {
            normals[v * 3 + 0] = view.getFloat32(o,     true)
            normals[v * 3 + 1] = view.getFloat32(o + 4, true)
            normals[v * 3 + 2] = -view.getFloat32(o + 8, true)
          } else if (elt.format === 2) {
            // Packed R8G8B8A8_SNORM — bytes are 2's-complement signed int8.
            // The Uint8Array gives values [0,255]; reinterpret as int8 by
            // subtracting 256 from anything > 127, then divide by 127.
            const snorm = (b: number) => (b > 127 ? b - 256 : b) / 127.0
            normals[v * 3 + 0] =  snorm(p.vertexBuffer[o + 0])
            normals[v * 3 + 1] =  snorm(p.vertexBuffer[o + 1])
            normals[v * 3 + 2] = -snorm(p.vertexBuffer[o + 2])  // LH→RH: flip Z
          }
          break
        case SEMANTIC.TEXCOORD0:
          if (!uvs) uvs = new Float32Array(p.vertexCount * 2)
          // Canonical D3D→GL UV conversion per MODEL_EXTRACTION.md §3:
          // flip V at parse time (`v = 1 - v`). Combined with flipY=true
          // on the CanvasTexture, the unwrap reads correctly against a
          // top-down canvas. The decal painter (Editor.tsx) and raycast
          // UV picking both assume this convention.
          if (elt.format === 3) {
            uvs[v * 2 + 0] = view.getFloat32(o,     true)
            uvs[v * 2 + 1] = 1 - view.getFloat32(o + 4, true)
          } else if (elt.format === 2) {
            // 4 bytes — R16G16_FLOAT (half-floats)
            uvs[v * 2 + 0] = halfToFloat(view.getUint16(o,     true))
            uvs[v * 2 + 1] = 1 - halfToFloat(view.getUint16(o + 2, true))
          }
          break
      }
    }
  }

  // Flip triangle winding for LH→RH conversion (swap index 1 and 2 of each tri)
  const flipped = new Uint16Array(p.indices.length)
  for (let i = 0; i + 2 < p.indices.length; i += 3) {
    flipped[i + 0] = p.indices[i + 0]
    flipped[i + 1] = p.indices[i + 2]
    flipped[i + 2] = p.indices[i + 1]
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (normals) {
    // Sanity check: if more than 5% of normals are degenerate (length < 0.1),
    // the encoded normals are unreliable for this submesh — likely a packed
    // format we don't understand. Skip them so they get recomputed below.
    let bad = 0
    const total = normals.length / 3
    for (let i = 0; i < normals.length; i += 3) {
      const lenSq = normals[i]*normals[i] + normals[i+1]*normals[i+1] + normals[i+2]*normals[i+2]
      if (lenSq < 0.01) bad++
    }
    if (bad / total < 0.05) {
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    }
  }
  if (uvs)     geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(new THREE.BufferAttribute(flipped, 1))
  // If we don't have valid normals (no normals attribute, or thrown out
  // above as degenerate), recompute geometrically — must be after index is set.
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()

  // Re-apply per-Object groups so callers can render with multi-material later
  for (let g = 0; g < p.groups.length; g++) {
    geo.addGroup(p.groups[g].start, p.groups[g].count, g)
  }
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/** IEEE 754 half-precision (binary16) → 32-bit float. Fast, zero-allocs. */
function halfToFloat(h: number): number {
  const s = (h >> 15) & 0x1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) {
    if (f === 0) return s ? -0 : 0
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024)
  } else if (e === 31) {
    return f === 0 ? (s ? -Infinity : Infinity) : NaN
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024)
}
