/**
 * Procedural camo pattern generator.
 *
 * Draws directly onto a 2D canvas (caller owns the canvas; we don't clear it,
 * allowing the caller to compose camo under decals).
 *
 * Usage:
 *   const preset = parsePrompt('german ambush winter')
 *   generateCamo(myCanvas, preset)
 */

export type CamoStyle = 'softBlobs' | 'hardEdge' | 'whitewash' | 'stripes'

export interface CamoPreset {
  style: CamoStyle
  /** Up to 3 colours: [base, secondary, tertiary]. */
  colors: [string, string, string]
  seed: number
  /** 0.5–2.0 — scales feature size relative to canvas. */
  scale: number
  /** Overall rotation in degrees. */
  rotation: number
  /** Blur radius in px (0 = hard edge). */
  blur: number
  label: string
}

// ---------------------------------------------------------------------------
// Keyword → preset mapping
// ---------------------------------------------------------------------------

const COLOR_KEYWORDS: Record<string, string> = {
  'olive':     '#4a5c2a',
  'green':     '#3a5228',
  'dark green': '#2a3e1a',
  'tan':       '#c8a060',
  'sand':      '#c8b878',
  'brown':     '#6a4a28',
  'dark brown': '#3e2a12',
  'grey':      '#8a8a8a',
  'gray':      '#8a8a8a',
  'white':     '#e8e4d8',
  'black':     '#1a1a1a',
  'red':       '#8a2a1a',
  'rust':      '#7a3a1a',
  'yellow':    '#c8a020',
}

const BASE_PRESETS: Record<string, CamoPreset> = {
  'german_summer': {
    label: 'German 3-tone summer',
    style: 'softBlobs',
    colors: ['#4a5c3a', '#8a7230', '#2a3a1a'],
    seed: 1, scale: 1.0, rotation: 0, blur: 18,
  },
  'german_winter': {
    label: 'German whitewash winter',
    style: 'whitewash',
    colors: ['#e8e4d8', '#5a6040', '#3a4a2a'],
    seed: 2, scale: 1.0, rotation: 0, blur: 8,
  },
  'german_ambush': {
    label: 'German ambush',
    style: 'hardEdge',
    colors: ['#3a4a28', '#c8a060', '#1e2e10'],
    seed: 3, scale: 0.9, rotation: 0, blur: 0,
  },
  'soviet_summer': {
    label: 'Soviet summer',
    style: 'softBlobs',
    colors: ['#556b3a', '#2c3c22', '#8a7a44'],
    seed: 4, scale: 1.1, rotation: 0, blur: 16,
  },
  'soviet_winter': {
    label: 'Soviet whitewash',
    style: 'whitewash',
    colors: ['#d8dcd0', '#556b3a', '#2c3c22'],
    seed: 5, scale: 1.0, rotation: 0, blur: 10,
  },
  'american_summer': {
    label: 'Allied olive drab',
    style: 'softBlobs',
    colors: ['#4a5c30', '#3c4e28', '#6a6038'],
    seed: 6, scale: 1.2, rotation: 0, blur: 20,
  },
  'desert_tan': {
    label: 'Desert tan',
    style: 'softBlobs',
    colors: ['#c8aa6a', '#a08040', '#ddc88a'],
    seed: 7, scale: 1.3, rotation: 0, blur: 25,
  },
  'autumn': {
    label: 'Autumn leaves',
    style: 'stripes',
    colors: ['#7a5828', '#4a5c3a', '#c09040'],
    seed: 8, scale: 1.0, rotation: -30, blur: 4,
  },
  'solid_green': {
    label: 'Solid olive green',
    style: 'softBlobs',
    colors: ['#3e5228', '#3e5228', '#3e5228'],
    seed: 9, scale: 2.0, rotation: 0, blur: 0,
  },
}

// Return a sorted list of all known preset labels (for UI).
export function listPresets(): { key: string; label: string }[] {
  return Object.entries(BASE_PRESETS).map(([key, p]) => ({ key, label: p.label }))
}

