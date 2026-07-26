# End-to-End 100% Verification Plan — v2 (DRAFT, supersedes v1, not approved for execution)

_Updated 2026-07-24 tick 2. **No execution until explicit approval.** HOI4 running → zero Steam/game actions taken._

## Changes from v1 (corrections earned by probing, not assumed)

| # | v1 said | v2 says | Why |
|---|---------|---------|-----|
| 1 | Cross-check camo mask against Relic PSD layer structure | **DROPPED** | PSDs hold 113 free-form *artist* layers ("RAW METAL", "GREEN PAINT", "1".."19", pinyin `lunquan`/`chengdeng`) — no machine-readable region taxonomy. Not automatable across 77 files. |
| 2 | 66 SVGs + 21 OBJ + 6 FBX "in toolsdata/skins" | **British-only** | All non-PSD assets live under `british/*/dependencies/`. Other 4 factions ship flat PSDs only. |
| 3 | (n/a) | **New: `materialid.fbx` exists (british)** | A material-ID mesh *is* a region map — the one viable "Relic ground truth" for region semantics, but British-only. |
| 4 | (n/a) | **New process kink removed** | My `S=~/path/"with spaces"` variable silently returned false zeros in `find`. All inventory must use `cd` + relative paths. This produced two wrong counts before I caught it. |

## Answered open questions

- **OQ-3 (PSD region semantics): NO.** Artistic layers only. Ground truth for "which texels are tracks" stays our geometry-derived `camo-vehicle-map.json` (618 submeshes → UV), which is *better* evidence than artist layer names anyway.
- **OQ-6 (are the SVGs authoritative insignia?): YES, for British.** `british_blackdiamond.svg`, `british_canada_bars.svg`, `british_crest_02/03.svg`, `british_decal_a_squadron_yellow.svg`, `british_decal_light_01.svg` etc. — 66 vector decal sources. Our insignia library should be validated against these for UKF; no equivalent exists for the other factions.
- **OQ-1 (Mod Tools model viewer): LEANING NO.** Community docs describe the tools as Attribute Editor / Mod Builder / Archive Viewer / Tuning + Win Condition packs, with visual modding "limited to weapons and vehicle skins"; no vehicle model viewer is described. The documented community workflow is to **preview in a DCC/viewer (Blender, Max, Maya, Substance, Marmoset) rather than baking a pack and loading CoH2** — which validates our editor-preview-first approach. `FXEditor.exe` is undocumented in community sources; probing it requires running a Windows exe under Proton, deferred while HOI4 is live.

## Still open

- **OQ-1b** Smoke-test `FXEditor.exe` / `gfxexport.exe` under Proton (deferred — could steal focus from HOI4).
- **OQ-2** Disassemble `coh2_vehicle.fxo` (Relic Chunky → DXBC) to recover the real BRDF.
- **OQ-4** In-game camera limits / free-cam / HUD-hide (web research not yet done).
- **OQ-5** Confirm snow renders only on winter maps (8 snow params in the shader → real editor-vs-game divergence).
- **OQ-7 (new)** Can `materialid.fbx` + the british OBJ meshes give an independent check of our UV→region mapping for UKF?

## The verification layers (unchanged in shape, sharpened)

**A — texture bytes (texel-exact, all 61, offline).** Compose → `canvasToRgt` → pack → re-open via `SgaArchive` → decode → compare. BC1 is lossy so thresholds not equality: mean |Δ| ≤ 2/255, p99.9 ≤ 16/255, max ≤ 48/255 *and* outliers must sit on high-contrast edges (isolated interior outliers = FAIL). Covers vehicle diffuse, badge atlas (1024² BC1), faceplate atlas (692×204 BC3).

**B — placement (exact, all 61, offline).** Badge inside the TC1 cell (already 61/61 — keep as gate); **every** excluded submesh texel byte-identical to vanilla post-camo (extend from sample → all 61); zero unmapped submeshes. UKF bonus: cross-check against `materialid.fbx` (OQ-7).

**C — editor vs game render (approximate only — stated plainly).** Matched camera/season/lighting, SSIM + per-region histograms + edge-map IoU on insignia and camo. **Expected divergences:** specular lobe, env-map content, tonemapping, post — and **snow on winter maps**, so compare on summer only. Proves "right texture, right place, right colour"; does **not** prove shader equality. Optional upgrade: OQ-2.

**D — in-game ground truth (5 matches, not 61).** SCAR-spawned per-faction grid on a flat summer map; deterministic spawn coords → computed `SCREENSHOT_REGION` crops per vehicle. Global vanilla-path override (already proven on the Tiger) sidesteps the War Spoils equip blocker. Assert per vehicle: custom diffuse present, insignia present, tracks/equipment un-camo'd.

**E — app correctness.** Full harness sweep incl. Phase-2 flows, gates, first-run / no-CoH2-installed, auto-sync failure paths, 1280/1600/2560.

## Execution order (on approval)

0. **Offline, zero risk:** Layer A + B implementation and full 61-vehicle run; UKF insignia-vs-SVG check.
1. **Offline:** Layer E sweep + fixes; OQ-2 fxo disassembly spike (timeboxed).
2. **Needs machine free:** OQ-1b tool probe; Layer D five faction matches; Layer C comparison.
3. **Consolidate:** single `verify:all` command + 1.0 release checklist.

## Standing constraints

- Never touch Steam/CoH2 while HOI4 (or any game) is running — gate every phase on `ps -eo comm | grep -cE 'hoi4|Easy Red 2|RelicCoH2'` = 0.
- Subagent delegation is broken this session (`effort 'xhigh'` vs `claude-opus-5`) → plan assumes serial inline work unless the user switches model.
- Use `cd` + relative paths for all filesystem inventory (see correction #4).
