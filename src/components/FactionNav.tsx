import { useEffect, useRef, useState } from 'react'
import { FACTIONS, VEHICLES, type Faction } from '@/lib/vehicles'
import type { Coh2SkinProject } from '@/lib/project'

interface Props {
  project: Coh2SkinProject
  currentId: string
  onPick: (id: string) => void
}

/** Compact bottom bar: faction tabs on the left, vehicle pills for the
 *  active faction in a single horizontally-scrollable row. The whole bar
 *  is a single line of UI so the 3D viewport gets max vertical real-estate. */
export default function FactionNav({ project, currentId, onPick }: Props) {
  // Auto-select the faction that owns the currentId
  const initialFaction: Faction = (VEHICLES.find(v => v.id === currentId)?.faction) ?? 'german'
  const [active, setActive] = useState<Faction>(initialFaction)
  useEffect(() => {
    const f = VEHICLES.find(v => v.id === currentId)?.faction
    if (f) setActive(f)
  }, [currentId])

  const list = VEHICLES.filter(v => v.faction === active)
  const rowRef = useRef<HTMLDivElement>(null)
  // Scroll the active button into view when faction or vehicle changes
  useEffect(() => {
    if (!rowRef.current) return
    const el = rowRef.current.querySelector(`[data-id="${currentId}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [currentId, active])

  // Per-faction "any vehicle dirty" indicator
  const factionHasDirty = (f: Faction) => VEHICLES.some(v =>
    v.faction === f && (project.vehicles[v.id]?.decals?.length ?? 0) > 0)

  return (
    <>
      {/* Vehicle pills — floating glass pill centered ABOVE the faction bar.
          Appears for the active faction. Apple Control Center / Dock styling:
          heavy blur, subtle inner highlight, 1px hairline border.

          v1.0 UX trim: dropped horizontal scrolling (overflow-x-auto +
          its custom scrollbar utilities) and the 960 px width cap. User
          feedback: "it should show all the vehicles on that vehicle tab
          at once. No scrolling, no whatever." With at most 11 vehicles
          per faction (Soviet/USF caps), text-only pills fit on a single
          line up to ~1700 px viewport width — beyond that we let the
          pills wrap via `flex-wrap` so every vehicle stays clickable
          even on narrower windows. The max-w is bumped from 960 to 96vw
          so we never re-introduce horizontal scrolling.
       */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-10 max-w-[min(96vw,1400px)]
                   rounded-2xl shadow-[var(--shadow-glass)] px-2 py-1.5"
        style={{
          bottom: 76,
          background: 'rgba(20, 22, 28, 0.62)',
          backdropFilter: 'blur(28px) saturate(180%)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          border: '0.5px solid rgba(255,255,255,0.10)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
        }}
      >
        <div
          ref={rowRef}
          className="flex items-center justify-center gap-1 flex-wrap"
        >
          {list.map(v => {
            const isActive = v.id === currentId
            const decalCount = project.vehicles[v.id]?.decals?.length ?? 0
            const dirty = decalCount > 0
            const title = `${v.displayName} · default tactical # ${v.defaultTac}` +
              (dirty ? ` · ${decalCount} decal${decalCount === 1 ? '' : 's'} placed` : ' · no decals yet')
            return (
              <button
                key={v.id}
                data-id={v.id}
                onClick={() => onPick(v.id)}
                title={title}
                className={`relative px-3 py-1.5 rounded-pill text-[11px] font-medium whitespace-nowrap shrink-0 transition-all
                  ${isActive
                    ? 'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
                    : 'text-[var(--color-text-2)] hover:bg-white/10 hover:text-white'}`}
              >
                {v.displayName}
                {dirty && (
                  <span title={`${decalCount} decal${decalCount === 1 ? '' : 's'} on this vehicle`}
                        className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400 shadow-[0_0_4px_#fb923c]" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Faction tabs — centered floating pill at the very bottom. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10
                   rounded-pill shadow-[var(--shadow-glass)] flex items-center gap-0.5 px-1 py-1"
        style={{
          background: 'rgba(20, 22, 28, 0.62)',
          backdropFilter: 'blur(28px) saturate(180%)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          border: '0.5px solid rgba(255,255,255,0.10)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
        }}
      >
        {FACTIONS.map(f => {
          const isActive = active === f.id
          const dirty = factionHasDirty(f.id)
          return (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={`relative px-4 py-1.5 rounded-pill text-[11px] font-bold uppercase tracking-[1.5px] transition-all
                ${isActive
                  ? 'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
                  : 'text-[var(--color-text-3)] hover:text-white hover:bg-white/10'}`}
            >
              {f.label}
              {dirty && !isActive && (
                <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-orange-400" />
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
