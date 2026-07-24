# CoH2 Community Modding Tool — Asset-Authoring PLAN (Phase 2 create + Phase 3 fix)

Self-contained brief synthesized from the 9 research/recon docs in this folder. All code claims cite
`file:line` in `/var/home/jflessenkemper/dev/coh2-skin-editor`. Web claims cite URLs. An implementer
should not need to re-read the source docs.

**One load-bearing discovery drives everything below (verified this session):** in the **skin editor**,
the panels that create per-vehicle decals / camo / parts / scene are rendered by `TopBar.tsx` but
**there is no visible button that opens them.** `setActivePanel(...)` is called in exactly two places —
`Editor.tsx:1742` (auto-opens the Decals panel when you *drop an image file on the canvas*) and
`EditTextureButton.tsx` (opens the Brush panel). The "top-left … 7 menu buttons" comment at
`Editor.tsx:2096` and the `[Paint][Compose][Publish]` cluster docstring at `TopBar.tsx:1-24` are
**stale** — that nav cluster no longer renders (confirmed: zero `setActivePanel(` calls in `TopBar.tsx`).
Consequence: the recipes below must use the surviving entry points (file-drop, Edit-texture pill,
TemplateDecalPills), and fixing this nav gap is the #1 Phase-3 item.

---

## 1. HOW TO DRIVE THE EDITOR

**Recommended: run the renderer in a plain browser via the Vite dev server.** The app is explicitly
designed to run browser-only in dev, with a `/__coh2/*` bridge that auto-detects the installed CoH2 and
boots straight to the StartScreen with real vehicle data — no file picker, no Steam, no Electron
(`recon-run-editor.md`; `App.tsx:332-344`; `vite.config.ts:27-42,78-159`; `native-fs.ts:213-215,539`).

```bash
cd /var/home/jflessenkemper/dev/coh2-skin-editor && npm run dev
# then open http://localhost:5173  (drivable with the preview_* / Chrome MCP tools)
```

- **Port: 5173** (Vite default, not overridden; `electron:dev` waits on it — `package.json:20`).
- **Browser vs Electron:** use the **browser**. SKIN / DECAL / FACEPLATE authoring + the 3D Three.js
  viewport + the 2D Konva canvas + reading the real CoH2 archives all work in the browser. The CoH2
  install is present on this machine at `~/.steam/steam/steamapps/common/Company of Heroes 2` and is
  auto-detected (`vite.config.ts:30-36`). Optionally pin it: `COH2_INSTALL="/path" npm run dev`.
- **Electron-only features** (do NOT need them to *create* assets, so stay in the browser):
  Steam Workshop publish, AI camo diffusion, native window chrome, and **real on-disk writes**.
  `writeFile()` is a no-op outside Electron (`native-fs.ts:545-546`).
- **Important caveat for validating a "real" asset from the browser:** because disk writes are a no-op
  in the browser, Live Sync will *schedule* but cannot actually drop the `.sga` into the game's mods
  folder. Two options:
  - To *drive the UI and prove the flow*, use the browser and read the in-app **Download** side-outputs
    (skin: `<vehicle>.png` at `VehicleTextureEditor.tsx:577`; decal: `.coh2decalpack`/ZIP;
    faceplate: build succeeds, publish disabled).
  - To *produce a real game-loadable `.sga` on disk*, use the **headless programmatic lib path** (below)
    OR run `npm run electron:dev` (Electron writes to `…/My Games/Company of Heroes 2/mods/…`).

**Fallback — programmatic lib path (no UI, writes a real CoH2-loadable SGA):** there is a first-class
Node harness that calls the *exact same* authoring libs the browser uses, via canvas/fs shims
(`recon-run-editor.md §4`; `tools/test-export.ts:1-47`):

```bash
# full skin export pipeline → real .sga
COH2_INSTALL="/path/to/Company of Heroes 2" OUT=/tmp/pack.sga npx tsx tools/test-export.ts
```

