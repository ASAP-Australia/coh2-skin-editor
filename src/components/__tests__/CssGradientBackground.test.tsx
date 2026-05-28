/**
 * Tests for CssGradientBackground — the pure-CSS Suspense fallback for
 * ShaderWaveBackground.
 *
 * This component is intentionally tiny — its whole job is to render
 * something on first paint without any JS / WebGL while Three.js loads
 * asynchronously. The contract we pin is structural so a "let's clean
 * this up" refactor can't accidentally strip:
 *
 *   1. Mounts a `aria-hidden` element so screen readers skip it
 *      (decorative pixel art).
 *   2. `pointer-events-none` so it never eats clicks aimed at content
 *      that mounts on top of it.
 *   3. The dark charcoal base colour (#212121) is set inline — pinned
 *      because the colour matches the WebGL shader's baseColor, so the
 *      handoff from fallback → shader is seamless. A drift to a
 *      different base would cause a visible "flash" on first paint.
 *   4. The radial-gradient drift layer renders inside the base and
 *      carries a `cssGradBgDrift` keyframe animation. The keyframes
 *      block is inlined in a `<style>` tag (so the component is
 *      self-contained — no Tailwind plugin or external CSS file to
 *      maintain).
 *   5. Renders at `-z-10` and `fixed inset-0` so the page content sits
 *      on top — wiring is via Tailwind utility classes (pinned via
 *      className substring).
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import CssGradientBackground from '../CssGradientBackground'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(CssGradientBackground))
  })
  return container!
}

function baseLayer(): HTMLElement | null {
  // The outermost div carries aria-hidden + pointer-events-none.
  return container!.querySelector('[aria-hidden]') as HTMLElement | null
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

describe('CssGradientBackground — accessibility / layering', () => {
  it('mounts an aria-hidden base layer (decorative pixel art)', () => {
    render()
    expect(baseLayer()).not.toBeNull()
    expect(baseLayer()!.getAttribute('aria-hidden')).toBe('true')
  })

  it('base layer is pointer-events-none so it never eats clicks', () => {
    render()
    expect(baseLayer()!.className).toContain('pointer-events-none')
  })

  it('mounts at fixed inset-0 -z-10 so the page content sits on top', () => {
    render()
    const cls = baseLayer()!.className
    expect(cls).toContain('fixed')
    expect(cls).toContain('inset-0')
    expect(cls).toContain('-z-10')
  })
})

describe('CssGradientBackground — colour contract', () => {
  it('uses the dark charcoal #212121 base — must match the WebGL shader baseColor', () => {
    render()
    // React lowercases hex colours in style attribute serialisation.
    expect(baseLayer()!.style.backgroundColor.toLowerCase()).toBe('rgb(33, 33, 33)')
  })

  it('inner drift layer carries the radial-gradient + cssGradBgDrift animation', () => {
    render()
    // The drift layer is the only child of the base (positioned absolute).
    const drift = baseLayer()!.querySelector('div')
    expect(drift).not.toBeNull()
    const style = drift!.getAttribute('style') ?? ''
    expect(style).toContain('radial-gradient')
    // Two layered radial gradients — confirms BOTH peaks render, not just one.
    const radialCount = (style.match(/radial-gradient/g) ?? []).length
    expect(radialCount).toBe(2)
    expect(style).toContain('cssGradBgDrift')
  })
})

describe('CssGradientBackground — inlined keyframes', () => {
  it('inlines the cssGradBgDrift @keyframes so the file is self-contained', () => {
    render()
    // The component mounts a sibling <style> tag carrying the keyframes
    // rule — pin both the rule name and the four canonical stops so a
    // refactor that drops a frame is caught.
    const style = container!.querySelector('style')
    expect(style).not.toBeNull()
    const css = style!.textContent ?? ''
    expect(css).toContain('@keyframes cssGradBgDrift')
    expect(css).toContain('0%')
    expect(css).toContain('33%')
    expect(css).toContain('66%')
    expect(css).toContain('100%')
  })

  it('keyframe stops use ease-in-out and a 14s loop (matches the design spec)', () => {
    render()
    const drift = baseLayer()!.querySelector('div')
    const style = drift!.getAttribute('style') ?? ''
    expect(style).toContain('14s')
    expect(style).toContain('ease-in-out')
    expect(style).toContain('infinite')
  })
})
