# REVIEW2 — Round-2 work packages (W1–W4)

Scope: ONLY the round-2 hunks (lighting split + repaint-on-visible, export button + accent, SGA .info enumeration + decal opener, VTE pan-zoom chrome). Suite 1837/1837 green, tsc clean at review time. No source edits made.

---

## BLOCKER

### B1 — W4: Pan gestures paint on the canvas (data corruption + stuck brush)
**Files:** `src/components/VehicleTextureEditor.tsx:235-260` (canvas `onPointerDown`), `src/lib/use-pan-zoom.ts:213-229` (container pan handler).

The VTE canvas fills the pan-zoom container, so every pan gesture starts on the canvas. Canvas `onPointerDown` has **no `e.button` check and no space-held awareness** — it unconditionally calls `p.onStrokeBegin()` + `paintBrushDab()` + `setPointerCapture`. The hook's pan handler runs later (bubble phase) on the container. Consequences for BOTH advertised gestures (`Space + drag — Pan`, `Middle-drag — Pan` in the new VTE_SHORTCUTS help):

1. A paint dab is committed at the pan start point and an undo frame is opened.
2. The container's `setPointerCapture` (use-pan-zoom.ts:227) steals capture from the canvas, so the canvas never receives `pointerup` → `endStroke` never runs → `paintingRef` stays `true` → the **next** hover over the canvas continues painting with no button held, until the user clicks.

**Fix sketch:** (a) in canvas `onPointerDown`, `if (e.button !== 0) return` early; (b) expose pan-intent from the hook (e.g. return `isPanGesture: (e) => spaceHeldRef.current || e.button === 1` or a `spaceHeld()` accessor) and guard the canvas handler with it; (c) belt-and-braces: reset `paintingRef` in `onPointerLeave`/`lostpointercapture`. The new `use-pan-zoom.test.ts` covers pure math only — add one integration test for "middle-down on canvas does not begin a stroke".

---

## MAJOR

### M1 — W1: Faction light boost silently lost when the heavy preset effect re-runs alone (dep-set mismatch)
**Files:** `src/components/Viewport.tsx:2105-2533` (heavy effect, deps `[preset, root, season, _envName, fog]`) vs `:2541-2576` (boost effect, deps `[preset, season, vehicle?.faction]`).

Ruling on the suspected **async race: NOT real.** The heavy effect tears down and rebuilds the HemisphereLight **synchronously** (2128-2139) and sets base exposure synchronously (2125); its async IIFE (2294-2524) touches only cubemap/PMREM/`scene.environment` — never lights or `toneMappingExposure`. Declaration order heavy→boost is correct, so any shared-dep change (preset/season) re-applies the boost after the rebuild.

**The real bug is the dep mismatch:** `root`, `_envName`, `fog` are in the heavy deps but not the boost deps. If any changes *alone*, the heavy effect resets exposure to base and installs a fresh base-intensity hemi, and the boost effect does **not** re-run → UK/US dark until a faction/preset/season change. Today this is *latent*: `fog` is never passed by Editor (Editor.tsx:1495 comment), `envName` only changes together with `season` (handleSeasonChange F2a, Editor.tsx:303), and a `root` change goes through a phase remount. But `setEnvName` is already plumbed into TopBar's ScenePanelBody (Editor.tsx:1735) — the moment that panel (or any env picker / fog toggle) becomes reachable, the boost silently dies.

**Fix sketch:** make the heavy effect boost-aware instead of boost-ignorant: keep a `factionRef` updated each render, extract `applyFactionBoost(renderer, lightsGroup, effectivePreset, factionRef.current)` and call it at the end of the heavy effect AND from the lightweight effect. Idempotent (absolute base×boost), no extra re-renders, no dep coupling. Note `FactionLightBoost.test.ts` pins only the formula, not the wiring — it cannot catch this.

### M2 — W3: `readInfoFromSga` reads the ENTIRE archive synchronously on the main process
**File:** `electron/detect-coh2.ts` (`readInfoFromSga`, first line: `buf = fs.readFileSync(sgaPath)`).

The doc comment and the IPC comment in `electron/main.ts` claim "only the TOC + single .info file are read; cheap" — false: `readFileSync` loads the whole `.sga` into a Buffer. Skin packs are routinely tens-to-hundreds of MB; `mods/skins/` with a dozen subscriptions means hundreds of MB of synchronous main-process I/O + allocation on the **first** `list-installed-packs` call (and again per pack whenever mtime changes). Main process blocked = frozen window chrome/IPC. The mtime cache only amortises subsequent calls.

