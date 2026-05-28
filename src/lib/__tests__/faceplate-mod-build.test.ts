/**
 * End-to-end test for the faceplate mod builder.
 *
 * Strategy:
 *   1. Build an in-memory faceplate mod from a synthetic project + atlas.
 *   2. Re-parse the generated SGA with `SgaArchive.open` (the same loader the
 *      app's Connect flow uses) and assert every expected file is there with
 *      a plausible byte signature.
 *   3. Spot-check the on-disk layouts of the GFX/RGD/DDS/UCS/.info files —
 *      the bits the CoH2 loader actually inspects.
 *
 * No real game files are touched. The SGA round-trip exercises the same
 * `buildSga` + `SgaArchive` pair used by the rest of the app, which gives us
 * high confidence that what we ship to disk will be readable by the engine.
 */

import { describe, it, expect } from 'vitest'
import { SgaArchive } from '@/lib/sga'
import {
  buildFaceplateMod,
  buildInfoFile,
  buildUcsFile,
  composeDisplayDescription,
  deriveDeterministicPbgid,
  generateGuid,
  makeSlug,
  wrapBc3InDds,
} from '@/lib/faceplate-mod-build'
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  TEMPLATE_GUID,
  TEMPLATE_PBGID_LE,
  getGfxTemplate,
  getRgdTemplate,
} from '@/lib/faceplate-templates'

import { newFaceplateProject } from '@/lib/faceplate-project'

/** Canonical UCS string ids for faceplate name and description, verified
 *  byte-for-byte against three published reference mods (Ram Ranch, Clarkson,
 *  HK416V2). The RGD template's locstring reference is the literal pattern
 *  `e$<guid>:1` for the name (the `:1` suffix is the ucs id) and `:2` for the
 *  description. Earlier revisions of this codebase used pbgid-derived ids,
 *  which broke the engine's locstring lookup. */
const CANONICAL_NAME_ID = 1
const CANONICAL_DESC_ID = 2

// Same MemFile shim used by sga-roundtrip.test.ts — `SgaArchive.open` only
// touches `.slice(start, end).arrayBuffer()`.
class MemFile {
  readonly name: string
  readonly size: number
  private readonly data: Uint8Array
  constructor(data: Uint8Array, name = 'test.sga') {
    this.data = data
    this.name = name
    this.size = data.length
  }
  slice(start: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> } {
    const sliced = this.data.slice(start, end)
    return { arrayBuffer: () => Promise.resolve(sliced.buffer as ArrayBuffer) }
  }
}

/** Make a deterministic 692×204 RGBA gradient atlas — used as a stand-in for
 *  a real composed faceplate image. */
function makeGradientAtlas(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4)
  for (let y = 0; y < ATLAS_HEIGHT; y++) {
    for (let x = 0; x < ATLAS_WIDTH; x++) {
      const i = (y * ATLAS_WIDTH + x) * 4
      out[i] = Math.floor((x / ATLAS_WIDTH) * 255)
      out[i + 1] = Math.floor((y / ATLAS_HEIGHT) * 255)
      out[i + 2] = 128
      out[i + 3] = 255
    }
  }
  return out
}

// ─── Template integrity tests ────────────────────────────────────────────────

