import { test, expect } from '@playwright/test'

/**
 * Console-errors spec.
 *
 * Loads the app to networkidle and asserts there are no uncaught JS exceptions
 * and no console ERROR messages.  Benign noise is whitelisted by substring so
 * that CI doesn't break on expected browser warnings.
 *
 * What we can test without a CoH2 install:
 *   - Uncaught exceptions during the static-welcome → React-hydration sequence
 *   - console.error() calls in app boot code (React, Vite, service worker)
 */

/** Known-benign substrings that should not cause the test to fail. */
const BENIGN_PATTERNS: ReadonlyArray<string> = [
  // Vite HMR WS connection failing in preview mode is expected
  'WebSocket connection',
  // Service-worker registration may warn in non-HTTPS contexts
  'service worker',
  // Firefox / older Chrome: ResizeObserver loop limit (harmless)
  'ResizeObserver loop',
]

function isBenign(text: string): boolean {
  const lower = text.toLowerCase()
  return BENIGN_PATTERNS.some(p => lower.includes(p.toLowerCase()))
}

test('page loads without uncaught exceptions or console errors', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []

  page.on('pageerror', err => {
    pageErrors.push(err.message)
  })

  page.on('console', msg => {
    if (msg.type() === 'error' && !isBenign(msg.text())) {
      consoleErrors.push(msg.text())
    }
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(pageErrors, `Uncaught JS exceptions: ${pageErrors.join(' | ')}`).toHaveLength(0)
  expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toHaveLength(0)
})
