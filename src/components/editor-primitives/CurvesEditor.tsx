/**
 * CurvesEditor — tone-preset modal for the AdjustmentPanel.
 *
 * Phase 8 Wave 3, item B. Ships six named tone presets plus a minimal
 * three-handle custom-curve editor. Each preset card shows a small SVG
 * curve preview and patches the selected `ImageLayer`'s `brightness` +
 * `contrast` filters on Apply. The custom card allows the user to drag
 * three handles (shadows / midtones / highlights) and derives brightness
 * + contrast from the curve shape via lightweight heuristics:
 *
 *   • midpoint above the identity diagonal → brightness > 1 (lifted mids)
 *   • midpoint below the diagonal         → brightness < 1 (crushed mids)
 *   • endpoints pinched inward (dark shadow / bright highlight)
 *                                         → contrast > 1 (S-curve)
 *   • endpoints spread outward            → contrast < 1 (faded)
 *
 * The heuristic is intentionally simple — it gives designers a
 * one-click approximation they can refine with the AdjustmentPanel
 * sliders. A full per-channel 256-entry LUT would require schema changes
 * and a Canvas2D `getImageData` roundtrip on every drag tick; that is
 * deferred to v1.1.
 *
 * Schema note: this component patches only `brightness` and `contrast`
 * on the existing `ImageLayerFilters` interface. No schema changes are
 * required.
 *
 * Accessibility:
 *   • Modal is wrapped in `<GlassModal>` (role="dialog", aria-modal, Escape
 *     to close via GlassModal's built-in handler).
 *   • Each preset card's Apply button carries an `aria-label` so screen
 *     readers announce "Apply {preset name} preset".
 *   • SVG curve previews are `aria-hidden` — they are decorative.
 */

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import GlassModal from './GlassModal'
import { EDITOR_ACCENT, EDITOR_TEXT_1, EDITOR_TEXT_2, EDITOR_TEXT_3 } from './tokens'
import type { ImageLayerFilters } from '@/lib/faceplate-project'

// ── Preset definitions ────────────────────────────────────────────────────────

/** A named tone preset — maps to an (brightness, contrast) pair. */
interface Preset {
  id: string
  label: string
  /** brightness() multiplier — 1 = identity. */
  brightness: number
  /** contrast() multiplier — 1 = identity. */
  contrast: number
  /** Descriptive copy shown below the curve SVG. */
  description: string
}

const PRESETS: readonly Preset[] = [
  {
    id: 'linear',
    label: 'Linear',
    brightness: 1,
    contrast: 1,
    description: 'No adjustment — original tones.',
  },
  {
    id: 'brighten-highlights',
    label: 'Brighten Highlights',
    brightness: 1.25,
    contrast: 0.95,
    description: 'Lifts the upper register, softens contrast.',
  },
  {
    id: 'darken-shadows',
    label: 'Darken Shadows',
    brightness: 0.82,
    contrast: 1.1,
    description: 'Deepens shadows, retains highlight pop.',
  },
  {
    id: 'punch-contrast',
    label: 'Punch Contrast',
    brightness: 1.0,
    contrast: 1.45,
    description: 'Classic S-curve — vivid highlights and rich shadows.',
  },
  {
    id: 'faded',
    label: 'Faded',
    brightness: 1.12,
    contrast: 0.72,
    description: 'Matte / Instagram-faded look, lifted blacks.',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    brightness: 0.92,
    contrast: 1.25,
    description: 'Crushed blacks, boosted contrast — film-grade.',
  },
] as const

// ── SVG curve preview ─────────────────────────────────────────────────────────

/** Render a tiny SVG illustrating the tone curve shape for a preset.
 *  The curve is drawn from (0,W) to (W,0) in SVG space (Y flipped),
 *  bending through a midpoint derived from the preset's brightness/contrast. */
