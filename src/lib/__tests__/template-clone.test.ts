/**
 * Tests for the template INDEXING and CLONING pipeline (C3/C5/C6/C7).
 *
 * These exercise the pure / localStorage-backed layer that powers the
 * centre-title template dropdown:
 *   • listStockSkins()             — stock game-skin index
 *   • listAllSkinProjects()        — the user's saved packs as templates
 *   • parseStockTemplateId()       — 'stock:<faction>/<vehicleId>' round-trip
 *   • cloneSkinProjectFromTemplate — blank / saved / stock clone behaviour
 *
 * The live Workshop index (detectWorkshopPath / listWorkshopItems) is an
 * Electron-IPC wrapper that throws outside Electron, so it is verified via a
 * mocked window.electronAPI rather than the real native bridge.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  newProject,
  persistActive,
  loadById,
  listAllSkinProjects,
  getOrInitVehicle,
  cloneSkinProjectFromTemplate,
  parseStockTemplateId,
  DEFAULT_PALETTE,
} from '../project'
import { listStockSkins } from '../stock-skins'
import { VEHICLES } from '../vehicles'

// ---------------------------------------------------------------------------
// Stock-skin indexing
// ---------------------------------------------------------------------------

describe('listStockSkins — stock template index', () => {
  it('returns a non-empty catalogue derived from VEHICLES', () => {
    const skins = listStockSkins()
    expect(skins.length).toBeGreaterThan(0)
    // Never more entries than vehicles (one skin per vehicle, minus any
    // faction with no SGA candidates).
    expect(skins.length).toBeLessThanOrEqual(VEHICLES.length)
  })

  it('gives every entry the documented shape', () => {
    for (const s of listStockSkins()) {
      expect(s.id).toBe(`${s.factionId}/${s.vehicleId}`)
      expect(typeof s.name).toBe('string')
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.sgaName).toMatch(/\.sga$/i)
      expect(s.internalPath).toMatch(/^art\/armies\/.+_dif\.rgt$/)
      // Every entry must name a real vehicle in the catalogue.
      expect(VEHICLES.some(v => v.id === s.vehicleId && v.faction === s.factionId)).toBe(true)
    }
  })

  it('is sorted by display name and spans multiple factions', () => {
    const skins = listStockSkins()
    const names = skins.map(s => s.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    const factions = new Set(skins.map(s => s.factionId))
    expect(factions.size).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// Saved-pack indexing (template source)
// ---------------------------------------------------------------------------

describe('listAllSkinProjects — saved template index', () => {
  beforeEach(() => localStorage.clear())

  it('surfaces persisted packs and excludes broken snapshots', () => {
    const a = newProject('Alpha Pack')
    const b = newProject('Bravo Pack')
    persistActive(a)
    persistActive(b)
    // A corrupt per-id snapshot must never appear as a template option.
    localStorage.setItem('coh2.project.broken', '{ not json')

    const idx = listAllSkinProjects()
    expect(idx.find(e => e.id === a.id)?.name).toBe('Alpha Pack')
    expect(idx.find(e => e.id === b.id)?.name).toBe('Bravo Pack')
    expect(idx.find(e => e.id === 'broken')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// parseStockTemplateId
// ---------------------------------------------------------------------------

describe('parseStockTemplateId', () => {
  it('round-trips a real stock id', () => {
    const stock = listStockSkins()[0]
    const parsed = parseStockTemplateId(`stock:${stock.id}`)
    expect(parsed).toEqual({ faction: stock.factionId, vehicleId: stock.vehicleId })
  })

  it('rejects malformed ids and unknown vehicles', () => {
    expect(parseStockTemplateId('blank')).toBeNull()
    expect(parseStockTemplateId('stock:german')).toBeNull() // no slash
    expect(parseStockTemplateId('stock:german/not_a_real_vehicle')).toBeNull()
    expect(parseStockTemplateId('saved:proj_123')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// cloneSkinProjectFromTemplate
// ---------------------------------------------------------------------------

describe('cloneSkinProjectFromTemplate — blank', () => {
  beforeEach(() => localStorage.clear())

  it('produces a fresh empty project tagged blank', () => {
    const clone = cloneSkinProjectFromTemplate({ id: 'blank', kind: 'blank', name: 'Blank canvas' })
    expect(clone).not.toBeNull()
    expect(clone!.magic).toBe('coh2-skin-project')
    expect(Object.keys(clone!.vehicles)).toHaveLength(0)
    expect(clone!.template).toEqual({ id: 'blank', kind: 'blank', name: 'Blank canvas' })
    expect(clone!.id).toMatch(/^proj_/)
  })
})

describe('cloneSkinProjectFromTemplate — saved', () => {
  beforeEach(() => localStorage.clear())

  function makeSourceWithContent(name: string) {
    const src = newProject(name)
    const vid = VEHICLES[0].id
    // Give it real, clonable content.
    getOrInitVehicle(src, vid)
    src.palette = { ...DEFAULT_PALETTE, orange: '#ABCDEF' }
    src.lastVehicleId = vid
    src.workshopId = '1234567890'
    persistActive(src)
    return { src, vid }
  }

  it('deep-clones content but assigns a new id and clears workshopId', () => {
    const { src, vid } = makeSourceWithContent('Original')
    const clone = cloneSkinProjectFromTemplate({ id: src.id, kind: 'saved', name: src.packName })
    expect(clone).not.toBeNull()
    // New identity.
    expect(clone!.id).not.toBe(src.id)
    expect(clone!.id).toMatch(/^proj_/)
    // Content preserved.
    expect(clone!.packName).toBe('Original')
    expect(clone!.palette.orange).toBe('#ABCDEF')
    expect(Object.keys(clone!.vehicles)).toContain(vid)
    // A clone is a brand-new unpublished pack.
    expect(clone!.workshopId).toBeUndefined()
    expect(clone!.titleAcknowledged).toBe(false)
    // Template ref points back at the source.
    expect(clone!.template).toEqual({ id: src.id, kind: 'saved', name: 'Original' })
  })

  it('is fully independent — mutating the clone never touches the source', () => {
    const { src, vid } = makeSourceWithContent('Independent')
    const clone = cloneSkinProjectFromTemplate({ id: src.id, kind: 'saved', name: src.packName })!
    // Mutate the clone deeply.
    clone.palette.orange = '#000000'
    getOrInitVehicle(clone, VEHICLES[1].id)
    // The on-disk source is untouched.
    const reloaded = loadById(src.id)!
    expect(reloaded.palette.orange).toBe('#ABCDEF')
    expect(Object.keys(reloaded.vehicles)).toEqual([vid])
  })

  it('returns null when the saved source id cannot be loaded', () => {
    const clone = cloneSkinProjectFromTemplate({ id: 'missing_id', kind: 'saved', name: 'Gone' })
    expect(clone).toBeNull()
  })
})

describe('cloneSkinProjectFromTemplate — stock', () => {
  beforeEach(() => localStorage.clear())

  it('seeds a fresh project pre-targeted at the stock vehicle', () => {
    const stock = listStockSkins()[0]
    const clone = cloneSkinProjectFromTemplate({
      id: `stock:${stock.id}`,
      kind: 'stock',
      name: stock.name,
    })!
    expect(clone.template).toEqual({ id: `stock:${stock.id}`, kind: 'stock', name: stock.name })
    expect(clone.lastVehicleId).toBe(stock.vehicleId)
    expect(clone.id).toMatch(/^proj_/)
  })

  it('degrades gracefully on an unknown stock vehicle (no crash, null target)', () => {
    const clone = cloneSkinProjectFromTemplate({
      id: 'stock:german/not_a_real_vehicle',
      kind: 'stock',
      name: 'Bogus',
    })!
    expect(clone).not.toBeNull()
    expect(clone.lastVehicleId).toBeNull()
    expect(clone.template?.kind).toBe('stock')
  })
})

// ---------------------------------------------------------------------------
// Workshop indexing (Electron-IPC wrapper — verified via a mock bridge)
// ---------------------------------------------------------------------------

describe('workshop index — listWorkshopItems via mocked electronAPI', () => {
  it('returns the items the native bridge reports, pruning archive-less ones at the source', async () => {
    // listWorkshopItems is a thin pass-through over window.electronAPI; the
    // real pruning (numeric-id folders, first .sga) happens in electron main.
    // Here we assert the renderer wrapper faithfully forwards the bridge's
    // already-pruned result.
    const fakeItems = [
      { id: '111', dir: '/ws/111', sgaPath: '/ws/111/skin.sga' },
      { id: '222', dir: '/ws/222', sgaPath: null }, // legacy .bin — kept, sgaPath null
    ]
    const api = {
      detectCoh2Workshop: vi.fn(async () => '/ws'),
      listWorkshopItems: vi.fn(async (_root: string) => fakeItems),
    }
    // @ts-expect-error — partial mock of the Electron bridge for this test.
    globalThis.window.electronAPI = api

    const { detectWorkshopPath, listWorkshopItems } = await import('../native-fs')
    const root = await detectWorkshopPath()
    expect(root).toBe('/ws')
    const items = await listWorkshopItems(root!)
    expect(items).toEqual(fakeItems)
    expect(api.listWorkshopItems).toHaveBeenCalledWith('/ws')

    // Clean up the mock bridge (optional property — safe to delete).
    globalThis.window.electronAPI = undefined
  })
})