/** Parse a free-text prompt and return a CamoPreset (best match + overrides). */
export function parsePrompt(text: string): CamoPreset {
  const t = text.toLowerCase()

  // Direct key match
  for (const [key, preset] of Object.entries(BASE_PRESETS)) {
    if (t.includes(key.replace(/_/g, ' '))) return { ...preset, seed: Date.now() & 0xfffff }
  }

  // Heuristic keyword scoring
  let best = BASE_PRESETS['german_summer']
  let score = 0

  const bumps: [string, string, number][] = [
    ['german', 'german_summer', 3], ['deutschland', 'german_summer', 3],
    ['soviet', 'soviet_summer', 3], ['russian', 'soviet_summer', 3],
    ['red army', 'soviet_summer', 3], ['american', 'american_summer', 3],
    ['allied', 'american_summer', 2], ['british', 'american_summer', 2],
    ['desert', 'desert_tan', 4], ['africa', 'desert_tan', 4], ['tan', 'desert_tan', 3],
    ['ambush', 'german_ambush', 4], ['jigsaw', 'german_ambush', 4],
    ['autumn', 'autumn', 3], ['fall', 'autumn', 3], ['oakleaf', 'autumn', 4],
    ['winter', 'german_winter', 2], ['snow', 'german_winter', 2], ['whitewash', 'german_winter', 4],
    ['green', 'solid_green', 1],
  ]
  for (const [kw, key, pts] of bumps) {
    if (t.includes(kw) && pts > score) { best = BASE_PRESETS[key]; score = pts }
  }

  // Season override
  if (t.includes('winter') || t.includes('snow')) {
    if (best.style !== 'whitewash') best = { ...best, style: 'whitewash', colors: ['#e0dcd4', best.colors[0], best.colors[1]] }
  }

  // Colour override — if user mentions a specific colour, swap primary
  for (const [kw, hex] of Object.entries(COLOR_KEYWORDS)) {
    if (t.includes(kw)) {
      best = { ...best, colors: [hex, best.colors[1], best.colors[2]] }
      break
    }
  }

  return { ...best, seed: Date.now() & 0xfffff }
}

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32
// ---------------------------------------------------------------------------

