/**
 * Tests for TemplateDecalPills logic — numeric noise filter and template ordering.
 *
 * Pinned contract:
 *
 *  Numeric filter (isNumericPackName)
 *  - Pack names that are purely numeric strings ("1779088672641532", "123") are
 *    identified as noise and hidden from the installed-camos list. These are
 *    live-sync synced-project artifacts whose .info name fell back to the
 *    numeric file basename.
 *  - Real camo names ("Honved Camo Skin", "Companion Test 1", "123rd Armored")
 *    are NOT filtered. Only an ALL-digit name is considered numeric noise.
 *
 *  Template ordering
 *  - Installed packs (after numeric filter) and saved projects appear in the
 *    "Your Camos" section BEFORE the stock vehicles section.
 *  - Blank canvas is always first.
 *  - Group header entries (isGroupHeader === true) are interspersed between
 *    the sections and are non-interactive sentinels.
 *  - When there are no your-camos entries, no "Your Camos" group header is
 *    emitted (avoids an orphaned separator).
 *  - Workshop entries, when present, appear AFTER stock vehicles.
 */

import { describe, it, expect } from 'vitest'

// ── isNumericPackName — tested by reproducing the helper inline. ────────────
// The function lives inside TemplateDecalPills.tsx (module-internal); we
// replicate its definition here so the contract is pinned without importing
// the whole React component (which drags in Electron IPC and canvas APIs).

function isNumericPackName(name: string): boolean {
  return /^\d+$/.test(name.trim())
}

describe('isNumericPackName', () => {
  it('returns true for a purely numeric workshop file ID', () => {
    expect(isNumericPackName('1779088672641532')).toBe(true)
  })

  it('returns true for short numeric strings', () => {
    expect(isNumericPackName('123')).toBe(true)
  })

  it('returns true for numeric string with surrounding whitespace', () => {
    expect(isNumericPackName('  9876543210  ')).toBe(true)
  })

  it('returns false for a real camo name — "Honved Camo Skin"', () => {
    expect(isNumericPackName('Honved Camo Skin')).toBe(false)
  })

  it('returns false for a real camo name — "Companion Test 1"', () => {
    expect(isNumericPackName('Companion Test 1')).toBe(false)
  })

  it('returns false for a name starting with digits but containing letters', () => {
    expect(isNumericPackName('123rd Armored Division')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isNumericPackName('')).toBe(false)
  })

  it('returns false for names with dashes or underscores', () => {
    expect(isNumericPackName('123-456')).toBe(false)
    expect(isNumericPackName('123_456')).toBe(false)
  })
})

// ── Template ordering logic ───────────────────────────────────────────────────
// Reproduce the templateOptions composition logic (the useMemo body) as a
// pure function so it can be tested without React/DOM.

interface MockOption {
  id: string
  name: string
  kind?: string
  isGroupHeader?: boolean
}

function buildTemplateOptions(opts: {
  savedProjects: { id: string; name: string }[]
  installedSkinOptions: { id: string; name: string; hint?: string }[]
  stockVehicles: { id: string; name: string }[]
  workshopPacks: { id: string; name: string }[]
}): MockOption[] {
  const { savedProjects, installedSkinOptions, stockVehicles, workshopPacks } = opts

  const saved = savedProjects.map(p => ({ id: p.id, kind: 'saved', name: p.name }))
  const yourCamos = [...installedSkinOptions, ...saved]

  const result: MockOption[] = [{ id: 'blank', kind: 'blank', name: 'Blank canvas' }]

  if (yourCamos.length > 0) {
    result.push({ id: '__group_your_camos__', name: 'Your Camos', isGroupHeader: true })
    result.push(...yourCamos)
  }

  if (stockVehicles.length > 0) {
    result.push({ id: '__group_stock__', name: 'Stock Vehicles', isGroupHeader: true })
    result.push(...stockVehicles)
  }

  if (workshopPacks.length > 0) {
    result.push({ id: '__group_workshop__', name: 'Workshop', isGroupHeader: true })
    result.push(...workshopPacks)
  }

  return result
}

