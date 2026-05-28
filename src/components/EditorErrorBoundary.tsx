/**
 * EditorErrorBoundary — last-line defence for the lazy-loaded editor
 * components (Editor, FaceplateEditor, DecalPackEditor).
 *
 * Without this, any uncaught render error in those subtrees blanks the
 * entire app — the user sees a black screen with no recourse and the
 * stack trace only surfaces in DevTools. With it, we render a quiet
 * fallback card that names the editor, shows the error, and offers a
 * "Back to start" escape so the user can recover without restarting.
 *
 * Errors are also re-logged to console.error so the stack remains
 * accessible to anyone with DevTools open (and to our e2e console-error
 * guard, which would otherwise miss the failure mode entirely).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** What we were trying to render — surfaced in the fallback message
   *  so the user knows which subsystem failed. */
  label: string
  /** Called when the user clicks the "Back" button in the fallback. */
  onReset: () => void
  children?: ReactNode
}

interface State {
  error: Error | null
}

export default class EditorErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the stack to the console for DevTools / e2e guards.
    console.error(`[${this.props.label}] render failed:`, error, info.componentStack)
  }

  handleReset = (): void => {
    this.setState({ error: null })
    this.props.onReset()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: '#0a0b0e',
          color: '#f7f7fa',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 520,
            padding: '24px 28px',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.04)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: 'rgba(247,247,250,0.55)',
              marginBottom: 8,
            }}
          >
            {this.props.label} crashed
          </div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>
            Something went wrong rendering the editor.
          </div>
          <pre
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: 'rgba(247,247,250,0.65)',
              background: 'rgba(0,0,0,0.30)',
              borderRadius: 8,
              padding: '10px 12px',
              margin: 0,
              maxHeight: 180,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message || String(this.state.error)}
          </pre>
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.10)',
                background: 'rgba(255,255,255,0.06)',
                color: '#f7f7fa',
                cursor: 'pointer',
              }}
            >
              Back to start
            </button>
          </div>
        </div>
      </div>
    )
  }
}
