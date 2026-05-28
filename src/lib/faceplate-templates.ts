/**
 * Faceplate mod templates — extracted byte-for-byte from a real published
 * CoH2 workshop faceplate ("Ram Ranch", Workshop ID 287efbabb35548d7972924b50a8f5006).
 *
 * Why template-substitution rather than ground-up writers?
 * ─────────────────────────────────────────────────────────
 * The Scaleform-GFX format used for CoH2 faceplate UI symbols is a *bespoke*
 * subset of SWF compiled by the official Mod Tools' AS3 toolchain. Re-emitting
 * it byte-perfectly from JS would mean shipping an entire ABC/AVM2 encoder
 * (the GFX embeds a compiled ActionScript class per symbol) just to wire two
 * bitmap references — a multi-thousand-line undertaking with brittle output.
 *
 * Mercifully, the symbol table only references a faceplate's identity via a
 * 32-hex-character workshop GUID, which appears in exactly 10 ASCII spots in
 * the GFX (verified by byte-diffing three reference mods: clarkson, hk416,
 * ram_ranch — all from the workshop). Replacing those occurrences with a
 * fresh GUID yields a valid GFX that the engine loads identically, because:
 *   • every length-prefix in the SWF / GFX containers wraps the symbol-name
 *     strings, and our replacement guid has the same 32-char length;
 *   • the ActionScript bytecode references symbol names by NAME (string),
 *     not by interned offset, so the only structural constraint is "the same
 *     name appears in the symbol table and in the SymbolClass tag";
 *   • the texture is referenced by filename ("<guid>_I1.tga", which the
 *     CoH2 loader maps to "<guid>_i1.dds" on disk), so as long as our DDS
 *     filename matches the patched GUID, the bitmap binds correctly.
 *
 * The same logic applies to the RGD attribute file — it's a Relic Chunky
 * blob whose only mod-specific content is:
 *   1. A 32-bit pbgid (unique-id) at payload offset 0  (originally 0x883f76be)
 *   2. The ASCII string "ModIcons_<guid>_faceplate" at file offset 324
 *   3. A UTF-16-LE store_item reference "e$<guid>:1" at file offset 374
 *   4. The ASCII string "ModIcons_<guid>_icon" at file offset 449
 * Items 2-4 are simple GUID substitutions. The pbgid (1) is a 32-bit hash
 * that must be unique within the running attribute pool — we derive it from
 * the new GUID so the same mod always gets the same pbgid (idempotent) but
 * different mods don't collide.
 *
 * The .ucs (string table) and .info (mod metadata) files are generated from
 * scratch — they're trivial plaintext formats. See faceplate-mod-build.ts.
 *
 * ─── Atlas layout (692×204, BC3/DXT5) ───────────────────────────────────
 *
 * The single packed texture holds two symbols. The GFX template encodes the
 * engine's display sub-rects via DefineBitsLossless2 + SymbolClass matrices —
 * verified by independently scanning 3 published reference mods (Ram Ranch,
 * Clarkson, HK416V2). All three contain the SAME (624, 204) display rect at
 * matching byte positions inside the GFX, and all three reference DDS
 * atlases fill those exact sub-rects with content:
 *
 *   • Faceplate banner: (0, 0)-(624, 204)   — engine samples this full rect
 *   • Icon thumbnail:   (624, 0)-(688, 64)  — 64×64 square in the top-right
 *
 * (The remaining 692-688=4 pixels of right padding and 204-64=140 pixels of
 * bottom-right padding are dead space the engine never reads.)
 *
 * Our atlas composer must draw the user's content into exactly those two
 * regions. Earlier revisions used 600×170 + 92×92 — which left 24 columns
 * and 34 rows of unpainted atlas pixels INSIDE the engine's banner sample
 * rect, presenting as visible black borders below and to the right of the
 * banner in-game. Confirmed empirically by a user-uploaded in-game capture
 * (see CHANGELOG.md "Verified — atlas dimension fix").
 *
 * Source files: /tmp/fp-ref3/{ui_bin_*.gfx,attrib_faceplate_*.rgd} — extracted
 * with /tmp/extract-sga.mts from the Ram Ranch workshop mod's SGA archive,
 * which sits under
 *   ~/.steam/steam/steamapps/workshop/content/231430/<workshop_id>/<mod>.sga
 * on this machine.
 */

/** The 32-character lowercase-hex GUID baked into the GFX/RGD templates. */
export const TEMPLATE_GUID = '287efbabb35548d7972924b50a8f5006'

