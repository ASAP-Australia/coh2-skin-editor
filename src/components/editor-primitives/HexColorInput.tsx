/**
 * HexColorInput — compact color-picker primitive for the editor surfaces.
 *
 * Renders a clickable swatch + a text input that accepts:
 *   #rgb  #rrggbb  #rrggbbaa  rgb(r,g,b)  rgba(r,g,b,a)  hsl(h,s%,l%)  hsla(h,s%,l%,a)
 *
 * All formats are normalised to `#rrggbb` (or `#rrggbbaa` when `allowAlpha`).
 * Invalid input shows a red ring and does NOT commit the value.
 *
 * Design: dark-glass language — monospace hex text, white/transparent ring,
 * same token palette as the rest of editor-primitives.
 *
 * parseColor lives in ./parse-color.ts (separate file to satisfy
 * react-refresh/only-export-components).
 */

import { useRef, useState, type JSX } from 'react'
import { parseColor } from './parse-color'
import { EDITOR_TEXT_1, EDITOR_TEXT_3 } from './tokens'

// ── Component ────────────────────────────────────────────────────────────────

export interface HexColorInputProps {
  value: string
  onChange: (hex: string) => void
  /** Show the alpha channel (default false). */
  allowAlpha?: boolean
  /** Visual size of the swatch in px (default 24). */
  size?: number
  /** Optional label rendered to the left. */
  label?: string
  /** Optional aria-label / tooltip. */
  title?: string
}

export default function HexColorInput({
  value,
  onChange,
  allowAlpha = false,
  size = 24,
  label,
  title,
}: HexColorInputProps): JSX.Element {
  // We keep a local draft for the text field. When the user commits (blur /
  // Enter) and it's valid, we propagate upward. When the prop changes from
  // outside, we use the value directly as the input's value (controlled).
  // To avoid the react-hooks/set-state-in-effect violation we drive the
  // input's displayed value from the prop directly while the user isn't
  // editing, and only fork into local state after the first keystroke.
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const colorInputRef = useRef<HTMLInputElement>(null)

  // What the text input actually shows
  const displayValue = draft ?? value

  // Derive native picker value (#rrggbb — no alpha, browsers don't support it)
  const pickerValue = value.startsWith('#') ? `#${value.slice(1, 7)}` : value

  function commit(raw: string) {
    const parsed = parseColor(raw)
    if (parsed === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setDraft(null)
    onChange(parsed)
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
      title={title}
    >
      {label && (
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

      {/* Swatch button — opens native colour picker */}
      <button
        type="button"
        aria-label="Open colour picker"
        onClick={() => colorInputRef.current?.click()}
        style={{
          width: size,
          height: size,
          minWidth: size,
          background: value,
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 4,
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      />

      {/* Hidden native colour picker */}
      <input
        ref={colorInputRef}
        type="color"
        value={pickerValue}
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        onChange={e => {
          const hex = e.target.value // always #rrggbb
          setDraft(null)
          setInvalid(false)
          onChange(hex)
        }}
      />

      {/* Text input */}
      <input
        type="text"
        value={displayValue}
        aria-label={title ?? label ?? 'Colour value'}
        onChange={e => {
          setDraft(e.target.value)
          setInvalid(false)
        }}
        onBlur={e => {
          commit(e.target.value)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
        spellCheck={false}
        style={{
          fontFamily: 'monospace',
          fontSize: 12,
          color: EDITOR_TEXT_1,
          background: 'rgba(255,255,255,0.05)',
          border: invalid ? '1px solid rgba(255,80,80,0.85)' : '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          padding: '3px 7px',
          outline: invalid ? '2px solid rgba(255,80,80,0.4)' : 'none',
          width: allowAlpha ? 90 : 78,
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}