**Fix sketch:** `fs.openSync` + `fs.readSync` exactly: (1) 152-byte header, (2) `headerSize` TOC bytes at 152, (3) the `.info` range `dataPos+fDataPos .. +storeLen` (it's <1 KB). Three pread-style reads, no full-file Buffer.

---

## MINOR

### m1 — W3: `'unknown'` arm in the decal opener filter is dead code (suspicion 3)
`src/components/TemplateDecalPills.tsx:172` filters `p.type === 'decal' || p.type === 'unknown'`, but `listInstalledPacks` (`electron/detect-coh2.ts`) substitutes the dir-based `defaultType` whenever TOC inference yields `'unknown'` — the IPC can never emit `'unknown'`. Remove the arm (or document it as future-proofing). Verdict on the leak itself: **cannot leak today** — junk/foreign SGAs in `decals/subscriptions/` surface as `'decal'` (acceptable: that dir is decal-only by CoH2 convention, matches `mods-wipe.ts` layout), `mods/skins/` junk becomes `'skin'` (excluded), faceplates classify via `attrib/faceplate/` (our builder writes it — `faceplate-mod-build.ts:157`) or dir default (excluded).

### m2 — W3: first-match-wins type classification is TOC-order dependent
Both `readInfoFromSga` (electron) and `inferPackTypeFromPaths` (`src/lib/installed-pack-info.ts:58-69`) break on the first path matching ANY pattern. A pack containing e.g. both `/badges/` and `attrib/skin_pack/` classifies by whichever appears first in the TOC. No current builder emits such packs, but make priority explicit (scan all paths; skin > faceplate > decal).

### m3 — W3: parser/classifier logic duplicated electron-side vs renderer-side
`readInfoFromSga` re-implements `parseInfoName` (same regex) and `inferPackTypeFromPaths` inline. The renderer copies are unit-tested; the electron copy (the one actually serving the IPC) is not. Extract to a shared module or add a Node-side test. (SGA v7 offsets in the electron parser — header 152, headerSize@140, dataPos@144, file stride 30, storage@+21, names relative to namePos@toc+24 — verified consistent with the proven parser in `src/lib/sga.ts:106-156`.)

### m4 — W3: minor IPC/cache hygiene
`ipcMain.handle('list-installed-packs')` (`electron/main.ts`) passes renderer-supplied `modsRoot` straight into `path.join` with no `typeof === 'string'` guard (non-string → rejected promise; harmless but noisy). `packCache` never evicts entries for deleted files (unbounded, trivial leak).

### m5 — W2: accent literal hardcoded instead of the existing token
`BrushPanel.tsx:233`, `TopBar.tsx:502,1806,1875` and `VehicleTextureEditor.tsx` PeelSlider hardcode `'rgba(120,180,255,0.95)'` — that exact value already exists as `EDITOR_ACCENT` in `editor-primitives/tokens.ts:42`. Import the token (5 call sites) so a future accent change doesn't fork.

### m6 — W2: dead `setActivePanel('export')` link inside unreachable ViewPanel
`TopBar.tsx:599` opens the export panel from inside ViewPanel — but nothing ever sets `activePanel='view'` (verified: the only `setActivePanel` callers repo-wide are the new export button, Editor.tsx:413 `null`, Editor.tsx:1350 `'decals'`). Pre-existing at HEAD (not a round-2 regression), as is the broader orphaning of view/scene/camo/parts/reference/brush panels — but the dead link should go when the button is rehomed (see suspicion 4 below).

### m7 — W4: space-pan latch can stick across focus loss
`use-pan-zoom.ts:156-183` — `keyup` for Space is missed if the user releases it while the window is unfocused (alt-tab), leaving `spaceHeldRef=true` → next left-drag pans instead of painting until Space is tapped. Add a `window 'blur'` listener that resets the latch. Cosmetic sibling nit: `VehicleTextureEditor.tsx` canvas style `cursor: tool === 'pick' ? 'crosshair' : 'crosshair'` — pointless ternary.

---

## Suspicion verdicts (1–5)

1. **Lighting race — NO async race; YES latent stale-boost bug.** The async cubemap path never touches lights/exposure; rebuild is synchronous and ordered before the boost effect. But the heavy effect's extra deps (`root`, `_envName`, `fog`) can reset boost without re-triggering it (M1). No live UI path triggers it *today*; fix is cheap and should land before any env/fog UI does.
2. **Repaint-on-visible — SUFFICIENT.** Editor is hidden via `opacity:0`/`pointerEvents:none` only (Editor.tsx:1487), mounted from `editor-loading` onward (App.tsx:549-556, single stable element). Full layout size exists while hidden → ResizeObserver reports real dims, the RAF loop keeps running, and the vehicle build effect has no visibility gate. The model builds and renders behind the loading screen; the `[visible]` effect (Editor.tsx:1461-1471) re-binds the overlay on reveal. Vehicle reliably appears with zero interaction.
3. **'unknown' leak — CANNOT HAPPEN via this IPC.** `defaultType` substitution means `'unknown'` never reaches the renderer; the filter arm is dead (m1). Dir-scoped enumeration (`decals/subscriptions` only for decals) is exactly what kills the old "every workshop item" junk list. Residual risk limited to TOC-order mistyping (m2), not reachable with packs any known builder produces.
4. **Export reachability — NOT independently reachable; do NOT just delete the button.** There is no panel-toggle group; the new left:56 button is the *only* live entry to ExportPanel (the ViewPanel link is dead code, m6). Recommendation: honour the user's "get rid of it" by removing the standalone button AND rehoming export in the native pattern the sibling editors already use — either a publish/export section reached from the EditorTitlePill (FaceplateEditor's PublishSection pattern) or Live Sync auto-install (DecalPackEditor.tsx:1196: "Export removed — Live Sync handles it automatically"), keeping `ExportSkinPackButton` as the section body. Delete TopBar:599 with it.
5. **VTE fit-init — CORRECT.** The pan-zoom container is the root `fixed inset-0` div (full window); all toolbars float above it (`position:fixed`), consuming no layout. So `window.innerWidth/Height` equal the container's box and `fitScale` centering is exact (pinned by `use-pan-zoom.test.ts` "VTE initial state" cases at 1920×1080 and 1280×800). Only nit: no auto re-fit on window resize while open — Ctrl+0 covers it.

## Walkthrough-risk notes (non-blocking)
- First open of the decal dropdown on a machine with many large skin subscriptions will hitch the whole app window (M2) — worth fixing before the walkthrough.
- The export button at left:56 currently reads as a bare icon with no label; if it survives until the walkthrough the user will likely re-flag it (suspicion 4 recommendation).
- `KeyboardShortcutsOverlay` Esc handling is correct (overlay closes itself; VTE skips `onBack` while open — no double-close).
