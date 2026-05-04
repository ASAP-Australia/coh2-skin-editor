/**
 * "Brigade Prinses Irene" comprehensive demo project. Loads a complete
 * skin pack for the Dutch Brigade across 19 OstHeer + OKW vehicles, with
 * every decal type used at sensible UV positions reverse-engineered from
 * the SS Totenkopf community pack (so they land at known-good hull-side /
 * turret-side / glacis positions).
 *
 * Use as a one-click starting point: load the demo, swap in your own
 * palette + name, place additional decals on top, save .coh2skin.
 */

import { newProject, type Coh2SkinProject, type Decal, type DecalType } from './project'

const VEHICLE_NAMES: Record<string, string> = {
  // OstHeer
  tiger: 'Wilhelmina',          elefant: 'Juliana',          brummbar: 'Beatrix',
  stug_iii: 'Margriet',         ostwind_flak_panzer: 'Marijke',
  panzerwerfer: 'Emma',         halftrack: 'Sophie',         sdkfz_250: 'Mathilde',
  sdkfz_222: 'Henriette',
  // OKW
  panther_ausf_g: 'Louise',     panzer_iv_sdkfz_ausf_i: 'Anna',
  king_tiger_sdkfz_182: 'Amalia', puma_sdkfz_234: 'Carolina',
  jagdtiger: 'Augusta',         jagdpanzer_iv_sdkfz_162: 'Christina',
  hetzer: 'Helena',             sturmtiger: 'Stephanie',
  panzer_ii_luchs_sdkfz_123: 'Marie', kubelwagen: 'Maria',
  // Soviet
  is2m_heavy_tank: 'Zhukov',    isu152: 'Katyusha',
  kv1_heavy_tank: 'Stalin',     kv2_heavy_tank: 'Leningrad',
  t34_76: 'Stalingrad',         t_34_85: 'Kursk',
  t70m_light_tank: 'Moskva',    su85: 'Pobeda',
  'su-76m': 'Iskra',            m3a1_scout_car: 'Razvedka',
  // USF
  m26_pershing: 'Iron Mike',    m4a3e8_sherman_easy_8: 'Easy Eight',
  m4a3_sherman_76mm: 'Fury',    m4a1_sherman_calliope: 'Thunderbolt',
  m10_tank_destroyer: 'Wolverine', m36_tank_destroyer: 'Jackson',
  m5a1_stuart: 'Lucky',         m8_greyhound: 'Speedy',
  m7b1_priest: 'Padre',         m3_halftrack: 'Dogface',
  m15a1_aa_halftrack: 'Flak Bait',
  // British
  churchill: 'Bulldog',         comet: 'Swift',
  cromwell: 'Desert Rat',       centaur: 'Avenger',
  sherman_firefly: 'Tulip',     valentine: 'Cupid',
  sexton: 'Romper',
}

const VEHICLE_KILLS: Record<string, number> = {
  // OstHeer
  tiger: 14, elefant: 11, brummbar: 7, stug_iii: 9,
  ostwind_flak_panzer: 4, panzerwerfer: 3, halftrack: 2,
  sdkfz_250: 2, sdkfz_222: 3,
  // OKW
  panther_ausf_g: 16, panzer_iv_sdkfz_ausf_i: 12,
  king_tiger_sdkfz_182: 24, puma_sdkfz_234: 5,
  jagdtiger: 19, jagdpanzer_iv_sdkfz_162: 13,
  hetzer: 6, sturmtiger: 8,
  panzer_ii_luchs_sdkfz_123: 4, kubelwagen: 0,
  // Soviet
  is2m_heavy_tank: 17, isu152: 12, kv1_heavy_tank: 8, kv2_heavy_tank: 5,
  t34_76: 9, t_34_85: 11, t70m_light_tank: 3, su85: 7, 'su-76m': 4,
  m3a1_scout_car: 1,
  // USF
  m26_pershing: 13, m4a3e8_sherman_easy_8: 10, m4a3_sherman_76mm: 8,
  m4a1_sherman_calliope: 6, m10_tank_destroyer: 9, m36_tank_destroyer: 11,
  m5a1_stuart: 4, m8_greyhound: 2, m7b1_priest: 3,
  m3_halftrack: 1, m15a1_aa_halftrack: 2,
  // British
  churchill: 12, comet: 9, cromwell: 8, centaur: 3,
  sherman_firefly: 10, valentine: 4, sexton: 2,
}

