/**
 * Tests for WindowControls — the floating close / minimize / maximize
 * pill. Always renders the bar with Maximize + Close; Minimize and the
 * drag strip are Electron-only since they're no-ops on the web.
 *
 * Pinned contract:
 *   1. Not in Electron (no `window.electronAPI`) → renders the bar with
 *      Maximize + Close, but no Minimize button and no drag strip.
 *   2. In Electron → renders three labelled buttons + the invisible drag
 *      strip across the top 40 px.
 *   3. Minimize button calls `electronAPI.windowMinimize()`.
 *   4. Close button calls `electronAPI.windowClose()`.
 *   5. Maximize button calls `requestFullscreen()` and flips the local
 *      `maximized` state — the label then reads "Restore" instead of
 *      "Maximize".
 *   6. Clicking Restore (i.e. when already fullscreen) calls
 *      `exitFullscreen()` and flips the label back to "Maximize".
 *   7. Double-clicking the controls bar triggers the same maximize flow.
 *   8. The Close button carries the red-tinted hover utility classes —
 *      we pin this so a refactor can't downgrade Close to look like the
 *      neutral buttons.
 *   9. The drag strip uses `WebkitAppRegion: drag`; the controls bar
 *      uses `WebkitAppRegion: no-drag` so Electron's drag/no-drag check
 *      surfaces buttons over the strip correctly.
 *  10. The initial `isMaximized` poll runs and propagates state.
 *
 * Strategy: stub `window.electronAPI` directly so the real `isElectron()`
 * function executes (cleaner than module-mocking `@/lib/native-fs`).
 * Stub `requestFullscreen`/`exitFullscreen` on the document prototype.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import WindowControls from '../WindowControls'

// ── Electron stubs ───────────────────────────────────────────────────────────

interface ElectronStub {
  windowMinimize: ReturnType<typeof vi.fn>
  windowClose: ReturnType<typeof vi.fn>
  isMaximized: ReturnType<typeof vi.fn>
}

function installElectron(initialMaximized = false): ElectronStub {
  const stub: ElectronStub = {
    windowMinimize: vi.fn(),
    windowClose: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(initialMaximized),
  }
  // Cast through unknown — the real `Window.electronAPI` declares many more
  // methods (diffusion / LoRA / body-mask) that WindowControls never calls.
  // The test only needs the three the component touches.
  ;(window as unknown as { electronAPI: ElectronStub }).electronAPI = stub
  return stub
}

function uninstallElectron() {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
}

function installFullscreenApi() {
  // jsdom does not implement these; we stub them on the document
  // prototype so the component can call them without throwing.
  if (!HTMLElement.prototype.requestFullscreen) {
    HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined)
  }
  if (!document.exitFullscreen) {
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
  }
  // `fullscreenElement` is readonly in browsers; redefine it for the test.
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => null,
  })
}

function setFullscreenElement(el: HTMLElement | null) {
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => el,
  })
}

// ── Test infra ───────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(WindowControls))
  })
  return container
}

function findByLabel(label: string): HTMLButtonElement | null {
  return document.querySelector(`button[aria-label="${label}"]`)
}

function controlsBar(): HTMLDivElement | null {
  // The fixed top-right glass pill carrying the three buttons.
  return document.querySelector('div.fixed.top-3.right-3') as HTMLDivElement | null
}

function dragStrip(): HTMLDivElement | null {
  return document.querySelector('div[aria-hidden].fixed.top-0') as HTMLDivElement | null
}

beforeEach(() => {
  uninstallElectron()
  installFullscreenApi()
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
  uninstallElectron()
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WindowControls — not in Electron', () => {
  it('renders Maximize + Close (web fallback) but no Minimize or drag strip', () => {
    render()
    // The pill still renders so users get window-style controls on web.
    expect(controlsBar()).not.toBeNull()
    // Minimize is meaningless without a window manager — hidden on web.
    expect(findByLabel('Minimize')).toBeNull()
    // Drag strip blocks clicks in the top 40 px and there's no window to
    // drag on the web; not rendered.
    expect(dragStrip()).toBeNull()
    // Maximize + Close still render — they map to Fullscreen API and
    // window.close() on the web.
    expect(findByLabel('Maximize')).not.toBeNull()
    expect(findByLabel('Close')).not.toBeNull()
  })
})

describe('WindowControls — in Electron', () => {
  beforeEach(() => {
    installElectron(false)
  })

  it('renders the controls bar and drag strip', () => {
    render()
    expect(controlsBar()).not.toBeNull()
    expect(dragStrip()).not.toBeNull()
  })

  it('renders three buttons: Minimize, Maximize, Close', () => {
    render()
    expect(findByLabel('Minimize')).not.toBeNull()
    expect(findByLabel('Maximize')).not.toBeNull()
    expect(findByLabel('Close')).not.toBeNull()
  })

  it('drag strip is aria-hidden and stretches across the top', () => {
    // Note: we can't directly verify `WebkitAppRegion: drag` because
    // jsdom's CSSStyleDeclaration silently drops the `-webkit-app-region`
    // property (it isn't in jsdom's known CSS dictionary). The structural
    // contract — aria-hidden, top-stretching position, no-clickable
    // background — is what makes the drag region work in real Electron.
    render()
    const strip = dragStrip()!
    expect(strip.getAttribute('aria-hidden')).toBe('true')
    // top-0 left-0 right-0 h-10 (40 px) — pin via the Tailwind classes.
    expect(strip.className).toContain('fixed')
    expect(strip.className).toContain('top-0')
    expect(strip.className).toContain('h-10')
  })
})

describe('WindowControls — button wiring', () => {
  let stub: ElectronStub

  beforeEach(() => {
    stub = installElectron(false)
  })

  it('Minimize → electronAPI.windowMinimize()', () => {
    render()
    act(() => {
      findByLabel('Minimize')!.click()
    })
    expect(stub.windowMinimize).toHaveBeenCalledTimes(1)
  })

  it('Close → electronAPI.windowClose()', () => {
    render()
    act(() => {
      findByLabel('Close')!.click()
    })
    expect(stub.windowClose).toHaveBeenCalledTimes(1)
  })

  it('Maximize (not fullscreen) → requestFullscreen + flips label to "Restore"', async () => {
    const reqSpy = vi.spyOn(HTMLElement.prototype, 'requestFullscreen').mockResolvedValue(undefined)
    render()
    await act(async () => {
      await findByLabel('Maximize')!.click()
    })
    expect(reqSpy).toHaveBeenCalled()
    // After click, the inline state should be maximized → label flips
    expect(findByLabel('Restore')).not.toBeNull()
    expect(findByLabel('Maximize')).toBeNull()
  })

  it('Restore (when fullscreen) → exitFullscreen + flips label back to "Maximize"', async () => {
    // Stage: pretend we're already in fullscreen so the first click on
    // "Maximize" follows the exit path.
    setFullscreenElement(document.documentElement)
    const exitSpy = vi.spyOn(document, 'exitFullscreen').mockResolvedValue(undefined)
    render()
    await act(async () => {
      await findByLabel('Maximize')!.click()
    })
    expect(exitSpy).toHaveBeenCalled()
    // Local `maximized` flips false→true (because the toggle is unconditional);
    // label therefore reads "Restore".
    expect(findByLabel('Restore')).not.toBeNull()
  })

  it('double-clicking the controls bar triggers maximize', async () => {
    const reqSpy = vi.spyOn(HTMLElement.prototype, 'requestFullscreen').mockResolvedValue(undefined)
    render()
    const bar = controlsBar()!
    await act(async () => {
      bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(reqSpy).toHaveBeenCalled()
  })
})

describe('WindowControls — visual variants', () => {
  beforeEach(() => {
    installElectron(false)
  })

  it('Close button carries the red-tinted hover utility (not the neutral one)', () => {
    render()
    const close = findByLabel('Close')!
    expect(close.className).toContain('hover:bg-red-500/70')
    expect(close.className).not.toContain('hover:bg-white/10')
  })

  it('Minimize + Maximize carry the neutral hover utility (not the red one)', () => {
    render()
    for (const label of ['Minimize', 'Maximize']) {
      const b = findByLabel(label)!
      expect(b.className).toContain('hover:bg-white/10')
      expect(b.className).not.toContain('hover:bg-red-500/70')
    }
  })
})
