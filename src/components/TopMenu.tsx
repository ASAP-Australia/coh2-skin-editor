import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadProject, getOrInitVehicle, readProjectFile, type Coh2SkinProject, type Decal, type DecalType } from '@/lib/project'
import type { VehicleSpec } from '@/lib/vehicles'
import { buildDutchBrigadeDemo } from '@/lib/demo-project'
import ImageLibrary from './ImageLibrary'
import { defaultModsPath, detectOS, osLabel } from '@/lib/ux'
import { exportSkinPack, patchExport, hasKeyPool, type ExportProgress } from '@/lib/mod-export'
import { installSkinPack, loadSavedModsHandle, pickModsFolder } from '@/lib/coh2-fs'
import { SgaArchive } from '@/lib/sga'
import { parsePrompt, listPresets, type CamoPreset, generateCamo } from '@/lib/camo-generator'
import { SKYBOX_ENVS } from '@/lib/skybox'
import { PublishSection } from '@/components/PublishSection'
import { makeSkinPublishTarget, type WorkshopPublishTarget } from '@/components/PublishToWorkshopDialog'

type MenuId = 'view' | 'decals' | 'reference' | 'export' | 'parts' | 'camo' | 'scene'

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
  toast: (msg: string, kind?: 'info' | 'success' | 'error') => void
  pendingImageId: string | null
  setPendingImageId: (id: string | null) => void
  installRoot: FileSystemDirectoryHandle
  // Parts panel
  parts: string[]
  selectedPart: string | null
  setSelectedPart: (p: string | null) => void
  explodeAll: boolean
  setExplodeAll: (v: boolean) => void
  // Scene / environment
  envArchive: SgaArchive | null
  setEnvArchive: (a: SgaArchive | null) => void
  envName: string
  setEnvName: (n: string) => void
  // Camo
  camoPrompt: string
  setCamoPrompt: (s: string) => void
  camoPreset: CamoPreset | null
  onApplyCamo: (preset: CamoPreset) => void
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
    <div ref={wrapRef} className="top-menu-wrap absolute top-2 left-2 z-20 flex flex-col gap-2 items-start">
      {/* Brand pill + menu buttons row */}
      <div className="glass-2 rounded-2xl px-3 py-2 flex items-center gap-2 shadow-[var(--shadow-glass)]">
        <div className="pr-2 mr-1 border-r border-white/10 leading-tight">
          <div className="text-[9px] uppercase tracking-[1.5px] text-[var(--color-accent)] font-bold">CoH2</div>
          <div className="text-[12px] text-white font-semibold">{p.vehicle.displayName}</div>
        </div>
        <MenuBtn id="view"      label="View"      active={p.active} setActive={p.setActive} />
        <MenuBtn id="decals"    label="Decals"    active={p.active} setActive={p.setActive} />
        {/* v1.0 UX trim: "Parts" (Explode view) and "Camo" (Generate) are
            temporarily hidden — the underlying panels still exist (see
            `PartsPanel` / `CamoPanel` below) so re-enabling is a one-line
            change. User feedback: "get rid of generate for now since
            we're not using it, and get rid of explode for now since
            we're not using it." */}
        <MenuBtn id="scene"     label="Scene"     active={p.active} setActive={p.setActive} />
        <MenuBtn id="reference" label="Reference" active={p.active} setActive={p.setActive} />
        <MenuBtn id="export"    label="Export"    active={p.active} setActive={p.setActive} />
      </div>

      {/* Dropdown panels */}
      {p.active === 'view'      && <ViewPanel {...p} />}
      {p.active === 'decals'    && <DecalsPanel {...p} activeDecal={activeDecal} />}
      {p.active === 'parts'     && <PartsPanel {...p} />}
      {p.active === 'camo'      && <CamoPanel {...p} />}
      {p.active === 'scene'     && <ScenePanel {...p} />}
      {p.active === 'reference' && <ReferencePanel {...p} />}
      {p.active === 'export'    && <ExportPanel {...p} />}
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
          {(['off','shield','number','name','kills','cross','image'] as const).map(t => (
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
            Click on the tank to drop a {p.placeMode}. Hover shows where it will land.
          </div>
        )}
      </Section>

      {p.placeMode === 'image' && (
        <Section label="Custom image">
          <ImageLibrary project={p.project} setProject={p.setProject}
            onImageReady={(id) => { p.setPendingImageId(id) }}
            toast={p.toast}
          />
          {p.pendingImageId && p.project.images[p.pendingImageId] && (
            <div className="mt-2 text-[10px] text-[var(--color-text-2)]">
              Active: <span className="text-white">{p.project.images[p.pendingImageId].name}</span>
              {' — '}click on the tank to drop.
            </div>
          )}
        </Section>
      )}

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
      <Slider label="Size" suffix="px" value={d.size} min={20} max={500} step={2}
              onChange={v => p.updateDecal(d.id, { size: v })} />
      {d.type === 'kills' && (
        <Slider label="Kill rings" suffix="" value={d.kills ?? 8} min={1} max={60} step={1}
                onChange={v => p.updateDecal(d.id, { kills: v })} />
      )}
      {d.type === 'image' && (
        <Slider label="Opacity" suffix="%" value={Math.round((d.opacity ?? 1) * 100)}
                min={5} max={100} step={5}
                onChange={v => p.updateDecal(d.id, { opacity: v / 100 })} />
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
    } catch (err: unknown) { alert((err as { message?: string })?.message ?? String(err)) }
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
        <Button size="sm" variant="ghost"
                className="w-full mt-2 rounded-lg text-[var(--color-text-2)]"
                onClick={() => {
                  // Always replace — current project is auto-saved to
                  // localStorage already, and the user can hit Save .coh2skin
                  // to download it first. Toast confirms the swap.
                  const had = Object.keys(p.project.vehicles).length > 0
                  p.setProject(buildDutchBrigadeDemo())
                  p.toast(had ? 'Replaced with Brigade demo · previous in localStorage' : 'Brigade demo loaded', 'success')
                }}>
          Load Dutch Brigade demo
        </Button>
      </Section>
      <Section label="Build skin pack (.sga)">
        <ExportSkinPackButton p={p} />
      </Section>

      <Section label="Vehicle texture (PNG)">
        <Button size="sm" variant="secondary" className="w-full rounded-lg" onClick={onSavePng}>
          Download {p.vehicle.id}_{p.season}.png
        </Button>
      </Section>

      <Section label={`Drop the .sga here on ${osLabel(detectOS())}`}>
        <code className="text-[10px] block break-all bg-black/30 rounded px-2 py-1.5 text-[var(--color-text-2)] leading-relaxed border border-white/5">
          {defaultModsPath(detectOS())}
        </code>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(defaultModsPath(detectOS()))
            p.toast('Path copied', 'success')
          }}
          className="mt-1.5 text-[10px] text-[var(--color-accent)] hover:text-orange-300"
        >
          Copy path to clipboard ↗
        </button>
      </Section>
    </Panel>
  )
}

