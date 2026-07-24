# UV Mapping Diagnostic — BUG 1 (turret untextured) + BUG 2 (decal flat rect)

_Authored 2026-06-18. Read-only audit: no code was modified._

---

## 1. How the renderer loads models and UVs

`Viewport.tsx` loads the vehicle RGM via `loadStructure()` (structure-loader.ts) or directly through
the inline heavy-model-load effect (`buildVehicleIntoCache` / `renderInner`). `parseRgm()` in
`src/lib/rgm.ts` decodes per-vertex TEXCOORD0 UVs for EVERY submesh including the turret (lines
415–446: both float32 and UNORM8 UV formats). The resulting `RgmMesh[]` array carries one
`BufferGeometry` per submesh, each with a `uv` attribute already in GL convention (V flipped at
parse time). So the geometry does carry correct per-vertex UVs for hull AND turret; the turret UV
islands are confirmed present in `king_tiger_sdkfz_182.json`
(e.g. `GEO_turret_horiz`: minU=0.0027..0.6757, minV=0.4308..0.9958).

CoH2 vehicles share a SINGLE 2048×2048 atlas for the hull + turret body. There is no separate
`_turret_dif.rgt` for the Tiger or King Tiger — the turret's UV islands unwrap into the same atlas.

---

## BUG 1 — Skin template textures hull but turret stays vanilla

### Root cause

The overlay canvas (the user-painted 2048² diffuse) is bound via the overlay-canvas effect in
`Viewport.tsx` (lines 3974–3987). The binding guard reads:

```ts
// Viewport.tsx:3982
if ((mat as any).__usesBodyDiffuse) {
  mat.map = overlayTexRef.current
  mat.needsUpdate = true
}
```

`__usesBodyDiffuse` is set per-submesh at line 3613:

```ts
;(mat as any).__usesBodyDiffuse = isBodyMaterial(sub.materialName)
```

`isBodyMaterial` (lines 3510–3512) returns `true` when `tokenFor(materialName) === ''` — i.e. when
the material is NOT classified as tread/wreck/turrets/panels/schurzen. For the Tiger and King Tiger,
the turret submeshes (`GEO_turret_horiz`, `GEO_turret_vert`, `GEO_cupolahatch`, etc.) have material
names that match the `/(?:^|_)turrets?(?:_|$)/i` regex at line 3321, so `tokenFor()` returns
`'turrets'` — NOT `''`. Therefore `isBodyMaterial` returns `false`, `__usesBodyDiffuse = false`,
and the overlay is **never bound** to turret meshes.

The live-build path and the warmup-cache path (`buildVehicleIntoCache`, line 4736) both make the
same assignment. Both paths are broken identically.

