/**
 * Unit tests for decal-pack-export.ts
 *
 * Covers the dependency-free ZIP writer (CRC, EOCD, central directory layout)
 * and the project→manifest plumbing. Bitmap rasterisation is not unit-tested
 * here because jsdom doesn't expose a working canvas backend — the rasteriser
 * is exercised indirectly via the editor's grid preview during integration.
 */

import { describe, it, expect } from 'vitest'
import { buildZip, exportDecalPackZip, makeSlug } from '../decal-pack-export'
import { newDecalPackProject, newDecal, freshSourceImageId } from '../decal-pack-project'

describe('makeSlug', () => {
  it('lowercases and replaces non-alphanumerics with underscores', () => {
    expect(makeSlug('Eastern Front Insignia!')).toBe('eastern_front_insignia')
  })
  it('strips leading/trailing underscores', () => {
    expect(makeSlug('  !!! my pack !!!  ')).toBe('my_pack')
  })
  it('caps at 40 chars', () => {
    expect(makeSlug('a'.repeat(80)).length).toBe(40)
  })
})

describe('buildZip', () => {
  it('produces a valid ZIP for a single text entry', () => {
    const bytes = new TextEncoder().encode('hello world')
    const zip = buildZip([{ path: 'hello.txt', bytes }])

    // PK\x03\x04 = local file header signature
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
    expect(zip[2]).toBe(0x03)
    expect(zip[3]).toBe(0x04)

    // EOCD signature appears somewhere near the end
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const eocdOffset = zip.length - 22
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50)
    expect(view.getUint16(eocdOffset + 8, true)).toBe(1) // 1 entry
  })

  it('handles multiple entries and reports correct EOCD count', () => {
    const entries = [
      { path: 'a.txt', bytes: new TextEncoder().encode('a') },
      { path: 'b.txt', bytes: new TextEncoder().encode('bb') },
      { path: 'c.txt', bytes: new TextEncoder().encode('ccc') },
    ]
    const zip = buildZip(entries)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const eocdOffset = zip.length - 22
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50)
    expect(view.getUint16(eocdOffset + 8, true)).toBe(3)
    expect(view.getUint16(eocdOffset + 10, true)).toBe(3)
  })

  it('emits an empty ZIP for zero entries (just EOCD)', () => {
    const zip = buildZip([])
    expect(zip.length).toBe(22)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(view.getUint32(0, true)).toBe(0x06054b50)
    expect(view.getUint16(8, true)).toBe(0)
  })

  it('uses UTF-8 filename flag (bit 11)', () => {
    const zip = buildZip([{ path: 'unicode_テスト.txt', bytes: new Uint8Array(0) }])
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    // Local header general purpose bit flag is at offset 6 of the LFH
    const flags = view.getUint16(6, true)
    expect((flags & 0x0800) !== 0).toBe(true)
  })
})

describe('exportDecalPackZip', () => {
  it('throws when no visible decals exist', async () => {
    const p = newDecalPackProject('Empty Pack')
    await expect(exportDecalPackZip(p)).rejects.toThrow(/No visible decals/i)
  })

  it('throws when all decals are hidden', async () => {
    const p = newDecalPackProject('Hidden Pack')
    const imgId = freshSourceImageId()
    p.sourceImages[imgId] = {
      id: imgId,
      name: 'tiny',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      width: 1,
      height: 1,
    }
    p.decals.push({ ...newDecal(p, imgId), visible: false })
    await expect(exportDecalPackZip(p)).rejects.toThrow(/No visible decals/i)
  })
})
