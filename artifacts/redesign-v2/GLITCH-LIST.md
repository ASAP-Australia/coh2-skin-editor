# GLITCH-LIST — redesign-v2 full visual sweep

Rebuilt (`npm run build && npm run electron:compile`) and ran the UI-capture harness
(`UI_CAPTURE=1 electron .`) across ALL 14 named states → `artifacts/redesign-v2/ui-verify/*.png`
(1600×972, real GPU). Every PNG read at full res + region crops. Captured 14/14 OK; **0 UNVERIFIED**.

Reference: VISION.md (dark "simple but powerful", no save/export/sync, no "boxes everywhere")
and lab01-design-language.md (near-black layered surfaces, gold `#BA965A` house accent, masked
border-light ring, Inter/Geist type). Source-verified where a fix location was needed.

Legend — severity: **P1** breaks usability · **P2** ugly / clearly wrong · **P3** nit.

> Note on accents (NOT glitches — verified in `src/index.css:50-59` + `editor-primitives/tokens.ts:14-39`):
> the app **intentionally** runs two accents — Brigade **orange** (`--color-accent`) for user-initiated
> primary actions (Apply, Hide/Show), and house **gold `#BA965A`** (`--color-editor-accent`) for
> selection/focus rings. The old **blue** selection accent was deliberately removed (tokens.ts:39
> "was blue"). Font is **Inter Variable** app-wide (index.css:372) — correct. So orange, the gold rings,
> and Inter are all by-design and are excluded from the findings below.

## Findings

