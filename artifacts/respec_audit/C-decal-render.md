# Respec Audit C — Decal Rendering in the Vehicle Editor

Read-only audit, 2026-06-10. All paths relative to repo root.

## 1. Decal render data flow (decal PNG → on-screen vehicle)

1. **Source image** — decal pack loaded from localStorage: `loadDecalPackById(decalPackRef.id)` (`src/components/Editor.tsx:563`; loader at `src/lib/decal-pack-project.ts:542-552`). First visible decal's source image is a dataURL of arbitrary native size (`Editor.tsx:580-592`), decoded via `new Image()` (`Editor.tsx:619-645`).
2. **Rasterise** — `rasteriseDecal(firstDecal, img, { supersample: 4 })` (`Editor.tsx:624`) → **512×512** canvas (`DECAL_PACK_SIZE`=128 at `src/lib/decal-pack-project.ts:33`, ×4 at `src/lib/decal-pack-export.ts:166-170`). All drawing happens in 128-logical space under `ctx.scale(4,4)` with `imageSmoothingEnabled=true`, `imageSmoothingQuality='high'` (`decal-pack-export.ts:180-181`).
3. **UV rect resolve** — `resolveDecalUvRect(vehicleId, meshes)` (`Editor.tsx:602`; `src/lib/vehicle-uv-registry.ts:123-135`): authored JSON rect or `DEFAULT_BADGE_RECT {870,1150,320,312}` (`vehicle-uv-registry.ts:98-103`). Always non-null.
4. **Bake** — `bakeDecalOntoDiffuse(base, decalCanvas, rect)` (`Editor.tsx:628-632`; `src/lib/king-tiger-decal-bake.ts:50-81`): new **2048×2048** canvas; base diffuse drawn 1:1; the 512² decal is drawn into the ~260–512px rect — a **downscale** (typically 512→320, ×0.625) with smoothing `'high'` (`king-tiger-decal-bake.ts:75-78`). Result stored in `decalPreviewCanvasRef` (`Editor.tsx:633`).
5. **Composite** — `paintCanvas` draws the baked canvas 1:1 (2048→2048, no resample) into the offscreen overlay canvas, then paints user-placed decals on top (`Editor.tsx:848-858`; overlay canvas is 2048² at `Editor.tsx:476-479`).
6. **GPU upload** — Viewport wraps the overlay in `CanvasTexture` with `flipY=true`, `SRGBColorSpace`, `RepeatWrapping`, `anisotropy=MAX_ANISO(16)` (`src/components/Viewport.tsx:3852-3875`, `Viewport.tsx:554`); re-upload gated by `overlayVersion` dirty flag (`Viewport.tsx:3909-3917`). `minFilter`/`magFilter`/`generateMipmaps` are **not set** → three.js defaults (trilinear `LinearMipmapLinearFilter` min, `LinearFilter` mag, mipmaps on).
7. **Render** — `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))` (`Viewport.tsx:909`). After bake, camera auto-snaps to the decal side via `faceDecalRef` (`Editor.tsx:638`, `Viewport.tsx:4753-4767`).

## 2. Sharpness verdict

**Sharp on the main path.** The classic blur source (128² tile upscaled into a ~320px rect) is fixed: 4× supersampled rasterisation produces 512², which is then *down*scaled into the rect with `'high'` quality — no downsample-then-upsample hop exists in the Editor path. Anisotropy 16 on the overlay texture prevents grazing-angle smear (`Viewport.tsx:3871-3875`). Trilinear mipmapping is correct for minification.

Remaining softness sources, as the code is today:

