/**
 * Decal template library — bundled WWII insignia stamps the user can drop
 * onto a tank in one click. Each template ships as an inline SVG (gzips
 * well in the JS bundle, scales without artefacts on the 2048² atlas) and
 * is materialised into the project's image library lazily, the first
 * time the user picks it.
 *
 * Adding a template:
 *   1. Append a new entry below with id, faction tag, displayName, svg.
 *   2. Keep the SVG square, transparent background, single viewBox.
 *   3. Default visual size is ~150 px on the atlas — sketch your art
 *      to read clearly at that scale (no hairline strokes < 4 SVG units).
 *
 * NOTE: We do NOT include CoH2 stock vinyls (these are Relic IP). All
 * templates here are clean redraws of public-domain WWII national
 * insignia.
 */

import type { Faction } from './vehicles'

export interface DecalTemplate {
  id: string
  /** Faction this template is conventionally used by — drives ordering
   *  and the small badge in the picker. 'any' = neutral / cross-faction. */
  faction: Faction | 'any'
  displayName: string
  /** Inline SVG. Must include xmlns; we wrap it in a data URL. */
  svg: string
}

// ─────────────────────────────────────────────────────────────────────────
// SVG primitives — kept inline so the lib file is one self-contained unit.
// All artwork is square viewBox 0 0 100 100. White / colourful so they read
// against the typical olive-drab / grey-camo background of vanilla tanks.
// ─────────────────────────────────────────────────────────────────────────

const balkenkreuz = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g stroke="#0b0b0b" stroke-width="3" fill="#f7f3e8">
    <polygon points="10,40 40,40 40,10 60,10 60,40 90,40 90,60 60,60 60,90 40,90 40,60 10,60" />
  </g>
</svg>`.trim()

const ironCross = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g fill="#111111" stroke="#f5f5f0" stroke-width="3" stroke-linejoin="miter">
    <path d="M50,8 L62,32 86,32 70,50 86,68 62,68 50,92 38,68 14,68 30,50 14,32 38,32 Z" />
  </g>
</svg>`.trim()

const sovietRedStar = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <polygon points="50,6 61,38 95,38 67,58 78,92 50,72 22,92 33,58 5,38 39,38"
           fill="#c8161d" stroke="#5a0a0e" stroke-width="2.5" stroke-linejoin="miter" />
</svg>`.trim()

const sovietHammerSickle = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g fill="#f0c64a" stroke="#5a4818" stroke-width="2">
    <!-- sickle arc -->
    <path d="M22 70 Q12 40 50 30 Q72 28 82 50 Q60 36 38 50 Q26 60 32 74 Z" />
    <!-- hammer handle -->
    <rect x="55" y="32" width="6" height="44" transform="rotate(35 58 54)" />
    <!-- hammer head -->
    <rect x="60" y="22" width="22" height="10" rx="2" transform="rotate(35 71 27)" />
  </g>
</svg>`.trim()

const usStar = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g>
    <circle cx="50" cy="50" r="44" fill="#f7f5ee" stroke="#1c1c1c" stroke-width="2.5" />
    <polygon points="50,15 60,42 88,42 65,58 74,86 50,68 26,86 35,58 12,42 40,42"
             fill="#1c1c1c" />
  </g>
</svg>`.trim()

const britishRoundel = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="44" fill="#003a78" />
  <circle cx="50" cy="50" r="29" fill="#f5f3e7" />
  <circle cx="50" cy="50" r="14" fill="#b41b1f" />
</svg>`.trim()

// P3 — Hungarian national marking: white Greek cross on black square.
// The Kereszt (Hungarian Cross) used by Royal Hungarian Army (Honvédség)
// on Panzer III/IV-class vehicles, 1942–1944. Hull sides + engine deck only.
// NOT the German Balkenkreuz — this is a centred Greek (equilateral) cross
// with equal arm widths, inside a solid black square, white filled cross.
const hungarianKeresztSmall = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="0" y="0" width="100" height="100" fill="#0d0d0d" />
  <polygon points="35,10 65,10 65,35 90,35 90,65 65,65 65,90 35,90 35,65 10,65 10,35 35,35"
           fill="#f0ece0" />
</svg>`.trim()

// P3 — White stencil tactical number for Honved vehicles.
// Rendered as an SVG with a configurable 3-digit number; default 321.
// Position: turret sides in-game. White text, black outline.
const hunvedTacNumber = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
  <text x="50" y="48" text-anchor="middle"
        font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="52"
        fill="#f0ece0" stroke="#0d0d0d" stroke-width="5" paint-order="stroke fill"
        letter-spacing="2">321</text>
</svg>`.trim()

