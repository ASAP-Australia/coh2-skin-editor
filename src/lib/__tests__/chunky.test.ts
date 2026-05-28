/**
 * Unit tests for the Relic Chunky binary parser (chunky.ts).
 *
 * All tests use hand-crafted synthetic byte streams so they run in CI
 * without any game files. Covers both v3 (CoH2) and v4 (CoH3/Anvil)
 * format variants.
 *
 * v3 file header (36 bytes):
 *   [0..15]   "Relic Chunky\r\n\x1A\0"
 *   [16..19]  version = 3  (uint32 LE)
 *   [20..23]  sig2 = 0x1A0A0D (uint32 LE)
 *   [24..35]  three padding uint32s
 *
 * v3 chunk header (28 bytes + nameSize + payloadSize):
 *   [0..3]    kind      "DATA" or "FOLD"
 *   [4..7]    fourCC    e.g. "MODL"
 *   [8..11]   version   uint32 LE
 *   [12..15]  size      payload bytes (uint32 LE)
 *   [16..19]  nameSize  uint32 LE
 *   [20..23]  unknown_a uint32 LE (ignored)
 *   [24..27]  unknown_b uint32 LE (ignored)
 *   [28..28+nameSize-1] name (ASCII)
 *   [28+nameSize..]     payload (size bytes)
 *
 * v4 file header (24 bytes):
 *   [0..15]   "Relic Chunky\r\n\x1A\0"
 *   [16..19]  version = 4  (uint32 LE)
 *   [20..23]  platform (uint32 LE)
 *
 * v4 chunk header (20 bytes + pathLen + payloadSize):
 *   [0..3]    kind      "DATA" or "FOLD"
 *   [4..7]    fourCC    e.g. "TXTR"
 *   [8..11]   version   int32 LE
 *   [12..15]  length    payload bytes (int32 LE)
 *   [16..19]  pathLen   int32 LE
 *   [20..20+pathLen-1]  path (ASCII)
 *   [20+pathLen..]      payload (length bytes)
 */

import { describe, it, expect } from 'vitest'
import {
  parseChunky,
  findChunk,
  findAllChunks,
  isChunky,
  Reader,
  type Chunk,
  type ChunkKind,
} from '../chunky'

// ─── Low-level helpers ────────────────────────────────────────────────────────

function putU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
  buf[offset + 2] = (value >>> 16) & 0xff
  buf[offset + 3] = (value >>> 24) & 0xff
}

function putASCII(buf: Uint8Array, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) buf[offset + i] = str.charCodeAt(i)
}

// ─── v3 builders ─────────────────────────────────────────────────────────────

/** Write the 36-byte v3 file header into `buf` starting at `offset`. */
function writeV3FileHeader(buf: Uint8Array, offset = 0): void {
  const magic = 'Relic Chunky\r\n\x1A\0'
  for (let i = 0; i < magic.length; i++) buf[offset + i] = magic.charCodeAt(i)
  putU32(buf, offset + 16, 3) // version
  putU32(buf, offset + 20, 0x1a0a0d) // sig2
  // remaining 12 bytes are already zero
}

interface V3ChunkOpts {
  kind: ChunkKind
  fourCC: string // exactly 4 chars
  version?: number
  name?: string // chunk name (ASCII)
  payload?: Uint8Array
}

/**
 * Serialise a single v3 chunk (header + name + payload) into a fresh
 * Uint8Array.  Does NOT recurse — for FOLD chunks supply the pre-serialised
 * children as `payload`.
 */
function buildV3Chunk(opts: V3ChunkOpts): Uint8Array {
  const { kind, fourCC, version = 1, name = '', payload = new Uint8Array(0) } = opts
  const enc = new TextEncoder()
  const nameBytes = enc.encode(name)
  const nameSize = nameBytes.length
  const headerSize = 28
  const total = headerSize + nameSize + payload.length
  const buf = new Uint8Array(total)
  putASCII(buf, 0, kind)
  putASCII(buf, 4, fourCC)
  putU32(buf, 8, version)
  putU32(buf, 12, payload.length) // size
  putU32(buf, 16, nameSize) // name_size
  // unknown_a (buf[20..23]) and unknown_b (buf[24..27]) remain 0
  if (nameSize > 0) buf.set(nameBytes, headerSize)
  buf.set(payload, headerSize + nameSize)
  return buf
}

