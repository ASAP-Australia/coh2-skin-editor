/**
 * Decal-pack mod builder — assembles a fully-loadable CoH2 decal-pack SGA from
 * a `Coh2DecalPackProject` + a pre-rendered inventory icon canvas.
 *
 * The output is a single Uint8Array containing a CoH2-compatible SGA v7
 * archive with the same 15-file layout as a published workshop decal pack
 * (verified byte-for-byte against the "Wikinger Decal Remover" pack — see
 * `decal-mod-templates.ts` for provenance):
 *
 *   attrib/vehicle_decal/<slug>_aef.rgd            (5 per-faction RGDs, template-substituted)
 *   attrib/vehicle_decal/<slug>_british.rgd
 *   attrib/vehicle_decal/<slug>_german.rgd
 *   attrib/vehicle_decal/<slug>_soviet.rgd
 *   attrib/vehicle_decal/<slug>_west_german.rgd
 *   english/english.ucs                            (UTF-16-LE, generated)
 *   <guid>.info                                    (ASCII CRLF, generated)
 *   <slug>.dds                                     (BC3, the inventory-icon texture)
 *   art/armies/aef/badges/<guid>/default_dif.rgt   (5 per-faction RGTs, fresh-generated)
 *   art/armies/british/badges/<guid>/default_dif.rgt
 *   art/armies/german/badges/<guid>/default_dif.rgt
 *   art/armies/soviet/badges/<guid>/default_dif.rgt
 *   art/armies/west_german/badges/<guid>/default_dif.rgt
 *   ui/assets/textures/<guid>_i1.dds               (BC3, inventory thumbnail)
 *   ui/bin/<guid>.gfx                              (template-substituted)
 *
 * The orchestrator does no DOM work. It accepts pre-rendered canvases — the
 * caller (DecalPackEditor or the LiveSync pipeline) is responsible for
 * compositing decals into them. Splitting render vs. build keeps the build
 * pipeline testable in a non-DOM environment.
 */

import { encodeBc3 } from '@/lib/bc-encode'
import { buildSga } from '@/lib/sga-writer'
import { SgaArchive } from '@/lib/sga'
import { canvasToRgt } from '@/lib/rgt-writer'
import {
  FACTION_ORDER,
  TEMPLATE_DECAL_GUID,
  TEMPLATE_DECAL_PBGID_LE,
  getDecalGfxTemplate,
  getDecalRgdTemplate,
  type DecalFaction,
} from '@/lib/decal-mod-templates'
import type { Coh2DecalPackProject } from '@/lib/decal-pack-project'
import { ATLAS_PART_DEFS } from '@/lib/decal-pack-project'

/** Inventory icon dimensions. The .info / GFX template was extracted from a
 *  decal pack whose `<guid>_i1.dds` was 64×64. We render to that exact size
 *  so the GFX's sub-rect math binds correctly. */
export const DECAL_ICON_SIZE = 64

/** Pack texture dimensions for the main `<slug>.dds` file. Welsh Dragon ships
 *  a 280×280 root preview DDS — we match that. The engine reads decal art from
 *  the per-faction RGTs, not from this file; this slot is only the pack's
 *  project thumbnail. Stays DXT5 (BC3). */
export const DECAL_MAIN_SIZE = 280

/** Canonical per-faction RGT texture size. Every working community decal pack
 *  (Welsh Dragon, German Empire, Stalin, OCF Soviet) ships per-faction badge
 *  RGTs at exactly 1024×1024. The engine paints this texture onto the vehicle's
 *  badge UV island; smaller sizes produce effectively-blank markings. 1024 is
 *  divisible by 4 — the DXT1 block-compression requirement. The RGTs use DXT1
 *  (BC1) format because decal artwork is a pure white-on-black binary mask;
 *  the renderer applies faction tint at runtime. */
export const DECAL_TEXTURE_SIZE = 1024

// ─── Public API ─────────────────────────────────────────────────────────────

export interface BuildDecalModResult {
  /** The complete SGA bytes ready to be written to disk under
   *  ~/.steam/.../Company of Heroes 2/mods/decals/subscriptions/<guid>.sga */
  sga: Uint8Array
  /** The 32-hex-character GUID baked into this build. */
  guid: string
  /** Filesystem-safe slug derived from `project.packName`. */
  slug: string
  /** Recommended disk filename for the SGA (e.g. `<guid>.sga`). */
  sgaFilename: string
  /** Per-faction pbgid we wrote at RGD offset 64. */
  pbgids: Record<DecalFaction, number>
}

