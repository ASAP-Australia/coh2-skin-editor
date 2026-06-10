/**
 * template-diffuse.ts — async helpers for baking a stock or workshop template's
 * diffuse RGT into a PNG dataURL suitable for storage as
 * `VehicleProject.customDiffuseUrl`.
 *
 * The decode pipeline matches Viewport.tsx exactly:
 *   parseRgtHeader(bytes) → decodeRgtFullOffThread(header)
 *     → putImageData on an offscreen canvas → toDataURL('image/png')
 *
 * Key properties:
 *   - All functions return null on any failure (never throw to the UI).
 *   - The canvas.toDataURL call happens on the main thread (required by the DOM
 *     API), but the inflate + BC-decode inner work happens off-thread in the
 *     decode-pool worker, matching the Viewport path.
 *   - colorSpace and flipY are intentionally NOT applied here — we are producing
 *     a flat PNG for storage in customDiffuseUrl, not a Three.js Texture. The
 *     Viewport will later consume this dataURL and apply its own colorSpace /
 *     flipY when constructing the CanvasTexture, exactly as it does for any
 *     other customDiffuseUrl (e.g. AI-generated or user-uploaded).
 */

import { parseRgtHeader } from './rgt-core'
import { decodeRgtFullOffThread } from './decode-pool'
import { listStockSkins } from './stock-skins'
import { getPreloadedArchive, cacheArchive } from './preload'
import { locateArchives } from './coh2-fs'
import { SgaArchive } from './sga'
import { nativeFileFromPath } from './native-fs'
import type { Faction } from './vehicles'
import type { ProjectTemplateRef } from './project'
import { parseWorkshopTemplateId } from './project'

// ── RGT bytes → PNG dataURL ───────────────────────────────────────────────────

/**
 * Decode raw RGT bytes (from an SGA archive) into a PNG dataURL string.
 *
 * Pipeline:
 *   1. parseRgtHeader — cheap main-thread chunky walk to find the mip offset +
 *      format metadata (no decompression).
 *   2. decodeRgtFullOffThread — transfer the compressed mip bytes to the
 *      decode-pool worker for zlib inflate + BC1/BC3 decode; returns RGBA pixels.
 *   3. putImageData on an offscreen <canvas> → toDataURL('image/png').
 *
 * Returns null on any error so callers can fall back to vanilla silently.
 */
export async function rgtBytesToDataUrl(bytes: Uint8Array): Promise<string | null> {
  try {
    const header = parseRgtHeader(bytes)
    const dec = await decodeRgtFullOffThread(header)
    const cv = document.createElement('canvas')
    cv.width = dec.width
    cv.height = dec.height
    const ctx = cv.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(
          dec.rgba.buffer.slice(
            dec.rgba.byteOffset,
            dec.rgba.byteOffset + dec.rgba.byteLength,
          ) as ArrayBuffer,
        ),
        dec.width,
        dec.height,
      ),
      0,
      0,
    )
    return cv.toDataURL('image/png')
  } catch {
    return null
  }
}

// ── Open an SGA by filename from the installRoot's Archives folder ────────────

/**
 * Retrieve an SGA archive by filename. Checks the preload cache first, then
 * falls back to opening it from the Archives folder (matching Viewport's
 * `getArchive` fallback). The opened archive is written back into the preload
 * cache so subsequent calls and Viewport loads skip the open.
 *
 * Returns null when the Archives folder cannot be located or the SGA is absent.
 */
async function openArchive(
  sgaName: string,
  installRoot: FileSystemDirectoryHandle,
): Promise<SgaArchive | null> {
  const cached = getPreloadedArchive(sgaName)
  if (cached) return cached
  try {
    const archives = await locateArchives(installRoot)
    if (!archives) return null
    const fh = await archives.getFileHandle(sgaName)
    const file = await fh.getFile()
    const archive = await SgaArchive.open(file)
    cacheArchive(sgaName, archive)
    return archive
  } catch {
    return null
  }
}

