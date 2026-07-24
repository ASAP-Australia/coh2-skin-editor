# Master campaign — finish editors + author themed packs (2026-06-15, dynamic /loop)

## MAKER-UX PASS (2026-06-16, after user asked "any UX issues making them?")
Hands-on maker-workflow audit (MAKER-UX-AUDIT.md) found 8 real issues. ALL FIXED + live-verified,
suite 2037/2037, building+deploying:
- P0 CAMO SCOPE PANEL was DEAD CODE (setActivePanel('camo') never called) → a user couldn't apply
  a livery to all vehicles from the UI at all. Wired "Apply Livery…" button (Editor.tsx 1827) → scope
  panel (This vehicle / Every <faction> / All 80 vehicles). [Critical for the "all vehicles" req.]
- P0 PUBLISH UX: chips silently published → now explicit "Publish to Workshop" button + phase feedback
  + success state (workshopId + "View on Workshop ↗") + friendly EResultBusy "Steam still syncing".
- P0 DECAL FACTION-OVERRIDE: silent mode switch → context banner + "Copy shared → all factions".
- P0 text click-to-place: audit was STALE — verified working.
- P1: sync-status now a readable label (Saved·Synced / Syncing… / Sync error); "covered by faction
  default" green dot on vehicles; save/sync/publish vocabulary disambiguated.

## ✅✅ CAMPAIGN COMPLETE (2026-06-16 04:35). Loop stopped. Final build deployed, 2037/2037 green.
Editor finished (PS-parity A/B/C, dark-glass floating panels, rationalized toolbar, borderless
canvas+red OOB+guide). 3 Honvéd packs authored in-app, mod-folder synced + Workshop published
(decal 3745473462, faceplate 3745473621, skin 3745489011), updatable, in-game [Sig:0]. Editor bugs
fixed; PropertiesPanel regression fixed. Projects editable from deployed app (shared userData).
Optional follow-ups left: wire downloadDecalPack to a UI button; artwork crispness; signed-skin
rebuild (unsigned already loads [Sig:0]).


User directive: finish the editor to Photoshop parity (dark-glass, simple, user-friendly); make
decal/faceplate/texture editors consistent; then USE the app to author my own themed packs that
work across factions (+ all vehicles for skins), auto-sync to Workshop + mod folder, updatable on
edit; fix UX/design + errors as I go. Central historical theme: HUNGARIAN / Axis co-belligerent
("Honvéd") — Hungarians for the Wehrmacht as the anchor, historically-plausible per-faction flavor.
Design principles: DARK GLASS, simplicity, user-friendliness.

## Phase 1 — Finish the editors (Photoshop parity + UX) [IN PROGRESS]
Source of truth: artifacts/respec_audit/PS-PARITY-AUDIT.md (ranked gaps), PS-PARITY-CAMPAIGN.md.
Live dev loop: electron:dev (vite HMR + CDP :9222), coordinator reads screenshots.
- Batch A: P0 text click-to-place; P0 layers opacity "10" clip; banner vertical centering;
  Shift=aspect-lock (scale); Shift=15° rotate-snap.
- Batch B: tool-letter shortcuts V/T/B/E/I/S + Ctrl+G group (+ F1 overlay truthful); shift-click
  range-select in layers; Alt-drag duplicate.
- Batch C: shape corner radius; brush hardness; align distribute + align-to-selection.
- Then: DECAL editor + TEXTURE(skin) editor onto the same dark-glass LayersPanel/PropertiesPanel +
  parity; consistent across all three.
- Milestone: full vitest + tsc green; build + deploy.

## Phase 2 — Author themed content via the app (CDP)
Theme: Royal Hungarian Army (Honvéd) + minor co-belligerents. Markings: Hungarian cross/chevron,
green-white-red, period-correct unit insignia. Keep each pack self-consistent + dark-glass-tasteful.
- Decal pack "Honvéd" — works for all 5 factions (one RGD/faction).
- Faceplate "Honvéd" — works for all factions.
- Skin/texture pack — all factions, all vehicles (faction/all-scope diffuse so unvisited vehicles
  are included — uses the R2 MAJOR-2 export-completeness fix).

