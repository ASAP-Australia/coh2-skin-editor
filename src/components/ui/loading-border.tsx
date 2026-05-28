/**
 * LoadingBorder — animated beam that traces the perimeter of a container
 * while an async operation triggered inside it is in flight.
 *
 * Why a Web Worker + OffscreenCanvas (not SVG `stroke-dashoffset`):
 *   • The previous SVG implementation animated `stroke-dashoffset` via
 *     CSS keyframes. That property is paint-pipeline — its tick runs on
 *     the compositor's main thread. While the user is loading a vehicle
 *     model, Three.js / draco / cubemap decode stalls the main thread
 *     for 30–50 ms at a time, and the beam visibly drops frames.
 *   • Even `will-change: stroke-dashoffset` doesn't help: SVG attribute
 *     animations are not GPU-composited, the hint is a no-op for paths.
 *   • Solution: hand a canvas to a dedicated worker via
 *     `transferControlToOffscreen()`. The worker has its own thread of
 *     execution, so the model decode on main can't starve the marching
 *     beam.
 *
 * Why a marching beam (not a rotating conic):
 *   • The original implementation rotated a square painted with a
 *     conic-gradient and masked out everything except the rim. On a
 *     square that's fine, but on a 800 × 36 pill (the VehicleMenu) the
 *     bright sector spent 80 % of each rotation sweeping the long edges
 *     in a fraction of a second and then sat near-stationary while it
 *     "rotated" through the short ends. It read as a stutter even
 *     though the transform was perfectly smooth.
 *   • A constant-arc-length dash traces the perimeter at the same px / sec
 *     everywhere, regardless of aspect ratio — no jumps, no plateaus.
 *
 * Performance notes:
 *   • Only `lineDashOffset` updates per frame inside the worker. The
 *     Path2D, perimeter, dash array, and stroke styles are all cached
 *     and only rebuilt on resize / param change.
 *   • Glow is faked by stacking two strokes on the same path: a thicker,
 *     translucent halo under a thinner, opaque core. No `filter: blur`
 *     anywhere — that would re-rasterise the layer every frame.
 *   • A `ResizeObserver` posts size updates to the worker so the path
 *     stays in sync with the container's real pixel dimensions.
 *   • Fade-in / fade-out is a CSS `opacity` transition on the canvas
 *     element, which is compositor-only and stays smooth.
 *
 * Use case: a button (vehicle pill, season toggle) triggers async work
 * (RGT decode, cubemap load, RGM parse). The owning container renders
 * <LoadingBorder active={isLoading}>…</…> around its children. While
 * `active` is true, a glowing beam chases the container's outline;
 * when false, the wrapper becomes a passive `<div>` and adds nothing
 * visual.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

interface Props {
  /** Show the marching beam. Toggle false → wrapper renders nothing extra. */
  active: boolean
  /** Border-radius of the wrapped container — match the inner element so
   *  the beam traces the same rounded corners. Defaults to 16 px. */
  radius?: number
  /** Stroke width in px. Default 1.5. */
  thickness?: number
  /** Time in seconds for the beam to travel the full perimeter once.
   *  Default 1.6 — reads as "actively working" without feeling frantic. */
  duration?: number
  /** Beam length as a fraction of the perimeter. Default 0.22 (22 %).
   *  Smaller = more of a "comet"; larger = more of a "loading hoop". */
  beamFraction?: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

const HALO_COLOR = 'rgba(120,200,255,0.45)'
const CORE_COLOR = 'rgba(220,240,255,1)'
const FADE_MS = 220

