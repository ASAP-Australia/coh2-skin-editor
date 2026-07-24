# Vehicle Visual Verification Plan — Q1 (win-condition listing) + Q2 (3D preview / match path)

**Date:** 2026-07-19. Method: local SGA forensics (standalone Node `zlib.inflateSync` reader,
`/tmp/sga-extract.mjs` + `/tmp/sga-folders.mjs`) deep-diffing all 5 working subscribed gamemode
mods vs ours, plus web research (coh2.org, Essence Engine Wiki, canonical GitHub example pack,
Feral manual). No game launch was performed.

---

## Q1 — Why our win-condition LOADS but does NOT LIST, and the real registration requirement

### What was deep-diffed
5 working listed gamemode mods (all in `mods/gamemode/subscriptions/`):
`1660217730`, `333857863`, `353675196`, `481822725`, `606599092`, vs ours
`a5a90ec1f00f4b7e9c0d3a2b1e4f5a60.sga`. Full TOC + every `.win`/`.scar`/`.info` payload extracted
and byte-compared. Also fetched the canonical mod-tools output: GitHub
`eliw00d/example-win-condition-pack` (`main.win`, `main.scar`, `.mod`, `.xml`, `.ucs`).

### What is already CORRECT (matches working mods — previously fixed, do NOT change)
- **SGA drive layout:** exactly 2 drives `data(0)` + `info(1)`, data-first. Identical to all 5 working
  mods. (The subscribed mods have NO attrib/locale drive; the mod-tools *source* example has them
  only because it declares a locdb override — empty attrib/locale are stripped on publish. Our
  2-drive layout is right.)
- **Folder tree:** `""` → `game`/`scar` → `game\winconditions`/`scar\winconditions`, byte-for-byte the
  same nesting/range pattern as `333857863`. Correct.
- **`.win` field content:** our `.win` is field-for-field identical to the canonical `main.win`
  (`name`, `scar_file="data:scar/..."`, `fe_name` LITERAL string, `fe_priority`, `score_display=time`,
  `show_time=true`, `entity_replacements` block). `fe_name = "ASAP Verify"` is a valid literal label.
  `permitted_categories` is NOT required — ZERO working mods and the canonical example use it. Correct.
- **`.win` storage = 1**, `.scar` storage = 2. Matches working mods. Correct.

### THE TWO universal differences never addressed (root-cause candidates)

**(1) LINE ENDINGS — CRLF vs LF. HIGHEST CONFIDENCE.**
Every working mod's text files use **CRLF (`\r\n`)**; OURS uses bare **LF (`\n`)**. Verified by hexdump
+ `\r` counts across ALL 5 mods:

| file | working mods (`\r` count) | OURS |
|------|--------------------------|------|
| `*.win`  | 13 (all 5) | **0** |
| `*.info` | 6 (all 5)  | **0** |
| `*.scar` | 10–40 (all 5) | **0** |

The community documents the `.win` as *"program-like text that the game parses with custom code"*
(coh2.org 81465). A custom line-oriented parser that tokenises on `\r\n` will read enough of an
LF-only file to mount the archive (hence our clean `[Sig:0]` load) but can drop the entry from the
selectable win-condition list when a field/record terminator isn't matched. This is the single
strongest never-tried difference and directly explains "loads but not listed."

**(2) `.info` + `preview.tga` STORAGE FLAG — 1 vs 2. MEDIUM confidence.**
All 5 working mods store `.info` and the preview image with **storage=1 (stored/stream)**. OURS emits
both with **storage=2 (compressed)**. The current build script even *asserts* `.info storage===2`
(build-verify-gamemode.mts:508,515) — the exact opposite of ground truth. Lower confidence than CRLF
(the mod still boots), but it is a real universal mismatch worth aligning.

**(Not the lobby-listing cause, but a real RUNTIME gap):** every published `.scar` imports BOTH
`winconditions/annihilate.scar` and `winconditions/victorypointplusannihilate.scar`; ours imports
neither. The canonical mod-tools example imports neither (it defines its own `WinCondition_Check` +
`Scar_AddInit`), so a base import is not required for *listing* — but without a real victory
condition the match may refuse to START or instantly end. Add the annihilate import so the match is
valid once listed (this was already flagged as R3 in RUN-PLAN §2.4).

### Exact edits to `scripts/build-verify-gamemode.mts` (confidence in brackets)

