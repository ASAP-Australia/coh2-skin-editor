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

## VERIFICATION PASS — 2026-07-24 (post-fix full sweep)

Rebuilt (`npm run build && npm run electron:compile`) and re-ran the harness across ALL 14
states → `artifacts/redesign-v2/ui-verify/*.png` (1600×972, real GPU, **14/14 OK**). Every PNG
read at full res + region crops (ImageMagick, incl. 2.2–3.5× brightness boosts to probe for
skybox bleed-through and residual blooms). Verdicts below cite the exact post-fix pixel evidence.

| # | Verdict | Post-fix pixel evidence |
|---|---------|--------------------------|
| 1 | **FIXED** | `skin-camo-panel.png` — left insignia rail is GONE (FactionPanel `hidden={activePanel!==null}` fades + slides it off-screen). "APPLY THIS CAMO TO / DESCRIBE YOUR CAMO / PASTE OR UPLOAD CAMO IMAGE / QUICK PRESETS" headings and every first-column preset pill left-end fully visible, unclipped. |
| 2 | **FIXED** | `skin-decals-panel.png` — no rail overlap. "TEMPLATES / IMAGE LIBRARY / PLACE DECAL" headings clear; "+ Shield / + Number / + Name / + Kills / + Cross / + Image" buttons show full left ends. Stamp grid renders clean. |
| 3 | **FIXED** | `skin-scene-panel.png` (top-left crop) — "CREW" heading fully visible; the undo/redo bar no longer floats over it (Editor.tsx:2289-2293 `opacity-0 pointer-events-none` while a panel is open). Hide/Show toggle below, no overlap. |
| 4 | **FIXED** | `decal-insignia.png` — all 25 thumbnails render as actual white insignia art (Iron Cross, Balkenkreuz, Soviet Star, Guards Badge, Allied Star, RAF Roundel, Chevron ×1–3, Kill Tally, Numeral 0–9). ZERO broken-image placeholder glyphs. Vite `import.meta.glob` asset URLs (`insignia-library.ts:21`) resolve under `file://`. |
| 5 | **FIXED** | `skin-camo-panel.png` / `skin-decals-panel.png` — panel body is opaque near-black (`.glass-pop { background-color: hsl(0 0% 7% / 0.96) }`, Editor.tsx:2163). Even at 2.2× brightness boost the interior stays uniform charcoal; blue skybox appears only OUTSIDE the panel. Right-half text ("German 3-tone summer", "Soviet whitewash", "Desert tan") full contrast. |
| 6 | **STILL PRESENT (noted, by-design — not fixed per brief)** | `skin-editor.png` + all skin states — bright medium-blue cubemap skybox + green ground oval unchanged (`scene-settings.ts:112` still `{ kind:'cubemap' }`). Framing note only; no regression, deliberately left. |
| 7 | **FIXED** | `decal-editor.png` / `decal-advanced.png` / `faceplate-editor.png` / `faceplate-shapes.png` — LAYERS and PROPERTIES are now compact content-sized pills anchored to the top (LayersPanel.tsx:110-111,201-202; PropertiesPanel.tsx:135,241), not near-full-height empty bordered boxes. No "empty boxes" clutter. |
| 8 | **STILL PRESENT (noted, deferred Phase-2 structural)** | `decal-editor.png` — layout still LAYERS-left / canvas-center / PROPERTIES-right, no 3D vehicle preview. Structural deviation, out of scope for this reskin pass. No regression. |
| 9 | **FIXED** | `decal-insignia.png` — labels are FULL and below the thumbnail (2-line clamp + `wordBreak`, DecalPackEditor.tsx:3014-3031): "Iron Cross (Bordered)", "Balkenkreuz", "Soviet Star (Plain)", "Guards Badge", "Allied Diamond", "Chevron ×1/×2/×3", "Kill Tally ×1/×5", "Numeral 0–8" — no truncation, no overlap on the art. |
| 10 | **FIXED** | `start.png` (New Decal Pack tile crop) — sublabel reads "Vehicle decal set" in full, no ellipsis. Descriptions rewritten to short one-line sublabels ("Paint a vehicle livery", "Player profile banner", "Open saved project"). |
| 11 | **PARTIALLY FIXED — STILL-BROKEN (right rail)** | LEFT rail fixed: `skin-editor.png` (left crop) — FactionPanel active tile is now a soft translucent raised tile (`bg-white/12` + inset light, FactionPanel.tsx:63), not pure-white. RIGHT rail NOT fixed: `skin-editor.png` (right crop) — ScenePanel active tile (globe/cubemap preset) is still `bg-white/95` + `text-black` (`ScenePanel.tsx:55`) → a harsh near-pure-white tile against the dark rail. The fix agent only touched `FactionPanel.tsx`; the right HUD rail lives in `ScenePanel.tsx:55` (finding mis-attributed it to `Editor.tsx`), which was left unchanged. This same white tile also shows faintly through the modal scrim at the right edge of `decal-insignia.png`. |
| 12 | **FIXED** | `faceplate-editor.png` / `new-faceplate-form.png` / `faceplate-shapes.png` — no circular white glow/bloom at the far-right edge; at 3.5× brightness boost the right edge is uniform flat dark (only the window frame hairline). Stray bloom source (`AtlasViewPanel` white active tile) removed entirely (FaceplateEditor.tsx:107-108). |
| 13 | **FIXED** | `start.png` (New Faceplate tile crop) — Frame/hash icon now renders gold (`color: var(--color-editor-accent)` = `#BA965A`, StartScreen.tsx:260), not sky-blue. No lone blue on the screen. |

### New findings from this pass
- **None that are new regressions.** #11 right-rail is a *pre-existing, unresolved* half of finding #11 (the fix covered only the left rail) — logged above as STILL-BROKEN, not a new glitch.
- Minor observation (not a listed finding, not introduced by these fixes): the decal editor's right-edge view-mode toggles (`decal-editor.png` / `decal-advanced.png`, ~x1550) and the "Shared" faction chip (`decal-advanced.png`) use the same bright-white active-tile treatment as ScenePanel — the same visual family as #11-right. If #11 is retired by softening active tiles globally, these would want the same token.

### One-line remediation for the remaining #11-right
`src/components/ScenePanel.tsx:55` — change the active branch from
`'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'`
to match FactionPanel's soft raised tile
`'bg-white/12 text-white shadow-[inset_0_0.5px_0_rgb(255_255_255/0.35),0_2px_8px_rgba(0,0,0,0.30)]'`.

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
