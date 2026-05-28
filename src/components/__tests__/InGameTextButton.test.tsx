/**
 * Tests for InGameTextButton — the quick-edit popover that sits next to
 * the Live Sync badge in both Faceplate and Decal-pack editors.
 *
 * The component exposes the in-game pack `name` and `description` strings
 * that the engine renders on the hover card / equip card. These tests pin
 * the contract every consumer relies on:
 *
 *   - The trigger is a single icon button (28×28 inline variant) so it
 *     sits cleanly beside the LiveSyncBadge inline icon.
 *   - Popover toggles open / closed via clicking the trigger, Escape, or
 *     outside-click — matching the dismissal contract of every other
 *     floating chrome surface (peel, modal, ProjectMetaPanel).
 *   - Editing either field emits `onChange` with the OTHER field
 *     preserved (callers do a single mutate, so we can't drop one).
 *   - The "kind" prop swaps copy (faceplate vs decal) but the data shape
 *     and aria contract are identical.
 *
 * Uses React 19 createRoot + act (no @testing-library/react).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import InGameTextButton from '../InGameTextButton'

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

describe('InGameTextButton — trigger', () => {
  it('renders a single trigger button when closed', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
      }),
    )
    const buttons = el.querySelectorAll('button[data-testid="in-game-text-button"]')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('data-state')).toBe('closed')
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false')
    expect(buttons[0].getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('shows the faceplate aria-label when kind="faceplate"', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
      }),
    )
    const btn = el.querySelector('button[data-testid="in-game-text-button"]')!
    expect(btn.getAttribute('aria-label')).toBe('Edit in-game faceplate text')
  })

  it('shows the decal aria-label when kind="decal"', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'decal',
        name: 'X',
        description: 'Y',
        onChange: () => {},
      }),
    )
    const btn = el.querySelector('button[data-testid="in-game-text-button"]')!
    expect(btn.getAttribute('aria-label')).toBe('Edit in-game decal pack text')
  })

  it('does NOT render the popover until clicked', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
      }),
    )
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).toBeNull()
  })

  it('respects initialOpen for tests / Storybook', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).not.toBeNull()
  })
})

describe('InGameTextButton — open / close behaviour', () => {
  it('clicking the trigger opens the popover', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
      }),
    )
    const btn = el.querySelector('button[data-testid="in-game-text-button"]') as HTMLButtonElement
    act(() => {
      btn.click()
    })
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).not.toBeNull()
    expect(btn.getAttribute('data-state')).toBe('open')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('clicking the trigger again closes the popover (idempotent toggle)', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
      }),
    )
    const btn = el.querySelector('button[data-testid="in-game-text-button"]') as HTMLButtonElement
    act(() => btn.click())
    act(() => btn.click())
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).toBeNull()
    expect(btn.getAttribute('data-state')).toBe('closed')
  })

  it('Escape key closes an open popover', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).not.toBeNull()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).toBeNull()
  })

  it('outside-click closes the popover', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).not.toBeNull()
    // Dispatch a mousedown on a node OUTSIDE the popover root.
    const outsideNode = document.createElement('div')
    document.body.appendChild(outsideNode)
    act(() => {
      const ev = new MouseEvent('mousedown', { bubbles: true })
      outsideNode.dispatchEvent(ev)
    })
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).toBeNull()
    outsideNode.remove()
  })

  it('clicking INSIDE the popover does NOT close it', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'X',
        description: 'Y',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    const popover = el.querySelector('[data-testid="in-game-text-popover"]')!
    act(() => {
      const ev = new MouseEvent('mousedown', { bubbles: true })
      popover.dispatchEvent(ev)
    })
    // Still mounted.
    expect(el.querySelector('[data-testid="in-game-text-popover"]')).not.toBeNull()
  })
})

// React's synthetic event system listens for `input` events but checks
// `event.target.value` via its OWN cached descriptor. Setting `.value`
// directly bypasses React's change-tracking, so onChange never fires.
// The fix is to use the prototype value setter (which React's tracking
// is wired through) — same pattern used by ProjectMetaPanel.test.tsx.
function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, next: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(el, next)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('InGameTextButton — onChange contract', () => {
  it('typing in the name input emits onChange with description preserved', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'Initial',
        description: 'My desc',
        onChange,
        initialOpen: true,
      }),
    )
    const nameInput = el.querySelector(
      'input[data-testid="in-game-text-name-input"]',
    ) as HTMLInputElement
    act(() => {
      setReactInputValue(nameInput, 'New Name')
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ name: 'New Name', description: 'My desc' })
  })

  it('typing in the description textarea emits onChange with name preserved', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'Keep me',
        description: 'Old desc',
        onChange,
        initialOpen: true,
      }),
    )
    const descInput = el.querySelector(
      'textarea[data-testid="in-game-text-description-input"]',
    ) as HTMLTextAreaElement
    act(() => {
      setReactInputValue(descInput, 'Brand new description')
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      name: 'Keep me',
      description: 'Brand new description',
    })
  })

  it('inputs reflect controlled values from props', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'Reactive Name',
        description: 'Reactive Desc',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    const nameInput = el.querySelector(
      'input[data-testid="in-game-text-name-input"]',
    ) as HTMLInputElement
    const descInput = el.querySelector(
      'textarea[data-testid="in-game-text-description-input"]',
    ) as HTMLTextAreaElement
    expect(nameInput.value).toBe('Reactive Name')
    expect(descInput.value).toBe('Reactive Desc')
  })

  it('description field is a textarea (multiline) — long text is allowed', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'x',
        description: 'a\nb\nc',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    const descInput = el.querySelector('[data-testid="in-game-text-description-input"]')!
    expect(descInput.tagName.toLowerCase()).toBe('textarea')
  })

  it('empty initial values render empty inputs (not crashes)', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(InGameTextButton, {
        kind: 'decal',
        name: '',
        description: '',
        onChange,
        initialOpen: true,
      }),
    )
    const nameInput = el.querySelector(
      'input[data-testid="in-game-text-name-input"]',
    ) as HTMLInputElement
    expect(nameInput.value).toBe('')
    // And the next keystroke still emits onChange shape.
    act(() => {
      setReactInputValue(nameInput, 'a')
    })
    expect(onChange).toHaveBeenCalledWith({ name: 'a', description: '' })
  })
})

describe('InGameTextButton — copy by kind', () => {
  it('faceplate heading reads "In-game faceplate text"', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'faceplate',
        name: 'x',
        description: 'y',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    const popover = el.querySelector('[data-testid="in-game-text-popover"]')!
    expect(popover.textContent).toContain('In-game faceplate text')
  })

  it('decal heading reads "In-game decal pack text"', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'decal',
        name: 'x',
        description: 'y',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    const popover = el.querySelector('[data-testid="in-game-text-popover"]')!
    expect(popover.textContent).toContain('In-game decal pack text')
  })

  it('decal name field is labelled "Pack name" (not just "Name")', () => {
    const el = render(
      createElement(InGameTextButton, {
        kind: 'decal',
        name: 'x',
        description: 'y',
        onChange: () => {},
        initialOpen: true,
      }),
    )
    const popover = el.querySelector('[data-testid="in-game-text-popover"]')!
    expect(popover.textContent).toContain('Pack name')
  })
})
