/**
 * DecalPackEditor — full-screen editor for composing a CoH2 decal pack
 * (a curated set of independent 128×128 decal textures).
 *
 * Visual structure:
 *   [ Top-left: home button ]
 *   [ Centre: zoomed 128² canvas of the active decal — drag to translate ]
 *   [ Above bottom pill: horizontal decal strip (44×44 thumbnails) ]
 *   [ Bottom: BottomToolPill + ToolOptionsPeel ]
 *
 * Tools (in order): select, images, transform, tint, draw, project, export
 *
 * v2 redesign changes vs v1:
 *   • Removed `help` tool (and its peel).
 *   • Removed `adjustments` tool from toolbar — moved to an inline floating
 *     popover that appears when a decal is selected (same pattern as
 *     FaceplateEditor's Adjust popover for image layers).
 *   • Replaced `stroke` with `draw` — a raster paint tool that composites
 *     brush strokes directly onto the active decal's source image dataUrl.
 *   • Replaced `decals` peel with an always-visible horizontal decal strip
 *     docked between the canvas and the BottomToolPill (44×44 thumbnails,
 *     click-to-select, context menu for visibility/duplicate/delete).
 *   • Removed `<DecalPackInGamePreview />` from the right-side panel.
 *   • All remaining peels converted to horizontal layout (flexDirection: 'row').
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Stage, Layer, Image as KonvaImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import { useHistoryEngine } from '@/lib/editor-history'
import {
  AlignCenter,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  AlertTriangle,
  Brush,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Circle,
  Contrast,
  Copy,
  Crosshair,
  Droplet,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Grid,
  Image as ImageIcon,
  Library,
  Maximize2,
  MousePointer2,
  Move,
  Palette,
  Pencil,
  Pipette,
  RotateCcw,
  RotateCw,
  Sun,
  Trash2,
} from 'lucide-react'
import KeyboardShortcutsOverlay from './editor-primitives/KeyboardShortcutsOverlay'
import { applySnap, type SnapTarget } from '@/lib/snap-guides'
import { samplePixel } from '@/lib/brush'
import {
  ATLAS_PART_DEFS,
  atlasPartLabel,
  DECAL_PACK_SIZE,
  DECAL_TINT_DEFAULTS,
  addDecalSourceImageFromBlob,
  addDecalSourceImageFromFile,
  freshDecalId,
  newDecal,
  saveDecalPackToLocal,
  updateRecentDecalPackThumbnail,
  type Coh2DecalPackProject,
  type Decal,
} from '@/lib/decal-pack-project'
import { rasteriseDecal, decodeSourceImage } from '@/lib/decal-pack-export'
import { scheduleLiveSync, useLiveSync } from '@/lib/live-sync'
import { writeClipboard, readClipboard } from '@/lib/editor-clipboard'
import { INSIGNIA_LIBRARY, type InsigniaEntry } from '@/lib/insignia-library'
import HexColorInput from '@/components/editor-primitives/HexColorInput'
import EditorTitlePill from '@/components/editor-primitives/EditorTitlePill'
// StateIcon is now used by EditorTitlePill — no direct import needed here
import AtlasViewPanel from '@/components/AtlasViewPanel'
import {
  type AtlasViewMode,
  loadDecalViewMode,
  persistDecalViewMode,
} from '@/lib/atlas-view-settings'
import ImageDropZone, { type ImageDropZoneHandle } from './editor-shared/ImageDropZone'
import TransformInputsRow from './editor-shared/TransformInputsRow'
import LayersPanel from './editor-shared/LayersPanel'
import PropertiesPanel from './editor-shared/PropertiesPanel'
import type { GenericLayerProject } from '@/lib/layer-compositor/layer-model'
import { PackIdentityPopover } from './PackIdentityPopover'
// BorderBeam is now used by EditorTitlePill — no direct import needed here
import { makeDecalPublishTarget } from '@/components/PublishToWorkshopDialog'
import { PublishSection } from '@/components/PublishSection'
import FactionRow from '@/components/atlas/FactionRow'
import PartStepper from '@/components/atlas/PartStepper'
import FactionPartMatrix from '@/components/atlas/FactionPartMatrix'
import type { DecalFaction } from '@/lib/decal-mod-templates'
import { FACTION_LABELS, FACTION_COLORS } from '@/lib/factions'
import type { Faction } from '@/lib/vehicles'
import { usePanZoom, fitScale, ZOOM_MIN, ZOOM_MAX } from '@/lib/use-pan-zoom'
import {
  BlendModeSelect,
  BottomToolPill,
  CanvasPlaceholder,
  EditorHomeButton,
  GlassModal,
  PanelButton,
  SliderPopover,
  ToolOptionsPeel,
  UndoRedoBar,
  type ToolDef,
  EDITOR_ACCENT,
  EDITOR_TEXT_2,
  EDITOR_TEXT_4,
} from './editor-primitives'

interface Props {
  project: Coh2DecalPackProject
  onBack: () => void
  installRoot?: FileSystemDirectoryHandle | null
}

/** Decal-editor tool identifiers — drive the BottomToolPill segments and
 *  the corresponding ToolOptionsPeel contents. */
type DecalToolId = 'select' | 'images' | 'transform' | 'tint' | 'draw'

/** Maximum number of files the batch-import picker will process at once. */
const BATCH_IMPORT_MAX = 32

/** Minimum 1×1 PNG data URL — used to detect "blank/empty" decal images. */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/**
 * The badge UV cell (Q10 validation). In this editor the ENTIRE 128² decal
 * canvas maps 1:1 onto the engine's badge cell: `Editor.tsx` rasterises the
 * full 128² decal and blits it edge-to-edge into the badge atlas cell
 * (U∈[0.286,0.337]×V∈[0.039,0.086], px {x:586,y:80,w:104,h:96} at 2048² — see
 * `Editor.tsx:895-906` and `verify-calibration.ts` BADGE_CELL). Consequently
 * any art drawn OUTSIDE the 0..128 canvas bounds is clipped by rasteriseDecal
 * and never reaches the vehicle — so the "badge cell" for validation is the
 * full editor canvas itself. Art whose bbox falls largely outside it ships an
 * invisible / clipped in-game badge.
 */
const BADGE_CELL_128 = { x: 0, y: 0, w: DECAL_PACK_SIZE, h: DECAL_PACK_SIZE } as const

/** Axis-aligned overlap area of two rects (0 when disjoint). */
function rectOverlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const w = x1 - x0
  const h = y1 - y0
  return w > 0 && h > 0 ? w * h : 0
}

