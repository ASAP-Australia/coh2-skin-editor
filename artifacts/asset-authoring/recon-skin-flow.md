# Recon — Vehicle Skin / Texture Authoring Flow (read-only)

Repo: `/var/home/jflessenkemper/dev/coh2-skin-editor`
Scope: how a user authors a vehicle SKIN (diffuse texture) end-to-end, the libs behind it, required I/O, and friction. All claims cite `file:line`.

---

## 0. TL;DR pipeline map

```
 pick vehicle (VehicleMenu)                         Editor.tsx:2233
        │
        ▼
 vanilla diffuse loaded → baseDiffuseRef (2048² canvas)   Editor.tsx:495, :1175
        │
   ┌────┴───────────────┬────────────────────────┐
   ▼                    ▼                         ▼
 A) PAINT             B) GENERATE camo          C) UPLOAD/PASTE image
 "Edit texture" pill  text prompt → procedural  drop PNG → drawn as diffuse
 EditTextureButton    parsePrompt+generateCamo   onApplyCamoImage
 → VehicleTextureEditor  TopBar:1490 / camo-generator.ts   TopBar:1517 / Editor.tsx:1065
   VehicleTextureEditor.tsx:251 (brush)
        │                    │                         │
        └────────────────────┴─────────────────────────┘
        ▼
 baseDiffuseRef mutated → composite into overlayCanvas → GPU upload (live 3D)
        │                                    Editor.tsx:1353 (per-dab), :1387 (stroke end)
        ▼
 persist to project.vehicles[id].customDiffuseUrl  (PNG dataURL)  Editor.tsx:1325-1342
        │
        ▼
 scheduleLiveSync('skin', project)  (debounced 1500 ms)   Editor.tsx:1277
        │
        ▼
 AUTOMATIC export → SGA written to  My Games/CoH2/mods/skins/<numericId>.sga
   live-sync.ts:740 → exportSkinPack()/patchExport()  mod-export.ts:587 / :485
        │
        ▼  (per vehicle, inside export)
 effectiveCustomDiffuseUrl → draw onto 2048² canvas → canvasToRgt() → RGT bytes → buildSga()
   mod-export.ts:227-269, :649 ; rgt-writer.ts:65 ; sga-writer.ts
```

There is **no explicit "Export SGA" click** in the normal flow: Live Sync is permanently on and writes the `.sga` automatically after every edit (`Editor.tsx:1274` comment "Live Sync is permanently on").

---

## 1. How the user imports / edits / paints a vehicle texture

Three authoring paths, all mutating the same `baseDiffuseRef` 2048² canvas and persisting to `customDiffuseUrl`:

### A) Paint directly (brush) — primary "edit the texture" path
- Entry point: bottom-row **"Edit texture"** glass pill (`EditTextureButton.tsx`), wired in `Editor.tsx:2227-2231`; click sets `textureEditorOpen=true`.
- Opens the full-screen **`VehicleTextureEditor`** (`Editor.tsx:2283-2303`, component `VehicleTextureEditor.tsx`). It shows the live composited 2048² atlas (`overlayCanvas`) scaled into a 1024² on-screen canvas (`VehicleTextureEditor.tsx:82-85, :205-213`).
- Tools (`VehicleTextureEditor.tsx:90-96`): **Draw**, **Erase**, **Pick** (one-shot eyedropper), plus toggles **Unwrap** (UV wireframe overlay) and **Mirror** (symmetric brush). Options: size / softness / opacity / colour + 12 swatches (`VehicleTextureEditor.tsx:687-756`).
- Painting writes onto the editor-owned `baseDiffuse` canvas via shared brush helpers `paintBrushDab` / `paintBrushSegment` (`VehicleTextureEditor.tsx:274, :291`, from `lib/brush.ts`). Erase restores pixels from the pristine `vanilla` canvas.
- Users can ALSO paint on the 3D model in-place (without the full-screen editor): `brushOn` mode + `addDecal()`/brush path in `Editor.tsx:1453-1459`.