Core lib entry points to import directly from a `tsx`/vitest script:
`buildSga` (`sga-writer.ts:177`), `buildDecalMod` (`decal-mod-build.ts:136`),
`buildFaceplateMod` (`faceplate-mod-build.ts:84`), `exportSkinPack`/`patchExport` (`mod-export.ts:587,485`),
`canvasToRgt` (`rgt-writer.ts:65`). Validation harnesses: `scripts/verify-unwrap-analytical.mts`,
`scripts/verify-faceplate.mts`, `scripts/verify-model-completeness.mts` (all pure-Node);
`scripts/verify-unwrap-visual.mts` (Electron capture). npm aliases: `npm run test-export`, `npm test`.

---

## 2. CREATE-A-DECAL (national-insignia badge pack)

**What a decal IS (design bar):** a per-faction national-insignia **badge image** — the engine decides
*where* it lands on each vehicle via the mesh **TEXCOORD1/uv2** channel; the modder supplies only *what*
the badge looks like. The shipped badge atlas is **1024×1024, BC1/DXT1** (one per faction), and only a
**~5%×5% UV cell (U∈[0.286,0.337] × V∈[0.039,0.086]** ≈ px x293,y40,w52,h48 at 1024²) actually renders on
the tank. Design a **bold, high-contrast, near-binary-alpha silhouette centered in that cell** — fine
detail / gradients / low contrast vanish at RTS scale (`research-decals.md`;
wiki `coh2-decal-pack-format.md:54,90`, `coh2-vehicle-decal-rendering.md:38-40`).

**Source image to use:** the built-in **Insignia library** already ships clean, correctly-scaled
silhouettes — use one so you don't fight the RTS-legibility bar. Concrete IDs (`insignia-library.ts`):
`balkenkreuz` (German, `:41`), `soviet-star` (`:59`), `allied-star` (`:85`), `roundel-raf` (`:93`),
`iron-cross` (`:25`) — 26 entries total. To bring your own, any PNG with a bold shape + crisp alpha works
(the wizard normalizes to a 128² source canvas).

**Minimal click/step path** (browser; `recon-decal-flow.md §2`):
1. StartScreen → **"New Decal Pack"** (`StartScreen.tsx:261` → `App.tsx:564` `newDecalPackProject()`).
2. `NewDecalPackForm` → type a **Name** (required, `NewDecalPackForm.tsx:140`) → **"Create & open"**
   (`:242`, or Cmd/Ctrl+Enter).
3. `DecalPackEditor` opens on the **Select** tool with an empty 128² Konva canvas (`:143`).
4. **Add artwork:** switch to the **Images** tool (or press `N`) and either open the **Insignia library**
   (`insigniaOpen` `:207`) and pick e.g. `balkenkreuz`, or upload/drop a PNG (`onAddImageFiles` `:482`).
   The decal auto-places centered at 80% of the canvas (`newDecal` `decal-pack-project.ts:461-471`).
5. **Position it in the badge cell:** with **Select**, drag on the canvas (snap guides `applySnap`
   `:1102`) or use the **Transform** tool inputs; arrow keys nudge. Keep the emblem centered and filling
   the cell.
6. **(v6 projects only)** assign to the correct atlas **part** via `PartStepper` (`:2266`) — the default
   `Main Hull Badge` is what you want — and leave faction on **shared** unless a faction needs unique art
   (`ATLAS_PART_DEFS` `decal-pack-project.ts:246`; fork-on-write `mutateActiveCell` `:407-432`).

**Expected export path + how to validate.**
- **In-game SGA (primary, auto):** every mutation calls `saveDecalPackToLocal` + `scheduleLiveSync`
  (`DecalPackEditor.tsx:156-159`); Live Sync builds the 15-file SGA (`buildDecalMod` `decal-mod-build.ts:136`)
  and writes it to `mods/decals/subscriptions/<guid>.sga` (`live-sync.ts:578,887,904-914`,
  `guid = deriveGuidFromId(project.id)`). **No Export button** — the tool removed it (comment
  `DecalPackEditor.tsx:1434`). In the **browser this write is a no-op** — see §1.
