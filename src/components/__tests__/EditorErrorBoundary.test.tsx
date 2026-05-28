/**
 * Tests for EditorErrorBoundary — the last-line render-error catcher that
 * wraps the lazy-loaded Editor / FaceplateEditor / DecalPackEditor trees.
 *
 * The boundary's contract:
 *   1. Renders children when no error has been thrown.
 *   2. Catches errors from any descendant and shows a fallback card
 *      (role="alert") with the editor label + the error message.
 *   3. Provides a "Back to start" button that calls `onReset` AND clears
 *      the internal error state so re-rendering with the original children
 *      proves the boundary actually resets (not just hides the alert).
 *   4. Re-logs the error to console.error so e2e console-error guards and
 *      DevTools still see the stack — the boundary doesn't swallow.
 *   5. Falls back to String(error) when the thrown value has no .message.
 *
 * React error boundaries spew their own console output ("The above error
 * occurred…") regardless of `componentDidCatch`. The test silences
 * console.error per-test with vi.spyOn and inspects what was logged.
 *
 * Uses React 19 createRoot + act. No @testing-library/react.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import EditorErrorBoundary from '../EditorErrorBoundary'

// ── Test infra ───────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

function renderInto(ui: ReactNode) {
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

/** A child that throws on first render. Toggle `shouldThrow` to flip the
 *  behaviour mid-test (used for the reset → re-render scenario). */
let shouldThrow = true
let throwValue: unknown = new Error('boom from child')
function Boom({ children }: { children?: ReactNode }) {
  if (shouldThrow) {
    throw throwValue
  }
  return <div data-testid="recovered">{children}</div>
}

beforeEach(() => {
  shouldThrow = true
  throwValue = new Error('boom from child')
  // Silence both React's own error log and the boundary's
  // componentDidCatch — but capture calls so we can assert about them.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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

describe('EditorErrorBoundary — happy path', () => {
  it('renders children when no error is thrown', () => {
    shouldThrow = false
    const el = renderInto(
      createElement(
        EditorErrorBoundary,
        { label: 'Faceplate Editor', onReset: vi.fn() },
        createElement(Boom),
      ),
    )
    // recovered marker means children were rendered, no fallback alert
    expect(el.querySelector('[data-testid="recovered"]')).not.toBeNull()
    expect(el.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('EditorErrorBoundary — catches', () => {
  it('renders fallback alert when child throws', () => {
    const el = renderInto(
      createElement(
        EditorErrorBoundary,
        { label: 'Skin Editor', onReset: vi.fn() },
        createElement(Boom),
      ),
    )
    const alert = el.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
  })

  it('fallback alert mentions the editor label', () => {
    const el = renderInto(
      createElement(
        EditorErrorBoundary,
        { label: 'Faceplate Editor', onReset: vi.fn() },
        createElement(Boom),
      ),
    )
    // The label appears in the small "<label> crashed" eyebrow.
    expect(el.textContent).toContain('Faceplate Editor')
  })

  it('fallback alert renders the error message', () => {
    throwValue = new Error('the canvas exploded')
    const el = renderInto(
      createElement(
        EditorErrorBoundary,
        { label: 'Decal Pack Editor', onReset: vi.fn() },
        createElement(Boom),
      ),
    )
    const pre = el.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toBe('the canvas exploded')
  })

  it('falls back to String(error) when the thrown value has no .message', () => {
    // Throw a plain string — exercise the `|| String(this.state.error)`
    // fallback branch on line 105.
    throwValue = 'raw string failure'
    const el = renderInto(
      createElement(
        EditorErrorBoundary,
        { label: 'Faceplate Editor', onReset: vi.fn() },
        createElement(Boom),
      ),
    )
    const pre = el.querySelector('pre')
    expect(pre!.textContent).toBe('raw string failure')
  })

  it('re-logs the error to console.error with the editor label prefix', () => {
    renderInto(
      createElement(
        EditorErrorBoundary,
        { label: 'Skin Editor', onReset: vi.fn() },
        createElement(Boom),
      ),
    )
    // React itself also logs to console.error, so just check that *one*
    // call carries the boundary's prefixed message.
    const boundaryCall = consoleErrorSpy.mock.calls.find(args =>
      typeof args[0] === 'string' ? args[0].includes('[Skin Editor] render failed:') : false,
    )
    expect(boundaryCall).toBeDefined()
  })
})

describe('EditorErrorBoundary — reset', () => {
  it('shows a "Back to start" button in the fallback', () => {
    const el = renderInto(
      createElement(
        EditorErrorBoundary,
        { label: 'Faceplate Editor', onReset: vi.fn() },
        createElement(Boom),
      ),
    )
    const buttons = Array.from(el.querySelectorAll('button'))
    const back = buttons.find(b => b.textContent?.includes('Back to start'))
    expect(back).toBeDefined()
  })

  it('clicking "Back to start" invokes onReset exactly once', () => {
    const onReset = vi.fn()
    const el = renderInto(
      createElement(EditorErrorBoundary, { label: 'X', onReset }, createElement(Boom)),
    )
    const back = Array.from(el.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Back to start'),
    ) as HTMLButtonElement
    act(() => {
      back.click()
    })
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('clicking "Back to start" clears the internal error and re-renders children', () => {
    const el = renderInto(
      createElement(EditorErrorBoundary, { label: 'X', onReset: vi.fn() }, createElement(Boom)),
    )
    // Sanity: alert visible
    expect(el.querySelector('[role="alert"]')).not.toBeNull()

    // Flip the child so the next render won't re-throw.
    shouldThrow = false

    // Click reset — boundary clears `state.error`; next render passes the
    // children through, which now render normally.
    const back = Array.from(el.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Back to start'),
    ) as HTMLButtonElement
    act(() => {
      back.click()
    })

    expect(el.querySelector('[role="alert"]')).toBeNull()
    expect(el.querySelector('[data-testid="recovered"]')).not.toBeNull()
  })
})