/** Concatenate multiple Uint8Arrays. */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const a of arrays) {
    out.set(a, pos)
    pos += a.length
  }
  return out
}

/** Build a complete v3 Chunky file from pre-built chunk bytes. */
function buildV3File(...chunkArrays: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(36)
  writeV3FileHeader(header)
  return concat(header, ...chunkArrays)
}

// ─── v4 builders ─────────────────────────────────────────────────────────────

function writeV4FileHeader(buf: Uint8Array, offset = 0): void {
  const magic = 'Relic Chunky\r\n\x1A\0'
  for (let i = 0; i < magic.length; i++) buf[offset + i] = magic.charCodeAt(i)
  putU32(buf, offset + 16, 4) // version
  putU32(buf, offset + 20, 1) // platform = 1 (PC)
}

interface V4ChunkOpts {
  kind: ChunkKind
  fourCC: string
  version?: number
  path?: string // path / name string
  payload?: Uint8Array
}

function buildV4Chunk(opts: V4ChunkOpts): Uint8Array {
  const { kind, fourCC, version = 1, path = '', payload = new Uint8Array(0) } = opts
  const enc = new TextEncoder()
  const pathBytes = enc.encode(path)
  const pathLen = pathBytes.length
  const headerSize = 20
  const total = headerSize + pathLen + payload.length
  const buf = new Uint8Array(total)
  putASCII(buf, 0, kind)
  putASCII(buf, 4, fourCC)
  putU32(buf, 8, version)
  putU32(buf, 12, payload.length) // length
  putU32(buf, 16, pathLen) // pathLen
  if (pathLen > 0) buf.set(pathBytes, headerSize)
  buf.set(payload, headerSize + pathLen)
  return buf
}

function buildV4File(...chunkArrays: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(24)
  writeV4FileHeader(header)
  return concat(header, ...chunkArrays)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isChunky', () => {
  it('returns true for a valid v3 file header', () => {
    const buf = new Uint8Array(36)
    writeV3FileHeader(buf)
    expect(isChunky(buf)).toBe(true)
  })

  it('returns true for a valid v4 file header', () => {
    const buf = new Uint8Array(24)
    writeV4FileHeader(buf)
    expect(isChunky(buf)).toBe(true)
  })

  it('returns false for a buffer that is too short', () => {
    expect(isChunky(new Uint8Array(5))).toBe(false)
  })

  it('returns false when magic is corrupted', () => {
    const buf = new Uint8Array(36)
    writeV3FileHeader(buf)
    buf[0] = 0x00 // break first byte of "Relic Chunky"
    expect(isChunky(buf)).toBe(false)
  })

  it('accepts ArrayBuffer as well as Uint8Array', () => {
    const arr = new Uint8Array(36)
    writeV3FileHeader(arr)
    expect(isChunky(arr.buffer)).toBe(true)
  })
})

