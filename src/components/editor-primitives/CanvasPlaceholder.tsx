/**
 * CanvasPlaceholder — shown inside the canvas wrapper when there is no content
 * to display (no layers, or no active decal image).
 *
 * Visual recipe (dark-mode):
 *   - Dark surface background (#1a1c22 — one step lighter than the editor
 *     base #0a0b0e so the canvas frame reads as a distinct working area).
 *   - Dashed inset border (2px dashed rgba(255,255,255,0.12)) that outlines
 *     the exact canvas dimensions against the dark base.
 *   - A small center dot at 50%/50%.
 *   - Four diagonal arrows (SVG) from the center dot toward each corner.
 *   - Dimension label horizontally centered at the top.
 *
 * Sits inside the canvas wrapper with `position: absolute; inset: 0` and
 * `pointer-events: none` so it never intercepts clicks for paint or select
 * tools. Layers/content render on top via the normal stacking order.
 */

import type { CSSProperties } from 'react'

interface Props {
  /** Logical canvas width in pixels (for the dimension label). */
  width: number
  /** Logical canvas height in pixels (for the dimension label). */
  height: number
  /** Optional override label — defaults to `"{width} × {height} px"`. */
  label?: string
}

export default function CanvasPlaceholder({ width, height, label }: Props) {
  const dimensionLabel = label ?? `${width} \u00d7 ${height} px`

  const containerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    // Transparent — the canvas div behind already carries the dark checker
    // background (#141620 / #1c1f2d), so the placeholder just overlays its
    // arrows without doubling the background fill.
    // No border: the red OOB tint and drop shadow define the surface edge.
    background: 'transparent',
    borderRadius: 'inherit',
    pointerEvents: 'none',
    zIndex: 0,
  }

  const labelStyle: CSSProperties = {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    font: "11px/1 'Geist Mono Variable', ui-monospace, monospace",
    fontVariantNumeric: 'slashed-zero',
    color: 'rgba(245,245,245,0.50)',
    letterSpacing: '0.04em',
    userSelect: 'none',
    padding: '2px 6px',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  }

  // Tiny caption below the dimension label — clarifies that the placeholder
  // is editor-only scaffolding and never reaches the in-game export. The
  // export pipeline (composeFaceplateCanvas + decal-pack-export) builds a
  // fresh offscreen canvas from the project's logical layer list, so empty
  // pixels stay alpha=0 (truly transparent in-game).
  const captionStyle: CSSProperties = {
    position: 'absolute',
    top: 28,
    left: '50%',
    transform: 'translateX(-50%)',
    font: "10px/1 'Geist Mono Variable', ui-monospace, monospace",
    fontVariantNumeric: 'slashed-zero',
    color: 'rgba(245,245,245,0.35)',
    letterSpacing: '0.02em',
    userSelect: 'none',
    padding: '2px 6px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 4,
    whiteSpace: 'nowrap',
    fontStyle: 'italic',
  }

  const dotStyle: CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'rgba(245,245,245,0.35)',
  }

  // Arrow geometry constants (in SVG-user-units / px at 1:1 scale).
  // The center of the viewBox is (cx, cy). Each arrow starts GAP px out from
  // center along the diagonal and ends MARGIN px short of the respective corner.
  const cx = width / 2
  const cy = height / 2

  // Distance from center to each corner along the diagonal.
  const diagTL = Math.sqrt(cx * cx + cy * cy)
  const diagTR = Math.sqrt((width - cx) * (width - cx) + cy * cy)
  const diagBL = Math.sqrt(cx * cx + (height - cy) * (height - cy))
  const diagBR = Math.sqrt((width - cx) * (width - cx) + (height - cy) * (height - cy))

  // Unit vectors from center toward each corner.
  const uvTL = { x: -cx / diagTL, y: -cy / diagTL }
  const uvTR = { x: (width - cx) / diagTR, y: -cy / diagTR }
  const uvBL = { x: -cx / diagBL, y: (height - cy) / diagBL }
  const uvBR = { x: (width - cx) / diagBR, y: (height - cy) / diagBR }

  const GAP = 12 // px from center dot to arrow start
  const MARGIN = 16 // px short of corner where arrow ends

  function arrowLine(uv: { x: number; y: number }, totalDist: number) {
    const x1 = cx + uv.x * GAP
    const y1 = cy + uv.y * GAP
    const x2 = cx + uv.x * (totalDist - MARGIN)
    const y2 = cy + uv.y * (totalDist - MARGIN)
    return { x1, y1, x2, y2 }
  }

  const lines = [
    arrowLine(uvTL, diagTL),
    arrowLine(uvTR, diagTR),
    arrowLine(uvBL, diagBL),
    arrowLine(uvBR, diagBR),
  ]

  return (
    <div style={containerStyle} aria-hidden data-testid="canvas-placeholder">
      {/* SVG overlay: four diagonal arrows */}
      <svg
        style={{ position: 'absolute', inset: 0 }}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="5"
            refY="5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            {/* Open chevron: two lines forming a ">" — angled ~30° off the shaft */}
            <polyline
              points="1,1 5,5 1,9"
              fill="none"
              stroke="rgba(245,245,245,0.35)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </marker>
        </defs>
        {lines.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="rgba(245,245,245,0.35)"
            strokeWidth="1.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            markerEnd="url(#arrowhead)"
          />
        ))}
      </svg>

      {/* Center dot */}
      <div style={dotStyle} data-testid="canvas-placeholder-dot" />

      {/* Dimension label — centered at top */}
      <span style={labelStyle}>{dimensionLabel}</span>

      {/* Trust caption — clarifies this placeholder is editor scaffolding only */}
      <span style={captionStyle} data-testid="canvas-placeholder-caption">
        Editor guide — not exported
      </span>
    </div>
  )
}
