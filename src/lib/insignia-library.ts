/**
 * insignia-library — curated WWII-era insignia metadata.
 *
 * SVG assets live in `public/insignia/` and are referenced by relative URL
 * from the public root (e.g. `/insignia/iron-cross.svg`).
 *
 * All symbols are clean geometric reproductions of public-domain historical
 * shapes — no copyrighted artwork is referenced.
 */

export interface InsigniaEntry {
  id: string
  name: string
  faction: 'allies' | 'soviet' | 'axis-okw' | 'axis-oh' | 'generic'
  era: 'wwii'
  /** Relative URL — resolves from the Vite public root. */
  url: string
  /** Short alt-text description. */
  description: string
}

export const INSIGNIA_LIBRARY: InsigniaEntry[] = [
  // ── Axis / OKW ────────────────────────────────────────────────────────────
  {
    id: 'iron-cross',
    name: 'Iron Cross',
    faction: 'axis-oh',
    era: 'wwii',
    url: '/insignia/iron-cross.svg',
    description: 'Classic four-armed cross; used on German armour.',
  },
  {
    id: 'iron-cross-2',
    name: 'Iron Cross (Bordered)',
    faction: 'axis-okw',
    era: 'wwii',
    url: '/insignia/iron-cross-bordered.svg',
    description: 'Iron cross with white and black border bands.',
  },
  {
    id: 'balkenkreuz',
    name: 'Balkenkreuz',
    faction: 'axis-oh',
    era: 'wwii',
    url: '/insignia/balkenkreuz.svg',
    description: 'Wehrmacht straight-bar cross marking.',
  },
  {
    id: 'axis-triangle',
    name: 'Tactical Triangle',
    faction: 'axis-okw',
    era: 'wwii',
    url: '/insignia/axis-triangle.svg',
    description: 'Solid equilateral triangle tactical marker.',
  },

  // ── Soviet ───────────────────────────────────────────────────────────────
  {
    id: 'soviet-star',
    name: 'Soviet Star',
    faction: 'soviet',
    era: 'wwii',
    url: '/insignia/soviet-star.svg',
    description: 'Five-pointed red star with white border; Red Army marking.',
  },
  {
    id: 'soviet-star-plain',
    name: 'Soviet Star (Plain)',
    faction: 'soviet',
    era: 'wwii',
    url: '/insignia/soviet-star-plain.svg',
    description: 'Five-pointed star, no border.',
  },
  {
    id: 'guards-badge',
    name: 'Guards Badge',
    faction: 'soviet',
    era: 'wwii',
    url: '/insignia/guards-badge.svg',
    description: 'Geometric shield silhouette for elite Guards units.',
  },

  // ── Allied ────────────────────────────────────────────────────────────────
  {
    id: 'allied-star',
    name: 'Allied Star',
    faction: 'allies',
    era: 'wwii',
    url: '/insignia/allied-star.svg',
    description: 'Five-pointed star inscribed in a circle; US/Allied roundel.',
  },
  {
    id: 'roundel-raf',
    name: 'RAF Roundel',
    faction: 'allies',
    era: 'wwii',
    url: '/insignia/roundel-raf.svg',
    description: 'Three-ring concentric roundel (blue / white / red).',
  },
  {
    id: 'allied-diamond',
    name: 'Allied Diamond',
    faction: 'allies',
    era: 'wwii',
    url: '/insignia/allied-diamond.svg',
    description: 'Rotated square (lozenge) divisional marking.',
  },

  // ── Chevrons (generic rank / squad markers) ──────────────────────────────
  {
    id: 'chevron-1',
    name: 'Chevron ×1',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/chevron-1.svg',
    description: 'Single arrow chevron — lance corporal rank stripe.',
  },
  {
    id: 'chevron-2',
    name: 'Chevron ×2',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/chevron-2.svg',
    description: 'Double arrow chevron — corporal rank stripe.',
  },
  {
    id: 'chevron-3',
    name: 'Chevron ×3',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/chevron-3.svg',
    description: 'Triple arrow chevron — sergeant rank stripe.',
  },

  // ── Kill tallies ──────────────────────────────────────────────────────────
  {
    id: 'kill-tally-1',
    name: 'Kill Tally ×1',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/kill-tally-1.svg',
    description: 'Single vertical bar kill tally mark.',
  },
  {
    id: 'kill-tally-5',
    name: 'Kill Tally ×5',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/kill-tally-5.svg',
    description: 'Five-bar kill tally (four vertical, one diagonal).',
  },

  // ── Bortnummer digits 0–9 ─────────────────────────────────────────────────
  {
    id: 'numeral-0',
    name: 'Numeral 0',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-0.svg',
    description: 'Stencilled vehicle number digit 0.',
  },
  {
    id: 'numeral-1',
    name: 'Numeral 1',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-1.svg',
    description: 'Stencilled vehicle number digit 1.',
  },
  {
    id: 'numeral-2',
    name: 'Numeral 2',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-2.svg',
    description: 'Stencilled vehicle number digit 2.',
  },
  {
    id: 'numeral-3',
    name: 'Numeral 3',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-3.svg',
    description: 'Stencilled vehicle number digit 3.',
  },
  {
    id: 'numeral-4',
    name: 'Numeral 4',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-4.svg',
    description: 'Stencilled vehicle number digit 4.',
  },
  {
    id: 'numeral-5',
    name: 'Numeral 5',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-5.svg',
    description: 'Stencilled vehicle number digit 5.',
  },
  {
    id: 'numeral-6',
    name: 'Numeral 6',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-6.svg',
    description: 'Stencilled vehicle number digit 6.',
  },
  {
    id: 'numeral-7',
    name: 'Numeral 7',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-7.svg',
    description: 'Stencilled vehicle number digit 7.',
  },
  {
    id: 'numeral-8',
    name: 'Numeral 8',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-8.svg',
    description: 'Stencilled vehicle number digit 8.',
  },
  {
    id: 'numeral-9',
    name: 'Numeral 9',
    faction: 'generic',
    era: 'wwii',
    url: '/insignia/numerals-9.svg',
    description: 'Stencilled vehicle number digit 9.',
  },
]

// ── Query helper ─────────────────────────────────────────────────────────────

/** Filter the library by any subset of InsigniaEntry fields (equality match). */
export function findInsignia(predicate: Partial<InsigniaEntry>): InsigniaEntry[] {
  return INSIGNIA_LIBRARY.filter(entry =>
    (Object.keys(predicate) as Array<keyof InsigniaEntry>).every(
      key => entry[key] === predicate[key],
    ),
  )
}
