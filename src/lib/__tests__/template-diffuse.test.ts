/**
 * Tests for template-diffuse.ts helpers.
 *
 * We test:
 *   1. rgtBytesToDataUrl — mock parseRgtHeader + decodeRgtFullOffThread +
 *      canvas so the pure logic is verified without real RGT bytes.
 *   2. readStockDiffuseDataUrl — mock SgaArchive.open + getPreloadedArchive
 *      so it returns a non-null dataURL on a valid stock skin entry.
 *   3. readWorkshopDiffuseDataUrlBySgaPath — mock nativeFileFromPath +
 *      SgaArchive.open.
 *
 * We do NOT require a real SGA / CoH2 install; all archive I/O is mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { listStockSkins } from '../stock-skins'

// ── ImageData polyfill ────────────────────────────────────────────────────────
// jsdom does NOT provide `ImageData` as a global constructor. The production
// code calls `new ImageData(data, w, h)` inside rgtBytesToDataUrl, which throws
// a ReferenceError in jsdom and causes the entire function to return null via
// its catch-all. We polyfill globalThis.ImageData with node-canvas's ImageData
// (the same approach used in icon-atlas-composite.test.ts) so the constructor
// call succeeds.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCanvas = require('canvas') as typeof import('canvas')
let _savedImageData: unknown

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../decode-pool', () => ({
  decodeRgtFullOffThread: vi.fn(async (header: { width: number; height: number }) => ({
    rgba: new Uint8ClampedArray(header.width * header.height * 4).fill(128),
    width: header.width,
    height: header.height,
    isSRGB: true,
    fourCC: 'DXT5',
  })),
}))

vi.mock('../rgt-core', () => ({
  parseRgtHeader: vi.fn((_bytes: Uint8Array) => ({
    width: 4,
    height: 4,
    formatCode: 15,
    compressed: new Uint8Array(16),
  })),
}))

const mockReadByPath = vi.fn<() => Promise<Uint8Array | null>>()
const mockListPaths = vi.fn<() => string[]>()
const mockArchiveInstance = {
  readByPath: mockReadByPath,
  listPaths: mockListPaths,
  archiveName: 'MockArchive',
}
vi.mock('../sga', () => ({
  SgaArchive: {
    open: vi.fn(async () => mockArchiveInstance),
  },
}))

let _mockGetPreloadedArchiveReturn: unknown = null
vi.mock('../preload', () => ({
  getPreloadedArchive: vi.fn(() => _mockGetPreloadedArchiveReturn),
  cacheArchive: vi.fn(),
}))

let _mockNativeFileReturn: File | null = null
vi.mock('../native-fs', () => ({
  nativeFileFromPath: vi.fn(async () => _mockNativeFileReturn),
}))

vi.mock('../coh2-fs', () => ({
  locateArchives: vi.fn(async () => ({
    getFileHandle: vi.fn(async () => ({
      getFile: vi.fn(async () => new File([], 'fake.sga')),
    })),
  })),
}))

// ── canvas mock ───────────────────────────────────────────────────────────────
// jsdom does not implement a real 2D canvas context; getContext('2d') returns
// null, causing rgtBytesToDataUrl to return null. We intercept
// document.createElement so that 'canvas' requests return a fake canvas with
// a working mock context. The spy is installed before ALL tests and removed
// after. Each beforeEach re-primes the return values so clearAllMocks in
// individual tests can't break the base happy-path behaviour.
const FAKE_DATA_URL = 'data:image/png;base64,FAKE'

// We declare these as module-scope variables so they can be re-wired in
// individual tests (e.g. to simulate getContext returning null).
type FakeCtx = { putImageData: ReturnType<typeof vi.fn> }
let activeCtx: FakeCtx = { putImageData: vi.fn() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeGetContext: (...args: any[]) => FakeCtx | null = vi.fn(() => activeCtx)
let activeToDataURL = vi.fn(() => FAKE_DATA_URL)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let canvasSpy: any
const origCreateElement = document.createElement.bind(document)

beforeAll(() => {
  // Polyfill globalThis.ImageData so `new ImageData(data, w, h)` inside
  // rgtBytesToDataUrl doesn't throw (jsdom does not expose ImageData globally).
  _savedImageData = (globalThis as unknown as Record<string, unknown>).ImageData
  ;(globalThis as unknown as Record<string, unknown>).ImageData =
    nodeCanvas.ImageData as unknown

  canvasSpy = vi.spyOn(document, 'createElement').mockImplementation(
    (tag: string, ...rest: unknown[]) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: (...args: unknown[]) => activeGetContext(...args),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toDataURL: (...args: unknown[]) => (activeToDataURL as (...a: any[]) => string)(...args),
        } as unknown as HTMLElement
      }
      return origCreateElement(tag, ...(rest as [ElementCreationOptions?]))
    },
  )
})

afterAll(() => {
  canvasSpy.mockRestore()
  ;(globalThis as unknown as Record<string, unknown>).ImageData = _savedImageData
})

// ── Fake install root ─────────────────────────────────────────────────────────
const fakeInstallRoot = {} as FileSystemDirectoryHandle

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rgtBytesToDataUrl', () => {
  beforeEach(() => {
    // Prime defaults for the canvas mock.
    activeCtx = { putImageData: vi.fn() }
    activeGetContext = vi.fn(() => activeCtx)
    activeToDataURL = vi.fn(() => FAKE_DATA_URL)
    // Reset mocked module fns.
    mockReadByPath.mockReset()
    mockListPaths.mockReset()
    _mockGetPreloadedArchiveReturn = null
    _mockNativeFileReturn = null
  })

  it('returns the fake data URL on success', async () => {
    const { rgtBytesToDataUrl } = await import('../template-diffuse')
    const result = await rgtBytesToDataUrl(new Uint8Array(64).fill(0))
    expect(result).toBe(FAKE_DATA_URL)
    expect(activeCtx.putImageData).toHaveBeenCalledTimes(1)
  })

  it('returns null when parseRgtHeader throws', async () => {
    const { parseRgtHeader } = await import('../rgt-core')
    vi.mocked(parseRgtHeader).mockImplementationOnce(() => { throw new Error('bad header') })
    const { rgtBytesToDataUrl } = await import('../template-diffuse')
    expect(await rgtBytesToDataUrl(new Uint8Array(8))).toBeNull()
  })

  it('returns null when decodeRgtFullOffThread rejects', async () => {
    const { decodeRgtFullOffThread } = await import('../decode-pool')
    vi.mocked(decodeRgtFullOffThread).mockRejectedValueOnce(new Error('worker died'))
    const { rgtBytesToDataUrl } = await import('../template-diffuse')
    expect(await rgtBytesToDataUrl(new Uint8Array(8))).toBeNull()
  })

  it('returns null when canvas.getContext returns null', async () => {
    activeGetContext = vi.fn(() => null)
    const { rgtBytesToDataUrl } = await import('../template-diffuse')
    expect(await rgtBytesToDataUrl(new Uint8Array(8))).toBeNull()
  })
})

describe('readStockDiffuseDataUrl', () => {
  beforeEach(() => {
    activeCtx = { putImageData: vi.fn() }
    activeGetContext = vi.fn(() => activeCtx)
    activeToDataURL = vi.fn(() => FAKE_DATA_URL)
    mockReadByPath.mockReset()
    _mockGetPreloadedArchiveReturn = null
  })

  it('returns the fake dataURL for a known stock vehicle when archive is warm', async () => {
    _mockGetPreloadedArchiveReturn = mockArchiveInstance
    mockReadByPath.mockResolvedValue(new Uint8Array(64).fill(1))

    const skin = listStockSkins()[0]
    const { readStockDiffuseDataUrl } = await import('../template-diffuse')
    const result = await readStockDiffuseDataUrl(
      skin.factionId as import('../vehicles').Faction,
      skin.vehicleId,
      fakeInstallRoot,
    )
    expect(result).toBe(FAKE_DATA_URL)
    expect(mockReadByPath).toHaveBeenCalledWith(skin.internalPath)
  })

  it('returns null for an unknown vehicle id', async () => {
    const { readStockDiffuseDataUrl } = await import('../template-diffuse')
    expect(await readStockDiffuseDataUrl('german', 'not_a_real_vehicle', fakeInstallRoot)).toBeNull()
  })

  it('returns null when readByPath returns null (RGT absent from archive)', async () => {
    _mockGetPreloadedArchiveReturn = mockArchiveInstance
    mockReadByPath.mockResolvedValue(null)
    const skin = listStockSkins()[0]
    const { readStockDiffuseDataUrl } = await import('../template-diffuse')
    expect(await readStockDiffuseDataUrl(
      skin.factionId as import('../vehicles').Faction,
      skin.vehicleId,
      fakeInstallRoot,
    )).toBeNull()
  })
})

describe('readWorkshopDiffuseDataUrlBySgaPath', () => {
  beforeEach(() => {
    activeCtx = { putImageData: vi.fn() }
    activeGetContext = vi.fn(() => activeCtx)
    activeToDataURL = vi.fn(() => FAKE_DATA_URL)
    mockListPaths.mockReset()
    mockReadByPath.mockReset()
    _mockNativeFileReturn = null
  })

  it('returns null outside Electron (nativeFileFromPath returns null)', async () => {
    _mockNativeFileReturn = null
    const { readWorkshopDiffuseDataUrlBySgaPath } = await import('../template-diffuse')
    expect(await readWorkshopDiffuseDataUrlBySgaPath('/ws/123/skin.sga', 'german', 'tiger')).toBeNull()
  })

  it('returns the fake dataURL when a matching _dif.rgt exists in the archive', async () => {
    _mockNativeFileReturn = new File([], 'skin.sga')
    mockListPaths.mockReturnValue(['art/armies/german/vehicles/tiger/tiger_dif.rgt'])
    mockReadByPath.mockResolvedValue(new Uint8Array(64).fill(2))
    const { readWorkshopDiffuseDataUrlBySgaPath } = await import('../template-diffuse')
    expect(await readWorkshopDiffuseDataUrlBySgaPath('/ws/123/skin.sga', 'german', 'tiger')).toBe(FAKE_DATA_URL)
  })

  it('returns null when archive has no matching _dif.rgt for the vehicle', async () => {
    _mockNativeFileReturn = new File([], 'skin.sga')
    mockListPaths.mockReturnValue(['art/armies/soviet/vehicles/t34_76/t34_76_dif.rgt'])
    mockReadByPath.mockResolvedValue(new Uint8Array(8))
    const { readWorkshopDiffuseDataUrlBySgaPath } = await import('../template-diffuse')
    expect(await readWorkshopDiffuseDataUrlBySgaPath('/ws/123/skin.sga', 'german', 'tiger')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Integration: stock template clone → async diffuse bake → non-null URL
// ---------------------------------------------------------------------------
describe('stock template apply → non-null customDiffuseUrl (integration)', () => {
  beforeEach(() => {
    activeCtx = { putImageData: vi.fn() }
    activeGetContext = vi.fn(() => activeCtx)
    activeToDataURL = vi.fn(() => FAKE_DATA_URL)
    mockReadByPath.mockReset()
    _mockGetPreloadedArchiveReturn = null
  })

  it('synchronous clone + async diffuse give a project with customDiffuseUrl', async () => {
    _mockGetPreloadedArchiveReturn = mockArchiveInstance
    mockReadByPath.mockResolvedValue(new Uint8Array(64).fill(3))

    const skin = listStockSkins()[0]
    const { readStockDiffuseDataUrl } = await import('../template-diffuse')
    const { cloneSkinProjectFromTemplate } = await import('../project')

    const clone = cloneSkinProjectFromTemplate({
      id: `stock:${skin.id}`,
      kind: 'stock',
      name: skin.name,
    })
    expect(clone).not.toBeNull()
    expect(clone!.lastVehicleId).toBe(skin.vehicleId)
    // customDiffuseUrl not set on synchronous clone.
    expect(clone!.vehicles[skin.vehicleId]?.customDiffuseUrl ?? null).toBeNull()

    const dataUrl = await readStockDiffuseDataUrl(
      skin.factionId as import('../vehicles').Faction,
      skin.vehicleId,
      fakeInstallRoot,
    )
    expect(dataUrl).toBe(FAKE_DATA_URL)

    // Simulate the applyTemplate patch.
    const veh = clone!.vehicles[skin.vehicleId] ?? { id: skin.vehicleId, tac: null, name: null, decals: [] }
    clone!.vehicles[skin.vehicleId] = { ...veh, customDiffuseUrl: dataUrl }
    expect(clone!.vehicles[skin.vehicleId].customDiffuseUrl).toBe(FAKE_DATA_URL)
  })
})
