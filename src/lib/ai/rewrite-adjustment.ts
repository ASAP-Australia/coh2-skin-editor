/**
 * rewrite-adjustment.ts — optional Claude Haiku prompt rewriter.
 *
 * Takes a casual user adjustment string ("darker, more snow") and rewrites
 * it into a proper SDXL-style prompt phrase that will steer the diffusion
 * model more precisely ("dark muted palette, heavy snow camouflage, white
 * winter overlay, worn paint").
 *
 * Knows the canonical WWII camo glossary, so casual phrases like
 * "hinterhalt", "ambush", "erbsenmuster", "caunter", etc. get expanded to
 * their full technical descriptions even when the LoRA isn't loaded.
 *
 * Uses the existing `ai:complete` IPC channel — no new dependencies.
 * Model: claude-haiku-4-5 (~$0.0005/call). Toggleable via a checkbox in
 * the UI so users on a budget can skip it.
 *
 * If the Anthropic key is not set, or the call fails for any reason, the
 * function returns the original text unchanged so the caller always gets
 * something usable.
 */

// ── Embedded camo glossary ────────────────────────────────────────────────────
//
// Keep this in sync with training/dataset/camo-glossary.json. We embed it
// here as a TS literal (rather than importing the JSON) so the renderer
// bundle is fully self-contained and the rewriter works even when training
// assets aren't shipped.

