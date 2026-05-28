/**
 * AsapFlagHeading — "ASAP" wordmark in bold italic Jost with the
 * Australian flag waving inside the letters (canvas clip-mask).
 *
 * Port of FlagHeading.web.tsx from the ASAP mobile app (originally
 * React-Native / Expo) to plain React + DOM canvas for this Vite +
 * Electron codebase. Two changes from the upstream version:
 *
 *   • React-Native View + StyleSheet are replaced with a regular
 *     <div>/<canvas>. No react-native-web dependency.
 *   • Sized by `height` (CSS px) rather than the upstream `scale`
 *     multiplier — easier to drop into a 56 × 56 icon slot. fontSize
 *     and letter spacing scale off `height`.
 *
 * Implementation strategy:
 *   1. Main thread (once, after font loads):
 *      - Rasterise the Australian flag SVG at 2× backing-store resolution
 *        (supersampled) into a Uint8ClampedArray.
 *      - Bake the "ASAP" front-face mask as an ImageBitmap (white text on
 *        transparent — the alpha is what matters; the white gets fully
 *        overwritten when the wave colours the letters).
 *      - Bake the 5-slice extrusion staircase as a separate ImageBitmap
 *        (#141414 colour, transparent elsewhere).
 *   2. Transfer everything (canvas, flag pixels, two bitmaps) to a
 *      dedicated worker via `transferControlToOffscreen` + Transferables.
 *   3. The worker runs the per-frame wave + composite on its own thread
 *      — same pattern as LoadingBorder. This is what keeps the
 *      animation smooth while the editor's Three.js / model-decode work
 *      stalls the main thread for 50–200 ms at a time during the
 *      Continue → editor-loading handoff. (The previous main-thread rAF
 *      implementation visibly froze mid-wave while the FLIP-to-centre
 *      transform kept moving via compositor-thread CSS.)
 *
 * Worker frame budget: setInterval @ ~33 ms (≈ 30 FPS). Workers don't
 * have rAF; setInterval is the closest cadence primitive.
 *
 * Respects prefers-reduced-motion (worker renders a single static
 * frame and skips the timer).
 */

import { useEffect, useRef, type CSSProperties } from 'react'

const AUSTRALIAN_FLAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600">
  <rect fill="#012169" width="1200" height="600"/>
  <g>
    <clipPath id="c"><rect width="600" height="300"/></clipPath>
    <g clip-path="url(#c)">
      <path d="M0,0 L600,300 M600,0 L0,300" stroke="#FFF" stroke-width="72"/>
      <path d="M0,0 L600,300" stroke="#C8102E" stroke-width="36"/>
      <path d="M600,0 L0,300" stroke="#C8102E" stroke-width="36"/>
      <path d="M300,0 V300 M0,150 H600" stroke="#FFF" stroke-width="100"/>
      <path d="M300,0 V300 M0,150 H600" stroke="#C8102E" stroke-width="60"/>
    </g>
  </g>
  <polygon fill="#FFF" points="253.0,417.0 262.8,446.7 292.1,435.8 274.9,462.0 301.7,478.1 270.6,481.0 274.7,512.0 253.0,489.5 231.3,512.0 235.4,481.0 204.3,478.1 231.1,462.0 213.9,435.8 243.2,446.7"/>
  <polygon fill="#FFF" points="890.0,509.0 893.5,519.7 904.1,515.8 897.9,525.2 907.5,531.0 896.3,532.1 897.8,543.2 890.0,535.1 882.2,543.2 883.7,532.1 872.5,531.0 882.1,525.2 875.9,515.8 886.5,519.7"/>
  <polygon fill="#FFF" points="770.0,195.0 773.5,205.7 784.1,201.8 777.9,211.2 787.5,217.0 776.3,218.1 777.8,229.2 770.0,221.1 762.2,229.2 763.7,218.1 752.5,217.0 762.1,211.2 755.9,201.8 766.5,205.7"/>
  <polygon fill="#FFF" points="890.0,82.0 893.5,92.7 904.1,88.8 897.9,98.2 907.5,104.0 896.3,105.1 897.8,116.2 890.0,108.1 882.2,116.2 883.7,105.1 872.5,104.0 882.1,98.2 875.9,88.8 886.5,92.7"/>
  <polygon fill="#FFF" points="1010.0,289.0 1013.5,299.7 1024.1,295.8 1017.9,305.2 1027.5,311.0 1016.3,312.1 1017.8,323.2 1010.0,315.1 1002.2,323.2 1003.7,312.1 992.5,311.0 1002.1,305.2 995.9,295.8 1006.5,299.7"/>
  <polygon fill="#FFF" points="950.0,381.0 953.2,388.6 961.4,389.3 955.1,394.7 957.1,402.7 950.0,398.4 942.9,402.7 944.9,394.7 938.6,389.3 946.8,388.6"/>
