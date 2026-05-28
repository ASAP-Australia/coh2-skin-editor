/**
 * Tests for atlas-view-settings — the 3-mode persistence module shared by
 * FaceplateEditor and DecalPackEditor.
 *
 * The module mirrors `scene-settings.ts` (Vehicle Viewport scene preset)
 * but maintains separate storage keys per editor so a user can pick e.g.
 * 'in_game' for the faceplate editor without forcing the decal editor
 * into the same mode. Tests pin:
 *
 *   - Default mode is 'template' (matches the editor's empty-state look).
 *   - Round-trip persist → load returns the same value.
 *   - Faceplate and decal keys are independent (no cross-contamination).
 *   - Invalid / missing storage values fall back to the default safely.
 *   - localStorage throws (quota exceeded, private mode) are swallowed.
 *
 * Storage interaction is isolated by clearing localStorage in beforeEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  type AtlasViewMode,
  DEFAULT_ATLAS_VIEW_MODE,
  ATLAS_VIEW_MODE_LABEL,
  ATLAS_VIEW_MODE_ORDER,
  loadFaceplateViewMode,
  persistFaceplateViewMode,
  loadDecalViewMode,
  persistDecalViewMode,
} from '../atlas-view-settings'

const FACEPLATE_KEY = 'coh2-skin-editor:faceplate-view-mode:v1'
const DECAL_KEY = 'coh2-skin-editor:decal-view-mode:v1'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('atlas-view-settings module surface', () => {
  it('DEFAULT_ATLAS_VIEW_MODE is the editor-scaffolding template view', () => {
    expect(DEFAULT_ATLAS_VIEW_MODE).toBe('template')
  })

  it('ATLAS_VIEW_MODE_ORDER lists template, checkerboard, in_game in that order', () => {
    expect(ATLAS_VIEW_MODE_ORDER).toEqual(['template', 'checkerboard', 'in_game'])
  })

  it('every order entry has a label + description in ATLAS_VIEW_MODE_LABEL', () => {
    for (const id of ATLAS_VIEW_MODE_ORDER) {
      const meta = ATLAS_VIEW_MODE_LABEL[id]
      expect(meta).toBeDefined()
      expect(typeof meta.label).toBe('string')
      expect(meta.label.length).toBeGreaterThan(0)
      expect(typeof meta.description).toBe('string')
      expect(meta.description.length).toBeGreaterThan(0)
    }
  })
})

describe('loadFaceplateViewMode / persistFaceplateViewMode', () => {
  it('returns default when localStorage is empty', () => {
    expect(loadFaceplateViewMode()).toBe('template')
  })

  it('round-trips every valid AtlasViewMode value', () => {
    const modes: AtlasViewMode[] = ['template', 'checkerboard', 'in_game']
    for (const mode of modes) {
      persistFaceplateViewMode(mode)
      expect(loadFaceplateViewMode()).toBe(mode)
    }
  })

  it('writes the canonical key under the v1 namespace', () => {
    persistFaceplateViewMode('in_game')
    expect(window.localStorage.getItem(FACEPLATE_KEY)).toBe('in_game')
  })

  it('returns default for arbitrary / corrupt stored value', () => {
    window.localStorage.setItem(FACEPLATE_KEY, 'not-a-real-mode')
    expect(loadFaceplateViewMode()).toBe('template')
  })

  it('returns default for empty string stored value', () => {
    window.localStorage.setItem(FACEPLATE_KEY, '')
    expect(loadFaceplateViewMode()).toBe('template')
  })

  it('swallows localStorage.setItem throws (quota exceeded / private mode)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => persistFaceplateViewMode('checkerboard')).not.toThrow()
    setItem.mockRestore()
  })

  it('swallows localStorage.getItem throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(loadFaceplateViewMode()).toBe('template')
    getItem.mockRestore()
  })
})

describe('loadDecalViewMode / persistDecalViewMode', () => {
  it('returns default when localStorage is empty', () => {
    expect(loadDecalViewMode()).toBe('template')
  })

  it('round-trips every valid AtlasViewMode value', () => {
    const modes: AtlasViewMode[] = ['template', 'checkerboard', 'in_game']
    for (const mode of modes) {
      persistDecalViewMode(mode)
      expect(loadDecalViewMode()).toBe(mode)
    }
  })

  it('writes the canonical decal key under the v1 namespace', () => {
    persistDecalViewMode('checkerboard')
    expect(window.localStorage.getItem(DECAL_KEY)).toBe('checkerboard')
  })

  it('returns default for arbitrary / corrupt stored value', () => {
    window.localStorage.setItem(DECAL_KEY, 'fooba')
    expect(loadDecalViewMode()).toBe('template')
  })
})

describe('faceplate + decal storage isolation', () => {
  it('persisting faceplate does NOT mutate the decal key', () => {
    persistFaceplateViewMode('in_game')
    expect(window.localStorage.getItem(DECAL_KEY)).toBeNull()
    expect(loadDecalViewMode()).toBe('template')
  })

  it('persisting decal does NOT mutate the faceplate key', () => {
    persistDecalViewMode('checkerboard')
    expect(window.localStorage.getItem(FACEPLATE_KEY)).toBeNull()
    expect(loadFaceplateViewMode()).toBe('template')
  })

  it('faceplate + decal can hold different modes simultaneously', () => {
    persistFaceplateViewMode('in_game')
    persistDecalViewMode('checkerboard')
    expect(loadFaceplateViewMode()).toBe('in_game')
    expect(loadDecalViewMode()).toBe('checkerboard')
  })
})
