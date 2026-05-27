import { contextBridge, ipcRenderer } from 'electron'

// ── Local type copies ─────────────────────────────────────────────────────────
// The electron directory compiles under `rootDir: "electron"` which prevents
// importing from src/. We re-declare the relevant types here so the preload
// bridge is typed without crossing that boundary. The canonical definitions
// live in src/lib/ai/types.ts — keep in sync if the canonical types change.

type AiProvider = 'anthropic' | 'openai' | 'google' | 'xai'

interface AiCompleteRequest {
  system: string
  user: string
  model?: string
  maxTokens?: number
  temperature?: number
  provider?: AiProvider
}

interface AiCompleteResponse {
  text: string
  usage?: { input_tokens?: number; output_tokens?: number }
  provider: AiProvider
  model: string
}

interface AiSettings {
  activeProvider: AiProvider
  providers: { provider: AiProvider; hasKey: boolean }[]
}

interface AiGenerateImageRequest {
  prompt: string
  negativePrompt?: string
  size?: '1024x1024' | '1536x1024' | '1024x1536'
  quality?: 'low' | 'medium' | 'high' | 'auto'
  model?: string
  provider?: AiProvider
}

interface AiGenerateImageResponse {
  imageBase64: string
  mimeType: 'image/png' | 'image/webp' | 'image/jpeg'
  provider: AiProvider
  model: string
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
}

type DiffusionState =
  | 'unavailable'
  | 'no-model'
  | 'idle'
  | 'starting'
  | 'ready'
  | 'generating'
  | 'error'

interface DiffusionStatus {
  state: DiffusionState
  message?: string
  binaryPath: string | null
  availableModels: string[]
  activeModel: string | null
  port: number | null
}

interface DiffusionGenerateImageRequest {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  sampler?: 'euler' | 'euler_a' | 'dpm++2m' | 'dpm++2m_karras' | 'lcm'
  seed?: number
  loras?: { name: string; weight: number }[]
  model?: string
}

interface DiffusionGenerateImageResponse {
  imageBase64: string
  mimeType: 'image/png'
  width: number
  height: number
  durationMs: number
  model: string
  seed: number
}

interface DiffusionEditImageRequest extends DiffusionGenerateImageRequest {
  imageBase64: string
  strength?: number
}

type DiffusionEditImageResponse = DiffusionGenerateImageResponse

// ── Workshop / archive types ──────────────────────────────────────────────────

interface WorkshopItem {
  id: string
  dir: string
  sgaPath: string | null
}

interface StockArchive {
  id: string
  path: string
  size: number
}

// ── Steam types (mirrored from electron/steam.ts) ─────────────────────────────

interface SteamInitInfo {
  steamId: string
  personaName: string
  ownsApp: boolean
  installPath: string | null
}

type SteamInitError =
  | { code: 'no-steam'; message: string }
  | { code: 'no-game'; message: string }
  | { code: 'init-failed'; message: string }

type SteamInitResult =
  | { ok: true; info: SteamInitInfo }
  | { ok: false; error: SteamInitError }

interface PublishWorkshopInput {
  contentPath: string
  previewPath: string
  title: string
  description: string
  tags: string[]
  visibility?: 0 | 1 | 2 | 3
  changeNote?: string
}

interface PublishWorkshopResult {
  workshopId: string
  needsAgreement: boolean
}

interface UpdateWorkshopResult {
  needsAgreement: boolean
}

interface MyWorkshopItem {
  workshopId: string
  title: string
  description: string
  tags: string[]
  visibility: number
  timeUpdated: number
  previewUrl: string | null
  url: string
}

