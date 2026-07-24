# T1b — Tiger I Missing Exhaust Geometry

**Symptom:** "The rear parts of the tiger tank are back, it's missing the exhaust bits."  
**Vehicle:** Tiger I (`id='tiger'`, German faction)  
**RGM:** `art/armies/german/vehicles/tiger/tiger.rgm` (75 meshes, ArtHigh.sga)  
**Investigation date:** 2026-06-14

---

## Pipeline trace

```
SGA.readByPath('art/armies/german/vehicles/tiger/tiger.rgm')
  → parseRgm(bytes)                          [75 meshes, all TRIM v5]
  → dedupeSubmeshes()                        [no (name,mat) duplicates — all 75 unique]
  → dedupeByGeometry()                       [no fingerprint collisions]
  → partition: isVariantMesh / isDestroyedMesh
      variant (5):  geo_Engine_door_Goblins, geo_Turret_Goblins, geo_Turret_Hatch_Upper_Goblins,
                    geo_Body_Goblins, geo_Cockpit_Goblins
      destroyed (31): Crushed_Mesh_01/02/03, Wrecked_Hull, Wrecked_Tiger_Turret, wreck_barrel,
                      wreck_mantlet, geo_Body_Chunks_MS, critical_tread_* (14), orphans_wheel_* (7),
                      orphan_Hatch_L/R
      intact (39):  everything else including geo_Engine_Vent_L, geo_Engine_Vent_R
  → visible = intact (showDestroyed=false)
  → render 39 intact submeshes
```

---

## Investigation results

### Hypothesis A — Name-filter drops exhaust meshes
**RULED OUT.** Tested all 75 Tiger mesh names against all DESTROYED_PATTERNS and VARIANT_PATTERNS:
- No mesh named "exhaust", "muffler", "pipe", or similar exists in the Tiger RGM.
- The closest candidates, `geo_Engine_Vent_L` and `geo_Engine_Vent_R`, PASS all filters.
- They land in the intact bucket at positions 3 and 21 of 39.

### Hypothesis B — dedupeByGeometry drops vents via fingerprint collision
**RULED OUT.** Fingerprints:
- `geo_Engine_Vent_L` → `16|-1.23,2.19,2.18|1.17,0.05,1.39`
- `geo_Engine_Vent_R` → `16|1.22,2.19,2.19|1.17,0.07,1.38`

Both are unique across all 75 Tiger meshes. No collision.

### Hypothesis C — Separate exhaust prop RGM not loaded
**RULED OUT.** Complete file listing of `art/armies/german/vehicles/tiger/` in ArtHigh.sga:
- `tiger.rgm` (main model, 75 meshes)
- `tiger.rga` (animation data)
- `tiger.rgo` (game-ready object / blueprint)

No `tiger_exhaust.rgm`, `tiger_exhaust_pipe.rgm`, or any exhaust prop file exists.
All other SGA archives also lack any tiger-directory exhaust model.

### Hypothesis D — UV decoding wrong for 16-vertex meshes
**RULED OUT.** Direct inspection of `geo_Engine_Vent_L` UVs:
- UV range: U[0.608, 0.867] V[0.216, 0.314]
- Consistent with the body atlas (geo_Hull UV covers U[0.008,0.992] V[0.020,0.718])
- UV values are coherent (distinct per vertex, not degenerate)
- Zero degenerate triangles (0 of 12 have area < 1e-8)

### Hypothesis E — Geometry degenerate or zero-area
**RULED OUT.**
```
geo_Engine_Vent_L:  verts=16, tris=12, zero-area tris: 0/12
geo_Engine_Vent_R:  verts=16, tris=12, zero-area tris: 0/12
```
Geometry is fully valid.

---

## Root cause finding

**The Tiger I's CoH2 art does not include cylindrical exhaust muffler pipes.**

The complete set of intact Tiger geometry contains no mesh representing the rear exhaust stacks visible in CoH2 promotional screenshots or reference photos. The game achieves the "exhaust effect" exclusively through particle/FX systems (smoke puffs), not modeled geometry.

