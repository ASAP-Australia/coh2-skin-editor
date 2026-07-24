/**
 * ErrorBoundary — reusable React error boundary.
 *
 * React only lets class components catch render/lifecycle errors from their
 * descendants (via getDerivedStateFromError + componentDidCatch). This is a
 * small, generic boundary used to stop a throwing subtree — most importantly
 * the Three.js <Viewport>, which throws synchronously during render when a
 * WebGL context cannot be created — from unmounting the WHOLE app to a blank
 * white screen.
 *
 * Contract:
 *   • Renders `children` while no error has been caught.
 *   • On a caught error, renders `fallback`:
 *       - a ReactNode           → shown as-is, or
 *       - (error, reset) => Node → called with the error and a reset fn.
 *     If no `fallback` is given, a sensible default card is rendered.
 *   • Re-logs the error to console.error (prefixed with `label` when given) so
 *     DevTools and any e2e console-error guard still see the stack — the
 *     boundary reports, it doesn't silently swallow.
 *   • Optional `onError(error, info)` hook for callers that want to react.
 *   • `resetKeys`: when any value in this array changes between renders, the
 *     boundary clears its error state and retries `children`. Lets a parent
 *     recover the subtree (e.g. after the user navigates) without remounting
 *     the whole boundary.
 *
 * This is distinct from EditorErrorBoundary (a fixed full-screen "editor
 * crashed / back to start" overlay). This boundary is layout-agnostic: the
 * caller supplies whatever fallback fits the slot it's guarding.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

type FallbackRender = (error: Error, reset: () => void) => ReactNode

interface Props {
  children?: ReactNode
  /** Static fallback node, or a render fn receiving (error, reset). */
  fallback?: ReactNode | FallbackRender
  /** Prefix for the console.error log and the default fallback eyebrow. */
  label?: string
  /** Optional side-effect hook fired from componentDidCatch. */
  onError?: (error: Error, info: ErrorInfo) => void
  /** When any entry changes (shallow-compared), the boundary resets. */
  resetKeys?: readonly unknown[]
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const prefix = this.props.label ? `[${this.props.label}] ` : ''
    // Keep the stack visible to DevTools / e2e console-error guards.
    console.error(`${prefix}render error caught by ErrorBoundary:`, error, info.componentStack)
    this.props.onError?.(error, info)
  }

  componentDidUpdate(prev: Props): void {
    // Reset when any resetKey changed while an error is being shown.
    if (this.state.error === null) return
    if (!keysChanged(prev.resetKeys, this.props.resetKeys)) return
    this.reset()
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const { fallback, label } = this.props
    if (typeof fallback === 'function') {
      return (fallback as FallbackRender)(error, this.reset)
    }
    if (fallback !== undefined) return fallback

    // Default fallback — a quiet inline card that fills its parent box.
    return (
      <div
        role="alert"
        style={{
          width: '100%',
          height: '100%',
          minHeight: 120,
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          boxSizing: 'border-box',
          color: 'rgba(247,247,250,0.7)',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          {label && (
            <div
              style={{
                fontSize: 11,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                color: 'rgba(247,247,250,0.4)',
                marginBottom: 6,
              }}
            >
              {label}
            </div>
          )}
          <div>Something went wrong rendering this view.</div>
        </div>
      </div>
    )
  }
}

/** Shallow per-element comparison of two resetKeys arrays. */
function keysChanged(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return false
  if (!a || !b) return true
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return true
  }
  return false
}
