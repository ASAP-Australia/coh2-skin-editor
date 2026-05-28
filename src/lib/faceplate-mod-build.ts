/**
 * Faceplate mod builder — assembles a fully-loadable CoH2 faceplate SGA from
 * a `Coh2FaceplateProject` + a pre-rendered RGBA atlas.
 *
 * The output is a single Uint8Array containing a CoH2-compatible SGA v7
 * archive with the same 6-file layout as a published workshop faceplate:
 *
 *   attrib/faceplate/<slug>_faceplate.rgd       (497 bytes, template-substituted)
 *   english/english.ucs                         (UTF-16-LE, generated)
 *   <guid>.info                                 (ASCII CRLF, generated)
 *   ui/assets/textures/<guid>_i1.dds            (BC3/DXT5, 692×204, encoded here)
 *   ui/bin/<guid>.gfx                           (8485 bytes, template-substituted)
 *
 * The orchestrator does no DOM work. It accepts a `Uint8ClampedArray` of
 * 692×204 RGBA pixels — the FaceplateEditor renders into an HTMLCanvasElement
 * and uses `ctx.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data` to feed
 * that into `buildFaceplateMod`. Splitting compose vs. build keeps the build
 * pipeline testable in a non-DOM environment (the test script and bench
 * synthesise the atlas directly as a Uint8ClampedArray).
 *
 * The atlas's 692×204 dimensions are the *packed texture size*; the engine
 * samples a 624×204 banner sub-rect plus a 64×64 icon sub-rect from inside
 * that atlas — see faceplate-templates.ts for the verified sub-rect math.
 */

import { deflate as _deflate } from 'pako'
void _deflate // keep the import (sga-writer pulls it in, this is for type symmetry)

import { encodeBc3 } from '@/lib/bc-encode'
import { buildSga } from '@/lib/sga-writer'
import { SgaArchive } from '@/lib/sga'
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  TEMPLATE_GUID,
  TEMPLATE_PBGID_LE,
  getGfxTemplate,
  getRgdTemplate,
} from '@/lib/faceplate-templates'
import type { Coh2FaceplateProject } from '@/lib/faceplate-project'

// ─── Public API ──────────────────────────────────────────────────────────────

export interface BuildFaceplateModResult {
  /** The complete SGA bytes ready to be written to disk under
   *  ~/.steam/.../Company of Heroes 2/mods/faceplates/subscriptions/<guid>.sga
   *  (or the equivalent workshop staging path). */
  sga: Uint8Array
  /** The 32-hex-character GUID we generated for this build. */
  guid: string
  /** Filesystem-safe slug derived from `project.packName`, used in the
   *  attribute filename. Lowercase, alphanumeric + underscores. */
  slug: string
  /** Recommended disk filename for the SGA (e.g. `<guid>.sga`). */
  sgaFilename: string
  /** The 4 bytes (LE uint32) we wrote as the unique pbgid in the RGD. */
  pbgid: number
  /** The DDS bytes we packed (useful if the caller wants to preview the
   *  compressed atlas separately). */
  dds: Uint8Array
}

export interface BuildFaceplateModInput {
  project: Coh2FaceplateProject
  /** Premultiplied-or-straight RGBA, exactly ATLAS_WIDTH × ATLAS_HEIGHT pixels.
   *  FaceplateEditor renders into an HTMLCanvasElement at ATLAS_WIDTH × ATLAS_HEIGHT
   *  and reads this via `getImageData()` — see `composeFaceplateCanvas` in
   *  FaceplateEditor.tsx. */
  atlasRgba: Uint8ClampedArray | Uint8Array
  /** Override the auto-generated GUID. Use the SAME GUID across rebuilds to
   *  let CoH2 treat them as updates to the same mod rather than new mods.
   *  Lowercase 32-hex-char only. */
  guid?: string
}

/**
 * Build a complete faceplate mod SGA from a project + rendered atlas.
 *
 * This is synchronous-friendly but typed `async` because `buildSga()` is
 * (it deflates payloads on the worker-ish hot path; pako happens to be sync
 * but the signature reserves the right to use compressionStream later).
 */
