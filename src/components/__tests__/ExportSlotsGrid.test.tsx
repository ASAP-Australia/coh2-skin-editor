/**
 * Tests for ExportSlotsGrid — the 6-tile shop-style grid for the Export
 * panel (3 summer slots over 3 winter slots).
 *
 * Contract pinned here:
 *
 *  Structure
 *  - Two row labels: "Summer" then "Winter" in that order.
 *  - 6 tile buttons total, 3 per row, in `grid grid-cols-3`.
 *  - Tiles are sorted by `slot.slotIdx` ascending within each season,
 *    NOT by the project's exportSlots[] array order. (This decouples
 *    storage order from display order.)
 *  - The click handler dispatches the SOURCE index in
 *    `project.exportSlots`, not the slotIdx, so swapping the project's
 *    storage order would not break the handler dispatch.
 *
 *  Tile content
 *  - When the compositor hasn't produced a thumb yet:
 *      - Slots with no vehicles render "empty" placeholder text.
 *      - Slots with vehicles render the "…" pending placeholder.
 *  - When a thumb URL is set: an `<img>` mounts with that URL.
 *  - Caption strip on the tile shows `slot.label` if present, else
 *    `${Capitalised season} ${slotIdx + 1}` (e.g. "Summer 1", "Winter 3").
 *  - The `title` attribute combines `slot.label || "(no label)"`
 *    + " — <season> slot <slotIdx + 1>".
 *
 *  Active state
 *  - The tile whose source index in `exportSlots` matches
 *    `activeSlotIdx` gets the accent border + accent ring; others get
 *    a translucent border.
 *
 *  Hover wiring (drives ExportTilePreview)
 *  - `onMouseEnter` fires `onHoverSlot(slot, anchorRect)` where
 *    `anchorRect` is `getBoundingClientRect()` of the tile button.
 *  - `onMouseLeave` fires `onHoverSlot(null, null)`.
 *
 *  Heavy modules mocked: `@/lib/tile-icon-compositor` returns a
 *  promise that never resolves, so tiles stay in the placeholder
 *  state — keeps the structural contract test isolated from the
 *  async compositor pipeline (jsdom has no working canvas / Image
 *  decode chain).
 *
 *  Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import type { Coh2SkinProject, ExportSlot } from '@/lib/project'

// ── Module mocks ─────────────────────────────────────────────────────────────
// composeTileIcon → never resolves. lastHashRef + thumbs cache stays
// empty for the lifetime of the test → tiles render placeholders.
vi.mock('@/lib/tile-icon-compositor', () => ({
  composeTileIcon: () => new Promise(() => {}),
}))
// resolveVehicleIcon → null. The component awaits this inside the
// effect chain, but since composeTileIcon never resolves it never
// matters; still, mock it to keep us out of the canvas / Image path.
vi.mock('@/lib/vehicle-icons', () => ({
  resolveVehicleIcon: vi.fn(async () => null),
}))
// generateCamo → no-op. Same reasoning.
vi.mock('@/lib/camo-generator', () => ({
  generateCamo: vi.fn(),
}))

const { default: ExportSlotsGrid } = await import('../ExportSlotsGrid')

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderOpts {
  project: Coh2SkinProject
  activeSlotIdx?: number
  onSelectSlot?: (idx: number) => void
  onHoverSlot?: (slot: ExportSlot | null, anchorRect: DOMRect | null) => void
}

function render(opts: RenderOpts) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(ExportSlotsGrid, {
        project: opts.project,
        activeSlotIdx: opts.activeSlotIdx ?? 0,
        onSelectSlot: opts.onSelectSlot ?? (() => {}),
        installRoot: null,
        onHoverSlot: opts.onHoverSlot,
      }),
    )
  })
  return container!
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
  vi.restoreAllMocks()
})

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSlot(
  over: Partial<ExportSlot> & Pick<ExportSlot, 'id' | 'slotIdx' | 'season'>,
): ExportSlot {
  return {
    label: '',
    description: '',
    factions: ['german'],
    authorCredit: '',
    mainDecalId: null,
    state: { vehicles: {}, factionDefaults: {} },
    ...over,
  }
}

/** Six slots in canonical (storage) order: three summer 0..2 then three
 *  winter 0..2. Index into exportSlots[] === srcIdx. */
function defaultSlots(): ExportSlot[] {
  return [
    makeSlot({ id: 's0', slotIdx: 0, season: 'summer', label: 'Tiger Pack' }),
    makeSlot({ id: 's1', slotIdx: 1, season: 'summer' }),
    makeSlot({ id: 's2', slotIdx: 2, season: 'summer' }),
    makeSlot({ id: 's3', slotIdx: 0, season: 'winter' }),
    makeSlot({ id: 's4', slotIdx: 1, season: 'winter' }),
    makeSlot({ id: 's5', slotIdx: 2, season: 'winter' }),
  ]
}

