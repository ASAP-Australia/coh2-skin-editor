# Connect Screen Animation Jank — Root Cause & Remediation

## TL;DR

**Most likely root cause: synchronous `pako.inflate` / `pako.inflateRaw` on the main thread per compressed vehicle file, run on every vehicle read inside `preloadFaction`.** This blocks the JS event loop for several milliseconds per file, preventing the browser compositor from delivering animation frames. Secondary cause: frequent `setLoadProgress` re-renders of the full `ConnectScreen` subtree, which includes the spinner and `BorderBeam` wrapper.

---

## 1. Ranked Root Causes

### Cause A — Synchronous inflate per vehicle (PRIMARY) `src/lib/sga.ts:356–364`

`SgaArchive.readFile` reads raw bytes with `Blob.slice().arrayBuffer()` (truly async), but then calls `pako.inflate(raw)` or `pako.inflateRaw(raw)` **synchronously** on the returned buffer before resolving the promise. `pako` is a pure-JS DEFLATE implementation; decompressing a vehicle RGM (can be several hundred KB uncompressed) can take **5–20 ms per file** on the main thread. With 6 concurrent workers per faction and 5 factions running in parallel via `Promise.allSettled` (bounded to 8 global read slots, `preload.ts:72`), the main thread can receive many inflate callbacks in rapid succession, each blocking for several ms. This directly starves requestAnimationFrame and collapses the 16.6 ms frame budget to zero.

### Cause B — Frequent `setLoadProgress` re-renders (SECONDARY) `ConnectScreen.tsx:153–167`

`setLoadProgress` fires **once per vehicle** inside the per-faction worker loop (`preload.ts:257`). The throttle (`ConnectScreen.tsx:149–165`) de-duplicates calls where the rounded integer doesn't change, but bursts of vehicles completing simultaneously still fire multiple `setLoadProgress` calls in the same event-loop tick. Each call re-renders the full `ConnectScreen` component tree — including the `BorderBeam` wrapper, `InlineSpinner`, the progress text span, `AnimatedSwap` nodes, and all `useState` overhead. `BorderBeam` injects a long `<style>` block on every render (`border-beam.tsx:200–287`).

### Cause C — JS-driven spinner animation (CONTRIBUTING)

`InlineSpinner` uses `animation: bb-spinner-rotate 0.9s linear infinite` defined in `index.css:435–437`. **This is a CSS `@keyframes` animation** — it drives `transform: rotate(360deg)`, which the browser compositor can run off-main-thread. However, the compositor can still drop frames if the main thread is blocked for > ~4 ms continuously, because compositing still requires some main-thread cooperation on paint. Once inflates run for 10–20 ms, even compositor-driven animations glitch visibly.

`BorderBeam`'s sweep uses a CSS `@property --bb-angle-*` animated via `@keyframes bb-spin-*` (`border-beam.tsx:201–213`) — also CSS-driven, same caveat.

`AnimatedSwap` uses JS `setTimeout`/`requestAnimationFrame` state machine (`animated-swap.tsx:120–146`) — **JS-driven**, directly susceptible to main-thread blockage, but it only animates on `swapKey` changes, not during steady-state preloading.

### Cause D — TOC parse on open (MINOR, mitigated)

`SgaArchive.open` reads the TOC into a `Uint8Array` (`sga.ts:113–116`) and walks it synchronously in a DataView loop. For large archives this may take a few ms but it happens once per archive (cached via `archiveOpenInFlight`, `preload.ts:61–64`) and is bounded.

---

## 2. Animation Thread Analysis

| Animation | Mechanism | Off-main-thread? |
|---|---|---|
| `InlineSpinner` rotation | CSS `@keyframes bb-spinner-rotate` (`index.css:435`) | Yes (compositor), but drops when main blocked > ~4 ms |
| `BorderBeam` beam sweep | CSS `@keyframes bb-spin-{id}` via `@property` (`border-beam.tsx:214`) | Yes (compositor), same caveat |
| `AnimatedSwap` enter/exit | JS `setTimeout`/`rAF` + inline `style` updates (`animated-swap.tsx:120–146`) | No — main thread |
| Button phase opacity crossfade | CSS `transition: opacity 160ms ease` (`ConnectScreen.tsx:265`) | Yes (compositor) |

**Summary:** The spinner and beam are CSS-based and should be compositor-immune, but pako inflate bursts (10–20 ms) are long enough to cause visible jank even on compositor-driven animations. The `AnimatedSwap` JS animation would also stutter if triggered during preloading.

---

## 3. Is there synchronous decode today?

Yes. `sga.ts:361–363` calls `pako.inflate(raw)` synchronously after the async `arrayBuffer()` resolves. No decode is deferred to the editor — the full decompressed `Uint8Array` is placed directly into `bytesCache` (`preload.ts:250`). The `schedulePrefetch` path (texture decode via `decodeRgt`/`rgtToCompressedTexture`) uses `requestIdleCallback` (`preload.ts:393–415`), but that is only called after preloading is complete, not during it.

---

## 4. Recommendations

### Fix 1 — Move inflate to a Worker (highest impact)

The `decode-pool.ts` worker pool already exists at `src/lib/decode-pool.ts` for BC decode. Create a parallel `inflate-pool.ts` (or extend `decode.worker.ts`) that accepts a compressed `ArrayBuffer` and returns the inflated buffer via `postMessage` with a transferable. Update `SgaArchive.readFile` (`sga.ts:353–366`) to `await inflatePool.inflate(raw)` instead of calling `pako` synchronously. This moves every inflate call off the main thread, eliminating Cause A entirely. Transfers are zero-copy — no additional allocation penalty.

### Fix 2 — Isolate progress counter into its own component (medium impact)

Extract the `loadProgress` text (`ConnectScreen.tsx:276`) and `setLoadProgress` state into a separate `VehicleProgressText` component that takes only the counter as a prop. Wrap it in `React.memo`. This ensures `setLoadProgress` updates only re-render the counter text — not `BorderBeam`, `AnimatedSwap`, or the button shell. For even finer isolation, replace `useState` with a `useRef` for `loadProgress` and update the DOM directly via `ref.current.textContent` (a ref-based update, no React re-render at all).