describe('faceplate templates', () => {
  it('GFX template decodes to 8485 bytes with the expected magic', () => {
    const gfx = getGfxTemplate()
    expect(gfx.length).toBe(8485)
    // 'GFX' + version byte 0x0e (Scaleform GFX v0e, used by CoH2)
    expect(gfx[0]).toBe(0x47)
    expect(gfx[1]).toBe(0x46)
    expect(gfx[2]).toBe(0x58)
    expect(gfx[3]).toBe(0x0e)
  })

  it('GFX template embeds the template GUID', () => {
    const gfx = getGfxTemplate()
    const text = new TextDecoder('latin1').decode(gfx)
    // The template GUID appears 10 times in the canonical Ram Ranch GFX.
    let count = 0
    let from = 0
    while ((from = text.indexOf(TEMPLATE_GUID, from)) !== -1) {
      count++
      from += TEMPLATE_GUID.length
    }
    expect(count).toBe(10)
  })

  it('RGD template decodes to 497 bytes with Relic Chunky + AEGD chunk', () => {
    const rgd = getRgdTemplate()
    expect(rgd.length).toBe(497)
    const ascii = new TextDecoder('latin1').decode(rgd.subarray(0, 12))
    expect(ascii).toBe('Relic Chunky')
    const chunkHdr = new TextDecoder('latin1').decode(rgd.subarray(36, 44))
    expect(chunkHdr).toBe('DATAAEGD')
  })

  it('RGD template carries the expected pbgid at payload offset 0 (file offset 64)', () => {
    const rgd = getRgdTemplate()
    const view = new DataView(rgd.buffer, rgd.byteOffset, rgd.byteLength)
    expect(view.getUint32(64, true)).toBe(TEMPLATE_PBGID_LE)
  })

  it('RGD template references UCS strings by guid+canonical id, not by uint32 id', () => {
    // Three published reference mods (Ram Ranch, Clarkson, HK416V2) all use
    // UCS ids 1 and 2 for faceplate name and description, referenced from
    // inside the RGD via a UTF-16-LE "e$<guid>:1" / ":2" string. Confirm the
    // RGD template carries that exact pattern — the locstring lookup uses
    // these tiny canonical ids, NOT a uint32 stored directly.
    const rgd = getRgdTemplate()
    // The locstring is in UTF-16-LE inside the RGD. Decode as utf-16le and
    // assert the canonical "e$<guid>:1" substring is present.
    const utf16Text = new TextDecoder('utf-16le').decode(rgd)
    expect(utf16Text).toContain(`e$${TEMPLATE_GUID}:1`)

    // No need to hunt for a uint32 representation of the canonical id —
    // the engine reads it from the locstring suffix, not from a binary field.
    expect(CANONICAL_NAME_ID).toBe(1)
    expect(CANONICAL_DESC_ID).toBe(2)
  })
})

// ─── Pure-function unit tests ────────────────────────────────────────────────

