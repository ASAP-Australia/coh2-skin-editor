# Release Review 2 — Non-Konva Pipelines
*Date: 2026-06-14. Scope: focus areas 1–6 as specified. Read-only, conservative.*

---

## Summary

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| MAJOR    | 3     |
| MINOR    | 3     |

Reviewed: mod-export.ts, rgt-writer.ts, live-sync.ts, Editor.tsx (template/diffuse/onModelLoaded), TemplateDecalPills.tsx, faceplate-mod-build.ts, electron/steam.ts, electron/preload.ts, SavedProjectsList.tsx, PublishSection.tsx, App.tsx, project.ts, faceplate-project.ts, decal-pack-project.ts.

---

## Findings

### MAJOR-1 — Live Sync Workshop auto-update silently demotes visibility to Unlisted

**Files:** `src/lib/live-sync.ts:607`, `electron/steam.ts:566-571`

**Problem:**
Every live-sync Workshop auto-update (`_doWorkshopUpdate`) hard-codes `visibility: 3 as const` (Unlisted) in the update payload (live-sync.ts:607). `electron/steam.ts:updateWorkshopItem` always sends `visibility: input.visibility ?? 0` to `client.workshop.updateItem()`, which is an ISteamUGC metadata write that **does** change the Workshop item's visibility on Steam.

Consequence: a user who published a skin/faceplate/decal pack as **Public** (visibility 0) then makes any edit triggers a live-sync auto-update that silently changes the Workshop listing to Unlisted. The next time they open the Workshop page, their formerly-public item is gone from the public feed — with no notification.

The comment at live-sync.ts:602 acknowledges this is a "safe default" but doesn't acknowledge that the visibility field is actually applied by the Steam API call (not just passed through unchanged). The `updateItem` in steam.ts clearly sets `visibility` from `input.visibility` every call.

Faceplate and decal-pack projects do persist `workshopVisibility` (faceplate-project.ts:465, decal-pack-project.ts:264), but live-sync.ts never reads it. Skin projects have no `workshopVisibility` field at all.

**Confidence:** 90%. Code-confirmable. The IPC path live-sync → updateWorkshopItem → ISteamUGC.updateItem with explicit visibility=3 is unambiguous. Needs-live to confirm the Steam API actually changes visibility vs. treating omission as "no-op".

**Fix (two options):**
1. **Preferred:** Read the project's `workshopVisibility` if present, default to 3 (unlisted) only for unpersisted cases. For skin projects, add the `workshopVisibility` field (mirroring faceplate/decal-pack) and wire `onPublished` in TopBar.tsx's `PublishSection`.
2. **Minimal safe fix:** Omit the `visibility` field from the live-sync update payload entirely. Change `_doWorkshopUpdate` to not include `visibility` in the `input` object. Then change `updateWorkshopItem` to only set `details.visibility` when `input.visibility !== undefined`. This is the safest no-regression approach because the Steam API treats an absent visibility field as "don't change".

---

### MAJOR-2 — Faction-scope custom diffuse silently excluded from export for unvisited vehicles

**Files:** `src/lib/mod-export.ts:569-571`, `src/components/Editor.tsx:811-814`

**Problem:**
When the user applies a custom diffuse image at **'faction' scope** (Editor.tsx:811), only `project.factionDefaults[faction].customDiffuseUrl` is updated. The export pipeline (mod-export.ts:569) iterates `Object.keys(project.vehicles)` — vehicles the user has never navigated to have no entry in this record and are invisible to the exporter.

The editor preview correctly shows faction-default diffuse on any vehicle via `effectiveCustomDiffuseUrl` (project.ts:499-507), which checks both the per-vehicle override AND the faction default. The exporter (`composeVehicleDiffuse`, line 168) only checks `veh.customDiffuseUrl` on the per-vehicle record, never the faction default.

