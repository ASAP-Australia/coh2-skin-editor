/**
 * Unit tests for GradientFillEditor — the inline gradient-fill editor used
 * in the Shapes peel.
 *
 * Uses React 19 createRoot + act. No @testing-library/react.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import GradientFillEditor from '../editor-primitives/GradientFillEditor'
import type { GradientFill } from '@/lib/faceplate-project'

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

/** A controlled wrapper so we can observe state changes in tests. */
function Controlled({ initial }: { initial: GradientFill | undefined }) {
  const [value, setValue] = useState<GradientFill | undefined>(initial)
  return createElement(GradientFillEditor, { value, onChange: setValue })
}

const defaultLinear: GradientFill = {
  kind: 'linear',
  angle: 90,
  stops: [
    { color: '#ffffff', position: 0 },
    { color: '#000000', position: 1 },
  ],
}

describe('GradientFillEditor', () => {
  it('renders with data-testid="gradient-fill-editor"', () => {
    const el = render(createElement(GradientFillEditor, { value: undefined, onChange: vi.fn() }))
    expect(el.querySelector('[data-testid="gradient-fill-editor"]')).not.toBeNull()
  })

  it('shows the gradient preview swatch (aria-label="Gradient preview")', () => {
    const el = render(
      createElement(GradientFillEditor, { value: defaultLinear, onChange: vi.fn() }),
    )
    const swatch = el.querySelector('[aria-label="Gradient preview"]')
    expect(swatch).not.toBeNull()
  })

  it('kind toggle shows Linear and Radial buttons', () => {
    const el = render(createElement(GradientFillEditor, { value: undefined, onChange: vi.fn() }))
    const buttons = Array.from(el.querySelectorAll('button')).map(b => b.textContent?.trim())
    expect(buttons).toContain('Linear')
    expect(buttons).toContain('Radial')
  })

  it('angle slider is visible when kind=linear', () => {
    const el = render(
      createElement(GradientFillEditor, { value: defaultLinear, onChange: vi.fn() }),
    )
    // SliderRow for Angle should be present
    expect(el.textContent).toContain('Angle')
  })

  it('angle slider is NOT visible when kind=radial', () => {
    const radialGradient: GradientFill = {
      kind: 'radial',
      stops: [
        { color: '#ffffff', position: 0 },
        { color: '#000000', position: 1 },
      ],
    }
    const el = render(
      createElement(GradientFillEditor, { value: radialGradient, onChange: vi.fn() }),
    )
    expect(el.textContent).not.toContain('Angle')
  })

  it('clicking Radial button initialises a radial gradient when value was undefined', () => {
    const onChange = vi.fn()
    const el = render(createElement(GradientFillEditor, { value: undefined, onChange }))
    const radialBtn = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Radial',
    ) as HTMLButtonElement
    act(() => {
      radialBtn.click()
    })
    expect(onChange).toHaveBeenCalledOnce()
    const next = onChange.mock.calls[0][0] as GradientFill
    expect(next.kind).toBe('radial')
    expect(next.stops.length).toBeGreaterThanOrEqual(2)
  })

  it('Add stop button adds a stop (2 → 3)', () => {
    const el = render(createElement(Controlled, { initial: defaultLinear }))
    const addBtn = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.trim() === '+ Add stop',
    ) as HTMLButtonElement
    expect(addBtn).not.toBeNull()
    act(() => {
      addBtn.click()
    })
    // Should now show 3 remove-stop buttons (one per stop)
    const removeBtns = Array.from(el.querySelectorAll('button')).filter(b =>
      b.getAttribute('aria-label')?.startsWith('Remove stop'),
    )
    expect(removeBtns.length).toBe(3)
  })

  it('remove-stop button removes a stop (3 → 2)', () => {
    const threeStops: GradientFill = {
      kind: 'linear',
      angle: 90,
      stops: [
        { color: '#ffffff', position: 0 },
        { color: '#888888', position: 0.5 },
        { color: '#000000', position: 1 },
      ],
    }
    const el = render(createElement(Controlled, { initial: threeStops }))
    const removeBtn = el.querySelector('[aria-label="Remove stop 2"]') as HTMLButtonElement
    expect(removeBtn).not.toBeNull()
    act(() => {
      removeBtn.click()
    })
    const removeBtns = Array.from(el.querySelectorAll('button')).filter(b =>
      b.getAttribute('aria-label')?.startsWith('Remove stop'),
    )
    expect(removeBtns.length).toBe(2)
  })

  it('remove-stop is disabled when only 2 stops remain', () => {
    const el = render(
      createElement(GradientFillEditor, { value: defaultLinear, onChange: vi.fn() }),
    )
    const removeBtns = Array.from(el.querySelectorAll('button')).filter(b =>
      b.getAttribute('aria-label')?.startsWith('Remove stop'),
    ) as HTMLButtonElement[]
    expect(removeBtns.length).toBe(2)
    for (const btn of removeBtns) {
      expect(btn.disabled).toBe(true)
    }
  })

  it('Clear button calls onChange(undefined)', () => {
    const onChange = vi.fn()
    const el = render(createElement(GradientFillEditor, { value: defaultLinear, onChange }))
    const clearBtn = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Clear gradient',
    ) as HTMLButtonElement
    expect(clearBtn).not.toBeNull()
    act(() => {
      clearBtn.click()
    })
    expect(onChange).toHaveBeenCalledWith(undefined)
  })
})
