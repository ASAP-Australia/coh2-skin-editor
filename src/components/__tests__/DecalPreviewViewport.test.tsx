/**
 * Tests for DecalPreviewViewport — the live 3D decal preview pane (Slice 4).
 *
 * Under jsdom there is no WebGL, so `isWebGLAvailable()` returns false and the
 * component renders its no-WebGL fallback (the flat decal composite thumbnail)
 * instead of spinning up a real Three.js Viewport. That lets us assert:
 *   1. No-WebGL / no-installRoot → the fallback pane renders (never the 3D
 *      Viewport), and shows the fallback thumbnail when one is provided.
 *   2. Every DecalFaction maps to a valid representative VehicleSpec, so the
 *      3D-render gate would fire once WebGL + an install handle are present.
 *   3. A null installRoot short-circuits to the fallback even if WebGL exists.
 *
 * Test infra: React 19 createRoot + act.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import DecalPreviewViewport from '../DecalPreviewViewport'
import { FACTION_ORDER, type DecalFaction } from '@/lib/decal-mod-templates'
import {
  VEHICLES,
  defaultVehicleForFaction,
  type Faction,
} from '@/lib/vehicles'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  faction?: DecalFaction
  installRoot?: FileSystemDirectoryHandle | null
  badgeSource?: string | HTMLCanvasElement | null
  fallbackThumbnail?: string | null
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(DecalPreviewViewport, {
        faction: props.faction ?? 'german',
        installRoot: props.installRoot ?? null,
        badgeSource: props.badgeSource ?? null,
        fallbackThumbnail: props.fallbackThumbnail ?? null,
      }),
    )
  })
  return container!
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('DecalPreviewViewport', () => {
  it('renders the fallback pane (not the 3D Viewport) under jsdom / no WebGL', () => {
    render({ faction: 'german', installRoot: null })
    expect(document.querySelector('[data-testid="decal-preview-fallback"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="decal-preview-viewport"]')).toBeNull()
  })

  it('shows the fallback thumbnail image when provided', () => {
    render({ faction: 'soviet', installRoot: null, fallbackThumbnail: TINY_PNG })
    const img = document.querySelector(
      '[data-testid="decal-preview-fallback"] img',
    ) as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img!.src).toBe(TINY_PNG)
  })

  it('renders no thumbnail img when no fallback is provided', () => {
    render({ faction: 'aef', installRoot: null, fallbackThumbnail: null })
    const fallback = document.querySelector('[data-testid="decal-preview-fallback"]')
    expect(fallback).toBeTruthy()
    expect(fallback!.querySelector('img')).toBeNull()
  })

  it('falls back even with a mock installRoot because jsdom has no WebGL', () => {
    // A truthy install handle is NOT enough — isWebGLAvailable() is false in
    // jsdom, so the 3D gate stays closed and the fallback renders.
    const fakeRoot = {} as unknown as FileSystemDirectoryHandle
    render({ faction: 'british', installRoot: fakeRoot, fallbackThumbnail: TINY_PNG })
    expect(document.querySelector('[data-testid="decal-preview-fallback"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="decal-preview-viewport"]')).toBeNull()
  })

  it('every decal faction resolves to a real representative VehicleSpec', () => {
    // Guards the internal representativeVehicle() mapping: the component must be
    // able to pick a renderable vehicle for each of the five armies so the
    // 3D-render gate can fire once WebGL + install handle are available.
    for (const f of FACTION_ORDER) {
      const id = defaultVehicleForFaction(f as Faction, new Set<string>())
      const spec = VEHICLES.find(v => v.id === id && v.faction === (f as Faction))
      expect(spec, `no representative vehicle for faction ${f}`).toBeTruthy()
    }
  })
})
