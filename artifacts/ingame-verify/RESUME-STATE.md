# RESUME STATE (banked at cap 2026-07-19, resets 3:20pm Sydney)

## DONE + PROVEN IN-GAME (via harness):
- Editor DECAL export loads clean in CoH2 [Sig:0], no error (fresh a1b2c3d4)
- Editor FACEPLATE export loads clean (fresh b2c3d4e5)
- Editor SKIN export loads clean (fresh 3907714500011001)
- The failing on-disk decal/faceplate SGAs were STALE pre-2026-06-10 artifacts; current code is correct. Permanent in-repo structural guard added (2142 tests).
- Editor 3D fidelity done earlier: 61/61 models complete, shader fixes (badge tint + coloured spec) shipped+deployed, TC1 unwrap 61/61 analytical, goldens re-baselined (60 PASS + elefant baseline).
- Faceplate visually confirmed in-game (player card).

## PENDING — on-vehicle VISUAL of skin+decal in-engine:
Blocker = gamemode "ASAP Verify" loads clean but does NOT list in lobby Win Condition dropdown.
Ruled out in-game: .win storage, 2-drive layout, entity_replacements, .list sidecar, numeric filename.
ROOT CAUSE (research, HIGH conf): LINE ENDINGS — working .win/.info/.scar use CRLF; ours is LF-only; CoH2's line parser drops LF-only .win from the selectable list.

### GEN6 FIX — NOT YET APPLIED (agent hit cap). Apply to scripts/build-verify-gamemode.mts:
1. crlf = s=>s.replace(/\r?\n/g,'\r\n'); wrap WIN_TEXT, INFO_TEXT, SCAR text before enc().
2. .info + preview.tga storage 2->1 ('stream'); FLIP the assertion at ~line 508/515 to expect storage===1. Keep .win=1, .scar=2.
3. Prepend import("winconditions/annihilate.scar") to the SCAR so a started match initializes.
4. Preserve Gen4/5 invariants (2-drive data-first, entity_replacements, verif=0). Rebuild, validate (CRLF present, storages correct, raw-zlib OK), reinstall to mods/gamemode/ + subscriptions/ (GUID a5a90ec1).
Full detail: artifacts/ingame-verify/vehicle-visual-plan.md (Q1) + scar-gamemode-design.md.

## Q2 (research): NO 3D customizer preview in CoH2 — customization is 2D cards only. On-vehicle view ONLY in a Custom Game match. Auto-spawn gamemode is the path.

## NEXT-RUN PLAN (after Gen6 lists the mode):
equip Tiger skin (Heavy Summer slot) + decal + faceplate via 2D inventory (player card -> weapons-case icon ~1328,76 -> drag to slot) -> Custom Game vs 0 AI on a SUMMER map -> select "ASAP Verify" -> START -> capture auto-spawned German grid after ASAP_VERIFY_READY marker.

## NEW USER INSTRUCTION (2026-07-19): launch CoH2 in WINDOWED mode ("windows mode"); DO NOT disturb the user while they play games.
- Harness backend for windowed: --backend wayland gives a visible nested window (no PipeWire stream, but screenshot+input still work). --backend headless = invisible (least disturbance) but user asked for windowed.
- Pre-flight "abort if user gaming" now CONFLICTS with "keep working while I game" — user overrides: proceed but use windowed + non-focus-stealing, never fullscreen/drm. Verify harness window does not grab the user's display/cursor.

## Known lobby coords (1920x1080 harness frame): Online&Skirmish (288,378); Create Custom Game (1190,470); Options (975,930); Win Condition dropdown (1050,390). ESC closes modals. wheel_at via harness_client for dropdown scroll.

## BREAKTHROUGH (2026-07-19 19:15): gamemode listing root cause = MISSING PER-FILE VERIFICATION HASHES
- Drove the official ModBuilder GUI (via harness, direct Proton launch of the 313220 Tools prefix — NO Steam close, ran concurrently with user's Easy Red 2). File>New WinConditionPack > Win Condition Wizard (filled Mod File/Name/WinCondition/Scar via keyboard Tab+type; clicks don't reach child dialogs but keyboard does) > Build. SUCCESS.
- The burn's ArchiveDefinition.txt (artifacts/ingame-verify/modtools-burned/ArchiveDefinition.txt) is the DEFINITIVE CoH2 packing spec: blocksize=262144; data TOC defverification="sha1_blocks"; info TOC defverification="crc_blocks". Our buildSga wrote verification=none(0) for everything. [Sig:0] = archive RSA signature (separate from per-file verification hashes). The lobby scanner REQUIRES sha1_blocks(.win/.scar)+crc_blocks(.info) hashes to list.
- Burned reference SGA: artifacts/ingame-verify/modtools-burned/asap_verify.burned.sga (GUID ae9c499b7db7479eb6907508d4ba111a). INSTALLED in game prefix mods/gamemode/ae9c499b...sga (the ONLY gamemode SGA there now; old a5a90ec1 removed). This WILL list (ModBuilder output).
- Gen7 fix agent (running): implement sha1_blocks/crc_blocks per-file verification in src/lib/sga-writer.ts, apply to build-verify-gamemode.mts, byte-match to the burned reference. Keep skin/decal/faceplate verif=0 (they load fine).

