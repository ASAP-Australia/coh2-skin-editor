# Decal Badge-Slot Rect Coverage — Build Plan
**Self-contained brief. Implementer reads ONLY this file.**

---

## 1. Chosen Approach: Wikinger-Skin Visual Inspection (Manual + Scripted Verification)

**NOT the UV-heuristic path.** Doc 03 proves no authoritative RGM data exists:
- MRKS markers are for damage FX / animation, not badge placement (zero badge-named markers in tiger.rgm).
- The geometry UV-bbox heuristic was already proven to produce near-full-atlas garbage on merged hull meshes — explicitly ruled out in `vehicle-uv-registry.ts:18-23`.
- The only reliable ground truth is Wikinger community skin PNGs where Relic's artists placed the actual insignia.

**Why Wikinger-skin inspection beats the heuristic:** The 9 doc-04 rects plus 7 additional rects already authored (16 total in `src/lib/vehicle-uv-regions/`) all came from this method, are high/medium confidence, and the heuristic had no validated output. New rects must be derived the same way.

---

## 2. Current Coverage State

| Source | Vehicle IDs | Status |
|--------|-------------|--------|
| Registered in `JSON_REGISTRY` (vehicle-uv-registry.ts:65-77) | king_tiger_sdkfz_182, tiger, t34_76, m4a3e8_sherman_easy_8, su85, sherman_firefly, stug_iii, kv2_heavy_tank, panzerwerfer | 9 live overrides |
| JSON files authored but NOT yet registered | cromwell, kv1_heavy_tank, m10_tank_destroyer, m26_pershing, m36_tank_destroyer, m4a3_sherman_76mm, t34_85 | 7 files, 0 registered |
| No JSON, falling through to DEFAULT_BADGE_RECT | All remaining 45 vehicles | Approximate only |

**Total fleet: 61 vehicles** (doc 01 catalog). Fully authored: 16. Needing new work: 45.

---

## 3. Derivation Script Design

The derivation is a **two-phase pipeline**, not a geometry heuristic.

### Phase A — Wikinger Skin Extraction Script
**Script:** `scripts/extract-badge-rects.ts` (ts-node / tsx)

**Inputs:**
- SGA archive paths (doc 01: ArtHigh.sga, ArtHighXP1.sga, ArtHighXP2.sga, ArtArmies.sga, ArtGermanEF.sga, ArtSovietEF.sga, ArtAEF.sga, ArtBritish.sga, ArtWestGerman.sga)
- Wikinger skin pack SGAs (one per faction, same paths as stock — overrides at faction level)
- Vehicle catalog from `src/lib/vehicles.ts` VEHICLES array (61 entries, doc 01 table)

**Method:**
1. For each vehicle ID in the catalog, resolve the faction-specific Wikinger diffuse RGT via `rgmPath(v)` folder convention (doc 01: `art/armies/<faction>/vehicles/<folder>/<folder>_dif.rgt`).
2. Decode the RGT to a canvas at native resolution, then scale to 2048x2048 (or compute pixel coords directly at 2048x2048 if atlas is natively 2048x2048 — confirmed default for body diffuse, doc 02).
3. Run a **bright-pixel centroid scan** on the full atlas:
   - Convert to grayscale; threshold at luminance > 200 (insignia are white/bright on military OD green / olive).
   - Connected-component label; keep components with area in [500, 8000] px (empirical: real stars/crosses are 1200-3000 px at 2048²).
   - Take the largest qualifying component centroid.
   - Expand centroid by +/- 140px in both axes → candidate `{x, y, w:280, h:280}` rect.
4. Write candidate rect to `artifacts/badge-rects-derived/<vehicleId>.json` with `wikingerGroundTruth: false`, `_confidence: "derived"`.

**For vehicles with no Wikinger skin coverage:** flag as `needsManualReview: true` in the output JSON — these fall back to DEFAULT_BADGE_RECT.

### Phase B — JSON File + Registry Integration

**Script:** `scripts/write-vehicle-json.ts`

For each vehicle with a derived or manually-confirmed rect:
1. Write `src/lib/vehicle-uv-regions/<vehicleId>.json` in the standard schema:
   ```json
   { "semanticRegions": { "hullSideRight": { "x":N, "y":N, "w":N, "h":N } } }
   ```
   Use `hullFront` for T-34 family (t34_76, t_34_85 — glacis/fender placement, doc 04).
2. Add import + registry entry to `src/lib/vehicle-uv-registry.ts` (integration point: **vehicle-uv-registry.ts:38-77**).

The 9 doc-04 authored rects and 7 existing authored rects are kept as-is — they are overrides that take priority over any derived rect for their vehicle IDs.

---

## 4. Validation Method

### Against the 9 Doc-04 Ground-Truth Rects
Run the extraction script against all 9 known vehicles; compare derived centroid to ground-truth centroid:
- **Pass criterion:** |derived_cx - gt_cx| < 50px AND |derived_cy - gt_cy| < 50px (roughly ±2.5% of 2048).
- **Fail criterion:** diff > 80px in either axis → investigate (atlas tiling, multi-star ambiguity, dark skin tone).
- Tolerance 50px is conservative: real badge size is ~300x300px, so 50px is 1/6 of badge width.

