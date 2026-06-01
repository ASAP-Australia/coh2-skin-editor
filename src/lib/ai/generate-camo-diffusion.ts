/**
 * AI-assisted camo image generator — Tier 3 (LOCAL, stable-diffusion.cpp).
 *
 * This is the renderer-side half of the local diffusion pipeline. The
 * Electron main process owns the sd-server child's lifecycle; this module
 * builds the prompt and calls through the IPC bridge that the preload
 * script exposes at `window.electronAPI.diffusion`.
 *
 * Why a separate module from `generate-camo-image.ts` (Tier 2)?
 *   - The IPC surface is completely different (`diffusion.*` vs `ai.*`).
 *   - The request shape differs: local sd.cpp wants explicit `width`,
 *     `height`, `steps`, `cfgScale`, `sampler`, `seed`; cloud APIs want
 *     `size` + `quality` strings.
 *   - The response shape differs: local returns `durationMs` and a
 *     resolved `seed` which we surface in the UI so the user can
 *     reproduce a result.
 *
 * The prompt-building logic is intentionally identical to Tier 2 — the
 * same brief that works for gpt-image-1 / Imagen works well for SDXL
 * Turbo / Lightning because both pipelines follow instruction-tuned
 * guidance. Keeping them in sync avoids drift between the two paths.
 */

import type { DiffusionGenerateImageResponse } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

interface GenerateCamoDiffusionCtx {
  /** Faction key: 'soviet' | 'german' | 'aef' | 'british' | 'okw' */
  faction: string
  season: 'summer' | 'winter'
  /** Human-readable vehicle name used as prompt context (e.g. "T-34/76"). */
  vehicleName: string
  /** Free-form user direction — e.g. "ambush pattern with ochre blotches". */
  prompt: string
  /** Override the model filename the sidecar loads. When absent the sidecar
   *  auto-selects the first available GGUF in userData/diffusion/models/. */
  model?: string
  /** LoRA selections. When we train a "coh2-camo-v1" LoRA and bundle it,
   *  the UI will pass `{ name: 'coh2-camo-v1', weight: 0.85 }` here. The
   *  main process splices the sd.cpp `<lora:name:weight>` syntax into the
   *  prompt string before forwarding to the child, so the renderer stays
   *  syntax-agnostic. */
  loras?: { name: string; weight: number }[]
  /** Sampler step count. SDXL Turbo needs 1–4; SDXL Lightning needs 4–8.
   *  Defaulting to 6 is safe for both. We don't know which model the user
   *  has installed at call time, so we don't try to auto-detect. */
  steps?: number
  /** Pin the random seed. When absent (or -1) the sidecar picks and echoes
   *  back the actual seed so the user can reproduce the result. */
  seed?: number
}

export interface GenerateCamoDiffusionResult {
  /** Decoded, fully loaded HTMLImageElement ready for `drawImage()`. */
  image: HTMLImageElement
  /** Model filename that was actually used (echoed from the sidecar). */
  model: string
  /** Seed actually used — resolved from -1 if the request was random. */
  seed: number
  /** Wall-clock milliseconds from IPC call to decoded image (sidecar's own
   *  timer, not RTT — does not include IPC serialisation overhead). */
  durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt construction — mirrors generate-camo-image.ts exactly
// ─────────────────────────────────────────────────────────────────────────────

/** Negative prompt shared across both the cloud (Tier 2) and local (Tier 3)
 *  pipelines. Imagen consumes it natively; gpt-image-1 ignores it; sd.cpp
 *  honours it fully via the negative guidance vector. */
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

function buildImagePrompt(ctx: GenerateCamoDiffusionCtx): string {
  const { faction, season, vehicleName, prompt } = ctx

  // Faction palette hints — same heuristics as the Tier 2 prompt so both
  // flows produce visually coherent output for a given faction.
  const palette: Record<string, string> = {
    german:
      'WWII Wehrmacht palette: dunkelgelb base (#c4a55a), red-brown (#6a3a1e), olive (#3e5228)',
    soviet: 'WWII Soviet palette: 4BO green base (#556b3a), darker olive (#2c3c22)',
    aef: 'WWII US Army palette: olive drab base (#4a5c30)',
    british:
      'WWII British Caunter / SCC15 palette: light stone (#a9956a), khaki (#7c6a3c), slate (#3a3a35)',
    okw: 'WWII Wehrmacht late-war palette: dunkelgelb (#c4a55a) with red-brown and olive disruptors',
  }
  const paletteHint = palette[faction.toLowerCase()] ?? 'WWII-appropriate muted military palette'

  const seasonHint =
    season === 'winter'
      ? 'winter whitewash overlay: mostly white / off-white (#e8e4d8) with worn patches of the base paint showing through'
      : 'summer / temperate finish: matte, dusty, slightly weathered'

  const userHint = prompt.trim() ? `User direction: ${prompt.trim()}` : ''

  // We strongly bias the model toward a flat, tileable, top-down camo
  // *texture* (not a render of a vehicle). The flat-art / no-shading
  // language matters: without it sd.cpp defaults to photorealistic tank
  // renders which are unusable as a diffuse texture.
  return [
    `Flat 2D military vehicle camouflage texture, square tileable seamless pattern, top-down orthographic view.`,
    `Style: ${paletteHint}.`,
    `Finish: ${seasonHint}.`,
    `Hand-painted matte appearance — no 3D shading, no lighting, no shadows, no gradients, no highlights.`,
    `No panel lines, no rivets, no bolts, no hardware. No vehicle silhouette, no background, no text, no logos.`,
    `Pattern fills the entire frame edge-to-edge with the camo only.`,
    `Vehicle context: ${vehicleName}.`,
    userHint,
  ]
    .filter(Boolean)
    .join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Base64 → HTMLImageElement decoder — mirrors generate-camo-image.ts exactly
// ─────────────────────────────────────────────────────────────────────────────

/** Decode a base64 PNG returned by the sidecar into an HTMLImageElement.
 *  We bounce through a data URL rather than Blob + createObjectURL because
 *  we never need to revoke it (single-use, GC'd with the image element). */
async function decodeBase64Png(b64: string, mime: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = e =>
      reject(
        new Error(
          `Failed to decode diffusion image: ${e instanceof Event ? 'load error' : String(e)}`,
        ),
      )
    img.src = `data:${mime};base64,${b64}`
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export async function generateCamoWithDiffusion(
  ctx: GenerateCamoDiffusionCtx,
): Promise<GenerateCamoDiffusionResult> {
  // Guard: the diffusion IPC channel requires an Electron context. Fail
  // fast with a human-readable message the UI surfaces as a toast.
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('Local diffusion engine requires the Electron desktop build.')
  }

  const promptText = buildImagePrompt(ctx)
  const negativePrompt = NEGATIVE_PROMPT

  // CFG scale: Turbo / Lightning models are distilled — they run at ≤2.0.
  // 1.0 gives the flattest, most prompt-adherent output; higher values add
  // contrast but can over-saturate the palette. 1.0 is the safe default.
  const reply: DiffusionGenerateImageResponse = await window.electronAPI.diffusion.generateImage({
    prompt: promptText,
    negativePrompt,
    width: 1024,
    height: 1024,
    steps: ctx.steps ?? 6,
    cfgScale: 1.0,
    sampler: 'euler',
    seed: ctx.seed ?? -1,
    loras: ctx.loras,
    model: ctx.model,
  })

  const image = await decodeBase64Png(reply.imageBase64, reply.mimeType)

  return {
    image,
    model: reply.model,
    seed: reply.seed,
    durationMs: reply.durationMs,
  }
}
