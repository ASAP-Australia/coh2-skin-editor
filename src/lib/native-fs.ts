/**
 * native-fs.ts — Electron IPC-based file system layer.
 *
 * When the app runs inside Electron, `window.electronAPI` is injected by the
 * preload script. This module wraps those IPC calls in duck-typed objects that
 * satisfy the same FileSystemDirectoryHandle / FileSystemFileHandle interface
 * used by the SGA parser and the rest of the app — so zero other code changes.
 *
 * When running as a plain web page the functions are no-ops / return null.
 */

import type {
  AiProvider,
  AiCompleteRequest,
  AiCompleteResponse,
  AiSettings,
  AiGenerateImageRequest,
  AiGenerateImageResponse,
  DiffusionStatus,
  DiffusionGenerateImageRequest,
  DiffusionGenerateImageResponse,
  DiffusionEditImageRequest,
  DiffusionEditImageResponse,
} from './ai/types'

// ---------------------------------------------------------------------------
// Workshop / stock-archive types (mirrored from electron/detect-coh2.ts)
// ---------------------------------------------------------------------------

export interface WorkshopItem {
  /** Numeric Workshop ID (folder name under content/231430/). */
  id: string
  /** Absolute path to the workshop item's directory. */
  dir: string
  /** Absolute path to the .sga archive inside the item dir, or null when
   *  no .sga is present. */
  sgaPath: string | null
}

export interface StockArchive {
  /** Filename without extension — used as the template option `name`. */
  id: string
  /** Absolute path to the .sga archive. */
  path: string
  /** Approximate size in bytes (from fs.statSync). */
  size: number
}

// ---------------------------------------------------------------------------
// Steam Workshop bridge (mirrored from electron/steam.ts)
// ---------------------------------------------------------------------------

export interface SteamInitInfo {
  steamId: string
  personaName: string
  ownsApp: boolean
  installPath: string | null
}

export type SteamInitError =
  | { code: 'no-steam'; message: string }
  | { code: 'no-game'; message: string }
  | { code: 'init-failed'; message: string }

export type SteamInitResult =
  | { ok: true; info: SteamInitInfo }
  | { ok: false; error: SteamInitError }

export interface PublishWorkshopInput {
  contentPath: string
  previewPath: string
  title: string
  description: string
  tags: string[]
  /** `0` Public, `1` FriendsOnly, `2` Private, `3` Unlisted. Default Public. */
  visibility?: 0 | 1 | 2 | 3
  changeNote?: string
}

export interface PublishWorkshopResult {
  workshopId: string
  needsAgreement: boolean
}

export interface UpdateWorkshopResult {
  needsAgreement: boolean
}

export interface MyWorkshopItem {
  workshopId: string
  title: string
  description: string
  tags: string[]
  visibility: number
  /** Unix seconds. */
  timeUpdated: number
  previewUrl: string | null
  url: string
}

// ---------------------------------------------------------------------------
// Type declarations for the preload bridge
// ---------------------------------------------------------------------------

interface ElectronAiNamespace {
  getSettings: () => Promise<AiSettings>
  setActiveProvider: (p: AiProvider) => Promise<boolean>
  setKey: (p: AiProvider, key: string) => Promise<boolean>
  clearKey: (p: AiProvider) => Promise<boolean>
  complete: (req: AiCompleteRequest) => Promise<AiCompleteResponse>
  generateImage: (req: AiGenerateImageRequest) => Promise<AiGenerateImageResponse>
}

interface ElectronDiffusionNamespace {
  getStatus: () => Promise<DiffusionStatus>
  listModels: () => Promise<string[]>
  listLoras: () => Promise<string[]>
  start: (model: string) => Promise<DiffusionStatus>
  stop: () => Promise<DiffusionStatus>
  generateImage: (req: DiffusionGenerateImageRequest) => Promise<DiffusionGenerateImageResponse>
  editImage: (req: DiffusionEditImageRequest) => Promise<DiffusionEditImageResponse>
  getBodyMask: (faction: string, vehicleId: string) => Promise<string | null>
}

interface ElectronSteamWorkshopNamespace {
  publish: (input: PublishWorkshopInput) => Promise<PublishWorkshopResult>
  update: (workshopId: string, input: PublishWorkshopInput) => Promise<UpdateWorkshopResult>
  getMine: () => Promise<MyWorkshopItem[]>
}

