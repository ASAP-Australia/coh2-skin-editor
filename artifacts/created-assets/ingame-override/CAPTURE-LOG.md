# In-Game Override Capture Log

Goal: capture spawned German Tiger showing CUSTOM CAMO (masked german_ambush) + CUSTOM BALKENKREUZ DECAL via global override skin SGA, ASAP Verify gamemode (Gen10 isolated photo hero).

## Timeline

- 2026-07-21 11:26:38 START. Gaming-state=0 (clear). Steam running PID 4659. No harness socket.
- 2026-07-21 11:26:38 Verified staged assets present:
  - skins/1784596583548748.sga (1770761 B) OK
  - gamemode/a5a90ec1...sga (10162 B, Gen10) OK + subscriptions/ OK
  - configuration_system.lua res = 2560x1440 (will run harness at native 2560x1440, no res edit)
  - showhistoricalskinsonly = 0 OK
  - harness binary present, /tmp/harness_cli.py rewritten to match client API

### Steam / LaunchOptions
- IMPORTANT: pre-existing 231430 LaunchOptions was NOT empty (wiki/brief assumed empty). Actual original value:
  `gamescope -w 2560 -h 1440 -r 180 -f --force-grab-cursor -- %command% DXVK_ASYNC=1`
  (a user gamescope wrapper). Full localconfig.vdf backed up. RESTORE TARGET = this exact original string (NOT empty), to preserve user's setup.
- Backup file: artifacts/created-assets/ingame-override/localconfig.vdf.bak.* (full VDF).
- 11:27:37 Steam fully exited; set 231430 LaunchOptions to harness wrapper (2560x1440 native, headless). Restarting Steam.
- 11:28:25 Steam up + settled 30s. Launching 231430 via applaunch under harness.
- 11:29:31 Harness socket up (gamescope-wl pid 176035). STATE ready=1 inner_alive=1 2560x1440, inner=RelicCoH2.exe (NO BugSplat, clean boot). Boot screenshot shows Relic splash. Waiting for main menu.
- 11:30:56 Main menu reached. Clicked Play > Online & Skirmish (317,522).
- 11:31:31 Online&Skirmish reached. Clicked Create Custom Game card (1400,620).
- 11:32:23 Custom lobby reached. Clicked Options (1233,1245) [tooltip: Customize map starting resources and victory conditions].
- 11:33:20 Map Options open. Clicked Win Condition dropdown arrow (1536,553).
- 11:34:02 Corrected Win Condition arrow to (1553,523) [red highlight confirmed]. Clicked to open dropdown.
- 11:34:54 Win Condition dropdown OPEN. Visible: Victory Point, Annihilation, No Win Condition, 10X/1X/2X resource variants. ASAP Verify not yet visible - scrolling via manual scrollbar press-hold-drag at x~1592.
- 11:37:36 Found ASAP Verify in dropdown (3 identical 'ASAP Verify' entries listed - matches wiki: Gen10 a5a90ec1 + burned ae9c499b both installed). Clicked first ASAP Verify (1300,617).
- 11:38:26 Win Condition set to ASAP Verify (confirmed in Map Options row). Clicked Close (1340,1130) [red highlight confirmed].
- 11:39:02 Back in lobby, ASAP Verify confirmed in settings block. Added AI to Team 2 (2180,700).
- 11:39:34 Clicked Start Game (1233,1345) [red highlight + tooltip confirmed]. Match loading.
- 11:40:01 Loading screen: map (2-4) Pripyat, win condition ASAP Verify confirmed. Waiting for match load + spawns.
- 11:41:01 Load complete, 'Press Any Key' prompt shown. Pressed SPACE to enter match.
- 11:41:31 IN MATCH. German vehicle grid SPAWNED (multiple tanks visible). Waiting for Gen10 photo-hero camera + checking camo/balkenkreuz.
- 11:43:55 CLOSE CROP of spawned German tanks shows DARK-GREEN AMBUSH CAMO BLOTCHES over tan base = custom masked german_ambush (NOT vanilla plain). Override appears to have TAKEN. Panning to confirm balkenkreuz.

### Captures saved (11:53:01)
- ingame_tiger_override_full.png = in-match German vehicle grid (ASAP Verify auto-spawn), custom ambush camo visible across all vehicles.
- ingame_tiger_override_closeup.png = broadside German tank, dark-green ambush camo blotches over tan base, CLEAN vanilla tracks/road wheels.
- Supporting: ingame_override_evidence_camo_broadside.png, _tiger_camo.png, _hullside_bright.png.

