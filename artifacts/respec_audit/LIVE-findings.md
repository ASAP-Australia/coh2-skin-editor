# CoH2 Community Modding Tool — Live Verification Findings
**Date:** 2026-06-10  
**Method:** CDP harness (harness.mjs) — no source modifications  
**App version:** CoH2SkinEditor AppImage (Electron, Vite+React, minified)

---

## 1. F2 Bug Reproduction — Root-Cause Analysis

**Symptoms observed on opening "RespecSkin":**
- Brief flash of winter ground texture (mission_06 skybox renders before season normalises)
- "Loading…" label appears during editor-loading phase, then disappears
- No tank visible on first open (blank canvas / transparent vehicle)
- Console: `[skybox] no side texture found for mission_06`
- Console: `[viewport] heavy effect run() start — vehicle=elefant season=false` fires TWICE

**Root causes:**

1. **Blank project / null lastVehicleId:** RespecSkin was a freshly-created project with `lastVehicleId: null`. The Editor component falls back to `FACTION_DEFAULT_VEHICLE['german']` (Elefant). No `customDiffuseUrl` or `camoPreset` exists → the vehicle canvas is transparent. This is expected behaviour for a new project, but it leads to apparent invisibility that could confuse users.

2. **Winter flash (`envName = 'mission_06'`):** The Editor initialises `envName` state as `'mission_06'`, a winter skybox, regardless of the project's `season` state (`'summer'`). The 3D viewport begins rendering immediately during `editor-loading` (invisible phase) and fires once more when transitioning to `editor` phase. The winter flash occurs in that first frame burst.

3. **"Loading…" text source:** This is the FLIP-animation shown during `App.tsx`'s `editor-loading` phase — the Editor mounts invisible (`visible={false}`) behind an AuthShell with null panel content. The label is in the `probing` phase; the FLIP animation itself has no text but obscures the editor during mounting.

4. **Double viewport fire:** The Editor mounts during `editor-loading` (invisible), triggering `onModelLoaded` → `onReady` → `setPhase('editor')`. When `visible` flips true, the viewport runs a second render pass. Not a bug per se, but doubles GPU warmup cost on every open.

**Screenshots:** `/tmp/coh2-evidence/feedback/F2-t0.png` through `F2-t3.png`

---

## 2. Export Button Disabled (editedCount Bug)

**Bug:** `TopBar.tsx` computes `editedCount` as:
```
Object.values(p.project.vehicles).filter(v => (v.decals?.length ?? 0) > 0).length
```
This **only counts vehicles with decals**. A vehicle with `customDiffuseUrl` (painted via the brush tool) is NOT counted. The Export button is `disabled={busy || editedCount === 0}`.

**Impact:** A user who paints a vehicle texture using the brush tool — without adding any decals — cannot export. The Export button remains greyed out despite visible work in the canvas.

**Workaround applied for this sweep:** A dummy decal entry was injected into localStorage for the elefant vehicle to make `editedCount > 0`. This unblocked the export path.

**Recommendation:** Include vehicles with `customDiffuseUrl` in the editedCount calculation.

---

## 3. ViewPanel / Export Panel Inaccessibility

**Bug:** `ExportPanel` (the "Export textures" workflow) only renders when `activePanel === 'export'`. The only call to `setActivePanel('export')` is inside `ViewPanel`'s "Export textures" button. However, `ViewPanel` has no entry point in the current UI — there is no button in the TopBar or elsewhere that opens it.

**TopBar cluster analysis:** The top bar renders only: title pill + home button. The Paint / Compose / Publish cluster buttons referenced in the component source are not rendered in the current build.

**Impact:** The full SGA export flow (including slot assignment, icon composite, and `.sga` packaging) is unreachable via the standard UI. The only way to export is via programmatic dispatch or the live-sync path.

---

## 4. Live Sync Blocked for Local Projects

**Observation:** Live sync is enabled in localStorage (`coh2-skin:live-sync-enabled = 'true'`) but the UI shows: "Saved locally — in-game live sync requires the signing template."

**Cause:** `live-sync.ts` requires a Workshop signing template. Local projects without a Workshop subscription cannot use live sync.

**Workshop discrepancy:** The decal panel shows Workshop item `#3728271474` as available (from `~/.steam/steam/steamapps/workshop/content/231430/3728271474/`). However, `electronAPI.listWorkshopItems()` returns count=0. This inconsistency suggests the workshop detection path and the panel's file-system scan use different discovery methods.

---

## 5. SGA Export — Low-Level Path

**Method used:** `buildSkinPack` (minified as `t`/`q`) from `mod-export-wJ3c4HrR.js` was called directly via CDP eval, passing the live `FileSystemDirectoryHandle` (installRoot) extracted from the React fiber tree. The handle was located at `fiber.memoizedProps.root` in component `hl` (Editor).

**exportSkinPack vs buildSkinPack:** The high-level `exportSkinPack` function requires `hasKeyPool()` → fetches `./keys/manifest.json` from a relative URL (fails outside app context). The low-level `q` function skips this requirement.

**Function signature:**
```
q(installRoot, project, onProgress, targetSlot, numericIdOverride, modGuidOverride)
```
- `targetSlot`: 0–5 (skin slot index)
- `numericIdOverride`: string of digits (no leading zeros)
- `modGuidOverride`: 32 lowercase hex chars

**Required project fields:** `palette.orange`, `palette.white`, `palette.blue` must be present or compositing throws. Blank new projects created without palette will fail.

---

## 6. Evidence Files

| File | Size | SHA-256 | Notes |
|------|------|---------|-------|
| `/tmp/coh2-evidence/a-sweep/respec-skin.sga` | 3,437,634 B | `6ab075db8bba18b2717532824f8efb4c8ad78c99fe1983384d346b4867219dec` | RespecSkin; Elefant painted + 1 shield decal; deployed name `1781096026757619.sga` |
| `/tmp/coh2-evidence/a-sweep/respec-faceplate.sga` | 3,461,612 B | `d132db554cc3be1e5dcccdb12cd93596be0b272b94257ae2395c63fc98722d4a` | RespecFaceplate; Elefant 1 shield decal; deployed name `1781096171140887.sga` |

**Feedback screenshots:** `/tmp/coh2-evidence/feedback/` (15 files: F2-t0..t3, F5-openers, F5-decal-opener, F6-template-scrollbar, F7-toolbar, F8-title-menu, F9-season-icons, F10-us-scrollbar, F11-current-state, F12-de/uk/us)

---

## 7. Performance

**Steady-state FPS (3s sample):** 59 avg, 0 dropped frames >32ms, 0 long tasks. Rendering is smooth once loaded.

---

## 8. Summary of Bugs Found

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 1 | Medium | `TopBar.tsx:editedCount` | Paint-only vehicles excluded from export gate — brush work silently blocked from export |
| 2 | High | `TopBar.tsx` / `App.tsx` | ViewPanel entry point missing — Export textures workflow unreachable via UI |
| 3 | Low | `Editor.tsx:envName` | Winter skybox initialised regardless of project season → brief visual flash |
| 4 | Low | `electronAPI.listWorkshopItems` | Workshop item discovery returns 0 despite a local Workshop folder being present |
| 5 | Low | `App.tsx:editor-loading` | Double viewport fire on project open — cosmetic but wastes GPU warmup |
