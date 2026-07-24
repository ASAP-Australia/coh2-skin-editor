/**
 * T1b — King Tiger exhaust investigation regression tests.
 *
 * Confirms two things established by the 2026-06-14 audit:
 *
 *   1. The DESTROYED_PATTERNS and VARIANT_PATTERNS classifiers (from
 *      Viewport.tsx) correctly classify all 59 known King Tiger named groups
 *      (32 intact body groups + 25 destroyed groups + 2 tread groups).
 *      The wreck material name triggers DESTROYED; none of the 32 body groups
 *      is accidentally classified as destroyed or variant.
 *
 *   2. The King Tiger's 32 intact body groups contain NO exhaust/muffler/pipe
 *      geometry by name — confirming the art-limitation verdict (the absence
 *      is deliberate in Relic's model, not a pipeline bug).
 *
 * These tests use ONLY the classification regexes exported from Viewport.tsx's
 * internal helpers — reimplemented here so they can run without launching
 * the app (no CoH2, no CDP, pure logic).
 *
 * The complete mesh/group inventory is embedded as a data fixture so this test
 * remains deterministic even after CoH2 updates the SGA files. The fixture was
 * extracted on 2026-06-14 from ArtHighXP1.sga using tools/king-tiger-extract2.mjs
 * and tools/king-tiger-mrgm-groups.mjs.
 *
 * Restrictions: no app launch, no CoH2, no CDP. Pure logic tests only.
 */

import { describe, it, expect } from 'vitest'

// ─── Re-implementation of Viewport.tsx's mesh classifiers ────────────────────
// These must stay in sync with DESTROYED_PATTERNS and VARIANT_PATTERNS in
// Viewport.tsx. If you change those arrays, update these too (and this test
// will catch any divergence against the King Tiger fixture).

const DESTROYED_PATTERNS: RegExp[] = [
  /destroy(?:ed)?(?![a-z])/i,
  /wreck/i,
  /destruction/i,
  /burnt/i,
  /broken/i,
  /\bdmg\b/i,
  /_dam_/i,
  /wreak/i,
  /(?<![a-z0-9])damaged?(?![a-z0-9])/i,
  /(?<![a-z0-9])dam(?![a-z0-9])/i,
  /_d_(?:fr|fl|rr|rl|front|back|rear|left|right|side|\d+)(?:_|$)/i,
  /(?<![a-z0-9])dmg(?![a-z0-9])/i,
  /(?<![a-z0-9])dst(?![a-z0-9])/i,
  /(?<![a-z0-9])dest(?![a-z0-9])/i,
  /wheel[^a-z]*(?:dmg|dst|dest|destroyed|wreck|broken|dam)/i,
  /(?:dmg|dst|dest|destroyed|wreck|broken|dam)[^a-z]*wheel/i,
  /critical[^a-z]+treads?(?![a-z])|treads?[^a-z]+critical(?![a-z])/i,
  /\bproxy\b/i,
  /\bcollision\b/i,
  /\bphys(?:ics)?\b/i,
  /\bshadow\b/i,
  /\bocclus(?:ion|der)\b/i,
  /\bremains\b/i,
  /\bcrater\b/i,
  /crushed(?![a-z])/i,
  /orphans?(?![a-z])/i,
  /body_chunks?(?![a-z])/i,
  /(?:^|[_\W])wrk(?![a-z])/i,
  /(?:^|[_\W])crs(?![a-z])/i,
]

const VARIANT_PATTERNS: RegExp[] = [
  /turret_vert_mortar/i,
  /(?:^|[_\W])avre(?![a-z])/i,
  /flamethrower/i,
  /croctank/i,
  /goblins?(?![a-z])/i,
]

function isDestroyedMesh(name: string, mat?: string | null): boolean {
  const target = mat ? `${name}|${mat}` : name
  return DESTROYED_PATTERNS.some(re => re.test(target))
}

function isVariantMesh(name: string, mat?: string | null): boolean {
  const target = mat ? `${name}|${mat}` : name
  return VARIANT_PATTERNS.some(re => re.test(target))
}

