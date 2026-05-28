/**
 * Tests for NewProjectForm — the "Pack details" panel that follows the
 * faction picker in the new-project flow.
 *
 * Pinned contract:
 *   1. Renders three fields: pack name (required), description, author.
 *   2. Pack name is required — submit button disabled until a non-empty
 *      trimmed name is typed.
 *   3. On mount, author pre-fills from localStorage[`coh2-skin-author`]
 *      so returning users don't retype.
 *   4. On submit, the trimmed author is persisted back to localStorage.
 *   5. Submit fires onSubmit with trimmed values; an empty author becomes
 *      "Anonymous".
 *   6. After submit, the submit button is disabled (idempotent — repeated
 *      clicks only fire onSubmit once).
 *   7. Cmd/Ctrl + Enter from any field submits the form.
 *   8. Plain Enter does NOT submit (so the description textarea can be
 *      multi-line).
 *   9. The faction chip uses the faction's icon + UPPERCASE label and
 *      becomes disabled when the form is submitted (no going back mid-
 *      preload). Clicking it (while still enabled) calls onBack.
 *  10. When `preloading` is true AND the form was submitted, the CTA
 *      shows the inline spinner + "Preloading … vehicles…" label
 *      instead of "Create & preview".
 *
 * Test infra: React 19 createRoot + act, real BorderBeam (transparent
 * wrapper). localStorage is cleared in beforeEach so the author pre-fill
 * test sees a known value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import NewProjectForm, { type ProjectFormResult } from '../NewProjectForm'

// ── Test infra ───────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  faction?: 'german' | 'soviet' | 'aef' | 'british' | 'west_german'
  exiting?: boolean
  preloading?: boolean
  onSubmit?: (result: ProjectFormResult) => void
  onBack?: () => void
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(NewProjectForm, {
        faction: props.faction ?? 'soviet',
        exiting: props.exiting,
        preloading: props.preloading,
        onSubmit: props.onSubmit ?? (() => {}),
        onBack: props.onBack ?? (() => {}),
      }),
    )
  })
  return container!
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement | null {
  // Each <Field> wraps its child in a <label> with the label text inside a
  // <span>. We find the matching label by walking the span text and grab
  // the first input/textarea inside it.
  for (const lbl of Array.from(document.querySelectorAll('label'))) {
    const span = lbl.querySelector('span')
    if (span?.textContent?.startsWith(label)) {
      return lbl.querySelector('input,textarea') as HTMLInputElement | HTMLTextAreaElement | null
    }
  }
  return null
}

function submitButton(): HTMLButtonElement | null {
  // The submit CTA is the only button with text containing "Create" or
  // "Preloading" (the faction chip text doesn't include either).
  return (
    (Array.from(document.querySelectorAll('button')).find(b => {
      const t = b.textContent ?? ''
      return t.includes('Create') || t.includes('Preloading')
    }) as HTMLButtonElement | undefined) ?? null
  )
}

function factionChip(): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.includes('change'),
    ) as HTMLButtonElement | undefined) ?? null
  )
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  // Use the native setter so React's onChange fires correctly under the
  // synthetic event system (React tracks the previous value via the
  // descriptor — assigning .value directly bypasses that and the change
  // event won't update the controlled state).
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
  // Don't leave a stale author from a previous test.
  try {
    localStorage.removeItem('coh2-skin-author')
  } catch {
    /* ignore in environments without localStorage */
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NewProjectForm — fields', () => {
  it('renders pack name (required), description, author', () => {
    render()
    expect(field('Pack name')).not.toBeNull()
    expect(field('Description')).not.toBeNull()
    expect(field('Author')).not.toBeNull()
  })

  it('pack name carries the required asterisk in its label', () => {
    render()
    // The asterisk is a separate span inside the label header.
    const label = Array.from(document.querySelectorAll('label')).find(l =>
      l.querySelector('span')?.textContent?.startsWith('Pack name'),
    )
    expect(label).toBeDefined()
    expect(label!.textContent).toContain('*')
  })
})

