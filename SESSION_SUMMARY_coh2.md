# CoH2 Skin Editor — Session Summary

_Last updated: 2026-05-06. Written by Claude to hand off cleanly between sessions._

---

## What the project is

A desktop (Electron) + web app for building Company of Heroes 2 skin packs.
The user paints decals (tactical numbers, shields, kill marks, custom images, names)
onto a 3D viewport that renders actual CoH2 vehicle models with their game textures,
then exports everything as a valid `.sga` archive that the game loads.

**Live web version:** GitHub Pages (`/coh2-skin-editor/`)
**Desktop version:** Electron, frameless window, auto-detects CoH2 install
**Stack:** Vite + React + TypeScript + Three.js + Tailwind v4

---

## Repo layout

```
/home/jflessenkemper/dev/coh2-skin-editor/
  electron/
    main.ts          ← Electron main process (BrowserWindow, IPC, FS, CoH2 detect)
    preload.ts       ← contextBridge: exposes window.electronAPI to renderer
  src/
    App.tsx          ← Root: detect Electron, auto-detect CoH2, ConnectScreen or Editor
    components/
      Viewport.tsx   ← Three.js 3D viewport (model load, texture, lighting, decal overlay)
      Editor.tsx     ← Main editing shell (decal state, overlay canvas, project save)
      FactionNav.tsx ← Bottom glass nav (faction tabs + vehicle pills)
      TitleBar.tsx   ← Frameless window chrome (min/max/close, Electron only)
      TopMenu.tsx    ← Top-left hamburger menus (view, decals, export, camo, scene, parts)
      ConnectScreen.tsx ← First-run: pick/confirm CoH2 install folder
    lib/
      rgm.ts         ← CoH2 .rgm mesh parser (MRGM v8 + TRIM v5 paths)
      rgt.ts         ← CoH2 .rgt texture parser (DXT/BC decode)
      sga.ts         ← SGA v7 archive reader (lazy TOC, readByPath)
      sga-writer.ts  ← SGA v7 archive writer (for skin export)
      native-fs.ts   ← Electron IPC duck-typed FileSystem handles
      coh2-fs.ts     ← Browser File System Access API helpers
      vehicles.ts    ← Vehicle manifest (VEHICLES array, FACTIONS, rgmPath())
      decal-painter.ts ← 2D canvas compositing (numbers, shields, names, kills, images)
      bc-decode.ts   ← BC1/BC3/BC7 software decoder → HTMLCanvasElement
      bc-encode.ts   ← BC1/BC3 encoder (for export)
      camo-generator.ts ← Procedural camo patterns
      chunky.ts      ← Relic Chunky binary format parser (used by rgm.ts + rgt.ts)
      mod-export.ts  ← CoH2 skin pack exporter (SGA + lua + attrib)
      project.ts     ← Project data model, localStorage persistence
      skybox.ts      ← (currently disabled — was causing washout)
  index.css          ← Tailwind + glassmorphism design tokens
  vite.config.ts     ← base: '/coh2-skin-editor/', target: chrome120
  tsconfig.electron.json ← CommonJS compile target for electron/
  package.json       ← scripts, electron-builder config
```

---

## Every file we've touched — current state

### `electron/main.ts`
Complete. BrowserWindow, all IPC handlers, CoH2 auto-detect.

**Auto-detect paths (Linux):**
- `~/.steam/steam/steamapps/common/Company of Heroes 2`
- `~/.local/share/Steam/steamapps/common/Company of Heroes 2`
- `~/snap/steam/common/.local/share/Steam/steamapps/common/Company of Heroes 2`
- `/run/media` (Steam Deck SD)
- flatpak: `$XDG_DATA_HOME/flatpak/app/com.valvesoftware.Steam/.../Steam`

**Auto-detect paths (Windows):**
- Registry: `HKLM\SOFTWARE\Wow6432Node\Valve\Steam → InstallPath`
- Registry fallback: `HKCU\SOFTWARE\Valve\Steam → SteamPath`
- Hardcoded: `C:\Program Files (x86)\Steam`, `C:\Program Files\Steam`, `D:\Steam`, `E:\Steam`

