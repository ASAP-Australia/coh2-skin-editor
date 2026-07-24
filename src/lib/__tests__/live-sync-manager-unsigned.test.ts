/**
 * live-sync-manager-unsigned.test.ts — R3b manager-level regression test.
 *
 * Verifies that when hasKeyPool() returns false:
 *   schedule() → (debounce fires) → _runSync reaches _writeFile with unsigned
 *   exportSkinPack output → state transitions to 'synced'.
 *
 * This is a MANAGER-LEVEL test: it drives the full schedule() → _runSync()
 * pipeline, exercising the path that the previous live-sync-fallback.test.ts
 * missed (which only tested the _build() branch in isolation and could not
 * catch an upstream gate short-circuiting before _build was reached).
 *
 * Mock topology:
 *   - @/lib/native-fs: isElectron → true, detectModsPath → '/fake/mods',
 *     nativePathToHandle → stub handle, writeFile → captures calls
 *   - @/lib/mod-export: hasKeyPool → false, exportSkinPack → fake bytes,
 *     patchExport → should never be called
 *   - All other dynamic imports (_build faceplate/decal branch, FaceplateEditor,
 *     atlas-parts) are stubbed at the vi.mock level so only the skin path runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── IndexedDB stub ────────────────────────────────────────────────────────────
// live-sync._build() calls idbGetHandle('coh2-install') to look up the game
// install directory handle. jsdom provides an `indexedDB` object but it
// is not functional; the open() request never fires its callbacks, so the
// live-sync code hangs. Provide a minimal stub that:
//   - Opens a database synchronously (fires onsuccess)
//   - Returns undefined (i.e. null) for any object-store get
// This makes idbGetHandle resolve with null, which is the normal case in
// Electron where the install path is auto-detected via detectInstallPath().
function makeIdbStub() {
  const store: Record<string, unknown> = {}

  // Fire callbacks via queueMicrotask so they resolve within the same Promise
  // micro-task queue turn rather than waiting for a setTimeout tick (which
  // fake timers hold). This allows vi.runAllTimersAsync() to drain the chains.
  const makeRequest = (result: unknown): IDBRequest => {
    const req: { result: unknown; error: null; onsuccess?: (e: Event) => void } = {
      result,
      error: null,
    }
    queueMicrotask(() => {
      if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event)
    })
    return req as unknown as IDBRequest
  }

  const objectStore = {
    get: (key: unknown) => makeRequest(store[String(key)]),
    put: (_val: unknown, key: unknown) => {
      store[String(key)] = _val
      return makeRequest(undefined)
    },
  }

  const db = {
    transaction: () => ({ objectStore: () => objectStore }),
    objectStoreNames: { contains: () => true },
  }

  const open = (): IDBOpenDBRequest => {
    const req: { result: typeof db; error: null; onsuccess?: (e: Event) => void; onupgradeneeded?: (e: Event) => void } = {
      result: db,
      error: null,
    }
    queueMicrotask(() => {
      if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event)
    })
    return req as unknown as IDBOpenDBRequest
  }

  return { open } as unknown as IDBFactory
}

// ── Static mocks (must be top-level so vitest hoists them) ───────────────────

const FAKE_SGA = new Uint8Array([0x53, 0x47, 0x41, 0x21]) // "SGA!"
const FAKE_FILENAME = '1000000000000001.sga'
const FAKE_MODS_PATH = '/fake/mods'

const writeFileMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/native-fs', () => ({
  isElectron: () => true,
  detectModsPath: vi.fn().mockResolvedValue(FAKE_MODS_PATH),
  detectInstallPath: vi.fn().mockResolvedValue('/fake/install'),
  nativePathToHandle: vi.fn().mockReturnValue({ kind: 'directory' } as unknown as FileSystemDirectoryHandle),
  writeFile: writeFileMock,
  makeTmpPublishDir: vi.fn().mockResolvedValue('/tmp/fake-publish'),
}))

vi.mock('@/lib/mod-export', () => ({
  hasSigningKeys: vi.fn().mockResolvedValue(false),
  hasKeyPool: vi.fn().mockResolvedValue(false),
  exportSkinPack: vi.fn().mockResolvedValue({
    bytes: FAKE_SGA,
    filename: FAKE_FILENAME,
    modGuid: 'a'.repeat(32),
    numericId: '1000000000000001',
    textureCount: 0,
  }),
  patchExport: vi.fn().mockRejectedValue(new Error('patchExport should not be called')),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LiveSyncManager — unsigned fallback end-to-end (R3b manager level)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    writeFileMock.mockClear()
    // Inject the IDB stub so idbGetHandle resolves with null (no stored handle)
    // rather than throwing "indexedDB is not defined" in the jsdom environment.
    Object.defineProperty(globalThis, 'indexedDB', {
      value: makeIdbStub(),
      writable: true,
      configurable: true,
    })
    // Reset the singleton between tests so mocks are applied cleanly.
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedule() → debounce → writeFile called with unsigned SGA → state synced', async () => {
    // Fresh singleton with mocks applied.
    const { getLiveSyncManager, scheduleLiveSync, _resetLiveSyncManagerForTest } =
      await import('@/lib/live-sync')

    // Reset any leftover singleton from a prior test in this suite.
    _resetLiveSyncManagerForTest()
    const mgr = getLiveSyncManager()

    // Minimal skin project.  _build() only uses project.id for the stable
    // numeric id; the vehicles/decal fields are irrelevant for the mock.
    const fakeProject = {
      id: 'test-skin-1',
      kind: 'skin',
      packName: 'Test Skin',
      packDescription: '',
      workshopId: undefined,
      vehicles: {},
      exportSlots: [],
      vehicleIcons: {},
    } as unknown as Parameters<typeof scheduleLiveSync>[1]

    scheduleLiveSync('skin', fakeProject)

    // The manager should enter 'queued' synchronously after schedule().
    expect(mgr.getSnapshot().state).toBe('queued')

    // Advance past the 1500 ms debounce to fire _runSync.
    vi.advanceTimersByTime(1600)

    // _runSync is fully async: it chains detectModsPath (mock Promise) +
    // idbGetHandle (queueMicrotask-based) + exportSkinPack (mock Promise) +
    // writeFile (mock Promise). Flush all pending microtasks by awaiting a
    // chain of resolved Promises — each `await Promise.resolve()` drains one
    // layer of the microtask queue. We repeat enough times to clear the full
    // async chain (IDB stub uses 2 queueMicrotask hops per open+get call,
    // plus one per mock Promise resolve).
    for (let i = 0; i < 30; i++) {
      await Promise.resolve()
    }

    // 1. writeFile must have been called — the unsigned SGA was written.
    expect(writeFileMock).toHaveBeenCalledTimes(1)

    // 2. The path written must be under mods/skins/.
    const writtenPath = writeFileMock.mock.calls[0][0] as string
    const writtenBytes = writeFileMock.mock.calls[0][1] as Uint8Array
    expect(writtenPath).toContain(`${FAKE_MODS_PATH}/skins/`)
    expect(writtenPath).toMatch(/\.sga$/)

    // 3. The bytes written are the unsigned mock output (not patchExport's output).
    expect(writtenBytes).toBe(FAKE_SGA)

    // 4. State must be 'synced' — not 'idle' with the tooltip gate.
    const snap = mgr.getSnapshot()
    expect(snap.state).toBe('synced')
    expect(snap.reason).toMatch(/synced/i)
  })

  it('patchExport is never called when hasKeyPool returns false', async () => {
    const { _resetLiveSyncManagerForTest, scheduleLiveSync } = await import('@/lib/live-sync')
    const { patchExport } = await import('@/lib/mod-export')

    _resetLiveSyncManagerForTest()

    const fakeProject = {
      id: 'test-skin-2',
      kind: 'skin',
      packName: 'Patch Test',
      packDescription: '',
      workshopId: undefined,
      vehicles: {},
      exportSlots: [],
      vehicleIcons: {},
    } as unknown as Parameters<typeof scheduleLiveSync>[1]

    scheduleLiveSync('skin', fakeProject)
    vi.advanceTimersByTime(1600)
    // Drain microtask chains (same as the first test).
    for (let i = 0; i < 30; i++) {
      await Promise.resolve()
    }

    expect(vi.mocked(patchExport)).not.toHaveBeenCalled()
  })
})
