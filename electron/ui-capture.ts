/**
 * ui-capture.ts — Electron UI-capture harness for the redesign-v2 campaign.
 *
 * Loads the REAL production app (`dist/index.html`, the normal main-window
 * render path — NOT the ?audit AuditRunner) on the real GPU, drives it to a
 * named SCREEN/STATE by clicking buttons exactly like a user (via
 * webContents.executeJavaScript), settles, then webContents.capturePage()s a
 * PNG per state into artifacts/redesign-v2/ui-verify/<state>.png.
 *
 * Every visual fix in the redesign-v2 campaign uses these PNGs as pixel proof.
 *
 * Run with:
 *   npm run build && npm run electron:compile && UI_CAPTURE=1 electron .
 *
 * Env vars:
 *   UI_SCREENS=start,skin-editor,...   Comma list of states to capture.
 *                                      Default: the full list (ALL_SCREENS).
 *   UI_CAPTURE_W / UI_CAPTURE_H        Window size (default 1600 x 1000).
 *   UI_SETTLE_MS                       Base settle wait per state (default 1200).
 *   UI_3D_MS                           Extra wait for 3D-heavy states (default 45000).
 *   COH2_INSTALL=<path>                Override auto-detected CoH2 install.
 *
 * Design notes:
 *   • Each state gets a FRESH page load (win.loadFile + reset) so driving is
 *     robust and states never bleed into each other. The auto-detect path in
 *     App.tsx lands us in the StartScreen with no ConnectScreen click needed
 *     (CoH2 install is auto-detected on this machine).
 *   • Clicking is done in-page by matching a button's aria-label / innerText
 *     (startsWith / includes) — the same affordances a user reads. Helpers are
 *     injected into the page as window.__uiCap.* on every load.
 *   • The leave-confirm dialog (if any editor shows one on reload) is handled
 *     by dismissing via Discard/Leave before the next load — but because we
 *     reload fresh each time, we also swallow beforeunload so no native dialog
 *     blocks us.
 *
 * Faithful reuse of the showcase-capture.ts launch recipe: off-screen,
 * inactive window, backgroundThrottling:false, offscreen:false GPU composite,
 * the same IPC handler surface the real main window registers.
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  detectCoh2Path,
  detectModsPath,
  detectWorkshopPath,
  listWorkshopItems,
  listStockArchives,
  listInstalledPacks,
} from './detect-coh2'

const CAP_W = Number(process.env.UI_CAPTURE_W ?? '1600')
const CAP_H = Number(process.env.UI_CAPTURE_H ?? '1000')
const SETTLE_MS = Number(process.env.UI_SETTLE_MS ?? '1200')
const THREE_D_MS = Number(process.env.UI_3D_MS ?? '45000')

const OUT_DIR = path.join(
  process.cwd(),
  'artifacts',
  'redesign-v2',
  'ui-verify',
)

const ALL_SCREENS = [
  'start',
  'new-skin-form',
  'new-faceplate-form',
  'new-decal-form',
  'skin-editor',
  'skin-camo-panel',
  'skin-decals-panel',
  'skin-scene-panel',
  'texture-editor',
  'decal-editor',
  'decal-insignia',
  'decal-advanced',
  'faceplate-editor',
  'faceplate-shapes',
] as const

type Screen = string

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return
  })
}

// ── In-page driver helpers ─────────────────────────────────────────────────
// Injected on every page load. All matching is by the visible affordances a
// user reads: aria-label, title, then innerText. Exposed as window.__uiCap.
const DRIVER_SRC = `
(() => {
  if (window.__uiCap) return;
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const labelsOf = (el) => {
    const out = [];
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al) out.push(al);
    const ti = el.getAttribute && el.getAttribute('title');
    if (ti) out.push(ti);
    const did = el.getAttribute && el.getAttribute('data-id');
    if (did) out.push(did);
    const tid = el.getAttribute && el.getAttribute('data-testid');
    if (tid) out.push(tid);
    if (el.innerText) out.push(el.innerText);
    return out.map(norm);
  };
  const CLICKABLE = 'button, [role="button"], a, [role="tab"], [data-id], [data-testid]';
  const findClickable = (needle, mode) => {
    const n = norm(needle);
    const els = Array.from(document.querySelectorAll(CLICKABLE));
    // Prefer an exact/startsWith match on aria-label/title/data before falling
    // back to innerText includes, so "Camo panel" doesn't match a stray tooltip.
    const test = (labels) => labels.some((l) => {
      if (!l) return false;
      if (mode === 'exact') return l === n;
      if (mode === 'starts') return l.startsWith(n);
      return l.includes(n);
    });
    for (const el of els) {
      if (test(labelsOf(el))) {
        // Skip disabled controls.
        if (el.disabled) continue;
        return el;
      }
    }
    return null;
  };
  window.__uiCap = {
    // Return a compact inventory of clickable affordances (for debugging /
    // reporting which labels actually exist on the current screen).
    inventory() {
      return Array.from(document.querySelectorAll(CLICKABLE))
        .slice(0, 400)
        .map((el) => {
          const al = el.getAttribute('aria-label');
          const ti = el.getAttribute('title');
          const did = el.getAttribute('data-id');
          const txt = (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
          return [al, ti, did, txt].filter(Boolean).join(' | ');
        })
        .filter((s) => s.length);
    },
    exists(needle, mode) { return !!findClickable(needle, mode || 'starts'); },
    click(needle, mode) {
      const el = findClickable(needle, mode || 'starts');
      if (!el) return false;
      el.scrollIntoView && el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    },
    // Text content probe — used to confirm a screen rendered (e.g. StartScreen
    // shows "New Skin Pack").
    hasText(needle) { return norm(document.body.innerText).includes(norm(needle)); },
    // Two-rAF settle so the current React commit + paint has landed.
    settle() {
      return new Promise((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => res(true)));
      });
    },
  };
  // Never let a beforeunload confirm block our fresh-page reloads.
  window.addEventListener('beforeunload', (e) => {
    e.stopImmediatePropagation();
    delete e.returnValue;
  }, true);
})();
`

async function inject(wc: Electron.WebContents): Promise<void> {
  await wc.executeJavaScript(DRIVER_SRC, true).catch(() => {})
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Poll an in-page boolean expression until true or timeout. */
async function pollUntil(
  wc: Electron.WebContents,
  expr: string,
  timeoutMs: number,
  intervalMs = 400,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const val = await wc.executeJavaScript(expr, true).catch(() => false)
    if (val) return true
    await sleep(intervalMs)
  }
  return false
}

