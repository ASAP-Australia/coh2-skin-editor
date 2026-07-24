# CoH2 Vehicle Decals / National Insignia — Authoring Research

Research date: 2026-07-20. Cross-checked against this repo's `src/`, `artifacts/`, and the
llm-wiki (`/var/home/jflessenkemper/llm-wiki`). Web claims cited by URL; code claims by `file:line`.

---

## TL;DR

- A CoH2 vehicle "decal" = the **national insignia badge** painted on a vehicle (Balkenkreuz for
  Germany, red star for Soviets, white star/roundel for AEF/UKF). It is authored as **one square
  badge image per faction** — NOT a per-vehicle placement. The engine decides *where* it lands on
  each vehicle; the modder only supplies *what* the badge looks like.
- Ground-truth source-art format (verified from the official example pack): **1024×1024, 32-bit
  TGA with full alpha**, one per faction, at `data/art/armies/<faction>/badges/<GUID>/default_dif.tga`.
  The Mod Builder compresses it to a **DXT1/DXT5 `.rgt`** (mipmapped, power-of-two) at build time.
- The engine samples that badge atlas through the vehicle mesh's **TEXCOORD1 (uv2)** channel — the
  placement is baked per-vehicle in the RGM, at UV cluster **U∈[0.286,0.337] × V∈[0.039,0.086]**.
  This is the single most important authoring fact: only a **~5%×5% cell** of your 1024² image is
  what actually shows on the tank. Design for that cell, not the whole canvas.
- Authoring paths: (1) official **CoH2 Mod Tools → Mod Builder → Decal Pack Wizard** (App 379800),
  covers AEF/German/Soviet/West-German; (2) **manual** setup (GIMP/Photoshop → TGA → burn to RGT);
  British (UKF) is community-only. This repo automates the whole thing.
- Design bar is set by **RTS scale**: the badge renders at roughly a handful of pixels on-screen, so
  bold silhouette + high contrast + no fine detail is mandatory. Mushy, low-contrast, or over-detailed
  emblems disappear.

---

## Key Facts (format / dimensions / constraints)

| Property | Value | Source |
|---|---|---|
| What a "decal" is | Per-faction national-insignia **badge image**; the engine places it, the modder supplies the art | wiki `coh2-vehicle-decal-rendering.md`; example pack XML |
| Source art format | **32-bit TGA, full 8-bit alpha** | measured: `default_dif.tga` = 1024×1024 bpp=32, 4.19 MB (github eliw00d/MyFirstDecalPack) |
| Source art dimensions | **1024 × 1024** (power-of-two, square) | measured (all 4 faction TGAs identical) |
| Compiled in-game format | **`.rgt` (Relic Chunky texture)** — BC1/DXT1 1024² (~0.5 MB); DXT5 if alpha needed | wiki `coh2-decal-pack-format.md:56,156`; `sga-rgt-format` |
| Mip maps | **Required** (`MipMap=true`) | example pack `.mod` `GenericImageToDataRGTBurnSettings` |
| Texture compression | **On** (`CompressTextures=true`, `PreferredFormat=Default`) | example pack `.mod` |
| Power-of-two | **Enforced** (`RescaleNonPowerTwo=true` auto-rescales) | example pack `.mod` |
| Vertical flip on burn | `FlipImage=true` (TGA→RGT flips to D3D convention) | example pack `.mod` |
| Faction folder slugs | `aef`, `german`, `soviet`, `west_german` (OKW), `british` (UKF, community only) | example pack tree; wiki `coh2-decal-pack-format.md:104` |
| In-game texture path | `DATA:\art\armies\<faction>\badges\<GUID>\default_dif` | example decal XML `decal_name` field |
| Placement mechanism | Baked in mesh **TEXCOORD1 / uv2** (semantic index 9), sampled by `coh2_vehicle` shader `teamTex` | wiki `coh2-vehicle-decal-rendering.md:38-40`; repo `src/lib/rgm.ts` |
| Badge UV cell (what shows) | **U∈[0.286,0.337] × V∈[0.039,0.086]** → 1024² px ≈ x293,y40,w52,h48 | wiki `coh2-decal-pack-format.md:54,90-92` |
| Team tint | `teamColour` Vector4f multiplies the badge sample = live player-slot colour at draw time | wiki `coh2-vehicle-decal-rendering.md:76-78` |
| **No** per-vehicle UV / placement fields | decal XML carries texture path only — zero UV/rect/region fields | example decal XML; wiki `coh2-vehicle-decal-rendering.md:44,157` |
| Preview image | **TGA, 280×280** | modding.companyofheroes.com Decal Pack Wizard (via search) |
| Relic templates grid | Decal templates divided into **128×128 grids** (layout guide) | coh2.org tutorial 35893; Decal Pack Wizard |
| Template files | `AEFDecalTemplate.jpg`, `GermanDecalTemplate.jpg`, `SovietDecalTemplate.jpg`, `WestGermanDecalTemplate.jpg` | example pack `templates/`; coh2.org 35893 |
| Build output (local) | `Documents\My Games\Company of Heroes 2\mods\decals` | Decal Pack Wizard |
| Shipped SGA install path | `mods/decals/subscriptions/<GUID>.sga` | wiki `coh2-decal-pack-format.md:51,84` |
| Full SGA layout | **15 files**: 5 faction `.rgd` + 5 faction badge `.rgt` + `english.ucs` + `.info` + preview `.dds` + inventory-icon `.dds` (64×64) + `.gfx` | wiki `coh2-decal-pack-format.md:64-84`; repo `src/lib/sga-writer.ts` |
| Container magic | Relic Chunky (`Relic Chunky\r\n\x1a\0`) for all `.rgt`/`.rgd`/`.rgm` | wiki `coh2-decal-pack-format.md:58` |

