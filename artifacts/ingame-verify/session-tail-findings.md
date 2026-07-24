# Session-tail findings (2026-07-20) — for wiki ingest

## 1. CoH2 army-customizer UI flow (Feral official manual)
- Path per manual: main-menu PLAYER CARD (top-right) → click the WEAPONS-CASE icon → inventory → drag items onto loadout slots (filter by type).
- Player card elements (verified via harness hover-tooltips at 2560x1440):
  - Big rank MEDAL (left) = rank/army indicator; hover shows army name ("Wehrmacht").
  - Clicking the medal/army cluster EXPANDS the ARMY CAROUSEL (Soviet, Wehrmacht[✓ active], US Forces, Oberkommando West, British). Selecting an emblem sets the active army.
  - Wooden CRATE + blue bar = WAR-SPOILS "boot" progress (tooltip "Complete games to earn boot points…"), NOT the inventory.
  - Arrow (top-left of card) = flips card to rank/experience.
- Vehicle SKIN slots: 6 per army = Light/Medium/Heavy × Summer/Winter. A skin in Heavy-Summer applies to all heavy tanks on summer maps.
- Sources: Feral CoH2 manual (feralinteractive.com/en/manuals/companyofheroes2), Steam discussion 864971765871043683, gameranx War Spoils 2.0.

## 2. LIMITATION: the customizer can't be reliably driven blind via the harness
- Extensive attempts (two sessions, incl. 2560x1440 + tight move→verify-cursor→click loop + hover tooltip reading) could NOT locate/activate the weapons-case INVENTORY opener. Clicks on the loadout cluster land on the army carousel or navigate to Replays; the inventory panel never opens.
- Likely because Relic largely WOUND DOWN War Spoils; the customizer may be partially removed/relocated in current CoH2, and modded skins (from mods/skins/) may not be equippable via the standard War Spoils UI.
- Reliable path remains: the USER equips the skin with a real mouse, then the harness captures the result.

## 3. Equipped loadout is SERVER-SIDE (no local file to edit)
- item-coh2-coh2.dat = AES-encrypted per-user blob (entropy 7.23), not editable; ItemCategoryCache lists slot taxonomy (german_0003_summer_heavy etc.) but never which item is equipped. Not cloud-synced. See loadout-data-probe.md.

## 4. Post-reboot CoH2 launch failure under the harness + FIX
- After a machine reboot, launching CoH2 via the harness fails: "GAME -- HtmlSurfaceManager initialization returned failure" → "APP -- failed to initialize its devices, code: 2" → clean exit at ~28s. Steam's overlay/CEF is in a bad post-boot state.
- FIX: a full Steam restart (steam -shutdown → reopen → settle ~30s) clears it; the game then boots normally under the harness.
- Also: right after applaunch when Steam JUST started, the game can "Application closed without errors" (auth/DRM not ready) — wait for steamwebhelper + a buffer before applaunch.

## 5. Harness UI-driving techniques (for fiddly GUIs)
- Screenshots are GAMESCOPE_CONTROL_SCREENSHOT_TYPE_BASE_PLANE_ONLY (steamcompmgr_shared.hpp:291) → the hardware CURSOR plane may be excluded; the game's software cursor sometimes bleeds into the base plane but isn't reliable.
- Run at NATIVE res (2560x1440) matching the game config for 1:1 click mapping AND larger, sharper icons — set harness -W/-H/-w/-h and CoH2 configuration_system.lua width/height equal.
- Tight loop: move → screenshot → confirm cursor/tooltip on the target → click. hover-dwell ~1.2s surfaces tooltips that identify each element.
- brightness check must use `-alpha off` (a black frame is RGB=0 but mean 0.25 with opaque alpha).

## 6. Harness improvement proposals (grounded in src/)
- ScreenshotRegion struct exists (steamcompmgr_shared.hpp:305) but is NOT exposed in the socket protocol → add `SCREENSHOT <path> <x> <y> <w> <h>` for native-res region crops (exact offsets, no upscale drift).
- Composite the cursor into captures (include cursor plane, or draw a crosshair at the last injected pointer pos).
- Add a `CURSOR` query returning current injected (x,y).
- Fix child-window pointer routing: centered modal popups (ModBuilder dialogs) accepted only KEYBOARD, not clicks (InputEmulation.cpp) — pointer events not routed to focused popup surface.

## 7. /tmp is wiped on reboot
- /tmp/harness_cli.py, /tmp/coh2-shots, /tmp/modbuilder-launch.sh etc. are lost on reboot. Recreate harness_cli.py: sys.path.insert(0,'/var/home/jflessenkemper/AOE-3-DE-A-New-World'); from tools.aoe3_harness.harness_client import HarnessClient. Wrapper cmds: state|screenshot|click|rclick|move|key|type.

## 8. Harness UI techniques discovered 2026-07-20 (decal-match run)
- 2560x1440 dropdown scroll: wheel/simple-drag do NOT work; the reliable method is a MANUAL press-hold-drag on the scrollbar via BUTTON DOWN + stepwise MOVE + BUTTON UP (harness_client: c.button('DOWN',1); c.move(x,yy) loop; c.button('UP',1)). Scrollbar sits at the FAR-RIGHT of the dropdown (x~1585 at 2560), beyond the item text — earlier drags at the text's right edge missed it.
- Menu-nav coords at 2560x1440 (custom lobby): center button stack x~1233; Select Map y~1197, Options y~1245, Start Game y~1345; Win Condition row y~513; Team2 "Add Computer Player" ~ (2180,700). Buttons ~48px apart. Verify with a hover screenshot before clicking.
- Camera close-ups fight the SCAR: the ASAP Verify SCAR's camera tour periodically repositions the camera; also RTS zoom-toward-cursor DRIFTS off small targets (tanks). CoH2 camera is fixed-pitch (pan/zoom, NO orbit) so a vehicle's away-facing side (right hull, where insignia sits) can't be brought into view. For a crisp insignia photo, extend the SCAR to spawn a single vehicle rotated so hullSideRight faces the fixed camera + a high-contrast (non-camo) skin; capture with SCREENSHOT_REGION.
- Decal-match verdict: MATCH verified by construction (game coh2_vehicle shader samples the SAME TEXCOORD1 badge channel+atlas the editor reads) + editor 61/61 texel-exact + vehicles render correctly in-engine + IFN1 historical placement. A pixel-sharp balkenkreuz photo is a capture constraint, not a mismatch. See decal-match-report.md.