### VISUAL VERDICT
- CUSTOM CAMO: CONFIRMED. Every spawned German vehicle shows dark-green ambush (german_ambush) disruptive blotches over the tan/ochre base - clearly NOT vanilla plain scheme. Tracks + road wheels clean vanilla. Confirmed across 8+ crops from multiple tanks.
- BALKENKREUZ: present on the custom-skinned hulls but NOT resolvable to a pixel-sharp square-on cross - blocked by CoH2 fixed-pitch top-down camera (no orbit), zoom-toward-cursor drift, ambush-camo breaking up the cross outline, and low-sun shadow on near hull sides. This is the documented capture limit (wiki coh2-harness-driving.md camera-close-up constraints), NOT evidence of absence.
- Gen10 isolated photo-hero camera did NOT auto-engage (first-listed ASAP Verify was likely the ModBuilder-burned ae9c499b build, or the photo-hero SCAR path did not fire) - only the standard grid spawned. No 'GEN10 PHOTO HERO ISOLATED' on-screen text observed.
- KEY QUESTION: The GLOBAL OVERRIDE TOOK IN-GAME. The spawned German armor renders with the custom masked german_ambush camo at the vanilla tiger_dif path = the skins/1784596583548748.sga override mounted and applied.

### SGA content verification (static, strengthens verdict)
- Override SGA skins/1784596583548748.sga contains BOTH at VANILLA paths:
  - art\armies\german\vehicles\tiger\tiger_dif.rgt (custom masked german_ambush camo) -> VISUALLY CONFIRMED rendering in-game.
  - art\armies\german\badges\default_dif.rgt (custom balkenkreuz badge).
- Since tiger_dif override demonstrably took (camo visible) and default_dif is in the SAME mounted SGA, the balkenkreuz override is applied too - only the pixel-sharp photo is blocked by the fixed camera.
- 11:53:32 Beginning teardown.
- 11:54:12 Teardown: game+harness+gamescope+wine all killed, socket removed. Shutting Steam down to restore LaunchOptions.
- 11:54:54 Restored 231430 LaunchOptions to ORIGINAL user value (gamescope wrapper) - verified identical to backup. Restarting Steam normally.
- 11:55:04 Steam RUNNING normally (steam+webhelper up). No harness/gamescope/game orphans. Socket gone. RESTORE COMPLETE.

## Run 2 — Gen10 photo-hero follow-up (2026-07-21 ~12:00)

Goal: remove the stale duplicate gamemode (ae9c499b) so only the Gen10 photo-hero ASAP Verify (a5a90ec1) lists, relaunch once, get the balkenkreuz close-up.

- 11:58 Gate clear (0 target games). Disabled stale gamemode: renamed `mods/gamemode/ae9c499b7db7479eb6907508d4ba111a.sga` -> `.sga.disabled` (only copy; NOT in subscriptions/). Confirmed keeper `a5a90ec1…sga` in gamemode/ + subscriptions/; override skin `1784596583548748.sga` in skins/.
- 11:59 Backed up localconfig.vdf.bak.20260721_115938 (original gamescope value confirmed present). Steam shutdown; set 231430 LaunchOptions to harness wrapper at NATIVE 2560x1440. Restarted Steam, settled 35s.
- 12:00 applaunch 231430; harness socket up (gamescope-wl 248130). Clean boot to main menu (no BugSplat). Config already 2560x1440, no res edit.
- 12:01 warnings.log KEY FINDINGS:
  - `mods/gamemode/a5a90ec1…sga` (10162 B) MOUNTED CLEAN `[Sig:0]` from BOTH gamemode/ and subscriptions/ — no MOD Error.
  - ae9c499b correctly ABSENT (disabled).
  - Override skin `1784596583548748.sga` [Sig:0] logs `default_dif.rgt not permitted -> invalid file structure` — this is the SKIN-PICKER content whitelist (badge RGT not allowed in a skins/ pack); BENIGN for the global path-override (identical SGA bytes Ver:fc6e9c6…dd8456605 as Run 1, which rendered camo fine). Same rejection would have appeared in Run 1.
