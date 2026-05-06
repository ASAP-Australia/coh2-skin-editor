# How CoH2 Models Were Extracted and Textured

A focused technical walkthrough of the model + texture pipeline, end to end:
where the bytes come from, how each format unwraps, every coordinate-system
fix, and how it all binds onto a Three.js material that the user can paint.

Companion files: `SESSION_HANDOFF.md` (full project handoff), `RENDERING.md`
(rendering pipeline overview), `HANDOFF.md` (short status brief).

Project root: `/home/jflessenkemper/dev/coh2-skin-editor`

---

## 1. Locate the .rgm inside an SGA archive

CoH2's vehicle meshes live in 5 SGA archives in `CoH2/Archives/`. We don't
know which one upfront, so we try in priority order:

```ts
// Viewport.tsx
const sgaCandidates = [
  'ArtHigh.sga',     // newest LOD, where most modern vehicles live
  'ArtArmies.sga',   // shared army content
  'ArtHighXP1.sga',  // Western Front Armies DLC
  'ArtHighXP2.sga',  // British Forces DLC
  'ArtAEF.sga',      // Ardennes Assault
]
```

For each candidate we:
1. `await archives.getFileHandle(sgaName)` via the File System Access API
2. `await SgaArchive.open(file)` — parses the SGA's TOC (152-byte header +
   variable TOC + data block, v7 format)
3. `await a.readByPath('art/armies/german/vehicles/tiger/tiger.rgm')` —
   walks the file table

The path is built from `vehicles.ts`:

```ts
export function rgmPath(v: VehicleSpec): string {
  return `art/armies/${v.faction}/vehicles/${v.id}/${v.id}.rgm`
}
```

First SGA whose `readByPath` returns bytes wins — break out of the loop.

**Critical bug found in this layer**: `SgaArchive.folderForFile()`
originally returned the FIRST folder whose file-index range contained the
file. But SGA folders are hierarchical — a root drive folder spans ALL
files, and leaf folders span subranges. First-match returned the root →
the constructed path was just `tiger.rgm` instead of
`art/armies/german/vehicles/tiger/tiger.rgm`, so lookups silently failed.
Fix: track smallest-range match (the leaf):

```ts
let bestRange = Infinity
let bestName = ''
for (const fld of this.folders) {
  if (fld.fileFirst <= fileIndex && fileIndex < fld.fileLast) {
    const range = fld.fileLast - fld.fileFirst
    if (range < bestRange) { bestRange = range; bestName = name }
  }
}
```

---

## 2. Parse the .rgm (Chunky-wrapped mesh)

RGM is wrapped in Relic's "Chunky" container — a tree of typed chunks
with 28-byte headers (`kind` = FOLD/DATA, `fourCC` like MESH/MRGM/TRIM/
TFMT, version, size, namePos, nameLen).

```ts
// rgm.ts
const { root } = parseChunky(u8)
const tsetChunks = findAllChunks(root, 'TSET')
const textureSets = tsetChunks.map(c => c.name)  // ← paths to texture files
```

Vehicle meshes come in two terminal formats:

- `FOLD/MESH → ... → FOLD/MRGM → DATA v8` — newer (Brummbär and most
  modern vehicles)
