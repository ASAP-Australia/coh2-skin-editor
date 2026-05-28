/**
 * Tests for Stagger — pre-editor screen entrance / exit animator.
 *
 * Two surfaces:
 *   1. `staggerDuration` — pure function the parent uses to time a follow-up
 *      action so the screen swap dovetails with the last child finishing.
 *      Table-driven tests pin the closed-form formula.
 *
 *   2. The Stagger component — wraps each visible child in a div with
 *      opacity + translateY transitions that fire after a per-index delay.
 *      We pin:
 *        • One wrapper div per child (and only one).
 *        • Enter mode: delay = initialDelay + i*step (top-down order).
 *        • Exit  mode: delay = initialDelay + (lastIdx - i)*step (reversed).
 *        • Exit  mode adds pointerEvents:none so clicks fall through.
 *        • Enter mode starts hidden (opacity 0, translateY = +drift) until
 *          the rAF two-frame trick flips `shown` to true.
 *        • Falsy children are filtered out so the index sequence is
 *          contiguous (parents don't have to deal with conditional gaps).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import Stagger, { staggerDuration } from '../Stagger'

// ── staggerDuration (pure) ───────────────────────────────────────────────────

describe('staggerDuration', () => {
  it('returns 0 for zero children', () => {
    expect(staggerDuration(0)).toBe(0)
  })

  it('returns 0 for negative child count (defensive)', () => {
    expect(staggerDuration(-3)).toBe(0)
  })

  it('default cadence: 1 child = duration only', () => {
    // (1 - 1)*140 + 680 = 680
    expect(staggerDuration(1)).toBe(680)
  })

  it('default cadence: 5 children = 4*step + duration', () => {
    // (5 - 1)*140 + 680 = 1240
    expect(staggerDuration(5)).toBe(1240)
  })

  it('custom step/duration/initialDelay compose linearly', () => {
    // 50 + (3-1)*100 + 200 = 450
    expect(staggerDuration(3, 100, 200, 50)).toBe(450)
  })

  it.each([
    [1, 100, 200, 0, 200],
    [2, 100, 200, 0, 300],
    [10, 100, 200, 0, 1100],
    [10, 100, 200, 50, 1150],
  ])('staggerDuration(%i, step=%i, dur=%i, init=%i) === %i', (n, s, d, i, expected) => {
    expect(staggerDuration(n, s, d, i)).toBe(expected)
  })
})

// ── Component ────────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(ui: React.ReactElement) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
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
  vi.restoreAllMocks()
})

/** Collect every immediate wrapper div Stagger emits — its children array
 *  becomes the top-level <div> nodes of the rendered fragment. */
function wrappers(el: HTMLElement): HTMLElement[] {
  return Array.from(el.children) as HTMLElement[]
}

describe('Stagger — enter mode', () => {
  it('wraps every child in one div (no extra DOM)', () => {
    const el = render(
      createElement(
        Stagger,
        { mode: 'enter' as const },
        createElement('h1', { key: 'h' }, 'Title'),
        createElement('button', { key: 'b' }, 'Go'),
      ),
    )
    expect(wrappers(el)).toHaveLength(2)
    expect(wrappers(el)[0].tagName).toBe('DIV')
    expect(wrappers(el)[0].firstElementChild?.tagName).toBe('H1')
    expect(wrappers(el)[1].firstElementChild?.tagName).toBe('BUTTON')
  })

  it('top-down delay: child i delay === initialDelay + i*step', () => {
    const el = render(
      createElement(
        Stagger,
        { mode: 'enter' as const, step: 100, duration: 300, initialDelay: 20 },
        createElement('span', { key: 'a' }, 'A'),
        createElement('span', { key: 'b' }, 'B'),
        createElement('span', { key: 'c' }, 'C'),
      ),
    )
    const ws = wrappers(el)
    // Expected transition: "opacity 300ms <ease> <delay>ms, transform …"
    // For enter, delay = 20 + 0*100, 20 + 1*100, 20 + 2*100 = 20, 120, 220ms
    expect(ws[0].style.transition).toContain('20ms,')
    expect(ws[1].style.transition).toContain('120ms,')
    expect(ws[2].style.transition).toContain('220ms,')
  })

  it('starts hidden (opacity 0 + translateY at +drift) before rAF fires', () => {
    // jsdom does not run requestAnimationFrame callbacks synchronously,
    // so the initial render captures the hidden state.
    const el = render(
      createElement(
        Stagger,
        { mode: 'enter' as const, drift: 12 },
        createElement('span', { key: 'a' }, 'A'),
      ),
    )
    const w = wrappers(el)[0]
    expect(w.style.opacity).toBe('0')
    expect(w.style.transform).toBe('translateY(12px)')
  })

  it('enter mode does NOT set pointerEvents:none (interactive on arrival)', () => {
    const el = render(
      createElement(Stagger, { mode: 'enter' as const }, createElement('span', { key: 'a' }, 'A')),
    )
    expect(wrappers(el)[0].style.pointerEvents).toBe('')
  })
})

describe('Stagger — exit mode', () => {
  it('reverses the stagger: child 0 has the LONGEST delay, last child has 0', () => {
    const el = render(
      createElement(
        Stagger,
        { mode: 'exit' as const, step: 100, duration: 300, initialDelay: 0 },
        createElement('span', { key: 'a' }, 'A'),
        createElement('span', { key: 'b' }, 'B'),
        createElement('span', { key: 'c' }, 'C'),
      ),
    )
    const ws = wrappers(el)
    // lastIdx = 2; exit order = (2 - i). Delays: child0 = 200ms,
    // child1 = 100ms, child2 = 0ms.
    expect(ws[0].style.transition).toContain('200ms,')
    expect(ws[1].style.transition).toContain('100ms,')
    expect(ws[2].style.transition).toContain('0ms,')
  })

  it('exit mode sets pointerEvents:none on every wrapper', () => {
    const el = render(
      createElement(
        Stagger,
        { mode: 'exit' as const },
        createElement('span', { key: 'a' }, 'A'),
        createElement('span', { key: 'b' }, 'B'),
      ),
    )
    for (const w of wrappers(el)) {
      expect(w.style.pointerEvents).toBe('none')
    }
  })

  it('starts visible (opacity 1, translateY 0) before rAF flips exiting=true', () => {
    const el = render(
      createElement(
        Stagger,
        { mode: 'exit' as const, drift: 8 },
        createElement('span', { key: 'a' }, 'A'),
      ),
    )
    const w = wrappers(el)[0]
    expect(w.style.opacity).toBe('1')
    expect(w.style.transform).toBe('translateY(0px)')
  })
})

describe('Stagger — children filtering', () => {
  it('falsy children (null / undefined / false) are stripped — index sequence stays contiguous', () => {
    const el = render(
      createElement(
        Stagger,
        { mode: 'enter' as const, step: 100, duration: 300 },
        null,
        createElement('span', { key: 'a' }, 'A'),
        false,
        createElement('span', { key: 'b' }, 'B'),
      ),
    )
    const ws = wrappers(el)
    // Two visible children → exactly two wrapper divs, no gaps.
    expect(ws).toHaveLength(2)
    // And both spans came through in order.
    expect(ws[0].firstElementChild?.textContent).toBe('A')
    expect(ws[1].firstElementChild?.textContent).toBe('B')
  })
})
