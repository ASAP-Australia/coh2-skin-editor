# End-to-End 100% Verification Plan — v1 (DRAFT, not approved for execution)

_Created 2026-07-24. Iterating until the user says it's perfect. **No execution until explicit approval.**_

## 0. Definition of done

"This app works end to end 100%" is decomposed into five falsifiable claims:

| # | Claim | Provable how | Exactness achievable |
|---|-------|--------------|---------------------|
| C1 | The editor writes texture bytes the game can load | round-trip decode of every produced RGT/SGA | **texel-exact** (bounded by BC1 loss) |
| C2 | Every texel lands where the author intended | UV/TC1 + mask analysis per vehicle | **exact** (geometric) |
| C3 | The editor's 3D preview predicts the game's render | matched-camera capture + structural compare | **approximate only** (see §4) |
| C4 | The mod loads and renders in the real game | live capture in CoH2 | **existence proof, per-vehicle** |
| C5 | The app doesn't break in normal use | UI sweeps, gates, error paths | behavioural |

Anyone claiming "100%" without separating C3 from C1/C2 is overclaiming. This plan is explicit about which layer proves what.

---

## 1. Discoveries that change the approach (verified this session)

These were found by inspecting the machine, and they materially improve what's possible:

### 1.1 The CoH2 Mod Tools are ALREADY INSTALLED (AppID 313220, 199 MB, StateFlags=4)
`~/.steam/steam/steamapps/common/Company of Heroes 2 Tools/`
Ships: `ArchiveViewer.exe`, `AttributeEditorXML.exe`, `ModBuilder.exe`, `Burn.exe`, `FXEditor.exe`, `gfxexport.exe`.
Per prior wiki knowledge the tools have **no DRM** → launchable without closing Steam (unlike the game). **Not yet verified whether any of them renders a textured vehicle** — see Open Question OQ-1.

### 1.2 Relic's OWN source art ships with the tools — `toolsdata/skins/`
**77 layered PSDs** (per faction: aef 17, british 22, german 13, soviet 12, west_german 13), up to **616 MB** each, plus **21 `.obj`**, **6 `.fbx`**, **47 Substance `.sbs`**, **66 `.svg`**, 15 `.tga`, 131 `.png`.

This is ground truth for the user's "get every pixel right" requirement: Relic's own layer structure tells us definitively which atlas regions are hull/panels/tracks/stowage — something we currently *infer* via `camo-vehicle-map.json`. Cross-checking our 618-submesh classification against these PSDs is the strongest possible validation, and the `.svg`s may be the authoritative insignia artwork.

### 1.3 The game's vehicle shader DECLARATION is on disk
`assets/data/shaderdatabase/coh2_vehicle.shader` authoritatively confirms:
- **Textures**: `diffuseTex, alphaTex, normalMap, glossTex, specularTex, teamTex, teamColour(Vector4f), EnvMapDiffuse(Dynamic), EnvMapSpecular(Dynamic)`
- **Vertex components**: `Position, Normal, Tangent, Binormal, UV0, UV1` → **authoritative proof of the two-UV-channel model** the badge pipeline relies on.
- **EnvMap\*** confirms the game uses image-based lighting → validates the editor's PMREM approach.

**This corrects an earlier banked conclusion.** The prior shader-fidelity assessment said parity was "structurally impossible" because the shader wasn't shipped. In fact `coh2_vehicle.fxo` (compiled, ps40 + ps50) **is** shipped — inside a "Relic Chunky" container. `coh2_vehicle.fxstr` leaks the permutation keys in plaintext, including `teamtex`, `teamcolour`, `camoflauge`, `self_reflection`, `snowdiffusetexture`, `snownormaltexture`, `snowsparkles*`, `depthtexture`, `dirlight0_dir`. Recovering the actual math is now a *tractable reverse-engineering task*, not an impossibility.

**Consequence:** the game applies **dynamic snow** to vehicles on winter maps (8 distinct snow params). The editor does not model this → editor-vs-game comparison must be done on a **summer** map, or snow must be modelled. This is a real, previously-unknown source of mismatch.

### 1.4 CheatCommands Mod II — a faster path to arbitrary vehicles
Steam Workshop **692412438** (Janne252). Infinite resources/popcap, instant production, **Ctrl+Q spawns a unit at the mouse**, teleport, invulnerability, copy/paste entities. Selected via the **Wincondition dropdown in a Custom Game** — the *same slot* as our ASAP Verify gamemode, so the two are mutually exclusive in one match.

Verdict: our SCAR gamemode stays primary (deterministic, scripted, zero clicking, repeatable). CheatCommands is the **manual fallback / independent cross-check**, and the better tool for the user personally.

---

## 2. Layer A — texture-space exactness (target: 100% automated, all 61 vehicles)

Proves **C1**. Fully offline, no game, no GPU.

For every vehicle × season:
1. Compose the diffuse exactly as the editor does (`composeVehicleDiffuse`).
2. Encode via `canvasToRgt` → the bytes that go into the SGA.
3. Read back with the repo's RGT decoder; also re-open through `SgaArchive` so we test the *packed* bytes, not just in-memory.
4. Compare decoded ↔ source canvas per texel.

