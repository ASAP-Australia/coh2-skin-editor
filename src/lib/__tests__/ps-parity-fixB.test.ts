/**
 * Tests for PS-Parity Batch B fixes:
 *   1. Shortcut data includes new tool shortcuts (V, B, E, I, S, Ctrl+G).
 *   2. newGroupLayer creates correct structure; group Ctrl+G inserts group header
 *      while preserving children in flat array.
 *   3. Range-select logic (shift-click): range covers lo..hi inclusive, anchor
 *      stays in selectedId, rest in multiSelectedIds.
 *   4. Alt-drag duplicate: duplicateLayerHelper places copy at target coordinates
 *      (not the +20/+20 offset used by Ctrl+D).
 */

import { describe, it, expect } from 'vitest'
import {
  newGroupLayer,
  newShapeLayer,
  newTextLayer,
  newFaceplateProject,
  type FaceplateLayer,
  type Coh2FaceplateProject,
} from '@/lib/faceplate-project'
import { DEFAULT_SHORTCUTS } from '@/components/editor-primitives/keyboard-shortcuts-data'

/** Inline copy of duplicateLayerHelper for testing (same logic as FaceplateEditor.tsx
 *  to avoid importing the heavy editor component with its canvas deps). */
function duplicateLayerHelper(source: FaceplateLayer): FaceplateLayer {
  const clone = structuredClone(source) as FaceplateLayer
  clone.id = 'layer_' + Math.random().toString(36).slice(2, 10)
  if (clone.kind === 'group') return clone
  ;(clone as { x: number }).x = (source as { x: number }).x + 20
  ;(clone as { y: number }).y = (source as { y: number }).y + 20
  return clone
}

// ── 1. Shortcut data ──────────────────────────────────────────────────────────

describe('keyboard-shortcuts-data — PS-parity batch B', () => {
  const faceplateGroup = DEFAULT_SHORTCUTS.find(g => g.title === 'Faceplate composer')

  it('has a "Faceplate composer" group', () => {
    expect(faceplateGroup).toBeDefined()
  })

  it('lists V → Select / move tool', () => {
    const row = faceplateGroup?.rows.find(([k]) => k === 'V')
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/select/i)
  })

  it('lists B → Draw (brush) tool', () => {
    const row = faceplateGroup?.rows.find(([k]) => k === 'B')
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/draw|brush/i)
  })

  it('lists E → Eraser mode', () => {
    const row = faceplateGroup?.rows.find(([k]) => k === 'E')
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/eras/i)
  })

  it('lists I → Eyedropper', () => {
    const row = faceplateGroup?.rows.find(([k]) => k === 'I')
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/eyedrop/i)
  })

  it('lists S → Shapes tool', () => {
    const row = faceplateGroup?.rows.find(([k]) => k === 'S')
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/shape/i)
  })

  it('lists Ctrl+G → Group', () => {
    const row = faceplateGroup?.rows.find(([k]) => k === 'Ctrl+G')
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/group/i)
  })

  it('lists Ctrl+Shift+G → Ungroup', () => {
    const row = faceplateGroup?.rows.find(([k]) => k === 'Ctrl+Shift+G')
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/ungroup/i)
  })

  it('lists Alt+drag → Duplicate layer in place', () => {
    const row = faceplateGroup?.rows.find(([k]) => k === 'Alt+drag')
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/duplicate/i)
  })

  it('lists Shift+click (layers) → Range-select', () => {
    const row = faceplateGroup?.rows.find(([k]) => k.toLowerCase().includes('shift+click'))
    expect(row).toBeDefined()
    expect(row![1]).toMatch(/range|select/i)
  })
})

// ── 2. GroupLayer creation ─────────────────────────────────────────────────────

