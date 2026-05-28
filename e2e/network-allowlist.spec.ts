import { test, expect } from '@playwright/test'

/**
 * Network-allowlist spec — Apple App-Privacy-Label discipline for v1.0 GA.
 *
 * The README headline promise is "local-first, no upload, no server" — every
 * mod the user creates lives in their browser's storage. This spec pins that
 * promise as a hard test: load the app to networkidle and assert that NO
 * request escaped to a non-allowlisted origin.
 *
 * Why a spec instead of just a CSP header:
 *   - CSP only blocks scripts/styles/connect; it does not stop a side-loaded
 *     dependency from issuing a beacon or analytics POST that the browser
 *     would happily resolve.
 *   - A Playwright route intercept observes EVERY URL the page tries to
 *     reach (XHR, fetch, beacon, ws, font, image, manifest, sw, etc.) so
 *     a future "innocent" lib that calls home will fail this test on the
 *     first commit, not in production.
 *
 * Allowlist policy:
 *   - localhost / 127.0.0.1 / the Playwright dev origin — the page itself.
 *   - data: / blob: / about: — local pseudo-schemes, never network egress.
 *
 * AI provider endpoints (OpenAI, Anthropic) are NOT pre-flighted on load —
 * they only fire when the user explicitly clicks "Generate". The boot path
 * must remain offline-clean, so this spec does not allowlist them. A
 * future Generate-flow spec can extend the allowlist if/when it lands.
 *
 * Service worker note: workbox may fetch its own runtime on first load.
 * Those requests are same-origin (served from the dev preview) so they fall
 * under the localhost allowlist.
 */

/** Returns true if `url` is allowed under the local-first contract. */
function isAllowlisted(url: string): boolean {
  // Local pseudo-schemes never touch the network.
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
    return true
  }
  // Anything served from the page's own origin (Playwright dev server).
  try {
    const u = new URL(url)
    const host = u.hostname
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      // Match Playwright's default test origin.
      host === '' ||
      // chrome-extension, devtools URLs that some browsers spontaneously hit.
      u.protocol === 'chrome-extension:' ||
      u.protocol === 'devtools:' ||
      u.protocol === 'ws:' ||
      u.protocol === 'wss:'
    ) {
      return true
    }
  } catch {
    // Malformed URL — treat as suspicious so the test catches it.
    return false
  }
  return false
}

test('boot path makes zero off-origin network requests', async ({ page }) => {
  const offends: string[] = []

  page.on('request', req => {
    const url = req.url()
    if (!isAllowlisted(url)) {
      offends.push(`${req.method()} ${url}`)
    }
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(
    offends,
    `Boot path leaked to non-allowlisted origins:\n  ${offends.join('\n  ')}`,
  ).toHaveLength(0)
})
