/**
 * Tests for ExportTilePreview — the large hover card that mirrors the
 * in-game CoH2 shop "skin preview" panel.
 *
 * Contract pinned here:
 *
 *  Surface
 *  - Rendered as a `position: fixed` card with `zIndex: 100` and
 *    `pointerEvents: 'none'` so it can never intercept hover from the
 *    source tile that owns enter/leave.
 *  - Sized exactly 340×280 CSS pixels.
 *
 *  Header
 *  - Faction label (OstHeer / OKW / Soviet / USF / UKF) comes from
 *    FACTION_LABELS and is uppercase tracked gold text.
 *  - Vehicle displayName from VEHICLES; falls back to "No vehicle
 *    assigned" when the slot has no vehicle entries AND no default for
 *    the slot's primary faction is registered.
 *  - Season pill renders the literal `slot.season` ('summer' | 'winter').
 *
 *  Body (3D render zone)
 *  - Initially mounts a "rendering…" placeholder when a vehicle is
 *    resolved (rather than an `<img>`). When no vehicle resolves at all
 *    it switches to "no vehicle".
 *  - The main decal badge is mounted top-left ONLY when a decal image
 *    URL resolves. Resolution order:
 *      1. `slot.mainDecalId` (slot-level override) hits any vehicle or
 *         faction-default decal with that id.
 *      2. Otherwise the primary vehicle's mainDecalId.
 *      3. Otherwise the faction default's mainDecalId.
 *      4. Otherwise: no badge.
 *  - Four ornamental gold CornerAccent SVGs are always present.
 *
 *  Footer
 *  - Shows `slot.label` when present, falling back to
 *    `${Capitalised season} slot ${slotIdx + 1}`.
 *  - Shows `summariseSlot` output: "empty slot — no edits yet" when
 *    nothing is configured, otherwise "<N> vehicle(s)" and/or
 *    "<N> faction default(s)" joined with " · ".
 *
 *  Vehicle-3D renderer is mocked so jsdom doesn't have to evaluate
 *  Three.js. The mock resolves never — we only assert the initial
 *  placeholder state, which is what ships on the very first hover frame
 *  anyway.
 *
 *  Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import type { Coh2SkinProject, ExportSlot, VehicleProject, FactionDefault } from '@/lib/project'

// ── Module mocks ─────────────────────────────────────────────────────────────
// vehicle-3d-renderer is dynamically imported inside ExportTilePreview. We
// stub the export with a promise that never resolves, so the body stays
// in the "rendering…" placeholder state for the duration of the test.
vi.mock('@/lib/vehicle-3d-renderer', () => ({
  renderVehicleSilhouette: () => new Promise(() => {}),
}))

const { default: ExportTilePreview } = await import('../ExportTilePreview')

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(props: { slot: ExportSlot; project: Coh2SkinProject; anchorRect?: DOMRect }) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(ExportTilePreview, {
        slot: props.slot,
        anchorRect: props.anchorRect ?? makeRect(400, 200),
        project: props.project,
        // FileSystemDirectoryHandle is only consumed by the mocked renderer.
        installRoot: {} as unknown as FileSystemDirectoryHandle,
      }),
    )
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

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeRect(left: number, top: number, w = 80, h = 80): DOMRect {
  return {
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function emptySlot(over: Partial<ExportSlot> = {}): ExportSlot {
  return {
    id: 'slot-1',
    slotIdx: 0,
    season: 'summer',
    label: '',
    description: '',
    factions: ['german'],
    authorCredit: '',
    mainDecalId: null,
    state: { vehicles: {}, factionDefaults: {} },
    ...over,
  }
}

function vehicleProj(over: Partial<VehicleProject> & Pick<VehicleProject, 'id'>): VehicleProject {
  return {
    tac: null,
    name: null,
    decals: [],
    ...over,
  }
}

function factionDefault(over: Partial<FactionDefault> = {}): FactionDefault {
  return {
    camoPreset: null,
    customDiffuseUrl: null,
    decals: [],
    mainDecalId: null,
    ...over,
  }
}

function emptyProject(): Coh2SkinProject {
  return {
    images: {},
  } as unknown as Coh2SkinProject
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ExportTilePreview — surface contract', () => {
  it('renders as position:fixed with zIndex 100 and pointer-events:none', () => {
    const card = render({ slot: emptySlot(), project: emptyProject() })
    const fixed = card.firstElementChild as HTMLElement
    expect(fixed.style.position).toBe('fixed')
    expect(fixed.style.zIndex).toBe('100')
    expect(fixed.style.pointerEvents).toBe('none')
  })

  it('uses the documented 340×280 card dimensions', () => {
    const card = render({ slot: emptySlot(), project: emptyProject() })
    const fixed = card.firstElementChild as HTMLElement
    expect(fixed.style.width).toBe('340px')
    expect(fixed.style.height).toBe('280px')
  })
})

describe('ExportTilePreview — header', () => {
  it('renders the faction label from FACTION_LABELS for the slot primary faction', () => {
    render({ slot: emptySlot({ factions: ['soviet'] }), project: emptyProject() })
    // Soviet maps to "Soviet" in FACTION_LABELS.
    expect(container!.textContent).toContain('Soviet')
  })

  it('renders distinct labels for each faction (german→OstHeer, west_german→OKW)', () => {
    render({ slot: emptySlot({ factions: ['german'] }), project: emptyProject() })
    expect(container!.textContent).toContain('OstHeer')
    act(() => root!.unmount())
    root = createRoot(container!)
    act(() => {
      root!.render(
        createElement(ExportTilePreview, {
          slot: emptySlot({ factions: ['west_german'] }),
          anchorRect: makeRect(400, 200),
          project: emptyProject(),
          installRoot: {} as unknown as FileSystemDirectoryHandle,
        }),
      )
    })
    expect(container!.textContent).toContain('OKW')
  })

  it('renders the season pill text', () => {
    render({ slot: emptySlot({ season: 'winter' }), project: emptyProject() })
    expect(container!.textContent).toContain('winter')
  })

  it('renders the resolved vehicle displayName when the slot has a vehicle', () => {
    render({
      slot: emptySlot({
        factions: ['german'],
        state: {
          vehicles: { tiger: vehicleProj({ id: 'tiger' }) },
          factionDefaults: {},
        },
      }),
      project: emptyProject(),
    })
    // Tiger I is the displayName in VEHICLES for id 'tiger'.
    expect(container!.textContent).toContain('Tiger I')
  })

  it('falls back to the first vehicle of the slot faction when the snapshot has no vehicles', () => {
    render({
      slot: emptySlot({ factions: ['british'] }),
      project: emptyProject(),
    })
    // The first British vehicle in VEHICLES is the Churchill (id 'churchill').
    // Rather than pin which vehicle, pin that the placeholder text "No vehicle assigned"
    // is NOT shown — a faction fallback resolved.
    expect(container!.textContent).not.toContain('No vehicle assigned')
  })
})

describe('ExportTilePreview — body', () => {
  it('shows the "rendering…" placeholder when a vehicle is resolved but the 3D render is pending', () => {
    render({
      slot: emptySlot({
        state: {
          vehicles: { tiger: vehicleProj({ id: 'tiger' }) },
          factionDefaults: {},
        },
      }),
      project: emptyProject(),
    })
    expect(container!.textContent).toContain('rendering…')
    // No body silhouette <img> yet — only renders once the silhouette URL
    // lands. The faction heraldic emblem (FACTION_ICONS) DOES mount an
    // <img> in the header, so we explicitly exclude /factions/*.
    const imgs = Array.from(container!.querySelectorAll('img'))
    const nonFaction = imgs.filter(img => !img.src.includes('/factions/'))
    expect(nonFaction).toHaveLength(0)
  })

  it('does NOT mount the body <img> while the dynamic 3D renderer is pending', () => {
    render({
      slot: emptySlot({
        state: {
          vehicles: { tiger: vehicleProj({ id: 'tiger' }) },
          factionDefaults: {},
        },
      }),
      project: emptyProject(),
    })
    const imgs = Array.from(container!.querySelectorAll('img'))
    // The only <img>s in the card would be the decal badge (absent here)
    // and the body silhouette (pending). FACTION_ICONS DO render <img>
    // tags for the heraldic emblem inside the header circle — filter
    // those out by alt="".
    const bodyImgs = imgs.filter(img => img.classList.contains('object-contain'))
    // Decal badge + body silhouette both use object-contain; here neither
    // should be present yet.
    expect(bodyImgs).toHaveLength(0)
  })

  it('renders all four ornamental CornerAccent svgs', () => {
    render({ slot: emptySlot(), project: emptyProject() })
    // CornerAccent svgs have width="12" height="12" and a path with
    // stroke #caa45a. Easier to count: svgs that have a child <path>
    // with d="M 0 2 L 0 0 L 2 0".
    const svgs = Array.from(container!.querySelectorAll('svg'))
    const corners = svgs.filter(svg => {
      const path = svg.querySelector('path')
      return path?.getAttribute('d') === 'M 0 2 L 0 0 L 2 0'
    })
    expect(corners).toHaveLength(4)
  })
})

describe('ExportTilePreview — main decal badge resolution', () => {
  it('renders the decal badge from a slot-level mainDecalId override', () => {
    const slot = emptySlot({
      mainDecalId: 42,
      state: {
        vehicles: {
          tiger: vehicleProj({
            id: 'tiger',
            decals: [
              {
                id: 42,
                imageId: 'img-A',
                // Other Decal fields don't matter for ExportTilePreview.
              } as unknown as VehicleProject['decals'][number],
            ],
          }),
        },
        factionDefaults: {},
      },
    })
    const project = {
      images: {
        'img-A': {
          id: 'img-A',
          name: 'decalA.png',
          dataUrl: 'data:image/png;base64,AAAA',
          width: 64,
          height: 64,
        },
      },
    } as unknown as Coh2SkinProject
    render({ slot, project })
    const decalImg = Array.from(container!.querySelectorAll('img')).find(
      img => img.src === 'data:image/png;base64,AAAA',
    )
    expect(decalImg).toBeDefined()
  })

  it('falls back to the primary vehicle mainDecalId when slot has no override', () => {
    const slot = emptySlot({
      mainDecalId: null,
      state: {
        vehicles: {
          tiger: vehicleProj({
            id: 'tiger',
            mainDecalId: 7,
            decals: [
              {
                id: 7,
                imageId: 'img-V',
              } as unknown as VehicleProject['decals'][number],
            ],
          }),
        },
        factionDefaults: {},
      },
    })
    const project = {
      images: {
        'img-V': {
          id: 'img-V',
          name: 'v.png',
          dataUrl: 'data:image/png;base64,BBBB',
          width: 64,
          height: 64,
        },
      },
    } as unknown as Coh2SkinProject
    render({ slot, project })
    const decalImg = Array.from(container!.querySelectorAll('img')).find(
      img => img.src === 'data:image/png;base64,BBBB',
    )
    expect(decalImg).toBeDefined()
  })

  it('falls back to the faction-default mainDecalId when the primary vehicle has none', () => {
    const slot = emptySlot({
      factions: ['german'],
      state: {
        vehicles: {
          tiger: vehicleProj({ id: 'tiger', mainDecalId: null }),
        },
        factionDefaults: {
          german: factionDefault({
            mainDecalId: 3,
            decals: [
              {
                id: 3,
                imageId: 'img-F',
              } as unknown as FactionDefault['decals'][number],
            ],
          }),
        },
      },
    })
    const project = {
      images: {
        'img-F': {
          id: 'img-F',
          name: 'f.png',
          dataUrl: 'data:image/png;base64,CCCC',
          width: 64,
          height: 64,
        },
      },
    } as unknown as Coh2SkinProject
    render({ slot, project })
    const decalImg = Array.from(container!.querySelectorAll('img')).find(
      img => img.src === 'data:image/png;base64,CCCC',
    )
    expect(decalImg).toBeDefined()
  })

  it('renders NO decal badge when nothing in the resolution chain has a main decal', () => {
    render({ slot: emptySlot(), project: emptyProject() })
    // No image whose src is a data URL (other than potentially future
    // body silhouette which is pending). The faction icon is the only
    // <img> present and its src is /factions/german.png.
    const imgs = Array.from(container!.querySelectorAll('img'))
    const dataUrls = imgs.filter(img => img.src.startsWith('data:'))
    expect(dataUrls).toHaveLength(0)
  })
})

describe('ExportTilePreview — footer', () => {
  it('uses slot.label when provided', () => {
    render({
      slot: emptySlot({ label: 'SS Totenkopf Division' }),
      project: emptyProject(),
    })
    expect(container!.textContent).toContain('SS Totenkopf Division')
  })

  it('falls back to "<Season> slot <slotIdx + 1>" when label is empty', () => {
    render({
      slot: emptySlot({ label: '', season: 'winter', slotIdx: 2 }),
      project: emptyProject(),
    })
    expect(container!.textContent).toContain('Winter slot 3')
  })

  it('summary line shows "empty slot — no edits yet" for an empty slot', () => {
    render({ slot: emptySlot(), project: emptyProject() })
    expect(container!.textContent).toContain('empty slot — no edits yet')
  })

  it('summary line shows vehicle count when slot has vehicles', () => {
    render({
      slot: emptySlot({
        state: {
          vehicles: {
            tiger: vehicleProj({ id: 'tiger' }),
            elefant: vehicleProj({ id: 'elefant' }),
          },
          factionDefaults: {},
        },
      }),
      project: emptyProject(),
    })
    expect(container!.textContent).toContain('2 vehicles')
  })

  it('summary line uses singular "1 vehicle" when exactly one vehicle is configured', () => {
    render({
      slot: emptySlot({
        state: {
          vehicles: { tiger: vehicleProj({ id: 'tiger' }) },
          factionDefaults: {},
        },
      }),
      project: emptyProject(),
    })
    expect(container!.textContent).toContain('1 vehicle')
    expect(container!.textContent).not.toContain('1 vehicles')
  })

  it('summary line joins vehicle and faction-default counts with " · " when both present', () => {
    render({
      slot: emptySlot({
        state: {
          vehicles: { tiger: vehicleProj({ id: 'tiger' }) },
          factionDefaults: {
            german: factionDefault(),
            soviet: factionDefault(),
          },
        },
      }),
      project: emptyProject(),
    })
    expect(container!.textContent).toContain('1 vehicle · 2 faction defaults')
  })

  it('singular "1 faction default" when exactly one faction default is set', () => {
    render({
      slot: emptySlot({
        state: {
          vehicles: {},
          factionDefaults: { german: factionDefault() },
        },
      }),
      project: emptyProject(),
    })
    expect(container!.textContent).toContain('1 faction default')
    expect(container!.textContent).not.toContain('1 faction defaults')
  })
})

describe('ExportTilePreview — positioning', () => {
  it('positions the card to the left of the anchor when there is room', () => {
    // anchor near the right side — left placement should fit because
    // CARD_W (340) + margin (12) = 352 < anchorLeft (600).
    render({
      slot: emptySlot(),
      project: emptyProject(),
      anchorRect: makeRect(600, 200),
    })
    const fixed = container!.firstElementChild as HTMLElement
    const leftPx = parseInt(fixed.style.left, 10)
    // Should be anchorLeft (600) - CARD_W (340) - margin (12) = 248.
    expect(leftPx).toBe(600 - 340 - 12)
  })

  it('flips to the right of the anchor when there is no room on the left', () => {
    // anchor near the left edge — left placement would be negative,
    // so the card flips right.
    render({
      slot: emptySlot(),
      project: emptyProject(),
      anchorRect: makeRect(20, 200),
    })
    const fixed = container!.firstElementChild as HTMLElement
    const leftPx = parseInt(fixed.style.left, 10)
    // anchor.right (20 + 80) + margin (12) = 112.
    expect(leftPx).toBe(20 + 80 + 12)
  })
})
