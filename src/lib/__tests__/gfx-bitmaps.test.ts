/**
 * Unit tests for the GFX bitmap extractor.
 *
 * All tests use hand-crafted byte streams so they run in CI without any
 * game files or external assets.
 */
import { describe, it, expect } from 'vitest'
import { extractGfxBitmaps } from '@/lib/gfx-bitmaps'
import { deflate } from 'pako'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Write a u16 LE into a byte array at the given offset. */
function putU16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >> 8) & 0xff
}

/** Write a u32 LE into a byte array at the given offset. */
function putU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >> 8) & 0xff
  buf[offset + 2] = (value >> 16) & 0xff
  buf[offset + 3] = (value >> 24) & 0xff
}

/**
 * Build a minimal GFX file byte-by-byte.
 *
 * Layout:
 *   [0..2]   magic ('GFX')
 *   [3]      version (14)
 *   [4..7]   u32LE fileLength (ignored by parser, set to 0)
 *   [8..]    SWF body:
 *              RECT  (simplest: 5-bit Nbits=0 → just the 5 zero bits → 1 byte = 0x00)
 *              u16   frameRate  (0x0C00 = 12.0 fps)
 *              u16   frameCount (1)
 *              ... tag stream ...
 */
function buildGfxFile(tagBytes: Uint8Array[]): Uint8Array {
  // GFX header (8 bytes)
  const header = new Uint8Array(8)
  header[0] = 0x47 // 'G'
  header[1] = 0x46 // 'F'
  header[2] = 0x58 // 'X'
  header[3] = 14 // version

  // SWF frame header: RECT (1 byte, Nbits=0 → no Xmin/Xmax/Ymin/Ymax bits) +
  //   u16 frameRate + u16 frameCount
  const swfFrameHeader = new Uint8Array([0x00, 0x00, 0x0c, 0x01, 0x00])

  // End tag: code=0, short length=0 → u16 = 0x0000
  const endTag = new Uint8Array([0x00, 0x00])

  // Concatenate everything
  const parts = [header, swfFrameHeader, ...tagBytes, endTag]
  const totalLen = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

/**
 * Encode a short-form SWF tag (code, data).
 * If data.length < 63, uses the 2-byte header.
 * Otherwise throws — use buildLongTag for large payloads.
 */
function buildShortTag(code: number, data: Uint8Array): Uint8Array {
  if (data.length >= 0x3f) throw new Error('Use buildLongTag for payloads >= 63 bytes')
  const tag = new Uint8Array(2 + data.length)
  putU16(tag, 0, (code << 6) | data.length)
  tag.set(data, 2)
  return tag
}

/**
 * Encode a long-form SWF tag (u16 header with length=0x3F, then u32 actual length).
 * Used to test the tag-length extension path.
 */
function buildLongTag(code: number, data: Uint8Array): Uint8Array {
  const tag = new Uint8Array(6 + data.length)
  putU16(tag, 0, (code << 6) | 0x3f) // short header with length sentinel
  putU32(tag, 2, data.length) // actual u32 length
  tag.set(data, 6)
  return tag
}

/**
 * Build a DefineBitsLossless2 (tag 36) payload for a 1×1 ARGB pixel.
 *
 * Body layout:
 *   u16 characterId
 *   u8  bitmapFormat (5 = 32-bit ARGB)
 *   u16 width
 *   u16 height
 *   zlib( ARGB × width×height )
 */
function buildLossless2Tag(
  charId: number,
  argb: [number, number, number, number], // [A, R, G, B]
  useLongHeader = false,
): Uint8Array {
  // 1×1 image: one ARGB pixel
  const rawPixels = new Uint8Array([argb[0], argb[1], argb[2], argb[3]])
  const compressed = deflate(rawPixels)

  // Tag body: u16 id + u8 fmt + u16 w + u16 h + compressed
  const body = new Uint8Array(7 + compressed.length)
  putU16(body, 0, charId)
  body[2] = 5 // format: 32-bit ARGB
  putU16(body, 3, 1) // width
  putU16(body, 5, 1) // height
  body.set(compressed, 7)

  return useLongHeader ? buildLongTag(36, body) : buildShortTag(36, body)
}

/**
 * Build an ExportAssets (tag 56) payload that maps charId → name.
 */
function buildExportAssetsTag(entries: [number, string][]): Uint8Array {
  // Calculate total size: u16 count + entries × (u16 charId + name + NUL)
  let bodyLen = 2
  const enc = new TextEncoder()
  const encodedNames = entries.map(([, name]) => enc.encode(name))
  for (const n of encodedNames) bodyLen += 2 + n.length + 1

  const body = new Uint8Array(bodyLen)
  putU16(body, 0, entries.length)
  let pos = 2
  for (let i = 0; i < entries.length; i++) {
    putU16(body, pos, entries[i][0])
    pos += 2
    body.set(encodedNames[i], pos)
    pos += encodedNames[i].length
    body[pos++] = 0 // NUL terminator
  }

  return buildShortTag(56, body)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('extractGfxBitmaps', () => {
  it('synthetic 1×1 GFX: extracts test_pixel with correct RGBA values', async () => {
    // Build a GFX file with:
    //   - DefineBitsLossless2 for charId=1, ARGB=(0xAA, 0xFF, 0x00, 0x80)
    //   - ExportAssets mapping charId=1 → 'test_pixel'
    //
    // Expected RGBA output: R=0xFF, G=0x00, B=0x80, A=0xAA
    const CHAR_ID = 1
    const A = 0xaa,
      R = 0xff,
      G = 0x00,
      B = 0x80

    const bitmapTag = buildLossless2Tag(CHAR_ID, [A, R, G, B])
    const exportTag = buildExportAssetsTag([[CHAR_ID, 'test_pixel']])

    const gfxFile = buildGfxFile([bitmapTag, exportTag])
    const result = await extractGfxBitmaps(gfxFile)

    expect(result.has('test_pixel')).toBe(true)

    const bm = result.get('test_pixel')!
    expect(bm.name).toBe('test_pixel')
    expect(bm.width).toBe(1)
    expect(bm.height).toBe(1)
    expect(bm.pixels.length).toBe(4) // 1×1×RGBA

    // ARGB [0xAA, 0xFF, 0x00, 0x80] → RGBA [0xFF, 0x00, 0x80, 0xAA]
    expect(bm.pixels[0]).toBe(R) // R
    expect(bm.pixels[1]).toBe(G) // G
    expect(bm.pixels[2]).toBe(B) // B
    expect(bm.pixels[3]).toBe(A) // A
  })

  it('CWS magic: zlib-compressed Flash body (coh2bob.swf format) is inflated and parsed', async () => {
    // CoH2 ships coh2bob.swf and coh2cloud.swf as standard zlib-compressed
    // Flash (CWS magic) — exactly the same tag stream as our GFX synthetic
    // tests, just gzip-deflated past byte 8. This test guarantees the
    // CWS-handling branch in extractGfxBitmaps stays wired up — without it,
    // unit-icon lookups against the user's CoH2 install return null even
    // though the asset is right there in the archive.
    const CHAR_ID = 42
    const A = 0xff,
      R = 0xab,
      G = 0xcd,
      B = 0xef
    const bitmapTag = buildLossless2Tag(CHAR_ID, [A, R, G, B])
    const exportTag = buildExportAssetsTag([[CHAR_ID, 'cws_pixel']])

    // SWF body: RECT (1 byte) + frameRate u16 + frameCount u16 + tags + End.
    const swfFrameHeader = new Uint8Array([0x00, 0x00, 0x0c, 0x01, 0x00])
    const endTag = new Uint8Array([0x00, 0x00])
    const bodyParts = [swfFrameHeader, bitmapTag, exportTag, endTag]
    const bodyLen = bodyParts.reduce((s, p) => s + p.length, 0)
    const body = new Uint8Array(bodyLen)
    let pos = 0
    for (const p of bodyParts) {
      body.set(p, pos)
      pos += p.length
    }

    // Compress the body with zlib, then build the CWS header in front of it.
    const compressed = deflate(body)
    const out = new Uint8Array(8 + compressed.length)
    out[0] = 0x43 // 'C'
    out[1] = 0x57 // 'W'
    out[2] = 0x53 // 'S'
    out[3] = 10 // Flash 10
    putU32(out, 4, 8 + bodyLen) // uncompressed file length (ignored by parser)
    out.set(compressed, 8)

    const result = await extractGfxBitmaps(out)
    expect(result.has('cws_pixel')).toBe(true)
    const bm = result.get('cws_pixel')!
    expect(bm.width).toBe(1)
    expect(bm.height).toBe(1)
    expect(bm.pixels[0]).toBe(R)
    expect(bm.pixels[1]).toBe(G)
    expect(bm.pixels[2]).toBe(B)
    expect(bm.pixels[3]).toBe(A)
  })

  it('tag-length extension: long-form u32 length is parsed, next tag found at correct offset', async () => {
    // Build a GFX file with:
    //   - DefineBitsLossless2 (charId=1) encoded with the LONG header form
    //   - ExportAssets (charId=1 → 'long_pixel') — must be found AFTER the long tag
    //
    // If the long-form length is misread, the parser won't advance offset correctly
    // and will either crash or miss the export tag entirely.
    const CHAR_ID = 1
    const A = 0xff,
      R = 0x10,
      G = 0x20,
      B = 0x30

    const bitmapTag = buildLossless2Tag(CHAR_ID, [A, R, G, B], /* useLongHeader */ true)
    const exportTag = buildExportAssetsTag([[CHAR_ID, 'long_pixel']])

    const gfxFile = buildGfxFile([bitmapTag, exportTag])
    const result = await extractGfxBitmaps(gfxFile)

    // The long-form tag must have been parsed and advanced past correctly so
    // the export tag is then found and the symbol resolved.
    expect(result.has('long_pixel')).toBe(true)

    const bm = result.get('long_pixel')!
    expect(bm.width).toBe(1)
    expect(bm.height).toBe(1)
    // Verify pixel values too — confirms the bitmap tag itself was decoded correctly.
    expect(bm.pixels[0]).toBe(R)
    expect(bm.pixels[1]).toBe(G)
    expect(bm.pixels[2]).toBe(B)
    expect(bm.pixels[3]).toBe(A)
  })
})