- **Real-SGA validation (do this):** run the headless build and confirm the 15-file layout —
  5 per-faction `attrib\vehicle_decal\<slug>_<faction>.rgd` + 5
  `art\armies\<faction>\badges\<guid>\default_dif.rgt` (BC1/DXT1 1024²) + `english\english.ucs` +
  `<guid>.info` + preview DDS + inventory DDS (64²) + GFX. `buildDecalMod` validates the icon buffer is
  exactly 64²×4 bytes (`:139`) and the guid is 32 lowercase hex (`:155`); it round-trips through
  `SgaArchive.open` before returning. The pixel-accuracy / placement check is
  `scripts/verify-unwrap-analytical.mts` (the `verify-unwrap` Skill), which confirms the badge lands in
  the TEXCOORD1 cell for all covered vehicles (in-game match was VERIFIED 2026-07-19/20,
  `artifacts/ingame-verify/decal-match-report.md`).
- **Side outputs:** `downloadDecalPack` (`decal-pack-project.ts:840`) writes a re-openable
  `.coh2decalpack` JSON (NOT game-loadable); `exportDecalPackZip` (`decal-pack-export.ts:55`) writes a
  ZIP of rasterized PNGs.

---

## 3. CREATE-A-FACEPLATE

**Real CoH2 faceplate spec** (cross-confirmed by community guides AND this repo — `research-faceplates.md`;
<https://steamcommunity.com/sharedfiles/filedetails/?id=2679894588>):

| Element | Spec | Repo value |
|---|---|---|
| Banner | **624 × 204 PNG (RGBA)** | `FACEPLATE_BANNER_W/H=624/204` (`faceplate-project.ts:37-38`) |
| Icon | **64 × 64 PNG**, center-cropped from banner **top-right (624,0)** | `ICON_RECT {624,0,64,64}` (`faceplate-templates.ts:147`) |
| Packed atlas | **692 × 204** BC3/DXT5 in DDS | `ATLAS_WIDTH/HEIGHT=692/204` (`faceplate-templates.ts:126-127`) |
| Workshop preview | **280 × 280 TGA** (guide) | editor reuses encoded **DDS** (`faceplate-mod-build.ts:149-151`) |

**Editor/spec match verdict: no hard-spec mismatch to fix.** Banner, icon rect, BC3/DXT5, 6-file SGA
layout, and the 692×204 atlas were reverse-engineered from three published workshop mods and byte-verified
against `1394135665.sga` (`recon-faceplate-flow.md`; `faceplate-templates.ts:41-68,129-147`). The old
600×170/92×92 mismatch (black borders in-game) was already migrated to 624×204 (v1→v2,
`faceplate-project.ts:26-36,905-916`). **Two soft caveats to call out, not hard blockers:**
(a) the default 64×64 icon is a *downsample of the banner's top-right*, so unless the author supplies the
v7 `inventoryIcon` override (buried in the popover icon slot, `FaceplateEditor.tsx:2852`), the scoreboard
icon is blurry; (b) the Workshop **preview** ships as DDS, whereas the community guide says 280×280 TGA —
whether CoH2's uploader accepts DDS is **UNVERIFIED** and worth a targeted test.

**Design rules that follow from the geometry:** put your focal mark in the **top-right 64×64** (that IS
the chat/scoreboard icon); design for a ~3:1 landscape strip; keep key content a few px inside the outer
edge (the gold hover frame overhangs ~11px wide / ~4px tall, `FaceplateInGamePreview.tsx:33-34`); give the
banner a mid-tone/darker field so it separates from CoH2's dark menu chrome and the overlaid white serif
title.

**Minimal click/step path** (`recon-faceplate-flow.md §2`):
1. StartScreen → **"New Faceplate"** (`StartScreen.tsx:255` → `onNewFaceplate`).
2. `NewFaceplateForm` → type a **Name** (required, `:151`) → **"Create & open"** (`:265`).
3. `FaceplateEditor` opens with a blank **624×204** canvas at true engine pixel size
   (`FaceplateEditor.tsx:873-882`). Compose: drop/paste/file-pick an image (`onImport` `:418`), add
   **Text/Shapes**, or open the **Insignia library** (`:265`). Place a bold emblem in the **top-right 64²**.
4. **Export = publish (hidden behind the title pill):** click the **centered title pill**
   (`EditorTitlePill`, `:2807`) → `PackIdentityPopover` → pick a **Visibility** in the segmented selector,
   which triggers `handleRequestBuild` (`:1266`) → `composeFaceplateCanvas` → 692×204 atlas → `getImageData`
   → `buildFaceplateMod` (`faceplate-mod-build.ts:84`). **There is no separate "Export" button and no
   on-disk export button** — publish is the only route (`downloadFaceplate` exists at
   `faceplate-project.ts:850` but is NOT wired to any button).

**Expected output + validation.** `buildFaceplateMod` produces a **6-file SGA v7**
(`attrib/faceplate/<slug>_faceplate.rgd`, `english/english.ucs`, `<guid>.info`, root `<slug>.dds`
preview [required or engine rejects the mod], `ui/assets/textures/<guid>_i1.dds` atlas [BC3/DXT5],
`ui/bin/<guid>.gfx`) — `faceplate-mod-build.ts:152-186`. It self-verifies via `assertSgaParses`
(`:219`). Real-SGA validation harness: `scripts/verify-faceplate.mts` (faceplate round-trip). Publish
requires Electron + Steam running (`isElectron()` guard `PublishSection.tsx:241`); in the browser the
build succeeds but publish is disabled — validate via the harness or Electron.

---

## 4. CREATE-A-SKIN (one real vehicle diffuse texture)

**What a skin IS:** the whole hull **diffuse** atlas, **2048×2048**, exported as `_dif.rgt` (BC1/DXT1 by
default; BC3/DXT5 on the signed-patch path) per summer/winter slot (`research-skins.md`;
`recon-skin-flow.md`; `rgt-writer.ts:5-9,71`; `texture-layer-model.ts` canvas). The editor authors the
**diffuse channel ONLY** — no `_nrm/_gls/_spc/_alp` UI (that's the 90% real-world case per the Skin Pack
Wizard: supply `_dif` + a black `_alp`, reuse stock maps —
<http://modding.companyofheroes.com/skin-pack-wizard>). Team colour is NOT in the diffuse; it arrives via
the decal/insignia atlas through TEXCOORD1 and is tinted at runtime (base-game skin `teamColour` is
all-zero, `Viewport.tsx:863-864`). **Design rule:** paint camo on top of the vanilla diffuse without
burying panel lines/bolts and without covering the decal/stripe zones, or the vehicle loses faction
legibility (the "goo effect" — `research-skins.md §5`). The tool's `maskedMode` composites camo over
vanilla with `source-atop` to preserve fittings (`camo-generator.ts:257-317`).

**Source image to use:** simplest is the built-in **procedural camo** (a text prompt like
`german ambush winter` → `parsePrompt`+`generateCamo`). Presets: `german_summer/_winter/_ambush`,
`soviet_summer/_winter`, `american_summer`, `desert_tan` (`camo-generator.ts:74-124`). Or drop/paste any
PNG as the full-atlas diffuse (note it stretches across the whole 2048² atlas and won't align to UV
islands unless pre-authored).

**Minimal click/step path** (`recon-skin-flow.md §2`):
1. StartScreen → **"New Skin Pack"** (`StartScreen.tsx:249`) → name → open (Editor mounts).
2. **Pick a vehicle** — click a pill in the bottom `VehicleMenu` (`Editor.tsx:2233`). Loads its vanilla
   diffuse into `baseDiffuseRef` (2048², `Editor.tsx:495,1175`). *(A concrete, well-covered vehicle:
   Tiger / King Tiger — the repo's ground-truth decal-bake vehicle.)*
3. **Author the texture**, one of three on-ramps:
   - **Paint:** click the **"Edit texture"** pill (`EditTextureButton.tsx` → opens full-screen
     `VehicleTextureEditor`) → Draw/Erase/Pick, toggle **Unwrap** (UV wireframe) to paint accurately,
     **Mirror** for symmetry (`VehicleTextureEditor.tsx:90-96`). One brush stroke is enough.
   - **Generate camo:** type a prompt and hit **"Apply to skin"** (`TopBar.tsx:1487` → `applyCamo`
     `Editor.tsx:1019`). *(Reachable today because the Camo panel body renders when active — but note the
     nav-gap fix in §5 is what makes this discoverable.)*
   - **Upload/paste:** drop/paste a PNG (`TopBar.tsx:1517` → `applyCamoImage` `Editor.tsx:1065`).
4. Each stroke persists `customDiffuseUrl` (`Editor.tsx:1325-1342`) and schedules Live Sync.

**Expected export path + validation.** **Automatic** — `scheduleLiveSync('skin', project)`
(`Editor.tsx:1272-1277`, debounced 1500 ms) runs `exportSkinPack`/`patchExport` (`mod-export.ts:587,485`):
per vehicle → `composeVehicleDiffuse` to a 2048² canvas + paint decals → `canvasToRgt` → `buildSga` →
`.sga` written to `…/My Games/Company of Heroes 2/mods/skins/<numericId>.sga` (filename must be a u64
decimal `%I64u.sga`, `mod-export.ts:66-85`). **No Export click.** Requires at least one authored change or
export throws `"no vehicles with decals or a chosen template"` (`mod-export.ts:529-531`). In the **browser**
the disk write is a no-op — validate the real `.sga` with `npm run test-export`
(`COH2_INSTALL=... OUT=/tmp/pack.sga npx tsx tools/test-export.ts`) or use Electron. Side output: the
texture editor's **Download** button writes `<vehicle>.png` (composited atlas, `VehicleTextureEditor.tsx:577`).

---

## 5. UX FIX BACKLOG (prioritized)

Scored against Nielsen's 10 heuristics + progressive-disclosure/tooltip/engine-jargon anti-patterns
(`research-ux-heuristics.md`). Ranked by impact ÷ effort. Effort S/M/L; impact High/Med/Low.

### Quick wins (labels / tooltips / defaults / hide jargon)

| # | Problem | file:line | Fix | Effort | Impact |
|---|---|---|---|---|---|
| Q1 | **Skin-editor panels have no way to open them.** No visible control calls `setActivePanel`; Decals/Camo/Parts/Scene/Reference are only reachable by dropping a file (→decals) or the Edit-texture pill (→brush). Stale "7 menu buttons" comment. | `Editor.tsx:2096` (stale), `TopBar.tsx:331-353`; only `setActivePanel(` callers: `Editor.tsx:1742`, `EditTextureButton.tsx` | Add a small labeled vertical nav rail (Decals / Camo / Parts / Scene) that calls `setActivePanel`. Restores discoverability of core features. *(Borderline refactor but high-value; keep the button strip itself trivial.)* | S–M | **High** |
| Q2 | **Home button is icon-only with no confirmed label**, used by all 3 editors — user can't tell it exits the pack. | `TopBar.tsx:316`; `EditorHomeButton.tsx` (FaceplateEditor.tsx:2800, DecalPackEditor) | Add `title`/`aria-label="Back to start"` to `EditorHomeButton`. | S | High |
| Q3 | **Engine jargon leaks into user labels**: `.coh2skin`/`.coh2faceplate` file-ext, "atlas/UV/img2img", "LoRA/adapter/.safetensors", "sidecar/model path", "T-pose animation decoding TBD", raw `_lod0` mesh IDs, "Rewrite with Haiku (~$0.0005/call)". | Save/Load `TopBar.tsx:524,533`; Camo `TopBar.tsx:1614,1636,1653,1347-1375,1722`; Parts `TopBar.tsx:1014`; Scene `TopBar.tsx:1792` | Rename to user words ("Save project", "Style", "Advanced ▸ …"); move AI-model/cost/sidecar text behind an "Advanced" disclosure; humanize part names, drop raw mesh IDs from tooltips. | S–M | High |
| Q4 | **Decals panel shows raw `(x,y) rot° size px` coords** and references a nonexistent **"Generate Modal"** in a tooltip. | `TopBar.tsx:798,844` (raw px/deg); `:765,768,775` ("Edit via Generate Modal") | Hide raw coordinates by default (or label them "Position/Rotation/Size"); fix the dead tooltip text. | S | Med |
| Q5 | **Icon↔function mismatches ("mystery meat"):** Mask tool uses `Layers` icon; Decal-pack **Transform** uses `Sliders` (reads as adjustments); ScenePanel environment preset uses `Grid3x3` (reads as grid/snap). | `FaceplateEditor.tsx:1262`; `DecalPackEditor.tsx:1438`; `ScenePanel.tsx` (Grid3x3) | Swap to matching lucide icons (e.g. mask→`SquareDashedMousePointer`, transform→`Move`/`Frame`, scene→`Globe`/`Sun`). | S | Med |
| Q6 | **No "Export SGA to disk" affordance anywhere** — all three editors rely on invisible auto-install (skin/decal) or publish-only (faceplate). First-timers can't tell whether/where their asset was written; browser writes are silent no-ops. | decal `DecalPackEditor.tsx:1434`; skin `Editor.tsx:1274`; faceplate `downloadFaceplate` unwired `faceplate-project.ts:850` | Add a labeled **"Export to game (.sga)"** button with a success toast naming the written path; wire `downloadFaceplate`. | S–M | High |
| Q7 | **Live Sync is force-on with no opt-out** — every keystroke rebuilds+rewrites a full 15-file SGA; `enabled=false` is a documented no-op. Surprising side-effect. | `live-sync.ts:171-175,238-240,254` | Honor the disable flag (make `setEnabled(false)` actually pause), or debounce harder + surface a clear on/off toggle in the badge. | M | Med |
| Q8 | **Duplicate/redundant controls:** Season toggle appears twice in skin editor; Insignia-library opened from 3 buttons; Draw-peel Erase toggle duplicates the dedicated Eraser tool; per-decal Rotate-90 buttons overlap the Rotation slider. | Season `TopBar.tsx:1765` + `SeasonToggle.tsx`; insignia `FaceplateEditor.tsx:4262,4263`+`DecalPackEditor.tsx:2754`; erase `FaceplateEditor.tsx:4432` vs `1261` | Remove the duplicates (keep one canonical control each). | S | Med |
| Q9 | **Dead "Reference" panel** ("Coming soon…") ships as a selectable panel. | `TopBar.tsx:958,963` | Hide it until implemented. | S | Low |
| Q10 | **No blank-badge / out-of-cell validation** — a decal left outside the badge UV cell, or a blank atlas part, silently ships an invisible in-game badge. | `recon-decal-flow.md §5.6`; cell `U[0.286,0.337]×V[0.039,0.086]` | Warn (non-blocking) when the active decal falls outside the badge cell or a required part is empty. | M | Med |

### Larger refactors

| # | Problem | file:line | Fix | Effort | Impact |
|---|---|---|---|---|---|
| R1 | **Two near-duplicate Photoshop-style editors** (FaceplateEditor 5,542 lines, DecalPackEditor 3,733 lines) with inconsistent toolbars: Decal-pack has an on-canvas Undo/Redo bar, Faceplate is keyboard-only, Skin editor removed `UndoRedoBar` entirely. Same actions, three discoverability levels. | `recon-ui-inventory.md` Areas 5–6, obs. 2; `DecalPackEditor.tsx:2106,2136` | Extract a shared canvas-editor shell (toolbar, undo/redo, insignia entry, snap) into `editor-shared/`; render one consistent Undo/Redo control in all three. | L | High |
| R2 | **Overloaded panels** (violate minimalist + progressive-disclosure): Camo (~10 sections incl. full AI stack), Decals (~6), AdjustmentPanel (9 sliders), Decal-pack per-decal strip (~14 icon buttons), PropertiesPanel shadow (5+ fields). | Camo `TopBar.tsx:1059`; Adjust `AdjustmentPanel.tsx:69-149`; strip `DecalPackEditor.tsx:3162-3418` | Progressive disclosure: collapse advanced/AI/adjustment rows behind "Advanced ▸" accordions; group the per-decal strip into Transform / Align / Adjust sub-groups. | L | High |
| R3 | **v6 atlas parts/factions expose UV-atlas mental model** ("Weathering Strips", "Turret Mini-Badges", "Reverse Hull Text", shared-vs-per-faction fork-on-write) to casual makers; behavior differs by project version. | parts `decal-pack-project.ts:246`; matrix only for v6 `DecalPackEditor.tsx:2252`; fork `:407-432` | Rename parts to plain language, hide the shared/override matrix behind an "Advanced placement" toggle, default everyone to a single "Main badge" surface. | M–L | Med |
| R4 | **No non-destructive layers in the skin (diffuse) editor** and no on-model decal-placement discoverability; painting a 2048² atlas blind needs the "Unwrap" overlay understood first. | `VehicleTextureEditor.tsx:90-96,637-644` | Add a light layers/history model to the diffuse editor; make Unwrap on-by-default with a friendly "show UV guide" label. | L | Med |

---

## 6. OPEN QUESTIONS / RISKS

1. **Browser vs disk for "a real asset."** Browser `writeFile` is a no-op (`native-fs.ts:545-546`), so
   driving the UI in a browser proves the *flow* but does not drop a `.sga` into the game. A genuinely
   game-loadable artifact must come from `npm run test-export` / the lib path, or from Electron. Decide
   per phase which "done" you need.
2. **Faceplate Workshop preview format.** Editor ships the encoded **DDS** as the preview
   (`faceplate-mod-build.ts:149-151`); the community guide says **280×280 TGA**. Whether CoH2's uploader
   accepts DDS is **UNVERIFIED** — targeted test needed before relying on browser/Electron publish.
3. **Badge atlas dimension provenance.** The 1024² badge figure comes from the wiki + the 1024² example
   source TGA; a Relic-shipped compiled `.rgt` badge atlas was **not independently re-measured** this
   session (the repo's 2048² numbers refer to the *skin* diffuse, not the decal — don't conflate them).
4. **Top-mip-only RGTs.** `rgt-writer.ts:5-9` emits only the top mip and zeroes the rest, asserting the
   engine tolerates it; whether this causes visible in-game LOD shimmer is **UNVERIFIED**.
5. **Faceplate Pack Wizard primary spec unfetchable.** `modding.companyofheroes.com/faceplate-pack-wizard`
   serves an invalid TLS cert; the wizard's exact step list is **UNVERIFIED from primary source** (numbers
   corroborated by the Steam guide + this repo's byte-verification).
6. **Q1 nav-rail is the top risk to the CREATE recipes.** Until a panel-nav control exists, the skin
   editor's Camo/Decals panels are effectively undiscoverable to a fresh user; the §4 recipe leans on the
   surviving entry points (Edit-texture pill, file-drop) and the panel bodies rendering when `activePanel`
   is set. Fixing Q1 first de-risks Phase 2.
7. **UKF/British asymmetry is invisible.** Packs always ship all 5 factions
   (`decal-mod-build.ts:174`), but British is a reverse-engineered template with no UI signal — a subtle
   correctness/expectation risk, not a blocker.
