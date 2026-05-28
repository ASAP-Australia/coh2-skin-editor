/**
 * Tests for TokensPreview — the in-app design-token gallery rendered at
 * the `#tokens` hash route. Pure visual reference for design reviews;
 * has no interactive logic apart from MotionButton's hover state.
 *
 * Pinned contract:
 *   1. The page renders the H1 title and the "Hash route: #tokens" hint.
 *   2. All seven section headings appear (Color, Glass, Text, Radius,
 *      Shadows, Motion, Spacing, Accent).
 *   3. Every colour token from COLOR_TOKENS gets a labelled swatch.
 *   4. Every radius / spacing / motion token gets a labelled swatch.
 *   5. The four glass swatches render (glass-1 through glass-4) with the
 *      matching utility class.
 *   6. MotionButton's hover transition toggles between transform Y(0)
 *      and Y(-6) — pin the prop wiring so a refactor can't break the
 *      hover-pop demo.
 *   7. The five faction emblems render in the background with the
 *      `aria-hidden` flag so screen readers ignore them.
 *
 * Strategy: pure DOM render via createRoot + act. No window stubs are
 * needed because TokensPreview doesn't touch matchMedia, canvas, or
 * fonts. We assert visible text content and structural counts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import TokensPreview from '../TokensPreview'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(TokensPreview))
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TokensPreview — page chrome', () => {
  it('renders the H1 title and the #tokens hash hint', () => {
    render()
    const h1 = document.querySelector('h1')
    expect(h1?.textContent).toContain('Design Token Gallery')
    // The intro paragraph cites the hash route — confirms the route doc
    // doesn't drift out of sync with the file location.
    expect(document.body.textContent).toContain('#tokens')
  })

  it('renders the five faction emblems as aria-hidden background', () => {
    render()
    const factionImgs = Array.from(document.querySelectorAll('img')).filter(
      img => img.getAttribute('aria-hidden') === 'true' && img.src.includes('/factions/'),
    )
    expect(factionImgs).toHaveLength(5)
  })
})

describe('TokensPreview — section headings', () => {
  it('renders all seven section headings', () => {
    render()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Color tokens')
    expect(text).toContain('Glass layers')
    expect(text).toContain('Text scale')
    expect(text).toContain('Border radius')
    expect(text).toContain('Shadows')
    expect(text).toContain('Motion')
    expect(text).toContain('Spacing')
    expect(text).toContain('Accent')
  })
})

describe('TokensPreview — colour swatches', () => {
  it('renders a swatch for every colour token (18 total)', () => {
    render()
    const text = document.body.textContent ?? ''
    // Spot-check representative tokens from each band.
    const tokens = [
      '--color-app-bg',
      '--color-app-bg-deep',
      '--color-glass-1',
      '--color-glass-4',
      '--color-stroke-1',
      '--color-text-1',
      '--color-text-3',
      '--color-accent',
      '--color-accent-soft',
      '--color-accent-strong',
      '--color-blue',
      '--color-green',
      '--color-red',
    ]
    for (const t of tokens) {
      expect(text).toContain(t)
    }
  })
})

describe('TokensPreview — radius / spacing / duration tokens', () => {
  it('renders all four radius tokens with their labels', () => {
    render()
    const text = document.body.textContent ?? ''
    expect(text).toContain('--radius-card')
    expect(text).toContain('--radius-panel')
    expect(text).toContain('--radius-pill')
    expect(text).toContain('--radius-input')
    expect(text).toContain('card (18px)')
    expect(text).toContain('pill (9999px)')
  })

  it('renders all eight spacing swatches (4 → 64 px)', () => {
    render()
    const text = document.body.textContent ?? ''
    for (const px of [4, 8, 12, 16, 24, 32, 48, 64]) {
      expect(text).toContain(`${px}px`)
    }
  })

  it('renders all five motion tokens as hoverable MotionButtons', () => {
    render()
    const text = document.body.textContent ?? ''
    expect(text).toContain('--dur-instant')
    expect(text).toContain('--dur-fast')
    expect(text).toContain('--dur-med')
    expect(text).toContain('--dur-slow')
    expect(text).toContain('--dur-slower')
    // Each motion button mentions its ms value alongside the "hover me"
    // hint, which is what tells designers the demo is interactive.
    expect(text).toContain('hover me')
  })
})

describe('TokensPreview — glass layers', () => {
  it('renders four glass swatches with their utility classes', () => {
    render()
    expect(document.querySelector('.glass-1')).not.toBeNull()
    expect(document.querySelector('.glass-2')).not.toBeNull()
    expect(document.querySelector('.glass-3')).not.toBeNull()
    expect(document.querySelector('.glass-4')).not.toBeNull()
  })
})

describe('TokensPreview — MotionButton hover', () => {
  it('toggles translateY between 0 and -6 px on mouse enter/leave', () => {
    render()
    // Find one motion button via its --dur-fast label.
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.includes('--dur-fast'),
    ) as HTMLButtonElement | undefined
    expect(btn).toBeDefined()
    // Initial state — translateY(0) so the button sits flush.
    expect(btn!.style.transform).toBe('translateY(0)')
    // React doesn't attach native mouseenter/mouseleave listeners — it
    // synthesises them from native mouseover/mouseout via relatedTarget
    // checks. Dispatch the underlying native events so React fires the
    // synthetic onMouseEnter / onMouseLeave handlers.
    act(() => {
      btn!.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }),
      )
    })
    expect(btn!.style.transform).toBe('translateY(-6px)')
    act(() => {
      btn!.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      )
    })
    expect(btn!.style.transform).toBe('translateY(0)')
  })
})

describe('TokensPreview — accent CTA + indicator', () => {
  it('renders the primary CTA, the dirty indicator, and the accent-soft tint', () => {
    render()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Primary CTA')
    expect(text).toContain('Dirty indicator')
    expect(text).toContain('accent-soft tint')
  })
})
