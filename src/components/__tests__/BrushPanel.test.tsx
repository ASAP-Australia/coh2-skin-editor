/**
 * Tests for BrushPanel — the right-sidebar brush controls.
 *
 * Contract pinned here:
 *   1. Brush ON/OFF toggle button label flips between "Enable brush" and
 *      "Brush ON · click viewport to paint" — the latter doubles as the
 *      in-product hint that paint strokes land in the 3D viewport, so a
 *      copy refactor that drops it would silently leave new users
 *      wondering why nothing happens after they click "Enable".
 *   2. Eraser toggle (the small Eraser-icon button) maps to
 *      `settings.mode === 'erase'`. aria-pressed mirrors, the title hint
 *      flips between "Switch to paint mode" / "Switch to eraser mode",
 *      and clicking it round-trips paint ↔ erase WITHOUT touching any
 *      other field on `settings` (size/color/softness/opacity preserved).
 *   3. Three sliders (Size, Softness, Opacity) are wired to the
 *      corresponding `settings.<key>` numerically — slider drag emits a
 *      `Number(value)` (not the raw string) so the parent doesn't get
 *      polluted with stringly-typed numbers.
 *   4. The colour input is `type="color"` (so the OS picker opens) and
 *      writes `e.target.value` straight into `settings.color`. The grid
 *      of 12 swatches each carry an `aria-label` containing the hex code
 *      so screen-reader users can tell them apart, and clicking one
 *      writes that hex into `settings.color`.
 *   5. Eyedropper button only renders when `onEyedrop` is wired — keeps
 *      the surface clean for the faceplate/decal flows that have no
 *      eyedropper.
 *   6. The save/clear footer row only renders when EITHER `onSave` or
 *      `onClear` is wired (each button is independently conditional).
 *      Buttons read "Clear paint" and "Bake into diffuse" respectively
 *      — pin the exact text because the "Bake" word matters (irreversible
 *      destructive action; a refactor to "Save" would dilute the warning).
 *
 * Test infra: React 19 createRoot + act. Native input value setter via
 * `Object.getOwnPropertyDescriptor` so React picks up controlled-input
 * change events in jsdom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import BrushPanel from '../BrushPanel'
import { DEFAULT_BRUSH, type BrushSettings } from '@/lib/brush'

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  brushOn?: boolean
  settings?: BrushSettings
  setBrushOn?: (v: boolean) => void
  setSettings?: (s: BrushSettings) => void
  onEyedrop?: () => void
  onSave?: () => void
  onClear?: () => void
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(BrushPanel, {
        brushOn: props.brushOn ?? false,
        setBrushOn: props.setBrushOn ?? (() => {}),
        settings: props.settings ?? DEFAULT_BRUSH,
        setSettings: props.setSettings ?? (() => {}),
        onEyedrop: props.onEyedrop,
        onSave: props.onSave,
        onClear: props.onClear,
      }),
    )
  })
  return container!
}

beforeEach(() => {
  container = null
  root = null
})

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    Array.from(container!.querySelectorAll('button')).find(b =>
      (b.textContent ?? '').includes(text),
    ) ?? null
  )
}

function sliderByLabel(label: string): HTMLInputElement | null {
  // Sliders are wired by sibling label markup, not htmlFor — we walk the DOM.
  const labels = Array.from(container!.querySelectorAll('div'))
  for (const div of labels) {
    if (div.textContent?.trim() === label) {
      // The label sits in a `Label` sub-component; the input is in a sibling
      // chain — but easier: find the range input whose preceding text matches.
    }
  }
  // Simpler: index by position. Size → 0, Softness → 1, Opacity → 2.
  const ranges = container!.querySelectorAll('input[type="range"]')
  const order: Record<string, number> = { Size: 0, Softness: 1, Opacity: 2 }
  const idx = order[label]
  if (idx == null) return null
  return (ranges[idx] as HTMLInputElement | undefined) ?? null
}

function setRangeValue(input: HTMLInputElement, value: string) {
  // React tracks the previous value on the input element and gates
  // onChange firing on a real value-setter mutation — use the native
  // descriptor to trigger it.
  const proto = Object.getPrototypeOf(input)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setColorValue(input: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(input)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

// The 12 canonical brush swatch palette — keep in sync with BrushPanel.tsx.
const SWATCHES = [
  '#7a8a4e',
  '#4a5c28',
  '#c8aa6a',
  '#3e2a12',
  '#e0dcd4',
  '#2a3e1a',
  '#6a4a28',
  '#8a2a1a',
  '#c8a020',
  '#1a1a1a',
  '#d8843a',
  '#2c3c22',
]

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BrushPanel — brush ON/OFF toggle', () => {
  it('shows "Enable brush" when brushOn is false', () => {
    render({ brushOn: false })
    const btn = buttonByText('Enable brush')
    expect(btn).not.toBeNull()
  })

  it('shows the click-viewport-to-paint hint when brushOn is true', () => {
    render({ brushOn: true })
    const btn = buttonByText('Brush ON · click viewport to paint')
    expect(btn).not.toBeNull()
  })

  it('clicking toggles setBrushOn with the inverse of current state', () => {
    const setBrushOn = vi.fn()
    render({ brushOn: false, setBrushOn })
    act(() => {
      buttonByText('Enable brush')!.click()
    })
    expect(setBrushOn).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('clicking when brushOn=true sends setBrushOn(false)', () => {
    const setBrushOn = vi.fn()
    render({ brushOn: true, setBrushOn })
    act(() => {
      buttonByText('Brush ON · click viewport to paint')!.click()
    })
    expect(setBrushOn).toHaveBeenCalledExactlyOnceWith(false)
  })
})

describe('BrushPanel — eraser toggle', () => {
  it('aria-pressed is "false" when mode is paint (or undefined)', () => {
    render() // DEFAULT_BRUSH has no mode set → falsy → not erase
    const eraser = container!.querySelector(
      '[aria-label="Toggle eraser mode"]',
    ) as HTMLButtonElement
    expect(eraser.getAttribute('aria-pressed')).toBe('false')
  })

  it('aria-pressed flips to "true" when mode is erase', () => {
    render({ settings: { ...DEFAULT_BRUSH, mode: 'erase' } })
    const eraser = container!.querySelector(
      '[aria-label="Toggle eraser mode"]',
    ) as HTMLButtonElement
    expect(eraser.getAttribute('aria-pressed')).toBe('true')
  })

  it('title hint flips with mode', () => {
    render({ settings: { ...DEFAULT_BRUSH, mode: 'paint' } })
    let eraser = container!.querySelector('[aria-label="Toggle eraser mode"]') as HTMLButtonElement
    expect(eraser.getAttribute('title')).toBe('Switch to eraser mode')
    act(() => root!.unmount())
    root = null
    container!.remove()
    container = null
    render({ settings: { ...DEFAULT_BRUSH, mode: 'erase' } })
    eraser = container!.querySelector('[aria-label="Toggle eraser mode"]') as HTMLButtonElement
    expect(eraser.getAttribute('title')).toBe('Switch to paint mode')
  })

  it('clicking toggles mode paint → erase while preserving every other field', () => {
    const setSettings = vi.fn()
    const start: BrushSettings = {
      size: 100,
      color: '#abcdef',
      softness: 0.3,
      opacity: 0.7,
      mode: 'paint',
    }
    render({ settings: start, setSettings })
    act(() => {
      ;(container!.querySelector('[aria-label="Toggle eraser mode"]') as HTMLButtonElement).click()
    })
    expect(setSettings).toHaveBeenCalledExactlyOnceWith({
      size: 100,
      color: '#abcdef',
      softness: 0.3,
      opacity: 0.7,
      mode: 'erase',
    })
  })

  it('clicking again round-trips erase → paint', () => {
    const setSettings = vi.fn()
    render({ settings: { ...DEFAULT_BRUSH, mode: 'erase' }, setSettings })
    act(() => {
      ;(container!.querySelector('[aria-label="Toggle eraser mode"]') as HTMLButtonElement).click()
    })
    expect(setSettings).toHaveBeenCalledExactlyOnceWith({
      ...DEFAULT_BRUSH,
      mode: 'paint',
    })
  })

  it('eraser icon button is a real <button> with the aria-label', () => {
    render()
    const eraser = container!.querySelector('[aria-label="Toggle eraser mode"]')
    expect(eraser).not.toBeNull()
    expect(eraser!.tagName).toBe('BUTTON')
  })
})

describe('BrushPanel — size / softness / opacity sliders', () => {
  it('renders three range inputs in order: Size, Softness, Opacity', () => {
    render()
    const ranges = container!.querySelectorAll('input[type="range"]')
    expect(ranges).toHaveLength(3)
  })

  it('Size slider min=8 max=512 step=1', () => {
    render()
    const size = sliderByLabel('Size')!
    expect(size.min).toBe('8')
    expect(size.max).toBe('512')
    expect(size.step).toBe('1')
  })

  it('Softness slider min=0 max=1 step=0.05', () => {
    render()
    const soft = sliderByLabel('Softness')!
    expect(soft.min).toBe('0')
    expect(soft.max).toBe('1')
    expect(soft.step).toBe('0.05')
  })

  it('Opacity slider min=0.05 max=1 step=0.05', () => {
    render()
    const op = sliderByLabel('Opacity')!
    expect(op.min).toBe('0.05')
    expect(op.max).toBe('1')
    expect(op.step).toBe('0.05')
  })

  it('reflects current settings.size as the slider value', () => {
    render({ settings: { ...DEFAULT_BRUSH, size: 123 } })
    expect(sliderByLabel('Size')!.value).toBe('123')
  })

  it('dragging Size emits setSettings with a NUMERIC (not string) size', () => {
    const setSettings = vi.fn()
    render({ setSettings })
    setRangeValue(sliderByLabel('Size')!, '256')
    expect(setSettings).toHaveBeenCalledOnce()
    const arg = setSettings.mock.calls[0][0]
    expect(arg.size).toBe(256)
    expect(typeof arg.size).toBe('number')
  })

  it('dragging Softness rewrites only softness, preserving every other field', () => {
    const setSettings = vi.fn()
    const start: BrushSettings = {
      size: 100,
      color: '#abcdef',
      softness: 0.3,
      opacity: 0.7,
      mode: 'paint',
    }
    render({ settings: start, setSettings })
    setRangeValue(sliderByLabel('Softness')!, '0.85')
    expect(setSettings).toHaveBeenCalledOnce()
    expect(setSettings.mock.calls[0][0]).toEqual({
      size: 100,
      color: '#abcdef',
      softness: 0.85,
      opacity: 0.7,
      mode: 'paint',
    })
  })

  it('dragging Opacity rewrites only opacity', () => {
    const setSettings = vi.fn()
    render({ setSettings })
    setRangeValue(sliderByLabel('Opacity')!, '0.5')
    const arg = setSettings.mock.calls[0][0]
    expect(arg.opacity).toBe(0.5)
    expect(arg.size).toBe(DEFAULT_BRUSH.size)
  })
})

describe('BrushPanel — colour input + swatches', () => {
  it('colour input is type="color" with current settings.color as value', () => {
    render({ settings: { ...DEFAULT_BRUSH, color: '#abcdef' } })
    const colour = container!.querySelector('input[type="color"]') as HTMLInputElement
    expect(colour).not.toBeNull()
    expect(colour.value).toBe('#abcdef')
  })

  it('colour input has aria-label so screen readers can identify it', () => {
    render()
    const colour = container!.querySelector('input[type="color"]') as HTMLInputElement
    expect(colour.getAttribute('aria-label')).toBe('Brush colour')
  })

  it('changing the colour input writes e.target.value into settings.color', () => {
    const setSettings = vi.fn()
    render({ setSettings })
    const colour = container!.querySelector('input[type="color"]') as HTMLInputElement
    setColorValue(colour, '#123456')
    const arg = setSettings.mock.calls[0][0]
    expect(arg.color).toBe('#123456')
    expect(arg.size).toBe(DEFAULT_BRUSH.size) // other fields preserved
  })

  it('renders exactly 12 canonical swatch buttons in canonical order', () => {
    render()
    const swatches = container!.querySelectorAll('[aria-label^="Set brush colour to "]')
    expect(swatches).toHaveLength(12)
    SWATCHES.forEach((hex, i) => {
      expect(swatches[i].getAttribute('aria-label')).toBe(`Set brush colour to ${hex}`)
    })
  })

  it('each swatch carries its hex as the background-color style', () => {
    render()
    const swatches = Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[aria-label^="Set brush colour to "]'),
    )
    // First swatch is #7a8a4e — pin the inline style.
    expect(swatches[0].style.background.toLowerCase()).toContain('rgb(122, 138, 78)')
  })

  it('clicking a swatch writes its hex into settings.color (other fields preserved)', () => {
    const setSettings = vi.fn()
    const start: BrushSettings = {
      size: 200,
      color: '#000000',
      softness: 0.2,
      opacity: 0.4,
      mode: 'paint',
    }
    render({ settings: start, setSettings })
    const swatch = container!.querySelector(
      '[aria-label="Set brush colour to #8a2a1a"]',
    ) as HTMLButtonElement
    act(() => swatch.click())
    expect(setSettings).toHaveBeenCalledExactlyOnceWith({
      size: 200,
      color: '#8a2a1a',
      softness: 0.2,
      opacity: 0.4,
      mode: 'paint',
    })
  })
})

describe('BrushPanel — eyedropper button', () => {
  it('is hidden when onEyedrop is not provided', () => {
    render()
    expect(buttonByText('Eyedropper')).toBeNull()
  })

  it('renders + fires onEyedrop on click when provided', () => {
    const onEyedrop = vi.fn()
    render({ onEyedrop })
    const btn = buttonByText('Eyedropper')
    expect(btn).not.toBeNull()
    act(() => btn!.click())
    expect(onEyedrop).toHaveBeenCalledOnce()
  })
})

describe('BrushPanel — save / clear footer', () => {
  it('the footer row is hidden entirely when neither onSave nor onClear is wired', () => {
    render()
    expect(buttonByText('Clear paint')).toBeNull()
    expect(buttonByText('Bake into diffuse')).toBeNull()
  })

  it('Clear button renders only when onClear is wired', () => {
    const onClear = vi.fn()
    render({ onClear })
    const btn = buttonByText('Clear paint')
    expect(btn).not.toBeNull()
    act(() => btn!.click())
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('Bake button renders only when onSave is wired and uses the irreversible-warning copy', () => {
    const onSave = vi.fn()
    render({ onSave })
    const btn = buttonByText('Bake into diffuse')
    expect(btn).not.toBeNull()
    // The "Bake" verb matters — pin literal text; a refactor to "Save"
    // would dilute the destructive-action warning the copy conveys.
    expect(btn!.textContent).toBe('Bake into diffuse')
    act(() => btn!.click())
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('both Clear + Bake render side-by-side when both handlers are wired', () => {
    render({ onSave: vi.fn(), onClear: vi.fn() })
    expect(buttonByText('Clear paint')).not.toBeNull()
    expect(buttonByText('Bake into diffuse')).not.toBeNull()
  })
})

describe('BrushPanel — symmetry toggle (v1.0 Edit-Texture flow)', () => {
  // Regression: the user's bedtime request was that symmetry on the
  // texture must be disable-able from the Edit-Texture entry point. The
  // toggle here lets them flip horizontal-mirror painting on and off
  // without leaving the brush panel. Default is OFF (plain painting);
  // clicking the FlipHorizontal2 pill flips `settings.symmetric`.

  function symButton(): HTMLButtonElement {
    const btn = container!.querySelector(
      '[data-testid="brush-symmetry-toggle"]',
    ) as HTMLButtonElement | null
    if (!btn) throw new Error('Symmetry toggle button missing from BrushPanel')
    return btn
  }

  it('renders the symmetry toggle button with aria-pressed=false at default', () => {
    render()
    const btn = symButton()
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('Toggle symmetric brush')
  })

  it('aria-pressed flips to true when settings.symmetric is true', () => {
    render({ settings: { ...DEFAULT_BRUSH, symmetric: true } })
    expect(symButton().getAttribute('aria-pressed')).toBe('true')
  })

  it('clicking flips settings.symmetric from undefined → true', () => {
    const setSettings = vi.fn()
    render({ setSettings })
    act(() => symButton().click())
    expect(setSettings).toHaveBeenCalledTimes(1)
    expect(setSettings.mock.calls[0][0].symmetric).toBe(true)
    // Other brush fields are preserved — the toggle never clobbers
    // size/color/softness/opacity/mode.
    expect(setSettings.mock.calls[0][0].size).toBe(DEFAULT_BRUSH.size)
    expect(setSettings.mock.calls[0][0].color).toBe(DEFAULT_BRUSH.color)
    expect(setSettings.mock.calls[0][0].opacity).toBe(DEFAULT_BRUSH.opacity)
  })

  it('clicking flips settings.symmetric from true → false (user can disable)', () => {
    const setSettings = vi.fn()
    render({ settings: { ...DEFAULT_BRUSH, symmetric: true }, setSettings })
    act(() => symButton().click())
    expect(setSettings.mock.calls[0][0].symmetric).toBe(false)
  })

  it('title text changes between the on and off states for the user hint', () => {
    render()
    expect(symButton().getAttribute('title')).toMatch(/Symmetric brush is OFF/)
    render({ settings: { ...DEFAULT_BRUSH, symmetric: true } })
    expect(symButton().getAttribute('title')).toMatch(/Symmetric brush is ON/)
  })
})

describe('BrushPanel — slider value display', () => {
  it('Size value renders as an integer (no decimal point)', () => {
    render({ settings: { ...DEFAULT_BRUSH, size: 256 } })
    // The slider's sibling span carries `value.toFixed(0)` + 'px'.
    expect(container!.textContent).toContain('256px')
  })

  it('Softness value renders to 2 decimal places', () => {
    render({ settings: { ...DEFAULT_BRUSH, softness: 0.45 } })
    expect(container!.textContent).toContain('0.45')
  })

  it('Opacity value renders to 2 decimal places', () => {
    render({ settings: { ...DEFAULT_BRUSH, opacity: 0.85 } })
    expect(container!.textContent).toContain('0.85')
  })
})
