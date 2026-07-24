# T1a — Template/Decal Requirements Findings & Decisions
*2026-06-13. All paths relative to repo root.*

---

## R1 — Loading / Workshop fallback

**Finding:** The workshopId fallback for **decal packs** was already wired in `Editor.tsx:556-559`:
```ts
let pack = loadDecalPackById(decalPackRef.id)
if (!pack) {
  const localId = findDecalPackIdByWorkshopId(decalPackRef.id)
  if (localId) pack = loadDecalPackById(localId)
}
```
This matches the C-decal-render audit's fix sketch (gap #1). No code change needed here.

For **templates**: `TemplateDecalPills.tsx applyTemplate` calls `readWorkshopDiffuseDataUrlBySgaPath` (via `fetchWorkshopDiffuse`), which opens the Workshop SGA by the `sgaPath` stored in `opt.hint`. Workshop template options carry `hint: s.sgaPath` (set at TemplateDecalPills.tsx:114). The async bake path works; if the SGA path is null the bake silently no-ops and falls back to vanilla — acceptable.

**Test:** `T1a-template-decal.test.ts` → R1 block (3 tests):
- `findDecalPackIdByWorkshopId` resolves a saved pack by workshopId.
- Returns null when no pack matches.
- `loadDecalPackById` round-trips a saved pack.

---

## R2 — Faction filtering

**Decision — Templates are faction-scoped; Decals are faction-universal.**

Evidence for decals being universal: `src/lib/decal-mod-templates.ts:FACTION_ORDER` is `['aef','british','german','soviet','west_german']` — the CoH2 decal pack format mandates one RGD per faction, so every decal pack works for all armies. **No faction filter is applied to the decal picker.**

