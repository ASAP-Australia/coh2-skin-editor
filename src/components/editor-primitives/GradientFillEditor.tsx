/**
 * GradientFillEditor — inline editor for a GradientFill value.
 *
 * Manages up to 4 colour stops for either a linear or radial gradient. The
 * UI is intentionally small (~220px wide, vertical stack) so it slots into
 * the Shapes peel without crowding the existing ShapeLayer controls.
 *
 * Layout (top → bottom):
 *   1. Live preview swatch (60 × 16 px CSS gradient).
 *   2. Kind toggle — two-button group "Linear" / "Radial".
 *   3. Angle slider 0–360° (linear only).
 *   4. Stops list — one row per stop: HexColorInput + position slider + "−" remove button.
 *      "−" is disabled when only 2 stops remain (minimum needed for a gradient).
 *   5. "+ Add stop" button (disabled at 4 stops — engine upper bound).
 *   6. "Clear" button → onChange(undefined).
 *
 * Identity-default convention: when onChange(undefined) is called the caller
 * should delete gradientFill from the layer, leaving fillColor in effect.
 */

import { type JSX } from 'react'
import { type GradientFill } from '@/lib/faceplate-project'
import { EDITOR_TEXT_2, EDITOR_TEXT_3, EDITOR_ACCENT } from './tokens'
import HexColorInput from './HexColorInput'
import SliderRow from './SliderRow'
import PanelButton from './PanelButton'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface GradientFillEditorProps {
  /** Current gradient fill. `undefined` = no gradient (fallback to fillColor). */
  value: GradientFill | undefined
  /** Called with the mutated gradient, or `undefined` to clear. */
  onChange: (next: GradientFill | undefined) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a CSS gradient string from a GradientFill for the preview swatch. */
function previewCss(g: GradientFill): string {
  const stops = [...g.stops].sort((a, b) => a.position - b.position)
  const stopStr = stops.map(s => `${s.color} ${Math.round(s.position * 100)}%`).join(', ')
  if (g.kind === 'radial') {
    return `radial-gradient(circle, ${stopStr})`
  }
  // CSS linear-gradient: 0deg = bottom-to-top, but we define angle as top-to-bottom at 90°
  // matching the canvas convention (90° = top-to-bottom). CSS uses the opposite rotation
  // direction, so we pass `${angle}deg` which is "from top at that clockwise angle".
  return `linear-gradient(${g.angle ?? 90}deg, ${stopStr})`
}

/** Build a default two-stop gradient for a given kind. */
function defaultGradient(kind: 'linear' | 'radial'): GradientFill {
  return {
    kind,
    angle: kind === 'linear' ? 90 : undefined,
    stops: [
      { color: '#ffffff', position: 0 },
      { color: '#000000', position: 1 },
    ],
  }
}

const MAX_STOPS = 4
const MIN_STOPS = 2

// ── Toggle button style ───────────────────────────────────────────────────────

function kindBtnStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    height: 24,
    fontSize: 11,
    cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(120,180,255,0.6)' : 'rgba(255,255,255,0.12)'}`,
    background: active ? 'rgba(120,180,255,0.18)' : 'rgba(255,255,255,0.05)',
    color: active ? EDITOR_ACCENT : EDITOR_TEXT_2,
    borderRadius: 0,
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Full gradient fill editor — preview swatch, kind toggle, angle slider,
 * stop list with per-stop colour + position inputs, add/remove stop controls,
 * and a Clear button that resets to `undefined`.
 */
export default function GradientFillEditor({
  value,
  onChange,
}: GradientFillEditorProps): JSX.Element {
  /** Switch kind — initialises a fresh default gradient if currently undefined. */
  function setKind(kind: 'linear' | 'radial') {
    if (!value) {
      onChange(defaultGradient(kind))
      return
    }
    onChange({
      ...value,
      kind,
      angle: kind === 'linear' ? (value.angle ?? 90) : undefined,
    })
  }

  /** Patch the angle on the current gradient. */
  function setAngle(angle: number) {
    if (!value) return
    onChange({ ...value, angle })
  }

  /** Update a single stop's color. */
  function setStopColor(idx: number, color: string) {
    if (!value) return
    const stops = value.stops.map((s, i) => (i === idx ? { ...s, color } : s))
    onChange({ ...value, stops })
  }

  /** Update a single stop's position. */
  function setStopPosition(idx: number, position: number) {
    if (!value) return
    const stops = value.stops.map((s, i) => (i === idx ? { ...s, position } : s))
    onChange({ ...value, stops })
  }

  /** Remove a stop by index (blocked when only MIN_STOPS remain). */
  function removeStop(idx: number) {
    if (!value || value.stops.length <= MIN_STOPS) return
    const stops = value.stops.filter((_, i) => i !== idx)
    onChange({ ...value, stops })
  }

  /** Add a new stop — inserted at the midpoint between the last two stops. */
  function addStop() {
    if (!value || value.stops.length >= MAX_STOPS) return
    const sorted = [...value.stops].sort((a, b) => a.position - b.position)
    const last = sorted[sorted.length - 1]
    const secondLast = sorted[sorted.length - 2]
    const newPosition = (last.position + secondLast.position) / 2
    onChange({ ...value, stops: [...value.stops, { color: '#888888', position: newPosition }] })
  }

  // Determine the kind for the toggle (default to 'linear' when value is undefined).
  const kind = value?.kind ?? 'linear'
  const canAddStop = (value?.stops.length ?? 0) < MAX_STOPS

  return (
    <div
      data-testid="gradient-fill-editor"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: 220,
      }}
    >
      {/* Preview swatch */}
      <div
        aria-label="Gradient preview"
        style={{
          width: '100%',
          height: 16,
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.12)',
          background: value ? previewCss(value) : 'rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}
      />

      {/* Kind toggle */}
      <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden' }}>
        <button
          type="button"
          aria-pressed={kind === 'linear'}
          onClick={() => setKind('linear')}
          style={{ ...kindBtnStyle(kind === 'linear'), borderRadius: '5px 0 0 5px' }}
        >
          Linear
        </button>
        <button
          type="button"
          aria-pressed={kind === 'radial'}
          onClick={() => setKind('radial')}
          style={{ ...kindBtnStyle(kind === 'radial'), borderRadius: '0 5px 5px 0' }}
        >
          Radial
        </button>
      </div>

      {/* Angle slider — only shown for linear */}
      {kind === 'linear' && (
        <SliderRow
          label="Angle"
          min={0}
          max={360}
          step={1}
          value={value?.angle ?? 90}
          identity={90}
          format={v => `${Math.round(v)}°`}
          onChange={setAngle}
        />
      )}

      {/* Stops list */}
      {value && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: EDITOR_TEXT_3,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Stops
          </span>
          {value.stops.map((stop, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <HexColorInput
                value={stop.color}
                onChange={color => setStopColor(idx, color)}
                size={20}
                title={`Stop ${idx + 1} colour`}
              />
              <input
                type="range"
                aria-label={`Stop ${idx + 1} position`}
                min={0}
                max={1}
                step={0.01}
                value={stop.position}
                onChange={e => setStopPosition(idx, parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: EDITOR_ACCENT }}
              />
              <button
                type="button"
                aria-label={`Remove stop ${idx + 1}`}
                disabled={value.stops.length <= MIN_STOPS}
                onClick={() => removeStop(idx)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  border: '1px solid rgba(255,80,80,0.3)',
                  background: 'rgba(255,80,80,0.08)',
                  color: '#f87171',
                  fontSize: 13,
                  lineHeight: 1,
                  cursor: value.stops.length <= MIN_STOPS ? 'not-allowed' : 'pointer',
                  opacity: value.stops.length <= MIN_STOPS ? 0.4 : 1,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                −
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add stop */}
      <PanelButton onClick={addStop} disabled={!canAddStop}>
        + Add stop
      </PanelButton>

      {/* Clear button */}
      <PanelButton
        onClick={() => onChange(undefined)}
        style={{ color: '#f87171', borderColor: 'rgba(255,80,80,0.2)' }}
      >
        Clear gradient
      </PanelButton>
    </div>
  )
}
