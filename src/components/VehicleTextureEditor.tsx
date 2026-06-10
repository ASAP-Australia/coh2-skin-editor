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
import { ArrowLeft, Brush, Eraser, Pipette, Grid3x3, FlipHorizontal2, Eraser as ClearIcon, RotateCcw, RotateCw } from 'lucide-react'
import BottomToolPill, { type ToolDef } from './editor-primitives/BottomToolPill'
import ToolOptionsPeel from './editor-primitives/ToolOptionsPeel'
import { EDITOR_TEXT_2, EDITOR_TEXT_3 } from './editor-primitives/tokens'
import {
  paintBrushDab,
  paintBrushSegment,
  samplePixel,
  type BrushSettings,
} from '@/lib/brush'

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
  // Active tool drives both painting and the brush mode. 'brush'→paint,
  // 'erase'→erase, 'pick'→one-shot eyedropper.
  const [tool, setTool] = useState<TexTool>('brush')
  const [showUv, setShowUv] = useState(false)
  const paintingRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)

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
      p.onStrokeBegin()
      paintBrushDab(ctx, x, y, p.brush, p.vanilla)
      lastPtRef.current = { x, y }
      paintingRef.current = true
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      p.onComposite()
      blit()
    },
    [toAtlas, tool, baseCtx, p, blit],
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

  // Esc closes the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  // The peel collapses for the 'pick' tool (a one-shot action with no options).
  const peelId = tool === 'pick' ? null : tool

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgb(17, 19, 24)' }}
    >
      {/* ── Canvas stage — centred, fills the screen behind the floating chrome ── */}
      <div className="absolute inset-0 flex items-center justify-center p-10">
        <div
          style={{
            position: 'relative',
            aspectRatio: '1 / 1',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
            // Subtle checker so the atlas bounds are obvious.
            backgroundColor: '#1c1f26',
            backgroundImage:
              'linear-gradient(45deg, #232733 25%, transparent 25%), linear-gradient(-45deg, #232733 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #232733 75%), linear-gradient(-45deg, transparent 75%, #232733 75%)',
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
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
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              cursor: 'crosshair',
              touchAction: 'none',
            }}
          />
        </div>
      </div>

      {/* ── Back-pill — top-left. Returns to the 3D view (NOT the start screen),
          so it's an ArrowLeft rather than the Home button, but wears the same
          glass recipe as EditorHomeButton for visual parity. ── */}
      <button
        type="button"
        onClick={p.onBack}
        title="Back to the 3D view (Esc)"
        aria-label="Back to 3D view"
        className="hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        style={{
          position: 'fixed',
          top: 'calc(12px + var(--app-top-inset, 0px))',
          left: 12,
          zIndex: 50,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          height: 36,
          padding: '0 12px 0 10px',
          borderRadius: 12,
          background: 'rgba(15, 17, 22, 0.75)',
          backgroundImage:
            'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
          backdropFilter: 'blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'blur(40px) saturate(150%)',
          border: '0.5px solid rgba(255, 255, 255, 0.08)',
          boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
          color: EDITOR_TEXT_2,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          WebkitAppRegion: 'no-drag',
        } as CSSProperties}
      >
        <ArrowLeft size={15} strokeWidth={2} aria-hidden />
        <span>Back</span>
      </button>

      {/* ── Undo / Redo buttons — top-left, right of the Back pill.
          Mirrors the button style used by FaceplateEditor/DecalPackEditor. ── */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(12px + var(--app-top-inset, 0px))',
          left: 80,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          WebkitAppRegion: 'no-drag',
        } as CSSProperties}
      >
        {/* Undo button */}
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          aria-label="Undo (Ctrl+Z)"
          disabled={!p.canUndo}
          onClick={p.onUndo}
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
            border: '0.5px solid rgba(255, 255, 255, 0.08)',
            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
            color: EDITOR_TEXT_2,
            cursor: 'pointer',
            padding: 0,
            transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          } as CSSProperties}
        >
          <RotateCcw size={16} strokeWidth={2} aria-hidden />
        </button>
        {/* Redo button */}
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo (Ctrl+Shift+Z)"
          disabled={!p.canRedo}
          onClick={p.onRedo}
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
            border: '0.5px solid rgba(255, 255, 255, 0.08)',
            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
            color: EDITOR_TEXT_2,
            cursor: 'pointer',
            padding: 0,
            transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          } as CSSProperties}
        >
          <RotateCw size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* ── Title pill — top-centre. Mirrors the EditorTitlePill placement used
          by the decal / faceplate editors. ── */}
      <div
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
          background: 'rgba(15, 17, 22, 0.75)',
          backdropFilter: 'blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'blur(40px) saturate(150%)',
          border: '0.5px solid rgba(255, 255, 255, 0.08)',
          boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
          color: 'rgb(209, 213, 219)',
          fontSize: 13,
          fontWeight: 500,
          maxWidth: 'calc(100vw - 200px)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          WebkitAppRegion: 'no-drag',
        } as CSSProperties}
      >
        Edit texture — {p.vehicleName}
      </div>

      {/* ── Bottom dock — tool-options peel (top) + tools menu pill (bottom),
          matching the decal / faceplate editor layout. ── */}
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
            onClear={p.onClear}
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
              label: 'Unwrap',
              title: uvOverlay ? 'Toggle UV unwrap overlay' : 'No UV layout available',
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
        className="w-full accent-[var(--color-accent)]"
        style={{ height: 14 }}
      />
    </div>
  )
}
