# CoH2 Skin Editor — Full Session Handoff

This is the single document to hand to the next chat. It combines:
1. **Project status** (what works, what doesn't, what's next)
2. **Rendering pipeline architecture** (texture, UV, decal system)
3. **Work journey** (bugs found, decisions made, lessons learned)
4. **Open blockers** (with everything needed to unblock)

Companion files:
- `HANDOFF.md` — short status brief
- `RENDERING.md` — pipeline-only deep-dive (subset of this doc)

Project root: `/home/jflessenkemper/dev/coh2-skin-editor`

---

## Part 1 — What we built

A static-deployable React/TypeScript web app that lets a user:
- Connect to their local CoH2 install via the File System Access API
- Browse 19 OstHeer / OKW vehicles in a 3D viewport
- Place 6 decal types (shield, number, name, kills, cross, custom image)
  by clicking on the 3D model
- Apply procedural camo (4 styles, parsed from text prompts)
- Toggle exploded-parts view and intact-vs-destroyed model variants
- Auto-save projects, save/load `.coh2skin` files
- Build a v7 SGA archive, install it directly into the Steam mods folder

UI: Apple-style dark glassmorphism, BorderBeam ocean accent (faithful port
from `beam.jakubantalik.com`), sheet-in-place expansion (no modal-on-modal),
spring-bounce on every press, ASAP Australia branding.

The editor is **end-to-end functional inside the browser**. The exported
SGA is **not yet loadable in CoH2** — two specific blockers detailed in
Part 4.

---

## Part 2 — Rendering pipeline

### 2a. The 30-second mental model

```
SGA archive  →  Chunky container  →  RGM (mesh) + RGT (texture)
                                            ↓
                                Three.js BufferGeometry + CompressedTexture
                                            ↓
                                BC1/BC3 → CPU pixel canvas (2048²)
                                            ↓
                                CanvasTexture bound to material  ← repaints
                                            ↑
                                Decal painter writes here
                                            ↑
                                Raycast: mouse → UV → canvas pixel
```

### 2b. File-format stack

**SGA — outer archive** (`src/lib/sga.ts`, `src/lib/sga-writer.ts`)
- 152-byte file header + variable TOC + data block
- v7 layout: magic `_ARCHIVE`, u16 major (=7), u16 minor, 128 b UTF-16
  archive name, u32 header_size, u32 data_pos, u32 reserved (=1)
- TOC at offset 152: 40-b TOC header → 4 drive defs (148 b each) →
  folder defs (20 b) → file defs (30 b) → names section
- Drives split content: `attrib` / `locale` / `info` / `data`
- File def: `namePos, dataPos, length, storeLength, modSec, verification,
  storage, crc, hashPos`. Storage `0`=raw, `1`=chunked-compressed (BLOCKER A),
  `2`=monolithic zlib
- TOC trailer u32s at 184/188 are required non-zero (`section_size` and
  `page_size = 0x00040000`) — engine rejects packs without them

**Chunky container** (`src/lib/chunky.ts`) — Relic's chunk-tree wrapping
RGM/RGT/RGD. 28-byte chunk headers: `kind` (FOLD/DATA), `fourCC` (e.g.
MESH, MRGM, TFMT), version, size, namePos, nameLen.