describe('parseChunky — v3 (CoH2)', () => {
  // ── single DATA chunk ────────────────────────────────────────────────────

  it('parses a single DATA chunk: kind, fourCC, version, payloadOffset, payloadSize', () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const chunk = buildV3Chunk({ kind: 'DATA', fourCC: 'MODL', version: 7, payload })
    const file = buildV3File(chunk)

    const { version, root } = parseChunky(file)

    expect(version).toBe(3)
    expect(root).toHaveLength(1)

    const c = root[0]
    expect(c.kind).toBe('DATA')
    expect(c.fourCC).toBe('MODL')
    expect(c.version).toBe(7)
    expect(c.payloadSize).toBe(4)
    expect(c.children).toEqual([])

    // payloadOffset must point into the file buffer — read back the payload
    const fileU8 = file instanceof Uint8Array ? file : new Uint8Array(file)
    const actual = fileU8.slice(c.payloadOffset, c.payloadOffset + c.payloadSize)
    expect(Array.from(actual)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  // ── FOLD chunk with one DATA child ──────────────────────────────────────

  it('FOLD chunk: children array contains the nested DATA chunk', () => {
    const inner = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'MESH',
      version: 2,
      payload: new Uint8Array([1, 2, 3]),
    })
    const fold = buildV3Chunk({ kind: 'FOLD', fourCC: 'MODL', version: 1, payload: inner })
    const file = buildV3File(fold)

    const { root } = parseChunky(file)

    expect(root).toHaveLength(1)
    const foldChunk = root[0]
    expect(foldChunk.kind).toBe('FOLD')
    expect(foldChunk.fourCC).toBe('MODL')
    expect(foldChunk.children).toHaveLength(1)

    const child = foldChunk.children[0]
    expect(child.kind).toBe('DATA')
    expect(child.fourCC).toBe('MESH')
    expect(child.version).toBe(2)
    expect(child.payloadSize).toBe(3)
  })

  // ── FOLD with 2 siblings + post-fold DATA ────────────────────────────────

  it('FOLD containing 2 siblings is followed by a top-level DATA chunk — all are parsed', () => {
    const child1 = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'AAA_',
      version: 1,
      payload: new Uint8Array(2),
    })
    const child2 = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'BBB_',
      version: 2,
      payload: new Uint8Array(4),
    })
    const foldData = concat(child1, child2)
    const fold = buildV3Chunk({ kind: 'FOLD', fourCC: 'MRGM', version: 1, payload: foldData })
    const topData = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'TRIM',
      version: 3,
      payload: new Uint8Array(1),
    })
    const file = buildV3File(fold, topData)

    const { root } = parseChunky(file)

    expect(root).toHaveLength(2)
    expect(root[0].kind).toBe('FOLD')
    expect(root[0].fourCC).toBe('MRGM')
    expect(root[0].children).toHaveLength(2)
    expect(root[0].children[0].fourCC).toBe('AAA_')
    expect(root[0].children[1].fourCC).toBe('BBB_')
    expect(root[1].kind).toBe('DATA')
    expect(root[1].fourCC).toBe('TRIM')
  })

  // ── Non-empty name field ─────────────────────────────────────────────────

  it('decodes the ASCII name field correctly', () => {
    const name = 'TEX_diffuse'
    const payload = new Uint8Array([0xff])
    const chunk = buildV3Chunk({ kind: 'DATA', fourCC: 'TXTR', version: 1, name, payload })
    const file = buildV3File(chunk)

    const { root } = parseChunky(file)
    expect(root[0].name).toBe('TEX_diffuse')
  })

  it('name with embedded null terminator is trimmed at the null', () => {
    // Build manually: nameSize = 8, actual text is "hello\0" (5 + null + 2 pad)
    const enc = new TextEncoder()
    const nameBytesRaw = new Uint8Array(8)
    const helloBytes = enc.encode('hello')
    nameBytesRaw.set(helloBytes) // 'h','e','l','l','o', 0, 0, 0

    const chunkHeaderSize = 28
    const payloadSize = 0
    const total = chunkHeaderSize + 8 + payloadSize
    const buf = new Uint8Array(total)
    putASCII(buf, 0, 'DATA')
    putASCII(buf, 4, 'TXTR')
    putU32(buf, 8, 1) // version
    putU32(buf, 12, payloadSize)
    putU32(buf, 16, 8) // name_size
    buf.set(nameBytesRaw, 28)

    const file = buildV3File(buf)
    const { root } = parseChunky(file)
    expect(root[0].name).toBe('hello')
  })

  it('DATA chunk with empty name returns empty string', () => {
    const chunk = buildV3Chunk({ kind: 'DATA', fourCC: 'DATA', version: 1 })
    const file = buildV3File(chunk)
    const { root } = parseChunky(file)
    expect(root[0].name).toBe('')
  })

  // ── Error cases ──────────────────────────────────────────────────────────

  it('throws when magic is wrong', () => {
    const buf = new Uint8Array(36)
    writeV3FileHeader(buf)
    buf[0] = 0x58 // corrupt first byte
    expect(() => parseChunky(buf)).toThrow('Not a Relic Chunky file (bad magic)')
  })

  it('throws for an unsupported version number', () => {
    const buf = new Uint8Array(36)
    writeV3FileHeader(buf)
    putU32(buf, 16, 99) // overwrite version with 99
    expect(() => parseChunky(buf)).toThrow('Chunky version 99 not supported')
  })

  it('version=2 is not supported — throws', () => {
    const buf = new Uint8Array(36)
    writeV3FileHeader(buf)
    putU32(buf, 16, 2)
    expect(() => parseChunky(buf)).toThrow()
  })

  // ── Truncated / malformed buffers ────────────────────────────────────────

  it('truncated chunk (payloadEnd > buffer end) is silently skipped — returns empty root', () => {
    // Build a chunk that claims 1000 bytes of payload but we only supply 4.
    const chunk = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'MODL',
      version: 1,
      payload: new Uint8Array(4),
    })
    // Corrupt the size field to say 1000 bytes while the actual buffer is tiny
    putU32(chunk, 12, 1000)
    const file = buildV3File(chunk)
    // Parser breaks out of the loop when payloadEnd > end; no throw expected
    const { root } = parseChunky(file)
    expect(root).toEqual([])
  })

  it('file header only (no chunks) returns empty root', () => {
    const file = buildV3File() // just the 36-byte header, zero chunks
    const { version, root } = parseChunky(file)
    expect(version).toBe(3)
    expect(root).toEqual([])
  })

  it('accepts ArrayBuffer input as well as Uint8Array', () => {
    const payload = new Uint8Array(2)
    const chunk = buildV3Chunk({ kind: 'DATA', fourCC: 'MODL', version: 1, payload })
    const file = buildV3File(chunk)
    const result = parseChunky(file.buffer as ArrayBuffer)
    expect(result.root).toHaveLength(1)
  })
})

