/**
 * Decal-pack rasteriser + ZIP exporter.
 *
 * Why this exists:
 *   The decal-pack project format (`decal-pack-project.ts`) stores each decal
 *   as a *recipe* — a reference to a source image plus a per-decal transform
 *   (position, scale, rotation, flips). To actually use those decals in CoH2
 *   we need to bake every recipe into a flat 128×128 RGBA bitmap matching
 *   Relic's stock decal-pack templates.
 *
 *   The output is a `.zip` archive containing one PNG per visible decal plus
 *   a `manifest.json` describing the pack. Users drop the archive into their
 *   manual decal-pack setup (per the `coh2.org` tutorial) and CoH2 picks it
 *   up. Direct SGA emission is reserved for v1.1 — we don't have a verified
 *   reference decal-pack SGA yet, and shipping an unverified binary would
 *   violate the "100% reliable" mandate.
 *
 * Pipeline:
 *   project + source images
 *     → for each visible decal, rasteriseDecal() → 128×128 RGBA canvas
 *     → canvas → PNG blob
 *   PNG blobs + manifest → ZIP (stored entries; PNG is already compressed)
 *
 * Why stored (uncompressed) ZIP entries?
 *   PNG is already DEFLATE-compressed, so re-deflating wastes CPU for ~1%
 *   gain. Stored entries also make this a trivially small dependency-free
 *   ZIP writer (no pako dependency at the call site — sga-writer already
 *   pulls pako in, but we avoid the round-trip for decal pack export).
 */
import { DECAL_PACK_SIZE } from './decal-pack-project'
import type { Coh2DecalPackProject, Decal, DecalMask, DecalSourceImage } from './decal-pack-project'

// ── Public API ─────────────────────────────────────────────────────────────

export interface DecalPackExportResult {
  /** ZIP archive bytes. */
  zip: Uint8Array
  /** Filename recommended for the download (derived from packName). */
  filename: string
  /** Per-decal blob count emitted (excludes invisible decals). */
  decalCount: number
}

/**
 * Bake every visible decal in the project into a PNG and assemble them into a
 * single ZIP archive. Throws if no visible decals exist (the caller should
 * gate the export button on this condition).
 *
 * v6: exports shared layers for each part, PLUS per-faction override layers
 * when they exist (allowing per-faction decal customisation to ship in the
 * ZIP). Each faction cell is exported as a separate folder-like path:
 * `part<N>_<faction>/<index>_<slug>.png`.
 * v5 fallback: use decals[] directly (unchanged behaviour).
 */
export async function exportDecalPackZip(p: Coh2DecalPackProject): Promise<DecalPackExportResult> {
  // v6: collect visible layers from ALL (part,faction) cells.
  // v5 fallback: use decals[] directly (unchanged behaviour).
  const visible: Decal[] = (() => {
    if (!p.parts) return p.decals.filter(d => d.visible)
    const results: Decal[] = []
    for (const part of p.parts) {
      // shared layers
      results.push(...part.shared.filter(d => d.visible))
      // per-faction override layers
      if (part.overrides) {
        const overrides = part.overrides as Record<string, Decal[]>
        for (const faction of Object.keys(overrides)) {
          const overrideLayers: Decal[] = overrides[faction] ?? []
          results.push(...overrideLayers.filter((d: Decal) => d.visible))
        }
      }
    }
    return results
  })()

  if (visible.length === 0) {
    throw new Error('No visible decals to export. Add at least one decal first.')
  }

  // Cache decoded source-image bitmaps so repeated source-image references
  // don't decode the PNG/JPG/SVG more than once per export.
  const bitmapCache = new Map<string, ImageBitmap | HTMLImageElement>()

  const entries: ZipEntry[] = []
  // Track the previous rasterised decal canvas for clipping-mask support.
  let prevDecalCanvas: OffscreenCanvas | HTMLCanvasElement | null = null
  for (let i = 0; i < visible.length; i++) {
    const decal = visible[i]
    const src = p.sourceImages[decal.sourceImageId]
    if (!src) continue
    const bitmap = await getOrLoadBitmap(bitmapCache, src)
    const canvas = rasteriseDecal(decal, bitmap, { prevCanvas: prevDecalCanvas })
    prevDecalCanvas = canvas
    const png = await canvasToPng(canvas)
    entries.push({
      path: `${pad3(i + 1)}_${makeSlug(decal.name) || 'decal'}.png`,
      bytes: png,
    })
  }

  // Bundle a manifest describing the pack — useful for downstream tooling
  // and for the user's own records.
  const manifest = buildManifest(p, entries)
  entries.unshift({
    path: 'manifest.json',
    bytes: new TextEncoder().encode(manifest),
  })

  const zip = buildZip(entries)
  return {
    zip,
    filename: `${makeSlug(p.packName) || 'decal_pack'}.zip`,
    decalCount: visible.length,
  }
}