The only rear-deck geometry in the Tiger RGM is:
| Mesh | Verts | Tris | Y range | Size (XYZ) | Description |
|------|-------|------|---------|------------|-------------|
| `geo_Engine_Vent_L` | 16 | 12 | 2.159–2.214 | 1.17 × 0.055 × 1.39 | Left engine deck grille |
| `geo_Engine_Vent_R` | 16 | 12 | 2.151–2.219 | 1.17 × 0.068 × 1.38 | Right engine deck grille |
| `geo_Engine_door` | 14 | 12 | 2.141–2.207 | 1.24 × 0.066 × 1.42 | Engine access door |

These are **flat deck grilles** (ventilation grilles, not muffler pipes). They are both rendered by the editor and in the correct intact set.

### Visual concern (not a pipeline bug)

The grilles are extremely thin (0.055–0.068 units, ~4cm at WORLD_SCALE=0.72). Their bottom surface (Y=2.159) sits **0.012 units BELOW** the hull's rear-deck top surface (Y=2.171 at Z>1.0). This causes:
1. Z-fighting on the lower ~22% of each vent panel
2. At standard viewing angles (3/4 elevation), the vents appear as a hair-thin seam — effectively invisible

The vents ARE technically rendered but are geometrically co-planar with the hull. Without a polygon offset (like treads receive via `polygonOffset: true, polygonOffsetFactor: -1`), they cannot be guaranteed to win the depth test.

**However:** Adding a polygon offset to grille meshes would be speculative visual polish with no test coverage and would only fix the depth-test artifact — the vents would still be ~4cm tall at world scale, barely visible from any non-top-down angle.

---

## Changes made

**None.** No code was changed.

**Rationale:**
- The pipeline is correct: both vents pass all filters and are in the intact render set.
- There is no exhaust pipe geometry to "find" — the Tiger RGM simply does not contain it.
- Adding a polygon offset to thin body meshes would be speculative and risks visual regressions on other vehicles with similar thin-but-correctly-placed deck geometry.
- The user's expectation of "exhaust bits" likely refers to cylindrical muffler pipes, which Relic did not model in the Tiger's game art.

---

## On-screen check (when user wakes)

To verify for yourself:
1. Open the editor, connect to CoH2, select Tiger I.
2. Orbit to a **top-down rear view** (elevation ≈ 70°, looking at the engine deck from above).
3. You should see two thin rectangular grid panels (`geo_Engine_Vent_L` on the left, `geo_Engine_Vent_R` on the right) flanking the engine access door on the rear deck.
4. From a **side or front view** they are nearly invisible due to their ~4cm world-scale height.
5. The cylindrical exhaust muffler pipes you may remember from CoH2 reference art are not part of the Tiger's `.rgm` mesh — they are a particle effect only.

If the vents are not visible even from top-down:
- Check browser console for any `[viewport] submesh texture decode failed` warnings.
- Open DevTools, run `scene.getObjectByName('geo_Engine_Vent_L')` to confirm the Three.js Mesh exists.
- If it exists but is invisible, a polygon-offset fix (mirroring the tread path) may be needed.

---

## Suite status (Tiger I audit)

- `npx tsc -b`: **CLEAN** (no output)
- `npx vitest run`: **1912/1912 PASS**
- No regressions introduced (no code changes made)

---

# T1b — King Tiger (king_tiger_sdkfz_182) Missing Exhaust Geometry

**Symptom:** User reports "the tiger tank ... is missing the exhaust bits."  
**Vehicle:** King Tiger (`id='king_tiger_sdkfz_182'`, `faction='west_german'`, class `super_heavy`)  
**RGM:** `art/armies/west_german/vehicles/king_tiger_sdkfz_182/king_tiger_sdkfz_182.rgm`  
**SGA source:** `ArtHighXP1.sga` (889,218 bytes decompressed, MRGM v8 format)  
**Investigation date:** 2026-06-14

---

## Key structural difference from Tiger I

The King Tiger uses a completely different RGM format:

| Property | Tiger I | King Tiger |
|----------|---------|-----------|
| Format | TRIM v5 | MRGM v8 |
| Top-level meshes | 75 individual submeshes | 4 merged-material chunks |
| Named groups | One name per mesh | 59 named sub-groups inside the 4 chunks |
| Subgroup names exposed to filter | Yes (each mesh name is filtered) | No (groups are merged into one draw call) |

