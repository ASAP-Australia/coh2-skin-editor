/**
 * Tests for HexColorInput (parseColor pure function + component behaviour).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import HexColorInput from '../editor-primitives/HexColorInput'
import { parseColor } from '../editor-primitives/parse-color'

// ── parseColor — table-driven ─────────────────────────────────────────────────

describe('parseColor', () => {
  const valid: Array<[string, string]> = [
    // 3-digit hex
    ['#f00', '#ff0000'],
    ['#abc', '#aabbcc'],
    // 6-digit hex
    ['#aabbcc', '#aabbcc'],
    ['#AABBCC', '#aabbcc'],
    ['#123456', '#123456'],
    // 8-digit hex (alpha)
    ['#aabbccff', '#aabbccff'],
    ['#00000080', '#00000080'],
    // rgb()
    ['rgb(255, 0, 0)', '#ff0000'],
    ['rgb(0,128,255)', '#0080ff'],
    // rgba()
    ['rgba(0,0,0,1)', '#000000ff'],
    ['rgba(255,255,255,0.5)', '#ffffff80'],
    // hsl()
    ['hsl(0, 100%, 50%)', '#ff0000'],
    ['hsl(120, 100%, 50%)', '#00ff00'],
    // hsla()
    ['hsla(240, 100%, 50%, 1)', '#0000ffff'],
    ['hsla(0, 0%, 100%, 0)', '#ffffff00'],
  ]

  it.each(valid)('parseColor(%s) === %s', (input, expected) => {
    expect(parseColor(input)).toBe(expected)
  })

  const invalid = [
    '',
    'red',
    '#gg0000',
    '#12345', // 5-digit
    'rgb(300,0,0)', // channel out of range
    'rgba(0,0,0,2)', // alpha out of range
    'hsl(400,50%,50%)', // hue out of range
    'notacolor',
  ]

  it.each(invalid)('parseColor(%s) returns null', input => {
    expect(parseColor(input)).toBeNull()
  })
})

// ── Component render tests ───────────────────────────────────────────────────

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

describe('HexColorInput component', () => {
  it('renders the given value in the text input', () => {
    const el = render(createElement(HexColorInput, { value: '#ff0000', onChange: vi.fn() }))
    const input = el.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('#ff0000')
  })

  it('renders the optional label', () => {
    const el = render(
      createElement(HexColorInput, { value: '#ffffff', onChange: vi.fn(), label: 'Background' }),
    )
    expect(el.textContent).toContain('Background')
  })

  it('renders a swatch button with the given colour as background', () => {
    const el = render(createElement(HexColorInput, { value: '#336699', onChange: vi.fn() }))
    const swatch = el.querySelector('button[aria-label="Open colour picker"]') as HTMLButtonElement
    expect(swatch).not.toBeNull()
    // jsdom normalises hex to rgb() — check that some colour is set
    expect(swatch.style.background.length).toBeGreaterThan(0)
  })

  it('clicking the swatch triggers the hidden color input click', () => {
    const el = render(createElement(HexColorInput, { value: '#ffffff', onChange: vi.fn() }))
    const colorInput = el.querySelector('input[type="color"]') as HTMLInputElement
    const clickSpy = vi.spyOn(colorInput, 'click')
    const swatch = el.querySelector('button[aria-label="Open colour picker"]') as HTMLButtonElement
    act(() => {
      swatch.click()
    })
    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('committing valid text via Enter calls onChange with normalised hex', () => {
    const onChange = vi.fn()
    const el = render(createElement(HexColorInput, { value: '#000000', onChange }))
    const input = el.querySelector('input[type="text"]') as HTMLInputElement
    act(() => {
      // Simulate the user having typed a value (React reads e.target.value in onKeyDown)
      Object.defineProperty(input, 'value', {
        writable: true,
        configurable: true,
        value: 'rgb(0,255,0)',
      })
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('#00ff00')
  })

  it('invalid text via Enter does not call onChange', () => {
    const onChange = vi.fn()
    const el = render(createElement(HexColorInput, { value: '#000000', onChange }))
    const input = el.querySelector('input[type="text"]') as HTMLInputElement
    act(() => {
      Object.defineProperty(input, 'value', {
        writable: true,
        configurable: true,
        value: 'notacolor',
      })
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
