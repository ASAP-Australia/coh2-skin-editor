/**
 * Tests for DecalPackInGamePreview — the in-editor mock of the CoH2
 * decal-picker grid.
 *
 * The component renders the project's `visible` decals as a 3-column
 * tile grid, mirroring the layout the game uses in Skins → Customise →
 * Decals. Each tile shows:
 *   - The rasterised decal thumbnail (or "…" placeholder while
 *     rasterising)
 *   - A slot number badge in the top-left (`idx + 1`, 1-based)
 *   - The decal's name beneath (falls back to `Decal <slot#>` when name
 *     is blank)
 *
 * Tile rasterisation goes through `rasteriseDecal` + `loadImage` which
 * both depend on Canvas / Image — flaky and slow in jsdom. We mock the
 * `@/lib/decal-pack-export` module so the tests focus on the grid's
 * structural contract: visibility filter, slot numbering, name fallback,
 * empty-state, and aria-label.
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import type { Coh2DecalPackProject, Decal } from '@/lib/decal-pack-project'

// ── Module mocks ─────────────────────────────────────────────────────────────
// Skip the actual canvas rasterisation — return a fake canvas that the
// component's `rasteriseDecalToDataUrl` will then bounce off `toDataURL`.
// But since the component uses Image internally (loadImage), even reaching
// `rasteriseDecal` is hard in jsdom. We make `rasteriseDecal` return a
// shape that has neither convertToBlob nor toDataURL — so the inner async
// throws and the catch swallows it, leaving thumbs in their pending state.
// That's fine — the test pins the placeholder state explicitly.
vi.mock('@/lib/decal-pack-export', () => ({
  rasteriseDecal: vi.fn(),
}))

const { default: DecalPackInGamePreview } = await import('../DecalPackInGamePreview')

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(project: Coh2DecalPackProject) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(DecalPackInGamePreview, { project }))
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

function decal(over: Partial<Decal> & Pick<Decal, 'id'>): Decal {
  return {
    name: '',
    sourceImageId: 'src-1',
    x: 64,
    y: 64,
    rotation: 0,
    scale: 1,
    opacity: 1,
    flipH: false,
    flipV: false,
    visible: true,
    ...over,
  }
}

function project(decals: Decal[]): Coh2DecalPackProject {
  return {
    decals,
    sourceImages: {
      'src-1': { id: 'src-1', name: 'src', dataUrl: 'data:,', width: 128, height: 128 },
    },
  } as unknown as Coh2DecalPackProject
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function region(): HTMLElement | null {
  return container!.querySelector('[role="img"]') as HTMLElement | null
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DecalPackInGamePreview — surface contract', () => {
  it('mounts a role="img" with a descriptive aria-label', () => {
    render(project([]))
    const root = region()
    expect(root).not.toBeNull()
    expect(root!.getAttribute('aria-label')).toContain('In-game preview')
    expect(root!.getAttribute('aria-label')).toContain('decal pack')
  })

  it('renders the "Customise → Decals" eyebrow header', () => {
    render(project([]))
    expect(container!.textContent).toContain('Customise → Decals')
  })
})

describe('DecalPackInGamePreview — empty state', () => {
  it('shows the empty-state hint when no decals are visible', () => {
    render(project([]))
    expect(container!.textContent).toContain('No visible decals yet')
  })

  it('shows the empty-state hint when decals exist but all are hidden', () => {
    render(project([decal({ id: 'd1', visible: false }), decal({ id: 'd2', visible: false })]))
    expect(container!.textContent).toContain('No visible decals yet')
  })

  it('does NOT render the 3-column grid in the empty state', () => {
    render(project([]))
    // The grid container uses gridTemplateColumns: 'repeat(3, 1fr)'.
    const grids = Array.from(container!.querySelectorAll('div')).filter(d =>
      d.style.gridTemplateColumns.includes('repeat(3'),
    )
    expect(grids).toHaveLength(0)
  })
})

describe('DecalPackInGamePreview — visibility filter', () => {
  it('renders ONLY visible decals (hidden ones are dropped at export and here too)', () => {
    render(
      project([
        decal({ id: 'd1', name: 'Alpha', visible: true }),
        decal({ id: 'd2', name: 'Hidden Beta', visible: false }),
        decal({ id: 'd3', name: 'Gamma', visible: true }),
      ]),
    )
    expect(container!.textContent).toContain('Alpha')
    expect(container!.textContent).toContain('Gamma')
    expect(container!.textContent).not.toContain('Hidden Beta')
  })

  it('renders exactly one tile per visible decal (no duplicates, no extras)', () => {
    render(
      project([
        decal({ id: 'd1', name: 'Alpha', visible: true }),
        decal({ id: 'd2', name: 'Hidden', visible: false }),
        decal({ id: 'd3', name: 'Gamma', visible: true }),
      ]),
    )
    // Each tile carries an <img> placeholder slot — count by the
    // outer aspect-ratio square's parent (the tile column).
    // Easier: count <span title="…"> name captions.
    const captions = container!.querySelectorAll('span[title]')
    expect(captions).toHaveLength(2)
  })
})

describe('DecalPackInGamePreview — slot numbering', () => {
  it('slot numbers are 1-based and run in array order across visible decals', () => {
    render(
      project([
        decal({ id: 'd1', name: 'First', visible: true }),
        decal({ id: 'd2', name: 'Hidden', visible: false }),
        decal({ id: 'd3', name: 'Second', visible: true }),
        decal({ id: 'd4', name: 'Third', visible: true }),
      ]),
    )
    // Slot badges are aria-hidden divs containing only the number text.
    const badges = Array.from(container!.querySelectorAll('[aria-hidden]'))
      .filter(el => /^\d+$/.test(el.textContent ?? ''))
      .map(el => el.textContent)
    // Hidden decals don't get a slot — visible ones renumber to 1, 2, 3.
    expect(badges).toEqual(['1', '2', '3'])
  })

  it('a single visible decal gets slot 1', () => {
    render(project([decal({ id: 'd1', name: 'Only', visible: true })]))
    const badge = Array.from(container!.querySelectorAll('[aria-hidden]')).find(el =>
      /^\d+$/.test(el.textContent ?? ''),
    )
    expect(badge?.textContent).toBe('1')
  })
})

describe('DecalPackInGamePreview — name fallback', () => {
  it('decal with a non-empty name shows that name as the caption', () => {
    render(project([decal({ id: 'd1', name: 'My Custom Decal', visible: true })]))
    const cap = container!.querySelector('span[title]')
    expect(cap?.textContent).toBe('My Custom Decal')
    expect(cap?.getAttribute('title')).toBe('My Custom Decal')
  })

  it('decal with an empty name falls back to "Decal <slotNumber>"', () => {
    render(
      project([
        decal({ id: 'd1', name: '', visible: true }),
        decal({ id: 'd2', name: '', visible: true }),
      ]),
    )
    const caps = Array.from(container!.querySelectorAll('span[title]'))
    expect(caps[0].textContent).toBe('Decal 1')
    expect(caps[1].textContent).toBe('Decal 2')
    // Title attribute still gets the empty original name (a refactor
    // that put the fallback into title would defeat browser tooltips
    // for decals deliberately left unnamed — we want them blank-on-hover
    // so the tooltip distinguishes from the visible fallback).
    expect(caps[0].getAttribute('title')).toBe('')
  })

  it('name fallback uses the SLOT number not the decal index — hidden decals do not shift it', () => {
    render(
      project([
        decal({ id: 'd1', name: 'A', visible: true }),
        decal({ id: 'd2', name: 'B', visible: false }), // hidden — no slot
        decal({ id: 'd3', name: '', visible: true }), // ← slot 2, name fallback "Decal 2"
      ]),
    )
    const caps = Array.from(container!.querySelectorAll('span[title]'))
    expect(caps[1].textContent).toBe('Decal 2')
  })
})

describe('DecalPackInGamePreview — placeholder state', () => {
  it('renders the "…" rasterising placeholder when thumbnails have not arrived yet', () => {
    render(project([decal({ id: 'd1', name: 'A', visible: true })]))
    // Each tile mounts a placeholder div with "…" text. With
    // rasteriseDecal mocked out + jsdom missing canvas APIs, no thumb
    // ever lands so all visible tiles stay in the placeholder state.
    expect(container!.textContent).toContain('…')
  })

  it('renders NO <img> tag until a rasterised data URL is set on a tile', () => {
    render(project([decal({ id: 'd1', name: 'A', visible: true })]))
    // No <img> mounts because the thumbs state stays {}.
    const imgs = container!.querySelectorAll('img')
    expect(imgs).toHaveLength(0)
  })
})

describe('DecalPackInGamePreview — 3-column grid structure', () => {
  it('renders the tile grid with gridTemplateColumns: repeat(3, 1fr)', () => {
    render(
      project([
        decal({ id: 'd1', visible: true }),
        decal({ id: 'd2', visible: true }),
        decal({ id: 'd3', visible: true }),
        decal({ id: 'd4', visible: true }),
      ]),
    )
    const grid = Array.from(container!.querySelectorAll('div')).find(d =>
      d.style.gridTemplateColumns.includes('repeat(3'),
    )
    expect(grid).toBeDefined()
  })
})
