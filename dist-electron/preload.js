"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// ─────────────────────────────────────────────────────────────────────────────
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // CoH2 install detection
    detectCoh2: () => electron_1.ipcRenderer.invoke('detect-coh2'),
    // Mods-folder detection (Documents/My Games/Company of Heroes 2/mods —
    // a different OS directory from the install). Live Sync writes built
    // SGAs here; auto-detect lets us skip the second directory picker for
    // users on Win32 or Proton-on-Linux.
    detectCoh2Mods: () => electron_1.ipcRenderer.invoke('detect-coh2-mods'),
    // Steam Workshop content folder for CoH2 (`.../steamapps/workshop/content/231430/`).
    // Used by the Template Picker to surface the user's subscribed workshop
    // items as seed templates when creating a new project.
    detectCoh2Workshop: () => electron_1.ipcRenderer.invoke('detect-coh2-workshop'),
    listWorkshopItems: (root) => electron_1.ipcRenderer.invoke('list-workshop-items', root),
    // Enumerate the stock CoH2 archives that ship with the base game.
    // Reads <installRoot>/CoH2/Archives/*.sga and returns id + path + size
    // for each. Cheap stat-only call — no archive parsing. Returns [] when
    // the Archives folder is missing or the app runs outside Electron.
    listStockArchives: (installRoot) => electron_1.ipcRenderer.invoke('list-stock-archives', installRoot),
    pickDirectory: () => electron_1.ipcRenderer.invoke('pick-directory'),
    // File system
    readFile: (p) => electron_1.ipcRenderer.invoke('read-file', p),
    readFileRange: (p, start, length) => electron_1.ipcRenderer.invoke('read-file-range', p, start, length),
    fileStat: (p) => electron_1.ipcRenderer.invoke('file-stat', p),
    listDir: (p) => electron_1.ipcRenderer.invoke('list-dir', p),
    fileExists: (p) => electron_1.ipcRenderer.invoke('file-exists', p),
    // Write a binary blob to disk, creating parent directories as needed.
    // Live Sync uses this to drop built .sga packs into mods/skins/ (skin
    // packs) or mods/faceplates/subscriptions/ (faceplates) — CoH2 reads
    // each item type from its own bucket, so faceplates dropped into
    // mods/extension/subscriptions/ are silently ignored.
    writeFile: (p, bytes) => electron_1.ipcRenderer.invoke('write-file', p, bytes),
    // Window controls
    windowMinimize: () => electron_1.ipcRenderer.invoke('window-minimize'),
    windowMaximize: () => electron_1.ipcRenderer.invoke('window-maximize'),
    windowClose: () => electron_1.ipcRenderer.invoke('window-close'),
    isMaximized: () => electron_1.ipcRenderer.invoke('window-is-maximized'),
    // Renderer-ready handshake: fired once the React tree has committed and
    // painted its first frame, so the main process knows it's safe to
    // surface the BrowserWindow. Without this, Electron shows the window on
    // Chromium's `ready-to-show` — which fires after the STATIC HTML
    // skeleton in index.html paints, not after the real ConnectScreen. The
    // user sees the unstyled fallback for a few hundred ms before React
    // hydrates over it. The signal closes that gap; main.tsx fires it on
    // the second rAF after `createRoot().render()` returns, by which point
    // React has committed the AuthShell + ConnectScreen subtree.
    signalRendererReady: () => {
        electron_1.ipcRenderer.send('renderer-ready');
    },
    // AI provider bridge — API keys live in main process only, never
    // cross this boundary. `ai.complete` proxies through main which
    // signs the HTTP call with the decrypted key.
    ai: {
        getSettings: () => electron_1.ipcRenderer.invoke('ai:get-settings'),
        setActiveProvider: (p) => electron_1.ipcRenderer.invoke('ai:set-active-provider', p),
        setKey: (p, key) => electron_1.ipcRenderer.invoke('ai:set-key', p, key),
        clearKey: (p) => electron_1.ipcRenderer.invoke('ai:clear-key', p),
        complete: (req) => electron_1.ipcRenderer.invoke('ai:complete', req),
        generateImage: (req) => electron_1.ipcRenderer.invoke('ai:generate-image', req),
    },
    // Tier-3 local diffusion bridge — routes to the DiffusionSidecar singleton
    // in main. The sidecar manages the sd-server child process lifecycle; the
    // renderer never talks to sd-server directly (it's bound to 127.0.0.1 but
    // cross-origin fetch is blocked by Electron's CSP anyway).
    diffusion: {
        getStatus: () => electron_1.ipcRenderer.invoke('diffusion:get-status'),
        listModels: () => electron_1.ipcRenderer.invoke('diffusion:list-models'),
        listLoras: () => electron_1.ipcRenderer.invoke('diffusion:list-loras'),
        start: (model) => electron_1.ipcRenderer.invoke('diffusion:start', model),
        stop: () => electron_1.ipcRenderer.invoke('diffusion:stop'),
        generateImage: (req) => electron_1.ipcRenderer.invoke('diffusion:generate-image', req),
        editImage: (req) => electron_1.ipcRenderer.invoke('diffusion:edit-image', req),
        getBodyMask: (faction, vehicleId) => electron_1.ipcRenderer.invoke('diffusion:get-body-mask', faction, vehicleId),
    },
    // Workshop content staging dir — creates a fresh temp dir the renderer
    // can use as contentPath for steam:workshop:publish.
    makeTmpPublishDir: () => electron_1.ipcRenderer.invoke('tmp:make-publish-dir'),
    // One-time mods-folder migration. v0.x Live Sync dropped SGAs with
    // fake Workshop IDs into the mods tree; those files now fail lobby
    // validation and need to be cleared. `scanFakeIds` is a cheap stat-
    // only walk; `trashFakeIds` moves selected files to the OS trash
    // (recoverable). Both no-op gracefully when modsRoot doesn't exist.
    mods: {
        scanFakeIds: (modsRoot) => electron_1.ipcRenderer.invoke('mods:scan-fake-ids', modsRoot),
        trashFakeIds: (paths, modsRoot) => electron_1.ipcRenderer.invoke('mods:trash-fake-ids', paths, modsRoot),
    },
    // Steam Workshop bridge — Steam-first v1.0. The renderer calls
    // `steam.init()` from the StartScreen and dispatches to one of three
    // branches based on the discriminated failure code. `steam.workshop.publish`
    // is the critical-path fix for the multiplayer bug (real Workshop IDs
    // instead of fabricated ones that fail lobby validation).
    steam: {
        init: () => electron_1.ipcRenderer.invoke('steam:init'),
        reset: () => electron_1.ipcRenderer.invoke('steam:reset'),
        workshop: {
            publish: (input) => electron_1.ipcRenderer.invoke('steam:workshop:publish', input),
            update: (workshopId, input) => electron_1.ipcRenderer.invoke('steam:workshop:update', workshopId, input),
            getMine: () => electron_1.ipcRenderer.invoke('steam:workshop:get-mine'),
        },
    },
});