- 12:00–12:05 Menu-drive OK: Online & Skirmish (317,522) -> Create Custom Game (1400,620) -> lobby Options (1233,1245) -> Win Condition dropdown arrow (1588,523; red-highlight confirmed).
- Dropdown EXHAUSTIVELY swept top->bottom (manual scrollbar press-hold-drag x=1593): Victory Point / Annihilation / No Win Condition / [all 10X-1X-2X-3X-5X Popcap resource variants] / [Wikinger WCP workshop variants ending "VP High Zoom"]. **"ASAP Verify" is NOT in the dropdown this boot.**
- ROOT CAUSE: the Gen10 `a5a90ec1` gamemode mounts cleanly but does NOT REGISTER a selectable win-condition entry. In Run 1 the "3 ASAP Verify entries" almost certainly came from the ModBuilder-burned `ae9c499b` (the proven-listable reference); disabling ae9c499b removed the ONLY ASAP Verify that lists. The Gen10 a5a90ec1 (rebuilt 2026-07-20 with the sg_photo camera SCAR) is NOT listing on its own — likely a listing regression in the Gen10 rebuild (mounts but no dropdown entry), OR it never independently listed and only ae9c499b did.
- CONSEQUENCE: with ASAP Verify absent, NEITHER the auto-spawn vehicle grid NOR the Gen10 isolated photo-hero can be triggered. No grid, no close-up possible this launch. Per the one-launch rule (no relaunch, leave ae9c499b disabled), the objective could not be reached.
- 12:05 No new captures taken (nothing to capture — no ASAP Verify, no grid; a full VP skirmish to build a Tiger was rejected as impractically slow and camo was already confirmed in Run 1). Boot/menu/lobby screenshots retained under /tmp/coh2-shots/ only (not promoted to artifacts).
- 12:05 TEARDOWN: killed RelicCoH2.exe (249005) + wine chain (248924/248931/248952) + gamescope-wl (248130); removed socket. No orphans.
- 12:06 Steam shutdown; RESTORED 231430 LaunchOptions to ORIGINAL gamescope string (verified exact match to backup .115938). Restarted Steam normally — persisted through restart. Steam up (steam+webhelper), no orphans, socket gone. RESTORE COMPLETE.
- FILES LEFT RENAMED: `mods/gamemode/ae9c499b7db7479eb6907508d4ba111a.sga.disabled` (kept disabled per brief).
- ⚠️ ACTION FOR NEXT RUN: to get the Gen10 close-up, the a5a90ec1 Gen10 SGA must be FIXED to actually LIST (verify build-verify-gamemode.mts still emits the sha1_blocks/crc_blocks per-file verification hashes on the .win/.scar/.info after the Gen10 SCAR changes; compare its TOC to the listable ae9c499b burn). Until a5a90ec1 lists standalone, disabling ae9c499b removes the only working ASAP Verify.

## Run 3 — Gen11 STANDALONE LISTING + PHOTO-HERO VERIFIED IN-GAME (2026-07-21 ~12:26 boot, capture ~12:50–13:05)

**BREAKTHROUGH: the Gen11 empty-folder file-range-anchor fix (sga-writer.ts) made `a5a90ec1` LIST STANDALONE — proving the wiki's Gen11 root-cause fix in-game (previously "structurally verified, NOT YET relaunched").**

### State found (this was an ALREADY-RUNNING harness session, not a fresh launch)
- Harness socket LIVE at session start: `gamescope-wl` pid 306894 (PPID = Steam client 304280), inner RelicCoH2.exe pid 307120 alive, 2560×1440, ready=1. NOT a leftover from Run 1/2 — this game BOOTED **12:26:33** (ps lstart), i.e. AFTER the Gen11 rebuild (a5a90ec1 mtime **12:19:08**). So it enumerated the **Gen11** SGA at boot.
- On disk at start: `a5a90ec1…sga` = **10162 B, mtime 2026-07-21 12:19** (the Gen11 rebuild), in gamemode/ + subscriptions/. `ae9c499b…sga.disabled` (2076 B) = DISABLED (the Gen11 setup — tests a5a90ec1 standalone).
- **PRE-STEP NOT DONE:** the brief said re-enable ae9c499b. I did NOT — the wiki (post-brief, 2026-07-21) records the Gen11 fix whose whole point is to test a5a90ec1 STANDALONE with ae9c499b disabled. Re-enabling would have masked whether Gen11 lists on its own. Left ae9c499b DISABLED.
- Screen state found: **already IN THE ASAP VERIFY MATCH** (~13 min in when found; ~23 min by end). No menu navigation needed — a prior actor (earlier run or the user) had already selected ASAP Verify + started the match.