describe('NewProjectForm — submit gating', () => {
  it('CTA is disabled with empty name', () => {
    render()
    expect(submitButton()!.disabled).toBe(true)
  })

  it('CTA is disabled when name is only whitespace', () => {
    render()
    setInputValue(field('Pack name') as HTMLInputElement, '    ')
    expect(submitButton()!.disabled).toBe(true)
  })

  it('CTA enables once a non-whitespace name is typed', () => {
    render()
    setInputValue(field('Pack name') as HTMLInputElement, 'Operation MG')
    expect(submitButton()!.disabled).toBe(false)
  })

  it('CTA disables again after submit (idempotent)', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Pack name') as HTMLInputElement, 'Pack A')
    act(() => {
      submitButton()!.click()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(submitButton()!.disabled).toBe(true)
    // Second click does NOT fire onSubmit again.
    act(() => {
      submitButton()!.click()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe('NewProjectForm — author persistence', () => {
  it('pre-fills author from localStorage on mount', () => {
    localStorage.setItem('coh2-skin-author', 'Test User')
    render()
    expect((field('Author') as HTMLInputElement).value).toBe('Test User')
  })

  it('persists trimmed author to localStorage on submit', () => {
    render({ onSubmit: () => {} })
    setInputValue(field('Pack name') as HTMLInputElement, 'Pack')
    setInputValue(field('Author') as HTMLInputElement, '   Tester   ')
    act(() => {
      submitButton()!.click()
    })
    expect(localStorage.getItem('coh2-skin-author')).toBe('Tester')
  })

  it('passes "Anonymous" when author left blank', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Pack name') as HTMLInputElement, 'Anon Pack')
    act(() => {
      submitButton()!.click()
    })
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        packName: 'Anon Pack',
        author: 'Anonymous',
      }),
    )
  })

  it('trims pack name + description + author before calling onSubmit', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Pack name') as HTMLInputElement, '  Spaced Pack  ')
    setInputValue(field('Description') as HTMLTextAreaElement, '  multi\nline desc  ')
    setInputValue(field('Author') as HTMLInputElement, '  T  ')
    act(() => {
      submitButton()!.click()
    })
    // Now also includes the optional `template` field — see the
    // matching note in NewFaceplateForm.test.tsx for the rationale.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        packName: 'Spaced Pack',
        packDescription: 'multi\nline desc',
        author: 'T',
      }),
    )
  })
})