The same gap applies for **'all' scope** (Editor.tsx:798-809): it sets all factionDefaults AND clears per-vehicle `customDiffuseUrl` to null (line 808) for already-visited vehicles, which makes those existing vehicle entries pass the `!veh.customDiffuseUrl` check (line 168) and return null. Wait — actually for 'all' scope, vehicles in `project.vehicles` would have `customDiffuseUrl = null` AND `veh.decals.length` would still be whatever it was. If they have no decals and customDiffuseUrl is null, they'd be excluded. Only the current vehicle would be included if previously visited with decals.

**Scope of impact:** Affects users who:
1. Apply a camo image at faction scope (from the Generate modal or image apply with 'faction' scope), then
2. Export without having visited every vehicle in that faction.

The more common 'vehicle' scope is unaffected (it writes directly to `project.vehicles[currentId].customDiffuseUrl`).

**Confidence:** 80%. Code path is unambiguous. Impact depends on how many users apply faction-scope diffuse without visiting every vehicle. Live verification would confirm the in-game symptom (some vehicles use vanilla skin, others use custom diffuse).

**Fix:** In `composeVehicleDiffuse` and the vehicle-ID filter loops in `exportSkinPack`/`patchExport`, use `effectiveCustomDiffuseUrl` (from project.ts) instead of `veh?.customDiffuseUrl`. Additionally, the vehicle-ID collection needs to include vehicles that only have a faction-default diffuse — this requires iterating the VEHICLES catalog filtered by faction (using `factionDefaults` keys), not just `project.vehicles`.

---

### MAJOR-3 — Skin pack `workshopVisibility` not persisted; `onPublished` not wired in TopBar

**Files:** `src/components/TopBar.tsx:290-300`, `src/lib/project.ts` (Coh2SkinProject type)

**Problem:**
`PublishSection` accepts an `onPublished?: (visibility: 0|1|2|3) => void` callback (PublishSection.tsx:55). FaceplateEditor (line 2330) and DecalPackEditor (line 2185) both pass this callback to persist `workshopVisibility` into their project types after a successful publish. The skin pack's `PublishSection` instance in TopBar.tsx (line 290-300) does **not** pass `onPublished`, and `Coh2SkinProject` has no `workshopVisibility` field.

Consequence:
1. Re-opening the skin pack's publish popover always shows the default (Unlisted) visibility selector regardless of what the user previously published at.
2. The live-sync Workshop auto-update (MAJOR-1) has no persisted visibility to read, so cannot be fixed without first fixing this gap.

This is an asymmetry between the three project types: faceplate and decal-pack correctly persist and restore the selected visibility; skin packs do not.

**Confidence:** 99%. Code-confirmable. No live verification needed.

**Fix:**
1. Add `workshopVisibility?: 0|1|2|3` to `Coh2SkinProject` in project.ts.
2. In TopBar.tsx, pass `onPublished={(visibility) => { const next = { ...p.project, workshopVisibility: visibility }; p.setProject(next); persistActive(next) }}` to the `PublishSection`.
3. Pass `initialVisibility={p.project.workshopVisibility}` to `PublishSection` as well.

---

### MINOR-1 — SSR snapshot missing `workshopSync` field (type-unsafe cast)

**File:** `src/lib/live-sync.ts:1495-1504`

**Problem:**
`SSR_SNAPSHOT` (line 1495) is type-cast with `as LiveSyncSnapshot` but omits the required `workshopSync: WorkshopSyncStatus` field. The TypeScript cast bypasses the structural check. If any code reads `snapshot.workshopSync` in an SSR context, it would get `undefined` and crash.

In practice, `LiveSyncBadge.tsx:144` defensively guards with `sync.workshopSync ?? { state: 'idle' as const, reason: '' }`, and this is an Electron app (no true SSR). So there's no runtime regression, but the type-cast is technically lying about the shape.

**Confidence:** 99%. Code-only. No runtime impact given Electron-only deployment.

**Fix:** Add `workshopSync: { state: 'idle' as const, reason: '' }` to `SSR_SNAPSHOT`.

---

### MINOR-2 — `rewriteGuid` in mod-export.ts does not advance past matched sequence correctly on repeated GUIDs

**File:** `src/lib/mod-export.ts:290-305`

