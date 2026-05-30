/**
 * AtlasPreview3D — faction carousel 3D preview for the decal atlas editor.
 *
 * Shows the active part's baked faction mask composited onto a heavy tank's
 * vanilla diffuse texture, one faction at a time. Left/right arrows switch
 * tanks. Drag-to-rotate via Viewport's OrbitControls.
 *
 * UV approximation: All heavy tanks use the King Tiger hullSideRight rect
 * (896, 1152, 512, 512) in the 2048² overlay canvas as the badge zone.
 * This is correct for the King Tiger. For Tiger, IS-2, Pershing, and Churchill
 * it is an approximate placement — exact per-tank UV region JSON files are a
 * future refinement (see FUTURE: add vehicle-uv-regions JSON for each tank).
 */

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type Coh2DecalPackProject, ATLAS_PART_DEFS } from '@/lib/decal-pack-project'
import { type DecalFaction } from '@/lib/decal-mod-templates'
import { FACTION_LABELS, FACTION_COLORS } from '@/lib/factions'
import { compositePartLayers } from '@/lib/atlas-parts'
import { SCENE_PRESETS } from '@/lib/scene-settings'
import type { VehicleSpec } from '@/lib/vehicles'

// Lazy-import Viewport to avoid bundling Three.js into the main chunk.
const Viewport = React.lazy(() => import('@/components/Viewport'))

// Heavy tank per faction (verified against src/lib/vehicles.ts).
const HEAVY_TANK_IDS: Record<DecalFaction, string> = {
  german:      'tiger',
  west_german: 'king_tiger_sdkfz_182',
  soviet:      'is2m_heavy_tank',
  aef:         'm26_pershing',
  british:     'churchill',
}

// Carousel display order.
const CAROUSEL_ORDER: DecalFaction[] = ['german', 'west_german', 'soviet', 'aef', 'british']

// Badge placement rect in the 2048² overlay canvas.
// Verified correct for King Tiger (king_tiger_sdkfz_182.json hullSideRight).
// Used as an approximation for all other heavy tanks.
// FUTURE: load per-tank UV region JSON and use the actual rect per vehicle.
const BADGE_RECT = { x: 896, y: 1152, w: 512, h: 512 }

// Hardcoded approximate RGB tint values per faction.
// The engine applies the real faction tint at runtime; these are preview-only.
const FACTION_RGB: Record<DecalFaction, [number, number, number]> = {
  german:      [120,  80,  60],
  west_german: [140, 110,  70],
  soviet:      [ 90,  30,  30],
  aef:         [ 60,  90, 150],
  british:     [ 50,  80, 160],
}

interface Props {
  project: Coh2DecalPackProject
  activePartIndex: number
  installRoot?: FileSystemDirectoryHandle | null
}