export async function buildFaceplateMod(
  input: BuildFaceplateModInput,
): Promise<BuildFaceplateModResult> {
  const { project, atlasRgba } = input

  if (atlasRgba.length !== ATLAS_WIDTH * ATLAS_HEIGHT * 4) {
    throw new Error(
      `Atlas RGBA buffer is ${atlasRgba.length} bytes; expected ${ATLAS_WIDTH * ATLAS_HEIGHT * 4} ` +
        `(${ATLAS_WIDTH}×${ATLAS_HEIGHT}×4)`,
    )
  }

  const guid = (input.guid ?? generateGuid()).toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(guid)) {
    throw new Error(`guid must be exactly 32 lowercase hex chars (got "${guid}")`)
  }
  const slug = makeSlug(project.packName) || 'faceplate'

  // ----- 1. Encode the atlas as BC3 and wrap it in a DDS container -------
  const bc3 = encodeBc3(atlasRgba, ATLAS_WIDTH, ATLAS_HEIGHT)
  const dds = wrapBc3InDds(bc3, ATLAS_WIDTH, ATLAS_HEIGHT)

  // ----- 2. Patch the GFX template with our new GUID ---------------------
  const gfx = substituteAsciiGuid(getGfxTemplate(), TEMPLATE_GUID, guid)

  // ----- 3. Patch the RGD template (GUID in ASCII + UTF-16-LE + new pbgid)
  const pbgid = deriveDeterministicPbgid(guid)
  const rgd = patchRgd(getRgdTemplate(), TEMPLATE_GUID, guid, TEMPLATE_PBGID_LE, pbgid)

  // ----- 4. Generate plaintext UCS string table + .info metadata ---------
  //
  // String-id convention is taken directly from three reference workshop
  // faceplates (Ram Ranch, Clarkson, HK416V2), all of which use small
  // integer ids `1` (name) and `2` (description). The RGD template
  // references the name string via a UTF-16-LE locstring "e$<guid>:1"
  // pattern — the `:1` suffix is the ucs id — so swapping in pbgid-derived
  // ids (as earlier revisions did) leaves the engine unable to resolve the
  // string and the in-game faceplate name falls back to a placeholder.
  //
  // The HK416V2 reference proves an empty description is valid: its .info
  // contains `description = ""` and its .ucs omits the id=2 line entirely.
  // We mirror that — non-empty description ⇒ emit ucs id=2, empty ⇒ omit.
  //
  // The description is emitted verbatim. The `project.author` field is
  // captured in the editor for the ProjectMetaPanel byline but is NOT
  // baked into the exported description —
  // the user explicitly opted out of an auto "— by {author}" suffix so
  // the in-game text stays exactly what they typed.
  const trimmedDesc = project.packDescription.trim()
  const stringTable: UcsStringEntry[] = [
    { id: 1, text: project.packName.trim() || 'Custom Faceplate' },
  ]
  if (trimmedDesc) stringTable.push({ id: 2, text: trimmedDesc })
  const ucs = buildUcsFile(stringTable)
  const info = buildInfoFile(project, guid)

  // ----- 5. Pack everything into an SGA archive --------------------------
  const sga = await buildSga({
    archiveName: guid,
    files: [
      // attrib drive
      {
        path: `attrib/faceplate/${slug}_faceplate.rgd`,
        bytes: rgd,
      },
      // english drive
      {
        path: 'english/english.ucs',
        bytes: ucs,
      },
      // info drive
      {
        path: `${guid}.info`,
        bytes: info,
      },
      // data drive (ui textures + gfx)
      {
        path: `ui/assets/textures/${guid}_i1.dds`,
        bytes: dds,
      },
      {
        path: `ui/bin/${guid}.gfx`,
        bytes: gfx,
      },
    ],
  })

  // ----- 6. Silent pre-export verification ------------------------------
  // Per the "100% reliable" mandate: every emitted SGA must round-trip
  // cleanly through the same reader CoH2 uses internally before we hand
  // it to the user. If parsing fails, we throw — the UI surfaces a calm
  // "couldn't build the mod file" message and the user is never given a
  // broken archive. Silent: no logs, no progress UI; failure is rare.
  await assertSgaParses(sga)

  return {
    sga,
    guid,
    slug,
    sgaFilename: `${guid}.sga`,
    pbgid,
    dds,
  }
}

/**
 * Round-trip the just-built SGA through `SgaArchive.open` to confirm the
 * TOC + magic header + offsets are all internally consistent. We don't
 * read the payload back — payload corruption is caught by CoH2 at load
 * time, but TOC corruption silently produces a "no such mod" failure
 * which is the worst possible outcome for a "just works" tool.
 *
 * Throws a generic error if parsing fails; callers translate it into the
 * user-facing apologetic message. No File/Blob shim is needed in browsers
 * because the global `File` constructor is available; in test/Node
 * environments where `File` is missing we skip silently (the unit tests
 * already cover this path directly).
 */
async function assertSgaParses(sga: Uint8Array): Promise<void> {
  if (typeof File === 'undefined') return
  try {
    const buf = sga.buffer.slice(sga.byteOffset, sga.byteOffset + sga.byteLength) as ArrayBuffer
    const file = new File([buf], 'verify.sga', { type: 'application/octet-stream' })
    await SgaArchive.open(file)
  } catch {
    // Re-throw with a deliberately generic message so the UI's catch
    // branch can map it to a plain-English line without leaking the
    // internal parser error.
    throw new Error('faceplate verify failed')
  }
}

