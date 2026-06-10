# Renderer Lifecycle — Connect-Phase GPU Warmup

## Recommended Architecture: C (Relax renderer guard, CPU-only warm at Connect)

**One-line reason:** The renderer guard at `Viewport.tsx:4141` blocks the pure CPU path unnecessarily; the Editor's `<Editor visible={false}>` instance already mounts during `editor-loading` and creates a real renderer — so the guard relaxation is tiny and the existing architecture already delivers what we need for zero-lag opens.

---

## Phase Machine Summary (`App.tsx:74–543`)

| Phase | What renders |
|---|---|
| `probing` | AuthShell + "Loading…" spinner |
| `connect` | AuthShell + `<ConnectScreen>` |
| `start` | AuthShell + `<StartScreen>` |
| `saved-projects` | AuthShell + `<SavedProjectsList>` |
| `editor-loading` | AuthShell (FLIP animation) **+ hidden `<Editor visible={false}>`** |
| `editor` | Full-screen `<Editor>` (no AuthShell) |
| `faceplate` | Full-screen `<FaceplateEditor>` |
| `decal-pack` | Full-screen `<DecalPackEditor>` |

There is NO persistent shell component that spans ALL phases. AuthShell (`inAuthShell` block, `App.tsx:365–479`) is torn down when `phase` leaves its set, and the full-screen editors replace it entirely. The `installRoot` handle IS persistent state (never cleared on disconnect-to-start), but no renderer lives there.

Key callbacks:
- `openSkin` (`App.tsx:231`): calls `setPhase('editor-loading')` synchronously; no fixed timer — `onEditorReady` drives the `editor` transition.
- `onEditorReady` (`App.tsx:347`): fires on first `onModelLoaded` from Viewport, then `setPhase('editor')` after `Math.max(0, EDITOR_LOADING_MIN_MS - elapsed)` (`EDITOR_LOADING_MIN_MS = 620`).
- Hidden Editor mount: `App.tsx:460–468` — `{phase === 'editor-loading' && installRoot && <Editor root={installRoot} visible={false} onReady={onEditorReady} />}`.

---

## Viewport Renderer Lifecycle (`Viewport.tsx`)

