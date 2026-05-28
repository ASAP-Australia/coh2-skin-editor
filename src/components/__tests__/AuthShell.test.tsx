/**
 * Tests for AuthShell — the shared glass surface that wraps the
 * pre-editor flow (Connect → Start → New-* forms → editor-loading).
 *
 * Why this is structural-only:
 *
 *   AuthShell composes a lot of jsdom-hostile machinery:
 *     - ShaderWaveBackground (Three.js WebGLRenderer) is lazy-loaded
 *       and gated on `requestIdleCallback` / setTimeout(400) — the
 *       chunk-loading promise never resolves under jsdom and the
 *       Suspense fallback (CssGradientBackground) stays mounted.
 *     - AsapFlagHeading paints via OffscreenCanvas + Web Worker.
 *     - LoadingBorder paints via OffscreenCanvas + Web Worker.
 *     - The FLIP icon morph reads getBoundingClientRect() values that
 *       jsdom always reports as zero — so the FLIP measurement bails
 *       and `iconOffset` stays null.
 *
 *   The behaviour that IS pinnable (and worth pinning, because it's the
 *   accessibility / landmark / brand-anchor / morph-bookkeeping contract
 *   the rest of the app composes against):
 *
 *  Landmark + a11y surface
 *  - Outer wrapper is a `<main>` landmark so axe's `region` rule passes
 *    for content inside the glass card.
 *  - A persistent `sr-only` `<h1>CoH2 Community Modding Tool</h1>` is
 *    rendered so the product heading is in the accessibility tree even
 *    after the static welcome card in index.html is removed.
 *  - The ASAP wordmark anchor exposes `aria-label="ASAP Australia on
 *    GitHub"` + `target="_blank"` + `rel="noopener noreferrer"` so the
 *    keyboard / screen-reader path to the org page is intact.
 *
 *  Brand row
 *  - The anchor's href is the canonical GitHub org URL — pinned because
 *    the v1.0 release advertises ASAP-Australia.
 *  - The eyebrow renders the canonical "CoH2 · Community Modding Tool"
 *    text.
 *
 *  Phase morph bookkeeping
 *  - Children render once on first paint.
 *  - On a phase change that crosses the stagger-owned boundary (e.g.
 *    `start` → `form`), BOTH the outgoing children (in the MorphOut
 *    layer) AND the incoming children render concurrently for ~440 ms.
 *  - On a phase change between two stagger-owned phases (`connect` →
 *    `start`), the morph is bypassed entirely — only the new children
 *    render, with no leftover MorphOut layer (the screen owns its own
 *    stagger).
 *
 *  Exiting handoff
 *  - When `exiting={true}`, the card's inline style flips opacity to 0
 *    AND the wrapper's pointerEvents is disabled so clicks fall through
 *    to the Editor surfacing underneath.
 *
 *  Test infra: React 19 createRoot + act. Heavy deps mocked at the
 *  module boundary so jsdom never has to evaluate WebGL / Worker /
 *  OffscreenCanvas paths.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// React 19 requires opt-in for act() to flush state updates from
// scheduled timers. Set the global flag before the first render so the
// vi.advanceTimersByTime-triggered setPending(null) cleanup is observed
// synchronously by the next assertion.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── jsdom global shims ─────────────────────────────────────────────────────
// AuthShell composes <LoadingBorder> (reads window.matchMedia for
// prefers-reduced-motion) and a HeightTransition that constructs a
// ResizeObserver. Neither exists in jsdom; stub both before any render.
beforeEach(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }
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

// ── Module mocks ─────────────────────────────────────────────────────────────
// AsapFlagHeading paints via Web Worker + OffscreenCanvas. Stub with a
// plain <div> carrying the same `aria-label`-friendly anchor surface so
// the AuthShell anchor's a11y contract is testable end-to-end without
// jsdom touching the worker code path.
vi.mock('@/components/AsapFlagHeading', () => ({
  __esModule: true,
  default: ({ height, className }: { height?: number; className?: string }) =>
    createElement('div', {
      'data-testid': 'asap-flag-heading',
      'data-height': String(height ?? 72),
      className: className,
    }),
}))
// ShaderWaveBackground is lazy-loaded. We mock the module so the chunk
// import resolves immediately (when shaderReady flips true) instead of
// stalling under jsdom.
vi.mock('@/components/ShaderWaveBackground', () => ({
  __esModule: true,
  default: () => createElement('div', { 'data-testid': 'shader-wave-background' }),
}))

const { default: AuthShell } = await import('../AuthShell')

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(props: { phase: string; exiting?: boolean; children: React.ReactNode }) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(createElement(AuthShell, props))
  })
  return container!
}

function rerender(props: { phase: string; exiting?: boolean; children: React.ReactNode }) {
  if (!container || !root) throw new Error('render() first')
  act(() => {
    root!.render(createElement(AuthShell, props))
  })
  return container!
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
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AuthShell — landmark + a11y surface', () => {
  it('renders a single <main> landmark wrapper', () => {
    render({ phase: 'connect', children: createElement('div', null, 'hi') })
    const mains = container!.querySelectorAll('main')
    expect(mains.length).toBe(1)
  })

  it('renders the persistent sr-only "CoH2 Community Modding Tool" h1', () => {
    render({ phase: 'connect', children: createElement('div', null, 'hi') })
    const h1 = container!.querySelector('h1')
    expect(h1).not.toBeNull()
    expect(h1!.textContent).toBe('CoH2 Community Modding Tool')
    expect(h1!.className).toContain('sr-only')
  })

  it('renders the ASAP wordmark inside a labelled GitHub anchor', () => {
    render({ phase: 'connect', children: createElement('div', null, 'hi') })
    const anchor = container!.querySelector('a[aria-label="ASAP Australia on GitHub"]')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe('https://github.com/ASAP-Australia')
    expect(anchor!.getAttribute('target')).toBe('_blank')
    expect(anchor!.getAttribute('rel')).toBe('noopener noreferrer')
    // The mocked AsapFlagHeading lives inside this anchor at height=72.
    const heading = anchor!.querySelector('[data-testid="asap-flag-heading"]')
    expect(heading).not.toBeNull()
    expect(heading!.getAttribute('data-height')).toBe('72')
  })

  it('renders the canonical eyebrow "CoH2 · Community Modding Tool"', () => {
    render({ phase: 'connect', children: createElement('div', null, 'hi') })
    expect(container!.textContent).toContain('CoH2 · Community Modding Tool')
  })
})

describe('AuthShell — children rendering', () => {
  it('renders the children passed to it', () => {
    render({
      phase: 'connect',
      children: createElement('div', { 'data-testid': 'shell-child' }, 'shell child content'),
    })
    expect(container!.querySelector('[data-testid="shell-child"]')).not.toBeNull()
    expect(container!.textContent).toContain('shell child content')
  })

  it('forwards arbitrary node structures (text, fragments, multiple roots) via children', () => {
    render({
      phase: 'connect',
      children: createElement(
        'div',
        null,
        createElement('span', { 'data-testid': 'a' }, 'a'),
        createElement('span', { 'data-testid': 'b' }, 'b'),
      ),
    })
    expect(container!.querySelector('[data-testid="a"]')).not.toBeNull()
    expect(container!.querySelector('[data-testid="b"]')).not.toBeNull()
  })
})

describe('AuthShell — phase morph bookkeeping', () => {
  it('on a morph-eligible phase change, both outgoing and incoming children co-exist briefly', () => {
    render({
      phase: 'start',
      children: createElement('div', { 'data-testid': 'start-body' }, 'start-body'),
    })
    rerender({
      phase: 'form',
      children: createElement('div', { 'data-testid': 'form-body' }, 'form-body'),
    })
    // Both layers exist while the morph is in flight (TOTAL_MS = 440 ms).
    // The MorphOut layer carries the outgoing children; the MorphIn layer
    // carries the incoming children. Verifying both are mounted is the
    // contract — the cleanup timer is covered structurally elsewhere (the
    // pending state clears on the next phase change, idempotently).
    expect(container!.querySelector('[data-testid="start-body"]')).not.toBeNull()
    expect(container!.querySelector('[data-testid="form-body"]')).not.toBeNull()
  })

  it('the MorphOut layer is absolutely positioned + pointerEvents:none so the incoming UI is interactive immediately', () => {
    render({
      phase: 'start',
      children: createElement('div', { 'data-testid': 'start-body' }, 'start-body'),
    })
    rerender({
      phase: 'form',
      children: createElement('div', { 'data-testid': 'form-body' }, 'form-body'),
    })
    // The outgoing start-body lives inside a MorphOut wrapper with
    // position: absolute + pointerEvents: none. Walking up from the
    // start-body div finds that wrapper.
    const startBody = container!.querySelector('[data-testid="start-body"]') as HTMLElement
    const morphOutWrapper = startBody.parentElement as HTMLElement
    expect(morphOutWrapper.style.position).toBe('absolute')
    expect(morphOutWrapper.style.pointerEvents).toBe('none')
  })

  it('connect ↔ start transitions bypass the morph (only the new children render, no MorphOut)', () => {
    render({
      phase: 'connect',
      children: createElement('div', { 'data-testid': 'connect-body' }, 'connect-body'),
    })
    rerender({
      phase: 'start',
      children: createElement('div', { 'data-testid': 'start-body' }, 'start-body'),
    })
    // The stagger-owned skip path swaps in place: only the new body renders.
    expect(container!.querySelector('[data-testid="start-body"]')).not.toBeNull()
    expect(container!.querySelector('[data-testid="connect-body"]')).toBeNull()
  })

  it('start → connect (the other direction within the stagger pair) also bypasses the morph', () => {
    render({
      phase: 'start',
      children: createElement('div', { 'data-testid': 'start-body' }, 'start-body'),
    })
    rerender({
      phase: 'connect',
      children: createElement('div', { 'data-testid': 'connect-body' }, 'connect-body'),
    })
    expect(container!.querySelector('[data-testid="connect-body"]')).not.toBeNull()
    expect(container!.querySelector('[data-testid="start-body"]')).toBeNull()
  })
})

describe('AuthShell — exiting handoff', () => {
  it('exiting=true flips the outer <main> to pointerEvents:none so clicks fall through to the editor underneath', () => {
    render({
      phase: 'editor-loading',
      exiting: true,
      children: createElement('div', null, 'body'),
    })
    const main = container!.querySelector('main') as HTMLElement
    expect(main.style.pointerEvents).toBe('none')
  })

  it('exiting=false leaves pointerEvents unset (so the card stays interactive)', () => {
    render({
      phase: 'connect',
      exiting: false,
      children: createElement('div', null, 'body'),
    })
    const main = container!.querySelector('main') as HTMLElement
    expect(main.style.pointerEvents).toBe('')
  })

  it('exiting=true fades the glass card to opacity 0', () => {
    render({
      phase: 'editor-loading',
      exiting: true,
      children: createElement('div', null, 'body'),
    })
    // The glass card is the descendant carrying `glass-3` in its class.
    const card = container!.querySelector('.glass-3') as HTMLElement
    expect(card).not.toBeNull()
    expect(card.style.opacity).toBe('0')
  })
})

describe('AuthShell — editor-loading phase', () => {
  it('phase="editor-loading" hides the eyebrow (opacity 0 + visibility hidden)', () => {
    render({
      phase: 'editor-loading',
      children: createElement('div', null, 'body'),
    })
    // The eyebrow div carries the "CoH2 · Community Modding Tool" text.
    const eyebrow = Array.from(container!.querySelectorAll('div')).find(
      d => d.textContent === 'CoH2 · Community Modding Tool',
    ) as HTMLElement
    expect(eyebrow).toBeDefined()
    expect(eyebrow.style.opacity).toBe('0')
    expect(eyebrow.style.visibility).toBe('hidden')
  })

  it('phase="editor-loading" does NOT hide the brand anchor (it morphs to centre instead)', () => {
    render({
      phase: 'editor-loading',
      children: createElement('div', null, 'body'),
    })
    const anchor = container!.querySelector(
      'a[aria-label="ASAP Australia on GitHub"]',
    ) as HTMLElement
    // The anchor remains in the DOM (the FLIP morph translates it; jsdom
    // can't measure the FLIP target so the offset stays null and the
    // transform is the resting one — but the element is present).
    expect(anchor).not.toBeNull()
  })
})

describe('AuthShell — CssGradientBackground fallback always paints', () => {
  it('the static CSS gradient backdrop is mounted regardless of WebGL availability', () => {
    render({
      phase: 'connect',
      children: createElement('div', null, 'body'),
    })
    // CssGradientBackground emits a fixed inset-0 -z-10 div with
    // backgroundColor #212121. We just check that the colour pin is in
    // the DOM somewhere — that's the "no black flash" guarantee.
    const fixedBg = Array.from(container!.querySelectorAll('div')).find(
      d => d.style.backgroundColor === 'rgb(33, 33, 33)' || d.style.backgroundColor === '#212121',
    )
    expect(fixedBg).toBeDefined()
  })
})
