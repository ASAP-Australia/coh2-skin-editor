/**
 * Vehicle catalog — every CoH2 vehicle the editor knows about, keyed by
 * the entity ID Relic uses on disk (matches art/armies/faction/vehicles/id/).
 *
 * Auto-detection plan: when the user's CoH2 install is connected, we scan
 * the SGAs once at startup, list every art/armies/faction/vehicles/id/file.rgm
 * we can find, and intersect with this catalog. Vehicles in the catalog
 * but missing from the install are dimmed in the UI; vehicles in the install
 * not in the catalog get a generic entry. This file just gives us nice
 * display names + class/tac defaults.
 */

export type Faction = 'german' | 'west_german' | 'soviet' | 'aef' | 'british'
export type VehicleClass = 'heavy' | 'medium' | 'light' | 'utility' | 'super_heavy'

/**
 * Toughness rank for sorting vehicles heaviest → lightest (lower = tougher).
 * Used by vehiclesForFaction to produce a stable heavy-first ordering.
 */
export const WEIGHT_RANK: Record<VehicleClass, number> = {
  super_heavy: 0,
  heavy:       1,
  medium:      2,
  light:       3,
  utility:     4,
}

export interface VehicleSpec {
  /** Filesystem id — matches `art/armies/<faction>/vehicles/<id>/<id>.rgm` */
  id: string
  faction: Faction
  displayName: string
  /** Used for the inventory icon grid grouping. */
  class: VehicleClass
  /** Default tactical number (3-digit Wehrmacht style). User-editable. */
  defaultTac: string
}

const V = (
  id: string, faction: Faction, displayName: string,
  cls: VehicleClass, defaultTac: string,
): VehicleSpec => ({ id, faction, displayName, class: cls, defaultTac })

