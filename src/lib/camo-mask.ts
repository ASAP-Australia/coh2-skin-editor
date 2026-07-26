/**
 * camo-mask — build a UV-space EXCLUSION mask so procedural camo is painted
 * on armor surfaces (hull / turret / gun) ONLY, never on tracks, wheels,
 * running gear or stowed/wreck equipment.
 *
 * WHY: the procedural camo composites over the ENTIRE 2048² diffuse atlas.
 * Because tracks, road wheels and stowage share that same atlas (their UV
 * islands land inside the opaque body region), a naive `source-atop` camo
 * blobs paints camo onto them too — visually wrong. The engine paints camo
 * on armor plate only.
 *
 * WHAT: given a decoded RGM (RgmModel), rasterize the diffuse-UV (channel 0,
 * `geo.attributes.uv`) triangles of the EXCLUDED submeshes into a 2048²
 * canvas as OPAQUE WHITE, then dilate a few pixels so UV-island borders don't
 * leave camo halos. The returned canvas is meant to be used as a
 * `destination-out` erase over the camo layer:
 *
 *     // caller: draw vanilla, draw camo (source-atop), then:
 *     ctx.globalCompositeOperation = 'destination-out'
 *     ctx.drawImage(exclusionMask, 0, 0)   // erases camo on tracks/wheels/equip
 *     ctx.globalCompositeOperation = 'source-over'
 *
 * where the vanilla diffuse (drawn first, under the camo) shows through the
 * erased regions — so tracks/equipment stay byte-identical to vanilla.
 *
 * Classification (verified against real RGMs — Tiger, Panzer IV, Elefant,
 * T-34/76, Easy8, Cromwell — via the repo decoder):
 *
 *   • TRIM v5 vehicles (Tiger, Easy8, Stuart, …): one submesh per PART, with
 *     an EMPTY materialName. The submesh `name` is the discriminator, e.g.
 *     `geo_tread_left`, `geo_Wheel_L07`, `critical_tread_RM`, `orphans_wheel_03`,
 *     `GEO_sprocket_left_front`, `GEO_roller_right_rear`, `Crushed_Mesh_01`,
 *     `Wrecked_Hull`, `wreck_barrel`, `WRK_maingun_barrel`, `CRS_Orphan05`.
 *   • MRGM v8 merged vehicles (Panzer IV, Elefant, T-34/76, Cromwell, …): a
 *     handful of merged submeshes each carrying a real materialName, e.g.
 *     `tread_left`, `tread_right`, `tread_wrecks`, `Critical_Treads`,
 *     `Elefant_Tank_tread_L`, `T34_76_Healthy_Tread_R`, `panzer_iv_..._wreck`,
 *     `T34_76_Wrecked`. The main body material (`Elefant_Tank`, `T34_76_Healthy`,
 *     `panzer_iv_sdkfz_ausf_i`, `cromwell`) is ARMOR and is kept.
 *
 * We test BOTH the submesh `name` and its `materialName` against the exclusion
 * patterns so both structures are covered by a single pass.
 *
 * ── EXPLICIT PER-VEHICLE MAP (authoritative) ────────────────────────────────
 * `camo-vehicle-map.json` classifies EVERY submesh of EVERY known vehicle into
 * one of six classes — `armor` (camo painted) vs `tracks | wheels | equipment
 * | wreck | other-excluded` (camo erased). It was hand-verified against the
 * decoded RGM inventory (bbox / tri-count / UV signals). When a vehicle id is
 * supplied, this map is CONSULTED FIRST and takes precedence over the regex
 * patterns below. The patterns remain only as a FALLBACK for submeshes not in
 * the map (e.g. a brand-new vehicle added to the install before its row lands
 * in the map) — every fallback hit is `console.warn`ed so the gap is visible.
 *
 * KEY CONVENTION (must match how meshes present at runtime):
 *   • The inner map key is `materialName` when the mesh carries one (MRGM v8
 *     merged submeshes: `Elefant_Tank`, `tread_left`, …) else the submesh
 *     `name` (TRIM v5 per-part: `geo_tread_left`, `GEO_sprocket_left_front`,
 *     `Crushed_Mesh_01`, …). i.e. `key = mesh.materialName ?? mesh.name`.
 *     This is exactly the key `camoClassForMesh` computes, so both RGM
 *     structures resolve through one lookup.
 *   • The outer key is the vehicle id from `vehicles.ts`. The lone shared id
 *     `halftrack` (german Sd.Kfz.251 vs soviet Lend-Lease) is disambiguated as
 *     `halftrack@soviet` for the soviet variant — pass the faction so
 *     `vehicleMapKey` can route to the right row.
 */
