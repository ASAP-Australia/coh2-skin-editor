/**
 * SeasonToggle — small floating segmented control for swapping the demo
 * scene (and editor scene) between summer and winter texture sets.
 *
 * Mounted above-right of the bottom-center VehicleMenu so the season is
 * visible alongside the vehicle list — the user said it's a top-level
 * concern, not a settings-panel option.
 *
 * Stateless: parent owns the season value. Just two icon-and-label
 * segments; clicking the inactive one flips it.
 */

import { Snowflake, Sun } from 'lucide-react'
import LoadingBorder from './ui/loading-border'

interface Props {
  value: 'summer' | 'winter'
  onChange: (s: 'summer' | 'winter') => void
  /** Show the rotating loading beam while the parent re-skins the
   *  vehicle in response to a season swap. Cleared when the new
   *  diffuse has been bound. */
  loading?: boolean
}

export default function SeasonToggle({ value, onChange, loading = false }: Props) {
  return (
    <LoadingBorder
      active={loading}
      radius={9999}
      className="glass-pill inline-flex items-center gap-0.5 rounded-full p-1 select-none"
    >
      <Segment
        active={value === 'summer'}
        onClick={() => onChange('summer')}
        icon={<Sun size={13} strokeWidth={2} />}
        label="Summer"
        activeTint="rgba(255, 200, 90, 0.18)"
      />
      <Segment
        active={value === 'winter'}
        onClick={() => onChange('winter')}
        icon={<Snowflake size={13} strokeWidth={2} />}
        label="Winter"
        activeTint="rgba(140, 200, 255, 0.20)"
      />
    </LoadingBorder>
  )
}

function Segment({
  active,
  onClick,
  icon,
  label,
  activeTint,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  /** Subtle seasonal tint behind the active pill — warm yellow for summer,
   *  cool blue for winter. Reads as decorative, not skinning the whole UI. */
  activeTint: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150 cursor-pointer ${
        active
          ? 'text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
          : 'hover:text-white'
      }`}
      style={{
        background: active
          ? `linear-gradient(${activeTint}, ${activeTint}), rgba(255,255,255,0.95)`
          : 'transparent',
        backgroundBlendMode: active ? 'overlay' : undefined,
        opacity: active ? 1 : 0.55,
        transition: 'opacity 150ms ease, background 150ms ease, color 150ms ease',
      }}
      onMouseEnter={e => {
        if (!active) {
          ;(e.currentTarget as HTMLElement).style.opacity = '1'
          ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          ;(e.currentTarget as HTMLElement).style.opacity = '0.55'
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        }
      }}
    >
      <span className="flex items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
