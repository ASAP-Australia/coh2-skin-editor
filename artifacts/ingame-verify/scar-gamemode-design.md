# CoH2 "ASAP Verify" Win-Condition Gamemode — Implementation Design

**Status:** research-only design doc. Nothing built, nothing launched. All facts below are
verified against on-disk ground truth (real Workshop gamemode SGAs + the base game's own
`Data.sga`/`AttribArchive.sga`) or cited web sources.

**Goal:** a skirmish-lobby-selectable win condition that, at match start, auto-spawns ~8–10
player-owned German vehicles in a grid, reveals fog of war, positions the camera to view the
grid, and prints an on-screen marker — so an external harness can screenshot the player's
equipped skin + decal on every vehicle class in one shot.

---

## 0. Ground-truth sources dissected (evidence base)

| What | Where | Key facts extracted |
|---|---|---|
| Real Workshop gamemode SGA (Infantry-Only) | `.../mods/gamemode/subscriptions/481822725.sga` | Exact file layout; `.win` is **plain text**; camera/resource/AI includables |
| Real Workshop gamemode SGA (annihilate/VP) | `.../mods/gamemode/subscriptions/333857863.sga` | Minimal layout: `game/winconditions/*.win` + `scar/winconditions/*.scar` + `.info` + `preview.tga` |
| Base-game SCAR stdlib | `Company of Heroes 2/CoH2/Archives/Data.sga` → `scar/*.scar` | `Util_CreateSquads`, `Squad_CreateAndSpawnToward`, `Camera_*`, `FOW_*`, `PrintOnScreen`, `Util_ScarPos` |
| Base-game SBP blueprints | `.../Archives/AttribArchive.sga` → `attrib/sbps/races/german/vehicles/**` | **Exact leaf names** for Tiger/StuG/PzIV/Brummbär/Ostwind/Panzerwerfer/251/222/Puma/Panther |
| SCAR API reference | github.com/Janne252/coh2-scar-api | `FOW_RevealAll()` / `FOW_UnRevealAll()` signatures |
| ModBuilder GUI | `Company of Heroes 2 Tools/ModBuilder.exe` (strings) | Has a **WinConditionWizard** (`WinConditionName/Description/File/ScarFile`); confirms `.win`+`.scar` two-file model |
| Our SGA writer | `coh2-skin-editor/src/lib/sga-writer.ts` `buildSga()` | Pure-Node SGA v7 writer, already ships real skin packs in-game |

The SGA reader/writer used for dissection: `src/lib/sga.ts` (`SgaArchive.open/listPaths/readByPath`)
and `src/lib/sga-writer.ts` (`buildSga`). Throwaway lister/extractor scripts were used and deleted.

---

## 1. Exact mod file layout (inside the SGA)

Modeled on the minimal real gamemode `333857863.sga`. A win-condition mod is a **`gamemode`-type**
SGA. Backslash paths, DFS folder order, storage=zlib — all handled by `buildSga` (see
[[coh2-workshop-publish-flow]] / [[sga-rgt-format]]).

```
<MODGUID>.sga  (archiveName = <MODGUID>, a 32-hex string like the .info stem)
├── game/winconditions/asap_verify.win           ← lobby entry (PLAIN TEXT, see §1a)
├── scar/winconditions/asap_verify.scar          ← the script (§2)
├── <MODGUID>.info                                ← mod metadata (PLAIN TEXT, see §1b)
└── preview.tga                                   ← lobby thumbnail (optional; TGA, 128×128-ish)
```

Everything is optional except the `.win` + `.scar` pair. `preview.tga` and `.info` improve the
lobby presentation but the mod loads without them (annihilate mod ships both; keep them).

**Deploy location (local, unsigned — loads with `[Sig:0]`):**
```
.../compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/
    Company of Heroes 2/mods/gamemode/<MODGUID>.sga
```
(Workshop subscriptions land in `gamemode/subscriptions/`; a *local* mod goes directly in
`gamemode/`. Mirrors how skins load from `mods/skins/<id>.sga` unsigned — confirmed in
[[coh2-harness-driving]].)

### 1a. `game/winconditions/asap_verify.win` — VERBATIM SCHEMA (plain text!)

**Critical finding:** the `.win` is NOT binary `.rgd`. It is plain UTF-8 Lua-style key/value text.
Extracted verbatim from `481822725.sga` → `inf-only-an-vx2.win`:

```
name = "asap_verify"
scar_file = "data:scar/winconditions/asap_verify.scar"
fe_name = "ASAP Verify"
fe_priority = 0
score_display = time
show_time = true
```

- `name` — internal id (no spaces).
- `scar_file` — **`data:` prefix + forward-slash path** to the script inside the SGA. (Note: the
  `.win` uses `data:scar/...`; the `import()` calls inside the `.scar` use bare `winconditions/...`.)
- `fe_name` — **this is the string that appears in the skirmish lobby's game-mode dropdown.**
- `fe_priority` — sort order (0 fine).
- `score_display`/`show_time` — cosmetic HUD; keep as-is.
- **`entity_replacements = { { original=..., replacement=... } }` — REQUIRED for lobby
  listing (Gen5 finding, 2026-07-19).** This note previously said "optional / omit" — that
  was WRONG and caused the Gen1–Gen4 non-listing. ALL 70 working `.win` files carry an
  `entity_replacements` block, a `requires_vp_ticker` field, or both; a `.win` with neither
  boots but is dropped from the dropdown. We ship the `victory_point → territory_point_mp`
  block (inert for us, matches the confirmed-listed Resources modes). See the Gen5 section.

### 1b. `<MODGUID>.info` — metadata (plain text)

Extracted schema from `74a79b75...info`:
```
hidden = false
name = "ASAP Verify Gamemode"
description = "Auto-spawns a grid of German vehicles, reveals FOW, and frames the camera for skin/decal capture."
dependencies =
{
}
```

---

## 2. Full SCAR script draft — `scar/winconditions/asap_verify.scar`

Every function below is verified present in the base-game `Data.sga` SCAR stdlib (file:line cited
in comments) or in the real Infantry-Only gamemode. Entry point is **`Scar_AddInit(fn)`** (NOT
`OnInit`) — this is the confirmed convention (`inf-only` mod and every base script use it).

```lua
-- ============================================================================
-- ASAP Verify — in-game skin/decal verification gamemode
-- Spawns a grid of player-1 German vehicles, reveals FOW, frames the camera.
-- ============================================================================

-- Grid config -----------------------------------------------------------------
local GRID_SPACING   = 15          -- metres between vehicles (CoH2 world units ~= metres)
local GRID_COLS      = 5
local GRID_ORIGIN_X  = 0           -- map-centre-ish; tweak per map (see Risk R2)
local GRID_ORIGIN_Z  = 0

-- SBP leaf names — EXACT, from AttribArchive.sga (attrib/sbps/races/german/vehicles/**).
-- BP_GetSquadBlueprint() takes the *leaf name*, not the full path (confirmed: base
-- scarutil.scar:120-141 calls e.g. BP_GetSquadBlueprint("il-2_sturmovik_recon_squad_sp")).
-- Use the _mp variants (multiplayer/skirmish balance blueprints).
local VEHICLE_SBP_NAMES = {
   "tiger_squad_mp",              -- Tiger I            (heavy)
   "panther_squad_mp",           -- Panther            (medium/heavy)
   "panzer_iv_squad_mp",         -- Panzer IV          (medium)
   "stug_iii_squad_mp",          -- StuG III           (tank destroyer)
   "brummbar_squad_mp",          -- Brummbär           (assault gun)
   "ostwind_squad_mp",           -- Ostwind            (AA / medium)
   "panzerwerfer_squad_mp",      -- Panzerwerfer       (rocket HT)
   "sdkfz_251_halftrack_squad_mp",-- Sd.Kfz.251 HT     (light vehicle)
   "scoutcar_sdkfz222_mp",       -- Sd.Kfz.222 scout   (light vehicle)
   "puma_squad_mp",              -- Puma (SdKfz 234)   (light vehicle)  ** see Risk R1 **
}

-- ---------------------------------------------------------------------------
function ASAPVerify_SpawnGrid()
   local player = World_GetPlayerAt(1)         -- player 1 (base: player.scar / World_GetPlayerAt)

   local sgroup = SGroup_CreateIfNotFound("sg_asap_verify")   -- groups.scar:1684
   local n = table.getn(VEHICLE_SBP_NAMES)
   for i = 1, n do
      local col = (i - 1) % GRID_COLS
      local row = math.floor((i - 1) / GRID_COLS)
      local x   = GRID_ORIGIN_X + col * GRID_SPACING
      local z   = GRID_ORIGIN_Z + row * GRID_SPACING
      -- Util_ScarPos(xpos, zpos, ypos) -> World_Pos(x, y, z); y auto to terrain.
      local pos = Util_ScarPos(x, z)                          -- scarutil.scar:585
      local bp  = BP_GetSquadBlueprint(VEHICLE_SBP_NAMES[i])  -- scarutil.scar:120 pattern
      if bp ~= nil then
         -- Util_CreateSquads(player, sgroup, sbp, location(ST_SCARPOS ok),
         --                   destination, numsquads, loadout, ...) -> SGroup
         -- scarutil.scar:696 ; internally calls Squad_CreateAndSpawnToward(bp,player,loadout,pos,toward)
         Util_CreateSquads(player, "sg_asap_verify", bp, pos, nil, 1, 0)
      end
   end
end

-- ---------------------------------------------------------------------------
function ASAPVerify_Setup()
   -- 1) Resources: give player huge resources so nothing decays / no upkeep pressure.
   --    (Player_SetPopCapOverride from set-player-resources.scar ground-truth.)
   local player = World_GetPlayerAt(1)
   Player_SetPopCapOverride(player, 999)                      -- ground-truth set-player-resources.scar
   -- Optional: Player_SetResource(player, RT_Manpower, 99999) etc. (player.scar)

   -- 2) Disable AI aggression: simplest = spawn on a 1-player-vs-nothing skirmish, OR
   --    zero the AI's income so it never builds an army (pattern lifted from the
   --    inf-only mod's ai-buff-nerf-functions.scar). For pure verification, launch the
   --    skirmish with NO AI opponent (empty slots) — cleanest. See §2-notes.

   -- 3) Reveal the whole map so fog never hides the grid.
   FOW_RevealAll()                                            -- scar-api chunk04: "Reveal FOW for all players", no args

   -- 4) Spawn the vehicle grid.
   ASAPVerify_SpawnGrid()

   -- 5) Frame the camera on the grid centre (deferred 1.5s so terrain/units settle).
   Rule_AddOneShot(ASAPVerify_FrameCamera, 1.5, 1000)         -- Rule_AddOneShot(fn,delaySec,id) — ground-truth inf-only

   -- 6) OCR marker for the harness. dr_text2d draws normalized-coord screen text
   --    (ground-truth single-player-display.scar uses dr_text2d/dr_clear/dr_setautoclear).
   dr_clear("asap_marker")
   dr_setautoclear("asap_marker", false)
   dr_text2d("asap_marker", 0.02, 0.02, "ASAP_VERIFY_READY", 1, 1, 1)
   -- (Alt: PrintOnScreen("ASAP_VERIFY_READY") — printonscreen.scar — bigger centre text.)
end

-- ---------------------------------------------------------------------------
function ASAPVerify_FrameCamera()
   -- Centre of the grid, in world coords.
   local cx = GRID_ORIGIN_X + ((GRID_COLS - 1) * GRID_SPACING) / 2
   local cz = GRID_ORIGIN_Z + (math.floor((table.getn(VEHICLE_SBP_NAMES)-1)/GRID_COLS) * GRID_SPACING) / 2
   local center = Util_ScarPos(cx, cz)

   -- Camera_MoveTo(pos, pan, panRate, keepLocked, resetToDefault) — camera.scar:Camera_MoveTo
   Camera_MoveTo(center, false)

   -- Zoom the camera out so the whole grid fits (ground-truth set-zoom-limit.scar):
   -- Camera_SetTuningValue(TV_DistMax, multiplier * Camera_GetTuningValue(TV_DistMax))
   Camera_SetTuningValue(TV_DistMax, 4 * Camera_GetTuningValue(TV_DistMax))

   -- Optional fixed orientation (ground-truth set-camera-orientation.scar):
   -- Camera_SetDefault(height, declination, angle); Camera_ResetToDefault()
end

-- ---------------------------------------------------------------------------
Scar_AddInit(ASAPVerify_Setup)   -- entry point (confirmed convention)
```

