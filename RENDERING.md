# CoH2 Skin Editor — Technical Handoff: Rendering Pipeline

A walkthrough of how the editor reads a CoH2 install, parses Essence-engine
binary formats, decodes BC-compressed textures, drives a Three.js viewport,
turns mouse clicks into UV-space decal placements, and re-encodes everything
back into a CoH2-loadable .sga archive.

Project root: `/home/jflessenkemper/dev/coh2-skin-editor`

---

## 1. The 30-second mental model

```
SGA archive  →  Chunky container  →  RGM (mesh) + RGT (texture)  →  Three.js scene
                                            ↓
                                BC1/BC3 → CPU pixel canvas (2048²)
                                            ↓
                                CanvasTexture bound to material
                                            ↑
                                Decal painter writes here
                                            ↑
                                Raycast: mouse click → UV → canvas pixel
```

Everything below is one of those arrows in detail.

---

## 2. File-format stack (low to high)

### 2a. SGA — the outer archive
- File: `src/lib/sga.ts` (reader), `src/lib/sga-writer.ts` (writer)
- 152-byte file header + variable TOC + data block
- v7 layout (CoH2): magic `_ARCHIVE`, u16 major (=7), u16 minor, 128 bytes
  UTF-16 archive name, u32 header_size, u32 data_pos, u32 reserved (=1)
- TOC starts at offset 152. 40-byte TOC header → 4 drive defs (148 b each)
  → folder defs (20 b each) → file defs (30 b each) → names section
- File def per-entry: `namePos, dataPos, length, storeLength, modSec,
  verification, storage, crc, hashPos`
- Storage: `0` = raw, `1` = chunked compressed (multiple zlib pages, ~256 KB
  each — **NOT YET DECODED — see open blockers**), `2` = monolithic zlib
- Drives split content: `attrib`, `locale`, `info`, `data`. Workshop subs
  use this exact layout.
- Two TOC trailer u32s at offsets 184/188 are **required** non-zero or the
  engine rejects the pack (`section_size` and `page_size = 0x00040000`)

### 2b. Chunky — Relic's chunk container, used inside RGM/RGT/RGD
- File: `src/lib/chunky.ts`
- 28-byte chunk headers: `kind` ('FOLD' or 'DATA', 4 chars), `fourCC` (4 chars,
  e.g. 'MESH', 'MRGM', 'TFMT'), u32 version, u32 size, u32 namePos, u32 nameLen,
  optional name string
- FOLD chunks contain children, DATA chunks carry payload bytes
- Tree walk: `findChunk(root, 'TFMT')`, `findAllChunks(root, 'MTRL')`

### 2c. RGM — Relic Geometry Model
- File: `src/lib/rgm.ts`
- Two terminal mesh-data variants in CoH2:
  - `FOLD/MESH → ... → FOLD/MRGM → DATA v8` (newer, Brummbär and most newer vehicles)
  - `FOLD/MESH → ... → FOLD/TRIM → DATA v5` (older, some vehicles use it
    exclusively — Tiger I has a packed-stride TRIM v5 the parser doesn't
    handle yet, hence the default vehicle is now Brummbär)
- Each terminal yields: vertex positions (Vec3), normals, UVs (Vec2), tangents,
  triangle indices, bone weights/indices, optionally a material name
- Coordinate system fix is critical:
  - Essence engine = D3D left-handed Y-up
  - Three.js = OpenGL right-handed Y-up
  - Conversion: **negate Z** on positions/normals/tangents, **swap indices
    1 and 2** of every triangle (flips winding so outward faces still cull
    backwards correctly), **flip V** on UVs (D3D top-left origin → GL
    bottom-left)
- Output: array of `RgmMesh { name, geometry: THREE.BufferGeometry,
  materialName }` plus `textureSets` (paths the model references, e.g.
  `art\armies\german\vehicles\tiger\tiger_dif`) plus a material-params Map
- Parser also extracts material slot names like `MAT_Tiger_tread_L` so we
  can rank diffuse-texture candidates (drop variants that look like wreck/
  destroyed/dirty etc.)

