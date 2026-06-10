# Implementation Plan: Vehicle Byte Preload During Connect

## User request
"Why do you do the vehicle load when I open my skin pack, you should do it when I
press connect, and show update text in the connect button to the right of the
loading circle as you process it."

## Cost breakdown (verified)
Post-open delay has two phases:
- **Phase A — Disk I/O**: `preloadFaction()` in `src/lib/preload.ts` (~lines 108–206)
  opens SGAs and reads each vehicle `.rgm` into a module `bytesCache`. Pure CPU/disk,
  no GPU/DOM/Three. **Movable to connect.**
- **Phase B — GPU build**: `buildVehicleIntoCache()` in `src/components/Viewport.tsx`
  (~line 4135). Line ~4141 hard-returns if `!rendererRef.current || !cameraRef.current`.
  Requires a mounted WebGLRenderer. **Not movable** without pre-mounting a hidden
  Viewport (high risk in a 1200+ line component).

## Recommended approach
Move ONLY Phase A (byte preload) into `connect()`. Run `preloadFaction` for ALL
factions in parallel, drive a new `'preloading'` phase showing
`Loading vehicles… N/total` to the right of the spinner. Phase B stays in the
Editor `onModelLoaded` warmup (guarded by `factionPreloadFiredRef`), but each
`buildVehicleIntoCache` now hits warm `bytesCache` (Viewport ~line 4301
`getPreloadedBytes()`) and skips disk I/O → materially faster. No double-load:
`buildVehicleIntoCache` guards on `pinnedVehicleCache`/`vehicleGroupCache`;
`preloadFaction` guards on `bytesCache`; archive opens share a module cache.

## Scope
`src/lib/vehicles.ts` has 5 factions / 61 vehicles total. We don't know the pack's
faction at connect, so preload all. Launch one `preloadFaction` per faction inside
`Promise.allSettled` (shared archives cached after first open). **Use
`VEHICLES.length` for the total — do NOT hardcode 61.** Verify the real exports
(`VEHICLES`, `FACTIONS`, `Faction` type) and adapt; if no `FACTIONS`, derive unique
factions from `VEHICLES`.

## Edits

### 1. `src/components/ConnectScreen.tsx`
- `Phase` type: add `'preloading'`.
- `busy` guard: include `phase === 'preloading'`.
- Add state: `const [loadProgress, setLoadProgress] = useState<{done:number; total:number}|null>(null)`.
- Imports: `preloadFaction` from `@/lib/preload`; `VEHICLES` (+ `FACTIONS`/`Faction` if they exist) from `@/lib/vehicles`.
- In `connect()`, after archives validated + steam init, BEFORE final `onConnected`
  (replacing the `setPhase('success'); await 1400ms; onConnected(...)` tail):
  - optional `onHandleReady?.(handle)`
  - `setPhase('preloading'); setLoadProgress({done:0, total: VEHICLES.length})`
  - build a `Map<faction, fraction>`; `await Promise.allSettled(factions.map(f => preloadFaction(handle, f, p => { update map[f]=p.fraction; avg=mean(map values); setLoadProgress({done: Math.round(avg*VEHICLES.length), total: VEHICLES.length}) })))`
  - then `setPhase('success'); await ~900ms; onConnected(handle, resolvedSteamInfo)`
  - swallow per-faction errors (non-fatal).
- Button content container: widen fixed width ~180 → ~280 so spinner + text fit.
- Add a `'preloading'` opacity span: `<InlineSpinner/>` + a text span
  (`Loading vehicles… {loadProgress?.done ?? 0}/{loadProgress?.total ?? VEHICLES.length}`),
  spinner left, text right, gap ~8px. Keep the existing picking/scanning/linking
  spinner-only span centered.

### 2. `src/App.tsx`
- If adding `onHandleReady`, wire it on BOTH ConnectScreen render sites (calls
  `setInstallRoot(h)` early). Safe — module archive guard prevents double-open.
  Optional; skip if it complicates typing.

### 3. `src/components/Editor.tsx`
- Comment-only: update the stale "HIDDEN UNDER THE CONNECT LOADING CIRCLE" comment
  (~line 1354) to note bytes are now preloaded during Connect. No functional change.

## Verification
- `npx tsc --noEmit` → clean.
- `npx vitest run src/lib/__tests__/vehicles.test.ts src/components/__tests__/StartScreen.test.tsx`
  (skip any that don't exist).
- Do NOT launch the app / full build / browser tools.

## Key risk
Wall-clock: 61 vehicles × 5 factions cold could be 20–35s on HDD, ~3–8s on SSD,
now shown with progress during Connect (acceptable per user intent). Editor's
existing 300s safety timer catches hangs.