function projectWithSlots(slots: ExportSlot[]): Coh2SkinProject {
  return {
    images: {},
    exportSlots: slots,
  } as unknown as Coh2SkinProject
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ExportSlotsGrid — structure', () => {
  it('renders both season row labels in canonical Summer-then-Winter order', () => {
    render({ project: projectWithSlots(defaultSlots()) })
    const text = container!.textContent ?? ''
    const i1 = text.indexOf('Summer')
    const i2 = text.indexOf('Winter')
    expect(i1).toBeGreaterThan(-1)
    expect(i2).toBeGreaterThan(i1)
  })

  it('renders exactly 6 tile buttons', () => {
    render({ project: projectWithSlots(defaultSlots()) })
    const buttons = container!.querySelectorAll('button')
    expect(buttons).toHaveLength(6)
  })

  it('uses grid grid-cols-3 within each row', () => {
    render({ project: projectWithSlots(defaultSlots()) })
    const grids = Array.from(container!.querySelectorAll('div')).filter(
      d => d.className.includes('grid-cols-3') && d.className.includes('grid'),
    )
    // Two rows × grid-cols-3 → two such grid containers.
    expect(grids).toHaveLength(2)
  })
})

describe('ExportSlotsGrid — display ordering', () => {
  it('sorts each season by slotIdx ascending regardless of storage order', () => {
    // Reverse summer order in storage: slotIdx [2, 1, 0]. The grid must
    // still display Summer 1, Summer 2, Summer 3 left-to-right.
    const slots: ExportSlot[] = [
      makeSlot({ id: 'sB', slotIdx: 2, season: 'summer', label: 'Three' }),
      makeSlot({ id: 'sA', slotIdx: 0, season: 'summer', label: 'One' }),
      makeSlot({ id: 'sC', slotIdx: 1, season: 'summer', label: 'Two' }),
      makeSlot({ id: 'wA', slotIdx: 0, season: 'winter' }),
      makeSlot({ id: 'wB', slotIdx: 1, season: 'winter' }),
      makeSlot({ id: 'wC', slotIdx: 2, season: 'winter' }),
    ]
    render({ project: projectWithSlots(slots) })
    const buttons = Array.from(container!.querySelectorAll('button'))
    // First three buttons are the summer row — they should be One, Two, Three.
    expect(buttons[0].textContent).toContain('One')
    expect(buttons[1].textContent).toContain('Two')
    expect(buttons[2].textContent).toContain('Three')
  })
})

describe('ExportSlotsGrid — placeholder content', () => {
  it('shows "empty" placeholder for slots with no vehicles', () => {
    render({ project: projectWithSlots(defaultSlots()) })
    // All 6 default slots have no vehicles → all 6 should show "empty".
    const emptyCells = Array.from(container!.querySelectorAll('div')).filter(
      d => d.textContent === 'empty',
    )
    expect(emptyCells.length).toBe(6)
  })

  it('shows "…" pending placeholder for slots that DO have vehicles', () => {
    const slots = defaultSlots()
    slots[0] = makeSlot({
      id: 's0',
      slotIdx: 0,
      season: 'summer',
      state: {
        vehicles: { tiger: { id: 'tiger', tac: null, name: null, decals: [] } },
        factionDefaults: {},
      },
    })
    render({ project: projectWithSlots(slots) })
    const pendingCells = Array.from(container!.querySelectorAll('div')).filter(
      d => d.textContent === '…',
    )
    expect(pendingCells.length).toBe(1)
    const emptyCells = Array.from(container!.querySelectorAll('div')).filter(
      d => d.textContent === 'empty',
    )
    expect(emptyCells.length).toBe(5)
  })

  it('does NOT mount any <img> tiles until composeTileIcon resolves', () => {
    render({ project: projectWithSlots(defaultSlots()) })
    expect(container!.querySelectorAll('img')).toHaveLength(0)
  })
})

describe('ExportSlotsGrid — caption fallback', () => {
  it('uses slot.label when present', () => {
    render({ project: projectWithSlots(defaultSlots()) })
    // s0 has label "Tiger Pack".
    expect(container!.textContent).toContain('Tiger Pack')
  })

  it('falls back to "<Season> <slotIdx + 1>" when label is empty', () => {
    render({ project: projectWithSlots(defaultSlots()) })
    // s1 (summer, slotIdx 1) → "Summer 2"
    expect(container!.textContent).toContain('Summer 2')
    // s5 (winter, slotIdx 2) → "Winter 3"
    expect(container!.textContent).toContain('Winter 3')
  })

  it('button title combines slot.label and season + slotIdx', () => {
    render({ project: projectWithSlots(defaultSlots()) })
    const tiger = Array.from(container!.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Tiger Pack'),
    )
    expect(tiger?.getAttribute('title')).toBe('Tiger Pack — summer slot 1')
    // Unlabeled slot uses "(no label)".
    const summer2 = Array.from(container!.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Summer 2'),
    )
    expect(summer2?.getAttribute('title')).toBe('(no label) — summer slot 2')
  })
})

