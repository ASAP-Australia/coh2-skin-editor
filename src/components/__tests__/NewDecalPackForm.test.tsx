/**
 * Tests for NewDecalPackForm — the metadata panel shown before entering
 * the DecalPackEditor.
 *
 * Pinned contract (mirrors NewFaceplateForm but for decal packs):
 *   1. Three fields: decal-pack name (required), description, author.
 *   2. Submit CTA disabled until a non-whitespace name is typed.
 *   3. Author pre-fills from localStorage[`coh2-decalpack-author`] —
 *      SEPARATE key from skin-pack + faceplate authors so all three
 *      flows have independent defaults.
 *   4. Trimmed author is persisted on submit. Blank → "Anonymous".
 *   5. Submit is idempotent.
 *   6. Cmd/Ctrl + Enter submits; plain Enter does not.
 *   7. Cancel button exists, fires onCancel, and disables once submitted.
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import NewDecalPackForm, { type DecalPackFormResult } from '../NewDecalPackForm'

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  exiting?: boolean
  onSubmit?: (result: DecalPackFormResult) => void
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
      createElement(NewDecalPackForm, {
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
    localStorage.removeItem('coh2-decalpack-author')
    localStorage.removeItem('coh2-skin-author')
    localStorage.removeItem('coh2-faceplate-author')
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

describe('NewDecalPackForm — fields', () => {
  it('renders name (required), description, author', () => {
    render()
    expect(field('Decal pack name')).not.toBeNull()
    expect(field('Description')).not.toBeNull()
    expect(field('Author')).not.toBeNull()
  })

  it('decal-pack name label carries the required asterisk', () => {
    render()
    const label = Array.from(document.querySelectorAll('label')).find(l =>
      l.querySelector('span')?.textContent?.startsWith('Decal pack name'),
    )
    expect(label!.textContent).toContain('*')
  })
})

describe('NewDecalPackForm — submit gating', () => {
  it('CTA disabled with empty name', () => {
    render()
    expect(submitButton()!.disabled).toBe(true)
  })

  it('CTA disabled when name is only whitespace', () => {
    render()
    setInputValue(field('Decal pack name') as HTMLInputElement, '   ')
    expect(submitButton()!.disabled).toBe(true)
  })

  it('CTA enables once a non-whitespace name is typed', () => {
    render()
    setInputValue(field('Decal pack name') as HTMLInputElement, 'Eastern Front')
    expect(submitButton()!.disabled).toBe(false)
  })

  it('submit is idempotent (CTA disables after first click)', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Decal pack name') as HTMLInputElement, 'DP A')
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

describe('NewDecalPackForm — author persistence', () => {
  it('uses the decal-pack-specific localStorage key (NOT skin or faceplate keys)', () => {
    // Stage every OTHER author key and confirm the decal-pack form
    // sees an empty author.
    localStorage.setItem('coh2-skin-author', 'SkinPersona')
    localStorage.setItem('coh2-faceplate-author', 'FpPersona')
    render()
    expect((field('Author') as HTMLInputElement).value).toBe('')
    // And the dedicated key DOES pre-fill.
    act(() => root!.unmount())
    root = null
    container!.remove()
    container = null
    localStorage.setItem('coh2-decalpack-author', 'DecalPersona')
    render()
    expect((field('Author') as HTMLInputElement).value).toBe('DecalPersona')
  })

  it('persists trimmed author to localStorage on submit', () => {
    render()
    setInputValue(field('Decal pack name') as HTMLInputElement, 'DP')
    setInputValue(field('Author') as HTMLInputElement, '  DpUser  ')
    act(() => {
      submitButton()!.click()
    })
    expect(localStorage.getItem('coh2-decalpack-author')).toBe('DpUser')
  })

  it('passes "Anonymous" when author left blank', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Decal pack name') as HTMLInputElement, 'Anon DP')
    act(() => {
      submitButton()!.click()
    })
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Anon DP', author: 'Anonymous' }),
    )
  })

  it('trims name + description + author before calling onSubmit', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Decal pack name') as HTMLInputElement, '  Padded DP  ')
    setInputValue(field('Description') as HTMLTextAreaElement, '  multi\nline  ')
    setInputValue(field('Author') as HTMLInputElement, '  D  ')
    act(() => {
      submitButton()!.click()
    })
    // Now also includes the optional `template` field — see the
    // matching note in NewFaceplateForm.test.tsx for the rationale.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Padded DP',
        description: 'multi\nline',
        author: 'D',
      }),
    )
  })
})

describe('NewDecalPackForm — keyboard submit', () => {
  it('Cmd+Enter submits', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Decal pack name') as HTMLInputElement, 'KP')
    act(() => {
      field('Decal pack name')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      )
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Enter submits', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Decal pack name') as HTMLInputElement, 'KC')
    act(() => {
      field('Description')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      )
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('plain Enter does NOT submit', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Decal pack name') as HTMLInputElement, 'KN')
    act(() => {
      field('Description')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('NewDecalPackForm — cancel', () => {
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
    setInputValue(field('Decal pack name') as HTMLInputElement, 'DP')
    expect(cancelButton()!.disabled).toBe(false)
    act(() => {
      submitButton()!.click()
    })
    expect(cancelButton()!.disabled).toBe(true)
  })
})

// ── NewDecalPackForm — clone-template dropdown ──────────────────────────────
// Same regression pin as the skin + faceplate forms: the dropdown must
// enumerate every healthy `coh2.decalpack.<id>` snapshot (not just the
// 12-entry recent registry) and silently drop broken ones.

describe('NewDecalPackForm — clone-template dropdown', () => {
  /** Minimal valid v4 decal-pack snapshot — version 4 short-circuits
   *  every migration path so the loader returns the project as-is. */
  function validDecalPackSnapshot(id: string, packName: string): string {
    return JSON.stringify({
      magic: 'coh2-decalpack-project',
      version: 4,
      id,
      packName,
      decals: [],
      sourceImages: {},
      modifiedAt: new Date().toISOString(),
    })
  }

  beforeEach(() => {
    localStorage.clear()
  })

  it('enumerates ALL saved decal packs (not capped at the 12-entry recent registry)', () => {
    for (let i = 0; i < 14; i++) {
      localStorage.setItem(`coh2.decalpack.dp_${i}`, validDecalPackSnapshot(`dp_${i}`, `Pack ${i}`))
    }
    render()
    const trigger = document.querySelector(
      '[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    expect(trigger).not.toBeNull()
    act(() => {
      trigger.click()
    })
    const savedOptions = document.querySelectorAll('[data-testid^="template-picker-option-dp_"]')
    expect(savedOptions.length).toBe(14)
  })

  it('silently excludes broken decal-pack snapshots from the dropdown', () => {
    localStorage.setItem(`coh2.decalpack.dp_good`, validDecalPackSnapshot('dp_good', 'Good Pack'))
    localStorage.setItem(
      `coh2.decalpack.dp_wrong_magic`,
      JSON.stringify({ magic: 'something-else', id: 'dp_wrong_magic' }),
    )
    localStorage.setItem(`coh2.decalpack.dp_broken`, '{not valid json}')
    render()
    const trigger = document.querySelector(
      '[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })
    expect(document.querySelector('[data-testid="template-picker-option-dp_good"]')).not.toBeNull()
    expect(
      document.querySelector('[data-testid="template-picker-option-dp_wrong_magic"]'),
    ).toBeNull()
    expect(document.querySelector('[data-testid="template-picker-option-dp_broken"]')).toBeNull()
  })
})
