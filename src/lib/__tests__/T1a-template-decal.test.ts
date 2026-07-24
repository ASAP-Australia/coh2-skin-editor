/**
 * T1a — Template/Decal requirements unit tests.
 *
 * Each of the six requirements (R1–R6) from the vehicle-editor
 * template/decal spec is tested here.
 *
 * Restrictions: no app launch, no CoH2, no CDP. Pure logic tests only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  newProject,
  getOrInitVehicle,
} from '../project'
import { listStockSkins } from '../stock-skins'
import { exportSkinPack } from '../mod-export'
import type { Faction } from '../vehicles'

// ─────────────────────────────────────────────────────────────────────────────
// R1 — Workshop workshopId fallback for decal pack loading
// Confirms that findDecalPackIdByWorkshopId resolves a pack whose workshopId
// matches the decalPackRef.id stored on the project (the path that fires when
// the user picks a Workshop-sourced decal pack from the pill menu).
// ─────────────────────────────────────────────────────────────────────────────

describe('R1 — Workshop decal pack loading: workshopId fallback', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('findDecalPackIdByWorkshopId returns the local id whose workshopId matches', async () => {
    // We test the pure utility function directly so we don't need to spin up
    // the Editor React component.
    const { newDecalPackProject, saveDecalPackToLocal, findDecalPackIdByWorkshopId } = await import('../decal-pack-project')

    const pack = newDecalPackProject('Workshop Test Pack')
    pack.workshopId = '9876543210' // simulate a subscribed Workshop item
    saveDecalPackToLocal(pack)

    const resolved = findDecalPackIdByWorkshopId('9876543210')
    expect(resolved).toBe(pack.id)
  })

  it('returns null when no pack has the given workshopId', async () => {
    const { findDecalPackIdByWorkshopId } = await import('../decal-pack-project')
    localStorage.clear()
    const resolved = findDecalPackIdByWorkshopId('does-not-exist')
    expect(resolved).toBeNull()
  })

  it('loadDecalPackById round-trips a saved pack', async () => {
    const { newDecalPackProject, saveDecalPackToLocal, loadDecalPackById } = await import('../decal-pack-project')
    const pack = newDecalPackProject('Round Trip')
    saveDecalPackToLocal(pack)
    const loaded = loadDecalPackById(pack.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.packName).toBe('Round Trip')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R1b — Installed decal pack: path threaded through decalPackRef
// Confirms that project.decalPackRef carries an optional `path` field so
// Editor.tsx can open the SGA and extract the badge texture.
// ─────────────────────────────────────────────────────────────────────────────

describe('R1b — Installed decal pack: decalPackRef carries SGA path', () => {
  beforeEach(() => { localStorage.clear() })

  it('decalPackRef.path is stored and round-trips via persistActive/loadActive', async () => {
    const { newProject, persistActive, loadActive } = await import('../project')
    const project = newProject('Installed Decal Path Test')
    project.decalPackRef = {
      id: '/mods/decals/subscriptions/123456789.sga',
      name: 'Some Decal Pack',
      path: '/mods/decals/subscriptions/123456789.sga',
    }
    persistActive(project)
    const reloaded = loadActive()
    expect(reloaded).not.toBeNull()
    expect(reloaded!.decalPackRef?.path).toBe('/mods/decals/subscriptions/123456789.sga')
  })

  it('decalPackRef without path (saved pack) has no path field', async () => {
    const { newProject } = await import('../project')
    const project = newProject('Saved Decal No Path')
    project.decalPackRef = { id: 'dp_abc123', name: 'My Saved Pack' }
    expect(project.decalPackRef.path).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R2 — Faction filtering
// Templates (stock skins) are faction-specific.
// Decals are faction-universal — every decal pack spans all 5 factions.
// ─────────────────────────────────────────────────────────────────────────────

describe('R2 — Faction filtering: stock templates are faction-scoped', () => {
  it('listStockSkins() covers every faction in the vehicle catalogue', () => {
    const skins = listStockSkins()
    const factions = new Set(skins.map(s => s.factionId))
    expect(factions.has('german')).toBe(true)
    expect(factions.has('west_german')).toBe(true)
    expect(factions.has('soviet')).toBe(true)
    expect(factions.has('aef')).toBe(true)
    expect(factions.has('british')).toBe(true)
  })

  it('filtering listStockSkins() by faction yields only that faction', () => {
    const faction: Faction = 'soviet'
    const filtered = listStockSkins().filter(s => s.factionId === faction)
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every(s => s.factionId === faction)).toBe(true)
  })

  it('filtering for each faction gives a disjoint result set', () => {
    const factions: Faction[] = ['german', 'west_german', 'soviet', 'aef', 'british']
    const sets = factions.map(f => new Set(listStockSkins().filter(s => s.factionId === f).map(s => s.id)))
    // No vehicle id should appear under two different factions
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        for (const id of sets[i]) {
          expect(sets[j].has(id)).toBe(false)
        }
      }
    }
  })
})

describe('R2 — Faction filtering: decals are faction-universal', () => {
  it('FACTION_ORDER in decal-mod-templates spans all 5 factions (decals are universal)', async () => {
    // Decal packs in CoH2 include one RGD per faction, so they work for any army.
    // This is the canonical evidence that decals need NO faction filter.
    const { FACTION_ORDER } = await import('../decal-mod-templates')
    const expected = ['aef', 'british', 'german', 'soviet', 'west_german']
    expect([...FACTION_ORDER].sort()).toEqual(expected)
    expect(FACTION_ORDER.length).toBe(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R3 — Picker row format: no path text; preview + name only
// The hint field must NOT contain filesystem paths in picker rows.
// ─────────────────────────────────────────────────────────────────────────────

describe('R3 — Picker rows: no path text in template options', () => {
  it('stock skin name does not contain the sgaName/path in its display label', () => {
    // The row should show s.name, not s.sgaName (which looks like "ArtGermanEF.sga")
    const skins = listStockSkins()
    for (const s of skins) {
      // The display name should not look like a filename (no .sga suffix)
      expect(s.name).not.toMatch(/\.sga$/i)
      // The sgaName is a separate field and should never appear in the name
      expect(s.name).not.toContain(s.sgaName)
    }
  })

  it('stock skin sgaName is a bare filename (no directory separators)', () => {
    // Only the basename is stored as sgaName; it is NOT shown in UI rows.
    const skins = listStockSkins()
    for (const s of skins) {
      expect(s.sgaName).not.toContain('/')
      expect(s.sgaName).not.toContain('\\')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R4 — Decal is cosmetic-only in skin export
// The exportSkinPack pipeline must NOT include decalPackRef in the SGA.
// The export only uses veh.decals (placed decals) and veh.customDiffuseUrl.
// ─────────────────────────────────────────────────────────────────────────────

describe('R4 — Decal is cosmetic-only: not baked into skin export', () => {
  beforeEach(() => localStorage.clear())

  it('exportSkinPack rejects a project with only a decalPackRef and no vehicle content', async () => {
    // A project that only has a decalPackRef (and no user decals or custom diffuse)
    // must fail to export — it has no actual skin content to pack.
    const fakeRoot = {} as FileSystemDirectoryHandle
    const project = newProject('Decal Only')
    project.decalPackRef = { id: 'dp_test', name: 'My Decal Pack' }
    // No vehicles with decals or customDiffuseUrl — should throw.

    await expect(
      exportSkinPack(fakeRoot, project, () => {}),
    ).rejects.toThrow()
  })

  it('project.decalPackRef is stored only as a UI association, not merged into project.vehicles', () => {
    const project = newProject('Association Test')
    project.decalPackRef = { id: 'dp_abc', name: 'Test Decal Pack' }

    // Vehicle entries have no knowledge of the decal pack
    const veh = getOrInitVehicle(project, 'tiger')
    expect(veh).not.toHaveProperty('decalPackRef')
    // The decalPackRef lives only at the project level (preview/association)
    expect(project.decalPackRef).toEqual({ id: 'dp_abc', name: 'Test Decal Pack' })
    // Vehicles still have their own independent decals array (user-placed)
    expect(veh.decals).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R5 — Template is functional in skin export
// When a template has been chosen and its diffuse baked into veh.customDiffuseUrl,
// exportSkinPack MUST include that vehicle (not skip it for having zero decals).
// ─────────────────────────────────────────────────────────────────────────────

describe('R5 — Template included in skin export when customDiffuseUrl is set', () => {
  beforeEach(() => localStorage.clear())

  it('exportSkinPack includes a vehicle with customDiffuseUrl but zero placed decals', async () => {
    // This tests the R5 fix: composeVehicleDiffuse now skips ONLY when
    // BOTH decals.length===0 AND customDiffuseUrl is absent.
    const fakeRoot = {} as FileSystemDirectoryHandle
    const project = newProject('Template Export Test')
    const veh = getOrInitVehicle(project, 'tiger')
    // Simulate a template bake: customDiffuseUrl set, no user-placed decals.
    veh.customDiffuseUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    // decals remains [] — no user-placed decals, only the template texture.

    // The export pipeline will try to fetch template files which aren't present
    // in the test env. The key assertion is that we pass the vehicle-selection
    // gate (line that builds vehicleIds) — the error comes from fetchTemplate,
    // not from "no vehicles with decals".
    let caughtError: Error | null = null
    try {
      await exportSkinPack(fakeRoot, project, () => {})
    } catch (e) {
      caughtError = e as Error
    }

    // We must NOT see the "no vehicles with decals or a chosen template" gate error.
    // The failure must come from downstream (fetchTemplate, locateArchives, etc.)
    expect(caughtError).not.toBeNull()
    expect(caughtError!.message).not.toMatch(/no vehicles with decals/i)
    expect(caughtError!.message).not.toMatch(/no vehicles with decals or a chosen template/i)
  })

  it('a project with zero vehicles (no decals, no template) is rejected with a clear message', async () => {
    const fakeRoot = {} as FileSystemDirectoryHandle
    const project = newProject('Empty Project')
    // No vehicles added at all.
    await expect(
      exportSkinPack(fakeRoot, project, () => {}),
    ).rejects.toThrow(/no vehicles with decals or a chosen template/i)
  })

  it('a project with only decalPackRef (no decals, no template) is rejected', async () => {
    const fakeRoot = {} as FileSystemDirectoryHandle
    const project = newProject('Decal Ref Only')
    project.decalPackRef = { id: 'dp_test', name: 'Some Decal Pack' }
    // Still no vehicle content (decals or customDiffuseUrl).
    await expect(
      exportSkinPack(fakeRoot, project, () => {}),
    ).rejects.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R6 — Edit Texture edits the template texture
// When a template has been chosen (customDiffuseUrl is set), the texture editor
// must operate on that template texture (via baseDiffuse = customDiffuseUrl).
// When no template, it edits the vanilla/base diffuse.
// This is wired in Editor.tsx onModelLoaded (lines ~1539-1560):
//   effectiveCustomDiffuseUrl(project, veh.id, veh.faction) → drawn into baseDiffuse.
// ─────────────────────────────────────────────────────────────────────────────

describe('R6 — Edit Texture reads template texture when template is set', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('effectiveCustomDiffuseUrl returns the template-baked diffuse when set on vehicle', async () => {
    const { effectiveCustomDiffuseUrl } = await import('../project')
    const project = newProject('Template R6 Test')
    const veh = getOrInitVehicle(project, 'tiger')
    const templateDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ=='
    veh.customDiffuseUrl = templateDataUrl

    const result = effectiveCustomDiffuseUrl(project, 'tiger', 'german')
    expect(result).toBe(templateDataUrl)
  })

  it('effectiveCustomDiffuseUrl returns null when no template has been baked', async () => {
    const { effectiveCustomDiffuseUrl } = await import('../project')
    const project = newProject('No Template')
    // No customDiffuseUrl set anywhere.
    const result = effectiveCustomDiffuseUrl(project, 'tiger', 'german')
    expect(result).toBeNull()
  })

  it('effectiveCustomDiffuseUrl prefers per-vehicle over faction-default', async () => {
    const { effectiveCustomDiffuseUrl, getOrInitFactionDefault } = await import('../project')
    const project = newProject('Per-Vehicle Priority')
    const veh = getOrInitVehicle(project, 'tiger')
    const vehicleUrl = 'data:image/png;base64,vehicle=='
    const factionUrl = 'data:image/png;base64,faction=='
    veh.customDiffuseUrl = vehicleUrl
    const fd = getOrInitFactionDefault(project, 'german')
    fd.customDiffuseUrl = factionUrl

    // Vehicle-level wins
    expect(effectiveCustomDiffuseUrl(project, 'tiger', 'german')).toBe(vehicleUrl)
  })

  it('template ref is stored on project.template, not inside vehicle state', () => {
    // The template ref is a project-level metadata field, not merged into vehicles.
    const project = newProject('Template Ref Test')
    project.template = { id: 'stock:german/tiger', kind: 'stock', name: 'Tiger I (Stock)' }
    // Vehicle state is separate from template ref
    const veh = getOrInitVehicle(project, 'tiger')
    expect(veh).not.toHaveProperty('template')
    expect(project.template?.id).toBe('stock:german/tiger')
  })

  it('when template diffuse is baked it is persisted and round-trips via persistActive/loadActive', async () => {
    const { persistActive, loadActive } = await import('../project')
    const project = newProject('Persist Template Diffuse')
    const veh = getOrInitVehicle(project, 'brummbar')
    const templateUrl = 'data:image/png;base64,templatebaked=='
    veh.customDiffuseUrl = templateUrl
    project.lastVehicleId = 'brummbar'

    persistActive(project)
    const reloaded = loadActive()
    expect(reloaded).not.toBeNull()
    expect(reloaded!.vehicles['brummbar']?.customDiffuseUrl).toBe(templateUrl)
  })
})
