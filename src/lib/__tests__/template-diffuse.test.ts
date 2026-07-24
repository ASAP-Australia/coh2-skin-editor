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
// readInstalledDecalImage — badge RGT extraction from installed decal SGAs
// ---------------------------------------------------------------------------
describe('readInstalledDecalImage', () => {
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
    const { readInstalledDecalImage } = await import('../template-diffuse')
    expect(await readInstalledDecalImage('/mods/decals/123.sga', 'german')).toBeNull()
  })

  it('returns the fake dataURL when a matching default_dif.rgt badge exists for the faction', async () => {
    _mockNativeFileReturn = new File([], '123.sga')
    const badgePath = 'art/armies/german/badges/8df2e3a315914d72a803c0f94398a544/default_dif.rgt'
    mockListPaths.mockReturnValue([
      'attrib/vehicle_decal/8df2e3a315914d72a803c0f94398a544.rgd',
      badgePath,
    ])
    mockReadByPath.mockResolvedValue(new Uint8Array(64).fill(5))
    const { readInstalledDecalImage } = await import('../template-diffuse')
    const result = await readInstalledDecalImage('/mods/decals/123.sga', 'german')
    expect(result).toBe(FAKE_DATA_URL)
    expect(mockReadByPath).toHaveBeenCalledWith(badgePath.toLowerCase())
  })

  it('returns null when the archive has no badge for the requested faction', async () => {
    _mockNativeFileReturn = new File([], '123.sga')
    // Only has soviet badges, not german
    mockListPaths.mockReturnValue([
      'art/armies/soviet/badges/8df2e3a315914d72a803c0f94398a544/default_dif.rgt',
    ])
    mockReadByPath.mockResolvedValue(new Uint8Array(8))
    const { readInstalledDecalImage } = await import('../template-diffuse')
    expect(await readInstalledDecalImage('/mods/decals/123.sga', 'german')).toBeNull()
  })

  it('returns null when readByPath returns null (RGT missing from archive)', async () => {
    _mockNativeFileReturn = new File([], '123.sga')
    mockListPaths.mockReturnValue([
      'art/armies/german/badges/someguid/default_dif.rgt',
    ])
    mockReadByPath.mockResolvedValue(null)
    const { readInstalledDecalImage } = await import('../template-diffuse')
    expect(await readInstalledDecalImage('/mods/decals/123.sga', 'german')).toBeNull()
  })

  it('tolerates backslash path separators in the SGA TOC', async () => {
    _mockNativeFileReturn = new File([], '123.sga')
    const badgePath = 'art\\armies\\british\\badges\\abc123\\default_dif.rgt'
    mockListPaths.mockReturnValue([badgePath])
    mockReadByPath.mockResolvedValue(new Uint8Array(64).fill(6))
    const { readInstalledDecalImage } = await import('../template-diffuse')
    const result = await readInstalledDecalImage('/mods/decals/123.sga', 'british')
    expect(result).toBe(FAKE_DATA_URL)
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

// ---------------------------------------------------------------------------
// ddsToDataUrl — inline DDS (DXT5/BC3 or DXT1/BC1) → PNG dataURL
// ---------------------------------------------------------------------------

/** Build a minimal valid DDS byte buffer for a 4×4 texture with the given
 *  FourCC. The payload is all-zeroes (valid BC1/BC3 — decodes to black). */
function makeFakeDds(fourCC: string, w = 4, h = 4): Uint8Array {
  // BC3 = 16 bytes/block, BC1 = 8 bytes/block
  const bytesPerBlock = (fourCC === 'DXT5') ? 16 : 8
  const blocksW = Math.ceil(w / 4)
  const blocksH = Math.ceil(h / 4)
  const payloadLen = blocksW * blocksH * bytesPerBlock
  const buf = new Uint8Array(128 + payloadLen)
  const view = new DataView(buf.buffer)

  // 'DDS ' magic
  buf.set([0x44, 0x44, 0x53, 0x20], 0)
  // DDS_HEADER
  view.setUint32(4, 124, true)         // size
  view.setUint32(8, 0x00081007, true)  // flags
  view.setUint32(12, h, true)          // height
  view.setUint32(16, w, true)          // width
  view.setUint32(20, payloadLen, true) // pitchOrLinearSize
  view.setUint32(76, 32, true)         // pixelformat.size
  view.setUint32(80, 0x4, true)        // pixelformat.flags (FOURCC)
  buf.set(fourCC.split('').map(c => c.charCodeAt(0)), 84)
  view.setUint32(108, 0x1000, true)    // caps1
  // payload stays zeroed
  return buf
}

describe('ddsToDataUrl', () => {
  beforeEach(() => {
    activeCtx = { putImageData: vi.fn() }
    activeGetContext = vi.fn(() => activeCtx)
    activeToDataURL = vi.fn(() => FAKE_DATA_URL)
  })

  it('returns a PNG dataURL for a valid 4×4 DXT5 DDS', async () => {
    const dds = makeFakeDds('DXT5', 4, 4)
    const { ddsToDataUrl } = await import('../template-diffuse')
    const result = ddsToDataUrl(dds)
    expect(result).toBe(FAKE_DATA_URL)
    expect(activeCtx.putImageData).toHaveBeenCalledTimes(1)
  })

  it('returns a PNG dataURL for a valid 4×4 DXT1 DDS', async () => {
    const dds = makeFakeDds('DXT1', 4, 4)
    const { ddsToDataUrl } = await import('../template-diffuse')
    const result = ddsToDataUrl(dds)
    expect(result).toBe(FAKE_DATA_URL)
    expect(activeCtx.putImageData).toHaveBeenCalledTimes(1)
  })

  it('returns null for an unsupported FourCC', async () => {
    const dds = makeFakeDds('DXT2', 4, 4)
    const { ddsToDataUrl } = await import('../template-diffuse')
    expect(ddsToDataUrl(dds)).toBeNull()
  })

  it('returns null for a buffer shorter than 128 bytes', async () => {
    const { ddsToDataUrl } = await import('../template-diffuse')
    expect(ddsToDataUrl(new Uint8Array(64))).toBeNull()
  })

  it('returns null when canvas.getContext returns null', async () => {
    activeGetContext = vi.fn(() => null)
    const dds = makeFakeDds('DXT5', 4, 4)
    const { ddsToDataUrl } = await import('../template-diffuse')
    expect(ddsToDataUrl(dds)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// readInstalledPackIcon — ui/assets/textures/*_i1.dds extractor
// ---------------------------------------------------------------------------
describe('readInstalledPackIcon', () => {
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
    const { readInstalledPackIcon } = await import('../template-diffuse')
    expect(await readInstalledPackIcon('/mods/skins/pack.sga')).toBeNull()
  })

  it('returns the fake dataURL when a _i1.dds DXT5 entry exists', async () => {
    _mockNativeFileReturn = new File([], 'pack.sga')
    const iconPath = 'ui/assets/textures/abcdef1234567890abcdef1234567890_i1.dds'
    mockListPaths.mockReturnValue([iconPath])
    // Provide a valid 4×4 DXT5 DDS bytes so ddsToDataUrl can decode it.
    mockReadByPath.mockResolvedValue(makeFakeDds('DXT5', 4, 4))
    const { readInstalledPackIcon } = await import('../template-diffuse')
    const result = await readInstalledPackIcon('/mods/skins/pack.sga')
    expect(result).toBe(FAKE_DATA_URL)
  })

  it('returns null when the archive has no _i1.dds entry', async () => {
    _mockNativeFileReturn = new File([], 'pack.sga')
    mockListPaths.mockReturnValue(['attrib/vehicle_decal/abc.rgd'])
    mockReadByPath.mockResolvedValue(new Uint8Array(256))
    const { readInstalledPackIcon } = await import('../template-diffuse')
    expect(await readInstalledPackIcon('/mods/skins/pack.sga')).toBeNull()
  })

  it('returns null when readByPath returns null', async () => {
    _mockNativeFileReturn = new File([], 'pack.sga')
    mockListPaths.mockReturnValue(['ui/assets/textures/abcdef1234567890abcdef1234567890_i1.dds'])
    mockReadByPath.mockResolvedValue(null)
    const { readInstalledPackIcon } = await import('../template-diffuse')
    expect(await readInstalledPackIcon('/mods/skins/pack.sga')).toBeNull()
  })

  it('tolerates backslash separators in the SGA TOC', async () => {
    _mockNativeFileReturn = new File([], 'pack.sga')
    mockListPaths.mockReturnValue(['ui\\assets\\textures\\abcdef1234567890abcdef1234567890_i1.dds'])
    mockReadByPath.mockResolvedValue(makeFakeDds('DXT5', 4, 4))
    const { readInstalledPackIcon } = await import('../template-diffuse')
    expect(await readInstalledPackIcon('/mods/skins/pack.sga')).toBe(FAKE_DATA_URL)
  })
})
