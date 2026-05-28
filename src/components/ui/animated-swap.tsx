/**
 * AnimatedSwap — reusable downward-cascade content swap.
 *
 * When `swapKey` changes the current children animate OUT (slide up, fade)
 * then the new children animate IN (slide down, fade). The "downward cascade"
 * direction convention is:
 *
 *   Exit  → content slides UPWARD off the top  (translateY 0 → -10px, opacity 1 → 0)
 *   Enter → content slides DOWNWARD into place  (translateY -10px → 0, opacity 0 → 1)
 *
 * This matches the global AuthShell MorphIn/MorphOut convention and the
 * View Transitions CSS in index.css.
 *
 * Usage:
 *   <AnimatedSwap swapKey={phase}>
 *     {currentContent}
 *   </AnimatedSwap>
 *
 * Timing (matches the app's existing cubic-bezier language):
 *   out: 160ms ease-in
 *   gap: 60ms  (out-end → in-start, so it reads sequential not crossfade)
 *   in:  220ms cubic-bezier(.32, .72, 0, 1)
 *
 * prefers-reduced-motion: falls back to instant swap (no animation).
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const OUT_MS = 160
const GAP_MS = 60
const IN_MS = 220
const OUT_EASE = 'ease-in'
const IN_EASE = 'cubic-bezier(.32, .72, 0, 1)'

/** True if the user has opted into reduced motion. */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Props {
  /** Changing this key triggers the out→gap→in animation sequence. */
  swapKey: string | number
  children: ReactNode
  /** Extra className applied to the outer wrapper div. */
  className?: string
  /** When true the wrapper is `display:block` rather than `inline-block`. */
  block?: boolean
}

type AnimState =
  | { phase: 'idle' }
  | { phase: 'out' }
  // 'pre-in': children already swapped, waiting one rAF for browser to
  // commit the initial hidden position before starting the in transition.
  | { phase: 'pre-in' }
  | { phase: 'in' }

export function AnimatedSwap({ swapKey, children, className, block }: Props) {
  // The node that is currently rendered inside the animated wrapper.
  const [node, setNode] = useState<ReactNode>(children)
  const [activeKey, setActiveKey] = useState<string | number>(swapKey)
  const [anim, setAnim] = useState<AnimState>({ phase: 'idle' })

  // Latest desired children + key, captured so rapid key changes don't
  // cause stale closures in the timer sequence.
  const latestRef = useRef<{ key: string | number; node: ReactNode }>({
    key: swapKey,
    node: children,
  })
  // Update the ref after each render (not during) to avoid the
  // react-hooks/refs "cannot update ref during render" lint error.
  useLayoutEffect(() => {
    latestRef.current = { key: swapKey, node: children }
  })

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const rafRef = useRef<number | null>(null)

  // Cleanup on unmount.
  useEffect(() => {
    const timers = timersRef.current
    const raf = rafRef.current
    return () => {
      timers.forEach(t => clearTimeout(t))
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    // swapKey matches what we're showing — nothing to animate.
    // Children freshness is handled by rendering `children` directly in the
    // idle+matched case (see render below), so no setState needed here.
    if (swapKey === activeKey) {
      return
    }

    // Cancel any in-flight timers / rAF so they don't interfere.
    timersRef.current.forEach(t => clearTimeout(t))
    timersRef.current = []
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    // Reduced-motion: instant swap, no animation. Schedule the state update
    // via setTimeout so it's not a synchronous setState inside an effect.
    if (prefersReducedMotion()) {
      const t = setTimeout(() => {
        setNode(latestRef.current.node)
        setActiveKey(latestRef.current.key)
        setAnim({ phase: 'idle' })
      }, 0)
      timersRef.current.push(t)
      return
    }

    // Phase 1: OUT — current node slides up and fades.
    // Use a zero-delay setTimeout so the state update is not synchronous
    // within the effect body (satisfies react-hooks/set-state-in-effect).
    const t0 = setTimeout(() => { setAnim({ phase: 'out' }) }, 0)
    timersRef.current.push(t0)

    const t1 = setTimeout(() => {
      // Phase 2: swap to the latest node while invisible (end of 'out').
      const latest = latestRef.current
      setNode(latest.node)
      setActiveKey(latest.key)
      // Set 'pre-in': component renders children at translateY(-10px) opacity:0.
      // We need at least one browser paint at that state before we trigger the
      // 'in' transition, otherwise the browser skips the initial state and we
      // see no animation. Use double-rAF (same technique as AuthShell MorphIn).
      setAnim({ phase: 'pre-in' })

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          // Phase 3: IN — new node slides down and fades in.
          setAnim({ phase: 'in' })

          const t2 = setTimeout(() => {
            setAnim({ phase: 'idle' })
          }, IN_MS)
          timersRef.current.push(t2)
        })
      })
    }, OUT_MS + GAP_MS)
    timersRef.current.push(t1)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapKey])

  // Derive the inline style for the animated inner div.
  let innerStyle: React.CSSProperties
  switch (anim.phase) {
    case 'out':
      innerStyle = {
        opacity: 0,
        transform: 'translateY(-10px)',
        transition: `opacity ${OUT_MS}ms ${OUT_EASE}, transform ${OUT_MS}ms ${OUT_EASE}`,
        pointerEvents: 'none',
      }
      break
    case 'pre-in':
      // Snap to the hidden-above starting position instantly (no transition).
      innerStyle = {
        opacity: 0,
        transform: 'translateY(-10px)',
      }
      break
    case 'in':
      innerStyle = {
        opacity: 1,
        transform: 'translateY(0)',
        transition: `opacity ${IN_MS}ms ${IN_EASE}, transform ${IN_MS}ms ${IN_EASE}`,
      }
      break
    default:
      // idle — fully visible, no transition active.
      innerStyle = { opacity: 1, transform: 'translateY(0)' }
  }

  return (
    <div
      className={className}
      style={{
        display: block ? 'block' : 'inline-flex',
        // Clip overflowing content during the translateY travel so
        // out-animating nodes don't bleed outside the component's bounds.
        overflow: 'hidden',
        // Preserve the natural layout width of the children.
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* When idle and the displayed key matches the desired key, render
          children directly so content stays fresh without calling setState. */}
      <div style={innerStyle}>{anim.phase === 'idle' && swapKey === activeKey ? children : node}</div>
    </div>
  )
}
