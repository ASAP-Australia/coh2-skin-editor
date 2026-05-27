/**
 * Tests for electron/mods-wipe.ts — the one-time migration that clears
 * pre-v1.0 fake-Workshop-ID SGAs from the CoH2 mods tree.
 *
 * The migration must be conservative — misclassifying a real Workshop
 * subscription would silently break the user's subscriptions across all
 * their mods. We pin three contracts here:
 *
 *  1. The fake-ID classifier accepts only basenames that look like real
 *     Workshop file IDs (numeric, < 10^11). 32-hex GUIDs, hex-with-
 *     dashes, and big numeric IDs from `Date.now()*1000` all classify
 *     as fake.
 *  2. The directory scanner walks the four pre-v1.0 buckets and returns
 *     only SGA files whose basename trips the classifier — real subs
 *     stay invisible to the migration.
 *  3. The trasher refuses to operate on paths that escape the supplied
 *     modsRoot, even if the renderer asks nicely. This is the only
 *     security gate between an IPC-spoofing renderer and shell.trashItem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────

// Synthetic filesystem the scanner walks. Keyed by absolute POSIX path.
// Directories store their entry list, files store a numeric size.
type VfsEntry = { kind: 'dir'; entries: string[] } | { kind: 'file'; size: number }
const vfs = new Map<string, VfsEntry>()

vi.mock('node:fs', () => ({
  statSync: (p: string) => {
    const e = vfs.get(p)
    if (!e) throw new Error(`ENOENT: ${p}`)
    if (e.kind === 'dir') {
      return { isDirectory: () => true, size: 0 } as unknown as ReturnType<
        typeof import('node:fs').statSync
      >
    }
    return { isDirectory: () => false, size: e.size } as unknown as ReturnType<
      typeof import('node:fs').statSync
    >
  },
  readdirSync: (p: string) => {
    const e = vfs.get(p)
    if (!e) throw new Error(`ENOENT: ${p}`)
    if (e.kind !== 'dir') throw new Error(`ENOTDIR: ${p}`)
    return e.entries
  },
}))

const trashItemMock = vi.fn(async (_p: string) => {})
vi.mock('electron', () => ({
  shell: {
    trashItem: (p: string) => trashItemMock(p),
  },
}))

// ── Suite ────────────────────────────────────────────────────────────

describe('mods-wipe — classifyFakeId', () => {
  let classifyFakeId: typeof import('../mods-wipe').classifyFakeId
  beforeEach(async () => {
    ({ classifyFakeId } = await import('../mods-wipe'))
  })

  it('returns null for a low numeric ID — real Workshop subscriptions', () => {
    // Real Workshop IDs are well under 10^11 (counter sat at ~5×10^9
    // in late 2025). Two representative real Workshop file IDs.
    expect(classifyFakeId('859505244')).toBeNull()
    expect(classifyFakeId('3000123456')).toBeNull()
  })

  it('flags a 16-digit Date.now()*1000 numeric as fake', () => {
    // freshPackId() in the pre-v1.0 mod-export.ts produced
    // `Date.now() * 1000 + salt`, giving values around 1.7×10^15.
    const fakeId = String(Date.now() * 1000 + 42)
    const verdict = classifyFakeId(fakeId)
    expect(verdict).not.toBeNull()
    expect(verdict?.reason).toBe('numeric-above-threshold')
  })

  it('flags a 32-hex GUID basename as fake (non-numeric)', () => {
    // Decal / faceplate live-sync used a 32-hex GUID for the basename
    // — `deriveGuidFromId(project.id)` returns a hex string.
    const verdict = classifyFakeId('790bfac8d4e34a5b9c2f1e0d8a7b6c5e')
    expect(verdict).not.toBeNull()
    expect(verdict?.reason).toBe('non-numeric-basename')
  })

  it('flags any string containing a non-digit as non-numeric', () => {
    expect(classifyFakeId('123abc')?.reason).toBe('non-numeric-basename')
    expect(classifyFakeId('abc-123')?.reason).toBe('non-numeric-basename')
    expect(classifyFakeId('')?.reason).toBe('non-numeric-basename')
  })

  it('flags numbers right at the threshold', () => {
    // 10^11 itself is the cliff — anything ≥ that classifies as fake.
    expect(classifyFakeId('100000000000')?.reason).toBe('numeric-above-threshold')
    expect(classifyFakeId('99999999999')).toBeNull()
  })
})

describe('mods-wipe — scanFakeIdSgas', () => {
  let scanFakeIdSgas: typeof import('../mods-wipe').scanFakeIdSgas
  beforeEach(async () => {
    vfs.clear()
    ;({ scanFakeIdSgas } = await import('../mods-wipe'))
  })

  it('returns [] when modsRoot does not exist', () => {
    expect(scanFakeIdSgas('/nonexistent/path')).toEqual([])
  })

  it('returns [] when modsRoot is missing or empty input', () => {
    expect(scanFakeIdSgas('')).toEqual([])
    expect(scanFakeIdSgas(undefined as unknown as string)).toEqual([])
  })

  it('walks all four buckets and skips non-SGA files', () => {
    // Build a virtual mods tree with one fake + one real sub in each
    // bucket, plus a stray README that should be ignored.
    const root = '/mods'
    vfs.set(root, { kind: 'dir', entries: ['decals', 'faceplates', 'extension', 'skins'] })
    for (const bucket of ['decals', 'faceplates', 'extension']) {
      vfs.set(`${root}/${bucket}`, { kind: 'dir', entries: ['subscriptions'] })
      vfs.set(`${root}/${bucket}/subscriptions`, {
        kind: 'dir',
        entries: [
          'README.txt', // not an SGA — skipped
          '859505244.sga', // real Workshop ID — kept
          '1700000000000000.sga', // fake Date-based ID — flagged
          '790bfac8d4e34a5b9c2f1e0d8a7b6c5e.sga', // 32-hex GUID — flagged
        ],
      })
      vfs.set(`${root}/${bucket}/subscriptions/README.txt`, { kind: 'file', size: 10 })
      vfs.set(`${root}/${bucket}/subscriptions/859505244.sga`, { kind: 'file', size: 100 })
      vfs.set(`${root}/${bucket}/subscriptions/1700000000000000.sga`, { kind: 'file', size: 200 })
      vfs.set(`${root}/${bucket}/subscriptions/790bfac8d4e34a5b9c2f1e0d8a7b6c5e.sga`, {
        kind: 'file',
        size: 300,
      })
    }
    // Skins live directly under mods/skins (no subscriptions/ layer).
    vfs.set(`${root}/skins`, {
      kind: 'dir',
      entries: ['3000123456.sga', '1700000000000111.sga'],
    })
    vfs.set(`${root}/skins/3000123456.sga`, { kind: 'file', size: 50 })
    vfs.set(`${root}/skins/1700000000000111.sga`, { kind: 'file', size: 60 })

    const result = scanFakeIdSgas(root)

    // 3 buckets × 2 fakes each = 6, plus 1 fake skin = 7 total.
    expect(result).toHaveLength(7)
    // The real Workshop IDs must NOT appear.
    expect(result.find(r => r.id === '859505244')).toBeUndefined()
    expect(result.find(r => r.id === '3000123456')).toBeUndefined()
    // Each bucket should be represented at least once.
    expect(result.find(r => r.kind === 'decals')).toBeDefined()
    expect(result.find(r => r.kind === 'faceplates')).toBeDefined()
    expect(result.find(r => r.kind === 'extension')).toBeDefined()
    expect(result.find(r => r.kind === 'skins')).toBeDefined()
    // Size + reason populated.
    const fakeSkin = result.find(r => r.id === '1700000000000111')
    expect(fakeSkin?.size).toBe(60)
    expect(fakeSkin?.reason).toBe('numeric-above-threshold')
  })

  it('handles missing buckets silently', () => {
    // Only decals/subscriptions exists — the other three are gone. The
    // scanner should report the decal entries and skip the rest.
    const root = '/mods'
    vfs.set(root, { kind: 'dir', entries: ['decals'] })
    vfs.set(`${root}/decals`, { kind: 'dir', entries: ['subscriptions'] })
    vfs.set(`${root}/decals/subscriptions`, {
      kind: 'dir',
      entries: ['abc-decal.sga'],
    })
    vfs.set(`${root}/decals/subscriptions/abc-decal.sga`, { kind: 'file', size: 1 })

    const result = scanFakeIdSgas(root)
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('decals')
    expect(result[0]!.reason).toBe('non-numeric-basename')
  })
})

describe('mods-wipe — trashFakeIdSgas', () => {
  let trashFakeIdSgas: typeof import('../mods-wipe').trashFakeIdSgas
  beforeEach(async () => {
    vfs.clear()
    trashItemMock.mockReset()
    trashItemMock.mockImplementation(async () => {})
    ;({ trashFakeIdSgas } = await import('../mods-wipe'))
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('trashes paths inside the mods root', async () => {
    const root = '/mods'
    const result = await trashFakeIdSgas(
      [`${root}/skins/1700000000000111.sga`, `${root}/decals/subscriptions/abc.sga`],
      root,
    )
    expect(result.trashed).toHaveLength(2)
    expect(result.failed).toEqual([])
    expect(trashItemMock).toHaveBeenCalledTimes(2)
  })

  it('refuses paths outside the mods root — path containment guard', async () => {
    const root = '/mods'
    const result = await trashFakeIdSgas(
      ['/etc/passwd.sga', '/var/run/important.sga'],
      root,
    )
    expect(result.trashed).toEqual([])
    expect(result.failed).toHaveLength(2)
    expect(result.failed[0]!.error).toMatch(/outside the mods folder/)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('refuses non-.sga paths even inside the mods root', async () => {
    const root = '/mods'
    const result = await trashFakeIdSgas(
      [`${root}/skins/1700000000000111.txt`, `${root}/decals/subscriptions/abc.exe`],
      root,
    )
    expect(result.trashed).toEqual([])
    expect(result.failed).toHaveLength(2)
    expect(result.failed[0]!.error).toMatch(/non-.sga/)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('captures per-file trash failures without aborting the batch', async () => {
    const root = '/mods'
    trashItemMock.mockImplementationOnce(async () => {
      throw new Error('disk error')
    })
    trashItemMock.mockImplementationOnce(async () => {})
    const result = await trashFakeIdSgas(
      [`${root}/skins/a.sga`, `${root}/skins/b.sga`],
      root,
    )
    expect(result.trashed).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.error).toBe('disk error')
  })
})