1. **[HIGH] Convert all text payloads to CRLF.** Add a helper and apply it to `WIN_TEXT`,
   `INFO_TEXT`, `SCAR_TEXT` before `enc()`:
   ```ts
   const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n')
   // ...
   { path: `game/winconditions/${WIN_STEM}.win`, bytes: enc(crlf(WIN_TEXT)), storage: 'stream' as const },
   { path: `scar/winconditions/${WIN_STEM}.scar`, bytes: enc(crlf(SCAR_TEXT)) },
   { path: `${MODGUID}.info`, bytes: enc(crlf(INFO_TEXT)), storage: 'stream' as const },
   ```
2. **[MED] Set `.info` (and preview) storage = 1** to match all 5 working mods. Add
   `storage: 'stream'` to the `.info` file entry (shown above) and `storage: 'stream'` to
   `preview.tga`. Then **relax the GEN4 assertion** at lines ~508/515: change
   `const infoStorageOk = infoRec?.storage === 2` → `=== 1`, and update the log string.
3. **[MED, runtime] Make the match valid to START.** Prepend to `SCAR_TEXT`:
   `import("winconditions/annihilate.scar")\n` (its `Scar_AddInit` coexists with ours; this is the
   RUN-PLAN R3 fallback, now recommended proactively).
4. Re-run: `npx tsx --tsconfig tsconfig.node.json scripts/build-verify-gamemode.mts` (idempotent;
   reinstalls to both `gamemode/` and `gamemode/subscriptions/`).

**Confidence that Q1 is fixable in-script without Mod Tools: HIGH.** The mod is a plain-text SGA and
our topology already matches ground truth; the remaining deltas (CRLF, storage flag, base-scar
import) are all pure build-script changes. If, after the CRLF fix, it still fails to list, the only
remaining unknown would be a signed-TOC requirement (working mods carry `verif=4/1`, ours `verif=0`)
— but unsigned local mods are documented to work, so this is unlikely.

---

## Q2 — Is there a 3D vehicle customizer preview, and the match path

### Answer: NO 3D vehicle preview exists. CoH2 customization is 2D item cards only.
Evidence:
- **Feral official manual** (feralinteractive.com CoH2 manual): customization = main-menu **player
  card → click the weapons-case icon → inventory → drag items onto loadout slots**, filter by type.
  Purely a drag-and-drop 2D inventory. The manual describes no 3D model viewer anywhere.
- **Our own captures** confirm it. Reviewed `/tmp/coh2-shots/ingame/` and
  `artifacts/ingame-verify/captures/`:
  - Main menu (`left_menu.png`): Play (Campaign / Theater of War / Skirmish & Multiplayer),
    Learn, Additional Content (In-Game Store / Modding HUB / Exit).
  - War Spoils / player profile (`after_crate_area.png`, `icon_row.png`, `keeper_warspoils_tooltip.png`):
    2D faceplate banner + cross emblem, war-spoils crate icon, "Complete games to earn loot points"
    loot bar. All flat UI cards.
  - In-Game Store (`after_crate_view.png`): 2D CoH bundle cards.
  - Custom-game lobby (`lobby_*.png`, `custom_game_*.png`) + the win-condition dropdown
    (`wincondition_dropdown_gen3_NOT_listed.png`).
  - **No frame anywhere shows a 3D vehicle model.** The faceplate/decal/emblem art is 2D badge
    texture, not a rendered tank.

**Conclusion: the ONLY in-engine on-vehicle view of an equipped skin+decal is inside an actual
match.** There is no menu shortcut that renders a 3D German vehicle with the skin.

### How skins/decals are equipped (for the loadout)
- Army customizer: **6 skin slots per faction — Light/Medium/Heavy × Summer/Winter.** A skin in
  "Heavy Summer" applies to every heavy tank on summer maps; winter skins only show on winter maps
  (Steam 864971765871043683; gameranx War Spoils 2.0). Decal + faceplate are separate loadout slots.
- Equip via player card → weapons-case → drag the item onto its slot (Feral manual).
- **Match-type constraint:** custom skins/decals render **only in Custom Games**, never Automatch
  (only store items show in Automatch) — coh2.org 35825. The **"Custom Aesthetics"** graphics option
  only governs whether you download/see OTHER players' custom aesthetics; YOUR OWN equipped skins
  always render for you (companyofheroes.vanillacommunities 219342). So no lobby toggle is needed for
  your own skin to appear.

