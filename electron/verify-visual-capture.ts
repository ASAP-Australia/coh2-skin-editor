/**
 * verify-visual-capture.ts — Phase-2 VISUAL unwrap verifier capture driver.
 *
 * Run with:
 *   npm run electron:compile && VERIFY_VISUAL=1 electron .
 *
 * Companion to audit-capture-real.ts. Loads the REAL app at ?audit=1&verify=1
 * so AuditRunner's VERIFY mode mounts the actual Viewport component and, for
 * each of the 61 catalog vehicles, renders TWO summer frames through the REAL
 * onBeforeCompile TC1 badge shader:
 *   • base — badgeDecalSource = null
 *   • cal  — badgeDecalSource = 4-quadrant calibration wrapper canvas
 *
 * Each frame is captured via webContents.capturePage() (real GPU composite) and
 * written to:
 *   artifacts/verify-unwrap/visual/<faction>/<id>_{base,cal}.png
 *
 * The diff + assertions live in scripts/verify-unwrap-visual.mts (pure Node).
 *
 * Env vars:
 *   COH2_INSTALL=<path>   Override the auto-detected CoH2 install path.
 *   AUDIT_DEV=1           Load from dev server (http://localhost:5173).
 *   AUDIT_WIDTH=<n>       Capture width  (default 1024).
 *   AUDIT_HEIGHT=<n>      Capture height (default 768).
 *   VERIFY_ONLY=<id>      Restrict to a single vehicle id (debugging).
 *   VERIFY_PER_ITEM_MS=<n> Per-item ready timeout (default 90000).
 *
 * DESIGN NOTES vs audit-capture-real.ts:
 *   • Distinct output dir; never touches artifacts/vehicle-audit-real/.
 *   • No contact-sheet assembly (the diff script owns reporting).
 *   • Per-item timeout skips-and-continues so one broken mesh can't stall the
 *     whole 122-frame batch.
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { detectCoh2Path } from './detect-coh2'

const AUDIT_WIDTH  = Number(process.env.AUDIT_WIDTH  ?? '1024')
const AUDIT_HEIGHT = Number(process.env.AUDIT_HEIGHT ?? '768')
const USE_DEV_SERVER = process.env.AUDIT_DEV === '1'
const VERIFY_ONLY = process.env.VERIFY_ONLY
const VERIFY_FACTION = process.env.VERIFY_FACTION
const PER_ITEM_MS = Number(process.env.VERIFY_PER_ITEM_MS ?? '90000')

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'verify-unwrap', 'visual')

// Swallow EPIPE on the output streams (see audit-capture-real.ts for rationale).
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return
  })
}

interface VerifyMeta {
  vehicleId: string
  faction:   string
  season:    string
  mode:      'base' | 'cal' | string
  error:     string | null
}

interface VerifyResult {
  meta:    VerifyMeta
  written: boolean
  elapsed: number
}

/** Poll until `expr` evaluates truthy, up to `timeoutMs`. */
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

