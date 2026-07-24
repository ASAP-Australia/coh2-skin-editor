/**
 * Tests for ShaderWaveBackground — the animated wave-mesh shader
 * backdrop used on the auth shell + start screen.
 *
 * The component's runtime lives almost entirely inside a `useEffect`
 * that constructs a Three.js `WebGLRenderer`. jsdom has no WebGL
 * implementation so the constructor throws; the component catches,
 * removes the canvas it just appended, and bails. From the test's
 * perspective the only persistent DOM is the outer `<div>` shell —
 * which is exactly the contract we want to pin, because it's what the
 * page sees while three-r170 is still loading, AND it's the safety net
 * for environments without WebGL at all (older laptops, locked-down
 * corporate browsers, jsdom-based SSR pre-render).
 *
 * Contract pinned here:
 *
 *  - The wrapper is a `<div>` with the four canonical layout classes
 *    that put it as a container-filling backdrop:
 *      `absolute`, `inset-0`, `-z-10`, `pointer-events-none`.
 *    These four together guarantee that the wave fills the viewport,
 *    sits behind every interactive surface, and never intercepts
 *    clicks meant for foreground UI.
 *  - The wrapper is `aria-hidden` because it's purely decorative.
 *  - The wrapper carries `backgroundColor: '#212121'` inline, so that
 *    the CSS pixel-perfect colour is showing BEFORE the WebGL pass
 *    paints (avoids a black flash on slow GPUs / first paint).
 *  - When WebGL is unavailable (jsdom case), the effect cleans up
 *    after itself: no leftover `<canvas>` remains as a child.
 *  - The component accepts a `noRipples` prop that defaults to
 *    `false`. The prop only affects the (unmounted-in-tests) WebGL
 *    listener — the structural DOM is identical regardless.
 *  - Unmounting the component removes the wrapper without throwing,
 *    even when the WebGL init failed on mount.
 *
 *  Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import ShaderWaveBackground from '../ShaderWaveBackground'

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(props: { noRipples?: boolean } = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(ShaderWaveBackground, props))
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
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ShaderWaveBackground — wrapper layout', () => {
  it('renders a single <div> wrapper as its only top-level element', () => {
    const card = render()
    // The wrapper is the only child of the test container.
    expect(card.children).toHaveLength(1)
    const wrapper = card.firstElementChild as HTMLElement
    expect(wrapper.tagName).toBe('DIV')
  })

  it('wrapper carries the four canonical full-viewport backdrop classes', () => {
    const card = render()
    const wrapper = card.firstElementChild as HTMLElement
    // Each of these contributes to "fills the viewport without
    // intercepting clicks, sitting behind every interactive surface".
    // A refactor that drops any one of them silently regresses the
    // backdrop contract.
    // `absolute` (not `fixed`): scopes the backdrop to the AuthShell box
    // (.glass-frame-inner) so it doesn't paint over the glass window border.
    expect(wrapper.className).toContain('absolute')
    expect(wrapper.className).toContain('inset-0')
    expect(wrapper.className).toContain('-z-10')
    expect(wrapper.className).toContain('pointer-events-none')
  })

  it('wrapper is aria-hidden (decorative — accessible content lives elsewhere)', () => {
    const card = render()
    const wrapper = card.firstElementChild as HTMLElement
    expect(wrapper.getAttribute('aria-hidden')).not.toBeNull()
  })

  it('wrapper carries the #212121 inline backgroundColor (avoids black flash before WebGL paints)', () => {
    const card = render()
    const wrapper = card.firstElementChild as HTMLElement
    // jsdom normalises rgb()/hex differently; assert the raw inline
    // style string contains the literal #212121.
    const bg = wrapper.style.backgroundColor
    // jsdom may parse #212121 into rgb(33, 33, 33).
    expect(['#212121', 'rgb(33, 33, 33)']).toContain(bg)
  })
})

describe('ShaderWaveBackground — WebGL unavailability', () => {
  it('does NOT leave a stray <canvas> child when WebGL init fails (jsdom case)', () => {
    const card = render()
    const wrapper = card.firstElementChild as HTMLElement
    // In jsdom, WebGLRenderer construction throws; the effect's catch
    // calls canvas.remove() and returns early.
    expect(wrapper.querySelector('canvas')).toBeNull()
  })

  it('does not throw on mount in a WebGL-free environment', () => {
    expect(() => render()).not.toThrow()
  })
})

describe('ShaderWaveBackground — props', () => {
  it('renders identical structural DOM whether noRipples is true or false', () => {
    const card1 = render({ noRipples: false })
    const wrapper1 = card1.firstElementChild as HTMLElement
    const className1 = wrapper1.className
    const aria1 = wrapper1.getAttribute('aria-hidden')
    // Unmount + remount with noRipples: true.
    act(() => root!.unmount())
    container!.remove()
    container = null
    root = null
    const card2 = render({ noRipples: true })
    const wrapper2 = card2.firstElementChild as HTMLElement
    expect(wrapper2.className).toBe(className1)
    expect(wrapper2.getAttribute('aria-hidden')).toBe(aria1)
  })

  it('default noRipples behaviour (no prop) matches the explicit noRipples=false case', () => {
    const card1 = render()
    const wrapper1 = card1.firstElementChild as HTMLElement
    const className1 = wrapper1.className
    act(() => root!.unmount())
    container!.remove()
    container = null
    root = null
    const card2 = render({ noRipples: false })
    const wrapper2 = card2.firstElementChild as HTMLElement
    expect(wrapper2.className).toBe(className1)
  })
})

describe('ShaderWaveBackground — lifecycle', () => {
  it('unmounts cleanly with no leftover DOM under the container', () => {
    const card = render()
    expect(card.children.length).toBe(1)
    act(() => root!.unmount())
    root = null
    expect(card.children.length).toBe(0)
  })

  it('unmounting does NOT throw even though the WebGL init bailed (catch path)', () => {
    render()
    expect(() => {
      act(() => root!.unmount())
      root = null
    }).not.toThrow()
  })
})
