/**
 * camo-mask.test.ts
 *
 * Unit tests for the armor-only camo exclusion mask (src/lib/camo-mask.ts):
 *   - Classification: real Tiger / MRGM submesh names are excluded vs kept.
 *   - buildCamoExclusionMask returns null when nothing is excluded.
 *   - The mask has >0 coverage over the excluded UV island and 0 over armor.
 *   - Compose semantics: after drawing camo then restoring vanilla via the
 *     mask (destination-in patch), the excluded region stays byte-identical to
 *     vanilla while the armor region shows camo.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BufferGeometry, BufferAttribute } from 'three'
import {
  buildCamoExclusionMask,
  isExcludedSubmesh,
  camoClassForMesh,
  meshMapKey,
  vehicleMapKey,
  CAMO_EXCLUDE_PATTERNS,
  CAMO_VEHICLE_MAP,
  EXCLUDED_CLASSES,
  type CamoClass,
} from '../camo-mask'
import { VEHICLES } from '../vehicles'
import type { RgmMesh } from '../rgm'

// ---------------------------------------------------------------------------
// Helpers — build a fake RgmMesh whose UV0 covers a given axis-aligned rect in
// UV space [u0,u1]×[v0,v1] (two triangles). The stored uv convention matches
// the real decoder: uv = (u, 1 - v_raw) so atlas row = (1 - y) * size.
// We pass the STORED y directly (already 1 - v_raw) to control the atlas rect.
// ---------------------------------------------------------------------------
function rectMesh(
  name: string,
  materialName: string | null,
  u0: number, y0: number, u1: number, y1: number,
): RgmMesh {
  const geo = new BufferGeometry()
  // 4 corners: (u0,y0) (u1,y0) (u1,y1) (u0,y1)
  const uv = new Float32Array([u0, y0, u1, y0, u1, y1, u0, y1])
  // positions unused by the mask, but geometry needs something.
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1))
  return { name, geometry: geo, materialName }
}

// Sample the mask alpha at atlas pixel (px, py) → 0..255.
function alphaAt(mask: HTMLCanvasElement, px: number, py: number): number {
  const d = mask.getContext('2d')!.getImageData(px, py, 1, 1).data
  return d[3]
}

// ---------------------------------------------------------------------------
// Classification — verified against real RGM submesh / material names.
// ---------------------------------------------------------------------------

describe('isExcludedSubmesh — real names', () => {
  const excludedNames = [
    // TRIM v5 per-part (empty materialName): name is the discriminator
    'geo_tread_left', 'geo_tread_right', 'geo_Front_treads',
    'critical_tread_RM', 'critical_tread_LB1',
    'geo_Wheel_L07', 'geo_Wheel_R01', 'orphans_wheel_03',
    'GEO_sprocket_left_front', 'GEO_roller_right_rear',
    'Crushed_Mesh_01', 'Wrecked_Hull', 'wreck_barrel', 'wreck_mantlet',
    'WRK_maingun_barrel', 'CRS_Orphan05', 'orphan_Hatch_R',
  ]
  for (const n of excludedNames) {
    it(`excludes "${n}"`, () => {
      expect(isExcludedSubmesh({ name: n, materialName: null })).toBe(true)
    })
  }

  const excludedMats = [
    // MRGM v8 merged: materialName is the discriminator
    'tread_left', 'tread_right', 'tread_wrecks', 'Critical_Treads',
    'Elefant_Tank_tread_L', 'T34_76_Healthy_Tread_R',
    'panzer_iv_sdkfz_ausf_i_wreck', 'T34_76_Wrecked', 'cromwell_wreck',
  ]
  for (const m of excludedMats) {
    it(`excludes material "${m}"`, () => {
      expect(isExcludedSubmesh({
        name: `merged material-[x,${m}]`, materialName: m,
      })).toBe(true)
    })
  }

  const armorNames = [
    'geo_Hull', 'geo_Turret', 'geo_Turret_Barrel', 'geo_Turret_Back',
    'geo_Hull_Hatch_L', 'geo_Engine_door', 'GEO_chassis_shaker',
    'GEO_maingun_barrel', 'GEO_cupolahatch', 'GEO_hatch_hull_left',
  ]
  for (const n of armorNames) {
    it(`keeps armor "${n}"`, () => {
      expect(isExcludedSubmesh({ name: n, materialName: null })).toBe(false)
    })
  }

  const armorMats = ['Elefant_Tank', 'T34_76_Healthy', 'panzer_iv_sdkfz_ausf_i', 'cromwell']
  for (const m of armorMats) {
    it(`keeps armor material "${m}"`, () => {
      expect(isExcludedSubmesh({
        name: `merged material-[x,${m}]`, materialName: m,
      })).toBe(false)
    })
  }

  it('CAMO_EXCLUDE_PATTERNS is a non-empty tunable constant', () => {
    expect(CAMO_EXCLUDE_PATTERNS.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Mask coverage
// ---------------------------------------------------------------------------

describe('buildCamoExclusionMask', () => {
  it('returns null when no submesh is excluded (all armor)', () => {
    const meshes = [
      rectMesh('geo_Hull', null, 0, 0, 1, 1),
      rectMesh('geo_Turret', null, 0, 0, 0.5, 0.5),
    ]
    expect(buildCamoExclusionMask(meshes, undefined, undefined, 128, 0)).toBeNull()
  })

  it('has >0 coverage over the excluded island and 0 over armor', () => {
    const SIZE = 256
    // Armor hull covers the top half (stored y in [0.5,1] → atlas rows [0,128)).
    // Track strip: stored y in [0,0.15] → atlas rows [217,256). Kept under
    // MAX_FITTING_ATLAS_FRACTION (20%) — an island spanning half the atlas is
    // what rule 4 now rejects as misclassified body geometry.
    const meshes = [
      rectMesh('geo_Hull', null, 0, 0.5, 1, 1),
      rectMesh('geo_tread_left', null, 0, 0, 1, 0.15),
    ]
    const mask = buildCamoExclusionMask(meshes, undefined, undefined, SIZE, 0)!
    expect(mask).not.toBeNull()
    // Track region (bottom strip, py≈240) → opaque (excluded).
    expect(alphaAt(mask, 128, 240)).toBeGreaterThan(0)
    // Armor region (top of atlas, py≈40) → transparent (kept).
    expect(alphaAt(mask, 128, 40)).toBe(0)
  })

  it('dilation grows the excluded region', () => {
    const SIZE = 256
    const meshes = [
      rectMesh('geo_Hull', null, 0, 0.5, 1, 1),
      // a thin excluded strip so dilation is observable at its border
      rectMesh('geo_Wheel_L01', null, 0.4, 0.0, 0.6, 0.1),
    ]
    const noDilate = buildCamoExclusionMask(meshes, undefined, undefined, SIZE, 0)!
    const dilated = buildCamoExclusionMask(meshes, undefined, undefined, SIZE, 6)!
    // Just above the strip's atlas edge — the dilated mask should reach there.
    // Strip stored y in [0,0.1] → atlas rows [230,256). py=228 is just outside.
    const px = 128
    expect(alphaAt(noDilate, px, 226)).toBe(0)
    expect(alphaAt(dilated, px, 226)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Compose semantics — camo then vanilla-restore leaves tracks vanilla.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// REGRESSION — the property that actually matters, and that was never pinned.
//
// A shipped P0 (2026-07-26) erased 88.7% of ARMOR camo on average across all
// 61 vehicles — 55 of them above 50%, several at 100% — while this very suite
// stayed green, because every test only asserted the mask did *something*.
// These tests pin ARMOR PROTECTION, not mask existence.
// See artifacts/e2e-plan/PLAN.md §2d and wiki coh2-camo-exclusion-mask.
// ---------------------------------------------------------------------------

describe('REGRESSION: the mask must never erase armor', () => {
  const SIZE = 256
  /** Fraction of the armor island that the mask covers (0 = perfect). */
  function armorErasedFraction(
    meshes: RgmMesh[],
    armor: RgmMesh[],
    vehicleId?: string,
    faction?: Parameters<typeof buildCamoExclusionMask>[2],
  ): number {
    const mask = buildCamoExclusionMask(meshes, vehicleId, faction, SIZE, 0)
    if (!mask) return 0 // nothing masked ⇒ no armor erased
    const md = mask.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data
    // rasterise armor alone for the reference island
    const ac = document.createElement('canvas')
    ac.width = ac.height = SIZE
    const actx = ac.getContext('2d')!
    actx.fillStyle = '#fff'
    for (const m of armor) {
      const uv = m.geometry.getAttribute('uv')!.array as ArrayLike<number>
      const idx = m.geometry.getIndex()!.array as ArrayLike<number>
      for (let t = 0; t + 2 < idx.length; t += 3) {
        actx.beginPath()
        for (let k = 0; k < 3; k++) {
          const i = idx[t + k]
          const x = uv[i * 2] * SIZE, y = (1 - uv[i * 2 + 1]) * SIZE
          k === 0 ? actx.moveTo(x, y) : actx.lineTo(x, y)
        }
        actx.closePath(); actx.fill()
      }
    }
    const ad = actx.getImageData(0, 0, SIZE, SIZE).data
    let armorPx = 0, erased = 0
    for (let i = 3; i < ad.length; i += 4) {
      if (ad[i] < 250) continue
      armorPx++
      if (md[i] >= 250) erased++
    }
    return armorPx ? erased / armorPx : 0
  }

  it('WRECK submeshes that reuse the hull UVs must NOT erase armor', () => {
    // This is the exact shape of the shipped bug: wreck geometry reuses the
    // intact hull's UV layout, so masking `wreck` masked the hull itself.
    const hull = rectMesh('geo_Hull', null, 0, 0.2, 1, 1)
    const meshes = [
      hull,
      rectMesh('Wrecked_Hull', null, 0, 0.2, 1, 1),   // SAME UVs as the hull
      rectMesh('Crushed_Mesh_01', null, 0, 0.2, 1, 1), // ditto
    ]
    expect(armorErasedFraction(meshes, [hull])).toBeLessThan(0.01)
  })

  it('TILING track UVs (outside [0,1]) must NOT erase armor', () => {
    // Treads sample their own texture (<vehicle>_tread_dif.rgt / shared
    // treads library) and legitimately carry UVs far outside [0,1].
    const hull = rectMesh('geo_Hull', null, 0, 0.2, 1, 1)
    const meshes = [hull, rectMesh('geo_tread_left', null, 0, -1.5, 1, 2.5)]
    expect(armorErasedFraction(meshes, [hull])).toBeLessThan(0.01)
  })

  it('an "equipment" island spanning the atlas is misclassified body geometry', () => {
    // churchill/geo_hullgun_01+02 each erased 38.2% of armor this way.
    // MUST pass the real vehicle context: `geo_hullgun_01` is classified
    // `equipment` by CAMO_VEHICLE_MAP, not by the regex patterns — without
    // vehicleId this test exercises the fallback and passes even when the bug
    // is present (verified: it did).
    const hull = rectMesh('geo_Hull', null, 0, 0.2, 1, 1)
    const meshes = [hull, rectMesh('geo_hullgun_01', null, 0, 0, 1, 1)]
    expect(camoClassForMesh(meshes[1], 'churchill', 'british')).toBe('equipment')
    expect(armorErasedFraction(meshes, [hull], 'churchill', 'british')).toBeLessThan(0.01)
  })

  it('a genuine small fitting IS still masked (fix must not disable the feature)', () => {
    const hull = rectMesh('geo_Hull', null, 0, 0.3, 1, 1)
    const meshes = [hull, rectMesh('geo_Wheel_L01', null, 0.1, 0.02, 0.4, 0.12)]
    const mask = buildCamoExclusionMask(meshes, undefined, undefined, SIZE, 0)
    expect(mask).not.toBeNull()
    expect(alphaAt(mask!, Math.round(0.25 * SIZE), Math.round((1 - 0.07) * SIZE))).toBeGreaterThan(0)
  })
})

