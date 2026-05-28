/**
 * Tests for NewFaceplateForm — the metadata panel shown before entering
 * the FaceplateEditor.
 *
 * Pinned contract (mirrors NewProjectForm but for faceplates):
 *   1. Three fields render: name (required), description, author.
 *   2. Submit CTA disabled until a non-whitespace name is typed.
 *   3. Author pre-fills from localStorage[`coh2-faceplate-author`] on
 *      mount. SEPARATE key from skin-pack author (`coh2-skin-author`) so
 *      users can have different defaults per editor.
 *   4. Trimmed author is persisted on submit. Blank → "Anonymous".
 *   5. Submit is idempotent — second click is a no-op.
 *   6. Cmd/Ctrl + Enter submits; plain Enter does not.
 *   7. Cancel button exists, fires onCancel, and disables once submitted
 *      (no going back mid-load).
 *
 * Test infra: React 19 createRoot + act. localStorage is cleared in
 * beforeEach so the pre-fill test sees a known value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import NewFaceplateForm, { type FaceplateFormResult } from '../NewFaceplateForm'

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  exiting?: boolean
  onSubmit?: (result: FaceplateFormResult) => void
  onCancel?: () => void
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(NewFaceplateForm, {
        exiting: props.exiting,
        onSubmit: props.onSubmit ?? (() => {}),
        onCancel: props.onCancel ?? (() => {}),
      }),
    )
  })
  return container!
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement | null {
  for (const lbl of Array.from(document.querySelectorAll('label'))) {
    const span = lbl.querySelector('span')
    if (span?.textContent?.startsWith(label)) {
      return lbl.querySelector('input,textarea') as HTMLInputElement | HTMLTextAreaElement | null
    }
  }
  return null
}

function submitButton(): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Create'),
    ) as HTMLButtonElement | undefined) ?? null
  )
}

function cancelButton(): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Cancel',
    ) as HTMLButtonElement | undefined) ?? null
  )
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  try {
    localStorage.removeItem('coh2-faceplate-author')
    localStorage.removeItem('coh2-skin-author')
  } catch {
    /* ignore */
  }
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

describe('NewFaceplateForm — fields', () => {
  it('renders name (required), description, author', () => {
    render()
    expect(field('Faceplate name')).not.toBeNull()
    expect(field('Description')).not.toBeNull()
    expect(field('Author')).not.toBeNull()
  })

  it('faceplate name label carries the required asterisk', () => {
    render()
    const label = Array.from(document.querySelectorAll('label')).find(l =>
      l.querySelector('span')?.textContent?.startsWith('Faceplate name'),
    )
    expect(label!.textContent).toContain('*')
  })

  it('description label does NOT carry the required asterisk (optional field)', () => {
    render()
    const label = Array.from(document.querySelectorAll('label')).find(l =>
      l.querySelector('span')?.textContent?.startsWith('Description'),
    )
    // The asterisk span is colored with --color-accent — pin its absence
    // structurally rather than by text content (the textarea placeholder
    // also doesn't contain "*", but checking the label's first-span text
    // is the most direct signal).
    const firstSpan = label!.querySelector('span')
    expect(firstSpan!.textContent).toBe('Description')
  })
})

