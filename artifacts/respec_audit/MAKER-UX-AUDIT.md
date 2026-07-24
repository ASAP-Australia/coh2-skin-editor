# Maker UX Audit — CoH2 Modding Tool
**Auditor:** CDP live session against dev server :9222  
**Date:** 2026-06-16  
**Scope:** Three maker workflows from a Photoshop user perspective (decal pack, faceplate, skin pack). Audit-only; no code changes made.  
**Evidence:** `/tmp/coh2-evidence/ux/`

---

## Summary

The editor is in a strong state for the publish pipeline (auto-sync, Workshop integration, updatability), but a Photoshop user opening the app for the first time would hit several hard stops. The two most severe issues are a **completely unreachable camo/scope mechanism in the skin editor** (the CamoPanel exists in code but has no UI entry point) and **publish-via-selecting-visibility** which is a non-standard affordance with no label explaining the gesture. Save/sync/publish disambiguation is entirely tooltip-based — zero ambient UI.

---

## Workflow 1 — Decal Pack "for all factions"

### User path observed
Home → "New Decal Pack" → decal editor loads immediately with `Main Hull Badge (2/6)` active.

| # | Friction / Issue | Severity | PS User Expects | Concrete Fix Sketch |
|---|---|---|---|---|
| D1 | **Faction row has no explanatory label** — the ALL / 5 faction icons appear with no heading or tooltip explaining what they do. The user has no indication that "ALL" means "shared across all factions" vs "view all at once" vs "apply to all". | P1 | A heading like "Scope: All Factions / Per-Faction Override" or a tooltip on ALL explaining shared-layer semantics | `FactionRow.tsx`: add a small `title` attribute to the ALL button reading "Shared (applied to all 5 factions)" — currently truncated to just "Shared (all factions)"; add a visible micro-label above the row in `DecalPackEditor.tsx` ~line 2204 |
| D2 | **Switching to a faction override shows NOTHING different** — clicking an OstHeer faction button sets `aria-pressed=true` on that button (visual state changes) but no contextual text or overlay explains that you are now in "OstHeer override" mode, what the shared layers under it are, or how to exit back to shared. | P0 | A banner or label: "Editing OstHeer override — shared layers still apply" with a clear "Back to Shared" affordance | `DecalPackEditor.tsx` ~line 2200: render a floating micro-banner below the FactionRow when `activeFaction !== null`, e.g. `"Editing [faction] override — shared layers beneath"` |
| D3 | **The parts × factions matrix ("Show parts × factions")** is a link-style underlined text, not a prominent button — visually demoted below the part stepper and faction row. A new maker won't discover it. | P2 | A clearly-labelled "Overview" or icon button (grid icon) as a prominent affordance | `DecalPackEditor.tsx` ~line 2225: promote to a filled small button with a `LayoutGrid` icon; add `title="See all 6 parts × 5 factions at a glance"` |
| D4 | **No "copy shared to all factions" action** — once a user creates content in "ALL" mode and then selects a faction override, there's no button to propagate shared layers into all 5 faction overrides at once. The maker must manually visit each faction and the fork-on-write happens silently. | P1 | PS equivalent: "Duplicate layer to all" or a batch-apply action | Add a "Copy to all factions" button in the faction header area, wiring to a mutate that copies `part.shared` into all 5 `part.overrides[faction]` slots simultaneously |
| D5 | **Part stepper shows "Main Hull Badge (2/6)" but the 6 parts are not named on first glance** — the user must click through all 6 to discover what the atlas slots are. | P2 | A dropdown or pop-over listing all 6 part names | `PartStepper.tsx`: add a popover or tooltip listing all part names on hover of the stepper label |
| D6 | **No visible "saved" confirmation after drawing/adding decals** — the title pill's tooltip says "Synced just now" but that's only visible on hover. A Photoshop user expects File > Save feedback. | P1 | "Saved" toast or visible indicator after each edit | Expose `sync.reason` as a subtle fade-in text below or beside the title pill (already done for errors, missing for success state) |

---

## Workflow 2 — Faceplate "for all factions"

### User path observed
Home → "New Faceplate" → faceplate editor loads with blank canvas. Layers panel on left, Properties panel on right. Tool pill at bottom.