- `FOLD/MESH → ... → FOLD/TRIM → DATA v5` — older (Tiger I uses a
  packed-stride TRIM v5 we don't decode yet)

We walk the tree and dispatch by terminal type:

```ts
walkMeshes(root, '', (node, parentName) => {
  const dataChunk = node.children.find(c => c.kind === 'DATA' && c.fourCC === 'DATA')
  if (node.fourCC === 'MRGM' && dataChunk.version === 8) {
    payload = parseMrgmDataV8(u8, dataChunk)
  } else if (node.fourCC === 'TRIM' && dataChunk.version === 5) {
    payload = parseTrimDataV5(u8, dataChunk)
  }
})
```

Each parser pulls out:
- **Vertex positions** (Vec3 × N)
- **Normals** (Vec3 × N, sometimes packed as 4×i8 + decoded to floats)
- **Tangents** (Vec4 × N, w = handedness bit)
- **UVs** (Vec2 × N, sometimes half-float)
- **Triangle indices** (u16 or u32 × M)
- **Bone weights/indices** (skinning data, kept but unused for static rendering)
- **Material name** (slot identifier like `MAT_Tiger_tread_L`)

---

## 3. The coordinate-system conversion (this is the bit that took longest)

Essence engine uses D3D conventions; Three.js uses OpenGL. They differ
in three dimensions and we have to fix each:

| Convention | Essence (CoH2) | Three.js | Fix at parse time |
|------------|---------------|----------|-------------------|
| Y axis | Up | Up | (none) |
| Z axis | Forward (left-handed) | Backward (right-handed) | **Negate Z** on positions, normals, tangents |
| Triangle winding | Clockwise = front-facing | Counter-clockwise = front-facing | **Swap indices 1 and 2** of every triangle |
| UV origin | Top-left (D3D) | Bottom-left (GL) | **Flip V** (`v = 1 - v`) on every UV |

Concretely (in `parseTrimDataV5` and `parseMrgmDataV8`):

```ts
// Negate Z on every vertex
for (let i = 0; i < positions.length; i += 3) {
  positions[i + 2] = -positions[i + 2]
}
// Same for normals, tangents

// Flip V on every UV
for (let i = 0; i < uvs.length; i += 2) {
  uvs[i + 1] = 1 - uvs[i + 1]
}

// Swap indices 1 and 2 of every triangle (preserves backface culling)
for (let i = 0; i < indices.length; i += 3) {
  const tmp = indices[i + 1]
  indices[i + 1] = indices[i + 2]
  indices[i + 2] = tmp
}
```

Without ALL THREE fixes you get one of: model facing the wrong way, every
face culled (you see nothing), or a textured model with the texture
mirrored. Took two evenings of staring at a black tank to figure out which
was which.

---

## 4. Locate the diffuse (.rgt) texture

The RGM advertises which texture sets it uses via `TSET` chunks (e.g.
`art\armies\german\vehicles\tiger\tiger_dif`). We try every advertised
path PLUS some hardcoded fallbacks because some vehicles have non-obvious
basenames:

```ts
// Viewport.tsx
const aliases: Record<string, string[]> = {
  elefant: ['elefant_hull', 'elefant'],
  ostwind_flak_panzer: ['ostwind', 'ostwind_flak_panzer'],
  sdkfz_222: ['sdkfz221', 'sdkfz_222'],
  panther_ausf_g: ['panther', 'panther_ausf_g'],
  king_tiger_sdkfz_182: ['kingtiger'],
  // ... ~12 more
}
const bases = aliases[vehicle.id] ?? [vehicle.id]
```

Diffuse candidates:

```ts
const tsetPaths = candidates.map(c =>
  c.replace(/\\/g, '/').toLowerCase() + '.rgt')
const fallbackPaths = bases.flatMap(b => [
  `${dirPath}${b}_dif.rgt`,
  `${dirPath}${b}_hull_dif.rgt`,
])
const allPaths = [...new Set([...tsetPaths, ...fallbackPaths])]
```

For each path we try the home SGA first, then every cached SGA. We cache
opened SGAs by name because parsing a 50 MB+ archive's TOC takes 1–2
seconds and we don't want to re-parse for every candidate path:

```ts
const archiveCache = new Map<string, SgaArchive>()
const getArchive = async (name: string): Promise<SgaArchive | null> => {
  if (archiveCache.has(name)) return archiveCache.get(name)!
  // open + cache
}
```

We also rank textureSets to suppress wreck/destroyed variants from being
picked as the diffuse, using the same regex used for mesh partitioning
(`/destroy/i`, `/wreck/i`, `/_dam_/i`, etc.).

---

## 5. Decode the .rgt (Chunky-wrapped DXT mip pyramid)

```
// rgt.ts
FOLD/TSET → FOLD/TXTR → FOLD/DXTC →
  DATA/TFMT (width, height, format)
  DATA/TMAN (per-mip { uncompressed_size, compressed_size })
  DATA/TDAT (concatenated zlib blocks, smallest mip first → largest last)
```

We:
1. Read TFMT to get width × height
2. Read TMAN to get per-mip size table (typically 9–12 mips for 2048² textures)
3. Skip past every mip but the last (we only need the highest-resolution
   one for both rendering and editing)
4. zlib-inflate the top-mip block → raw BC1 or BC3 bytes

Format detection by mip-byte-count is more reliable than the TFMT format byte:

```ts
const blocks = ceil(width/4) * ceil(height/4)
// BC1 = 8 bytes/block, BC3 = 16 bytes/block
const isBc1 = abs(pixels.length - blocks*8) < abs(pixels.length - blocks*16)
const fourCC = isBc1 ? 'DXT1' : 'DXT5'
```

---

## 6. Two texture paths from one decode

We need TWO things from the same RGT bytes:
- A **GPU texture** for fast rendering
- An **editable CPU canvas** for the user to paint decals on

`rgt.ts` gives us both:

**GPU path** (`rgtToCompressedTexture`):
- Synthesise a 128-byte DDS file header, prepend to the BC bytes
- `new DDSLoader().parse()` → mipmaps array
- Wrap in `THREE.CompressedTexture(parsed.mipmaps, w, h, format, ...)`
- Set `flipY = true`, `colorSpace = SRGBColorSpace`

**CPU path** (`bcToCanvas`):
- Pure-JS `decodeBc1` or `decodeBc3` → `Uint8ClampedArray` of RGBA pixels
- BC3 = 8-byte alpha block + 8-byte BC1-style colour block per 4×4 pixels
- Decoder unpacks endpoints (RGB565), interpolates 4-entry palette, looks
  up 2-bit index per pixel
- For BC3, alpha is separate: 8-bit endpoints + 3-bit index per pixel
- Output `Uint8ClampedArray` is wrapped in `ImageData` and drawn onto a
  fresh `<canvas>`
- 2048² BC3 decode takes ~50–80 ms on modern hardware

We use the **canvas path** for the live editor (because we need to paint
on it) and the GPU path is only used as a fallback when software decode
throws.

---

## 7. Bind the texture to the material

```ts
const diffuse = new THREE.CanvasTexture(diffuseImage)  // diffuseImage = bcToCanvas output
diffuse.flipY = true                  // matches the V-flip we did at parse
diffuse.colorSpace = THREE.SRGBColorSpace
diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
diffuse.anisotropy = 4

// Per submesh:
const mat = new THREE.MeshStandardMaterial({
  map: diffuse,
  normalMap: normalTex,
  color: 0xffffff,
  metalness: 0.05,    // most vehicle paint is matte
  roughness: 0.85,    // slightly rough — not glossy plastic
})
if (normalTex) mat.normalScale = new THREE.Vector2(1.0, 1.0)
```

The V-flip story has THREE flips that need to sum to identity:
1. RGM parser flips V on UVs (D3D → GL)
2. CanvasTexture has `flipY = true` (the canvas is "right way up" in JS
   but Three.js' default would flip it)
3. With `flipY = true`, the texture is sampled the way the original
   D3D-coord UVs expected

If you forget any one of these, the texture is mirrored or upside-down
on the model.

---

## 8. Normal maps — same flow but linear color space

Same Chunky/RGT decode pipeline as diffuse, with two important differences:
- `colorSpace = LinearSRGBColorSpace` (NOT sRGB — normal maps are linear
  data, not perceptual color)
- `normalScale = new Vector2(1.0, 1.0)` — controls how strongly normal-map
  detail perturbs the surface

We also suppress destroyed/wreck normal-map variants from candidate
ranking, otherwise you can get `tiger_destroyed_nrm.rgt` bound to the
intact hull → inverted shading on visible panels.

---

## 9. Auto-fit + framing

CoH2 models are in arbitrary world units. We normalise:

```ts
const box = new THREE.Box3().setFromObject(group)
const size = box.getSize(new THREE.Vector3())
const longest = Math.max(size.x, size.y, size.z)
const scale = longest > 0.0001 ? 5 / longest : 0.01  // ~5 unit max
group.scale.setScalar(scale)

// AFTER scaling, recompute bbox to place on ground
const scaledBox = new THREE.Box3().setFromObject(group)
const scaledCenter = scaledBox.getCenter(new THREE.Vector3())
group.position.x = -scaledCenter.x        // centre X
group.position.z = -scaledCenter.z        // centre Z
group.position.y = -scaledBox.min.y       // bottom of bbox at y=0 (tracks on ground)
```

Camera framing uses the bounding sphere:

```ts
const radius = finalSize.length() * 0.5
const fovRad = (camera.fov * Math.PI) / 180
const dist = (radius / Math.sin(fovRad / 2)) * 0.85  // 0.85 = tight margin
const dir = new THREE.Vector3(1, 0.45, 1).normalize()  // 3/4 elevation
camera.position.copy(finalCenter).addScaledVector(dir, dist)
camera.lookAt(finalCenter)
```

---

## 10. Wreck/intact partitioning (the z-fight fix)

Many CoH2 RGMs bundle BOTH intact and destroyed submeshes in the same
file, occupying overlapping world-space coordinates:

```ts
const DESTROYED_PATTERNS = [
  /destroy/i, /wreck/i, /destruction/i,
  /burnt/i, /broken/i, /\bdmg\b/i, /_dam_/i,
]
const intact = [], destroyed = []
for (const sub of model.meshes) {
  if (isDestroyedMesh(sub.name)) destroyed.push(sub)
  else intact.push(sub)
}
const visible = showDestroyed && destroyed.length > 0 ? destroyed : intact
```

Render only one set. Without this, panel-level z-fighting flickers across
orbit ("Tiger clipping into destroyed Tiger" symptom).

---

## 11. Lighting that reads correctly

This took about as long as the coord system. The ACES Filmic tone-mapping
pipeline interacts non-obviously with light intensities:

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.6  // bumped from 1.2 — Electron renders darker than dev Chrome

// 3-point + hemisphere
new THREE.HemisphereLight(0xa0b0c8, 0x303030, 0.85)        // cool sky / warm-ish ground
new THREE.DirectionalLight(0xfff1d6, 1.45).position.set(5, 8, 5)    // key (warm front-right)
new THREE.DirectionalLight(0x90a8c8, 0.65).position.set(-6, 4, -3)  // fill (cool front-left)
new THREE.DirectionalLight(0xb0c4d8, 0.75).position.set(-2, 2, -8)  // rim (cool back)
```

Critical NOT-TO-DOs:
- No `Three.Sky` shader → bleeds bright blue into backdrop-blur card
  chrome and washes the model to white
- No PMREM environment map → IBL probe overwhelms direct lighting; tank
  looks like it's photographed in a snowstorm
- No tone-mapping = washed out, too bright; tone-mapping with too-low
  exposure = murky and dark

---

## 12. End-to-end summary diagram

```
File System Access API → CoH2/Archives/
                            ↓
                   getFileHandle("ArtHigh.sga")
                            ↓
                   SgaArchive.open(file)
                            ↓        (152-byte header + TOC parse)
                   readByPath("art/armies/.../tiger.rgm")
                            ↓        (lookup via leaf-folder match)
                   inflate compressed payload
                            ↓
                   parseRgm(bytes)
                            ↓        (Chunky walk → MRGM v8 / TRIM v5)
                   coord-system fix (negate Z, swap idx, flip V)
                            ↓
                   THREE.BufferGeometry × N submeshes

   In parallel:
   model.textureSets[]  → "art/armies/.../tiger_dif"
                            ↓
                   try every path × every cached SGA
                            ↓
                   readByPath() → RGT bytes
                            ↓
                   decodeRgt(bytes)
                            ↓        (Chunky walk → TFMT/TMAN/TDAT)
                   inflate top-mip → BC1/BC3 raw bytes
                            ↓
                   bcToCanvas() → 2048² RGBA canvas
                            ↓
                   THREE.CanvasTexture(canvas, flipY=true, sRGB)

   Combine:
   MeshStandardMaterial({ map, normalMap, metalness, roughness })
                            ↓
                   per-submesh THREE.Mesh
                            ↓
                   auto-fit (scale, ground placement)
                            ↓
                   camera framing (bounding sphere × tight margin)
                            ↓
                   add to scene, render
```

Once on screen, the user can click on the model. Raycast returns the UV
of the hit point; we convert UV → 2048² pixel coords, store the decal,
re-paint the canvas, mark the texture as needing GPU upload, and the
next frame shows the change. That's the editing loop.
