/**
 * Static catalog of stock vehicle skins pulled from the VEHICLES catalog.
 *
 * No SGA parsing required — all data is derived statically from the catalog
 * at call time. Used by the New* project forms to surface individual vehicle
 * skin entries instead of raw engine archives.
 */

import { VEHICLES } from './vehicles'
import { FACTION_LABELS } from './factions'
import { factionSgaCandidates, textureBaseNamesFor } from './mod-export'

export interface StockSkin {
  /** Stable id: 'german/tiger', 'soviet/t34_76', etc. */
  id: string
  /** Display label: "OstHeer — Tiger I" */
  name: string
  factionId: string
  vehicleId: string
  /** Which stock SGA contains this skin (filename only, e.g. "ArtGermanEF.sga"). */
  sgaName: string
  /** Internal SGA path to the diffuse RGT (read path, first alias candidate). */
  internalPath: string
}

export function listStockSkins(): StockSkin[] {
  const out: StockSkin[] = []
  for (const v of VEHICLES) {
    const candidates = factionSgaCandidates(v.faction)
    if (!candidates.length) continue
    // factionSgaCandidates returns bare filenames already (e.g. "ArtGermanEF.sga")
    const sgaName = candidates[0]
    const baseNames = textureBaseNamesFor(v.id)
    const baseName = baseNames[0] ?? v.id
    out.push({
      id: `${v.faction}/${v.id}`,
      name: `${FACTION_LABELS[v.faction]} — ${v.displayName}`,
      factionId: v.faction,
      vehicleId: v.id,
      sgaName,
      internalPath: `art/armies/${v.faction}/vehicles/${v.id}/${baseName}_dif.rgt`,
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
