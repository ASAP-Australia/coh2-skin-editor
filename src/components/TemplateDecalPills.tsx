/**
 * TemplateDecalPills — two clickable "pill" selectors that sit directly above
 * the bottom-center VehicleMenu rail in the vehicle (skin-pack) editor.
 *
 *   • Template pill   — pick the camo base this pack is seeded from. Choosing
 *                       a stock/saved/workshop template clones a fresh editable
 *                       project and switches the editor to it.
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
import { listInstalledPacks } from '@/lib/native-fs'
import type { Faction } from '@/lib/vehicles'
import { VEHICLES } from '@/lib/vehicles'
import {
  readStockDiffuseDataUrl,
  readWorkshopDiffuseDataUrlBySgaPath,
  readInstalledPackIcon,
} from '@/lib/template-diffuse'
import { listWorkshopSkinsForFaction } from '@/lib/workshop-skins'
import { FACTION_ICON_SRC } from '@/lib/factions'

interface Option {
  id: string
  name: string
  hint?: string
  kind?: TemplateKind
  /** Optional small preview image URL shown left of the name in the row.
   *  When null/absent, a placeholder square is shown. */
  previewUrl?: string | null
  /** When true this entry is a non-interactive group separator/header row. */
  isGroupHeader?: boolean
}

/** Returns true when the pack name is a raw numeric Workshop/file ID — i.e. the
 *  .info name field was never set and fell back to the numeric basename. These are
 *  the user's own live-sync synced-project artifacts, not real downloaded camos. */
function isNumericPackName(name: string): boolean {
  return /^\d+$/.test(name.trim())
}

/**
 * Module-level cache for pack inventory icons, keyed by SGA absolute path.
 * Persists across re-renders and menu open/close cycles so re-opening is instant.
 * Stores `null` when the icon was fetched but absent/failed (avoids repeated IPC).
 */
