/**
 * AuditRunner — in-app offscreen audit mode.
 *
 * Activated when ?audit=1 is in the URL query string. Mounts the REAL
 * Viewport component (identical props to AtlasPreview3D) and iterates a
 * curated vehicle × season matrix, exposing each frame for capture via:
 *
 *   window.__auditReady  boolean — true when the current frame is GPU-ready
 *   window.__auditFrame  string  — canvas.toDataURL('image/png') of the frame
 *   window.__auditMeta   object  — { vehicleId, faction, season, mode, error }
 *   window.__auditNext() void    — advance to the next vehicle/season
 *
 * The Electron driver (electron/audit-capture-real.ts) polls __auditReady,
 * captures via webContents.capturePage(), then calls __auditNext().
 *
 * Decal pass: for DECAL_VEHICLE_IDS, an extra frame is rendered after the
 * vanilla frame with a high-contrast asymmetric badge painted onto the overlay
 * canvas at the King Tiger hullSideRight rect (x:896, y:1152, w:512, h:512).
 * The camera is set to a right-side angle (azimuth ~45° right) so the badge
 * landing is clearly visible.
 */

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { VEHICLES, type VehicleSpec } from '@/lib/vehicles'
import { SCENE_PRESETS, applySeasonOverrides } from '@/lib/scene-settings'
import { detectInstallPath, nativePathToHandle } from '@/lib/native-fs'
import { preloadCommonArchives, preloadFaction } from '@/lib/preload'
import type { Faction } from '@/lib/vehicles'

const Viewport = React.lazy(() => import('@/components/Viewport'))

// ── Vehicle subsets ──────────────────────────────────────────────────────────
// Keep this set SMALL so a run finishes quickly. Edit here to add/remove.
// Vanilla: 4 vehicles × 2 seasons = 8 frames.
// Decal:   2-3 vehicles × summer only.
// `?only=<id>` (optional) renders a SINGLE vehicle — used to eyeball one
// vehicle per launch (the batch pipeline can stall after the first switch in
// the hidden audit window, so single-vehicle runs are the reliable path).
// `?onlySeason=summer|winter` optionally restricts the season.
const _auditParams = new URLSearchParams(location.search)
const _only = _auditParams.get('only')
const _onlySeason = _auditParams.get('onlySeason') as 'summer' | 'winter' | null

const VANILLA_IDS = _only ? [_only] : [
  'king_tiger_sdkfz_182',
  'panther_ausf_g',
  'cromwell',
  't34_76',
]

const DECAL_IDS = _only ? [] : [
  'king_tiger_sdkfz_182',
  'panther_ausf_g',
  'cromwell',
]

const SEASONS: Array<'summer' | 'winter'> =
  _onlySeason ? [_onlySeason] : ['summer', 'winter']

// Badge rect in the 2048² overlay canvas (King Tiger hullSideRight, used as
// an approximation for all vehicles — same rect as AtlasPreview3D).
const BADGE_RECT = { x: 896, y: 1152, w: 512, h: 512 }

// ── Build the audit queue ────────────────────────────────────────────────────

type AuditMode = 'vanilla' | 'decal'

interface AuditItem {
  vehicle: VehicleSpec
  season: 'summer' | 'winter'
  mode: AuditMode
}

function buildQueue(vehicles: VehicleSpec[]): AuditItem[] {
  const queue: AuditItem[] = []

  // Vanilla pass: all VANILLA_IDS × both seasons
  for (const id of VANILLA_IDS) {
    const spec = vehicles.find(v => v.id === id)
    if (!spec) continue
    for (const season of SEASONS) {
      queue.push({ vehicle: spec, season, mode: 'vanilla' })
    }
  }

  // Decal pass: summer only, right-side badge
  for (const id of DECAL_IDS) {
    const spec = vehicles.find(v => v.id === id)
    if (!spec) continue
    queue.push({ vehicle: spec, season: 'summer', mode: 'decal' })
  }

  return queue
}

