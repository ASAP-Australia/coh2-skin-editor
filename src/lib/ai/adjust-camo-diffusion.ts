/**
 * adjust-camo-diffusion.ts — Tier-3 LOCAL img2img refinement loop.
 *
 * Takes an already-generated camo (as an HTMLImageElement or data URL) and an
 * adjustment prompt ("darker, more snow") and asks the sd-server sidecar to
 * produce a refined variant that preserves the original composition while
 * applying the requested changes.
 *
 * Design notes:
 *   - The adjustment text is prepended to the full faction/vehicle prompt so
 *     it takes priority over the structural context — the user's words steer
 *     the diffusion direction; the context words prevent the model from
 *     drifting away from military camo textures.
 *   - `strength` defaults to 0.4: enough to apply colour/texture changes
 *     without destroying the underlying pattern layout.
 *   - The base image is extracted from the HTMLImageElement via a transient
 *     canvas if a URL string is not already available.
 */

import type { Faction } from '../vehicles'
import type { DiffusionEditImageResponse } from './types'

// ── Negative prompt — same constant used in generate-camo-diffusion.ts ────────

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

// ── Palette hints — mirrors generate-camo-diffusion.ts exactly ────────────────

const FACTION_PALETTE: Record<string, string> = {
  german: 'WWII Wehrmacht palette: dunkelgelb base (#c4a55a), red-brown (#6a3a1e), olive (#3e5228)',
  soviet: 'WWII Soviet palette: 4BO green base (#556b3a), darker olive (#2c3c22)',
  aef: 'WWII US Army palette: olive drab base (#4a5c30)',
  british:
    'WWII British Caunter / SCC15 palette: light stone (#a9956a), khaki (#7c6a3c), slate (#3a3a35)',
  okw: 'WWII Wehrmacht late-war palette: dunkelgelb (#c4a55a) with red-brown and olive disruptors',
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface AdjustCamoDiffusionInput {
  /** Source image — HTMLImageElement or a PNG data URL ("data:image/png;base64,…"). */
  baseImage: HTMLImageElement | string
  /** Natural-language adjustment. E.g. "darker, more snow" or "add ambush stripes". */
  adjustmentPrompt: string
  /** Faction key used to inject palette context into the refinement prompt. */
  faction: Faction | string
  /** Human-readable vehicle name for additional prompt context. */
  vehicleId?: string
  /** Optional LoRA adapters forwarded to the sidecar. */
  loras?: { name: string; weight: number }[]
  /** img2img denoising strength — 0 = keep original, 1 = full redraw.
   *  Default 0.4: preserves composition, allows colour/texture drift. */
  strength?: number
}

export interface AdjustCamoDiffusionResult {
  image: HTMLImageElement
  model: string
  seed: number
  durationMs: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract a bare base64 PNG string from either a data URL or an
 *  HTMLImageElement. Uses a transient offscreen canvas for the element path. */
function toBase64Png(source: HTMLImageElement | string): string {
  if (typeof source === 'string') {
    // Strip the data URL prefix if present
    const prefix = 'data:image/png;base64,'
    if (source.startsWith(prefix)) return source.slice(prefix.length)
    // Some callers may pass a bare base64 already
    return source
  }

  // Render the image element into a canvas and export as PNG base64
  const canvas = document.createElement('canvas')
  canvas.width = source.naturalWidth || source.width || 1024
  canvas.height = source.naturalHeight || source.height || 1024
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D canvas context for base64 export')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/png')
  const prefix = 'data:image/png;base64,'
  return dataUrl.slice(prefix.length)
}

/** Build the refinement prompt.
 *
 *  The user's adjustment is prepended so it takes highest priority in the
 *  diffusion guidance vector, followed by the structural context that keeps
 *  the output recognisably a flat military camo texture. */
function buildRefinementPrompt(input: AdjustCamoDiffusionInput): string {
  const factionKey =
    (input.faction as string).toLowerCase() === 'west_german'
      ? 'okw'
      : (input.faction as string).toLowerCase()

  const paletteHint = FACTION_PALETTE[factionKey] ?? 'WWII-appropriate muted military palette'

  const vehicleHint = input.vehicleId ? `Vehicle context: ${input.vehicleId}.` : ''

  return [
    // User adjustment first — highest guidance weight
    input.adjustmentPrompt.trim(),
    // Structural anchor — prevents the model from producing a vehicle render
    `Flat 2D military vehicle camouflage texture, square tileable seamless pattern, top-down orthographic view.`,
    `Style: ${paletteHint}.`,
    `Hand-painted matte appearance — no 3D shading, no lighting, no shadows, no gradients, no highlights.`,
    `No panel lines, no rivets, no bolts, no hardware. No vehicle silhouette, no background, no text, no logos.`,
    `Pattern fills the entire frame edge-to-edge.`,
    vehicleHint,
  ]
    .filter(Boolean)
    .join(' ')
}

/** Decode a bare base64 PNG string (no data: prefix) into an HTMLImageElement. */
async function decodeBase64Png(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = e =>
      reject(
        new Error(
          `Failed to decode adjusted camo image: ${e instanceof Event ? 'load error' : String(e)}`,
        ),
      )
    img.src = `data:image/png;base64,${b64}`
  })
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function adjustCamoDiffusion(
  input: AdjustCamoDiffusionInput,
): Promise<AdjustCamoDiffusionResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('Local diffusion engine requires the Electron desktop build.')
  }

  const imageBase64 = toBase64Png(input.baseImage)
  const prompt = buildRefinementPrompt(input)
  const negativePrompt = NEGATIVE_PROMPT

  const reply: DiffusionEditImageResponse = await window.electronAPI.diffusion.editImage({
    prompt,
    negativePrompt,
    imageBase64,
    strength: input.strength ?? 0.4,
    width: 1024,
    height: 1024,
    steps: 6,
    cfgScale: 1.0,
    sampler: 'euler',
    seed: -1,
    loras: input.loras,
  })

  const image = await decodeBase64Png(reply.imageBase64)

  return {
    image,
    model: reply.model,
    seed: reply.seed,
    durationMs: reply.durationMs,
  }
}
