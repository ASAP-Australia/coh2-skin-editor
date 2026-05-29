/**
 * Regression tests for `decal-mod-build.ts` and the SGA writer's
 * drive-routing logic — specifically the rule that landed when the user
 * reported "decal not appearing in game" and live engine logs revealed:
 *
 *   MOD -- Error loading mod pack '<guid>': <slug>.dds not permitted.
 *   MOD -- Error loading mod pack '...<guid>.sga': invalid file structure.
 *
 * Root cause: the CoH2 mod loader rejects the entire archive when the
 * pack's root-level `.dds` preview texture lives in the wrong SGA drive.
 * SGA archives are split into 4 drives (`attrib`, `locale`, `info`,
 * `data`); the root preview .dds MUST live in drive 2 ("info") alongside
 * `<guid>.info`. If the writer routes it to drive 3 ("data") alongside
 * `art/` and `ui/` assets, the loader silently rejects the SGA.
 *
 * The misleading "not permitted" wording made this initially look like a
 * filename allowlist rule (an earlier fix attempt tried renaming the DDS
 * to strip underscores — that was wrong). Verified against every working
 * subscription in the user's installed Steam decal-mod tree, including:
 *
 *   Pack name                                Root DDS in SGA
 *   ───────────────────────────────────────  ────────────────────────────
 *   "Wikinger Decal Remover"                 wikingerdecalremover.dds   (drive 2)
 *   "Wehrmacht Balkenkreuz"                  balkenkreuz.dds            (drive 2)
 *   "Israel Decal"                           star of david.dds          (drive 2)
 *   "Punisher"                               punisher_cut.dds           (drive 2)  ← underscore!
 *   "British Welsh Dragon"                   decal_british_welshdragonpeview.dds (drive 2)
 *   "Stalin Preview"                         stalinpreview.dds          (drive 2)
 *
 * All filename patterns work (underscores, spaces, mixed). All sizes work
 * (128, 280, 524, 1024). The only invariant is the drive.
 */

import { describe, expect, it } from 'vitest'
import { makeSlug, buildDecalMod, DECAL_ICON_SIZE, DECAL_TEXTURE_SIZE } from '../decal-mod-build'
import { SgaArchive } from '../sga'
import { buildSga } from '../sga-writer'
import { decodeRgt } from '../rgt'
import { parseChunky, findChunk } from '../chunky'

describe('makeSlug — unchanged behaviour, slug uses underscores', () => {
  it('replaces non-alphanumerics with underscores', () => {
    expect(makeSlug('George Droid Decal')).toBe('george_droid_decal')
    expect(makeSlug('Star of David')).toBe('star_of_david')
  })

  it('lowercases the result', () => {
    expect(makeSlug('UPPERCASE PACK')).toBe('uppercase_pack')
  })

  it('caps at 40 characters', () => {
    const long = 'A'.repeat(60) + ' suffix'
    expect(makeSlug(long).length).toBeLessThanOrEqual(40)
  })

  it('trims leading and trailing underscores', () => {
    expect(makeSlug('!!!Pack!!!')).toBe('pack')
  })
})