/** UV anchor positions. shield/number/name/kills in [x, y, rot?] on a 2048×2048 canvas. */
const ANCHORS: Record<string, {
  shield: [number, number, number?]
  number: [number, number, number?]
  name:   [number, number, number?]
  kills?: [number, number, number?]
}> = {
  // ── OstHeer ──────────────────────────────────────────────────────────────
  tiger:                     { shield: [840, 909],         number: [646, 554],          name: [1538, 1477] },
  elefant:                   { shield: [1958, 1425],       number: [693, 532, 90],      name: [619, 662] },
  brummbar:                  { shield: [473, 753],         number: [243, 956, 90],      name: [1230, 916] },
  stug_iii:                  { shield: [1934, 142],        number: [1250, 398],         name: [1743, 1319] },
  ostwind_flak_panzer:       { shield: [1899, 1002],       number: [162, 1168],         name: [1483, 477] },
  panzerwerfer:              { shield: [970, 1111],        number: [1335, 212],         name: [1335, 640] },
  halftrack:                 { shield: [1298, 1784],       number: [894, 1473],         name: [690, 1346] },
  sdkfz_250:                 { shield: [832, 588],         number: [725, 181],          name: [1040, 1738] },
  sdkfz_222:                 { shield: [557, 339],         number: [1751, 1839],        name: [459, 1759] },

  // ── OKW ─────────────────────────────────────────────────────────────────
  panther_ausf_g:            { shield: [1635, 404],        number: [1338, 1458, 90],    name: [457, 1817],  kills: [1817, 1472, 90] },
  panzer_iv_sdkfz_ausf_i:    { shield: [592, 578],         number: [1204, 65],          name: [1090, 1052] },
  king_tiger_sdkfz_182:      { shield: [640, 500],         number: [748, 557, 90],      name: [568, 434],   kills: [925, 500, 90] },
  puma_sdkfz_234:            { shield: [1239, 1166],       number: [1481, 1408, 90],    name: [1986, 565] },
  jagdtiger:                 { shield: [918, 244],         number: [760, 475],          name: [2034, 228],  kills: [1600, 400] },
  jagdpanzer_iv_sdkfz_162:   { shield: [1830, 1708],       number: [345, 930],          name: [1158, 691] },
  hetzer:                    { shield: [1434, 1830],       number: [620, 1699],         name: [1283, 696] },
  sturmtiger:                { shield: [231, 383],         number: [1071, 1297],        name: [1808, 1047] },
  panzer_ii_luchs_sdkfz_123: { shield: [688, 223],         number: [305, 1310],         name: [1484, 768] },
  kubelwagen:                { shield: [1024, 1263],       number: [981, 259],          name: [1193, 1024] },

  // ── Soviet ──────────────────────────────────────────────────────────────
  is2m_heavy_tank:   { shield: [420, 900],  number: [800, 560, 90],  name: [1600, 820],  kills: [1800, 600] },
  isu152:            { shield: [1900, 380], number: [730, 500, 90],  name: [620, 680] },
  kv1_heavy_tank:    { shield: [480, 860],  number: [820, 540],      name: [1540, 1060], kills: [1740, 480] },
  kv2_heavy_tank:    { shield: [500, 880],  number: [840, 560],      name: [1560, 1080] },
  t34_76:            { shield: [900, 820],  number: [660, 560],      name: [1540, 1460] },
  t_34_85:           { shield: [860, 840],  number: [640, 560],      name: [1560, 1480] },
  t70m_light_tank:   { shield: [560, 340],  number: [1740, 1820],    name: [440, 1740] },
  su85:              { shield: [1940, 160], number: [1240, 380],     name: [1740, 1300] },
  'su-76m':          { shield: [1940, 200], number: [1200, 400],     name: [1720, 1320] },
  m3a1_scout_car:    { shield: [980, 1100], number: [1340, 200],     name: [1340, 640] },

  // ── USF ─────────────────────────────────────────────────────────────────
  m26_pershing:           { shield: [760, 900],  number: [620, 560],      name: [1540, 1500], kills: [1800, 580] },
  m4a3e8_sherman_easy_8:  { shield: [880, 820],  number: [660, 560],      name: [1540, 1460], kills: [1760, 540] },
  m4a3_sherman_76mm:      { shield: [880, 840],  number: [660, 560],      name: [1540, 1460] },
  m4a1_sherman_calliope:  { shield: [880, 840],  number: [660, 560],      name: [1540, 1460] },
  m10_tank_destroyer:     { shield: [1920, 380], number: [740, 520],      name: [640, 680] },
  m36_tank_destroyer:     { shield: [1900, 360], number: [720, 500],      name: [620, 660],   kills: [1600, 400] },
  m5a1_stuart:            { shield: [560, 340],  number: [1740, 1820],    name: [440, 1740] },
  m8_greyhound:           { shield: [980, 1100], number: [1340, 200],     name: [1340, 640] },
  m7b1_priest:            { shield: [1920, 160], number: [1220, 380],     name: [1720, 1300] },
  m3_halftrack:           { shield: [1280, 1760], number: [880, 1460],    name: [680, 1340] },
  m15a1_aa_halftrack:     { shield: [1280, 1760], number: [880, 1460],    name: [680, 1340] },

  // ── British ─────────────────────────────────────────────────────────────
  churchill:      { shield: [420, 880],  number: [800, 560],      name: [1560, 860],  kills: [1780, 600] },
  comet:          { shield: [860, 820],  number: [640, 560],      name: [1540, 1460], kills: [1760, 520] },
  cromwell:       { shield: [880, 840],  number: [660, 560],      name: [1540, 1460] },
  centaur:        { shield: [900, 840],  number: [680, 560],      name: [1540, 1460] },
  sherman_firefly:{ shield: [880, 840],  number: [660, 560],      name: [1540, 1460] },
  valentine:      { shield: [560, 340],  number: [1740, 1820],    name: [440, 1740] },
  sexton:         { shield: [1920, 160], number: [1220, 380],     name: [1720, 1300] },
}

