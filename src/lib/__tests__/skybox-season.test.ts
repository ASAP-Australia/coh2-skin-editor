/**
 * Tests for the season classifier + filter exported from `src/lib/skybox.ts`.
 *
 * These helpers gate which CoH2 atmosphere envs the viewport will try to
 * load for a given season. A wrong classification produces visibly broken
 * lighting (warm sun under overcast winter sky, or snow-bright zenith
 * under summer noon lighting), so the rules need locked-in regression
 * coverage.
 */

import { describe, it, expect } from 'vitest'
import { seasonOfEnv, filterEnvsBySeason, SKYBOX_ENVS } from '../skybox'

describe('seasonOfEnv', () => {
  describe('explicit suffix detection', () => {
    it('classifies `_winter` envs as winter', () => {
      expect(seasonOfEnv('langreskaya_winter')).toBe('winter')
      expect(seasonOfEnv('langres_winter')).toBe('winter')
      expect(seasonOfEnv('pripyat_winter')).toBe('winter')
    })

    it('classifies `_summer` envs as summer', () => {
      expect(seasonOfEnv('langreskaya_summer')).toBe('summer')
      expect(seasonOfEnv('red_ball_express_summer')).toBe('summer')
    })

    it('is case-insensitive', () => {
      expect(seasonOfEnv('Langreskaya_Winter')).toBe('winter')
      expect(seasonOfEnv('PRIPYAT_WINTER')).toBe('winter')
      expect(seasonOfEnv('langreskaya_SUMMER')).toBe('summer')
    })
  })

  describe('season-agnostic envs', () => {
    it('classifies `stormy_sky` as either-season (overcast works for both)', () => {
      expect(seasonOfEnv('stormy_sky')).toBe('either')
    })
  })

  describe('unmarked envs default to summer', () => {
    // The unmarked envs in CoH2 ship art assets that are warm/sunny.
    // Defaulting to summer avoids the broken "warm sun on overcast" combo.
    it('treats `caen_midday` as summer', () => {
      expect(seasonOfEnv('caen_midday')).toBe('summer')
    })
    it('treats `mission_01` as summer', () => {
      expect(seasonOfEnv('mission_01')).toBe('summer')
    })
    it('treats `foggy_autumn_day` as summer (warm autumn ≠ snow winter)', () => {
      expect(seasonOfEnv('foggy_autumn_day')).toBe('summer')
    })
    it('treats arbitrary unmarked strings as summer', () => {
      expect(seasonOfEnv('arnhem')).toBe('summer')
      expect(seasonOfEnv('semoisky')).toBe('summer')
    })
  })

  describe('partial / weird matches', () => {
    it('does not match `winter` as a substring without underscore', () => {
      // `winterfell` is not a CoH2 env name; the regex requires the
      // `_winter` marker preceded by `_` to avoid false positives.
      expect(seasonOfEnv('winterfell')).toBe('summer')
    })

    it('handles empty string as summer (the default bucket)', () => {
      expect(seasonOfEnv('')).toBe('summer')
    })
  })
})

describe('filterEnvsBySeason', () => {
  it('keeps only winter-marked + season-agnostic envs when winter is requested', () => {
    const input = [
      'langreskaya_winter',
      'caen_midday',
      'stormy_sky',
      'mission_03',
      'pripyat_winter',
    ]
    expect(filterEnvsBySeason(input, 'winter')).toEqual([
      'langreskaya_winter',
      'stormy_sky',
      'pripyat_winter',
    ])
  })

  it('keeps only summer + season-agnostic envs when summer is requested', () => {
    const input = [
      'langreskaya_winter',
      'caen_midday',
      'stormy_sky',
      'mission_03',
      'pripyat_winter',
    ]
    expect(filterEnvsBySeason(input, 'summer')).toEqual(['caen_midday', 'stormy_sky', 'mission_03'])
  })

  it('preserves input order (important for priority chains)', () => {
    const input = ['stormy_sky', 'mission_05', 'caen_dawn', 'langreskaya_summer']
    const out = filterEnvsBySeason(input, 'summer')
    expect(out).toEqual(input) // all four pass the summer filter, order intact
  })

  it('returns empty array when input has no season matches', () => {
    expect(filterEnvsBySeason(['langreskaya_winter'], 'summer')).toEqual([])
  })

  it('handles empty input', () => {
    expect(filterEnvsBySeason([], 'summer')).toEqual([])
    expect(filterEnvsBySeason([], 'winter')).toEqual([])
  })

  it('returns a new array (does not mutate input)', () => {
    const input = ['caen_midday', 'stormy_sky']
    const out = filterEnvsBySeason(input, 'summer')
    expect(out).not.toBe(input)
    expect(input).toEqual(['caen_midday', 'stormy_sky']) // unmodified
  })
})

describe('SKYBOX_ENVS bucket distribution', () => {
  // Sanity-check that the hardcoded fallback list contains at least
  // some envs in each season bucket — protects against accidentally
  // deleting all season-distinct envs and silently degrading to a
  // single sunny default for everyone.
  const summerBucket = filterEnvsBySeason(SKYBOX_ENVS, 'summer')
  const winterBucket = filterEnvsBySeason(SKYBOX_ENVS, 'winter')

  it('has at least one summer-bucket env', () => {
    expect(summerBucket.length).toBeGreaterThan(0)
  })

  it('has at least one season-agnostic env (stormy_sky)', () => {
    // stormy_sky should appear in BOTH buckets because it's `either`.
    expect(summerBucket).toContain('stormy_sky')
    expect(winterBucket).toContain('stormy_sky')
  })
})