/** The 32-bit pbgid (Little-Endian) that occupies bytes 64-67 of the RGD
 *  template's payload (the unique attribute-instance id). When generating a
 *  new mod we replace these four bytes with a hash of the new GUID. */
export const TEMPLATE_PBGID_LE = 0x883f76be

/** Base64 of the Ram Ranch GFX (8485 bytes). */
const GFX_BASE64 =
  'R0ZYDiUhAACIAAEsAAAAKjAAAB4BACz6AQQAAAAADQAAIDI4N2VmYmFiYjM1NTQ4ZDc5NzI5MjRiNTBhOGY1MDA2AAB//GEAAAAAAAkADQC0AswALk1vZEljb25zXzI4N2VmYmFiYjM1NTQ4ZDc5NzI5MjRiNTBhOGY1MDA2X2ljb24nMjg3ZWZiYWJiMzU1NDhkNzk3MjkyNGI1MGE4ZjUwMDZfSTEudGdhRBEZAAAAfxPKAQAAPHJkZjpSREYgeG1sbnM6cmRmPSdodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjJz48cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0nJyB4bWxuczpkYz0naHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMSc+PGRjOmZvcm1hdD5hcHBsaWNhdGlvbi94LXNob2Nrd2F2ZS1mbGFzaDwvZGM6Zm9ybWF0PjxkYzp0aXRsZT5BZG9iZSBGbGV4IDQgQXBwbGljYXRpb248L2RjOnRpdGxlPjxkYzpkZXNjcmlwdGlvbj5odHRwOi8vd3d3LmFkb2JlLmNvbS9wcm9kdWN0cy9mbGV4PC9kYzpkZXNjcmlwdGlvbj48ZGM6cHVibGlzaGVyPnVua25vd248L2RjOnB1Ymxpc2hlcj48ZGM6Y3JlYXRvcj51bmtub3duPC9kYzpjcmVhdG9yPjxkYzpsYW5ndWFnZT5FTjwvZGM6bGFuZ3VhZ2U+PGRjOmRhdGU+SnVsIDEsIDIwMjI8L2RjOmRhdGU+PC9yZGY6RGVzY3JpcHRpb24+PC9yZGY6UkRGPgBDAgAAAOoKTW9kSWNvbnNfMjg3ZWZiYWJiMzU1NDhkNzk3MjkyNGI1MGE4ZjUwMDYADPwBAAAAcgIAALICQAAM/AIAAAAAAAAAcALMAL8Ush0AAAEAAABmcmFtZTEAEAAuAAIAAAC3AQ1mbGFzaC5kaXNwbGF5DURpc3BsYXlPYmplY3QFU3RhZ2UABlN0cmluZwR2b2lkFkRpc3BsYXlPYmplY3RDb250YWluZXIHQm9vbGVhbgZOdW1iZXIGT2JqZWN0CmZsYXNoLmdlb20JUmVjdGFuZ2xlBUFycmF5CVRyYW5zZm9ybQVQb2ludApMb2FkZXJJbmZvE2ZsYXNoLmFjY2Vzc2liaWxpdHkXQWNjZXNzaWJpbGl0eVByb3BlcnRpZXMKQml0bWFwRGF0YQRhdXRvDGZsYXNoLmV2ZW50cwVFdmVudAZNYXRyaXgITWF0cml4M0QHbXguY29yZQ9JUmVwZWF0ZXJDbGllbnQpTW9kSWNvbnNfMjg3ZWZiYWJiMzU1NDhkNzk3MjkyNGI1MGE4ZjUwMDYJTW92aWVDbGlwCklGbGV4QXNzZXQSSUZsZXhEaXNwbGF5T2JqZWN0D0lCaXRtYXBEcmF3YWJsZRBJRXZlbnREaXNwYXRjaGVyGm14LmNvcmU6SUZsZXhEaXNwbGF5T2JqZWN0BHJvb3QFc3RhZ2UEbmFtZQZwYXJlbnQEbWFzawd2aXNpYmxlAXgBeQZzY2FsZVgGc2NhbGVZBm1vdXNlWAZtb3VzZVkIcm90YXRpb24FYWxwaGEFd2lkdGgGaGVpZ2h0DWNhY2hlQXNCaXRtYXAQb3BhcXVlQmFja2dyb3VuZApzY3JvbGxSZWN0B2ZpbHRlcnMJYmxlbmRNb2RlCXRyYW5zZm9ybQpzY2FsZTlHcmlkDWdsb2JhbFRvTG9jYWwNbG9jYWxUb0dsb2JhbAlnZXRCb3VuZHMHZ2V0UmVjdApsb2FkZXJJbmZvDWhpdFRlc3RPYmplY3QMaGl0VGVzdFBvaW50F2FjY2Vzc2liaWxpdHlQcm9wZXJ0aWVzDm1lYXN1cmVkSGVpZ2h0DW1lYXN1cmVkV2lkdGgEbW92ZQ1zZXRBY3R1YWxTaXplCkZsZXhCaXRtYXAGQml0bWFwEm14LmNvcmU6RmxleEJpdG1hcAh0b1N0cmluZxdJTGF5b3V0RGlyZWN0aW9uRWxlbWVudB9teC5jb3JlOklMYXlvdXREaXJlY3Rpb25FbGVtZW50D2xheW91dERpcmVjdGlvbhlpbnZhbGlkYXRlTGF5b3V0RGlyZWN0aW9uC0JpdG1hcEFzc2V0E214LmNvcmU6Qml0bWFwQXNzZXQTbGF5b3V0RmVhdHVyZXNDbGFzcwVDbGFzcw5sYXlvdXRGZWF0dXJlcxRJQXNzZXRMYXlvdXRGZWF0dXJlcwF6B19oZWlnaHQJcm90YXRpb25YCXJvdGF0aW9uWQlyb3RhdGlvbloGc2NhbGVaEF9sYXlvdXREaXJlY3Rpb24DbHRyDGFkZGVkSGFuZGxlchppbml0QWR2YW5jZWRMYXlvdXRGZWF0dXJlcxd2YWxpZGF0ZVRyYW5zZm9ybU1hdHJpeC5Nb2RJY29uc18yODdlZmJhYmIzNTU0OGQ3OTcyOTI0YjUwYThmNTAwNl9pY29uM01vZEljb25zXzI4N2VmYmFiYjM1NTQ4ZDc5NzI5MjRiNTBhOGY1MDA2X2ZhY2VwbGF0ZQhteC51dGlscwhOYW1lVXRpbBFteC51dGlsczpOYW1lVXRpbBxteC5jb3JlOklBc3NldExheW91dEZlYXR1cmVzB2xheW91dFgHbGF5b3V0WQdsYXlvdXRaC2xheW91dFdpZHRoCnRyYW5zZm9ybVgKdHJhbnNmb3JtWQp0cmFuc2Zvcm1aD2xheW91dFJvdGF0aW9uWA9sYXlvdXRSb3RhdGlvblkPbGF5b3V0Um90YXRpb25aDGxheW91dFNjYWxlWAxsYXlvdXRTY2FsZVkMbGF5b3V0U2NhbGVaDGxheW91dE1hdHJpeA5sYXlvdXRNYXRyaXgzRARpczNECmxheW91dElzM0QGbWlycm9yCHN0cmV0Y2hYCHN0cmV0Y2hZDmNvbXB1dGVkTWF0cml4EGNvbXB1dGVkTWF0cml4M0QXbXguY29yZTpJUmVwZWF0ZXJDbGllbnQPaW5zdGFuY2VJbmRpY2VzCmlzRG9jdW1lbnQPcmVwZWF0ZXJJbmRpY2VzCXJlcGVhdGVycxhpbml0aWFsaXplUmVwZWF0ZXJBcnJheXMJZmFjZXBsYXRlBGljb24qaHR0cDovL3d3dy5hZG9iZS5jb20vMjAwNi9mbGV4L214L2ludGVybmFsB1ZFUlNJT04LNC42LjAuMjMyMDEQRmxleFZlcnNpb25DbGFzcw9NYXRyaXhVdGlsQ2xhc3MHY291bnRlcgNpbnQQY3JlYXRlVW5pcXVlTmFtZRVkaXNwbGF5T2JqZWN0VG9TdHJpbmcXZ2V0VW5xdWFsaWZpZWRDbGFzc05hbWULbXhfaW50ZXJuYWwPRXZlbnREaXNwYXRjaGVyEUludGVyYWN0aXZlT2JqZWN0BlNwcml0ZQVFcnJvcgFlDGZsYXNoLnN5c3RlbRFBcHBsaWNhdGlvbkRvbWFpbg1jdXJyZW50RG9tYWluFG14LmNvcmU6OkZsZXhWZXJzaW9uDWhhc0RlZmlu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'

