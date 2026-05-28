import { describe, it, expect } from 'vitest'
import {
  VEHICLES,
  FACTIONS,
  rgmPath,
  findVehicleSpec,
  inferProjectFactions,
  type Faction,
  type VehicleClass,
  type VehicleSpec,
} from '../vehicles'

// ---------------------------------------------------------------------------
// VEHICLES catalog — structural integrity
// ---------------------------------------------------------------------------

describe('VEHICLES catalog', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(VEHICLES)).toBe(true)
    expect(VEHICLES.length).toBeGreaterThan(0)
  })

  it('every entry has a non-empty id', () => {
    for (const v of VEHICLES) {
      expect(typeof v.id).toBe('string')
      expect(v.id.length).toBeGreaterThan(0)
    }
  })

  it('every entry has a non-empty displayName', () => {
    for (const v of VEHICLES) {
      expect(typeof v.displayName).toBe('string')
      expect(v.displayName.length).toBeGreaterThan(0)
    }
  })

  it('every entry has a valid faction', () => {
    const validFactions: Faction[] = ['german', 'west_german', 'soviet', 'aef', 'british']
    for (const v of VEHICLES) {
      expect(validFactions).toContain(v.faction)
    }
  })

  it('every entry has a valid class', () => {
    const validClasses: VehicleClass[] = ['heavy', 'medium', 'light', 'utility', 'super_heavy']
    for (const v of VEHICLES) {
      expect(validClasses).toContain(v.class)
    }
  })

  it('every entry has a non-empty defaultTac string', () => {
    for (const v of VEHICLES) {
      expect(typeof v.defaultTac).toBe('string')
      expect(v.defaultTac.length).toBeGreaterThan(0)
    }
  })

  it('ids are unique within a faction', () => {
    const factions = ['german', 'west_german', 'soviet', 'aef', 'british'] as const
    for (const faction of factions) {
      const ids = VEHICLES.filter(v => v.faction === faction).map(v => v.id)
      const unique = new Set(ids)
      expect(unique.size).toBe(ids.length)
    }
  })

  it('contains entries for all 5 factions', () => {
    const factions = new Set(VEHICLES.map(v => v.faction))
    expect(factions.has('german')).toBe(true)
    expect(factions.has('west_german')).toBe(true)
    expect(factions.has('soviet')).toBe(true)
    expect(factions.has('aef')).toBe(true)
    expect(factions.has('british')).toBe(true)
  })

  it('contains well-known vehicles by id', () => {
    const ids = new Set(VEHICLES.map(v => v.id))
    expect(ids.has('tiger')).toBe(true)
    expect(ids.has('t34_76')).toBe(true)
    expect(ids.has('m26_pershing')).toBe(true)
    expect(ids.has('churchill')).toBe(true)
    expect(ids.has('king_tiger_sdkfz_182')).toBe(true)
  })

  it('tiger is classified as german heavy', () => {
    const tiger = VEHICLES.find(v => v.id === 'tiger')
    expect(tiger).toBeDefined()
    expect(tiger!.faction).toBe('german')
    expect(tiger!.class).toBe('heavy')
  })
})

// ---------------------------------------------------------------------------
// FACTIONS catalog
// ---------------------------------------------------------------------------

describe('FACTIONS catalog', () => {
  it('has exactly 5 factions', () => {
    expect(FACTIONS).toHaveLength(5)
  })

  it('every faction has a non-empty id and label', () => {
    for (const f of FACTIONS) {
      expect(f.id.length).toBeGreaterThan(0)
      expect(f.label.length).toBeGreaterThan(0)
    }
  })

  it('faction ids are unique', () => {
    const ids = FACTIONS.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes german/OstHeer entry', () => {
    const g = FACTIONS.find(f => f.id === 'german')
    expect(g).toBeDefined()
    expect(g!.label).toBe('OstHeer')
  })
})

// ---------------------------------------------------------------------------
// rgmPath
// ---------------------------------------------------------------------------

