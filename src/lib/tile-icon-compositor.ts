/**
 * Tile-icon compositor.
 *
 * Renders a 256² PNG that mimics CoH2's in-game customization grid:
 *   - Camo texture as the full background
 *   - Vehicle silhouette icon in the top-left
 *   - Main decal in the top-right
 *
 * The three input layers are intentionally untyped sources
 * (CanvasImageSource | data URL | null) so callers can hand in
 * whatever they have — an already-loaded HTMLImageElement, a
 * CamoPreset rendered onto a small canvas, or just a stored
 * `customDiffuseUrl` data URL. Anything that's a string is decoded
 * via Image(); anything else passes straight to `drawImage`.
 *
 * Output is a `data:image/png` URL ready to drop into `<img src>`,
 * persist on the project, or upload elsewhere. The function never
 * mutates the inputs.
 */

export interface TileIconLayers {
  /** Background camo texture. Stretched to fill the canvas. Null →
   *  fall back to `factionColor`. */
  camo: CanvasImageSource | string | null
  /** Top-left vehicle silhouette. Drawn inside a rounded-square
   *  badge with a faint outline so it reads on busy camo. */
  vehicleIcon: CanvasImageSource | string | null
  /** Top-right main decal. Same badge treatment as the vehicle
   *  icon. Null → the top-right is left empty. */
  decal: CanvasImageSource | string | null
  /** Solid background used when `camo` is null. Defaults to a
   *  neutral dark grey. */
  factionColor?: string
}

/** Composite layers into a single 256² PNG data URL.
 *
 *  @param layers  see `TileIconLayers`
 *  @param size    override the output edge length (default 256). The
 *                 badge placement scales with the canvas, so smaller
 *                 sizes still look proportioned. */
export async function composeTileIcon(layers: TileIconLayers, size = 256): Promise<string> {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('composeTileIcon: 2D context unavailable')

  // 1. Background.
  const camo = await asImage(layers.camo)
  if (camo) {
    ctx.drawImage(camo, 0, 0, size, size)
  } else {
    ctx.fillStyle = layers.factionColor ?? '#3a3a3a'
    ctx.fillRect(0, 0, size, size)
  }

  // 2. Top fade — gives the foreground badges a darker zone to sit on
  //    so light icons don't get lost over a bright camo. Limited to
  //    the top half so the camo dominates the visual identity.
  const grad = ctx.createLinearGradient(0, 0, 0, size * 0.5)
  grad.addColorStop(0, 'rgba(0,0,0,0.35)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size * 0.5)

  // 3. Foreground badges. Both are 36% of the canvas edge, inset 5%
  //    from the top/left and top/right respectively. The same metrics
  //    are mirrored — if you change one, change both for symmetry.
  const badgeSize = Math.round(size * 0.36)
  const pad = Math.round(size * 0.05)

  const veh = await asImage(layers.vehicleIcon)
  if (veh) {
    drawBadge(ctx, veh, pad, pad, badgeSize)
  }

  const dec = await asImage(layers.decal)
  if (dec) {
    drawBadge(ctx, dec, size - pad - badgeSize, pad, badgeSize)
  }

  return c.toDataURL('image/png')
}

// ─────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────

/** Draw `img` into a rounded-square badge at (x, y) with edge `s`.
 *
 *  We render in two passes:
 *    1. Clip to the rounded shape, fill a dark wash, draw the image.
 *    2. Stroke a 1px hairline outline at 18% alpha so the badge has
 *       a visible boundary even when its centre matches the camo.
 *
 *  The save/restore guards isolate the clip from the calling context
 *  so subsequent draws don't inherit it. */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  s: number,
): void {
  const r = s * 0.15

  // Pass 1: clipped fill + image
  ctx.save()
  ctx.beginPath()
  roundRect(ctx, x, y, s, s, r)
  ctx.clip()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(x, y, s, s)
  ctx.drawImage(img, x, y, s, s)
  ctx.restore()

  // Pass 2: hairline outline
  ctx.save()
  ctx.beginPath()
  roundRect(ctx, x + 0.5, y + 0.5, s - 1, s - 1, r)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

/** Polyfill-free rounded-rect path. The four arcTo segments anchor on
 *  the corners; the moveTo seeds the path inside the top edge. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Normalise an input layer to something `drawImage` can consume.
 *  Strings are treated as URLs (typically data URLs from the project
 *  cache); everything else passes through. */
async function asImage(src: CanvasImageSource | string | null): Promise<CanvasImageSource | null> {
  if (src == null) return null
  if (typeof src === 'string') return await loadUrl(src)
  return src
}

function loadUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () =>
      rej(new Error(`tile compositor: failed to load image (${src.slice(0, 64)}…)`))
    img.src = src
  })
}
