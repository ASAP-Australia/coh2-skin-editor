/**
 * Scaleform GFX/CFX bitmap extractor.
 *
 * CoH2's coh2ui.gfx is a Scaleform SWF-derivative that embeds every UI icon
 * (unit portraits, faction symbols, etc.) as named DefineBitsLossless2 symbols.
 * This module decodes that format so other tools can look up icons by symbol name
 * without relying on any game-side rendering path.
 *
 * Supports:
 *   GFX  — uncompressed body (CoH2 format, used by coh2ui.gfx)
 *   FWS  — uncompressed standard Flash body
 *   CFX  — zlib-compressed Scaleform body (pako inflate, then parse same as GFX)
 *   CWS  — zlib-compressed standard Flash body (used by coh2bob.swf, coh2cloud.swf)
 *   GFL  — LZMA-compressed body (logged + skipped, no LZMA in browser)
 *
 * Tag subset implemented (the minimum for CoH2 portraits):
 *   Tag 20 DefineBitsLossless   — palette(RGB) / BGR15 / XRGB32, zlib body
 *   Tag 36 DefineBitsLossless2  — palette(ARGB) / ARGB32, zlib body
 *   Tag 56 ExportAssets         — legacy name → characterId table
 *   Tag 76 SymbolClass          — AS3 name → characterId table (fallback)
 */

import { inflate } from 'pako'

// ─── Public types ────────────────────────────────────────────────────────────

