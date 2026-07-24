# CoH2 Skin Editor — Model-Completeness Verification Report

_Generated 2026-07-19T00:44:03.740Z_

Pure-Node check (no Electron/GPU). For each of the 61 vehicles it compares three inventories:
**ARCHIVE** (everything the game archives define for the vehicle directory + the RGM-advertised RGTs),
**EDITOR-LOADED** (what the live preview would load — the one RGM per vehicle, its intact submeshes,
and the textures the editor's resolution logic binds per material token), and **PARSE-HEALTH**
(submesh vertex/index sanity, TC0/TC1 presence, and whether each bound texture resolves in the archive).

Archives: `/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives`

**Key architecture fact:** the editor loads exactly ONE `.rgm` per vehicle (`rgmPath(v)`); all
submeshes — body, turret, gun, wheels, tracks, wreck — live inside that single file as TRIM v5 /
MRGM v8 chunks. There are NO separate turret/wreck `.rgm` files to miss. "Missing parts" therefore
means either a submesh the parser drops/can't decode, or a texture the editor's routing fails to bind.

## Summary

| Verdict | Count |
|---|---|
| COMPLETE | 61 |
| GAPS | 0 |
| SKIPPED | 0 |
| **Total** | **61** |

### Intentional exclusions (NOT counted as gaps)

- Destroyed/wreck submeshes + their `_wreck`/`_wrecked` textures (editor renders the intact vehicle only).
- Gameplay variants: AVRE/mortar/croctank/flamethrower turrets, hero-RGM "goblins" crew.
- Seasonal **winter** skins under `skins/*_winter/` (applied post-load by `applySeasonToGroup`, not a load-time miss).
- Schurzen / skirt / side-armour panels (deliberately left untextured → default grey).
- Badge atlas (`art/armies/*/badges/*`) — that is the TC1 decal, handled by the badge shader.
- Non-visual sidecars (`.abp/.mua/.muax/.rpb/.sua/.rga/.rgo/.tset/…`) and exact duplicate submeshes.

## Ranked gap list (fix priority)

_None — every vehicle is COMPLETE._

## Per-vehicle table

| Vehicle | Faction | Archive files | Loaded submeshes | Skipped (intentional) | Draw groups | Body diffuse | Verdict | Gaps | Visual note |
|---|---|---|---|---|---|---|---|---|---|
| tiger | german | 116 | 39 | 36 | 1 | ok | COMPLETE | — | PNG confirms COMPLETE: hull, turret, full gun barrel + muzzle brake, all road wheels, both tracks, camo-textured. No missing parts. |
| elefant | german | 119 | 3 | 2 | 24 | ok | COMPLETE | — | — |
| brummbar | german | 188 | 4 | 1 | 53 | ok | COMPLETE | — | — |
| stug_iii | german | 175 | 4 | 1 | 33 | ok | COMPLETE | — | — |
| ostwind_flak_panzer | german | 175 | 3 | 1 | 46 | ok | COMPLETE | — | — |
| panzerwerfer | german | 114 | 4 | 1 | 30 | ok | COMPLETE | — | — |
| halftrack | german | 120 | 4 | 1 | 33 | ok | COMPLETE | — | — |
| sdkfz_250 | german | 112 | 4 | 2 | 26 | ok | COMPLETE | — | — |
| sdkfz_222 | german | 79 | 1 | 1 | 51 | ok | COMPLETE | — | PNG confirms merged-mesh (loaded=1) renders the WHOLE vehicle: body, 4 wheels, radio-frame antenna, turret basket, stowage, headlights. loaded=1 = one 51-group merged mesh, not a lone body. |
| opel_blitz | german | 78 | 1 | 1 | 38 | ok | COMPLETE | — | — |
| king_tiger_sdkfz_182 | west_german | 81 | 3 | 1 | 32 | ok | COMPLETE | — | PNG confirms COMPLETE: hull, turret, long gun + muzzle brake, interleaved road wheels, tracks all present (one wheel patch shows the known cobalt wheel-atlas tint, Viewport.tsx:3529 — geometry intact). |
| jagdtiger | west_german | 81 | 3 | 1 | 30 | ok | COMPLETE | — | — |
| sturmtiger | west_german | 80 | 3 | 2 | 38 | ok | COMPLETE | — | — |
| panther_ausf_g | west_german | 135 | 3 | 2 | 48 | ok | COMPLETE | — | PNG confirms COMPLETE: hull, turret, long gun barrel, side skirts, wheels, tracks all present (dark from season lighting). |
| jagdpanzer_iv_sdkfz_162 | west_german | 62 | 3 | 1 | 38 | ok | COMPLETE | — | — |
| panzer_iv_sdkfz_ausf_i | west_german | 162 | 3 | 2 | 49 | ok | COMPLETE | — | — |
| hetzer | west_german | 64 | 3 | 1 | 32 | ok | COMPLETE | — | — |
| puma_sdkfz_234 | west_german | 139 | 1 | 1 | 20 | ok | COMPLETE | — | — |
| panzer_ii_luchs_sdkfz_123 | west_german | 79 | 3 | 1 | 25 | ok | COMPLETE | — | — |
| kubelwagen | west_german | 62 | 1 | 1 | 13 | ok | COMPLETE | — | — |
| halftrack_sdkfz_251 | west_german | 62 | 3 | 1 | 38 | ok | COMPLETE | — | — |
| halftrack_sdkfz_251_flak | west_german | 62 | 3 | 1 | 34 | ok | COMPLETE | — | — |
| halftrack_sdkfz_251_infrared | west_german | 62 | 3 | 2 | 27 | ok | COMPLETE | — | — |
| is2m_heavy_tank | soviet | 121 | 3 | 2 | 37 | ok | COMPLETE | — | — |
| isu152 | soviet | 126 | 3 | 2 | 50 | ok | COMPLETE | — | — |
| kv1_heavy_tank | soviet | 125 | 3 | 2 | 45 | ok | COMPLETE | — | — |
| kv2_heavy_tank | soviet | 126 | 3 | 2 | 42 | ok | COMPLETE | — | — |
| t34_76 | soviet | 123 | 3 | 2 | 41 | ok | COMPLETE | — | — |
| t_34_85 | soviet | 124 | 3 | 2 | 30 | ok | COMPLETE | — | — |
| t70m_light_tank | soviet | 134 | 3 | 1 | 35 | ok | COMPLETE | — | — |
| su85 | soviet | 125 | 3 | 2 | 35 | ok | COMPLETE | — | — |
| su-76m | soviet | 116 | 3 | 2 | 53 | ok | COMPLETE | — | — |
| m3a1_scout_car | soviet | 89 | 1 | 1 | 19 | ok | COMPLETE | — | — |
| halftrack | soviet | 173 | 3 | 1 | 66 | ok | COMPLETE | — | — |
| us6_truck | soviet | 90 | 2 | 1 | 50 | ok | COMPLETE | — | — |
| m26_pershing | aef | 74 | 3 | 1 | 54 | ok | COMPLETE | — | — |
| m4a3e8_sherman_easy_8 | aef | 97 | 39 | 26 | 1 | ok | COMPLETE | — | — |
| m4a3_sherman_76mm | aef | 191 | 3 | 1 | 44 | ok | COMPLETE | — | — |
| m4a1_sherman_calliope | aef | 79 | 3 | 2 | 48 | ok | COMPLETE | — | — |
| m10_tank_destroyer | aef | 96 | 3 | 1 | 40 | ok | COMPLETE | — | — |
| m36_tank_destroyer | aef | 99 | 4 | 2 | 38 | ok | COMPLETE | — | — |
| m5a1_stuart | aef | 97 | 35 | 24 | 1 | ok | COMPLETE | — | — |
| m8_greyhound | aef | 73 | 1 | 1 | 22 | ok | COMPLETE | — | PNG confirms merged-mesh (loaded=1) renders the WHOLE vehicle: hull, 6 wheels, open-top turret ring, gun. Nothing dropped. |
| m7b1_priest | aef | 99 | 3 | 1 | 37 | ok | COMPLETE | — | — |
| m3_halftrack | aef | 223 | 4 | 1 | 34 | ok | COMPLETE | — | — |
| m15a1_aa_halftrack | aef | 97 | 3 | 1 | 39 | ok | COMPLETE | — | — |
| m8a1_hmc | aef | 99 | 4 | 1 | 22 | ok | COMPLETE | — | — |
| m20_utility_car | aef | 74 | 1 | 1 | 19 | ok | COMPLETE | — | — |
| m21_mortar_halftrack | aef | 99 | 4 | 1 | 30 | ok | COMPLETE | — | — |
| dodge_wc51 | aef | 73 | 1 | 1 | 14 | ok | COMPLETE | — | — |
| dodge_wc54_ambulance | aef | 75 | 1 | 1 | 14 | ok | COMPLETE | — | — |
| sherman_m4a3 | aef | 97 | 52 | 36 | 1 | ok | COMPLETE | — | — |
| churchill | british | 58 | 68 | 33 | 1 | ok | COMPLETE | — | — |
| comet | british | 56 | 3 | 1 | 39 | ok | COMPLETE | — | — |
| cromwell | british | 54 | 3 | 1 | 28 | ok | COMPLETE | — | PNG confirms COMPLETE: hull, turret, gun, antennae, wheels, tracks all present (MRGM v8, dark from lighting). |
| centaur | british | 65 | 3 | 1 | 25 | ok | COMPLETE | — | — |
| sherman_firefly | british | 66 | 3 | 2 | 45 | ok | COMPLETE | — | — |
| valentine | british | 60 | 3 | 1 | 44 | ok | COMPLETE | — | — |
| sexton | british | 54 | 3 | 2 | 38 | ok | COMPLETE | — | — |
| aec_armoured_car | british | 54 | 1 | 1 | 21 | ok | COMPLETE | — | — |
| bren_carrier | british | 60 | 3 | 1 | 28 | ok | COMPLETE | — | — |

## Problem-vehicle detail

_None._
## Ranked fix-list — resolution logic responsible for each unintentional gap

All routing/gating logic lives in `src/components/Viewport.tsx` (mesh load path) and
`src/lib/rgm.ts` (parser). Relevant sites:

- **`src/components/Viewport.tsx:2993-3196`** — top-level BODY DIFFUSE resolution (`candidates`/
  `DIFFUSE_ALIASES`/`fallbackPaths`/`isBodyPath`). A `body-diffuse-unresolved` gap means this block
  found no `*_dif.rgt`; add the vehicle-specific basename to the `aliases` map (Viewport.tsx:3014).
- **`src/components/Viewport.tsx:3510-3560`** — `tokenFor()` material→token routing. A submesh
  textured wrong (or unrouted) usually means its material name misses a token branch here.
- **`src/components/Viewport.tsx:3616-3659`** — `tokenRe()`/`findTset` per-token texture matching.
  A `submesh-texture-unresolved` / `tread-texture-unrouted` gap points here.
- **`src/components/Viewport.tsx:3703-3720`** — body-atlas fallback + `sharesBodyAtlas` gate for
  turrets. A turret rendering untextured despite sharing the body atlas points here.
- **`src/components/Viewport.tsx:213-323`** — `DESTROYED_PATTERNS` / `isDestroyedMesh`. A submesh
  wrongly filtered as destroyed (→ `no-intact-submeshes` or a missing gun/wheel) points here.
- **`src/lib/rgm.ts:314-362`** — `parseTrimDataV5`. A `no-intact-submeshes` or `degenerate-submesh`
  gap on a whole vehicle means the TRIM v5 packed-stride variant failed to parse (returns empty mesh).