interface ElectronSteamNamespace {
  init: () => Promise<SteamInitResult>
  reset: () => Promise<void>
  workshop: ElectronSteamWorkshopNamespace
}

// Mods-folder migration types — mirror electron/mods-wipe.ts.
export type FakeIdKind = 'decals' | 'faceplates' | 'extension' | 'skins'

export interface FakeIdEntry {
  kind: FakeIdKind
  path: string
  id: string
  size: number
  reason: 'non-numeric-basename' | 'numeric-above-threshold'
}

export interface TrashResult {
  trashed: string[]
  failed: { path: string; error: string }[]
}

interface ElectronModsNamespace {
  scanFakeIds: (modsRoot: string) => Promise<FakeIdEntry[]>
  trashFakeIds: (paths: string[], modsRoot: string) => Promise<TrashResult>
}

interface ElectronAPI {
  detectCoh2:         () => Promise<string | null>
  detectCoh2Mods:     () => Promise<string | null>
  detectCoh2Workshop: () => Promise<string | null>
  listWorkshopItems:  (root: string) => Promise<WorkshopItem[]>
  listStockArchives:  (installRoot: string) => Promise<StockArchive[]>
  pickDirectory:      () => Promise<string | null>
  readFile:      (p: string) => Promise<ArrayBuffer>
  readFileRange: (p: string, start: number, length: number) => Promise<ArrayBuffer>
  fileStat:      (p: string) => Promise<{ size: number } | null>
  listDir:       (p: string) => Promise<{ name: string; isDirectory: boolean }[]>
  fileExists:    (p: string) => Promise<boolean>
  writeFile:     (p: string, bytes: ArrayBuffer) => Promise<void>
  /** Create a fresh temporary directory for Workshop content staging.
   *  Returns the absolute path. Used by PublishToWorkshopDialog before
   *  calling steam.workshop.publish. */
  makeTmpPublishDir: () => Promise<string>
  windowMinimize:     () => Promise<void>
  windowMaximize:     () => Promise<void>
  windowClose:        () => Promise<void>
  isMaximized:        () => Promise<boolean>
  signalRendererReady: () => void
  ai:        ElectronAiNamespace
  diffusion: ElectronDiffusionNamespace
  steam:     ElectronSteamNamespace
  mods:      ElectronModsNamespace
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
}

function api(): ElectronAPI {
  if (!window.electronAPI) throw new Error('Not in Electron context')
  return window.electronAPI
}

// ---------------------------------------------------------------------------
// CoH2 path detection / picking
// ---------------------------------------------------------------------------

export async function detectInstallPath(): Promise<string | null> {
  if (!isElectron()) return null
  return api().detectCoh2()
}

export async function pickInstallPathNative(): Promise<string | null> {
  if (!isElectron()) return null
  return api().pickDirectory()
}

// ---------------------------------------------------------------------------
// Duck-typed FileSystemFileHandle backed by IPC reads
// ---------------------------------------------------------------------------

/** Build a File-shaped object whose .slice() reads only the requested range
 *  via IPC. CoH2 archives are huge (multi-hundred MB) — without this lazy
 *  slicing, every SgaArchive.open() would transfer the whole file across
 *  the IPC bridge into renderer memory just to read the few KB of TOC. */
async function makeNativeFile(filePath: string): Promise<File> {
  const stat = await api().fileStat(filePath)
  const size = stat?.size ?? 0
  const name = filePath.split(/[\\/]/).pop() ?? filePath

  // We can't construct a real File whose slice reads ranged bytes, so we
  // duck-type a Blob that the SGA reader will accept (it only calls
  // .slice(start, end).arrayBuffer()). The cast through `unknown` is
  // intentional — the structural surface we expose matches what the
  // consumer needs.
  function makeBlob(start: number, end: number): Blob {
    return {
      size: end - start,
      slice(s = 0, e?: number) {
        const subEnd = e ?? (end - start)
        return makeBlob(start + s, start + subEnd)
      },
      arrayBuffer: async () => api().readFileRange(filePath, start, end - start),
    } as unknown as Blob
  }

  const blob = makeBlob(0, size)
  return Object.assign(blob, { name }) as unknown as File
}

function makeFileHandle(filePath: string): FileSystemFileHandle {
  return {
    name: filePath.split('/').pop() ?? filePath,
    kind: 'file' as const,
    isSameEntry: async () => false,
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,
    getFile: async () => makeNativeFile(filePath),
    createWritable: async () => { throw new Error('read-only in Electron IPC layer') },
  } as unknown as FileSystemFileHandle
}

