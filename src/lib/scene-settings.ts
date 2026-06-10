/**
 * Scene presets — three named lighting + background bundles for the 3D
 * viewport. The previous slider-heavy SceneSettings has been replaced with
 * three opinionated presets (in_game_field / studio_grid / showcase), each
 * packaging tone-mapping, lights and background as a single click-to-apply
 * bundle. The active preset id is the only thing persisted to localStorage.
 *
 * Persisted under: `coh2-skin-editor:scene-preset:v1`.
 */

export type PresetId = 'in_game_field' | 'studio_grid' | 'showcase'

export type ToneMappingMode =
  | 'aces' // ACESFilmicToneMapping  — cinematic / strong filmic roll-off
  | 'neutral' // Khronos PBR Neutral   — studio / showcase
  | 'reinhard' // ReinhardToneMapping   — in-game CoH2 (Essence 3.0 / 2013-era deferred HDR)

export interface DirLightSpec {
  /** sRGB hex (Three.js Color literal). */
  color: number
  intensity: number
  position: [number, number, number]
}

export interface HemiSpec {
  sky: number
  ground: number
  intensity: number
}

export type Background =
  | { kind: 'color'; hex: number }
  /** In-game CoH2 cubemap. Loaded from the user's CoH2 install when
   *  available, falls back to a procedural sky otherwise. */
  | { kind: 'cubemap' }

export interface ScenePreset {
  id: PresetId
  label: string
  description: string
  toneMapping: ToneMappingMode
  exposure: number
  hemi: HemiSpec
  /** Directional lights forming the key/fill/rim setup. */
  directionalLights: DirLightSpec[]
  /** Optional omni-directional fill — used by Showcase to defeat the
   *  geometry-driven black-void problem (every facet lit from ≥2 sides). */
  omniLights?: DirLightSpec[]
  background: Background
  showGrid: boolean
  showGround: boolean
  /** `true` = use the default speed (0.6); a number sets the exact speed. */
  autoRotate: boolean | number
}

// ─────────────────────────────────────────────────────────────────────────
// Preset definitions
// ─────────────────────────────────────────────────────────────────────────

const SHOWCASE_OMNI_RADIUS = 8