| # | Screen | What is visually wrong (the pixels) | Suspected component file | Severity |
|---|--------|--------------------------------------|--------------------------|----------|
| 1 | skin-camo-panel | The left insignia rail (red-star medal on a white active tile, iron cross, soviet star, shield, medal) sits **on top of the camo panel's left edge**, obscuring the "QUICK PRESETS" heading and clipping the left ends of the first-column preset pills ("Honved Hungarian 3-to…", "German whitewash winter", "Soviet summer") and the "PASTE OR UPLOAD CAMO IMAGE" label. Genuine z/layout collision. | `FactionPanel.tsx:35` (`fixed top-1/2 left-5 z-30`) collides with the panel body slid in at the same `left-5` (`Editor.tsx:2220`) | P2 |
| 2 | skin-decals-panel | Same collision: the left insignia rail overlaps the decals panel's left edge — covers "IMAGE LIBRARY" + "PLACE DECAL" + "ON THIS VEHICLE (0)" labels and the left ends of the "+ Shield" / "+ Kills" buttons. | `FactionPanel.tsx:35` vs `Editor.tsx:2220` | P2 |
| 3 | skin-scene-panel | The undo/redo bar (two circular arrow buttons) floats **on top of the Scene panel's "CREW" heading**, clipping the "CREW" text behind the buttons. | undo/redo bar (`Editor.tsx:2265-2268`, `UndoRedoBar.tsx`) overlaps ScenePanel header | P2 |
| 4 | decal-insignia | **Every** insignia thumbnail in the Insignia Library grid (Iron Cross, Balkenkreuz, Soviet Star, Guards Badge, Allied Star, RAF Roundel, Chevrons, Kill Tally, Numeral 0-9) renders as a **broken-image placeholder glyph** (torn-photo icon) with the alt-text label drawn on top of it. No actual insignia art loads → grid of broken images + overlapping labels. | `insignia-library.ts` thumbnail src / `DecalPackEditor.tsx` insignia modal | P2 (P1 for that modal's usability) |
| 5 | skin-camo-panel / skin-decals-panel | Panel body is **semi-transparent on its right half** — the bright blue skybox + green ground plane bleed through behind the lower/right panel content, dropping text contrast at the panel's right edge (esp. the second preset column & dropzone text). Panel needs an opaque near-black fill (lab01 cheap-approx: `hsl(0 0% 7% / .9)`, no blur). | TopBar panel-body surface (`Editor.tsx:2154-2160`), panel container class | P2 |
| 6 | skin-editor + all skin states | Whole viewport backdrop is a **bright medium-blue skybox** (default scene preset `background:{kind:'cubemap'}`, `scene-settings.ts:112`) with a green ground oval — dominates a "dark mode" app and clashes with the near-black chrome. FRAMING NOTE (not fixing per brief): default scene should read dark, or a darker/neutral preset should be the editor default. | `scene-settings.ts:112` (default preset `background`) | P2 (noted, 3D framing) |
| 7 | decal-editor / decal-advanced / faceplate-editor | LAYERS (left) and PROPERTIES (right) are **two near-full-height empty bordered boxes** each holding only a heading + one line of placeholder text ("No layers yet." / "Select a layer to edit its properties"). Reads as the "boxes everywhere / empty boxes" clutter VISION forbids — a lot of empty bordered real estate. | `editor-shared/LayersPanel.tsx`, `editor-shared/PropertiesPanel.tsx` | P3 |
| 8 | decal-editor | LAYOUT vs VISION (note): VISION wants the decal editor as **decal canvas on the RIGHT + live 3D vehicle preview on the LEFT**. Actual: LAYERS left, canvas CENTER, PROPERTIES right — **no 3D vehicle preview** rendered. Structural deviation, not a pixel bug. | `DecalPackEditor.tsx` layout | P2 (noted) |
| 9 | decal-insignia | Insignia tile labels are truncated to fit the narrow tiles: "Balke" (Balkenkreuz), "Sovie" (Soviet Star), "Guar" (Guards), "Allie" (Allied), "Chev" (Chevron), "Num" (Numeral) — and the label overlaps the (broken) thumbnail glyph. | insignia modal tile (`DecalPackEditor.tsx`) | P3 |
| 10 | start | "New Decal Pack" tile description is truncated with an ellipsis: "A set of vehicle dec…." — the description string overflows the tile's single line. | `StartScreenCard.tsx` (tile subtitle clamp) | P3 |
| 11 | skin-editor | Left & right vertical HUD rails use a **pure-white rounded tile** for the active item (globe / red-star medal) — very bright vs the dark rail + blue bg; harsher than lab01's white/alpha raised active state. | `FactionPanel.tsx` active tile, right HUD rail (`Editor.tsx`) | P3 |
| 12 | faceplate-editor / new-faceplate-form | A faint **circular white glow/bloom floats at the far-right screen edge**, vertically centered, detached from any element (stray ambient corner-light positioned mid-edge rather than in a corner). | faceplate editor ambient bloom layer (`FaceplateEditor.tsx` background glow) | P3 |
| 13 | start | "New Faceplate" tile icon is a bright **sky-blue** hash/Frame icon (`text-sky-400`, `StartScreen.tsx:257`) — the only blue on the screen, stands out against gold/green/purple sibling icons. Intentional per-category color, but the lone blue reads as leftover-accent to a viewer. | `StartScreen.tsx:257` | P3 |

## Per-screen "looks good" confirmations (coverage is explicit)

- **start** ✔ — Texture/noise pattern renders on the black card; top-left AND bottom-right corner-light blooms visible (brightness-boosted crop confirmed both); border-light ring present, brighter top-left. Logo + "COH2 · COMMUNITY MODDING TOOL" eyebrow crisp; 2×2 action tiles aligned; Continue-skin-pack row clean. (Only #10/#13 nits.)
- **new-skin-form** ✔ — Opens skin editor directly (no separate faction/name form in this build — expected per harness). First-frame shows "Loading model…" on the ground plane; chrome intact. (Shares #6 blue backdrop.)
- **new-faceplate-form** ✔ — Identical to faceplate-editor; dark, tools-at-bottom, title pill correct. (Shares #7-empty-boxes #12-glow.)
- **new-decal-form** ✔ — Identical to decal-editor; title pill shows the auto-sync **spinner** first-frame (→ becomes green check), confirming invisible always-on sync feedback. (Shares #7/#8.)
- **skin-editor** ✔ (chrome) — Home button, "Decals·Camo·Parts·Scene" nav pill, undo/redo, "My Skin Pack" title pill (green sync check), window controls, bottom control-pill row (Template / Decal pack / Summer·Winter / Edit texture), and the **bottom vehicle selector** (Elefant…Opel Blitz, Tiger I selected) all render cleanly and dark. Matches VISION layout. (Only #6/#11.)
- **skin-camo-panel** ✔ (content) — Scope cards (This vehicle only / Every german vehicle / All 80 vehicles·BULK), "DESCRIBE YOUR CAMO" input, Preview + Apply-to-skin, quick-presets grid, "▸ ADVANCED — AI GENERATION" all present and legible. Marred only by #1 overlap + #5 transparency.
- **skin-decals-panel** ✔ (content) — Stamp grid (crosses/stars/skull/321/lightning/roundel), image-library dropzone, PLACE DECAL buttons, "Clear all decals" all present. Marred only by #2 overlap + #5.
- **skin-scene-panel** ✔ (content) — CREW Hide/Show segmented toggle + description render correctly. Marred only by #3 undo/redo overlap.
- **texture-editor** ✔ — Excellent: near-black canvas, "← Back" top-left, undo/redo, "Edit texture — tiger" title pill, window controls; tool-options peel ABOVE toolbar (SIZE/SOFT/OPACITY sliders + swatch grid + Clear); toolbar (Draw/Erase/Pick/UV guide/Mirror) with **gold** selection rings. Fully matches VISION. No glitches.
- **decal-editor** ✔ (chrome) — Dark, home + undo/redo, "My Decal Pack" title pill, DESIGNING subtitle, 128×128 canvas with editor-guide crosshair, bottom toolbar (Select/Images/Transform/Tint/Draw/Snap, gold ring), zoom 400%·Fit·1:1. Clean apart from #7/#8.
- **decal-insignia** ✔ (structure) — Modal well-formed: dark scrim, filter pills (All/Allies/Soviet/Axis-Oh/Axis-Okw/Generic), 7-wide grid, close button. Undermined by #4 broken thumbnails + #9 truncation.
- **decal-advanced** ✔ — Placement stepper "◀ Main badge (2/6) ▶", "EDITING: SHARED (ALL FACTIONS)" eyebrow, faction chips (Shared + 5 emblems — these emblem thumbnails DO render, unlike #4), "Show parts × factions" link. Clean apart from #7.
- **faceplate-editor** ✔ — Dark, title pill, 624×204 banner canvas w/ editor guide, bottom toolbar (Select/Text/Shapes/Draw/Eraser/Mask/Snap, gold ring), help "?". Matches VISION. Only #7/#12.
- **faceplate-shapes** ✔ — Shapes tool selected (gold ring); options peel ABOVE toolbar with 6 clean shape buttons (rect/circle/chevron/star/shield/bars), consistent cells + spacing. Matches VISION pattern. No new glitches.

## UNVERIFIED
None — 14/14 states captured and read.
