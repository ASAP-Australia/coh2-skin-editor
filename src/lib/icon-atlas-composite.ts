/**
 * Composite user-supplied slot icons into the skin-pack `_i1.dds` atlas.
 *
 * The atlas is 1008×384, DXT5 (BC3). It contains 6 slots, each mapped to:
 *   - a "portrait" rect  (250×190, non-square)
 *   - a "standard" rect  (64×64)
 *
 * Exact rects per slot (from .llm/six-icon-editor/atlas-layout.md):
 *
 * Slot 0 — summer/light   portrait: x=504 y=0   w=250 h=190   standard: x=504 y=192 w=64 h=64
 * Slot 1 — summer/medium  portrait: x=252 y=192 w=250 h=190   standard: x=702 y=192 w=64 h=64
 * Slot 2 — summer/heavy   portrait: x=0   y=0   w=250 h=190   standard: x=636 y=192 w=64 h=64
 * Slot 3 — winter/light   portrait: x=252 y=0   w=250 h=190   standard: x=834 y=192 w=64 h=64
 * Slot 4 — winter/medium  portrait: x=0   y=192 w=250 h=190   standard: x=570 y=192 w=64 h=64
 * Slot 5 — winter/heavy   portrait: x=756 y=0   w=250 h=190   standard: x=768 y=192 w=64 h=64
 */

import { decodeBc3 } from './bc-decode'
import { encodeBc3 } from './bc-encode'
import { wrapBc3InDds } from './faceplate-mod-build'
import type { ExportSlot } from './project'

export const ATLAS_W = 1008
export const ATLAS_H = 384

/** (x, y, w, h) for portrait and standard rects per slot index.
 *  Exported with the _FOR_TEST suffix so unit tests can verify the rect table
 *  without running the full canvas pipeline. */
export const SLOT_RECTS_FOR_TEST: Array<{
  portrait: [number, number, number, number]
  standard: [number, number, number, number]
}> = [
  // Slot 0 — summer / light
  { portrait: [504, 0,   250, 190], standard: [504, 192, 64, 64] },
  // Slot 1 — summer / medium
  { portrait: [252, 192, 250, 190], standard: [702, 192, 64, 64] },
  // Slot 2 — summer / heavy
  { portrait: [0,   0,   250, 190], standard: [636, 192, 64, 64] },
  // Slot 3 — winter / light
  { portrait: [252, 0,   250, 190], standard: [834, 192, 64, 64] },
  // Slot 4 — winter / medium
  { portrait: [0,   192, 250, 190], standard: [570, 192, 64, 64] },
  // Slot 5 — winter / heavy
  { portrait: [756, 0,   250, 190], standard: [768, 192, 64, 64] },
]

/** Map (season, slotIdx) to the atlas slot index 0–5. */
function exportSlotToAtlasIndex(slot: ExportSlot): number {
  if (slot.season === 'summer') return slot.slotIdx        // 0,1,2
  return 3 + slot.slotIdx                                  // 3,4,5
}

/**
 * Load an image from a data URL into an OffscreenCanvas, cropped/scaled to
 * fit a target rect using "cover" strategy (fill rect, center-crop overflow).
 * Cover is chosen to avoid letterbox bars on the non-square portrait rects.
 */
async function drawCover(
  ctx: CanvasRenderingContext2D,
  dataUrl: string,
  dx: number, dy: number, dw: number, dh: number,
): Promise<void> {
  const img = await loadImage(dataUrl)
  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  const scale = Math.max(dw / srcW, dh / srcH)
  const scaledW = srcW * scale
  const scaledH = srcH * scale
  const sx = (scaledW - dw) / 2
  const sy = (scaledH - dh) / 2
  ctx.drawImage(img, -sx + dx, -sy + dy, scaledW, scaledH)
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = e => reject(new Error(`icon-atlas-composite: failed to load slotIcon — ${String(e)}`))
    el.src = dataUrl
  })
  // Await decode() so the image is drawImage-ready (avoids the export-time
  // "InvalidStateError: The source image could not be decoded" race).
  if (typeof img.decode === 'function') {
    try {
      await img.decode()
    } catch {
      /* already loaded via onload — benign */
    }
  }
  return img
}

/**
 * Decode the 128-byte DDS header + BC3 payload into a flat RGBA buffer.
 * Returns null if the header looks wrong (safe fallback caller).
 */
function ddsToRgba(ddsBytes: Uint8Array): Uint8ClampedArray | null {
  if (ddsBytes.length < 128) return null
  // FourCC at offset 84
  const fourCC = String.fromCharCode(ddsBytes[84], ddsBytes[85], ddsBytes[86], ddsBytes[87])
  if (fourCC !== 'DXT5') return null
  const payload = ddsBytes.slice(128)
  return decodeBc3(payload, ATLAS_W, ATLAS_H)
}

/**
 * Pure async helper: decode the template DDS bytes, overlay slot icons where
 * present, BC3-encode and re-wrap as DDS.
 *
 * Exposed as a named export so it can be unit-tested independently.
 *
 * @param templateDdsBytes  - raw bytes of the template `_i1.dds`
 * @param exportSlots       - the project's 6 ExportSlot entries (may have slotIcon)
 * @returns                 - new DDS bytes (1008×384 DXT5), same length as re-encoded
 */
export async function compositeIconAtlas(
  templateDdsBytes: Uint8Array,
  exportSlots: ExportSlot[],
): Promise<Uint8Array> {
  // 1. Decode template into RGBA base.
  const baseRgba = ddsToRgba(templateDdsBytes)
  if (!baseRgba) throw new Error('icon-atlas-composite: template DDS is not a 1008×384 DXT5')

  // 2. Paint base onto a canvas. Use HTMLCanvasElement (available in both the
  //    browser renderer and the jsdom test environment) rather than
  //    OffscreenCanvas (not available in jsdom).
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_W
  canvas.height = ATLAS_H
  const ctx = canvas.getContext('2d')!
  const imgData = new ImageData(
    new Uint8ClampedArray(baseRgba.buffer.slice(baseRgba.byteOffset, baseRgba.byteOffset + baseRgba.byteLength) as ArrayBuffer),
    ATLAS_W, ATLAS_H,
  )
  ctx.putImageData(imgData, 0, 0)

  // 3. Draw portrait panels first (so standard icons can be drawn on top;
  //    portrait panels for slots 1 and 4 overlap the y=192..256 standard-icon band).
  for (const slot of exportSlots) {
    if (!slot.slotIcon) continue
    const idx = exportSlotToAtlasIndex(slot)
    const [px, py, pw, ph] = SLOT_RECTS_FOR_TEST[idx].portrait
    await drawCover(ctx, slot.slotIcon, px, py, pw, ph)
  }

  // 4. Draw standard icons on top (64×64, clean downscale — also uses cover
  //    but src is square 256×256 so cover ≡ uniform scale).
  for (const slot of exportSlots) {
    if (!slot.slotIcon) continue
    const idx = exportSlotToAtlasIndex(slot)
    const [sx, sy, sw, sh] = SLOT_RECTS_FOR_TEST[idx].standard
    await drawCover(ctx, slot.slotIcon, sx, sy, sw, sh)
  }

  // 5. Read back RGBA, BC3-encode, wrap as DDS.
  const out = ctx.getImageData(0, 0, ATLAS_W, ATLAS_H)
  const bc3 = encodeBc3(out.data, ATLAS_W, ATLAS_H)
  return wrapBc3InDds(bc3, ATLAS_W, ATLAS_H)
}