/** Click by user-visible affordance; retries until it appears or times out. */
async function clickWhenReady(
  wc: Electron.WebContents,
  needle: string,
  mode: 'exact' | 'starts' | 'includes' = 'starts',
  timeoutMs = 15000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const expr = `window.__uiCap && window.__uiCap.exists(${JSON.stringify(needle)}, ${JSON.stringify(mode)})`
  while (Date.now() < deadline) {
    await inject(wc)
    const ok = await wc.executeJavaScript(expr, true).catch(() => false)
    if (ok) {
      return await wc
        .executeJavaScript(
          `window.__uiCap.click(${JSON.stringify(needle)}, ${JSON.stringify(mode)})`,
          true,
        )
        .catch(() => false)
    }
    await sleep(400)
  }
  return false
}

/** Load a fresh production page and wait for the renderer to paint. */
async function freshLoad(win: BrowserWindow): Promise<void> {
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
  await win.loadFile(indexPath)
  await inject(win.webContents)
  // Wait for React to commit past the 'probing' phase. StartScreen shows
  // "New Skin Pack"; if auto-detect fails we'd land on ConnectScreen instead
  // (handled by the caller via a text probe).
  await pollUntil(
    win.webContents,
    `document.readyState === 'complete' && document.body && document.body.innerText.length > 0`,
    20000,
  )
  await inject(win.webContents)
}

