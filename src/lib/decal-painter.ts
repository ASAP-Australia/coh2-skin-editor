/**
 * Canvas2D decal renderer. Takes a list of decals + a context (palette,
 * vehicle defaults) and paints them onto a 2048² canvas.
 *
 * Each decal type has a dedicated drawer. All drawers respect the per-decal
 * rotation (around the decal's centre) and size; positions are in PSD-
 * orientation pixel coords (Y down from the top), exactly matching what
 * `decal_anchors.json` stores.
 */

import type { CustomImage, Decal, DecalType, Palette } from './project'

export interface RenderContext {
  ctx: CanvasRenderingContext2D
  palette: Palette
  /** Vehicle's default 3-digit tactical number, used when a decal's text
   *  override is null. */
  defaultTac: string
  /** Vehicle name for `name` decals. */
  vehicleName: string
  /** Current tac (project override or vehicle default). */
  tac: string
  /** Custom image library — keyed by id. */
  images: Record<string, CustomImage>
}

/** Decoded HTMLImageElement cache, keyed by image id. We hand out the
 *  cached element synchronously when available; first call kicks off
 *  decode and triggers `onReady` once it lands so the caller can repaint. */
const imageCache = new Map<string, HTMLImageElement>()
const imageDecoding = new Set<string>()

export function getCachedImage(img: CustomImage, onReady: () => void): HTMLImageElement | null {
  const cached = imageCache.get(img.id)
  if (cached?.complete) return cached
  if (imageDecoding.has(img.id)) return null
  imageDecoding.add(img.id)
  const el = new Image()
  el.onload = () => { imageCache.set(img.id, el); imageDecoding.delete(img.id); onReady() }
  el.onerror = () => { imageDecoding.delete(img.id) }
  el.src = img.dataUrl
  return null
}

export function paintDecals(rc: RenderContext, decals: Decal[], activeId: number | null) {
  for (const d of decals) {
    rc.ctx.save()
    rc.ctx.translate(d.x, d.y)
    rc.ctx.rotate(d.rot * Math.PI / 180)
    drawByType(rc, d)
    if (d.id === activeId) {
      rc.ctx.strokeStyle = '#ff6600'
      rc.ctx.lineWidth = 2
      const r = Math.max(20, d.size * 0.7)
      rc.ctx.beginPath(); rc.ctx.arc(0, 0, r, 0, Math.PI * 2); rc.ctx.stroke()
    }
    rc.ctx.restore()
  }
}

function drawByType(rc: RenderContext, d: Decal): void {
  switch (d.type) {
    case 'shield':  drawShield(rc, d.size); return
    case 'number':  drawNumber(rc, d, d.text ?? rc.tac); return
    case 'name':    drawName(rc, d, d.text ?? rc.vehicleName); return
    case 'kills':   drawKills(rc, d, d.kills ?? 8); return
    case 'cross':   drawBalkenkreuz(rc, d.size); return
    case 'image':   drawImage(rc, d); return
  }
}

/** Custom image decal — base64-decoded from project.images, painted with
 *  rotation, size, and per-decal opacity. */
function drawImage(rc: RenderContext, d: Decal) {
  if (!d.imageId) return
  const meta = rc.images[d.imageId]
  if (!meta) return
  const el = getCachedImage(meta, () => {/* repaint hook is handled by caller */})
  if (!el) {
    // Placeholder while image decodes
    rc.ctx.fillStyle = 'rgba(255,102,0,0.2)'
    rc.ctx.fillRect(-d.size/2, -d.size/2, d.size, d.size)
    rc.ctx.strokeStyle = '#ff6600'
    rc.ctx.lineWidth = 2
    rc.ctx.strokeRect(-d.size/2, -d.size/2, d.size, d.size)
    return
  }
  // Aspect-preserve: longest edge = d.size
  const ar = meta.width / meta.height
  const w = ar >= 1 ? d.size : d.size * ar
  const h = ar >= 1 ? d.size / ar : d.size
  const op = d.opacity ?? 1
  rc.ctx.globalAlpha *= op
  rc.ctx.drawImage(el, -w/2, -h/2, w, h)
  rc.ctx.globalAlpha /= op
}

