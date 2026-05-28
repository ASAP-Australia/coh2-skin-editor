/**
 * Tests for UndoRedoBar — the small floating chip beside TopBar that
 * exposes Undo / Redo as clickable affordances. The same DecalHistory
 * instance still drives the keyboard shortcuts (Ctrl+Z / Ctrl+Y); the
 * UI buttons are there so new users discover that history exists.
 *
 * Pinned contract:
 *   1. Renders exactly two <button type="button"> elements — one Undo,
 *      one Redo — each with a leading lucide icon (<svg>).
 *   2. aria-label + title both encode the gesture AND the keyboard
 *      shortcut: "Undo (Ctrl+Z)" / "Redo (Ctrl+Y)". This is the only
 *      surface that teaches new users the shortcut, so we pin both
 *      strings character-for-character.
 *   3. `canUndo=false` disables ONLY the Undo button; Redo stays
 *      enabled if `canRedo=true`. Same in reverse. The two states are
 *      independent — that's how DecalHistory actually drives them.
 *   4. Clicking Undo fires `onUndo` exactly once and does NOT fire
 *      `onRedo` (and vice-versa). We pin this because the chip is
 *      memoised — a future refactor that swaps the handlers could
 *      silently mis-wire them.
 *   5. Disabled buttons swallow the click — neither `onUndo` nor
 *      `onRedo` fires when its corresponding `can*` flag is false.
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import UndoRedoBar from '../UndoRedoBar'

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(UndoRedoBar, {
        canUndo: props.canUndo ?? true,
        canRedo: props.canRedo ?? true,
        onUndo: props.onUndo ?? (() => {}),
        onRedo: props.onRedo ?? (() => {}),
      }),
    )
  })
  return container!
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
}

function undoBtn(): HTMLButtonElement | null {
  return buttons().find(b => b.getAttribute('aria-label')?.startsWith('Undo')) ?? null
}

function redoBtn(): HTMLButtonElement | null {
  return buttons().find(b => b.getAttribute('aria-label')?.startsWith('Redo')) ?? null
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('UndoRedoBar — render', () => {
  it('renders exactly two buttons (Undo + Redo)', () => {
    render()
    expect(buttons()).toHaveLength(2)
    expect(undoBtn()).not.toBeNull()
    expect(redoBtn()).not.toBeNull()
  })

  it('both buttons are type="button" (form-submit guard)', () => {
    render()
    expect(undoBtn()!.getAttribute('type')).toBe('button')
    expect(redoBtn()!.getAttribute('type')).toBe('button')
  })

  it('each button contains a leading lucide <svg> icon', () => {
    render()
    expect(undoBtn()!.querySelector('svg')).not.toBeNull()
    expect(redoBtn()!.querySelector('svg')).not.toBeNull()
  })
})

describe('UndoRedoBar — accessibility / shortcut hints', () => {
  it('Undo carries aria-label="Undo (Ctrl+Z)" and matching title', () => {
    render()
    expect(undoBtn()!.getAttribute('aria-label')).toBe('Undo (Ctrl+Z)')
    expect(undoBtn()!.getAttribute('title')).toBe('Undo (Ctrl+Z)')
  })

  it('Redo carries aria-label="Redo (Ctrl+Y)" and matching title', () => {
    render()
    expect(redoBtn()!.getAttribute('aria-label')).toBe('Redo (Ctrl+Y)')
    expect(redoBtn()!.getAttribute('title')).toBe('Redo (Ctrl+Y)')
  })

  it('icons are aria-hidden so the label is the sole accessible name', () => {
    render()
    // lucide-react forwards aria-hidden to the rendered <svg>.
    expect(undoBtn()!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(redoBtn()!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('UndoRedoBar — independent disabled flags', () => {
  it('canUndo=false disables Undo only; Redo stays enabled', () => {
    render({ canUndo: false, canRedo: true })
    expect(undoBtn()!.disabled).toBe(true)
    expect(redoBtn()!.disabled).toBe(false)
  })

  it('canRedo=false disables Redo only; Undo stays enabled', () => {
    render({ canUndo: true, canRedo: false })
    expect(undoBtn()!.disabled).toBe(false)
    expect(redoBtn()!.disabled).toBe(true)
  })

  it('both flags false disables both buttons', () => {
    render({ canUndo: false, canRedo: false })
    expect(undoBtn()!.disabled).toBe(true)
    expect(redoBtn()!.disabled).toBe(true)
  })

  it('both flags true leaves both clickable', () => {
    render({ canUndo: true, canRedo: true })
    expect(undoBtn()!.disabled).toBe(false)
    expect(redoBtn()!.disabled).toBe(false)
  })
})

describe('UndoRedoBar — click wiring', () => {
  it('clicking Undo fires onUndo exactly once and NOT onRedo', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render({ onUndo, onRedo })
    act(() => {
      undoBtn()!.click()
    })
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).not.toHaveBeenCalled()
  })

  it('clicking Redo fires onRedo exactly once and NOT onUndo', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render({ onUndo, onRedo })
    act(() => {
      redoBtn()!.click()
    })
    expect(onRedo).toHaveBeenCalledTimes(1)
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('disabled Undo swallows the click (onUndo never fires)', () => {
    const onUndo = vi.fn()
    render({ canUndo: false, onUndo })
    act(() => {
      undoBtn()!.click()
    })
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('disabled Redo swallows the click (onRedo never fires)', () => {
    const onRedo = vi.fn()
    render({ canRedo: false, onRedo })
    act(() => {
      redoBtn()!.click()
    })
    expect(onRedo).not.toHaveBeenCalled()
  })
})