// ============================================================================
// Parts panel — exploded vehicle view
// ============================================================================
function PartsPanel(p: Props) {
  const hasParts = p.parts.length > 0
  return (
    <Panel>
      <Section label="Explode view">
        <div className="flex gap-1.5 mb-3">
          <button
            onClick={() => { p.setExplodeAll(!p.explodeAll); if (!p.explodeAll) p.setSelectedPart(null) }}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition
              ${p.explodeAll
                ? 'bg-[var(--color-accent)] text-black'
                : 'glass-1 text-[var(--color-text-2)] hover:text-white'}`}
          >
            Explode all
          </button>
          {p.selectedPart && (
            <button
              onClick={() => p.setSelectedPart(null)}
              className="px-2 py-1.5 rounded-lg text-[11px] glass-1 text-[var(--color-text-2)] hover:text-white"
            >
              Reset
            </button>
          )}
        </div>
        {hasParts ? (
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {p.parts.map(name => (
              <button
                key={name}
                onClick={() => {
                  p.setExplodeAll(false)
                  p.setSelectedPart(p.selectedPart === name ? null : name)
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition
                  ${p.selectedPart === name
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                    : 'hover:bg-white/5 text-[var(--color-text-2)] hover:text-white'}`}
              >
                {name || '(unnamed)'}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-[var(--color-text-3)] py-3 text-center">
            Load a vehicle to see its parts
          </div>
        )}
      </Section>
      {p.selectedPart && (
        <div className="text-[10px] text-[var(--color-text-2)] mt-2 leading-relaxed">
          <span className="text-blue-300">{p.selectedPart}</span> selected.
          Paint strokes will land on this part's UV region.
        </div>
      )}
    </Panel>
  )
}

