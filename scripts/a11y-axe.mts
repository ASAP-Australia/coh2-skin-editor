/**
 * One-shot axe-core accessibility audit using Playwright's bundled
 * Chromium. The npm `axe` CLI uses selenium-webdriver which can't find
 * a system Chrome on Atomic distros (Bazzite, Silverblue) — but
 * Playwright is already a dev-dep and ships its own binary, so we drive
 * axe-core through it instead.
 *
 *   npm run build               # populate dist/
 *   npx vite preview --port 4173 &
 *   npx tsx scripts/a11y-axe.mts # writes reports/a11y-axe.json
 *
 * Exit code 0 = zero serious/critical violations, 1 = at least one.
 * Minor/moderate violations are reported but do not fail the script —
 * the CI lighthouse job already gates on a stricter overall score.
 */
import { chromium } from 'playwright'
import { AxeBuilder } from '@axe-core/playwright'
import { writeFile, mkdir } from 'node:fs/promises'

const URL = process.env.A11Y_URL ?? 'http://localhost:4173/'

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()

  await mkdir('reports', { recursive: true })
  await writeFile('reports/a11y-axe.json', JSON.stringify(results, null, 2))

  const violations = results.violations
  const bySeverity = violations.reduce<Record<string, number>>((acc, v) => {
    acc[v.impact ?? 'unknown'] = (acc[v.impact ?? 'unknown'] ?? 0) + 1
    return acc
  }, {})

  console.log(`axe-core scan: ${URL}`)
  console.log(`  violations total: ${violations.length}`)
  console.log(`  by severity: ${JSON.stringify(bySeverity)}`)
  console.log(`  passes: ${results.passes.length}`)
  console.log(`  incomplete: ${results.incomplete.length}`)
  console.log(`  inapplicable: ${results.inapplicable.length}`)

  if (violations.length > 0) {
    for (const v of violations) {
      console.log(
        `  [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`,
      )
    }
  }

  await browser.close()

  const hard = (bySeverity.serious ?? 0) + (bySeverity.critical ?? 0)
  if (hard > 0) {
    console.error(`a11y FAIL: ${hard} serious/critical violation(s)`)
    process.exit(1)
  }
  console.log('a11y OK: 0 serious/critical violations')
}

main().catch(err => {
  console.error(err)
  process.exit(2)
})
