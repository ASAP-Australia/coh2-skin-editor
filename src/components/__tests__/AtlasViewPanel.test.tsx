/**
 * Tests for AtlasViewPanel — the right-edge 3-mode picker shared by
 * FaceplateEditor and DecalPackEditor. The panel is the visual analogue
 * of `ScenePanel` (Vehicle Viewport scene preset picker); these tests pin:
 *
 *   - The three view modes are rendered in canonical order
 *     (template → checkerboard → in_game).
 *   - Active mode reflects via `aria-pressed="true"` and inactive via
 *     `aria-pressed="false"` (assistive-tech contract).
 *   - Clicking a button calls setMode with the right id and ONLY that id.
 *   - Tooltips include both label and description (the hover affordance
 *     that ScenePanel established).
 *   - aria-label override on the container is honoured.
 *   - data-mode is the canonical id (machine-readable hook for the e2e
 *     test suite).
 *
 * Uses React 19 createRoot + act. No @testing-library/react.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import AtlasViewPanel from '../AtlasViewPanel'
import { type AtlasViewMode, ATLAS_VIEW_MODE_LABEL } from '@/lib/atlas-view-settings'

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

describe('AtlasViewPanel — rendering', () => {
  it('renders two buttons, one per AtlasViewMode in ATLAS_VIEW_MODE_ORDER', () => {
    const el = render(createElement(AtlasViewPanel, { mode: 'template', setMode: () => {} }))
    const buttons = el.querySelectorAll('button[data-mode]')
    expect(buttons).toHaveLength(2)
  })

  it('renders buttons in canonical order: template → checkerboard', () => {
    const el = render(createElement(AtlasViewPanel, { mode: 'template', setMode: () => {} }))
    const modes = Array.from(el.querySelectorAll('button[data-mode]')).map(b =>
      b.getAttribute('data-mode'),
    )
    expect(modes).toEqual(['template', 'checkerboard'])
  })

  it('honours the ariaLabel prop on the container group', () => {
    const el = render(
      createElement(AtlasViewPanel, {
        mode: 'template',
        setMode: () => {},
        ariaLabel: 'Faceplate view mode',
      }),
    )
    const group = el.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBe('Faceplate view mode')
  })

  it('falls back to "View mode" when ariaLabel is omitted', () => {
    const el = render(createElement(AtlasViewPanel, { mode: 'template', setMode: () => {} }))
    const group = el.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBe('View mode')
  })

  it('tooltip combines label and description from ATLAS_VIEW_MODE_LABEL', () => {
    const el = render(createElement(AtlasViewPanel, { mode: 'template', setMode: () => {} }))
    const tpl = el.querySelector('button[data-mode="template"]')!
    const meta = ATLAS_VIEW_MODE_LABEL.template
    expect(tpl.getAttribute('title')).toBe(`${meta.label} — ${meta.description}`)
  })

  it('every button has its own aria-label matching the mode label', () => {
    const el = render(createElement(AtlasViewPanel, { mode: 'template', setMode: () => {} }))
    for (const id of ['template', 'checkerboard'] as const) {
      const btn = el.querySelector(`button[data-mode="${id}"]`)!
      expect(btn.getAttribute('aria-label')).toBe(ATLAS_VIEW_MODE_LABEL[id].label)
    }
  })
})

describe('AtlasViewPanel — active state', () => {
  it('aria-pressed="true" on the active mode, "false" on the rest', () => {
    const el = render(createElement(AtlasViewPanel, { mode: 'checkerboard', setMode: () => {} }))
    const active = el.querySelector('button[data-mode="checkerboard"]')!
    const inactive1 = el.querySelector('button[data-mode="template"]')!
    expect(active.getAttribute('aria-pressed')).toBe('true')
    expect(inactive1.getAttribute('aria-pressed')).toBe('false')
  })

  it('updates aria-pressed when the controlled mode prop changes', () => {
    const el = render(createElement(AtlasViewPanel, { mode: 'template', setMode: () => {} }))
    expect(el.querySelector('button[data-mode="template"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    act(() => {
      root!.render(createElement(AtlasViewPanel, { mode: 'checkerboard', setMode: () => {} }))
    })
    expect(el.querySelector('button[data-mode="template"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(el.querySelector('button[data-mode="checkerboard"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
  })
})

describe('AtlasViewPanel — click behaviour', () => {
  it('clicking a button calls setMode with that exact id and nothing else', () => {
    const setMode = vi.fn()
    const el = render(createElement(AtlasViewPanel, { mode: 'template', setMode }))
    act(() => {
      ;(el.querySelector('button[data-mode="checkerboard"]') as HTMLButtonElement).click()
    })
    expect(setMode).toHaveBeenCalledTimes(1)
    expect(setMode).toHaveBeenCalledWith('checkerboard')
  })

  it('clicking the currently-active button still emits (idempotent invocations are caller-controlled)', () => {
    const setMode = vi.fn()
    const el = render(createElement(AtlasViewPanel, { mode: 'checkerboard', setMode }))
    act(() => {
      ;(el.querySelector('button[data-mode="checkerboard"]') as HTMLButtonElement).click()
    })
    expect(setMode).toHaveBeenCalledTimes(1)
    expect(setMode).toHaveBeenCalledWith('checkerboard')
  })

  it('end-to-end: stateful wrapper transitions through every mode via clicks', () => {
    function Wrapper() {
      const [mode, setMode] = useState<AtlasViewMode>('template')
      return createElement(AtlasViewPanel, { mode, setMode })
    }
    const el = render(createElement(Wrapper, null))
    expect(el.querySelector('button[data-mode="template"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    act(() => {
      ;(el.querySelector('button[data-mode="checkerboard"]') as HTMLButtonElement).click()
    })
    expect(el.querySelector('button[data-mode="checkerboard"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    act(() => {
      ;(el.querySelector('button[data-mode="template"]') as HTMLButtonElement).click()
    })
    expect(el.querySelector('button[data-mode="template"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
  })
})
