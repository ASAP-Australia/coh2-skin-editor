/**
 * Canvas2D decal renderer. Takes a list of decals + a context (palette,
 * vehicle defaults) and paints them onto a 2048² canvas.
 *
 * Each decal type has a dedicated drawer. All drawers respect the per-decal
 * rotation (around the decal's centre) and size; positions are in PSD-
 * orientation pixel coords (Y down from the top), exactly matching what
 * `decal_anchors.json` stores.
 */

import type { Decal, DecalType, Palette } from './project'

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

function drawByType(rc: RenderContext, d: Decal) {
  switch (d.type) {
    case 'shield':  return drawShield(rc, d.size)
    case 'number':  return drawNumber(rc, d, d.text ?? rc.tac)
    case 'name':    return drawName(rc, d, d.text ?? rc.vehicleName)
    case 'kills':   return drawKills(rc, d, d.kills ?? 8)
    case 'cross':   return drawBalkenkreuz(rc, d.size)
  }
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
  }
}