function makePrng(seed: number) {
  let s = seed >>> 0
  return (): number => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Core generator
// ---------------------------------------------------------------------------

export function generateCamo(canvas: HTMLCanvasElement, preset: CamoPreset): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  const rng = makePrng(preset.seed)

  ctx.save()
  ctx.clearRect(0, 0, W, H)

  // Fill base colour
  ctx.fillStyle = preset.colors[0]
  ctx.fillRect(0, 0, W, H)

  switch (preset.style) {
    case 'softBlobs':   drawSoftBlobs(ctx, W, H, preset, rng); break
    case 'hardEdge':    drawHardEdge(ctx, W, H, preset, rng);  break
    case 'whitewash':   drawWhitewash(ctx, W, H, preset, rng); break
    case 'stripes':     drawStripes(ctx, W, H, preset, rng);   break
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Style: soft blobs (summer 3-tone)
// ---------------------------------------------------------------------------

function drawSoftBlobs(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  preset: CamoPreset, rng: () => number,
): void {
  const blobCount = Math.round(60 * preset.scale)
  const colors = [preset.colors[1], preset.colors[2]]

  for (const color of colors) {
    if (preset.blur > 0) ctx.filter = `blur(${preset.blur * preset.scale}px)`
    ctx.fillStyle = color
    for (let i = 0; i < blobCount / 2; i++) {
      const cx = rng() * W * 1.2 - W * 0.1
      const cy = rng() * H * 1.2 - H * 0.1
      const rx = (80 + rng() * 220) * preset.scale
      const ry = (60 + rng() * 180) * preset.scale
      const rot = rng() * Math.PI

      ctx.beginPath()
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      // Organic blob via cubic bezier closed path
      const pts = 6
      const angleStep = (Math.PI * 2) / pts
      ctx.moveTo(rx + (rng() - 0.5) * rx * 0.4, 0)
      for (let k = 0; k < pts; k++) {
        const a1 = (k + 1) * angleStep
        const a0 = k * angleStep
        const r0x = rx * (0.7 + rng() * 0.6)
        const r0y = ry * (0.7 + rng() * 0.6)
        const r1x = rx * (0.7 + rng() * 0.6)
        const r1y = ry * (0.7 + rng() * 0.6)
        ctx.bezierCurveTo(
          Math.cos(a0 + angleStep * 0.33) * r0x, Math.sin(a0 + angleStep * 0.33) * r0y,
          Math.cos(a1 - angleStep * 0.33) * r1x, Math.sin(a1 - angleStep * 0.33) * r1y,
          Math.cos(a1) * rx, Math.sin(a1) * ry,
        )
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    if (preset.blur > 0) ctx.filter = 'none'
  }
}

// ---------------------------------------------------------------------------
// Style: hard edge (ambush — Voronoi approximation)
// ---------------------------------------------------------------------------

function drawHardEdge(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  preset: CamoPreset, rng: () => number,
): void {
  const patchCount = Math.round(28 * preset.scale)
  const colors = [preset.colors[1], preset.colors[2]]

  for (const color of colors) {
    ctx.fillStyle = color
    for (let i = 0; i < patchCount / 2; i++) {
      const pts = 5 + Math.round(rng() * 5)
      const cx = rng() * W
      const cy = rng() * H
      const r = (60 + rng() * 200) * preset.scale
      ctx.beginPath()
      for (let k = 0; k < pts; k++) {
        const a = (k / pts) * Math.PI * 2 + rng() * 0.5
        const ri = r * (0.5 + rng() * 0.8)
        const x = cx + Math.cos(a) * ri
        const y = cy + Math.sin(a) * ri
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
    }
  }
}

// ---------------------------------------------------------------------------
// Style: whitewash (winter — large white splotches over base)
// ---------------------------------------------------------------------------

function drawWhitewash(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  preset: CamoPreset, rng: () => number,
): void {
  // First draw the secondary colour blobs (base camouflage peeking through)
  ctx.fillStyle = preset.colors[1]
  const blobCount = Math.round(20 * preset.scale)
  for (let i = 0; i < blobCount; i++) {
    const cx = rng() * W, cy = rng() * H
    const rx = (120 + rng() * 300) * preset.scale
    const ry = rx * (0.5 + rng() * 0.8)
    const rot = rng() * Math.PI
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot)
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill(); ctx.restore()
  }

  // White overlay with irregular edges
  if (preset.blur > 0) ctx.filter = `blur(${preset.blur}px)`
  ctx.fillStyle = preset.colors[0]
  const wCount = Math.round(15 * preset.scale)
  for (let i = 0; i < wCount; i++) {
    const cx = rng() * W * 1.3 - W * 0.15
    const cy = rng() * H * 1.3 - H * 0.15
    const r = (150 + rng() * 400) * preset.scale
    const pts = 7 + Math.round(rng() * 5)
    ctx.beginPath()
    for (let k = 0; k < pts; k++) {
      const a = (k / pts) * Math.PI * 2
      const ri = r * (0.6 + rng() * 0.6)
      const x = cx + Math.cos(a) * ri
      const y = cy + Math.sin(a) * ri
      if (k === 0) ctx.moveTo(x, y)
      else ctx.bezierCurveTo(
        cx + Math.cos(a - 0.3) * ri * (0.8 + rng() * 0.4),
        cy + Math.sin(a - 0.3) * ri * (0.8 + rng() * 0.4),
        cx + Math.cos(a + 0.1) * ri * (0.8 + rng() * 0.4),
        cy + Math.sin(a + 0.1) * ri * (0.8 + rng() * 0.4),
        x, y,
      )
    }
    ctx.closePath(); ctx.fill()
  }
  if (preset.blur > 0) ctx.filter = 'none'
}

// ---------------------------------------------------------------------------
// Style: stripes (oakleaf / autumn / angled bands)
// ---------------------------------------------------------------------------

function drawStripes(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  preset: CamoPreset, rng: () => number,
): void {
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((preset.rotation * Math.PI) / 180)
  ctx.translate(-W, -H)

  const D = Math.sqrt(W * W + H * H) * 2
  const stripeW = (80 + rng() * 60) * preset.scale
  const colors = [preset.colors[1], preset.colors[2], preset.colors[0]]

  if (preset.blur > 0) ctx.filter = `blur(${preset.blur}px)`
  let x = -D / 2
  let ci = 0
  while (x < D) {
    const sw = stripeW * (0.7 + rng() * 0.8)
    ctx.fillStyle = colors[ci % colors.length]
    ctx.fillRect(x, -D / 2, sw, D)
    x += sw
    ci++
  }
  if (preset.blur > 0) ctx.filter = 'none'

  ctx.restore()
}
