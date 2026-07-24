# CoH2 In-Game Appearance Reference (Capture-Judging Ground Truth)

**Purpose:** documented ground truth for how CoH2 vehicle skins, national-insignia decals, decal-pack decals, and faceplates ACTUALLY look in-game, so harness captures can be judged against real behaviour rather than our editor's render alone. Every claim is cited. Reference images are described in words (this doc is text). Compiled 2026-07-19 from Steam Community, coh2.org, the CoH Fandom wiki, and the LLM-wiki's reverse-engineered engine facts.

> **How to use this doc:** each section ends with an "EXPECTED IN-GAME APPEARANCE" rubric — a list of concrete, checkable statements. When a capture comes back, walk the rubric and mark each item PASS / FAIL / CANT-TELL. The "Unverified" section (bottom) lists things no imagery could confirm; treat those as CANT-TELL by default, never as FAIL.

---

## 0. Cross-cutting facts that gate everything

- **Custom (Workshop/modded) skins and decals render ONLY in custom games and vs-AI/co-op games — NOT in Automatch/ranked.** Automatch shows only official store/War-Spoils items. This is an explicit Relic design decision (content control + monetisation + load-time). **Capture implication: the harness MUST launch a Custom Game (or skirmish vs AI), never queue Automatch, or the custom skin/decal will silently not appear and the capture will look "broken" when it is actually correct engine behaviour.** [S2][S3][S4]
- **A vehicle skin is texture-only — it cannot change geometry.** Skins are diffuse + specular + gloss + bump + alpha maps. Alpha *can* be painted to make geometry transparent (open mesh / removed stowage), but the mesh itself is fixed. [S5][S6]
- **Every vehicle has at least two patterns: a summer and a winter variant, auto-selected by map.** Winter maps load the winter skin; summer maps load the summer skin. The player does not toggle this per match — it follows the map. [S1][S5][S6]
- **National insignia is tinted by player/team colour at draw time.** The base texture ships with a transparent/zero tint; the engine overrides it with the player's faction slot colour. There is an in-game "Show Player Color" option controlling this. [S7][WIKI-DECAL-RENDER]
- **A "Hide Decals" in-game option exists** — it is simply the shader technique variant that skips the badge sample; no geometry change. [WIKI-DECAL-RENDER]

---

## 1. VEHICLE SKINS in-game

### What the sources establish
- **Coverage: the camo/skin covers the full painted body — hull AND turret share one 2048² diffuse atlas** (59 of 61 vehicles use a single body atlas; StuG III and Brummbär have an extra panel/turret atlas). So the pattern wraps the whole painted surface, not just one face. [WIKI-DECAL-PACK]
- **Tracks are a SEPARATE material and are NOT painted by the skin.** Track submeshes use the `coh2_vehicle_uvanim` shader (animated scrolling texture, no team badge), distinct from the hull's `coh2_vehicle` shader. Expect tracks to keep their default metal/rubber look and to scroll when moving — the custom camo does not extend onto them. [WIKI-DECAL-RENDER]
- **Tools/stowage/equipment** ride on the same body atlas as the hull in most cases, so a full-hull camo generally DOES tint over molded-on tools — but creators frequently leave them in a contrasting default via the texture, and winter patterns deliberately leave metal/stowage showing (see below). Historically-styled skins leave tracks, tools, and stowage looking un-whitewashed. [S5][S8]
- **Winter behaviour is deliberately incomplete coverage.** Real winter whitewash was hand-applied and never fully covered the vehicle (pure white stands out), so authentic winter skins show the base colour bleeding through, worn patches, and metal/tracks unpainted. A winter capture that shows patchy white over darker base is CORRECT, not a bug. [S8]
- **Seasonal switch is automatic by map**, as in §0.

### Visibility at zoom
- At default RTS camera zoom the vehicle is small; large high-contrast camo patterns and the overall base colour read clearly, but fine detail (small insignia, weathering, serial numbers) is barely legible. Players routinely zoom in (mouse wheel) to appreciate skins. Community skin previews are almost always shown zoomed-in / in the customizer 3D preview, not at match zoom — so **our editor's zoomed 3D preview corresponds to the "zoomed-in in-game" look, not the tactical-zoom look.** [S1][S9] (inference from how previews are presented; exact zoom ratio unverified)

