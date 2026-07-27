import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Vitest config used ONLY by mutation testing (see stryker.config.json).
 *
 * Two reasons it exists rather than reusing vitest.config.ts:
 *
 * 1. CORRECTNESS — the default config picks up `electron/__tests__/`, which
 *    imports the `electron` package. Inside Stryker's sandbox that resolution
 *    fails ("Failed to load url .../sandbox-XXXX/electron"), and the whole dry
 *    run dies before a single mutant is evaluated.
 *
 * 2. SPEED — Stryker re-runs tests once per surviving mutant. The full suite is
 *    ~41 s; the codec tests are ~1.8 s. Narrowing the include list is the
 *    difference between minutes and hours.
 *
 * Keep `include` in step with `mutate` in stryker.config.json: every mutated
 * file needs at least one test here that actually exercises it, or every mutant
 * "survives" for the trivial reason that nothing ran.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'src/lib/__tests__/bc-encode.test.ts',
      'src/lib/__tests__/icon-atlas-composite.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'dist-electron/**', 'e2e/**', 'electron/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
