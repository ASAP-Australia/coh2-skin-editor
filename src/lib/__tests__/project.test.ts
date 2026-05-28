import { describe, it, expect, beforeEach } from 'vitest'
import {
  newProject,
  getOrInitVehicle,
  getOrInitFactionDefault,
  effectiveCamoPreset,
  effectiveCustomDiffuseUrl,
  effectiveMainDecalId,
  getRecentProjects,
  listAllSkinProjects,
  persistActive,
  relTime,
  syncLiveStateToActiveSlot,
  loadSlotIntoLiveState,
  trackRecentProject,
  DEFAULT_PALETTE,
  type Coh2SkinProject,
} from '../project'
import type { CamoPreset } from '../camo-generator'

// Minimal valid CamoPreset fixture for tests that need one.
function makeCamoPreset(label: string): CamoPreset {
  return {
    style: 'softBlobs',
    colors: ['#333333', '#444444', '#555555'],
    seed: 1,
    scale: 1.0,
    rotation: 0,
    blur: 0,
    label,
  }
}

// ---------------------------------------------------------------------------
// newProject
// ---------------------------------------------------------------------------

describe('newProject', () => {
  it('creates a project with the given pack name', () => {
    const p = newProject('Test Pack')
    expect(p.packName).toBe('Test Pack')
  })

  it('defaults pack name to "My Skin Pack" when not provided', () => {
    const p = newProject()
    expect(p.packName).toBe('My Skin Pack')
  })

  it('sets magic and version fields correctly', () => {
    const p = newProject('x')
    expect(p.magic).toBe('coh2-skin-project')
    expect(p.version).toBe(2)
  })

  it('generates a stable id with the proj_ prefix', () => {
    const p = newProject('x')
    expect(p.id).toMatch(/^proj_[a-z0-9]+$/)
  })

  it('creates 6 export slots (3 summer + 3 winter)', () => {
    const p = newProject('x')
    expect(p.exportSlots).toHaveLength(6)
    const summers = p.exportSlots.filter(s => s.season === 'summer')
    const winters = p.exportSlots.filter(s => s.season === 'winter')
    expect(summers).toHaveLength(3)
    expect(winters).toHaveLength(3)
  })

  it('uses DEFAULT_PALETTE for the initial palette', () => {
    const p = newProject('x')
    expect(p.palette).toEqual(DEFAULT_PALETTE)
  })

  it('starts with empty vehicles, images, and generationSessions', () => {
    const p = newProject('x')
    expect(Object.keys(p.vehicles)).toHaveLength(0)
    expect(Object.keys(p.images)).toHaveLength(0)
    expect(Object.keys(p.generationSessions)).toHaveLength(0)
  })

  it('sets activeSlotIdx to 0', () => {
    const p = newProject('x')
    expect(p.activeSlotIdx).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getOrInitVehicle
// ---------------------------------------------------------------------------

describe('getOrInitVehicle', () => {
  it('creates a new vehicle entry when the id is absent', () => {
    const p = newProject('x')
    const v = getOrInitVehicle(p, 'german_panther')
    expect(v.id).toBe('german_panther')
    expect(v.decals).toEqual([])
    expect(v.tac).toBeNull()
    expect(v.name).toBeNull()
  })

  it('returns the existing entry without overwriting it', () => {
    const p = newProject('x')
    const v1 = getOrInitVehicle(p, 'german_tiger')
    v1.tac = '007'
    const v2 = getOrInitVehicle(p, 'german_tiger')
    expect(v2.tac).toBe('007')
    expect(v2).toBe(v1)
  })

  it('stores the vehicle in project.vehicles', () => {
    const p = newProject('x')
    getOrInitVehicle(p, 'soviet_t34')
    expect(p.vehicles['soviet_t34']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// getOrInitFactionDefault
// ---------------------------------------------------------------------------

describe('getOrInitFactionDefault', () => {
  it('creates a default entry with null camo and empty decals', () => {
    const p = newProject('x')
    const fd = getOrInitFactionDefault(p, 'german')
    expect(fd.camoPreset).toBeNull()
    expect(fd.customDiffuseUrl).toBeNull()
    expect(fd.decals).toEqual([])
    expect(fd.mainDecalId).toBeNull()
  })

  it('returns the same object on second call', () => {
    const p = newProject('x')
    const fd1 = getOrInitFactionDefault(p, 'soviet')
    fd1.mainDecalId = 42
    const fd2 = getOrInitFactionDefault(p, 'soviet')
    expect(fd2.mainDecalId).toBe(42)
    expect(fd2).toBe(fd1)
  })
})

// ---------------------------------------------------------------------------
// effectiveCamoPreset
// ---------------------------------------------------------------------------

describe('effectiveCamoPreset', () => {
  let p: Coh2SkinProject

  beforeEach(() => {
    p = newProject('x')
  })

  it('returns null when no vehicle or faction default is set', () => {
    getOrInitVehicle(p, 'german_panther')
    expect(effectiveCamoPreset(p, 'german_panther', 'german')).toBeNull()
  })

  it('returns the faction default when vehicle has no override', () => {
    getOrInitVehicle(p, 'german_panther')
    const fd = getOrInitFactionDefault(p, 'german')
    fd.camoPreset = makeCamoPreset('dark-green')
    expect(effectiveCamoPreset(p, 'german_panther', 'german')).toEqual(fd.camoPreset)
  })

  it('returns the per-vehicle override over the faction default', () => {
    const v = getOrInitVehicle(p, 'german_panther')
    const vehiclePreset = makeCamoPreset('vehicle-olive')
    v.camoPreset = vehiclePreset
    const fd = getOrInitFactionDefault(p, 'german')
    fd.camoPreset = makeCamoPreset('faction-grey')
    expect(effectiveCamoPreset(p, 'german_panther', 'german')).toEqual(vehiclePreset)
  })

  it('falls through to faction default when vehicle camoPreset is undefined', () => {
    // Vehicle added but camoPreset not set (undefined, not null)
    p.vehicles['german_panther'] = { id: 'german_panther', tac: null, name: null, decals: [] }
    const fd = getOrInitFactionDefault(p, 'german')
    const factionPreset = makeCamoPreset('fallback-white')
    fd.camoPreset = factionPreset
    expect(effectiveCamoPreset(p, 'german_panther', 'german')).toEqual(factionPreset)
  })
})

// ---------------------------------------------------------------------------
// effectiveCustomDiffuseUrl
// ---------------------------------------------------------------------------

describe('effectiveCustomDiffuseUrl', () => {
  let p: Coh2SkinProject

  beforeEach(() => {
    p = newProject('x')
  })

  it('returns null when neither vehicle nor faction has a custom diffuse', () => {
    getOrInitVehicle(p, 'german_panther')
    expect(effectiveCustomDiffuseUrl(p, 'german_panther', 'german')).toBeNull()
  })

  it('returns the faction default URL when vehicle has none', () => {
    getOrInitVehicle(p, 'german_panther')
    const fd = getOrInitFactionDefault(p, 'german')
    fd.customDiffuseUrl = 'data:image/png;base64,abc'
    expect(effectiveCustomDiffuseUrl(p, 'german_panther', 'german')).toBe(
      'data:image/png;base64,abc',
    )
  })

  it('returns the per-vehicle URL over the faction default', () => {
    const v = getOrInitVehicle(p, 'german_panther')
    v.customDiffuseUrl = 'data:image/png;base64,vehicle-specific'
    const fd = getOrInitFactionDefault(p, 'german')
    fd.customDiffuseUrl = 'data:image/png;base64,faction-default'
    expect(effectiveCustomDiffuseUrl(p, 'german_panther', 'german')).toBe(
      'data:image/png;base64,vehicle-specific',
    )
  })
})

// ---------------------------------------------------------------------------
// effectiveMainDecalId
// ---------------------------------------------------------------------------

describe('effectiveMainDecalId', () => {
  let p: Coh2SkinProject

  beforeEach(() => {
    p = newProject('x')
  })

  it('returns null when nothing is set', () => {
    getOrInitVehicle(p, 'german_panther')
    expect(effectiveMainDecalId(p, 'german_panther', 'german')).toBeNull()
  })

  it('returns faction default when vehicle has no override', () => {
    getOrInitVehicle(p, 'german_panther')
    const fd = getOrInitFactionDefault(p, 'german')
    fd.mainDecalId = 5
    expect(effectiveMainDecalId(p, 'german_panther', 'german')).toBe(5)
  })

  it('returns vehicle override over faction default', () => {
    const v = getOrInitVehicle(p, 'german_panther')
    v.mainDecalId = 99
    const fd = getOrInitFactionDefault(p, 'german')
    fd.mainDecalId = 5
    expect(effectiveMainDecalId(p, 'german_panther', 'german')).toBe(99)
  })
})

// ---------------------------------------------------------------------------
// relTime
// ---------------------------------------------------------------------------

describe('relTime', () => {
  it('returns "just now" for timestamps within the last minute', () => {
    expect(relTime(Date.now() - 30_000)).toBe('just now')
    expect(relTime(Date.now() - 59_000)).toBe('just now')
  })

  it('returns minutes ago for 1-59 minutes', () => {
    expect(relTime(Date.now() - 5 * 60_000)).toBe('5m ago')
    expect(relTime(Date.now() - 59 * 60_000)).toBe('59m ago')
  })

  it('returns hours ago for 1-23 hours', () => {
    expect(relTime(Date.now() - 3 * 3_600_000)).toBe('3h ago')
    expect(relTime(Date.now() - 23 * 3_600_000)).toBe('23h ago')
  })

  it('returns days ago for 1-6 days', () => {
    expect(relTime(Date.now() - 2 * 86_400_000)).toBe('2d ago')
    expect(relTime(Date.now() - 6 * 86_400_000)).toBe('6d ago')
  })

  it('returns weeks ago for 7+ days', () => {
    expect(relTime(Date.now() - 7 * 86_400_000)).toBe('1w ago')
    expect(relTime(Date.now() - 14 * 86_400_000)).toBe('2w ago')
  })
})

// ---------------------------------------------------------------------------
// syncLiveStateToActiveSlot / loadSlotIntoLiveState
// ---------------------------------------------------------------------------

describe('syncLiveStateToActiveSlot', () => {
  it('mirrors live vehicles into the active slot state', () => {
    const p = newProject('x')
    const v = getOrInitVehicle(p, 'german_panther')
    v.tac = '42'
    syncLiveStateToActiveSlot(p)
    expect(p.exportSlots[0].state.vehicles['german_panther']?.tac).toBe('42')
  })

  it('deep-clones so mutating project vehicles does not affect the snapshot', () => {
    const p = newProject('x')
    const v = getOrInitVehicle(p, 'german_panther')
    v.tac = '1'
    syncLiveStateToActiveSlot(p)
    v.tac = '99'
    // Snapshot should still hold '1'
    expect(p.exportSlots[0].state.vehicles['german_panther']?.tac).toBe('1')
  })
})

describe('loadSlotIntoLiveState', () => {
  it('restores the vehicle state from the given slot into live fields', () => {
    const p = newProject('x')
    // Manually inject state into slot 1
    p.exportSlots[1].state.vehicles['soviet_t34'] = {
      id: 'soviet_t34',
      tac: 'T-34',
      name: null,
      decals: [],
    }
    loadSlotIntoLiveState(p, 1)
    expect(p.activeSlotIdx).toBe(1)
    expect(p.vehicles['soviet_t34']?.tac).toBe('T-34')
  })

  it('updates activeSlotIdx to the loaded slot index', () => {
    const p = newProject('x')
    expect(p.activeSlotIdx).toBe(0)
    loadSlotIntoLiveState(p, 2)
    expect(p.activeSlotIdx).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// trackRecentProject / getRecentProjects — TemplatePicker hover-preview
// thumbnail derived from the project's vehicleIcons cache.
// ---------------------------------------------------------------------------

describe('trackRecentProject thumbnail derivation', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('records null thumbnail when the project has no cached vehicle icons', () => {
    const p = newProject('No Icons')
    trackRecentProject(p)
    const entry = getRecentProjects().find(e => e.id === p.id)
    expect(entry).toBeDefined()
    expect(entry?.thumbnail ?? null).toBeNull()
  })

  it('uses the first vehicleIcons entry as the thumbnail', () => {
    const p = newProject('With Icon')
    p.vehicleIcons['german_panzer4'] = 'data:image/png;base64,FIRSTICON'
    trackRecentProject(p)
    const entry = getRecentProjects().find(e => e.id === p.id)
    expect(entry?.thumbnail).toBe('data:image/png;base64,FIRSTICON')
  })

  it('preserves the prior thumbnail across re-tracks when the icon cache later goes empty', () => {
    // Edge case: a v1 project re-tracked after a migration could have an
    // empty vehicleIcons cache transiently. The prior thumbnail (from a
    // previous track) is kept so the picker preview never flickers to
    // the placeholder.
    const p = newProject('Preserve')
    p.vehicleIcons['v1'] = 'data:image/png;base64,FIRST'
    trackRecentProject(p)
    // Simulate icon cache being wiped between saves.
    p.vehicleIcons = {}
    p.packName = 'Preserve Renamed'
    trackRecentProject(p)
    const entry = getRecentProjects().find(e => e.id === p.id)
    expect(entry?.name).toBe('Preserve Renamed')
    expect(entry?.thumbnail).toBe('data:image/png;base64,FIRST')
  })
})

// ---------------------------------------------------------------------------
// listAllSkinProjects — clone-template + Saved-projects readers walk every
// snapshot key on disk, NOT the 12-cap recent registry. They also drop
// broken snapshots (missing key / parse-fail / wrong magic) so the picker
// never surfaces a project that would crash the editor on click.
// ---------------------------------------------------------------------------

describe('listAllSkinProjects', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('enumerates more than the 12-entry recent registry cap', () => {
    // Persist 20 projects — the registry will only retain the most recent
    // 12, but every per-id snapshot stays at `coh2.project.<id>`.
    for (let i = 0; i < 20; i++) {
      const p = newProject(`Pack ${i}`)
      persistActive(p)
    }
    expect(getRecentProjects().length).toBe(12)
    expect(listAllSkinProjects().length).toBe(20)
  })

  it('excludes snapshots that are not valid JSON', () => {
    const p = newProject('Good Pack')
    persistActive(p)
    // Inject a corrupt per-id snapshot — a left-over from a previous
    // schema or a partial write.
    localStorage.setItem('coh2.project.broken_id_1', '{not json}')
    const all = listAllSkinProjects()
    expect(all.find(e => e.id === p.id)).toBeDefined()
    expect(all.find(e => e.id === 'broken_id_1')).toBeUndefined()
  })

  it('excludes snapshots whose magic header does not match', () => {
    const p = newProject('Good Pack')
    persistActive(p)
    // Wrong magic — could be a stray faceplate written under the wrong
    // prefix by some future bug. Either way: don't surface it.
    localStorage.setItem(
      'coh2.project.wrong_magic',
      JSON.stringify({ magic: 'something-else', id: 'wrong_magic' }),
    )
    const all = listAllSkinProjects()
    expect(all.find(e => e.id === p.id)).toBeDefined()
    expect(all.find(e => e.id === 'wrong_magic')).toBeUndefined()
  })

  it('sorts by lastEditedAt descending (newest first)', () => {
    const older = newProject('Older')
    persistActive(older)
    const newer = newProject('Newer')
    persistActive(newer)
    // Stamp explicit lastEditedAt on the registry so the test is
    // deterministic regardless of Date.now() collisions during a tight
    // persist loop (in real use these events are separated by user
    // interaction time).
    const cached = getRecentProjects()
    const stamped = cached.map(e =>
      e.id === older.id ? { ...e, lastEditedAt: 100 } : { ...e, lastEditedAt: 200 },
    )
    localStorage.setItem('coh2.recentProjects', JSON.stringify(stamped))
    const all = listAllSkinProjects()
    expect(all[0]?.id).toBe(newer.id)
    expect(all[1]?.id).toBe(older.id)
  })
})
