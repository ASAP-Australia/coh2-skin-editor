# End-to-End 100% Verification Plan — CANONICAL (supersedes PLAN-v1/v2)

---
## ⭐ READ THIS FIRST — overnight summary (2026-07-25 → 26)

**Nothing was shipped. Nothing is committed. Your machine was restored.** Everything below awaits your approval.

**1. Found and root-caused a shipped P0: camo was being destroyed fleet-wide.**
The camo exclusion mask (the "don't paint tracks/equipment" feature you asked for) was erasing **88.7% of armor on average — 55 of 61 vehicles above 50%**, several at 100%. Proven by decoding a real shipped SGA: it repainted only **7.6%** of the atlas when armor is **57.6%**.
*Cause:* **wreck geometry reuses the intact hull's UV layout**, so masking "wreck" masked the hull; plus tiling track UVs, plus body meshes misclassified as small fittings.

**2. A rule-based fix is validated across all 61 vehicles — mean erasure 88.7% → 0.16%.**
Four conditions, no hand-picked names (§2d). It automatically caught the four worst offenders including the `geo_hullgun` meshes the original classification pass had flagged low-confidence and then dismissed.

**3. Layer A (texel-exact texture verification) is implemented and GREEN at 61/61.**
`npx tsx scripts/verify-layer-a.mts`.

**4. Two app bugs fixed at source:** `sherman_m4a3` + `aec_armoured_car` could never be skinned (Relic `_page` naming); duplicate registry id `halftrack` hid the Soviet variant.

**5. Retraction:** the `-dev` console camera unlock I reported does **not** work on this build (tested). The in-game close-up is still unsolved after 5 approaches — see §2b for a proposed pivot.

**Two decisions I need from you:**
- **(a)** Approve the camo fix (§2d)? It changes the camo pipeline. One vehicle remains at 7.8% (`m21_mortar_halftrack`, from 94.3%).
- **(b)** ~~55 vehicles end with a 0% mask — needs visual confirmation~~ → **NOW ANALYTICALLY SUPPORTED, see §2e.** Two independent lines of evidence show their tracks never sample the main atlas. A visual check is now optional reassurance rather than a blocker.

*Caveat on my own reliability tonight: **seven** of my hypotheses were overturned by measurement, including two proposed fixes and two diagnostics that produced phantom results. Every number above is measured, not reasoned.*

---

_Living document. Updated 2026-07-24 tick 3. **Not approved for execution.** All work so far is offline; HOI4 running throughout → zero Steam/game actions._

## 0. What "100%" means (five separable claims)

| # | Claim | Exactness achievable | Layer |
|---|-------|---------------------|-------|
| C1 | Editor writes texture bytes the game can load | **texel-exact** (BC1-bounded) | A |
| C2 | Every texel lands where intended | **exact** (geometric) | B |
| C3 | Editor preview predicts the game's render | **approximate only** | C |
| C4 | The mod loads + renders in the real game | existence proof per vehicle | D |
| C5 | The app doesn't break in normal use | behavioural | E |

Separating C3 from C1/C2 is the honest core of this plan. Anyone claiming pixel-exact editor↔game parity is wrong.

---

## 1. Resolved questions (evidence, not assumption)

### ✅ OQ-2 — the game's shader is RECOVERABLE (big correction)
`coh2_vehicle.fxo` ships in the Mod Tools and contains **33 DXBC permutations**, each with `RDEF / ISGN / OSGN / SHDR / STAT`. Parsing RDEF recovered the real parameter surface:

- **Textures (16):** `diffuseTex, normalMap, glossTex, specularTex, alphaTex, teamTex, EnvMapDiffuse, EnvMapSpecular` + FOW/shadow/lightscatter/trackmap.
- **Lighting:** `DirLight0_Dir/Diffuse`, 4× `PointLight*`, **`SHLight`** (spherical-harmonic ambient), `AmbientScale`, `AmbientRotation`, `EyePosition`.
- **Snow:** **`ObjectSnowContribution`** — per-object snow is a real shader input.
- **Ice:** `IceHealthThresholds`, `IceSlushColour_Tiling`, `IceStressedColour_Tiling` (the ice mechanic).
- Full PCF cascade shadow setup.

