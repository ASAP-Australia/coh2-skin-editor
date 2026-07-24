/**
 * Tests for isVehicleEdited — N2 export-gate predicate (Phase 4).
 *
 * Pins the predicate's three cases:
 *   ✓ decals-only (no paint)
 *   ✓ paint-only  (customDiffuseUrl, no decals)
 *   ✗ untouched   (no decals, no paint)
 */

import { describe, it, expect } from 'vitest'
import { isVehicleEdited } from '../project'
import type { VehicleProject, Decal } from '../project'

function makeDecal(overrides: Partial<Decal> = {}): Decal {
  return {
    id: 1,
    type: 'shield',
    x: 0,
    y: 0,
    rot: 0,
    size: 128,
    ...overrides,
  }
}

function makeVehicle(overrides: Partial<VehicleProject> = {}): VehicleProject {
  return {
    id: 'test_vehicle',
    tac: null,
    name: null,
    decals: [],
    ...overrides,
  }
}

describe('isVehicleEdited', () => {
  it('decals-only — vehicle with decals and no paint is edited', () => {
    const v = makeVehicle({ decals: [makeDecal()] })
    expect(isVehicleEdited(v)).toBe(true)
  })

  it('paint-only — vehicle with customDiffuseUrl and no decals is edited', () => {
    const v = makeVehicle({ customDiffuseUrl: 'data:image/png;base64,abc' })
    expect(isVehicleEdited(v)).toBe(true)
  })

  it('untouched — vehicle with no decals and no paint is not edited', () => {
    const v = makeVehicle()
    expect(isVehicleEdited(v)).toBe(false)
  })

  it('untouched — vehicle with null customDiffuseUrl and empty decals is not edited', () => {
    const v = makeVehicle({ customDiffuseUrl: null, decals: [] })
    expect(isVehicleEdited(v)).toBe(false)
  })

  it('untouched — vehicle with undefined customDiffuseUrl (legacy) is not edited', () => {
    // Legacy stored projects may lack customDiffuseUrl entirely
    const v: VehicleProject = { id: 'legacy', tac: null, name: null, decals: [] }
    expect(isVehicleEdited(v)).toBe(false)
  })

  it('both — vehicle with decals AND paint is edited', () => {
    const v = makeVehicle({
      decals: [makeDecal({ id: 2, type: 'number' })],
      customDiffuseUrl: 'data:image/png;base64,xyz',
    })
    expect(isVehicleEdited(v)).toBe(true)
  })
})