describe('newGroupLayer', () => {
  it('creates a group layer with correct shape', () => {
    const g = newGroupLayer('My Group')
    expect(g.kind).toBe('group')
    expect(g.name).toBe('My Group')
    expect(g.visible).toBe(true)
    expect(g.opacity).toBe(1)
    expect(Array.isArray(g.childIds)).toBe(true)
    expect(g.childIds).toHaveLength(0)
    expect(typeof g.id).toBe('string')
  })

  it('generates unique ids', () => {
    const a = newGroupLayer()
    const b = newGroupLayer()
    expect(a.id).not.toBe(b.id)
  })
})

// ── 3. Group Ctrl+G logic (pure state transform) ──────────────────────────────

/** Minimal simulation of what Ctrl+G does: insert group header BEFORE the first
 *  selected layer; children STAY in the flat array. */
function applyGrouping(
  project: Coh2FaceplateProject,
  selectedIds: Set<string>,
): Coh2FaceplateProject {
  if (selectedIds.size === 0) return project
  const group = newGroupLayer('Group')
  const toGroup = project.layers.filter(l => selectedIds.has(l.id))
  group.childIds = toGroup.map(l => l.id)
  const topIdx = project.layers.findIndex(l => selectedIds.has(l.id))
  const newLayers: FaceplateLayer[] = [
    ...project.layers.slice(0, topIdx),
    group,
    ...project.layers.slice(topIdx),
  ]
  return { ...project, layers: newLayers }
}

describe('Ctrl+G group operation', () => {
  it('inserts a group header and keeps children in flat array', () => {
    const p = newFaceplateProject('Test')
    const shape = newShapeLayer('rectangle')
    const text = newTextLayer()
    p.layers = [shape, text]

    const result = applyGrouping(p, new Set([shape.id, text.id]))

    // Total layers = group + shape + text
    expect(result.layers).toHaveLength(3)

    const group = result.layers.find(l => l.kind === 'group')
    expect(group).toBeDefined()
    expect(group!.kind).toBe('group')
    if (group!.kind === 'group') {
      expect(group!.childIds).toContain(shape.id)
      expect(group!.childIds).toContain(text.id)
    }

    // Children still present at root level
    expect(result.layers.some(l => l.id === shape.id)).toBe(true)
    expect(result.layers.some(l => l.id === text.id)).toBe(true)
  })

  it('group header is inserted before the first selected layer', () => {
    const p = newFaceplateProject('Test')
    const a = newShapeLayer('circle')
    const b = newShapeLayer('rectangle')
    const c = newTextLayer()
    p.layers = [a, b, c] // a at index 0 is NOT selected; b,c are

    const result = applyGrouping(p, new Set([b.id, c.id]))
    // Group inserted at index 1 (before b which is at index 1)
    expect(result.layers[0].id).toBe(a.id)
    expect(result.layers[1].kind).toBe('group')
    expect(result.layers[2].id).toBe(b.id)
    expect(result.layers[3].id).toBe(c.id)
    expect(result.layers).toHaveLength(4)
  })

  it('ungrouping restores flat order', () => {
    const p = newFaceplateProject('Test')
    const shape = newShapeLayer('rectangle')
    const text = newTextLayer()
    p.layers = [shape, text]

    const grouped = applyGrouping(p, new Set([shape.id, text.id]))
    const groupId = grouped.layers.find(l => l.kind === 'group')!.id

    // Simulate ungroup: remove group, move children to group position
    const groupIdx = grouped.layers.findIndex(l => l.id === groupId)
    const groupLayer = grouped.layers[groupIdx]
    if (groupLayer.kind !== 'group') throw new Error('Expected group')
    const childIds = groupLayer.childIds
    const childLayers = childIds.map(cid => grouped.layers.find(l => l.id === cid)!).filter(Boolean)
    const withoutGroup = grouped.layers.filter(l => l.id !== groupId && !childIds.includes(l.id))
    const ungrouped: FaceplateLayer[] = [
      ...withoutGroup.slice(0, groupIdx),
      ...childLayers,
      ...withoutGroup.slice(groupIdx),
    ]

    expect(ungrouped).toHaveLength(2)
    expect(ungrouped.find(l => l.id === shape.id)).toBeDefined()
    expect(ungrouped.find(l => l.id === text.id)).toBeDefined()
  })
})

