/**
 * TopBar — top-left floating chrome.
 *
 * Layout:
 *   [Faction lobby icon ▾]  [Paint] [Compose] [Publish]
 *                       │
 *                       └─ click opens a dropdown of the 5 factions; clicking
 *                          a cluster button opens a dropdown panel below the
 *                          bar that shows the cluster's sub-tabs along the top.
 *
 * Cluster groups (the 7 underlying PanelIds are unchanged — only how the
 * top bar surfaces them):
 *   Paint   — Decals · Camo · Scene
 *   Compose — Parts · Reference
 *   Publish — Project · Export
 *
 * Each cluster remembers the last sub-tab the user opened so re-clicking
 * the cluster button restores their context instead of reverting to the
 * first child.
 *
 * Replaces the previous 25vw LeftSidebar. Vehicle selection moved to a
 * bottom-center VehicleMenu; environment-preset selection moved to a
 * vertical 3-icon column on the right edge (see ScenePanel).
 */

import { useEffect, useRef, useState } from 'react'
import {
  Eye,
  Paintbrush2,
  Brush,
  Boxes,
  Palette,
  Cloud,
  Book,
  FileUp,
  ChevronDown,
  LogOut,
  Star,
  Lock,
  Home,
  AlertTriangle,
  FlipHorizontal2,
  FlipVertical2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  downloadProject,
  getOrInitVehicle,
  readProjectFile,
  effectiveMainDecalId,
  persistActive,
  type Coh2SkinProject,
  type Decal,
  type DecalType,
} from '@/lib/project'
import { VEHICLES, type Faction } from '@/lib/vehicles'
import type { VehicleSpec } from '@/lib/vehicles'
import { FACTION_ICON_SRC, FACTION_LABELS } from '@/lib/factions'
import ImageLibrary from './ImageLibrary'
import SkinPackInGamePreview from './SkinPackInGamePreview'
import { defaultModsPath, detectOS } from '@/lib/ux'
import { exportSkinPack, patchExport, hasKeyPool, type ExportProgress } from '@/lib/mod-export'
import { installSkinPack, loadSavedModsHandle, pickModsFolder } from '@/lib/coh2-fs'
import { SgaArchive } from '@/lib/sga'
import { parsePrompt, listPresets, type CamoPreset, generateCamo } from '@/lib/camo-generator'
import { generateCamoWithDiffusion } from '@/lib/ai/generate-camo-diffusion'
import { adjustCamoDiffusion } from '@/lib/ai/adjust-camo-diffusion'
import { templatesForFaction, templateToDataUrl, type DecalTemplate } from '@/lib/decal-templates'
import type { BrushSettings } from '@/lib/brush'
import BrushPanel from './BrushPanel'
import { generateValidCoh2Texture } from '@/lib/ai/valid-coh2-texture'
import { rewriteAdjustment } from '@/lib/ai/rewrite-adjustment'
import { VoiceInput } from '@/components/VoiceInput'
import type { DiffusionStatus } from '@/lib/ai/types'
import LiveSyncBadge from '@/components/LiveSyncBadge'
import PublishToWorkshopDialog, { makeSkinPublishTarget } from '@/components/PublishToWorkshopDialog'

type PanelId = 'view' | 'decals' | 'reference' | 'export' | 'parts' | 'camo' | 'scene' | 'brush'

interface Props {
  activePanel: PanelId | null
  setActivePanel: (p: PanelId | null) => void
  project: Coh2SkinProject
  setProject: (p: Coh2SkinProject) => void
  vehicle: VehicleSpec
  setVehicleId: (id: string) => void
  season: 'summer' | 'winter'
  setSeason: (s: 'summer' | 'winter') => void
  placeMode: DecalType | 'off'
  setPlaceMode: (m: DecalType | 'off') => void
  activeDecalId: number | null
  setActiveDecalId: (id: number | null) => void
  updateDecal: (id: number, patch: Partial<Decal>) => void
  removeDecal: (id: number) => void
  clearDecals: () => void
  /** Toggle the per-vehicle main decal. Passing the currently-main id
   *  unsets it (null). Main decals get the top-right slot on tile icons
   *  and the top-left badge in the 3D hover preview. */
  setMainDecalId: (id: number | null) => void
  /** Switch which export slot is being edited — the live state mirrors
   *  the active slot, so changing this swaps the editor's content. */
  switchActiveSlot: (slotIdx: number) => void
  onDisconnect: () => void
  /** "Close pack" — exits the current pack and returns the user to
   *  StartScreen. When provided, the faction picker is locked (faction is
   *  bound to the pack at creation time) and a "Close pack" item appears
   *  in the lobby dropdown. */
  onClosePack?: () => void
  /** When true, the faction items in the lobby dropdown are disabled and
   *  the lobby button gets a small lock affordance. Driven by parent — set
   *  to true once the user has committed to a pack (i.e. left the new-
   *  project flow). */
  factionLocked?: boolean
  overlayCanvas: HTMLCanvasElement | null
  toast: (msg: string, kind?: 'info' | 'success' | 'error') => void
  pendingImageId: string | null
  setPendingImageId: (id: string | null) => void
  installRoot: FileSystemDirectoryHandle
  parts: string[]
  selectedPart: string | null
  setSelectedPart: (p: string | null) => void
  explodeAll: boolean
  setExplodeAll: (v: boolean) => void
  envArchive: SgaArchive | null
  setEnvArchive: (a: SgaArchive | null) => void
  envName: string
  setEnvName: (n: string) => void
  camoPrompt: string
  setCamoPrompt: (s: string) => void
  camoPreset: CamoPreset | null
  onApplyCamo: (preset: CamoPreset, scope?: 'vehicle' | 'faction' | 'all') => void
  /** Apply an AI-generated (or any HTMLImageElement) camo directly onto
   *  the overlay canvas and persist as a data URL. Scope 'vehicle' limits
   *  to the current vehicle; 'faction' broadcasts to all vehicles in the
   *  faction default; 'all' applies to every vehicle across all factions.
   *  Matches the signature in Editor.tsx `applyCamoImage`. */
  onApplyCamoImage: (img: HTMLImageElement, scope: 'vehicle' | 'faction' | 'all') => void
  /** Returns the vanilla diffuse atlas canvas for the current vehicle, or null
   *  if no model is loaded. Used by the "valid CoH2 atlas" diffusion mode
   *  to feed the unmodified atlas in as the img2img init + apply the
   *  per-vehicle body mask on top of the generated output. Returning a
   *  HTMLCanvasElement (not an Image) lets us avoid an extra rasterisation
   *  step inside the AI helper. */
  getVanillaAtlas?: () => HTMLCanvasElement | null
  /** Show / hide the crew (driver / commander figure) loaded behind
   *  the vehicle.  Defaults off because soldiers currently render in
   *  T-pose (no .rga animation decoder yet); the toggle exists so the
   *  user can opt in to the in-game-style "crewed vehicle" look and
   *  opt back out if the bind-pose silhouette reads wrong on a given
   *  vehicle. */
  showCrew: boolean
  setShowCrew: (v: boolean) => void
  /** Direct-paint brush state. The Editor owns the diffuse canvas + the
   *  history; this panel is purely a control surface for the active
   *  stroke parameters. Mutual exclusion with `placeMode` is handled in
   *  the Editor's setters. */
  brushOn: boolean
  setBrushOn: (v: boolean) => void
  brushSettings: BrushSettings
  setBrushSettings: (s: BrushSettings) => void
  /** One-shot eyedropper — the next viewport click samples the colour
   *  under the cursor into the brush instead of painting. */
  startEyedrop: () => void
  /** Wipe the painted layer back to the vanilla diffuse. */
  clearBrushPaint: () => void
}

/** Per-panel metadata. Used both inside the panel header (sub-tab pills)
 *  and as the source of truth for sub-tab labels/icons. */
const PANEL_META: Record<PanelId, { label: string; icon: React.ReactNode }> = {
  view: { label: 'Project', icon: <Eye size={14} /> },
  brush: { label: 'Brush', icon: <Brush size={14} /> },
  decals: { label: 'Decals', icon: <Paintbrush2 size={14} /> },
  parts: { label: 'Parts', icon: <Boxes size={14} /> },
  camo: { label: 'Camo', icon: <Palette size={14} /> },
  scene: { label: 'Scene', icon: <Cloud size={14} /> },
  reference: { label: 'Reference', icon: <Book size={14} /> },
  export: { label: 'Export', icon: <FileUp size={14} /> },
}

/** The 7 panels regrouped into 3 task-driven clusters. Each cluster owns a
 *  primary button in the top bar; the panel dropdown then surfaces the
 *  cluster's child panels as a row of sub-tab pills, so the user steps
 *  Cluster → sub-tab → control instead of scanning a flat 7-button row.
 *
 *    Paint   — surface authoring (where pixels actually land)
 *    Compose — model composition + visual reference material
 *    Publish — pack metadata + outbound mod export
 *
 * v1.0 UX trim: `camo` (text-to-camo generator) and `parts` (Explode view)
 * are temporarily hidden — the underlying panels still exist for future
 * use, but they're omitted from the chrome until the AI-camo pipeline and
 * the exploded-part picker are wired into the v1.0 flow. Users called the
 * generate / explode controls confusing in their current state. The
 * components are kept in the file (and in tests) so re-enabling them is a
 * one-line change to the panels arrays below.
 */