// ─────────────────────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('electronAPI', {
  // CoH2 install detection
  detectCoh2: (): Promise<string | null> => ipcRenderer.invoke('detect-coh2'),

  // Mods-folder detection (Documents/My Games/Company of Heroes 2/mods —
  // a different OS directory from the install). Live Sync writes built
  // SGAs here; auto-detect lets us skip the second directory picker for
  // users on Win32 or Proton-on-Linux.
  detectCoh2Mods: (): Promise<string | null> => ipcRenderer.invoke('detect-coh2-mods'),

  // Steam Workshop content folder for CoH2 (`.../steamapps/workshop/content/231430/`).
  // Used by the Template Picker to surface the user's subscribed workshop
  // items as seed templates when creating a new project.
  detectCoh2Workshop: (): Promise<string | null> => ipcRenderer.invoke('detect-coh2-workshop'),

  listWorkshopItems: (root: string): Promise<WorkshopItem[]> =>
    ipcRenderer.invoke('list-workshop-items', root),

  // Enumerate the stock CoH2 archives that ship with the base game.
  // Reads <installRoot>/CoH2/Archives/*.sga and returns id + path + size
  // for each. Cheap stat-only call — no archive parsing. Returns [] when
  // the Archives folder is missing or the app runs outside Electron.
  listStockArchives: (installRoot: string): Promise<StockArchive[]> =>
    ipcRenderer.invoke('list-stock-archives', installRoot),

  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('pick-directory'),

  // File system
  readFile: (p: string): Promise<ArrayBuffer> => ipcRenderer.invoke('read-file', p),
  readFileRange: (p: string, start: number, length: number): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('read-file-range', p, start, length),
  fileStat: (p: string): Promise<{ size: number } | null> => ipcRenderer.invoke('file-stat', p),
  listDir: (p: string): Promise<{ name: string; isDirectory: boolean }[]> =>
    ipcRenderer.invoke('list-dir', p),
  fileExists: (p: string): Promise<boolean> => ipcRenderer.invoke('file-exists', p),

  // Write a binary blob to disk, creating parent directories as needed.
  // Live Sync uses this to drop built .sga packs into mods/skins/ (skin
  // packs) or mods/faceplates/subscriptions/ (faceplates) — CoH2 reads
  // each item type from its own bucket, so faceplates dropped into
  // mods/extension/subscriptions/ are silently ignored.
  writeFile: (p: string, bytes: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('write-file', p, bytes),

  // Window controls
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),

  // Renderer-ready handshake: fired once the React tree has committed and
  // painted its first frame, so the main process knows it's safe to
  // surface the BrowserWindow. Without this, Electron shows the window on
  // Chromium's `ready-to-show` — which fires after the STATIC HTML
  // skeleton in index.html paints, not after the real ConnectScreen. The
  // user sees the unstyled fallback for a few hundred ms before React
  // hydrates over it. The signal closes that gap; main.tsx fires it on
  // the second rAF after `createRoot().render()` returns, by which point
  // React has committed the AuthShell + ConnectScreen subtree.
  signalRendererReady: (): void => {
    ipcRenderer.send('renderer-ready')
  },

  // AI provider bridge — API keys live in main process only, never
  // cross this boundary. `ai.complete` proxies through main which
  // signs the HTTP call with the decrypted key.
  ai: {
    getSettings: (): Promise<AiSettings> => ipcRenderer.invoke('ai:get-settings'),
    setActiveProvider: (p: AiProvider): Promise<boolean> =>
      ipcRenderer.invoke('ai:set-active-provider', p),
    setKey: (p: AiProvider, key: string): Promise<boolean> =>
      ipcRenderer.invoke('ai:set-key', p, key),
    clearKey: (p: AiProvider): Promise<boolean> => ipcRenderer.invoke('ai:clear-key', p),
    complete: (req: AiCompleteRequest): Promise<AiCompleteResponse> =>
      ipcRenderer.invoke('ai:complete', req),
    generateImage: (req: AiGenerateImageRequest): Promise<AiGenerateImageResponse> =>
      ipcRenderer.invoke('ai:generate-image', req),
  },

  // Tier-3 local diffusion bridge — routes to the DiffusionSidecar singleton
  // in main. The sidecar manages the sd-server child process lifecycle; the
  // renderer never talks to sd-server directly (it's bound to 127.0.0.1 but
  // cross-origin fetch is blocked by Electron's CSP anyway).
  diffusion: {
    getStatus: (): Promise<DiffusionStatus> => ipcRenderer.invoke('diffusion:get-status'),
    listModels: (): Promise<string[]> => ipcRenderer.invoke('diffusion:list-models'),
    listLoras: (): Promise<string[]> => ipcRenderer.invoke('diffusion:list-loras'),
    start: (model: string): Promise<DiffusionStatus> =>
      ipcRenderer.invoke('diffusion:start', model),
    stop: (): Promise<DiffusionStatus> => ipcRenderer.invoke('diffusion:stop'),
    generateImage: (
      req: DiffusionGenerateImageRequest,
    ): Promise<DiffusionGenerateImageResponse> =>
      ipcRenderer.invoke('diffusion:generate-image', req),
    editImage: (req: DiffusionEditImageRequest): Promise<DiffusionEditImageResponse> =>
      ipcRenderer.invoke('diffusion:edit-image', req),
    getBodyMask: (faction: string, vehicleId: string): Promise<string | null> =>
      ipcRenderer.invoke('diffusion:get-body-mask', faction, vehicleId),
  },

  // Steam Workshop bridge — Steam-first v1.0. The renderer calls
  // `steam.init()` from the StartScreen and dispatches to one of three
  // branches based on the discriminated failure code. `steam.workshop.publish`
  // is the critical-path fix for the multiplayer bug (real Workshop IDs
  // instead of fabricated ones that fail lobby validation).
  steam: {
    init: (): Promise<SteamInitResult> => ipcRenderer.invoke('steam:init'),
    reset: (): Promise<void> => ipcRenderer.invoke('steam:reset'),
    workshop: {
      publish: (input: PublishWorkshopInput): Promise<PublishWorkshopResult> =>
        ipcRenderer.invoke('steam:workshop:publish', input),
      update: (
        workshopId: string,
        input: PublishWorkshopInput,
      ): Promise<UpdateWorkshopResult> =>
        ipcRenderer.invoke('steam:workshop:update', workshopId, input),
      getMine: (): Promise<MyWorkshopItem[]> => ipcRenderer.invoke('steam:workshop:get-mine'),
    },
  },
})