/** Settle (fonts + render + optional 3D) then capture to <state>.png. */
async function capture(win: BrowserWindow, state: string, extraWait = 0): Promise<string> {
  await inject(win.webContents)
  await win.webContents.executeJavaScript('window.__uiCap && window.__uiCap.settle()', true).catch(() => {})
  // Fonts settle.
  await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(()=>true) : true', true).catch(() => {})
  await sleep(SETTLE_MS + extraWait)
  await win.webContents.executeJavaScript('window.__uiCap && window.__uiCap.settle()', true).catch(() => {})
  const img = await win.webContents.capturePage()
  const buf = img.toPNG()
  const outPath = path.join(OUT_DIR, `${state}.png`)
  fs.writeFileSync(outPath, buf)
  const { width, height } = img.getSize()
  console.log(`[ui-capture]   captured ${state}.png (${width}x${height}, ${buf.length} bytes)`)
  return outPath
}

/** Drive the app from a fresh StartScreen to the named state, then capture.
 *  Returns { ok, note } — note explains a failure or a caveat. */
async function driveAndCapture(
  win: BrowserWindow,
  state: Screen,
): Promise<{ ok: boolean; note: string; png?: string }> {
  const wc = win.webContents
  await freshLoad(win)

  // Confirm we reached StartScreen (auto-detect success). If not, every
  // editor state is unreachable — report clearly.
  const onStart = await pollUntil(
    wc,
    `window.__uiCap && window.__uiCap.hasText('New Skin Pack')`,
    20000,
  )
  if (!onStart) {
    // We may be on ConnectScreen (no install) — capture whatever's there for
    // the 'start' state so the failure is visible, else bail.
    if (state === 'start') {
      const png = await capture(win, state)
      return { ok: true, note: 'captured, but StartScreen text not found (possibly ConnectScreen — check PNG)', png }
    }
    return { ok: false, note: 'never reached StartScreen (CoH2 auto-detect likely failed → ConnectScreen)' }
  }

  // ── State router ──────────────────────────────────────────────────────
  switch (state) {
    case 'start': {
      const png = await capture(win, state)
      return { ok: true, note: 'StartScreen', png }
    }

    // The "new *" forms: in the current build the New buttons route straight
    // into their editor (App.onNewSkin/onNewFaceplate/onNewDecalPack open the
    // editor directly — there is no intermediate faction/name form yet). We
    // click the button and capture the FIRST frame after navigation so the
    // fix agents can see the current reality vs the VISION's planned form.
    case 'new-skin-form': {
      if (!(await clickWhenReady(wc, 'New Skin Pack', 'includes'))) {
        return { ok: false, note: 'could not click "New Skin Pack"' }
      }
      // Land in editor immediately; capture before heavy 3D so any interim
      // form/picker (if one exists) is caught.
      await sleep(600)
      const png = await capture(win, state)
      return { ok: true, note: 'New Skin Pack currently opens the skin editor directly (no separate form in this build)', png }
    }
    case 'new-faceplate-form': {
      if (!(await clickWhenReady(wc, 'New Faceplate', 'includes'))) {
        return { ok: false, note: 'could not click "New Faceplate"' }
      }
      await sleep(600)
      const png = await capture(win, state)
      return { ok: true, note: 'New Faceplate currently opens the faceplate editor directly (no separate form in this build)', png }
    }
    case 'new-decal-form': {
      if (!(await clickWhenReady(wc, 'New Decal Pack', 'includes'))) {
        return { ok: false, note: 'could not click "New Decal Pack"' }
      }
      await sleep(600)
      const png = await capture(win, state)
      return { ok: true, note: 'New Decal Pack currently opens the decal editor directly (no separate form in this build)', png }
    }

    // ── Skin editor + panels ────────────────────────────────────────────
    case 'skin-editor':
    case 'skin-camo-panel':
    case 'skin-decals-panel':
    case 'skin-scene-panel':
    case 'texture-editor': {
      if (!(await clickWhenReady(wc, 'New Skin Pack', 'includes'))) {
        return { ok: false, note: 'could not click "New Skin Pack"' }
      }
      // Pick Tiger I from the vehicle menu (buttons carry aria-label =
      // displayName "Tiger I"). Editor defaults to Brummbär, both german.
      const pickedTiger = await clickWhenReady(wc, 'Tiger I', 'starts', 30000)
      if (!pickedTiger) {
        return { ok: false, note: 'vehicle menu never offered "Tiger I" (editor may not have reached the vehicle picker)' }
      }
      // Wait for the 3D model to load. The Viewport signals readiness in
      // various ways; we just wait a generous window and settle on rAF.
      // A canvas element present + non-trivial paint is our proxy.
      await pollUntil(
        wc,
        `!!document.querySelector('canvas')`,
        THREE_D_MS,
      )
      // Give the mesh + textures time to decode and the first frame to render.
      await sleep(6000)

      if (state === 'skin-editor') {
        const png = await capture(win, state, 4000)
        return { ok: true, note: 'skin editor with Tiger I loaded', png }
      }
      if (state === 'skin-camo-panel') {
        if (!(await clickWhenReady(wc, 'Camo panel', 'starts'))) {
          return { ok: false, note: 'could not open Camo panel' }
        }
        const png = await capture(win, state, 1500)
        return { ok: true, note: 'Camo panel open', png }
      }
      if (state === 'skin-decals-panel') {
        if (!(await clickWhenReady(wc, 'Decals panel', 'starts'))) {
          return { ok: false, note: 'could not open Decals panel' }
        }
        const png = await capture(win, state, 1500)
        return { ok: true, note: 'Decals panel open', png }
      }
      if (state === 'skin-scene-panel') {
        if (!(await clickWhenReady(wc, 'Scene panel', 'starts'))) {
          return { ok: false, note: 'could not open Scene panel' }
        }
        const png = await capture(win, state, 1500)
        return { ok: true, note: 'Scene panel open', png }
      }
      // texture-editor: the "Edit texture" pill flips into brush/texture mode.
      if (state === 'texture-editor') {
        const clicked =
          (await clickWhenReady(wc, 'Edit vehicle texture', 'starts')) ||
          (await clickWhenReady(wc, 'edit-texture-pill', 'exact')) ||
          (await clickWhenReady(wc, 'Edit texture', 'includes'))
        if (!clicked) {
          return { ok: false, note: 'could not find/click the "Edit texture" pill' }
        }
        const png = await capture(win, state, 2500)
        return { ok: true, note: 'texture-edit (brush) mode', png }
      }
      return { ok: false, note: 'unreachable' }
    }

    // ── Decal editor ────────────────────────────────────────────────────
    case 'decal-editor':
    case 'decal-insignia':
    case 'decal-advanced': {
      if (!(await clickWhenReady(wc, 'New Decal Pack', 'includes'))) {
        return { ok: false, note: 'could not click "New Decal Pack"' }
      }
      // Decal editor mounts a live 3D preview; give it time.
      await pollUntil(wc, `!!document.querySelector('canvas')`, THREE_D_MS)
      await sleep(4000)

      if (state === 'decal-editor') {
        const png = await capture(win, state, 2500)
        return { ok: true, note: 'decal pack editor', png }
      }
      if (state === 'decal-insignia') {
        // Select the "Images" tool (its options peel exposes the Insignia
        // library), then open the Insignia library modal. The decal editor's
        // trigger is a text button "Insignia…" (no aria-label), so match by
        // the visible word "Insignia" via includes.
        await clickWhenReady(wc, 'Images', 'exact')
        await sleep(600)
        const opened =
          (await clickWhenReady(wc, 'Insignia', 'includes')) ||
          (await clickWhenReady(wc, 'Insignia library', 'starts'))
        if (!opened) {
          return { ok: false, note: 'could not open the Insignia library (Images tool → Insignia)' }
        }
        const png = await capture(win, state, 1500)
        return { ok: true, note: 'Insignia library modal open', png }
      }
      if (state === 'decal-advanced') {
        const opened = await clickWhenReady(wc, 'Show advanced placement', 'starts')
        if (!opened) {
          return { ok: false, note: 'could not expand advanced placement controls' }
        }
        const png = await capture(win, state, 1200)
        return { ok: true, note: 'advanced placement expanded', png }
      }
      return { ok: false, note: 'unreachable' }
    }

    // ── Faceplate editor ────────────────────────────────────────────────
    case 'faceplate-editor':
    case 'faceplate-shapes': {
      if (!(await clickWhenReady(wc, 'New Faceplate', 'includes'))) {
        return { ok: false, note: 'could not click "New Faceplate"' }
      }
      // Faceplate editor is a 2D Konva canvas — lighter than 3D, but still
      // wait for the canvas + fonts.
      await pollUntil(wc, `!!document.querySelector('canvas')`, 20000)
      await sleep(2500)

      if (state === 'faceplate-editor') {
        const png = await capture(win, state, 1500)
        return { ok: true, note: 'faceplate editor', png }
      }
      // faceplate-shapes: select the Shapes tool; its options peel appears
      // above the toolbar.
      const opened = await clickWhenReady(wc, 'Shapes', 'exact')
      if (!opened) {
        return { ok: false, note: 'could not select the Shapes tool' }
      }
      const png = await capture(win, state, 1200)
      return { ok: true, note: 'Shapes tool + its options peel', png }
    }

    default:
      return { ok: false, note: `unknown state "${state}"` }
  }
}

