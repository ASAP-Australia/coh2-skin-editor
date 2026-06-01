/**
 * audit-capture-real.ts — Real-pipeline vehicle visual-audit driver.
 *
 * Run with:
 *   npm run electron:compile && AUDIT_REAL=1 electron .
 *
 * Unlike audit-capture.ts (which loads audit-renderer.html — a standalone
 * reimplemented renderer), this driver loads the REAL app at ?audit=1 so
 * the full Viewport component (MeshPhysicalMaterial + normalMap + roughnessMap
 * + specularIntensityMap + env IBL + SRGB diffuse + deferred overlay) is used.
 *
 * Flow:
 *   1. Open a hidden BrowserWindow (show:false) loading the built app / dev
 *      server at ?audit=1.
 *   2. AuditRunner.tsx (src/components/AuditRunner.tsx) mounts, detects the
 *      CoH2 install, iterates vehicles × seasons, signals readiness via:
 *        window.__auditReady  boolean
 *        window.__auditFrame  string (canvas dataURL — fallback)
 *        window.__auditMeta   { vehicleId, faction, season, mode, error }
 *        window.__auditNext() void — advance to the next item
 *        window.__auditDone   boolean
 *   3. This driver polls __auditReady at 500 ms intervals, then captures via
 *      webContents.capturePage() (preferred — real GPU composite), writes
 *      PNG to artifacts/vehicle-audit-real/<faction>/<id>_<season>[_decal].png,
 *      calls __auditNext(), repeats.
 *   4. Assembles per-faction contact sheets using the `canvas` npm package.
 *
 * Output: artifacts/vehicle-audit-real/
 * Re-run command:
 *   npm run electron:compile && AUDIT_REAL=1 electron .
 *
 * Optional env vars:
 *   COH2_INSTALL=<path>   Override the auto-detected CoH2 install path.
 *   AUDIT_DEV=1           Load from dev server (http://localhost:5173) instead
 *                         of the built dist/. Requires `npm run dev` running.
 *   AUDIT_WIDTH=<n>       Capture width in px (default 800).
 *   AUDIT_HEIGHT=<n>      Capture height in px (default 600).
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { detectCoh2Path } from './detect-coh2'

const AUDIT_WIDTH  = Number(process.env.AUDIT_WIDTH  ?? '800')
const AUDIT_HEIGHT = Number(process.env.AUDIT_HEIGHT ?? '600')
const USE_DEV_SERVER = process.env.AUDIT_DEV === '1'
// Optional: override the body diffuse with this PNG (e.g. a real skin's body
// atlas) so the audit renders a skin instead of the stock vanilla texture.
const SKIN_PNG = process.env.AUDIT_SKIN_PNG

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'vehicle-audit-real')

// Swallow EPIPE on the output streams. This audit driver forwards every
// renderer console message to the main process via console.log (see the
// 'console-message' handler below). When the driver is launched in the
// background and the parent process closes its end of the stdout/stderr pipe,
// that console.log throws an uncaught "write EPIPE", which Electron surfaces as
// the "A JavaScript error occurred in the main process" dialog. Attaching an
// 'error' listener converts the unhandled stream error into a handled one;
// EPIPE is benign here (the consumer simply went away) so we ignore it.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return
    // Other stream errors are non-fatal for an audit driver; swallow rather
    // than let an unhandled 'error' event crash the main process.
  })
}

interface AuditMeta {
  vehicleId: string
  faction:   string
  season:    'summer' | 'winter'
  mode:      'vanilla' | 'decal'
  error:     string | null
}

interface CaptureResult {
  meta:    AuditMeta
  pngBuf:  Buffer | null
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

export async function runAuditCaptureReal(): Promise<void> {
  console.log('[audit-real] Starting real-pipeline vehicle audit capture')
  console.log('[audit-real] Output dir:', OUT_DIR)
  console.log('[audit-real] Capture size:', AUDIT_WIDTH, 'x', AUDIT_HEIGHT)
  console.log('[audit-real] Source:', USE_DEV_SERVER ? 'dev server (localhost:5173)' : 'dist/index.html')

  fs.mkdirSync(OUT_DIR, { recursive: true })

  await app.whenReady()

  // The AUDIT_REAL gate bypasses createWindow() in main.ts, which is where the
  // app normally registers its IPC handlers. AuditRunner + native-fs need the
  // install-detection + lazy SGA read handlers to locate and read the CoH2
  // archives, so register that subset here (window-control handlers aren't used).
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
    show:   false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      // contextIsolation must stay on (preload script injects electronAPI).
      contextIsolation: true,
      nodeIntegration:  false,
      // Preload is required so the AuditRunner can use electronAPI (detectInstallPath etc.)
      preload: path.join(__dirname, 'preload.js'),
      offscreen: false, // offscreen:true breaks canvas.toDataURL in Electron v28+
      backgroundThrottling: false, // prevent rAF/timer throttling in hidden window
    },
  })

  win.on('closed', () => console.log('[audit-real] BrowserWindow closed'))

  // Mirror renderer console to main process stdout
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = path.basename(sourceId ?? '')
    const tag = level === 3 ? 'ERR' : level === 2 ? 'WARN' : 'LOG'
    console.log(`[renderer:${tag}:${src}:${line}] ${message}`)
  })

  // Load the audit URL
  const auditUrl = USE_DEV_SERVER
    ? 'http://localhost:5173/?audit=1'
    : (() => {
        const distIndex = path.join(__dirname, '..', 'dist', 'index.html')
        return `file://${distIndex}?audit=1`
      })()

  console.log('[audit-real] Loading:', auditUrl)
  await win.loadURL(auditUrl)

  // Skin override: inject the PNG as a data URL the renderer's AuditRunner will
  // paint onto the body overlay instead of the decoded vanilla diffuse. Set
  // BEFORE the model loads (archive warm gives us tens of seconds of headroom).
  if (SKIN_PNG) {
    try {
      const b64 = fs.readFileSync(SKIN_PNG).toString('base64')
      await win.webContents.executeJavaScript(
        `window.__auditSkinUrl = "data:image/png;base64,${b64}"; true`, true)
      console.log('[audit-real] skin override injected from', SKIN_PNG, `(${b64.length} b64 chars)`)
    } catch (e) {
      console.warn('[audit-real] failed to inject skin override:', e)
    }
  }

  // Wait for AuditRunner to boot, warm the archive cache, and enqueue vehicles (up to 300 s)
  // The archive warm step can take 60-120 s on cold SGA reads before the queue appears.
  console.log('[audit-real] Waiting for AuditRunner to initialise (includes archive warm)…')
  const booted = await pollUntil(
    win.webContents,
    'typeof window.__auditNext === "function" && window.__auditProgress?.total > 0',
    300_000,
    2_000,
  )

  if (!booted) {
    console.error('[audit-real] AuditRunner did not boot within 60 s — check for React errors above.')
    win.destroy()
    return
  }

  const total: number = await win.webContents.executeJavaScript('window.__auditProgress.total', true)
  console.log(`[audit-real] Queue ready: ${total} items`)

  const results: CaptureResult[] = []

  for (let i = 0; i < total; i++) {
    const t0 = Date.now()

    // Wait for the current frame to be ready (up to 360 s per vehicle — cold SGA reads are slow;
    // the renderer signals timeout after 300 s so the driver poll must exceed that)
    const ready = await pollUntil(win.webContents, 'window.__auditReady === true', 360_000, 500)

    if (!ready) {
      const meta: AuditMeta = await win.webContents
        .executeJavaScript('window.__auditMeta ?? null', true)
        .catch(() => null) ?? {
          vehicleId: `unknown-${i}`, faction: 'unknown',
          season: 'summer', mode: 'vanilla', error: 'timeout',
        }
      console.warn(`[audit-real] Timeout for item ${i}/${total}: ${meta.faction}/${meta.vehicleId}`)
      results.push({ meta, pngBuf: null, elapsed: Date.now() - t0 })
      await win.webContents.executeJavaScript('window.__auditNext()', true).catch(() => {})
      continue
    }

    // Grab meta
    const meta: AuditMeta = await win.webContents.executeJavaScript('window.__auditMeta', true)

    // Capture via webContents.capturePage() — real GPU composite, more reliable
    // than canvas.toDataURL() across GPU contexts.
    let pngBuf: Buffer | null = null
    try {
      const img = await win.webContents.capturePage()
      pngBuf = img.toPNG()
    } catch (e) {
      console.warn(`[audit-real] capturePage failed for ${meta.vehicleId}:`, e)
      // Fallback: dataURL from AuditRunner's __auditFrame
      try {
        const dataUrl: string = await win.webContents.executeJavaScript('window.__auditFrame ?? ""', true)
        if (dataUrl.startsWith('data:image/png;base64,')) {
          pngBuf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
        }
      } catch { /* give up */ }
    }

    const elapsed = Date.now() - t0
    results.push({ meta, pngBuf, elapsed })

    // Write PNG immediately
    if (pngBuf) {
      const factionDir = path.join(OUT_DIR, meta.faction)
      fs.mkdirSync(factionDir, { recursive: true })
      const suffix = meta.mode === 'decal' ? '_decal' : ''
      const outPath = path.join(factionDir, `${meta.vehicleId}_${meta.season}${suffix}.png`)
      fs.writeFileSync(outPath, pngBuf)
      console.log(`[audit-real] ✓ ${meta.faction}/${meta.vehicleId}/${meta.season}/${meta.mode} (${elapsed}ms) → ${outPath}`)
      // DIAGNOSTIC: also dump the Viewport's decoded diffuse canvas (what it
      // actually feeds the model) so we can compare it to an independent flat
      // decode of the same RGT.
      try {
        const diffUrl: string = await win.webContents.executeJavaScript('window.__auditDiffuse ?? ""', true)
        if (diffUrl.startsWith('data:image/png;base64,')) {
          fs.writeFileSync(path.join(factionDir, `${meta.vehicleId}_${meta.season}_VPDIFFUSE.png`),
            Buffer.from(diffUrl.slice('data:image/png;base64,'.length), 'base64'))
          console.log(`[audit-real]   + dumped Viewport diffuse`)
        } else {
          console.log(`[audit-real]   (no Viewport diffuse exposed)`)
        }
      } catch { /* ignore */ }
      // DIAGNOSTIC: dump the ACTUAL overlay canvas contents (what body
      // materials sample via overlayTexRef) as _VPBODY.png. This lets us
      // compare body-path sampling against the decoded diffuse (_VPDIFFUSE)
      // and the rendered frame — if the overlay is blank/dark here, that is
      // the root cause of the dark hull with bright tracks.
      try {
        const overlayUrl: string = await win.webContents.executeJavaScript('window.__auditOverlay ?? ""', true)
        if (overlayUrl.startsWith('data:image/png;base64,')) {
          fs.writeFileSync(path.join(factionDir, `${meta.vehicleId}_${meta.season}_VPBODY.png`),
            Buffer.from(overlayUrl.slice('data:image/png;base64,'.length), 'base64'))
          console.log(`[audit-real]   + dumped overlay canvas (body diffuse path)`)
        } else {
          console.log(`[audit-real]   (no overlay canvas exposed)`)
        }
      } catch { /* ignore */ }
    } else {
      console.warn(`[audit-real] ✗ ${meta.faction}/${meta.vehicleId}/${meta.season}/${meta.mode} — no PNG (error: ${meta.error})`)
    }

    // Advance to next item
    await win.webContents.executeJavaScript('window.__auditNext()', true).catch(() => {})
  }

  win.destroy()

  // ── Summary ────────────────────────────────────────────────────────────────
  const written = results.filter(r => r.pngBuf).length
  const failed  = results.filter(r => !r.pngBuf).length
  console.log(`\n[audit-real] ── Summary ──────────────────────────────────────────`)
  console.log(`[audit-real]   Written: ${written}  Failed: ${failed}  Total: ${results.length}`)

  if (failed > 0) {
    console.log('[audit-real]   Failures:')
    for (const r of results.filter(x => !x.pngBuf)) {
      console.log(`[audit-real]     ${r.meta.faction}/${r.meta.vehicleId}/${r.meta.season}/${r.meta.mode}: ${r.meta.error}`)
    }
  }

  // ── Contact sheets ─────────────────────────────────────────────────────────
  try {
    const { createCanvas, loadImage } = await import('canvas')

    // Group vanilla results by faction
    const vanillaByFaction: Record<string, CaptureResult[]> = {}
    const decalResults: CaptureResult[] = []

    for (const r of results) {
      if (r.meta.mode === 'decal') {
        decalResults.push(r)
        continue
      }
      const f = r.meta.faction
      if (!vanillaByFaction[f]) vanillaByFaction[f] = []
      vanillaByFaction[f].push(r)
    }

    // Per-faction vanilla contact sheets
    for (const [faction, fResults] of Object.entries(vanillaByFaction)) {
      const vehicleIds = [...new Set(fResults.map(r => r.meta.vehicleId))]
      const THUMB = 256
      const COLS_PER_VEHICLE = 2 // summer + winter
      const VEHICLES_PER_ROW = 2
      const ROWS = Math.ceil(vehicleIds.length / VEHICLES_PER_ROW)
      const W = THUMB * COLS_PER_VEHICLE * VEHICLES_PER_ROW
      const H = THUMB * ROWS + 30

      const sheet = createCanvas(W, H)
      const ctx = sheet.getContext('2d')
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 18px sans-serif'
      ctx.fillText(`${faction} — real pipeline (normal+spec+rough+IBL)`, 8, 22)

      for (let vi = 0; vi < vehicleIds.length; vi++) {
        const vid = vehicleIds[vi]
        const row = Math.floor(vi / VEHICLES_PER_ROW)
        const col = vi % VEHICLES_PER_ROW
        const x0 = col * THUMB * COLS_PER_VEHICLE
        const y0 = 30 + row * THUMB

        for (const [si, season] of (['summer', 'winter'] as const).entries()) {
          const r = fResults.find(rr => rr.meta.vehicleId === vid && rr.meta.season === season)
          const sx = si * THUMB

          if (r?.pngBuf) {
            try {
              const suffix = ''
              const imgPath = path.join(OUT_DIR, faction, `${vid}_${season}${suffix}.png`)
              const img = await loadImage(imgPath)
              ctx.drawImage(img, x0 + sx, y0, THUMB, THUMB)
            } catch {
              ctx.fillStyle = '#222'
              ctx.fillRect(x0 + sx, y0, THUMB, THUMB)
            }
          } else {
            ctx.fillStyle = '#300'
            ctx.fillRect(x0 + sx, y0, THUMB, THUMB)
            ctx.fillStyle = '#f55'
            ctx.font = '10px monospace'
            ctx.fillText(r?.meta.error?.slice(0, 28) ?? 'no data', x0 + sx + 4, y0 + THUMB / 2)
          }

          // Label strip
          ctx.fillStyle = 'rgba(0,0,0,0.7)'
          ctx.fillRect(x0 + sx, y0 + THUMB - 18, THUMB, 18)
          ctx.fillStyle = '#eee'
          ctx.font = '10px monospace'
          ctx.fillText(`${vid.slice(0, 20)} ${season.slice(0, 1).toUpperCase()}`, x0 + sx + 3, y0 + THUMB - 4)
        }
      }

      const contactPath = path.join(OUT_DIR, `${faction}_contact.png`)
      fs.writeFileSync(contactPath, sheet.toBuffer('image/png'))
      console.log(`[audit-real] Contact sheet: ${contactPath}`)
    }

    // Cross-faction vanilla summary contact sheet
    {
      const allVanilla = results.filter(r => r.meta.mode === 'vanilla')
      const allVehicleIds = [...new Set(allVanilla.map(r => r.meta.vehicleId))]
      const THUMB = 200
      const SEASONS_PER_VEHICLE = 2
      const VEHICLES_PER_ROW = 5
      const ROWS = Math.ceil(allVehicleIds.length / VEHICLES_PER_ROW)
      const W = THUMB * SEASONS_PER_VEHICLE * VEHICLES_PER_ROW
      const H = THUMB * ROWS + 40

      const sheet = createCanvas(W, H)
      const ctx = sheet.getContext('2d')
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#ccc'
      ctx.font = 'bold 16px sans-serif'
      ctx.fillText('Real pipeline audit — all factions, summer + winter', 8, 24)

      for (let vi = 0; vi < allVehicleIds.length; vi++) {
        const vid = allVehicleIds[vi]
        const row = Math.floor(vi / VEHICLES_PER_ROW)
        const col = vi % VEHICLES_PER_ROW
        const x0 = col * THUMB * SEASONS_PER_VEHICLE
        const y0 = 40 + row * THUMB

        for (const [si, season] of (['summer', 'winter'] as const).entries()) {
          const r = allVanilla.find(rr => rr.meta.vehicleId === vid && rr.meta.season === season)
          const sx = si * THUMB

          if (r?.pngBuf) {
            try {
              const imgPath = path.join(OUT_DIR, r.meta.faction, `${vid}_${season}.png`)
              const img = await loadImage(imgPath)
              ctx.drawImage(img, x0 + sx, y0, THUMB, THUMB)
            } catch {
              ctx.fillStyle = '#222'
              ctx.fillRect(x0 + sx, y0, THUMB, THUMB)
            }
          } else {
            ctx.fillStyle = '#300'
            ctx.fillRect(x0 + sx, y0, THUMB, THUMB)
          }

          ctx.fillStyle = 'rgba(0,0,0,0.7)'
          ctx.fillRect(x0 + sx, y0 + THUMB - 16, THUMB, 16)
          ctx.fillStyle = '#ddd'
          ctx.font = '9px monospace'
          ctx.fillText(`${vid.slice(0, 18)} ${season[0].toUpperCase()}`, x0 + sx + 2, y0 + THUMB - 3)
        }
      }

      const contactPath = path.join(OUT_DIR, '_contact.png')
      fs.writeFileSync(contactPath, sheet.toBuffer('image/png'))
      console.log(`[audit-real] All-factions contact sheet: ${contactPath}`)
    }

    // Decal contact sheet
    if (decalResults.length > 0) {
      const THUMB_W = 800
      const THUMB_H = 600
      const COLS = 2
      const ROWS = Math.ceil(decalResults.length / COLS)
      const W = THUMB_W * COLS
      const H = THUMB_H * ROWS + 30

      const sheet = createCanvas(W, H)
      const ctx = sheet.getContext('2d')
      ctx.fillStyle = '#0a0c10'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#ffdd00'
      ctx.font = 'bold 18px sans-serif'
      ctx.fillText('Decal pass — right-side badge landing (real pipeline)', 8, 22)

      for (let di = 0; di < decalResults.length; di++) {
        const r = decalResults[di]
        const row = Math.floor(di / COLS)
        const col = di % COLS
        const x0 = col * THUMB_W
        const y0 = 30 + row * THUMB_H

        if (r.pngBuf) {
          try {
            const imgPath = path.join(OUT_DIR, r.meta.faction, `${r.meta.vehicleId}_${r.meta.season}_decal.png`)
            const img = await loadImage(imgPath)
            ctx.drawImage(img, x0, y0, THUMB_W, THUMB_H)
          } catch {
            ctx.fillStyle = '#222'
            ctx.fillRect(x0, y0, THUMB_W, THUMB_H)
          }
        } else {
          ctx.fillStyle = '#300'
          ctx.fillRect(x0, y0, THUMB_W, THUMB_H)
          ctx.fillStyle = '#f55'
          ctx.font = '12px monospace'
          ctx.fillText(r.meta.error ?? 'no data', x0 + 8, y0 + THUMB_H / 2)
        }

        ctx.fillStyle = 'rgba(0,0,0,0.75)'
        ctx.fillRect(x0, y0 + THUMB_H - 22, THUMB_W, 22)
        ctx.fillStyle = '#eee'
        ctx.font = '11px monospace'
        ctx.fillText(`${r.meta.faction}/${r.meta.vehicleId} — decal (right hull side)`, x0 + 6, y0 + THUMB_H - 5)
      }

      const contactPath = path.join(OUT_DIR, '_contact_decals.png')
      fs.writeFileSync(contactPath, sheet.toBuffer('image/png'))
      console.log(`[audit-real] Decal contact sheet: ${contactPath}`)
    }

  } catch (e) {
    console.error('[audit-real] Contact sheet generation failed:', e)
  }

  console.log('\n[audit-real] ── Re-run command ────────────────────────────────────')
  console.log('[audit-real]   npm run electron:compile && AUDIT_REAL=1 electron .')
  console.log('[audit-real]   # Dev server variant:')
  console.log('[audit-real]   npm run electron:compile && AUDIT_REAL=1 AUDIT_DEV=1 electron .')
  console.log('[audit-real] ───────────────────────────────────────────────────────')
}