// ---------------------------------------------------------------------------
// Duck-typed FileSystemDirectoryHandle backed by IPC
// ---------------------------------------------------------------------------

export function nativePathToHandle(dirPath: string): FileSystemDirectoryHandle {
  // Normalise to forward slashes for consistency
  const norm = dirPath.replace(/\\/g, '/')

  return {
    name: norm.split('/').pop() ?? norm,
    kind: 'directory' as const,
    isSameEntry: async () => false,
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,

    getDirectoryHandle: async (name: string, _opts?: FileSystemGetDirectoryOptions) => {
      return nativePathToHandle(`${norm}/${name}`)
    },

    getFileHandle: async (name: string, _opts?: FileSystemGetFileOptions) => {
      return makeFileHandle(`${norm}/${name}`)
    },

    removeEntry: async () => { throw new Error('read-only') },
    resolve:     async () => null,

    entries: async function* () {
      const items = await api().listDir(norm)
      for (const item of items) {
        const fullPath = `${norm}/${item.name}`
        const handle = item.isDirectory
          ? nativePathToHandle(fullPath)
          : makeFileHandle(fullPath)
        yield [item.name, handle] as [string, FileSystemHandle]
      }
    },

    keys: async function* () {
      const items = await api().listDir(norm)
      for (const item of items) yield item.name
    },

    values: async function* () {
      const items = await api().listDir(norm)
      for (const item of items) {
        const fullPath = `${norm}/${item.name}`
        yield item.isDirectory ? nativePathToHandle(fullPath) : makeFileHandle(fullPath)
      }
    },

    [Symbol.asyncIterator]: async function* () {
      const items = await api().listDir(norm)
      for (const item of items) {
        const fullPath = `${norm}/${item.name}`
        const handle = item.isDirectory
          ? nativePathToHandle(fullPath)
          : makeFileHandle(fullPath)
        yield [item.name, handle] as [string, FileSystemHandle]
      }
    },
  } as unknown as FileSystemDirectoryHandle
}

// ---------------------------------------------------------------------------
// New convenience wrappers (added to close the lost surface)
// ---------------------------------------------------------------------------

/** Detect the CoH2 mods folder path (Documents/My Games/Company of Heroes 2/mods).
 *  Returns null outside Electron or when detection fails. */
export async function detectModsPath(): Promise<string | null> {
  if (!isElectron()) return null
  return api().detectCoh2Mods()
}

/** Detect the Steam Workshop content folder for CoH2.
 *  Returns null outside Electron or when not found. */
export async function detectWorkshopPath(): Promise<string | null> {
  if (!isElectron()) return null
  return api().detectCoh2Workshop()
}

/** Enumerate workshop items under the given root directory.
 *  Returns [] outside Electron. */
export async function listWorkshopItems(root: string): Promise<WorkshopItem[]> {
  if (!isElectron()) return []
  return api().listWorkshopItems(root)
}

/** Enumerate the stock CoH2 archives under the given install root.
 *  Returns [] outside Electron. */
export async function listStockArchives(installRoot: string): Promise<StockArchive[]> {
  if (!isElectron()) return []
  return api().listStockArchives(installRoot)
}

/** Create a fresh temporary directory for Workshop content staging.
 *  Returns the absolute path; throws when not in Electron. */
export async function makeTmpPublishDir(): Promise<string> {
  if (!isElectron()) throw new Error('Not in Electron context')
  return api().makeTmpPublishDir()
}

/** Write binary bytes to a path on disk, creating parent directories as needed.
 *  No-op outside Electron. */
export async function writeFile(p: string, bytes: ArrayBuffer | Uint8Array): Promise<void> {
  if (!isElectron()) return
  // Normalise Uint8Array → plain ArrayBuffer for the IPC bridge.
  // The `.slice()` call on a SharedArrayBuffer-backed Uint8Array would return
  // ArrayBuffer, but TypeScript types it as ArrayBuffer | SharedArrayBuffer,
  // so we use the Uint8Array constructor instead which always gives an owned
  // ArrayBuffer.
  const buf: ArrayBuffer = bytes instanceof Uint8Array
    ? new Uint8Array(bytes).buffer as ArrayBuffer
    : bytes
  return api().writeFile(p, buf)
}
