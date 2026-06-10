/**
 * Tests for OnboardingOverlay — the first-run 4-step tour the Editor
 * mounts at the root.
 *
 * Pinned contract:
 *   1. SELF-GATES — overlay only mounts on first run. We pin both
 *      reasons it could stay hidden:
 *        a) `coh2-skin-editor:onboarded-v3` is already '1' (returning
 *           user)
 *        b) Any `coh2.project.*` key exists (user has saved projects, so
 *           they're not first-run even if the onboarded flag was wiped)
 *           — overlay self-stamps the onboarded flag in this case so it
 *           won't reappear next launch either.
 *   2. The overlay NEVER auto-opens — it was an intrusive full-screen
 *      modal that blocked the editor on first launch. First-run users
 *      are silently stamped onboarded. ?tour=1 in the URL is the only
 *      way to summon it (the "replay tour" escape hatch).
 *   3. Once summoned via ?tour=1, the overlay opens after a 600 ms
 *      setTimeout (lets the editor settle its initial paint).
 *   4. Four steps, each with its own title:
 *        Pick a vehicle → Apply a camo → Paint by hand → Place decals
 *      Counter reads "1 / 4" … "4 / 4".
 *   5. back button is disabled on step 0; next steps forward; on the
 *      LAST step the primary CTA becomes "Start designing" instead of
 *      "next →".
 *   6. Dismissing (skip, backdrop click, Escape, Enter, Start
 *      designing) writes '1' to the v3 storage key and hides the
 *      overlay.
 *   7. The v1 and v2 storage keys are NOT consulted — the bump to v3
 *      is what re-shows the tour once for users who already dismissed
 *      the older 4-step tour, so the new "Edit texture" pill copy
 *      (and FlipHorizontal2 symmetry note) gets a single airing.
 *
 * Test infra: React 19 createRoot + act + vi.useFakeTimers for the
 * 600 ms open delay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import OnboardingOverlay from '../OnboardingOverlay'

const STORAGE_KEY = 'coh2-skin-editor:onboarded-v3'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(OnboardingOverlay))
  })
  return container!
}

function panel(): HTMLElement | null {
  // The overlay panel carries the .glass-3 utility — that's the
  // cleanest selector for the dialog box itself.
  return document.querySelector('.glass-3') as HTMLElement | null
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === text) as
      | HTMLButtonElement
      | undefined) ?? null
  )
}

function bodyText(): string {
  return panel()?.textContent ?? ''
}

function setUrl(search: string) {
  // jsdom supports window.history.replaceState — this is the easiest
  // way to make `new URLSearchParams(window.location.search)` see what
  // we want.
  window.history.replaceState(null, '', `${window.location.pathname}${search}`)
}

beforeEach(() => {
  vi.useFakeTimers()
  // Clean every key our tests touch so prior runs don't leak in.
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('coh2-skin-editor:onboarded-v1')
    // wipe any stray project keys from earlier tests
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('coh2.project.')) localStorage.removeItem(k)
    }
  } catch {
    /* ignore */
  }
  setUrl('')
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OnboardingOverlay — gating', () => {
  it('returns null when the v3 onboarded flag is already set', () => {
    localStorage.setItem(STORAGE_KEY, '1')
    render()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(panel()).toBeNull()
  })

  it('returns null when a saved project exists, and stamps the flag', () => {
    localStorage.setItem('coh2.project.somepack', JSON.stringify({ name: 'x' }))
    render()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(panel()).toBeNull()
    // Stamping the flag means the next launch (no project) still won't
    // show the tour — pin that side-effect.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('does NOT auto-open on first run; it stamps the v3 flag instead', () => {
    // The intrusive full-screen tour no longer auto-pops. First-run users
    // are marked onboarded so nothing re-triggers it, and the editor is
    // never blocked on launch.
    render()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(panel()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('does not auto-open even with a stale v1 flag; stamps v3', () => {
    localStorage.setItem('coh2-skin-editor:onboarded-v1', '1')
    render()
    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(panel()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('does not auto-open even with a stale v2 flag; stamps v3', () => {
    localStorage.setItem('coh2-skin-editor:onboarded-v2', '1')
    render()
    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(panel()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('?tour=1 forces the overlay even with the onboarded flag set + a saved project', () => {
    localStorage.setItem(STORAGE_KEY, '1')
    localStorage.setItem('coh2.project.somepack', JSON.stringify({ name: 'x' }))
    setUrl('?tour=1')
    render()
    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(panel()).not.toBeNull()
  })
})

describe('OnboardingOverlay — steps', () => {
  function openTour() {
    // The tour no longer auto-opens; ?tour=1 is the only way it appears.
    setUrl('?tour=1')
    render()
    act(() => {
      vi.advanceTimersByTime(700)
    })
  }

  it('starts on step 1 / 4 with the "Pick a vehicle" title', () => {
    openTour()
    expect(bodyText()).toContain('Pick a vehicle')
    expect(bodyText()).toContain('1 / 4')
    // back is disabled on the first step.
    expect(buttonByText('← back')!.disabled).toBe(true)
  })

  it('next → advances to step 2 ("Apply a camo")', () => {
    openTour()
    act(() => {
      buttonByText('next →')!.click()
    })
    expect(bodyText()).toContain('Apply a camo')
    expect(bodyText()).toContain('2 / 4')
    expect(buttonByText('← back')!.disabled).toBe(false)
  })

  it('walks all four steps in order', () => {
    openTour()
    expect(bodyText()).toContain('Pick a vehicle')
    act(() => {
      buttonByText('next →')!.click()
    })
    expect(bodyText()).toContain('Apply a camo')
    act(() => {
      buttonByText('next →')!.click()
    })
    expect(bodyText()).toContain('Paint by hand')
    act(() => {
      buttonByText('next →')!.click()
    })
    expect(bodyText()).toContain('Place decals + export')
    expect(bodyText()).toContain('4 / 4')
  })

  it('on the last step the CTA flips from "next →" to "Start designing"', () => {
    openTour()
    act(() => {
      buttonByText('next →')!.click()
      buttonByText('next →')!.click()
      buttonByText('next →')!.click()
    })
    expect(buttonByText('next →')).toBeNull()
    expect(buttonByText('Start designing')).not.toBeNull()
  })

  it('back ← walks the step counter down', () => {
    openTour()
    act(() => {
      buttonByText('next →')!.click()
      buttonByText('next →')!.click()
    })
    expect(bodyText()).toContain('3 / 4')
    act(() => {
      buttonByText('← back')!.click()
    })
    expect(bodyText()).toContain('2 / 4')
    act(() => {
      buttonByText('← back')!.click()
    })
    expect(bodyText()).toContain('1 / 4')
    expect(buttonByText('← back')!.disabled).toBe(true)
  })
})

describe('OnboardingOverlay — dismiss paths', () => {
  function openTour() {
    // The tour no longer auto-opens; ?tour=1 is the only way it appears.
    setUrl('?tour=1')
    render()
    act(() => {
      vi.advanceTimersByTime(700)
    })
  }

  it('"skip" button hides the overlay AND stamps the v3 flag', () => {
    openTour()
    expect(panel()).not.toBeNull()
    act(() => {
      buttonByText('skip')!.click()
    })
    expect(panel()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('clicking the backdrop dismisses', () => {
    openTour()
    const backdrop = document.querySelector('[aria-label="Dismiss onboarding"]') as HTMLElement
    expect(backdrop).not.toBeNull()
    act(() => {
      backdrop.click()
    })
    expect(panel()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('Escape on the backdrop dismisses', () => {
    openTour()
    const backdrop = document.querySelector('[aria-label="Dismiss onboarding"]') as HTMLElement
    act(() => {
      backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(panel()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('Enter on the backdrop dismisses (keyboard accessibility)', () => {
    openTour()
    const backdrop = document.querySelector('[aria-label="Dismiss onboarding"]') as HTMLElement
    act(() => {
      backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(panel()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('"Start designing" on the last step dismisses', () => {
    openTour()
    act(() => {
      buttonByText('next →')!.click()
      buttonByText('next →')!.click()
      buttonByText('next →')!.click()
    })
    expect(buttonByText('Start designing')).not.toBeNull()
    act(() => {
      buttonByText('Start designing')!.click()
    })
    expect(panel()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })
})
