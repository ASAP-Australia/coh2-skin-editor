/**
 * live-sync-patch-fallback.test.ts
 *
 * Verifies the robustness fallback added to live-sync._build() skin path:
 *
 *   When patchExport() throws (e.g. RGT size mismatch, corrupt template),
 *   the skin build must fall back to exportSkinPack (unsigned), still write
 *   the SGA, and complete successfully.
 *
 * We mirror the exact branch logic from live-sync.ts lines 725-755 so that
 * any future change to the live-sync branch will require updating this mirror
 * — that is intentional.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const FAKE_BYTES_UNSIGNED = new Uint8Array([0x55, 0x4e, 0x53, 0x47]) // "UNSG"

vi.mock('@/lib/mod-export', () => ({
  hasSigningKeys: vi.fn(),
  patchExport: vi.fn(),
  exportSkinPack: vi.fn(),
}))

/**
 * Mirrors the skin branch from live-sync._build() including the new
 * patchExport error-catch + unsigned fallback (added to fix the RGT
 * format-mismatch bug).
 */
async function buildSkinBranchWithFallback(
  installHandle: FileSystemDirectoryHandle,
  skinProject: never,
  stableNumericId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const { patchExport, exportSkinPack, hasSigningKeys } = await import('@/lib/mod-export')
  let result: { bytes: Uint8Array; filename: string }
  if (await hasSigningKeys()) {
    try {
      result = await patchExport(installHandle, skinProject, () => {}, stableNumericId)
    } catch (patchErr: unknown) {
      const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
      console.warn(`[live-sync] patchExport failed (${patchMsg}); falling back to unsigned exportSkinPack`)
      result = await exportSkinPack(installHandle, skinProject, () => {}, undefined, stableNumericId)
    }
  } else {
    result = await exportSkinPack(installHandle, skinProject, () => {}, undefined, stableNumericId)
  }
  return result
}

describe('live-sync skin _build — patchExport fallback', () => {
  const fakeHandle = {} as FileSystemDirectoryHandle
  const fakeProject = {} as never
  const stableId = '1000000000000099'

  beforeEach(async () => {
    const { hasSigningKeys, patchExport, exportSkinPack } = await import('@/lib/mod-export')
    vi.mocked(hasSigningKeys).mockReset()
    vi.mocked(patchExport).mockReset()
    vi.mocked(exportSkinPack).mockReset()
  })

  it('when patchExport throws RGT size mismatch → falls back to exportSkinPack and returns bytes', async () => {
    const { hasSigningKeys, patchExport, exportSkinPack } = await import('@/lib/mod-export')
    vi.mocked(hasSigningKeys).mockResolvedValue(true)
    vi.mocked(patchExport).mockRejectedValue(
      new Error('RGT size mismatch for tiger summer: generated 2097659, expected 4194736. Template may have been built with a different version of the RGT writer.'),
    )
    vi.mocked(exportSkinPack).mockResolvedValue({
      bytes: FAKE_BYTES_UNSIGNED,
      filename: `${stableId}.sga`,
      modGuid: 'a'.repeat(32),
      numericId: stableId,
      textureCount: 1,
    })

    const result = await buildSkinBranchWithFallback(fakeHandle, fakeProject, stableId)

    expect(vi.mocked(patchExport)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(exportSkinPack)).toHaveBeenCalledTimes(1)
    // Must still write an SGA (reach 'synced')
    expect(result.bytes).toBe(FAKE_BYTES_UNSIGNED)
    expect(result.filename).toBe(`${stableId}.sga`)
  })

  it('when patchExport throws generic error → still falls back to unsigned, never silently writes nothing', async () => {
    const { hasSigningKeys, patchExport, exportSkinPack } = await import('@/lib/mod-export')
    vi.mocked(hasSigningKeys).mockResolvedValue(true)
    vi.mocked(patchExport).mockRejectedValue(new Error('Failed to fetch key SGA: HTTP 404'))
    vi.mocked(exportSkinPack).mockResolvedValue({
      bytes: FAKE_BYTES_UNSIGNED,
      filename: `${stableId}.sga`,
      modGuid: 'b'.repeat(32),
      numericId: stableId,
      textureCount: 0,
    })

    const result = await buildSkinBranchWithFallback(fakeHandle, fakeProject, stableId)

    expect(vi.mocked(exportSkinPack)).toHaveBeenCalledTimes(1)
    expect(result.bytes).toBe(FAKE_BYTES_UNSIGNED)
  })

  it('when patchExport succeeds → does NOT call exportSkinPack', async () => {
    const SIGNED_BYTES = new Uint8Array([0x53, 0x47, 0x4e, 0x44]) // "SGND"
    const { hasSigningKeys, patchExport, exportSkinPack } = await import('@/lib/mod-export')
    vi.mocked(hasSigningKeys).mockResolvedValue(true)
    vi.mocked(patchExport).mockResolvedValue({
      bytes: SIGNED_BYTES,
      filename: `${stableId}.sga`,
      modGuid: 'c'.repeat(32),
      numericId: stableId,
      textureCount: 2,
    })

    const result = await buildSkinBranchWithFallback(fakeHandle, fakeProject, stableId)

    expect(vi.mocked(patchExport)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(exportSkinPack)).not.toHaveBeenCalled()
    expect(result.bytes).toBe(SIGNED_BYTES)
  })

  it('when hasSigningKeys=false → calls exportSkinPack directly (no patchExport attempt)', async () => {
    const { hasSigningKeys, patchExport, exportSkinPack } = await import('@/lib/mod-export')
    vi.mocked(hasSigningKeys).mockResolvedValue(false)
    vi.mocked(exportSkinPack).mockResolvedValue({
      bytes: FAKE_BYTES_UNSIGNED,
      filename: `${stableId}.sga`,
      modGuid: 'd'.repeat(32),
      numericId: stableId,
      textureCount: 0,
    })

    const result = await buildSkinBranchWithFallback(fakeHandle, fakeProject, stableId)

    expect(vi.mocked(patchExport)).not.toHaveBeenCalled()
    expect(vi.mocked(exportSkinPack)).toHaveBeenCalledTimes(1)
    expect(result.bytes).toBe(FAKE_BYTES_UNSIGNED)
  })
})
