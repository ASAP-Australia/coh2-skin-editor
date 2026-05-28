/**
 * Tests for ScenePanel — the right-edge environment-preset picker.
 *
 * Pinned contract:
 *   1. Renders exactly three `type="button"` chips, one per preset, in
 *      the canonical PRESET_ORDER:
 *        in_game_field → studio_grid → showcase
 *      The order is pinned because it drives muscle memory; sliding
 *      "Studio Grid" above "In-Game Field" would surprise existing
 *      users.
 *   2. Each chip carries `aria-pressed` reflecting whether its id ===
 *      the current `presetId`. Exactly ONE chip is pressed at a time.
 *   3. Each chip's hover `title` is "<label> — <description>" sourced
 *      from `SCENE_PRESETS` (we pin a couple of substrings so a future
 *      label tweak doesn't go unnoticed by tests, but the test does
 *      NOT hardcode the entire description — that would be brittle).
 *   4. Each chip contains its lucide icon (svg child).
 *   5. Clicking an unpressed chip calls `setPresetId(id)` exactly once
 *      with that chip's id.
 *   6. Clicking the ALREADY-active chip still fires `setPresetId(id)`
 *      with the same id (the parent decides whether to no-op; the
 *      component is dumb).
 *   7. Active chip carries the white-on-black variant background; the
 *      two inactive chips carry the dim-text variant. We pin the
 *      variant via className substring so a refactor that drops the
 *      active highlight gets flagged.
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import ScenePanel from '../ScenePanel'
import { SCENE_PRESETS, type PresetId } from '@/lib/scene-settings'

const PRESET_ORDER: PresetId[] = ['in_game_field', 'studio_grid', 'showcase']

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  presetId?: PresetId
  setPresetId?: (id: PresetId) => void
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(ScenePanel, {
        presetId: props.presetId ?? 'in_game_field',
        setPresetId: props.setPresetId ?? (() => {}),
      }),
    )
  })
  return container!
}

function chips(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
}

function chipFor(id: PresetId): HTMLButtonElement | null {
  // The title prefix is the preset label — that's the cleanest selector.
  const label = SCENE_PRESETS[id].label
  return chips().find(b => b.getAttribute('title')?.startsWith(label)) ?? null
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ScenePanel — render', () => {
  it('renders exactly three buttons', () => {
    render()
    expect(chips()).toHaveLength(3)
  })

  it('all three buttons are type="button"', () => {
    render()
    chips().forEach(b => {
      expect(b.getAttribute('type')).toBe('button')
    })
  })

  it('preserves the canonical PRESET_ORDER (in_game_field → studio_grid → showcase)', () => {
    render()
    const order = chips().map(b => b.getAttribute('title') ?? '')
    expect(order[0]).toContain(SCENE_PRESETS.in_game_field.label)
    expect(order[1]).toContain(SCENE_PRESETS.studio_grid.label)
    expect(order[2]).toContain(SCENE_PRESETS.showcase.label)
  })

  it('each chip contains its lucide icon (svg child)', () => {
    render()
    for (const id of PRESET_ORDER) {
      expect(chipFor(id)!.querySelector('svg')).not.toBeNull()
    }
  })

  it('each chip title carries "<label> — <description>" from SCENE_PRESETS', () => {
    render()
    for (const id of PRESET_ORDER) {
      const title = chipFor(id)!.getAttribute('title') ?? ''
      expect(title).toContain(SCENE_PRESETS[id].label)
      expect(title).toContain(' — ')
      // First six chars of the description — enough to detect a wholesale
      // text rewrite but not so much that small copy edits break the test.
      expect(title).toContain(SCENE_PRESETS[id].description.slice(0, 6))
    }
  })
})

describe('ScenePanel — aria-pressed mirror', () => {
  it('exactly one chip is aria-pressed=true at a time', () => {
    for (const active of PRESET_ORDER) {
      render({ presetId: active })
      for (const id of PRESET_ORDER) {
        expect(chipFor(id)!.getAttribute('aria-pressed')).toBe(id === active ? 'true' : 'false')
      }
    }
  })

  it('active chip carries the white background variant; inactive chips do not', () => {
    render({ presetId: 'studio_grid' })
    const active = chipFor('studio_grid')!
    const inactive1 = chipFor('in_game_field')!
    const inactive2 = chipFor('showcase')!
    // Active variant uses `bg-white/95 text-black …` — pin via className substring.
    expect(active.className).toContain('bg-white/95')
    expect(active.className).toContain('text-black')
    expect(inactive1.className).not.toContain('bg-white/95')
    expect(inactive2.className).not.toContain('bg-white/95')
    // Inactive chips use the dim-text variant.
    expect(inactive1.className).toContain('--color-text-2')
    expect(inactive2.className).toContain('--color-text-2')
  })
})

describe('ScenePanel — click wiring', () => {
  it('clicking an unpressed chip fires setPresetId(id) exactly once', () => {
    const setPresetId = vi.fn()
    render({ presetId: 'in_game_field', setPresetId })
    act(() => {
      chipFor('studio_grid')!.click()
    })
    expect(setPresetId).toHaveBeenCalledTimes(1)
    expect(setPresetId).toHaveBeenCalledWith('studio_grid')
  })

  it('clicking the already-active chip still fires setPresetId(id) — component is dumb', () => {
    const setPresetId = vi.fn()
    render({ presetId: 'showcase', setPresetId })
    act(() => {
      chipFor('showcase')!.click()
    })
    expect(setPresetId).toHaveBeenCalledTimes(1)
    expect(setPresetId).toHaveBeenCalledWith('showcase')
  })

  it('each chip fires with its OWN id (handlers are not cross-wired)', () => {
    const setPresetId = vi.fn()
    render({ setPresetId })
    act(() => {
      chipFor('in_game_field')!.click()
    })
    act(() => {
      chipFor('studio_grid')!.click()
    })
    act(() => {
      chipFor('showcase')!.click()
    })
    expect(setPresetId.mock.calls.map(c => c[0])).toEqual([
      'in_game_field',
      'studio_grid',
      'showcase',
    ])
  })
})