// ─── v4 (CoH3 / Anvil) ───────────────────────────────────────────────────────

describe('parseChunky — v4 (CoH3/Anvil)', () => {
  it('parses a single DATA chunk: kind, fourCC, version, payloadSize, name', () => {
    const pathStr = 'textures/diffuse.dds'
    const payload = new Uint8Array([0xca, 0xfe])
    const chunk = buildV4Chunk({ kind: 'DATA', fourCC: 'TXTR', version: 3, path: pathStr, payload })
    const file = buildV4File(chunk)

    const { version, root } = parseChunky(file)

    expect(version).toBe(4)
    expect(root).toHaveLength(1)

    const c = root[0]
    expect(c.kind).toBe('DATA')
    expect(c.fourCC).toBe('TXTR')
    expect(c.version).toBe(3)
    expect(c.payloadSize).toBe(2)
    expect(c.name).toBe(pathStr)
    expect(c.children).toEqual([])

    // Verify payloadOffset actually points to the payload bytes
    const fileU8 = file instanceof Uint8Array ? file : new Uint8Array(file)
    const actual = fileU8.slice(c.payloadOffset, c.payloadOffset + c.payloadSize)
    expect(Array.from(actual)).toEqual([0xca, 0xfe])
  })

  it('v4 DATA chunk with no path has empty name', () => {
    const chunk = buildV4Chunk({ kind: 'DATA', fourCC: 'TDAT', version: 1 })
    const file = buildV4File(chunk)
    const { root } = parseChunky(file)
    expect(root[0].name).toBe('')
  })

  it('FOLD containing a nested DATA chunk — recursive children are populated', () => {
    const inner = buildV4Chunk({
      kind: 'DATA',
      fourCC: 'TDAT',
      version: 1,
      payload: new Uint8Array([0x42]),
    })
    const fold = buildV4Chunk({ kind: 'FOLD', fourCC: 'TSET', version: 2, payload: inner })
    const file = buildV4File(fold)

    const { root } = parseChunky(file)

    expect(root).toHaveLength(1)
    const foldChunk = root[0]
    expect(foldChunk.kind).toBe('FOLD')
    expect(foldChunk.fourCC).toBe('TSET')
    expect(foldChunk.children).toHaveLength(1)

    const child = foldChunk.children[0]
    expect(child.kind).toBe('DATA')
    expect(child.fourCC).toBe('TDAT')
    expect(child.payloadSize).toBe(1)
  })

  it('v4 FOLD with two children followed by top-level DATA — all parsed', () => {
    const c1 = buildV4Chunk({
      kind: 'DATA',
      fourCC: 'CCC_',
      version: 1,
      payload: new Uint8Array(3),
    })
    const c2 = buildV4Chunk({
      kind: 'DATA',
      fourCC: 'DDD_',
      version: 2,
      payload: new Uint8Array(2),
    })
    const fold = buildV4Chunk({ kind: 'FOLD', fourCC: 'TMAN', version: 1, payload: concat(c1, c2) })
    const top = buildV4Chunk({
      kind: 'DATA',
      fourCC: 'TXTR',
      version: 5,
      payload: new Uint8Array(1),
    })
    const file = buildV4File(fold, top)

    const { root } = parseChunky(file)

    expect(root).toHaveLength(2)
    expect(root[0].fourCC).toBe('TMAN')
    expect(root[0].children).toHaveLength(2)
    expect(root[0].children[0].fourCC).toBe('CCC_')
    expect(root[0].children[1].fourCC).toBe('DDD_')
    expect(root[1].fourCC).toBe('TXTR')
  })

  it('v4 truncated chunk is silently skipped — returns empty root', () => {
    const chunk = buildV4Chunk({
      kind: 'DATA',
      fourCC: 'TXTR',
      version: 1,
      payload: new Uint8Array(4),
    })
    // Corrupt size to claim 9999 bytes
    putU32(chunk, 12, 9999)
    const file = buildV4File(chunk)
    const { root } = parseChunky(file)
    expect(root).toEqual([])
  })
})

