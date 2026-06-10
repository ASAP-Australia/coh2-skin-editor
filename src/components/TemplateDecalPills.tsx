/**
 * TemplateDecalPills — two clickable "pill" selectors that sit directly above
 * the bottom-center VehicleMenu rail in the vehicle (skin-pack) editor.
 *
 *   • Template pill   — pick the camo base this pack is seeded from. Choosing
 *                       a stock/saved template clones a fresh editable project
 *                       and switches the editor to it (same contract as the
 *                       centre-title PackIdentityPopover → TemplateSelectSection).
 *   • Decal-pack pill — associate one of the user's saved decal packs with this
 *                       skin pack. Decal packs are a SEPARATE CoH2 mod, so this
 *                       is a quick-access association recorded on
 *                       `project.decalPackRef` (it is not merged into the skin).
 *
 * Both pills open a compact glass dropdown ABOVE the pill (the bar lives at the
 * bottom of the viewport, so panels open upward to stay on-screen).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, Package, Sticker } from 'lucide-react'
import type { CSSProperties } from 'react'
import {
  cloneSkinProjectFromTemplate,
  listAllSkinProjects,
  parseStockTemplateId,
  persistActive,
  type Coh2SkinProject,
} from '@/lib/project'
import type { TemplateKind } from './TemplatePicker'
import { listStockSkins } from '@/lib/stock-skins'
import { detectWorkshopPath, listWorkshopItems, nativeFileFromPath } from '@/lib/native-fs'
import { SgaArchive } from '@/lib/sga'
import type { Faction } from '@/lib/vehicles'
import { VEHICLES } from '@/lib/vehicles'
import {
  readStockDiffuseDataUrl,
  readWorkshopDiffuseDataUrlBySgaPath,
} from '@/lib/template-diffuse'

interface Option {
  id: string
  name: string
  hint?: string
  kind?: TemplateKind
}

interface Props {
  project: Coh2SkinProject
  setProject: (p: Coh2SkinProject) => void
  /** Faction of the active vehicle — scopes the stock-template inventory. */
  faction: Faction
  /** Switch the displayed vehicle (used when a template targets one). */
  onVehicleChange: (vehicleId: string) => void
  /** Id of the currently-selected vehicle — used for single-vehicle template apply. */
  currentVehicleId: string
  /** The user's CoH2 install root, required for opening SGAs on a cache miss. */
  installRoot: FileSystemDirectoryHandle
}

