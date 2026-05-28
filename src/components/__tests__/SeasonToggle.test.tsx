/**
 * Tests for SeasonToggle — the segmented Summer / Winter control above
 * the bottom-center VehicleMenu.
 *
 * Pinned contract:
 *   1. Two segments render with labels "Summer" and "Winter".
 *   2. The segment matching `value` has aria-pressed=true; the other false.
 *   3. Clicking the inactive segment calls onChange with the *other* value.
 *   4. Clicking the already-active segment still calls onChange — parent
 *      decides whether to no-op (we keep the component stateless).
 *   5. The `loading` prop is forwarded to LoadingBorder (active="" attr
 *      flips). We just verify the prop doesn't crash and the segments
 *      still respond — the LoadingBorder visual is its own contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import SeasonToggle from '../SeasonToggle'

// LoadingBorder reads `window.matchMedia('(prefers-reduced-motion: reduce)')`
// when active=true to decide whether to suppress its animation. jsdom does
// not provide matchMedia, so stub it before each test.
beforeEach(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }
})

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

function findSegment(el: HTMLElement, label: 'Summer' | 'Winter'): HTMLButtonElement {
  const seg = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes(label))
  if (!seg) throw new Error(`SeasonToggle: ${label} segment not rendered`)
  return seg
}

describe('SeasonToggle — render', () => {
  it('renders two segments labelled Summer and Winter', () => {
    const el = render(createElement(SeasonToggle, { value: 'summer', onChange: vi.fn() }))
    expect(findSegment(el, 'Summer')).toBeTruthy()
    expect(findSegment(el, 'Winter')).toBeTruthy()
  })

  it('value=summer: Summer aria-pressed=true, Winter=false', () => {
    const el = render(createElement(SeasonToggle, { value: 'summer', onChange: vi.fn() }))
    expect(findSegment(el, 'Summer').getAttribute('aria-pressed')).toBe('true')
    expect(findSegment(el, 'Winter').getAttribute('aria-pressed')).toBe('false')
  })

  it('value=winter: Winter aria-pressed=true, Summer=false', () => {
    const el = render(createElement(SeasonToggle, { value: 'winter', onChange: vi.fn() }))
    expect(findSegment(el, 'Winter').getAttribute('aria-pressed')).toBe('true')
    expect(findSegment(el, 'Summer').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('SeasonToggle — onChange', () => {
  it('clicking inactive Winter from value=summer fires onChange("winter")', () => {
    const onChange = vi.fn()
    const el = render(createElement(SeasonToggle, { value: 'summer', onChange }))
    act(() => {
      findSegment(el, 'Winter').click()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('winter')
  })

  it('clicking inactive Summer from value=winter fires onChange("summer")', () => {
    const onChange = vi.fn()
    const el = render(createElement(SeasonToggle, { value: 'winter', onChange }))
    act(() => {
      findSegment(el, 'Summer').click()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('summer')
  })

  it('clicking active segment still fires onChange (parent decides to no-op)', () => {
    const onChange = vi.fn()
    const el = render(createElement(SeasonToggle, { value: 'summer', onChange }))
    act(() => {
      findSegment(el, 'Summer').click()
    })
    expect(onChange).toHaveBeenCalledWith('summer')
  })
})

describe('SeasonToggle — loading prop', () => {
  it('loading=true does not break interaction', () => {
    const onChange = vi.fn()
    const el = render(createElement(SeasonToggle, { value: 'summer', onChange, loading: true }))
    act(() => {
      findSegment(el, 'Winter').click()
    })
    expect(onChange).toHaveBeenCalledWith('winter')
  })

  it('loading default (omitted) renders without crashing', () => {
    expect(() =>
      render(createElement(SeasonToggle, { value: 'summer', onChange: vi.fn() })),
    ).not.toThrow()
  })
})