**§2 notes**
- **No AI opponent is the cleanest way to "disable AI aggression"**: set up the skirmish with all
  enemy slots empty / closed. Then the AI-nerf includables aren't needed at all. If an AI must be
  present, port `neutralizeResourceCheats()` + `setAIResourceRate(...)` from
  `ai-buff-nerf-functions.scar` (extracted verbatim, available in the inf-only mod) to starve it.
- `import()` of the base annihilate wincondition is **optional**. The real gamemodes `import(
  "winconditions/annihilate.scar")` to get a real win/loss. For pure verification we don't need a
  win condition at all — but if the lobby refuses a "wincondition-less" `.win`, add
  `import("winconditions/annihilate.scar")` at the top (its `Scar_AddInit` coexists with ours).
- `Util_ScarPos(x, z)` leaves `y` to auto-resolve to terrain height (2-arg form) — safest for
  arbitrary maps.

---

## 3. CRITICAL QUESTION — do script-spawned player-owned squads render the equipped skin + decal?

**Answer: YES, in this exact scenario (skirmish vs AI / no-AI = single-player context), with high
confidence.** Evidence:

1. **Skins bind to vehicle _class × season_, not to how a unit was created.** Steam discussion
   "How do the vehicle skins work?": *"Putting a skin in the Heavy Summer slot will apply the skin
   to every heavy tank you deploy in a summer map"* — i.e. **any** heavy tank the player owns gets
   the equipped skin. A `Squad_CreateAndSpawnToward`-spawned squad owned by player 1 is a
   player-owned heavy/medium/light tank exactly like a produced one, so the class/season slot skin
   applies. (Source: steamcommunity.com/app/231430/discussions/0/864971765871043683/)
2. **Custom skins render in single-player / custom games, just not ranked MP.** Same thread + the
   Essence "Skin Pack" wiki: custom vehicle skins show *"to vehicles in single player (vs AI)"* and
   in custom games where the other player hasn't disabled decals/skins. Our verification skirmish is
   exactly that context. (Sources: modding.companyofheroes.com/skin-pack;
   steamcommunity.com/app/231430/discussions/…)
3. **Decals/national insignia are a mesh-UV + team-colour engine feature** applied per vehicle class
   at render time (see [[coh2-vehicle-decal-rendering]] — TEXCOORD1 badge UV, tinted by teamColour),
   independent of spawn method. They render on any owned vehicle.

**Caveat / season matching:** the equipped-skin slot is season-specific (summer vs winter). The
map's season must match the slot the skin is equipped in (e.g. a summer map to show a Heavy-Summer
skin). Pick a **summer skirmish map** for the grid, or equip the skin in both season slots.

**Fallback if uncertain in-run:** the whole point of this gamemode is to *observe* the capture — the
harness screenshots the grid; if a vehicle shows the default skin, that's an immediate visible
signal (skin not equipped in that class/season, or map season mismatch). No blind trust needed:
the screenshot is the verification.

---

## 4. Packing plan — RECOMMENDED PATH

**Recommendation: pack the whole mod with our existing pure-Node `buildSga()` — no ModBuilder, no
wine.** This is the concrete winning path because:

- The `.win` and `.info` are **plain text** (proven by extraction — §1a/§1b), and the `.scar` is
  plain text. **There is no binary `.rgd` to author.** This removes the only reason we'd have needed
  ModBuilder's AttributeEditor.
- `buildSga({ archiveName, files: [{ path, bytes, compress? }] })`
  (`src/lib/sga-writer.ts:82`) already packs arbitrary path→bytes into a valid SGA v7 that CoH2
  loads unsigned — it is the same writer that ships real skin packs in-game (`scripts/
  build-honved-sga.mts` → published Honvéd packs, [Sig:0]). Gamemode SGAs load unsigned exactly like
  skins do (both live under `mods/`).

**Concrete build recipe (throwaway script, mirrors `build-honved-sga.mts`):**
```ts
import { buildSga } from 'src/lib/sga-writer.ts'
const enc = (s:string) => new TextEncoder().encode(s)
const MODGUID = '<32-hex>'   // any 32-hex string; reuse as archiveName + .info stem
const sga = await buildSga({
  archiveName: MODGUID,
  files: [
    { path: `game\\winconditions\\asap_verify.win`, bytes: enc(WIN_TEXT) },
    { path: `scar\\winconditions\\asap_verify.scar`, bytes: enc(SCAR_TEXT) },
    { path: `${MODGUID}.info`, bytes: enc(INFO_TEXT) },
    // optional: { path: 'preview.tga', bytes: tgaBytes },
  ],
})
// write sga to  mods/gamemode/<MODGUID>.sga  (local, unsigned)
```
(`buildSga` normalizes to backslash + DFS order + zlib storage internally — see writer header.)

**Fallback (only if the game rejects the hand-packed gamemode SGA):** use ModBuilder's
**WinConditionWizard** under Proton/wine to generate a reference `.win`+`.scar`+SGA, diff its byte
layout against ours, and copy any missing header/field. ModBuilder.exe is a GUI (no evidence of a
headless CLI in its strings — only wizard field names), so this is the slower manual fallback, not
the primary path.

**Why not the `scenarios` folder:** scenario mods are full maps (multi-MB, `.sgb`/terrain) — wrong
tool. Win conditions are the correct, lightweight `gamemode` type.

---

## 5. Lobby-selection plan (skirmish lobby clicks)

From [[coh2-harness-driving]] (harness drives CoH2 at 1920×1080 with the render-resolution fix) and
standard CoH2 UI flow:

1. Main menu → **"Army / Custom Game"** (skirmish vs AI). CoH2: main menu → **PLAY** → **CUSTOM
   GAME / VS AI**.
2. In the game-setup lobby, pick a **summer map** (season match, §3 caveat) with **1 human + 0
   AI** (empty enemy slots) — cleanest for verification.
3. **Game-mode dropdown:** in the lobby's settings column there is a **"Win Condition" / "Game
   Mode" dropdown** (default "Victory Point" / "Annihilation"). Open it — our `fe_name = "ASAP
   Verify"` appears as an entry (that string is the dropdown label, confirmed from the `.win`
   schema). Select it.
   - The mod must first be **enabled**: for local mods this is automatic once the SGA is in
     `mods/gamemode/`; for Workshop subs, enable under the mods/extension manager. (Skins use the
     analogous `mods/skins/` auto-load — [[coh2-harness-driving]].)
4. **START GAME.** On load, `Scar_AddInit(ASAPVerify_Setup)` fires → grid spawns, FOW reveals,
   camera frames, `ASAP_VERIFY_READY` prints. Harness waits for the OCR marker, then screenshots.

