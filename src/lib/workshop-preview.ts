/**
 * workshop-preview.ts — Generate a high-quality 1024×1024 Workshop preview
 * from a source canvas (any size).
 *
 * Steam renders Workshop item preview images at ~512×512 on the item page.
 * Sending a tiny source (e.g. the 64×64 decal icon) causes Steam to upscale
 * the image and the result is heavily blurred. This module renders the source
 * canvas into a 1024×1024 OffscreenCanvas with high-quality smoothing so
 * Steam's own display step is a clean 2x downsample rather than a 16x upscale.
 *
 * Step-down rendering: when the source dimension is very small (≤256 px),
 * we composite via an intermediate 512-step to improve smoothing quality
 * compared to a single 8–16x stretch (Chromium uses bilinear for
 * `imageSmoothingQuality = 'high'`; stepping down reduces artifacts).
 *
 * The output canvas has a fully transparent background — no gradient, no text.
 * Only the decal/faceplate/skin-pack art is composited, centered with ~10 %
 * padding.
 *
 * Bbox-crop: before center-fitting, the source is cropped to its opaque-pixel
 * bounding box so that transparent margins from rasteriseDecal (which places
 * art in in-game geometry space) do not cause a second round of padding on top
 * of the ~10 % center-fit padding.
 */

const PREVIEW_SIZE = 1024

// ── Alpha threshold for "opaque enough to count as content" ───────────────────
const ALPHA_THRESHOLD = 8

/**
 * Opaque-pixel bounding box for a canvas.
 *
 * Scans the ImageData of `canvas` and returns {x, y, w, h} — the tightest
 * rectangle that contains every pixel whose alpha channel exceeds
 * `ALPHA_THRESHOLD`. Returns `null` when the canvas is fully transparent or
 * when the bounding box would be the same as the full canvas (no crop needed).
 *
 * Exported so it can be unit-tested without a DOM.
 */
export function findOpaqueBbox(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): { x: number; y: number; w: number; h: number } | null {
  const w = canvas.width
  const h = canvas.height

  // Obtain ImageData — works for both HTMLCanvasElement and OffscreenCanvas.
  let data: Uint8ClampedArray
  if (canvas instanceof HTMLCanvasElement) {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return null
    data = ctx.getImageData(0, 0, w, h).data
  } else {
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null
    if (!ctx) return null
    data = ctx.getImageData(0, 0, w, h).data
  }

  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3]
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // Fully transparent — nothing to crop to.
  if (maxX < 0) return null

  const bw = maxX - minX + 1
  const bh = maxY - minY + 1

  // Bounding box is already the full canvas — no crop needed.
  if (minX === 0 && minY === 0 && bw === w && bh === h) return null

  return { x: minX, y: minY, w: bw, h: bh }
}

/**
 * Crop a canvas to its opaque-pixel bounding box.
 *
 * Returns a new canvas (OffscreenCanvas when available, HTMLCanvasElement
 * otherwise) containing only the content region. If the canvas is fully
 * transparent or fills the entire area, the original canvas is returned
 * unchanged (no unnecessary allocation).
 */
export function cropToOpaqueBbox(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): HTMLCanvasElement | OffscreenCanvas {
  const bbox = findOpaqueBbox(canvas)
  if (!bbox) return canvas // degenerate — skip crop

  // Use OffscreenCanvas when available (browser / Electron); fall back to
  // HTMLCanvasElement so this function works in jsdom tests.
  let cropped: HTMLCanvasElement | OffscreenCanvas
  if (typeof OffscreenCanvas !== 'undefined') {
    cropped = new OffscreenCanvas(bbox.w, bbox.h)
  } else {
    const el = document.createElement('canvas')
    el.width = bbox.w
    el.height = bbox.h
    cropped = el
  }

  const ctx = cropped.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) return canvas // fallback — skip crop if context fails

  ctx.drawImage(canvas as CanvasImageSource, -bbox.x, -bbox.y)
  return cropped
}

/**
 * Generate a 1024×1024 Workshop preview PNG from a source canvas.
 *
 * The source is first cropped to its opaque-pixel bounding box (removing
 * transparent margins from rasteriseDecal placement geometry), then
 * center-fitted with ~10 % padding on a transparent background.
 * Returns PNG bytes as a Uint8Array.
 *
 * @param sourceCanvas - Any HTMLCanvasElement (any size, any aspect ratio).
 */
export async function generateWorkshopPreview(
  sourceCanvas: HTMLCanvasElement,
): Promise<Uint8Array> {
  const preview = new OffscreenCanvas(PREVIEW_SIZE, PREVIEW_SIZE)
  const ctx = preview.getContext('2d')
  if (!ctx) throw new Error('Could not get 2d context for OffscreenCanvas')

  // Background is fully transparent — nothing to draw here.

  // ── Crop to opaque-pixel bounding box ────────────────────────────────────
  // rasteriseDecal places art in in-game geometry space, leaving large
  // transparent margins. Without this crop, those margins stack with the
  // ~10 % center-fit padding below and make the art appear tiny.
  const croppedSource = cropToOpaqueBbox(sourceCanvas)

  // ── Compute centered-fit destination rect with ~10 % padding ──────────────
  const PAD = PREVIEW_SIZE * 0.10           // 102.4 px
  const maxW = PREVIEW_SIZE - PAD * 2
  const maxH = PREVIEW_SIZE - PAD * 2

  const srcW = croppedSource.width
  const srcH = croppedSource.height

  const scale = Math.min(maxW / srcW, maxH / srcH)
  const dstW = Math.round(srcW * scale)
  const dstH = Math.round(srcH * scale)
  const dstX = Math.round((PREVIEW_SIZE - dstW) / 2)
  const dstY = Math.round((PREVIEW_SIZE - dstH) / 2)

  // ── Rendering strategy based on source size ──────────────────────────────
  // • ≥1024 px: source is already full-resolution — draw directly, single pass.
  // • ≤256 px: step through an intermediate 512-px canvas to reduce bilinear
  //   artifacts compared to a single 8–16× jump (legacy / fallback path).
  // • Otherwise: draw directly with smoothing enabled.
  const largerDim = Math.max(srcW, srcH)
  let drawSource: HTMLCanvasElement | OffscreenCanvas = croppedSource

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
      midCtx.drawImage(croppedSource as CanvasImageSource, mX, mY, mW, mH)
      drawSource = midCanvas
    }
  }
  // For largerDim >= PREVIEW_SIZE: drawSource stays as croppedSource and is
  // composited directly — single draw, no bilinear stretch needed.

  // ── Draw source into preview canvas ───────────────────────────────────────
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(drawSource as CanvasImageSource, dstX, dstY, dstW, dstH)

  // ── Encode to PNG ─────────────────────────────────────────────────────────
  const blob = await preview.convertToBlob({ type: 'image/png' })
  const arrayBuf = await blob.arrayBuffer()
  return new Uint8Array(arrayBuf)
}
