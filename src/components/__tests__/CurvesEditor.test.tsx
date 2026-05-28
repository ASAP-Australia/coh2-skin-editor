/**
 * Unit tests for CurvesEditor — the Tone Presets modal opened from the
 * AdjustmentPanel's "Curves…" button.
 *
 * Uses React 19 createRoot + act. No @testing-library/react — matches the
 * existing test pattern in BlendModeSelect.test.tsx.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import CurvesEditor from '../editor-primitives/CurvesEditor'

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

describe('CurvesEditor', () => {
  it('renders the curves-editor data-testid wrapper', () => {
    const el = render(
      createElement(CurvesEditor, {
        filters: undefined,
        onApply: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    expect(el.querySelector('[data-testid="curves-editor"]')).not.toBeNull()
  })

  it('renders all six preset cards with unique data-testids', () => {
    const expectedIds = [
      'linear',
      'brighten-highlights',
      'darken-shadows',
      'punch-contrast',
      'faded',
      'cinematic',
    ]
    const el = render(
      createElement(CurvesEditor, {
        filters: undefined,
        onApply: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    for (const id of expectedIds) {
      const card = el.querySelector(`[data-testid="curves-preset-${id}"]`)
      expect(card, `missing curves-preset-${id}`).not.toBeNull()
    }
  })

  it('clicking Apply on a preset calls onApply with brightness + contrast and then onClose', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const el = render(
      createElement(CurvesEditor, {
        filters: undefined,
        onApply,
        onClose,
      }),
    )
    const linearApply = el.querySelector(
      '[data-testid="curves-preset-linear-apply"]',
    ) as HTMLButtonElement
    expect(linearApply).not.toBeNull()
    act(() => {
      linearApply.click()
    })
    expect(onApply).toHaveBeenCalledOnce()
    // Linear preset: brightness=1, contrast=1
    expect(onApply).toHaveBeenCalledWith({ brightness: 1, contrast: 1 })
    // onClose fires immediately after Apply.
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Cancel button calls onClose without calling onApply', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const el = render(
      createElement(CurvesEditor, {
        filters: undefined,
        onApply,
        onClose,
      }),
    )
    const cancelBtn = el.querySelector('[data-testid="curves-cancel"]') as HTMLButtonElement
    expect(cancelBtn).not.toBeNull()
    act(() => {
      cancelBtn.click()
    })
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape key closes the modal without calling onApply', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      createElement(CurvesEditor, {
        filters: undefined,
        onApply,
        onClose,
      }),
    )
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('applying Punch Contrast preset calls onApply with contrast > 1', () => {
    const onApply = vi.fn()
    const el = render(
      createElement(CurvesEditor, {
        filters: undefined,
        onApply,
        onClose: vi.fn(),
      }),
    )
    const applyBtn = el.querySelector(
      '[data-testid="curves-preset-punch-contrast-apply"]',
    ) as HTMLButtonElement
    act(() => {
      applyBtn.click()
    })
    expect(onApply).toHaveBeenCalledOnce()
    const call = onApply.mock.calls[0][0] as { brightness: number; contrast: number }
    expect(call.contrast).toBeGreaterThan(1)
  })
})
