/// <reference lib="webworker" />
/**
 * LoadingBorder worker — paints the marching-beam stroke on an
 * OffscreenCanvas in a dedicated worker thread.
 *
 * Why a worker?
 *   The SVG / CSS version of this component animates `stroke-dashoffset`,
 *   which is a paint-pipeline property — its tick runs on the main thread.
 *   When Three.js stalls the main thread for 30–50 ms at a time decoding a
 *   DXT-compressed texture or parsing an RGM, the SVG animation drops
 *   frames and the beam stutters visibly. CSS hints like
 *   `will-change: stroke-dashoffset` don't change that: SVG path attribute
 *   animations are still ticked on the compositor's main thread.
 *
 *   Moving the rendering into a worker that owns an OffscreenCanvas means
 *   the animation has its own thread of execution. The model decode on
 *   the main thread cannot starve the beam.
 *
 * Why setInterval and not requestAnimationFrame?
 *   Dedicated workers don't have rAF. setInterval(16) gives us roughly
 *   60 FPS with a few ms of jitter, which is fine for a marching beam
 *   (the animation is constant-velocity arc-length, so frame-time
 *   variance translates into imperceptible position jitter, not perceived
 *   speed changes).
 */

type InitMsg = {
  type: 'init'
  canvas: OffscreenCanvas
  width: number
  height: number
  dpr: number
  radius: number
  thickness: number
  duration: number
  beamFraction: number
  haloColor: string
  coreColor: string
}
type ResizeMsg = {
  type: 'resize'
  width: number
  height: number
  dpr: number
}
type ParamsMsg = {
  type: 'params'
  radius?: number
  thickness?: number
  duration?: number
  beamFraction?: number
  haloColor?: string
  coreColor?: string
}
type StopMsg = { type: 'stop' }
type Msg = InitMsg | ResizeMsg | ParamsMsg | StopMsg

let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let timerId: ReturnType<typeof setInterval> | null = null
let startTime = 0

let cssW = 0
let cssH = 0
let dpr = 1
let radius = 16
let thickness = 1.5
let duration = 1.6
let beamFraction = 0.22
let haloColor = 'rgba(120,200,255,0.45)'
let coreColor = 'rgba(220,240,255,1)'

let cachedPath: Path2D | null = null
let cachedPerimeter = 0

function buildPath() {
  cachedPath = null
  cachedPerimeter = 0
  if (cssW <= 0 || cssH <= 0) return
  const t = thickness / 2
  const w = cssW
  const h = cssH
  const r = Math.max(0, Math.min(radius, w / 2, h / 2) - t)
  if (w <= 2 * t || h <= 2 * t) return
  const X1 = t
  const Y1 = t
  const X2 = w - t
  const Y2 = h - t
  const p = new Path2D()
  p.moveTo(X1 + r, Y1)
  p.lineTo(X2 - r, Y1)
  p.arcTo(X2, Y1, X2, Y1 + r, r)
  p.lineTo(X2, Y2 - r)
  p.arcTo(X2, Y2, X2 - r, Y2, r)
  p.lineTo(X1 + r, Y2)
  p.arcTo(X1, Y2, X1, Y2 - r, r)
  p.lineTo(X1, Y1 + r)
  p.arcTo(X1, Y1, X1 + r, Y1, r)
  p.closePath()
  cachedPath = p
  // Perimeter of rounded rect: straight runs + four quarter-circles
  cachedPerimeter = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r
}

function applyCanvasSize() {
  if (!canvas) return
  const pxW = Math.max(1, Math.round(cssW * dpr))
  const pxH = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== pxW) canvas.width = pxW
  if (canvas.height !== pxH) canvas.height = pxH
  // After setting canvas.width/height the context is reset, so we need
  // to re-fetch and re-apply the dpr scale on every resize.
  ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
  }
  buildPath()
}

function drawFrame() {
  if (!ctx || !cachedPath || cachedPerimeter === 0) return
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const elapsed = (now - startTime) / 1000
  const phase = (((elapsed / duration) % 1) + 1) % 1
  const offset = -phase * cachedPerimeter
  const dashOn = beamFraction * cachedPerimeter
  const dashOff = cachedPerimeter - dashOn

  ctx.clearRect(0, 0, cssW, cssH)

  // Halo pass — thick, translucent, gives the beam volume.
  ctx.strokeStyle = haloColor
  ctx.lineWidth = thickness * 3
  ctx.setLineDash([dashOn, dashOff])
  ctx.lineDashOffset = offset
  ctx.stroke(cachedPath)

  // Core pass — thin, bright, the actual filament.
  ctx.strokeStyle = coreColor
  ctx.lineWidth = thickness
  // Same dash + offset so the two strokes march in lock-step.
  ctx.setLineDash([dashOn, dashOff])
  ctx.lineDashOffset = offset
  ctx.stroke(cachedPath)
}

function startTicker() {
  if (timerId != null) return
  startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
  // 16 ms ≈ 60 Hz. Workers don't have rAF; setInterval is the closest
  // primitive. The drift is invisible for a marching beam.
  timerId = setInterval(drawFrame, 16)
}

function stopTicker() {
  if (timerId != null) {
    clearInterval(timerId)
    timerId = null
  }
}

;(self as unknown as DedicatedWorkerGlobalScope).onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data
  switch (msg.type) {
    case 'init': {
      canvas = msg.canvas
      cssW = msg.width
      cssH = msg.height
      dpr = msg.dpr
      radius = msg.radius
      thickness = msg.thickness
      duration = msg.duration
      beamFraction = msg.beamFraction
      haloColor = msg.haloColor
      coreColor = msg.coreColor
      applyCanvasSize()
      // Paint one frame immediately so there is no blank flash before
      // the first interval tick fires.
      drawFrame()
      startTicker()
      break
    }
    case 'resize': {
      cssW = msg.width
      cssH = msg.height
      dpr = msg.dpr
      applyCanvasSize()
      // Draw immediately so the resized beam doesn't show a stale
      // single-frame snapshot at the old size.
      drawFrame()
      break
    }
    case 'params': {
      if (msg.radius !== undefined) radius = msg.radius
      if (msg.thickness !== undefined) thickness = msg.thickness
      if (msg.duration !== undefined) duration = msg.duration
      if (msg.beamFraction !== undefined) beamFraction = msg.beamFraction
      if (msg.haloColor !== undefined) haloColor = msg.haloColor
      if (msg.coreColor !== undefined) coreColor = msg.coreColor
      buildPath()
      drawFrame()
      break
    }
    case 'stop': {
      stopTicker()
      break
    }
  }
}