### Match path assessment
- **Custom skirmish vs AI (or 0 AI)** is the reliable path: equip the skin in the correct
  class×season slot, launch a **Custom Game** on a **season-matching map**, build/spawn a German
  vehicle of that class → the skin renders.
- **Theater of War is NOT faster/reliable for this:** ToW missions use campaign blueprints (e.g. the
  "Panzer IV Ausf F1" 1941 variant), not the multiplayer `_mp` blueprints the skin slots key off, so
  an equipped MP skin is not guaranteed to apply to ToW's pre-placed vehicles. Stick to a Custom Game.
- Teching to a heavy in a normal skirmish is slow; our **ASAP-Verify win-condition auto-spawns the
  whole German grid at match start** — that is exactly the accelerator, which is why fixing Q1 matters.

---

## (C) RECOMMENDED next-run approach — ranked by reliability

### PRIMARY (once Q1 CRLF fix lands): ASAP-Verify win-condition in a Custom Game
This is the most reliable + fastest to a full German fleet with zero in-match input.
1. Apply the Q1 edits (CRLF helper + `.info` storage=1 + assertion relax + prepend
   `import("winconditions/annihilate.scar")`), re-run `build-verify-gamemode.mts`.
2. **Equip** the German Tiger Honvéd skin into **Heavy Summer** (matches RUN-PLAN skin; Tiger =
   heavy) + the Honvéd decal + faceplate, via player card → weapons-case → drag to slots.
3. Launch CoH2 through the harness (wiki `coh2-harness-driving.md`; resolution fix 1920×1080 while
   closed). Main menu → PLAY → **Custom Game / vs AI** → pick a **SUMMER** 1v1 map → 1 human + 0 AI.
4. Open the **Win-Condition dropdown** → select **"ASAP Verify"** (now listed) → START.
5. Wait for the on-screen `ASAP_VERIFY_READY` OCR marker → capture the wide grid, then one frame per
   vehicle over the auto camera cycle, into `artifacts/ingame-verify/captures/`.
6. Verify by eye: any default-skinned vehicle = wrong slot or season mismatch → re-equip / swap map.

### FALLBACK A (if "ASAP Verify" still doesn't list after CRLF): manual skirmish spawn
Custom Game, standard win condition (Victory Point/Annihilation), 1 human vs 1 Easy AI, summer map,
faction German. Skip to a heavy: cheat-spawn is unavailable without a win-condition, so either build
up (slow) or use a subscribed cheat/spawn gamemode. Capture whatever German vehicle you field.
Lower reliability + slower (manual teching), but needs no further mod fix.

### FALLBACK B (diagnostic if listing still fails): flip storage + check warnings.log
If CRLF alone doesn't list it, also apply the `.info`/preview storage=1 change, rebuild, launch,
open a Custom Game, then quit and `grep -i invalid` the freshly-rewritten `warnings.log` (per coh2.org
troubleshooting) — an "invalid file structure" line names the exact rejected file.

---

## Sources
- coh2.org — [How to make a win condition mod](https://www.coh2.org/topic/81465/how-to-make-a-win-condition-mod),
  [Mod Issue(s) - No longer shows up](https://www.coh2.org/topic/89696/mod-issue-s-no-long-shows-up-in-game),
  [Skins etc NOT in Auto-match](https://www.coh2.org/topic/35825/skins-etc-not-in-auto-match)
- Essence Engine Wiki — Win Condition File Format / Win Condition Pack Wizard (modding.companyofheroes.com; cert-broken, read via search snippets + the canonical example repo below)
- GitHub — [eliw00d/example-win-condition-pack](https://github.com/eliw00d/example-win-condition-pack) (canonical mod-tools `.win`/`.scar`/`.mod` with `<Type>WinConditionPack</Type>`)
- Steam — [How do vehicle skins work](https://steamcommunity.com/app/231430/discussions/0/864971765871043683/), [Mods not showing up](https://steamcommunity.com/app/231430/discussions/3/620696522196172244/)
- [Feral CoH2 manual](https://www.feralinteractive.com/en/manuals/companyofheroes2/latest/steam/) (player card → weapons-case → inventory drag-drop; no 3D preview)
- [Gameranx War Spoils 2.0](https://gameranx.com/updates/id/58661/article/company-of-heroes-2-war-spoils-2-0-update-detailed/) (6 slots: Light/Medium/Heavy × Summer/Winter)
- CoH Official Forums — [Custom Aesthetics](https://companyofheroes.vanillacommunities.com/discussion/219342/custom-aesthetics)
