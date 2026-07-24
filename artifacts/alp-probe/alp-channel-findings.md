# CoH2 `_alp` vehicle texture channel — investigation findings

**Status: CLOSED. Recommendation: DEFER — safe to leave `_alp` unwired.**
The evidence is decisive and the reason is stronger than "the pixels don't matter":
**no `_alp.rgt` file exists for any CoH2 vehicle at all.** The channel is *declared*
in every vehicle RGM's TSET table but the file is never packed into the shipping
Art SGAs. There is nothing to load. Closes `shader-fidelity-assessment.md §2 #4`.

Investigation date: 2026-07-20. All decoding used the repo's own decoders
(`src/lib/sga.ts`, `src/lib/rgt.ts` / `rgt-core.ts`, `src/lib/bc-decode.ts`) so the
pixels match exactly what the editor would see.

---

## ASSETS FOUND (paths)

**Vehicle `_alp.rgt` files: ZERO.** Exhaustive scan of all 14 CoH2 Art SGAs under
`/var/home/jflessenkemper/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives`:

| SGA | vehicle `.rgt` files | vehicle `_alp.rgt` |
|-----|---------------------:|-------------------:|
| ArtGermanEF.sga | 1255 | **0** |
| ArtWestGerman.sga | 1050 | **0** |
| ArtSovietEF.sga | 1387 | **0** |
| ArtAEFSkins.sga | 1214 | **0** |
| ArtAEF.sga | 398 | **0** |
| ArtBritish.sga | 465 | **0** |
| ArtArmies.sga | 21 | **0** |
| ArtEnvironment.sga | 292 | **0** |
| ArtHigh/Low/XP* (6 SGAs) | 0 | **0** |
| **TOTAL vehicle `_alp.rgt`** | | **0** |

Vehicle-texture suffix tally across all SGAs (`_<suffix>.rgt` under any `vehicles/` path):
`_dif`=3540, `_nrm`=2139, `_gls`=140, `_spc`=140, `_tem`=42, `_drt`=11, `_occ`=7 …
**`_alp`=0.** `_alp` is the ONE canonical channel with zero vehicle instances.

The tiger (canonical hull) base folder ships only two files:
- `art/armies/german/vehicles/tiger/tiger_dif.rgt`  (ArtGermanEF.sga)
- `art/armies/german/vehicles/tiger/tiger_nrm.rgt`  (ArtGermanEF.sga)

`_spc`/`_gls` DO ship, but only as per-skin variants nested under
`vehicles/<v>/skins/<skinguid>_summer|winter/` (e.g.
`art/armies/german/vehicles/halftrack/skins/german_0018_summer/halftrack_spc.rgt`).
`_alp` appears in **none** of those skin subfolders either — checked exhaustively.

**The only `_alp.rgt` files that exist anywhere** (30 total, all non-vehicle):
environment / building masks — e.g.
`art/environment/buildings/eastern_rural/shared_textures/decals/decal_eastern_rural_alp.rgt`,
`art/armies/aef/structures/shared_textures/aef_camo_net_alp.rgt`,
plaster / ribbons / accessories / camo-net cutouts. These are building & prop
alpha/cutout masks, unrelated to the `coh2_vehicle` shader.

### Why the reveng docs said `tiger_alp` exists
The RGM *names* it. Raw scan of `art/armies/german/vehicles/tiger/tiger.rgm`
(ArtHigh.sga) shows these TSET path strings baked into the model:
`tiger_dif | tiger_alp | tiger_gls | tiger_nrm | tiger_spc`.
So `4-material.md:27` (`VAR type=9 alphatex → …\tiger_alp`) is correctly reporting a
**TSET declaration string**, not a shipped file. This matches the wiki note
(`llm-wiki/wiki/concepts/sga-rgt-format.md:259`: *"TSET references texture path
only"*) — the engine resolves the path at load time and simply gets nothing for
`_alp`, `_spc`, `_gls` on vehicles like the tiger whose skin folder doesn't author them.

---

## DECODE RESULTS

**No vehicle `_alp` texture could be decoded because none exists.** The main probe
(`scripts/probe-alp-channel.mts`) searched 6 representative vehicles (tiger hull,
king tiger, panther turret, halftrack, T-34, Sherman) across their faction SGAs and
found `_alp.rgt` for none of them — output for every target was
`NO _alp.rgt found`. `alp-probe-summary.json` records all six as `found:false`.

To characterise what CoH2's `_alp` channel-*type* is (since only building instances
exist), the two closest-available real `_alp` masks were decoded
(`scripts/probe-alp-env-decode.mts`):

