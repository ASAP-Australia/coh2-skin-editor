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
import {
  AlignCenter,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Brush,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Circle,
  Contrast,
  CornerDownLeft,
  Copy,
  Crosshair,
  Droplet,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  HelpCircle,
  Image as ImageIcon,
  Library,
  Lock,
  LockOpen,
  Maximize2,
  MousePointer2,
  Palette,
  Pencil,
  Pipette,
  RotateCcw,
  RotateCw,
  Sliders,
  Sun,
  Trash2,
} from 'lucide-react'
import KeyboardShortcutsOverlay from './editor-primitives/KeyboardShortcutsOverlay'
import { applySnap, type SnapTarget } from '@/lib/snap-guides'
import { samplePixel } from '@/lib/brush'
import {
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
import { rasteriseDecal } from '@/lib/decal-pack-export'
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
import { PackIdentityPopover } from './PackIdentityPopover'
// BorderBeam is now used by EditorTitlePill — no direct import needed here
import { makeDecalPublishTarget } from '@/components/PublishToWorkshopDialog'
import { PublishSection } from '@/components/PublishSection'
import FactionRow from '@/components/atlas/FactionRow'
import PartStepper from '@/components/atlas/PartStepper'
import FactionPartMatrix from '@/components/atlas/FactionPartMatrix'
import type { DecalFaction } from '@/lib/decal-mod-templates'
import {
  BlendModeSelect,
  BottomToolPill,
  CanvasPlaceholder,
  EditorHomeButton,
  GlassModal,
  PanelButton,
  SliderPopover,
  ToolOptionsPeel,
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

const UNDO_LIMIT = 50

/** Decal-editor tool identifiers — drive the BottomToolPill segments and
 *  the corresponding ToolOptionsPeel contents. */
type DecalToolId = 'select' | 'images' | 'transform' | 'tint' | 'draw'

/** Maximum number of files the batch-import picker will process at once. */
const BATCH_IMPORT_MAX = 32

/** Minimum 1×1 PNG data URL — used to detect "blank/empty" decal images. */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export default function DecalPackEditor({ project: initialProject, onBack, installRoot: _installRoot }: Props) {
  const [project, setProject] = useState<Coh2DecalPackProject>(initialProject)
  const [activeTool, setActiveTool] = useState<DecalToolId>('select')
  /** Non-null when the batch-import picker hit the 32-file cap. */
  const [batchWarning, setBatchWarning] = useState<string | null>(null)
  const undoStack = useRef<Coh2DecalPackProject[]>([])
  const redoStack = useRef<Coh2DecalPackProject[]>([])
  const dropZoneRef = useRef<ImageDropZoneHandle>(null)

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
  const previewTransparent = viewMode === 'checkerboard'
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

  // Persist part/faction into project on change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: atlas nav state is persisted into project for save/reload fidelity; single setState, no cascade
    setProject(prev => ({
      ...prev,
      activePartIndex,
      activeFaction,
    }))
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

  // ── Project mutation ─────────────────────────────────────────────────────
  const mutate = useCallback(
    (
      fn: (p: Coh2DecalPackProject) => Coh2DecalPackProject,
      { undoable = true }: { undoable?: boolean } = {},
    ) => {
      setProject(prev => {
        if (undoable) {
          undoStack.current.push(prev)
          if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
          // New undoable action invalidates the redo future.
          redoStack.current = []
        }
        const next = { ...fn(prev), modifiedAt: new Date().toISOString() }
        saveDecalPackToLocal(next)
        // v1.0: Live Sync is permanently on — every mutation triggers a
        // debounced .sga rebuild (mirrors FaceplateEditor's pattern).
        scheduleLiveSync('decal', next)
        return next
      })
    },
    [],
  )

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    if (!prev) return
    // Push current project onto redo stack before restoring.
    setProject(current => {
      redoStack.current.push(current)
      if (redoStack.current.length > UNDO_LIMIT) redoStack.current.shift()
      saveDecalPackToLocal(prev)
      scheduleLiveSync('decal', prev)
      return prev
    })
  }, [])

  /** Re-apply the most recently undone action. Bound to Cmd/Ctrl-Shift-Z and Ctrl+Y. */
  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    setProject(current => {
      undoStack.current.push(current)
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
      saveDecalPackToLocal(next)
      scheduleLiveSync('decal', next)
      return next
    })
  }, [])

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
  }, [activeDecal?.id, activeTool, nudgeStep, mutate, undo, redo, updateCellDecal])

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

  // ── Zoom state ──────────────────────────────────────────────────────────
  // Persisted per-project so reopening preserves the user's zoom level.
  const [zoom, setZoom] = useState(initialProject.editorZoom ?? 4)

  // Persist zoom into project (non-undoable so it doesn't spam undo history).
  useEffect(() => {
    mutate(p => ({ ...p, editorZoom: zoom }), { undoable: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only runs when zoom changes
  }, [zoom])

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

  // Scroll-to-zoom: non-passive so we can preventDefault (avoids Chrome warning).
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      setZoom(z => Math.max(0.5, Math.min(8, +(z + (e.deltaY < 0 ? 0.15 : -0.15)).toFixed(2))))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const viewScale = canvasRect ? canvasRect.width / DECAL_PACK_SIZE : 1

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

  // ── Canvas drag → translate the active decal (only in select/transform mode) ──
  const beginCanvasDrag = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      if (!activeDecal) return
      if (activeTool === 'draw') return // draw tool handles pointer separately
      ev.stopPropagation()
      const startClientX = ev.clientX
      const startClientY = ev.clientY
      const startX = activeDecal.x
      const startY = activeDecal.y
      const targetEl = ev.currentTarget as HTMLElement
      try {
        targetEl.setPointerCapture(ev.pointerId)
      } catch {
        /* setPointerCapture can throw in headless contexts */
      }

      // G9: capture start positions of all multi-selected decals (if any).
      // We snapshot from cellDecals so the captured positions are correct.
      const multiStarts: Map<string, { x: number; y: number }> = new Map()
      if (multiSelectedIds.size > 0) {
        for (const d of cellDecals) {
          if (d.id === activeDecal.id || multiSelectedIds.has(d.id)) {
            multiStarts.set(d.id, { x: d.x, y: d.y })
          }
        }
      }

      // Build snap targets: canvas edges, canvas centre.
      // G11: also add grid-line targets when snap-to-grid is enabled.
      // Decal x/y is the decal centre position (translate(-50%,-50%)).
      const snapTargets: SnapTarget[] = [
        { kind: 'x', value: DECAL_PACK_SIZE / 2, label: 'canvas center X' },
        { kind: 'y', value: DECAL_PACK_SIZE / 2, label: 'canvas center Y' },
        { kind: 'x', value: 0, label: 'canvas left edge' },
        { kind: 'x', value: DECAL_PACK_SIZE, label: 'canvas right edge' },
        { kind: 'y', value: 0, label: 'canvas top edge' },
        { kind: 'y', value: DECAL_PACK_SIZE, label: 'canvas bottom edge' },
      ]
      if (snapGrid) {
        for (let v = snapGridStep; v < DECAL_PACK_SIZE; v += snapGridStep) {
          snapTargets.push({ kind: 'x', value: v, label: `grid x ${v}` })
          snapTargets.push({ kind: 'y', value: v, label: `grid y ${v}` })
        }
      }

      const onMove = (e: PointerEvent) => {
        const dx = (e.clientX - startClientX) / viewScale
        const dy = (e.clientY - startClientY) / viewScale
        const candidateX = startX + dx
        const candidateY = startY + dy
        const { snappedX, snappedY, firedTargets } = applySnap(candidateX, candidateY, snapTargets)
        setSnapGuides(firedTargets)
        if (multiStarts.size > 1) {
          // G9: move ALL selected decals by the same snapped delta.
          const snapDx = snappedX - startX
          const snapDy = snappedY - startY
          mutate(
            p => {
              let next = p
              for (const [id, start] of multiStarts) {
                next = updateCellDecal(next, id, d => ({
                  ...d,
                  x: start.x + snapDx,
                  y: start.y + snapDy,
                }))
              }
              return next
            },
            { undoable: false },
          )
        } else {
          mutate(
            p =>
              updateCellDecal(p, activeDecal.id, d => ({
                ...d,
                x: snappedX,
                y: snappedY,
              })),
            { undoable: false },
          )
        }
      }
      const onUp = () => {
        setSnapGuides([])
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [activeDecal, activeTool, viewScale, mutate, setSnapGuides, updateCellDecal, multiSelectedIds, cellDecals, snapGrid, snapGridStep],
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
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)

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
      activePartIndex,
      activeFaction,
    ],
  )

  // Tool definitions for the bottom pill. Export removed — Live Sync handles it automatically.
  const DECAL_TOOLS: readonly ToolDef<DecalToolId>[] = [
    { id: 'select', icon: <MousePointer2 size={20} />, label: 'Select' },
    { id: 'images', icon: <ImageIcon size={20} />, label: 'Images' },
    { id: 'transform', icon: <Sliders size={20} />, label: 'Transform' },
    { id: 'tint', icon: <Droplet size={20} />, label: 'Tint' },
    { id: 'draw', icon: <Pencil size={20} />, label: 'Draw' },
  ]

  // ── Publish build handler — builds SGA, then sets target for inline form ──
  const handleRequestBuild = useCallback(async () => {
    setIsBuildingTarget(true)
    try {
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
          const img = new Image()
          img.src = src.dataUrl
          await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r() })
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
            const img = new Image()
            img.src = src.dataUrl
            await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r() })
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
          const img = new Image()
          img.src = src.dataUrl
          await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r() })
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
  }, [project, setProject])

  // Whether to show the placeholder for the active decal canvas.
  const showDecalPlaceholder =
    !activeDecal ||
    (() => {
      const src = project.sourceImages[activeDecal.sourceImageId]
      return !src || !src.dataUrl || src.dataUrl === BLANK_PNG
    })()

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-10"
      style={{
        background: '#0a0b0e',
        color: 'rgba(247,247,250,0.92)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
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

        {/* The 128×128 decal canvas */}
        <div
          ref={canvasRef}
          onPointerDown={activeTool === 'draw' ? beginDraw : beginCanvasDrag}
          style={{
            width: DECAL_PACK_SIZE * zoom,
            height: DECAL_PACK_SIZE * zoom,
            position: 'relative',
            background: previewTransparent ? '#ffffff' : checkerBackground(),
            backgroundImage: previewTransparent ? lightCheckerBackground() : undefined,
            backgroundSize: previewTransparent ? '16px 16px' : '24px 24px',
            // v1.0 polish: sharp corners on the decal frame. CoH2 decals are
            // rasterised to square 128×128 textures and the in-game preview
            // shows them as crisp squares — the editor frame should match
            // that physicality rather than softening the silhouette with a
            // 6px rounded edge that doesn't appear anywhere in the game.
            borderRadius: 0,
            boxShadow:
              '0 24px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06), 0 0 0 6px rgba(0,0,0,0.35)',
            cursor: activeTool === 'draw' ? 'crosshair' : activeDecal ? 'move' : 'default',
            overflow: 'visible',
            touchAction: 'none',
          }}
        >
          {/* Canvas placeholder when no active decal or decal has no image.
              Hidden during transparent-preview so the user sees the true
              checker (= alpha=0) without editor scaffolding muddying it. */}
          {!previewTransparent && showDecalPlaceholder && (
            <CanvasPlaceholder width={DECAL_PACK_SIZE} height={DECAL_PACK_SIZE} />
          )}

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
              const filterCss = hasAdj
                ? `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hueRotate}deg)`
                : undefined
              return (
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
                    pointerEvents: 'none',
                    userSelect: 'none',
                    filter: filterCss,
                    zIndex: 1,
                  }}
                />
              )
            })()}

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
                  <filter id="oob-red-tint" colorInterpolationFilters="sRGB">
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
                background: 'rgba(120,180,255,0.4)',
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
                background: 'rgba(120,180,255,0.4)',
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
                  background: 'rgba(120,180,255,0.85)',
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
                  background: 'rgba(120,180,255,0.85)',
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
        </div>
      </ImageDropZone>

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
        {/* Undo button */}
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          aria-label="Undo (Ctrl+Z)"
          disabled={undoStack.current.length === 0}
          onClick={undo}
          className="hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-35 disabled:pointer-events-none"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 12,
            background: 'rgba(15, 17, 22, 0.75)',
            backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
            backdropFilter: 'blur(40px) saturate(150%)',
            WebkitBackdropFilter: 'blur(40px) saturate(150%)',
            border: '0.5px solid rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
            color: 'var(--color-text-2)',
            cursor: 'pointer',
            padding: 0,
            transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            WebkitAppRegion: 'no-drag',
          } as CSSProperties}
        >
          <RotateCcw size={16} strokeWidth={2} aria-hidden />
        </button>
        {/* Redo button */}
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo (Ctrl+Shift+Z)"
          disabled={redoStack.current.length === 0}
          onClick={redo}
          className="hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-35 disabled:pointer-events-none"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 12,
            background: 'rgba(15, 17, 22, 0.75)',
            backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
            backdropFilter: 'blur(40px) saturate(150%)',
            WebkitBackdropFilter: 'blur(40px) saturate(150%)',
            border: '0.5px solid rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
            color: 'var(--color-text-2)',
            cursor: 'pointer',
            padding: 0,
            transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            WebkitAppRegion: 'no-drag',
          } as CSSProperties}
        >
          <RotateCw size={16} strokeWidth={2} aria-hidden />
        </button>
        {/* Help / keyboard shortcuts button (G2) */}
        <button
          type="button"
          title="Keyboard shortcuts (F1)"
          aria-label="Keyboard shortcuts (F1)"
          onClick={() => setShortcutsOpen(true)}
          className="hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 12,
            background: 'rgba(15, 17, 22, 0.75)',
            backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
            backdropFilter: 'blur(40px) saturate(150%)',
            WebkitBackdropFilter: 'blur(40px) saturate(150%)',
            border: '0.5px solid rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
            color: 'var(--color-text-2)',
            cursor: 'pointer',
            padding: 0,
            transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            WebkitAppRegion: 'no-drag',
          } as CSSProperties}
        >
          <HelpCircle size={16} strokeWidth={2} aria-hidden />
        </button>
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
              <p
                style={{
                  margin: 0,
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.38)',
                  lineHeight: 1.45,
                  borderTop: '0.5px solid rgba(255,255,255,0.08)',
                  paddingTop: 8,
                }}
              >
                Name and Description are the in-game fields — shown above the
                decal grid and on the equip card in CoH2.
              </p>
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
              />
            }
            locked={isUploading || isBuildingTarget}
          />
        }
      />

      {/* Atlas part + faction controls — shown only for v6 projects */}
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
          <PartStepper
            activeIndex={activePartIndex}
            onChange={setActivePartIndex}
          />
          <FactionRow
            activeFaction={activeFaction}
            onChange={setActiveFaction}
          />
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
              style={{
                background: 'rgba(16,18,24,0.92)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 12,
                padding: 12,
                backdropFilter: 'blur(20px)',
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

      {/* Always-visible vertical decal strip — left-center */}
      {/* Uses cellDecals (active part/faction cell) for v6, project.decals for v5 */}
      {cellDecals.length > 0 && (
        <div
          role="toolbar"
          aria-label="Decals"
          className="custom-scrollbar"
          style={{
            position: 'fixed',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 38,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '10px 6px',
            background: 'rgba(16,18,24,0.72)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            maxHeight: 'calc(100vh - 200px)',
            overflowY: 'auto',
          }}
          onClick={() => setDecalCtxMenu(null)}
          onKeyDown={ev => {
            if (ev.key === 'Escape') setDecalCtxMenu(null)
          }}
        >
          {cellDecals.map(decal => {
            const isActive = decal.id === cellActiveLayerId
            const isMulti = multiSelectedIds.has(decal.id)
            const src = project.sourceImages[decal.sourceImageId]
            const posLocked = decal.locked?.position
            return (
              <div
                key={decal.id}
                role="button"
                tabIndex={0}
                aria-label={decal.name}
                aria-pressed={isActive}
                draggable={renamingDecalId !== decal.id}
                onDragStart={() => onDecalDragStart(decal.id)}
                onDragOver={ev => { ev.preventDefault(); onDecalDragOver(decal.id) }}
                onDrop={() => onDecalDrop(decal.id)}
                onDragEnd={onDecalDragEnd}
                onClick={ev => {
                  ev.stopPropagation()
                  if (renamingDecalId === decal.id) return
                  if (ev.metaKey || ev.ctrlKey) {
                    setMultiSelectedIds(prev => {
                      const next = new Set(prev)
                      if (next.has(decal.id)) next.delete(decal.id)
                      else next.add(decal.id)
                      return next
                    })
                  } else {
                    setActive(decal.id)
                    setMultiSelectedIds(new Set())
                    setDecalCtxMenu(null)
                  }
                }}
                onDoubleClick={ev => {
                  ev.stopPropagation()
                  setActive(decal.id)
                  setRenamingDecalId(decal.id)
                }}
                onKeyDown={ev => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    setActive(decal.id)
                    setDecalCtxMenu(null)
                  }
                }}
                onContextMenu={ev => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  setDecalCtxMenu({ id: decal.id, x: ev.clientX, y: ev.clientY })
                }}
                style={{
                  width: 44,
                  height: 'auto',
                  minHeight: 44,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  borderRadius: 8,
                  background: isActive ? `${EDITOR_ACCENT}33` : 'rgba(255,255,255,0.04)',
                  border: dragOverId === decal.id && dragDecalId !== decal.id
                    ? `2px dashed ${EDITOR_ACCENT}`
                    : isActive
                      ? `2px solid ${EDITOR_ACCENT}`
                      : isMulti
                        ? `1.5px solid ${EDITOR_ACCENT}99`
                        : '1px solid rgba(255,255,255,0.08)',
                  cursor: dragDecalId ? 'grabbing' : 'grab',
                  opacity: decal.visible ? (dragDecalId === decal.id ? 0.5 : 1) : 0.35,
                  position: 'relative',
                  overflow: 'visible',
                  outline: 'none',
                  padding: '2px 2px 4px',
                }}
              >
                {src ? (
                  <img
                    src={src.dataUrl}
                    alt=""
                    style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4 }}
                  />
                ) : (
                  <span style={{ fontSize: 10, color: EDITOR_TEXT_4 }}>?</span>
                )}
                {/* G6: Layer name label / inline rename input */}
                {renamingDecalId === decal.id ? (
                  <input
                    autoFocus
                    type="text"
                    defaultValue={decal.name}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        e.preventDefault()
                        const newName = (e.currentTarget as HTMLInputElement).value.trim()
                        if (newName && e.key === 'Enter') {
                          mutate(p => updateCellDecal(p, decal.id, d => ({ ...d, name: newName })))
                        }
                        setRenamingDecalId(null)
                      }
                    }}
                    onBlur={e => {
                      const newName = e.currentTarget.value.trim()
                      if (newName) {
                        mutate(p => updateCellDecal(p, decal.id, d => ({ ...d, name: newName })))
                      }
                      setRenamingDecalId(null)
                    }}
                    style={{
                      width: 40,
                      fontSize: 8,
                      color: '#fff',
                      background: 'rgba(0,0,0,0.6)',
                      border: `1px solid ${EDITOR_ACCENT}`,
                      borderRadius: 3,
                      padding: '1px 2px',
                      outline: 'none',
                      textAlign: 'center',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 8,
                      color: EDITOR_TEXT_4,
                      maxWidth: 42,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                      lineHeight: 1,
                      userSelect: 'none',
                    }}
                    title={`${decal.name} — double-click to rename`}
                  >
                    {decal.name}
                  </span>
                )}
                {/* Lock position toggle */}
                <button
                  type="button"
                  title={posLocked ? 'Unlock position (click)' : 'Lock position (click)'}
                  onClick={ev => {
                    ev.stopPropagation()
                    mutate(p =>
                      updateCellDecal(p, decal.id, d => ({
                        ...d,
                        locked: { ...d.locked, position: !posLocked },
                      })),
                    )
                  }}
                  style={{
                    position: 'absolute',
                    bottom: -6,
                    right: -6,
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: posLocked ? 'rgba(255,200,0,0.85)' : 'rgba(30,32,40,0.9)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {posLocked ? (
                    <Lock size={8} color="#1a1a1a" aria-hidden />
                  ) : (
                    <LockOpen size={8} color="rgba(255,255,255,0.5)" aria-hidden />
                  )}
                </button>
                {/* Clipping mask toggle — top-left corner. */}
                <button
                  type="button"
                  title={
                    decal.clippedToDecalBelow
                      ? 'Clipped to decal below (click to release)'
                      : 'Not clipped — click to clip to decal below'
                  }
                  data-testid={`clip-toggle-${decal.id}`}
                  onClick={ev => {
                    ev.stopPropagation()
                    mutate(p =>
                      updateCellDecal(p, decal.id, d => ({
                        ...d,
                        clippedToDecalBelow: d.clippedToDecalBelow ? undefined : true,
                      })),
                    )
                  }}
                  style={{
                    position: 'absolute',
                    top: -6,
                    left: -6,
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: decal.clippedToDecalBelow
                      ? 'rgba(120,180,255,0.85)'
                      : 'rgba(30,32,40,0.9)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                    color: decal.clippedToDecalBelow ? '#fff' : 'rgba(255,255,255,0.4)',
                  }}
                >
                  <CornerDownLeft size={8} aria-hidden />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Decal strip context menu */}
      {decalCtxMenu &&
        (() => {
          const decal = cellDecals.find(d => d.id === decalCtxMenu.id)
          if (!decal) return null
          return (
            <div
              style={{
                position: 'fixed',
                left: decalCtxMenu.x,
                top: decalCtxMenu.y,
                zIndex: 200,
                background: 'rgba(20,22,28,0.96)',
                backdropFilter: 'blur(24px)',
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
        {/* Top row — peel left, Live Sync badge right */}
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
        />
      </div>

      {/* ── Zoom % readout pill — bottom-right corner ─────────────────────
          Shows the current zoom percentage. "Fit" resets to the default
          4× and "1:1" snaps to 100% (exact pixels). */}
      <div
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
          background: 'rgba(15, 17, 22, 0.75)',
          backdropFilter: 'blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'blur(40px) saturate(150%)',
          border: '0.5px solid rgba(255, 255, 255, 0.08)',
          boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
          WebkitAppRegion: 'no-drag',
        } as CSSProperties}
      >
        {/* Zoom percentage label */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
            color: EDITOR_TEXT_2,
            minWidth: 36,
            textAlign: 'right',
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        {/* Hairline divider */}
        <span aria-hidden style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.10)', flexShrink: 0 }} />
        {/* Fit button — resets to default 4× */}
        <button
          type="button"
          title="Fit to default zoom (4×)"
          aria-label="Fit zoom"
          onClick={() => setZoom(4)}
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
        {/* 1:1 button — snaps to 100% */}
        <button
          type="button"
          title="Actual size (100%)"
          aria-label="100% zoom"
          onClick={() => setZoom(1)}
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
    background: active ? 'rgba(120,180,255,0.18)' : 'rgba(255,255,255,0.06)',
    border: `1px solid ${active ? 'rgba(120,180,255,0.6)' : 'rgba(255,255,255,0.12)'}`,
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
                background: nudgeStep === opt ? 'rgba(120,180,255,0.18)' : 'rgba(255,255,255,0.04)',
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
                  background: snapGridStep === opt ? 'rgba(120,180,255,0.18)' : 'rgba(255,255,255,0.04)',
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
        {/* ── Numeric XY position inputs ── */}
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
        {/* X position */}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.10em',
            textTransform: 'uppercase' as const,
            color: EDITOR_TEXT_4,
            flexShrink: 0,
          }}>X</span>
          <input
            type="number"
            style={{
              width: 50,
              height: 26,
              background: 'rgba(255,255,255,0.05)',
              border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: 5,
              color: EDITOR_TEXT_2,
              fontSize: 11,
              padding: '0 5px',
              outline: 'none',
              appearance: 'textfield',
              MozAppearance: 'textfield',
            }}
            value={Math.round(activeDecal.x)}
            min={0}
            max={DECAL_PACK_SIZE}
            step={1}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) onUpdateActive(d => ({ ...d, x: v }))
            }}
            onClick={e => (e.target as HTMLInputElement).select()}
          />
        </label>
        {/* Y position */}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.10em',
            textTransform: 'uppercase' as const,
            color: EDITOR_TEXT_4,
            flexShrink: 0,
          }}>Y</span>
          <input
            type="number"
            style={{
              width: 50,
              height: 26,
              background: 'rgba(255,255,255,0.05)',
              border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: 5,
              color: EDITOR_TEXT_2,
              fontSize: 11,
              padding: '0 5px',
              outline: 'none',
              appearance: 'textfield',
              MozAppearance: 'textfield',
            }}
            value={Math.round(activeDecal.y)}
            min={0}
            max={DECAL_PACK_SIZE}
            step={1}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) onUpdateActive(d => ({ ...d, y: v }))
            }}
            onClick={e => (e.target as HTMLInputElement).select()}
          />
        </label>
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
        <BlendModeSelect
          compact
          value={activeDecal.blendMode as import('@/lib/faceplate-project').BlendMode | undefined}
          onChange={next => onUpdateActive(d => ({ ...d, blendMode: next as typeof d.blendMode }))}
          label="Blend"
        />
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

function checkerBackground(): string {
  return `repeating-conic-gradient(
    rgba(255,255,255,0.04) 0% 25%,
    rgba(255,255,255,0.01) 25% 50%
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
function loadImageForPreview(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const el = new Image()
    el.onload = () => res(el)
    el.onerror = () => rej(new Error('Image decode failed for preview'))
    el.src = src
  })
}
