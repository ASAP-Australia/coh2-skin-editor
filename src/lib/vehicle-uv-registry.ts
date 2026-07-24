/**
 * vehicle-uv-registry.ts
 *
 * Resolves the 2048×2048 pixel rect where a vehicle's hull-right-side decal
 * badge should land, for use by the decal-preview compositor in Editor.tsx.
 *
 * Resolution order (first hit wins):
 *   1. Per-vehicle JSON override in src/lib/vehicle-uv-regions/<vehicleId>.json —
 *      reads semanticRegions.hullSideRight (same schema as king_tiger_sdkfz_182.json).
 *      These are ground-truth, hand-authored rects.
 *   2. DEFAULT_BADGE_RECT — a sensible approximation used for any vehicle that
 *      does not yet have a hand-authored JSON entry. Based on the King Tiger's
 *      normalized position scaled to the 2048² atlas. Yields a clean badge-sized
 *      decal in a consistent, plausible location — never a full-atlas smear.
 *      APPROXIMATION: will be wrong for vehicles whose badge panel sits in a
 *      very different atlas region. Add a per-vehicle JSON file to override.
 *
 * NOTE: The geometry-based heuristics (flat-panel normal clustering,
 * vertex-probe bbox) were proven to produce near-full-atlas garbage on real
 * merged vehicle meshes (the hull body is a single mesh covering the whole
 * right side, not just the badge panel). They have been removed from the
 * resolution chain. Do not re-add them without a proven per-vehicle ground
 * truth to validate against.
 */

import type { RgmMesh } from '@/lib/rgm'
import type { DecalBakeRect } from '@/lib/king-tiger-decal-bake'

// ── JSON registry ────────────────────────────────────────────────────────────
//
// Loaded lazily below. Extend this map as new per-vehicle JSON files are added
// to src/lib/vehicle-uv-regions/.
//
// The import() calls are static so Webpack/Vite can tree-shake unknown IDs at
// build time, but we keep the registry as a plain Record<string, DecalBakeRect>
// populated from the JSON files' semanticRegions.hullSideRight field.

import kingTigerUvRegions from '@/lib/vehicle-uv-regions/king_tiger_sdkfz_182.json'
import tigerUvRegions from '@/lib/vehicle-uv-regions/tiger.json'
import t34_76UvRegions from '@/lib/vehicle-uv-regions/t34_76.json'
import shermanEasy8UvRegions from '@/lib/vehicle-uv-regions/m4a3e8_sherman_easy_8.json'
import su85UvRegions from '@/lib/vehicle-uv-regions/su85.json'
import shermanFireflyUvRegions from '@/lib/vehicle-uv-regions/sherman_firefly.json'
import stugIiiUvRegions from '@/lib/vehicle-uv-regions/stug_iii.json'
import kv2HeavyTankUvRegions from '@/lib/vehicle-uv-regions/kv2_heavy_tank.json'
import panzerwerferUvRegions from '@/lib/vehicle-uv-regions/panzerwerfer.json'
// Pass 3 — 7 authored JSONs registered (were in vehicle-uv-regions/ but missing from JSON_REGISTRY)
import cromwellUvRegions from '@/lib/vehicle-uv-regions/cromwell.json'
import kv1HeavyTankUvRegions from '@/lib/vehicle-uv-regions/kv1_heavy_tank.json'
import m10TankDestroyerUvRegions from '@/lib/vehicle-uv-regions/m10_tank_destroyer.json'
import m26PershingUvRegions from '@/lib/vehicle-uv-regions/m26_pershing.json'
import m36TankDestroyerUvRegions from '@/lib/vehicle-uv-regions/m36_tank_destroyer.json'
import m4a3Sherman76mmUvRegions from '@/lib/vehicle-uv-regions/m4a3_sherman_76mm.json'
import t34_85UvRegions from '@/lib/vehicle-uv-regions/t34_85.json'

/** Shape of the relevant slice of each vehicle UV-region JSON. */
interface VehicleUvJsonRight {
  semanticRegions: {
    hullSideRight: DecalBakeRect
  }
}

interface VehicleUvJsonFront {
  semanticRegions: {
    hullFront: DecalBakeRect
  }
}

