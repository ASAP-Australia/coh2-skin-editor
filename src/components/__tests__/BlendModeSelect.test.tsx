/**
 * Unit tests for BlendModeSelect — the native <select> for the 16 canvas
 * composite blend modes.
 *
 * Uses React 19 createRoot + act. No @testing-library/react — matches the
 * existing test pattern in other editor-primitives unit tests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import BlendModeSelect from '../editor-primitives/BlendModeSelect'
import { BLEND_MODES } from '@/lib/faceplate-project'

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

describe('BlendModeSelect', () => {
  it('renders all 16 BLEND_MODES as <option> elements', () => {
    const el = render(
      createElement(BlendModeSelect, {
        value: undefined,
        onChange: vi.fn(),
      }),
    )
    const select = el.querySelector('[data-testid="blend-mode-select"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    const options = Array.from(select.options).map(o => o.value)
    for (const mode of BLEND_MODES) {
      expect(options).toContain(mode)
    }
    expect(options.length).toBe(16)
  })

  it('value=undefined defaults the select to "normal"', () => {
    const el = render(
      createElement(BlendModeSelect, {
        value: undefined,
        onChange: vi.fn(),
      }),
    )
    const select = el.querySelector('[data-testid="blend-mode-select"]') as HTMLSelectElement
    expect(select.value).toBe('normal')
  })

  it('value="multiply" selects the Multiply option', () => {
    const el = render(
      createElement(BlendModeSelect, {
        value: 'multiply',
        onChange: vi.fn(),
      }),
    )
    const select = el.querySelector('[data-testid="blend-mode-select"]') as HTMLSelectElement
    expect(select.value).toBe('multiply')
    // Also verify the displayed label is "Multiply"
    const selectedOption = Array.from(select.options).find(o => o.selected)
    expect(selectedOption?.text).toBe('Multiply')
  })

  it('picking "normal" calls onChange(undefined) — identity-default convention', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(BlendModeSelect, {
        value: 'multiply',
        onChange,
      }),
    )
    const select = el.querySelector('[data-testid="blend-mode-select"]') as HTMLSelectElement
    act(() => {
      // Simulate user selecting 'normal'
      select.value = 'normal'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('picking "multiply" calls onChange("multiply")', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(BlendModeSelect, {
        value: undefined,
        onChange,
      }),
    )
    const select = el.querySelector('[data-testid="blend-mode-select"]') as HTMLSelectElement
    act(() => {
      select.value = 'multiply'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('multiply')
  })

  it('label prop renders the label text when not compact', () => {
    const el = render(
      createElement(BlendModeSelect, {
        value: undefined,
        onChange: vi.fn(),
        label: 'Blend mode',
        compact: false,
      }),
    )
    expect(el.textContent).toContain('Blend mode')
  })

  it('compact=true suppresses the label', () => {
    const el = render(
      createElement(BlendModeSelect, {
        value: undefined,
        onChange: vi.fn(),
        label: 'Blend mode',
        compact: true,
      }),
    )
    expect(el.textContent).not.toContain('Blend mode')
  })
})
