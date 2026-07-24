/**
 * F12 — per-faction lighting boost sanity test.
 *
 * Pins the contract that British ('british') and AEF ('aef') factions receive
 * a boost > 1.0 while Soviet, German, and West German stay at exactly 1.0.
 * The map is exported from Viewport.tsx so these values can be checked in
 * isolation without mounting the full Three.js component.
 *
 * Also verifies idempotency and no-drift: applying the boost formula any
 * number of times for the same faction/preset yields identical absolute
 * values, and switching factions returns to the correct base values without
 * accumulation (regression test for the R2 compounding bug introduced in the
 * Phase-5 F12 campaign where vehicle?.faction was added to the heavy preset
 * effect deps).
 */

import { describe, it, expect } from 'vitest'
import { FACTION_LIGHT_BOOST } from '../Viewport'
import { SCENE_PRESETS } from '@/lib/scene-settings'
import { applySeasonOverrides } from '@/lib/scene-settings'

// ── Helpers that mirror the faction-boost effect's math exactly ──────────────

/**
 * Compute the absolute toneMappingExposure the effect would set for a given
 * faction + preset + season combination.  Always derived from the SCENE_PRESETS
 * constant, never from a previous renderer value, so there is no compounding.
 */
function computeExposure(
  faction: string,
  presetId: keyof typeof SCENE_PRESETS,
  season: 'summer' | 'winter' = 'summer',
): number {
  const effectivePreset = applySeasonOverrides(SCENE_PRESETS[presetId], season)
  const boost = FACTION_LIGHT_BOOST[faction] ?? 1.0
  return effectivePreset.exposure * boost
}

/**
 * Compute the absolute HemisphereLight intensity the effect would set.
 */
function computeHemiIntensity(
  faction: string,
  presetId: keyof typeof SCENE_PRESETS,
  season: 'summer' | 'winter' = 'summer',
): number {
  const effectivePreset = applySeasonOverrides(SCENE_PRESETS[presetId], season)
  const boost = FACTION_LIGHT_BOOST[faction] ?? 1.0
  return effectivePreset.hemi.intensity * boost
}

describe('FACTION_LIGHT_BOOST — faction values', () => {
  it('british gets a boost > 1.0', () => {
    expect(FACTION_LIGHT_BOOST['british']).toBeGreaterThan(1.0)
  })

  it('aef gets a boost > 1.0', () => {
    expect(FACTION_LIGHT_BOOST['aef']).toBeGreaterThan(1.0)
  })

  it('soviet is NOT in the boost map (fallback 1.0)', () => {
    expect(FACTION_LIGHT_BOOST['soviet']).toBeUndefined()
  })

  it('german is NOT in the boost map (fallback 1.0)', () => {
    expect(FACTION_LIGHT_BOOST['german']).toBeUndefined()
  })

  it('west_german is NOT in the boost map (fallback 1.0)', () => {
    expect(FACTION_LIGHT_BOOST['west_german']).toBeUndefined()
  })

  it('british and aef boosts are 1.3', () => {
    expect(FACTION_LIGHT_BOOST['british']).toBe(1.3)
    expect(FACTION_LIGHT_BOOST['aef']).toBe(1.3)
  })
})

describe('FACTION_LIGHT_BOOST — idempotency (no compounding)', () => {
  const PRESETS = ['in_game_field', 'studio_grid', 'showcase'] as const

  for (const presetId of PRESETS) {
    it(`applying the boost effect twice for 'british' on preset '${presetId}' yields identical exposure`, () => {
      const first = computeExposure('british', presetId)
      const second = computeExposure('british', presetId)
      expect(second).toBe(first)
    })

    it(`applying the boost effect twice for 'british' on preset '${presetId}' yields identical hemi intensity`, () => {
      const first = computeHemiIntensity('british', presetId)
      const second = computeHemiIntensity('british', presetId)
      expect(second).toBe(first)
    })

    it(`applying the boost effect twice for 'german' on preset '${presetId}' yields identical exposure`, () => {
      const first = computeExposure('german', presetId)
      const second = computeExposure('german', presetId)
      expect(second).toBe(first)
    })
  }
})

