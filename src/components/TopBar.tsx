/**
 * TopBar — floating chrome for the skin editor.
 *
 * Renders three pieces of chrome, none of which is a fixed menu strip:
 *   1. A centered glass title pill (EditorTitlePill) showing the pack name,
 *      Live Sync state, and a rename/publish popover (PackIdentityPopover).
 *   2. A fixed top-left Home button (EditorHomeButton) that closes the pack
 *      and returns to StartScreen — only rendered when `onClosePack` is
 *      plumbed by the parent.
 *   3. A floating panel body (top-left, below the Home button) that renders
 *      the currently-open panel driven by the `activePanel` prop. Panels are
 *      opened by the parent (Editor) via `setActivePanel` — the Edit-texture
 *      pill, file-drop, and the bottom-center controls — not by a strip here.
 *
 * Panel bodies (one PanelId each): Decals · Camo · Parts · Scene · View ·
 * Brush · Export. (The "reference" PanelId is defined but no longer surfaced
 * as a selectable panel — see ReferencePanel.)
 *
 * Replaces the previous 25vw LeftSidebar. Vehicle selection lives in a
 * bottom-center VehicleMenu; the Season toggle lives in the bottom-center
 * control row (SeasonToggle in Editor.tsx), not in this bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LogOut,
  Star,
  Lock,
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
import type { VehicleSpec } from '@/lib/vehicles'
import ImageLibrary from './ImageLibrary'
import SkinPackInGamePreview from './SkinPackInGamePreview'
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
import { makeSkinPublishTarget } from '@/components/PublishToWorkshopDialog'
import type { WorkshopPublishTarget } from '@/components/PublishToWorkshopDialog'
import { PublishSection } from '@/components/PublishSection'
import { PackIdentityPopover } from '@/components/PackIdentityPopover'
import EditorTitlePill from '@/components/editor-primitives/EditorTitlePill'
import { SlotIconGrid } from '@/components/SlotIconGrid'
import { EditorHomeButton } from '@/components/editor-primitives'
import { EDITOR_ACCENT } from '@/components/editor-primitives/tokens'
import { useLiveSync } from '@/lib/live-sync'

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
  /** A6: open the full-screen per-slot icon editor for the given global
   *  export-slot index. Wired by Editor to its `setSlotIconEditingIdx`, so
   *  the summer/winter icon grid inside the title popover can launch the
   *  icon editor. Without this the season icons couldn't be set at all. */
  onEditSlotIcon?: (idx: number) => void
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