| # | Friction / Issue | Severity | PS User Expects | Concrete Fix Sketch |
|---|---|---|---|---|
| F1 | **Shadow, Document-Background, and Align tools are GONE from the toolbar** — moved to Properties panel per the IA change (comment at FaceplateEditor.tsx line 156). A PS user will immediately look for these in the tool row and not find them. The Properties panel does contain them but only when a layer is selected — the user must already know to look there. | P1 | Dedicated toolbar icons for Background, Shadow, and Align (PS convention) or at minimum a "?" tooltip on the Properties panel header saying "Shadow, BG, and Align are here" | Add `title` on the PROPERTIES panel header: "Includes Shadow, Background, and Align controls — select a layer to see them". Or add ghost/disabled tool icons in the bottom pill that scroll the Properties panel to the relevant section on click. |
| F2 | **Text click-to-place is context-dependent** — the text tool is selected (keyboard shortcut T) but clicking the canvas when no guide is set or when the canvas has a specific Konva hit-test issue causes no new layer to appear. A PS user expects click = new text layer at that point. | P0 (confirmed in PS-PARITY-AUDIT.md TX1) | Click canvas in Text mode → cursor appears + new editable text layer | `FaceplateEditor.tsx` ~line 1276: fix the `ev.target !== ev.currentTarget` guard blocking text placement |
| F3 | **Faceplate has no faction concept exposed** — for a "banner for all factions" use case, the maker has no indication that a single faceplate file works across all 5 factions in CoH2. No contextual help explains this. | P2 | A note: "This faceplate will appear for players of any faction" | Add one-line help text in the empty-state or in the PackIdentityPopover: "Faceplates are faction-agnostic — one file works for all 5 factions." |
| F4 | **Live sync status is tooltip-only** — the title pill shows a `CheckCircle2` icon but the reason ("Synced just now" / "Sync failed: …") is only in the `title` attribute; a maker never sees it unless hovering. When sync FAILS (e.g. new empty faceplate with no layers), the error icon appears but the reason is invisible unless the user thinks to hover. | P1 | A visible sync status: e.g. small text below/beside the pill, or a persistent "Saved" / "Error: …" label | `EditorTitlePill.tsx`: when `syncState === 'error'`, render an inline visible label below the pill with the truncated `reason` text (not just via `title`). |
| F5 | **The Properties panel shows "Select a layer to edit its properties" as an empty state** — fine, but Background and Align controls are buried inside this same panel. A first-time user doesn't know to look here for those. | P2 | Persistent Background section (always visible, not layer-conditional) | In `PropertiesPanel.tsx`: the Background section is always visible; Align section should be visible (but dimmed) when nothing is selected, not just when a layer exists. Check rendering path at line ~100. |
| F6 | **No explanation of what "inventory icon" means** — the PackIdentityPopover shows an "INVENTORY ICON" slot with "Falls back to auto-downsample of banner". A first-time modder doesn't know what "inventory" refers to in CoH2. | P2 | Tooltip: "64×64 thumbnail shown in the CoH2 customise screen equipment list" | `PackIdentityPopover.tsx` ~line 45: add `title` attribute or help line under the label |

---

## Workflow 3 — Skin Pack "all vehicles, all factions"

### User path observed
Home → "New Skin Pack" → skin editor loads with OstHeer selected, 10 vehicles in the bottom rail. "Edit texture" button visible. Title pill has error state (live sync failed because empty project).

| # | Friction / Issue | Severity | PS User Expects | Concrete Fix Sketch |
|---|---|---|---|---|
| **S1** | **The "Apply camo to all vehicles" scope selector is COMPLETELY UNREACHABLE** — `CamoPanel` in `TopBar.tsx` contains the scope toggle ("This vehicle only" / "Every [faction] vehicle" / "All 80 vehicles") but `setActivePanel('camo')` is never called from any button, keyboard shortcut, or menu in the current build. The `GenerateButton` that previously opened this panel was removed. The feature exists in code but is a dead end. | **P0 BLOCKER** | A clearly labelled "Apply Scope" button or panel in the toolbar; PS equivalent: "Apply to all layers" | `Editor.tsx`: add a button to the bottom toolbar or right-side HUD that calls `setActivePanel('camo')`. The `CamoPanel` is fully functional — it just has no UI entry point. File: `Editor.tsx` ~line 1782 (bottom toolbar area) |
| S2 | **Live sync error on empty projects is invisible** — a new skin pack immediately shows an error icon in the title pill (because no vehicles have decals/template), but the reason "Project has no vehicles with decals or a chosen template" is only in the tooltip. A maker thinks something is broken. | P1 | A visible help message below the error icon, or an inline prompt in the editor: "Add a template or decal to enable live sync" | Show the sync error reason as visible text when `syncState === 'error'` in the skin editor's title area. `mod-export.ts` line 530 is the error source. |
| S3 | **No indication that unvisited vehicles are covered by faction-defaults** — the VehicleMenu shows all 10 vehicles but there's no visual marker on "covered by faction default" vehicles vs "has a vehicle-specific override". A maker doesn't know if visiting only one tank and setting a texture is enough to cover all tanks in the faction. | P1 | Visual indicator on covered vehicles; PS: "linked smart object" indicator | `VehicleMenu.tsx`: add a small colored dot or checkmark on vehicle pills where `factionDefaults[faction].camoPreset !== null` (or `customDiffuseUrl !== null`), indicating "covered by faction default". |
| S4 | **Faction switching is via the left faction buttons but this is not labeled** — 5 faction icons appear in a left vertical HUD. A new user doesn't know clicking a faction icon switches the entire vehicle roster. No label or tooltip explains that these switch factions. | P1 | A "Faction" label above the button cluster | `FactionPanel` component (referenced in `Editor.tsx` line 1776): verify it has a tooltip/aria-label; ensure the active faction is clearly highlighted with a "YOU ARE HERE" affordance. |
| S5 | **No "View all factions" overview screen** — to see how a livery looks on all 5 factions, a maker must manually click each faction and mentally track. There's no side-by-side or gallery view. | P2 | A "Preview all factions" panel or thumbnail strip | Future feature: add a split-view or faction thumbnail row below the 3D viewport |
| S6 | **"Edit texture" implies paint-only** — the button that opens the full texture editor is labelled "Edit texture" but actually provides brush/draw tools. A Photoshop user would expect "Import image" or "Replace diffuse" — the ability to paste a PSD-exported PNG is present but not surfaced as the primary CTA. | P2 | "Import / paint texture" with a drag-drop target | Rename or add subtitle: "Edit texture — paint or import a PNG" |

