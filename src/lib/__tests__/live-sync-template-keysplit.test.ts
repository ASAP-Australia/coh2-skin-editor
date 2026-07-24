/**
 * live-sync-template-keysplit.test.ts
 *
 * Manager-level tests for the decoupled template / signing-key dependency:
 *
 *   - template present + signing keys ABSENT  →  exportSkinPack (unsigned) is
 *     called, writeFile invoked with unsigned SGA bytes, state reaches 'synced'.
 *     The title-pill must NOT show "requires the signing template".
 *
 *   - template present + signing keys PRESENT →  patchExport (signed) is
 *     called, writeFile invoked with signed SGA bytes, state reaches 'synced'.
 *
 * "Template present" is the normal case for a correctly packaged AppImage:
 * template_0001.sga is bundled as an extraResource.  We model that here by
 * having getResourcesPath return a fake path and electronAPI.readFile resolve
 * successfully — the test never touches the actual 377 MB file.
 *
 * Test topology mirrors live-sync-manager-unsigned.test.ts:
 *   - @/lib/native-fs: isElectron → true, detectModsPath → fake path,
 *     nativePathToHandle → stub handle, writeFile → captures calls
 *   - @/lib/mod-export: hasSigningKeys controllable per test,
 *     exportSkinPack → fake unsigned bytes,
 *     patchExport → fake signed bytes
 *   - window.electronAPI.getResourcesPath → fake resources path
 *   - window.electronAPI.readFile → fake template SGA bytes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── IndexedDB stub (same as live-sync-manager-unsigned.test.ts) ──────────────
function makeIdbStub() {
  const store: Record<string, unknown> = {}
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

// ── Constants ─────────────────────────────────────────────────────────────────
const FAKE_UNSIGNED_SGA = new Uint8Array([0x55, 0x4e, 0x53, 0x47]) // "UNSG"
const FAKE_SIGNED_SGA   = new Uint8Array([0x53, 0x47, 0x4e, 0x44]) // "SGND"
const FAKE_UNSIGNED_FILENAME = '1500000000000001.sga'
const FAKE_SIGNED_FILENAME   = '1500000000000002.sga'
const FAKE_MODS_PATH     = '/fake/mods'
const FAKE_RESOURCES_PATH = '/fake/resources'
const FAKE_TEMPLATE_BYTES = new Uint8Array([0x53, 0x47, 0x41, 0x5f, 0x54, 0x4d, 0x50, 0x4c]) // "SGA_TMPL"

// ── Static mocks ──────────────────────────────────────────────────────────────
const writeFileMock = vi.fn().mockResolvedValue(undefined)
const hasSigningKeysMock = vi.fn()
const exportSkinPackMock = vi.fn()
const patchExportMock = vi.fn()

vi.mock('@/lib/native-fs', () => ({
  isElectron: () => true,
  detectModsPath: vi.fn().mockResolvedValue(FAKE_MODS_PATH),
  detectInstallPath: vi.fn().mockResolvedValue('/fake/install'),
  nativePathToHandle: vi.fn().mockReturnValue({ kind: 'directory' } as unknown as FileSystemDirectoryHandle),
  writeFile: writeFileMock,
  makeTmpPublishDir: vi.fn().mockResolvedValue('/tmp/fake-publish'),
}))

vi.mock('@/lib/mod-export', () => ({
  hasSigningKeys: hasSigningKeysMock,
  hasKeyPool: hasSigningKeysMock,
  exportSkinPack: exportSkinPackMock,
  patchExport: patchExportMock,
  resolveTemplateSgaPath: vi.fn().mockResolvedValue(`${FAKE_RESOURCES_PATH}/keys/template_0001.sga`),
}))

// ── Minimal fake skin project ─────────────────────────────────────────────────
function makeFakeProject(id: string) {
  return {
    id,
    kind: 'skin',
    packName: 'Test',
    packDescription: '',
    workshopId: undefined,
    vehicles: {},
    exportSlots: [],
    vehicleIcons: {},
  }
}

// ── Flush async chains ────────────────────────────────────────────────────────
async function flushAsync(n = 60) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LiveSyncManager — template present, signing keys ABSENT → unsigned path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    writeFileMock.mockClear()
    exportSkinPackMock.mockClear()
    patchExportMock.mockClear()

    // keys absent
    hasSigningKeysMock.mockResolvedValue(false)

    exportSkinPackMock.mockResolvedValue({
      bytes: FAKE_UNSIGNED_SGA,
      filename: FAKE_UNSIGNED_FILENAME,
      modGuid: 'a'.repeat(32),
      numericId: '1500000000000001',
      textureCount: 0,
    })
    patchExportMock.mockRejectedValue(new Error('patchExport must not be called'))

    // Inject functional IDB stub
    Object.defineProperty(globalThis, 'indexedDB', {
      value: makeIdbStub(),
      writable: true,
      configurable: true,
    })

    // Stub electronAPI on the existing window (do NOT replace window itself —
    // replacing window after vi.useFakeTimers() breaks fake setTimeout).
    Object.defineProperty(window, 'electronAPI', {
      value: {
        getResourcesPath: vi.fn().mockResolvedValue(FAKE_RESOURCES_PATH),
        readFile: vi.fn().mockResolvedValue(FAKE_TEMPLATE_BYTES.buffer),
      },
      writable: true,
      configurable: true,
    })

    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writeFile called with unsigned SGA → state synced (not "requires signing template")', async () => {
    const { getLiveSyncManager, scheduleLiveSync, _resetLiveSyncManagerForTest } =
      await import('@/lib/live-sync')

    _resetLiveSyncManagerForTest()
    const mgr = getLiveSyncManager()

    scheduleLiveSync('skin', makeFakeProject('keysplit-test-1') as never)
    expect(mgr.getSnapshot().state).toBe('queued')

    vi.advanceTimersByTime(1600)
    await flushAsync()

    // unsigned SGA must have been written
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const writtenPath = writeFileMock.mock.calls[0][0] as string
    const writtenBytes = writeFileMock.mock.calls[0][1] as Uint8Array
    expect(writtenPath).toContain(`${FAKE_MODS_PATH}/skins/`)
    expect(writtenPath).toMatch(/\.sga$/)
    expect(writtenBytes).toBe(FAKE_UNSIGNED_SGA)

    // state must be synced — NOT idle with "requires signing template"
    const snap = mgr.getSnapshot()
    expect(snap.state).toBe('synced')
    expect(snap.reason).not.toMatch(/requires.*signing/i)
    expect(snap.reason).not.toMatch(/requires.*template/i)
  })

  it('patchExport is NOT called when signing keys are absent', async () => {
    const { _resetLiveSyncManagerForTest, scheduleLiveSync } = await import('@/lib/live-sync')
    _resetLiveSyncManagerForTest()

    scheduleLiveSync('skin', makeFakeProject('keysplit-test-2') as never)
    vi.advanceTimersByTime(1600)
    await flushAsync()

    expect(patchExportMock).not.toHaveBeenCalled()
  })
})

describe('LiveSyncManager — template present, signing keys PRESENT → signed path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    writeFileMock.mockClear()
    exportSkinPackMock.mockClear()
    patchExportMock.mockClear()

    // keys present
    hasSigningKeysMock.mockResolvedValue(true)

    patchExportMock.mockResolvedValue({
      bytes: FAKE_SIGNED_SGA,
      filename: FAKE_SIGNED_FILENAME,
      modGuid: 'b'.repeat(32),
      numericId: '1500000000000002',
      textureCount: 0,
    })
    exportSkinPackMock.mockRejectedValue(new Error('exportSkinPack must not be called'))

    Object.defineProperty(globalThis, 'indexedDB', {
      value: makeIdbStub(),
      writable: true,
      configurable: true,
    })

    // Stub electronAPI on the existing window (do NOT replace window itself)
    Object.defineProperty(window, 'electronAPI', {
      value: {
        getResourcesPath: vi.fn().mockResolvedValue(FAKE_RESOURCES_PATH),
        readFile: vi.fn().mockResolvedValue(FAKE_TEMPLATE_BYTES.buffer),
      },
      writable: true,
      configurable: true,
    })

    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writeFile called with signed SGA → state synced', async () => {
    const { getLiveSyncManager, scheduleLiveSync, _resetLiveSyncManagerForTest } =
      await import('@/lib/live-sync')

    _resetLiveSyncManagerForTest()
    const mgr = getLiveSyncManager()

    scheduleLiveSync('skin', makeFakeProject('keysplit-test-3') as never)
    expect(mgr.getSnapshot().state).toBe('queued')

    vi.advanceTimersByTime(1600)
    await flushAsync()

    const snap = mgr.getSnapshot()
    expect(snap.state).toBe('synced')

    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const writtenPath = writeFileMock.mock.calls[0][0] as string
    const writtenBytes = writeFileMock.mock.calls[0][1] as Uint8Array
    expect(writtenPath).toContain(`${FAKE_MODS_PATH}/skins/`)
    expect(writtenBytes).toBe(FAKE_SIGNED_SGA)
  })

  it('exportSkinPack is NOT called when signing keys are present', async () => {
    const { _resetLiveSyncManagerForTest, scheduleLiveSync } = await import('@/lib/live-sync')
    _resetLiveSyncManagerForTest()

    scheduleLiveSync('skin', makeFakeProject('keysplit-test-4') as never)
    vi.advanceTimersByTime(1600)
    await flushAsync()

    expect(exportSkinPackMock).not.toHaveBeenCalled()
  })
})
