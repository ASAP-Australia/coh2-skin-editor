/**
 * LiveSyncBadge — historically a clickable Live Sync status badge (icon +
 * tooltip + inventory-icon picker popover). That standalone badge was rendered
 * nowhere after the Live Sync UI moved into `editor-primitives/EditorTitlePill`,
 * which shows the sync state via the `StateIcon` helper inline in the title pill.
 *
 * The orphaned default-export component (and its `LiveSyncPopover`,
 * `WorkshopSyncIndicator`, and `IconPickerProps`) were removed along with the
 * `LiveSyncBadge.test.tsx` suite. The file is intentionally kept at this path
 * because `EditorTitlePill` still imports the `StateIcon` state→icon mapping
 * from here — the only surviving, still-used export.
 */

import { CheckCircle2, XCircle, Loader2, Circle, Power } from 'lucide-react'
import type { LiveSyncState } from '@/lib/live-sync'

/**
 * Maps a Live Sync state to its status icon. Used by `EditorTitlePill` to render
 * the sync indicator inline in the editor title pill.
 */
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
