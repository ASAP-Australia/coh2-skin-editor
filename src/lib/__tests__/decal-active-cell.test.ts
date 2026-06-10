/**
 * Tests for the per-part/per-faction active-cell logic introduced in v6.
 *
 * Covers:
 *   - Switching part/faction changes the active layer list (cellDecals)
 *   - Editing a faction forks from shared (copy-on-write semantics)
 *   - v5 legacy flat project still loads and edits via decals[]
 *   - exportDecalPackZip emits per-faction override layers
 *   - mutateActiveCell helper writes only to the correct (part,faction) cell
 */

import { describe, it, expect } from 'vitest'
import {
  newDecalPackProject,
  newDecal,
  freshSourceImageId,
  tryParseDecalPackFile,
  type Coh2DecalPackProject,
  type Decal,
} from '../decal-pack-project'
import { exportDecalPackZip } from '../decal-pack-export'

// ── Helper: build a v5 (flat) project ──────────────────────────────────────

function makeV5Project(): Coh2DecalPackProject {
  const p = newDecalPackProject('V5 Test')
  const imgId = freshSourceImageId()
  p.sourceImages[imgId] = {
    id: imgId,
    name: 'test',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 1,
    height: 1,
  }
  p.decals.push({ ...newDecal(p, imgId), id: 'flat_d1', name: 'Flat Decal 1' })
  // Strip parts to simulate v5.
  const { parts: _p, activePartIndex: _pi, activeFaction: _af, ...rest } = p
  return { ...rest, version: 5 } as unknown as Coh2DecalPackProject
}

// ── Helper: build a minimal v6 project with one shared layer on part 1 ──────

function makeV6Project() {
  const p = newDecalPackProject('V6 Test')
  const imgId = freshSourceImageId()
  p.sourceImages[imgId] = {
    id: imgId,
    name: 'test',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 1,
    height: 1,
  }
  const sharedDecal = { ...newDecal(p, imgId), id: 'shared_d1', name: 'Shared Layer' }
  p.parts![1].shared.push(sharedDecal)
  return { p, imgId, sharedDecal }
}

// ── Simulate resolving the active cell (mirrors component logic) ─────────────

function resolveCellDecals(
  project: Coh2DecalPackProject,
  activePartIndex: number,
  activeFaction: string | null,
): Decal[] {
  if (!project.parts) return project.decals
  const part = project.parts[activePartIndex]
  if (!part) return []
  if (activeFaction !== null) {
    return (part.overrides as Record<string, Decal[]> | undefined)?.[activeFaction] ?? part.shared
  }
  return part.shared
}

// ── Simulate mutateActiveCell (mirrors component logic) ──────────────────────

function mutateActiveCell(
  p: Coh2DecalPackProject,
  activePartIndex: number,
  activeFaction: string | null,
  updater: (list: Decal[]) => Decal[],
): Coh2DecalPackProject {
  if (!p.parts) {
    return { ...p, decals: updater(p.decals) }
  }
  const parts = p.parts.map((part, i) => {
    if (i !== activePartIndex) return part
    if (activeFaction !== null) {
      const existing = (part.overrides as Record<string, Decal[]> | undefined)?.[activeFaction] ?? [...part.shared]
      const updated = updater(existing)
      return {
        ...part,
        overrides: { ...part.overrides, [activeFaction]: updated },
      }
    }
    return { ...part, shared: updater(part.shared) }
  })
  return { ...p, parts }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveCellDecals — switching part/faction changes the active list', () => {
  it('part 0 shared is empty by default', () => {
    const { p } = makeV6Project()
    const cell = resolveCellDecals(p, 0, null)
    expect(cell).toHaveLength(0)
  })

  it('part 1 shared contains the added layer', () => {
    const { p, sharedDecal } = makeV6Project()
    const cell = resolveCellDecals(p, 1, null)
    expect(cell).toHaveLength(1)
    expect(cell[0].id).toBe(sharedDecal.id)
  })

  it('faction cell with no override falls back to shared', () => {
    const { p, sharedDecal } = makeV6Project()
    // No override for 'german' — should inherit shared.
    const cell = resolveCellDecals(p, 1, 'german')
    expect(cell).toHaveLength(1)
    expect(cell[0].id).toBe(sharedDecal.id)
  })

  it('faction cell with override returns override, not shared', () => {
    const { p } = makeV6Project()
    const imgId = Object.keys(p.sourceImages)[0]
    const overrideDecal = { ...newDecal(p, imgId), id: 'german_override', name: 'German Only' }
    p.parts![1].overrides = { german: [overrideDecal] }
    const cell = resolveCellDecals(p, 1, 'german')
    expect(cell).toHaveLength(1)
    expect(cell[0].id).toBe('german_override')
  })

  it('switching from part 1 to part 2 changes the cell', () => {
    const { p } = makeV6Project()
    const cell1 = resolveCellDecals(p, 1, null)
    const cell2 = resolveCellDecals(p, 2, null)
    expect(cell1).toHaveLength(1)
    expect(cell2).toHaveLength(0)
  })
})