export default function AtlasPreview3D({ project, activePartIndex, installRoot }: Props) {
  const [factionIdx, setFactionIdx] = useState(0)   // index into CAROUSEL_ORDER
  const [overlayCanvas, setOverlayCanvas] = useState<HTMLCanvasElement | null>(null)
  const [overlayVersion, setOverlayVersion] = useState(0)
  // Vanilla diffuse captured via onModelLoaded — stored in ref to avoid re-triggering effect.
  const vanillaDiffuseRef = useRef<HTMLCanvasElement | null>(null)
  // Whether the bake is in-flight.
  const [baking, setBaking] = useState(false)

  // VehicleSpec lookup (lazy import to avoid bundling vehicles list eagerly).
  const [vehicles, setVehicles] = useState<VehicleSpec[] | null>(null)
  useEffect(() => {
    import('@/lib/vehicles').then(m => setVehicles(m.VEHICLES))
  }, [])

  const currentFaction = CAROUSEL_ORDER[factionIdx]

  const vehicle = vehicles
    ? vehicles.find(v => v.id === HEAVY_TANK_IDS[currentFaction]) ?? null
    : null

  // ── Build the overlay canvas (vanilla diffuse + faction-tinted badge mask) ──

  const buildOverlay = useCallback(async () => {
    const vanilla = vanillaDiffuseRef.current
    if (!vanilla || !project.parts) return

    setBaking(true)
    try {
      const part = project.parts[activePartIndex]
      const def = ATLAS_PART_DEFS[activePartIndex]
      if (!part || !def) return

      // Pick the right layers: faction override if present, else shared.
      const layers = part.overrides?.[currentFaction] ?? part.shared

      // Composite part layers → part-sized RGBA.
      const partRgba = await compositePartLayers(layers, def.region.w, def.region.h, project.sourceImages)

      // Create the 2048² overlay.
      const overlay = document.createElement('canvas')
      overlay.width = overlay.height = 2048

      const ctx = overlay.getContext('2d')!
      // Draw vanilla diffuse as base.
      ctx.drawImage(vanilla, 0, 0, 2048, 2048)

      // Draw the part mask tinted with faction color into the badge rect.
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = BADGE_RECT.w
      maskCanvas.height = BADGE_RECT.h
      const mCtx = maskCanvas.getContext('2d')!

      // Resize part RGBA to badge rect size.
      const partCanvas = document.createElement('canvas')
      partCanvas.width = def.region.w
      partCanvas.height = def.region.h
      const pCtx = partCanvas.getContext('2d')!
      pCtx.putImageData(
        new ImageData(partRgba as Uint8ClampedArray<ArrayBuffer>, def.region.w, def.region.h),
        0,
        0
      )
      mCtx.drawImage(partCanvas, 0, 0, BADGE_RECT.w, BADGE_RECT.h)

      // Apply faction tint (multiply-ish): tint opaque pixels with faction color.
      const [tr, tg, tb] = FACTION_RGB[currentFaction]
      const imgData = mCtx.getImageData(0, 0, BADGE_RECT.w, BADGE_RECT.h)
      const px = imgData.data
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 10) {  // only opaque pixels
          px[i]     = Math.round(px[i]     * tr / 255)
          px[i + 1] = Math.round(px[i + 1] * tg / 255)
          px[i + 2] = Math.round(px[i + 2] * tb / 255)
        }
      }
      mCtx.putImageData(imgData, 0, 0)

      // Composite tinted mask onto overlay at badge rect.
      ctx.drawImage(maskCanvas, BADGE_RECT.x, BADGE_RECT.y, BADGE_RECT.w, BADGE_RECT.h)

      setOverlayCanvas(overlay)
      setOverlayVersion(v => v + 1)
    } finally {
      setBaking(false)
    }
  }, [project, activePartIndex, currentFaction])

  // Rebuild overlay when project/part/faction changes.
  useEffect(() => {
    if (vanillaDiffuseRef.current) {
      void buildOverlay()
    }
  }, [project, activePartIndex, currentFaction, buildOverlay])

  const handleModelLoaded = useCallback(
    (_model: unknown, diffuseImage: HTMLCanvasElement | null) => {
      if (diffuseImage) {
        vanillaDiffuseRef.current = diffuseImage
        void buildOverlay()
      }
    },
    [buildOverlay],
  )

  const scenePreset = SCENE_PRESETS['in_game_field']

  if (!installRoot) {
    return (
      <div style={{ padding: 24, color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center' }}>
        Set your CoH2 install folder to enable 3D preview.
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: 320, background: '#0a0c10', borderRadius: 12, overflow: 'hidden' }}>
      {/* Faction label */}
      <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 10, color: FACTION_COLORS[currentFaction], fontSize: 12, fontWeight: 600, pointerEvents: 'none' }}>
        {FACTION_LABELS[currentFaction]}
      </div>

      {/* Left arrow */}
      <button
        onClick={() => setFactionIdx(i => (i - 1 + CAROUSEL_ORDER.length) % CAROUSEL_ORDER.length)}
        aria-label="Previous faction"
        style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer', color: '#fff' }}
      >
        <ChevronLeft size={20} />
      </button>

      {/* Right arrow */}
      <button
        onClick={() => setFactionIdx(i => (i + 1) % CAROUSEL_ORDER.length)}
        aria-label="Next faction"
        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer', color: '#fff' }}
      >
        <ChevronRight size={20} />
      </button>

      {/* Baking indicator */}
      {baking && (
        <div style={{ position: 'absolute', bottom: 8, right: 12, zIndex: 10, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          Compositing...
        </div>
      )}

      {/* 3D Viewport */}
      <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)' }}>Loading...</div>}>
        <Viewport
          root={installRoot}
          vehicle={vehicle}
          overlayCanvas={overlayCanvas}
          overlayVersion={overlayVersion}
          onModelLoaded={handleModelLoaded}
          selectedPart={null}
          explodeAll={false}
          season="summer"
          envArchive={null}
          envName=""
          controlsEnabled={true}
          preset={scenePreset}
          showCrew={false}
          showDestroyed={false}
        />
      </Suspense>
    </div>
  )
}
