/**
 * Tests for the vehicle-icon resolver cascade.
 *
 * Coverage:
 *   - `tryBundledIcon` (via resolveVehicleIcon path) rejects SPA-fallback
 *     HTML responses that come back as `200 OK` with `Content-Type: text/html`.
 *     This was the bug that caused every vehicle pill in demo mode to show
 *     the browser broken-image icon: `vite preview` (and most static hosts)
 *     serve `index.html` for unknown paths, and the old code base64-wrapped
 *     that HTML as a data URL and handed it to `<img src>`.
 *   - The cascade still falls through to the procedural SVG placeholder
 *     when no bundled icon exists, so the resolver always returns SOMETHING.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveVehicleIcon, procedurallyDrawIcon } from '@/lib/vehicle-icons'
import type { Coh2SkinProject } from '@/lib/project'

function emptyProject(): Coh2SkinProject {
  return {
    id: 'test',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    vehicles: {},
    images: {},
    exportSlots: [],
    factionDefaults: {},
    activeSlotIdx: 0,
    vehicleIcons: {},
  } as unknown as Coh2SkinProject
}

describe('resolveVehicleIcon — bundled-icon SPA-fallback guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('falls through to the procedural placeholder when /icons/vehicles/* returns the SPA index.html', async () => {
    // Simulate `vite preview` / GitHub Pages SPA fallback: 200 OK + text/html.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<!doctype html><html>...</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )
    const out = await resolveVehicleIcon(emptyProject(), 'tiger', 'german', { cache: false })
    // Procedural SVG starts with `data:image/svg+xml`. If the guard fails, the
    // result would be `data:text/html;…` and the pill would render the
    // broken-image icon in the browser.
    expect(out.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('accepts a genuine image response with image/* Content-Type', async () => {
    // 1×1 transparent PNG.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
      0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(pngBytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
      ),
    )
    const out = await resolveVehicleIcon(emptyProject(), 'tiger', 'german', { cache: false })
    // Should produce a data:image/png URL from the bundled fetch path,
    // not fall through to the SVG placeholder.
    expect(out.startsWith('data:image/png')).toBe(true)
  })

  it('falls through on a 404 (no icon present)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Not Found', { status: 404 })),
    )
    const out = await resolveVehicleIcon(emptyProject(), 'tiger', 'german', { cache: false })
    expect(out.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('falls through when fetch throws (network error / CORS)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom')
      }),
    )
    const out = await resolveVehicleIcon(emptyProject(), 'tiger', 'german', { cache: false })
    expect(out.startsWith('data:image/svg+xml')).toBe(true)
  })
})

describe('procedurallyDrawIcon', () => {
  it('returns a deterministic SVG data URL containing the vehicle initial', () => {
    const a = procedurallyDrawIcon('tiger', 'german')
    const b = procedurallyDrawIcon('tiger', 'german')
    expect(a).toBe(b)
    expect(a.startsWith('data:image/svg+xml')).toBe(true)
  })
})

describe('resolveVehicleIcon — bundled PNG at /icons/vehicles/<id>.png', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves to a data:image/png when /icons/vehicles/tiger.png is present (simulates bundled crop)', async () => {
    // Minimal 1×1 transparent PNG — used as a stand-in for the real
    // Tiger portrait that write-vehicle-portraits.mts crops from the atlas.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
      0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        // Serve the fake PNG only for the tiger portrait path; reject all others
        if (url === '/icons/vehicles/tiger.png') {
          return new Response(pngBytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          })
        }
        return new Response('Not Found', { status: 404 })
      }),
    )

    const out = await resolveVehicleIcon(emptyProject(), 'tiger', 'german', { cache: false })

    // Step 2 (bundled icon) should hit and return a PNG data URL,
    // never invoking the Three.js renderer or procedural placeholder.
    expect(out.startsWith('data:image/png')).toBe(true)
  })

  it('does NOT invoke the Three renderer when a bundled icon is present', async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
      0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    const mockRenderer = vi.fn(async () => 'data:image/png;base64,THREE_RENDER')

    // Import the module to register the mock renderer
    const { registerThreeRenderer } = await import('@/lib/vehicle-icons')
    registerThreeRenderer(mockRenderer)

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(pngBytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
      ),
    )

    await resolveVehicleIcon(emptyProject(), 'tiger', 'german', { cache: false })

    // The Three renderer must NOT have been called — bundled icon short-circuited the cascade.
    expect(mockRenderer).not.toHaveBeenCalled()

    // Clean up
    registerThreeRenderer(null)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Faction-prefix priority — fixes the duplicate-`halftrack`-id collision
// where soviet/halftrack (Lend-Lease M3) silently picked up the icon shipped
// for german/halftrack (Sd.Kfz. 251). The resolver now tries
// `/icons/vehicles/<faction>_<id>.png` first and only falls back to the
// bare-id file when no prefixed override exists.
// ─────────────────────────────────────────────────────────────────────────────

/** 1×1 PNG used as a stand-in for any real bundled icon — content
 *  doesn't matter, only the routing does. */
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