/** Base64 of the Ram Ranch RGD (497 bytes). */
const RGD_BASE64 =
  'UmVsaWMgQ2h1bmt5DQoaAAMAAAABAAAAJAAAABwAAAABAAAAREFUQUFFR0QBAAAAsQEAAAAAAAD/////AAAAAL52P4ipAQAAAgAAAPcUNpEBAAAAAAAAAN19gPVkAAAABAAAAP///z8GAAAAdl0EB2QAAAAAAAAAUIzPBwMAAACQAAAAGmolLgQAAADEAAAAvgJpdwMAAAAMAQAAK8Eq7gMAAAANAQAAfZyf8wMAAAA8AQAACAAAAAmT3ixkAAAAAAAAACkZ1zcDAAAABAAAAK4P1kkDAAAACgAAAOXX0U4CAAAAGgAAAF9rk1FlAAAAHAAAALMioZUDAAAAIAAAABZTK8cBAAAAJAAAAGS7qMtkAAAAKAAAAAAAAABvdGhlcgBzZXJ2ZXJfaXRlbS5sdWEAAAAAAAAAAAAAAP///z8AAAAATW9kSWNvbnNfMjg3ZWZiYWJiMzU1NDhkNzk3MjkyNGI1MGE4ZjUwMDZfZmFjZXBsYXRlACQAMgA4ADcAZQBmAGIAYQBiAGIAMwA1ADUANAA4AGQANwA5ADcAMgA5ADIANABiADUAMABhADgAZgA1ADAAMAA2ADoAMQAAAABNb2RJY29uc18yODdlZmJhYmIzNTU0OGQ3OTcyOTI0YjUwYThmNTAwNl9pY29uAAA='

