# PROPOSED FIX — camo exclusion mask (NOT APPLIED)

Ready-to-apply change for the P0 in `PLAN.md` §2d. **Nothing in the repo has been modified.**
Approve and this becomes a single edit + test run.

- **File:** `src/lib/camo-mask.ts`
- **Function:** `buildCamoExclusionMask` (line 252) — one line changes, plus one new helper
- **Effect (measured, all 61 vehicles):** mean armor erased **88.7% → 0.16%**; vehicles >50% erased **55 → 0**

---

## Edit 1 — replace the exclusion filter (line 259)

**OLD**
```ts
  const excluded = meshes.filter(m => isExcludedSubmesh(m, vehicleId, faction))
```

**NEW**
```ts
  const excluded = meshes.filter(m => masksMainDiffuse(m, vehicleId, faction, size))
```

## Edit 2 — add the helper (place immediately above `buildCamoExclusionMask`)

```ts
/** Max fraction of the atlas a genuine fitting may occupy (see rule 4). */
const MAX_FITTING_ATLAS_FRACTION = 0.20
/** UV probe resolution — coverage is scale-invariant, so probe cheaply. */
const UV_PROBE_SIZE = 512

/**
 * Does this submesh actually sample the MAIN vehicle diffuse, such that masking
 * it protects real texels?  All four must hold:
 *
 *  1. it is classified as excluded (tracks / wheels / equipment / wreck), AND
 *  2. it is not `wreck` — wreck geometry REUSES the intact hull's UV layout, so
 *     masking it masks the hull itself (this was the primary bug: 21 wreck
 *     submeshes blanketed 91.6% of the Tiger's atlas), AND
 *  3. its UVs stay inside [0,1] — tiling UVs mean the submesh samples its own
 *     texture (treads use `<vehicle>_tread_dif.rgt` / the shared tread library,
 *     677 such paths exist), not the atlas, AND
 *  4. its own UV island covers < 20% of the atlas — a genuine fitting never
 *     spans the texture; anything that does is misclassified body geometry.
 *     This caught churchill/geo_hullgun_01+02, m36_tank_destroyer, sdkfz_250
 *     and us6_truck automatically, without naming them.
 *
 * Evidence + full 61-vehicle measurements: artifacts/e2e-plan/PLAN.md §2d–2e.
 */
function masksMainDiffuse(
  mesh: RgmMesh,
  vehicleId: string | undefined,
  faction: Faction | undefined,
  size: number,
): boolean {
  // 1
  if (!isExcludedSubmesh(mesh, vehicleId, faction)) return false
  // 2
  if (vehicleId && camoClassForMesh(mesh, vehicleId, faction) === 'wreck') return false

  const uvAttr = mesh.geometry?.getAttribute?.('uv')
  if (!uvAttr) return false
  const uv = uvAttr.array as ArrayLike<number>

  // 3 — reject tiling UVs
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uv[i * 2], v = uv[i * 2 + 1]
    if (u < u0) u0 = u; if (u > u1) u1 = u
    if (v < v0) v0 = v; if (v > v1) v1 = v
  }
  const TOL = 0.05
  if (!(u0 >= -TOL && u1 <= 1 + TOL && v0 >= -TOL && v1 <= 1 + TOL)) return false

  // 4 — reject islands that span the atlas (misclassified body geometry)
  const probe = document.createElement('canvas')
  probe.width = probe.height = UV_PROBE_SIZE
  const pctx = probe.getContext('2d')
  if (!pctx) return true              // cannot probe → keep (previous behaviour)
  pctx.clearRect(0, 0, UV_PROBE_SIZE, UV_PROBE_SIZE)
  pctx.fillStyle = '#ffffff'
  if (!rasterizeUvTriangles(pctx, mesh.geometry, UV_PROBE_SIZE)) return false
  const d = pctx.getImageData(0, 0, UV_PROBE_SIZE, UV_PROBE_SIZE).data
  let opaque = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 250) opaque++
  return opaque / (UV_PROBE_SIZE * UV_PROBE_SIZE) < MAX_FITTING_ATLAS_FRACTION
}
```

`size` is accepted for symmetry but unused — rule 4 deliberately probes at `UV_PROBE_SIZE` (~16× cheaper than 2048², and coverage is a ratio so the result is scale-invariant).

**Perf note:** rule 4 rasterises once per excluded submesh at 512². Tiger has 54 excluded submeshes ⇒ 54 cheap rasters per mask build. `buildCamoExclusionMask` is already called once per vehicle load, so this is acceptable; if it ever shows up in a profile, memoise per `(vehicleId, faction)`.

---

## Verification to run after applying

```bash
npx tsx artifacts/e2e-plan/diag-fix-rule.mts      # expect mean 0.16%, max 7.8%, >5%: 1
npx tsx scripts/verify-layer-a.mts                # expect 61 PASS / 0 FAIL
npm run typecheck && npm test
```

Then rebuild the override and re-measure the shipped artifact — **repainted area should rise from 7.60% to ≈57%** (`diag-decisive.mts`).

## Behaviour changes to expect

- **55 of 61 vehicles produce a 0% mask (null).** Correct — proven in PLAN §2e. `buildCamoExclusionMask` already returns `null` when nothing qualifies, and callers treat `null` as "no exclusion", so this path is already supported.
- **Merged-mesh vehicles: road wheels will receive camo**, since they live in the single body material and cannot be separated per-submesh. Structural limit, not a regression.
- `m21_mortar_halftrack` keeps a 7.1% mask — the `m1_81mm_mortar` submesh, correctly excluded.

## Tests that may need updating

`src/lib/__tests__/camo-mask.test.ts` asserts mask coverage/behaviour for sample vehicles. Any case asserting that **wreck** or **tiling track** submeshes contribute to the mask now legitimately changes. Update those to assert the new contract (wreck/tiling excluded), and add a regression test pinning **armor-erased ≈ 0** for tiger + churchill — that is the property that actually matters and was never covered.