**IPC channels exposed:**
- `detect-coh2` → string | null
- `pick-directory` → string | null (native dialog)
- `read-file` → ArrayBuffer (full file)
- `read-file-range` → ArrayBuffer (byte range, used for lazy SGA TOC)
- `file-stat` → { size } | null
- `list-dir` → { name, isDirectory }[]
- `file-exists` → boolean
- `window-minimize`, `window-maximize`, `window-close`, `window-is-maximized`

Also supports `HEADLESS_SCREENSHOT=/path/to/out.png` env var for CI screenshots.

---

### `electron/preload.ts`
Complete. Exposes all IPC calls as `window.electronAPI`.

---

### `src/lib/native-fs.ts`
Complete. Duck-typed `FileSystemDirectoryHandle` backed by IPC.
Key: `nativePathToHandle(path)` returns an object that satisfies the FS Access API interface.
Uses lazy range reads (`makeBlob → readFileRange`) so 300 MB SGA files don't get transferred
over IPC in one shot.

---

### `src/lib/rgm.ts`
Complete (for supported vehicles). No debug code left.

**Key constants/values:**
- MRGM v8: `FOLD/MRGM + DATA/DATA version=8` — most vehicles (Brummbär, Sturmtiger, T-34, etc.)
- TRIM v5: `FOLD/TRIM + DATA/DATA version=5` — Tiger I, Churchill, M5 Stuart (parsed but may produce empty meshes)
- DXGI format codes: `2=R8G8B8A8 (4B)`, `3=R32G32_FLOAT (8B)`, `4=R32G32B32_FLOAT (12B)`, `5=R32G32B32A32_FLOAT (16B)`, `13=R8G8B8A8_UINT (4B)`
- Semantics: `POSITION=0, BLENDINDICES=1, BLENDWEIGHT=2, NORMAL=3, BINORMAL=4, TANGENT=5, COLOR=6, TEXCOORD0=8`

**Coordinate system fixes (ALL THREE REQUIRED — do not remove any):**
1. Negate Z on positions: `positions[v*3+2] = -view.getFloat32(o+8, true)`
2. Negate Z on normals (both float and SNORM8 paths)
3. Flip triangle winding: swap index[i+1] ↔ index[i+2] for every triangle
4. Flip V at parse time: `uvs[v*2+1] = 1 - view.getFloat32(o+4, true)` (float32 UVs)
5. Flip V at parse time: `uvs[v*2+1] = 1 - halfToFloat(view.getUint16(o+2, true))` (half-float UVs)

**SNORM8 normals (format=2):**
```typescript
const snorm = (b: number) => (b > 127 ? b - 256 : b) / 127.0
```
NOT `(byte / 127.5) - 1` — that formula is wrong.

**Degenerate normal fallback:**
If >5% of normals have length² < 0.01, throw out encoded normals and call `geo.computeVertexNormals()`.
This must happen AFTER `geo.setIndex()`.

---

### `src/components/Viewport.tsx`
Complete. No debug code left (`window.__lastModel` removed).

**Renderer settings:**
```typescript
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.6   // bumped 1.2→1.6 for Electron dark rendering
```

**Lighting (studio 3-point, NO env map / PMREM):**
```typescript
// Hemisphere — cool sky / dim warm ground
new THREE.HemisphereLight(0xa0b0c8, 0x303030, 0.85)

// Key: warm front-right
const sun = new THREE.DirectionalLight(0xfff1d6, 1.45)
sun.position.set(5, 8, 5)

// Fill: cool front-left
const fill = new THREE.DirectionalLight(0x90a8c8, 0.65)
fill.position.set(-6, 4, -3)

// Rim: cool back
const rim = new THREE.DirectionalLight(0xb0c4d8, 0.75)
rim.position.set(-2, 2, -8)
```

**Winter season overrides:**
```typescript
sun.color.setHex(0xd8e8ff); sun.intensity = 1.20
fill.color.setHex(0xb0c8ff); fill.intensity = 0.75
groundMat.color.setHex(0x9aabb8)
scene.background = new THREE.Color(0x0d1016)
```

**Texture UV convention (canonical — do not change):**
- V flipped at parse time in rgm.ts (`v = 1 - v`)
- `flipY = true` on all CanvasTextures
- These two together make the unwrap correct. Removing either breaks textures.