> Exact pixel coordinates for each click are NOT yet mapped — the 2026-06-24/25 session got to the
> main menu with the resolution fix but did not map the custom-game/dropdown coords
> ([[coh2-harness-driving]] "Menu navigation notes: incomplete"). Mapping those coords is a
> one-time probe (grid-overlay a screenshot of the lobby), listed as R4 below.

---

## 6. Risks + unknowns (ranked) — each with a cheap probe

| # | Risk / unknown | Impact | Cheap probe |
|---|---|---|---|
| **R1** | **`puma_squad_mp` leaf name unverified.** AttribArchive shows `puma/puma_east_german_mp.rgd` and `puma_squad`-family may differ; Puma is OKW/West-German, not always Ostheer. Some listed names (`ostwind_squad_mp`, `panzerwerfer_squad_mp`) are verified `.rgd` stems; a couple (`puma_squad_mp`, `panther_squad_mp` for Ostheer) need a name check. | 1–2 grid cells spawn empty (bp==nil → skipped, harmless). | Re-grep `AttribArchive.sga` for `puma`/`panther` `_mp` leaf stems; or in-run: `if bp==nil then print(name) end`. Swap to a verified Ostheer stem. Script already null-guards, so worst case = fewer vehicles, no crash. |
| **R2** | **Grid origin (0,0) may be off-map / on impassable terrain** for a given map; vehicles may fail to spawn or stack. | Grid off-screen or vehicles bunched. | Probe: spawn at `Util_ScarPos(0,0)` on the chosen map; if empty, read player-1 start via `Player_GetNearestValidSpawn`/base marker and offset from there. One test launch resolves it. Prefer a known flat map (e.g. a 1v1 training map). |
| **R3** | **Lobby may reject a `.win` with no real win condition** (never ends). | Mode doesn't appear / game won't start. | Add `import("winconditions/annihilate.scar")` (its `Scar_AddInit` coexists). Probe: try without first; if the dropdown entry is missing or start fails, add the import and repack (30-sec loop). |
| **R4** | **Lobby click coordinates unmapped** (custom-game button, map picker, game-mode dropdown). | Harness can't auto-select the mode. | Grid-overlay one lobby screenshot at 1920×1080 (harness), read the button/dropdown pixel coords once, bank to the wiki. ~10 min, no code. |
| **R5** | **Season mismatch** hides the equipped skin (summer skin on winter map). | Screenshot shows default skin — false negative. | Pick a summer map, or equip the skin in both season slots. Verify by eye in the first capture. |
| **R6** | **`FOW_RevealAll` scope / per-player context.** Confirmed no-arg "reveal for all players", but zoom `TV_DistMax*4` may still fog distant units (the inf-only `.info` warns detail hides beyond a point). | Far grid rows dim. | Keep the grid compact (5×2, 15 m) so it fits within un-fogged zoom. Probe: screenshot; if far rows fog, reduce `GRID_SPACING`/cols or lower zoom multiplier to 2–3×. |

---

## Appendix A — Verified SBP leaf-name → source path map

All from `AttribArchive.sga` (`attrib/sbps/races/german/vehicles/**`):

| Vehicle | Verified `.rgd` leaf (use with `BP_GetSquadBlueprint`) | Source path |
|---|---|---|
| Tiger I | `tiger_squad_mp` | `.../tiger_squad/tiger_squad_mp.rgd` |
| Panther | `panther_squad_mp` | `.../panther_squad/panther_squad_mp.rgd` |
| Panzer IV | `panzer_iv_squad_mp` | `.../panzer_iv_squad/panzer_iv_squad_mp.rgd` |
| StuG III | `stug_iii_squad_mp` | `.../stug_iii_squad/stug_iii_squad_mp.rgd` |
| Brummbär | `brummbar_squad_mp` | `.../brummbar_squad/brummbar_squad_mp.rgd` |
| Ostwind | `ostwind_squad_mp` | `.../ostwind_squad/ostwind_squad_mp.rgd` |
| Panzerwerfer | `panzerwerfer_squad_mp` | `.../panzerwerfer_squad/panzerwerfer_squad_mp.rgd` |
| Sd.Kfz.251 HT | `sdkfz_251_halftrack_squad_mp` | `.../halftrack_squad/sdkfz_251_halftrack_squad_mp.rgd` |
| Sd.Kfz.222 scout | `scoutcar_sdkfz222_mp` | `.../scout_car_sdkfz222/scoutcar_sdkfz222_mp.rgd` |
| Puma | `puma_east_german_mp` *(only Puma `_mp` stem found — NOT `puma_squad_mp`; **R1**)* | `.../puma/puma_east_german_mp.rgd` |

> Confidence: 8 of 10 leaf names are directly the `.rgd` stems (high). `puma_squad_mp` was a guess —
> the only verified Puma `_mp` stem is `puma_east_german_mp` (West-German/OKW roster); for a pure
> Ostheer-German grid, drop the Puma or substitute another verified medium. `panther_squad_mp` stem
> is present and verified.

## Appendix B — Verified SCAR API cheat-sheet (all from Data.sga unless noted)

| Function | Signature | Source |
|---|---|---|
| `Scar_AddInit(fn)` | register match-init callback (entry point) | inf-only mod + every base script |
| `Rule_AddOneShot(fn, delaySec, id)` | deferred one-shot | inf-only mod ground truth |
| `Rule_AddInterval(fn, sec, id)` | periodic | single-player-display.scar |
| `World_GetPlayerCount()` / `World_GetPlayerAt(p)` | player enumeration (1-based) | set-player-resources.scar |
| `Util_CreateSquads(player, sgroup, sbp, location, dest, num, loadout, ...)` | high-level spawn → SGroup | scarutil.scar:696 |
| `Squad_CreateAndSpawnToward(bp, player, loadout, pos, toward)` | low-level spawn (called by above) | scarutil.scar:765 |
| `BP_GetSquadBlueprint("leaf_name")` | SBP name → blueprint object | scarutil.scar:120 |
| `Util_ScarPos(x, z [,y])` → `World_Pos(x,y,z)` | build a ScarPosition | scarutil.scar:585 |
| `SGroup_CreateIfNotFound("name")` | make/reuse an sgroup | groups.scar:1684 |
| `FOW_RevealAll()` / `FOW_UnRevealAll()` | reveal/undo whole-map FOW (no args) | scar-api chunk04 |
| `FOW_RevealArea(pos, radius, durationSec)` | reveal a circle | scarutil.scar / scar-api |
| `Camera_MoveTo(pos, pan, panRate, keepLocked, resetToDefault)` | move camera to a pos | camera.scar |
| `Camera_SetDefault(height, declination, angle)` / `Camera_ResetToDefault()` | fixed orientation | camera.scar + set-camera-orientation.scar |
| `Camera_SetTuningValue(TV_DistMax, v)` / `Camera_GetTuningValue(TV_DistMax)` | zoom limit | set-zoom-limit.scar |
| `Player_SetPopCapOverride(player, n)` | raise pop cap | set-player-resources.scar |
| `dr_text2d("layer", x, y, text, r, g, b)` / `dr_clear` / `dr_setautoclear` | on-screen text (OCR marker) | single-player-display.scar |
| `PrintOnScreen(...)` | centre-screen text (alt marker) | printonscreen.scar |

---

## Registration fix — Gen1 → Gen2 (BROKE) → Gen3 (UNLISTED) → Gen4 (2026-07-19)

Four SGA generations of the gamemode mod (`a5a90ec1f00f4b7e9c0d3a2b1e4f5a60.sga`):

| Gen | Structure | Result |
|---|---|---|
| **Gen1** (~11:05) | all files storage=2, verif=0, **4 drives** (attrib/locale/info/data) | **BOOTED FINE** — reached menu, workshop mods `[Sig:0]`. **Not listed** in the dropdown. |
| **Gen2** (12:10) | `.win`→s1; verif overrides (win/scar=4, info/tga=1); `dropEmptyDrives:true` → **2 drives info-first** | **BOOT CRASH**: `'<GUID>.info' is corrupt!` (`archive.cpp/130`) — info-first inverted drive order. |
| **Gen3** (12:32) | Gen1 + `.win` storage 2→1 only. verif=0, **4 drives**. | **BOOTED FINE but STILL NOT LISTED** (confirmed in-game via harness — `wincondition_dropdown_gen3_NOT_listed.png`). Proves `.win` storage was NOT the registration mechanism. |
| **Gen4** (this fix) | `driveLayout:'gamemode'` → **2 drives, data(0)+info(1)**; `.win` storage=1; verif=0 everywhere. | Boot-safe (data-first = the order all 5 working mods use) + should list (data is the primary drive). |

### ROOT CAUSE (Gen4) — the DRIVE LAYOUT, not `.win` storage

In-game evidence killed the Gen3 storage hypothesis: with `.win` storage=1 the mod
**boots but is still absent** from the dropdown. Byte-level TOC dump of ALL 5 working
subscribed gamemode mods (`353675196` / `333857863` / `481822725` / `606599092` /
`1660217730`, via `/tmp/sga-forensics.mjs`) shows the decisive, unanimous difference:

