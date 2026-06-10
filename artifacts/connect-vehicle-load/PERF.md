# Connect-time Vehicle Preload — Performance Analysis

**Scope**: disk-I/O byte preload only (`bytesCache`). GPU build (`buildVehicleIntoCache` in `Viewport.tsx`) is explicitly out of scope.

---

## Current Flow (press Connect → all bytes cached)

1. **ConnectScreen.tsx:148** — `Promise.allSettled` fires 5 `preloadFaction` calls in parallel, one per faction in `FACTIONS`.
2. **preload.ts:117** — each `preloadFaction` calls `locateArchives(root)` independently (5 redundant calls).
3. **preload.ts:131** — Phase 1: each faction opens its SGA list via `Promise.all`. `ArtHigh.sga`, `ArtHighXP1.sga`, `ArtArmies.sga` are referenced by all 5 factions → **up to 5 concurrent `SgaArchive.open()` calls on the same file** before any one of them can write the `archiveCache` entry and unblock the others. Each `open()` reads the full TOC from disk and parses it in JS.
4. **preload.ts:172** — Phase 2: vehicles for the faction are read in a **sequential `for` loop** (`await a.readByPath(path)` one at a time). Each call slices the file Blob, awaits `arrayBuffer()`, then decompresses with pako if `storage != 0`. No concurrency within a faction.
5. **ConnectScreen.tsx:151-156** — each `onProgress` callback runs a full `Map` iteration over `fractionByFaction` and calls `setLoadProgress` → React re-render. With 61 vehicles across 5 parallel factions, this fires dozens of renders during the tight sequential vehicle loop.

**Concurrency model in one sentence**: archive opens race concurrently (within and across factions), but per-faction vehicle reads are fully sequential.

**Vehicle counts** (vehicles.ts): german 10, west_german 13, soviet 12, aef 17, british 9 = **61 total**. Distinct SGA files: **10**. Common archives shared across factions: `ArtHigh.sga` (5×), `ArtHighXP1.sga` (5×), `ArtArmies.sga` (5×), `ArtHighXP2.sga` (2×).

---

## Bottleneck Ranking

| # | Bottleneck | Reducible? |
|---|-----------|-----------|
| 1 | **3–5 redundant TOC parses of the same SGA** (ArtHigh, ArtHighXP1, ArtArmies each parsed up to 5×) | Yes — single-flight dedup |
| 2 | **Sequential vehicle reads within each faction** (17 sequential `await` hops for aef, 13 for west_german, etc.) | Yes — parallelize within faction |
| 3 | **5 independent `locateArchives(root)` calls** (one per faction) | Yes — call once, share result |
| 4 | **Per-vehicle `setLoadProgress` + full Map scan** fires dozens of React re-renders | Yes — throttle/batch |
| 5 | **Irreducible disk I/O + zlib inflate per unique RGM** | No — required work |

The first two bottlenecks dominate wall time: the 3 shared SGAs are the largest archives (high/LOD assets), and sequential reads turn 17 RGM fetches into a 17-step serial chain where each step is a Blob read + optional decompress.

---

## Optimization Proposals

### O1 — Single-flight archive open (highest ROI)

**File**: `src/lib/preload.ts:132–157`

**Problem**: `archiveCache.has(name)` checked at the _start_ of each concurrent open, but the winner writes to the cache only _after_ the full `SgaArchive.open()` returns. Five factions all see a cold cache for ArtHigh.sga, so all five open it simultaneously.

**Fix**: introduce an in-flight `Map<string, Promise<SgaArchive>>` alongside `archiveCache`.

```ts
// add at module level (preload.ts, after archiveCache declaration)
const archiveOpenInFlight = new Map<string, Promise<SgaArchive>>()

// replace the open block in preloadFaction (~line 132):
const openArchive = (name: string): Promise<SgaArchive | null> => {
  if (archiveCache.has(name)) return Promise.resolve(archiveCache.get(name)!)
  if (archiveOpenInFlight.has(name)) return archiveOpenInFlight.get(name)!
  const p = (async () => {
    const fh = await archives.getFileHandle(name)
    const file = await fh.getFile()
    const archive = await SgaArchive.open(file)
    archiveCache.set(name, archive)
    return archive
  })().finally(() => archiveOpenInFlight.delete(name))
  archiveOpenInFlight.set(name, p)
  return p
}
```