describe('buildDecalMod — root .dds is routed to the info drive (not data)', () => {
  /**
   * End-to-end regression. We build a real SGA, then parse the on-disk
   * drive layout and assert the root preview .dds lives in drive 2
   * ("info") alongside `<guid>.info`. If it ever drifts back into drive 3
   * ("data"), the engine will silently reject the entire SGA again with
   * "not permitted." in warnings.log — and the file will not appear
   * in-game.
   *
   * The "data" drive is the LAST drive in the standard 4-drive layout, so
   * if the routing breaks again, the test below will catch it because
   * the .dds will sort after the art/ files.
   */
  it('places "<slug>.dds" in the info drive alongside <guid>.info', async () => {
    const project = {
      id: 'dp_test_drive_routing',
      packName: 'George Droid Decal',
      packDescription: '',
      author: 'tester',
      magic: 'coh2-decalpack-project',
      version: 4,
      sourceImages: {},
      decals: [],
    } as unknown as Parameters<typeof buildDecalMod>[0]['project']

    const iconRgba = new Uint8ClampedArray(DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4)
    const result = await buildDecalMod({ project, iconRgba })

    // Round-trip through SgaArchive — the v7 parser exposes file paths
    // grouped by drive, so the listing order reflects the drive layout.
    const blob = new Blob([new Uint8Array(result.sga)])
    const archive = await SgaArchive.open(blob)
    const list = archive.list()

    // The pack's slug derives from `makeSlug(packName)` → underscores OK.
    const expectedDds = `${makeSlug(project.packName)}.dds`
    const ddsEntry = list.find(e => e.path === expectedDds)
    expect(ddsEntry, `expected "${expectedDds}" in the archive`).toBeDefined()

    // Working-pack layout: drive 2 ("info") holds <guid>.info + <slug>.dds,
    // drive 3 ("data") holds art/ + ui/. So in the listing, <slug>.dds
    // must appear BEFORE any art/ or ui/ path.
    const ddsIndex = list.findIndex(e => e.path === expectedDds)
    const firstArtIndex = list.findIndex(e => e.path.startsWith('art/'))
    const firstUiIndex = list.findIndex(e => e.path.startsWith('ui/'))
    expect(ddsIndex).toBeGreaterThanOrEqual(0)
    expect(firstArtIndex).toBeGreaterThanOrEqual(0)
    expect(firstUiIndex).toBeGreaterThanOrEqual(0)
    expect(ddsIndex).toBeLessThan(firstArtIndex)
    expect(ddsIndex).toBeLessThan(firstUiIndex)

    // And it must appear right after <guid>.info (info drive is sorted
    // alphabetically, and "<32-hex-guid>.info" sorts before any
    // letter-prefixed filename).
    const infoIndex = list.findIndex(e => e.path.endsWith('.info'))
    expect(infoIndex).toBeGreaterThanOrEqual(0)
    expect(ddsIndex).toBe(infoIndex + 1)
  })
})

describe('buildSga drive routing — root-level files go to the info drive', () => {
  /**
   * Lower-level regression on the `driveOf` rule in sga-writer.ts. Any
   * file with no `/` in its path must land in drive 2 ("info"), not
   * drive 3 ("data"). This subsumes the previous narrower ".info → drive
   * 2" rule and is consistent with every Workshop pack we surveyed.
   */
  it('routes a root-level .dds to drive 2 by parsing the TOC directly', async () => {
    const sga = await buildSga({
      archiveName: 'test_archive',
      files: [
        { path: 'attrib/vehicle_decal/test.rgd', bytes: new Uint8Array([1, 2, 3]) },
        { path: 'english/english.ucs', bytes: new Uint8Array([4, 5, 6]) },
        { path: 'test_guid.info', bytes: new Uint8Array([7, 8, 9]) },
        { path: 'pack_preview.dds', bytes: new Uint8Array([10, 11, 12]) },
        { path: 'art/test.rgt', bytes: new Uint8Array([13, 14, 15]) },
        { path: 'ui/bin/test.gfx', bytes: new Uint8Array([16, 17, 18]) },
      ],
    })

    // Parse the v7 TOC manually to inspect drive assignment.
    const view = new DataView(sga.buffer, sga.byteOffset, sga.byteLength)
    const headerSize = view.getUint32(140, true)
    const HEADER_POS = 152
    const tocBytes = sga.subarray(HEADER_POS, HEADER_POS + headerSize)
    const toc = new DataView(tocBytes.buffer, tocBytes.byteOffset, tocBytes.byteLength)

    const drivePos = toc.getUint32(0, true)
    const driveCount = toc.getUint32(4, true)
    const filePos = toc.getUint32(16, true)
    const namePos = toc.getUint32(24, true)

    expect(driveCount).toBe(4)

    // Drive 2 ("info") must contain BOTH the .info AND the root .dds.
    const drive2Offset = drivePos + 2 * 148
    const drive2FileFirst = toc.getUint32(drive2Offset + 136, true)
    const drive2FileLast = toc.getUint32(drive2Offset + 140, true)
    expect(drive2FileLast - drive2FileFirst).toBe(2)

    // Decode the names of those two files via the file records (offset 0 = namePos).
    const td = new TextDecoder('utf-8', { fatal: false })
    const readName = (relOff: number): string => {
      const base = namePos + relOff
      let end = base
      while (end < tocBytes.length && tocBytes[end] !== 0) end++
      return td.decode(tocBytes.subarray(base, end))
    }
    const drive2Names: string[] = []
    for (let f = drive2FileFirst; f < drive2FileLast; f++) {
      const fOffset = filePos + f * 30
      const fNamePos = toc.getUint32(fOffset, true)
      drive2Names.push(readName(fNamePos))
    }
    expect(drive2Names).toEqual(expect.arrayContaining(['test_guid.info', 'pack_preview.dds']))

    // Drive 3 ("data") must contain art/ + ui/ files only — NOT the .dds.
    const drive3Offset = drivePos + 3 * 148
    const drive3FileFirst = toc.getUint32(drive3Offset + 136, true)
    const drive3FileLast = toc.getUint32(drive3Offset + 140, true)
    const drive3Names: string[] = []
    for (let f = drive3FileFirst; f < drive3FileLast; f++) {
      const fOffset = filePos + f * 30
      const fNamePos = toc.getUint32(fOffset, true)
      drive3Names.push(readName(fNamePos))
    }
    expect(drive3Names).not.toContain('pack_preview.dds')
  })

  it('accepts underscores in root .dds filenames (engine rule is drive-based, not name-based)', async () => {
    // Real working Workshop packs ship root .dds with underscores
    // (`punisher_cut.dds`, `decal_british_welshdragonpeview.dds`). Our
    // writer must allow the same.
    const sga = await buildSga({
      archiveName: 'test_archive',
      files: [
        { path: 'test_guid.info', bytes: new Uint8Array([1]) },
        { path: 'punisher_cut.dds', bytes: new Uint8Array([2]) },
        { path: 'art/test.rgt', bytes: new Uint8Array([3]) },
      ],
    })

    const archive = await SgaArchive.open(new Blob([new Uint8Array(sga)]))
    const list = archive.list()
    const ddsIndex = list.findIndex(e => e.path === 'punisher_cut.dds')
    const artIndex = list.findIndex(e => e.path.startsWith('art/'))
    expect(ddsIndex).toBeGreaterThanOrEqual(0)
    expect(artIndex).toBeGreaterThanOrEqual(0)
    expect(ddsIndex).toBeLessThan(artIndex) // proves it's in info drive
  })
})

