/// <reference lib="webworker" />
/**
 * asap-flag-worker — runs the per-frame "waving flag inside ASAP letters"
 * animation on a dedicated worker thread.
 *
 * Why a worker?
 *   When the user clicks Continue / Connect, the editor mounts and starts
 *   decoding the first vehicle's .rgm + textures + cubemap on the main
 *   thread. That work runs in synchronous bursts of 50–200 ms each — long
 *   enough that requestAnimationFrame callbacks queued from the AsapFlag-
 *   Heading rAF loop are starved. The flag-wave visibly froze mid-stride
 *   while the FLIP icon-to-centre transform kept going (CSS transforms
 *   are compositor-thread, immune to main-thread stalls).
 *
 *   Moving the wave into a dedicated worker — same trick LoadingBorder
 *   uses for its marching beam — gives the animation its own thread of
 *   execution. The Three.js model decode on main cannot block this
 *   timer.
 *
 * What's pre-baked on the main thread (one-shot, sent via init):
 *   - flagPixels:  Uint8ClampedArray of the Australian flag rasterised
 *                  at SS× backing-store resolution (the source of the
 *                  per-frame wave sampling).
 *   - textBitmap:  ImageBitmap of "ASAP" rendered in solid white at
 *                  backing-store resolution — the front-face alpha mask.
 *   - extBitmap:   ImageBitmap of the 5-slice extrusion staircase painted
 *                  in #141414 at backing-store resolution.
 *
 *   These all involve the Jost variable font, which we can't easily load
 *   into a worker's FontFaceSet — so we bake them once on the main thread
 *   after `document.fonts.ready` resolves, then transfer as Transferables
 *   so the worker can drawImage them every frame for free.
 *
 * What runs in the worker each frame:
 *   1. Wave loop: read flagPixels, write to waveData with per-column
 *      vertical sine offset + bilinear vertical interpolation. This is
 *      the only pixel-level work; everything else is drawImage.
 *   2. Composite onto the visible canvas:
 *        clear → drawImage(textBitmap)
 *        source-in → drawImage(waveCanvas)  // colours letters with flag
 *        destination-over → drawImage(extBitmap)  // puts 3-D under
 *
 * Cadence: setInterval @ ~33 ms (≈ 30 FPS). Workers don't have rAF.
 * 30 FPS is enough for a decorative wave and halves the CPU cost of
 * doing this at 60.
 */

type InitMsg = {
  type: 'init'
  canvas: OffscreenCanvas
  flagPixels: Uint8ClampedArray
  textBitmap: ImageBitmap
  extBitmap: ImageBitmap
  cssW: number // logical (CSS) canvas width
  cssH: number // logical (CSS) canvas height
  bsW: number // backing-store width (cssW * dpr)
  bsH: number // backing-store height (cssH * dpr)
  dpr: number
  ssW: number // supersampled flag width  (bsW * SS)
  ssH: number // supersampled flag height (bsH * SS)
  prefersReduced: boolean
}
type StopMsg = { type: 'stop' }
type Msg = InitMsg | StopMsg

let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let textBitmap: ImageBitmap | null = null
let extBitmap: ImageBitmap | null = null

let cssW = 0
let cssH = 0
let ssW = 0
let ssH = 0

// Source flag pixel buffer (RGBA, length = ssW*ssH*4).
let src: Uint8ClampedArray | null = null
// Per-frame waved-flag pixel buffer (same shape as src).
let dst: Uint8ClampedArray | null = null
// The waveCanvas holds the dst pixels each frame so we can drawImage it
// onto the visible canvas with source-in.
let waveCanvas: OffscreenCanvas | null = null
let waveCtx: OffscreenCanvasRenderingContext2D | null = null
let waveImage: ImageData | null = null

