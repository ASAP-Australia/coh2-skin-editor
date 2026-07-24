/**
 * ViewportGuard — wraps a Three.js <Viewport> (or any WebGL canvas) so that a
 * machine without working WebGL degrades to a friendly inline placeholder
 * instead of white-screening the entire app.
 *
 * Two layers of defence:
 *   1. PRE-FLIGHT: `isWebGLAvailable()` is checked before the children are
 *      rendered. If WebGL can't be created we render the placeholder and never
 *      construct the WebGLRenderer at all (which is what throws on broken GPUs).
 *   2. CATCH-ALL: even when the probe says WebGL is available, renderer
 *      construction can still throw (driver crash, context lost mid-init).
 *      The children are wrapped in <ErrorBoundary> whose fallback is the SAME
 *      placeholder, so a throw is caught and the rest of the app keeps running.
 *
 * The placeholder fills the guard's layout box (w-full h-full) so surrounding
 * toolbars/panels aren't disturbed. On a real machine with WebGL, this wrapper
 * is transparent — it renders `children` unchanged.
 *
 * `warmupOnly` guards (the headless 1×1 background/connect warmers) pass
 * `silent` so they degrade to `null` instead of showing a visible placeholder
 * — there's nothing on screen for them anyway.
 */

import { useMemo, type ReactNode } from 'react'
import ErrorBoundary from '@/components/ErrorBoundary'
import { isWebGLAvailable } from '@/lib/webgl-support'

interface Props {
  children: ReactNode
  /** Headless/offscreen mounts render nothing (not a card) when WebGL is
   *  missing or a throw is caught. Defaults to false. */
  silent?: boolean
  /** Label surfaced in console.error via the ErrorBoundary. */
  label?: string
}

/** The inline "3D preview unavailable" card. Fills its parent box and uses the
 *  same glass-2 recipe as the Viewport's own loading/error overlays. */
export function WebGLUnavailablePlaceholder(): ReactNode {
  return (
    <div className="relative w-full h-full grid place-items-center" role="status">
      <div className="glass-2 rounded-xl px-4 py-3 text-[12px] max-w-xs text-center leading-relaxed text-[var(--color-text-2)]">
        <div className="font-medium text-[var(--color-text-1)] mb-1">3D preview unavailable</div>
        <div className="text-[var(--color-text-3)]">
          Your browser or GPU doesn&rsquo;t support WebGL. The rest of the editor still works.
        </div>
      </div>
    </div>
  )
}

export default function ViewportGuard({ children, silent = false, label = 'Viewport' }: Props): ReactNode {
  // Probe once per mount. Result is memoised in the module too, so this is
  // cheap; re-evaluating per render is harmless but avoided.
  const webglOk = useMemo(() => isWebGLAvailable(), [])

  const fallback: ReactNode = silent ? null : <WebGLUnavailablePlaceholder />

  // Pre-flight: don't even attempt to construct the renderer.
  if (!webglOk) return fallback

  // WebGL looked available — mount the real subtree, but catch a late throw.
  return (
    <ErrorBoundary label={label} fallback={fallback}>
      {children}
    </ErrorBoundary>
  )
}
