/**
 * Tests for GenerateButton — the bottom-row "Generate" CTA that opens
 * the AI camo / decal / image modal.
 *
 * Pinned contract:
 *   1. A single button renders with text "Generate" and a leading icon.
 *   2. type="button" so a future wrapping <form> can't submit by accident.
 *   3. aria-label + title clearly communicate the AI surface ("camo
 *      generator") so screen-reader / hover-tooltip users know what
 *      the sparkle icon means.
 *   4. Clicking fires the onClick handler exactly once.
 *   5. `disabled={true}` blocks the click (onClick is NOT called) AND
 *      the underlying <button> reflects the disabled attribute. We pin
 *      this because the parent uses `disabled` to prevent double-firing
 *      while a generation is already in flight.
 *   6. Omitting onClick does not crash on click — it's an optional prop.
 *   7. The button is wrapped in BorderBeam so the ocean sweep is always
 *      visible (this is what tells the user "AI feature" at a glance).
 *      We pin the structural wiring (button is a descendant of an
 *      element carrying BorderBeam's class system) so a refactor can't
 *      strip the visual without us noticing.
 *
 * Test infra: React 19 createRoot + act, real BorderBeam (no mock).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import GenerateButton from '../GenerateButton'

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  onClick?: () => void
  disabled?: boolean
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(GenerateButton, { onClick: props.onClick, disabled: props.disabled }),
    )
  })
  return container!
}

function generateBtn(): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Generate'),
    ) as HTMLButtonElement | undefined) ?? null
  )
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

describe('GenerateButton — render', () => {
  it('renders a button with text "Generate"', () => {
    render()
    expect(generateBtn()).not.toBeNull()
    expect(generateBtn()!.textContent).toContain('Generate')
  })

  it('uses type="button" so a wrapping form cannot submit by accident', () => {
    render()
    expect(generateBtn()!.getAttribute('type')).toBe('button')
  })

  it('renders the leading Sparkles icon (svg child)', () => {
    render()
    // lucide-react Sparkles renders as an <svg>.
    expect(generateBtn()!.querySelector('svg')).not.toBeNull()
  })
})

describe('GenerateButton — accessibility', () => {
  it('carries aria-label="Open AI camo generator"', () => {
    render()
    expect(generateBtn()!.getAttribute('aria-label')).toBe('Open AI camo generator')
  })

  it('carries the hover-tooltip title="Generate camo with AI"', () => {
    render()
    expect(generateBtn()!.getAttribute('title')).toBe('Generate camo with AI')
  })
})

describe('GenerateButton — click wiring', () => {
  it('clicking fires onClick exactly once', () => {
    const onClick = vi.fn()
    render({ onClick })
    act(() => {
      generateBtn()!.click()
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('omitting onClick does not crash on click (optional prop)', () => {
    render() // no onClick
    expect(() => {
      act(() => {
        generateBtn()!.click()
      })
    }).not.toThrow()
  })
})

describe('GenerateButton — disabled state', () => {
  it('disabled=true marks the button disabled and blocks onClick', () => {
    const onClick = vi.fn()
    render({ onClick, disabled: true })
    expect(generateBtn()!.disabled).toBe(true)
    act(() => {
      generateBtn()!.click()
    })
    // Native <button disabled> swallows click events — onClick must not
    // fire even if we dispatch it manually.
    expect(onClick).not.toHaveBeenCalled()
  })

  it('disabled defaults to false (button is clickable on mount)', () => {
    const onClick = vi.fn()
    render({ onClick })
    expect(generateBtn()!.disabled).toBe(false)
    act(() => {
      generateBtn()!.click()
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('GenerateButton — BorderBeam wrapper', () => {
  it('the button sits inside a BorderBeam wrapper element', () => {
    render()
    // BorderBeam's outer element carries the .inline-flex class we
    // passed via `className`. Walk up from the button until we find a
    // parent with that class — confirms the visual wrapper hasn't been
    // accidentally stripped.
    let cur: HTMLElement | null = generateBtn()
    let found = false
    while (cur && cur !== document.body) {
      if (cur !== generateBtn() && cur.classList.contains('inline-flex')) {
        found = true
        break
      }
      cur = cur.parentElement
    }
    expect(found).toBe(true)
  })
})
