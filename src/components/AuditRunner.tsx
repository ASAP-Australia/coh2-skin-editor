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
import { resolveDecalUvRect } from '@/lib/vehicle-uv-registry'
import { buildCalibrationWrapperCanvas, BADGE_CELL } from '@/lib/verify-calibration'
import { parsePrompt, generateCamo, applyWeathering, CAMO_OVERLAY_ALPHA } from '@/lib/camo-generator'
import { buildCamoExclusionMask } from '@/lib/camo-mask'
import type { RgmModel } from '@/lib/rgm'

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

// ── VERIFY VISUAL mode ────────────────────────────────────────────────────────
// `?audit=1&verify=1` switches AuditRunner into the Phase-2 visual unwrap
// verifier: for ALL 61 catalog vehicles (or a single `?only=<id>`), render TWO
// summer frames through the REAL Viewport badge pipeline:
//   • mode='base' — badgeDecalSource = null  (no decal)
//   • mode='cal'  — badgeDecalSource = calibration wrapper canvas (4-quadrant
//                    square rasterised into the badge-cluster cell), which drives
//                    the onBeforeCompile TC1 badge shader exactly like a real
//                    local decal pack does in Editor.tsx.
// The Electron driver (electron/verify-visual-capture.ts, gated VERIFY_VISUAL=1)
// captures each pair to artifacts/verify-unwrap/visual/<faction>/<id>_{base,cal}.png.
const VERIFY_MODE = _auditParams.get('verify') === '1'
// Optional faction chunking for the verify pass: `?verifyFaction=<faction>`
// restricts the 61-vehicle queue to a single faction so the Electron driver can
// relaunch once per faction (5 chunks) — the resilient fallback for the hidden-
// window batch instability. Empty = all factions in one run.
const VERIFY_FACTION = _auditParams.get('verifyFaction') as Faction | null

// ── SHOWCASE mode ─────────────────────────────────────────────────────────────
// `?audit=1&showcase=1` renders a curated proof set for ONE vehicle through the
// REAL Viewport material — the same overlayCanvas (camo diffuse) + badgeDecalSource
// (decal) props the live Editor drives. Produces four frames:
//   • plain        — vanilla diffuse, no decal
//   • camo         — procedural camo composited onto the diffuse (editor recipe)
//   • decal        — vanilla diffuse + balkenkreuz decal via TC1 badge shader
//   • camo_decal   — camo diffuse + balkenkreuz decal (combined)
// Params: ?scv=<vehicleId> (default tiger), ?camo=<preset key> (default german_ambush).
// The Electron driver (electron/showcase-capture.ts) captures each to
// artifacts/created-assets/screenshots/<id>_<mode>.png.
const SHOWCASE_MODE = _auditParams.get('showcase') === '1'
const SHOWCASE_VEHICLE = _auditParams.get('scv') ?? 'tiger'
const SHOWCASE_CAMO = _auditParams.get('camo') ?? 'german_ambush'

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

// Badge rect resolved per-vehicle from vehicle-uv-registry — see paintBadge.

// ── Build the audit queue ────────────────────────────────────────────────────

type AuditMode = 'vanilla' | 'decal' | 'base' | 'cal'
  | 'plain' | 'camo' | 'showdecal' | 'camo_decal'

interface AuditItem {
  vehicle: VehicleSpec
  season: 'summer' | 'winter'
  mode: AuditMode
}

