/**
 * AI-assisted camo *image* generator (Tier 2).
 *
 * Unlike `generate-camo.ts` — which asks the model for parameter JSON
 * that drives our procedural renderer — this path asks an image model
 * (OpenAI gpt-image-1 or Google Imagen 3) to render the camo pixels
 * directly. The result is a 1024² PNG that we drop onto the 2048²
 * diffuse canvas; rivets / panel lines are NOT in the diffuse (they
 * live in the normal map), so we don't need to preserve any underlying
 * detail — the camo paint layer is the whole picture.
 *
 * Provider notes:
 *   - gpt-image-1: tracks the prompt closely, ignores `negativePrompt`.
 *   - Imagen 3:    honours `negativePrompt`; tends to add backgrounds
 *                  unless explicitly suppressed.
 *
 * The renderer never sees the API key — `window.electronAPI.ai
 * .generateImage` proxies through the main process which signs the
 * HTTP call.
 */

interface GenerateCamoImageCtx {
  faction: string
  season: 'summer' | 'winter'
  vehicleName: string
  /** Free-form user prompt — e.g. "ambush pattern with dark green and
   *  ochre", "winter whitewash with chipped paint". */
  prompt: string
}

/** Negative prompt shared by both providers. Imagen consumes it
 *  directly; gpt-image-1 ignores it but having it on hand keeps the
 *  text path identical. */
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

function buildImagePrompt(ctx: GenerateCamoImageCtx): string {
  const { faction, season, vehicleName, prompt } = ctx

  // Faction palette hints — same heuristics as the Tier 1 prompt so
  // both flows produce visually coherent output for a given faction.
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
  // language matters: without it both providers default to producing
  // tank photos with painted-on camo, which is unusable.
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

export interface GenerateCamoImageResult {
  /** Loaded `HTMLImageElement` ready to `drawImage()` onto the diffuse
   *  canvas at 2048×2048. The browser upscales the 1024² source via
   *  the canvas's smoothing — camo doesn't need pixel-perfect scaling
   *  so we don't burn cycles on a lanczos pass. */
  image: HTMLImageElement
  provider: string
  model: string
}

/** Decode a base64 PNG into an `HTMLImageElement`. We bounce through a
 *  data URL rather than `Blob` + `createObjectURL` because we never
 *  need to revoke it (single-use, GC'd with the image). */
async function decodeBase64Png(b64: string, mime: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = e =>
      reject(
        new Error(`Failed to decode AI image: ${e instanceof Event ? 'load error' : String(e)}`),
      )
    img.src = `data:${mime};base64,${b64}`
  })
}

export async function generateCamoImageWithAi(
  ctx: GenerateCamoImageCtx,
): Promise<GenerateCamoImageResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('AI image generation requires the Electron desktop build')
  }

  const prompt = buildImagePrompt(ctx)

  const reply = await window.electronAPI.ai.generateImage({
    prompt,
    negativePrompt: NEGATIVE_PROMPT,
    size: '1024x1024',
    quality: 'high',
  })

  const image = await decodeBase64Png(reply.imageBase64, reply.mimeType)
  return { image, provider: reply.provider, model: reply.model }
}

/** Tier-2 refinement.
 *
 *  We don't have a true img2img path wired up yet (would require
 *  gpt-image-1's edits endpoint + multipart upload of the previous
 *  PNG). For now we approximate refinement by concatenating the
 *  prior brief with the refinement instruction — the model produces
 *  a *new* image biased toward the spirit of the previous one.
 *
 *  The `previousPrompt` param is what we sent on the last turn — we
 *  prepend it as "the camo you previously drew was described as: X.
 *  Apply this change: Y" so the model has continuity context.
 */
export async function refineCamoImageWithAi(
  ctx: GenerateCamoImageCtx,
  previousPrompt: string,
  refinement: string,
): Promise<GenerateCamoImageResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('AI image generation requires the Electron desktop build')
  }

  // Build a refinement prompt that re-uses the base structure but
  // adds the prior brief + the change instruction.
  const basePrompt = buildImagePrompt({ ...ctx, prompt: '' })
  const refined = [
    basePrompt,
    `Previous direction: ${previousPrompt.trim() || '(none)'}.`,
    `Apply this refinement, keeping the same overall style and palette: ${refinement.trim() || 'subtle variation in the same spirit'}.`,
  ].join(' ')

  const reply = await window.electronAPI.ai.generateImage({
    prompt: refined,
    negativePrompt: NEGATIVE_PROMPT,
    size: '1024x1024',
    quality: 'high',
  })

  const image = await decodeBase64Png(reply.imageBase64, reply.mimeType)
  return { image, provider: reply.provider, model: reply.model }
}
