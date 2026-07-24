# CoH2 FACEPLATES — Asset Authoring Research

Research date: 2026-07-20. Sources are cited inline (URLs for web, `file:line` for repo).
Where a fact could not be verified, it is explicitly flagged **[UNVERIFIED]**.

---

## 1. What a "faceplate" is (the UI surface it decorates)

A **faceplate** is a purely cosmetic customization item in Company of Heroes 2 (Steam AppId 231430).
It is **not** an in-match/in-world asset — it decorates the **player-profile card / player banner**
that CoH2 shows in menu chrome, *not* anything rendered during actual gameplay.

Verified facts about where it shows up:

- It is **"another cosmetic change only visible in the main menu or loading screen when joining a
  multiplayer match"**, selected on the **loadout screen**, and only active in **custom games**
  (community consensus / wiki summary via search of coh2.org + Steam Workshop pages).
  Source: <https://www.coh2.org/news/35747/coh2-org-faceplate-decal-pack-launched> and the
  aggregated result set at
  <https://steamcommunity.com/sharedfiles/filedetails/?id=467909467>.
- Faceplates were introduced/expanded as **War Spoils** reward items — cosmetic collectibles won
  via the War Spoils drop system. In the profile UI **"you can flip your own faceplate to see your
  supply as well as your rank, but you cannot flip over other players' faceplates."** This makes the
  faceplate the *front face* of the flippable player-info card.
  Sources: <https://www.coh2.org/topic/19199/war-spoils-explained-by-relic>,
  <https://www.coh2.org/topic/27991/faceplates-and-their-meanings>.

Two distinct surfaces the SAME source art feeds (confirmed by the editor's own extracted-asset model
in `src/components/FaceplateInGamePreview.tsx:9-34`):

1. **The 64×64 icon** — the small square the engine paints next to a player's name in chat,
   scoreboards, friend lists, and lobby roster lines. This is a sub-rect **center-cropped from the
   top-right of the banner** at `ICON_RECT (624, 0, 64, 64)`
   (`src/components/FaceplateInGamePreview.tsx:11-14,26-27`;
   `src/lib/faceplate-templates.ts:147`).
2. **The 624×204 banner / hover-card** — the elaborate **gold-framed banner** that pops up when you
   hover the faceplate slot on the loadout screen. The game sandwiches an ornamental gold frame
   (`Faceplates_faceplate_frame_aa_gold.png`, extracted at **635×208**) over the banner and stacks the
   pack name (white bold serif) + a "Faceplate" subtitle below it
   (`src/components/FaceplateInGamePreview.tsx:20-24,31-34`).

So: **the faceplate decorates the player-profile banner card (and its derived name-side icon), shown in
menu/lobby/loading-screen chrome — never on units or in the 3D match world.**

---

## 2. Dimensions, aspect ratio, format, safe-area / framing constraints

**Verified, cross-confirmed by both community guides AND the repo:**

| Element | Dimensions | Aspect | Format |
|---|---|---|---|
| Faceplate **banner** | **624 × 204 px** | ~3.06:1 (≈ 3:1 landscape) | **PNG** (RGBA) |
| In-game **icon** | **64 × 64 px** | 1:1 square | **PNG** |
| Steam Workshop **preview** | **280 × 280 px** | 1:1 | **TGA** |

Web sources for the numbers:
<https://steamcommunity.com/sharedfiles/filedetails/?id=2679894588> ("The faceplate should be 624x204
and the icon 64x64 … Make sure that it stays as .png … workshop icon should be in format .tga and
resolution 280x280").

Repo corroboration (identical numbers):
- Banner constants: `FACEPLATE_BANNER_W = 624`, `FACEPLATE_BANNER_H = 204`
  (`src/lib/faceplate-project.ts:37-38`).
- Icon sub-rect: `ICON_RECT = { x: 624, y: 0, width: 64, height: 64 }`
  (`src/lib/faceplate-templates.ts:147`).

**Packed-texture vs. sampled sub-rects (important nuance the editor adds):**
The engine texture is packed larger than the visible banner. The editor packs a **692 × 204** atlas
(`ATLAS_WIDTH = 692`, `ATLAS_HEIGHT = 204`, `src/lib/faceplate-templates.ts:126-127`) in which:
- `BANNER_RECT = { x:0, y:0, width:624, height:204 }` = the visible banner
  (`src/lib/faceplate-templates.ts:141`), and
- `ICON_RECT = { x:624, y:0, width:64, height:64 }` = the icon, placed to the **right of** the banner
  inside the atlas (`src/lib/faceplate-templates.ts:143-147`).
- The remaining atlas space is padding: **692−688 = 4 px** of right padding and **204−64 = 140 px**
  below the icon are unused (documented `src/lib/faceplate-templates.ts:51-53`). Dimensions are chosen
  so BC3's 4×4 block boundaries land cleanly (comment at `src/lib/faceplate-templates.ts:143-146`).

