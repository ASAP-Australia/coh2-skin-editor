import { describe, it, expect } from 'vitest'
import { freshModGuid, freshPackId, exportSkinPack } from '../mod-export'

// ---------------------------------------------------------------------------
// freshModGuid
// ---------------------------------------------------------------------------

describe('freshModGuid', () => {
  it('returns a 32-character hex string', () => {
    const guid = freshModGuid()
    expect(guid).toHaveLength(32)
    expect(guid).toMatch(/^[0-9a-f]{32}$/)
  })

  it('returns a different value on each call', () => {
    const a = freshModGuid()
    const b = freshModGuid()
    // Astronomically unlikely to collide (128-bit random)
    expect(a).not.toBe(b)
  })

  it('contains only lowercase hex characters (compatible with ASCII regex in rewriteGuid)', () => {
    for (let i = 0; i < 10; i++) {
      const guid = freshModGuid()
      expect(guid).toMatch(/^[0-9a-f]+$/)
    }
  })

  it('never contains uppercase letters (case-sensitive byte matching in rewriteGuid requires lowercase)', () => {
    // rewriteGuid does a raw byte comparison against the old GUID which is
    // always lowercase; the replacement must also be lowercase.
    const guid = freshModGuid()
    expect(guid).toBe(guid.toLowerCase())
  })
})

// ---------------------------------------------------------------------------
// freshPackId
// ---------------------------------------------------------------------------

describe('freshPackId', () => {
  it('returns a numeric string (parseable as a safe integer)', () => {
    const id = freshPackId()
    const n = Number(id)
    expect(Number.isFinite(n)).toBe(true)
    expect(Number.isInteger(n)).toBe(true)
  })

  it('returns a value well above 5e9 (above the Workshop ID range)', () => {
    const id = freshPackId()
    expect(Number(id)).toBeGreaterThan(5e9)
  })

  it('returns a value below 2^53 (safe JavaScript integer)', () => {
    const id = freshPackId()
    // Number.MAX_SAFE_INTEGER = 2^53 - 1 ≈ 9.007×10^15
    expect(Number(id)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
  })

  it('contains only digit characters (required for CoH2 engine scan pattern %%I64u.sga)', () => {
    const id = freshPackId()
    expect(id).toMatch(/^\d+$/)
  })

  it('returns a different value on each call', () => {
    const ids = new Set(Array.from({ length: 20 }, () => freshPackId()))
    // With ms-timestamp × 1000 + random 0-999, within a single ms we can get
    // up to 1000 unique values. Expect at least 10 distinct values from 20 calls.
    expect(ids.size).toBeGreaterThanOrEqual(10)
  })

  it('returns a string, not a number (caller passes directly to filename construction)', () => {
    expect(typeof freshPackId()).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// exportSkinPack — input validation (overrides for stable IDs)
// ---------------------------------------------------------------------------
//
// The stable-ID overrides (`numericIdOverride`, `modGuidOverride`) are how
// Live Sync gets overwrite-in-place semantics on `mods/skins/<numericId>.sga`.
// A malformed override would corrupt the on-disk filename (and silently get
// skipped by the engine's `%I64u.sga` scan) or break the internal asset
// paths inside the SGA. These tests pin the input contract so we fail
// loudly rather than silently produce a broken pack.
describe('exportSkinPack — override validation', () => {
  // A no-op stand-in handle. Validation happens BEFORE locateArchives() is
  // called, so we never actually touch the handle for these throws.
  const fakeRoot = {} as unknown as FileSystemDirectoryHandle
  const minimalProject = {
    id: 'pj_test',
    packName: 'x',
    packDescription: '',
    vehicles: {},
  } as unknown as Parameters<typeof exportSkinPack>[1]
  const noop = () => {}

  it('rejects a non-numeric numericIdOverride', async () => {
    await expect(
      exportSkinPack(fakeRoot, minimalProject, noop, 3, 'not-a-number', undefined),
    ).rejects.toThrow(/numericIdOverride/)
  })

  it('rejects a numericIdOverride with a leading zero (would still print but is sloppy)', async () => {
    await expect(
      exportSkinPack(fakeRoot, minimalProject, noop, 3, '0123456789012345', undefined),
    ).rejects.toThrow(/numericIdOverride/)
  })

  it('rejects a modGuidOverride that is not 32 hex chars', async () => {
    await expect(
      exportSkinPack(fakeRoot, minimalProject, noop, 3, '1700000000000001', 'too-short'),
    ).rejects.toThrow(/modGuidOverride/)
  })

  it('rejects an UPPERCASE modGuidOverride (rewriteGuid does byte-exact lowercase match)', async () => {
    await expect(
      exportSkinPack(
        fakeRoot,
        minimalProject,
        noop,
        3,
        '1700000000000001',
        'ABCDEF0123456789ABCDEF0123456789',
      ),
    ).rejects.toThrow(/modGuidOverride/)
  })

  it('still validates targetSlot (kept the historical error message)', async () => {
    await expect(
      exportSkinPack(
        fakeRoot,
        minimalProject,
        noop,
        99, // out of range
        undefined,
        undefined,
      ),
    ).rejects.toThrow(/targetSlot/)
  })
})
