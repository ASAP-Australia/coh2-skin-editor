/**
 * Tests for AsapFlagHeading — the "ASAP" wordmark with the Australian
 * flag waving inside the letters.
 *
 * The component does its actual painting in a Web Worker via
 * OffscreenCanvas + transferControlToOffscreen + ImageBitmap — none of
 * which are usable in jsdom. The render-side effect bails harmlessly in
 * a test environment, so this file focuses on what IS testable: the
 * structural / accessibility contract and the wrapper sizing math.
 *
 * Contract pinned here:
 *
 *  - Outer wrapper is a `<div>` with `display: inline-block` and
 *    `position: relative` so the absolute-positioned canvas inside it
 *    inherits a stable layout box.
 *  - Inner element is a single `<canvas>` with `aria-hidden` (the
 *    wordmark is decorative — accessible text lives elsewhere) and
 *    `pointer-events: none` so it can't intercept clicks on whatever
 *    sits beneath it.
 *  - Canvas covers the whole wrapper via `position: absolute` + inset 0.
 *  - Wrapper dimensions are pure functions of `height` (the only
 *    sizing prop):
 *      width  = leftPad + Math.round(fontSize * 0.62 * 4 + letterSpacing * 3)
 *               + overhangPad + maxExtrude
 *      height = height + maxExtrude
 *    The exact formula matters to consumers that drop the wordmark
 *    into a fixed slot (the auth shell's 56-px logo area, in
 *    particular). A refactor that changes the multiplier silently
 *    would crowd or overflow that slot — the test pins the math.
 *  - `height` defaults to 72 when the prop is omitted.
 *  - `className` and inline `style` props are forwarded to the wrapper.
 *
 *  Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import AsapFlagHeading from '../AsapFlagHeading'

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(props: { height?: number; className?: string; style?: React.CSSProperties } = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(AsapFlagHeading, props))
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

// ── Sizing math mirror (kept in sync with the component) ────────────────────

function expectedSize(height: number): { width: number; height: number } {
  const fontSize = Math.round(height * 0.92)
  const letterSpacing = Math.max(2, Math.round(height * 0.055))
  const leftPad = Math.round(height * 0.06)
  const overhangPad = Math.round(height * 0.45)
  const extrudeDepth = 5
  const extrudeStep = Math.max(0.6, height * 0.011)
  const maxExtrude = Math.ceil(extrudeDepth * extrudeStep)
  const width =
    leftPad + Math.round(fontSize * 0.62 * 4 + letterSpacing * 3) + overhangPad + maxExtrude
  return { width, height: height + maxExtrude }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AsapFlagHeading — structure', () => {
  it('renders an inline-block wrapper containing a single <canvas>', () => {
    const card = render()
    const wrapper = card.firstElementChild as HTMLElement
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.style.display).toBe('inline-block')
    expect(wrapper.style.position).toBe('relative')
    const canvases = wrapper.querySelectorAll('canvas')
    expect(canvases).toHaveLength(1)
  })

  it('the canvas is aria-hidden (decorative) and has pointer-events: none', () => {
    const card = render()
    const canvas = card.querySelector('canvas') as HTMLCanvasElement
    // React 19 stringifies the `aria-hidden` shorthand as 'true' in the
    // attribute. We just check it's present.
    expect(canvas.getAttribute('aria-hidden')).not.toBeNull()
    expect(canvas.style.pointerEvents).toBe('none')
  })

  it('the canvas covers the wrapper (position:absolute + 100% w/h)', () => {
    const card = render()
    const canvas = card.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.position).toBe('absolute')
    expect(canvas.style.width).toBe('100%')
    expect(canvas.style.height).toBe('100%')
  })
})

describe('AsapFlagHeading — sizing math', () => {
  it('defaults height to 72 when no prop is provided', () => {
    const card = render()
    const wrapper = card.firstElementChild as HTMLElement
    const { width, height } = expectedSize(72)
    expect(wrapper.style.width).toBe(`${width}px`)
    expect(wrapper.style.height).toBe(`${height}px`)
  })

  it('honours the height prop and derives width from it', () => {
    const card = render({ height: 56 })
    const wrapper = card.firstElementChild as HTMLElement
    const { width, height } = expectedSize(56)
    expect(wrapper.style.width).toBe(`${width}px`)
    expect(wrapper.style.height).toBe(`${height}px`)
  })

  it('width scales with height (larger height → larger width)', () => {
    const small = render({ height: 40 })
    const wSmall = parseInt((small.firstElementChild as HTMLElement).style.width, 10)
    act(() => root!.unmount())
    container!.remove()
    container = null
    root = null
    const large = render({ height: 120 })
    const wLarge = parseInt((large.firstElementChild as HTMLElement).style.width, 10)
    expect(wLarge).toBeGreaterThan(wSmall)
  })

  it('height layout box includes the 3-D extrusion overhang (not just `height`)', () => {
    const card = render({ height: 72 })
    const wrapper = card.firstElementChild as HTMLElement
    const layoutHeight = parseInt(wrapper.style.height, 10)
    // Anything taller than the raw `height` prop signals the extrusion
    // staircase has been added to the layout box (so ancestor overflow
    // doesn't clip it).
    expect(layoutHeight).toBeGreaterThan(72)
  })
})

describe('AsapFlagHeading — forwarded props', () => {
  it('forwards className to the wrapper', () => {
    const card = render({ className: 'custom-wrapper' })
    const wrapper = card.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('custom-wrapper')
  })

  it('merges inline style onto the wrapper without dropping computed sizing', () => {
    const card = render({ height: 72, style: { opacity: 0.5, marginTop: '8px' } })
    const wrapper = card.firstElementChild as HTMLElement
    // Caller-supplied styles applied.
    expect(wrapper.style.opacity).toBe('0.5')
    expect(wrapper.style.marginTop).toBe('8px')
    // Sizing computed from `height` still present.
    const { width } = expectedSize(72)
    expect(wrapper.style.width).toBe(`${width}px`)
  })

  it('caller can override computed sizing via the style prop (last-write-wins)', () => {
    const card = render({ height: 72, style: { width: '999px', height: '50px' } })
    const wrapper = card.firstElementChild as HTMLElement
    expect(wrapper.style.width).toBe('999px')
    expect(wrapper.style.height).toBe('50px')
  })
})
