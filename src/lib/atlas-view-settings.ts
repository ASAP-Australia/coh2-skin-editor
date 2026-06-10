/**
 * AtlasViewMode — three visualisation modes for the Faceplate / Decal-pack
 * editor canvas, modelled after the Vehicle Viewport's ScenePanel preset
 * picker.
 *
 *   • `template`       — the editor "scaffolding" view: dashed border,
 *                        diagonal arrows, dimension label. What the user
 *                        sees while composing layers; arrows fade behind
 *                        any layer content.
 *   • `checkerboard`   — light grey checker behind the layers so the user
 *                        can verify which regions are truly transparent.
 *                        Matches what the SGA's BC3 DDS payload will look
 *                        like in-game where the engine composites over
 *                        battlefield art.
 *   • `in_game`        — replaces the editor canvas with a faithful mock
 *                        of how CoH2 displays the artwork in its UI:
 *                        64×64 lobby icon, player-badge lockup, and the
 *                        elaborate gold-framed faceplate hover card (for
 *                        the faceplate editor); 3-column decal grid in
 *                        the customise screen (for the decal editor).
 *
 * The two editors persist independently — switching to the in-game view
 * on a faceplate doesn't change the decal-pack view, and vice versa.
 * Storage version `v1` so a later format change can migrate without
 * stranding users in an invalid mode.
 */

export type AtlasViewMode = 'template' | 'checkerboard' | 'in_game'

export const DEFAULT_ATLAS_VIEW_MODE: AtlasViewMode = 'template'

const FACEPLATE_STORAGE_KEY = 'coh2-skin-editor:faceplate-view-mode:v1'
const DECAL_STORAGE_KEY = 'coh2-skin-editor:decal-view-mode:v1'

function isAtlasViewMode(value: unknown): value is AtlasViewMode {
  return value === 'template' || value === 'checkerboard' || value === 'in_game'
}

function loadFromKey(key: string): AtlasViewMode {
  if (typeof window === 'undefined') return DEFAULT_ATLAS_VIEW_MODE
  try {
    const raw = window.localStorage.getItem(key)
    if (isAtlasViewMode(raw)) return raw
  } catch {
    /* storage unavailable — fall back to default */
  }
  return DEFAULT_ATLAS_VIEW_MODE
}

function persistToKey(key: string, mode: AtlasViewMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, mode)
  } catch {
    /* storage quota / private mode — silently ignore */
  }
}

export function loadFaceplateViewMode(): AtlasViewMode {
  return loadFromKey(FACEPLATE_STORAGE_KEY)
}

export function persistFaceplateViewMode(mode: AtlasViewMode): void {
  persistToKey(FACEPLATE_STORAGE_KEY, mode)
}

export function loadDecalViewMode(): AtlasViewMode {
  return loadFromKey(DECAL_STORAGE_KEY)
}

export function persistDecalViewMode(mode: AtlasViewMode): void {
  persistToKey(DECAL_STORAGE_KEY, mode)
}

/** Human-readable labels + descriptions for tooltips. */
export const ATLAS_VIEW_MODE_LABEL: Record<AtlasViewMode, { label: string; description: string }> =
  {
    template: {
      label: 'Template',
      description: 'Editor view with the dashed border, dimension label and corner arrows.',
    },
    checkerboard: {
      label: 'Checkerboard',
      description: 'Light checker behind the layers so transparent regions read at a glance.',
    },
    in_game: {
      label: 'In-game preview',
      description: 'How CoH2 actually displays the artwork — icon, badge and hover card.',
    },
  }

/** Canonical render order for the AtlasViewPanel (mirrors ScenePanel).
 *  `in_game` is intentionally excluded — the overlay was removed. */
export const ATLAS_VIEW_MODE_ORDER: AtlasViewMode[] = ['template', 'checkerboard']