// ─── findChunk ────────────────────────────────────────────────────────────────

describe('findChunk', () => {
  function buildSimpleV3Tree(): { version: number; root: Chunk[] } {
    const leaf1 = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'MESH',
      version: 1,
      payload: new Uint8Array(1),
    })
    const leaf2 = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'MODL',
      version: 2,
      payload: new Uint8Array(1),
    })
    const fold = buildV3Chunk({
      kind: 'FOLD',
      fourCC: 'MRGM',
      version: 1,
      payload: concat(leaf1, leaf2),
    })
    const topDat = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'TRIM',
      version: 1,
      payload: new Uint8Array(2),
    })
    const file = buildV3File(fold, topDat)
    return parseChunky(file)
  }

  it('finds a top-level chunk by fourCC', () => {
    const { root } = buildSimpleV3Tree()
    const found = findChunk(root, 'TRIM')
    expect(found).not.toBeNull()
    expect(found!.fourCC).toBe('TRIM')
  })

  it('finds a nested child chunk by fourCC (BFS walk)', () => {
    const { root } = buildSimpleV3Tree()
    const found = findChunk(root, 'MESH')
    expect(found).not.toBeNull()
    expect(found!.fourCC).toBe('MESH')
    expect(found!.kind).toBe('DATA')
  })

  it('returns null when fourCC does not exist in the tree', () => {
    const { root } = buildSimpleV3Tree()
    expect(findChunk(root, 'NOPE')).toBeNull()
  })

  it('returns the first match when multiple chunks share the same fourCC', () => {
    // Two top-level DATA chunks both have fourCC 'DUPE'
    const c1 = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'DUPE',
      version: 1,
      payload: new Uint8Array([0x01]),
    })
    const c2 = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'DUPE',
      version: 2,
      payload: new Uint8Array([0x02]),
    })
    const file = buildV3File(c1, c2)
    const { root } = parseChunky(file)

    const found = findChunk(root, 'DUPE')
    expect(found).not.toBeNull()
    expect(found!.version).toBe(1) // first match
  })

  it('handles empty roots array', () => {
    expect(findChunk([], 'MODL')).toBeNull()
  })
})

// ─── findAllChunks ────────────────────────────────────────────────────────────