**RGM — mesh** (`src/lib/rgm.ts`)
- Two terminal mesh-data variants in CoH2:
  - `FOLD/MESH → ... → FOLD/MRGM → DATA v8` — newer, used by Brummbär and most modern vehicles
  - `FOLD/MESH → ... → FOLD/TRIM → DATA v5` — older, some vehicles use it exclusively (Tiger I has a packed-stride TRIM v5 the parser doesn't decode yet → default vehicle is now Brummbär)
- Each terminal yields: vertex positions (Vec3), normals, UVs (Vec2),
  tangents, indices, bone weights/indices, optional material name
- **Coordinate-system conversion (critical):**
  - Essence engine = D3D left-handed Y-up
  - Three.js = OpenGL right-handed Y-up
  - Negate Z on every position/normal/tangent
  - Swap indices 1 and 2 of every triangle (flips winding so backface
    culling still hides interior surfaces)
  - Flip V on UVs (`v = 1 - v`) — D3D top-left origin → GL bottom-left
- Outputs: `RgmMesh[]` (each with name, geometry, materialName), plus
  `textureSets` (paths the model references like
  `art\armies\german\vehicles\tiger\tiger_dif`), plus a Map of material params
- Material slot names like `MAT_Tiger_tread_L` are extracted so we can
  rank diffuse-texture candidates and suppress wreck/destroyed variants

**RGT — texture** (`src/lib/rgt.ts`)
- Chunky-wrapped DXT mip pyramid:
  ```
  FOLD/TSET → FOLD/TXTR → FOLD/DXTC →
    DATA/TFMT (width, height, format)
    DATA/TMAN (per-mip { uncompressed_size, compressed_size })
    DATA/TDAT (concatenated zlib blocks, smallest mip first)
  ```
- We decompress only the largest mip (top of pyramid)
- Format detection by mip-byte-count: BC1 = 8 b/block, BC3 = 16 b/block
  (more reliable than the format-code byte across legacy CoH2 textures)
- Two decode outputs:
  - `rgtToCompressedTexture(rgt)` — synthesises a 128-byte DDS header,
    runs `DDSLoader.parse()`, returns `THREE.CompressedTexture` (GPU-side
    BC, fast but not paintable from JS)
  - `bcToCanvas(pixels, w, h, fourCC)` — pure-JS BC decode to RGBA
    `Uint8ClampedArray`, drawn onto a 2D canvas. Slow (~50–80 ms for
    2048² BC3) but the canvas is editable from JS

**BC codecs** (`src/lib/bc-decode.ts`, `src/lib/bc-encode.ts`)
- Pure-JS BC1/BC3 decoder, BC3 encoder
- Block-by-block: BC3 = 8-byte alpha block + 8-byte BC1-style colour block
  per 4×4 pixels = 16 bytes per block
- Encoder uses simple min-max endpoint selection (no iterative
  least-squares); quality is "passable" — visually indistinguishable from
  artist-grade compressors at gameplay distance

### 2c. Three.js scene setup (`src/components/Viewport.tsx`)

**Once-on-mount initialisation:**
- `WebGLRenderer({ antialias: true, alpha: false })` — opaque
- Background: solid `0x0a0b0e`. Earlier we used `Three.Sky` but its
  atmospheric blue bled into the backdrop-blur card chrome and washed
  out the model
- Camera: `PerspectiveCamera(38°, aspect, 0.1, 200)` initial `(8, 4, 8)`
  → `(0, 1.2, 0)` — overridden per-vehicle to frame the bounding sphere
- `OrbitControls` with damping
- **Lighting** (3-point + hemisphere — NO env/PMREM, those washed diffuse tones):
  - `HemisphereLight(0xa0b0c8, 0x202020, 0.50)` cool sky / dim ground
  - Key `DirectionalLight(0xfff1d6, 1.10)` at `(5, 8, 5)` — warm front-right
  - Fill `DirectionalLight(0x90a8c8, 0.40)` at `(-6, 4, -3)` — cool front-left
  - Rim `DirectionalLight(0xb0c4d8, 0.55)` at `(-2, 2, -8)` — back light
- Ground: 200×200 plane, `MeshStandardMaterial 0x1c1e22, roughness 1.0`
- Subtle dark grid (10% opacity) above ground for spatial cues without CAD-look
- `tick()` rAF loop: `controls.update()`, mark `overlayTexRef.current.needsUpdate`,
  lerp explode positions, render

**Per-vehicle reload (when `vehicle.id` or `root` changes):**
1. Walk `locateArchives(root)` — try `CoH2/Archives`, `Archives`,
   `Company of Heroes 2/CoH2/Archives` etc.
2. Try SGA candidates in priority: `ArtHigh`, `ArtArmies`, `ArtHighXP1`,
   `ArtHighXP2`, `ArtAEF` — first one whose `readByPath()` returns the RGM wins
3. `parseRgm(bytes)` → `RgmModel`
4. **Resolve diffuse**: rank `model.textureSets` (suppress wrecks), fall
   back to hardcoded aliases (`elefant` → `elefant_hull_dif.rgt`, etc.).
   Search every cached SGA for `art/armies/<faction>/vehicles/<id>/<base>_dif.rgt`
5. `decodeRgt → bcToCanvas → THREE.CanvasTexture` → `baseTextureRef.current`
6. Same flow for normal map (`*_nrm.rgt`), wreck-suppressed
7. **Build geometry**: partition meshes into intact vs destroyed by name
   regex (`/destroy/`, `/wreck/`, `/_dam_/`, `/burnt/`, etc.). Render only
   the requested set (otherwise wrecked panels z-fight intact ones — this
   was the "tiger clipping into destroyed tiger" bug)
8. Per submesh: `MeshStandardMaterial({ map, normalMap, color: 0xffffff,
   metalness: 0.05, roughness: 0.85 })`, `normalScale = (1.0, 1.0)` if normals
9. **Auto-fit**: scale longest axis to ~5 units, centre X/Z, push
   `bbox.min.y` to y=0 so tracks rest on the ground
10. **Reframe camera**: `dist = (radius / sin(fov/2)) * 0.85` from model
    centre along `(1, 0.45, 1)` normalised — slight 3/4 elevation, tank fills viewport
11. Populate `submeshMapsRef` with `name → Mesh` for the explode/parts feature
12. `onModelLoaded(model, diffuseImage)` — Editor stores diffuseImage in
    `baseDiffuseRef` as the painting bottom layer
13. Bump `setModelTick(n+1)` — triggers the overlay-binding effect

**Overlay-binding effect (the live edit hook):**
- Triggered by `[overlayCanvas, modelTick]`
- If overlayCanvas provided: create `THREE.CanvasTexture` once, swap every
  mesh's `material.map` to point at it
- If null: rebind to `baseTextureRef.current`
- The `modelTick` dep matters — without it the binding only ran on first
  overlay prop change (which fires before first model load), so models
  loaded later kept showing the base texture

### 2d. The painting / UV pipeline

**Where the canvas lives**
- `Editor.tsx` owns one 2048×2048 HTMLCanvasElement (`overlayCanvasRef`)
- Same 2048² is what CoH2 expects for skin-pack textures regardless of source resolution
- Editor passes this canvas as `overlayCanvas` prop to Viewport. Viewport
  wraps in `THREE.CanvasTexture`. Three.js uploads to GPU every frame the
  texture has `needsUpdate = true` (we set it every rAF tick)

**Repainting** (`Editor.tsx repaint()`)
1. `clearRect(0, 0, 2048, 2048)`
2. `drawImage(baseDiffuseRef.current, 0, 0, 2048, 2048)` — bottom layer
3. `paintDecals(renderCtx, veh.decals, activeDecalId)` — top layer
4. If hovering with place mode active, paint a 55%-alpha ghost of the pending decal
5. CanvasTexture's `needsUpdate = true` is set every rAF tick → GPU sees new pixels next frame

**Decal painter** (`src/lib/decal-painter.ts`)
- Render context: `{ ctx, palette, defaultTac, vehicleName, tac, images }`
- For each decal: `ctx.save → translate(x,y) → rotate(rot * π/180)` then
  dispatch by type. Active decal gets an orange selection ring on top
- Custom images use a small async cache — `getCachedImage()` returns null
  on first call, kicks off `new Image()` decode, fires `onReady()` on load,
  caller re-runs `repaint()`

**Raycast: mouse click → UV → canvas pixel**

```ts
// Viewport.pickUV(e):
pointerRef.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
pointerRef.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
raycasterRef.setFromCamera(pointerRef, cameraRef)
const hits = raycasterRef.intersectObject(meshGroupRef, true)
return hits[0].uv  // Three.js auto-interpolates UVs from triangle vertices

// Editor.addDecal(uv):
const x = Math.round(uv.u * 2048)
const y = Math.round((1 - uv.v) * 2048)  // V-flip!
```

**Why the V-flip on click**: Three.js raycast UVs have V-up. Decal coords
are stored in PSD-orientation pixel space (Y down from top-left, matching
Photoshop/`decal_anchors.json`). The `1 - v` converts.

**Hover throttle**: `hoverPendingRef` rAF-throttles `onMouseMove`
`pickUV(e)` → `setHover({ x, y })` if mode is on. Triggers repaint that
draws the ghost preview.

### 2e. Procedural camo (`src/lib/camo-generator.ts`)
- Pure procedural — draws onto passed-in canvas, doesn't clear
- Four styles: `softBlobs`, `hardEdge`, `whitewash`, `stripes`
- Preset: `{ style, colors: [base, secondary, tertiary], seed, scale,
  rotation, blur, label }`
- Editor calls `generateCamo(tmp, preset)` then `drawImage(tmp, 0, 0)` onto
  BOTH the overlay AND `baseDiffuseRef.current` — so subsequent repaints
  preserve the camo as the new base layer; decals composite on top
- Has `parsePrompt(text)` keyword matcher: "german ambush winter" →
  whitewash + olive/dark-green colors

### 2f. Texture state model

A vehicle has THREE texture representations active simultaneously:

| Layer | Where | Format | Lifetime | Mutability |
|-------|-------|--------|----------|------------|
| Base diffuse | `baseDiffuseRef` (Editor) | 2048² RGBA canvas | Until vehicle changes | Replaced by camo apply |
| Overlay      | `overlayCanvasRef` → `overlayTexRef` CanvasTexture | 2048² canvas → GPU texture | Whole session | Repainted every project mutation |
| Vanilla GPU fallback | `baseTextureRef` | Same canvas as base, separate Texture instance | Until vehicle changes | Read-only, used when overlay null |

Chain: `Editor.repaint()` clears overlay → blits base → paints decals →
sets `needsUpdate` → next rAF tick uploads → GPU material samples it.

### 2g. Coordinate-system gotchas reference

- D3D LH-Y → GL RH-Y mesh fix (`rgm.ts`): negate Z, swap indices 1↔2
- D3D top-left UVs → GL bottom-left (`rgm.ts`): flip V at parse time
- DDS V-flip vs CanvasTexture V-flip (`rgt.ts`): `tex.flipY = true` on
  both — combined with rgm.ts UV flip, sums to identity, matching original
- PSD pixel coords vs raycast UV (`Editor.addDecal`): `y = (1-v) * 2048`
- `folderForFile()` SGA reader bug (`sga.ts`): walks all folders, returns
  smallest-range match (= leaf folder). First-match returned the root
  drive folder, breaking every path lookup

---

## Part 3 — Export pipeline

`src/lib/mod-export.ts` orchestrates. For each vehicle the user has
placed decals on:

1. Open the relevant faction-specific SGA (`factionSgaCandidates` —
   `ArtGermanEF.sga`, `ArtWestGerman.sga`, etc.)
2. Read vanilla diffuse RGT
3. Software-decode BC1/BC3 → 2048² RGBA canvas
4. Paint user's decals onto a fresh 2048² canvas
5. `encodeBc3(rgba, 2048, 2048)` → ~8 MB of BC3 bytes
6. Wrap in RGT format (`src/lib/rgt-writer.ts`): Chunky `FOLD/TSET →
   FOLD/TXTR → FOLD/DXTC → DATA/TFMT/TMAN/TDAT`. Top mip is our BC3,
   smaller mips are empty zlib streams (engine doesn't fault)
7. Add RGT bytes at path
   `art/armies/<faction>/vehicles/<id>/skins/<modGuid>_<season>/<id>_dif.rgt`
   (twice — summer + winter slot)
8. Drop in 9 template files (`public/template/`: 1 `.info`, 6 `.rgd`,
   1 `.ucs`, 1 `.gfx`) with GUID rewrites
9. `buildSga({ archiveName: newGuid, files })` → final v7 SGA bytes
10. Filename = `<numericId>.sga` (decimal u64). Engine scans `mods/skins/`
    looking for `%I64u.sga` pattern; hex GUID filenames are silently ignored
11. `installSkinPack(modsHandle, numericId, bytes)` writes directly into
    `mods/skins/` via FS Access API

Node test harness `tools/test-export.ts` reproduces the export pipeline
outside the browser using a `fs.openSync()` shim. Produces a 66 MB SGA in
~15 s for all 19 OstHeer/OKW vehicles.

---

## Part 4 — Open blockers

### Blocker A — SGA reader can't load some RGM files
**Where**: `src/lib/sga.ts readFile()`
**Symptom**: `pako.inflate` throws `invalid stored block lengths` on
`tiger.rgm` from `ArtHigh.sga`
**Cause**: SGA v7 stores large files in ~256 KB independently-compressed
pages (storage flag `1`). Our reader treats the stored bytes as one
continuous zlib stream, so the second page's bytes appear as garbage
following the end of the first stream
**Evidence**: `tiger.rgm` has `length=213324, storeLen=518804` —
storeLen > length proves chunked, not monolithic zlib. Storage type 1
in working subscription mods has the same pattern
**Effect**: Tiger I model fails to load with `Couldn't find tiger.rgm in
any of the loaded archives` (the lookup actually succeeds via the
`folderForFile` fix; inflate then fails). Brummbär and other
storage-0 / monolithic-storage-2 vehicles work fine — that's why
Brummbär is the new default
**Fix path**:
1. Decompile `RelicCore.dll`'s `Archive` class — decomp already at
   `/tmp/reliccore_decomp/RelicCore.decompiled.cs`
2. Search for `MD5_LENGTH` (line ~440 area), then nearby look for the
   `readFile` / file-decompression method
3. Likely format per chunk: `u32 stored_size, u32 actual_size, then
   stored_size bytes (zlib if smaller than actual, raw otherwise)` — but
   verify against decomp
4. Implement chunked iteration in `readFile()` — accumulate decompressed
   bytes until total = `f.length`

### Blocker B — Engine rejects exports as `'not unsigned'`
**Symptom** in `warnings.log`:
```
ARC -- mods\skins\<id>.sga ... [Sig:1232860824956446041]
MOD -- Error loading mod pack 'mods\skins\<id>.sga': not unsigned.
```
**Verified**:
- ✅ Filename must match `%I64u.sga` (decimal u64) — fixed in writer
- ✅ Page size `0x00040000` at TOC bytes 188-191 — fixed
- ✅ Section size at 184-187 = `header_size` — fixed
- ✅ Format works: a renamed copy of a working Workshop sub at
   `mods/skins/8888888888888888.sga` loads with `Sig:0` (control verified)
- ✅ Sig is content-derived (changing 8 bytes of data block shifted Sig
   by +15872)
- ✅ Two HMAC-MD5 keys found in `RelicCoH2.exe`:
   `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` (file `0x241d120`)
   `FDC245E1-D96A-44BD-B147-A89BD47F43FB` (file `0x1fd44f8`)
- ✅ Corsix's CoH1 v4 uses same idiom: `MD5InitKey(KEY) → MD5(KEY||data)`.
   None of our HMAC-MD5 / MD5(K||region) combos matched the engine's Sig
- ✅ `Ver` field IS confirmed = `MD5(toc_bytes)` (no key)
- ✅ `ID` field IS the archive name string (no hash)
- ✅ v7 SGA header has NO inline MD5 fields (unlike v4) — confirmed in
   `RelicCore.dll` decomp: `if (Version < 6) { FileMD5 = ... }`

**Key offsets in RelicCoH2.exe:**
- `[Sig:%llu]` format string: file `0x1f5dc18` → VMA `0x141EFFE18`
- GUID 1 key VMA: `0x14241F320`, 4 xrefs at `0x140343a96`, `0x140347708`
- GUID 2 key VMA: `0x141FD66F8`, 1 xref at `0x140dfc62a`
- `MOD -- Error loading mod pack ...: not unsigned.` at file `0x1fe170c`
- printf call site (uses Sig): VMA `0x140940b07`

**Fix path**: Disassemble RelicCoH2.exe via Ghidra. Project already
imported at `/tmp/ghidra-proj/` (use `analyzeHeadless` at
`/home/linuxbrew/.linuxbrew/opt/ghidra/libexec/support/analyzeHeadless`).
Find function containing the printf call site at VMA `0x140940b07`.
Decompile to find which hash is fed to the `%llu` arg

**Bisect tool**: `/tmp/coh2_loop.sh` automates build → install → launch
CoH2 → wait for log → kill → parse. One cycle ~30 s.

---

## Part 5 — Linux/Bazzite gotcha (already solved)

Chrome's FS Access API blocks `~/.local`, `~/.steam`, AND `/var`. On
Bazzite (atomic distro), home is physically at `/var/home/USER/` with
`/home/USER` as a symlink. Chrome canonicalises through the symlink and
sees `/var/...` → blocks it. A symlink under `~` doesn't help.

Solution baked into the app: bind mount under `/tmp`:
```bash
sudo mkdir -p /tmp/coh2
sudo mount --bind ~/.local/share/Steam /tmp/coh2
```
Then in the FS Access picker, navigate to
`/tmp/coh2/steamapps/common/Company of Heroes 2/`.

Connect screen has a Linux row that opens a sheet-in-place expansion
(no modal-on-modal — Apple HIG) showing this exact command with a copy pill.

---

## Part 6 — Bug journey & lessons learned

This section documents the non-obvious bugs hit and how they were diagnosed.
Useful when revisiting unfamiliar parts of the code.

### `folderForFile()` returned the wrong folder
- Symptom: `tiger.rgm` lookup returned null even though the file existed
  in the SGA at the expected path
- Root cause: The function walked all folders, returned **first match**.
  But SGA v7 has hierarchical folders (root drive folder covers all files
  + leaf folders cover subranges). First match was the root, so the
  built path was just `tiger.rgm` instead of `art/armies/german/vehicles/tiger/tiger.rgm`
- Fix: Track the smallest range (= leaf folder), return that
- Lesson: Range-based hierarchies need most-specific-match, not first-match

### Wreck/destroyed variants z-fight intact ones
- Symptom: "Tiger clipping into destroyed Tiger" — flickering panels
  during orbit
- Cause: Many CoH2 RGMs bundle both intact + destroyed submeshes in the
  same file, occupying overlapping world-space coordinates
- Fix: Partition meshes by name regex (`/destroy/`, `/wreck/`, `/dmg/`,
  `/_dam_/`, `/burnt/`, `/broken/`, `/destruction/`), render only one set
  based on `showDestroyed` prop. Same regex used to suppress wreck
  textures from candidate ranking
- Also added a fallback: if `showDestroyed` is requested but no destroyed
  parts were tagged, fall back to intact (don't render an empty scene)

### Models loaded later kept showing base texture (overlay didn't bind)
- Symptom: Switching vehicles, the new model showed the vanilla diffuse —
  no decals
- Cause: Overlay-binding `useEffect` had deps `[overlayCanvas]`. The
  prop is stable (Editor owns the canvas, same reference forever). So
  the effect ran once at first mount, before any model had loaded
- Fix: Add `modelTick` to deps, increment it after every successful model
  load. Effect re-runs, binds the overlay to the freshly-built materials

### Model floating in space, camera too far back
- Symptom: Tank rendered as a small thumbnail in a vast dark void
- Cause 1: `group.position.y = 1.2` (hardcoded). Models with different
  bbox heights floated above or sank below the ground
- Cause 2: Camera framing used `dist = radius / sin(fov/2) * 1.15` →
  ~30% empty space on every edge
- Fixes:
  - Compute scaled bbox after scale, push `bbox.min.y` to y=0 (tracks on ground)
  - `dist = (radius / sin(fov/2)) * 0.85` — tank fills viewport
  - Camera target = scaled bbox centre, not hardcoded point
  - Direction `(1, 0.45, 1).normalized()` — slight 3/4 elevation

### Double-shadow ring around the connect card
- Symptom: Visible ring outside the card border, and a second softer
  one further out
- Cause: Card had `border: 0.5px solid white`, an outer drop shadow,
  AND `0 0 0 0.5px white inset` — that inset was 0.5 px inside the actual
  border, creating a visible parallel line
- Fix: Stripped the inset shadow; let the border + drop shadow do the job

### Sky shader washing the model to white
- Symptom: Tank looked like it was photographed on a snow day even in
  summer mode
- Cause: `Three.Sky` + PMREM environment was generating a bright sky-blue
  IBL probe that bled through every reflection
- Fix: Removed Sky/PMREM entirely. 3-point directional + hemisphere only.
  Materials read their diffuse + normal cleanly, not blended with sky tint

### Chrome rejects the canonical install path on Bazzite
- See Part 5

### Sig hash false positive: thought it was a sentinel
- Initially Sig stayed at `1232860824956446041` across multiple builds
  with different content. Concluded it was a hardcoded sentinel for
  "couldn't authenticate"
- Reality: Our content had been ~identical (same template files) so the
  hash was the same. When I XOR'd 8 bytes of the data block, Sig shifted
  by 15872 — proving it's content-derived, not a sentinel
- Lesson: Confirm "constant" values by deliberately mutating sources
  before building theories on them

### Picker focus issues with ydotool
- Symptom: Trying to drive Chrome's file picker via `ydotool type`,
  the typed text appeared in the wrong window (Claude Code's chat input
  instead of the picker)
- Cause: Wayland `ydotool` sends to whatever window has keyboard focus.
  The picker dialog opens but loses focus to whatever window the user
  was last interacting with. KWin's `workspace.activeWindow = w` setter
  doesn't always raise + focus
- Workaround that DID work: Bring Chrome to front via CDP
  (`Page.bringToFront`), wait several seconds for picker to render and
  grab focus, then send keystrokes
- Unsolved: When user is actively using another window, focus shifts
  back. Robust automation would need a window-locked input target
  (xdotool's `--window` flag works on X11 but not Wayland-native dialogs)

---

## Part 7 — How to drive Chrome silently (CDP recipe)

Helper at `/tmp/cdp.py`. Flatpak Chrome must be launched with:
```bash
flatpak run com.google.Chrome \
  --user-data-dir=/tmp/chrome-coh2-prof \
  --remote-debugging-port=9222 \
  --remote-allow-origins='*' \
  http://localhost:45089/coh2-skin-editor/
```

Once running:
- `python3 /tmp/cdp.py shot /tmp/page.jpg` — screenshot the page (Chrome
  DevTools Protocol; works regardless of window state)
- `python3 /tmp/cdp.py eval '<expr>'` — eval JS in page context
- `python3 /tmp/cdp.py click '<selector>'` — click an element by CSS selector
- `python3 /tmp/cdp.py type '<text>'` — type text via Input.insertText
- `python3 /tmp/cdp.py enter` — press Enter

CDP works regardless of window visibility/focus. The only operation that
needs real focus is the native file picker (`showDirectoryPicker`); after
the user has connected once, the handle is persisted in IndexedDB and
subsequent loads skip the picker.

To bring Chrome to the foreground via CDP:
```python
import json, websocket, urllib.request
d = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json/list").read())
tab = next(t for t in d if 'coh2-skin-editor' in t.get('url',''))
ws = websocket.create_connection(tab['webSocketDebuggerUrl'])
ws.send(json.dumps({"id":1, "method":"Page.bringToFront"}))
```

Screenshot the OS desktop (not just the page) via:
```bash
spectacle -f -b -n -o /tmp/screen.png
```
(KDE Spectacle, works under Wayland. `grim` does NOT work on this
compositor.)

---

## Part 8 — File-reading priority for the next session

1. `src/lib/sga.ts` — outer archive reader (small, well-commented)
2. `src/lib/chunky.ts` — Relic chunk container (tiny)
3. `src/lib/rgt.ts` — texture format wrapper
4. `src/lib/bc-decode.ts` + `src/lib/bc-encode.ts` — DXT codec
5. `src/lib/rgm.ts` — mesh format (longest, contains coord-system fixes)
6. `src/lib/decal-painter.ts` — Canvas2D draw routines
7. `src/components/Viewport.tsx` — scene setup, model loading, raycast
8. `src/components/Editor.tsx` — orchestrator: project state, repaint
   loop, passes overlay canvas to Viewport
9. `src/lib/mod-export.ts` + `src/lib/sga-writer.ts` + `src/lib/rgt-writer.ts`
   — write-side
10. `tools/test-export.ts` — Node test harness; reproduces export pipeline
    outside the browser

---

## Part 9 — Recommended next steps

**1. Implement chunked storage decoder in `src/lib/sga.ts readFile()`**
   This unblocks Tiger I and any other vehicle whose RGM uses storage=1.
   Decompiling `RelicCore.dll` `Archive.readFile` gives the exact format.
   Once done, the editor is fully usable for design.

**2. Crack the Sig hash via Ghidra**
   Project already imported. Find the function at VMA `0x140940b07` and
   decompile it. The `%llu` argument's source is the algorithm we need
   to replicate in `src/lib/sga-writer.ts`. Once we can produce a Sig
   the engine accepts (probably `Sig:0` for unsigned content), exported
   skins will load.

**3. End-to-end test**
   Once both blockers are closed: build → install → restart CoH2 →
   verify skin loads in skirmish (German faction). Bisect script at
   `/tmp/coh2_loop.sh` can automate launch+kill cycles.

---

## Part 10 — User UX preferences (for any UI tweaks)

- Apple HIG over generic web modals
- No modal-on-modal stacking; sheet-in-place expansion preferred
- BorderBeam should match `beam.jakubantalik.com` exactly (three layers:
  rotating bright stroke, soft halo, conic-mask comet tail)
- Glass design — no orange anywhere except brand accents
- Cool-silver / cyan-blue palette over purple
- Press-down + spring-bounce on every interactive button
- ASAP Australia logo with Australian-blue halo as brand mark
- Loading affordances on the BUTTON, not in surrounding UI
- Width-stable pills (no shape change on state swap) — locked to 80 px
- Single primary action per surface

Pass this entire document to the next session along with:
> "Continue from blocker A (chunked storage decoder in src/lib/sga.ts),
> then blocker B (Sig RE via Ghidra). Project is at
> /home/jflessenkemper/dev/coh2-skin-editor. Bind mount is at /tmp/coh2."