// (The browser-side atlas composer `composeFaceplateAtlas` was removed in the
//  v1.0 cleanup — `FaceplateEditor.composeFaceplateCanvas` does the equivalent
//  inline at the actual ATLAS dimensions and reads the bytes via
//  `getImageData`. The test script + bench synthesise atlases directly. If a
//  future caller needs a project → atlas helper outside the editor, restore
//  it from git history at SHA-of-removal. ATLAS_WIDTH/HEIGHT and the BANNER/
//  ICON sub-rects continue to live in faceplate-templates.ts.)

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Wrap a BC3 (DXT5) payload in the 128-byte DDS header used by every CoH2
 *  faceplate texture. Matches the reference workshop atlases byte-for-byte
 *  except for the payload. */
export function wrapBc3InDds(bc3: Uint8Array, width: number, height: number): Uint8Array {
  // The reference atlases all use:
  //   size=124, flags=0x00081007 (CAPS|HEIGHT|WIDTH|PIXELFORMAT|LINEARSIZE),
  //   pitch=linearSize=total BC3 bytes, mipCount=0,
  //   pixelFormat: size=32, flags=4 (FOURCC), fourCC='DXT5',
  //   caps1=0x1000 (TEXTURE), caps2=0
  const out = new Uint8Array(128 + bc3.length)
  const view = new DataView(out.buffer)

  // 'DDS ' magic
  out.set([0x44, 0x44, 0x53, 0x20], 0)

  // DDS_HEADER (124 bytes starting at offset 4)
  view.setUint32(4, 124, true) // size
  view.setUint32(8, 0x00081007, true) // flags
  view.setUint32(12, height, true) // height
  view.setUint32(16, width, true) // width
  view.setUint32(20, bc3.length, true) // pitchOrLinearSize
  view.setUint32(24, 0, true) // depth
  view.setUint32(28, 0, true) // mipMapCount
  // 11 reserved dwords (offsets 32–75) — leave zeroed

  // PixelFormat at offset 76
  view.setUint32(76, 32, true) // size
  view.setUint32(80, 0x4, true) // flags (FOURCC)
  out.set([0x44, 0x58, 0x54, 0x35], 84) // fourCC = 'DXT5'
  // rgbBitCount + RGBA masks (offsets 88-107) — leave zeroed for FOURCC formats

  // Caps at offset 108
  view.setUint32(108, 0x1000, true) // caps1 = TEXTURE
  // caps2, caps3, caps4, reserved2 — leave zeroed (offsets 112-123)

  // Payload at offset 128
  out.set(bc3, 128)
  return out
}

/** Substitute every occurrence of a 32-hex-char GUID inside an arbitrary
 *  byte buffer with a new 32-hex-char GUID. Both must be ASCII. We don't use
 *  TextDecoder/encoder because we want to leave the surrounding bytes
 *  (length prefixes, opcodes, etc.) absolutely untouched. */