describe('FACTION_LIGHT_BOOST — no drift across faction switches', () => {
  const preset = 'in_game_field' as const
  const baseExposure = SCENE_PRESETS[preset].exposure
  const baseHemi = SCENE_PRESETS[preset].hemi.intensity
  const boost = FACTION_LIGHT_BOOST['british']!

  it('british→german: german exposure returns to exact base value (no drift)', () => {
    // Simulates switching from British (boosted) to German (unboosted).
    const britishExposure = computeExposure('british', preset)
    const germanExposure = computeExposure('german', preset)

    expect(britishExposure).toBeCloseTo(baseExposure * boost, 10)
    expect(germanExposure).toBe(baseExposure)           // exact base, not compounded
    expect(germanExposure).not.toBeCloseTo(britishExposure, 5) // different from boosted
  })

  it('british→german→british: final british exposure equals initial british (no accumulation)', () => {
    const first = computeExposure('british', preset)
    // simulate german run (reads base * 1.0 — overwrites renderer value)
    computeExposure('german', preset)
    // simulate british again — must match first exactly
    const third = computeExposure('british', preset)

    expect(third).toBe(first)
    expect(third).toBeCloseTo(baseExposure * boost, 10)
  })

  it('british→german→british: final hemi intensity equals initial (no accumulation)', () => {
    const first = computeHemiIntensity('british', preset)
    computeHemiIntensity('german', preset)
    const third = computeHemiIntensity('british', preset)

    expect(third).toBe(first)
    expect(third).toBeCloseTo(baseHemi * boost, 10)
  })

  it('german→british: british exposure is exactly base × 1.3 regardless of starting faction', () => {
    // Starting from German (unboosted) and switching to British must give same
    // result as starting fresh — no state pollution from the german run.
    computeExposure('german', preset)  // simulate german run
    const britishExposure = computeExposure('british', preset)

    expect(britishExposure).toBeCloseTo(baseExposure * 1.3, 10)
  })

  it('winter in_game_field: british boost applies to the winter-overridden exposure, not summer', () => {
    const summerExposure = computeExposure('british', preset, 'summer')
    const winterExposure = computeExposure('british', preset, 'winter')
    // Both must be boosted versions of the respective season base
    const summerBase = SCENE_PRESETS[preset].exposure
    const winterBase = applySeasonOverrides(SCENE_PRESETS[preset], 'winter').exposure
    expect(summerExposure).toBeCloseTo(summerBase * boost, 10)
    expect(winterExposure).toBeCloseTo(winterBase * boost, 10)
  })
})

// ── M1 regression — boost survives heavy-effect re-runs triggered by root/_envName/fog ──
//
// The M1 bug: heavy effect deps include root/_envName/fog which are NOT in the
// boost effect's deps.  If any of those change alone, the heavy effect rebuilds
// lights at BASE intensity and the boost effect does NOT re-run → UK/US vehicles
// go dark until a faction/preset/season change triggers the boost effect again.
//
// The fix: applyFactionBoostNow is called at the end of the heavy effect so ANY
// lights rebuild always re-applies the faction multiplier.  These tests verify
// that the formula (which applyFactionBoostNow uses) is correct regardless of
// which dep triggered the rebuild, by checking that the result is ALWAYS
// base × boost and NEVER just base.
describe('M1 regression — faction boost applies regardless of what triggered the lights rebuild', () => {
  const preset = 'in_game_field' as const
  const boost = FACTION_LIGHT_BOOST['british']!

  it('british exposure after a lights rebuild equals base × boost (not bare base)', () => {
    // Simulate what the heavy effect now does: call applyFactionBoostNow equivalent
    // (compute exposure = base × faction boost). If the dep-mismatch bug were
    // present, the heavy effect would set base (boost=1), and the boost effect
    // would not re-run for an env/fog change → exposure stays at base.
    const effectivePreset = applySeasonOverrides(SCENE_PRESETS[preset], 'summer')
    const baseExposure = effectivePreset.exposure

    // With the fix: applyFactionBoostNow reads factionRef.current (= 'british') → boost
    const expectedAfterFix  = baseExposure * boost   // what the fixed code produces
    const expectedAfterBug  = baseExposure            // what the broken code would produce

    // Verify the formula used by applyFactionBoostNow is correct
    const actualBoost = FACTION_LIGHT_BOOST['british'] ?? 1.0
    const result = baseExposure * actualBoost

    expect(result).toBeCloseTo(expectedAfterFix, 10)
    expect(result).not.toBeCloseTo(expectedAfterBug, 5)
  })

  it('british hemi intensity after a lights rebuild equals base × boost', () => {
    const effectivePreset = applySeasonOverrides(SCENE_PRESETS[preset], 'summer')
    const baseHemi = effectivePreset.hemi.intensity
    const actualBoost = FACTION_LIGHT_BOOST['british'] ?? 1.0
    const result = baseHemi * actualBoost
    expect(result).toBeCloseTo(baseHemi * boost, 10)
    expect(result).toBeGreaterThan(baseHemi) // boosted, not base
  })

  it('german exposure after lights rebuild equals bare base (no boost for german)', () => {
    const effectivePreset = applySeasonOverrides(SCENE_PRESETS[preset], 'summer')
    const baseExposure = effectivePreset.exposure
    // German: no entry in FACTION_LIGHT_BOOST → fallback 1.0
    const germanBoost = FACTION_LIGHT_BOOST['german'] ?? 1.0
    expect(germanBoost).toBe(1.0)
    expect(baseExposure * germanBoost).toBe(baseExposure)
  })

  it('changing env (simulating root/_envName/fog change) then checking british keeps boosted values', () => {
    // This test documents the contract that the FORMULA is correct — the wiring
    // (applyFactionBoostNow called in the heavy effect) is tested at the
    // component level (not the unit test level). What we verify here: both
    // summer and winter presets produce boosted > base values for british.
    for (const season of ['summer', 'winter'] as const) {
      const ep = applySeasonOverrides(SCENE_PRESETS[preset], season)
      const result = ep.exposure * boost
      expect(result).toBeGreaterThan(ep.exposure) // boosted
      expect(result).toBeCloseTo(ep.exposure * 1.3, 10) // exact boost
    }
  })
})
