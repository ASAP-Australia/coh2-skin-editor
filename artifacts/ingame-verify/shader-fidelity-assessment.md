# CoH2 Skin Editor — Shader-Fidelity Assessment

**Question:** How closely does the editor's Three.js 3D vehicle rendering match the in-game `coh2_vehicle` material pipeline, and what are the ranked, fixable divergences?

**Scope:** Research + design only. No app/game code was modified; the app and game were not launched. All game-side facts are cited to reverse-engineered archive dumps or the llm-wiki; all editor-side facts are cited to `src/components/Viewport.tsx` (and `src/lib/scene-settings.ts`) at exact line numbers.

**Verdict up front:** The editor is **much closer to parity than the task premise assumed.** It is *not* a flat `MeshStandardMaterial` with a diffuse+normal only. It already loads and wires **four** of the game's five vehicle texture channels (`_dif`, `_nrm`, `_spc`, `_gls`) into a `MeshPhysicalMaterial`, with PMREM image-based lighting, neutral tone mapping, correct sRGB/linear color-space handling, and DX→GL normal-Y inversion. The remaining divergences are real but mostly **medium/low** severity. There is **no** high-severity "wrong shader" bug — the biggest single visible defect is the King Tiger cobalt wheel quirk, which is a texture-routing bug, not a shader bug.

---

## 0. Ground truth: the game's `coh2_vehicle` material pipeline

Source: `artifacts/respec_audit/decal-coverage/reveng/3-game-shaders.md`, `.../4-material.md` (binary MTRL decode of `tiger.rgm`, `t34_76.rgm`, `m4a3e8_sherman_easy_8.rgm`, 2026-06-19), and the llm-wiki page `coh2-vehicle-decal-rendering.md`.

The living-hull shader is **`coh2_vehicle`** (compiled `coh2_vehicle.fxo`, 280 KB in `Data.sga`; HLSL source not shipped). Its static texture/param slots and the Tiger's bindings:

| Slot | Type | Tiger binding | Role |
|---|---|---|---|
| `diffuseTex` | Texture | `tiger_dif` | Albedo (sRGB) |
| `alphaTex` | Texture | `tiger_alp` | Alpha / dedicated mask channel (`_alp.rgt`, separate file) |
| `normalMap` | Texture | `tiger_nrm` | Tangent-space normals (DX convention, Y-down) |
| `glossTex` | Texture | `tiger_gls` | Gloss (high = smooth/polished) |
| `specularTex` | Texture | `tiger_spc` | Specular intensity/tint |
| `teamTex` | Texture | `german\badges\default_dif` | Badge/national-insignia atlas, sampled through **UV1 (TEXCOORD1)** |
| `teamColour` | Vector4f | all-zero in base files | RGBA tint applied to the badge sample; engine overrides at draw with player colour |
| `EnvMapDiffuse` | Texture (Dynamic) | engine cubemap | IBL diffuse |
| `EnvMapSpecular` | Texture (Dynamic) | engine cubemap | IBL specular |

Track submeshes use `coh2_vehicle_uvanim` (drops `teamTex`/`teamColour`, adds animated `diffuse_OffsetU/V`); wrecks use `coh2_object`.