export async function runVerifyVisualCapture(): Promise<void> {
  console.log('[verify-visual] Starting Phase-2 visual unwrap verifier capture')
  console.log('[verify-visual] Output dir:', OUT_DIR)
  console.log('[verify-visual] Capture size:', AUDIT_WIDTH, 'x', AUDIT_HEIGHT)
  console.log('[verify-visual] Source:', USE_DEV_SERVER ? 'dev server (localhost:5173)' : 'dist/index.html')
  if (VERIFY_ONLY) console.log('[verify-visual] Single-vehicle filter:', VERIFY_ONLY)

  fs.mkdirSync(OUT_DIR, { recursive: true })

  await app.whenReady()

  // Register the subset of IPC handlers AuditRunner + native-fs need (same set
  // as audit-capture-real.ts — this driver bypasses createWindow()).
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
    // Positioned FAR off-screen and shown INACTIVE (see showInactive below).
    // A truly hidden (show:false) window's requestAnimationFrame loop is heavily
    // rate-limited even with backgroundThrottling:false — the WebGL render-on-
    // demand loop then lags, so a captured base frame can show the EMPTY ground
    // pad (the vehicle mesh was added but not yet drawn). A shown-but-off-screen,
    // inactive window paints at full rate without stealing focus, so every
    // needsRender flip results in an actual renderer.render() before capture.
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
      offscreen: false,           // offscreen:true breaks capturePage composites
      backgroundThrottling: false, // prevent rAF/timer throttling in hidden window
    },
  })

  // Show OFF-SCREEN + INACTIVE so the compositor drives full-rate rAF (needed
  // for reliable render-on-demand flushes) without the window taking focus or
  // appearing on-screen / in the taskbar.
  win.setPosition(-4000, -4000)
  win.showInactive()

  win.on('closed', () => console.log('[verify-visual] BrowserWindow closed'))

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = path.basename(sourceId ?? '')
    const tag = level === 3 ? 'ERR' : level === 2 ? 'WARN' : 'LOG'
    console.log(`[renderer:${tag}:${src}:${line}] ${message}`)
  })

  const onlyQuery = VERIFY_ONLY ? `&only=${encodeURIComponent(VERIFY_ONLY)}` : ''
  const factionQuery = VERIFY_FACTION ? `&verifyFaction=${encodeURIComponent(VERIFY_FACTION)}` : ''
  const q = `${onlyQuery}${factionQuery}`
  const verifyUrl = USE_DEV_SERVER
    ? `http://localhost:5173/?audit=1&verify=1${q}`
    : (() => {
        const distIndex = path.join(__dirname, '..', 'dist', 'index.html')
        return `file://${distIndex}?audit=1&verify=1${q}`
      })()
  if (VERIFY_FACTION) console.log('[verify-visual] Faction chunk:', VERIFY_FACTION)

  console.log('[verify-visual] Loading:', verifyUrl)
  await win.loadURL(verifyUrl)

  // Wait for AuditRunner to boot + warm archives + enqueue (up to 300 s).
  console.log('[verify-visual] Waiting for AuditRunner verify queue (includes archive warm)…')
  const booted = await pollUntil(
    win.webContents,
    'typeof window.__auditNext === "function" && window.__auditProgress?.total > 0',
    300_000,
    2_000,
  )

  if (!booted) {
    console.error('[verify-visual] AuditRunner did not boot within 300 s — check for React errors above.')
    win.destroy()
    return
  }

  const total: number = await win.webContents.executeJavaScript('window.__auditProgress.total', true)
  console.log(`[verify-visual] Queue ready: ${total} items (${total / 2} vehicles × {base,cal})`)

  const results: VerifyResult[] = []

  for (let i = 0; i < total; i++) {
    const t0 = Date.now()

    // Per-item ready timeout — skip-and-continue on a broken/slow mesh.
    const ready = await pollUntil(win.webContents, 'window.__auditReady === true', PER_ITEM_MS, 500)

    if (!ready) {
      const meta: VerifyMeta = await win.webContents
        .executeJavaScript('window.__auditMeta ?? null', true)
        .catch(() => null) ?? {
          vehicleId: `unknown-${i}`, faction: 'unknown',
          season: 'summer', mode: 'base', error: 'timeout',
        }
      console.warn(`[verify-visual] ⏱ Timeout item ${i + 1}/${total}: ${meta.faction}/${meta.vehicleId}/${meta.mode}`)
      results.push({ meta: { ...meta, error: meta.error ?? 'load-timeout' }, written: false, elapsed: Date.now() - t0 })
      await win.webContents.executeJavaScript('window.__auditNext()', true).catch(() => {})
      continue
    }

    const meta: VerifyMeta = await win.webContents.executeJavaScript('window.__auditMeta', true)

    let pngBuf: Buffer | null = null
    // PRIMARY: read the frame the renderer already captured via
    // canvas.toDataURL() (window.__auditFrame). preserveDrawingBuffer is forced
    // ON in ?audit=1 builds, so this is the real GPU frame. This avoids
    // webContents.capturePage(), which stalls badly on repeated calls in a
    // hidden BrowserWindow (the second capture would hang ~90 s).
    try {
      const dataUrl: string = await win.webContents.executeJavaScript('window.__auditFrame ?? ""', true)
      if (dataUrl.startsWith('data:image/png;base64,')) {
        pngBuf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
      }
    } catch (e) {
      console.warn(`[verify-visual] __auditFrame read failed for ${meta.vehicleId}/${meta.mode}:`, e)
    }
    // FALLBACK: capturePage (only if the dataURL path produced nothing).
    if (!pngBuf) {
      try {
        const img = await win.webContents.capturePage()
        pngBuf = img.toPNG()
      } catch (e) {
        console.warn(`[verify-visual] capturePage fallback failed for ${meta.vehicleId}/${meta.mode}:`, e)
      }
    }

    let written = false
    if (pngBuf && pngBuf.length > 0) {
      const factionDir = path.join(OUT_DIR, meta.faction)
      fs.mkdirSync(factionDir, { recursive: true })
      const suffix = meta.mode === 'cal' ? 'cal' : 'base'
      const outPath = path.join(factionDir, `${meta.vehicleId}_${suffix}.png`)
      fs.writeFileSync(outPath, pngBuf)
      written = true
      console.log(`[verify-visual] ✓ ${i + 1}/${total} ${meta.faction}/${meta.vehicleId}/${meta.mode} (${Date.now() - t0}ms) → ${path.basename(outPath)}`)
    } else {
      console.warn(`[verify-visual] ✗ no frame for ${meta.faction}/${meta.vehicleId}/${meta.mode}`)
    }

    results.push({ meta, written, elapsed: Date.now() - t0 })

    await win.webContents.executeJavaScript('window.__auditNext()', true).catch(() => {})
  }

  win.destroy()

  // ── Summary ────────────────────────────────────────────────────────────────
  const written = results.filter(r => r.written).length
  const failed  = results.filter(r => !r.written).length
  console.log(`\n[verify-visual] ── Summary ──────────────────────────────────────`)
  console.log(`[verify-visual]   Written: ${written}  Failed: ${failed}  Total: ${results.length}`)
  if (failed > 0) {
    console.log('[verify-visual]   Failures:')
    for (const r of results.filter(x => !x.written)) {
      console.log(`[verify-visual]     ${r.meta.faction}/${r.meta.vehicleId}/${r.meta.mode}: ${r.meta.error ?? 'capture-failed'}`)
    }
  }

  // Emit a small manifest so the diff script knows exactly what was captured
  // (including load-timeout items that produced no PNG). When chunking per
  // faction (multiple launches), MERGE into any existing manifest so the diff
  // script sees every chunk's results — keyed by faction+vehicle+mode, latest
  // launch wins (a re-run of a faction supersedes its earlier attempt).
  const manifestPath = path.join(OUT_DIR, '_capture-manifest.json')
  const theseResults = results.map(r => ({ ...r.meta, written: r.written, elapsed: r.elapsed }))
  let merged = theseResults
  if (VERIFY_FACTION || VERIFY_ONLY) {
    try {
      const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const prevResults: typeof theseResults = Array.isArray(prev.results) ? prev.results : []
      const key = (r: { faction: string; vehicleId: string; mode: string }) => `${r.faction}/${r.vehicleId}/${r.mode}`
      const nowKeys = new Set(theseResults.map(key))
      merged = [...prevResults.filter(r => !nowKeys.has(key(r))), ...theseResults]
    } catch { /* no prior manifest — first chunk */ }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    width: AUDIT_WIDTH, height: AUDIT_HEIGHT,
    results: merged,
  }, null, 2))
  console.log(`[verify-visual] Manifest: ${manifestPath} (${merged.length} total entries)`)

  console.log('\n[verify-visual] ── Re-run command ─────────────────────────────────')
  console.log('[verify-visual]   npm run electron:compile && VERIFY_VISUAL=1 electron .')
  console.log('[verify-visual]   # then: npx tsx --tsconfig tsconfig.node.json scripts/verify-unwrap-visual.mts')
  console.log('[verify-visual] ───────────────────────────────────────────────────')
}
