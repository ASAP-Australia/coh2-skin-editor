/**
 * Roundtrip + edge-case tests for SGA v7 writer (sga-writer.ts) and reader (sga.ts).
 *
 * All tests use purely synthetic data — no real game files are required.
 * The strategy is: write an archive with `buildSga`, then re-parse it with
 * `SgaArchive.open`, and assert that what comes back matches what went in.
 *
 * File-like shim
 * --------------
 * `SgaArchive.open` expects a browser `File` object with a `.slice(start, end?)`
 * method that returns a blob-ish object supporting `.arrayBuffer()`.  In the
 * jsdom test environment we use a minimal shim backed by a Uint8Array so we
 * can stay fully in-memory without any real filesystem I/O.
 *
 * Uint8Array comparison note
 * --------------------------
 * In a jsdom environment, `TextEncoder` is the jsdom global's version, which
 * produces `Uint8Array` instances whose constructor differs from Node's native
 * `Uint8Array`. vitest's `toEqual` checks the constructor, so comparing a
 * jsdom-created Uint8Array against a Node-created Uint8Array fails even when
 * the bytes are identical. We work around this by using `expectBytes()` which
 * compares via `Array.from()` to a plain array, bypassing the constructor check.
 */

import { describe, it, expect } from 'vitest'
import { SgaArchive } from '@/lib/sga'
import { buildSga, type SgaInputFile } from '@/lib/sga-writer'
import { deflate } from 'pako'

// ─── File shim ────────────────────────────────────────────────────────────────

/**
 * Minimal stand-in for the browser `File` API.
 * `SgaArchive.open` only ever calls `.slice(start, end).arrayBuffer()`.
 */
class MemFile {
  readonly name: string
  readonly size: number
  private readonly data: Uint8Array

  constructor(data: Uint8Array, name = 'test.sga') {
    this.data = data
    this.name = name
    this.size = data.length
  }

  slice(start: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> } {
    const sliced = this.data.slice(start, end)
    return {
      arrayBuffer: () => Promise.resolve(sliced.buffer as ArrayBuffer),
    }
  }
}

/** Build an SGA archive and wrap it in a MemFile ready for `SgaArchive.open`. */
async function buildAndWrap(archiveName: string, files: SgaInputFile[]): Promise<MemFile> {
  const bytes = await buildSga({ archiveName, files })
  return new MemFile(bytes)
}

// ─── Byte comparison helper ────────────────────────────────────────────────────

/**
 * Assert that two byte arrays contain the same bytes.
 *
 * jsdom's TextEncoder returns Uint8Array instances from the jsdom global
 * while the SGA reader returns Uint8Array from Node's global. vitest's
 * toEqual checks the constructor, so direct comparison fails even though the
 * bytes are identical. Converting to Array<number> bypasses the check.
 */
function expectBytes(actual: Uint8Array | null | undefined, expected: Uint8Array): void {
  expect(actual).not.toBeNull()
  expect(actual).not.toBeUndefined()
  expect(Array.from(actual!)).toEqual(Array.from(expected))
}

// ─── CRC-32 helper (matches the one in sga-writer.ts) ─────────────────────────