export const VEHICLES: VehicleSpec[] = [
  // OstHeer (German Eastern Front army)
  V('tiger',                'german', 'Tiger I',          'heavy',       '211'),
  V('elefant',              'german', 'Elefant',          'super_heavy', '231'),
  V('brummbar',             'german', 'Brummbär',         'heavy',       '131'),
  V('stug_iii',             'german', 'StuG III',         'medium',      '141'),
  V('ostwind_flak_panzer',  'german', 'Ostwind',          'medium',      '171'),
  V('panzerwerfer',         'german', 'Panzerwerfer',     'medium',      '181'),
  V('halftrack',            'german', 'Sd.Kfz. 251',      'utility',     '151'),
  V('sdkfz_250',            'german', 'Sd.Kfz. 250',      'utility',     '152'),
  V('sdkfz_222',            'german', 'Sd.Kfz. 222',      'light',       '162'),
  V('opel_blitz',           'german', 'Opel Blitz',        'utility',     '191'),

  // OKW (Oberkommando West, Western Front)
  V('king_tiger_sdkfz_182',     'west_german', 'King Tiger',      'super_heavy', '311'),
  V('jagdtiger',                'west_german', 'Jagdtiger',       'super_heavy', '321'),
  V('sturmtiger',               'west_german', 'Sturmtiger',      'heavy',       '331'),
  V('panther_ausf_g',           'west_german', 'Panther',         'heavy',       '221'),
  V('jagdpanzer_iv_sdkfz_162',  'west_german', 'Jagdpanzer IV',   'medium',      '241'),
  V('panzer_iv_sdkfz_ausf_i',   'west_german', 'Panzer IV',       'medium',      '121'),
  V('hetzer',                   'west_german', 'Hetzer',          'medium',      '143'),
  V('puma_sdkfz_234',           'west_german', 'Puma',            'light',       '161'),
  V('panzer_ii_luchs_sdkfz_123','west_german', 'Luchs',           'light',       '163'),
  V('kubelwagen',               'west_german', 'Kübelwagen',      'utility',     '164'),
  V('halftrack_sdkfz_251',           'west_german', 'Sd.Kfz. 251',        'utility', '165'),
  V('halftrack_sdkfz_251_flak',      'west_german', 'Sd.Kfz. 251 Flak',   'utility', '166'),
  V('halftrack_sdkfz_251_infrared',  'west_german', 'Sd.Kfz. 251 IR',     'utility', '167'),

  // Soviet
  V('is2m_heavy_tank',     'soviet', 'IS-2',             'heavy',  'A11'),
  V('isu152',              'soviet', 'ISU-152',          'super_heavy', 'A21'),
  V('kv1_heavy_tank',      'soviet', 'KV-1',             'heavy',  'A12'),
  V('kv2_heavy_tank',      'soviet', 'KV-2',             'heavy',  'A13'),
  V('t34_76',              'soviet', 'T-34/76',          'medium', 'B11'),
  V('t_34_85',             'soviet', 'T-34/85',          'medium', 'B12'),
  V('t70m_light_tank',     'soviet', 'T-70',             'light',  'C11'),
  V('su85',                'soviet', 'SU-85',            'medium', 'B21'),
  V('su-76m',              'soviet', 'SU-76M',           'medium', 'C21'),
  V('m3a1_scout_car',      'soviet', 'M3A1 Scout',       'light',  'D11'),
  // Soviet Lend-Lease halftrack — shares the 'halftrack' id with the
  // German Sd.Kfz. 251. findVehicleSpec uses faction hints to disambiguate.
  V('halftrack',                 'soviet', 'Lend-Lease Truck',    'utility', 'D12'),
  V('us6_truck',                 'soviet', 'US6 Studebaker',      'utility', 'D13'),

  // USF (Allied Expeditionary Force / US Forces)
  V('m26_pershing',           'aef', 'Pershing',         'heavy',       'A11'),
  V('m4a3e8_sherman_easy_8',  'aef', 'Easy 8',           'medium',      'B11'),
  V('m4a3_sherman_76mm',      'aef', 'Sherman 76mm',     'medium',      'B12'),
  V('m4a1_sherman_calliope',  'aef', 'Calliope',         'medium',      'B13'),
  V('m10_tank_destroyer',     'aef', 'M10 Wolverine',    'medium',      'B21'),
  V('m36_tank_destroyer',     'aef', 'M36 Jackson',      'medium',      'B22'),
  V('m5a1_stuart',            'aef', 'M5 Stuart',        'light',       'C11'),
  V('m8_greyhound',           'aef', 'Greyhound',        'light',       'C12'),
  V('m7b1_priest',            'aef', 'Priest',           'medium',      'B31'),
  V('m3_halftrack',           'aef', 'M3 Halftrack',     'utility',     'D11'),
  V('m15a1_aa_halftrack',     'aef', 'AA Halftrack',     'utility',     'D12'),
  V('m8a1_hmc',               'aef', 'M8 Scott',         'medium',      'B32'),
  V('m20_utility_car',        'aef', 'M20',              'light',       'C13'),
  V('m21_mortar_halftrack',   'aef', 'M21 Mortar HT',    'utility',     'D13'),
  V('dodge_wc51',             'aef', 'Dodge WC51',       'utility',     'D14'),
  V('dodge_wc54_ambulance',   'aef', 'WC54 Ambulance',   'utility',     'D15'),
  V('sherman_m4a3',           'aef', 'M4A3 Sherman',     'medium',      'B33'),

  // UKF (British Forces)
  V('churchill',        'british', 'Churchill',       'heavy',  'A11'),
  V('comet',            'british', 'Comet',           'medium', 'A12'),
  V('cromwell',         'british', 'Cromwell',        'medium', 'B11'),
  V('centaur',          'british', 'Centaur AA',      'medium', 'B21'),
  V('sherman_firefly',  'british', 'Firefly',         'medium', 'B12'),
  V('valentine',        'british', 'Valentine',       'light',  'C11'),
  V('sexton',           'british', 'Sexton SPG',      'medium', 'D11'),
  V('aec_armoured_car', 'british', 'AEC Armoured Car', 'light', 'C12'),
  V('bren_carrier',     'british', 'Universal Carrier', 'utility', 'D12'),
]

export const FACTIONS: { id: Faction; label: string }[] = [
  { id: 'german',       label: 'OstHeer' },
  { id: 'west_german',  label: 'OKW' },
  { id: 'soviet',       label: 'Soviet' },
  { id: 'aef',          label: 'USF' },
  { id: 'british',      label: 'UKF' },
]

/**
 * On-disk folder name alias for vehicles whose `id` does NOT match the real
 * game folder under `art/armies/<faction>/vehicles/<folder>/`.
 *
 * Key   = vehicles.ts id (never changes — ripples through project state / UI)
 * Value = real game folder name, confirmed from official Relic SGA archives
 *   centaur   → centaur_aa        (ArtBritish:   vehicles/centaur_aa/…)
 *   t_34_85   → t34_85            (ArtSovietEF:  vehicles/t34_85/…)
 *   valentine → valentine_command (ArtBritish:   vehicles/valentine_command/…)
 *
 * Lives here (not mod-export) so the mesh loader can use it without a circular
 * import; mod-export re-exports it for existing callers.
 */
