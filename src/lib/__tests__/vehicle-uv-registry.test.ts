/**
 * Tests for vehicle-uv-registry.ts
 *
 * Covers:
 *   (a) JSON hit — registered vehicles return their exact Wikinger-derived JSON rects.
 *   (b) Default fallback — any vehicle without a JSON override returns
 *       DEFAULT_BADGE_RECT {x:896, y:1152, w:512, h:512}.
 *   (c) Result is always a valid badge-sized rect (within atlas bounds),
 *       never near-full-atlas.
 *   (d) Newly-authored Wikinger-derived rects for Tiger, T-34/76, Sherman Easy 8.
 */

import { describe, it, expect } from 'vitest'
import { resolveDecalUvRect, DEFAULT_BADGE_RECT } from '../vehicle-uv-registry'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveDecalUvRect', () => {
  it('(a) JSON hit — king_tiger_sdkfz_182 returns the Wikinger-derived hullSideRight rect', () => {
    const rect = resolveDecalUvRect('king_tiger_sdkfz_182')
    // Wikinger ground truth: cross+number zone x=410,y=1320,w=360,h=340
    // (old hand-authored: {896,1152,512,512} — updated to Wikinger ground truth)
    expect(rect).toMatchObject({ x: 410, y: 1320, w: 360, h: 340 })
  })

  it('(a) JSON hit — king_tiger_sdkfz_182 works even when meshes are provided (JSON takes priority)', () => {
    // Pass an empty array to confirm the meshes param is ignored and JSON wins
    const rect = resolveDecalUvRect('king_tiger_sdkfz_182', [])
    expect(rect).toMatchObject({ x: 410, y: 1320, w: 360, h: 340 })
  })

  it('(b) default fallback — unknown vehicle with no meshes returns DEFAULT_BADGE_RECT', () => {
    const rect = resolveDecalUvRect('some_unknown_vehicle_no_mesh')
    expect(rect).toEqual(DEFAULT_BADGE_RECT)
    expect(rect).toMatchObject({ x: 870, y: 1150, w: 320, h: 312 })
  })

  it('(b) default fallback — unknown vehicle with meshes provided also returns DEFAULT_BADGE_RECT (meshes are ignored)', () => {
    // Geometry heuristics have been removed; meshes param is intentionally unused
    const rect = resolveDecalUvRect('panzer_iv_ausf_h', null)
    expect(rect).toEqual(DEFAULT_BADGE_RECT)
    expect(rect).toMatchObject({ x: 870, y: 1150, w: 320, h: 312 })
  })

  it('(b) default fallback — empty mesh array returns DEFAULT_BADGE_RECT', () => {
    const rect = resolveDecalUvRect('some_unknown_vehicle_empty', [])
    expect(rect).toEqual(DEFAULT_BADGE_RECT)
  })

  it('(c) result is always a valid badge-sized rect — never near-full-atlas', () => {
    // Test both a known vehicle (JSON path) and an unknown vehicle (default path)
    const vehicles = ['king_tiger_sdkfz_182', 'tiger', 't34_76', 'm4a3e8_sherman_easy_8',
                      'unknown_vehicle_xyz', 'halftrack_sdkfz_251']
    for (const vehicleId of vehicles) {
      const rect = resolveDecalUvRect(vehicleId)
      // rect must be within atlas bounds (2048×2048)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.w).toBeLessThanOrEqual(2048)
      expect(rect.y + rect.h).toBeLessThanOrEqual(2048)
      // Sanity: not near-full-atlas (w and h must be much less than 2048)
      expect(rect.w).toBeLessThan(1500)
      expect(rect.h).toBeLessThan(1500)
      // Must have positive dimensions
      expect(rect.w).toBeGreaterThan(0)
      expect(rect.h).toBeGreaterThan(0)
    }
  })

  it('(c) DEFAULT_BADGE_RECT constant has correct values', () => {
    expect(DEFAULT_BADGE_RECT).toEqual({ x: 870, y: 1150, w: 320, h: 312 })
  })

  it('(d) Tiger I returns Wikinger-derived hullSideRight rect (not DEFAULT_BADGE_RECT)', () => {
    const rect = resolveDecalUvRect('tiger')
    // Wikinger OstHeer skin: Balkenkreuz at (1156,1288), zone {996,1128,320,320}
    expect(rect).toMatchObject({ x: 996, y: 1128, w: 320, h: 320 })
    expect(rect).not.toEqual(DEFAULT_BADGE_RECT)
  })

  it('(d) T-34/76 returns Wikinger-derived hullFront rect (not DEFAULT_BADGE_RECT)', () => {
    const rect = resolveDecalUvRect('t34_76')
    // Wikinger Soviet skin: Soviet star on front hull panel, zone {0,342,276,320}
    expect(rect).toMatchObject({ x: 0, y: 342, w: 276, h: 320 })
    expect(rect).not.toEqual(DEFAULT_BADGE_RECT)
  })

  it('(d) Sherman Easy 8 returns Wikinger-derived hullSideRight rect (not DEFAULT_BADGE_RECT)', () => {
    const rect = resolveDecalUvRect('m4a3e8_sherman_easy_8')
    // Wikinger USF skin: US star on hull right panel, zone {1700,1236,320,320}
    expect(rect).toMatchObject({ x: 1700, y: 1236, w: 320, h: 320 })
    expect(rect).not.toEqual(DEFAULT_BADGE_RECT)
  })

  // Pass 2 — additional Wikinger-skin vehicles

  it('(d) SU-85 returns Wikinger-derived hullSideRight rect (not DEFAULT_BADGE_RECT)', () => {
    const rect = resolveDecalUvRect('su85')
    // Wikinger OKW skin: Balkenkreuz on hull, zone {951,1256,340,320}
    expect(rect).toMatchObject({ x: 951, y: 1256, w: 340, h: 320 })
    expect(rect).not.toEqual(DEFAULT_BADGE_RECT)
    // badge-sized and in-bounds
    expect(rect.x + rect.w).toBeLessThanOrEqual(2048)
    expect(rect.y + rect.h).toBeLessThanOrEqual(2048)
  })

  it('(d) Sherman Firefly returns Wikinger-derived hullSideRight rect (not DEFAULT_BADGE_RECT)', () => {
    const rect = resolveDecalUvRect('sherman_firefly')
    // Wikinger British skin: white Allied star on hull, zone {45,380,280,260}
    expect(rect).toMatchObject({ x: 45, y: 380, w: 280, h: 260 })
    expect(rect).not.toEqual(DEFAULT_BADGE_RECT)
    expect(rect.x + rect.w).toBeLessThanOrEqual(2048)
    expect(rect.y + rect.h).toBeLessThanOrEqual(2048)
  })

  it('(d) StuG III returns Wikinger-derived hullSideRight rect (not DEFAULT_BADGE_RECT)', () => {
    const rect = resolveDecalUvRect('stug_iii')
    // Wikinger German skin: Balkenkreuz at bottom-right panel, zone {1395,1635,330,310}
    expect(rect).toMatchObject({ x: 1395, y: 1635, w: 330, h: 310 })
    expect(rect).not.toEqual(DEFAULT_BADGE_RECT)
    expect(rect.x + rect.w).toBeLessThanOrEqual(2048)
    expect(rect.y + rect.h).toBeLessThanOrEqual(2048)
  })

  it('(d) KV-2 returns Wikinger-derived hullSideRight rect (not DEFAULT_BADGE_RECT)', () => {
    const rect = resolveDecalUvRect('kv2_heavy_tank')
    // Wikinger OKW skin: Balkenkreuz on hull, zone {1235,1300,320,310}
    expect(rect).toMatchObject({ x: 1235, y: 1300, w: 320, h: 310 })
    expect(rect).not.toEqual(DEFAULT_BADGE_RECT)
    expect(rect.x + rect.w).toBeLessThanOrEqual(2048)
    expect(rect.y + rect.h).toBeLessThanOrEqual(2048)
  })

  it('(d) Panzerwerfer returns Wikinger-derived hullSideRight rect (not DEFAULT_BADGE_RECT)', () => {
    const rect = resolveDecalUvRect('panzerwerfer')
    // Wikinger OKW skin: Balkenkreuz at center-left hull, zone {220,930,310,310}
    expect(rect).toMatchObject({ x: 220, y: 930, w: 310, h: 310 })
    expect(rect).not.toEqual(DEFAULT_BADGE_RECT)
    expect(rect.x + rect.w).toBeLessThanOrEqual(2048)
    expect(rect.y + rect.h).toBeLessThanOrEqual(2048)
  })

  // Phase 4 fix: AtlasPreview3D now uses resolveDecalUvRect rather than
  // a hardcoded { x:896, y:1152, w:512, h:512 } constant.
  // This test pins that the registry lookup for king_tiger_sdkfz_182
  // returns the Wikinger-verified rect, NOT the old wrong constant.
  it('(e) AtlasPreview3D badge rect — registry KT rect is not the old hardcoded value', () => {
    const rect = resolveDecalUvRect('king_tiger_sdkfz_182')
    // Old wrong constant that AtlasPreview3D used to hard-code:
    expect(rect).not.toMatchObject({ x: 896, y: 1152, w: 512, h: 512 })
    // Confirmed Wikinger ground-truth rect:
    expect(rect).toMatchObject({ x: 410, y: 1320, w: 360, h: 340 })
  })
})
