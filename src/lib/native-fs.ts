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
  readFileRange: (p: string, start: number, length: number) => Promise<ArrayBuffer>
  fileStat:      (p: string) => Promise<{ size: number } | null>
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