/** Procedural Brigade tricolour shield — heater shape, three bands. */
function drawShield(rc: RenderContext, size: number) {
  const ctx = rc.ctx
  const w = size, h = size * 1.2
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(-w/2, -h/2)
  ctx.lineTo( w/2, -h/2)
  ctx.lineTo( w/2,  h/2 - w*0.45)
  ctx.bezierCurveTo(w/2, h/2, -w/2, h/2, -w/2, h/2 - w*0.45)
  ctx.closePath()
  ctx.clip()
  ctx.fillStyle = rc.palette.orange; ctx.fillRect(-w/2, -h/2,            w, h * 0.34)
  ctx.fillStyle = rc.palette.white;  ctx.fillRect(-w/2, -h/2 + h * 0.34, w, h * 0.33)
  ctx.fillStyle = rc.palette.blue;   ctx.fillRect(-w/2, -h/2 + h * 0.67, w, h * 0.34)
  ctx.restore()
}

/** Wehrmacht-style bortnummer: thick white outline + coloured fill. */
function drawNumber(rc: RenderContext, d: Decal, text: string) {
  const ctx = rc.ctx
  ctx.font = `bold ${d.size}px sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.lineWidth = d.size * 0.18
  ctx.lineJoin = 'round'
  ctx.strokeStyle = rc.palette.white
  ctx.strokeText(text, 0, 0)
  ctx.fillStyle = rc.palette.orange
  ctx.fillText(text, 0, 0)
}

/** Italic serif vehicle name with a soft dark outline. */
function drawName(rc: RenderContext, d: Decal, text: string) {
  if (!text) return
  const ctx = rc.ctx
  ctx.font = `bold italic ${d.size}px serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(2, d.size * 0.06)
  ctx.strokeStyle = '#3a2f20'
  ctx.strokeText(text, 0, 0)
  ctx.fillStyle = rc.palette.white
  ctx.fillText(text, 0, 0)
}

/** Kill rings — N white horizontal stripes stacked vertically. When applied
 *  to a barrel UV (which is rotated in CoH2 packing), each stripe wraps
 *  around the barrel circumference as one ring. */
function drawKills(rc: RenderContext, d: Decal, n: number) {
  const ctx = rc.ctx
  const w = d.size
  const ringH = Math.max(3, Math.round(d.size * 0.06))
  const gapH = ringH
  const total = n * (ringH + gapH)
  ctx.fillStyle = rc.palette.white
  for (let i = 0; i < n; i++) {
    const y = -total / 2 + i * (ringH + gapH)
    ctx.fillRect(-w / 2, y, w, ringH)
  }
}

/** Balkenkreuz (German cross) — black core with a hairline white outline. */
function drawBalkenkreuz(rc: RenderContext, size: number) {
  const ctx = rc.ctx
  const arm = size * 0.32
  const len = size * 0.5
  // White outline (rendered as the underlying larger cross)
  ctx.fillStyle = '#e5deca'
  ctx.fillRect(-len, -arm, len * 2, arm * 2)
  ctx.fillRect(-arm, -len, arm * 2, len * 2)
  // Black inner cross
  const armI = arm * 0.6, lenI = len * 0.85
  ctx.fillStyle = '#0d0d0d'
  ctx.fillRect(-lenI, -armI, lenI * 2, armI * 2)
  ctx.fillRect(-armI, -lenI, armI * 2, lenI * 2)
}

/** Default per-decal-type size used when a decal is first placed. */
export function defaultSize(type: DecalType): number {
  switch (type) {
    case 'shield': return 110
    case 'number': return 110
    case 'name':   return 56
    case 'kills':  return 200
    case 'cross':  return 100
    case 'image':  return 200
  }
}
