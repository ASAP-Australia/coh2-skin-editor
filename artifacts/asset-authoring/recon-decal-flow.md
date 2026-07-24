# Decal authoring flow — codebase recon

Read-only recon of the DECAL authoring path in the CoH2 Community Modding Tool
(`coh2-skin-editor`). All claims cite `file:line`. Grounded first in the LLM-wiki
page `wiki/concepts/coh2-decal-pack-format.md` (15-file SGA layout, badge-atlas
UV) and `wiki/concepts/coh2-skin-editor-architecture.md` (three-editor
architecture, DecalPackEditor on react-konva).

---

## 1. React components / panels / tools that create + place a decal

| Component | File:line | Role in the decal flow |
|---|---|---|
| `NewDecalPackForm` | `src/components/NewDecalPackForm.tsx:43` | Metadata gate before the editor: name (required), description, author, and a **Template** picker (`blank` / saved / stock vehicle / workshop). "Create & open" button at `:242`. |
| `TemplatePicker` | `src/components/TemplatePicker.tsx` (used at `NewDecalPackForm.tsx:184`) | Blank-canvas / saved / stock / workshop source selector. |
| `DecalPackEditor` | `src/components/DecalPackEditor.tsx:141` | The full-screen editor. Konva `Stage`/`Layer`/`Image`/`Transformer` (`:28`) render the zoomed 128² canvas of the active decal. |
| Bottom tool pill | `DECAL_TOOLS` array `DecalPackEditor.tsx:1435` | 5 tools: **select, images, transform, tint, draw** (`DecalToolId` type `:132`). Note: no "export" tool — Live Sync replaces it (comment `:1434`). |
| Decal strip | described `DecalPackEditor.tsx:6-9`, `:20-22` | Always-visible horizontal 44×44 thumbnail strip between canvas and pill; click-to-select, context menu for visibility/duplicate/delete (`decalCtxMenu` `:245`). |
| Image import (`images` tool) | `onImport` `:451`, `onAddImageFiles` `:482`, `onBatchImport` `:528`, `ImageDropZone` (`:93`) | Add source images → each becomes a new decal layer. `N` key also triggers batch import (`:794`). |
| Insignia library | `insigniaOpen` `:207`, `INSIGNIA_LIBRARY` from `src/lib/insignia-library.ts` (`:83`) | Built-in national-insignia picker (filterable by faction `:222`). |
| `AtlasViewPanel` | `:87` | Three-position view switcher: template / checkerboard / in-game (`AtlasViewMode` `:213`). |
| Atlas Part / Faction controls (v6) | `PartStepper` `:2266`, `FactionRow`/`FactionPartMatrix` (`:102-104`), `showPartMatrix` `:235` | Choose which of 6 atlas **parts** (`ATLAS_PART_DEFS`, `decal-pack-project.ts:246`) and which **faction** (shared vs per-faction override) the current edits apply to. Only rendered for v6 projects (`{project.parts && …}` `:2252`). |
| `PackIdentityPopover` | `:98`, rendered ~`:2190` | Left-panel name/description/author + **Pack icon** slot (`:2205`), and hosts the publish section. |
| `PublishSection` | `src/components/PublishSection.tsx`, wired `:2229-2245` | "Build → Publish to Workshop" inline flow. Calls `handleRequestBuild` (`:1444`). |
| Live Sync badge | `LiveSyncBadge.tsx`, `useLiveSync()` `:259` | Status pill; the actual in-game install mechanism (see §2/§3). |

The 6 atlas parts the user picks between (`decal-pack-project.ts:246`):
`Weathering Strips` (locked), `Main Hull Badge`, `Turret Mini-Badges`,
`Unit Banner`, `Commander Crest`, `Reverse Hull Text`.

The 5 factions (shared + overrides) come from `FACTION_LABELS`/`FACTION_COLORS`
(`src/lib/factions.tsx`, imported `:106`) and `DecalFaction`
(`decal-mod-templates.ts`, `:105`): AEF / British / German / Soviet / West German (OKW).

