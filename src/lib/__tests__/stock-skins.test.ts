import { describe, it, expect } from 'vitest'
import { listStockSkins } from '../stock-skins'

describe('listStockSkins', () => {
  it('returns at least 20 entries', () => {
    const skins = listStockSkins()
    // VEHICLES catalog has 42 entries across 5 factions
    expect(skins.length).toBeGreaterThanOrEqual(20)
  })

  it('every entry has all required fields populated', () => {
    const skins = listStockSkins()
    for (const s of skins) {
      expect(typeof s.id).toBe('string')
      expect(s.id.length).toBeGreaterThan(0)
      expect(typeof s.name).toBe('string')
      expect(s.name.length).toBeGreaterThan(0)
      expect(typeof s.factionId).toBe('string')
      expect(s.factionId.length).toBeGreaterThan(0)
      expect(typeof s.vehicleId).toBe('string')
      expect(s.vehicleId.length).toBeGreaterThan(0)
      expect(typeof s.sgaName).toBe('string')
      expect(s.sgaName.length).toBeGreaterThan(0)
      expect(typeof s.internalPath).toBe('string')
      expect(s.internalPath.length).toBeGreaterThan(0)
    }
  })

  it('ids are unique across all entries', () => {
    const skins = listStockSkins()
    const ids = skins.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every name contains the " — " separator (FactionLabel — VehicleName format)', () => {
    const skins = listStockSkins()
    for (const s of skins) {
      expect(s.name).toContain(' — ')
    }
  })

  it('every internalPath starts with art/armies/', () => {
    const skins = listStockSkins()
    for (const s of skins) {
      expect(s.internalPath).toMatch(/^art\/armies\//)
    }
  })

  it('every internalPath ends with _dif.rgt', () => {
    const skins = listStockSkins()
    for (const s of skins) {
      expect(s.internalPath).toMatch(/_dif\.rgt$/)
    }
  })

  it('every sgaName ends with .sga', () => {
    const skins = listStockSkins()
    for (const s of skins) {
      expect(s.sgaName).toMatch(/\.sga$/)
    }
  })

  it('id format is faction/vehicleId', () => {
    const skins = listStockSkins()
    for (const s of skins) {
      expect(s.id).toBe(`${s.factionId}/${s.vehicleId}`)
    }
  })

  it('results are sorted alphabetically by name', () => {
    const skins = listStockSkins()
    for (let i = 1; i < skins.length; i++) {
      expect(skins[i - 1].name.localeCompare(skins[i].name)).toBeLessThanOrEqual(0)
    }
  })

  it('covers all 5 factions', () => {
    const skins = listStockSkins()
    const factions = new Set(skins.map(s => s.factionId))
    expect(factions.has('german')).toBe(true)
    expect(factions.has('west_german')).toBe(true)
    expect(factions.has('soviet')).toBe(true)
    expect(factions.has('aef')).toBe(true)
    expect(factions.has('british')).toBe(true)
  })

  it('spot-check: OstHeer Tiger I is present with correct paths', () => {
    const skins = listStockSkins()
    const tiger = skins.find(s => s.id === 'german/tiger')
    expect(tiger).toBeDefined()
    expect(tiger!.name).toBe('OstHeer — Tiger I')
    expect(tiger!.sgaName).toBe('ArtGermanEF.sga')
    expect(tiger!.internalPath).toBe('art/armies/german/vehicles/tiger/tiger_dif.rgt')
  })

  it('spot-check: Soviet T-34/76 is present with correct paths', () => {
    const skins = listStockSkins()
    const t34 = skins.find(s => s.id === 'soviet/t34_76')
    expect(t34).toBeDefined()
    expect(t34!.name).toBe('Soviet — T-34/76')
    expect(t34!.sgaName).toBe('ArtSovietEF.sga')
    expect(t34!.internalPath).toBe('art/armies/soviet/vehicles/t34_76/t34_76_dif.rgt')
  })

  it('spot-check: Soviet IS-2 is present', () => {
    const skins = listStockSkins()
    const is2 = skins.find(s => s.id === 'soviet/is2m_heavy_tank')
    expect(is2).toBeDefined()
    expect(is2!.name).toBe('Soviet — IS-2')
    expect(is2!.sgaName).toBe('ArtSovietEF.sga')
  })

  it('spot-check: elefant uses hull alias in internalPath', () => {
    const skins = listStockSkins()
    const elefant = skins.find(s => s.id === 'german/elefant')
    expect(elefant).toBeDefined()
    // textureBaseNamesFor('elefant') returns ['elefant_hull', 'elefant']
    expect(elefant!.internalPath).toBe('art/armies/german/vehicles/elefant/elefant_hull_dif.rgt')
  })

  it('spot-check: UKF Churchill is present', () => {
    const skins = listStockSkins()
    const churchill = skins.find(s => s.id === 'british/churchill')
    expect(churchill).toBeDefined()
    expect(churchill!.name).toBe('UKF — Churchill')
    expect(churchill!.sgaName).toBe('ArtBritish.sga')
  })
})