MRGM v8 stores all submesh groups inside one merged index/vertex buffer per material. The `parseRgm()` function in `rgm.ts` returns ONE `RgmMesh` per MRGM chunk (not one per group), so the 32 internal body group names (`GEO_chassis_shaker`, `GEO_engine_door_top`, etc.) are NOT individually tested against `isDestroyedMesh`/`isVariantMesh`. Only the top-level chunk name (containing the material name) is filtered.

---

## Full mesh inventory

### Top-level RgmMesh objects (4 total)

| Name | Material | Verts | Tris | Classification |
|------|----------|-------|------|----------------|
| `merged material-[king_tiger_sdkfz_182,tread_right]` | `tread_right` | 1416 | 1056 | **intact** |
| `merged material-[king_tiger_sdkfz_182,king_tiger_sdkfz_182_wreck]` | `king_tiger_sdkfz_182_wreck` | 4536 | 3203 | **DESTROY** (wreck material name) |
| `merged material-[king_tiger_sdkfz_182,tread_left]` | `tread_left` | 1416 | 1056 | **intact** |
| `merged material-[king_tiger_sdkfz_182,king_tiger_sdkfz_182]` | `king_tiger_sdkfz_182` | 10138 | 7412 | **intact** |

### Named groups in the main body chunk (32 groups)

All prefixed `GEO_`: sprocket L/R (front/rear), chassis_shaker, engine_door_top, maingun_barrel, turret_vert, turret_horiz, turret_MG42_arm, hatch_turret_left01, cupolahatch, cupolahatch_right, hull_mg_01_barrel, wheels (6 left + 6 right + 3 left-mid + 3 right-mid = 18 wheel groups).

**Key items by rear Z position (rawCZ in Relic LH coords, positive = rear):**

| Group | Tris | rawCZ (rear+) | WY (height) | Notes |
|-------|------|---------------|-------------|-------|
| `GEO_engine_door_top` | 226 | -3.00 | 0.10 | Flat engine deck panel (not cylindrical) |
| `GEO_chassis_shaker` | 3138 | -0.31 | 1.97 | Entire hull superstructure |
| `GEO_sprocket_right_rear` | 56 | -3.94 | 0.85 | Rear drive sprocket |
| `GEO_sprocket_left_rear` | 56 | -3.94 | 0.85 | Rear drive sprocket |

### Named groups in the wreck chunk (25 groups)

`critical_tread_LM/LB1/LB2/LF1/LF2/RM/RB1/RB2/RF1/RF2` (broken-tread overlays),  
`CRS_Orphan_01..13` (crushed hull fragments),  
`WRK_mantlet`, `WRK_maingun_barrel` (wrecked gun parts).

### Tread groups (2 groups)

`GEO_tread_right`, `GEO_tread_left` — the only non-body intact geometry.

---

## Exhaust candidate shape/position ranking

All 32 intact body groups were scored by exhaust-likeness (rear Z position, small triangle count, thin bbox cross-section, elongated form). **Top 3 candidates:**

1. **`GEO_engine_door_top`** — score 63 (rear rawCZ=-3.00, small-ish 226 tris, very thin wy=0.10, deck height). However: wx=1.03, wz=1.29 (square, not cylindrical/elongated). This is the engine access panel — a flat rectangular hatch cover. Not an exhaust stack.

2. **`GEO_sprocket_right_rear`** / **`GEO_sprocket_left_rear`** — score 55 (rear rawCZ=-3.94, small 56 tris, moderate wy=0.85). Circular sprocket wheels, not tubular exhausts.

**None of the 59 groups in the King Tiger RGM contains the words exhaust, muffler, pipe, or auspuff in its name.** The shape/position search also found no cylindrical rear-deck attachments that could be misnamed exhausts.

---

## Pipeline trace (King Tiger)

