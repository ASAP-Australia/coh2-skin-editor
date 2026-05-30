/**
 * AI-assisted decal / insignia generator.
 *
 * Decals are small (≤512²) stamps with transparent backgrounds —
 * shields, division insignia, kill marks, tac numbers, etc. The
 * provider returns a flat PNG on a solid white background; we run a
 * luminosity chroma-key pass to punch that background out before
 * inserting the result into the project image library.
 *
 * Provider notes:
 *   - gpt-image-1: best quality, can be coaxed into flat insignia
 *     style with explicit prompting. Ignores `negativePrompt`.
 *   - Imagen 3:    honours `negativePrompt`; tends to add 3D shading
 *                  on emblems unless flat-art is strongly enforced.
 *   - Grok-2:      decent but less consistent on transparent edges.
 *
 * We never ask for transparent-PNG output directly — provider support
 * for `background:'transparent'` is patchy. Asking for a flat white
 * background and chroma-keying it client-side gives us a deterministic
 * pipeline that works across all three providers.
 */

interface GenerateDecalImageCtx {
  faction: string
  vehicleName: string
  /** Free-form user description — e.g. "SS Totenkopf skull insignia",
   *  "white kill mark with red ring", "Soviet star with hammer & sickle". */
  prompt: string
}

const DECAL_NEGATIVE_PROMPT = [
  '3d shading',
  'lighting',
  'shadows',
  'gradient',
  'highlights',
  'photograph',
  'photoreal',
  'depth',
  'perspective',
  'background pattern',
  'frame',
  'border decoration',
  'multiple emblems',
  'collage',
  'sheet of decals',
  'tank render',
  'vehicle render',
  'busy background',
  'gradient background',
].join(', ')

function buildDecalPrompt(ctx: GenerateDecalImageCtx): string {
  const { faction, vehicleName, prompt } = ctx
  // Hard constraints up-front. The chroma-key pass needs a *uniform*
  // background to strip cleanly — gradients or off-white edges leave
  // halos. We're explicit about both the foreground style (flat,
  // single colour) and the background colour.
  return [
    `Flat 2D military insignia / stamp design, single emblem centered on a pure white #FFFFFF background.`,
    `Style: solid colours only, hand-painted stencil look, no 3D shading, no lighting, no shadows, no gradients, no highlights.`,
    `No text labels outside the emblem. No frame, no border, no second emblem.`,
    `Subject: ${prompt.trim() || 'historically-appropriate emblem for the faction'}.`,
    `Faction context: ${faction}. Vehicle context: ${vehicleName}.`,
    `Output: just the emblem on a perfectly uniform white background — the background will be removed in post.`,
  ].join(' ')
}

export interface GenerateDecalImageResult {
  /** Loaded `HTMLImageElement` with transparent background — ready to
   *  paste into the project image library and place as an image decal. */
  image: HTMLImageElement
  /** Data URL of the transparent PNG (already encoded — handy for
   *  storage without re-rasterising). */
  dataUrl: string
  /** Source pixel dimensions of the decoded image. */
  width: number
  height: number
  provider: string
  model: string
}

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

/** Strip a near-uniform light background using a luminosity threshold.
 *
 *  We sample the four corner pixels, take the brightest one as the
 *  "background" reference, then for every pixel:
 *    - if it's within `tolerance` of that reference luma AND inside the
 *      colour-distance threshold, alpha → 0
 *    - else if it's borderline (within a soft edge band), alpha is
 *      attenuated proportionally so we don't leave a hard halo
 *    - else it's foreground and passes through
 *
 *  Tolerance defaults are tuned for "perfectly white" backgrounds with
 *  some compression noise — typical provider output.
 *
 *  Returns a brand-new `HTMLImageElement` (and its data URL) sized to
 *  the source image; we don't crop to the bounding box here because
 *  decal placement scales by the longest edge and an asymmetric crop
 *  would shift the visual centre.
 */
async function chromaKeyToTransparent(
  src: HTMLImageElement,
  opts: { luminanceThreshold?: number; softEdge?: number } = {},
): Promise<{ image: HTMLImageElement; dataUrl: string; width: number; height: number }> {
  const luminanceThreshold = opts.luminanceThreshold ?? 235 // brightness above this → background
  const softEdge = opts.softEdge ?? 20 // alpha ramp width below the threshold

  const c = document.createElement('canvas')
  c.width = src.naturalWidth || src.width
  c.height = src.naturalHeight || src.height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('chromaKey: 2D context unavailable')
  ctx.drawImage(src, 0, 0)

  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2]
    // Rec. 709 luma approximation — ints, no floats for speed.
    const luma = (r * 2126 + g * 7152 + b * 722) / 10000
    if (luma >= luminanceThreshold) {
      d[i + 3] = 0
    } else if (luma >= luminanceThreshold - softEdge) {
      // Soft edge: ramp alpha from 0 (at threshold) to 255 (softEdge below).
      const t = (luminanceThreshold - luma) / softEdge
      d[i + 3] = Math.round(d[i + 3] * t)
    }
  }
  ctx.putImageData(img, 0, 0)

  const dataUrl = c.toDataURL('image/png')
  const out = new Image()
  await new Promise<void>((resolve, reject) => {
    out.onload = () => resolve()
    out.onerror = () => reject(new Error('chromaKey: failed to re-decode output'))
    out.src = dataUrl
  })
  return { image: out, dataUrl, width: c.width, height: c.height }
}

export async function generateDecalImageWithAi(
  ctx: GenerateDecalImageCtx,
): Promise<GenerateDecalImageResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('AI image generation requires the Electron desktop build')
  }
  const prompt = buildDecalPrompt(ctx)
  const reply = await window.electronAPI.ai.generateImage({
    prompt,
    negativePrompt: DECAL_NEGATIVE_PROMPT,
    size: '1024x1024',
    quality: 'high',
  })
  const raw = await decodeBase64Png(reply.imageBase64, reply.mimeType)
  const keyed = await chromaKeyToTransparent(raw)
  return {
    image: keyed.image,
    dataUrl: keyed.dataUrl,
    width: keyed.width,
    height: keyed.height,
    provider: reply.provider,
    model: reply.model,
  }
}

/** Refinement turn — same re-prompt approximation as camo image gen
 *  (true img2img edits land later). The previous prompt is embedded
 *  so the model has continuity context. */
export async function refineDecalImageWithAi(
  ctx: GenerateDecalImageCtx,
  previousPrompt: string,
  refinement: string,
): Promise<GenerateDecalImageResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('AI image generation requires the Electron desktop build')
  }
  const base = buildDecalPrompt({ ...ctx, prompt: '' })
  const refined = [
    base,
    `Previous direction: ${previousPrompt.trim() || '(none)'}.`,
    `Apply this refinement, keeping the same emblem identity: ${refinement.trim() || 'subtle variation in the same spirit'}.`,
  ].join(' ')
  const reply = await window.electronAPI.ai.generateImage({
    prompt: refined,
    negativePrompt: DECAL_NEGATIVE_PROMPT,
    size: '1024x1024',
    quality: 'high',
  })
  const raw = await decodeBase64Png(reply.imageBase64, reply.mimeType)
  const keyed = await chromaKeyToTransparent(raw)
  return {
    image: keyed.image,
    dataUrl: keyed.dataUrl,
    width: keyed.width,
    height: keyed.height,
    provider: reply.provider,
    model: reply.model,
  }
}