export default function LoadingBorder({
  active,
  radius = 16,
  thickness = 1.5,
  duration = 1.6,
  beamFraction = 0.22,
  className = '',
  style,
  children,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const workerRef = useRef<Worker | null>(null)

  // Two-phase mount: `mounted` follows `active` going up immediately, but
  // lags going down by `FADE_MS` so the canvas can fade out instead of
  // disappearing in a single frame (which read as a "glitch" mid-load).
  // The `visible` flag drives opacity while mounted.
  const [mounted, setMounted] = useState(active)
  const [visible, setVisible] = useState(active)

  useEffect(() => {
    if (active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount before rAF opacity-up; intentional two-step to avoid transition skip
      setMounted(true)
      // Defer opacity-up by one frame so the browser registers the
      // initial `opacity: 0` before transitioning to 1 (otherwise the
      // transition is skipped and we get an instant pop-in).
      const r = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(r)
    }
    // Active just dropped — fade out, then unmount once the transition
    // has finished. If `active` flips back on during the fade, the
    // branch above re-runs and the timeout is cleared by cleanup, so
    // we resume from wherever opacity sat without unmounting.
    setVisible(false)
    const t = window.setTimeout(() => setMounted(false), FADE_MS)
    return () => window.clearTimeout(t)
  }, [active])

  // Stash the current param values in a ref so the worker-lifecycle
  // effect (which depends only on `mounted`) can pick them up without
  // re-running every time a numeric prop changes. Live param changes go
  // through the separate `params`-message effect below.
  const paramsRef = useRef({ radius, thickness, duration, beamFraction })
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern so worker can read current params without re-running the lifecycle effect
  paramsRef.current = { radius, thickness, duration, beamFraction }

  // Worker lifecycle: spin up on mount, tear down on unmount. Re-runs only
  // when `mounted` flips — so the worker stays alive across param changes
  // and isn't churned 60× / sec by ResizeObserver-driven box updates.
  useEffect(() => {
    if (!mounted) return
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    // Honour `prefers-reduced-motion` — skip the animation entirely.
    // The canvas still mounts (just blank) so the layout doesn't shift.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    ) {
      return
    }

    // Feature-detect OffscreenCanvas. If unavailable, degrade gracefully
    // (no beam, no error) — the parent container still renders its
    // children, the page just loses one piece of polish.
    const transfer = (
      canvas as HTMLCanvasElement & {
        transferControlToOffscreen?: () => OffscreenCanvas
      }
    ).transferControlToOffscreen
    if (typeof transfer !== 'function') return

    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const rect = wrap.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))

    // `transferControlToOffscreen` is a one-shot per <canvas> element.
    // We render a fresh <canvas> each time `mounted` flips true, so this
    // is safe — the canvas dies with the wrapper when mounted drops.
    let offscreen: OffscreenCanvas
    try {
      offscreen = transfer.call(canvas)
    } catch {
      // Some Electron versions wrap a partially-rendered canvas that has
      // already had a 2D context fetched; transferControlToOffscreen
      // throws InvalidStateError in that case. Fail silently.
      return
    }

    let worker: Worker
    try {
      worker = new Worker(new URL('./loading-border-worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch {
      return
    }
    workerRef.current = worker

    const p = paramsRef.current
    worker.postMessage(
      {
        type: 'init',
        canvas: offscreen,
        width: w,
        height: h,
        dpr,
        radius: p.radius,
        thickness: p.thickness,
        duration: p.duration,
        beamFraction: p.beamFraction,
        haloColor: HALO_COLOR,
        coreColor: CORE_COLOR,
      },
      [offscreen],
    )

    // Keep the canvas pixel dimensions in sync with the container's
    // actual size — same idea as the SVG version, just routed through
    // postMessage so the worker can rebuild the cached Path2D.
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cr = entry.contentRect
        const ww = Math.max(1, Math.round(cr.width))
        const hh = Math.max(1, Math.round(cr.height))
        worker.postMessage({ type: 'resize', width: ww, height: hh, dpr })
      }
    })
    ro.observe(wrap)

    return () => {
      ro.disconnect()
      try {
        worker.postMessage({ type: 'stop' })
      } catch {
        /* worker may be dead already */
      }
      worker.terminate()
      workerRef.current = null
    }
  }, [mounted])

  // Live param updates — cheap message-pass, no worker churn.
  useEffect(() => {
    const w = workerRef.current
    if (!w) return
    w.postMessage({
      type: 'params',
      radius,
      thickness,
      duration,
      beamFraction,
    })
  }, [radius, thickness, duration, beamFraction])

  // Wrapper is non-positioned by default — caller controls layout. Adds
  // `position: relative` only when active so we never disturb static-
  // positioned parents at idle.
  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: mounted ? 'relative' : style?.position,
        ...style,
      }}
    >
      {children}
      {mounted && (
        <canvas
          ref={canvasRef}
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            opacity: visible ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-out`,
            // Promote to its own composite layer so the canvas paint
            // doesn't have to re-rasterise the parent's backdrop-filter
            // on every frame.
            transform: 'translateZ(0)',
            willChange: 'opacity',
          }}
        />
      )}
    </div>
  )
}