### 2d. RGT — Relic Generic Texture
- File: `src/lib/rgt.ts`
- Chunky-wrapped DXT mip pyramid:
  ```
  FOLD/TSET → FOLD/TXTR → FOLD/DXTC →
    DATA/TFMT (width, height, format)
    DATA/TMAN (mip table: per-mip { uncompressed, compressed } pairs)
    DATA/TDAT (concatenated zlib blocks, smallest mip first)
  ```
- We decompress only the largest mip (top of pyramid); editor doesn't need
  the smaller ones
- Format detection by mip-byte-count: BC1 = 8 b/block, BC3 = 16 b/block —
  more reliable than the format-code byte across legacy CoH2 textures
- Two output paths from `decodeRgt(buf)`:
  - `rgtToCompressedTexture(rgt)` — synthesises a 128-byte DDS header,
    runs Three.js `DDSLoader.parse()`, returns a GPU `CompressedTexture`.
    **Fast** but not paintable from JS.
  - `bcToCanvas(pixels, width, height, fourCC)` — full software BC decode
    to RGBA Uint8ClampedArray, drawn onto a 2D canvas. **Slow** (~50–80 ms
    for 2048² BC3) but the canvas is editable from JS.

### 2e. BC decoder / encoder
- `src/lib/bc-decode.ts` — pure JS BC1/BC3 → RGBA decoder
- `src/lib/bc-encode.ts` — pure JS BC3 encoder, simple min-max endpoint
  selection per 4×4 block. Quality is "passable" (no iterative least-squares
  refinement) but visually indistinguishable from artist-grade compressors
  at gameplay distance
- Both work block-by-block. BC3 = 8-byte alpha block + 8-byte BC1-style
  colour block per 4×4 pixels = 16 bytes per block

---

## 3. Three.js scene setup (`src/components/Viewport.tsx`)

### 3a. Once-on-mount initialisation
- `WebGLRenderer({ antialias: true, alpha: false })` — opaque background
- Background: solid `0x0a0b0e` (near-black). Earlier we used `Three.Sky`
  but it bled bright atmospheric blue into the backdrop-blur card chrome
- Camera: `PerspectiveCamera(38°, aspect, 0.1, 200)` at `(8, 4, 8)` looking
  at `(0, 1.2, 0)` initially — this gets overridden per-vehicle to frame
  the bounding sphere
- `OrbitControls` with damping
- Lighting (3-point + hemisphere — NO env map / PMREM, those washed out
  diffuse tones):
  - `HemisphereLight(0xa0b0c8, 0x202020, 0.50)` — cool sky / dim ground
  - Key `DirectionalLight(0xfff1d6, 1.10)` at `(5, 8, 5)` — warm front-right
  - Fill `DirectionalLight(0x90a8c8, 0.40)` at `(-6, 4, -3)` — cool front-left
  - Rim `DirectionalLight(0xb0c4d8, 0.55)` at `(-2, 2, -8)` — back light
- Ground: 200×200 `PlaneGeometry` with `MeshStandardMaterial` color `0x1c1e22`
  rotated `-π/2` on X, accepts shadows
- Subtle dark grid helper (10% opacity) above the ground — gives spatial cues
  without "techy CAD" look
- `tick()` rAF loop: `controls.update()`, mark `overlayTexRef.current.needsUpdate`
  if present, lerp explode positions, `renderer.render(scene, camera)`
- `ResizeObserver` keeps renderer + camera aspect in sync with container

### 3b. Per-vehicle reload (when `vehicle.id` or `root` changes)
1. Walk `locateArchives(root)` candidates: `CoH2/Archives`, `Archives`,
   `Company of Heroes 2/CoH2/Archives`, etc.
2. Try a list of SGA candidates in priority order (`ArtHigh`, `ArtArmies`,
   `ArtHighXP1`, `ArtHighXP2`, `ArtAEF`) — first one whose `readByPath()`
   returns the RGM bytes wins