### B) Generate procedural camo from a text prompt
- The camo/"Generate" panel lives in `TopBar.tsx`; button **"Apply to skin"** at `TopBar.tsx:1490-1497` calls `parsePrompt(camoPrompt)` then `onApplyCamo(preset, scope)`.
- `parsePrompt` maps free text like `"german ambush winter"` to a `CamoPreset` (`camo-generator.ts:149`, styles: `softBlobs | hardEdge | whitewash | stripes`, `camo-generator.ts:23`). `generateCamo` renders procedural blobs/stripes/whitewash + weathering onto the diffuse (`camo-generator.ts:244`).
- Applied in `Editor.tsx:applyCamo` (`Editor.tsx:1019`); persists `camoPreset` on the vehicle or faction default. Scope can be `'vehicle' | 'faction' | 'all'` (`Editor.tsx:933-937`).

### C) Upload / paste an image as the diffuse
- "Paste or upload camo image" dropzone in `TopBar.tsx:1517`; hidden `<input type="file" accept="image/*">` at `TopBar.tsx:1519-1531`. Accepts Ctrl+V paste, drag-drop, click-to-upload.
- Decoded image → `onApplyCamoImage(img, scope)` → `Editor.tsx:applyCamoImage` (`Editor.tsx:1065`), which draws it onto `baseDiffuseRef` and persists it as `customDiffuseUrl` (`Editor.tsx:1123-1137`).

### Team colour / channels
- There is **no per-channel (_dif/_nrm/_gls/_spc) editing UI** and no team-colour picker in the skin flow. The user only ever edits the **diffuse** (RGB); normal/gloss/spec maps are untouched. Team colour is an engine/mesh concern (badge atlas via TEXCOORD1) not exposed here. So: the user uploads/paints a diffuse only — not a multi-channel asset.

Persistence: after each brush stroke, `persistBrushStroke()` snapshots `baseDiffuse.toDataURL('image/png')` into `project.vehicles[id].customDiffuseUrl` and clears `camoPreset` (`Editor.tsx:1325-1342`). "Clear" wipes back to vanilla and nulls `customDiffuseUrl` (`Editor.tsx:1418-1432`). Data model: `Coh2SkinProject.vehicles[id].customDiffuseUrl` + `factionDefaults[f].customDiffuseUrl` (`project.ts:87, :97`); resolved by `effectiveCustomDiffuseUrl` (`project.ts:505-513`, per-vehicle overrides faction default).

---

## 2. Exact steps: pick vehicle → edit skin → export SGA

1. **Pick a vehicle** — click a pill in the bottom `VehicleMenu` (`Editor.tsx:2233-2241`). Loads the vehicle's vanilla diffuse into `baseDiffuseRef`/`vanillaDiffuseRef` (`Editor.tsx:495`, base render `Editor.tsx:1175`).
2. **Enter edit mode** — click **"Edit texture"** pill (`Editor.tsx:2227`) → full-screen `VehicleTextureEditor` opens. (Or use Generate/Upload panels in the TopBar without opening it.)
3. **Author the texture** — paint (A), generate camo (B), or upload/paste (C). Live composite updates the 3D model behind the editor on every dab (`onDabComposite`, `Editor.tsx:1353`).
4. **Stroke ends** → `onVteStrokeEnd` (`Editor.tsx:1387`) runs full composite + `persistBrushStroke()` → writes `customDiffuseUrl`.
5. **Automatic export** — the project-change effect fires `scheduleLiveSync('skin', project)` (`Editor.tsx:1272-1277`), debounced 1500 ms. This is the export: no manual button.
6. **Export builds the SGA** — `live-sync.ts:740` imports and calls `patchExport` (if signing keys present) else `exportSkinPack` (`live-sync.ts:744-767`; `mod-export.ts:485` / `:587`). For each vehicle in `collectExportVehicleIds` (`mod-export.ts:168`): resolve diffuse → composite to 2048² canvas + paint decals (`composeVehicleDiffuse`, `mod-export.ts:203-292`) → `canvasToRgt()` → RGT bytes → `buildSga()` (`mod-export.ts:649, :706`). Writes to summer + winter slots (`mod-export.ts:653-656`).
7. **Written to disk** — `.sga` written to `…/My Games/Company of Heroes 2/mods/skins/<numericId>.sga` (`live-sync.ts:389, :856-891`; filename must be `%I64u.sga`, a u64 decimal — `mod-export.ts:66-85`). User then selects the skin in-game.

