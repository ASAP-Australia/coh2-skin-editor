/**
 * Tests for StartScreen — the post-Connect routing panel.
 *
 * StartScreen renders inside an AuthShell glass card and offers users
 * four primary paths:
 *   1. Continue last session  (Continue card — only when there's a saved
 *      project of ANY kind; picks the most-recently-modified across all
 *      three kinds when several exist).
 *   2. New Skin Pack          (orange-tinted action row → onNewSkin)
 *   3. New Faceplate          (blue-tinted action row → onNewFaceplate)
 *   4. New Decal Pack         (purple-tinted action row → onNewDecalPack)
 *   5. Load Project           (green-tinted action row → onShowSavedProjects)
 *
 * Plus a hidden `<input type="file">` plumbing extension-sniffed loads
 * via `onLoadSkin` / `onLoadFaceplate` / `onLoadDecalPack` — but the
 * v1.0 UI now routes "Load" through `onShowSavedProjects` (a separate
 * saved-projects list screen), so the hidden file input is no longer
 * surfaced from this screen directly; it sits dormant for backward
 * compat with reusable callers.
 *
 * The four loaders (`loadActive`, `loadActiveFaceplate`,
 * `loadActiveDecalPackFromLocal`) are module-mocked so the test
 * controls exactly which kinds are present in localStorage.
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import type { Coh2SkinProject } from '@/lib/project'
import type { Coh2FaceplateProject } from '@/lib/faceplate-project'
import type { Coh2DecalPackProject } from '@/lib/decal-pack-project'

// ── Module mocks ─────────────────────────────────────────────────────────────
// Mock each project loader so we control which kind is "active".
const mockSkin = vi.fn<() => Coh2SkinProject | null>(() => null)
const mockFaceplate = vi.fn<() => Coh2FaceplateProject | null>(() => null)
const mockDecalPack = vi.fn<() => Coh2DecalPackProject | null>(() => null)

vi.mock('@/lib/project', async orig => {
  const actual = await orig<typeof import('@/lib/project')>()
  return {
    ...actual,
    loadActive: () => mockSkin(),
  }
})
vi.mock('@/lib/faceplate-project', async orig => {
  const actual = await orig<typeof import('@/lib/faceplate-project')>()
  return {
    ...actual,
    loadActiveFaceplate: () => mockFaceplate(),
  }
})
vi.mock('@/lib/decal-pack-project', async orig => {
  const actual = await orig<typeof import('@/lib/decal-pack-project')>()
  return {
    ...actual,
    loadActiveDecalPackFromLocal: () => mockDecalPack(),
  }
})

// Import AFTER mocks so the component picks them up.
const { default: StartScreen } = await import('../StartScreen')

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

interface Handlers {
  onContinueSkin: ReturnType<typeof vi.fn>
  onNewSkin: ReturnType<typeof vi.fn>
  onNewFaceplate: ReturnType<typeof vi.fn>
  onNewDecalPack: ReturnType<typeof vi.fn>
  onLoadSkin: ReturnType<typeof vi.fn>
  onLoadFaceplate: ReturnType<typeof vi.fn>
  onLoadDecalPack: ReturnType<typeof vi.fn>
  onOpenRecentFaceplate: ReturnType<typeof vi.fn>
  onOpenRecentDecalPack: ReturnType<typeof vi.fn>
  onShowSavedProjects: ReturnType<typeof vi.fn>
}

function makeHandlers(): Handlers {
  return {
    onContinueSkin: vi.fn(),
    onNewSkin: vi.fn(),
    onNewFaceplate: vi.fn(),
    onNewDecalPack: vi.fn(),
    onLoadSkin: vi.fn(),
    onLoadFaceplate: vi.fn(),
    onLoadDecalPack: vi.fn(),
    onOpenRecentFaceplate: vi.fn(),
    onOpenRecentDecalPack: vi.fn(),
    onShowSavedProjects: vi.fn(),
  }
}

function render(props: { exiting?: boolean; handlers?: Handlers } = {}) {
  const h = props.handlers ?? makeHandlers()
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    // Vitest's vi.fn() default type doesn't satisfy the precise prop
    // signatures (e.g. (project: Coh2SkinProject) => void), so cast
    // through unknown — the mocks intercept the calls at runtime and
    // are interrogated via `.mock.calls` later in each test. The runtime
    // shape matches; only the static signatures diverge.
    root!.render(
      createElement(StartScreen, { exiting: props.exiting, ...h } as unknown as Parameters<
        typeof StartScreen
      >[0]),
    )
  })
  return { container: container!, handlers: h }
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
  mockSkin.mockReset()
  mockSkin.mockImplementation(() => null)
  mockFaceplate.mockReset()
  mockFaceplate.mockImplementation(() => null)
  mockDecalPack.mockReset()
  mockDecalPack.mockImplementation(() => null)
  vi.restoreAllMocks()
})

// ── Fixtures ────────────────────────────────────────────────────────────────

function fakeSkin(over: Partial<Coh2SkinProject> = {}): Coh2SkinProject {
  return {
    packName: 'Skin Test',
    packDescription: '',
    author: 'tester',
    modifiedAt: '2026-05-23T10:00:00.000Z',
    createdAt: '2026-05-23T10:00:00.000Z',
    schemaVersion: 2,
    vehicles: {},
    images: [],
    palette: [],
    factionDefaults: {},
    aiSessions: [],
    activeAiSessionId: null,
    iconCache: {},
    exportSlots: [],
    activeExportSlotId: null,
    activeSlotIdx: 0,
    ...over,
  } as unknown as Coh2SkinProject
}

function fakeFaceplate(over: Partial<Coh2FaceplateProject> = {}): Coh2FaceplateProject {
  return {
    packName: 'Faceplate Test',
    packDescription: '',
    author: 'tester',
    modifiedAt: '2026-05-23T10:00:00.000Z',
    createdAt: '2026-05-23T10:00:00.000Z',
    ...over,
  } as unknown as Coh2FaceplateProject
}

function fakeDecalPack(over: Partial<Coh2DecalPackProject> = {}): Coh2DecalPackProject {
  return {
    packName: 'Decalpack Test',
    packDescription: '',
    author: 'tester',
    modifiedAt: '2026-05-23T10:00:00.000Z',
    createdAt: '2026-05-23T10:00:00.000Z',
    ...over,
  } as unknown as Coh2DecalPackProject
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function rowByTitle(title: string): HTMLButtonElement | null {
  // Action rows are <button> with a <div> child whose text === title.
  return (
    Array.from(container!.querySelectorAll('button')).find(b =>
      Array.from(b.querySelectorAll('div')).some(d => d.textContent === title),
    ) ?? null
  )
}

function continueCard(): HTMLButtonElement | null {
  return (
    Array.from(container!.querySelectorAll('button')).find(b =>
      b.textContent?.toLowerCase().includes('continue ·'),
    ) ?? null
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StartScreen — four primary action rows', () => {
  it('renders the four canonical action rows in order: Skin → Faceplate → Decal → Load', () => {
    render()
    // Each row's title is the inner div that carries text-[14px] AND has
    // no child elements (raw text only). Walking by that class lets us
    // skip the parent flex container whose textContent concatenates
    // title + sublabel.
    const titles = Array.from(container!.querySelectorAll('div'))
      .filter(d => d.className.includes('text-[14px]') && d.children.length === 0)
      .map(d => d.textContent)
    expect(titles).toEqual(['New Skin Pack', 'New Faceplate', 'New Decal Pack', 'Load Project'])
  })

  it('each action row carries its descriptive sublabel', () => {
    render()
    expect(container!.textContent).toContain('Paint a vehicle livery')
    expect(container!.textContent).toContain('Player profile banner')
    expect(container!.textContent).toContain('A set of vehicle decals')
    expect(container!.textContent).toContain('Browse saved projects')
  })

  it('clicking "New Skin Pack" fires onNewSkin exactly once', () => {
    const { handlers } = render()
    act(() => rowByTitle('New Skin Pack')!.click())
    expect(handlers.onNewSkin).toHaveBeenCalledOnce()
  })

  it('clicking "New Faceplate" fires onNewFaceplate exactly once', () => {
    const { handlers } = render()
    act(() => rowByTitle('New Faceplate')!.click())
    expect(handlers.onNewFaceplate).toHaveBeenCalledOnce()
  })

  it('clicking "New Decal Pack" fires onNewDecalPack exactly once', () => {
    const { handlers } = render()
    act(() => rowByTitle('New Decal Pack')!.click())
    expect(handlers.onNewDecalPack).toHaveBeenCalledOnce()
  })

  it('clicking "Load Project" fires onShowSavedProjects (NOT the file picker — routes to saved-projects list)', () => {
    const { handlers } = render()
    act(() => rowByTitle('Load Project')!.click())
    expect(handlers.onShowSavedProjects).toHaveBeenCalledOnce()
    // Crucially: NOT onLoadSkin/onLoadFaceplate/onLoadDecalPack — those
    // belong to the file-input fallback path, not the visible CTA.
    expect(handlers.onLoadSkin).not.toHaveBeenCalled()
    expect(handlers.onLoadFaceplate).not.toHaveBeenCalled()
    expect(handlers.onLoadDecalPack).not.toHaveBeenCalled()
  })

  it('renders the hidden file input plumbing (accept=".coh2skin,.coh2faceplate,.coh2decalpack,.json")', () => {
    render()
    const input = container!.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.accept).toBe('.coh2skin,.coh2faceplate,.coh2decalpack,.json')
    // The input is `className="hidden"` — visually hidden but still in the DOM.
    expect(input.className).toContain('hidden')
  })
})

describe('StartScreen — continue card (no saved projects)', () => {
  it('does NOT render the Continue card when all three loaders return null', () => {
    render()
    expect(continueCard()).toBeNull()
  })
})

describe('StartScreen — continue card (single saved project)', () => {
  it('shows Continue · Skin pack when only a skin is saved', () => {
    mockSkin.mockReturnValue(fakeSkin({ packName: 'My Tigers' }))
    render()
    const card = continueCard()
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('Continue · Skin pack')
    expect(card!.textContent).toContain('My Tigers')
  })

  it('shows Continue · Faceplate when only a faceplate is saved', () => {
    mockFaceplate.mockReturnValue(fakeFaceplate({ packName: 'My Banner' }))
    render()
    expect(continueCard()!.textContent).toContain('Continue · Faceplate')
    expect(continueCard()!.textContent).toContain('My Banner')
  })

  it('shows Continue · Decal pack when only a decal pack is saved', () => {
    mockDecalPack.mockReturnValue(fakeDecalPack({ packName: 'My Stickers' }))
    render()
    expect(continueCard()!.textContent).toContain('Continue · Decal pack')
    expect(continueCard()!.textContent).toContain('My Stickers')
  })

  it('falls back to "Untitled project" when packName is empty', () => {
    mockSkin.mockReturnValue(fakeSkin({ packName: '' }))
    render()
    expect(continueCard()!.textContent).toContain('Untitled project')
  })
})

describe('StartScreen — continue card (most-recently-modified wins when multiple kinds exist)', () => {
  it('picks the skin when it is the most recently modified of three', () => {
    mockSkin.mockReturnValue(
      fakeSkin({ packName: 'Latest Skin', modifiedAt: '2026-05-23T15:00:00.000Z' }),
    )
    mockFaceplate.mockReturnValue(
      fakeFaceplate({ packName: 'Old Faceplate', modifiedAt: '2026-05-23T10:00:00.000Z' }),
    )
    mockDecalPack.mockReturnValue(
      fakeDecalPack({ packName: 'Older Decals', modifiedAt: '2026-05-23T05:00:00.000Z' }),
    )
    render()
    expect(continueCard()!.textContent).toContain('Latest Skin')
    expect(continueCard()!.textContent).toContain('Continue · Skin pack')
  })

  it('picks the faceplate when it is the most recently modified', () => {
    mockSkin.mockReturnValue(
      fakeSkin({ packName: 'Old Skin', modifiedAt: '2026-05-23T05:00:00.000Z' }),
    )
    mockFaceplate.mockReturnValue(
      fakeFaceplate({ packName: 'Latest Faceplate', modifiedAt: '2026-05-23T20:00:00.000Z' }),
    )
    mockDecalPack.mockReturnValue(
      fakeDecalPack({ packName: 'Old Decals', modifiedAt: '2026-05-23T10:00:00.000Z' }),
    )
    render()
    expect(continueCard()!.textContent).toContain('Latest Faceplate')
    expect(continueCard()!.textContent).toContain('Continue · Faceplate')
  })

  it('picks the decal pack when it is the most recently modified', () => {
    mockSkin.mockReturnValue(
      fakeSkin({ packName: 'Old Skin', modifiedAt: '2026-05-22T05:00:00.000Z' }),
    )
    mockFaceplate.mockReturnValue(
      fakeFaceplate({ packName: 'Old Faceplate', modifiedAt: '2026-05-22T20:00:00.000Z' }),
    )
    mockDecalPack.mockReturnValue(
      fakeDecalPack({ packName: 'Latest Decals', modifiedAt: '2026-05-23T10:00:00.000Z' }),
    )
    render()
    expect(continueCard()!.textContent).toContain('Latest Decals')
    expect(continueCard()!.textContent).toContain('Continue · Decal pack')
  })
})

describe('StartScreen — continue card click delegation', () => {
  it('clicking the Continue card delegates to onContinueSkin when the kind is skin', () => {
    const skin = fakeSkin({ packName: 'My Pack' })
    mockSkin.mockReturnValue(skin)
    const { handlers } = render()
    act(() => continueCard()!.click())
    expect(handlers.onContinueSkin).toHaveBeenCalledExactlyOnceWith(skin)
    expect(handlers.onOpenRecentFaceplate).not.toHaveBeenCalled()
    expect(handlers.onOpenRecentDecalPack).not.toHaveBeenCalled()
  })

  it('clicking the Continue card delegates to onOpenRecentFaceplate when the kind is faceplate', () => {
    const fp = fakeFaceplate({ packName: 'My Banner' })
    mockFaceplate.mockReturnValue(fp)
    const { handlers } = render()
    act(() => continueCard()!.click())
    expect(handlers.onOpenRecentFaceplate).toHaveBeenCalledExactlyOnceWith(fp)
    expect(handlers.onContinueSkin).not.toHaveBeenCalled()
    expect(handlers.onOpenRecentDecalPack).not.toHaveBeenCalled()
  })

  it('clicking the Continue card delegates to onOpenRecentDecalPack when the kind is decal pack', () => {
    const dp = fakeDecalPack({ packName: 'My Stickers' })
    mockDecalPack.mockReturnValue(dp)
    const { handlers } = render()
    act(() => continueCard()!.click())
    expect(handlers.onOpenRecentDecalPack).toHaveBeenCalledExactlyOnceWith(dp)
    expect(handlers.onContinueSkin).not.toHaveBeenCalled()
    expect(handlers.onOpenRecentFaceplate).not.toHaveBeenCalled()
  })
})

describe('StartScreen — exiting prop', () => {
  it('renders without error when exiting=true (Stagger flips to exit mode)', () => {
    render({ exiting: true })
    // The four action rows should still be in the DOM during the exit
    // animation — they're what Stagger is animating out.
    expect(rowByTitle('New Skin Pack')).not.toBeNull()
    expect(rowByTitle('Load Project')).not.toBeNull()
  })
})