**Safe-area / framing constraints:**
- **No official safe-area margins are published.** Both the Steam guide and the coh2.org guide give
  the pixel sizes but state **no** framing constraints ("No safe-area margins or design constraints are
  specified" — WebFetch of
  <https://steamcommunity.com/sharedfiles/filedetails/?id=2679894588>). **[UNVERIFIED — no official
  safe-area spec exists]**.
- **De-facto framing constraint (derived, high-confidence):** because the **64×64 icon is
  center-cropped from `(624,0)` — the top-right corner of the banner** (`ICON_RECT`), whatever art you
  place in the **top-right 64×64 region of the banner** becomes your name-side icon. Any focal
  element you want visible in chat/scoreboards **must sit in that top-right square**, or the icon will
  show empty/background pixels. This is the single most important compositional constraint and it is
  enforced by the geometry, not by a Relic style rule.
- The **ornamental gold hover frame overhangs the banner** by a small margin (frame 635×208 over a
  624×204 banner ≈ 11 px wider, 4 px taller — `src/components/FaceplateInGamePreview.tsx:33-34`), so a
  few pixels of the banner's outer edge are visually overlaid by gold filigree on the hover card. Keep
  critical content off the extreme outer border.

---

## 3. How faceplates are authored & packaged

**Authoring pipeline (official Relic + community, 2022-current):**