export interface GfxBitmap {
  /** Original symbol name from ExportAssets / SymbolClass. */
  name: string
  /** Width in pixels. */
  width: number
  /** Height in pixels. */
  height: number
  /**
   * Raw RGBA pixels, row-major, top-left origin.
   * Values are NOT premultiplied — straight alpha.
   */
  pixels: Uint8ClampedArray
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface RawBitmap {
  characterId: number
  width: number
  height: number
  pixels: Uint8ClampedArray
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * Extract every named bitmap from a Scaleform GFX/CFX file.
 *
 * The GFX format is essentially SWF (Flash) with a 'GFX'/'CFX' magic and an
 * extra 4-byte Scaleform version word prepended to the normal SWF frame header.
 * Tag parsing, RECT, and bitmap decoding all follow the SWF spec exactly.
 *
 * Returns a Map keyed by symbol name → GfxBitmap. Only symbols whose
 * characterId resolves to a decoded DefineBitsLossless/2 are included.
 */
export async function extractGfxBitmaps(buf: Uint8Array): Promise<Map<string, GfxBitmap>> {
  const magic = String.fromCharCode(buf[0], buf[1], buf[2])

  if (magic === 'GFL') {
    console.warn('[gfx-bitmaps] GFL (LZMA) not supported — skipping')
    return new Map()
  }

  // version byte is at [3]; file length u32LE at [4..7]
  let body: Uint8Array

  if (magic === 'CFX' || magic === 'CWS') {
    // Body starts at byte 8 (after magic + version + length u32). Both
    // Scaleform CFX and standard Flash CWS use raw zlib past that point.
    body = inflate(buf.subarray(8))
  } else if (magic === 'GFX' || magic === 'FWS') {
    body = buf.subarray(8)
  } else {
    throw new Error(`[gfx-bitmaps] Unknown magic '${magic}' — not a GFX/SWF file`)
  }

  // ── Parse SWF frame header ────────────────────────────────────────────────
  // RECT: 5-bit Nbits, then 4 × Nbits signed values (in twips), bit-packed.
  const rectBits = (body[0] >> 3) & 0x1f
  // Total bits for RECT = 5 + 4*Nbits; round up to byte boundary.
  const rectBytes = Math.ceil((5 + 4 * rectBits) / 8)
  // After RECT: u16 frameRate (8.8 fixed), u16 frameCount.
  const tagStreamOffset = rectBytes + 4 // skip RECT + frameRate + frameCount

  // ── Walk tag stream ───────────────────────────────────────────────────────
  const bitmaps = new Map<number, RawBitmap>() // characterId → RawBitmap
  const exports = new Map<number, string>() // characterId → name

  let offset = tagStreamOffset
  while (offset < body.length - 1) {
    const recordHeader = readU16(body, offset)
    offset += 2
    const tagCode = recordHeader >> 6
    let tagLen = recordHeader & 0x3f

    if (tagLen === 0x3f) {
      // Long-form: next 4 bytes hold the actual length.
      tagLen = readU32(body, offset)
      offset += 4
    }

    if (tagCode === 0) break // End tag

    const tagEnd = offset + tagLen

    switch (tagCode) {
      case 20: // DefineBitsLossless
        parseLossless(body, offset, tagLen, false, bitmaps)
        break
      case 36: // DefineBitsLossless2
        parseLossless(body, offset, tagLen, true, bitmaps)
        break
      case 56: // ExportAssets
      case 76: // SymbolClass (same shape)
        parseExports(body, offset, tagLen, exports)
        break
      default:
        // Unknown tags are silently skipped per the SWF spec.
        break
    }

    offset = tagEnd
  }

  // ── Join bitmaps with their names ─────────────────────────────────────────
  const result = new Map<string, GfxBitmap>()
  for (const [charId, name] of exports) {
    const bm = bitmaps.get(charId)
    if (bm) {
      result.set(name, { name, width: bm.width, height: bm.height, pixels: bm.pixels })
    }
  }
  return result
}

// ─── Tag parsers ──────────────────────────────────────────────────────────────

/**
 * Parse DefineBitsLossless (tag 20) or DefineBitsLossless2 (tag 36).
 *
 * hasAlpha=false (tag 20): palette entries are RGB (3 bytes), format 5 is XRGB.
 * hasAlpha=true  (tag 36): palette entries are ARGB (4 bytes), format 5 is ARGB.
 *
 * Both write RGBA output (canvas-friendly straight alpha).
 */
function parseLossless(
  body: Uint8Array,
  offset: number,
  tagLen: number,
  hasAlpha: boolean,
  out: Map<number, RawBitmap>,
): void {
  if (tagLen < 7) return // minimum: u16 id + u8 fmt + u16 w + u16 h = 7 bytes

  const charId = readU16(body, offset)
  const fmt = body[offset + 2]
  const width = readU16(body, offset + 3)
  const height = readU16(body, offset + 5)

  // The compressed data starts after the fixed header (7 bytes), possibly
  // preceded by a colorTableSize byte when fmt === 3.
  let compOffset = offset + 7
  let colorTableSize = 0

  if (fmt === 3) {
    colorTableSize = body[compOffset] + 1 // spec: actual size = stored byte + 1
    compOffset += 1
  }

  const compLen = offset + tagLen - compOffset
  if (compLen <= 0) return

  let pixels: Uint8ClampedArray

  try {
    const raw = inflate(body.subarray(compOffset, compOffset + compLen))

    if (fmt === 3) {
      // 8-bit palette mode.
      // Layout after decompression:
      //   palette: colorTableSize entries × (3 bytes RGB [tag20] or 4 bytes ARGB [tag36])
      //   pixels:  width*height indices, each row padded to 4-byte alignment
      const entrySize = hasAlpha ? 4 : 3
      const palBase = 0
      const rowStride = Math.ceil(width / 4) * 4
      const idxBase = palBase + colorTableSize * entrySize
      pixels = new Uint8ClampedArray(width * height * 4)

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = raw[idxBase + y * rowStride + x]
          const pe = palBase + idx * entrySize
          const dst = (y * width + x) * 4
          if (hasAlpha) {
            // ARGB palette entry
            pixels[dst] = raw[pe + 1] // R
            pixels[dst + 1] = raw[pe + 2] // G
            pixels[dst + 2] = raw[pe + 3] // B
            pixels[dst + 3] = raw[pe + 0] // A
          } else {
            // RGB palette entry, fully opaque
            pixels[dst] = raw[pe + 0] // R
            pixels[dst + 1] = raw[pe + 1] // G
            pixels[dst + 2] = raw[pe + 2] // B
            pixels[dst + 3] = 255
          }
        }
      }
    } else if (fmt === 4) {
      // BGR15 (tag 20 only): 16-bit per pixel, 0RRRRRGG GGGBBBBB (big-endian short).
      pixels = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        const word = (raw[i * 2] << 8) | raw[i * 2 + 1]
        const dst = i * 4
        pixels[dst] = ((word >> 10) & 0x1f) << 3
        pixels[dst + 1] = ((word >> 5) & 0x1f) << 3
        pixels[dst + 2] = (word & 0x1f) << 3
        pixels[dst + 3] = 255
      }
    } else if (fmt === 5) {
      // 32-bit per pixel.
      // tag 20: XRGB (ignore X byte, treat as opaque)
      // tag 36: ARGB with straight alpha
      pixels = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        const src = i * 4
        const dst = i * 4
        if (hasAlpha) {
          // ARGB → RGBA
          pixels[dst] = raw[src + 1] // R
          pixels[dst + 1] = raw[src + 2] // G
          pixels[dst + 2] = raw[src + 3] // B
          pixels[dst + 3] = raw[src + 0] // A
        } else {
          // XRGB → RGBA (opaque)
          pixels[dst] = raw[src + 1] // R
          pixels[dst + 1] = raw[src + 2] // G
          pixels[dst + 2] = raw[src + 3] // B
          pixels[dst + 3] = 255
        }
      }
    } else {
      console.warn(`[gfx-bitmaps] Unknown bitmap format ${fmt} for char ${charId} — skipping`)
      return
    }
  } catch (e) {
    console.warn(`[gfx-bitmaps] zlib inflate failed for char ${charId}:`, e)
    return
  }

  out.set(charId, { characterId: charId, width, height, pixels })
}