// ============================================================================
// Camo panel — text-to-camo generator
// ============================================================================
function CamoPanel(p: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)

  const runPreview = (prompt: string) => {
    const preset = parsePrompt(prompt)
    const c = previewRef.current ?? document.createElement('canvas')
    c.width = c.height = 256
    previewRef.current = c
    generateCamo(c, preset)
    setPreview(c.toDataURL())
    return preset
  }

  return (
    <Panel>
      <Section label="Describe your camo">
        <input
          value={p.camoPrompt}
          onChange={e => { p.setCamoPrompt(e.target.value); if (e.target.value.length > 3) runPreview(e.target.value) }}
          placeholder="e.g. german ambush winter"
          className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[12px] border border-white/10
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
        />
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={() => {
              const preset = runPreview(p.camoPrompt || 'german summer')
              setPreview(previewRef.current?.toDataURL() ?? null)
              void preset
            }}
            className="flex-1 px-2 py-1.5 rounded-lg text-[11px] glass-1 text-[var(--color-text-2)] hover:text-white"
          >
            Preview
          </button>
          <button
            onClick={() => {
              const preset = parsePrompt(p.camoPrompt || 'german summer')
              p.onApplyCamo({ ...preset, seed: Date.now() & 0xfffff })
              runPreview(p.camoPrompt || 'german summer')
            }}
            className="flex-1 px-2 py-1.5 rounded-lg text-[11px] bg-[var(--color-accent)] text-black font-medium hover:bg-[var(--color-accent-strong)]"
          >
            Apply to skin
          </button>
        </div>
      </Section>

      {preview && (
        <div className="mb-3">
          <img src={preview} className="w-full rounded-lg border border-white/10" style={{ imageRendering: 'pixelated' }} />
        </div>
      )}

      <Section label="Quick presets">
        <div className="grid grid-cols-2 gap-1">
          {listPresets().map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                p.setCamoPrompt(key.replace(/_/g, ' '))
                const preset = parsePrompt(key)
                const c = previewRef.current ?? document.createElement('canvas')
                c.width = c.height = 256
                previewRef.current = c
                generateCamo(c, preset)
                setPreview(c.toDataURL())
              }}
              className="px-2 py-1.5 rounded-lg text-[10px] glass-1 text-[var(--color-text-2)] hover:text-white text-left truncate"
            >
              {label}
            </button>
          ))}
        </div>
      </Section>
    </Panel>
  )
}