import type { RgmMesh } from './rgm'
import type { Faction } from './vehicles'
import CAMO_VEHICLE_MAP_JSON from './camo-vehicle-map.json'

/**
 * Submesh/material name patterns that mark geometry as NON-armor — camo must
 * be erased from these UV regions. Exported + documented so it stays tunable.
 *
 * Covers, verified against real RGMs:
 *   - tracks / treads:      geo_tread_left, geo_Front_treads, critical_tread_RM,
 *                           tread_left, Elefant_Tank_tread_L, T34_76_Healthy_Tread_R,
 *                           Critical_Treads, tread_wrecks, Brummbar_Tread_Left
 *   - road wheels / running gear: geo_Wheel_L07, orphans_wheel_03,
 *                           GEO_sprocket_left_front, GEO_roller_right_rear
 *   - wreck / destroyed / debris: Wrecked_Hull, wreck_barrel, WRK_maingun_barrel,
 *                           Crushed_Mesh_01, panzer_iv_..._wreck, T34_76_Wrecked,
 *                           CRS_Orphan05 (crushed-remains orphan panels)
 *
 * NOTE: `orphan`/`orphans` here means the crushed-remains debris pieces
 * (orphans_wheel_*, CRS_Orphan*, orphan_Hatch_*) that Relic ships as part of
 * the destruction set — all NON-armor. The main hull/turret/gun submeshes never
 * match these patterns.
 */
export const CAMO_EXCLUDE_PATTERNS: readonly RegExp[] = [
  // Tracks / treads (all naming variants across TRIM v5 + MRGM v8)
  /tread/i,
  /track/i,
  // Road wheels, sprockets, rollers, return-idlers (running gear).
  // NOTE: no leading \b — names use '_' separators ('GEO_roller_right'), and
  // '_' is a regex word char so \b would NOT match at 'GEO_roller'.
  /wheel/i,
  /sprocket/i,
  /roller/i,
  /idler/i,
  /bogie/i,
  // Wreck / destroyed / crushed debris variants
  /wreck/i,
  /wreak/i, // Relic's "wreak" typo (see Viewport DESTROYED_PATTERNS)
  /wrk_/i,  // 'WRK_maingun_barrel' etc. (Easy8 wreck-part prefix)
  /crushed/i,
  /crs_orphan/i,
  /orphan/i,
  /destroy/i,
  /destruction/i,
  /broken/i,
  /debris/i,
]

/**
 * The six camo classes. `armor` is the ONLY painted class; every other class is
 * excluded (camo erased, vanilla restored). `other-excluded` is a catch-all
 * bucket reserved for future non-armor parts that don't fit the named buckets.
 */
export type CamoClass =
  | 'armor'
  | 'tracks'
  | 'wheels'
  | 'equipment'
  | 'wreck'
  | 'other-excluded'

/** Classes whose UV islands must be ERASED from the camo layer (non-armor). */
export const EXCLUDED_CLASSES: ReadonlySet<CamoClass> = new Set<CamoClass>([
  'tracks',
  'wheels',
  'equipment',
  'wreck',
  'other-excluded',
])

/**
 * Explicit per-vehicle classification map: `{ vehicleId: { submeshKey: class } }`.
 * `submeshKey` = `mesh.materialName ?? mesh.name` (see KEY CONVENTION above).
 * Authoritative — consulted before the regex fallback.
 */
export const CAMO_VEHICLE_MAP = CAMO_VEHICLE_MAP_JSON as Record<
  string,
  Record<string, CamoClass>
>