export interface BuildDecalModInput {
  project: Coh2DecalPackProject
  /**
   * RGBA pixels for the per-faction decal texture (also reused as the
   * inventory thumbnail). The size must match `DECAL_ICON_SIZE` (64×64).
   * The caller rasterises the project's decals into this canvas. In
   * environments without a real Canvas API (jsdom, headless test) the
   * caller may pass an all-transparent buffer — the SGA structure stays
   * valid and the in-game texture is just blank.
   */
  iconRgba: Uint8ClampedArray | Uint8Array
  /**
   * Optional larger 128×128 pack-thumbnail RGBA. When omitted, the icon
   * canvas is upscaled with nearest-neighbour to fill this slot.
   * Currently the engine doesn't appear to read this file at runtime
   * (only the per-faction RGTs are referenced for decal art), but we
   * include it to match the reference 15-file layout byte-for-byte.
   */
  mainRgba?: Uint8ClampedArray | Uint8Array
  /**
   * 1024×1024 RGBA composite of all visible decals — used for the
   * per-faction `default_dif.rgt` (the texture the engine actually
   * paints onto vehicles). When omitted, falls back to `iconRgba`
   * upscaled with nearest-neighbour — but every caller in production
   * should provide this to avoid baking a low-resolution source into the
   * vehicle badge UV island.
   *
   * 1024×1024 matches every working community decal pack (Welsh Dragon,
   * German Empire, Stalin, OCF Soviet). The RGTs are encoded as DXT1 (BC1)
   * binary masks — auto-thresholded to pure white-on-black before encoding.
   */
  decalRgba?: Uint8ClampedArray | Uint8Array
  /**
   * Per-part, per-faction pre-rendered RGBAs for the 6-part atlas bake (v6).
   * partRgbas[partIndex].shared    = Uint8ClampedArray at part.region.w × part.region.h × 4
   * partRgbas[partIndex][faction]  = optional override; same dimensions as shared
   * When absent, the bake falls back to legacy `decalRgba` behaviour (v1–v5 projects).
   */
  partRgbas?: Array<Partial<Record<import('@/lib/decal-mod-templates').DecalFaction | 'shared', Uint8ClampedArray>>>

  /**
   * Override the auto-generated GUID. Pass the SAME GUID across rebuilds
   * to let CoH2 treat them as updates to the same mod rather than new
   * subscriptions. Lowercase 32-hex-char only.
   */
  guid?: string
}

/**
 * Build a complete decal-pack mod SGA from a project + pre-rendered icon
 * canvas. Mirrors the contract of `buildFaceplateMod` (id-stable, idempotent,
 * round-tripped through `SgaArchive.open` before returning).
 */