**Thresholds** (BC1 is lossy, so naive equality is wrong):
- mean |Δ| per channel ≤ **2/255**
- 99.9th percentile |Δ| ≤ **16/255**
- max |Δ| ≤ **48/255**, and outliers must be adjacent to a high-contrast edge (BC1 block artifacts) — flag any isolated interior outlier as FAIL
- alpha (BC3 paths): exact where the source is 0 or 255

Same for the **badge atlas** (1024² BC1) and the **faceplate atlas** (692×204 BC3).
Output: `artifacts/verify/layerA-<date>.json` + a per-vehicle table; any FAIL blocks release.

## 3. Layer B — placement exactness (target: 100% automated)

Proves **C2**. Extends `verify-unwrap-analytical.mts`.
- Badge lands inside the TC1 cell for all 61 (already passing 61/61 — keep as a gate).
- **Camo exclusion correctness**: for every vehicle, every texel under a `tracks/wheels/equipment/wreck` submesh must be byte-identical to vanilla after camo compose. Currently asserted for a sample; extend to **all 61 × all excluded submeshes**.
- **NEW — validate our classification against Relic's PSDs** (§1.2): where a PSD exists (77 of them), compare our submesh classification to Relic's own layer/region structure. Any disagreement is a real bug in `camo-vehicle-map.json`.
- Submesh coverage: no vehicle has un-mapped submeshes (already enforced by test).

## 4. Layer C — editor render vs game render (honest limits)

Proves **C3**, and only approximately. **Cannot be made pixel-exact** — different renderer, different BRDF, tonemapping, post-processing.

Method: capture the same vehicle from a matched camera/season/lighting in (a) the editor via the Electron harness and (b) the game via the SCAR gamemode + harness `SCREENSHOT_REGION`; then compare with **structural** metrics — SSIM on luminance, per-region hue histograms, and edge-map IoU for the insignia and camo pattern.

**Expected, acceptable differences:** specular lobe shape, env-map content, tonemapping, fog/post, and **snow on winter maps** (§1.3).
**What it proves:** the right texture is on the right vehicle in the right places with the right colours.
**What it does NOT prove:** shader-level equality.

*Upgrade path (optional, high value):* disassemble `coh2_vehicle.fxo` to recover the real BRDF and raise the editor's fidelity. Scoped separately as **OQ-2** — potentially large payoff, unknown effort.

## 5. Layer D — in-game ground truth (the C4 existence proof)

Minimum sufficient evidence, **not** 61 separate matches:
- One SCAR-driven match per **faction** (5 matches) spawning that faction's full vehicle set in a grid on flat open ground, summer map.
- Per match: one wide grid shot + per-vehicle `SCREENSHOT_REGION` crops driven by the known spawn coordinates (deterministic, so crops can be computed, not hunted).
- Assert per vehicle: custom diffuse present (not vanilla), insignia present where expected, tracks/equipment un-camo'd.

**Global override mechanism** (already proven for the Tiger) avoids the War Spoils equip blocker: override the vanilla art path in `mods/skins/` so every spawned vehicle shows the custom texture with no loadout interaction.

## 6. Layer E — application correctness (C5)

Full 14+ screen harness sweep incl. the Phase-2 flows, gates (typecheck/tests/build), first-run + no-CoH2-installed paths, auto-sync failure paths, multi-resolution (1280/1600/2560).

---

## 7. Open questions to resolve before this plan is final

- **OQ-1** Does any Mod Tool render a textured vehicle (FXEditor viewport? gfxexport?) — would give game-shader inspection **without launching the game**, hugely reducing disruption. *Needs: web research + a careful non-destructive smoke test.*
- **OQ-2** Can `coh2_vehicle.fxo` (Relic Chunky → DXBC) be disassembled to recover the BRDF? Effort vs payoff.
- **OQ-3** Do the 77 PSDs actually encode region semantics usable for automated cross-check, or are they too free-form? *Needs: open 2–3 headlessly and inspect layer names.*
- **OQ-4** Camera/inspection freedom in-game: zoom/pitch limits, any free-cam or HUD-hide. *Needs: web research (not yet done).*
- **OQ-5** Winter/snow: confirm snow only renders on winter maps and that summer capture avoids it entirely.
- **OQ-6** Are the `.svg`s in `toolsdata/skins/` the authoritative insignia artwork? If so, our insignia library should be validated against them.

## 8. Kinks already removed

- Subagent delegation is **broken this session** (`effort 'xhigh'` incompatible with `claude-opus-5`); all research must run inline, or the user switches model back. Plan must not assume parallel agents.
- Steam/game work is **gated** behind a not-gaming check; nothing in Phase 1–3 touches Steam.
- The "shader parity impossible" assumption is retired (§1.3).
- The "no way to inspect without launching" assumption is now questionable (OQ-1).

## 9. Proposed execution order (on approval)

1. **Phase 0 (zero risk, no game):** OQ-3 + OQ-6 PSD/SVG inspection; Layer A + B implementation and full run.
2. **Phase 1 (no game):** OQ-1/OQ-2 smoke tests on the Mod Tools; Layer E app sweep + fixes.
3. **Phase 2 (needs machine free):** Layer D — 5 faction matches, capture + assert; Layer C comparison.
4. **Phase 3:** consolidate into a single re-runnable `verify:all` command + a release checklist for 1.0.