let timerId: ReturnType<typeof setInterval> | null = null
let startTime = 0
let prefersReduced = false

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function drawFrame() {
  if (!ctx || !canvas || !waveCanvas || !waveCtx || !waveImage || !src || !dst) return
  if (!textBitmap || !extBitmap) return

  const t = (nowMs() - startTime) / 1000

  // 1) Per-column vertical sine offset, with bilinear interpolation along
  //    Y so the wave reads as smooth even at large amplitude. Identical
  //    math to the previous main-thread implementation — moved here so
  //    Three.js's decode bursts on the main thread don't stall it.
  for (let x = 0; x < ssW; x++) {
    const nx = x / ssW
    const wave = prefersReduced
      ? 0
      : Math.sin(nx * 10.24 + t * 1.4) * (ssH * 0.056) +
        Math.sin(nx * 4.096 - t * 0.9) * (ssH * 0.031)
    for (let y = 0; y < ssH; y++) {
      const sy = y + wave
      const sy0 = sy < 0 ? 0 : sy > ssH - 1 ? ssH - 1 : sy
      const y0 = sy0 | 0
      const y1 = y0 + 1 > ssH - 1 ? ssH - 1 : y0 + 1
      const fy = sy0 - y0
      const ify = 1 - fy
      const idx0 = (y0 * ssW + x) << 2
      const idx1 = (y1 * ssW + x) << 2
      const dstIdx = (y * ssW + x) << 2
      dst[dstIdx] = src[idx0] * ify + src[idx1] * fy
      dst[dstIdx + 1] = src[idx0 + 1] * ify + src[idx1 + 1] * fy
      dst[dstIdx + 2] = src[idx0 + 2] * ify + src[idx1 + 2] * fy
      dst[dstIdx + 3] = 255
    }
  }
  waveCtx.putImageData(waveImage, 0, 0)

  // 2) Composite onto the visible canvas.
  ctx.save()
  ctx.clearRect(0, 0, cssW, cssH)

  // Front-face mask: solid-white text. Its alpha defines where the
  // flag will appear; the white pixel colour is irrelevant since we
  // overwrite it with source-in next.
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(textBitmap, 0, 0, cssW, cssH)

  // Fill the letter shapes with the waved flag — `source-in` keeps
  // only the pixels of the new image where existing alpha is set.
  ctx.globalCompositeOperation = 'source-in'
  ctx.drawImage(waveCanvas, 0, 0, ssW, ssH, 0, 0, cssW, cssH)

  // 3-D extrusion: lands UNDER the existing flag-filled face.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.drawImage(extBitmap, 0, 0, cssW, cssH)

  ctx.restore()
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
      cssW = msg.cssW
      cssH = msg.cssH
      ssW = msg.ssW
      ssH = msg.ssH
      prefersReduced = msg.prefersReduced

      // Backing-store sizing — match the main-thread original. The
      // visible context is then scaled by dpr so all drawImage targets
      // can use logical (CSS) coords.
      canvas.width = msg.bsW
      canvas.height = msg.bsH
      ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(msg.dpr, 0, 0, msg.dpr, 0, 0)

      textBitmap = msg.textBitmap
      extBitmap = msg.extBitmap
      src = msg.flagPixels

      // Wave scratch canvas — same size as the source flag. We use
      // ctx.createImageData() to get a correctly-typed ImageData (rather
      // than constructing one from the transferred Uint8ClampedArray,
      // whose buffer type is ArrayBufferLike post-transfer and trips
      // TypeScript's stricter Uint8ClampedArray<ArrayBuffer> overload).
      // dst aliases the new ImageData's internal data buffer so the
      // wave loop writes directly into it.
      waveCanvas = new OffscreenCanvas(ssW, ssH)
      waveCtx = waveCanvas.getContext('2d')
      if (waveCtx) {
        waveImage = waveCtx.createImageData(ssW, ssH)
        dst = waveImage.data
      }

      startTime = nowMs()

      if (prefersReduced) {
        // Single static frame — no timer needed.
        drawFrame()
        return
      }

      // Paint one frame immediately so the first repaint isn't blank.
      drawFrame()
      // ~30 FPS. The wave is decorative; 30 reads as smooth and halves
      // CPU vs 60. Workers don't have requestAnimationFrame so this is
      // the closest cadence primitive.
      timerId = setInterval(drawFrame, 33)
      break
    }
    case 'stop': {
      stopTicker()
      break
    }
  }
}
