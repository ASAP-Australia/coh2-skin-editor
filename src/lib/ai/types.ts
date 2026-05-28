/**
 * Shared AI types — used by both the renderer (`generate-camo.ts`,
 * `GenerateModal.tsx`) and the main-process IPC handlers
 * (`electron/main.ts`).
 *
 * Keep this file dependency-free (no React, no Three.js, no Electron
 * imports) so the main bundle can `require` the compiled JS without
 * pulling in renderer-only modules.
 */

export type AiProvider = 'anthropic' | 'openai' | 'google' | 'xai'

export interface AiCompleteRequest {
  /** Provider-side system / context prompt. */
  system: string
  /** Concrete user turn. */
  user: string
  /** Override the default cheap model. Provider-specific (e.g.
   *  `claude-haiku-4-5`, `gpt-4o-mini`, `gemini-2.0-flash`). */
  model?: string
  /** Cap output token budget. Default 1024 — plenty for a JSON blob. */
  maxTokens?: number
  /** Stick to lower temperature for parameter-style JSON output so the
   *  same prompt + seed yields a stable preset. Default 0.4. */
  temperature?: number
  /** Which provider's API to hit. Defaults to whichever the user set
   *  as active in settings. */
  provider?: AiProvider
}

export interface AiCompleteResponse {
  text: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
  /** Echoed back so the renderer can show "Powered by Claude / GPT /
   *  Gemini" with the right label even if it didn't pin the provider. */
  provider: AiProvider
  model: string
}

export interface AiProviderConfig {
  provider: AiProvider
  /** Whether a key for THIS provider is stored. The actual key is
   *  never sent to the renderer. */
  hasKey: boolean
}

export interface AiSettings {
  /** Provider the renderer should target unless overridden per-request. */
  activeProvider: AiProvider
  /** Per-provider key presence. */
  providers: AiProviderConfig[]
}

// ─────────────────────────────────────────────────────────────────────────
// Tier-2 image generation
// ─────────────────────────────────────────────────────────────────────────
//
// gpt-image-1 returns base64 PNG up to 1024². Imagen 3 returns base64
// PNG at 1024². Both upsample to 2048² in the renderer via canvas
// drawImage (camo doesn't need pixel-perfect upscaling).
//
// Anthropic has no image-gen endpoint → adapter rejects with a clean
// error so the modal can route the user to a different provider.

export interface AiGenerateImageRequest {
  /** Full provider-tuned prompt. Built by `generate-camo-image.ts` from
   *  faction + season + vehicle context. */
  prompt: string
  /** Negative prompt — only honoured by some providers (Imagen yes,
   *  gpt-image-1 ignores). */
  negativePrompt?: string
  /** Output dimensions. Both providers cap at 1024×1024 today, but we
   *  pass it through so future bumps to 2048 just work. */
  size?: '1024x1024' | '1536x1024' | '1024x1536'
  /** gpt-image-1 quality knob. Ignored by other providers. */
  quality?: 'low' | 'medium' | 'high' | 'auto'
  /** Override the default model for the chosen provider. */
  model?: string
  /** Which provider to hit. Defaults to active. */
  provider?: AiProvider
}

