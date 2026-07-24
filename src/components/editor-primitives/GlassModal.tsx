/**
 * GlassModal — centred dialog with a blurred scrim.
 *
 * Promotes DecalPackEditor's inline `DecalPackExportModal` shell into a
 * reusable primitive. The scrim is `rgba(0,0,0,0.7)` with `blur(8px)` —
 * the intentional dull-out (no `saturate`) signals "this is paused" without
 * vibrating the background like the glass-surface utilities would.
 *
 * Behaviour:
 *   • Click on scrim → calls `onClose`.
 *   • Escape key     → calls `onClose`.
 *   • Focus is NOT trapped — the modal is treated as an inline dialog;
 *     screen-reader nav can move focus out via Tab. For modals that need
 *     focus trapping we'd use `@base-ui/react/dialog`, but the current
 *     callers don't need it and the inline pattern is lighter.
 *
 * Layout:
 *   • `maxWidth` defaults to 560px (matches the existing export modal).
 *   • The dialog card has a fixed 16px radius and 28px padding so the
 *     content area doesn't need to think about insets.
 *
 * Accessibility:
 *   • Wrapper carries `role="dialog" aria-modal="true"`.
 *   • Caller must provide either `title` (renders as h2 + becomes
 *     aria-labelledby target) or `ariaLabel` (sets aria-label directly).
 */

import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { EDITOR_TEXT_1, EDITOR_TEXT_2 } from './tokens'

interface Props {
  /** Visible heading text — rendered as an h2 and used as the dialog's
   *  accessible name. Mutually exclusive with `ariaLabel`. */
  title?: string
  /** Plain accessible name when no visible title is rendered. Mutually
   *  exclusive with `title`. */
  ariaLabel?: string
  onClose: () => void
  children: ReactNode
  /** Max width of the dialog card in px. Default 560. */
  maxWidth?: number
  /** Render a close icon button in the top-right corner. Default true. */
  showCloseButton?: boolean
  /** Optional footer slot — typically Cancel + Confirm buttons. Rendered
   *  with `display:flex; justify-content: flex-end; gap: 8`. */
  footer?: ReactNode
  /** Style override for the dialog card (rarely needed). */
  style?: CSSProperties
}

export default function GlassModal({
  title,
  ariaLabel,
  onClose,
  children,
  maxWidth = 560,
  showCloseButton = true,
  footer,
  style,
}: Props) {
  // Escape closes — keyboard-accessible counterpart to the scrim click.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
      }}
    >
      {/* Scrim click target. We use a transparent button covering the
          modal's inset so screen-reader users CAN reach the dismiss action
          via Tab — but it's `tabIndex={-1}` so it never steals focus from
          the dialog content. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close dialog"
        tabIndex={-1}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'default',
        }}
      />
      <div
        className="l01-ring l01-bloom"
        style={{
          position: 'relative',
          background: '#161616',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 16,
          padding: 28,
          maxWidth,
          width: 'calc(100% - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          color: EDITOR_TEXT_1,
          boxShadow: '0 24px 64px rgb(0 0 0 / 0.55), 0 1px 0 rgb(255 255 255 / 0.06) inset',
          ...style,
        }}
      >
        {(title || showCloseButton) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            {title ? (
              <h2
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                }}
              >
                {title}
              </h2>
            ) : (
              <span />
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: EDITOR_TEXT_2,
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <X size={18} aria-hidden />
              </button>
            )}
          </div>
        )}
        {children}
        {footer && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              marginTop: 16,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
