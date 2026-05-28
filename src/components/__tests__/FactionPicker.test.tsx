/**
 * Tests for FactionPicker — second screen in the new-project flow.
 *
 * Pinned contract:
 *   1. Five faction rows render in the canonical order: german →
 *      west_german → soviet → aef → british. Order matters because it
 *      drives the Stagger top-down entrance.
 *   2. Each row carries the faction label (e.g. "OstHeer") and its
 *      sublabel (e.g. "Wehrmacht · Eastern & Western Front").
 *   3. Each row's image src contains `/factions/<faction>.png`.
 *   4. Clicking a faction row calls `onPick(faction)` exactly once.
 *   5. After a pick, the picker LOCKS — subsequent clicks on any row
 *      (including the same one) do NOT fire onPick again, the back
 *      button becomes disabled. This guards against the user double-
 *      clicking during the post-pick transition and starting two
 *      preload pipelines.
 *   6. Hovering (pointerenter) or focusing a row calls
 *      `onPrefetch(faction)` — that's the speculative preload hook.
 *   7. `onPrefetch` is optional — omitting it must not crash on hover.
 *   8. The back button fires `onBack` when clicked.
 *   9. The back button is disabled once a faction has been picked.
 *  10. Q & A: the picked row visually flips (border + arrow icon
 *      become opaque) while the other four dim — pin via the
 *      `disabled` attribute on the non-picked buttons.
 *
 * Test infra: React 19 createRoot + act. No window stubs needed —
 * Stagger uses rAF + setTimeout but renders its children synchronously
 * on the first paint, which is all we need for these structural tests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import FactionPicker from '../FactionPicker'
import type { Faction } from '@/lib/vehicles'

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  exiting?: boolean
  enterDelay?: number
  onPick?: (faction: Faction) => void
  onPrefetch?: (faction: Faction) => void
  onBack?: () => void
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(FactionPicker, {
        exiting: props.exiting,
        enterDelay: props.enterDelay,
        onPick: props.onPick ?? (() => {}),
        onPrefetch: props.onPrefetch,
        onBack: props.onBack ?? (() => {}),
      }),
    )
  })
  return container!
}

function factionRows(): HTMLButtonElement[] {
  // Every row carries an <img> from /factions/ — that's the cleanest
  // selector for the five faction buttons (the back button doesn't have
  // an inner image of that kind).
  return Array.from(document.querySelectorAll('button')).filter(b => {
    const img = b.querySelector('img')
    return img != null && img.src.includes('/factions/')
  }) as HTMLButtonElement[]
}

function rowFor(faction: Faction): HTMLButtonElement | null {
  return (
    factionRows().find(b => b.querySelector('img')?.src.endsWith(`/factions/${faction}.png`)) ??
    null
  )
}

function backButton(): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Back')) as
      | HTMLButtonElement
      | undefined) ?? null
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

describe('FactionPicker — layout', () => {
  it('renders the question heading and helper text', () => {
    render()
    expect(document.querySelector('h1')?.textContent).toContain('Which faction?')
    expect(document.body.textContent).toContain('preload its vehicles')
  })

  it('renders all five faction rows in the canonical Stagger order', () => {
    render()
    const rows = factionRows()
    expect(rows).toHaveLength(5)
    const order = rows.map(r => r.querySelector('img')!.src.split('/').pop()!.replace('.png', ''))
    expect(order).toEqual(['german', 'west_german', 'soviet', 'aef', 'british'])
  })

  it('each row shows the faction label + sublabel', () => {
    render()
    const text = document.body.textContent ?? ''
    // Labels come from FACTION_LABELS.
    expect(text).toContain('OstHeer')
    expect(text).toContain('OKW')
    expect(text).toContain('Soviet')
    expect(text).toContain('USF')
    expect(text).toContain('UKF')
    // Sublabels.
    expect(text).toContain('Wehrmacht')
    expect(text).toContain('Oberkommando West')
    expect(text).toContain('Red Army')
    expect(text).toContain('US Forces')
    expect(text).toContain('British Forces')
  })

  it('each row image src points at /factions/<faction>.png', () => {
    render()
    for (const fac of ['german', 'west_german', 'soviet', 'aef', 'british'] as const) {
      const row = rowFor(fac)
      expect(row).not.toBeNull()
      expect(row!.querySelector('img')!.src).toContain(`/factions/${fac}.png`)
    }
  })
})

describe('FactionPicker — picking', () => {
  it('clicking a faction row calls onPick exactly once with that faction', () => {
    const onPick = vi.fn()
    render({ onPick })
    act(() => {
      rowFor('soviet')!.click()
    })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('soviet')
  })

  it('locks after first pick — second click on a different row does NOT fire onPick', () => {
    const onPick = vi.fn()
    render({ onPick })
    act(() => {
      rowFor('aef')!.click()
    })
    expect(onPick).toHaveBeenCalledTimes(1)
    act(() => {
      rowFor('soviet')!.click()
    })
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('locks after first pick — second click on the SAME row does NOT fire onPick', () => {
    const onPick = vi.fn()
    render({ onPick })
    act(() => {
      rowFor('german')!.click()
    })
    expect(onPick).toHaveBeenCalledTimes(1)
    act(() => {
      rowFor('german')!.click()
    })
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('non-picked rows become disabled (visually dimmed) after a pick', () => {
    render()
    act(() => {
      rowFor('british')!.click()
    })
    // The picked row stays enabled; the other four flip `disabled`.
    expect(rowFor('british')!.disabled).toBe(false)
    expect(rowFor('german')!.disabled).toBe(true)
    expect(rowFor('west_german')!.disabled).toBe(true)
    expect(rowFor('soviet')!.disabled).toBe(true)
    expect(rowFor('aef')!.disabled).toBe(true)
  })
})

describe('FactionPicker — prefetch', () => {
  it('hovering a row fires onPrefetch(faction)', () => {
    const onPrefetch = vi.fn()
    render({ onPrefetch })
    // React synthesises onPointerEnter from the underlying pointerover
    // event with a related-target check — dispatch the native pointerover
    // (with relatedTarget outside the row) so the synthetic handler
    // fires.
    act(() => {
      rowFor('aef')!.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, relatedTarget: document.body }),
      )
    })
    expect(onPrefetch).toHaveBeenCalledWith('aef')
  })

  it('focusing a row also fires onPrefetch(faction)', () => {
    const onPrefetch = vi.fn()
    render({ onPrefetch })
    // React listens for `focusin` (which bubbles) in its synthetic event
    // delegation; a synthetic `focus` event with bubbles:true is what we
    // need for the onFocus handler to fire under jsdom.
    act(() => {
      rowFor('soviet')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(onPrefetch).toHaveBeenCalledWith('soviet')
  })

  it('omitting onPrefetch does NOT crash on hover (optional callback guard)', () => {
    render() // no onPrefetch
    expect(() => {
      act(() => {
        rowFor('german')!.dispatchEvent(
          new PointerEvent('pointerover', { bubbles: true, relatedTarget: document.body }),
        )
      })
    }).not.toThrow()
  })
})

describe('FactionPicker — back button', () => {
  it('back button fires onBack when clicked', () => {
    const onBack = vi.fn()
    render({ onBack })
    act(() => {
      backButton()!.click()
    })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('back button becomes disabled once a faction has been picked', () => {
    render()
    expect(backButton()!.disabled).toBe(false)
    act(() => {
      rowFor('soviet')!.click()
    })
    expect(backButton()!.disabled).toBe(true)
  })
})