(A manual/downloadable path also exists: the **Download** button in `VehicleTextureEditor.tsx:571-584` exports the composited atlas as a plain `<vehicle>.png` — for external editing, NOT an SGA.)

---

## 3. Underlying lib functions

| Concern | Function / file:line |
|---|---|
| Brush painting | `paintBrushDab`, `paintBrushSegment`, `samplePixel` — `lib/brush.ts` (used `VehicleTextureEditor.tsx:56-60, :274, :291`) |
| Procedural camo | `parsePrompt`, `generateCamo`, `CamoPreset` — `camo-generator.ts:149, :244, :25` |
| Effective diffuse resolution | `effectiveCustomDiffuseUrl` — `project.ts:505` |
| Per-vehicle diffuse compose (export) | `composeVehicleDiffuse` — `mod-export.ts:203-292` |
| Vanilla RGT decode | `decodeRgt` (`rgt.ts`), `bcToCanvas` (`bc-decode.ts`) — `mod-export.ts:267-268` |
| **RGT encode (canvas→RGT)** | `canvasToRgt(canvas, internalName, opts)` — `rgt-writer.ts:65`. Emits Chunky v3 TSET/TXTR/DXTC (TFMT/TMAN/TDAT) + optional FBIF. Encodes via `encodeBc1`/`encodeBc3` (`bc-encode.ts`). Default BC1/DXT1 (code 13); BC3/DXT5 (code 15) for the signed-patch path (`rgt-writer.ts:84-117`) |
| **SGA writer** | `buildSga({archiveName, files})` — `sga-writer.ts` (SGA v7), called `mod-export.ts:706` |
| High-level export | `exportSkinPack`, `patchExport`, `collectExportVehicleIds`, `outputBasename`, `textureBaseNamesFor`, `factionSgaCandidates` — `mod-export.ts:587, :485, :168, :401, :113, :88` |
| Auto-deploy | `scheduleLiveSync` / `LiveSyncManager` — `live-sync.ts:1534, :740-891` |
| Decal compositing | `paintDecals`, `preloadDecalImages` — `decal-painter.ts` (used `mod-export.ts:284-285`) |

### Channel / format handling notes
- Only the **diffuse** channel is authored. `canvasToRgt` reads canvas RGBA and encodes one top mip; smaller mips are zeroed (`rgt-writer.ts:6-8, :91-107`).
- Skin diffuse export defaults to **BC1** in `exportSkinPack` (`rgt-writer.ts:71` default `'bc1'`); the **signed patch** path forces **BC3** with `compress:false, fbif:false` to match pre-signed 4,194,736-byte slots (`mod-export.ts:554`, `rgt-writer.ts:39-61`).
- RGT internal TSET name is the backslash path `art\armies\<faction>\vehicles\<folder>\<base>_dif` (`mod-export.ts:291`); on-disk SGA path uses `_dif.rgt` under `skins/<guid>_<season>/` (`mod-export.ts:654`).

---

## 4. Required inputs + output format

