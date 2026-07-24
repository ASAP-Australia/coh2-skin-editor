/**
 * Procedural camo pattern generator.
 *
 * Draws directly onto a 2D canvas (caller owns the canvas; we don't clear it,
 * allowing the caller to compose camo under decals).
 *
 * Usage:
 *   const preset = parsePrompt('german ambush winter')
 *   generateCamo(myCanvas, preset)
 *
 * Equipment preservation (P0 fix):
 *   Pass `maskCanvas` to restrict camo to armor-only pixels.
 *   When provided, generateCamo uses source-atop clipping so tracks, wheels,
 *   tools and fittings remain byte-identical to the vanilla diffuse.
 *   When null/undefined, falls back to the legacy opaque-fill behaviour.
 *
 * Weathering (P2):
 *   Call applyWeathering(ctx, W, H, seed) after the camo composite to layer
 *   procedural dust, grime, chips and sun-fade. Honved preset triggers this
 *   automatically via the `weathering` flag on the preset.
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
  /**
   * When true, generateCamo skips the opaque base fill and only draws the
   * secondary/tertiary blobs (transparent background so the caller can
   * composite over the vanilla diffuse and use mask-gating).
   * Also triggers the Honved historical desaturation + weathering pass.
   */
  maskedMode?: boolean
  /**
   * Restrict to this faction only — used by honved_summer to flag that
   * the preset is historically scoped to german (Ostheer) vehicles only.
   * UI can surface this as a warning when applied to other factions.
   */
  factionScope?: string
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
  // P1 — Historical Hungarian Honved 3-tone (1942+ factory scheme for German-built vehicles)
  // Base: Dunkelgelb (#C8A96E), chestnut brown (#7A3B2E), oil-green (#4A5A35).
  // maskedMode=true: skips opaque fill so camo composites over vanilla diffuse,
  // allowing armor-only masking in renderCamoPresetToOverlay.
  // factionScope='german': Ostheer only — NOT applied to OKW/west_german.
  'honved_summer': {
    label: 'Honved Hungarian 3-tone (Ostheer only)',
    style: 'hardEdge',
    colors: ['#C8A96E', '#7A3B2E', '#4A5A35'],
    seed: 42, scale: 0.95, rotation: 0, blur: 0,
    maskedMode: true,
    factionScope: 'german',
  },
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
    // P1 — Honved / Hungarian keywords take top priority (score 5)
    ['honved', 'honved_summer', 5], ['hungarian', 'honved_summer', 5],
    ['honvéd', 'honved_summer', 5], ['kereszt', 'honved_summer', 4],
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

/**
 * Generate procedural camo onto `canvas`.
 *
 * P0 fix — maskedMode:
 *   When `preset.maskedMode` is true the canvas is NOT cleared and NO opaque
 *   base fill is drawn. Only the blob/stripe shapes are painted (with the
 *   base color as the first blob pass). The caller (renderCamoPresetToOverlay)
 *   must draw the vanilla diffuse first, then draw this camo canvas on top
 *   using `source-atop` or mask compositing so equipment pixels are preserved.
 *
 *   When maskedMode is false/absent, legacy behaviour: clearRect + opaque fill
 *   + blobs. Used for all non-Honved presets that work with the multiply blend.
 *
 * Camo overlay alpha (maskedMode):
 *   The camo is composited at CAMO_OVERLAY_ALPHA (0.80) so 20% of the stock
 *   diffuse luminance/shading survives — panel lines, rivets, and equipment
 *   sub-detail remain visible instead of being buried under a flat color fill.
 *   The mask clip ensures only armor pixels (mask-white) receive camo; all
 *   equipment pixels (mask-black) are kept at full stock fidelity.
 *
 * @param maskCanvas  Optional greyscale mask canvas (white=armor, black=equip).
 *   When provided in maskedMode, the camo blobs are clipped to armor pixels.
 */

/**
 * Opacity at which the masked camo overlay is drawn over the stock diffuse.
 * 0.80 = 80% camo + 20% stock shading → camo colour dominates but panel
 * lines / rivets / sub-surface detail remain clearly visible.
 */
export const CAMO_OVERLAY_ALPHA = 0.80

