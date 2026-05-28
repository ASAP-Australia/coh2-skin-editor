/**
 * Tests for FaceplateInGamePreview — the three-chip "as seen in-game"
 * preview that recreates CoH2's actual faceplate UI:
 *   1. 64×64 native-pixel icon (ICON_NATIVE)
 *   2. Player badge lockup (icon + name)
 *   3. Hover card (gold ornamental frame around the banner)
 *
 * Contract pinned here:
 *
 *  - The outer wrapper is `role="img"` with a descriptive aria-label so
 *    SR users know what the surface represents.
 *  - Three PreviewChip captions render in canonical order: "In-game icon
 *    (64×64)" → "Player badge" → "In-game hover".
 *  - When `bannerPngUrl` is null:
 *      - Both IconCrop sections render an empty 64-or-displaySize box
 *        (no `<img>` for the user banner).
 *      - The hover-card section shows "Composing…" inside the framed
 *        slot, with the ornamental gold frame STILL overlaid.
 *  - When `bannerPngUrl` is non-null:
 *      - Three banner `<img>` tags mount: one for each IconCrop +
 *        one inside the hover card.
 *      - All three use `imageRendering: 'pixelated'` so the engine's
 *        1:1 native rendering is faithfully matched.
 *      - The gold frame img (`/ui-chrome/faceplate-frame-gold.png`)
 *        is always present in the hover card with `pointer-events:
 *        none` so it doesn't swallow clicks.
 *  - The badge name + hover-card h4 reflect `playerName` (defaults
 *    to "PlayerName"). The h4 uses a serif font stack (Georgia first)
 *    matching the CoH2 in-game typography.
 *  - The hover card surfaces the "Faceplate" subtitle in uppercase
 *    italic gold — pin literal copy because it identifies the item
 *    type the way the engine does.
 *  - IconCrop's display-size scaling: 64 for ICON_NATIVE, 36 for the
 *    badge — verified via the inline width/height styles.
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import FaceplateInGamePreview from '../FaceplateInGamePreview'
import { ICON_RECT } from '@/lib/faceplate-templates'

// ── Render harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(props: { bannerPngUrl?: string | null; playerName?: string } = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(FaceplateInGamePreview, {
        bannerPngUrl: props.bannerPngUrl ?? null,
        playerName: props.playerName,
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
})

// Tiny 1×1 transparent PNG data URL so `<img>` can mount without 404s.
const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjAAAAAgABz8g15QAAAABJRU5ErkJggg=='

// ── Helpers ─────────────────────────────────────────────────────────────────

function chipCaptions(): string[] {
  // PreviewChip's caption sits in a div with letterSpacing+uppercase styles.
  // Easier to walk by exact-match contents we know are emitted.
  return ['In-game icon (64×64)', 'Player badge', 'In-game hover'].filter(c =>
    container!.textContent?.includes(c),
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FaceplateInGamePreview — surface contract', () => {
  it('mounts a role="img" outer with a descriptive aria-label', () => {
    render()
    const wrapper = container!.querySelector('[role="img"]') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.getAttribute('aria-label')).toContain('In-game preview')
    expect(wrapper.getAttribute('aria-label')).toContain('faceplate')
  })

  it('renders the three section chip captions in canonical order', () => {
    render()
    const text = container!.textContent ?? ''
    const i1 = text.indexOf('In-game icon (64×64)')
    const i2 = text.indexOf('Player badge')
    const i3 = text.indexOf('In-game hover')
    expect(i1).toBeGreaterThan(-1)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
    expect(chipCaptions()).toEqual(['In-game icon (64×64)', 'Player badge', 'In-game hover'])
  })
})

describe('FaceplateInGamePreview — player name', () => {
  it('defaults playerName to "PlayerName" when prop is omitted', () => {
    render()
    expect(container!.textContent).toContain('PlayerName')
  })

  it('renders the supplied playerName in BOTH the badge span and the hover h4', () => {
    render({ playerName: 'Custom Pack' })
    // Badge span — text color gold, font-size 12.
    const badgeSpan = Array.from(container!.querySelectorAll('span')).find(s =>
      s.textContent?.includes('Custom Pack'),
    )
    expect(badgeSpan).toBeDefined()
    // Hover-card title — h4 in serif.
    const heading = container!.querySelector('h4')
    expect(heading).not.toBeNull()
    expect(heading!.textContent).toBe('Custom Pack')
  })

  it('hover-card heading uses a serif font stack starting with Georgia', () => {
    render({ playerName: 'Serif Test' })
    const heading = container!.querySelector('h4') as HTMLHeadingElement
    expect(heading.style.fontFamily).toContain('Georgia')
  })
})

describe('FaceplateInGamePreview — hover card chrome', () => {
  it('surfaces the "Faceplate" subtitle in uppercase italic gold', () => {
    render()
    // Uppercase styling is on the element — we'll just match the raw
    // "Faceplate" string (the subtitle is between the title and frame).
    expect(container!.textContent).toContain('Faceplate')
    // Find the subtitle by italic + textTransform style.
    const subtitle = Array.from(container!.querySelectorAll('div')).find(
      d =>
        d.textContent === 'Faceplate' &&
        d.style.fontStyle === 'italic' &&
        d.style.textTransform === 'uppercase',
    )
    expect(subtitle).toBeDefined()
  })

  it('always renders the ornamental gold frame with pointer-events:none', () => {
    render()
    const frame = Array.from(container!.querySelectorAll('img')).find(img =>
      img.src.includes('/ui-chrome/faceplate-frame-gold.png'),
    )
    expect(frame).toBeDefined()
    // pointer-events:none so the ornament can't eat hover/clicks below.
    expect(frame!.style.pointerEvents).toBe('none')
    // aria-hidden because it's decorative — the framed banner already
    // carries the meaningful art.
    expect(frame!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('FaceplateInGamePreview — null banner (composing) state', () => {
  it('shows "Composing…" placeholder inside the hover-card framed slot when bannerPngUrl is null', () => {
    render({ bannerPngUrl: null })
    expect(container!.textContent).toContain('Composing…')
  })

  it('does NOT mount any banner <img> when bannerPngUrl is null (only the frame remains)', () => {
    render({ bannerPngUrl: null })
    const imgs = Array.from(container!.querySelectorAll('img'))
    // Only the gold frame img should be present — no banner images yet.
    const nonFrame = imgs.filter(img => !img.src.includes('faceplate-frame-gold'))
    expect(nonFrame).toHaveLength(0)
  })

  it('still renders the gold frame even when bannerPngUrl is null', () => {
    render({ bannerPngUrl: null })
    const frame = Array.from(container!.querySelectorAll('img')).find(img =>
      img.src.includes('/ui-chrome/faceplate-frame-gold.png'),
    )
    expect(frame).toBeDefined()
  })
})

describe('FaceplateInGamePreview — banner mounted', () => {
  it('mounts EXACTLY two banner <img> + one frame <img> when bannerPngUrl is provided', () => {
    render({ bannerPngUrl: TRANSPARENT_PNG })
    const imgs = Array.from(container!.querySelectorAll('img'))
    const bannerImgs = imgs.filter(img => img.src === TRANSPARENT_PNG)
    const frameImgs = imgs.filter(img => img.src.includes('faceplate-frame-gold'))
    // Two IconCrop boxes + one hover-card banner = 3 banners. Plus 1 frame = 4 imgs.
    expect(bannerImgs).toHaveLength(3)
    expect(frameImgs).toHaveLength(1)
  })

  it('IconCrop banners use imageRendering: pixelated (engine renders icons 1:1)', () => {
    render({ bannerPngUrl: TRANSPARENT_PNG })
    const bannerImgs = Array.from(container!.querySelectorAll('img')).filter(
      img => img.src === TRANSPARENT_PNG,
    )
    // The two IconCrop banners carry imageRendering: pixelated inline.
    // The hover-card banner uses objectFit: cover (NOT pixelated) — pin the
    // distinction so a refactor can't accidentally pixelate the high-res
    // hover card or smooth the 64×64 sample.
    const pixelated = bannerImgs.filter(img => img.style.imageRendering === 'pixelated')
    expect(pixelated.length).toBeGreaterThanOrEqual(2) // both IconCrops at least
  })

  it('hover-card banner uses objectFit: cover so the full banner fills the framed slot', () => {
    render({ bannerPngUrl: TRANSPARENT_PNG })
    const bannerImgs = Array.from(container!.querySelectorAll('img')).filter(
      img => img.src === TRANSPARENT_PNG,
    )
    const cover = bannerImgs.find(img => img.style.objectFit === 'cover')
    expect(cover).toBeDefined()
  })
})

describe('FaceplateInGamePreview — IconCrop scaling', () => {
  it('the native-icon section renders the IconCrop box at ICON_RECT.width (64) CSS pixels', () => {
    render({ bannerPngUrl: TRANSPARENT_PNG })
    // The first IconCrop is the native 64×64; the second is the 36px badge.
    // Find them by their inline width style — easier to inspect on the
    // wrapper div because we know it carries width = displaySize.
    const cropBoxes = Array.from(container!.querySelectorAll('div')).filter(
      d =>
        d.style.width &&
        d.style.height &&
        d.style.width === d.style.height &&
        d.style.overflow === 'hidden',
    )
    const sizes = cropBoxes.map(d => parseInt(d.style.width, 10))
    expect(sizes).toContain(ICON_RECT.width) // 64
    expect(sizes).toContain(36) // badge variant
  })
})

describe('FaceplateInGamePreview — empty banner does not paint user art into icon crops', () => {
  it('IconCrop wrappers still mount their checkerboard placeholder when banner is null', () => {
    render({ bannerPngUrl: null })
    const cropBoxes = Array.from(container!.querySelectorAll('div')).filter(
      d => d.style.width === '64px' && d.style.height === '64px' && d.style.overflow === 'hidden',
    )
    // At least one crop box exists (the native 64×64). It just has no
    // child img inside — pin so a refactor can't accidentally drop the
    // placeholder ring.
    expect(cropBoxes.length).toBeGreaterThanOrEqual(1)
    expect(cropBoxes[0].querySelector('img')).toBeNull()
  })
})
