/**
 * Generic layer compositor — extracted from composeFaceplateCanvas.
 *
 * Renders a list of layers that satisfy BaseLayer into a canvasW × canvasH
 * HTMLCanvasElement.  The per-layer-kind rendering is delegated to the
 * host-supplied `renderLayer` callback so this module carries no
 * faceplate-specific knowledge.
 *
 * Byte-identical with composeFaceplateCanvas when called with
 *   canvasW = FACEPLATE_BANNER_W (624)
 *   canvasH = FACEPLATE_BANNER_H (204)
 * on a Coh2FaceplateProject and the faceplate renderLayer.
 * Proven by the compose-canvas-golden test.
 */

import type { BaseLayer } from './layer-model'

/**
 * Compose a stack of layers into a fresh HTMLCanvasElement.
 *
 * @param layers        Ordered layer list, bottom-first (first item renders first).
 * @param images        Image library keyed by image-id.
 * @param canvasW       Width of the output canvas in pixels.
 * @param canvasH       Height of the output canvas in pixels.
 * @param backgroundColor  Optional CSS colour string for the canvas background.
 *                         null / undefined = transparent.
 * @param renderLayer   Host-supplied callback that renders one layer's
 *                      kind-specific content.  Called for every VISIBLE layer
 *                      in order.  The callback receives:
 *                        ctx       — the 2D context of the composite canvas
 *                        layer     — the layer descriptor
 *                        byId      — Map<imageId, HTMLImageElement> for already-
 *                                    decoded project images
 *                      The callback must return a Promise<HTMLCanvasElement | null>
 *                      representing a "snapshot canvas" of what it drew (used by
 *                      the compositor for clippedToLayerBelow support), or null
 *                      if no snapshot is needed / applicable.
 *
 * @returns A resolved HTMLCanvasElement with the composited result.
 */
export async function composeLayers<L extends BaseLayer>(
  layers: L[],
  images: Record<string, { id: string; dataUrl: string; name: string }>,
  canvasW: number,
  canvasH: number,
  backgroundColor: string | null | undefined,
  renderLayer: (
    ctx: CanvasRenderingContext2D,
    layer: L,
    byId: Map<string, HTMLImageElement>,
    canvasW: number,
    canvasH: number,
    prevLayerCanvas: HTMLCanvasElement | null,
  ) => Promise<HTMLCanvasElement | null>,
): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas')
  c.width = canvasW
  c.height = canvasH
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  // Background
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, canvasW, canvasH)
  }

  // Decode all project images in parallel so the render loop is synchronous
  // per-layer after this point.
  const imageEls = await Promise.all(
    Object.values(images).map(async img => {
      const el = await new Promise<HTMLImageElement>((res, rej) => {
        const image = new Image()
        image.onload = () => res(image)
        image.onerror = () => rej(new Error(`Image "${img.name}" failed to decode`))
        image.src = img.dataUrl
      })
      // Await decode() so the element is fully decode-ready before any
      // drawImage in the render loop below. Guards against the export-time
      // "InvalidStateError: The source image could not be decoded" race when a
      // drawImage runs before an <img> has finished decoding. decode() may be
      // absent (jsdom/older engines); onload above is a sufficient fallback.
      if (typeof el.decode === 'function') {
        try {
          await el.decode()
        } catch {
          /* already loaded via onload — benign for some SVG/data URLs */
        }
      }
      return { id: img.id, el }
    }),
  )
  const byId = new Map(imageEls.map(it => [it.id, it.el]))

  // Track the previous visible layer's snapshot for clipping-mask support.
  let prevLayerCanvas: HTMLCanvasElement | null = null

  for (const layer of layers) {
    if (!layer.visible) continue

    const snap = await renderLayer(ctx, layer, byId, canvasW, canvasH, prevLayerCanvas)
    prevLayerCanvas = snap
  }

  return c
}