---

## Probe: Publish-to-Workshop Flow

| # | Issue | Severity | Expected | Fix |
|---|---|---|---|---|
| P1 | **Publish is triggered by clicking a Visibility option, not a "Publish" button** — in all three editors, the PackIdentityPopover shows "VISIBILITY: Unlisted / Private / Friends only / Public" and clicking one immediately starts the SGA build + Workshop upload. There is no intermediate "Publish" or "Build & Publish" button. A maker who just wants to set visibility without publishing gets no warning. | **P0 BLOCKER** | "Publish" button (labeled) that then shows visibility choice; or a section label making the action crystal-clear: "Click to publish at this visibility" | `PublishSection.tsx` ~line 447: change the `FieldGroup` label from "Visibility" (when idle) to "Publish at visibility →" or add a line below the selector: "Clicking a visibility will build and upload your pack to Steam Workshop." |
| P2 | **No upload progress indicator** — during the build + SGA export + Steam upload sequence, the only feedback is the selector becoming disabled and the label changing to "Building…" / "Uploading…". A long upload (38 MB skin pack) could take 30+ seconds with no progress bar, byte counter, or ETA. The maker may think it silently failed (`EResultBusy` during Steam Cloud race). | P1 | Progress bar or byte-sent counter during upload | `PublishSection.tsx`: intercept `isBuildingTarget` and `uploading` phases to show an animated progress indicator. Steam's `ISteamRemoteStorage` API doesn't provide byte-level progress (callback-only), but at minimum show an animated spinner with estimated phase labels: "Building SGA… / Writing files… / Uploading to Steam…" |
| P3 | **No "published" success state in the popover** — after a successful publish, the dialog closes immediately (via `handleClose()`) with no confirmation. The maker doesn't see "View on Workshop ↗" link or the assigned workshopId. `PublishToWorkshopDialog.tsx` has a `SuccessView` but `PublishSection.tsx` does not — it just calls `setPhase({kind: 'idle'})` and closes. | P1 | "Published! View on Workshop ↗" confirmation state | `PublishSection.tsx` ~line 333: add a `success` phase that shows the workshopId link, mirrors `SuccessView` from `PublishToWorkshopDialog.tsx` |
| P4 | **Workshop "visibility" default is Unlisted** — the first option is Unlisted, which is the safest default but also the option that makes a newly-published pack discoverable by almost no one. The UI shows four options left-to-right (Unlisted → Private → Friends only → Public) but the default pre-selection and positioning of "Unlisted" as first / leftmost may confuse makers who expect "Public" as the intended action. | P2 | Consider making "Public" the pre-selected option, or adding a brief note: "Unlisted = not searchable but accessible via direct link" | `PublishSection.tsx` ~line 125: add `title` attributes to each visibility option explaining what it means in CoH2 Workshop context |

---

## Save / Sync / Publish State Clarity

| Concept | Current Indicator | Problem | Fix |
|---|---|---|---|
| **Saved** (local storage) | `saveIndicator` ("Saved" text fades in for 2s after auto-save) in skin editor | Fade-in text is easily missed; not present in decal/faceplate editors at all | Add consistent "Saved" micro-indicator to all three editors |
| **Synced** (live-sync to mod folder) | `StateIcon` in title pill (CheckCircle2) + `title` attribute tooltip | Icon is 15px and tooltip-only; no persistent text | When synced: add "● Synced" text beside or below pill, fading after 5s |
| **Published** (Workshop) | No indicator in editor | A maker has no way to know from within the editor if the current project is on the Workshop without opening the popover | Add a "☁ Published" chip near the title pill for projects with a real workshopId |