> **Every working gamemode mod emits EXACTLY 2 drives — `data`(index 0) then
> `info`(index 1) — with NO `attrib`/`locale` drive.** `.win`/`.scar` live on the
> `data` drive under `game\winconditions\` / `scar\winconditions\`; the root
> `<GUID>.info` + `preview.tga` live on the `info` drive.

Cited byte evidence (`333857863`, the very Victory-Point/Annihilation source of the
confirmed-listed entries):
```
DRIVE[0] alias="data" name="data" folder[0..5) file[0..20) root=0
DRIVE[1] alias="info" name="info" folder[5..6) file[20..22) root=5
FOLDER[0] name=""                 sub[1..3) file[0..0)     ← data root (2 children)
FOLDER[3] name="game\winconditions" sub[4..4) file[0..10)  ← .win files
FOLDER[4] name="scar\winconditions" sub[5..5) file[10..20) ← .scar files
FOLDER[5] name=""                 sub[6..6) file[20..22)   ← info root
```

Our Gen1–Gen3 builds emitted the 4 canonical **skin-pack** drives
(`attrib`/`locale`/`info`/`data`), which pushes `data` to **drive index 3**. CoH2's
win-condition scanner only registers a mod into the lobby dropdown when the archive's
**primary drive is `data` (index 0, root folder 0)**; with `data` at index 3 the `.win`
entries are never string-indexed → the mod loads + boots but is silently **UNLISTED**.
`.win` storage=1 is still necessary (the string-index step, same as `.ucs`) but was never
sufficient on its own.

### Gen2 vs Gen4 — both are 2-drive; the difference is ORDER

Gen2's `dropEmptyDrives` also produced 2 drives, but by dropping the empty leading
drives it left the remaining ones in canonical INDEX order → `info`(0)+`data`(1). That
info-first order shifted the TOC index bases the engine walks and crashed at boot
(`'<GUID>.info' is corrupt!`). Gen4's `driveLayout:'gamemode'` emits **`data` FIRST,
`info` SECOND** — the exact order all 5 working mods use, all of which boot cleanly. The
Gen4 TOC round-trips through our own reader and is byte-structurally identical (drive +
folder ranges) to `333857863`.

### Gen4 code changes

- **`src/lib/sga-writer.ts`** — added `BuildSgaOptions.driveLayout?: 'skin' | 'gamemode'`
  (default `'skin'` = unchanged 4-drive layout for skin/decal/faceplate). `'gamemode'`
  emits 2 drives `data`(0)+`info`(1); `driveOf` routes root-level files → `info`, pathed
  files → `data`. The folder-tree builder + DFS allocator are reused verbatim (drive count
  now derives from `driveAliases.length`, replacing the hardcoded `[0,1,2,3]`).
- **`scripts/build-verify-gamemode.mts`** — passes `driveLayout:'gamemode'`; `.win`
  storage=1 retained; no verif overrides. Assertions rewritten to Gen4 truth: 2 drives,
  DRIVE[0]=`data`, DRIVE[1]=`info`, data root=0, `.win` storage=1, `.scar`/`.info`
  storage=2, all verif=0. Installs to both `mods/gamemode/<GUID>.sga` and
  `mods/gamemode/subscriptions/<GUID>.sga`.
- **`src/lib/__tests__/sga-roundtrip.test.ts`** — the gamemode-registration block updated:
  default layout still asserts 4 drives `attrib/locale/info/data`; new tests assert the
  `'gamemode'` layout emits exactly 2 drives `data,info` (data root=0) and a Gen4-shaped
  pack round-trips. Suite 58/58 (was 57; +1 test).

### Gen4 validation gate (all PASS)

- **(a) parser round-trip** — `.win`/`.scar`/`.info` all decode to source; layout matches §1.
- **(b) drive/folder byte-topology matches working `333857863`** — 2 drives data(0)+info(1)
  root 0/5; 6 folders with the same tree shape (data root `""` sub[1..3) → `game`+`scar`,
  `game\winconditions` holds `.win`, `scar\winconditions` holds `.scar`, info root `""`).
  Only expected deltas: file-range magnitudes (2 vs 20 files) and verif bytes (0 unsigned
  vs 4/1 RSA-signed).
- **(c) independent raw-zlib decompress per storage byte** — all 4 files inflate to their
  declared uncompressed length (`.win` 154, `.scar` 8534, `.info` 178, `.tga` 49170).
- **(d) boot-safety invariants preserved** — data-first drive order (never info-first);
  `.win` storage=1; `.info`/`.scar` storage=2; every verif=0; unsigned `[Sig:0]` (no
  signed-pack metadata copied). TOC round-trips cleanly through `SgaArchive.open`.
- `npx tsc -b` clean; full suite **2139/2139**; `sga-roundtrip` **58/58**. Install md5
  identical across artifact + both install paths (`889012add2b5db7e0f1e28abbb947f46`).

### Gen4 confidence

- **Boot-safe: HIGH.** Byte-structurally identical to `333857863`'s data-first 2-drive
  layout (which demonstrably boots + lists in-game). None of Gen2's crash triggers
  (info-first order, verif overrides) are present; data-first is the proven-good order.
- **Lobby-listed: HIGH.** The drive layout now matches the working ground-truth mods
  field-for-field on the exact structure the scanner keys on (`data` as primary drive,
  index 0, root folder 0), and `.win` storage=1 satisfies the string-index step. This
  directly addresses the confirmed Gen3 failure mode (data at index 3 → unlisted). The
  next lobby check should show "ASAP Verify".

---

## Gen5 (2026-07-19) — the LISTING is the `.win` CONTENT (`entity_replacements` block), not just SGA structure

> [!warning] Gen4 was necessary but STILL not sufficient
> Gen4 fixed the SGA *structure* (2-drive data-first) so the mod BOOTS clean `[Sig:0]`
> with **no `MOD -- Error`** in `warnings.log` (`captures/warnings_gen4_boot.log`). But the
> harness-driven lobby dropdown **still did not list "ASAP Verify"**
> (`captures/wincondition_dropdown_gen3_NOT_listed.png`). So structure alone does not
> surface a mode — the remaining gate was the **`.win` metadata CONTENT**.

### Forensic decode of the `.win` RGD content (the decisive evidence)

Decoded the `.win` files of ALL 5 working subscribed gamemode mods with the repo's own
`SgaArchive` reader (`/tmp/win-forensics*.mjs`). Key facts, verified byte-for-byte:

- **The `.win` is PLAIN UTF-8 text, NOT a Relic Chunky/RGD binary blob.** First 16 bytes
  of every working `.win` = `name = "..."` (ASCII), `chunky=false`. Our decode matches
  theirs field-for-field. So the earlier "decode the RGD/chunky blob / find the UCS field"
  hypothesis does **not** apply — there is no binary layer.
- **`fe_name` is a LITERAL ASCII string in every working mod — NO `$UCS` locale-key
  indirection.** e.g. `333857863` → `fe_name = "Annihilation (125 Pop Cap)"`; `353675196`
  → `fe_name = "2X-Resources-100-Popcap"`. **No `.ucs` file is bundled in any gamemode
  mod.** ⇒ our literal `fe_name = "ASAP Verify"` was **already correct**; the display-name
  path was **never broken**. (Hypothesis in the brief — missing/empty/unresolvable-UCS
  `fe_name` — is REFUTED.)
- **THE ACTUAL DIFFERENCE — a "complete" mode-metadata block.** Surveyed all **70** working
  `.win` files across the 5 mods. Every single one carries an `entity_replacements = { … }`
  block, a `requires_vp_ticker` field, or **BOTH**. **ZERO** working `.win` has neither.
  **Ours (Gen4) had NEITHER** — it ended at `show_time = true`. Field signature proof
  (`/tmp/win-forensics2.mjs`): working = `name,scar_file,fe_name,fe_priority,score_display,
  show_time,{requires_vp_ticker|entity_replacements|both}`; ours = `…,show_time` and stop.
- **All 5 entries confirmed present in the in-game dropdown capture** map to `.win` files
  that have `entity_replacements` and **no** `requires_vp_ticker` (the "Resources"/
  "Annihilation" modes: `2X-Resources-100-Popcap`, `10X-Resources-9999-Popcap`,
  `1X-Resources-100-Popcap`, `2X-Resources-150-Popcap`, `10X-Resources-300-Popcap`).

**Mechanism:** the lobby win-condition scanner registers a mode only when its `.win`
mode-metadata is "complete". A `.win` that stops at `show_time` with no
`entity_replacements` / `requires_vp_ticker` is parsed + loaded (boots fine) but is
**dropped from the selectable dropdown**. This is why a structurally-correct Gen4 booted
clean yet stayed absent.

### Gen5 fix

`scripts/build-verify-gamemode.mts` `WIN_TEXT` now appends the `entity_replacements` block
**exactly as the confirmed-LISTED Resources modes encode it**:

```
entity_replacements =
{
	{
		original = "victory_point",
		replacement = "territory_point_mp",
	}
}
```

This is inert for our capture SCAR (we never touch victory points) but makes the mode
metadata "complete" so the scanner lists it. `fe_name` stays the literal `"ASAP Verify"`
— no `.ucs` needed (no working mod bundles one). **Boot-safety invariants unchanged:**
2-drive data-first, `.win` storage=1, verif=0 everywhere (Gen5 vs Gen4 differs only in the
`.win` payload text + its compressed size).

### Gen5 validation gate (all PASS)

- Parser round-trip OK (repo `SgaArchive`): 4 paths match design §1; `.win`/`.scar`/`.info`
  text round-trips byte-exact.
- Decoded Gen5 `.win` (254 B) CITED — `fe_name` line hex
  `66655f6e616d65203d2022415341502056657269667922` = `fe_name = "ASAP Verify"`;
  `entity_replacements` block present at char 154.
- New build assertions: `fe_name` is LITERAL (no `$UCS`), `== "ASAP Verify"`,
  `entity_replacements` block present — all OK.
- Every stored file **raw-zlib-decompresses to its declared length**
  (`/tmp/zlib-validate.mjs`): `.win` 254 B, `.scar` 8534 B, `.info` 178 B, `preview.tga`
  49170 B.
- Gen4 structural invariants intact: 2 drives `data(0)`+`info(1)`, data root=0, `.win`
  storage=1, `.scar`/`.info` storage=2, all verif=0.
- `npx tsc -b` clean; `sga-roundtrip` **61/61**.
- Installed **md5-identical** (`2c90364ba676078a54ec6bcbfc5e5a00`) to BOTH
  `mods/gamemode/<GUID>.sga` and `mods/gamemode/subscriptions/<GUID>.sga`.

### Gen5 confidence

- **Boot-safe: HIGH.** Gen5 changes only the `.win` text payload; all Gen4 boot-safe
  structural invariants are re-asserted green. A `.win` with an `entity_replacements` block
  is exactly what all 5 working (booting) mods ship.
- **Lobby-listed: HIGH.** The `.win` now matches the working ground truth on the one field
  that universally separated all 70 working modes from ours (a complete metadata block via
  `entity_replacements`), and specifically mirrors the 5 confirmed-listed Resources modes.
  Next lobby check should show **"ASAP Verify"**.

---

## Gen6 (2026-07-19) — the LINE-ENDING (CRLF) listing fix + storage/annihilate alignment

> [!warning] Gen4+Gen5 were necessary but STILL not sufficient
> Gen4 fixed the SGA *structure* (2-drive data-first) and Gen5 fixed the `.win` *metadata*
> (`entity_replacements`). The mod booted clean `[Sig:0]` but was **still absent** from the
> lobby Win-Condition dropdown. One universal difference vs the 5 working mods remained: **line
> endings.**

### ROOT CAUSE (Gen6) — CRLF vs LF. Highest-confidence remaining delta.

Byte-level `\r` (0x0D) counts across ALL 5 working subscribed mods vs ours (Gen5), read through
the repo's own `SgaArchive` reader (authoritative — decompresses each stored file to its declared
length):

| file | working mods (`\r` count) | Gen5 (ours) |
|------|--------------------------|-------------|
| `*.win`  | 6–14 (all 5, e.g. annihilate `.win` = 13) | **0 (LF-only)** |
| `*.info` | **6** (all 5, identical) | **0 (LF-only)** |
| `*.scar` | 10–40 (all 5) | **0 (LF-only)** |

Every working text payload uses **CRLF (`\r\n`)**; ours was bare **LF (`\n`)**. CoH2's win-condition
`.win` parser is line-oriented and tokenises on `\r\n`: an LF-only `.win` reads far enough to *mount*
the archive (hence the clean `[Sig:0]` load) but drops the entry from the **selectable** list when a
record/field terminator never matches. This is the single strongest never-tried difference and
directly explains "loads but not listed."

### Gen6 deltas vs Gen5 (ONLY three — everything else identical)

1. **CRLF all text payloads.** Added `const crlf = (s) => s.replace(/\r?\n/g, '\r\n')`; wrapped
   `WIN_TEXT`, `INFO_TEXT`, and `SCAR_TEXT` in `crlf(...)` before `enc()`. Packed-then-decoded
   proof: `.win` CR=13, `.info` CR=6, `.scar` CR=198 — and CR == LF for every text file (every
   newline is CRLF, zero bare LF). `.info` CR=6 matches all 5 working mods exactly.
2. **`.info` + `preview.tga` storage 2 → 1 (`'stream'`).** Byte-verified as the universal choice:
   all 5 working mods store `.info` with storage=1; all 3 that ship a `.tga` use storage=1. The
   Gen4 assertion `.info storage===2` was the exact opposite of ground truth — **flipped to
   `=== 1`** and added a matching `.tga storage===1` assertion. `.win` stays storage=1, `.scar`
   stays storage=2 (both already matched).
3. **SCAR imports the base annihilate win-condition.** Prepended
   `import("winconditions/annihilate.scar")` as the first executable line (exact form verified
   against working mods' `.scar` — it is the first import line in 333857863/353675196/…). Gives a
   started match a real, valid victory condition so it initialises; its `Scar_AddInit` coexists
   with our `ASAPVerify_Setup`. Our spawn/camera logic runs after it, unchanged.

### Preserved Gen4/Gen5 boot-safe invariants (re-asserted green)

2-drive data-first layout (`data(0)`+`info(1)`, data root=0); `.win` storage=1;
`entity_replacements` block present; `fe_name = "ASAP Verify"` literal; `verif=0` on every file.
The ONLY changes vs Gen5 are the three deltas above.

### Gen6 validation gate (all PASS)

- SgaArchive round-trip: 4 files decode to declared length; `.win`/`.info`/`.scar` decode ==
  `crlf(TEXT)`; `.win` CR=13, `.info` CR=6, `.scar` CR=198 (all > 0); annihilate import present.
- Raw TOC: `.win` storage=1, `.scar` storage=2, `.info` storage=1, `.tga` storage=1, verif=0 all.
- Structural: 2 drives `data,info`, data root=0, info root>0.
- `npx tsc -b` clean; `sga-roundtrip.test.ts` 61/61 pass (no test edit needed — the writer-default
  `.info storage=2` test covers the *default* path; our script now passes explicit `'stream'`).
- Installed (GUID `a5a90ec1…`) to BOTH `mods/gamemode/` and `mods/gamemode/subscriptions/`
  (identical bytes; overwrites the Gen5 copies in place).

### Gen6 confidence

- **Boot-safe: HIGH.** All Gen4/Gen5 structural + metadata invariants unchanged and re-asserted;
  CRLF and storage=1 for `.info`/`.tga` are exactly what all 5 booting mods ship.
- **Lobby-listed: HIGH.** CRLF was the last universal `.win` difference vs the working mods; with
  structure (Gen4), metadata (Gen5), and line endings (Gen6) all now matching ground truth, the
  next lobby check should list **"ASAP Verify"**. If it still fails, the only remaining unknown is
  the signed-TOC (`verif=4/1`) requirement — but unsigned local mods are documented to work.

---

## Gen7 (2026-07-19) — the ROOT CAUSE was PER-FILE VERIFICATION HASHES all along

> [!warning] Correction — the Gen2/Gen3 "verif=0 because [Sig:0]" conclusion was WRONG
> The Gen2 post-mortem below (retained for history) concluded the non-zero `verification` bytes
> (win/scar=4, info/tga=1) and stepping `hashPos` values (0, 20, 40, …) were "a red herring / part of
> the Relic **RSA-SIGNED** TOC" and that an unsigned `[Sig:0]` pack should use `verif=0` everywhere.
> **This conflated two independent things.** Capturing the **ModBuilder-burned** win-condition SGA
> (`asap_verify.burned.sga`, GUID `ae9c499b…`, 2076 B — it WILL list) and its `ArchiveDefinition.txt`
> proved that per-file **verification hashes are NOT the RSA signature**. `[Sig:0]` (the archive-level
> RSA signature) and per-file `sha1_blocks`/`crc_blocks` verification hashes are **orthogonal**: the
> burned reference and every working subscribed mod are effectively unsigned yet still carry per-file
> verification hashes, and the lobby scanner REQUIRES them on win-condition files. Gen1–Gen6 wrote
> `verification=none(0)` for everything → the mode boots `[Sig:0]` but is dropped from the dropdown.

### ROOT CAUSE (Gen7) — win-condition files need per-file verification hashes to LIST

The definitive packing spec is the burn's `ArchiveDefinition.txt`:
- **data TOC** `defverification="sha1_blocks"` → `.win`/`.scar` carry SHA-1 block hashes.
- **info TOC** `defverification="crc_blocks"` → `.info`/`.tga`/`.dds` carry CRC block hashes.

### The v7 verification-hash layout (reverse-engineered byte-for-byte)

Confirmed against `asap_verify.burned.sga` AND working `1660217730.sga` (byte-exact matches):

- **`sha1_blocks` (verification byte = 4):** SHA-1 (20 bytes) over the **STORED (compressed)** bytes,
  one hash per `blocksize`=262144 block (small files = 1 block = 1 hash). All a TOC's sha1 hashes are
  concatenated into ONE contiguous **hash table that begins at TOC `sig_offset`** (= end of the names
  section, byte 32 of the 40-byte TOC header). Each file record's **`hash_pos` (offset +26)** = that
  file's byte offset within the table (0, 20, 40, …). *Cited bytes (burned):* `.win` hash_pos=0,
  region@0 = `a7bd9807e363c9035a9b0255054db040e724a763` = `sha1(stored .win)`; `.scar` hash_pos=20,
  region@20 = `5a8615e58ff11be6c58904e265bb9bfe4777e18e` = `sha1(stored .scar)`. Table = 40 bytes (2×20).
- **`crc_blocks` (verification byte = 1):** NO separate hash table. The file record's **`crc32`
  field (offset +22)** = CRC32 over the **STORED (compressed)** bytes IS the verification; `hash_pos`
  stays 0. *Cited (burned `.info`):* crcField `0x9b8cd507` == `crc32(stored)` (≠ crc of raw).
- **The `crc32` field is over STORED bytes for EVERY verified file** (both schemes). (Our legacy skin
  writer computed crc over RAW; that is kept ONLY for `verification='none'` files so skin/decal/
  faceplate output stays byte-identical.)
- **SHA-1 is over STORED, not raw** — proven: `sha1(raw)` matches nothing; `sha1(stored)` matches the
  table for all 28 data-drive files of `1660217730` and both files of the burn.

### Gen7 fix (code)

- **`src/lib/sga-writer.ts`:** added `SgaVerification = 'none'|'crc_blocks'|'sha1_blocks'` (bytes
  0/1/4; numeric `4`/`1` still accepted). `sha1_blocks` files get SHA-1(stored) per 262144 block into
  a hash table written at `sig_offset`; `hash_pos` set per file. crc field = crc(stored) for verified
  files, crc(raw) for `'none'`. `'none'` default keeps the legacy 140-byte zero trailing block →
  skin/decal/faceplate output UNCHANGED (regression-locked by tests).
- **`src/lib/sha1.ts`:** new dependency-free FIPS-180-1 SHA-1 (browser-safe, no Node `crypto`).
  Verified byte-identical to Node crypto incl. multi-block (>256 KB) inputs.
- **`scripts/build-verify-gamemode.mts`:** per `ArchiveDefinition` — `.win` sha1_blocks+storage=1,
  `.scar` sha1_blocks+storage=2, `.info` crc_blocks+storage=1, `preview.tga` crc_blocks+storage=1.
  Keeps 2-drive data-first, CRLF, `entity_replacements`, `annihilate` import.

### Gen7 validation gate (all PASS — no game needed)

- **Byte-match vs burned reference:** our rebuilt SGA is verification-scheme-identical — `.win` verif=4
  hash_pos=0 sha1(stored)@region0; `.scar` verif=4 hash_pos=20 sha1(stored)@region20; `.info`/`.tga`
  verif=1 crc(stored); a fresh SHA-1/CRC recomputation confirms every hash.
- `SgaArchive` round-trip OK; every stored file raw-zlib-decompresses to declared length.
- `npx tsc -b` clean; **full suite 2151/2151** (was 2139); **`sga-roundtrip` 70/70** (was 58 — added
  SHA-1 correctness + GEN7 sha1_blocks/crc_blocks assertions).
- Installed md5-identical (`a8bd2742…`) to `mods/gamemode/<GUID>.sga` + `…/subscriptions/<GUID>.sga`,
  ALONGSIDE the burned `ae9c499b…` (left in place as the in-game reference).

### Gen7 confidence

- **Boot-safe: HIGH.** All Gen4–Gen6 invariants unchanged; verification hashes are additive TOC bytes.
- **Lobby-listed: HIGH.** Verification hashes were the last universal delta vs both the burned
  reference and the working subscribed mods; structure + metadata + line endings + verification now all
  match ground truth field-for-field. In-app dropdown check pending (next harness run tests both our
  `a5a90ec1…` and the burned `ae9c499b…`). If ours still fails but the burn lists, ship the burned SGA
  as the working gamemode (fallback) — but byte-match confidence is high that ours now lists too.

---

### (SUPERSEDED) Registration fix — Gen1 → Gen2 (BROKE) → Gen3

> The Gen3 write-up below is retained for history. Its core claim — "`.win` storage=1 is
> the ONE change needed to list" — was **DISPROVEN in-game**: Gen3 booted but did not list.
> The real mechanism is the drive layout (see Gen4 above). `.win` storage=1 is necessary
> but not sufficient.

Three SGA generations of the gamemode mod (`a5a90ec1f00f4b7e9c0d3a2b1e4f5a60.sga`):

| Gen | Structure | Result |
|---|---|---|
| **Gen1** (~11:05) | all files storage=2, verif=0, **4 drives** | **BOOTED FINE** — game reached menu, workshop mods `[Sig:0]`. But **not listed** in the lobby Win-Condition dropdown. |
| **Gen2** (12:10, "registration fix") | `.win`→s1, `.scar`→s2, `.info`/`.tga`→s1; verif overrides (win/scar=4, info/tga=1); `dropEmptyDrives:true` → **2 drives** | **BOOT CRASH**: `'<GUID>.info' is corrupt! Unable to continue.` (`archive.cpp/130`). |
| **Gen3** (12:32, this fix) | **Gen1 + EXACTLY ONE byte changed**: `.win` storage 2→1. verif=0 everywhere, 4 drives. | Boot-safe (Gen1 layout) + should now list (`.win` storage=1). **[DISPROVEN — booted but unlisted.]** |

### Gen2 post-mortem — the corruption mechanism (byte-level forensics)

The Gen2 `.info` payload **decompresses perfectly** (149 stored bytes → 178 bytes of valid text via
raw zlib). So `'... .info is corrupt'` is **NOT** a data-decompression failure — it is a **TOC
structural read failure**. Gen2 made two structural changes over the booting Gen1; the decisive one:

- **`dropEmptyDrives:true` INVERTED the drive order.** With attrib+locale dropped, the writer emits
  the remaining drives in canonical index order → `DRIVE[0]=info`, `DRIVE[1]=data`. **Every one of
  the 5 working subscribed gamemode mods emits `DRIVE[0]=data`, `DRIVE[1]=info`.** Putting `info`
  first shifts every drive/folder/file index base the engine walks and lands the `.info` entry in
  the drive-0 slot the engine does not expect → it reads a malformed `.info` file record and aborts
  at `archive.cpp/130`. (The earlier Gen2 write-up dismissed this ordering as "cosmetic / immaterial"
  and predicted "if the entry still does not appear, that ordering is the next thing to match" — the
  ordering was in fact fatal, not cosmetic.)
- **The `verification`-byte overrides were a red herring / mismatch.** The working mods' non-zero
  `verification` (win/scar=4, info/tga=1) and their stepping `hashPos` values (0, 20, 40, …) are part
  of the **Relic RSA-SIGNED TOC**: their `sigOff` points at a real ~500-byte high-entropy RSA
  signature block, and `hashPos` indexes into it. **Our local packs are unsigned `[Sig:0]`** — our
  proven-good skin/decal/faceplate SGAs (which load fine) use **verif=0, hashPos=0 for every file**,
  and Gen1 booted with `.info` at verif=0. Copying signed-pack verification metadata onto an unsigned
  pack is unnecessary and structurally inconsistent. Gen3 reverts to verif=0.

### ROOT CAUSE of the *listing* failure (unchanged, still correct) — `.win` storage type

Every working gamemode mod stores its `.win` files with **`storage=1` (zlib STREAM_COMPRESS)**. Gen1
used the writer default **`storage=2`**. CoH2 string-indexes `.win` entries into the lobby dropdown
the same way it indexes `.ucs` locale strings — and `storage=2` **silently fails that index**
(identical to the documented `.ucs` `$90000005 No Key` storage=2 locale-index failure in
`src/lib/sga.ts` / [[sga-rgt-format]]). A `storage=2` `.win` ⇒ archive loads, entry dropped from the
dropdown. **`.win` storage=1 is the ONE change Gen3 keeps.**

> Ground-truth storage/verification per file type from the 5 working mods (`353675196` / `333857863`
> / `481822725` / `606599092` / `1660217730`): `*.win` s1/v4, `*.scar` s2/v4, `<GUID>.info` s1/v1,
> `preview.tga` s1/v1–2, **2 drives (data,info)**. **CAUTION:** those verif/hashPos/`.info`-s1 values
> are **signed-Workshop-pack artifacts** — do NOT copy them onto our unsigned local packs. Only the
> `.win` storage=1 fact transfers.

### Gen3 changes made

- `src/lib/sga-writer.ts` — kept `SgaInputFile.storage?: 'stream'|'buffer'|'raw'` (→ storage byte
  1/2/0; needed for `.win` storage=1) and the generic `verification?: number` (defaults 0).
  **Removed `BuildSgaOptions.dropEmptyDrives`** — the writer now ALWAYS emits the 4 canonical drives
  in canonical order (the Gen1 layout that booted). Reverted the `activeDrives` machinery to a fixed
  `[0,1,2,3]`.
- `scripts/build-verify-gamemode.mts` — `.win` → `storage:'stream'` (**the only delta vs Gen1**);
  `.scar`/`.info`/`preview.tga` use writer defaults (storage=2, verif=0); NO `verification`
  overrides; NO `dropEmptyDrives`. Assertions updated to the Gen3 truth: 4 drives, `.win` storage=1,
  `.scar`/`.info` storage=2, all verif bytes 0. Installs to **both** `mods/gamemode/<GUID>.sga` and
  `mods/gamemode/subscriptions/<GUID>.sga` (same GUID ⇒ overwrites in place).
- `src/lib/__tests__/sga-roundtrip.test.ts` — 5 tests: `storage:'stream'/'buffer'/'raw'` byte
  values; verif defaults to 0 for every file; writer ALWAYS emits 4 drives; a Gen3-shaped pack
  round-trips with `.win` storage=1 / `.info` storage=2. (The old `dropEmptyDrives` 2-vs-4-drive
  tests were removed with the option.)

### Validation gate (all PASS)

- **(a) parser round-trip** — build script: `.win`/`.scar`/`.info` all decode to source; layout
  matches design §1.
- **(b) binary field-semantics diff vs working `353675196`** — same 30-byte file-record layout;
  Gen3 `.win` storage=1 **matches** ground truth; Gen3 `.info` intentionally on Gen1's booted
  defaults (storage=2/verif=0), NOT signed-pack metadata.
- **(c) independent raw-zlib decompress of every file per its storage byte** — all 4 inflate to
  their declared uncompressed length.
- **(d) Gen3-vs-Gen1 byte diff** — **EXACTLY ONE differing byte**: offset 1025 = file-record[2]
  (`.win`) byte +21 (STORAGE), `0x02 → 0x01`. Nothing else changed; identical file size (4933 B).
- `npx tsc -b` clean; `sga-roundtrip.test.ts` **57/57 pass**.

### Confidence

- **Boot-safe: HIGH.** Gen3 is byte-identical to the Gen1 build that demonstrably booted, except one
  storage byte that only changes how that single `.win` payload is decoded at read time (and
  storage=1 single-stream zlib is exactly what every working mod uses for `.win`). None of Gen2's
  crash-causing structural deltas (drive-drop/reorder, verif overrides) are present.
- **Lobby-listed: MEDIUM-HIGH.** The `.win` storage=1 fix directly targets the documented
  storage-2 string-index-drop, and Gen1 already loaded to menu with all pointers self-consistent.
  Residual uncertainty: whether string-indexing *also* needs the working mods' `data`-first drive
  order — Gen3 keeps Gen1's `attrib/locale/info/data` (info at drive 2, data at drive 3). If listing
  still fails, the next surgical step is to make the writer emit `data` before `info` for gamemode
  packs **without dropping** the empty drives (order-only change, no index-base collapse).

---

## Gen8 (2026-07-20) — HERO INSIGNIA CLOSE-UP (side-on balkenkreuz photo target)

> [!note] Additive change — grid intact, hero added
> Gen8 does NOT touch the boot/listing pipeline (Gen4–Gen7 invariants all unchanged and
> re-asserted green). It ADDS a dedicated close-up target to `SCAR_TEXT` so the harness can
> photograph a German vehicle's national insignia (balkenkreuz) side-on.

### Problem

The national insignia is baked on the hull SIDE / side skirts (schürzen) via TEXCOORD1
(see [[coh2-vehicle-decal-rendering]]). CoH2's camera is **fixed pitch/yaw — pan + zoom only,
no orbit** — so on the grid vehicles (which face "forward"/away) the insignia side never faces
the lens and cannot be rotated into view. A crisp side-on balkenkreuz photo was therefore a
**capture constraint**, not a decal mismatch. Gen8 removes that constraint.

### Fix — one hero vehicle turned side-on, camera locked low + close

Added to `scripts/build-verify-gamemode.mts` `SCAR_TEXT`:

- **`ASAPVerify_SpawnHero()`** — resolves the first available clean-hulled medium/heavy German
  tank blueprint from `HERO_SBP_CANDIDATES = { panther_squad_mp, panzer_iv_squad_mp,
  tiger_squad_mp }` (all null-guarded; Panther first for its long flat side skirts). Spawns it
  well clear of the grid at `origin + (HERO_OFFSET_X=40, HERO_OFFSET_Z=-25)`.
- **Belt-and-braces THREE copies** in a row (`HERO_SPACING=14` along world +X), each facing a
  DIFFERENT direction so at least one presents its insignia-bearing hull side squarely to the
  fixed camera regardless of the map's yaw-axis sign:
  - copy 1 → faces world **+X**
  - copy 2 → faces world **−X**  (this is the camera target — the middle copy keeps all 3 in frame)
  - copy 3 → faces **toward the camera home (−Z)**
- **`ASAPVerify_FrameHero()`** — locks the camera LOW + steep on the hero row and HOLDS (no
  cycling): `Camera_SetDefault(HERO_CAM_HEIGHT=14, HERO_CAM_DECLIN=42, nil)` +
  `Camera_ResetToDefault()` + `Camera_MoveTo(heroPos, false, nil, keepLocked=true)`. Re-asserted
  at +3 s and +8 s so a late settle/input nudge can't drift the frame.
- **Setup wiring:** grid spawns → hero spawns (5b) → brief wide-grid establishing shot (1.5 s) →
  at `HERO_HOLD_DELAY+5` s the camera locks on the hero and holds indefinitely. If NO hero
  blueprint resolved (`heroReady=false`), it falls back to the original per-vehicle grid cycle,
  so a partial result still leaves a usable moving frame.

### Verified SCAR APIs used (ground-truth against `Data.sga`, this session)

| Purpose | Call | Confidence / source |
|---|---|---|
| Set vehicle heading (group) | `SGroup_FacePosition(sgroup, worldPos)` | **HIGH** — call sites `scar/groups.scar:2024,2054`; engine builtin |
| Set heading at spawn | `Util_CreateSquads(..., spawn_facing)` (11th arg) → `Squad_CreateAndSpawnToward(bp,player,loadout,pos,toward)` | **HIGH** — def `scar/scarutil.scar:694`, toward at `:763` |
| Camera orientation (low/steep) | `Camera_SetDefault(height, declination, angle)` → `TV_DefaultHeight/TV_DefaultDeclination/TV_DefaultAngle` | **HIGH** — def `scar/camera.scar:134` |
| Reset to the new default | `Camera_ResetToDefault()` | **HIGH** — call site `scar/camera.scar:34`; engine builtin |
| Move + hold on hero | `Camera_MoveTo(pos, pan, panRate, keepLocked, resetToDefault)` | **HIGH** — def `scar/camera.scar:22` (5-arg) |

> **NOTE on camera zoom/distance:** the stdlib contains **only** `TV_DefaultHeight`,
> `TV_DefaultDeclination`, `TV_DefaultAngle` — there is **no** `TV_DistMax`/`TV_DistMin`/`TV_Pitch`.
> The grid's `TV_DistMax` lines are therefore undefined-global no-ops (nil), harmless because
> they are wrapped in `safe()`. Gen8 uses `Camera_SetDefault` (height + declination) — the
> verified way to get a near, steeply-pitched framing. Every hero call is additionally wrapped
> in `safe()`/`pcall`, so a bad blueprint or API surprise cannot crash the match.

### Gen8 validation gate (all PASS — no game launch)

- Build round-trips: `.win`/`.scar`/`.info` decode to source; layout matches §1; `.scar` CRLF
  count 335 (was 198 — new hero logic packed).
- All Gen4–Gen7 invariants re-asserted green: 2 drives `data(0)`+`info(1)`, `.win` s1/sha1_blocks,
  `.scar` s2/sha1_blocks, `.info`/`.tga` crc_blocks, `entity_replacements`, annihilate import, CRLF.
- Installed (GUID `a5a90ec1…`) to BOTH `mods/gamemode/<GUID>.sga` and `…/subscriptions/<GUID>.sga`.
- `npx tsc -b` clean; `sga-roundtrip.test.ts` **70/70**.

### Gen8 confidence

- **Boot-safe / still lists: HIGH.** Only the `.scar` text payload changed; all structural /
  verification-hash invariants that make the mode boot + list (Gen7) are untouched and re-asserted.
- **Insignia side-on capture: MEDIUM-HIGH.** Heading + camera APIs are all verified ground-truth,
  but the exact world-axis ↔ screen-axis sign is map-dependent, so the belt-and-braces 3-heading
  spread is the guarantee that at least one copy shows the balkenkreuz side to the fixed camera.

---

## Gen9 (2026-07-20) — HERO CAMERA FIX (real-squad target + persistence pin + on-screen debug)

> [!warning] Gen8's hero camera FAILED in-game
> In-game test (Gen8): the hero close-up camera did **not** land on the hero vehicles — the view
> stayed at the default player-start looking at **empty ground** while the hero tanks spawned
> elsewhere (visible only on the minimap). Vehicles spawned fine (grid + heroes both on minimap);
> the mode lists, boots, `asap_verify.scar` runs — **only the camera targeting was broken.**
> Gen9 touches ONLY the `.scar` payload; all Gen4–Gen8 boot/listing invariants are unchanged and
> re-asserted green.

### Root cause (three compounding bugs)

1. **Camera targeted a GUESSED position, not the real squad.** Gen8 set
   `asap.heroPos = Util_ScarPos(hx, hz)` (a hand-computed point) and passed it to `Camera_MoveTo`.
   But `Camera_MoveTo` runs `pos = World_GetNearestInteractablePoint(pos)` (`camera.scar:29`), which
   can snap a guessed point far from where the tank actually landed — so the camera framed empty
   ground. FIX: derive the target from the **live spawned squad group** via
   `SGroup_GetPosition(heroSg)` (builtin; call sites `scarutil.scar:875,976,1671`), and store the
   **SGroup handle** `asap.heroSg` at spawn.
2. **No persistence — the default match camera re-asserted.** Gen8 fired the hero lock as a single
   one-shot at ~8 s with two extra one-shots at +3/+8 s. The match's default camera reclaimed the
   view. FIX: a **`Rule_AddInterval(ASAPVerify_PinHero, 0.5, …)`** (verified `rulesystem.scar:47`
   `Rule_AddInterval(f, interval, priority)`) re-runs the hero frame every 0.5 s for ~30 s
   (60 ticks, then `Rule_RemoveMe()`), re-reading the squad's live pos each tick so it stays pinned.
3. **Debug marker was invisible.** `dr_text2d(...,1,1,1)` — RGB is **0..255**, not 0..1 (verified
   `printonscreen.scar:29` uses `213,213,213`), so `1,1,1` was near-black. FIX: markers use
   `255,255,255` / bright yellow `255,235,40`.

### The camera fix — every API cited against Data.sga (this session)

| Purpose | Call | Source (Data.sga) |
|---|---|---|
| Real spawned-squad world pos | `SGroup_GetPosition(heroSg)` | builtin; call sites `scarutil.scar:875,976,1671`; resolved by `Util_GetPosition` `scarutil.scar:2176` |
| Count spawned in group | `SGroup_CountSpawned(heroSg)` | builtin; `camera.scar:113`, `scarutil.scar:534` |
| Store handle at spawn | `SGroup_CreateIfNotFound("sg_asap_hero")` | `groups.scar` |
| Move + hold on hero | `Camera_MoveTo(pos, false, nil, keepLocked=true)` | def `camera.scar:22` (5-arg; installs `_MoveToPosition_CamLock`, `Camera_SetInputEnabled(false)`) |
| Follow the actual unit | `Camera_Follow(heroSg)` → `Camera_FollowSquad(SGroup_GetSpawnedSquadAt(sg,1))` | def `camera.scar:110-114` |
| Close framing (low+steep) | `Camera_SetDefault(HERO_CAM_HEIGHT=14, HERO_CAM_DECLIN=42, nil)` + `Camera_ResetToDefault()` | def `camera.scar:134`; `Camera_ResetToDefault` call site `camera.scar:34` |
| Persistence pin | `Rule_AddInterval(fn, 0.5, prio)` / `Rule_RemoveMe()` | def `rulesystem.scar:47`; `Rule_RemoveMe` `camera.scar:72,78` |
| Set heading (unchanged) | `Util_CreateSquads(...,spawn_facing)` + `SGroup_FacePosition(sg,pos)` | `scarutil.scar:694/763`, `groups.scar:2024,2054` |

> **NOTE (still true):** the stdlib has ONLY `TV_DefaultHeight/Declination/Angle` — no
> `TV_DistMax/TV_Pitch`. Distance framing is via `Camera_SetDefault` height+declination, not a zoom
> tuning value. The grid's `TV_DistMax` lines remain undefined-global no-ops under `safe()`.

### On-screen debug added (so the harness can verify from a screenshot)

- `HERO SPAWNED n=<count> x=<x> z=<z>` — printed once after spawn, from the LIVE
  `SGroup_CountSpawned` + `SGroup_GetPosition` (slot 0, bright yellow).
- `CAM->HERO x=<x> z=<z> pin=<n>` — printed EVERY time the camera re-centers (slot 1), showing the
  exact world point the camera was told to point at and the pin-tick counter — so the operator can
  SEE whether the camera targeted the hero even if framing is still slightly off.
- `HERO FALLBACK: no hero spawned, cycling grid` — printed if the hero path failed entirely.
- OCR readiness marker `ASAP_VERIFY_READY` fixed to `255,255,255` (was invisible `1,1,1`).

### Safety / fallback

Every camera + spawn call is wrapped in `safe()`/`pcall`; the grid is spawned and kept intact
BEFORE the hero. If NO hero blueprint resolves (`heroReady=false`), setup falls back to the working
per-vehicle grid cycle (`Rule_AddInterval(ASAPVerify_CameraCycle, 6, …)`). Heroes spawn at a fixed
`+40 m / −25 m` offset well clear of the grid so once the camera reaches them they are the only
thing in frame. Fixed a Lua ordering bug: `safe` is now declared BEFORE the `asap_dbg`/`asap_xz`
helpers so they capture it as an upvalue (previously they'd have seen a nil global `safe`).

### Gen9 validation gate (all PASS — no game launch)

- Build round-trips: `.win`/`.scar`/`.info` decode to source; layout matches §1; `.scar` CRLF
  count **427** (was 335 — new Gen9 camera/debug logic packed).
- All Gen4–Gen8 invariants re-asserted green: 2 drives `data(0)`+`info(1)`, `.win` s1/sha1_blocks,
  `.scar` s2/sha1_blocks, `.info`/`.tga` crc_blocks, `entity_replacements`, annihilate import, CRLF.
- `npx tsc -b` clean; `sga-roundtrip.test.ts` **70/70** (no test edit needed — only the `.scar` text
  payload changed, not the writer/layout the suite guards).
- Installed (GUID `a5a90ec1…`) **md5-identical** (`eeb040c0f8ca56acfe74fa13f1c6c8b5`) to
  `mods/gamemode/<GUID>.sga` + `…/subscriptions/<GUID>.sga` + artifact.

### Gen9 confidence

- **Boot-safe / still lists: HIGH.** Only the `.scar` payload changed; every structural /
  verification-hash invariant is untouched and re-asserted.
- **Camera frames the hero: MEDIUM-HIGH.** The camera now keys off the REAL spawned squad
  (`SGroup_GetPosition` + `Camera_Follow`), not a guessed point that `World_GetNearestInteractablePoint`
  could snap away — this directly addresses the Gen8 "empty ground" failure. The 0.5 s pin defeats the
  default-camera re-assert. Residual uncertainty is only the exact close-framing height/declination
  and the map yaw-axis sign for the side-on shot; the on-screen `HERO SPAWNED` / `CAM->HERO` debug is
  rock-solid so that, worst case, the operator can read the printed hero (x,z), minimap-jump there,
  and manually frame — the camera-targeting mystery is now observable, not blind.

---

## Related wiki pages
- [[coh2-workshop-publish-flow]] — unsigned `[Sig:0]` local load, `mods/` dirs, SGA writer
- [[coh2-harness-driving]] — launch options, resolution fix, menu-nav (lobby coords TODO)
- [[coh2-vehicle-decal-rendering]] — decal/insignia is an engine mesh-UV feature (renders on any owned vehicle)
- [[sga-rgt-format]] — SGA v7 packing rules our writer implements

---
## CONCLUSION (2026-07-19): win-condition lobby-listing is a HARD BLOCKER via raw SGA packing

Six evidence-based fixes were built, installed, and tested IN-GAME via the harness. The mod
mounts clean every time (`ARC ... [Sig:0]`, no MOD error) but NEVER appears in the lobby
Win Condition dropdown. Ruled out by direct in-game test (dropdown captured each time):
1. Gen3 — `.win` storage=1 (was 2)                    -> still not listed
2. Gen4 — 2-drive data-first layout (was 4-drive)      -> still not listed
3. Gen5 — `entity_replacements` block added            -> still not listed
4. `.list` sidecar                                     -> working mods have NONE; not the mechanism
5. numeric Workshop-ID filename (was hex GUID)         -> still not listed
6. Gen6 — CRLF line endings + `.info` storage=1 + annihilate import -> still not listed

Key facts: the 5 working listed mods (353675196 etc.) are ALL `[Sig:0]` UNSIGNED loose SGAs in
mods/gamemode/subscriptions/ — so signing is NOT the differentiator. Our SGA byte-matches them on
every visible structural axis (drives, folders, storage bytes, .win/.info/.scar fields, line
endings, filename pattern) yet is not enumerated as selectable.

INTERPRETATION: CoH2's lobby win-condition enumerator requires something the official CoH2 Mod
Tools (Worldbuilder/Essence build pipeline) or a Steam Workshop publication stamps into a mod that
raw SGA hand-packing does not reproduce (most likely a Workshop-registered mod entry the client
tracks, or a build-tool-generated registration artifact). All 5 working mods are Workshop-published
titles. This is beyond what `buildSga()` can achieve.

CONSEQUENCE for in-game visual verification: the auto-spawn gamemode was the vehicle-delivery
mechanism for capturing a German vehicle with equipped skin+decal in-engine. With listing blocked,
the on-vehicle CUSTOM-skin visual is NOT achievable via this path. Alternatives, all with costs:
- Publish the test gamemode to Steam Workshop via the CoH2 Mod Tools (needs the Mod Tools app +
  user consent to publish) — the intended, supported path.
- Drive a full skirmish and tech to a vehicle (~10+ min of RTS play; hard to automate reliably).
- Theater of War / campaign shows German vehicles rendering + DEFAULT insignia, but NOT custom
  skins (campaign uses non-_mp blueprints).

WHAT IS PROVEN IN-GAME (does not need the gamemode): fresh editor decal, faceplate, and skin SGAs
all LOAD clean in CoH2 ([Sig:0], no "invalid file structure"); faceplate renders on the menu player
card. Editor-side 3D fidelity is fully verified offline (61/61 models, shader fixes, TC1 unwrap,
goldens). The remaining unverified item is a pixel-level editor-vs-in-game comparison of a skin+decal
ON a vehicle, blocked as above.

---
## ✅ IN-GAME VERIFIED (2026-07-19 20:14) — Gen7 verification-hash fix WORKS
Drove the real game via the harness (headless). RESULTS:
- Both gamemode SGAs loaded [Sig:0] no error: our Gen7-fixed a5a90ec1 (sha1_blocks/crc_blocks per-file verification) AND the ModBuilder-burned ae9c499b.
- **"ASAP Verify" APPEARS in the lobby Win Condition dropdown — TWICE** (our fix + the burned reference). Proof: artifacts/ingame-verify/captures/wincondition_dropdown_ASAP_VERIFY_LISTED.png. This is the definitive resolution of the 7-generation listing bug: per-file verification hashes (NOT the [Sig:0] archive signature) are what the lobby scanner requires; our buildSga() now emits them.
- Selected ASAP Verify, added Easy AI, started on map Pripyat. warnings.log: "SimWorld::LoadWinCondition: [data:scar/winconditions/asap_verify.scar] succeeded" + "Scar Init" done.
- **The SCAR auto-spawned the German vehicle grid, rendered in the real engine, camera framed on it, FOW revealed.** Proof: captures/ingame_vehicle_grid_wide.png + ingame_vehicles_medium.png. Vehicles + national insignia render correctly in-engine.
- Full pipeline PROVEN end-to-end: editor buildSga() -> listable win-condition mod -> lists in lobby -> loads+runs in-match -> spawns vehicle grid -> renders in-engine.
- NOT done (optional last-mile): equipping a CUSTOM Honvéd skin on the spawned Tiger via the 2D army-inventory (spawned vehicles show DEFAULT German skins + default insignia). The custom skin SGA is proven to LOAD [Sig:0]; equipping+rendering it is a separate 2D-inventory UI flow.