function CurvePreviewSvg({
  brightness,
  contrast,
  size = 56,
  color = EDITOR_ACCENT,
  handles,
}: {
  brightness: number
  contrast: number
  size?: number
  color?: string
  /** Optional override for the three Y positions [shadow, mid, highlight] in
   *  0..1 range (1 = top, 0 = bottom). Used by the custom editor during drag. */
  handles?: [number, number, number]
}) {
  const W = size
  // Derive four control points in [0..1] space (y=1 at bottom = dark).
  // shadow and highlight are clamped inward by contrast.
  const spreadHalf = Math.max(0, (contrast - 1) * 0.12)

  // When handles are provided (custom curve drag) use them directly.
  const y0 = handles ? 1 - handles[0] : Math.min(1, 0 + spreadHalf) // shadow output
  const y1 = handles ? 1 - handles[1] : Math.max(0, 1 - brightness * 0.5) // midpoint
  const y2 = handles ? 1 - handles[2] : Math.max(0, 1 - 1 - (1 - brightness * 0.5) * 0.5) // highlight

  // Four points: (0, y0), (0.33, midA), (0.67, midB), (1, y3)
  const y3 = handles ? 1 - Math.min(1, handles[2] + 0.05) : Math.max(0, 0 - spreadHalf)

  // Convert to SVG coords: x = t*W, y = yNorm*(W)
  const p = (t: number, y: number) => `${t * W},${Math.max(0, Math.min(W, y * W))}`

  // Use a smooth cubic path through the four points.
  const d = [
    `M ${p(0, y0)}`,
    `C ${p(0.2, y0)},${p(0.3, y1 + (y0 - y1) * 0.1)},${p(0.33, y1)}`,
    `C ${p(0.5, y1)},${p(0.55, y2)},${p(0.67, y2)}`,
    `C ${p(0.8, y2)},${p(0.95, y3)},${p(1, y3)}`,
  ].join(' ')

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${W} ${W}`}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Grid */}
      <line x1={0} y1={W / 2} x2={W} y2={W / 2} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <line x1={W / 2} y1={0} x2={W / 2} y2={W} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      {/* Identity diagonal */}
      <line
        x1={0}
        y1={W}
        x2={W}
        y2={0}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={0.5}
        strokeDasharray="2 2"
      />
      {/* Curve */}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

// ── Custom curve editor ───────────────────────────────────────────────────────

/** Three draggable handles on a 120×120 SVG. Returns derived brightness +
 *  contrast via the heuristics described in the module docstring. */
function CustomCurveEditor({
  brightness,
  contrast,
  onChange,
}: {
  brightness: number
  contrast: number
  onChange: (brightness: number, contrast: number) => void
}) {
  // Handle positions in [0..1] (1 = top = white = fully bright).
  // Initialise from existing brightness/contrast values.
  const [handles, setHandles] = useState<[number, number, number]>([
    Math.min(1, Math.max(0, 0.08 + (contrast - 1) * 0.12)), // shadow
    Math.min(1, Math.max(0, brightness * 0.5)), // midtone
    Math.min(1, Math.max(0, 0.92 - (contrast - 1) * 0.12)), // highlight
  ])
  const dragRef = useRef<{ idx: number; startY: number; startVal: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const SIZE = 120

  const onPointerDown = useCallback(
    (idx: 0 | 1 | 2) => (ev: PointerEvent<SVGCircleElement>) => {
      ev.preventDefault()
      ;(ev.target as Element).setPointerCapture(ev.pointerId)
      dragRef.current = { idx, startY: ev.clientY, startVal: handles[idx] }
    },
    [handles],
  )

  const onPointerMove = useCallback(
    (ev: PointerEvent<SVGSVGElement>) => {
      if (!dragRef.current) return
      const svgH = svgRef.current?.getBoundingClientRect().height ?? SIZE
      const dy = -(ev.clientY - dragRef.current.startY) / svgH
      const next = Math.min(1, Math.max(0, dragRef.current.startVal + dy))
      const newHandles: [number, number, number] = [...handles]
      newHandles[dragRef.current.idx] = next
      setHandles(newHandles)

      // Derive brightness + contrast from the three handle positions.
      const [sh, mid, hi] = newHandles
      // Midpoint above 0.5 → brightness > 1; below → brightness < 1.
      const newBrightness = parseFloat((mid * 2).toFixed(2))
      // Shadow darker than identity (sh<0.08) and highlight brighter than
      // identity (hi>0.92) = higher contrast. Opposite = lower contrast.
      const shDev = 0.08 - sh // positive when shadow is darkened
      const hiDev = hi - 0.92 // positive when highlight is lightened
      const newContrast = parseFloat(
        Math.max(0.5, Math.min(2.0, 1 + (shDev + hiDev) * 2.5)).toFixed(2),
      )
      onChange(newBrightness, newContrast)
    },
    [handles, onChange],
  )

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const handleX = [SIZE * 0.12, SIZE * 0.5, SIZE * 0.88]
  const handleY = handles.map(h => SIZE * (1 - h))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ cursor: 'crosshair', display: 'block' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Grid lines */}
        <line
          x1={0}
          y1={SIZE / 2}
          x2={SIZE}
          y2={SIZE / 2}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={0.5}
        />
        <line
          x1={SIZE / 2}
          y1={0}
          x2={SIZE / 2}
          y2={SIZE}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={0.5}
        />
        {/* Identity diagonal */}
        <line
          x1={0}
          y1={SIZE}
          x2={SIZE}
          y2={0}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={0.5}
          strokeDasharray="3 3"
        />
        {/* Curve preview using current handle positions */}
        <CurvePreviewSvg
          brightness={brightness}
          contrast={contrast}
          size={SIZE}
          color={EDITOR_ACCENT}
          handles={handles}
        />
        {/* Drag handles */}
        {([0, 1, 2] as const).map(idx => (
          <circle
            key={idx}
            cx={handleX[idx]}
            cy={handleY[idx]}
            r={5}
            fill={EDITOR_ACCENT}
            stroke="#ffffff"
            strokeWidth={1}
            style={{ cursor: 'ns-resize', touchAction: 'none' }}
            onPointerDown={onPointerDown(idx)}
          />
        ))}
        {/* Handle labels */}
        <text x={handleX[0]} y={SIZE + 12} textAnchor="middle" fontSize={8} fill={EDITOR_TEXT_3}>
          Shadows
        </text>
        <text x={handleX[1]} y={SIZE + 12} textAnchor="middle" fontSize={8} fill={EDITOR_TEXT_3}>
          Mids
        </text>
        <text x={handleX[2]} y={SIZE + 12} textAnchor="middle" fontSize={8} fill={EDITOR_TEXT_3}>
          Highlights
        </text>
      </svg>
      <p style={{ margin: '16px 0 0', fontSize: 10, color: EDITOR_TEXT_3, textAlign: 'center' }}>
        Drag handles to shape the tone curve.
      </p>
    </div>
  )
}

// ── Main CurvesEditor ─────────────────────────────────────────────────────────

export interface CurvesEditorProps {
  /** Current filter state — used to seed the custom curve handles. */
  filters: ImageLayerFilters | undefined
  /** Called with the brightness + contrast patch when the user clicks Apply
   *  on a preset or on the custom curve editor. Caller is responsible for
   *  merging onto the layer. */
  onApply: (patch: Pick<ImageLayerFilters, 'brightness' | 'contrast'>) => void
  /** Called when the user clicks Cancel or the modal scrim. No patch. */
  onClose: () => void
}

export default function CurvesEditor({ filters, onApply, onClose }: CurvesEditorProps) {
  const currentBrightness = filters?.brightness ?? 1
  const currentContrast = filters?.contrast ?? 1

  // Custom curve state — tracks the brightness+contrast values produced by
  // dragging the three SVG handles. Seeded from the layer's current filters.
  const [customB, setCustomB] = useState(currentBrightness)
  const [customC, setCustomC] = useState(currentContrast)

  const handleCustomChange = useCallback((b: number, c: number) => {
    setCustomB(b)
    setCustomC(c)
  }, [])

  const cardStyle: CSSProperties = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  }

  const applyBtnStyle: CSSProperties = {
    background: 'rgba(120,180,255,0.14)',
    border: '1px solid rgba(120,180,255,0.35)',
    borderRadius: 6,
    color: EDITOR_ACCENT,
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 12px',
    cursor: 'pointer',
    letterSpacing: '0.04em',
  }

  return (
    <GlassModal title="Tone Curves" onClose={onClose} maxWidth={680} style={{ minWidth: 340 }}>
      <div data-testid="curves-editor">
        {/* ── Preset grid ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 10,
            marginBottom: 20,
          }}
        >
          {PRESETS.map(preset => (
            <div key={preset.id} data-testid={`curves-preset-${preset.id}`} style={cardStyle}>
              <CurvePreviewSvg
                brightness={preset.brightness}
                contrast={preset.contrast}
                size={56}
              />
              <span
                style={{ fontSize: 11, color: EDITOR_TEXT_1, fontWeight: 600, textAlign: 'center' }}
              >
                {preset.label}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: EDITOR_TEXT_3,
                  textAlign: 'center',
                  lineHeight: 1.4,
                  minHeight: 24,
                }}
              >
                {preset.description}
              </span>
              <button
                type="button"
                aria-label={`Apply ${preset.label} preset`}
                data-testid={`curves-preset-${preset.id}-apply`}
                style={applyBtnStyle}
                onClick={() => {
                  onApply({ brightness: preset.brightness, contrast: preset.contrast })
                  onClose()
                }}
              >
                Apply
              </button>
            </div>
          ))}
        </div>

        {/* ── Custom curve card ── */}
        <div
          style={{
            ...cardStyle,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 20,
            borderColor: 'rgba(120,180,255,0.18)',
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <CustomCurveEditor
              brightness={customB}
              contrast={customC}
              onChange={handleCustomChange}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
            <span style={{ fontSize: 13, color: EDITOR_TEXT_1, fontWeight: 600 }}>Custom</span>
            <p style={{ fontSize: 11, color: EDITOR_TEXT_2, lineHeight: 1.5, margin: 0 }}>
              Drag the three handles to shape the tone curve. Raising or lowering the midpoint
              control changes brightness; pinching the shadow and highlight handles boosts contrast.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: EDITOR_TEXT_3 }}>
                Brightness:{' '}
                <strong style={{ color: EDITOR_TEXT_2 }}>{Math.round(customB * 100)}%</strong>
              </span>
              <span style={{ fontSize: 10, color: EDITOR_TEXT_3 }}>
                Contrast:{' '}
                <strong style={{ color: EDITOR_TEXT_2 }}>{Math.round(customC * 100)}%</strong>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                data-testid="curves-custom-apply"
                aria-label="Apply custom curve"
                style={applyBtnStyle}
                onClick={() => {
                  onApply({ brightness: customB, contrast: customC })
                  onClose()
                }}
              >
                Apply
              </button>
              <button
                type="button"
                data-testid="curves-cancel"
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  color: EDITOR_TEXT_2,
                  fontSize: 11,
                  padding: '4px 12px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </GlassModal>
  )
}