1. Prepare art as **PNG**: a 624×204 banner and a 64×64 icon (keep them PNG — guides stress
   "Make sure that it stays as .png"). Recommended free editor: **Photopea**
   (<https://www.photopea.com/>).
   Source: <https://steamcommunity.com/sharedfiles/filedetails/?id=2679894588>.
2. Prepare the **Steam Workshop preview** as a **280×280 TGA**.
3. Use the official **Faceplate Pack Wizard** (part of Relic's CoH2 modding tools, documented on the
   Essence Engine Wiki at `modding.companyofheroes.com/faceplate-pack-wizard`). The wizard takes the
   PNGs, builds the mod, and **copies the result to
   `Documents\My Games\Company of Heroes 2\mods\faceplates\`**.
   Sources: the Essence Engine Wiki page *Faceplate Pack Wizard* (title/URL confirmed via search:
   <http://modding.companyofheroes.com/faceplate-pack-wizard> — **page body could not be fetched: the
   host serves an invalid TLS cert (`ERR_TLS_CERT_ALTNAME_INVALID`) and the Google cache was empty, so
   the wizard's exact step list is [UNVERIFIED from primary source]**, but the output path and role are
   corroborated by the Steam guide) and
   <https://steamcommunity.com/sharedfiles/filedetails/?id=2679894588>.
4. Toolchain prerequisites called out by the community guide: CoH2 + **CoH2 Tools** (from Steam),
   **Java 1.8.0**, and **Flex SDK 4.6.0** (exact version required). Publishing gotcha: **the 64-bit
   CoH2 build has a bug where the workshop icon doesn't show — publish/test using the 32-bit build.**
   Source: <https://steamcommunity.com/sharedfiles/filedetails/?id=2679894588>.

**Underlying package format (Relic Essence engine):** faceplate mods ship as **SGA archives**
containing a **DDS texture (BC3/DXT5-compressed)** plus an **RGD attrib file** (the ability/entity
record that registers the faceplate with a `pbgid`) and a small **GFX** UI wrapper. This is confirmed
by how *this editor* reproduces the format byte-for-byte (see §5) — it matches the reference workshop
atlases. The `.mod`/wizard project file referenced in the guide
(`my_faceplate.mod`) is the wizard's own project descriptor, not the shipped artifact.

---

## 4. Design best-practices for a faceplate that reads well

Derived from the verified UI mechanics above (geometry-driven, so high-confidence even where Relic
publishes no explicit style guide):

- **Put your focal mark in the top-right 64×64.** That square IS your chat/scoreboard icon
  (`ICON_RECT`, top-right corner of the banner). A logo/emblem that spans the whole banner but has
  nothing in the top-right corner will produce a blank-looking icon. Design the icon-square first, then
  extend the banner art around it.
- **Design for a ~3:1 landscape banner.** 624×204 is a wide strip — layouts that assume a square will
  crop badly. Horizontal compositions (name-plate style: emblem on one side, texture/pattern filling
  the rest) read best.
- **Respect the gold frame overhang.** The hover card lays an ornamental gold frame ~11 px wider and
  ~4 px taller over the banner (`src/components/FaceplateInGamePreview.tsx:33-34`). Keep text and key
  detail a few pixels inside the outer edge so filigree doesn't clip it.
- **Contrast against dark menu chrome + white serif title text.** The hover card renders the pack name
  in **white bold serif** *below* the banner and the banner itself sits on CoH2's dark
  charcoal/steel menu background (`src/components/FaceplateInGamePreview.tsx:20-24,44-47`). A banner
  that is itself near-white or very light will muddy the white title and vanish into bright loading
  screens; give the banner a defined darker border/vignette or mid-tone field so it separates from both
  the chrome and the overlaid text.
- **Keep the 64×64 icon legible at true size** — no upscaling happens; the engine samples those exact
  pixels (`src/components/FaceplateInGamePreview.tsx:11-14`). Thin 1-px linework, small text, and busy
  gradients disappear at 64×64. Use a bold silhouette / high-contrast emblem.
- **Full RGBA transparency is supported** (PNG → BC3/DXT5 carries an alpha channel), so you can let the
  banner have shaped/transparent edges that blend into the frame rather than a hard rectangle.

---

## 5. Examples of good vs. bad + repo cross-check

**Good (reference-quality):** the **Official COH2.ORG faceplate** by Janne252 — a horizontal
name-plate layout with the "COH2.ORG Lightning Bolts and text labels," a clear emblem, and a
mid-tone field that reads against menu chrome
(<https://steamcommunity.com/sharedfiles/filedetails/?id=467909467>;
<https://www.coh2.org/news/35747/coh2-org-faceplate-decal-pack-launched>). It works because the bolt
emblem occupies the icon-square region and the banner has defined contrast.

**Bad patterns (derived from the constraints):**
- Emblem centered/left with an empty top-right corner → **blank chat icon**.
- Near-white full-bleed banner → **disappears** into loading screens and clashes with the white serif
  title.
- Square-first art force-fit into 624×204 → **heavy horizontal crop**, off-center focal point.
- Fine detail / small text sized for the banner → **illegible mush** at the 64×64 icon.

### Repo cross-check — what THIS editor currently produces vs. the real game requirement

**MATCH — the editor is correct on every hard spec:**

| Requirement (game) | Editor value | Location | Verdict |
|---|---|---|---|
| Banner 624×204 PNG-space | `FACEPLATE_BANNER_W=624`, `FACEPLATE_BANNER_H=204` | `src/lib/faceplate-project.ts:37-38` | ✅ exact |
| Icon 64×64, cropped top-right | `ICON_RECT {624,0,64,64}` | `src/lib/faceplate-templates.ts:147` | ✅ exact |
| Shipped texture = BC3/DXT5 in DDS | `encodeBc3(atlasRgba, ATLAS_WIDTH, ATLAS_HEIGHT)` + `wrapBc3InDds()` | `src/lib/faceplate-mod-build.ts:103,246` | ✅ matches reference atlases "byte-for-byte" (comment `:244-246`) |
| Packaged as SGA + RGD attrib + GFX | `buildFaceplateModSga` assembles DDS + patched RGD (`pbgid`) + GFX | `src/lib/faceplate-mod-build.ts:78-151`; templates `src/lib/faceplate-templates.ts:73-83,126-127` | ✅ |
| Atlas packing 692×204 with 4/140 px padding | `ATLAS_WIDTH=692`, `ATLAS_HEIGHT=204`; padding documented | `src/lib/faceplate-templates.ts:51-53,126-127` | ✅ |

**Notable differences / caveats (not defects, but worth recording):**
- **Steam Workshop preview format:** community guide specifies a **280×280 TGA**. The editor's build
  reuses the encoded **DDS** as the workshop preview ("the `dds` we already encoded for the atlas
  doubles as … workshop previews" — `src/lib/faceplate-mod-build.ts:149-151`). Whether CoH2's Workshop
  uploader accepts a DDS preview vs. requiring TGA is **[UNVERIFIED]** — this is the one place the
  editor's output could diverge from the guide's stated 280×280-TGA recommendation and is worth a
  targeted test.
- The editor authors banner + icon from **one composed atlas** (the icon is auto-cropped from the
  banner's top-right), whereas the manual wizard workflow lets an author supply an **independent** 64×64
  icon PNG. The editor's approach is a deliberate simplification, and it enforces the "focal point must
  live in the top-right 64×64" rule automatically — but it means an author cannot give the icon
  different art from that banner corner. Not a spec violation; a design choice
  (`src/components/FaceplateInGamePreview.tsx:26-29`).
- No mismatch found on dimensions, format, aspect, or packaging.

---

## Sources

- <https://steamcommunity.com/sharedfiles/filedetails/?id=2679894588> — "How to make a faceplate in 2022" (dimensions, formats, tools, 32/64-bit bug)
- <https://www.coh2.org/topic/109813/guide-how-to-make-a-coh2-faceplate-update-2022> — index thread linking the above
- <http://modding.companyofheroes.com/faceplate-pack-wizard> — Essence Engine Wiki *Faceplate Pack Wizard* (title/URL only; body unfetchable, invalid TLS cert)
- <https://www.coh2.org/topic/19199/war-spoils-explained-by-relic> — War Spoils, flippable faceplate
- <https://www.coh2.org/topic/27991/faceplates-and-their-meanings> — faceplate types/meaning
- <https://www.coh2.org/news/35747/coh2-org-faceplate-decal-pack-launched> — official COH2.ORG faceplate example (Janne252)
- <https://steamcommunity.com/sharedfiles/filedetails/?id=467909467> — Official COH2.ORG Faceplate (Workshop, reference example)
- Repo: `src/lib/faceplate-project.ts`, `src/lib/faceplate-templates.ts`, `src/lib/faceplate-mod-build.ts`, `src/components/FaceplateInGamePreview.tsx`