## IN-GAME TEST STILL DEFERRED (user playing Easy Red 2 — needs Steam-close):
Next harness run (when Steam free / user authorizes): launch game headless, open custom lobby Win Condition dropdown, confirm "ASAP Verify" LISTS (burned ae9c499b AND/OR our Gen7-fixed a5a90ec1). If listed: equip Tiger skin (Heavy Summer) + decal + faceplate via 2D inventory, SUMMER map vs AI, select ASAP Verify, START, capture auto-spawned German vehicle grid = final skin+decal on-vehicle visual.
- ModBuilder direct-launch script: /tmp/modbuilder-launch.sh (reusable). Game direct-launch blocked by CoH2 DRM (needs steam -applaunch).

## TODO (user instruction 2026-07-19): WIKI INGEST after Gen7 completes
Comprehensive llm-wiki ingest of this session's durable learnings (do AFTER Gen7 agent finishes to avoid concurrent edits to sga-rgt-format.md / index.md / log.md):
1. CoH2 win-condition mod listing REQUIRES per-file verification hashes (sha1_blocks .win/.scar, crc_blocks .info); [Sig:0]=archive signature != per-file verification. 6 hand-pack gens failed; ModBuilder burn adds the hashes. -> new/updated concept page.
2. ArchiveDefinition.txt = definitive CoH2 SGA packing scheme (blocksize 262144, per-ext verification+compression). Copy content into wiki.
3. Driving CoH2 ModBuilder GUI via harness: direct-Proton launch of Tools prefix 313220 (NO Steam close; dev tools have no CEG DRM); /tmp/modbuilder-launch.sh; keyboard-only (Tab/type_text/key) since clicks miss centered child dialogs; F4 opens combobox, Enter=default OK, ESC cancels. WinCondition Wizard flow (File>New>WinConditionPack>fill Mod File/Name/WinCondition/Scar>Build).
4. CoH2 GAME (231430) DRM blocks direct Proton launch ("Application closed without errors"); steam_appid.txt no help; only steam -applaunch works. Dev tools differ (no DRM) -> concurrent-with-user-games launch possible for tools.
5. Editor decal/faceplate in-game: current code correct; failing on-disk SGAs were stale pre-2026-06-10 (forward-slash/leaf-only folder trees CoH2 rejects). Fresh exports load [Sig:0]. Structural guard added.
6. Harness input mapping: clicks reach main window not centered modals; keyboard reaches focused control; type_text + wheel_at supported.
Pages likely: extend wiki/concepts/coh2-harness-driving.md (Mod Tools section) or new coh2-modbuilder.md; update sga-rgt-format.md (verification hashes — Gen7 may already); coh2-decal-pack-format.md; mocs/coh2.md; index.md; log.md.

## QUEUED (game-free run, added 2026-07-20): DECAL-MATCH close-up verification
User request: "ensure decals are rendered correctly in the game and match what's in the editor."
Editor side DONE (non-disturbing): verify-unwrap-analytical re-run = 61/61 RENDERS post shader-fix; golden footprints show side-skirt/hull placement. Data-level match guaranteed (editor samples the SAME TEXCOORD1 badge channel + atlas as the game's coh2_vehicle shader).
REMAINING (needs game): capture CLOSE-UPS of the national insignia on 2-3 German vehicles (Tiger hull-side, Panther, StuG III) in an ASAP Verify match, then side-by-side vs the editor's decal placement (golden footprint german/tiger.png, stug_iii.png + the editor 3D render). Confirm: (a) insignia on the correct submesh (side skirts/hull side, not the big body polygon), (b) single balkenkreuz cell per side, (c) player-colour tint, (d) no smear/wrong-face. Use harness SCREENSHOT_REGION for pixel-exact crops + camera zoom-in (scroll DOWN=zoom in) on a stationary spawned vehicle.
Fold into the equip run (same match): after the grid spawns, zoom the camera onto individual vehicles' hull sides and SCREENSHOT_REGION the insignia.
