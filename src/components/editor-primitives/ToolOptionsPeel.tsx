/**
 * ToolOptionsPeel — small floating glass "peel" that surfaces options for
 * the currently-active tool above the BottomToolPill.
 *
 * The peel is keyed on the active tool id — when the id changes, the old
 * peel cross-fades out (140ms) and the new one cross-fades in (220ms),
 * with a small 60ms overlap so the surface never visually disappears. The
 * peel collapses entirely (returns null) when no tool is active.
 *
 * Visual recipe: lighter than the BottomToolPill (so it reads as a
 * sub-layer "lifting" off the pill, same trick as Apple's Control Center
 * sub-panels). Smaller corner radius (14 vs the pill's 16) keeps it from
 * looking like a second pill stacked on top.
 *
 * The peel is meant to be parked just above the pill (`bottom: ~88px` if
 * the pill is at `bottom: 24px`). Positioning is the parent's job.
 *
 * Implementation note: we deliberately do NOT mirror the latest children
 * into a ref — that would violate React's "no refs during render" rule
 * and produce stale-closure bugs across the fade-out boundary. Instead,
 * we drive the cross-fade off a single `displayId` piece of state and
 * derive the visible label/children directly from the active props once
 * the fade-in phase commits. The fade-out window briefly shows the OLD
 * `displayId` mapped through the parent's children prop — but during a
 * fade the peel is `opacity: 0` and `pointer-events: none`, so the user
 * never sees the transient mismatch.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

interface Props {
  /** Stable identifier for the active tool. When this changes, the peel
   *  cross-fades to the new children. Pass `null` to hide the peel. */
  activeId: string | null
  /** Optional accessible label for the peel wrapper (screen-reader only —
   *  the heading text is NOT rendered visually). */
  label?: string
  /** The option controls themselves — sliders, swatches, toggles. */
  children: ReactNode
  /** Inline style override — primarily positioning. */
  style?: CSSProperties
  /** Optional extra className for the peel. */
  className?: string
}

export default function ToolOptionsPeel({ activeId, label, children, style, className }: Props) {
  // `displayId` is the tool whose contents are currently visible. When
  // the user picks a new tool we drop `phase` to `out` (140ms fade), then
  // commit the new id and bounce back to `in` (220ms fade). The peel
  // never re-renders during the out phase except for the opacity tween.
  const [displayId, setDisplayId] = useState<string | null>(activeId)
  const [phase, setPhase] = useState<'in' | 'out' | 'idle'>(activeId ? 'in' : 'idle')

  useEffect(() => {
    if (activeId === displayId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- two-stage cross-fade animation: kick phase to 'out', then commit new id + 'in' after 140ms. No cascade — both setState calls are bounded by the activeId/displayId equality guard above.
    setPhase('out')
    const t = window.setTimeout(() => {
      setDisplayId(activeId)
      setPhase(activeId ? 'in' : 'idle')
    }, 140)
    return () => window.clearTimeout(t)
  }, [activeId, displayId])

  if (displayId === null && phase === 'idle') return null

  // Recipe is intentionally lighter than the pill — slightly more
  // saturated black for contrast, but the same hairline stroke + soft
  // drop shadow so it reads as part of the same family.
  const peelStyle: CSSProperties = {
    background: 'rgba(20, 20, 20, 0.74)',
    backdropFilter: 'blur(32px) saturate(180%)',
    WebkitBackdropFilter: 'blur(32px) saturate(180%)',
    border: '0.5px solid rgba(255,255,255,0.10)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
    borderRadius: 14,
    padding: '8px 10px',
    opacity: phase === 'out' ? 0 : 1,
    transform: phase === 'out' ? 'translateY(4px)' : 'translateY(0)',
    transition:
      'opacity 220ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    pointerEvents: phase === 'out' ? 'none' : 'auto',
    ...style,
  }

  return (
    <div
      role="group"
      aria-label={label ? `${label} options` : 'Tool options'}
      // `flex-nowrap` (was `flex-wrap`) — the user reported "every time I
      // click draw, it makes the the tool tab wider" because flex-wrap was
      // pushing the Draw peel's last two buttons to a second row, growing
      // the peel vertically. With nowrap the peel keeps a constant height
      // and only widens horizontally when a tool has more controls than
      // the minWidth set by its caller. `items-center` keeps every child
      // (sliders, swatches, toggles) vertically centred on a single row.
      className={
        'l01-ring flex flex-row items-center gap-2 flex-nowrap' + (className ? ' ' + className : '')
      }
      style={peelStyle}
    >
      {children}
    </div>
  )
}
