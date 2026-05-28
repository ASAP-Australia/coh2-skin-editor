/**
 * Tests for SavedProjectsList.
 *
 * Strategy: mock localStorage via vi.spyOn(Storage.prototype) so that
 * getRecentProjects / getRecentFaceplates / readRecent read controlled
 * data without hitting a real store. Mutations (setItem/removeItem) are
 * captured into a Map so delete tests can assert that both the recent
 * list AND the per-id snapshot are scrubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import SavedProjectsList from '../SavedProjectsList'

// ── RECENT_KEY constants (must match the lib files exactly) ──────────────────
const SKIN_KEY = 'coh2.recentProjects'
const FACEPLATE_KEY = 'coh2.recentFaceplates'
const DECAL_KEY = 'coh2.recentDecalPacks'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Backing store for the spied localStorage. Tests can read it to verify
 *  what removeRecent* wrote, or seed it via seedLocalStorage. */
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
  // Storage.prototype.key / length are required by the new `listAllX`
  // readers (which walk every per-id snapshot by prefix) so they can
  // enumerate keys via index.
  vi.spyOn(Storage.prototype, 'key').mockImplementation((index: number) => {
    return Array.from(storage.keys())[index] ?? null
  })
  vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => storage.size)
}

/** Build a minimal valid skin-project snapshot whose id matches the key
 *  so `listAllSkinProjects()` enumerates it without crashing during
 *  migration. The schema fields are the bare minimum that satisfy
 *  `migrateIfNeeded`'s v2 short-circuit (no migration runs). */
function validSkinSnapshot(id: string, packName: string): string {
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
  })
}

/** Build a minimal valid faceplate-project snapshot. Layers is empty so
 *  the v0→v1 layer-kind backfill runs over zero elements (no-op). */
function validFaceplateSnapshot(id: string, packName: string): string {
  return JSON.stringify({
    magic: 'coh2-faceplate-project',
    version: 2,
    id,
    packName,
    layers: [],
    modifiedAt: new Date().toISOString(),
  })
}

/** Build a minimal valid decal-pack snapshot. Version 4 short-circuits
 *  every migration path. Note the magic is `coh2-decalpack-project`
 *  (one word) — earlier test fixtures here used the wrong hyphenated
 *  spelling, which the new validating loader correctly rejects. */
function validDecalPackSnapshot(id: string, packName: string): string {
  return JSON.stringify({
    magic: 'coh2-decalpack-project',
    version: 4,
    id,
    packName,
    decals: [],
    sourceImages: {},
    modifiedAt: new Date().toISOString(),
  })
}

function makeProps(overrides: Partial<Parameters<typeof SavedProjectsList>[0]> = {}) {
  return {
    onPickSkin: vi.fn(),
    onPickFaceplate: vi.fn(),
    onPickDecalPack: vi.fn(),
    onBack: vi.fn(),
    onPickFromDisk: vi.fn(),
    ...overrides,
  }
}

/** Find the main load-button for a given row title. Skips the
 *  delete/confirm/cancel buttons that share the row by ignoring
 *  buttons with an aria-label (those are the action buttons; the
 *  load button has no aria-label and includes the title text). */
function findLoadButton(el: HTMLElement, title: string): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll('button')).find(b => {
    if (b.getAttribute('aria-label')) return false
    return b.textContent?.includes(title)
  }) as HTMLButtonElement | undefined
  expect(btn).toBeTruthy()
  return btn!
}

/** Find the trash-arm button for a row by aria-label. */
function findArmButton(el: HTMLElement, title: string): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll('button')).find(
    b => b.getAttribute('aria-label') === `Delete ${title}`,
  ) as HTMLButtonElement | undefined
  expect(btn).toBeTruthy()
  return btn!
}

