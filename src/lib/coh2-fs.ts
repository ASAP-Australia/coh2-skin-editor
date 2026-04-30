/**
 * File System Access API wrapper for the user's CoH2 installation.
 *
 * Browsers (Chrome/Edge) let a page persist a "directory handle" — a permission
 * grant the user gave us once. We store it in IndexedDB so subsequent visits
 * auto-scan the install with no further prompts.
 *
 * Two roots are interesting:
 *   1. The CoH2 Steam install (e.g. `…/Steam/steamapps/common/Company of Heroes 2/`)
 *      — has the game's compiled SGAs containing meshes (.rgm) and textures (.rgt)
 *   2. The user's CoH2 docs folder (e.g. `…/Documents/My Games/Company of Heroes 2/`)
 *      — has subscribed workshop skin packs we can show as references
 *
 * For v1 we ask for the install root once; both paths can be reached from
 * the same handle if the user picks a parent that includes both. Otherwise
 * we accept just the install root and skip workshop refs.
 */

const DB_NAME = 'coh2-skin-editor'
const DB_VER = 1
const STORE = 'handles'
const KEY_INSTALL = 'coh2-install'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER)
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE)
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    tx.onsuccess = () => resolve((tx.result ?? null) as T | null)
    tx.onerror = () => reject(tx.error)
  })
}
async function idbSet(key: string, val: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key)
    tx.onsuccess = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Test whether the FS Access API is available in this browser. */
export function isSupported(): boolean {
  return typeof (globalThis as any).showDirectoryPicker === 'function'
}

/** Returns the saved install handle, or null if none / permission expired. */
export async function loadSavedHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(KEY_INSTALL)
  if (!handle) return null
  // Verify the user still grants permission. With queryPermission we can
  // detect a revoked grant before we hit a hard error mid-scan.
  const status = await (handle as any).queryPermission?.({ mode: 'read' })
  if (status !== 'granted') {
    const re = await (handle as any).requestPermission?.({ mode: 'read' })
    if (re !== 'granted') return null
  }
  return handle
}

/** Prompt the user to pick their CoH2 install. Returns the handle if granted. */
export async function pickInstall(): Promise<FileSystemDirectoryHandle | null> {
  if (!isSupported()) {
    throw new Error('File System Access API not available — use Chrome, Edge, or another Chromium-based browser.')
  }
  const handle: FileSystemDirectoryHandle = await (globalThis as any).showDirectoryPicker({
    id: 'coh2-install',
    mode: 'read',
    startIn: 'documents',
  })
  await idbSet(KEY_INSTALL, handle)
  return handle
}

/** Walk a directory tree. Yields { path, file } for every file. */
export async function* walkDir(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<{ path: string; file: File }> {
  for await (const [name, entry] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    const path = prefix ? `${prefix}/${name}` : name
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile()
      yield { path, file }
    } else if (entry.kind === 'directory') {
      yield* walkDir(entry as FileSystemDirectoryHandle, path)
    }
  }
}

/** Try to find a file at a given relative path under the root handle.
 *  Returns null if not found. */
export async function findFile(
  root: FileSystemDirectoryHandle,
  relPath: string,
): Promise<File | null> {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean)
  let cur: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      cur = await cur.getDirectoryHandle(parts[i])
    } catch {
      return null
    }
  }
  try {
    const fh = await cur.getFileHandle(parts[parts.length - 1])
    return await fh.getFile()
  } catch {
    return null
  }
}

/** Locate the CoH2 install's archive directory. The user might have picked
 *  the Steam app folder or a parent — we try a few common layouts. */
export async function locateArchives(
  root: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> {
  const candidates = [
    ['CoH2', 'Archives'],
    ['Archives'],
    ['Company of Heroes 2', 'CoH2', 'Archives'],
    ['common', 'Company of Heroes 2', 'CoH2', 'Archives'],
  ]
  for (const path of candidates) {
    let cur: FileSystemDirectoryHandle | null = root
    for (const seg of path) {
      try {
        cur = await cur!.getDirectoryHandle(seg)
      } catch {
        cur = null
        break
      }
    }
    if (cur) return cur
  }
  return null
}