describe('helpers', () => {
  it('generateGuid returns 32 lowercase hex chars', () => {
    for (let i = 0; i < 8; i++) {
      const g = generateGuid()
      expect(g).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('deriveDeterministicPbgid is stable for the same guid', () => {
    const g = 'abcdef0123456789abcdef0123456789'
    const a = deriveDeterministicPbgid(g)
    const b = deriveDeterministicPbgid(g)
    expect(a).toBe(b)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(0x1_0000_0000)
  })

  it('deriveDeterministicPbgid changes with the input', () => {
    const a = deriveDeterministicPbgid('00000000000000000000000000000001')
    const b = deriveDeterministicPbgid('00000000000000000000000000000002')
    expect(a).not.toBe(b)
  })

  it('makeSlug strips punctuation, spaces, casing', () => {
    expect(makeSlug('My Custom Faceplate!')).toBe('my_custom_faceplate')
    expect(makeSlug('   Wehrmacht  V2   ')).toBe('wehrmacht_v2')
    expect(makeSlug('💀 emoji-name')).toBe('emoji_name')
    expect(makeSlug('')).toBe('')
  })

  it('buildUcsFile emits UTF-16-LE with BOM and CRLF lines', () => {
    const bytes = buildUcsFile([
      { id: 1234, text: 'Hello' },
      { id: 5678, text: 'World' },
    ])
    // BOM 0xFF 0xFE then UTF-16-LE
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xfe)
    const text = new TextDecoder('utf-16le').decode(bytes.subarray(2))
    expect(text).toBe('1234\tHello\r\n5678\tWorld\r\n')
  })

  it('buildInfoFile matches the canonical reference format byte-for-byte', () => {
    const project = newFaceplateProject('Demo Faceplate')
    project.packDescription = 'Lorem "ipsum" dolor'
    const bytes = buildInfoFile(project, 'aabbccddeeff00112233445566778899')
    const text = new TextDecoder('ascii').decode(bytes)
    // The Relic .info parser expects the four canonical fields in this exact
    // order, with `dependencies = ` ending in a trailing space and the
    // brace block on its own two lines. Confirmed across Ram Ranch,
    // Clarkson and HK416V2 reference mods.
    expect(text).toBe(
      'hidden = false\r\n' +
        'name = "Demo Faceplate"\r\n' +
        'description = "Lorem \\"ipsum\\" dolor"\r\n' +
        'dependencies = \r\n' +
        '{\r\n' +
        '}\r\n',
    )
  })

  it('buildInfoFile escapes embedded quotes losslessly (matches HK416V2 reference)', () => {
    // The HK416V2 reference mod's name field is `Girls Frontline Faceplate
    // V2 \"HK416\"` — quotes are escaped with a backslash, not stripped.
    // Earlier revisions substituted single quotes, which is lossy.
    const project = newFaceplateProject('Faceplate "v3"')
    const bytes = buildInfoFile(project, 'a'.repeat(32))
    const text = new TextDecoder('ascii').decode(bytes)
    expect(text).toContain('name = "Faceplate \\"v3\\""')
  })

  it('buildInfoFile handles empty description like the HK416V2 reference', () => {
    // HK416V2's .info contains `description = ""` (empty string, not omitted).
    const project = newFaceplateProject('Empty Desc')
    project.packDescription = ''
    const bytes = buildInfoFile(project, 'a'.repeat(32))
    const text = new TextDecoder('ascii').decode(bytes)
    expect(text).toContain('description = ""')
  })

  it('wrapBc3InDds emits a valid 128-byte DDS header followed by the payload', () => {
    const payload = new Uint8Array(141168) // 692×204 BC3 main level
    const dds = wrapBc3InDds(payload, ATLAS_WIDTH, ATLAS_HEIGHT)
    expect(dds.length).toBe(128 + payload.length)
    // 'DDS '
    expect(String.fromCharCode(dds[0], dds[1], dds[2], dds[3])).toBe('DDS ')
    const view = new DataView(dds.buffer)
    expect(view.getUint32(4, true)).toBe(124)
    // height/width
    expect(view.getUint32(12, true)).toBe(ATLAS_HEIGHT)
    expect(view.getUint32(16, true)).toBe(ATLAS_WIDTH)
    // pixel format FOURCC = 'DXT5'
    expect(String.fromCharCode(dds[84], dds[85], dds[86], dds[87])).toBe('DXT5')
    // mipMapCount = 0
    expect(view.getUint32(28, true)).toBe(0)
  })
})

// ─── End-to-end build + SGA round-trip ───────────────────────────────────────

describe('buildFaceplateMod', () => {
  it('produces an SGA that re-parses cleanly with all 5 files present', async () => {
    const project = newFaceplateProject('Test Pack')
    project.packDescription = 'Round-trip test'
    project.author = 'Vitest'

    const guid = 'deadbeefcafef00d12345678aabbccdd'
    const result = await buildFaceplateMod({
      project,
      atlasRgba: makeGradientAtlas(),
      guid,
    })

    expect(result.guid).toBe(guid)
    expect(result.slug).toBe('test_pack')
    expect(result.sgaFilename).toBe(`${guid}.sga`)
    expect(result.pbgid).toBe(deriveDeterministicPbgid(guid))
    expect(result.dds.length).toBe(128 + 141168) // header + 692×204 BC3 payload

    // Re-open the SGA via the same loader the app uses.
    const file = new MemFile(result.sga, result.sgaFilename) as unknown as File
    const archive = await SgaArchive.open(file)
    const paths = archive.listPaths().sort()

    expect(paths).toEqual(
      [
        `${guid}.info`,
        `attrib/faceplate/test_pack_faceplate.rgd`,
        `english/english.ucs`,
        `ui/assets/textures/${guid}_i1.dds`,
        `ui/bin/${guid}.gfx`,
      ].sort(),
    )

    // Spot-check each file's first few bytes after extraction.
    const gfx = await archive.readByPath(`ui/bin/${guid}.gfx`)
    expect(gfx).not.toBeNull()
    expect(gfx!.length).toBe(8485)
    expect(String.fromCharCode(gfx![0], gfx![1], gfx![2])).toBe('GFX')

    const rgd = await archive.readByPath(`attrib/faceplate/test_pack_faceplate.rgd`)
    expect(rgd).not.toBeNull()
    expect(rgd!.length).toBe(497)
    expect(new TextDecoder('latin1').decode(rgd!.subarray(0, 12))).toBe('Relic Chunky')

    // The patched RGD must carry our new pbgid at offset 64 (not the template's).
    const rgdView = new DataView(rgd!.buffer, rgd!.byteOffset, rgd!.byteLength)
    expect(rgdView.getUint32(64, true)).toBe(result.pbgid)

    // GUID substitution: original template GUID must be GONE, new GUID must be present.
    const rgdText = new TextDecoder('latin1').decode(rgd!)
    expect(rgdText.indexOf(TEMPLATE_GUID)).toBe(-1)
    expect(rgdText.indexOf(guid)).toBeGreaterThanOrEqual(0)

    const dds = await archive.readByPath(`ui/assets/textures/${guid}_i1.dds`)
    expect(dds).not.toBeNull()
    expect(dds!.length).toBe(128 + 141168)
    expect(String.fromCharCode(dds![0], dds![1], dds![2], dds![3])).toBe('DDS ')

    const ucs = await archive.readByPath(`english/english.ucs`)
    expect(ucs).not.toBeNull()
    expect(ucs![0]).toBe(0xff)
    expect(ucs![1]).toBe(0xfe)
    const ucsText = new TextDecoder('utf-16le').decode(ucs!.subarray(2))
    expect(ucsText).toContain('Test Pack')

    const info = await archive.readByPath(`${guid}.info`)
    expect(info).not.toBeNull()
    const infoText = new TextDecoder('ascii').decode(info!)
    expect(infoText).toContain('name = "Test Pack"')
  })

  it('rejects atlases that are not 692×204', async () => {
    const project = newFaceplateProject('Wrong Size')
    await expect(
      buildFaceplateMod({
        project,
        atlasRgba: new Uint8ClampedArray(100 * 100 * 4),
        guid: 'a'.repeat(32),
      }),
    ).rejects.toThrow(/Atlas RGBA buffer/)
  })

  it('rejects malformed GUIDs', async () => {
    const project = newFaceplateProject('Bad Guid')
    await expect(
      buildFaceplateMod({
        project,
        atlasRgba: makeGradientAtlas(),
        guid: 'not-a-real-guid',
      }),
    ).rejects.toThrow(/32 lowercase hex/)
  })

  it('strips the original template GUID from the GFX completely', async () => {
    const project = newFaceplateProject('No Leak')
    const result = await buildFaceplateMod({
      project,
      atlasRgba: makeGradientAtlas(),
      guid: '11111111111111112222222222222222',
    })
    const file = new MemFile(result.sga) as unknown as File
    const archive = await SgaArchive.open(file)
    const gfx = await archive.readByPath(`ui/bin/${result.guid}.gfx`)
    expect(gfx).not.toBeNull()
    const text = new TextDecoder('latin1').decode(gfx!)
    expect(text.indexOf(TEMPLATE_GUID)).toBe(-1)
  })

  it('UCS file uses canonical ids 1/2 keyed to RGD locstring references', async () => {
    // Three published reference mods (Ram Ranch, Clarkson, HK416V2) all use
    // canonical UCS ids `1` (name) and `2` (description), referenced from
    // the RGD via the UTF-16-LE pattern `e$<guid>:1`. This test pins that
    // contract so a future refactor cannot accidentally regress to
    // pbgid-derived ids — which would silently break the engine's locstring
    // lookup and ship faceplates that show "STRING_NOT_FOUND" in-game.
    const testGuid = 'cafebabe00001111aaaa2222bbbb3333'
    const project = newFaceplateProject('My Workshop Faceplate')
    project.packDescription = 'Custom description here.'

    const result = await buildFaceplateMod({
      project,
      atlasRgba: makeGradientAtlas(),
      guid: testGuid,
    })

    // ── 1. RGD carries the new pbgid at file offset 64 ────────────────────────
    const file = new MemFile(result.sga, result.sgaFilename) as unknown as File
    const archive = await SgaArchive.open(file)
    const rgd = await archive.readByPath(`attrib/faceplate/my_workshop_faceplate_faceplate.rgd`)
    expect(rgd).not.toBeNull()
    const rgdView = new DataView(rgd!.buffer, rgd!.byteOffset, rgd!.byteLength)
    expect(rgdView.getUint32(64, true)).toBe(deriveDeterministicPbgid(testGuid))
    expect(rgdView.getUint32(64, true)).not.toBe(TEMPLATE_PBGID_LE)

    // ── 2. RGD's UTF-16-LE locstring reference uses the new guid + canonical id `1` ──
    const rgdUtf16 = new TextDecoder('utf-16le').decode(rgd!)
    expect(rgdUtf16).toContain(`e$${testGuid}:1`)
    // Template guid must be gone.
    expect(rgdUtf16).not.toContain(`e$${TEMPLATE_GUID}:1`)

    // ── 3. UCS file carries entries with canonical ids 1 (name) and 2 (desc) ──
    const ucs = await archive.readByPath('english/english.ucs')
    expect(ucs).not.toBeNull()
    expect(ucs![0]).toBe(0xff)
    expect(ucs![1]).toBe(0xfe)
    const ucsText = new TextDecoder('utf-16le').decode(ucs!.subarray(2))
    expect(ucsText).toContain(`${CANONICAL_NAME_ID}\tMy Workshop Faceplate`)
    expect(ucsText).toContain(`${CANONICAL_DESC_ID}\tCustom description here.`)
    // No huge pbgid-derived ids should appear — earlier broken revisions
    // emitted ids in the 2-billion range here.
    expect(ucsText).not.toMatch(/^\d{6,}\t/m)
  })

  it('UCS file omits the description entry when description is empty (HK416V2 parity)', async () => {
    // HK416V2's reference .ucs contains only the name line — its description
    // is the empty string and the id=2 line is omitted entirely. We mirror
    // that behaviour so a project with no description doesn't emit a stray
    // empty UCS line that some Relic tooling complains about.
    const project = newFaceplateProject('Bare Faceplate')
    project.packDescription = ''
    const result = await buildFaceplateMod({
      project,
      atlasRgba: makeGradientAtlas(),
      guid: 'fafafafafafafafafafafafafafafafa',
    })
    const file = new MemFile(result.sga, result.sgaFilename) as unknown as File
    const archive = await SgaArchive.open(file)
    const ucs = await archive.readByPath('english/english.ucs')
    expect(ucs).not.toBeNull()
    const ucsText = new TextDecoder('utf-16le').decode(ucs!.subarray(2))
    expect(ucsText).toContain('1\tBare Faceplate\r\n')
    // No "2\t" line of any kind — the entire id=2 entry must be omitted.
    expect(ucsText).not.toMatch(/^2\t/m)
  })
})

// Author tagging was deliberately removed from the export pipeline:
// the user requested that the exported description must be exactly what
// they typed, with NO "— by {author}" suffix appended. `composeDisplayDescription`
// is retained as a deprecated passthrough for out-of-tree callers; these
// tests lock in that passthrough behaviour and the surrounding export
// guarantee that english.ucs id=2 never carries an author credit.
describe('composeDisplayDescription (deprecated passthrough)', () => {
  it('returns description verbatim regardless of the author argument', () => {
    expect(composeDisplayDescription('Hello world', '')).toBe('Hello world')
    expect(composeDisplayDescription('Hello world', 'Anonymous')).toBe('Hello world')
    expect(composeDisplayDescription('Hello world', 'Joep')).toBe('Hello world')
    expect(composeDisplayDescription('Hello world', '  Irene  ')).toBe('Hello world')
  })

  it('returns the empty string verbatim when description is empty', () => {
    expect(composeDisplayDescription('', '')).toBe('')
    expect(composeDisplayDescription('', 'Joep')).toBe('')
  })
})

// Integration: confirm the exported english.ucs id=2 carries exactly
// what the user typed in `packDescription`, and that the `author` field
// never leaks into the in-game customisation tooltip text.
describe('faceplate export ships description verbatim (no author tag)', () => {
  it('writes id=2 = packDescription, unchanged, even with a non-empty author', async () => {
    const project = newFaceplateProject('Authored Faceplate')
    project.packDescription = 'A pack with a real author'
    project.author = 'Joep'
    const result = await buildFaceplateMod({
      project,
      atlasRgba: makeGradientAtlas(),
      guid: 'fafafafafafafafafafafafafafafafa',
    })
    const file = new MemFile(result.sga, result.sgaFilename) as unknown as File
    const archive = await SgaArchive.open(file)
    const ucs = await archive.readByPath('english/english.ucs')
    expect(ucs).not.toBeNull()
    const ucsText = new TextDecoder('utf-16le').decode(ucs!.subarray(2))
    expect(ucsText).toContain('2\tA pack with a real author\r\n')
    // The author must NOT be tagged onto the description in any case.
    expect(ucsText).not.toContain('— by')
    expect(ucsText).not.toContain('Joep')
  })

  it('omits the description entirely when packDescription is empty, regardless of author', async () => {
    const project = newFaceplateProject('Empty Description Faceplate')
    project.packDescription = ''
    project.author = 'Joep'
    const result = await buildFaceplateMod({
      project,
      atlasRgba: makeGradientAtlas(),
      guid: 'fafafafafafafafafafafafafafafafa',
    })
    const file = new MemFile(result.sga, result.sgaFilename) as unknown as File
    const archive = await SgaArchive.open(file)
    const ucs = await archive.readByPath('english/english.ucs')
    expect(ucs).not.toBeNull()
    const ucsText = new TextDecoder('utf-16le').decode(ucs!.subarray(2))
    // No id=2 line at all when description is empty.
    expect(ucsText).not.toMatch(/^2\t/m)
    expect(ucsText).not.toContain('— by')
    expect(ucsText).not.toContain('Joep')
  })
})
