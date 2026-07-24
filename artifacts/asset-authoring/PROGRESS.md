# Asset-Authoring + UX-Fix Campaign — Progress Tracker

_Started 2026-07-20. Companion to PLAN.md. Tracks DONE vs PENDING; resumable across compaction._

## Phase 1 — Research & recon: ✅ DONE
9 docs + `PLAN.md` in `artifacts/asset-authoring/`.

## Phase 2 — Create three real assets: ✅ DONE (all validated game-loadable + UI-verified)
Headless lib path (same libs the UI calls) → real SGAs in `artifacts/created-assets/`:
- Decal `decal-balkenkreuz.sga` 13.3KB (15-file, balkenkreuz in badge cell, 61/61 analytical, 12/12 tests)
- Faceplate `faceplate-test.sga` 25.6KB (6-file v7, verify-faceplate PASS, BC3 692×204)
- Skin `1784528712090699.sga` 1.78MB (Tiger german_ambush masked camo, 2048² summer+winter _dif)
- **UI drive:** decal editor driven end-to-end (Balkenkreuz placed). All 3 editors' new "Export .sga" buttons verified LIVE to produce real .sga blobs: decal 13,740 B, faceplate 8,197 B, skin (camo) 1,849,433 B.

## Phase 3 — Editor UX fixes: ✅ WAVES 1–2 + bug fixes DONE (typecheck 0, 2153/2153 tests)

### WebGL robustness (verified live)
`webgl-support.ts` + `ErrorBoundary.tsx` + `ViewportGuard.tsx`; wrapped 4 Viewport mounts. App no longer white-screens without WebGL — shows "3D preview unavailable" placeholder, rest of editor works.

### Wave 1 (verified live)
Q1 skin nav rail (Decals/Camo/Parts/Scene → setActivePanel); Q2 home aria-label; Q3 jargon→Advanced; Q4 decal coord labels + dead tooltip; Q5 icon fixes (mask/transform/scene); Q8 dedupe (Eraser→dedicated tool, season, insignia); Q9 dead Reference panel removed.

### Wave 2 (verified live)
Q6 "Export .sga" in all 3 editors (browser Blob download + toast / Electron write); Q10 decal badge-cell/empty-part validation; R2 progressive disclosure for Camo + Adjustment panels.

### Bugs found via LIVE UI testing (headless didn't catch) — all fixed + regression-tested
1. SVG decode race (`InvalidStateError: source image could not be decoded`) → shared `decodeSourceImage()` awaits `img.decode()` before drawImage; routed all rasterize callers.
2. setState-in-render in `editor-history.ts` (onPersist inside setState updater) → deferred to microtask.
3. **Camo-only skin exported VANILLA** (machine-independent): `collectExportVehicleIds` ignored `camoPreset` (Export stayed disabled) AND `composeVehicleDiffuse` never regenerated camo → fixed both in `mod-export.ts` + regression tests.

### Wave 3 (verified live) ✅
- Q7 — `live-sync.ts` now honors `setEnabled(false)` (unit-tested, `live-sync-disabled.test.ts`); **shared Live-Sync On/Off toggle** added to `EditorTitlePill.tsx` (all 3 editors) — verified live (role=switch "Live sync on — click to pause", toggles true↔false).
- R3 — decal editor defaults to a single "Main badge"; the parts×factions matrix + faction-override buttons are hidden behind a collapsed **"Show advanced placement controls"** disclosure (verified live — default view is clutter-free).

**Final state: typecheck 0, 2153/2153 vitest pass. All 3 asks delivered + verified live.**

### ⏳ DEFERRED (offered to user; higher risk / lower priority)
- R1 — extract a shared canvas-editor shell (consistent toolbar/undo-redo across the 3 editors). Architectural, higher regression risk — wants review before doing.
- R4 — non-destructive layers/history in the diffuse (skin) editor.

## Wiki: ✅ updated — new page `coh2-skin-editor-running-and-authoring.md` + extended architecture/decal/entity pages + index/MOC/log.