**Per-submesh texture binding:**
Each material's token determines which textureSet to use:
- `tokenFor(matName)` → `'wreck'` if name contains `wreck`, `'tread'` if contains `tread|track`, `''` for body
- Body: pick `_dif` tset NOT containing `_wreck_|_tread_|_track_|/badges/`
- Tread: pick tset containing `_tread_` + ending `_dif`
- Wreck: pick tset containing `_wreck_` + ending `_dif`
- Cache key: `materialName ?? '__body__'`
- `(mat as any).__usesBodyDiffuse = isBodyMaterial(sub.materialName)` — only body submeshes get the decal overlay rebound

**Material settings:**
```typescript
new THREE.MeshStandardMaterial({
  map: subDiffuse,
  normalMap: subNormal,
  color: subDiffuse ? 0xffffff : 0x9aa18b,  // fallback grey-green
  metalness: 0.05, roughness: 0.85,
  side: THREE.DoubleSide,  // fixes inverted-winding black panels
})
if (subNormal) mat.normalScale = new THREE.Vector2(1.0, 1.0)
```

**SGA search order** (for both RGM and textures):
```
ArtHigh.sga, ArtHighXP1.sga, ArtHighXP2.sga,
ArtArmies.sga,
ArtGermanEF.sga, ArtSovietEF.sga,
ArtAEF.sga, ArtAEFSkins.sga,
ArtBritish.sga, ArtWestGerman.sga
```

**Vehicle aliases** (for texture path fallbacks — hardcoded in Viewport.tsx):
```typescript
elefant: ['elefant_hull', 'elefant'],
sturmtiger: ['sturmtiger', 'sturmpanzer'],
tiger: ['tiger', 'tiger_i', 'pzkpfw_vi_tiger'],
brummbar: ['brummbar', 'sturmpanzer_iv'],
panther_ausf_g: ['panther', 'panther_ausf_g'],
jagdtiger: ['jagdtiger'],
// ... etc, see full list in Viewport.tsx ~lines 357-380
```

**Archive cache:** `archiveCache: Map<string, SgaArchive>` prevents re-parsing 300 MB SGAs for each texture path.

**Overlay rebind after model load:**
`setModelTick(t => t + 1)` triggers a separate `useEffect` that traverses the mesh group
and rebinds `overlayTexRef.current` to all submeshes where `__usesBodyDiffuse === true`.

---

### `src/components/FactionNav.tsx`
Complete. Two floating glass pills, both centered (`absolute left-1/2 -translate-x-1/2`).

**Vehicles pill:** `bottom: 76` (px, inline style), `rounded-2xl`, max-w `min(92vw, 960px)`
**Faction pill:** `bottom-3` (Tailwind), `rounded-pill` (9999px)

**Glass style (applied to both pills):**
```css
background: rgba(20, 22, 28, 0.62)
backdropFilter: blur(28px) saturate(180%)
border: 0.5px solid rgba(255,255,255,0.10)
boxShadow: 0 12px 32px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)
```

**Active button style:**
```css
bg-white/95 text-black
shadow: inset 0 0.5px 0 rgb(255 255 255/0.8), 0 2px 8px rgba(0,0,0,0.25)
```

Dirty indicator: `w-1.5 h-1.5` orange dot `bg-orange-400` with glow `shadow-[0_0_4px_#fb923c]`.

---

### `src/components/TitleBar.tsx`
Complete. Electron-only (returns null if `!isElectron()`).

Layout: thin 8px drag strip at very top (`z-[9998]`), glass pill at `top-2.5 right-3` (`z-[9999]`).
Three buttons: Minimize (–), Maximize/Restore (□/⧉), Close (×).
Close button: red hover `hover:bg-red-500/85`.
Double-click on strip: maximize/restore.

**Glass style:**
```css
background: rgba(20, 22, 28, 0.78)
backdropFilter: blur(20px) saturate(140%)
border: 0.5px solid rgba(255,255,255,0.08)
```

---

### `src/components/Editor.tsx`
Complete.

- Root div: `h-dvh w-full relative overflow-hidden` (fills viewport exactly)
- `PackIconCard` removed (was "My Skin Pack" indicator)
- Intact/Wrecked toggle JSX removed; `const [showDestroyed] = useState(false)` — no setter
- Chrome fade wrapper: `transition-opacity duration-300`, 4s idle timer, F/H key toggle

---

### `src/components/TopMenu.tsx`
Class `top-menu-wrap` applied to wrapper. Position overridden by CSS for Electron.