| Texture | Dims | Format | Channels | Histogram / makeup |
|---------|------|--------|----------|--------------------|
| `decal_eastern_rural_alp` (building decal) | 2048×2048 | DXT5 (code 15) | RGB near-black (R 0–74), **alpha carries the signal** | Alpha bimodal: ~304k px at 0, large mass at 128–255. A **coverage / opacity mask** — where the building decal is painted vs transparent. |
| `aef_camo_net_alp` (camo net) | 1024×1024 | DXT1 (code 13) | Alpha flat 255, RGB full-range (0–255) | Opaque; RGB is a colour/pattern map. A cutout/colour mask for the net prop. |

**Correlation cross-checks (vehicle):** not computable — with no vehicle `_alp` to
correlate against `_dif`/`_spc`, the spatial-correlation step is moot.

Conclusion from the type sample: CoH2's `_alp` channel is a genuine
**alpha / coverage / cutout mask** (transparency-style), used on buildings, decals,
ribbons, camo nets and plaster. It is emphatically **not** a hidden spec or
team-colour channel — CoH2 has dedicated channels for those (`_spc`, `_tem`).

---

## LIKELY ROLE (+ evidence)

For **vehicles specifically**, `_alp` has **no role, because it is never authored**:
- 0 files across 14 SGAs and every `vehicles/**` + `skins/**` subfolder (evidence:
  suffix tally, exhaustive scan).
- Only declared as a TSET path string in the RGM (evidence: tiger.rgm string scan).

As a **channel type** (from the building instances that do exist), `_alp` is a
**transparency / coverage / cutout alpha mask** — opacity, not specular, not team
colour (evidence: `decal_eastern_rural_alp` alpha is a bimodal coverage mask; RGB is
inert). On opaque vehicle hulls such a mask has no surface to act on, which is almost
certainly why Relic authored `_dif`+`_nrm` (+ optional per-skin `_spc`/`_gls`) for
vehicles and left `_alp` unshipped despite the shared shader declaring the slot.

This supersedes the assessment's tentative guess ("likely a spec/decal mask"): the
correct answer is "an opacity mask channel-type that vehicles never ship."

---

## RECOMMENDATION — DEFER (leave `_alp` unwired)

**Do not wire `_alp` into the editor's `MeshPhysicalMaterial`.** There is nothing to
wire: fetching `<vehicle>_alp.rgt` would 404 on every one of the 61 vehicles (the
`readByPath` would return `null`, exactly as it does today for the un-requested file).
Wiring it would add dead fetch/decode paths and an `alphaMap`+`transparent:true`
pairing that could only *introduce* bugs (spurious transparency, sorting artifacts)
while never binding a real texture.

The editor at `src/components/Viewport.tsx:3795–3849` already wires every vehicle
channel that actually ships:
- `map` ← `_dif` (sRGB albedo)
- `normalMap` ← `_nrm` (DX→GL via `normalScale.y=-1`)
- `roughnessMap` ← inverted `_gls`
- `specularIntensityMap` + `specularColorMap` ← `_spc`

That is the complete shipped set. `_alp` is not a gap.

**If a future capture ever shows a vehicle with visible transparency/cutout** (none is
known — hulls are opaque), the correct wiring *at that point* would be
`alphaMap: subAlp` + `material.transparent = true` + `alphaTest`, since the channel
type is an opacity mask. But that is hypothetical: no such asset exists in the base
game, so there is no fidelity delta to recover. This is a true defer, not a deferral
of convenience — the pixels (all zero of them) say it cannot change what renders.

Also worth banking (out of scope but adjacent): per-skin `_spc`/`_gls` live under
`vehicles/<v>/skins/<guid>_summer|winter/`, and the tiger/king-tiger *base* folders
ship neither — so those vehicles legitimately render with no spec/gloss map, which is
expected, not a bug.

---

## ARTIFACTS WRITTEN (paths, all under `artifacts/alp-probe/`)

- `alp-channel-findings.md` — this report.
- `alp-probe-summary.json` — the 6-vehicle probe result (all `found:false`).
- `env_decal_eastern_rural.png` — decoded building decal `_alp` (2048², DXT5) —
  shows the alpha coverage mask; representative of the CoH2 `_alp` channel type.
- `env_aef_camo_net.png` — decoded camo-net `_alp` (1024², DXT1).

Probe scripts (READ-ONLY, under `scripts/`):
- `probe-alp-channel.mts` — decode + histogram + correlate vehicle `_alp` (found none).
- `probe-alp-inventory.mts` — suffix tally across all 14 SGAs; proves `_alp`=0 for vehicles.
- `probe-alp-anywhere.mts` — any `_alp.rgt` anywhere + tiger.rgm TSET string scan.
- `probe-spc-gls-coverage.mts` — where `_spc`/`_gls` live (per-skin subfolders).
- `probe-alp-env-decode.mts` — decode the building `_alp` masks to characterise the type.

No `src/` rendering code was modified.
