# Skin-Template Rendering Coverage Audit
_All 61 CoH2 vehicles — read-only, 2026-06-19_

## Key: how a skin template is applied

1. **`customDiffuseUrl`** (project.ts) stores the single 2048² body-diffuse PNG baked from the chosen stock/workshop skin template.
2. The overlay canvas is only bound to materials where **`__usesBodyDiffuse === true`**.
3. `__usesBodyDiffuse` is set to `true` for submeshes whose `tokenFor(mat)` returns `''` (body) OR `'turrets'`. It is **NOT** set for `'panels'`, `'tread'`, `'wreck'`, or `'schurzen'`.
4. The export pipeline (`mod-export.ts:composeVehicleDiffuse`) writes **one RGT** — the body diffuse — per vehicle per season. It never writes a separate `_turrets_dif` or `_panels_dif` RGT.

---

## Atlas taxonomy (derived from tokenFor + textureSets + code comments)

| Token | Sub-atlas | Overlay bound? | Export written? |
|-------|-----------|----------------|-----------------|
| `''`  | Body `_dif` | YES (`__usesBodyDiffuse=true`) | YES (only one) |
| `turrets` | Dedicated `_turrets_dif` **or** body atlas shared | YES (`__usesBodyDiffuse=true`, falls back to body diffuse when no dedicated `_turrets_dif` found) | NO (separate turrets RGT never written) |
| `panels` | Dedicated `_panels_dif` | **NO** (`__usesBodyDiffuse=false`) | NO |
| `tread` | Tileable `_tread_dif` | NO | NO |
| `wreck` | `_wreck_dif` | NO | NO |
| `schurzen` | None (no TSET) | NO | NO |

---

## Per-vehicle atlas layout

### Category A — Single body atlas, fully covered (54 vehicles)

The vast majority of vehicles have no separate `_turrets_dif` TSET. The `turrets` token fallback path in `getTexturesForMaterial` resolves to the **body diffuse** when no dedicated turret atlas exists (`findTset(p => tokenRe('turrets').test(p) && /_dif$/.test(p))` returns null), and then falls through to `bodyCache?.diffuse`. Because `__usesBodyDiffuse = true` for turrets token as well, the overlay canvas is already applied. These vehicles are **fully covered** by a single body template.

| Faction | Vehicle IDs |
|---------|-------------|
| OstHeer | `tiger`, `elefant`, `ostwind_flak_panzer`, `panzerwerfer`, `halftrack` (german), `sdkfz_250`, `sdkfz_222`, `opel_blitz` |
| OKW | `king_tiger_sdkfz_182`, `jagdtiger`, `sturmtiger`, `panther_ausf_g`, `jagdpanzer_iv_sdkfz_162`, `panzer_iv_sdkfz_ausf_i`, `hetzer`, `puma_sdkfz_234`, `panzer_ii_luchs_sdkfz_123`, `kubelwagen`, `halftrack_sdkfz_251`, `halftrack_sdkfz_251_flak`, `halftrack_sdkfz_251_infrared` |
| Soviet | `is2m_heavy_tank`, `isu152`, `kv1_heavy_tank`, `kv2_heavy_tank`, `t34_76`, `t_34_85`, `t70m_light_tank`, `su85`, `su-76m`, `m3a1_scout_car`, `halftrack` (soviet), `us6_truck` |
| USF | `m26_pershing`, `m4a3e8_sherman_easy_8`, `m4a3_sherman_76mm`, `m4a1_sherman_calliope`, `m10_tank_destroyer`, `m36_tank_destroyer`, `m5a1_stuart`, `m8_greyhound`, `m7b1_priest`, `m3_halftrack`, `m15a1_aa_halftrack`, `m8a1_hmc`, `m20_utility_car`, `m21_mortar_halftrack`, `dodge_wc51`, `dodge_wc54_ambulance`, `sherman_m4a3` |
| UKF | `churchill`, `comet`, `cromwell`, `centaur`, `sherman_firefly`, `valentine`, `sexton`, `aec_armoured_car`, `bren_carrier` |

**Count: ~59 of 61** (pending exact verification of StuG III and Brummbär — see Category B)

---

### Category B — Confirmed separate sub-atlas (2 vehicles, AT RISK)

