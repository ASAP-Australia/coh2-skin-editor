# Spec item D — Loading-UX ground-truth inventory (2026-06-10)

All paths relative to repo root. Line numbers verified against current working tree.

## 1. Startup timeline (launch → first interactive)

| # | Step | Where | Sync? | Est. cost |
|---|------|-------|-------|-----------|
| 1 | Window created hidden (`show:false`, `paintWhenInitiallyHidden`) | electron/main.ts:456-457, 431 | — | 0 visible |
| 2 | AI settings + 4× safeStorage key decrypts deferred to `setImmediate` after `createWindow()` | electron/main.ts:938-941 | async (was 50-500 ms block, fixed) | 0 |
| 3 | `index.html` is bare (`<div id="root">` only — no static skeleton anymore) | index.html:9-12 | — | — |
| 4 | React mounts; `phase` resolved **synchronously** to `'connect'` in Electron (lazy `useState`) | src/App.tsx:134-140 | sync, trivial | <1 ms |
| 5 | Double-rAF → `signalRendererReady` → `mainWindow.center()+show()` (6 s safety timeout) | src/App.tsx:271-273; electron/main.ts:823-843 | async | window appears only when painted |
| 6 | ConnectScreen mounts; `detectInstallPath()` IPC fired in background (uses `execSync('reg query…')` on Windows in main proc — detect-coh2.ts:45) | src/components/ConnectScreen.tsx:108-112 | async | <100 ms |
| 7 | Shader background lazy-mounts one idle frame after commit; CSS gradient covers gap | src/components/AuthShell.tsx:60-77, 353-358 | async | <100 ms |

**Measured (deployed build): app-icon → Connect interactive ≈ 1.1 s; FCP ≈ 560 ms** (.llm/megatask/todo.md "tick 11"; .llm/megatask/load-perf-measure.md). No spinner is shown at startup; the window is simply hidden until painted.

## 2. Connect timeline (click → usable Start screen)

`connect()` — src/components/ConnectScreen.tsx:114-288:

1. **picking** — auto-detect or native picker (123-129), <100 ms.
2. **scanning** — `locateArchives` (137-144). The old 350 ms artificial floor is GONE; only error paths hold 1500 ms ('warning', 141/165/172/181/284).
3. **linking-steam** — `initSteamNative()` IPC (150-185), 100-400 ms cold.
4. **preloading — Phase A**: `preloadFaction` for 5 factions in parallel (209-225); RGM bytes into module cache, `GLOBAL_READ_CAP=16` (src/lib/preload.ts:74). Inflate is **off-thread** (src/lib/sga.ts:36, 398 `inflateOffThread`); SGA **TOC parse is still synchronous main-thread** inside `SgaArchive.open` (sga.ts:89-179).
5. **preloading — Phase B (deferred)**: warms **only the default vehicle** eagerly via headless 1×1 px Viewport (245-263); the other 60 vehicles are NOT built here.
6. **success** — 200 ms cosmetic hold (273) → `onConnected`.

**Phase B state**: the Connect-blocking 61-vehicle pump was removed (todo.md tick 11: Connect→Start **67 s → 2.4 s**, ~28×). The once-"deferred optional" App-owned background warmer **has since landed**: src/App.tsx:157-261 + 453-481 runs an idle-paced (`requestIdleCallback`), LANES=3, `cpuOnly=true` pump through a hidden Viewport after `onConnected`, then frees the GL context. The editor's own renderer GPU-compiles warmed groups in background idle slots (src/components/Viewport.tsx:4790-4800). Un-warmed on-demand build measured ~105 ms with no spinner (old model stays visible — Viewport.tsx:2659-2671). **What remains on the 2.4 s path**: Phase A TOC parses + byte reads (~1-2 s), Steam init, default-vehicle warm, the 200 ms success hold, and 3 sync `loadActive*()` parses on StartScreen mount (§4.3).

## 3. Loading-state inventory

