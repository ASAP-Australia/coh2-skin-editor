import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The first e2e coverage of the ELECTRON MAIN PROCESS.
 *
 * Every other spec in e2e/ runs against `vite preview` in a browser, so the
 * main process — IPC handlers, the native Steam Workshop addon, filesystem
 * access — had no end-to-end test at all. That is where the irreversible
 * operations live.
 *
 * Run:  npx playwright test e2e/electron-main.spec.ts --project=electron
 *
 * Requires a prior `npm run build && npm run electron:compile`.
 */

// This project is ESM, so __dirname does not exist — derive it from import.meta.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let app: ElectronApplication

test.beforeAll(async () => {
  app = await electron.launch({
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'test' },
  })
})

test.afterAll(async () => {
  await app?.close()
})

test('the app opens a window', async () => {
  const win = await app.firstWindow()
  expect(win).toBeTruthy()
  await win.waitForLoadState('domcontentloaded')
})

test('the window title carries the build stamp', async () => {
  // The stamp is how a stale deploy is spotted — the user runs the packaged
  // AppImage, so a change that was never rebuilt is otherwise invisible. If
  // this regresses, that signal is silently gone.
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await expect.poll(() => win.title(), { timeout: 15_000 }).toMatch(/\d+\.\d+\.\d+ · [0-9a-f]{7}/)
})

test('workshop delete REFUSES without an exact confirmation token', async () => {
  // Deleting a published item is irreversible and remote. The handler must
  // reject anything but `DELETE <id>`, so a malformed or accidental call
  // cannot destroy a user's listing.
  //
  // Asserted in the MAIN process, which is the only place this logic exists.
  const refusedNoToken = await app.evaluate(async ({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })
      ._invokeHandlers
    const fn = handlers?.get('steam:workshop:delete') as
      | ((e: unknown, ...a: unknown[]) => Promise<unknown>)
      | undefined
    if (!fn) return 'HANDLER_MISSING'
    try {
      await fn({}, '123456789')
      return 'ACCEPTED'
    } catch (err) {
      return (err as Error).message
    }
  })
  expect(refusedNoToken, 'delete must not run without a token').not.toBe('ACCEPTED')
  expect(refusedNoToken, 'the delete IPC handler must be registered').not.toBe('HANDLER_MISSING')
  expect(String(refusedNoToken)).toContain('confirmation token')

  // A token for a DIFFERENT id must also be refused — otherwise a stale token
  // could delete the wrong listing.
  const refusedWrongId = await app.evaluate(async ({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })
      ._invokeHandlers
    const fn = handlers?.get('steam:workshop:delete') as
      | ((e: unknown, ...a: unknown[]) => Promise<unknown>)
      | undefined
    if (!fn) return 'HANDLER_MISSING'
    try {
      await fn({}, '123456789', 'DELETE 987654321')
      return 'ACCEPTED'
    } catch (err) {
      return (err as Error).message
    }
  })
  expect(refusedWrongId, 'a token for another id must not delete').not.toBe('ACCEPTED')
})

test('no renderer console errors on boot', async () => {
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('console', m => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(3000)
  // Missing optional CoH2 archives are expected on a machine without the game.
  const real = errors.filter(e => !/ENOENT|ArtMission|Failed to load resource/i.test(e))
  expect(real, `unexpected console errors:\n${real.join('\n')}`).toHaveLength(0)
})