export const SCENE_PRESETS: Record<PresetId, ScenePreset> = {
  in_game_field: {
    id: 'in_game_field',
    label: 'In-Game Field',
    description: 'Realistic CoH2 battlefield environment with dynamic skybox and field lighting.',
    // ── Summer baseline (winter overrides applied via WINTER_OVERRIDES below) ──
    //
    // Lighting values are extracted from Relic's actual Essence 3.0 shader
    // constants — see corsix's `coh2-explorer` (essence_panel.cpp) which uses
    // the official shader source to render previews. Tonemapping confirmed
    // from Barrero, "CoH2 Rendering Tech" (2013, gamedevs.org PDF), which
    // documents a deferred HDR pipeline. Essence's viewer path is effectively
    // linear (tonemap off); Reinhard crushes midtones and reads the dunkelgelb
    // base as a dark olive, so use Neutral (Khronos PBR Neutral) — preserves
    // diffuse brightness + saturation without ACES contrast.
    toneMapping: 'neutral',
    // B4: lifted from 1.0 → 1.12. Users reported vehicles reading too dark
    // vs the in-game look; neutral tonemapping has no highlight roll-off so
    // this is a safe linear lift that brightens midtones without clipping.
    // LIGHTING-PARITY pass (vs in-game StuG III, Pripyat summer refs): the
    // in-game summer look is a warm golden-hour key over a warm ambient —
    // the neutral-grey rig below read too cool/flat next to the references.
    // Lifted 1.12 → 1.14 to match the bright (but un-blown) reference EV.
    exposure: 1.14,
    // Hemi — provides ambient fill while the PMREM RoomEnvironment (wired in
    // Viewport.tsx via scene.environment) handles diffuse irradiance and
    // specular IBL (the Essence EnvMapDiffuse / EnvMapSpecular role).
    // PARITY: warmed from neutral grey (sky 0xd0d0d0 / ground 0x888888) to a
    // warm off-white sky + warm tan ground bounce. The reference shadowed
    // faces hold a warm grey-brown — driven by the sunlit tan ground bounce,
    // not a cold blue sky — so the ground hemi term is now a warm earth tone.
    hemi: { sky: 0xe2d8c4, ground: 0x6e5c42, intensity: 1.1 },
    directionalLights: [
      // Key (sun): `dirlight0` in the Essence shader is WHITE (1,1,1), NOT
      // the cyan `fxlight_suncolour (0.9,1.0,1.0)` — that constant is the
      // PARTICLE subsystem light, not the vehicle key light. Confirmed via
      // corsix's coh2-explorer (essence_panel.cpp). Position (5,5,-5) is
      // tuned for Three.js HDR headroom — derives from `dirlight0_dir
      // (-0.577,-0.577,0.577)` inverted to light-source coordinates. Shadow
      // caster (Viewport.tsx wires shadowMap only on directionalLights[0]).
      // PARITY: the in-game summer sun reads distinctly WARM/golden on the
      // top decks + mantlet (see refs), so the key is warmed 0xffffff →
      // 0xffe8c8 (~late-afternoon sunlight). Intensity held at 2.5.
      { color: 0xffe8c8, intensity: 2.5, position: [5, 5, -5] },
      // Warm-neutral fill from camera-left — reads as warm ground/sky bounce
      // on the shaded side (refs show warm, detailed shadows, not cool ones).
      { color: 0xd8cdba, intensity: 0.45, position: [-6, 5, -2] },
      // Neutral rim from behind for silhouette separation against the sky.
      { color: 0xdcd6cc, intensity: 0.5, position: [-3, 3, -10] },
    ],
    background: { kind: 'cubemap' },
    showGrid: false,
    showGround: true,
    autoRotate: false,
  },

  studio_grid: {
    id: 'studio_grid',
    // Studio mode is the "look at every panel without anything in the way"
    // preset — the user explicitly asked for 100 % illumination here, so
    // we run a hemi + 6-axis omni fill rig instead of a 3-point cinematic
    // setup. Result: every facet of the model receives light from at least
    // 2 directions and there are no dark cavities, regardless of normal-map
    // orientation or face winding.
    label: 'Studio Grid',
    description:
      'Dark gray background with reference grid and uniform 6-axis fill — every panel of the tank fully visible.',
    toneMapping: 'neutral',
    exposure: 0.95,
    // Strong hemi carries the bulk of the lift — neutral light grey
    // sky (was 0xc4d0e4 sky-blue, which poured a noticeable cool wash
    // onto painted-steel panels and read as a permanent "blue tint" on
    // any vehicle viewed in studio mode). A near-white sky with a
    // mid-grey ground keeps the volumetric cue (lit faces brighter than
    // shaded ones) without colour-shifting the diffuse.
    hemi: { sky: 0xe8e8e8, ground: 0x808080, intensity: 1.25 },
    directionalLights: [
      // One soft key from above-front so painted-steel surfaces still
      // pick up a directional highlight — without this the whole model
      // reads as a flat unlit decal.
      { color: 0xfff4e0, intensity: 0.55, position: [4, 9, 5] },
    ],
    omniLights: [
      // Six soft fills from the bbox-radius axes. Sum is 2.4 — enough
      // to defeat dark patches without saturating the spec response.
      { color: 0xffffff, intensity: 0.4, position: [SHOWCASE_OMNI_RADIUS, 0, 0] },
      { color: 0xffffff, intensity: 0.4, position: [-SHOWCASE_OMNI_RADIUS, 0, 0] },
      { color: 0xffffff, intensity: 0.4, position: [0, SHOWCASE_OMNI_RADIUS, 0] },
      { color: 0xffffff, intensity: 0.4, position: [0, -SHOWCASE_OMNI_RADIUS, 0] },
      { color: 0xffffff, intensity: 0.4, position: [0, 0, SHOWCASE_OMNI_RADIUS] },
      { color: 0xffffff, intensity: 0.4, position: [0, 0, -SHOWCASE_OMNI_RADIUS] },
    ],
    background: { kind: 'color', hex: 0x2e3039 },
    showGrid: true,
    showGround: false,
    autoRotate: false,
  },

  showcase: {
    id: 'showcase',
    label: 'Showcase',
    description:
      'Black backdrop with omni-directional lighting — every panel of the tank fully visible.',
    toneMapping: 'neutral',
    // Lower exposure than studio so the painted-steel _spc map doesn't
    // turn the whole hull into a chrome ball under the 6-axis lights.
    exposure: 0.85,
    // Slight warm/cool hemi tint (sky-warm, ground-cool) gives volume
    // without piling on more direct light. Intensity is kept low; the
    // omni rig below carries the visibility budget.
    hemi: { sky: 0xfff4e0, ground: 0x303542, intensity: 0.45 },
    directionalLights: [],
    omniLights: [
      // Six soft fills from the bbox-radius axes. Each is 0.5 — sum is
      // 3.0 ≈ a single bright key. Previously 1.5 each (sum 9.0) which
      // saturated the PBR specular response to chrome on every facet.
      { color: 0xffffff, intensity: 0.5, position: [SHOWCASE_OMNI_RADIUS, 0, 0] },
      { color: 0xffffff, intensity: 0.5, position: [-SHOWCASE_OMNI_RADIUS, 0, 0] },
      { color: 0xffffff, intensity: 0.5, position: [0, SHOWCASE_OMNI_RADIUS, 0] },
      { color: 0xffffff, intensity: 0.5, position: [0, -SHOWCASE_OMNI_RADIUS, 0] },
      { color: 0xffffff, intensity: 0.5, position: [0, 0, SHOWCASE_OMNI_RADIUS] },
      { color: 0xffffff, intensity: 0.5, position: [0, 0, -SHOWCASE_OMNI_RADIUS] },
    ],
    // True black backdrop (matches the description + the in-game showcase look)
    // — was 0x404448 which read as a flat gray.
    background: { kind: 'color', hex: 0x000000 },
    showGrid: false,
    showGround: false,
    // Auto-rotate disabled — the user wants to control orbiting themselves
    // in showcase mode (and the spinning was distracting when comparing
    // skin variations side-by-side). Camera stays put unless the user
    // drags it.
    autoRotate: false,
  },
}