describe('templateOptions ordering', () => {
  it('blank canvas is always first', () => {
    const opts = buildTemplateOptions({
      savedProjects: [{ id: 'proj1', name: 'My Panzer' }],
      installedSkinOptions: [{ id: 'installed:/path/honved.sga', name: 'Honved Camo Skin' }],
      stockVehicles: [{ id: 'stock:tiger_p1', name: 'Tiger' }],
      workshopPacks: [],
    })
    expect(opts[0].id).toBe('blank')
    expect(opts[0].name).toBe('Blank canvas')
  })

  it('installed packs and saved projects appear before stock vehicles', () => {
    const opts = buildTemplateOptions({
      savedProjects: [{ id: 'proj1', name: 'My Panzer' }],
      installedSkinOptions: [{ id: 'installed:/path/honved.sga', name: 'Honved Camo Skin' }],
      stockVehicles: [{ id: 'stock:tiger_p1', name: 'Tiger' }],
      workshopPacks: [],
    })

    const yourCamosHeaderIdx = opts.findIndex(o => o.id === '__group_your_camos__')
    const stockHeaderIdx = opts.findIndex(o => o.id === '__group_stock__')
    expect(yourCamosHeaderIdx).toBeGreaterThan(0)
    expect(stockHeaderIdx).toBeGreaterThan(yourCamosHeaderIdx)

    // Installed pack should come before stock header.
    const honvedIdx = opts.findIndex(o => o.name === 'Honved Camo Skin')
    expect(honvedIdx).toBeGreaterThan(yourCamosHeaderIdx)
    expect(honvedIdx).toBeLessThan(stockHeaderIdx)

    // Saved project should also come before stock header.
    const savedIdx = opts.findIndex(o => o.name === 'My Panzer')
    expect(savedIdx).toBeLessThan(stockHeaderIdx)
  })

  it('workshop packs appear after stock vehicles', () => {
    const opts = buildTemplateOptions({
      savedProjects: [],
      installedSkinOptions: [],
      stockVehicles: [{ id: 'stock:panzer_1', name: 'Panzer IV' }],
      workshopPacks: [{ id: 'workshop:99', name: 'Desert Fox Camo' }],
    })

    const stockHeaderIdx = opts.findIndex(o => o.id === '__group_stock__')
    const workshopHeaderIdx = opts.findIndex(o => o.id === '__group_workshop__')
    expect(workshopHeaderIdx).toBeGreaterThan(stockHeaderIdx)
  })

  it('no "Your Camos" group header when there are no installed packs or saved projects', () => {
    const opts = buildTemplateOptions({
      savedProjects: [],
      installedSkinOptions: [],
      stockVehicles: [{ id: 'stock:t34', name: 'T-34' }],
      workshopPacks: [],
    })

    const yourCamosHeader = opts.find(o => o.id === '__group_your_camos__')
    expect(yourCamosHeader).toBeUndefined()
  })

  it('group header entries are marked isGroupHeader=true', () => {
    const opts = buildTemplateOptions({
      savedProjects: [{ id: 'p1', name: 'Proj' }],
      installedSkinOptions: [],
      stockVehicles: [{ id: 'stock:v1', name: 'Vehicle' }],
      workshopPacks: [{ id: 'workshop:1', name: 'WS Pack' }],
    })

    const headers = opts.filter(o => o.isGroupHeader)
    expect(headers.length).toBe(3)
    expect(headers.map(h => h.id)).toEqual([
      '__group_your_camos__',
      '__group_stock__',
      '__group_workshop__',
    ])
  })

  it('numeric-named installed packs filtered before being passed in', () => {
    // Simulate the filter already applied in the useEffect.
    const allPacks = [
      { id: 'installed:/mods/1779088672641532.sga', name: '1779088672641532' },
      { id: 'installed:/mods/honved.sga', name: 'Honved Camo Skin' },
      { id: 'installed:/mods/companion.sga', name: 'Companion Test 1' },
    ]
    const filtered = allPacks.filter(p => !isNumericPackName(p.name))
    const opts = buildTemplateOptions({
      savedProjects: [],
      installedSkinOptions: filtered,
      stockVehicles: [],
      workshopPacks: [],
    })

    const names = opts.map(o => o.name)
    expect(names).not.toContain('1779088672641532')
    expect(names).toContain('Honved Camo Skin')
    expect(names).toContain('Companion Test 1')
  })

  it('all sections absent = just blank canvas', () => {
    const opts = buildTemplateOptions({
      savedProjects: [],
      installedSkinOptions: [],
      stockVehicles: [],
      workshopPacks: [],
    })
    expect(opts).toHaveLength(1)
    expect(opts[0].id).toBe('blank')
  })
})