#### 1. `stug_iii` (OstHeer, medium)
- **TSET layout**: Has both `stug_iii_dif` (body) AND `stug_iii_turrets_dif` (superstructure/gun shield).
- `tokenFor` correctly routes the `sug_iii_turrets` material (Relic typo — missing 't') to `'turrets'` token.
- **Viewport rendering**: The turrets token with a dedicated `_turrets_dif` TSET **finds** it successfully (line 3429: `difPath = findTset(p => re.test(p) && /_dif$/.test(p))`). So the turret mesh renders from its own atlas, **not** the body diffuse.
- **`__usesBodyDiffuse`**: set to `true` for `'turrets'` token (line 3613). So the overlay canvas IS bound to the turret mesh.
- **PROBLEM — EXPORT**: `mod-export.ts:composeVehicleDiffuse` writes ONLY `stug_iii_dif.rgt`. It never writes `stug_iii_turrets_dif.rgt`. In-game, the turret sub-atlas path is baked into the .rgm TSET as `art\armies\german\vehicles\stug_iii\stug_iii_turrets_dif`. The CoH2 engine loads the skin pack's `stug_iii_dif.rgt` for the hull but falls back to the **vanilla** `stug_iii_turrets_dif.rgt` for the superstructure — so the superstructure stays in its original camo while the hull shows the new skin.
- **PROBLEM — VIEWPORT PREVIEW**: The overlay canvas is a 2048² single-atlas canvas painted over the body diffuse UV layout. The turret's UVs map into a _different_ atlas (`stug_iii_turrets_dif`), not the body atlas. When the user paints on the body canvas and the overlay is bound to both hull and turret (via `__usesBodyDiffuse=true` for turrets), the turret mesh samples the body-diffuse UV canvas at turret-atlas UV coordinates. This will render garbled/misaligned texture on the superstructure in the editor preview, AND will show vanilla turret in-game because no turret RGT is written to the export.

#### 2. `brummbar` (OstHeer, heavy)
- **TSET layout**: Has `brummbar_dif` (body) AND `brummbar_panels_dif` (front fighting-compartment panels — confirmed from code comments lines 3349-3353).
- `tokenFor` routes `Brummbar_Panels` material to `'panels'` token.
- **`__usesBodyDiffuse`**: NOT set for `'panels'` token. So the overlay canvas is **not** bound to the panels mesh.
- **PROBLEM — VIEWPORT PREVIEW**: When a skin template (custom diffuse) is applied, the hull gets the new texture. The `Brummbar_Panels` submesh is bound to its own `brummbar_panels_dif` atlas from the game files — it stays at the vanilla game texture always. So the panels show vanilla camo while hull shows the applied skin.
- **PROBLEM — EXPORT**: No `brummbar_panels_dif.rgt` is ever written to the export SGA. In-game, the panels sub-atlas falls back to vanilla. The superstructure panels stay vanilla while the hull shows the skin.
- **Season handling**: `__seasonPaint = true` for `'panels'` token (line 3618), so winter re-skinning correctly swaps the panels atlas (it does a TOC scan for `_panels_dif.rgt` in winter skin folders). However this is irrelevant for the skin template coverage gap.

---

### Category C — Schurzen (side skirts) — intentionally un-textured

Several German/OKW vehicles (Panther, StuG III, Pz IV, Hetzer, King Tiger) have schurzen side-skirt submeshes. These have no dedicated TSET. `tokenFor` returns `'schurzen'`, `__usesBodyDiffuse=false`, no export RGT. This is **intentional** — the editor leaves them as Three.js default grey. They are a separate cosmetic mesh with no texture in stock CoH2 skin packs.

Affected vehicles (schurzen meshes but NOT a coverage bug): `panther_ausf_g`, `stug_iii`, `panzer_iv_sdkfz_ausf_i`, `hetzer`, `king_tiger_sdkfz_182`.

---

## Summary table

| Category | Count | Description | Coverage status |
|----------|-------|-------------|-----------------|
| A — body-only, single atlas | 59 | All turret/panel UVs share body atlas, OR turrets fall back to body diffuse | FULLY COVERED |
| B1 — stug_iii turrets (separate atlas) | 1 | `stug_iii_turrets_dif` is a real distinct TSET; turret UV layout is NOT the body atlas | AT RISK: overlay misaligns in preview, turret stays vanilla in export |
| B2 — brummbar panels (separate atlas) | 1 | `brummbar_panels_dif` is a real distinct TSET; panels UV layout is NOT the body atlas | AT RISK: panels stay vanilla in preview AND in export |
| C — schurzen (no atlas) | ~5 vehicles with skirt meshes | No TSET, intentionally grey | INTENTIONAL, not a bug |

