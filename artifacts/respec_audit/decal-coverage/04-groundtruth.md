# Decal-Rect Ground Truth

## Coord space
All rects are pixel coordinates in a **2048x2048** atlas (origin top-left). Fields: `{x, y, w, h}` where `(x,y)` is the top-left corner.

## Lookup mechanism
Key: `VehicleSpec.id` (snake_case string, e.g. `king_tiger_sdkfz_182`).
Resolution in `resolveDecalUvRect(vehicleId)` — first hit wins:
1. `JSON_REGISTRY[vehicleId]` — reads `semanticRegions.hullSideRight` (or `hullFront` for T-34/76) from a static-imported JSON in `src/lib/vehicle-uv-regions/<vehicleId>.json`.
2. `DEFAULT_BADGE_RECT` — mean of the 8 hull-side rects; never null.

## 9 authored rects (ground truth, source: Wikinger skin)

| id | x | y | w | h | semantic key | confidence |
|----|---|---|---|---|---|---|
| king_tiger_sdkfz_182 | 410 | 1320 | 360 | 340 | hullSideRight | high |
| tiger | 996 | 1128 | 320 | 320 | hullSideRight | high |
| t34_76 | 0 | 342 | 276 | 320 | hullFront (glacis/fender) | medium |
| m4a3e8_sherman_easy_8 | 1700 | 1236 | 320 | 320 | hullSideRight | high |
| su85 | 951 | 1256 | 340 | 320 | hullSideRight | high |
| sherman_firefly | 45 | 380 | 280 | 260 | hullSideRight | high |
| stug_iii | 1395 | 1635 | 330 | 310 | hullSideRight | medium |
| kv2_heavy_tank | 1235 | 1300 | 320 | 310 | hullSideRight | medium |
| panzerwerfer | 220 | 930 | 310 | 310 | hullSideRight | medium |

## DEFAULT_BADGE_RECT (fallback for un-authored vehicles)
`{x: 870, y: 1150, w: 320, h: 312}` — mean of the 8 hull-side rects (T-34/76 excluded as non-hull-side outlier).

## How bakeDecalOntoDiffuse consumes the rect
1. Badge width = `rect.w * BADGE_FRACTION` (0.31), height = `badgeW / decalAspect`. Clamped to [32, 256] px.
2. Badge is centred on `(rect.x + rect.w/2, rect.y + rect.h/2)`.
3. Drawn with `source-over` compositing, `imageSmoothingQuality: 'high'`.
4. Top-left corner clamped to keep badge within `[0, 2048-badgeW] x [0, 2048-badgeH]`.

## Drop-in contract for a new rect
A new `{x, y, w, h}` in 2048x2048 pixel space is valid when:
- It tightly encloses the visible emblem/marking (typical size 260-360px wide, 260-340px tall).
- The emblem centroid is close to `(x + w/2, y + h/2)` (bake centres on the rect mid-point).
- `rect.w * 0.31` lands in [32, 256] px (satisfied by any w in ~103-826px; real rects are 276-360px, giving badges of ~86-112px).
- The rect stays within `[0, 2048] x [0, 2048]`.
- The JSON is placed at `src/lib/vehicle-uv-regions/<vehicleId>.json` with `semanticRegions.hullSideRight` (or `hullFront`) and the entry is added to `JSON_REGISTRY` in `vehicle-uv-registry.ts`.
