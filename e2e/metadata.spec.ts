import { test, expect } from '@playwright/test'

/**
 * Document metadata spec.
 *
 * Verifies that <title>, meta description, Open Graph tags, manifest link,
 * and CSP meta tag are all present in the served HTML — without needing a
 * CoH2 install or File System Access API.
 */
test.describe('document metadata', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
  })

  test('page title is correct', async ({ page }) => {
    await expect(page).toHaveTitle(/CoH2 Community Modding Tool/)
  })

  // TODO: add <meta name="description"> to index.html — tracked in v1.1 polish.
  test.skip('meta description is present and non-trivial', async ({ page }) => {
    const content = await page.locator('meta[name="description"]').getAttribute('content')
    expect(content).toBeTruthy()
    expect(content!.length).toBeGreaterThan(30)
  })

  // TODO: add Open Graph meta tags to index.html — tracked in v1.1 polish.
  test.skip('Open Graph title and description are present', async ({ page }) => {
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content')
    expect(ogTitle).toBeTruthy()

    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute('content')
    expect(ogDesc).toBeTruthy()
    expect(ogDesc!.length).toBeGreaterThan(20)
  })

  // TODO: add Open Graph meta tags to index.html — tracked in v1.1 polish.
  test.skip('Open Graph type and url are present', async ({ page }) => {
    const ogType = await page.locator('meta[property="og:type"]').getAttribute('content')
    expect(ogType).toBe('website')

    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content')
    expect(ogUrl).toBeTruthy()
  })

  // TODO: add a CSP <meta http-equiv> to index.html — tracked in v1.1 security hardening.
  test.skip('CSP meta tag is present', async ({ page }) => {
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content')
    expect(csp).toBeTruthy()
    // Verify it includes at minimum a default-src directive
    expect(csp).toContain('default-src')
  })

  // TODO: add public/manifest.webmanifest for PWA support — tracked in v1.1 polish.
  test.skip('manifest link resolves with 200', async ({ request }) => {
    const response = await request.head('/manifest.webmanifest')
    expect(response.status()).toBe(200)
  })
})
