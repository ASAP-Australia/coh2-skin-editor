/**
 * FaceplateEditor — minimal full-screen composer for CoH2 player faceplates.
 *
 * Visual structure:
 *   [ Topbar: just the Back chip ]
 *   [ Canvas section: live in-game preview pinned top-left,
 *                     624×204 banner canvas dead-centered ]
 *
 * The canvas IS the in-game pixel grid (no scaling), so the user judges
 * legibility at engine-display size. The in-game preview overlay shows
 * exactly where the artwork lands in CoH2's lobby (profile banner + the
 * 64² chat / scoreboard icon) and updates live as the user edits — no
 * "export, preview, install" round-trip required.
 *
 * Interaction:
 *   • Drop or paste an image → added as a top layer at the drop point.
 *   • Drag a layer body to translate; corner handles scale; rotate handle
 *     spins. Hold Shift while resizing for finer increments.
 *   • Delete / Backspace removes the selected layer.
 *   • Bracket keys ] / [ raise / lower the layer.
 *   • Cmd/Ctrl-Z undoes — backed by a snapshot stack of project states.
 *
 * Persistence:
 *   • Auto-saves to localStorage on EVERY mutation — synchronous, no
 *     debounce. The user can never lose work to a crash or accidental
 *     refresh because the state on disk is always current.
 *   • Recent-projects thumbnail refreshes whenever the live preview
 *     re-composes.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { scheduleLiveSync, useLiveSync } from '@/lib/live-sync'
import {
  type Coh2FaceplateProject,
  type FaceplateLayer,
  type ImageLayer,
  type ShapeLayer,
  type PaintLayer,
  type TextLayer,
  type ShapeKind,
  type GradientFill,
  type LayerStroke,
  FACEPLATE_BANNER_W,
  FACEPLATE_BANNER_H,
  LAYER_SHADOW_DEFAULTS,
  addFaceplateImageFromBlob,
  imageFilterCss,
  makeDefaultLayer,
  newShapeLayer,
  newTextLayer,
  newPaintLayer,
  persistFaceplate,
  updateRecentFaceplateThumbnail,
} from '@/lib/faceplate-project'
import { writeClipboard, readClipboard, type ClipboardEntry } from '@/lib/editor-clipboard'
import { INSIGNIA_LIBRARY, type InsigniaEntry } from '@/lib/insignia-library'
import HexColorInput from '@/components/editor-primitives/HexColorInput'
import CurvesEditor from '@/components/editor-primitives/CurvesEditor'
import {
  AlignCenter,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Bold,
  Brush,
  CaseSensitive,
  Circle,
  CornerDownLeft,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Layers,
  Library,
  Lock,
  LockOpen,
  MoveHorizontal,
  MoveVertical,
  MousePointer2,
  Palette,
  Pencil,
  Shapes,
  Slash,
  Sliders,
  Star,
  Sun,
  TextCursorInput,
  Trash2,
  Type,
  WholeWord,
} from 'lucide-react'
import { applySnap, type SnapTarget } from '@/lib/snap-guides'
import { StateIcon } from '@/components/LiveSyncBadge'
import AtlasViewPanel from '@/components/AtlasViewPanel'
import FaceplateInGamePreview from '@/components/FaceplateInGamePreview'
import {
  type AtlasViewMode,
  loadFaceplateViewMode,
  persistFaceplateViewMode,
} from '@/lib/atlas-view-settings'
import ImageDropZone from './editor-shared/ImageDropZone'
import CanvasHandles from './editor-shared/CanvasHandles'
import { PackIdentityPopover } from './PackIdentityPopover'
import { makeFaceplatePublishTarget } from '@/components/PublishToWorkshopDialog'
import { PublishSection } from '@/components/PublishSection'
import {
  AdjustmentPanel,
  BlendModeSelect,
  BottomToolPill,
  CanvasPlaceholder,
  EditorHomeButton,
  GlassModal,
  GlassToast,
  GradientFillEditor,
  SliderPopover,
  ToolOptionsPeel,
  type ToolDef,
  EDITOR_ACCENT,
  EDITOR_TEXT_2,
  EDITOR_TEXT_3,
  EDITOR_TEXT_4,
} from './editor-primitives'

interface Props {
  project: Coh2FaceplateProject
  onBack: () => void
}

/** Maximum undo depth — bounded so memory doesn't grow without limit on
 *  long editing sessions. 50 steps is generous for a UI editor. */
const UNDO_LIMIT = 50

/** No debounce on the live in-game preview — the user explicitly asked
 *  for instantaneous updates so they see exactly what their composition
 *  will look like in-game on every keystroke and drag tick. The compose
 *  cost is bounded (624×204 PNG, ~5ms on a modern CPU) and we run an
 *  in-flight guard via `cancelled` so a fast drag never queues a backlog
 *  of stale promises — only the newest compose result lands on screen. */

/** Stable identifiers for the bottom-pill tools. The union type keeps
 *  the activeTool state and BottomToolPill type-tight. */
type FaceplateToolId =
  | 'select'
  | 'text'
  | 'shapes'
  | 'draw'
  | 'shadow'
  | 'background'
  | 'align'
  | 'mask'

