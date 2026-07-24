# Recon: How to run & drive the CoH2 Skin Editor

Repo: `/var/home/jflessenkemper/dev/coh2-skin-editor`. Electron + React + TS (Vite 8, React 19, Three.js viewport, Konva 2D). All facts below cite `file:line`.

## 1. npm scripts (from `package.json:7-35`)

| Script | Command | What it does |
|---|---|---|
| `dev` | `vite` | **Launches the renderer** on the Vite dev server (browser). Registers the dev-only `/__coh2/*` bridge. This is the renderer-launching script. |
| `build` | `tsc -b && vite build` | Type-check + production bundle to `dist/`. Does NOT run anything. |
| `preview` | `vite preview` | Serves the built `dist/` — **no `/__coh2` bridge** (bridge is `apply:'serve'` only, `vite.config.ts:81`), so a previewed build cannot auto-load the CoH2 install. |
| `electron:dev` | `npm run electron:compile && concurrently "vite" "wait-on http://localhost:5173 && NODE_ENV=development electron --remote-debugging-port=9222 ."` | Full Electron dev: compiles the main/preload, starts Vite, then launches Electron pointing at it, with CDP on **:9222**. (`package.json:20`) |
| `electron:build` / `:win` | electron-builder | Packages the AppImage/NSIS installer. |
| `test` | `vitest run` | Unit tests (jsdom). |
| `test-export` | `npx tsx tools/test-export.ts` | **Headless export pipeline** (see §4). |

The renderer is launched by **`npm run dev`** (browser) or **`npm run electron:dev`** (desktop shell).

## 2. Vite port & Browser-vs-Electron verdict

- **Port: `5173`** (Vite default; not overridden in `vite.config.ts`, and `electron:dev` waits on `http://localhost:5173` — `package.json:20`). No `server.port` override anywhere in the config.
- **Loadable in a plain browser? YES — the renderer is explicitly designed to run browser-only in dev.** The app has two fully parallel I/O backends behind one duck-typed `FileSystemDirectoryHandle` surface:
  - **Electron backend**: `nativePathToHandle()` → IPC (`src/lib/native-fs.ts:294`), gated by `isElectron()` (`native-fs.ts:213-215`, which is simply `typeof window.electronAPI !== 'undefined'`).
  - **Browser backend**: `httpPathToHandle()` → `fetch('/__coh2/...')` against the Vite dev middleware (`src/lib/native-fs.ts:539`, middleware defined in `vite.config.ts:78-159`). Structurally identical handle; different transport (fetch vs IPC).
- **Startup auto-loads the CoH2 install in the browser** with no picker: `App.tsx:332-344` — in `import.meta.env.DEV`, it `fetch('/__coh2/detect')`, and on success calls `httpPathToHandle(installPath)` and jumps straight to `phase='start'` (the StartScreen). The Vite plugin auto-detects the Linux Steam install (`vite.config.ts:27-42`).
- **Verified**: the CoH2 install IS present on this machine at `~/.steam/steam/steamapps/common/Company of Heroes 2` (and `~/.local/share/Steam/...`), both matched by the bridge's `detectLinuxCoh2()` roots (`vite.config.ts:30-36`). So `npm run dev` will detect it and boot to StartScreen with real vehicle data — no file picker, no Electron.

### Renderer code paths that HARD-require Electron IPC (won't work in a browser)
`isElectron()` guards mean these degrade gracefully (return null/no-op) rather than crash, but the FEATURES below are Electron-only:
- **Steam Workshop publish/update/delete** — `window.electronAPI.steam.workshop.*` (`PublishSection.tsx:301-336`, `PublishToWorkshopDialog.tsx:257-269`, `SavedProjectsList.tsx:169-173`). Browser shows the UI but `isElectron()` short-circuits before the call (`PublishSection.tsx:241`, `PublishToWorkshopDialog.tsx:196`).
- **AI camo diffusion / texture validation / prompt rewrite** — `window.electronAPI.diffusion.*` and `.ai.complete` (`src/lib/ai/generate-camo-diffusion.ts:192-202`, `adjust-camo-diffusion.ts:168-176`, `rewrite-adjustment.ts:303-306`, `valid-coh2-texture.ts:302-306`, and `TopBar.tsx:1142-1307`). All guarded by `!window.electronAPI` → fall back to local no-op / glossary expansion.
- **Native window chrome** — `window.electronAPI.windowMinimize/Close/isMaximized` (`WindowControls.tsx:22-62`); `isElectron()` false → the custom titlebar buttons hide.
- **`file://` template reads for mod export** — `mod-export.ts:317-323,467-511` uses `window.electronAPI.readFile` / `getResourcesPath` **only when `window.location.protocol === 'file:'`** (i.e. packaged Electron). In the browser these paths aren't taken; the browser export path uses the fetched bridge bytes instead.
- **Real disk writes** — `writeFile()` is a no-op outside Electron (`native-fs.ts:545-546`); browser export must go through the in-app download path, not disk.
- **Steam init at Connect** — the whole `linking-steam` block in `ConnectScreen.connect()` is `if (isElectron())` (`ConnectScreen.tsx:162`), so the browser path SKIPS the Steam handshake entirely. Good: the browser never blocks on "Steam isn't running".