describe('rgmPath', () => {
  it('produces the canonical art/armies path format', () => {
    const v: VehicleSpec = {
      id: 'tiger',
      faction: 'german',
      displayName: 'Tiger I',
      class: 'heavy',
      defaultTac: '211',
    }
    expect(rgmPath(v)).toBe('art/armies/german/vehicles/tiger/tiger.rgm')
  })

  it('uses the vehicle id for both folder and filename', () => {
    const v: VehicleSpec = {
      id: 't34_76',
      faction: 'soviet',
      displayName: 'T-34/76',
      class: 'medium',
      defaultTac: 'B11',
    }
    const path = rgmPath(v)
    expect(path).toContain('t34_76/t34_76.rgm')
  })

  it('uses forward slashes in the path', () => {
    const v = VEHICLES[0]
    expect(rgmPath(v)).not.toContain('\\')
  })

  it('always ends with .rgm', () => {
    for (const v of VEHICLES) {
      expect(rgmPath(v)).toMatch(/\.rgm$/)
    }
  })

  it('includes the faction in the path', () => {
    const v = VEHICLES.find(v => v.id === 'churchill')!
    expect(rgmPath(v)).toContain('british')
  })

  it('path starts with art/armies/', () => {
    for (const v of VEHICLES) {
      expect(rgmPath(v)).toMatch(/^art\/armies\//)
    }
  })
})

// ---------------------------------------------------------------------------
// findVehicleSpec — disambiguates ids that are shared across factions.
// `halftrack` is the canonical example: german (Sd.Kfz. 251) and soviet
// (Lend-Lease Truck) both claim it. Before this helper existed, the bare
// `VEHICLES.find(v => v.id === 'halftrack')` returned german (catalogue
// ordering), silently routing soviet halftracks to german archive paths.
// ---------------------------------------------------------------------------

describe('findVehicleSpec', () => {
  it('returns the unique match when only one faction owns the id', () => {
    const spec = findVehicleSpec('tiger')
    expect(spec?.faction).toBe('german')
    expect(spec?.displayName).toBe('Tiger I')
  })

  it('returns undefined for unknown ids', () => {
    expect(findVehicleSpec('totally_made_up_tank')).toBeUndefined()
  })

  it('falls back to first-match when no hint is provided', () => {
    // The catalogue lists german halftrack before soviet halftrack.
    const spec = findVehicleSpec('halftrack')
    expect(spec?.faction).toBe('german')
  })

  it('prefers the hinted faction for shared ids — soviet halftrack', () => {
    const spec = findVehicleSpec('halftrack', ['soviet'])
    expect(spec?.faction).toBe('soviet')
    expect(spec?.displayName).toBe('Lend-Lease Truck')
  })

  it('prefers the hinted faction for shared ids — german halftrack', () => {
    const spec = findVehicleSpec('halftrack', ['german'])
    expect(spec?.faction).toBe('german')
    expect(spec?.displayName).toBe('Sd.Kfz. 251')
  })

  it('falls back to first-match when the hint set has no match for the id', () => {
    // 'tiger' only exists for german. Hint says british.
    const spec = findVehicleSpec('tiger', ['british'])
    expect(spec?.faction).toBe('german')
  })

  it('ignores empty hint sets', () => {
    const spec = findVehicleSpec('halftrack', [])
    expect(spec?.faction).toBe('german')
  })
})

// ---------------------------------------------------------------------------
// inferProjectFactions — recovers the faction context of a single-pack
// project from its unambiguous vehicle ids. Used by mod-export.ts to
// disambiguate halftrack and any future shared-id collisions.
// ---------------------------------------------------------------------------

describe('inferProjectFactions', () => {
  it('returns an empty array for empty input', () => {
    expect(inferProjectFactions([])).toEqual([])
  })

  it('returns an empty array when only ambiguous ids are provided', () => {
    // 'halftrack' alone is ambiguous (german + soviet).
    expect(inferProjectFactions(['halftrack'])).toEqual([])
  })

  it('returns one faction when the input pins down a single faction', () => {
    expect(inferProjectFactions(['tiger', 'elefant', 'stug_iii'])).toEqual(['german'])
  })

  it('disambiguates halftrack via surrounding unambiguous ids — soviet', () => {
    // 'is2m_heavy_tank' is uniquely soviet; 'halftrack' is ambiguous but
    // the project's faction is implied by the IS-2.
    const factions = inferProjectFactions(['is2m_heavy_tank', 'halftrack', 't34_76'])
    expect(factions).toEqual(['soviet'])
  })

  it('disambiguates halftrack via surrounding unambiguous ids — german', () => {
    const factions = inferProjectFactions(['tiger', 'halftrack', 'stug_iii'])
    expect(factions).toEqual(['german'])
  })

  it('returns multiple factions for a multi-faction project', () => {
    const factions = inferProjectFactions(['tiger', 'is2m_heavy_tank', 'churchill'])
    expect(factions.sort()).toEqual(['british', 'german', 'soviet'])
  })

  it('skips ids unknown to the catalogue', () => {
    const factions = inferProjectFactions(['tiger', 'not_a_real_vehicle'])
    expect(factions).toEqual(['german'])
  })

  it('end-to-end: hint flows from inferProjectFactions into findVehicleSpec', () => {
    // The exact pattern mod-export.ts now uses.
    const projectVehicleIds = ['is2m_heavy_tank', 'kv1_heavy_tank', 'halftrack']
    const hint = inferProjectFactions(projectVehicleIds)
    const halftrack = findVehicleSpec('halftrack', hint)
    expect(halftrack?.faction).toBe('soviet')
    expect(halftrack?.displayName).toBe('Lend-Lease Truck')
  })
})
