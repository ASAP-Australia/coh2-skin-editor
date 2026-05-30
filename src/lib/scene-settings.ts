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
    // documents a deferred HDR pipeline. ACES is too contrasty/warm for this
    // 2013-era look; Reinhard is the closest standard Three.js operator.
    toneMapping: 'reinhard',
    exposure: 1.0,
    // Hemi — provides flat neutral ambient fill while the PMREM RoomEnvironment
    // (wired in Viewport.tsx via scene.environment) handles diffuse irradiance
    // and specular IBL (the Essence EnvMapDiffuse / EnvMapSpecular role).
    // Intensity reduced from 1.2 → 0.5 to avoid double-counting ambient once
    // the PMREM env is active. Sky/ground are kept near-neutral grey (no
    // blue-sky/brown-ground tint) because Corsix's analysis shows the real
    // ambient is flat: `ambientscale (0.7)` × a white EnvMapDiffuse cube.
    hemi: { sky: 0xd0d0d0, ground: 0x888888, intensity: 0.5 },
    directionalLights: [
      // Key (sun): `dirlight0` in the Essence shader is WHITE (1,1,1), NOT
      // the cyan `fxlight_suncolour (0.9,1.0,1.0)` — that constant is the
      // PARTICLE subsystem light, not the vehicle key light. Confirmed via
      // corsix's coh2-explorer (essence_panel.cpp). Intensity 3.0 and
      // position (5,5,-5) are deliberately tuned for Three.js HDR headroom
      // — do not change. Position derives from `dirlight0_dir (-0.577,
      // -0.577, 0.577)` inverted to light-source coordinates. Shadow caster
      // (Viewport.tsx wires shadowMap only on directionalLights[0]).
      { color: 0xffffff, intensity: 3.0, position: [5, 5, -5] },
      // Cool fill from camera-left. Reads as faint sky-bounce on the
      // shaded side rather than a competing key.
      { color: 0xcdd3d8, intensity: 0.45, position: [-6, 5, -2] },
      // Cool neutral rim from behind for silhouette separation against
      // the cubemap background.
      { color: 0xdce0e6, intensity: 0.5, position: [-3, 3, -10] },
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
    background: { kind: 'color', hex: 0x1c1d22 },
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
// Confidence: MEDIUM. The base SUMMER values are HIGH confidence
// (extracted from corsix's coh2-explorer C++ shader constants), but no
// per-map .aps atmosphere file was extracted for winter. The values
// below are physically motivated estimates that match the perceptual
// look of in-game winter screenshots; tune visually before shipping a
// future "lighting parity" pass against reference frames.
//
// Source: Barrero (2013) — "Ambient occlusion is key for snowy
// environments"; COH2.org community notes on Frost maps; physics of
// snow albedo + temperate winter sun elevation.
// ─────────────────────────────────────────────────────────────────────────

export interface SeasonOverrides {
  exposure?: number
  hemi?: HemiSpec
  directionalLights?: DirLightSpec[]
}

const WINTER_OVERRIDES_IN_GAME: SeasonOverrides = {
  // Slightly stopped down — overcast winter sky is naturally lower-EV
  // than a clear summer sun, but the boosted ambient compensates so
  // the model is still well-lit.
  exposure: 0.95,
  // Snow-bright ambient with cold blue sky + near-white ground bounce.
  // The HIGH ground value (0xd0dce8) is the snow GI — physically real,
  // and the reason winter scenes have such soft, low-contrast lighting
  // even with the sun visible.
  hemi: { sky: 0x8ab0d0, ground: 0xd0dce8, intensity: 1.3 },
  directionalLights: [
    // Sun: cold blue-white, lower angle (~15° elevation), lower
    // intensity than summer (overcast scatter + sun closer to horizon).
    // Shadow caster — Viewport.tsx wires shadowMap only on index 0.
    { color: 0xc8dff0, intensity: 1.5, position: [1, 3, -10] },
    // Sky-coloured fill — replicates the cool blue shadow-fill that
    // makes winter shadows distinctly cooler than the lit sides
    // (instead of just darker). Equivalent to the deferred pipeline's
    // ambient-probe contribution from the visible sky dome.
    { color: 0x3355aa, intensity: 0.25, position: [-5, 5, 5] },
    // Soft warm bounce from any visible exposed soil/mud kicks a
    // subtle warm rim into the lower silhouette — keeps the model
    // from reading as a flat blue cutout.
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