export const DEFAULT_PRESET_ID: PresetId = 'in_game_field'

// ─────────────────────────────────────────────────────────────────────────
// Season-aware overrides for the in-game preset
//
// CoH2 winter maps (Stalingrad, Lazur, Frost-coded "snow" maps) use
// physically different lighting from summer maps — lower sun elevation
// (~15° at 50°N latitude in December), cool blue-white sun, and a
// BOOSTED ambient because snow reflects ~80 % of skylight back up.
// Shadows pick up a strong blue tint from the sky.
//
// Confidence: the base SUMMER values started from corsix's coh2-explorer
// C++ shader constants (HIGH), and BOTH seasons have since been tuned in a
// LIGHTING-PARITY pass against in-game reference frames — StuG III on
// Pripyat, summer (three-colour camo) + winter (vanilla), 3/4 side angles.
// Summer: warm golden key + warm tan-ground ambient, detailed warm shadows.
// Winter: cool blue snow ambient dominates (blue shadows), with a WEAK pale-
// warm low sun catching only the top decks — matched to the references.
//
// Source: corsix coh2-explorer shader constants; Barrero (2013) "Ambient
// occlusion is key for snowy environments"; + visual parity vs the StuG
// Pripyat summer/winter reference frames (2026-06 lighting pass).
// ─────────────────────────────────────────────────────────────────────────

export interface SeasonOverrides {
  exposure?: number
  hemi?: HemiSpec
  directionalLights?: DirLightSpec[]
}