function substituteAsciiGuid(buf: Uint8Array, fromGuid: string, toGuid: string): Uint8Array {
  if (fromGuid.length !== 32 || toGuid.length !== 32) {
    throw new Error('GUIDs must be exactly 32 chars (ASCII hex)')
  }
  const fromBytes = new TextEncoder().encode(fromGuid)
  const toBytes = new TextEncoder().encode(toGuid)
  const out = new Uint8Array(buf)
  // Scan for every occurrence (overlap-safe since GUIDs cannot overlap themselves).
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

/** Patch the RGD template:
 *  1. ASCII guid substitution (ModIcons_<guid>_faceplate, ModIcons_<guid>_icon)
 *  2. UTF-16-LE guid substitution (store_item reference "e$<guid>:1")
 *  3. pbgid uint32-LE at payload offset 0 (= file offset 64) */
function patchRgd(
  buf: Uint8Array,
  fromGuid: string,
  toGuid: string,
  fromPbgid: number,
  toPbgid: number,
): Uint8Array {
  let out = substituteAsciiGuid(buf, fromGuid, toGuid)
  out = substituteUtf16LeGuid(out, fromGuid, toGuid)

  // Verify the original pbgid is where we expect (file offset 64).
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const found = view.getUint32(64, true)
  if (found !== fromPbgid) {
    throw new Error(
      `RGD template pbgid mismatch at offset 64: expected 0x${fromPbgid.toString(16)}, ` +
        `found 0x${found.toString(16)}. Template is likely corrupted.`,
    )
  }
  view.setUint32(64, toPbgid >>> 0, true)
  return out
}

/** Generate a random 32-hex-character GUID. Workshop IDs are 32 hex chars
 *  (the same width as a v4 UUID without separators). We don't use crypto.UUID
 *  because it forces dashes; we use crypto.getRandomValues() for entropy. */
export function generateGuid(): string {
  const bytes = new Uint8Array(16)
  if (typeof globalThis !== 'undefined' && (globalThis as { crypto?: Crypto }).crypto) {
    ;(globalThis as { crypto: Crypto }).crypto.getRandomValues(bytes)
  } else {
    // Test/Node fallback (vitest in node mode has globalThis.crypto since Node 19).
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // Format as 32 lowercase hex chars.
  let out = ''
  for (let i = 0; i < 16; i++) {
    const b = bytes[i].toString(16).padStart(2, '0')
    out += b
  }
  return out
}

/** Derive a deterministic 32-bit pbgid from the mod GUID using FNV-1a 32-bit.
 *  Same GUID → same pbgid (stable across rebuilds). Different GUIDs → very
 *  high probability of distinct pbgids. The pbgid only needs to be unique
 *  within the running attribute pool, so collision risk is acceptable. */
export function deriveDeterministicPbgid(guid: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5
  for (let i = 0; i < guid.length; i++) {
    h ^= guid.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // Avoid 0 (reserved/sentinel by some Relic toolchains).
  if (h === 0) h = 0x12345678
  return h >>> 0
}

interface UcsStringEntry {
  id: number
  text: string
}

/** Build a CoH2 .ucs string table. The format is UTF-16-LE with BOM, lines
 *  separated by CRLF, each line `<id>\t<text>`. The engine looks up faceplate
 *  display names + descriptions by id (the RGD's locstring fields reference
 *  these ids by integer). */
export function buildUcsFile(entries: UcsStringEntry[]): Uint8Array {
  const lines: string[] = []
  for (const e of entries) {
    // Strip newlines from text (the format is line-oriented; embedded \n
    // would break the parser).
    const text = e.text.replace(/[\r\n]+/g, ' ').trim()
    lines.push(`${e.id}\t${text}`)
  }
  // UCS files end with a final CRLF (matches all reference mods).
  const body = lines.join('\r\n') + '\r\n'

  // Encode as UTF-16-LE with BOM (0xFF 0xFE).
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

/** Build a CoH2 .info metadata file. ASCII, CRLF line endings.
 *
 *  Format reverse-engineered byte-for-byte from three reference workshop
 *  mods (Ram Ranch, Clarkson, HK416V2). The trailing space after
 *  `dependencies = ` and the three-line `{` / `}` block are intentional —
 *  the Relic parser is picky about both. HK416V2's name field also proves
 *  that embedded `"` inside the value is escaped as `\"` (not stripped),
 *  so we preserve user-typed quotes losslessly.
 *
 *      hidden = false
 *      name = "<packName>"
 *      description = "<packDescription>"
 *      dependencies = ␣
 *      {
 *      }
 */
export function buildInfoFile(project: Coh2FaceplateProject, _guid: string): Uint8Array {
  void _guid // Reserved for future use (some Relic mods embed the guid in .info)
  // The format uses `"` as a string delimiter and `\"` to escape embedded
  // quotes (proven by HK416V2's name `Girls Frontline Faceplate V2 \"HK416\"`).
  // Also escape backslashes so a stray `\` in the user input cannot break the
  // escape sequence. Strip CR/LF — the format is line-oriented.
  const esc = (s: string) =>
    s
      .replace(/[\r\n]+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
  // The `.info` description and the english.ucs id=2 entry both ship the
  // exact user-typed description verbatim — no author suffix, no
  // editorial transformation. Mod tools and the mod-browser read the
  // `.info` description; the engine renders the .ucs entry in the
  // customisation panel.
  const trimmedDescription = project.packDescription.trim()
  const lines = [
    'hidden = false',
    `name = "${esc(project.packName)}"`,
    `description = "${esc(trimmedDescription)}"`,
    'dependencies = ', // trailing space matches the reference byte-for-byte
    '{',
    '}',
  ]
  const body = lines.join('\r\n') + '\r\n'
  // ASCII (each char becomes one byte).
  const out = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff
  return out
}

/**
 * @deprecated Author tagging was removed by user request — the exported
 * description must be exactly what the user typed, with no
 * "— by {author}" suffix appended. This passthrough is retained only so
 * out-of-tree callers don't break. New code should inline
 * `description.trim()` instead. Will be removed in a future major
 * version.
 */
export function composeDisplayDescription(trimmedDescription: string, _author: string): string {
  void _author
  return trimmedDescription
}

/** Convert a pack name into a filesystem-safe slug (lowercase alphanumerics
 *  + underscores). Used as the basename of the RGD attribute file
 *  (`attrib/faceplate/<slug>_faceplate.rgd`). */
export function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}
