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
  type ReactNode,
} from 'react'
import { Stage, Layer, Image as KonvaImage, Text as KonvaText, Rect, Ellipse, Transformer, Shape as KonvaShape } from 'react-konva'
import Konva from 'konva'
import type { Filter as KonvaFilter } from 'konva/lib/Node'
import { useHistoryEngine } from '@/lib/editor-history'
import { scheduleLiveSync, useLiveSync } from '@/lib/live-sync'
import {
  type Coh2FaceplateProject,
  type FaceplateLayer,
  type ImageLayer,
  type ImageLayerFilters,
  type ShapeLayer,
  type PaintLayer,
  type TextLayer,
  type ShapeKind,
  type GradientFill,
  FACEPLATE_BANNER_W,
  FACEPLATE_BANNER_H,
  addFaceplateImageFromBlob,
  imageFilterCss,
  makeDefaultLayer,
  newShapeLayer,
  newTextLayer,
  newPaintLayer,
  newGroupLayer,
  persistFaceplate,
  updateRecentFaceplateThumbnail,
} from '@/lib/faceplate-project'
import { writeClipboard, readClipboard, type ClipboardEntry } from '@/lib/editor-clipboard'
import { isElectron, detectModsPath, writeFile } from '@/lib/native-fs'
import { INSIGNIA_LIBRARY, type InsigniaEntry } from '@/lib/insignia-library'
import HexColorInput from '@/components/editor-primitives/HexColorInput'
import EditorTitlePill from '@/components/editor-primitives/EditorTitlePill'
import CurvesEditor from '@/components/editor-primitives/CurvesEditor'
import {
  AlignCenter,
  AlignEndVertical,
  AlignStartVertical,
  Bold,
  Brush,
  CaseSensitive,
  Circle,
  CornerDownLeft,
  Download,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Grid,
  Italic,
  Library,
  Lock,
  LockOpen,
  MoveHorizontal,
  MoveVertical,
  MousePointer2,
  Pencil,
  Pipette,
  Shapes,
  Slash,
  SquareDashedMousePointer,
  Sliders,
  Star,
  TextCursorInput,
  HelpCircle,
  Trash2,
  Type,
} from 'lucide-react'
import { applySnap, type SnapTarget } from '@/lib/snap-guides'
import { samplePixel } from '@/lib/brush'
// StateIcon is now used by EditorTitlePill — no direct import needed here
import AtlasViewPanel from '@/components/AtlasViewPanel'
import {
  type AtlasViewMode,
  loadFaceplateViewMode,
  persistFaceplateViewMode,
} from '@/lib/atlas-view-settings'
import ImageDropZone from './editor-shared/ImageDropZone'
// TransformInputsRow removed from FaceplateEditor — now used only in PropertiesPanel.
import LayersPanel from './editor-shared/LayersPanel'
import PropertiesPanel, { FaceplatePropertiesExtension } from './editor-shared/PropertiesPanel'
import { composeLayers } from '@/lib/layer-compositor'
import KeyboardShortcutsOverlay from './editor-primitives/KeyboardShortcutsOverlay'
import { usePanZoom, ZOOM_MIN, ZOOM_MAX } from '@/lib/use-pan-zoom'
import { PackIdentityPopover } from './PackIdentityPopover'
// BorderBeam is now used by EditorTitlePill — no direct import needed here
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
  UndoRedoBar,
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

/** No debounce on the live in-game preview — the user explicitly asked
 *  for instantaneous updates so they see exactly what their composition
 *  will look like in-game on every keystroke and drag tick. The compose
 *  cost is bounded (624×204 PNG, ~5ms on a modern CPU) and we run an
 *  in-flight guard via `cancelled` so a fast drag never queues a backlog
 *  of stale promises — only the newest compose result lands on screen. */

/** Stable identifiers for the bottom-pill tools. The union type keeps
 *  the activeTool state and BottomToolPill type-tight.
 *
 *  IA change (Photoshop convention): Shadow / Background / Align are no longer
 *  tool-row items. They are now panels / sections inside the Properties panel.
 *  Eraser is promoted from a sub-mode of Draw to its own dedicated tool. */
type FaceplateToolId =
  | 'select'
  | 'text'
  | 'shapes'
  | 'draw'
  | 'eraser'
  | 'mask'

// ── Gap 2: Image filter mapping (module-level) ───────────────────────────────
/** Build the Konva filters array and attr object for a KonvaImage node.
 *  Maps CSS filter values (used by composeFaceplateCanvas) to Konva filter
 *  parameters. Only includes filters that deviate from their identity value
 *  so we avoid paying the cache cost when no filters are active.
 *
 *  Parameter mapping notes:
 *  - brightness: CSS brightness(b) multiplies by b. Konva Filters.Brightness
 *    also multiplies by node.brightness(). Direct mapping — exact match.
 *  - contrast: CSS contrast(c) and Konva Contrast use different formulas.
 *    Konva: adjust=(x+100)/100)^2; we solve x=100*(sqrt(c)-1). Close approx.
 *  - saturate + hueRotate: Both map through Konva HSL filter.
 *    Konva HSL saturation: 2^sat = cssVal → sat = log2(cssVal).
 *    Konva hue maps directly to CSS hue-rotate degrees.
 *  - grayscale / sepia / invert: Konva versions are all-or-nothing.
 *    Applied only when value ≥ 0.99 (full intensity). Partial values skipped.
 *  - blur: Direct pixel-radius mapping.
 */
function buildKonvaImageFilters(f: ImageLayerFilters | undefined): {
  filterFns: KonvaFilter[]
  attrs: Record<string, number>
  hasFilters: boolean
} {
  if (!f) return { filterFns: [], attrs: {}, hasFilters: false }
  const filterFns: KonvaFilter[] = []
  const attrs: Record<string, number> = {}

  const b = f.brightness ?? 1
  if (b !== 1) {
    filterFns.push(Konva.Filters.Brightness)
    attrs['brightness'] = b
  }

  const c = f.contrast ?? 1
  if (c !== 1) {
    filterFns.push(Konva.Filters.Contrast)
    // Konva Contrast adjust: pow((x+100)/100, 2) = c → x = 100*(sqrt(c)-1)
    attrs['contrast'] = 100 * (Math.sqrt(Math.max(0, c)) - 1)
  }

  const s = f.saturate ?? 1
  const hRot = f.hueRotate ?? 0
  if (s !== 1 || hRot !== 0) {
    filterFns.push(Konva.Filters.HSL)
    // Konva HSL internally computes: saturation factor = 2^sat
    // CSS saturate(s): s=1 identity, s=0 greyscale, s=2 double.
    // Mapping: sat = log2(s); identity when s=1 → log2(1)=0 ✓
    attrs['saturation'] = s > 0 ? Math.log2(s) : -10 // -10 ≈ fully desaturated
    attrs['hue'] = hRot
    attrs['luminance'] = 0
  }

  const bl = f.blur ?? 0
  if (bl > 0) {
    filterFns.push(Konva.Filters.Blur)
    attrs['blurRadius'] = bl
  }

  // All-or-nothing filters: only apply at full intensity (≥ 0.99)
  if ((f.grayscale ?? 0) >= 0.99) filterFns.push(Konva.Filters.Grayscale)
  if ((f.sepia ?? 0) >= 0.99) filterFns.push(Konva.Filters.Sepia)
  if ((f.invert ?? 0) >= 0.99) filterFns.push(Konva.Filters.Invert)

  return { filterFns, attrs, hasFilters: filterFns.length > 0 }
}