export function buildDutchBrigadeDemo(): Coh2SkinProject {
  const p = newProject('Brigade Prinses Irene')
  p.packDescription =
    'Royal Netherlands Brigade Princess Irene — a Dutch reskin of OstHeer + ' +
    'OKW armoured vehicles in British SCC 1A khaki + SCC 2 brown disruptive ' +
    'camo, with the Brigade tricolour shield, tactical numbers, vehicle ' +
    'names, and kill rings on heavy turrets. Built with the community editor.'
  p.author = 'Community editor demo'

  let nextId = 1
  for (const [vehicleId, anchor] of Object.entries(ANCHORS)) {
    const decals: Decal[] = []
    decals.push({
      id: nextId++, type: 'shield' as DecalType,
      x: anchor.shield[0], y: anchor.shield[1],
      rot: anchor.shield[2] ?? 0, size: 70,
    })
    decals.push({
      id: nextId++, type: 'number' as DecalType,
      x: anchor.number[0], y: anchor.number[1],
      rot: anchor.number[2] ?? 0, size: 110,
    })
    decals.push({
      id: nextId++, type: 'name' as DecalType,
      x: anchor.name[0], y: anchor.name[1],
      rot: anchor.name[2] ?? 0, size: 56,
      text: VEHICLE_NAMES[vehicleId] ?? null,
    })
    if (anchor.kills) {
      decals.push({
        id: nextId++, type: 'kills' as DecalType,
        x: anchor.kills[0], y: anchor.kills[1],
        rot: anchor.kills[2] ?? 0, size: 200,
        kills: VEHICLE_KILLS[vehicleId] ?? 5,
      })
    }
    p.vehicles[vehicleId] = {
      id: vehicleId,
      tac: null,
      name: VEHICLE_NAMES[vehicleId] ?? null,
      decals,
    }
  }
  p.lastVehicleId = 'tiger'
  return p
}