describe('NewProjectForm — keyboard submit', () => {
  it('Cmd+Enter from name field submits', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Pack name') as HTMLInputElement, 'KP')
    act(() => {
      field('Pack name')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      )
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Enter from description field submits', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    setInputValue(field('Pack name') as HTMLInputElement, 'KC')
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
    setInputValue(field('Pack name') as HTMLInputElement, 'KN')
    act(() => {
      field('Description')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Cmd+Enter does nothing when name is empty (canSubmit false)', () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    act(() => {
      field('Pack name')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('NewProjectForm — faction chip', () => {
  it('renders the faction icon + UPPERCASE faction label and a "change" hint', () => {
    render({ faction: 'german' })
    const chip = factionChip()!
    expect(chip).not.toBeNull()
    // Label is rendered uppercase by Tailwind, but the textContent
    // reflects the underlying string which already comes from
    // FACTION_LABELS (e.g. "OKW" / "Wehrmacht"). We only pin that the
    // text is non-empty and includes the "change" affordance.
    expect(chip.textContent).toContain('change')
    expect(chip.querySelector('img')).not.toBeNull()
  })

  it('clicking the faction chip calls onBack', () => {
    const onBack = vi.fn()
    render({ onBack })
    act(() => {
      factionChip()!.click()
    })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('faction chip becomes disabled once the form is submitted (no mid-preload back)', () => {
    render()
    setInputValue(field('Pack name') as HTMLInputElement, 'Pack')
    expect(factionChip()!.disabled).toBe(false)
    act(() => {
      submitButton()!.click()
    })
    expect(factionChip()!.disabled).toBe(true)
  })
})

describe('NewProjectForm — preloading state', () => {
  it('CTA text reads "Create & preview" before submit', () => {
    render({ preloading: true })
    // preloading alone (without submit) does NOT change the CTA label —
    // the spinner UI only kicks in once the user has actually submitted.
    expect(submitButton()!.textContent).toContain('Create')
    expect(submitButton()!.textContent).not.toContain('Preloading')
  })

  it('after submit + preloading=true, CTA shows the preloading label', () => {
    render({ preloading: true })
    setInputValue(field('Pack name') as HTMLInputElement, 'Pack')
    act(() => {
      submitButton()!.click()
    })
    expect(submitButton()!.textContent).toContain('Preloading')
    expect(submitButton()!.textContent).toContain('vehicles')
  })
})

// ── NewProjectForm — clone-template dropdown ────────────────────────────────
// Regression for the user-reported bug: "the clone template drop down is
// getting all the skins, faceplates or decals that I have, also cull the
// broken ones so they don't appear in the template list."
//
// The form's saved-templates section now reads `listAllSkinProjects()`,
// which walks every healthy `coh2.project.<id>` snapshot — NOT the
// 12-entry recent registry. These tests pin that contract end-to-end
// through the picker UI so a future regression that re-wires the dropdown
// to `getRecentProjects` would fail loudly.

describe('NewProjectForm — clone-template dropdown', () => {
  /** Minimal valid v2 skin snapshot — matches the schema short-circuit in
   *  migrateIfNeeded so the loader returns the project as-is and
   *  listAllSkinProjects surfaces it.
   *
   *  `factionDefaults: {}` is REQUIRED — listAllSkinProjects falls back
   *  to `primaryFaction(project)` when no cached registry entry exists,
   *  and that function reads `p.factionDefaults[f]` which throws if the
   *  field is undefined. (In real use this can't happen because every
   *  persisted project goes through `newProject` which seeds it.) */
  function validSkinSnapshot(id: string, packName: string): string {
    return JSON.stringify({
      magic: 'coh2-skin-project',
      version: 2,
      id,
      packName,
      exportSlots: [],
      generationSessions: {},
      vehicleIcons: {},
      vehicles: {},
      factionDefaults: {},
      palette: [],
      activeSlotIdx: 0,
      modifiedAt: new Date().toISOString(),
    })
  }

  beforeEach(() => {
    localStorage.clear()
  })

  it('enumerates ALL saved skin projects (not capped at the 12-entry recent registry)', () => {
    // Persist 14 snapshots — registry would cap at 12, listAllSkinProjects
    // returns all 14.
    for (let i = 0; i < 14; i++) {
      localStorage.setItem(`coh2.project.proj_${i}`, validSkinSnapshot(`proj_${i}`, `Pack ${i}`))
    }
    render()
    // Open the picker — the saved options are mounted lazily inside the
    // panel so we have to click the trigger first.
    const trigger = document.querySelector(
      '[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    expect(trigger).not.toBeNull()
    act(() => {
      trigger.click()
    })
    // Every saved option carries a data-testid prefixed with
    // `template-picker-option-proj_`. There should be 14 of them.
    const savedOptions = document.querySelectorAll('[data-testid^="template-picker-option-proj_"]')
    expect(savedOptions.length).toBe(14)
  })

  it('silently excludes broken snapshots (wrong magic / invalid JSON) from the dropdown', () => {
    // One valid snapshot
    localStorage.setItem(`coh2.project.proj_good`, validSkinSnapshot('proj_good', 'Good Pack'))
    // One snapshot with the wrong magic header
    localStorage.setItem(
      `coh2.project.proj_wrong_magic`,
      JSON.stringify({ magic: 'something-else', id: 'proj_wrong_magic' }),
    )
    // One snapshot that can't be parsed
    localStorage.setItem(`coh2.project.proj_broken`, '{not valid json}')
    render()
    const trigger = document.querySelector(
      '[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })
    // Only the healthy snapshot should appear.
    expect(
      document.querySelector('[data-testid="template-picker-option-proj_good"]'),
    ).not.toBeNull()
    expect(
      document.querySelector('[data-testid="template-picker-option-proj_wrong_magic"]'),
    ).toBeNull()
    expect(document.querySelector('[data-testid="template-picker-option-proj_broken"]')).toBeNull()
  })
})