describe('findAllChunks', () => {
  it('collects all matches at any depth', () => {
    const inner = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'MESH',
      version: 1,
      payload: new Uint8Array(1),
    })
    const fold = buildV3Chunk({ kind: 'FOLD', fourCC: 'MODL', version: 1, payload: inner })
    const topMesh = buildV3Chunk({
      kind: 'DATA',
      fourCC: 'MESH',
      version: 2,
      payload: new Uint8Array(1),
    })
    const file = buildV3File(fold, topMesh)
    const { root } = parseChunky(file)

    const all = findAllChunks(root, 'MESH')
    expect(all).toHaveLength(2)
    // preorder: nested inner comes before topMesh
    expect(all[0].version).toBe(1)
    expect(all[1].version).toBe(2)
  })

  it('returns empty array when no chunk matches', () => {
    const chunk = buildV3Chunk({ kind: 'DATA', fourCC: 'MODL', version: 1 })
    const file = buildV3File(chunk)
    const { root } = parseChunky(file)
    expect(findAllChunks(root, 'NOPE')).toEqual([])
  })

  it('handles empty roots array', () => {
    expect(findAllChunks([], 'MODL')).toEqual([])
  })
})

// ─── Reader ───────────────────────────────────────────────────────────────────

describe('Reader', () => {
  function makeReader(bytes: number[]): Reader {
    return new Reader(new Uint8Array(bytes))
  }

  it('u8At reads a single byte and advances pos by 1', () => {
    const r = makeReader([0xab, 0xcd])
    expect(r.u8At()).toBe(0xab)
    expect(r.pos).toBe(1)
  })

  it('u16 reads a LE uint16 and advances pos by 2', () => {
    const r = makeReader([0x01, 0x02, 0x00])
    expect(r.u16()).toBe(0x0201)
    expect(r.pos).toBe(2)
  })

  it('u32 reads a LE uint32 and advances pos by 4', () => {
    const r = makeReader([0x01, 0x00, 0x00, 0x00])
    expect(r.u32()).toBe(1)
    expect(r.pos).toBe(4)
  })

  it('i32 reads a negative LE int32 correctly', () => {
    // -1 in LE: [0xff, 0xff, 0xff, 0xff]
    const r = makeReader([0xff, 0xff, 0xff, 0xff])
    expect(r.i32()).toBe(-1)
  })

  it('f32 reads a float', () => {
    // 1.0 in IEEE 754 LE: 0x3F 80 00 00
    const r = makeReader([0x00, 0x00, 0x80, 0x3f])
    expect(r.f32()).toBeCloseTo(1.0)
  })

  it('bytes returns a subarray of the requested length', () => {
    const r = makeReader([0x0a, 0x0b, 0x0c, 0x0d])
    const b = r.bytes(3)
    expect(Array.from(b)).toEqual([0x0a, 0x0b, 0x0c])
    expect(r.pos).toBe(3)
  })

  it('skip advances pos without reading', () => {
    const r = makeReader([0x01, 0x02, 0x03])
    r.skip(2)
    expect(r.pos).toBe(2)
    expect(r.u8At()).toBe(0x03)
  })

  it('lpstr reads a length-prefixed string with no trailing NUL', () => {
    const enc = new TextEncoder()
    const text = 'hello'
    const bytes = enc.encode(text)
    const buf = new Uint8Array(4 + bytes.length)
    putU32(buf, 0, bytes.length)
    buf.set(bytes, 4)
    const r = new Reader(buf)
    expect(r.lpstr()).toBe('hello')
    expect(r.pos).toBe(4 + bytes.length)
  })

  it('lpstr trims a trailing NUL inside the byte count', () => {
    const enc = new TextEncoder()
    const text = 'hi'
    const bytes = enc.encode(text)
    // length field counts the NUL as well
    const buf = new Uint8Array(4 + bytes.length + 1)
    putU32(buf, 0, bytes.length + 1)
    buf.set(bytes, 4)
    buf[4 + bytes.length] = 0 // trailing NUL
    const r = new Reader(buf)
    expect(r.lpstr()).toBe('hi')
  })

  it('lpstr returns empty string for zero-length field', () => {
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    const r = new Reader(buf)
    expect(r.lpstr()).toBe('')
    expect(r.pos).toBe(4)
  })

  it('Reader start offset respected', () => {
    const buf = new Uint8Array([0xff, 0x01, 0x00, 0x00, 0x00])
    const r = new Reader(buf, 1) // start at byte 1
    expect(r.u32()).toBe(1)
  })
})