The turret DOES receive the correct texture at initial load (line 3499–3501: `sharesBodyAtlas =
token === 'turrets'` causes the turret's `dTex` to fall back to the body atlas diffuse). So the
3D turret renders the vanilla CoH2 diffuse correctly at load time. But when the user applies a
skin (which writes `overlayTexRef` and rebinds `mat.map` only on `__usesBodyDiffuse` meshes), the
turret is skipped, so it keeps the original RGT-decoded CanvasTexture while the hull gets the
user's painted overlay.

### Concrete fix sketch

**File:** `src/components/Viewport.tsx`

At line 3613, change the `__usesBodyDiffuse` assignment so turret materials are also included:

```ts
// OLD (line 3613):
;(mat as any).__usesBodyDiffuse = isBodyMaterial(sub.materialName)

// NEW:
;(mat as any).__usesBodyDiffuse = isBodyMaterial(sub.materialName) || subToken === 'turrets'
```

Identical change at line 4736 (warmup-cache path):

```ts
// OLD (line 4736):
;(mat as any).__usesBodyDiffuse = tokenFor2(sub.materialName ?? sub.name) === ''

// NEW:
const st2 = tokenFor2(sub.materialName ?? sub.name)
;(mat as any).__usesBodyDiffuse = st2 === '' || st2 === 'turrets'
```

The overlay-bind loop (lines 3974–3987) and the overlay-clear loop (lines 3989–3998) will then
rebind the overlay to turret meshes on the same frame as the hull, making the skin diffuse cover the
complete vehicle. No atlas change needed — the turret UVs already map into the body atlas.

**Note:** The season re-skinner (`applySeasonToGroup`, line 1436) already gates its body-diffuse
swap on `mat.__usesBodyDiffuse`; extending that flag to `turrets` is consistent with the existing
season-swap logic which separately handles turret atlases via `__seasonToken === 'turrets'`.

**Feasibility:** High. One-line fix per code path, no data changes required, no new files.

---

## BUG 2 — Decals paste as flat rect on hull side, not real UV positions

### Root cause

`Editor.tsx` calls `resolveDecalUvRect(vehicleId, meshes)` (line 651, 734) from
`src/lib/vehicle-uv-registry.ts`. This function returns a **2D pixel rect** `{x, y, w, h}` in
2048×2048 diffuse space. That rect is fed to `bakeDecalOntoDiffuse()` in
`src/lib/king-tiger-decal-bake.ts` (line 677, 760), which does a single `ctx.drawImage(decalCanvas,
x, y, w, h)` — i.e. it stamps the decal image as a flat 2D rectangle into the diffuse atlas at
those pixel coordinates.

This is fundamentally NOT the same as unwrapping the decal to the model's UV positions. The CoH2
in-game decal system uses a separate decal projection (screen-space or decal-mesh projection) on
top of the diffuse, not a bake into the atlas. The bake approach can work only if the pixel rect
precisely matches the UV island for the targeted 3D surface panel — which is true for the hull side
of vehicles that have hand-authored JSON files (King Tiger, Tiger, Sherman, SU-85, etc. in
`src/lib/vehicle-uv-registry.ts`), but:

1. **Vehicles without a JSON file** fall back to `DEFAULT_BADGE_RECT` (line 98–103 of
   vehicle-uv-registry.ts: `{x:870, y:1150, w:320, h:312}`), which is the mean of 8 hand-authored
   rects. For vehicles whose hull-side UV island sits elsewhere in the atlas, this places the decal
   at the wrong 2D position, which renders as a misplaced rect.

2. **Even for vehicles WITH hand-authored rects**, the rect describes a _rectangular bounding box_
   around the hull-side UV island, NOT the exact polygon shape of that face in UV space. If the UV
   island is non-rectangular (rotated, trimmed, or island-shaped), the rect overlaps neighbouring
   atlas regions and the decal bleeds outside the 3D panel.

3. **There is no UV-unwrap step.** The decal is drawn flat at atlas coordinates. The 3D mesh UV
   coordinates are loaded correctly in `rgm.ts` (TEXCOORD0 per vertex), but they are never used to
   compute _where_ a real decal projection would land — the pipeline ignores them for decal
   placement.

### What CoH2 actually does

In-game, CoH2 places decals via the Essence engine's decal/badge system, which projects a
screen-aligned quad onto the vehicle surface using the badge UV slot defined in the vehicle's
attribute `.ebps` (not in the RGM). That UV slot is a small fixed UV region authored by Relic into
each vehicle's texture atlas corresponding to the badge panel face. The hand-authored JSON files in
`src/lib/vehicle-uv-regions/` are a manually derived approximation of these badge-slot UV regions.

### Are the loaded model UVs sufficient to fix this?

For the per-vehicle rect problem: **yes, partially.** The model's per-vertex UV coordinates
(already parsed by `rgm.ts`) are sufficient to derive the exact bounding rect of any named submesh
in atlas space (e.g. by scanning all vertices of `GEO_chassis_shaker` with X>0 for the right-side
hull). This is how the hand-authored JSON files were originally verified. Automating this scan at
load time would eliminate the DEFAULT_BADGE_RECT fallback for all vehicles.

For the non-rectangular UV island problem: the bake approach is inherently limited to a rect.
Exact polygon clipping into the atlas is not achievable with `ctx.drawImage`. A better approach
would be to rasterise the decal into the UV polygon shape using canvas clip paths derived from the
actual UV triangle coordinates — but this is significantly more complex.

### Concrete fix sketch

**Short-term (per-vehicle accuracy for all loaded models):**

In `vehicle-uv-registry.ts` / `Editor.tsx`, add an auto-derive step from the loaded `RgmMesh[]`
at model-load time. In `onModelLoaded` (Editor.tsx, where `loadedMeshesRef.current` is set), scan
all right-hull meshes (those with X-positive centroid and non-tread/non-wreck material) for their
TEXCOORD0 UV bounding box, compute `{x: minU*2048, y: minV*2048, w: (maxU-minU)*2048,
h: (maxV-minV)*2048}`, and cache it per vehicleId for the current session.

**Longer-term (correct polygon-shaped bake):**

Replace `bakeDecalOntoDiffuse`'s simple `drawImage` with a canvas 2D polygon clip path. For each
right-side face of the target submesh (faces whose 3D centroid.X > 0), extract the UV triangle
coordinates and build a `ctx.clip()` polygon, then draw the decal image scaled to the clip region.
This would produce pixel-accurate decal placement that matches the 3D shape of the hull panel.

**Data availability:**

- The per-vertex UVs are already loaded in the `RgmMesh.geometry.attributes.uv` attribute (float32,
  GL convention) — no new SGA reads required.
- The per-vertex world-space positions are in `geometry.attributes.position`.
- The face index is in `geometry.index`.
- No `.ebps` attribute file is needed; the atlas coordinates are fully derivable from the RGM UVs.

**Feasibility:**

- Auto-derive from model UVs (short-term): Medium. Requires scanning vertices per vehicle at
  model-load time. Risk: some vehicles have wide UV bounding boxes that encompass non-badge areas
  (e.g. King Tiger `GEO_chassis_shaker` spans almost the whole atlas). Needs the same right-side
  filter (X>0) that was already proven to work for the existing JSON files.
- Polygon clip path (longer-term): High effort. Requires extracting all UV triangles for targeted
  submeshes, building clip paths, and handling UV seams / multiple islands. Out of scope for a
  single bug fix.

---

## Summary table

| Bug | Root cause | Fix location | Effort |
|-----|-----------|-------------|--------|
| BUG 1: turret untextured when skin applied | `__usesBodyDiffuse = false` for turret materials; overlay rebind skips them | Viewport.tsx:3613, 4736 | Low — 1-line fix each |
| BUG 2: decals paste as flat rect | `bakeDecalOntoDiffuse` draws at a hand-authored pixel rect, not actual UV polygon; DEFAULT_BADGE_RECT wrong for many vehicles | vehicle-uv-registry.ts (auto-derive from RGM UVs); king-tiger-decal-bake.ts (polygon clip) | Medium (auto-derive) / High (polygon clip) |

**Model UVs already loaded:** Yes. `rgm.ts` parses TEXCOORD0 per vertex for all submeshes. The
data needed for BUG 2's auto-derive fix is already in memory after model load. No additional SGA
reads or external data (ebps, Corsix data) are required for the short-term fix.

---

## BUG 2 deep-dive — real badge slot

_Evidence produced by `scripts/harness/extract-stock-diffuse-badge-slot.py`.  All 4 stock
diffuse atlases decoded from SGAs (ArtGermanEF / ArtWestGerman / ArtAEFSkins / ArtSovietEF)
to `/tmp/coh2-evidence/badge-slot/`. PNG artifacts saved there._

### Finding 1 — Stock CoH2 diffuse contains NO baked national insignia

Decoding the stock Tiger I (`ArtGermanEF.sga`), King Tiger (`ArtWestGerman.sga`), Sherman Easy 8
(`ArtAEFSkins.sga`) and T-34/76 (`ArtSovietEF.sga`) diffuse RGTs reveals **plain hull paint only
— no Balkenkreuz, no US star, no Soviet star baked into the atlas.** The badge is applied at
runtime by Essence's decal-projection system; the stock diffuse atlas simply has an empty panel
at the designated UV slot.

Consequence: the correct badge slot position can **only** be derived from (a) community skins
that bake the emblem into a diffuse override (Wikinger, SS Totenkopf etc.) — which is exactly
what the current hand-authored JSON files did — or (b) the RGM vertex UV coordinates of the
hull badge-panel face.

### Finding 2 — Current authored rects are CORRECTLY POSITIONED

All 9 hand-authored JSON rects in `src/lib/vehicle-uv-regions/` were verified against Wikinger
community-skin atlases (which DO bake the emblem into the diffuse). The centroid of each rect
matches the emblem centroid found in the Wikinger skin to within 1–30 px:

| Vehicle | Authored rect | Emblem centroid (Wikinger) | Centroid delta |
|---------|--------------|---------------------------|---------------|
| Tiger | (996,1128) 320×320 | (1156,1288) | 0 px (exact, per JSON note) |
| King Tiger | (410,1320) 360×340 | (590,1490) | 1 px (per SS Totenkopf data) |
| Sherman E8 | (1700,1236) 320×320 | (1860,1396) | 0 px (per JSON note) |
| T-34/76 | (0,342) 276×320 | (116,502) | ~27 px |

The authored rects are **badge-sized** (~300–360 px square, roughly 15–18% of the 2048² atlas),
encompassing the cross emblem PLUS tactical number above/below it — matching how real CoH2
community skins compose their hull panels.

### Finding 3 — DEFAULT_BADGE_RECT fails badly for vehicles without JSON entries

`DEFAULT_BADGE_RECT = {x:870, y:1150, w:320, h:312}` (mean of 8 authored hull-side rects) is
only a reasonable approximation for vehicles with hull-right atlas layouts similar to the Tiger /
King Tiger family. Centroid distances to the correct authored rect for each vehicle:

| Vehicle | DEFAULT centroid | Authored centroid | Centroid distance |
|---------|-----------------|------------------|--------------------|
| Tiger | (1030,1306) | (1156,1288) | **127 px** — acceptable fallback |
| King Tiger | (1030,1306) | (590,1490) | **477 px** — wrong quadrant |
| Sherman E8 | (1030,1306) | (1860,1396) | **835 px** — opposite side of atlas |
| T-34/76 | (1030,1306) | (138,502) | **1201 px** — diagonally opposite corner |

For vehicles not yet in the JSON registry, the DEFAULT produces a completely misplaced decal
for ~75% of vehicle types (non-German vehicles especially — their badge panels scatter across
all four atlas quadrants).

### Finding 4 — The "flat sticker" appearance has two separate causes

**Cause A — wrong rect for vehicles using DEFAULT (most non-authored vehicles):**
The decal lands at atlas coords that correspond to a completely different surface (e.g. engine
deck, turret floor, or literally off-mesh area). This looks like a floating flat quad because
the painted pixels are not on the hull side at all.

**Cause B — bounding-box bake even for correctly-placed rects:**
`bakeDecalOntoDiffuse()` draws the decal image as a flat rectangle into the atlas, scaled to
fill `{x,y,w,h}`. The hull-side UV island is NOT a perfect rectangle — it's the projection of
a curved/angled hull panel onto 2D UV space. The rect's bounding box overlaps neighbouring UV
islands (treads, engine deck edges, etc.). The decal therefore bleeds outside the visible hull
panel, producing a "sticker" look at the panel edges rather than a paint-on-metal look. This
affects ALL vehicles, including the 9 with hand-authored rects.

### Finding 5 — Actual in-game badge size vs authored rect size

The SS Totenkopf community skin for King Tiger documents its render script explicitly:
- Shield emblem: 70 px at atlas (420,1462)
- Balkenkreuz cross: **110 px** at atlas (536,1462)
- Tactical number: 110 px at atlas (732,1475)

The in-game CoH2 badge is therefore **~110 px** (≈5.4% of 2048) square. The authored rect at
360×340 is **3.3× wider and 3.1× taller** than the actual cross. The rect intentionally encompasses
the emblem+number combo as a "skin panel", which is the correct design for a skin editor that
bakes a full panel. If the user's decal artwork is a single-element badge (not a skin panel),
it will be scaled to 360×340 and appear 3× too large relative to the real in-game emblem.

### Concrete recommended fix

**Immediate (removes DEFAULT_BADGE_RECT misplacement for un-authored vehicles):**

In `Editor.tsx`, at model-load time (where `loadedMeshesRef.current` is set), add a
`deriveHullRightRect(vehicleId, meshes)` pass:

```ts
// Scan all submesh vertices where position.x > 0.5 (right-hull side), 
// material NOT matching /tread|wreck|schurzen/i, collect TEXCOORD0 UV min/max.
// Scale to 2048: rect = {x: minU*2048, y: minV*2048, w: (maxU-minU)*2048, h: (maxV-minV)*2048}
// Cache result per vehicleId; fall back to DEFAULT if mesh unavailable.
```

This eliminates the 477–1201 px DEFAULT misplacement for un-authored vehicles using only data
already in memory (no extra SGA reads). The geometry-based heuristic was previously attempted
but produced "near-full-atlas garbage" on merged meshes — the fix is to filter by both X>0
(right side) AND by submesh material name to exclude treads/wreck, not by the chassis mesh alone.

**Per-vehicle badge-only rect (removes over-scaling for badge-sized decals):**

Add an optional `badgeSlot` field alongside `hullSideRight` in each JSON file:

```json
"badgeSlot": {"x": 481, "y": 1407, "w": 110, "h": 110}
```

The bake pipeline can then use `badgeSlot` (if present) when the user's decal is a
single-emblem badge, and `hullSideRight` when it is a full skin-panel artwork. This removes
the 3× size mismatch for actual badge decals while preserving the existing wider rect for
panel-art use. King Tiger's `badgeSlot` is `{x:481, y:1407, w:110, h:110}` (centred on the
Balkenkreuz at atlas (536,1462)).

**Longer-term (removes bounding-box bleed):**

Replace `ctx.drawImage(decal, x, y, w, h)` in `bakeDecalOntoDiffuse()` with a polygon clip
path derived from the actual UV triangles of the right-hull submesh. This matches the 3D
surface shape exactly and eliminates bleed into neighbouring islands. Effort: high (requires
UV triangle extraction and clip path rendering), out of scope for a single bug fix.

**Feasibility summary:**

| Fix | Effort | Effect |
|-----|--------|--------|
| Auto-derive from RGM UVs (replaces DEFAULT) | Medium — 30–50 lines | Eliminates 477–1201 px misplacement for un-authored vehicles |
| Add `badgeSlot` to 9 JSON files | Low — data edit only | Removes 3× size mismatch for badge decals |
| UV-polygon clip path bake | High | Eliminates bounding-box bleed for all vehicles |

**Recommended sequence:** auto-derive first (biggest visible win, no data work), then `badgeSlot`
JSON entries for the King Tiger and Tiger (most-used vehicles), then UV polygon clip as a v2 feature.