// ── Paint a high-contrast asymmetric badge onto a 2048² canvas ───────────────

function paintBadge(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { x, y, w, h } = BADGE_RECT

  // Clear the badge zone
  ctx.clearRect(x, y, w, h)

  // Bright yellow background block — unmistakable
  ctx.fillStyle = '#ffdd00'
  ctx.fillRect(x, y, w, h)

  // Dark diagonal cross — asymmetric so orientation is clear
  ctx.strokeStyle = '#000033'
  ctx.lineWidth = 40
  ctx.beginPath()
  ctx.moveTo(x + 40, y + 40)
  ctx.lineTo(x + w - 40, y + h - 40)
  ctx.stroke()

  // One arm only (asymmetric: top-right to bottom-left is absent → easy to
  // tell which side is which in the capture)
  ctx.strokeStyle = '#cc0000'
  ctx.lineWidth = 30
  ctx.beginPath()
  ctx.moveTo(x + w / 2, y + 20)
  ctx.lineTo(x + w / 2, y + h - 20)
  ctx.stroke()

  // Label
  ctx.fillStyle = '#000033'
  ctx.font = `bold ${Math.floor(w / 6)}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('BADGE', x + w / 2, y + h / 2)
}

// ── Component ────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    __auditReady: boolean
    __auditFrame: string
    __auditMeta: {
      vehicleId: string
      faction: string
      season: string
      mode: AuditMode
      error: string | null
    }
    __auditNext: () => void
    __auditDone: boolean
    __auditProgress: { current: number; total: number }
  }
}

export default function AuditRunner() {
  const [installRoot, setInstallRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [queue, setQueue] = useState<AuditItem[]>([])
  const [idx, setIdx] = useState(0)
  const [overlayCanvas, setOverlayCanvas] = useState<HTMLCanvasElement | null>(null)
  const [overlayVersion, setOverlayVersion] = useState(0)

  // The Viewport canvas ref — used to grab the rendered frame
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const modelLoadedRef = useRef(false)
  // Reusable 2048² overlay the BODY meshes bind to (baseDiffuse + optional badge)
  const overlayBuildRef = useRef<HTMLCanvasElement | null>(null)
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafCancelRef = useRef<number | null>(null)

  // ── Boot: detect install, warm archive cache, then build queue ──────────
  useEffect(() => {
    detectInstallPath()
      .then(async p => {
        if (!p) {
          setInstallError('CoH2 install not detected. Set COH2_INSTALL env var.')
          return
        }
        const handle = nativePathToHandle(p)

        // Warm the shared SGA archive cache before iterating vehicles.
        // preloadCommonArchives opens ArtHigh*/ArtArmies in parallel so
        // subsequent vehicle mounts find archives already parsed — no
        // repeated ~300 MB cold reads per vehicle.
        console.log('[audit-runner] Warming common archive cache…')
        await preloadCommonArchives(handle, ({ current, fraction }) => {
          console.log(`[audit-runner] archive warm: ${current} (${Math.round(fraction * 100)}%)`)
        }).catch(e => console.warn('[audit-runner] preloadCommonArchives failed:', e))

        // Also warm per-faction caches for each faction present in the queue.
        const queueVehicles = buildQueue(VEHICLES).map(item => item.vehicle)
        const factions = [...new Set(queueVehicles.map(v => v.faction))] as Faction[]
        for (const faction of factions) {
          console.log(`[audit-runner] Warming faction archive cache: ${faction}`)
          await preloadFaction(handle, faction).catch(e =>
            console.warn(`[audit-runner] preloadFaction(${faction}) failed:`, e)
          )
        }

        console.log('[audit-runner] Archive cache warm — starting queue')
        setInstallRoot(handle)
        const q = buildQueue(VEHICLES)
        setQueue(q)
        window.__auditProgress = { current: 0, total: q.length }
        window.__auditDone = false
        window.__auditReady = false
      })
      .catch(e => setInstallError(String(e)))
  }, [])

  // ── Expose window.__auditNext ────────────────────────────────────────────
  useEffect(() => {
    window.__auditNext = () => {
      if (readyTimerRef.current) {
        clearTimeout(readyTimerRef.current)
        readyTimerRef.current = null
      }
      if (rafCancelRef.current !== null) {
        cancelAnimationFrame(rafCancelRef.current)
        rafCancelRef.current = null
      }
      window.__auditReady = false
      modelLoadedRef.current = false
      setOverlayCanvas(null)
      setIdx(i => i + 1)
    }
    return () => {
      window.__auditNext = () => {}
    }
  }, [])

  // ── Current item ─────────────────────────────────────────────────────────
  const item = queue[idx] ?? null
  const isDone = queue.length > 0 && idx >= queue.length

  // Update progress
  useEffect(() => {
    window.__auditProgress = { current: idx, total: queue.length }
    if (isDone) {
      window.__auditDone = true
      console.log('[audit-runner] All items processed.')
    }
  }, [idx, queue.length, isDone])

  // ── Overlay is built in handleModelLoaded (it needs the decoded baseDiffuse,
  //    which only exists after the model loads). On item change just clear it
  //    so the previous vehicle's overlay can't leak onto the next mount. ──────
  // The cleanup function runs when dependencies change (before the next effect),
  // which avoids calling setState synchronously in the effect body.
  useEffect(() => {
    return () => {
      setOverlayCanvas(null)
    }
  }, [item?.vehicle.id, item?.mode, item?.season])

  // ── Signal ready after model load + animation frames ────────────────────
  // Gate on 3 requestAnimationFrame ticks so the deferred CanvasTexture
  // upload and the first fully-textured frame are committed to the GPU
  // before we tell the driver to capture.
  const signalReady = useCallback((vehicleId: string, faction: string, season: string, mode: AuditMode, error: string | null) => {
    if (readyTimerRef.current) { clearTimeout(readyTimerRef.current); readyTimerRef.current = null }
    if (rafCancelRef.current !== null) { cancelAnimationFrame(rafCancelRef.current); rafCancelRef.current = null }

    const doSignal = () => {
      // Grab the canvas dataURL
      let frameUrl = ''
      try {
        // The Viewport renders into a <canvas> inside its container div.
        const canvas = document.querySelector('#audit-viewport-container canvas') as HTMLCanvasElement | null
        if (canvas) {
          frameUrl = canvas.toDataURL('image/png')
          canvasRef.current = canvas
        }
      } catch (e) {
        console.warn('[audit-runner] canvas.toDataURL failed', e)
      }

      window.__auditMeta = { vehicleId, faction, season, mode, error }
      window.__auditFrame = frameUrl
      window.__auditReady = true
      console.log(`[audit-runner] Ready: ${faction}/${vehicleId}/${season}/${mode} error=${error}`)
    }

    // Chain 3 rAF ticks to let R3F flush its render queue and upload
    // deferred textures (CanvasTexture.needsUpdate) to the GPU, then
    // capture on the 4th tick's start.
    let ticks = 0
    const tick = () => {
      ticks++
      if (ticks < 10) {
        rafCancelRef.current = requestAnimationFrame(tick)
      } else {
        rafCancelRef.current = null
        doSignal()
      }
    }
    rafCancelRef.current = requestAnimationFrame(tick)
  }, [])

  const handleModelLoaded = useCallback((_model?: unknown, diffuseImage?: HTMLCanvasElement | null) => {
    if (!item) return
    modelLoadedRef.current = true
    // DIAGNOSTIC: expose the exact diffuse canvas the Viewport decoded + uses,
    // so the driver can save it and we can compare "what the Viewport feeds the
    // model" against an independent flat decode of the same RGT.
    try {
      if (diffuseImage && typeof diffuseImage.toDataURL === 'function') {
        ;(window as unknown as { __auditDiffuse?: string }).__auditDiffuse = diffuseImage.toDataURL('image/png')
      } else {
        ;(window as unknown as { __auditDiffuse?: string }).__auditDiffuse = ''
      }
    } catch { /* ignore */ }
    // Build the overlay the BODY meshes bind to: baseDiffuse FIRST (the editor's
    // repaint() does this — without it the body renders untextured/dark, which
    // is what made the audit look like a flat tank), then the badge for decal mode.
    try {
      let canvas = overlayBuildRef.current
      if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.width = canvas.height = 2048
        overlayBuildRef.current = canvas
      }
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, 2048, 2048)
      if (diffuseImage) ctx.drawImage(diffuseImage, 0, 0, 2048, 2048)
      if (item.mode === 'decal') paintBadge(canvas)
      setOverlayCanvas(canvas)
      setOverlayVersion(v => v + 1)
    } catch (e) { console.warn('[audit-runner] overlay build failed', e) }
    signalReady(item.vehicle.id, item.vehicle.faction, item.season, item.mode, null)
  }, [item, signalReady])

  // ── Timeout per vehicle so a broken mesh doesn't stall the pipeline ──────
  useEffect(() => {
    if (!item) return
    modelLoadedRef.current = false
    window.__auditReady = false

    const timeout = setTimeout(() => {
      if (!modelLoadedRef.current) {
        console.warn(`[audit-runner] Timeout waiting for ${item.vehicle.id}/${item.season}`)
        signalReady(item.vehicle.id, item.vehicle.faction, item.season, item.mode,
          'timeout — model did not load within 90s')
      }
    }, 90_000)

    return () => clearTimeout(timeout)
  }, [item, signalReady])

  // ── Derive the scene preset with season overrides ────────────────────────
  const basePreset = SCENE_PRESETS['in_game_field']
  const seasonPreset = item ? applySeasonOverrides(basePreset, item.season) : basePreset

  // ── Camera override for decal pass: right-side angle ─────────────────────
  // Orbit ~45° to the right so the right hull side (where the badge lands)
  // faces the camera. Standard CoH2-ish 3/4 view elevation.
  const cameraInitial = item?.mode === 'decal'
    ? { position: [4.0, 2.5, -2.0] as [number, number, number], target: [0, 0.5, 0] as [number, number, number] }
    : undefined

  if (installError) {
    return (
      <div style={{ color: '#f55', padding: 24, fontFamily: 'monospace' }}>
        [audit-runner] Error: {installError}
      </div>
    )
  }

  if (!installRoot || queue.length === 0) {
    return (
      <div style={{ color: '#aaa', padding: 24, fontFamily: 'monospace' }}>
        [audit-runner] Detecting CoH2 install…
      </div>
    )
  }

  if (isDone) {
    return (
      <div style={{ color: '#4f4', padding: 24, fontFamily: 'monospace' }}>
        [audit-runner] Done. {queue.length} items processed.
      </div>
    )
  }

  if (!item) return null

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0c10', position: 'relative' }}>
      {/* Status overlay */}
      <div style={{
        position: 'absolute', top: 8, left: 8, zIndex: 100,
        color: '#eee', fontFamily: 'monospace', fontSize: 12,
        background: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: 4,
        pointerEvents: 'none',
      }}>
        [{idx + 1}/{queue.length}] {item.vehicle.faction}/{item.vehicle.id}/{item.season}/{item.mode}
      </div>

      {/* The real Viewport */}
      <div
        id="audit-viewport-container"
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={
          <div style={{ color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            Loading Viewport…
          </div>
        }>
          <Viewport
            key={`${item.vehicle.id}-${item.season}-${item.mode}`}
            root={installRoot}
            vehicle={item.vehicle}
            season={item.season}
            preset={seasonPreset}
            overlayCanvas={overlayCanvas}
            overlayVersion={overlayVersion}
            onModelLoaded={handleModelLoaded}
            selectedPart={null}
            explodeAll={false}
            envArchive={null}
            envName=""
            controlsEnabled={false}
            showCrew={false}
            showDestroyed={false}
            cameraInitial={cameraInitial}
          />
        </Suspense>
      </div>
    </div>
  )
}
