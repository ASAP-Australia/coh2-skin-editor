/**
 * Relic Chunky v3 reader — the container format wrapping every Relic
 * "data file" (.rgm, .rgt, .rga, etc.). Verified bit-for-bit against
 * the corsix/coh2-formats spec and against real CoH2 v3 files.
 *
 * File header (36 bytes):
 *   16  "Relic Chunky\r\n\x1A\0"
 *    4  version  (3)
 *    4  sig2     (0x1A0A0D)
 *    4  ?
 *    4  ?
 *    4  ?
 *
 * Each chunk header (28 bytes + name):
 *    4  kind         "FOLD" | "DATA"
 *    4  fourCC       e.g. "MODL", "MESH", "MRGM", "TRIM", "DATA"
 *    4  version      uint32, varies per fourCC
 *    4  size         payload bytes
 *    4  name_size    bytes (name string follows the header before payload)
 *    4  unknown_a    skip
 *    4  unknown_b    skip
 *    N  name         ASCII, sometimes null-terminated within name_size
 *    M  payload      `size` bytes
 *
 * FOLD chunks recurse — their payload is more chunks. DATA chunks are leaves.
 */

export type ChunkKind = 'DATA' | 'FOLD'

export interface Chunk {
  kind: ChunkKind
  fourCC: string         // 4 chars (may include leading space, e.g. " VAR")
  version: number
  name: string
  /** Payload byte offset in the parent buffer. */
  payloadOffset: number
  /** Payload byte length. */
  payloadSize: number
  /** Children (FOLD only). DATA chunks always have []. */
  children: Chunk[]
}

const MAGIC = new TextEncoder().encode('Relic Chunky')

export function isChunky(buf: ArrayBuffer | Uint8Array): boolean {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (u8.length < MAGIC.length) return false
  for (let i = 0; i < MAGIC.length; i++) if (u8[i] !== MAGIC[i]) return false
  return true
}

/** Parse a complete .rgm/.rgt/etc file into a chunk tree. */
export function parseChunky(buf: ArrayBuffer | Uint8Array): { version: number; root: Chunk[] } {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (!isChunky(u8)) throw new Error('Not a Relic Chunky file (bad magic)')
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const version = view.getUint32(16, true)
  if (version !== 3) {
    throw new Error(`Chunky version ${version} not supported (expected 3)`)
  }
  // Header is 36 bytes: 16 magic + 5 × uint32. Chunks start at offset 36.
  const root = parseChunks(u8, view, 36, u8.length)
  return { version, root }
}

/** Parse a sequence of chunks within `[start, end)`. Recurses into FOLDers. */
export function parseChunks(
  u8: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): Chunk[] {
  const out: Chunk[] = []
  let p = start
  while (p + 28 <= end) {
    const kindBytes = u8.subarray(p, p + 4)
    const kindStr = String.fromCharCode(kindBytes[0], kindBytes[1], kindBytes[2], kindBytes[3])
    if (kindStr !== 'DATA' && kindStr !== 'FOLD') break
    const fourCC = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7])
    const cver = view.getUint32(p + 8, true)
    const size = view.getUint32(p + 12, true)
    const nameSize = view.getUint32(p + 16, true)
    // Two more uint32 fields (unknown_a, unknown_b) at p+20, p+24
    const nameStart = p + 28
    const payloadOffset = nameStart + nameSize
    const payloadEnd = payloadOffset + size
    if (payloadEnd > end) break
    const name = decodeName(u8, nameStart, nameSize)
    const chunk: Chunk = {
      kind: kindStr as ChunkKind,
      fourCC,
      version: cver,
      name,
      payloadOffset,
      payloadSize: size,
      children: [],
    }
    if (kindStr === 'FOLD') {
      chunk.children = parseChunks(u8, view, payloadOffset, payloadEnd)
    }
    out.push(chunk)
    p = payloadEnd
  }
  return out
}

function decodeName(u8: Uint8Array, start: number, size: number): string {
  if (size === 0) return ''
  // Find first null terminator within the field, otherwise use the whole length
  let end = start + size
  for (let i = start; i < start + size; i++) {
    if (u8[i] === 0) { end = i; break }
  }
  return new TextDecoder('ascii', { fatal: false }).decode(u8.subarray(start, end))
}

/** Find the first descendant matching the given fourCC (BFS). Returns null if none. */
export function findChunk(roots: Chunk[], fourCC: string): Chunk | null {
  const queue: Chunk[] = [...roots]
  while (queue.length) {
    const c = queue.shift()!
    if (c.fourCC === fourCC) return c
    if (c.children.length) queue.push(...c.children)
  }
  return null
}

/** Find every descendant matching fourCC (preorder). */
export function findAllChunks(roots: Chunk[], fourCC: string): Chunk[] {
  const out: Chunk[] = []
  const stack: Chunk[] = [...roots].reverse()
  while (stack.length) {
    const c = stack.pop()!
    if (c.fourCC === fourCC) out.push(c)
    for (let i = c.children.length - 1; i >= 0; i--) stack.push(c.children[i])
  }
  return out
}

/** A small DataView-like reader that tracks position. Convenient for the
 *  payload-decode loops in rgm.ts / rgt.ts. */
export class Reader {
  view: DataView
  u8: Uint8Array
  pos: number
  constructor(u8: Uint8Array, start = 0) {
    this.u8 = u8
    this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    this.pos = start
  }
  u8At() { return this.u8[this.pos++] }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v }
  i32() { const v = this.view.getInt32(this.pos, true);  this.pos += 4; return v }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v }
  bytes(n: number): Uint8Array {
    const out = this.u8.subarray(this.pos, this.pos + n); this.pos += n; return out
  }
  /** Read a length-prefixed Relic string (uint32 length, then ASCII bytes,
   *  may include a trailing NUL inside the byte count). */
  lpstr(): string {
    const n = this.u32()
    if (n === 0) return ''
    const raw = this.bytes(n)
    // Trim a single trailing NUL if present (corsix's reader does this)
    const end = raw[raw.length - 1] === 0 ? raw.length - 1 : raw.length
    return new TextDecoder('ascii').decode(raw.subarray(0, end))
  }
  skip(n: number) { this.pos += n }
}