/**
 * Statically-registered JSON overrides keyed by VehicleSpec.id.
 * Add new entries here as additional vehicle JSON files are authored.
 */
const JSON_REGISTRY: Record<string, DecalBakeRect> = {
  king_tiger_sdkfz_182: (kingTigerUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  tiger:                (tigerUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  // T-34/76 uses hullFront — stars are on glacis/fender, not a distinct side panel
  t34_76:              (t34_76UvRegions as VehicleUvJsonFront).semanticRegions.hullFront,
  m4a3e8_sherman_easy_8: (shermanEasy8UvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  // Pass 2 — additional Wikinger-skin ground-truth rects
  su85:                (su85UvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  sherman_firefly:     (shermanFireflyUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  stug_iii:            (stugIiiUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  kv2_heavy_tank:      (kv2HeavyTankUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  panzerwerfer:        (panzerwerferUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  // Pass 3 — 7 authored-but-unregistered JSONs now wired
  cromwell:            (cromwellUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  kv1_heavy_tank:      (kv1HeavyTankUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  m10_tank_destroyer:  (m10TankDestroyerUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  m26_pershing:        (m26PershingUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  m36_tank_destroyer:  (m36TankDestroyerUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  m4a3_sherman_76mm:   (m4a3Sherman76mmUvRegions as VehicleUvJsonRight).semanticRegions.hullSideRight,
  // T-34/85 uses hullFront — same glacis/fender convention as T-34/76
  t34_85:              (t34_85UvRegions as VehicleUvJsonFront).semanticRegions.hullFront,
}

// ── Default fallback rect ────────────────────────────────────────────────────

/**
 * APPROXIMATION — default badge rect used for vehicles without a hand-authored
 * JSON override.
 *
 * Data-driven: this is the mean of the 8 hand-authored hull-side rects (King
 * Tiger, Tiger, Sherman E8, SU-85, Firefly, StuG III, KV-2, Panzerwerfer —
 * the T-34/76 front-glacis rect is excluded as a non-hull-side outlier).
 * The earlier default was {896,1152,512,512} (King Tiger's *old, now-corrected*
 * rect): too large — real CoH2 badges are ~300-340px square, not 512. A 512px
 * box over-covers the hull and reads as a smear. This mean-derived rect is
 * correctly badge-sized and sits in the common hull-side band, giving a
 * plausible preview for any un-authored vehicle. Per-vehicle JSON overrides
 * remain pixel-accurate; this is only the fallback.
 *
 * To override for a specific vehicle, add a JSON file to
 * src/lib/vehicle-uv-regions/<vehicleId>.json and register it in JSON_REGISTRY.
 */
export const DEFAULT_BADGE_RECT: DecalBakeRect = {
  x: 870,
  y: 1150,
  w: 320,
  h: 312,
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the hull-right-side decal UV rect for a vehicle.
 *
 * @param vehicleId  VehicleSpec.id string (e.g. "king_tiger_sdkfz_182").
 * @param _meshes    Unused — kept for signature stability with existing call
 *                   sites (Editor.tsx passes the loaded RgmMesh array here).
 *                   Geometry-based heuristics have been removed; this parameter
 *                   is intentionally ignored.
 * @returns          {x,y,w,h} pixel rect in 2048×2048 space. Always non-null:
 *                   returns the JSON override for known vehicles, or
 *                   DEFAULT_BADGE_RECT for all others.
 *
 * Resolution order:
 *   1. JSON registry (hand-authored, pixel-accurate).
 *   2. DEFAULT_BADGE_RECT (approximate, badge-sized, never full-atlas).
 */
export function resolveDecalUvRect(
  vehicleId: string,
  _meshes?: RgmMesh[] | null,
): DecalBakeRect {
  // Path 1: JSON registry (hand-authored ground truth)
  const jsonRect = JSON_REGISTRY[vehicleId]
  if (jsonRect) return jsonRect

  // Path 2: default approximation — badge-sized rect at the King Tiger's
  // normalized atlas position. Better than null (no preview) and vastly better
  // than a geometry-derived near-full-atlas smear.
  return DEFAULT_BADGE_RECT
}
