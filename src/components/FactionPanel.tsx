/**
 * FactionPanel — left-edge faction switcher (C1).
 *
 * A skin pack can span multiple vehicles across multiple factions (see
 * project.ts `factions: Faction[]`), so the editor needs a quick way to
 * jump between factions rather than a one-time "pick faction" gate.
 *
 * This mirrors ScenePanel on the RIGHT edge: a vertically-stacked column
 * of circular emblem buttons, centered on the LEFT edge, same glass
 * styling. Clicking a faction switches the bottom VehicleMenu to that
 * faction's vehicles (the parent swaps to the faction's default vehicle,
 * which cascades back into `selectedFaction`).
 *
 * All five factions are always shown (like ScenePanel always shows all
 * three scene presets); the project's own factions get a subtle dot so
 * the user can tell which ones the pack already touches.
 */

import { FACTION_ICONS, FACTION_LABELS } from '@/lib/factions'
import { FACTIONS, type Faction } from '@/lib/vehicles'

interface Props {
  /** Currently-active faction (drives the highlight). */
  selected: Faction
  /** Switch to a faction — parent loads that faction's default vehicle. */
  onSelect: (faction: Faction) => void
  /** Factions the pack already has vehicles for (subtle presence dot). */
  packFactions?: Faction[]
}

export default function FactionPanel({ selected, onSelect, packFactions }: Props) {
  const present = new Set(packFactions ?? [])
  return (
    <div
      className="glass-hud fixed top-1/2 left-5 -translate-y-1/2 z-30 flex flex-col gap-2 p-1.5 rounded-2xl"
    >
      {FACTIONS.map(({ id }) => {
        const active = selected === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={active}
            title={FACTION_LABELS[id]}
            className={[
              'relative w-11 h-11 rounded-xl flex items-center justify-center',
              'transition-all duration-150 active:scale-95',
              active
                ? 'bg-white/95 shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
                : 'hover:bg-white/10 opacity-80 hover:opacity-100',
            ].join(' ')}
          >
            {FACTION_ICONS[id]}
            {present.has(id) && !active && (
              <span
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                style={{ background: 'rgb(255, 159, 67)', boxShadow: '0 0 4px rgba(255,159,67,0.8)' }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
