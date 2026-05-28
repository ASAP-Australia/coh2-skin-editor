/**
 * Tests for `src/lib/factions.tsx` — the faction metadata module.
 *
 * Why pin this? It is a tiny pure-data module, but every consumer
 * (FactionPicker, the home dashboard cards, vehicle list rows, the
 * connect screen's faction badges, the in-game lobby preview …) is
 * keyed off these exact records. A typo in any of them — wrong PNG
 * path, missing faction key, label drift like "OST" instead of
 * "OstHeer" — would silently break a downstream UI surface. Pinning
 * each record's shape catches that at test time.
 *
 * Pinned contract:
 *
 *   FACTION_COLORS — `oklch(...)` strings keyed by Faction. We don't
 *   pin the exact numbers (UI may retune for contrast), only that
 *   every key has a syntactically valid oklch() value with three
 *   numeric components. Values must be distinct (no two factions
 *   share the same colour).
 *
 *   FACTION_ICON_SRC — `./factions/<faction>.png` relative paths. Relative
 *   form is required for Electron's `file://` runtime (absolute `/` paths
 *   resolve to FS root). Public-folder prefix preserved; downstream
 *   `<img src={...}>` calls take this string as-is.
 *
 *   FACTION_ICONS — React.ReactNode entries that render an
 *   `<img src="./factions/<faction>.png" alt="" draggable="false">`
 *   sized to 85% of parent. Each entry is rendered into a real DOM
 *   container via createRoot+act so we can assert the produced
 *   element's attributes (no enzyme/RTL — same React-19 pattern used
 *   across the codebase).
 *
 *   FACTION_LABELS — exact display strings. These ride into the UI
 *   verbatim (game-canonical capitalisation: OstHeer not Ostheer,
 *   OKW not Okw, USF/UKF as initialisms).
 *
 *   Cross-record consistency — all four records share the same five
 *   keys (no orphan colours / icons / labels). The canonical key
 *   order is `german → west_german → soviet → aef → british` because
 *   that matches FactionPicker's row order and several downstream
 *   array iterations rely on `Object.keys()` insertion-order being
 *   stable across the records.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import { FACTION_COLORS, FACTION_ICON_SRC, FACTION_ICONS, FACTION_LABELS } from '@/lib/factions'
import type { Faction } from '@/lib/vehicles'

// React 19 act opt-in.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ALL_FACTIONS: Faction[] = ['german', 'west_german', 'soviet', 'aef', 'british']

// ---------------------------------------------------------------------------
// FACTION_COLORS
// ---------------------------------------------------------------------------
describe('FACTION_COLORS', () => {
  it.each(ALL_FACTIONS)('has an entry for %s', faction => {
    expect(FACTION_COLORS).toHaveProperty(faction)
    expect(typeof FACTION_COLORS[faction]).toBe('string')
  })

  it('contains exactly the five faction keys (no extras)', () => {
    expect(Object.keys(FACTION_COLORS).sort()).toEqual([...ALL_FACTIONS].sort())
  })

  it.each(ALL_FACTIONS)('uses a syntactically-valid oklch() value for %s', faction => {
    // oklch(L C H) — three space-separated numeric components inside
    // an oklch(...) wrapper. We don't pin the actual numbers so the
    // UI team can retune contrast without breaking the test.
    const value = FACTION_COLORS[faction]
    expect(value).toMatch(/^oklch\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*\)$/)
  })

  it('has five distinct colours (no two factions share a colour)', () => {
    const values = ALL_FACTIONS.map(f => FACTION_COLORS[f])
    expect(new Set(values).size).toBe(values.length)
  })
})

// ---------------------------------------------------------------------------
// FACTION_ICON_SRC
// ---------------------------------------------------------------------------
describe('FACTION_ICON_SRC', () => {
  it('contains exactly the five faction keys (no extras)', () => {
    expect(Object.keys(FACTION_ICON_SRC).sort()).toEqual([...ALL_FACTIONS].sort())
  })

  it.each(ALL_FACTIONS)('maps %s → ./factions/<faction>.png', faction => {
    expect(FACTION_ICON_SRC[faction]).toBe(`./factions/${faction}.png`)
  })

  it('every path contains /factions/ (public-folder prefix)', () => {
    for (const faction of ALL_FACTIONS) {
      expect(FACTION_ICON_SRC[faction]).toContain('/factions/')
    }
  })

  it('every path ends in .png (raster format)', () => {
    for (const faction of ALL_FACTIONS) {
      expect(FACTION_ICON_SRC[faction].endsWith('.png')).toBe(true)
    }
  })

  it('all five paths are distinct', () => {
    const paths = ALL_FACTIONS.map(f => FACTION_ICON_SRC[f])
    expect(new Set(paths).size).toBe(paths.length)
  })
})

// ---------------------------------------------------------------------------
// FACTION_LABELS
// ---------------------------------------------------------------------------
describe('FACTION_LABELS', () => {
  it('contains exactly the five faction keys (no extras)', () => {
    expect(Object.keys(FACTION_LABELS).sort()).toEqual([...ALL_FACTIONS].sort())
  })

  it('pins exact game-canonical display strings', () => {
    // Pin verbatim — these capitalisations match in-game CoH2 lobby UI.
    expect(FACTION_LABELS).toEqual({
      german: 'OstHeer',
      west_german: 'OKW',
      soviet: 'Soviet',
      aef: 'USF',
      british: 'UKF',
    })
  })

  it.each(ALL_FACTIONS)('%s label is a non-empty string', faction => {
    expect(typeof FACTION_LABELS[faction]).toBe('string')
    expect(FACTION_LABELS[faction].length).toBeGreaterThan(0)
  })

  it('all five labels are distinct', () => {
    const labels = ALL_FACTIONS.map(f => FACTION_LABELS[f])
    expect(new Set(labels).size).toBe(labels.length)
  })
})

// ---------------------------------------------------------------------------
// FACTION_ICONS — these are React nodes, so we render them and inspect
// the produced DOM.
// ---------------------------------------------------------------------------
describe('FACTION_ICONS', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount()
      })
      root = null
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
    container = null
  })

  function renderIcon(faction: Faction): HTMLImageElement {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(FACTION_ICONS[faction])
    })
    const img = container.querySelector('img')
    if (!img) throw new Error(`FACTION_ICONS[${faction}] did not render an <img>`)
    return img as HTMLImageElement
  }

  it('contains exactly the five faction keys (no extras)', () => {
    expect(Object.keys(FACTION_ICONS).sort()).toEqual([...ALL_FACTIONS].sort())
  })

  it.each(ALL_FACTIONS)('%s renders an <img> with the matching src', faction => {
    const img = renderIcon(faction)
    // Check the raw attribute value set in JSX — relative path for Electron compat.
    expect(img.getAttribute('src')).toBe(`./factions/${faction}.png`)
  })

  it.each(ALL_FACTIONS)('%s image has empty alt (decorative)', faction => {
    const img = renderIcon(faction)
    expect(img.getAttribute('alt')).toBe('')
  })

  it.each(ALL_FACTIONS)('%s image is non-draggable', faction => {
    const img = renderIcon(faction)
    // React renders `draggable={false}` as the attribute "false".
    expect(img.getAttribute('draggable')).toBe('false')
  })

  it.each(ALL_FACTIONS)('%s image fills 85% of its parent', faction => {
    const img = renderIcon(faction)
    expect(img.style.width).toBe('85%')
    expect(img.style.height).toBe('85%')
  })

  it.each(ALL_FACTIONS)('%s image has objectFit:contain so emblems never crop', faction => {
    const img = renderIcon(faction)
    expect(img.style.objectFit).toBe('contain')
  })

  it.each(ALL_FACTIONS)('%s image disables pointer events', faction => {
    // Without this, hovering the emblem inside a button steals the
    // pointer target from the button itself — confirmed by manual
    // testing on the FactionPicker rows.
    const img = renderIcon(faction)
    expect(img.style.pointerEvents).toBe('none')
  })

  it.each(ALL_FACTIONS)('%s image disables text selection', faction => {
    const img = renderIcon(faction)
    expect(img.style.userSelect).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Cross-record consistency
// ---------------------------------------------------------------------------
describe('faction record consistency', () => {
  it('all four records share the same key set', () => {
    const colors = Object.keys(FACTION_COLORS).sort()
    const srcs = Object.keys(FACTION_ICON_SRC).sort()
    const icons = Object.keys(FACTION_ICONS).sort()
    const labels = Object.keys(FACTION_LABELS).sort()
    expect(colors).toEqual(srcs)
    expect(srcs).toEqual(icons)
    expect(icons).toEqual(labels)
  })

  it('canonical key insertion order matches FactionPicker row order', () => {
    // This order is what FactionPicker iterates over to render rows
    // top-down; pin it here so a reformat that re-keys the records
    // alphabetically would catch a test, not a UI regression.
    const expectedOrder: Faction[] = ['german', 'west_german', 'soviet', 'aef', 'british']
    expect(Object.keys(FACTION_COLORS)).toEqual(expectedOrder)
    expect(Object.keys(FACTION_ICON_SRC)).toEqual(expectedOrder)
    expect(Object.keys(FACTION_ICONS)).toEqual(expectedOrder)
    expect(Object.keys(FACTION_LABELS)).toEqual(expectedOrder)
  })
})
