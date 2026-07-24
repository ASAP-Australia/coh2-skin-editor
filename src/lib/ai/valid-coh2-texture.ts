/**
 * valid-coh2-texture.ts — equipment-aware camo synthesis with hard mask compositing.
 *
 * The plain `generateCamoWithDiffusion` path produces a 1024² flat camo pattern
 * that is fine for "covers the whole vehicle" use cases but loses the equipment
 * regions (tracks, wheels, tools, exhausts, lights) that CoH2 atlas textures
 * pack into specific UV islands. SDXL has no concept of "leave the wheels
 * alone" — even with a LoRA trained on body-only captions, the model will
 * still paint over those regions because it sees the atlas as a single image.
 *
 * This module enforces equipment preservation at the pixel level:
 *
 *   1. Read the vanilla atlas (`vanillaAtlas`) — the unmodified diffuse texture
 *      shipped with the game, which already has correct equipment colours in
 *      the right UV positions.
 *   2. Fetch the per-vehicle body mask from the bundled `resources/masks/` dir.
 *      White = camo-eligible body panels; black = equipment to preserve.
 *      Missing masks fall through to all-white (covers entire atlas).
 *   3. Run img2img with the vanilla atlas as init at moderate strength (0.65),
 *      a LoRA, and an equipment-aware prompt. This gives us a generated atlas
 *      that LOOKS like a valid CoH2 texture (correct UV layout) but where the
 *      equipment regions have been overpainted.
 *   4. Composite client-side via 2D canvas:
 *        result[x,y] = mask[x,y] × generated[x,y] + (1 − mask[x,y]) × vanilla[x,y]
 *      This guarantees the equipment regions are byte-identical to the vanilla
 *      atlas while the body regions carry the freshly diffused camo pattern.
 *   5. Return an HTMLImageElement ready to wire into `customDiffuseUrl`.
 *
 * The output is a valid CoH2 atlas: the UV layout matches the source atlas
 * exactly (we only modified pixels, never resized or re-laid out), so the SGA
 * round-trip in `mod-export.ts` will produce a working .rgt without any
 * additional UV remapping.
 */

import type { Faction } from '../vehicles'
import type { DiffusionEditImageResponse } from './types'
import { applyWeathering } from '../camo-generator'

// ── Negative prompt — shared across all camo generation paths ────────────────

const NEGATIVE_PROMPT = [
  'tank render',
  'vehicle render',
  '3d model',
  'isometric',
  'panel lines',
  'rivets',
  'bolts',
  'screws',
  'hardware',
  'shading',
  'lighting',
  'shadows',
  'gradient',
  'highlight',
  'background',
  'environment',
  'sky',
  'ground',
  'grass',
  'text',
  'letters',
  'numbers',
  'logo',
  'watermark',
  'signature',
  'photograph',
  'photoreal',
  'realistic depth',
  'perspective',
].join(', ')

// ── Faction palette hints — mirrors generate-camo-diffusion.ts ───────────────

const FACTION_PALETTE: Record<string, string> = {
  german: 'WWII Wehrmacht palette: dunkelgelb base (#c4a55a), red-brown (#6a3a1e), olive (#3e5228)',
  soviet: 'WWII Soviet palette: 4BO green base (#556b3a), darker olive (#2c3c22)',
  aef: 'WWII US Army palette: olive drab base (#4a5c30)',
  british:
    'WWII British Caunter / SCC15 palette: light stone (#a9956a), khaki (#7c6a3c), slate (#3a3a35)',
  okw: 'WWII Wehrmacht late-war palette: dunkelgelb (#c4a55a) with red-brown and olive disruptors',
}

// ── Public interface ─────────────────────────────────────────────────────────

export interface ValidCoh2TextureInput {
  /** Vanilla diffuse atlas extracted from the game .rgt — provides the
   *  authoritative UV layout and the equipment pixels we want to preserve. */
  vanillaAtlas: HTMLImageElement
  /** Faction key — used to look up the bundled body mask and choose a palette. */
  faction: Faction | string
  /** Vehicle ID (lower-case, underscore-separated, e.g. "panther") — used to
   *  look up `${faction}_${vehicleId}.png` in the bundled mask resources. */
  vehicleId: string
  /** Human-readable vehicle name for the prompt context (e.g. "Panther"). */
  vehicleName?: string
  /** Free-form user direction — e.g. "ambush stripes, late-war Normandy". */
  prompt: string
  /** Season — drives the seasonal finish hint in the prompt. */
  season?: 'summer' | 'winter'
  /** LoRA selections forwarded to the sidecar. The coh2-camo LoRA should be
   *  passed here at weight 0.85–1.0 for body-panel-aware results. */
  loras?: { name: string; weight: number }[]
  /** img2img denoising strength. Default 0.65: enough to fully replace the
   *  camo pattern while preserving the underlying atlas structure (and giving
   *  the body mask a clean "before" pattern to swap in). Lower values blend
   *  the vanilla palette through; higher values risk re-laying-out the UV
   *  islands which would invalidate the mask alignment.
   *
   *  For the Honved pack, pass 0.55 (lower than default) to preserve more of
   *  the Panzer III/IV-class UV detail that the LoRA was trained on. */
  strength?: number
  /**
   * When true, apply the procedural Honved weathering pass (dust, grime,
   * chips, exhaust staining, sun fade, period desaturation) after the
   * mask composite. Triggers P2 applyWeathering on the composited canvas.
   */
  honvedWeathering?: boolean
  /** Override the diffusion sampler step count. */
  steps?: number
  /** Pin the seed for reproducibility. */
  seed?: number
}