const WINTER_OVERRIDES_IN_GAME: SeasonOverrides = {
  // Slightly stopped down — overcast winter sky is naturally lower-EV
  // than a clear summer sun, but the boosted snow ambient compensates so
  // the model is still well-lit.
  // B4: lifted 0.95 → 1.08. PARITY (vs in-game StuG III, Pripyat winter
  // refs): the reference snow scene is bright and very LOW-contrast; held
  // at 1.08 (below summer's 1.14) — the cool ambient does the lifting.
  exposure: 1.08,
  // Snow-bright COOL ambient — this is the dominant term in winter and the
  // reason the whole scene reads cool/blue (snow + sky bounce), with shadows
  // tinting distinctly blue rather than just going dark. The HIGH near-white
  // blue ground value is the snow GI bounce. PARITY: intensity lifted
  // 1.5 → 1.65 to flatten contrast to match the soft overcast references.
  hemi: { sky: 0x9cb8d4, ground: 0xd4dfeb, intensity: 1.65 },
  directionalLights: [
    // Sun: the references show a WEAK, low winter sun that lands a faint
    // WARM catch on the top decks + gun (NOT a cold blue key — that washed
    // the whole hull blue and lost the subtle warm highlight). So the key is
    // now a pale-warm low sun: it only warms the sun-facing top facets while
    // the strong cool hemi keeps the body + shadows blue. Raised slightly
    // ([2,4,-9]) so it grazes the top decks. Intensity 1.85 → 1.5 (lower
    // contrast). Shadow caster — Viewport.tsx wires shadowMap only on idx 0.
    { color: 0xffe9cf, intensity: 1.5, position: [2, 4, -9] },
    // Cool blue sky fill — deepens the distinctly blue shadow tint the
    // references show on the off-sun side. Lifted 0.25 → 0.32.
    { color: 0x3a5cb0, intensity: 0.32, position: [-5, 5, 5] },
    // Soft warm bounce from exposed soil/mud kicks a subtle warm rim into
    // the lower silhouette so the model isn't a flat blue cutout.
    { color: 0xa89880, intensity: 0.15, position: [-3, 1, -8] },
  ],
}

/**
 * Apply season-specific lighting overrides to a preset.
 *
 * Only `in_game_field` has season-aware lighting — `studio_grid` and
 * `showcase` are studio-style presets where the user is inspecting the
 * model under controlled lighting, so season swaps only affect the
 * diffuse texture (handled separately in Viewport.tsx). For the in-game
 * preset, winter applies the WINTER_OVERRIDES_IN_GAME map above so
 * users previewing a vehicle on a snow map see the same lighting they'd
 * see in-game.
 */
export function applySeasonOverrides(
  preset: ScenePreset,
  season: 'summer' | 'winter',
): ScenePreset {
  if (preset.id !== 'in_game_field' || season === 'summer') return preset
  const o = WINTER_OVERRIDES_IN_GAME
  return {
    ...preset,
    exposure: o.exposure ?? preset.exposure,
    hemi: o.hemi ?? preset.hemi,
    directionalLights: o.directionalLights ?? preset.directionalLights,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Persistence — only the active preset id is stored. The previous v1 key
// (full slider state) is silently migrated by reading-then-discarding.
// ─────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'coh2-skin-editor:scene-preset:v1'
const LEGACY_STORAGE_KEY = 'coh2-skin-editor:scene-settings:v1'

export function loadPresetId(): PresetId {
  if (typeof window === 'undefined') return DEFAULT_PRESET_ID
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw && (raw === 'in_game_field' || raw === 'studio_grid' || raw === 'showcase')) {
      return raw
    }
    // One-shot migration: if the legacy slider-state key exists, ignore its
    // contents but write the new key with the default so we don't keep
    // checking. Don't delete the legacy key — keeps the user's data intact.
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      window.localStorage.setItem(STORAGE_KEY, DEFAULT_PRESET_ID)
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PRESET_ID
}

export function persistPresetId(id: PresetId): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* storage quota / private mode — silently ignore */
  }
}
