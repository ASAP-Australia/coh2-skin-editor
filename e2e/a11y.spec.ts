import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Accessibility smoke test using axe-core via @axe-core/playwright.
 *
 * Requires a built dist/ and a running preview server:
 *   npm run build && npm run preview
 *
 * Runs in CI via the `e2e` job in .github/workflows/ci.yml.
 * The preview server is orchestrated by playwright.config.ts webServer block.
 */
test('home page has no axe-core violations', async ({ page }) => {
  await page.goto('/')

  // Wait for the app shell to hydrate (heading and canvas are the LCP markers).
  // `.first()` because both the static welcome's <h1> and the AuthShell's
  // sr-only <h1> carry the same product name during the cross-fade window.
  await expect(
    page.getByRole('heading', { name: /CoH2 Community Modding Tool/i }).first(),
  ).toBeVisible({
    timeout: 10_000,
  })

  const results = await new AxeBuilder({ page }).analyze()

  expect(results.violations).toEqual([])
})
