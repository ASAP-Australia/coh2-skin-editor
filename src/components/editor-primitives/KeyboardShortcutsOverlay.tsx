/**
 * KeyboardShortcutsOverlay — F1 help sheet listing every keyboard shortcut.
 *
 * Drop-in: wire up open/onClose in App.tsx in the follow-up pass.
 * Renders null when closed so it costs nothing in the normal code path.
 *
 * Design: full-viewport blurred backdrop; centred glass card with up to
 * 3 columns of shortcut groups. Each key combo is wrapped in <kbd>.
 *
 * Data lives in ./keyboard-shortcuts-data.ts (separate file to satisfy
 * react-refresh/only-export-components).
 */

import { useEffect, type JSX } from 'react'
import { X } from 'lucide-react'
import type { ShortcutGroup } from './keyboard-shortcuts-data'
import { DEFAULT_SHORTCUTS } from './keyboard-shortcuts-data'
import { EDITOR_TEXT_1, EDITOR_TEXT_2, EDITOR_TEXT_3, EDITOR_STROKE_1 } from './tokens'

// ── Component ────────────────────────────────────────────────────────────────

export interface KeyboardShortcutsOverlayProps {
  open: boolean
  onClose: () => void
  /** Defaults to DEFAULT_SHORTCUTS. */
  groups?: ShortcutGroup[]
}

export default function KeyboardShortcutsOverlay({
  open,
  onClose,
  groups = DEFAULT_SHORTCUTS,
}: KeyboardShortcutsOverlayProps): JSX.Element | null {
  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  // Distribute groups into at most 3 columns
  const columns: ShortcutGroup[][] = [[], [], []]
  groups.forEach((g, i) => {
    columns[i % 3].push(g)
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
      }}
    >
      {/* Invisible backdrop button — captures clicks outside the card */}
      <button
        type="button"
        aria-label="Close keyboard shortcuts"
        onClick={onClose}
        tabIndex={-1}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'default',
        }}
      />

      {/* Inner card — positioned above the backdrop button in stacking order,
          so clicks here do not reach the backdrop button. */}
      <div
        style={{
          position: 'relative',
          background: '#13151c',
          border: `1px solid ${EDITOR_STROKE_1}`,
          borderRadius: 16,
          padding: '28px 32px',
          maxWidth: 900,
          width: 'calc(100% - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          color: EDITOR_TEXT_1,
          boxShadow: '0 24px 64px rgb(0 0 0 / 0.6)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: -0.2 }}>
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            style={{
              background: 'transparent',
              border: 'none',
              color: EDITOR_TEXT_2,
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 24,
          }}
        >
          {columns.map((col, ci) => (
            <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {col.map(group => (
                <section key={group.title}>
                  <p
                    style={{
                      margin: '0 0 10px',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      color: EDITOR_TEXT_3,
                    }}
                  >
                    {group.title}
                  </p>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {group.rows.map(([keys, action]) => (
                        <tr key={keys}>
                          <td
                            style={{
                              paddingBottom: 6,
                              paddingRight: 12,
                              whiteSpace: 'nowrap',
                              verticalAlign: 'top',
                            }}
                          >
                            <kbd
                              style={{
                                fontFamily: 'monospace',
                                fontSize: 11,
                                background: 'rgba(255,255,255,0.07)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: 4,
                                padding: '2px 5px',
                                color: EDITOR_TEXT_1,
                              }}
                            >
                              {keys}
                            </kbd>
                          </td>
                          <td
                            style={{
                              paddingBottom: 6,
                              fontSize: 12,
                              color: EDITOR_TEXT_2,
                              verticalAlign: 'top',
                            }}
                          >
                            {action}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