</svg>`

interface Props {
  /** Rendered height in CSS px. Width auto-derives from the "ASAP"
   *  glyph metrics (≈ 2.8 × height for Jost Bold Italic + italic
   *  overhang). Default 72 — a touch larger than the legacy 56-px
   *  asap-logo so the wordmark reads clearly without dominating the
   *  card. */
  height?: number
  className?: string
  style?: CSSProperties
}

export default function AsapFlagHeading({ height = 72, className, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Derived sizing — all proportional to `height`.
  //
  //  • fontSize 0.92 × height puts the cap-height of Jost Bold Italic
  //    roughly inside the bounding box (the descender + ascender
  //    metrics sit comfortably inside the canvas at this ratio).
  //  • letterSpacing — POSITIVE tracking so the four italic glyphs sit
  //    at visually-even gaps. The italic slope causes adjacent letters
  //    to look like they're crowding (A↘ + S↗ visual collision)
  //    even when the metric advance is technically correct. 0.055 ×
  //    height (≈ +4 px at height 72) opens the gaps so all four
  //    pair-gaps read as visually equal. Previous 0.03 was too tight
  //    — A-S looked crowded compared with A-P.
  //  • leftPad — small inset so the italic-slope TOP-left of the 'A'
  //    isn't clipped against the canvas's left edge.
  //  • overhangPad — generous right inset so the italic descender of
  //    the 'P' isn't clipped (the user reported "clips off a bit" on
  //    the right at the previous 0.32 ratio).
  const fontSize = Math.round(height * 0.92)
  const letterSpacing = Math.max(2, Math.round(height * 0.055))
  const leftPad = Math.round(height * 0.06)
  const overhangPad = Math.round(height * 0.45)
  // 3-D extrusion staircase.
  //  • depth = offset copies of the word painted behind the flag
  //    face via destination-over → "pushed forward" look. Dropped
  //    10 → 5 because the previous 10-slice stack read as a heavy
  //    chunky drop-shadow that overpowered the flag-filled face.
  //  • step  = px between adjacent slices. 0.011 × height keeps the
  //    proportion consistent across header sizes (≈ 0.8 px at height
  //    72).
  // maxExtrude = how far the deepest slice sits below+right of the
  //    front face. Used to grow the canvas height and right padding
  //    so the staircase doesn't clip at the bottom or trailing edge.
  const extrudeDepth = 5
  const extrudeStep = Math.max(0.6, height * 0.011)
  const maxExtrude = Math.ceil(extrudeDepth * extrudeStep)
  // Total CSS width: leftPad + (≈ letter widths + tracking) + overhang
  //   + maxExtrude so the staircase has room on the right edge too.
  // Letter width factor 0.62 of fontSize is conservative — Jost Bold
  // Italic letters average ≈ 0.55–0.60 × fontSize but 'P' is one of
  // the widest, so we pad slightly to avoid clipping on the canvas
  // edge even before considering the italic slope.
  const approxWidth =
    leftPad + Math.round(fontSize * 0.62 * 4 + letterSpacing * 3) + overhangPad + maxExtrude
  // The canvas is taller than the wrapper's layout box by `maxExtrude`
  // so the staircase shadow can fall below the front-face baseline
  // without being clipped. The wrapper keeps `height` for layout, the
  // overflow at the bottom is purely visual.
  const canvasHeight = height + maxExtrude

  useEffect(() => {
    if (typeof window === 'undefined') return
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let worker: Worker | null = null

    const setup = async () => {
      // Wait for the Jost font to actually be available before baking
      // the text + extrusion bitmaps — otherwise they'd rasterise in
      // the browser fallback font and stay that way (the worker can't
      // re-bake them later, since fonts aren't easily loaded into a
      // worker's FontFaceSet).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- document.fonts is a FontFaceSet; older lib.dom.d.ts versions may not have it
      if ((document as any).fonts?.ready) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same
          await (document as any).fonts.ready
        } catch {
          /* ignore */
        }
      }
      if (cancelled || !canvasRef.current) return

      const c = canvasRef.current
      const rect = c.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const cssW = rect.width
      const cssH = rect.height
      const bsW = Math.max(1, Math.round(cssW * dpr))
      const bsH = Math.max(1, Math.round(cssH * dpr))
      // SUPERSAMPLE — 2× the backing-store size for the flag, then the
      // worker downsamples on composite with high-quality smoothing.
      // See module docstring for the rationale.
      const SS = 2
      const ssW = bsW * SS
      const ssH = bsH * SS
      // Where the FRONT FACE of the text sits vertically. Centered in
      // the wrapper's layout box (`height`), NOT the full backing-store
      // (which is taller by `maxExtrude` to host the staircase).
      const textY = height / 2
      const prefersReduced =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

      // ── Step 1: rasterise the flag SVG at supersampled resolution.
      let flagPixels: Uint8ClampedArray
      try {
        flagPixels = await rasteriseFlag(ssW, ssH)
      } catch {
        return
      }
      if (cancelled) return

      // ── Step 2: bake the front-face text mask + extrusion staircase
      // on the main thread (where the Jost font is available).
      // Both are ImageBitmaps at backing-store resolution and get
      // transferred to the worker as Transferables.
      const textBitmap = bakeText({
        bsW,
        bsH,
        dpr,
        fontSize,
        letterSpacing,
        leftPad,
        textY,
        fillStyle: '#fff',
        startDepth: 0,
        endDepth: 0,
        stepX: 0,
        stepY: 0,
      })
      const extBitmap = bakeText({
        bsW,
        bsH,
        dpr,
        fontSize,
        letterSpacing,
        leftPad,
        textY,
        fillStyle: '#141414',
        startDepth: 1,
        endDepth: extrudeDepth,
        stepX: extrudeStep,
        stepY: extrudeStep,
      })

      // ── Step 3: transfer the visible canvas to the worker and
      // hand over the baked assets.
      const transfer = (
        canvas as HTMLCanvasElement & {
          transferControlToOffscreen?: () => OffscreenCanvas
        }
      ).transferControlToOffscreen
      if (typeof transfer !== 'function') {
        // Old browser fallback — just composite once on main thread
        // using the bitmaps we already have, then bail. Loses the
        // wave animation; keeps the static wordmark visible.
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width = bsW
        canvas.height = bsH
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.drawImage(textBitmap, 0, 0, cssW, cssH)
        ctx.globalCompositeOperation = 'destination-over'
        ctx.drawImage(extBitmap, 0, 0, cssW, cssH)
        return
      }

      let offscreen: OffscreenCanvas
      try {
        offscreen = transfer.call(canvas)
      } catch {
        return
      }
      if (cancelled) return

      try {
        worker = new Worker(new URL('./asap-flag-worker.ts', import.meta.url), { type: 'module' })
      } catch {
        return
      }
      if (cancelled) {
        worker.terminate()
        worker = null
        return
      }

      worker.postMessage(
        {
          type: 'init',
          canvas: offscreen,
          flagPixels,
          textBitmap,
          extBitmap,
          cssW,
          cssH,
          bsW,
          bsH,
          dpr,
          ssW,
          ssH,
          prefersReduced,
        },
        [offscreen, flagPixels.buffer, textBitmap, extBitmap],
      )
    }

    void setup()

    return () => {
      cancelled = true
      if (worker) {
        try {
          worker.postMessage({ type: 'stop' })
        } catch {
          /* worker may be dead */
        }
        worker.terminate()
        worker = null
      }
    }
    // height drives the sizing constants above; re-run if it changes.
  }, [height, fontSize, letterSpacing, extrudeStep, extrudeDepth, leftPad])

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: approxWidth,
        // Wrapper's layout box matches the canvas's full painted size
        // (front face + 3-D staircase below). Previously the wrapper
        // was `height` and the canvas overflowed downward by
        // `maxExtrude` — that got clipped by ancestor `overflow:
        // hidden` (the rounded auth card). Including the extrusion in
        // the wrapper's own layout box guarantees nothing in the
        // ancestor chain clips it. The text itself is still drawn at
        // y = height/2 inside the canvas, so the visual top of the
        // wordmark is unchanged.
        height: canvasHeight,
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Bake helpers — run on the main thread once, transfer to the worker.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Rasterise the Australian flag SVG into a Uint8ClampedArray at the
 * requested resolution. The resulting buffer is the "src" pixel array
 * the wave loop samples from each frame.
 *
 * Uses "cover" sizing so the flag's 2:1 aspect stays recognisable even
 * if the destination canvas is closer to square. The blue base fill
 * guarantees opaque coverage when the SVG strokes leave gaps.
 */
