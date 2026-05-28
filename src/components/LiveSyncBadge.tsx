/**
 * LiveSyncBadge — minimal status indicator for Live Sync, with an optional
 * inventory-icon picker popover for faceplate projects.
 *
 * Replaces the older `LiveSyncPill` (icon + label + popover with a
 * Connect/Sync menu). The user's feedback for v1.0:
 *
 *   "you should already know my install location, there shouldn't be a
 *    menu, it should be green tick or cross, and you hover over it to
 *    see why. Live Sync should be a sub-menu label to the right above
 *    the center tool selector"
 *
 * So the badge is a single round icon that maps to one of five states:
 *
 *   • idle / synced  → CheckCircle2 (emerald)   "Live Sync is on"
 *   • syncing        → Loader2 (sky)            "Writing mod…"
 *   • queued         → Circle filled (amber)    "Waiting for current sync"
 *   • error          → XCircle (red)            "<reason>"
 *   • disabled       → Power (white/30)         "Live Sync is off — click to enable"
 *
 * Click behaviour:
 *   • If `iconPicker` is passed (FaceplateEditor context): clicking the
 *     badge opens a popover with the status line, an inventory-icon
 *     picker (upload + preview + reset), and a "Disable Live Sync"
 *     button. This matches the user's v1.0 request: "when I click on
 *     the sync I should be able to set the icon that is used in the
 *     inventory and on the player profile".
 *   • If no `iconPicker`: clicking still toggles enabled/disabled (the
 *     v0.x behaviour, preserved for the DecalPackEditor where there's
 *     no inventory-icon concept yet).
 *   • Either way, when enabling for the first time (no mods-folder
 *     handle stored yet) the manager's `setEnabled(true)` will
 *     synchronously fire the directory picker — the click event
 *     satisfies the browser's user-gesture requirement for
 *     `showDirectoryPicker`.
 *
 * The reason string (already maintained by LiveSyncManager) is surfaced
 * via the native `title` attribute, which becomes the OS-level tooltip
 * after the standard hover delay.
 *
 * Visually the badge sits in the same family as `ToolOptionsPeel` — same
 * glass treatment, 14px radius — so when it docks above-right of the
 * BottomToolPill (mirroring the tool-options peel above-left) the two
 * panels read as siblings of the editor's bottom dock.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, XCircle, Loader2, Circle, Power, Upload, RotateCcw } from 'lucide-react'
import { useLiveSync } from '@/lib/live-sync'
import type { LiveSyncState } from '@/lib/live-sync'

// ─── Icon mapping ─────────────────────────────────────────────────────────────

export function StateIcon({ state }: { state: LiveSyncState }) {
  switch (state) {
    case 'idle':
    case 'synced':
      return <CheckCircle2 size={18} className="text-emerald-400" aria-hidden />
    case 'syncing':
      return <Loader2 size={18} className="text-sky-400 animate-spin" aria-hidden />
    case 'queued':
      return <Circle size={18} className="text-amber-400" fill="currentColor" aria-hidden />
    case 'error':
      return <XCircle size={18} className="text-red-400" aria-hidden />
    default:
      // disabled
      return <Power size={18} className="text-white/40" aria-hidden />
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Inventory-icon picker context.
 *
 * When supplied, the LiveSyncBadge becomes click-to-open-popover instead of
 * click-to-toggle (the toggle behaviour is preserved when the badge is in
 * the disabled state, so the first click still enables; subsequent clicks
 * open the popover).
 */
export interface IconPickerProps {
  /** Current inventory-icon data URL (or null/undefined for "use auto-banner"). */
  current?: string | null
  /** Called when the user picks a new file or clicks Reset. `null` =
   *  reset to auto-banner. */
  onSet: (dataUrl: string | null) => void
}

