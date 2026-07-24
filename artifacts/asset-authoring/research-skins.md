# CoH2 Vehicle Skins — Authoring Research

Scope: how CoH2 vehicle skins/textures are authored, what channels a modder paints,
format/dimension rules, camo & team-colour handling, community workflow, and good-vs-bad
skin criteria. Cross-checked against this repo (`coh2-skin-editor`). File:line citations for
code claims; URLs for web claims. Facts I could not verify are flagged **UNVERIFIED**.

## Primary sources
- Essence Engine Wiki — **Skin Pack Wizard** (authoritative, Relic's own docs): http://modding.companyofheroes.com/skin-pack-wizard
  (page loads only over **HTTP**; HTTPS returns a cert-altname error, so `WebFetch` fails — retrieved via `curl`.)
- Essence Engine Wiki — Skin Pack: http://modding.companyofheroes.com/skin-pack
- Corsix Mod Studio — Texture Editing tutorial (Essence RGT↔DDS mechanics): https://modstudio.corsix.org/tutorials-texture-editing-9.html
- coh2.org — "Help with Skin making" (Burn.exe workflow, folder layout): https://www.coh2.org/topic/35958/help-with-skin-making
- coh2.org — team-colour/alpha behaviour (community Q&A surfaced via search): https://www.coh2.org/topic/36078/custom-decal-visibility , https://www.coh2.org/topic/27537/all-factions-vehicle-skins-database
- Steam — Relic Content Example Skin (official reference skin download): https://steamcommunity.com/sharedfiles/filedetails/?id=464057705

Note: the "Vehicle Skin Guide by Recon" (Steam id 551903483) that ranks highly in search is for
**Men of War: Assault Squad 2**, NOT CoH2 — its DDS/pak/`#1 #2 #d` conventions do not apply here. Discarded.

---

## 1. Skin channel model — what a modder actually paints

CoH2 uses the Essence Engine's PBR-ish "burn" pipeline. The modder works in **layered source PSDs**,
saves out **32-bit TGA** per channel, and the Skin Pack Wizard / Burn tool compresses them into RGT.

**Five input channels → two burned RGT outputs** (verbatim from the Skin Pack Wizard page):
> "The default burn settings produced by the wizard will produce up to two (_dif,_nrm) output files
> from up to five (_dif,_alp,_nrm,_spc,_gls) input files. This is done to maximize texture compression
> in the Essence Engine, and is the format the engine expects."

The exact TGA→RGT burn mapping (Skin Pack Wizard channel table):

| Input TGA | Meaning | Burned into |
|-----------|---------|-------------|
| `<base>_dif.tga` | Diffuse (colours/patterns) | `<base>_dif.rgt` |
| `<base>_alp.tga` | Alpha / transparency | `<base>_dif.rgt` (packed as the diffuse's alpha) |
| `<base>_nrm.tga` | Normal (bump) | `<base>_nrm.rgt` |
| `<base>_spc.tga` | Greyscale specular | `<base>_nrm.rgt` |
| `<base>_gls.tga` | Greyscale gloss | `<base>_nrm.rgt` |

So the *diffuse RGT* carries colour + alpha; the *normal RGT* carries normal + specular + gloss
(spec/gloss packed into channels of the normal output). Wiki channel definitions (verbatim):
- **DIFFUSE** — "How a surface looks from all angles (The standard colours and patterns of your skins). This is your main editing area."
- **NORMAL** — bump/detail; "Unless you are experienced, you probably don't want to edit these." The one normal sub-layer worth toggling is **`snowbuildcrunch`** for winter skins.
- **SPECULAR** — "which parts of the skin show light in a reflective manner, such as a shiny metal surface."
- **GLOSS** — "how much light the specular layers actually reflect… Factory new paint? Covered in dirt and mud?"
- **ALPHA** — transparency; white = opaque (see whole vehicle), black = transparent (see through). Used to hide side-skirts / track-guards / attachments.

**What a modder actually paints (the 90% case):** just **DIFFUSE**. Wiki:
> "If you are only editing the diffuse files (the colours and patterns), then you will not have to
> provide any other layers (except alpha layers with black on them)."
i.e. supply your `_dif.tga` and a black `_alp.tga` (fully opaque); the wizard reuses stock nrm/spc/gls.
Editing nrm/spc/gls is an advanced step (needed to fix a few units that burn too light with default
normals — the wiki names the **IS-2** and **Sdkfz 250 half-track**; fixing requires extracting and darkening
the spec/normal/gloss layers and setting custom burn settings, which enlarges the mod).

**Summer/Winter variants:** a skin is authored per **season** and per **weight class** (light/medium/heavy).
Wiki: "Typically a skin consists of a seasonal variant (summer/winter) of all the vehicles in a vehicle
class (light/medium/heavy)." Winter differs by (a) whitewash on the diffuse and (b) enabling the
`snowbuildcrunch` normal layer.

**Repo cross-check (this editor is diffuse-only, as expected):**
- The texture editor uses a **2-layer stack: base-diffuse + paint** — it wraps and paints ONLY the vanilla
  **diffuse** canvas; nrm/spc/gls/alp are never authored. `src/lib/texture-layer-model.ts:1-77` (doc comment
  + `makeTextureLayerProject`). Canvas is fixed at **2048×2048** (`TextureLayerProject.canvasW/H = 2048`, lines ~55, 82-85).
- Export writes only `_dif.rgt` per slot: `src/lib/mod-export.ts:558` and `:654`
  `art/armies/<faction>/vehicles/<folder>/skins/<guid>_<season>/<base>_dif.rgt`.
- Seasons are the two engine values `'summer' | 'winter'` and are iterated at `src/lib/mod-export.ts:557,653`;
  project defines **6 export slots = 3 summer + 3 winter** (`src/lib/project.ts:137` season field, `:310-329`
  `makeExportSlot` producing summer 0-2 / winter 0-2, labelled "Summer 1..3 / Winter 1..3", slotIdx 0=light…2=heavy).

---

## 2. Texture dimensions / format (RGT / DDS / mips)

- **RGT = Relic Generic Texture**, a Chunky-container wrapper around a **DXT/BC-compressed** payload with a
  **mip pyramid**. Corsix tutorial: "RGT has been converted to DDS **DXT1 with mip levels**"; workflow is
  right-click → **Dump RGT to TGA/DDS**, edit, save DDS via the **NVIDIA DDS plugin**, right-click → **Convert
  DDS to RGT**. For no-alpha diffuse use "DXT1 - RGB - No alpha"; match mips to whether the source said
  "with mip levels". (https://modstudio.corsix.org/tutorials-texture-editing-9.html)
- **Dimensions:** vehicle diffuse atlases are **2048×2048** in practice (repo hard-codes 2048² everywhere:
  `src/lib/texture-layer-model.ts` canvas, `src/lib/rgt-writer.ts:5-9` "12 mips for a 2048² texture").
  Textures are **power-of-two, square** (standard DXT/mip requirement). I did **not** find an official wiki
  statement of a fixed max dimension — **UNVERIFIED** whether the engine caps at 2048 or allows 4096; the
  repo simply mirrors the vanilla 2048² atlas.
- **Preview image spec (verified):** the Steam Workshop preview must be a **TGA at 280×280** (Skin Pack Wizard).
- **Curated swatch/preview naming (verified, Skin Pack Wizard):**
  `swatch_<army>_<skinname>_<season>_<weight>` and `preview_<army>_<skinname>_<season>_<weight>`
  e.g. `swatch_british_desertrats_summer_heavy.png`, `preview_west_german_3colorambush_summer_medium.png`;
  `..._season_all` (e.g. `swatch_..._summer_all`) represents the whole set.
- **Input TGA must be 32-bit** (Skin Pack Wizard: "Input files should be saved as 32 Bit TGA files").
- **Filename rule (critical gotcha):** the wizard/engine matches the **whole canonical filename**, not just the
  suffix. `panther_dif.tga` works; `mypanthermod_dif.tga` "will cause your skin to not appear in the game."
  (Skin Pack Wizard.) The repo enforces canonical per-vehicle basenames via `textureBaseNamesFor()` /
  output-basename aliases: `src/lib/mod-export.ts:113,370-408`.

**Repo RGT-writer specifics (how this tool re-encodes):**
- Emits a **Chunky v3** container: `TSET → TXTR → DXTC → { TFMT, TMAN(mip table), TDAT(zlib mip blobs) }`
  (`src/lib/rgt-writer.ts:1-40` header comment).
- Real CoH2 RGTs carry a **full mip pyramid (12 mips @ 2048²)**; this writer emits only the **top mip** and zeroes
  the rest — the renderer falls back to bilinear minification (`src/lib/rgt-writer.ts:5-9`). **UNVERIFIED** whether
  shipping top-mip-only degrades in-game LOD; the code asserts the engine tolerates it.
- Two BC formats: **BC1/DXT1** (format code 13, ~2 MB @ 2048², used for binary-mask decal RGTs where the engine
  tints at runtime) and **BC3/DXT5** (format code 15, **4,194,736 bytes** @ 2048²) — BC3 is mandatory for the
  signed-template patch path because RSA-signed template slots are a fixed byte size that must not change
  (`src/lib/rgt-writer.ts:~30-60` RgtOptions doc). An **FBIF** (FileBurnInfo, 90-byte Relic metadata) preamble is
  required on unsigned custom RGTs so the engine accepts them, but omitted for pre-signed slots (same doc).

---

## 3. Camo design & team-colour show-through

**Historical camo schemes** the community and this tool target (repo `src/lib/camo-generator.ts`):
- German (Ostheer/OKW): **3-tone summer** (dunkelgelb base + red-brown + olive-green), **whitewash winter**,
  **ambush ("jigsaw"/Hinterhalt dot)** — presets `german_summer`, `german_winter`, `german_ambush`
  (`camo-generator.ts:87-104`); plus **Hungarian Honved 3-tone** factory scheme scoped to Ostheer-built vehicles
  (`honved_summer`, `factionScope:'german'`, `camo-generator.ts:74-86`).
- Soviet: **summer green (4BO)** and **whitewash winter** — `soviet_summer`, `soviet_winter` (`:105-113`).
- US/UK: base olive-drab / khaki (`american_summer`; British mapped to allied desert/OD in the parser fallback
  `:167-169`) — the repo's US/UK coverage is thinner than German/Soviet.
- **Desert tan** (Afrika/Desert Rats) — `desert_tan` (`:123-124`).
- Camo **styles** are `softBlobs | hardEdge | whitewash | stripes` (`camo-generator.ts:23`), with a blur radius
  controlling soft-vs-hard edges (`:34`).

**Weathering / realism:** the repo layers **procedural dust, grime, chips and sun-fade** on top of the base
scheme (`camo-generator.ts:19`), matching community best practice (scale-model reference: worn handles, chipped
paint, mud splashes; snow crews historically leave insignia unpainted).

**Decals vs basecoat, and how team colour shows through — the important mechanic:**
- CoH2 renders **team colour** NOT through the diffuse skin but through the separate **national-insignia / decal
  system**. In the base-game skin files the badge **`teamColour` Vector4f is all-zero**, i.e. vanilla vehicles do
  **not** self-tint from the skin — team colour arrives via the insignia/decal atlas sampled through the mesh's
  TEXCOORD1/uv2 channel and tinted at runtime. Repo: `src/components/Viewport.tsx:863-864` (comment stating
  base-game `teamColour` is all-zero) and `:4326,4349` (the runtime badge team-colour tint). This matches the
  known repo fact that insignia render via a badge atlas through uv2.
- Practically, community skinners control team-colour visibility with the **alpha channel / decals**, not the
  diffuse paint: painting an area **black in the alpha** hides it (side-skirts, guards, attachments), and custom
  **decals can strip the team-coloured stripe** and small markings, leaving just the main symbol + serial numbers.
  (coh2.org search results, https://www.coh2.org/topic/36078/custom-decal-visibility and
  https://www.coh2.org/topic/27537/all-factions-vehicle-skins-database — I could not open the individual thread
  bodies to quote verbatim, so treat the "black-alpha hides parts / decals remove team stripes" phrasing as
  community-consensus, lightly **UNVERIFIED** at the exact-quote level.)
- Design implication: a good skin **leaves room** for the team-colour stripe/insignia (don't paint camo over the
  decal zones) so players can still tell factions apart; heavy full-coverage camo that buries the team stripe is a
  common gameplay-legibility complaint.

**Repo masking that preserves detail (matches "camo on a separate layer" best practice):**
- In `maskedMode` the camo canvas is **transparent** and composited over the **vanilla diffuse** with
  **`source-atop` / mask-gating**, so tracks, wheels, tools and fittings stay **byte-identical** to vanilla
  (`camo-generator.ts:13-14, 40-43, 76-84, 216-234, 257-317`). It even clips camo blobs to **armour pixels** and
  can use **multiply blend over vanilla** to restrict coverage (`:306, 385-388`). This is the programmatic version
  of the human advice "apply camo on a separate layer to preserve bolts/hatches/gaps".

---

## 4. Community workflow & UV-layout considerations

**Two authoring paths:**
1. **War Spoils / in-game customizer (light):** players recolour with unlockable patterns/skins in-game; no file
   editing. Not real modding — no custom textures. (Background; not a file workflow.)
2. **Full modding (Skin Pack Wizard / Mod Maker + Burn tool):** the real path. Steps (Skin Pack Wizard + coh2.org):
   - Install **CoH2 Tools** (via Steam) and **CoH2 Tools Data** (ships the **source layered PSDs** for every
     stock skin — "the combined textures that shipped with the game… are difficult to edit; the source PSD files
     are broken up into layers"). **British source is Substance Designer format**, not PSD (30-day trial noted).
   - In the wizard, **Clone** the vehicles/seasons/weights you want; it extracts editable TGAs into
     `art\armies\<army>\vehicles\<vehicle>\skins\<mod>_<season>\`.
   - Edit the **diffuse** in **Photoshop or GIMP** (GIMP works; wiki examples are Photoshop). Use the **NVIDIA DDS
     plugin** when going through the DDS route (Corsix). Save channels as **32-bit TGA** with the **canonical
     filenames**.
   - **Burn** → produces `_dif.rgt` (+`_nrm.rgt` if you touched nrm/spc/gls), packs into the mod SGA, publishes to
     Steam Workshop with a **280×280 TGA preview** and the `swatch_/preview_` PNGs.
   - **Test in-game** with dev mode enabled; iterate ("check results in-game and correct in a 2D program
     afterwards" — extraction is imperfect so meshes/UVs differ slightly from in-game).
- **Burn.exe is fragile:** a known first-build crash (`exit code -1073741819`) is worked around by rebuilding
  without cleaning and verifying .NET is installed (coh2.org "Help with Skin making").

**UV-layout considerations:**
- Vehicles use a **single shared 2048² diffuse atlas** per vehicle (sometimes split — e.g. a separate `_hull`
  atlas; repo `textureBaseNamesFor` returns multiple candidate basenames like `elefant_hull_dif`,
  `centaur_aa_dif`: `src/lib/mod-export.ts:106-113,245-247`).
- The wiki warns UVs from the extracted source meshes **don't perfectly match** the in-game mesh ("meshes vary
  significantly… some more than others; check in-game and correct afterwards"), so precise seam-aligned detail
  should be verified in-engine, not trusted from the PSD alone.
- Team-colour/insignia lives on a **second UV channel (TEXCOORD1/uv2)** and a badge atlas — separate from the
  diffuse UVs — so decal placement is a distinct concern from painting the diffuse (repo's known TEXCOORD1 fact;
  `Viewport.tsx` team-colour tint path).

---

## 5. Good vs bad skins — why

**Crisp vs muddy (the #1 quality axis):**
- **Good:** camo painted on a **separate layer** so panel lines, bolts, weld seams, hatches and the normal/spec
  detail read through; sharp, historically-plausible pattern edges (hard-edge splinter vs soft blobs used
  appropriately per scheme).
- **Bad ("goo effect"):** a flat camo layer smeared over everything at full opacity, **burying** the bolts/hatches
  and killing the normal-map read — the tank looks like a plastic blob. Working at low opacity then building up,
  and clipping camo to armour pixels (the repo's `maskedMode`/`source-atop`), avoids this.

**Correct vs wrong team-colour handling:**
- **Good:** leaves the **team-colour stripe / insignia zones clear** and lets the engine's team-colour + decal
  system show through, so factions stay legible in multiplayer; winter skins keep insignia visible (crews left
  them unpainted). Because base-game `teamColour` on the skin is all-zero (`Viewport.tsx:863-864`), the modder
  must NOT expect the diffuse to auto-tint — team identity comes from the decal/insignia layer.
- **Bad:** camo painted **over** the decal/stripe zones or an alpha that hides them, so the vehicle loses its
  team-colour cue and becomes hard to identify — a frequent multiplayer complaint; also "too light" units (IS-2,
  Sdkfz 250) when the default burned normal/spec is wrong and the modder doesn't fix it (Skin Pack Wizard).

**Other bad-skin tells (from the burn pipeline):**
- Wrong/custom **filenames** → skin silently doesn't appear in-game (must be canonical `<vehicle>_dif`).
- Not toggling **`snowbuildcrunch`** on a winter skin → snow build-up reads wrong.
- Ignoring **spec/gloss** on shiny units → factory-new plastic sheen instead of worn steel (gloss = "Factory new
  paint? Covered in dirt and mud?").

---

## Open items / UNVERIFIED
- Exact engine max texture dimension (2048 vs 4096) — not stated on the wiki pages retrieved; repo assumes 2048².
- Whether top-mip-only RGTs (this tool's writer) cause visible in-game LOD shimmer — asserted safe in
  `rgt-writer.ts` but not independently confirmed.
- Verbatim coh2.org thread text on "black-alpha hides parts / decals strip team stripe" — surfaced via search
  summaries; individual thread bodies were not opened, so exact wording is community-consensus level.
- The Skin Pack Wizard page's own "Recommended burn settings for gls/spc/nrm" table values were truncated in
  retrieval; the qualitative rule (darken and set custom burn for a few too-light units) is captured, the exact
  numeric settings are not.