- Renderer created: `Viewport.tsx:877` — `new WebGLRenderer({ canvas: canvasRef.current, ... })` inside `useEffect` guarded only by `canvasRef.current`.
- Canvas element: `Viewport.tsx:4649` — `<canvas ref={canvasRef} className="w-full h-full block">`. Requires a real DOM canvas; a `display:none` or zero-size canvas CAN receive a WebGL context (spec-compliant), but `OrbitControls` constructor at `Viewport.tsx:960` attaches listeners to the canvas element — harmless if no user input arrives.
- Camera: `Viewport.tsx:947` — `new PerspectiveCamera(38, 1, 0.1, 2000)`. Created in the same `useEffect` as the renderer; no resize logic blocks it from being created with a 1:1 aspect on a hidden canvas.
- `buildVehicleIntoCache` guard: `Viewport.tsx:4141` — `if (!rendererRef.current || !cameraRef.current) return`. The camera check is purely defensive (it's always set in the same effect as the renderer). The renderer check is the live gate.

**Could a Viewport be mounted hidden?** Yes. `Editor.tsx:1238` already does this — `opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none'`. The canvas is physically in the DOM at full `h-dvh w-full` even when opacity=0, so the renderer context is valid and `compileAsync`/`initTexture` work normally.

**Viewport props for headless/hidden use:** No dedicated `headless` prop exists. The `vehicle` prop can be set to `null` (passes `hideTank ? null : vehicle` at `Editor.tsx:1252`), which suppresses model loading. The `controlsEnabled={false}` prop (`Viewport.tsx:134`) disables user orbit without killing the renderer.

---

## Editor hosts Viewport (`Editor.tsx:1249–1465`)

- Viewport is lazy-imported (`Editor.tsx:11`): `const Viewport = lazy(() => import('./Viewport'))`.
- `preloadRef={viewportPreloadRef}` (`Editor.tsx:1463`) wires `buildVehicleIntoCache` back to the Editor's `viewportPreloadRef` (`Editor.tsx:1219`).
- The faction-first fleet warmup runs from inside `onModelLoaded` (`Editor.tsx:1388–1429`): after the first vehicle renders, a `LANES=2` pump drains a queue of all 60 remaining vehicles using `requestIdleCallback`. This already runs during `editor-loading` (hidden Editor) — the fleet warms behind the FLIP animation.
- The hidden-Editor instance is TORN DOWN when phase transitions from `editor-loading` → `editor` (it leaves the `inAuthShell` block), and a NEW full-screen `<Editor>` mounts at `App.tsx:482`. This is the **context-loss event**: the hidden renderer is disposed, all GPU state it compiled is gone, and the new Editor's Viewport creates a fresh context.

---

## Architecture Evaluation

### A — Hidden Viewport at Connect
**What it takes:** Mount `<Viewport>` (or `<Editor visible={false}>`) during the `'preloading'` or `'connect'` phase in `App.tsx`. Requires passing `installRoot` (available after `onConnected` callback), a `vehicle` prop (could be any spec or null if guard is relaxed), and all the required Viewport props (`season`, `selectedPart`, `explodeAll`, `envArchive`, `envName`, `preset`).

**Problem:** `installRoot` is null during `preloading` — it is set by `onConnected` which fires AFTER the `preloading` phase completes (`ConnectScreen.tsx:172`). So a Connect-phase Viewport can only mount AFTER `onConnected`, meaning `phase === 'start'`. This is feasible but adds a Viewport to StartScreen, and — critically — it would be torn down again when `editor-loading` mounts the Editor's own Viewport. **Same context-loss problem as today.**

### B — Persistent Hoisted Viewport
**What it takes:** Move the `<Viewport>` out of Editor and into App, keep it mounted across all phases, pass it down to Editor as a prop or context. **Substantial refactor** — Viewport is tightly coupled to Editor's `onModelLoaded`, `overlayCanvas`, `overlayVersion`, `preloadRef`, and a dozen other Editor-specific callbacks. The module-level `vehicleGroupCache`/`pinnedVehicleCache` are renderer-portable (CPU data), but the GPU state (`compileAsync`, `initTexture`) IS tied to a specific WebGL context. A hoisted Viewport solves context continuity but requires threading all Editor callbacks up to App — a large blast radius.

### C — Relax renderer guard + CPU warm during Connect preloading ✓ RECOMMENDED

**What it takes:** One-line change at `Viewport.tsx:4141`:

```
// Before:
if (!rendererRef.current || !cameraRef.current) return

// After (CPU path only, defer GPU to first draw):
if (!cameraRef.current) return  // renderer guard removed for CPU build
// Then at the compileAsync/initTexture block (~line 4600):
if (rendererRef.current) {
  await rendererRef.current.compileAsync(stagingScene, cameraRef.current!)
  // ... initTexture calls ...
}
```

Then expose `buildVehicleIntoCache` at module level (or via a standalone export) so it can be called from `ConnectScreen`'s `preloading` phase without mounting any Viewport. The CPU build (parse RGM, decode textures, build `THREE.Group`, fill `pinnedVehicleCache`) runs entirely during the Connect spinner where the user is already watching progress. The GPU step (shader compile + texture upload) happens cheaply on first draw in the Editor's own renderer — a ~1–2 frame hitch vs. the current full cold load.

**Why this is lowest risk:**
- No component tree changes, no new renderers, no context-limit exposure.
- `vehicleGroupCache`/`pinnedVehicleCache` are module-level and renderer-portable — verified by prior investigation.
- The existing `eager=true` path already bypasses the idle gate; the same batch can run during `preloading` with `installRoot` available post-`onConnected`.
- The GPU re-upload on first draw is cheap: Three.js uploads textures lazily on first `renderer.render()` call; the main-thread cost is a single `compileAsync` per vehicle which is already deferred there.

---

## Exact Insertion Point

**File:** `src/components/ConnectScreen.tsx`
**Phase:** `'preloading'` (already exists, `ConnectScreen.tsx:144`)
**Function:** Inside `connect()` async function, after `setPhase('preloading')` and the existing `preloadFaction` `Promise.allSettled` block, or in parallel with it.

**Mechanism:** Extract `buildVehicleIntoCache`'s CPU-only path into a standalone async function (`buildVehicleCpuOnly(spec, root)`) exported from `Viewport.tsx` (or a new `vehicle-warmer.ts` lib). Call it for all 61 vehicles in the same `Promise.allSettled` batch that already drives `setLoadProgress`. Existing progress counter covers it.

**Throttling:** The existing `fractionByFaction` aggregation in `ConnectScreen.tsx:147–167` already limits re-renders; CPU builds are I/O-bound (SGA reads) and run naturally in parallel. No additional frame-budget logic needed — the user is watching the Connect spinner, not the editor.

---

## Top Lifecycle Hazard

**WebGL context loss on Editor remount (context limit).** The hidden Editor during `editor-loading` creates one WebGL context; the full-screen `<Editor>` at `phase === 'editor'` creates a second. Most browsers allow 8–16 simultaneous contexts, but the hidden context is created and destroyed at EVERY `editor-loading → editor` transition (App.tsx tears down the `inAuthShell` subtree). Each cycle risks a one-frame context-exhaustion warning on low-end hardware. If Approach C is taken (no extra Viewport at Connect), this hazard is unchanged from today. If Approach A or B adds a third concurrent renderer, the risk becomes real.

With Approach C, the only hazard is that `buildVehicleCpuOnly` leaks `THREE.Group` memory if `pinnedVehicleCache` is never consumed (e.g. user navigates away without opening the Editor). Mitigation: cap the pinned cache at `VEHICLES.length` (already done by the existing `pinnedVehicleCache` map) and ensure the CPU-built groups are disposed on page unload.