describe('mask compose — excluded region stays vanilla', () => {
  it('restores vanilla over the excluded region after a camo overlay', () => {
    const SIZE = 128
    const meshes = [
      rectMesh('geo_Hull', null, 0, 0.5, 1, 1),      // top-half atlas = armor
      // A REALISTIC track island: a strip covering ~15% of the atlas.
      // It must stay under MAX_FITTING_ATLAS_FRACTION (20%) — a "fitting"
      // spanning half the atlas is exactly what rule 4 now rejects as
      // misclassified body geometry (see camo-mask.ts masksMainDiffuse).
      rectMesh('geo_tread_left', null, 0, 0, 1, 0.15),
    ]
    const mask = buildCamoExclusionMask(meshes, undefined, undefined, SIZE, 0)!

    // Build a "vanilla" diffuse: solid grey.
    const vanilla = document.createElement('canvas')
    vanilla.width = vanilla.height = SIZE
    const vctx = vanilla.getContext('2d')!
    vctx.fillStyle = 'rgb(100,100,100)'
    vctx.fillRect(0, 0, SIZE, SIZE)

    // Composite: copy vanilla, paint a red "camo" over the WHOLE atlas, then
    // restore vanilla clipped to the exclusion mask (the recipe used in all
    // three paths).
    const out = document.createElement('canvas')
    out.width = out.height = SIZE
    const octx = out.getContext('2d')!
    octx.drawImage(vanilla, 0, 0)
    octx.fillStyle = 'rgb(200,0,0)' // camo
    octx.fillRect(0, 0, SIZE, SIZE)
    // restore vanilla over excluded region
    const patch = document.createElement('canvas')
    patch.width = patch.height = SIZE
    const pctx = patch.getContext('2d')!
    pctx.drawImage(vanilla, 0, 0)
    pctx.globalCompositeOperation = 'destination-in'
    pctx.drawImage(mask, 0, 0, SIZE, SIZE)
    pctx.globalCompositeOperation = 'source-over'
    octx.drawImage(patch, 0, 0)

    // Track region (bottom strip, py≈120 of 128) = vanilla grey (100,100,100).
    const track = octx.getImageData(64, 120, 1, 1).data
    expect(track[0]).toBe(100)
    expect(track[1]).toBe(100)
    expect(track[2]).toBe(100)

    // Armor region (top atlas, py≈30) = camo red (200,0,0).
    const armor = octx.getImageData(64, 30, 1, 1).data
    expect(armor[0]).toBe(200)
    expect(armor[1]).toBe(0)
    expect(armor[2]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Explicit per-vehicle map — completeness + coverage against the real
// submesh inventory (artifacts/camo-map/submesh-inventory.json).
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(__dirname, '../../..')
interface InvSubmesh { name: string; materialName: string | null }
interface InvVehicle { faction: string; structure: string; submeshes: InvSubmesh[] }
const INVENTORY = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, 'artifacts/camo-map/submesh-inventory.json'), 'utf8'),
) as { vehicles: Record<string, InvVehicle> }

const VALID_CLASSES: ReadonlySet<CamoClass> = new Set<CamoClass>([
  'armor', 'tracks', 'wheels', 'equipment', 'wreck', 'other-excluded',
])

// The inventory disambiguates the shared 'halftrack' id: soviet variant is
// stored as 'halftrack@soviet'. Mirror vehicleMapKey to resolve a VehicleSpec
// (id + faction) to the inventory / map outer key.
const invKeyForSpec = (id: string, faction: string): string =>
  id === 'halftrack' && faction === 'soviet' ? 'halftrack@soviet' : id

describe('CAMO_VEHICLE_MAP — completeness', () => {
  it('(a) every vehicle in vehicles.ts has a map entry', () => {
    const missing = VEHICLES.filter(v => {
      const key = vehicleMapKey(v.id, v.faction)
      return !CAMO_VEHICLE_MAP[key]
    }).map(v => `${v.id}@${v.faction}`)
    expect(missing, `vehicles.ts specs with NO camo map row: ${missing.join(', ')}`)
      .toEqual([])
  })

  it('every map class value is one of the six valid classes', () => {
    const bad: string[] = []
    for (const [vid, row] of Object.entries(CAMO_VEHICLE_MAP)) {
      for (const [k, cls] of Object.entries(row)) {
        if (!VALID_CLASSES.has(cls)) bad.push(`${vid}/${k}=${cls}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('EXCLUDED_CLASSES excludes exactly the five non-armor classes', () => {
    expect([...EXCLUDED_CLASSES].sort()).toEqual(
      ['equipment', 'other-excluded', 'tracks', 'wheels', 'wreck'],
    )
    expect(EXCLUDED_CLASSES.has('armor' as CamoClass)).toBe(false)
  })
})

describe('CAMO_VEHICLE_MAP — inventory coverage (zero pattern-fallback hits)', () => {
  it('(b) every submesh in the inventory is covered by the map', () => {
    const uncovered: string[] = []
    let total = 0
    for (const [invId, veh] of Object.entries(INVENTORY.vehicles)) {
      const row = CAMO_VEHICLE_MAP[invId]
      for (const sm of veh.submeshes) {
        total++
        const key = meshMapKey({ name: sm.name, materialName: sm.materialName })
        if (!row || row[key] === undefined) {
          uncovered.push(`${invId}/${key}`)
        }
      }
    }
    expect(total).toBeGreaterThan(600) // sanity: full 61-vehicle inventory
    expect(uncovered, `inventory submeshes NOT in the map (would hit regex fallback): ${uncovered.slice(0, 30).join(', ')}`)
      .toEqual([])
  })

  it('camoClassForMesh resolves every inventory submesh WITHOUT a console.warn', () => {
    const warnings: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')) }
    try {
      for (const [invId, veh] of Object.entries(INVENTORY.vehicles)) {
        // Resolve the faction so shared-id 'halftrack' routes correctly. The
        // inventory already stores the disambiguated key, so pass a matching
        // faction only when it is the soviet variant.
        const faction = invId === 'halftrack@soviet' ? 'soviet' : veh.faction
        const vid = invId === 'halftrack@soviet' ? 'halftrack' : invId
        for (const sm of veh.submeshes) {
          const cls = camoClassForMesh(
            { name: sm.name, materialName: sm.materialName },
            vid, faction as never,
          )
          expect(VALID_CLASSES.has(cls)).toBe(true)
        }
      }
    } finally {
      console.warn = origWarn
    }
    expect(warnings, `unexpected fallback warnings: ${warnings.slice(0, 10).join(' | ')}`)
      .toEqual([])
  })

  it('invKeyForSpec covers all 61 inventory vehicles from vehicles.ts specs', () => {
    // Sanity: every inventory vehicle id is reachable from some VehicleSpec.
    const specKeys = new Set(VEHICLES.map(v => invKeyForSpec(v.id, v.faction)))
    const invIds = Object.keys(INVENTORY.vehicles)
    const orphanInv = invIds.filter(id => !specKeys.has(id))
    expect(orphanInv, `inventory ids not reachable from any VehicleSpec: ${orphanInv.join(', ')}`)
      .toEqual([])
    expect(invIds.length).toBe(61)
  })
})

describe('map semantics — spot checks against known parts', () => {
  it('(c) tiger tracks/wheels/wreck are EXCLUDED; hull/turret armor is INCLUDED', () => {
    const t = (name: string) =>
      camoClassForMesh({ name, materialName: null }, 'tiger', 'german')
    // Excluded running gear / tracks / wreck
    expect(t('geo_tread_left')).toBe('tracks')
    expect(t('geo_tread_right')).toBe('tracks')
    expect(t('geo_Front_treads')).toBe('tracks')
    expect(t('geo_Wheel_L07')).toBe('wheels')
    expect(t('Wrecked_Hull')).toBe('wreck')
    expect(t('wreck_barrel')).toBe('wreck')
    expect(isExcludedSubmesh({ name: 'geo_tread_left', materialName: null }, 'tiger', 'german'))
      .toBe(true)
    // Included armor: hull, turret body, gun barrel, hatches
    expect(t('geo_Hull')).toBe('armor')
    expect(t('geo_Turret')).toBe('armor')
    expect(t('geo_Turret_Barrel')).toBe('armor')
    expect(t('geo_Hull_Hatch_L')).toBe('armor')
    expect(isExcludedSubmesh({ name: 'geo_Hull', materialName: null }, 'tiger', 'german'))
      .toBe(false)
    // Pintle MG42 + hull MG + tow cable = equipment (excluded)
    expect(t('GEO_MG42_Pintle')).toBe('equipment')
    expect(t('geo_Hull_MG42')).toBe('equipment')
    expect(t('geo_Accessory_Cable')).toBe('equipment')
  })

  it('MRGM main body material is armor; tread/wreck materials are excluded (elefant)', () => {
    const key = (mat: string): CamoClass => camoClassForMesh(
      { name: `merged material-[elefant,${mat}]`, materialName: mat }, 'elefant', 'german',
    )
    expect(key('Elefant_Tank')).toBe('armor')          // hull body
    expect(key('Elefant_Tank_tread_L')).toBe('tracks')
    expect(key('Elefant_Tank_tread_R')).toBe('tracks')
    expect(key('Elefant_Tank_wreck')).toBe('wreck')
    expect(key('Elefant_critical_treads')).toBe('wreck')
  })

  it('shared halftrack id routes german vs soviet to different rows', () => {
    // German Sd.Kfz.251 body material = MAT_Halftrack; soviet = MAT_halftrack.
    expect(vehicleMapKey('halftrack', 'german')).toBe('halftrack')
    expect(vehicleMapKey('halftrack', 'soviet')).toBe('halftrack@soviet')
    expect(camoClassForMesh(
      { name: 'merged material-[halftrack,MAT_Halftrack]', materialName: 'MAT_Halftrack' },
      'halftrack', 'german',
    )).toBe('armor')
    expect(camoClassForMesh(
      { name: 'merged material-[halftrack,MAT_halftrack]', materialName: 'MAT_halftrack' },
      'halftrack', 'soviet',
    )).toBe('armor')
  })

  it('falls back to regex pattern + warns for an UN-mapped submesh', () => {
    const warnings: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')) }
    try {
      // A submesh name that is NOT in the tiger row → fallback path.
      const cls = camoClassForMesh(
        { name: 'geo_totally_new_track_variant', materialName: null }, 'tiger', 'german',
      )
      expect(cls).toBe('tracks') // regex still catches 'track'
    } finally {
      console.warn = origWarn
    }
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('no explicit class')
    expect(warnings[0]).toContain('geo_totally_new_track_variant')
  })
})
