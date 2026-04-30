import { FACTIONS, VEHICLES, type Faction } from '@/lib/vehicles'
import type { Coh2SkinProject } from '@/lib/project'

interface Props {
  project: Coh2SkinProject
  currentId: string
  onPick: (id: string) => void
}

/** Bottom-anchored scrollable button bar grouped by faction. Vehicles with
 *  edited decals show a small orange dot. */
export default function FactionNav({ project, currentId, onPick }: Props) {
  return (
    <div className="absolute bottom-4 left-4 right-4 z-10 glass-2 rounded-2xl px-3 py-2 flex flex-col gap-1
                    shadow-[var(--shadow-glass)] backdrop-blur-md">
      {FACTIONS.map(f => (
        <FactionRow key={f.id} faction={f} label={f.label} project={project} currentId={currentId} onPick={onPick} />
      ))}
    </div>
  )
}

function FactionRow({ faction, label, project, currentId, onPick }: {
  faction: { id: Faction; label: string }
  label: string
  project: Coh2SkinProject
  currentId: string
  onPick: (id: string) => void
}) {
  const list = VEHICLES.filter(v => v.faction === faction.id)
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1
                    [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent
                    [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
      <span className="text-[9px] font-bold uppercase tracking-[1.5px] text-[var(--color-text-3)]
                       w-14 text-right shrink-0">{label}</span>
      {list.map(v => {
        const dirty = (project.vehicles[v.id]?.decals?.length ?? 0) > 0
        const active = v.id === currentId
        return (
          <button
            key={v.id}
            onClick={() => onPick(v.id)}
            className={`relative px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition
              ${active
                ? 'bg-[var(--color-accent)] text-black border border-[var(--color-accent)]'
                : 'glass-1 text-[var(--color-text-2)] border border-white/5 hover:bg-white/8 hover:text-white'}`}
          >
            {v.displayName}
            <span className={`ml-1.5 px-1 py-0.5 rounded text-[9px] tabular-nums
              ${active ? 'bg-black/25' : 'bg-black/30 text-[var(--color-text-3)]'}`}>{v.defaultTac}</span>
            {dirty && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_4px_#fb923c]" />}
          </button>
        )
      })}
    </div>
  )
}
