/**
 * Tests for FactionChooserStep — the lightweight faction chooser used by BOTH
 * the skin and decal new-pack flows (Phase-2 SLICE 1).
 *
 * Pinned contract:
 *   1. Five faction rows render in the canonical order: german →
 *      west_german → soviet → aef → british (drives the Stagger entrance).
 *   2. Each row carries its faction label + sublabel and a
 *      /factions/<faction>.png image.
 *   3. Clicking a faction row calls onPick(faction) exactly once.
 *   4. After a pick the chooser LOCKS — subsequent clicks (same or other
 *      row) do NOT fire onPick again, and the back button disables. Guards
 *      against a double-click during the post-pick transition.
 *   5. The back button fires onBack when clicked (and disables after a pick).
 *   6. title/subtitle are caller-supplied so ONE component serves both flows.
 *
 * Test infra mirrors FactionPicker.test.tsx: React 19 createRoot + act,
 * Stagger renders children synchronously on first paint.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import FactionChooserStep from '../FactionChooserStep'
import type { Faction } from '@/lib/vehicles'

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  exiting?: boolean
  title?: string
  subtitle?: string
  onPick?: (faction: Faction) => void
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
      createElement(FactionChooserStep, {
        exiting: props.exiting,
        title: props.title ?? 'Which faction?',
        subtitle: props.subtitle ?? 'Pick the army your skin belongs to.',
        onPick: props.onPick ?? (() => {}),
        onBack: props.onBack ?? (() => {}),
      }),
    )
  })
  return container!
}

function factionRows(): HTMLButtonElement[] {
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

describe('FactionChooserStep — layout', () => {
  it('renders the caller-supplied title and subtitle', () => {
    render({ title: 'Which faction?', subtitle: 'Pick the army this decal pack is for.' })
    expect(document.querySelector('h1')?.textContent).toContain('Which faction?')
    expect(document.body.textContent).toContain('Pick the army this decal pack is for.')
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
    expect(text).toContain('OstHeer')
    expect(text).toContain('OKW')
    expect(text).toContain('Soviet')
    expect(text).toContain('USF')
    expect(text).toContain('UKF')
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

describe('FactionChooserStep — picking', () => {
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
    expect(rowFor('british')!.disabled).toBe(false)
    expect(rowFor('german')!.disabled).toBe(true)
    expect(rowFor('west_german')!.disabled).toBe(true)
    expect(rowFor('soviet')!.disabled).toBe(true)
    expect(rowFor('aef')!.disabled).toBe(true)
  })
})

describe('FactionChooserStep — back button', () => {
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