// ── DOM harness ──────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(ui: React.ReactElement) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(ui)
  })
  return container!
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SavedProjectsList', () => {
  describe('with saved projects', () => {
    const skinEntry = {
      id: 'skin_abc',
      name: 'Desert Fox',
      faction: 'german',
      lastEditedAt: Date.now() - 60_000 * 5, // 5 min ago
      vehicleCount: 2,
      decalCount: 3,
    }

    const faceplateEntry = {
      id: 'fp_xyz',
      name: 'Iron Cross',
      lastEditedAt: Date.now() - 60_000 * 60, // 1 hour ago
      layerCount: 4,
      thumbnail: null,
    }

    const decalEntry = {
      id: 'dp_qrs',
      packName: 'Eastern Front Insignia',
      decalCount: 10,
      lastEditedAt: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
    }

    beforeEach(() => {
      seedLocalStorage({
        [SKIN_KEY]: JSON.stringify([skinEntry]),
        [FACEPLATE_KEY]: JSON.stringify([faceplateEntry]),
        [DECAL_KEY]: JSON.stringify([decalEntry]),
        // Per-id snapshots are now required by the listAllX readers,
        // which prefix-walk localStorage and validate each entry via its
        // loader. Without these, the test entries would be silently
        // dropped as "broken".
        'coh2.project.skin_abc': validSkinSnapshot('skin_abc', 'Desert Fox'),
        'coh2.faceplate.fp_xyz': validFaceplateSnapshot('fp_xyz', 'Iron Cross'),
        'coh2.decalpack.dp_qrs': validDecalPackSnapshot('dp_qrs', 'Eastern Front Insignia'),
      })
    })

    it('renders all three group entries', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      expect(el.textContent).toContain('Desert Fox')
      expect(el.textContent).toContain('Iron Cross')
      expect(el.textContent).toContain('Eastern Front Insignia')
    })

    it('renders group headers', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      expect(el.textContent).toMatch(/Skin packs/i)
      expect(el.textContent).toMatch(/Faceplates/i)
      expect(el.textContent).toMatch(/Decal packs/i)
    })

    it('wraps the lists in a height-capped scroll container with a custom scrollbar', () => {
      // Regression for the "load project menu overflows the dialog when
      // the user has many saved projects" bug. The lists must be
      // scrollable on the y-axis, the height must be capped to a
      // reasonable maximum, and the `custom-scrollbar` opt-in class
      // must be present so the scrollbar is actually visible (the
      // app-wide default hides them).
      const el = render(createElement(SavedProjectsList, makeProps()))
      const scroller = el.querySelector('[data-testid="saved-projects-scroll"]') as HTMLElement
      expect(scroller).not.toBeNull()
      expect(scroller.classList.contains('custom-scrollbar')).toBe(true)
      expect(scroller.classList.contains('overflow-y-auto')).toBe(true)
      // maxHeight is set via inline style so it survives Tailwind
      // arbitrary-value purges across builds. Tightened from
      // 60vh/480px → 55vh/440px → 42vh/360px → 40vh/320px → 50vh/360px
      // → 40vh/280px.  Reduced again after the card height was overflowing
      // the minimum Electron window (600 px): at min(50vh, 360px) the
      // total card was ~568 px with only 16 px margin on a 600 px viewport;
      // HeightTransition's highWaterMark could inflate it further.
      // min(40vh, 280px) budgets ~512 px total card height at 600 px,
      // leaving a comfortable 44 px each side.
      expect(scroller.style.maxHeight).toBe('min(40vh, 280px)')
    })

    it('keeps the "Open from disk" button outside the scroll area', () => {
      // The disk-fallback button must remain reachable even when the
      // project list overflows — it lives below the scroll container,
      // not inside it.
      const el = render(createElement(SavedProjectsList, makeProps()))
      const scroller = el.querySelector('[data-testid="saved-projects-scroll"]') as HTMLElement
      const diskBtn = Array.from(el.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Open from disk'),
      ) as HTMLButtonElement
      expect(scroller).not.toBeNull()
      expect(diskBtn).not.toBeNull()
      // contains() returns false when the button is a sibling (or in a
      // sibling subtree) of the scroller — exactly what we want.
      expect(scroller.contains(diskBtn)).toBe(false)
    })

    it('calls onPickSkin with the correct id when skin row is clicked', () => {
      const onPickSkin = vi.fn()
      const el = render(createElement(SavedProjectsList, makeProps({ onPickSkin })))
      act(() => {
        findLoadButton(el, 'Desert Fox').click()
      })
      expect(onPickSkin).toHaveBeenCalledOnce()
      expect(onPickSkin).toHaveBeenCalledWith('skin_abc')
    })

    it('calls onPickFaceplate with the correct id when faceplate row is clicked', () => {
      const onPickFaceplate = vi.fn()
      const el = render(createElement(SavedProjectsList, makeProps({ onPickFaceplate })))
      act(() => {
        findLoadButton(el, 'Iron Cross').click()
      })
      expect(onPickFaceplate).toHaveBeenCalledOnce()
      expect(onPickFaceplate).toHaveBeenCalledWith('fp_xyz')
    })

    it('calls onPickDecalPack with the correct id when decal row is clicked', () => {
      const onPickDecalPack = vi.fn()
      const el = render(createElement(SavedProjectsList, makeProps({ onPickDecalPack })))
      act(() => {
        findLoadButton(el, 'Eastern Front Insignia').click()
      })
      expect(onPickDecalPack).toHaveBeenCalledOnce()
      expect(onPickDecalPack).toHaveBeenCalledWith('dp_qrs')
    })

    it('calls onBack when the Back button is clicked', () => {
      const onBack = vi.fn()
      const el = render(createElement(SavedProjectsList, makeProps({ onBack })))

      const backBtn = Array.from(el.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Back'),
      ) as HTMLButtonElement
      expect(backBtn).not.toBeNull()
      act(() => {
        backBtn.click()
      })
      expect(onBack).toHaveBeenCalledOnce()
    })

    it('calls onPickFromDisk when "Open from disk" button is clicked', () => {
      const onPickFromDisk = vi.fn()
      const el = render(createElement(SavedProjectsList, makeProps({ onPickFromDisk })))

      const diskBtn = Array.from(el.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Open from disk'),
      ) as HTMLButtonElement
      expect(diskBtn).not.toBeNull()
      act(() => {
        diskBtn.click()
      })
      expect(onPickFromDisk).toHaveBeenCalledOnce()
    })
  })

  describe('delete affordance', () => {
    const skinEntry = {
      id: 'skin_del',
      name: 'Doomed Pack',
      faction: 'german',
      lastEditedAt: Date.now() - 60_000,
      vehicleCount: 1,
      decalCount: 0,
    }

    const faceplateEntry = {
      id: 'fp_del',
      name: 'Doomed Faceplate',
      lastEditedAt: Date.now() - 60_000,
      layerCount: 1,
      thumbnail: null,
    }

    const decalEntry = {
      id: 'dp_del',
      packName: 'Doomed Decals',
      decalCount: 1,
      lastEditedAt: new Date(Date.now() - 60_000).toISOString(),
    }

    beforeEach(() => {
      seedLocalStorage({
        [SKIN_KEY]: JSON.stringify([skinEntry]),
        [FACEPLATE_KEY]: JSON.stringify([faceplateEntry]),
        [DECAL_KEY]: JSON.stringify([decalEntry]),
        // Per-id snapshots — should also be cleared on delete. The
        // listAllX readers require these to be valid (correct magic +
        // schema) so the entries actually appear in the rendered list.
        'coh2.project.skin_del': validSkinSnapshot('skin_del', 'Doomed Pack'),
        'coh2.faceplate.fp_del': validFaceplateSnapshot('fp_del', 'Doomed Faceplate'),
        'coh2.decalpack.dp_del': validDecalPackSnapshot('dp_del', 'Doomed Decals'),
      })
    })

    it('renders a trash button per row by default (no confirm UI)', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      // One arm-delete button for each of the 3 seeded rows.
      const armBtns = el.querySelectorAll('[data-testid="arm-delete"]')
      expect(armBtns.length).toBe(3)
      // No confirm/cancel buttons visible yet.
      expect(el.querySelectorAll('[data-testid="confirm-delete"]').length).toBe(0)
      expect(el.querySelectorAll('[data-testid="cancel-delete"]').length).toBe(0)
    })

    it('first trash click reveals confirm + cancel buttons for that row only', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      act(() => {
        findArmButton(el, 'Doomed Pack').click()
      })
      // The armed row now shows confirm + cancel.
      expect(el.querySelectorAll('[data-testid="confirm-delete"]').length).toBe(1)
      expect(el.querySelectorAll('[data-testid="cancel-delete"]').length).toBe(1)
      // Other two rows still show arm-delete (3 total − 1 armed = 2).
      expect(el.querySelectorAll('[data-testid="arm-delete"]').length).toBe(2)
    })

    it('clicking the load button on an unarmed row still fires onPickSkin (delete UI is non-blocking)', () => {
      const onPickSkin = vi.fn()
      const el = render(createElement(SavedProjectsList, makeProps({ onPickSkin })))
      // Arm a different row's trash — the skin row is still unarmed.
      act(() => {
        findArmButton(el, 'Doomed Faceplate').click()
      })
      // Skin row's load button should still work normally.
      act(() => {
        findLoadButton(el, 'Doomed Pack').click()
      })
      expect(onPickSkin).toHaveBeenCalledOnce()
      expect(onPickSkin).toHaveBeenCalledWith('skin_del')
    })

    it('cancel button reverts the row to its default state', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      act(() => {
        findArmButton(el, 'Doomed Pack').click()
      })
      act(() => {
        ;(el.querySelector('[data-testid="cancel-delete"]') as HTMLButtonElement).click()
      })
      expect(el.querySelectorAll('[data-testid="confirm-delete"]').length).toBe(0)
      expect(el.querySelectorAll('[data-testid="arm-delete"]').length).toBe(3)
    })

    it('arming a different row disarms the first (only one row armed at a time)', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      act(() => {
        findArmButton(el, 'Doomed Pack').click()
      })
      expect(el.querySelectorAll('[data-testid="confirm-delete"]').length).toBe(1)
      act(() => {
        findArmButton(el, 'Doomed Faceplate').click()
      })
      // Still exactly one confirm visible — the faceplate's, not the skin's.
      expect(el.querySelectorAll('[data-testid="confirm-delete"]').length).toBe(1)
    })

    it('confirming a skin delete removes the row, scrubs the recent list, and removes the per-id snapshot', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      act(() => {
        findArmButton(el, 'Doomed Pack').click()
      })
      act(() => {
        ;(el.querySelector('[data-testid="confirm-delete"]') as HTMLButtonElement).click()
      })
      // Row is gone from the DOM.
      expect(el.textContent).not.toContain('Doomed Pack')
      // Skin packs section is gone too (it was the only entry).
      expect(el.textContent).not.toMatch(/Skin packs/i)
      // localStorage: recent list scrubbed.
      const recent = JSON.parse(storage.get(SKIN_KEY) ?? '[]')
      expect(recent.find((e: { id: string }) => e.id === 'skin_del')).toBeUndefined()
      // Per-id snapshot wiped.
      expect(storage.has('coh2.project.skin_del')).toBe(false)
    })

    it('confirming a faceplate delete removes its per-id snapshot too', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      act(() => {
        findArmButton(el, 'Doomed Faceplate').click()
      })
      act(() => {
        ;(el.querySelector('[data-testid="confirm-delete"]') as HTMLButtonElement).click()
      })
      expect(el.textContent).not.toContain('Doomed Faceplate')
      const recent = JSON.parse(storage.get(FACEPLATE_KEY) ?? '[]')
      expect(recent.find((e: { id: string }) => e.id === 'fp_del')).toBeUndefined()
      expect(storage.has('coh2.faceplate.fp_del')).toBe(false)
    })

    it('confirming a decal pack delete removes its per-id snapshot too', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      act(() => {
        findArmButton(el, 'Doomed Decals').click()
      })
      act(() => {
        ;(el.querySelector('[data-testid="confirm-delete"]') as HTMLButtonElement).click()
      })
      expect(el.textContent).not.toContain('Doomed Decals')
      const recent = JSON.parse(storage.get(DECAL_KEY) ?? '[]')
      expect(recent.find((e: { id: string }) => e.id === 'dp_del')).toBeUndefined()
      expect(storage.has('coh2.decalpack.dp_del')).toBe(false)
    })

    it('deleting the only row in a group hides the group header and falls back to empty state when nothing is left', () => {
      // Seed only ONE row this time.
      seedLocalStorage({
        [SKIN_KEY]: JSON.stringify([skinEntry]),
        'coh2.project.skin_del': validSkinSnapshot('skin_del', 'Doomed Pack'),
      })
      const el = render(createElement(SavedProjectsList, makeProps()))
      act(() => {
        findArmButton(el, 'Doomed Pack').click()
      })
      act(() => {
        ;(el.querySelector('[data-testid="confirm-delete"]') as HTMLButtonElement).click()
      })
      // List should now show the empty-state message.
      expect(el.textContent).toContain('No saved projects yet')
    })
  })

  describe('empty state', () => {
    beforeEach(() => {
      seedLocalStorage({})
    })

    it('renders the empty-state message when localStorage is clean', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      expect(el.textContent).toContain('No saved projects yet')
    })

    it('does NOT render group headers in the empty state', () => {
      const el = render(createElement(SavedProjectsList, makeProps()))
      expect(el.textContent).not.toMatch(/Skin packs/i)
      expect(el.textContent).not.toMatch(/Faceplates/i)
      expect(el.textContent).not.toMatch(/Decal packs/i)
    })

    it('calls onPickFromDisk from the empty-state disk button', () => {
      const onPickFromDisk = vi.fn()
      const el = render(createElement(SavedProjectsList, makeProps({ onPickFromDisk })))

      const diskBtn = Array.from(el.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Open from disk'),
      ) as HTMLButtonElement
      expect(diskBtn).not.toBeNull()
      act(() => {
        diskBtn.click()
      })
      expect(onPickFromDisk).toHaveBeenCalledOnce()
    })
  })

  describe('partial data', () => {
    it('shows only the groups that have entries', () => {
      seedLocalStorage({
        [SKIN_KEY]: JSON.stringify([
          {
            id: 'skin_only',
            name: 'Only Skin',
            faction: 'soviet',
            lastEditedAt: Date.now(),
            vehicleCount: 1,
            decalCount: 0,
          },
        ]),
        // Per-id snapshot needed so listAllSkinProjects() actually
        // surfaces this entry.
        'coh2.project.skin_only': validSkinSnapshot('skin_only', 'Only Skin'),
      })
      const el = render(createElement(SavedProjectsList, makeProps()))
      expect(el.textContent).toContain('Only Skin')
      expect(el.textContent).toMatch(/Skin packs/i)
      // No faceplate or decal pack sections
      expect(el.textContent).not.toMatch(/Faceplates/i)
      expect(el.textContent).not.toMatch(/Decal packs/i)
    })
  })
})