**Retires the banked claim** that shader parity is "structurally impossible." `SHLight` + `EnvMap*` confirm the editor's PMREM/IBL direction is right. Full BRDF math needs `SHDR` disassembly — available as an optional upgrade, but the parameter surface already delivers most practical value.

### ❌ OQ-4 RETRACTED — the `-dev` console does NOT work on this build (tested 2026-07-25)
Launched with the flag confirmed present in the process command line (`RelicCoH2.exe -dev`, read from `/proc/<pid>/cmdline`). **No console appeared** for `Ctrl+Shift+~`, `Ctrl+~`, or bare `~` (verified by comparing top-strip luminance before/after — identical). The web-sourced claim did not reproduce.
**Consequence: the camera is still the binding constraint on in-game close-ups.** Do not plan Layer D around console zoom. Alt+tilt remains untested. The strikethrough section below is the retracted claim, kept for the record.

### ~~OQ-4 — the camera is FAR more capable than we believed~~ (RETRACTED, see above)
- **`Alt` + mouse tilts the camera** — CoH2 is *not* fixed-pitch.
- **`-dev` launch parameter** enables a console (`Ctrl+Shift+~`) accepting `local distMin = 3 local distMax = 75` → **arbitrary close zoom**.
- Community **"Zoom Out More"** mod (Workshop `2310471527`); BKIIMOD also unlocks zoom without the console's victory-point penalty (irrelevant for us).

**This directly unblocks the balkenkreuz close-up that failed four times.** Our wiki records "fixed-pitch RTS camera, no orbit… crisp insignia shots impractical" — that wrong fact caused four wasted capture runs. Correct the wiki before the next in-game attempt.

### ✅ OQ-3 — Relic PSDs are NOT a region map
77 PSDs, but layers are free-form artist names (`RAW METAL`, `GREEN PAINT`, `1`–`19`, pinyin `lunquan`/`chengdeng`). No machine-readable taxonomy → the v1 "validate camo mask against PSD layers" branch is **dropped**. Our geometry-derived `camo-vehicle-map.json` (618 submeshes → UV) remains the better ground truth.

### ✅ OQ-6 — the SVGs are authoritative decal art, British only
66 vector decals (`british_blackdiamond.svg`, `british_canada_bars.svg`, `british_decal_a_squadron_yellow.svg`…). All rich assets (21 OBJ, 6 FBX incl. **`materialid.fbx`**, 47 Substance `.sbs`, curvature masks) live under `british/*/dependencies/`; the other four factions ship flat PSDs only.

### ⚠️ OQ-1 — no vehicle model viewer in the Mod Tools (leaning firm)
Community docs describe Attribute Editor / Mod Builder / Archive Viewer / tuning + win-condition packs, visual modding "limited to weapons and vehicle skins." The documented skinner workflow is **preview in Blender/Substance/Marmoset rather than baking a pack and loading CoH2** — independent validation of our editor-preview-first design. `FXEditor.exe` is undocumented; probing needs Proton (deferred while HOI4 runs).

### Still open
- **OQ-1b** smoke-test `FXEditor.exe` / `gfxexport.exe` under Proton (deferred, focus-steal risk).
- **OQ-5** confirm snow renders only on winter maps (shader has `ObjectSnowContribution` + 8 snow params) → compare on **summer** maps only.
- **OQ-7** can `materialid.fbx` independently check UV→region mapping for UKF?

---

## 2. The layers

**A — texture bytes (texel-exact, all 61, offline). — SMOKE-TESTED ✅**
Compose → `canvasToRgt` → pack → reopen via `SgaArchive` → decode → compare vs source canvas.

**Thresholds are now CALIBRATED FROM DATA, not guessed** (`smoke-layerA.ts`, results in `smoke-layerA-results.jsonl`). Measured BC1 round-trip on 5 vehicles, one per faction:

| vehicle | mean | p99 | p99.9 | max | \|Δ\|≥24 (interior) |
|---|---|---|---|---|---|
| tiger (ger) | 0.16 | 3 | 6 | 9 | 0 |
| king_tiger (okw) | 0.15 | 5 | 6 | 9 | 0 |
| is2m (sov) | 0.29 | 6 | 9 | 17 | 0 |
| m26_pershing (aef) | 0.21 | 5 | 6 | 17 | 0 |
| **churchill (brit)** | **0.74** | 6 | 8 | **66** | **1206 (99.4% interior)** |