### Skin vs decal (don't confuse the two)
- **Decal / national insignia** = the small faction badge atlas above (BC1/DXT1 1024², one per faction).
- **Vehicle skin** = the whole hull diffuse `_dif.rgt` (BC3/DXT5 **2048×2048**, ~4 MB), at
  `art\armies\<army>\vehicles\<vehicle>\skins\<mod><season>\`, with channel suffixes
  `_dif` (diffuse/albedo), `_nrm` (normal), `_gls` (gloss), `_spc` (specular); `_alp` is declared
  but **never ships** for vehicles. Sources: OuroDev / Corsix texture-modding; wiki
  `coh2-vehicle-decal-rendering.md:45,156-159`. A "custom emblem/marking" baked directly into a skin
  is a skin edit, not a decal — decals are strictly the team-badge atlas.

---

## Design Guidelines (do / don't)

The binding constraint is **RTS render scale**: CoH2's camera is fixed-pitch (pan/zoom, no orbit),
the insignia is ~0.5 m of vehicle, and it occupies only a ~5%×5% UV cell — so on-screen the badge is
often a **handful of pixels**, and the live player colour is multiplied over it, cutting contrast
further (wiki `coh2-vehicle-decal-rendering.md:246-251`). Design for legibility at thumbnail size.

**DO**
- **Design for the badge cell, centered.** Only U∈[0.286,0.337]×V∈[0.039,0.086] of the 1024² canvas
  renders on the tank. Put the emblem there, filling the cell, centered — don't scatter art across
  the full sheet expecting it all to show.
- **Bold, simple silhouette.** One strong readable shape (cross, star, roundel, chevron). Thick
  strokes survive DXT1 compression + mip-down; hairlines vanish.
- **High internal contrast.** Light emblem on dark field or vice-versa. Assume the base hull is
  mid-tone camo and the player tint desaturates you — over-contrast on purpose.
- **Use the alpha channel as a hard mask.** 32-bit TGA gives clean cutout edges; keep alpha crisp so
  the badge reads as a decal, not a smudge on the hull.
- **Respect the 128×128 template grid** for consistent scale/registration across the four factions.
- **Keep it power-of-two and let the burn compress** (MipMap on, CompressTextures on) — authoring
  oversized then relying on `RescaleNonPowerTwo` is fine but design at native 1024².
- **Test in-engine, not just in the editor.** Placement matches the editor by construction (both read
  the same TEXCOORD1 channel — wiki `coh2-vehicle-decal-rendering.md:234-236`), but contrast under
  camo + player tint only shows in-game.

**DON'T**
- **Don't rely on fine detail, gradients, or small text** — it mushes to noise at game scale and
  after DXT1 + mip reduction.
- **Don't use low-contrast tone-on-tone** (dark grey cross on grey hull) — invisible.
- **Don't expect per-vehicle placement control.** There are no UV/rect fields in the decal data
  (example XML; wiki `:44`). You cannot move the badge to a specific hull panel via the decal — the
  mesh decides. To bake a marking at an exact spot you must edit the **skin** instead.
- **Don't count on a semi-transparent wash reading as a marking** — partial alpha over camo + tint
  becomes indistinguishable mush. Use near-binary alpha.
- **Don't forget it renders on small detail geometry too** (skirts, hatches, fenders on merged
  meshes) — busy artwork tiled onto tiny parts looks like dirt.
- **Don't ship an over-detailed emblem hoping players zoom in** — RTS zoom-toward-cursor drifts off
  small targets; most players never see the badge larger than a few px.

---

## Examples (good vs bad, and why)

Concrete, engine-grounded examples. The "good" cases are the shipping Relic insignia; the "bad"
cases are the recurring community failure modes documented in the sources.

1. **GOOD — German Balkenkreuz (white-outlined black cross).** Reference-correct: bold cross
   silhouette, high edge contrast from the white outline, near-binary alpha. Reads at a handful of
   pixels and survives DXT1 + player tint. The repo places it on `hullSideRight`, matching the
   historical IFN CoH2 decal guide (wiki `coh2-vehicle-decal-rendering.md:242`). This is the design
   target.

2. **GOOD — Soviet red star (solid fill, thick points).** One shape, one strong colour, filled — no
   internal detail to lose. Even after the team tint multiplies, the star's mass keeps it legible.

3. **GOOD — AEF white star / UKF roundel.** Simple geometric primitive, light-on-dark, thick enough
   that mip reduction doesn't erode it. The roundel's concentric bands are the *maximum* internal
   detail that still reads at scale — anything finer is the failure line.

4. **BAD — photoreal crest / unit patch with small text.** Fine lettering and gradients turn to noise
   after DXT1 compression + mip-down + ~5% UV cell; on-screen it's an unreadable smudge. This is the
   classic "why can't I see my decal" complaint (coh2.org "Custom decal visibility" 36078; "Help with
   decal" 35803).

5. **BAD — low-contrast tone-on-tone emblem.** A dark-grey emblem on a grey/camo hull, or a badge
   whose colour collides with the player tint, effectively disappears — the single most common cause
   of "my decal isn't showing." Fix with deliberate over-contrast and a light/dark outline.

6. **BAD — art scattered across the full 1024² sheet.** Because only the U∈[0.286,0.337]×V∈[0.039,0.086]
   cell is sampled, anything outside that cell never renders. A modder who fills the whole canvas sees
   only the fragment that happens to fall in the cell — looks cropped/empty. Fix: center the emblem in
   the badge cell.

---

## Repo cross-check (this codebase already encodes the format)

The editor automates exactly the format above — findings corroborate, no contradictions:

- **SGA packing**: `src/lib/sga-writer.ts` (Relic Chunky / SGA v7). Decal-pack build:
  `src/lib/decal-mod-build.ts`, `src/lib/decal-pack-export.ts`, `src/lib/decal-mod-templates.ts`
  (contains `RGD_BRITISH_B64` — the reverse-engineered UKF template not in Relic's wizard).
- **RGT writing**: `src/lib/rgt-writer.ts` (BC1/BC3 Chunky texture out); BC codecs `src/lib/bc-encode.ts`,
  `src/lib/bc-decode.ts`.
- **Placement / TEXCOORD1**: `src/lib/rgm.ts` decodes TC1→`uv2`; badge overlay composited in
  `src/components/Viewport.tsx` via `onBeforeCompile`. Per-vehicle UV regions in
  `src/lib/vehicle-uv-regions/*.json`; registry `src/lib/vehicle-uv-registry.ts`.
- **Bake-rect export path** (on-disk skin bake, superseded for preview by TC1): `king-tiger-decal-bake.ts`,
  9 ground-truth pixel rects + `DEFAULT_BADGE_RECT={x:870,y:1150,w:320,h:312}` (wiki
  `coh2-decal-pack-format.md:119-135`).
- **Insignia asset library**: `src/lib/insignia-library.ts`.
- Full 15-file SGA layout, faction coverage, and the British reverse-engineering are documented in
  `artifacts/respec_audit/decal-coverage/` (`ingame-authoring.md`, `04-groundtruth.md`,
  `reveng/3-game-shaders.md`) and the two wiki pages below. In-game load + decal-match were VERIFIED
  2026-07-19/20 (`[Sig:0]`), see `artifacts/ingame-verify/decal-match-report.md`.

**Note / unknown:** the wiki records the shipped SGA badge atlas as **1024²** (matching the example
pack's 1024² source TGA). This repo's bake-rect *export* path operates in **2048²** skin-diffuse space
(the skin, not the badge atlas) — the two 2048² numbers refer to the vehicle skin, not the decal.
I did not independently re-measure a Relic-shipped compiled `.rgt` badge atlas's pixel dimensions in
this session; the 1024² figure comes from the wiki + the 1024² example source TGA.

---

## Sources (URLs)

- Decal Pack Wizard — Essence Engine Wiki: http://modding.companyofheroes.com/decal-pack-wizard
  (128×128 template grid; 280×280 TGA preview; output to `Documents\My Games\Company of Heroes 2\mods\decals`)
- Skin Pack — Essence Engine Wiki: http://modding.companyofheroes.com/skin-pack
- [Tutorial] Setting up a Decal Pack (Manually) — COH2.ORG: https://www.coh2.org/topic/35893/tutorial-setting-up-a-decal-pack-manually
- Custom Decal visibility — COH2.ORG: https://www.coh2.org/topic/36078/custom-decal-visibility
- Help with decal — COH2.ORG: https://www.coh2.org/topic/35803/help-with-decal
- Example Decal Pack (eliw00d/MyFirstDecalPack) — GitHub: https://github.com/eliw00d/MyFirstDecalPack
  (file tree + `.mod` burn settings + decal instance XML + 1024²/32-bit TGA source art, measured via GitHub API)
- coh2_rgt_extractor (tranek) — RGT→DDS/TGA: https://github.com/tranek/coh2_rgt_extractor
- Corsix Mod Studio — Texture Editing tutorial (DXT1/mip workflow): https://modstudio.corsix.org/tutorials-texture-editing-9.html
- OuroDev Wiki — Texture modding (channel suffixes, DXT, rgt): https://wiki.ourodev.com/Texture_modding
- COH2.ORG Faceplate & Decal Pack launch (community pack reference): https://www.coh2.org/news/35747/coh2-org-faceplate-decal-pack-launched
- Wikinger Decal Remover (Workshop 859505244) — source of the British RGD template: https://steamcommunity.com/sharedfiles/filedetails/?id=859505244

### Internal (llm-wiki) sources
- `/var/home/jflessenkemper/llm-wiki/wiki/concepts/coh2-decal-pack-format.md` — 15-file SGA, badge atlas, faction coverage
- `/var/home/jflessenkemper/llm-wiki/wiki/concepts/coh2-vehicle-decal-rendering.md` — TEXCOORD1 placement, shader, in-game match
- `/var/home/jflessenkemper/llm-wiki/wiki/concepts/sga-rgt-format.md`, `rgt-format.md`, `coh2-rgm-format.md`
