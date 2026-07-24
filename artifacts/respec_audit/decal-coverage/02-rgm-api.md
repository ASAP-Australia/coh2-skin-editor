# RGM Parse API — per-triangle geometry extraction

## 1. Load API and per-submesh access

`src/lib/rgm.ts` exports one function:

```ts
import { parseRgm } from './src/lib/rgm'
// buf: ArrayBuffer | Uint8Array from fs.readFileSync(path)
const model = parseRgm(buf)  // → RgmModel
```

`RgmModel`:
```ts
interface RgmModel {
  meshes: RgmMesh[]           // one entry per renderable submesh
  textureSets: string[]       // texture path stems from TSET chunks
  materials: Map<string, { shader: string; params: { key:string; type:number; value:unknown }[] }>
}
interface RgmMesh {
  name: string            // FOLD/MESH parent name, e.g. "geo_Hull", "geo_Turret"
  geometry: THREE.BufferGeometry  // ready-to-render
  materialName: string | null     // from MRGM v8 trailer; null for TRIM v5 (use mesh.name)
}
```

**Getting positions, normals, UVs from a submesh:**

```ts
for (const sub of model.meshes) {
  const pos  = sub.geometry.getAttribute('position') as THREE.BufferAttribute  // Float32, 3 components
  const norm = sub.geometry.getAttribute('normal')   as THREE.BufferAttribute  // Float32, 3 components (may be computed)
  const uv   = sub.geometry.getAttribute('uv')       as THREE.BufferAttribute  // Float32, 2 components
  const idx  = sub.geometry.getIndex()               // Uint16BufferAttribute, groups of 3 = triangles
  const triCount = (idx?.count ?? 0) / 3
  const name = sub.name           // mesh hierarchy name
  const mat  = sub.materialName   // material name or null
}
```

Coordinate system: Z is already negated (LH→RH), triangle winding is already flipped.
UVs: V is pre-flipped (`v = 1 - v_original`) so they read top-down with `flipY=true`.

The geometry is built in `buildGeometry()` (rgm.ts:368). Normals come from the vertex
buffer (semantic 3: format 4 = R32G32B32_FLOAT, format 2 = R8G8B8A8_SNORM). If normals
are degenerate (>5% with length<0.1), they are recomputed via `computeVertexNormals()`.

## 2. Material/submesh naming and classification

`tokenFor()` in Viewport.tsx:3308 classifies a material (or mesh) name to a routing token:

| Token returned | Regex / rule | Meaning |
|---|---|---|
| `'turrets'` | `/(?:^|_)turrets?(?:_|$)/i` | Turret atlas (`*_turrets_dif`) |
| `'wreck'` | `/wreck\|wreak/i` | Destroyed/wreck variant (also catches Relic typo `wreak`) |
| `'tread'` | `/(?:^|[^a-z])(?:tread\|track\|wheel)s?(?![a-z])/i` | Track/wheel atlas (`*_tread_dif`); boundary guards prevent `halftrack` matching |
| `'schurzen'` | `/schurzen\|skirt\|side_armor\|sidearmor/i` | Side-skirt armour — no texture assigned |
| `'panels'` | `/(?:^|_)panels?(?:_|$)/i` | Separate panels atlas (`*_panels_dif`) |
| `''` (empty) | fallthrough | Hull/body — uses primary `*_dif` atlas |

`isBodyMaterial(mn)` (Viewport.tsx:3510): returns `true` when `tokenFor(mn) === ''` or mn is null.

Wreck submeshes are also caught by a broader `WRECK_PATTERNS` array (Viewport.tsx:203–295)
used to split visible vs destroyed meshes before rendering:
- `/wreck/i`, `/wreak/i`, `/destroyed/i`, `/dmg|dst|dest/i`, `/body_chunks?/i`,
  `/(?:^|[^a-z])WRK(?:[^a-z]|$)/i`, `/(?:^|[^a-z])CRS(?:[^a-z]|$)/i`, etc.
- Wheel/tread-with-damage combos: `/wheel[^a-z]*(?:dmg|dst|dest|destroyed|wreck|broken|dam)/i`

Glass is not a distinct token — there is no glass classification in the renderer.

## 3. Atlas resolution