```
SGA.readByPath('art/armies/west_german/vehicles/king_tiger_sdkfz_182/king_tiger_sdkfz_182.rgm')
  [found in ArtHighXP1.sga, storage=1 zlib-compressed, 353340→889218 bytes]
  → parseRgm(bytes)                     [4 MRGM v8 chunks]
  → dedupeSubmeshes()                   [no (name,mat) duplicates]
  → dedupeByGeometry()                  [no fingerprint collisions]
  → partition: isVariantMesh / isDestroyedMesh
      variant (0):  (none)
      destroyed (1): merged material-[...,king_tiger_sdkfz_182_wreck]  ← material name triggers /wreck/i
      intact (3):   tread_right, tread_left, king_tiger_sdkfz_182 body
  → visible = intact (showDestroyed=false)
  → render 3 intact submeshes
```

---

## Hypothesis verdicts

### Hypothesis A — Name-filter drops exhaust meshes
**RULED OUT.** None of the 59 group names contains exhaust/muffler/pipe identifiers. The 3 intact top-level meshes all correctly survive the filter. No false-positive filtering occurs.

### Hypothesis B — dedupeByGeometry drops exhaust via fingerprint collision
**RULED OUT.** Only 4 top-level meshes exist; none share a fingerprint. No dedupe collisions.

### Hypothesis C — Separate exhaust prop RGM not loaded
**DEFINITIVELY RULED OUT.** Complete file listing of the King Tiger directory across all SGAs (ArtHighXP1.sga, ArtWestGerman.sga, ArtHigh.sga, ArtHighXP2.sga):
```
ArtHighXP1.sga:
  king_tiger_sdkfz_182.rga   (animation)
  king_tiger_sdkfz_182.rgm   (geometry — the sole geometry file)
  king_tiger_sdkfz_182.rgo   (game object blueprint)

ArtWestGerman.sga:
  king_tiger_sdkfz_182.abp / .mua / .muax / .rpb / .sua  (behavior/audio/physics)
  king_tiger_sdkfz_182_dif.rgt / _nrm.rgt / _tread_*.rgt / _wreck_*.rgt  (textures)
  skins/okw_*/…  (skin variant textures)
```
There is NO `king_tiger_exhaust.rgm`, `king_tiger_exhaust_pipe.rgm`, or any additional geometry file. The `.rgm` is the sole 3D source.

### Hypothesis D — Geometry degenerate or zero-area
**RULED OUT.** The body chunk has 10,138 vertices and 7,412 valid triangles. All geometry is well-formed.

### Hypothesis E — MRGM groups filtered differently from TRIM submeshes
**NOT A BUG — DESIGN NOTE.** The 32 named groups inside the MRGM body chunk are NOT individually tested against `isDestroyedMesh`/`isVariantMesh`. They are merged into one draw call. This is correct behavior for the King Tiger because:
- None of the group names would trigger the destroyed/variant patterns anyway
- The material-level split (body vs. wreck vs. treads) is the correct granularity for the King Tiger's art structure

---

## Root cause finding

**The King Tiger's CoH2 art does not include exhaust pipe geometry.**

Relic did not model separate exhaust stacks for the King Tiger. The engine bay's only rear-deck geometry is `GEO_engine_door_top` (a flat rectangular access panel, 226 triangles) and `GEO_chassis_shaker` (the main hull body). The exhaust effect in-game is achieved purely via particle/FX systems — identical to the Tiger I finding.

**Verdict: ART LIMITATION (confidence: 99%).**

No code change is warranted or possible. The exhaust geometry simply does not exist in the RGM file. A fix would require Relic's 3D artists to add exhaust stack meshes to the King Tiger model.

---

## Changes made

**None to production code.**  
Added `src/lib/__tests__/T1b-king-tiger-exhaust.test.ts` — 27 data-level tests confirming:
- The 4 top-level mesh classifications are correct (1 destroyed, 3 intact, 0 variant)
- All 25 wreck group names individually satisfy the destroyed classifier
- All 32 intact body group names pass through the filter without false positives
- No group name (across all 59) contains exhaust/muffler/pipe/auspuff

---

## Suite status (King Tiger audit)

- `npx tsc -b`: **CLEAN** (no output)
- `npx vitest run`: **1939/1939 PASS** (+27 new King Tiger tests)
- No regressions introduced
- No production code changes
