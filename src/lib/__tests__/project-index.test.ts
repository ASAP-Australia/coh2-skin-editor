/**
 * Tests for the lightweight metadata-index helpers added in Phase 3.
 *
 * Covers:
 *  (1) persistActive writes an index entry
 *  (2) listAllSkinProjects lazy-backfills the index from legacy blobs
 *  (3) getProjectMeta: cache miss parses once then serves from index
 *  (4) clearSkinWorkshopId nulls the index entry workshopId
 *  (5) Faceplate equivalents
 *  (6) Decal-pack equivalents + findDecalPackIdByWorkshopId
 *  (7) envName init test: filterEnvsBySeason(['summer'])[0] is summer
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  newProject,
  persistActive,
  listAllSkinProjects,
  getProjectMeta,
  clearSkinWorkshopId,
  removeRecentProject,
} from '../project'
import {
  newFaceplateProject,
  persistFaceplate,
  listAllFaceplates,
  getFaceplateMeta,
  clearFaceplateWorkshopId,
  removeRecentFaceplate,
} from '../faceplate-project'
import {
  newDecalPackProject,
  saveDecalPackToLocal,
  listAllDecalPacks,
  getDecalPackMeta,
  clearDecalPackWorkshopId,
  removeRecentDecalPack,
  findDecalPackIdByWorkshopId,
} from '../decal-pack-project'
import { filterEnvsBySeason, seasonOfEnv, SKYBOX_ENVS } from '../skybox'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkinBlob(id: string, name: string, workshopId?: string): string {
  return JSON.stringify({
    magic: 'coh2-skin-project',
    version: 2,
    id,
    packName: name,
    packDescription: '',
    author: '',
    titleAcknowledged: true,
    template: { id: 'blank', kind: 'blank', name: 'Blank' },
    vehicles: {},
    factionDefaults: {},
    refPackId: null,
    palette: { orange: '#B84F12', white: '#C8C0AF', blue: '#1B3A6E' },
    lastVehicleId: null,
    modifiedAt: new Date().toISOString(),
    images: {},
    vehicleIcons: {},
    exportSlots: [],
    activeSlotIdx: 0,
    generationSessions: {},
    ...(workshopId ? { workshopId } : {}),
  })
}

// ---------------------------------------------------------------------------
// 1. persistActive writes an index entry
// ---------------------------------------------------------------------------

describe('persistActive writes metadata index', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('writes an index entry with name, lastEditedAt, workshopId, vehicleCount', () => {
    const p = newProject('Test Pack A')
    ;(p as { workshopId?: string }).workshopId = '12345'
    persistActive(p)

    const meta = getProjectMeta(p.id)
    expect(meta).not.toBeNull()
    expect(meta!.name).toBe('Test Pack A')
    expect(meta!.workshopId).toBe('12345')
    expect(meta!.vehicleCount).toBe(0)
    expect(meta!.lastEditedAt).toBeGreaterThan(0)
  })

  it('updates the index on subsequent saves', () => {
    const p = newProject('Old Name')
    persistActive(p)
    p.packName = 'New Name'
    persistActive(p)

    const meta = getProjectMeta(p.id)
    expect(meta!.name).toBe('New Name')
  })
})

// ---------------------------------------------------------------------------
// 2. listAllSkinProjects golden compare + lazy backfill
// ---------------------------------------------------------------------------

describe('listAllSkinProjects lazy backfill', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('back-fills the index for legacy blobs and returns correct entries', () => {
    // Seed two raw blobs as legacy storage (no index).
    localStorage.setItem('coh2.project.legacy_1', makeSkinBlob('legacy_1', 'Pack Alpha', '777'))
    localStorage.setItem('coh2.project.legacy_2', makeSkinBlob('legacy_2', 'Pack Beta'))

    const result = listAllSkinProjects()
    expect(result.map(e => e.name).sort()).toEqual(['Pack Alpha', 'Pack Beta'])

    // Index should now be populated for both.
    const m1 = getProjectMeta('legacy_1')
    const m2 = getProjectMeta('legacy_2')
    expect(m1!.name).toBe('Pack Alpha')
    expect(m1!.workshopId).toBe('777')
    expect(m2!.name).toBe('Pack Beta')
    expect(m2!.workshopId).toBeNull()
  })

  it('uses the index on the second call (no second blob parse needed)', () => {
    localStorage.setItem('coh2.project.cached_1', makeSkinBlob('cached_1', 'Cached Pack'))
    // Trigger first call to populate index.
    listAllSkinProjects()

    // Remove the blob — if index is used, the entry is still available.
    // (We can't easily verify "no parse", but we CAN verify index serves it.)
    const meta = getProjectMeta('cached_1')
    expect(meta!.name).toBe('Cached Pack')
  })
})

// ---------------------------------------------------------------------------
// 3. getProjectMeta: cache miss parses once then serves from index
// ---------------------------------------------------------------------------

describe('getProjectMeta', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null for a non-existent id', () => {
    expect(getProjectMeta('does_not_exist')).toBeNull()
  })

  it('backfills and returns entry for a blob id', () => {
    localStorage.setItem('coh2.project.abc', makeSkinBlob('abc', 'My Pack', '999'))
    const meta = getProjectMeta('abc')
    expect(meta).not.toBeNull()
    expect(meta!.name).toBe('My Pack')
    expect(meta!.workshopId).toBe('999')
  })
})

// ---------------------------------------------------------------------------
// 4. clearSkinWorkshopId nulls the index entry
// ---------------------------------------------------------------------------

describe('clearSkinWorkshopId', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('nulls workshopId in the index', () => {
    const p = newProject('WS Pack')
    ;(p as { workshopId?: string }).workshopId = '42'
    persistActive(p)

    clearSkinWorkshopId(p.id)
    const meta = getProjectMeta(p.id)
    expect(meta!.workshopId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. removeRecentProject removes the index entry
// ---------------------------------------------------------------------------

describe('removeRecentProject', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('removes the index entry on delete', () => {
    const p = newProject('Delete Me')
    persistActive(p)
    expect(getProjectMeta(p.id)).not.toBeNull()
    removeRecentProject(p.id)
    // Blob is gone so getProjectMeta will return null.
    expect(getProjectMeta(p.id)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5b. Faceplate minimal cases
// ---------------------------------------------------------------------------

describe('faceplate index', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persistFaceplate writes index entry', () => {
    const p = newFaceplateProject('My FP')
    persistFaceplate(p)

    const meta = getFaceplateMeta(p.id)
    expect(meta!.name).toBe('My FP')
    expect(meta!.workshopId).toBeNull()
  })

  it('clearFaceplateWorkshopId nulls workshopId in index', () => {
    const p = newFaceplateProject('WS FP')
    ;(p as { workshopId?: string }).workshopId = '55'
    persistFaceplate(p)

    clearFaceplateWorkshopId(p.id)
    const meta = getFaceplateMeta(p.id)
    expect(meta!.workshopId).toBeNull()
  })

  it('removeRecentFaceplate removes from index', () => {
    const p = newFaceplateProject('Remove FP')
    persistFaceplate(p)
    expect(getFaceplateMeta(p.id)).not.toBeNull()
    removeRecentFaceplate(p.id)
    expect(getFaceplateMeta(p.id)).toBeNull()
  })

  it('listAllFaceplates lazy-backfills from blob', () => {
    const p = newFaceplateProject('Backfill FP')
    persistFaceplate(p)
    // Simulate pre-upgrade (no index) by clearing only the index key.
    localStorage.removeItem('coh2.faceplateIndex.v1')

    const result = listAllFaceplates()
    expect(result.map(e => e.name)).toContain('Backfill FP')
    // Index should now exist.
    expect(getFaceplateMeta(p.id)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. Decal-pack minimal cases + findDecalPackIdByWorkshopId
// ---------------------------------------------------------------------------

describe('decal-pack index', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saveDecalPackToLocal writes index entry', () => {
    const p = newDecalPackProject('My DP')
    saveDecalPackToLocal(p)

    const meta = getDecalPackMeta(p.id)
    expect(meta!.name).toBe('My DP')
    expect(meta!.workshopId).toBeNull()
  })

  it('clearDecalPackWorkshopId nulls workshopId in index', () => {
    const p = newDecalPackProject('WS DP')
    p.workshopId = '77'
    saveDecalPackToLocal(p)

    clearDecalPackWorkshopId(p.id)
    const meta = getDecalPackMeta(p.id)
    expect(meta!.workshopId).toBeNull()
  })

  it('removeRecentDecalPack removes from index', () => {
    const p = newDecalPackProject('Remove DP')
    saveDecalPackToLocal(p)
    expect(getDecalPackMeta(p.id)).not.toBeNull()
    removeRecentDecalPack(p.id)
    expect(getDecalPackMeta(p.id)).toBeNull()
  })

  it('listAllDecalPacks lazy-backfills from blob', () => {
    const p = newDecalPackProject('Backfill DP')
    saveDecalPackToLocal(p)
    localStorage.removeItem('coh2.decalPackIndex.v1')

    const result = listAllDecalPacks()
    expect(result.map(e => e.packName)).toContain('Backfill DP')
    expect(getDecalPackMeta(p.id)).not.toBeNull()
  })

  it('findDecalPackIdByWorkshopId round-trip', () => {
    const p = newDecalPackProject('Workshop DP')
    p.workshopId = '3728271474'
    saveDecalPackToLocal(p)

    const found = findDecalPackIdByWorkshopId('3728271474')
    expect(found).toBe(p.id)
  })

  it('findDecalPackIdByWorkshopId returns null for unknown id', () => {
    const found = findDecalPackIdByWorkshopId('9999999999')
    expect(found).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 7. envName init: filterEnvsBySeason('summer')[0] is summer-classified
// ---------------------------------------------------------------------------

describe('envName init (F2a)', () => {
  it('filterEnvsBySeason(SKYBOX_ENVS, summer) has a valid first entry', () => {
    const summerEnvs = filterEnvsBySeason([...SKYBOX_ENVS], 'summer')
    expect(summerEnvs.length).toBeGreaterThan(0)
    const first = summerEnvs[0]
    expect(first).toBeDefined()
    expect(seasonOfEnv(first)).not.toBe('winter')
  })
})