export interface AiGenerateImageResponse {
  /** Base64-encoded PNG bytes. The renderer decodes into an
   *  HTMLImageElement via `new Image()` + data URL. */
  imageBase64: string
  /** Mime type of the returned bytes. Always 'image/png' for the
   *  providers we use, but echoed so the renderer can build the data
   *  URL correctly. */
  mimeType: 'image/png' | 'image/webp' | 'image/jpeg'
  provider: AiProvider
  model: string
  /** Reported by gpt-image-1; absent for Imagen. */
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Tier-3 LOCAL diffusion (stable-diffusion.cpp sidecar)
// ─────────────────────────────────────────────────────────────────────────
//
// Unlike Tier-2 (cloud HTTP), Tier-3 spawns a local `sd-server` binary
// that listens on 127.0.0.1:<port> and serves an OpenAI-compatible
// /v1/images/generations endpoint. The Electron main process owns the
// child's lifecycle (spawn on first generate, SIGTERM on app quit).
//
// Model files live in `app.getPath('userData')/diffusion/models/` —
// shipped empty; the first launch prompts the user (or a setup wizard)
// to drop a GGUF SDXL Turbo / Lightning Q4_0 (~2.6 GB) into that dir.

/** Lifecycle state of the local diffusion sidecar. The renderer polls
 *  this to render status pills + enable/disable the AI Generate button. */
export type DiffusionState =
  | 'unavailable' // binary not bundled / not executable
  | 'no-model' // binary present, models dir empty
  | 'idle' // binary + model present, child not running yet
  | 'starting' // child spawned, waiting on /v1 healthcheck
  | 'ready' // healthcheck passed, can accept generate requests
  | 'generating' // a generate is in flight
  | 'error' // last operation failed; `message` carries detail

export interface DiffusionStatus {
  state: DiffusionState
  /** Human-readable detail — surfaced in the UI status pill. */
  message?: string
  /** Absolute path to the discovered sd-server binary, or null. */
  binaryPath: string | null
  /** Model filenames found in userData/diffusion/models/. */
  availableModels: string[]
  /** Currently loaded model filename, or null when no child is running. */
  activeModel: string | null
  /** HTTP port the running sidecar is listening on. Null when not ready. */
  port: number | null
}

export interface DiffusionGenerateImageRequest {
  prompt: string
  negativePrompt?: string
  /** Output dims. sd-server clamps to model's native (SDXL = 1024). */
  width?: number
  height?: number
  /** Sampler steps. SDXL Turbo: 1–4, SDXL Lightning: 4–8. Default 6. */
  steps?: number
  /** CFG scale. Turbo/Lightning models want ≤2.0. Default 1.0. */
  cfgScale?: number
  /** Sampler name passed to sd-server. Default 'euler'. */
  sampler?: 'euler' | 'euler_a' | 'dpm++2m' | 'dpm++2m_karras' | 'lcm'
  /** Seed; -1 / undefined → random. */
  seed?: number
  /** Optional LoRA selections. sd.cpp consumes `<lora:name:weight>` in
   *  the prompt string; we let the main process splice them in so the
   *  renderer doesn't need to know the syntax. The `name` matches a
   *  filename in userData/diffusion/loras/ (without `.safetensors`). */
  loras?: { name: string; weight: number }[]
  /** Override the active model. If absent, uses whichever was last
   *  loaded (or auto-loads the first available on cold start). */
  model?: string
}

export interface DiffusionGenerateImageResponse {
  /** Base64-encoded PNG (no `data:` prefix). */
  imageBase64: string
  mimeType: 'image/png'
  width: number
  height: number
  /** Wall-clock time the child took to produce the image. */
  durationMs: number
  /** Filename of the model used. */
  model: string
  /** Seed actually used (resolved from -1 if the request didn't pin one). */
  seed: number
}

// ─────────────────────────────────────────────────────────────────────────
// Tier-3 LOCAL diffusion — img2img (edit / adjust)
// ─────────────────────────────────────────────────────────────────────────
//
// Routes to /sdapi/v1/img2img on the sd-server sidecar. The caller
// supplies a base camo PNG and an adjustment prompt; the sidecar produces
// a refined variant that preserves the composition while applying the
// adjustment.

export interface DiffusionEditImageRequest extends DiffusionGenerateImageRequest {
  /** Base64-encoded PNG of the camo to adjust (no `data:` prefix). */
  imageBase64: string
  /** Denoising / img2img strength. 0 = copy original, 1 = full redraw.
   *  0.4 is a good default: preserves composition, allows colour/texture
   *  adjustments. */
  strength?: number
}

/** Same shape as DiffusionGenerateImageResponse — callers can treat them
 *  interchangeably when storing / displaying the last-result metadata. */
export type DiffusionEditImageResponse = DiffusionGenerateImageResponse
