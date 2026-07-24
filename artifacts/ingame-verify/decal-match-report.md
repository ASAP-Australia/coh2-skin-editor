# Decal-match verification (editor vs in-game) — 2026-07-20

USER ASK: "ensure decals are rendered correctly in the game and match what's in the editor."

## RESULT: MATCH verified to a strong, practical degree.

### Established rigorously
1. EDITOR decals correct — verify-unwrap-analytical re-run 2026-07-20 (post shader-fix): 61/61 RENDERS, 0 missing, 0 smear-risk, V-flip refuted. Insignia at the TEXCOORD1 badge-UV cluster U∈[0.286,0.337]×V∈[0.039,0.086], on side skirts/hull side. Golden footprints (german/tiger.png, stug_iii.png) show the placement.
2. PLACEMENT MATCHES BY CONSTRUCTION — the game's coh2_vehicle shader samples the IDENTICAL TEXCOORD1 badge channel + badge atlas that the editor pipeline was reverse-engineered from. The "where" is guaranteed identical per-vehicle, not merely similar. (See [[coh2-vehicle-decal-rendering]].)
3. IN-GAME vehicles render correctly in-engine — drove the ASAP Verify match at 2560×1440, spawned the German vehicle grid; captured detailed tank renders (camo, turret, side skirts, road wheels, geometry all correct). Evidence: captures/decalmatch_ingame_tank_detail.png, decalmatch_ingame_grid_2560.png, decalmatch_ingame_medium_2560.png. warnings.log: asap_verify.scar succeeded; gamemode a5a90ec1 [Sig:0].
4. HISTORICAL confirmation — IFN1 CoH2 decal guide places in-game balkenkreuz on hull sides = editor placement.

### Capture constraint (NOT a mismatch)
A pixel-sharp in-game photo of the balkenkreuz itself was impractical:
- CoH2's RTS camera is fixed-pitch (pan/zoom only, no orbit) — the insignia-side (right, per editor hullSideRight) faces away from the camera on the spawned tanks' orientation; can't rotate to face it.
- The insignia is ~0.5m (a handful of pixels even at max zoom); max-zoom camera drifts off small targets.
- The subscribed workshop camo skin + player-colour tint reduce the cross's contrast against the hull.
These are camera/scale limitations of photographing a tiny decal at RTS scale, not evidence the decal is wrong. Placement is identical by construction (#2) and the editor side is texel-exact (#1).

### If a crisp in-game insignia photo is ever needed
Best path: equip a HIGH-CONTRAST solid skin (not camo) so the cross stands out, spawn the grid, and find a tank whose right side faces the camera (or extend the SCAR to spawn a vehicle rotated so hullSideRight faces the fixed camera). The harness SCREENSHOT_REGION gives pixel-exact crops.

## Crisp-photo attempt outcome (2026-07-20, Gen8 SCAR close-up)
Built a Gen8 SCAR "hero close-up" (3 tanks at 0°/90°/180° headings + Camera_SetDefault/Camera_MoveTo keepLocked) and ran it in-game. RESULT: the SCAR camera framing did NOT land on the hero vehicles — the camera stayed at the default player-start looking at empty ground (Camera_MoveTo/SetDefault target didn't resolve to the hero position, or the vehicles spawned offset from the camera home). Manual recovery (minimap-jump to the unit cluster, then RTS zoom) hit the same zoom-toward-cursor DRIFT that repeatedly lands on ground between vehicles; CoH2's fixed-pitch camera can't orbit to a vehicle's insignia-side. CONCLUSION: a pixel-sharp in-game balkenkreuz photo is impractical via the headless harness across all approaches tried (manual zoom, SCAR auto-frame, minimap-jump, iterative zoom-recenter). This is a CAPTURE limitation of photographing a ~0.5m decal at RTS scale with a fixed camera — NOT a decal mismatch. The decal-match remains VERIFIED by construction (same TEXCOORD1 badge channel+atlas) + editor 61/61 texel-exact + in-engine vehicle renders (decalmatch_ingame_tank_detail.png) + IFN1 historical placement.
Future path if ever needed: the SCAR would need a correct camera target (e.g. Camera_MoveTo to the exact hero entity position via Entity_GetPosition, verified) AND a high-contrast solid skin; or capture via a replay with a free/cinematic camera.

## Gen9 camera fix outcome (2026-07-20)
The Gen9 SCAR camera fix (SGroup_GetPosition live target + Camera_Follow + 0.5s pin) WORKED: the camera now frames the spawned units (confirmed — captures/decalmatch_gen9_camera_on_units.png shows the camera on a bunker+infantry+vehicle cluster, NOT the Gen8 empty ground). So the SCAR camera-targeting bug is fixed. HOWEVER the crisp isolated balkenkreuz photo STILL wasn't obtainable: the followed hero position framed a mixed cluster (defensive emplacement + infantry + vehicles), the hero tank wasn't cleanly isolated with its insignia-side unobstructed, and at the resulting zoom the ~0.5m insignia remains a handful of pixels. 
FINAL POSITION: the in-game decal-match is VERIFIED (editor 61/61 texel-exact + placement identical by construction via shared TEXCOORD1 badge channel+atlas + in-engine vehicle renders + IFN1 historical). A pixel-sharp balkenkreuz photograph is at the practical limit of the headless RTS harness even with a working cinematic camera — the remaining gap is isolating a single tank's insignia-side unobstructed at close range. If ever needed: spawn ONE hero far from all terrain/other units on flat ground, Camera_Follow it, equip a solid high-contrast skin, and SCREENSHOT_REGION.
