/**
 * insignia-library — curated WWII-era insignia metadata.
 *
 * SVG assets live in `src/assets/insignia/` and are resolved through Vite's
 * asset pipeline via `import.meta.glob` (see `ASSET_URLS` below). This yields a
 * base-correct URL in BOTH the dev server (`/assets/…`) and the packaged
 * Electron build (`./assets/…` under `file://`). The previous absolute
 * `/insignia/x.svg` public-root URLs broke under `file://` — they resolved to
 * the filesystem root, so every thumbnail rendered as a broken image and
 * placing an insignia (which `fetch()`es the same URL) silently failed.
 *
 * All symbols are clean geometric reproductions of public-domain historical
 * shapes — no copyrighted artwork is referenced.
 */

/**
 * Bundled SVG URLs, keyed by bare filename (e.g. `iron-cross.svg`). Vite
 * rewrites each glob match to a hashed asset URL respecting `base` (`./`), so
 * these load under both the dev server and the packaged `file://` app.
 */
const ASSET_URLS = import.meta.glob<string>('../assets/insignia/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

/** Resolve a bare insignia filename to its bundled, base-correct asset URL. */
function insigniaUrl(file: string): string {
  const url = ASSET_URLS[`../assets/insignia/${file}`]
  if (!url) {
    // Should never happen: every `file` below has a matching asset. Fail loud
    // in dev so a typo is caught immediately rather than shipping a broken img.
    console.warn(`insignia-library: no bundled asset for "${file}"`)
    return ''
  }
  return url
}

export interface InsigniaEntry {
  id: string
  name: string
  faction: 'allies' | 'soviet' | 'axis-okw' | 'axis-oh' | 'generic'
  era: 'wwii'
  /**
   * Bare SVG filename in `src/assets/insignia/` (e.g. `iron-cross.svg`).
   * The bundled, base-correct URL is exposed as `url`.
   */
  file: string
  /**
   * Bundled asset URL (base-correct for dev + packaged `file://`), derived
   * from `file` via Vite's asset pipeline. Safe to use in `<img src>` and
   * `fetch()`.
   */
  url: string
  /** Short alt-text description. */
  description: string
}

/** Raw entry shape before `url` is resolved from `file`. */
type InsigniaSeed = Omit<InsigniaEntry, 'url'>

const INSIGNIA_SEEDS: InsigniaSeed[] = [
  // ── Axis / OKW ────────────────────────────────────────────────────────────
  {
    id: 'iron-cross',
    name: 'Iron Cross',
    faction: 'axis-oh',
    era: 'wwii',
    file: 'iron-cross.svg',
    description: 'Classic four-armed cross; used on German armour.',
  },
  {
    id: 'iron-cross-2',
    name: 'Iron Cross (Bordered)',
    faction: 'axis-okw',
    era: 'wwii',
    file: 'iron-cross-bordered.svg',
    description: 'Iron cross with white and black border bands.',
  },
  {
    id: 'balkenkreuz',
    name: 'Balkenkreuz',
    faction: 'axis-oh',
    era: 'wwii',
    file: 'balkenkreuz.svg',
    description: 'Wehrmacht straight-bar cross marking.',
  },
  {
    id: 'axis-triangle',
    name: 'Tactical Triangle',
    faction: 'axis-okw',
    era: 'wwii',
    file: 'axis-triangle.svg',
    description: 'Solid equilateral triangle tactical marker.',
  },

  // ── Soviet ───────────────────────────────────────────────────────────────
  {
    id: 'soviet-star',
    name: 'Soviet Star',
    faction: 'soviet',
    era: 'wwii',
    file: 'soviet-star.svg',
    description: 'Five-pointed red star with white border; Red Army marking.',
  },
  {
    id: 'soviet-star-plain',
    name: 'Soviet Star (Plain)',
    faction: 'soviet',
    era: 'wwii',
    file: 'soviet-star-plain.svg',
    description: 'Five-pointed star, no border.',
  },
  {
    id: 'guards-badge',
    name: 'Guards Badge',
    faction: 'soviet',
    era: 'wwii',
    file: 'guards-badge.svg',
    description: 'Geometric shield silhouette for elite Guards units.',
  },

  // ── Allied ────────────────────────────────────────────────────────────────
  {
    id: 'allied-star',
    name: 'Allied Star',
    faction: 'allies',
    era: 'wwii',
    file: 'allied-star.svg',
    description: 'Five-pointed star inscribed in a circle; US/Allied roundel.',
  },
  {
    id: 'roundel-raf',
    name: 'RAF Roundel',
    faction: 'allies',
    era: 'wwii',
    file: 'roundel-raf.svg',
    description: 'Three-ring concentric roundel (blue / white / red).',
  },
  {
    id: 'allied-diamond',
    name: 'Allied Diamond',
    faction: 'allies',
    era: 'wwii',
    file: 'allied-diamond.svg',
    description: 'Rotated square (lozenge) divisional marking.',
  },

  // ── Chevrons (generic rank / squad markers) ──────────────────────────────
  {
    id: 'chevron-1',
    name: 'Chevron ×1',
    faction: 'generic',
    era: 'wwii',
    file: 'chevron-1.svg',
    description: 'Single arrow chevron — lance corporal rank stripe.',
  },
  {
    id: 'chevron-2',
    name: 'Chevron ×2',
    faction: 'generic',
    era: 'wwii',
    file: 'chevron-2.svg',
    description: 'Double arrow chevron — corporal rank stripe.',
  },
  {
    id: 'chevron-3',
    name: 'Chevron ×3',
    faction: 'generic',
    era: 'wwii',
    file: 'chevron-3.svg',
    description: 'Triple arrow chevron — sergeant rank stripe.',
  },

  // ── Kill tallies ──────────────────────────────────────────────────────────
  {
    id: 'kill-tally-1',
    name: 'Kill Tally ×1',
    faction: 'generic',
    era: 'wwii',
    file: 'kill-tally-1.svg',
    description: 'Single vertical bar kill tally mark.',
  },
  {
    id: 'kill-tally-5',
    name: 'Kill Tally ×5',
    faction: 'generic',
    era: 'wwii',
    file: 'kill-tally-5.svg',
    description: 'Five-bar kill tally (four vertical, one diagonal).',
  },

  // ── Bortnummer digits 0–9 ─────────────────────────────────────────────────
  {
    id: 'numeral-0',
    name: 'Numeral 0',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-0.svg',
    description: 'Stencilled vehicle number digit 0.',
  },
  {
    id: 'numeral-1',
    name: 'Numeral 1',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-1.svg',
    description: 'Stencilled vehicle number digit 1.',
  },
  {
    id: 'numeral-2',
    name: 'Numeral 2',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-2.svg',
    description: 'Stencilled vehicle number digit 2.',
  },
  {
    id: 'numeral-3',
    name: 'Numeral 3',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-3.svg',
    description: 'Stencilled vehicle number digit 3.',
  },
  {
    id: 'numeral-4',
    name: 'Numeral 4',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-4.svg',
    description: 'Stencilled vehicle number digit 4.',
  },
  {
    id: 'numeral-5',
    name: 'Numeral 5',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-5.svg',
    description: 'Stencilled vehicle number digit 5.',
  },
  {
    id: 'numeral-6',
    name: 'Numeral 6',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-6.svg',
    description: 'Stencilled vehicle number digit 6.',
  },
  {
    id: 'numeral-7',
    name: 'Numeral 7',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-7.svg',
    description: 'Stencilled vehicle number digit 7.',
  },
  {
    id: 'numeral-8',
    name: 'Numeral 8',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-8.svg',
    description: 'Stencilled vehicle number digit 8.',
  },
  {
    id: 'numeral-9',
    name: 'Numeral 9',
    faction: 'generic',
    era: 'wwii',
    file: 'numerals-9.svg',
    description: 'Stencilled vehicle number digit 9.',
  },
]

/**
 * The curated insignia library. Each seed's `url` is resolved from its `file`
 * through Vite's asset pipeline so it loads in both the dev server and the
 * packaged Electron (`file://`) build.
 */
export const INSIGNIA_LIBRARY: InsigniaEntry[] = INSIGNIA_SEEDS.map(seed => ({
  ...seed,
  url: insigniaUrl(seed.file),
}))

// ── Query helper ─────────────────────────────────────────────────────────────

/** Filter the library by any subset of InsigniaEntry fields (equality match). */
export function findInsignia(predicate: Partial<InsigniaEntry>): InsigniaEntry[] {
  return INSIGNIA_LIBRARY.filter(entry =>
    (Object.keys(predicate) as Array<keyof InsigniaEntry>).every(
      key => entry[key] === predicate[key],
    ),
  )
}