/**
 * The lookup key `camo-mask` uses for a mesh: material name if present, else the
 * hierarchy name. Matches the key form baked into `camo-vehicle-map.json`.
 */
export function meshMapKey(mesh: Pick<RgmMesh, 'name' | 'materialName'>): string {
  return mesh.materialName || mesh.name || ''
}

/**
 * Resolve the outer (vehicle) map key. All ids map to themselves EXCEPT the
 * shared `halftrack` id, whose soviet Lend-Lease variant is stored under
 * `halftrack@soviet` (the german Sd.Kfz.251 keeps the bare `halftrack`).
 */
export function vehicleMapKey(vehicleId: string, faction?: Faction): string {
  if (vehicleId === 'halftrack' && faction === 'soviet') return 'halftrack@soviet'
  return vehicleId
}

/**
 * Resolve a mesh's camo class for a given vehicle.
 *  1. EXPLICIT map wins: `CAMO_VEHICLE_MAP[vehicleKey][meshMapKey]`.
 *  2. FALLBACK to the regex patterns when the mesh is not in the map — every
 *     such miss is `console.warn`ed (future-proofing for un-mapped vehicles).
 * Returns the class, or `null` when no vehicle context is available AND the
 * caller only wants the boolean helper (see `isExcludedSubmesh`).
 */
export function camoClassForMesh(
  mesh: Pick<RgmMesh, 'name' | 'materialName'>,
  vehicleId?: string,
  faction?: Faction,
): CamoClass {
  const key = meshMapKey(mesh)
  if (vehicleId) {
    const row = CAMO_VEHICLE_MAP[vehicleMapKey(vehicleId, faction)]
    const cls = row?.[key]
    if (cls) return cls
    // Un-mapped submesh for a known/unknown vehicle → fall through to patterns
    // and warn so the coverage gap is visible in the console.
    if (typeof console !== 'undefined') {
      console.warn(
        `[camo-mask] no explicit class for submesh "${key}" on vehicle ` +
          `"${vehicleMapKey(vehicleId, faction)}" — falling back to name/material ` +
          `patterns. Add it to camo-vehicle-map.json.`,
      )
    }
  }
  // Pattern fallback: excluded → best-effort bucket, else armor.
  return classifyByPattern(mesh)
}

/**
 * Best-effort class from the regex patterns alone (no explicit map). Used as the
 * fallback path and by `isExcludedSubmesh` when no vehicle context is supplied.
 */
function classifyByPattern(mesh: Pick<RgmMesh, 'name' | 'materialName'>): CamoClass {
  const name = mesh.name ?? ''
  const mat = mesh.materialName ?? ''
  const hay = `${name}\n${mat}`
  if (/tread|track/i.test(hay)) return 'tracks'
  if (/wheel|sprocket|roller|idler|bogie/i.test(hay)) return 'wheels'
  if (/wreck|wreak|wrk_|crushed|crs_orphan|orphan|destroy|destruction|broken|debris/i.test(hay)) {
    return 'wreck'
  }
  return 'armor'
}

/**
 * True if a submesh must be excluded (camo erased). Prefers the EXPLICIT map
 * when a `vehicleId` is supplied; otherwise falls back to the regex patterns
 * (legacy behaviour, used by tests and callers without vehicle context).
 */
export function isExcludedSubmesh(
  mesh: Pick<RgmMesh, 'name' | 'materialName'>,
  vehicleId?: string,
  faction?: Faction,
): boolean {
  if (vehicleId) {
    return EXCLUDED_CLASSES.has(camoClassForMesh(mesh, vehicleId, faction))
  }
  // No vehicle context: pure pattern test (unchanged from the original helper).
  const name = mesh.name ?? ''
  const mat = mesh.materialName ?? ''
  return (
    CAMO_EXCLUDE_PATTERNS.some(re => re.test(name)) ||
    CAMO_EXCLUDE_PATTERNS.some(re => re.test(mat))
  )
}

/** Default mask resolution — matches the 2048² diffuse atlas. */
export const MASK_SIZE = 2048