type ClusterId = 'paint' | 'compose' | 'publish'
const CLUSTERS: { id: ClusterId; label: string; icon: React.ReactNode; panels: PanelId[] }[] = [
  {
    id: 'paint',
    label: 'Paint',
    icon: <Paintbrush2 size={16} />,
    // v1.0: 'camo' (Generate) removed — see header comment.
    panels: ['brush', 'decals', 'scene'],
  },
  // v1.0: 'parts' (Explode view) removed — see header comment.
  { id: 'compose', label: 'Compose', icon: <Boxes size={16} />, panels: ['reference'] },
  { id: 'publish', label: 'Publish', icon: <FileUp size={16} />, panels: ['view', 'export'] },
]

/** Reverse lookup: which cluster does a given panel id belong to? */
const PANEL_TO_CLUSTER: Record<PanelId, ClusterId> = (() => {
  const out: Partial<Record<PanelId, ClusterId>> = {}
  for (const c of CLUSTERS) for (const p of c.panels) out[p] = c.id
  return out as Record<PanelId, ClusterId>
})()

const FACTIONS: Faction[] = ['german', 'west_german', 'soviet', 'aef', 'british']

export default function TopBar(p: Props) {
  const veh = getOrInitVehicle(p.project, p.vehicle.id)
  const activeDecal =
    p.activeDecalId != null ? (veh.decals.find(d => d.id === p.activeDecalId) ?? null) : null

  // Faction-picker dropdown state
  const [factionOpen, setFactionOpen] = useState(false)
  const factionRef = useRef<HTMLDivElement>(null)

  /** Per-cluster memory of the last sub-tab the user opened. Lets clicking
   *  a cluster button restore the user's last context within that cluster
   *  instead of always reverting to the first child. */
  const lastPanelByCluster = useRef<Record<ClusterId, PanelId>>({
    paint: 'brush',
    // v1.0: compose now only contains 'reference' since 'parts' (Explode)
    // was removed from the chrome. Falling back to 'reference' keeps the
    // cluster button functional rather than opening to a no-longer-listed
    // panel.
    compose: 'reference',
    publish: 'view',
  })

  // Whenever the active panel changes, remember it as the last-used child
  // of its cluster.
  useEffect(() => {
    if (!p.activePanel) return
    const cluster = PANEL_TO_CLUSTER[p.activePanel]
    lastPanelByCluster.current[cluster] = p.activePanel
  }, [p.activePanel])

  /** Click handler for a cluster button. If any panel in the cluster is
   *  already active, close it. Otherwise, open the last-used child of
   *  that cluster (or the first child on first open). */
  const onClickCluster = (cluster: ClusterId) => {
    const inThisCluster = p.activePanel != null && PANEL_TO_CLUSTER[p.activePanel] === cluster
    if (inThisCluster) {
      p.setActivePanel(null)
      return
    }
    p.setActivePanel(lastPanelByCluster.current[cluster])
  }

  // Close faction dropdown on click-outside / Escape
  useEffect(() => {
    if (!factionOpen) return
    const onClick = (e: MouseEvent) => {
      if (factionRef.current && !factionRef.current.contains(e.target as Node))
        setFactionOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFactionOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [factionOpen])

  const pickFaction = (fac: Faction) => {
    // Locked while editing an existing pack: the pack's faction is fixed at
    // creation time (in NewProjectForm). Switching here would orphan the
    // pack's vehicles. Use Close pack to exit and start a new one instead.
    if (p.factionLocked) return
    setFactionOpen(false)
    if (fac === p.vehicle.faction) return
    const first = VEHICLES.find(v => v.faction === fac)
    if (first) {
      p.setVehicleId(first.id)
      p.setActiveDecalId(null)
      p.setActivePanel(null)
    }
  }

  return (
    // Reads `--app-top-inset` so the DemoBanner can push the chrome down
    // out of its own footprint. The variable is set in App.tsx via the
    // DemoBanner effect (52px when visible, 0 otherwise). Plain Tailwind
    // `top-3` can't read CSS vars, so we override via inline style.
    <div
      className="absolute left-3 z-30 flex flex-col items-start gap-2"
      style={{ top: 'calc(0.75rem + var(--app-top-inset, 0px))' }}
    >
      {/* Top row: home button + faction lobby icon + menu buttons */}
      <div
        className="flex items-center gap-2 px-2 py-2 rounded-2xl"
        style={{
          background: 'rgba(20, 22, 28, 0.62)',
          backdropFilter: 'blur(28px) saturate(180%)',
          border: '0.5px solid rgba(255,255,255,0.10)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
        }}
      >
        {/* Home — quick exit back to the StartScreen ("new skin menu") so the
            user can pick a different pack, load a .coh2skin, or start a new
            one. Same effect as Project panel → Close pack, surfaced here so
            it's discoverable from any view. Only rendered when the multi-
            stage flow plumbed `onClosePack` (i.e. not in headless / demo
            modes that bypass the start screen). */}
        {p.onClosePack && (
          <>
            <button
              onClick={p.onClosePack}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--color-text-2)]
                         hover:text-white hover:bg-white/10 active:scale-95 transition-all duration-150"
              title="Back to start — close this pack and return to the new-skin menu"
              aria-label="Back to start screen"
            >
              <Home size={16} strokeWidth={2} aria-hidden />
            </button>
            <div className="w-px h-8 bg-white/10 mx-0.5" />
          </>
        )}

        {/* Faction lobby icon. While the pack is locked the badge is purely
            decorative — no dropdown, no lock overlay, no chevron. Switching
            faction requires closing the pack (Home → start screen, or Project
            panel → Close pack), which the user discovers via either path
            rather than the badge. */}
        <div ref={factionRef} className="relative">
          <button
            onClick={p.factionLocked ? undefined : () => setFactionOpen(o => !o)}
            disabled={p.factionLocked}
            className={`relative w-10 h-10 rounded-full transition-transform duration-200 flex items-center justify-center text-white ${
              p.factionLocked ? 'cursor-default' : 'hover:scale-105 active:scale-95'
            }`}
            style={{
              background: 'transparent',
              border: 'none',
              overflow: 'visible',
            }}
            title={
              p.factionLocked
                ? FACTION_LABELS[p.vehicle.faction]
                : `${FACTION_LABELS[p.vehicle.faction]} — click to switch faction`
            }
          >
            {/* Lobby badge — intentionally oversized so it spills outside the
                40-px button (the user wants the "breaks the UI" feel that the
                in-game army-select screen has). Drop shadow gives it weight
                and separates it from whatever is behind the bar. */}
            <img
              src={FACTION_ICON_SRC[p.vehicle.faction]}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                width: '160%',
                height: '160%',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                objectFit: 'contain',
                userSelect: 'none',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.55))',
              }}
            />
            {/* Chevron only when the picker is interactive. Locked packs
                show a bare badge — no lock-icon clutter, no chevron that
                hints at a dropdown that isn't there. */}
            {!p.factionLocked && (
              <ChevronDown
                size={10}
                strokeWidth={3}
                className={`absolute -bottom-0.5 -right-0.5 text-white bg-black/70 rounded-full p-0.5 transition-transform duration-200 ${factionOpen ? 'rotate-180' : ''}`}
                style={{ width: 14, height: 14, zIndex: 2 }}
              />
            )}
          </button>

          {/* Dropdown: 5 faction circles laid out vertically. Only renders
              while the pack is unlocked (i.e. during the new-project flow);
              once a pack is committed, faction is bound to it and the
              picker disappears. Close pack lives in the Project panel. */}
          {factionOpen && !p.factionLocked && (
            <div
              className="absolute top-full left-0 mt-2 p-2 pl-3 rounded-2xl flex flex-col gap-2 z-40"
              style={{
                background: 'rgba(20, 22, 28, 0.78)',
                backdropFilter: 'blur(28px) saturate(180%)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.55), inset 0 0.5px 0 rgba(255,255,255,0.10)',
                overflow: 'visible',
              }}
            >
              {FACTIONS.map((fac, i) => (
                <button
                  key={fac}
                  onClick={() => pickFaction(fac)}
                  className="relative flex items-center gap-3 pl-1 pr-3 py-1 rounded-full transition-all duration-150 hover:bg-white/10 active:scale-95"
                  style={{
                    animation: `fadeSlideIn 220ms cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 25}ms backwards`,
                    opacity: 1,
                    overflow: 'visible',
                  }}
                  title={FACTION_LABELS[fac]}
                >
                  <div
                    className="relative w-8 h-8 flex items-center justify-center text-white flex-shrink-0"
                    style={{ overflow: 'visible' }}
                  >
                    {/* Bare emblem — no tinted disc. Selected faction gets
                        a slight scale to read as "current" without bringing
                        a colored ring back in. */}
                    <img
                      src={FACTION_ICON_SRC[fac]}
                      alt=""
                      draggable={false}
                      style={{
                        position: 'absolute',
                        width: p.vehicle.faction === fac ? '170%' : '155%',
                        height: p.vehicle.faction === fac ? '170%' : '155%',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        objectFit: 'contain',
                        userSelect: 'none',
                        pointerEvents: 'none',
                        filter: 'drop-shadow(0 1.5px 3px rgba(0,0,0,0.5))',
                        transition: 'width 160ms ease-out, height 160ms ease-out',
                      }}
                    />
                  </div>
                  <span className="flex flex-col items-start relative z-[1]">
                    <span className="text-[11px] font-medium text-white/90 whitespace-nowrap leading-tight">
                      {FACTION_LABELS[fac]}
                    </span>
                  </span>
                </button>
              ))}

              <style>{`
                @keyframes fadeSlideIn {
                  from { opacity: 0; transform: translateY(-4px); }
                  to   { opacity: 1; transform: translateY(0); }
                }
              `}</style>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-white/10 mx-0.5" />

        {/* Cluster buttons — 3 task-grouped pills. Sub-panel selection
            lives inside the dropdown panel as a row of tab pills, so the
            top bar stays compact. */}
        <div className="flex items-center gap-1">
          {CLUSTERS.map(cluster => {
            const active = p.activePanel != null && PANEL_TO_CLUSTER[p.activePanel] === cluster.id
            return (
              <button
                key={cluster.id}
                onClick={() => onClickCluster(cluster.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 ${
                  active
                    ? 'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
                    : 'text-[var(--color-text-2)] hover:bg-white/10 hover:text-white'
                }`}
                title={`${cluster.label} · ${cluster.panels.map(id => PANEL_META[id].label).join(' · ')}`}
              >
                <span className="flex items-center justify-center">{cluster.icon}</span>
                <span>{cluster.label}</span>
              </button>
            )
          })}

          {/* Divider + Live Sync status badge — icon-only with hover
              tooltip, click to toggle enabled/disabled. */}
          <div className="w-px h-5 bg-white/10 mx-0.5" />
          <LiveSyncBadge variant="inline" />
        </div>
      </div>

      {/* Panel content (dropdown below bar) */}
      {p.activePanel && (
        <div
          className="w-[320px] max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl px-4 py-4"
          style={{
            background: 'rgba(20, 22, 28, 0.72)',
            backdropFilter: 'blur(28px) saturate(180%)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.5), inset 0 0.5px 0 rgba(255,255,255,0.08)',
            animation: 'panelSlideIn 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          <div className="flex flex-col gap-4">
            {/* Sub-tab pills — only render when the active cluster has more
                than one child panel. Single-child clusters skip the row to
                avoid a useless mono-tab. */}
            {(() => {
              if (!p.activePanel) return null
              const cluster = CLUSTERS.find(c => c.id === PANEL_TO_CLUSTER[p.activePanel!])
              if (!cluster || cluster.panels.length < 2) return null
              return (
                <div
                  className="flex items-center gap-1 p-1 rounded-xl"
                  style={{ background: 'var(--color-glass-1, rgba(255,255,255,0.04))' }}
                  role="tablist"
                  aria-label={`${cluster.label} sub-panels`}
                >
                  {cluster.panels.map(pid => {
                    const meta = PANEL_META[pid]
                    const isActive = p.activePanel === pid
                    return (
                      <button
                        key={pid}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => p.setActivePanel(pid)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-150 flex-1 justify-center ${
                          isActive
                            ? 'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_1px_4px_rgba(0,0,0,0.20)]'
                            : 'text-[var(--color-text-2)] hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center justify-center">{meta.icon}</span>
                        <span>{meta.label}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })()}

            {p.activePanel === 'view' && <ViewPanel {...p} />}
            {p.activePanel === 'brush' && (
              <BrushPanel
                brushOn={p.brushOn}
                setBrushOn={p.setBrushOn}
                settings={p.brushSettings}
                setSettings={p.setBrushSettings}
                onEyedrop={p.startEyedrop}
                onClear={p.clearBrushPaint}
              />
            )}
            {p.activePanel === 'decals' && <DecalsPanel {...p} activeDecal={activeDecal} />}
            {p.activePanel === 'parts' && <PartsPanel {...p} />}
            {p.activePanel === 'camo' && <CamoPanel {...p} />}
            {p.activePanel === 'scene' && <ScenePanelBody {...p} />}
            {p.activePanel === 'reference' && <ReferencePanel {...p} />}
            {p.activePanel === 'export' && <ExportPanel {...p} />}
          </div>
          <style>{`
            @keyframes panelSlideIn {
              from { opacity: 0; transform: translateY(-6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Helper components
// ============================================================================

function Section({
  label,
  actions,
  children,
}: {
  label: string
  /** Optional trailing slot on the section header — used by panels that
   *  need a section-scoped affordance (e.g. an X / cancel chip) without
   *  inflating the section body. Render-prop style; pass falsy to omit. */
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-[1.5px] text-[var(--color-text-3)] font-medium">
          {label}
        </div>
        {actions ? <div className="flex items-center">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 bg-black/30 rounded-lg p-0.5">
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition
            ${
              value === o.id
                ? 'bg-[var(--color-accent)] text-black'
                : 'text-[var(--color-text-2)] hover:text-white'
            }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Slider({
  label,
  suffix,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  suffix: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label aria-label={label} className="block mb-2">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-[var(--color-text-2)]">{label}</span>
        <span className="text-white tabular-nums">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </label>
  )
}

// ============================================================================
// Panels (preserved from LeftSidebar)
// ============================================================================

function ViewPanel(p: Props) {
  const viewFileInputRef = useRef<HTMLInputElement>(null)
  const onLoadProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const proj = await readProjectFile(file)
      p.setProject(proj)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
    e.target.value = ''
  }

  return (
    <div className="space-y-3">
      <Section label="Pack info">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-[1px] text-[var(--color-text-3)] mb-1">
            Name
          </span>
          <input
            value={p.project.packName}
            onChange={e => p.setProject({ ...p.project, packName: e.target.value })}
            placeholder="Untitled skin pack"
            className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[12px] border border-white/10 text-white placeholder:text-white/20
                       focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
          />
        </label>
        <label className="block mt-2">
          <span className="block text-[10px] uppercase tracking-[1px] text-[var(--color-text-3)] mb-1">
            Description
          </span>
          <textarea
            value={p.project.packDescription ?? ''}
            onChange={e => p.setProject({ ...p.project, packDescription: e.target.value })}
            placeholder="Optional"
            rows={3}
            className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[11px] border border-white/10 text-white placeholder:text-white/20
                       focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40 resize-none"
          />
        </label>
      </Section>

      {/* Project file — save/load the .coh2skin project state. Lives here
          alongside pack metadata rather than in Export because these are
          project-state actions, not mod-build actions. */}
      <Section label="Project file">
        {/* Save / Load are peer actions on the same project file, so they
            share the same visual weight. Previously Save was a filled
            accent button and Load was a secondary chip — the asymmetry
            implied one was primary and the other was secondary, which
            isn't true at the project-state layer. */}
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-lg"
            onClick={() => downloadProject(p.project)}
          >
            Save .coh2skin
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-lg"
            onClick={() => viewFileInputRef.current?.click()}
          >
            Load .coh2skin
          </Button>
          <input
            ref={viewFileInputRef}
            type="file"
            accept=".coh2skin,.json"
            onChange={onLoadProject}
            className="hidden"
          />
        </div>
      </Section>

      {/* Quick link to Export sub-tab — saves the user opening Publish → Export.
          Sits above Pack actions because it's the most common forward step
          ("I'm done editing → take me to export"), whereas Pack actions
          are the destructive/exit branch. */}
      <button
        onClick={() => p.setActivePanel('export')}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg
                   bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30
                   hover:bg-[var(--color-accent)]/20 text-[12px] font-medium text-[var(--color-accent)]
                   transition-all duration-150"
      >
        <FileUp size={14} aria-hidden />
        Export textures
      </button>

      {/* Pack actions — close-pack + disconnect now share a single section
          rather than dangling at the bottom of the panel unattached. Both
          are exit/destructive flows: Close keeps the install authorisation
          and returns to StartScreen; Disconnect drops the FS handle and
          reopens the folder picker. Ordered least → most destructive. */}
      <Section label="Pack actions">
        {p.onClosePack && (
          <button
            onClick={p.onClosePack}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08]
                       hover:bg-white/[0.08] hover:border-white/15 text-[12px] font-medium text-foreground/90 transition-all duration-150"
            title="Close this pack and return to the start screen"
          >
            <LogOut size={14} strokeWidth={2.2} className="text-foreground/70" aria-hidden />
            <span>Close pack</span>
            <span className="ml-auto text-[10px] uppercase tracking-[1px] text-muted-foreground">
              Back to start
            </span>
          </button>
        )}
        <button
          onClick={p.onDisconnect}
          className="w-full mt-1.5 flex items-center gap-2.5 px-3 py-2 rounded-lg
                     text-[12px] font-medium text-[var(--color-text-3)] hover:text-foreground/90
                     hover:bg-white/[0.04] transition-all duration-150"
          title="Disconnect from this CoH2 install and pick a different folder"
        >
          <span>Disconnect</span>
          <span className="ml-auto text-[10px] uppercase tracking-[1px] text-muted-foreground">
            Pick different folder
          </span>
        </button>
      </Section>
    </div>
  )
}

function DecalsPanel(p: Props & { activeDecal: Decal | null }) {
  const veh = getOrInitVehicle(p.project, p.vehicle.id)
  const factionDefault = p.project.factionDefaults[p.vehicle.faction]
  const inheritedDecals = factionDefault?.decals ?? []
  const mainId = effectiveMainDecalId(p.project, p.vehicle.id, p.vehicle.faction)

  // ── Decal templates — one-click insignia stamps. Clicking a template
  // materialises it into project.images (idempotent — same id every time)
  // and arms image-place mode so the user just clicks the tank to drop.
  const pickTemplate = (t: DecalTemplate) => {
    if (!p.project.images[t.id]) {
      const copy = structuredClone(p.project)
      copy.images[t.id] = {
        id: t.id,
        name: t.displayName,
        dataUrl: templateToDataUrl(t.svg),
        width: 256,
        height: 256,
        isDecalStamp: true,
      }
      p.setProject(copy)
    }
    p.setPendingImageId(t.id)
    if (p.placeMode !== 'image') p.setPlaceMode('image')
  }
  const factionTemplates = templatesForFaction(p.vehicle.faction)

  return (
    <div className="space-y-3">
      {/* 0. TEMPLATES — bundled insignia stamps. New users land here with
          a curated grid of faction-appropriate decals and one-click drop
          rather than needing to find or design their own art first.
          Faction-specific stamps surface first; neutral ones (skull,
          generic stars) follow. Clicking a stamp arms image-place mode. */}
      <Section label="Templates">
        <div className="grid grid-cols-5 gap-1.5">
          {factionTemplates.map(t => {
            const armed = p.pendingImageId === t.id && p.placeMode === 'image'
            const dataUrl = templateToDataUrl(t.svg)
            return (
              <button
                key={t.id}
                onClick={() => pickTemplate(t)}
                title={`${t.displayName}${t.faction !== 'any' ? ` · ${t.faction.replace('_', ' ')}` : ''}`}
                className={`relative aspect-square rounded-md flex items-center justify-center
                            transition-colors
                  ${
                    armed
                      ? 'bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/60'
                      : 'bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.09]'
                  }`}
              >
                <img
                  src={dataUrl}
                  alt={t.displayName}
                  draggable={false}
                  style={{
                    width: '78%',
                    height: '78%',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))',
                  }}
                />
              </button>
            )
          })}
        </div>
        <div className="mt-1.5 text-[10px] text-[var(--color-text-3)] leading-tight">
          Click a stamp, then click the tank to drop it. Resize / rotate after placement.
        </div>
      </Section>

      {/* 1. LIBRARY — image stamps available to drop. Always visible so
          the user can manage uploaded / AI-generated artwork even when
          they're not in image-place mode. Selecting an image arms it
          and switches placeMode to 'image' as a convenience. */}
      <Section label="Image library">
        <ImageLibrary
          project={p.project}
          setProject={p.setProject}
          onImageReady={id => {
            p.setPendingImageId(id)
            // Auto-arm image-place mode so a single click on the
            // image is enough to start placing it.
            if (p.placeMode !== 'image') p.setPlaceMode('image')
          }}
          toast={p.toast}
        />
        {p.pendingImageId && p.project.images[p.pendingImageId] && (
          <div className="mt-2 text-[10px] text-[var(--color-text-2)]">
            Armed: <span className="text-white">{p.project.images[p.pendingImageId].name}</span>
            {' — '}click on the tank to drop.
          </div>
        )}
      </Section>

      {/* 2. PLACE — type selector. The grid is purely additive (`+ Shield`,
          `+ Number`, …); the "off" / cancel state was previously sitting
          INSIDE the grid as a "None" pill, which read as a 7th tool
          rather than a mode toggle. It now lives as an `×` clear chip
          beside the section header, only shown while a tool is armed.
          Clicking the same active tool again also disarms it (a common
          paint-app idiom). */}
      <Section
        label="Place decal"
        actions={
          p.placeMode !== 'off' && (
            <button
              onClick={() => p.setPlaceMode('off')}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
                       text-[10px] uppercase tracking-[1px] text-[var(--color-text-3)]
                       hover:text-foreground/90 hover:bg-white/[0.06] transition-colors"
              title="Cancel placement (Esc)"
            >
              <span aria-hidden>×</span>
              <span>Cancel</span>
            </button>
          )
        }
      >
        <div className="grid grid-cols-3 gap-1.5">
          {(['shield', 'number', 'name', 'kills', 'cross', 'image'] as const).map(t => (
            <button
              key={t}
              onClick={() => p.setPlaceMode(p.placeMode === t ? 'off' : t)}
              className={`px-2 py-2 rounded-lg text-[11px] font-medium transition
                ${
                  p.placeMode === t
                    ? 'bg-[var(--color-accent)] text-black'
                    : 'bg-white/5 text-[var(--color-text-2)] hover:text-white'
                }`}
            >{`+ ${cap(t)}`}</button>
          ))}
        </div>
        {p.placeMode !== 'off' && (
          <div className="mt-2 text-[10px] text-[var(--color-text-2)] leading-relaxed">
            Click on the tank to drop a {p.placeMode}. Esc or click {cap(p.placeMode)} again to
            cancel.
          </div>
        )}
      </Section>

      {/* 3. PLACED — list of decals on this vehicle, with main-decal star
          + remove button. The "main" decal is the one surfaced in tile
          icons and as the badge in the 3D hover-preview. */}
      <Section label={`On this vehicle (${veh.decals.length})`}>
        <div className="max-h-40 overflow-y-auto space-y-1 text-[10px]">
          {veh.decals.length === 0 ? (
            <div className="text-[var(--color-text-3)] py-2 text-center">no decals placed</div>
          ) : (
            veh.decals.map(d => (
              <DecalRow
                key={d.id}
                d={d}
                active={d.id === p.activeDecalId}
                isMain={d.id === mainId}
                onSelect={() => p.setActiveDecalId(d.id)}
                onToggleMain={() => p.setMainDecalId(d.id)}
                onRemove={() => p.removeDecal(d.id)}
              />
            ))
          )}
        </div>
      </Section>

      {/* 4. INHERITED — decals coming from the faction default. Shown
          read-only with a lock indicator so the user understands why
          they can't be edited from here. To change them, use the
          GenerateModal's "All <faction>" scope. */}
      {inheritedDecals.length > 0 && (
        <Section label={`Inherited from ${p.vehicle.faction} default (${inheritedDecals.length})`}>
          <div className="space-y-1 text-[10px]">
            {inheritedDecals.map(d => (
              <div
                key={d.id}
                className="px-2 py-1.5 rounded flex items-center justify-between bg-white/[0.02] text-[var(--color-text-3)]"
                title="Edit via Generate Modal → All faction scope"
              >
                <span className="flex items-center gap-1.5">
                  <Lock size={10} className="opacity-50" />
                  <span>
                    {DECAL_LABELS[d.type] ?? cap(d.type)} ({d.x},{d.y}){d.rot ? ` ${d.rot}°` : ''}{' '}
                    {d.size}px
                  </span>
                </span>
                {d.id === (factionDefault?.mainDecalId ?? null) && (
                  <Star size={10} className="text-yellow-500 fill-yellow-500/80" />
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {p.activeDecal && <ActiveDecalControls p={p} d={p.activeDecal} />}

      <button
        onClick={p.clearDecals}
        className="w-full py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-[var(--color-text-3)] text-[11px] hover:bg-white/10 hover:text-[var(--color-text-2)] transition-colors"
      >
        Clear all decals on this vehicle
      </button>
    </div>
  )
}

/** One row in the "On this vehicle" list. Renders the star toggle,
 *  type label, position summary, and a remove button. The whole row
 *  is clickable to select the decal for further editing. */
function DecalRow({
  d,
  active,
  isMain,
  onSelect,
  onToggleMain,
  onRemove,
}: {
  d: Decal
  active: boolean
  isMain: boolean
  onSelect: () => void
  onToggleMain: () => void
  onRemove: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`px-2 py-1.5 rounded cursor-pointer flex items-center gap-1.5
        ${active ? 'bg-orange-900/30 text-orange-300' : 'hover:bg-white/5'}`}
    >
      {/* Main-decal star toggle — click stops propagation so the row
          itself doesn't reselect when toggling. */}
      <button
        onClick={e => {
          e.stopPropagation()
          onToggleMain()
        }}
        title={isMain ? 'Unset as main decal' : 'Set as main decal (tile-icon + 3D preview badge)'}
        aria-label={isMain ? 'Unset main decal' : 'Set as main decal'}
        aria-pressed={isMain}
        className={`shrink-0 p-0.5 rounded transition-colors ${
          isMain ? 'text-yellow-400' : 'text-white/20 hover:text-yellow-400'
        }`}
      >
        <Star size={12} className={isMain ? 'fill-yellow-400/90' : ''} />
      </button>

      <span className="flex-1 font-mono">
        {DECAL_LABELS[d.type] ?? cap(d.type)} ({d.x},{d.y}){d.rot ? ` ${d.rot}°` : ''} {d.size}px
      </span>

      <button
        onClick={e => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label="Remove decal"
        className="shrink-0 text-white/40 hover:text-white px-1"
      >
        ×
      </button>
    </div>
  )
}

function ActiveDecalControls({ p, d }: { p: Props & { activeDecal: Decal | null }; d: Decal }) {
  return (
    <Section label={`Edit ${cap(d.type)}`}>
      <Slider
        label="Rotation"
        suffix="°"
        value={d.rot}
        min={-180}
        max={180}
        step={5}
        onChange={v => p.updateDecal(d.id, { rot: v })}
      />
      <Slider
        label="Size"
        suffix="px"
        value={d.size}
        min={20}
        max={500}
        step={2}
        onChange={v => p.updateDecal(d.id, { size: v })}
      />
      {d.type === 'kills' && (
        <Slider
          label="Kill rings"
          suffix=""
          value={d.kills ?? 8}
          min={1}
          max={60}
          step={1}
          onChange={v => p.updateDecal(d.id, { kills: v })}
        />
      )}
      {d.type === 'image' && (
        <>
          <Slider
            label="Opacity"
            suffix="%"
            value={Math.round((d.opacity ?? 1) * 100)}
            min={5}
            max={100}
            step={5}
            onChange={v => p.updateDecal(d.id, { opacity: v / 100 })}
          />
          {/* Flip toggles — mirror the image along H or V axis. Useful for
              UV islands that face the wrong way, or creative mirroring.
              Both can be active simultaneously for a 180° content flip. */}
          <div>
            <div className="text-[10px] uppercase tracking-[1.5px] text-[var(--color-text-3)] font-medium mb-1">
              Flip
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => p.updateDecal(d.id, { flipH: !(d.flipH ?? false) })}
                title="Flip horizontally"
                aria-label="Flip decal horizontally"
                aria-pressed={!!d.flipH}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  d.flipH
                    ? 'bg-[var(--color-accent)] text-black'
                    : 'bg-white/5 border border-white/10 text-[var(--color-text-2)] hover:text-white hover:border-white/20'
                }`}
              >
                <FlipHorizontal2 size={13} />
                <span>H</span>
              </button>
              <button
                onClick={() => p.updateDecal(d.id, { flipV: !(d.flipV ?? false) })}
                title="Flip vertically"
                aria-label="Flip decal vertically"
                aria-pressed={!!d.flipV}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  d.flipV
                    ? 'bg-[var(--color-accent)] text-black'
                    : 'bg-white/5 border border-white/10 text-[var(--color-text-2)] hover:text-white hover:border-white/20'
                }`}
              >
                <FlipVertical2 size={13} />
                <span>V</span>
              </button>
            </div>
          </div>
        </>
      )}
      {(d.type === 'number' || d.type === 'name') && (
        <input
          value={d.text ?? ''}
          placeholder={d.type === 'number' ? p.vehicle.defaultTac : 'Vehicle name'}
          onChange={e => p.updateDecal(d.id, { text: e.target.value || null })}
          className="w-full mt-2 bg-black/30 rounded-md px-2.5 py-1.5 text-[11px] border border-white/10 text-white placeholder:text-white/20
                     focus:outline-none focus:border-[var(--color-accent)]"
        />
      )}
    </Section>
  )
}

function ReferencePanel(_p: Props) {
  return (
    <div className="space-y-3">
      {/* Auto-discovery of installed skins from mods/skins/subscriptions is
          not yet implemented. This panel is a placeholder. */}
      <Section label="Reference skin (ghost overlay)">
        <p className="text-[10px] text-[var(--color-text-3)] leading-relaxed">
          Coming soon — reference skins will be auto-discovered from your CoH2{' '}
          <code>mods/skins/subscriptions</code> folder and overlaid as a ghost layer in the
          viewport.
        </p>
      </Section>
    </div>
  )
}

function ExportPanel(p: Props) {
  // Hover state for the 3D card is now owned by `SkinPackInGamePreview`,
  // which renders both the grid and the fixed-position hover card inside
  // its framed "as seen in-game" surface. The panel itself only manages
  // the advanced collapse.
  const [showAdvanced, setShowAdvanced] = useState(false)

  const onSavePng = () => {
    const cv = p.overlayCanvas
    if (!cv) return
    const url = cv.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `${p.vehicle.id}-${p.season}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="space-y-3">
      {/* "As seen in-game" preview — wraps the 6-tile shop grid + 3D
          hover card in a single framed surface. Hovering any tile lands
          the lobby-style preview card with the exact 3D view other
          players will see. */}
      <SkinPackInGamePreview
        project={p.project}
        activeSlotIdx={p.project.activeSlotIdx}
        onSelectSlot={p.switchActiveSlot}
        installRoot={p.installRoot}
      />
      <div className="mt-1 text-[10px] text-[var(--color-text-3)] leading-relaxed">
        Each slot remembers a different version of your pack. Switching slots swaps the editor.
        Exporting uses the first slot.
      </div>

      <Section label="Export skin pack">
        <ExportSkinPackButton p={p} />
      </Section>

      <Section label="Install manually (advanced)">
        <div className="text-[10px] text-[var(--color-text-3)] leading-relaxed mb-1.5">
          If "Install to game" doesn't work, drop the mod file in this folder:
        </div>
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

      {/* Advanced — debug/utility actions that aren't part of the main
          publish flow. Collapsed by default to keep the panel focused. */}
      <div>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="text-[10px] text-[var(--color-text-3)] hover:text-white flex items-center gap-1"
        >
          <ChevronDown
            size={10}
            className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
          />
          Advanced
        </button>
        {showAdvanced && (
          <div className="mt-2">
            <Section label="Vehicle texture (PNG)">
              <Button
                size="sm"
                variant="secondary"
                className="w-full rounded-lg"
                onClick={onSavePng}
              >
                Download {p.vehicle.id}_{p.season}.png
              </Button>
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

/** Convert a raw mesh ID like `tiger_body_lod0` to a human label like `Tiger Body`. */
function humanizeMeshName(name: string): string {
  return name
    .replace(/_lod\d+$/i, '') // strip _lod0, _lod1, etc.
    .replace(/_/g, ' ') // underscores → spaces
    .replace(/\b\w/g, c => c.toUpperCase()) // Title Case
}

function PartsPanel(p: Props) {
  const hasParts = p.parts.length > 0
  return (
    <div className="space-y-3">
      <Section label="Explode view">
        <div className="flex gap-1.5 mb-3">
          <button
            onClick={() => {
              p.setExplodeAll(!p.explodeAll)
              if (!p.explodeAll) p.setSelectedPart(null)
            }}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition
              ${
                p.explodeAll
                  ? 'bg-[var(--color-accent)] text-black'
                  : 'bg-white/5 text-[var(--color-text-2)] hover:text-white'
              }`}
          >
            Explode all
          </button>
          {p.selectedPart && (
            <button
              onClick={() => p.setSelectedPart(null)}
              className="px-2 py-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-[var(--color-text-2)] hover:text-white hover:border-white/20 transition-colors"
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
                title={name}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] transition
                  ${
                    p.selectedPart === name
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                      : 'hover:bg-white/5 text-[var(--color-text-2)] hover:text-white'
                  }`}
              >
                {name ? humanizeMeshName(name) : '(unnamed)'}
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
        <div className="text-[10px] text-[var(--color-text-2)] leading-relaxed">
          <span className="text-blue-300">{p.selectedPart}</span> selected. Paint strokes will land
          on this part's UV region.
        </div>
      )}
    </div>
  )
}

/** Derive the faction key from the vehicle spec's faction field.
 *
 *  VehicleSpec.faction is typed as the full `Faction` union which includes
 *  'west_german'. The diffusion prompt builder uses lowercase short keys
 *  ('german', 'soviet', 'aef', 'british', 'okw'). We normalise here so
 *  the caller doesn't have to think about it. */
function normaliseFaction(faction: string): string {
  if (faction === 'west_german') return 'okw'
  return faction.toLowerCase()
}

function CamoPanel(p: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)

  // ── Diffusion engine state ──────────────────────────────────────────────
  // We store three groups of state for the AI Generate (local) section:
  //
  //   1. `diffStatus` — the DiffusionStatus snapshot most recently read from
  //      the main process. Null on first render (before the first async fetch
  //      completes). Updated on mount and after each generate cycle.
  //
  //   2. `lastGenResult` — metadata from the most recent successful generate:
  //      model filename, resolved seed, and wall-clock duration. Shown in a
  //      small info line below the button so the user can reproduce a result.
  //
  //   3. LoRA selection — `loras` lists the available adapters (stem names
  //      without .safetensors), `selectedLora` is null/empty for "none", and
  //      `loraWeight` is the strength slider value (0.0..1.5, default 0.85).
  //      Populated on mount alongside the status fetch.
  //
  const [diffStatus, setDiffStatus] = useState<DiffusionStatus | null>(null)
  const [lastGenResult, setLastGenResult] = useState<{
    model: string
    seed: number
    durationMs: number
  } | null>(null)
  const [diffGenerating, setDiffGenerating] = useState(false)

  // LoRA adapter state
  const [loras, setLoras] = useState<string[]>([])
  const [selectedLora, setSelectedLora] = useState<string | null>(null)
  const [loraWeight, setLoraWeight] = useState(0.85)

  // "Valid CoH2 atlas" mode — when on, generation uses the per-vehicle body
  // mask and the vanilla atlas as the img2img init, so equipment regions
  // (tracks, wheels, tools) keep their vanilla colours and the UV layout
  // round-trips cleanly into the SGA. Defaults on when a LoRA is selected
  // (the LoRA is what makes this mode produce usable results); the user can
  // override per-generation if they want pure flat-patch output for tiling
  // or as a starting point for hand-painting.
  const [validAtlasMode, setValidAtlasMode] = useState(true)

  // ── "Adjust this camo" state ──────────────────────────────────────────────
  // `generatedImage` holds the most recently generated camo so subsequent
  // adjustments can compound (each adjust round-trips through img2img with
  // the previous result as the init image).
  const [generatedImage, setGeneratedImage] = useState<HTMLImageElement | null>(null)
  const [adjustPrompt, setAdjustPrompt] = useState('')
  const [adjustGenerating, setAdjustGenerating] = useState(false)
  const [useHaikuRewrite, setUseHaikuRewrite] = useState(false)
  const [lastAdjustResult, setLastAdjustResult] = useState<{
    model: string
    seed: number
    durationMs: number
  } | null>(null)

  // ── Apply scope ───────────────────────────────────────────────────────────
  // Shared by the "Apply to skin", AI generate, paste, and upload paths.
  const [applyScope, setApplyScope] = useState<'vehicle' | 'faction' | 'all'>('vehicle')

  // ── Confirm guard for destructive "all" scope applies ─────────────────────
  const confirmAllScope = (): boolean => {
    if (applyScope !== 'all') return true
    return window.confirm(
      'Apply this camo to every vehicle across all 5 factions? Per-vehicle overrides will be cleared.',
    )
  }

  // ── Paste / drop zone ────────────────────────────────────────────────────
  // `dropzoneFocused` guards the global paste listener so it only fires when
  // the user has clicked / focused the dropzone, avoiding conflicts with the
  // document-level drag-and-drop handler in Editor.tsx.
  const dropzoneRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [dropzoneFocused, setDropzoneFocused] = useState(false)
  const [dropActive, setDropActive] = useState(false)

  // Fetch diffusion status and available LoRAs once on mount. The two calls
  // are independent so we fire them concurrently with Promise.all. If we're
  // not in an Electron context (plain web build), synthesise an `unavailable`
  // status so the UI settles rather than staying in the null/loading state.
  useEffect(() => {
    void (async () => {
      if (!window.electronAPI) {
        setDiffStatus({
          state: 'unavailable',
          message: 'Electron context not detected',
          binaryPath: null,
          availableModels: [],
          activeModel: null,
          port: null,
        })
        return
      }
      const [status, availableLoras] = await Promise.all([
        window.electronAPI.diffusion.getStatus().catch(
          (e): DiffusionStatus => ({
            state: 'error',
            message: String(e),
            binaryPath: null,
            availableModels: [],
            activeModel: null,
            port: null,
          }),
        ),
        window.electronAPI.diffusion.listLoras().catch(() => [] as string[]),
      ])
      setDiffStatus(status)
      setLoras(availableLoras)
      // Default-select the first LoRA (likely coh2-camo-v1) when at least one
      // adapter is present and the user hasn't picked one yet.
      if (availableLoras.length > 0) {
        setSelectedLora(prev => prev ?? availableLoras[0])
      }
    })()
  }, [])

  // ── Paste listener ────────────────────────────────────────────────────────
  // Only fires when `dropzoneFocused` is true (i.e. the user has clicked /
  // focused the dropzone). This guards against stealing clipboard content
  // from other edit fields in the UI.
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!dropzoneFocused) return
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const blob = items[i].getAsFile()
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => {
            URL.revokeObjectURL(url)
            if (confirmAllScope()) p.onApplyCamoImage(img, applyScope)
          }
          img.src = url
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('paste', handlePaste)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- confirmAllScope is a plain function recreated each render; p is the props object; adding either would re-register the listener on every render without any behavioural change (handlePaste closes over their current values via the effect re-run on its existing deps)
  }, [dropzoneFocused, applyScope, p.onApplyCamoImage])

  /** Decode a File/Blob and call onApplyCamoImage with the current scope. */
  const applyBlobAsCamo = (blob: Blob) => {
    if (!confirmAllScope()) return
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      p.onApplyCamoImage(img, applyScope)
    }
    img.src = url
  }

  const runPreview = (prompt: string) => {
    const preset = parsePrompt(prompt)
    const c = previewRef.current ?? document.createElement('canvas')
    c.width = c.height = 256
    previewRef.current = c
    generateCamo(c, preset)
    setPreview(c.toDataURL())
    return preset
  }

  // ── Diffusion generate handler ──────────────────────────────────────────
  const handleDiffusionGenerate = async () => {
    if (!window.electronAPI) return
    setDiffGenerating(true)

    // Re-read status before the call so the pill shows 'starting' if the
    // child needs to spin up (the call itself will block until it's ready).
    try {
      setDiffStatus(await window.electronAPI.diffusion.getStatus())
    } catch {
      /* non-fatal — we'll re-read after */
    }

    try {
      // Branch on `validAtlasMode`. The "valid atlas" path needs both a vanilla
      // diffuse and a getter to retrieve it — when either is missing (e.g. a
      // model is still loading) we transparently fall back to the flat-patch
      // path so the button always does *something* useful.
      const vanillaCanvas = p.getVanillaAtlas?.() ?? null
      const useValidAtlas = validAtlasMode && !!vanillaCanvas

      let result: { image: HTMLImageElement; model: string; seed: number; durationMs: number }

      if (useValidAtlas) {
        // Convert canvas → HTMLImageElement so the helper can rasterise it
        // back into a 1024² PNG and feed it through the IPC bridge.
        const dataUrl = vanillaCanvas!.toDataURL('image/png')
        const vanillaImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () =>
            reject(new Error('Failed to decode vanilla atlas for valid-atlas mode'))
          img.src = dataUrl
        })

        const r = await generateValidCoh2Texture({
          vanillaAtlas: vanillaImg,
          faction: normaliseFaction(p.vehicle.faction),
          vehicleId: p.vehicle.id,
          vehicleName: p.vehicle.displayName ?? p.vehicle.id ?? 'unknown',
          prompt: p.camoPrompt,
          season: p.season,
          loras: selectedLora ? [{ name: selectedLora, weight: loraWeight }] : undefined,
        })
        result = { image: r.image, model: r.model, seed: r.seed, durationMs: r.durationMs }

        if (!r.maskApplied) {
          p.toast(
            `No body mask bundled for ${p.vehicle.id} — equipment regions may be over-painted.`,
            'info',
          )
        }
      } else {
        result = await generateCamoWithDiffusion({
          faction: normaliseFaction(p.vehicle.faction),
          season: p.season,
          vehicleName: p.vehicle.displayName ?? p.vehicle.id ?? 'unknown',
          prompt: p.camoPrompt,
          // Pass the selected LoRA adapter if the user has chosen one. An empty
          // string means "None (base model)" — we treat that as no adapter.
          loras: selectedLora ? [{ name: selectedLora, weight: loraWeight }] : undefined,
        })
      }

      // Paint result onto the canvas and persist to project state.
      if (confirmAllScope()) p.onApplyCamoImage(result.image, applyScope)
      setLastGenResult({ model: result.model, seed: result.seed, durationMs: result.durationMs })
      // Store the generated image so the Adjust section can use it as the init
      // image for subsequent img2img refinements.
      setGeneratedImage(result.image)
    } catch (e) {
      p.toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setDiffGenerating(false)
      // Refresh status after the call so the pill reflects the final state.
      if (window.electronAPI) {
        try {
          setDiffStatus(await window.electronAPI.diffusion.getStatus())
        } catch {
          /* tolerate — UI still works */
        }
      }
    }
  }

  // ── Adjust (img2img) handler ──────────────────────────────────────────────
  const handleAdjust = async () => {
    if (!generatedImage || !adjustPrompt.trim()) return
    setAdjustGenerating(true)
    try {
      // Optionally rewrite the casual user phrase into a proper SDXL fragment
      const prompt = useHaikuRewrite ? await rewriteAdjustment(adjustPrompt) : adjustPrompt

      const result = await adjustCamoDiffusion({
        baseImage: generatedImage,
        adjustmentPrompt: prompt,
        faction: normaliseFaction(p.vehicle.faction),
        vehicleId: p.vehicle.displayName ?? p.vehicle.id ?? 'unknown',
        loras: selectedLora ? [{ name: selectedLora, weight: loraWeight }] : undefined,
        strength: 0.4,
      })

      // Apply and replace the current generated image so chained adjustments
      // each build on the previous result.
      if (confirmAllScope()) p.onApplyCamoImage(result.image, applyScope)
      setGeneratedImage(result.image)
      setLastAdjustResult({ model: result.model, seed: result.seed, durationMs: result.durationMs })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      p.toast(msg, 'error')
    } finally {
      setAdjustGenerating(false)
    }
  }

  // ── Status pill rendering ───────────────────────────────────────────────
  // Map DiffusionState → { bg, text, label, showSpinner }
  function renderStatusPill(status: DiffusionStatus | null) {
    if (!status) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] bg-white/5 text-[var(--color-text-3)]">
          <span className="inline-block w-3 h-3 rounded-full border border-t-transparent border-white/20 animate-spin" />
          Checking…
        </span>
      )
    }

    const state = diffGenerating ? 'generating' : status.state

    const styles: Record<string, { bg: string; text: string; label: string; spin?: true }> = {
      unavailable: { bg: 'bg-red-950/60', text: 'text-red-400', label: 'Engine not installed' },
      'no-model': {
        bg: 'bg-amber-950/60',
        text: 'text-amber-400',
        label: 'No model in diffusion/models/',
      },
      idle: { bg: 'bg-white/5', text: 'text-[var(--color-text-3)]', label: 'Ready (cold)' },
      starting: {
        bg: 'bg-blue-950/60',
        text: 'text-blue-400',
        label: 'Starting model…',
        spin: true,
      },
      ready: { bg: 'bg-green-950/60', text: 'text-green-400', label: 'Ready' },
      generating: { bg: 'bg-blue-950/60', text: 'text-blue-400', label: 'Generating…', spin: true },
      error: { bg: 'bg-red-950/60', text: 'text-red-400', label: status.message ?? 'Error' },
    }
    const s = styles[state] ?? styles['idle']

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] ${s.bg} ${s.text}`}
      >
        {s.spin && (
          <span
            className={`inline-block w-3 h-3 rounded-full border border-t-transparent ${s.text} border-current animate-spin flex-shrink-0`}
          />
        )}
        {s.label}
      </span>
    )
  }

  // The generate button is disabled when:
  //   - diffStatus is null (still loading)
  //   - the sidecar state is 'unavailable' or 'no-model' (can't run)
  //   - a generate is already in flight
  const diffusionUnavailable =
    !diffStatus || diffStatus.state === 'unavailable' || diffStatus.state === 'no-model'
  const diffButtonDisabled = diffGenerating || diffusionUnavailable

  return (
    <div className="space-y-3">
      {/* ── Apply scope toggle ────────────────────────────────────────────────
          Three stacked options instead of three tiny pills — the "all
          vehicles" option is the single highest-leverage thing in the
          editor for new users, and a 1-of-3 pill at 60-px wide buries it.
          Each option carries a short subtitle so a first-time user
          understands the consequence before clicking.
      ──────────────────────────────────────────────────────────────────────── */}
      <Section label="Apply this camo to">
        <div className="space-y-1">
          {(
            [
              ['vehicle', 'This vehicle only', "Just the one you're viewing."],
              [
                'faction',
                `Every ${p.vehicle.faction.replace('_', ' ')} vehicle`,
                'Every vehicle in this faction inherits it.',
              ],
              ['all', 'All 80 vehicles', 'Fastest — one camo across every faction.'],
            ] as const
          ).map(([id, label, hint]) => {
            const active = applyScope === id
            return (
              <button
                key={id}
                onClick={() => setApplyScope(id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors
                  ${
                    active
                      ? 'bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/55'
                      : 'bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06]'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[12px] font-medium ${active ? 'text-[var(--color-accent)]' : 'text-foreground/90'}`}
                  >
                    {label}
                  </span>
                  {id === 'all' && (
                    <span className="text-[8.5px] uppercase tracking-[1.5px] text-[var(--color-text-3)]">
                      bulk
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--color-text-3)] leading-tight mt-0.5">
                  {hint}
                </div>
              </button>
            )
          })}
        </div>
        {applyScope === 'all' && (
          <div className="mt-1.5 bg-amber-500/10 border border-amber-500/30 rounded-md p-2 flex items-start gap-1.5">
            <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-400 leading-relaxed">
              Per-vehicle overrides will be cleared. You can still tweak individual tanks
              afterwards.
            </p>
          </div>
        )}
      </Section>

      <Section label="Describe your camo">
        <input
          value={p.camoPrompt}
          onChange={e => {
            p.setCamoPrompt(e.target.value)
            if (e.target.value.length > 3) runPreview(e.target.value)
          }}
          placeholder="e.g. german ambush winter"
          className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[12px] border border-white/10 text-white placeholder:text-white/20
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
        />
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={() => {
              const preset = runPreview(p.camoPrompt || 'german summer')
              setPreview(previewRef.current?.toDataURL() ?? null)
              void preset
            }}
            className="flex-1 px-2 py-1.5 rounded-lg text-[11px] bg-white/5 text-[var(--color-text-2)] hover:text-white"
          >
            Preview
          </button>
          <button
            onClick={() => {
              if (!confirmAllScope()) return
              const preset = parsePrompt(p.camoPrompt || 'german summer')
              p.onApplyCamo({ ...preset, seed: Date.now() & 0xfffff }, applyScope)
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
          <img
            src={preview}
            alt=""
            className="w-full rounded-lg border border-white/10"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )}

      {/* ── Paste or upload camo image ────────────────────────────────────
          Drop zone that accepts Ctrl+V clipboard paste, drag-and-drop, and
          click-to-upload. Any recognised image is decoded and fed through
          onApplyCamoImage at the currently selected scope.
      ──────────────────────────────────────────────────────────────────── */}
      <Section label="Paste or upload camo image">
        {/* Hidden file input — triggered by clicking the dropzone */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) applyBlobAsCamo(file)
            // Reset so the same file can be picked again later.
            e.target.value = ''
          }}
        />
        <div
          ref={dropzoneRef}
          tabIndex={0}
          role="button"
          aria-label="Paste, drop, or click to upload a camo image"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          onFocus={() => setDropzoneFocused(true)}
          onBlur={() => setDropzoneFocused(false)}
          onDragOver={e => {
            e.preventDefault()
            setDropActive(true)
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={e => {
            e.preventDefault()
            setDropActive(false)
            const file = e.dataTransfer.files?.[0]
            if (file?.type.startsWith('image/')) applyBlobAsCamo(file)
          }}
          className={`w-full flex items-center justify-center rounded-lg cursor-pointer transition
            border-2 border-dashed text-[11px] text-center px-3 select-none outline-none
            ${
              dropActive
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white'
                : dropzoneFocused
                  ? 'border-white/30 bg-white/5 text-[var(--color-text-2)]'
                  : 'border-white/15 bg-white/3 text-[var(--color-text-3)] hover:border-white/30 hover:text-[var(--color-text-2)]'
            }`}
          style={{ height: '80px' }}
        >
          Paste (Ctrl+V), drop, or click to upload an image
        </div>
      </Section>

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
              className="px-2 py-1.5 rounded-lg text-[10px] bg-white/5 text-[var(--color-text-2)] hover:text-white text-left truncate"
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      {/* ── AI Generate (local) ─────────────────────────────────────────
          Tier-3 local diffusion path. Uses the stable-diffusion.cpp
          sidecar bundled alongside the Electron binary. Falls back
          gracefully when the sidecar is not present or has no model.

          The prompt the user typed in "Describe your camo" above is
          reused verbatim as the free-form direction; faction + season
          context is injected automatically by generateCamoWithDiffusion.
      ────────────────────────────────────────────────────────────────── */}
      <Section label="AI Generate (local)">
        {/* Status pill — engine / sidecar lifecycle state */}
        <div className="mb-2">{renderStatusPill(diffStatus)}</div>

        {/* Style adapter (LoRA) selector. Only rendered when the diffusion
            engine is reachable and we've fetched the loras list. An empty
            loras array means no adapters are installed — we still show the
            select with only the "None" option so the user knows it exists
            and where to drop a .safetensors file. */}
        <div className="mb-2">
          <div className="text-[10px] text-[var(--color-text-2)] mb-0.5">Style adapter</div>
          <select
            value={selectedLora ?? ''}
            onChange={e => setSelectedLora(e.target.value || null)}
            className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[11px] border border-white/10 text-white
                       focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
          >
            <option value="">None (base model)</option>
            {loras.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* Adapter strength slider — only visible when an adapter is chosen.
            Range 0.0..1.5 matches the sd.cpp `<lora:name:weight>` syntax;
            1.0 is full-strength, values above 1.0 amplify style at the
            cost of coherence. 0.85 is a safe starting point for most
            community-trained LoRAs. */}
        {selectedLora && (
          <Slider
            label="Adapter strength"
            suffix=""
            value={loraWeight}
            min={0}
            max={1.5}
            step={0.05}
            onChange={setLoraWeight}
          />
        )}

        {/* Valid-atlas toggle — when on, generation uses the vanilla diffuse
            atlas as the img2img init and applies a per-vehicle body mask so
            equipment (tracks, wheels, tools) keeps its vanilla colours and
            the UV layout round-trips into the SGA. When off, the model
            produces a flat 1024² camo patch that gets tiled across the
            whole atlas — fine for hand-painting starting points, not for
            direct export to a working skin. */}
        <label className="flex items-center gap-2 mt-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={validAtlasMode}
            onChange={e => setValidAtlasMode(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          <span className="text-[10px] text-[var(--color-text-2)] leading-tight">
            Valid CoH2 atlas mode{' '}
            <span className="text-[var(--color-text-3)]">(preserve equipment + UV)</span>
          </span>
        </label>

        {/* Generate button — full-width, same accent style as Apply to skin */}
        <button
          onClick={() => {
            void handleDiffusionGenerate()
          }}
          disabled={diffButtonDisabled}
          className={`w-full px-2 py-1.5 rounded-lg text-[11px] font-medium transition
            ${
              diffButtonDisabled
                ? 'bg-white/5 text-[var(--color-text-3)] cursor-not-allowed'
                : 'bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-strong)]'
            }`}
        >
          {diffGenerating ? 'Generating…' : 'Generate'}
        </button>

        {/* Last generate metadata line — model · seed · duration */}
        {lastGenResult && (
          <p className="mt-1.5 text-[9px] text-[var(--color-text-3)] leading-relaxed">
            Last: {lastGenResult.model} &middot; seed {lastGenResult.seed} &middot;{' '}
            {lastGenResult.durationMs}ms
          </p>
        )}
      </Section>

      {/* ── Adjust this camo ────────────────────────────────────────────────
          Only shown when a camo has been generated in this session. Each
          adjustment round-trips through img2img so results compound —
          "darker" then "add stripes" refines incrementally rather than
          starting from scratch.
      ───────────────────────────────────────────────────────────────────── */}
      {generatedImage && (
        <Section label="Adjust this camo">
          {/* Text + mic row */}
          <div className="flex gap-1.5 mb-2">
            <input
              value={adjustPrompt}
              onChange={e => setAdjustPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !adjustGenerating) void handleAdjust()
              }}
              placeholder='e.g. "darker, more snow"'
              disabled={adjustGenerating}
              className="flex-1 bg-black/30 rounded-md px-2.5 py-1.5 text-[12px] border border-white/10 text-white placeholder:text-white/20
                         focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40
                         disabled:opacity-50"
            />
            <VoiceInput
              onTranscript={text => setAdjustPrompt(prev => (prev ? `${prev}, ${text}` : text))}
              onError={msg => p.toast(msg, 'error')}
              disabled={adjustGenerating}
            />
          </div>

          {/* Optional Haiku rewrite toggle */}
          <label className="flex items-center gap-1.5 mb-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useHaikuRewrite}
              onChange={e => setUseHaikuRewrite(e.target.checked)}
              className="w-3 h-3 accent-[var(--color-accent)]"
            />
            <span className="text-[10px] text-[var(--color-text-2)]">
              Rewrite with Haiku (better prompts, ~$0.0005/call)
            </span>
          </label>

          {/* Apply button */}
          <button
            onClick={() => {
              void handleAdjust()
            }}
            disabled={adjustGenerating || !adjustPrompt.trim() || diffusionUnavailable}
            className={`w-full px-2 py-1.5 rounded-lg text-[11px] font-medium transition
              ${
                adjustGenerating || !adjustPrompt.trim() || diffusionUnavailable
                  ? 'bg-white/5 text-[var(--color-text-3)] cursor-not-allowed'
                  : 'bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-strong)]'
              }`}
          >
            {adjustGenerating ? 'Adjusting…' : 'Apply'}
          </button>

          {/* Last adjust metadata */}
          {lastAdjustResult && (
            <p className="mt-1.5 text-[9px] text-[var(--color-text-3)] leading-relaxed">
              Last: {lastAdjustResult.model} &middot; seed {lastAdjustResult.seed} &middot;{' '}
              {lastAdjustResult.durationMs}ms
            </p>
          )}
        </Section>
      )}
    </div>
  )
}

// Hoisted so these arrays aren't re-created on every ScenePanelBody render.
const SEASON_OPTIONS = [
  { id: 'summer' as const, label: '☀ Summer' },
  { id: 'winter' as const, label: '❄ Winter' },
]
const CREW_OPTIONS = [
  { id: 'off' as const, label: 'Hide' },
  { id: 'on' as const, label: 'Show' },
]

function ScenePanelBody(p: Props) {
  // Environment (skybox + terrain) controls removed — the CoH2 map loader
  // that drove them is being gutted from Viewport.tsx. SKYBOX_ENVS and the
  // envArchive/envName props are deferred until scene-loading lands again.

  return (
    <div className="space-y-3">
      <Section label="Season">
        <Toggle value={p.season} onChange={p.setSeason} options={SEASON_OPTIONS} />
      </Section>

      {/* Show crew — adds a faction-appropriate soldier behind the
          vehicle as a "crewman" stand-in.  The toggle is intentionally
          a simple binary; per-vehicle seat layouts (commander at
          cupola, gunner at MG, driver at wheel) would need real seat-
          point data from the game's blueprint files which we don't
          decode yet.  The current placement is a single soldier behind
          the chassis, scaled to match the vehicle's apparent size. */}
      <Section label="Crew">
        <Toggle
          value={p.showCrew ? 'on' : 'off'}
          onChange={v => p.setShowCrew(v === 'on')}
          options={CREW_OPTIONS}
        />
        <p className="text-[9px] text-[var(--color-text-3)] leading-relaxed mt-1.5">
          Adds a faction soldier behind the vehicle (T-pose — animation decoding TBD).
        </p>
      </Section>
    </div>
  )
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1)
}

const DECAL_LABELS: Record<string, string> = {
  shield: 'Shield',
  number: 'Number',
  name: 'Name',
  kills: 'Kill Rings',
  cross: 'Cross',
  image: 'Image',
  star: 'Star',
  text: 'Text',
}

function ExportSkinPackButton({ p }: { p: Props }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [built, setBuilt] = useState<{
    bytes: Uint8Array
    filename: string
    modGuid: string
    numericId: string
    textureCount: number
  } | null>(null)
  const [keyPoolAvailable, setKeyPoolAvailable] = useState<boolean | null>(null)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)

  useState(() => {
    hasKeyPool().then(setKeyPoolAvailable)
  })

  const editedCount = Object.values(p.project.vehicles).filter(
    v => (v.decals?.length ?? 0) > 0,
  ).length

  const build = async () => {
    if (busy) return
    setBusy(true)
    setProgress({ phase: 'init', message: 'Starting…' })
    setBuilt(null)
    try {
      const useKeys = await hasKeyPool()
      // In-game slot number (1..6) derived from the active export slot's
      // per-season position. slots 0-2 (summer) and 3-5 (winter) both
      // carry slotIdx 0-2 → game slot 1-3. Default to slot 3 if anything
      // is missing so we never throw on legacy projects.
      const activeSlot = p.project.exportSlots[p.project.activeSlotIdx]
      const targetSlot = activeSlot ? activeSlot.slotIdx + 1 : 3
      const result = useKeys
        ? await patchExport(p.installRoot, p.project, ev => setProgress(ev))
        : await exportSkinPack(p.installRoot, p.project, ev => setProgress(ev), targetSlot)
      setBuilt(result)
      p.toast(
        `Built ${result.textureCount} vehicle${result.textureCount === 1 ? '' : 's'} — install or download below`,
        'success',
      )
      setProgress(null)
    } catch (err) {
      p.toast(err instanceof Error ? err.message : 'Export failed', 'error')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  const downloadBuilt = () => {
    if (!built) return
    const blob = new Blob([built.bytes as BlobPart], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = built.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
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
      await installSkinPack(mods, built.numericId, built.bytes)
      p.toast('Installed! Restart CoH2 to see your skin.', 'success')
    } catch (err) {
      // Surface only generic, user-meaningful failure modes. The most likely
      // real causes are: permission denied on the mods folder, or the user
      // cancelled the picker. Keep the message plain.
      const generic =
        'Couldn\u2019t install — your mods folder may be read-only. Try the manual install instructions in Advanced.'
      const reason =
        err instanceof Error && /denied|permission/i.test(err.message)
          ? generic
          : 'Couldn\u2019t install — please try again.'
      p.toast(reason, 'error')
    }
  }

  return (
    <div>
      <Button
        size="sm"
        disabled={busy || editedCount === 0}
        className="w-full rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-black font-semibold disabled:opacity-50"
        onClick={build}
      >
        {busy
          ? 'Exporting\u2026'
          : built
            ? `Rebuild ${editedCount} vehicle${editedCount === 1 ? '' : 's'}`
            : `Export ${editedCount} vehicle${editedCount === 1 ? '' : 's'}`}
      </Button>

      {progress && (
        <div className="mt-2 text-[10px] text-[var(--color-text-2)] leading-relaxed">
          <div className="font-medium text-white">{progress.message}</div>
          {progress.total ? (
            <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] transition-all"
                style={{ width: `${((progress.current ?? 0) / progress.total) * 100}%` }}
              />
            </div>
          ) : null}
        </div>
      )}

      {built && !busy && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            className="rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-black"
            onClick={installBuilt}
          >
            Install to game
          </Button>
          <Button size="sm" variant="secondary" className="rounded-lg" onClick={downloadBuilt}>
            Download mod file
          </Button>
          <div className="col-span-2 text-[10px] text-[var(--color-text-3)] mt-1 leading-relaxed">
            <span className="text-white">{p.project.packName || 'Untitled pack'}</span>
            {' \u00B7 '}
            {(built.bytes.byteLength / 1024 / 1024).toFixed(1)} MB
          </div>
        </div>
      )}

      {editedCount === 0 && !busy && (
        <p className="mt-2 text-[10px] text-[var(--color-text-3)] leading-relaxed">
          Place at least one decal on a vehicle to enable export.
        </p>
      )}

      {keyPoolAvailable === false && !busy && (
        <p className="mt-2 text-[10px] text-yellow-400/70 leading-relaxed">
          Your mod is ready to use locally. To share it with other players, publish it to the Steam
          Workshop from inside CoH2.
        </p>
      )}

      {/* Publish to Workshop — available once the SGA is built. */}
      {built && !busy && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <Button
            size="sm"
            className="w-full rounded-lg font-semibold"
            style={{
              background: 'linear-gradient(135deg, rgba(31,84,147,0.85), rgba(12,48,100,0.85))',
              color: 'white',
              border: '1px solid rgba(96,165,250,0.25)',
            }}
            onClick={() => setPublishDialogOpen(true)}
          >
            ↑ Publish to Workshop
          </Button>
          <p className="mt-1.5 text-[10px] text-[var(--color-text-3)] leading-relaxed">
            Build the mod first, then publish to share it with the community.
          </p>
        </div>
      )}

      {/* Publish dialog — rendered at the button level so it stays scoped */}
      {publishDialogOpen && built && (
        <PublishToWorkshopDialog
          open={publishDialogOpen}
          onClose={() => setPublishDialogOpen(false)}
          target={makeSkinPublishTarget(
            p.project,
            built.bytes,
            built.filename,
            p.overlayCanvas,
            workshopId => {
              const next = { ...p.project, workshopId }
              p.setProject(next)
              persistActive(next)
            },
          )}
        />
      )}
    </div>
  )
}
