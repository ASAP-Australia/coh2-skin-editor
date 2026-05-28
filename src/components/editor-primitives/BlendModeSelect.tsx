/**
 * BlendModeSelect — compact native `<select>` for picking a layer blend mode.
 *
 * All 16 canvas-composite blend modes live in the BLEND_MODES array imported
 * from faceplate-project. The identity value is `'normal'` — when the user
 * selects it we call `onChange(undefined)` so the layer field stays absent
 * (identity-default convention: never persist a no-op value).
 *
 * Styling mirrors HexColorInput / the inline font-family select in
 * FaceplateEditor: dark glass surface, thin hairline border, 11px font,
 * ~28px height. The `compact` prop drops the optional label and narrows
 * the width slightly for tight peel layouts.
 *
 * Display labels are title-cased: `'color-dodge' → 'Color Dodge'`.
 */

import type { JSX } from 'react'
import { BLEND_MODES, type BlendMode } from '@/lib/faceplate-project'
import { EDITOR_TEXT_2, EDITOR_TEXT_3 } from './tokens'

// ── Display helpers ───────────────────────────────────────────────────────────

/** Convert a kebab-case blend mode identifier to a human-readable title-case
 *  label. `'color-dodge'` → `'Color Dodge'`, `'normal'` → `'Normal'`. */
function toLabel(mode: BlendMode): string {
  return mode
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface BlendModeSelectProps {
  /** Current blend mode. `undefined` is treated as `'normal'`. */
  value: BlendMode | undefined
  /** Called with the new blend mode, or `undefined` when reset to `'normal'`. */
  onChange: (next: BlendMode | undefined) => void
  /** Optional small label rendered above the select. Suppressed in compact mode. */
  label?: string
  /** Compact mode: no label, shorter width — used in inline peels. */
  compact?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Single-select for the 16 canvas-composite blend modes. Wraps the native
 * `<select>` in the dark-glass visual language used throughout editor-primitives
 * so it reads as a sibling of HexColorInput / SliderRow.
 */
export default function BlendModeSelect({
  value,
  onChange,
  label,
  compact = false,
}: BlendModeSelectProps): JSX.Element {
  // Treat undefined as 'normal' for the controlled select value.
  const current: BlendMode = value ?? 'normal'

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as BlendMode
    // Identity convention: 'normal' → pass undefined so the layer field is absent.
    onChange(next === 'normal' ? undefined : next)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        // Let the column layout shrink to content in horizontal flex peels.
        flexShrink: 0,
      }}
    >
      {!compact && label && (
        <span
          style={{
            fontSize: 11,
            color: EDITOR_TEXT_3,
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {label}
        </span>
      )}
      <select
        data-testid="blend-mode-select"
        value={current}
        onChange={handleChange}
        aria-label={label ?? 'Blend mode'}
        style={{
          background: 'rgba(20, 22, 28, 0.72)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 5,
          color: EDITOR_TEXT_2,
          fontSize: 11,
          height: 28,
          padding: '0 6px',
          cursor: 'pointer',
          width: compact ? 90 : 110,
          outline: 'none',
          appearance: 'auto',
        }}
      >
        {BLEND_MODES.map(mode => (
          <option key={mode} value={mode} style={{ background: '#1a1c22' }}>
            {toLabel(mode)}
          </option>
        ))}
      </select>
    </div>
  )
}