const CAMO_GLOSSARY: Array<{
  aliases: string[]
  description: string
}> = [
  // ── German ─────────────────────────────────────────────────────────────────
  {
    aliases: ['dunkelgelb', 'dark yellow', 'ral 7028', 'wehrmacht base'],
    description:
      'Wehrmacht dunkelgelb base (RAL 7028, warm sandy ochre #c4a55a), matte hand-painted, 1943-1945',
  },
  {
    aliases: ['hinterhalt', 'ambush', 'hinterhalt-tarnung', 'ambush pattern'],
    description:
      'Hinterhalt ambush pattern, dunkelgelb base with red-brown and olive blotches plus overlaid contrasting dots, mid-1944 onwards',
  },
  {
    aliases: ['buntfarbenanstrich', 'buntfarben', '1927 pattern', 'wavy three-color'],
    description:
      'Buntfarbenanstrich three-colour wavy stripes in earth-brown, sand-yellow and olive-green, sprayed soft-edge diagonal bands, 1927-1937',
  },
  {
    aliases: ['splittermuster', 'splinter', 'splinter pattern', 'fragmentation'],
    description:
      'Splittermuster splinter pattern, hard-edge angular polygonal shapes in sand brown and dark green with overlaid rain-line streaks',
  },
  {
    aliases: ['sumpfmuster', 'sumpf 44', 'marsh pattern', 'marsh 44'],
    description:
      'Sumpf 44 marsh pattern, sand-tan base with olive-green and red-brown organic blotches, soft sprayed edges, 1943-1945',
  },
  {
    aliases: ['erbsenmuster', 'pea dot', 'pea-dot', 'ss pea dot', '44 dot'],
    description:
      'Waffen-SS Erbsenmuster pea-dot, dense five-colour spray of small organic dots in tan rust-brown olive dark-green ochre over a sand base, 1944 onwards',
  },
  {
    aliases: ['granittarnung', 'granite pattern'],
    description:
      'Granittarnung hard-edge angular granite pattern in light grey dark grey and earth-brown like crazed stone',
  },
  {
    aliases: ['norwegen-tarnung', 'norway dark'],
    description:
      'Norway theatre dark-green base RAL 6003 with sparse dunkelgelb counter-spots, very dark overall',
  },
  {
    aliases: ['panzergrau', 'panzer grey', 'ral 7021', 'dark grey'],
    description:
      'Panzergrau dark-grey base (RAL 7021, cool blue-grey #4a4d50), factory finish 1939-1943, often weathered with dust and rust streaks',
  },
  {
    aliases: ['dunkelgrau', 'dark grey two-tone'],
    description:
      'Two-tone Panzergrau over dunkelbraun, cool blue-grey with diagonal red-brown disruptor bands, pre-1943 European theatre',
  },

  // ── West German (OKW) ──────────────────────────────────────────────────────
  {
    aliases: ['okw', 'west german', 'late war german'],
    description:
      'OKW late-war dunkelgelb with prominent ambush disruptors, tan base with red-brown and olive blotches and overlaid dots, heavy weathering',
  },

  // ── Soviet ─────────────────────────────────────────────────────────────────
  {
    aliases: ['4bo', 'russian green', 'soviet green', 'protective green'],
    description:
      'Soviet 4BO protective green base, olive-tinged dark green #556b3a, matte hand-painted, standard 1941-1945',
  },
  {
    aliases: ['soviet two-tone', '4bo earth', 'russian two-tone'],
    description:
      'Two-tone Soviet, 4BO green base with irregular dark earth-brown blotches sprayed in organic shapes',
  },
  {
    aliases: ['soviet whitewash', 'russian winter', 'winter whitewash russian'],
    description:
      'Winter whitewash over 4BO, chalk-white overlay with 4BO green showing through in worn patches and around hardware, brush-applied',
  },
  {
    aliases: ['soviet three-tone', '1944 soviet', 'berlin offensive'],
    description:
      'Late-war Soviet three-tone, 4BO green base with sand-yellow and dark earth-brown blotches in large irregular shapes',
  },

  // ── AEF (US) ───────────────────────────────────────────────────────────────
  {
    aliases: ['olive drab', 'od 7', 'us olive drab', 'us olive', 'american olive'],
    description: 'US Army Olive Drab #7 base, cool muted green #4a5c30, matte finish',
  },
  {
    aliases: ['us pacific', 'pacific theatre', 'pacific sherman', 'marine sherman'],
    description:
      'Pacific theatre disruptor over OD, irregular dark green and earth-brown organic blotches, occasional black tiger-stripe overlays',
  },
  {
    aliases: ['bocage', 'normandy', 'us bocage'],
    description:
      'Normandy bocage disruptor, OD base with sparse dark earth-brown blotches, hedgerow tree-branch impressions in lighter green',
  },
  {
    aliases: ['us winter', 'ardennes', 'battle of the bulge', 'us whitewash'],
    description:
      'Ardennes winter whitewash over OD, chalk-white overlay with OD showing through around hardware, hasty brush application',
  },
  {
    aliases: ['mickey mouse sherman', 'mickey mouse', 'us disruptor'],
    description:
      'Mickey-Mouse Sherman disruptor, OD base with large rounded ear-shaped dark earth-brown blotches',
  },

  // ── British ────────────────────────────────────────────────────────────────
  {
    aliases: ['caunter', 'caunter scheme', 'north africa caunter'],
    description:
      'Caunter scheme three-colour hard-edge geometric pattern in light stone silver-grey and slate-blue, straight-edged bands at sharp angles, North African Desert 1940-1941',
  },
  {
    aliases: ['scc15', 'scc 15', 'british olive', '1944 british'],
    description:
      'British SCC15 olive drab base, warm olive #4d5635, matte hand-painted finish, 1944-1945',
  },
  {
    aliases: ['scc 2', 'scc2', 'service colour 2', 'khaki brown british'],
    description:
      'British SCC2 khaki-brown base, warm earth-brown #6e5a3c, pre-1944 standard finish',
  },
  {
    aliases: ['cromwell disruptor', 'mickey mouse british', 'uk disruptor'],
    description:
      'British disruptive Mickey-Mouse pattern, SCC15 base with large rounded dark black-green blotches',
  },
  {
    aliases: ['light mud', 'light mud dark mud', 'north africa disruptor'],
    description:
      'North African Light Mud / Dark Mud, sand-tan base with large irregular dark earth-brown blotches and soft sprayed edges',
  },
  {
    aliases: ['berlin brigade', '1945 british occupation'],
    description:
      'Berlin Brigade urban camo, SCC15 base with grey and black hard-edge geometric blotches, urban setting',
  },

  // ── Shared modifiers ───────────────────────────────────────────────────────
  {
    aliases: ['winter', 'whitewash', 'snow', 'snow camo'],
    description:
      'Winter whitewash overlay, mostly chalk-white with worn patches of base paint showing through around tools and hatches, brush-applied',
  },
  {
    aliases: ['disruptor', 'disruptive', 'blotch', 'blotches'],
    description:
      'Irregular organic disruptor blotches over the base colour, soft sprayed edges, 30-40% pattern coverage',
  },
  {
    aliases: ['stripes', 'striped', 'tiger stripe', 'diagonal stripes'],
    description:
      'Hand-painted diagonal stripes in a contrasting darker tone over the base, broad bands per panel',
  },
  {
    aliases: ['rain', 'rain lines', 'raindrop'],
    description:
      'Thin vertical rain-line streaks in a dark contrasting tone over the camo, breaking up large flat areas',
  },
  {
    aliases: ['dots', 'spotted', 'spot pattern'],
    description:
      'Small organic dot pattern in two contrasting tones over the base, dense like Erbsenmuster',
  },
  {
    aliases: ['diamonds', 'diamond', 'rhombus'],
    description:
      'Hard-edge diamond-shaped patches in 2-3 contrasting tones, tessellated like a quilt',
  },
  {
    aliases: ['worn', 'weathered', 'chipped'],
    description:
      'Heavily weathered paint, chips and scratches with exposed bare metal patches, dust and rust streaks running vertically from hardware',
  },
  {
    aliases: ['muddy', 'mud', 'dirty'],
    description:
      'Heavy mud splatter and dust accumulation along lower hull and around tracks, muting the base colour',
  },
  {
    aliases: ['field modified', 'field applied', 'improvised', 'ad-hoc camo'],
    description:
      'Hasty field-applied camouflage, irregular brush strokes, uneven coverage, no factory geometric pattern',
  },
]

