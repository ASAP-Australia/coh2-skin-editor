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
  Brush,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Contrast,
  CornerDownLeft,
  Copy,
  Crosshair,
  Droplet,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Image as ImageIcon,
  Library,
  Lock,
  LockOpen,
  Maximize2,
  MousePointer2,
  Palette,
  Pencil,
  RotateCcw,
  Sliders,
  Sun,
  Trash2,
} from 'lucide-react'
import { applySnap, type SnapTarget } from '@/lib/snap-guides'
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
import { StateIcon } from '@/components/LiveSyncBadge'
import AtlasViewPanel from '@/components/AtlasViewPanel'
import DecalPackInGamePreview from '@/components/DecalPackInGamePreview'
import {
  type AtlasViewMode,
  loadDecalViewMode,
  persistDecalViewMode,
} from '@/lib/atlas-view-settings'
import ImageDropZone, { type ImageDropZoneHandle } from './editor-shared/ImageDropZone'
import { PackIdentityPopover } from './PackIdentityPopover'
import { BorderBeam } from '@/components/ui/border-beam'
import { makeDecalPublishTarget } from '@/components/PublishToWorkshopDialog'
import { PublishSection } from '@/components/PublishSection'
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

export default function DecalPackEditor({ project: initialProject, onBack, installRoot }: Props) {
  const [project, setProject] = useState<Coh2DecalPackProject>(initialProject)
  const [activeTool, setActiveTool] = useState<DecalToolId>('select')
  /** Non-null when the batch-import picker hit the 32-file cap. */
  const [batchWarning, setBatchWarning] = useState<string | null>(null)
  const undoStack = useRef<Coh2DecalPackProject[]>([])
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
  const liveStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef(false)

  // ── Multi-select state ────────────────────────────────────────────────
  /** Additional selected decal ids for multi-select (Cmd/Ctrl-click). */
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())

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
    setProject(prev)
    saveDecalPackToLocal(prev)
    scheduleLiveSync('decal', prev)
  }, [])

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
      mutate(p => ({
        ...p,
        sourceImages: { ...p.sourceImages, ...draft.sourceImages },
        decals: [...p.decals, decal],
        activeDecalId: decal.id,
      }))
    },
    [project, mutate],
  )

  const onAddImageFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const draft = structuredClone(project)
        void addDecalSourceImageFromFile(draft, file)
          .then(imageId => {
            const decal = newDecal(draft, imageId, file.name)
            mutate(p => ({
              ...p,
              sourceImages: { ...p.sourceImages, ...draft.sourceImages },
              decals: [...p.decals, decal],
              activeDecalId: decal.id,
            }))
          })
          .catch(e => console.warn('decal source import failed', e))
      }
    },
    [project, mutate],
  )

  const onAddImageToCanvas = useCallback(
    (imageId: string) => {
      mutate(p => {
        const decal = newDecal(p, imageId)
        return { ...p, decals: [...p.decals, decal], activeDecalId: decal.id }
      })
    },
    [mutate],
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
    mutate(p => ({
      ...p,
      sourceImages: { ...p.sourceImages, ...draft.sourceImages },
      decals: [...p.decals, ...newDecals],
      activeDecalId: lastDecal.id,
    }))

    if (capped) {
      setBatchWarning(
        `Only the first ${BATCH_IMPORT_MAX} files were imported. Please import the remaining files separately.`,
      )
    }
  }, [project, mutate])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  const activeDecal = useMemo(
    () => project.decals.find(d => d.id === project.activeDecalId) ?? null,
    [project.decals, project.activeDecalId],
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

      if (meta && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
        ev.preventDefault()
        undo()
        return
      }
      if (!activeDecal) return
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault()
        const targetId = activeDecal.id
        mutate(p => {
          const idx = p.decals.findIndex(d => d.id === targetId)
          if (idx < 0) return p
          const next = p.decals.filter(d => d.id !== targetId)
          let newActiveId: string | null = p.activeDecalId
          if (p.activeDecalId === targetId) {
            const neighbour = next[idx] ?? next[idx - 1] ?? null
            newActiveId = neighbour ? neighbour.id : null
          }
          return { ...p, decals: next, activeDecalId: newActiveId }
        })
      } else if (
        ev.key === 'ArrowUp' ||
        ev.key === 'ArrowDown' ||
        ev.key === 'ArrowLeft' ||
        ev.key === 'ArrowRight'
      ) {
        ev.preventDefault()
        const dx = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0
        const dy = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0
        const step = ev.shiftKey ? 10 : 1
        mutate(p =>
          updateDecal(p, activeDecal.id, d => ({
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
  }, [activeDecal?.id, mutate, undo])

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
        mutate(p => ({
          ...p,
          decals: [...p.decals, ...copies],
          activeDecalId: copies[copies.length - 1].id,
        }))
      }
    }
    window.addEventListener('keydown', onCopyPaste)
    return () => window.removeEventListener('keydown', onCopyPaste)
  }, [activeDecal, mutate])

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

  // ── Decal manipulation ───────────────────────────────────────────────────
  const setActive = useCallback(
    (id: string) => mutate(p => ({ ...p, activeDecalId: id }), { undoable: false }),
    [mutate],
  )

  const deleteDecal = useCallback(
    (id: string) => {
      mutate(p => {
        const idx = p.decals.findIndex(d => d.id === id)
        if (idx < 0) return p
        const next = p.decals.filter(d => d.id !== id)
        let newActiveId: string | null = p.activeDecalId
        if (p.activeDecalId === id) {
          const neighbour = next[idx] ?? next[idx - 1] ?? null
          newActiveId = neighbour ? neighbour.id : null
        }
        return { ...p, decals: next, activeDecalId: newActiveId }
      })
    },
    [mutate],
  )

  const moveDecal = useCallback(
    (id: string, dir: -1 | 1) =>
      mutate(p => {
        const idx = p.decals.findIndex(d => d.id === id)
        if (idx < 0) return p
        const j = idx + dir
        if (j < 0 || j >= p.decals.length) return p
        const next = p.decals.slice()
        ;[next[idx], next[j]] = [next[j], next[idx]]
        return { ...p, decals: next }
      }),
    [mutate],
  )

  const duplicateDecal = useCallback(
    (id: string) =>
      mutate(p => {
        const orig = p.decals.find(d => d.id === id)
        if (!orig) return p
        const copy: Decal = { ...orig, id: freshDecalId(), name: orig.name + ' (copy)' }
        const idx = p.decals.findIndex(d => d.id === id)
        const next = p.decals.slice()
        next.splice(idx + 1, 0, copy)
        return { ...p, decals: next, activeDecalId: copy.id }
      }),
    [mutate],
  )

  const updateActive = useCallback(
    (fn: (d: Decal) => Decal) => {
      if (!activeDecal) return
      mutate(p => updateDecal(p, activeDecal.id, fn))
    },
    [activeDecal, mutate],
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

      // Build snap targets: canvas edges, canvas centre.
      // Decal x/y is the decal centre position (translate(-50%,-50%)).
      const snapTargets: SnapTarget[] = [
        { kind: 'x', value: DECAL_PACK_SIZE / 2, label: 'canvas center X' },
        { kind: 'y', value: DECAL_PACK_SIZE / 2, label: 'canvas center Y' },
        { kind: 'x', value: 0, label: 'canvas left edge' },
        { kind: 'x', value: DECAL_PACK_SIZE, label: 'canvas right edge' },
        { kind: 'y', value: 0, label: 'canvas top edge' },
        { kind: 'y', value: DECAL_PACK_SIZE, label: 'canvas bottom edge' },
      ]

      const onMove = (e: PointerEvent) => {
        const dx = (e.clientX - startClientX) / viewScale
        const dy = (e.clientY - startClientY) / viewScale
        const candidateX = startX + dx
        const candidateY = startY + dy
        const { snappedX, snappedY, firedTargets } = applySnap(candidateX, candidateY, snapTargets)
        setSnapGuides(firedTargets)
        mutate(
          p =>
            updateDecal(p, activeDecal.id, d => ({
              ...d,
              x: snappedX,
              y: snappedY,
            })),
          { undoable: false },
        )
      }
      const onUp = () => {
        setSnapGuides([])
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [activeDecal, activeTool, viewScale, mutate, setSnapGuides],
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
        setProject(prev => {
          const decal = prev.decals.find(d => d.id === decalId)
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
                  const d = p.decals.find(x => x.id === decalId)
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
                const d = p.decals.find(x => x.id === decalId)
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
      const visibleDecal = project.decals.find(d => d.visible)
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

      // Render decal texture (128×128)
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
      const decalRgba = texCtx
        ? texCtx.getImageData(0, 0, DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE).data
        : new Uint8ClampedArray(DECAL_TEXTURE_SIZE * DECAL_TEXTURE_SIZE * 4)

      // Build a 1024×1024 preview canvas from the source image at natural
      // resolution so the Workshop thumbnail is sharp. The 64×64 iconCanvas
      // is kept for the pack icon and in-game DXT5 pipeline (unchanged).
      const PREVIEW_SIZE = 1024
      const previewCanvas = document.createElement('canvas')
      previewCanvas.width = previewCanvas.height = PREVIEW_SIZE
      const previewCtx = previewCanvas.getContext('2d')
      if (visibleDecal && previewCtx) {
        const src = project.sourceImages[visibleDecal.sourceImageId]
        if (src) {
          const img = new Image()
          img.src = src.dataUrl
          await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r() })
          const rendered = rasteriseDecal(visibleDecal, img)
          // Center-fit rendered decal with ~10% padding, no upscaling of tiny canvas
          const PAD = PREVIEW_SIZE * 0.10
          const maxW = PREVIEW_SIZE - PAD * 2
          const maxH = PREVIEW_SIZE - PAD * 2
          const scaleF = Math.min(maxW / rendered.width, maxH / rendered.height)
          const dW = Math.round(rendered.width * scaleF)
          const dH = Math.round(rendered.height * scaleF)
          const dX = Math.round((PREVIEW_SIZE - dW) / 2)
          const dY = Math.round((PREVIEW_SIZE - dH) / 2)
          previewCtx.imageSmoothingEnabled = true
          previewCtx.imageSmoothingQuality = 'high'
          previewCtx.drawImage(rendered, dX, dY, dW, dH)
        }
      }

      const result = await buildDecalMod({ project, iconRgba, decalRgba, guid })
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
            display: 'grid',
            placeItems: 'center',
            padding: '120px 80px 160px 80px',
            WebkitAppRegion: 'no-drag',
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
            width: 'min(384px, calc(100vh - 200px))',
            height: 'min(384px, calc(100vh - 200px))',
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
              const hasAdj = brightness !== 100 || contrast !== 100 || saturation !== 100
              const filterCss = hasAdj
                ? `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`
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

      <EditorHomeButton
        onClick={onBack}
        style={{
          position: 'fixed',
          top: 'calc(12px + var(--app-top-inset, 0px))',
          left: 12,
          zIndex: 50,
        }}
      />

      {/* ── Centered pack-name title pill — top-centre of viewport ──────────
          Mirrors FaceplateEditor's centered title pattern so the user
          always sees which pack they're editing. Click to open the identity
          popover (name / description / author / icon). These ARE the
          in-game text fields — name appears above the decal grid and on
          the equip card; description is the body text on that card.
          The Live Sync status icon is rendered inline at the end of the
          title text — hover reveals the reason. */}
      <div
        style={
          {
            position: 'fixed',
            top: 'calc(12px + var(--app-top-inset, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            WebkitAppRegion: 'no-drag',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          } as CSSProperties
        }
      >
        {project.titleAcknowledged === false ? (
          <BorderBeam colorVariant="ocean" duration={5} strength={0.85} borderRadius={12} borderWidth={1}>
            <button
              type="button"
              title={liveSyncTitle}
              aria-label={liveSyncAriaLabel}
              onClick={() => {
                if (project.titleAcknowledged === false) {
                  mutate(p => ({ ...p, titleAcknowledged: true }), { undoable: false })
                }
                setPackNameEditOpen(v => !v)
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 36,
                paddingLeft: 14,
                paddingRight: 14,
                borderRadius: 12,
                background: 'rgba(15, 17, 22, 0.75)',
                backgroundImage:
                  'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
                backdropFilter: 'blur(40px) saturate(150%)',
                WebkitBackdropFilter: 'blur(40px) saturate(150%)',
                border: '0.5px solid rgba(255, 255, 255, 0.08)',
                boxShadow:
                  'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.2)',
                color: 'rgba(247,247,250,0.88)',
                cursor: 'pointer',
                padding: '0 14px',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                maxWidth: 'calc(100vw - 200px)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {project.packName || 'Unnamed Decal Pack'}
              </span>
              <span style={{ display: 'inline-flex', flex: 'none', transform: 'scale(0.85)' }}>
                <StateIcon state={sync.state} />
              </span>
            </button>
          </BorderBeam>
        ) : (
          <button
            type="button"
            title={liveSyncTitle}
            aria-label={liveSyncAriaLabel}
            onClick={() => {
              setPackNameEditOpen(v => !v)
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              height: 36,
              paddingLeft: 14,
              paddingRight: 14,
              borderRadius: 12,
              background: 'rgba(15, 17, 22, 0.75)',
              backgroundImage:
                'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
              backdropFilter: 'blur(40px) saturate(150%)',
              WebkitBackdropFilter: 'blur(40px) saturate(150%)',
              border: '0.5px solid rgba(255, 255, 255, 0.08)',
              boxShadow:
                'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.2)',
              color: 'rgba(247,247,250,0.88)',
              cursor: 'pointer',
              padding: '0 14px',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              maxWidth: 'calc(100vw - 200px)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.packName || 'Unnamed Decal Pack'}
            </span>
            <span style={{ display: 'inline-flex', flex: 'none', transform: 'scale(0.85)' }}>
              <StateIcon state={sync.state} />
            </span>
          </button>
        )}

        {/* Pack identity popover — name / description / author / icon.
            Name and Description ARE the in-game text fields: name appears
            above the decal grid in the customise screen and on the equip
            card; description is the body text on that card.
            Uses the shared PackIdentityPopover so all identity-edit surfaces
            stay in sync. Escape / outside-click closes (autosync, no Save). */}
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
            // Autosync — fired per-keystroke; do NOT close on each change.
            // The popover closes on Escape / outside-click via onClose.
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
            />
          }
          locked={isUploading || isBuildingTarget}
        />
      </div>

      {/* LobbyPreviewPanel was removed in v1.0 — the in-editor player-card
          mock didn't accurately match what the player sees in the CoH2
          customisation screen (the engine renders the decal against a
          different chip layout + lighting than our mock), so it gave the
          user a false impression of the final look. The DecalPackInGamePreview
          (separate component, accurate to the customisation screen) and the
          live canvas at 128×128 native size are now the source-of-truth
          previews. */}

      {/* Always-visible vertical decal strip — left-center */}
      {project.decals.length > 0 && (
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
          {project.decals.map(decal => {
            const isActive = decal.id === project.activeDecalId
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
                onClick={ev => {
                  ev.stopPropagation()
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
                  height: 44,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  background: isActive ? `${EDITOR_ACCENT}33` : 'rgba(255,255,255,0.04)',
                  border: isActive
                    ? `2px solid ${EDITOR_ACCENT}`
                    : isMulti
                      ? `1.5px solid ${EDITOR_ACCENT}99`
                      : '1px solid rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                  opacity: decal.visible ? 1 : 0.35,
                  position: 'relative',
                  overflow: 'visible',
                  outline: 'none',
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
                {/* Lock position toggle */}
                <button
                  type="button"
                  title={posLocked ? 'Unlock position (click)' : 'Lock position (click)'}
                  onClick={ev => {
                    ev.stopPropagation()
                    mutate(p =>
                      updateDecal(p, decal.id, d => ({
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
                      updateDecal(p, decal.id, d => ({
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
          const decal = project.decals.find(d => d.id === decalCtxMenu.id)
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
                      mutate(p => updateDecal(p, decal.id, d => ({ ...d, visible: !d.visible })))
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
              mirrorX={mirrorX}
              setMirrorX={setMirrorX}
              mirrorY={mirrorY}
              setMirrorY={setMirrorY}
              onClearPaint={() => {
                if (!activeDecal) return
                const decalId = activeDecal.id
                mutate(p => {
                  const d = p.decals.find(x => x.id === decalId)
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

      {/* Canvas view-mode picker — right-edge vertical stack. Mirrors the
       *  Vehicle Viewport's ScenePanel and FaceplateEditor's AtlasViewPanel
       *  so all three editor surfaces share the same control. */}
      <AtlasViewPanel mode={viewMode} setMode={setViewMode} ariaLabel="Decal pack view mode" />

      {/* In-game preview overlay — replaces the editor surface with the
       *  CoH2 customise-screen 3-column decal grid mock. The user switches
       *  back via the view-mode panel to resume editing. */}
      {viewMode === 'in_game' && (
        <div
          data-testid="decal-in-game-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 25,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(10,11,14,0.92)',
            backdropFilter: 'blur(12px) saturate(140%)',
            padding: '80px 80px 200px 80px',
            overflowY: 'auto',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ maxWidth: 520, width: '100%' }}>
            <DecalPackInGamePreview project={project} installRoot={installRoot} />
          </div>
        </div>
      )}

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
                    mutate(p => ({
                      ...p,
                      sourceImages: { ...p.sourceImages, ...draft.sourceImages },
                      decals: [...p.decals, decal],
                      activeDecalId: decal.id,
                    }))
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
  brushColor,
  setBrushColor,
  brushOpacity,
  setBrushOpacity,
  brushErase,
  setBrushErase,
  mirrorX,
  setMirrorX,
  mirrorY,
  setMirrorY,
  onClearPaint,
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
  brushColor: string
  setBrushColor: (v: string) => void
  brushOpacity: number
  setBrushOpacity: (v: number) => void
  brushErase: boolean
  setBrushErase: (v: boolean) => void
  mirrorX: boolean
  setMirrorX: (v: boolean) => void
  mirrorY: boolean
  setMirrorY: (v: boolean) => void
  onClearPaint: () => void
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
    return null
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
        {/* Separator between transform and adjust controls */}
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
        <PanelButton
          disabled={
            (activeDecal.brightness ?? 100) === 100 &&
            (activeDecal.contrast ?? 100) === 100 &&
            (activeDecal.saturation ?? 100) === 100
          }
          onClick={() =>
            onUpdateActive(d => ({ ...d, brightness: 100, contrast: 100, saturation: 100 }))
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
        {/* Brush colour — visually muted in erase mode. */}
        <div style={{ opacity: brushErase ? 0.4 : 1, pointerEvents: brushErase ? 'none' : 'auto' }}>
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

function updateDecal(
  p: Coh2DecalPackProject,
  id: string,
  fn: (d: Decal) => Decal,
): Coh2DecalPackProject {
  return {
    ...p,
    decals: p.decals.map(d => (d.id === id ? fn(d) : d)),
  }
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