---

## 2. Exact user steps: blank → placed decal → installed/exported decal SGA

App routing entry: StartScreen `onNewDecalPack` → `openDecalPack(newDecalPackProject())`
(`src/App.tsx:564`) → `phase === 'decal-pack'` renders `<DecalPackEditor>` (`App.tsx:688`).

1. **Start screen → "New decal pack".** Fires `App.tsx:564`
   (`newDecalPackProject()` from `decal-pack-project.ts:422`).
2. **`NewDecalPackForm`** appears (`NewDecalPackForm.tsx:43`). Pick a **Template**
   (default `blank`, `:126`), type a **name** (required — `canSubmit` gates on it
   `:140`), optionally description/author. Submit with **"Create & open"** button
   (`:242`) or **Cmd/Ctrl+Enter** (`:158`). `onSubmit` → parent opens the editor.
3. **`DecalPackEditor` opens** on the `select` tool (`:143`) with an empty 128²
   Konva canvas and an empty decal strip.
4. **Add artwork.** Switch to the **Images** tool (or press `N`) and:
   - Upload an image file / drag-drop (`onAddImageFiles` `:482`, `ImageDropZone` `:93`), or
   - Batch-import up to 32 files (`onBatchImport` `:528`, `BATCH_IMPORT_MAX` `:135`), or
   - Pick from the **Insignia library** (`insigniaOpen` `:207`).
   Each import calls `addDecalSourceImageFromBlob`/`FromFile`
   (`decal-pack-project.ts:494/:512`) then `newDecal(...)` (`:461`) to create a
   layer centered at 128/2,128/2 sized to 80% of the canvas (`:463-471`).
5. **Place / transform the decal.** With the **select** tool, drag on the Konva
   canvas (snap guides `applySnap` `:1102`); or use **transform** tool inputs
   (`TransformInputsRow` `:94`); arrow keys nudge (`:830-848`, step `nudgeStep`
   `:185`). Optional **tint** (`:1439`) and **draw** (raster paint, `beginDraw`
   `:1234`) tools. Multi-select drag + group transform via `attachTransformerToIds`
   (`:960`). Undo/redo through `useHistoryEngine` (`:151`).
6. **(v6) Assign to parts/factions.** Use `PartStepper` (`:2266`) to move between
   the 6 atlas parts and the faction row/matrix to fork per-faction overrides
   (fork-on-write in `mutateActiveCell` `:407-432`).
7. **Auto-install to game (primary path).** Every mutation persists via
   `onPersist` → `saveDecalPackToLocal(next)` **and** `scheduleLiveSync('decal', next)`
   (`DecalPackEditor.tsx:156-159`). Live Sync is force-enabled with no opt-out —
   `setEnabled` always writes the localStorage flag `'true'` (`live-sync.ts:171-175`,
   `:238-240`). The manager builds the SGA (`buildDecalMod` `live-sync.ts:814`) and
   writes it to `mods/decals/subscriptions/<guid>.sga` (`live-sync.ts:578`, `:887`,
   `:904-914`), guid = `deriveGuidFromId(project.id)` (`:797`). This IS the
   "export to game" — no button press.
8. **Publish to Workshop (optional explicit export).** In the identity popover,
   `PublishSection` → **Build** calls `handleRequestBuild` (`:1444`): renders a
   64² icon + per-part/faction RGBAs (`partsForBake` `:1477`), calls
   `buildDecalMod({project, iconRgba, decalRgba, partRgbas, guid})` (`:1529`),
   then `makeDecalPublishTarget` (`:1530`) → `PublishToWorkshopDialog` uploads via
   steamworks.
9. **Save-to-file export (optional).** `downloadDecalPack(p)`
   (`decal-pack-project.ts:840`) writes a `.coh2decalpack` JSON project file (NOT
   an SGA — this is the re-openable project, reloaded at `App.tsx:441`).
   A separate `exportDecalPackZip` (`decal-pack-export.ts:55`) produces a ZIP of
   the rasterised PNGs.

