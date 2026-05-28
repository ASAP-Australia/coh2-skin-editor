/**
 * Tests for faceplate-templates — the bundled Ram-Ranch GFX/RGD
 * byte buffers that every user-generated faceplate mod is derived
 * from (via GUID substitution + atlas re-paint).
 *
 * Why these are templates instead of writers: see the long header in
 * `faceplate-templates.ts`. The summary is that re-emitting the
 * Scaleform-GFX format byte-perfectly would require shipping an
 * ABC/AVM2 encoder; substituting the 32-hex GUID in the reference
 * mod's GFX is byte-equivalent and orders of magnitude smaller.
 *
 * Contract pinned here:
 *
 *  GUID + pbgid constants
 *  - `TEMPLATE_GUID` is exactly 32 lowercase-hex characters.
 *  - `TEMPLATE_PBGID_LE` is the little-endian 32-bit unsigned int
 *    `0x883f76be`. Stored as a JS number, not a BigInt, because the
 *    consumer (`faceplate-mod-build`) splices it into the RGD with
 *    DataView.setUint32(offset, value, true) — little-endian.
 *
 *  Atlas geometry
 *  - `ATLAS_WIDTH` × `ATLAS_HEIGHT` = 692 × 204.
 *  - `BANNER_RECT` covers (0,0)→(624,204) — the engine's full-width
 *    banner sample rect.
 *  - `ICON_RECT` covers (624,0)→(688,64) — the 64×64 thumbnail
 *    sub-rect.
 *  - The two sub-rects together never overflow the atlas; the
 *    remaining 4 px of right padding + 140 px of bottom-right padding
 *    are dead space the engine never samples.
 *  - The banner's right edge equals the icon's left edge (no overlap,
 *    no gap) — a regression here would put visible black between
 *    the two regions in-game.
 *
 *  Template buffers
 *  - `getGfxTemplate()` returns a `Uint8Array` of the expected size
 *    (8485 bytes, per the file header comment).
 *  - `getRgdTemplate()` returns a `Uint8Array` of the expected size
 *    (497 bytes).
 *  - GFX starts with the four-byte magic `47 46 58 0E` (`"GFX\x0e"`).
 *  - RGD starts with the Relic Chunky magic `"Relic Chunky\r\n\x1a\0"`.
 *  - Both templates embed the template GUID literally — the splice
 *    pass in `faceplate-mod-build.ts` replaces these occurrences with
 *    the user's new GUID.
 *
 *  Clone-on-read
 *  - Successive calls return DIFFERENT `Uint8Array` instances. The
 *    underlying cache is mutated only by the first call; callers can
 *    splice the returned buffer in place without corrupting the
 *    template for any other caller.
 *  - Mutating the returned buffer does not bleed into a subsequent
 *    call — the next call produces a fresh, pristine copy.
 *
 *  Pure module, no DOM / no jsdom shims needed.
 */

import { describe, it, expect } from 'vitest'
import {
  TEMPLATE_GUID,
  TEMPLATE_PBGID_LE,
  ATLAS_WIDTH,
  ATLAS_HEIGHT,
  BANNER_RECT,
  ICON_RECT,
  getGfxTemplate,
  getRgdTemplate,
} from '../faceplate-templates'

const RAM_RANCH_GUID = '287efbabb35548d7972924b50a8f5006'

// ── GUID + pbgid constants ──────────────────────────────────────────────

describe('faceplate-templates — TEMPLATE_GUID', () => {
  it('is exactly 32 characters long', () => {
    expect(TEMPLATE_GUID.length).toBe(32)
  })

  it('contains only lowercase hex characters', () => {
    expect(TEMPLATE_GUID).toMatch(/^[0-9a-f]{32}$/)
  })

  it('matches the Ram-Ranch reference workshop ID', () => {
    expect(TEMPLATE_GUID).toBe(RAM_RANCH_GUID)
  })
})

describe('faceplate-templates — TEMPLATE_PBGID_LE', () => {
  it('is the little-endian 32-bit unsigned int 0x883f76be', () => {
    expect(TEMPLATE_PBGID_LE).toBe(0x883f76be)
  })

  it('fits in 32 unsigned bits (a JS number, not a BigInt)', () => {
    expect(typeof TEMPLATE_PBGID_LE).toBe('number')
    expect(TEMPLATE_PBGID_LE).toBeGreaterThanOrEqual(0)
    expect(TEMPLATE_PBGID_LE).toBeLessThanOrEqual(0xffffffff)
  })
})

// ── Atlas geometry ──────────────────────────────────────────────────────

