/**
 * Keyboard-only navigation e2e spec.
 *
 * Verifies that all interactive elements on the Connect screen are reachable
 * via Tab, that each focused element has a visible focus indicator, and that
 * keyboard focus does not get trapped.
 *
 * Focus-ring strategy (src/index.css):
 *   `* { @apply border-border outline-ring/50; }`
 *   Tailwind emits `outline-color: oklch(...)` on every element. The browser
 *   then shows an outline when :focus-visible is active. We check that the
 *   computed outline-width is non-zero OR that box-shadow contains "rgb"
 *   (some shadcn components use box-shadow focus rings instead).
 */

import { test, expect } from '@playwright/test'

test.describe('keyboard navigation — Connect screen', () => {
  test('Tab cycles through interactive elements and each has a visible focus ring', async ({
    page,
    browserName,
  }) => {
    // webkit requires system deps (libicu74, libjpeg-turbo8, libwoff1) that are
    // not installed on this Fedora host. Skip rather than fail the suite.
    test.skip(browserName === 'webkit', 'WebKit missing system deps on this host (libicu74 etc.)')

    await page.goto('/')

    // Wait for the app to hydrate
    await expect(
      page.getByRole('heading', { name: /CoH2 Community Modding Tool/i }).first(),
    ).toBeVisible({ timeout: 10_000 })

    // Collect all interactive elements found during Tab traversal.
    // We skip Tab presses that land on body or canvas (the shader background
    // is a <canvas> that can temporarily receive focus before React yields it).
    const focusedElements: string[] = []

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab')

      const info = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body || el.tagName === 'CANVAS') return null
        const style = window.getComputedStyle(el)
        return {
          tag: el.tagName,
          text: (el.textContent ?? '').trim().slice(0, 60),
          role: el.getAttribute('role') ?? '',
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
          outlineStyle: style.outlineStyle,
        }
      })

      // Skip canvas/body focus hits — they are not interactive elements
      if (!info) continue

      focusedElements.push(`${info.tag}[${info.role}] "${info.text}"`)

      // Visible focus indicator: non-zero outline OR box-shadow with rgb color
      const hasOutline = info.outlineWidth !== '0px' && info.outlineStyle !== 'none'
      const hasBoxShadowRing = info.boxShadow.includes('rgb')

      expect(
        hasOutline || hasBoxShadowRing,
        `Element ${focusedElements.at(-1)} has no visible focus ring ` +
          `(outline: ${info.outlineWidth} ${info.outlineStyle}, ` +
          `box-shadow: ${info.boxShadow})`,
      ).toBe(true)
    }

    // We must have found at least one interactive element (the Connect button)
    expect(focusedElements.length, 'No interactive elements found via Tab').toBeGreaterThan(0)
  })

  test('no keyboard trap — focus never permanently sticks on body', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === 'webkit', 'WebKit missing system deps on this host (libicu74 etc.)')

    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: /CoH2 Community Modding Tool/i }).first(),
    ).toBeVisible({ timeout: 10_000 })

    // Tab through 30 elements. Track how many consecutive times we land
    // on body — more than 3 consecutive body hits signals a keyboard trap.
    let consecutiveBodyHits = 0

    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const isBody = await page.evaluate(
        () =>
          document.activeElement === document.body || document.activeElement?.tagName === 'BODY',
      )
      if (isBody) {
        consecutiveBodyHits++
      } else {
        consecutiveBodyHits = 0
      }
      // More than 3 consecutive body hits = keyboard trapped
      expect(
        consecutiveBodyHits,
        `Keyboard trap detected: focus stuck on body for ${consecutiveBodyHits} consecutive Tab presses`,
      ).toBeLessThanOrEqual(3)
    }
  })
})
