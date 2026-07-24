/**
 * VehicleTextureEditor — full-screen 2D editor for a vehicle's in-game
 * diffuse texture atlas (A3).
 *
 * The "Edit texture" pill used to merely toggle the cramped Decals SIDE
 * panel. Users expected a proper editor screen — the same full-screen,
 * back-button experience as the decal-pack / faceplate editors — showing
 * the actual vehicle texture so they can paint directly on it.
 *
 * SHELL PARITY (the user's request: "the edit-texture editor doesn't look like
 * the decal or faceplate editor at all — it's not using the tools menu"). This
 * surface now reuses the SAME editor-primitives shell those editors use:
 *   • a glass back-pill top-left (returns to the 3D view — NOT the start
 *     screen, so it stays an ArrowLeft rather than the Home button),
 *   • a centred title pill top-centre,
 *   • the bottom-centre {@link BottomToolPill} "tools menu" (Draw / Erase /
 *     Pick) with a {@link ToolOptionsPeel} that lifts the active tool's
 *     options above it,
 * instead of the old bespoke top bar + right-rail BrushPanel.
 *
 * The painting pipeline is unchanged:
 *   • It DISPLAYS the live composited 2048² atlas (`overlayCanvas`) that
 *     already drives the 3D viewport, so the user sees exactly the
 *     in-game texture (base diffuse + camo + decals).
 *   • Freehand paint goes onto the editor-owned `baseDiffuse` canvas via
 *     the shared brush helpers (lib/brush.ts), then `onComposite()` asks
 *     the Editor to re-composite base+decals into the overlay and re-upload
 *     to the GPU — so paint shows up live on BOTH this 2D view and the 3D
 *     model behind it.
 *   • Stroke lifecycle (undo snapshot + persistence) is delegated back to
 *     the Editor through callbacks, reusing the exact same paths the
 *     in-viewport brush uses. No new persistence logic lives here.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowLeft,
  Brush,
  Eraser,
  Pipette,
  Grid3x3,
  FlipHorizontal2,
  Eraser as ClearIcon,
  RotateCcw,
  RotateCw,
  Maximize2,
  Percent,
  HelpCircle,
} from 'lucide-react'
import BottomToolPill, { type ToolDef } from './editor-primitives/BottomToolPill'
import ToolOptionsPeel from './editor-primitives/ToolOptionsPeel'
import KeyboardShortcutsOverlay from './editor-primitives/KeyboardShortcutsOverlay'
import { EDITOR_ACCENT, EDITOR_TEXT_2, EDITOR_TEXT_3 } from './editor-primitives/tokens'
import type { ShortcutGroup } from './editor-primitives/keyboard-shortcuts-data'
import {
  paintBrushDab,
  paintBrushSegment,
  samplePixel,
  type BrushSettings,
} from '@/lib/brush'
import { usePanZoom, ZOOM_MIN, ZOOM_MAX, fitScale } from '@/lib/use-pan-zoom'
import { PaintHistory, type PaintSnapshot } from '@/lib/paint-history'

/** Shortcuts specific to the texture editor surface. */
const VTE_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Edit Texture',
    rows: [
      ['Esc', 'Back to 3D view'],
      ['F1 / ?', 'Show this help'],
      ['Ctrl+Z', 'Undo stroke'],
      ['Ctrl+Shift+Z', 'Redo stroke'],
      ['[ / ]', 'Decrease / increase brush size'],
      ['Ctrl+0', 'Fit texture to window'],
      ['Ctrl+1', '100 % zoom'],
      ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
      ['Space + drag', 'Pan'],
      ['Middle-drag', 'Pan'],
    ],
  },
]

const ATLAS = 2048
// Internal resolution of the on-screen canvas. CSS scales it to a square
// that fits the viewport; 1024 keeps it crisp while being cheap to blit.
const VIEW = 1024

// Tool palette shown in the BottomToolPill. The "Pick" tool is a one-shot
// eyedropper — selecting it samples the next canvas click then snaps back to
// Draw, so it never sticks the user in a sampling mode.
type TexTool = 'brush' | 'erase' | 'pick'

