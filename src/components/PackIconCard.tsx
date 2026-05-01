import { useEffect, useRef } from 'react'
import type { Palette } from '@/lib/project'

interface Props {
  packName: string
  diffuseCanvas: HTMLCanvasElement | null
  palette: Palette
}

/** CoH2-style inventory icon card, top-right of the viewport. Mirrors the
 *  in-game customization-panel thumbnail: 64×64 camo swatch + small unit
 *  shield in the lower-right corner. Updates live as the diffuse changes. */
export default function PackIconCard({ packName, diffuseCanvas, palette }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, 64, 64)
    if (diffuseCanvas) {
      // Sample a clean side-hull region from the 2048² diffuse — a position
      // that reliably lands on camo (no decals, no UV seams) for the CoH2
      // German vehicle layout. Falls back to the centre if the diffuse is
      // smaller than expected.
      const W = diffuseCanvas.width, H = diffuseCanvas.height
      const sx = Math.min(W - 380, Math.round(W * 0.55))
      const sy = Math.min(H - 380, Math.round(H * 0.7))
      ctx.drawImage(diffuseCanvas, sx, sy, 380, 380, 0, 0, 64, 64)
    } else {
      ctx.fillStyle = '#3a2f20'
      ctx.fillRect(0, 0, 64, 64)
    }
    // Vignette
    const grad = ctx.createLinearGradient(0, 0, 0, 64)
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.35)')
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64)
    // Brigade tricolour shield in lower-right
    drawShield(ctx, 50, 47, 18, palette)
  }, [diffuseCanvas, palette])

  return (
    <div className="absolute top-4 right-4 z-10 glass-2 rounded-xl px-2.5 py-2 flex items-center gap-2.5 shadow-[var(--shadow-glass)]"
         title={packName}>
      <canvas ref={canvasRef} width={64} height={64}
              className="block w-12 h-12 rounded-md border border-white/10" />
      <div className="min-w-0 max-w-[180px] leading-tight pr-1">
        <div className="text-[8px] uppercase tracking-[1.5px] text-[var(--color-text-3)] font-semibold">
          In-game preview
        </div>
        <div className="text-[12px] text-white font-semibold truncate">{packName}</div>
      </div>
    </div>
  )
}

function drawShield(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, palette: Palette) {
  const w = size, h = size * 1.2
  ctx.save()
  ctx.translate(cx, cy)
  // Dark frame for legibility on camo
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.moveTo(-w/2 - 1, -h/2 - 1); ctx.lineTo(w/2 + 1, -h/2 - 1)
  ctx.lineTo(w/2 + 1, h/2 - w*0.45)
  ctx.bezierCurveTo(w/2 + 1, h/2 + 1, -w/2 - 1, h/2 + 1, -w/2 - 1, h/2 - w*0.45)
  ctx.closePath(); ctx.fill()
  // Heater shape clip
  ctx.beginPath()
  ctx.moveTo(-w/2, -h/2); ctx.lineTo(w/2, -h/2)
  ctx.lineTo(w/2, h/2 - w*0.45)
  ctx.bezierCurveTo(w/2, h/2, -w/2, h/2, -w/2, h/2 - w*0.45)
  ctx.closePath(); ctx.clip()
  ctx.fillStyle = palette.orange; ctx.fillRect(-w/2, -h/2,            w, h * 0.34)
  ctx.fillStyle = palette.white;  ctx.fillRect(-w/2, -h/2 + h * 0.34, w, h * 0.33)
  ctx.fillStyle = palette.blue;   ctx.fillRect(-w/2, -h/2 + h * 0.67, w, h * 0.34)
  ctx.restore()
}
