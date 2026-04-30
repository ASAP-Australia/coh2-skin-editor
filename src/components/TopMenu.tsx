import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { downloadProject, getOrInitVehicle, readProjectFile, type Coh2SkinProject, type Decal, type DecalType } from '@/lib/project'
import type { VehicleSpec } from '@/lib/vehicles'

type MenuId = 'view' | 'decals' | 'reference' | 'export'

interface Props {
  active: MenuId | null
  setActive: (m: MenuId | null) => void
  project: Coh2SkinProject
  setProject: (p: Coh2SkinProject) => void
  vehicle: VehicleSpec
  season: 'summer' | 'winter'
  setSeason: (s: 'summer' | 'winter') => void
  placeMode: DecalType | 'off'
  setPlaceMode: (m: DecalType | 'off') => void
  activeDecalId: number | null
  setActiveDecalId: (id: number | null) => void
  updateDecal: (id: number, patch: Partial<Decal>) => void
  removeDecal: (id: number) => void
  clearDecals: () => void
  onDisconnect: () => void
  overlayCanvas: HTMLCanvasElement | null
}

/** Top-left menu bar with four dropdowns. Only one menu open at a time;
 *  click a menu button to toggle, click outside to close. */
export default function TopMenu(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)

  // Click-outside dismiss
  useEffect(() => {
    if (!p.active) return
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) p.setActive(null)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [p.active])

  const veh = getOrInitVehicle(p.project, p.vehicle.id)
  const activeDecal = p.activeDecalId != null ? veh.decals.find(d => d.id === p.activeDecalId) ?? null : null

  return (
    <div ref={wrapRef} className="absolute top-4 left-4 z-20 flex flex-col gap-2 items-start">
      {/* Brand pill + menu buttons row */}
      <div className="glass-2 rounded-2xl px-3 py-2 flex items-center gap-2 shadow-[var(--shadow-glass)]">
        <div className="pr-2 mr-1 border-r border-white/10 leading-tight">
          <div className="text-[9px] uppercase tracking-[1.5px] text-[var(--color-accent)] font-bold">CoH2</div>
          <div className="text-[12px] text-white font-semibold">{p.vehicle.displayName}</div>
        </div>
        <MenuBtn id="view"      label="View"      active={p.active} setActive={p.setActive} />
        <MenuBtn id="decals"    label="Decals"    active={p.active} setActive={p.setActive} />
        <MenuBtn id="reference" label="Reference" active={p.active} setActive={p.setActive} />
        <MenuBtn id="export"    label="Export"    active={p.active} setActive={p.setActive} />
      </div>

      {/* Dropdown panels */}
      {p.active === 'view' && <ViewPanel {...p} />}
      {p.active === 'decals' && <DecalsPanel {...p} activeDecal={activeDecal} />}
      {p.active === 'reference' && <ReferencePanel {...p} />}
      {p.active === 'export' && <ExportPanel {...p} />}
    </div>
  )
}

function MenuBtn({ id, label, active, setActive }: {
  id: MenuId; label: string; active: MenuId | null; setActive: (m: MenuId | null) => void
}) {
  const isActive = active === id
  return (
    <button
      onClick={() => setActive(isActive ? null : id)}
      className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition border
        ${isActive
          ? 'bg-[var(--color-accent)] text-black border-[var(--color-accent)]'
          : 'bg-white/5 text-[var(--color-text-2)] border-white/10 hover:bg-white/10 hover:text-white'}`}
    >
      {label}
      <span className={`ml-1 text-[8px] ${isActive ? 'rotate-180 inline-block' : ''}`}>▾</span>
    </button>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-2 rounded-2xl p-4 min-w-[280px] max-w-[320px] shadow-[var(--shadow-pop)]
                    animate-[in_180ms_cubic-bezier(.2,.8,.2,1)]">
      {children}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[9px] uppercase tracking-[2px] text-[var(--color-text-3)] font-semibold mb-2">{label}</div>
      {children}
    </div>
  )
}

function Toggle<T extends string>({ value, options, onChange }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 bg-black/30 rounded-lg p-0.5">
      {options.map(o => (
        <button key={o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition
            ${value === o.id
              ? 'bg-[var(--color-accent)] text-black'
              : 'text-[var(--color-text-2)] hover:text-white'}`}
        >{o.label}</button>
      ))}
    </div>
  )
}