- **DPR cap 1.5** (`Viewport.tsx:909`): on 2× HiDPI displays the whole 3D view (decal included) renders at 1.5× and is CSS-upscaled. Recommendation if maximum sharpness is wanted: `Math.min(devicePixelRatio, 2)` (1 LOC, GPU-cost tradeoff).
- **Texel density when zoomed in**: the decal occupies ~320px of the 2048 atlas; close-up magnification is bilinear over those texels. Inherent to the atlas; only a larger rect/atlas changes it. No param fix.
- **AtlasPreview3D (decal-pack editor's 3D preview) is NOT sharp**: composites the part at native region size, then **upscales** into a 512² rect with default (`low`) smoothing — neither `imageSmoothingQuality` nor supersampling set (`src/components/atlas/AtlasPreview3D.tsx:115-124,140`). Separate surface from the vehicle editor but same user-visible "decal on tank" preview.

## 3. Per-vehicle selection & apply-to-all

- **UI entry point**: decal pill in `TemplateDecalPills` rendered directly above the VehicleMenu rail (`src/components/Editor.tsx:1766-1773`; pill at `src/components/TemplateDecalPills.tsx:378-384`). Dropdown opens upward with a `ScopeToggle` segmented control "This vehicle / All vehicles" as its header (`TemplateDecalPills.tsx:402-421`, toggle at `598-668`). The template pill has the same toggle (`TemplateDecalPills.tsx:394-399`).
- **State shape** (project-level, written by `applyDecalPack`, `TemplateDecalPills.tsx:356-367`):
  `project.decalPackRef?: {id, name}`, `project.decalScope?: 'vehicle'|'all'`, `project.decalScopeVehicleId?: string`. Local toggle state seeds from `project.decalScope` (`TemplateDecalPills.tsx:70`).
- **Apply-to-all**: exists and is wired — scope `'all'` (default) previews on every vehicle; scope `'vehicle'` pins the preview to `decalScopeVehicleId` and suppresses it elsewhere (gate at `Editor.tsx:572-578`). Pinned-scope behavior is test-pinned (`src/lib/__tests__/decal-scope.test.ts:19-55`, though against a mirrored copy of the gate, not the Editor code itself).
- **Caveat**: this is one pack reference per project. You can pin the preview to one vehicle or show it on all — you **cannot** assign *different* decal packs to different vehicles. If "per-vehicle decal selection" means the latter, it is not implemented.

## 4. Title-label template removal

**Confirmed removed, one stale remnant.** The centre-top title pill (`EditorTitlePill` via `TopBar`, `src/components/TopBar.tsx:219-236`) now hosts only pack identity; an explicit marker comment documents the move: "Template selection has moved to the bottom-bar TemplateDecalPills pill so the centre-title popover no longer duplicates it" (`TopBar.tsx:257-258`). `PackIdentityPopover.tsx` contains zero template code in any git revision. Remnant: `TemplateDecalPills.tsx:8` references "PackIdentityPopover → TemplateSelectSection" — a component that never existed in repo history (`git log -S TemplateSelectSection` hits only the commit adding this comment). Cosmetic-only.

## 5. Badge-rect coverage

Registry: `src/lib/vehicle-uv-regions/*.json` + `JSON_REGISTRY` (`vehicle-uv-registry.ts:65-77`). **9 authored** rects: king_tiger_sdkfz_182 {410,1320,360,340}, tiger {996,1128,320,320}, t34_76 (hullFront {0,342,276,320}), m4a3e8_sherman_easy_8 {1700,1236,320,320}, su85 {951,1256,340,320}, sherman_firefly {45,380,280,260}, stug_iii {1395,1635,330,310}, kv2_heavy_tank {1235,1300,320,310}, panzerwerfer {220,930,310,310}. Roster has 61 entries / 60 unique ids (`src/lib/vehicles.ts:44-117`; 'halftrack' shared german/soviet) → **51 unique vehicles fall back** to `DEFAULT_BADGE_RECT {870,1150,320,312}` (mean of the 8 hull-side authored rects, `vehicle-uv-registry.ts:81-103`). Fallback meaning: badge-sized, plausible-band placement — the decal renders sharply but at a likely-wrong hull position (never a full-atlas smear). Tests pin authored-vs-fallback resolution (`src/lib/__tests__/vehicle-uv-registry.test.ts:32-135`).

## 6. Gaps & minimal fix sketches

1. **Workshop-id/preview mismatch (functional, highest impact)** — the decal menu lists *Steam Workshop* items (`TemplateDecalPills.tsx:121-183`), but the preview loads a *localStorage* pack by that id (`Editor.tsx:563`); `loadDecalPackById` requires magic `'coh2-decalpack-project'` under that key. A workshop item not authored locally → `pack==null` → preview silently blank. The file's own header says "one of the user's saved decal packs" (`TemplateDecalPills.tsx:9-12`). Fix: in `Editor.tsx:563`, fall back to scanning `listAllDecalPacks()` for `project.workshopId === decalPackRef.id` (field exists, `decal-pack-project.ts:261`), or list saved local packs in the menu. ~15–25 LOC.
2. **Only first visible decal previewed** (`Editor.tsx:580-590`) — acceptable for a "preview", but undocumented in UI. Optional.
3. **DPR cap softness** — `Viewport.tsx:909` old: `Math.min(window.devicePixelRatio, 1.5)` → new: `, 2)`. 1 LOC.
4. **AtlasPreview3D stale + soft** — `AtlasPreview3D.tsx:43` hard-codes the *old, corrected-away* KT rect {896,1152,512,512} (current authored KT rect is {410,1320,360,340}); upscale at `:124` uses default low smoothing. Fix: import rect from `king-tiger-decal-bake.ts` / registry; set `imageSmoothingQuality='high'`. ~6 LOC. Same stale rect in `AuditRunner.tsx:62` (debug-only).
5. **True per-vehicle pack mapping absent** — if spec requires it: move ref to `project.vehicles[id].decalPackRef` with project-level default; update `applyDecalPack` + Editor gate. ~30–50 LOC.
6. **No test pins the supersample-4 sharp path** — `decal-pack-export.test.ts` and `king-tiger-decal-bake.test.ts` cover rect/size/placement only. Add a test asserting `rasteriseDecal(..., {supersample:4})` returns 512² and bake downscales. ~20 LOC.
7. **Stale comment** `TemplateDecalPills.tsx:8`. 1 LOC.
