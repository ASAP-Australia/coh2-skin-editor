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

// ---------------------------------------------------------------------------
// Type declarations for the preload bridge
// ---------------------------------------------------------------------------

interface ElectronAPI {
  detectCoh2:    () => Promise<string | null>
  pickDirectory: () => Promise<string | null>
  readFile:      (p: string) => Promise<ArrayBuffer>
  listDir:       (p: string) => Promise<{ name: string; isDirectory: boolean }[]>
  fileExists:    (p: string) => Promise<boolean>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose:   () => Promise<void>
  isMaximized:   () => Promise<boolean>
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

function makeFileHandle(filePath: string): FileSystemFileHandle {
  return {
    name: filePath.split('/').pop() ?? filePath,
    kind: 'file' as const,
    isSameEntry: async () => false,
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,
    getFile: async () => {
      const buf = await api().readFile(filePath)
      const name = filePath.split(/[\\/]/).pop() ?? filePath
      return new File([buf], name)
    },
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
