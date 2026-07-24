/**
 * Tests for insignia-library metadata.
 * (Does not perform file-fetch — validates metadata structure only.)
 */

import { describe, it, expect } from 'vitest'
import { INSIGNIA_LIBRARY, findInsignia, type InsigniaEntry } from '../insignia-library'

const VALID_FACTIONS: InsigniaEntry['faction'][] = [
  'allies',
  'soviet',
  'axis-okw',
  'axis-oh',
  'generic',
]

describe('INSIGNIA_LIBRARY', () => {
  it('has at least 25 entries', () => {
    expect(INSIGNIA_LIBRARY.length).toBeGreaterThanOrEqual(25)
  })

  it('every entry has a unique id', () => {
    const ids = INSIGNIA_LIBRARY.map(e => e.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('every entry has a valid faction', () => {
    for (const entry of INSIGNIA_LIBRARY) {
      expect(VALID_FACTIONS).toContain(entry.faction)
    }
  })

  it('every entry has a non-empty name', () => {
    for (const entry of INSIGNIA_LIBRARY) {
      expect(entry.name.trim().length).toBeGreaterThan(0)
    }
  })

  it('every entry has a non-empty description', () => {
    for (const entry of INSIGNIA_LIBRARY) {
      expect(entry.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('every entry file is a bare .svg basename', () => {
    for (const entry of INSIGNIA_LIBRARY) {
      expect(entry.file).toMatch(/^[a-z0-9-]+\.svg$/)
    }
  })

  it('every entry url is a non-empty bundled SVG asset URL', () => {
    // `url` is resolved through Vite's asset pipeline (import.meta.glob), so it
    // is a base-correct bundled reference — not the old `/insignia/x.svg`
    // literal. In the packaged/dev build this is a hashed `…/x.svg` path; under
    // the Vitest transform the same `?url` glob inlines the SVG as a
    // `data:image/svg+xml,…` data URI. Both are valid, usable `<img src>` /
    // `fetch()` targets, so accept either form.
    for (const entry of INSIGNIA_LIBRARY) {
      expect(entry.url.length).toBeGreaterThan(0)
      expect(entry.url).toMatch(/\.svg$|^data:image\/svg\+xml,/)
    }
  })

  it('era is "wwii" for all entries', () => {
    for (const entry of INSIGNIA_LIBRARY) {
      expect(entry.era).toBe('wwii')
    }
  })
})

describe('findInsignia', () => {
  it('returns at least 1 result for faction: soviet', () => {
    const results = findInsignia({ faction: 'soviet' })
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('returns at least 1 result for faction: allies', () => {
    const results = findInsignia({ faction: 'allies' })
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('returns at least 1 result for faction: axis-oh', () => {
    const results = findInsignia({ faction: 'axis-oh' })
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('finds entry by id', () => {
    const results = findInsignia({ id: 'iron-cross' })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('iron-cross')
  })

  it('returns empty array when no entries match', () => {
    const results = findInsignia({ id: 'does-not-exist' })
    expect(results).toHaveLength(0)
  })

  it('filters by multiple fields simultaneously', () => {
    const results = findInsignia({ faction: 'generic', era: 'wwii' })
    expect(results.length).toBeGreaterThan(0)
    for (const entry of results) {
      expect(entry.faction).toBe('generic')
      expect(entry.era).toBe('wwii')
    }
  })
})
