import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { computeExplodeDirection } from '../explode-direction'

const ZERO = new Vector3(0, 0, 0)
const SIZE = new Vector3(5, 3, 8) // a typical King Tiger bounding box
const RIGHT = new Vector3(1.5, 0.8, 2) // right-side part center
const LEFT = new Vector3(-1.5, 0.8, 2) // left-side part center

function dir(name: string, center = ZERO, size = SIZE) {
  return computeExplodeDirection(name, center, size)
}

describe('computeExplodeDirection – heuristic', () => {
  it('turret → up (0, 1, 0)', () => {
    const d = dir('GEO_turret_base')
    expect(d.x).toBeCloseTo(0)
    expect(d.y).toBeCloseTo(1)
    expect(d.z).toBeCloseTo(0)
  })

  it('cupola → up', () => {
    const d = dir('GEO_cupola_hatch')
    expect(d.y).toBeCloseTo(1)
  })

  it('barrel → forward + up (z > 0, y > 0)', () => {
    const d = dir('GEO_maingun_barrel')
    expect(d.z).toBeGreaterThan(0)
    expect(d.y).toBeGreaterThan(0)
  })

  it('maingun (without barrel) → up + forward', () => {
    const d = dir('GEO_maingun')
    expect(d.z).toBeGreaterThan(0)
    expect(d.y).toBeGreaterThan(0)
  })

  it('right-side wheel → positive x', () => {
    const d = dir('GEO_road_wheel_right_01', RIGHT)
    expect(d.x).toBeGreaterThan(0)
    expect(d.y).toBeCloseTo(0)
  })

  it('left-side wheel → negative x', () => {
    const d = dir('GEO_road_wheel_left_01', LEFT)
    expect(d.x).toBeLessThan(0)
  })

  it('sprocket uses sideways rule', () => {
    const d = dir('GEO_sprocket_right_front', RIGHT)
    expect(d.x).toBeGreaterThan(0)
  })

  it('track → sideways + slightly down (y < 0)', () => {
    const d = dir('GEO_track_left', LEFT)
    expect(d.x).toBeLessThan(0)
    expect(d.y).toBeLessThan(0)
  })

  it('hatch → up', () => {
    const d = dir('GEO_commander_hatch')
    expect(d.y).toBeCloseTo(1)
  })

  it('chassis → zero vector (anchor)', () => {
    const d = dir('GEO_chassis_shaker')
    expect(d.lengthSq()).toBeCloseTo(0)
  })

  it('hull → zero vector (anchor)', () => {
    const d = dir('GEO_hull_mesh')
    expect(d.lengthSq()).toBeCloseTo(0)
  })

  it('exhaust → rearward (z < 0) + slightly up (y > 0)', () => {
    const d = dir('GEO_exhaust_pipe')
    expect(d.z).toBeLessThan(0)
    expect(d.y).toBeGreaterThan(0)
  })

  it('antenna → up dominant (y largest component)', () => {
    const d = dir('GEO_antenna_base', new Vector3(1, 0.5, 0.5))
    expect(d.y).toBeGreaterThan(Math.abs(d.x))
    expect(d.y).toBeGreaterThan(Math.abs(d.z))
  })

  it('mg → up + forward', () => {
    const d = dir('GEO_mg_mount')
    expect(d.y).toBeGreaterThan(0)
    expect(d.z).toBeGreaterThan(0)
  })

  it('fallback: normalises bboxCenter', () => {
    const center = new Vector3(2, 0, 0)
    const d = computeExplodeDirection('GEO_unknown_thing', center, SIZE)
    expect(d.length()).toBeCloseTo(1, 3)
    expect(d.x).toBeCloseTo(1)
  })

  it('fallback: zero bboxCenter defaults to +Y', () => {
    const d = computeExplodeDirection('GEO_unknown_thing', ZERO, SIZE)
    expect(d.y).toBeCloseTo(1)
  })

  it('returned vector is always unit-length (except chassis anchor)', () => {
    const names = [
      'GEO_turret',
      'GEO_barrel',
      'GEO_wheel_left',
      'GEO_track_right',
      'GEO_hatch',
      'GEO_exhaust',
      'GEO_antenna',
      'GEO_mg_coaxial',
    ]
    for (const n of names) {
      const d = computeExplodeDirection(n, RIGHT, SIZE)
      if (d.lengthSq() > 0.0001) {
        expect(d.length()).toBeCloseTo(1, 3)
      }
    }
  })
})

describe('computeExplodeDirection – UV-region centroid3d override', () => {
  it('king tiger sprocket uses centroid3d (x > 0 for right side)', () => {
    const d = computeExplodeDirection(
      'GEO_sprocket_right_rear',
      new Vector3(1.658, 0.838, -3.937),
      SIZE,
      'king_tiger_sdkfz_182',
      ZERO,
    )
    // centroid3d = (1.658, 0.838, -3.937), direction away from origin
    expect(d.lengthSq()).toBeGreaterThan(0.99)
    expect(d.x).toBeGreaterThan(0) // rightward
  })

  it('unknown vehicle id falls back to heuristic', () => {
    const d = computeExplodeDirection('GEO_turret_base', ZERO, SIZE, 'non_existent_vehicle', ZERO)
    expect(d.y).toBeCloseTo(1) // heuristic: turret → up
  })

  it('missing centroid3d entry falls back to heuristic', () => {
    // 'GEO_chassis_shaker' is in the JSON but we test that the chassis
    // heuristic wins when centroid3d is absent (use a made-up name that
    // won't be in namedObjects but matches chassis heuristic)
    const d = computeExplodeDirection('GEO_chassis_extra', ZERO, SIZE, 'king_tiger_sdkfz_182', ZERO)
    // Falls through to heuristic: chassis → anchor
    expect(d.lengthSq()).toBeCloseTo(0)
  })
})