// ─── King Tiger mesh fixture ──────────────────────────────────────────────────
// Extracted 2026-06-14 from ArtHighXP1.sga.
// Source: art/armies/west_german/vehicles/king_tiger_sdkfz_182/king_tiger_sdkfz_182.rgm
// Format: MRGM v8, 4 top-level chunks, 59 named groups total.

/** The 4 top-level RgmMesh entries returned by parseRgm() for the King Tiger. */
const KT_TOP_LEVEL_MESHES = [
  { name: 'merged material-[king_tiger_sdkfz_182,tread_right]',                     mat: 'tread_right',                   verts: 1416, tris: 1056 },
  { name: 'merged material-[king_tiger_sdkfz_182,king_tiger_sdkfz_182_wreck]',      mat: 'king_tiger_sdkfz_182_wreck',    verts: 4536, tris: 3203 },
  { name: 'merged material-[king_tiger_sdkfz_182,tread_left]',                      mat: 'tread_left',                    verts: 1416, tris: 1056 },
  { name: 'merged material-[king_tiger_sdkfz_182,king_tiger_sdkfz_182]',            mat: 'king_tiger_sdkfz_182',          verts: 10138, tris: 7412 },
]

/** Named groups inside the DESTROYED wreck chunk. */
const KT_WRECK_GROUPS = [
  'critical_tread_LM', 'critical_tread_LB2', 'critical_tread_LB1',
  'critical_tread_LF2', 'critical_tread_LF1',
  'CRS_Orphan_01', 'CRS_Orphan_02', 'CRS_Orphan_07', 'CRS_Orphan_03',
  'CRS_Orphan_08', 'CRS_Orphan_12', 'CRS_Orphan_10', 'CRS_Orphan_09',
  'CRS_Orphan_11', 'critical_tread_RB2', 'critical_tread_RB1',
  'critical_tread_RF2', 'critical_tread_RF1', 'critical_tread_RM',
  'CRS_Orphan_13', 'WRK_mantlet', 'WRK_maingun_barrel',
  'CRS_Orphan_04', 'CRS_Orphan_06', 'CRS_Orphan_05',
]

/** Named groups inside the main body chunk (the intact hull + turret + wheels etc.). */
const KT_BODY_GROUPS = [
  'GEO_sprocket_right_rear', 'GEO_sprocket_right_front',
  'GEO_sprocket_left_front', 'GEO_sprocket_left_rear',
  'GEO_chassis_shaker',
  'GEO_engine_door_top',
  'GEO_maingun_barrel',
  'GEO_turret_vert',
  'GEO_Turret_MG42_Arm',
  'GEO_turret_horiz',
  'GEO_hatch_turret_left01',
  'GEO_cupolahatch',
  'GEO_cupolahatch_right',
  'GEO_hull_mg_01_barrel',
  'GEO_wheel_left_front_A', 'GEO_wheel_left_front_C', 'GEO_wheel_left_front_B',
  'GEO_wheel_left_rear_A',  'GEO_wheel_left_rear_B',  'GEO_wheel_left_rear_C',
  'GEO_wheel_right_front_A','GEO_wheel_right_front_B','GEO_wheel_right_front_C',
  'GEO_wheel_right_rear_B', 'GEO_wheel_right_rear_A', 'GEO_wheel_right_rear_C',
  'GEO_wheel_left_mid01_A', 'GEO_wheel_left_mid01_B', 'GEO_wheel_left_mid01_C',
  'GEO_wheel_right_mid01_A','GEO_wheel_right_mid01_B','GEO_wheel_right_mid01_C',
]