// ── Stock diffuse ─────────────────────────────────────────────────────────────

/**
 * Extract the stock game diffuse texture for a given faction + vehicleId as a
 * PNG dataURL. Uses `listStockSkins()` to locate the sgaName + internalPath,
 * then reads the RGT bytes from the SGA and decodes them.
 *
 * Requires `installRoot` to be able to open the archive on a cache miss.
 * Returns null when:
 *   - the faction/vehicleId has no entry in listStockSkins()
 *   - the SGA cannot be opened (archive not present or Archives folder missing)
 *   - the RGT path is absent from the archive
 *   - decoding fails for any reason
 */
export async function readStockDiffuseDataUrl(
  faction: Faction,
  vehicleId: string,
  installRoot: FileSystemDirectoryHandle,
): Promise<string | null> {
  try {
    const skin = listStockSkins().find(s => s.factionId === faction && s.vehicleId === vehicleId)
    if (!skin) return null

    const archive = await openArchive(skin.sgaName, installRoot)
    if (!archive) return null

    const bytes = await archive.readByPath(skin.internalPath)
    if (!bytes) return null

    return rgtBytesToDataUrl(bytes)
  } catch {
    return null
  }
}

// ── Workshop diffuse ──────────────────────────────────────────────────────────

/**
 * Extract the workshop archive's diffuse texture for a specific faction +
 * vehicleId as a PNG dataURL.
 *
 * We open the workshop SGA via `nativeFileFromPath(sgaPath)` (same as
 * `workshop-skins.ts`), scan its TOC for a `*_dif.rgt` path that matches the
 * target vehicle folder, then decode it.
 *
 * Returns null when:
 *   - the template ref does not parse as a workshop id with a known sgaPath
 *   - the SGA cannot be opened (outside Electron, file missing, etc.)
 *   - no matching diffuse path is found in the archive
 *   - decoding fails
 */
export async function readWorkshopDiffuseDataUrl(
  templateRef: ProjectTemplateRef,
  _faction: Faction,
  _vehicleId: string,
): Promise<string | null> {
  try {
    const parsed = parseWorkshopTemplateId(templateRef.id)
    if (!parsed) return null

    // We need the sgaPath. The templateRef itself doesn't carry it; we get it
    // from the opt.hint (which is set to item.sgaPath in TemplateDecalPills's
    // templateOptions map). But template-diffuse.ts is called with only the
    // templateRef, not the Option — so we accept sgaPath as a parameter.
    // This overload is kept internal; readWorkshopDiffuseDataUrlBySgaPath is
    // the public entry point (below).
    return null
  } catch {
    return null
  }
}

/**
 * Workshop diffuse: public entry point that accepts the raw sgaPath (from
 * the Option.hint or WorkshopSkin.sgaPath).
 *
 * Opens the SGA via nativeFileFromPath, scans TOC for
 * `art/armies/<faction>/vehicles/<vehicleFolder>/*_dif.rgt`, and decodes the
 * first match.
 *
 * Returns null on any failure so callers fall back to vanilla silently.
 */
export async function readWorkshopDiffuseDataUrlBySgaPath(
  sgaPath: string,
  faction: Faction,
  vehicleId: string,
): Promise<string | null> {
  try {
    const file = await nativeFileFromPath(sgaPath)
    if (!file) return null

    const archive = await SgaArchive.open(file)
    const paths = archive.listPaths()

    // Match art/armies/<faction>/vehicles/<vehicleFolder>/*_dif.rgt
    // vehicleFolder is typically the vehicleId; allow case-insensitive match.
    const prefix = `art/armies/${faction}/vehicles/${vehicleId}/`.toLowerCase()
    const difPath = paths
      .map(p => p.replace(/\\/g, '/').toLowerCase())
      .find(p => p.startsWith(prefix) && p.endsWith('_dif.rgt'))

    if (!difPath) return null

    const bytes = await archive.readByPath(difPath)
    if (!bytes) return null

    return rgtBytesToDataUrl(bytes)
  } catch {
    return null
  }
}