## Phase 3 — Sync + in-game verify + updatability
- Each pack auto-syncs to mod folder (live-sync) + publishes to Workshop; visibility preserved;
  updatable on re-edit (the live-sync update path + workshopVisibility fix).
- In-game [Sig:0] for decal + faceplate + skin; zero warnings.log failures.
- Fix every error encountered; bank evidence.

## Constraints / pacing
- Caps recur — single Sonnet agents, NO big workflows; bank state every tick; ScheduleWakeup
  auto-resumes across caps. Coordinator (me) stays lean, delegates.
- Export byte-identical (golden tests); don't touch sga-writer byte logic. No commits.
- Dev-server lifecycle: only manage coh2-skin-editor processes, NEVER claude-desktop.

## Phase 2 THEME (locked 2026-06-15)
Magyar Királyi Honvédség (Royal Hungarian Army) — WWII Axis co-belligerent, anchor = Wehrmacht.
One coherent theme across all factions (simplicity). Markings (period-correct, geometric):
- White Hungarian vehicle CROSS (1942–45 national AFV marking).
- Green-white-red national SHIELD/roundel.
- Air-ID CHEVRON.
- Three-tone Hungarian CAMO (dark green / red-brown / sand) for skins.
Author IN-APP with editor tools (shapes/text/import) to also stress-test the editor + fix issues
found. Packs: "Honvéd Markings" decal (all factions), "Honvéd" faceplate (all factions), Honvéd
skin pack (all factions/vehicles via faction/all-scope diffuse). Each: auto-sync mod folder +
Workshop publish + updatable + in-game [Sig:0]. Dark-glass, simple, user-friendly.
Sub-agents AUTHORIZED for Phase 2 (user confirmed 2026-06-15).

## Progress
- Phase 1 EDITOR COMPLETE + DEPLOYED 23:15 (tsc clean, 2037 tests). Faceplate parity A/B/C done;
  toolbar rationalized (Shadow/BG/Align → Properties, Eraser promoted, comment at FaceplateEditor:156);
  canvas borderless + red OOB + guide bg. User was on a stale build → all now shipped.
- Phase 2 DECAL DONE: "Honvéd Markings" authored in-app (cross/tricolor shield/chevron), auto-synced
  to mods/decals/subscriptions/c31f5300...sga (24KB). Recognizable; tricolor narrow at thumbnail →
  polish later. NOT yet published to Workshop. Editor bugs logged: React key-in-spread warning,
  setState-during-render in DecalPackEditor (~line 232-240) — fix in a later tick.
- Phase 2 FACEPLATE DONE: "Honvéd" banner authored in-app (tricolor stripe + white cross crest +
  HONVÉD title/subtitle), auto-synced to mods/faceplates/subscriptions/079246...sga (15KB, valid v7,
  icon sub-rect populated). NOT yet Workshop-published.
- ⚠️ DEV-SERVER STALENESS: faceplate agent reported the running dev UI predates the toolbar IA change
  (orphaned Shadow/BG/Align) though source is correct → dev server serving a stale bundle. NEXT TICK:
  cleanly KILL + relaunch electron:dev from current source (only coh2 procs, never claude-desktop)
  and confirm the toolbar shows the new tool row before authoring.
- Phase 2 SKIN DONE: "Honvéd Camo" (3-tone Hungarian camo) applied to all 5 factions' factionDefaults
  (camoPreset+customDiffuseUrl), auto-synced unsigned to mods/skins/2766831464216004.sga (38.9MB,
  60 RGT = 30 veh × 2 seasons). Export-completeness (R2 MAJOR-2) CONFIRMED (unvisited included).
  30/47 vehicles (17 are uninstalled DLC/XP). Dev restart cleared staleness (toolbar confirmed new).
  Agent fixed dev fetchTemplate protocol guard (mod-export.ts).
