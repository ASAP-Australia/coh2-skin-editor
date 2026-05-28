import { describe, it, expect } from 'vitest'
import { templateToDataUrl, templatesForFaction, DECAL_TEMPLATES } from '../decal-templates'

describe('templateToDataUrl', () => {
  it('returns a data:image/svg+xml;base64,... URL', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
    const url = templateToDataUrl(svg)
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('base64 payload decodes back to the original SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
    const url = templateToDataUrl(svg)
    const b64 = url.replace('data:image/svg+xml;base64,', '')
    const decoded = atob(b64)
    expect(decoded).toBe(svg)
  })
})

describe('templatesForFaction', () => {
  it('returns german templates first for german faction', () => {
    const results = templatesForFaction('german')
    const germanEntries = results.filter(t => t.faction === 'german')
    const firstGermanIdx = results.findIndex(t => t.faction === 'german')
    expect(germanEntries.length).toBeGreaterThan(0)
    expect(firstGermanIdx).toBe(0)
  })

  it('returns any/neutral templates before other-faction templates', () => {
    const results = templatesForFaction('german')
    const lastNeutralIdx = results.map(t => t.faction).lastIndexOf('any')
    const firstOtherIdx = results.findIndex(t => t.faction !== 'german' && t.faction !== 'any')
    // If there are other-faction entries, they must come after all neutral entries
    if (firstOtherIdx !== -1 && lastNeutralIdx !== -1) {
      expect(lastNeutralIdx).toBeLessThan(firstOtherIdx)
    }
  })

  it('places german templates before neutral templates for german faction', () => {
    const results = templatesForFaction('german')
    const lastGermanIdx = results.map(t => t.faction).lastIndexOf('german')
    const firstNeutralIdx = results.findIndex(t => t.faction === 'any')
    if (firstNeutralIdx !== -1) {
      expect(lastGermanIdx).toBeLessThan(firstNeutralIdx)
    }
  })
})

describe('DECAL_TEMPLATES catalog', () => {
  it('has exactly 10 entries', () => {
    expect(DECAL_TEMPLATES).toHaveLength(10)
  })
})
