# ASAP Verify — Harness Session RUN-PLAN

**For the next agent.** The "ASAP Verify" win-condition gamemode is built and installed. This is the
exact checklist to drive CoH2 via the harness, select the mode, and capture the player's equipped
skin/decal on every German vehicle class — with zero manual input once the match starts.

- **Mod built by:** `scripts/build-verify-gamemode.mts` (re-run to rebuild + reinstall; idempotent).
- **Design doc:** `artifacts/ingame-verify/scar-gamemode-design.md` (§5 lobby flow, §3 skin-render rationale).
- **Installed SGA:** `.../Company of Heroes 2/mods/gamemode/a5a90ec1f00f4b7e9c0d3a2b1e4f5a60.sga`
  (local mod, sibling to `gamemode/subscriptions/` — auto-loads unsigned, `[Sig:0]`).
- **Lobby dropdown label:** **`ASAP Verify`** (the `fe_name` in the `.win`).
- **On-screen marker printed at readiness:** `ASAP_VERIFY_READY` (top-left `dr_text2d` + centre `PrintOnScreen`).

All harness mechanics (launch options, the CRITICAL render-resolution fix, backend, CLI wrapper,
crop recipe, pgrep footgun, cleanup) live in the wiki — **do not restate them here**. Read:
**`llm-wiki/wiki/concepts/coh2-harness-driving.md`**. This plan only adds the ASAP-Verify-specific steps.

---

## 0. PRE-FLIGHT (blocking — do not launch until ALL true)

1. **The visual sweep must be FINISHED.** A detached sweep (originally PID 88451) writes to
   `artifacts/verify-unwrap/`. Before any GPU/launch work, confirm it has completed:
   - `artifacts/verify-unwrap/visual-report.md` has been regenerated and is **no longer changing**
     (check its mtime is stable across ~30s; it was last mid-write at 2026-07-19 11:00).
   - No Electron/sweep process is still running. Use exact-name matching only (the wiki's pgrep
     footgun): `pgrep -x electron`, `pgrep -x node` for the sweep's runner — and confirm none belong
     to the sweep. Do **not** kill it; just wait for it to exit on its own.
   - Rationale: the sweep does its own offscreen GPU work; launching CoH2 through the harness while
     it runs contends for the GPU and can corrupt both captures.
2. **CoH2 is fully closed** (so config edits stick) — `pgrep -x RelicCoH2` returns nothing.
3. **The skin under test is equipped** in the correct **class × season** slot, and you will pick a
   **matching-season map** (see §2). A summer map shows a Heavy-Summer skin; mismatch = default skin
   in the capture (a *visible* false-negative, not a crash — see design §3 caveat R5).

---

## 1. Launch setup (per wiki — do not restate mechanics)

Follow **`coh2-harness-driving.md`** exactly:

1. **Render-resolution fix (CRITICAL).** While CoH2 is CLOSED, set `width = 1920`, `height = 1080`
   in `.../Company of Heroes 2/configuration_system.lua`. Without this, clicks do not map to pixels
   (wiki "CRITICAL: render-resolution must match harness window"). CoH2 overwrites this file on
   exit, so **back it up first** and set it while closed.
2. **Backup before touching anything you edit** (so teardown can restore byte-for-byte):
   - `configuration_system.lua` → `*.bak`
   - Steam launch options entry in
     `/home/jflessenkemper/.local/share/Steam/userdata/209941315/config/localconfig.vdf`
     (AppId `231430`) → back up the whole `localconfig.vdf`.
3. **Set the harness launch options** (verified string, wiki §"Steam launch options"):
   `.../AOE3DEHarness --keep-alive -W 1920 -H 1080 -w 1920 -h 1080 --backend headless --xwayland-count 1 -- %command%`
4. Launch CoH2 through Steam (`%command%` substitution — bare `umu-run` fails, per wiki).
5. Drive via the CLI wrapper `python3 /tmp/harness_cli.py {state|screenshot <p>|click <x> <y>|move|key}`.

---

## 2. Lobby click sequence — select "ASAP Verify" (design doc §5)