### Known rendering quirks
- Custom-vs-official visibility gate (§0) is the #1 "skin not showing" cause reported by players. [S2][S3][S4][S10]
- Skins must be equipped in the army customizer AND the game restarted/relaunched for the item to appear in inventory before a custom game. [S6][S10]

### Best reference images
- Steam Workshop "CoH2 - Camouflage Skins" (id 1636442984) — preview grid of full-hull camo variants. [S11]
- Steam Workshop "Vehicle Skins All Factions" (id 1694297222) — per-faction full sets incl. winter. [S12]
- coh2.org "All Factions Vehicle Skins Database" (topic 27537) — community catalogue with in-context screenshots. [S9]
- CoH Fandom "Vehicle Patterns" (camo pattern reference per faction). [S8]

### EXPECTED IN-GAME APPEARANCE — rubric
1. Custom skin appears ONLY because the harness is in a custom/vs-AI game (confirm the launch mode first).
2. The camo pattern wraps the whole hull AND turret (one continuous atlas), not a single flat face.
3. Tracks are NOT painted in the custom camo; they show default metal/rubber and scroll when the vehicle moves.
4. On a summer map the summer variant loads; on a winter map the winter variant loads — never the wrong season.
5. Winter skin shows patchy/incomplete white with base colour and metal bleeding through (this is correct, not a defect).
6. At tactical zoom the base colour + large pattern read; fine detail only legible zoomed in.

---

## 2. NATIONAL INSIGNIA (vehicle decals) — placement per German vehicle

### Engine ground truth (from our reverse-engineering — high confidence)
- The insignia is the `teamTex` badge atlas sampled through the mesh's **TEXCOORD1** channel; every vehicle indexes the same tight badge cell (**U∈[0.286,0.337] × V∈[0.039,0.086]**). It renders on small detail geometry — **side skirts (schürzen), hatches, fender/fitting surfaces** — NOT on the big hull body polygon. It is player-colour tinted. [WIKI-DECAL-RENDER]
- Our 9 authored bake-rects place the insignia on `hullSideRight` for Tiger, King Tiger, Easy8 (Sherman), SU-85, StuG III, KV-2, Panzerwerfer, Sherman Firefly; and on `hullFront`/glacis for the T-34/76. [WIKI-DECAL-PACK]

### Historical/community placement guide — IFN1 Authentic Tank Decal Guide (CoH2-specific) [S13]
This guide documents where CoH2's in-game decal slot places the balkenkreuz per German vehicle. It confirms our side-skirt/hull-side expectation strongly:

| Vehicle | Balkenkreuz placement (per guide) | Extra markings |
|---|---|---|
| **Tiger** | **Hull sides** | Numbering on the turret side |
| **Panther** | Sides of the superstructure at the front (mirror-able since patch 1.61); also on the rear stowage bins | Division emblem low on hull front/rear, sometimes turret rear |
| **StuG III Ausf. G / StuH 42** | **On the schürzen (side skirts), upper half**; mirrored also onto upper superstructure side | Number on schürzen; division emblem on front plate |
| **StuG III Ausf. A** | Sides of the superstructure (sometimes absent entirely) | — |
| **Panzer III M/N** | **Hull schürzen, or turret schürzen sides** (left/right of the number) | Number on turret schürzen; division emblem on front superstructure and/or hull schürzen near front |

**VALIDATION RESULT:** the community/historical guide AGREES with our mesh analysis — CoH2 renders the balkenkreuz on **side skirts (schürzen) and hull/superstructure sides**, with turret used mainly for numbering. Our `hullSideRight` / side-skirt / hatch expectation is CORRECT for the schürzen-equipped vehicles (Tiger, StuG III, Panzer III/IV-class). [S13][WIKI-DECAL-RENDER]