export const VEHICLE_FOLDER_ALIAS: Record<string, string> = {
  centaur:   'centaur_aa',
  t_34_85:   't34_85',
  valentine: 'valentine_command',
}

/** Returns the real on-disk folder name for a vehicle id. */
export function vehicleFolder(vehicleId: string): string {
  return VEHICLE_FOLDER_ALIAS[vehicleId] ?? vehicleId
}

export function rgmPath(v: VehicleSpec): string {
  // CoH2 convention is `<folder>/<folder>.rgm`. Use the real on-disk folder
  // (alias-corrected) for BOTH the directory and the mesh basename, otherwise
  // centaur / valentine / t_34_85 fail to load (their folders differ from id).
  const folder = vehicleFolder(v.id)
  return `art/armies/${v.faction}/vehicles/${folder}/${folder}.rgm`
}

/**
 * Look up a vehicle by id, optionally biased toward a set of faction hints.
 *
 * When a vehicle id is shared across factions (e.g. `halftrack` appears for
 * both `german` and `soviet`), the plain `VEHICLES.find(v => v.id === id)`
 * call always returns the first catalogue entry (german). Callers that know
 * the project's faction context should pass `factionHints` so the correct
 * entry is returned.
 *
 * Behaviour:
 *   1. If exactly one match exists, return it regardless of hints.
 *   2. If multiple matches exist and hints are provided, prefer the first
 *      match whose faction is in the hint set.
 *   3. If hints don't narrow to a unique match (or are absent/empty), fall
 *      back to the first catalogue match.
 *   4. Returns `undefined` when the id is not in the catalogue at all.
 */
export function findVehicleSpec(id: string, factionHints?: Faction[]): VehicleSpec | undefined {
  const matches = VEHICLES.filter(v => v.id === id)
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]
  // Multiple matches — use faction hints to pick the right one.
  if (factionHints && factionHints.length > 0) {
    const hinted = matches.find(v => factionHints.includes(v.faction))
    if (hinted) return hinted
  }
  // Fall back to first-match (catalogue ordering).
  return matches[0]
}

/**
 * Returns the vehicles for a given faction sorted toughest→weakest
 * (super_heavy first, utility last). Relative order within the same class
 * is preserved from the canonical VEHICLES array (stable sort).
 *
 * Use this everywhere a per-faction vehicle list is needed so the
 * heavy-first ordering is applied consistently.
 */
export function vehiclesForFaction(faction: Faction): VehicleSpec[] {
  return VEHICLES
    .filter(v => v.faction === faction)
    .sort((a, b) => WEIGHT_RANK[a.class] - WEIGHT_RANK[b.class])
}

/**
 * Safe starting vehicle per faction — the toughest renderable vehicle
 * (first entry of vehiclesForFaction not in BROKEN_MODELS, exported from
 * Editor.tsx). Computed here so Editor.tsx, TopBar.tsx and any future
 * consumer stay in sync with the sort order automatically.
 *
 * BROKEN_MODELS (vehicles whose RGM parses to 0 submeshes → empty viewport)
 * is threaded in as a parameter so this pure library file doesn't depend on
 * Editor.tsx or any runtime state. Pass the set at import time if you need
 * the default to skip broken models; pass an empty set to get the raw
 * toughest vehicle.
 */
export function defaultVehicleForFaction(faction: Faction, brokenModels: Set<string>): string {
  const sorted = vehiclesForFaction(faction)
  const first = sorted.find(v => !brokenModels.has(v.id))
  // fallback: if every vehicle were somehow broken, return the first in list
  return (first ?? sorted[0]).id
}

/**
 * Infer the set of factions present in a project from its vehicle ids.
 *
 * Only ids that map to a UNIQUE faction in the catalogue contribute; ambiguous
 * ids (those shared by multiple factions, like `halftrack`) are ignored unless
 * the project also contains unambiguous ids that resolve the faction. The
 * return value is the de-duplicated list of factions found, sorted
 * alphabetically for stable output.
 *
 * This is used by mod-export.ts to build the `factionHints` argument for
 * `findVehicleSpec` so that shared-id halftracks and similar are routed to
 * the right faction archive path.
 */
export function inferProjectFactions(vehicleIds: string[]): Faction[] {
  const factionSet = new Set<Faction>()
  for (const id of vehicleIds) {
    const matches = VEHICLES.filter(v => v.id === id)
    // Only unambiguous ids contribute — ambiguous ones would wrongly bias
    // the result toward whichever faction appears first in the catalogue.
    if (matches.length === 1) {
      factionSet.add(matches[0].faction)
    }
  }
  return Array.from(factionSet).sort()
}