**Key structural facts that matter for parity:**
1. CoH2 is a **spec/gloss** material model (Blinn-Phong-ish, `_spc` + `_gls` as *separate* textures), **not** modern metalness/roughness Cook-Torrance PBR. Confirmed by the two-texture split (`glossTex` AND `specularTex`) and by `Viewport.tsx:3789-3800`.
2. `teamColour`/`teamTex` in the base game files is **all-zero (no tint)** and only ever recolours the **badge**, not the hull paint. So "player-colour tinting of the whole vehicle" is **not** a thing in CoH2 — the hull colour is entirely baked into `_dif`. This means the editor is *correct* to leave the body untinted. (Wiki: `coh2-vehicle-decal-rendering.md`, "teamColour all-zero (transparent/no tint)".)
3. The RGT alpha channel on `_dif` is **not** a gloss/team mask — CoH2 ships a **dedicated `_alp.rgt`** file for that (`alphaTex`). The `_dif` alpha is effectively unused for opaque hull paint. (Reveng `4-material.md:27`.)
4. **`_ocl` (ambient occlusion) is NOT a vehicle channel in CoH2.** Exhaustive check: the 16 TSET entries per vehicle RGM are `_dif`, `_alp`, `_nrm`, `_spc`, `_gls`, `_treads_*`, `_wrecked_*`, `badges/default_dif` (reveng `4-material.md:73`). No `_ocl` appears in any vehicle TSET, MTRL, or shader slot. `_ocl`/occlusion is a **terrain/environment** channel in Essence, not a vehicle one. **The task premise that vehicles ship `_ocl` is not supported by the evidence** — treat "add `_ocl` as aoMap" as a non-goal for vehicles (see §4).

---

## 1. Channel-by-channel table

| Channel | Game's use (cite) | Editor's use (cite `Viewport.tsx`) | Divergence | Workflow impact |
|---|---|---|---|---|
| **`_dif` diffuse** | `diffuseTex`, sRGB albedo; hull paint fully baked in (reveng `4-material.md:26`) | `map`, `colorSpace=SRGBColorSpace`, `flipY=true` (`3474`, `3778`); overlay canvas rebinds live for painting (`RENDERING.md §3c`) | None of substance | — (this is the channel being edited; parity here is critical and present) |
| **`_nrm` normal** | `normalMap`, tangent-space, **DX Y-down** convention (reveng `4-material.md:28`) | `normalMap`, `NoColorSpace`, `normalScale=(1,-1)` to flip DX→GL Y (`3474`, `3779`, `3822-3823`) | Correct. (Note: legacy `RENDERING.md §3b:156` still says `normalScale=(1,1)` — that doc is **stale**; live code at `3823` is `(1,-1)`.) | Low — raised/sunken cues correct |
| **`_spc` specular** | `specularTex`, spec intensity/tint (spec-gloss model) (reveng `3-game-shaders.md:23`) | `specularIntensityMap`, `NoColorSpace`, `specularIntensity=1` when present (`3781`, `3788`) | **Partial.** Bound to `specularIntensityMap` (scalar) only; game may use it as a *coloured* spec tint. `specularColorMap` unused. Also Three.js dielectric F0 is fixed ~0.04 — no `_spc`-driven F0 boost. | Med — painted steel reads slightly flatter than in-game; hue of tinted spec lost |
| **`_gls` gloss** | `glossTex`, high = smooth/polished (spec-gloss model) (reveng `3-game-shaders.md:22`) | `roughnessMap` with RGB **inverted** (`255-x`, floor 26) + `roughness=1` (`3447-3453`, `3780`, `3787`) | Correct inversion; the floor-26 clamp caps min roughness at ~0.10 (prevents mirror hotspots). Reasonable approximation. | Low — highlight tightness slightly off but plausibly matched |
| **`_alp` alpha** | `alphaTex`, dedicated mask file (`_alp.rgt`) (reveng `4-material.md:27`) | **Not loaded.** No `alphaMap`/`_alp` reference anywhere in `src/` (grep negative) | Missing. Its in-game role is unconfirmed (likely spec-mask / decal-mask, not transparency). | Low — no known visible defect on opaque hulls; unquantified |
| **`teamTex` badge** | Badge atlas sampled via **UV1/TEXCOORD1**, tinted by `teamColour` (wiki `coh2-vehicle-decal-rendering.md`) | `injectBadgeShader` onBeforeCompile composites badge via `uv2`, tight-bbox gated (`727-799`, `3834-3858`) | Faithful (Path A, already shipped) | — (already at parity) |
| **`teamColour` tint** | RGBA badge tint; **all-zero (no tint) in base game**; engine sets player colour on the *badge only* (wiki) | `uDecalTint` on badge shader, held at white `(1,1,1)` (`4309`); body untinted | Body-untinted is **correct**. Badge tint is white not faction colour — minor (a TODO at `4309`). | Low — badges render neutral instead of faction-coloured until a pack sets it |
| **`_ocl` occlusion** | **Not a vehicle channel** (absent from all vehicle TSETs; reveng `4-material.md:73`) | Not loaded (comment-only mention in `scene-settings.ts:227`) | **No divergence** — the game doesn't ship it for vehicles | — (non-goal; do not add aoMap for vehicles) |
| **EnvMap (IBL)** | `EnvMapDiffuse`/`EnvMapSpecular` dynamic cubemap | PMREM from CoH2 `ArtEnvironment.sga` cubemap, `scene.environment`, per-material `envMapIntensity=0.3` capped ×0.15 effective (`68-74`, `3801`, `2685`) | Approximated; intensity hand-tuned, not physically matched | Low — reflections present but subtle |
| **Metalness** | N/A (spec-gloss model, dielectric) | `metalness=0` on all vehicle mats (`3783`) | Correct choice for dielectric paint | — |