**Diffuse atlases are NOT uniformly 2048×2048.** The app treats 2048² as the canonical
vehicle body-diffuse size (all UV pixel coordinates in project JSON are in 2048² space;
brush.ts hardcodes `canvasWidth ?? 2048`; rgt-writer.ts targets 2048²). However the actual
RGT on disk can be any size — width and height are read directly from the TFMT chunk
in the Chunky container (`parseRgtHeader()` → `rgt.width, rgt.height`, rgt-core.ts:56).

`bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)` creates a canvas at the actual
decoded dimensions. To get a given vehicle's atlas resolution: decode the RGT and read
`decodeRgt(bytes).width` / `.height`.

In practice CoH2 stock vehicles use 2048×2048 for body diffuse, but some share atlases
at different sizes (faceplate 692×204, decal icons 64×64, inventory thumbnails 1008×384).
The only reliable way to determine resolution is to decode the RGT from the SGA.

## 4. Minimal standalone Node sketch

The app uses Three.js `BufferGeometry` which is browser-only. For a Node script, parse
the raw `ParsedMeshData` before `buildGeometry()` — or stub Three.js. Simplest approach
reuses only the chunky+reader layer:

```ts
// sketch-rgm.ts  (ts-node or tsx)
import { readFileSync } from 'fs'
import { parseChunky, findAllChunks, Reader } from './src/lib/chunky'

// Inline the SEMANTIC + formatSize constants from rgm.ts
const SEMANTIC = { POSITION:0, NORMAL:3, TEXCOORD0:8 }
function formatSize(fmt: number) {
  return [,, 4,8,12,16,,,,,,,, 4][fmt] ?? (() => { throw new Error(`fmt ${fmt}`) })()
}

const u8 = new Uint8Array(readFileSync(process.argv[2]).buffer)
const { root } = parseChunky(u8)

function walkTrim(chunks: any[], parentName = '') {
  for (const c of chunks) {
    if (c.kind !== 'FOLD') continue
    if (c.fourCC === 'TRIM') {
      const data = c.children.find((x: any) => x.kind === 'DATA' && x.fourCC === 'DATA')
      if (!data || data.version !== 5) { walkTrim(c.children, parentName); continue }
      // Variant A: skip 8-byte prefix
      const r = new Reader(u8, data.payloadOffset + 8)
      const ni = r.u32()
      const layout: {semantic:number,format:number,size:number}[] = []
      for (let i=0;i<ni;i++){const sem=r.u32();r.skip(4);const fmt=r.u32();layout.push({semantic:sem,format:fmt,size:formatSize(fmt)})}
      const nv = r.u32(), stride = r.u32()
      const vbuf = r.bytes(nv*stride)
      const peek = r.u32(); let nIdx: number
      if (peek===0){nIdx=r.u32();r.skip(8)} else nIdx=peek
      const indices = new Uint16Array(nIdx); for(let k=0;k<nIdx;k++) indices[k]=r.u16()
      // Collect UV bbox
      let uMin=Infinity,uMax=-Infinity,vMin=Infinity,vMax=-Infinity
      const tcElt = layout.find(e=>e.semantic===SEMANTIC.TEXCOORD0)
      let off=0; for(const e of layout){if(e.semantic===SEMANTIC.TEXCOORD0)break;off+=e.size}
      if(tcElt?.format===3){
        const dv=new DataView(vbuf.buffer,vbuf.byteOffset,vbuf.byteLength)
        for(let v=0;v<nv;v++){const b=v*stride+off;const u=dv.getFloat32(b,true),vv=dv.getFloat32(b+4,true);uMin=Math.min(uMin,u);uMax=Math.max(uMax,u);vMin=Math.min(vMin,vv);vMax=Math.max(vMax,vv)}
      }
      console.log(`submesh=${parentName||c.name} tris=${nIdx/3} UV=[${uMin.toFixed(3)},${vMin.toFixed(3)}]→[${uMax.toFixed(3)},${vMax.toFixed(3)}]`)
    } else {
      const nm = (c.fourCC==='MESH'||c.fourCC==='MGRP') ? (c.name||parentName) : parentName
      walkTrim(c.children, nm)
    }
  }
}
walkTrim(root)
```

Run: `npx tsx sketch-rgm.ts path/to/tiger.rgm`

**Sketch was NOT executed** — no RGM file is available in this environment. The chunky
and reader imports are accurate to the actual source. MRGM v8 path is omitted from the
sketch for brevity; add a `c.fourCC==='MRGM' && data.version===8` branch using
`parseMrgmDataV8` logic from rgm.ts:202 if needed.