const _packIconCache = new Map<string, string | null>()

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

  // Pack inventory icon URLs keyed by absolute SGA path.
  // Populated lazily when the menu opens; entries from _packIconCache are
  // re-hydrated synchronously so re-opening the menu is instant.
  const [packIconUrls, setPackIconUrls] = useState<Record<string, string | null>>({})

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

  // Workshop template options: skin-type Workshop items for this faction.
  // Prefetched on mount (and on faction change) so the menu opens instantly.
  // null = first fetch not yet complete (cold-start race case only).
  const [workshopTemplateOptions, setWorkshopTemplateOptions] = useState<Option[] | null>(null)

  useEffect(() => {
    let cancelled = false
    // Run on the idle callback when available so initial mount cost is deferred
    // without blocking the first render; fall back to a microtask otherwise.
    const run = () => {
      void (async () => {
        try {
          const skins = await listWorkshopSkinsForFaction(faction)
          if (cancelled) return
          const options = skins.map(s => ({
            id: `workshop:${s.itemId}`,
            kind: 'workshop' as const,
            name: s.name,
            // sgaPath stored in hint for the async diffuse bake; NOT shown in UI rows (R3).
            hint: s.sgaPath,
            previewUrl: FACTION_ICON_SRC[faction] ?? null,
          }))
          setWorkshopTemplateOptions(options)
        } catch {
          if (!cancelled) setWorkshopTemplateOptions([])
        }
      })()
    }
    let idleId: number | undefined
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(run, { timeout: 2000 })
    } else {
      Promise.resolve().then(run)
    }
    return () => {
      cancelled = true
      if (idleId !== undefined) window.cancelIdleCallback(idleId)
    }
  }, [faction])

  // I3: Installed skin pack options — packs the user has downloaded and
  // installed to their mods folder (type === 'skin'). Faction-filtered by
  // checking whether the pack name contains a faction keyword that disagrees
  // with the active faction; packs with no faction keyword are shown to all.
  // Fetched on mount (and on faction change) so the template menu opens fast.
  const [installedSkinOptions, setInstalledSkinOptions] = useState<Option[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const FACTION_KEYWORDS: Record<string, string[]> = {
      german:      ['german', 'Wehrmacht', 'wehr', 'panzer', 'axis'],
      soviet:      ['soviet', 'russian', 'ussr', 'allies_ru'],
      west_german: ['west_german', 'oberkommando', 'okw'],
      aef:         ['aef', 'american', 'us army', 'usf'],
      british:     ['british', 'brit', 'uk '],
    }
    const factionKeys = FACTION_KEYWORDS[faction] ?? []
    const otherFactionKeys = Object.entries(FACTION_KEYWORDS)
      .filter(([f]) => f !== faction)
      .flatMap(([, keys]) => keys)

    void (async () => {
      try {
        const packs = await listInstalledPacks()
        if (cancelled) return
        const options = packs
          .filter(p => p.type === 'skin')
          // Hide numeric-named artifacts (live-sync synced-project SGAs whose
          // .info name == the numeric file id — these are NOT real camos).
          .filter(p => !isNumericPackName(p.name))
          .filter(p => {
            const nameLower = p.name.toLowerCase()
            // If the pack name contains a DIFFERENT faction's keyword, skip it.
            // If it matches THIS faction's keyword, or has no faction keyword at all, show it.
            const matchesOther = otherFactionKeys.some(k => nameLower.includes(k.toLowerCase()))
            if (matchesOther) {
              // Only exclude if none of this faction's keywords also match (avoid false positives).
              const matchesSelf = factionKeys.some(k => nameLower.includes(k.toLowerCase()))
              return matchesSelf
            }
            return true
          })
          .map(p => ({
            id: `installed:${p.id}`,
            // No 'kind' — installed packs are referenced by id only (no diffuse
            // bake or project clone); applyTemplate's fallback records the name
            // in project.template as a lightweight reference.
            name: p.name,
            hint: p.path,
            previewUrl: FACTION_ICON_SRC[faction] ?? null,
          }))
        if (!cancelled) setInstalledSkinOptions(options)
      } catch {
        if (!cancelled) setInstalledSkinOptions([])
      }
    })()
    return () => { cancelled = true }
  }, [faction])

  // Template inventory — order: Blank → Your Camos (installed + saved) → Stock Vehicles → Workshop.
  // Installed packs and saved projects appear prominently BEFORE the long stock-vehicle list
  // so the user's real camos are immediately visible when the menu opens.
  // Workshop/installed items are prefetched; recomputed on open so newly-saved packs appear.
  const templateOptions = useMemo<Option[]>(() => {
    if (openMenu !== 'template') return []
    // R2: stock skins ARE filtered by faction (templates are faction-specific).
    // Saved project templates are cross-faction (the user may want to seed from any pack).
    // Workshop templates are already pre-filtered by faction (listWorkshopSkinsForFaction).
    // I3: Installed skin packs are faction-filtered + numeric-noise-filtered by the fetch effect.
    const saved = listAllSkinProjects()
      .filter(p => p.id !== project.id) // don't offer the pack you're editing as its own template
      .map(p => ({
        id: p.id,
        kind: 'saved' as const,
        name: p.name,
        // R3: no path text — vehicle count hint suppressed from display;
        // hint field is NOT shown in the row per the new row layout.
      }))

    const installedPacks = (installedSkinOptions ?? []).map(opt => ({
      ...opt,
      // Inject real inventory icon when available; fall back to faction icon.
      previewUrl: (opt.hint && packIconUrls[opt.hint] !== undefined)
        ? packIconUrls[opt.hint]
        : FACTION_ICON_SRC[faction] ?? null,
    }))
    const workshopPacks = workshopTemplateOptions ?? []
    const yourCamos = [...installedPacks, ...saved]

    const stockVehicles = listStockSkins()
      .filter(s => s.factionId === faction) // R2: faction-filtered
      .map(s => ({
        id: `stock:${s.id}`,
        kind: 'stock' as const,
        name: s.name,
        // R3: no path/sgaName shown in rows; faction icon as preview.
        previewUrl: FACTION_ICON_SRC[s.factionId as Faction] ?? null,
      }))

    const result: Option[] = [{ id: 'blank', kind: 'blank', name: 'Blank canvas' }]

    // Group: Your Camos / Installed — only show the separator when there is content.
    if (yourCamos.length > 0) {
      result.push({ id: '__group_your_camos__', name: 'Your Camos', isGroupHeader: true })
      result.push(...yourCamos)
    }

    // Group: Stock Vehicles.
    if (stockVehicles.length > 0) {
      result.push({ id: '__group_stock__', name: 'Stock Vehicles', isGroupHeader: true })
      result.push(...stockVehicles)
    }

    // Group: Workshop.
    if (workshopPacks.length > 0) {
      result.push({ id: '__group_workshop__', name: 'Workshop', isGroupHeader: true })
      result.push(...workshopPacks)
    }

    return result
  }, [openMenu, faction, project.id, installedSkinOptions, workshopTemplateOptions, packIconUrls])

  // Decal-pack options: "None" + installed decal packs, faction-filtered.
  // Loading is async (IPC) so we keep the list in state and fire the
  // fetch whenever the decal menu opens. `null` means "loading in progress".
  const [workshopDecalOptions, setWorkshopDecalOptions] = useState<Option[] | null>(null)

  useEffect(() => {
    if (openMenu !== 'decal') return
    // Reset to loading state each time the menu opens so a fresh fetch runs.
    setWorkshopDecalOptions(null)
    let cancelled = false
    // I4: Faction keyword map — same as the skin template filter above.
    // InstalledPack has no faction field, so we infer from the pack name.
    // Packs with no faction keyword in their name are universal (shown for all factions).
    const FACTION_KEYWORDS: Record<string, string[]> = {
      german:      ['german', 'Wehrmacht', 'wehr', 'panzer', 'axis'],
      soviet:      ['soviet', 'russian', 'ussr', 'allies_ru'],
      west_german: ['west_german', 'oberkommando', 'okw'],
      aef:         ['aef', 'american', 'us army', 'usf'],
      british:     ['british', 'brit', 'uk '],
    }
    const factionKeys = FACTION_KEYWORDS[faction] ?? []
    const otherFactionKeys = Object.entries(FACTION_KEYWORDS)
      .filter(([f]) => f !== faction)
      .flatMap(([, keys]) => keys)

    void (async () => {
      try {
        // listInstalledPacks reads the .info file from every .sga under
        // mods/decals/subscriptions/ and returns {id, name, type, path}.
        // The main process auto-detects the mods root when none is passed.
        const packs = await listInstalledPacks()
        if (cancelled) return
        const options = packs
          .filter(p => p.type === 'decal')
          .filter(p => {
            // I4: faction-filter by name keyword. Universal packs (no faction
            // keyword) are shown for all factions. Faction-specific packs are
            // hidden when their faction keyword doesn't match the active faction.
            const nameLower = p.name.toLowerCase()
            const matchesOther = otherFactionKeys.some(k => nameLower.includes(k.toLowerCase()))
            if (matchesOther) {
              const matchesSelf = factionKeys.some(k => nameLower.includes(k.toLowerCase()))
              return matchesSelf
            }
            return true
          })
          .map(p => ({
            id: p.id,
            name: p.name,
            // hint carries the absolute SGA path so Editor.tsx can extract the
            // badge texture for installed decal packs (R-installed fix).
            hint: p.path,
          }))
        if (!cancelled) setWorkshopDecalOptions(options)
      } catch {
        // Non-fatal: fall back to empty list so the "No decal pack" option
        // still renders and the user can clear an existing association.
        if (!cancelled) setWorkshopDecalOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openMenu, faction])

  // ── Lazy pack icon loader ──────────────────────────────────────────────────
  // When the template or decal menu opens, fire off readInstalledPackIcon for
  // any option that has a hint (SGA path) and hasn't been fetched yet.
  // Results land in packIconUrls (and _packIconCache for cross-session reuse).
  useEffect(() => {
    if (!openMenu) return

    // Collect the set of SGA paths we need icons for, from whichever menu is open.
    const paths: string[] = []
    const sources = openMenu === 'template'
      ? (installedSkinOptions ?? [])
      : (workshopDecalOptions ?? [])

    for (const opt of sources) {
      if (opt.hint && !_packIconCache.has(opt.hint)) {
        paths.push(opt.hint)
      }
      // Pre-populate state from cache for entries already fetched.
      if (opt.hint && _packIconCache.has(opt.hint)) {
        const cached = _packIconCache.get(opt.hint)
        if (cached !== undefined) {
          setPackIconUrls(prev => {
            if (prev[opt.hint!] !== undefined) return prev // already in state
            return { ...prev, [opt.hint!]: cached }
          })
        }
      }
    }

    if (paths.length === 0) return
    let cancelled = false

    void (async () => {
      // Load icons one by one (sequential, not parallel) to avoid saturating
      // the IPC channel with many concurrent SGA opens.
      for (const sgaPath of paths) {
        if (cancelled) return
        const url = await readInstalledPackIcon(sgaPath)
        _packIconCache.set(sgaPath, url)
        if (!cancelled) {
          setPackIconUrls(prev => ({ ...prev, [sgaPath]: url }))
        }
      }
    })()

    return () => { cancelled = true }
  }, [openMenu, installedSkinOptions, workshopDecalOptions])

  const decalOptions = useMemo<Option[]>(() => {
    if (openMenu !== 'decal') return []
    return [
      { id: '', name: 'No decal pack' },
      ...(workshopDecalOptions ?? []).map(opt => ({
        ...opt,
        // Inject the real inventory icon when available; fall back to faction icon.
        previewUrl: (opt.hint && packIconUrls[opt.hint] !== undefined)
          ? packIconUrls[opt.hint]
          : FACTION_ICON_SRC[faction] ?? null,
      })),
    ]
  }, [openMenu, workshopDecalOptions, packIconUrls, faction])

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

  /**
   * Asynchronously bake the diffuse for an installed skin pack SGA into the
   * given vehicle slot. Installed packs share the same SGA layout as workshop
   * packs (art/armies/<faction>/vehicles/<vehicleId>/*_dif.rgt), so we reuse
   * readWorkshopDiffuseDataUrlBySgaPath.  opt.hint carries the absolute .sga path.
   */
  async function fetchInstalledDiffuse(sgaPath: string | undefined, vehicleFact: Faction, vehicleId: string): Promise<string | null> {
    if (!sgaPath) return null
    try {
      return await fetchWorkshopDiffuse(sgaPath, vehicleFact, vehicleId)
    } catch {
      return null
    }
  }

  function applyTemplate(opt: Option) {
    setOpenMenu(null)
    // Skip group headers.
    if (opt.isGroupHeader) return
    if (opt.id === project.template?.id) return
    const kind = opt.kind ?? 'blank'

    // Installed skin pack: record the template reference AND asynchronously bake
    // the installed SGA's diffuse for the current vehicle (same path layout as
    // workshop packs). Respects templateScope: "This vehicle" patches only the
    // current vehicle slot; "All vehicles" replaces the whole project template
    // reference (diffuse is baked for the current vehicle only — other vehicles
    // are lazily populated on demand when the user switches to them).
    if (opt.id.startsWith('installed:')) {
      const targetFaction = vehicleFaction(currentVehicleId)
      const bakeTarget = currentVehicleId
      const next: Coh2SkinProject = {
        ...project,
        template: { id: opt.id, kind: 'blank', name: opt.name },
      }
      setProject(next)
      persistActive(next)

      // Fire-and-forget diffuse bake.
      setDiffuseLoading(true)
      void fetchInstalledDiffuse(opt.hint, targetFaction, bakeTarget).then(dataUrl => {
        setDiffuseLoading(false)
        if (!dataUrl) return
        const existing = next.vehicles[bakeTarget] ?? { id: bakeTarget, tac: null, name: null, decals: [] }
        const veh = { ...structuredClone(existing), customDiffuseUrl: dataUrl }
        const updated: Coh2SkinProject = {
          ...next,
          vehicles: { ...next.vehicles, [bakeTarget]: veh },
        }
        persistActive(updated)
        setProject(updated)
      }).catch(() => setDiffuseLoading(false))
      return
    }

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
      decalPackRef: opt.id
        ? {
            id: opt.id,
            name: opt.name,
            // hint carries the absolute SGA path for installed decal packs;
            // undefined for user-created packs (they live in localStorage).
            ...(opt.hint ? { path: opt.hint } : {}),
          }
        : undefined,
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
          emptyHint={
            workshopTemplateOptions === null
              ? 'Loading workshop items…'
              : 'No stock camos detected for this faction.'
          }
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
  const realCount = options.filter(o => !o.isGroupHeader && o.id !== '' && o.id !== 'blank').length
  return (
    <div role="listbox" aria-label={heading} className="custom-scrollbar" style={{ ...panelStyle, [align]: 0 }}>
      <div style={sectionHeaderStyle}>{heading}</div>
      {headerContent && <div style={headerContentStyle}>{headerContent}</div>}
      {realCount === 0 && <div style={emptyHintStyle}>{emptyHint}</div>}
      {options.map(opt => {
        // Group header separator row — non-interactive.
        if (opt.isGroupHeader) {
          return (
            <div key={opt.id} aria-hidden style={groupHeaderStyle}>
              {opt.name}
            </div>
          )
        }
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
            {/* R3: [preview image LEFT] [name RIGHT] — no path/hint text shown. */}
            <div style={optionRowStyle}>
              {opt.previewUrl ? (
                <img
                  src={opt.previewUrl}
                  alt=""
                  aria-hidden
                  style={optionPreviewImgStyle}
                />
              ) : (
                <div style={optionPreviewPlaceholderStyle} aria-hidden />
              )}
              <div style={optionNameStyle}>{opt.name}</div>
            </div>
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

/** Non-interactive group separator label inside the dropdown. Visually distinct
 *  from the top-level panel heading (sectionHeaderStyle) — slightly smaller,
 *  lighter weight, with a subtle top rule to create visual separation. */
const groupHeaderStyle: CSSProperties = {
  padding: '8px 8px 2px',
  marginTop: 2,
  fontSize: 8.5,
  fontWeight: 600,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'rgba(247,247,250,0.30)',
  borderTop: '0.5px solid rgba(255,255,255,0.07)',
  userSelect: 'none',
  pointerEvents: 'none',
}

const optionStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '5px 8px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  transition: 'background-color 100ms ease-out',
  fontFamily: 'inherit',
  color: 'inherit',
}

/** R3: row layout — [preview 20×20] [name]. No path/hint text. */
const optionRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const optionPreviewImgStyle: CSSProperties = {
  width: 20,
  height: 20,
  objectFit: 'contain',
  flexShrink: 0,
  borderRadius: 3,
  opacity: 0.85,
  pointerEvents: 'none',
  userSelect: 'none',
}

/** Shown when no previewUrl is available. Matches the image slot size. */
const optionPreviewPlaceholderStyle: CSSProperties = {
  width: 20,
  height: 20,
  flexShrink: 0,
  borderRadius: 3,
  background: 'rgba(255,255,255,0.08)',
  border: '0.5px solid rgba(255,255,255,0.10)',
}

const optionNameStyle: CSSProperties = {
  fontSize: 12,
  color: 'rgba(247,247,250,0.92)',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