**Net:** SKIN / DECAL / FACEPLATE authoring + the 3D viewport + 2D Konva canvas + reading the real CoH2 archives all work in a plain browser via `npm run dev`. Only Workshop publishing, AI diffusion, native-window chrome, and on-disk writes are Electron-only.

## 3. Exact launch command(s) + how a vehicle/asset loads on startup

**Browser (drivable with preview_* / Chrome tools) — RECOMMENDED:**
```bash
cd /var/home/jflessenkemper/dev/coh2-skin-editor && npm run dev
# open http://localhost:5173
```
(Optionally force a specific install with `COH2_INSTALL="/path/to/Company of Heroes 2" npm run dev` — honored at `vite.config.ts:46`.)

**Electron desktop shell (only if you need Workshop/AI/native features), CDP on :9222:**
```bash
cd /var/home/jflessenkemper/dev/coh2-skin-editor && npm run electron:dev
```

**Startup → asset flow:**
1. `main.tsx:6-9` mounts `<App/>`.
2. `App.tsx` phase machine (`App.tsx:124-365`): in browser-DEV it hits `/__coh2/detect` (`App.tsx:333`), gets the install path, builds an HTTP-bridge handle, sets `installRoot`, and lands on **`phase='start'`** = the **StartScreen** (`App.tsx:551-572`).
3. **StartScreen** is the launcher: `onNewSkin` → `phase='editor'` (mounts `<Editor>`), `onNewFaceplate` → `newFaceplateProject()`, `onNewDecalPack` → `newDecalPackProject()`, plus load-recent / load-from-disk handlers (`App.tsx:553-571`). Vehicle geometry/textures are read on demand from the real CoH2 archives through the bridge handle; App also background-warms vehicle RGM bytes after reaching `start` (`App.tsx:189-206`).
4. **No synthetic fixture is needed** — it drives the user's actual installed CoH2 assets. (A `src/lib/demo-project.ts` exists but the normal boot uses live archives, not a demo.)
5. Electron adds a headless shortcut: `?headless=editor` query param lands directly in the skin editor (`App.tsx:286-298`); `?screenshot=1` freezes on ConnectScreen (`App.tsx:282`).

## 4. Headless / programmatic path (validate libs without the UI)

Yes — there is a first-class Node harness that calls the **exact same** authoring libs the browser uses, via canvas/fs shims:

- **`tools/test-export.ts`** (run: `npx tsx tools/test-export.ts`, or `COH2_INSTALL=... OUT=/tmp/pack.sga npx tsx tools/test-export.ts`). Its header (`test-export.ts:1-22`) states it "Calls the same TypeScript code the browser uses (sga-writer / rgt-writer / bc-encode / chunky / sga / rgt / bc-decode)" against the real on-disk install, shimming `HTMLCanvasElement`/`Image`/`document.createElement('canvas')` via node-canvas (`test-export.ts:30-47`) and `FileSystemDirectoryHandle` via `fs`. Outputs a CoH2-loadable `.sga`.
- **Core lib entry points (import directly from tsx/vitest):**
  - `buildSga(opts: BuildSgaOptions): Promise<Uint8Array>` — `src/lib/sga-writer.ts:177` (SGA v7 packer; types at `:90,97,143`).
  - RGM/RGT: `src/lib/rgm.ts`, `src/lib/rgt.ts`, `src/lib/rgt-writer.ts`, `src/lib/rgt-core.ts`.
  - Decal build/export: `src/lib/decal-mod-build.ts`, `src/lib/decal-pack-export.ts`, `src/lib/decal-painter.ts`, `src/lib/king-tiger-decal-bake.ts`.
  - Faceplate: `src/lib/faceplate-mod-build.ts`, `src/lib/faceplate-project.ts`.
  - Texture codecs: `src/lib/bc-encode.ts`, `src/lib/bc-decode.ts`, `src/lib/chunky.ts`.
- **Ready-made validation harnesses** (Node, pure or CDP): `scripts/verify-unwrap-analytical.mts`, `scripts/verify-faceplate.mts`, `scripts/verify-model-completeness.mts`, `scripts/verify-unwrap-visual.mts`; plus the `verify-unwrap` Skill and the `coh2-dev` MCP server (`tools/coh2-dev-mcp/server.mjs`, 3 tools: analytical unwrap, faceplate round-trip, read visual-sweep report). npm aliases: `npm run test-export`, `npm run verify:visual`, `npm test` (vitest).
- **Other build harnesses** under `scripts/build-*.mts` (e.g. `build-honved-sga.mts`) and `tools/build-template.ts` also invoke the libs headlessly.

## Bottom line
`npm run dev` → `http://localhost:5173` gives a fully browser-drivable editor (viewport + canvas + real CoH2 assets, auto-detected, no picker, no Steam) suitable for the preview_* tools. For headless lib validation, use `npx tsx tools/test-export.ts` (full export) or the `scripts/verify-*.mts` harnesses. Reserve `npm run electron:dev` for Workshop-publish / AI / native-window features only.