// ============================================================================
// Scene panel — environment / skybox / terrain
// ============================================================================
function ScenePanel(p: Props) {
  const [loading, setLoading] = useState(false)

  const pickEnvFile = async () => {
    try {
      const [handle] = await (window as unknown as { showOpenFilePicker: (opts: { types: { description: string; accept: Record<string, string[]> }[]; multiple: boolean }) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
        types: [{ description: 'SGA Archive', accept: { 'application/octet-stream': ['.sga'] } }],
        multiple: false,
      })
      setLoading(true)
      const file = await handle.getFile()
      const archive = await SgaArchive.open(file)
      p.setEnvArchive(archive)
    } catch {/* user cancelled */} finally { setLoading(false) }
  }

  return (
    <Panel>
      <Section label="Season">
        <Toggle value={p.season} onChange={p.setSeason} options={[
          { id: 'summer', label: '☀ Summer' },
          { id: 'winter', label: '❄ Winter' },
        ]} />
      </Section>

      <Section label="Environment (skybox + terrain)">
        {p.envArchive ? (
          <div className="space-y-2">
            <div className="text-[10px] text-green-400">✓ ArtEnvironment.sga loaded</div>
            <select
              value={p.envName}
              onChange={e => p.setEnvName(e.target.value)}
              className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[11px] border border-white/10"
            >
              {SKYBOX_ENVS.map(env => (
                <option key={env} value={env}>{env.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button
              onClick={() => p.setEnvArchive(null)}
              className="text-[10px] text-[var(--color-text-3)] hover:text-white"
            >
              Remove environment
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] text-[var(--color-text-3)] leading-relaxed">
              Load ArtEnvironment.sga from your CoH2 install to enable real skyboxes
              and ground textures.
            </p>
            <Button size="sm" variant="secondary" className="w-full rounded-lg"
                    onClick={pickEnvFile} disabled={loading}>
              {loading ? 'Opening…' : 'Load ArtEnvironment.sga…'}
            </Button>
            <p className="text-[9px] text-[var(--color-text-3)] leading-relaxed">
              Usually at: CoH2/engine/mods/relic/archives/ArtEnvironment.sga
            </p>
          </div>
        )}
      </Section>
    </Panel>
  )
}

function cap(s: string) { return s[0].toUpperCase() + s.slice(1) }

/** "Build skin pack" — kicks off the full SGA export pipeline. Streams
 *  progress in-line so the user sees per-vehicle compositing happen.
 *  Two follow-up actions are then offered:
 *    1. "Install to game" — writes the SGA straight into the user's
 *       `mods/skins/` folder (asks for write permission once, persisted).
 *    2. "Download .sga" — falls back to a regular browser download. */
function ExportSkinPackButton({ p }: { p: Props }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [built, setBuilt] = useState<{ bytes: Uint8Array; filename: string; modGuid: string; numericId: string; textureCount: number } | null>(null)
  const [keyPoolAvailable, setKeyPoolAvailable] = useState<boolean | null>(null)
  // Workshop publish target — set after a successful build, cleared on rebuild
  const [publishTarget, setPublishTarget] = useState<WorkshopPublishTarget | null>(null)

  // Check key pool availability once on mount
  useState(() => { hasKeyPool().then(setKeyPoolAvailable) })

  const editedCount = Object.values(p.project.vehicles)
    .filter(v => (v.decals?.length ?? 0) > 0).length

  const build = async () => {
    if (busy) return
    setBusy(true); setProgress({ phase: 'init', message: 'Starting…' }); setBuilt(null); setPublishTarget(null)
    try {
      const useKeys = await hasKeyPool()
      const result = useKeys
        ? await patchExport(p.installRoot, p.project, ev => setProgress(ev))
        : await exportSkinPack(p.installRoot, p.project, ev => setProgress(ev))
      setBuilt(result)
      // Build publish target so the Workshop section appears immediately
      setPublishTarget(makeSkinPublishTarget(
        p.project,
        result.bytes,
        result.filename,
        p.overlayCanvas,
        (workshopId) => p.setProject({ ...p.project, workshopId }),
      ))
      p.toast(`Built ${result.textureCount} vehicle${result.textureCount === 1 ? '' : 's'} — install or download below`, 'success')
      setProgress(null)
    } catch (err: unknown) {
      p.toast((err as { message?: string })?.message ?? 'Export failed', 'error')
      setProgress(null)
    } finally { setBusy(false) }
  }

  const downloadBuilt = () => {
    if (!built) return
    const blob = new Blob([built.bytes as BlobPart], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = built.filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    p.toast(`Downloaded ${built.filename}`, 'success')
  }

  const installBuilt = async () => {
    if (!built) return
    try {
      let mods = await loadSavedModsHandle()
      if (!mods) {
        p.toast('Pick your CoH2 mods folder (the one containing skins/) — we ask once.', 'info')
        mods = await pickModsFolder()
      }
      if (!mods) return
      const r = await installSkinPack(mods, built.numericId, built.bytes)
      p.toast(`Installed → ${r.path} — restart CoH2 to pick it up`, 'success')
    } catch (err: unknown) {
      p.toast((err as { message?: string })?.message ?? 'Install failed', 'error')
    }
  }

  return (
    <div>
      <Button size="sm" disabled={busy || editedCount === 0}
              className="w-full rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-black font-semibold disabled:opacity-50"
              onClick={build}>
        {busy ? 'Building…' : built ? `Rebuild ${editedCount} vehicle${editedCount === 1 ? '' : 's'}` : `Build ${editedCount} vehicle${editedCount === 1 ? '' : 's'} → .sga`}
      </Button>

      {progress && (
        <div className="mt-2 text-[10px] text-[var(--color-text-2)] leading-relaxed">
          <div className="font-medium text-white">{progress.message}</div>
          {progress.total ? (
            <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-[var(--color-accent)] transition-all"
                   style={{ width: `${(progress.current ?? 0) / progress.total * 100}%` }} />
            </div>
          ) : null}
        </div>
      )}

      {built && !busy && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button size="sm"
                  className="rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-black"
                  onClick={installBuilt}>
            Install to game
          </Button>
          <Button size="sm" variant="secondary" className="rounded-lg" onClick={downloadBuilt}>
            Download .sga
          </Button>
          <div className="col-span-2 text-[10px] text-[var(--color-text-3)] mt-1 leading-relaxed">
            <span className="text-white">{built.filename}</span> ({(built.bytes.byteLength / 1024 / 1024).toFixed(1)} MB)
            {' · '}id <code className="text-[var(--color-text-2)]">{built.numericId}</code>
          </div>
        </div>
      )}

      {/* Workshop publish — same sliding-glass UX as decal/faceplate packs */}
      {built && !busy && (
        <div
          style={{
            marginTop: 12,
            borderTop: '1px solid rgba(255,255,255,0.07)',
            paddingTop: 12,
          }}
        >
          <div
            style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              color: 'rgba(247,247,250,0.35)',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Steam Workshop
          </div>
          <PublishSection
            target={publishTarget}
            isBuildingTarget={false}
            onRequestBuild={build}
          />
        </div>
      )}

      {editedCount === 0 && !busy && (
        <p className="mt-2 text-[10px] text-[var(--color-text-3)] leading-relaxed">
          Place at least one decal on a vehicle to enable export.
        </p>
      )}

      {keyPoolAvailable === false && !busy && (
        <p className="mt-2 text-[10px] text-yellow-400/70 leading-relaxed">
          No signed key pool found. Export will build an unsigned SGA that requires
          Workshop publication for in-game visibility.
        </p>
      )}
    </div>
  )
}