**Total at-risk vehicles: 2 (stug_iii, brummbar)**

---

## Open questions (not resolvable without actual SGA access)

- The code only explicitly documents two separate-atlas vehicles (StuG III turrets, Brummbär panels). There may be additional vehicles with separate `_turrets_dif` TSETs that the code doesn't call out explicitly (e.g. some Soviet heavies with KV turrets, or British Churchill with its many variants). These would only show the `stug_iii`-class bug if `findTset(tokenRe('turrets'))` finds a match — which routes them to turret-token lookup rather than body fallback. Without scanning the actual SGAs, the code can only confirm the two documented cases.
- The `__usesBodyDiffuse = true` for `'turrets'` means that IF a vehicle has a separate `_turrets_dif` atlas AND the editor is in overlay mode, the overlay (which is painted on body-atlas UV space) gets incorrectly mapped onto the turret mesh using turret-atlas UVs. This is a latent bug for any vehicle where `findTset(tokenRe('turrets'))` successfully finds a turret TSET.

---

## Recommended fixes (audit only — do not implement here)

### Fix 1 — StuG III turret (and any other vehicle with a genuine separate `_turrets_dif` TSET)
**Problem**: `__usesBodyDiffuse = true` for `'turrets'` regardless of whether the turret uses a body-shared atlas or a dedicated one. The overlay canvas (body-UV-space) gets bound to a mesh whose UVs reference a different atlas.

**Fix**: Make `sharesBodyAtlas` conditional. After `findTset(tokenRe('turrets'))` runs, set `sharesBodyAtlas = (difPath === null)` — i.e., only fall back to body diffuse (and mark `__usesBodyDiffuse`) when NO dedicated turret atlas was found. When a dedicated turret atlas EXISTS, set `__usesBodyDiffuse = false` so the overlay canvas is not bound to the turret.

**Export fix**: Add a second compositing pass in `exportSkinPack` for vehicles where the model's TSET contains `_turrets_dif`. Either (a) apply the body template's turret-region pixels (if the author painted a turret atlas), or (b) copy the vanilla `_turrets_dif.rgt` verbatim into the export so the in-game turret at least renders its stock texture (not the body template stretched over turret UVs).

### Fix 2 — Brummbär panels (and any vehicle with a genuine separate `_panels_dif` TSET)
**Problem**: `__usesBodyDiffuse = false` for panels, so the overlay is never bound. The panels always show vanilla, even when the user has applied a skin template to the hull.

**Fix option A (expose panels painting)**: Add a second 2048² editable canvas for the panels atlas. Bind it to panels-token meshes. Export it as a separate RGT `brummbar_panels_dif.rgt` in the SGA. This gives the user full control over both atlases.

**Fix option B (propagate body template to panels)**: When a skin template is applied, also read the vanilla `brummbar_panels_dif.rgt`, decode it, and composite the same camo pattern (using the panels UV layout) on a second canvas. Export it alongside the body RGT. This ensures the panels at minimum show the template camo in-game without requiring a separate paint surface.

**Fix option C (flag in UI)**: Mark brummbar (and stug_iii) in the vehicle picker with a warning icon indicating the vehicle has a sub-atlas not covered by the current skin template. Let the user know the panels/superstructure will stay vanilla.

---

## Files referenced in this audit

- `/home/jflessenkemper/dev/coh2-skin-editor/src/lib/vehicles.ts` — 61 vehicle catalog
- `/home/jflessenkemper/dev/coh2-skin-editor/src/components/Viewport.tsx` — `tokenFor` (line ~3308), `sharesBodyAtlas` (line ~3499, 4705), `__usesBodyDiffuse` (line 3613, 4736), `__seasonPaint` (line 3618, 4739), overlay canvas binding (lines 3974-3986)
- `/home/jflessenkemper/dev/coh2-skin-editor/src/lib/mod-export.ts` — `composeVehicleDiffuse` (line ~203), single-RGT export path (line ~649-656)
- `/home/jflessenkemper/dev/coh2-skin-editor/src/lib/template-diffuse.ts` — `readWorkshopDiffuseDataUrlBySgaPath` single-dif scan (line ~204)
- `/home/jflessenkemper/dev/coh2-skin-editor/src/lib/uv-wireframe.ts` — NON_BODY_RE confirms turrets/panels excluded from body UV wireframe (line 26)