---

## TOP 8 UX Fixes Ranked by Impact

| Rank | Issue | Severity | File / Location |
|---|---|---|---|
| **1** | **Camo scope panel unreachable** — `setActivePanel('camo')` never called; "All 80 vehicles" scope unavailable | **P0** | `Editor.tsx` ~1782, `TopBar.tsx` CamoPanel |
| **2** | **Publish trigger is clicking a Visibility chip** — zero label; makers accidentally publish or fail to publish because the affordance is opaque | **P0** | `PublishSection.tsx` ~447 |
| **3** | **Faction override mode has no visible state** — switching from ALL to OstHeer shows no context label or "editing faction override" banner | **P0** | `DecalPackEditor.tsx` ~2200, `FactionRow.tsx` |
| **4** | **Text click-to-place broken in faceplate editor** — clicking canvas in Text mode creates no layer | P0 (known) | `FaceplateEditor.tsx` ~1276 |
| **5** | **Live sync status is tooltip-only** — error states especially are invisible without hover; skin editor starts in error state (empty project) with no inline explanation | P1 | `EditorTitlePill.tsx`, `LiveSyncBadge.tsx` |
| **6** | **No upload progress feedback** — 30+ second uploads appear frozen; maker can't tell if EResultBusy silently failed | P1 | `PublishSection.tsx` build/upload phases |
| **7** | **No "covered by faction default" indicator on vehicle rail** — makers don't know which tanks are already covered by the all-scope camo without visiting each one | P1 | `VehicleMenu.tsx` |
| **8** | **No publish success confirmation** — after Workshop upload, the popover closes instantly with no "View on Workshop ↗" link or workshopId display | P1 | `PublishSection.tsx` success phase |

---

## Confirmation of the 4 Pre-Flagged Issues

### 1. publish-no-progress (CONFIRMED + EXPANDED)
Confirmed P1: during build+upload (which can take 30-60s for a 38MB skin SGA), the only feedback is disabled selector + "Building…" / "Uploading…" label text. No byte counter, no progress bar, no ETA. Steam's IPC API is callback-only so exact byte progress isn't natively available, but phase labels (Building SGA / Writing temp files / Uploading to Steam / Done) would substantially reduce maker anxiety. The `EResultBusy` race condition noted in the coordinator's flag is real: if Steam Cloud sync is in progress when the upload starts, the Steamworks API may return a transient error that the current code surfaces as a red error banner — with no retry affordance.

### 2. all-scope-non-obvious (CONFIRMED + CRITICAL)
Confirmed **P0 regression** (stronger than pre-flagged): the CamoPanel with the scope selector ("This vehicle / Every [faction] vehicle / All 80 vehicles") is *completely inaccessible* in the current build. `setActivePanel('camo')` is never called from any button or keyboard shortcut. The GenerateButton that previously triggered it was removed (commit 4431b69 "removed the AI generate features") without preserving a replacement entry point. The CamoPanel code is intact and fully functional; it simply has no reachable UI trigger. The factionDefaults mechanism works (Honvéd Camo was authored this way via sub-agent that called the API directly), but a human maker cannot discover or use it from the UI.

### 3. save/sync/publish fuzzy (CONFIRMED + EXPANDED)
Three distinct concepts — local save (localStorage), live sync (mod folder write), and Workshop publish — are collapsed into a single title-pill icon. The save indicator ("Saved" text) only exists in the skin editor and fades in 2s. Live sync status is a 15px icon with a tooltip. Workshop publish status has no ambient indicator at all (no "Published" badge on the editor). A maker who asks "did my edit go to the Workshop?" has no answer without opening the title popover, scrolling to the Visibility section, and reasoning about which visibility option is highlighted.

### 4. decal part×faction opaque (CONFIRMED + EXPANDED)
Confirmed P0→P1: the part × faction matrix is discoverable (there's a "Show parts × factions" link) but the semantic model is never explained. Specifically:
- What "Shared (ALL)" means vs a faction override is not labeled anywhere in the UI
- Fork-on-write semantics (first edit in a faction tab silently copies shared layers into an override) are invisible
- The matrix grid shows layer counts per cell but doesn't distinguish between "inherited from shared" (count = shared count, no dot) and "has its own override" (dot + override count) in a way that's obvious without reading the code
- No bulk-copy action exists to propagate shared layers to all 5 factions at once
