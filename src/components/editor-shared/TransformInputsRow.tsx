/**
 * TransformInputsRow — compact X / Y / W / H / angle number inputs for the
 * selected object's transform. Used in both DecalPackEditor (transform peel)
 * and FaceplateEditor (select peel) so both editors share identical UI and
 * update behaviour.
 *
 * • W / H are expressed in canvas-space pixels (natural size × scale). Writing
 *   them back converts to the scale field: newScale = newW / naturalW.
 * • angle is in degrees (normalised to (−180, 180] by the parent's
 *   normaliseRotation helper, which must be passed as onChangeAngle).
 * • All inputs commit on blur or Enter (step=1).
 * • When the selected object is null the inputs are rendered but disabled.
 */

import type { CSSProperties } from 'react'
import { useRef, useState, type JSX } from 'react'
import { EDITOR_TEXT_2, EDITOR_TEXT_4 } from '@/components/editor-primitives/tokens'

export interface TransformInputsRowProps {
  /** Center X in canvas-space pixels. */
  x: number
  /** Center Y in canvas-space pixels. */
  y: number
  /** On-canvas width = naturalW × scale (may differ from naturalW if scale ≠ 1). */
  w: number
  /** On-canvas height = naturalH × scale (may differ from naturalH if scale ≠ 1). */
  h: number
  /** Rotation in degrees. */
  angle: number
  /** Called when the user commits a new X. */
  onChangeX: (v: number) => void
  /** Called when the user commits a new Y. */
  onChangeY: (v: number) => void
  /**
   * Called when the user commits a new W. The parent should convert
   * newW → newScale = newW / naturalW and apply via history engine.
   */
  onChangeW: (v: number) => void
  /**
   * Called when the user commits a new H. For uniform-scale objects the
   * parent may keep W/H in lock-step; for non-uniform (image) the parent
   * writes scaleY = newH / naturalH.
   */
  onChangeH: (v: number) => void
  /** Called when the user commits a new angle (degrees). */
  onChangeAngle: (v: number) => void
  /** When true the inputs are visually present but non-interactive. */
  disabled?: boolean
  /** Layout mode: 'row' (default, all in one line) or 'grid' (X/Y, W/H, °). */
  layout?: 'row' | 'grid'
}

const numInputStyle: CSSProperties = {
  width: 50,
  height: 26,
  background: 'rgba(255,255,255,0.05)',
  border: '0.5px solid rgba(255,255,255,0.12)',
  borderRadius: 5,
  color: EDITOR_TEXT_2,
  fontSize: 11,
  padding: '0 5px',
  outline: 'none',
  appearance: 'textfield',
  MozAppearance: 'textfield',
}

const labelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  flexShrink: 0,
}

const tagStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: EDITOR_TEXT_4,
  flexShrink: 0,
}

/**
 * NumField — a number input that commits its value only on blur or Enter.
 * Local draft state keeps the raw string so the user can type freely (including
 * decimals, minus sign, partial values) without per-keystroke commits to the
 * undo history. Esc reverts the draft to the last committed value.
 */
function NumField({
  tag,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  tag: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  // Tracks whether Escape was pressed so onBlur can skip committing the draft.
  const escapedRef = useRef(false)
  const displayValue = draft ?? String(Math.round(value))

  const commit = (raw: string) => {
    const v = parseFloat(raw)
    if (Number.isFinite(v)) onChange(v)
    setDraft(null)
  }

  return (
    <label style={labelStyle}>
      <span style={tagStyle}>{tag}</span>
      <input
        type="number"
        style={{ ...numInputStyle, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : undefined }}
        value={displayValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => {
          if (escapedRef.current) {
            escapedRef.current = false
            return
          }
          commit(e.target.value)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit((e.target as HTMLInputElement).value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            escapedRef.current = true
            setDraft(null)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        onClick={e => (e.target as HTMLInputElement).select()}
      />
    </label>
  )
}

/**
 * NumFieldInline — a borderless variant that takes an explicit `style` override.
 * Used by the grid layout in PropertiesPanel where inputs are flex-1 and share a row.
 */
function NumFieldInline({
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
  label,
  style,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (v: number) => void
  label: string
  style?: CSSProperties
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const escapedRef = useRef(false)
  const displayValue = draft ?? String(Math.round(value))

  const commit = (raw: string) => {
    const v = parseFloat(raw)
    if (Number.isFinite(v)) onChange(v)
    setDraft(null)
  }

  return (
    <input
      type="number"
      aria-label={label}
      style={{ ...style, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : undefined }}
      value={displayValue}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => {
        if (escapedRef.current) {
          escapedRef.current = false
          return
        }
        commit(e.target.value)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit((e.target as HTMLInputElement).value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          escapedRef.current = true
          setDraft(null)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      onClick={e => (e.target as HTMLInputElement).select()}
    />
  )
}

export default function TransformInputsRow({
  x,
  y,
  w,
  h,
  angle,
  onChangeX,
  onChangeY,
  onChangeW,
  onChangeH,
  onChangeAngle,
  disabled,
  layout = 'row',
}: TransformInputsRowProps) {
  if (layout === 'grid') {
    // Properties panel grid layout: X/Y row, W/H row, ° row
    // Each pair is in a flex row with equal-width inputs for visual alignment.
    const gridRowStyle: CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    }
    const gridInputStyle: CSSProperties = {
      flex: 1,
      minWidth: 0,
      height: 26,
      background: 'rgba(255,255,255,0.05)',
      border: '0.5px solid rgba(255,255,255,0.12)',
      borderRadius: 5,
      color: EDITOR_TEXT_2,
      fontSize: 11,
      padding: '0 5px',
      outline: 'none',
      appearance: 'textfield',
      MozAppearance: 'textfield',
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={gridRowStyle}>
          <span style={tagStyle}>X</span>
          <NumFieldInline value={x} style={gridInputStyle} disabled={disabled} onChange={onChangeX} label="X" />
          <span style={tagStyle}>Y</span>
          <NumFieldInline value={y} style={gridInputStyle} disabled={disabled} onChange={onChangeY} label="Y" />
        </div>
        <div style={gridRowStyle}>
          <span style={tagStyle}>W</span>
          <NumFieldInline value={w} min={1} style={gridInputStyle} disabled={disabled} onChange={onChangeW} label="Width" />
          <span style={tagStyle}>H</span>
          <NumFieldInline value={h} min={1} style={gridInputStyle} disabled={disabled} onChange={onChangeH} label="Height" />
        </div>
        <div style={{ ...gridRowStyle, marginBottom: 0 }}>
          <span style={tagStyle}>°</span>
          <NumFieldInline value={angle} min={-180} max={180} style={{ ...gridInputStyle, maxWidth: '50%' }} disabled={disabled} onChange={onChangeAngle} label="Rotation" />
        </div>
      </div>
    )
  }

  return (
    <>
      <NumField tag="X" value={x} disabled={disabled} onChange={onChangeX} />
      <NumField tag="Y" value={y} disabled={disabled} onChange={onChangeY} />
      <NumField tag="W" value={w} min={1} disabled={disabled} onChange={onChangeW} />
      <NumField tag="H" value={h} min={1} disabled={disabled} onChange={onChangeH} />
      <NumField tag="°" value={angle} min={-180} max={180} disabled={disabled} onChange={onChangeAngle} />
    </>
  )
}
