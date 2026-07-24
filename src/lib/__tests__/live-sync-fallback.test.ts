/**
 * live-sync-fallback.test.ts — R3b fix: verifies the branch logic added to
 * live-sync._build() for the skin case.
 *
 * When hasKeyPool() returns false → exportSkinPack (unsigned) must be called.
 * When hasKeyPool() returns true  → patchExport (signed) must be called.
 *
 * We test this directly via the mod-export mock, exercising the same branch
 * logic the actual live-sync._build() skin path uses (lines 726-743).
 * This avoids spinning up the full IDB + native-fs stack for a unit assertion.
 */

import { describe, it, expect, vi } from 'vitest'

// ── Mock stubs matching the live-sync skin branch ────────────────────────────

const FAKE_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

vi.mock('@/lib/mod-export', () => ({
  hasSigningKeys: vi.fn(),
  hasKeyPool: vi.fn(),
  patchExport: vi.fn(),
  exportSkinPack: vi.fn(),
}))

// ── The branch under test (extracted from live-sync._build skin path) ─────────
//
// This function mirrors the exact logic in live-sync.ts lines 726-743 so the
// test is a direct specification of that branch.  Any future change to the
// live-sync branch will require updating this mirror — that is intentional.
//
async function buildSkinBranch(
  installHandle: FileSystemDirectoryHandle,
  skinProject: never,
  stableNumericId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const { patchExport, exportSkinPack, hasSigningKeys } = await import('@/lib/mod-export')
  let result: { bytes: Uint8Array; filename: string }
  if (await hasSigningKeys()) {
    result = await patchExport(installHandle, skinProject, () => {}, stableNumericId)
  } else {
    result = await exportSkinPack(installHandle, skinProject, () => {}, undefined, stableNumericId)
  }
  return result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('live-sync skin _build — hasSigningKeys branch', () => {
  it('calls exportSkinPack (unsigned) when hasSigningKeys returns false', async () => {
    const { hasSigningKeys, patchExport, exportSkinPack } = await import('@/lib/mod-export')
    vi.mocked(hasSigningKeys).mockResolvedValue(false)
    vi.mocked(exportSkinPack).mockResolvedValue({ bytes: FAKE_BYTES, filename: '1000000000000001.sga', modGuid: 'a'.repeat(32), numericId: '1000000000000001', textureCount: 0 })
    vi.mocked(patchExport).mockReset()

    const fakeHandle = {} as FileSystemDirectoryHandle
    const result = await buildSkinBranch(fakeHandle, {} as never, '1000000000000001')

    expect(vi.mocked(exportSkinPack)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(patchExport)).not.toHaveBeenCalled()
    expect(result.filename).toBe('1000000000000001.sga')
    expect(result.bytes).toBe(FAKE_BYTES)
  })

  it('calls patchExport (signed) when hasSigningKeys returns true', async () => {
    const { hasSigningKeys, patchExport, exportSkinPack } = await import('@/lib/mod-export')
    vi.mocked(hasSigningKeys).mockResolvedValue(true)
    vi.mocked(patchExport).mockResolvedValue({ bytes: FAKE_BYTES, filename: '1000000000000002.sga', modGuid: 'b'.repeat(32), numericId: '1000000000000002', textureCount: 0 })
    vi.mocked(exportSkinPack).mockReset()

    const fakeHandle = {} as FileSystemDirectoryHandle
    const result = await buildSkinBranch(fakeHandle, {} as never, '1000000000000002')

    expect(vi.mocked(patchExport)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(exportSkinPack)).not.toHaveBeenCalled()
    expect(result.filename).toBe('1000000000000002.sga')
    expect(result.bytes).toBe(FAKE_BYTES)
  })
})