| Indicator | file:line | Trigger | Est. duration | User-visible? |
|---|---|---|---|---|
| Connect button spinner (picking/scanning/linking-steam) | ConnectScreen.tsx:404-405, 440-457 | Connect click | 0.2-0.7 s | Yes |
| "Loading vehicles… N/61" counter + spinner | ConnectScreen.tsx:412-415, 36-51 | 'preloading' phase | ~1-2 s | Yes — main Connect wait |
| Success tick hold | ConnectScreen.tsx:270-273 | post-preload | 200 ms | Yes |
| Warning icon hold | ConnectScreen.tsx:141,165,172,181,284 | error paths | 1500 ms | Only on failure |
| "Loading…" probing text | App.tsx:547-552 | browser-only handle probe | <200 ms | Never in Electron (sync init skips) |
| AuthShell card `LoadingBorder` beam + FLIP morph | AuthShell.tsx:230, 369-376 | `phase==='editor-loading'` | skin: ≥620 ms (`EDITOR_LOADING_MIN_MS`, App.tsx:101,437-440); faceplate/decal: fixed 600 ms (App.tsx:95,332,338) | Yes — every editor open |
| "Loading projects…" | SavedProjectsList.tsx:108-115, 250-253 | mount; covers sync localStorage walk | 1 frame…seconds (blocks during parse, §4) | Yes with large projects |
| Viewport overlay "Loading {vehicle}…" | Viewport.tsx:883, 2664-2665, 4883 | only when `!meshGroupRef.current` (first-ever cold build) | ~0 after warmup | Rarely |
| TRIM-v5 packed-stride error (Tiger/Churchill/M5 Stuart) | Viewport.tsx:3081-3090 | parser yields 0 submeshes | n/a (error, not loading; rgm.ts:283-308 has v5 loaders so fallback-only) | Rare |
| VehicleMenu `LoadingBorder` beam | VehicleMenu.tsx:90; Editor.tsx:287-303 | vehicle switch in flight | ~105 ms un-warmed; 0 warmed | Briefly |
| SeasonToggle beam, **forced 600 ms min** | SeasonToggle.tsx:27; Editor.tsx:296-299 (`SEASON_MIN_LOADING_MS`) | season click | 600 ms even when swap is ~10 ms | Yes — artificial |
| Editor Suspense fallback (black div) | Editor.tsx:1430 | Viewport chunk load | <100 ms, hidden behind FLIP | No |
| "Loading texture…" / "Loading workshop items…" | TemplateDecalPills.tsx:374, 410 | template diffuse bake / workshop IPC | 0.2-2 s | Yes, lazy menu |
| AtlasPreview3D Suspense "Loading..." | atlas/AtlasPreview3D.tsx:209 | atlas tab open | <100 ms | Briefly |
| "Building…" / "Publishing at visibility…" / LiveSyncBadge busy / "Removing from Workshop…" | PublishSection.tsx:403,438; PublishToWorkshopDialog.tsx:300,411; LiveSyncBadge.tsx:289; SavedProjectsList.tsx:541 | user-initiated exports/publish | legit progress | Yes, appropriate |
| WipeMigrationScreen spinners | WipeMigrationScreen.tsx:196,252,423 | **dead code — never mounted** (only its test imports it) | — | No |

## 4. Blocking-path inventory (main-thread, multi-MB)

Projects live **entirely in renderer localStorage** (no IPC): `coh2.project.<id>` etc. There is no project list/load IPC endpoint; "list ships full blobs" manifests as full-blob `JSON.parse` in the renderer:

1. **`getRealWorkshopId` parses the FULL 5-20 MB blob per row per render** — SavedProjectsList.tsx:141-159 calls `loadById`/`loadFaceplateById`/`loadDecalPackById` (project.ts:558-568; faceplate-project.ts:757-769; decal-pack-project.ts:542-548) just to read one field, re-executed for every row on every render (arm/cancel/delete re-renders included). 10×10 MB projects ⇒ ~100 MB parsed per render. **Single biggest blocking path.**
2. **`listAll*` walks parse every stored blob** to validate + extract name/date — project.ts:647-680; faceplate-project.ts:930-960; decal-pack-project.ts:641-660. Runs in SavedProjectsList mount effect (110-115) behind "Loading projects…".
3. **StartScreen mount: 3 sync active-project parses** (`loadActive`+`loadActiveFaceplate`+`loadActiveDecalPackFromLocal`) — StartScreen.tsx:86-91. On the Connect→Start critical path.
4. **`persistActive` = sync `JSON.stringify` of whole project on EVERY mutation** (brush dab, decal drag) — Editor.tsx:914-924 effect with `[project]` dep → project.ts:528-537. project.ts:527 says "Throttled by the caller" — it is not. Faceplate/decal same (faceplate-project.ts:731-737; decal-pack-project.ts:462-463; QuotaExceeded risk noted at 466).
5. **Open-a-saved-skin does ≥3 parses + ≥3 stringifies of the same blob**: `pickSavedSkin`→`loadById` (App.tsx:343-350) → `openSkin`→`persistActive` (App.tsx:321-327) → hidden Editor mount `loadActive()` (Editor.tsx:123-124) + persist effect → **Editor unmount/remount** at `editor-loading`→`editor` (separate JSX branches, App.tsx:584-592 vs 607-618) repeats parse+stringify.
6. **SGA TOC parse synchronous** post-`await` (sga.ts:89-179, v10 path 189-240) — longtasks during Connect Phase A; inflate already worker-offloaded.
7. Electron main sync fs: publish path `readdirSync`/`statSync`/`readFileSync` (steam.ts:344,386-392,430); `execSync` reg query (detect-coh2.ts:45); `file-exists` `existsSync` (main.ts:714-716). Minor — off renderer thread.

## 5. Ranked fixes

1. **Metadata-only workshopId for rows** — persist `workshopId` into the recent-registry entries (or one tiny `coh2.workshopIds` index updated in `persistActive`/`clear*WorkshopId`); SavedProjectsList reads index, zero blob parses. Files: project.ts, faceplate-project.ts, decal-pack-project.ts, SavedProjectsList.tsx. ~40 LOC. Kills §4.1.
2. **Metadata index for `listAll*`** — write `{id,name,lastEditedAt}` index on persist; list reads index only (validity-gate moves to click time, where `loadById` already runs). Removes the "Loading projects…" state entirely. ~60 LOC in the 3 project libs + SavedProjectsList.tsx:108-115/250-253 deletion.
3. **Single persistent Editor element** — render one `<Editor visible={phase==='editor'}>` covering both `editor-loading` and `editor` (App.tsx:580-618) instead of two branches. Saves one full parse+stringify+Viewport re-init per open. ~15 LOC.
4. **Debounce `persistActive`** (e.g. 500 ms trailing, flush on unmount/Ctrl-S) at Editor.tsx:916; same for faceplate/decal editors. ~10 LOC each. Removes per-dab multi-MB stringify jank.
5. **Drop artificial holds**: SeasonToggle 600 ms min (Editor.tsx:296-299) → clear on `onSeasonReady`; faceplate/decal fixed 600 ms (App.tsx:95,332,338) → fire on first editor paint; success 200 ms (ConnectScreen.tsx:273) → 0-100 ms. ~10 LOC total.
6. **Worker-offload SGA TOC parse** (sga.ts open paths) using inflate-pool pattern — shaves the largest remaining Connect longtasks. ~80 LOC. Medium effort.
7. **Delete dead WipeMigrationScreen** (441 LOC + test) — inventory hygiene only.

Harness: `node scripts/harness/harness.mjs profile <secs> --fresh` auto-clicks Connect, records phase timeline + longtasks/TBT/dropped frames (scripts/harness/harness.mjs:221-275); `cpuprofile` (276+) names functions.
