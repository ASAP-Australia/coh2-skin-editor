/**
 * Tests for VehicleMenu — the horizontally-scrollable rail of vehicle
 * pills mounted bottom-center of the viewport.
 *
 * Pinned contract:
 *   1. Empty `vehicles` → returns null (no chrome, no filter row, no
 *      LoadingBorder — the rail just disappears).
 *   2. Filter row visibility:
 *        • <5 vehicles → filter row hidden (3-pill filter row over a
 *          4-pill rail reads as noise)
 *        • ≥5 vehicles AND ≥2 distinct classes → filter row shown
 *        • All vehicles of the SAME class → filter row hidden even
 *          with 5+ vehicles (only one class chip would render)
 *   3. Class filter "All" + per-class chips. "Super" / "Heavy" /
 *      "Medium" / "Light" / "Utility" labels — only chips for classes
 *      that exist in the current faction's list.
 *   4. Pills render in CLASS_ORDER (super_heavy → heavy → medium →
 *      light → utility) regardless of input order — the rail uses
 *      class-grouped iteration. Dot separators between groups.
 *   5. Each pill carries `data-id={vehicle.id}` (scroll-into-view
 *      relies on this attribute).
 *   6. Without `iconResolver`: legacy text-only pills with
 *      `displayName` as the text. Active pill carries the
 *      `bg-white/95 text-black` highlight.
 *   7. With `iconResolver`: icon-dominant 64x64 pills with
 *      `aria-label`, `aria-pressed`, `title`, and the resolver result
 *      rendered as an `<img>`. While the resolver is pending the
 *      first letter of `displayName` shows as a placeholder
 *      (uppercase). null result → placeholder persists.
 *   8. Click any pill → `onSelect(vehicle)` exactly once with that
 *      vehicle.
 *   9. Dirty vehicles get an orange-dot indicator (`bg-orange-400`).
 *  10. `loading=true` wires the LoadingBorder active state (we pin
 *      via the data-attribute LoadingBorder adds to its outer div).
 *  11. Switching `vehicles` (faction change) resets the filter back
 *      to "all" (so an "OKW Super" filter doesn't silently hide every
 *      British pill).
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import VehicleMenu, { type VehicleIconResolver } from '../VehicleMenu'
import type { VehicleSpec, VehicleClass, Faction } from '@/lib/vehicles'

// scrollIntoView is not implemented in jsdom — stub it so the
// component's auto-scroll effect doesn't crash on assertion.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// ── Fixture helpers ──────────────────────────────────────────────────────────

function veh(
  id: string,
  cls: VehicleClass,
  displayName?: string,
  faction: Faction = 'german',
): VehicleSpec {
  return {
    id,
    faction,
    displayName: displayName ?? id,
    class: cls,
    defaultTac: '000',
  }
}

// Five vehicles spanning four classes — large enough to surface the
// filter row.
const FIVE_MIXED: VehicleSpec[] = [
  veh('tiger', 'heavy', 'Tiger I'),
  veh('elefant', 'super_heavy', 'Elefant'),
  veh('stug', 'medium', 'StuG III'),
  veh('halftrack', 'utility', 'Sd.Kfz. 251'),
  veh('sdkfz_222', 'light', 'Sd.Kfz. 222'),
]

// Four vehicles → filter row hidden.
const FOUR_MIXED: VehicleSpec[] = FIVE_MIXED.slice(0, 4)

// Five vehicles all the same class → filter row hidden.
const FIVE_SAME_CLASS: VehicleSpec[] = [
  veh('m1', 'medium', 'M1'),
  veh('m2', 'medium', 'M2'),
  veh('m3', 'medium', 'M3'),
  veh('m4', 'medium', 'M4'),
  veh('m5', 'medium', 'M5'),
]

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  vehicles?: VehicleSpec[]
  selected?: VehicleSpec | null
  onSelect?: (v: VehicleSpec) => void
  dirtyVehicles?: Set<string>
  loading?: boolean
  iconResolver?: VehicleIconResolver
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(VehicleMenu, {
        vehicles: props.vehicles ?? FIVE_MIXED,
        selected: props.selected ?? null,
        onSelect: props.onSelect ?? (() => {}),
        dirtyVehicles: props.dirtyVehicles ?? new Set(),
        loading: props.loading,
        iconResolver: props.iconResolver,
      }),
    )
  })
  return container!
}

function pillFor(id: string): HTMLButtonElement | null {
  return container!.querySelector(`button[data-id="${id}"]`)
}

function allPills(): HTMLButtonElement[] {
  return Array.from(container!.querySelectorAll('button[data-id]')) as HTMLButtonElement[]
}

function filterChip(text: string): HTMLButtonElement | null {
  // Filter chips don't carry data-id, so match by text.
  return (
    (Array.from(container!.querySelectorAll('button')).find(
      b => !b.hasAttribute('data-id') && b.textContent?.trim() === text,
    ) as HTMLButtonElement | undefined) ?? null
  )
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('VehicleMenu — empty', () => {
  it('renders null when vehicles is empty (no chrome at all)', () => {
    render({ vehicles: [] })
    expect(container!.querySelector('button')).toBeNull()
    expect(container!.textContent).toBe('')
  })
})

describe('VehicleMenu — class ordering', () => {
  it('pills render in CLASS_ORDER regardless of input ordering', () => {
    // Input scrambled, expected order: super_heavy → heavy → medium → light → utility.
    render({ vehicles: FIVE_MIXED })
    const ids = allPills().map(b => b.getAttribute('data-id'))
    expect(ids).toEqual(['elefant', 'tiger', 'stug', 'sdkfz_222', 'halftrack'])
  })

  it('renders one pill per vehicle (no dropouts)', () => {
    render({ vehicles: FIVE_MIXED })
    expect(allPills()).toHaveLength(5)
  })
})

describe('VehicleMenu — filter row removed (v1.0)', () => {
  // The All/Super/Heavy/Medium/Light/Utility filter chip row was removed
  // following user feedback ("get rid of the sub-menu that has all super,
  // heavy, medium, and light utility"). These tests now pin its absence
  // so a future re-introduction has to land with intent.
  it('never renders an "All" chip', () => {
    render({ vehicles: FIVE_MIXED })
    expect(filterChip('All')).toBeNull()
  })

  it('never renders class chips even with ≥5 vehicles and multiple classes', () => {
    render({ vehicles: FIVE_MIXED })
    expect(filterChip('Super')).toBeNull()
    expect(filterChip('Heavy')).toBeNull()
    expect(filterChip('Medium')).toBeNull()
    expect(filterChip('Light')).toBeNull()
    expect(filterChip('Utility')).toBeNull()
  })

  it('all vehicles remain visible regardless of class composition (no filter narrowing)', () => {
    render({ vehicles: FIVE_MIXED })
    expect(allPills()).toHaveLength(5)
  })

  it('FOUR_MIXED still renders all four pills (no filter row affects layout)', () => {
    render({ vehicles: FOUR_MIXED })
    expect(allPills()).toHaveLength(4)
  })

  it('FIVE_SAME_CLASS still renders all five pills', () => {
    render({ vehicles: FIVE_SAME_CLASS })
    expect(allPills()).toHaveLength(5)
  })

  it('switching `vehicles` (faction change) keeps all pills visible (no stale filter)', () => {
    render({ vehicles: FIVE_MIXED })
    expect(allPills()).toHaveLength(5)
    const britishLike: VehicleSpec[] = [
      veh('churchill', 'heavy', 'Churchill'),
      veh('cromwell', 'medium', 'Cromwell'),
      veh('comet', 'medium', 'Comet'),
      veh('bren', 'utility', 'Bren'),
      veh('uc', 'light', 'UC'),
    ]
    render({ vehicles: britishLike })
    expect(allPills()).toHaveLength(5)
  })
})

describe('VehicleMenu — click + active state (text variant)', () => {
  it('clicking a pill fires onSelect(vehicle) exactly once', () => {
    const onSelect = vi.fn()
    render({ vehicles: FIVE_MIXED, onSelect })
    act(() => {
      pillFor('stug')!.click()
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].id).toBe('stug')
  })

  it('active pill (text variant) carries the bg-white/95 highlight', () => {
    render({ vehicles: FIVE_MIXED, selected: FIVE_MIXED.find(v => v.id === 'tiger')! })
    expect(pillFor('tiger')!.className).toContain('bg-white/95')
    expect(pillFor('tiger')!.className).toContain('text-black')
    expect(pillFor('stug')!.className).not.toContain('bg-white/95')
  })

  it('text-variant pills show the vehicle displayName as the visible text', () => {
    render({ vehicles: FIVE_MIXED })
    expect(pillFor('tiger')!.textContent).toContain('Tiger I')
    expect(pillFor('stug')!.textContent).toContain('StuG III')
  })
})

describe('VehicleMenu — dirty indicator', () => {
  it('dirty vehicles get the orange-dot indicator', () => {
    render({ vehicles: FIVE_MIXED, dirtyVehicles: new Set(['stug', 'tiger']) })
    expect(pillFor('stug')!.querySelector('.bg-orange-400')).not.toBeNull()
    expect(pillFor('tiger')!.querySelector('.bg-orange-400')).not.toBeNull()
    expect(pillFor('elefant')!.querySelector('.bg-orange-400')).toBeNull()
  })
})

describe('VehicleMenu — icon resolver variant', () => {
  it('pills become icon-dominant when iconResolver is provided (aria-label + title + aria-pressed)', () => {
    const resolver: VehicleIconResolver = vi.fn(async () => null)
    const elefant = FIVE_MIXED.find(v => v.id === 'elefant')!
    render({ vehicles: FIVE_MIXED, selected: elefant, iconResolver: resolver })
    const pill = pillFor('elefant')!
    expect(pill.getAttribute('aria-label')).toBe('Elefant')
    expect(pill.getAttribute('title')).toBe('Elefant')
    expect(pill.getAttribute('aria-pressed')).toBe('true')
    // Non-selected pill flips aria-pressed.
    expect(pillFor('tiger')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('placeholder shows first-letter while iconResolver is pending', () => {
    const resolver: VehicleIconResolver = () => new Promise(() => {}) // never resolves
    render({ vehicles: FIVE_MIXED, iconResolver: resolver })
    // Placeholder span — first letter of displayName, uppercase.
    const pill = pillFor('tiger')!
    expect(pill.textContent?.trim()).toBe('T')
  })

  it('null resolver result keeps the first-letter placeholder (cascade floor)', async () => {
    const resolver: VehicleIconResolver = async () => null
    render({ vehicles: FIVE_MIXED, iconResolver: resolver })
    // Let microtasks flush so the resolved null reaches setIconUrl(null).
    await act(async () => {
      await Promise.resolve()
    })
    const pill = pillFor('stug')!
    expect(pill.textContent?.trim()).toBe('S')
    // No <img> appears.
    expect(pill.querySelector('img')).toBeNull()
  })

  it('successful resolver result renders an <img> with the resolved url', async () => {
    const resolver: VehicleIconResolver = async v => `/icons/${v.id}.png`
    render({ vehicles: FIVE_MIXED, iconResolver: resolver })
    await act(async () => {
      // Two microtask yields — once for the resolver, once for setState.
      await Promise.resolve()
      await Promise.resolve()
    })
    const img = pillFor('tiger')!.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('/icons/tiger.png')
  })

  it('clicking an icon-variant pill still fires onSelect(vehicle)', () => {
    const onSelect = vi.fn()
    const resolver: VehicleIconResolver = async () => null
    render({ vehicles: FIVE_MIXED, onSelect, iconResolver: resolver })
    act(() => {
      pillFor('halftrack')!.click()
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].id).toBe('halftrack')
  })
})

describe('VehicleMenu — auto-scroll', () => {
  it('selecting a vehicle calls scrollIntoView on that pill', () => {
    const spy = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>
    render({ vehicles: FIVE_MIXED, selected: FIVE_MIXED.find(v => v.id === 'sdkfz_222')! })
    expect(spy).toHaveBeenCalled()
    // The most recent call should have the smooth/center/nearest options.
    const callArg = spy.mock.calls.at(-1)?.[0]
    expect(callArg).toMatchObject({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  })
})
