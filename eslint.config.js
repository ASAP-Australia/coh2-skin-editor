import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'dist-electron/**',
    'tools/**',
    'e2e/**',
    'scripts/**',
    'coverage/**',
    'release/**',
    'out/**',
    'playwright-report/**',
    'docs/**',
    'test-*.ts',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  // jsx-a11y accessibility rules for all React/JSX files
  {
    files: ['src/**/*.{tsx,jsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: jsxA11y.configs.recommended.rules,
    ignores: ['src/components/ui/**'],
  },
  // shadcn UI library files — cva variants are exported alongside components
  // (documented shadcn pattern), and jsx-a11y rules reference a plugin that
  // is not installed.
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
    },
  },
  // PublishToWorkshopDialog exports factory helpers (makeSkinPublishTarget etc.)
  // alongside the component — these are tightly coupled to the dialog's types
  // and live in the same file intentionally.
  {
    files: ['src/components/PublishToWorkshopDialog.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // ShortcutHelpSheet uses a jsx-a11y disable comment for a rule whose plugin
  // is not installed — suppress "definition not found" errors for that file.
  {
    files: ['src/components/ShortcutHelpSheet.tsx'],
    rules: {
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
    },
  },
])
