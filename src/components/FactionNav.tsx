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
    <div className="absolute bottom-4 left-4 right-4 z-10 glass-2 rounded-2xl shadow-[var(--shadow-glass)]
                    flex items-stretch gap-1 px-2 py-2 max-w-full">
      {/* Faction tabs */}
      <div className="flex items-stretch gap-0.5 pr-2 mr-1 border-r border-white/10 shrink-0">
        {FACTIONS.map(f => {
          const isActive = active === f.id
          const dirty = factionHasDirty(f.id)
          return (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={`relative px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-[1px] transition
                ${isActive
                  ? 'bg-[var(--color-accent)] text-black'
                  : 'text-[var(--color-text-3)] hover:text-white hover:bg-white/5'}`}
            >
              {f.label}
              {dirty && !isActive && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-orange-400" />
              )}
            </button>
          )
        })}
      </div>

      {/* Vehicle pills — single horizontal scroll row */}
      <div
        ref={rowRef}
        className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0
                   [&::-webkit-scrollbar]:h-1
                   [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb]:rounded-full
                   [&::-webkit-scrollbar-track]:bg-transparent">
        {list.map(v => {
          const isActive = v.id === currentId
          const dirty = (project.vehicles[v.id]?.decals?.length ?? 0) > 0
          return (
            <button
              key={v.id}
              data-id={v.id}
              onClick={() => onPick(v.id)}
              className={`relative px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition
                border ${isActive
                  ? 'bg-[var(--color-accent)] text-black border-[var(--color-accent)]'
                  : 'bg-white/5 text-[var(--color-text-2)] border-white/5 hover:bg-white/10 hover:text-white'}`}
            >
              {v.displayName}
              <span className={`ml-1.5 px-1 py-0.5 rounded text-[9px] tabular-nums
                ${isActive ? 'bg-black/25' : 'bg-black/40 text-[var(--color-text-3)]'}`}>{v.defaultTac}</span>
              {dirty && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_4px_#fb923c]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