export async function buildDecalMod(input: BuildDecalModInput): Promise<BuildDecalModResult> {
  const { project, iconRgba } = input

  if (iconRgba.length !== DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4) {
    throw new Error(
      `Icon RGBA buffer is ${iconRgba.length} bytes; expected ` +
        `${DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4} (${DECAL_ICON_SIZE}²×4)`,
    )
  }

  const mainRgba = input.mainRgba ?? upscaleNearest(iconRgba, DECAL_ICON_SIZE, DECAL_MAIN_SIZE)
  if (mainRgba.length !== DECAL_MAIN_SIZE * DECAL_MAIN_SIZE * 4) {
    throw new Error(
      `Main RGBA buffer is ${mainRgba.length} bytes; expected ` +
        `${DECAL_MAIN_SIZE * DECAL_MAIN_SIZE * 4} (${DECAL_MAIN_SIZE}²×4)`,
    )
  }

  const guid = (input.guid ?? generateGuid()).toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(guid)) {
    throw new Error(`guid must be exactly 32 lowercase hex chars (got "${guid}")`)
  }
  const slug = makeSlug(project.packName) || 'decal_pack'

  // ── 1. Encode the textures as BC3 wrapped in DDS ──────────────────────────
  const iconBc3 = encodeBc3(iconRgba, DECAL_ICON_SIZE, DECAL_ICON_SIZE)
  const iconDds = wrapBc3InDds(iconBc3, DECAL_ICON_SIZE, DECAL_ICON_SIZE)
  const mainBc3 = encodeBc3(mainRgba, DECAL_MAIN_SIZE, DECAL_MAIN_SIZE)
  const mainDds = wrapBc3InDds(mainBc3, DECAL_MAIN_SIZE, DECAL_MAIN_SIZE)

  // ── 2. Patch the GFX template ─────────────────────────────────────────────
  const gfx = substituteAsciiGuid(getDecalGfxTemplate(), TEMPLATE_DECAL_GUID, guid)

  // ── 3. Per-faction RGDs + RGTs ────────────────────────────────────────────
  const rgdFiles: { path: string; bytes: Uint8Array }[] = []
  const rgtFiles: { path: string; bytes: Uint8Array }[] = []
  const pbgids: Record<DecalFaction, number> = {} as never

  for (const faction of FACTION_ORDER) {
    // RGD: substitute ASCII + UTF-16-LE GUID, then overwrite the unique pbgid
    // at offset 64. We salt the pbgid with the faction name so the 5 emitted
    // RGDs don't all hash to the same id — CoH2's attribute pool requires
    // every entry to have a distinct pbgid, and a single project shipping
    // five identical pbgids would silently drop 4 of the 5 entries.
    const pbgid = deriveDeterministicPbgid(`${guid}_${faction}`)
    pbgids[faction] = pbgid
    const rgd = patchDecalRgd(
      getDecalRgdTemplate(faction),
      TEMPLATE_DECAL_GUID,
      guid,
      TEMPLATE_DECAL_PBGID_LE[faction],
      pbgid,
    )
    rgdFiles.push({ path: `attrib/vehicle_decal/${slug}_${faction}.rgd`, bytes: rgd })

    // RGT: composite a 1024×1024 atlas for this faction.
    // v6: each part uses faction override layers if provided, else shared layers.
    // v5 fallback: use the single decalRgba (or upscaled iconRgba).
    let rgtSrc: Uint8ClampedArray

    if (input.partRgbas) {
      // v6 path: composite per-part RGBAs onto a blank 1024×1024 canvas.
      const atlasCanvas = document.createElement('canvas')
      atlasCanvas.width = atlasCanvas.height = DECAL_TEXTURE_SIZE
      const atlasCtx = atlasCanvas.getContext('2d')
      if (atlasCtx) {
        for (let pi = 0; pi < ATLAS_PART_DEFS.length; pi++) {
          const def = ATLAS_PART_DEFS[pi]
          const partEntry = input.partRgbas[pi]
          // Prefer faction override; fall back to shared.
          const rgba = partEntry?.[faction] ?? partEntry?.['shared']
          if (!rgba) continue
          const partCanvas = document.createElement('canvas')
          partCanvas.width = def.region.w
          partCanvas.height = def.region.h
          const pCtx = partCanvas.getContext('2d')
          if (!pCtx) continue
          // Cast to ArrayBuffer-backed view: the ImageData ctor rejects the
          // generic Uint8ClampedArray<ArrayBufferLike> default (could be
          // SharedArrayBuffer) under tsc -b. Same idiom as gfx-bitmaps.ts.
          pCtx.putImageData(
            new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, def.region.w, def.region.h),
            0,
            0
          )
          atlasCtx.drawImage(partCanvas, def.region.x, def.region.y)
        }
      }
      const atlasCtxRead = atlasCanvas.getContext('2d')!
      rgtSrc = binariseMask(
        atlasCtxRead.getImageData(0, 0, DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE).data
      )
    } else {
      // v5 legacy path: single decalRgba (already 1024×1024) or upscaled icon.
      const rgtSrcRaw =
        input.decalRgba ?? upscaleNearest(iconRgba, DECAL_ICON_SIZE, DECAL_TEXTURE_SIZE)
      rgtSrc = binariseMask(rgtSrcRaw)
    }

    const rgtCanvas = makeCanvasFromRgba(rgtSrc, DECAL_TEXTURE_SIZE, DECAL_TEXTURE_SIZE)
    const rgtInternalName = `art\\armies\\${faction}\\badges\\${guid}\\default_dif`
    const rgt = canvasToRgt(rgtCanvas, rgtInternalName)
    rgtFiles.push({
      path: `art/armies/${faction}/badges/${guid}/default_dif.rgt`,
      bytes: rgt,
    })
  }

  // ── 4. UCS + INFO ─────────────────────────────────────────────────────────
  // String ids match the locstring references hard-coded in the template
  // RGDs: `$<guid>:1` (name) and `$<guid>:2` (description). Mirrors the
  // faceplate pipeline.
  const trimmedDesc = project.packDescription.trim()
  const stringTable: UcsStringEntry[] = [
    { id: 1, text: project.packName.trim() || 'Custom Decal Pack' },
  ]
  if (trimmedDesc) stringTable.push({ id: 2, text: trimmedDesc })
  const ucs = buildUcsFile(stringTable)
  const info = buildInfoFile(project, guid)

  // ── 5. Pack everything into an SGA archive ────────────────────────────────
  const sga = await buildSga({
    archiveName: guid,
    files: [
      // attrib drive (5 per-faction RGDs)
      ...rgdFiles,
      // english drive
      { path: 'english/english.ucs', bytes: ucs },
      // info drive (root-level files):
      //   - `<guid>.info`   pack metadata
      //   - `<slug>.dds`    pack preview texture
      //
      // ⚠ ROOT .DDS MUST LIVE AT THE SGA ROOT (no folder prefix) so the
      // SGA writer routes it to drive 2 ("info"). If it ends up in drive 3
      // ("data") alongside the art/ and ui/ assets, the engine rejects the
      // whole archive with:
      //   MOD -- Error loading mod pack '<guid>': <slug>.dds not permitted.
      //   MOD -- Error loading mod pack '...<guid>.sga': invalid file structure.
      // Verified against 22 installed Workshop subscriptions — every one
      // of them places the root preview .dds in the "info" drive, never
      // in "data". Filename pattern is unconstrained (underscores OK:
      // `punisher_cut.dds`, `decal_british_welshdragonpeview.dds`;
      // spaces OK: `star of david.dds`, `kings own yorkshire light
      // infantry pre.dds`; any size OK: 128, 280, 524, 1024). See
      // `sga-writer.ts driveOf()` for the routing rule.
      { path: `${guid}.info`, bytes: info },
      { path: `${slug}.dds`, bytes: mainDds },
      // data drive (5 RGTs + inventory DDS + GFX).
      ...rgtFiles,
      { path: `ui/assets/textures/${guid}_i1.dds`, bytes: iconDds },
      { path: `ui/bin/${guid}.gfx`, bytes: gfx },
    ],
  })

  // ── 6. Pre-export verification ────────────────────────────────────────────
  await assertSgaParses(sga)

  return {
    sga,
    guid,
    slug,
    sgaFilename: `${guid}.sga`,
    pbgids,
  }
}