const TOOLS: readonly ToolDef<TexTool>[] = [
  { id: 'brush', icon: <Brush size={18} strokeWidth={2} />, label: 'Draw' },
  { id: 'erase', icon: <Eraser size={18} strokeWidth={2} />, label: 'Erase' },
  { id: 'pick', icon: <Pipette size={18} strokeWidth={2} />, label: 'Pick' },
]

const SWATCHES = [
  '#7a8a4e', '#4a5c28', '#c8aa6a', '#3e2a12', '#e0dcd4', '#2a3e1a',
  '#6a4a28', '#8a2a1a', '#c8a020', '#1a1a1a', '#d8843a', '#2c3c22',
]

interface Props {
  /** Live composited atlas (base diffuse + camo + decals). Display source. */
  overlayCanvas: HTMLCanvasElement
  /** Editor-owned diffuse layer — the paint target. */
  baseDiffuse: HTMLCanvasElement | null
  /** Pristine vanilla diffuse — used by erase mode to restore pixels. */
  vanilla: HTMLCanvasElement | null
  /** Bumps whenever the overlay changes (camo/decal/paint) → re-blit. */
  version: number
  brush: BrushSettings
  setBrush: (s: BrushSettings) => void
  /** Snapshot undo history before a stroke begins. */
  onStrokeBegin: () => void
  /** Re-composite base+decals into the overlay and re-upload to the GPU. */
  onComposite: () => void
  /** Persist the painted base diffuse to the project (stroke end). */
  onStrokeEnd: () => void
  /** Wipe paint back to vanilla + clear persisted custom diffuse. */
  onClear: () => void
  /** Close the editor and return to the 3D view. */
  onBack: () => void
  /** Undo the last paint stroke. */
  onUndo: () => void
  /** Whether there is anything to undo. */
  canUndo: boolean
  /** Redo the most-recently-undone paint stroke. */
  onRedo: () => void
  /** Whether there is anything to redo. */
  canRedo: boolean
  vehicleName: string
  /**
   * Flat UV line segments [x0,y0,x1,y1,…] (each value 0..1) for the vehicle's
   * body meshes. Drawn as an "unwrap" wireframe overlay so the painter can see
   * which atlas region maps to the hull/deck/etc. A UV vertex (x, y) maps to
   * canvas pixel (x·VIEW, (1-y)·VIEW). null when the model has no body UVs.
   */
  uvLines?: Float32Array | null
}