**CORRECTIONS / nuances to our expectation:**
- **T-34/76 is the documented exception** — our bake-rect puts its insignia on the **front glacis**, not the hull side. Keep that vehicle's expected location as front glacis, not side. [WIKI-DECAL-PACK]
- **Panther** puts the cross on the **superstructure front sides and the rear bins**, not primarily flat hull-side — closer to "front superstructure side" than "mid-hull side." Judge Panther captures accordingly.
- The historical guide describes the *authentic* target the artist paints to; the in-game decal SLOT paints a single cell, so real captures may show **one cross per side on the schürzen** rather than the full historical set of division emblems + numbers. Do not FAIL a capture for missing division emblems/serials — the stock engine insignia is the single balkenkreuz-style cell.

### Size & count
- The badge cell is roughly **0.5m-square-ish on the hull** (a small patch, not a large panel). It is subtle at tactical zoom and clearly visible zoomed in. Expect **one insignia per visible side** (mirrored L/R on skirts), not a large full-panel emblem. (Size in metres is inferred from the ~5%×5% UV cell over a hull-side atlas region; exact metres unverified.) [WIKI-DECAL-RENDER]

### Best reference images
- IFN1 Authentic Tank Decal Guide (Steam id 1035219615) — annotated per-vehicle placement diagrams. **Best single source for placement.** [S13]
- coh2.org "Emblems and names of armies" (topic 45813). [S14]
- Steam guide "COH2 Decal" workshop previews (id 1658878963). [S15]