/**
 * Round-trip the just-built SGA through `SgaArchive.open` to confirm the
 * TOC + offsets are internally consistent. Mirrors `assertSgaParses` from
 * the faceplate builder. Skipped in environments without the `File`
 * constructor (Node test runs cover this path directly via the
 * `SgaArchive` import).
 */
async function assertSgaParses(sga: Uint8Array): Promise<void> {
  if (typeof File === 'undefined') return
  try {
    const buf = sga.buffer.slice(sga.byteOffset, sga.byteOffset + sga.byteLength) as ArrayBuffer
    const file = new File([buf], 'verify.sga', { type: 'application/octet-stream' })
    await SgaArchive.open(file)
  } catch {
    throw new Error('decal pack verify failed')
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Wrap a BC3 (DXT5) payload in the 128-byte DDS header used by every CoH2
 *  texture file. Mirrors `wrapBc3InDds` from the faceplate builder. */
export function wrapBc3InDds(bc3: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(128 + bc3.length)
  const view = new DataView(out.buffer)
  out.set([0x44, 0x44, 0x53, 0x20], 0) // 'DDS '
  view.setUint32(4, 124, true)
  view.setUint32(8, 0x00081007, true)
  view.setUint32(12, height, true)
  view.setUint32(16, width, true)
  view.setUint32(20, bc3.length, true)
  view.setUint32(24, 0, true)
  view.setUint32(28, 0, true)
  view.setUint32(76, 32, true)
  view.setUint32(80, 0x4, true)
  out.set([0x44, 0x58, 0x54, 0x35], 84) // 'DXT5'
  view.setUint32(108, 0x1000, true)
  out.set(bc3, 128)
  return out
}

/** Substitute every occurrence of a 32-hex-char ASCII GUID inside a buffer. */
function substituteAsciiGuid(buf: Uint8Array, fromGuid: string, toGuid: string): Uint8Array {
  if (fromGuid.length !== 32 || toGuid.length !== 32) {
    throw new Error('GUIDs must be exactly 32 chars (ASCII hex)')
  }
  const fromBytes = new TextEncoder().encode(fromGuid)
  const toBytes = new TextEncoder().encode(toGuid)
  const out = new Uint8Array(buf)
  let i = 0
  while (i <= out.length - 32) {
    let match = true
    for (let j = 0; j < 32; j++) {
      if (out[i + j] !== fromBytes[j]) {
        match = false
        break
      }
    }
    if (match) {
      for (let j = 0; j < 32; j++) out[i + j] = toBytes[j]
      i += 32
    } else {
      i += 1
    }
  }
  return out
}

/** Substitute a UTF-16-LE-encoded GUID (each ASCII char becomes <byte> 0x00). */
function substituteUtf16LeGuid(buf: Uint8Array, fromGuid: string, toGuid: string): Uint8Array {
  if (fromGuid.length !== 32 || toGuid.length !== 32) {
    throw new Error('GUIDs must be exactly 32 chars')
  }
  const out = new Uint8Array(buf)
  const fromBytes = new Uint8Array(64)
  const toBytes = new Uint8Array(64)
  for (let i = 0; i < 32; i++) {
    fromBytes[i * 2] = fromGuid.charCodeAt(i)
    toBytes[i * 2] = toGuid.charCodeAt(i)
  }
  let i = 0
  while (i <= out.length - 64) {
    let match = true
    for (let j = 0; j < 64; j++) {
      if (out[i + j] !== fromBytes[j]) {
        match = false
        break
      }
    }
    if (match) {
      for (let j = 0; j < 64; j++) out[i + j] = toBytes[j]
      i += 64
    } else {
      i += 1
    }
  }
  return out
}

/** Patch a decal-pack per-faction RGD: substitute the ASCII GUID + UTF-16-LE
 *  GUID, then overwrite the unique pbgid at file offset 64. Mirrors
 *  `patchRgd` from the faceplate builder. */
function patchDecalRgd(
  buf: Uint8Array,
  fromGuid: string,
  toGuid: string,
  fromPbgid: number,
  toPbgid: number,
): Uint8Array {
  let out = substituteAsciiGuid(buf, fromGuid, toGuid)
  out = substituteUtf16LeGuid(out, fromGuid, toGuid)

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const found = view.getUint32(64, true)
  if (found !== fromPbgid) {
    throw new Error(
      `Decal RGD template pbgid mismatch at offset 64: expected 0x${fromPbgid.toString(16)}, ` +
        `found 0x${found.toString(16)}. Template is likely corrupted.`,
    )
  }
  view.setUint32(64, toPbgid >>> 0, true)
  return out
}

/** Generate a random 32-hex-character GUID. */
export function generateGuid(): string {
  const bytes = new Uint8Array(16)
  if (typeof globalThis !== 'undefined' && (globalThis as { crypto?: Crypto }).crypto) {
    ;(globalThis as { crypto: Crypto }).crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (let i = 0; i < 16; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

/** Derive a deterministic 32-bit pbgid from an input string using FNV-1a 32-bit.
 *  Same input → same output. Salted with the faction name in the caller so the
 *  5 per-faction RGDs in a single project don't collide. */
export function deriveDeterministicPbgid(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  if (h === 0) h = 0x12345678
  return h >>> 0
}

interface UcsStringEntry {
  id: number
  text: string
}

/** Build a CoH2 .ucs string table. UTF-16-LE with BOM, CRLF line separators,
 *  each line `<id>\t<text>`. Identical to the faceplate builder's helper —
 *  duplicated rather than imported so each mod-builder stays self-contained. */
export function buildUcsFile(entries: UcsStringEntry[]): Uint8Array {
  const lines: string[] = []
  for (const e of entries) {
    const text = e.text.replace(/[\r\n]+/g, ' ').trim()
    lines.push(`${e.id}\t${text}`)
  }
  const body = lines.join('\r\n') + '\r\n'
  const out = new Uint8Array(2 + body.length * 2)
  out[0] = 0xff
  out[1] = 0xfe
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    out[2 + i * 2] = code & 0xff
    out[2 + i * 2 + 1] = (code >>> 8) & 0xff
  }
  return out
}

/** Build a CoH2 .info metadata file. ASCII, CRLF line endings. Format
 *  reverse-engineered from real workshop decal packs (matches the faceplate
 *  format byte-for-byte; the .info is item-type agnostic). */
export function buildInfoFile(project: Coh2DecalPackProject, _guid: string): Uint8Array {
  void _guid
  const esc = (s: string) =>
    s
      .replace(/[\r\n]+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
  const trimmedDescription = project.packDescription.trim()
  const lines = [
    'hidden = false',
    `name = "${esc(project.packName)}"`,
    `description = "${esc(trimmedDescription)}"`,
    'dependencies = ',
    '{',
    '}',
  ]
  const body = lines.join('\r\n') + '\r\n'
  const out = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff
  return out
}

/** Convert a pack name into a filesystem-safe slug. Mirrors
 *  `decal-pack-export.makeSlug` (kept duplicated so the mod builder doesn't
 *  pull the export pipeline into its module graph). */
export function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

/**
 * Auto-threshold a raw RGBA buffer to a pure binary white-on-black mask.
 * For each pixel: if luminance (0..1) > 0.5 OR alpha > 0.5 → (255,255,255,255),
 * else → (0,0,0,0). Result is always a freshly-allocated Uint8ClampedArray so
 * the original input is not mutated.
 */
function binariseMask(src: Uint8ClampedArray | Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i] / 255
    const g = src[i + 1] / 255
    const b = src[i + 2] / 255
    const a = src[i + 3] / 255
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const on = lum > 0.5 || a > 0.5
    out[i    ] = on ? 255 : 0
    out[i + 1] = on ? 255 : 0
    out[i + 2] = on ? 255 : 0
    out[i + 3] = on ? 255 : 0
  }
  return out
}

/** Nearest-neighbour upscale used as a fallback when the caller doesn't
 *  supply a separate main-texture canvas. Cheap, dependency-free. */
function upscaleNearest(
  src: Uint8ClampedArray | Uint8Array,
  srcSize: number,
  dstSize: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstSize * dstSize * 4)
  const ratio = srcSize / dstSize
  for (let y = 0; y < dstSize; y++) {
    const sy = Math.min(srcSize - 1, Math.floor(y * ratio))
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.min(srcSize - 1, Math.floor(x * ratio))
      const si = (sy * srcSize + sx) * 4
      const di = (y * dstSize + x) * 4
      out[di] = src[si]
      out[di + 1] = src[si + 1]
      out[di + 2] = src[si + 2]
      out[di + 3] = src[si + 3]
    }
  }
  return out
}

/**
 * Build an HTMLCanvasElement from raw RGBA pixels for use with
 * `canvasToRgt()`. Browser path uses `document.createElement('canvas')`;
 * test/Node path uses a minimal stub that satisfies the rgt-writer's
 * `getContext('2d').getImageData(...)` call shape. Throws in environments
 * with neither (vanishingly rare — vitest's jsdom environment ships canvas).
 */
function makeCanvasFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): HTMLCanvasElement {
  // Browser / jsdom path
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const imageData = ctx.createImageData(width, height)
      imageData.data.set(rgba)
      ctx.putImageData(imageData, 0, 0)
      return canvas
    }
  }
  // Pure-Node test path: hand back a tiny stub canvas that quacks like the
  // shape canvasToRgt reads (it only calls getContext('2d').getImageData()).
  const stubData = new Uint8ClampedArray(rgba)
  const stub = {
    width,
    height,
    getContext(kind: string) {
      if (kind !== '2d') return null
      return {
        getImageData(_x: number, _y: number, w: number, h: number) {
          if (w !== width || h !== height) {
            throw new Error('decal stub canvas only supports full-region getImageData')
          }
          return { data: stubData, width, height }
        },
      }
    },
  }
  return stub as unknown as HTMLCanvasElement
}
