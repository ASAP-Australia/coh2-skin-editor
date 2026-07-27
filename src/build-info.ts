/**
 * Build stamp — which commit is this binary actually running?
 *
 * WHY THIS EXISTS. The user tests the DEPLOYED AppImage, not the dev build, so
 * a change that was never rebuilt and installed is invisible — and there was no
 * way to tell a stale binary from a current one by looking at it. That cost
 * real debugging time more than once: a screenshot "after" a fix turned out to
 * be the build from before it.
 *
 * `.github/ISSUE_TEMPLATE/bug.yml` also asks for a Version as a REQUIRED field,
 * which the application never displayed anywhere, so every bug report was
 * asking the user to invent a number.
 *
 * The stamp goes in the WINDOW TITLE specifically, because that means it is
 * captured in every screenshot — by the user, by CI, and by any agent driving
 * the app — without anyone having to remember to record it.
 *
 * `__BUILD_SHA__` / `__BUILD_TIME__` are statically replaced by Vite's
 * `define` (see vite.config.ts). Both fall back to 'unknown' when git is
 * unavailable rather than failing the build.
 */

declare const __BUILD_SHA__: string
declare const __BUILD_TIME__: string

/** Short commit the bundle was built from; '-dirty' if the tree had edits. */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'unknown'

/** ISO timestamp of the build. */
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown'

/** Marketing version, kept in lock-step with package.json. */
export const APP_VERSION = '1.1.0'

/** True when the bundle was built from a tree with uncommitted changes. */
export const IS_DIRTY_BUILD = BUILD_SHA.endsWith('-dirty')

/** `1.1.0 · a1b2c3d` — compact enough for a title bar. */
export function buildLabel(): string {
  return `${APP_VERSION} · ${BUILD_SHA}`
}

/** `v1.1.0 · a1b2c3d · 2026-07-27T10:15:00.000Z` — for About / logs / bug reports. */
export function buildLabelLong(): string {
  return `v${APP_VERSION} · ${BUILD_SHA} · ${BUILD_TIME}`
}

/**
 * Stamp the title bar. Called once at startup; safe outside a browser.
 * Keeps the existing product name as the prefix so the window is still
 * recognisable in a task switcher.
 */
export function applyBuildStampToTitle(productName = 'CoH2 Community Modding Tool'): void {
  if (typeof document === 'undefined') return
  document.title = `${productName} — ${buildLabel()}`
}
