/**
 * Tests for TemplatePicker — the dropdown that seeds new projects from
 * either a blank canvas, a saved local project, or a workshop item.
 *
 * The picker is fully controlled (caller owns `value`); these tests pin
 * the externally-observable contract every consumer relies on:
 *
 *   - Closed by default; trigger button shows the selected option name.
 *   - Clicking the trigger opens a panel listing sections (Blank /
 *     Saved / Workshop). Empty sections are hidden unless they're the
 *     Blank section (always present).
 *   - Clicking an option fires onChange with the full TemplateOption
 *     record and closes the panel.
 *   - Hovering an option for any non-zero time mounts a preview tooltip
 *     showing the thumbnail (or a "no preview" placeholder when null).
 *   - Escape and outside-click close the panel.
 *   - `disabled` blocks opening but does not affect an already-open panel.
 *
 * Uses React 19 createRoot + act (no @testing-library/react).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import TemplatePicker, { type TemplateOption } from '../TemplatePicker'

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

// ─── Fixtures ──────────────────────────────────────────────────────────────

const BLANK: TemplateOption = {
  id: 'blank',
  kind: 'blank',
  name: 'Blank canvas',
  hint: 'Default background',
  thumbnail: null,
}

const SAVED_A: TemplateOption = {
  id: 'fp_abc',
  kind: 'saved',
  name: 'Desert Fox',
  hint: '12 layers · 2 days ago',
  thumbnail: 'data:image/png;base64,iVBORw0KGgo=', // 1×1 PNG header — enough to mount <img>
}

const SAVED_B: TemplateOption = {
  id: 'fp_def',
  kind: 'saved',
  name: 'Eastern Front',
  hint: '8 layers · 1 wk ago',
  thumbnail: null,
}

const STOCK_A: TemplateOption = {
  id: 'stock:ArtBritish',
  kind: 'stock',
  name: 'ArtBritish',
  hint: '142 MB',
  thumbnail: null,
}

const WORKSHOP_A: TemplateOption = {
  id: 'workshop:1234567890',
  kind: 'workshop',
  name: 'Workshop #1234567890',
  hint: 'Pre-fills the name',
  thumbnail: null,
}

describe('TemplatePicker — trigger', () => {
  it('renders the trigger button closed by default', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK],
      }),
    )
    const trigger = el.querySelector('button[data-testid="template-picker-trigger"]')!
    expect(trigger).not.toBeNull()
    expect(trigger.getAttribute('data-state')).toBe('closed')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(el.querySelector('[data-testid="template-picker-panel"]')).toBeNull()
  })

  it('displays the selected option name in the trigger', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: SAVED_A.id,
        onChange: () => {},
        options: [BLANK, SAVED_A],
      }),
    )
    const trigger = el.querySelector('button[data-testid="template-picker-trigger"]')!
    expect(trigger.textContent).toContain('Desert Fox')
  })

  it('falls back to the first option when value matches nothing', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'mystery-id',
        onChange: () => {},
        options: [BLANK, SAVED_A],
      }),
    )
    const trigger = el.querySelector('button[data-testid="template-picker-trigger"]')!
    expect(trigger.textContent).toContain('Blank canvas')
  })

  it('respects initialOpen for tests / Storybook', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK],
        initialOpen: true,
      }),
    )
    expect(el.querySelector('[data-testid="template-picker-panel"]')).not.toBeNull()
  })

  it('does not open when disabled and trigger is clicked', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK],
        disabled: true,
      }),
    )
    const trigger = el.querySelector(
      'button[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    act(() => trigger.click())
    expect(el.querySelector('[data-testid="template-picker-panel"]')).toBeNull()
  })
})

describe('TemplatePicker — open / close behaviour', () => {
  it('clicking the trigger opens the panel', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A],
      }),
    )
    const trigger = el.querySelector(
      'button[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    act(() => trigger.click())
    expect(el.querySelector('[data-testid="template-picker-panel"]')).not.toBeNull()
    expect(trigger.getAttribute('data-state')).toBe('open')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('clicking the trigger again closes the panel (idempotent toggle)', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK],
      }),
    )
    const trigger = el.querySelector(
      'button[data-testid="template-picker-trigger"]',
    ) as HTMLButtonElement
    act(() => trigger.click())
    act(() => trigger.click())
    expect(el.querySelector('[data-testid="template-picker-panel"]')).toBeNull()
  })

  it('Escape key closes an open panel', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK],
        initialOpen: true,
      }),
    )
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(el.querySelector('[data-testid="template-picker-panel"]')).toBeNull()
  })

  it('outside-click closes the panel', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK],
        initialOpen: true,
      }),
    )
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="template-picker-panel"]')).toBeNull()
    outside.remove()
  })

  it('clicking INSIDE the panel does NOT close it', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A],
        initialOpen: true,
      }),
    )
    const panel = el.querySelector('[data-testid="template-picker-panel"]')!
    act(() => {
      panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="template-picker-panel"]')).not.toBeNull()
  })
})

describe('TemplatePicker — sections', () => {
  it('always shows the Blank section', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK],
        initialOpen: true,
      }),
    )
    expect(el.querySelector('[data-testid="template-picker-section-blank"]')).not.toBeNull()
  })

  it('hides empty Saved, Stock and Workshop sections', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK],
        initialOpen: true,
      }),
    )
    expect(el.querySelector('[data-testid="template-picker-section-saved"]')).toBeNull()
    expect(el.querySelector('[data-testid="template-picker-section-stock"]')).toBeNull()
    expect(el.querySelector('[data-testid="template-picker-section-workshop"]')).toBeNull()
  })

  it('shows the Saved section when at least one saved option is provided', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A],
        initialOpen: true,
      }),
    )
    const saved = el.querySelector('[data-testid="template-picker-section-saved"]')
    expect(saved).not.toBeNull()
    expect(saved!.textContent).toContain('Desert Fox')
  })

  it('shows the Stock section when at least one stock option is provided', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, STOCK_A],
        initialOpen: true,
      }),
    )
    const stock = el.querySelector('[data-testid="template-picker-section-stock"]')
    expect(stock).not.toBeNull()
    expect(stock!.textContent).toContain('ArtBritish')
  })

  it('shows the Workshop section when at least one workshop option is provided', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, WORKSHOP_A],
        initialOpen: true,
      }),
    )
    const workshop = el.querySelector('[data-testid="template-picker-section-workshop"]')
    expect(workshop).not.toBeNull()
    expect(workshop!.textContent).toContain('Workshop #1234567890')
  })

  it('renders sections in the order: blank → saved → stock → workshop', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A, STOCK_A, WORKSHOP_A],
        initialOpen: true,
      }),
    )
    const panel = el.querySelector('[data-testid="template-picker-panel"]')!
    const sections = panel.querySelectorAll('[data-testid^="template-picker-section-"]')
    const sectionKinds = Array.from(sections).map(s =>
      s.getAttribute('data-testid')!.replace('template-picker-section-', ''),
    )
    expect(sectionKinds).toEqual(['blank', 'saved', 'stock', 'workshop'])
  })

  it('renders all options under their sections in the given order', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A, SAVED_B, WORKSHOP_A],
        initialOpen: true,
      }),
    )
    const savedSection = el.querySelector('[data-testid="template-picker-section-saved"]')!
    const savedOptions = savedSection.querySelectorAll('button[role="option"]')
    expect(savedOptions).toHaveLength(2)
    // Order preserved from the props array.
    expect(savedOptions[0].textContent).toContain('Desert Fox')
    expect(savedOptions[1].textContent).toContain('Eastern Front')
  })

  it('shows option hints next to the name', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A],
        initialOpen: true,
      }),
    )
    const opt = el.querySelector(`[data-testid="template-picker-option-${SAVED_A.id}"]`)!
    expect(opt.textContent).toContain('12 layers · 2 days ago')
  })

  it('marks the currently-selected option with aria-selected="true"', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: SAVED_A.id,
        onChange: () => {},
        options: [BLANK, SAVED_A, SAVED_B],
        initialOpen: true,
      }),
    )
    const selected = el.querySelector(`[data-testid="template-picker-option-${SAVED_A.id}"]`)!
    const notSelected = el.querySelector(`[data-testid="template-picker-option-${SAVED_B.id}"]`)!
    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(notSelected.getAttribute('aria-selected')).toBe('false')
  })
})

describe('TemplatePicker — selection', () => {
  it('clicking an option fires onChange with the full TemplateOption', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange,
        options: [BLANK, SAVED_A],
        initialOpen: true,
      }),
    )
    const opt = el.querySelector(
      `[data-testid="template-picker-option-${SAVED_A.id}"]`,
    ) as HTMLButtonElement
    act(() => opt.click())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(SAVED_A)
  })

  it('clicking an option also closes the panel', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A],
        initialOpen: true,
      }),
    )
    const opt = el.querySelector(
      `[data-testid="template-picker-option-${SAVED_A.id}"]`,
    ) as HTMLButtonElement
    act(() => opt.click())
    expect(el.querySelector('[data-testid="template-picker-panel"]')).toBeNull()
  })
})

describe('TemplatePicker — hover preview', () => {
  it('hovering an option mounts the preview tooltip with the thumbnail', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A],
        initialOpen: true,
      }),
    )
    const opt = el.querySelector(`[data-testid="template-picker-option-${SAVED_A.id}"]`)!
    act(() => {
      // React's onMouseEnter is synthesised from `mouseover` (which
      // bubbles) at the document root — mouseenter itself doesn't bubble
      // so dispatching it directly on the option never reaches React's
      // listener. Dispatch `mouseover` instead.
      opt.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    const preview = el.querySelector('[data-testid="template-picker-preview"]')!
    expect(preview).not.toBeNull()
    expect(preview.textContent).toContain('Desert Fox')
    const img = preview.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe(SAVED_A.thumbnail)
  })

  it('shows a "no preview" placeholder when the option has no thumbnail', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_B], // SAVED_B.thumbnail = null
        initialOpen: true,
      }),
    )
    const opt = el.querySelector(`[data-testid="template-picker-option-${SAVED_B.id}"]`)!
    act(() => {
      // React's onMouseEnter is synthesised from `mouseover` (which
      // bubbles) at the document root — mouseenter itself doesn't bubble
      // so dispatching it directly on the option never reaches React's
      // listener. Dispatch `mouseover` instead.
      opt.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    const preview = el.querySelector('[data-testid="template-picker-preview"]')!
    expect(preview.querySelector('img')).toBeNull()
    expect(preview.textContent).toContain('No preview')
  })

  it('mouse-leaving the option dismounts the preview tooltip', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A],
        initialOpen: true,
      }),
    )
    const opt = el.querySelector(`[data-testid="template-picker-option-${SAVED_A.id}"]`)!
    act(() => {
      // React's onMouseEnter is synthesised from `mouseover` (which
      // bubbles) at the document root — mouseenter itself doesn't bubble
      // so dispatching it directly on the option never reaches React's
      // listener. Dispatch `mouseover` instead.
      opt.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="template-picker-preview"]')).not.toBeNull()
    act(() => {
      // Same caveat as mouseenter — leave is synthesised from `mouseout`.
      opt.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="template-picker-preview"]')).toBeNull()
  })

  it('preview tooltip shows the source badge for the option kind', () => {
    const el = render(
      createElement(TemplatePicker, {
        value: 'blank',
        onChange: () => {},
        options: [BLANK, SAVED_A, STOCK_A, WORKSHOP_A],
        initialOpen: true,
      }),
    )
    // Hover the saved option. (mouseover bubbles — React synthesises
    // mouseenter from it at the document root.)
    const savedOpt = el.querySelector(`[data-testid="template-picker-option-${SAVED_A.id}"]`)!
    act(() => {
      savedOpt.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="template-picker-preview"]')!.textContent).toContain(
      'Saved project',
    )
    // Hover the stock option.
    act(() => {
      savedOpt.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    })
    const stockOpt = el.querySelector(`[data-testid="template-picker-option-${STOCK_A.id}"]`)!
    act(() => {
      stockOpt.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="template-picker-preview"]')!.textContent).toContain(
      'Game files',
    )
    // Hover the workshop option.
    act(() => {
      stockOpt.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    })
    const workshopOpt = el.querySelector(`[data-testid="template-picker-option-${WORKSHOP_A.id}"]`)!
    act(() => {
      workshopOpt.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="template-picker-preview"]')!.textContent).toContain(
      'Workshop',
    )
  })
})