export default function TopBar(p: Props) {
  const veh = getOrInitVehicle(p.project, p.vehicle.id)
  const activeDecal =
    p.activeDecalId != null ? (veh.decals.find(d => d.id === p.activeDecalId) ?? null) : null

  // ── Centered title pill state ─────────────────────────────────────────
  const sync = useLiveSync()
  const liveSyncTitle = sync.enabled
    ? `Click to rename — Live Sync: ${sync.reason}`
    : 'Click to rename — Live Sync is off'
  const liveSyncAriaLabel = sync.enabled
    ? `Pack name — click to rename. Live Sync: ${sync.reason}`
    : 'Pack name — click to rename. Live Sync is off'
  const [packNameEditOpen, setPackNameEditOpen] = useState(false)
  const [pillPublishTarget, setPillPublishTarget] = useState<WorkshopPublishTarget | null>(null)
  const [isBuildingTarget, setIsBuildingTarget] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const handlePillRequestBuild = useCallback(async () => {
    setIsBuildingTarget(true)
    try {
      const useKeys = await (await import('@/lib/mod-export')).hasKeyPool()
      const activeSlot = p.project.exportSlots[p.project.activeSlotIdx]
      const targetSlot = activeSlot ? activeSlot.slotIdx + 1 : 3
      const result = useKeys
        ? await (await import('@/lib/mod-export')).patchExport(p.installRoot, p.project, () => undefined)
        : await (await import('@/lib/mod-export')).exportSkinPack(p.installRoot, p.project, () => undefined, targetSlot)
      const target = makeSkinPublishTarget(
        p.project,
        result.bytes,
        result.filename,
        p.overlayCanvas,
        workshopId => {
          const next = { ...p.project, workshopId }
          p.setProject(next)
          persistActive(next)
        },
      )
      setPillPublishTarget(target)
    } catch (e) {
      console.error('Skin publish build failed:', e)
      p.toast(e instanceof Error ? e.message : 'Build failed', 'error')
    } finally {
      setIsBuildingTarget(false)
    }
  }, [p])

  return (
    <>
    {/* ── Centered glass title pill — matches decal & faceplate editors ── */}
    <EditorTitlePill
      packName={p.project.packName}
      fallbackLabel="Unnamed Skin Pack"
      syncState={sync.state}
      liveSyncTitle={liveSyncTitle}
      liveSyncAriaLabel={liveSyncAriaLabel}
      titleAcknowledged={p.project.titleAcknowledged}
      onAcknowledge={() => {
        const next = { ...p.project, titleAcknowledged: true }
        p.setProject(next)
        persistActive(next)
      }}
      onToggle={() => setPackNameEditOpen(v => !v)}
      popoverOpen={packNameEditOpen}
      publishError={publishError}
      liveSyncEnabled={sync.enabled}
      onToggleLiveSync={sync.actions.toggle}
      popoverContent={
        <PackIdentityPopover
          open={packNameEditOpen}
          onClose={() => {
            setPackNameEditOpen(false)
            setPillPublishTarget(null)
          }}
          name={p.project.packName ?? ''}
          description={p.project.packDescription ?? ''}
          author={p.project.author ?? ''}
          onSave={({ name, description, author }) => {
            const next = {
              ...p.project,
              packName: name.trim() || p.project.packName,
              packDescription: description,
              author: author.trim() || p.project.author,
            }
            p.setProject(next)
            persistActive(next)
          }}
          extraSection={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* In-game slot preview — shows how the pack looks in the CoH2
                  lobby (6 tiles = 3 summer + 3 winter). No build/install here;
                  the pack is auto-deployed via Live Sync on every save. */}
              <SkinPackInGamePreview
                project={p.project}
                activeSlotIdx={p.project.activeSlotIdx}
                onSelectSlot={p.switchActiveSlot}
                installRoot={p.installRoot}
              />
              {p.onEditSlotIcon && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    Season icons
                  </div>
                  <SlotIconGrid
                    project={p.project}
                    installRoot={p.installRoot}
                    onSlotClick={idx => {
                      // Close the popover so the full-screen icon editor isn't
                      // hidden behind it, then open the editor for that slot.
                      setPackNameEditOpen(false)
                      p.onEditSlotIcon?.(idx)
                    }}
                  />
                </div>
              )}
            </div>
          }
          publishSection={
            <PublishSection
              target={pillPublishTarget}
              isBuildingTarget={isBuildingTarget}
              onRequestBuild={handlePillRequestBuild}
              onUploadStart={() => setIsUploading(true)}
              onUploadEnd={() => setIsUploading(false)}
              onPublishError={(msg) => {
                setPublishError(msg)
                setTimeout(() => setPublishError(null), 8000)
              }}
              initialVisibility={p.project.workshopVisibility}
              onPublished={(visibility) => {
                const next = { ...p.project, workshopVisibility: visibility }
                p.setProject(next)
                persistActive(next)
              }}
            />
          }
          locked={isUploading || isBuildingTarget}
        />
      }
    />
    {/* Home button — fixed top-left, returns user to StartScreen. Only
        rendered when the multi-stage flow plumbed `onClosePack`. Styled
        identically to the DecalPackEditor / FaceplateEditor home button. */}
    {p.onClosePack && (
      <EditorHomeButton
        onClick={p.onClosePack}
        style={{
          position: 'fixed',
          top: 'calc(20px + var(--app-top-inset, 0px))',
          left: 20,
          zIndex: 30,
        }}
      />
    )}
    {/* Panel content — floats below the home button when a panel is active */}
    <div
      className="absolute left-5 z-30 flex flex-col items-start gap-2"
      style={{ top: 'calc(1.25rem + var(--app-top-inset, 0px))' }}
    >
      {p.activePanel && (
        <div
          className="glass-pop w-[320px] max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl px-4 py-4 mt-12"
          style={{ animation: 'panelSlideIn 200ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        >
          <div className="flex flex-col gap-4">

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
            {/* Q9: the "Reference skin (ghost overlay)" panel is unimplemented
                (auto-discovery of installed skins isn't built yet), so it is
                intentionally not rendered as a selectable panel. The
                'reference' PanelId is retained for prop compatibility with the
                parent; re-add a body here once the feature lands. */}
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
    </>
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
        <div className="text-[10px] uppercase tracking-[1.5px] text-[var(--color-text-3)] font-medium font-mono">
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

/** Collapsible "Advanced ▸" disclosure. Hides engine/model internals behind
 *  a small toggle so the primary flow stays jargon-free (Q3). Controlled by
 *  the caller so the open/closed state can persist across re-renders. */
function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="mt-2 border-t border-white/[0.06] pt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1 text-[10px] uppercase tracking-[1.5px] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors"
      >
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
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
        <span className="text-white tabular-nums font-mono [font-variant-numeric:slashed-zero_tabular-nums]">
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
        className="w-full"
        style={{ accentColor: EDITOR_ACCENT }}
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
            title="Save this project to a file on your computer"
          >
            Save project
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-lg"
            onClick={() => viewFileInputRef.current?.click()}
            title="Open a saved project file from your computer"
          >
            Open project
          </Button>
          <input
            ref={viewFileInputRef}
            type="file"
            accept=".coh2skin,.json"
            onChange={onLoadProject}
            className="hidden"
            aria-label="Load project file"
          />
        </div>
      </Section>

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
          they can't be edited from here. To change them, apply a decal
          with the "Every <faction> vehicle" scope. */}
      {inheritedDecals.length > 0 && (
        <Section label={`Inherited from ${p.vehicle.faction} default (${inheritedDecals.length})`}>
          <div className="space-y-1 text-[10px]">
            {inheritedDecals.map(d => (
              <div
                key={d.id}
                className="px-2 py-1.5 rounded flex items-center justify-between bg-white/[0.02] text-[var(--color-text-3)]"
                title={`${DECAL_LABELS[d.type] ?? cap(d.type)} — inherited from the faction default. To change it, apply a decal with the "Every ${p.vehicle.faction} vehicle" scope.`}
              >
                <span className="flex items-center gap-1.5">
                  <Lock size={10} className="opacity-50" />
                  <span>{DECAL_LABELS[d.type] ?? cap(d.type)}</span>
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

      <span
        className="flex-1"
        title={`Position ${d.x}, ${d.y} · Rotation ${d.rot ?? 0}° · Size ${d.size}`}
      >
        {DECAL_LABELS[d.type] ?? cap(d.type)}
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
                title={name ? humanizeMeshName(name) : '(unnamed)'}
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
          <span className="text-blue-300">{humanizeMeshName(p.selectedPart)}</span> selected. Paint
          strokes will land on this part.
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

  // Q3: engine internals (adapter strength, valid-atlas mode, model/seed
  // metadata) are hidden behind an "Advanced" disclosure by default so the
  // primary flow stays jargon-free. Collapsed on first open.
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // R2: progressive disclosure for the panel as a whole. The BASIC tier
  // (scope · describe/preview/apply · paste-or-upload · quick presets) is
  // always visible; the entire AI generation stack — the local diffusion
  // "Generate with AI" section and the "Adjust this camo" refinement loop —
  // lives inside one outer "Advanced ▸" accordion that is COLLAPSED by
  // default, so first-time users see a clean preset→apply flow and only opt
  // into the heavier AI tooling when they want it. No functionality is
  // removed — everything below is reachable in one click.
  const [aiSectionOpen, setAiSectionOpen] = useState(false)

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
        label: 'No AI model installed',
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
          aria-label="Upload camo image"
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

      {/* ── Advanced ▸ AI generation stack ───────────────────────────────
          R2: the entire AI tooling — local diffusion generation plus the
          img2img "Adjust this camo" refinement loop — is grouped behind one
          outer accordion, collapsed by default. The BASIC tier above
          (scope · describe/preview/apply · paste-or-upload · quick presets)
          is all a first-time user needs to get a camo onto a skin; the AI
          stack is a deliberate opt-in. Nothing is removed — every control
          below is one click away. */}
      <Disclosure
        label="Advanced — AI generation"
        open={aiSectionOpen}
        onToggle={() => setAiSectionOpen(v => !v)}
      >
        {/* ── Generate with AI ────────────────────────────────────────────
          Tier-3 local diffusion path. Uses the stable-diffusion.cpp
          sidecar bundled alongside the Electron binary. Falls back
          gracefully when the sidecar is not present or has no model.

          The prompt the user typed in "Describe your camo" above is
          reused verbatim as the free-form direction; faction + season
          context is injected automatically by generateCamoWithDiffusion.

          Q3: engine internals (adapter strength, valid-atlas/UV mode, and
          the model/seed/duration readout) live under an "Advanced" toggle;
          the primary control is a plain "Style" picker. */}
      <Section label="Generate with AI">
        {/* Status pill — engine lifecycle state */}
        <div className="mb-2">{renderStatusPill(diffStatus)}</div>

        {/* Style picker (backed by the LoRA adapter list). An empty loras
            array means no styles are installed — we still show the select
            with only the "Default" option so the primary control is always
            present. */}
        <div className="mb-2">
          <div className="text-[10px] text-[var(--color-text-2)] mb-0.5">Style</div>
          <select
            value={selectedLora ?? ''}
            onChange={e => setSelectedLora(e.target.value || null)}
            className="w-full bg-black/30 rounded-md px-2.5 py-1.5 text-[11px] border border-white/10 text-white
                       focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
          >
            <option value="">Default</option>
            {loras.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

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

        {/* Advanced — engine/model internals kept out of the primary flow. */}
        <Disclosure
          label="Advanced"
          open={advancedOpen}
          onToggle={() => setAdvancedOpen(v => !v)}
        >
          {/* Style strength slider — only meaningful when a non-default style
              is chosen. Range 0.0..1.5 matches the sd.cpp `<lora:name:weight>`
              syntax; 1.0 is full-strength, values above 1.0 amplify style at
              the cost of coherence. 0.85 is a safe starting point. */}
          {selectedLora && (
            <Slider
              label="Style strength"
              suffix=""
              value={loraWeight}
              min={0}
              max={1.5}
              step={0.05}
              onChange={setLoraWeight}
            />
          )}

          {/* Preserve-equipment toggle — when on, generation keeps the
              vehicle's original tracks/wheels/tools colours and the texture
              layout so it round-trips cleanly into the game. When off, the
              model produces a flat camo patch tiled across the whole texture
              — fine as a hand-painting starting point, not for direct use. */}
          <label className="flex items-center gap-2 mt-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={validAtlasMode}
              onChange={e => setValidAtlasMode(e.target.checked)}
              className=""
              style={{ accentColor: EDITOR_ACCENT }}
            />
            <span className="text-[10px] text-[var(--color-text-2)] leading-tight">
              Preserve equipment &amp; layout
            </span>
          </label>

          {/* Last generate metadata line — model · seed · duration */}
          {lastGenResult && (
            <p className="mt-1.5 text-[9px] text-[var(--color-text-3)] leading-relaxed">
              Last: {lastGenResult.model} &middot; seed {lastGenResult.seed} &middot;{' '}
              {lastGenResult.durationMs}ms
            </p>
          )}
        </Disclosure>
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

          {/* Optional AI prompt-polish toggle. Q3: label uses plain words —
              the underlying model name and per-call cost are engine internals
              kept out of the primary label. */}
          <label
            className="flex items-center gap-1.5 mb-2 cursor-pointer select-none"
            title="Uses AI to rewrite your phrase into a more effective instruction. Small extra cost per adjustment."
          >
            <input
              type="checkbox"
              checked={useHaikuRewrite}
              onChange={e => setUseHaikuRewrite(e.target.checked)}
              className="w-3 h-3"
              style={{ accentColor: EDITOR_ACCENT }}
            />
            <span className="text-[10px] text-[var(--color-text-2)]">
              Improve my wording automatically
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
      </Disclosure>
    </div>
  )
}

// Hoisted so these arrays aren't re-created on every ScenePanelBody render.
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
      {/* Q8: the Season toggle used to live here too, but the canonical
          SeasonToggle already renders in the bottom-center control row
          (Editor.tsx). Removed the duplicate — season is controlled there. */}

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
          Adds a faction soldier behind the vehicle for scale (standing pose).
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