---

## 3. Underlying lib functions (builder, sga-writer, validation)

- **Project model / persistence** — `src/lib/decal-pack-project.ts`:
  `newDecalPackProject` (`:422`), `newDecal` (`:461`),
  `addDecalSourceImageFromBlob/FromFile` (`:494/:512`),
  `saveDecalPackToLocal` (`:549`), `DECAL_PACK_SIZE = 128` (`:33`),
  `ATLAS_PART_DEFS` (6 parts, `:246`), `downloadDecalPack` (`:840`),
  `tryParseDecalPackFile` (`:854`, project-file validation on load).
- **Rasteriser** — `src/lib/decal-pack-export.ts`: `rasteriseDecal` (`:158`)
  renders a decal to a canvas with in-game placement geometry; `exportDecalPackZip`
  (`:55`); `makeSlug` (`:414`); `buildZip` (`:438`).
- **Atlas compositor** — `src/lib/atlas-parts.ts`: `compositePartLayers`
  (used `DecalPackEditor.tsx:306`), `partsForBake` (used `:1477`) → per-part,
  per-faction 1024² RGBAs.
- **SGA mod builder** — `src/lib/decal-mod-build.ts`: `buildDecalMod` (`:136`) is
  the 15-file SGA assembler. Constants `DECAL_ICON_SIZE=64` (`:50`),
  `DECAL_MAIN_SIZE=280` (`:56`), `DECAL_TEXTURE_SIZE=1024` (`:65`). Encodes BC3
  DDS (`wrapBc3InDds` `:324`, `encodeBc3` from `bc-encode.ts`), patches the GFX
  template (`substituteAsciiGuid` `:167`), emits per-faction RGD + BC1/DXT1 1024²
  RGT (`:169-212`), builds UCS/INFO (`buildUcsFile` `:462`, `buildInfoFile` `:483`),
  derives per-faction pbgids (`deriveDeterministicPbgid` `:180`,`:444`) so the 5
  RGDs don't collide, `generateGuid` (`:427`), `makeSlug` (`:508`).
  Input validated: icon buffer must be exactly 64²×4 bytes (`:139`), guid must be
  32 lowercase hex (`:155`).
- **RGD / RGT templates** — `src/lib/decal-mod-templates.ts`: per-faction RGD
  templates incl. British reverse-engineered `RGD_BRITISH_B64` (per wiki
  `coh2-decal-pack-format.md`); `DecalFaction` type; `FACTION_ORDER`.
- **SGA packer** — `src/lib/sga-writer.ts` (SGA v7 Relic-Chunky writer; the
  FolderNode-tree writer that emits the backslash hierarchy CoH2 requires — per
  wiki resolved-bug callout). Round-trip guard `src/lib/__tests__/sga-roundtrip.test.ts`.
- **Install / Live Sync** — `src/lib/live-sync.ts`: `scheduleLiveSync` (`:1534`),
  `deriveGuidFromId` (`:982`), builds via `buildDecalMod` (`:814`), writes to
  `mods/decals/subscriptions/` (`:578`,`:887`,`:914`); path detection
  `detectModsPath` (`native-fs.ts`, imported `:32`).
- **Workshop publish** — `PublishToWorkshopDialog.tsx` `makeDecalPublishTarget`
  (imported `DecalPackEditor.tsx:100`); `PublishSection.tsx`.

---

## 4. Inputs accepted / outputs produced

**Inputs**
- Required: a **pack name** (`NewDecalPackForm.tsx:140`). Everything else optional.
- Artwork: raster **image files** via file picker / drag-drop / batch (`accept="image/*"`
  `:532`), the built-in **insignia library**, or painted directly with the draw tool.
  Formats: anything the browser `Image`/`createImageBitmap` decodes (PNG/JPG/WebP/GIF/…);
  the wizard normalises to a 128² source canvas + PNG data URLs.