Evidence for template faction-filtering: `TemplateDecalPills.tsx:155` already filters `listStockSkins()` by `s.factionId === faction`. Workshop templates are pre-filtered by `listWorkshopSkinsForFaction(faction)` at TemplateDecalPills.tsx:109. Saved templates are cross-faction (intentional — user may seed from any faction's saved pack).

**What `faction` prop is:** `Editor.tsx:1821` passes `faction={vehicle.faction}` to `TemplateDecalPills`. `vehicle.faction` tracks the currently-displayed vehicle, kept in sync with `selectedFaction` via the `handleSelectFaction` effect at Editor.tsx:1391-1401.

**Code change:** none needed — faction filtering was already correct. Tests added to pin the invariants.

**Test:** `T1a-template-decal.test.ts` → R2 block (4 tests):
- `listStockSkins()` covers all 5 factions.
- Filtering by one faction gives only that faction.
- Faction sets are disjoint (no vehicle in two factions).
- `FACTION_ORDER` in `decal-mod-templates.ts` confirms 5-faction universal scope.

---

## R3 — Picker rows: no path text; preview image + name

**What was shown before:** `opt.hint` was displayed below the name in every dropdown row:
- Stock templates: `s.sgaName` (e.g. `"ArtGermanEF.sga"`) — path-like.
- Workshop templates: `s.sgaPath` (full path) — shown in hint.
- Decal packs: `p.path` (full filesystem path) — shown in hint.

**Changes in `TemplateDecalPills.tsx`:**
1. Added `previewUrl?: string | null` to the `Option` interface (line ~44).
2. Stock template options now carry `previewUrl: FACTION_ICON_SRC[s.factionId]` (faction emblem PNG).
3. Workshop template options carry `previewUrl: FACTION_ICON_SRC[faction]`.
4. Decal pack options: hint removed (path suppressed). No previewUrl (placeholder shown).
5. Blank/Saved template options: no hint, no previewUrl (placeholder shown).
6. `Dropdown` row layout changed to `[20×20 img | placeholder] [name]` — hint `<div>` removed entirely.
7. Added `optionRowStyle`, `optionPreviewImgStyle`, `optionPreviewPlaceholderStyle` style constants.

**Note:** The `hint` field is still present on workshop template options ONLY to carry the `sgaPath` for the async diffuse bake (TemplateDecalPills `fetchWorkshopDiffuse`). It is never rendered in the UI.

**LIVE verification needed:** Visual check that the row layout looks correct in the running app.

---

## R4 — Decal is cosmetic-only in skin export

**Finding:** The export pipeline (`mod-export.ts:composeVehicleDiffuse` and `exportSkinPack`) reads only:
- `veh.decals` (user-placed skin decals)
- `veh.customDiffuseUrl` (painted/template-baked/uploaded diffuse)

`project.decalPackRef` is never read by the export path. The decal bake in `Editor.tsx` goes into `decalPreviewCanvasRef` (preview/visualization only — never written to `customDiffuseUrl` and never passed to the exporter).

**No code change needed.** Already correct by design.

**Test:** `T1a-template-decal.test.ts` → R4 block (2 tests):
- `exportSkinPack` rejects a project with only a `decalPackRef` and no vehicle content.
- `project.decalPackRef` is a project-level association field, not merged into `project.vehicles[id]`.

---

## R5 — Template functional in skin export

**Bug found and fixed:** `composeVehicleDiffuse` at `mod-export.ts:164` (old line) skipped vehicles when `veh.decals.length === 0`, even if `customDiffuseUrl` was set (template bake). Similarly, the `vehicleIds` filter in `exportSkinPack` (old line 568) and `patchExport` (old line 467) only kept vehicles with `decals.length > 0`.

**Fix in `mod-export.ts`:**
1. `composeVehicleDiffuse`: skip condition changed from `veh.decals.length === 0` to `veh.decals.length === 0 && !veh.customDiffuseUrl`.
2. `exportSkinPack` vehicle filter: `decals.length > 0` → `decals.length > 0 || !!veh?.customDiffuseUrl`.
3. `patchExport` vehicle filter: same change.
4. Error message updated: "no vehicles with decals or a chosen template."
5. The vehicle gate in `exportSkinPack` was moved BEFORE `locateArchives` so the empty-project check fails fast with a clear message (not "could not locate CoH2/Archives").

**Test:** `T1a-template-decal.test.ts` → R5 block (3 tests):
- A vehicle with `customDiffuseUrl` but zero decals passes the gate (export proceeds to the downstream step).
- An empty project (no vehicles at all) is rejected with `/no vehicles with decals or a chosen template/i`.
- A project with only `decalPackRef` (no vehicle content) is rejected.

**LIVE verification needed:** Pick a stock/workshop template, confirm vehicle shows template texture in-game after export.

---

## R6 — Edit Texture edits the template

**Finding:** The wiring is already correct:
1. When a template is chosen, `TemplateDecalPills.applyTemplate` asynchronously bakes the template's diffuse into `veh.customDiffuseUrl` (`Editor.tsx:289-300`, `338-347`).
2. `onModelLoaded` at `Editor.tsx:1539-1560` calls `effectiveCustomDiffuseUrl(project, vehicle.id, vehicle.faction)` and, if non-null, draws it into both `overlayCanvasRef` and `baseDiffuseRef.current`.
3. `VehicleTextureEditor` receives `baseDiffuse={baseDiffuseRef.current}` (`Editor.tsx:1888`). Paint strokes go onto this canvas, so the user is painting on top of the template texture.
4. When no template is set, `effectiveCustomDiffuseUrl` returns null, and `baseDiffuseRef` holds the vanilla/stock diffuse — identical to pre-template behavior.

**No code change needed.** Already correct by design.

**Test:** `T1a-template-decal.test.ts` → R6 block (5 tests):
- `effectiveCustomDiffuseUrl` returns the template-baked diffuse when set.
- Returns null when no template.
- Per-vehicle overrides faction-default.
- Template ref is stored at `project.template`, not inside `project.vehicles[id]`.
- Template bake persists through `persistActive`/`loadActive` round-trip.

---

## Items requiring LIVE / in-game verification

1. **R3 visual**: Row layout (image left + name right, no path) looks correct in the running app.
2. **R5 in-game**: After picking a stock template and exporting, the skin shows in CoH2 with the chosen template texture.
3. **R6 in-context**: After picking a template, "Edit Texture" opens the editor on the template's diffuse (not vanilla). Paint shows on the template rather than over gray/vanilla.
4. **R1 Workshop template**: Workshop-sourced templates (requires subscribed Workshop skins in the install) resolve and bake correctly.

---

## Suite count

- Baseline: 1893/1893
- After T1a: **1912/1912** (+19 new tests)
- `npx tsc -b`: clean (0 errors)