/** Max fraction of the atlas a genuine fitting may occupy (see rule 4). */
const MAX_FITTING_ATLAS_FRACTION = 0.20
/** UV probe resolution — coverage is a ratio, so probe cheaply (~16x faster than 2048²). */
const UV_PROBE_SIZE = 512

/**
 * Does this submesh actually sample the MAIN vehicle diffuse, such that masking
 * it protects real texels?  All four must hold:
 *
 *  1. it is classified as excluded (tracks / wheels / equipment / wreck), AND
 *  2. it is NOT `wreck` — wreck geometry REUSES the intact hull's UV layout, so
 *     masking it masks the hull itself. This was the primary bug: 21 wreck
 *     submeshes blanketed 91.6% of the Tiger's atlas, and across the fleet the
 *     mask erased 88.7% of ARMOR on average (55/61 vehicles >50%), AND
 *  3. its UVs stay inside [0,1] — tiling UVs mean the submesh samples its own
 *     texture, not the atlas. Treads use `<vehicle>_tread_dif.rgt` or the shared
 *     library `art/armies/shared_textures/treads/*` (677 such paths exist); a
 *     mesh sampling the 1:1 atlas cannot have UVs outside [0,1], AND
 *  4. its own UV island covers < 20% of the atlas — a genuine fitting never
 *     spans the texture; anything that does is misclassified body geometry.
 *     This caught churchill/geo_hullgun_01+02, m36_tank_destroyer, sdkfz_250
 *     and us6_truck automatically, without naming them.
 *
 * Measured effect: mean armor erased 88.7% -> 0.16%; vehicles >5%: 59 -> 1.
 * Evidence + full 61-vehicle measurements: artifacts/e2e-plan/PLAN.md §2d-2e.
 */
function masksMainDiffuse(
  mesh: RgmMesh,
  vehicleId: string | undefined,
  faction: Faction | undefined,
): boolean {
  // 1 — must be an excluded class at all
  if (!isExcludedSubmesh(mesh, vehicleId, faction)) return false
  // 2 — wreck shares the intact hull's UVs; masking it masks the hull
  if (vehicleId && camoClassForMesh(mesh, vehicleId, faction) === 'wreck') return false

  const uvAttr = mesh.geometry?.getAttribute?.('uv')
  if (!uvAttr) return false
  const uv = uvAttr.array as ArrayLike<number>

  // 3 — reject tiling UVs (submesh samples its own texture)
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uv[i * 2], v = uv[i * 2 + 1]
    if (u < u0) u0 = u
    if (u > u1) u1 = u
    if (v < v0) v0 = v
    if (v > v1) v1 = v
  }
  const TOL = 0.05
  if (!(u0 >= -TOL && u1 <= 1 + TOL && v0 >= -TOL && v1 <= 1 + TOL)) return false

  // 4 — reject islands that span the atlas (misclassified body geometry)
  const probe = document.createElement('canvas')
  probe.width = probe.height = UV_PROBE_SIZE
  const pctx = probe.getContext('2d')
  if (!pctx) return true // cannot probe → keep (previous behaviour)
  pctx.clearRect(0, 0, UV_PROBE_SIZE, UV_PROBE_SIZE)
  pctx.fillStyle = '#ffffff'
  if (!rasterizeUvTriangles(pctx, mesh.geometry, UV_PROBE_SIZE)) return false
  const d = pctx.getImageData(0, 0, UV_PROBE_SIZE, UV_PROBE_SIZE).data
  let opaque = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 250) opaque++
  return opaque / (UV_PROBE_SIZE * UV_PROBE_SIZE) < MAX_FITTING_ATLAS_FRACTION
}

/**
 * Build a 2048² EXCLUSION mask canvas: opaque white where camo must be erased
 * (tracks / wheels / running gear / wreck / stowed-equipment UV islands),
 * transparent elsewhere (armor). Returns `null` when the meshes have NO excluded
 * submeshes with usable UVs (nothing to erase — caller keeps legacy behaviour).
 *
 * @param meshes    Decoded RGM submeshes (RgmModel.meshes).
 * @param vehicleId Vehicle id from vehicles.ts — routes exclusion through the
 *                  EXPLICIT map. Omit to fall back to pure pattern matching.
 * @param faction   Faction hint, only needed to disambiguate the shared
 *                  `halftrack` id (german vs soviet). Optional otherwise.
 * @param size      Mask edge length (default 2048).
 * @param dilatePx  Pixels of dilation around each island so UV-border bleed does
 *                  not leave camo halos on the boundary of tracks/equipment.
 */
