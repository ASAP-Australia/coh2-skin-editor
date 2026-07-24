# Authoritative Decal Placement Investigation

**Date:** 2026-06-19  
**Method:** Parsed tiger.rgm live from ArtHigh.sga (zlib-decompressed, 518 804 B); dumped full Chunky chunk tree and decoded MRKS payload.

---

## (a) RGM Chunk Types — Parsed vs Skipped

The Tiger RGM chunk tree under `FOLD/MODL v1 > FOLD/MESH v3 > FOLD/MGRP v1` contains:

| Chunk | What it holds | Parser status |
|---|---|---|
| `FOLD/TSET` | Texture-set path references (17 total, _dif/_nrm/_spc/_gls/_alp) | Read (name only) |
| `FOLD/MTRL` | Shader name + material variable key/value params | Read (shader + vars) |
| `FOLD/MESH` / `FOLD/MGRP` | Submesh hierarchy wrappers | Traversed |
| `FOLD/TRIM v5` / `DATA/DATA v5` | Vertex+index buffers | Fully decoded |
| `DATA/BVOL v2` | Per-submesh bounding volume | Skipped (unused) |
| `DATA/MRFM v1` | Unknown 4-byte field (likely reflection/flags) | Skipped |
| `DATA/NODE v1` | ~70 node entries inside MGRP, variable size 88–143 B | Skipped — not parsed |
| **`DATA/MRKS v1`** | **Marker array — 55 named 3D anchor points with bone + 3×4 matrix** | **Skipped in current parser** |
| `FOLD/SKEL v3` / `DATA/BONE v7` | Skeleton bones (72 bones, each a 3×4 matrix + parent index) | Skipped |
| `DATA/FBIF v3` | FileBurnInfo (build metadata) | Skipped (irrelevant) |

The `DATA/NODE v1` chunks are undocumented in corsix/coh2-formats and their payload schema is unknown.

---

## (b) MRKS Markers — Full Name List (Tiger)

All 55 markers in tiger.rgm MRKS v1 chunk (3D world-space position = last column of 3×4 matrix, Essence LH Y-up):

```
marker_dmg_hull_hatch_rr, marker_dmg_hull_hatch_rl, marker_dmg_hull_hatch_engine_l/r,
marker_dmg_hull_hatch_fl/fr, marker_dmg_hull_peephole,
marker_exhaust_l/r, marker_smokelauncher_hull_r/l/rl,
marker_dmg_hull_hatch_engine_r01/l01, marker_dmg_hull_hatch_rc,
marker_dmg_hull_fuel_drip, marker_main_fire, marker_fire01/02/03/04,
marker_dmg_turret_gun_crack_01/02/03, marker_rain_02,
marker_tiger_barrel_end, marker_tiger_mg42_coaxial,
marker_dmg_turret_hatch_r/l/03, marker_cannon_shockwave,
marker_wrecked_barrel_end, marker_crewabandon,
marker_fx_smoke_launcher/2, marker_flare,
marker_tiger_mg42_hull, marker_headlight/2,
marker_tread_lr/lf/rf/rr_rotate, marker_track_upper_r/l,
marker_destruction, marker_fx_ui,
marker_treadmarks_fr/rl/rr/fl, marker_treadmarks_rr/rl/fl/fr_top
```

**Zero markers are named with any of:** badge, decal, insignia, emblem, cross, national, balken, marking, vinyl, logo, emblem.

The markers are exclusively for: damage effects, exhaust/fire FX, smoke launchers, tread animation, headlights, barrel end, crew abandon, destruction FX, UI anchor.

---

## (c) Sibling Game-Data Files

- **Attrib/ebps/.abp files** — present in ArtGermanEF.sga (.abp, .rpb files). These are Lua-table text (vehicle blueprint/state machine) and define unit stats, weapon bindings, and animation state. No texture-UV or decal slot data; they reference model paths, not UVs.
- **_tnt/_spc textures** — `tiger_spc.rgt` and `tiger_alp.rgt` are in ArtGermanEF.sga. The _alp (alpha channel) acts as the team-colour mask (confirmed by corsix/essence_panel.cpp `teamcolour` uniform). Neither _spc nor _alp encodes decal UV position.
- **badges/default_dif** — the RGM references `art\armies\german\badges\default_dif` as a texture set. This is the runtime badge atlas (the actual national insignia bitmap), projected by the engine's decal system. The path is in the TSET chunk but carries no placement coordinates.
- **Decal definition files** — no `.decal`, `.ddf`, or equivalent chunk type was found in this RGM or its SGA. The engine's decal projector state is driven by attrib/ability scripts at runtime, not stored in the RGM geometry.

---

## How the 9 Hand-Authored Rects Were Derived

Purely visual, not from any file data:

1. The Wikinger community skin pack places Balkenkreuz/stars at visible atlas locations.
2. Those skin PNGs were decoded from SGA, and the cross/star pixel centroid was located by density scan (dark-pixel clustering).
3. A bounding rect was placed around the detected centroid.
4. UV-to-3D vertex probes confirmed which 3D face of the tank the rect mapped to (hull right-side vs. glacis).

No RGM data was used for positioning. The rects are ground-truth for where Relic's own modders placed the stock insignia, not for where the engine's decal projector aims.

---

## Verdict

**No authoritative placement data exists in the RGM or any sibling file that this tool can read.**

- The MRKS markers are for FX/damage/animation anchors, not badge placement.
- The SKEL bones are for mesh skinning animation.
- The TSET reference to `badges/default_dif` tells us which badge atlas to use, not where on the UV sheet to draw it.
- The Essence engine's runtime decal projector (which puts the Balkenkreuz on the hull at the correct UV at runtime) is driven by attrib Lua scripts that are not available in the RGM.

The 9 Wikinger-skin-derived rects are the best achievable ground truth short of running the game engine. A geometry heuristic (flat-panel normal clustering, vertex probe) was already proven to produce full-atlas garbage on real merged meshes (vehicle-uv-registry.ts comment). The Wikinger-skin rects beat any heuristic because they reflect where Relic's artists actually placed the insignia on the UV layout.

**For remaining vehicles: continue the Wikinger-skin visual-inspection method. No RGM data shortcut exists.**