**Inputs**
- A located CoH2 install handle (`FileSystemDirectoryHandle`) to read vanilla diffuse RGTs + write the mods folder (`mod-export.ts:33, :519-521`; `locateArchives`).
- A selected vehicle (from `VehicleMenu`).
- At least one authored change: decals, a `customDiffuseUrl` (paint/upload), or a `camoPreset`/faction-default — else export throws "no vehicles with decals or a chosen template" (`mod-export.ts:529-531, :624-626`).
- Bundled template scaffolding shipped in `public/template/` (`.info`, `.rgd`, `english.ucs`, `.gfx`, `_i1.dds`) — `mod-export.ts:46-57, :306-338`.
- (Signed path only) `public/keys/manifest.json` + `template_0001.sga` (`mod-export.ts:444-476, :495`).

**Output**
- One `.sga` (SGA v7) named `<numericId>.sga` (u64 decimal), dropped in `…/My Games/Company of Heroes 2/mods/skins/`. Contains per-vehicle `_dif.rgt` (BC1 or BC3, 2048²) for summer + winter, the renamed `.info`/`.rgd`/`.ucs`/`.gfx`/`_i1.dds`, all GUID-rewritten per export (`mod-export.ts:659-707`).
- Optional side output: `<vehicle>.png` (composited atlas) via the editor Download button (`VehicleTextureEditor.tsx:240-249`).

---

## 5. Friction / complexity

**Low-friction / hidden-jargon wins**
- **No manual "export SGA" step** — Live Sync auto-builds and writes the `.sga` after every edit (`Editor.tsx:1274`). The user never sees SGA/RGT/GUID/numeric-id machinery.
- **No BC/DXT/mip/FBIF/Chunky exposure** — all format handling is internal to `canvasToRgt`/`sga-writer`.
- Three approachable authoring on-ramps: **paint**, **text-prompt "Generate"**, **drag-drop/paste an image**. The upload path is effectively a simple "replace texture" flow (drop a PNG → it becomes the diffuse) — `TopBar.tsx:1517`.
- Team colours, decals, and camo are separate simple concepts, not raw channels.

**Residual friction / exposed complexity**
- **Some engine jargon leaks into the paint UI**: the **"Unwrap"** UV-wireframe toggle (`VehicleTextureEditor.tsx:637-644`) and "atlas"/UV framing assume the user understands UV layout to paint accurately; painting blind on a 2048² atlas without the unwrap is hard for novices.
- **No channel/normal/gloss/spec editing at all** — a user wanting real PBR control (matte vs glossy, bump) cannot do it here; only the diffuse is editable. This is a capability gap more than exposed jargon.
- **No team-colour preview/edit in the skin flow** — team colour is baked by the engine via the badge atlas (TEXCOORD1); the editor can't recolour it, which can surprise users.
- **Upload replaces the whole 2048² atlas** with no per-region masking in the upload path (masking exists only for procedural camo via `maskedMode`, `camo-generator.ts:257`), so an arbitrary uploaded image is stretched across the full atlas (`Editor.tsx` applyCamoImage draws it 0,0→2048,2048) and won't line up with UV islands unless pre-authored.
- Install-handle / mods-path detection and the summer/winter dual-slot concept are hidden but are prerequisites; if the install isn't located, export throws (`mod-export.ts:521, :630`).

**Verdict:** There IS a simple "replace texture" path (drop/paste a PNG, or type a prompt and hit "Apply to skin") and the SGA is produced automatically — the complex SGA/RGT/BC pipeline is fully hidden. The main remaining friction is (a) painting accurately needs the UV "Unwrap" overlay, and (b) no multi-channel / team-colour control.

---

## Minimal click-path to a custom vehicle texture
Pick a vehicle in the bottom `VehicleMenu` → click **"Edit texture"** (or use the TopBar Generate panel) → paint / hit **"Apply to skin"** on a prompt / drop-paste a PNG → **done**: Live Sync auto-writes `mods/skins/<id>.sga`; select the skin in-game.
Absolute minimum: **VehicleMenu pill → "Edit texture" pill → one brush stroke** (auto-exports; no save/export click).