**Problem:**
`rewriteGuid` (line 290) advances `i += newBytes.length` after a match (line 301). Since both old and new are 32 hex chars (same length), this is equivalent to `i += 32` which is correct. However, the loop condition is `i <= out.length - oldBytes.length` and uses `continue outer` which increments `i++` (not `i += 32`) on a non-match. The logic is correct but the naming `i++; continue outer` on a mismatch (line 300) could be confused for "advance one byte on match" when reading quickly. Not a bug — just a readability concern.

Actually after reviewing the loop structure more carefully: the label `outer: while` plus `i++; continue outer` on mismatch is correct. On match: `i += newBytes.length` then falls through to the loop's next iteration which re-checks the condition. This is functionally identical to the faceplate-mod-build.ts `substituteAsciiGuid` which uses the same pattern. **Not a real bug.**

Revising this to MINOR-3 and noting the correct finding below.

---

### MINOR-2 (revised) — `effectiveCustomDiffuseUrl` fallback missing in `composeVehicleDiffuse` fast-path

**File:** `src/lib/mod-export.ts:178-188`

**Problem:**
In the `customDiffuseUrl` fast path (line 179), `composeVehicleDiffuse` reads `veh.customDiffuseUrl` directly (line 178) rather than through `effectiveCustomDiffuseUrl`. This is the inner rendering code; the outer vehicle-ID filter at lines 570-572 has the same direct-read pattern. Both miss faction-default diffuse URLs. This duplicates and reinforces the MAJOR-2 finding at the implementation level.

**Confidence:** 95%. Code-only.

---

### MINOR-3 — Faceplate icon sub-rect (624,0,64,64) in live-sync renders to wrong position

**File:** `src/lib/live-sync.ts:1076-1108`

**Problem:**
`renderFaceplateAtlas` draws the icon at `ctx.drawImage(img, 624, 0, 64, 64)` (line 1093). This is correct per `faceplate-templates.ts:ICON_RECT = {x:624, y:0, width:64, height:64}`. The ATLAS dimensions are 692×204. The canvas is created at `canvas.width = width; canvas.height = height` where `width = ATLAS_WIDTH = 692` and `height = ATLAS_HEIGHT = 204` (via `importFaceplateBuilder`).

The implementation is **correct** — this was my concern to check, not a real bug. The banner occupies (0,0)→(624,204), the icon occupies (624,0)→(688,64), dead space fills the remaining 4 columns (688-692) and 140 rows (64-204). This matches `faceplate-mod-build.ts:wrapBc3InDds` which encodes the full 692×204 BC3.

**Conclusion: No bug.** The faceplate build is correct against the in-game-verified 6-file layout.

---

## Area Assessments

### Focus Area 1 — Skin export + RGT format (mod-export.ts, rgt-writer.ts)

**Clean** with one exception (MAJOR-2).

- BC3/BC1 format scoping: correct. `patchExport` always uses `{format:'bc3', compress:false, fbif:false}` (line 502). `exportSkinPack` uses the default (`canvasToRgt` with no options) which applies `bc1`/`compress:true`/`fbif:true` — correct for unsigned packs.
- FBIF suppression on signed path: correctly handled. `fbif:false` is set in `patchExport`; `fbif:true` (default) in `exportSkinPack`. The 4,194,736-byte target (BC3 raw=4,194,304 + 432 bytes chunky overhead) is consistent with the manifest entry-length check at line 512.
- R5 gate (`customDiffuseUrl` gate): works for the per-vehicle case. The faction-default diffuse case is broken (MAJOR-2).
- Vehicle inclusion/exclusion logic: correct for common case. No vehicle is wrongly included; the risk is silent exclusion (MAJOR-2).

### Focus Area 2 — live-sync.ts

**Three issues found** (MAJOR-1, MAJOR-3, MINOR-1).