export interface ValidCoh2TextureResult {
  /** Composited atlas ready for `customDiffuseUrl` wiring. */
  image: HTMLImageElement
  /** Whether a real body mask was found, or we fell through to all-white. */
  maskApplied: boolean
  /** Model filename the sidecar actually loaded. */
  model: string
  /** Seed actually used. */
  seed: number
  /** Sidecar wall-clock generation duration in ms. */
  durationMs: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Render the vanilla atlas into an offscreen canvas and return both the
 *  bare base64 PNG (for the IPC bridge) and the canvas itself (for the
 *  client-side composite pass). */
function rasteriseAtlas(
  atlas: HTMLImageElement,
  size: number,
): {
  base64: string
  canvas: HTMLCanvasElement
} {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D context for vanilla atlas rasterisation')
  ctx.drawImage(atlas, 0, 0, size, size)
  const dataUrl = canvas.toDataURL('image/png')
  return {
    base64: dataUrl.slice('data:image/png;base64,'.length),
    canvas,
  }
}

/** Decode a base64 PNG (no data: prefix) into a fully loaded HTMLImageElement. */
async function decodeBase64Png(b64: string, mime: string = 'image/png'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = e =>
      reject(new Error(`Failed to decode PNG: ${e instanceof Event ? 'load error' : String(e)}`))
    img.src = `data:${mime};base64,${b64}`
  })
}

/** Build a 1024² mask canvas. If a real mask was found, render it at full
 *  size; otherwise fill with white (so the composite becomes a pure
 *  "generated wins everywhere" pass — the same effect as not masking at all). */
async function buildMaskCanvas(
  maskBase64: string | null,
  size: number,
): Promise<{ canvas: HTMLCanvasElement; applied: boolean }> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D context for mask canvas')

  if (maskBase64) {
    const maskImg = await decodeBase64Png(maskBase64, 'image/png')
    ctx.drawImage(maskImg, 0, 0, size, size)
    return { canvas, applied: true }
  }

  // Fallback: full-white mask = generated wins everywhere
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  return { canvas, applied: false }
}

/** Per-pixel composite:
 *    result = mask × generated + (1 − mask) × vanilla
 *  where mask is read from the red channel of the mask image (the masks are
 *  greyscale so R==G==B; we use R for cheap access).
 *
 *  Returns both the canvas (for caller to optionally apply weathering passes)
 *  and an HTMLImageElement for callers that only need the image. */
async function composite(
  vanillaCanvas: HTMLCanvasElement,
  generated: HTMLImageElement,
  maskCanvas: HTMLCanvasElement,
  size: number,
): Promise<{ canvas: HTMLCanvasElement; image: HTMLImageElement }> {
  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  const outCtx = out.getContext('2d')
  if (!outCtx) throw new Error('Failed to get 2D context for composite canvas')

  // Draw the generated image at the canonical size first to normalise it onto
  // an ImageData buffer at the same resolution as the vanilla atlas.
  const genCanvas = document.createElement('canvas')
  genCanvas.width = size
  genCanvas.height = size
  const genCtx = genCanvas.getContext('2d')
  if (!genCtx) throw new Error('Failed to get 2D context for generated rasterisation')
  genCtx.drawImage(generated, 0, 0, size, size)

  const vanillaData = vanillaCanvas.getContext('2d')!.getImageData(0, 0, size, size)
  const genData = genCtx.getImageData(0, 0, size, size)
  const maskData = maskCanvas.getContext('2d')!.getImageData(0, 0, size, size)
  const outData = outCtx.createImageData(size, size)

  const vPix = vanillaData.data
  const gPix = genData.data
  const mPix = maskData.data
  const oPix = outData.data
  const n = size * size * 4

  for (let i = 0; i < n; i += 4) {
    // Mask alpha is read from the red channel (greyscale → R==G==B)
    const w = mPix[i] / 255 // 0 = preserve vanilla, 1 = use generated
    const iw = 1 - w
    oPix[i] = Math.round(gPix[i] * w + vPix[i] * iw)
    oPix[i + 1] = Math.round(gPix[i + 1] * w + vPix[i + 1] * iw)
    oPix[i + 2] = Math.round(gPix[i + 2] * w + vPix[i + 2] * iw)
    // Preserve vanilla alpha — equipment regions with non-opaque alpha
    // (rare in CoH2 atlases but possible) round-trip unchanged.
    oPix[i + 3] = vPix[i + 3]
  }

  outCtx.putImageData(outData, 0, 0)

  // Convert canvas → HTMLImageElement so callers can treat the result the
  // same way they treat generateCamoWithDiffusion output.
  const finalUrl = out.toDataURL('image/png')
  const image = await decodeBase64Png(finalUrl.slice('data:image/png;base64,'.length), 'image/png')
  return { canvas: out, image }
}

