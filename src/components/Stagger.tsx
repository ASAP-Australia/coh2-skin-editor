/**
 * Stagger — wraps each direct child in a div that fades + drifts in (or
 * out) with a per-index delay. Used by the pre-editor screens
 * (ConnectScreen, StartScreen) so the user reads the transition as a
 * sequence of elements animating, not a single screen morphing.
 *
 * Usage:
 *   <Stagger mode={exiting ? 'exit' : 'enter'}>
 *     <h1>…</h1>
 *     <ul>…</ul>
 *     <button>…</button>
 *   </Stagger>
 *
 * The wrapper does the heavy lifting:
 *   - On mount in `enter` mode, every child starts at (opacity 0,
 *     translateY +drift) and animates to (1, 0) staggered by `step`,
 *     TOP-DOWN: the title goes first, the button last.  Reads as
 *     "content arriving from above".
 *   - On flipping to `exit` mode, the stagger order is REVERSED — the
 *     last (bottom) element leaves first, the first (top) element
 *     leaves last.  Reads as "content peeling away upward" and dovetails
 *     with the next screen's top-down enter so the two transitions
 *     meet in the middle rather than fighting each other.
 *
 * `staggerDuration(childCount, …)` is exported so the parent can match
 * its setTimeout to the exact moment the last element finishes its
 * animation — important when a screen swap is gated on this completing.
 * Both enter and exit have the same total duration, so the same helper
 * works for both modes.
 */

import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react'

// Tuned for an unhurried feel — the previous 55/320 was snappy enough
// that the eye couldn't really track which element moved when.  At
// 110/520 each element gets a clearly distinct beat: you see the title
// settle, then the bullets, then the button.
const DEFAULT_STEP = 140
const DEFAULT_DURATION = 680
const DEFAULT_DRIFT = 8
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

interface StaggerProps {
  /** 'enter' fades elements in on mount; 'exit' fades them out (used by
   *  the parent to drive a coordinated leave animation). */
  mode: 'enter' | 'exit'
  /** Delay between successive children, ms. Default 55. */
  step?: number
  /** Each child's transition duration, ms. Default 320. */
  duration?: number
  /** Initial delay applied to the first child, ms. Default 0. */
  initialDelay?: number
  /** Vertical drift in px. Positive = enter from below / exit upward. */
  drift?: number
  /** Children rendered inside the staggered grid. Optional at the type
   *  level so callers can pass children via the variadic `createElement`
   *  api without TypeScript complaining about a missing `children` prop;
   *  runtime treats empty/absent children as a no-op (Children.toArray
   *  returns []). */
  children?: ReactNode
}

/** Compute the total wall-clock time a stagger animation will take, so
 *  the parent can sequence a follow-up action exactly. */
// eslint-disable-next-line react-refresh/only-export-components -- utility function intentionally co-located with the Stagger component it describes
export function staggerDuration(
  childCount: number,
  step: number = DEFAULT_STEP,
  duration: number = DEFAULT_DURATION,
  initialDelay: number = 0,
): number {
  if (childCount <= 0) return 0
  return initialDelay + (childCount - 1) * step + duration
}

export default function Stagger({
  mode,
  step = DEFAULT_STEP,
  duration = DEFAULT_DURATION,
  initialDelay = 0,
  drift = DEFAULT_DRIFT,
  children,
}: StaggerProps) {
  // Two-frame trick: render hidden on first paint, flip to shown on the
  // next frame so the browser commits the initial state before the
  // transition runs. Without this the elements would jump straight to
  // visible because React batches the initial style with the transition.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (mode !== 'enter') return
    const r = requestAnimationFrame(() => {
      requestAnimationFrame(() => setShown(true))
    })
    return () => cancelAnimationFrame(r)
  }, [mode])

  // In 'exit' mode we want to start in the shown state and animate to
  // hidden. The `exiting` flag flips true once on mount so the next
  // render commits the hidden styles.
  const [exiting, setExiting] = useState(false)
  useEffect(() => {
    if (mode !== 'exit') return
    const r = requestAnimationFrame(() => {
      requestAnimationFrame(() => setExiting(true))
    })
    return () => cancelAnimationFrame(r)
  }, [mode])

  // Filter out falsy/null children but preserve their original order so
  // the stagger indices line up with what the user actually sees.
  // (Conditional banners like `error && <Banner/>` are common.)
  const visibleChildren = Children.toArray(children).filter(c => {
    // Children.toArray() already strips null/undefined/boolean, but keep
    // the explicit check for clarity / defence-in-depth.
    if (c == null) return false
    if (isValidElement(c)) return true
    return true
  })

  const lastIdx = visibleChildren.length - 1

  return (
    <>
      {visibleChildren.map((child, i) => {
        // Enter: top-down — index 0 has delay 0, last index has the
        // longest delay.  Exit: bottom-up — last index has delay 0,
        // index 0 has the longest delay.  This makes the screen feel
        // like it's being unrolled upward as it leaves, and unrolled
        // downward as the next one arrives.
        const order = mode === 'exit' ? lastIdx - i : i
        const delay = initialDelay + order * step
        // `enter`: start hidden, animate to visible
        // `exit`:  start visible, animate to hidden
        const isHidden = mode === 'enter' ? !shown : exiting
        const driftSign = mode === 'exit' ? -1 : 1 // exit goes up; enter starts below
        const translateY = isHidden ? `${driftSign * drift}px` : '0px'
        return (
          <div
            // Use the index as the key — children are positional inside
            // each screen and never re-order, so this is stable.
            key={i}
            style={{
              opacity: isHidden ? 0 : 1,
              transform: `translateY(${translateY})`,
              transition:
                `opacity ${duration}ms ${EASE} ${delay}ms, ` +
                `transform ${duration}ms ${EASE} ${delay}ms`,
              // Don't let stagger wrappers intercept clicks during exit
              // — the screen underneath is becoming the interaction
              // target.
              pointerEvents: mode === 'exit' ? 'none' : undefined,
            }}
          >
            {child}
          </div>
        )
      })}
    </>
  )
}