export default function DecalPackEditor({ project: initialProject, onBack, installRoot: _installRoot }: Props) {
  const [project, setProject] = useState<Coh2DecalPackProject>(initialProject)
  const [activeTool, setActiveTool] = useState<DecalToolId>('select')
  /** Non-null when the batch-import picker hit the 32-file cap. */
  const [batchWarning, setBatchWarning] = useState<string | null>(null)
  const dropZoneRef = useRef<ImageDropZoneHandle>(null)
  // Stable getter/setter refs so useHistoryEngine captures remain current.
  const projectRef = useRef<Coh2DecalPackProject>(initialProject)
  // eslint-disable-next-line react-hooks/refs -- intentional ref-as-latest-value
  projectRef.current = project
  const history = useHistoryEngine<Coh2DecalPackProject>(
    useCallback(() => projectRef.current, []),
    setProject,
    {
      limit: 50,
      onPersist: useCallback((next: Coh2DecalPackProject) => {
        saveDecalPackToLocal(next)
        scheduleLiveSync('decal', next)
      }, []),
    },
  )

  // ── Draw tool state ────────────────────────────────────────────────────
  const [brushSize, setBrushSize] = useState(8)
  const [brushColor, setBrushColor] = useState('#ffffff')
  const [brushOpacity, setBrushOpacity] = useState(1)
  /** Mirror paint across the X axis (left/right). Component-local, not persisted. */
  const [mirrorX, setMirrorX] = useState(false)
  /** Mirror paint across the Y axis (top/bottom). Component-local, not persisted. */
  const [mirrorY, setMirrorY] = useState(false)
  /** Erase mode: destination-out compositing instead of painting. */
  const [brushErase, setBrushErase] = useState(false)
  /** Eyedropper mode: one-shot — next click samples the composited decal
   *  canvas and sets it as the brush colour, then snaps back to paint. */
  const [eyedropperActive, setEyedropperActive] = useState(false)
  const liveStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef(false)

  // ── Multi-select state ────────────────────────────────────────────────
  /** Additional selected decal ids for multi-select (Cmd/Ctrl-click). */
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())

  // ── G8: Configurable nudge step ───────────────────────────────────────
  /** How many px each arrow-key nudge moves the selected decal. */
  const [nudgeStep, setNudgeStep] = useState<1 | 2 | 4 | 8>(1)

  // ── G11: Snap-to-grid state ───────────────────────────────────────────
  const [snapGrid, setSnapGrid] = useState(false)
  const [snapGridStep, setSnapGridStep] = useState<4 | 8 | 16 | 32>(8)

  // ── G6: Inline layer rename state ─────────────────────────────────────
  /** The decal id currently being renamed (null = not renaming). */
  const [renamingDecalId, setRenamingDecalId] = useState<string | null>(null)

  // ── Keyboard shortcuts overlay (G2) ──────────────────────────────────
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // ── Drag-to-reorder state (G3) ───────────────────────────────────────
  const [dragDecalId, setDragDecalId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // ── Brush hardness state (G1) ────────────────────────────────────────
  /** 1 = hard edge, 0 = fully soft/feathered. Component-local, not persisted. */
  const [brushHardness, setBrushHardness] = useState(1)

  // ── Insignia library modal state ──────────────────────────────────────
  const [insigniaOpen, setInsigniaOpen] = useState(false)
  // ── Canvas view mode ──────────────────────────────────────────────────
  // Three-position visualisation switcher (see FaceplateEditor for the
  // same rationale): template / checkerboard / in-game. `previewTransparent`
  // is a derived boolean so the existing canvas-style branches don't need
  // to change.
  const [viewMode, setViewMode] = useState<AtlasViewMode>(loadDecalViewMode)
  useEffect(() => {
    persistDecalViewMode(viewMode)
  }, [viewMode])
  // `previewTransparent` is kept for FaceplateEditor compat but is never true
  // in the decal editor — the "Default view" (checkerboard slot) renders the
  // stock default underlay instead of a light checker.
  const previewTransparent = false
  const showDefaultUnderlay = viewMode === 'checkerboard'
  const [insigniaFilter, setInsigniaFilter] = useState<InsigniaEntry['faction'] | null>(null)

  // ── Select tool smart-snap state ──────────────────────────────────────
  /** Active snap guide lines while a decal drag is in progress. */
  const [snapGuides, setSnapGuides] = useState<SnapTarget[]>([])

  // ── Atlas part / faction state (v6) ───────────────────────────────────
  const [activePartIndex, setActivePartIndex] = useState<number>(
    initialProject.activePartIndex ?? 1
  )
  const [activeFaction, setActiveFaction] = useState<DecalFaction | null>(
    initialProject.activeFaction ?? null
  )
  const [showPartMatrix, setShowPartMatrix] = useState(false)
  // R3: casual makers get a single "Main badge" surface by default. The part
  // stepper, faction row, parts×factions matrix and per-faction override
  // controls are power-user features hidden behind an "Advanced placement ▸"
  // disclosure that starts COLLAPSED. Everything remains reachable once opened.
  const [showAdvancedPlacement, setShowAdvancedPlacement] = useState(false)

  // Persist part/faction into project on change (non-undoable, goes through
  // history.mutate so onPersist fires and the project is saved to localStorage)
  useEffect(() => {
    mutate(prev => ({ ...prev, activePartIndex, activeFaction }), { undoable: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate is stable; activePartIndex/activeFaction are the real deps
  }, [activePartIndex, activeFaction])

  // ── Decal strip context menu ───────────────────────────────────────────
  const [decalCtxMenu, setDecalCtxMenu] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)

  // ── Centered pack-name title popover ──────────────────────────────────
  // Mirrors FaceplateEditor's top-centre rename popover. The full project
  // metadata panel (author / name / description) still lives on the left
  // under the home button — this is purely a quick-rename + at-a-glance
  // identifier so the user always sees which pack they're editing without
  // having to expand the side panel.
  const [packNameEditOpen, setPackNameEditOpen] = useState(false)
  // ── Live Sync state (for title pill inline icon) ───────────────────────
  const sync = useLiveSync()
  const liveSyncTitle = sync.enabled
    ? `Click to rename — Live Sync: ${sync.reason}`
    : 'Click to rename — Live Sync is off'
  const liveSyncAriaLabel = sync.enabled
    ? `Pack name — click to rename. Live Sync: ${sync.reason}`
    : 'Pack name — click to rename. Live Sync is off'

  // ── Publish-to-Workshop dialog ────────────────────────────────────────
  const [publishTarget, setPublishTarget] = useState<import('@/components/PublishToWorkshopDialog').WorkshopPublishTarget | null>(null)
  const [isBuildingTarget, setIsBuildingTarget] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  // ── S5: Default-slot reference preview ───────────────────────────────────
  // A 128×128 canvas showing the composited result of the active part's
  // shared layers (i.e. what the slot currently looks like when baked).
  // Rendered asynchronously in a useEffect and surfaced as a data URL so
  // the reference panel can render it as a plain <img>.
  // The effect reruns whenever the active part's layer list or source images
  // change. For v5 flat projects (no parts) it falls back to project.decals.
  const [refPreviewDataUrl, setRefPreviewDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      // Resolve the shared layers for the active part (v6) or project.decals (v5).
      let layers: import('@/lib/decal-pack-project').Decal[]
      let partW: number
      let partH: number
      if (project.parts) {
        const def = ATLAS_PART_DEFS[activePartIndex]
        const part = project.parts[activePartIndex]
        if (!def || !part) { setRefPreviewDataUrl(null); return }
        layers = part.shared
        partW = def.region.w
        partH = def.region.h
      } else {
        layers = project.decals
        partW = DECAL_PACK_SIZE
        partH = DECAL_PACK_SIZE
      }

      if (layers.filter(d => d.visible).length === 0) {
        if (!cancelled) setRefPreviewDataUrl(null)
        return
      }

      const { compositePartLayers } = await import('@/lib/atlas-parts')
      if (cancelled) return
      const rgba = await compositePartLayers(layers, partW, partH, project.sourceImages)
      if (cancelled) return

      // Scale the composited region down to DECAL_PACK_SIZE × DECAL_PACK_SIZE
      // using a crisp imageSmoothingQuality:'high' canvas draw.
      const out = document.createElement('canvas')
      out.width = DECAL_PACK_SIZE
      out.height = DECAL_PACK_SIZE
      const ctx = out.getContext('2d')
      if (!ctx) return

      // First blit the full-res composite into an intermediate canvas.
      const src = document.createElement('canvas')
      src.width = partW
      src.height = partH
      const sctx = src.getContext('2d')
      if (!sctx) return
      // new ImageData requires a plain ArrayBuffer-backed Uint8ClampedArray.
      // compositePartLayers may return a SharedArrayBuffer-backed one; copy
      // element-by-element into a guaranteed-plain-ArrayBuffer Uint8ClampedArray.
      const safeRgba = Uint8ClampedArray.from(rgba)
      sctx.putImageData(new ImageData(safeRgba, partW, partH), 0, 0)

      // Downscale with high quality into the 128² output.
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, 0, 0, partW, partH, 0, 0, DECAL_PACK_SIZE, DECAL_PACK_SIZE)

      if (!cancelled) setRefPreviewDataUrl(out.toDataURL())
    }
    run().catch(() => { if (!cancelled) setRefPreviewDataUrl(null) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the active part's layers + sourceImages + part index; cellDecals declared later in the file so can't be listed here
  }, [project.parts, project.decals, project.sourceImages, activePartIndex])

  // ── Project mutation ─────────────────────────────────────────────────────
  // Thin wrapper: stamps modifiedAt and delegates to the shared engine.
  // All existing call sites are preserved — the signature is unchanged.
  const mutate = useCallback(
    (
      fn: (p: Coh2DecalPackProject) => Coh2DecalPackProject,
      { undoable = true }: { undoable?: boolean } = {},
    ) => {
      history.mutate(
        p => ({ ...fn(p), modifiedAt: new Date().toISOString() }),
        { undoable },
      )
    },
    [history],
  )

  const undo = useCallback(() => { history.undo() }, [history])
  const redo = useCallback(() => { history.redo() }, [history])

  // ── Active-cell helpers (v6) ─────────────────────────────────────────────
  // `cellDecals`: the read-only list visible in the current (part,faction)
  // cell. For v5 flat projects, falls back to project.decals.
  // For v6: if activeFaction is set, reads overrides[faction] (with fallback
  // to shared for display-only); otherwise reads shared.
  // The `activeLayerId` for the active cell comes from parts[activePartIndex].activeLayerId.

  // Returns the decal list that should be DISPLAYED for the current cell.
  // Faction cells that have no override yet fall back to shared (inheritance).
  const cellDecals: readonly Decal[] = useMemo(() => {
    if (!project.parts) return project.decals // v5 fallback
    const part = project.parts[activePartIndex]
    if (!part) return []
    if (activeFaction !== null) {
      return part.overrides?.[activeFaction] ?? part.shared
    }
    return part.shared
  }, [project.parts, project.decals, activePartIndex, activeFaction])

  // The ATLAS_PART_DEFS entry for the currently-active part (v6) or null (v5).
  const activePartDef = useMemo(
    () => ATLAS_PART_DEFS[activePartIndex] ?? null,
    [activePartIndex],
  )

  // Returns the activeLayerId for the current cell.
  const cellActiveLayerId: string | null = useMemo(() => {
    if (!project.parts) return project.activeDecalId // v5 fallback
    const part = project.parts[activePartIndex]
    if (!part) return null
    return part.activeLayerId
  }, [project.parts, project.activeDecalId, activePartIndex])

  /**
   * mutateActiveCell — immutably applies `updater` to the current cell's
   * decal list, returning an updated project.
   *
   * Fork-on-write semantics for faction cells: when activeFaction is set and
   * no override array exists yet, we COPY the shared list into overrides[faction]
   * before applying the updater. This ensures editing a faction "forks" from
   * shared rather than mutating it. The fork only happens on the FIRST edit for
   * that faction cell.
   *
   * For v5 flat projects (no parts), falls back to mutating project.decals.
   */
  const mutateActiveCell = useCallback(
    (
      p: Coh2DecalPackProject,
      updater: (list: Decal[]) => Decal[],
    ): Coh2DecalPackProject => {
      if (!p.parts) {
        // v5 fallback: mutate project.decals directly
        return { ...p, decals: updater(p.decals) }
      }
      const parts = p.parts.map((part, i) => {
        if (i !== activePartIndex) return part
        if (activeFaction !== null) {
          // Fork-on-write: if no override exists yet, fork from shared.
          const existing = part.overrides?.[activeFaction] ?? [...part.shared]
          const updated = updater(existing)
          return {
            ...part,
            overrides: { ...part.overrides, [activeFaction]: updated },
          }
        }
        return { ...part, shared: updater(part.shared) }
      })
      return { ...p, parts }
    },
    [activePartIndex, activeFaction],
  )

  /**
   * setActiveCellLayerId — sets the activeLayerId on the current part.
   * This is separate from mutateActiveCell so callers that only need to
   * change selection don't trigger fork-on-write.
   */
  const setActiveCellLayerId = useCallback(
    (p: Coh2DecalPackProject, id: string | null): Coh2DecalPackProject => {
      if (!p.parts) return { ...p, activeDecalId: id } // v5 fallback
      const parts = p.parts.map((part, i) =>
        i === activePartIndex ? { ...part, activeLayerId: id } : part,
      )
      return { ...p, parts, activeDecalId: id }
    },
    [activePartIndex],
  )

  // ── Image library import ─────────────────────────────────────────────────
  const onImport = useCallback(
    async (blob: Blob, name?: string) => {
      const draft = structuredClone(project)
      let imageId: string
      try {
        imageId = await addDecalSourceImageFromBlob(draft, blob, name)
      } catch (e) {
        console.warn('decal source import failed', e)
        return
      }
      const decal = newDecal(draft, imageId, name)
      mutate(p => {
        if (p.parts) {
          // v6: append to active part's shared or faction override layers.
          const parts = p.parts.map((part, i) => {
            if (i !== activePartIndex) return part
            if (activeFaction && part.overrides) {
              const existing = part.overrides[activeFaction] ?? []
              return { ...part, overrides: { ...part.overrides, [activeFaction]: [...existing, decal] }, activeLayerId: decal.id }
            }
            return { ...part, shared: [...part.shared, decal], activeLayerId: decal.id }
          })
          return { ...p, sourceImages: { ...p.sourceImages, ...draft.sourceImages }, parts, decals: [...p.decals, decal] }
        }
        // v5 fallback:
        return { ...p, sourceImages: { ...p.sourceImages, ...draft.sourceImages }, decals: [...p.decals, decal], activeDecalId: decal.id }
      })
    },
    [project, mutate, activePartIndex, activeFaction],
  )

  const onAddImageFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const draft = structuredClone(project)
        void addDecalSourceImageFromFile(draft, file)
          .then(imageId => {
            const decal = newDecal(draft, imageId, file.name)
            mutate(p => {
              if (p.parts) {
                // v6: append to active part's shared or faction override layers.
                const parts = p.parts.map((part, i) => {
                  if (i !== activePartIndex) return part
                  if (activeFaction && part.overrides) {
                    const existing = part.overrides[activeFaction] ?? []
                    return { ...part, overrides: { ...part.overrides, [activeFaction]: [...existing, decal] }, activeLayerId: decal.id }
                  }
                  return { ...part, shared: [...part.shared, decal], activeLayerId: decal.id }
                })
                return { ...p, sourceImages: { ...p.sourceImages, ...draft.sourceImages }, parts, decals: [...p.decals, decal] }
              }
              // v5 fallback:
              return { ...p, sourceImages: { ...p.sourceImages, ...draft.sourceImages }, decals: [...p.decals, decal], activeDecalId: decal.id }
            })
          })
          .catch(e => console.warn('decal source import failed', e))
      }
    },
    [project, mutate, activePartIndex, activeFaction],
  )

  const onAddImageToCanvas = useCallback(
    (imageId: string) => {
      mutate(p => {
        const decal = newDecal(p, imageId)
        if (p.parts) {
          // v6: append to the active cell and activate it.
          const withAdded = mutateActiveCell(p, list => [...list, decal])
          return setActiveCellLayerId(withAdded, decal.id)
        }
        // v5 fallback:
        return { ...p, decals: [...p.decals, decal], activeDecalId: decal.id }
      })
    },
    [mutate, mutateActiveCell, setActiveCellLayerId],
  )

  const onBatchImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.click()
    const files = await new Promise<File[]>(resolve => {
      input.onchange = () => {
        const list = Array.from(input.files ?? [])
        resolve(list)
      }
      const onFocus = () => {
        window.removeEventListener('focus', onFocus)
        setTimeout(() => {
          if (!input.files?.length) resolve([])
        }, 300)
      }
      window.addEventListener('focus', onFocus)
    })
    document.body.removeChild(input)

    if (files.length === 0) return

    let capped = false
    let picked = files
    if (files.length > BATCH_IMPORT_MAX) {
      capped = true
      picked = files.slice(0, BATCH_IMPORT_MAX)
    }

    picked = [...picked].sort((a, b) => a.name.localeCompare(b.name))

    const draft = structuredClone(project)
    const newDecals: Decal[] = []
    await Promise.all(
      picked.map(async file => {
        try {
          const imageId = await addDecalSourceImageFromFile(draft, file)
          const friendly = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')
          newDecals.push(newDecal(draft, imageId, friendly))
        } catch (e) {
          console.warn('batch import: failed to load', file.name, e)
        }
      }),
    )

    newDecals.sort((a, b) => a.name.localeCompare(b.name))

    if (newDecals.length === 0) return

    const lastDecal = newDecals[newDecals.length - 1]
    mutate(p => {
      if (p.parts) {
        // v6: append to active part's shared layers.
        const parts = p.parts.map((part, i) => {
          if (i !== activePartIndex) return part
          if (activeFaction && part.overrides) {
            const existing = part.overrides[activeFaction] ?? []
            return { ...part, overrides: { ...part.overrides, [activeFaction]: [...existing, ...newDecals] }, activeLayerId: lastDecal.id }
          }
          return { ...part, shared: [...part.shared, ...newDecals], activeLayerId: lastDecal.id }
        })
        return { ...p, sourceImages: { ...p.sourceImages, ...draft.sourceImages }, parts, decals: [...p.decals, ...newDecals] }
      }
      // v5 fallback:
      return { ...p, sourceImages: { ...p.sourceImages, ...draft.sourceImages }, decals: [...p.decals, ...newDecals], activeDecalId: lastDecal.id }
    })

    if (capped) {
      setBatchWarning(
        `Only the first ${BATCH_IMPORT_MAX} files were imported. Please import the remaining files separately.`,
      )
    }
  }, [project, mutate, activePartIndex, activeFaction])

  // ── Component-level wrapper for updateDecal capturing active cell ────────
  // Defined before any effects that use it to avoid temporal dead zone issues.
  const updateCellDecal = useCallback(
    (p: Coh2DecalPackProject, id: string, fn: (d: Decal) => Decal) =>
      updateDecal(p, id, fn, activePartIndex, activeFaction),
    [activePartIndex, activeFaction],
  )

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  // activeDecal: resolved from the ACTIVE CELL's layer list (v6) or project.decals (v5).
  const activeDecal = useMemo(
    () => cellDecals.find(d => d.id === cellActiveLayerId) ?? null,
    [cellDecals, cellActiveLayerId],
  )

  // ── Shared-panel integration (Phase 1) ──────────────────────────────────
  // Synthetic GenericLayerProject<Decal> built from the active cell's layers +
  // sourceImages.  This is a READ-ONLY view passed to LayersPanel and
  // PropertiesPanel.  All mutations go through mutateForPanel which delegates to
  // mutateActiveCell (preserving fork-on-write semantics for faction cells).
  const syntheticProject = useMemo<GenericLayerProject<Decal>>(
    () => ({
      layers: cellDecals as Decal[],
      images: project.sourceImages as Record<string, { id: string; dataUrl: string; name: string }>,
    }),
    [cellDecals, project.sourceImages],
  )

  /**
   * mutateForPanel — translates a GenericLayerProject<Decal> mutation into a
   * full Coh2DecalPackProject mutation via mutateActiveCell.
   *
   * LayersPanel and PropertiesPanel call this with:
   *   fn: (synthetic) => updated synthetic
   * We extract the updated layers list and pass it through mutateActiveCell.
   * Fork-on-write for faction cells is handled inside mutateActiveCell.
   */
  const mutateForPanel = useCallback(
    (
      fn: (p: GenericLayerProject<Decal>) => GenericLayerProject<Decal>,
      opts?: { undoable?: boolean },
    ) => {
      mutate(p => {
        const synth: GenericLayerProject<Decal> = {
          layers: (() => {
            if (!p.parts) return p.decals
            const part = p.parts[activePartIndex]
            if (!part) return []
            if (activeFaction !== null) return part.overrides?.[activeFaction] ?? [...part.shared]
            return part.shared
          })(),
          images: p.sourceImages as Record<string, { id: string; dataUrl: string; name: string }>,
        }
        const updated = fn(synth)
        return mutateActiveCell(p, () => updated.layers)
      }, opts)
    },
    [mutate, mutateActiveCell, activePartIndex, activeFaction],
  )

  // (Removed in v1.0: live LobbyPreviewPanel composition. The in-editor
  // player-card mock didn't match the actual CoH2 customisation screen
  // layout, so it gave a misleading preview. The accurate
  // DecalPackInGamePreview component + the live 128×128 canvas are now
  // the source-of-truth previews.)

  // Hover-preview thumbnail for the New-Decal-Pack TemplatePicker. We
  // compose the FIRST decal of the pack (not the active one, which can
  // be anywhere in the list) so each saved pack's thumbnail is stable
  // and recognisable across edits. Falls back to a no-op when the pack
  // is empty or the source image hasn't loaded yet — touchRecent already
  // preserves the prior thumbnail across saves so a transient null
  // never wipes the picker preview.
  useEffect(() => {
    let cancelled = false
    const firstDecal = project.decals[0]
    if (!firstDecal) return
    const src = project.sourceImages[firstDecal.sourceImageId]
    if (!src) return
    void (async () => {
      try {
        const img = await loadImageForPreview(src.dataUrl)
        if (cancelled) return
        const canvas = rasteriseDecal(firstDecal, img)
        let url: string
        if ('convertToBlob' in canvas) {
          const blob = await canvas.convertToBlob({ type: 'image/png' })
          if (cancelled) return
          url = await new Promise<string>((res, rej) => {
            const r = new FileReader()
            r.onload = () => res(String(r.result))
            r.onerror = () => rej(r.error ?? new Error('FileReader failed'))
            r.readAsDataURL(blob)
          })
        } else {
          url = canvas.toDataURL('image/png')
        }
        if (cancelled) return
        try {
          updateRecentDecalPackThumbnail(project.id, url)
        } catch {
          /* swallow — thumbnail update is best-effort */
        }
      } catch (e) {
        if (!cancelled) console.warn('decal pack thumbnail compose failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project.id, project.decals, project.sourceImages])

  // ── Zoom/pan state — backed by usePanZoom ───────────────────────────────
  // The stage container ref receives the pan-zoom wheel + pointer handlers.
  // Must be declared before the keyboard effect that uses pz.
  const stageRef = useRef<HTMLDivElement>(null)
  const pz = usePanZoom({
    containerRef: stageRef,
    contentSize: { w: DECAL_PACK_SIZE, h: DECAL_PACK_SIZE },
    initialScale: initialProject.editorZoom ?? 4,
  })
  const zoom = pz.scale

  // Persist zoom into project (non-undoable so it doesn't spam undo history).
  useEffect(() => {
    mutate(p => ({ ...p, editorZoom: pz.scale }), { undoable: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only runs when zoom changes
  }, [pz.scale])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const meta = ev.ctrlKey || ev.metaKey
      const target = ev.target as HTMLElement | null
      const inForm =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (inForm) return

      if (ev.key === 'F1') {
        ev.preventDefault()
        setShortcutsOpen(v => !v)
        return
      }
      // Zoom shortcuts — view-state only, no undo frame
      if (meta && (ev.key === '=' || ev.key === '+')) {
        ev.preventDefault()
        pz.setScale(Math.min(ZOOM_MAX, +(pz.scale * 1.2).toFixed(2)))
        return
      }
      if (meta && ev.key === '-') {
        ev.preventDefault()
        pz.setScale(Math.max(ZOOM_MIN, +(pz.scale / 1.2).toFixed(2)))
        return
      }
      if (meta && ev.key === '0') {
        ev.preventDefault()
        pz.fitToWindow()
        return
      }
      if (meta && ev.key === '1') {
        ev.preventDefault()
        pz.resetTo100()
        return
      }
      if (meta && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
        ev.preventDefault()
        undo()
        return
      }
      // Redo: Cmd/Ctrl+Shift+Z or Ctrl+Y
      if ((meta && ev.shiftKey && ev.key.toLowerCase() === 'z') || (ev.ctrlKey && ev.key.toLowerCase() === 'y')) {
        ev.preventDefault()
        redo()
        return
      }
      // G7: brush size [ / ] shortcuts when in draw mode
      if (activeTool === 'draw') {
        if (ev.key === '[') {
          ev.preventDefault()
          setBrushSize(s => Math.max(1, s - 2))
          return
        }
        if (ev.key === ']') {
          ev.preventDefault()
          setBrushSize(s => Math.min(40, s + 2))
          return
        }
      }
      // N — import image (new decal slot)
      if (ev.key === 'n' || ev.key === 'N') {
        if (!meta) {
          ev.preventDefault()
          void onBatchImport()
          return
        }
      }
      // Esc — deselect all (active + multi-select)
      if (ev.key === 'Escape') {
        if (activeDecal) mutate(p => setActiveCellLayerId(p, null), { undoable: false })
        setMultiSelectedIds(new Set())
        return
      }
      // Ctrl+D — duplicate active decal
      if (meta && ev.key.toLowerCase() === 'd') {
        ev.preventDefault()
        if (activeDecal) duplicateDecal(activeDecal.id)
        return
      }
      // [ / ] in select mode — move decal down/up (only when not draw mode)
      if (activeTool === 'select') {
        if (ev.key === '[' && activeDecal) {
          ev.preventDefault()
          moveDecal(activeDecal.id, -1)
          return
        }
        if (ev.key === ']' && activeDecal) {
          ev.preventDefault()
          moveDecal(activeDecal.id, 1)
          return
        }
      }
      if (!activeDecal) return
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault()
        deleteDecal(activeDecal.id)
      } else if (
        ev.key === 'ArrowUp' ||
        ev.key === 'ArrowDown' ||
        ev.key === 'ArrowLeft' ||
        ev.key === 'ArrowRight'
      ) {
        ev.preventDefault()
        const dx = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0
        const dy = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0
        // G8: use configurable nudge step; Shift = 10× the step
        const step = ev.shiftKey ? nudgeStep * 10 : nudgeStep
        mutate(p =>
          updateCellDecal(p, activeDecal.id, d => ({
            ...d,
            x: d.x + dx * step,
            y: d.y + dy * step,
          })),
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDecal?.id, activeTool, nudgeStep, mutate, undo, redo, updateCellDecal, onBatchImport, setActiveCellLayerId, pz.scale, pz.setScale, pz.fitToWindow, pz.resetTo100])

  // ── Copy / paste (Cmd-C / Cmd-V) ─────────────────────────────────────────
  useEffect(() => {
    const onCopyPaste = (ev: KeyboardEvent) => {
      const meta = ev.ctrlKey || ev.metaKey
      if (!meta) return
      const target = ev.target as HTMLElement | null
      const inForm =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (inForm) return

      if (ev.key === 'c' && activeDecal) {
        ev.preventDefault()
        writeClipboard({
          kind: 'decal',
          source: { editor: 'decal-pack', copiedAt: new Date().toISOString() },
          payload: [activeDecal],
        })
      }
      if (ev.key === 'v') {
        const entry = readClipboard()
        if (!entry || entry.kind !== 'decal' || entry.source.editor !== 'decal-pack') return
        ev.preventDefault()
        const copies = (entry.payload as Decal[]).map(d => ({
          ...structuredClone(d),
          id: freshDecalId(),
          name: d.name + ' (copy)',
          x: d.x + 16,
          y: d.y + 16,
        }))
        const lastId = copies[copies.length - 1].id
        mutate(p => {
          const withPasted = mutateActiveCell(p, list => [...list, ...copies])
          return setActiveCellLayerId(withPasted, lastId)
        })
      }
    }
    window.addEventListener('keydown', onCopyPaste)
    return () => window.removeEventListener('keydown', onCopyPaste)
  }, [activeDecal, mutate, mutateActiveCell, setActiveCellLayerId])

  // ── Canvas measurement (for drag math) ───────────────────────────────────
  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const measure = () => setCanvasRect(el.getBoundingClientRect())
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('scroll', measure, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', measure, true)
    }
  }, [])

  const viewScale = canvasRect ? canvasRect.width / DECAL_PACK_SIZE : 1

  // ── Konva Stage refs ──────────────────────────────────────────────────────
  const konvaStageRef = useRef<Konva.Stage>(null)
  const konvaNodeRefs = useRef<Record<string, Konva.Image | null>>({})
  const transformerRef = useRef<Konva.Transformer>(null)

  /**
   * Cache of loaded HTMLImageElement per sourceImageId.
   * Konva Image nodes need a resolved HTMLImageElement (not a data URL).
   * We load on demand and force a layer redraw when an image loads.
   */
  const [konvaImages, setKonvaImages] = useState<Record<string, HTMLImageElement>>({})

  // Sync konvaImages whenever sourceImages changes (new decals added, paint applied).
  useEffect(() => {
    const sourceImages = project.sourceImages
    const knownIds = new Set(Object.keys(konvaImages))
    for (const [id, src] of Object.entries(sourceImages)) {
      if (!knownIds.has(id) && src.dataUrl) {
        const el = new window.Image()
        el.onload = () => {
          setKonvaImages(prev => ({ ...prev, [id]: el }))
        }
        el.src = src.dataUrl
        knownIds.add(id)
      }
    }
    // When dataUrl changes (paint stroke applied), reload the image.
    for (const [id, src] of Object.entries(sourceImages)) {
      const cached = konvaImages[id]
      if (cached && cached.src !== src.dataUrl && src.dataUrl) {
        const el = new window.Image()
        el.onload = () => {
          setKonvaImages(prev => ({ ...prev, [id]: el }))
        }
        el.src = src.dataUrl
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.sourceImages])

  /**
   * Attach the Transformer to all currently-selected decal nodes.
   * Single-select: one node. Multi-select: all nodes in allSelectedIds.
   * When ids is empty/null the transformer detaches.
   */
  const attachTransformerToIds = useCallback((ids: string[]) => {
    const tr = transformerRef.current
    if (!tr) return
    if (ids.length === 0) {
      tr.nodes([])
      tr.getLayer()?.batchDraw()
      return
    }
    const nodes = ids.flatMap(id => {
      const node = konvaNodeRefs.current[id]
      return node ? [node] : []
    })
    if (nodes.length > 0) {
      tr.nodes(nodes)
      tr.getLayer()?.batchDraw()
    }
  }, [])

  // Re-attach transformer whenever active decal, multi-select, or tool changes.
  useEffect(() => {
    if (activeTool !== 'draw') {
      const allIds = [
        ...(cellActiveLayerId ? [cellActiveLayerId] : []),
        ...Array.from(multiSelectedIds).filter(id => id !== cellActiveLayerId),
      ]
      attachTransformerToIds(allIds)
    } else {
      attachTransformerToIds([])
    }
  }, [cellActiveLayerId, multiSelectedIds, activeTool, attachTransformerToIds])

  /**
   * Per-drag-gesture: tracks the x/y of EVERY selected node at drag-start.
   * Updated in onDragStart, read in onDragMove (for companion-move) and
   * onDragEnd (to compute final positions for the state write).
   * Key = decalId, value = {x, y} at gesture start.
   */
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  /**
   * onTransformEnd: read back Konva node attrs → write to Decal state via mutate.
   * Decomposes scaleX/scaleY signs to recover flipH/flipV (spike caveat #2).
   * Gesture-granular: one undoable entry per transform (history.beginGesture is
   * called on Transformer dragstart via onTransformStart).
   */
  const handleKonvaTransformEnd = useCallback(
    (decalId: string) => {
      const node = konvaNodeRefs.current[decalId]
      if (!node) return
      const rawScaleX = node.scaleX()
      const rawScaleY = node.scaleY()
      const scale = Math.abs(rawScaleX)
      const flipH = rawScaleX < 0
      const flipV = rawScaleY < 0
      // Reset node scaleX/Y to canonical values so it doesn't drift.
      node.scaleX(flipH ? -scale : scale)
      node.scaleY(flipV ? -scale : scale)
      // mutate FIRST so the pending gesture snapshot (pre-gesture state) is
      // flushed onto the undo stack before endGesture clears it.
      mutate(p =>
        updateCellDecal(p, decalId, d => ({
          ...d,
          x: node.x(),
          y: node.y(),
          scale,
          rotation: node.rotation(),
          flipH,
          flipV,
        })),
      )
      history.endGesture()
    },
    [mutate, updateCellDecal, history],
  )

  /**
   * onDragEnd: write back position(s) from Konva drag.
   * For multi-select, writes ALL selected nodes' final positions in one mutate
   * call (the gesture frame was opened in onDragStart → ONE undo step for the
   * whole group move regardless of how many decals moved).
   */
  const handleKonvaDragEnd = useCallback(
    (decalId: string, node: Konva.Image) => {
      setSnapGuides([])

      // Collect final positions: dragged node + companion nodes.
      const finalPositions = new Map<string, { x: number; y: number }>()
      finalPositions.set(decalId, { x: node.x(), y: node.y() })

      // Companion nodes: everything in multiSelectedIds (except the dragged node itself)
      for (const id of dragStartPositionsRef.current.keys()) {
        if (id === decalId) continue
        const companionNode = konvaNodeRefs.current[id]
        if (companionNode) {
          finalPositions.set(id, { x: companionNode.x(), y: companionNode.y() })
        }
      }

      // mutate FIRST so the pending gesture snapshot (pre-gesture state) is
      // flushed onto the undo stack before endGesture clears it.
      // One mutate → one undo frame for the whole group move.
      mutate(p => {
        let next = p
        for (const [id, pos] of finalPositions) {
          next = updateCellDecal(next, id, d => ({ ...d, x: pos.x, y: pos.y }))
        }
        return next
      })
      history.endGesture()

      dragStartPositionsRef.current = new Map()
    },
    [mutate, updateCellDecal, history],
  )

  /** Snap targets used during Konva drag (canvas edges + centre + optional grid). */
  const SNAP_TARGETS: SnapTarget[] = useMemo(() => {
    const targets: SnapTarget[] = [
      { kind: 'x', value: DECAL_PACK_SIZE / 2, label: 'canvas center X' },
      { kind: 'y', value: DECAL_PACK_SIZE / 2, label: 'canvas center Y' },
      { kind: 'x', value: 0, label: 'canvas left edge' },
      { kind: 'x', value: DECAL_PACK_SIZE, label: 'canvas right edge' },
      { kind: 'y', value: 0, label: 'canvas top edge' },
      { kind: 'y', value: DECAL_PACK_SIZE, label: 'canvas bottom edge' },
    ]
    if (snapGrid) {
      for (let v = snapGridStep; v < DECAL_PACK_SIZE; v += snapGridStep) {
        targets.push({ kind: 'x', value: v, label: `grid x ${v}` })
        targets.push({ kind: 'y', value: v, label: `grid y ${v}` })
      }
    }
    return targets
  }, [snapGrid, snapGridStep])

  /**
   * Konva onDragMove handler — applies snap to the dragged node and moves all
   * companion nodes (multi-select) by the same delta. No mutate per frame
   * (undo frames only on gesture end).
   */
  const handleKonvaDragMove = useCallback(
    (decalId: string, node: Konva.Image) => {
      if (!node) return
      const { snappedX, snappedY, firedTargets } = applySnap(node.x(), node.y(), SNAP_TARGETS)
      node.x(snappedX)
      node.y(snappedY)
      setSnapGuides(firedTargets)

      // Move companion nodes by the same delta as the primary dragged node.
      const startPos = dragStartPositionsRef.current.get(decalId)
      if (startPos && dragStartPositionsRef.current.size > 1) {
        const dx = snappedX - startPos.x
        const dy = snappedY - startPos.y
        for (const [id, sPos] of dragStartPositionsRef.current) {
          if (id === decalId) continue
          const companionNode = konvaNodeRefs.current[id]
          if (companionNode) {
            companionNode.x(sPos.x + dx)
            companionNode.y(sPos.y + dy)
          }
        }
        node.getLayer()?.batchDraw()
      }
    },
    [SNAP_TARGETS],
  )

  // ── Decal manipulation ───────────────────────────────────────────────────
  const setActive = useCallback(
    (id: string) => mutate(p => setActiveCellLayerId(p, id), { undoable: false }),
    [mutate, setActiveCellLayerId],
  )

  const deleteDecal = useCallback(
    (id: string) => {
      mutate(p => {
        // Determine the current cell list for neighbour calculation.
        const curCell: Decal[] = (() => {
          if (!p.parts) return p.decals
          const part = p.parts[activePartIndex]
          if (!part) return []
          if (activeFaction !== null) return part.overrides?.[activeFaction] ?? part.shared
          return part.shared
        })()
        const idx = curCell.findIndex(d => d.id === id)
        if (idx < 0) return p
        const remaining = curCell.filter(d => d.id !== id)
        const curActiveId = p.parts ? p.parts[activePartIndex]?.activeLayerId : p.activeDecalId
        let newActiveId: string | null = curActiveId ?? null
        if (curActiveId === id) {
          const neighbour = remaining[idx] ?? remaining[idx - 1] ?? null
          newActiveId = neighbour ? neighbour.id : null
        }
        const withDeleted = mutateActiveCell(p, () => remaining)
        return setActiveCellLayerId(withDeleted, newActiveId)
      })
    },
    [mutate, mutateActiveCell, setActiveCellLayerId, activePartIndex, activeFaction],
  )

  const moveDecal = useCallback(
    (id: string, dir: -1 | 1) =>
      mutate(p =>
        mutateActiveCell(p, list => {
          const idx = list.findIndex(d => d.id === id)
          if (idx < 0) return list
          const j = idx + dir
          if (j < 0 || j >= list.length) return list
          const next = list.slice()
          ;[next[idx], next[j]] = [next[j], next[idx]]
          return next
        }),
      ),
    [mutate, mutateActiveCell],
  )

  const duplicateDecal = useCallback(
    (id: string) =>
      mutate(p => {
        let copy: Decal | null = null
        const withDup = mutateActiveCell(p, list => {
          const orig = list.find(d => d.id === id)
          if (!orig) return list
          copy = { ...orig, id: freshDecalId(), name: orig.name + ' (copy)' }
          const idx = list.findIndex(d => d.id === id)
          const next = list.slice()
          next.splice(idx + 1, 0, copy)
          return next
        })
        if (!copy) return withDup
        return setActiveCellLayerId(withDup, (copy as Decal).id)
      }),
    [mutate, mutateActiveCell, setActiveCellLayerId],
  )

  // ── Drag-to-reorder handlers (G3) ───────────────────────────────────────
  const onDecalDragStart = useCallback((id: string) => setDragDecalId(id), [])
  const onDecalDragOver = useCallback((id: string) => setDragOverId(id), [])
  const onDecalDrop = useCallback(
    (targetId: string) => {
      if (!dragDecalId || dragDecalId === targetId) {
        setDragDecalId(null)
        setDragOverId(null)
        return
      }
      mutate(p =>
        mutateActiveCell(p, list => {
          const from = list.findIndex(d => d.id === dragDecalId)
          const to = list.findIndex(d => d.id === targetId)
          if (from < 0 || to < 0) return list
          const next = list.slice()
          const [item] = next.splice(from, 1)
          next.splice(to, 0, item)
          return next
        }),
      )
      setDragDecalId(null)
      setDragOverId(null)
    },
    [dragDecalId, mutate, mutateActiveCell],
  )
  const onDecalDragEnd = useCallback(() => {
    setDragDecalId(null)
    setDragOverId(null)
  }, [])

  const updateActive = useCallback(
    (fn: (d: Decal) => Decal) => {
      if (!activeDecal) return
      mutate(p => updateCellDecal(p, activeDecal.id, fn))
    },
    [activeDecal, mutate, updateCellDecal],
  )

  // ── Draw tool: paint onto the active decal's source image ────────────────
  const beginDraw = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      if (!activeDecal) return
      ev.preventDefault()
      ev.stopPropagation()

      const rect = canvasRef.current!.getBoundingClientRect()
      const x = (ev.clientX - rect.left) / viewScale
      const y = (ev.clientY - rect.top) / viewScale

      // ── Eyedropper: one-shot colour sample from the composited decal canvas ──
      if (eyedropperActive) {
        const src = project.sourceImages[activeDecal.sourceImageId]
        if (src) {
          void loadImageForPreview(src.dataUrl).then(img => {
            const canvas = rasteriseDecal(activeDecal, img)
            const ctx = (canvas as HTMLCanvasElement).getContext
              ? (canvas as HTMLCanvasElement).getContext('2d')
              : null
            if (ctx) {
              const sampled = samplePixel(ctx, Math.round(x), Math.round(y))
              setBrushColor(sampled)
            }
          })
        }
        setEyedropperActive(false)
        return
      }

      // Capture mirror flags at stroke start.
      const snapMirrorX = mirrorX
      const snapMirrorY = mirrorY

      /** Expand a single {x,y} into all mirrored positions. */
      const mirrorPoints = (px: number, py: number) => {
        const pts = [{ x: px, y: py }]
        if (snapMirrorX) pts.push({ x: DECAL_PACK_SIZE - px, y: py })
        if (snapMirrorY) pts.push({ x: px, y: DECAL_PACK_SIZE - py })
        if (snapMirrorX && snapMirrorY)
          pts.push({ x: DECAL_PACK_SIZE - px, y: DECAL_PACK_SIZE - py })
        return pts
      }

      // Set up overlay canvas for the in-progress stroke.
      const liveCanvas = document.createElement('canvas')
      liveCanvas.width = DECAL_PACK_SIZE
      liveCanvas.height = DECAL_PACK_SIZE
      liveCanvas.style.cssText = `position:absolute;left:0;top:0;width:${DECAL_PACK_SIZE * viewScale}px;height:${DECAL_PACK_SIZE * viewScale}px;pointer-events:none;z-index:999`
      canvasRef.current!.appendChild(liveCanvas)
      liveStrokeCanvasRef.current = liveCanvas

      const lctx = liveCanvas.getContext('2d')!
      if (brushErase) {
        lctx.globalCompositeOperation = 'destination-out'
      }
      lctx.globalAlpha = brushOpacity
      lctx.strokeStyle = brushErase ? 'rgba(0,0,0,1)' : brushColor
      lctx.lineWidth = brushSize
      lctx.lineCap = 'round'
      lctx.lineJoin = 'round'
      // G1: brush softness — shadowBlur feather proportional to (1−hardness)
      const feather = (1 - brushHardness) * brushSize * 0.6
      lctx.shadowBlur = feather
      lctx.shadowColor = brushErase ? 'rgba(0,0,0,1)' : brushColor

      const startPts = mirrorPoints(x, y)
      for (const pt of startPts) {
        lctx.beginPath()
        lctx.moveTo(pt.x, pt.y)
      }
      isDrawingRef.current = true
      // Gesture-granular undo: the whole stroke = ONE undo frame.
      history.beginGesture('Paint')
      let lastPts = startPts

      const decalId = activeDecal.id

      const onMove = (mev: PointerEvent) => {
        if (!isDrawingRef.current) return
        const lc = liveStrokeCanvasRef.current
        if (!lc) return
        const mrect = canvasRef.current!.getBoundingClientRect()
        const mx = (mev.clientX - mrect.left) / viewScale
        const my = (mev.clientY - mrect.top) / viewScale
        const mc = lc.getContext('2d')!
        const newPts = mirrorPoints(mx, my)
        for (let i = 0; i < newPts.length; i++) {
          mc.beginPath()
          mc.moveTo((lastPts[i] ?? lastPts[0]).x, (lastPts[i] ?? lastPts[0]).y)
          mc.lineTo(newPts[i].x, newPts[i].y)
          mc.stroke()
        }
        lastPts = newPts
      }

      const onUp = () => {
        if (!isDrawingRef.current) return
        isDrawingRef.current = false
        history.endGesture()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)

        const lc = liveStrokeCanvasRef.current
        if (!lc) return

        // Composite the stroke onto the decal's source image dataUrl.
        const offscreen = document.createElement('canvas')
        offscreen.width = DECAL_PACK_SIZE
        offscreen.height = DECAL_PACK_SIZE
        const octx = offscreen.getContext('2d')!

        // Read the current source dataUrl from project state, then composite.
        // Look up the decal from the active cell (v6) or flat list (v5).
        setProject(prev => {
          const getCellList = (p: Coh2DecalPackProject): Decal[] => {
            if (!p.parts) return p.decals
            const part = p.parts[activePartIndex]
            if (!part) return []
            if (activeFaction !== null) return part.overrides?.[activeFaction] ?? part.shared
            return part.shared
          }
          const decal = getCellList(prev).find(d => d.id === decalId)
          const src = decal ? prev.sourceImages[decal.sourceImageId] : null
          const existingDataUrl = src?.dataUrl ?? ''

          const applyComposite = (baseDataUrl: string) => {
            if (baseDataUrl && baseDataUrl !== BLANK_PNG) {
              const existImg = new Image()
              existImg.onload = () => {
                octx.drawImage(existImg, 0, 0, DECAL_PACK_SIZE, DECAL_PACK_SIZE)
                octx.drawImage(lc, 0, 0)
                const newDataUrl = offscreen.toDataURL('image/png')
                // Update the source image dataUrl in the project.
                mutate(p => {
                  const d = getCellList(p).find(x => x.id === decalId)
                  if (!d) return p
                  const srcId = d.sourceImageId
                  const srcImg = p.sourceImages[srcId]
                  if (!srcImg) return p
                  return {
                    ...p,
                    sourceImages: {
                      ...p.sourceImages,
                      [srcId]: { ...srcImg, dataUrl: newDataUrl },
                    },
                  }
                })
                lc.remove()
                liveStrokeCanvasRef.current = null
              }
              existImg.src = baseDataUrl
            } else {
              // No prior content — start fresh with just the stroke.
              octx.drawImage(lc, 0, 0)
              const newDataUrl = offscreen.toDataURL('image/png')
              mutate(p => {
                const d = getCellList(p).find(x => x.id === decalId)
                if (!d) return p
                const srcId = d.sourceImageId
                const srcImg = p.sourceImages[srcId]
                if (!srcImg) return p
                return {
                  ...p,
                  sourceImages: {
                    ...p.sourceImages,
                    [srcId]: { ...srcImg, dataUrl: newDataUrl },
                  },
                }
              })
              lc.remove()
              liveStrokeCanvasRef.current = null
            }
          }

          applyComposite(existingDataUrl)
          return prev // no React state change here — mutate handles it async
        })
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [
      activeDecal,
      viewScale,
      brushOpacity,
      brushColor,
      brushSize,
      brushErase,
      mirrorX,
      mirrorY,
      mutate,
      history,
      activePartIndex,
      activeFaction,
    ],
  )

  // Tool definitions for the bottom pill. Export removed — Live Sync handles it automatically.
  const DECAL_TOOLS: readonly ToolDef<DecalToolId>[] = [
    { id: 'select', icon: <MousePointer2 size={20} />, label: 'Select' },
    { id: 'images', icon: <ImageIcon size={20} />, label: 'Images' },
    { id: 'transform', icon: <Move size={20} />, label: 'Transform' },
    { id: 'tint', icon: <Droplet size={20} />, label: 'Tint' },
    { id: 'draw', icon: <Pencil size={20} />, label: 'Draw' },
  ]

  // ── Shared SGA builder — used by BOTH the Publish flow and the Q6 export ──
  // Builds the exact same 15-file decal-pack SGA that Live Sync writes, via the
  // same `buildDecalMod` entry point (icon 64²×4 + per-part/faction 1024²
  // composites, or the v5 flat 1024² decalRgba fallback). Returns the build
  // result plus a natural-resolution preview canvas for the Workshop thumbnail.
  const buildDecalSgaBytes = useCallback(async (): Promise<{
    result: import('@/lib/decal-mod-build').BuildDecalModResult
    previewCanvas: HTMLCanvasElement | null
  }> => {
    const { buildDecalMod, DECAL_ICON_SIZE, DECAL_TEXTURE_SIZE } =
      await import('@/lib/decal-mod-build')
    const { deriveGuidFromId } = await import('@/lib/live-sync')

    const guid = deriveGuidFromId(project.id)

    // Render icon canvas (64×64) from the first visible decal
    const iconCanvas = document.createElement('canvas')
    iconCanvas.width = iconCanvas.height = DECAL_ICON_SIZE
    const iconCtx = iconCanvas.getContext('2d')
    // v6: icon uses the first visible layer from any part. v5: use decals[].
    const visibleDecal = project.parts
      ? project.parts.flatMap(p => p.shared).find(d => d.visible)
      : project.decals.find(d => d.visible)
    if (visibleDecal && iconCtx) {
      const src = project.sourceImages[visibleDecal.sourceImageId]
      if (src) {
        // decodeSourceImage fully decodes (and handles SVG insignia) BEFORE the
        // drawImage below, so the export can't crash with InvalidStateError.
        const img = await decodeSourceImage(src.dataUrl)
        const rendered = rasteriseDecal(visibleDecal, img)
        iconCtx.drawImage(rendered, 0, 0, DECAL_ICON_SIZE, DECAL_ICON_SIZE)
      }
    }
    const iconRgba = iconCtx
      ? iconCtx.getImageData(0, 0, DECAL_ICON_SIZE, DECAL_ICON_SIZE).data
      : new Uint8ClampedArray(DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4)

    // v6: per-part per-faction composite via partsForBake. v5: flat decalRgba.
    const { partsForBake } = await import('@/lib/atlas-parts')
    const partRgbas = await partsForBake(project)
    let decalRgba: Uint8ClampedArray | undefined
    if (!partRgbas) {
      // v5 fallback: render flat texture.
      const texCanvas = document.createElement('canvas')
      texCanvas.width = texCanvas.height = DECAL_TEXTURE_SIZE
      const texCtx = texCanvas.getContext('2d')
      if (visibleDecal && texCtx) {
        const src = project.sourceImages[visibleDecal.sourceImageId]
        if (src) {
          const img = await decodeSourceImage(src.dataUrl)
          const rendered = rasteriseDecal(visibleDecal, img)
          texCtx.drawImage(rendered, 0, 0, DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE)
        }
      }
      decalRgba = texCtx
        ? texCtx.getImageData(0, 0, DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE).data
        : new Uint8ClampedArray(DECAL_TEXTURE_SIZE * DECAL_TEXTURE_SIZE * 4)
    }

    // Build a preview canvas from the source image at natural resolution so
    // the Workshop thumbnail is sharp. Pass the raw rasteriseDecal output —
    // generateWorkshopPreview (called by PublishSection) will bbox-crop and
    // center-fit it, so we must NOT pre-pad here to avoid double-padding.
    // The 64×64 iconCanvas is kept for the pack icon and in-game DXT5
    // pipeline (unchanged).
    let previewCanvas: HTMLCanvasElement | null = null
    if (visibleDecal) {
      const src = project.sourceImages[visibleDecal.sourceImageId]
      if (src) {
        const img = await decodeSourceImage(src.dataUrl)
        // rasteriseDecal renders the decal at natural resolution with in-game
        // placement geometry — generateWorkshopPreview crops to the opaque
        // bbox and then center-fits with ~10% padding.
        const rendered = rasteriseDecal(visibleDecal, img)
        // Convert OffscreenCanvas → HTMLCanvasElement for compatibility with
        // the WorkshopPublishTarget.previewCanvas field (HTMLCanvasElement).
        const hostCanvas = document.createElement('canvas')
        hostCanvas.width = rendered.width
        hostCanvas.height = rendered.height
        const hostCtx = hostCanvas.getContext('2d')
        if (hostCtx) {
          hostCtx.drawImage(rendered as CanvasImageSource, 0, 0)
        }
        previewCanvas = hostCanvas
      }
    }

    const result = await buildDecalMod({ project, iconRgba, decalRgba, partRgbas, guid })
    return { result, previewCanvas }
  }, [project])

  // ── Publish build handler — builds SGA, then sets target for inline form ──
  const handleRequestBuild = useCallback(async () => {
    setIsBuildingTarget(true)
    try {
      const { result, previewCanvas } = await buildDecalSgaBytes()
      const target = makeDecalPublishTarget(
        project,
        result.sga,
        result.sgaFilename,
        previewCanvas,
        workshopId => {
          const next = { ...project, workshopId }
          setProject(next)
          saveDecalPackToLocal(next)
        },
      )
      setPublishTarget(target)
    } catch (e) {
      console.error('Decal pack publish build failed:', e)
    } finally {
      setIsBuildingTarget(false)
    }
  }, [project, setProject, buildDecalSgaBytes])

  // FIX 3: the manual "Export .sga" button was removed — the pack auto-syncs
  // to the game on every edit via scheduleLiveSync('decal', …) in the history
  // engine's onPersist. `buildDecalSgaBytes` above is retained for the publish
  // flow and future use.

  // Whether to show the placeholder for the active decal canvas.
  const showDecalPlaceholder =
    !activeDecal ||
    (() => {
      const src = project.sourceImages[activeDecal.sourceImageId]
      return !src || !src.dataUrl || src.dataUrl === BLANK_PNG
    })()

  // ── Q6/Q10: does the pack have ANY exportable artwork? ─────────────────────
  // A visible decal that references a real (non-blank) source image. Drives
  // the Export button's disabled state and the "blank part" warning.
  const hasExportableArtwork = useMemo(() => {
    const hasArt = (list: readonly Decal[]) =>
      list.some(d => {
        if (!d.visible) return false
        const src = project.sourceImages[d.sourceImageId]
        return !!src && !!src.dataUrl && src.dataUrl !== BLANK_PNG
      })
    if (project.parts) {
      return project.parts.some(
        part =>
          hasArt(part.shared) ||
          (part.overrides
            ? Object.values(part.overrides).some(ov => ov && hasArt(ov))
            : false),
      )
    }
    return hasArt(project.decals)
  }, [project.parts, project.decals, project.sourceImages])

  // ── Q10: non-blocking validation warnings ─────────────────────────────────
  // (a) The active decal's bounding box falls largely OUTSIDE the 128² canvas
  //     (= the badge cell; art beyond it is clipped and never reaches the tank).
  // (b) The current part/cell that WILL export has no artwork at all.
  // Advisory only — never blocks export.
  const validationWarning = useMemo<string | null>(() => {
    // (b) empty cell — only when the pack has SOME art elsewhere (a wholly
    //     empty pack is covered by the disabled Export button instead).
    const cellHasArt = cellDecals.some(d => {
      if (!d.visible) return false
      const src = project.sourceImages[d.sourceImageId]
      return !!src && !!src.dataUrl && src.dataUrl !== BLANK_PNG
    })
    if (hasExportableArtwork && !cellHasArt) {
      const label = activePartDef ? `“${activePartDef.label ?? activePartDef.name}”` : 'This slot'
      return `${label} has no artwork — it will ship an invisible badge for this surface.`
    }

    // (a) out-of-cell — check the active decal's bbox against the badge cell.
    if (activeDecal) {
      const src = project.sourceImages[activeDecal.sourceImageId]
      if (src && src.dataUrl && src.dataUrl !== BLANK_PNG) {
        const bw = src.width * activeDecal.scale
        const bh = src.height * activeDecal.scale
        const bbox = {
          x: activeDecal.x - bw / 2,
          y: activeDecal.y - bh / 2,
          w: bw,
          h: bh,
        }
        const bboxArea = bw * bh
        const inside = rectOverlapArea(bbox, BADGE_CELL_128)
        // "Largely outside" = less than 25% of the art's own area lands in the
        // cell. Near-zero overlap ⇒ the badge is effectively invisible in-game.
        if (bboxArea > 0 && inside / bboxArea < 0.25) {
          return 'This decal sits mostly outside the badge cell — it may render invisible or clipped in-game.'
        }
      }
    }
    return null
  }, [cellDecals, activeDecal, activePartDef, hasExportableArtwork, project.sourceImages])

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-10"
      style={{
        background: '#0a0b0e',
        color: 'rgba(247,247,250,0.92)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
      {...pz.handlers}
    >
      {/* Centre — zoomed 128² canvas of active decal */}
      <ImageDropZone
        ref={dropZoneRef}
        onImport={onImport}
        style={
          {
            position: 'absolute',
            inset: 0,
            // overflow:hidden clips the OOB red zone to the work area so it
            // never bleeds onto toolbars/sidebars.
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // Symmetric vertical padding so the canvas stays centred both axes
            // while clearing the bottom floating toolbar (~150px).
            paddingTop: 150,
            paddingBottom: 150,
            paddingLeft: 80,
            paddingRight: 80,
            WebkitAppRegion: 'no-drag',
            // No explicit backdrop — the editor's normal background shows in the
            // outside-bounds (OOB) region. The red OOB shade is a filtered
            // DUPLICATE of the decal image (see the ghost overlay below) whose
            // transparent areas contribute nothing, so empty margins keep the
            // normal background and only spilled decal pixels read red.
          } as CSSProperties
        }
      >
        {/* Stage ref is on the outer fixed wrapper (see above) so the
            wheel handler from usePanZoom attaches there and receives
            scroll events bubbling from the canvas. */}
        {/* Batch-import warning banner */}
        {batchWarning && (
          <button
            type="button"
            aria-label="Batch import warning — click to dismiss"
            style={{
              position: 'absolute',
              top: 90,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(200,120,0,0.88)',
              color: '#fff',
              fontSize: 11,
              padding: '6px 14px',
              borderRadius: 6,
              maxWidth: 380,
              textAlign: 'center',
              zIndex: 6,
              cursor: 'pointer',
              border: 'none',
            }}
            onClick={() => setBatchWarning(null)}
          >
            {batchWarning}
          </button>
        )}

        {/* ── Q10: non-blocking badge-cell / blank-slot validation banner ──
            Advisory caution shown when the active decal sits mostly outside
            the badge UV cell, or the current export cell has no artwork.
            Purely informational — never blocks Live Sync or Export. */}
        {validationWarning && (
          <div
            role="status"
            style={{
              position: 'absolute',
              top: batchWarning ? 128 : 90,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(200,120,0,0.88)',
              color: '#fff',
              fontSize: 11,
              lineHeight: 1.3,
              padding: '6px 14px',
              borderRadius: 6,
              maxWidth: 420,
              textAlign: 'left',
              zIndex: 6,
              pointerEvents: 'none',
            }}
          >
            <AlertTriangle size={14} strokeWidth={2.5} aria-hidden style={{ flexShrink: 0 }} />
            <span>{validationWarning}</span>
          </div>
        )}

        {/* The 128×128 decal canvas — rendered via react-konva Stage */}
        <div
          ref={canvasRef}
          style={{
            width: DECAL_PACK_SIZE * zoom,
            height: DECAL_PACK_SIZE * zoom,
            position: 'relative',
            // Pan offset: translate by pz.offset so Space/middle-drag panning moves the view.
            transform: `translate(${pz.offset.x}px, ${pz.offset.y}px)`,
            // Dark canvas surface — #1a1c22 is one step lighter than the editor
            // base (#0a0b0e) so the 128² working area reads as a distinct canvas
            // against the surrounding dark negative space. The dark checker
            // pattern is layered on top to indicate transparency (alpha=0 in
            // the actual decal export).  Transparent-preview mode uses the
            // classic light Photoshop checker so alpha=0 regions read clearly.
            backgroundColor: previewTransparent ? '#ffffff' : '#1a1c22',
            backgroundImage: previewTransparent ? lightCheckerBackground() : darkCheckerBackground(),
            backgroundSize: previewTransparent ? '16px 16px' : '16px 16px',
            // v1.0 polish: sharp corners on the decal frame. CoH2 decals are
            // rasterised to square 128×128 textures and the in-game preview
            // shows them as crisp squares — the editor frame should match
            // that physicality rather than softening the silhouette with a
            // 6px rounded edge that doesn't appear anywhere in the game.
            borderRadius: 0,
            // No hairline border — the red OOB tint and drop shadow define the edge.
            // Removed '0 0 0 1px rgba(255,255,255,0.06)' hairline ring.
            boxShadow:
              '0 24px 80px -20px rgba(0,0,0,0.6), 0 0 0 6px rgba(0,0,0,0.35)',
            cursor: activeTool === 'draw' ? 'crosshair' : 'default',
            overflow: 'visible',
            touchAction: 'none',
          }}
        >
          {/* Canvas placeholder when no active decal or decal has no image. */}
          {showDecalPlaceholder && (
            <CanvasPlaceholder width={DECAL_PACK_SIZE} height={DECAL_PACK_SIZE} />
          )}

          {/* Default-view underlay — shows the composited default slot reference
              behind the user's layers so they can compare against the stock decal.
              Only rendered when viewMode === 'checkerboard' (now "Default view"). */}
          {showDefaultUnderlay && refPreviewDataUrl && (
            <img
              src={refPreviewDataUrl}
              alt=""
              aria-hidden
              draggable={false}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                imageRendering: 'pixelated',
                opacity: 0.55,
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
          )}

          {/* Konva Stage — replaces the old absolutely-positioned CSS <img>.
              Stage is scaled via scaleX/scaleY from viewScale so all Decal
              coordinates (in 128-unit canvas space) work unchanged.
              In draw mode, Stage has pointerEvents:none so the draw overlay
              captures pointer events directly. */}
          <Stage
            ref={konvaStageRef}
            width={canvasRect ? canvasRect.width : DECAL_PACK_SIZE * zoom}
            height={canvasRect ? canvasRect.height : DECAL_PACK_SIZE * zoom}
            scaleX={viewScale}
            scaleY={viewScale}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              pointerEvents: activeTool === 'draw' ? 'none' : 'auto',
            }}
            onPointerDown={e => {
              if (activeTool === 'draw') return
              // Click on empty stage area → deselect all
              if (e.target === e.target.getStage()) {
                mutate(p => setActiveCellLayerId(p, null), { undoable: false })
                setMultiSelectedIds(new Set())
                attachTransformerToIds([])
              }
            }}
          >
            <Layer>
              {cellDecals
                .filter(d => d.visible)
                .map(d => {
                  const src = project.sourceImages[d.sourceImageId]
                  if (!src) return null
                  const img = konvaImages[d.sourceImageId]
                  const imgW = img ? img.naturalWidth : src.width
                  const imgH = img ? img.naturalHeight : src.height
                  const scaleX = d.flipH ? -d.scale : d.scale
                  const scaleY = d.flipV ? -d.scale : d.scale
                  const isSelected = d.id === cellActiveLayerId || multiSelectedIds.has(d.id)
                  const isLocked = !!d.locked?.position
                  return (
                    <KonvaImage
                      key={d.id}
                      ref={el => {
                        konvaNodeRefs.current[d.id] = el
                      }}
                      image={img}
                      x={d.x}
                      y={d.y}
                      // offsetX/Y centre the decal on x/y (Decal convention = centre origin)
                      offsetX={imgW / 2}
                      offsetY={imgH / 2}
                      scaleX={scaleX}
                      scaleY={scaleY}
                      rotation={d.rotation}
                      opacity={d.opacity}
                      globalCompositeOperation={
                        (d.blendMode as GlobalCompositeOperation | undefined) ?? 'source-over'
                      }
                      visible={d.visible}
                      // Drag enabled for non-locked decals in select/transform mode.
                      draggable={activeTool !== 'draw' && !isLocked}
                      onPointerDown={e => {
                        if (activeTool === 'draw') return
                        const evt = e.evt as PointerEvent
                        if (evt.ctrlKey || evt.metaKey) {
                          // Ctrl/Cmd+click: toggle this decal in multi-select
                          setMultiSelectedIds(prev => {
                            const next = new Set(prev)
                            if (next.has(d.id)) next.delete(d.id)
                            else next.add(d.id)
                            return next
                          })
                        } else {
                          // Plain click: set as sole active, clear multi-select
                          setActive(d.id)
                          setMultiSelectedIds(new Set())
                        }
                      }}
                      onDragStart={() => {
                        history.beginGesture('Move decal')
                        // Capture start positions for ALL selected nodes (dragged + companions).
                        const starts = new Map<string, { x: number; y: number }>()
                        const selfNode = konvaNodeRefs.current[d.id]
                        if (selfNode) starts.set(d.id, { x: selfNode.x(), y: selfNode.y() })
                        // Add companion nodes from multiSelectedIds.
                        const companions = d.id === cellActiveLayerId
                          ? multiSelectedIds
                          : new Set([...(cellActiveLayerId ? [cellActiveLayerId] : []), ...multiSelectedIds])
                        for (const id of companions) {
                          if (id === d.id) continue
                          const companionNode = konvaNodeRefs.current[id]
                          if (companionNode) starts.set(id, { x: companionNode.x(), y: companionNode.y() })
                        }
                        dragStartPositionsRef.current = starts
                      }}
                      onDragMove={e => {
                        const node = e.target as Konva.Image
                        handleKonvaDragMove(d.id, node)
                      }}
                      onDragEnd={e => {
                        const node = e.target as Konva.Image
                        handleKonvaDragEnd(d.id, node)
                      }}
                      onTransformStart={() => {
                        history.beginGesture('Transform decal')
                      }}
                      onTransformEnd={() => {
                        handleKonvaTransformEnd(d.id)
                      }}
                      stroke={isSelected ? 'rgba(80,160,255,0.7)' : undefined}
                      strokeWidth={isSelected ? 0.5 / viewScale : 0}
                    />
                  )
                })}
              {/* Konva Transformer — selection handles on active decal */}
              <Transformer
                ref={transformerRef}
                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                keepRatio={false}
                rotateEnabled
                visible={activeTool !== 'draw'}
                borderStroke="rgba(80,160,255,0.85)"
                anchorStroke="rgba(80,160,255,0.85)"
                anchorFill="rgba(255,255,255,0.9)"
                anchorSize={8 / viewScale}
                borderDashArray={[4 / viewScale, 2 / viewScale]}
              />
            </Layer>
          </Stage>

          {/* Draw-tool canvas overlay — active only while Draw tool is selected.
              Pointer events are captured here; Stage has pointerEvents:none in draw mode. */}
          {activeTool === 'draw' && (
            <div
              onPointerDown={beginDraw}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 10,
                cursor: 'crosshair',
              }}
            />
          )}

          {/* Out-of-bounds red shade (deterministic — no blend modes).
              A non-interactive, red-tinted DUPLICATE of the decal image,
              clipped to the region OUTSIDE the canvas bins. CSS `filter`
              respects source alpha, so transparent/empty areas contribute
              nothing: the black work-area backdrop shows through (NO red when
              nothing spills out of bounds). Only opaque decal pixels that
              extend past the canvas edge receive the red shade.

              NOTE: geometry mirrors the interactive decal render above — keep
              the two in sync if the decal positioning changes. */}
          {activeDecal &&
            (() => {
              const src = project.sourceImages[activeDecal.sourceImageId]
              if (!src) return null
              const baseW = src.width * activeDecal.scale * viewScale
              const baseH = src.height * activeDecal.scale * viewScale
              const cx = activeDecal.x * viewScale
              const cy = activeDecal.y * viewScale
              const sx = activeDecal.flipH ? -1 : 1
              const sy = activeDecal.flipV ? -1 : 1
              const brightness = activeDecal.brightness ?? 100
              const contrast = activeDecal.contrast ?? 100
              const saturation = activeDecal.saturation ?? 100
              const hueRotate = activeDecal.hueRotate ?? 0
              const hasAdj = brightness !== 100 || contrast !== 100 || saturation !== 100 || hueRotate !== 0
              const innerFilter = hasAdj
                ? `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hueRotate}deg)`
                : undefined
              return (
                <>
                {/* Red-tint colour matrix (preserves alpha; maps content to a
                    luminance-shaded RED — CSS sepia+hue-rotate drifted orange). */}
                <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden focusable={false}>
                  {/* filterUnits="userSpaceOnUse" + large explicit region so content
                      that overflows the overlay div's own bounds (decals dragged far
                      outside the canvas edge) still receives the red-tint matrix.
                      The default objectBoundingBox region (±10%) only covers a small
                      margin and clips heavily-OOB content. */}
                  <filter id="oob-red-tint" colorInterpolationFilters="sRGB"
                    filterUnits="userSpaceOnUse"
                    x="-2000" y="-2000" width="6000" height="6000">
                    <feColorMatrix
                      type="matrix"
                      values="0.45 0.45 0.45 0 0.28
                              0.05 0.05 0.05 0 0
                              0.05 0.05 0.05 0 0
                              0    0    0    1 0"
                    />
                  </filter>
                </svg>
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'visible',
                    pointerEvents: 'none',
                    opacity: 1,
                    // Recolour spilled decal pixels to a red shade; a no-op on
                    // transparent pixels, keeping empty margins on the normal bg.
                    filter: 'url(#oob-red-tint)',
                    // Donut clip: reveal OUTSIDE the bins, hide inside. Coords
                    // are in this overlay's box space; the box is inset:0 so it
                    // coincides with the canvas bins (0,0)–(S,S).
                    clipPath: `polygon(evenodd, -9999px -9999px, 9999px -9999px, 9999px 9999px, -9999px 9999px, -9999px -9999px, 0px 0px, ${DECAL_PACK_SIZE * zoom}px 0px, ${DECAL_PACK_SIZE * zoom}px ${DECAL_PACK_SIZE * zoom}px, 0px ${DECAL_PACK_SIZE * zoom}px, 0px 0px)`,
                  }}
                >
                  <img
                    src={src.dataUrl}
                    alt=""
                    draggable={false}
                    style={{
                      position: 'absolute',
                      left: cx,
                      top: cy,
                      width: baseW,
                      height: baseH,
                      transform: `translate(-50%, -50%) rotate(${activeDecal.rotation}deg) scale(${sx}, ${sy})`,
                      transformOrigin: '50% 50%',
                      opacity: activeDecal.opacity,
                      filter: innerFilter,
                    }}
                  />
                </div>
                </>
              )
            })()}

          {/* Mirror axis guide lines — visible only while Draw tool is active */}
          {activeTool === 'draw' && mirrorX && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                width: 1,
                height: '100%',
                background: 'rgba(186,150,90,0.4)',
                pointerEvents: 'none',
                zIndex: 998,
              }}
            />
          )}
          {activeTool === 'draw' && mirrorY && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: '50%',
                width: '100%',
                height: 1,
                background: 'rgba(186,150,90,0.4)',
                pointerEvents: 'none',
                zIndex: 998,
              }}
            />
          )}

          {/* Smart-snap alignment guides — visible while a decal is being dragged */}
          {snapGuides.map((g, i) =>
            g.kind === 'x' ? (
              <div
                key={`snapx-${i}`}
                style={{
                  position: 'absolute',
                  left: `${(g.value / DECAL_PACK_SIZE) * 100}%`,
                  top: 0,
                  width: 1,
                  height: '100%',
                  background: 'rgba(186,150,90,0.85)',
                  pointerEvents: 'none',
                  zIndex: 1000,
                }}
              />
            ) : (
              <div
                key={`snapy-${i}`}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: `${(g.value / DECAL_PACK_SIZE) * 100}%`,
                  width: '100%',
                  height: 1,
                  background: 'rgba(186,150,90,0.85)',
                  pointerEvents: 'none',
                  zIndex: 1000,
                }}
              />
            ),
          )}

          {/* Centre crosshair (subtle reference for the 128² bullseye) */}
          {activeDecal && (
            <svg
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                opacity: 0.18,
                zIndex: 2,
              }}
              viewBox={`0 0 ${DECAL_PACK_SIZE} ${DECAL_PACK_SIZE}`}
            >
              <line
                x1={DECAL_PACK_SIZE / 2}
                y1={0}
                x2={DECAL_PACK_SIZE / 2}
                y2={DECAL_PACK_SIZE}
                stroke="white"
                strokeWidth="0.5"
                strokeDasharray="2 4"
              />
              <line
                x1={0}
                y1={DECAL_PACK_SIZE / 2}
                x2={DECAL_PACK_SIZE}
                y2={DECAL_PACK_SIZE / 2}
                stroke="white"
                strokeWidth="0.5"
                strokeDasharray="2 4"
              />
            </svg>
          )}

          {/* Konva Transformer handles are rendered inside the Stage above */}
        </div>
      </ImageDropZone>

      {/* ── S5: Default-slot reference preview panel ──────────────────────
          Fixed panel to the right of the viewport. Shows the composited
          result of the active part's shared layers at 128×128 (the same
          size the engine exports each decal slot to). Non-interactive —
          does not affect editing, undo, or export.
          Only rendered when at least one visible layer exists (refPreviewDataUrl
          non-null), so it stays out of the way for empty slots. */}
      {refPreviewDataUrl && (
        <div
          aria-label="Default slot preview"
          className="l01-ring"
          style={{
            position: 'fixed',
            right: 20,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 38,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '8px 8px 10px',
            background: 'rgba(20,20,20,0.72)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            borderRadius: 10,
            pointerEvents: 'none',
            userSelect: 'none',
          } as CSSProperties}
        >
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'slashed-zero',
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.38)',
            textTransform: 'uppercase',
          }}>
            Preview
          </span>
          <img
            src={refPreviewDataUrl}
            alt="Slot composite preview"
            width={DECAL_PACK_SIZE}
            height={DECAL_PACK_SIZE}
            style={{
              display: 'block',
              width: DECAL_PACK_SIZE,
              height: DECAL_PACK_SIZE,
              imageRendering: 'pixelated',
              borderRadius: 2,
              background: 'repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, transparent 0% 50%) 0 0 / 12px 12px',
            }}
          />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          Floating chrome.
          1. Home button — top-left.
          2. Inline Adjust popover — when a decal is selected.
          3. Horizontal decal strip — docked above the bottom pill.
          4. Decal strip context menu.
          5. BottomToolPill + ToolOptionsPeel — bottom-centre.
          ───────────────────────────────────────────────────────────── */}

      {/* ── Home + Undo/Redo cluster — top-left ──────────────────────── */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(12px + var(--app-top-inset, 0px))',
          left: 12,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        } as CSSProperties}
      >
        <EditorHomeButton onClick={onBack} />
        {/* Shared Undo/Redo control (R1) — one consistent affordance across
            all three editors. Redo hint reflects this editor's actual
            shortcut (Ctrl+Shift+Z, also Ctrl+Y). */}
        <UndoRedoBar
          canUndo={history.canUndo()}
          canRedo={history.canRedo()}
          onUndo={undo}
          onRedo={redo}
          redoLabel="Redo (Ctrl+Shift+Z)"
        />
        {/* FIX 3: manual "Export .sga" button removed — the pack auto-syncs to
            the game on every edit. Keyboard shortcuts still open via F1. */}
      </div>

      {/* ── Keyboard shortcuts overlay (G2) ────────────────────────────── */}
      <KeyboardShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* ── Centered pack-name title pill — top-centre of viewport ──────────
          Extracted to EditorTitlePill; mirrors FaceplateEditor and TopBar
          (vehicle editor) patterns. Click opens PackIdentityPopover with
          name / description / author / icon and publish controls. */}
      <EditorTitlePill
        packName={project.packName}
        fallbackLabel="Unnamed Decal Pack"
        syncState={sync.state}
        liveSyncTitle={liveSyncTitle}
        liveSyncAriaLabel={liveSyncAriaLabel}
        titleAcknowledged={project.titleAcknowledged}
        onAcknowledge={() => mutate(p => ({ ...p, titleAcknowledged: true }), { undoable: false })}
        onToggle={() => setPackNameEditOpen(v => !v)}
        popoverOpen={packNameEditOpen}
        publishError={publishError}
        popoverContent={
          <PackIdentityPopover
            open={packNameEditOpen}
            onClose={() => {
              setPackNameEditOpen(false)
              setPublishTarget(null)
            }}
            name={project.packName}
            description={project.packDescription}
            author={project.author}
            onSave={({ name, description, author }) => {
              mutate(
                p => ({
                  ...p,
                  packName: name.trim() || p.packName,
                  packDescription: description,
                  author: author.trim() || p.author,
                }),
                { undoable: false },
              )
            }}
            iconSlot={{
              label: 'Pack icon',
              currentDataUrl: project.packIcon ?? null,
              fallbackHint: 'No icon set — engine uses first decal',
              onChange: next => {
                mutate(p => ({ ...p, packIcon: next ?? undefined }), { undoable: false })
              },
              sizePx: 64,
            }}
            extraSection={
              <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.38)',
                    lineHeight: 1.45,
                  }}
                >
                  Name and Description are the in-game fields — shown above the
                  decal grid and on the equip card in CoH2.
                </p>
              </div>
            }
            publishSection={
              <PublishSection
                target={publishTarget}
                isBuildingTarget={isBuildingTarget}
                onRequestBuild={handleRequestBuild}
                onUploadStart={() => setIsUploading(true)}
                onUploadEnd={() => setIsUploading(false)}
                onPublishError={(msg) => {
                  setPublishError(msg)
                  setTimeout(() => setPublishError(null), 8000)
                }}
                initialVisibility={project.workshopVisibility}
                onPublished={(visibility) => {
                  mutate(p => ({ ...p, workshopVisibility: visibility }), { undoable: false })
                }}
              />
            }
            locked={isUploading || isBuildingTarget}
          />
        }
      />

      {/* Atlas part + faction controls — shown only for v6 projects.
          R3: casual makers see just the current surface ("Main badge") + an
          "Advanced placement ▸" toggle. The part stepper, faction row, override
          banner and parts×factions matrix all live INSIDE the collapsed
          disclosure so the UV-atlas mental model isn't exposed up-front. Every
          part/faction remains reachable once the disclosure is opened. */}
      {project.parts && (
        <div
          style={{
            position: 'fixed',
            top: 56,           // below title pill (~44px) + 12px margin
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 45,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {/* Always-visible summary: which surface you're designing. Defaults to
              "Main badge" (activePartIndex = 1). Doubles as the advanced toggle. */}
          <button
            type="button"
            onClick={() => setShowAdvancedPlacement(v => !v)}
            aria-expanded={showAdvancedPlacement}
            title="Show advanced placement controls (parts, factions and overrides)"
            className="l01-ring"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 12px',
              background: 'rgba(20,20,20,0.72)',
              border: '0.5px solid rgba(255,255,255,0.10)',
              borderRadius: 8,
              backdropFilter: 'blur(20px) saturate(160%)',
              WebkitBackdropFilter: 'blur(20px) saturate(160%)',
              color: 'rgba(255,255,255,0.75)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'slashed-zero',
              fontSize: 12,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ opacity: 0.5, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Designing
            </span>
            <span style={{ fontWeight: 500 }}>
              {atlasPartLabel(activePartIndex) || 'Main badge'}
              {activeFaction !== null && ` · ${FACTION_LABELS[activeFaction as Faction]}`}
            </span>
            <span
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.5)',
                transform: showAdvancedPlacement ? 'rotate(90deg)' : 'none',
                transition: 'transform 150ms',
                display: 'inline-block',
              }}
            >
              {'▸'}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              Advanced placement
            </span>
          </button>

          {showAdvancedPlacement && (
          <>
          <PartStepper
            activeIndex={activePartIndex}
            onChange={setActivePartIndex}
          />
          <FactionRow
            activeFaction={activeFaction}
            onChange={setActiveFaction}
          />
          {/* D2 fix: faction override context banner — makes it clear when the
              user is editing a faction-specific override vs the shared layers. */}
          {activeFaction !== null && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 12px',
                background: `${FACTION_COLORS[activeFaction as Faction]}22`,
                border: `1px solid ${FACTION_COLORS[activeFaction as Faction]}55`,
                borderRadius: 8,
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'slashed-zero',
                fontSize: 11,
                color: FACTION_COLORS[activeFaction as Faction],
                backdropFilter: 'blur(8px)',
                whiteSpace: 'nowrap',
              }}
            >
              <span>Editing {FACTION_LABELS[activeFaction as Faction]} override — shared layers still apply</span>
              <button
                type="button"
                onClick={() => {
                  // Copy shared layers into this faction's override
                  mutate(prev => {
                    if (!prev.parts) return prev
                    const updatedParts = prev.parts.map(part => {
                      const sharedCopy = [...(part.shared ?? [])]
                      return {
                        ...part,
                        overrides: {
                          ...(part.overrides ?? {}),
                          [activeFaction]: sharedCopy,
                        },
                      }
                    })
                    return { ...prev, parts: updatedParts }
                  }, { undoable: true })
                }}
                style={{
                  padding: '2px 8px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '0.5px solid rgba(255,255,255,0.15)',
                  borderRadius: 5,
                  color: 'rgba(255,255,255,0.55)',
                  fontSize: 10,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                title="Copy shared layers into this faction's override — replaces any existing override layers"
              >
                Copy shared →
              </button>
              <button
                type="button"
                onClick={() => setActiveFaction(null)}
                style={{
                  padding: '2px 8px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '0.5px solid rgba(255,255,255,0.15)',
                  borderRadius: 5,
                  color: 'rgba(255,255,255,0.55)',
                  fontSize: 10,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                title="Return to editing shared layers"
              >
                ← Back to shared
              </button>
            </div>
          )}
          <button
            onClick={() => setShowPartMatrix(v => !v)}
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.5)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {showPartMatrix ? 'Hide matrix' : 'Show parts \u00d7 factions'}
          </button>
          {showPartMatrix && (
            <div
              className="l01-ring"
              style={{
                position: 'relative',
                background: 'rgba(22,22,22,0.88)',
                border: '0.5px solid rgba(255,255,255,0.10)',
                borderRadius: 12,
                padding: 12,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              }}
            >
              <FactionPartMatrix
                project={project}
                activePart={activePartIndex}
                activeFaction={activeFaction}
                onSelect={(pi, faction) => {
                  setActivePartIndex(pi)
                  setActiveFaction(faction)
                  setShowPartMatrix(false)
                }}
              />
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* LobbyPreviewPanel was removed in v1.0 — the in-editor player-card
          mock didn't accurately match what the player sees in the CoH2
          customisation screen (the engine renders the decal against a
          different chip layout + lighting than our mock), so it gave the
          user a false impression of the final look. The DecalPackInGamePreview
          (separate component, accurate to the customisation screen) and the
          live canvas at 128×128 native size are now the source-of-truth
          previews. */}

      {/* ── Shared Layers panel (Phase 1) — replaces the bespoke decal strip ── */}
      {/* Uses cellDecals (active part/faction cell) for v6, project.decals for v5 */}
      <LayersPanel<Decal>
        project={syntheticProject}
        selectedId={cellActiveLayerId}
        multiSelectedIds={multiSelectedIds}
        renamingLayerId={renamingDecalId}
        dragLayerId={dragDecalId}
        dragOverLayerId={dragOverId}
        mutate={mutateForPanel}
        onSelectLayer={(id, multi) => {
          if (!id) {
            mutate(p => setActiveCellLayerId(p, null), { undoable: false })
            setMultiSelectedIds(new Set())
            return
          }
          if (multi) {
            setMultiSelectedIds(prev => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          } else {
            setActive(id)
            setMultiSelectedIds(new Set())
            setDecalCtxMenu(null)
          }
        }}
        onStartRename={id => { setActive(id); setRenamingDecalId(id) }}
        onEndRename={(id, newName) => {
          if (newName) mutate(p => updateCellDecal(p, id, d => ({ ...d, name: newName })))
          setRenamingDecalId(null)
        }}
        onDragStart={onDecalDragStart}
        onDragOver={onDecalDragOver}
        onDrop={onDecalDrop}
        onDragEnd={onDecalDragEnd}
        getLayerLabel={decal => decal.name}
        getLayerThumbnail={decal => {
          const src = project.sourceImages[decal.sourceImageId]
          return src ? (
            <img
              src={src.dataUrl}
              alt=""
              style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 3 }}
            />
          ) : (
            <span style={{ fontSize: 10 }}>?</span>
          )
        }}
        onContextMenu={(id, x, y) => setDecalCtxMenu({ id, x, y })}
        onClickOutside={() => setDecalCtxMenu(null)}
      />

      {/* ── Shared Properties panel (Phase 1) — right side ── */}
      {/* layerTypeControls: draw-tool source-image extension (empty for now;
          the draw controls stay in the bottom ToolOptionsPeel) */}
      <PropertiesPanel<Decal>
        project={syntheticProject}
        selectedLayer={activeDecal}
        multiSelectedIds={multiSelectedIds}
        mutate={mutateForPanel}
        canvasW={activePartDef?.region.w ?? DECAL_PACK_SIZE}
        canvasH={activePartDef?.region.h ?? DECAL_PACK_SIZE}
      />

      {/* Decal strip context menu */}
      {decalCtxMenu &&
        (() => {
          const decal = cellDecals.find(d => d.id === decalCtxMenu.id)
          if (!decal) return null
          return (
            <div
              className="l01-ring"
              style={{
                position: 'fixed',
                left: decalCtxMenu.x,
                top: decalCtxMenu.y,
                zIndex: 200,
                background: 'rgba(20,20,20,0.96)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                padding: '4px 0',
                minWidth: 140,
              }}
              onMouseLeave={() => setDecalCtxMenu(null)}
            >
              {(
                [
                  [
                    decal.visible ? 'Hide' : 'Show',
                    () => {
                      mutate(p => updateCellDecal(p, decal.id, d => ({ ...d, visible: !d.visible })))
                      setDecalCtxMenu(null)
                    },
                  ],
                  [
                    'Duplicate',
                    () => {
                      duplicateDecal(decal.id)
                      setDecalCtxMenu(null)
                    },
                  ],
                  [
                    'Delete',
                    () => {
                      deleteDecal(decal.id)
                      setDecalCtxMenu(null)
                    },
                  ],
                ] as [string, () => void][]
              ).map(([label, action]) => (
                <button
                  key={label}
                  onClick={action}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '6px 14px',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: label === 'Delete' ? '#f87171' : EDITOR_TEXT_2,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )
        })()}

      {/* Bottom tool surface — top row holds the tool-options peel on the
       *  LEFT and the Live Sync status badge on the RIGHT. Bottom row is
       *  the BottomToolPill with eye-preview as an "extras" segment.
       *  `key={activeTool}` on the peel ensures full remount on tool
       *  switch, preventing bleed-through overlap. */}
      <div
        style={
          {
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 8,
            zIndex: 40,
            WebkitAppRegion: 'no-drag',
            maxWidth: 'calc(100vw - 40px)',
          } as CSSProperties
        }
      >
        {/* Top row — tool-options peel. (The Live Sync badge that once sat to
            its right was removed; sync state now lives in the EditorTitlePill.) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <ToolOptionsPeel
            key={activeTool}
            activeId={activeTool === 'select' ? null : activeTool}
            label={decalToolLabel(activeTool)}
          >
            <DecalToolPeelBody
              tool={activeTool}
              project={project}
              activeDecal={activeDecal}
              mutate={mutate}
              setActive={setActive}
              onAddImageFiles={onAddImageFiles}
              onAddImageToCanvas={onAddImageToCanvas}
              onBatchImport={() => void onBatchImport()}
              onInsigniaOpen={() => setInsigniaOpen(true)}
              onMoveDecal={moveDecal}
              onDeleteDecal={deleteDecal}
              onDuplicateDecal={duplicateDecal}
              onUpdateActive={updateActive}
              brushSize={brushSize}
              setBrushSize={setBrushSize}
              brushColor={brushColor}
              setBrushColor={setBrushColor}
              brushOpacity={brushOpacity}
              setBrushOpacity={setBrushOpacity}
              brushErase={brushErase}
              setBrushErase={setBrushErase}
              eyedropperActive={eyedropperActive}
              setEyedropperActive={setEyedropperActive}
              mirrorX={mirrorX}
              setMirrorX={setMirrorX}
              mirrorY={mirrorY}
              setMirrorY={setMirrorY}
              brushHardness={brushHardness}
              setBrushHardness={setBrushHardness}
              nudgeStep={nudgeStep}
              setNudgeStep={setNudgeStep}
              snapGrid={snapGrid}
              setSnapGrid={setSnapGrid}
              snapGridStep={snapGridStep}
              setSnapGridStep={setSnapGridStep}
              renamingDecalId={renamingDecalId}
              setRenamingDecalId={setRenamingDecalId}
              onClearPaint={() => {
                if (!activeDecal) return
                const decalId = activeDecal.id
                mutate(p => {
                  // Look in the active cell (v6) or flat list (v5).
                  const getCellList = (proj: Coh2DecalPackProject): Decal[] => {
                    if (!proj.parts) return proj.decals
                    const part = proj.parts[activePartIndex]
                    if (!part) return []
                    if (activeFaction !== null) return part.overrides?.[activeFaction] ?? part.shared
                    return part.shared
                  }
                  const d = getCellList(p).find(x => x.id === decalId)
                  if (!d) return p
                  const srcId = d.sourceImageId
                  const srcImg = p.sourceImages[srcId]
                  if (!srcImg) return p
                  return {
                    ...p,
                    sourceImages: {
                      ...p.sourceImages,
                      [srcId]: { ...srcImg, dataUrl: BLANK_PNG },
                    },
                  }
                })
              }}
            />
          </ToolOptionsPeel>
        </div>
        {/* Bottom row — the tool pill. The alpha-preview Eye toggle that
         *  used to live here is now a segment of the right-edge
         *  AtlasViewPanel ('checkerboard' mode), alongside the new
         *  in-game preview mode. */}
        <BottomToolPill<DecalToolId>
          tools={DECAL_TOOLS}
          activeId={activeTool}
          onSelect={setActiveTool}
          extras={[
            {
              id: 'grid-snap',
              icon: <Grid size={20} />,
              label: 'Snap',
              title: snapGrid ? `Grid snap ON (${snapGridStep}px)` : 'Grid snap off',
              pressed: snapGrid,
              onClick: () => setSnapGrid(v => !v),
              testId: 'dc-grid-snap-toggle',
            },
          ]}
        />
      </div>

      {/* ── Zoom % readout pill — bottom-right corner ─────────────────────
          Shows the current zoom percentage. "Fit" resets to the default
          4× and "1:1" snaps to 100% (exact pixels). */}
      <div
        className="l01-ring"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 80,
          zIndex: 40,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          height: 32,
          padding: '0 10px',
          borderRadius: 10,
          background: 'rgba(20,20,20,0.68)',
          backdropFilter: 'blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'blur(40px) saturate(150%)',
          border: '0.5px solid rgba(255,255,255,0.10)',
          boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
          WebkitAppRegion: 'no-drag',
        } as CSSProperties}
      >
        {/* Zoom percentage label */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 500,
            fontVariantNumeric: 'slashed-zero tabular-nums',
            color: EDITOR_TEXT_2,
            minWidth: 36,
            textAlign: 'right',
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        {/* Hairline divider */}
        <span aria-hidden style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.10)', flexShrink: 0 }} />
        {/* Fit button — fits canvas to the available viewport (Ctrl+0) */}
        <button
          type="button"
          title="Fit to window (Ctrl+0)"
          aria-label="Fit zoom"
          onClick={() => {
            // Compute fit scale from the stage area size (~container minus padding)
            const el = stageRef.current
            if (!el) { pz.setScale(4); return }
            const { width: cw, height: ch } = el.getBoundingClientRect()
            // Subtract the fixed padding so the canvas fits inside the padded area
            const availW = Math.max(100, cw - 160)
            const availH = Math.max(100, ch - 300)
            const { scale: ns } = fitScale(availW, availH, DECAL_PACK_SIZE, DECAL_PACK_SIZE)
            pz.setScale(ns)
          }}
          className="hover:text-white active:scale-95 focus:outline-none"
          style={{
            padding: '0 5px',
            height: 22,
            borderRadius: 5,
            border: 'none',
            background: 'transparent',
            color: EDITOR_TEXT_4,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.04em',
            cursor: 'pointer',
          } as CSSProperties}
        >
          Fit
        </button>
        {/* 1:1 button — snaps to 100% (Ctrl+1) */}
        <button
          type="button"
          title="Actual size (100%) (Ctrl+1)"
          aria-label="100% zoom"
          onClick={() => pz.setScale(1)}
          className="hover:text-white active:scale-95 focus:outline-none"
          style={{
            padding: '0 5px',
            height: 22,
            borderRadius: 5,
            border: 'none',
            background: 'transparent',
            color: EDITOR_TEXT_4,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.04em',
            cursor: 'pointer',
          } as CSSProperties}
        >
          1:1
        </button>
      </div>

      {/* Canvas view-mode picker — right-edge vertical stack. Mirrors the
       *  Vehicle Viewport's ScenePanel and FaceplateEditor's AtlasViewPanel
       *  so all three editor surfaces share the same control.
       *  `in_game` mode has been removed from the order. */}
      <AtlasViewPanel mode={viewMode} setMode={setViewMode} ariaLabel="Decal pack view mode" />

      {/* Insignia library modal */}
      {insigniaOpen && (
        <GlassModal title="Insignia Library" onClose={() => setInsigniaOpen(false)}>
          {/* Faction filter chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {([null, 'allies', 'soviet', 'axis-oh', 'axis-okw', 'generic'] as const).map(f => (
              <button
                key={f ?? 'all'}
                onClick={() => setInsigniaFilter(f)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 12,
                  border:
                    insigniaFilter === f
                      ? '1px solid rgba(255,255,255,0.5)'
                      : '1px solid rgba(255,255,255,0.12)',
                  background:
                    insigniaFilter === f ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                  color: 'rgba(247,247,250,0.85)',
                  fontSize: 11,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {f ?? 'All'}
              </button>
            ))}
          </div>
          {/* Insignia grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
              gap: 8,
              maxHeight: 360,
              overflowY: 'auto',
            }}
          >
            {INSIGNIA_LIBRARY.filter(
              e => insigniaFilter === null || e.faction === insigniaFilter,
            ).map(insignia => (
              <button
                key={insignia.id}
                title={insignia.name}
                onClick={async () => {
                  try {
                    const res = await fetch(insignia.url)
                    const blob = await res.blob()
                    const draft = structuredClone(project)
                    const imageId = await addDecalSourceImageFromBlob(draft, blob, insignia.name)
                    const decal: Decal = newDecal(draft, imageId, insignia.name)
                    mutate(p => {
                      if (p.parts) {
                        // v6: append to active part's shared or override layers.
                        const parts = p.parts.map((part, i) => {
                          if (i !== activePartIndex) return part
                          if (activeFaction && part.overrides) {
                            const existing = part.overrides[activeFaction] ?? []
                            return { ...part, overrides: { ...part.overrides, [activeFaction]: [...existing, decal] }, activeLayerId: decal.id }
                          }
                          return { ...part, shared: [...part.shared, decal], activeLayerId: decal.id }
                        })
                        return { ...p, sourceImages: { ...p.sourceImages, ...draft.sourceImages }, parts, decals: [...p.decals, decal] }
                      }
                      // v5 fallback:
                      return { ...p, sourceImages: { ...p.sourceImages, ...draft.sourceImages }, decals: [...p.decals, decal], activeDecalId: decal.id }
                    })
                    setInsigniaOpen(false)
                  } catch (e) {
                    console.warn('insignia import failed', e)
                  }
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: 6,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                <img
                  src={insignia.url}
                  alt={insignia.name}
                  style={{ width: 36, height: 36, objectFit: 'contain', filter: 'invert(1)' }}
                />
                <span
                  style={{
                    fontSize: 9,
                    color: 'rgba(247,247,250,0.6)',
                    textAlign: 'center',
                    lineHeight: 1.2,
                  }}
                >
                  {insignia.name}
                </span>
              </button>
            ))}
          </div>
        </GlassModal>
      )}

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Export preview modal
// ─────────────────────────────────────────────────────────────────────────

function decalToolLabel(id: DecalToolId): string {
  switch (id) {
    case 'select':
      return 'Select'
    case 'images':
      return 'Images'
    case 'transform':
      return 'Transform'
    case 'tint':
      return 'Tint'
    case 'draw':
      return 'Draw'
  }
}

function DecalToolPeelBody({
  tool,
  project,
  activeDecal,
  mutate: _mutate,
  onAddImageFiles,
  onAddImageToCanvas,
  onBatchImport,
  onInsigniaOpen,
  onMoveDecal,
  onDeleteDecal: _onDeleteDecal,
  onDuplicateDecal,
  onUpdateActive,
  brushSize,
  setBrushSize,
  brushHardness,
  setBrushHardness,
  brushColor,
  setBrushColor,
  brushOpacity,
  setBrushOpacity,
  brushErase,
  setBrushErase,
  eyedropperActive,
  setEyedropperActive,
  mirrorX,
  setMirrorX,
  mirrorY,
  setMirrorY,
  onClearPaint,
  nudgeStep,
  setNudgeStep,
  snapGrid,
  setSnapGrid,
  snapGridStep,
  setSnapGridStep,
  // G6 rename props are passed but not used inside the peel (rename is in the strip)
  renamingDecalId: _renamingDecalId,
  setRenamingDecalId: _setRenamingDecalId,
}: {
  tool: DecalToolId
  project: Coh2DecalPackProject
  activeDecal: Decal | null
  mutate: (
    fn: (p: Coh2DecalPackProject) => Coh2DecalPackProject,
    opts?: { undoable?: boolean },
  ) => void
  setActive: (id: string) => void
  onAddImageFiles: (files: File[]) => void
  onAddImageToCanvas: (imageId: string) => void
  onBatchImport: () => void
  onInsigniaOpen: () => void
  onMoveDecal: (id: string, dir: -1 | 1) => void
  onDeleteDecal: (id: string) => void
  onDuplicateDecal: (id: string) => void
  onUpdateActive: (fn: (d: Decal) => Decal) => void
  brushSize: number
  setBrushSize: (v: number) => void
  brushHardness: number
  setBrushHardness: (v: number) => void
  brushColor: string
  setBrushColor: (v: string) => void
  brushOpacity: number
  setBrushOpacity: (v: number) => void
  brushErase: boolean
  setBrushErase: (v: boolean) => void
  eyedropperActive: boolean
  setEyedropperActive: (v: boolean) => void
  mirrorX: boolean
  setMirrorX: (v: boolean) => void
  mirrorY: boolean
  setMirrorY: (v: boolean) => void
  onClearPaint: () => void
  nudgeStep: 1 | 2 | 4 | 8
  setNudgeStep: (v: 1 | 2 | 4 | 8) => void
  snapGrid: boolean
  setSnapGrid: (v: boolean) => void
  snapGridStep: 4 | 8 | 16 | 32
  setSnapGridStep: (v: 4 | 8 | 16 | 32) => void
  renamingDecalId: string | null
  setRenamingDecalId: (v: string | null) => void
}) {
  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 6,
    background: active ? 'rgba(186,150,90,0.18)' : 'rgba(255,255,255,0.06)',
    border: `1px solid ${active ? 'rgba(186,150,90,0.6)' : 'rgba(255,255,255,0.12)'}`,
    color: active ? EDITOR_ACCENT : EDITOR_TEXT_2,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  })

  if (tool === 'select') {
    // G8: nudge step segmented control + G11: snap-to-grid toggle
    const nudgeOptions: (1 | 2 | 4 | 8)[] = [1, 2, 4, 8]
    const gridOptions: (4 | 8 | 16 | 32)[] = [4, 8, 16, 32]
    return (
      <>
        {/* G8: Nudge step selector */}
        <span style={{ fontSize: 10, color: EDITOR_TEXT_4, flexShrink: 0, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>Nudge</span>
        <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }}>
          {nudgeOptions.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => setNudgeStep(opt)}
              style={{
                padding: '0 7px',
                height: 28,
                background: nudgeStep === opt ? 'rgba(186,150,90,0.18)' : 'rgba(255,255,255,0.04)',
                border: 'none',
                borderRight: opt !== 8 ? '1px solid rgba(255,255,255,0.10)' : 'none',
                color: nudgeStep === opt ? EDITOR_ACCENT : EDITOR_TEXT_2,
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: nudgeStep === opt ? 600 : 400,
              }}
            >{opt}px</button>
          ))}
        </div>
        {/* G11: Snap-to-grid toggle + step */}
        <div
          aria-hidden
          style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.12)', flexShrink: 0, borderRadius: 1 }}
        />
        <button
          type="button"
          title={snapGrid ? 'Snap to grid ON (click to disable)' : 'Snap to grid OFF (click to enable)'}
          aria-pressed={snapGrid}
          onClick={() => setSnapGrid(!snapGrid)}
          style={toggleBtnStyle(snapGrid)}
        >
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M0 3.5h14M0 7h14M0 10.5h14M3.5 0v14M7 0v14M10.5 0v14" stroke="currentColor" strokeWidth="1" opacity="0.8"/>
          </svg>
        </button>
        {snapGrid && (
          <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }}>
            {gridOptions.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => setSnapGridStep(opt)}
                style={{
                  padding: '0 6px',
                  height: 28,
                  background: snapGridStep === opt ? 'rgba(186,150,90,0.18)' : 'rgba(255,255,255,0.04)',
                  border: 'none',
                  borderRight: opt !== 32 ? '1px solid rgba(255,255,255,0.10)' : 'none',
                  color: snapGridStep === opt ? EDITOR_ACCENT : EDITOR_TEXT_2,
                  fontSize: 10,
                  cursor: 'pointer',
                  fontWeight: snapGridStep === opt ? 600 : 400,
                }}
              >{opt}</button>
            ))}
          </div>
        )}
      </>
    )
  }

  if (tool === 'images') {
    // v1.0 rewrite: previously rendered the vertical ImageLibraryPanel
    // (heading + 3-column thumbnail grid + textarea + author input)
    // inside the horizontal peel, which the user described as "looking
    // bad" because the vertical multi-row form crashed the peel's
    // single-row aesthetic. This is now a horizontal toolbar:
    //   • "Add image…" file-picker button (matches PanelButton sizing)
    //   • Batch import button
    //   • Insignia library button
    //   • A horizontally-scrolling strip of existing source-image
    //     thumbnails (28×28) — clicking one inserts it as a new decal.
    // The pack description / author fields moved to the Project peel
    // where they belong; the Images peel is now strictly about adding
    // imagery to the canvas.
    const sourceImageList = Object.values(project.sourceImages)
    const inputId = 'images-peel-add-input'
    return (
      <>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          multiple
          onChange={ev => {
            const files = Array.from(ev.target.files ?? []).filter(f => f.type.startsWith('image/'))
            ev.target.value = ''
            if (files.length > 0) onAddImageFiles(files)
          }}
          style={{ display: 'none' }}
        />
        <label
          htmlFor={inputId}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 28,
            padding: '0 10px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            color: EDITOR_TEXT_2,
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <ImageIcon size={12} aria-hidden /> Add…
        </label>
        <PanelButton onClick={onBatchImport}>
          <ImageIcon size={12} aria-hidden /> Batch…
        </PanelButton>
        <PanelButton onClick={onInsigniaOpen}>
          <Library size={12} aria-hidden /> Insignia…
        </PanelButton>
        {sourceImageList.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              maxWidth: 240,
              overflowX: 'auto',
              paddingBottom: 2,
            }}
          >
            {sourceImageList.map(img => (
              <button
                key={img.id}
                type="button"
                onClick={() => onAddImageToCanvas(img.id)}
                title={`Add "${img.name}" as a new decal`}
                aria-label={`Add "${img.name}" as a new decal`}
                style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  padding: 0,
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  overflow: 'hidden',
                }}
              >
                <img
                  src={img.dataUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </button>
            ))}
          </div>
        )}
      </>
    )
  }

  if (tool === 'transform') {
    if (!activeDecal) {
      return <p style={peelHint}>Select a decal from the strip to adjust its transform and image.</p>
    }
    // Consolidated transform + adjust toolbar — single-row strip of:
    //   • Scale / Rotation / Opacity icon SliderPopovers (28×28)
    //   • Flip H / Flip V toggle buttons (28×28)
    //   • Earlier / Later reorder buttons (28×28)
    //   • Duplicate / Centre (28×28)
    //   • Divider
    //   • BlendModeSelect (compact) + Brightness / Contrast / Saturation SliderPopovers + Reset
    // The Adjust pill that previously floated under the title is removed;
    // all per-decal controls now live in a single peel.
    return (
      <>
        <SliderPopover
          icon={<Maximize2 size={14} />}
          title="Scale"
          value={activeDecal.scale}
          min={0.05}
          max={4}
          step={0.01}
          identity={1}
          format={v => `${v.toFixed(2)}×`}
          onChange={v => onUpdateActive(d => ({ ...d, scale: v }))}
        />
        <SliderPopover
          icon={<RotateCcw size={14} />}
          title="Rotation"
          value={activeDecal.rotation}
          min={-180}
          max={180}
          step={1}
          identity={0}
          format={v => `${Math.round(v)}°`}
          onChange={v => onUpdateActive(d => ({ ...d, rotation: v }))}
        />
        <SliderPopover
          icon={<CaseSensitive size={14} />}
          title="Opacity"
          value={activeDecal.opacity}
          min={0}
          max={1}
          step={0.01}
          identity={1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => onUpdateActive(d => ({ ...d, opacity: v }))}
        />
        <button
          title="Flip horizontally"
          aria-pressed={!!activeDecal.flipH}
          aria-label="Flip horizontally"
          onClick={() => onUpdateActive(d => ({ ...d, flipH: !d.flipH }))}
          style={toggleBtnStyle(!!activeDecal.flipH)}
        >
          <FlipHorizontal2 size={14} />
        </button>
        <button
          title="Flip vertically"
          aria-pressed={!!activeDecal.flipV}
          aria-label="Flip vertically"
          onClick={() => onUpdateActive(d => ({ ...d, flipV: !d.flipV }))}
          style={toggleBtnStyle(!!activeDecal.flipV)}
        >
          <FlipVertical2 size={14} />
        </button>
        <button
          title="Move earlier in stack"
          aria-label="Move earlier in stack"
          onClick={() => onMoveDecal(activeDecal.id, -1)}
          style={toggleBtnStyle(false)}
        >
          <ChevronUp size={14} />
        </button>
        <button
          title="Move later in stack"
          aria-label="Move later in stack"
          onClick={() => onMoveDecal(activeDecal.id, 1)}
          style={toggleBtnStyle(false)}
        >
          <ChevronDown size={14} />
        </button>
        <button
          title="Duplicate decal"
          aria-label="Duplicate decal"
          onClick={() => onDuplicateDecal(activeDecal.id)}
          style={toggleBtnStyle(false)}
        >
          <Copy size={14} />
        </button>
        {/* G4: Rotate 90° CW / CCW buttons */}
        <button
          title="Rotate 90° clockwise"
          aria-label="Rotate 90° clockwise"
          onClick={() =>
            onUpdateActive(d => ({
              ...d,
              rotation: normaliseRotation(d.rotation + 90),
            }))
          }
          style={toggleBtnStyle(false)}
        >
          <RotateCw size={14} />
        </button>
        <button
          title="Rotate 90° counter-clockwise"
          aria-label="Rotate 90° counter-clockwise"
          onClick={() =>
            onUpdateActive(d => ({
              ...d,
              rotation: normaliseRotation(d.rotation - 90),
            }))
          }
          style={toggleBtnStyle(false)}
        >
          <RotateCcw size={14} />
        </button>
        <button
          title="Centre and clear rotation"
          aria-label="Centre and clear rotation"
          onClick={() =>
            onUpdateActive(d => ({
              ...d,
              x: DECAL_PACK_SIZE / 2,
              y: DECAL_PACK_SIZE / 2,
              rotation: 0,
            }))
          }
          style={toggleBtnStyle(false)}
        >
          <Crosshair size={14} />
        </button>
        {/* G5: Align-to-canvas buttons — 3 horizontal + 3 vertical */}
        <div
          aria-hidden
          style={{
            width: 1,
            height: 20,
            background: 'rgba(255,255,255,0.12)',
            flexShrink: 0,
            borderRadius: 1,
          }}
        />
        {/* Horizontal alignment: left / centre / right */}
        <button
          title="Align left edge to canvas left"
          aria-label="Align left"
          onClick={() =>
            onUpdateActive(d => {
              const w = (project.sourceImages[d.sourceImageId]?.width ?? 0) * d.scale
              return { ...d, x: w / 2 }
            })
          }
          style={toggleBtnStyle(false)}
        >
          <AlignStartVertical size={14} />
        </button>
        <button
          title="Align centre horizontally"
          aria-label="Align centre H"
          onClick={() => onUpdateActive(d => ({ ...d, x: DECAL_PACK_SIZE / 2 }))}
          style={toggleBtnStyle(false)}
        >
          <AlignCenterVertical size={14} />
        </button>
        <button
          title="Align right edge to canvas right"
          aria-label="Align right"
          onClick={() =>
            onUpdateActive(d => {
              const w = (project.sourceImages[d.sourceImageId]?.width ?? 0) * d.scale
              return { ...d, x: DECAL_PACK_SIZE - w / 2 }
            })
          }
          style={toggleBtnStyle(false)}
        >
          <AlignEndVertical size={14} />
        </button>
        {/* Vertical alignment: top / centre / bottom */}
        <button
          title="Align top edge to canvas top"
          aria-label="Align top"
          onClick={() =>
            onUpdateActive(d => {
              const h = (project.sourceImages[d.sourceImageId]?.height ?? 0) * d.scale
              return { ...d, y: h / 2 }
            })
          }
          style={toggleBtnStyle(false)}
        >
          <AlignStartHorizontal size={14} />
        </button>
        <button
          title="Align centre vertically"
          aria-label="Align centre V"
          onClick={() => onUpdateActive(d => ({ ...d, y: DECAL_PACK_SIZE / 2 }))}
          style={toggleBtnStyle(false)}
        >
          <AlignCenter size={14} />
        </button>
        <button
          title="Align bottom edge to canvas bottom"
          aria-label="Align bottom"
          onClick={() =>
            onUpdateActive(d => {
              const h = (project.sourceImages[d.sourceImageId]?.height ?? 0) * d.scale
              return { ...d, y: DECAL_PACK_SIZE - h / 2 }
            })
          }
          style={toggleBtnStyle(false)}
        >
          <AlignEndHorizontal size={14} />
        </button>
        {/* ── Numeric transform inputs (X/Y/W/H/angle) ── */}
        <div
          aria-hidden
          style={{
            width: 1,
            height: 20,
            background: 'rgba(255,255,255,0.12)',
            flexShrink: 0,
            borderRadius: 1,
          }}
        />
        {(() => {
          const src = project.sourceImages[activeDecal.sourceImageId]
          const naturalW = src?.width ?? 1
          const naturalH = src?.height ?? 1
          const w = naturalW * activeDecal.scale
          const h = naturalH * activeDecal.scale
          return (
            <TransformInputsRow
              x={activeDecal.x}
              y={activeDecal.y}
              w={w}
              h={h}
              angle={activeDecal.rotation}
              onChangeX={v => onUpdateActive(d => ({ ...d, x: v }))}
              onChangeY={v => onUpdateActive(d => ({ ...d, y: v }))}
              onChangeW={v => {
                const nat = project.sourceImages[activeDecal.sourceImageId]?.width ?? 1
                const newScale = Math.max(0.01, v / nat)
                onUpdateActive(d => ({ ...d, scale: newScale }))
              }}
              onChangeH={v => {
                const nat = project.sourceImages[activeDecal.sourceImageId]?.height ?? 1
                const newScale = Math.max(0.01, v / nat)
                onUpdateActive(d => ({ ...d, scale: newScale }))
              }}
              onChangeAngle={v => onUpdateActive(d => ({ ...d, rotation: normaliseRotation(v) }))}
            />
          )
        })()}
        {/* Separator between transform/position and adjust controls */}
        <div
          aria-hidden
          style={{
            width: 1,
            height: 20,
            background: 'rgba(255,255,255,0.12)',
            flexShrink: 0,
            borderRadius: 1,
          }}
        />
        {/* Adjust controls — blend mode, brightness, contrast, saturation, reset */}
        {/* Blend/opacity affect the editor preview only: the badge is binarised to a
            white-on-black mask at export, so these have no in-game effect. */}
        <span
          style={{ display: 'inline-flex' }}
          title="Editor preview only — the final badge is exported as a white-on-black mask, so blend mode and opacity don't affect how it looks in-game."
        >
          <BlendModeSelect
            compact
            value={activeDecal.blendMode as import('@/lib/faceplate-project').BlendMode | undefined}
            onChange={next => onUpdateActive(d => ({ ...d, blendMode: next as typeof d.blendMode }))}
            label="Blend"
          />
        </span>
        <SliderPopover
          icon={<Sun size={14} />}
          title="Brightness"
          value={activeDecal.brightness ?? 100}
          min={0}
          max={200}
          step={1}
          identity={100}
          format={v => `${v}%`}
          onChange={v => onUpdateActive(d => ({ ...d, brightness: v }))}
        />
        <SliderPopover
          icon={<Contrast size={14} />}
          title="Contrast"
          value={activeDecal.contrast ?? 100}
          min={0}
          max={200}
          step={1}
          identity={100}
          format={v => `${v}%`}
          onChange={v => onUpdateActive(d => ({ ...d, contrast: v }))}
        />
        <SliderPopover
          icon={<Palette size={14} />}
          title="Saturation"
          value={activeDecal.saturation ?? 100}
          min={0}
          max={200}
          step={1}
          identity={100}
          format={v => `${v}%`}
          onChange={v => onUpdateActive(d => ({ ...d, saturation: v }))}
        />
        {/* G10: Hue rotation slider (−180..180°) */}
        <SliderPopover
          icon={<Droplet size={14} />}
          title="Hue"
          value={activeDecal.hueRotate ?? 0}
          min={-180}
          max={180}
          step={1}
          identity={0}
          format={v => `${Math.round(v)}°`}
          onChange={v => onUpdateActive(d => ({ ...d, hueRotate: v }))}
        />
        <PanelButton
          disabled={
            (activeDecal.brightness ?? 100) === 100 &&
            (activeDecal.contrast ?? 100) === 100 &&
            (activeDecal.saturation ?? 100) === 100 &&
            (activeDecal.hueRotate ?? 0) === 0
          }
          onClick={() =>
            onUpdateActive(d => ({ ...d, brightness: 100, contrast: 100, saturation: 100, hueRotate: 0 }))
          }
        >
          Reset
        </PanelButton>
      </>
    )
  }

  if (tool === 'tint') {
    if (!activeDecal) {
      return <p style={peelHint}>Select a decal in the strip to tint it.</p>
    }
    const tintColor = activeDecal.tint?.color ?? DECAL_TINT_DEFAULTS.color
    const tintStrength = activeDecal.tint?.strength ?? DECAL_TINT_DEFAULTS.strength
    return (
      <>
        <HexColorInput
          value={tintColor}
          onChange={color => {
            onUpdateActive(d => ({
              ...d,
              tint:
                (d.tint?.strength ?? 0) === 0 ? undefined : { color, strength: d.tint!.strength },
            }))
          }}
          title="Tint colour"
          size={24}
        />
        <SliderPopover
          icon={<Droplet size={14} />}
          title="Tint strength"
          value={tintStrength}
          min={0}
          max={1}
          step={0.05}
          identity={0}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => {
            onUpdateActive(d => ({
              ...d,
              tint:
                v === 0
                  ? undefined
                  : { color: d.tint?.color ?? DECAL_TINT_DEFAULTS.color, strength: v },
            }))
          }}
        />
      </>
    )
  }

  if (tool === 'draw') {
    return (
      <>
        <SliderPopover
          icon={<Brush size={14} />}
          title="Brush size"
          value={brushSize}
          min={1}
          max={40}
          step={1}
          identity={8}
          format={v => `${v}px`}
          onChange={setBrushSize}
        />
        {/* G1: Brush hardness — 1 = hard edge, 0 = fully feathered */}
        <SliderPopover
          icon={<Circle size={14} />}
          title="Hardness"
          value={brushHardness}
          min={0}
          max={1}
          step={0.05}
          identity={1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={setBrushHardness}
        />
        {/* Brush colour — visually muted in erase mode. */}
        <div style={{ opacity: brushErase ? 0.4 : 1, pointerEvents: brushErase ? 'none' : 'auto', display: 'inline-flex', alignItems: 'center' }}>
          <HexColorInput
            value={brushColor}
            onChange={setBrushColor}
            title="Brush colour"
            size={24}
          />
        </div>
        <SliderPopover
          icon={<CaseSensitive size={14} />}
          title="Brush opacity"
          value={brushOpacity}
          min={0}
          max={1}
          step={0.05}
          identity={1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={setBrushOpacity}
        />
        {/* Eyedropper — one-shot colour picker from the composited decal canvas. */}
        <button
          title="Eyedropper — click the canvas to sample a colour from the decal"
          aria-pressed={eyedropperActive}
          aria-label="Eyedropper"
          onClick={() => {
            setEyedropperActive(!eyedropperActive)
            if (!eyedropperActive) setBrushErase(false)
          }}
          style={toggleBtnStyle(eyedropperActive)}
        >
          <Pipette size={14} />
        </button>
        {/* Erase toggle */}
        <button
          title={brushErase ? 'Erase mode ON (click to switch to paint)' : 'Switch to erase mode'}
          aria-pressed={brushErase}
          data-testid="brush-erase-toggle"
          onClick={() => setBrushErase(!brushErase)}
          style={toggleBtnStyle(brushErase)}
        >
          <Eraser size={14} />
        </button>
        <button
          title="Mirror horizontally (X axis)"
          aria-pressed={mirrorX}
          onClick={() => setMirrorX(!mirrorX)}
          style={toggleBtnStyle(mirrorX)}
        >
          <FlipHorizontal2 size={14} />
        </button>
        <button
          title="Mirror vertically (Y axis)"
          aria-pressed={mirrorY}
          onClick={() => setMirrorY(!mirrorY)}
          style={toggleBtnStyle(mirrorY)}
        >
          <FlipVertical2 size={14} />
        </button>
        <button
          title="Clear paint"
          aria-label="Clear paint"
          style={{
            ...toggleBtnStyle(false),
            color: '#f87171',
            border: '1px solid rgba(255,80,80,0.3)',
            background: 'rgba(255,80,80,0.08)',
          }}
          onClick={onClearPaint}
        >
          <Trash2 size={14} />
        </button>
      </>
    )
  }

  return null
}

const peelHint: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  lineHeight: 1.4,
  color: EDITOR_TEXT_4,
  maxWidth: 240,
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Normalise a rotation angle (degrees) into the range (-180, 180].
 * Exported for unit testing (G4 rotate-by-90 pure logic).
 */
export function normaliseRotation(deg: number): number {
  // JavaScript % can return negative values for negative inputs;
  // add 540 (1.5 full turns) before the modulo to guarantee a positive
  // intermediate value, then shift back to (-180, 180].
  return ((deg + 540) % 360) - 180
}

/**
 * updateDecal — apply `fn` to the decal with the given id.
 *
 * For v6 projects (with parts), the mutation targets only the ACTIVE cell
 * (part index + faction) so per-part / per-faction layers are kept isolated.
 * The `activePartIndex` and `activeFaction` are captured via closure from the
 * component-level helpers; for the canvas drag / arrow-key callers that use
 * this as a project-level function it is called inside a `mutate()` closure,
 * which already has the correct part/faction captured.
 *
 * For v5 flat projects (no parts), falls back to mutating project.decals.
 *
 * NOTE: for production callers that live OUTSIDE the component (e.g. pure
 * unit tests), we export a version that takes explicit indices below.
 */
function updateDecal(
  p: Coh2DecalPackProject,
  id: string,
  fn: (d: Decal) => Decal,
  activePartIndex?: number,
  activeFaction?: DecalFaction | null,
): Coh2DecalPackProject {
  if (!p.parts) {
    // v5: mutate project.decals
    return { ...p, decals: p.decals.map(d => (d.id === id ? fn(d) : d)) }
  }
  // v6: mutate only the active cell
  const pi = activePartIndex ?? 1
  const faction = activeFaction ?? null
  const parts = p.parts.map((part, i) => {
    if (i !== pi) return part
    if (faction !== null) {
      // Fork-on-write: clone shared into override if not yet present, then mutate.
      const existing = part.overrides?.[faction] ?? [...part.shared]
      return {
        ...part,
        overrides: {
          ...part.overrides,
          [faction]: existing.map(d => (d.id === id ? fn(d) : d)),
        },
      }
    }
    return { ...part, shared: part.shared.map(d => (d.id === id ? fn(d) : d)) }
  })
  return { ...p, parts }
}

/**
 * Dark transparency checker — layered over the dark canvas surface (#1a1c22)
 * to indicate alpha=0 regions while keeping the editor dark-mode consistent.
 * Two tones of white-on-dark at low alpha produce a subtle 16px checker grid
 * that reads as "transparent canvas, dark theme" without washing out decal content.
 */
function darkCheckerBackground(): string {
  return `repeating-conic-gradient(
    rgba(255,255,255,0.07) 0% 25%,
    rgba(255,255,255,0.03) 25% 50%
  )`
}

/**
 * Light checker used by the "Preview as transparent" toggle. Mirrors the
 * neutral grey/white checker the in-game UI overlays a decal against, so
 * the user can sanity-check what their pack will look like when the
 * underlying surface is alpha=0 (true transparent). Editor-only — never
 * touches the exported pipeline.
 */
function lightCheckerBackground(): string {
  return `repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 16px 16px`
}

/**
 * Load a data URL into a decoded HTMLImageElement. Used by the live-preview
 * compose pass that feeds the LobbyPreviewPanel. Mirrors the helper in
 * DecalPackInGamePreview.tsx but inlined here so this editor stays
 * self-contained.
 */
async function loadImageForPreview(src: string): Promise<HTMLImageElement> {
  const el = await new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('Image decode failed for preview'))
    img.src = src
  })
  // Await decode() so the returned image is drawImage-ready (no decode race).
  if (typeof el.decode === 'function') {
    try {
      await el.decode()
    } catch {
      /* benign for already-loaded SVG/data URLs in some engines */
    }
  }
  return el
}
