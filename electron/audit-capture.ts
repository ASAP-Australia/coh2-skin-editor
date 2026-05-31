/**
 * Vehicle visual-audit capture harness.
 *
 * Run with:
 *   AUDIT_CAPTURE=1 electron .
 *
 * Creates a hidden offscreen BrowserWindow, loads audit-renderer.html which
 * uses nodeIntegration to parse CoH2 SGAs + render each vehicle with Three.js
 * WebGL, then returns PNG buffers via IPC.  Main process writes them to
 * artifacts/vehicle-audit/ and assembles per-faction contact sheets.
 *
 * MUST be imported by main.ts and called before app.whenReady when
 * AUDIT_CAPTURE=1 is set — see main.ts gating block.
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrored in audit-renderer.html inline script)
// ─────────────────────────────────────────────────────────────────────────────

interface RenderResult {
  vehicleId: string
  faction: string
  season: 'summer' | 'winter'
  /** PNG bytes as base64. Null when the vehicle/season produced no output. */
  pngBase64: string | null
  meshLoaded: boolean
  diffuseLoaded: boolean
  /** Error description when mesh/diffuse failed. */
  error: string | null
}

interface AuditComplete {
  results: RenderResult[]
  decalResults?: RenderResult[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Faithful subset — representative cross-faction + cross-class vehicles for
// the AUDIT_FAITHFUL=1 run. Both seasons for vanilla (lighting check),
// summer-only decal pass with right-side camera.
// ─────────────────────────────────────────────────────────────────────────────

interface VehicleSpec { id: string; faction: string; displayName: string }

const FAITHFUL_VANILLA_VEHICLES: VehicleSpec[] = [
  // west_german
  { id: 'king_tiger_sdkfz_182', faction: 'west_german', displayName: 'King Tiger' },
  { id: 'panther_ausf_g',       faction: 'west_german', displayName: 'Panther' },
  // soviet
  { id: 'is2m_heavy_tank',      faction: 'soviet',      displayName: 'IS-2' },
  { id: 't34_76',               faction: 'soviet',      displayName: 'T-34/76' },
  // aef
  { id: 'm26_pershing',         faction: 'aef',         displayName: 'Pershing' },
  // british
  { id: 'churchill',            faction: 'british',     displayName: 'Churchill' },
  { id: 'cromwell',             faction: 'british',     displayName: 'Cromwell' },
  // german
  { id: 'brummbar',             faction: 'german',      displayName: 'Brummbär' },
]

const FAITHFUL_DECAL_VEHICLES: VehicleSpec[] = [
  { id: 'king_tiger_sdkfz_182', faction: 'west_german', displayName: 'King Tiger' },
  { id: 'panther_ausf_g',       faction: 'west_german', displayName: 'Panther' },
  { id: 'cromwell',             faction: 'british',     displayName: 'Cromwell' },
  { id: 'm26_pershing',         faction: 'aef',         displayName: 'Pershing' },
  { id: 't34_76',               faction: 'soviet',      displayName: 'T-34/76' },
]

/** Run the audit capture pipeline. Resolves when all PNGs are written. */
export async function runAuditCapture(): Promise<void> {
  const COH2_INSTALL =
    process.env.COH2_INSTALL ??
    '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'

  // AUDIT_FAITHFUL=1 → focused subset with faithful lighting, writes to
  // artifacts/vehicle-audit-faithful/  Run command:
  //   npm run electron:compile && AUDIT_CAPTURE=1 AUDIT_FAITHFUL=1 electron .
  const FAITHFUL = process.env.AUDIT_FAITHFUL === '1'

  const OUT_DIR = FAITHFUL
    ? path.join(process.cwd(), 'artifacts', 'vehicle-audit-faithful')
    : path.join(process.cwd(), 'artifacts', 'vehicle-audit')

  console.log('[audit] Starting vehicle audit capture')
  console.log('[audit] Mode:', FAITHFUL ? 'FAITHFUL (focused subset)' : 'FULL (all vehicles)')
  console.log('[audit] CoH2 install:', COH2_INSTALL)
  console.log('[audit] Output dir:', OUT_DIR)

  // Ensure output directories exist (created per-faction below when we have results)
  fs.mkdirSync(OUT_DIR, { recursive: true })

  await app.whenReady()

  const rendererHtml = path.join(__dirname, 'audit-renderer.html')
  if (!fs.existsSync(rendererHtml)) {
    console.error('[audit] audit-renderer.html not found at', rendererHtml)
    process.exit(1)
  }

  // Create offscreen hidden window — show:false + offscreen:true means nothing
  // appears on the user's display, but WebGL is still active via XWayland.
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      offscreen: false, // offscreen:true breaks canvas.toDataURL in some Electron versions
    },
  })

  win.on('closed', () => {
    console.log('[audit] renderer window closed')
  })

  // Log renderer console messages
  win.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
    const src = path.basename(sourceId ?? '')
    console.log(`[renderer:${src}:${line}] ${message}`)
  })

  // Wait for IPC completion signal
  const { results, decalResults } = await new Promise<{ results: RenderResult[], decalResults: RenderResult[] }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Audit timed out after 10 minutes'))
    }, 10 * 60 * 1000)

    ipcMain.once('audit:complete', (_event, data: AuditComplete) => {
      clearTimeout(timeout)
      resolve({ results: data.results, decalResults: data.decalResults ?? [] })
    })

    ipcMain.once('audit:error', (_event, err: string) => {
      clearTimeout(timeout)
      reject(new Error(err))
    })

    // Send coh2 install path (and optional vehicle subsets) to renderer
    ipcMain.once('audit:ready', () => {
      win.webContents.send('audit:start', {
        coh2Install: COH2_INSTALL,
        vehicles:      FAITHFUL ? FAITHFUL_VANILLA_VEHICLES : undefined,
        decalVehicles: FAITHFUL ? FAITHFUL_DECAL_VEHICLES   : undefined,
      })
    })

    win.loadFile(rendererHtml).catch(reject)
  })

  win.destroy()

  // ── Write PNGs ─────────────────────────────────────────────────────────────
  const factions = new Set<string>()
  const byFaction: Record<string, RenderResult[]> = {}

  for (const r of results) {
    factions.add(r.faction)
    if (!byFaction[r.faction]) byFaction[r.faction] = []
    byFaction[r.faction].push(r)
  }

  let written = 0
  let failed = 0

  for (const r of results) {
    const factionDir = path.join(OUT_DIR, r.faction)
    fs.mkdirSync(factionDir, { recursive: true })

    // Disambiguate duplicate 'halftrack' id across german and soviet
    const fileId =
      r.vehicleId === 'halftrack' ? `${r.faction}_${r.vehicleId}` : r.vehicleId

    const outPath = path.join(factionDir, `${fileId}_${r.season}.png`)

    if (r.pngBase64) {
      const buf = Buffer.from(r.pngBase64, 'base64')
      fs.writeFileSync(outPath, buf)
      written++
    } else {
      failed++
      console.warn(`[audit] No PNG for ${r.faction}/${r.vehicleId}/${r.season}: ${r.error}`)
    }
  }

  console.log(`[audit] Wrote ${written} PNGs, ${failed} failures`)

  // ── Contact sheets ─────────────────────────────────────────────────────────
  // Use the canvas npm package to stitch per-faction grids.
  // Each frame is 512×512; contact sheet is 2 cols (summer|winter) × N rows.
  try {
    const { createCanvas, loadImage } = await import('canvas')

    for (const faction of Array.from(factions)) {
      const factionResults = byFaction[faction] ?? []
      // Unique vehicles in this faction
      const vehicleIds = [
        ...new Set(factionResults.map(r => r.vehicleId)),
      ]
      const THUMB = 256
      const COLS_PER_VEHICLE = 2 // summer + winter
      const VEHICLES_PER_ROW = 2
      const ROWS = Math.ceil(vehicleIds.length / VEHICLES_PER_ROW)
      const W = THUMB * COLS_PER_VEHICLE * VEHICLES_PER_ROW
      const H = THUMB * ROWS + 30 // extra strip at top for faction label
      const sheet = createCanvas(W, H)
      const ctx = sheet.getContext('2d')

      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 20px sans-serif'
      ctx.fillText(`Faction: ${faction}`, 8, 22)

      for (let vi = 0; vi < vehicleIds.length; vi++) {
        const vid = vehicleIds[vi]
        const row = Math.floor(vi / VEHICLES_PER_ROW)
        const col = vi % VEHICLES_PER_ROW
        const x0 = col * THUMB * COLS_PER_VEHICLE
        const y0 = 30 + row * THUMB

        for (const season of ['summer', 'winter'] as const) {
          const r = factionResults.find(
            rr => rr.vehicleId === vid && rr.season === season,
          )
          const sx = season === 'summer' ? 0 : THUMB

          if (r?.pngBase64) {
            try {
              const fileId =
                vid === 'halftrack' ? `${faction}_${vid}` : vid
              const imgPath = path.join(
                OUT_DIR,
                faction,
                `${fileId}_${season}.png`,
              )
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
            ctx.font = '11px monospace'
            ctx.fillText(r?.error ?? 'no data', x0 + sx + 4, y0 + THUMB / 2)
          }

          // Label
          ctx.fillStyle = 'rgba(0,0,0,0.7)'
          ctx.fillRect(x0 + sx, y0 + THUMB - 18, THUMB, 18)
          ctx.fillStyle = '#eee'
          ctx.font = '10px monospace'
          ctx.fillText(`${vid} ${season}`, x0 + sx + 3, y0 + THUMB - 4)
        }
      }

      const contactPath = path.join(OUT_DIR, `_contact_${faction}.png`)
      const buf = sheet.toBuffer('image/png')
      fs.writeFileSync(contactPath, buf)
      console.log(`[audit] Contact sheet: ${contactPath}`)
    }
  } catch (e) {
    console.error('[audit] Contact sheet generation failed:', e)
  }

  // ── Faithful combined contact sheet ──────────────────────────────────────────
  if (FAITHFUL) {
    try {
      const { createCanvas, loadImage } = await import('canvas')
      const allVehicleIds = [...new Set(results.map(r => r.vehicleId))]
      // Each vehicle: summer thumb + winter thumb → 2 cols per vehicle per row
      const THUMB = 256
      const SEASONS_PER_VEHICLE = 2
      const VEHICLES_PER_ROW = 4
      const COLS = VEHICLES_PER_ROW * SEASONS_PER_VEHICLE  // 8 cols
      const ROWS = Math.ceil(allVehicleIds.length / VEHICLES_PER_ROW)
      const W = THUMB * COLS
      const H = THUMB * ROWS + 40
      const sheet = createCanvas(W, H)
      const ctx = sheet.getContext('2d')
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 18px sans-serif'
      ctx.fillText('Faithful lighting — vanilla pass (all factions, summer + winter)', 8, 24)

      for (let vi = 0; vi < allVehicleIds.length; vi++) {
        const vid = allVehicleIds[vi]
        const row = Math.floor(vi / VEHICLES_PER_ROW)
        const col = vi % VEHICLES_PER_ROW
        const x0 = col * THUMB * SEASONS_PER_VEHICLE
        const y0 = 40 + row * THUMB

        for (const [si, season] of (['summer', 'winter'] as const).entries()) {
          const r = results.find(rr => rr.vehicleId === vid && rr.season === season)
          const sx = si * THUMB
          if (r?.pngBase64) {
            try {
              const faction = r.faction
              const fileId = vid === 'halftrack' ? `${faction}_${vid}` : vid
              const img = await loadImage(path.join(OUT_DIR, faction, `${fileId}_${season}.png`))
              ctx.drawImage(img, x0 + sx, y0, THUMB, THUMB)
            } catch {
              ctx.fillStyle = '#222'; ctx.fillRect(x0 + sx, y0, THUMB, THUMB)
            }
          } else {
            ctx.fillStyle = '#300'; ctx.fillRect(x0 + sx, y0, THUMB, THUMB)
            ctx.fillStyle = '#f55'; ctx.font = '10px monospace'
            ctx.fillText(r?.error ?? 'no data', x0 + sx + 3, y0 + THUMB / 2)
          }
          ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x0 + sx, y0 + THUMB - 18, THUMB, 18)
          ctx.fillStyle = '#eee'; ctx.font = '10px monospace'
          ctx.fillText(`${vid.slice(0, 18)} ${season.slice(0,1).toUpperCase()}`, x0 + sx + 3, y0 + THUMB - 4)
        }
      }

      const contactPath = path.join(OUT_DIR, '_contact.png')
      fs.writeFileSync(contactPath, sheet.toBuffer('image/png'))
      console.log(`[audit] Faithful contact sheet: ${contactPath}`)

      // Decal contact sheet — each frame is 1024×512 (left|right combo)
      // Thumb at 512×256 to preserve aspect; lay them in a single row or 2 cols
      const decalVehicleIds = [...new Set(decalResults.map(r => r.vehicleId))]
      const DCOLS = Math.min(decalVehicleIds.length, 3)
      const DROWS = Math.ceil(decalVehicleIds.length / DCOLS)
      const DTHUMB_W = 512; const DTHUMB_H = 256
      const DW = DTHUMB_W * DCOLS
      const DH = DTHUMB_H * DROWS + 40
      const dSheet = createCanvas(DW, DH)
      const dCtx = dSheet.getContext('2d')
      dCtx.fillStyle = '#111'; dCtx.fillRect(0, 0, DW, DH)
      dCtx.fillStyle = '#fff'; dCtx.font = 'bold 18px sans-serif'
      dCtx.fillText('Faithful lighting — decal pass (right hull side visible)', 8, 24)

      for (let vi = 0; vi < decalVehicleIds.length; vi++) {
        const vid = decalVehicleIds[vi]
        const row = Math.floor(vi / DCOLS)
        const col = vi % DCOLS
        const x0 = col * DTHUMB_W
        const y0 = 40 + row * DTHUMB_H

        const r = decalResults.find(rr => rr.vehicleId === vid)
        if (r?.pngBase64) {
          try {
            const faction = r.faction
            const fileId = vid === 'halftrack' ? `${faction}_${vid}` : vid
            // Decal PNGs are 1024×512 combos; thumbnail at DTHUMB_W×DTHUMB_H
            const img = await loadImage(path.join(OUT_DIR, faction, `${fileId}_decal_summer.png`))
            dCtx.drawImage(img, x0, y0, DTHUMB_W, DTHUMB_H)
          } catch {
            dCtx.fillStyle = '#222'; dCtx.fillRect(x0, y0, DTHUMB_W, DTHUMB_H)
          }
        } else {
          dCtx.fillStyle = '#300'; dCtx.fillRect(x0, y0, DTHUMB_W, DTHUMB_H)
          dCtx.fillStyle = '#f55'; dCtx.font = '10px monospace'
          dCtx.fillText(r?.error ?? 'no data', x0 + 3, y0 + DTHUMB_H / 2)
        }
        dCtx.fillStyle = 'rgba(0,0,0,0.7)'; dCtx.fillRect(x0, y0 + DTHUMB_H - 18, DTHUMB_W, 18)
        dCtx.fillStyle = '#eee'; dCtx.font = '10px monospace'
        dCtx.fillText(`${vid} | LEFT+RIGHT`, x0 + 3, y0 + DTHUMB_H - 4)
      }

      const decalContactPath = path.join(OUT_DIR, '_contact_decals.png')
      fs.writeFileSync(decalContactPath, dSheet.toBuffer('image/png'))
      console.log(`[audit] Faithful decal contact sheet: ${decalContactPath}`)
    } catch (e) {
      console.error('[audit] Faithful contact sheet generation failed:', e)
    }
  }

  // ── Decal pass output ────────────────────────────────────────────────────────
  if (decalResults.length > 0) {
    const DECAL_DIR = FAITHFUL ? OUT_DIR : path.join(process.cwd(), 'artifacts', 'vehicle-audit-decals')
    fs.mkdirSync(DECAL_DIR, { recursive: true })

    const decalByFaction: Record<string, RenderResult[]> = {}
    const decalFactions = new Set<string>()

    let decalWritten = 0, decalFailed = 0

    for (const r of decalResults) {
      decalFactions.add(r.faction)
      if (!decalByFaction[r.faction]) decalByFaction[r.faction] = []
      decalByFaction[r.faction].push(r)

      const factionDir = path.join(DECAL_DIR, r.faction)
      fs.mkdirSync(factionDir, { recursive: true })

      const fileId = r.vehicleId === 'halftrack' ? `${r.faction}_${r.vehicleId}` : r.vehicleId
      // In FAITHFUL mode the decal PNG is a 1024×512 left|right combo; use
      // a distinct suffix so the contact sheet can find it by this name.
      const decalFilename = FAITHFUL ? `${fileId}_decal_summer.png` : `${fileId}.png`
      const outPath = path.join(factionDir, decalFilename)

      if (r.pngBase64) {
        fs.writeFileSync(outPath, Buffer.from(r.pngBase64, 'base64'))
        decalWritten++
      } else {
        decalFailed++
        console.warn(`[audit] Decal no PNG for ${r.faction}/${r.vehicleId}: ${r.error}`)
      }
    }

    console.log(`[audit] Decal pass: wrote ${decalWritten} PNGs, ${decalFailed} failures`)

    // Contact sheets for decal pass (skip in FAITHFUL mode — already written above)
    if (!FAITHFUL) try {
      const { createCanvas, loadImage } = await import('canvas')

      for (const faction of Array.from(decalFactions)) {
        const factionResults = decalByFaction[faction] ?? []
        const vehicleIds = [...new Set(factionResults.map(r => r.vehicleId))]
        const THUMB = 256
        const COLS = 4
        const ROWS = Math.ceil(vehicleIds.length / COLS)
        const W = THUMB * COLS
        const H = THUMB * ROWS + 30
        const sheet = createCanvas(W, H)
        const ctx = sheet.getContext('2d')

        ctx.fillStyle = '#111'
        ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 20px sans-serif'
        ctx.fillText(`Decal pass — Faction: ${faction}`, 8, 22)

        for (let vi = 0; vi < vehicleIds.length; vi++) {
          const vid = vehicleIds[vi]
          const row = Math.floor(vi / COLS)
          const col = vi % COLS
          const x0 = col * THUMB
          const y0 = 30 + row * THUMB

          const r = factionResults.find(rr => rr.vehicleId === vid)
          if (r?.pngBase64) {
            try {
              const fileId = vid === 'halftrack' ? `${faction}_${vid}` : vid
              const img = await loadImage(path.join(DECAL_DIR, faction, `${fileId}.png`))
              ctx.drawImage(img, x0, y0, THUMB, THUMB)
            } catch {
              ctx.fillStyle = '#222'
              ctx.fillRect(x0, y0, THUMB, THUMB)
            }
          } else {
            ctx.fillStyle = '#300'
            ctx.fillRect(x0, y0, THUMB, THUMB)
            ctx.fillStyle = '#f55'
            ctx.font = '11px monospace'
            ctx.fillText(r?.error ?? 'no data', x0 + 4, y0 + THUMB / 2)
          }

          // Label
          ctx.fillStyle = 'rgba(0,0,0,0.7)'
          ctx.fillRect(x0, y0 + THUMB - 18, THUMB, 18)
          ctx.fillStyle = '#eee'
          ctx.font = '10px monospace'
          ctx.fillText(vid, x0 + 3, y0 + THUMB - 4)
        }

        const contactPath = path.join(DECAL_DIR, `_contact_${faction}.png`)
        fs.writeFileSync(contactPath, sheet.toBuffer('image/png'))
        console.log(`[audit] Decal contact sheet: ${contactPath}`)
      }
    } catch (e) {
      console.error('[audit] Decal contact sheet generation failed:', e)
    } // end if (!FAITHFUL)

    console.log('\n[audit] ── DECAL SUMMARY ───────────────────────────────────')
    console.log('faction          | id                                | mesh    | diffuse | note')
    console.log('-'.repeat(95))
    for (const r of decalResults) {
      const mesh = r.meshLoaded ? 'YES' : 'FAIL'
      const diff = r.diffuseLoaded ? 'YES' : 'FAIL'
      const note = r.error ? r.error.slice(0, 40) : ''
      console.log(
        `${r.faction.padEnd(16)} | ${r.vehicleId.padEnd(34)} | ${mesh.padEnd(7)} | ${diff.padEnd(7)} | ${note}`,
      )
    }
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log('\n[audit] ── SUMMARY TABLE ────────────────────────────────────')
  console.log('faction          | id                                | season | mesh    | diffuse | note')
  console.log('-'.repeat(105))
  for (const r of results) {
    const mesh = r.meshLoaded ? 'YES' : 'FAIL'
    const diff = r.diffuseLoaded ? 'YES' : (r.error?.includes('white') ? 'WHITE' : 'FAIL')
    const note = r.error ? r.error.slice(0, 40) : ''
    console.log(
      `${r.faction.padEnd(16)} | ${r.vehicleId.padEnd(34)} | ${r.season.padEnd(6)} | ${mesh.padEnd(7)} | ${diff.padEnd(7)} | ${note}`,
    )
  }

  console.log('\n[audit] Done. Window was offscreen (show:false). No game launched.')
}