- ALL 3 PACKS authored + mod-folder synced. Editor bugs still logged: React key-in-spread,
  setState-during-render (DecalPackEditor), template not bundled in dev (signed-publish needs deployed
  build or template in dev).
- ✅ PHASE 2 CORE COMPLETE (verified 2026-06-16 ~02:30): all 3 Honvéd packs PUBLISHED to Workshop
  (Private, real workshopIds: decal 3745473462, faceplate 3745473621, skin 3745489011), readback ✓,
  UPDATABLE ✓ (same id updated, visibility preserved), IN-GAME [Sig:0] ✓ all 3 (CoH2 launched, zero
  failures). Skin published UNSIGNED — CoH2 accepts unsigned [Sig:0] (loads for everyone). Whole
  user directive substantially achieved.

## Remaining POLISH tail (loop continues)
- ⚠️ DEV/DEPLOYED STORAGE SPLIT: the 3 projects live in the DEV app's storage; the user opens the
  DEPLOYED taskbar app (separate userData) → won't see them to edit/update. FIX: migrate project
  data (localStorage/IndexedDB) dev→deployed, OR re-point. Most important for "edit them in the app".
- Skin signing belt-and-suspenders: sign from deployed build (bundles template_0001.sga) or
  tools/patch-signed-pack.mts — unsigned already loads [Sig:0] so low priority.
- Fix logged editor bugs: React key-in-JSX-spread warning; setState-during-render in DecalPackEditor.
- Artwork polish: tricolor shield crisper at thumbnail; camo refinement.
- Deploy working tree (has dev fetchTemplate fix + any polish) once polish lands.
- ✅ STORAGE GAP = NON-ISSUE: dev + deployed AppImage share ~/.config/coh2-skin-editor/Local Storage
  (same app name, no setPath override) → the 3 Honvéd projects ARE editable from the deployed taskbar
  app. No migration needed.
- ✅ Editor bugs fixed: React key-in-spread (FaceplateEditor shape layers ~2241/2318/2333/2353);
  DecalPackEditor nav-persist bypassing history.mutate (line 232) → now persists correctly.
- ⚠️ TEST REGRESSION: suite now 2036/2037 — "PropertiesPanel > shows properties when a layer is
  selected" FAILS (regressed after the 23:15 green build, from a later edit). MUST fix before deploy.
- NEXT (likely final): fix that PropertiesPanel test → full green → build+deploy clean tree → wind
  down loop (core directive done + verified; this is the closing polish). Optional: wire
  downloadDecalPack to a UI button (export/import robustness); artwork crispness.
- Phase 1 audit done (17 screenshots, ranked list).
- Batch A DONE (live-verified): text click-to-place works (Stage pointerEvents:none in text mode);
  opacity input widened to 44px (shows 100); banner vertical-centered (386≈386px); Shift=aspect-lock
  (Konva built-in shiftBehavior); Shift=15° rotate-snap ADDED (isShiftHeld → rotationSnaps). tsc clean.
- Batch B DONE (live-verified, suite 2021): tool shortcuts V/B/E/I/S; Ctrl+G/Ctrl+Shift+G group/ungroup;
  truthful F1 overlay; shift-click range-select; Alt-drag duplicate. tsc clean. Tests in ps-parity-fixB.
- Batch C DONE (live-verified): shape corner radius (preview+export, golden green); brush hardness/
  feathering; align distribute + align-to-selection (CVS/SEL toggle). tsc clean, ps-parity-fixC tests.
  → FACEPLATE editor parity complete across the audit list.
- NEXT: bring DECAL editor onto shared dark-glass LayersPanel/PropertiesPanel + parity (mirror the
  faceplate). Then TEXTURE(skin) editor. Then Phase-1 MILESTONE: full `npx vitest run` + build+deploy.
  Then Phase 2 authoring (Honvéd theme). Dev server (CDP :9222) UP. Faceplate parity batches A/B/C done.