export function generateCamo(
  canvas: HTMLCanvasElement,
  preset: CamoPreset,
  maskCanvas?: HTMLCanvasElement | null,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  const rng = makePrng(preset.seed)

  ctx.save()

  if (preset.maskedMode) {
    // P0: transparent canvas — caller owns the base (vanilla diffuse).
    // Only paint the camo patches. Clip to mask if provided.
    ctx.clearRect(0, 0, W, H)

    if (maskCanvas) {
      // Build the camo on a temp canvas (opaque fill + blobs), then clip to
      // armor pixels only.
      //
      // IMPORTANT: the mask PNG stores armor=white(255,255,255,255) and
      // equipment=black(0,0,0,255).  Both have full alpha (A=255), so
      // `destination-in` would keep the ENTIRE camo canvas (it only cares
      // about source alpha, not luminance).  We must convert the mask's
      // luminance to the alpha channel first via a luminance-to-alpha pass,
      // then use `destination-in` against that converted mask.
      const tmp = document.createElement('canvas')
      tmp.width = W; tmp.height = H
      const tctx = tmp.getContext('2d')!
      tctx.save()
      tctx.clearRect(0, 0, W, H)
      // Base colour fill (Dunkelgelb / primary camo colour)
      tctx.fillStyle = preset.colors[0]
      tctx.fillRect(0, 0, W, H)
      // Secondary / tertiary blob patches on top
      _drawStyle(tctx, W, H, preset, rng)
      tctx.restore()

      // Build luminance-to-alpha mask: white pixels → alpha=255 (keep camo),
      // black pixels → alpha=0 (transparent, stock shows through).
      const luma = document.createElement('canvas')
      luma.width = W; luma.height = H
      const lctx = luma.getContext('2d')!
      lctx.drawImage(maskCanvas, 0, 0, W, H)
      const maskData = lctx.getImageData(0, 0, W, H)
      const md = maskData.data
      for (let i = 0; i < md.length; i += 4) {
        // Convert mask pixel luminance to alpha; zero out RGB so the mask
        // canvas itself contributes no colour through the blend.
        const lumVal = Math.round(0.2126 * md[i] + 0.7152 * md[i + 1] + 0.0722 * md[i + 2])
        md[i] = 0; md[i + 1] = 0; md[i + 2] = 0; md[i + 3] = lumVal
      }
      lctx.putImageData(maskData, 0, 0)

      // Clip the camo canvas to armor pixels via destination-in against the
      // luminance-alpha mask: now equipment pixels (alpha=0) become transparent.
      const tmp2 = document.createElement('canvas')
      tmp2.width = W; tmp2.height = H
      const t2ctx = tmp2.getContext('2d')!
      t2ctx.drawImage(tmp, 0, 0)
      t2ctx.globalCompositeOperation = 'destination-in'
      t2ctx.drawImage(luma, 0, 0, W, H)

      // Composite at CAMO_OVERLAY_ALPHA so stock shading/panel lines survive.
      // Equipment pixels are transparent in tmp2, so they fall through to the
      // stock diffuse drawn before this call.
      ctx.globalAlpha = CAMO_OVERLAY_ALPHA
      ctx.drawImage(tmp2, 0, 0)
      ctx.globalAlpha = 1
    } else {
      // No mask available — draw base + blobs at partial alpha; caller will
      // restrict via multiply blend over vanilla.
      ctx.fillStyle = preset.colors[0]
      ctx.fillRect(0, 0, W, H)
      _drawStyle(ctx, W, H, preset, rng)
    }
  } else {
    // Legacy: opaque base fill + blobs — works with multiply blend in caller.
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = preset.colors[0]
    ctx.fillRect(0, 0, W, H)
    _drawStyle(ctx, W, H, preset, rng)
  }

  ctx.restore()
}

function _drawStyle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  preset: CamoPreset,
  rng: () => number,
): void {
  switch (preset.style) {
    case 'softBlobs':   drawSoftBlobs(ctx, W, H, preset, rng); break
    case 'hardEdge':    drawHardEdge(ctx, W, H, preset, rng);  break
    case 'whitewash':   drawWhitewash(ctx, W, H, preset, rng); break
    case 'stripes':     drawStripes(ctx, W, H, preset, rng);   break
  }
}

// ---------------------------------------------------------------------------
// P2 — Procedural weathering pass (Honved historical finish)
// ---------------------------------------------------------------------------

/**
 * Layer subtle weathering passes over an already-composited camo canvas.
 * Call AFTER generateCamo / vanilla composite, BEFORE GPU upload.
 *
 * Passes (all procedural — no art assets required):
 *   1. Dust/mud multiply on lower hull (vertical gradient)
 *   2. Grime in recesses (noise darkening, full surface, low alpha)
 *   3. Edge paint chips toward bare metal on hull edges
 *   4. Exhaust staining near engine deck (top-right quadrant)
 *   5. Sun fade on upper surfaces (screen blend, low alpha)
 *   6. Period desaturation (CSS filter saturate(0.65) approximated pixel-pass)
 *
 * @param ctx  2D context of the final composited 2048² canvas.
 * @param W    Canvas width (should be 2048).
 * @param H    Canvas height (should be 2048).
 * @param seed Seed for reproducible noise (use CamoPreset.seed).
 */