describe('ExportSlotsGrid — active state', () => {
  it('the tile whose srcIdx === activeSlotIdx gets the accent border + ring', () => {
    render({ project: projectWithSlots(defaultSlots()), activeSlotIdx: 3 })
    // s3 is index 3 in exportSlots[]. Find the tile whose caption says
    // "Winter 1" (s3 is winter slotIdx 0 → "Winter 1") and verify it
    // carries the accent classes.
    const tile = Array.from(container!.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Winter 1'),
    )
    expect(tile?.className).toContain('border-[var(--color-accent)]')
    expect(tile?.className).toContain('ring-[var(--color-accent)]')
  })

  it('non-active tiles get the inactive border classes', () => {
    render({ project: projectWithSlots(defaultSlots()), activeSlotIdx: 0 })
    const summer2 = Array.from(container!.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Summer 2'),
    )
    expect(summer2?.className).toContain('border-white/10')
    expect(summer2?.className).not.toContain('border-[var(--color-accent)]')
  })
})

describe('ExportSlotsGrid — click dispatch', () => {
  it('clicking a tile dispatches its SOURCE index in exportSlots, not the slotIdx', () => {
    // Storage order is reversed: the visually-first summer tile is
    // actually exportSlots[1] (slotIdx 0 lives at storage index 1).
    const slots: ExportSlot[] = [
      makeSlot({ id: 'sB', slotIdx: 1, season: 'summer', label: 'Two' }), // srcIdx 0
      makeSlot({ id: 'sA', slotIdx: 0, season: 'summer', label: 'One' }), // srcIdx 1
      makeSlot({ id: 'sC', slotIdx: 2, season: 'summer', label: 'Three' }), // srcIdx 2
      makeSlot({ id: 'wA', slotIdx: 0, season: 'winter' }), // srcIdx 3
      makeSlot({ id: 'wB', slotIdx: 1, season: 'winter' }), // srcIdx 4
      makeSlot({ id: 'wC', slotIdx: 2, season: 'winter' }), // srcIdx 5
    ]
    const onSelectSlot = vi.fn()
    render({ project: projectWithSlots(slots), onSelectSlot })

    const one = Array.from(container!.querySelectorAll('button')).find(b =>
      b.textContent?.includes('One'),
    ) as HTMLButtonElement
    act(() => {
      one.click()
    })
    // "One" has slotIdx 0 but lives at exportSlots[1] → dispatch 1.
    expect(onSelectSlot).toHaveBeenCalledWith(1)
  })

  it('clicking different tiles fires onSelectSlot with their respective srcIdx values', () => {
    const onSelectSlot = vi.fn()
    render({ project: projectWithSlots(defaultSlots()), onSelectSlot })
    const buttons = Array.from(container!.querySelectorAll('button'))
    act(() => {
      buttons[0].click()
    })
    act(() => {
      buttons[5].click()
    })
    expect(onSelectSlot).toHaveBeenNthCalledWith(1, 0)
    expect(onSelectSlot).toHaveBeenNthCalledWith(2, 5)
  })
})

describe('ExportSlotsGrid — hover wiring', () => {
  // React maps onMouseEnter/onMouseLeave from native mouseover/mouseout
  // with a relatedTarget filter. To trigger the synthetic handler we
  // dispatch mouseover with relatedTarget pointing OUTSIDE the tile
  // (so React's "entered from outside" check passes).
  function fireMouseEnter(el: HTMLElement) {
    const outside = document.body
    el.dispatchEvent(
      new MouseEvent('mouseover', {
        bubbles: true,
        cancelable: true,
        relatedTarget: outside,
      }),
    )
  }
  function fireMouseLeave(el: HTMLElement) {
    const outside = document.body
    el.dispatchEvent(
      new MouseEvent('mouseout', {
        bubbles: true,
        cancelable: true,
        relatedTarget: outside,
      }),
    )
  }

  it('onMouseEnter fires onHoverSlot(slot, anchorRect)', () => {
    const onHoverSlot = vi.fn()
    render({ project: projectWithSlots(defaultSlots()), onHoverSlot })
    const tiger = Array.from(container!.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Tiger Pack'),
    ) as HTMLButtonElement
    act(() => {
      fireMouseEnter(tiger)
    })
    expect(onHoverSlot).toHaveBeenCalledTimes(1)
    const [slotArg, rectArg] = onHoverSlot.mock.calls[0]
    expect(slotArg).not.toBeNull()
    expect((slotArg as ExportSlot).id).toBe('s0')
    // jsdom returns a real DOMRect-shaped object (often all-zeros, but truthy).
    expect(rectArg).not.toBeNull()
  })

  it('onMouseLeave fires onHoverSlot(null, null)', () => {
    const onHoverSlot = vi.fn()
    render({ project: projectWithSlots(defaultSlots()), onHoverSlot })
    const tile = container!.querySelector('button') as HTMLButtonElement
    act(() => {
      fireMouseLeave(tile)
    })
    expect(onHoverSlot).toHaveBeenCalledTimes(1)
    expect(onHoverSlot).toHaveBeenCalledWith(null, null)
  })

  it('does NOT crash when onHoverSlot is undefined (prop is optional)', () => {
    render({ project: projectWithSlots(defaultSlots()) }) // no onHoverSlot
    const tile = container!.querySelector('button') as HTMLButtonElement
    expect(() => {
      act(() => {
        fireMouseEnter(tile)
      })
      act(() => {
        fireMouseLeave(tile)
      })
    }).not.toThrow()
  })
})