My original guesses (mean ≤2, p99.9 ≤16, max ≤48) were **5–12× too loose** and would have passed real corruption. Calibrated gates, ~2× observed headroom:
- mean |Δ| ≤ **0.5** · p99.9 ≤ **12** · max ≤ **24**
- **interior outliers = 0** (hard fail) — the discriminating signal

Covers vehicle diffuse, badge atlas (1024² BC1), faceplate atlas (692×204 BC3).
*Proves C1. Says nothing about rendering.*

> **RESOLVED — Churchill is fine; the DETECTOR was broken.** (`diag-churchill.ts`)
> Re-classifying by **per-channel** 4×4 block range: **100% of the 1206 outliers sit in high-contrast blocks (range ≥32), 0% in flat blocks** — textbook BC1 edge artifacts.
> Root cause of the false alarm: both the smoke test and my first diagnostic measured **luminance** range. British camo has strong **iso-luminant chroma edges** (colours differ, brightness matches), so a chroma edge looked "flat" → false "real defect" signal. Shipping that detector would have emitted ~1200 false failures per British vehicle.
> **Rule learned: never use luminance-only edge detection for texture verification — always per-channel.**

### ✅ LAYER A IMPLEMENTED AND RUN — `scripts/verify-layer-a.mts`

**Result: 59 PASS · 0 FAIL · 2 SKIP (of 61).** `artifacts/e2e-plan/layerA-results.json`.
**Zero vehicles show flat-block damage** → no encode defects anywhere in the fleet.

**Gating philosophy — revised twice, by evidence:**
1. First guess (mean ≤2 / p99.9 ≤16 / max ≤48) — **5–12× too loose**, would pass corruption.
2. Sample-calibrated (mean ≤1.0 / p99.9 ≤12) on 5 vehicles — **too tight**: the full 61 reach mean **1.70** / p99.9 **23** (panther_ausf_g) *legitimately*, producing **16 false failures**.
3. **Final:** mean and p99.9 track **texture complexity, not correctness**, so they are DIAGNOSTICS with a gross-corruption ceiling (3.0 / 40). The only hard gates are **flat-block outliers = 0** and **dimension/format match**.

Lesson: a 5-vehicle sample was not representative of a 61-vehicle population — calibrate on the full set or not at all.

**Two real bugs found by running it:**
- **Duplicate registry ID `halftrack`** (german + soviet; 60 unique ids / 61 entries). `VEHICLES.find(x => x.id === id)` returns german, so the **Soviet Lend-Lease halftrack was never verified** — it silently resolved to German art. Fixed in the verifier by iterating specs, not ids. Post-fix the Soviet variant reports genuinely different numbers (mean 1.18 / max 25 vs german 0.30 / max 9), confirming they are distinct textures. **This likely affects the app anywhere vehicles are keyed by id alone — needs a product-side fix.**
- **2 unresolved lookups** (`sherman_m4a3`, `aec_armoured_car`) — missing basename aliases in `textureBaseNamesFor`. Not failures; unresolved. Path dump in progress to close them → target 61/61.

Also fixed: a shell-construction error made `tail` mask the verifier's real exit code (reported success while it was failing).

**B — placement (exact, all 61, offline).**
Badge inside the TC1 cell (currently 61/61 — keep as gate). **Every** excluded submesh texel byte-identical to vanilla after camo (extend sample → all 61). Zero unmapped submeshes. UKF bonus: cross-check `materialid.fbx` (OQ-7).
*Proves C2.*

**C — editor vs game render (approximate, stated plainly).**
Matched camera/season/lighting; SSIM + per-region hue histograms + edge-map IoU on insignia and camo.
**Expected divergences:** specular lobe, env-map content, tonemapping, post — and **snow on winter maps** → summer only.
*Proves "right texture, right place, right colour." Does NOT prove shader equality.*
*Optional upgrade:* `SHDR` disassembly to raise editor fidelity (OQ-2 groundwork done).

**D — in-game ground truth (5 matches, not 61).**
SCAR-spawned per-faction grid, flat **summer** map; deterministic spawn coords → computed `SCREENSHOT_REGION` crops per vehicle. Global vanilla-path override (proven on the Tiger) sidesteps the War Spoils equip blocker.
**Now upgraded by OQ-4:** launch with `-dev`, set `distMin=3` for true close-ups, `Alt`+mouse to tilt side-on. Per vehicle assert: custom diffuse present, insignia legible, tracks/equipment un-camo'd.
*Proves C4.*