### EXPECTED IN-GAME APPEARANCE — rubric (German vehicles)
1. Insignia is player-colour tinted (matches the player's slot colour), not a fixed colour.
2. On Tiger / StuG III / Panzer III-IV-class: a small balkenkreuz-style cross sits on the **side skirt (schürzen) / hull side**, roughly a ~0.5m patch, one per side (mirrored). Turret side may carry a number, not the cross.
3. On T-34/76: insignia is on the **front glacis**, not the hull side.
4. On Panther: cross on the **front superstructure sides** (and rear bins), not mid-hull.
5. The insignia sits on small detail geometry (skirt/hatch/fitting), never smeared across the whole hull body polygon.
6. Only ONE insignia cell per side (the stock engine cell) — absence of extra division emblems/serial numbers is expected, not a failure.

---

## 3. DECAL PACKS (player-equippable vehicle decals feature)

### What the sources establish
- The equippable "decal" feature uses the **same badge-atlas system as the national insignia** — a decal pack ships a replacement `teamTex` badge atlas per faction (5 factions: German, Soviet, AEF, OKW/West-German, British). So an equipped custom decal renders in the **same place** as the national insignia (the TEXCOORD1 badge cell — side skirts / hull side), just with different atlas art. [WIKI-DECAL-PACK][S16][S17]
- Equipped decals are **player/team-colour tinted by default**, same as insignia; some community "decal remover / team-colour" packs exist specifically to strip the coloured stripes and leave only the main symbol + serial, which confirms the default is coloured. [S7][S18]
- A decal is one item equipped in the loadout (post War-Spoils-2.0: only one of any item type per loadout). [S19]

### Best reference images
- coh2.org "Official COH2.ORG Decal Pack" (Workshop 467913090) + launch article (news 35747) — canonical decal previews on vehicles. [S16][S20]
- Steam Workshop "CoH2 - Decals" (id 1636447609). [S17]

### EXPECTED IN-GAME APPEARANCE — rubric
1. An equipped custom decal appears in the SAME location as the national insignia (side-skirt / hull-side badge cell), because it is the same `teamTex` system.
2. The decal is player-colour tinted by default (unless the pack deliberately bakes fixed colour).
3. One decal per side, same ~0.5m patch size as the insignia — not a large hull-spanning graphic.
4. Custom decal only shows in custom/vs-AI games (same gate as skins, §0).

---

## 4. FACEPLATES in-game

### What the sources establish
- **A faceplate is a UI banner behind the player's identity, NOT anything on a vehicle.** [S21][S22]
- **Dimensions: 624 × 204 px** (aspect ≈ 3.06:1, a wide short banner). Accompanying inventory icon **64 × 64 px**; Steam Workshop store thumbnail **280 × 280 TGA**. [S22][S23]
- **Where it displays:** the player card (in menus / profile), the loadout / army-customizer screen, and the **in-match loading screen**; also referenced on the main-menu profile and scoreboard. It is a cosmetic that frames the player's name/level. [S21][S24][WEB-WARSPOILS]
- **Text over it:** the player name and level/rank render OVER the faceplate art. No source documents an exact safe-zone pixel box, but because the name+level overlay the banner, faceplate art must tolerate text on top — typically the name sits toward the left/centre with the art acting as a background/frame. Frames come in bronze/silver/gold tiers plus themed DLC/preorder variants. [S21][S22][WARN-FACEPLATE-SAFEZONE]

### Best reference images
- coh2.org "Company of Heroes 2 Faceplates" (topic 42839) — catalogue of faceplate frames by internal name (bronze/silver/gold/paratrooper etc.). [S21]
- coh2.org "[Guide] How to make a CoH2 faceplate — update 2022" (topic 109813) + Steam guide id 2679894588 — 624×204 template. [S22][S23]
- Steam Workshop "Official COH2.ORG Faceplate" (id 467909467). [S25]

### EXPECTED IN-GAME APPEARANCE — rubric
1. Faceplate is a wide banner (~3:1, 624×204) behind the player's name/level — never on a vehicle.
2. It appears on the loading screen and on the player card in menus/loadout.
3. Player name + level/rank text render OVER the faceplate art (art is background/frame).
4. Rendered aspect stays ~3.06:1; our editor's faceplate canvas should match 624×204.

---

## 5. WAR SPOILS / ARMY CUSTOMIZER UI (screen-recognition aid for the run agent)

### Layout facts
- **Vehicle skin slots: 6 per faction**, arranged by class × season:
  - Light Summer · Light Winter
  - Medium Summer · Medium Winter
  - Heavy Summer · Heavy Winter
  A skin in "Heavy Summer" applies to every heavy tank on summer maps, etc. Season is auto-selected by map. [S1][S6]
- Skins/decals/faceplates are equipped in the **army customizer** (per-faction loadout screen). [S6]
- **War Spoils 2.0 loadout rule:** only ONE item of any given type per loadout (so one skin per class-slot, one decal, one faceplate, one of each bulletin type). [S19][WEB-WARSPOILS]
- The in-game **store** browses items by category (skins, decals, faceplates, commanders, bulletins, victory strikes) with a dropdown/type filter; duplicates salvage to Supply currency (500 each). [WEB-WARSPOILS]

### Screen-recognition cues for the harness
- The army-customizer screen is per-faction; look for the **six vehicle-skin slots grouped in a Light/Medium/Heavy × Summer/Winter grid**, with separate slots/tabs for decal and faceplate.
- A live 3D vehicle preview is shown in the customizer (this is the closest in-game analogue to our editor's viewport).

### Best reference images
- Steam discussion "How do the vehicle skins work?" (id 864971765871043683) — describes the 6-slot grid. [S1]
- Gameranx "War Spoils 2.0 Update Detailed" — store/loadout structure. [WEB-WARSPOILS]

---

## 6. DIFFERENCES TO EXPECT vs OUR EDITOR RENDER

When comparing a live capture to our editor's 3D preview, these differences are EXPECTED and must not be scored as fidelity failures:

- **Team/player-colour tint.** In-game, insignia AND team-colour stripes are tinted by the player's *slot* colour (unknowable at edit time). Our editor uses a faction-REPRESENTATIVE tint (`FACTION_BADGE_TINT`: German/OKW warm tan, Soviet red, AEF gold, British green). Expect the live cross to be whatever the player's slot colour is, not our preview tint. [WIKI-DECAL-RENDER]
- **Lighting / environment.** In-game the vehicle sits under the map's dynamic lighting + environment map (EnvMapDiffuse/Specular) with shadows, dirt, and battle weathering overlays. Our editor uses a neutral studio light. Live captures will be darker/warmer/dirtier and have cast shadows.
- **Zoom.** Match tactical zoom makes the vehicle small — insignia and fine camo detail are barely legible. Our editor shows a zoomed-in beauty view. Judge placement/coverage from a zoomed-in capture; do not expect tactical-zoom captures to show small-detail fidelity.
- **Season.** The live game auto-picks summer vs winter by map; our editor shows whichever variant is loaded. Ensure the capture map's season matches the variant being judged.
- **Tracks & animation.** Live tracks scroll (uvanim) and are unskinned; our static editor preview shows them still. Not a defect.
- **Custom-game gate.** If a capture shows NO custom skin/decal at all, first check the game mode (§0) before concluding the render is wrong.

---

## 7. UNVERIFIED / could not find imagery (treat as CANT-TELL, never FAIL)

- **Exact insignia size in metres on each hull.** Inferred ~0.5m from the UV cell; no source gives a metric measurement. UNVERIFIED.
- **Per-vehicle placement for King Tiger, Brummbär, Ostwind, Sdkfz 251 halftrack, Panzerwerfer, Elefant, Jagdtiger specifically from in-game screenshots.** The IFN1 guide covers Tiger/Panther/StuG III/Panzer III; KT/Brummbär/Ostwind/halftrack/Panzerwerfer placement is taken from our bake-rects (hullSideRight) and the general schürzen rule, not from a confirmed per-vehicle in-game photo. UNVERIFIED against external imagery — our internal analysis is the only source.
- **The newer Steam guide id 3051286617 ("German vehicles Historic Decal Placement") turned out to be a WAR THUNDER guide, not CoH2** — excluded, do not cite it for CoH2.
- **Exact faceplate text safe-zone (pixel box where name/level sit).** No source documents it; only the 624×204 canvas size is confirmed. UNVERIFIED. [WARN-FACEPLATE-SAFEZONE]
- **Whether the in-match scoreboard shows the faceplate** (vs only loading screen + player card). Referenced generically in one source but not screenshot-confirmed. UNVERIFIED.
- **Exact tactical-zoom vs zoomed-in camera ratio** and how legible insignia is at each. Inferred from how previews are presented. UNVERIFIED.
- **coh2.org faceplates thread and the IFN1 English guide could not be fully fetched** (HTTP 500 / persistent 429 rate-limit); their content here comes from search-snippet extraction, which is reliable for the quoted placements but did not yield the full annotated diagrams. Re-fetch later for the full per-vehicle diagram set.

---

## Sources

- **[S1]** Steam Discussion — "How do the vehicle skins work?" — https://steamcommunity.com/app/231430/discussions/0/864971765871043683/ (6-slot customizer: Light/Medium/Heavy × Summer/Winter)
- **[S2]** coh2.org — "Skins, etc NOT in Auto-match" — https://www.coh2.org/topic/35825/skins-etc-not-in-auto-match
- **[S3]** coh2.org — "Question on how custom skin settings work in-game" — https://www.coh2.org/topic/58767/question-on-how-custom-skin-settings-work-in-game/page/1
- **[S4]** Steam Discussion — "Can we allow workshop vehicle skins to show up in coh2 online multiplayer?" — https://steamcommunity.com/app/231430/discussions/0/541907867759870821/
- **[S5]** Steam Discussion — "Custom vehicle skins" — https://steamcommunity.com/app/231430/discussions/0/43099721351170313/
- **[S6]** Steam Discussion — "Vehicle Skins not applying. HELP" — https://steamcommunity.com/app/231430/discussions/0/2217311444325646675/
- **[S7]** Nexus — "Minor UI Tweaks and Team Color Edits" — https://www.nexusmods.com/companyofheroes/mods/1130 (default vehicle decals are team-colour tinted; option controls it)
- **[S8]** CoH Fandom — "Vehicle Patterns" — https://companyofheroes.fandom.com/wiki/Vehicle_Patterns (summer/winter, incomplete winter whitewash)
- **[S9]** coh2.org — "All Factions Vehicle Skins Database" — https://www.coh2.org/topic/27537/all-factions-vehicle-skins-database/page/4
- **[S10]** Steam Discussion — "custom skins and decal not working" — https://steamcommunity.com/app/231430/discussions/0/364039785162407284/
- **[S11]** Steam Workshop — "CoH2 - Camouflage Skins" — https://steamcommunity.com/sharedfiles/filedetails/?id=1636442984
- **[S12]** Steam Workshop — "Vehicle Skins All Factions" — https://steamcommunity.com/workshop/filedetails/?id=1694297222
- **[S13]** Steam Guide — "IFN1 Authentic Tank Decal Guide" (CoH2) — https://steamcommunity.com/sharedfiles/filedetails/?id=1035219615 (per-vehicle balkenkreuz placement; **best placement source**)
- **[S14]** coh2.org — "Emblems and names of armies" — https://www.coh2.org/topic/45813/emblems-and-names-of-armies
- **[S15]** Steam Workshop — "COH2 Decal" — https://steamcommunity.com/sharedfiles/filedetails/?id=1658878963
- **[S16]** Steam Workshop — "Official COH2.ORG Decal Pack" — https://steamcommunity.com/sharedfiles/filedetails/?id=467913090
- **[S17]** Steam Workshop — "CoH2 - Decals" — https://steamcommunity.com/sharedfiles/filedetails/?id=1636447609
- **[S18]** Steam Workshop — "BKMOD II - Decals" — https://steamcommunity.com/sharedfiles/filedetails/?id=467957714
- **[S19]** Gameranx — "CoH2 War Spoils 2.0 Update Detailed" — https://gameranx.com/updates/id/58661/article/company-of-heroes-2-war-spoils-2-0-update-detailed/ (one item per type per loadout)
- **[S20]** coh2.org — "COH2.ORG Faceplate & Decal Pack Launched" — https://www.coh2.org/news/35747/coh2-org-faceplate-decal-pack-launched
- **[S21]** coh2.org — "Company of Heroes 2 Faceplates" — https://www.coh2.org/topic/42839/company-of-heroes-2-faceplates (faceplate frame catalogue; player-card + loading-screen display)
- **[S22]** coh2.org — "[Guide] How to make a CoH2 faceplate — update 2022" — https://www.coh2.org/topic/109813/guide-how-to-make-a-coh2-faceplate-update-2022 (624×204)
- **[S23]** Steam Guide — "How to make a faceplate in 2022" — https://steamcommunity.com/sharedfiles/filedetails/?id=2679894588 (624×204 PNG, 64×64 icon, 280×280 TGA)
- **[S24]** Cheat Happens — "Commanders and War Spoils" board — https://www.cheathappens.com/show_board2.asp?headID=123126&titleID=18780 (faceplates via War Spoils; loot bar on player card)
- **[S25]** Steam Workshop — "Official COH2.ORG Faceplate" — https://steamcommunity.com/sharedfiles/filedetails/?id=467909467
- **[WEB-WARSPOILS]** Gameranx War Spoils 2.0 article (store categories, salvage) = [S19]

### Internal engine ground-truth (LLM-wiki, our own reverse-engineering)
- **[WIKI-DECAL-RENDER]** `llm-wiki/wiki/concepts/coh2-vehicle-decal-rendering.md` — `coh2_vehicle` shader, `teamTex`/`teamColour`, TEXCOORD1 badge cluster U[0.286,0.337]×V[0.039,0.086], tracks use `coh2_vehicle_uvanim`, "Hide Decals" toggle, player-colour override at draw time.
- **[WIKI-DECAL-PACK]** `llm-wiki/wiki/concepts/coh2-decal-pack-format.md` — single 2048² body atlas (StuG/Brummbär extra panel atlas), 5-faction badge atlases, 9 authored bake-rects (Tiger/KT/Easy8/SU-85/StuG/KV-2/Panzerwerfer/Firefly = hullSideRight; T-34/76 = hullFront/glacis).

### Notes on source retrieval
- **[WARN-FACEPLATE-SAFEZONE]** No source documents a faceplate text safe-zone pixel box; only 624×204 canvas confirmed.
- IFN1 guide (S13) and coh2.org faceplates thread (S21) could not be fully fetched (429 / 500); per-vehicle placements above are from reliable search-snippet extraction, not the full annotated diagrams. Re-fetch for full diagrams.
