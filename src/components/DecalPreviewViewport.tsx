/**
 * DecalPreviewViewport — live 3D preview for the decal editor (Slice 4).
 *
 * Renders a representative vehicle of the pack's target faction with the
 * decal pack's CURRENT canvas composite applied through the engine's TC1
 * (TEXCOORD1) national-insignia pipeline — the same mechanism the skin
 * editor uses (`Viewport`'s `badgeDecalSource` → `uDecalTex`). The
 * `vehicle.faction` drives the badge tint automatically (teamColour).
 *
 * The caller (`DecalPackEditor`) passes `badgeSource` = a 2048² canvas with
 * the decal composite already rasterised into the TC1 badge cell
 * ([586,80,104,96] — the U∈[0.286,0.337]×V∈[0.039,0.086] cluster). We simply
 * forward it as `badgeDecalSource`.
 *
 * Wrapped in `ViewportGuard` (silent) so machines without WebGL fall back to
 * the flat decal composite thumbnail rather than white-screening.
 */

import { lazy, Suspense, useMemo, type CSSProperties } from 'react'
import ViewportGuard from './ViewportGuard'
// Viewport is lazy-loaded to defer its module eval. A rolldown-vite
// production-chunk init-order bug throws "require_jsx_runtime is not a
// function" (minified: "E is not a function") when Viewport is EAGERLY
// imported into the main chunk graph — DecalPackEditor statically imports
// this component, so an eager `import Viewport from './Viewport'` pulls
// Viewport into the main-chunk import graph and creates a circular
// index ⇄ Viewport chunk dependency that white-screens the whole app on
// first paint (every screen, not just the decal editor). Deferring the eval
// behind React.lazy() keeps Viewport in its own leaf chunk (matching
// App.tsx's ViewportBgWarmer / FaceplateEditor pattern), breaking the cycle:
// the chunk only evaluates when the decal 3D preview actually mounts, inside
// the <Suspense> boundary below. Permanent fix — reverting to an eager import
// white-screens the shipped app.
const Viewport = lazy(() => import('./Viewport'))
import { isWebGLAvailable } from '@/lib/webgl-support'
import {
  VEHICLES,
  defaultVehicleForFaction,
  type Faction,
  type VehicleSpec,
} from '@/lib/vehicles'
import type { DecalFaction } from '@/lib/decal-mod-templates'

/** Editor.tsx keeps its own (currently empty) broken-model set; mirror an
 *  empty set here so the representative pick stays in lockstep with the
 *  skin editor's `defaultVehicleForFaction` default without importing from
 *  Editor.tsx (which S4 must not touch). */
const NO_BROKEN_MODELS: ReadonlySet<string> = new Set<string>()

/** `DecalFaction` and `Faction` share identical string literals — the cast is
 *  total across all five armies (`decal-mod-templates.ts` FACTION_ORDER). */
function toFaction(f: DecalFaction): Faction {
  return f as Faction
}

/**
 * Resolve the representative `VehicleSpec` for a faction: the toughest
 * renderable vehicle, matching the skin editor's per-faction default.
 */
function representativeVehicle(faction: Faction): VehicleSpec | null {
  const id = defaultVehicleForFaction(faction, NO_BROKEN_MODELS as Set<string>)
  return VEHICLES.find(v => v.id === id && v.faction === faction) ?? null
}

interface Props {
  faction: DecalFaction
  installRoot: FileSystemDirectoryHandle | null
  /** 2048² canvas (or DataURL) with the decal composite in the TC1 badge cell. */
  badgeSource: string | HTMLCanvasElement | null
  /** Flat composite of the active decal cell — shown as the no-WebGL fallback. */
  fallbackThumbnail?: string | null
}

const containerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
}

export default function DecalPreviewViewport({
  faction,
  installRoot,
  badgeSource,
  fallbackThumbnail,
}: Props) {
  const vehicle = useMemo(() => representativeVehicle(toFaction(faction)), [faction])

  // No install handle or no representative vehicle → nothing to render in 3D;
  // fall through to the thumbnail (or an empty surface).
  const canRender3d = isWebGLAvailable() && !!installRoot && !!vehicle

  if (!canRender3d) {
    return (
      <div style={containerStyle} data-testid="decal-preview-fallback">
        {fallbackThumbnail && (
          <img
            src={fallbackThumbnail}
            alt="Decal preview"
            style={{
              width: 'min(60%, 320px)',
              height: 'auto',
              imageRendering: 'pixelated',
              borderRadius: 4,
              background:
                'repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px',
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div style={containerStyle} data-testid="decal-preview-viewport">
      <ViewportGuard label="Decal Preview" silent>
        <Suspense fallback={null}>
          <Viewport
            root={installRoot as FileSystemDirectoryHandle}
            vehicle={vehicle}
            selectedPart={null}
            explodeAll={false}
            season="summer"
            envArchive={null}
            envName=""
            controlsEnabled
            badgeDecalSource={badgeSource}
          />
        </Suspense>
      </ViewportGuard>
    </div>
  )
}