export default function TemplateDecalPills({
  project,
  setProject,
  faction,
  onVehicleChange,
  currentVehicleId,
  installRoot,
}: Props) {
  const [openMenu, setOpenMenu] = useState<null | 'template' | 'decal'>(null)
  // 0 = "This vehicle", 1 = "All vehicles"
  const [templateScope, setTemplateScope] = useState<0 | 1>(1)
  const [decalScope, setDecalScope] = useState<0 | 1>(project.decalScope === 'vehicle' ? 0 : 1)
  // true while the async diffuse extraction is in progress for the last apply
  const [diffuseLoading, setDiffuseLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Outside-click + Escape close.
  useEffect(() => {
    if (!openMenu) return
    function onDown(ev: MouseEvent) {
      if (rootRef.current && ev.target instanceof Node && !rootRef.current.contains(ev.target)) {
        setOpenMenu(null)
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  // Template inventory: blank + the user's own saved skin packs (the same
  // packs that appear in their inventory / Saved Projects list) + this
  // faction's stock camos. Recomputed each open so newly-saved packs appear.
  const templateOptions = useMemo<Option[]>(() => {
    if (openMenu !== 'template') return []
    const saved = listAllSkinProjects()
      .filter(p => p.id !== project.id) // don't offer the pack you're editing as its own template
      .map(p => ({
        id: p.id,
        kind: 'saved' as const,
        name: p.name,
        hint: `${p.vehicleCount} vehicle${p.vehicleCount === 1 ? '' : 's'}`,
      }))
    return [
      { id: 'blank', kind: 'blank', name: 'Blank canvas', hint: 'Start with empty slots' },
      ...saved,
      ...listStockSkins()
        .filter(s => s.factionId === faction)
        .map(s => ({ id: `stock:${s.id}`, kind: 'stock' as const, name: s.name, hint: s.sgaName })),
    ]
  }, [openMenu, faction, project.id])

  // Decal-pack options: "None" + every subscribed Steam Workshop item.
  // Loading is async (IPC) so we keep the list in state and fire the
  // fetch whenever the decal menu opens. `null` means "loading in progress".
  const [workshopDecalOptions, setWorkshopDecalOptions] = useState<Option[] | null>(null)

  useEffect(() => {
    if (openMenu !== 'decal') return
    // Reset to loading state each time the menu opens so a fresh fetch runs.
    setWorkshopDecalOptions(null)
    let cancelled = false
    void (async () => {
      try {
        const root = await detectWorkshopPath()
        if (cancelled || !root) {
          if (!cancelled) setWorkshopDecalOptions([])
          return
        }
        const items = await listWorkshopItems(root)
        if (cancelled) return
        // Resolve a human-readable name for each item from the SGA archive
        // name field (128-byte UTF-16-LE in the 172-byte header — essentially
        // free; no TOC enumeration, no payload decompression).
        // Falls back to a prettified basename when the SGA is unreachable or
        // its archiveName is blank, and keeps `Workshop #id` as last resort.
        const options = await Promise.all(
          items.map(async item => {
            let name = ''
            if (item.sgaPath) {
              try {
                const file = await nativeFileFromPath(item.sgaPath)
                if (file) {
                  const archive = await SgaArchive.open(file)
                  name = archive.archiveName.trim()
                }
              } catch {
                // Non-fatal — fall through to basename / id fallback below.
              }
              if (!name && item.sgaPath) {
                // Derive from basename: strip directory + ".sga", replace
                // underscores/hyphens with spaces, title-case.
                const base = item.sgaPath.split(/[\\/]/).pop() ?? ''
                const stripped = base.replace(/\.sga$/i, '')
                if (stripped) {
                  name = stripped
                    .replace(/[_-]+/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase())
                }
              }
            }
            return {
              id: item.id,
              name: name || `Workshop #${item.id}`,
              hint: item.sgaPath ?? undefined,
            }
          }),
        )
        if (cancelled) return
        setWorkshopDecalOptions(options)
      } catch {
        // Non-fatal: fall back to empty list so the "No decal pack" option
        // still renders and the user can clear an existing association.
        if (!cancelled) setWorkshopDecalOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openMenu])

  const decalOptions = useMemo<Option[]>(() => {
    if (openMenu !== 'decal') return []
    return [
      { id: '', name: 'No decal pack' },
      ...(workshopDecalOptions ?? []),
    ]
  }, [openMenu, workshopDecalOptions])

  const templateName = project.template?.name ?? 'Blank canvas'
  const decalName = project.decalPackRef?.name ?? 'No decal pack'

  // ── Async diffuse-bake helpers ──────────────────────────────────────────────

  /**
   * Read the stock diffuse for a vehicle from the SGA and return a dataURL.
   * Wraps readStockDiffuseDataUrl; silently returns null on failure.
   */
  async function fetchStockDiffuse(vehicleFaction: Faction, vehicleId: string): Promise<string | null> {
    try {
      return await readStockDiffuseDataUrl(vehicleFaction, vehicleId, installRoot)
    } catch {
      return null
    }
  }

  /**
   * Read the workshop diffuse for a vehicle by sgaPath. opt.hint carries
   * the sgaPath (set when building templateOptions from WorkshopSkin data).
   * Silently returns null on failure.
   */
  async function fetchWorkshopDiffuse(sgaPath: string | undefined, vehicleFaction: Faction, vehicleId: string): Promise<string | null> {
    if (!sgaPath) return null
    try {
      return await readWorkshopDiffuseDataUrlBySgaPath(sgaPath, vehicleFaction, vehicleId)
    } catch {
      return null
    }
  }

  /**
   * Resolve the faction for a given vehicleId from the VEHICLES catalogue.
   * Falls back to the currently-selected faction.
   */
  function vehicleFaction(vehicleId: string): Faction {
    return VEHICLES.find(v => v.id === vehicleId)?.faction ?? faction
  }

  function applyTemplate(opt: Option) {
    setOpenMenu(null)
    if (opt.id === project.template?.id) return
    const kind = opt.kind ?? 'blank'

    // "This vehicle" scope — copy only the matching vehicle slot from the
    // cloned template into the current project, leaving all other vehicles
    // untouched. Only meaningful for cloneable kinds (saved/stock/workshop).
    if (templateScope === 0 && (kind === 'stock' || kind === 'saved' || kind === 'workshop')) {
      const clone = cloneSkinProjectFromTemplate({ id: opt.id, kind, name: opt.name })
      if (clone) {
        // Determine which vehicle key to copy from the clone: for stock
        // templates it's the vehicle the template was aimed at; for saved/
        // workshop templates use the clone's lastVehicleId (same convention
        // as "all vehicles" path). If neither key exists in the clone, no-op.
        const templateVehicleKey =
          kind === 'stock'
            ? (parseStockTemplateId(opt.id)?.vehicleId ?? null)
            : clone.lastVehicleId
        const sourceVehicle = templateVehicleKey ? clone.vehicles[templateVehicleKey] : null
        if (sourceVehicle) {
          // Deep-clone the source vehicle and re-key it to the currently-
          // selected vehicle so decal ids / coordinates make sense.
          const vehicleCopy = structuredClone(sourceVehicle)
          vehicleCopy.id = currentVehicleId
          const next: Coh2SkinProject = {
            ...project,
            vehicles: {
              ...project.vehicles,
              [currentVehicleId]: vehicleCopy,
            },
            template: { id: opt.id, kind, name: opt.name },
          }
          setProject(next)
          persistActive(next)

          // For stock/workshop: asynchronously bake the template's diffuse into
          // the current vehicle's customDiffuseUrl. The project is already
          // applied (vanilla until bake finishes); on success we patch it in.
          if (kind === 'stock' || kind === 'workshop') {
            const targetFaction = vehicleFaction(currentVehicleId)
            const bakeTarget = currentVehicleId
            const fetchDiffuse = kind === 'stock'
              ? fetchStockDiffuse(targetFaction, bakeTarget)
              : fetchWorkshopDiffuse(opt.hint, targetFaction, bakeTarget)

            // Capture `next` (already set on the project above) so the async
            // callback can patch customDiffuseUrl onto the right snapshot.
            // setProject prop takes a plain value — no functional-update form.
            const projectAtApply = next
            setDiffuseLoading(true)
            void fetchDiffuse.then(dataUrl => {
              setDiffuseLoading(false)
              if (!dataUrl) return
              const existing = projectAtApply.vehicles[bakeTarget] ?? { id: bakeTarget, tac: null, name: null, decals: [] }
              const veh = { ...structuredClone(existing), customDiffuseUrl: dataUrl }
              const updated: Coh2SkinProject = {
                ...projectAtApply,
                vehicles: { ...projectAtApply.vehicles, [bakeTarget]: veh },
              }
              persistActive(updated)
              setProject(updated)
            }).catch(() => setDiffuseLoading(false))
          }
        }
        // If the clone has no matching vehicle key, silently no-op (the
        // template simply doesn't cover this vehicle type).
        return
      }
    }

    // "All vehicles" scope (default) — existing whole-project replace behaviour.
    if (kind === 'stock' || kind === 'saved' || kind === 'workshop') {
      const clone = cloneSkinProjectFromTemplate({ id: opt.id, kind, name: opt.name })
      if (clone) {
        setProject(clone)
        persistActive(clone)
        const targetVehicleId =
          kind === 'stock' ? parseStockTemplateId(opt.id)?.vehicleId : clone.lastVehicleId
        if (targetVehicleId) onVehicleChange(targetVehicleId)

        // For stock/workshop: asynchronously bake the primary vehicle's diffuse.
        // "All vehicles" here means the whole project is replaced, so we bake
        // just the primary/target vehicle now (the natural selection), and leave
        // other vehicles to be lazily populated when the user switches to them.
        if (kind === 'stock' || kind === 'workshop') {
          const primaryVehicleId = targetVehicleId ?? null
          if (primaryVehicleId) {
            const primaryFaction = vehicleFaction(primaryVehicleId)
            const fetchDiffuse = kind === 'stock'
              ? fetchStockDiffuse(primaryFaction, primaryVehicleId)
              : fetchWorkshopDiffuse(opt.hint, primaryFaction, primaryVehicleId)

            // Capture `clone` (the newly-set project snapshot) so the async
            // callback patches the right object — setProject prop is a plain
            // value setter, not a functional-update form.
            const projectAtApply = clone
            setDiffuseLoading(true)
            void fetchDiffuse.then(dataUrl => {
              setDiffuseLoading(false)
              if (!dataUrl) return
              const vehEntry = structuredClone(projectAtApply.vehicles[primaryVehicleId] ?? { id: primaryVehicleId, tac: null, name: null, decals: [] })
              vehEntry.customDiffuseUrl = dataUrl
              const updated: Coh2SkinProject = {
                ...projectAtApply,
                vehicles: { ...projectAtApply.vehicles, [primaryVehicleId]: vehEntry },
              }
              persistActive(updated)
              setProject(updated)
            }).catch(() => setDiffuseLoading(false))
          }
        }

        return
      }
    }
    const next: Coh2SkinProject = {
      ...project,
      template: { id: opt.id, kind, name: opt.name },
    }
    setProject(next)
    persistActive(next)
  }

  function applyDecalPack(opt: Option) {
    setOpenMenu(null)
    const scope: 'vehicle' | 'all' = decalScope === 0 ? 'vehicle' : 'all'
    const next: Coh2SkinProject = {
      ...project,
      decalPackRef: opt.id ? { id: opt.id, name: opt.name } : undefined,
      decalScope: opt.id ? scope : undefined,
      decalScopeVehicleId: opt.id && scope === 'vehicle' ? currentVehicleId : undefined,
    }
    setProject(next)
    persistActive(next)
  }

  return (
    <div ref={rootRef} className="relative flex items-center gap-2 select-none">
      <PillButton
        icon={<Package size={12} aria-hidden />}
        label="Template"
        value={diffuseLoading ? 'Loading texture…' : templateName}
        open={openMenu === 'template'}
        onClick={() => setOpenMenu(m => (m === 'template' ? null : 'template'))}
      />
      <PillButton
        icon={<Sticker size={12} aria-hidden />}
        label="Decal pack"
        value={decalName}
        open={openMenu === 'decal'}
        onClick={() => setOpenMenu(m => (m === 'decal' ? null : 'decal'))}
      />

      {openMenu === 'template' && (
        <Dropdown
          align="left"
          heading="Template"
          options={templateOptions}
          selectedId={project.template?.id ?? 'blank'}
          emptyHint="No stock camos detected for this faction."
          onPick={applyTemplate}
          headerContent={
            <ScopeToggle
              selectedIndex={templateScope}
              onChange={i => setTemplateScope(i as 0 | 1)}
            />
          }
        />
      )}
      {openMenu === 'decal' && (
        <Dropdown
          align="right"
          heading="Decal pack"
          options={decalOptions}
          selectedId={project.decalPackRef?.id ?? ''}
          emptyHint={
            workshopDecalOptions === null
              ? 'Loading workshop items…'
              : 'No workshop decal mods found.'
          }
          onPick={applyDecalPack}
          headerContent={
            <ScopeToggle
              selectedIndex={decalScope}
              onChange={i => setDecalScope(i as 0 | 1)}
            />
          }
        />
      )}
    </div>
  )
}

// ─── Pill button ──────────────────────────────────────────────────────────

function PillButton({
  icon,
  label,
  value,
  open,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  open: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="listbox"
      aria-expanded={open}
      title={`${label}: ${value}`}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-all duration-150"
      style={{
        background: open ? 'rgba(40, 44, 54, 0.85)' : 'rgba(20, 22, 28, 0.72)',
        color: 'rgb(229, 231, 235)',
        backdropFilter: 'blur(36px) saturate(160%)',
        border: '0.5px solid rgba(255,255,255,0.18)',
        boxShadow: '0 8px 22px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
        maxWidth: 220,
      }}
    >
      <span className="text-white/55 shrink-0">{icon}</span>
      <span className="text-white/45 shrink-0">{label}</span>
      <span className="truncate text-white/90">{value}</span>
      <ChevronUp
        size={12}
        className="text-white/40 shrink-0 transition-transform"
        style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)' }}
        aria-hidden
      />
    </button>
  )
}

// ─── Dropdown (opens upward) ────────────────────────────────────────────────

function Dropdown({
  align,
  heading,
  options,
  selectedId,
  emptyHint,
  onPick,
  headerContent,
  footerContent,
}: {
  align: 'left' | 'right'
  heading: string
  options: Option[]
  selectedId: string
  emptyHint: string
  onPick: (opt: Option) => void
  /** Optional content rendered between the heading and the option list. */
  headerContent?: React.ReactNode
  /** Optional content rendered below the option list. */
  footerContent?: React.ReactNode
}) {
  // Suppress the auto-injected blank/none-only case from looking empty.
  const realCount = options.filter(o => o.id !== '' && o.id !== 'blank').length
  return (
    <div role="listbox" aria-label={heading} style={{ ...panelStyle, [align]: 0 }}>
      <div style={sectionHeaderStyle}>{heading}</div>
      {headerContent && <div style={headerContentStyle}>{headerContent}</div>}
      {realCount === 0 && <div style={emptyHintStyle}>{emptyHint}</div>}
      {options.map(opt => {
        const isSelected = opt.id === selectedId
        return (
          <button
            key={opt.id || '__none__'}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => onPick(opt)}
            style={{
              ...optionStyle,
              background: isSelected ? 'rgba(74, 145, 255, 0.18)' : 'transparent',
            }}
            onMouseEnter={e => {
              if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            }}
            onMouseLeave={e => {
              if (!isSelected) e.currentTarget.style.background = 'transparent'
            }}
          >
            <div style={optionNameStyle}>{opt.name}</div>
            {opt.hint && <div style={optionHintStyle}>{opt.hint}</div>}
          </button>
        )
      })}
      {footerContent && <div style={footerContentStyle}>{footerContent}</div>}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  zIndex: 50,
  width: 260,
  maxHeight: 320,
  overflowY: 'auto',
  borderRadius: 12,
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: 'rgba(15, 17, 22, 0.92)',
  backgroundImage: 'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
  backdropFilter: 'blur(40px) saturate(150%)',
  WebkitBackdropFilter: 'blur(40px) saturate(150%)',
  border: '0.5px solid rgba(255, 255, 255, 0.10)',
  boxShadow: 'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 10px 32px rgba(0, 0, 0, 0.55)',
}

const sectionHeaderStyle: CSSProperties = {
  padding: '6px 8px 4px',
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'rgba(247,247,250,0.45)',
}

const optionStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  transition: 'background-color 100ms ease-out',
  fontFamily: 'inherit',
  color: 'inherit',
}

const optionNameStyle: CSSProperties = { fontSize: 12, color: 'rgba(247,247,250,0.92)' }
const optionHintStyle: CSSProperties = {
  marginTop: 1,
  fontSize: 10,
  color: 'rgba(247,247,250,0.5)',
}
const emptyHintStyle: CSSProperties = {
  padding: '4px 8px 6px',
  fontSize: 10,
  color: 'rgba(247,247,250,0.4)',
  fontStyle: 'italic',
}

const headerContentStyle: CSSProperties = {
  padding: '4px 8px 6px',
}

const footerContentStyle: CSSProperties = {
  padding: '4px 8px 6px',
  borderTop: '0.5px solid rgba(255,255,255,0.07)',
  marginTop: 2,
}

// ─── ScopeToggle — "This vehicle" / "All vehicles" inline segmented control ──

function ScopeToggle({
  selectedIndex,
  onChange,
}: {
  selectedIndex: 0 | 1
  onChange: (i: 0 | 1) => void
}) {
  const options = ['This vehicle', 'All vehicles'] as const
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.04)',
        padding: 3,
        border: '1px solid rgba(255,255,255,0.09)',
        boxSizing: 'border-box',
        ['--selected-index' as string]: String(selectedIndex),
      }}
    >
      {/* Sliding highlight pill */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 3,
          bottom: 3,
          width: 'calc((100% - 6px) / 2)',
          left: `calc(3px + ((100% - 6px) / 2) * ${selectedIndex})`,
          borderRadius: 7,
          background: 'rgba(255,255,255,0.11)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.15) inset, 0 0 0 1px rgba(255,255,255,0.07)',
          transition: 'left 300ms cubic-bezier(.32, .72, 0, 1)',
          pointerEvents: 'none',
        }}
      />
      {options.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={e => {
            e.stopPropagation()
            onChange(i as 0 | 1)
          }}
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            padding: '4px 2px',
            borderRadius: 7,
            fontSize: 10,
            fontWeight: selectedIndex === i ? 600 : 500,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: selectedIndex === i ? 'rgba(247,247,250,0.95)' : 'rgba(247,247,250,0.50)',
            transition: 'color 200ms ease',
            whiteSpace: 'nowrap',
            letterSpacing: '-0.01em',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