export default function VehicleTextureEditor(p: Props) {
  const displayRef = useRef<HTMLCanvasElement | null>(null)
  // Container ref for usePanZoom wheel handler (zoom the atlas).
  const atlasWrapRef = useRef<HTMLDivElement | null>(null)
  // Active tool drives both painting and the brush mode. 'brush'→paint,
  // 'erase'→erase, 'pick'→one-shot eyedropper.
  const [tool, setTool] = useState<TexTool>('brush')
  // R4: the UV guide is ON by default — painting a blind 2048² atlas is hostile,
  // so we show where each hull/deck panel maps out of the box. It's render-only
  // (drawn into the on-screen canvas in blit(), never into p.overlayCanvas or
  // the paint target), so it NEVER reaches exports / Live Sync — see blit().
  const [showUv, setShowUv] = useState(true)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const paintingRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)

  // ── R4: local, memory-bounded pixel undo/redo for the paint canvas ────────
  // A self-contained snapshot ring (lib/paint-history.ts) records the paint
  // canvas BEFORE each stroke, so undo/redo restore pixels instantly and
  // entirely within this editor — no PNG round-trip, no project-history race.
  // Bounded by 128 MiB / 25 frames (≈8 full 2048² snapshots) so a long session
  // can't balloon memory. This is editor-state only: it never changes the
  // export/output format or Live Sync (those read the composited overlay).
  const historyRef = useRef<PaintHistory>(new PaintHistory())
  // Mirror the ring's canUndo/canRedo into render state so the toolbar buttons
  // re-render on every push/undo/redo/clear (refs alone don't trigger renders).
  const [localHist, setLocalHist] = useState({ canUndo: false, canRedo: false })
  const syncHistoryFlags = useCallback(() => {
    const h = historyRef.current
    setLocalHist({ canUndo: h.canUndo(), canRedo: h.canRedo() })
  }, [])
  // Latest-blit ref — assigned once blit() is defined below. Callbacks here
  // (undo/redo restore) call blitRef.current() to avoid a declaration-order or
  // stale-closure hazard. Starts as a no-op until the first assignment.
  const blitRef = useRef<() => void>(() => {})

  // Capture the full paint canvas as an undo snapshot.
  const capturePaintSnapshot = useCallback(
    (label: string): PaintSnapshot | null => {
      const canvas = p.baseDiffuse
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return null
      try {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        return { data: img.data, width: canvas.width, height: canvas.height, label }
      } catch {
        // Tainted canvas — fall back to the project history path.
        return null
      }
    },
    [p.baseDiffuse],
  )

  // Apply a restored snapshot back onto the paint canvas + re-composite so the
  // 2D view and the 3D model behind it both update. Then persist (stroke-end
  // path) so a reload keeps the reverted pixels.
  const applyPaintSnapshot = useCallback(
    (snap: PaintSnapshot) => {
      const canvas = p.baseDiffuse
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      // `snap.data` is a Uint8ClampedArray whose backing buffer is typed as
      // ArrayBufferLike (may be SharedArrayBuffer under TS's DOM lib), while the
      // ImageData constructor's first overload demands a Uint8ClampedArray<ArrayBuffer>.
      // The runtime buffer is always a plain ArrayBuffer here, so narrow the type.
      const img = new ImageData(
        snap.data as Uint8ClampedArray<ArrayBuffer>,
        snap.width,
        snap.height,
      )
      ctx.putImageData(img, 0, 0)
      p.onComposite()
      blitRef.current?.()
      p.onStrokeEnd()
    },
    [p],
  )

  // Zoom/pan — wheel zooms the atlas; Space+drag or middle-drag pans.
  // Compute the initial fit synchronously using window dimensions (the
  // container is `position:fixed; inset:0` so window.inner* IS the container).
  // useState lazy initializer runs exactly once, so this never re-computes.
  // This eliminates the flash of an oversized 1024×1024 atlas that appeared
  // when initialScale=1 and a deferred fitToWindow() effect had to correct it.
  const [initFit] = useState(() => fitScale(window.innerWidth, window.innerHeight, VIEW, VIEW))
  const pz = usePanZoom({
    containerRef: atlasWrapRef,
    contentSize: { w: VIEW, h: VIEW },
    initialScale: initFit.scale,
    initialOffset: initFit.offset,
  })

  // Selecting a tool keeps the shared BrushSettings.mode in sync so the paint
  // helpers behave correctly. 'pick' leaves mode untouched (it samples, then
  // we snap back to 'brush' on the next click).
  const selectTool = useCallback(
    (id: TexTool) => {
      if (id === 'erase') p.setBrush({ ...p.brush, mode: 'erase' })
      else if (id === 'brush') p.setBrush({ ...p.brush, mode: 'paint' })
      setTool(id)
    },
    [p],
  )

  // Pre-render the UV wireframe once into an offscreen VIEW² canvas whenever
  // the line set changes, then we just drawImage() it during blit. Re-rasterizing
  // thousands of segments on every paint dab would be wasteful.
  const uvOverlay = useMemo(() => {
    const lines = p.uvLines
    if (!lines || lines.length < 4) return null
    const c = document.createElement('canvas')
    c.width = c.height = VIEW
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.lineWidth = 0.75
    ctx.strokeStyle = 'rgba(80, 220, 255, 0.55)'
    ctx.beginPath()
    for (let i = 0; i + 3 < lines.length; i += 4) {
      // UV (x, y) → canvas pixel (x·VIEW, (1-y)·VIEW): the diffuse is sampled
      // with flipY=true, so the V axis is already stored flipped upstream.
      ctx.moveTo(lines[i] * VIEW, (1 - lines[i + 1]) * VIEW)
      ctx.lineTo(lines[i + 2] * VIEW, (1 - lines[i + 3]) * VIEW)
    }
    ctx.stroke()
    return c
  }, [p.uvLines])

  // Blit the live overlay atlas into the on-screen canvas. Re-runs whenever
  // the overlay version bumps (paint dab, camo apply, decal change).
  const blit = useCallback(() => {
    const dst = displayRef.current
    if (!dst) return
    const ctx = dst.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, VIEW, VIEW)
    ctx.drawImage(p.overlayCanvas, 0, 0, ATLAS, ATLAS, 0, 0, VIEW, VIEW)
    if (showUv && uvOverlay) ctx.drawImage(uvOverlay, 0, 0)
  }, [p.overlayCanvas, showUv, uvOverlay])

  // Keep blitRef pointing at the current blit (declared as a ref above so the
  // undo/redo restore callbacks can call it despite being defined earlier).
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern: updated every render so restore callbacks always call the current blit
  blitRef.current = blit

  useEffect(() => {
    blit()
  }, [blit, p.version])

  // Map a pointer event to atlas (2048²) coordinates.
  const toAtlas = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const el = displayRef.current!
    const r = el.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width
    const ny = (e.clientY - r.top) / r.height
    return {
      x: Math.max(0, Math.min(ATLAS, nx * ATLAS)),
      y: Math.max(0, Math.min(ATLAS, ny * ATLAS)),
    }
  }, [])

  const baseCtx = useCallback(
    () => p.baseDiffuse?.getContext('2d') ?? null,
    [p.baseDiffuse],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Pan gestures (Space+drag or middle-button drag) must NOT begin a paint
      // stroke — the pan-zoom container handles them in the bubble phase.
      // Guard both button number and space-held state so neither produces a
      // paint dab, an undo frame, or a stuck paintingRef.
      if (e.button !== 0 || pz.isPanGesture(e)) return

      const { x, y } = toAtlas(e)
      // Eyedropper has priority — sample the live atlas under the cursor, then
      // snap back to the Draw tool so the user isn't stuck in pick mode.
      if (tool === 'pick') {
        const octx = p.overlayCanvas.getContext('2d')
        if (octx) {
          const c = samplePixel(octx, Math.round(x), Math.round(y))
          p.setBrush({ ...p.brush, color: c, mode: 'paint' })
        }
        setTool('brush')
        return
      }
      const ctx = baseCtx()
      if (!ctx) return
      // Record the PRE-stroke paint canvas locally (memory-bounded ring) so
      // undo/redo restore pixels instantly, then delegate to the project
      // history for cross-vehicle/decal state + persistence.
      const pre = capturePaintSnapshot(tool === 'erase' ? 'Erase' : 'Paint')
      if (pre) {
        historyRef.current.push(pre)
        syncHistoryFlags()
      }
      p.onStrokeBegin()
      paintBrushDab(ctx, x, y, p.brush, p.vanilla)
      lastPtRef.current = { x, y }
      paintingRef.current = true
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      p.onComposite()
      blit()
    },
    [toAtlas, tool, baseCtx, p, blit, pz, capturePaintSnapshot, syncHistoryFlags],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!paintingRef.current) return
      const ctx = baseCtx()
      if (!ctx) return
      const { x, y } = toAtlas(e)
      const last = lastPtRef.current ?? { x, y }
      paintBrushSegment(ctx, last.x, last.y, x, y, p.brush, p.vanilla)
      lastPtRef.current = { x, y }
      p.onComposite()
      blit()
    },
    [toAtlas, baseCtx, p, blit],
  )

  const endStroke = useCallback(() => {
    if (!paintingRef.current) return
    paintingRef.current = false
    lastPtRef.current = null
    p.onStrokeEnd()
  }, [p])

  // ── R4 undo / redo ─────────────────────────────────────────────────────────
  // Prefer the local pixel history (instant, conflict-free); fall back to the
  // project history (decal/cross-vehicle state) when the paint ring is empty.
  const canUndo = localHist.canUndo || p.canUndo
  const canRedo = localHist.canRedo || p.canRedo

  const doUndo = useCallback(() => {
    const h = historyRef.current
    if (h.canUndo()) {
      const live = capturePaintSnapshot(h.peekUndoLabel() ?? 'Paint')
      const snap = h.undo(live ?? undefined)
      if (snap) {
        applyPaintSnapshot(snap)
        syncHistoryFlags()
        return
      }
    }
    // Nothing local — defer to project history (decals, other vehicles).
    p.onUndo()
  }, [capturePaintSnapshot, applyPaintSnapshot, syncHistoryFlags, p])

  const doRedo = useCallback(() => {
    const h = historyRef.current
    if (h.canRedo()) {
      const live = capturePaintSnapshot(h.peekRedoLabel() ?? 'Paint')
      const snap = h.redo(live ?? undefined)
      if (snap) {
        applyPaintSnapshot(snap)
        syncHistoryFlags()
        return
      }
    }
    p.onRedo()
  }, [capturePaintSnapshot, applyPaintSnapshot, syncHistoryFlags, p])

  // Switching vehicles reuses this component instance (no key), and the paint
  // canvas is repopulated per model — so drop the local pixel history to avoid
  // restoring one vehicle's strokes onto another's atlas.
  useEffect(() => {
    historyRef.current.clear()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- per-vehicle reset; single setState with no cascade
    setLocalHist({ canUndo: false, canRedo: false })
  }, [p.vehicleName])

  // Clear wipes paint back to vanilla in the Editor. Record the pre-clear paint
  // canvas locally first so the wipe is itself undoable via the same ring.
  const handleClear = useCallback(() => {
    const pre = capturePaintSnapshot('Clear')
    if (pre) {
      historyRef.current.push(pre)
      syncHistoryFlags()
    }
    p.onClear()
  }, [capturePaintSnapshot, syncHistoryFlags, p])

  // Esc closes, zoom shortcuts, brush size [ / ], F1/? help overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input / textarea.
      const target = e.target as HTMLElement | null
      const inForm = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (e.key === 'Escape' && !shortcutsOpen) { p.onBack(); return }
      if (e.key === 'F1' || (!inForm && e.key === '?')) {
        e.preventDefault()
        setShortcutsOpen(v => !v)
        return
      }
      const meta = e.ctrlKey || e.metaKey
      // Zoom shortcuts — view-state only, no undo frame
      if (meta && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        pz.setScale(Math.min(ZOOM_MAX, +(pz.scale * 1.2).toFixed(2)))
        return
      }
      if (meta && e.key === '-') {
        e.preventDefault()
        pz.setScale(Math.max(ZOOM_MIN, +(pz.scale / 1.2).toFixed(2)))
        return
      }
      if (meta && e.key === '0') { e.preventDefault(); pz.fitToWindow(); return }
      if (meta && e.key === '1') { e.preventDefault(); pz.resetTo100(); return }
      if (inForm) return
      // [ / ] — brush size
      if (e.key === '[') {
        e.preventDefault()
        p.setBrush({ ...p.brush, size: Math.max(1, (p.brush.size ?? 12) - 2) })
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        p.setBrush({ ...p.brush, size: Math.min(80, (p.brush.size ?? 12) + 2) })
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, pz.scale, pz.setScale, pz.fitToWindow, pz.resetTo100, shortcutsOpen])

  // ── R4: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — captured on window BEFORE Editor's
  // document-level handler so paint undo/redo goes through THIS editor's local
  // pixel history without the parent also firing (which would double-undo).
  // Capture phase on window is the very first listener in the dispatch order,
  // so stopImmediatePropagation() prevents the parent's document-bubble handler
  // from running. When our local ring is empty, doUndo/doRedo fall back to the
  // project history so decal/other-vehicle undos still work.
  useEffect(() => {
    const onUndoKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inForm =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (inForm) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      // Ctrl+Shift+Z or Ctrl+Y → redo
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        e.stopImmediatePropagation()
        doRedo()
        return
      }
      // Ctrl+Z → undo
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        doUndo()
        return
      }
    }
    window.addEventListener('keydown', onUndoKey, { capture: true })
    return () => window.removeEventListener('keydown', onUndoKey, { capture: true })
  }, [doUndo, doRedo])

  // The peel collapses for the 'pick' tool (a one-shot action with no options).
  const peelId = tool === 'pick' ? null : tool

  // ── Shared glass-pill style (same recipe as EditorHomeButton / Back pill) ──
  const glassPillStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    borderRadius: 12,
    background: 'rgba(17, 17, 17, 0.78)',
    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
    backdropFilter: 'blur(40px) saturate(150%)',
    WebkitBackdropFilter: 'blur(40px) saturate(150%)',
    border: '0.5px solid rgba(255, 255, 255, 0.08)',
    boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
    color: EDITOR_TEXT_2,
    cursor: 'pointer',
    transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    WebkitAppRegion: 'no-drag',
  } as CSSProperties

  return (
    <div
      className="fixed inset-0 z-[60]"
      style={{ background: 'rgb(17, 19, 24)', color: 'rgba(247,247,250,0.92)', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
    >
      {/* ── Canvas stage — pan-zoom container fills the full viewport ──────── */}
      {/* atlasWrapRef is the scroll/clip boundary; usePanZoom attaches its wheel
          listener here and pz.handlers spread here for Space/middle-drag pan.
          overflow:hidden clips the zoomed content to the work area.
          The inner atlas div carries translate+scale via CSS transform so the
          correct transformOrigin: '0 0' preserves the hook's cursor-anchor math. */}
      <div
        ref={atlasWrapRef}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
        {...pz.handlers}
      >
        <div
          style={{
            // R7 WIRING FIX: transform-origin MUST be '0 0' so the hook's
            // wheel-zoom math holds. The hook computes:
            //   newOx = cx - (cx - prevOx) * (newScale / prevScale)
            // This decomposition is valid only when the CSS origin is the
            // top-left corner. 'center center' adds an implicit extra translate
            // of (w/2 - w*s/2, h/2 - h*s/2) which breaks cursor anchoring.
            transformOrigin: '0 0',
            transform: `translate(${pz.offset.x}px, ${pz.offset.y}px) scale(${pz.scale})`,
            // The atlas is VIEW² — keep it at natural size and let scale do the work.
            width: VIEW,
            height: VIEW,
            position: 'absolute',
            // Subtle checker so the atlas bounds are obvious.
            backgroundColor: '#1c1f26',
            backgroundImage:
              'linear-gradient(45deg, #232733 25%, transparent 25%), linear-gradient(-45deg, #232733 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #232733 75%), linear-gradient(-45deg, transparent 75%, #232733 75%)',
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
            borderRadius: 8,
            boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
          }}
        >
          <canvas
            ref={displayRef}
            width={VIEW}
            height={VIEW}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
            onLostPointerCapture={endStroke}
            style={{
              display: 'block',
              width: VIEW,
              height: VIEW,
              cursor: 'crosshair',
              touchAction: 'none',
            }}
          />
        </div>
      </div>

      {/* ── TOP-LEFT: Back pill + Undo/Redo cluster ───────────────────────── */}
      {/* Matches the FaceplateEditor / DecalPackEditor chrome: back pill on the
          far left, undo/redo icons immediately to its right, all in a single
          fixed row aligned to the top inset. */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(12px + var(--app-top-inset, 0px))',
          left: 12,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          WebkitAppRegion: 'no-drag',
        } as CSSProperties}
      >
        {/* Back pill — ArrowLeft + "Back" label, same glass recipe as EditorHomeButton */}
        <button
          type="button"
          onClick={p.onBack}
          title="Back to the 3D view (Esc)"
          aria-label="Back to 3D view"
          className="l01-ring hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          style={{
            ...glassPillStyle,
            gap: 6,
            padding: '0 12px 0 10px',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <ArrowLeft size={15} strokeWidth={2} aria-hidden />
          <span>Back</span>
        </button>

        {/* Undo */}
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          aria-label="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={doUndo}
          className="l01-ring hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-35 disabled:pointer-events-none"
          style={{ ...glassPillStyle, width: 36, padding: 0 }}
        >
          <RotateCcw size={16} strokeWidth={2} aria-hidden />
        </button>

        {/* Redo */}
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={doRedo}
          className="l01-ring hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-35 disabled:pointer-events-none"
          style={{ ...glassPillStyle, width: 36, padding: 0 }}
        >
          <RotateCw size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* ── TOP-CENTRE: title pill ─────────────────────────────────────────── */}
      {/* Matches the EditorTitlePill placement in FaceplateEditor/DecalPackEditor.
          VTE's title is static (no rename popover) so we use a plain glass pill. */}
      <div
        className="l01-ring"
        style={{
          position: 'fixed',
          top: 'calc(12px + var(--app-top-inset, 0px))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          display: 'inline-flex',
          alignItems: 'center',
          height: 36,
          padding: '0 16px',
          borderRadius: 12,
          background: 'rgba(17, 17, 17, 0.78)',
          backdropFilter: 'blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'blur(40px) saturate(150%)',
          border: '0.5px solid rgba(255, 255, 255, 0.08)',
          boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
          color: 'rgba(247,247,250,0.88)',
          fontFamily: "'Inter Variable', ui-monospace, monospace",
          fontVariantNumeric: 'slashed-zero',
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '0.01em',
          maxWidth: 'calc(100vw - 260px)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          WebkitAppRegion: 'no-drag',
          pointerEvents: 'none',
        } as CSSProperties}
      >
        Edit texture — {p.vehicleName}
      </div>

      {/* ── TOP-RIGHT: zoom controls + ? help button ───────────────────────── */}
      {/* FaceplateEditor surfaces fit/100% as keyboard shortcuts (Ctrl+0/1).
          VTE adds them as explicit glass buttons top-right for discoverability
          — same placement pattern as the FPE's AtlasViewPanel. */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(12px + var(--app-top-inset, 0px))',
          right: 12,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          WebkitAppRegion: 'no-drag',
        } as CSSProperties}
      >
        {/* Fit to window */}
        <button
          type="button"
          title="Fit texture to window (Ctrl+0)"
          aria-label="Fit texture to window"
          onClick={pz.fitToWindow}
          className="l01-ring hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          style={{ ...glassPillStyle, width: 36, padding: 0 }}
        >
          <Maximize2 size={15} strokeWidth={2} aria-hidden />
        </button>

        {/* 100% zoom */}
        <button
          type="button"
          title="100% zoom (Ctrl+1)"
          aria-label="100% zoom"
          onClick={pz.resetTo100}
          className="l01-ring hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          style={{ ...glassPillStyle, width: 36, padding: 0 }}
        >
          <Percent size={15} strokeWidth={2} aria-hidden />
        </button>

        {/* Help / shortcuts */}
        <button
          type="button"
          title="Keyboard shortcuts (F1 or ?)"
          aria-label="Keyboard shortcuts"
          onClick={() => setShortcutsOpen(v => !v)}
          className="l01-ring hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          style={{ ...glassPillStyle, width: 36, padding: 0 }}
        >
          <HelpCircle size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* ── BOTTOM-CENTRE: tool-options peel + tools pill ─────────────────── */}
      {/* Exact same structure as FaceplateEditor / DecalPackEditor: a column of
          [ToolOptionsPeel, BottomToolPill] fixed to the bottom-centre. */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          zIndex: 40,
          WebkitAppRegion: 'no-drag',
          maxWidth: 'calc(100vw - 40px)',
        } as CSSProperties}
      >
        <ToolOptionsPeel
          key={tool}
          activeId={peelId}
          label={tool === 'erase' ? 'Erase' : 'Draw'}
          style={{ minHeight: 44 }}
        >
          <TexToolPeelBody
            tool={tool}
            brush={p.brush}
            setBrush={p.setBrush}
            onClear={handleClear}
          />
        </ToolOptionsPeel>

        <BottomToolPill<TexTool>
          tools={TOOLS}
          activeId={tool}
          onSelect={selectTool}
          extras={[
            {
              id: 'uv',
              icon: <Grid3x3 size={18} strokeWidth={2} />,
              label: 'UV guide',
              title: uvOverlay
                ? showUv
                  ? 'Hide UV guide — the panel wireframe showing where each part maps'
                  : 'Show UV guide — see where each panel maps'
                : 'No UV layout available for this model',
              pressed: showUv,
              onClick: () => uvOverlay && setShowUv(v => !v),
              testId: 'texture-uv-toggle',
            },
            {
              id: 'symmetry',
              icon: <FlipHorizontal2 size={18} strokeWidth={2} />,
              label: 'Mirror',
              title: p.brush.symmetric
                ? 'Symmetric brush ON — disable for one-sided painting'
                : 'Symmetric brush OFF — enable to mirror dabs across the centre',
              pressed: !!p.brush.symmetric,
              onClick: () => p.setBrush({ ...p.brush, symmetric: !p.brush.symmetric }),
              testId: 'texture-symmetry-toggle',
            },
          ]}
        />
      </div>

      {/* ── Keyboard shortcuts overlay (F1 / ?) ───────────────────────────── */}
      <KeyboardShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        groups={VTE_SHORTCUTS}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool-options peel body — the active tool's controls. Compact, single-row.
