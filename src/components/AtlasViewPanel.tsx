/**
 * AtlasViewPanel — right-edge view-mode picker for the Faceplate /
 * Decal-pack editor canvas. Mirrors `ScenePanel.tsx` (the Vehicle
 * Viewport's environment preset picker) in styling and structure so
 * the editor surface feels unified across the three editor types.
 *
 * Three vertically-stacked circular icon buttons:
 *   • Template      (`LayoutTemplate`) — default editor scaffolding
 *   • Checkerboard  (`Grid3x3`)        — light-checker transparency
 *   • In-game       (`Eye`)            — CoH2 UI mock overlay
 *
 * Persisted view mode is owned by the parent (FaceplateEditor /
 * DecalPackEditor); this component is purely presentational + emits
 * setMode on click.
 */

import { LayoutTemplate, Grid3x3, Eye } from 'lucide-react'
import {
  type AtlasViewMode,
  ATLAS_VIEW_MODE_LABEL,
  ATLAS_VIEW_MODE_ORDER,
} from '@/lib/atlas-view-settings'

interface Props {
  mode: AtlasViewMode
  setMode: (mode: AtlasViewMode) => void
  /** Optional aria-label override for the surrounding container. */
  ariaLabel?: string
}

const VIEW_MODE_ICONS: Record<AtlasViewMode, React.ReactNode> = {
  template: <LayoutTemplate size={20} />,
  checkerboard: <Grid3x3 size={20} />,
  in_game: <Eye size={20} />,
}

export default function AtlasViewPanel({ mode, setMode, ariaLabel = 'View mode' }: Props) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="glass-hud fixed top-1/2 right-5 -translate-y-1/2 z-30 flex flex-col gap-2 p-1.5 rounded-2xl"
    >
      {ATLAS_VIEW_MODE_ORDER.map(id => {
        const active = mode === id
        const meta = ATLAS_VIEW_MODE_LABEL[id]
        return (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            aria-pressed={active}
            aria-label={meta.label}
            title={`${meta.label} — ${meta.description}`}
            data-mode={id}
            className={[
              'relative w-11 h-11 rounded-xl flex items-center justify-center',
              'transition-all duration-150 active:scale-95',
              active
                ? 'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
                : 'text-[var(--color-text-2)] hover:text-white hover:bg-white/10',
            ].join(' ')}
          >
            {VIEW_MODE_ICONS[id]}
          </button>
        )
      })}
    </div>
  )
}