const skull = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g fill="#f5f3e8" stroke="#1a1a1a" stroke-width="2">
    <ellipse cx="50" cy="42" rx="30" ry="32" />
    <rect x="36" y="70" width="28" height="14" rx="2" />
    <circle cx="38" cy="46" r="6.5" fill="#1a1a1a" stroke="none" />
    <circle cx="62" cy="46" r="6.5" fill="#1a1a1a" stroke="none" />
    <polygon points="50,58 45,68 55,68" fill="#1a1a1a" stroke="none" />
    <rect x="40" y="76" width="4" height="6" fill="#1a1a1a" stroke="none" />
    <rect x="48" y="76" width="4" height="6" fill="#1a1a1a" stroke="none" />
    <rect x="56" y="76" width="4" height="6" fill="#1a1a1a" stroke="none" />
  </g>
</svg>`.trim()

const lightningBolts = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g fill="#f5f3e8" stroke="#0b0b0b" stroke-width="2.5" stroke-linejoin="miter">
    <polygon points="20,82 40,40 28,40 38,18 28,18 16,52 28,52" />
    <polygon points="60,82 80,40 68,40 78,18 68,18 56,52 68,52" />
  </g>
</svg>`.trim()

const star5White = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <polygon points="50,8 60,38 92,38 66,57 76,90 50,70 24,90 34,57 8,38 40,38"
           fill="#f7f3e6" stroke="#1c1c1c" stroke-width="2.5" stroke-linejoin="miter" />
</svg>`.trim()

const star5Yellow = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <polygon points="50,8 60,38 92,38 66,57 76,90 50,70 24,90 34,57 8,38 40,38"
           fill="#f0c64a" stroke="#4a3a10" stroke-width="2.5" stroke-linejoin="miter" />
</svg>`.trim()

// ─────────────────────────────────────────────────────────────────────────
// Template catalog. Ordering inside each faction roughly tracks frequency
// of historical use (most common first).
// ─────────────────────────────────────────────────────────────────────────

export const DECAL_TEMPLATES: DecalTemplate[] = [
  { id: 'tmpl_balkenkreuz', faction: 'german', displayName: 'Balkenkreuz', svg: balkenkreuz },
  { id: 'tmpl_iron_cross', faction: 'german', displayName: 'Iron Cross', svg: ironCross },
  // P3 — Honved national markings (scoped to german faction — hull sides + engine deck placement)
  {
    id: 'tmpl_honved_kereszt',
    faction: 'german',
    displayName: 'Hungarian Kereszt (Honved)',
    svg: hungarianKeresztSmall,
  },
  {
    id: 'tmpl_honved_tac_number',
    faction: 'german',
    displayName: 'Honved Tactical Number',
    svg: hunvedTacNumber,
  },
  {
    id: 'tmpl_lightning_bolts',
    faction: 'west_german',
    displayName: 'Lightning Bolts',
    svg: lightningBolts,
  },
  { id: 'tmpl_soviet_red_star', faction: 'soviet', displayName: 'Red Star', svg: sovietRedStar },
  {
    id: 'tmpl_hammer_sickle',
    faction: 'soviet',
    displayName: 'Hammer & Sickle',
    svg: sovietHammerSickle,
  },
  { id: 'tmpl_us_invasion_star', faction: 'aef', displayName: 'Invasion Star', svg: usStar },
  { id: 'tmpl_brit_roundel', faction: 'british', displayName: 'RAF Roundel', svg: britishRoundel },
  { id: 'tmpl_skull', faction: 'any', displayName: 'Skull', svg: skull },
  { id: 'tmpl_star_white', faction: 'any', displayName: 'Star (White)', svg: star5White },
  { id: 'tmpl_star_yellow', faction: 'any', displayName: 'Star (Yellow)', svg: star5Yellow },
]

/** Reorders templates so the active faction's stamps appear first, then
 *  neutral, then the rest. Stable within each bucket. */
export function templatesForFaction(faction: Faction): DecalTemplate[] {
  const own: DecalTemplate[] = []
  const neutral: DecalTemplate[] = []
  const other: DecalTemplate[] = []
  for (const t of DECAL_TEMPLATES) {
    if (t.faction === faction) own.push(t)
    else if (t.faction === 'any') neutral.push(t)
    else other.push(t)
  }
  return [...own, ...neutral, ...other]
}

/** Convert an inline SVG string to a data URL the editor's image
 *  library can consume directly. Uses btoa(unicode-safe) so non-ASCII
 *  artwork (rare here, but future-proof) doesn't blow up. */
export function templateToDataUrl(svg: string): string {
  // Encode UTF-8 bytes into base64 — handles any non-Latin glyph we
  // might add later. encodeURIComponent → escape → btoa is the
  // canonical "btoa unicode-safe" recipe.
  const utf8 = unescape(encodeURIComponent(svg))
  return `data:image/svg+xml;base64,${btoa(utf8)}`
}