---

## 2. Ranked divergences (each with concrete fix + effort)

Severity = visible impact on the skin-editing workflow (does a painter see their edit wrong?). Effort = S (<1 h), M (a few hours), L (a day+).

### #1 — King Tiger cobalt-blue wheels (texture-routing bug, NOT a shader bug) — **severity: HIGH (isolated), effort: S — ALREADY FIXED in current code**

**Symptom (from the completeness report):** King Tiger road wheels rendered as saturated cobalt-blue concentric circles.

**Root cause (explained at `Viewport.tsx:3525-3534`):** Wheel submeshes have a material name that did not route through the tread/wheel texture-lookup branch, so they **fell through to the body-diffuse first-match scan**. For the King Tiger, that scan landed on a *wheel-specific atlas whose albedo was authored as a near-flat normal-map blue* (~`rgb(60,90,220)`). A normal map's flat-blue "no perturbation" colour (`(0.5,0.5,1.0)` ≈ blue) was being bound as **diffuse albedo** → the wheels showed that blue directly. It is a *channel/atlas mis-routing* — an `_nrm`-style texture bound into the `map` slot — not a lighting or BRDF error.

**Fix (already in the current tree):** `tokenFor()` at `Viewport.tsx:3547` now routes `wheel`/`wheels`/`tread`/`track` (with non-letter boundaries so `halftrack` is excluded) through the `'tread'` token branch. That branch prefers `*_tread_dif`/`*_wheel_dif` entries and falls back to the dark-gunmetal flat colour (`fallbackColor = 0x2a2c2e`, `3760`) rather than grabbing an arbitrary body atlas. This eliminates the cobalt tint. **Action: verify in Phase B captures that KT wheels now read gunmetal, not blue — then close.**

### #2 — `_spc` bound as scalar intensity, not coloured specular — **severity: MED, effort: S–M**

**Divergence:** `Viewport.tsx:3781` binds `_spc` to `specularIntensityMap` (a **scalar** multiplier on Fresnel). The game's `specularTex` in a spec-gloss model typically carries an RGB specular **colour/tint** (e.g. warmer metal on wear edges). Also, Three.js `MeshPhysicalMaterial` dielectric reflectance F0 is fixed at ~0.04 regardless of `_spc`, so bright `_spc` pixels brighten the highlight *intensity* but not its *strength/hue*.

