# CoH2 Community Modding Tool — working rules

Electron + React + TypeScript + Three.js + Konva. Authors CoH2 vehicle skins, decals and
faceplates by writing proprietary binary formats (SGA archives, RGT/BC1/BC3 textures, RGM
models, SCAR mods). Output must be byte-correct or the game rejects or misrenders it.

Every rule below exists because its absence already cost real time on this project.

---

## 1. The instrument rule — non-negotiable

**No measurement is trusted until the instrument is shown to discriminate.**

Five separate failures here were the same mistake on different surfaces: trusting a reading
without ever proving it could have come out differently.

- **New or changed test** — paste the RED run from before the fix. A test that was never
  seen failing is not evidence. (A regression test here once passed both before and after
  the bug was reintroduced, because it lacked the context that triggered it.)
- **New threshold** — paste the measured unrelated-pair baseline AND a self-vs-self sanity
  row. A metric scoring 0.47 on unrelated inputs makes any gate below 0.5 unfailable.
  Gates here were once set 5–12× too loose, then too tight (16 false failures).
- **Render / capture claim** — paste the before and after output hashes. A camera override
  once rendered **byte-identically** with and without the override; it looked correctly
  wired and did nothing.
- **Every verification result ends with a `Not proven by this work:` section.** Layer C
  proves colour transport, not geometry and not shader equality. Say so up front, not
  retroactively.

## 2. Deploy, or the user cannot see your work

The user runs the **deployed AppImage**, not the dev build.

```bash
npm run electron:build && install -m 755 "release/CoH2 Skin Editor-1.1.0.AppImage" \
  ~/.local/bin/coh2-community-modding-tool.AppImage
```

Check the exit code — a failed build silently leaves the previous artifact in place.
Then confirm the title bar SHA matches `git rev-parse --short HEAD`. The window title
carries `1.1.0 · <sha>` for exactly this reason (`src/build-info.ts`), and `-dirty` means
the build came from uncommitted source.

## 3. Process teardown — three traps, all hit repeatedly

- **`pkill -f <pattern>` matches the calling shell** whenever the Bash command text
  contains the pattern. It kills itself mid-script, surfacing as exit 1/144 and files that
  were never written. Hit four times in one session.
- **The AppImage re-execs** as `/tmp/.mount_coh2-<rand>/coh2-skin-editor`, matching neither
  "coh2-community" nor "AppImage". And `comm` is capped at 15 chars, so the name is
  `coh2-skin-edito`. The only correct form is `pkill -9 -x coh2-skin-edito`.
- **`pkill -x kwin_wayland` also matches the user's desktop compositor.** Kill the nested
  session by the PID captured at launch, never by name.
- Wine processes belong to whichever prefix launched them — check
  `tr '\0' '\n' < /proc/<pid>/environ | grep compatdata/` before killing. CoH2 is `231430`;
  a blind `wineserver` kill drops whatever game the user is playing.

## 4. Never guess

Never invent an API name, file path, config key, vehicle/faction id or version. Grep, read
the file, or run the command first. Cite `file:line` for every code claim. "Let me check"
beats a plausible wrong answer — plausible-wrong is the expensive failure mode here.

## 5. Verification layers

- **A — texture bytes.** Texel-exact after BC round-trip. Per-channel, never luminance
  (luminance-only edge detection produced 1200 phantom defects on iso-luminant chroma).
- **B — armor protection.** The camo mask must not erase armour.
- **C — editor vs engine.** Colour transport only. Compare each render to ITS OWN source
  texture; a direct editor-vs-game comparison needs a matched camera AND a matched skin.
- **D — in-game ground truth.** Requires the running game.
- **E — app correctness.** Ordinary unit tests.

Run `/verify-unwrap` for the analytical layers.

## 6. Screenshots: judge behaviour, not colour

Captures via the nested KWin session are ~2× darker than reality (mean 28 vs 51) because
colour management is not negotiated there. Use them for *did the click land, did the menu
advance*. For anything about brightness, contrast or colour, use the app's own
`capturePage` harness (`npm run verify:visual:capture`, `AUDIT_CAPTURE=1`) or a real
display. A nested capture once nearly caused a deliberate design decision to be reversed.

## 7. Product invariants

- **No save / export / sync buttons.** Everything auto-syncs via `persistActive(project)`.
- **"Synced" is not "visible in game."** CoH2 requires the skin to be EQUIPPED, and the
  equipped loadout is server-side and encrypted — the app cannot do it. See `EQUIP_HINT`
  in `src/lib/live-sync.ts`.
- Faction-first creation flows; dark UI; Inter for type.
- Never paint tracks, wheels or stowed equipment — mask them out of camo.

## 8. Durable knowledge goes to the wiki

`/var/home/jflessenkemper/llm-wiki` — search it BEFORE debugging (`grep -ril '<keywords>'`),
and write back anything durable: solved bugs, dead ends, exact coordinates, gotchas.
Re-deriving something already written down is a process failure, not diligence.