**Expected pass rate for the 9:** ≥7/9. The two medium-confidence outliers (t34_76 front-glacis, panzerwerfer) may need manual override.

### For New Derived Rects
- Spot-check annotated PNGs: script should write `artifacts/badge-rects-derived/<vehicleId>_annotated.png` with rect drawn in red.
- Visual pass: red rect visibly encloses the national insignia (not track, not turret top, not empty hull).
- Plausibility gate: rect must be within `[0, 2048-w] x [0, 2048-h]` and `w` in [200, 420]px.

---

## 5. Fallback Strategy

For vehicles where the bright-pixel scan fails (no qualifying component, or rect is implausibly large > 500px wide):
1. **Per-faction fallback rect** — derived from the mean of authored rects for that faction:
   - OstHeer/OKW (German): mean of tiger, stug_iii, panzerwerfer, king_tiger_sdkfz_182 rects.
   - Soviet: mean of su85, kv2_heavy_tank, kv1_heavy_tank rects.
   - USF (aef): mean of m4a3e8_sherman_easy_8, m36_tank_destroyer, m10_tank_destroyer rects.
   - UKF (british): mean of sherman_firefly, cromwell rects.
2. If faction mean is unavailable: `DEFAULT_BADGE_RECT` (`{x:870, y:1150, w:320, h:312}`) — already in registry.

Fallback vehicles are flagged `"_confidence": "fallback"` in their JSON so they can be prioritized for future manual review.

---

## 6. Integration Point

**File:** `src/lib/vehicle-uv-registry.ts`
**Lines:** 38–77 (import block lines 38-46; JSON_REGISTRY object lines 65-77)

**Edit pattern for each new vehicle:**
```ts
// Line ~46 (after existing imports):
import <camelId>UvRegions from '@/lib/vehicle-uv-regions/<vehicleId>.json'

// Line ~77 (inside JSON_REGISTRY):
<vehicleId>: (<camelId>UvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
```

The existing 9 entries stay unchanged. The 7 already-authored but unregistered vehicles (cromwell, kv1_heavy_tank, m10_tank_destroyer, m26_pershing, m36_tank_destroyer, m4a3_sherman_76mm, t34_85) should be registered FIRST as a quick win — their JSON files already exist in `src/lib/vehicle-uv-regions/`.

**T-34 family exception:** use `VehicleUvJsonFront` interface and `.semanticRegions.hullFront` for t34_76 and t_34_85 (doc 04 convention).

---

## 7. Runnable Verification Plan

### Step 1: Register the 7 unregistered JSONs
- Add 7 imports + 7 registry entries to `vehicle-uv-registry.ts`.
- Run `npm run typecheck` — should pass with no new errors.
- Open editor for cromwell, kv1_heavy_tank, m10_tank_destroyer, m26_pershing, m36_tank_destroyer, m4a3_sherman_76mm, t34_85 — confirm badge renders on hull (not center-of-atlas smear).

### Step 2: Run extraction script against 9 ground-truth vehicles
- `npx tsx scripts/extract-badge-rects.ts --validate`
- Output: pass/fail table, centroid deltas. Expected: ≥7/9 within 50px.
- Annotated PNGs written to `artifacts/badge-rects-derived/` for visual inspection.

### Step 3: Run extraction script for all 61 vehicles
- `npx tsx scripts/extract-badge-rects.ts --all`
- Review flagged failures (`needsManualReview: true`) manually.
- For each flagged vehicle: open Wikinger skin PNG, locate insignia visually, hand-enter rect.

### Step 4: Generate and register all new JSONs
- `npx tsx scripts/write-vehicle-json.ts`
- Re-run typecheck; run `npm test` (existing unit tests in `src/lib/__tests__/vehicle-uv-registry.test.ts`).

### Visual Spot-Check Priority List (high-value, diverse classes)
1. `elefant` (OstHeer super-heavy — large hull, unusual shape)
2. `is2m_heavy_tank` (Soviet heavy)
3. `m5a1_stuart` (USF light — small hull)
4. `churchill` (UKF heavy — very wide hull)
5. `kubelwagen` (OKW utility — tiny, no turret)
6. `jagdtiger` (OKW super-heavy casemate)
7. `bren_carrier` (UKF utility — open-top)
8. `halftrack` (german/soviet shared id — verify faction disambiguation)

Open each in the editor, apply any decal badge, visually confirm it lands on the hull side panel and is not clipped, tiled, or offset onto turret/track/sky.

---

## 8. Expected Outcome

| Category | Count | Method |
|----------|-------|--------|
| Already registered (9 doc-04 rects) | 9 | Keep as-is |
| Quick-win: register existing JSONs | 7 | One edit pass to vehicle-uv-registry.ts |
| Script-derived clean rects | ~30-35 | Phase A extraction script |
| Script failures → faction fallback | ~5-10 | Per-faction mean rect |
| Manual review needed | ~5 | Visual inspection + hand-entry |
| **Total fleet** | **61** | |

Expected clean-derivation rate: **~55-60%** of the 45 remaining vehicles will have a qualifying bright-pixel component. Faction fallback covers ~15-20%. Manual review needed for ~5 vehicles (open-top carriers, casemates with unusual atlas layouts, shared-id vehicles).
