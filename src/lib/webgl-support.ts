/**
 * webgl-support — lightweight, dependency-free WebGL capability probe.
 *
 * Used to decide, BEFORE constructing a Three.js WebGLRenderer, whether the
 * browser/GPU can actually create a WebGL context. On machines with no or
 * broken WebGL (VMs, remote desktop, some drivers, headless browsers),
 * `new WebGLRenderer(...)` throws during React render — and without an error
 * boundary that unmounts the whole app to a blank white screen.
 *
 * This module deliberately does NOT import Three.js: it spins up a throwaway
 * <canvas> and tries `getContext('webgl2')` / `getContext('webgl')` directly,
 * so the check is cheap and adds nothing to the Three.js chunk.
 */

/** Cached result — the answer can't meaningfully change within a session
 *  (a GPU doesn't appear/disappear mid-run), so probe at most once. */
let _cached: boolean | null = null

/**
 * Returns true if the environment can create a WebGL (2 or 1) rendering
 * context, false otherwise. Never throws — any failure (missing API,
 * context-creation error, SecurityError) resolves to `false`.
 *
 * The result is memoised after the first call. Pass `{ force: true }` to
 * re-probe (e.g. a test that mutates the environment).
 */
export function isWebGLAvailable(opts?: { force?: boolean }): boolean {
  if (_cached !== null && !opts?.force) return _cached

  _cached = probe()
  return _cached
}

function probe(): boolean {
  // No DOM (SSR / worker without OffscreenCanvas) → treat as unavailable
  // rather than throwing.
  if (typeof document === 'undefined') return false

  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = document.createElement('canvas')
    // `failIfMajorPerformanceCaveat` is intentionally NOT set — a software
    // (SwiftShader) context still lets Three.js render, so we accept it here.
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      // Legacy prefix, still present on some older embedded webviews.
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)

    if (!gl) return false

    // Some environments hand back a context object but immediately report it
    // as lost (driver "Disabled"). Treat a lost context as unavailable.
    if (typeof gl.isContextLost === 'function' && gl.isContextLost()) {
      return false
    }
    return true
  } catch {
    // getContext can throw (SecurityError, driver crash) — swallow and report
    // "unavailable" so the caller shows a placeholder instead of white-screening.
    return false
  } finally {
    // Best-effort teardown of the throwaway canvas. Never let cleanup throw.
    try {
      canvas?.remove()
    } catch {
      /* ignore */
    }
  }
}

/** Test/util hook: forget the memoised result so the next call re-probes. */
export function _resetWebGLSupportCache(): void {
  _cached = null
}
