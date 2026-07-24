/**
 * FactionRow — horizontal strip of 5 faction tabs for the atlas part editor.
 * Active faction: colored ring + highlight. null = shared (all factions).
 */
import { type DecalFaction } from '@/lib/decal-mod-templates'
import { FACTION_LABELS, FACTION_COLORS, FACTION_ICON_SRC } from '@/lib/factions'

// Display order: german first, then west_german, soviet, aef, british.
const DISPLAY_ORDER: DecalFaction[] = ['german', 'west_german', 'soviet', 'aef', 'british']

interface Props {
  activeFaction: DecalFaction | null   // null = "shared" (all factions)
  onChange: (faction: DecalFaction | null) => void
}

export default function FactionRow({ activeFaction, onChange }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {/* Hint label — changes based on whether shared or a specific faction is selected */}
      <span
        style={{
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: activeFaction === null ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {activeFaction === null ? 'Editing: Shared (all factions)' : 'Editing faction override'}
      </span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          background: 'rgba(16,18,24,0.80)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
        }}
      >
      {/* "Shared" tab = all factions */}
      <button
        title="Shared layers — apply to all factions"
        aria-pressed={activeFaction === null}
        onClick={() => onChange(null)}
        style={{
          height: 32,
          padding: '0 9px',
          borderRadius: 8,
          border: activeFaction === null
            ? '2px solid rgba(255,255,255,0.75)'
            : '2px solid rgba(255,255,255,0.15)',
          background: activeFaction === null ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          color: activeFaction === null ? '#fff' : 'rgba(255,255,255,0.55)',
          fontWeight: 600,
          letterSpacing: '0.04em',
          transition: 'border-color 0.15s, background 0.15s, color 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        Shared
      </button>

      {DISPLAY_ORDER.map(faction => {
        const isActive = activeFaction === faction
        const color = FACTION_COLORS[faction]
        const iconSrc = FACTION_ICON_SRC[faction]
        return (
          <button
            key={faction}
            title={`${FACTION_LABELS[faction]} override`}
            aria-pressed={isActive}
            onClick={() => onChange(faction)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: isActive
                ? `2px solid ${color}`
                : '2px solid rgba(255,255,255,0.12)',
              boxShadow: isActive ? `0 0 0 2px ${color}40` : 'none',
              background: 'rgba(16,18,24,0.60)',
              cursor: 'pointer',
              padding: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
          >
            <img
              src={iconSrc}
              alt={FACTION_LABELS[faction]}
              style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
            />
          </button>
        )
      })}
      </div>
    </div>
  )
}