// ---------------------------------------------------------------------------

function TexToolPeelBody({
  tool,
  brush,
  setBrush,
  onClear,
}: {
  tool: TexTool
  brush: BrushSettings
  setBrush: (s: BrushSettings) => void
  onClear: () => void
}) {
  if (tool === 'pick') return null

  return (
    <>
      <PeelSlider
        label="Size"
        value={brush.size}
        min={8}
        max={512}
        step={1}
        format={v => `${Math.round(v)}px`}
        onChange={v => setBrush({ ...brush, size: v })}
      />
      <PeelSlider
        label="Soft"
        value={brush.softness}
        min={0}
        max={1}
        step={0.05}
        format={v => v.toFixed(2)}
        onChange={v => setBrush({ ...brush, softness: v })}
      />
      <PeelSlider
        label="Opacity"
        value={brush.opacity}
        min={0.05}
        max={1}
        step={0.05}
        format={v => v.toFixed(2)}
        onChange={v => setBrush({ ...brush, opacity: v })}
      />

      {/* Colour controls only apply when drawing — erase restores vanilla. */}
      {tool === 'brush' && (
        <>
          <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '4px 2px', background: 'rgba(255,255,255,0.10)' }} />
          <input
            type="color"
            value={brush.color}
            onChange={e => setBrush({ ...brush, color: e.target.value })}
            aria-label="Brush colour"
            style={{
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: 6,
              border: '0.5px solid rgba(255,255,255,0.12)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 14px)', gap: 3 }}>
            {SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setBrush({ ...brush, color: c })}
                aria-label={`Set colour ${c}`}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  border: '0.5px solid rgba(255,255,255,0.14)',
                  background: c,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        </>
      )}

      <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '4px 2px', background: 'rgba(255,255,255,0.10)' }} />
      <button
        type="button"
        onClick={onClear}
        title="Wipe paint back to the vanilla diffuse"
        aria-label="Clear paint"
        className="hover:text-white hover:bg-white/10"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          height: 30,
          padding: '0 10px',
          borderRadius: 8,
          border: '0.5px solid rgba(255,255,255,0.12)',
          background: 'rgba(255,255,255,0.04)',
          color: EDITOR_TEXT_2,
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <ClearIcon size={13} strokeWidth={2} aria-hidden />
        Clear
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Compact labelled slider sized for the horizontal tool-options peel.
// ---------------------------------------------------------------------------

function PeelSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 104 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: EDITOR_TEXT_3,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 9, fontVariantNumeric: 'tabular-nums', color: EDITOR_TEXT_2 }}>
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full"
        style={{ height: 14, accentColor: EDITOR_ACCENT }}
      />
    </div>
  )
}