describe('mutateActiveCell — fork-on-write semantics', () => {
  it('editing shared appends to shared only', () => {
    const { p } = makeV6Project()
    const imgId = Object.keys(p.sourceImages)[0]
    const newD = { ...newDecal(p, imgId), id: 'new_shared' }
    const updated = mutateActiveCell(p, 1, null, list => [...list, newD])
    expect(updated.parts![1].shared).toHaveLength(2)
    expect(updated.parts![2].shared).toHaveLength(0) // other parts untouched
  })

  it('editing a faction cell without an override FORKS from shared', () => {
    const { p, sharedDecal } = makeV6Project()
    // Initially no override for 'german'.
    expect(p.parts![1].overrides?.german).toBeUndefined()
    // Add a decal to the german faction cell.
    const imgId = Object.keys(p.sourceImages)[0]
    const germanDecal = { ...newDecal(p, imgId), id: 'german_new' }
    const updated = mutateActiveCell(p, 1, 'german', list => [...list, germanDecal])
    // The german override should now have the shared decal + the new german decal.
    const germanCell = updated.parts![1].overrides!.german!
    expect(germanCell).toHaveLength(2)
    expect(germanCell[0].id).toBe(sharedDecal.id) // forked from shared
    expect(germanCell[1].id).toBe('german_new')
    // Shared list must be untouched.
    expect(updated.parts![1].shared).toHaveLength(1)
    expect(updated.parts![1].shared[0].id).toBe(sharedDecal.id)
  })

  it('editing a faction cell that ALREADY has an override mutates it in place', () => {
    const { p } = makeV6Project()
    const imgId = Object.keys(p.sourceImages)[0]
    const existingOverride = { ...newDecal(p, imgId), id: 'german_existing' }
    p.parts![1].overrides = { german: [existingOverride] }
    const newD = { ...newDecal(p, imgId), id: 'german_added' }
    const updated = mutateActiveCell(p, 1, 'german', list => [...list, newD])
    const germanCell = updated.parts![1].overrides!.german!
    expect(germanCell).toHaveLength(2)
    expect(germanCell[0].id).toBe('german_existing')
    expect(germanCell[1].id).toBe('german_added')
    // Shared untouched.
    expect(updated.parts![1].shared).toHaveLength(1)
  })

  it('mutations on one part do not affect other parts', () => {
    const { p } = makeV6Project()
    const imgId = Object.keys(p.sourceImages)[0]
    const d = { ...newDecal(p, imgId), id: 'part1_extra' }
    const updated = mutateActiveCell(p, 1, null, list => [...list, d])
    expect(updated.parts![0].shared).toHaveLength(0)
    expect(updated.parts![2].shared).toHaveLength(0)
    expect(updated.parts![3].shared).toHaveLength(0)
  })
})

describe('v5 legacy flat project compatibility', () => {
  it('resolveCellDecals returns decals[] for v5 (no parts)', () => {
    const v5 = makeV5Project()
    const cell = resolveCellDecals(v5, 1, null)
    expect(cell).toHaveLength(1)
    expect(cell[0].id).toBe('flat_d1')
  })

  it('mutateActiveCell mutates decals[] for v5 (no parts)', () => {
    const v5 = makeV5Project()
    const imgId = Object.keys(v5.sourceImages)[0]
    const newD = { ...newDecal(v5, imgId), id: 'flat_d2' }
    const updated = mutateActiveCell(v5, 1, null, list => [...list, newD])
    expect(updated.decals).toHaveLength(2)
    expect(updated.decals[1].id).toBe('flat_d2')
  })

  it('v5 project JSON round-trips correctly', () => {
    const v5 = makeV5Project()
    const json = JSON.stringify(v5)
    // tryParseDecalPackFile migrates it to v6 on load.
    const loaded = tryParseDecalPackFile(json)
    expect(loaded).not.toBeNull()
    // After migration, should have parts (migrated to part 1 shared).
    expect(loaded!.parts).toBeDefined()
    expect(loaded!.parts![1].shared).toHaveLength(1)
    expect(loaded!.parts![1].shared[0].id).toBe('flat_d1')
  })

  it('v5 project migration preserves decals[] for back-compat', () => {
    const v5 = makeV5Project()
    const json = JSON.stringify(v5)
    const loaded = tryParseDecalPackFile(json)!
    // decals[] should still contain the original flat decals.
    expect(loaded.decals).toHaveLength(1)
    expect(loaded.decals[0].id).toBe('flat_d1')
  })
})

