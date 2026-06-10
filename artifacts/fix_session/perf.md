# Performance Investigation — CoH2 Skin Editor

## Q1: Is the cache actually hit on vehicle switch?

**Partially yes, but with a mandatory IPC round-trip before the check.**

`Viewport.tsx:2119` — the main vehicle-load `useEffect` deps are `[root, vehicle?.id, showDestroyed]`. When `vehicle?.id` changes it runs immediately. The fast-path cache check at line 2159 IS consulted:

```ts
// line 2128-2129 — BEFORE cache check
const archives = await locateArchives(root)
```

`locateArchives` (coh2-fs.ts:206–228) walks the FileSystem Access API directory tree with up to 4 `getDirectoryHandle` IPC calls. **This runs on every vehicle switch, even when the cache will hit.** The cache check at line 2159 only executes after that async traversal completes.

```ts
// line 2157-2159
// ── Group cache hit — fast path ──────────────────────────────────────
const cachedEntry = pinnedVehicleCache.get(vehicle.id) ?? vehicleGroupCache.get(vehicle.id)
if (cachedEntry) {
```

**Fix:** Hoist `locateArchives` result to a ref that is populated once (on first successful load) and reused. The directory handle does not change between vehicle switches.

Old (~line 2128):
```ts
const archives = await locateArchives(root)
```
New: cache result in a module-level or useRef variable, e.g.:
```ts
if (!archivesHandleRef.current) archivesHandleRef.current = await locateArchives(root)
const archives = archivesHandleRef.current
```
Then the fast-path at line 2159 fires after at most one IPC round-trip total across the whole session.

## Q2: Heavy work blocking rotation

Two issues:

**a) `decodeRgt` (header parse) is synchronous on the main thread** even when `decodeRgtOffThread` is used for pixel decode. `decodeRgt` is called at line 2473 (diffuse), 2560/3377 (normals via `rgtToCompressedTexture`), and 3938/4048 (preload path). The header parse is fast but the call happens inside `run()` which is an async function running on the main-thread microtask queue. Between `await` yields the main thread is busy parsing and Three.js's rAF can't tick.

**b) `compileAsync` + `initTexture` (lines 3217–3239) block first render.** These are GPU operations on the main thread. `compileAsync` can take 100–500 ms on complex materials. During this window OrbitControls input events queue but the render loop (`needsRenderRef.current = true`) is set only AFTER the compile finishes (line 3191 area). The user perceives rotation stutter.

**Fix for (b):** Move the `compileAsync`/`initTexture` warmup into the preload path (already done at line 4161 for the background preloader). For the live load path, consider skipping `compileAsync` if a cached entry exists (since shaders are already compiled); or run it after `scene.add(group)` so the vehicle appears immediately, even if the first frame has a GPU hitch.

## Q3: Warmup gating — does preload fire?

`Editor.tsx:1271–1272`:
```ts
((navigator as { deviceMemory?: number }).deviceMemory ?? 4) >= 4
```

On Linux/Electron `navigator.deviceMemory` is likely **undefined** (Chromium exposes it only on Android and some Chrome Desktop builds; Electron does not polyfill it). The `?? 4` fallback evaluates to `4 >= 4 = true`, so **the gate passes** and preload fires.

`requestIdleCallback` is available in Electron's Chromium runtime, so the idle queue works correctly.

**However:** the preload queue fires AFTER the first `onModelLoaded` callback, which itself happens AFTER the initial heavy load (skin pack open). So during initial load — when the user is complaining about lag — no preloading has occurred yet. The preloader cannot help with opening lag.

## Q4: PMREM recomputed per vehicle switch?

No. `pmremCache` (line 525) is keyed by `"${preset.id}:${season}"` (line 2027) and consulted before any PMREMGenerator work (line 2028–2030). The PMREM env is only rebuilt when the key is absent (first time per preset+season combo). Vehicle switches do NOT recompute PMREM. **This is not a bug.**

---

## Prioritized Root Causes

### (a) Load lag + rotation stutter during initial open

1. **[HIGH] `locateArchives` IPC on every switch** — `Viewport.tsx:2128`. Walk-dir IPC runs even on cache-hit switches. Fix: cache the result in a ref after first success.
2. **[HIGH] `compileAsync` blocks render loop** — `Viewport.tsx:3222`. GPU shader compile runs synchronously in the async task, blocking OrbitControls response. Fix: schedule it after `scene.add(group)` so the model appears first; or skip compile if the vehicle group came from cache (shaders already compiled).
3. **[MED] Normal map decode is synchronous** — `Viewport.tsx:2560`, `rgtToCompressedTexture(decodeRgt(bytes))` — both header parse AND pixel decode run on the main thread for normal maps. Only diffuse uses `decodeRgtOffThread`. Fix: route normal map decode through the worker pool too.

### (b) Non-instant vehicle switching (despite cache)

1. **[HIGH] `locateArchives` IPC before cache check** — same as (a)1 above. Even a cache hit pays the IPC cost. Fix: one-time cache of the directory handle. This is the primary cause of "not instant" switching.
2. **[LOW] `setLoading(true)` at line 2122** fires unconditionally before cache check, triggering a React state update and a UI repaint showing a loading indicator even for a cache hit that takes <5 ms. Move `setLoading(true)` to after the cache miss is confirmed (after line 2193).
