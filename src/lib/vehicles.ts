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

  // UKF (British Forces)
  V('churchill',        'british', 'Churchill',       'heavy',  'A11'),
  V('comet',            'british', 'Comet',           'medium', 'A12'),
  V('cromwell',         'british', 'Cromwell',        'medium', 'B11'),
  V('centaur',          'british', 'Centaur AA',      'medium', 'B21'),
  V('sherman_firefly',  'british', 'Firefly',         'medium', 'B12'),
  V('valentine',        'british', 'Valentine',       'light',  'C11'),
  V('sexton',           'british', 'Sexton SPG',      'medium', 'D11'),
]

export const FACTIONS: { id: Faction; label: string }[] = [
  { id: 'german',       label: 'OstHeer' },
  { id: 'west_german',  label: 'OKW' },
  { id: 'soviet',       label: 'Soviet' },
  { id: 'aef',          label: 'USF' },
  { id: 'british',      label: 'UKF' },
]

export function rgmPath(v: VehicleSpec): string {
  return `art/armies/${v.faction}/vehicles/${v.id}/${v.id}.rgm`
}