interface Props {
  /**
   * Visual variant:
   * - `dock` (default): 44×44 floating glass panel, designed to sit
   *   above-right of the BottomToolPill in the faceplate / decal-pack
   *   editors. Matches the ToolOptionsPeel glass family.
   * - `inline`: 28×28 bare-icon variant for the TopBar's existing
   *   cluster row. No glass background — borrows the surrounding
   *   surface so it doesn't look like a foreign element bolted into
   *   the bar.
   */
  variant?: 'dock' | 'inline'
  /**
   * Optional inventory-icon picker. When passed, clicking the badge
   * (while enabled) opens a popover above the badge with the picker UI.
   * When omitted, clicking just toggles enabled/disabled — the legacy
   * v0.x behaviour used by editors that don't have an inventory icon
   * concept (decal pack).
   */
  iconPicker?: IconPickerProps
}

export default function LiveSyncBadge({ variant = 'dock', iconPicker }: Props) {
  const sync = useLiveSync()
  const { state, reason, enabled, actions } = sync
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click and on Escape. Standard a11y for a
  // small click-trigger popover — no portal needed because the badge sits
  // inside the editor's bottom dock, well above the canvas.
  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (!popoverRef.current) return
      const t = e.target as Node
      if (popoverRef.current.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The error-state recovery path is contextual: when the manager is
  // sitting in `error` because no mods-folder handle is stored
  // ("missing handle" reason), the natural user gesture is "let me
  // give you that folder now" — but the default toggle would instead
  // DISABLE Live Sync, forcing the user to click twice. Detect that
  // case and route the click to `connectInstall()` (re-fires the
  // directory picker) so the click semantically matches what the
  // tooltip is asking for.
  const isMissingModsHandle = state === 'error' && /mods folder/i.test(reason)

  const onClick = useCallback(() => {
    if (isMissingModsHandle) {
      void actions.connectInstall()
      return
    }
    if (!enabled) {
      // First click on a disabled badge always enables (and triggers the
      // mods-folder picker if needed). The popover is only relevant when
      // Live Sync is on.
      actions.toggle()
      return
    }
    if (iconPicker) {
      setOpen(o => !o)
      return
    }
    // Legacy path: no iconPicker, single-click toggles enable/disable.
    actions.toggle()
  }, [actions, enabled, iconPicker, isMissingModsHandle])

  // Compose a verbose label: "Live Sync — <state reason>" so the OS
  // tooltip (and the aria-label for screen readers) carries the full
  // context the user used to read from the popover's status line.
  const label = enabled ? `Live Sync — ${reason}` : `Live Sync is off — click to enable`

  const isInline = variant === 'inline'

  return (
    <div ref={popoverRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-pressed={enabled}
        aria-expanded={open || undefined}
        aria-haspopup={iconPicker ? 'dialog' : undefined}
        data-testid="live-sync-badge"
        data-state={state}
        className={
          'relative shrink-0 inline-flex items-center justify-center rounded-xl ' +
          'transition-all duration-150 cursor-pointer outline-none ' +
          'focus-visible:ring-2 focus-visible:ring-white/70 ' +
          (isInline
            ? 'hover:bg-white/10 hover:scale-[1.06] active:scale-95'
            : 'hover:scale-[1.04] active:scale-95')
        }
        style={
          isInline
            ? {
                width: 28,
                height: 28,
                // Inline variant: bare button, no glass — sits inside the
                // TopBar's own surface.
                background: 'transparent',
                border: 'none',
              }
            : {
                width: 44,
                height: 44,
                // Same glass family as ToolOptionsPeel so the badge reads
                // as a sibling of the peel that sits above the
                // BottomToolPill.
                background: 'rgba(20, 22, 28, 0.72)',
                backdropFilter: 'blur(32px) saturate(180%)',
                WebkitBackdropFilter: 'blur(32px) saturate(180%)',
                border: '0.5px solid rgba(255,255,255,0.10)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
              }
        }
      >
        <StateIcon state={state} />
      </button>

      {open && iconPicker && (
        <LiveSyncPopover reason={reason} state={state} iconPicker={iconPicker} />
      )}
    </div>
  )
}

// ─── Popover ──────────────────────────────────────────────────────────────────

/**
 * Glass popover that opens above the dock badge. Contains:
 *   - The current status reason (mirrors what the OS tooltip shows on hover).
 *   - Inventory-icon picker: 64×64 preview, "Choose image…" file input,
 *     "Reset" link that clears back to the auto-banner downsample.
 *   - Disable Live Sync button at the bottom.
 *
 * Layout sits above the badge (bottom edge anchored to the badge top), so
 * the popover rises into the canvas area rather than crashing off the
 * bottom of the viewport. Width capped at 280 px to keep the dock
 * unobtrusive.
 */
function LiveSyncPopover({
  reason,
  state,
  iconPicker,
}: {
  reason: string
  state: LiveSyncState
  iconPicker: IconPickerProps
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setBusy(true)
      try {
        const dataUrl = await readFileAsDataUrl(file)
        iconPicker.onSet(dataUrl)
      } catch (err) {
        console.error('[live-sync] icon file read failed:', err)
      } finally {
        setBusy(false)
        // Reset the input so the same file can be picked again later.
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [iconPicker],
  )

  const hasIcon = Boolean(iconPicker.current)

  return (
    <div
      role="dialog"
      aria-label="Live Sync settings"
      data-testid="live-sync-popover"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        right: 0,
        width: 280,
        background: 'rgba(20, 22, 28, 0.82)',
        backdropFilter: 'blur(32px) saturate(180%)',
        WebkitBackdropFilter: 'blur(32px) saturate(180%)',
        border: '0.5px solid rgba(255,255,255,0.12)',
        boxShadow: '0 14px 36px rgba(0,0,0,0.55), inset 0 0.5px 0 rgba(255,255,255,0.10)',
        borderRadius: 14,
        padding: 14,
        color: 'rgba(255,255,255,0.92)',
        zIndex: 50,
      }}
    >
      {/* Status line */}
      <div className="flex items-center gap-2 mb-3">
        <StateIcon state={state} />
        <span
          className="text-[12px] leading-tight text-white/85"
          data-testid="live-sync-popover-reason"
        >
          {reason}
        </span>
      </div>

      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          margin: '6px -14px 12px',
        }}
      />

      {/* Inventory icon section */}
      <div className="text-[10px] uppercase tracking-[1.5px] text-white/55 font-medium mb-2">
        Inventory icon
      </div>
      <p className="text-[11px] text-white/55 leading-snug mb-2">
        Shown on your player profile and in the in-game faceplate inventory. Defaults to a
        downsample of your banner.
      </p>

      <div className="flex items-center gap-3 mb-3">
        {/* Preview chip — mimics the 64² in-game thumbnail. */}
        <div
          data-testid="live-sync-icon-preview"
          style={{
            width: 56,
            height: 56,
            borderRadius: 10,
            background: hasIcon
              ? `center / cover no-repeat url("${iconPicker.current}")`
              : 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            flexShrink: 0,
          }}
          aria-label={
            hasIcon ? 'Current inventory icon' : 'No custom icon — using banner downsample'
          }
        />
        <div className="flex-1 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            data-testid="live-sync-icon-upload"
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg
                       text-[11px] font-medium border border-white/10 bg-white/[0.06]
                       hover:bg-white/[0.10] disabled:opacity-50 disabled:cursor-not-allowed
                       text-white/85 transition-colors"
          >
            <Upload size={12} aria-hidden />
            {hasIcon ? 'Replace…' : 'Choose image…'}
          </button>
          {hasIcon && (
            <button
              type="button"
              onClick={() => iconPicker.onSet(null)}
              data-testid="live-sync-icon-reset"
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg
                         text-[11px] border border-transparent bg-transparent
                         hover:bg-white/[0.06] text-white/55 hover:text-white/85
                         transition-colors"
            >
              <RotateCcw size={11} aria-hidden />
              Reset to banner
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={onPickFile}
          className="hidden"
          aria-label="Choose inventory icon image"
        />
      </div>

      {/* v1.0: the "Disable Live Sync" button was removed — the sink is
          permanently on so the user never has to remember to re-enable
          it before editing. */}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('File read failed'))
    fr.readAsDataURL(file)
  })
}
