/**
 * workshop-preview.ts — Generate a high-quality 1024×1024 Workshop preview
 * from a source canvas (any size).
 *
 * Steam renders Workshop item preview images at ~512×512 on the item page.
 * Sending a tiny source (e.g. the 64×64 decal icon) causes Steam to upscale
 * the image and the result is heavily blurred. This module renders the source
 * canvas into a 1024×1024 OffscreenCanvas with high-quality smoothing and
 * a dark gradient background so Steam's own display step is a clean 2x
 * downsample rather than a 16x upscale.
 *
 * Step-down rendering: when the source dimension is very small (≤256 px),
 * we composite via an intermediate 512-step to improve smoothing quality
 * compared to a single 8–16x stretch (Chromium uses bilinear for
 * `imageSmoothingQuality = 'high'`; stepping down reduces artifacts).
 */

const PREVIEW_SIZE = 1024

/**
 * Generate a 1024×1024 Workshop preview PNG from a source canvas.
 *
 * The source is center-fitted with ~10 % padding on a dark radial-gradient
 * background. Returns PNG bytes as a Uint8Array.
 *
 * @param sourceCanvas - Any HTMLCanvasElement (any size, any aspect ratio).
 * @param packName     - Optional pack name rendered as a subtle watermark
 *                       when the source canvas is very small (≤64 px) so
 *                       the preview carries some text identity.
 */
export async function generateWorkshopPreview(
  sourceCanvas: HTMLCanvasElement,
  packName?: string,
): Promise<Uint8Array> {
  const preview = new OffscreenCanvas(PREVIEW_SIZE, PREVIEW_SIZE)
  const ctx = preview.getContext('2d')
  if (!ctx) throw new Error('Could not get 2d context for OffscreenCanvas')

  // ── Background: dark radial gradient ──────────────────────────────────────
  const grad = ctx.createRadialGradient(
    PREVIEW_SIZE / 2, PREVIEW_SIZE / 2, 0,
    PREVIEW_SIZE / 2, PREVIEW_SIZE / 2, PREVIEW_SIZE * 0.72,
  )
  grad.addColorStop(0, '#1a1c22')
  grad.addColorStop(1, '#0a0b0e')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)

  // ── Compute centered-fit destination rect with ~10 % padding ──────────────
  const PAD = PREVIEW_SIZE * 0.10           // 102.4 px
  const maxW = PREVIEW_SIZE - PAD * 2
  const maxH = PREVIEW_SIZE - PAD * 2

  const srcW = sourceCanvas.width
  const srcH = sourceCanvas.height

  const scale = Math.min(maxW / srcW, maxH / srcH)
  const dstW = Math.round(srcW * scale)
  const dstH = Math.round(srcH * scale)
  const dstX = Math.round((PREVIEW_SIZE - dstW) / 2)
  const dstY = Math.round((PREVIEW_SIZE - dstH) / 2)

  // ── Rendering strategy based on source size ──────────────────────────────
  // • ≥1024 px: source is already full-resolution — draw directly, single pass,
  //   no bilinear stretch (scale ≈ 1×). This is the fast path for properly
  //   prepared preview canvases (e.g. the 1024×1024 decal preview canvas).
  // • ≤256 px: step through an intermediate 512-px canvas to reduce bilinear
  //   artifacts compared to a single 8–16× jump (legacy / fallback path).
  // • Otherwise: draw directly with smoothing enabled.
  const largerDim = Math.max(srcW, srcH)
  let drawSource: HTMLCanvasElement | OffscreenCanvas = sourceCanvas

  if (largerDim < PREVIEW_SIZE && largerDim <= 256) {
    const midSize = Math.min(512, Math.max(largerDim * 4, 256))
    const midCanvas = new OffscreenCanvas(midSize, midSize)
    const midCtx = midCanvas.getContext('2d')
    if (midCtx) {
      midCtx.imageSmoothingEnabled = true
      midCtx.imageSmoothingQuality = 'high'
      // Center-fit the source into the intermediate canvas
      const mScale = Math.min(midSize / srcW, midSize / srcH)
      const mW = Math.round(srcW * mScale)
      const mH = Math.round(srcH * mScale)
      const mX = Math.round((midSize - mW) / 2)
      const mY = Math.round((midSize - mH) / 2)
      midCtx.drawImage(sourceCanvas, mX, mY, mW, mH)
      drawSource = midCanvas
    }
  }
  // For largerDim >= PREVIEW_SIZE: drawSource stays as sourceCanvas and is
  // composited directly — single draw, no bilinear stretch needed.

  // ── Draw source into preview canvas ───────────────────────────────────────
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(drawSource, dstX, dstY, dstW, dstH)

  // ── Optional: pack-name watermark for tiny-icon sources ───────────────────
  if (packName && largerDim <= 64) {
    const fontSize = Math.round(PREVIEW_SIZE * 0.028)   // ~29 px
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    // Slight drop-shadow
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 8
    ctx.fillStyle = 'rgba(247,247,250,0.55)'
    ctx.fillText(packName, PREVIEW_SIZE / 2, PREVIEW_SIZE - PAD * 0.6, maxW)
    ctx.shadowBlur = 0
  }

  // ── Encode to PNG ─────────────────────────────────────────────────────────
  const blob = await preview.convertToBlob({ type: 'image/png' })
  const arrayBuf = await blob.arrayBuffer()
  return new Uint8Array(arrayBuf)
}
