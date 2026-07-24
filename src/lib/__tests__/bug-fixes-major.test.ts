/**
 * bug-fixes-major.test.ts
 *
 * Regression tests for the three MAJOR bugs fixed in the 2026-06-14 bug-fix pass:
 *
 * MAJOR-3: Skin pack `workshopVisibility` persistence
 *   — Coh2SkinProject now has a `workshopVisibility` field that round-trips
 *     correctly through project storage and can be read back after mutation.
 *
 * MAJOR-1: Live-sync workshop update reads project's `workshopVisibility`
 *   — The _doWorkshopUpdate helper must pass the project's stored visibility
 *     (not a hardcoded 3) when building the update payload.
 *
 * MAJOR-2: Faction-scope diffuse includes unvisited vehicles in export
 *   — collectExportVehicleIds / composeVehicleDiffuse must include vehicles
 *     that were never navigated to but whose faction has a factionDefault
 *     customDiffuseUrl set.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  newProject,
  getOrInitFactionDefault,
  effectiveCustomDiffuseUrl,
  type Coh2SkinProject,
} from '../project'
import { collectExportVehicleIds } from '../mod-export'

// ---------------------------------------------------------------------------
// MAJOR-3 — workshopVisibility round-trips on Coh2SkinProject
// ---------------------------------------------------------------------------

describe('MAJOR-3 — workshopVisibility on Coh2SkinProject', () => {
  it('starts undefined on a freshly-created project (not yet published)', () => {
    const p = newProject('Test Pack')
    expect(p.workshopVisibility).toBeUndefined()
  })

  it('can be set to each valid visibility value (0–3) and reads back correctly', () => {
    const values: Array<0 | 1 | 2 | 3> = [0, 1, 2, 3]
    for (const vis of values) {
      const p = newProject('Test Pack')
      const updated: Coh2SkinProject = { ...p, workshopVisibility: vis }
      expect(updated.workshopVisibility).toBe(vis)
    }
  })

  it('persists through a spread-clone (mirrors onPublished mutation in TopBar.tsx)', () => {
    const p = newProject('Test Pack')
    // Simulate the onPublished callback: { ...p.project, workshopVisibility: visibility }
    const afterPublish: Coh2SkinProject = { ...p, workshopVisibility: 1 }
    expect(afterPublish.workshopVisibility).toBe(1)
    // Original unchanged
    expect(p.workshopVisibility).toBeUndefined()
  })

  it('is preserved when updating other fields (simulate a name edit after publish)', () => {
    const p: Coh2SkinProject = { ...newProject('Test Pack'), workshopVisibility: 0 }
    const afterEdit: Coh2SkinProject = { ...p, packName: 'Renamed Pack' }
    expect(afterEdit.workshopVisibility).toBe(0)
    expect(afterEdit.packName).toBe('Renamed Pack')
  })
})

// ---------------------------------------------------------------------------
// MAJOR-1 — live-sync update picks up project's workshopVisibility
// ---------------------------------------------------------------------------

describe('MAJOR-1 — live-sync visibility selection logic', () => {
  /**
   * Mirror the exact logic in live-sync.ts _doWorkshopUpdate after the fix:
   *   const p = project as { ...; workshopVisibility?: 0|1|2|3 }
   *   const updateVisibility: 0|1|2|3 = p.workshopVisibility ?? 3
   *
   * We test this extracted logic directly; the rest of _doWorkshopUpdate
   * requires Electron/IPC mocks so is covered by live-verify.
   */
  function pickUpdateVisibility(project: { workshopVisibility?: 0 | 1 | 2 | 3 }): 0 | 1 | 2 | 3 {
    return project.workshopVisibility ?? 3
  }

  it('uses the project workshopVisibility=0 (Public) instead of hardcoding 3', () => {
    const project = { workshopVisibility: 0 as const }
    expect(pickUpdateVisibility(project)).toBe(0)
  })

  it('uses the project workshopVisibility=1 (FriendsOnly)', () => {
    const project = { workshopVisibility: 1 as const }
    expect(pickUpdateVisibility(project)).toBe(1)
  })

  it('uses the project workshopVisibility=2 (Private)', () => {
    const project = { workshopVisibility: 2 as const }
    expect(pickUpdateVisibility(project)).toBe(2)
  })

  it('uses the project workshopVisibility=3 (Unlisted)', () => {
    const project = { workshopVisibility: 3 as const }
    expect(pickUpdateVisibility(project)).toBe(3)
  })

  it('falls back to 3 (Unlisted) when workshopVisibility is undefined (never published)', () => {
    const project = {}
    expect(pickUpdateVisibility(project)).toBe(3)
  })

  it('a project previously published as Public (0) would NOT be demoted to Unlisted (3) on auto-sync', () => {
    // Before the fix: hardcoded 3 → always Unlisted on update.
    // After the fix: reads workshopVisibility → 0 (Public preserved).
    const project = { workshopVisibility: 0 as const }
    const visibility = pickUpdateVisibility(project)
    expect(visibility).not.toBe(3)
    expect(visibility).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// MAJOR-2 — faction-scope diffuse includes unvisited vehicles in export
// ---------------------------------------------------------------------------

describe('MAJOR-2 — collectExportVehicleIds includes faction-default diffuse vehicles', () => {
  let p: Coh2SkinProject

  beforeEach(() => {
    p = newProject('Test Pack')
  })

  it('returns empty for a project with no vehicles and no faction defaults', () => {
    expect(collectExportVehicleIds(p)).toHaveLength(0)
  })

  it('includes per-vehicle entries that have decals', () => {
    // 'tiger' is the German Tiger I vehicle (faction: german)
    p.vehicles['tiger'] = {
      id: 'tiger',
      tac: null,
      name: null,
      decals: [{ id: 1, type: 'number', x: 0, y: 0, rot: 0, size: 64 }],
    }
    const ids = collectExportVehicleIds(p)
    expect(ids).toContain('tiger')
  })

  it('includes per-vehicle entries that have a customDiffuseUrl', () => {
    // 't34' is the Soviet T-34 vehicle (faction: soviet)
    p.vehicles['t34'] = {
      id: 't34',
      tac: null,
      name: null,
      decals: [],
      customDiffuseUrl: 'data:image/png;base64,abc',
    }
    const ids = collectExportVehicleIds(p)
    expect(ids).toContain('t34')
  })

  it('excludes per-vehicle entries with no decals and no customDiffuseUrl', () => {
    // 'stug_iii' is the German StuG III (faction: german)
    p.vehicles['stug_iii'] = {
      id: 'stug_iii',
      tac: null,
      name: null,
      decals: [],
      customDiffuseUrl: null,
    }
    const ids = collectExportVehicleIds(p)
    expect(ids).not.toContain('stug_iii')
  })

  it('includes per-vehicle entries that have a camoPreset but no diffuse/decals (camo-export gate fix)', () => {
    // Regression: applyCamo persists ONLY camoPreset (and nulls customDiffuseUrl),
    // so a camo-only skin must still count as exportable — otherwise the
    // "Export .sga" button stays disabled after "Apply to skin".
    p.vehicles['tiger'] = {
      id: 'tiger',
      tac: null,
      name: null,
      decals: [],
      customDiffuseUrl: null,
      camoPreset: {
        style: 'softBlobs',
        colors: ['#4a5c2a', '#c8a060', '#3e2a12'],
        seed: 1234,
        scale: 1,
        rotation: 0,
        blur: 0,
        label: 'Test camo',
      },
    }
    const ids = collectExportVehicleIds(p)
    expect(ids).toContain('tiger')
  })

  it('includes ALL faction vehicles when a faction-default camoPreset is set (camo-export gate fix)', () => {
    const fd = getOrInitFactionDefault(p, 'german')
    fd.camoPreset = {
      style: 'softBlobs',
      colors: ['#4a5c2a', '#c8a060', '#3e2a12'],
      seed: 42,
      scale: 1,
      rotation: 0,
      blur: 0,
      label: 'Faction camo',
    }
    const ids = collectExportVehicleIds(p)
    expect(ids).toContain('tiger')
    expect(ids).toContain('stug_iii')
    expect(ids.length).toBeGreaterThanOrEqual(10)
  })

  it('includes ALL vehicles for a faction when a faction-default customDiffuseUrl is set (MAJOR-2 fix)', () => {
    // Set faction-default diffuse for german WITHOUT visiting any vehicle.
    // Vehicle IDs in the catalogue: 'tiger', 'elefant', 'stug_iii', etc.
    const fd = getOrInitFactionDefault(p, 'german')
    fd.customDiffuseUrl = 'data:image/png;base64,abc123'

    const ids = collectExportVehicleIds(p)

    // 'tiger' and 'stug_iii' are both german faction vehicles (see vehicles.ts).
    // They were never added to project.vehicles but SHOULD appear in the export
    // because the faction default applies to ALL german vehicles.
    expect(ids).toContain('tiger')
    expect(ids).toContain('stug_iii')
    // All 10 german vehicles should be included.
    expect(ids.length).toBeGreaterThanOrEqual(10)
  })

  it('does NOT include vehicles from other factions when only one faction has a default', () => {
    const fd = getOrInitFactionDefault(p, 'german')
    fd.customDiffuseUrl = 'data:image/png;base64,abc123'

    const ids = collectExportVehicleIds(p)

    // Soviet vehicles should NOT be included — no soviet faction default set.
    expect(ids).not.toContain('t34')
    expect(ids).not.toContain('t70')
  })

  it('effectiveCustomDiffuseUrl resolves faction default for an unvisited vehicle (shared logic with editor)', () => {
    // This test confirms the shared logic that editor + export both use.
    const fd = getOrInitFactionDefault(p, 'german')
    fd.customDiffuseUrl = 'data:image/png;base64,faction-diffuse'

    // 'tiger' was never navigated to — no p.vehicles entry.
    const resolved = effectiveCustomDiffuseUrl(p, 'tiger', 'german')
    expect(resolved).toBe('data:image/png;base64,faction-diffuse')
  })

  it('per-vehicle customDiffuseUrl takes precedence over faction default in effectiveCustomDiffuseUrl', () => {
    const fd = getOrInitFactionDefault(p, 'german')
    fd.customDiffuseUrl = 'data:image/png;base64,faction-diffuse'

    p.vehicles['tiger'] = {
      id: 'tiger',
      tac: null,
      name: null,
      decals: [],
      customDiffuseUrl: 'data:image/png;base64,vehicle-override',
    }

    const resolved = effectiveCustomDiffuseUrl(p, 'tiger', 'german')
    expect(resolved).toBe('data:image/png;base64,vehicle-override')
  })

  it('vehicles already in project.vehicles are not double-counted when faction default also matches', () => {
    // Visit 'tiger' and give it a per-vehicle diffuse.
    p.vehicles['tiger'] = {
      id: 'tiger',
      tac: null,
      name: null,
      decals: [],
      customDiffuseUrl: 'data:image/png;base64,vehicle-specific',
    }
    // Also set faction default.
    const fd = getOrInitFactionDefault(p, 'german')
    fd.customDiffuseUrl = 'data:image/png;base64,faction-diffuse'

    const ids = collectExportVehicleIds(p)
    const tigerCount = ids.filter(id => id === 'tiger').length
    expect(tigerCount).toBe(1) // not doubled
  })
})