/** Build the equipment-aware refinement prompt. The "body panels only" and
 *  "equipment unchanged" language matches the captions the LoRA was trained
 *  on, so the diffusion model is primed to paint primarily on the body
 *  regions even though the mask will enforce that post-hoc. */
function buildPrompt(input: ValidCoh2TextureInput): string {
  const factionKey =
    (input.faction as string).toLowerCase() === 'west_german'
      ? 'okw'
      : (input.faction as string).toLowerCase()

  const paletteHint = FACTION_PALETTE[factionKey] ?? 'WWII-appropriate muted military palette'

  const seasonHint =
    input.season === 'winter'
      ? 'winter whitewash overlay: mostly white / off-white (#e8e4d8) with worn patches of the base paint showing through'
      : 'summer / temperate finish: matte, dusty, slightly weathered'

  const vehicleHint = input.vehicleName ? `Vehicle context: ${input.vehicleName}.` : ''

  const userHint = input.prompt.trim() ? `User direction: ${input.prompt.trim()}.` : ''

  return [
    // Atlas-shape language — keeps the model from re-laying-out the UV islands
    `CoH2 vehicle texture atlas, top-down orthographic UV layout.`,
    // Body / equipment language — matches the LoRA training captions
    `Hull body panels camouflaged. Tracks, wheels, exhaust pipes, tools, antennas, ` +
      `lights and tow cables left in their original colours — equipment is not overpainted.`,
    `Style: ${paletteHint}.`,
    `Finish: ${seasonHint}.`,
    `Hand-painted matte appearance — no 3D shading, no lighting, no shadows, no gradients, no highlights.`,
    `No panel lines, no rivets, no bolts. No vehicle silhouette outside the atlas islands, no background, no text, no logos.`,
    vehicleHint,
    userHint,
  ]
    .filter(Boolean)
    .join(' ')
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function generateValidCoh2Texture(
  input: ValidCoh2TextureInput,
): Promise<ValidCoh2TextureResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('Local diffusion engine requires the Electron desktop build.')
  }

  const api = window.electronAPI
  const size = 1024

  // 1. Rasterise vanilla atlas → base64 (for IPC) + canvas (for composite).
  const { base64: vanillaB64, canvas: vanillaCanvas } = rasteriseAtlas(input.vanillaAtlas, size)

  // 2. Fetch body mask (or null if not bundled for this vehicle).
  const factionKey =
    (input.faction as string).toLowerCase() === 'west_german'
      ? 'okw'
      : (input.faction as string).toLowerCase()
  const maskB64 = await api.diffusion.getBodyMask(factionKey, input.vehicleId)
  const { canvas: maskCanvas, applied: maskApplied } = await buildMaskCanvas(maskB64, size)

  // 3. img2img on vanilla atlas with equipment-aware prompt + LoRA.
  const prompt = buildPrompt(input)
  const reply: DiffusionEditImageResponse = await api.diffusion.editImage({
    prompt,
    negativePrompt: NEGATIVE_PROMPT,
    imageBase64: vanillaB64,
    strength: input.strength ?? 0.65,
    width: size,
    height: size,
    steps: input.steps ?? 6,
    cfgScale: 1.0,
    sampler: 'euler',
    seed: input.seed ?? -1,
    loras: input.loras,
  })

  const generatedImg = await decodeBase64Png(reply.imageBase64, reply.mimeType)

  // 4. Per-pixel composite: result = mask × generated + (1 − mask) × vanilla
  const { canvas: compositeCanvas, image: compositeImg } = await composite(
    vanillaCanvas, generatedImg, maskCanvas, size,
  )

  // 5. P2 — Honved weathering pass (after composite, before GPU upload).
  //    Applied when the caller requests it via honvedWeathering: true.
  //    Runs on the composited canvas in-place; re-encodes to HTMLImageElement.
  let finalImg: HTMLImageElement = compositeImg
  if (input.honvedWeathering) {
    const wctx = compositeCanvas.getContext('2d')
    if (wctx) {
      applyWeathering(wctx, size, size, input.seed ?? 42)
      const url = compositeCanvas.toDataURL('image/png')
      finalImg = await decodeBase64Png(
        url.slice('data:image/png;base64,'.length), 'image/png',
      )
    }
  }

  return {
    image: finalImg,
    maskApplied,
    model: reply.model,
    seed: reply.seed,
    durationMs: reply.durationMs,
  }
}
