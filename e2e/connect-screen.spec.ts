import { test, expect } from '@playwright/test'

/**
 * Smoke test: verifies the app shell loads without crashing.
 *
 * What we can test without a CoH2 install:
 *   - The static LCP <h1> "CoH2 Community Modding Tool" is in the DOM (index.html
 *     fallback, lives inside a `role="region"` landmark before React mounts)
 *   - A <canvas> element is rendered (the ShaderWaveBackground)
 *
 * The full Connect → Editor flow requires a local CoH2 install with
 * File System Access API permissions and is not suitable for headless CI.
 */
test('app shell loads with title and canvas', async ({ page }) => {
  await page.goto('/')

  // The static LCP element in index.html contains this text before React hydrates.
  // After React mounts, the same text is also rendered as a sr-only <h1> inside
  // AuthShell so the product heading stays present in the a11y tree throughout
  // the fade-out window. `.first()` picks whichever is currently rendered (the
  // static one early on, the AuthShell one after React mounts).
  const heading = page.getByRole('heading', { name: /CoH2 Community Modding Tool/i }).first()
  await expect(heading).toBeVisible({ timeout: 10_000 })

  // The shader wave background renders a <canvas> on the connect screen.
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeAttached({ timeout: 10_000 })
})