export default function FaceplateEditor({ project: initialProject, onBack }: Props) {
  const [project, setProject] = useState<Coh2FaceplateProject>(initialProject)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Additional selected layer ids for multi-select (Cmd/Ctrl-click). */
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  /** Currently-active editor tool. Drives both the bottom pill's selected
   *  segment and the contents of the floating options peel above it. */
  const [activeTool, setActiveTool] = useState<FaceplateToolId>('select')
  const undoStack = useRef<Coh2FaceplateProject[]>([])
  const [exportToast, setExportToast] = useState<string | null>(null)
  /** Whether the insignia library modal is open. */
  const [insigniaOpen, setInsigniaOpen] = useState(false)
  /** Whether the centered title-rename popover is open. */
  const [packNameEditOpen, setPackNameEditOpen] = useState(false)
  // ── Live Sync state (for title pill inline icon) ───────────────────────
  const sync = useLiveSync()
  const liveSyncTitle = sync.enabled
    ? `Click to rename — Live Sync: ${sync.reason}`
    : 'Click to rename — Live Sync is off'
  const liveSyncAriaLabel = sync.enabled
    ? `Project name — click to rename. Live Sync: ${sync.reason}`
    : 'Project name — click to rename. Live Sync is off'
  /** Publish-to-Workshop inline section. */
  const [publishTarget, setPublishTarget] = useState<import('@/components/PublishToWorkshopDialog').WorkshopPublishTarget | null>(null)
  const [isBuildingTarget, setIsBuildingTarget] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  // ── Canvas view mode ──────────────────────────────────────────────────
  // Three-position visualisation switcher driven by the right-edge
  // AtlasViewPanel (mirrors the Vehicle Viewport's ScenePanel):
  //   • 'template'     — editor scaffolding (dashed border, arrows)
  //   • 'checkerboard' — light checker behind layers (alpha preview)
  //   • 'in_game'      — replaces the canvas with FaceplateInGamePreview
  // Persisted to localStorage so users return to their preferred view on
  // next open. `previewTransparent` is a derived boolean to keep the
  // existing canvas-style branches readable.
  const [viewMode, setViewMode] = useState<AtlasViewMode>(loadFaceplateViewMode)
  useEffect(() => {
    persistFaceplateViewMode(viewMode)
  }, [viewMode])
  const previewTransparent = viewMode === 'checkerboard'

  // ── Live-composed banner PNG ──────────────────────────────────────────
  // The thumbnail compose effect already builds a 624×204 PNG on every
  // project mutation; we stash the data URL here so the in-game preview
  // mode can render it without re-composing.
  const [bannerPngUrl, setBannerPngUrl] = useState<string | null>(null)
  /** Active faction filter in the insignia picker (null = All). */
  const [insigniaFilter, setInsigniaFilter] = useState<InsigniaEntry['faction'] | null>(null)

  // ── Draw tool state ────────────────────────────────────────────────────
  const [brushSize, setBrushSize] = useState(12)
  const [brushColor, setBrushColor] = useState('#ffffff')
  const [brushOpacity, setBrushOpacity] = useState(1)
  /** Mirror paint across the X axis (left/right). Component-local, not persisted. */
  const [mirrorX, setMirrorX] = useState(false)
  /** Mirror paint across the Y axis (top/bottom). Component-local, not persisted. */
  const [mirrorY, setMirrorY] = useState(false)
  /** Erase mode: when true the paint stroke uses destination-out compositing
   *  to erase pixels rather than paint them. Component-local, not persisted. */
  const [brushErase, setBrushErase] = useState(false)
  /** The offscreen canvas used for live stroke rendering (in-progress). */
  const liveStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Whether a stroke is currently in progress. */
  const isDrawingRef = useRef(false)
  /** Accumulated paint dataUrl before the stroke started (for undo). */
  const preStrokeDataUrlRef = useRef<string | null>(null)

  // ── Mask tool state ────────────────────────────────────────────────────
  /** Brush size shared by the Draw tool and the Mask tool. */
  const [maskBrushSize, setMaskBrushSize] = useState(32)
  /** Brush opacity for mask painting (0..1). */
  const [maskBrushOpacity, setMaskBrushOpacity] = useState(1)
  /** 'hide' paints black (alpha=0) onto the mask; 'reveal' paints white. */
  const [maskPaintMode, setMaskPaintMode] = useState<'hide' | 'reveal'>('hide')
  /** Live mask-stroke canvas while a mask brush stroke is in progress. */
  const liveMaskStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Whether a mask stroke is currently in progress. */
  const isMaskDrawingRef = useRef(false)
  /** Debounce timer for toDataURL serialisation during mask painting. */
  const maskSerialiseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Curves editor state ────────────────────────────────────────────────
  /** Whether the Curves / Tone Presets modal is open. */
  const [curvesOpen, setCurvesOpen] = useState(false)
  /**
   * Adjust-image popover visibility. v1.0 user feedback: previously the
   * popover sprang into the top-right corner the moment ANY image layer
   * was selected, which the user called "random image menu above when I
   * select the menu". Since FaceplateEditor has no dedicated Images
   * tool to gate on (DecalPackEditor does — different editor), the
   * popover is now driven by an explicit user gesture: a small "Adjust"
   * affordance on the selected image layer thumbnail. It auto-closes
   * when the layer selection changes (handled by the useEffect just
   * after this declaration).
   */
  const [adjustImageOpen, setAdjustImageOpen] = useState(false)
  /** Id of the text layer currently being edited inline (Photoshop-style
   *  invisible type box). When non-null, the layer's static text render is
   *  replaced with a contenteditable overlay focused for immediate typing.
   *  Cleared on blur / Escape / commit; if the text is empty at commit
   *  time the layer is removed so the user doesn't accumulate phantom
   *  text layers from accidental clicks. */
  const [editingTextId, setEditingTextId] = useState<string | null>(null)

  // ── Select tool smart-snap state ──────────────────────────────────────
  /** Active snap guide lines while a layer drag is in progress. */
  const [snapGuides, setSnapGuides] = useState<SnapTarget[]>([])

  // ── Layer-thumbnail context menu state ────────────────────────────────
  const [layerCtxMenu, setLayerCtxMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  )

  /** Mutate the project through a pure updater, snapshotting the previous
   *  state into the undo stack and persisting **synchronously** on every
   *  call. Previous behaviour debounced the localStorage write by 250 ms
   *  to batch rapid drags; the user explicitly asked for "automatic saving
   *  whenever anything is done", so the debounce is gone — every keystroke
   *  / drag-tick / mutation lands in localStorage immediately.
   *
   *  Performance note: localStorage.setItem is synchronous + cheap (~1 ms
   *  for the typical faceplate JSON payload, growing to a few ms for
   *  packs with large image libraries). At common drag rates (60 Hz) this
   *  is 5-10 % of a frame budget — well below the cost of the React
   *  re-render that already happens on every mutation. Persisting per
   *  mutation also makes the "did it save?" answer obviously yes. */
  const mutate = useCallback(
    (
      fn: (p: Coh2FaceplateProject) => Coh2FaceplateProject,
      { undoable = true }: { undoable?: boolean } = {},
    ) => {
      setProject(prev => {
        if (undoable) {
          undoStack.current.push(prev)
          if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
        }
        const next = fn(prev)
        // Immediate persist — every mutation = one synchronous localStorage
        // write. The user explicitly asked for change-driven autosave with
        // no debounce.
        persistFaceplate(next)
        // Schedule live-sync if enabled. Debounced so rapid mutations coalesce.
        // v1.0: Live Sync is permanently on (the manager handles
        // missing-handle / mods-folder errors itself), so we no longer
        // gate the schedule call on isEnabled().
        scheduleLiveSync('faceplate', next)
        return next
      })
    },
    [],
  )

  /** Pop the most recent snapshot and restore it. Bound to Cmd/Ctrl-Z. */
  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    if (!prev) return
    setProject(prev)
    persistFaceplate(prev)
  }, [])

  // ── Image import ───────────────────────────────────────────────────────
  /** Shared handler for drop, paste, and file-picker imports.
   *  ImageDropZone calls this for all three paths; we own the project mutation. */
  const onImport = useCallback(
    async (blob: Blob, name = 'pasted-image') => {
      const draft = structuredClone(project)
      let imageId: string
      try {
        imageId = await addFaceplateImageFromBlob(draft, blob, name)
      } catch (e) {
        console.warn('faceplate image import failed', e)
        return
      }
      const layer = makeDefaultLayer(draft, imageId)
      mutate(p => ({
        ...p,
        images: { ...p.images, ...draft.images },
        layers: [...p.layers, layer],
      }))
      setSelectedId(layer.id)
    },
    [project, mutate],
  )

  // ── Add text layer at a specific canvas position (click-to-place) ──────
  // v1.0 Photoshop-style flow: start with an empty string and open the
  // inline edit overlay immediately so the user can start typing without
  // a detour through the properties panel. The "invisible type box" is
  // an absolutely-positioned contenteditable div rendered in place of
  // the static text span (see the text-layer render branch below).
  const addTextLayerAt = useCallback(
    (canvasX: number, canvasY: number) => {
      const layer: TextLayer = { ...newTextLayer(''), x: canvasX, y: canvasY }
      mutate(p => ({ ...p, layers: [...p.layers, layer] }))
      setSelectedId(layer.id)
      setEditingTextId(layer.id)
    },
    [mutate],
  )

  // ── Commit / cancel inline text edit ──────────────────────────────────
  // Called from the contenteditable overlay's blur / Escape / Enter
  // handlers. If the text is empty (user clicked then bailed without
  // typing) we remove the layer so the canvas isn't polluted with empty
  // text artefacts; otherwise we keep whatever was typed.
  const commitTextEdit = useCallback(
    (layerId: string) => {
      mutate(p => {
        const layer = p.layers.find(l => l.id === layerId)
        if (!layer || layer.kind !== 'text') return p
        if (!layer.text.trim()) {
          return { ...p, layers: p.layers.filter(l => l.id !== layerId) }
        }
        return p
      })
      setEditingTextId(null)
    },
    [mutate],
  )

  // ── Duplicate layer ────────────────────────────────────────────────────
  const duplicateLayer = useCallback(
    (id: string) => {
      // Generate the copy up-front so we can setSelectedId immediately —
      // the id is stable and doesn't depend on project state.
      const copyRef = { id: '' }
      mutate(p => {
        const idx = p.layers.findIndex(l => l.id === id)
        if (idx < 0) return p
        const source = p.layers[idx]
        const copy = duplicateLayerHelper(source)
        copyRef.id = copy.id
        const layers = [...p.layers]
        // Insert immediately above (after) the original in the array.
        layers.splice(idx + 1, 0, copy)
        return { ...p, layers }
      })
      // setSelectedId after mutate — React batches these together in a
      // single render so there's no flash of "nothing selected".
      if (copyRef.id) setSelectedId(copyRef.id)
    },
    [mutate],
  )

  /** Keyboard shortcuts. Undo, delete, layer reorder, escape-deselect. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const meta = ev.ctrlKey || ev.metaKey
      // Ignore key events when typing in an input/textarea.
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
      if (meta && ev.key.toLowerCase() === 'd') {
        ev.preventDefault()
        if (selectedId) duplicateLayer(selectedId)
        return
      }
      if (ev.key === 'Escape') {
        setSelectedId(null)
        // Exit text-placement mode back to select tool.
        setActiveTool(prev => (prev === 'text' ? 'select' : prev))
        return
      }
      // T → switch to text tool (click-to-place)
      if (ev.key === 't' || ev.key === 'T') {
        ev.preventDefault()
        setActiveTool('text')
        return
      }
      if (!selectedId) return
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault()
        const allSelected = new Set([selectedId, ...multiSelectedIds])
        mutate(p => ({ ...p, layers: p.layers.filter(l => !allSelected.has(l.id)) }))
        setSelectedId(null)
        setMultiSelectedIds(new Set())
      } else if (ev.key === ']') {
        ev.preventDefault()
        mutate(p => moveLayer(p, selectedId, +1))
      } else if (ev.key === '[') {
        ev.preventDefault()
        mutate(p => moveLayer(p, selectedId, -1))
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
          mapLayer(p, selectedId, l =>
            l.kind === 'group' ? l : { ...l, x: l.x + dx * step, y: l.y + dy * step },
          ),
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, multiSelectedIds, mutate, undo, duplicateLayer])

  // ── Copy / paste (Cmd-C / Cmd-V) ──────────────────────────────────────
  useEffect(() => {
    const onCopyPaste = (ev: KeyboardEvent) => {
      const meta = ev.ctrlKey || ev.metaKey
      if (!meta) return
      const target = ev.target as HTMLElement | null
      const inForm =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (inForm) return

      if (ev.key === 'c' && selectedId) {
        ev.preventDefault()
        // Write all selected layers (primary + multi) to clipboard
        const allSelected = new Set([selectedId, ...multiSelectedIds])
        setProject(prev => {
          const layers = prev.layers.filter(l => allSelected.has(l.id))
          if (layers.length === 0) return prev
          const entry: ClipboardEntry = {
            kind: 'faceplate-layer',
            payload: layers,
            source: { editor: 'faceplate', copiedAt: new Date().toISOString() },
          }
          writeClipboard(entry)
          return prev
        })
        return
      }

      if (ev.key === 'v') {
        ev.preventDefault()
        const entry = readClipboard()
        if (!entry) return
        // Cross-editor rejection: only accept faceplate-layer entries from this editor
        if (entry.kind !== 'faceplate-layer' || entry.source.editor !== 'faceplate') return
        const layers = entry.payload as FaceplateLayer[]
        if (!Array.isArray(layers) || layers.length === 0) return
        // Clone each layer with a fresh id and nudge +16px
        const clones = layers.map(l => {
          const clone = structuredClone(l)
          clone.id = 'layer_' + Math.random().toString(36).slice(2, 10)
          if (clone.kind !== 'group') {
            ;(clone as { x: number }).x = (clone as { x: number }).x + 16
            ;(clone as { y: number }).y = (clone as { y: number }).y + 16
          }
          return clone
        })
        const lastId = clones[clones.length - 1].id
        mutate(p => ({ ...p, layers: [...p.layers, ...clones] }))
        setSelectedId(lastId)
        setMultiSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onCopyPaste)
    return () => window.removeEventListener('keydown', onCopyPaste)
  }, [selectedId, multiSelectedIds, mutate])

  // ── Live in-editor thumbnail composition ──────────────────────────────
  // Recompose the 624×204 PNG on EVERY project change — no debounce. The
  // PNG feeds the recent-projects thumbnail on the start screen so the
  // user sees live progress without having to open / close anything.
  // (The previous in-editor LobbyPreviewPanel was removed in v1.0 — the
  // 624×204 atlas IS the preview at this aspect ratio, so an in-editor
  // mock-up was redundant chrome that just stole canvas real estate.)
  // The `cancelled` guard prevents a stale fast-drag promise from
  // overwriting a newer thumbnail.
  useEffect(() => {
    let cancelled = false
    composeFaceplatePng(project)
      .then(url => {
        if (cancelled) return
        setBannerPngUrl(url)
        try {
          updateRecentFaceplateThumbnail(project.id, url)
        } catch {
          /* swallow — thumbnail update is best-effort */
        }
      })
      .catch(e => {
        if (cancelled) return
        // Composition is best-effort; the canvas the user is editing
        // never goes away if a preview compose fails (decoding a bad
        // image, etc.). Log and move on.
        console.warn('faceplate preview compose failed', e)
      })
    return () => {
      cancelled = true
    }
  }, [project])

  // ── Canvas size ────────────────────────────────────────────────────────
  // The canvas is pinned to the exact in-game pixel dimensions of the
  // faceplate banner (624 × 204 px). It does NOT scale with the
  // application window — the user gets to see the artwork at its true
  // engine-display size so they can judge legibility, letter weights,
  // and contrast against the chrome that will frame it in CoH2's lobby.
  // The wrapper grid centres it inside the canvas section, and the
  // section grows to fill the viewport below the topbar.
  //
  // Because the canvas IS the in-game pixel grid, viewScale is always 1
  // and we no longer need a ResizeObserver / DOMRect read on every paint.
  // Layer coordinates are stored in canvas-space pixels, so they map
  // 1:1 to screen pixels here.
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewScale = 1

  const selectedLayer = useMemo(
    () => project.layers.find(l => l.id === selectedId) ?? null,
    [project.layers, selectedId],
  )

  // The Adjust-Image popover is gated by `adjustImageOpen && selectedLayer
  // ?.kind === 'image'` at the render site, so when the user picks a
  // non-image (or no) layer the popover hides automatically — no effect
  // needed. The Sliders toggle button is also conditionally rendered on
  // the same `selectedLayer?.kind === 'image'` check, so its aria-pressed
  // state stays consistent even though `adjustImageOpen` persists across
  // selection changes. When the user re-selects an image layer, the
  // popover re-opens in its previous state, which we found preserves
  // user intent for rapid multi-layer editing without re-introducing the
  // original "random image menu" complaint (it only ever opens via an
  // explicit click on the Sliders button).

  // Tool definitions for the bottom pill.
  // Order: select, text, shapes, draw, shadow, background, align
  const FACEPLATE_TOOLS: readonly ToolDef<FaceplateToolId>[] = [
    { id: 'select', icon: <MousePointer2 size={20} />, label: 'Select' },
    { id: 'text', icon: <Type size={20} />, label: 'Text' },
    { id: 'shapes', icon: <Shapes size={20} />, label: 'Shapes' },
    { id: 'draw', icon: <Pencil size={20} />, label: 'Draw' },
    { id: 'shadow', icon: <Sun size={20} />, label: 'Shadow' },
    { id: 'background', icon: <Palette size={20} />, label: 'BG' },
    { id: 'align', icon: <AlignCenter size={20} />, label: 'Align' },
    { id: 'mask', icon: <Layers size={20} />, label: 'Mask' },
  ]

  // ── Publish build handler — builds SGA, then sets target for inline form ──
  const handleRequestBuild = useCallback(async () => {
    setIsBuildingTarget(true)
    try {
      const { buildFaceplateMod, generateGuid } =
        await import('@/lib/faceplate-mod-build')
      const { ATLAS_WIDTH, ATLAS_HEIGHT } =
        await import('@/lib/faceplate-templates')
      const bannerCanvas = await composeFaceplateCanvas(project)
      const atlasCanvas = document.createElement('canvas')
      atlasCanvas.width = ATLAS_WIDTH
      atlasCanvas.height = ATLAS_HEIGHT
      const atlasCtx = atlasCanvas.getContext('2d')
      if (atlasCtx) {
        atlasCtx.drawImage(bannerCanvas, 0, 0)
      }
      const atlasRgba = atlasCtx
        ? atlasCtx.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data
        : new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4)
      const guid = generateGuid()
      const result = await buildFaceplateMod({ project, atlasRgba, guid })
      const target = makeFaceplatePublishTarget(
        project,
        result.sga,
        result.sgaFilename,
        bannerCanvas,
        workshopId => {
          const next = { ...project, workshopId }
          setProject(next)
          persistFaceplate(next)
        },
      )
      setPublishTarget(target)
    } catch (e) {
      console.error('Faceplate publish build failed:', e)
    } finally {
      setIsBuildingTarget(false)
    }
  }, [project, setProject])

  return (
    <div
      className="fixed inset-0 z-10"
      style={{
        background: '#0a0b0e',
        color: 'rgba(247,247,250,0.92)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        // The full viewport is the editor surface — no topbar, no aside.
        // The canvas centres itself in the negative space; chrome (home
        // button, previews, bottom pill) floats absolutely overlaid.
      }}
    >
      {/* Canvas section — single full-viewport flex centre. The 624×204
       *  banner canvas dead-centres via `place-items: center`. All
       *  surrounding chrome (home button, in-game previews, bottom pill,
       *  options peel) is positioned absolutely on top so it never
       *  displaces the canvas regardless of window size.
       *
       *  ImageDropZone wraps the section so drop/paste/file-import works
       *  anywhere — including over the in-game previews, which fall
       *  through via `pointerEvents: 'none'` on the preview wrapper.
       */}
      <ImageDropZone
        onImport={onImport}
        onDragStateChange={setDragOver}
        style={
          {
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            // Generous padding so the canvas never bumps the floating
            // chrome. The home button sits at top-left (12,12) and the
            // bottom pill at bottom-center — 80px clears both sides.
            padding: '80px 80px 200px 80px',
            // Make absolutely sure the canvas area is not part of the
            // window-drag strip (the strip's z-[1] would otherwise eat
            // pointer-down on the canvas margins).
            WebkitAppRegion: 'no-drag',
          } as CSSProperties
        }
        onPointerDown={(ev: React.PointerEvent<HTMLDivElement>) => {
          // Click on empty canvas → deselect.
          if (ev.target === ev.currentTarget) setSelectedId(null)
        }}
      >
        <div
          ref={canvasRef}
          onPointerDown={
            activeTool === 'text'
              ? ev => {
                  // Click-to-place: only fire on the canvas background, not on
                  // existing layer elements that have their own drag handlers.
                  if (ev.target !== ev.currentTarget) return
                  ev.preventDefault()
                  ev.stopPropagation()
                  const rect = canvasRef.current!.getBoundingClientRect()
                  const x = (ev.clientX - rect.left) / viewScale
                  const y = (ev.clientY - rect.top) / viewScale
                  addTextLayerAt(x, y)
                  // v1.0 Photoshop-style: addTextLayerAt opens the inline
                  // contenteditable overlay (rendered in the text-layer
                  // branch below) which auto-focuses on mount, so the user
                  // can start typing immediately. We exit to select tool
                  // so a stray second click doesn't spawn another empty
                  // text layer behind the open editor; subsequent clicks
                  // select / move layers as expected.
                  setActiveTool('select')
                }
              : activeTool === 'draw'
                ? ev => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    const rect = canvasRef.current!.getBoundingClientRect()
                    const x = (ev.clientX - rect.left) / viewScale
                    const y = (ev.clientY - rect.top) / viewScale

                    // Capture mirror flags at stroke start so mid-stroke toggles don't corrupt geometry.
                    const snapMirrorX = mirrorX
                    const snapMirrorY = mirrorY

                    /** Expand a single {x,y} into all mirrored positions. */
                    const mirrorPoints = (px: number, py: number) => {
                      const pts = [{ x: px, y: py }]
                      if (snapMirrorX) pts.push({ x: FACEPLATE_BANNER_W - px, y: py })
                      if (snapMirrorY) pts.push({ x: px, y: FACEPLATE_BANNER_H - py })
                      if (snapMirrorX && snapMirrorY)
                        pts.push({ x: FACEPLATE_BANNER_W - px, y: FACEPLATE_BANNER_H - py })
                      return pts
                    }

                    // Find existing paint layer or create one
                    let paintLayer = project.layers.find((l): l is PaintLayer => l.kind === 'paint')
                    if (!paintLayer) {
                      const newLayer = newPaintLayer()
                      mutate(p => ({ ...p, layers: [...p.layers, newLayer] }), { undoable: false })
                      setSelectedId(newLayer.id)
                      paintLayer = newLayer
                    } else {
                      setSelectedId(paintLayer.id)
                    }

                    // Save pre-stroke state for undo
                    preStrokeDataUrlRef.current = paintLayer.dataUrl

                    // Set up the live stroke canvas
                    const liveCanvas = document.createElement('canvas')
                    liveCanvas.width = FACEPLATE_BANNER_W
                    liveCanvas.height = FACEPLATE_BANNER_H
                    liveCanvas.style.cssText = `position:absolute;left:0;top:0;width:${FACEPLATE_BANNER_W}px;height:${FACEPLATE_BANNER_H}px;pointer-events:none;z-index:999`
                    canvasRef.current!.appendChild(liveCanvas)
                    liveStrokeCanvasRef.current = liveCanvas

                    const lctx = liveCanvas.getContext('2d')!
                    // In erase mode, use destination-out so strokes erase pixels
                    // rather than painting them. globalAlpha still controls the
                    // strength of the erase (partial erase at lower opacity).
                    if (brushErase) {
                      lctx.globalCompositeOperation = 'destination-out'
                    }
                    lctx.globalAlpha = brushOpacity
                    lctx.strokeStyle = brushErase ? 'rgba(0,0,0,1)' : brushColor
                    lctx.lineWidth = brushSize
                    lctx.lineCap = 'round'
                    lctx.lineJoin = 'round'

                    // Start all mirrored sub-paths.
                    const startPts = mirrorPoints(x, y)
                    for (const pt of startPts) {
                      lctx.beginPath()
                      lctx.moveTo(pt.x, pt.y)
                    }
                    isDrawingRef.current = true

                    // Track last mirrored positions per sub-path so we can
                    // draw continuous segments rather than disconnected dots.
                    let lastPts = startPts

                    const paintLayerId = paintLayer.id

                    const onMove = (mev: PointerEvent) => {
                      if (!isDrawingRef.current) return
                      const lc = liveStrokeCanvasRef.current
                      if (!lc) return
                      const mrect = canvasRef.current!.getBoundingClientRect()
                      const mx = (mev.clientX - mrect.left) / viewScale
                      const my = (mev.clientY - mrect.top) / viewScale
                      const mc = lc.getContext('2d')!
                      const newPts = mirrorPoints(mx, my)
                      // Draw one segment per mirrored position.
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

                      // Composite onto persistent layer
                      const lc = liveStrokeCanvasRef.current
                      if (!lc) return

                      // Load existing paint data and composite new stroke
                      const offscreen = document.createElement('canvas')
                      offscreen.width = FACEPLATE_BANNER_W
                      offscreen.height = FACEPLATE_BANNER_H
                      const octx = offscreen.getContext('2d')!

                      const applyComposite = (existingDataUrl: string) => {
                        if (
                          existingDataUrl &&
                          existingDataUrl !==
                            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
                        ) {
                          const existImg = new Image()
                          existImg.onload = () => {
                            octx.drawImage(existImg, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
                            octx.drawImage(lc, 0, 0)
                            const newDataUrl = offscreen.toDataURL('image/png')
                            mutate(p =>
                              mapLayer(p, paintLayerId, l =>
                                l.kind === 'paint' ? { ...l, dataUrl: newDataUrl } : l,
                              ),
                            )
                            lc.remove()
                            liveStrokeCanvasRef.current = null
                          }
                          existImg.src = existingDataUrl
                        } else {
                          octx.drawImage(lc, 0, 0)
                          const newDataUrl = offscreen.toDataURL('image/png')
                          mutate(p =>
                            mapLayer(p, paintLayerId, l =>
                              l.kind === 'paint' ? { ...l, dataUrl: newDataUrl } : l,
                            ),
                          )
                          lc.remove()
                          liveStrokeCanvasRef.current = null
                        }
                      }

                      // Get current data url from project state
                      setProject(prev => {
                        const pl = prev.layers.find(l => l.id === paintLayerId) as
                          | PaintLayer
                          | undefined
                        applyComposite(pl?.dataUrl ?? '')
                        return prev
                      })
                    }

                    window.addEventListener('pointermove', onMove)
                    window.addEventListener('pointerup', onUp)
                  }
                : activeTool === 'mask'
                  ? ev => {
                      // Mask painting: find the selected compatible layer (image or
                      // paint) and paint onto its mask dataUrl via an offscreen canvas.
                      ev.preventDefault()
                      ev.stopPropagation()

                      // Only paint if the selected layer is Image or Paint.
                      const targetLayer = project.layers.find(
                        l =>
                          l.id === selectedId &&
                          (l.kind === 'image' || l.kind === 'paint') &&
                          l.mask?.dataUrl,
                      ) as (ImageLayer | PaintLayer) | undefined
                      if (!targetLayer || !targetLayer.mask?.dataUrl) return

                      const maskLayerId = targetLayer.id
                      const rect = canvasRef.current!.getBoundingClientRect()

                      // Set up live mask-stroke overlay canvas.
                      const lc = document.createElement('canvas')
                      lc.width = FACEPLATE_BANNER_W
                      lc.height = FACEPLATE_BANNER_H
                      lc.style.cssText = `position:absolute;left:0;top:0;width:${FACEPLATE_BANNER_W}px;height:${FACEPLATE_BANNER_H}px;pointer-events:none;z-index:999;mix-blend-mode:${maskPaintMode === 'hide' ? 'darken' : 'lighten'}`
                      canvasRef.current!.appendChild(lc)
                      liveMaskStrokeCanvasRef.current = lc
                      isMaskDrawingRef.current = true

                      const lctx = lc.getContext('2d')!
                      // For mask painting, 'hide' = black, 'reveal' = white.
                      const paintColor = maskPaintMode === 'hide' ? '#000000' : '#ffffff'

                      let lastX = (ev.clientX - rect.left) / viewScale
                      let lastY = (ev.clientY - rect.top) / viewScale

                      // Paint the initial dab at pointer-down position.
                      lctx.globalAlpha = maskBrushOpacity
                      lctx.fillStyle = paintColor
                      const r = maskBrushSize / 2
                      lctx.beginPath()
                      lctx.arc(lastX, lastY, r, 0, Math.PI * 2)
                      lctx.fill()

                      /** Serialise the full mask composite to a data URL, debounced
                       *  so pointermove events don't queue up redundant encodes. */
                      const serialiseMask = () => {
                        if (maskSerialiseTimerRef.current !== null) {
                          clearTimeout(maskSerialiseTimerRef.current)
                        }
                        maskSerialiseTimerRef.current = setTimeout(() => {
                          maskSerialiseTimerRef.current = null
                          const offscreen = document.createElement('canvas')
                          offscreen.width = FACEPLATE_BANNER_W
                          offscreen.height = FACEPLATE_BANNER_H
                          const octx = offscreen.getContext('2d')!

                          setProject(prev => {
                            const layer = prev.layers.find(l => l.id === maskLayerId) as
                              | (ImageLayer | PaintLayer)
                              | undefined
                            if (!layer?.mask?.dataUrl) return prev

                            const existImg = new Image()
                            existImg.onload = () => {
                              octx.drawImage(existImg, 0, 0)
                              if (liveMaskStrokeCanvasRef.current) {
                                octx.drawImage(liveMaskStrokeCanvasRef.current, 0, 0)
                              }
                              const newMaskUrl = offscreen.toDataURL('image/png')
                              mutate(p =>
                                mapLayer(p, maskLayerId, l =>
                                  l.kind === 'image' || l.kind === 'paint'
                                    ? { ...l, mask: { ...l.mask!, dataUrl: newMaskUrl } }
                                    : l,
                                ),
                              )
                            }
                            existImg.src = layer.mask.dataUrl
                            return prev
                          })
                        }, 250)
                      }

                      const onMaskMove = (mev: PointerEvent) => {
                        if (!isMaskDrawingRef.current) return
                        const x = (mev.clientX - rect.left) / viewScale
                        const y = (mev.clientY - rect.top) / viewScale
                        // Draw segment from last to current point.
                        const dx = x - lastX
                        const dy = y - lastY
                        const dist = Math.hypot(dx, dy)
                        const step = Math.max(1, maskBrushSize / 4)
                        const n = Math.max(1, Math.ceil(dist / step))
                        for (let i = 1; i <= n; i++) {
                          const t = i / n
                          const px = lastX + dx * t
                          const py = lastY + dy * t
                          lctx.globalAlpha = maskBrushOpacity
                          lctx.fillStyle = paintColor
                          lctx.beginPath()
                          lctx.arc(px, py, r, 0, Math.PI * 2)
                          lctx.fill()
                        }
                        lastX = x
                        lastY = y
                        serialiseMask()
                      }

                      const onMaskUp = () => {
                        isMaskDrawingRef.current = false
                        if (maskSerialiseTimerRef.current !== null) {
                          clearTimeout(maskSerialiseTimerRef.current)
                          maskSerialiseTimerRef.current = null
                        }
                        // Final serialise without debounce on pointer-up.
                        const offscreen = document.createElement('canvas')
                        offscreen.width = FACEPLATE_BANNER_W
                        offscreen.height = FACEPLATE_BANNER_H
                        const octx = offscreen.getContext('2d')!

                        setProject(prev => {
                          const layer = prev.layers.find(l => l.id === maskLayerId) as
                            | (ImageLayer | PaintLayer)
                            | undefined
                          if (!layer?.mask?.dataUrl) return prev

                          const existImg = new Image()
                          existImg.onload = () => {
                            octx.drawImage(existImg, 0, 0)
                            if (lc) octx.drawImage(lc, 0, 0)
                            const newMaskUrl = offscreen.toDataURL('image/png')
                            mutate(p =>
                              mapLayer(p, maskLayerId, l =>
                                l.kind === 'image' || l.kind === 'paint'
                                  ? { ...l, mask: { ...l.mask!, dataUrl: newMaskUrl } }
                                  : l,
                              ),
                            )
                            lc.remove()
                            liveMaskStrokeCanvasRef.current = null
                          }
                          existImg.src = layer.mask.dataUrl
                          return prev
                        })

                        window.removeEventListener('pointermove', onMaskMove)
                        window.removeEventListener('pointerup', onMaskUp)
                      }

                      window.addEventListener('pointermove', onMaskMove)
                      window.addEventListener('pointerup', onMaskUp)
                    }
                  : undefined
          }
          style={{
            width: FACEPLATE_BANNER_W,
            height: FACEPLATE_BANNER_H,
            position: 'relative',
            background: previewTransparent ? '#ffffff' : (project.backgroundColor ?? 'transparent'),
            backgroundImage: previewTransparent
              ? lightCheckerBackground()
              : project.backgroundColor === null
                ? checkerBackground()
                : 'none',
            backgroundSize: '24px 24px',
            // In-game CoH2 faceplate banners are strictly rectangular — no
            // corner radius. Editing on a rounded surface gave the user a
            // false impression that the edges would crop in-game; they
            // don't. Match the in-game shape exactly so what you paint is
            // what you ship.
            borderRadius: 0,
            cursor:
              activeTool === 'text'
                ? 'text'
                : activeTool === 'draw' || activeTool === 'mask'
                  ? 'crosshair'
                  : 'default',
            boxShadow: `
              0 24px 80px -20px rgba(0,0,0,0.6),
              0 0 0 1px rgba(255,255,255,0.06),
              0 0 0 6px rgba(0,0,0,0.35)
            `,
            outline: dragOver ? '2px dashed rgba(120,180,255,0.6)' : 'none',
            outlineOffset: -8,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {/* Canvas placeholder — shown when there are no layers and no background colour.
              Hidden in preview-transparent mode so the user sees exactly what will be
              exported (no editor scaffolding, just transparent regions on a checker). */}
          {!previewTransparent &&
            project.layers.length === 0 &&
            (project.backgroundColor === null || project.backgroundColor === undefined) && (
              <CanvasPlaceholder width={FACEPLATE_BANNER_W} height={FACEPLATE_BANNER_H} />
            )}

          {/* Mirror axis guide lines — visible only while Draw tool is active */}
          {activeTool === 'draw' && mirrorX && (
            <div
              style={{
                position: 'absolute',
                left: FACEPLATE_BANNER_W / 2,
                top: 0,
                width: 1,
                height: FACEPLATE_BANNER_H,
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
                top: FACEPLATE_BANNER_H / 2,
                width: FACEPLATE_BANNER_W,
                height: 1,
                background: 'rgba(120,180,255,0.4)',
                pointerEvents: 'none',
                zIndex: 998,
              }}
            />
          )}

          {/* Smart-snap alignment guides — visible while a layer is being dragged */}
          {snapGuides.map((g, i) =>
            g.kind === 'x' ? (
              <div
                key={`snapx-${i}`}
                style={{
                  position: 'absolute',
                  left: g.value * viewScale,
                  top: 0,
                  width: 1,
                  height: FACEPLATE_BANNER_H,
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
                  top: g.value * viewScale,
                  width: FACEPLATE_BANNER_W,
                  height: 1,
                  background: 'rgba(120,180,255,0.85)',
                  pointerEvents: 'none',
                  zIndex: 1000,
                }}
              />
            ),
          )}

          {/* Layers */}
          {project.layers.map(layer => {
            if (!layer.visible) return null
            const isSelected = layer.id === selectedId

            if (layer.kind === 'text') {
              const cx = layer.x * viewScale
              const cy = layer.y * viewScale
              const scaledFont = layer.fontSize * layer.scale * viewScale
              const lines = layer.text.split('\n')
              const isEditing = layer.id === editingTextId
              // Shared visual style — keeps the inline contenteditable
              // pixel-identical to the committed static render so there's
              // no visual jump when the user commits the edit.
              const sharedTextStyle: React.CSSProperties = {
                position: 'absolute',
                left: cx,
                top: cy,
                transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
                transformOrigin: '50% 50%',
                opacity: layer.opacity,
                outline: isSelected && !isEditing ? `2px solid ${EDITOR_ACCENT}` : 'none',
                outlineOffset: 2,
                userSelect: isEditing ? 'text' : 'none',
                touchAction: 'none',
                fontFamily: layer.fontFamily,
                fontSize: scaledFont,
                fontWeight: layer.fontWeight,
                fontStyle: layer.fontStyle,
                color: layer.color,
                textAlign: layer.align,
                whiteSpace: 'pre',
                lineHeight: layer.lineHeight ?? 1.2,
                letterSpacing: `${layer.letterSpacing ?? 0}px`,
                WebkitTextStroke:
                  layer.strokeWidth > 0 && layer.strokeColor
                    ? `${layer.strokeWidth * layer.scale * viewScale}px ${layer.strokeColor}`
                    : undefined,
                paintOrder: layer.strokeWidth > 0 ? 'stroke fill' : undefined,
                width: 'max-content',
                minWidth: isEditing ? scaledFont * 0.5 : undefined,
                maxWidth: `${FACEPLATE_BANNER_W * viewScale}px`,
                pointerEvents: layer.locked ? 'none' : 'auto',
              }

              if (isEditing) {
                // Photoshop-style invisible type box: a contenteditable div
                // with no visible border/background. Auto-focuses on mount
                // via ref callback so the user can type immediately. We
                // intentionally do NOT show an outline ring while editing
                // — the I-beam caret is enough of a hint that the user is
                // in edit mode, matching Photoshop's behaviour where the
                // type cursor IS the only affordance.
                return (
                  // Contenteditable div is the inline text editor;
                  // role="textbox" + aria-multiline expose it to assistive
                  // tech as an editable region. Native <input>/<textarea>
                  // would not preserve the transformed canvas geometry
                  // (rotation, scaled font, letter spacing) we need for
                  // pixel-identical commit.
                  <div
                    key={layer.id}
                    data-layer-id={layer.id}
                    data-testid="text-inline-editor"
                    role="textbox"
                    aria-multiline="true"
                    aria-label="Text layer content"
                    tabIndex={0}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    ref={el => {
                      if (!el) return
                      // First mount: focus + place caret at end of any
                      // existing text. The `data-focused` ribbon avoids
                      // re-focusing on every React render (which would
                      // steal focus mid-typing).
                      if (el.dataset.focused === '1') return
                      el.dataset.focused = '1'
                      el.focus()
                      // Place caret at end so user typing appends.
                      const range = document.createRange()
                      range.selectNodeContents(el)
                      range.collapse(false)
                      const sel = window.getSelection()
                      if (sel) {
                        sel.removeAllRanges()
                        sel.addRange(range)
                      }
                    }}
                    onPointerDown={ev => {
                      // Don't let the canvas-bg pointerdown deselect us,
                      // and don't trigger beginDrag while typing.
                      ev.stopPropagation()
                    }}
                    onInput={ev => {
                      const next = (ev.currentTarget as HTMLDivElement).innerText
                      mutate(
                        p => ({
                          ...p,
                          layers: p.layers.map(l =>
                            l.id === layer.id && l.kind === 'text'
                              ? ({ ...l, text: next } as TextLayer)
                              : l,
                          ),
                        }),
                        { undoable: false },
                      )
                    }}
                    onKeyDown={ev => {
                      if (ev.key === 'Escape') {
                        ev.preventDefault()
                        ;(ev.currentTarget as HTMLDivElement).blur()
                      } else if (ev.key === 'Enter' && !ev.shiftKey) {
                        // Enter commits; Shift-Enter inserts a newline.
                        ev.preventDefault()
                        ;(ev.currentTarget as HTMLDivElement).blur()
                      }
                    }}
                    onBlur={() => commitTextEdit(layer.id)}
                    style={
                      {
                        ...sharedTextStyle,
                        cursor: 'text',
                        caretColor: layer.color,
                        // Faint dashed selection ring while editing so the
                        // user can still see the bounding box of the layer
                        // they're typing into — but only in the editor, it
                        // doesn't burn into the exported atlas.
                        outline: `1px dashed rgba(255,255,255,0.35)`,
                        outlineOffset: 2,
                      } as React.CSSProperties
                    }
                  >
                    {layer.text}
                  </div>
                )
              }

              return (
                <div
                  key={layer.id}
                  data-layer-id={layer.id}
                  onPointerDown={ev => {
                    if (layer.locked || layer.lockFlags?.position) return
                    ev.stopPropagation()
                    setSelectedId(layer.id)
                    setMultiSelectedIds(new Set())
                    beginDrag(ev, layer, viewScale, mutate, project, setSnapGuides)
                  }}
                  onDoubleClick={ev => {
                    // Photoshop-style re-edit: double-click an existing
                    // text layer to re-open the inline editor.
                    if (layer.locked) return
                    ev.stopPropagation()
                    setSelectedId(layer.id)
                    setEditingTextId(layer.id)
                  }}
                  style={
                    {
                      ...sharedTextStyle,
                      cursor:
                        layer.locked || layer.lockFlags?.position
                          ? 'default'
                          : isSelected
                            ? 'move'
                            : 'pointer',
                    } as React.CSSProperties
                  }
                >
                  {lines.map((line, i) => (
                    <div key={i} style={{ display: 'block' }}>
                      {line || '\u00a0'}
                    </div>
                  ))}
                </div>
              )
            }

            if (layer.kind === 'shape') {
              const cx = layer.x * viewScale
              const cy = layer.y * viewScale
              const svgW = layer.width * layer.scale * viewScale
              const svgH = layer.height * layer.scale * viewScale
              const strokeWidth = layer.stroke ? layer.stroke.width * viewScale : 0
              const strokeColor = layer.stroke?.color ?? 'none'
              const shapePath = shapeToSvgElement(
                layer.shapeType,
                layer.fillColor,
                strokeColor,
                strokeWidth,
              )
              return (
                <div
                  key={layer.id}
                  data-layer-id={layer.id}
                  onPointerDown={ev => {
                    if (layer.locked || layer.lockFlags?.position) return
                    ev.stopPropagation()
                    setSelectedId(layer.id)
                    setMultiSelectedIds(new Set())
                    beginDrag(ev, layer, viewScale, mutate, project, setSnapGuides)
                  }}
                  style={{
                    position: 'absolute',
                    left: cx,
                    top: cy,
                    transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
                    transformOrigin: '50% 50%',
                    cursor:
                      layer.locked || layer.lockFlags?.position
                        ? 'default'
                        : isSelected
                          ? 'move'
                          : 'pointer',
                    opacity: layer.opacity,
                    outline: isSelected ? `2px solid ${EDITOR_ACCENT}` : 'none',
                    outlineOffset: 2,
                    userSelect: 'none',
                    touchAction: 'none',
                    pointerEvents: layer.locked || layer.lockFlags?.position ? 'none' : 'auto',
                  }}
                >
                  <svg
                    width={svgW}
                    height={svgH}
                    viewBox="0 0 100 100"
                    style={{ display: 'block', overflow: 'visible' }}
                  >
                    {shapePath}
                  </svg>
                </div>
              )
            }

            // Paint layer
            if (layer.kind === 'paint') {
              const isSelected = layer.id === selectedId
              return (
                <img
                  key={layer.id}
                  src={layer.dataUrl}
                  alt=""
                  draggable={false}
                  onPointerDown={ev => {
                    if (layer.locked || layer.lockFlags?.position) return
                    ev.stopPropagation()
                    setSelectedId(layer.id)
                    setMultiSelectedIds(new Set())
                  }}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: FACEPLATE_BANNER_W,
                    height: FACEPLATE_BANNER_H,
                    opacity: layer.opacity,
                    outline: isSelected ? `2px solid ${EDITOR_ACCENT}` : 'none',
                    outlineOffset: 2,
                    pointerEvents: layer.locked || layer.lockFlags?.position ? 'none' : 'auto',
                    userSelect: 'none',
                    touchAction: 'none',
                    cursor:
                      layer.locked || layer.lockFlags?.position
                        ? 'default'
                        : isSelected
                          ? 'move'
                          : 'pointer',
                  }}
                />
              )
            }

            // Image layer (must be last branch — only reached if kind === 'image')
            if (layer.kind !== 'image') return null
            const img = project.images[layer.imageId]
            if (!img) return null
            // Image layers carry independent X/Y scales so the user can
            // freely stretch a logo. `scaleY ?? scale` falls back to
            // uniform for layers created before the field existed.
            const scaleX = layer.scale
            const scaleY = layer.scaleY ?? layer.scale
            const baseW = img.width * scaleX * viewScale
            const baseH = img.height * scaleY * viewScale
            const cx = layer.x * viewScale
            const cy = layer.y * viewScale
            const sx = layer.flipH ? -1 : 1
            const sy = layer.flipV ? -1 : 1
            return (
              <div
                key={layer.id}
                data-layer-id={layer.id}
                onPointerDown={ev => {
                  if (layer.locked || layer.lockFlags?.position) return
                  ev.stopPropagation()
                  setSelectedId(layer.id)
                  setMultiSelectedIds(new Set())
                  beginDrag(ev, layer, viewScale, mutate, project, setSnapGuides)
                }}
                style={{
                  position: 'absolute',
                  left: cx,
                  top: cy,
                  width: baseW,
                  height: baseH,
                  transform: `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${sx}, ${sy})`,
                  transformOrigin: '50% 50%',
                  cursor: layer.locked ? 'default' : isSelected ? 'move' : 'pointer',
                  opacity: layer.opacity,
                  outline: isSelected ? `2px solid ${EDITOR_ACCENT}` : 'none',
                  outlineOffset: 2,
                  userSelect: 'none',
                  touchAction: 'none',
                }}
              >
                <img
                  src={img.dataUrl}
                  alt=""
                  draggable={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    // Live Photoshop-adjustment preview. Same filter
                    // string we feed Canvas2D in composeFaceplateCanvas,
                    // so live render === exported PNG.
                    filter: imageFilterCss(layer.filters),
                  }}
                />
              </div>
            )
          })}

          {/* Selection handles (resize at corners, rotate above) */}
          {selectedLayer &&
            (() => {
              // Compute bbox in screen pixels for the selected layer.
              let bboxW: number
              let bboxH: number
              if (selectedLayer.kind === 'text') {
                // Estimate text bbox from font metrics without DOM reads during render.
                // We use a generous character-width heuristic (0.6em per char for proportional fonts).
                const lines = selectedLayer.text.split('\n')
                const scaledFont = selectedLayer.fontSize * selectedLayer.scale * viewScale
                const longestLine = Math.max(...lines.map(l => l.length), 1)
                bboxW = longestLine * scaledFont * 0.6
                bboxH = lines.length * scaledFont * (selectedLayer.lineHeight ?? 1.2)
              } else if (selectedLayer.kind === 'shape') {
                bboxW = selectedLayer.width * selectedLayer.scale * viewScale
                bboxH = selectedLayer.height * selectedLayer.scale * viewScale
              } else if (selectedLayer.kind === 'paint') {
                bboxW = FACEPLATE_BANNER_W * viewScale
                bboxH = FACEPLATE_BANNER_H * viewScale
              } else if (selectedLayer.kind === 'group') {
                // Groups have no direct bbox — show a placeholder size
                bboxW = 0
                bboxH = 0
              } else {
                const img = project.images[selectedLayer.imageId]
                const sx = selectedLayer.scale
                const sy = selectedLayer.scaleY ?? selectedLayer.scale
                bboxW = img ? img.width * sx * viewScale : 0
                bboxH = img ? img.height * sy * viewScale : 0
              }
              return (
                <CanvasHandles
                  layer={selectedLayer}
                  image={
                    selectedLayer.kind === 'image'
                      ? project.images[selectedLayer.imageId]
                      : undefined
                  }
                  viewScale={viewScale}
                  bboxW={bboxW}
                  bboxH={bboxH}
                  onResize={transform =>
                    // CanvasHandles emits the full transform delta:
                    // {scale, scaleY?, x, y}. We merge it onto the layer
                    // verbatim. For text layers `scaleY` is undefined and
                    // simply doesn't appear in the merged layer (which is
                    // fine — TextLayer doesn't read it).
                    mutate(p => mapLayer(p, selectedLayer.id, l => ({ ...l, ...transform })))
                  }
                  onRotate={(rotation: number) =>
                    mutate(p => mapLayer(p, selectedLayer.id, l => ({ ...l, rotation })))
                  }
                />
              )
            })()}

          {/* Drop hint overlay */}
          {dragOver && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                color: 'rgba(247,247,250,0.85)',
                background: 'rgba(0,0,0,0.4)',
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: 0.2,
                pointerEvents: 'none',
              }}
            >
              Drop to add as a layer
            </div>
          )}
        </div>
      </ImageDropZone>

      {/* ─────────────────────────────────────────────────────────────
          Floating chrome — all positioned absolutely so it overlays the
          ImageDropZone without participating in its grid layout.

          1. Home button — top-left. Returns the user to the StartScreen.
          2. BottomToolPill + ToolOptionsPeel — bottom-centre.
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

      {/* ── Centered project title pill — top center of viewport ────────
          Mirrors EditorHomeButton's glass styling. Clicking opens a small
          rename popover so the user can rename the pack inline. Shows ONLY
          packName (never author). The Live Sync status icon is rendered
          inline at the end of the title text — hover reveals the reason. */}
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
            {project.packName || 'Unnamed Faceplate'}
          </span>
          <span style={{ display: 'inline-flex', flex: 'none', transform: 'scale(0.85)' }}>
            <StateIcon state={sync.state} />
          </span>
        </button>

        {/* Rename popover — appears directly below the title button */}
        <PackIdentityPopover
          open={packNameEditOpen}
          onClose={() => {
            setPackNameEditOpen(false)
            setPublishTarget(null)
          }}
          name={project.packName ?? ''}
          description={project.packDescription}
          author={project.author}
          onSave={({
            name,
            description,
            author,
          }: {
            name: string
            description: string
            author: string
          }) => {
            // Autosync — popover fires this on every keystroke now; do
            // NOT close on every change. Popover handles its own close on
            // Escape / outside-click.
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
            label: 'Inventory icon',
            currentDataUrl: project.inventoryIcon ?? null,
            fallbackHint: 'Falls back to auto-downsample of banner',
            onChange: (next: string | null) =>
              mutate(p => ({ ...p, inventoryIcon: next ?? undefined }), { undoable: false }),
            sizePx: 64,
          }}
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

      {/* ProjectMetaPanel + LobbyPreviewPanel intentionally removed from
          the faceplate editor in v1.0 — they blocked the canvas without
          carrying their weight on a 624×204 atlas. Identity edits move
          to the Project tab; live in-game preview is implicit (the
          atlas IS the preview at this aspect ratio). */}

      {/* Inline Adjust popover for the selected image layer.
          Docked top-right. v1.0: gated on the explicit `adjustImageOpen`
          flag (toggled from the layer strip's per-layer Adjust button) so
          the panel only appears when the user opts in — picking an image
          layer no longer slings the Adjust panel into the top-right
          corner unexpectedly. Matches the user's feedback: "random image
          menu above when I select the menu". FaceplateEditor has no
          dedicated Images tool to gate on, so a user gesture replaces
          tool-based gating. */}
      {adjustImageOpen && selectedLayer?.kind === 'image' && (
        <div
          style={{
            position: 'fixed',
            top: 56,
            right: 12,
            zIndex: 45,
            background: 'rgba(20, 22, 28, 0.88)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            borderRadius: 12,
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            width: 280,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: EDITOR_TEXT_3,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Adjust Image
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Curves / Tone Presets modal trigger */}
              <button
                type="button"
                data-testid="curves-open-btn"
                onClick={() => setCurvesOpen(true)}
                style={{
                  background: 'rgba(120,180,255,0.10)',
                  border: '1px solid rgba(120,180,255,0.25)',
                  borderRadius: 5,
                  color: 'rgba(120,180,255,0.85)',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                Curves…
              </button>
              {/* Close the Adjust popover — needed because v1.0 made the
                  popover opt-in (user must click Adjust on the layer
                  thumbnail to open it), so it now needs an explicit
                  Close affordance. */}
              <button
                type="button"
                aria-label="Close adjust image panel"
                title="Close"
                onClick={() => setAdjustImageOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: EDITOR_TEXT_3,
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: '0 2px',
                }}
              >
                ×
              </button>
            </div>
          </div>
          {/* Blend mode selector — placed above the opacity/filter sliders so
              composite behaviour is visible before the user tunes filters. */}
          <BlendModeSelect
            compact
            value={(selectedLayer as ImageLayer).blendMode}
            onChange={next =>
              mutate(p =>
                mapLayer(p, selectedLayer.id, l =>
                  l.kind === 'image' ? ({ ...l, blendMode: next } as ImageLayer) : l,
                ),
              )
            }
            label="Blend mode"
          />
          <AdjustmentPanel
            filters={selectedLayer.filters}
            heading={null}
            onChange={patch =>
              mutate(p =>
                mapLayer(p, selectedLayer.id, l =>
                  l.kind === 'image'
                    ? ({ ...l, filters: { ...(l.filters ?? {}), ...patch } } as ImageLayer)
                    : l,
                ),
              )
            }
            onReset={() =>
              mutate(p =>
                mapLayer(p, selectedLayer.id, l =>
                  l.kind === 'image' ? ({ ...l, filters: undefined } as ImageLayer) : l,
                ),
              )
            }
          />
        </div>
      )}

      {/* Layer strip — always visible when there are layers, docked vertically on the left */}
      {project.layers.length > 0 && (
        <div
          role="toolbar"
          aria-label="Layers"
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
          onClick={() => setLayerCtxMenu(null)}
          onKeyDown={ev => {
            if (ev.key === 'Escape') setLayerCtxMenu(null)
          }}
        >
          {/* Thumbnails in stack order — last layer (top of canvas) is rightmost */}
          {[...project.layers].map(layer => {
            const isSelected = layer.id === selectedId
            const thumbnailContent = (() => {
              if (layer.kind === 'text') {
                return (
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                    T
                  </span>
                )
              }
              if (layer.kind === 'shape') {
                return (
                  <svg width={24} height={24} viewBox="0 0 100 100">
                    {shapeToSvgElement(layer.shapeType, layer.fillColor, 'none', 0)}
                  </svg>
                )
              }
              if (layer.kind === 'paint') {
                return <span style={{ fontSize: 14, color: EDITOR_TEXT_2 }}>✏</span>
              }
              if (layer.kind === 'group') {
                return <span style={{ fontSize: 11, color: EDITOR_TEXT_2 }}>▶</span>
              }
              // image layer
              const img = project.images[(layer as ImageLayer).imageId]
              return img ? (
                <img
                  src={img.dataUrl}
                  alt=""
                  style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4 }}
                />
              ) : (
                <span style={{ fontSize: 10, color: EDITOR_TEXT_4 }}>?</span>
              )
            })()

            return (
              <div
                key={layer.id}
                role="button"
                tabIndex={0}
                aria-label={
                  layer.kind === 'text'
                    ? layer.text.slice(0, 20) || 'Text layer'
                    : layer.kind === 'shape'
                      ? layer.shapeType
                      : layer.kind === 'paint'
                        ? 'Paint layer'
                        : layer.kind === 'group'
                          ? layer.name
                          : (project.images[(layer as ImageLayer).imageId]?.name ?? 'Image layer')
                }
                aria-pressed={isSelected || multiSelectedIds.has(layer.id)}
                onClick={ev => {
                  ev.stopPropagation()
                  if (ev.metaKey || ev.ctrlKey) {
                    // Cmd/Ctrl-click: add/remove from multi-select
                    setMultiSelectedIds(prev => {
                      const next = new Set(prev)
                      if (next.has(layer.id)) {
                        next.delete(layer.id)
                      } else {
                        next.add(layer.id)
                      }
                      return next
                    })
                  } else {
                    setSelectedId(layer.id)
                    setMultiSelectedIds(new Set())
                    setLayerCtxMenu(null)
                  }
                }}
                onKeyDown={ev => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    setSelectedId(layer.id)
                    setMultiSelectedIds(new Set())
                    setLayerCtxMenu(null)
                  }
                }}
                onContextMenu={ev => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  setLayerCtxMenu({ id: layer.id, x: ev.clientX, y: ev.clientY })
                }}
                style={{
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  background:
                    isSelected || multiSelectedIds.has(layer.id)
                      ? `${EDITOR_ACCENT}33`
                      : 'rgba(255,255,255,0.04)',
                  border: isSelected
                    ? `2px solid ${EDITOR_ACCENT}`
                    : multiSelectedIds.has(layer.id)
                      ? `1.5px solid ${EDITOR_ACCENT}99`
                      : '1px solid rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                  opacity: layer.visible ? 1 : 0.35,
                  position: 'relative',
                  overflow: 'hidden',
                  outline: 'none',
                }}
              >
                {thumbnailContent}
                {/* Lock icon button — toggle position lock (Shift = aspect) */}
                {layer.kind !== 'group' && (
                  <button
                    type="button"
                    title={
                      layer.lockFlags?.position
                        ? 'Locked position (click to unlock)'
                        : layer.lockFlags?.aspect
                          ? 'Locked aspect (click to unlock)'
                          : 'Unlocked (click to lock position; Shift+click to lock aspect)'
                    }
                    onClick={ev => {
                      ev.stopPropagation()
                      if (ev.shiftKey) {
                        // Toggle aspect lock
                        mutate(p =>
                          mapLayer(p, layer.id, l =>
                            l.kind === 'group'
                              ? l
                              : {
                                  ...l,
                                  lockFlags: {
                                    ...(l.lockFlags ?? {}),
                                    aspect: !(l.lockFlags?.aspect ?? false),
                                  },
                                },
                          ),
                        )
                      } else {
                        // Toggle position lock
                        mutate(p =>
                          mapLayer(p, layer.id, l =>
                            l.kind === 'group'
                              ? l
                              : {
                                  ...l,
                                  lockFlags: {
                                    ...(l.lockFlags ?? {}),
                                    position: !(l.lockFlags?.position ?? false),
                                  },
                                },
                          ),
                        )
                      }
                    }}
                    style={{
                      position: 'absolute',
                      bottom: 2,
                      right: 2,
                      width: 14,
                      height: 14,
                      background: 'transparent',
                      border: 'none',
                      color:
                        layer.lockFlags?.position || layer.lockFlags?.aspect
                          ? 'rgba(120,180,255,0.9)'
                          : 'rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {layer.lockFlags?.position || layer.lockFlags?.aspect ? (
                      <Lock size={10} />
                    ) : (
                      <LockOpen size={10} />
                    )}
                  </button>
                )}
                {/* Clipping mask toggle — top-left corner. When active, this layer's
                    pixels are masked to the opaque regions of the layer below it
                    in the stack (Photoshop "Create Clipping Mask" behaviour). */}
                {layer.kind !== 'group' && (
                  <button
                    type="button"
                    title={
                      layer.clippedToLayerBelow
                        ? 'Clipped to layer below (click to release)'
                        : 'Not clipped — click to clip to layer below'
                    }
                    data-testid={`clip-toggle-${layer.id}`}
                    onClick={ev => {
                      ev.stopPropagation()
                      mutate(p =>
                        mapLayer(p, layer.id, l =>
                          l.kind === 'group'
                            ? l
                            : {
                                ...l,
                                clippedToLayerBelow: !l.clippedToLayerBelow || undefined,
                              },
                        ),
                      )
                    }}
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: 2,
                      width: 14,
                      height: 14,
                      background: 'transparent',
                      border: 'none',
                      color: layer.clippedToLayerBelow ? EDITOR_ACCENT : 'rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CornerDownLeft size={10} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Layer context menu */}
      {layerCtxMenu &&
        (() => {
          const layer = project.layers.find(l => l.id === layerCtxMenu.id)
          if (!layer) return null
          return (
            <div
              style={{
                position: 'fixed',
                left: layerCtxMenu.x,
                top: layerCtxMenu.y,
                zIndex: 200,
                background: 'rgba(20,22,28,0.96)',
                backdropFilter: 'blur(24px)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                padding: '4px 0',
                minWidth: 140,
              }}
              onMouseLeave={() => setLayerCtxMenu(null)}
            >
              {(
                [
                  [
                    layer.visible ? 'Hide' : 'Show',
                    () => {
                      mutate(p => mapLayer(p, layer.id, l => ({ ...l, visible: !l.visible })))
                      setLayerCtxMenu(null)
                    },
                  ],
                  [
                    'Duplicate',
                    () => {
                      duplicateLayer(layer.id)
                      setLayerCtxMenu(null)
                    },
                  ],
                  [
                    'Delete',
                    () => {
                      mutate(p => ({ ...p, layers: p.layers.filter(l => l.id !== layer.id) }))
                      if (selectedId === layer.id) setSelectedId(null)
                      setLayerCtxMenu(null)
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

      {/* Canvas view-mode picker — right-edge vertical stack of three
       *  icon buttons. Mirrors the Vehicle Viewport's ScenePanel so the
       *  three editor surfaces feel unified. Hidden in `in_game` mode is
       *  NOT desired — the user needs the switcher visible at all times
       *  so they can flip back from the in-game overlay to editing. */}
      <AtlasViewPanel mode={viewMode} setMode={setViewMode} ariaLabel="Faceplate view mode" />

      {/* In-game preview overlay — only rendered when viewMode === 'in_game'.
       *  Centred over the canvas surface; `pointerEvents: 'auto'` so it
       *  intercepts clicks (preventing accidental layer drags while the
       *  preview is visible). The user switches back via the view-mode
       *  panel to resume editing. */}
      {viewMode === 'in_game' && (
        <div
          data-testid="faceplate-in-game-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 25,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(10,11,14,0.92)',
            backdropFilter: 'blur(12px) saturate(140%)',
            padding: '80px 80px 200px 80px',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ maxWidth: 360, width: '100%' }}>
            <FaceplateInGamePreview
              bannerPngUrl={bannerPngUrl}
              playerName={project.packName ?? 'Faceplate preview'}
            />
          </div>
        </div>
      )}

      {/* Bottom tool surface — top row holds the tool-options peel on the
       *  LEFT and the Live Sync status badge on the RIGHT (mirror of the
       *  peel's left position). Bottom row is the BottomToolPill itself,
       *  with the eye-preview toggle as an "extras" segment.
       *
       *  Layout details:
       *  – Column wrapper is fixed bottom-centre; `alignItems: stretch`
       *    so the top row spans the column's natural width (which the
       *    pill below determines).
       *  – Top row uses `marginLeft: auto` on the badge so the badge
       *    floats right even when the peel returns null (no active
       *    tool). The peel + badge stay vertically baseline-aligned via
       *    `alignItems: flex-end`.
       *  – Peel is `key`-ed on activeTool so React fully remounts on
       *    every tool switch, preventing bleed-through overlap. */}
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
          {/* The peel is stabilised to a fixed minWidth so the bottom
              dock no longer shifts left/right (or wraps onto a second
              row) when the user picks a tool with denser controls
              (Draw has 7 controls, Tint has 4, Shadow has 3 …). The
              user complained "every time I click draw, it makes the
              tool tab wider", so we anchor the peel to the natural
              width of the widest tool (Draw) and let lighter tools
              just sit inside that envelope. The minHeight keeps the
              peel a constant pill height regardless of how many rows
              the children would otherwise need. */}
          <ToolOptionsPeel
            key={activeTool}
            activeId={
              activeTool === 'select'
                ? null
                : // v1.0: hide the entire peel for the text tool until the
                  // user actually has a text layer to act on. Previously we
                  // showed an empty-state hint ("Click on the canvas to
                  // place text…") inside the peel, but the user feedback
                  // was "dont show the text sub menu unless I click on
                  // the text or add text" — so we collapse the peel
                  // entirely in that empty state. The peel re-mounts the
                  // moment a text layer is selected or being edited.
                  activeTool === 'text' && selectedLayer?.kind !== 'text' && editingTextId === null
                  ? null
                  : activeTool
            }
            label={toolLabel(activeTool)}
            style={{ minWidth: 360, minHeight: 44, justifyContent: 'flex-start' }}
          >
            <FaceplateToolPeelBody
              tool={activeTool}
              project={project}
              selectedLayer={selectedLayer}
              selectedId={selectedId}
              onSelectLayer={setSelectedId}
              mutate={mutate}
              onDuplicate={duplicateLayer}
              onInsigniaOpen={() => setInsigniaOpen(true)}
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
              maskBrushSize={maskBrushSize}
              setMaskBrushSize={setMaskBrushSize}
              maskBrushOpacity={maskBrushOpacity}
              setMaskBrushOpacity={setMaskBrushOpacity}
              maskPaintMode={maskPaintMode}
              setMaskPaintMode={setMaskPaintMode}
            />
          </ToolOptionsPeel>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Adjust-Image toggle — only enabled when an image layer is
             *  selected. v1.0 fix: the previous behaviour auto-popped the
             *  Adjust panel into the top-right whenever an image layer was
             *  selected, which the user called "random image menu above
             *  when I select the menu". Gating it behind this explicit
             *  toggle makes the panel opt-in. */}
            {selectedLayer?.kind === 'image' && (
              <button
                type="button"
                aria-label={adjustImageOpen ? 'Hide Adjust panel' : 'Show Adjust panel'}
                title={adjustImageOpen ? 'Hide Adjust panel' : 'Adjust image filters & blend'}
                aria-pressed={adjustImageOpen}
                onClick={() => setAdjustImageOpen(o => !o)}
                style={{
                  width: 44,
                  height: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 14,
                  border: '0.5px solid rgba(255,255,255,0.10)',
                  background: adjustImageOpen ? 'rgba(120,180,255,0.18)' : 'rgba(20, 22, 28, 0.72)',
                  backdropFilter: 'blur(32px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(32px) saturate(180%)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
                  color: adjustImageOpen ? EDITOR_ACCENT : EDITOR_TEXT_2,
                  cursor: 'pointer',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                <Sliders size={18} aria-hidden />
              </button>
            )}
          </div>
        </div>
        {/* Bottom row — the tool pill with eye-preview as an extra */}
        {/* Bottom pill — extras row no longer carries the alpha-preview
         *  Eye toggle; the right-edge AtlasViewPanel covers the same
         *  ground (and adds the in-game preview as a third mode), so
         *  surfacing it twice would be redundant chrome. */}
        <BottomToolPill<FaceplateToolId>
          tools={FACEPLATE_TOOLS}
          activeId={activeTool}
          onSelect={setActiveTool}
        />
      </div>

      {/* Curves / Tone Presets modal */}
      {curvesOpen && selectedLayer?.kind === 'image' && (
        <CurvesEditor
          filters={(selectedLayer as ImageLayer).filters}
          onApply={patch =>
            mutate(p =>
              mapLayer(p, selectedLayer.id, l =>
                l.kind === 'image'
                  ? ({ ...l, filters: { ...(l.filters ?? {}), ...patch } } as ImageLayer)
                  : l,
              ),
            )
          }
          onClose={() => setCurvesOpen(false)}
        />
      )}

      {/* Export success toast */}
      {exportToast && (
        <GlassToast
          title="Export"
          body={exportToast}
          intent="success"
          autoDismissMs={3000}
          onClose={() => setExportToast(null)}
        />
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
                    const imageId = await addFaceplateImageFromBlob(draft, blob, insignia.name)
                    const layer = makeDefaultLayer(draft, imageId)
                    mutate(p => ({
                      ...p,
                      images: { ...p.images, ...draft.images },
                      layers: [...p.layers, layer],
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

/** Human-readable label for the active tool — used as the peel's
 *  uppercase caption strip. */
function toolLabel(id: FaceplateToolId): string {
  switch (id) {
    case 'select':
      return 'Select'
    case 'text':
      return 'Text'
    case 'shapes':
      return 'Shapes'
    case 'draw':
      return 'Draw'
    case 'shadow':
      return 'Shadow'
    case 'background':
      return 'Background'
    case 'align':
      return 'Align'
    case 'mask':
      return 'Mask'
  }
}

/**
 * Renders the contents of the tool-options peel for the active tool.
 * All peels now render horizontally (flexDirection: 'row').
 */
function FaceplateToolPeelBody({
  tool,
  project,
  selectedLayer,
  selectedId,
  mutate,
  onDuplicate: _onDuplicate,
  onInsigniaOpen,
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
  maskBrushSize,
  setMaskBrushSize,
  maskBrushOpacity,
  setMaskBrushOpacity,
  maskPaintMode,
  setMaskPaintMode,
}: {
  tool: FaceplateToolId
  project: Coh2FaceplateProject
  selectedLayer: FaceplateLayer | null
  selectedId: string | null
  onSelectLayer: (id: string | null) => void
  mutate: (
    fn: (p: Coh2FaceplateProject) => Coh2FaceplateProject,
    opts?: { undoable?: boolean },
  ) => void
  onDuplicate: (id: string) => void
  onInsigniaOpen: () => void
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
  maskBrushSize: number
  setMaskBrushSize: (v: number) => void
  maskBrushOpacity: number
  setMaskBrushOpacity: (v: number) => void
  maskPaintMode: 'hide' | 'reveal'
  setMaskPaintMode: (v: 'hide' | 'reveal') => void
}) {
  const mutateLayer = (updater: (l: FaceplateLayer) => FaceplateLayer) => {
    if (!selectedId) return
    mutate(p => mapLayer(p, selectedId, updater))
  }

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
    // Select tool has no peel body — the Adjust Image panel (top-right)
    // handles image-layer controls when a layer is selected.
    return null
  }

  if (tool === 'text') {
    const tl = selectedLayer?.kind === 'text' ? selectedLayer : null
    const fonts = [
      'Inter, system-ui, sans-serif',
      'Arial, Helvetica, sans-serif',
      '"Times New Roman", Georgia, serif',
      'Georgia, serif',
      '"Courier New", monospace',
      'monospace',
    ]
    return (
      <>
        {tl ? (
          <>
            {/* Font family — compact select */}
            <select
              value={tl.fontFamily}
              title="Font family"
              aria-label="Font family"
              onChange={e =>
                mutateLayer(l =>
                  l.kind === 'text' ? ({ ...l, fontFamily: e.target.value } as TextLayer) : l,
                )
              }
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                borderRadius: 5,
                color: EDITOR_TEXT_2,
                fontSize: 11,
                padding: '3px 6px',
                cursor: 'pointer',
                maxWidth: 90,
                height: 28,
              }}
            >
              {fonts.map(f => (
                <option key={f} value={f} style={{ background: '#1a1c22' }}>
                  {f.split(',')[0].replace(/"/g, '')}
                </option>
              ))}
            </select>
            {/* Font size popover */}
            <SliderPopover
              icon={<TextCursorInput size={14} />}
              title="Font size"
              min={8}
              max={200}
              step={1}
              value={Math.round(tl.fontSize)}
              format={v => `${v}px`}
              onChange={v =>
                mutateLayer(l =>
                  l.kind === 'text'
                    ? ({ ...l, fontSize: Math.max(8, Math.min(200, v)) } as TextLayer)
                    : l,
                )
              }
            />
            {/* Font weight — granular selector (matches Photoshop's
                Regular/Medium/Semibold/Bold/Black scale). Surfaced
                alongside the Bold toggle so quick Bold ↔ Regular flips
                still work via the icon button while typography-minded
                users can dial in an exact weight. */}
            <select
              value={tl.fontWeight}
              title="Font weight"
              aria-label="Font weight"
              onChange={e => {
                const next = Number(e.target.value)
                mutateLayer(l =>
                  l.kind === 'text' ? ({ ...l, fontWeight: next } as TextLayer) : l,
                )
              }}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                borderRadius: 5,
                color: EDITOR_TEXT_2,
                fontSize: 11,
                padding: '3px 6px',
                cursor: 'pointer',
                maxWidth: 96,
                height: 28,
              }}
            >
              {(
                [
                  [300, 'Light'],
                  [400, 'Regular'],
                  [500, 'Medium'],
                  [600, 'Semibold'],
                  [700, 'Bold'],
                  [800, 'Extrabold'],
                  [900, 'Black'],
                ] as const
              ).map(([w, label]) => (
                <option key={w} value={w} style={{ background: '#1a1c22' }}>
                  {label}
                </option>
              ))}
            </select>
            {/* Bold (quick-toggle — keeps the icon affordance for users
                who don't want to think about the weight dropdown). */}
            <button
              style={toggleBtnStyle(tl.fontWeight >= 700)}
              title="Bold (toggle)"
              aria-pressed={tl.fontWeight >= 700}
              onClick={() =>
                mutateLayer(l =>
                  l.kind === 'text'
                    ? ({ ...l, fontWeight: tl.fontWeight >= 700 ? 400 : 700 } as TextLayer)
                    : l,
                )
              }
            >
              <Bold size={13} />
            </button>
            {/* Italic */}
            <button
              style={toggleBtnStyle(tl.fontStyle === 'italic')}
              title="Italic"
              aria-pressed={tl.fontStyle === 'italic'}
              onClick={() =>
                mutateLayer(l =>
                  l.kind === 'text'
                    ? ({
                        ...l,
                        fontStyle: tl.fontStyle === 'italic' ? 'normal' : 'italic',
                      } as TextLayer)
                    : l,
                )
              }
            >
              <Italic size={13} />
            </button>
            {/* Letter spacing popover */}
            <SliderPopover
              icon={<MoveHorizontal size={14} />}
              title="Letter spacing"
              min={-2}
              max={10}
              step={0.1}
              value={tl.letterSpacing ?? 0}
              identity={0}
              format={v => `${v.toFixed(1)}px`}
              onChange={v =>
                mutateLayer(l =>
                  l.kind === 'text' ? ({ ...l, letterSpacing: v } as TextLayer) : l,
                )
              }
            />
            {/* Line height popover */}
            <SliderPopover
              icon={<MoveVertical size={14} />}
              title="Line height"
              min={0.8}
              max={2.5}
              step={0.05}
              value={tl.lineHeight ?? 1.2}
              identity={1.2}
              format={v => v.toFixed(2)}
              onChange={v =>
                mutateLayer(l => (l.kind === 'text' ? ({ ...l, lineHeight: v } as TextLayer) : l))
              }
            />
            {/* Alignment buttons */}
            {(['left', 'center', 'right'] as const).map(align => (
              <button
                key={align}
                style={toggleBtnStyle(tl.align === align)}
                title={`Align ${align}`}
                aria-pressed={tl.align === align}
                onClick={() =>
                  mutateLayer(l => (l.kind === 'text' ? ({ ...l, align } as TextLayer) : l))
                }
              >
                {align === 'left' ? (
                  <AlignStartVertical size={13} />
                ) : align === 'center' ? (
                  <AlignCenter size={13} />
                ) : (
                  <AlignEndVertical size={13} />
                )}
              </button>
            ))}
            {/* Color */}
            <HexColorInput
              value={tl.color}
              onChange={hex =>
                mutateLayer(l => (l.kind === 'text' ? ({ ...l, color: hex } as TextLayer) : l))
              }
              title="Text colour"
              size={24}
            />
          </>
        ) : (
          <p style={peelHint}>Click on the canvas to place text, or select a text layer.</p>
        )}
      </>
    )
  }

  if (tool === 'shapes') {
    const shapeKinds: ShapeKind[] = ['rectangle', 'circle', 'chevron', 'star', 'shield']
    const shapeLayer = selectedLayer?.kind === 'shape' ? selectedLayer : null
    const shapeIcon = (kind: ShapeKind): React.ReactNode => {
      switch (kind) {
        case 'rectangle':
          return (
            <svg width={14} height={14} viewBox="0 0 14 14">
              <rect x={1} y={3} width={12} height={8} rx={1} fill="currentColor" />
            </svg>
          )
        case 'circle':
          return <Circle size={14} />
        case 'chevron':
          return (
            <svg width={14} height={14} viewBox="0 0 14 14">
              <polyline
                points="3,3 8,7 3,11"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
          )
        case 'star':
          return <Star size={14} />
        case 'shield':
          return (
            <svg width={14} height={14} viewBox="0 0 14 14">
              <path
                d="M7 1 L12 3.5 V7 C12 10 9.5 12.5 7 13 C4.5 12.5 2 10 2 7 V3.5 Z"
                fill="currentColor"
              />
            </svg>
          )
        default:
          return <Shapes size={14} />
      }
    }
    return (
      <>
        {shapeKinds.map(kind => (
          <button
            key={kind}
            title={kind.charAt(0).toUpperCase() + kind.slice(1)}
            aria-label={kind.charAt(0).toUpperCase() + kind.slice(1)}
            onClick={() => mutate(p => ({ ...p, layers: [...p.layers, newShapeLayer(kind)] }))}
            style={toggleBtnStyle(false)}
          >
            {shapeIcon(kind)}
          </button>
        ))}
        <button
          onClick={onInsigniaOpen}
          title="Insignia library"
          aria-label="Insignia library"
          style={toggleBtnStyle(false)}
        >
          <Library size={14} />
        </button>
        {shapeLayer && (
          <>
            <HexColorInput
              value={shapeLayer.fillColor}
              onChange={hex =>
                mutateLayer(l =>
                  l.kind === 'shape' ? ({ ...l, fillColor: hex } as ShapeLayer) : l,
                )
              }
              title="Fill colour"
              size={24}
            />
            {/* Gradient fill editor — when gradientFill is set it overrides fillColor. */}
            <GradientFillEditor
              value={(shapeLayer as ShapeLayer).gradientFill as GradientFill | undefined}
              onChange={next =>
                mutateLayer(l =>
                  l.kind === 'shape' ? ({ ...l, gradientFill: next } as ShapeLayer) : l,
                )
              }
            />
            <SliderPopover
              icon={<MoveHorizontal size={14} />}
              title="Width"
              min={20}
              max={FACEPLATE_BANNER_W}
              step={1}
              value={shapeLayer.width}
              format={v => `${Math.round(v)}px`}
              onChange={v =>
                mutateLayer(l => (l.kind === 'shape' ? ({ ...l, width: v } as ShapeLayer) : l))
              }
            />
            <SliderPopover
              icon={<MoveVertical size={14} />}
              title="Height"
              min={20}
              max={FACEPLATE_BANNER_H}
              step={1}
              value={shapeLayer.height}
              format={v => `${Math.round(v)}px`}
              onChange={v =>
                mutateLayer(l => (l.kind === 'shape' ? ({ ...l, height: v } as ShapeLayer) : l))
              }
            />
            <SliderPopover
              icon={<CaseSensitive size={14} />}
              title="Opacity"
              min={0}
              max={1}
              step={0.01}
              value={shapeLayer.opacity}
              identity={1}
              format={v => `${Math.round(v * 100)}%`}
              onChange={v => mutateLayer(l => ({ ...l, opacity: v }))}
            />
          </>
        )}
      </>
    )
  }

  if (tool === 'draw') {
    return (
      <>
        <SliderPopover
          icon={<Brush size={14} />}
          title="Brush size"
          min={1}
          max={80}
          step={1}
          value={brushSize}
          identity={12}
          format={v => `${v}px`}
          onChange={setBrushSize}
        />
        {/* Brush colour — visually muted when in erase mode (colour is irrelevant). */}
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
          min={0}
          max={1}
          step={0.01}
          value={brushOpacity}
          identity={1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={setBrushOpacity}
        />
        {/* Erase toggle — switches stroke to destination-out (pixel eraser). */}
        <button
          title={brushErase ? 'Erase mode ON (click to switch to paint)' : 'Switch to erase mode'}
          aria-pressed={brushErase}
          data-testid="brush-erase-toggle"
          onClick={() => setBrushErase(!brushErase)}
          style={toggleBtnStyle(brushErase)}
        >
          <Eraser size={14} />
        </button>
        {/* Mirror X toggle */}
        <button
          title="Mirror horizontally (X axis)"
          aria-pressed={mirrorX}
          onClick={() => setMirrorX(!mirrorX)}
          style={toggleBtnStyle(mirrorX)}
        >
          <FlipHorizontal2 size={14} />
        </button>
        {/* Mirror Y toggle */}
        <button
          title="Mirror vertically (Y axis)"
          aria-pressed={mirrorY}
          onClick={() => setMirrorY(!mirrorY)}
          style={toggleBtnStyle(mirrorY)}
        >
          <FlipVertical2 size={14} />
        </button>
        {/* Clear paint layer */}
        <button
          title="Clear paint layer"
          aria-label="Clear paint layer"
          style={{
            ...toggleBtnStyle(false),
            color: '#f87171',
            border: '1px solid rgba(255,80,80,0.3)',
            background: 'rgba(255,80,80,0.08)',
          }}
          onClick={() => {
            const paintLayer = project.layers.find((l): l is PaintLayer => l.kind === 'paint')
            if (!paintLayer) return
            const BLANK_PNG =
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
            mutate(p =>
              mapLayer(p, paintLayer.id, l =>
                l.kind === 'paint' ? { ...l, dataUrl: BLANK_PNG } : l,
              ),
            )
          }}
        >
          <Trash2 size={14} />
        </button>
      </>
    )
  }

  if (tool === 'shadow') {
    if (!selectedLayer) {
      return <p style={peelHint}>Select a layer to add a drop shadow.</p>
    }
    const shadow =
      (selectedLayer.kind !== 'group' ? selectedLayer.shadow : undefined) ?? LAYER_SHADOW_DEFAULTS
    const hexFromRgba = (rgba: string): string => {
      const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!m) return '#000000'
      const r = parseInt(m[1]).toString(16).padStart(2, '0')
      const g = parseInt(m[2]).toString(16).padStart(2, '0')
      const b = parseInt(m[3]).toString(16).padStart(2, '0')
      return `#${r}${g}${b}`
    }
    const alphaFromRgba = (rgba: string): number => {
      const m = rgba.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)/)
      return m ? parseFloat(m[1]) : 0.5
    }
    const hexColor = hexFromRgba(shadow.color)
    const shadowAlpha = alphaFromRgba(shadow.color)
    const buildRgba = (hex: string, alpha: number): string => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return `rgba(${r},${g},${b},${alpha})`
    }
    const updateShadow = (patch: Partial<typeof shadow>) => {
      const merged = { ...shadow, ...patch }
      const isIdentity = merged.offsetX === 0 && merged.offsetY === 0 && merged.blur === 0
      mutateLayer(l => ({ ...l, shadow: isIdentity ? undefined : merged }))
    }

    return (
      <>
        <HexColorInput
          value={hexColor}
          onChange={hex => updateShadow({ color: buildRgba(hex, shadowAlpha) })}
          title="Shadow colour"
          size={24}
        />
        <SliderPopover
          icon={<CaseSensitive size={14} />}
          title="Shadow opacity"
          min={0}
          max={1}
          step={0.05}
          value={shadowAlpha}
          identity={0.5}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => updateShadow({ color: buildRgba(hexColor, v) })}
        />
        <SliderPopover
          icon={<MoveHorizontal size={14} />}
          title="Shadow offset X"
          min={-50}
          max={50}
          step={1}
          value={shadow.offsetX}
          identity={0}
          format={v => `${v}px`}
          onChange={v => updateShadow({ offsetX: v })}
        />
        <SliderPopover
          icon={<MoveVertical size={14} />}
          title="Shadow offset Y"
          min={-50}
          max={50}
          step={1}
          value={shadow.offsetY}
          identity={0}
          format={v => `${v}px`}
          onChange={v => updateShadow({ offsetY: v })}
        />
        <SliderPopover
          icon={<Slash size={14} />}
          title="Shadow blur"
          min={0}
          max={50}
          step={1}
          value={shadow.blur}
          identity={0}
          format={v => `${v}px`}
          onChange={v => updateShadow({ blur: v })}
        />
        {/* Silhouette stroke section — only for TextLayer and PaintLayer.
            ShapeLayer has its own stroke editing in the Shapes peel. */}
        {(selectedLayer.kind === 'text' || selectedLayer.kind === 'paint') &&
          (() => {
            const stroke: LayerStroke | undefined =
              selectedLayer.kind === 'text'
                ? (selectedLayer as TextLayer).stroke
                : (selectedLayer as PaintLayer).stroke
            const strokeColor = stroke?.color ?? '#000000'
            const strokeWidth = stroke?.width ?? 0
            const updateStroke = (patch: Partial<LayerStroke>) => {
              const next = { ...stroke, ...patch }
              const isIdentity = (next.width ?? 0) === 0
              mutateLayer(l =>
                l.kind === 'text'
                  ? ({ ...l, stroke: isIdentity ? undefined : next } as TextLayer)
                  : l.kind === 'paint'
                    ? ({ ...l, stroke: isIdentity ? undefined : next } as PaintLayer)
                    : l,
              )
            }
            return (
              <>
                <div
                  style={{
                    width: 1,
                    height: 24,
                    background: 'rgba(255,255,255,0.10)',
                    flexShrink: 0,
                    marginLeft: 4,
                    marginRight: 4,
                  }}
                />
                <HexColorInput
                  value={strokeColor}
                  onChange={color => updateStroke({ color, width: strokeWidth || 1 })}
                  title="Stroke colour"
                  size={24}
                />
                <SliderPopover
                  icon={<Slash size={14} />}
                  title="Stroke width"
                  min={0}
                  max={20}
                  step={0.5}
                  value={strokeWidth}
                  identity={0}
                  format={v => `${v}px`}
                  onChange={v => updateStroke({ color: strokeColor, width: v })}
                />
              </>
            )
          })()}
      </>
    )
  }

  if (tool === 'background') {
    const isTransparent = project.backgroundColor === null
    return (
      <>
        <HexColorInput
          value={isTransparent ? '#000000' : (project.backgroundColor ?? '#000000')}
          onChange={hex => {
            if (!isTransparent) mutate(p => ({ ...p, backgroundColor: hex }))
          }}
          title="Background colour"
          size={24}
        />
        <button
          title={isTransparent ? 'Switch to solid colour' : 'Switch to transparent background'}
          aria-label={isTransparent ? 'Switch to solid colour' : 'Switch to transparent background'}
          aria-pressed={isTransparent}
          style={toggleBtnStyle(isTransparent)}
          onClick={() => mutate(p => ({ ...p, backgroundColor: isTransparent ? '#000000' : null }))}
        >
          {isTransparent ? <WholeWord size={14} /> : <Slash size={14} />}
        </button>
      </>
    )
  }

  if (tool === 'align') {
    if (!selectedLayer) {
      return <p style={peelHint}>Select a layer first.</p>
    }
    const alignLayer = (updater: (l: FaceplateLayer) => FaceplateLayer) => {
      mutate(p => mapLayer(p, selectedLayer.id, updater))
    }

    const layerBoundsW = (() => {
      if (selectedLayer.kind === 'text') {
        const lines = selectedLayer.text.split('\n')
        const longestLine = Math.max(...lines.map(l => l.length), 1)
        return longestLine * selectedLayer.fontSize * selectedLayer.scale * 0.6
      }
      if (selectedLayer.kind === 'shape') return selectedLayer.width * selectedLayer.scale
      return 0
    })()
    const layerBoundsH = (() => {
      if (selectedLayer.kind === 'text') {
        const lines = selectedLayer.text.split('\n')
        return lines.length * selectedLayer.fontSize * selectedLayer.scale * 1.2
      }
      if (selectedLayer.kind === 'shape') return selectedLayer.height * selectedLayer.scale
      return 0
    })()

    return (
      <>
        <button
          style={toggleBtnStyle(false)}
          title="Align Left"
          onClick={() => alignLayer(l => ({ ...l, x: layerBoundsW / 2 }))}
        >
          <AlignStartVertical size={13} />
        </button>
        <button
          style={toggleBtnStyle(false)}
          title="Center Horizontally"
          onClick={() => alignLayer(l => ({ ...l, x: FACEPLATE_BANNER_W / 2 }))}
        >
          <AlignCenterVertical size={13} />
        </button>
        <button
          style={toggleBtnStyle(false)}
          title="Align Right"
          onClick={() => alignLayer(l => ({ ...l, x: FACEPLATE_BANNER_W - layerBoundsW / 2 }))}
        >
          <AlignEndVertical size={13} />
        </button>
        <button
          style={toggleBtnStyle(false)}
          title="Align Top"
          onClick={() => alignLayer(l => ({ ...l, y: layerBoundsH / 2 }))}
        >
          <AlignStartHorizontal size={13} />
        </button>
        <button
          style={toggleBtnStyle(false)}
          title="Center Vertically"
          onClick={() => alignLayer(l => ({ ...l, y: FACEPLATE_BANNER_H / 2 }))}
        >
          <AlignCenter size={13} />
        </button>
        <button
          style={toggleBtnStyle(false)}
          title="Align Bottom"
          onClick={() => alignLayer(l => ({ ...l, y: FACEPLATE_BANNER_H - layerBoundsH / 2 }))}
        >
          <AlignEndHorizontal size={13} />
        </button>
        <button
          style={toggleBtnStyle(false)}
          title="Center both axes"
          onClick={() =>
            alignLayer(l => ({ ...l, x: FACEPLATE_BANNER_W / 2, y: FACEPLATE_BANNER_H / 2 }))
          }
        >
          <AlignCenter size={13} />
        </button>
      </>
    )
  }

  if (tool === 'mask') {
    // Determine if the selected layer is mask-compatible (Image or Paint).
    const maskLayer =
      selectedLayer && (selectedLayer.kind === 'image' || selectedLayer.kind === 'paint')
        ? (selectedLayer as ImageLayer | PaintLayer)
        : null

    if (!maskLayer) {
      return <p style={peelHint}>Select an Image or Paint layer to add a mask.</p>
    }

    const hasMask = !!maskLayer.mask?.dataUrl

    // ── Blank 1×1 white PNG — the identity mask (fully visible). ──
    const BLANK_WHITE_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII='

    if (!hasMask) {
      return (
        <button
          type="button"
          data-testid="mask-add-btn"
          onClick={() => {
            mutate(p =>
              mapLayer(p, maskLayer.id, l =>
                l.kind === 'image' || l.kind === 'paint'
                  ? { ...l, mask: { dataUrl: BLANK_WHITE_PNG, enabled: true } }
                  : l,
              ),
            )
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(120,180,255,0.12)',
            border: '1px solid rgba(120,180,255,0.30)',
            borderRadius: 7,
            color: EDITOR_ACCENT,
            fontSize: 11,
            fontWeight: 600,
            padding: '5px 12px',
            cursor: 'pointer',
          }}
        >
          + Add Mask
        </button>
      )
    }

    // ── Mask exists — show full controls ──────────────────────────────────
    return (
      <>
        {/* Brush size */}
        <SliderPopover
          icon={<Brush size={14} />}
          title="Mask brush size"
          min={8}
          max={200}
          step={1}
          value={maskBrushSize}
          identity={32}
          format={v => `${v}px`}
          onChange={v => setMaskBrushSize(v)}
        />
        {/* Brush opacity */}
        <SliderPopover
          icon={<CaseSensitive size={14} />}
          title="Mask brush opacity"
          min={0}
          max={1}
          step={0.01}
          value={maskBrushOpacity}
          identity={1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => setMaskBrushOpacity(v)}
        />
        {/* Hide / Reveal toggle */}
        <button
          title="Hide — paint black to mask out pixels"
          aria-pressed={maskPaintMode === 'hide'}
          data-testid="mask-mode-hide"
          onClick={() => setMaskPaintMode('hide')}
          style={toggleBtnStyle(maskPaintMode === 'hide')}
        >
          Hide
        </button>
        <button
          title="Reveal — paint white to restore pixels"
          aria-pressed={maskPaintMode === 'reveal'}
          data-testid="mask-mode-reveal"
          onClick={() => setMaskPaintMode('reveal')}
          style={toggleBtnStyle(maskPaintMode === 'reveal')}
        >
          Reveal
        </button>
        {/* Enable / disable mask */}
        <button
          title={
            maskLayer.mask?.enabled !== false
              ? 'Mask enabled (click to disable)'
              : 'Mask disabled (click to enable)'
          }
          aria-pressed={maskLayer.mask?.enabled !== false}
          data-testid="mask-enable-toggle"
          onClick={() =>
            mutate(p =>
              mapLayer(p, maskLayer.id, l =>
                l.kind === 'image' || l.kind === 'paint'
                  ? {
                      ...l,
                      mask: { ...l.mask!, enabled: l.mask?.enabled === false ? true : false },
                    }
                  : l,
              ),
            )
          }
          style={toggleBtnStyle(maskLayer.mask?.enabled !== false)}
        >
          {maskLayer.mask?.enabled !== false ? 'Enabled' : 'Disabled'}
        </button>
        {/* Invert mask */}
        <button
          title="Invert mask — flip black/white pixels"
          data-testid="mask-invert-btn"
          onClick={() => {
            const currentUrl = maskLayer.mask?.dataUrl
            if (!currentUrl) return
            const img = new Image()
            img.onload = () => {
              const off = document.createElement('canvas')
              off.width = img.naturalWidth || FACEPLATE_BANNER_W
              off.height = img.naturalHeight || FACEPLATE_BANNER_H
              const octx = off.getContext('2d')!
              octx.drawImage(img, 0, 0)
              const imageData = octx.getImageData(0, 0, off.width, off.height)
              const data = imageData.data
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 255 - data[i]
                data[i + 1] = 255 - data[i + 1]
                data[i + 2] = 255 - data[i + 2]
                // alpha unchanged
              }
              octx.putImageData(imageData, 0, 0)
              const newUrl = off.toDataURL('image/png')
              mutate(p =>
                mapLayer(p, maskLayer.id, l =>
                  l.kind === 'image' || l.kind === 'paint'
                    ? { ...l, mask: { ...l.mask!, dataUrl: newUrl } }
                    : l,
                ),
              )
            }
            img.src = currentUrl
          }}
          style={toggleBtnStyle(false)}
        >
          Invert
        </button>
        {/* Apply mask — bakes mask into paint layer alpha */}
        <button
          title={
            maskLayer.kind === 'image'
              ? 'Apply not yet supported for image layers'
              : 'Apply — bake mask into paint layer alpha'
          }
          data-testid="mask-apply-btn"
          disabled={maskLayer.kind === 'image'}
          onClick={() => {
            if (maskLayer.kind !== 'paint') return
            const paintUrl = maskLayer.dataUrl
            const maskUrl = maskLayer.mask?.dataUrl
            if (!maskUrl) return
            const paintImg = new Image()
            paintImg.onload = () => {
              const maskImg = new Image()
              maskImg.onload = () => {
                const off = document.createElement('canvas')
                off.width = FACEPLATE_BANNER_W
                off.height = FACEPLATE_BANNER_H
                const octx = off.getContext('2d')!
                // Draw paint, then use mask as alpha.
                octx.drawImage(paintImg, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
                // Composite mask as destination-in to apply alpha.
                const maskCanvas = document.createElement('canvas')
                maskCanvas.width = FACEPLATE_BANNER_W
                maskCanvas.height = FACEPLATE_BANNER_H
                const mctx = maskCanvas.getContext('2d')!
                mctx.drawImage(maskImg, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
                const maskData = mctx.getImageData(0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
                const paintData = octx.getImageData(0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
                // Use mask luminance to modulate paint alpha.
                for (let i = 0; i < paintData.data.length; i += 4) {
                  const lum = (maskData.data[i] + maskData.data[i + 1] + maskData.data[i + 2]) / 3
                  paintData.data[i + 3] = Math.round((paintData.data[i + 3] * lum) / 255)
                }
                octx.putImageData(paintData, 0, 0)
                const newUrl = off.toDataURL('image/png')
                mutate(p =>
                  mapLayer(p, maskLayer.id, l =>
                    l.kind === 'paint' ? { ...l, dataUrl: newUrl, mask: undefined } : l,
                  ),
                )
              }
              maskImg.src = maskUrl
            }
            paintImg.src = paintUrl
          }}
          style={{
            ...toggleBtnStyle(false),
            opacity: maskLayer.kind === 'image' ? 0.45 : 1,
            cursor: maskLayer.kind === 'image' ? 'not-allowed' : 'pointer',
          }}
        >
          Apply
        </button>
        {/* Discard mask */}
        <button
          title="Discard mask — remove the mask from this layer"
          data-testid="mask-discard-btn"
          onClick={() =>
            mutate(p =>
              mapLayer(p, maskLayer.id, l =>
                l.kind === 'image' || l.kind === 'paint' ? { ...l, mask: undefined } : l,
              ),
            )
          }
          style={{
            ...toggleBtnStyle(false),
            color: '#f87171',
            border: '1px solid rgba(255,80,80,0.3)',
            background: 'rgba(255,80,80,0.08)',
          }}
        >
          Discard
        </button>
        {/* Mask thumbnail (40×40 preview) */}
        {maskLayer.mask?.dataUrl && (
          <img
            src={maskLayer.mask.dataUrl}
            alt="Mask preview"
            data-testid="mask-thumbnail"
            title="Mask preview — white = visible, black = hidden"
            style={{
              width: 40,
              height: 40,
              objectFit: 'contain',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.12)',
              flexShrink: 0,
            }}
          />
        )}
      </>
    )
  }

  return null
}

/** Inline style for the small dim hint copy that appears inside the peel
 *  when a tool has nothing meaningful to show. */
const peelHint: CSSProperties = {
  margin: 0,
  fontSize: 11,
  lineHeight: 1.4,
  color: EDITOR_TEXT_4,
  maxWidth: 220,
}

// ─────────────────────────────────────────────────────────────────────────
// Layer / mutation helpers
// ─────────────────────────────────────────────────────────────────────────

// ── Duplicate layer helper ──────────────────────────────────────────────────

/**
 * Deep-clone a layer, assign it a fresh id, suffix its display name with
 * "(copy)", and offset its position by +20 px on both axes so the copy is
 * visually distinguishable from the original.
 *
 * Exported (eslint-disabled) so the unit test in
 * `src/lib/__tests__/duplicate-layer.test.ts` can call it directly.
 *
 * @public
 */
// eslint-disable-next-line react-refresh/only-export-components
export function duplicateLayerHelper(source: FaceplateLayer): FaceplateLayer {
  const clone = structuredClone(source)
  clone.id = 'layer_' + Math.random().toString(36).slice(2, 10)
  if (clone.kind === 'group') {
    // Groups don't have x/y — just assign a new id and suffix the name.
    if (!clone.name.endsWith(' (copy)')) {
      clone.name = clone.name + ' (copy)'
    }
    return clone
  }
  // After the group guard above, `source` and `clone` are non-group layers
  // (ImageLayer | TextLayer | ShapeLayer | PaintLayer) which all have x/y.
  ;(clone as { x: number }).x = (source as { x: number }).x + 20
  ;(clone as { y: number }).y = (source as { y: number }).y + 20
  if (clone.kind === 'text' && source.kind === 'text') {
    // Append "(copy)" to text content so the layer is labelled differently in
    // the Layers panel. Avoid double-suffixing if the user duplicates a copy.
    if (!clone.text.endsWith(' (copy)')) {
      clone.text = clone.text + ' (copy)'
    }
  }
  return clone
}

/** Immutable single-layer updater. */
function mapLayer(
  p: Coh2FaceplateProject,
  id: string,
  fn: (l: FaceplateLayer) => FaceplateLayer,
): Coh2FaceplateProject {
  return { ...p, layers: p.layers.map(l => (l.id === id ? fn(l) : l)) }
}

/** Move a layer up (+1) or down (-1) in the stack. Top of array = top of
 *  the canvas (renders last). */
function moveLayer(p: Coh2FaceplateProject, id: string, dir: -1 | 1): Coh2FaceplateProject {
  const idx = p.layers.findIndex(l => l.id === id)
  if (idx < 0) return p
  const target = idx + dir
  if (target < 0 || target >= p.layers.length) return p
  const layers = [...p.layers]
  const [item] = layers.splice(idx, 1)
  layers.splice(target, 0, item)
  return { ...p, layers }
}

/** Pointer drag — translates the layer's centre by the pointer delta,
 *  scaled from on-screen pixels back to canvas-space pixels. Uses pointer
 *  capture so the drag continues even when the pointer leaves the layer.
 *
 *  Passes snap targets derived from canvas edges, canvas centre, and sibling
 *  layer centres. Renders guide lines via `setSnapGuides` while dragging. */
function beginDrag(
  ev: ReactPointerEvent,
  layer: FaceplateLayer,
  viewScale: number,
  mutate: (fn: (p: Coh2FaceplateProject) => Coh2FaceplateProject) => void,
  project: Coh2FaceplateProject,
  setSnapGuides: (guides: SnapTarget[]) => void,
) {
  // Group layers don't carry position — cannot drag them.
  if (layer.kind === 'group') return
  const startX = ev.clientX
  const startY = ev.clientY
  const startLayerX = layer.x
  const startLayerY = layer.y
  const targetEl = ev.currentTarget as HTMLElement
  try {
    targetEl.setPointerCapture(ev.pointerId)
  } catch {
    /* setPointerCapture can throw in some headless contexts */
  }

  // Build snap targets once at drag-start (targets from sibling layer
  // centres don't need to update mid-drag — they don't move).
  // Half-bbox is not easily computable without DOM, so we use 0 for edges
  // (the layer's x/y IS its centre due to translate(-50%,-50%)).
  const snapTargets: SnapTarget[] = [
    { kind: 'x', value: FACEPLATE_BANNER_W / 2, label: 'canvas center X' },
    { kind: 'y', value: FACEPLATE_BANNER_H / 2, label: 'canvas center Y' },
    { kind: 'x', value: 0, label: 'canvas left edge' },
    { kind: 'x', value: FACEPLATE_BANNER_W, label: 'canvas right edge' },
    { kind: 'y', value: 0, label: 'canvas top edge' },
    { kind: 'y', value: FACEPLATE_BANNER_H, label: 'canvas bottom edge' },
    // Sibling layer centres (other visible, non-group, non-paint layers with numeric x/y).
    ...project.layers
      .filter(
        (l): l is ImageLayer | TextLayer | ShapeLayer =>
          l.id !== layer.id &&
          l.visible &&
          (l.kind === 'image' || l.kind === 'text' || l.kind === 'shape'),
      )
      .flatMap(l => [
        { kind: 'x' as const, value: l.x, label: `layer ${l.id} X` },
        { kind: 'y' as const, value: l.y, label: `layer ${l.id} Y` },
      ]),
  ]

  const onMove = (e: PointerEvent) => {
    const dx = (e.clientX - startX) / viewScale
    const dy = (e.clientY - startY) / viewScale
    const candidateX = startLayerX + dx
    const candidateY = startLayerY + dy
    const { snappedX, snappedY, firedTargets } = applySnap(candidateX, candidateY, snapTargets)
    setSnapGuides(firedTargets)
    mutate(p => mapLayer(p, layer.id, l => ({ ...l, x: snappedX, y: snappedY })))
  }
  const onUp = (e: PointerEvent) => {
    setSnapGuides([])
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    try {
      targetEl.releasePointerCapture(e.pointerId)
    } catch {
      /* releasePointerCapture can throw in some contexts */
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// ─────────────────────────────────────────────────────────────────────────
// Canvas composition — runs the layers through an offscreen 2D canvas so
// the in-game preview can show the final pixels live.
// ─────────────────────────────────────────────────────────────────────────

/** Build the raw composed canvas. Canvas is 624×204 — the engine's banner
 *  display rect (see faceplate-templates.ts for the verification chain).
 *
 *  Exported (with `@public` so knip doesn't flag the spec-only consumer) so
 *  the fast-check determinism fuzz suite in `src/lib/__tests__/fuzz.test.ts`
 *  can assert byte-stable output. Within the editor it remains called
 *  exclusively by `composeFaceplatePng` and the in-game preview.
 *
 *  The eslint-disable below is required because `react-refresh/only-export-components`
 *  doesn't allow non-component exports from a TSX file with components. Moving
 *  this function to `src/lib/faceplate-composer.ts` would be cleaner — deferred
 *  to v1.1 because it has tight coupling to inline shape-helper functions
 *  defined below in this file. */
// ── Mulberry32 deterministic RNG ─────────────────────────────────────────────
// Tiny seedable PRNG (~6 lines). Used to produce byte-stable noise grain so
// the exported PNG doesn't differ on every call for the same project state.
// Seed is derived from the layer id so each layer has independent grain.
function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

/** Hash a string layer id to a 32-bit integer for use as an RNG seed. */
function hashLayerId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** @public */
// eslint-disable-next-line react-refresh/only-export-components
export async function composeFaceplateCanvas(p: Coh2FaceplateProject): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas')
  c.width = FACEPLATE_BANNER_W
  c.height = FACEPLATE_BANNER_H
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  // Background
  if (p.backgroundColor) {
    ctx.fillStyle = p.backgroundColor
    ctx.fillRect(0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
  }

  // Load all images in parallel — composing serially would block the
  // first paint of the preview behind every successive decode.
  const imageEls = await Promise.all(
    Object.values(p.images).map(
      img =>
        new Promise<{ id: string; el: HTMLImageElement }>((res, rej) => {
          const el = new Image()
          el.onload = () => res({ id: img.id, el })
          el.onerror = () => rej(new Error(`Image "${img.name}" failed to decode`))
          el.src = img.dataUrl
        }),
    ),
  )
  const byId = new Map(imageEls.map(it => [it.id, it.el]))

  // Track the previous visible layer's rendered canvas for clipping-mask
  // support on ImageLayer and PaintLayer (Wave 1 scope only).
  let prevLayerCanvas: HTMLCanvasElement | null = null

  for (const layer of p.layers) {
    if (!layer.visible) continue

    if (layer.kind === 'text') {
      ctx.save()
      ctx.globalAlpha = layer.opacity
      // v6: blend mode — set after globalAlpha, reset defensively before restore.
      ctx.globalCompositeOperation = (layer.blendMode ?? 'normal') as GlobalCompositeOperation
      // Apply shadow before drawing text
      if (
        layer.shadow &&
        (layer.shadow.blur > 0 || layer.shadow.offsetX !== 0 || layer.shadow.offsetY !== 0)
      ) {
        ctx.shadowOffsetX = layer.shadow.offsetX
        ctx.shadowOffsetY = layer.shadow.offsetY
        ctx.shadowBlur = layer.shadow.blur
        ctx.shadowColor = layer.shadow.color
      }
      ctx.translate(layer.x, layer.y)
      ctx.rotate((layer.rotation * Math.PI) / 180)
      ctx.scale(layer.scale, layer.scale)
      ctx.font = `${layer.fontStyle === 'italic' ? 'italic ' : ''}${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
      // Apply letterSpacing via ctx.letterSpacing if supported (Chrome 99+),
      // fallback gracefully otherwise.
      if ('letterSpacing' in ctx) {
        ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
          `${layer.letterSpacing ?? 0}px`
      }
      ctx.textAlign = layer.align as CanvasTextAlign
      ctx.textBaseline = 'middle'
      const lines = layer.text.split('\n')
      const lhMult = layer.lineHeight ?? 1.2
      const lineHeight = layer.fontSize * lhMult
      const totalH = lineHeight * lines.length
      const startY = -(totalH / 2) + lineHeight / 2
      // v6: silhouette stroke on TextLayer (simple version — strokeText with
      // wider lineWidth). This draws around glyph outlines rather than the true
      // alpha silhouette of the rendered block, which is visually close enough
      // for most use cases. A proper offscreen-canvas silhouette stroke is
      // deferred to Wave 2 (TODO: replace with blurred offscreen composite).
      if (layer.stroke && layer.stroke.width > 0) {
        ctx.strokeStyle = layer.stroke.color
        ctx.lineWidth = layer.stroke.width * 2 // double — applied to both sides
        ctx.lineJoin = 'round'
        lines.forEach((line, i) => {
          ctx.strokeText(line, 0, startY + i * lineHeight)
        })
      } else if (layer.strokeWidth > 0 && layer.strokeColor) {
        // Existing per-character stroke (pre-v6 behaviour preserved).
        ctx.strokeStyle = layer.strokeColor
        ctx.lineWidth = layer.strokeWidth
        ctx.lineJoin = 'round'
        lines.forEach((line, i) => {
          ctx.strokeText(line, 0, startY + i * lineHeight)
        })
      }
      ctx.fillStyle = layer.color
      lines.forEach((line, i) => {
        ctx.fillText(line, 0, startY + i * lineHeight)
      })
      ctx.shadowColor = 'transparent'
      // Defensive composite reset before restore (mirrors Firefox filter leak).
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
      // TextLayer mask + clipping deferred to Wave 3 (TODO).
      prevLayerCanvas = null
      continue
    }

    if (layer.kind === 'paint') {
      // Render paint layer as a full-banner image overlay.
      const paintEl = await new Promise<HTMLImageElement>((res, rej) => {
        const img = new Image()
        img.onload = () => res(img)
        img.onerror = () => rej(new Error('Paint layer decode failed'))
        img.src = layer.dataUrl
      }).catch(() => null)
      if (paintEl) {
        // v6: clipping mask — clip to alpha of previous visible layer.
        // Only supported on PaintLayer in Wave 1.
        if (layer.clippedToLayerBelow && prevLayerCanvas) {
          const offClip = document.createElement('canvas')
          offClip.width = FACEPLATE_BANNER_W
          offClip.height = FACEPLATE_BANNER_H
          const offClipCtx = offClip.getContext('2d')
          if (offClipCtx) {
            offClipCtx.globalAlpha = layer.opacity
            offClipCtx.globalCompositeOperation = (layer.blendMode ??
              'normal') as GlobalCompositeOperation
            offClipCtx.drawImage(paintEl, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
            offClipCtx.globalCompositeOperation = 'destination-in'
            offClipCtx.drawImage(prevLayerCanvas, 0, 0)
            ctx.drawImage(offClip, 0, 0)
          }
        } else {
          ctx.save()
          ctx.globalAlpha = layer.opacity
          ctx.globalCompositeOperation = (layer.blendMode ?? 'normal') as GlobalCompositeOperation
          ctx.drawImage(paintEl, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
          // v6: silhouette stroke on PaintLayer.
          // Render the paint to an offscreen canvas, blur + composite to extract
          // the silhouette, draw the tinted border behind the fill.
          if (layer.stroke && layer.stroke.width > 0) {
            const offStroke = document.createElement('canvas')
            offStroke.width = FACEPLATE_BANNER_W
            offStroke.height = FACEPLATE_BANNER_H
            const offCtx = offStroke.getContext('2d')
            if (offCtx) {
              offCtx.drawImage(paintEl, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
              offCtx.filter = `blur(${layer.stroke.width}px)`
              offCtx.globalCompositeOperation = 'source-out'
              offCtx.fillStyle = layer.stroke.color
              offCtx.fillRect(0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
              ctx.globalCompositeOperation = 'destination-over'
              ctx.drawImage(offStroke, 0, 0)
            }
          }
          ctx.globalCompositeOperation = 'source-over'
          ctx.restore()
        }

        // v6: layer mask on PaintLayer.
        if (layer.mask?.dataUrl && layer.mask.enabled !== false) {
          const maskEl = await new Promise<HTMLImageElement | null>(res => {
            const img = new Image()
            img.onload = () => res(img)
            img.onerror = () => res(null)
            img.src = layer.mask!.dataUrl
          })
          if (maskEl) {
            // Read back the region we just painted, apply the mask in-place.
            const offMask = document.createElement('canvas')
            offMask.width = FACEPLATE_BANNER_W
            offMask.height = FACEPLATE_BANNER_H
            const offMCtx = offMask.getContext('2d')
            if (offMCtx) {
              offMCtx.drawImage(paintEl, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
              offMCtx.globalCompositeOperation = layer.mask.invert
                ? 'destination-out'
                : 'destination-in'
              offMCtx.drawImage(maskEl, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
              // Clear the painted region then redraw through the mask.
              ctx.save()
              ctx.globalCompositeOperation = 'destination-out'
              ctx.drawImage(paintEl, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
              ctx.restore()
              ctx.drawImage(offMask, 0, 0)
            }
          }
        }

        // Record this layer's render for the next layer's potential clipping.
        const snap = document.createElement('canvas')
        snap.width = FACEPLATE_BANNER_W
        snap.height = FACEPLATE_BANNER_H
        const snapCtx = snap.getContext('2d')
        if (snapCtx) snapCtx.drawImage(paintEl, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
        prevLayerCanvas = snap
      } else {
        prevLayerCanvas = null
      }
      continue
    }

    if (layer.kind === 'shape') {
      ctx.save()
      ctx.globalAlpha = layer.opacity
      // v6: blend mode.
      ctx.globalCompositeOperation = (layer.blendMode ?? 'normal') as GlobalCompositeOperation
      // Apply shadow before drawing shape
      if (
        layer.shadow &&
        (layer.shadow.blur > 0 || layer.shadow.offsetX !== 0 || layer.shadow.offsetY !== 0)
      ) {
        ctx.shadowOffsetX = layer.shadow.offsetX
        ctx.shadowOffsetY = layer.shadow.offsetY
        ctx.shadowBlur = layer.shadow.blur
        ctx.shadowColor = layer.shadow.color
      }
      ctx.translate(layer.x, layer.y)
      ctx.rotate((layer.rotation * Math.PI) / 180)
      ctx.scale(layer.scale, layer.scale)
      const sw = layer.width
      const sh = layer.height
      const path = shapeToPath2D(layer.shapeType, sw, sh)

      // v6: gradientFill — overrides fillColor when present.
      if (layer.gradientFill) {
        const gf = layer.gradientFill
        let gradient: CanvasGradient
        if (gf.kind === 'linear') {
          // angle 0 = left→right, 90 = top→bottom. Convert to start/end points.
          const rad = ((gf.angle ?? 0) * Math.PI) / 180
          const hw = sw / 2
          const hh = sh / 2
          // Project the diagonal of the bounding box along the gradient angle.
          const cos = Math.cos(rad)
          const sin = Math.sin(rad)
          gradient = ctx.createLinearGradient(
            -hw * cos - hh * sin,
            -hw * sin + hh * cos,
            hw * cos + hh * sin,
            hw * sin - hh * cos,
          )
        } else {
          // Radial: centre → corner distance determines outer radius.
          const hw = sw / 2
          const hh = sh / 2
          const outerR = Math.sqrt(hw * hw + hh * hh)
          gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, outerR)
        }
        for (const stop of gf.stops) {
          gradient.addColorStop(stop.position, stop.color)
        }
        ctx.fillStyle = gradient
      } else {
        ctx.fillStyle = layer.fillColor
      }

      ctx.fill(path)
      ctx.shadowColor = 'transparent'
      if (layer.stroke && layer.stroke.width > 0) {
        ctx.strokeStyle = layer.stroke.color
        ctx.lineWidth = layer.stroke.width
        ctx.stroke(path)
      }
      // Defensive composite reset before restore.
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
      // ShapeLayer mask + clipping deferred to Wave 3 (TODO).
      prevLayerCanvas = null
      continue
    }

    // Group layer — children are already in the flat layers array; the group
    // itself carries no visual content (it is purely an organisational node).
    // Compositing children under a group opacity would require a separate
    // offscreen canvas per group — deferred to v1.1. For now we skip the
    // group node itself; children render via the normal loop.
    if (layer.kind === 'group') continue

    // Image layer
    const el = byId.get(layer.imageId)
    if (!el) continue

    // v6: clipping mask — clip this image layer to the alpha of the previous
    // visible layer. Only supported on ImageLayer in Wave 1.
    const w = el.naturalWidth * layer.scale
    const h = el.naturalHeight * (layer.scaleY ?? layer.scale)

    if (layer.clippedToLayerBelow && prevLayerCanvas) {
      // Render the image into an offscreen canvas, then clip to prev layer.
      const offClip = document.createElement('canvas')
      offClip.width = FACEPLATE_BANNER_W
      offClip.height = FACEPLATE_BANNER_H
      const offClipCtx = offClip.getContext('2d')
      if (offClipCtx) {
        offClipCtx.save()
        offClipCtx.globalAlpha = layer.opacity
        offClipCtx.globalCompositeOperation = (layer.blendMode ??
          'normal') as GlobalCompositeOperation
        offClipCtx.filter = imageFilterCss(layer.filters)
        offClipCtx.translate(layer.x, layer.y)
        offClipCtx.rotate((layer.rotation * Math.PI) / 180)
        const csx = layer.flipH ? -1 : 1
        const csy = layer.flipV ? -1 : 1
        offClipCtx.scale(csx, csy)
        offClipCtx.drawImage(el, -w / 2, -h / 2, w, h)
        offClipCtx.filter = 'none'
        offClipCtx.restore()
        offClipCtx.globalCompositeOperation = 'destination-in'
        offClipCtx.drawImage(prevLayerCanvas, 0, 0)
        ctx.drawImage(offClip, 0, 0)
      }
      prevLayerCanvas = offClip
      continue
    }

    ctx.save()
    ctx.globalAlpha = layer.opacity
    // v6: blend mode.
    ctx.globalCompositeOperation = (layer.blendMode ?? 'normal') as GlobalCompositeOperation
    // Apply shadow before drawing image
    if (
      layer.shadow &&
      (layer.shadow.blur > 0 || layer.shadow.offsetX !== 0 || layer.shadow.offsetY !== 0)
    ) {
      ctx.shadowOffsetX = layer.shadow.offsetX
      ctx.shadowOffsetY = layer.shadow.offsetY
      ctx.shadowBlur = layer.shadow.blur
      ctx.shadowColor = layer.shadow.color
    }
    // Photoshop-style adjustment filters. Canvas2D `filter` accepts the
    // same string we feed CSS — see imageFilterCss() — so the exported
    // PNG matches the live <img> render pixel-for-pixel. 'none' is the
    // identity, and we set it explicitly (not just on save/restore) so
    // stale filter state from a previous draw call never leaks across
    // layers in Firefox where ctx.save()/restore() doesn't reliably
    // reset the filter on all engine versions.
    ctx.filter = imageFilterCss(layer.filters)
    ctx.translate(layer.x, layer.y)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    const sx = layer.flipH ? -1 : 1
    const sy = layer.flipV ? -1 : 1
    ctx.scale(sx, sy)
    // Independent X/Y scale — `scaleY ?? scale` falls back to uniform for
    // layers created before the scaleY field landed.
    ctx.drawImage(el, -w / 2, -h / 2, w, h)
    ctx.shadowColor = 'transparent'
    if (layer.stroke && layer.stroke.width > 0) {
      ctx.strokeStyle = layer.stroke.color
      ctx.lineWidth = layer.stroke.width
      ctx.strokeRect(-w / 2, -h / 2, w, h)
    }
    // Defensive composite reset before restore (mirrors Firefox filter leak).
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
    // Defensive reset in case restore() didn't roll filter back (see
    // above note re: Firefox behaviour).
    ctx.filter = 'none'

    // v6: noise filter — per-pixel ImageData grain pass applied AFTER drawImage.
    // Uses a seeded RNG so output is deterministic across saves (same grain
    // pattern every time for the same project state).
    // NOTE: noise is NOT a CSS filter operator — imageFilterCss() omits it.
    if (layer.filters?.noise && layer.filters.noise > 0) {
      const noise = layer.filters.noise
      const rng = mulberry32(hashLayerId(layer.id))
      // Sample the destination rect in canvas-space (after the transform).
      // For simplicity, we noise the full canvas and rely on the alpha channel
      // to clip invisible pixels. Noising only the tight bounding box would
      // require inverse-transforming the box corners — deferred to Wave 2 (TODO).
      const imageData = ctx.getImageData(0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
      const data = imageData.data
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
          const delta = (rng() - 0.5) * 255 * noise
          data[i] = Math.max(0, Math.min(255, data[i] + delta))
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + delta))
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + delta))
          // alpha (data[i + 3]) intentionally left untouched
        }
      }
      ctx.putImageData(imageData, 0, 0)
    }

    // v6: layer mask on ImageLayer — applied after drawImage + noise.
    if (layer.mask?.dataUrl && layer.mask.enabled !== false) {
      const maskEl = await new Promise<HTMLImageElement | null>(res => {
        const img = new Image()
        img.onload = () => res(img)
        img.onerror = () => res(null)
        img.src = layer.mask!.dataUrl
      })
      if (maskEl) {
        // Read back what we just painted into an offscreen canvas, apply the
        // mask via destination-in/out, then redraw the masked result.
        const offMask = document.createElement('canvas')
        offMask.width = FACEPLATE_BANNER_W
        offMask.height = FACEPLATE_BANNER_H
        const offMCtx = offMask.getContext('2d')
        if (offMCtx) {
          // Blit the layer content into the offscreen canvas via the same
          // transform so the mask aligns with the rendered image footprint.
          offMCtx.save()
          offMCtx.globalAlpha = layer.opacity
          offMCtx.filter = imageFilterCss(layer.filters)
          offMCtx.translate(layer.x, layer.y)
          offMCtx.rotate((layer.rotation * Math.PI) / 180)
          offMCtx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1)
          offMCtx.drawImage(el, -w / 2, -h / 2, w, h)
          offMCtx.filter = 'none'
          offMCtx.restore()
          // Apply the mask.
          offMCtx.globalCompositeOperation = layer.mask.invert
            ? 'destination-out'
            : 'destination-in'
          offMCtx.drawImage(maskEl, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
          // Erase the un-masked layer render from the main canvas and
          // composite the masked result back in.
          ctx.save()
          ctx.globalCompositeOperation = 'destination-out'
          offMCtx.globalCompositeOperation = 'source-over' // reset for the erase blit
          const tmpErase = document.createElement('canvas')
          tmpErase.width = FACEPLATE_BANNER_W
          tmpErase.height = FACEPLATE_BANNER_H
          const tmpCtx = tmpErase.getContext('2d')
          if (tmpCtx) {
            tmpCtx.globalAlpha = layer.opacity
            tmpCtx.translate(layer.x, layer.y)
            tmpCtx.rotate((layer.rotation * Math.PI) / 180)
            tmpCtx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1)
            tmpCtx.drawImage(el, -w / 2, -h / 2, w, h)
            ctx.drawImage(tmpErase, 0, 0)
          }
          ctx.restore()
          ctx.drawImage(offMask, 0, 0)
        }
      }
    }

    // Record this layer's render for potential clipping of the next layer.
    const snap = document.createElement('canvas')
    snap.width = FACEPLATE_BANNER_W
    snap.height = FACEPLATE_BANNER_H
    const snapCtx = snap.getContext('2d')
    if (snapCtx) {
      snapCtx.globalAlpha = layer.opacity
      snapCtx.filter = imageFilterCss(layer.filters)
      snapCtx.translate(layer.x, layer.y)
      snapCtx.rotate((layer.rotation * Math.PI) / 180)
      snapCtx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1)
      snapCtx.drawImage(el, -w / 2, -h / 2, w, h)
      snapCtx.filter = 'none'
    }
    prevLayerCanvas = snap
  }

  return c
}

async function composeFaceplatePng(p: Coh2FaceplateProject): Promise<string> {
  const c = await composeFaceplateCanvas(p)
  return c.toDataURL('image/png')
}

// ─────────────────────────────────────────────────────────────────────────
// Shape helpers
// ─────────────────────────────────────────────────────────────────────────

/** 5-point star path string in a 100×100 viewBox, centred at 50,50.
 *  outer r=50, inner r=20. */
function starPathD(): string {
  const cx = 50
  const cy = 50
  const outerR = 50
  const innerR = 20
  const points = 5
  let d = ''
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI / points) * i - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    d += (i === 0 ? 'M' : 'L') + `${x},${y} `
  }
  return d + 'Z'
}

/** Render the correct SVG child element for the given shapeType. Used in
 *  the live React canvas (viewBox 0 0 100 100). */
function shapeToSvgElement(
  shapeType: ShapeLayer['shapeType'],
  fill: string,
  stroke: string,
  strokeWidth: number,
): React.ReactElement {
  const sharedProps = {
    fill,
    stroke: strokeWidth > 0 ? stroke : 'none',
    strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
  }
  switch (shapeType) {
    case 'rectangle':
      return <rect x="0" y="0" width="100" height="100" {...sharedProps} />
    case 'circle':
      return <ellipse cx="50" cy="50" rx="50" ry="50" {...sharedProps} />
    case 'chevron':
      return <polygon points="0,0 60,0 100,50 60,100 0,100 40,50" {...sharedProps} />
    case 'star':
      return <path d={starPathD()} {...sharedProps} />
    case 'shield':
      return <path d="M 0 0 L 100 0 L 100 60 Q 100 100 50 100 Q 0 100 0 60 Z" {...sharedProps} />
  }
}

/** Build a Canvas2D Path2D for the given shape type. The path is centred
 *  at the origin (0,0) so translate + rotate + scale can be applied via
 *  ctx transforms before drawing. w/h are the box dimensions in canvas px. */
function shapeToPath2D(shapeType: ShapeLayer['shapeType'], w: number, h: number): Path2D {
  const path = new Path2D()
  switch (shapeType) {
    case 'rectangle':
      path.rect(-w / 2, -h / 2, w, h)
      break
    case 'circle':
      path.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case 'chevron': {
      // Points from viewBox 0 0 100 100 scaled to w×h, centred at origin.
      const pts: [number, number][] = [
        [0, 0],
        [60, 0],
        [100, 50],
        [60, 100],
        [0, 100],
        [40, 50],
      ]
      pts.forEach(([px, py], i) => {
        const x = (px / 100) * w - w / 2
        const y = (py / 100) * h - h / 2
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
      })
      path.closePath()
      break
    }
    case 'star': {
      const cx = 0
      const cy = 0
      const outerR5 = Math.min(w, h) / 2
      const innerR5 = outerR5 * (20 / 50)
      const points5 = 5
      for (let i = 0; i < points5 * 2; i++) {
        const angle = (Math.PI / points5) * i - Math.PI / 2
        const r = i % 2 === 0 ? outerR5 : innerR5
        const x = cx + r * Math.cos(angle)
        const y = cy + r * Math.sin(angle)
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
      }
      path.closePath()
      break
    }
    case 'shield': {
      // M 0 0 L 100 0 L 100 60 Q 100 100 50 100 Q 0 100 0 60 Z
      // scaled to w×h, centred at origin
      const scaleX = w / 100
      const scaleY = h / 100
      const ox = -w / 2
      const oy = -h / 2
      path.moveTo(ox + 0 * scaleX, oy + 0 * scaleY)
      path.lineTo(ox + 100 * scaleX, oy + 0 * scaleY)
      path.lineTo(ox + 100 * scaleX, oy + 60 * scaleY)
      path.quadraticCurveTo(
        ox + 100 * scaleX,
        oy + 100 * scaleY,
        ox + 50 * scaleX,
        oy + 100 * scaleY,
      )
      path.quadraticCurveTo(ox + 0 * scaleX, oy + 100 * scaleY, ox + 0 * scaleX, oy + 60 * scaleY)
      path.closePath()
      break
    }
  }
  return path
}

function checkerBackground(): string {
  // Two-stop conic gradient produces a tight 4-square checker pattern when
  // tiled at a fixed background-size. Matches Photoshop's "transparent"
  // backdrop, which the user expects when working with PNG-style assets.
  return `repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, rgba(0,0,0,0) 0% 50%) 50% / 24px 24px`
}

/** Classic light-grey/white Photoshop transparency checker — used by the
 *  "Preview as exported" toggle so users see exactly what alpha=0 looks like
 *  in-game (no editor scaffolding, no dark background colour overlay). */
function lightCheckerBackground(): string {
  return `repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 16px 16px`
}