function buildQueue(vehicles: VehicleSpec[]): AuditItem[] {
  // ── SHOWCASE queue ──────────────────────────────────────────────────────
  // ONE vehicle, summer, four proof frames. Same stable-key Viewport across
  // all four so the mesh loads once (plain) and camo/decal are pure prop flips.
  if (SHOWCASE_MODE) {
    const spec = vehicles.find(v => v.id === SHOWCASE_VEHICLE)
    if (!spec) return []
    return (['plain', 'camo', 'showdecal', 'camo_decal'] as const).map(mode => ({
      vehicle: spec, season: 'summer' as const, mode,
    }))
  }

  // ── VERIFY VISUAL queue ─────────────────────────────────────────────────
  // ALL 61 vehicles (or a single `?only=<id>`), summer only, TWO frames each:
  // base (no decal) then cal (calibration decal via real badgeDecalSource).
  // Rendering base immediately before cal for the SAME vehicle keeps the model
  // warm in cache so the cal capture is a fast re-render, not a cold reload.
  if (VERIFY_MODE) {
    const queue: AuditItem[] = []
    // Iterate the raw VEHICLES array directly so the shared `halftrack` id
    // (german + soviet) yields BOTH catalog rows their own base+cal pair —
    // a `find(v => v.id === id)` loop would collapse them to the first (german).
    let specs = _only ? vehicles.filter(v => v.id === _only) : vehicles
    if (VERIFY_FACTION) specs = specs.filter(v => v.faction === VERIFY_FACTION)
    for (const spec of specs) {
      queue.push({ vehicle: spec, season: 'summer', mode: 'base' })
      queue.push({ vehicle: spec, season: 'summer', mode: 'cal' })
    }
    return queue
  }

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

function paintBadge(canvas: HTMLCanvasElement, vehicleId?: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { x, y, w, h } = resolveDecalUvRect(vehicleId ?? 'king_tiger_sdkfz_182')

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

// ── SHOWCASE: composite procedural camo onto a diffuse canvas ────────────────
// Mirrors Editor.tsx renderCamoPresetToOverlay (masked branch): the incoming
// canvas already holds the vanilla diffuse; draw the camo blobs source-atop at
// CAMO_OVERLAY_ALPHA (body pixels only), then apply procedural weathering.
function compositeCamo(
  target: HTMLCanvasElement,
  presetKey: string,
  exclusionMask?: HTMLCanvasElement | null,
): void {
  const W = 2048, H = 2048
  const cctx = target.getContext('2d')
  if (!cctx) return
  // Snapshot the pristine vanilla (already drawn on `target`) BEFORE compositing
  // so we can restore it over the excluded regions afterwards.
  let vanillaSnap: HTMLCanvasElement | null = null
  if (exclusionMask) {
    vanillaSnap = document.createElement('canvas')
    vanillaSnap.width = vanillaSnap.height = W
    vanillaSnap.getContext('2d')!.drawImage(target, 0, 0)
  }
  const preset = { ...parsePrompt(presetKey), maskedMode: true }
  const camo = document.createElement('canvas')
  camo.width = camo.height = W
  generateCamo(camo, preset, null)
  cctx.globalCompositeOperation = 'source-atop'
  cctx.globalAlpha = CAMO_OVERLAY_ALPHA
  cctx.drawImage(camo, 0, 0)
  cctx.globalAlpha = 1
  cctx.globalCompositeOperation = 'source-over'
  applyWeathering(cctx, W, H, preset.seed)
  // ARMOR-ONLY: restore vanilla over the excluded UV regions (tracks / wheels /
  // running gear / wreck / stowed equipment).
  if (exclusionMask && vanillaSnap) {
    const patch = document.createElement('canvas')
    patch.width = patch.height = W
    const pctx = patch.getContext('2d')!
    pctx.drawImage(vanillaSnap, 0, 0)
    pctx.globalCompositeOperation = 'destination-in'
    pctx.drawImage(exclusionMask, 0, 0, W, H)
    pctx.globalCompositeOperation = 'source-over'
    cctx.drawImage(patch, 0, 0)
  }
}

// ── SHOWCASE: build the balkenkreuz badge wrapper canvas ─────────────────────
// Mirrors Editor.tsx local-pack badgeDecalSource: rasterise the balkenkreuz
// insignia into the TC1 badge cell of a transparent 2048² wrapper so the real
// onBeforeCompile TC1 shader composites it exactly like a selected decal pack.
// ~0.72 cell fill (matches build-decal-balkenkreuz.ts CELL_FILL) so the cross is
// bold with a small transparent frame (avoids a cell-filling smear).
// Authentic Wehrmacht balkenkreuz geometry (matches public/insignia/balkenkreuz.svg):
// black cross with white inset bars.
const BALKENKREUZ_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">' +
  '<rect x="0" y="40" width="100" height="20" fill="#111"/>' +
  '<rect x="40" y="0" width="20" height="100" fill="#111"/>' +
  '<rect x="4" y="44" width="92" height="12" fill="#f2f2f2"/>' +
  '<rect x="44" y="4" width="12" height="92" fill="#f2f2f2"/>' +
  '</svg>'
function buildBalkenkreuzWrapper(): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const wrapper = document.createElement('canvas')
    wrapper.width = wrapper.height = 2048
    const ctx = wrapper.getContext('2d')!
    ctx.clearRect(0, 0, 2048, 2048)
    const { x, y, w, h } = BADGE_CELL
    const fill = 0.72
    const side = Math.round(Math.min(w, h) * fill)
    const dx = x + Math.round((w - side) / 2)
    const dy = y + Math.round((h - side) / 2)
    const img = new Image()
    img.onload = () => { ctx.drawImage(img, dx, dy, side, side); resolve(wrapper) }
    img.onerror = () => resolve(wrapper)
    img.src = `data:image/svg+xml;base64,${btoa(BALKENKREUZ_SVG)}`
  })
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
  // VERIFY mode: the calibration decal drives Viewport's REAL TC1 badge shader
  // via the badgeDecalSource prop (NOT the overlayCanvas/paintBadge synthetic
  // path). null for base frames, the 4-quadrant wrapper canvas for cal frames.
  const [badgeDecalSource, setBadgeDecalSource] = useState<HTMLCanvasElement | null>(null)
  // Built once, reused for every cal frame (construction is deterministic).
  const calibrationCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // VERIFY mode: the `<id>-<season>` key of the vehicle whose mesh is currently
  // mounted in the Viewport. Survives the base→cal item advance (which does NOT
  // remount, so the mesh stays loaded) — the transition effect keys off this to
  // know the cal frame can be captured without waiting for a fresh model load.
  const loadedVehicleKeyRef = useRef<string | null>(null)

  // The Viewport canvas ref — used to grab the rendered frame
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const modelLoadedRef = useRef(false)
  // Reusable 2048² overlay the BODY meshes bind to (baseDiffuse + optional badge)
  const overlayBuildRef = useRef<HTMLCanvasElement | null>(null)
  // SHOWCASE: cache of the decoded vanilla diffuse (survives the base→next item
  // advances so camo/decal frames recomposite without a mesh reload) + the
  // balkenkreuz wrapper (built once, reused for both decal frames).
  const showcaseDiffuseRef = useRef<HTMLCanvasElement | null>(null)
  // Armor-only camo exclusion mask for the currently-loaded showcase vehicle.
  const showcaseCamoMaskRef = useRef<HTMLCanvasElement | null>(null)
  const balkenkreuzRef = useRef<HTMLCanvasElement | null>(null)
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
      setBadgeDecalSource(null)
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
      setBadgeDecalSource(null)
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

    // Settle strategy — HIDDEN-WINDOW SAFE + FORCE-RENDER.
    // The old approach chained requestAnimationFrame ticks, but in a never-shown
    // (show:false) BrowserWindow the Viewport's render-on-demand loop goes idle
    // (renders only while needsRenderRef is set). A pure-rAF settle then STALLS
    // (the long-standing audit-batch hang) AND, worse, captures an EMPTY frame:
    // the vehicle mesh was added to the scene but the loop had already consumed
    // needsRenderRef, so the mesh was never drawn before toDataURL ran (empty
    // ground pad in the base frame → bogus footprint vs the cal frame).
    //
    // Fix: drive the settle from setTimeout (NOT throttled with
    // backgroundThrottling:false) and, on each tick, BUMP overlayVersion. The
    // Viewport's overlayVersion effect sets needsRenderRef=true, forcing the
    // loop to actually re-render the fully-loaded scene every tick. After enough
    // guaranteed renders we capture — so both base and cal frames are the real,
    // fully-drawn vehicle and differ ONLY by the calibration decal.
    let ticks = 0
    const TICKS = 16
    const step = () => {
      ticks++
      // Force a Viewport render this tick (mesh + overlay + badge all drawn).
      setOverlayVersion(v => v + 1)
      if (ticks < TICKS) {
        readyTimerRef.current = setTimeout(step, 40)
      } else {
        readyTimerRef.current = null
        doSignal()
      }
    }
    readyTimerRef.current = setTimeout(step, 40)
  }, [])

  const handleModelLoaded = useCallback((_model?: unknown, diffuseImage?: HTMLCanvasElement | null) => {
    // Build the armor-only camo exclusion mask from the loaded mesh so showcase
    // camo frames never paint tracks / wheels / running gear / equipment.
    try {
      const model = _model as RgmModel | undefined
      showcaseCamoMaskRef.current = model?.meshes
        ? buildCamoExclusionMask(model.meshes, item?.vehicle.id, item?.vehicle.faction)
        : null
    } catch (e) {
      console.warn('[audit-runner] camo mask build failed', e)
      showcaseCamoMaskRef.current = null
    }
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
      // Legacy synthetic-badge path is ONLY used by the old decal audit mode.
      // In VERIFY mode we deliberately DO NOT paintBadge — the calibration decal
      // must render through the real TC1 shader via badgeDecalSource below.
      if (item.mode === 'decal') paintBadge(canvas, item.vehicle.id)
      // SHOWCASE: composite procedural camo onto the diffuse for camo modes,
      // exactly as Editor.renderCamoPresetToOverlay does (source-atop + weather).
      if (SHOWCASE_MODE && (item.mode === 'camo' || item.mode === 'camo_decal')) {
        compositeCamo(canvas, SHOWCASE_CAMO, showcaseCamoMaskRef.current)
      }
      setOverlayCanvas(canvas)
      setOverlayVersion(v => v + 1)
    } catch (e) { console.warn('[audit-runner] overlay build failed', e) }

    // VERIFY mode: drive the real badge pipeline. base → null, cal → wrapper.
    // handleModelLoaded fires on the FIRST item that loads the mesh (base). The
    // cal frame reuses the same mounted Viewport (stable key) so this callback
    // won't fire again for it — the verify-transition effect below drives cal.
    if (VERIFY_MODE) {
      loadedVehicleKeyRef.current = `${item.vehicle.id}-${item.season}`
      if (item.mode === 'cal') {
        if (!calibrationCanvasRef.current) {
          calibrationCanvasRef.current = buildCalibrationWrapperCanvas()
        }
        setBadgeDecalSource(calibrationCanvasRef.current)
      } else {
        setBadgeDecalSource(null)
      }
    }

    // SHOWCASE mode: cache the decoded vanilla diffuse so the camo/decal frames
    // (which reuse the same stable-key Viewport → no reload) can recomposite it.
    // handleModelLoaded fires on the FIRST item (plain, no decal). Later frames
    // are driven by the showcase-transition effect below.
    if (SHOWCASE_MODE) {
      loadedVehicleKeyRef.current = `${item.vehicle.id}-${item.season}`
      if (diffuseImage) {
        let cache = showcaseDiffuseRef.current
        if (!cache) {
          cache = document.createElement('canvas')
          cache.width = cache.height = 2048
          showcaseDiffuseRef.current = cache
        }
        const cctx = cache.getContext('2d')!
        cctx.clearRect(0, 0, 2048, 2048)
        cctx.drawImage(diffuseImage, 0, 0, 2048, 2048)
      }
      setBadgeDecalSource(null) // plain frame: no decal
    }

    signalReady(item.vehicle.id, item.vehicle.faction, item.season, item.mode, null)
  }, [item, signalReady])

  // ── SHOWCASE: per-frame transition without a remount ─────────────────────
  // The four showcase frames (plain → camo → showdecal → camo_decal) share one
  // stable-key Viewport, so the mesh loads once (plain, via handleModelLoaded).
  // Frames 2-4 are driven here: rebuild the overlay from the cached vanilla
  // diffuse (+ camo for camo modes) and flip badgeDecalSource to the balkenkreuz
  // wrapper for decal modes — the exact overlayCanvas + badgeDecalSource props
  // the live Editor drives.
  useEffect(() => {
    if (!SHOWCASE_MODE || !item) return
    if (item.mode === 'plain') return // handled by handleModelLoaded
    if (loadedVehicleKeyRef.current !== `${item.vehicle.id}-${item.season}`) return

    let cancelled = false
    void (async () => {
      const wantCamo = item.mode === 'camo' || item.mode === 'camo_decal'
      const wantDecal = item.mode === 'showdecal' || item.mode === 'camo_decal'

      // Rebuild the overlay: vanilla diffuse base (+ camo for camo modes).
      let canvas = overlayBuildRef.current
      if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.width = canvas.height = 2048
        overlayBuildRef.current = canvas
      }
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, 2048, 2048)
      if (showcaseDiffuseRef.current) ctx.drawImage(showcaseDiffuseRef.current, 0, 0, 2048, 2048)
      if (wantCamo) compositeCamo(canvas, SHOWCASE_CAMO, showcaseCamoMaskRef.current)

      // Build the balkenkreuz wrapper (once) for decal modes.
      let decal: HTMLCanvasElement | null = null
      if (wantDecal) {
        if (!balkenkreuzRef.current) balkenkreuzRef.current = await buildBalkenkreuzWrapper()
        decal = balkenkreuzRef.current
      }
      if (cancelled) return

      modelLoadedRef.current = true
      setOverlayCanvas(canvas)
      setOverlayVersion(v => v + 1)
      setBadgeDecalSource(decal)
      signalReady(item.vehicle.id, item.vehicle.faction, item.season, item.mode, null)
    })()

    return () => { cancelled = true }
  }, [item, signalReady])

  // ── VERIFY mode: base→cal transition without a remount ───────────────────
  // With a stable Viewport key across base↔cal for one vehicle, switching to
  // the cal item does NOT remount the Viewport, so handleModelLoaded never
  // re-fires. This effect detects "cal item, mesh already loaded" and drives
  // the cal frame directly: flip badgeDecalSource to the calibration wrapper
  // (the real TC1 shader recomposites) then signalReady after the rAF settle.
  useEffect(() => {
    if (!VERIFY_MODE || !item) return
    if (item.mode !== 'cal') return
    // Only fire when the mesh for this vehicle is already mounted (i.e. base
    // just rendered on the SAME stable-key Viewport). loadedVehicleKeyRef is set
    // in handleModelLoaded and survives the __auditNext advance (no remount), so
    // it — not modelLoadedRef, which __auditNext resets — is the correct gate.
    if (loadedVehicleKeyRef.current !== `${item.vehicle.id}-${item.season}`) return
    // Mesh is up: mark loaded so the per-item timeout for the cal item is a
    // no-op, flip on the calibration decal, and capture after the rAF settle.
    modelLoadedRef.current = true
    if (!calibrationCanvasRef.current) {
      calibrationCanvasRef.current = buildCalibrationWrapperCanvas()
    }
    setBadgeDecalSource(calibrationCanvasRef.current)
    signalReady(item.vehicle.id, item.vehicle.faction, item.season, 'cal', null)
  }, [item, signalReady])

  // ── Timeout per vehicle so a broken mesh doesn't stall the pipeline ──────
  useEffect(() => {
    if (!item) return
    modelLoadedRef.current = false
    window.__auditReady = false

    // Per-item load timeout. SHOWCASE mode needs a much longer budget: the very
    // first (plain) frame does a COLD Tiger mesh + RGT decode which can exceed
    // 90s on first load (subsequent frames reuse the stable-key Viewport and are
    // instant). Override via ?loadTimeoutMs=<n> so a genuinely broken mesh still
    // can't stall the pipeline forever.
    const loadTimeoutMs = Number(_auditParams.get('loadTimeoutMs') ?? (SHOWCASE_MODE ? 300_000 : 90_000))
    const timeout = setTimeout(() => {
      if (!modelLoadedRef.current) {
        console.warn(`[audit-runner] Timeout waiting for ${item.vehicle.id}/${item.season} (${loadTimeoutMs}ms)`)
        signalReady(item.vehicle.id, item.vehicle.faction, item.season, item.mode,
          `timeout — model did not load within ${Math.round(loadTimeoutMs / 1000)}s`)
      }
    }, loadTimeoutMs)

    return () => clearTimeout(timeout)
  }, [item, signalReady])

  // ── Derive the scene preset with season overrides ────────────────────────
  const basePreset = SCENE_PRESETS['in_game_field']
  const seasonPreset = item ? applySeasonOverrides(basePreset, item.season) : basePreset

  // ── Camera override for decal pass: right-side angle ─────────────────────
  // Orbit ~45° to the right so the right hull side (where the badge lands)
  // faces the camera. Standard CoH2-ish 3/4 view elevation.
  //
  // VERIFY mode deliberately passes NO cameraInitial: the Viewport build path
  // auto-frames every vehicle ONCE with a fixed, size-aware recipe
  // (dir=(1,0.45,-1), FIXED_FRAME_RADIUS — Viewport.tsx ~4078) that is identical
  // across base and cal (stable-key Viewport is framed once, on the base load,
  // and never re-framed). That +X-facing 3/4 view shows the right hull side
  // where the badge lands, and being size-aware it frames small utility trucks
  // and King Tigers consistently — better than a single hardcoded pose.
  const cameraInitial = (item?.mode === 'decal')
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
            key={
              // VERIFY mode keeps the SAME key across base↔cal for one vehicle so
              // the Viewport does NOT remount between the two frames — only the
              // badgeDecalSource prop flips. Remounting a canvas in a hidden
              // (show:false) window strands the R3F rAF loop and stalls the
              // batch (the long-standing audit-batch instability). A stable key
              // makes base→cal a pure prop update through the real badge shader.
              // SHOWCASE mode likewise keeps ONE stable key across all four
              // frames so the mesh loads once and camo/decal are pure prop flips.
              (VERIFY_MODE || SHOWCASE_MODE)
                ? `${item.vehicle.id}-${item.season}`
                : `${item.vehicle.id}-${item.season}-${item.mode}`
            }
            root={installRoot}
            vehicle={item.vehicle}
            season={item.season}
            preset={seasonPreset}
            overlayCanvas={overlayCanvas}
            overlayVersion={overlayVersion}
            badgeDecalSource={badgeDecalSource}
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