describe('faceplate-templates — atlas geometry', () => {
  it('atlas dimensions are 692 × 204', () => {
    expect(ATLAS_WIDTH).toBe(692)
    expect(ATLAS_HEIGHT).toBe(204)
  })

  it('banner rect covers (0,0)→(624,204)', () => {
    expect(BANNER_RECT.x).toBe(0)
    expect(BANNER_RECT.y).toBe(0)
    expect(BANNER_RECT.width).toBe(624)
    expect(BANNER_RECT.height).toBe(204)
  })

  it('icon rect covers (624,0)→(688,64)', () => {
    expect(ICON_RECT.x).toBe(624)
    expect(ICON_RECT.y).toBe(0)
    expect(ICON_RECT.width).toBe(64)
    expect(ICON_RECT.height).toBe(64)
  })

  it('banner right edge equals icon left edge (no overlap, no gap)', () => {
    expect(BANNER_RECT.x + BANNER_RECT.width).toBe(ICON_RECT.x)
  })

  it('banner fits inside the atlas vertically (no overflow)', () => {
    expect(BANNER_RECT.y + BANNER_RECT.height).toBeLessThanOrEqual(ATLAS_HEIGHT)
  })

  it('icon fits inside the atlas horizontally (no overflow)', () => {
    expect(ICON_RECT.x + ICON_RECT.width).toBeLessThanOrEqual(ATLAS_WIDTH)
  })

  it('the 4-px right-padding strip is dead space (atlas wider than icon edge)', () => {
    expect(ATLAS_WIDTH - (ICON_RECT.x + ICON_RECT.width)).toBe(4)
  })

  it('the 140-px bottom-right padding strip is dead space (atlas taller than icon)', () => {
    expect(ATLAS_HEIGHT - (ICON_RECT.y + ICON_RECT.height)).toBe(140)
  })
})

// ── Template buffer surfaces ────────────────────────────────────────────

describe('faceplate-templates — getGfxTemplate()', () => {
  it('returns a Uint8Array of the expected size (8485 bytes)', () => {
    const gfx = getGfxTemplate()
    expect(gfx).toBeInstanceOf(Uint8Array)
    expect(gfx.byteLength).toBe(8485)
  })

  it('starts with the GFX magic bytes "GFX\\x0e"', () => {
    const gfx = getGfxTemplate()
    expect(gfx[0]).toBe(0x47) // 'G'
    expect(gfx[1]).toBe(0x46) // 'F'
    expect(gfx[2]).toBe(0x58) // 'X'
    expect(gfx[3]).toBe(0x0e) // version
  })

  it('embeds the literal template GUID as ASCII inside the buffer', () => {
    const gfx = getGfxTemplate()
    const asAscii = new TextDecoder('latin1').decode(gfx)
    expect(asAscii).toContain(TEMPLATE_GUID)
  })
})

describe('faceplate-templates — getRgdTemplate()', () => {
  it('returns a Uint8Array of the expected size (497 bytes)', () => {
    const rgd = getRgdTemplate()
    expect(rgd).toBeInstanceOf(Uint8Array)
    expect(rgd.byteLength).toBe(497)
  })

  it('starts with the Relic Chunky magic "Relic Chunky\\r\\n\\x1a\\0"', () => {
    const rgd = getRgdTemplate()
    const head = new TextDecoder('latin1').decode(rgd.slice(0, 16))
    expect(head).toBe('Relic Chunky\r\n\x1a\0')
  })

  it('embeds the literal template GUID as ASCII inside the buffer', () => {
    const rgd = getRgdTemplate()
    const asAscii = new TextDecoder('latin1').decode(rgd)
    expect(asAscii).toContain(TEMPLATE_GUID)
  })

  it('also embeds the GUID as UTF-16-LE inside the buffer (the store_item reference)', () => {
    const rgd = getRgdTemplate()
    // UTF-16-LE encodes each ASCII char as <byte, 0x00>. Build the
    // expected byte sequence and scan for it.
    const utf16 = new Uint8Array(TEMPLATE_GUID.length * 2)
    for (let i = 0; i < TEMPLATE_GUID.length; i++) {
      utf16[i * 2] = TEMPLATE_GUID.charCodeAt(i)
      utf16[i * 2 + 1] = 0
    }
    // Naive substring search — small N.
    let found = false
    outer: for (let i = 0; i + utf16.length <= rgd.length; i++) {
      for (let j = 0; j < utf16.length; j++) {
        if (rgd[i + j] !== utf16[j]) continue outer
      }
      found = true
      break
    }
    expect(found).toBe(true)
  })
})

// ── Clone-on-read ────────────────────────────────────────────────────────

describe('faceplate-templates — clone-on-read', () => {
  it('getGfxTemplate() returns a different Uint8Array instance each call', () => {
    const a = getGfxTemplate()
    const b = getGfxTemplate()
    expect(a).not.toBe(b)
    // Byte content identical though.
    expect(a.byteLength).toBe(b.byteLength)
    expect(a[0]).toBe(b[0])
    expect(a[a.byteLength - 1]).toBe(b[b.byteLength - 1])
  })

  it('mutating the buffer returned from getGfxTemplate() does not bleed into the next call', () => {
    const first = getGfxTemplate()
    const originalByte = first[100]
    first[100] = originalByte ^ 0xff
    const second = getGfxTemplate()
    expect(second[100]).toBe(originalByte)
  })

  it('getRgdTemplate() returns a different Uint8Array instance each call', () => {
    const a = getRgdTemplate()
    const b = getRgdTemplate()
    expect(a).not.toBe(b)
    expect(a.byteLength).toBe(b.byteLength)
  })

  it('mutating the buffer returned from getRgdTemplate() does not bleed into the next call', () => {
    const first = getRgdTemplate()
    const originalByte = first[50]
    first[50] = originalByte ^ 0xff
    const second = getRgdTemplate()
    expect(second[50]).toBe(originalByte)
  })
})