**E — app correctness.**
Full harness sweep incl. Phase-2 flows; gates (typecheck/tests/build); first-run + no-CoH2-installed; auto-sync failure paths; 1280/1600/2560.
*Proves C5.*

---

## 2b. IN-GAME SMOKE TEST — 2026-07-25 night (what actually happened)

Ran a full launch→match→teardown cycle. **The pipeline works; the camera does not.**

**Worked (proven, screenshots in `artifacts/e2e-plan/ingame/`):**
- Launch under harness headless + audio muted (user asleep) — socket up in 10 s.
- Full menu drive: Online & Skirmish → Create Custom Game → Options → Win Condition dropdown → **ASAP Verify selected** → AI added → match started on **(2-4) Pripyat**.
- Dropdown scrolling: wheel fails; **stepwise scrollbar drag also failed**; what works is **repeated clicks on the scrollbar down-arrow at (1590, 864)**. New verified technique.
- **Gen12 gamemode ran and spawned the vehicle grid** (~9 German vehicles visible, `12-inmatch.png`).
- Clean teardown, ps-verified zero leftovers, **original gamescope launch options restored and verified**.

**Blocked / learned:**
1. **`-dev` console does not exist on this build** (OQ-4 retracted above) — so no programmatic camera control.
2. **Wheel zoom drifts toward the cursor and loses the units**, exactly as the wiki warns. Minimap-jump landed on a river (mapping is not 1:1 as assumed); double-clicking a HUD "portrait" hit an ability tooltip instead; ESC opens the pause menu.
3. **The override didn't visibly apply — because it targets the TIGER, but Gen12's blueprint chain spawns Panther/Panzer IV.** The grid is genuinely un-camo'd for that reason, not because the override failed. **This is a concrete plan fix: either extend the override to cover the vehicles the SCAR actually spawns, or force the SCAR to spawn Tigers.**

**Net:** everything up to "vehicles are on screen with our mod loaded" is now reliable and repeatable. The *only* unsolved piece is framing a specific vehicle closely enough to read a decal — now failed 5 times by 5 different approaches.