// ============================================================================
// View panel
// ============================================================================
function ViewPanel(p: Props) {
  return (
    <Panel>
      <Section label="Season">
        <Toggle value={p.season} onChange={p.setSeason} options={[
          { id: 'summer', label: 'Summer' },
          { id: 'winter', label: 'Winter' },
        ]} />
      </Section>
      <Section label="Pack info">
        <input
          value={p.project.packName}
          onChange={e => p.setProject({ ...p.project, packName: e.target.value })}
          className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[12px] border border-white/10
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
        />
        <textarea
          value={p.project.packDescription}
          onChange={e => p.setProject({ ...p.project, packDescription: e.target.value })}
          rows={3}
          className="w-full mt-2 bg-black/30 rounded-md px-2.5 py-1.5 text-[11px] border border-white/10
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40 resize-none"
        />
      </Section>
      <Button variant="ghost" size="sm" className="w-full text-[var(--color-text-3)]" onClick={p.onDisconnect}>
        Disconnect / pick different folder
      </Button>
    </Panel>
  )
}

// ============================================================================
// Decals panel
// ============================================================================
function DecalsPanel(p: Props & { activeDecal: Decal | null }) {
  const veh = getOrInitVehicle(p.project, p.vehicle.id)
  return (
    <Panel>
      <Section label="Place decal">
        <div className="grid grid-cols-3 gap-1.5">
          {(['off','shield','number','name','kills','cross'] as const).map(t => (
            <button key={t}
              onClick={() => p.setPlaceMode(t)}
              className={`px-2 py-2 rounded-lg text-[11px] font-medium transition
                ${p.placeMode === t
                  ? 'bg-[var(--color-accent)] text-black'
                  : 'glass-1 text-[var(--color-text-2)] hover:text-white'}`}
            >{t === 'off' ? 'Off' : `+ ${cap(t)}`}</button>
          ))}
        </div>
        {p.placeMode !== 'off' && (
          <div className="mt-2 text-[10px] text-[var(--color-text-2)] leading-relaxed">
            Click on the tank to drop a {p.placeMode}. Hover preview shows where it will land.
          </div>
        )}
      </Section>

      <Section label={`Placed (${veh.decals.length})`}>
        <div className="max-h-32 overflow-y-auto space-y-1 text-[10px] font-mono">
          {veh.decals.length === 0
            ? <div className="text-[var(--color-text-3)] py-2 text-center">no decals placed</div>
            : veh.decals.map(d => (
              <div key={d.id}
                onClick={() => p.setActiveDecalId(d.id)}
                className={`px-2 py-1.5 rounded cursor-pointer flex items-center justify-between
                  ${d.id === p.activeDecalId ? 'bg-orange-900/30 text-orange-300' : 'hover:bg-white/5'}`}
              >
                <span>{d.type[0].toUpperCase()} ({d.x},{d.y}){d.rot ? ` ${d.rot}°` : ''} {d.size}px</span>
                <button onClick={e => { e.stopPropagation(); p.removeDecal(d.id) }}
                        className="text-white/40 hover:text-white">×</button>
              </div>
            ))}
        </div>
      </Section>

      {p.activeDecal && <ActiveDecalControls p={p} d={p.activeDecal} />}

      <button onClick={p.clearDecals}
              className="w-full mt-2 py-1.5 rounded-lg bg-white/5 text-[var(--color-text-3)] text-[11px] hover:bg-white/10">
        Clear all decals
      </button>
    </Panel>
  )
}

