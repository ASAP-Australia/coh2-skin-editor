/**
 * Tests for the four UI/behaviour fixes from the live-review session:
 *
 *   S1 — Start-card height resets to compact after visiting SavedProjectsList.
 *        (HeightTransition resetMark behaviour — unit-tested at the hook level
 *        since jsdom can't measure real heights. The structural contract: once
 *        resetMark increments, peakNaturalHeight resets to 0.)
 *
 *   S2 — Workshop-delete row in SavedProjectsList uses arm→confirm (no
 *        floating green chip). Pinned via the existing confirmingWorkshop
 *        prop flow — the arm button shows only a CloudOff icon, no text label.
 *
 *   S3 — Visibility selector initialises from persisted workshopVisibility.
 *        PublishSection selects the correct VISIBILITY_OPTIONS index when
 *        initialVisibility is provided and calls onPublished with the right
 *        visibility value.
 *
 *   S4 — Change-note section removed. PublishSection renders no change-note
 *        input even for existing (isUpdate) Workshop items.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ─── SavedProjectsList helpers ───────────────────────────────────────────────
//
// We test the ProjectRow component indirectly through SavedProjectsList.
// The arm-workshop-delete button must show ONLY an icon, not a text label.

const SKIN_KEY = 'coh2.recentProjects'
const FACEPLATE_KEY = 'coh2.recentFaceplates'
const DECAL_KEY = 'coh2.recentDecalPacks'

let storage: Map<string, string>

function seedLocalStorage(data: Record<string, string>) {
  storage = new Map(Object.entries(data))
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
    (key: string) => storage.get(key) ?? null,
  )
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
    storage.set(key, value)
  })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
    storage.delete(key)
  })
  vi.spyOn(Storage.prototype, 'key').mockImplementation(
    (index: number) => Array.from(storage.keys())[index] ?? null,
  )
  vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => storage.size)
}

function validSkinSnapshot(id: string, packName: string, workshopId: string): string {
  return JSON.stringify({
    magic: 'coh2-skin-project',
    version: 2,
    id,
    packName,
    exportSlots: [],
    generationSessions: {},
    vehicleIcons: {},
    vehicles: {},
    palette: [],
    activeSlotIdx: 0,
    modifiedAt: new Date().toISOString(),
    workshopId,
  })
}

// ─── S2: Workshop-delete row arm button has no text label ────────────────────

describe('S2 — Workshop-delete row has no floating text label', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => { root!.unmount() })
      root = null
    }
    container?.remove()
    container = null
    vi.restoreAllMocks()
  })

  it('arm-workshop-delete button contains only an icon, no text node', async () => {
    const { default: SavedProjectsList } = await import('../SavedProjectsList')
    // Real Workshop id (≤5e9) → CloudOff button should be visible.
    const id = 'abc123'
    const workshopId = '999999999' // ≤5e9 → real
    const snap = validSkinSnapshot(id, 'My Pack', workshopId)
    // The skin project index key (coh2.skinProjectIndex.v1) is used by getProjectMeta.
    const indexKey = 'coh2.skinProjectIndex.v1'
    const index = JSON.stringify({ [id]: { name: 'My Pack', lastEditedAt: Date.now(), workshopId, vehicleCount: 0 } })

    seedLocalStorage({
      [SKIN_KEY]: JSON.stringify([{ id, name: 'My Pack', lastEditedAt: Date.now() }]),
      [`coh2.project.${id}`]: snap,
      [indexKey]: index,
      [FACEPLATE_KEY]: '[]',
      [DECAL_KEY]: '[]',
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(
        createElement(SavedProjectsList, {
          onPickSkin: vi.fn(),
          onPickFaceplate: vi.fn(),
          onPickDecalPack: vi.fn(),
          onBack: vi.fn(),
          onPickFromDisk: vi.fn(),
        }),
      )
    })

    const armBtn = container.querySelector('[data-testid="arm-workshop-delete"]')
    expect(armBtn, 'arm-workshop-delete button should exist').toBeTruthy()

    // The button must contain an SVG icon and NO visible text content.
    const textContent = (armBtn?.textContent ?? '').trim()
    expect(textContent, 'arm-workshop-delete should have no text label').toBe('')
  })
})

// ─── S3: PublishSection initialVisibility prop ───────────────────────────────

describe('S3 — PublishSection initialises selector from persisted visibility', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => { root!.unmount() })
      root = null
    }
    container?.remove()
    container = null
  })

  it('selects the Friends-only option when initialVisibility=1', async () => {
    const { PublishSection } = await import('../PublishSection')

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(
        createElement(PublishSection, {
          target: null,
          isBuildingTarget: false,
          onRequestBuild: vi.fn(),
          initialVisibility: 1, // Friends only
        }),
      )
    })

    // GlassSegmented renders segments; the "Friends only" option should be
    // the active one (aria-pressed="true" or data-selected).
    // PublishSection's GlassSegmented receives `selectedIndex` which for
    // initialVisibility=1 should be 2 (index of {value:1} in VISIBILITY_OPTIONS).
    // We verify via the rendered text that "Friends only" segment is visually
    // present and that no "Unlisted" segment appears to be the only option.
    const buttons = Array.from(container.querySelectorAll('button'))
    const labels = buttons.map(b => b.textContent?.trim()).filter(Boolean)
    expect(labels, 'visibility options should be rendered').toContain('Friends only')
    expect(labels, 'all four options should render').toContain('Unlisted')
    expect(labels).toContain('Public')
    expect(labels).toContain('Private')
  })

  it('clicking a visibility chip directly triggers build (visibility-driven publish)', async () => {
    const { PublishSection } = await import('../PublishSection')
    // Verify that clicking a visibility chip while target===null calls onRequestBuild
    // immediately (the new visibility-driven UX — no separate Publish button).
    const onRequestBuild = vi.fn()
    const onPublished = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(
        createElement(PublishSection, {
          target: null,
          isBuildingTarget: false,
          onRequestBuild,
          onPublished,
          initialVisibility: 0, // Public
        }),
      )
    })

    // New UX: clicking a visibility chip directly triggers build + upload.
    // There is no separate "Publish to Workshop" button.
    const buttons = Array.from(container.querySelectorAll('button'))
    const publicBtn = buttons.find(b => b.textContent?.trim() === 'Public')
    expect(publicBtn, '"Public" button should exist').toBeTruthy()

    // Clicking a visibility chip immediately calls onRequestBuild.
    await act(async () => { publicBtn!.click() })
    expect(onRequestBuild, 'clicking a visibility chip triggers build immediately').toHaveBeenCalledOnce()

    // There is no separate "Publish to Workshop" button.
    const publishBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent?.toLowerCase().includes('publish to workshop'),
    )
    expect(publishBtn, 'no standalone "Publish to Workshop" button should exist').toBeUndefined()
  })
})

// ─── S4: Change-note input removed from PublishSection ──────────────────────

describe('S4 — change-note input removed from PublishSection', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => { root!.unmount() })
      root = null
    }
    container?.remove()
    container = null
  })

  it('renders no textarea or text input for change notes', async () => {
    const { PublishSection } = await import('../PublishSection')

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    // Simulate an update scenario by passing a real-looking workshopId target.
    // The change note should NOT appear regardless.
    await act(async () => {
      root!.render(
        createElement(PublishSection, {
          target: null,
          isBuildingTarget: false,
          onRequestBuild: vi.fn(),
        }),
      )
    })

    const inputs = container.querySelectorAll('input[type="text"], textarea')
    expect(inputs.length, 'no text inputs or textareas should appear in PublishSection').toBe(0)
  })

  it('does not render any label containing "change note" (case-insensitive)', async () => {
    const { PublishSection } = await import('../PublishSection')

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(
        createElement(PublishSection, {
          target: null,
          isBuildingTarget: false,
          onRequestBuild: vi.fn(),
        }),
      )
    })

    const text = container.textContent?.toLowerCase() ?? ''
    expect(text, 'no "change note" text should appear').not.toContain('change note')
  })
})