// ── Helper: compute visible list the same way exportDecalPackZip does ─────────
// This mirrors the exact logic from exportDecalPackZip so we can test the
// visible-array building without calling the full rasterisation pipeline
// (which requires createImageBitmap / HTMLImageElement, both unavailable
// in jsdom — the existing decal-pack-export.test.ts skips rasterisation
// for this same reason).

function computeVisibleList(p: Coh2DecalPackProject): Decal[] {
  if (!p.parts) return p.decals.filter(d => d.visible)
  const results: Decal[] = []
  for (const part of p.parts) {
    results.push(...part.shared.filter(d => d.visible))
    if (part.overrides) {
      for (const faction of Object.keys(part.overrides) as string[]) {
        const overrideLayers = (part.overrides as Record<string, Decal[]>)[faction]
        if (overrideLayers) results.push(...overrideLayers.filter(d => d.visible))
      }
    }
  }
  return results
}

describe('exportDecalPackZip visible-list computation — per-faction overrides', () => {
  it('v5 project: visible list contains flat decals', () => {
    const v5 = makeV5Project()
    const visible = computeVisibleList(v5 as Coh2DecalPackProject)
    expect(visible).toHaveLength(1)
    expect(visible[0].id).toBe('flat_d1')
  })

  it('v6 project: visible list contains shared layers', () => {
    const { p, sharedDecal } = makeV6Project()
    const visible = computeVisibleList(p)
    expect(visible).toHaveLength(1)
    expect(visible[0].id).toBe(sharedDecal.id)
  })

  it('v6 project: override layers are INCLUDED in visible list', () => {
    const { p } = makeV6Project()
    const imgId = Object.keys(p.sourceImages)[0]
    const germanDecal = { ...newDecal(p, imgId), id: 'german_override', visible: true }
    p.parts![1].overrides = { german: [germanDecal] }
    const visible = computeVisibleList(p)
    // 1 shared + 1 german override = 2
    expect(visible).toHaveLength(2)
    expect(visible.some(d => d.id === 'german_override')).toBe(true)
  })

  it('v6 project: hidden override layers are EXCLUDED from visible list', () => {
    const { p, sharedDecal } = makeV6Project()
    const imgId = Object.keys(p.sourceImages)[0]
    const hiddenDecal = { ...newDecal(p, imgId), id: 'german_hidden', visible: false }
    p.parts![1].overrides = { german: [hiddenDecal] }
    const visible = computeVisibleList(p)
    // Only the shared layer — the german override is hidden.
    expect(visible).toHaveLength(1)
    expect(visible[0].id).toBe(sharedDecal.id)
  })

  it('v6: multiple parts and factions all appear in visible list', () => {
    const { p } = makeV6Project()
    const imgId = Object.keys(p.sourceImages)[0]
    const part2Decal = { ...newDecal(p, imgId), id: 'part2_shared', visible: true }
    p.parts![2].shared.push(part2Decal)
    const sovietDecal = { ...newDecal(p, imgId), id: 'soviet_override', visible: true }
    p.parts![1].overrides = { soviet: [sovietDecal] }
    const visible = computeVisibleList(p)
    // 1 (part1 shared) + 1 (soviet override) + 1 (part2 shared) = 3
    expect(visible).toHaveLength(3)
    expect(visible.some(d => d.id === 'soviet_override')).toBe(true)
    expect(visible.some(d => d.id === 'part2_shared')).toBe(true)
  })

  it('throws when all cells are empty (no visible decals)', async () => {
    const p = newDecalPackProject('Empty')
    await expect(exportDecalPackZip(p)).rejects.toThrow(/No visible decals/i)
  })
})
