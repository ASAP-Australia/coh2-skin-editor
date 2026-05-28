/**
 * EditTextureButton — pinned contract for the bottom-row "Edit texture"
 * pill that the user requested at bedtime as the entry point for direct
 * 3D-model texture painting.
 *
 * Pinned here:
 *   1. The pill carries a stable `data-testid="edit-texture-pill"` so the
 *      rest of the editor (and downstream e2e suites) can find it without
 *      coupling to copy.
 *   2. Label flips between "Edit texture" (idle) and "Editing texture"
 *      (active) so the user always knows which mode they are in.
 *   3. `aria-pressed` mirrors `brushOn` exactly — a screen reader user
 *      hears the toggle state, not just the label change.
 *   4. `disabled` halts clicks and applies the standard greyed-out style.
 *   5. The component is presentational — the parent owns the actual
 *      state-flip side effect (open brush panel + enable brush + clear
 *      symmetric flag). The pill just calls `onClick` exactly once per
 *      user click.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import EditTextureButton from '../EditTextureButton'

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  brushOn?: boolean
  disabled?: boolean
  onClick?: () => void
}

function render(props: RenderProps = {}): HTMLDivElement {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  const merged = {
    brushOn: props.brushOn ?? false,
    disabled: props.disabled ?? false,
    onClick: props.onClick ?? (() => {}),
  }
  act(() => {
    root!.render(createElement(EditTextureButton, merged))
  })
  return container
}

function pill(): HTMLButtonElement {
  const el = container!.querySelector(
    '[data-testid="edit-texture-pill"]',
  ) as HTMLButtonElement | null
  if (!el) throw new Error('Edit-texture pill not found')
  return el
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

describe('EditTextureButton — idle state', () => {
  it('renders with the idle label and aria-pressed=false', () => {
    render({ brushOn: false })
    expect(pill().textContent).toContain('Edit texture')
    expect(pill().textContent).not.toContain('Editing texture')
    expect(pill().getAttribute('aria-pressed')).toBe('false')
  })

  it('aria-label and title describe the entry action, not the exit action', () => {
    render({ brushOn: false })
    expect(pill().getAttribute('aria-label')).toBe('Edit vehicle texture')
    expect(pill().getAttribute('title')).toMatch(/Edit the vehicle texture/)
  })
})

describe('EditTextureButton — active (brushOn) state', () => {
  it('renders with the active label and aria-pressed=true', () => {
    render({ brushOn: true })
    expect(pill().textContent).toContain('Editing texture')
    expect(pill().getAttribute('aria-pressed')).toBe('true')
  })

  it('aria-label and title flip to describe the exit action', () => {
    render({ brushOn: true })
    expect(pill().getAttribute('aria-label')).toBe('Exit texture-edit mode')
    expect(pill().getAttribute('title')).toMatch(/Exit texture-edit mode/)
  })
})

describe('EditTextureButton — onClick', () => {
  it('fires onClick exactly once per click', () => {
    const onClick = vi.fn()
    render({ onClick })
    act(() => pill().click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onClick when disabled', () => {
    const onClick = vi.fn()
    render({ onClick, disabled: true })
    expect(pill().disabled).toBe(true)
    act(() => pill().click())
    expect(onClick).not.toHaveBeenCalled()
  })
})
