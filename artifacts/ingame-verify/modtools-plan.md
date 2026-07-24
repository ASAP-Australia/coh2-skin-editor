# CoH2 Mod Tools — Win-Condition Build & Registration Plan

**Author:** modtools forensics agent · **Date:** 2026-07-19 · **Mode:** read-only forensics + web research (no game/tools launch)
**Question answered:** what makes a win-condition mod appear in CoH2's lobby *Win Condition* dropdown, that our hand-packed SGA (`a5a90ec1…`, 6 gens) never achieved — and is there a scriptable path.

---

## TL;DR (the honest answer)

- **The registration mechanism is: build the win-condition pack with the official `ModBuilder.exe` "Build" command.** ModBuilder's *Win Condition Wizard* produces the `.win`+`.scar` two-file model, burns them into an SGA, and copies the result to `…\My Games\Company of Heroes 2\mods\gamemode\`, at which point "your win condition should appear in your custom game's options dialog" (Essence Engine Wiki, quoted below). **No Steam Workshop publish is required for local testing** — a successful local *Build* is sufficient.
- **There is NO documented file-replicable / CLI shortcut** that reproduces a ModBuilder-built win-condition pack from loose files. Every community source, without exception, says "you have to build it with the Mod Builder." Our `buildSga()` hand-pack byte-matches the working mods on every *extractable* axis (drives, folders, storage bytes, `.win`/`.info`/`.scar`, CRLF, filename) and still does not enumerate — so the differentiator lives inside the ModBuilder burn pipeline (an `.info`/`.win` RGD field or SGA header bit our writer doesn't reproduce), not in any sidecar file we can drop next to the SGA.
- **Recommended next step:** launch `ModBuilder.exe` once under Proton via the harness, run the Win Condition Wizard, point its two file pickers at our existing `asap_verify.win` + `asap_verify.scar` (from `scripts/build-verify-gamemode.mts`), and click **Build**. That is the cheapest path that *actually* registers. GUI is required; there is no replicable file trick. Full click-flow in §B.

---

## A. CONFIRMED registration mechanism (with evidence)

### A1. The base-game module manifest proves the folder contract
`…/steamapps/common/Company of Heroes 2/RelicCoH2.module` (6064 B, plain text) declares where the engine looks for each pack type:
```
[global]
ScenarioPackFolder       = mods\scenarios
PropertyBagGroupPackFolder = mods\tuning
WinConditionPackFolder   = mods\gamemode      ← win conditions live here
AssetPackFolder          = mods\assets
SkinPackFolder           = mods\skins
DecalPackFolder          = mods\decals
FaceplatePackFolder      = mods\faceplates
…
```
So the *folder* is correct in our case (`mods\gamemode`). The `.module` file is the **base-game descriptor only** — it is NOT a per-mod registration list. There is exactly one `.module` on the whole system (`RelicCoH2.module`); no per-mod `.module` exists in the prefix, and none is written by ModBuilder into the game mods folder. **Refutes candidate (a)** ("a per-mod `.module` file is the registration artifact") and **candidate (d)** ("a data-registration list the game reads"): the game **folder-scans** `mods\gamemode\` (+ `subscriptions\`) at boot; there is no registry file.

### A2. The game enumerates by folder scan — proven by the live log
`…/My Games/Company of Heroes 2/warnings.log` (last run) shows every gamemode SGA mounted by a plain directory walk, ours included:
```
ARC -- …\mods\gamemode\a5a90ec1….sga 4881 B [ID:a5a90ec1…] [Ver:ff943e17…] [Sig:0]   ← OURS, mounts clean, no MOD error
ARC -- …\mods\gamemode\subscriptions\1660217730.sga 14533 B [ID:644d74e5…] [Sig:0]      ← WORKING (annihilate/victorypoint)
ARC -- …\mods\gamemode\subscriptions\353675196.sga …                                     ← WORKING
… (6 working numeric-Workshop-ID SGAs total)
```
Our current SGA is **boot-safe** (`[Sig:0]`, no `invalid file structure`, no `[Fatal]`) — the Gen4–Gen6 `.info` corruption that boot-crashed the engine (see [[coh2-harness-driving]] boot-crash gotcha) is fixed. It mounts; it just isn't *selectable*. So the block is purely the lobby enumerator, downstream of mount. **Refutes candidate (b)** (dev-mode/`-dev` flag): the working mods list with a stock launch and no dev flag; nothing in `RelicCoH2.module`, the logs, or any guide mentions a `-dev`/`-moddev` flag or `developer.cfg` gating the win-condition dropdown. **Refutes candidate (c)** (wrong folder): `mods\gamemode` is confirmed correct by both `RelicCoH2.module` and our clean mount there.

### A3. Structural parity is already achieved — the differentiator is INSIDE the burn
Byte/string comparison of our SGA vs the smallest working pack (`1660217730.sga`, Steamworks "Annihilate/VP" pack):

| Axis | Ours (`a5a90ec1…`) | Working (`1660217730`) | Match? |
|---|---|---|---|
| Drives | `data` ×2 (game, scar) | `data` ×2 (game, scar) | ✅ |
| Folder tree | `game\winconditions`, `scar\winconditions` | identical | ✅ |
| `.win` files | `asap_verify.win` | `annihilate_*.win`, `victorypoint_*.win` (14) | ✅ (kind) |
| `.scar` files | `asap_verify.scar` | matching `*.scar` (14) | ✅ (kind) |
| `.info` | `<GUID>.info` present | `<GUID>.info` present | ✅ |
| `[Sig:0]` unsigned | yes | yes (all 6 working are `[Sig:0]`) | ✅ |
| Line endings / storage | CRLF, storage=1 (Gen6) | same | ✅ |

The `.win`/`.info` bodies are **compressed RGD** (not plain strings), so the *field-level* delta inside them can't be read by `strings`. The design-doc Gen5 forensic decode already established the `.win` carries an `entity_replacements` RGD block and that the *listing* is driven by `.win` content — yet reproducing that block (Gen5) still didn't list. **Conclusion: the remaining delta is a burn-pipeline artifact** (an RGD field ordering / hash / header bit ModBuilder's `Burn.exe` writes and our `buildSga()` doesn't), not any file we can add. This is exactly what the design-doc CONCLUSION predicted and what every community thread asserts.

### A4. Web evidence — unanimous "must build with Mod Builder"; local build is enough
- **Essence Engine Wiki, Win Condition Pack Wizard** (`modding.companyofheroes.com/win-condition-pack-wizard`, via search snippet): *"If the build is a success, your win condition will be copied to your `Documents\My Games\Company of Heroes 2\mods\gamemode` folder. **Your win condition should appear in your custom game's options dialog.**"* → local Build = selectable; **no Workshop publish needed**.
- **coh2.org "How to make a win condition mod"** (topic 81465): *"You have to build it with the Mod Builder, then select it from the Wincondition dropdown menu."* Folder recipe: *"create a folder in your mod called `data` with `game` and `scar` folders — in `game` put your `.win` files, in `scar` your `.scar` files."* (matches our layout).
- **coh2.org "Testing out Win Condition Mods"** (topic 26183): a user's **ModBuilder-built** win condition still didn't list while subscribed Workshop packs did → the community remedy is *"restart Steam and the game / refresh the list,"* i.e. even Relic's own tool sometimes needs a client refresh; nobody ever reports a hand-packed SGA listing.
- **CoH Official Forums** (community.companyofheroes.com/discussion/153451 "Win Condition build doesn't show up"): diagnosis path is *check `warnings.log` for "invalid" → post your ModBuilder treeview* — i.e. the assumed source of truth is always the ModBuilder project, never a loose SGA.

**Net:** the confirmed mechanism is *"burn the pack with ModBuilder's Build, which drops it into `mods\gamemode`."* The engine then folder-scans and lists it. The reason ours fails is that hand-packing does not reproduce the burn's internal RGD/SGA artifact.

---

## B. Scriptable vs GUI verdict

### B1. Is there a CLI? — Partially, but not for the whole pack
Two relevant CLI binaries exist, neither of which builds a *registered win-condition pack* end-to-end:

- **`…/common/Company of Heroes 2/Archive.exe`** — the SGA archiver, full CLI:
  ```
  Archive.exe -a <archivefile> [-v] [-c <buildfile> -r <rootpath> [-m <version>] | -s <signkey> | -l | -w <wildcard> | -t | -e <location>]
  e.g.  archive -c filestoadd.txt -a out.sga -r <rootpath>
  ```
  This only *packs bytes into an SGA* — exactly what our pure-Node `buildSga()` already does, and which we've proven is NOT the differentiator. `-s <signkey>` signs (not needed; working mods are `[Sig:0]`). No win-condition/registration logic.
- **`…/common/Company of Heroes 2 Tools/Burn.exe`** — the asset "burner" (RGD/RGM/RGT/DDS compiler), CLI:
  ```
  Burn --source <f1> --source <f2> --dest <path> --plugin <plugin> --param <name> <value> …
  ```
  This is a **per-asset compiler** (image→RGT, rga→RGA, etc.), invoked *by* ModBuilder during Build. It is the tool that would compile a `.win`/`.scar` source into the burned RGD form — but there is **no documented plugin/param invocation for the win-condition pack**, and driving it correctly requires the same field knowledge we lack. Not a documented standalone path.

- **`ModBuilder.exe` itself has NO command-line build interface.** Strings analysis shows only GUI command bindings (`WindowCommands.Build`, `WindowCommands.BuildAll`, `WindowCommands.RebuildAll`, `NewModWindow`, `WinConditionWizard`, `GamePath`, `PublishedFileID`). It reads `GetCommandLineArgs` only for opening a project document, not for headless build. The build is a WPF click action, not a CLI verb.

### B2. Verdict: **GUI ModBuilder is required. No file-replicable shortcut exists.**
- We already reproduce `Archive.exe`'s output (SGA packing) and it doesn't register.
- The missing piece is the **burned RGD content of the `.win`/`.info`**, produced by ModBuilder's Build (via `Burn.exe` plugins) with parameters that are undocumented and unstringable from the binaries.
- Therefore the only reliable path to a listed win-condition is to **run ModBuilder's GUI Build once**.

### B3. Minimal GUI click-flow (from the community guides + WinConditionWizard strings)
Launch binary: **`…/steamapps/common/Company of Heroes 2 Tools/ModBuilder.exe`** under Proton via the harness (AppId **313220** = "Company of Heroes 2 Tools"; run it through the same GE-Proton path used for AppId 231430 — see [[coh2-harness-driving]]).

1. **First-run config:** `Tools ▸ Options…` → set **Game Path** (the `GamePath` setting) to `…/steamapps/common/Company of Heroes 2` (its `…\common\Company of Heroes 2` local files). This is where Build reads engine data and where it computes the `mods\gamemode` copy target.
2. **New Mod:** `File ▸ New Mod` → choose pack type **Win Condition** (the `NewModWindow` / `NewModPackType`). Give it a name (e.g. `ASAP Verify`) — this becomes the dropdown display name.
3. **Win Condition Wizard** (the `WinConditionWizard` — fields `WinConditionName`, `WinConditionDescription`, `WinConditionFile`, `WinConditionScarFile`, `WinConditionRequiresVPTicker`):
   - `WinConditionName` = `ASAP Verify`
   - `WinConditionDescription` = short text
   - `WinConditionFile` → browse to our `asap_verify.win`
   - `WinConditionScarFile` → browse to our `asap_verify.scar`
   - Leave `RequiresVPTicker` unchecked (annihilate-style).
   The wizard scaffolds the `data\game\winconditions\` + `data\scar\winconditions\` tree and injects the wizard's `WinConditionScarTemplate.scar` glue (`WinCondition_Init`/`Check`/`GameOver`, `Rule_AddInterval(WinCondition_Check,3)`).
4. **Build:** click **Build** (`WindowCommands.Build`). On success ModBuilder burns the pack and **copies the `.sga` into `…\My Games\Company of Heroes 2\mods\gamemode\`**.
5. **Verify listing:** launch CoH2 → Custom Game → the *Win Condition* dropdown should now show **ASAP Verify**. (If not, per the guides: restart Steam + game to refresh the list.)
6. **(Optional) publish:** only if we want it to persist/share — `Workshop ▸ Publish` from the game's main menu (this is the `PublishedFileID` path). NOT required for local verify.

---

## C. Tool inventory (binaries + roles, verified paths)

Root: `…/steamapps/common/Company of Heroes 2 Tools/`

| Binary | Role |
|---|---|
| **`ModBuilder.exe`** (957 936 B) | **The mod project GUI** — "CoH2 Mod Builder". Hosts the **Win Condition Wizard**, New Mod, Build/Rebuild/BuildAll, Burn-settings tree, Game Path option, Workshop publish (PublishedFileID). *This is the tool to launch.* PDB path in binary: `d:\projects\coh2-dlc\bia\src\tools\ModBuilder`. |
| **`Burn.exe`** (13.9 MB) | Asset **burner/compiler** (CLI: `--source … --dest … --plugin … --param …`). Compiles source assets → engine RGD/RGT/RGM/RGA. Invoked by ModBuilder during Build. Per-asset, not a pack builder. |
| **`AttributeEditorXML.exe`** (923 632 B) | The **Attribute Editor** — edits squad/entity attribute blueprints (RGD). Used for tuning/asset mods, not needed for a pure win-condition. |
| **`ArchiveViewer.exe`** (200 688 B) | Read-only SGA **browser** (the `.sga.list` dumps in `mods\skins\` are its `-l` TOC output — a viewer artifact, NOT a registration file). |
| `FXEditor.exe` (8.3 MB) | FX/particle editor — irrelevant here. |
| `gfxexport.exe` (5.98 MB) | Scaleform GFX exporter — irrelevant. |
| `BsSndRpt.exe` / `BugSplat*.dll` | Crash reporter (the `BsSndRpt64.exe` seen on boot-crashes). |
| `3dsmax2015/`, `toolsdata/` | Max plugins + burn templates/light profiles — model pipeline, irrelevant to win conditions. |

Game-side (`…/steamapps/common/Company of Heroes 2/`): **`Archive.exe`** (SGA CLI archiver, see §B1), **`RelicCoH2.module`** (base-game folder manifest, §A1), `WorldBuilder_CoH_2.exe` (map editor), `RelicCoH2.exe` (game).

**Tools Data** (`…/common/Company of Heroes 2 Tools Data/`): only `skins/` + `infantry/` sample source assets + `ocf.exe`. **No example win-condition mod project, no `.module` template, no CHM/PDF docs** ship with the tools — the docs live only on the Essence Engine Wiki (`modding.companyofheroes.com`).

---

## D. Concrete recommended NEXT step (cheapest path that actually registers)

**Do this, in order:**

1. **Reuse our existing SCAR/`.win` sources.** `scripts/build-verify-gamemode.mts` already emits `asap_verify.win` (schema in `scar-gamemode-design.md` §1a) and the `asap_verify.scar` spawn logic (§2). Export those two files to a plain folder ModBuilder can browse (e.g. write them out un-SGA'd next to the script). No SGA packing — ModBuilder does the burn.
2. **Launch `ModBuilder.exe` under Proton via the harness** (AppId 313220), run the **Win Condition Wizard** pointing at those two files, click **Build** (full flow §B3). This is a **one-time GUI interaction** — after Build succeeds and drops the burned SGA into `mods\gamemode\`, capture that SGA as the golden reference.
3. **Diff the ModBuilder-burned SGA against our `buildSga()` output** (RGD-level, not just string-level — decompress the `.win`/`.info` chunks). That diff is the *actual* missing registration field. If it's a reproducible RGD delta, fold it into `buildSga()` so future packs register **without** the GUI (this converts a one-time GUI step into a permanent scriptable path). If it's a per-build hash/GUID we can't reproduce, accept ModBuilder-Build as the required step for gamemode packs.
4. **Then drive the lobby** (harness) → Custom Game → select **ASAP Verify** in the Win Condition dropdown → the `.scar` spawns the German vehicle with equipped skin+decal for the pixel-level in-engine verification that is currently blocked.

**Why this over the alternatives:** publishing to Workshop (design-doc option 1) also works but needs user consent + pollutes Workshop and is slower to iterate; driving a full skirmish (option 2) is ~10+ min of unreliable RTS automation. A single ModBuilder Build is the minimal action that flips the mod from *mounted-but-unlisted* to *selectable*, and step 3 gives us a shot at a permanent scriptable fix for free.

**Do NOT** spend more gens on `buildSga()` structural tweaks blind — six evidence-based structural fixes (storage type, drive order, `entity_replacements`, `.list`, numeric ID, CRLF) all failed against direct in-game test. The differentiator is provably inside the ModBuilder burn, and the only way to obtain it is to run one Build and diff.

---

## Related
- `artifacts/ingame-verify/scar-gamemode-design.md` — §0 (ModBuilder WinConditionWizard strings), Gen1–Gen6 fixes, CONCLUSION (hard-blocker via raw SGA).
- `scripts/build-verify-gamemode.mts` — our `.win` + `.scar` source of truth to feed the wizard.
- wiki `[[coh2-harness-driving]]` — Proton launch, boot-crash-on-corrupt-SGA gotcha, cleanup recipe (reuse for launching AppId 313220 ModBuilder).
- wiki `[[coh2-workshop-publish-flow]]` — Workshop publish path (option 1 fallback).
- wiki `[[sga-rgt-format]]` — SGA v7 / RGD internals for the step-3 diff.

## Sources (web)
- Essence Engine Wiki — Win Condition Pack Wizard: http://modding.companyofheroes.com/win-condition-pack-wizard
- Essence Engine Wiki — Mod Builder: http://modding.companyofheroes.com/mod-builder
- coh2.org — How to make a win condition mod: https://www.coh2.org/topic/81465/how-to-make-a-win-condition-mod
- coh2.org — Testing out Win Condition Mods: https://www.coh2.org/topic/26183/testing-out-win-condition-mods
- coh2.org — Getting started with the official tools: https://www.coh2.org/guides/26089/coh2-modding-getting-started-with-the-official-tools
- CoH Official Forums — Win Condition build doesn't show up: https://community.companyofheroes.com/discussion/153451/win-condition-build-doesnt-show-up-in-coh2-game-help
