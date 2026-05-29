/**
 * GlassSegmented — Apple-style glass segmented control with a sliding pill
 * indicator. Used by PublishSection and PublishToWorkshopDialog so both
 * publish surfaces share identical visual + interaction.
 *
 * Clicking an option invokes onClick immediately (no separate confirm step).
 * During busy state the buttons are disabled and the cursor shows "progress".
 * The active option shows a SmallSpinner next to its label.
 */

import { type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// SmallSpinner — inline spinner for use inside button labels
// ---------------------------------------------------------------------------

function SmallSpinner() {
  return (
    <>
      <style>{`@keyframes gs-spin { to { transform: rotate(360deg); } }`}</style>
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          display: 'inline-block',
          flex: 'none',
          borderRadius: '50%',
          background:
            'conic-gradient(from 0deg, transparent 0%, rgba(247,247,250,0.15) 30%, rgba(247,247,250,0.7) 100%)',
          WebkitMask: 'radial-gradient(circle, transparent 3.5px, #000 4px)',
          mask: 'radial-gradient(circle, transparent 3.5px, #000 4px)',
          animation: 'gs-spin 0.8s linear infinite',
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// GlassSegmented
// ---------------------------------------------------------------------------

export interface GlassSegmentedOption {
  /** Display label rendered in the button. */
  label: string
  /** Value passed back to onClick. */
  value: number
}

export interface GlassSegmentedProps {
  options: GlassSegmentedOption[]
  /** Index (0-based) of the currently selected/highlighted option. */
  selectedIndex: number
  /** While true: buttons disabled, cursor "progress", spinner on active option. */
  disabled?: boolean
  /** Called when the user clicks an option (also the publish trigger). */
  onClick: (value: number, index: number) => void
  /** Optional footer content rendered below the control track. */
  footer?: ReactNode
}

export function GlassSegmented({
  options,
  selectedIndex,
  disabled = false,
  onClick,
  footer,
}: GlassSegmentedProps) {
  const n = options.length

  return (
    <div>
      {/* Outer glass track */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          borderRadius: 14,
          background: 'rgba(255,255,255,0.04)',
          padding: 4,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxSizing: 'border-box',
          // CSS custom property drives the sliding pill position
          ['--selected-index' as string]: String(selectedIndex),
        }}
      >
        {/* Sliding highlight pill — absolutely positioned, slides via CSS left */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            // width = (trackWidth - 2*padding) / numOptions; padding = 4px each side
            width: `calc((100% - 8px) / ${n})`,
            left: `calc(4px + ((100% - 8px) / ${n}) * var(--selected-index, 0))`,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.11)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.15) inset, 0 0 0 1px rgba(255,255,255,0.07)',
            transition: 'left 300ms cubic-bezier(.32, .72, 0, 1)',
            pointerEvents: 'none',
          }}
        />
        {/* Option buttons rendered above the pill */}
        {options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onClick(opt.value, i)}
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              padding: '6px 2px',
              borderRadius: 10,
              fontSize: 11,
              fontWeight: selectedIndex === i ? 600 : 500,
              border: 'none',
              background: 'transparent',
              cursor: disabled ? 'progress' : 'pointer',
              color: selectedIndex === i
                ? 'rgba(247,247,250,0.95)'
                : 'rgba(247,247,250,0.52)',
              transition: 'color 200ms ease',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {disabled && selectedIndex === i ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <SmallSpinner />
                {opt.label}
              </span>
            ) : (
              opt.label
            )}
          </button>
        ))}
      </div>

      {footer}
    </div>
  )
}
