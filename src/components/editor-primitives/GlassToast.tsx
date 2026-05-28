/**
 * GlassToast — bottom-right glass status notification.
 *
 * Promotes DecalPackEditor's inline `ExportToast` into a reusable primitive.
 * The toast docks to the bottom-right corner and uses the standard
 * `blur(20px) saturate(160%)` topbar-tier glass treatment so it visually
 * rhymes with the rest of the editor chrome.
 *
 * Three accent intents wire the border colour to a contextual meaning:
 *
 *   • `intent="info"`        — blue   (default — used during async tasks)
 *   • `intent="success"`     — green  (used when a task completes)
 *   • `intent="error"`       — red    (used when a task fails)
 *
 * Auto-dismiss is OFF by default — the caller decides. The DecalPackEditor
 * export flow passes `autoDismissMs={4000}` only on success; errors stay
 * pinned until the user dismisses them, matching the original behaviour.
 */

import { useEffect, type ReactNode } from 'react'
import { EDITOR_TEXT_1, EDITOR_TEXT_2 } from './tokens'

type Intent = 'info' | 'success' | 'error'

const INTENT_BORDER: Record<Intent, string> = {
  info: 'rgba(120,180,255,0.45)',
  success: 'rgba(140,200,140,0.45)',
  error: 'rgba(240,140,140,0.50)',
}

interface Props {
  title: string
  body?: ReactNode
  intent?: Intent
  /** Auto-dismiss timer in milliseconds. Pass `undefined` for sticky toasts. */
  autoDismissMs?: number
  /** Show the dismiss × button. Default `true`. Hide for indeterminate
   *  building states where the user shouldn't dismiss until done. */
  dismissable?: boolean
  onClose?: () => void
}

export default function GlassToast({
  title,
  body,
  intent = 'info',
  autoDismissMs,
  dismissable = true,
  onClose,
}: Props) {
  useEffect(() => {
    if (autoDismissMs && onClose) {
      const t = window.setTimeout(onClose, autoDismissMs)
      return () => window.clearTimeout(t)
    }
  }, [autoDismissMs, onClose])

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 100,
        background: 'rgba(20,22,28,0.92)',
        border: `1px solid ${INTENT_BORDER[intent]}`,
        borderRadius: 10,
        padding: '12px 16px',
        minWidth: 260,
        maxWidth: 360,
        boxShadow: '0 12px 40px -8px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          marginBottom: body ? 4 : 0,
          color: EDITOR_TEXT_1,
        }}
      >
        {title}
      </div>
      {body && <div style={{ fontSize: 11, color: EDITOR_TEXT_2 }}>{body}</div>}
      {dismissable && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss notification"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: 'transparent',
            border: 'none',
            color: 'rgba(247,247,250,0.5)',
            cursor: 'pointer',
            fontSize: 12,
            padding: '2px 6px',
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