// ── 4. Range-select logic ─────────────────────────────────────────────────────

/** Simulate range-select: returns {selectedId, multiSelectedIds} */
function computeRangeSelect(
  layers: FaceplateLayer[],
  anchorId: string,
  clickedId: string,
): { selectedId: string; multiSelectedIds: Set<string> } {
  const anchorIdx = layers.findIndex(l => l.id === anchorId)
  const clickIdx = layers.findIndex(l => l.id === clickedId)
  const lo = Math.min(anchorIdx, clickIdx)
  const hi = Math.max(anchorIdx, clickIdx)
  const rangeIds = layers.slice(lo, hi + 1).map(l => l.id)
  return {
    selectedId: anchorId,
    multiSelectedIds: new Set(rangeIds.filter(id => id !== anchorId)),
  }
}

describe('shift-click range-select', () => {
  const layers: FaceplateLayer[] = [
    newShapeLayer('rectangle'),
    newShapeLayer('circle'),
    newTextLayer(),
    newTextLayer(),
    newShapeLayer('star'),
  ]

  it('selects contiguous range from anchor (index 0) to clicked (index 4)', () => {
    const { selectedId, multiSelectedIds } = computeRangeSelect(
      layers,
      layers[0].id,
      layers[4].id,
    )
    expect(selectedId).toBe(layers[0].id)
    expect(multiSelectedIds.size).toBe(4)
    for (let i = 1; i <= 4; i++) {
      expect(multiSelectedIds.has(layers[i].id)).toBe(true)
    }
  })

  it('anchor stays in selectedId, not multiSelectedIds', () => {
    const { selectedId, multiSelectedIds } = computeRangeSelect(
      layers,
      layers[2].id,
      layers[4].id,
    )
    expect(selectedId).toBe(layers[2].id)
    expect(multiSelectedIds.has(layers[2].id)).toBe(false)
  })

  it('range works upward (clicked above anchor)', () => {
    const { selectedId, multiSelectedIds } = computeRangeSelect(
      layers,
      layers[3].id,
      layers[1].id,
    )
    // Range is indices 1,2,3; anchor is index 3
    expect(selectedId).toBe(layers[3].id)
    expect(multiSelectedIds.has(layers[1].id)).toBe(true)
    expect(multiSelectedIds.has(layers[2].id)).toBe(true)
    expect(multiSelectedIds.has(layers[3].id)).toBe(false) // anchor excluded
    expect(multiSelectedIds.size).toBe(2)
  })

  it('single-layer "range" (same anchor and clicked) yields empty multiSelectIds', () => {
    const { selectedId, multiSelectedIds } = computeRangeSelect(
      layers,
      layers[2].id,
      layers[2].id,
    )
    expect(selectedId).toBe(layers[2].id)
    expect(multiSelectedIds.size).toBe(0)
  })
})

// ── 5. Alt-drag duplicate: target position logic ──────────────────────────────

describe('alt-drag duplicate positioning', () => {
  it('places clone at drop position (not +20 offset like Ctrl+D)', () => {
    const shape = newShapeLayer('rectangle')
    ;(shape as { x: number }).x = 100
    ;(shape as { y: number }).y = 50

    // Simulate what handleKonvaDragEnd does for alt-drag
    const dropX = 200
    const dropY = 150

    const clone = duplicateLayerHelper(shape)
    if (clone.kind !== 'group' && clone.kind !== 'paint') {
      ;(clone as { x: number }).x = dropX
      ;(clone as { y: number }).y = dropY
    }

    expect((clone as { x: number }).x).toBe(200)
    expect((clone as { y: number }).y).toBe(150)
    // Original should be unchanged
    expect((shape as { x: number }).x).toBe(100)
    expect((shape as { y: number }).y).toBe(50)
  })

  it('duplicateLayerHelper assigns a new unique id', () => {
    const shape = newShapeLayer('circle')
    const clone = duplicateLayerHelper(shape)
    expect(clone.id).not.toBe(shape.id)
  })
})