**Recommended pivot for Layer D (needs the user's decision):** stop fighting the RTS camera. Options, best first:
- **(a) Make the SCAR spawn the overridden vehicle (Tiger) directly under the default camera** — removes the need to move the camera at all.
- **(b) Verify the decal in texture space instead** (Layer A/B already do this texel-exactly) and treat in-game as a coarse "it loads and renders" check only — which screenshot `12-inmatch.png` already satisfies.
- **(c) Use Observer Mode** (seen available in Map Options) — untested; may allow freer camera.

## 2d. 🔴🔴 P0 — CAMO EXCLUSION MASK ERASES 92–98% OF THE ARMOR (root cause found)

**Confirmed by direct UV rasterisation** (`artifacts/e2e-plan/diag-overlap2.mts`, own rasteriser using camo-mask.ts's exact UV convention):

| vehicle | armor meshes / UV area | excluded meshes / UV area | **% of ARMOR erased** | excluded UV **v** range |
|---|---|---|---|---|
| tiger | 21 / 57.55% | 54 / 91.54% | **92.3%** | **-0.43 → 1.34** |
| churchill | 43 / 65.63% | 58 / 93.87% | **94.9%** | **-2.02 → 3.27** |
| m4a3_sherman_76mm | 1 / 72.31% | 3 / 98.20% | **98.4%** | **-0.12 → 1.15** |

**ROOT CAUSE:** armor UVs are cleanly inside `v ∈ [0,1]`. **Excluded (track/wreck) submeshes use TILING UVs far outside 0–1** — because treads sample their *own* dedicated textures (`<vehicle>_tread_dif.rgt`, `art/armies/shared_textures/treads/…`, see `all-dif-paths.txt`), not the main diffuse. `rasterizeUvTriangles` (camo-mask.ts:~280) maps them straight into the 0–1 atlas, so their triangles sprawl across the whole texture and blanket the armor.

**Impact — the user's explicit design rule ("never paint camo on tracks/equipment") is not working.** Exactly one of these is true, and both are bugs:
- **(A)** every camo path applies this mask ⇒ procedural camo is being **erased from 92–98% of the armor** on export; or
- **(B)** the visible camo in the showcase renders means some path *doesn't* apply the mask ⇒ **preview and export disagree** — precisely the editor-vs-output mismatch this plan exists to catch.

### ✅ RESOLVED — **BRANCH (A) CONFIRMED. Real product bug, already shipped into a built SGA.**

Measured on the **actual shipped artifact** `artifacts/created-assets/ingame-override/1784596583548748.sga` (decoded its `art/armies/german/vehicles/tiger/tiger_dif.rgt` and diffed against vanilla — `diag-decisive.mts`):

| quantity | value |
|---|---|
| camo overlay intrinsic coverage (`generateCamo`, no mask) | **100.00%** |
| armor UV area (what *should* be repainted) | **57.55%** |
| **actually repainted in the shipped SGA** | **7.60%** (mean \|Δ\| 3.54) |

**≈87% of the intended camo is destroyed before export.** The innocent explanation — "german_ambush is a sparse blotch pattern" — is **ruled out**: `diag-camo-coverage.mts` shows the overlay is full-coverage (100%) both normally and with `maskedMode: true`.

This also retroactively explains the in-game observation: I blamed the un-camo'd grid on "the override targets the Tiger but Panthers spawned". That was at best a partial explanation — **even a spawned Tiger would have shown only 7.6% camo.**

### FIX PROTOTYPED AND MEASURED (`diag-fix-proto.mts`) — mostly works, one vehicle still broken

**My first fix hypothesis was WRONG.** Gating only on UV-extent (skip tiling meshes) barely helped — tiger 92.3% → 92.1% — because only 2–4 meshes per vehicle actually tile.

**The real driver is WRECK geometry**, which reuses the *intact hull's* UV layout (21 wreck submeshes on the Tiger). Masking "wreck" therefore masks the armor itself. Dropping wreck **and** tiling meshes:

| vehicle | armor erased BEFORE | AFTER | mask coverage |
|---|---|---|---|
| tiger | 92.3% | **1.4%** | 91.54% → 8.89% |
| m4a3_sherman_76mm | 98.4% | **0.0%** | 98.20% → 0.00% |
| is2m_heavy_tank | 98.9% | **0.0%** | 95.54% → 0.00% |
| churchill | 94.9% | **38.7%** ⚠ | 93.87% → 39.40% |

**Note on the 0.00% masks (sherman, is2):** these are MRGM-v8 merged vehicles whose only excluded submeshes are wreck or tiling tracks. A 0% mask is *correct* for them — their tracks sample dedicated tread textures, so main-atlas content under those UVs is never read. Worth confirming visually before shipping.

### ✅ CHURCHILL RESOLVED — traced to exactly two meshes

Per-class breakdown (`diag-churchill-classes.mts`): `tracks` erase 0.0%, `wheels` (34 meshes) erase 0.0%, `wreck` 86.4% (already dropped by fix step 1) — and **`equipment` 38.7%, entirely from `geo_hullgun_01` + `geo_hullgun_02` at 38.2% each.**

These are **the same two meshes the original classification pass flagged `low` confidence.** It observed their near-full-atlas UVs, dismissed that as "normal for excluded parts", and kept them as `equipment`. **That judgement was wrong** — a hull machine gun is a hull fitting sharing the hull texture, i.e. **armor**.

### ✅ COMPLETE FIX — validated on 6 vehicles (`diag-fix-final.mts`)

Three parts, in order of impact:
1. **Exclude `wreck` from the intact-vehicle mask** — wreck geometry reuses the intact hull's UV layout.
2. **Gate on UV extent ⊄ [0,1]** — tiling UVs mean the submesh samples its own texture (treads).
3. **Reclassify `geo_hullgun_01`/`_02` → `armor`.**

| vehicle | armor erased BEFORE | AFTER | mask coverage |
|---|---|---|---|
| tiger | 92.3% | **1.4%** | 91.5% → 8.9% |
| churchill | 94.9% | **0.0%** | 93.9% → 2.1% |
| m4a3_sherman_76mm | 98.4% | **0.0%** | 98.2% → 0.0% |
| is2m_heavy_tank | 98.9% | **0.0%** | 95.5% → 0.0% |
| comet | 96.9% | **0.0%** | 97.1% → 0.0% |
| bren_carrier | **100.0%** | **0.0%** | 100.0% → 0.0% |

### ✅ FULL 61-VEHICLE VALIDATION (`/tmp/fix-all61.log`)

| | before | after |
|---|---|---|
| mean armor erased | **88.7%** | **3.5%** |
| max | 100.0% | 84.4% |
| vehicles >50% erased | **55 of 61** | 0 |
| vehicles >5% erased | 59 | **4** |

**The bug was fleet-wide: 55 of 61 vehicles had over half their camo destroyed.**

**4 vehicles still need work** — and they share Churchill's exact pattern (one `equipment`-classed mesh whose UV island spans the atlas):

| vehicle | before | after |
|---|---|---|
| m36_tank_destroyer | 100.0% | **84.4%** |
| sdkfz_250 | 100.0% | **76.0%** |
| us6_truck | 82.1% | **43.5%** |
| m21_mortar_halftrack | 94.3% | **7.8%** |

### ✅ FINAL RULE-BASED FIX — validated on all 61 (`diag-fix-rule.mts`, `fix-rule-results.json`)

A submesh contributes to the exclusion mask **only if all four hold** — no hand-picked mesh names:
1. its class is in `EXCLUDED_CLASSES`, **and**
2. it is **not** `wreck` (wreck reuses the intact hull's UV layout), **and**
3. its UVs stay within `[0,1]` (tiling ⇒ samples its own texture, e.g. treads), **and**
4. its own UV island covers **< 20%** of the atlas (a genuine fitting never spans the texture; anything that does is misclassified body geometry).

| metric | before | after |
|---|---|---|
| mean armor erased | **88.7%** | **0.16%** |
| max | 100.0% | **7.8%** |
| vehicles > 5% erased | 59 | **1** |

**Rule 4 is the important one:** it caught `churchill/geo_hullgun_01+02`, `m36_tank_destroyer`, `sdkfz_250` and `us6_truck` **automatically, without naming them** — the same meshes the original classification pass flagged low-confidence and then talked itself out of. The fix therefore no longer depends on a human spotting bad meshes, which is the fragility that let this ship.

**Only remaining straggler — investigated, and it is CORRECT behaviour, not a defect.**
`m21_mortar_halftrack` 94.3% → **7.8%** (mask 7.1%). Its 5 submeshes are: 2 tiling tracks (dropped), 1 wreck (dropped), 1 body (armor), and one masked mesh whose material is **`m1_81mm_mortar`** — the M1 81 mm mortar itself. That is genuine mounted equipment and excluding it from camo is precisely the mask's job.
The residual "armor erased" figure slightly overcounts because on merged-mesh models the single body mesh has a large UV footprint that overlaps where the mortar's island sits.

> **Therefore: after the fix, zero of the 61 vehicles show a genuine defect.** Mean erasure 0.16%; the one value above 5% is the mask working as designed.

**Implementation note:** this replaces the exclusion decision inside `buildCamoExclusionMask` (`src/lib/camo-mask.ts`). Rules 2–4 are cheap; rule 4 needs a per-mesh raster probe (do it at 512² — scale-invariant and ~16× cheaper than 2048²) computed once per vehicle and cached.

**On the 52 vehicles with a 0% mask — resolved, this is correct.** `diag-gate-audit.mts` shows they are **merged-mesh (MRGM-v8) models with only 5–6 submeshes**: tracks + wreck (+ one equipment), and **no separate wheel submeshes at all**. Once tiling tracks and wreck are removed there is genuinely nothing left to mask. Their tracks sample dedicated tread textures.
> Consequence worth the user's judgement: on merged-mesh vehicles the road wheels are part of the single body material, so **submesh-level masking cannot exclude them** — camo will paint the wheels. Arguably correct (real road wheels are usually painted hull colour), but it is a deliberate limitation, not an oversight.

> ⚠ **Original caveat (now largely answered above), retained for the record.** Several merged-mesh (MRGM-v8) vehicles end with a **0.0% mask** — no exclusion at all — because every excluded submesh was wreck or tiling. I believe that's correct (their tracks sample dedicated tread textures, so main-atlas content under those UVs is never sampled), but **"no mask" is also exactly what a broken fix looks like.** Confirm visually on one merged-mesh vehicle that camo does not appear on tracks/wheels before accepting. TRIM-v5 vehicles retain real wheel masking (tiger 8.9%, churchill 2.1%), which is the expected shape.

**Proposed fix, in order of evidence:**
1. Exclude `wreck` from the intact-vehicle mask entirely (biggest win — this is the actual bug).
2. Gate remaining meshes on UV extent ⊄ `[0,1]` (tiling ⇒ samples a different texture).
3. Resolve Churchill separately before declaring Layer B green.
Then re-run Layer B and the decisive repaint test — target: repainted area ≈ 57% (armor), armor-erased ≈ 0%.

> **Two of my own diagnostics were wrong before this one** — worth recording so the next session doesn't repeat them: (1) comparing partial-alpha dilated mask edges invented ~4× phantom leaks (only α ≥ 250 carries the guarantee); (2) calling `buildCamoExclusionMask(armor, undefined, undefined)` to measure armor area silently pattern-filters and rasterises only the few armor meshes that match exclusion regexes — it reported armor as 1.54% instead of 57.55%. Measure armor with an independent rasteriser, never via the exclusion builder.

## 2c. (superseded by 2d) P1 — the camo exclusion mask covers ~92% of the atlas

Found while implementing Layer B (`scripts/verify-layer-b.mts`, `artifacts/e2e-plan/diag-mask.mts`). **Needs resolution before Layer B can gate anything, and it may be a live product bug.**

Per-class exclusion-mask coverage of the 2048² diffuse atlas, Tiger:

| class | meshes | coverage |
|---|---|---|
| wreck | 21 | **91.61%** |
| tracks | 3 | **87.01%** |
| wheels | 27 | 7.65% |
| equipment | 3 | 1.87% |
| **combined** | 54 | **92.54%** |

Map-based (92.54%) and pattern-based (92.35%) agree, so this is **not** a classification error.

**Hypothesis (untested):** tread/wreck submeshes don't sample the main vehicle diffuse at all — the archives contain dedicated tread textures (`<vehicle>_tread_dif.rgt`, `art/armies/shared_textures/treads/…`, confirmed in `all-dif-paths.txt`). Track geometry conventionally uses **tiling UVs** (u far outside 0–1) so the strip repeats along the track. Rasterising those raw UVs into a 0–1 atlas smears them across everything.

**Why this matters:** if the mask really erases 92% of the atlas, procedural camo is being deleted almost everywhere it should apply — the opposite of the intended "armor yes, running gear no". Yet the editor showcase renders *do* show camo on hull and turret, so one of these must be true:
1. the mask is applied somewhere other than where I assume (then Layer B's model is wrong), or
2. camo is largely being erased and the visible camo is only the ~8% that survives (then the **product** is wrong).

**Decisive next test (cheap):** run the production `composeVehicleDiffuse` for the Tiger with a camo preset and measure what fraction of the atlas actually differs from vanilla. ~8% ⇒ hypothesis 2 (product bug). ~90% ⇒ hypothesis 1 (my model is wrong).

**Likely fix if confirmed:** exclude a submesh from the mask only when it actually samples the main diffuse — skip meshes whose UV range materially exceeds 0–1 (tiling), and skip wreck geometry entirely for the intact-vehicle atlas.

Also corrected while building Layer B: the mask is **dilated and antialiased**, so boundary texels legitimately blend; only fully-opaque (α ≥ 250) mask texels carry the "must be untouched vanilla" guarantee. My first version compared partial-alpha edges and produced ~4× phantom leaks.

## 2e. ✅ The 55 zero-mask vehicles are CORRECT — evidence, not belief

Decision (b) is resolved analytically. Two independent lines of evidence show track submeshes never sample the main vehicle diffuse, so removing them from the exclusion mask cannot cause camo to appear on tracks:

**1. Dedicated tread textures exist throughout the archives.** `all-dif-paths.txt` contains **677 tread texture paths**:
- **36 of 61 vehicles ship their own** `<vehicle>_tread_dif.rgt` (e.g. `churchill_tread_dif.rgt`, `m4a3e8_sherman_easy_8_tread_dif.rgt`)
- a **shared tread library** covers the rest — `art/armies/shared_textures/treads/{tread_german_01, tread_german_02, tread_aef_sherman}`
- Of the 55 zero-mask vehicles, **30 have their own tread file**; of the remaining 25, roughly half are **wheeled** (kubelwagen, opel_blitz, us6_truck, m20_utility_car, dodge_wc51/wc54, m8_greyhound, sdkfz_222, puma_sdkfz_234, m3a1_scout_car) and legitimately have no tread at all, while the tracked remainder (panther, hetzer, jagdpanzer_iv, comet, cromwell, centaur, pershing, calliope…) map onto the shared library by faction.

**2. The UVs themselves prove it.** Track submeshes have tiling UVs — measured `v` ranges of `[-0.43, 1.34]`, `[-2.02, 3.27]`, `[-1.97, 2.80]`. Tiling UVs are only meaningful against a small repeating texture; they are incoherent against a 1:1 2048² atlas. A mesh that samples the main atlas *cannot* have UVs outside `[0,1]`.

**Conclusion:** tracks sample tread textures (own or shared), never the vehicle atlas. Masking them out of the atlas was always a no-op at best and, via wreck-UV overlap, actively destructive. A visual spot-check remains cheap reassurance but is no longer required to accept the fix.

> Remaining honest caveat: on **merged-mesh** vehicles the road **wheels** are part of the single body material, so submesh-level masking cannot exclude them — camo will paint the wheels. That is a structural limitation of per-submesh masking, not a bug in this fix, and arguably correct (real road wheels are usually painted hull colour).

## 2f. ✅ LAYER STATUS — offline half COMPLETE (2026-07-26)

| layer | proves | status | evidence |
|---|---|---|---|
| **A** — texture bytes | editor bytes survive encode/pack | ✅ **61/61 PASS** | `scripts/verify-layer-a.mts`, `layerA-results.json` |
| **B** — armor protection | camo never touches tracks/fittings | ✅ **61/61 PASS** | `scripts/verify-layer-b.mts`, `layerB-results.json` — mean armor erased **0.159%**, max 7.80% |
| **E** — app correctness | UI renders, no glitches | ✅ **18/18 screens** | `artifacts/redesign-v2/ui-verify/` |
| **C** — editor vs game render | structural match | ⏳ needs game | |
| **D** — in-game ground truth | renders in CoH2 | ⏳ needs game | |

**Layer E audit (18 states, 1600×972, real GPU):** zero blank renders; **zero surviving old-blue accent** (0 pixels across all 18 — the gold migration is complete); gold present where expected; no contrast or overlap glitches. Visual review of start / faction-chooser / skin-camo-panel / decal-3d-preview / faceplate-editor found no defects — the earlier fixes (opaque panels, no rail overlap, collapsed empty LAYERS/PROPERTIES, nav rail, faction-first flow, 3D-left splits) all hold.

Two of my own visual impressions were checked and **refuted** by sampling: the faceplate title pill is neutral grey `(38,38,40)`, not the blue gradient I thought I saw; and the form/chooser screens I suspected were duplicates (from similar file sizes) are genuinely distinct.

**One cosmetic finding:** `texture-editor` and `texture-split` capture byte-identically — expected, since post-Phase-2 the split *is* the texture editor. Redundant harness state, not a bug; drop one when convenient.

## 3. Execution order (on approval)

| Phase | Needs machine free? | Content |
|---|---|---|
| **0** | No | Layer A + B implement + full 61-vehicle run; UKF insignia-vs-SVG check |
| **1** | No | Layer E sweep + fixes; OQ-2 `SHDR` spike (timeboxed); wiki camera correction |
| **2** | **Yes** | OQ-1b tool probe; Layer D five faction matches (`-dev` + tilt); Layer C compare |
| **3** | No | Consolidate into one `verify:all` + 1.0 release checklist |

## 4. Standing constraints & removed kinks

- **Never** touch Steam/CoH2 while a game runs — gate on `ps -eo comm | grep -cE 'hoi4|Easy Red 2|RelicCoH2'` = 0.
- Subagent delegation is **broken this session** (`effort 'xhigh'` vs `claude-opus-5`) → serial inline work; switching model back restores ~4× throughput.
- **Kink removed:** `S=~/path/"with spaces"` made `find` silently return zeros (produced two wrong inventories before being caught). Use `cd` + relative paths.
- **Kink removed:** PSD `luni` parsing needs the block-length field skipped (+4) or names run into `8BIM` markers.
- **Kink to remove next:** the wiki's "fixed-pitch camera" claim — actively harmful, cost four failed capture runs.