---

### `src/index.css`
Glassmorphism design tokens in `@theme {}`. Three glass utilities: `glass-1`, `glass-2`, `glass-3`.

**Electron top-menu alignment:**
```css
body.is-electron .top-menu-wrap { top: 0.625rem; left: 0.625rem; }
```
This aligns the menu vertically with the TitleBar close buttons (which are at `top-2.5 = 0.625rem`).

**Removed rules** (were causing layout issues):
- `body.is-electron .pack-icon-card { ... }` — gone, card itself removed
- `body.is-electron .intact-wrecked-toggle { ... }` — gone, toggle removed

---

## What's working

- **Electron desktop app** — frameless window, glass TitleBar, auto-detects CoH2 install
- **Model loading** — MRGM v8 vehicles render correctly (Brummbär, Sturmtiger, T-34, Panther, Jagdtiger, Puma, etc.)
- **Per-submesh textures** — tracks get `_tread_dif.rgt` (tiling), hull gets body atlas
- **Decal overlay** — only body submeshes get the editable overlay canvas; tracks/wrecks keep their own textures
- **Lighting** — 3-point studio, ACES tonemapping, correct for Electron's darker Chromium
- **Season toggle** — summer/winter lighting switch works
- **UV unwrap** — canonical V-flip at parse + flipY=true on CanvasTexture
- **CoH2 texture loading** — searches 10 SGAs, uses archive cache, tset + fallback paths
- **Bottom nav** — two centered glass pills, faction tabs + vehicle pills above
- **Project save** — localStorage, `.coh2skin` file import/export
- **Skin export** — SGA writer + mod files (modulo RSA sig blocker below)

---

## What's broken / incomplete