export function applyWeathering(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  seed: number,
): void {
  const rng = makePrng(seed ^ 0xdeadbeef)

  ctx.save()

  // 1. Dust / mud — lower 35% of canvas, multiply dark brown gradient
  {
    const grad = ctx.createLinearGradient(0, H * 0.65, 0, H)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(0.5, 'rgba(40,28,12,0.22)')
    grad.addColorStop(1, 'rgba(28,18,6,0.40)')
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = grad
    ctx.fillRect(0, H * 0.65, W, H * 0.35)
    ctx.globalCompositeOperation = 'source-over'
  }

  // 2. Grime / ambient dirt — random dark smudges scattered across surface
  {
    ctx.globalCompositeOperation = 'multiply'
    const grimeCount = 80
    for (let i = 0; i < grimeCount; i++) {
      const gx = rng() * W
      const gy = rng() * H
      const gr = (20 + rng() * 80)
      const ga = 0.05 + rng() * 0.12
      const radial = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
      radial.addColorStop(0, `rgba(20,14,5,${ga})`)
      radial.addColorStop(1, 'rgba(20,14,5,0)')
      ctx.fillStyle = radial
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2)
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  // 3. Edge paint chips — small bright-grey rectangles on hull border zones
  {
    ctx.globalCompositeOperation = 'source-over'
    const chipCount = 120
    // Chips concentrate on upper-hull perimeter (edges of the 2048 space)
    for (let i = 0; i < chipCount; i++) {
      const side = Math.floor(rng() * 4)
      let cx: number, cy: number
      if (side === 0) { cx = rng() * W; cy = rng() * H * 0.15 }          // top
      else if (side === 1) { cx = rng() * W; cy = H - rng() * H * 0.15 } // bottom
      else if (side === 2) { cx = rng() * W * 0.15; cy = rng() * H }     // left
      else { cx = W - rng() * W * 0.15; cy = rng() * H }                  // right
      const cw = 2 + rng() * 8
      const ch = 1 + rng() * 4
      const brightness = 0.60 + rng() * 0.25
      ctx.globalAlpha = 0.45 + rng() * 0.25
      ctx.fillStyle = `rgb(${Math.round(brightness * 160)},${Math.round(brightness * 155)},${Math.round(brightness * 140)})`
      ctx.fillRect(cx, cy, cw, ch)
    }
    ctx.globalAlpha = 1
  }

  // 4. Exhaust staining — engine deck = top-right quadrant, warm grey streak
  {
    ctx.globalCompositeOperation = 'overlay'
    const exGrad = ctx.createRadialGradient(
      W * 0.75, H * 0.2, 0,
      W * 0.75, H * 0.2, W * 0.22,
    )
    exGrad.addColorStop(0, 'rgba(30,25,15,0.30)')
    exGrad.addColorStop(1, 'rgba(30,25,15,0)')
    ctx.fillStyle = exGrad
    ctx.fillRect(W * 0.5, 0, W * 0.5, H * 0.4)
    ctx.globalCompositeOperation = 'source-over'
  }

  // 5. Sun fade — upper surfaces (top 30%), very subtle screen lift
  {
    ctx.globalCompositeOperation = 'screen'
    const sunGrad = ctx.createLinearGradient(0, 0, 0, H * 0.3)
    sunGrad.addColorStop(0, 'rgba(210,195,160,0.10)')
    sunGrad.addColorStop(1, 'rgba(210,195,160,0)')
    ctx.fillStyle = sunGrad
    ctx.fillRect(0, 0, W, H * 0.3)
    ctx.globalCompositeOperation = 'source-over'
  }

  // 6. Period desaturation — pull colour toward grey/sepia
  //    Approximated as: read pixels, reduce saturation to 65%, add slight
  //    warm tint. Done via ImageData for a faithful per-pixel pass.
  {
    const imageData = ctx.getImageData(0, 0, W, H)
    const d = imageData.data
    const n = d.length
    for (let i = 0; i < n; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      // Luminance (rec709)
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      // Lerp toward luminance at 35% (retain 65% of original chroma)
      const sat = 0.65
      d[i]     = Math.round(r * sat + lum * (1 - sat))
      d[i + 1] = Math.round(g * sat + lum * (1 - sat))
      d[i + 2] = Math.round(b * sat + lum * (1 - sat))
      // Slight warm tint: nudge R+2, B-3 for a faded wartime look
      d[i]     = Math.min(255, d[i] + 2)
      d[i + 2] = Math.max(0, d[i + 2] - 3)
    }
    ctx.putImageData(imageData, 0, 0)
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
