/**
 * Tests for ConnectScreen — loading state UX
 *
 * Verifies the loading-state machine:
 *   idle  → button shows "Connect CoH2 install" text, no progress fill
 *   busy  → button shows spinner (no text), green progress fill appears
 *   success → green tick visible
 *
 * We test the rendered DOM structure directly; no actual async I/O is
 * needed (all external deps are mocked).
 *
 * Test infra: React 19 createRoot + act, jsdom.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// React 19 requires opt-in for act() to flush scheduled state updates.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── jsdom global shims ─────────────────────────────────────────────────────
// ConnectScreen mounts a lazy <Viewport> (WebGL) that we must never actually
// initialise; stub FileSystem Access API helpers so they can be controlled.
beforeEach(() => {
  // ResizeObserver
  if (!(window as Window & { ResizeObserver?: unknown }).ResizeObserver) {
    class StubResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    ;(window as Window & { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver
  }
})

// ── Module mocks ──────────────────────────────────────────────────────────

// Viewport — lazy import that would pull in Three.js; stub with a plain div
vi.mock('../Viewport', () => ({
  __esModule: true,
  default: () => createElement('div', { 'data-testid': 'viewport-stub' }),
}))

// coh2-fs helpers
vi.mock('@/lib/coh2-fs', () => ({
  isSupported: () => true,
  locateArchives: vi.fn().mockResolvedValue({}),
  pickInstall: vi.fn().mockResolvedValue({ name: 'Company of Heroes 2' }),
}))

// native-fs helpers — isElectron returns false so we stay in browser path
vi.mock('@/lib/native-fs', () => ({
  isElectron: () => false,
  detectInstallPath: vi.fn().mockResolvedValue(null),
  pickInstallPathNative: vi.fn().mockResolvedValue(null),
  nativePathToHandle: vi.fn(),
  initSteamNative: vi.fn(),
}))

// preload — resolve immediately so the test controls timing
vi.mock('@/lib/preload', () => ({
  preloadFaction: vi.fn().mockResolvedValue(undefined),
}))

const { default: ConnectScreen } = await import('../ConnectScreen')

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  const onConnected = vi.fn()
  act(() => {
    root!.render(
      createElement(ConnectScreen, { onConnected }),
    )
  })
  return { container: container!, onConnected }
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
  vi.clearAllMocks()
})

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Find the connect button (the primary <button> inside a .bb-pressable). */
function connectBtn(): HTMLButtonElement | null {
  return container!.querySelector('button.bb-connect') as HTMLButtonElement | null
}

/** Find the green progress fill span (data-connect-fill). */
function progressFill(): HTMLElement | null {
  return container!.querySelector('[data-connect-fill]') as HTMLElement | null
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConnectScreen — idle state', () => {
  it('renders the connect button', () => {
    render()
    expect(connectBtn()).not.toBeNull()
  })

  it('shows "Connect CoH2 install" text in the button at idle', () => {
    render()
    expect(connectBtn()!.textContent).toContain('Connect CoH2 install')
  })

  it('does NOT show the green progress fill bar at idle', () => {
    render()
    expect(progressFill()).toBeNull()
  })

  it('button is not disabled at idle when FileSystem API is supported', () => {
    render()
    expect(connectBtn()!.disabled).toBe(false)
  })
})

describe('ConnectScreen — loading state (after click)', () => {
  it('shows the green progress fill bar when busy (after clicking connect)', async () => {
    render()
    const btn = connectBtn()!
    await act(async () => {
      btn.click()
      // Let the microtask queue flush so pickInstall resolves and
      // phase transitions to 'picking'
      await Promise.resolve()
    })
    // The fill span should now be present
    expect(progressFill()).not.toBeNull()
  })

  it('progress fill has the success-green gradient background', async () => {
    render()
    await act(async () => {
      connectBtn()!.click()
      await Promise.resolve()
    })
    const fill = progressFill()
    expect(fill).not.toBeNull()
    // The gradient uses oklch green colours
    expect(fill!.style.background).toContain('oklch')
  })

  it('does NOT show button text while loading (text layer has opacity 0)', async () => {
    render()
    await act(async () => {
      connectBtn()!.click()
      await Promise.resolve()
    })
    // The text span has opacity: '0' when not idle
    const textLayer = Array.from(
      container!.querySelectorAll('button span span'),
    ).find(s => s.textContent?.includes('Connect CoH2 install')) as HTMLElement | undefined
    expect(textLayer).toBeDefined()
    expect(textLayer!.style.opacity).toBe('0')
  })

  it('spinner layer is visible (opacity 1) while loading', async () => {
    render()
    await act(async () => {
      connectBtn()!.click()
      await Promise.resolve()
    })
    // Find the spinner layer: the <span> inside the button that contains
    // the InlineSpinner (a conic-gradient <span aria-hidden>), with opacity 1.
    const spinnerLayers = Array.from(
      container!.querySelectorAll('button > span > span'),
    ) as HTMLElement[]
    const visibleSpinnerLayer = spinnerLayers.find(
      s => s.style.opacity === '1' && s.querySelector('span[aria-hidden]') !== null,
    )
    expect(visibleSpinnerLayer).toBeDefined()
  })

  it('button is disabled while loading', async () => {
    render()
    await act(async () => {
      connectBtn()!.click()
      await Promise.resolve()
    })
    expect(connectBtn()!.disabled).toBe(true)
  })
})

describe('ConnectScreen — BorderBeam active prop', () => {
  it('passes active=true to BorderBeam wrapper at idle (data-beam element present)', () => {
    render()
    // BorderBeam renders a [data-beam] div that carries the CSS animation.
    const beamDiv = container!.querySelector('[data-beam]')
    expect(beamDiv).not.toBeNull()
  })
})