export function buildCamoExclusionMask(
  meshes: readonly RgmMesh[],
  vehicleId?: string,
  faction?: Faction,
  size: number = MASK_SIZE,
  dilatePx = 4,
): HTMLCanvasElement | null {
  const excluded = meshes.filter(m => masksMainDiffuse(m, vehicleId, faction))
  if (excluded.length === 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#ffffff'

  let drewAny = false
  for (const mesh of excluded) {
    if (rasterizeUvTriangles(ctx, mesh.geometry, size)) drewAny = true
  }
  if (!drewAny) return null

  if (dilatePx > 0) dilateMask(ctx, size, dilatePx)
  return canvas
}

/**
 * Fill every UV0 triangle of `geo` into `ctx` (white). Uses the same UV
 * convention as uv-wireframe.ts / the diffuse sampler: the stored `uv`
 * attribute is (u, 1 - v_raw), so atlas pixel = (u * size, (1 - y) * size).
 * Returns true if at least one triangle was drawn.
 */
function rasterizeUvTriangles(
  ctx: CanvasRenderingContext2D,
  geo: RgmMesh['geometry'],
  size: number,
): boolean {
  const uvAttr = geo.getAttribute('uv')
  if (!uvAttr) return false
  const uv = uvAttr.array as ArrayLike<number>
  const index = geo.getIndex()

  const px = (i: number) => uv[i * 2] * size
  // y stored as (1 - v_raw); atlas row = (1 - y) * size to match flipY=true.
  const py = (i: number) => (1 - uv[i * 2 + 1]) * size

  const tri = (a: number, b: number, c: number) => {
    ctx.beginPath()
    ctx.moveTo(px(a), py(a))
    ctx.lineTo(px(b), py(b))
    ctx.lineTo(px(c), py(c))
    ctx.closePath()
    ctx.fill()
  }

  let drew = false
  if (index) {
    const idx = index.array as ArrayLike<number>
    for (let t = 0; t + 2 < idx.length; t += 3) {
      tri(idx[t], idx[t + 1], idx[t + 2])
      drew = true
    }
  } else {
    const vcount = uvAttr.count
    for (let v = 0; v + 2 < vcount; v += 3) {
      tri(v, v + 1, v + 2)
      drew = true
    }
  }
  return drew
}

/**
 * Grow the opaque region by `radius` px so thin UV islands / island borders are
 * fully covered and no 1-px camo halo survives at the boundary. Cheap
 * box-dilation on the alpha channel (max over a (2r+1)² neighbourhood,
 * separated into an H pass then a V pass).
 */
function dilateMask(ctx: CanvasRenderingContext2D, size: number, radius: number): void {
  const img = ctx.getImageData(0, 0, size, size)
  const a = img.data
  const alpha = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i++) alpha[i] = a[i * 4 + 3]

  const tmp = new Uint8Array(size * size)
  // Horizontal pass
  for (let y = 0; y < size; y++) {
    const row = y * size
    for (let x = 0; x < size; x++) {
      let m = 0
      const lo = Math.max(0, x - radius)
      const hi = Math.min(size - 1, x + radius)
      for (let k = lo; k <= hi; k++) {
        const v = alpha[row + k]
        if (v > m) m = v
      }
      tmp[row + x] = m
    }
  }
  // Vertical pass
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      let m = 0
      const lo = Math.max(0, y - radius)
      const hi = Math.min(size - 1, y + radius)
      for (let k = lo; k <= hi; k++) {
        const v = tmp[k * size + x]
        if (v > m) m = v
      }
      const o = (y * size + x) * 4
      // Opaque white where dilated alpha is set.
      a[o] = 255; a[o + 1] = 255; a[o + 2] = 255; a[o + 3] = m
    }
  }
  ctx.putImageData(img, 0, 0)
}
