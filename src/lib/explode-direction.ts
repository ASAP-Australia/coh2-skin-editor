/**
 * explode-direction.ts
 *
 * Computes the explode-animation direction vector for a single vehicle submesh.
 *
 * Priority:
 *   1. UV-region JSON centroid3d (per-vehicle override, currently King Tiger only)
 *   2. Part-name heuristic (anatomy-aware rules)
 *   3. Fallback: normalize(bboxCenter), biased outward for tiny parts
 *
 * The returned vector is already normalised.  The caller multiplies it by the
 * desired magnitude (e.g. 0.5) before applying it as the explode target position.
 */

import { Vector3 } from 'three'

// ---------------------------------------------------------------------------
// UV-region centroid3d registries — add new vehicles here as their JSON files
// are authored.  Keyed by VehicleSpec.id.
// ---------------------------------------------------------------------------
import kingTigerRegions from '@/lib/vehicle-uv-regions/king_tiger_sdkfz_182.json'

type NamedObjectEntry = {
  centroid3d?: { x: number; y: number; z: number }
}
type UvRegionJson = {
  namedObjects: Record<string, NamedObjectEntry>
}

const UV_REGION_REGISTRY: Record<string, UvRegionJson> = {
  king_tiger_sdkfz_182: kingTigerRegions as UvRegionJson,
}

// ---------------------------------------------------------------------------
// Helper: sign with a +1 fallback when the value is near zero
// ---------------------------------------------------------------------------
function signOrPlus(v: number): number {
  if (v > 0.05) return 1
  if (v < -0.05) return -1
  return 1
}

// ---------------------------------------------------------------------------
// computeExplodeDirection
// ---------------------------------------------------------------------------

/**
 * @param meshName    Submesh name as stored in the RGM / Three.js object.name
 * @param bboxCenter  Local-space bounding-box centre of this mesh
 * @param vehicleSize Local-space bounding-box size of the WHOLE vehicle group
 * @param vehicleId   VehicleSpec.id (e.g. "king_tiger_sdkfz_182") — used for
 *                    UV-region centroid3d override.  Pass null if unknown.
 * @param vehicleCenter Local-space centre of the whole vehicle (for centroid3d
 *                    direction computation)
 */
export function computeExplodeDirection(
  meshName: string,
  bboxCenter: Vector3,
  vehicleSize: Vector3,
  vehicleId: string | null = null,
  vehicleCenter: Vector3 = new Vector3(),
): Vector3 {
  const lo = meshName.toLowerCase()

  // ── 1. UV-region centroid3d override ──────────────────────────────────────
  if (vehicleId) {
    const registry = UV_REGION_REGISTRY[vehicleId]
    if (registry) {
      const entry = registry.namedObjects[meshName]
      if (entry?.centroid3d) {
        const c = entry.centroid3d
        const dir = new Vector3(c.x, c.y, c.z).sub(vehicleCenter)
        if (dir.lengthSq() > 0.0001) return dir.normalize()
      }
    }
  }

  // ── 2. Part-name heuristic ───────────────────────────────────────────────

  // Turret / cupola → straight up
  if (/turret|cupola/.test(lo)) {
    return new Vector3(0, 1, 0)
  }

  // Main gun barrel → forward + slight up
  if (/maingun_barrel|barrel/.test(lo)) {
    return new Vector3(0, 0.3, 1).normalize()
  }

  // Main gun mantlet (without barrel) → up + forward diagonal
  if (/maingun/.test(lo)) {
    return new Vector3(0, 0.5, 0.5).normalize()
  }

  // Wheels, road wheels, sprockets, idlers → sideways
  if (/wheel|road_wheel|sprocket|idler/.test(lo)) {
    return new Vector3(signOrPlus(bboxCenter.x), 0, 0)
  }

  // Treads / tracks → sideways + slightly down
  if (/tread|track/.test(lo)) {
    return new Vector3(signOrPlus(bboxCenter.x), -0.2, 0).normalize()
  }

  // Hatches, lids, doors → straight up
  if (/hatch|lid|door/.test(lo)) {
    return new Vector3(0, 1, 0)
  }

  // Chassis / hull / body → anchor (no movement)
  if (/chassis|hull|body/.test(lo)) {
    return new Vector3(0, 0, 0)
  }

  // Exhaust / muffler → rearward + slight up
  if (/exhaust|muffler/.test(lo)) {
    return new Vector3(0, 0.3, -1).normalize()
  }

  // Antenna / aerial → up + outward
  if (/antenna|aerial/.test(lo)) {
    return new Vector3(signOrPlus(bboxCenter.x) * 0.3, 1, 0).normalize()
  }

  // MG / machine gun → up + forward
  if (/(?:^|[_\W])mg(?:[_\W]|$)|machinegun/.test(lo)) {
    return new Vector3(0, 0.7, 0.5).normalize()
  }

  // ── 3. Fallback: normalize(bboxCenter), bias outward for tiny parts ───────
  const dir = bboxCenter.clone().normalize()
  if (dir.lengthSq() < 0.0001) dir.set(0, 1, 0)

  // Tiny parts (each axis < 20% of vehicle size) spread more
  const partIsTiny =
    vehicleSize.x > 0 &&
    vehicleSize.y > 0 &&
    vehicleSize.z > 0 &&
    Math.abs(bboxCenter.x) / vehicleSize.x < 0.2 &&
    Math.abs(bboxCenter.y) / vehicleSize.y < 0.2 &&
    Math.abs(bboxCenter.z) / vehicleSize.z < 0.2

  return partIsTiny ? dir.multiplyScalar(1.4).normalize() : dir
}
