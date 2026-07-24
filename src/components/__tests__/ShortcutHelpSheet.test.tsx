/**
 * Tests for ShortcutHelpSheet — the press-and-hold "?" cheat sheet.
 *
 * The whole component is a global keydown listener + a dialog. The
 * contract we pin:
 *
 *   1. Renders nothing when closed (open=false from initial state).
 *   2. Pressing "?" opens the dialog.
 *   3. Pressing "?" again toggles it closed.
 *   4. Pressing Shift+"/" (the same physical key on most US layouts)
 *      also opens it — the component checks BOTH cases so the listener
 *      works whether the browser reports key="?" or key="/" with shift.
 *   5. Pressing Escape while open closes it.
 *   6. Pressing Escape while closed does NOT open it (no-op).
 *   7. The keydown handler ignores presses when focus is inside an
 *      <input>, <textarea>, or contentEditable element — otherwise the
 *      user typing "?" into a project name field would pop the sheet.
 *   8. The dialog has role="dialog" + aria-modal="true" + aria-label.
 *   9. Clicking the backdrop closes the dialog.
 *  10. Clicking the explicit "close (Esc)" button closes the dialog.
 *  11. All three groups (Editing, View, Mouse) render with their rows.
 *
 * Uses React 19 createRoot + act. Global keydown events are dispatched
 * via document.dispatchEvent inside act() so React flushes the state
 * change before assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import ShortcutHelpSheet from '../ShortcutHelpSheet'

// ── Test infra ───────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount() {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(ShortcutHelpSheet))
  })
}

function dispatchKey(key: string, opts: { shiftKey?: boolean; target?: HTMLElement } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  })
  // KeyboardEvent.target is normally set by dispatchEvent based on where
  // the event was fired. The component looks at `e.target` to detect
  // input-focus state — we redefine the property so we can stage focus
  // without actually focusing the element (which jsdom doesn't reliably
  // dispatch keydown from anyway).
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target, configurable: true })
  }
  act(() => {
    document.dispatchEvent(event)
  })
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]')
}

beforeEach(() => {
  mount()
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
  // Clean any inputs we appended to the body for focus-detection tests.
  for (const el of Array.from(document.body.querySelectorAll('input,textarea,[contenteditable]'))) {
    el.remove()
  }
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ShortcutHelpSheet — closed by default', () => {
  it('renders nothing initially', () => {
    expect(dialog()).toBeNull()
  })

  it('Escape while closed is a no-op (does not open)', () => {
    dispatchKey('Escape')
    expect(dialog()).toBeNull()
  })
})

describe('ShortcutHelpSheet — open / toggle', () => {
  it('pressing "?" opens the dialog', () => {
    dispatchKey('?')
    expect(dialog()).not.toBeNull()
  })

  it('pressing Shift+"/" also opens the dialog (alt key path)', () => {
    dispatchKey('/', { shiftKey: true })
    expect(dialog()).not.toBeNull()
  })

  it('pressing "?" twice toggles closed', () => {
    dispatchKey('?')
    expect(dialog()).not.toBeNull()
    dispatchKey('?')
    expect(dialog()).toBeNull()
  })

  it('pressing Escape while open closes the dialog', () => {
    dispatchKey('?')
    expect(dialog()).not.toBeNull()
    dispatchKey('Escape')
    expect(dialog()).toBeNull()
  })
})

describe('ShortcutHelpSheet — ignores keys when typing', () => {
  it('"?" inside an <input> does NOT open the sheet', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    dispatchKey('?', { target: input })
    expect(dialog()).toBeNull()
  })

  it('"?" inside a <textarea> does NOT open the sheet', () => {
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    dispatchKey('?', { target: ta })
    expect(dialog()).toBeNull()
  })

  it('"?" inside a contentEditable element does NOT open the sheet', () => {
    const div = document.createElement('div')
    div.contentEditable = 'true'
    // jsdom does not derive `.isContentEditable` from the attribute, so
    // pin it explicitly — the component reads the property, not the
    // attribute. Real browsers compute this for free.
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true })
    document.body.appendChild(div)
    dispatchKey('?', { target: div })
    expect(dialog()).toBeNull()
  })
})

describe('ShortcutHelpSheet — dialog accessibility', () => {
  it('open dialog has role="dialog" + aria-modal="true" + aria-label', () => {
    dispatchKey('?')
    const d = dialog()
    expect(d).not.toBeNull()
    expect(d!.getAttribute('aria-modal')).toBe('true')
    expect(d!.getAttribute('aria-label')).toBe('Keyboard shortcuts')
  })

  it('renders the Vehicle editor group (sourced from keyboard-shortcuts-data)', () => {
    dispatchKey('?')
    const text = document.body.textContent ?? ''
    // ShortcutHelpSheet now sources from keyboard-shortcuts-data single truth source.
    expect(text).toContain('Vehicle editor')
  })

  it('renders representative shortcut rows (Save / Reset camera / Orbit)', () => {
    dispatchKey('?')
    const text = document.body.textContent ?? ''
    expect(text).toContain('Save project')
    expect(text).toContain('Reset camera')
    expect(text).toContain('Orbit camera')
  })
})

describe('ShortcutHelpSheet — dismiss controls', () => {
  it('clicking the backdrop closes the dialog', () => {
    dispatchKey('?')
    const backdrop = document.querySelector(
      'button[aria-label="Close keyboard shortcuts"]',
    ) as HTMLButtonElement
    expect(backdrop).not.toBeNull()
    act(() => {
      backdrop.click()
    })
    expect(dialog()).toBeNull()
  })

  it('clicking the "close (Esc)" button closes the dialog', () => {
    dispatchKey('?')
    const closeBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.includes('close (Esc)'),
    ) as HTMLButtonElement | undefined
    expect(closeBtn).toBeDefined()
    act(() => {
      closeBtn!.click()
    })
    expect(dialog()).toBeNull()
  })
})
