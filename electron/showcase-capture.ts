/**
 * showcase-capture.ts — render the editor's own 3D Viewport for ONE vehicle
 * through the REAL material (MeshPhysicalMaterial + TC1 badge shader) and save
 * proof PNGs: plain / camo / decal / camo+decal.
 *
 * Run with:
 *   npm run electron:compile && SHOWCASE=1 electron .
 *
 * Drives AuditRunner's ?audit=1&showcase=1 mode (see AuditRunner.tsx SHOWCASE):
 *   • plain       — vanilla diffuse, no decal
 *   • camo        — procedural camo composited onto the diffuse (editor recipe)
 *   • showdecal   — vanilla diffuse + balkenkreuz decal via the TC1 badge shader
 *   • camo_decal  — camo diffuse + balkenkreuz decal (combined)
 *
 * Each frame is captured via canvas.toDataURL (preserveDrawingBuffer is on in
 * ?audit=1 builds — the real GPU frame) and written to:
 *   artifacts/created-assets/screenshots/<id>_<mode>.png
 *
 * Env vars:
 *   SHOWCASE_VEHICLE=<id>   Vehicle id (default tiger).
 *   SHOWCASE_CAMO=<key>     Camo preset key (default german_ambush).
 *   AUDIT_WIDTH / AUDIT_HEIGHT   Capture size (default 1280 x 960).
 *   COH2_INSTALL=<path>     Override the auto-detected CoH2 install path.
 *
 * Faithful reuse of the verify-visual-capture.ts launch recipe (off-screen,
 * inactive, backgroundThrottling:false, offscreen:false GPU composite).
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { detectCoh2Path } from './detect-coh2'

const AUDIT_WIDTH  = Number(process.env.AUDIT_WIDTH  ?? '1280')
const AUDIT_HEIGHT = Number(process.env.AUDIT_HEIGHT ?? '960')
const SHOWCASE_VEHICLE = process.env.SHOWCASE_VEHICLE ?? 'tiger'
const SHOWCASE_CAMO = process.env.SHOWCASE_CAMO ?? 'german_ambush'
const USE_DEV_SERVER = process.env.AUDIT_DEV === '1'

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'created-assets', 'screenshots')

// Map internal AuditMode → output filename suffix.
const MODE_SUFFIX: Record<string, string> = {
  plain: 'plain',
  camo: 'camo',
  showdecal: 'decal',
  camo_decal: 'camo_and_decal',
}

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') return })
}

async function pollUntil(
  webContents: Electron.WebContents,
  expr: string,
  timeoutMs: number,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const val = await webContents.executeJavaScript(expr, true).catch(() => false)
    if (val) return true
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

export async function runShowcaseCapture(): Promise<void> {
  console.log('[showcase] Starting editor-render showcase capture')
  console.log('[showcase] Vehicle:', SHOWCASE_VEHICLE, ' Camo:', SHOWCASE_CAMO)
  console.log('[showcase] Output dir:', OUT_DIR)
  console.log('[showcase] Capture size:', AUDIT_WIDTH, 'x', AUDIT_HEIGHT)

  fs.mkdirSync(OUT_DIR, { recursive: true })

  await app.whenReady()

  ipcMain.handle('detect-coh2', () => detectCoh2Path())
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
    try { const s = await fs.promises.stat(filePath); return { size: s.size } } catch { return null }
  })
  ipcMain.handle('list-dir', async (_e, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
    } catch { return [] }
  })
  ipcMain.handle('file-exists', (_e, filePath: string) => fs.existsSync(filePath))

  const win = new BrowserWindow({
    width:  AUDIT_WIDTH,
    height: AUDIT_HEIGHT,
    x: -4000,
    y: -4000,
    show:   false,
    paintWhenInitiallyHidden: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      preload: path.join(__dirname, 'preload.js'),
      offscreen: false,
      backgroundThrottling: false,
    },
  })
  win.setPosition(-4000, -4000)
  win.showInactive()

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = path.basename(sourceId ?? '')
    const tag = level === 3 ? 'ERR' : level === 2 ? 'WARN' : 'LOG'
    console.log(`[renderer:${tag}:${src}:${line}] ${message}`)
  })

  const q = `&showcase=1&scv=${encodeURIComponent(SHOWCASE_VEHICLE)}&camo=${encodeURIComponent(SHOWCASE_CAMO)}`
  const url = USE_DEV_SERVER
    ? `http://localhost:5173/?audit=1${q}`
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}?audit=1${q}`

  console.log('[showcase] Loading:', url)
  await win.loadURL(url)

  console.log('[showcase] Waiting for AuditRunner showcase queue (includes archive warm)…')
  const booted = await pollUntil(
    win.webContents,
    'typeof window.__auditNext === "function" && window.__auditProgress?.total > 0',
    300_000,
    2_000,
  )
  if (!booted) {
    console.error('[showcase] AuditRunner did not boot within 300 s — check for errors above.')
    win.destroy()
    app.quit()
    return
  }

  const total: number = await win.webContents.executeJavaScript('window.__auditProgress.total', true)
  console.log(`[showcase] Queue ready: ${total} frames`)

  // The FIRST frame does a cold Tiger mesh + RGT decode (can take minutes on
  // first load); later frames reuse the stable-key Viewport and are near-instant.
  const FIRST_FRAME_MS = Number(process.env.SHOWCASE_FIRST_MS ?? '330000')
  const NEXT_FRAME_MS = Number(process.env.SHOWCASE_NEXT_MS ?? '60000')

  let written = 0
  for (let i = 0; i < total; i++) {
    const t0 = Date.now()
    const ready = await pollUntil(win.webContents, 'window.__auditReady === true', i === 0 ? FIRST_FRAME_MS : NEXT_FRAME_MS, 500)
    const meta = await win.webContents.executeJavaScript('window.__auditMeta ?? null', true).catch(() => null)
    const mode: string = meta?.mode ?? `unknown-${i}`

    if (!ready) {
      console.warn(`[showcase] ⏱ Timeout frame ${i + 1}/${total}: ${SHOWCASE_VEHICLE}/${mode}`)
      await win.webContents.executeJavaScript('window.__auditNext()', true).catch(() => {})
      continue
    }

    let pngBuf: Buffer | null = null
    try {
      const dataUrl: string = await win.webContents.executeJavaScript('window.__auditFrame ?? ""', true)
      if (dataUrl.startsWith('data:image/png;base64,')) {
        pngBuf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
      }
    } catch (e) {
      console.warn(`[showcase] __auditFrame read failed for ${mode}:`, e)
    }
    if (!pngBuf) {
      try { pngBuf = (await win.webContents.capturePage()).toPNG() } catch (e) {
        console.warn(`[showcase] capturePage fallback failed for ${mode}:`, e)
      }
    }

    if (pngBuf && pngBuf.length > 0) {
      const suffix = MODE_SUFFIX[mode] ?? mode
      const outPath = path.join(OUT_DIR, `${SHOWCASE_VEHICLE}_${suffix}.png`)
      fs.writeFileSync(outPath, pngBuf)
      written++
      console.log(`[showcase] ✓ ${i + 1}/${total} ${SHOWCASE_VEHICLE}/${mode} (${Date.now() - t0}ms) → ${path.basename(outPath)} (${pngBuf.length} bytes)`)
    } else {
      console.warn(`[showcase] ✗ no frame for ${SHOWCASE_VEHICLE}/${mode}`)
    }

    await win.webContents.executeJavaScript('window.__auditNext()', true).catch(() => {})
  }

  win.destroy()
  console.log(`\n[showcase] ── Summary ── Written ${written}/${total} frames to ${OUT_DIR}`)
  app.quit()
}