// ─── Helper to extract a named SGA entry's raw bytes ─────────────────────────

async function extractSgaEntry(sgaBytes: Uint8Array, entryPath: string): Promise<Uint8Array> {
  // SgaArchive.open() accepts a File, so wrap the bytes.
  const buf = sgaBytes.buffer.slice(sgaBytes.byteOffset, sgaBytes.byteOffset + sgaBytes.byteLength) as ArrayBuffer
  const file = new File([buf], 'test.sga', { type: 'application/octet-stream' })
  const archive = await SgaArchive.open(file)
  const entry = archive.list().find(e => e.path === entryPath)
  if (!entry) throw new Error(`SGA entry not found: ${entryPath}`)
  // SgaFile has a lazy .read() method — the archive reads from the File slice
  return entry.read()
}

describe('buildDecalMod — per-faction RGT is 1024×1024 DXT1 (vehicle texture fix)', () => {
  /**
   * Regression for the "George Droid" blank-vehicle-decal bug.
   *
   * Root cause: the RGT was built from the 64×64 `iconRgba` buffer.
   * The engine paints `default_dif.rgt` onto the vehicle's badge UV island;
   * a 64×64 BC3 block-compresses into effectively-blank pixels.
   *
   * Fix: use `decalRgba` (1024×1024) when provided; fall back to
   * nearest-neighbour upscale from `iconRgba` when omitted.
   * RGTs are DXT1 (BC1) binary masks — the engine applies faction tint at
   * runtime.
   */

  const stubProject = {
    id: 'dp_rgt_test',
    packName: 'RGT Size Test Pack',
    packDescription: '',
    author: 'tester',
    magic: 'coh2-decalpack-project',
    version: 4,
    sourceImages: {},
    decals: [],
  } as unknown as Parameters<typeof buildDecalMod>[0]['project']

  it('RGT width/height = 1024 and format = DXT1 when decalRgba (1024×1024) is provided', async () => {
    const iconRgba = new Uint8ClampedArray(DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4)
    const decalRgba = new Uint8ClampedArray(DECAL_TEXTURE_SIZE * DECAL_TEXTURE_SIZE * 4)
    // Fill with a non-zero colour so BC1 is non-trivially encoded
    for (let i = 0; i < decalRgba.length; i += 4) {
      decalRgba[i] = 200
      decalRgba[i + 1] = 100
      decalRgba[i + 2] = 50
      decalRgba[i + 3] = 255
    }

    const result = await buildDecalMod({ project: stubProject, iconRgba, decalRgba })

    // Check one faction RGT (aef) — all five share the same canvas path
    const rgtBytes = await extractSgaEntry(result.sga, `art/armies/aef/badges/${result.guid}/default_dif.rgt`)
    const decoded = decodeRgt(rgtBytes)

    expect(decoded.width).toBe(1024)
    expect(decoded.height).toBe(1024)
    expect(decoded.fourCC).toBe('DXT1')
  })

  it('RGT width/height = 1024 even when decalRgba is omitted (fallback upscale path)', async () => {
    // When no decalRgba is supplied, the builder must upscale iconRgba 64→1024.
    // Old behaviour was to bake 64×64 directly — that was the bug.
    const iconRgba = new Uint8ClampedArray(DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4)

    const result = await buildDecalMod({ project: stubProject, iconRgba })

    const rgtBytes = await extractSgaEntry(result.sga, `art/armies/aef/badges/${result.guid}/default_dif.rgt`)
    const decoded = decodeRgt(rgtBytes)

    expect(decoded.width).toBe(1024)
    expect(decoded.height).toBe(1024)
  })

  it('BC1 pixel byte count for a 1024×1024 RGT = 256×256 blocks × 8 bytes = 524288', async () => {
    const iconRgba = new Uint8ClampedArray(DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4)
    const decalRgba = new Uint8ClampedArray(DECAL_TEXTURE_SIZE * DECAL_TEXTURE_SIZE * 4)

    const result = await buildDecalMod({ project: stubProject, iconRgba, decalRgba })

    // All 5 factions must produce 1024×1024 DXT1 RGTs
    for (const faction of ['aef', 'british', 'german', 'soviet', 'west_german']) {
      const rgtBytes = await extractSgaEntry(
        result.sga,
        `art/armies/${faction}/badges/${result.guid}/default_dif.rgt`,
      )
      const decoded = decodeRgt(rgtBytes)
      // 1024/4 = 256 blocks per side → 256×256×8 = 524288 bytes (BC1 = 8 bytes/block)
      expect(decoded.pixels.length).toBe(524288)
    }
  })

  it('TFMT chunk inside the RGT records width=1024, height=1024, format=13 (DXT1)', async () => {
    const iconRgba = new Uint8ClampedArray(DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4)
    const decalRgba = new Uint8ClampedArray(DECAL_TEXTURE_SIZE * DECAL_TEXTURE_SIZE * 4)

    const result = await buildDecalMod({ project: stubProject, iconRgba, decalRgba })

    const rgtBytes = await extractSgaEntry(
      result.sga,
      `art/armies/soviet/badges/${result.guid}/default_dif.rgt`,
    )

    // Parse TFMT directly to verify the width/height/format fields the engine reads
    const { root } = parseChunky(rgtBytes)
    const tfmt = findChunk(root, 'TFMT')
    expect(tfmt).not.toBeNull()
    const v = new DataView(rgtBytes.buffer, rgtBytes.byteOffset)
    const embeddedWidth = v.getUint32(tfmt!.payloadOffset, true)
    const embeddedHeight = v.getUint32(tfmt!.payloadOffset + 4, true)
    const embeddedFormat = v.getUint32(tfmt!.payloadOffset + 16, true)
    expect(embeddedWidth).toBe(1024)
    expect(embeddedHeight).toBe(1024)
    expect(embeddedFormat).toBe(13) // 13 = DXT1 (BC1)
  })

  it('inventory icon DDS remains 64×64 — decalRgba does not affect it', async () => {
    // The decalRgba fix must NOT up-size the inventory thumbnail.
    const iconRgba = new Uint8ClampedArray(DECAL_ICON_SIZE * DECAL_ICON_SIZE * 4)
    const decalRgba = new Uint8ClampedArray(DECAL_TEXTURE_SIZE * DECAL_TEXTURE_SIZE * 4)

    const result = await buildDecalMod({ project: stubProject, iconRgba, decalRgba })

    const ddsBytes = await extractSgaEntry(
      result.sga,
      `ui/assets/textures/${result.guid}_i1.dds`,
    )
    // DDS header: width at offset 16, height at offset 12
    const ddsView = new DataView(ddsBytes.buffer, ddsBytes.byteOffset)
    const ddsHeight = ddsView.getUint32(12, true)
    const ddsWidth = ddsView.getUint32(16, true)
    expect(ddsWidth).toBe(64)
    expect(ddsHeight).toBe(64)
  })
})
