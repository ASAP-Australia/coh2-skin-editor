/**
 * Tests for `classifyTextureFormat` — the CoH2 TFMT format-code → BC variant
 * + sRGB-flag mapping. Reference: corsix/coh2-explorer `texture_loader.cpp`
 * lines 73–101 (full enum copied into rgt.ts module docstring).
 *
 * We don't test the full `decodeRgt` end-to-end here — it requires a real
 * chunky binary fixture — but the classifier is pure and table-driven, so
 * an exhaustive table test catches any future regressions in the code
 * mapping without needing fixture data.
 */

import { describe, it, expect } from 'vitest'
import { classifyTextureFormat } from '../rgt'

describe('classifyTextureFormat', () => {
  describe('known linear codes', () => {
    it('code 13 → BC1 linear (DXT1, not sRGB)', () => {
      expect(classifyTextureFormat(13)).toEqual({ fourCC: 'DXT1', isSRGB: false })
    })

    it('code 15 → BC3 linear (DXT5, not sRGB)', () => {
      expect(classifyTextureFormat(15)).toEqual({ fourCC: 'DXT5', isSRGB: false })
    })
  })

  describe('known sRGB codes', () => {
    it('code 22 → BC1 sRGB (DXT1, sRGB)', () => {
      expect(classifyTextureFormat(22)).toEqual({ fourCC: 'DXT1', isSRGB: true })
    })

    it('code 24 → BC3 sRGB (DXT5, sRGB)', () => {
      expect(classifyTextureFormat(24)).toEqual({ fourCC: 'DXT5', isSRGB: true })
    })
  })

  describe('unsupported codes return null (fall through to byte-count inference)', () => {
    // BC2 (DXT3) — never used by CoH2 for vehicle skins; uncommon enough
    // to not warrant a decoder.
    it('code 14 (BC2 linear) → null', () => {
      expect(classifyTextureFormat(14)).toBeNull()
    })
    it('code 23 (BC2 sRGB) → null', () => {
      expect(classifyTextureFormat(23)).toBeNull()
    })
    // BC7 (DXT7) — CoH2 DE may use this; we don't have a decoder yet.
    it('code 16 (BC7 linear) → null', () => {
      expect(classifyTextureFormat(16)).toBeNull()
    })
    it('code 25 (BC7 sRGB) → null', () => {
      expect(classifyTextureFormat(25)).toBeNull()
    })
    // Non-block-compressed codes from the same enum — should all fall through.
    it.each([0, 1, 2, 4, 5, 12, 17, 18, 19, 20, 21, 26])(
      'code %i (uncompressed/special) → null',
      code => {
        expect(classifyTextureFormat(code)).toBeNull()
      },
    )
  })

  describe('out-of-range codes', () => {
    it('negative codes → null', () => {
      expect(classifyTextureFormat(-1)).toBeNull()
    })
    it('large codes → null', () => {
      expect(classifyTextureFormat(9999)).toBeNull()
      expect(classifyTextureFormat(0xffffffff)).toBeNull()
    })
    it('non-integer codes still resolve via switch (NaN → null)', () => {
      // The switch uses strict equality; NaN never equals anything.
      expect(classifyTextureFormat(Number.NaN)).toBeNull()
    })
  })

  describe('sRGB / linear pairing invariant', () => {
    // For every supported BC variant, the sRGB and linear codes must
    // decode to the same fourCC — they share the decoder, only the
    // colour-space annotation differs.
    it('codes 13 (linear) and 22 (sRGB) both decode as DXT1', () => {
      const a = classifyTextureFormat(13)
      const b = classifyTextureFormat(22)
      expect(a?.fourCC).toBe('DXT1')
      expect(b?.fourCC).toBe('DXT1')
      expect(a?.isSRGB).toBe(false)
      expect(b?.isSRGB).toBe(true)
    })

    it('codes 15 (linear) and 24 (sRGB) both decode as DXT5', () => {
      const a = classifyTextureFormat(15)
      const b = classifyTextureFormat(24)
      expect(a?.fourCC).toBe('DXT5')
      expect(b?.fourCC).toBe('DXT5')
      expect(a?.isSRGB).toBe(false)
      expect(b?.isSRGB).toBe(true)
    })
  })
})
