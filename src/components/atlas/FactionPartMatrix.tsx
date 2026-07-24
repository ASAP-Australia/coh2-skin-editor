/**
 * FactionPartMatrix — overview grid of parts × factions.
 * Click a cell to jump to that (part, faction) combination.
 * Override dot shown on cells where part.overrides[faction] is non-empty.
 */
import { type Coh2DecalPackProject, ATLAS_PART_DEFS, atlasPartLabel } from '@/lib/decal-pack-project'
import { type DecalFaction } from '@/lib/decal-mod-templates'
import { FACTION_LABELS, FACTION_COLORS } from '@/lib/factions'

const DISPLAY_ORDER: DecalFaction[] = ['german', 'west_german', 'soviet', 'aef', 'british']

interface Props {
  project: Coh2DecalPackProject
  activePart: number
  activeFaction: DecalFaction | null
  onSelect: (partIndex: number, faction: DecalFaction | null) => void
}

export default function FactionPartMatrix({ project, activePart, activeFaction, onSelect }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${DISPLAY_ORDER.length}, 44px)`, gap: 4 }}>
      {/* Header row */}
      <div />  {/* empty top-left cell */}
      {DISPLAY_ORDER.map(faction => (
        <div
          key={faction}
          style={{ fontSize: 10, color: FACTION_COLORS[faction], textAlign: 'center', paddingBottom: 2 }}
        >
          {FACTION_LABELS[faction]}
        </div>
      ))}

      {/* Data rows: one per part */}
      {ATLAS_PART_DEFS.map((_def, pi) => (
        <>
          {/* Part label */}
          <div key={`label-${pi}`} style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', paddingRight: 4 }}>
            {atlasPartLabel(pi)}
          </div>

          {/* Faction cells */}
          {DISPLAY_ORDER.map(faction => {
            const part = project.parts?.[pi]
            const hasOverride = !!(part?.overrides?.[faction]?.length)
            const isActive = activePart === pi && activeFaction === faction

            return (
              <button
                key={`${pi}-${faction}`}
                onClick={() => onSelect(pi, faction)}
                title={`${atlasPartLabel(pi)} / ${FACTION_LABELS[faction]}${hasOverride ? ' (override)' : ''}`}
                aria-pressed={isActive}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 6,
                  border: isActive
                    ? `2px solid ${FACTION_COLORS[faction]}`
                    : '2px solid rgba(255,255,255,0.10)',
                  background: isActive
                    ? `${FACTION_COLORS[faction]}20`
                    : 'rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* Override indicator dot */}
                {hasOverride && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 3,
                      right: 3,
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: FACTION_COLORS[faction],
                    }}
                  />
                )}
                {/* Show shared layer count */}
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                  {hasOverride
                    ? (part?.overrides?.[faction]?.length ?? 0)
                    : (part?.shared.length ?? 0)}
                </span>
              </button>
            )
          })}
        </>
      ))}
    </div>
  )
}
