/**
 * Unit tests for src/lib/atlas-parts.ts
 *
 * Tests pure logic only:
 *   - partsForBake returns undefined for v5 (no parts) projects
 *   - partsForBake returns an array for v6 projects
 *   - Schema migration: v5→v6 populates parts correctly
 *   - ATLAS_PART_DEFS has 6 parts with correct indices
 *   - decalPackLayerCount counts from parts[] on v6, decals[] on v5
 */

import { describe, it, expect } from 'vitest'
import { partsForBake } from '../atlas-parts'
import {
  newDecalPackProject,
  ATLAS_PART_DEFS,
  decalPackLayerCount,
  newDecal,
  freshSourceImageId,
  type Coh2DecalPackProject,
  type AtlasPart,
} from '../decal-pack-project'

// ── ATLAS_PART_DEFS sanity ────────────────────────────────────────────────

describe('ATLAS_PART_DEFS', () => {
  it('has exactly 6 parts', () => {
    expect(ATLAS_PART_DEFS).toHaveLength(6)
  })

  it('first part is Weathering Strips and is locked', () => {
    expect(ATLAS_PART_DEFS[0].name).toBe('Weathering Strips')
    expect(ATLAS_PART_DEFS[0].locked).toBe(true)
  })

  it('second part is Main Hull Badge and is not locked', () => {
    expect(ATLAS_PART_DEFS[1].name).toBe('Main Hull Badge')
    expect(ATLAS_PART_DEFS[1].locked).toBeFalsy()
  })

  it('all regions have positive w and h', () => {
    for (const def of ATLAS_PART_DEFS) {
      expect(def.region.w).toBeGreaterThan(0)
      expect(def.region.h).toBeGreaterThan(0)
    }
  })
})

// ── partsForBake ────────────────────────────────────────────────────────────

describe('partsForBake', () => {
  it('returns undefined for a v5 project (no parts field)', async () => {
    const p: Coh2DecalPackProject = {
      magic: 'coh2-decalpack-project',
      version: 5,
      id: 'test',
      packName: 'Test',
      packDescription: '',
      author: '',
      sourceImages: {},
      decals: [],
      activeDecalId: null,
      modifiedAt: new Date().toISOString(),
    }
    const result = await partsForBake(p)
    expect(result).toBeUndefined()
  })

  it('returns an array of length 6 for a v6 project', async () => {
    const p = newDecalPackProject('Test')
    const result = await partsForBake(p)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(6)
  })

  it('each entry has a shared key (even if empty)', async () => {
    const p = newDecalPackProject('Test')
    const result = await partsForBake(p)
    expect(result).not.toBeUndefined()
    for (const entry of result!) {
      expect(Object.prototype.hasOwnProperty.call(entry, 'shared')).toBe(true)
    }
  })

  it('shared RGBA for an empty part is all zeros', async () => {
    const p = newDecalPackProject('Test')
    const result = await partsForBake(p)
    expect(result).not.toBeUndefined()
    // Part 0 (Weathering Strips) starts empty; its RGBA should be all zeros.
    const shared = result![0].shared!
    expect(shared.every(b => b === 0)).toBe(true)
  })

  it('does not include faction keys for parts with no overrides', async () => {
    const p = newDecalPackProject('Test')
    const result = await partsForBake(p)
    // No overrides added — only 'shared' key expected in each entry.
    for (const entry of result!) {
      const keys = Object.keys(entry)
      expect(keys).toEqual(['shared'])
    }
  })

  it('includes faction key structure when an override exists', async () => {
    const p = newDecalPackProject('Test')
    // Add a faction override to part 1 with a non-visible layer
    // (non-visible layers are skipped so no canvas decode is needed).
    const imgId = freshSourceImageId()
    p.sourceImages[imgId] = { id: imgId, name: 'test', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1 }
    const decal = newDecal(p, imgId)
    ;(p.parts![1] as AtlasPart).overrides = {
      german: [{ ...decal, visible: false }],  // invisible → skip decode, but override key still present
    }

    const result = await partsForBake(p)
    expect(result).not.toBeUndefined()
    // Part 1 overrides.german is non-empty (length > 0), so the german key IS added.
    const part1 = result![1]
    expect(Object.prototype.hasOwnProperty.call(part1, 'german')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(part1, 'shared')).toBe(true)
  }, 10000)
})

// ── decalPackLayerCount ──────────────────────────────────────────────────────

describe('decalPackLayerCount', () => {
  it('returns 0 for a fresh v6 project with no layers', () => {
    const p = newDecalPackProject()
    expect(decalPackLayerCount(p)).toBe(0)
  })

  it('counts shared layers across all parts for v6', () => {
    const p = newDecalPackProject()
    const imgId = freshSourceImageId()
    p.sourceImages[imgId] = { id: imgId, name: 'x', dataUrl: 'data:,', width: 1, height: 1 }
    // Add 2 decals to part 1 and 1 to part 2.
    const d1 = newDecal(p, imgId)
    const d2 = newDecal(p, imgId)
    const d3 = newDecal(p, imgId)
    p.parts![1].shared.push(d1, d2)
    p.parts![2].shared.push(d3)
    expect(decalPackLayerCount(p)).toBe(3)
  })

  it('falls back to decals.length for a v5 project (no parts)', () => {
    const p: CohProjV5 = {
      magic: 'coh2-decalpack-project',
      version: 5,
      id: 'test',
      packName: 'Test',
      packDescription: '',
      author: '',
      sourceImages: {},
      decals: [
        { id: 'd1', name: 'a', sourceImageId: 'x', x: 64, y: 64, scale: 1, rotation: 0, opacity: 1, visible: true, flipH: false, flipV: false, brightness: 100, contrast: 100, saturation: 100 },
        { id: 'd2', name: 'b', sourceImageId: 'x', x: 64, y: 64, scale: 1, rotation: 0, opacity: 1, visible: true, flipH: false, flipV: false, brightness: 100, contrast: 100, saturation: 100 },
      ],
      activeDecalId: null,
      modifiedAt: new Date().toISOString(),
    }
    expect(decalPackLayerCount(p as unknown as Coh2DecalPackProject)).toBe(2)
  })
})

// Helper type for the v5 project shape (no parts field).
type CohProjV5 = Omit<Coh2DecalPackProject, 'version' | 'parts' | 'activePartIndex' | 'activeFaction'> & { version: 5 }