/** Decode a base64 string to Uint8Array. Browser + Node-safe. */
function base64ToBytes(b64: string): Uint8Array {
  // atob is present in modern browsers AND Node ≥ 16. We avoid a direct
  // reference to Node's `Buffer` so this file can stay browser-clean with
  // no `@types/node` dependency leaked into the app tsconfig.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  let bin: string
  if (typeof g.atob === 'function') {
    bin = g.atob(b64) as string
  } else if (g.Buffer && typeof g.Buffer.from === 'function') {
    bin = g.Buffer.from(b64, 'base64').toString('binary') as string
  } else {
    throw new Error('No base64 decoder available (atob / Buffer both missing)')
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Lazily-decoded template buffer. The first call to getGfxTemplate() decodes;
 *  subsequent calls return the cached buffer. We clone on read so callers can
 *  mutate without corrupting the cached source. */
let _gfxCache: Uint8Array | null = null
let _rgdCache: Uint8Array | null = null

export function getGfxTemplate(): Uint8Array {
  if (!_gfxCache) _gfxCache = base64ToBytes(GFX_BASE64)
  // Clone so callers can edit in place safely.
  return new Uint8Array(_gfxCache)
}

export function getRgdTemplate(): Uint8Array {
  if (!_rgdCache) _rgdCache = base64ToBytes(RGD_BASE64)
  return new Uint8Array(_rgdCache)
}

/** Fixed packed-atlas dimensions used by the Ram Ranch GFX template (and by
 *  every faceplate mod we've inspected). The engine reads sub-rects from
 *  these coordinates via DefineBitsLossless2 region tags inside the GFX. */
export const ATLAS_WIDTH = 692
export const ATLAS_HEIGHT = 204

/**
 * Visible banner sub-rect inside the atlas (where the wide UI element pulls
 * its pixels from). Independently verified across three reference faceplates
 * by (a) scanning the GFX template binary for (w,h) 16-bit LE pairs and (b)
 * decoding the BC3 alpha planes of the DDS atlases to find the content
 * bounding box. Both methods converge on 624×204 at (0,0).
 *
 * @public — engine-derived geometry; consumed by external tooling (the
 * test-build script + perf bench reference these dims) and may be imported
 * by future faceplate composers. Retained as part of the lib's documented
 * surface even when no current call site uses it.
 */
export const BANNER_RECT = { x: 0, y: 0, width: 624, height: 204 } as const

/** Visible square-icon sub-rect inside the atlas (top-right corner). 64×64
 *  per the Steam guide spec, confirmed by reference-atlas content extents:
 *  icon content in all three reference mods occupies blocks (156-171, 0-15)
 *  in BC3 4×4-block coordinates → pixels (624-688, 0-64). */
export const ICON_RECT = { x: 624, y: 0, width: 64, height: 64 } as const
