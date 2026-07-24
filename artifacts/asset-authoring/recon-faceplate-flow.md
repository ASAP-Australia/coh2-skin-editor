# Recon — Faceplate authoring flow (read-only)

Repo: `/var/home/jflessenkemper/dev/coh2-skin-editor`. All facts cited `file:line`.
A CoH2 "faceplate" = the wide banner + square icon shown on the player profile / lobby chip.

---

## (1) Which components/tools create a faceplate

| Layer | File | Role |
|---|---|---|
| Start menu entry | `src/components/StartScreen.tsx:255` (`New Faceplate` card → `onNewFaceplate`) | Launch point |
| Metadata form | `src/components/NewFaceplateForm.tsx:49` | Name / description / author / template picker |
| Route wiring | `src/App.tsx:387` (`openFaceplate`), `:677` (renders `<FaceplateEditor>`) | phase → `'faceplate'` |
| **Editor (main tool)** | `src/components/FaceplateEditor.tsx:234` | Konva canvas composer (layers: image/text/shape/paint/group) |
| Project model + persistence | `src/lib/faceplate-project.ts` | `Coh2FaceplateProject`, `newFaceplateProject()` (`:635`), localStorage autosave (`persistFaceplate` `:806`) |
| Live in-game preview | `src/components/FaceplateInGamePreview.tsx` (view mode `in_game`, `FaceplateEditor.tsx:290`) | Shows banner + 64² icon in a lobby mock |
| Identity/publish popover | `src/components/PackIdentityPopover.tsx` + `src/components/PublishSection.tsx` | Name/desc/icon + Workshop publish |
| **Build pipeline** | `src/lib/faceplate-mod-build.ts:84` (`buildFaceplateMod`) | Project + RGBA atlas → 6-file SGA |
| Byte templates + geometry | `src/lib/faceplate-templates.ts` | Ram-Ranch GFX/RGD templates + atlas sub-rect constants |
| Canvas → atlas compose | `FaceplateEditor.tsx:5365` (`composeFaceplateCanvas`), `:4944` (`faceplateRenderLayer`) | Renders layers to an `HTMLCanvasElement` |
| SGA writer / BC3 encoder | `src/lib/sga-writer.ts` (`buildSga`), `src/lib/bc-encode.ts` (`encodeBc3`) | Packing + texture compression |

No "install to game folder" component exists — see (5).

---

## (2) Exact user steps: blank → faceplate → export

1. **Start screen** → click **"New Faceplate"** card. `StartScreen.tsx:255` fires `onNewFaceplate`.
2. **"Faceplate details" form** appears (`NewFaceplateForm.tsx`). User must type a **Name** (required, `:151` `canSubmit` gate); Description + Author optional; Template defaults to **"Blank canvas"** (`:137`). Click **"Create & open"** (`:265`).
3. `App.tsx` builds a `newFaceplateProject(...)` (fresh 32-hex `guid`, empty `layers`, transparent bg) and calls `openFaceplate` → `setPhase('faceplate')` (`App.tsx:387-389`).
4. **Editor opens** with a blank **624×204** canvas at the true engine pixel size (`FaceplateEditor.tsx:873-882`). User composes:
   - Drop / paste / file-pick an image → added as top layer (`onImport` `:418`, `addFaceplateImageFromBlob`).
   - Bottom tool pill: **Select / Text / Shapes / Draw / Eraser / Mask** (`FACEPLATE_TOOLS` `:1256`). Insignia library modal for national badges (`INSIGNIA_LIBRARY`, `:265`).
   - Drag/scale/rotate via Konva Transformer; `[`/`]` reorder; Cmd-Z undo; grid snap.
   - Every mutation autosaves to localStorage + schedules Live Sync (`onPersist` `:258`).
5. **Export = publish.** Click the **centered title pill** (`EditorTitlePill`, `:2806`) → opens **PackIdentityPopover**. Its **Visibility segmented selector** (Unlisted/Private/Friends/Public) IS the publish trigger (`PublishSection.tsx:537-544`) — there is no separate "Export" button.
6. Selecting a visibility calls `handlePublish` → if no SGA yet, fires `onRequestBuild` = `handleRequestBuild` (`FaceplateEditor.tsx:1266`), which:
   - `composeFaceplateCanvas(project)` → 624×204 banner canvas (`:1273`).
   - Draws banner into a **692×204** atlas canvas, then downsamples the banner into the **64×64 icon sub-rect at (624,0)** (`:1274-1289`).
   - Reads `getImageData` RGBA → `buildFaceplateMod({ project, atlasRgba, guid })` (`:1308`) → 6-file SGA.
7. `PublishSection` writes the SGA + a 1024² preview PNG to a temp dir and calls `window.electronAPI.steam.workshop.publish/update` (`PublishSection.tsx:254-346`). Success → "Published to Steam Workshop ✓" with a Workshop link.

---

## (3) Underlying lib functions + output format/dimensions actually produced

**`buildFaceplateMod` (`faceplate-mod-build.ts:84`)** produces one **SGA v7** archive, 6 files (`:152-186`), matching a real workshop faceplate byte-layout:

| SGA path | Bytes | Notes |
|---|---|---|
| `attrib/faceplate/<slug>_faceplate.rgd` | ~497 | RGD template, GUID+pbgid patched (`patchRgd` `:349`) |
| `english/english.ucs` | gen | UTF-16-LE + BOM, `id\ttext` (`buildUcsFile` `:417`) |
| `<guid>.info` | gen | ASCII CRLF metadata (`buildInfoFile` `:456`) |
| `<slug>.dds` | 128 + BC3 | root-level preview (required or engine rejects mod, `:143-151`) |
| `ui/assets/textures/<guid>_i1.dds` | 128 + BC3 | the atlas texture |
| `ui/bin/<guid>.gfx` | 8485 | Scaleform GFX template, GUID patched (`substituteAsciiGuid` `:287`) |

- **Texture format:** BC3/DXT5 (`encodeBc3`), wrapped in a 128-byte DDS header (`wrapBc3InDds` `:246`, FourCC `DXT5`, flags `0x00081007`, caps `0x1000`).
- **Atlas dimensions produced: 692 × 204** (`ATLAS_WIDTH/HEIGHT` `faceplate-templates.ts:126-127`).
  - Banner sub-rect `(0,0)–(624,204)` (`BANNER_RECT` `:141`).
  - Icon sub-rect `(624,0)` size `64×64` (`ICON_RECT` `:147`).
- **Identity:** stable per-project 32-hex `guid` (minted at create, `faceplate-project.ts:642`); deterministic FNV-1a pbgid from guid (`deriveDeterministicPbgid` `:396`) so rebuilds are in-place updates.
- **Pre-export verify:** every SGA is round-tripped through `SgaArchive.open` before returning (`assertSgaParses` `:219`).
- The build never touches disk itself — the SGA `Uint8Array` is handed to `PublishSection`, which writes it to a temp dir for Steam upload (`PublishSection.tsx:262-263`).

---

## (4) Required inputs

- **Mandatory:** faceplate **Name** (form gate `NewFaceplateForm.tsx:151`). Everything else has defaults.
- **Effectively required for a good result:** at least one layer of artwork (a fully-blank project builds a transparent/near-black atlas — the icon downsample of empty banner yields a black scoreboard icon, warned about at `FaceplateEditor.tsx:1281-1288`).
- **For publish (step 5-7):** must be running the **Electron desktop app** (`isElectron()` guard `PublishSection.tsx:241`) with Steam running + logged in (`window.electronAPI.steam.workshop.*`). Browser host = build works, publish disabled.
- **Optional:** description, author, per-project inventory icon (`inventoryIcon`, schema v7 `faceplate-project.ts:537`), template clone (blank / saved / stock / workshop `NewFaceplateForm.tsx:28`).

---

## (5) Friction / complexity

- **No local "install to game" path.** `downloadFaceplate` / "Save `.coh2faceplate`" exists in the lib (`faceplate-project.ts:850`) and is unit-tested, but is **NOT wired to any button in `FaceplateEditor.tsx`** (grep: only lib + tests reference it). The sole asset-export route is **Steam Workshop publish**. A user who wants the SGA on disk (e.g. manual `mods/faceplates/subscriptions/<guid>.sga`) has no in-app affordance despite `faceplate-mod-build.ts:47-49` documenting that target path.
- **Export is hidden behind the title pill.** "Export" is not a labeled action; the user must know to click the centered name pill and that picking a *visibility* triggers build+publish (`PublishSection.tsx:541`). Discoverability friction.
- **Icon is auto-downsampled by default** — a wide 624×204 banner squeezed to 64×64 is usually blurry; the v7 `inventoryIcon` override mitigates this but is buried in the popover icon slot (`FaceplateEditor.tsx:2852`).
- **Build cost is modest** (624×204 compose ~5 ms, `:147-152`), but full publish needs a temp dir + 1 MB preview-size limit (`PublishSection.tsx:273-276`) that a complex canvas can trip.
- Editor itself is feature-heavy (Photoshop-style layers, blend modes, masks, filters, groups) — powerful but a lot of surface for a "make a banner" task.

---

## Spec-match note (dimensions/format)

**Matches the real CoH2 faceplate spec — verified, no mismatch found.**
- Atlas 692×204 BC3/DXT5, banner 624×204 at (0,0), icon 64×64 at (624,0): all three were reverse-engineered from three published workshop mods (Ram Ranch, Clarkson, HK416V2) by scanning GFX display-rect bytes AND decoding DDS BC3 alpha bounding boxes — both converge (`faceplate-templates.ts:41-68, 129-147`).
- The 6-file SGA layout + root-level `.dds` requirement is byte-verified against `1394135665.sga` (`faceplate-mod-build.ts:143-151`).
- Historical mismatch already fixed: pre-release used 600×170 banner + 92×92 icon, which left unpainted atlas pixels inside the engine sample rect → visible black borders in-game; migrated to 624×204 (v1→v2, `faceplate-project.ts:26-36, 905-916`).
- Wiki corroboration: `llm-wiki/wiki/concepts/coh2-skin-editor-architecture.md:65` records the 6-file SGA faceplate layout as engine-verified.
- One caveat (not a spec mismatch, a fidelity gap): the default 64×64 icon is a *downsample of the banner*, not a purpose-drawn square; the engine spec is satisfied but visual quality suffers unless the user supplies `inventoryIcon`.

---

## Minimal click-path to produce a faceplate

Start screen → **New Faceplate** → type a **Name** → **Create & open** → drop/add artwork onto the 624×204 canvas → click the **title pill** (top-center) → pick a **Visibility** (this builds the 692×204 BC3 SGA and publishes to Steam Workshop). There is no on-disk export button.