**Expected win**: 3 large TOC parses eliminated (ArtHigh, ArtHighXP1, ArtArmies). Probably the biggest single speedup — TOC parses are the expensive part of `SgaArchive.open` (reads 100s of KB + JS parse loop). **Risk**: none — the promise is deduplicated, archive object shared read-only.

---

### O2 — Parallelize per-vehicle reads within a faction (second highest ROI)

**File**: `src/lib/preload.ts:172–202`

**Problem**: the vehicle loop is `for … await` — strictly sequential. 17 vehicles in AEF = 17 serial round-trips.

**Fix**: replace the `for` loop with `Promise.all` (or a bounded concurrency pool if memory is a concern):

```ts
// replace lines 172-202 with:
await Promise.all(
  vehicles.map(async (v, i) => {
    const path = rgmPath(v).toLowerCase()
    if (bytesCache.has(path)) { vehiclesPreloaded.push(v.id); return }
    let found: Uint8Array | null = null
    for (const a of archivesList) {
      try { const b = await a.readByPath(path); if (b) { found = b; break } } catch { /* try next */ }
    }
    if (found) { bytesCache.set(path, found); vehiclesPreloaded.push(v.id) }
    else errors.push({ path, message: 'RGM not found in any preload SGA' })
    onProgress?.({ phase: 'vehicles', current: v.id, fraction: 0.5 + ((i + 1) / vehicles.length) * 0.5 })
  }),
)
```

**Expected win**: faction wall-time collapses from N×(read+decompress) serial to ~max(read+decompress) across N parallel reads. For AEF (17 vehicles) this could be a 10–15× faction-level speedup assuming disk throughput > single-read bottleneck. **Risk**: all 17 Blob slices inflight simultaneously — memory spike of ~(17 × avg_rgm_size). RGM files are meshes, typically 100–500 KB each; peak is ~8 MB for one faction's concurrent reads, which is fine.

---

### O3 — Deduplicate `locateArchives` call

**File**: `src/lib/preload.ts:117`

**Problem**: each of the 5 `preloadFaction` calls does `await locateArchives(root)` independently.

**Fix**: resolve the archives handle once in `ConnectScreen.tsx` before the `Promise.allSettled`, or add a module-level single-flight to `preload.ts` mirroring O1. Small win (directory traversal) but trivial to implement.

---

### O4 — Batch progress updates to avoid render thrash

**File**: `src/components/ConnectScreen.tsx:151-156`

**Problem**: `onProgress` fires per vehicle; each call iterates `fractionByFaction` (O(5)) and calls `setLoadProgress` → React enqueue. With 5 parallel factions each firing ~10–17 callbacks, this is 50–85 `setState` calls.

**Fix**: throttle to at most one `setLoadProgress` per animation frame:

```ts
// ConnectScreen.tsx — before Promise.allSettled:
let rafPending = false
const throttledSetProgress = (done: number, total: number) => {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => { setLoadProgress({ done, total }); rafPending = false })
}
// replace setLoadProgress(…) inside onProgress with throttledSetProgress(…)
```

**Expected win**: reduces re-renders from ~50–85 to ≤ number of frames during preload (~15–30 at 60 fps). Negligible on fast machines; noticeable on integrated-GPU systems where React re-renders compete with the main thread. **Risk**: none — purely cosmetic progress display.

---

## What NOT to Touch

- `buildVehicleIntoCache` in `src/components/Viewport.tsx` — GPU build phase, explicitly out of scope.
- `bytesCache` correctness: all proposals preserve the existing cache-key convention (`path.toLowerCase()`).
- Error handling: non-fatal errors are preserved in all proposals above.
- `archiveCache.set` single-write guard in `cacheArchive` (preload.ts:74) — preserved; O1 uses the same pattern.