describe('NewFaceplateForm — submit gating', () => {
  it('CTA disabled with empty name', () => {
    render()
    expect(submitButton()!.disabled).toBe(true)
  })

  it('CTA disabled when name is only whitespace', () => {
    render()
    setInputValue(field('Faceplate name') as HTMLInputElement, '   ')
    expect(submitButton()!.disabled).toBe(true)
  })

  it('CTA enables once a non-whitespace name is typed', () => {
    render()
    setInputValue(field('Faceplate name') as HTMLInputElement, 'Desert Fox')
    expect(submitButton()!.disabled).toBe(false)
  })

  it('submit is idempotent (CTA disables after first click)', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Faceplate name') as HTMLInputElement, 'FP A')
    act(() => {
      submitButton()!.click()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(submitButton()!.disabled).toBe(true)
    act(() => {
      submitButton()!.click()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe('NewFaceplateForm — author persistence', () => {
  it('uses the faceplate-specific localStorage key (NOT the skin-pack key)', () => {
    // Stage a skin-pack author and confirm the faceplate form does NOT
    // read from it — preventing a regression where the keys collide.
    localStorage.setItem('coh2-skin-author', 'SkinPersona')
    render()
    expect((field('Author') as HTMLInputElement).value).toBe('')
    // And the dedicated faceplate key DOES pre-fill.
    act(() => root!.unmount())
    root = null
    container!.remove()
    container = null
    localStorage.setItem('coh2-faceplate-author', 'FaceplatePersona')
    render()
    expect((field('Author') as HTMLInputElement).value).toBe('FaceplatePersona')
  })

  it('persists trimmed author to localStorage on submit', () => {
    render()
    setInputValue(field('Faceplate name') as HTMLInputElement, 'FP')
    setInputValue(field('Author') as HTMLInputElement, '   FpUser   ')
    act(() => {
      submitButton()!.click()
    })
    expect(localStorage.getItem('coh2-faceplate-author')).toBe('FpUser')
  })

  it('passes "Anonymous" when author left blank', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Faceplate name') as HTMLInputElement, 'Anon FP')
    act(() => {
      submitButton()!.click()
    })
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Anon FP', author: 'Anonymous' }),
    )
  })

  it('trims name + description + author before calling onSubmit', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Faceplate name') as HTMLInputElement, '  Padded FP  ')
    setInputValue(field('Description') as HTMLTextAreaElement, '  multi\nline  ')
    setInputValue(field('Author') as HTMLInputElement, '  F  ')
    act(() => {
      submitButton()!.click()
    })
    // The submit payload now also includes the optional `template` field
    // (defaults to { id: 'blank', kind: 'blank' }) — kept as a partial
    // match so this trim-assertion stays focused on the trim contract
    // and doesn't tightly couple to template-picker internals.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Padded FP',
        description: 'multi\nline',
        author: 'F',
      }),
    )
  })
})

describe('NewFaceplateForm — keyboard submit', () => {
  it('Cmd+Enter submits', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Faceplate name') as HTMLInputElement, 'KP')
    act(() => {
      field('Faceplate name')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      )
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Enter submits', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Faceplate name') as HTMLInputElement, 'KC')
    act(() => {
      field('Description')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      )
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('plain Enter does NOT submit (description must allow multi-line)', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Faceplate name') as HTMLInputElement, 'KN')
    act(() => {
      field('Description')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('NewFaceplateForm — cancel', () => {
  it('Cancel button fires onCancel', () => {
    const onCancel = vi.fn()
    render({ onCancel })
    act(() => {
      cancelButton()!.click()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Cancel button disables once the form is submitted', () => {
    render()
    setInputValue(field('Faceplate name') as HTMLInputElement, 'FP')
    expect(cancelButton()!.disabled).toBe(false)
    act(() => {
      submitButton()!.click()
    })
    expect(cancelButton()!.disabled).toBe(true)
  })
})

// ── NewFaceplateForm — clone-template dropdown ──────────────────────────────
// Regression for the user-reported bug: the dropdown should enumerate ALL
// faceplate snapshots on disk (not just the 12-entry recent registry) and
// silently drop broken ones so they can't crash the editor on click.

describe('NewFaceplateForm — clone-template dropdown', () => {
  /** Minimal valid faceplate snapshot — layers: [] survives the v0→v1
   *  layer-kind backfill as a zero-iter no-op. */
  function validFaceplateSnapshot(id: string, packName: string): string {
    return JSON.stringify({
      magic: 'coh2-faceplate-project',
      version: 2,
      id,
      packName,
      layers: [],
      modifiedAt: new Date().toISOString(),
    })
  }

  beforeEach(() => {
    localStorage.clear()
  })

  it('enumerates ALL saved faceplates (not capped at the 12-entry recent registry)', () => {
    for (let i = 0; i < 14; i++) {
      localStorage.setItem(
        `coh2.faceplate.fp_${i}`,
        validFaceplateSnapshot(`fp_${i}`, `Plate ${i}`),
      )
    }
    render()
    const trigger = document.querySelector(
      '[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    expect(trigger).not.toBeNull()
    act(() => {
      trigger.click()
    })
    const savedOptions = document.querySelectorAll('[data-testid^="template-picker-option-fp_"]')
    expect(savedOptions.length).toBe(14)
  })

  it('silently excludes broken faceplate snapshots from the dropdown', () => {
    localStorage.setItem(`coh2.faceplate.fp_good`, validFaceplateSnapshot('fp_good', 'Good Plate'))
    localStorage.setItem(
      `coh2.faceplate.fp_wrong_magic`,
      JSON.stringify({ magic: 'something-else', id: 'fp_wrong_magic' }),
    )
    localStorage.setItem(`coh2.faceplate.fp_broken`, '{not valid json}')
    render()
    const trigger = document.querySelector(
      '[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })
    expect(document.querySelector('[data-testid="template-picker-option-fp_good"]')).not.toBeNull()
    expect(
      document.querySelector('[data-testid="template-picker-option-fp_wrong_magic"]'),
    ).toBeNull()
    expect(document.querySelector('[data-testid="template-picker-option-fp_broken"]')).toBeNull()
  })
})
