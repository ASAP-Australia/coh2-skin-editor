import { describe, it, expect } from 'vitest'
import { applySnap, type SnapTarget } from '../snap-guides'

describe('applySnap', () => {
  describe('no targets in range', () => {
    it('returns original coords and no fired targets when no targets provided', () => {
      const result = applySnap(100, 200, [])
      expect(result.snappedX).toBe(100)
      expect(result.snappedY).toBe(200)
      expect(result.firedTargets).toHaveLength(0)
    })

    it('returns original coords when all targets are outside threshold', () => {
      const targets: SnapTarget[] = [
        { kind: 'x', value: 50 },
        { kind: 'y', value: 150 },
      ]
      // candidateX=100, target x=50 → dist=50 >> 6
      // candidateY=200, target y=150 → dist=50 >> 6
      const result = applySnap(100, 200, targets)
      expect(result.snappedX).toBe(100)
      expect(result.snappedY).toBe(200)
      expect(result.firedTargets).toHaveLength(0)
    })

    it('does not snap when dist exactly equals threshold (strict less-than)', () => {
      const targets: SnapTarget[] = [{ kind: 'x', value: 100 }]
      // dist = |106 - 100| = 6 → not < 6, no snap
      const result = applySnap(106, 0, targets, 6)
      expect(result.snappedX).toBe(106)
      expect(result.firedTargets).toHaveLength(0)
    })
  })

  describe('one target in range', () => {
    it('snaps X when one X target is within threshold', () => {
      const targets: SnapTarget[] = [{ kind: 'x', value: 312 }]
      const result = applySnap(315, 100, targets)
      // dist = |315 - 312| = 3 < 6 → snap
      expect(result.snappedX).toBe(312)
      expect(result.snappedY).toBe(100)
      expect(result.firedTargets).toHaveLength(1)
      expect(result.firedTargets[0].value).toBe(312)
    })

    it('snaps Y when one Y target is within threshold', () => {
      const targets: SnapTarget[] = [{ kind: 'y', value: 102 }]
      const result = applySnap(50, 105, targets)
      // dist = |105 - 102| = 3 < 6 → snap
      expect(result.snappedX).toBe(50)
      expect(result.snappedY).toBe(102)
      expect(result.firedTargets).toHaveLength(1)
      expect(result.firedTargets[0].value).toBe(102)
    })

    it('snaps to exact value (dist=0)', () => {
      const targets: SnapTarget[] = [{ kind: 'x', value: 200 }]
      const result = applySnap(200, 0, targets)
      expect(result.snappedX).toBe(200)
      expect(result.firedTargets).toHaveLength(1)
    })
  })

  describe('multiple X targets in range', () => {
    it('snaps to the nearest X target when multiple are in range', () => {
      const targets: SnapTarget[] = [
        { kind: 'x', value: 100, label: 'left' },
        { kind: 'x', value: 104, label: 'center' },
      ]
      // candidate=103: dist to 100=3, dist to 104=1 → snap to 104
      const result = applySnap(103, 0, targets)
      expect(result.snappedX).toBe(104)
    })

    it('fires all X targets that are within threshold even when snapping to nearest', () => {
      const targets: SnapTarget[] = [
        { kind: 'x', value: 100, label: 'a' },
        { kind: 'x', value: 104, label: 'b' },
      ]
      // candidate=103 → both within 6
      const result = applySnap(103, 0, targets)
      const firedValues = result.firedTargets.map(t => t.value)
      expect(firedValues).toContain(100)
      expect(firedValues).toContain(104)
    })
  })

  describe('one X and one Y target both in range', () => {
    it('fires both X and Y targets and snaps both axes', () => {
      const targets: SnapTarget[] = [
        { kind: 'x', value: 312, label: 'center-x' },
        { kind: 'y', value: 102, label: 'center-y' },
      ]
      const result = applySnap(314, 100, targets)
      expect(result.snappedX).toBe(312)
      expect(result.snappedY).toBe(102)
      expect(result.firedTargets).toHaveLength(2)
    })
  })

  describe('custom threshold', () => {
    it('respects a custom threshold of 1', () => {
      const targets: SnapTarget[] = [{ kind: 'x', value: 50 }]
      // dist=2, threshold=1 → no snap
      const result = applySnap(52, 0, targets, 1)
      expect(result.snappedX).toBe(52)
      expect(result.firedTargets).toHaveLength(0)
    })

    it('respects a custom threshold of 20', () => {
      const targets: SnapTarget[] = [{ kind: 'x', value: 50 }]
      // dist=10, threshold=20 → snap
      const result = applySnap(60, 0, targets, 20)
      expect(result.snappedX).toBe(50)
      expect(result.firedTargets).toHaveLength(1)
    })
  })

  describe('label passthrough', () => {
    it('preserves label on fired target', () => {
      const targets: SnapTarget[] = [{ kind: 'y', value: 64, label: 'canvas-center-y' }]
      const result = applySnap(0, 65, targets)
      expect(result.firedTargets[0].label).toBe('canvas-center-y')
    })
  })
})
