/**
 * SliderRow — the canonical label + range + value-readout row.
 *
 * Three places in the codebase implemented near-identical sliders:
 *   • FaceplateEditor's `FilterSlider` — 8 adjustment sliders with
 *     identity-dimming (value reads grey when at no-op, blue otherwise).
 *   • DecalPackEditor's `Slider` — scale / rotation / opacity with a
 *     `format` callback.
 *   • BrushPanel's local `Slider` — brush size / spacing / hardness, using
 *     the orange accent because the brush tool feels different from
 *     image-adjustment context.
 *
 * SliderRow unifies all three. The `identity` prop is optional — pass it
 * for adjustment-style sliders to enable value-dimming when untouched.
 * The `accent` prop overrides the default blue thumb for tool contexts
 * (BrushPanel passes `'accent'` to use the orange Brigade colour).
 *
 * Accessibility:
 *   • The slider's `aria-label` is built from `label + ': ' + readout` so
 *     screen readers announce the current value in addition to the slot
 *     name. This is cheaper than wiring up a separate `aria-describedby`
 *     for each slider — and matches the inline FilterSlider behaviour.
 *   • The label + readout pair is a sibling of the `<input>` rather than
 *     wrapping it, because jsx-a11y can't statically verify a `<label>`'s
 *     accessible name when the `<span>` text inside it is the value
 *     readout (which changes as the user drags).
 */

import { useCallback, type ChangeEvent, type CSSProperties } from 'react'
import { EDITOR_ACCENT, EDITOR_TEXT_2, EDITOR_TEXT_4 } from './tokens'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (next: number) => void
  /** Optional unit appended to the raw value when `format` is absent.
   *  Example: `unit="px"` produces "12px". */
  unit?: string
  /** Optional formatter — converts the raw value to a display string.
   *  Takes precedence over `unit`. */
  format?: (v: number) => string
  /** Optional no-op value. When the current `value` equals `identity`, the
   *  readout dims to a muted grey so a panel full of identity sliders
   *  doesn't visually shout. Without `identity`, the readout always uses
   *  the active blue. */
  identity?: number
  /** Thumb accent colour — defaults to the editor blue. Pass a Tailwind
   *  CSS variable string like `var(--color-accent)` to use the brand
   *  orange (BrushPanel context). */
  accent?: string
  /** Disable interaction without removing the row from the layout. */
  disabled?: boolean
  /** Additional style overrides for the row wrapper. */
  style?: CSSProperties
}

export default function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit,
  format,
  identity,
  accent = EDITOR_ACCENT,
  disabled = false,
  style,
}: Props) {
  const display = format ? format(value) : `${value}${unit ?? ''}`
  const isIdentity = identity !== undefined && value === identity

  const handle = useCallback(
    (ev: ChangeEvent<HTMLInputElement>) => {
      const next = parseFloat(ev.target.value)
      if (Number.isFinite(next)) onChange(next)
    },
    [onChange],
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: EDITOR_TEXT_2,
          letterSpacing: 0.2,
        }}
      >
        <span>{label}</span>
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            color: isIdentity ? EDITOR_TEXT_4 : accent,
          }}
        >
          {display}
        </span>
      </div>
      <input
        type="range"
        aria-label={`${label}: ${display}`}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handle}
        style={{ width: '100%', accentColor: accent }}
      />
    </div>
  )
}