/**
 * Detect any glossary alias mentioned in the user adjustment text and return
 * the matched canonical descriptions, deduplicated. We use a character class
 * boundary (rather than \b) because some aliases contain hyphens.
 */
function matchGlossary(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `
  const seen = new Set<string>()
  const hits: string[] = []
  for (const entry of CAMO_GLOSSARY) {
    for (const alias of entry.aliases) {
      const a = alias.toLowerCase()
      const pad = `[^a-z0-9]`
      const re = new RegExp(`${pad}${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${pad}`)
      if (re.test(lower)) {
        if (!seen.has(entry.description)) {
          seen.add(entry.description)
          hits.push(entry.description)
        }
        break
      }
    }
  }
  return hits
}

// ── System prompt ─────────────────────────────────────────────────────────────

const GLOSSARY_BLOCK = CAMO_GLOSSARY.map(e => `- ${e.aliases[0]}: ${e.description}`).join('\n')

const SYSTEM_PROMPT = `You are a Stable Diffusion XL prompt engineer specialising in WWII military
camouflage textures. The user gives you a casual adjustment phrase for a camo
pattern. Rewrite it into a concise, comma-separated SDXL prompt phrase
(10-25 words) that will steer the model precisely.

Rules:
- Start directly with the prompt words — no preamble, no explanation.
- Keep it short and specific: colour words, texture words, painting style.
- Preserve the user's intent exactly — if they say "darker" keep that mood.
- Do NOT add vehicle or background elements; this is a flat texture patch.
- If the user mentions a named WWII camo pattern from the glossary below,
  expand it to its full technical description (palette + style words).

WWII camo glossary (for expansion):
${GLOSSARY_BLOCK}

Examples:
  Input:  "darker, more snow"
  Output: "dark muted earth tones, heavy snow camouflage, white winter overlay, worn brushed paint"

  Input:  "ambush stripes"
  Output: "Hinterhalt ambush pattern, dunkelgelb base with red-brown and olive blotches plus overlaid contrasting dots, vertical brushstrokes"

  Input:  "rusty look"
  Output: "rust streaks, chipped paint, exposed bare metal, orange-brown oxidation patches"

  Input:  "caunter scheme"
  Output: "Caunter three-colour hard-edge geometric pattern in light stone, silver-grey and slate-blue, straight-edged bands at sharp angles"

  Input:  "ss pea dot for the panther"
  Output: "Waffen-SS Erbsenmuster pea-dot, dense five-colour spray of small organic dots in tan, rust-brown, olive, dark-green and ochre over a sand base"`

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Rewrite a casual adjustment phrase into an SDXL-friendly prompt fragment.
 * Returns the original `adjustment` unchanged if the AI call is unavailable
 * or fails — the caller should always proceed with the returned string.
 *
 * Even when the AI call is unavailable we apply a local glossary expansion
 * pass so casual phrases like "ambush" still get sent to the diffusion model
 * with the technical description appended.
 */
export async function rewriteAdjustment(adjustment: string): Promise<string> {
  if (!adjustment.trim()) return adjustment

  // Local glossary expansion fallback — always safe to apply.
  const glossaryHits = matchGlossary(adjustment)
  const expandedLocal =
    glossaryHits.length > 0
      ? `${adjustment.trim().replace(/[,\s]+$/, '')}, ${glossaryHits.join(', ')}`
      : adjustment

  if (typeof window === 'undefined' || !window.electronAPI) return expandedLocal

  try {
    const result = await window.electronAPI.ai.complete({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      system: SYSTEM_PROMPT,
      user: adjustment.trim(),
      maxTokens: 128,
      temperature: 0.3,
    })
    const rewritten = result.text.trim()
    return rewritten || expandedLocal
  } catch {
    // Key not set, network error, rate limit, etc. — fall back to local
    // glossary-expanded prompt (or original if no glossary hits).
    return expandedLocal
  }
}