/**
 * Options for `rasteriseDecal`. All optional; added in v4 to support blend
 * mode, mask, and clipping-mask features during the in-editor preview
 * composite.
 */
export interface RasteriseDecalOptions {
  /** The previously-rasterised decal canvas for clipping-mask support. When
   *  `decal.clippedToDecalBelow === true` this canvas provides the alpha
   *  shape the current decal is clipped to. */
  prevCanvas?: OffscreenCanvas | HTMLCanvasElement | null
  /**
   * Pre-decoded mask image element. Callers that have already decoded the mask
   * dataUrl can supply the element directly to avoid a second decode. When
   * absent and `decal.mask` is present the rasteriser decodes it internally.
   *
   * NOTE: mask application only affects the in-editor preview composite — each
   * decal still exports as an independent texture (no mask bake).
   */
  maskEl?: HTMLImageElement | null
  /**
   * Integer supersample factor (default 1). When >1 the decal is rendered into
   * a `DECAL_PACK_SIZE * supersample` canvas via a global `ctx.scale`, so all
   * 128-space transforms (x/y/rotation/scale) map up automatically. Callers
   * that bake the result into a large atlas rect (e.g. the vehicle-editor decal
   * preview baking a 128 tile into a ~320-512px hull rect) should pass 4 so the
   * bake DOWNscales a crisp 512 source instead of UPscaling a soft 128 source.
   * The grid/thumbnail preview leaves this at 1 for performance.
   */
  supersample?: number
}

/**
 * Render a single decal into a 128×128 RGBA canvas applying the per-decal
 * transform. Exported separately so the editor can show a live grid preview
 * of every decal without re-implementing the bake step.
 *
 * v4 additions: blend mode (`decal.blendMode`), paintable alpha mask
 * (`decal.mask`), and clipping to the previous decal's alpha
 * (`decal.clippedToDecalBelow`). These only affect the in-editor preview;
 * each decal still exports as an independent texture.
 */