function rasteriseFlag(ssW: number, ssH: number): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = ssW
      c.height = ssH
      const ctx = c.getContext('2d')
      if (!ctx) {
        reject(new Error('No 2d context'))
        return
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = '#012169'
      ctx.fillRect(0, 0, ssW, ssH)

      const FLAG_ASPECT = 2
      const canvasAspect = ssW / ssH
      let drawW: number, drawH: number, drawX: number, drawY: number
      if (canvasAspect > FLAG_ASPECT) {
        drawW = ssW
        drawH = ssW / FLAG_ASPECT
        drawX = 0
        drawY = (ssH - drawH) / 2
      } else {
        drawH = ssH
        drawW = ssH * FLAG_ASPECT
        drawX = (ssW - drawW) / 2
        drawY = 0
      }
      ctx.drawImage(img, drawX, drawY, drawW, drawH)

      const data = ctx.getImageData(0, 0, ssW, ssH).data
      resolve(data)
    }
    img.onerror = () => reject(new Error('Flag SVG image failed to load'))
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(AUSTRALIAN_FLAG_SVG)))}`
  })
}

interface BakeTextParams {
  bsW: number // backing-store width
  bsH: number // backing-store height
  dpr: number
  fontSize: number
  letterSpacing: number
  leftPad: number
  textY: number
  fillStyle: string
  /** First slice index (inclusive). 0 = front face; 1+ = extrusion. */
  startDepth: number
  /** Last slice index (inclusive). 0 = single (front face) draw. */
  endDepth: number
  stepX: number // x offset per extrusion slice
  stepY: number // y offset per extrusion slice
}

/**
 * Bake "ASAP" text at the given style + slice range into an
 * ImageBitmap sized to the canvas's backing-store dimensions.
 *
 * - Used twice: once for the front-face mask (single draw, white) and
 *   once for the extrusion staircase (multiple offset draws, #141414).
 * - Returns an ImageBitmap so the worker can drawImage it directly
 *   without re-rasterising the font (which it can't easily access).
 * - Detaches the source canvas — that's fine because we only need the
 *   ImageBitmap to transfer.
 */
function bakeText(p: BakeTextParams): ImageBitmap {
  const off = new OffscreenCanvas(p.bsW, p.bsH)
  const ctx = off.getContext('2d')!
  ctx.scale(p.dpr, p.dpr)
  ctx.font = `700 italic ${p.fontSize}px "Jost Variable", "Jost", system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  // Modern Canvas letter-spacing — supported in Chromium 99+, Firefox
  // 112+, Safari 18+. We run inside Electron Chromium so it's always
  // present; the (ctx as any) cast is just to satisfy older lib.dom.d.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- letterSpacing is Canvas2D level 2 API, not in all lib.dom.d.ts versions
  ;(ctx as any).letterSpacing = `${p.letterSpacing}px`
  ctx.fillStyle = p.fillStyle
  if (p.startDepth === 0 && p.endDepth === 0) {
    // Front-face: single draw at the resting position.
    ctx.fillText('ASAP', p.leftPad, p.textY)
  } else {
    // Extrusion: stack of offset draws, each one further down+right.
    for (let d = p.startDepth; d <= p.endDepth; d++) {
      ctx.fillText('ASAP', p.leftPad + d * p.stepX, p.textY + d * p.stepY)
    }
  }
  return off.transferToImageBitmap()
}