### 1. RSA signature on SGA export (HARD BLOCKER for in-game loading)
CoH2 refuses to load unsigned SGAs. The game validates a 256-byte RSA-1024 signature block
in the SGA header. We need to either:
- Sign with the Relic public key (requires private key we don't have), OR
- Patch the game binary to skip signature validation

**Ghidra work done:** Project at `/tmp/ghidra-proj/`. The signature check function is at
VMA `0x140940b07`. Has not been fully reversed yet.

This means: the editor works perfectly for previewing skins, but the actual SGA export
cannot be loaded by the game.

### 2. TRIM v5 vehicles render empty viewport
Tiger I, Churchill, M5 Stuart use TRIM v5 mesh format. The parser reads them without
crashing but produces zero visible submeshes (the stride/layout doesn't match our decoder).
The error message is user-friendly: "uses a mesh format the editor doesn't decode yet".
**Fix needed:** Properly decode TRIM v5 vertex layouts (they may use a different field order
or packed-stride variant than what we handle).

### 3. MTRL VAR chunk params always empty
The `parseMtrl()` function in rgm.ts parses MTRL chunks but `params` always comes back `[]`
for real CoH2 files. This means we can't read texture paths from material params — we work
around it by name-matching textureSets. The workaround is functional but a proper fix
would parse VAR chunks correctly and look up textures from material params directly.

### 4. `window.__lastModel` debug dump
**REMOVED this session.** Was at line 654 in Viewport.tsx. Confirmed gone.

### 5. Skybox from ArtEnvironment.sga disabled
The env switcher in TopMenu is wired up but the skybox render is disabled (`_envArchive`,
`_envName` prefixed with underscore in Viewport.tsx). Was causing visual issues.
The plain dark backdrop (`0x0a0b0e`) looks better anyway.

---

## Exact next steps (priority order)

1. **Verify per-submesh fix on more vehicles** — test Jagdtiger, Panther, Puma (all have
   tread materials). Confirm tracks show tile texture, not body atlas.

2. **TRIM v5 fix** — Tiger I, Churchill, M5 Stuart show empty viewport.
   Start by hex-dumping a TRIM v5 DATA chunk header and comparing stride vs computed stride.
   The current `parseTrimDataV5` may have field-order wrong — the `u32=5, u32=0` header
   marker might encode something else.

3. **RSA signature** — Resume Ghidra reverse at VMA `0x140940b07`. Goal: understand the
   signature check well enough to either patch it or find an alternate signing approach.

---

## Constants / values never look up again

### File paths (real CoH2 install, Linux Steam)
```
~/.local/share/Steam/steamapps/common/Company of Heroes 2/
  CoH2/Archives/
    ArtHigh.sga         ← vehicle meshes (.rgm)
    ArtGermanEF.sga     ← German faction textures (Brummbär, Tiger, Sturmtiger)
    ArtSovietEF.sga     ← Soviet textures
    ArtAEF.sga          ← US faction
    ArtAEFSkins.sga     ← US faction textures
    ArtBritish.sga      ← British
    ArtWestGerman.sga   ← OKW
    ArtArmies.sga       ← shared
    ArtHighXP1.sga      ← Western Front DLC
    ArtHighXP2.sga      ← Ardennes Assault DLC
```

### SGA archive internal paths
```
art/armies/<faction>/vehicles/<vehicle_id>/<vehicle_id>.rgm   ← mesh
art/armies/<faction>/vehicles/<vehicle_id>/<vehicle_id>_dif.rgt   ← body diffuse
art/armies/<faction>/vehicles/<vehicle_id>/<vehicle_id>_nrm.rgt   ← normal map
art/armies/<faction>/vehicles/<vehicle_id>/<vehicle_id>_tread_dif.rgt ← track tile
```

### Faction IDs (in vehicles.ts)
`german`, `soviet`, `american`, `british`, `westgerman`

### Three.js color space rules
- Diffuse textures: `colorSpace = THREE.SRGBColorSpace`
- Normal maps: `colorSpace = THREE.NoColorSpace` (linear)
- Both get: `flipY = true`, `wrapS = wrapT = THREE.RepeatWrapping`, `anisotropy = 4`

### Electron dev / build commands
```bash
npm run electron:dev        # vite dev server + electron (concurrently)
npm run electron:build      # vite build + tsc electron + electron-builder (Linux AppImage)
npm run electron:build:win  # cross-compile for Windows (NSIS installer)
```

### Electron AppImage location (after build)
```
dist-electron/CoH2 Skin Editor-*.AppImage   (Linux)
```

### CDP debugging (Electron without DevTools)
```bash
# Launch with remote debug port:
ELECTRON_EXTRA_FLAGS="--remote-debugging-port=9229 --remote-allow-origins='*'" npm run electron:dev

# Then connect with Python websocket or Chrome at:
#   chrome://inspect → Configure → localhost:9229
```

### Design token: glassmorphism
```
background: rgba(20, 22, 28, 0.62)   ← panels / pills
background: rgba(20, 22, 28, 0.78)   ← TitleBar (darker for legibility)
backdropFilter: blur(28px) saturate(180%)
border: 0.5px solid rgba(255, 255, 255, 0.10)
boxShadow: 0 12px 32px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)
Active button: bg-white/95 text-black
```

### Body background color
`#0a0b0e` (summer), `#0d1016` (winter)

### Default export skin format
`.coh2skin` = JSON with `magic: 'coh2-skin-project'` field. Loaded by drag-drop or File menu.

---

## Gotchas to never repeat

- **Never remove the V-flip in rgm.ts AND the flipY on CanvasTexture simultaneously.**
  They are NOT redundant — they serve different purposes. Removing either breaks unwrap.
  The decal painter's coordinate system depends on this exact convention.

- **Never set `overlayTexRef.current` as the map on track/wreck submeshes.**
  Only submeshes where `(mat as any).__usesBodyDiffuse === true` should get the overlay.
  Tracks need their own tiling texture unchanged.

- **Electron renders darker than Chrome dev.** `toneMappingExposure = 1.6` is intentional
  (was 1.2 in the web version). Do not reduce it.

- **`side: THREE.DoubleSide` is intentional.** Some CoH2 submesh windings are inverted;
  without DoubleSide they render black. The performance cost is acceptable.

- **SNORM8 formula is `(b > 127 ? b - 256 : b) / 127.0`**, NOT `(b / 127.5) - 1`.
  The latter gives slightly wrong values at the extremes and causes visible shading errors.

- **Archive cache is critical.** Without `archiveCache` in Viewport.tsx, each texture
  path lookup re-opens and re-parses the full SGA TOC (300+ MB). With the cache, each SGA
  is opened once per model load.

- **`text file busy`** when copying AppImage over itself: `pkill -9 coh2` first, confirm
  with `pgrep coh2` returns nothing, then copy.
