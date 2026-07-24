/**
 * TransformInputsRow — component-level tests for B5 Escape-reverts-draft fix.
 *
 * Pins:
 *   1. Typing then pressing Escape reverts the W input draft to null and does
 *      NOT call onChangeW (zero commits). The escapedRef flag blocks onBlur.
 *   2. Typing then pressing Enter commits the new value (one call).
 *   3. The component renders five number inputs (X, Y, W, H, angle).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import TransformInputsRow from '../editor-shared/TransformInputsRow'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(ui: React.ReactElement) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => { root!.render(ui) })
}

afterEach(() => {
  if (root) { act(() => { root!.unmount() }); root = null }
  if (container) { container.remove(); container = null }
})

function getWInput(): HTMLInputElement {
  // Order: X(0), Y(1), W(2), H(3), °(4)
  return container!.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]
}

describe('TransformInputsRow — Escape reverts draft (B5)', () => {
  it('renders five number inputs (X, Y, W, H, angle)', () => {
    render(createElement(TransformInputsRow, {
      x: 10, y: 20, w: 80, h: 100, angle: 0,
      onChangeX: vi.fn(), onChangeY: vi.fn(),
      onChangeW: vi.fn(), onChangeH: vi.fn(), onChangeAngle: vi.fn(),
    }))
    const inputs = container!.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs).toHaveLength(5)
  })

  it('Escape after typing: zero commits, draft cleared (escapedRef blocks blur)', () => {
    const onChangeW = vi.fn()
    render(createElement(TransformInputsRow, {
      x: 0, y: 0, w: 80, h: 100, angle: 0,
      onChangeX: vi.fn(), onChangeY: vi.fn(),
      onChangeW,
      onChangeH: vi.fn(), onChangeAngle: vi.fn(),
    }))

    const wInput = getWInput()

    // Simulate typing a new value into the input (sets React draft state)
    act(() => {
      // React synthetic 'change' via nativeInputValueSetter
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      )?.set
      nativeInputValueSetter?.call(wInput, '50')
      wInput.dispatchEvent(new Event('input', { bubbles: true }))
      wInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Press Escape — should set escapedRef and clear draft, then trigger blur
    act(() => {
      wInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })

    // Blur fires after Escape — should be suppressed by escapedRef
    act(() => {
      wInput.dispatchEvent(new Event('blur', { bubbles: true }))
    })

    // onChangeW must NOT have been called
    expect(onChangeW).not.toHaveBeenCalled()
  })

  it('Enter after typing commits the new value (one call)', () => {
    const onChangeW = vi.fn()
    render(createElement(TransformInputsRow, {
      x: 0, y: 0, w: 80, h: 100, angle: 0,
      onChangeX: vi.fn(), onChangeY: vi.fn(),
      onChangeW,
      onChangeH: vi.fn(), onChangeAngle: vi.fn(),
    }))

    const wInput = getWInput()

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      )?.set
      nativeInputValueSetter?.call(wInput, '50')
      wInput.dispatchEvent(new Event('input', { bubbles: true }))
      wInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    act(() => {
      wInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })

    expect(onChangeW).toHaveBeenCalledTimes(1)
    expect(onChangeW).toHaveBeenCalledWith(50)
  })
})
