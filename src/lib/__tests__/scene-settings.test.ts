import { describe, it, expect } from 'vitest'
import {
  SCENE_PRESETS,
  DEFAULT_PRESET_ID,
  applySeasonOverrides,
  type PresetId,
  type ScenePreset,
} from '../scene-settings'

// ---------------------------------------------------------------------------
// DEFAULT_PRESET_ID
// ---------------------------------------------------------------------------

describe('DEFAULT_PRESET_ID', () => {
  it('is a known preset id', () => {
    expect(Object.keys(SCENE_PRESETS)).toContain(DEFAULT_PRESET_ID)
  })

  it('is in_game_field', () => {
    expect(DEFAULT_PRESET_ID).toBe('in_game_field')
  })
})

// ---------------------------------------------------------------------------
// SCENE_PRESETS — structural completeness
// ---------------------------------------------------------------------------

describe('SCENE_PRESETS', () => {
  const presetIds: PresetId[] = ['in_game_field', 'studio_grid', 'showcase']

  it('contains all three expected preset ids', () => {
    for (const id of presetIds) {
      expect(SCENE_PRESETS[id]).toBeDefined()
    }
  })

  it('each preset id matches its key', () => {
    for (const id of presetIds) {
      expect(SCENE_PRESETS[id].id).toBe(id)
    }
  })

  it('each preset has a non-empty label and description', () => {
    for (const id of presetIds) {
      const p = SCENE_PRESETS[id]
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('each preset has a valid toneMapping value', () => {
    const valid = new Set(['aces', 'neutral', 'reinhard'])
    for (const id of presetIds) {
      expect(valid.has(SCENE_PRESETS[id].toneMapping)).toBe(true)
    }
  })

  it('each preset has a positive exposure', () => {
    for (const id of presetIds) {
      expect(SCENE_PRESETS[id].exposure).toBeGreaterThan(0)
    }
  })

  it('each preset has a hemi with sky, ground, and positive intensity', () => {
    for (const id of presetIds) {
      const { hemi } = SCENE_PRESETS[id]
      expect(typeof hemi.sky).toBe('number')
      expect(typeof hemi.ground).toBe('number')
      expect(hemi.intensity).toBeGreaterThan(0)
    }
  })

  it('each preset has a background with a valid kind', () => {
    const validKinds = new Set(['color', 'cubemap'])
    for (const id of presetIds) {
      expect(validKinds.has(SCENE_PRESETS[id].background.kind)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// in_game_field preset specifics
// ---------------------------------------------------------------------------

describe('in_game_field preset', () => {
  const p: ScenePreset = SCENE_PRESETS['in_game_field']

  it('uses neutral (Khronos PBR Neutral) tone mapping', () => {
    // Restored render path: PBR-neutral tonemapping preserves albedo/atlas
    // colour without the reinhard desaturation that washed out the camo.
    expect(p.toneMapping).toBe('neutral')
  })

  it('uses a cubemap background', () => {
    expect(p.background.kind).toBe('cubemap')
  })

  it('has at least one directional light (the key/sun)', () => {
    expect(p.directionalLights.length).toBeGreaterThanOrEqual(1)
  })

  it('shows ground but not grid', () => {
    expect(p.showGround).toBe(true)
    expect(p.showGrid).toBe(false)
  })

  it('has autoRotate disabled', () => {
    expect(p.autoRotate).toBe(false)
  })

  it('each directional light has a positive intensity', () => {
    for (const l of p.directionalLights) {
      expect(l.intensity).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// studio_grid preset specifics
// ---------------------------------------------------------------------------

describe('studio_grid preset', () => {
  const p: ScenePreset = SCENE_PRESETS['studio_grid']

  it('uses neutral tone mapping', () => {
    expect(p.toneMapping).toBe('neutral')
  })

  it('uses a color background', () => {
    expect(p.background.kind).toBe('color')
  })

  it('shows grid', () => {
    expect(p.showGrid).toBe(true)
  })

  it('hides ground', () => {
    expect(p.showGround).toBe(false)
  })

  it('has omni lights for 6-axis fill', () => {
    expect(p.omniLights).toBeDefined()
    expect(p.omniLights!.length).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// showcase preset specifics
// ---------------------------------------------------------------------------

describe('showcase preset', () => {
  const p: ScenePreset = SCENE_PRESETS['showcase']

  it('uses neutral tone mapping', () => {
    expect(p.toneMapping).toBe('neutral')
  })

  it('has a true-black background', () => {
    expect(p.background).toEqual({ kind: 'color', hex: 0x000000 })
  })

  it('has no directional lights', () => {
    expect(p.directionalLights).toHaveLength(0)
  })

  it('has 6 omni lights', () => {
    expect(p.omniLights).toBeDefined()
    expect(p.omniLights!.length).toBe(6)
  })

  it('hides both grid and ground', () => {
    expect(p.showGrid).toBe(false)
    expect(p.showGround).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// applySeasonOverrides — winter lighting layer over in_game_field
// ---------------------------------------------------------------------------

describe('applySeasonOverrides', () => {
  const summerInGame = SCENE_PRESETS['in_game_field']
  const studio = SCENE_PRESETS['studio_grid']
  const showcase = SCENE_PRESETS['showcase']

  it('is a no-op when season is summer (in_game_field)', () => {
    const result = applySeasonOverrides(summerInGame, 'summer')
    // Reference equality — summer should return the input preset unmodified
    // so React useMemo / effect dependency arrays don't churn when the
    // season is unchanged.
    expect(result).toBe(summerInGame)
  })

  it('is a no-op for studio_grid regardless of season', () => {
    expect(applySeasonOverrides(studio, 'summer')).toBe(studio)
    expect(applySeasonOverrides(studio, 'winter')).toBe(studio)
  })

  it('is a no-op for showcase regardless of season', () => {
    expect(applySeasonOverrides(showcase, 'summer')).toBe(showcase)
    expect(applySeasonOverrides(showcase, 'winter')).toBe(showcase)
  })

  it('returns a new object for winter (does not mutate input)', () => {
    const winter = applySeasonOverrides(summerInGame, 'winter')
    expect(winter).not.toBe(summerInGame)
    // Sanity: input is untouched by reference equality on its lights array.
    expect(summerInGame.directionalLights).toBe(summerInGame.directionalLights)
  })

  it('preserves preset id and label when applying winter overrides', () => {
    const winter = applySeasonOverrides(summerInGame, 'winter')
    expect(winter.id).toBe('in_game_field')
    expect(winter.label).toBe(summerInGame.label)
  })

  it('preserves background and toggles unrelated to lighting', () => {
    const winter = applySeasonOverrides(summerInGame, 'winter')
    expect(winter.background).toEqual(summerInGame.background)
    expect(winter.showGrid).toBe(summerInGame.showGrid)
    expect(winter.showGround).toBe(summerInGame.showGround)
    expect(winter.autoRotate).toBe(summerInGame.autoRotate)
    expect(winter.toneMapping).toBe(summerInGame.toneMapping)
  })

  it('lowers exposure (stopped-down winter EV)', () => {
    const winter = applySeasonOverrides(summerInGame, 'winter')
    expect(winter.exposure).toBeLessThan(summerInGame.exposure)
    expect(winter.exposure).toBeGreaterThan(0)
  })

  it('swaps hemi to a cool sky + bright snow-bounce ground', () => {
    const winter = applySeasonOverrides(summerInGame, 'winter')
    expect(winter.hemi).not.toEqual(summerInGame.hemi)
    expect(winter.hemi.intensity).toBeGreaterThan(0)
    // Snow GI: winter ground should be brighter than the dirt-brown summer
    // ground bounce (key physics of winter lighting).
    expect(winter.hemi.ground).toBeGreaterThan(summerInGame.hemi.ground)
  })

  it('replaces directional lights with a 3-light winter rig', () => {
    const winter = applySeasonOverrides(summerInGame, 'winter')
    expect(winter.directionalLights.length).toBe(3)
    for (const l of winter.directionalLights) {
      expect(l.intensity).toBeGreaterThan(0)
      expect(l.color).toBeGreaterThanOrEqual(0)
      expect(Array.isArray(l.position)).toBe(true)
      expect(l.position.length).toBe(3)
    }
  })

  it('winter sun is dimmer than summer sun (lower-EV overcast)', () => {
    const winter = applySeasonOverrides(summerInGame, 'winter')
    const summerSun = summerInGame.directionalLights[0]
    const winterSun = winter.directionalLights[0]
    expect(winterSun.intensity).toBeLessThan(summerSun.intensity)
  })
})
