/**
 * EditorTitlePill — centered glass title pill for the top of an editor.
 *
 * Extracted from DecalPackEditor and FaceplateEditor (both had ~100 lines of
 * identical inline JSX). The vehicle editor (TopBar) also renders this.
 *
 * Structure:
 *   • Fixed-position centering div
 *     └─ BorderBeam wrapper (ocean, when titleAcknowledged === false) OR plain
 *        └─ Glass pill <button> with packName / StateIcon
 *   • popoverContent rendered as a sibling (PackIdentityPopover)
 */

import type { CSSProperties, ReactNode } from 'react'
import { RefreshCw, RefreshCwOff } from 'lucide-react'
import { BorderBeam } from '@/components/ui/border-beam'
import { StateIcon } from '@/components/LiveSyncBadge'
import type { LiveSyncState } from '@/lib/live-sync'

export interface EditorTitlePillProps {
  /** Display name. Falls back to `fallbackLabel` when empty/falsy. */
  packName: string | undefined
  /** e.g. 'Unnamed Decal Pack' or 'Unnamed Skin Pack' */
  fallbackLabel: string
  /** Current live-sync state for the StateIcon. */
  syncState: LiveSyncState
  /** Tooltip on the pill button. */
  liveSyncTitle: string
  /** Accessible label on the pill button. */
  liveSyncAriaLabel?: string
  /**
   * When false the pill gets the first-open BorderBeam treatment.
   * Pass undefined to skip the treatment entirely.
   */
  titleAcknowledged: boolean | undefined
  /** Called when the user clicks the pill. Parent toggles popover open. */
  onToggle: () => void
  /**
   * Called on first click when titleAcknowledged === false so the parent can
   * persist `titleAcknowledged: true`.
   */
  onAcknowledge?: () => void
  /** Whether the PackIdentityPopover is open (controls render of popoverContent). */
  popoverOpen: boolean
  /**
   * The PackIdentityPopover element (and any siblings that should appear next
   * to the pill). Rendered as-is — parent owns open/close state.
   */
  popoverContent: ReactNode
  /**
   * When set, the StateIcon is replaced with an error icon and this message
   * is shown as the pill tooltip. Auto-cleared by the parent after a timeout.
   */
  publishError?: string | null
  /**
   * Q7 (Live Sync opt-out): current enabled state of Live Sync. When provided
   * (together with `onToggleLiveSync`), a compact On/Off toggle renders as a
   * SEPARATE control adjacent to the pill — never inside the rename click
   * target. Omit both to hide the toggle entirely (back-compat).
   */
  liveSyncEnabled?: boolean
  /** Called when the user clicks the Live Sync toggle. Flips enabled/disabled. */
  onToggleLiveSync?: () => void
}

export default function EditorTitlePill({
  packName,
  fallbackLabel,
  syncState,
  liveSyncTitle,
  liveSyncAriaLabel,
  titleAcknowledged,
  onToggle,
  onAcknowledge,
  popoverOpen,
  popoverContent,
  publishError,
  liveSyncEnabled,
  onToggleLiveSync,
}: EditorTitlePillProps) {
  const handleClick = () => {
    if (titleAcknowledged === false && onAcknowledge) {
      onAcknowledge()
    }
    onToggle()
  }

  // Q7: render the toggle only when the parent wired both the state and the
  // handler. Kept as a standalone sibling button so it never intercepts the
  // pill's click-to-rename affordance.
  const showLiveSyncToggle = liveSyncEnabled !== undefined && onToggleLiveSync !== undefined
  const liveSyncToggle = showLiveSyncToggle ? (
    <button
      type="button"
      role="switch"
      aria-checked={liveSyncEnabled}
      onClick={onToggleLiveSync}
      title={liveSyncEnabled ? 'Live sync: On — click to pause' : 'Live sync: Off — click to resume'}
      aria-label={liveSyncEnabled ? 'Live sync on — click to pause' : 'Live sync off — click to resume'}
      data-testid="editor-title-live-sync-toggle"
      data-enabled={liveSyncEnabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 36,
        padding: '0 10px',
        borderRadius: 12,
        background: 'rgba(20, 20, 20, 0.75)',
        backgroundImage:
          'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
        backdropFilter: 'blur(40px) saturate(150%)',
        WebkitBackdropFilter: 'blur(40px) saturate(150%)',
        border: '0.5px solid rgba(255, 255, 255, 0.08)',
        boxShadow:
          'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.2)',
        color: liveSyncEnabled ? 'rgb(52 211 153)' /* emerald-400 */ : 'rgba(245,245,245,0.55)',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      {liveSyncEnabled ? (
        <RefreshCw size={14} aria-hidden />
      ) : (
        <RefreshCwOff size={14} aria-hidden />
      )}
      <span>{liveSyncEnabled ? 'On' : 'Off'}</span>
    </button>
  ) : null

  const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 14,
    paddingRight: 14,
    borderRadius: 12,
    background: 'rgba(20, 20, 20, 0.75)',
    backgroundImage:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
    backdropFilter: 'blur(40px) saturate(150%)',
    WebkitBackdropFilter: 'blur(40px) saturate(150%)',
    border: '0.5px solid rgba(255, 255, 255, 0.08)',
    boxShadow:
      'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.2)',
    color: 'rgba(245,245,245,0.88)',
    cursor: 'pointer',
    padding: '0 14px',
    fontFamily: "'Inter Variable', ui-monospace, monospace",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
    maxWidth: 'calc(100vw - 200px)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  }

  const pillButton = (
    <button
      type="button"
      title={publishError ?? liveSyncTitle}
      aria-label={publishError ? `Publish error: ${publishError}` : liveSyncAriaLabel}
      onClick={handleClick}
      className="l01-ring"
      style={pillStyle}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {packName || fallbackLabel}
      </span>
      <span style={{ display: 'inline-flex', flex: 'none', transform: 'scale(0.85)' }}>
        <StateIcon state={publishError ? 'error' : syncState} />
      </span>
    </button>
  )

  return (
    <>
      {/* F8 scrim — black translucent overlay behind the menu, above the editor.
          Sits at zIndex 49 (one below the pill/popover layer at 50) so it
          covers the 3D viewport without blocking the pill itself. */}
      {popoverOpen && (
        <div
          aria-hidden
          onMouseDown={onToggle}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 49,
          }}
        />
      )}
      <div
        style={
          {
            position: 'fixed',
            top: 'calc(20px + var(--app-top-inset, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            WebkitAppRegion: 'no-drag',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          } as CSSProperties
        }
      >
        {/* Pill row: the pill button + Live Sync toggle + popover content
            side-by-side. The toggle is a SEPARATE control (Q7) so clicking it
            never triggers the pill's rename affordance. */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {titleAcknowledged === false ? (
            <BorderBeam colorVariant="ocean" duration={5} strength={0.85} borderRadius={12} borderWidth={1}>
              {pillButton}
            </BorderBeam>
          ) : (
            pillButton
          )}

          {liveSyncToggle}

          {popoverContent}
        </div>


      </div>
    </>
  )
}
