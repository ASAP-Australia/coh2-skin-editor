/**
 * Unit/render tests for CanvasPlaceholder.
 *
 * Uses React 19's createRoot to mount into a jsdom container and asserts
 * the redesigned visual: soft background, center dot, four diagonal SVG
 * arrows, and a centered dimension label.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import CanvasPlaceholder from '../editor-primitives/CanvasPlaceholder'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(ui: React.ReactElement) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) {
    root = createRoot(container)
  }
  act(() => {
    root!.render(ui)
  })
  return container
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
})

describe('CanvasPlaceholder', () => {
  it('renders dimension label containing "624 × 204 px" for width=624 height=204', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 624, height: 204 }))
    // U+00D7 × is the multiplication sign used in the label
    expect(el.textContent).toContain('624 \u00d7 204 px')
  })

  it('dimension label is horizontally centered (left: 50%, translateX(-50%))', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 624, height: 204 }))
    const span = el.querySelector('span') as HTMLElement | null
    expect(span).not.toBeNull()
    expect(span!.style.left).toBe('50%')
    expect(span!.style.transform).toBe('translateX(-50%)')
  })

  it('renders an SVG with four <line> elements (the four diagonal arrows)', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 624, height: 204 }))
    const svg = el.querySelector('svg')
    expect(svg).not.toBeNull()
    const lines = svg!.querySelectorAll('line')
    expect(lines.length).toBe(4)
  })

  it('renders the center-dot element', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 128, height: 128 }))
    const dot = el.querySelector('[data-testid="canvas-placeholder-dot"]')
    expect(dot).not.toBeNull()
  })

  it('has pointer-events: none on the wrapper', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 128, height: 128 }))
    const ph = el.querySelector('[data-testid="canvas-placeholder"]') as HTMLElement | null
    expect(ph).not.toBeNull()
    expect(ph!.style.pointerEvents).toBe('none')
  })

  it('renders the placeholder wrapper with data-testid="canvas-placeholder"', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 512, height: 256 }))
    const ph = el.querySelector('[data-testid="canvas-placeholder"]')
    expect(ph).not.toBeNull()
  })

  it('has no visible border/outline on the wrapper (surface edge is defined by OOB red tint and shadow)', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 128, height: 128 }))
    const ph = el.querySelector('[data-testid="canvas-placeholder"]') as HTMLElement | null
    expect(ph).not.toBeNull()
    // No hairline border — the red OOB tint and drop shadow define the surface edge.
    expect(ph!.style.outline).toBe('')
    expect(ph!.style.border).toBe('')
  })

  it('renders a custom label when provided via label prop', () => {
    const el = render(
      createElement(CanvasPlaceholder, { width: 128, height: 128, label: 'Custom label' }),
    )
    expect(el.textContent).toContain('Custom label')
  })

  it('defaults to "{width} × {height} px" format (128×128)', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 128, height: 128 }))
    expect(el.textContent).toMatch(/128\s*\u00d7\s*128\s*px/)
  })

  it('does not use a repeating-linear-gradient background (hatching removed)', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 128, height: 128 }))
    const ph = el.querySelector('[data-testid="canvas-placeholder"]') as HTMLElement | null
    expect(ph).not.toBeNull()
    expect(ph!.style.backgroundImage).not.toContain('repeating-linear-gradient')
  })

  it('renders the trust caption clarifying the placeholder is not exported', () => {
    const el = render(createElement(CanvasPlaceholder, { width: 624, height: 204 }))
    const caption = el.querySelector(
      '[data-testid="canvas-placeholder-caption"]',
    ) as HTMLElement | null
    expect(caption).not.toBeNull()
    expect(caption!.textContent).toMatch(/not exported/i)
  })
})
