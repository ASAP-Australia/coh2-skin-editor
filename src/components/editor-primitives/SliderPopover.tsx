/**
 * SliderPopover — icon button that opens a small floating popover
 * containing a vertical (rotated) range slider + numeric readout.
 *
 * Intended for tool-peel controls where inline label+slider would make
 * the peel wider than the bottom toolbar. The icon button is 28×28 px
 * (same footprint as the existing toggle buttons in the peels); the
 * popover floats directly above it and auto-closes on outside click or
 * Escape.
 *
 * Props are a subset of SliderRow — same value/min/max/step/format
 * contract so the two are interchangeable at the call site.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EDITOR_ACCENT, EDITOR_TEXT_2, EDITOR_TEXT_4 } from './tokens'

interface Props {
  /** Icon shown on the button (Lucide node, 14–16px). */
  icon: ReactNode
  /** Used as button `title` / `aria-label` and popover heading. */
  title: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /** Optional formatter — same contract as SliderRow. */
  format?: (v: number) => string
  /** Optional no-op value — readout dims when the value equals identity. */
  identity?: number
  /** Whether the button appears in an active/selected state (accent border). */
  active?: boolean
}

export default function SliderPopover({
  icon,
  title,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  identity,
  active = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const display = format ? format(value) : String(value)
  const isIdentity = identity !== undefined && value === identity

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = parseFloat(e.target.value)
      if (Number.isFinite(next)) onChange(next)
    },
    [onChange],
  )

  const btnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 6,
    background: active || open ? 'rgba(186,150,90,0.22)' : 'rgba(255,255,255,0.06)',
    border: `1px solid ${active || open ? 'rgba(186,150,90,0.6)' : 'rgba(255,255,255,0.12)'}`,
    color: active || open ? EDITOR_ACCENT : EDITOR_TEXT_2,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  }

  const popoverStyle: CSSProperties = {
    position: 'absolute',
    bottom: 36,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 200,
    background: 'rgba(20, 20, 20, 0.96)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '0.5px solid rgba(255,255,255,0.12)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    minWidth: 44,
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={btnStyle}
      >
        {icon}
      </button>

      {open && (
        <div className="l01-ring" style={popoverStyle} role="dialog" aria-label={`${title} slider`}>
          {/* Numeric readout */}
          <span
            style={{
              fontSize: 10,
              fontVariantNumeric: 'tabular-nums',
              color: isIdentity ? EDITOR_TEXT_4 : EDITOR_ACCENT,
              minWidth: 28,
              textAlign: 'center',
            }}
          >
            {display}
          </span>
          {/* Vertical slider — rotate the horizontal track 270° */}
          <input
            type="range"
            aria-label={`${title}: ${display}`}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            style={{
              writingMode: 'vertical-lr',
              direction: 'rtl',
              width: 20,
              height: 110,
              accentColor: EDITOR_ACCENT,
              cursor: 'pointer',
            }}
          />
        </div>
      )}
    </div>
  )
}
