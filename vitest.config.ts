import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    // Exclude Playwright e2e specs — they use a different test runner
    // `dist-electron/**` excluded because electron-builder compiles the
    // electron tests into CJS there; vitest picks them up and explodes
    // with "Vitest cannot be imported in a CommonJS module using require()".
    // The source-of-truth electron tests live in `electron/__tests__/` and
    // are not affected.
    exclude: ['**/node_modules/**', '**/dist/**', 'dist-electron/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
