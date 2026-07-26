import { describe, it, expect } from 'vitest'
import {
  effectiveTemplateFor,
  templateBakeTargets,
  type Coh2SkinProject,
} from '../project'
import { VEHICLES } from '../vehicles'

/**
 * Template scope — the skin-pack counterpart to decal-scope.test.ts.
 *
 * Unlike that suite, these tests import the REAL helpers rather than mirroring
 * their logic locally, so they fail if production code regresses.
 *
 * Two bugs are guarded here:
 *   1. Installed skin packs ignored the scope toggle entirely and always
 *      applied to the current vehicle only.
 *   2. `project.template` was written project-wide even under 'This vehicle'
 *      scope, so the pill named a pack on vehicles that never received it.
 */

const TEMPLATE = { id: 'installed:abc', kind: 'blank' as const, name: 'Winter Ambush' }

/** Minimal project stub — only the fields the helpers actually read. */
function projectWith(patch: Partial<Coh2SkinProject>): Coh2SkinProject {
  return { template: TEMPLATE, ...patch } as Coh2SkinProject
}

describe('effectiveTemplateFor — which vehicles a template claims', () => {
  it('returns null when no template is set', () => {
    expect(effectiveTemplateFor({} as Coh2SkinProject, 'tiger')).toBeNull()
  })

  it('LEGACY: a project with no templateScope behaves as "all" (back-compat)', () => {
    // Guards bug 2's fix against breaking projects saved before scope existed.
    const p = projectWith({})
    expect(effectiveTemplateFor(p, 'tiger')).toEqual(TEMPLATE)
    expect(effectiveTemplateFor(p, 'panther')).toEqual(TEMPLATE)
  })

  it('claims every vehicle under "all" scope', () => {
    const p = projectWith({ templateScope: 'all' })
    expect(effectiveTemplateFor(p, 'tiger')).toEqual(TEMPLATE)
    expect(effectiveTemplateFor(p, 'panther')).toEqual(TEMPLATE)
  })

  it('BUG 2: claims ONLY the pinned vehicle under "vehicle" scope', () => {
    const p = projectWith({ templateScope: 'vehicle', templateScopeVehicleId: 'tiger' })
    expect(effectiveTemplateFor(p, 'tiger')).toEqual(TEMPLATE)
    // Pre-fix these returned the template, so the pill named a pack the
    // vehicle had never been given.
    expect(effectiveTemplateFor(p, 'panther')).toBeNull()
    expect(effectiveTemplateFor(p, 'stug_3')).toBeNull()
  })

  it('degrades gracefully when "vehicle" scope has no pinned id', () => {
    // Matches the decal gate: hiding a template that IS applied would be worse
    // than showing it, so an unpinned 'vehicle' scope shows everywhere.
    const p = projectWith({ templateScope: 'vehicle' })
    expect(effectiveTemplateFor(p, 'tiger')).toEqual(TEMPLATE)
    expect(effectiveTemplateFor(p, 'panther')).toEqual(TEMPLATE)
  })
})

describe('templateBakeTargets — which slots an apply writes', () => {
  const faction = VEHICLES[0].faction
  const factionVehicles = VEHICLES.filter(v => v.faction === faction).map(v => v.id)

  it('the fixture faction has more than one vehicle (otherwise the next test proves nothing)', () => {
    expect(factionVehicles.length).toBeGreaterThan(1)
  })

  it('"This vehicle" bakes exactly the current slot', () => {
    expect(templateBakeTargets('vehicle', 'tiger', faction)).toEqual(['tiger'])
  })

  it('BUG 1: "All vehicles" bakes every vehicle of the faction, not just the current one', () => {
    const targets = templateBakeTargets('all', factionVehicles[0], faction)
    // Pre-fix, installed packs always baked a single slot regardless of scope.
    expect(targets.length).toBeGreaterThan(1)
    expect(targets).toEqual(factionVehicles)
  })

  it('"All vehicles" does not leak vehicles from other factions', () => {
    const targets = templateBakeTargets('all', factionVehicles[0], faction)
    const foreign = targets.filter(id => VEHICLES.find(v => v.id === id)?.faction !== faction)
    expect(foreign).toEqual([])
  })
})