**Concrete fix:**
- Bind `_spc` **additionally** as `specularColorMap` (RGB tint of the specular lobe) alongside `specularIntensityMap`. Cheap, no decode change (it already decodes as RGBA):
  ```ts
  const mat = new MeshPhysicalMaterial({
    // ...existing...
    specularIntensityMap: subSpec,      // scalar strength (keep)
    specularColorMap: subSpec ?? null,  // NEW: RGB spec tint
    specularColor: new Color(0xffffff), // multiplier base
  })
  ```
  `specularColorMap` reads RGB in sRGB → set `subSpec.colorSpace = SRGBColorSpace` **only for the color-map read**; but since the same texture object also feeds `specularIntensityMap` (which reads the G/linear channel), the safest route is to decode `_spc` **twice** (one linear for intensity, one sRGB for color) or accept the minor color-space compromise. Simplest low-risk version: keep intensity map linear, add `specularColorMap` pointing at the same texture, accept ~gamma error on tint (visually minor). **Effort S** for the naive version, **M** if you split into two correctly-color-spaced textures.
- Optionally raise dielectric F0 for painted steel via `ior` (`MeshPhysicalMaterial.ior`, default 1.5 → try 1.5–1.8) so highlights read a touch stronger — but tune against captures, don't guess.

**Payoff:** painted-steel hulls stop reading slightly matte/flat; spec highlights pick up the authored tint.

### #3 — Badge `teamColour` left white instead of faction colour — **severity: LOW–MED, effort: S**

**Divergence:** `uDecalTint` stays `(1,1,1)` (`Viewport.tsx:4309`, with a `// faction tint can be added later` TODO). In-game the badge is tinted per player colour via `teamColour`. Faction tint constants are already documented in the wiki (`coh2-vehicle-decal-rendering.md`: German/OKW `[0.85,0.76,0.52]`, Soviet `[0.70,0.15,0.10]`, AEF `[0.80,0.65,0.40]`, British `[0.55,0.72,0.40]`).

**Concrete fix:** at `4309`, set `uDecalTint` from a faction→Color map keyed on `vehicle.faction`. One-liner plus a small constant table. **Effort S.** Caveat: in a competitive match the badge colour is the *player-slot* colour, not the faction colour — so this is a "representative preview," not literal parity. Gate it behind the existing decal-alpha so it only shows when a decal pack is active.

### #4 — `_alp` (alphaTex) channel not loaded — **severity: LOW, effort: M (mostly investigation)**

**Divergence:** the dedicated `_alp.rgt` file is never fetched (`grep` negative across `src/`). Its exact in-game semantic is **unconfirmed** — likely a spec/reflectance mask or a decal-region mask, not transparency (hulls are opaque).

**Concrete fix:** first **decode a few `_alp.rgt` files and inspect** (is it 1-channel? correlated with panel edges? with the badge region?). Do NOT wire it blind. If it turns out to be a spec mask, multiply it into `specularIntensityMap` at decode time. If it's a decal-region mask, it may improve badge gating. **Effort M**, and most of that is the investigation — defer until captures show a defect attributable to it.

### #5 — EnvMap / IBL intensity is hand-tuned, not matched — **severity: LOW, effort: M**

**Divergence:** `envMapIntensity=0.3` capped to ~0.045 effective (`Viewport.tsx:71-74`, `3801`). This is an eyeballed value chosen to keep the cubemap hue from bleeding onto paint. The game's dynamic env contribution is scene/weather-dependent and not a constant.

**Concrete fix:** none precise is possible (see §3). Best action is to **tune the constant against Phase B captures** per faction/season, not to change the wiring. **Effort M** (all tuning).

### #6 — Stale `RENDERING.md` §3 misrepresents the live pipeline — **severity: LOW (docs only), effort: S**

`RENDERING.md:121-156` still describes the **old** pipeline: `MeshStandardMaterial`, `metalness:0.05/roughness:0.85`, `normalScale=(1,1)`, and "**NO env map / PMREM**". The live code (`Viewport.tsx:3777` MeshPhysicalMaterial + PMREM IBL + `normalScale=(1,-1)`) contradicts all four. **Fix:** update `RENDERING.md §3` to match, or add a "superseded" banner. Not a rendering defect, but it actively misleads anyone auditing fidelity.