- Template source: blank / a saved `.coh2decalpack` / a stock vehicle / a subscribed
  workshop item (`DecalPackTemplateSelection` `:25`).

**Outputs**
- **In-game SGA (primary):** `mods/decals/subscriptions/<guid>.sga`, a 15-file
  Relic-Chunky SGA v7 (5 per-faction `attrib\vehicle_decal\<slug>_<faction>.rgd`
  + 5 `art\armies\<faction>\badges\<guid>\default_dif.rgt` BC1/DXT1 1024² badge
  atlases + `english\english.ucs` + `<guid>.info` + root preview DDS + inventory
  DDS + GFX). Structure/paths per wiki `coh2-decal-pack-format.md`; written
  automatically by Live Sync, or built on-demand by `handleRequestBuild`
  (`:1444`) → `buildDecalMod` (`:1529`).
- **Workshop item:** uploaded via `PublishToWorkshopDialog` (steamworks) with a
  bbox-cropped preview thumbnail (`generateWorkshopPreview`, `:1501`).
- **Project file:** `.coh2decalpack` JSON (`downloadDecalPack` `:840`) — re-openable,
  NOT loadable by the game.
- **ZIP of PNGs:** `exportDecalPackZip` (`decal-pack-export.ts:55`) — the
  `DecalPackExportResult` (`:35`).

---

## 5. Friction / complexity notes

1. **Two parallel "get it into the game" mechanisms with no explicit Export button.**
   The header comment says the export tool was removed and "Live Sync handles it
   automatically" (`:1434`). A first-time maker sees no obvious "Export SGA" affordance;
   they must trust the invisible auto-install (`live-sync.ts:171-175` force-on) or find
   the Publish section inside the identity popover. Discoverability risk.
2. **Live Sync is force-enabled with no opt-out.** `setEnabled` unconditionally writes
   the flag `'true'` and `enabled === false` is "intentionally a no-op in v1.0"
   (`live-sync.ts:171-175`, `:238-240`, `:254`). Every keystroke rebuilds + rewrites a
   full 15-file SGA to disk — surprising side-effect for a user who thinks they're just
   editing.
3. **v6 atlas parts/factions expose engine jargon.** Part names like "Weathering
   Strips", "Turret Mini-Badges", "Reverse Hull Text" (`decal-pack-project.ts:246`)
   and the shared-vs-per-faction **fork-on-write** override model (`:407-432`) surface
   UV-atlas concepts a casual maker won't understand. The Part/Faction matrix only
   renders for v6 projects (`:2252`), so behaviour differs between project versions.
4. **Faction coverage asymmetry is invisible.** The pack always ships all 5 factions
   (`FACTION_ORDER` loop `decal-mod-build.ts:174`), but British is a reverse-engineered
   template (per wiki) — nothing in the UI signals this or lets the user target a subset.
5. **Two "export" verbs collide.** `downloadDecalPack` writes a project `.coh2decalpack`
   (not game-loadable) while the SGA is what the game needs — the word "export"/"save"
   is ambiguous about which artifact you get.
6. **Required fields are thin but the flow is deep.** Only the name is required, yet a
   valid in-game decal needs artwork placed in the right atlas part; there's no
   validation/warning if a part is left blank or a decal sits outside the badge UV cell
   (badge cluster U[0.286,0.337]×V[0.039,0.086] per wiki) — silent blank badges in-game.
7. **The 128² editing canvas vs the 1024² baked atlas** (`DECAL_PACK_SIZE=128` vs
   `DECAL_TEXTURE_SIZE=1024`) means the user paints at 128 and the tool upscales;
   fine detail authored small can look soft in-game.

---

## Minimal click-path (see also the 10-line summary)

Start screen → **New decal pack** → type a **name** → **Create & open** →
**Images** tool → **upload an image** (or pick from insignia library) →
(the decal auto-places centered; drag to position) → **done** — Live Sync has
already written `mods/decals/subscriptions/<guid>.sga` into the game.