/** Stub `fetch` to serve PNGs for slugs in `available` and 404 everything
 *  else. Returns the call-log array so tests can assert the order in which
 *  the resolver probed each candidate. */
function stubFetchForSlugs(available: Set<string>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const m = input.match(/\/icons\/vehicles\/([^.]+)\.png$/)
      if (!m) return new Response(null, { status: 404 })
      const slug = m[1]
      calls.push(slug)
      if (available.has(slug)) {
        return new Response(TINY_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      return new Response('Not Found', { status: 404 })
    }),
  )
  return calls
}

describe('resolveVehicleIcon — faction-prefix bundled icon priority', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('tries `<faction>_<id>.png` BEFORE `<id>.png`', async () => {
    // Both candidates available — the prefixed one must win and the
    // bare-id fallback must NOT be probed once the first resolves.
    const calls = stubFetchForSlugs(new Set(['soviet_halftrack', 'halftrack']))
    const out = await resolveVehicleIcon(emptyProject(), 'halftrack', 'soviet', { cache: false })
    expect(calls[0]).toBe('soviet_halftrack')
    expect(calls).not.toContain('halftrack')
    expect(out.startsWith('data:image/png')).toBe(true)
  })

  it('falls back to `<id>.png` when no faction-prefixed icon exists', async () => {
    // Only the bare-id file is available — resolver must hit the
    // prefixed path first (and miss), then fall through to the bare id.
    const calls = stubFetchForSlugs(new Set(['halftrack']))
    const out = await resolveVehicleIcon(emptyProject(), 'halftrack', 'german', { cache: false })
    expect(calls[0]).toBe('german_halftrack')
    expect(calls[1]).toBe('halftrack')
    expect(out.startsWith('data:image/png')).toBe(true)
  })

  it('falls through to the procedural placeholder when neither candidate exists', async () => {
    const calls = stubFetchForSlugs(new Set()) // nothing available
    const out = await resolveVehicleIcon(emptyProject(), 'unknown_x', 'aef', { cache: false })
    expect(calls).toContain('aef_unknown_x')
    expect(calls).toContain('unknown_x')
    // The cascade's never-null floor is the procedural SVG placeholder.
    expect(out.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('regression: soviet/halftrack does NOT silently pick up the german Sd.Kfz. 251 icon when a soviet override is bundled', async () => {
    // Both factions share filesystem id `halftrack` so a project storing
    // the Soviet Lend-Lease M3 entry would resolve `/icons/vehicles/halftrack.png`
    // — which ships the German Sd.Kfz. 251 portrait. The faction-prefix
    // priority lets us drop a separate `soviet_halftrack.png` next to it
    // to override that mistake at the asset layer. This test pins the
    // routing so the override can never silently regress.
    const calls = stubFetchForSlugs(new Set(['soviet_halftrack', 'halftrack']))
    await resolveVehicleIcon(emptyProject(), 'halftrack', 'soviet', { cache: false })
    expect(calls[0]).toBe('soviet_halftrack')
    expect(calls).not.toContain('halftrack')
  })
})