- Unsigned-fallback try/catch: correctly degrades from `patchExport` → `exportSkinPack` on failure (line 735-749). `stableNumericId` is correctly passed to both paths. `stableModGuid` is intentionally NOT passed (unsigned path generates a fresh random GUID per save, which is fine since CoH2 re-reads SGA on load and the filename is stable).
- `hasSigningKeys` vs template-present: correctly decoupled. `hasSigningKeys()` only checks for `keys/manifest.json`, independent of `resolveTemplateSgaPath()`.
- Double-write risk: none found. The in-flight guard (`_inFlight`) and queuing prevent overlapping writes. The mods path resolves to the same directory every call.
- Wrong dest path/id: filename is always `stableNumericId` derived from project id (deterministic). Correct for skin-type (`mods/skins/`), decal-type (`mods/decals/subscriptions/`), faceplate-type (`mods/faceplates/subscriptions/`).

### Focus Area 3 — Template/decal T1a (Editor.tsx, TemplateDecalPills.tsx)

**Clean.**

- `effectiveCustomDiffuseUrl` is correctly used in `onModelLoaded` (Editor.tsx:1540) to restore the painted diffuse on vehicle switch.
- `filterEnvsBySeason([...SKYBOX_ENVS], 'summer')[0]` initializes `envName` to a summer sky (line 228-229) — F2a fix confirmed present.
- Template application in `applyTemplate`: correctly stores `template` ref on the project (line 289, 373-378) and triggers async diffuse bake for stock/workshop.
- TemplateDecalPills faction filter: `listStockSkins().filter(s => s.factionId === faction)` correctly scopes to current faction. Workshop items are pre-fetched per faction via `listWorkshopSkinsForFaction`. Decal-pack filter correctly has NO faction filter (confirmed correct per comment: decals are faction-universal).
- Template included in unsigned export: `project.template` is metadata only (not a separate SGA file). The diffuse baked via `fetchStockDiffuse`/`fetchWorkshopDiffuse` lands in `veh.customDiffuseUrl`, which is then included in the export via the R5 gate. Correct.
- `edit-texture` target for templates: `effectiveCustomDiffuseUrl` on `onModelLoaded` (line 1540) correctly draws from the vehicle+faction merged view. No wrong-source issue found.

### Focus Area 4 — Faceplate build (faceplate-mod-build.ts)

**Clean.**

- 6-file layout verified: `attrib/faceplate/${slug}_faceplate.rgd`, `english/english.ucs`, `${guid}.info`, `${slug}.dds` (root preview), `ui/assets/textures/${guid}_i1.dds`, `ui/bin/${guid}.gfx`. All six files present (lines 154-185).
- 692×204 atlas: `ATLAS_WIDTH=692`, `ATLAS_HEIGHT=204` from faceplate-templates.ts. Verified correct.
- Icon sub-rect `(624,0,64,64)`: matches `ICON_RECT` constant and the GFX template's DefineBitsLossless2 matrix verified from 3 reference mods.
- `wrapBc3InDds` header: correct DDS_HEADER (124 bytes), DDPF_FOURCC, DXT5 fourCC, caps1=TEXTURE.
- `patchRgd`: applies ASCII GUID substitution, UTF-16-LE GUID substitution, and pbgid patch at offset 64 — matches documented RGD layout.
- Post-build `assertSgaParses`: correctly round-trips SGA through `SgaArchive.open` before returning. Any TOC corruption would surface before the caller can use it. Clean.

### Focus Area 5 — Workshop (electron/steam.ts, preload.ts, SavedProjectsList.tsx, PublishSection.tsx)

**Two issues** (MAJOR-1, MAJOR-3). Visibility of correctly-clean areas:

- `deletePublishedItem` reachability: `workshop.delete` is correctly wired in preload.ts:338, main.ts:660, and steam.ts:712 with the `requireNativeAddon()` call. The native addon `index.js` correctly tries the prebuilt binary first, then falls back to dev build. `deletePublishedItem` is declared in `index.d.ts` and corresponds to the C++ export. No shadowing issue found.
- `isRealWorkshopId` gating: consistent across all call sites. Three independent implementations (PublishSection.tsx:74, PublishToWorkshopDialog.tsx:84, live-sync.ts:1310, SavedProjectsList.tsx:140) all use the same 5e9 threshold; SavedProjectsList uses BigInt version. Consistent.
- `workshopId` persistence on publish: for skin (TopBar.tsx:198-201), `onPublished` writes `workshopId` to the project. For faceplate and decal-pack, the same via their editors. All three types persist `workshopId` correctly after first publish.
- Stale-state display after Workshop delete: `SavedProjectsList` bumps `refreshNonce` after `clearSkinWorkshopId`/etc., which forces `getRealWorkshopId` to re-read localStorage. The Workshop delete button correctly disappears post-delete.
- Pile-up guard (`findMyMatchingWorkshopItem`): present in both `PublishSection` (line 321) and `PublishToWorkshopDialog` (line 253). Correct.

### Focus Area 6 — Loading/persistence (App.tsx, project.ts, faceplate-project.ts, decal-pack-project.ts)

**Clean.**

- App.tsx phase machinery: `probing → connect → start → editor-loading → editor` correctly implemented. No artificial delays — `setPhase('editor')` fires from `onReady` callback (line 417-419), which fires from `onModelLoaded` on the first model. No blocking parse in the phase path.
- Metadata-only list: `listAllSkinProjects` uses the index (`INDEX_KEY`) with lazy backfill. Same pattern in `listAllFaceplates` and `listAllDecalPacks`. Parse-free for already-indexed projects.
- Index staleness on delete: `removeRecentProject` calls `removeSkinIndexEntry` (project.ts:838). `removeRecentFaceplate` calls `removeFaceplateIndexEntry` (faceplate-project.ts:1097). `removeRecentDecalPack` calls `removeDecalPackIndexEntry`. All three clean.
- Index staleness on rename: `persistActive` calls `upsertSkinIndexEntry` with current `packName` (project.ts:614) — name changes propagate immediately.
- F2 fixes (env-season init, blank-project stock render): `envName` initialized via `filterEnvsBySeason([...SKYBOX_ENVS], 'summer')[0]` (Editor.tsx:228). Summer-classified env selected by default — F2a confirmed. No artificial `EDITOR_LOADING_MS` delay — removed per comment at line 90.
- Persist throttle: 400 ms trailing debounce (Editor.tsx:961-964). Clean. Flush-on-unmount handled by the empty-dep effect (line 980-989).

---

## Needs-Live List

1. **MAJOR-1:** Confirm that Steam's `ISteamUGC.updateItem()` with `visibility:3` actually changes a previously-Public item to Unlisted (not a no-op or error) — this determines whether the bug is silent data loss vs. a harmless metadata call.
2. **MAJOR-2:** Verify that a project with only a faction-scope diffuse (no per-vehicle entry, no decals on unvisited vehicles) produces the expected blank/vanilla texture for those vehicles in-game after export.

---

## Release Readiness Verdict

**Do not ship until MAJOR-1 is resolved** (or confirmed harmless by live test). MAJOR-1 has a high probability of silently demoting publicly-published items to Unlisted on every edit — a data-integrity issue for Workshop creators.

MAJOR-2 and MAJOR-3 are real bugs but narrower in impact: faction-scope diffuse is a less-common workflow (vehicle-scope is the default), and the visibility persistence gap (MAJOR-3) is a UX inconvenience, not a corruption path.

The six focus areas below-the-Konva stack are otherwise solid: RGT format/size math is correct, the unsigned fallback is safe, the faceplate 6-file layout and icon sub-rects are verified, the loading/persistence machinery is clean, and the metadata indexes are correctly maintained on delete/rename.

---

## Bug-fix pass (2026-06-14)

All three MAJOR bugs fixed. `npx tsc -b` clean. `npx vitest run` 1990/1990 (111 files, +19 new tests over baseline of 1971).

### MAJOR-3 — workshopVisibility persistence (prerequisite)