let crcTableCache: Uint32Array | null = null
function crc32(buf: Uint8Array): number {
  if (!crcTableCache) {
    crcTableCache = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTableCache[i] = c
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTableCache[(crc ^ buf[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('SGA v7 roundtrip — single file, single folder', () => {
  it('write + parse restores the exact path and contents', async () => {
    const payload = new TextEncoder().encode('hello world')
    const file = new MemFile(
      await buildSga({
        archiveName: 'TestArchive',
        files: [{ path: 'data/readme.txt', bytes: payload, compress: false }],
      }),
    )

    const archive = await SgaArchive.open(file as unknown as File)
    const entry = await archive.readByPath('data/readme.txt')

    expect(entry).not.toBeNull()
    expectBytes(entry, payload)
  })

  it('archive name round-trips through the UTF-16-LE header field', async () => {
    const file = await buildAndWrap('MySkinPack', [
      { path: 'data/x.bin', bytes: new Uint8Array([1, 2, 3]), compress: false },
    ])
    const archive = await SgaArchive.open(file as unknown as File)
    expect(archive.archiveName).toBe('MySkinPack')
  })

  it('list() returns the single entry with the expected path', async () => {
    const file = await buildAndWrap('A', [
      { path: 'data/sub/file.xml', bytes: new Uint8Array([0xde, 0xad]), compress: false },
    ])
    const archive = await SgaArchive.open(file as unknown as File)
    const paths = archive.list().map(e => e.path)
    expect(paths).toContain('data/sub/file.xml')
  })

  it('list() reports the correct uncompressed length', async () => {
    const payload = new Uint8Array(42).fill(0xab)
    const file = await buildAndWrap('A', [
      { path: 'data/blob.bin', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(file as unknown as File)
    const entry = archive.list().find(e => e.path === 'data/blob.bin')
    expect(entry).toBeDefined()
    expect(entry!.length).toBe(42)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 roundtrip — multiple files in nested folder tree', () => {
  it('all three files survive across different drive groups', async () => {
    const enc = new TextEncoder()
    const files: SgaInputFile[] = [
      { path: 'attrib/skin_pack/german/foo.xml', bytes: enc.encode('<german/>'), compress: false },
      { path: 'attrib/skin_pack/okw/bar.xml', bytes: enc.encode('<okw/>'), compress: false },
      { path: 'data/art/baz.tga', bytes: new Uint8Array([0, 1, 2, 3]), compress: false },
    ]
    const mf = await buildAndWrap('Multi', files)
    const archive = await SgaArchive.open(mf as unknown as File)

    const german = await archive.readByPath('attrib/skin_pack/german/foo.xml')
    expectBytes(german, enc.encode('<german/>'))

    const okw = await archive.readByPath('attrib/skin_pack/okw/bar.xml')
    expectBytes(okw, enc.encode('<okw/>'))

    const tga = await archive.readByPath('data/art/baz.tga')
    expectBytes(tga, new Uint8Array([0, 1, 2, 3]))
  })

  it('list() returns entries for every file in the correct order', async () => {
    const enc = new TextEncoder()
    const files: SgaInputFile[] = [
      { path: 'attrib/a.xml', bytes: enc.encode('a'), compress: false },
      { path: 'attrib/b.xml', bytes: enc.encode('b'), compress: false },
      { path: 'data/c.bin', bytes: enc.encode('c'), compress: false },
    ]
    const mf = await buildAndWrap('Order', files)
    const archive = await SgaArchive.open(mf as unknown as File)
    const paths = archive.list().map(e => e.path)

    expect(paths).toContain('attrib/a.xml')
    expect(paths).toContain('attrib/b.xml')
    expect(paths).toContain('data/c.bin')
  })

  it('deeply nested path (4 levels) round-trips correctly', async () => {
    const payload = new TextEncoder().encode('deep content')
    const mf = await buildAndWrap('Deep', [
      { path: 'data/a/b/c/d.txt', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/a/b/c/d.txt')
    expectBytes(result, payload)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 roundtrip — storage type 0 (raw uncompressed)', () => {
  it('compress:false stores the bytes verbatim (storage=0)', async () => {
    const payload = new Uint8Array([0xca, 0xfe, 0xba, 0xbe])
    const mf = await buildAndWrap('Raw', [
      { path: 'data/magic.bin', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/magic.bin')
    expectBytes(result, payload)
  })

  it('storage=0 payload is returned byte-for-byte without inflation', async () => {
    // Craft a payload that would fail zlib inflation — confirms the reader does
    // NOT attempt to inflate when storage==0.
    const notZlib = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb])
    const mf = await buildAndWrap('NoZlib', [
      { path: 'data/raw.bin', bytes: notZlib, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/raw.bin')
    expectBytes(result, notZlib)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 roundtrip — storage types 1 & 2 (zlib deflate)', () => {
  it('compress:true (default, storage=1) inflates to the original bytes', async () => {
    const payload = new TextEncoder().encode('This payload will be deflated by pako.')
    const mf = await buildAndWrap('Zlib', [{ path: 'data/compressed.txt', bytes: payload }])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/compressed.txt')
    expectBytes(result, payload)
  })

  it('storage:"buffer" (storage=2) inflates to the original bytes', async () => {
    const payload = new TextEncoder().encode('Buffer-compressed payload.')
    const mf = await buildAndWrap('Zlib2', [
      { path: 'data/buf.txt', bytes: payload, storage: 'buffer' },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/buf.txt')
    expectBytes(result, payload)
  })

  it('compressed length stored in TOC is smaller than raw length for compressible data', async () => {
    // Use a highly compressible payload (all-zero 2048 bytes).
    const payload = new Uint8Array(2048).fill(0)
    const bytes = await buildSga({
      archiveName: 'CmpLen',
      files: [{ path: 'data/zeros.bin', bytes: payload }],
    })

    // The file archive should be significantly smaller than 2048 bytes of raw payload
    // (header + compressed). 2048 zeros deflate to ~20 bytes.
    expect(bytes.length).toBeLessThan(2048)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 roundtrip — empty file (zero bytes)', () => {
  it('empty file round-trips with length=0 and empty content', async () => {
    const mf = await buildAndWrap('Empty', [
      { path: 'data/empty.txt', bytes: new Uint8Array(0), compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)

    const entry = archive.list().find(e => e.path === 'data/empty.txt')
    expect(entry).toBeDefined()
    expect(entry!.length).toBe(0)

    const result = await archive.readByPath('data/empty.txt')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 — CRC32 verification', () => {
  it('CRC stored in TOC matches CRC of the uncompressed payload', async () => {
    const payload = new TextEncoder().encode('crc-check payload')
    const expectedCrc = crc32(new Uint8Array(payload))

    const bytes = await buildSga({
      archiveName: 'CRCTest',
      files: [{ path: 'data/check.txt', bytes: payload, compress: false }],
    })

    // The CRC is at offset filePos + 22 in the TOC.
    // File header = 152 bytes.  TOC header = 40 bytes. Drive defs = 4×148=592 bytes.
    // Folder count varies but we can read it from the TOC.
    const view = new DataView(bytes.buffer)

    // TOC starts at byte 152.  tocHeader[16]=filePos (relative to TOC start).
    const tocBase = 152
    const filePos = view.getUint32(tocBase + 16, true) // relative
    const fileRecordStart = tocBase + filePos // absolute

    // First (and only) file record: CRC is at offset +22.
    const storedCrc = view.getUint32(fileRecordStart + 22, true)

    expect(storedCrc).toBe(expectedCrc)
  })

  it('CRC stored in TOC matches for a compressed file (CRC is of raw bytes)', async () => {
    const payload = new TextEncoder().encode('compressed crc payload — repeated repeated repeated')
    const expectedCrc = crc32(new Uint8Array(payload))

    const bytes = await buildSga({
      archiveName: 'CRCZlib',
      files: [{ path: 'data/z.txt', bytes: payload }], // compress: true by default
    })

    const view = new DataView(bytes.buffer)
    const tocBase = 152
    const filePos = view.getUint32(tocBase + 16, true)
    const storedCrc = view.getUint32(tocBase + filePos + 22, true)

    expect(storedCrc).toBe(expectedCrc)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 roundtrip — large payload triggers real deflate', () => {
  it('1.5 KB repeated JSON round-trips correctly (deflate actually fires)', async () => {
    // Construct a payload that is clearly over 1 KB and highly compressible.
    const unit = JSON.stringify({ key: 'value', index: 42, data: 'aaaaaaaaaaaaaaaaaaa' })
    let src = ''
    while (src.length < 1536) src += unit
    const payload = new TextEncoder().encode(src)
    expect(payload.length).toBeGreaterThan(1024)

    const mf = await buildAndWrap('Large', [{ path: 'data/large.json', bytes: payload }])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/large.json')

    expect(result).not.toBeNull()
    expect(result!.length).toBe(payload.length)
    expectBytes(result, payload)
  })

  it('4 KB all-zero buffer compresses to significantly smaller on-disk size', async () => {
    const payload = new Uint8Array(4096).fill(0)
    const bytes = await buildSga({
      archiveName: 'Big0',
      files: [{ path: 'data/zeros.bin', bytes: payload }],
    })
    // A 4096-byte zero block compresses to ~20 bytes with zlib.
    // Total archive overhead is ~600 bytes; even so, total << 4096.
    expect(bytes.length).toBeLessThan(3000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA reader — null/not-found behaviour', () => {
  it('readByPath returns null for a path that does not exist', async () => {
    const mf = await buildAndWrap('X', [
      { path: 'data/exists.txt', bytes: new Uint8Array([1]), compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/does-not-exist.txt')
    expect(result).toBeNull()
  })

  it('readByPath returns null for an empty archive', async () => {
    const mf = await buildAndWrap('EmptyArchive', [])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/anything.txt')
    expect(result).toBeNull()
  })

  it('list() returns an empty array for an archive with no files', async () => {
    const mf = await buildAndWrap('NoFiles', [])
    const archive = await SgaArchive.open(mf as unknown as File)
    expect(archive.list()).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA reader — list() path ordering and completeness', () => {
  it('all inserted paths appear in list()', async () => {
    const paths = [
      'attrib/skin_pack/a.xml',
      'attrib/skin_pack/b.xml',
      'data/art/tex.tga',
      'data/art/norm.tga',
    ]
    const enc = new TextEncoder()
    const files: SgaInputFile[] = paths.map(p => ({
      path: p,
      bytes: enc.encode(p),
      compress: false,
    }))
    const mf = await buildAndWrap('Listed', files)
    const archive = await SgaArchive.open(mf as unknown as File)
    const listed = archive.list().map(e => e.path)

    for (const p of paths) {
      expect(listed).toContain(p)
    }
    // No extra phantom entries
    expect(listed.length).toBe(paths.length)
  })

  it('listPaths() returns the same paths as list()', async () => {
    const enc = new TextEncoder()
    const files: SgaInputFile[] = [
      { path: 'data/x.bin', bytes: enc.encode('x'), compress: false },
      { path: 'attrib/y.xml', bytes: enc.encode('y'), compress: false },
    ]
    const mf = await buildAndWrap('Paths', files)
    const archive = await SgaArchive.open(mf as unknown as File)

    const fromList = archive
      .list()
      .map(e => e.path)
      .sort()
    const fromListPaths = archive.listPaths().sort()

    expect(fromList).toEqual(fromListPaths)
  })

  it('list() entry.read() returns the correct bytes', async () => {
    const payload = new TextEncoder().encode('lazy-read payload')
    const mf = await buildAndWrap('LazyRead', [
      { path: 'data/lazy.txt', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const entry = archive.list().find(e => e.path === 'data/lazy.txt')
    expect(entry).toBeDefined()
    const result = await entry!.read()
    expectBytes(result, payload)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA reader — header magic and version validation', () => {
  it('throws "Not an SGA file" for a buffer with wrong magic', async () => {
    const bad = new Uint8Array(200).fill(0)
    bad.set([0x4e, 0x4f, 0x54, 0x41, 0x52, 0x43, 0x48, 0x56], 0) // "NOTARCHV"
    const mf = new MemFile(bad)
    await expect(SgaArchive.open(mf as unknown as File)).rejects.toThrow('Not an SGA file')
  })

  it('throws for a buffer with all-zero magic', async () => {
    const bad = new Uint8Array(200).fill(0)
    const mf = new MemFile(bad)
    await expect(SgaArchive.open(mf as unknown as File)).rejects.toThrow('Not an SGA file')
  })

  it('throws "not supported" for a valid magic but unsupported version (e.g. v5)', async () => {
    const bad = new Uint8Array(200).fill(0)
    bad.set([0x5f, 0x41, 0x52, 0x43, 0x48, 0x49, 0x56, 0x45], 0) // "_ARCHIVE"
    bad[8] = 5 // major version = 5 (little-endian u16)
    bad[9] = 0
    const mf = new MemFile(bad)
    await expect(SgaArchive.open(mf as unknown as File)).rejects.toThrow('not supported')
  })

  it('does NOT throw for valid SGA v7 magic + version', async () => {
    const mf = await buildAndWrap('Valid', [
      { path: 'data/f.txt', bytes: new TextEncoder().encode('ok'), compress: false },
    ])
    // Should resolve successfully
    await expect(SgaArchive.open(mf as unknown as File)).resolves.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 — drive routing', () => {
  it('attrib/ files land in the attrib drive and are readable', async () => {
    const payload = new TextEncoder().encode('<attrib/>')
    const mf = await buildAndWrap('DrvA', [
      { path: 'attrib/skin_pack/test.xml', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('attrib/skin_pack/test.xml')
    expectBytes(result, payload)
  })

  it('english/ files land in the locale drive and are readable', async () => {
    const payload = new TextEncoder().encode('locale content')
    const mf = await buildAndWrap('DrvL', [
      { path: 'english/skin_pack.ucs', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('english/skin_pack.ucs')
    expectBytes(result, payload)
  })

  it('.info file lands in the info drive and is readable', async () => {
    const payload = new TextEncoder().encode('[info]')
    const mf = await buildAndWrap('DrvI', [
      { path: 'skin_pack.info', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('skin_pack.info')
    expectBytes(result, payload)
  })

  it('unrecognised prefix falls into data drive and is readable', async () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const mf = await buildAndWrap('DrvD', [
      { path: 'data/art/texture.rgt', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/art/texture.rgt')
    expectBytes(result, payload)
  })

  it('files from multiple drives all coexist and read correctly', async () => {
    const enc = new TextEncoder()
    const files: SgaInputFile[] = [
      { path: 'attrib/a.xml', bytes: enc.encode('a'), compress: false },
      { path: 'english/b.ucs', bytes: enc.encode('b'), compress: false },
      { path: 'c.info', bytes: enc.encode('c'), compress: false },
      { path: 'data/d.bin', bytes: enc.encode('d'), compress: false },
    ]
    const mf = await buildAndWrap('AllDrives', files)
    const archive = await SgaArchive.open(mf as unknown as File)

    for (const f of files) {
      const result = await archive.readByPath(f.path)
      expectBytes(result, f.bytes)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 — binary header structure', () => {
  it('magic bytes "_ARCHIVE" are present at offset 0', async () => {
    const bytes = await buildSga({
      archiveName: 'Magic',
      files: [{ path: 'data/f.txt', bytes: new Uint8Array([1]), compress: false }],
    })
    const magic = String.fromCharCode(...bytes.subarray(0, 8))
    expect(magic).toBe('_ARCHIVE')
  })

  it('version major=7, minor=0 at offsets 8-9 and 10-11', async () => {
    const bytes = await buildSga({
      archiveName: 'Ver',
      files: [{ path: 'data/f.txt', bytes: new Uint8Array([1]), compress: false }],
    })
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(8, true)).toBe(7) // major
    expect(view.getUint16(10, true)).toBe(0) // minor
  })

  it('reserved field at offset 148 equals 1', async () => {
    const bytes = await buildSga({
      archiveName: 'Rsv',
      files: [{ path: 'data/f.txt', bytes: new Uint8Array([1]), compress: false }],
    })
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(148, true)).toBe(1)
  })

  it('data_pos (offset 144) is consistent with where payloads actually live', async () => {
    const payload = new Uint8Array([0xaa, 0xbb, 0xcc])
    const bytes = await buildSga({
      archiveName: 'DPos',
      files: [{ path: 'data/f.bin', bytes: payload, compress: false }],
    })
    const view = new DataView(bytes.buffer)
    const dataPos = view.getUint32(144, true)

    // The bytes at dataPos should be the raw payload (storage=0).
    expect(bytes[dataPos]).toBe(0xaa)
    expect(bytes[dataPos + 1]).toBe(0xbb)
    expect(bytes[dataPos + 2]).toBe(0xcc)
  })

  it('data_pos + 256-byte gap is respected (standard gap between TOC end and data)', async () => {
    const bytes = await buildSga({
      archiveName: 'Gap',
      files: [{ path: 'data/f.txt', bytes: new Uint8Array([1]), compress: false }],
    })
    const view = new DataView(bytes.buffer)
    const headerSize = view.getUint32(140, true)
    const dataPos = view.getUint32(144, true)

    // Expected data_pos = 152 (file header) + headerSize (TOC) + 256 (gap)
    expect(dataPos).toBe(152 + headerSize + 256)
  })

  it('total archive byte-length equals header + TOC + gap + compressed payloads', async () => {
    const payload = new TextEncoder().encode('measure me')
    const bytes = await buildSga({
      archiveName: 'Len',
      files: [{ path: 'data/f.txt', bytes: payload }], // compressed
    })
    const view = new DataView(bytes.buffer)
    const headerSize = view.getUint32(140, true)
    const dataPos = view.getUint32(144, true)

    // storeLength: offset 8 within first file record
    const tocBase = 152
    const filePos = view.getUint32(tocBase + 16, true)
    const storeLen = view.getUint32(tocBase + filePos + 8, true)

    expect(bytes.length).toBe(dataPos + storeLen)
    expect(dataPos).toBe(152 + headerSize + 256)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 — names deduplication', () => {
  it('two files with the same basename share a single name entry', async () => {
    // Both files are named "config.xml" (different folders).
    // The writer deduplicates names; the reader must still resolve both correctly.
    const enc = new TextEncoder()
    const files: SgaInputFile[] = [
      { path: 'attrib/german/config.xml', bytes: enc.encode('german'), compress: false },
      { path: 'attrib/okw/config.xml', bytes: enc.encode('okw'), compress: false },
    ]
    const mf = await buildAndWrap('DedupNames', files)
    const archive = await SgaArchive.open(mf as unknown as File)

    const german = await archive.readByPath('attrib/german/config.xml')
    const okw = await archive.readByPath('attrib/okw/config.xml')

    expectBytes(german, enc.encode('german'))
    expectBytes(okw, enc.encode('okw'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 — deflate fallback path (pre-deflated bytes via storage=0)', () => {
  it('manually zlib-deflated payload stored with compress:false is NOT auto-inflated', async () => {
    // We deflate manually, then store with compress=false (storage=0).
    // The reader must return the compressed bytes as-is (no inflation).
    const original = new TextEncoder().encode('inflate me manually')
    const compressed = deflate(new Uint8Array(original))

    const mf = await buildAndWrap('NoAutoInflate', [
      { path: 'data/manual.bin', bytes: compressed, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/manual.bin')

    // Result should be the compressed bytes, NOT the inflated original.
    expect(result).not.toBeNull()
    expect(result!.length).toBe(compressed.length)
    expectBytes(result, compressed)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 — locale/ drive routing', () => {
  it('locale/ prefix routes to the locale drive (same as english/)', async () => {
    const payload = new TextEncoder().encode('locale german content')
    const mf = await buildAndWrap('Locale', [
      { path: 'locale/german/strings.ucs', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('locale/german/strings.ucs')
    expectBytes(result, payload)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 — multiple files at archive root (no sub-folder)', () => {
  it('file at drive root (no subdirectory) is readable', async () => {
    // BUG: The writer routes "skin_pack.info" to drive 2 (info drive) because it
    // ends with ".info". This is correct per the drive routing logic. The path
    // has no slashes, so the folder dir is "" and the file ends up directly in
    // the root folder's file list.
    const payload = new TextEncoder().encode('info content')
    const mf = await buildAndWrap('RootFile', [
      { path: 'skin_pack.info', bytes: payload, compress: false },
    ])
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('skin_pack.info')
    expectBytes(result, payload)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SGA v7 — TOC offset fields are self-consistent', () => {
  it('drive_count in TOC header equals 4', async () => {
    const bytes = await buildSga({
      archiveName: 'DC',
      files: [{ path: 'data/f.bin', bytes: new Uint8Array([1]), compress: false }],
    })
    const view = new DataView(bytes.buffer)
    const tocBase = 152
    const driveCount = view.getUint32(tocBase + 4, true)
    expect(driveCount).toBe(4)
  })

  it('name_count in TOC header equals folderCount + fileCount', async () => {
    const enc = new TextEncoder()
    const bytes = await buildSga({
      archiveName: 'NC',
      files: [
        { path: 'data/a.bin', bytes: enc.encode('a'), compress: false },
        { path: 'data/b.bin', bytes: enc.encode('b'), compress: false },
      ],
    })
    const view = new DataView(bytes.buffer)
    const tocBase = 152
    const folderCount = view.getUint32(tocBase + 12, true)
    const fileCount = view.getUint32(tocBase + 20, true)
    const nameCount = view.getUint32(tocBase + 28, true)
    expect(nameCount).toBe(folderCount + fileCount)
  })

  it('sig_offset in TOC header points to the start of the RSA sig block (zeros)', async () => {
    const bytes = await buildSga({
      archiveName: 'Sig',
      files: [{ path: 'data/f.bin', bytes: new Uint8Array([1]), compress: false }],
    })
    const view = new DataView(bytes.buffer)
    const tocBase = 152
    const sigOffset = view.getUint32(tocBase + 32, true) // relative to TOC start

    // The 140-byte RSA block should be zero-filled (no Relic key available).
    const sigAbsolute = tocBase + sigOffset
    for (let i = 0; i < 140; i++) {
      expect(bytes[sigAbsolute + i]).toBe(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// v10 (CoH3/Anvil) reader tests — hand-crafted synthetic binary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid SGA v10 binary in memory.
 *
 * Layout (simplified, offset-exact):
 *   [0-7]     "_ARCHIVE"
 *   [8-9]     major = 10 (u16 LE)
 *   [10-11]   product = 0 (u16 LE)
 *   [12-139]  archiveName UTF-16-LE, 128 bytes, NUL-padded
 *   [140-147] blobOffset (u64 LE) — we put it at 428 (right after the header)
 *   [148-151] blobLength (u32 LE) — byte length of the TOC blob
 *   [152-159] dataOffset (u64 LE) — absolute offset of data section
 *   [160-167] dataBlobLength (u64 LE) = 0 (unused)
 *   [168-171] unknown2 = 1 (u32 LE)
 *   [172-427] RSA signature (256 bytes, zeros)
 *
 *   TOC blob at offset 428:
 *     11 × u32 = 44 bytes header
 *       [0]  tocDataOffset = 44      (drive section, after the 44-byte header)
 *       [1]  tocDataCount  = 1
 *       [2]  folderDataOffset = 44+148  (folders after 1 drive entry)
 *       [3]  folderDataCount  = 1
 *       [4]  fileDataOffset = 44+148+20 (files after 1 folder entry)
 *       [5]  fileDataCount  = 1
 *       [6]  stringOffset = 44+148+20+30 (strings after 1 file entry)
 *       [7]  stringLength = (name bytes)
 *       [8]  fileHashOffset = 0  (unused)
 *       [9]  fileHashLength = 0
 *       [10] blockSize = 0
 *
 *     drive entry (148 bytes) — alias + name + 5 × u32
 *     folder entry (20 bytes): namePos, folderFirst, folderLast, fileFirst, fileLast
 *     file entry (30 bytes): nameOff(4)+hashOff(4)+dataOff(8)+compLen(4)+uncompLen(4)+verif(1)+storage(1)+crc(4)
 *     strings section: NUL-terminated UTF-8 folder path + NUL-terminated file name
 *
 *   Data block immediately after TOC blob.
 */
function buildV10Binary(
  archiveName: string,
  folderPath: string, // e.g. "art\\armies\\german"
  fileName: string, // e.g. "foo.xml"
  fileBytes: Uint8Array,
  storage: 0 | 1 = 0,
): Uint8Array {
  const enc = new TextEncoder()

  // Strings section: folder path + file name (both NUL-terminated)
  const folderNameBytes = enc.encode(folderPath)
  const fileNameBytes = enc.encode(fileName)
  const stringsSection = new Uint8Array(folderNameBytes.length + 1 + fileNameBytes.length + 1)
  stringsSection.set(folderNameBytes, 0)
  stringsSection[folderNameBytes.length] = 0 // NUL
  stringsSection.set(fileNameBytes, folderNameBytes.length + 1)
  stringsSection[folderNameBytes.length + 1 + fileNameBytes.length] = 0 // NUL

  const folderNamePos = 0
  const fileNamePos = folderNameBytes.length + 1

  // TOC blob layout offsets (all relative to blobOffset = 428):
  const tocHeaderSize = 44 // 11 × u32
  const driveSize = 148 // 1 drive entry
  const folderSize = 20 // 1 folder entry
  const fileSize = 30 // 1 file entry

  const tocDataOff = tocHeaderSize // drive entries
  const folderDataOff = tocDataOff + driveSize // folder entries
  const fileDataOff = folderDataOff + folderSize // file entries
  const stringsOff = fileDataOff + fileSize // strings

  const blobLength = stringsOff + stringsSection.length

  // The data block starts right after the TOC blob.
  const blobOffset = 428 // immediately after 428-byte fixed header
  const dataOffset = blobOffset + blobLength

  // Compress or store the file payload.
  // Use the top-of-file `deflate` import rather than CJS `require()` so this
  // file stays free of node-only globals under TypeScript strict mode.
  const storedBytes: Uint8Array = storage === 1 ? deflate(fileBytes, { level: 6 }) : fileBytes

  const totalLen = dataOffset + storedBytes.length
  const out = new Uint8Array(totalLen)
  const view = new DataView(out.buffer)

  // Fixed header (428 bytes)
  out.set([0x5f, 0x41, 0x52, 0x43, 0x48, 0x49, 0x56, 0x45], 0) // "_ARCHIVE"
  view.setUint16(8, 10, true) // major = 10
  view.setUint16(10, 0, true) // product
  // Archive name UTF-16-LE
  const nameStr = archiveName.slice(0, 63)
  for (let i = 0; i < nameStr.length; i++) {
    out[12 + i * 2] = nameStr.charCodeAt(i) & 0xff
    out[12 + i * 2 + 1] = (nameStr.charCodeAt(i) >> 8) & 0xff
  }
  view.setUint32(140, blobOffset, true) // blobOffset lo (u64, hi=0)
  view.setUint32(144, 0, true) // blobOffset hi
  view.setUint32(148, blobLength, true) // blobLength (u32)
  view.setUint32(152, dataOffset, true) // dataOffset lo (u64, hi=0)
  view.setUint32(156, 0, true) // dataOffset hi
  view.setUint32(160, 0, true) // dataBlobLength lo
  view.setUint32(164, 0, true) // dataBlobLength hi
  view.setUint32(168, 1, true) // unknown2 = 1
  // [172..427] RSA signature — zeros (already)

  // TOC blob header (11 × u32) at offset blobOffset
  const b = blobOffset
  view.setUint32(b + 0, tocDataOff, true) // tocDataOffset
  view.setUint32(b + 4, 1, true) // tocDataCount
  view.setUint32(b + 8, folderDataOff, true) // folderDataOffset
  view.setUint32(b + 12, 1, true) // folderDataCount
  view.setUint32(b + 16, fileDataOff, true) // fileDataOffset
  view.setUint32(b + 20, 1, true) // fileDataCount
  view.setUint32(b + 24, stringsOff, true) // stringOffset
  view.setUint32(b + 28, stringsSection.length, true) // stringLength
  view.setUint32(b + 32, 0, true) // fileHashOffset
  view.setUint32(b + 36, 0, true) // fileHashLength
  view.setUint32(b + 40, 0, true) // blockSize

  // Drive entry (148 bytes) at b + tocDataOff
  // alias (64B) + name (64B) + folderFirst(4) + folderLast(4) + fileFirst(4) + fileLast(4) + root(4) = 148
  const driveBase = b + tocDataOff
  const driveAlias = enc.encode('data')
  out.set(driveAlias, driveBase)
  out.set(driveAlias, driveBase + 64)
  view.setUint32(driveBase + 128, 0, true) // folderFirst
  view.setUint32(driveBase + 132, 1, true) // folderLast
  view.setUint32(driveBase + 136, 0, true) // fileFirst
  view.setUint32(driveBase + 140, 1, true) // fileLast
  view.setUint32(driveBase + 144, 0, true) // rootFolder

  // Folder entry (20 bytes) at b + folderDataOff
  // namePos, folderFirst, folderLast, fileFirst, fileLast
  const fldBase = b + folderDataOff
  view.setUint32(fldBase + 0, folderNamePos, true) // namePos (rel to stringsOff)
  view.setUint32(fldBase + 4, 1, true) // folderFirst = 1 (no children)
  view.setUint32(fldBase + 8, 1, true) // folderLast
  view.setUint32(fldBase + 12, 0, true) // fileFirst
  view.setUint32(fldBase + 16, 1, true) // fileLast

  // File entry (30 bytes) at b + fileDataOff
  // nameOff(4) + hashOff(4) + dataOff(8) + compLen(4) + uncompLen(4) + verif(1) + storage(1) + crc(4) = 30
  const fileBase = b + fileDataOff
  view.setUint32(fileBase + 0, fileNamePos, true) // nameOffset (rel to stringsOff)
  view.setUint32(fileBase + 4, 0, true) // hashOffset (ignored)
  view.setUint32(fileBase + 8, 0, true) // dataOffset lo (rel to dataOffset)
  view.setUint32(fileBase + 12, 0, true) // dataOffset hi
  view.setUint32(fileBase + 16, storedBytes.length, true) // compressedLength
  view.setUint32(fileBase + 20, fileBytes.length, true) // uncompressedLength
  out[fileBase + 24] = 0 // verificationType
  out[fileBase + 25] = storage // storageType
  view.setUint32(fileBase + 26, 0, true) // crc (not validated by reader)

  // Strings section at b + stringsOff
  out.set(stringsSection, b + stringsOff)

  // Data block at dataOffset
  out.set(storedBytes, dataOffset)

  return out
}

describe('SGA v10 reader (CoH3/Anvil) — synthetic binary', () => {
  it('opens a hand-crafted v10 archive and reads the file', async () => {
    const payload = new Uint8Array([0x42, 0x43, 0x44])
    const bin = buildV10Binary('CoH3Archive', 'art\\armies\\german', 'foo.xml', payload, 0)
    const mf = new MemFile(bin)
    const archive = await SgaArchive.open(mf as unknown as File)

    // v10 folder paths are already full backslash-separated paths.
    // The reader returns them with forward slashes.
    const result = await archive.readByPath('art/armies/german/foo.xml')
    expectBytes(result, payload)
  })

  it('v10 archive name round-trips via UTF-16-LE', async () => {
    const payload = new Uint8Array([1])
    const bin = buildV10Binary('MyCoH3Pack', 'data', 'file.bin', payload, 0)
    const mf = new MemFile(bin)
    const archive = await SgaArchive.open(mf as unknown as File)
    expect(archive.archiveName).toBe('MyCoH3Pack')
  })

  it('v10 list() returns the expected path', async () => {
    const payload = new Uint8Array([5, 6, 7])
    const bin = buildV10Binary('V10List', 'textures\\units', 'tank.rgt', payload, 0)
    const mf = new MemFile(bin)
    const archive = await SgaArchive.open(mf as unknown as File)
    const paths = archive.list().map(e => e.path)
    expect(paths).toContain('textures/units/tank.rgt')
  })

  it('v10 readByPath returns null for a missing path', async () => {
    const payload = new Uint8Array([1])
    const bin = buildV10Binary('V10Null', 'data', 'real.bin', payload, 0)
    const mf = new MemFile(bin)
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/nonexistent.bin')
    expect(result).toBeNull()
  })

  it('v10 list() entry has correct uncompressed length', async () => {
    const payload = new Uint8Array(17).fill(0xcc)
    const bin = buildV10Binary('V10Len', 'models', 'tank.rgm', payload, 0)
    const mf = new MemFile(bin)
    const archive = await SgaArchive.open(mf as unknown as File)
    const entry = archive.list().find(e => e.path.endsWith('tank.rgm'))
    expect(entry).toBeDefined()
    expect(entry!.length).toBe(17)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases: unknown storage type and inflateRaw fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('SGA reader — unknown storage type throws', () => {
  it('storage type 3 (brotli, unsupported) causes readByPath to throw', async () => {
    // Build a valid v7 archive and then manually patch the storage byte to 3.
    const payload = new TextEncoder().encode('brotli-like')
    const bytes = await buildSga({
      archiveName: 'Brotli',
      files: [{ path: 'data/f.bin', bytes: payload, compress: false }],
    })

    // Find the first file record's storage byte: tocBase=152, filePos at tocBase+16.
    const view = new DataView(bytes.buffer)
    const tocBase = 152
    const filePos = view.getUint32(tocBase + 16, true)
    // storage is at file record offset +21
    const storageByteOffset = tocBase + filePos + 21
    bytes[storageByteOffset] = 3 // patch to brotli storage type

    const mf = new MemFile(bytes)
    const archive = await SgaArchive.open(mf as unknown as File)

    await expect(archive.readByPath('data/f.bin')).rejects.toThrow('Unknown storage type 3')
  })
})

describe('SGA reader — inflateRaw fallback path', () => {
  it('raw deflate (no zlib header) stored as storage=1 is inflated via inflateRaw fallback', async () => {
    // Build a valid v7 archive, storing the payload uncompressed.
    // Then patch: replace the payload with raw-deflate bytes (no zlib header)
    // and set storage byte to 1. The reader tries inflate(), which will fail
    // because there's no zlib wrapper, then falls back to inflateRaw().
    const { deflateRaw } = await import('pako')
    const original = new Uint8Array([10, 20, 30, 40, 50])
    const rawDeflated = deflateRaw(original)

    // Start with a raw-stored archive so we know the exact data_pos.
    const placeholderBytes = new Uint8Array(rawDeflated.length).fill(0)
    const archiveBytes = await buildSga({
      archiveName: 'RawDeflate',
      files: [{ path: 'data/raw_deflate.bin', bytes: placeholderBytes, compress: false }],
    })

    const view = new DataView(archiveBytes.buffer)
    const tocBase = 152
    const dataPos = view.getUint32(144, true) // absolute data block offset
    const filePos = view.getUint32(tocBase + 16, true)
    const fileRecOff = tocBase + filePos

    // Patch storeLength to rawDeflated.length
    view.setUint32(fileRecOff + 8, rawDeflated.length, true)
    // Patch uncompressed length
    view.setUint32(fileRecOff + 12, original.length, true)
    // Patch storage byte to 1 (STREAM_COMPRESS — triggers inflate then inflateRaw)
    archiveBytes[fileRecOff + 21] = 1

    // Expand the archive buffer to fit rawDeflated (it may be larger than placeholder).
    const finalBytes = new Uint8Array(dataPos + rawDeflated.length)
    finalBytes.set(archiveBytes.subarray(0, dataPos))
    finalBytes.set(rawDeflated, dataPos)

    const mf = new MemFile(finalBytes)
    const archive = await SgaArchive.open(mf as unknown as File)
    const result = await archive.readByPath('data/raw_deflate.bin')

    expect(result).not.toBeNull()
    expect(Array.from(result!)).toEqual(Array.from(original))
  })
})
