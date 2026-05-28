/**
 * Tests for LiveSyncBadge.
 *
 * The badge is a single round icon button that maps a `LiveSyncSnapshot`
 * to one of five icons + colours. These tests pin:
 *
 *   1. Icon mapping for all six states (idle, synced, syncing, queued,
 *      error, disabled).
 *   2. Variant prop — `dock` (44×44 glass) vs `inline` (28×28 bare).
 *   3. Label composition for enabled vs disabled snapshots.
 *   4. Click → `actions.toggle` wiring (the *only* user action; per Round-3
 *      feedback there is no menu).
 *   5. aria + data attributes the integration tests rely on
 *      (`data-testid`, `data-state`, `aria-pressed`, `aria-label`, `title`).
 *
 * Uses React 19 createRoot + act, mocks `@/lib/live-sync.useLiveSync`
 * with a controllable `vi.fn()` so each case can stage its own snapshot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// ── Module mock ──────────────────────────────────────────────────────────────

// `useLiveSync` is the *only* surface the badge imports from the module.
// Make it a `vi.fn()` so each test can call mockReturnValue() to stage a
// custom LiveSyncSnapshot.
const useLiveSyncMock = vi.fn()
vi.mock('@/lib/live-sync', () => ({
  useLiveSync: () => useLiveSyncMock(),
}))

import LiveSyncBadge from '../LiveSyncBadge'
import type { LiveSyncState } from '@/lib/live-sync'

// ── Test infra ───────────────────────────────────────────────────────────────

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

interface SnapshotOverrides {
  state?: LiveSyncState
  reason?: string
  enabled?: boolean
  toggle?: () => void
  connectInstall?: () => Promise<void>
}

function stageSnapshot(o: SnapshotOverrides = {}) {
  const toggle = o.toggle ?? vi.fn()
  const connectInstall = o.connectInstall ?? vi.fn().mockResolvedValue(undefined)
  const snapshot = {
    state: o.state ?? 'disabled',
    reason: o.reason ?? 'Live Sync is disabled',
    enabled: o.enabled ?? false,
    actions: {
      toggle,
      syncNow: vi.fn(),
      connectInstall,
    },
  }
  useLiveSyncMock.mockReturnValue(snapshot)
  return { snapshot, toggle, connectInstall }
}

function badge(el: HTMLElement): HTMLButtonElement {
  const btn = el.querySelector('[data-testid="live-sync-badge"]')
  if (!btn) throw new Error('LiveSyncBadge not rendered')
  return btn as HTMLButtonElement
}

beforeEach(() => {
  useLiveSyncMock.mockReset()
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

// ── Icon-mapping table ───────────────────────────────────────────────────────

describe('LiveSyncBadge — state → icon mapping', () => {
  // Maps state → (icon classname fragment, color classname fragment) we
  // expect to find on the rendered <svg>. lucide-react renders <svg
  // class="lucide lucide-check-circle-2 text-emerald-400" …>, so we look
  // for both the icon's slug and the colour utility together.
  const cases: Array<{
    state: LiveSyncState
    iconSlug: string
    colorClass: string
  }> = [
    { state: 'idle', iconSlug: 'circle-check', colorClass: 'text-emerald-400' },
    { state: 'synced', iconSlug: 'circle-check', colorClass: 'text-emerald-400' },
    { state: 'syncing', iconSlug: 'loader', colorClass: 'text-sky-400' },
    { state: 'queued', iconSlug: 'circle', colorClass: 'text-amber-400' },
    { state: 'error', iconSlug: 'circle-x', colorClass: 'text-red-400' },
    { state: 'disabled', iconSlug: 'power', colorClass: 'text-white/40' },
  ]

  it.each(cases)('state=$state renders $iconSlug with $colorClass', ({ state, colorClass }) => {
    stageSnapshot({ state, enabled: state !== 'disabled' })
    const el = render(createElement(LiveSyncBadge))
    const svg = badge(el).querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('class')).toContain(colorClass)
  })

  it('syncing icon spins (animate-spin class present)', () => {
    stageSnapshot({ state: 'syncing', enabled: true })
    const el = render(createElement(LiveSyncBadge))
    const svg = badge(el).querySelector('svg')
    expect(svg!.getAttribute('class')).toContain('animate-spin')
  })

  it('queued icon is fill="currentColor"', () => {
    stageSnapshot({ state: 'queued', enabled: true })
    const el = render(createElement(LiveSyncBadge))
    // The Circle component accepts fill on the path/circle, but the prop
    // is forwarded so the rendered <svg> should carry it on the inner
    // <circle>. Check that *something* has fill=currentColor to keep the
    // assertion robust against lucide internal markup changes.
    const filled = badge(el).querySelector('[fill="currentColor"]')
    expect(filled).not.toBeNull()
  })
})

// ── Variant prop ─────────────────────────────────────────────────────────────

describe('LiveSyncBadge — variant prop', () => {
  it('dock variant (default) is 44×44 with glass background', () => {
    stageSnapshot()
    const el = render(createElement(LiveSyncBadge))
    const btn = badge(el)
    expect(btn.style.width).toBe('44px')
    expect(btn.style.height).toBe('44px')
    expect(btn.style.background).toContain('20, 22, 28')
    expect(btn.style.border).toContain('255')
  })

  it('inline variant is 28×28 with transparent background', () => {
    stageSnapshot()
    const el = render(createElement(LiveSyncBadge, { variant: 'inline' }))
    const btn = badge(el)
    expect(btn.style.width).toBe('28px')
    expect(btn.style.height).toBe('28px')
    expect(btn.style.background).toBe('transparent')
    // jsdom returns 'medium' (the default border-width keyword) for the
    // shorthand `.style.border` when `border: 'none'` is set inline, so
    // assert the parsed long-hand instead.
    expect(btn.style.borderStyle).toBe('none')
  })

  it('inline variant uses the hover:bg utility (no scale-only hover)', () => {
    stageSnapshot()
    const el = render(createElement(LiveSyncBadge, { variant: 'inline' }))
    const cls = badge(el).className
    expect(cls).toContain('hover:bg-white/10')
  })

  it('dock variant has no hover:bg utility (relies on glass + scale)', () => {
    stageSnapshot()
    const el = render(createElement(LiveSyncBadge, { variant: 'dock' }))
    const cls = badge(el).className
    expect(cls).not.toContain('hover:bg-white/10')
  })
})

// ── Label composition ────────────────────────────────────────────────────────

describe('LiveSyncBadge — labels & aria', () => {
  it('enabled snapshot: label = "Live Sync — <reason>"', () => {
    stageSnapshot({ state: 'synced', reason: 'Synced just now', enabled: true })
    const el = render(createElement(LiveSyncBadge))
    const btn = badge(el)
    expect(btn.getAttribute('title')).toBe('Live Sync — Synced just now')
    expect(btn.getAttribute('aria-label')).toBe('Live Sync — Synced just now')
  })

  it('disabled snapshot: label = "Live Sync is off — click to enable"', () => {
    stageSnapshot({ state: 'disabled', reason: 'whatever', enabled: false })
    const el = render(createElement(LiveSyncBadge))
    const btn = badge(el)
    expect(btn.getAttribute('title')).toBe('Live Sync is off — click to enable')
    expect(btn.getAttribute('aria-label')).toBe('Live Sync is off — click to enable')
  })

  it('aria-pressed mirrors enabled', () => {
    stageSnapshot({ enabled: true, state: 'idle' })
    let el = render(createElement(LiveSyncBadge))
    expect(badge(el).getAttribute('aria-pressed')).toBe('true')

    stageSnapshot({ enabled: false, state: 'disabled' })
    el = render(createElement(LiveSyncBadge))
    expect(badge(el).getAttribute('aria-pressed')).toBe('false')
  })

  it('data-state attribute reflects current state (lets integration tests pin behaviour)', () => {
    stageSnapshot({ state: 'queued', enabled: true })
    const el = render(createElement(LiveSyncBadge))
    expect(badge(el).getAttribute('data-state')).toBe('queued')
  })
})

// ── Click wiring ─────────────────────────────────────────────────────────────

describe('LiveSyncBadge — click', () => {
  it('click invokes actions.toggle exactly once', () => {
    const { toggle } = stageSnapshot({ state: 'disabled', enabled: false })
    const el = render(createElement(LiveSyncBadge))
    const btn = badge(el)
    act(() => {
      btn.click()
    })
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('click while enabled also invokes toggle (no separate sync path — Round-3 simplification)', () => {
    const { toggle } = stageSnapshot({ state: 'synced', enabled: true })
    const el = render(createElement(LiveSyncBadge))
    act(() => {
      badge(el).click()
    })
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  // Recovery path pinned after a user-reported confusion: with Live
  // Sync enabled from a previous session AND no mods-folder handle
  // stored, the manager sits in state=error with the
  // "Pick your CoH2 mods folder" reason. The natural click is
  // "give it the folder it's asking for" — but the default toggle
  // would instead DISABLE Live Sync, making the user click twice
  // for what should be a single recovery gesture. The badge detects
  // that exact error reason and routes the click to connectInstall
  // (which re-fires the directory picker) so the click matches the
  // tooltip.
  it('error state with "mods folder" reason routes click → connectInstall (not toggle)', () => {
    const { toggle, connectInstall } = stageSnapshot({
      state: 'error',
      reason: 'Live Sync needs one more folder — click here to pick your CoH2 mods folder',
      enabled: true,
    })
    const el = render(createElement(LiveSyncBadge))
    act(() => {
      badge(el).click()
    })
    expect(connectInstall).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('error state with non-mods-folder reason still routes click → toggle', () => {
    // Other error reasons ("Sync failed: …", "Close CoH2 to sync …",
    // "Reconnect to your CoH2 install — permission lapsed") are not
    // fixable by re-picking the mods folder, so the badge falls back
    // to the regular toggle.
    const { toggle, connectInstall } = stageSnapshot({
      state: 'error',
      reason: 'Close CoH2 to sync — the mod file is locked by the game',
      enabled: true,
    })
    const el = render(createElement(LiveSyncBadge))
    act(() => {
      badge(el).click()
    })
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(connectInstall).not.toHaveBeenCalled()
  })

  it('idle / synced / queued / syncing always route click → toggle (only error+mods recovers)', () => {
    for (const state of ['idle', 'synced', 'queued', 'syncing'] as const) {
      const { toggle, connectInstall } = stageSnapshot({
        state,
        // Same wording as the recovery state, just to prove the
        // gating is state-aware (not just reason-aware).
        reason: 'mods folder mods folder mods folder',
        enabled: true,
      })
      const el = render(createElement(LiveSyncBadge))
      act(() => {
        badge(el).click()
      })
      expect(toggle, `state=${state} should still call toggle`).toHaveBeenCalledTimes(1)
      expect(connectInstall, `state=${state} should NOT call connectInstall`).not.toHaveBeenCalled()
      // Re-render rebuild for next iter
      act(() => root!.unmount())
      root = null
      container?.remove()
      container = null
    }
  })
})

// ── iconPicker prop (inventory icon popover) ─────────────────────────────────

describe('LiveSyncBadge — iconPicker popover', () => {
  it('does NOT render a popover by default (no iconPicker prop)', () => {
    stageSnapshot({ state: 'synced', enabled: true })
    const el = render(createElement(LiveSyncBadge))
    act(() => badge(el).click())
    expect(el.querySelector('[data-testid="live-sync-popover"]')).toBeNull()
  })

  it('with iconPicker, clicking the badge while enabled opens the popover instead of toggling', () => {
    const { toggle } = stageSnapshot({ state: 'synced', enabled: true })
    const onSet = vi.fn()
    const el = render(createElement(LiveSyncBadge, { iconPicker: { current: null, onSet } }))

    act(() => badge(el).click())

    // Toggle MUST NOT fire — the click opens the popover instead.
    expect(toggle).not.toHaveBeenCalled()
    expect(el.querySelector('[data-testid="live-sync-popover"]')).not.toBeNull()
  })

  it('first click on a DISABLED badge with iconPicker still enables (does not open popover)', () => {
    // The popover only makes sense once Live Sync is on. A user clicking
    // a disabled badge wants to ENABLE first; opening a popover on a
    // disabled badge would be confusing.
    const { toggle } = stageSnapshot({ state: 'disabled', enabled: false })
    const onSet = vi.fn()
    const el = render(createElement(LiveSyncBadge, { iconPicker: { current: null, onSet } }))

    act(() => badge(el).click())

    expect(toggle).toHaveBeenCalledTimes(1)
    expect(el.querySelector('[data-testid="live-sync-popover"]')).toBeNull()
  })

  it('popover renders the current status reason', () => {
    stageSnapshot({ state: 'synced', enabled: true, reason: 'Synced 30 s ago' })
    const onSet = vi.fn()
    const el = render(createElement(LiveSyncBadge, { iconPicker: { current: null, onSet } }))
    act(() => badge(el).click())
    const reasonEl = el.querySelector('[data-testid="live-sync-popover-reason"]')
    expect(reasonEl?.textContent).toBe('Synced 30 s ago')
  })

  it('popover preview chip shows the current icon when supplied', () => {
    stageSnapshot({ state: 'synced', enabled: true })
    const onSet = vi.fn()
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const el = render(createElement(LiveSyncBadge, { iconPicker: { current: dataUrl, onSet } }))
    act(() => badge(el).click())
    const preview = el.querySelector('[data-testid="live-sync-icon-preview"]') as HTMLElement
    expect(preview).not.toBeNull()
    // background should reference the supplied data URL
    expect(preview.style.background).toContain('data:image/png')
  })

  it('Reset button calls onSet(null) and only renders when an icon is set', () => {
    const onSet = vi.fn()
    // Case A: no current icon — Reset should be absent.
    stageSnapshot({ state: 'synced', enabled: true })
    let el = render(createElement(LiveSyncBadge, { iconPicker: { current: null, onSet } }))
    act(() => badge(el).click())
    expect(el.querySelector('[data-testid="live-sync-icon-reset"]')).toBeNull()

    // Tear down + re-render Case B
    act(() => root!.unmount())
    root = null
    container?.remove()
    container = null

    stageSnapshot({ state: 'synced', enabled: true })
    el = render(
      createElement(LiveSyncBadge, {
        iconPicker: { current: 'data:image/png;base64,xx', onSet },
      }),
    )
    act(() => badge(el).click())
    const reset = el.querySelector('[data-testid="live-sync-icon-reset"]') as HTMLButtonElement
    expect(reset).not.toBeNull()
    act(() => reset.click())
    expect(onSet).toHaveBeenCalledWith(null)
  })

  // v1.0 policy: Live Sync is permanently on, so the "Disable Live Sync"
  // button was intentionally removed from the popover. This regression
  // test pins that the button stays absent from the rendered popover so a
  // future revert can't reintroduce the disable surface by accident.
  it('Disable Live Sync button is removed from the popover (v1.0 always-on policy)', () => {
    stageSnapshot({ state: 'synced', enabled: true })
    const onSet = vi.fn()
    const el = render(createElement(LiveSyncBadge, { iconPicker: { current: null, onSet } }))
    act(() => badge(el).click())
    expect(el.querySelector('[data-testid="live-sync-popover"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="live-sync-disable"]')).toBeNull()
  })

  it('Escape key closes an open popover', () => {
    stageSnapshot({ state: 'synced', enabled: true })
    const onSet = vi.fn()
    const el = render(createElement(LiveSyncBadge, { iconPicker: { current: null, onSet } }))
    act(() => badge(el).click())
    expect(el.querySelector('[data-testid="live-sync-popover"]')).not.toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(el.querySelector('[data-testid="live-sync-popover"]')).toBeNull()
  })

  it('aria-haspopup is set to "dialog" when iconPicker is passed', () => {
    stageSnapshot({ state: 'synced', enabled: true })
    const el = render(
      createElement(LiveSyncBadge, { iconPicker: { current: null, onSet: vi.fn() } }),
    )
    expect(badge(el).getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('aria-haspopup is NOT set without iconPicker', () => {
    stageSnapshot({ state: 'synced', enabled: true })
    const el = render(createElement(LiveSyncBadge))
    expect(badge(el).getAttribute('aria-haspopup')).toBeNull()
  })
})