/**
 * Parse ExportAssets (tag 56) or SymbolClass (tag 76).
 *
 * Both share the same wire format:
 *   u16 count
 *   count × { u16 tagId, NUL-terminated UTF-8 string }
 */
function parseExports(
  body: Uint8Array,
  offset: number,
  tagLen: number,
  out: Map<number, string>,
): void {
  const end = offset + tagLen
  if (end - offset < 2) return
  const count = readU16(body, offset)
  offset += 2

  for (let i = 0; i < count; i++) {
    if (offset + 2 >= end) break
    const charId = readU16(body, offset)
    offset += 2

    // Read NUL-terminated UTF-8 name.
    let nameEnd = offset
    while (nameEnd < end && body[nameEnd] !== 0) nameEnd++
    const name = decodeUtf8(body, offset, nameEnd)
    offset = nameEnd + 1 // skip NUL

    // Earlier export wins (ExportAssets is tag 56, SymbolClass is 76; we
    // call this for both, so we'd see ExportAssets first if it appears first).
    if (!out.has(charId)) {
      out.set(charId, name)
    }
  }
}

// ─── Canvas helper ────────────────────────────────────────────────────────────

/**
 * Convert a GfxBitmap to a `data:image/png;base64,…` URL.
 *
 * Uses OffscreenCanvas when running in a browser, or the `canvas` npm package
 * when running under Node. The import is deferred so this file stays compatible
 * with both environments at module load time.
 */
export async function bitmapToDataUrl(bm: GfxBitmap): Promise<string> {
  const { width, height, pixels } = bm

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let canvas: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height)
    ctx = canvas.getContext('2d')
    // TS in lib.dom is strict about ArrayBuffer vs SharedArrayBuffer for the
    // ImageData constructor — Uint8ClampedArray is always a plain ArrayBuffer
    // here (we allocated it in this module), so the cast is sound.
    const imgData = new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height)
    ctx.putImageData(imgData, 0, 0)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } else {
    // Node path — dynamic import to avoid bundling in browser builds.
    const canvasModule = await import('canvas')
    canvas = canvasModule.createCanvas(width, height)
    ctx = canvas.getContext('2d')
    const imgData = new canvasModule.ImageData(pixels, width, height)
    ctx.putImageData(imgData, 0, 0)
    return canvas.toDataURL('image/png')
  }
}

// ─── Byte-reading helpers ─────────────────────────────────────────────────────

function readU16(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8)
}

function readU32(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0
  )
}

function decodeUtf8(buf: Uint8Array, start: number, end: number): string {
  return new TextDecoder().decode(buf.subarray(start, end))
}