3. `parseRgm(bytes)` → `RgmModel`
4. Resolve diffuse texture: take the RGM's `textureSets`, rank with a
   wreck-suppressor, fall back to hardcoded aliases per vehicle ID
   (e.g. `elefant` → `elefant_hull_dif.rgt`, since the entity dir name
   doesn't match the texture basename)
5. Search every cached SGA for `art/armies/<faction>/vehicles/<id>/<base>_dif.rgt`
6. `decodeRgt(rgtBytes)` → `bcToCanvas(...)` → `THREE.CanvasTexture` —
   stored in `baseTextureRef.current`
7. Same flow for normal map (`*_nrm.rgt`), filtered to suppress destroyed
   variants
8. Build geometry: partition meshes into "intact" vs "destroyed" by name
   regex (`destroy`, `wreck`, `dmg`, `_dam_`, `burnt`, `broken`, `destruction`),
   render only the requested set (so wrecked panels don't z-fight intact ones)
9. For each visible submesh: `new MeshStandardMaterial({ map: diffuse,
   normalMap, color: 0xffffff, metalness: 0.05, roughness: 0.85 })`,
   `normalScale = (1.0, 1.0)` if normal map present
10. Auto-fit: scale longest axis to ~5 units, centre X/Z, push bbox.min.y
    to y=0 so tracks rest on the ground
11. Reframe camera: `dist = (radius / sin(fov/2)) * 0.85` from the model
    centre along a `(1, 0.45, 1)` normalised direction → tank fills the
    viewport, slight 3/4 elevation
12. `submeshMapsRef.current` populated with `name → Mesh` for the explode/
    parts feature
13. Call `onModelLoaded(model, diffuseImage)` — Editor.tsx stores
    `diffuseImage` in `baseDiffuseRef` and uses it as the painting bottom layer
14. Bump `setModelTick(n => n+1)` — triggers the overlay-binding effect

### 3c. Overlay-binding effect (the live edit hook)
- Triggered by `[overlayCanvas, modelTick]`
- If `overlayCanvas` is provided: create `THREE.CanvasTexture(overlayCanvas)`
  once, stash in `overlayTexRef.current`, swap every mesh's `material.map` to
  point at the overlay texture
- If `overlayCanvas` is null: rebind back to `baseTextureRef.current`
- Without the `modelTick` dependency, the binding only ran on first overlay
  prop change (which happens before first model load completes) → models
  loaded later kept showing the base texture

---

## 4. The painting / UV pipeline

### 4a. Where the canvas lives
- `Editor.tsx` owns a single `2048×2048` HTMLCanvasElement (`overlayCanvasRef`)
- Same 2048² is what CoH2 expects for skin-pack textures regardless of the
  source resolution
- Editor passes this canvas as `overlayCanvas` prop to `Viewport`. Viewport
  wraps it in a `THREE.CanvasTexture`, which Three.js uploads to the GPU
  every frame the texture's `needsUpdate` flag is set (we set it every rAF tick)

### 4b. Repainting (`Editor.tsx` `repaint()` callback)
1. `clearRect(0, 0, 2048, 2048)`
2. `drawImage(baseDiffuseRef.current, 0, 0, 2048, 2048)` — bottom layer:
   the vanilla diffuse pixels we decoded once at vehicle load
3. `paintDecals(renderCtx, veh.decals, activeDecalId)` — top layer
4. If hovering with a place mode active, paint a 55%-alpha ghost of the
   pending decal at the hover position
5. The CanvasTexture's `needsUpdate = true` is set every rAF tick in the
   Viewport, so the GPU sees the new pixels next frame

### 4c. Decal painter (`src/lib/decal-painter.ts`)
- One render context: `{ ctx, palette, defaultTac, vehicleName, tac, images }`
- Walks decal list. For each:
  - `ctx.save() → translate(x, y) → rotate(rot * π/180)` — decals rotate
    around their own centre
  - Dispatch by `decal.type`:
    - `shield` — Tot-style shield path
    - `number` — bortnummer (3-digit tactical, white-fill black-stroke)
    - `name` — vehicle nickname
    - `kills` — concentric arcs (one per kill ring)
    - `cross` — Balkenkreuz (white outline + black-fill cross)
    - `image` — custom user-imported image, opacity-modulated
- Active decal gets an orange selection ring (drawn AFTER the decal so it
  sits on top visually)
- Custom images use a small async cache: `getCachedImage()` returns null
  on first call, kicks off `new Image()` decode, fires `onReady()` when
  loaded — caller (Editor) re-runs `repaint()`

### 4d. Raycast: mouse click → UV → canvas pixel
- `Viewport.pickUV(e)`:
  ```ts
  pointerRef.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
  pointerRef.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycasterRef.setFromCamera(pointerRef, cameraRef)
  const hits = raycasterRef.intersectObject(meshGroupRef, true)
  return hits[0].uv  // Three.js auto-interpolates UVs from triangle vertices
  ```
- `Editor.addDecal(uv)`:
  ```ts
  const x = Math.round(uv.u * 2048)
  const y = Math.round((1 - uv.v) * 2048)  // note V flip
  ```
  The V-flip here matters because:
  - Viewport raycast returns Three.js UVs (V increases UPWARD)
  - Decal coordinates are stored in PSD-orientation pixel space
    (Y increases DOWNWARD from top-left)
  - Decal painter draws using PSD coords directly to the 2048² canvas
- Hover: throttled with rAF (`hoverPendingRef`). `onMouseMove` fires
  `pickUV(e)` then `setHover({ x, y })` if mode is on, triggering a repaint
  that draws the ghost preview

### 4e. Procedural camo generator (`src/lib/camo-generator.ts`)
- Recent addition. Pure procedural — draws straight onto a passed-in canvas
  without clearing
- Four styles: `softBlobs`, `hardEdge`, `whitewash`, `stripes`
- Preset: `{ style, colors: [base, secondary, tertiary], seed, scale,
  rotation, blur, label }`
- Editor calls `generateCamo(tmpCanvas, preset)` then `drawImage(tmpCanvas, 0, 0)`
  onto BOTH the overlay AND `baseDiffuseRef.current` (so subsequent repaints
  preserve the camo as the new base layer; decals composite on top)
- Has a `parsePrompt(text)` keyword matcher: "german ambush winter" →
  preset with whitewash + olive/dark-green colors

---

## 5. Export pipeline (closing the loop)

`src/lib/mod-export.ts` is the high-level orchestrator. For each vehicle
the user has placed decals on:

1. Open the relevant faction-specific SGA from the install (per
   `factionSgaCandidates(faction)` — `ArtGermanEF.sga` etc.)
2. Read the vanilla diffuse RGT
3. Software-decode BC1/BC3 → 2048² RGBA canvas (`bcToCanvas`)
4. Paint user's decals onto a fresh 2048² canvas (`paintDecals`)
5. Re-encode that canvas to BC3 via `encodeBc3(rgba, 2048, 2048)` (~8 MB output)
6. Wrap in RGT format: Chunky `FOLD/TSET → FOLD/TXTR → FOLD/DXTC →
   DATA/TFMT/TMAN/TDAT` (`src/lib/rgt-writer.ts`). Top mip is our BC3, smaller
   mips are empty zlib streams (engine doesn't fault on missing mips for
   skin-pack textures)
7. Add the RGT bytes to the SGA file list at path
   `art/armies/<faction>/vehicles/<id>/skins/<modGuid>_<season>/<id>_dif.rgt`
   (twice: once for summer, once for winter slot)
8. Drop in the 9 template files from `public/template/` (1 .info, 6 .rgd,
   1 .ucs, 1 .gfx) with GUID rewrites
9. `buildSga({ archiveName: newGuid, files })` produces the final v7 SGA
10. Suggested filename = `<numericId>.sga` where numericId is a fresh
    decimal u64 (engine scans `mods/skins/` looking for `%I64u.sga` pattern;
    hex GUID filenames are silently ignored)
11. Install via `installSkinPack(modsHandle, numericId, bytes)` — writes
    directly into the user's `mods/skins/` folder via FS Access API

The Node test harness `tools/test-export.ts` runs this exact pipeline
outside the browser using a `fs.openSync()` shim instead of a
`FileSystemDirectoryHandle`. It produces a 66 MB SGA in ~15 s for all 19
OstHeer/OKW vehicles.

---

## 6. Texture states / rendering invariants

A vehicle has THREE texture representations active simultaneously:

| Layer | Where | Format | Lifetime | Mutability |
|-------|-------|--------|----------|------------|
| **Base diffuse** | `baseDiffuseRef.current` (Editor.tsx) | 2048² RGBA canvas | Until vehicle changes | Replaced by camo apply |
| **Overlay**      | `overlayCanvasRef.current` → `overlayTexRef` `THREE.CanvasTexture` | 2048² RGBA canvas → GPU texture | Whole session | Repainted every project mutation |
| **Vanilla GPU fallback** | `baseTextureRef.current` `THREE.CanvasTexture` | Same canvas as base, separate Texture instance | Until vehicle changes | Read-only, used when overlay is null |

The chain: `Editor.repaint()` clears overlay → blits base → paints decals →
sets `needsUpdate` → next rAF tick uploads → GPU material samples it.

---

## 7. Coordinate-system gotchas reference

- **D3D LH-Y → GL RH-Y mesh fix** (`rgm.ts`): negate Z on every position/
  normal/tangent, swap indices 1 and 2 of every triangle
- **D3D top-left UVs → GL bottom-left** (`rgm.ts`): flip V on every UV
  (`v = 1 - v`) at parse time
- **DDS V-flip vs CanvasTexture V-flip** (`rgt.ts`): `tex.flipY = true`
  on both `CompressedTexture` and `CanvasTexture` outputs — combined with
  the rgm.ts UV flip, this sums to identity, matching the original D3D look
- **PSD pixel coords vs raycast UV** (`Editor.addDecal`): raycast returns
  UVs in `[0,1]` with V-up; we convert to PSD-orientation by `y = (1-v) * 2048`
  before storing in `decal.x/y`
- **`folderForFile()` SGA reader bug** (`sga.ts`): walks all folders, returns
  the smallest-range match (= leaf folder). Returning first-match returned
  the root drive folder, breaking every path lookup

---

## 8. Open blockers (what's still broken)

### Blocker A: storage=1 chunked compression
**File**: `src/lib/sga.ts` `readFile()`
**Symptom**: `pako.inflate` throws `invalid stored block lengths` on RGM files
from `ArtHigh.sga`
**Cause**: SGA v7 stores large files in ~256 KB independently-compressed pages.
We treat them as one continuous zlib stream
**Fix path**: Decompile `RelicCore.dll`'s `Archive` class (decomp at
`/tmp/reliccore_decomp/RelicCore.decompiled.cs`) — find the `readFile` method,
implement chunked iteration. Likely format per chunk: `u32 stored_size,
u32 actual_size, then stored_size bytes (zlib if smaller than actual,
raw otherwise)`

### Blocker B: Sig hash makes engine reject our SGAs
**Symptom**: `MOD -- Error loading mod pack 'X.sga': not unsigned.`
**Verified**: Sig is content-derived (changing 8 bytes of data block shifts
Sig by 15872). Two HMAC-MD5 keys live in `RelicCoH2.exe` (offsets `0x241d120`,
`0x1fd44f8`). v7 has no inline MD5 fields in the file header (confirmed via
RelicCore.dll decompilation: `if (Version < 6) { FileMD5 = ... }`).
None of HMAC-MD5(K, region) or MD5(K || region) matched the engine's reported Sig.
**Fix path**: Disassemble `RelicCoH2.exe` via Ghidra (project already imported
at `/tmp/ghidra-proj/`). Find xref to format string at file offset `0x1f5dc18`
(VMA `0x141EFFE18`). Trace which function computes the `%llu` argument

---

## 9. File reading priority order for someone picking this up

1. `src/lib/sga.ts` — outer archive reader (small, well-commented)
2. `src/lib/chunky.ts` — Relic chunk container (tiny)
3. `src/lib/rgt.ts` — texture format wrapper
4. `src/lib/bc-decode.ts` + `src/lib/bc-encode.ts` — DXT codec
5. `src/lib/rgm.ts` — mesh format (longest, contains the coord-system fixes)
6. `src/lib/decal-painter.ts` — Canvas2D draw routines
7. `src/components/Viewport.tsx` — scene setup, model loading, raycast
8. `src/components/Editor.tsx` — orchestrator: project state, repaint loop,
   passes overlay canvas to Viewport
9. `src/lib/mod-export.ts` + `src/lib/sga-writer.ts` + `src/lib/rgt-writer.ts`
   — write-side of the pipeline
10. `tools/test-export.ts` — Node test harness; reproduces the export
    pipeline outside the browser

---

## 10. Other docs in the repo

- `HANDOFF.md` — project status, open blockers, recommended next steps
- `RENDERING.md` — this file (rendering pipeline deep-dive)