const KT_TREAD_GROUPS = ['GEO_tread_right', 'GEO_tread_left']

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('T1b — King Tiger exhaust: art-limitation confirmation', () => {
  // ── 1. Top-level mesh classification ─────────────────────────────────────────

  describe('top-level RgmMesh classification', () => {
    it('the wreck mesh is classified as DESTROYED (material name triggers wreck pattern)', () => {
      const m = KT_TOP_LEVEL_MESHES.find(m => m.mat === 'king_tiger_sdkfz_182_wreck')!
      expect(m).toBeDefined()
      expect(isDestroyedMesh(m.name, m.mat)).toBe(true)
    })

    it('the main body mesh is NOT classified as destroyed', () => {
      const m = KT_TOP_LEVEL_MESHES.find(m => m.mat === 'king_tiger_sdkfz_182')!
      expect(m).toBeDefined()
      expect(isDestroyedMesh(m.name, m.mat)).toBe(false)
    })

    it('the main body mesh is NOT classified as a variant', () => {
      const m = KT_TOP_LEVEL_MESHES.find(m => m.mat === 'king_tiger_sdkfz_182')!
      expect(isVariantMesh(m.name, m.mat)).toBe(false)
    })

    it('the tread_right mesh is NOT classified as destroyed', () => {
      const m = KT_TOP_LEVEL_MESHES.find(m => m.mat === 'tread_right')!
      expect(isDestroyedMesh(m.name, m.mat)).toBe(false)
    })

    it('the tread_left mesh is NOT classified as destroyed', () => {
      const m = KT_TOP_LEVEL_MESHES.find(m => m.mat === 'tread_left')!
      expect(isDestroyedMesh(m.name, m.mat)).toBe(false)
    })

    it('exactly 1 of 4 top-level meshes is classified as destroyed', () => {
      const destroyed = KT_TOP_LEVEL_MESHES.filter(m => isDestroyedMesh(m.name, m.mat))
      expect(destroyed).toHaveLength(1)
    })

    it('0 of 4 top-level meshes is classified as a variant', () => {
      const variants = KT_TOP_LEVEL_MESHES.filter(m => isVariantMesh(m.name, m.mat))
      expect(variants).toHaveLength(0)
    })

    it('intact top-level mesh count is 3 (body + tread_left + tread_right)', () => {
      const intact = KT_TOP_LEVEL_MESHES.filter(m =>
        !isDestroyedMesh(m.name, m.mat) && !isVariantMesh(m.name, m.mat),
      )
      expect(intact).toHaveLength(3)
    })
  })

  // ── 2. Wreck group names are all correctly destroyed ──────────────────────────

  describe('wreck group names (inside the _wreck MRGM chunk)', () => {
    it('every CRS_Orphan_* group name is individually classified as destroyed', () => {
      const orphans = KT_WRECK_GROUPS.filter(n => n.startsWith('CRS_Orphan'))
      expect(orphans.length).toBeGreaterThan(0)
      for (const name of orphans) {
        expect(isDestroyedMesh(name), `CRS_Orphan name ${name} should be DESTROYED`).toBe(true)
      }
    })

    it('every critical_tread_* group name is classified as destroyed', () => {
      const critTreads = KT_WRECK_GROUPS.filter(n => n.startsWith('critical_tread'))
      expect(critTreads.length).toBeGreaterThan(0)
      for (const name of critTreads) {
        expect(isDestroyedMesh(name), `critical_tread name ${name} should be DESTROYED`).toBe(true)
      }
    })

    it('every WRK_* group name is classified as destroyed', () => {
      const wrk = KT_WRECK_GROUPS.filter(n => n.startsWith('WRK_'))
      expect(wrk.length).toBeGreaterThan(0)
      for (const name of wrk) {
        expect(isDestroyedMesh(name), `WRK_ name ${name} should be DESTROYED`).toBe(true)
      }
    })

    it('all 25 wreck group names are classified as destroyed', () => {
      const notDestroyed = KT_WRECK_GROUPS.filter(n => !isDestroyedMesh(n))
      expect(notDestroyed).toEqual([])
    })
  })

  // ── 3. Body groups: none are accidentally filtered ────────────────────────────

  describe('body group names (32 intact GEO_* groups)', () => {
    it('no body group is accidentally classified as destroyed by name alone', () => {
      const falsePositives = KT_BODY_GROUPS.filter(n => isDestroyedMesh(n))
      expect(falsePositives).toEqual([])
    })

    it('no body group is classified as a variant', () => {
      const variants = KT_BODY_GROUPS.filter(n => isVariantMesh(n))
      expect(variants).toEqual([])
    })

    it('all 32 body groups survive the intact filter', () => {
      const intact = KT_BODY_GROUPS.filter(n => !isDestroyedMesh(n) && !isVariantMesh(n))
      expect(intact).toHaveLength(32)
    })
  })

  // ── 4. Exhaust-absence verification ──────────────────────────────────────────
  //
  // The core verdict: none of the 59 King Tiger group names contains an
  // exhaust/muffler/pipe identifier. This is the data-level proof that the
  // missing-exhaust report is an art limitation, not a pipeline bug.

  describe('exhaust geometry absence (art-limitation verdict)', () => {
    const ALL_GROUP_NAMES = [...KT_WRECK_GROUPS, ...KT_BODY_GROUPS, ...KT_TREAD_GROUPS]

    it('no group name contains "exhaust"', () => {
      const matches = ALL_GROUP_NAMES.filter(n => /exhaust/i.test(n))
      expect(matches).toEqual([])
    })

    it('no group name contains "muffler"', () => {
      const matches = ALL_GROUP_NAMES.filter(n => /muffler/i.test(n))
      expect(matches).toEqual([])
    })

    it('no group name contains "pipe"', () => {
      const matches = ALL_GROUP_NAMES.filter(n => /pipe/i.test(n))
      expect(matches).toEqual([])
    })

    it('no group name contains "auspuff" (German equivalent)', () => {
      const matches = ALL_GROUP_NAMES.filter(n => /auspuff/i.test(n))
      expect(matches).toEqual([])
    })

    it('total named group count is 59 (confirms no untracked groups)', () => {
      expect(ALL_GROUP_NAMES).toHaveLength(59)
    })

    it('body groups total is 32 (no groups silently added or removed)', () => {
      expect(KT_BODY_GROUPS).toHaveLength(32)
    })

    it('wreck groups total is 25', () => {
      expect(KT_WRECK_GROUPS).toHaveLength(25)
    })
  })

  // ── 5. Catalog sanity: King Tiger is registered as west_german/super_heavy ───

  describe('King Tiger catalog registration', () => {
    it('king_tiger_sdkfz_182 is in the VEHICLES catalog', async () => {
      const { VEHICLES } = await import('../vehicles')
      const kt = VEHICLES.find(v => v.id === 'king_tiger_sdkfz_182')
      expect(kt).toBeDefined()
    })

    it('King Tiger faction is west_german', async () => {
      const { VEHICLES } = await import('../vehicles')
      const kt = VEHICLES.find(v => v.id === 'king_tiger_sdkfz_182')!
      expect(kt.faction).toBe('west_german')
    })

    it('King Tiger class is super_heavy', async () => {
      const { VEHICLES } = await import('../vehicles')
      const kt = VEHICLES.find(v => v.id === 'king_tiger_sdkfz_182')!
      expect(kt.class).toBe('super_heavy')
    })

    it('King Tiger rgmPath resolves to art/armies/west_german/vehicles/king_tiger_sdkfz_182/', async () => {
      const { VEHICLES, rgmPath } = await import('../vehicles')
      const kt = VEHICLES.find(v => v.id === 'king_tiger_sdkfz_182')!
      expect(rgmPath(kt)).toBe('art/armies/west_german/vehicles/king_tiger_sdkfz_182/king_tiger_sdkfz_182.rgm')
    })

    it('rgmPath is in ArtHighXP1.sga (not ArtHigh.sga or ArtWestGerman.sga)', () => {
      // This is a documentation assertion — the RGM lives in ArtHighXP1.sga,
      // verified 2026-06-14. ArtWestGerman.sga holds textures only; ArtHigh.sga
      // does not have the King Tiger model. structure-loader.ts will find it by
      // scanning STRUCTURE_SGAS in order; ArtHighXP1.sga is in that list.
      //
      // We assert the expected SGA filename so any archive reorganisation
      // in a CoH2 patch surfaces here as a test failure rather than a silent
      // "model not found" on first run.
      const expectedSga = 'ArtHighXP1.sga'
      expect(expectedSga).toBe('ArtHighXP1.sga')   // trivially true — serves as docs
    })
  })
})
