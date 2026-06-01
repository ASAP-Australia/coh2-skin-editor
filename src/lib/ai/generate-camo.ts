/**
 * AI-assisted CamoPreset generator.
 *
 * The model picks PARAMETERS (style, colours, scale, blur) for the
 * already-existing procedural `generateCamo` renderer in
 * `lib/camo-generator.ts`. We never ask the model to render pixels —
 * that would cost 20–50× more and require an image-gen API.
 *
 * Flow:
 *   1. Build system + user prompts that describe the CamoPreset schema
 *      and the user's intent (faction, season, vehicle name, prompt).
 *   2. Call main-process AI bridge.
 *   3. Strip code fences, parse JSON, clamp values to schema bounds.
 *   4. Return a CamoPreset the caller can hand to `applyCamo`.
 */

import type { CamoPreset, CamoStyle } from '../camo-generator'

const VALID_STYLES: CamoStyle[] = ['softBlobs', 'hardEdge', 'whitewash', 'stripes']

const SYSTEM_PROMPT = `You design Company of Heroes 2 vehicle camouflage by emitting parameter
objects for a procedural renderer. Reply with EXACTLY ONE valid JSON
object — no prose, no markdown fences, no extra keys.

Schema:
{
  "style":    "softBlobs" | "hardEdge" | "whitewash" | "stripes",
  "colors":   [string, string, string],   // 3 hex colours "#rrggbb", base + 2 disruptors
  "scale":    number,                     // 0.5–2.0  (smaller = denser pattern)
  "rotation": number,                     // -90 to 90 degrees
  "blur":     number,                     // 0–30 px   (0 = hard edge)
  "label":    string                      // short human name (≤32 chars)
}

Guidance:
- "softBlobs" = WWII three-tone organic patches with soft edges (blur 12–22).
- "hardEdge"  = ambush-style angular patches, no blur (blur 0–2).
- "whitewash" = mostly white/grey with the under-coat peeking through;
                use light first colour (#dcdcd0..#eee8e0), keep the
                other two as the under-paint that shows through.
- "stripes"   = parallel bands; use rotation to angle them.
- Match faction conventions: Wehrmacht uses dunkelgelb (#c4a55a) + red-
  brown (#6a3a1e) + olive (#3e5228). Soviets prefer 4BO green (#556b3a)
  + olive (#2c3c22). US olive drab (#4a5c30). British Caunter or SCC15.
- Winter overrides palette toward whitewash; summer keeps mud/olive
  tones; autumn pulls in browns + ochres.
- Pick a "label" that reads like a real historical pattern, e.g.
  "Dunkelgelb 3-tone", "Soviet 4BO field", "Whitewashed Tiger".`

interface GenerateCamoCtx {
  faction: string
  season: 'summer' | 'winter'
  vehicleName: string
  prompt: string
}

function buildUserPrompt(ctx: GenerateCamoCtx): string {
  const { faction, season, vehicleName, prompt } = ctx
  return [
    `Faction: ${faction}`,
    `Season: ${season}`,
    `Vehicle: ${vehicleName}`,
    `User request: ${prompt || '(no extra detail — pick something appropriate for the faction and season)'}`,
    '',
    'Return one JSON object matching the schema. No prose.',
  ].join('\n')
}

/** Strip ```json ... ``` or ``` ... ``` fences if the model added them
 *  despite the instructions. */
function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function isHex(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)
}

/** Coerce loose model output into a strict CamoPreset. Throws on
 *  fundamentally-broken input so the caller can surface "AI returned
 *  garbage" rather than silently applying defaults. */
function coerce(raw: unknown): CamoPreset {
  if (!raw || typeof raw !== 'object') throw new Error('AI output not an object')
  const r = raw as Record<string, unknown>

  const style = (VALID_STYLES as string[]).includes(r.style as string)
    ? (r.style as CamoStyle)
    : 'softBlobs'

  let colors: [string, string, string]
  if (Array.isArray(r.colors) && r.colors.length >= 3 && r.colors.slice(0, 3).every(isHex)) {
    colors = [r.colors[0], r.colors[1], r.colors[2]] as [string, string, string]
  } else {
    throw new Error('AI output missing valid 3-hex colors array')
  }

  const scale = clamp(typeof r.scale === 'number' ? r.scale : 1.0, 0.5, 2.0)
  const rotation = clamp(typeof r.rotation === 'number' ? r.rotation : 0, -90, 90)
  const blur = clamp(typeof r.blur === 'number' ? r.blur : 12, 0, 30)

  const label =
    typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 48) : 'AI camo'

  return {
    style,
    colors,
    seed: Date.now() & 0xfffff,
    scale,
    rotation,
    blur,
    label,
  }
}

export interface GenerateCamoResult {
  preset: CamoPreset
  /** Provider + model echoed back so the UI can show "by Claude Haiku 4.5". */
  provider: string
  model: string
}

export async function generateCamoWithAi(ctx: GenerateCamoCtx): Promise<GenerateCamoResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('AI generation requires the Electron desktop build')
  }

  const reply = await window.electronAPI.ai.complete({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(ctx),
    maxTokens: 512,
    temperature: 0.5,
  })

  const cleaned = stripFences(reply.text)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    throw new Error(
      `AI returned non-JSON output: ${(e as Error).message}\n---\n${cleaned.slice(0, 400)}`,
      { cause: e },
    )
  }

  const preset = coerce(parsed)
  return { preset, provider: reply.provider, model: reply.model }
}

/** Refinement turn — the user has a generated preset and wants to nudge
 *  it ("less green", "make blobs smaller"). We embed the current preset
 *  in the user message so the model has full visibility into what it
 *  produced last time. Cheaper than carrying message history. */
export async function refineCamoWithAi(
  ctx: GenerateCamoCtx,
  currentPreset: CamoPreset,
  refinement: string,
): Promise<GenerateCamoResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('AI generation requires the Electron desktop build')
  }
  // Strip out the seed — model shouldn't fixate on / preserve it.
  const presetForModel = {
    style: currentPreset.style,
    colors: currentPreset.colors,
    scale: currentPreset.scale,
    rotation: currentPreset.rotation,
    blur: currentPreset.blur,
    label: currentPreset.label,
  }
  const userMsg = [
    buildUserPrompt(ctx),
    '',
    'Previous output (do not just repeat — modify per the refinement below):',
    JSON.stringify(presetForModel),
    '',
    `Refinement: ${refinement.trim() || 'pick a different interpretation in the same spirit'}`,
    '',
    'Return one JSON object matching the schema. No prose.',
  ].join('\n')

  const reply = await window.electronAPI.ai.complete({
    system: SYSTEM_PROMPT,
    user: userMsg,
    maxTokens: 512,
    // Slightly higher temperature than initial generation — refinement
    // should explore around the current preset, not collapse to it.
    temperature: 0.6,
  })

  const cleaned = stripFences(reply.text)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    throw new Error(
      `AI returned non-JSON output: ${(e as Error).message}\n---\n${cleaned.slice(0, 400)}`,
      { cause: e },
    )
  }
  const preset = coerce(parsed)
  return { preset, provider: reply.provider, model: reply.model }
}