// ── IPC surface ─────────────────────────────────────────────────────────────
// Register the same handlers the real main window registers so the renderer's
// editor flow (install detect, SGA reads, mods writes, installed-pack list,
// window controls, AI settings) works identically. Kept as a superset so a
// missing handler can never silently stall a state.
function registerIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('detect-coh2', () => detectCoh2Path())
  ipcMain.handle('detect-coh2-mods', () => detectModsPath())
  ipcMain.handle('detect-coh2-workshop', () => detectWorkshopPath())
  ipcMain.handle('list-workshop-items', (_e, root?: string) =>
    listWorkshopItems(root || detectWorkshopPath() || ''),
  )
  ipcMain.handle('list-installed-packs', (_e, modsRoot?: string) =>
    listInstalledPacks(modsRoot || detectModsPath() || ''),
  )
  ipcMain.handle('list-stock-archives', (_e, installRoot: string) =>
    listStockArchives(installRoot),
  )
  ipcMain.handle('get-resources-path', () => process.resourcesPath)

  ipcMain.handle('read-file', async (_e, filePath: string) => {
    const buf = await fs.promises.readFile(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })
  ipcMain.handle('read-file-range', async (_e, filePath: string, start: number, length: number) => {
    const fd = await fs.promises.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await fd.read(buf, 0, length, start)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead)
    } finally {
      await fd.close()
    }
  })
  ipcMain.handle('file-stat', async (_e, filePath: string) => {
    try {
      const s = await fs.promises.stat(filePath)
      return { size: s.size }
    } catch {
      return null
    }
  })
  ipcMain.handle('list-dir', async (_e, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
    } catch {
      return []
    }
  })
  ipcMain.handle('file-exists', (_e, filePath: string) => fs.existsSync(filePath))
  // Live Sync writes during editing — accept and write so nothing throws, but
  // the capture flow generally doesn't trigger a build.
  ipcMain.handle('write-file', async (_e, filePath: string, bytes: ArrayBuffer) => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, Buffer.from(bytes))
  })

  // Window controls (WindowControls.tsx calls isMaximized on mount).
  ipcMain.handle('window-minimize', () => getWin()?.minimize())
  ipcMain.handle('window-maximize', () => {
    const w = getWin()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle('window-close', () => getWin()?.close())
  ipcMain.handle('window-is-maximized', () => getWin()?.isMaximized() ?? false)

  // AI settings — StartScreen/editors may query. Return an empty-but-valid
  // shape so nothing rejects; no keys are needed for UI capture.
  ipcMain.handle('ai:get-settings', () => ({
    activeProvider: 'anthropic',
    providers: [
      { provider: 'anthropic', hasKey: false },
      { provider: 'openai', hasKey: false },
      { provider: 'google', hasKey: false },
      { provider: 'xai', hasKey: false },
    ],
  }))
  ipcMain.handle('ai:set-active-provider', () => true)
  ipcMain.handle('ai:set-key', () => true)
  ipcMain.handle('ai:clear-key', () => true)

  // Diffusion status — return a "not running" status so any probe resolves.
  ipcMain.handle('diffusion:get-status', () => ({ running: false, model: null }))
  ipcMain.handle('diffusion:list-models', () => [])
  ipcMain.handle('diffusion:list-loras', () => [])

  // Mods migration probes — no-op so the StartScreen boot path never stalls.
  ipcMain.handle('mods:scan-fake-ids', () => [])
  ipcMain.handle('mods:trash-fake-ids', () => ({ trashed: 0, failed: [] }))

  // Renderer-ready handshake (App.tsx fires it; we don't need to surface a
  // window, but the handler must exist as a no-op receiver).
  ipcMain.on('renderer-ready', () => {})
}

export async function runUiCapture(): Promise<void> {
  const requested = (process.env.UI_SCREENS ?? ALL_SCREENS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  console.log('[ui-capture] Starting UI-capture harness')
  console.log('[ui-capture] Output dir:', OUT_DIR)
  console.log('[ui-capture] Window:', CAP_W, 'x', CAP_H)
  console.log('[ui-capture] Screens:', requested.join(', '))

  fs.mkdirSync(OUT_DIR, { recursive: true })

  await app.whenReady()

  let winRef: BrowserWindow | null = null
  registerIpc(() => winRef)

  // Suppress any native dialog (e.g. an unexpected leave-confirm) so it can't
  // block the harness.
  const origShowMessageBox = dialog.showMessageBox.bind(dialog)
  ;(dialog as unknown as { showMessageBox: typeof dialog.showMessageBox }).showMessageBox = (async () =>
    ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  void origShowMessageBox

  const win = new BrowserWindow({
    width: CAP_W,
    height: CAP_H,
    x: -4000,
    y: -4000,
    show: false,
    paintWhenInitiallyHidden: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      offscreen: false,
      backgroundThrottling: false,
    },
  })
  winRef = win
  win.setPosition(-4000, -4000)
  win.showInactive()

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = path.basename(sourceId ?? '')
    const tag = level === 3 ? 'ERR' : level === 2 ? 'WARN' : 'LOG'
    // Only surface warnings/errors to keep the log readable.
    if (level >= 2) console.log(`[renderer:${tag}:${src}:${line}] ${message}`)
  })

  const results: { state: string; ok: boolean; note: string; png?: string }[] = []
  for (const state of requested) {
    console.log(`[ui-capture] → ${state}`)
    try {
      const r = await driveAndCapture(win, state)
      results.push({ state, ...r })
      console.log(`[ui-capture] ${r.ok ? 'OK  ' : 'FAIL'} ${state} — ${r.note}`)
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e)
      results.push({ state, ok: false, note })
      console.log(`[ui-capture] FAIL ${state} — threw: ${note}`)
    }
  }

  console.log('\n[ui-capture] ── Summary ──')
  for (const r of results) {
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'}  ${r.state}${r.png ? '  → ' + r.png : ''}${r.ok ? '' : '  (' + r.note + ')'}`)
  }
  const okCount = results.filter(r => r.ok).length
  console.log(`[ui-capture] ${okCount}/${results.length} states captured OK`)

  win.destroy()
  winRef = null
  app.quit()
}
