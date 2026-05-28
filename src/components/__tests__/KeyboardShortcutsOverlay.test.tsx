/**
 * Tests for KeyboardShortcutsOverlay.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import KeyboardShortcutsOverlay from '../editor-primitives/KeyboardShortcutsOverlay'
import { DEFAULT_SHORTCUTS } from '../editor-primitives/keyboard-shortcuts-data'

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

describe('KeyboardShortcutsOverlay', () => {
  it('returns null (renders nothing) when open is false', () => {
    const el = render(createElement(KeyboardShortcutsOverlay, { open: false, onClose: vi.fn() }))
    // The dialog element should not exist
    expect(el.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders the dialog when open is true', () => {
    const el = render(createElement(KeyboardShortcutsOverlay, { open: true, onClose: vi.fn() }))
    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('renders all group titles when open', () => {
    const el = render(createElement(KeyboardShortcutsOverlay, { open: true, onClose: vi.fn() }))
    for (const group of DEFAULT_SHORTCUTS) {
      expect(el.textContent).toContain(group.title)
    }
  })

  it('Escape key invokes onClose', () => {
    const onClose = vi.fn()
    render(createElement(KeyboardShortcutsOverlay, { open: true, onClose }))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('click on backdrop button invokes onClose', () => {
    const onClose = vi.fn()
    const el = render(createElement(KeyboardShortcutsOverlay, { open: true, onClose }))
    // The backdrop is a <button> with aria-label="Close keyboard shortcuts" and tabIndex={-1}
    const backdropBtn = el.querySelector(
      'button[aria-label="Close keyboard shortcuts"][tabindex="-1"]',
    ) as HTMLButtonElement
    expect(backdropBtn).not.toBeNull()
    act(() => {
      backdropBtn.click()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('click on inner card does NOT invoke onClose via backdrop', () => {
    const onClose = vi.fn()
    const el = render(createElement(KeyboardShortcutsOverlay, { open: true, onClose }))
    // Find the inner card div (positioned above the backdrop)
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement
    // The card is the last child div (after the backdrop button)
    const card = dialog.querySelector('div:not([style*="absolute"])') as HTMLElement
    expect(card).not.toBeNull()
    act(() => {
      // Click the card — this should not reach the backdrop button
      card.click()
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('X button invokes onClose', () => {
    const onClose = vi.fn()
    const el = render(createElement(KeyboardShortcutsOverlay, { open: true, onClose }))
    const closeBtn = el.querySelector(
      'button[aria-label="Close keyboard shortcuts"]',
    ) as HTMLButtonElement
    act(() => {
      closeBtn.click()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders custom groups instead of defaults', () => {
    const custom = [{ title: 'My Group', rows: [['A', 'Action A'] as [string, string]] }]
    const el = render(
      createElement(KeyboardShortcutsOverlay, { open: true, onClose: vi.fn(), groups: custom }),
    )
    expect(el.textContent).toContain('My Group')
    expect(el.textContent).not.toContain('Global')
  })

  it('DEFAULT_SHORTCUTS includes at minimum the Global group', () => {
    const globalGroup = DEFAULT_SHORTCUTS.find(g => g.title === 'Global')
    expect(globalGroup).toBeDefined()
    expect(globalGroup!.rows.length).toBeGreaterThan(0)
  })

  it('dialog has role="dialog", aria-modal="true", and correct aria-label', () => {
    const el = render(createElement(KeyboardShortcutsOverlay, { open: true, onClose: vi.fn() }))
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Keyboard shortcuts')
  })
})