---

## 3. What CANNOT be matched (stated honestly)

Literal parity is impossible (Essence D3D9/11 vs Three.js WebGL). These are structural and should be treated as accepted differences, not bugs:

- **The exact `coh2_vehicle` BRDF.** HLSL source isn't shipped (`.fxo` only). It's a bespoke spec-gloss Blinn-Phong-ish model; Three.js `MeshPhysicalMaterial` is Cook-Torrance GGX metalness/roughness. The gloss→roughness inversion and spec→specularIntensity mapping are *approximations*, not the same math. Highlight shape (Blinn-Phong lobe vs GGX) will always differ subtly.
- **Engine post-processing.** CoH2's final image runs bloom, SSAO, colour grading / LUTs, film grain, vignette, and depth-of-field in cutscenes. The editor deliberately uses neutral tone mapping (`scene-settings.ts:77,132,172`) and no post FX — a paint-editor *wants* an un-graded view so the artist sees true albedo. Matching the graded in-game look would actively harm the editing workflow.
- **Dynamic weather/time-of-day and the real dynamic env cubemap.** `EnvMapDiffuse/Specular` are engine-driven per map/lighting. The editor bakes one static PMREM per preset/season — a fixed stand-in.
- **Real-time GI / bounce lighting, contact hardening shadows, screen-space reflections.** The editor has one shadow-casting key light in the in-game preset (`Viewport.tsx:1105`) and PMREM IBL — no SSR/SSAO/GI.
- **`teamColour` = live player-slot colour.** In a match the badge tint is the player's chosen colour, unknowable at edit time. A faction-representative tint (§2 #3) is the best possible stand-in.

---

## 4. Non-goal called out explicitly

**Do NOT add `_ocl` as `aoMap` for vehicles.** The task brief listed `_ocl` as a vehicle channel, but the evidence (reveng `4-material.md:73`, no `_ocl` in any vehicle TSET/MTRL/shader slot) shows CoH2 vehicles ship no occlusion texture; ambient occlusion for vehicles is baked into `_dif` and/or produced by the engine's SSAO at runtime. Adding an `aoMap` would require a texture that doesn't exist and would double-darken creases already baked into the diffuse. (Occlusion *is* an environment/terrain channel — the `scene-settings.ts:227` comment refers to snow-terrain occlusion, not vehicles.)

---

## 5. Verification plan (how Phase B in-game captures validate/tune the fixes)

Phase B ships harness screenshots of the same vehicles rendered in-game. Use them as follows:

**Setup (identical framing both sides):**
1. Pick a fixed test set spanning formats and factions: **Tiger I** (TRIM v5, German), **T-34/76** (MRGM v8, Soviet), **M4A3E8 Sherman** (AEF), **Cromwell** (fmt=3, British), **King Tiger** (the #1 wheel-quirk victim).
2. In-game: capture each on an open, flat, neutral-lit map (avoid heavy weather/night maps that maximise post-FX divergence), 3/4 front-left view, "Hide Decals" OFF (badges visible). Note faction colour used.
3. Editor: `in_game_field` preset, summer, same 3/4 angle (`~(1,0.45,1)` framing already default), same faction.

**Side-by-side criteria (score each 0–2: match / close / off):**
| Criterion | What to compare | Ties to fix |
|---|---|---|
| Base albedo hue/value | Flat-lit panel colour matches (accounting for the game's colour grade) | `_dif` (baseline; should already pass) |
| Specular highlight presence & tightness | Do hull edges / turret top catch light similarly? | §2 #2 (`_spc`), `_gls` inversion |
| Specular hue on wear/metal | Are highlights neutral-white or tinted like in-game? | §2 #2 (`specularColorMap`) |
| Normal-map relief direction | Do bolts/weld seams read *raised* (not sunken)? | `_nrm` `normalScale.y=-1` (should pass) |
| Wheel/track colour | KT wheels gunmetal, not cobalt | §2 #1 (regression guard) |
| Badge placement + tint | Insignia on correct hull panel; faction-coloured | badge Path A (pass); §2 #3 (tint) |
| Overall brightness | Editor not markedly darker/brighter than in-game mid-tones | env intensity + exposure (`scene-settings.ts`) tuning |

**Tuning loop (bounded, tune constants only — do NOT re-architect):**
- If mid-tones too dark/bright → adjust `exposure` (`scene-settings.ts:85` in_game_field = 1.14) and/or `hemi.intensity`, re-capture editor, re-compare. Bank the chosen values.
- If highlights too weak → raise `ior` and/or verify `specularColorMap` landed (§2 #2).
- If reflections wash paint → lower `envMapIntensity` (`Viewport.tsx:3801`); if too dull, raise. Per-faction if needed (British/AEF already get a 1.3× exposure boost, `Viewport.tsx:854`).
- Record before/after editor crops next to the in-game crop in `artifacts/ingame-verify/` so the tuning is reproducible and diff-able.

**Pass bar:** every criterion ≥ "close" (1) with albedo, normal direction, wheel colour, and badge placement at "match" (2). Perfect specular parity is explicitly *not* required (§3).

---

## 6. Recommendation — implement NOW vs defer

**Implement NOW (high value, low risk, S effort):**
1. **Verify & close #1 (KT wheels)** — the fix is already in the tree; just confirm against a KT capture. This is the single most visible historical defect.
2. **#3 badge `teamColour` faction tint** — one-liner + constant table from the wiki; makes decal previews look correct instead of ghost-white. S.
3. **#2 `_spc` → `specularColorMap` (naive version)** — biggest *material-fidelity* win for the effort; makes painted steel stop looking matte. Start with the single-texture naive bind (accept minor gamma error), then decide if the two-texture split is worth it after seeing captures. S→M.

**DEFER until Phase B captures show a concrete defect:**
4. **#5 env/exposure tuning** — pure constant-tuning; needs the captures to tune *against*, so it can only start once Phase B lands. M.
5. **#4 `_alp` channel** — investigate first (decode + inspect); wire only if captures reveal a defect it explains. M.
6. **#6 RENDERING.md doc refresh** — housekeeping; do it opportunistically. S.

**Explicitly reject:** adding `aoMap`/`_ocl` for vehicles (§4).

---

## Sources

- `artifacts/respec_audit/decal-coverage/reveng/3-game-shaders.md` — `coh2_vehicle` shader slot list; Tiger TSET (`_dif/_nrm/_gls/_spc/_alp`); no decal projector.
- `artifacts/respec_audit/decal-coverage/reveng/4-material.md` — MTRL VAR binary decode (Tiger/T-34/Easy8); 7-var enumeration; 16-TSET list confirming no `_ocl`.
- `/var/home/jflessenkemper/llm-wiki/wiki/concepts/coh2-vehicle-decal-rendering.md` — shader uniform table; `teamColour` all-zero; UV1/TEXCOORD1 badge; faction tint constants.
- `src/components/Viewport.tsx` — material construction (`3438-3873`), spec/gloss decode + inversion (`3447-3453`), MeshPhysicalMaterial params (`3777-3816`), normal-Y flip (`3822-3823`), KT wheel routing (`3525-3547`), badge shader (`702-799`, `4302-4309`), tone mapping/color space (`197-204`, `1095`, `1127`), env/PMREM (`68-74`, `2685`, `3801`).
- `src/lib/scene-settings.ts` — per-preset light recipes, exposure, tone mapping (`63-207`), winter overrides (`244-289`), the `_ocl`-is-terrain comment (`227`).
- `RENDERING.md` — §3 (stale legacy pipeline description; superseded by live code).

## See also

- llm-wiki: `coh2-vehicle-decal-rendering.md`, `coh2-skin-editor-architecture.md`, `rgt-format.md`, `sga-rgt-format.md`.
