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
  tiger: 'Wilhelmina',          elefant: 'Juliana',          brummbar: 'Beatrix',
  stug_iii: 'Margriet',         ostwind_flak_panzer: 'Marijke',
  panzerwerfer: 'Emma',         halftrack: 'Sophie',         sdkfz_250: 'Mathilde',
  sdkfz_222: 'Henriette',
  panther_ausf_g: 'Louise',     panzer_iv_sdkfz_ausf_i: 'Anna',
  king_tiger_sdkfz_182: 'Amalia', puma_sdkfz_234: 'Carolina',
  jagdtiger: 'Augusta',         jagdpanzer_iv_sdkfz_162: 'Christina',
  hetzer: 'Helena',             sturmtiger: 'Stephanie',
  panzer_ii_luchs_sdkfz_123: 'Marie', kubelwagen: 'Maria',
}

const VEHICLE_KILLS: Record<string, number> = {
  tiger: 14, elefant: 11, brummbar: 7, stug_iii: 9,
  ostwind_flak_panzer: 4, panzerwerfer: 3, halftrack: 2,
  sdkfz_250: 2, sdkfz_222: 3,
  panther_ausf_g: 16, panzer_iv_sdkfz_ausf_i: 12,
  king_tiger_sdkfz_182: 24, puma_sdkfz_234: 5,
  jagdtiger: 19, jagdpanzer_iv_sdkfz_162: 13,
  hetzer: 6, sturmtiger: 8,
  panzer_ii_luchs_sdkfz_123: 4, kubelwagen: 0,
}

/** UV anchor positions, derived from the SS Totenkopf community pack so they
 *  land at the same physical hull/turret positions that pack uses. */
const ANCHORS: Record<string, { shield: [number, number]; number: [number, number, number?]; name: [number, number]; kills?: [number, number, number?] }> = {
  tiger:                     { shield: [840, 909], number: [646, 554], name: [1538, 1477] },
  elefant:                   { shield: [1958, 1425], number: [693, 532, 90], name: [619, 662] },
  brummbar:                  { shield: [473, 753], number: [243, 956, 90], name: [1230, 916] },
  stug_iii:                  { shield: [1934, 142], number: [1250, 398], name: [1743, 1319] },
  ostwind_flak_panzer:       { shield: [1899, 1002], number: [162, 1168], name: [1483, 477] },
  panzerwerfer:              { shield: [970, 1111], number: [1335, 212], name: [1335, 212] },
  halftrack:                 { shield: [1298, 1784], number: [894, 1473], name: [690, 1346] },
  sdkfz_250:                 { shield: [832, 588], number: [725, 181], name: [1040, 1738] },
  sdkfz_222:                 { shield: [557, 339], number: [1751, 1839], name: [459, 1759] },
  panther_ausf_g:            { shield: [1635, 404], number: [1338, 1458, 90], name: [457, 1817], kills: [1817, 1472, 90] },
  panzer_iv_sdkfz_ausf_i:    { shield: [592, 578], number: [1204, 65], name: [1090, 1052] },
  king_tiger_sdkfz_182:      { shield: [640, 500], number: [748, 557, 90], name: [568, 434], kills: [925, 500, 90] },
  puma_sdkfz_234:            { shield: [1239, 1166], number: [1481, 1408, 90], name: [1986, 565] },
  jagdtiger:                 { shield: [918, 244], number: [760, 475], name: [2034, 228] },
  jagdpanzer_iv_sdkfz_162:   { shield: [1830, 1708], number: [345, 930], name: [1158, 691] },
  hetzer:                    { shield: [1434, 1830], number: [620, 1699], name: [1283, 696] },
  sturmtiger:                { shield: [231, 383], number: [1071, 1297], name: [1808, 1047] },
  panzer_ii_luchs_sdkfz_123: { shield: [688, 223], number: [305, 1310], name: [1484, 768] },
  kubelwagen:                { shield: [1024, 1263], number: [981, 259], name: [1193, 1024] },
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
      x: anchor.shield[0], y: anchor.shield[1], rot: 0, size: 70,
    })
    decals.push({
      id: nextId++, type: 'number' as DecalType,
      x: anchor.number[0], y: anchor.number[1],
      rot: anchor.number[2] ?? 0, size: 110,
    })
    decals.push({
      id: nextId++, type: 'name' as DecalType,
      x: anchor.name[0], y: anchor.name[1], rot: 0, size: 56,
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