function ActiveDecalControls({ p, d }: { p: Props & { activeDecal: Decal | null }; d: Decal }) {
  return (
    <Section label={`Edit ${cap(d.type)}`}>
      <Slider label="Rotation" suffix="°" value={d.rot} min={-180} max={180} step={5}
              onChange={v => p.updateDecal(d.id, { rot: v })} />
      <Slider label="Size" suffix="px" value={d.size} min={20} max={400} step={2}
              onChange={v => p.updateDecal(d.id, { size: v })} />
      {d.type === 'kills' && (
        <Slider label="Kill rings" suffix="" value={d.kills ?? 8} min={1} max={60} step={1}
                onChange={v => p.updateDecal(d.id, { kills: v })} />
      )}
      {(d.type === 'number' || d.type === 'name') && (
        <input
          value={d.text ?? ''}
          placeholder={d.type === 'number' ? p.vehicle.defaultTac : 'Vehicle name'}
          onChange={e => p.updateDecal(d.id, { text: e.target.value || null })}
          className="w-full mt-2 bg-black/30 rounded-md px-2.5 py-1.5 text-[11px] border border-white/10
                     focus:outline-none focus:border-[var(--color-accent)]"
        />
      )}
    </Section>
  )
}

function Slider({ label, suffix, value, min, max, step, onChange }: {
  label: string; suffix: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <label className="block mb-2">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-[var(--color-text-2)]">{label}</span>
        <span className="text-white tabular-nums">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--color-accent)]" />
    </label>
  )
}

// ============================================================================
// Reference panel
// ============================================================================
function ReferencePanel(p: Props) {
  return (
    <Panel>
      <Section label="Reference skin (ghost overlay)">
        <select
          value={p.project.refPackId ?? ''}
          onChange={e => p.setProject({ ...p.project, refPackId: e.target.value || null })}
          className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[11px] border border-white/10"
        >
          <option value="">— none —</option>
          <option value="auto">(auto-detect from CoH2 install)</option>
        </select>
        <p className="text-[10px] text-[var(--color-text-3)] mt-2 leading-relaxed">
          Reference packs are auto-discovered from your <code>mods/skins/subscriptions</code> folder
          on the next refactor commit. For now this is a placeholder slot.
        </p>
      </Section>
    </Panel>
  )
}

// ============================================================================
// Export panel — save / load .coh2skin, export icons, bake to SGA
// ============================================================================
function ExportPanel(p: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const proj = await readProjectFile(file)
      p.setProject(proj)
    } catch (err: any) { alert(err?.message ?? String(err)) }
    e.target.value = ''
  }
  const onSavePng = () => {
    const cv = p.overlayCanvas
    if (!cv) return
    const url = cv.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url; a.download = `${p.vehicle.id}-${p.season}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }
  return (
    <Panel>
      <Section label="Project">
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" className="rounded-lg bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-strong)]"
                  onClick={() => downloadProject(p.project)}>
            Save .coh2skin
          </Button>
          <Button size="sm" variant="secondary" className="rounded-lg"
                  onClick={() => fileInputRef.current?.click()}>
            Load .coh2skin
          </Button>
          <input ref={fileInputRef} type="file" accept=".coh2skin,.json" onChange={onLoad} className="hidden" />
        </div>
      </Section>
      <Section label="Vehicle texture (PNG)">
        <Button size="sm" variant="secondary" className="w-full rounded-lg" onClick={onSavePng}>
          Download {p.vehicle.id}_{p.season}.png
        </Button>
        <p className="text-[10px] text-[var(--color-text-3)] mt-2 leading-relaxed">
          Drops the live composited diffuse so you can hand it to the
          existing Python pipeline (<code>tools/sync_skins_to_modproject.sh</code>)
          to rebuild the SGA. Future commit ships in-browser SGA writing.
        </p>
      </Section>
    </Panel>
  )
}

function cap(s: string) { return s[0].toUpperCase() + s.slice(1) }