**Files changed:**
- `src/lib/project.ts` — added `workshopVisibility?: 0 | 1 | 2 | 3` to `Coh2SkinProject` after `workshopId`. Mirrors `Coh2FaceplateProject` and `Coh2DecalPackProject` exactly.
- `src/components/TopBar.tsx` (lines ~289–301) — added `initialVisibility={p.project.workshopVisibility}` and `onPublished={(visibility) => { const next = { ...p.project, workshopVisibility: visibility }; p.setProject(next); persistActive(next) }}` to the skin pack's `PublishSection`. Mirrors the faceplate/decal-pack pattern.

**Test added:** `src/lib/__tests__/bug-fixes-major.test.ts` — MAJOR-3 suite (4 tests): field starts undefined on new projects, round-trips 0–3, survives spread-clone mutation, survives unrelated field edits.

---

### MAJOR-1 — Workshop auto-update hardcodes visibility:3

**Files changed:**
- `src/lib/live-sync.ts` (~lines 580–611) — replaced `visibility: 3 as const` hardcode with `const updateVisibility: 0|1|2|3 = p.workshopVisibility ?? 3`. The cast on `p` was widened to include `workshopVisibility?: 0|1|2|3`. The `input` type was widened from `{ visibility: 3 }` to `{ visibility: 0|1|2|3 }`. A sync on a Public (0) or FriendsOnly (1) item now preserves that visibility instead of silently demoting to Unlisted. The 3 (Unlisted) fallback is retained for projects never published before (no stored visibility).

**Test added:** `src/lib/__tests__/bug-fixes-major.test.ts` — MAJOR-1 suite (6 tests): each value 0–3 passes through correctly; undefined falls back to 3; a project with visibility=0 (Public) is no longer demoted to 3.

**Residual needs-live:** Confirm that Steam's `ISteamUGC.updateItem()` actually applies the passed visibility to the live Workshop item (vs. treating it as a no-op). High confidence it does — the steam.ts code path sets `details.visibility = input.visibility` unconditionally before calling `updateItem`.

---

### MAJOR-2 — Export excludes unvisited vehicles with faction/all-scope diffuse

**Files changed:**
- `src/lib/mod-export.ts`:
  - Added imports: `vehiclesForFaction` from `./vehicles`; `effectiveCustomDiffuseUrl` from `./project`.
  - Added new exported helper `collectExportVehicleIds(project)` (~40 lines before `composeVehicleDiffuse`). Collects per-vehicle entries with decals or a customDiffuseUrl (existing logic), PLUS iterates `project.factionDefaults` to include all catalogue vehicles for any faction that has a `customDiffuseUrl` set as a faction default — covering vehicles the user never opened.
  - `composeVehicleDiffuse`: replaced `const veh = project.vehicles[vehicleId]` early-return with safe null-coalesce; resolved diffuse via `effectiveCustomDiffuseUrl(project, vehicleId, vSpec.faction)` instead of `veh.customDiffuseUrl`; used `veh?.decals ?? []`, `veh?.name ?? ''`, `veh?.tac ?? vSpec.defaultTac` for unvisited-vehicle safety.
  - `patchExport` (line ~480): replaced inline filter with `collectExportVehicleIds(project)`.
  - `exportSkinPack` (line ~618): replaced inline filter with `collectExportVehicleIds(project)`.

**Test added:** `src/lib/__tests__/bug-fixes-major.test.ts` — MAJOR-2 suite (9 tests): empty project, per-vehicle decal inclusion, per-vehicle diffuse inclusion, per-vehicle empty exclusion, faction-default includes unvisited vehicles (core regression test), cross-faction isolation, `effectiveCustomDiffuseUrl` shared-logic verification, per-vehicle override takes precedence, no double-counting.

**Existing test impact:** `every-vehicle-every-faction.test.ts` still passes (10/13/12/17/9 vehicles per faction). The existing `mod-export.test.ts` (15 tests) all pass — the `exportSkinPack` validation tests reject early before reaching `collectExportVehicleIds`.

**Residual needs-live:** Verify in-game that a faction-scope diffuse project exports the correct texture for every vehicle of that faction, including those never visited in the editor.