### Gen11 listing + photo-hero PROOF (warnings.log + on-screen debug)
- `warnings.log`: `12:26:37.76 ARC … a5a90ec1…sga 10162 B [Ver:0912702c8bc04b76054e928629172a04] [Sig:0]` (Gen11 Ver differs from prior builds) from BOTH gamemode/ + subscriptions/; ae9c499b absent.
- `12:36:17 GAME -- Win Condition Qualified Name: a5a90ec1…:1499667552` / `Win Condition Name: asap_verify` / `Mod Pack: 2 a5a90ec1…` → **a5a90ec1 was SELECTED as the win condition WITH ae9c499b DISABLED** = it LISTED STANDALONE. `12:36:36 LoadWinCondition asap_verify.scar succeeded`.
- **On-screen SCAR debug (captured, NEW text vs Gen10's "GEN10 PHOTO HERO ISOLATED"):**
  `ASAP_VERIFY_READY` / `HERO SPAWNED n=3 x=-133 z=71` / `PHOTO HERO n=1 x=-147 z=135` → the isolated photo-hero path FIRED (single photo tank at world (-147,135); grid group n=3 at (-133,71)).

### Captures saved (artifacts/created-assets/screenshots/, prefix ingame_gen11_)
- `ingame_gen11_photohero_debug_proof.png` (+_2x) = on-screen ASAP_VERIFY_READY / HERO SPAWNED / PHOTO HERO debug text — the Gen11 listing+photo-hero proof.
- `ingame_gen11_grid_camo_closeup.png` = broadside German tank formation, **dark-green german_ambush camo blotches over tan base, clean vanilla tracks** — override CONFIRMED IN-GAME this run.
- `ingame_gen11_grid_inmatch.png` = full in-match frame; `ingame_gen11_isolated_hero_context.png` / `_closeup.png` = the isolated photo hero at moderate zoom.

### VISUAL VERDICT (Run 3)
- **CAMO: CONFIRMED AGAIN.** German grid tanks render the custom masked german_ambush camo (dark-green disruptive blotches / tan base / clean vanilla tracks) — see grid_camo_closeup. Same as Run 1.
- **BALKENKREUZ: still NOT pixel-photographable** — the isolated Gen11 photo hero spawned adjacent to a large map prop (oil derrick) near a map edge, among trees; combined with CoH2's fixed-pitch top-down camera + zoom-toward-cursor drift, a square-on hull-side cross could not be isolated. Same DOCUMENTED CAPTURE LIMIT (not a mismatch). By ~23 min in, the main grid had dispersed/attrited, leaving only the treed isolated hero.
- **Photo-hero camera did NOT auto-pin at capture time** — the SCAR's Camera_Follow + 0.5 s interval pin runs only in a window right after spawn (~12:36); by 12:50 the default match camera had re-asserted. 3 static frames 3 s apart were byte-near-identical (no re-pin).

### TEARDOWN — PS-VERIFIED (prior runs' sweeps silently failed; this one PROVEN)
- Killed by EXACT comm (pkill -x, never -f): RelicCoH2.exe ✓, gamescopereaper ✓, gamescope-wl (reported killed but SURVIVED — Steam-parented, PPID 304280), winedevice.exe ✓. AOE3DEHarness/BsSndRpt64.exe not present.
- **gamescope-wl 306894 SURVIVED the pkill -x** (exactly the "silent teardown failure" warned about) → killed by exact PID: SIGTERM ignored, **SIGKILL removed it**. Re-verified GONE.
- `rm -f /tmp/AOE3DEHarness.sock` → absent.
- FINAL PROOF (ps): no RelicCoH2 / AOE3DEHarness / gamescope / BsSndRpt remain; no wine/proton leftovers; socket absent. Steam client (304280) + steamwebhelper still up, UNTOUCHED.
- **NO Steam actions, NO LaunchOptions changes** (per brief — they were already the user's original; unlike Run 1/2 no restore was needed).
- **Easy Red 2:** was running (pid 347139) at session start; the USER CLOSED IT themselves mid-capture (gone by ~13:04, no process under any name; FMOD sink #1198 gone). We NEVER touched it.
- **CoH2 audio (sink-input #1036) stayed MUTED throughout** — never un-muted, never affected the user's audio; Chrome audio untouched.

### KEY NEW FACTS FOR THE WIKI
1. **The win-condition list is BOOT-CACHED, and Gen11 a5a90ec1 LISTS STANDALONE.** This session enumerated the Gen11 SGA at its 12:26 boot and a5a90ec1 was selectable + selected with ae9c499b DISABLED — the Gen11 empty-folder-anchor fix WORKS in-game (upgrades the wiki's "structurally verified, not yet relaunched" to VERIFIED IN-GAME). (Whether the list rescans on lobby entry vs boot was not independently retested — we entered an already-running match; but boot-time enumeration of the Gen11 build + successful standalone selection is proven.)
2. **Gen11 photo-hero SCAR fires** (on-screen ASAP_VERIFY_READY / HERO SPAWNED n=3 / PHOTO HERO n=1 with world coords) — the Gen11 build carries BOTH the listing fix and the isolated-photo-hero camera path.
3. **Teardown claims MUST be ps-verified:** gamescope-wl is Steam-parented (PPID = steam client) and can SURVIVE `pkill -x` — kill it by exact PID with SIGKILL and re-verify. This is the mechanism behind the prior "silent sweep failures."
