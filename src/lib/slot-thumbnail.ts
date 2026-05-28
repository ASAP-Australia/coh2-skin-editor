/**
 * Slot-thumbnail helpers — shared between ExportSlotsGrid and SlotIconGrid.
 *
 * WHY THIS FILE EXISTS: both components compose 256×256 thumbnails from the
 * same per-slot inputs (camo + vehicle silhouette + main decal). When the
 * logic lived inside ExportSlotsGrid.tsx and SlotIconGrid had to import it
 * from there, Vite's fast-refresh rule complained ("only export components
 * from a component file"). Moving the pure helpers here keeps the
 * component files re-importable for HMR and gives the helpers a single
 * source of truth.
 *
 * No React deps — runs anywhere a DOM is available.
 */

import type { Coh2SkinProject, ExportSlot, VehicleProject } from './project'
import type { TileIconLayers } from './tile-icon-compositor'
import { resolveVehicleIcon } from './vehicle-icons'
import { generateCamo, type CamoPreset } from './camo-generator'
import { VEHICLES, type Faction } from './vehicles'
import { FACTION_COLORS } from './factions'

/** Build the (camo, vehicleIcon, decal) layer trio for a given slot.
 *
 *  Strategy: pick a "primary" vehicle (the first in state.vehicles, or
 *  fall back to the first VEHICLES entry that matches the slot's
 *  faction list if state is empty). The primary's camo + decal data
 *  drive the thumb. If everything is empty we degrade to a faction-
 *  coloured solid background. */
export async function deriveLayersForSlot(
  slot: ExportSlot,
  project: Coh2SkinProject,
  installRoot?: FileSystemDirectoryHandle | null,
): Promise<TileIconLayers> {
  // 1. Pick a primary vehicle id. If the slot was just initialised it
  //    won't have any vehicles — use the first VEHICLES entry for the
  //    slot's first faction so the tile still has *something*.
  const stateVehicles = Object.values(slot.state.vehicles)
  const primaryFaction: Faction = slot.factions[0] ?? 'german'
  let primaryVehicleId: string | null = stateVehicles[0]?.id ?? null
  const primary: VehicleProject | undefined = stateVehicles[0]
  if (!primaryVehicleId) {
    const fallback = VEHICLES.find(v => v.faction === primaryFaction)
    primaryVehicleId = fallback?.id ?? VEHICLES[0]?.id ?? null
  }

  // 2. Camo layer.
  const camoLayer = await camoLayerForSlot(slot, primary, primaryFaction)

  // 3. Vehicle silhouette.
  const vehicleIcon = primaryVehicleId
    ? await resolveVehicleIcon(project, primaryVehicleId, primaryFaction, {
        installRoot,
        cache: true,
      })
    : null

  // 4. Main decal — first try the slot's own mainDecalId, else fall
  //    back to the effective main on the primary vehicle.
  const mainDecalId =
    slot.mainDecalId ??
    (primary && primaryVehicleId
      ? effectiveMainDecalIdFromSlotState(slot, primaryVehicleId, primaryFaction)
      : null)
  const decal =
    mainDecalId != null ? findDecalImageForId(slot, primary, project, mainDecalId) : null

  return {
    camo: camoLayer,
    vehicleIcon,
    decal,
    factionColor: FACTION_COLORS[primaryFaction] ?? '#3a3a3a',
  }
}

/** Resolve the camo layer for a slot: prefer a stored customDiffuseUrl
 *  on the primary vehicle (or faction default), else render the
 *  procedural CamoPreset to a small canvas. Falls through to null if
 *  the slot has neither, so the compositor uses the faction colour. */
async function camoLayerForSlot(
  slot: ExportSlot,
  primary: VehicleProject | undefined,
  primaryFaction: Faction,
): Promise<CanvasImageSource | string | null> {
  // Vehicle override beats faction default for both diffuse and preset.
  const vehicleDiffuse = primary?.customDiffuseUrl ?? null
  const factionDiffuse = slot.state.factionDefaults[primaryFaction]?.customDiffuseUrl ?? null
  if (vehicleDiffuse) return vehicleDiffuse
  if (factionDiffuse) return factionDiffuse

  const vehiclePreset: CamoPreset | null = primary?.camoPreset ?? null
  const factionPreset: CamoPreset | null =
    slot.state.factionDefaults[primaryFaction]?.camoPreset ?? null
  const preset = vehiclePreset ?? factionPreset
  if (preset) {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    generateCamo(c, preset)
    return c
  }
  return null
}

/** Mirror of `effectiveMainDecalId` but reading from the slot snapshot
 *  rather than the live `project.vehicles`. The live helper would
 *  return the WRONG answer for an inactive slot. */
function effectiveMainDecalIdFromSlotState(
  slot: ExportSlot,
  vehicleId: string,
  faction: Faction,
): number | null {
  const v = slot.state.vehicles[vehicleId]
  if (v?.mainDecalId !== undefined && v.mainDecalId !== null) return v.mainDecalId
  return slot.state.factionDefaults[faction]?.mainDecalId ?? null
}

/** Find the image dataUrl for the decal with `decalId`. The decal can
 *  live on the vehicle, on the faction default, or just reference a
 *  library image directly. Returns null if nothing matches. */
function findDecalImageForId(
  slot: ExportSlot,
  primary: VehicleProject | undefined,
  project: Coh2SkinProject,
  decalId: number,
): string | null {
  // Search vehicle decals first.
  const fromVehicle = primary?.decals.find(d => d.id === decalId)
  // Then faction defaults.
  let fromFaction: { imageId?: string } | undefined
  for (const fd of Object.values(slot.state.factionDefaults)) {
    const hit = fd?.decals.find(d => d.id === decalId)
    if (hit) {
      fromFaction = hit
      break
    }
  }
  const imageId = fromVehicle?.imageId ?? fromFaction?.imageId
  if (!imageId) return null
  return project.images[imageId]?.dataUrl ?? null
}

/** Cheap hash of a slot's state so we can detect "did this slot change"
 *  without deep-equal. We stringify the bits the compositor reads. */
export function hashSlot(s: ExportSlot): string {
  // structuredClone+JSON would be wasteful; this picks just the
  // fields that affect the thumbnail.
  return JSON.stringify({
    label: s.label,
    main: s.mainDecalId,
    vehs: Object.entries(s.state.vehicles).map(([id, v]) => [
      id,
      v.camoPreset?.label ?? null,
      !!v.customDiffuseUrl,
      v.mainDecalId ?? null,
      v.decals.map(d => d.id).join(','),
    ]),
    factionDefaults: Object.entries(s.state.factionDefaults).map(([f, fd]) => [
      f,
      fd?.camoPreset?.label ?? null,
      !!fd?.customDiffuseUrl,
      fd?.mainDecalId ?? null,
    ]),
  })
}