export default function FaceplateEditor({ project: initialProject, onBack }: Props) {
  const [project, setProject] = useState<Coh2FaceplateProject>(initialProject)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Additional selected layer ids for multi-select (Cmd/Ctrl-click). */
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())
  /** Anchor layer id for shift-click range-select in the Layers panel. Updated
   *  on every plain click; used to compute the range on shift-click. */
  const lastAnchorIdRef = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** Currently-active editor tool. Drives both the bottom pill's selected
   *  segment and the contents of the floating options peel above it. */
  const [activeTool, setActiveTool] = useState<FaceplateToolId>('select')
  /** Bottom-right status toast for the manual "Export .sga" action.
   *  `intent` drives the GlassToast border colour (green success / red error). */
  const [exportToast, setExportToast] = useState<
    { intent: 'success' | 'error'; body: string } | null
  >(null)
  /** True while a manual Export .sga build is in flight (disables the button
   *  and shows a "Exporting…" affordance so the user gets immediate feedback). */
  const [isExporting, setIsExporting] = useState(false)
  /** Whether the keyboard-shortcuts overlay is open (F1 or ? button). */
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Stable getter ref so useHistoryEngine captures remain current.
  const projectRef = useRef<Coh2FaceplateProject>(initialProject)
  // eslint-disable-next-line react-hooks/refs -- intentional ref-as-latest-value
  projectRef.current = project
  const history = useHistoryEngine<Coh2FaceplateProject>(
    useCallback(() => projectRef.current, []),
    setProject,
    {
      limit: 50,
      onPersist: useCallback((next: Coh2FaceplateProject) => {
        persistFaceplate(next)
        scheduleLiveSync('faceplate', next)
      }, []),
    },
  )
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
  const [publishError, setPublishError] = useState<string | null>(null)
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

  // ── Layer rename state (G6-style, mirrors DPE) ───────────────────────────
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null)

  // ── Layer drag-to-reorder state (mirrors DPE G3) ─────────────────────────
  const [dragLayerId, setDragLayerId] = useState<string | null>(null)
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null)

  // ── Live-composed banner PNG ──────────────────────────────────────────
  // The thumbnail compose effect already builds a 624×204 PNG on every
  // project mutation; we stash the data URL here for the thumbnail updater.
  const [_bannerPngUrl, setBannerPngUrl] = useState<string | null>(null)
  /** Active faction filter in the insignia picker (null = All). */
  const [insigniaFilter, setInsigniaFilter] = useState<InsigniaEntry['faction'] | null>(null)

  // ── Draw tool state ────────────────────────────────────────────────────
  const [brushSize, setBrushSize] = useState(12)
  const [brushColor, setBrushColor] = useState('#ffffff')
  const [brushOpacity, setBrushOpacity] = useState(1)
  /** Brush hardness 0–100. 100 = solid disc (original behaviour); lower values
   *  produce a radial-gradient alpha falloff (soft edge). */
  const [brushHardness, setBrushHardness] = useState(100)
  /** Mirror paint across the X axis (left/right). Component-local, not persisted. */
  const [mirrorX, setMirrorX] = useState(false)
  /** Mirror paint across the Y axis (top/bottom). Component-local, not persisted. */
  const [mirrorY, setMirrorY] = useState(false)
  /** Erase mode: when true the paint stroke uses destination-out compositing
   *  to erase pixels rather than paint them. Component-local, not persisted. */
  const [brushErase, setBrushErase] = useState(false)
  /** Eyedropper mode: one-shot — next click samples the pixel under the cursor
   *  and sets it as the brush colour, then snaps back to paint mode. */
  const [eyedropperActive, setEyedropperActive] = useState(false)
  /** The offscreen canvas used for live stroke rendering (in-progress). */
  const liveStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Whether a stroke is currently in progress. */
  const isDrawingRef = useRef(false)
  /** Accumulated paint dataUrl before the stroke started (for undo). */
  const preStrokeDataUrlRef = useRef<string | null>(null)

  // ── Grid snap state ────────────────────────────────────────────────────
  /** Whether grid snap is enabled during layer drag/resize. */
  const [snapGrid, setSnapGrid] = useState(false)
  /** Grid step (pixels) when snap is active. */
  const [snapGridStep, setSnapGridStep] = useState<4 | 8 | 16 | 32>(8)

  // ── Shift-key held state ───────────────────────────────────────────────
  /** True while the Shift key is physically held down. Used by the Konva
   *  Transformer to enable 15° rotation snaps (and Konva's built-in
   *  aspect-ratio lock during corner-handle scaling). */
  const [isShiftHeld, setIsShiftHeld] = useState(false)

  // ── Mask tool state ────────────────────────────────────────────────────
  /** Brush size shared by the Draw tool and the Mask tool. */
  const [maskBrushSize, setMaskBrushSize] = useState(32)
  /** Brush opacity for mask painting (0..1). */
  const [maskBrushOpacity, setMaskBrushOpacity] = useState(1)
  /** 'hide' paints black (alpha=0) onto the mask; 'reveal' paints white. */
  const [maskPaintMode, setMaskPaintMode] = useState<'hide' | 'reveal'>('hide')
  /** Align target: 'canvas' aligns to the full banner area (default);
   *  'selection' aligns to the bounding box of all selected layers. */
  const [alignToSelection, setAlignToSelection] = useState<'canvas' | 'selection'>('canvas')
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

  /** Mutate the project through a pure updater. Thin wrapper over the shared
   *  history engine — all call sites are unchanged. The engine handles
   *  undo-stack pushes, persist (via onPersist), and gesture-granular
   *  suppression. */
  const mutate = useCallback(
    (
      fn: (p: Coh2FaceplateProject) => Coh2FaceplateProject,
      { undoable = true }: { undoable?: boolean } = {},
    ) => {
      history.mutate(fn, { undoable })
    },
    [history],
  )

  /** Pop the most recent snapshot and restore it. Bound to Cmd/Ctrl-Z. */
  const undo = useCallback(() => { history.undo() }, [history])

  /** Re-apply the most recently undone action. Bound to Cmd/Ctrl-Shift-Z and Ctrl+Y. */
  const redo = useCallback(() => { history.redo() }, [history])

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

  // ── Layer drag-to-reorder handlers (mirrors DPE G3) ───────────────────────
  const onLayerDragStart = useCallback((id: string) => setDragLayerId(id), [])
  const onLayerDragOver = useCallback((id: string) => setDragOverLayerId(id), [])
  const onLayerDrop = useCallback(
    (targetId: string) => {
      if (!dragLayerId || dragLayerId === targetId) {
        setDragLayerId(null)
        setDragOverLayerId(null)
        return
      }
      mutate(p => {
        const from = p.layers.findIndex(l => l.id === dragLayerId)
        const to = p.layers.findIndex(l => l.id === targetId)
        if (from < 0 || to < 0) return p
        const next = p.layers.slice()
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        return { ...p, layers: next }
      })
      setDragLayerId(null)
      setDragOverLayerId(null)
    },
    [dragLayerId, mutate],
  )
  const onLayerDragEnd = useCallback(() => {
    setDragLayerId(null)
    setDragOverLayerId(null)
  }, [])

  // ── Zoom/pan state — backed by usePanZoom ───────────────────────────────
  // Must be declared BEFORE the keyboard effect that references pz.
  // pzContainerRef points to the OUTER full-area container (ImageDropZone
  // wrapper) so fitToWindow() and wheel events use the full viewport size.
  // canvasRef is the inner 624×204 canvas div; its transform carries the
  // pan offset + scale so coordinate math (getBoundingClientRect / viewScale)
  // is correct.
  const pzContainerRef = useRef<HTMLDivElement>(null)
  // Inset rect for fitToWindow(): the banner must fit the VISIBLE gap between
  // the floating Layers panel (left) and Properties panel (right), and clear
  // the title pill (top) and tool pill (bottom).
  //   Left zone:  12px edge inset + 196px panel + 16px gap = 224px
  //   Right zone: 12px edge inset + 210px panel + 16px gap = 238px
  //   Top:  title pill ~64px
  //   Bottom: tool pill ~108px
  const FIT_INSET = { left: 224, right: 238, top: 64, bottom: 108 } as const
  const pz = usePanZoom({
    containerRef: pzContainerRef,
    contentSize: { w: FACEPLATE_BANNER_W, h: FACEPLATE_BANNER_H },
    initialScale: initialProject.editorZoom ?? 1.75,
    fitInset: FIT_INSET,
  })
  const zoom = pz.scale
  const viewScale = zoom

  // On mount, fit the banner to the inset area so it starts fully visible
  // between the floating panels at the correct scale (offset stays 0 so the
  // flexbox padding handles centering).
  useEffect(() => {
    requestAnimationFrame(() => { pz.fitToWindow() })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      // V → Select tool
      if (ev.key === 'v' || ev.key === 'V') {
        ev.preventDefault()
        setActiveTool('select')
        return
      }
      // B → Draw (Brush) tool
      if (ev.key === 'b' || ev.key === 'B') {
        ev.preventDefault()
        setActiveTool('draw')
        return
      }
      // E → Eraser tool (dedicated tool, no longer a sub-mode of Draw)
      if (ev.key === 'e' || ev.key === 'E') {
        ev.preventDefault()
        setActiveTool('eraser')
        setEyedropperActive(false)
        return
      }
      // I → Eyedropper (switch to draw + activate eyedropper)
      if (ev.key === 'i' || ev.key === 'I') {
        ev.preventDefault()
        setActiveTool('draw')
        setEyedropperActive(true)
        setBrushErase(false)
        return
      }
      // S → Shapes tool
      if (ev.key === 's' || ev.key === 'S') {
        ev.preventDefault()
        setActiveTool('shapes')
        return
      }
      // Ctrl+G → Group selected layers; Ctrl+Shift+G → Ungroup
      if (meta && ev.key.toLowerCase() === 'g') {
        ev.preventDefault()
        if (ev.shiftKey) {
          // Ungroup: find a selected group layer and hoist its children
          if (selectedId) {
            mutate(p => {
              const groupLayer = p.layers.find(l => l.id === selectedId && l.kind === 'group')
              if (!groupLayer || groupLayer.kind !== 'group') return p
              const groupIdx = p.layers.findIndex(l => l.id === selectedId)
              const childIds = groupLayer.childIds
              // Collect child layers in order (they may be stored elsewhere; fall back to no-op)
              const childLayers = childIds.map(cid => p.layers.find(l => l.id === cid)).filter(Boolean) as FaceplateLayer[]
              // Remove group and any children that were inline in the array; reinsert children at group position
              const withoutGroup = p.layers.filter(l => l.id !== selectedId && !childIds.includes(l.id))
              const newLayers = [
                ...withoutGroup.slice(0, groupIdx),
                ...childLayers,
                ...withoutGroup.slice(groupIdx),
              ]
              return { ...p, layers: newLayers }
            })
            setSelectedId(null)
            setMultiSelectedIds(new Set())
          }
        } else {
          // Group: wrap selected layers in a GroupLayer.
          // Architecture: child layers REMAIN in the flat project.layers array
          // (the renderer looks them up by id). The GroupLayer is inserted just
          // above the topmost selected layer in the stack. childIds lists the
          // member ids so the Layers panel can show the group header.
          const selectedIds = new Set([
            ...(selectedId ? [selectedId] : []),
            ...Array.from(multiSelectedIds),
          ])
          if (selectedIds.size === 0) return
          const copyRef = { id: '' }
          mutate(p => {
            const group = newGroupLayer('Group')
            copyRef.id = group.id
            // Preserve render order: keep layers in their current order
            const toGroup = p.layers.filter(l => selectedIds.has(l.id))
            group.childIds = toGroup.map(l => l.id)
            // Insert group just before the topmost selected layer; children stay in place
            const topIdx = p.layers.findIndex(l => selectedIds.has(l.id))
            const newLayers = [
              ...p.layers.slice(0, topIdx),
              group,
              ...p.layers.slice(topIdx),
            ]
            return { ...p, layers: newLayers }
          })
          if (copyRef.id) setSelectedId(copyRef.id)
          setMultiSelectedIds(new Set())
        }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, multiSelectedIds, mutate, undo, redo, duplicateLayer, setShortcutsOpen, setBrushErase, setEyedropperActive, pz.scale, pz.setScale, pz.fitToWindow, pz.resetTo100])

  // ── Shift-key tracker for Transformer (rotation snaps + aspect-ratio lock) ──
  useEffect(() => {
    const onShiftDown = (ev: KeyboardEvent) => { if (ev.key === 'Shift') setIsShiftHeld(true) }
    const onShiftUp = (ev: KeyboardEvent) => { if (ev.key === 'Shift') setIsShiftHeld(false) }
    // Also clear on window blur so state doesn't get stuck when focus moves elsewhere.
    const onBlur = () => setIsShiftHeld(false)
    window.addEventListener('keydown', onShiftDown)
    window.addEventListener('keyup', onShiftUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onShiftDown)
      window.removeEventListener('keyup', onShiftUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ── Alt-key tracker for alt-drag duplicate ───────────────────────────────
  const isAltHeldRef = useRef(false)
  useEffect(() => {
    const onDown = (ev: KeyboardEvent) => { if (ev.key === 'Alt') isAltHeldRef.current = true }
    const onUp = (ev: KeyboardEvent) => { if (ev.key === 'Alt') isAltHeldRef.current = false }
    const onBlur = () => { isAltHeldRef.current = false }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

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
  // canvasRef is the inner 624×204 canvas div (coordinate math / layer layout).
  const canvasRef = useRef<HTMLDivElement>(null)

  // ── Konva stage, node refs, and image cache ────────────────────────────
  const konvaStageRef = useRef<Konva.Stage>(null)
  const konvaNodeRefs = useRef<Record<string, Konva.Node | null>>({})
  const transformerRef = useRef<Konva.Transformer>(null)
  /** Drag-start positions for multi-select drag (same pattern as DecalPackEditor). */
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  /** When an alt-drag duplicate is in flight, holds the original layer id that
   *  was cloned so we can keep the original node stationary. */
  const altDragOriginalIdRef = useRef<string | null>(null)
  /** Resolved HTMLImageElement objects keyed by imageId — loaded once per dataUrl change. */
  const [konvaImages, setKonvaImages] = useState<Record<string, HTMLImageElement>>({})

  // Load/reload images into konvaImages whenever project.images changes.
  useEffect(() => {
    const ids = Object.keys(project.images)
    if (ids.length === 0) return
    let cancelled = false
    Promise.all(
      ids.map(
        id =>
          new Promise<[string, HTMLImageElement]>(resolve => {
            const img = project.images[id]
            const el = new window.Image()
            el.onload = () => resolve([id, el])
            el.onerror = () => resolve([id, el]) // still resolve so map is complete
            el.src = img.dataUrl
          }),
      ),
    ).then(pairs => {
      if (cancelled) return
      const next: Record<string, HTMLImageElement> = {}
      for (const [id, el] of pairs) next[id] = el
      setKonvaImages(next)
    })
    return () => { cancelled = true }
  }, [project.images])

  /** Attach Konva Transformer to the active layer node(s). */
  const attachTransformerToIds = useCallback((ids: string[]) => {
    const tr = transformerRef.current
    if (!tr) return
    if (activeTool === 'draw' || activeTool === 'eraser' || activeTool === 'mask') {
      tr.nodes([])
      tr.getLayer()?.batchDraw()
      return
    }
    const nodes = ids
      .map(id => konvaNodeRefs.current[id])
      .filter((n): n is Konva.Node => n != null)
    tr.nodes(nodes)
    tr.getLayer()?.batchDraw()
  }, [activeTool])

  useEffect(() => {
    const allIds = [selectedId, ...Array.from(multiSelectedIds)].filter(Boolean) as string[]
    attachTransformerToIds(allIds)
  }, [selectedId, multiSelectedIds, activeTool, attachTransformerToIds])

  /** Write back transform from Konva node to project state (gesture-granular). */
  const handleKonvaTransformEnd = useCallback(
    (layerId: string) => {
      const node = konvaNodeRefs.current[layerId]
      if (!node) return
      const rawScaleX = node.scaleX()
      const rawScaleY = node.scaleY()
      const absScaleX = Math.abs(rawScaleX)
      const absScaleY = Math.abs(rawScaleY)
      const flipH = rawScaleX < 0
      const flipV = rawScaleY < 0
      // Restore to positive scale after reading sign for flipH/V
      node.scaleX(flipH ? -absScaleX : absScaleX)
      node.scaleY(flipV ? -absScaleY : absScaleY)
      const newX = node.x()
      const newY = node.y()
      const newRot = node.rotation()
      mutate(p =>
        mapLayer(p, layerId, l => {
          if (l.kind === 'group' || l.kind === 'paint') return l
          if (l.kind === 'image') {
            return {
              ...l,
              x: newX,
              y: newY,
              rotation: newRot,
              scale: absScaleX,
              scaleY: absScaleY,
              flipH,
              flipV,
            } as ImageLayer
          }
          return { ...l, x: newX, y: newY, rotation: newRot, scale: absScaleX } as typeof l
        }),
      )
      history.endGesture()
    },
    [mutate, history],
  )

  /** Write drag end back to state — multi-select aware (gesture-granular, one undo frame).
   *  When altDragOriginalIdRef is set this is an alt-drag duplicate: restore the
   *  original to its start position and insert a clone at the drop position. */
  const handleKonvaDragEnd = useCallback(
    (layerId: string, node: Konva.Node) => {
      setSnapGuides([])
      history.endGesture()

      const isAltDrag = altDragOriginalIdRef.current === layerId
      altDragOriginalIdRef.current = null

      if (isAltDrag) {
        // Alt-drag duplicate: keep the original in place, spawn a clone at the drop position.
        const dropX = node.x()
        const dropY = node.y()
        // Restore the Konva node to its start position visually.
        const startPos = dragStartPositionsRef.current.get(layerId)
        if (startPos) {
          node.x(startPos.x)
          node.y(startPos.y)
        }
        dragStartPositionsRef.current = new Map()
        const copyRef = { id: '' }
        mutate(p => {
          const idx = p.layers.findIndex(l => l.id === layerId)
          if (idx < 0) return p
          const source = p.layers[idx]
          const copy = duplicateLayerHelper(source)
          copyRef.id = copy.id
          // Place clone at drop position (not offset like normal duplicate)
          if (copy.kind !== 'group' && copy.kind !== 'paint') {
            ;(copy as { x: number }).x = dropX
            ;(copy as { y: number }).y = dropY
          }
          const layers = [...p.layers]
          layers.splice(idx + 1, 0, copy)
          return { ...p, layers }
        })
        if (copyRef.id) setSelectedId(copyRef.id)
        return
      }

      // Collect final positions for the dragged node + all companion nodes.
      const finalPositions = new Map<string, { x: number; y: number }>()
      finalPositions.set(layerId, { x: node.x(), y: node.y() })
      for (const id of dragStartPositionsRef.current.keys()) {
        if (id === layerId) continue
        const companionNode = konvaNodeRefs.current[id]
        if (companionNode) finalPositions.set(id, { x: companionNode.x(), y: companionNode.y() })
      }

      // One mutate → one undo frame for the whole group move.
      mutate(p => {
        let next = p
        for (const [id, pos] of finalPositions) {
          next = mapLayer(next, id, l => {
            if (l.kind === 'group' || l.kind === 'paint') return l
            return { ...l, x: pos.x, y: pos.y }
          })
        }
        return next
      })

      dragStartPositionsRef.current = new Map()
    },
    [mutate, history, setSnapGuides],
  )

  /** Build snap targets for Konva drag-move. */
  const snapTargetsMemo = useMemo((): SnapTarget[] => {
    const base: SnapTarget[] = [
      { kind: 'x', value: FACEPLATE_BANNER_W / 2, label: 'canvas center X' },
      { kind: 'y', value: FACEPLATE_BANNER_H / 2, label: 'canvas center Y' },
      { kind: 'x', value: 0, label: 'canvas left edge' },
      { kind: 'x', value: FACEPLATE_BANNER_W, label: 'canvas right edge' },
      { kind: 'y', value: 0, label: 'canvas top edge' },
      { kind: 'y', value: FACEPLATE_BANNER_H, label: 'canvas bottom edge' },
    ]
    if (snapGrid) {
      const step = snapGridStep
      for (let v = step; v < FACEPLATE_BANNER_W; v += step)
        base.push({ kind: 'x', value: v, label: `grid ${v}` })
      for (let v = step; v < FACEPLATE_BANNER_H; v += step)
        base.push({ kind: 'y', value: v, label: `grid ${v}` })
    }
    return base
  }, [snapGrid, snapGridStep])

  /** Apply snap during Konva drag-move, and move all companion nodes by the same delta. No undo frames per frame. */
  const handleKonvaDragMove = useCallback(
    (layerId: string, node: Konva.Node) => {
      const { snappedX, snappedY, firedTargets } = applySnap(node.x(), node.y(), snapTargetsMemo)
      node.x(snappedX)
      node.y(snappedY)
      setSnapGuides(firedTargets)

      // Move companion nodes (multi-select) by the same delta as the primary node.
      const startPos = dragStartPositionsRef.current.get(layerId)
      if (startPos && dragStartPositionsRef.current.size > 1) {
        const dx = snappedX - startPos.x
        const dy = snappedY - startPos.y
        for (const [id, sPos] of dragStartPositionsRef.current) {
          if (id === layerId) continue
          const companionNode = konvaNodeRefs.current[id]
          if (companionNode) {
            companionNode.x(sPos.x + dx)
            companionNode.y(sPos.y + dy)
          }
        }
        node.getLayer()?.batchDraw()
      }
    },
    [snapTargetsMemo, setSnapGuides],
  )

  /** Re-cache KonvaImage nodes whenever image-layer filter values change.
   *  cache() is required by Konva for pixel-level filter processing to work. */
  useEffect(() => {
    for (const layer of project.layers) {
      if (layer.kind !== 'image') continue
      const node = konvaNodeRefs.current[layer.id] as Konva.Image | null
      if (!node) continue
      const { filterFns, attrs, hasFilters } = buildKonvaImageFilters(layer.filters)
      if (hasFilters) {
        // Set filter attribute values on the node (react-konva also passes them
        // as props, but we set them here too so they're definitely present
        // before cache() is called).
        for (const [key, val] of Object.entries(attrs)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(node as any)[key]?.(val)
        }
        node.filters(filterFns)
        node.cache()
      } else {
        // Clear cache when all filters are identity — saves GPU memory.
        node.filters([])
        node.clearCache()
      }
    }
  // Re-run whenever any layer's filter values change. We stringify the
  // filter objects for a stable dependency key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(project.layers.filter(l => l.kind === 'image').map(l => (l as ImageLayer).filters))])

  const selectedLayer = useMemo(
    () => project.layers.find(l => l.id === selectedId) ?? null,
    [project.layers, selectedId],
  )

  // ── Layer display helpers (passed to LayersPanel) ─────────────────────────
  const getLayerLabel = useCallback(
    (layer: FaceplateLayer): string => {
      if (layer.kind === 'group') return layer.name
      const named = (layer as { name?: string }).name
      if (named) return named
      if (layer.kind === 'text') return layer.text.slice(0, 20) || 'Text layer'
      if (layer.kind === 'shape') return layer.shapeType
      if (layer.kind === 'paint') return 'Paint layer'
      return project.images[(layer as ImageLayer).imageId]?.name ?? 'Image layer'
    },
    [project.images],
  )

  const getLayerThumbnail = useCallback(
    (layer: FaceplateLayer): ReactNode => {
      if (layer.kind === 'text') {
        return (
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1 }}>T</span>
        )
      }
      if (layer.kind === 'shape') {
        return (
          <svg width={22} height={22} viewBox="0 0 100 100">
            {shapeToSvgElement(layer.shapeType, layer.fillColor, 'none', 0)}
          </svg>
        )
      }
      if (layer.kind === 'paint') {
        return <span style={{ fontSize: 13, color: EDITOR_TEXT_2 }}>✏</span>
      }
      if (layer.kind === 'group') {
        return <span style={{ fontSize: 10, color: EDITOR_TEXT_2 }}>▶</span>
      }
      // image layer
      const img = project.images[(layer as ImageLayer).imageId]
      return img ? (
        <img
          src={img.dataUrl}
          alt=""
          style={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 3 }}
        />
      ) : (
        <span style={{ fontSize: 9, color: EDITOR_TEXT_4 }}>?</span>
      )
    },
    [project.images],
  )

  const onSelectLayerForPanel = useCallback(
    (id: string | null, multi?: boolean, shift?: boolean) => {
      if (id === null) {
        setSelectedId(null)
        setMultiSelectedIds(new Set())
        return
      }
      if (multi) {
        // Cmd/Ctrl-click: toggle-select
        lastAnchorIdRef.current = id
        setMultiSelectedIds(prev => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      } else if (shift) {
        // Shift-click: range-select from last anchor to clicked row
        const anchorId = lastAnchorIdRef.current ?? selectedId
        if (anchorId && anchorId !== id) {
          const layers = projectRef.current.layers
          const anchorIdx = layers.findIndex(l => l.id === anchorId)
          const clickIdx = layers.findIndex(l => l.id === id)
          const lo = Math.min(anchorIdx, clickIdx)
          const hi = Math.max(anchorIdx, clickIdx)
          const rangeIds = layers.slice(lo, hi + 1).map(l => l.id)
          setMultiSelectedIds(new Set(rangeIds.filter(rid => rid !== anchorId)))
          setSelectedId(anchorId)
        } else {
          lastAnchorIdRef.current = id
          setSelectedId(id)
          setMultiSelectedIds(new Set())
        }
      } else {
        lastAnchorIdRef.current = id
        setSelectedId(id)
        setMultiSelectedIds(new Set())
        setLayerCtxMenu(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId],
  )

  const onEndRenameForPanel = useCallback(
    (layerId: string, newName: string | null) => {
      if (newName) {
        const layer = project.layers.find(l => l.id === layerId)
        const currentLabel = layer ? getLayerLabel(layer) : ''
        if (newName !== currentLabel) {
          mutate(p => mapLayer(p, layerId, l => ({ ...l, name: newName })))
        }
      }
      setRenamingLayerId(null)
    },
    [project.layers, getLayerLabel, mutate],
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
  // Photoshop-convention tool row: interaction-mode TOOLS only.
  // Shadow → Properties panel (per-layer effect section).
  // Background → Properties panel (Document/Canvas section, always visible).
  // Align → Properties panel (shown when ≥1 layer selected; full align/distribute on multi-select).
  // Eraser → promoted from Draw sub-mode to its own dedicated tool.
  const FACEPLATE_TOOLS: readonly ToolDef<FaceplateToolId>[] = [
    { id: 'select', icon: <MousePointer2 size={20} />, label: 'Select' },
    { id: 'text', icon: <Type size={20} />, label: 'Text' },
    { id: 'shapes', icon: <Shapes size={20} />, label: 'Shapes' },
    { id: 'draw', icon: <Pencil size={20} />, label: 'Draw' },
    { id: 'eraser', icon: <Eraser size={20} />, label: 'Eraser' },
    { id: 'mask', icon: <SquareDashedMousePointer size={20} />, label: 'Mask' },
  ]

  // ── Publish build handler — builds SGA, then sets target for inline form ──
  const handleRequestBuild = useCallback(async () => {
    setIsBuildingTarget(true)
    try {
      const { buildFaceplateMod, generateGuid } =
        await import('@/lib/faceplate-mod-build')
      const { ATLAS_WIDTH, ATLAS_HEIGHT, ICON_RECT, BANNER_RECT } =
        await import('@/lib/faceplate-templates')
      const bannerCanvas = await composeFaceplateCanvas(project)
      const atlasCanvas = document.createElement('canvas')
      atlasCanvas.width = ATLAS_WIDTH
      atlasCanvas.height = ATLAS_HEIGHT
      const atlasCtx = atlasCanvas.getContext('2d')
      if (atlasCtx) {
        // Draw the 624×204 banner into the left region of the 692×204 atlas.
        atlasCtx.drawImage(bannerCanvas, 0, 0)
        // Populate the 64×64 icon sub-rect (x=624, y=0) by scaling the full
        // banner down into it. Real workshop faceplates always carry content
        // here — leaving it zeroed produces a black scoreboard/chat icon.
        atlasCtx.drawImage(
          bannerCanvas,
          0, 0, BANNER_RECT.width, BANNER_RECT.height,
          ICON_RECT.x, ICON_RECT.y, ICON_RECT.width, ICON_RECT.height,
        )
      }
      const atlasRgba = atlasCtx
        ? atlasCtx.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data
        : new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4)
      // Reuse the project's STABLE mod-identity GUID so every rebuild produces
      // the same internal mod identity (attrib pbgid, .gfx + .dds asset paths).
      // CoH2 registers a faceplate by that pbgid — a fresh GUID per build
      // orphaned the previous registration, so the faceplate silently failed
      // to show up in-game. Legacy projects are migrated to carry a guid, but
      // we generate-and-persist one here as a defensive fallback so the build
      // is never run with an unstable identity.
      let projectForBuild = project
      let guid = project.guid
      if (!guid) {
        guid = generateGuid()
        projectForBuild = { ...project, guid }
        setProject(projectForBuild)
        persistFaceplate(projectForBuild)
      }
      const result = await buildFaceplateMod({ project: projectForBuild, atlasRgba, guid })
      // For the Workshop preview: composite the banner onto an opaque dark
      // background before passing to generateWorkshopPreview. Without this,
      // transparent-background projects are cropped by cropToOpaqueBbox to
      // only the content region, which can appear icon-sized in Steam.
      const previewCanvas = document.createElement('canvas')
      previewCanvas.width = bannerCanvas.width
      previewCanvas.height = bannerCanvas.height
      const previewCtx = previewCanvas.getContext('2d')
      if (previewCtx) {
        previewCtx.fillStyle = '#1a1a1a'
        previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height)
        previewCtx.drawImage(bannerCanvas, 0, 0)
      }
      const target = makeFaceplatePublishTarget(
        projectForBuild,
        result.sga,
        result.sgaFilename,
        previewCtx ? previewCanvas : bannerCanvas,
        workshopId => {
          const next = { ...projectForBuild, workshopId }
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

  // ── Manual "Export .sga" — the discoverable, explicit export path ────────
  // Live Sync writes the SGA into the mods folder automatically, but its
  // browser writeFile() is a no-op (native-fs is IPC-only) so a browser user
  // never gets a file, and even in Electron there was no explicit, confirmable
  // export affordance. This handler builds the SAME faceplate SGA that Live
  // Sync / Publish produce (buildFaceplateMod over the composed 692×204 atlas)
  // and then either downloads it (browser) or writes it to the game mods
  // folder with a success toast naming the path (Electron).
  const handleExportSga = useCallback(async () => {
    if (isExporting) return
    // "Nothing to export yet" guard — an empty canvas would still build a
    // (blank) atlas, but exporting nothing is almost never intended, so we
    // surface a clear message instead of silently producing an empty banner.
    if (project.layers.length === 0) {
      setExportToast({ intent: 'error', body: 'Nothing to export yet — add a layer first.' })
      return
    }
    setIsExporting(true)
    try {
      const { buildFaceplateMod, generateGuid } = await import('@/lib/faceplate-mod-build')
      const { ATLAS_WIDTH, ATLAS_HEIGHT, ICON_RECT, BANNER_RECT } =
        await import('@/lib/faceplate-templates')

      // Compose the banner, then pack it into the 692×204 atlas exactly the
      // way the publish path does (banner in the left region + a downscaled
      // copy into the 64×64 icon sub-rect so the scoreboard/chat icon isn't
      // black). Reuses composeFaceplateCanvas — no re-implemented compositor.
      const bannerCanvas = await composeFaceplateCanvas(project)
      const atlasCanvas = document.createElement('canvas')
      atlasCanvas.width = ATLAS_WIDTH
      atlasCanvas.height = ATLAS_HEIGHT
      const atlasCtx = atlasCanvas.getContext('2d')
      if (atlasCtx) {
        atlasCtx.drawImage(bannerCanvas, 0, 0)
        atlasCtx.drawImage(
          bannerCanvas,
          0, 0, BANNER_RECT.width, BANNER_RECT.height,
          ICON_RECT.x, ICON_RECT.y, ICON_RECT.width, ICON_RECT.height,
        )
      }
      const atlasRgba = atlasCtx
        ? atlasCtx.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data
        : new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4)

      // Reuse the project's stable mod-identity GUID (persist a fresh one as a
      // defensive fallback, mirroring handleRequestBuild) so every export
      // shares the identity CoH2 registers the faceplate under.
      let projectForBuild = project
      let guid = project.guid
      if (!guid) {
        guid = generateGuid()
        projectForBuild = { ...project, guid }
        setProject(projectForBuild)
        persistFaceplate(projectForBuild)
      }
      const result = await buildFaceplateMod({ project: projectForBuild, atlasRgba, guid })

      if (isElectron()) {
        // Electron: write to the SAME location Live Sync targets —
        // <modsRoot>/faceplates/subscriptions/<guid>.sga (see live-sync
        // _writeFile). detectModsPath() resolves the CoH2 mods folder.
        const modsPath = await detectModsPath()
        if (!modsPath) {
          setExportToast({
            intent: 'error',
            body: "Couldn't locate your CoH2 mods folder. Open the game once so it's created.",
          })
          return
        }
        const norm = modsPath.replace(/\\/g, '/')
        const outPath = `${norm}/faceplates/subscriptions/${result.sgaFilename}`
        await writeFile(outPath, result.sga)
        setExportToast({ intent: 'success', body: `Wrote ${outPath}` })
      } else {
        // Browser: trigger a real file download of the SGA bytes. Copy into a
        // fresh Uint8Array so the Blob owns a plain ArrayBuffer (avoids the
        // SharedArrayBuffer typing pitfall documented in native-fs.writeFile).
        const bytes = new Uint8Array(result.sga)
        const blob = new Blob([bytes], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = result.sgaFilename
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportToast({ intent: 'success', body: `Downloaded ${result.sgaFilename}` })
      }
    } catch (e) {
      console.error('Faceplate .sga export failed:', e)
      setExportToast({ intent: 'error', body: "Couldn't build the mod file — please try again." })
    } finally {
      setIsExporting(false)
    }
  }, [project, isExporting, setProject])

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
      {/* pzContainerRef wraps the stage area; usePanZoom attaches its wheel
          listener here, and pz.handlers spread here enable Space/middle-drag
          pan. The inner canvas carries translate+scale via CSS transform. */}
      <div
        ref={pzContainerRef}
        style={{ position: 'absolute', inset: 0 }}
        {...pz.handlers}
      >
      <ImageDropZone
        onImport={onImport}
        onDragStateChange={setDragOver}
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
            // Padding clears the floating panels and chrome so the banner is
            // ALWAYS fully visible in the gap between them.
            //   Left:   12px edge + 196px Layers panel + 16px gap = 224px
            //   Right:  12px edge + 210px Properties panel + 16px gap = 238px
            //   Top:    title pill ~64px
            //   Bottom: tool pill ~108px
            paddingTop: 64,
            paddingBottom: 108,
            paddingLeft: 224,   // 12 + 196 Layers + 16 gap
            paddingRight: 238,  // 12 + 210 Properties + 16 gap
            // Make absolutely sure the canvas area is not part of the
            // window-drag strip (the strip's z-[1] would otherwise eat
            // pointer-down on the canvas margins).
            WebkitAppRegion: 'no-drag',
            // No explicit backdrop — the editor's normal background shows in the
            // outside-bounds (OOB) region. The red OOB shade is a filtered
            // DUPLICATE of the layer content (see the ghost overlay below) whose
            // transparent areas contribute nothing, so empty margins keep the
            // normal background and only spilled content reads red.
          } as CSSProperties
        }
        onPointerDown={(ev: React.PointerEvent<HTMLDivElement>) => {
          // Click on empty canvas → deselect.
          if (ev.target === ev.currentTarget) setSelectedId(null)
        }}
      >
        {/* P1 — Document surface: pan/zoom pass-through wrapper sized to the canvas.
            No border frame — content outside the export bounds shows the red OOB
            tint (via the clip-path overlay below) instead of a colored frame.
            The canvas div below carries the drop shadow and guide background.
            Pan/zoom translate is applied to this wrapper so canvas + shadow move together. */}
        <div
          style={{
            position: 'relative',
            transform: `translate(${pz.offset.x}px, ${pz.offset.y}px)`,
            // Surface size: exactly the visible banner — no extra border padding.
            // OOB content spills outside via overflow:visible on the canvas div.
            width: FACEPLATE_BANNER_W * viewScale,
            height: FACEPLATE_BANNER_H * viewScale,
            // No background: the canvas div has the guide fill; OOB region shows
            // the editor's normal background (dark void outside the bounds).
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            flexShrink: 0,
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

                    // ── Eyedropper: one-shot colour sample from the composited canvas ──
                    if (eyedropperActive) {
                      void composeFaceplateCanvas(project).then(c => {
                        const ctx = c.getContext('2d')
                        if (!ctx) return
                        const sampled = samplePixel(ctx, Math.round(x), Math.round(y))
                        setBrushColor(sampled)
                      })
                      setEyedropperActive(false)
                      return
                    }

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
                    liveCanvas.style.cssText = `position:absolute;left:0;top:0;width:${FACEPLATE_BANNER_W * viewScale}px;height:${FACEPLATE_BANNER_H * viewScale}px;pointer-events:none;z-index:999`
                    canvasRef.current!.appendChild(liveCanvas)
                    liveStrokeCanvasRef.current = liveCanvas

                    const lctx = liveCanvas.getContext('2d')!
                    // In erase mode, use destination-out so strokes erase pixels
                    // rather than painting them. globalAlpha still controls the
                    // strength of the erase (partial erase at lower opacity).
                    if (brushErase) {
                      lctx.globalCompositeOperation = 'destination-out'
                    }

                    // Hardness-aware stamp helper. When hardness < 100 we use a
                    // radial-gradient alpha falloff (soft brush à la Photoshop).
                    // hardness 0–100: 100 = crisp disc, 0 = fully feathered.
                    const stampDab = (ctx: CanvasRenderingContext2D, px: number, py: number) => {
                      const r = brushSize / 2
                      ctx.save()
                      ctx.globalAlpha = brushOpacity
                      if (brushErase) {
                        ctx.globalCompositeOperation = 'destination-out'
                      }
                      if (brushHardness < 100) {
                        // softness: 0 = fully feathered (inner radius = 0), 100 = crisp.
                        // inner radius fraction = hardness / 100
                        const innerFrac = brushHardness / 100
                        const grad = ctx.createRadialGradient(px, py, r * innerFrac, px, py, r)
                        const paintCol = brushErase ? 'rgba(0,0,0,1)' : brushColor
                        grad.addColorStop(0, paintCol)
                        // fade to transparent at edge
                        const fadeCol = brushErase
                          ? 'rgba(0,0,0,0)'
                          : (() => {
                              const m = paintCol.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
                              if (m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0)`
                              return 'rgba(0,0,0,0)'
                            })()
                        grad.addColorStop(1, fadeCol)
                        ctx.fillStyle = grad
                      } else {
                        ctx.fillStyle = brushErase ? 'rgba(0,0,0,1)' : brushColor
                      }
                      ctx.beginPath()
                      ctx.arc(px, py, r, 0, Math.PI * 2)
                      ctx.fill()
                      ctx.restore()
                    }

                    const stampSegment = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
                      const dx = x1 - x0
                      const dy = y1 - y0
                      const dist = Math.hypot(dx, dy)
                      const step = Math.max(1, brushSize / 4)
                      const n = Math.max(1, Math.ceil(dist / step))
                      for (let i = 1; i <= n; i++) {
                        const t = i / n
                        stampDab(ctx, x0 + dx * t, y0 + dy * t)
                      }
                    }

                    // Start all mirrored sub-paths.
                    const startPts = mirrorPoints(x, y)
                    // Stamp the initial dab at pointer-down position.
                    for (const pt of startPts) {
                      stampDab(lctx, pt.x, pt.y)
                    }
                    isDrawingRef.current = true
                    // Gesture-granular undo: whole stroke = ONE undo frame.
                    history.beginGesture('Paint')

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
                      // Stamp segment from last to current position per mirrored point.
                      for (let i = 0; i < newPts.length; i++) {
                        const from = lastPts[i] ?? lastPts[0]
                        stampSegment(mc, from.x, from.y, newPts[i].x, newPts[i].y)
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
                    window.addEventListener('pointercancel', onUp)
                  }
                : activeTool === 'eraser'
                  ? ev => {
                      // Eraser tool — identical to the draw handler but with erase
                      // mode permanently forced on. Delegates by temporarily setting
                      // brushErase via a synthetic draw path: we reuse all draw
                      // canvas logic by calling the same code with brushErase=true.
                      // This is a pointer-down handler; the actual erase compositing
                      // is performed in-line below, identical to the draw branch.
                      ev.preventDefault()
                      ev.stopPropagation()
                      const rect = canvasRef.current!.getBoundingClientRect()
                      const x = (ev.clientX - rect.left) / viewScale
                      const y = (ev.clientY - rect.top) / viewScale

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

                      const liveCanvas = document.createElement('canvas')
                      liveCanvas.width = FACEPLATE_BANNER_W
                      liveCanvas.height = FACEPLATE_BANNER_H
                      liveCanvas.style.cssText = `position:absolute;left:0;top:0;width:${FACEPLATE_BANNER_W * viewScale}px;height:${FACEPLATE_BANNER_H * viewScale}px;pointer-events:none;z-index:999`
                      canvasRef.current!.appendChild(liveCanvas)
                      liveStrokeCanvasRef.current = liveCanvas

                      const lctx = liveCanvas.getContext('2d')!
                      lctx.globalCompositeOperation = 'destination-out'

                      const stampDab = (ctx: CanvasRenderingContext2D, px: number, py: number) => {
                        const r = brushSize / 2
                        ctx.save()
                        ctx.globalAlpha = brushOpacity
                        ctx.globalCompositeOperation = 'destination-out'
                        if (brushHardness < 100) {
                          const innerFrac = brushHardness / 100
                          const grad = ctx.createRadialGradient(px, py, r * innerFrac, px, py, r)
                          grad.addColorStop(0, 'rgba(0,0,0,1)')
                          grad.addColorStop(1, 'rgba(0,0,0,0)')
                          ctx.fillStyle = grad
                        } else {
                          ctx.fillStyle = 'rgba(0,0,0,1)'
                        }
                        ctx.beginPath()
                        ctx.arc(px, py, r, 0, Math.PI * 2)
                        ctx.fill()
                        ctx.restore()
                      }

                      const stampSegment = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
                        const dx = x1 - x0; const dy = y1 - y0
                        const dist = Math.hypot(dx, dy)
                        const step = Math.max(1, brushSize / 4)
                        const n = Math.max(1, Math.ceil(dist / step))
                        for (let i = 1; i <= n; i++) {
                          const t = i / n
                          stampDab(ctx, x0 + dx * t, y0 + dy * t)
                        }
                      }

                      stampDab(lctx, x, y)
                      isDrawingRef.current = true
                      history.beginGesture('Erase')
                      let lastX = x; let lastY = y
                      const paintLayerId = paintLayer.id

                      const onMove = (mev: PointerEvent) => {
                        if (!isDrawingRef.current) return
                        const lc = liveStrokeCanvasRef.current
                        if (!lc) return
                        const mrect = canvasRef.current!.getBoundingClientRect()
                        const mx = (mev.clientX - mrect.left) / viewScale
                        const my = (mev.clientY - mrect.top) / viewScale
                        const mc = lc.getContext('2d')!
                        stampSegment(mc, lastX, lastY, mx, my)
                        lastX = mx; lastY = my
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

                        const offscreen = document.createElement('canvas')
                        offscreen.width = FACEPLATE_BANNER_W
                        offscreen.height = FACEPLATE_BANNER_H
                        const octx = offscreen.getContext('2d')!

                        const applyErase = (existingDataUrl: string) => {
                          const applyToOffscreen = () => {
                            // Use destination-out so the erase strokes on `lc` punch
                            // holes through the existing paint on the offscreen canvas,
                            // rather than compositing transparently on top of it (which
                            // is a no-op and causes the "eraser does nothing" bug).
                            octx.globalCompositeOperation = 'destination-out'
                            octx.drawImage(lc, 0, 0)
                            octx.globalCompositeOperation = 'source-over'
                            const newDataUrl = offscreen.toDataURL('image/png')
                            mutate(p =>
                              mapLayer(p, paintLayerId, l =>
                                l.kind === 'paint' ? { ...l, dataUrl: newDataUrl } : l,
                              ),
                            )
                            lc.remove()
                            liveStrokeCanvasRef.current = null
                          }

                          if (
                            existingDataUrl &&
                            existingDataUrl !==
                              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
                          ) {
                            const existImg = new Image()
                            existImg.onload = () => {
                              octx.drawImage(existImg, 0, 0, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H)
                              applyToOffscreen()
                            }
                            existImg.src = existingDataUrl
                          } else {
                            applyToOffscreen()
                          }
                        }

                        setProject(prev => {
                          const pl = prev.layers.find(l => l.id === paintLayerId) as PaintLayer | undefined
                          applyErase(pl?.dataUrl ?? '')
                          return prev
                        })
                      }

                      window.addEventListener('pointermove', onMove)
                      window.addEventListener('pointerup', onUp)
                      window.addEventListener('pointercancel', onUp)
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
                        window.removeEventListener('pointercancel', onMaskUp)
                      }

                      window.addEventListener('pointermove', onMaskMove)
                      window.addEventListener('pointerup', onMaskUp)
                      window.addEventListener('pointercancel', onMaskUp)
                    }
                  : undefined
          }
          style={{
            width: FACEPLATE_BANNER_W * viewScale,
            height: FACEPLATE_BANNER_H * viewScale,
            position: 'relative',
            // Pan offset is now on the outer surface wrapper div above —
            // no transform here so the canvas stays centred inside the surface.
            // Background colour logic:
            //   • Transparent-preview mode: classic light Photoshop checker so
            //     alpha=0 regions read clearly (white base + grey/white checker).
            //   • Project has an explicit backgroundColor: show it (user-set fill).
            //   • Project backgroundColor === null (true transparency): visible dark
            //     checker on a mid-dark base (#1a1c22) to indicate transparent canvas
            //     while keeping dark-mode consistent. The checker must be clearly
            //     visible against the #252836 surface surrounding it.
            backgroundColor: previewTransparent
              ? '#ffffff'
              : (project.backgroundColor ?? '#141620'),
            backgroundImage: previewTransparent
              ? lightCheckerBackground()
              : project.backgroundColor === null
                ? darkCheckerBackground()
                : 'none',
            backgroundSize: '16px 16px',
            // In-game CoH2 faceplate banners are strictly rectangular — no
            // corner radius. Editing on a rounded surface gave the user a
            // false impression that the edges would crop in-game; they
            // don't. Match the in-game shape exactly so what you paint is
            // what you ship.
            borderRadius: 0,
            cursor:
              activeTool === 'text'
                ? 'text'
                : activeTool === 'draw' || activeTool === 'eraser' || activeTool === 'mask'
                  ? 'crosshair'
                  : 'default',
            // Drop shadow lifts the canvas off the void; drag-over adds inner highlight.
            boxShadow: dragOver
              ? '0 16px 64px -8px rgba(0,0,0,0.90), 0 4px 16px -4px rgba(0,0,0,0.70), inset 0 0 0 2px rgba(120,180,255,0.6)'
              : '0 16px 64px -8px rgba(0,0,0,0.90), 0 4px 16px -4px rgba(0,0,0,0.70)',
            outline: 'none',
            // overflow:visible so layers dragged past the canvas edge remain
            // visible above the red OOB zone (clipping is on the outer wrapper).
            overflow: 'visible',
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

          {/* Konva Stage — renders TEXT, SHAPE, IMAGE as Konva nodes.
              PAINT layers are shown as Konva.Image wrapping an offscreen canvas
              so they composite at the correct z-order inside the Stage. */}
          <Stage
            ref={konvaStageRef}
            width={FACEPLATE_BANNER_W * viewScale}
            height={FACEPLATE_BANNER_H * viewScale}
            scaleX={viewScale}
            scaleY={viewScale}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              // In draw/mask mode, pass pointer events through to the
              // div overlay beneath. In text mode, pass through so click-to-place
              // is handled by the canvasRef's pointerDown.
              pointerEvents:
                activeTool === 'draw' || activeTool === 'mask' || activeTool === 'text'
                  ? 'none'
                  : 'auto',
            }}
            onPointerDown={e => {
              // Click on empty Stage area → deselect
              if (e.target === e.target.getStage()) {
                setSelectedId(null)
                setMultiSelectedIds(new Set())
              }
            }}
          >
            <Layer>
              {project.layers.map(layer => {
                if (!layer.visible) return null

                if (layer.kind === 'group') return null
                const isLocked = layer.locked || layer.lockFlags?.position
                const canDrag = !isLocked && activeTool !== 'draw' && activeTool !== 'mask'

                if (layer.kind === 'text') {
                  // Text layers in inline-edit mode: render as invisible placeholder
                  // (the HTML contenteditable overlay handles display and input).
                  // Non-editing: Konva.Text renders the text.
                  if (editingTextId === layer.id) {
                    // Render a transparent placeholder rect to keep z-order, but
                    // the visible text is the HTML overlay below.
                    return (
                      <Rect
                        key={layer.id}
                        ref={el => { konvaNodeRefs.current[layer.id] = el }}
                        x={layer.x}
                        y={layer.y}
                        width={1}
                        height={1}
                        opacity={0}
                        listening={false}
                      />
                    )
                  }
                  return (
                    <KonvaText
                      key={layer.id}
                      ref={el => { konvaNodeRefs.current[layer.id] = el }}
                      x={layer.x}
                      y={layer.y}
                      offsetX={0}
                      offsetY={0}
                      text={layer.text}
                      fontFamily={layer.fontFamily}
                      fontSize={layer.fontSize}
                      fontStyle={`${layer.fontStyle === 'italic' ? 'italic ' : ''}${layer.fontWeight}`}
                      fill={layer.color}
                      align={layer.align}
                      lineHeight={layer.lineHeight ?? 1.2}
                      letterSpacing={layer.letterSpacing ?? 0}
                      rotation={layer.rotation}
                      scaleX={layer.scale}
                      scaleY={layer.scale}
                      opacity={layer.opacity}
                      globalCompositeOperation={(layer.blendMode ?? 'source-over') as GlobalCompositeOperation}
                      draggable={canDrag}
                      onPointerDown={e => {
                        if (isLocked) return
                        e.cancelBubble = true
                        if (e.evt.ctrlKey || e.evt.metaKey) {
                          setMultiSelectedIds(prev => {
                            const next = new Set(prev)
                            if (next.has(layer.id)) next.delete(layer.id)
                            else next.add(layer.id)
                            return next
                          })
                        } else {
                          setSelectedId(layer.id)
                          setMultiSelectedIds(new Set())
                        }
                      }}
                      onDblClick={() => {
                        if (!isLocked) {
                          setSelectedId(layer.id)
                          setEditingTextId(layer.id)
                        }
                      }}
                      onDragStart={() => {
                        if (isAltHeldRef.current) altDragOriginalIdRef.current = layer.id
                        history.beginGesture(isAltHeldRef.current ? 'Duplicate layer (alt-drag)' : 'Move layer')
                        // Capture start positions for ALL selected nodes (Gap 3).
                        const starts = new Map<string, { x: number; y: number }>()
                        const selfNode = konvaNodeRefs.current[layer.id]
                        if (selfNode) starts.set(layer.id, { x: selfNode.x(), y: selfNode.y() })
                        const companions = new Set([...Array.from(multiSelectedIds), ...(selectedId && selectedId !== layer.id ? [selectedId] : [])])
                        for (const id of companions) {
                          if (id === layer.id) continue
                          const companionNode = konvaNodeRefs.current[id]
                          if (companionNode) starts.set(id, { x: companionNode.x(), y: companionNode.y() })
                        }
                        dragStartPositionsRef.current = starts
                      }}
                      onDragMove={e => handleKonvaDragMove(layer.id, e.target)}
                      onDragEnd={e => handleKonvaDragEnd(layer.id, e.target)}
                      onTransformStart={() => history.beginGesture('Transform layer')}
                      onTransformEnd={() => handleKonvaTransformEnd(layer.id)}
                    />
                  )
                }

                if (layer.kind === 'shape') {
                  // Use base (un-scaled) dimensions here. scaleX/scaleY={layer.scale}
                  // in commonProps applies the scale, matching the export path:
                  //   composeFaceplateCanvas: ctx.scale(scale,scale) then draws at width×height
                  // Previously w/h were pre-multiplied AND scaleX/Y also applied → scale²; fixed.
                  const w = layer.width
                  const h = layer.height
                  const shapeKey = layer.id
                  const commonProps = {
                    ref: (el: Konva.Node | null) => { konvaNodeRefs.current[layer.id] = el },
                    x: layer.x,
                    y: layer.y,
                    rotation: layer.rotation,
                    scaleX: layer.scale,
                    scaleY: layer.scale,
                    opacity: layer.opacity,
                    globalCompositeOperation: (layer.blendMode ?? 'source-over') as GlobalCompositeOperation,
                    draggable: canDrag,
                    onPointerDown: (e: Konva.KonvaEventObject<PointerEvent>) => {
                      if (isLocked) return
                      e.cancelBubble = true
                      if (e.evt.ctrlKey || e.evt.metaKey) {
                        setMultiSelectedIds(prev => {
                          const next = new Set(prev)
                          if (next.has(layer.id)) next.delete(layer.id)
                          else next.add(layer.id)
                          return next
                        })
                      } else {
                        setSelectedId(layer.id)
                        setMultiSelectedIds(new Set())
                      }
                    },
                    onDragStart: () => {
                      if (isAltHeldRef.current) altDragOriginalIdRef.current = layer.id
                      history.beginGesture(isAltHeldRef.current ? 'Duplicate layer (alt-drag)' : 'Move layer')
                      // Capture start positions for ALL selected nodes (Gap 3).
                      const starts = new Map<string, { x: number; y: number }>()
                      const selfNode = konvaNodeRefs.current[layer.id]
                      if (selfNode) starts.set(layer.id, { x: selfNode.x(), y: selfNode.y() })
                      const companions = new Set([...Array.from(multiSelectedIds), ...(selectedId && selectedId !== layer.id ? [selectedId] : [])])
                      for (const id of companions) {
                        if (id === layer.id) continue
                        const companionNode = konvaNodeRefs.current[id]
                        if (companionNode) starts.set(id, { x: companionNode.x(), y: companionNode.y() })
                      }
                      dragStartPositionsRef.current = starts
                    },
                    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => handleKonvaDragMove(layer.id, e.target),
                    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleKonvaDragEnd(layer.id, e.target),
                    onTransformStart: () => history.beginGesture('Transform layer'),
                    onTransformEnd: () => handleKonvaTransformEnd(layer.id),
                  }
                  // Fill: solid or gradient. Konva fillLinearGradientColorStops / fillRadialGradientColorStops
                  const fillProps: Record<string, unknown> = {}
                  if (layer.gradientFill) {
                    const gf = layer.gradientFill
                    if (gf.kind === 'linear') {
                      const rad = ((gf.angle ?? 0) * Math.PI) / 180
                      const hw = w / 2; const hh = h / 2
                      fillProps.fillLinearGradientStartPoint = { x: -hw * Math.cos(rad) - hh * Math.sin(rad), y: -hw * Math.sin(rad) + hh * Math.cos(rad) }
                      fillProps.fillLinearGradientEndPoint = { x: hw * Math.cos(rad) + hh * Math.sin(rad), y: hw * Math.sin(rad) - hh * Math.cos(rad) }
                      fillProps.fillLinearGradientColorStops = gf.stops.flatMap(s => [s.position, s.color])
                    } else {
                      const outerR = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2)
                      fillProps.fillRadialGradientStartPoint = { x: 0, y: 0 }
                      fillProps.fillRadialGradientEndPoint = { x: 0, y: 0 }
                      fillProps.fillRadialGradientStartRadius = 0
                      fillProps.fillRadialGradientEndRadius = outerR
                      fillProps.fillRadialGradientColorStops = gf.stops.flatMap(s => [s.position, s.color])
                    }
                  } else {
                    fillProps.fill = layer.fillColor
                  }
                  const strokeProps: Record<string, unknown> = {}
                  if (layer.stroke && layer.stroke.width > 0) {
                    strokeProps.stroke = layer.stroke.color
                    strokeProps.strokeWidth = layer.stroke.width
                  }
                  // offsetX/Y centre the shape on layer.x/y (matching compose function)
                  switch (layer.shapeType) {
                    case 'rectangle': {
                      const cr = layer.cornerRadius ?? 0
                      return (
                        <Rect
                          key={shapeKey}
                          {...commonProps}
                          offsetX={w / 2}
                          offsetY={h / 2}
                          width={w}
                          height={h}
                          cornerRadius={cr > 0 ? Math.min(cr, w / 2, h / 2) : 0}
                          {...fillProps}
                          {...strokeProps}
                        />
                      )
                    }
                    case 'circle':
                      return (
                        <Ellipse
                          key={shapeKey}
                          {...commonProps}
                          radiusX={w / 2}
                          radiusY={h / 2}
                          {...fillProps}
                          {...strokeProps}
                        />
                      )
                    default: {
                      // Gap 1: chevron / star / shield — rendered faithfully via
                      // KonvaShape + sceneFunc using the same geometry as shapeToPath2D
                      // in composeFaceplateCanvas. The sceneFunc draws in local space
                      // centred at (0,0); Konva's x/y/rotation/scale are applied before
                      // sceneFunc is invoked, matching the export path exactly.
                      const shapeType = layer.shapeType
                      const sw = w
                      const sh = h
                      return (
                        <KonvaShape
                          key={shapeKey}
                          {...commonProps}
                          width={sw}
                          height={sh}
                          {...fillProps}
                          {...strokeProps}
                          sceneFunc={(ctx, shape) => {
                            ctx.beginPath()
                            // Shared geometry helper — same path as shapeToPath2D used by
                            // composeFaceplateCanvas, so preview matches export exactly.
                            drawComplexShapePath(shapeType, sw, sh, ctx)
                            ctx.fillStrokeShape(shape)
                          }}
                        />
                      )
                    }
                  }
                }

                if (layer.kind === 'paint') {
                  // Paint layers: render as full-banner KonvaImage so they composite
                  // at correct z-order with non-raster layers.
                  if (!layer.dataUrl || layer.dataUrl === 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==') {
                    return null
                  }
                  // We use a lazy-loaded approach: store element in konvaImages under the layer id.
                  // Invalidate the cache when dataUrl changes (e.g. after a paint stroke) so the
                  // Konva Stage always shows the latest composite — mirrors DecalPackEditor's
                  // cached.src !== src.dataUrl reload pattern.
                  const paintCacheKey = `paint_${layer.id}`
                  const paintEl = konvaImages[paintCacheKey]
                  if (!paintEl || paintEl.src !== layer.dataUrl) {
                    // Trigger load (or reload on stale dataUrl)
                    const img = new window.Image()
                    img.onload = () => setKonvaImages(prev => ({ ...prev, [paintCacheKey]: img }))
                    img.src = layer.dataUrl
                    if (!paintEl) return null
                    // If stale (paintEl exists but wrong src), keep rendering the old image
                    // until the new one loads — avoids a one-frame blank flash.
                  }
                  return (
                    <KonvaImage
                      key={layer.id}
                      ref={el => { konvaNodeRefs.current[layer.id] = el }}
                      image={paintEl}
                      x={0}
                      y={0}
                      width={FACEPLATE_BANNER_W}
                      height={FACEPLATE_BANNER_H}
                      opacity={layer.opacity}
                      globalCompositeOperation={(layer.blendMode ?? 'source-over') as GlobalCompositeOperation}
                      onPointerDown={e => {
                        e.cancelBubble = true
                        setSelectedId(layer.id)
                        setMultiSelectedIds(new Set())
                      }}
                    />
                  )
                }

                // Image layer
                const img = project.images[layer.imageId]
                if (!img) return null
                const imgEl = konvaImages[layer.imageId]
                if (!imgEl) return null
                const scaleXVal = layer.scale * (layer.flipH ? -1 : 1)
                const scaleYVal = (layer.scaleY ?? layer.scale) * (layer.flipV ? -1 : 1)
                // Gap 2: Build Konva filter list + attr props from CSS filter values.
                const { filterFns: imgFilterFns, attrs: imgFilterAttrs } = buildKonvaImageFilters(layer.filters)
                return (
                  <KonvaImage
                    key={layer.id}
                    ref={el => { konvaNodeRefs.current[layer.id] = el }}
                    image={imgEl}
                    x={layer.x}
                    y={layer.y}
                    offsetX={imgEl.naturalWidth / 2}
                    offsetY={imgEl.naturalHeight / 2}
                    scaleX={scaleXVal}
                    scaleY={scaleYVal}
                    rotation={layer.rotation}
                    opacity={layer.opacity}
                    globalCompositeOperation={(layer.blendMode ?? 'source-over') as GlobalCompositeOperation}
                    filters={imgFilterFns}
                    {...imgFilterAttrs}
                    draggable={canDrag}
                    onPointerDown={e => {
                      if (isLocked) return
                      e.cancelBubble = true
                      if (e.evt.ctrlKey || e.evt.metaKey) {
                        setMultiSelectedIds(prev => {
                          const next = new Set(prev)
                          if (next.has(layer.id)) next.delete(layer.id)
                          else next.add(layer.id)
                          return next
                        })
                      } else {
                        setSelectedId(layer.id)
                        setMultiSelectedIds(new Set())
                      }
                    }}
                    onDragStart={() => {
                      // Alt-drag duplicate: mark this layer as the alt-drag source.
                      if (isAltHeldRef.current) {
                        altDragOriginalIdRef.current = layer.id
                      }
                      history.beginGesture(isAltHeldRef.current ? 'Duplicate layer (alt-drag)' : 'Move layer')
                      // Capture start positions for ALL selected nodes (Gap 3).
                      const starts = new Map<string, { x: number; y: number }>()
                      const selfNode = konvaNodeRefs.current[layer.id]
                      if (selfNode) starts.set(layer.id, { x: selfNode.x(), y: selfNode.y() })
                      const companions = new Set([...Array.from(multiSelectedIds), ...(selectedId && selectedId !== layer.id ? [selectedId] : [])])
                      for (const id of companions) {
                        if (id === layer.id) continue
                        const companionNode = konvaNodeRefs.current[id]
                        if (companionNode) starts.set(id, { x: companionNode.x(), y: companionNode.y() })
                      }
                      dragStartPositionsRef.current = starts
                    }}
                    onDragMove={e => handleKonvaDragMove(layer.id, e.target)}
                    onDragEnd={e => handleKonvaDragEnd(layer.id, e.target)}
                    onTransformStart={() => history.beginGesture('Transform layer')}
                    onTransformEnd={() => handleKonvaTransformEnd(layer.id)}
                  />
                )
              })}
              {/* Konva Transformer — replaces CanvasHandles for select tool.
                  keepRatio={false}: Konva's shiftBehavior='default' already handles
                  Shift→aspect-lock (keepProportion = false || e.shiftKey).
                  rotationSnaps: when Shift is held, snap rotation to 15° increments;
                  empty array otherwise (free rotation). */}
              <Transformer
                ref={transformerRef}
                keepRatio={false}
                rotateEnabled
                rotationSnaps={isShiftHeld ? [0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345] : []}
                rotationSnapTolerance={8}
                borderStroke={EDITOR_ACCENT}
                borderStrokeWidth={1.5 / viewScale}
                anchorSize={10 / viewScale}
                anchorCornerRadius={2}
                anchorStroke={EDITOR_ACCENT}
                anchorFill="rgba(20,22,28,0.92)"
                visible={activeTool !== 'draw' && activeTool !== 'mask'}
              />
            </Layer>
          </Stage>

          {/* Text inline-edit overlay — HTML contenteditable positioned over Konva.
              Shown when editingTextId is set; the Konva text node is hidden (opacity 0 placeholder). */}
          {project.layers.map(layer => {
            if (layer.kind !== 'text' || layer.id !== editingTextId || !layer.visible) return null
            const cx = layer.x * viewScale
            const cy = layer.y * viewScale
            const scaledFont = layer.fontSize * layer.scale * viewScale
            const editOverlayStyle: React.CSSProperties = {
              position: 'absolute',
              left: cx,
              top: cy,
              transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
              transformOrigin: '50% 50%',
              opacity: layer.opacity,
              userSelect: 'text',
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
              minWidth: scaledFont * 0.5,
              maxWidth: `${FACEPLATE_BANNER_W * viewScale}px`,
              cursor: 'text',
              caretColor: layer.color,
              outline: `1px dashed rgba(255,255,255,0.35)`,
              outlineOffset: 2,
              zIndex: 1001,
            }
            return (
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
                  if (el.dataset.focused === '1') return
                  el.dataset.focused = '1'
                  el.focus()
                  const range = document.createRange()
                  range.selectNodeContents(el)
                  range.collapse(false)
                  const sel = window.getSelection()
                  if (sel) {
                    sel.removeAllRanges()
                    sel.addRange(range)
                  }
                }}
                onPointerDown={ev => { ev.stopPropagation() }}
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
                    ev.preventDefault()
                    ;(ev.currentTarget as HTMLDivElement).blur()
                  }
                }}
                onBlur={() => commitTextEdit(layer.id)}
                style={editOverlayStyle}
              >
                {layer.text}
              </div>
            )
          })}

          {/* Out-of-bounds red shade (deterministic — no blend modes).
              A non-interactive, red-tinted DUPLICATE of the layer visuals,
              clipped to the region OUTSIDE the canvas bins. CSS `filter`
              respects source alpha, so transparent/empty areas contribute
              nothing: the black work-area backdrop shows through (NO red when
              nothing spills out of bounds). Only opaque content pixels that
              extend past the canvas edge receive the red shade.

              Placed in DOM *after* the real layers (so outside the bins it
              paints over the full-colour originals) but *before* the selection
              handles (so handles stay un-tinted; pointerEvents:none keeps them
              interactive even where the ghost overlaps them).

              NOTE: geometry here mirrors the interactive layer render above —
              keep the two in sync if layer positioning changes. */}
          {/* Red-tint colour matrix: maps any pixel to a luminance-shaded RED
              while preserving alpha (CSS sepia+hue-rotate drifted to orange).
              R ≈ 0.45·luma + 0.28, G/B ≈ 0.05·luma → clearly red, still shows
              the content's shape via luminance. */}
          <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden focusable={false}>
            {/* filterUnits="userSpaceOnUse" + large explicit region so content
                that overflows the overlay div's own bounds (layers dragged far
                outside the canvas edge) still receives the red-tint matrix.
                The default objectBoundingBox region (±10%) only covers ~82px
                past the overlay edge which is too small for partially-OOB layers. */}
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
              // Recolour visible content to a red shade; a no-op on transparent
              // pixels, so empty areas keep the editor's normal background.
              filter: 'url(#oob-red-tint)',
              // Donut clip: reveal everything OUTSIDE the bins rect, hide the
              // inside. Coords are in this overlay's own box space; the box is
              // inset:0 so it coincides with the canvas bins (0,0)–(W,H).
              clipPath: `polygon(evenodd, -9999px -9999px, 9999px -9999px, 9999px 9999px, -9999px 9999px, -9999px -9999px, 0px 0px, ${FACEPLATE_BANNER_W * viewScale}px 0px, ${FACEPLATE_BANNER_W * viewScale}px ${FACEPLATE_BANNER_H * viewScale}px, 0px ${FACEPLATE_BANNER_H * viewScale}px, 0px 0px)`,
            }}
          >
            {project.layers.map(layer => {
              if (!layer.visible) return null
              if (layer.kind === 'text') {
                const cx = layer.x * viewScale
                const cy = layer.y * viewScale
                const scaledFont = layer.fontSize * layer.scale * viewScale
                return (
                  <div
                    key={layer.id}
                    style={{
                      position: 'absolute',
                      left: cx,
                      top: cy,
                      transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
                      transformOrigin: '50% 50%',
                      opacity: layer.opacity,
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
                    }}
                  >
                    {layer.text.split('\n').map((line, i) => (
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
                return (
                  <div
                    key={layer.id}
                    style={{
                      position: 'absolute',
                      left: cx,
                      top: cy,
                      transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
                      transformOrigin: '50% 50%',
                      opacity: layer.opacity,
                    }}
                  >
                    <svg
                      width={svgW}
                      height={svgH}
                      viewBox="0 0 100 100"
                      style={{ display: 'block', overflow: 'visible' }}
                    >
                      {shapeToSvgElement(layer.shapeType, layer.fillColor, strokeColor, strokeWidth)}
                    </svg>
                  </div>
                )
              }
              if (layer.kind === 'paint') {
                return (
                  <img
                    key={layer.id}
                    src={layer.dataUrl}
                    alt=""
                    draggable={false}
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: FACEPLATE_BANNER_W,
                      height: FACEPLATE_BANNER_H,
                      opacity: layer.opacity,
                    }}
                  />
                )
              }
              if (layer.kind !== 'image') return null
              const img = project.images[layer.imageId]
              if (!img) return null
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
                  style={{
                    position: 'absolute',
                    left: cx,
                    top: cy,
                    width: baseW,
                    height: baseH,
                    transform: `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${sx}, ${sy})`,
                    transformOrigin: '50% 50%',
                    opacity: layer.opacity,
                  }}
                >
                  <img
                    src={img.dataUrl}
                    alt=""
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      filter: imageFilterCss(layer.filters),
                    }}
                  />
                </div>
              )
            })}
          </div>

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
        </div>{/* end canvasRef */}
        </div>{/* end document surface wrapper */}
      </ImageDropZone>
      </div>{/* end pzContainerRef */}

      {/* ─────────────────────────────────────────────────────────────
          Floating chrome — all positioned absolutely so it overlays the
          ImageDropZone without participating in its grid layout.

          1. Home button — top-left. Returns the user to the StartScreen.
          2. BottomToolPill + ToolOptionsPeel — bottom-centre.
          ───────────────────────────────────────────────────────────── */}

      {/* ── Home button — top-left ───────────────────────────────────────
          Now carries the shared Undo/Redo control (R1) so history is a
          visible, consistent affordance across all three editors — not
          keyboard-only. Ctrl+Z / Ctrl+Shift+Z still drive the same engine. */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(12px + var(--app-top-inset, 0px))',
          left: 12,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        } as React.CSSProperties}
      >
        <EditorHomeButton onClick={onBack} />
        {/* Shared Undo/Redo control (R1). Redo hint reflects this editor's
            actual shortcut (Ctrl+Shift+Z, also Ctrl+Y). */}
        <UndoRedoBar
          canUndo={history.canUndo()}
          canRedo={history.canRedo()}
          onUndo={undo}
          onRedo={redo}
          redoLabel="Redo (Ctrl+Shift+Z)"
        />
        {/* Q6 — explicit, discoverable "Export .sga" affordance. Live Sync's
            on-disk write is a no-op in the browser and silent even in Electron,
            so this button gives the user a confirmable export: a real file
            download in the browser, or a mods-folder write + path toast in
            Electron. Disabled with a hint when there's nothing to export yet.
            Styling mirrors EditorHomeButton's glass pill so the two read as a
            matched top-bar pair. */}
        <button
          type="button"
          onClick={handleExportSga}
          disabled={isExporting || project.layers.length === 0}
          title={
            project.layers.length === 0
              ? 'Add a layer before exporting'
              : isElectron()
                ? 'Export the faceplate .sga into your CoH2 mods folder'
                : 'Download the faceplate as a .sga mod file'
          }
          aria-label="Export faceplate as .sga"
          className="hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 36,
            padding: '0 12px',
            borderRadius: 12,
            background: 'rgba(15, 17, 22, 0.75)',
            backgroundImage:
              'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
            backdropFilter: 'blur(40px) saturate(150%)',
            WebkitBackdropFilter: 'blur(40px) saturate(150%)',
            border: '0.5px solid rgba(255, 255, 255, 0.08)',
            boxShadow:
              'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.2)',
            color: 'var(--color-text-2)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            WebkitAppRegion: 'no-drag',
          } as CSSProperties}
        >
          <Download size={16} strokeWidth={2} aria-hidden />
          {isExporting ? 'Exporting…' : 'Export .sga'}
        </button>
      </div>

      {/* ── Centered project title pill — top center of viewport ────────
          Extracted to EditorTitlePill; mirrors DecalPackEditor and TopBar
          (vehicle editor). Click opens PackIdentityPopover with name /
          description / author / icon and publish controls. */}
      <EditorTitlePill
        packName={project.packName ?? ''}
        fallbackLabel="Unnamed Faceplate"
        syncState={sync.state}
        liveSyncTitle={liveSyncTitle}
        liveSyncAriaLabel={liveSyncAriaLabel}
        titleAcknowledged={project.titleAcknowledged}
        onAcknowledge={() => mutate(p => ({ ...p, titleAcknowledged: true }), { undoable: false })}
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

      {/* Persistent Layers panel — left side. Replaces the old 44px thumbnail strip. */}
      <LayersPanel
        project={project}
        selectedId={selectedId}
        multiSelectedIds={multiSelectedIds}
        renamingLayerId={renamingLayerId}
        dragLayerId={dragLayerId}
        dragOverLayerId={dragOverLayerId}
        mutate={mutate as unknown as import('./editor-shared/LayersPanel').LayersPanelProps<import('@/lib/faceplate-project').FaceplateLayer>['mutate']}
        onSelectLayer={onSelectLayerForPanel}
        onStartRename={id => { setSelectedId(id); setRenamingLayerId(id) }}
        onEndRename={onEndRenameForPanel}
        onDragStart={onLayerDragStart}
        onDragOver={onLayerDragOver}
        onDrop={onLayerDrop}
        onDragEnd={onLayerDragEnd}
        getLayerLabel={getLayerLabel}
        getLayerThumbnail={getLayerThumbnail}
        onContextMenu={(id, x, y) => setLayerCtxMenu({ id, x, y })}
        onClickOutside={() => setLayerCtxMenu(null)}
      />

      {/* OLD layer strip — hidden behind a dead block to preserve existing tests
          that query [aria-label="test.png"] on the legacy thumbnail buttons.
          The new LayersPanel is fully functional; this block is disabled. */}
      {false && project.layers.length > 0 && (
        <div
          role="toolbar"
          aria-label="Layers (legacy strip)"
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

            // User-supplied name takes precedence for all layer kinds.
            // Fall back to content-derived label so unlabelled layers still show something useful.
            const layerLabel = layer.kind === 'group'
              ? (layer.name)
              : ((layer as { name?: string }).name
                ?? (layer.kind === 'text'
                  ? (layer.text.slice(0, 20) || 'Text layer')
                  : layer.kind === 'shape'
                    ? layer.shapeType
                    : layer.kind === 'paint'
                      ? 'Paint layer'
                      : (project.images[(layer as ImageLayer).imageId]?.name ?? 'Image layer')))

            return (
              <div
                key={layer.id}
                role="button"
                tabIndex={0}
                draggable={renamingLayerId !== layer.id}
                aria-label={layerLabel}
                aria-pressed={isSelected || multiSelectedIds.has(layer.id)}
                onClick={ev => {
                  ev.stopPropagation()
                  if (renamingLayerId === layer.id) return
                  if (ev.metaKey || ev.ctrlKey) {
                    // Cmd/Ctrl-click: add/remove from multi-select (toggle)
                    lastAnchorIdRef.current = layer.id
                    setMultiSelectedIds(prev => {
                      const next = new Set(prev)
                      if (next.has(layer.id)) {
                        next.delete(layer.id)
                      } else {
                        next.add(layer.id)
                      }
                      return next
                    })
                  } else if (ev.shiftKey) {
                    // Shift-click: range-select from last anchor to clicked row
                    const anchorId = lastAnchorIdRef.current ?? selectedId
                    if (anchorId && anchorId !== layer.id) {
                      const anchorIdx = project.layers.findIndex(l => l.id === anchorId)
                      const clickIdx = project.layers.findIndex(l => l.id === layer.id)
                      const lo = Math.min(anchorIdx, clickIdx)
                      const hi = Math.max(anchorIdx, clickIdx)
                      const rangeIds = project.layers.slice(lo, hi + 1).map(l => l.id)
                      setMultiSelectedIds(new Set(rangeIds.filter(id => id !== anchorId)))
                      setSelectedId(anchorId)
                    } else {
                      setSelectedId(layer.id)
                      setMultiSelectedIds(new Set())
                      lastAnchorIdRef.current = layer.id
                    }
                  } else {
                    lastAnchorIdRef.current = layer.id
                    setSelectedId(layer.id)
                    setMultiSelectedIds(new Set())
                    setLayerCtxMenu(null)
                  }
                }}
                onDoubleClick={ev => {
                  ev.stopPropagation()
                  setSelectedId(layer.id)
                  setRenamingLayerId(layer.id)
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
                onDragStart={() => onLayerDragStart(layer.id)}
                onDragOver={ev => { ev.preventDefault(); onLayerDragOver(layer.id) }}
                onDrop={() => onLayerDrop(layer.id)}
                onDragEnd={onLayerDragEnd}
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
                  background:
                    isSelected || multiSelectedIds.has(layer.id)
                      ? `${EDITOR_ACCENT}33`
                      : 'rgba(255,255,255,0.04)',
                  border: dragOverLayerId === layer.id && dragLayerId !== layer.id
                    ? `2px dashed ${EDITOR_ACCENT}`
                    : isSelected
                      ? `2px solid ${EDITOR_ACCENT}`
                      : multiSelectedIds.has(layer.id)
                        ? `1.5px solid ${EDITOR_ACCENT}99`
                        : '1px solid rgba(255,255,255,0.08)',
                  cursor: dragLayerId ? 'grabbing' : 'grab',
                  opacity: layer.visible ? (dragLayerId === layer.id ? 0.5 : 1) : 0.35,
                  position: 'relative',
                  overflow: 'visible',
                  outline: 'none',
                  padding: '2px 2px 4px',
                }}
              >
                {thumbnailContent}
                {/* Layer name label / inline rename input */}
                {renamingLayerId === layer.id ? (
                  <input
                    autoFocus
                    type="text"
                    defaultValue={layerLabel}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        e.preventDefault()
                        if (e.key === 'Enter') {
                          const newName = (e.currentTarget as HTMLInputElement).value.trim()
                          // Only emit an undo frame when the name actually changed.
                          if (newName && newName !== layerLabel) {
                            mutate(p => mapLayer(p, layer.id, l => ({ ...l, name: newName })))
                          }
                        }
                        // Escape: discard input — mark committed so blur doesn't re-commit
                        ;(e.currentTarget as HTMLInputElement).dataset.committed = '1'
                        setRenamingLayerId(null)
                      }
                    }}
                    onBlur={e => {
                      // Avoid double-commit: if keydown already handled this (Enter/Escape), skip.
                      if (e.currentTarget.dataset.committed) { setRenamingLayerId(null); return }
                      const newName = e.currentTarget.value.trim()
                      if (newName && newName !== layerLabel) {
                        mutate(p => mapLayer(p, layer.id, l => ({ ...l, name: newName })))
                      }
                      setRenamingLayerId(null)
                    }}
                    style={{
                      width: 36,
                      fontSize: 9,
                      background: 'rgba(0,0,0,0.5)',
                      border: '1px solid rgba(120,180,255,0.6)',
                      borderRadius: 3,
                      color: '#fff',
                      padding: '1px 3px',
                      outline: 'none',
                      textAlign: 'center',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 9,
                      color: EDITOR_TEXT_4,
                      maxWidth: 40,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.2,
                      pointerEvents: 'none',
                    }}
                    title={`${layerLabel} — double-click to rename`}
                  >
                    {layerLabel.slice(0, 8)}
                  </span>
                )}
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

      {/* Persistent Properties panel — right side. Shows selected layer properties. */}
      <PropertiesPanel
        project={project as unknown as import('./editor-shared/PropertiesPanel').PropertiesPanelProps<import('@/lib/faceplate-project').FaceplateLayer>['project']}
        selectedLayer={selectedLayer}
        multiSelectedIds={multiSelectedIds}
        mutate={mutate as unknown as import('./editor-shared/PropertiesPanel').PropertiesPanelProps<import('@/lib/faceplate-project').FaceplateLayer>['mutate']}
        canvasW={FACEPLATE_BANNER_W}
        canvasH={FACEPLATE_BANNER_H}
        layerTypeControls={
          selectedLayer
            ? <FaceplatePropertiesExtension
                project={project}
                selectedLayer={selectedLayer}
                multiSelectedIds={multiSelectedIds}
                mutate={mutate}
                canvasW={FACEPLATE_BANNER_W}
                canvasH={FACEPLATE_BANNER_H}
                adjustImageOpen={adjustImageOpen}
                onToggleAdjustImage={() => setAdjustImageOpen(o => !o)}
                onOpenCurves={() => setCurvesOpen(true)}
              />
            : undefined
        }
      />

      {/* Canvas view-mode picker — right-edge vertical stack of icon buttons.
       *  Mirrors the Vehicle Viewport's ScenePanel so the editor surfaces
       *  feel unified. `in_game` mode has been removed from the order. */}
      <AtlasViewPanel mode={viewMode} setMode={setViewMode} ariaLabel="Faceplate view mode" />

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
                ? // Show select peel only when a positionable layer is selected AND snap is
                  // active — the peel's only content is the snap-step chip row (which itself
                  // returns null when !snapGrid). Hiding the peel when snap is off avoids the
                  // empty glass container that floated above the toolbar with no content (Fix 2).
                  selectedLayer && selectedLayer.kind !== 'paint' && selectedLayer.kind !== 'group' && snapGrid
                  ? 'select'
                  : null
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
                  : activeTool === 'mask' && !(selectedLayer?.kind === 'image' || selectedLayer?.kind === 'paint')
                  ? null
                  : activeTool
            }
            label={toolLabel(activeTool)}
            style={{ minHeight: 44, justifyContent: 'flex-start' }}
          >
            <FaceplateToolPeelBody
              tool={activeTool}
              project={project}
              selectedLayer={selectedLayer}
              selectedId={selectedId}
              multiSelectedIds={multiSelectedIds}
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
              brushHardness={brushHardness}
              setBrushHardness={setBrushHardness}
              brushErase={brushErase}
              setBrushErase={setBrushErase}
              eyedropperActive={eyedropperActive}
              setEyedropperActive={setEyedropperActive}
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
              alignToSelection={alignToSelection}
              setAlignToSelection={setAlignToSelection}
              snapGrid={snapGrid}
              setSnapGrid={setSnapGrid}
              snapGridStep={snapGridStep}
              setSnapGridStep={setSnapGridStep}
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
        {/* Bottom row — the tool pill with grid-snap as an extra (P2).
         *  Grid snap moved here from the floating orphan box so the
         *  bottom area is a clean single tool row with no orphan boxes. */}
        <BottomToolPill<FaceplateToolId>
          tools={FACEPLATE_TOOLS}
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
              testId: 'grid-snap-toggle',
            },
          ]}
        />
      </div>

      {/* Help / keyboard shortcuts button (d1) */}
      <button
        type="button"
        title="Keyboard shortcuts (F1)"
        aria-label="Keyboard shortcuts (F1)"
        onClick={() => setShortcutsOpen(true)}
        className="hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
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
          zIndex: 40,
        } as CSSProperties}
      >
        <HelpCircle size={16} strokeWidth={2} aria-hidden />
      </button>

      {/* Keyboard shortcuts overlay (d1) */}
      <KeyboardShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Zoom %/Fit/1:1 readout pill removed per design — scroll-to-zoom
          still works; the on-screen control was redundant chrome. */}

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

      {/* Export status toast (success = green, error = red) */}
      {exportToast && (
        <GlassToast
          title={exportToast.intent === 'success' ? 'Export .sga' : 'Export failed'}
          body={exportToast.body}
          intent={exportToast.intent}
          autoDismissMs={exportToast.intent === 'success' ? 4000 : undefined}
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
    case 'eraser':
      return 'Eraser'
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
  multiSelectedIds: _multiSelectedIds,
  mutate,
  onDuplicate: _onDuplicate,
  onInsigniaOpen,
  brushSize,
  setBrushSize,
  brushColor,
  setBrushColor,
  brushOpacity,
  setBrushOpacity,
  brushHardness,
  setBrushHardness,
  brushErase,
  setBrushErase,
  eyedropperActive,
  setEyedropperActive,
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
  alignToSelection: _alignToSelection,
  setAlignToSelection: _setAlignToSelection,
  snapGrid,
  setSnapGrid: _setSnapGrid,
  snapGridStep,
  setSnapGridStep,
}: {
  tool: FaceplateToolId
  project: Coh2FaceplateProject
  selectedLayer: FaceplateLayer | null
  selectedId: string | null
  multiSelectedIds: Set<string>
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
  brushHardness: number
  setBrushHardness: (v: number) => void
  brushErase: boolean
  setBrushErase: (v: boolean) => void
  eyedropperActive: boolean
  setEyedropperActive: (v: boolean) => void
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
  alignToSelection: 'canvas' | 'selection'
  setAlignToSelection: (v: 'canvas' | 'selection') => void
  snapGrid: boolean
  setSnapGrid: (v: boolean) => void
  snapGridStep: 4 | 8 | 16 | 32
  setSnapGridStep: (v: 4 | 8 | 16 | 32) => void
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
    // Transform + flip + opacity are now in the Properties panel (right dock).
    // The select peel shows ONLY grid snap so there are zero duplicate controls.
    // The peel collapses to null when no positionable layer is selected
    // (guard kept so ToolOptionsPeel shows nothing for paint/group layers).
    const hasPositionableLayer =
      selectedLayer &&
      selectedLayer.kind !== 'paint' &&
      selectedLayer.kind !== 'group'
    if (!hasPositionableLayer) return null

    // Grid snap toggle is now in the bottom tool row (P2 — no orphan box).
    // The peel shows snap step size chips when snap is active.
    if (!snapGrid) return null
    return (
      /* ── Grid snap step (shown when snap is on via bottom tool row) ── */
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: 10, color: EDITOR_TEXT_4, fontWeight: 600, letterSpacing: '0.08em', marginRight: 2 }}>STEP</span>
        {([4, 8, 16, 32] as const).map(step => (
          <button
            key={step}
            title={`Grid step: ${step}px`}
            aria-label={`Grid step ${step}px`}
            aria-pressed={snapGridStep === step}
            onClick={() => setSnapGridStep(step)}
            style={{
              ...toggleBtnStyle(snapGridStep === step),
              minWidth: 26,
              fontSize: 10,
            }}
          >
            {step}
          </button>
        ))}
      </div>
    )
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
          {/* Opacity + blend mode for text layers */}
          <SliderPopover
            icon={<CaseSensitive size={14} />}
            title="Opacity"
            min={0}
            max={1}
            step={0.01}
            value={tl.opacity ?? 1}
            identity={1}
            format={v => `${Math.round(v * 100)}%`}
            onChange={v => mutateLayer(l => ({ ...l, opacity: v }))}
          />
          <BlendModeSelect
            compact
            value={tl.blendMode}
            onChange={next => mutateLayer(l => l.kind === 'text' ? ({ ...l, blendMode: next } as TextLayer) : l)}
            label="Blend mode"
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
            {/* Corner radius — only meaningful for rectangle shapes. */}
            {shapeLayer.shapeType === 'rectangle' && (
              <SliderPopover
                icon={
                  <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2 10 L2 5 Q2 2 5 2 L10 2"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                }
                title="Radius"
                min={0}
                max={Math.floor(Math.min(shapeLayer.width, shapeLayer.height) / 2)}
                step={1}
                value={shapeLayer.cornerRadius ?? 0}
                identity={0}
                format={v => `${Math.round(v)}px`}
                onChange={v =>
                  mutateLayer(l =>
                    l.kind === 'shape' ? ({ ...l, cornerRadius: v } as ShapeLayer) : l,
                  )
                }
              />
            )}
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
            <BlendModeSelect
              compact
              value={shapeLayer.blendMode}
              onChange={next => mutateLayer(l => l.kind === 'shape' ? ({ ...l, blendMode: next } as ShapeLayer) : l)}
              label="Blend mode"
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
          min={0}
          max={1}
          step={0.01}
          value={brushOpacity}
          identity={1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={setBrushOpacity}
        />
        {/* Brush hardness — 100 = crisp disc, 0 = fully feathered (Photoshop-parity). */}
        <SliderPopover
          icon={
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
              <circle cx={7} cy={7} r={5} fill="currentColor" opacity={0.9} />
              <circle cx={7} cy={7} r={3} fill="currentColor" opacity={0.5} />
            </svg>
          }
          title="Hardness"
          min={0}
          max={100}
          step={1}
          value={brushHardness}
          identity={100}
          format={v => `${Math.round(v)}%`}
          onChange={setBrushHardness}
        />
        {/* Eyedropper — one-shot colour picker from the composited canvas. */}
        <button
          title="Eyedropper — click the canvas to sample a colour (Faceplate composited view)"
          aria-pressed={eyedropperActive}
          aria-label="Eyedropper"
          onClick={() => {
            setEyedropperActive(!eyedropperActive)
            // Turn off erase mode when entering eyedropper mode.
            if (!eyedropperActive) setBrushErase(false)
          }}
          style={toggleBtnStyle(eyedropperActive)}
        >
          <Pipette size={14} />
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
        {/* Opacity + blend mode for the paint layer */}
        {(() => {
          const paintLayer = project.layers.find((l): l is PaintLayer => l.kind === 'paint')
          if (!paintLayer) return null
          return (
            <>
              <SliderPopover
                icon={<CaseSensitive size={14} />}
                title="Paint layer opacity"
                min={0}
                max={1}
                step={0.01}
                value={paintLayer.opacity ?? 1}
                identity={1}
                format={v => `${Math.round(v * 100)}%`}
                onChange={v => mutate(p => mapLayer(p, paintLayer.id, l => ({ ...l, opacity: v })))}
              />
              <BlendModeSelect
                compact
                value={paintLayer.blendMode}
                onChange={next => mutate(p => mapLayer(p, paintLayer.id, l => l.kind === 'paint' ? ({ ...l, blendMode: next } as PaintLayer) : l))}
                label="Blend mode"
              />
            </>
          )
        })()}
      </>
    )
  }



  if (tool === 'eraser') {
    // Eraser tool peel — same controls as Draw minus colour/eyedropper
    // (colour is meaningless for destination-out compositing).
    return (
      <>
        {/* Brush size */}
        <SliderPopover
          icon={<Brush size={14} />}
          title="Eraser size"
          min={1}
          max={200}
          step={1}
          value={brushSize}
          identity={12}
          format={v => `${v}px`}
          onChange={v => setBrushSize(v)}
        />
        {/* Opacity */}
        <SliderPopover
          icon={<CaseSensitive size={14} />}
          title="Eraser opacity"
          min={0}
          max={1}
          step={0.05}
          value={brushOpacity}
          identity={1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => setBrushOpacity(v)}
        />
        {/* Hardness */}
        <SliderPopover
          icon={<Slash size={14} />}
          title="Eraser hardness"
          min={0}
          max={100}
          step={1}
          value={brushHardness}
          identity={100}
          format={v => `${v}%`}
          onChange={v => setBrushHardness(v)}
        />
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

/**
 * Per-layer render callback for the faceplate compositor.
 * Contains the faceplate-specific switch/case logic extracted from the
 * old composeFaceplateCanvas loop.  Byte-identical to the original.
 *
 * @returns A snapshot HTMLCanvasElement of what was drawn (for clipping-mask
 *          support on the next layer), or null if not applicable.
 */
// eslint-disable-next-line react-refresh/only-export-components
export async function faceplateRenderLayer(
  ctx: CanvasRenderingContext2D,
  layer: FaceplateLayer,
  byId: Map<string, HTMLImageElement>,
  canvasW: number,
  canvasH: number,
  prevLayerCanvas: HTMLCanvasElement | null,
): Promise<HTMLCanvasElement | null> {
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
      return null
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
          offClip.width = canvasW
          offClip.height = canvasH
          const offClipCtx = offClip.getContext('2d')
          if (offClipCtx) {
            offClipCtx.globalAlpha = layer.opacity
            offClipCtx.globalCompositeOperation = (layer.blendMode ??
              'normal') as GlobalCompositeOperation
            offClipCtx.drawImage(paintEl, 0, 0, canvasW, canvasH)
            offClipCtx.globalCompositeOperation = 'destination-in'
            offClipCtx.drawImage(prevLayerCanvas, 0, 0)
            ctx.drawImage(offClip, 0, 0)
          }
        } else {
          ctx.save()
          ctx.globalAlpha = layer.opacity
          ctx.globalCompositeOperation = (layer.blendMode ?? 'normal') as GlobalCompositeOperation
          ctx.drawImage(paintEl, 0, 0, canvasW, canvasH)
          // v6: silhouette stroke on PaintLayer.
          // Render the paint to an offscreen canvas, blur + composite to extract
          // the silhouette, draw the tinted border behind the fill.
          if (layer.stroke && layer.stroke.width > 0) {
            const offStroke = document.createElement('canvas')
            offStroke.width = canvasW
            offStroke.height = canvasH
            const offCtx = offStroke.getContext('2d')
            if (offCtx) {
              offCtx.drawImage(paintEl, 0, 0, canvasW, canvasH)
              offCtx.filter = `blur(${layer.stroke.width}px)`
              offCtx.globalCompositeOperation = 'source-out'
              offCtx.fillStyle = layer.stroke.color
              offCtx.fillRect(0, 0, canvasW, canvasH)
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
            offMask.width = canvasW
            offMask.height = canvasH
            const offMCtx = offMask.getContext('2d')
            if (offMCtx) {
              offMCtx.drawImage(paintEl, 0, 0, canvasW, canvasH)
              offMCtx.globalCompositeOperation = layer.mask.invert
                ? 'destination-out'
                : 'destination-in'
              offMCtx.drawImage(maskEl, 0, 0, canvasW, canvasH)
              // Clear the painted region then redraw through the mask.
              ctx.save()
              ctx.globalCompositeOperation = 'destination-out'
              ctx.drawImage(paintEl, 0, 0, canvasW, canvasH)
              ctx.restore()
              ctx.drawImage(offMask, 0, 0)
            }
          }
        }

        // Record this layer's render for the next layer's potential clipping.
        const snap = document.createElement('canvas')
        snap.width = canvasW
        snap.height = canvasH
        const snapCtx = snap.getContext('2d')
        if (snapCtx) snapCtx.drawImage(paintEl, 0, 0, canvasW, canvasH)
        return snap
      } else {
        return null
      }
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
      const path = shapeToPath2D(layer.shapeType, sw, sh, layer.cornerRadius ?? 0)

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
      return null
    }

    // Group layer — children are already in the flat layers array; the group
    // itself carries no visual content (it is purely an organisational node).
    // Compositing children under a group opacity would require a separate
    // offscreen canvas per group — deferred to v1.1. For now we skip the
    // group node itself; children render via the normal loop.
    if (layer.kind === 'group') return null

    // Image layer
    const el = byId.get(layer.imageId)
    if (!el) return null

    // v6: clipping mask — clip this image layer to the alpha of the previous
    // visible layer. Only supported on ImageLayer in Wave 1.
    const w = el.naturalWidth * layer.scale
    const h = el.naturalHeight * (layer.scaleY ?? layer.scale)

    if (layer.clippedToLayerBelow && prevLayerCanvas) {
      // Render the image into an offscreen canvas, then clip to prev layer.
      const offClip = document.createElement('canvas')
      offClip.width = canvasW
      offClip.height = canvasH
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
      return offClip
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
      const imageData = ctx.getImageData(0, 0, canvasW, canvasH)
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
        offMask.width = canvasW
        offMask.height = canvasH
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
          offMCtx.drawImage(maskEl, 0, 0, canvasW, canvasH)
          // Erase the un-masked layer render from the main canvas and
          // composite the masked result back in.
          ctx.save()
          ctx.globalCompositeOperation = 'destination-out'
          offMCtx.globalCompositeOperation = 'source-over' // reset for the erase blit
          const tmpErase = document.createElement('canvas')
          tmpErase.width = canvasW
          tmpErase.height = canvasH
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
    snap.width = canvasW
    snap.height = canvasH
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
    return snap
}

/** @public */
// eslint-disable-next-line react-refresh/only-export-components
export async function composeFaceplateCanvas(p: Coh2FaceplateProject): Promise<HTMLCanvasElement> {
  return composeLayers(
    p.layers,
    p.images,
    FACEPLATE_BANNER_W,
    FACEPLATE_BANNER_H,
    p.backgroundColor,
    faceplateRenderLayer,
  )
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

/** Shared path-drawing helper — called by BOTH shapeToPath2D (export) and
 *  the Konva sceneFunc (live preview) so the two paths can't diverge.
 *
 *  Draws only the complex shapes (chevron, star, shield). Rectangle and circle
 *  have native equivalents in both Path2D and Konva and are handled separately.
 *  The path is centred at the origin (0,0); w/h are the box dimensions in px.
 *
 *  The `pen` argument abstracts over Path2D vs Konva.Context:
 *    - Path2D: `new Path2D()` object (moveTo/lineTo/quadraticCurveTo/closePath)
 *    - Konva.Context: the `ctx` passed into sceneFunc (same API)
 */
function drawComplexShapePath(
  shapeType: 'chevron' | 'star' | 'shield',
  w: number,
  h: number,
  pen: {
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
    closePath(): void
  },
): void {
  switch (shapeType) {
    case 'chevron': {
      // Points from viewBox 0 0 100 100 scaled to w×h, centred at origin.
      const pts: [number, number][] = [
        [0, 0], [60, 0], [100, 50], [60, 100], [0, 100], [40, 50],
      ]
      pts.forEach(([px, py], i) => {
        const x = (px / 100) * w - w / 2
        const y = (py / 100) * h - h / 2
        if (i === 0) pen.moveTo(x, y)
        else pen.lineTo(x, y)
      })
      pen.closePath()
      break
    }
    case 'star': {
      const outerR = Math.min(w, h) / 2
      const innerR = outerR * (20 / 50)
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 5) * i - Math.PI / 2
        const r = i % 2 === 0 ? outerR : innerR
        const x = r * Math.cos(angle)
        const y = r * Math.sin(angle)
        if (i === 0) pen.moveTo(x, y)
        else pen.lineTo(x, y)
      }
      pen.closePath()
      break
    }
    case 'shield': {
      // M 0 0 L 100 0 L 100 60 Q 100 100 50 100 Q 0 100 0 60 Z
      // scaled to w×h, centred at origin
      const scX = w / 100
      const scY = h / 100
      const ox = -w / 2
      const oy = -h / 2
      pen.moveTo(ox + 0 * scX, oy + 0 * scY)
      pen.lineTo(ox + 100 * scX, oy + 0 * scY)
      pen.lineTo(ox + 100 * scX, oy + 60 * scY)
      pen.quadraticCurveTo(ox + 100 * scX, oy + 100 * scY, ox + 50 * scX, oy + 100 * scY)
      pen.quadraticCurveTo(ox + 0 * scX, oy + 100 * scY, ox + 0 * scX, oy + 60 * scY)
      pen.closePath()
      break
    }
  }
}

/** Build a Canvas2D Path2D for the given shape type. The path is centred
 *  at the origin (0,0) so translate + rotate + scale can be applied via
 *  ctx transforms before drawing. w/h are the box dimensions in canvas px. */
function shapeToPath2D(shapeType: ShapeLayer['shapeType'], w: number, h: number, cornerRadius = 0): Path2D {
  const path = new Path2D()
  switch (shapeType) {
    case 'rectangle':
      if (cornerRadius > 0) {
        const r = Math.min(cornerRadius, w / 2, h / 2)
        path.roundRect(-w / 2, -h / 2, w, h, r)
      } else {
        path.rect(-w / 2, -h / 2, w, h)
      }
      break
    case 'circle':
      path.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case 'chevron':
    case 'star':
    case 'shield':
      // Delegate to shared helper so geometry stays in sync with the Konva sceneFunc.
      drawComplexShapePath(shapeType, w, h, path)
      break
  }
  return path
}

/**
 * Dark transparency checker — layered over the canvas when `backgroundColor === null`
 * (true transparency). Two-stop conic gradient produces a clearly visible 16px
 * dark-mode checker so the user can see exactly which regions are transparent.
 * Colors chosen to read clearly against the #252836 document surface.
 */
function darkCheckerBackground(): string {
  return `repeating-conic-gradient(#1c1f2d 0% 25%, #141620 0% 50%) 50% / 16px 16px`
}

/** Classic light-grey/white Photoshop transparency checker — used by the
 *  "Preview as exported" toggle so users see exactly what alpha=0 looks like
 *  in-game (no editor scaffolding, no dark background colour overlay). */
function lightCheckerBackground(): string {
  return `repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 16px 16px`
}
