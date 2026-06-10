# OPEN-LOADING — What is the loading screen after "Continue"?

## 1. What does the user click?

The "Continue" button is in `src/components/StartScreen.tsx` (~line 185):

```tsx
onClick={() => {
  if (lastEdited.kind === 'skin') onContinueSkin(lastEdited.project)
  …
}}
```

`onContinueSkin` maps to `openSkin` in `src/App.tsx` (lines 231–237):

```ts
const openSkin = (project: Coh2SkinProject) => {
  persistActive(project)
  editorLoadStartRef.current = Date.now()
  setPhase('editor-loading')
  // No fixed timeout — the Editor's onReady callback drives the transition
}
```

`phase` immediately becomes `'editor-loading'`.

## 2. What loading screen renders?

**Component: `AuthShell`** (`src/components/AuthShell.tsx`, line 230):

```ts
const isLoading = phase === 'editor-loading'
```

When `isLoading` is true, `AuthShell` renders:
- A `<LoadingBorder>` — the animated SVG beam tracing the card perimeter (duration 2.4 s, line 370–375)
- The ASAP logo, translated/scaled to card-centre via a FLIP morph (lines 411–463)
- All card content (eyebrow, body area) faded to `opacity: 0` / `visibility: hidden` (lines 478–513)

So the "loading screen" is not a separate component — it is `AuthShell` itself locked into its `editor-loading` visual state: a centred animated logo inside a marching-beam border, sitting on top of the invisible `Editor` below it.

## 3. What is it blocking on?

The loading screen stays until `onEditorReady()` fires in `App.tsx` (line 347–350):

```ts
const onEditorReady = useCallback(() => {
  const elapsed = Date.now() - editorLoadStartRef.current
  window.setTimeout(() => setPhase('editor'), Math.max(0, EDITOR_LOADING_MIN_MS - elapsed))
}, [])
```

`onEditorReady` is called by `onReady` prop on the hidden `Editor`. Inside `Editor`, `onReady` is triggered by `fireReady()` in the `onModelLoaded` callback (`src/components/Editor.tsx`, lines 1343–1441):

**Phase B — GPU fleet warmup (the actual blocker):**

On the FIRST `onModelLoaded` after mount, `factionPreloadFiredRef` gates a full-fleet warmup loop. `fireReady()` is withheld until **every vehicle across every faction** is built into the Three.js GPU cache:

```ts
// Editor.tsx lines 1348–1438
// FULL warmup — runs once per session …
// holds off fireReady() until the WHOLE fleet finishes
if (!factionPreloadFiredRef.current) {
  factionPreloadFiredRef.current = true
  const q = [...currentFaction, ...rest]  // ALL vehicles except the active one
  // … parallel lane drain, fireReady() only when ++completed >= total
}
```

This covers **61 vehicles** (all five factions): `VEHICLES.length` (vehicles.ts line 44, confirmed by grep count = 61), minus the one already displayed = 60 background GPU builds.

**Phase A (disk I/O) is gone:** Each `buildVehicleIntoCache` call in `Viewport.tsx` (line 4183–4206) first checks `getPreloadedArchive()` and `getPreloadedBytes()` before touching disk. The Connect `'preloading'` phase preloaded all factions' RGM bytes into `bytesCache` (ConnectScreen.tsx lines 134–168), so **disk reads are skipped here**. Only GPU mesh parse + texture decode + shader compile remain.

**EDITOR_LOADING_MIN_MS guard:** Even if the warmup finishes in under 620 ms, `onEditorReady` enforces a minimum hold of 620 ms (App.tsx `EDITOR_LOADING_MIN_MS = 620`, line 93) to avoid cutting the FLIP animation short.

**Critical re-mount issue:** The hidden `Editor` at `phase === 'editor-loading'` (App.tsx line 460) and the visible `Editor` at `phase === 'editor'` (line 486) are **two separate JSX elements in two different render branches**. When `phase` transitions from `editor-loading` → `editor`, React unmounts the first `Editor` and mounts a brand-new one. That new instance has `factionPreloadFiredRef.current = false` and `readyFiredRef.current = false`. However, since all vehicles are already in the Three.js `pinnedVehicleCache`/`vehicleGroupCache`, `buildVehicleIntoCache` returns immediately at the early guard (Viewport.tsx line 4140), so `fireReady()` fires quickly the second time. The warmup itself does not repeat.