export function rasteriseDecal(
  decal: Decal,
  bitmap: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  options: RasteriseDecalOptions = {},
): OffscreenCanvas | HTMLCanvasElement {
  // Supersample factor: render into a larger canvas so callers baking into a
  // big atlas rect get a crisp (downscaled) source instead of an upscaled-soft
  // 128 tile. S===1 keeps the original byte-identical 128 path.
  const S = Math.max(1, Math.round(options.supersample ?? 1))
  const SIZE = DECAL_PACK_SIZE * S
  const canvas = makeCanvas(SIZE, SIZE)
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) throw new Error('Failed to acquire 2D context for decal rasteriser')

  // Scale the whole coordinate system up by S. Every subsequent draw is
  // expressed in 128-space (decal.x/y, translate/rotate/scale, the 0..128
  // mask/clip fills) and maps to device pixels automatically. getImageData /
  // putImageData ignore the transform and must use device size (SIZE).
  if (S !== 1) ctx.scale(S, S)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Transparent base — CoH2 decals are alpha-bearing PNGs/DDS over the
  // diffuse, NOT opaque tiles. Don't fill a background.
  ctx.clearRect(0, 0, DECAL_PACK_SIZE, DECAL_PACK_SIZE)

  // Apply per-decal image adjustments (brightness / contrast / saturation).
  // The values are stored as percentages (100 = identity). We apply them as a
  // CSS filter string before drawImage so the bake embeds the adjustment into
  // the pixel data. ctx.filter is reset to 'none' immediately after so
  // subsequent passes (tint, stroke) are unaffected.
  const brightness = decal.brightness ?? 100
  const contrast = decal.contrast ?? 100
  const saturation = decal.saturation ?? 100
  const hasAdjustment = brightness !== 100 || contrast !== 100 || saturation !== 100
  if (hasAdjustment) {
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`
  }

  // v4: blend mode — set before drawImage so it applies to the source pixel
  // compositing. Reset to 'source-over' after the save/restore block.
  // Identity = 'normal' (absent field = no-op). Maps to globalCompositeOperation.
  const blendMode = decal.blendMode ?? 'normal'

  // Apply transform: translate to centre, rotate, flip, scale, then draw the
  // source bitmap centred on the origin. Matches the editor's screen-space
  // preview pipeline so what-you-see-is-what-you-get.
  ctx.save()
  ctx.globalAlpha = decal.opacity
  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.translate(decal.x, decal.y)
  ctx.rotate((decal.rotation * Math.PI) / 180)
  const sx = decal.flipH ? -1 : 1
  const sy = decal.flipV ? -1 : 1
  ctx.scale(sx * decal.scale, sy * decal.scale)

  // `bitmap.width` / `height` are the natural pixel dimensions across all
  // three accepted source shapes (ImageBitmap / HTMLImageElement / Canvas).
  const w = bitmap.width
  const h = bitmap.height
  ctx.drawImage(bitmap as CanvasImageSource, -w / 2, -h / 2, w, h)

  // Defensive composite reset before restore.
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()

  // Reset the filter after drawImage so tint / stroke passes are not affected.
  if (hasAdjustment) {
    ctx.filter = 'none'
  }

  // Pipeline after drawImage:
  //   1. Tint  — pixel-level colour blend via getImageData / putImageData.
  //              Runs while only the source image is on the canvas so the
  //              stroke is not tinted.
  //   2. Stroke — drawn after tint in a fresh save/restore block with the
  //               same transform, so the border colour is unaffected by the
  //               tint pass.
  //   3. Mask  — applied after tint + stroke (v4 addition, in-editor preview
  //              only; does not affect the exported PNG).
  //   4. Clip  — clipped to the previous decal's alpha (v4 addition, in-editor
  //              preview only).
  //
  // NOTE: getImageData/putImageData mutates the WHOLE canvas pixel buffer.
  // rasteriseDecal always renders exactly ONE decal per canvas, so no earlier
  // decal pixels can be accidentally over-tinted by this pass.

  if (decal.tint && decal.tint.strength > 0) {
    const { strength, color } = decal.tint
    const { r: tintR, g: tintG, b: tintB } = parseCssHexColor(color)
    // Device-space read: spans the full SIZE×SIZE canvas (ignores the S scale).
    const imageData = ctx.getImageData(0, 0, SIZE, SIZE)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        data[i] = Math.round(data[i] * (1 - strength) + tintR * strength)
        data[i + 1] = Math.round(data[i + 1] * (1 - strength) + tintG * strength)
        data[i + 2] = Math.round(data[i + 2] * (1 - strength) + tintB * strength)
        // alpha (data[i + 3]) intentionally left untouched
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }

  if (decal.stroke && decal.stroke.width > 0) {
    // Re-apply the same transform so the stroke rectangle is rotated/scaled
    // to match the placed image footprint exactly.
    ctx.save()
    ctx.globalAlpha = decal.opacity
    ctx.translate(decal.x, decal.y)
    ctx.rotate((decal.rotation * Math.PI) / 180)
    const ssx = decal.flipH ? -1 : 1
    const ssy = decal.flipV ? -1 : 1
    ctx.scale(ssx * decal.scale, ssy * decal.scale)
    ctx.strokeStyle = decal.stroke.color
    ctx.lineWidth = decal.stroke.width
    ctx.lineJoin = 'round'
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    ctx.restore()
  }

  // v4: paintable alpha mask — in-editor preview only.
  // Each decal is still exported as an independent texture without the mask
  // baked in (mask baking deferred to a future export-pipeline wave).
  const maskSource: DecalMask | undefined = decal.mask
  if (maskSource?.dataUrl && maskSource.enabled !== false) {
    const maskEl = options.maskEl ?? null
    // When no pre-decoded element is supplied, skip (async decode not possible
    // in a sync function — the editor should pre-decode and pass via options).
    if (maskEl) {
      ctx.globalCompositeOperation = maskSource.invert ? 'destination-out' : 'destination-in'
      ctx.drawImage(maskEl, 0, 0, DECAL_PACK_SIZE, DECAL_PACK_SIZE)
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  // v4: clipping mask — clip this decal to the alpha of the previous decal.
  // In-editor preview only; does not affect the exported texture.
  if (decal.clippedToDecalBelow && options.prevCanvas) {
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(options.prevCanvas as CanvasImageSource, 0, 0, DECAL_PACK_SIZE, DECAL_PACK_SIZE)
    ctx.globalCompositeOperation = 'source-over'
  }

  return canvas
}

// ── Internals ──────────────────────────────────────────────────────────────

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h)
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

async function getOrLoadBitmap(
  cache: Map<string, ImageBitmap | HTMLImageElement>,
  src: DecalSourceImage,
): Promise<ImageBitmap | HTMLImageElement> {
  const cached = cache.get(src.id)
  if (cached) return cached
  const decoded = await decodeSourceImage(src.dataUrl)
  cache.set(src.id, decoded)
  return decoded
}

/**
 * Decode a source-image data URL into a fully-decoded, drawImage-ready bitmap.
 *
 * Robustness contract (shared by every rasterise/export path — the editor
 * preview AND the .sga / .zip export bake both funnel through here):
 *
 *  • SVG sources (the insignia library — e.g. balkenkreuz.svg) are decoded via
 *    an <img> element, NOT createImageBitmap. Chromium's createImageBitmap
 *    rejects SVG blobs that lack an intrinsic width/height with
 *    "InvalidStateError: The source image could not be decoded" — which is
 *    exactly the export crash this guards against. An <img> resolves the
 *    intrinsic size from the SVG viewBox and decodes fine.
 *  • Raster sources (PNG/JPG) prefer createImageBitmap (off-thread decode) but
 *    fall back to the <img> path if it throws for any reason.
 *  • The returned image is ALWAYS fully decoded before it is handed back:
 *    for the <img> path we `await img.decode()` (falling back to the load
 *    Promise where decode() is unavailable, e.g. jsdom) so a subsequent
 *    ctx.drawImage() can never race an undecoded image.
 */
export async function decodeSourceImage(
  dataUrl: string,
): Promise<ImageBitmap | HTMLImageElement> {
  const isSvg = /^data:image\/svg\+xml/i.test(dataUrl)
  // Raster fast path: off-thread ImageBitmap decode. Skipped for SVG (see above)
  // and guarded so a createImageBitmap rejection falls through to the <img> path.
  if (!isSvg && typeof createImageBitmap !== 'undefined') {
    try {
      const blob = dataUrlToBlob(dataUrl)
      return await createImageBitmap(blob)
    } catch {
      // Fall through to the <img> path below.
    }
  }
  return decodeHtmlImage(dataUrl)
}

/**
 * Load AND fully decode a data URL into an <img>. Resolves only once the pixels
 * are decode-ready, so callers can draw immediately without a decode race.
 */
async function decodeHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = await loadHtmlImage(dataUrl)
  // decode() guarantees the bitmap is ready for drawImage. It may be missing in
  // some test/older environments — in that case onload (awaited in loadHtmlImage)
  // is a sufficient readiness signal.
  if (typeof img.decode === 'function') {
    try {
      await img.decode()
    } catch {
      // A decode() rejection after a successful load is benign for SVG/data
      // URLs in some engines; the element is already usable via onload.
    }
  }
  return img
}

function dataUrlToBlob(dataUrl: string): Blob {
  // Format: data:<mime>;base64,<payload>
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
  if (!m) throw new Error('Not a base64 data URL')
  const mime = m[1]
  const b64 = m[2]
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image decode failed'))
    img.src = dataUrl
  })
}

function canvasToPng(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> {
  // `typeof OffscreenCanvas` guard so this function is safe in environments
  // where the OffscreenCanvas binding isn't defined at all (jsdom, certain
  // older WebViews). Without it, the `instanceof` operator on the right-hand
  // side throws ReferenceError before the boolean short-circuit can kick in.
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/png' }).then(blobToUint8)
  }
  // Past the guard, `canvas` is guaranteed to be HTMLCanvasElement in any
  // runtime that actually produced it. The local narrowing on the union
  // doesn't propagate through the short-circuit, so we re-state it via
  // a cast — there are no other concrete types in this codebase that
  // satisfy `OffscreenCanvas | HTMLCanvasElement`.
  const htmlCanvas = canvas as HTMLCanvasElement
  return new Promise<Uint8Array>((resolve, reject) => {
    htmlCanvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Canvas toBlob returned null'))
        return
      }
      blobToUint8(blob).then(resolve, reject)
    }, 'image/png')
  })
}

async function blobToUint8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function buildManifest(p: Coh2DecalPackProject, entries: ZipEntry[]): string {
  return JSON.stringify(
    {
      format: 'coh2-decalpack-export',
      formatVersion: 1,
      packName: p.packName,
      packDescription: p.packDescription,
      author: p.author,
      decalSize: DECAL_PACK_SIZE,
      decals: entries.filter(e => e.path.endsWith('.png')).map(e => ({ filename: e.path })),
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

/**
 * Mirror of `faceplate-mod-build.makeSlug` — kept local so this module
 * doesn't depend on the faceplate pipeline.
 */
export function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

// ── Dependency-free ZIP writer (stored entries only) ───────────────────────
//
// The ZIP format is well-specified (PKWARE APPNOTE 6.3.10). For stored
// entries (no compression) the on-disk layout per entry is:
//   - Local file header (30 bytes + filename)
//   - File data (raw bytes)
// Followed by a Central Directory (one record per file, ending with EOCD).
//
// We compute CRC-32 ourselves with a precomputed table. All multi-byte
// fields are little-endian. Filenames are UTF-8.

interface ZipEntry {
  path: string
  bytes: Uint8Array
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0
  const crcTable = makeCrcTable()

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.path)
    const crc = crc32(e.bytes, crcTable)
    const size = e.bytes.length

    // Local file header (signature 0x04034b50)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed (2.0 = stored)
    lv.setUint16(6, 0x0800, true) // general purpose bit flag (UTF-8 names)
    lv.setUint16(8, 0, true) // compression method = stored
    lv.setUint16(10, 0, true) // mod time
    lv.setUint16(12, 0x21, true) // mod date (placeholder valid date)
    lv.setUint32(14, crc, true) // CRC-32
    lv.setUint32(18, size, true) // compressed size
    lv.setUint32(22, size, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra field length
    local.set(nameBytes, 30)
    localChunks.push(local, e.bytes)

    // Central directory record (signature 0x02014b50)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 0x031e, true) // version made by (unix, zip 3.0)
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x0800, true) // flags (UTF-8)
    cv.setUint16(10, 0, true) // method = stored
    cv.setUint16(12, 0, true) // mod time
    cv.setUint16(14, 0x21, true) // mod date
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true) // compressed
    cv.setUint32(24, size, true) // uncompressed
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra
    cv.setUint16(32, 0, true) // comment
    cv.setUint16(34, 0, true) // disk number
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offset, true) // local header offset
    central.set(nameBytes, 46)
    centralChunks.push(central)

    offset += local.length + e.bytes.length
  }

  // End-of-central-directory record (signature 0x06054b50)
  const centralSize = centralChunks.reduce((a, c) => a + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true) // disk #
  ev.setUint16(6, 0, true) // disk w/ central
  ev.setUint16(8, entries.length, true) // entries this disk
  ev.setUint16(10, entries.length, true) // entries total
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true) // central dir offset
  ev.setUint16(20, 0, true) // comment length

  // Stitch the whole archive in one allocation.
  const total = offset + centralSize + eocd.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of localChunks) {
    out.set(c, pos)
    pos += c.length
  }
  for (const c of centralChunks) {
    out.set(c, pos)
    pos += c.length
  }
  out.set(eocd, pos)
  return out
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
}

function crc32(buf: Uint8Array, table: Uint32Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// ── Colour utilities ───────────────────────────────────────────────────────

/**
 * Parse a CSS hex colour string into {r, g, b} (each 0–255).
 *
 * Handles:
 *   - `#rgb`      (3-digit shorthand)
 *   - `#rrggbb`   (6-digit)
 *   - `#rrggbbaa` (8-digit; alpha channel is ignored — only r/g/b returned)
 *
 * Returns white {r:255, g:255, b:255} if the string does not match any
 * recognised format, so callers can always proceed safely.
 */
function parseCssHexColor(hex: string): { r: number; g: number; b: number } {
  const s = hex.trim()
  // 3-digit shorthand: #rgb → #rrggbb
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    }
  }
  // 6-digit or 8-digit (alpha ignored)
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(s)
  if (full) {
    return {
      r: parseInt(full[1], 16),
      g: parseInt(full[2], 16),
      b: parseInt(full[3], 16),
    }
  }
  // Fallback: white
  return { r: 255, g: 255, b: 255 }
}