> **Coordinates are NOT hardcoded.** The 2026-06-24/25 session reached the main menu with the
> resolution fix but did NOT map custom-game / dropdown pixel coords (wiki "Menu navigation notes:
> incomplete", design R4). For **every** click below: take a `screenshot`, grid-overlay it, read the
> live pixel coord of the target widget, then click. Bank the mapped coords to
> `coh2-harness-driving.md` at the end (closes R4).

1. **Main menu → PLAY → CUSTOM GAME / VS AI** (skirmish setup lobby).
2. **Pick a map:** choose a **summer map** (season match, §0.3 / design R5) — prefer a small, flat
   1v1 map so the grid spawns on open ground (design R2; grid is anchored to Player 1's start).
3. **Slots:** **1 human (you) + 0 AI** — leave/close all enemy slots. This is the cleanest way to
   kill AI aggression (design §2 note) so nothing shells the grid; no AI-nerf includables needed.
4. **Game-mode / Win-Condition dropdown** (settings column, defaults to "Victory Point" /
   "Annihilation"): open it and select the entry labelled **`ASAP Verify`**. That string is the
   `fe_name` from the `.win`; the local mod auto-loads so it appears without any mod-manager step.
   - **If `ASAP Verify` is absent from the dropdown, or START fails** (design R3 — lobby may reject a
     win-condition-less `.win`): edit `scripts/build-verify-gamemode.mts`, add
     `import("winconditions/annihilate.scar")` as the first line of `SCAR_TEXT` (its `Scar_AddInit`
     coexists with ours), re-run the build script (reinstalls automatically), relaunch. ~1 min loop.
5. **START GAME.**

---

## 3. In-match: what happens automatically

On load, `Scar_AddInit(ASAPVerify_Setup)` fires and (all steps are pcall-guarded — a partial failure
still leaves a usable grid + camera):

1. Pop-cap raised, FOW revealed map-wide.
2. **Grid spawns:** up to 10 player-1 German vehicles, 5×2, 15 m spacing, anchored near Player 1's
   start (`Player_GetStartingPosition`). Classes: Tiger, Panther, Panzer IV, StuG III, Brummbär,
   Ostwind, Panzerwerfer, Sd.Kfz.251, Sd.Kfz.222, Puma. Any blueprint that fails to resolve simply
   leaves its cell empty (never crashes) — expect ≥9 vehicles.
3. **Wide shot:** ~1.5 s after spawn the camera frames the grid centre, zoomed out 4× so all 10 fit.
4. **Readiness marker:** `ASAP_VERIFY_READY` drawn top-left (`dr_text2d`) + centre (`PrintOnScreen`).
   **The harness waits for this marker (OCR) before the first screenshot.**
5. **Auto camera cycle:** after a ~10 s wide-shot hold, the camera steps close to each vehicle in
   sequence, ~6 s per vehicle (`Camera_MoveTo`), then loops back to the wide shot — no input needed.

---

## 4. Captures to take (over ONE full camera cycle)

Use `screenshot <path>` into `artifacts/ingame-verify/captures/`:

1. **Menu faceplate card** — before starting, capture the player card / faceplate (skin+insignia on
   the player emblem) at the main menu.
2. **Lobby** — the game-setup lobby with the `ASAP Verify` dropdown entry selected (proof the mode
   loaded).
3. **Grid wide shot** — the moment `ASAP_VERIFY_READY` appears: one frame of all ~10 vehicles.
4. **Per-vehicle close-ups** — let the auto camera cycle run one full pass (~60 s for 10 vehicles at
   ~6 s each). Screenshot once per vehicle when the camera settles on it (poll `state`/screenshot
   every ~2 s; capture the framed close-up). Name each by class (e.g. `tiger.png`, `panther.png`, …).
   These are the primary skin/decal verification frames.

Verify by eye in capture #3: any vehicle showing the **default** skin means the skin isn't equipped
in that class/season slot, or the map season is mismatched (design §3 / R5) — re-equip or swap map
and re-run. The screenshot IS the verification; no blind trust.

---

## 5. Teardown / restore (always run, even on failure)

1. **Exit the match** (or just quit CoH2) and fully close CoH2 (`pgrep -x RelicCoH2` empty).
2. **Kill the harness stack** using the wiki's exact-name recipe (NOT `pkill -f` — pgrep footgun):
   `for p in $(pgrep -x AOE3DEHarness); do kill -9 $p; done` then the same for
   `gamescope` / `gamescope-wl`; `rm -f /tmp/AOE3DEHarness.sock`.
3. **Restore backups** (§1.2): `configuration_system.lua` ← `*.bak` (while CoH2 closed) and
   `localconfig.vdf` ← backup (so the harness launch-options swap is reverted).
4. **Leave the mod in place.** The installed SGA at
   `mods/gamemode/a5a90ec1f00f4b7e9c0d3a2b1e4f5a60.sga` is a local test mod — harmless, only appears
   as an optional dropdown entry. Delete it only if you want a clean lobby.
5. **Bank findings to the wiki:** the mapped lobby/dropdown pixel coords (closes R4), whether the
   `.win` needed the annihilate import (R3), grid-on-map behaviour at Player 1 start (R2), and
   whether skins rendered on script-spawned squads (confirms design §3). Update
   `coh2-harness-driving.md` + create/extend a `coh2-ingame-verify` concept page.