**The `readyFiredRef` is per-instance.** Each fresh `Editor` mount resets it. So `factionPreloadFiredRef.current === true` inside that second Editor — the `else` branch at line 1439–1442 runs and calls `fireReady()` immediately on first `onModelLoaded`.

Summary of stacked phases for a FIRST open after Connect:

| Phase | Blocking on | Benefits from bytesCache? |
|---|---|---|
| B1 — first vehicle GPU build | Viewport `onModelLoaded` fires | Yes (bytes warm) |
| B2 — fleet warmup (60 vehicles) | All `buildVehicleIntoCache` complete | Yes (bytes warm, no disk) |
| B3 — minimum FLIP guard | `EDITOR_LOADING_MIN_MS` (620 ms) | N/A |

For a SECOND open (back to Start, then Continue again): only B1 + B3 apply — the warmup branch fires `fireReady()` immediately because `factionPreloadFiredRef` is fresh on the new Editor instance but the vehicle cache is already full, so all 60 background builds return at the top-of-function cache check near-instantly.

## 4. How many vehicles / does bytesCache help?

- 61 total vehicles across 5 factions (german/west_german/soviet/aef/british), 60 background GPU builds.
- ALL factions are warmed (not just the pack's faction) — the comment at Editor.tsx line 1349: "EVERY vehicle of EVERY faction".
- `bytesCache` IS used: `buildVehicleIntoCache` calls `getPreloadedBytes()` → finds warm bytes → skips disk. Only GPU-side work remains.
- `getPreloadedArchive()` is also checked, so SGA TOC parses are shared.

## 5. Is the loading screen tied to vehicle warmup?

Yes, entirely. `fireReady()` is the only path to `onReady()` → `onEditorReady()` → `setPhase('editor')`. There is no independent loading screen; the AuthShell `editor-loading` state exists solely to cover the GPU warmup. With zero vehicles (impossible in practice) and a warm cache (instant builds), only the 620 ms minimum guard would fire.

## Reducibility

Options ranked by value/risk:

**Option 1 — Fire `onReady` immediately, warm GPU in the background (highest-value, lowest-risk)**
Allow `fireReady()` to call after the first vehicle renders, before the fleet warmup completes. Set `factionPreloadFiredRef = true` and continue building in the background. The editor is visible; the VehicleMenu pills for unbuilt vehicles simply show their normal per-click load time (currently ~0 ms once the phase-B change lands on a warm cache, but may flash a loading border for the first click). Risk: vehicles not yet warmed show a brief in-editor loading beam on first switch, exactly as before the warmup feature existed. Low risk.

**Option 2 — Limit warmup to the pack's faction only**
`openSkin` already receives the project; the project knows its faction. Pass `initialFaction` to the hidden Editor and only warm that faction's ~10–14 vehicles. Other factions warm lazily on first click. Cuts warmup work by ~75 %. Risk: cross-faction vehicle switching has a loading beat on first access. Medium risk (violates the "no loading except at Connect" directive).

**Option 3 — Move GPU warmup to Connect**
During the `'preloading'` phase in ConnectScreen, also spin up a hidden off-screen WebGL renderer and run `buildVehicleIntoCache` there. This is architecturally complex (Viewport expects a mounted canvas in the DOM with React state; replicating that in ConnectScreen is a large refactor) and the WebGL context budget is limited. High risk.

**Option 4 — Extend EDITOR_LOADING_MIN_MS to cover typical warmup time, but reveal sooner**
This is the same as Option 1 framing — it only reduces the minimum guard, not the actual warmup. Not independently useful.

**Recommended:** Option 1. Call `onReady()` as soon as the first `onModelLoaded` fires (i.e., after `setVehicleLoading(false)` and before the warmup loop), and continue the fleet warmup behind the now-visible editor. In-editor first-switch cost on unwarmed vehicles is the same warm-cache GPU cost that already happens today — just paid on first click instead of at load time.
