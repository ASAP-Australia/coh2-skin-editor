import { describe, it, expect } from 'vitest'

/** Mirrors the scope gate in Editor.tsx — returns true if the decal preview
 *  should be shown for this vehicle, false if it should be suppressed. */
function shouldPreview(
  project: { decalScope?: 'vehicle' | 'all'; decalScopeVehicleId?: string },
  vehicleId: string,
): boolean {
  if (
    project.decalScope === 'vehicle' &&
    project.decalScopeVehicleId &&
    project.decalScopeVehicleId !== vehicleId
  ) {
    return false
  }
  return true
}

describe('decal scope gate', () => {
  it('previews on any vehicle when decalScope is undefined (default / back-compat)', () => {
    expect(shouldPreview({}, 'vehicle_a')).toBe(true)
    expect(shouldPreview({}, 'vehicle_b')).toBe(true)
  })

  it('previews on any vehicle when decalScope is "all"', () => {
    expect(shouldPreview({ decalScope: 'all' }, 'vehicle_a')).toBe(true)
    expect(shouldPreview({ decalScope: 'all', decalScopeVehicleId: 'vehicle_a' }, 'vehicle_b')).toBe(true)
  })

  it('previews only on the matching vehicle when decalScope is "vehicle"', () => {
    const project = { decalScope: 'vehicle' as const, decalScopeVehicleId: 'vehicle_a' }
    expect(shouldPreview(project, 'vehicle_a')).toBe(true)
    expect(shouldPreview(project, 'vehicle_b')).toBe(false)
    expect(shouldPreview(project, 'vehicle_c')).toBe(false)
  })

  it('previews everywhere when decalScope is "vehicle" but decalScopeVehicleId is not set (graceful)', () => {
    const project = { decalScope: 'vehicle' as const }
    expect(shouldPreview(project, 'vehicle_a')).toBe(true)
    expect(shouldPreview(project, 'vehicle_b')).toBe(true)
  })

  it('previews on the pinned vehicle and suppresses all others', () => {
    const project = { decalScope: 'vehicle' as const, decalScopeVehicleId: 'tiger_1' }
    const vehicles = ['tiger_1', 'panzer_4', 'stug_3', 'sdkfz_251']
    const results = vehicles.map(v => shouldPreview(project, v))
    expect(results).toEqual([true, false, false, false])
  })

  it('previews on any vehicle when decalScopeVehicleId is empty string (graceful)', () => {
    const project = { decalScope: 'vehicle' as const, decalScopeVehicleId: '' }
    expect(shouldPreview(project, 'vehicle_a')).toBe(true)
  })
})
