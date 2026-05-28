/**
 * Tests for ExplodeButton — the bottom-center pill that toggles the
 * "exploded view" in the 3D viewport.
 *
 * Pinned contract:
 *   1. Label flips between "Explode" (collapsed) and "Collapse" (exploded).
 *   2. `aria-label` mirrors the label flip with friendlier prose ("Explode
 *      vehicle into parts" / "Collapse exploded vehicle view").
 *   3. `title` carries the keyboard hint ("(E)") so users learn the shortcut.
 *   4. `aria-pressed` reflects the active prop.
 *   5. `disabled` prop disables the button.
 *   6. Click fires onClick once (and not when disabled).
 *   7. Renders a single <button type="button"> (not a non-button click target).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import ExplodeButton from '../ExplodeButton'

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

function btn(el: HTMLElement): HTMLButtonElement {
  const b = el.querySelector('button')
  if (!b) throw new Error('ExplodeButton did not render a button')
  return b
}

describe('ExplodeButton — label / aria flip', () => {
  it('inactive: label "Explode", aria-label "…into parts", title "(E)"', () => {
    const el = render(createElement(ExplodeButton, { active: false }))
    const b = btn(el)
    expect(b.textContent).toContain('Explode')
    expect(b.textContent).not.toContain('Collapse')
    expect(b.getAttribute('aria-label')).toBe('Explode vehicle into parts')
    expect(b.getAttribute('title')).toBe('Explode into parts (E)')
    expect(b.getAttribute('aria-pressed')).toBe('false')
  })

  it('active: label "Collapse", aria-label "…exploded view", title "(E)"', () => {
    const el = render(createElement(ExplodeButton, { active: true }))
    const b = btn(el)
    expect(b.textContent).toContain('Collapse')
    expect(b.textContent).not.toContain('Explode ') // word boundary
    expect(b.getAttribute('aria-label')).toBe('Collapse exploded vehicle view')
    expect(b.getAttribute('title')).toBe('Reassemble (E)')
    expect(b.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('ExplodeButton — click + disabled', () => {
  it('click fires onClick exactly once', () => {
    const onClick = vi.fn()
    const el = render(createElement(ExplodeButton, { active: false, onClick }))
    act(() => {
      btn(el).click()
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled prop disables the button', () => {
    const el = render(createElement(ExplodeButton, { active: false, disabled: true }))
    expect(btn(el).disabled).toBe(true)
  })

  it('disabled click does NOT fire onClick', () => {
    const onClick = vi.fn()
    const el = render(createElement(ExplodeButton, { active: false, onClick, disabled: true }))
    act(() => {
      btn(el).click()
    })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders type="button" (never accidentally form-submitting)', () => {
    const el = render(createElement(ExplodeButton, { active: false }))
    expect(btn(el).getAttribute('type')).toBe('button')
  })
})

describe('ExplodeButton — visual state', () => {
  it('active variant uses the warm "fired" tint background', () => {
    const el = render(createElement(ExplodeButton, { active: true }))
    // Active: "rgba(190, 90, 40, 0.62)" — check we got the warm-orange tint
    // rather than the dark inactive tint.
    expect(btn(el).style.background).toContain('190')
  })

  it('inactive variant uses the dark neutral glass tint', () => {
    const el = render(createElement(ExplodeButton, { active: false }))
    expect(btn(el).style.background).toContain('20, 22, 28')
  })
})
