/**
 * Unit tests for faceplate-project.ts
 *
 * jsdom environment is active (see vitest.config.ts), so Blob/File/localStorage
 * are all available.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FACEPLATE_BANNER_W,
  FACEPLATE_BANNER_H,
  newFaceplateProject,
  freshLayerId,
  freshImageId,
  loadFaceplateById,
  loadActiveFaceplate,
  persistFaceplate,
  getRecentFaceplates,
  listAllFaceplates,
  updateRecentFaceplateThumbnail,
  readFaceplateFile,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  newPaintLayer,
  newGroupLayer,
  type Coh2FaceplateProject,
  type FaceplateImage,
  type ImageLayer,
  type ShapeLayer,
  type TextLayer,
  type PaintLayer,
  type GroupLayer,
  type BlendMode,
  type LayerMask,
  type GradientFill,
  BLEND_MODES,
  IMAGE_LAYER_FILTER_DEFAULTS,
} from '../faceplate-project'

// ─── Constants ────────────────────────────────────────────────────────────────

describe('FACEPLATE_BANNER_W / FACEPLATE_BANNER_H', () => {
  // These constants must match the engine's actual banner display rect
  // verified across three published reference faceplates. Earlier (≤ v1)
  // releases used 600×170 — that left visible black borders below and to
  // the right of the banner in-game.
  it('banner width is 624 (engine display rect)', () => {
    expect(FACEPLATE_BANNER_W).toBe(624)
  })
  it('banner height is 204 (engine display rect)', () => {
    expect(FACEPLATE_BANNER_H).toBe(204)
  })
})

// ─── newFaceplateProject ──────────────────────────────────────────────────────

describe('newFaceplateProject', () => {
  it('sets magic to "coh2-faceplate-project"', () => {
    const p = newFaceplateProject()
    expect(p.magic).toBe('coh2-faceplate-project')
  })

  it('sets version to 7 (current schema)', () => {
    const p = newFaceplateProject()
    expect(p.version).toBe(7)
  })

  it('uses the provided packName', () => {
    const p = newFaceplateProject('My Cool Faceplate')
    expect(p.packName).toBe('My Cool Faceplate')
  })

  it('defaults packName to "My Faceplate"', () => {
    const p = newFaceplateProject()
    expect(p.packName).toBe('My Faceplate')
  })

  it('generates an id with fp_ prefix', () => {
    const p = newFaceplateProject()
    expect(p.id).toMatch(/^fp_[a-z0-9]+$/)
  })

  it('generates unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newFaceplateProject().id))
    expect(ids.size).toBe(20)
  })

  it('sets author to "Anonymous"', () => {
    const p = newFaceplateProject()
    expect(p.author).toBe('Anonymous')
  })

  it('sets backgroundColor to null', () => {
    const p = newFaceplateProject()
    expect(p.backgroundColor).toBeNull()
  })

  it('starts with empty images record', () => {
    const p = newFaceplateProject()
    expect(Object.keys(p.images)).toHaveLength(0)
  })

  it('starts with empty layers array', () => {
    const p = newFaceplateProject()
    expect(p.layers).toEqual([])
  })

  it('sets modifiedAt to a valid ISO string close to now', () => {
    const before = Date.now()
    const p = newFaceplateProject()
    const after = Date.now()
    const ts = new Date(p.modifiedAt).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('sets a packDescription string', () => {
    const p = newFaceplateProject()
    expect(typeof p.packDescription).toBe('string')
    expect(p.packDescription.length).toBeGreaterThan(0)
  })
})

// ─── freshLayerId / freshImageId ─────────────────────────────────────────────

describe('freshLayerId', () => {
  it('produces ids starting with "layer_"', () => {
    expect(freshLayerId()).toMatch(/^layer_[a-z0-9]+$/)
  })

  it('produces distinct ids across repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => freshLayerId()))
    expect(ids.size).toBe(20)
  })
})

describe('freshImageId', () => {
  it('produces ids starting with "fpimg_"', () => {
    expect(freshImageId()).toMatch(/^fpimg_[a-z0-9]+$/)
  })

  it('produces distinct ids across repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => freshImageId()))
    expect(ids.size).toBe(20)
  })
})

// ─── Round-trip serialization via JSON ───────────────────────────────────────

describe('JSON round-trip (serialize / deserialize)', () => {
  it('survives JSON.stringify + JSON.parse with no mutations', () => {
    const p = newFaceplateProject('Round-trip Test')
    const json = JSON.stringify(p)
    const p2 = JSON.parse(json) as Coh2FaceplateProject
    expect(p2).toEqual(p)
  })

  it('preserves magic and version after round-trip', () => {
    const p = newFaceplateProject()
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.magic).toBe('coh2-faceplate-project')
    expect(p2.version).toBe(7)
  })

  it('preserves a multi-byte (CJK) packName', () => {
    const p = newFaceplateProject('日本語テスト')
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.packName).toBe('日本語テスト')
  })

  it('preserves a multi-byte (emoji) packName', () => {
    const p = newFaceplateProject('🎖️ Hero Pack')
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.packName).toBe('🎖️ Hero Pack')
  })

  it('preserves empty images record', () => {
    const p = newFaceplateProject()
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.images).toEqual({})
  })

  it('preserves a populated image in the images record', () => {
    const p = newFaceplateProject()
    const id = 'fpimg_abc123'
    const img: FaceplateImage = {
      id,
      name: 'test.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      width: 64,
      height: 64,
    }
    p.images[id] = img
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.images[id]).toEqual(img)
  })

  it('preserves a full image layer entry', () => {
    const p = newFaceplateProject()
    const layer: ImageLayer = {
      kind: 'image',
      id: 'layer_xyz',
      imageId: 'fpimg_abc',
      x: 100,
      y: 200,
      rotation: 45,
      scale: 1.5,
      opacity: 0.8,
      flipH: true,
      flipV: false,
      locked: false,
      visible: true,
    }
    p.layers.push(layer)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.layers).toHaveLength(1)
    expect(p2.layers[0]).toEqual(layer)
  })

  it('preserves backgroundColor when set to a hex string', () => {
    const p = newFaceplateProject()
    p.backgroundColor = '#ff0000'
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.backgroundColor).toBe('#ff0000')
  })

  it('preserves backgroundColor through JSON round-trip', () => {
    const p = newFaceplateProject()
    p.backgroundColor = '#aabbcc'
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.backgroundColor).toBe('#aabbcc')
  })
})

// ─── localStorage persistence ─────────────────────────────────────────────────

describe('persistFaceplate / loadFaceplateById / loadActiveFaceplate', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips via persist + loadFaceplateById', () => {
    const p = newFaceplateProject('Persist Test')
    persistFaceplate(p)
    const loaded = loadFaceplateById(p.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.packName).toBe('Persist Test')
    expect(loaded!.magic).toBe('coh2-faceplate-project')
  })

  it('round-trips via persist + loadActiveFaceplate', () => {
    const p = newFaceplateProject('Active Test')
    persistFaceplate(p)
    const loaded = loadActiveFaceplate()
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe(p.id)
  })

  it('loadFaceplateById returns null for an unknown id', () => {
    expect(loadFaceplateById('fp_doesnotexist')).toBeNull()
  })

  it('loadActiveFaceplate returns null when nothing persisted', () => {
    expect(loadActiveFaceplate()).toBeNull()
  })

  it('persistFaceplate updates modifiedAt to a recent timestamp', () => {
    const p = newFaceplateProject()
    // Back-date modifiedAt so we can confirm it gets refreshed
    p.modifiedAt = new Date(0).toISOString()
    const before = Date.now()
    persistFaceplate(p)
    const after = Date.now()
    const loaded = loadFaceplateById(p.id)!
    const ts = new Date(loaded.modifiedAt).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('loadFaceplateById rejects JSON that has wrong magic', () => {
    const fake = { magic: 'coh2-skin-project', version: 1, id: 'fp_fake' }
    localStorage.setItem('coh2.faceplate.fp_fake', JSON.stringify(fake))
    expect(loadFaceplateById('fp_fake')).toBeNull()
  })

  it('loadFaceplateById returns null for invalid JSON', () => {
    localStorage.setItem('coh2.faceplate.fp_bad', 'not-json{{')
    expect(loadFaceplateById('fp_bad')).toBeNull()
  })
})

// ─── Recent faceplates ────────────────────────────────────────────────────────

describe('getRecentFaceplates / updateRecentFaceplateThumbnail', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty array when nothing has been persisted', () => {
    expect(getRecentFaceplates()).toEqual([])
  })

  it('records a project in the recent list after persist', () => {
    const p = newFaceplateProject('Recent Test')
    persistFaceplate(p)
    const recents = getRecentFaceplates()
    expect(recents.length).toBeGreaterThanOrEqual(1)
    const entry = recents.find(e => e.id === p.id)
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('Recent Test')
  })

  it('persisting the same project twice keeps only one entry for it', () => {
    const p = newFaceplateProject('Dedup Test')
    persistFaceplate(p)
    persistFaceplate(p)
    const recents = getRecentFaceplates()
    const matches = recents.filter(e => e.id === p.id)
    expect(matches).toHaveLength(1)
  })

  it('updateRecentFaceplateThumbnail stores the thumbnail string', () => {
    const p = newFaceplateProject('Thumb Test')
    persistFaceplate(p)
    updateRecentFaceplateThumbnail(p.id, 'data:image/png;base64,THUMB')
    const entry = getRecentFaceplates().find(e => e.id === p.id)
    expect(entry?.thumbnail).toBe('data:image/png;base64,THUMB')
  })

  it('updateRecentFaceplateThumbnail is a no-op for an unknown id', () => {
    // Should not throw and should not break existing entries
    const p = newFaceplateProject('Safe')
    persistFaceplate(p)
    expect(() => updateRecentFaceplateThumbnail('fp_unknown', 'x')).not.toThrow()
    expect(getRecentFaceplates().find(e => e.id === 'fp_unknown')).toBeUndefined()
  })

  it('tracks layerCount correctly', () => {
    const p = newFaceplateProject('Layer Count')
    const layer: ImageLayer = {
      kind: 'image',
      id: 'layer_l1',
      imageId: 'fpimg_i1',
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      opacity: 1,
      flipH: false,
      flipV: false,
      locked: false,
      visible: true,
    }
    p.layers.push(layer)
    persistFaceplate(p)
    const entry = getRecentFaceplates().find(e => e.id === p.id)
    expect(entry?.layerCount).toBe(1)
  })
})

// ─── readFaceplateFile ────────────────────────────────────────────────────────

describe('readFaceplateFile', () => {
  it('parses a valid .coh2faceplate File object', async () => {
    const p = newFaceplateProject('File Load Test')
    const json = JSON.stringify(p)
    const file = new File([json], 'test.coh2faceplate', { type: 'application/json' })
    const loaded = await readFaceplateFile(file)
    expect(loaded.magic).toBe('coh2-faceplate-project')
    expect(loaded.packName).toBe('File Load Test')
  })

  it('throws when magic is missing', async () => {
    const bad = { version: 1, id: 'fp_x', packName: 'No Magic' }
    const file = new File([JSON.stringify(bad)], 'bad.coh2faceplate')
    await expect(readFaceplateFile(file)).rejects.toThrow(/magic/)
  })

  it('throws when magic is wrong', async () => {
    const bad = { magic: 'coh2-skin-project', version: 1, id: 'fp_x' }
    const file = new File([JSON.stringify(bad)], 'wrong.coh2faceplate')
    await expect(readFaceplateFile(file)).rejects.toThrow(/magic/)
  })

  it('throws on invalid JSON', async () => {
    const file = new File(['not json {{{'], 'broken.coh2faceplate')
    await expect(readFaceplateFile(file)).rejects.toThrow()
  })
})

// ─── newImageLayer ────────────────────────────────────────────────────────────

describe('newImageLayer', () => {
  it('returns an ImageLayer with kind "image"', () => {
    const l = newImageLayer('fpimg_abc')
    expect(l.kind).toBe('image')
  })

  it('sets imageId from argument', () => {
    const l = newImageLayer('fpimg_test')
    expect(l.imageId).toBe('fpimg_test')
  })

  it('centres on banner canvas by default', () => {
    const l = newImageLayer('fpimg_x')
    expect(l.x).toBe(FACEPLATE_BANNER_W / 2)
    expect(l.y).toBe(FACEPLATE_BANNER_H / 2)
  })

  it('has sensible defaults (scale 1, opacity 1, no flip, unlocked, visible)', () => {
    const l = newImageLayer('fpimg_x')
    expect(l.scale).toBe(1)
    expect(l.opacity).toBe(1)
    expect(l.flipH).toBe(false)
    expect(l.flipV).toBe(false)
    expect(l.locked).toBe(false)
    expect(l.visible).toBe(true)
  })
})

// ─── newTextLayer ─────────────────────────────────────────────────────────────

describe('newTextLayer', () => {
  it('returns a TextLayer with kind "text"', () => {
    const l = newTextLayer()
    expect(l.kind).toBe('text')
  })

  it('uses default text "Your text" when no argument supplied', () => {
    const l = newTextLayer()
    expect(l.text).toBe('Your text')
  })

  it('uses the supplied text argument', () => {
    const l = newTextLayer('Hello World')
    expect(l.text).toBe('Hello World')
  })

  it('has white color, center align, bold weight by default', () => {
    const l = newTextLayer()
    expect(l.color).toBe('#ffffff')
    expect(l.align).toBe('center')
    expect(l.fontWeight).toBe(700)
  })

  it('has no stroke by default', () => {
    const l = newTextLayer()
    expect(l.strokeWidth).toBe(0)
    expect(l.strokeColor).toBe('')
  })

  it('has fontSize 48 and fontStyle normal by default', () => {
    const l = newTextLayer()
    expect(l.fontSize).toBe(48)
    expect(l.fontStyle).toBe('normal')
  })

  it('centres on banner canvas by default', () => {
    const l = newTextLayer()
    expect(l.x).toBe(FACEPLATE_BANNER_W / 2)
    expect(l.y).toBe(FACEPLATE_BANNER_H / 2)
  })

  it('is visible and unlocked by default', () => {
    const l = newTextLayer()
    expect(l.visible).toBe(true)
    expect(l.locked).toBe(false)
  })

  it('has a unique id each call', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newTextLayer().id))
    expect(ids.size).toBe(20)
  })
})

// ─── Text layer serialize / deserialize ──────────────────────────────────────

describe('text layer round-trip serialization', () => {
  it('round-trips a TextLayer through JSON', () => {
    const p = newFaceplateProject('Text RT')
    const tl = newTextLayer('Hello\nWorld')
    tl.fontFamily = 'Georgia, serif'
    tl.fontSize = 64
    tl.fontWeight = 900
    tl.fontStyle = 'italic'
    tl.color = '#ff0000'
    tl.align = 'left'
    tl.strokeColor = '#000000'
    tl.strokeWidth = 3
    p.layers.push(tl)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.layers).toHaveLength(1)
    const rt = p2.layers[0] as TextLayer
    expect(rt.kind).toBe('text')
    expect(rt.text).toBe('Hello\nWorld')
    expect(rt.fontFamily).toBe('Georgia, serif')
    expect(rt.fontSize).toBe(64)
    expect(rt.fontWeight).toBe(900)
    expect(rt.fontStyle).toBe('italic')
    expect(rt.color).toBe('#ff0000')
    expect(rt.align).toBe('left')
    expect(rt.strokeColor).toBe('#000000')
    expect(rt.strokeWidth).toBe(3)
  })

  it('round-trips a mixed image + text project', () => {
    const p = newFaceplateProject('Mixed')
    const img = newImageLayer('fpimg_abc')
    const txt = newTextLayer('Label')
    p.layers.push(img, txt)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.layers).toHaveLength(2)
    expect(p2.layers[0].kind).toBe('image')
    expect(p2.layers[1].kind).toBe('text')
  })

  it('preserves multiline text \\n through serialize/deserialize', () => {
    const p = newFaceplateProject('Multiline')
    const tl = newTextLayer('Line 1\nLine 2\nLine 3')
    p.layers.push(tl)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0] as TextLayer
    expect(rt.text).toBe('Line 1\nLine 2\nLine 3')
    expect(rt.text.split('\n')).toHaveLength(3)
  })
})

// ─── newPaintLayer ────────────────────────────────────────────────────────────

describe('newPaintLayer', () => {
  it('returns a PaintLayer with kind "paint"', () => {
    const l = newPaintLayer()
    expect(l.kind).toBe('paint')
  })

  it('has fixed banner dimensions', () => {
    const l = newPaintLayer()
    expect(l.width).toBe(FACEPLATE_BANNER_W)
    expect(l.height).toBe(FACEPLATE_BANNER_H)
  })

  it('has a non-empty dataUrl (blank transparent PNG)', () => {
    const l = newPaintLayer()
    expect(l.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('is visible and unlocked by default', () => {
    const l = newPaintLayer()
    expect(l.visible).toBe(true)
    expect(l.locked).toBe(false)
  })

  it('has a unique id each call', () => {
    const ids = new Set(Array.from({ length: 10 }, () => newPaintLayer().id))
    expect(ids.size).toBe(10)
  })
})

// ─── Migration: v3 → v4 round-trip ───────────────────────────────────────────

describe('migration: v3 → v6 no-op stamp', () => {
  it('readFaceplateFile promotes a v3 project to v6 without changing geometry', async () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 3,
      id: 'fp_v3',
      packName: 'V3 Project',
      packDescription: 'x',
      author: 'x',
      backgroundColor: null,
      images: {},
      layers: [
        {
          kind: 'image' as const,
          id: 'layer_a',
          imageId: 'fpimg_a',
          x: 312,
          y: 102,
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'v3.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    expect(loaded.version).toBe(7)
    // Geometry must not change on v3→v6 migration
    const layer = loaded.layers[0] as ImageLayer
    expect(layer.x).toBe(312)
    expect(layer.y).toBe(102)
    expect(layer.scale).toBe(1)
  })

  it('PaintLayer round-trips through JSON', () => {
    const p = newFaceplateProject('Paint RT')
    const pl: PaintLayer = newPaintLayer()
    p.layers.push(pl)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.layers).toHaveLength(1)
    const rt = p2.layers[0] as PaintLayer
    expect(rt.kind).toBe('paint')
    expect(rt.dataUrl).toBe(pl.dataUrl)
    expect(rt.width).toBe(FACEPLATE_BANNER_W)
    expect(rt.height).toBe(FACEPLATE_BANNER_H)
  })
})

// ─── Migration: v1 (600×170 canvas) → v2 (624×204 canvas) ───────────────────

describe('migration: v1 → v2 canvas resize', () => {
  // The canvas resized from 600×170 to 624×204 to match the engine's actual
  // banner display rect. Layer x/y coordinates are stored in canvas pixels,
  // so the migrator scales them by (624/600, 204/170) to preserve the
  // user's composition.
  const SX = 624 / 600
  const SY = 204 / 170

  it('readFaceplateFile scales v1 layer coords by (1.04, 1.20)', async () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 1,
      id: 'fp_v1',
      packName: 'V1 Project',
      packDescription: 'x',
      author: 'x',
      backgroundColor: null,
      images: {},
      layers: [
        {
          kind: 'image' as const,
          id: 'layer_a',
          imageId: 'fpimg_a',
          x: 300,
          y: 85, // dead-centre on the old 600×170 canvas
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'v1.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    // v1 → v6: migrator stamps the current schema version on read, regardless
    // of what intermediate transforms ran along the way.
    expect(loaded.version).toBe(7)
    expect(loaded.layers).toHaveLength(1)
    const migrated = loaded.layers[0] as ImageLayer
    expect(migrated.x).toBeCloseTo(300 * SX, 5)
    expect(migrated.y).toBeCloseTo(85 * SY, 5)
    // Scale / rotation / opacity must NOT be touched.
    expect(migrated.scale).toBe(1)
    expect(migrated.rotation).toBe(0)
    expect(migrated.opacity).toBe(1)
  })

  it('does not double-scale a project already at v2', async () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 2,
      id: 'fp_v2',
      packName: 'V2 Project',
      packDescription: 'x',
      author: 'x',
      backgroundColor: null,
      images: {},
      layers: [
        {
          kind: 'image' as const,
          id: 'layer_a',
          imageId: 'fpimg_a',
          x: 312,
          y: 102, // already centred on the new 624×204 canvas
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'v2.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    const migrated = loaded.layers[0] as ImageLayer
    expect(migrated.x).toBe(312)
    expect(migrated.y).toBe(102)
  })

  it('treats version-missing as v1 and scales accordingly', async () => {
    const raw: Record<string, unknown> = {
      magic: 'coh2-faceplate-project',
      // no version field at all
      id: 'fp_legacy',
      packName: 'Legacy',
      packDescription: '',
      author: 'x',
      backgroundColor: null,
      images: {},
      layers: [
        {
          kind: 'image' as const,
          id: 'layer_a',
          imageId: 'fpimg_a',
          x: 600,
          y: 170, // bottom-right corner of the old canvas
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'legacy.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    expect(loaded.version).toBe(7)
    const migrated = loaded.layers[0] as ImageLayer
    expect(migrated.x).toBe(624)
    expect(migrated.y).toBe(204)
  })
})

// ─── Migration: old-format layers (no kind) → image ──────────────────────────

describe('migration: old-format layers (no kind field)', () => {
  it('readFaceplateFile migrates layers without kind to image', async () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 1,
      id: 'fp_migrate',
      packName: 'Old Format',
      packDescription: 'x',
      author: 'x',
      silhouette: 'square',
      backgroundColor: null,
      images: {},
      layers: [
        {
          id: 'layer_old',
          imageId: 'fpimg_old',
          x: 100,
          y: 100,
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
          // NOTE: no 'kind' field — legacy format
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'old.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    expect(loaded.layers).toHaveLength(1)
    const migrated = loaded.layers[0] as ImageLayer
    expect(migrated.kind).toBe('image')
    expect(migrated.id).toBe('layer_old')
  })

  it('loadFaceplateById migrates old layers from localStorage', () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 1,
      id: 'fp_ls_migrate',
      packName: 'LS Migrate',
      packDescription: 'x',
      author: 'x',
      silhouette: 'square',
      backgroundColor: null,
      images: {},
      layers: [
        {
          id: 'layer_ls',
          imageId: 'fpimg_ls',
          x: 0,
          y: 0,
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    localStorage.setItem('coh2.faceplate.fp_ls_migrate', JSON.stringify(raw))
    const loaded = loadFaceplateById('fp_ls_migrate')
    expect(loaded).not.toBeNull()
    expect((loaded!.layers[0] as ImageLayer).kind).toBe('image')
    localStorage.clear()
  })
})

// ─── newGroupLayer ────────────────────────────────────────────────────────────

describe('newGroupLayer', () => {
  it('returns a GroupLayer with kind "group"', () => {
    const g = newGroupLayer()
    expect(g.kind).toBe('group')
  })

  it('uses default name "Group"', () => {
    const g = newGroupLayer()
    expect(g.name).toBe('Group')
  })

  it('accepts a custom name', () => {
    const g = newGroupLayer('Background elements')
    expect(g.name).toBe('Background elements')
  })

  it('starts with an empty childIds array', () => {
    const g = newGroupLayer()
    expect(g.childIds).toEqual([])
  })

  it('is visible with opacity 1 and collapsed false by default', () => {
    const g = newGroupLayer()
    expect(g.visible).toBe(true)
    expect(g.opacity).toBe(1)
    expect(g.collapsed).toBe(false)
  })

  it('generates a unique id each call', () => {
    const ids = new Set(Array.from({ length: 10 }, () => newGroupLayer().id))
    expect(ids.size).toBe(10)
  })
})

// ─── GroupLayer round-trip ────────────────────────────────────────────────────

describe('GroupLayer JSON round-trip', () => {
  it('round-trips a GroupLayer in a project', () => {
    const p = newFaceplateProject('Group RT')
    const g: GroupLayer = newGroupLayer('Test Group')
    g.childIds = ['layer_a', 'layer_b']
    p.layers.push(g)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect(p2.layers).toHaveLength(1)
    const rt = p2.layers[0] as GroupLayer
    expect(rt.kind).toBe('group')
    expect(rt.name).toBe('Test Group')
    expect(rt.childIds).toEqual(['layer_a', 'layer_b'])
    expect(rt.visible).toBe(true)
    expect(rt.opacity).toBe(1)
  })

  it('preserves lockFlags on a GroupLayer', () => {
    const p = newFaceplateProject('LockFlags Group')
    const g: GroupLayer = newGroupLayer()
    g.lockFlags = { position: true, aspect: false }
    p.layers.push(g)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0] as GroupLayer
    expect(rt.lockFlags?.position).toBe(true)
    expect(rt.lockFlags?.aspect).toBe(false)
  })
})

// ─── Migration: v4 → v6 no-op stamp ──────────────────────────────────────────

describe('migration: v4 → v6 no-op stamp', () => {
  it('readFaceplateFile promotes a v4 project to v6 without changing geometry', async () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 4,
      id: 'fp_v4',
      packName: 'V4 Project',
      packDescription: 'x',
      author: 'x',
      backgroundColor: null,
      images: {},
      layers: [
        {
          kind: 'image' as const,
          id: 'layer_a',
          imageId: 'fpimg_a',
          x: 312,
          y: 102,
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'v4.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    expect(loaded.version).toBe(7)
    // Geometry must not change on v4→v6 migration
    const layer = loaded.layers[0] as ImageLayer
    expect(layer.x).toBe(312)
    expect(layer.y).toBe(102)
    expect(layer.scale).toBe(1)
  })

  it('newFaceplateProject produces a v7 project', () => {
    const p = newFaceplateProject()
    expect(p.version).toBe(7)
  })

  it('persist + load round-trips a v7 project through localStorage', () => {
    const p = newFaceplateProject('V7 LocalStorage')
    const g = newGroupLayer('My Group')
    p.layers.push(g)
    persistFaceplate(p)
    const loaded = loadFaceplateById(p.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(7)
    expect(loaded!.layers[0].kind).toBe('group')
    expect((loaded!.layers[0] as GroupLayer).name).toBe('My Group')
    localStorage.clear()
  })
})

// ─── Migration: v5 → v6 no-op stamp ──────────────────────────────────────────

describe('migration: v5 → v6 no-op stamp', () => {
  it('readFaceplateFile promotes a v5 project to v6 without changing geometry', async () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 5,
      id: 'fp_v5_to_v6',
      packName: 'V5 to V6',
      packDescription: 'x',
      author: 'x',
      backgroundColor: null,
      images: {},
      layers: [
        {
          kind: 'image' as const,
          id: 'layer_a',
          imageId: 'fpimg_a',
          x: 312,
          y: 102,
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'v5.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    expect(loaded.version).toBe(7)
    // Geometry must not change
    const layer = loaded.layers[0] as ImageLayer
    expect(layer.x).toBe(312)
    expect(layer.y).toBe(102)
    expect(layer.scale).toBe(1)
    // All new v6 fields are absent (optional, identity = absent)
    expect(layer.blendMode).toBeUndefined()
    expect(layer.mask).toBeUndefined()
    expect(layer.clippedToLayerBelow).toBeUndefined()
  })

  it('v5 project with a PaintLayer migrates to v6 without adding stroke', async () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 5,
      id: 'fp_v5_paint',
      packName: 'V5 Paint',
      packDescription: 'x',
      author: 'x',
      backgroundColor: null,
      images: {},
      layers: [
        {
          kind: 'paint' as const,
          id: 'layer_p',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          width: 624 as const,
          height: 204 as const,
          x: 312,
          y: 102,
          rotation: 0,
          scale: 1,
          opacity: 1,
          locked: false,
          visible: true,
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'v5_paint.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    expect(loaded.version).toBe(7)
    const paint = loaded.layers[0] as PaintLayer
    expect(paint.stroke).toBeUndefined()
    expect(paint.blendMode).toBeUndefined()
  })
})

// ─── v6 new fields: BlendMode, LayerMask, GradientFill round-trips ───────────

describe('v6: BlendMode round-trip on ImageLayer', () => {
  it('blendMode field survives JSON round-trip', () => {
    const p = newFaceplateProject('BlendMode RT')
    const l = newImageLayer('fpimg_x')
    const bm: BlendMode = 'multiply'
    l.blendMode = bm
    p.layers.push(l)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0] as ImageLayer
    expect(rt.blendMode).toBe('multiply')
  })

  it('BLEND_MODES array contains "normal" and "multiply"', () => {
    expect(BLEND_MODES).toContain('normal')
    expect(BLEND_MODES).toContain('multiply')
    expect(BLEND_MODES.length).toBe(16)
  })

  it('new ImageLayer has no blendMode set (identity = absent)', () => {
    const l = newImageLayer('fpimg_x')
    expect(l.blendMode).toBeUndefined()
  })

  it('blendMode propagates through migrate(): v5 project → v6 keeps blendMode absent', async () => {
    const raw = {
      magic: 'coh2-faceplate-project',
      version: 5,
      id: 'fp_bm_migrate',
      packName: 'BM Migrate',
      packDescription: '',
      author: 'x',
      backgroundColor: null,
      images: {},
      layers: [
        {
          kind: 'image' as const,
          id: 'layer_bm',
          imageId: 'fpimg_bm',
          x: 312,
          y: 102,
          rotation: 0,
          scale: 1,
          opacity: 1,
          flipH: false,
          flipV: false,
          locked: false,
          visible: true,
          // blendMode intentionally absent in v5 project
        },
      ],
      modifiedAt: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(raw)], 'bm_migrate.coh2faceplate')
    const loaded = await readFaceplateFile(file)
    // blendMode must remain absent (not stamped to 'normal') after migration
    expect((loaded.layers[0] as ImageLayer).blendMode).toBeUndefined()
  })
})

describe('v6: LayerMask round-trip', () => {
  it('mask field survives JSON round-trip on ImageLayer', () => {
    const p = newFaceplateProject('Mask RT')
    const l = newImageLayer('fpimg_x')
    const mask: LayerMask = {
      dataUrl: 'data:image/png;base64,MASKMASK==',
      invert: true,
      enabled: true,
    }
    l.mask = mask
    p.layers.push(l)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0] as ImageLayer
    expect(rt.mask?.dataUrl).toBe('data:image/png;base64,MASKMASK==')
    expect(rt.mask?.invert).toBe(true)
    expect(rt.mask?.enabled).toBe(true)
  })

  it('mask field is absent on a new layer (identity = absent)', () => {
    const l = newImageLayer('fpimg_x')
    expect(l.mask).toBeUndefined()
  })

  it('clippedToLayerBelow field survives JSON round-trip', () => {
    const p = newFaceplateProject('Clip RT')
    const l = newImageLayer('fpimg_x')
    l.clippedToLayerBelow = true
    p.layers.push(l)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    expect((p2.layers[0] as ImageLayer).clippedToLayerBelow).toBe(true)
  })
})

describe('v6: GradientFill round-trip on ShapeLayer', () => {
  it('gradientFill survives JSON round-trip', () => {
    const p = newFaceplateProject('Gradient RT')
    const s = newShapeLayer('rectangle')
    const gf: GradientFill = {
      kind: 'linear',
      angle: 90,
      stops: [
        { color: '#ff0000', position: 0 },
        { color: '#0000ff', position: 1 },
      ],
    }
    s.gradientFill = gf
    p.layers.push(s)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0] as ShapeLayer
    expect(rt.gradientFill?.kind).toBe('linear')
    expect(rt.gradientFill?.angle).toBe(90)
    expect(rt.gradientFill?.stops).toHaveLength(2)
    expect(rt.gradientFill?.stops[0].color).toBe('#ff0000')
    expect(rt.gradientFill?.stops[1].position).toBe(1)
  })

  it('radial gradientFill survives JSON round-trip', () => {
    const p = newFaceplateProject('Radial Gradient RT')
    const s = newShapeLayer('circle')
    s.gradientFill = {
      kind: 'radial',
      stops: [
        { color: '#ffffff', position: 0 },
        { color: '#000000', position: 1 },
      ],
    }
    p.layers.push(s)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0] as ShapeLayer
    expect(rt.gradientFill?.kind).toBe('radial')
  })

  it('new ShapeLayer has no gradientFill set (identity = absent)', () => {
    const s = newShapeLayer()
    expect(s.gradientFill).toBeUndefined()
  })
})

describe('v6: noise field on ImageLayerFilters', () => {
  it('noise field survives JSON round-trip', () => {
    const p = newFaceplateProject('Noise RT')
    const l = newImageLayer('fpimg_x')
    l.filters = { noise: 0.3 }
    p.layers.push(l)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0] as ImageLayer
    expect(rt.filters?.noise).toBe(0.3)
  })

  it('IMAGE_LAYER_FILTER_DEFAULTS includes noise: 0', () => {
    expect(IMAGE_LAYER_FILTER_DEFAULTS.noise).toBe(0)
  })

  it('new ImageLayer has no filters set (noise omitted, identity = absent)', () => {
    const l = newImageLayer('fpimg_x')
    expect(l.filters).toBeUndefined()
  })
})

// ─── BaseLayer.lockFlags round-trip ──────────────────────────────────────────

describe('BaseLayer.lockFlags round-trip', () => {
  it('lockFlags on an ImageLayer survive JSON round-trip', () => {
    const p = newFaceplateProject('LockFlags RT')
    const l: ImageLayer = {
      ...newImageLayer('fpimg_a'),
      lockFlags: { position: true },
    }
    p.layers.push(l)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0] as ImageLayer
    expect(rt.lockFlags?.position).toBe(true)
    expect(rt.lockFlags?.aspect).toBeUndefined()
  })

  it('lockFlags on a TextLayer survive JSON round-trip', () => {
    const p = newFaceplateProject('LockFlags Text RT')
    const l = { ...newTextLayer(), lockFlags: { aspect: true } }
    p.layers.push(l)
    const p2 = JSON.parse(JSON.stringify(p)) as Coh2FaceplateProject
    const rt = p2.layers[0]
    expect((rt as { lockFlags?: { aspect?: boolean } }).lockFlags?.aspect).toBe(true)
  })
})

// ─── listAllFaceplates — clone-template + Saved-projects readers ─────────────
// Same contract as listAllSkinProjects: walks every per-id snapshot (not the
// 12-cap registry) and drops broken entries via the loader-validity gate.

describe('listAllFaceplates', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('enumerates more than the 12-entry recent registry cap', () => {
    for (let i = 0; i < 20; i++) {
      const p = newFaceplateProject(`Plate ${i}`)
      persistFaceplate(p)
    }
    expect(getRecentFaceplates().length).toBe(12)
    expect(listAllFaceplates().length).toBe(20)
  })

  it('excludes snapshots that are not valid JSON', () => {
    const p = newFaceplateProject('Good Plate')
    persistFaceplate(p)
    localStorage.setItem('coh2.faceplate.broken_id_1', '{not json}')
    const all = listAllFaceplates()
    expect(all.find(e => e.id === p.id)).toBeDefined()
    expect(all.find(e => e.id === 'broken_id_1')).toBeUndefined()
  })

  it('excludes snapshots whose magic header does not match', () => {
    const p = newFaceplateProject('Good Plate')
    persistFaceplate(p)
    localStorage.setItem(
      'coh2.faceplate.wrong_magic',
      JSON.stringify({ magic: 'something-else', id: 'wrong_magic' }),
    )
    const all = listAllFaceplates()
    expect(all.find(e => e.id === p.id)).toBeDefined()
    expect(all.find(e => e.id === 'wrong_magic')).toBeUndefined()
  })

  it('sorts by lastEditedAt descending (newest first)', () => {
    // Use explicit timestamps because Date.now() collisions in a tight
    // loop make sort order non-deterministic — in real use the events are
    // separated by user-interaction time.
    const older = newFaceplateProject('Older')
    persistFaceplate(older)
    const newer = newFaceplateProject('Newer')
    persistFaceplate(newer)
    // Force a known order on the registry so the test is deterministic.
    const cached = getRecentFaceplates()
    const stamped = cached.map(e =>
      e.id === older.id ? { ...e, lastEditedAt: 100 } : { ...e, lastEditedAt: 200 },
    )
    localStorage.setItem('coh2.recentFaceplates', JSON.stringify(stamped))
    const all = listAllFaceplates()
    expect(all[0]?.id).toBe(newer.id)
    expect(all[1]?.id).toBe(older.id)
  })
})
