/**
 * VehicleMenu — Horizontally scrollable list of vehicle pills.
 *
 * Mounted bottom-center of the viewport. Shows only vehicles for the
 * currently selected faction (parent filters before passing). Active vehicle
 * is highlighted with a bright ring. Dirty indicators (orange dots) mark
 * vehicles with placed decals.
 *
 * Each pill is dominated by a per-vehicle icon — resolved asynchronously via
 * the `iconResolver` callback passed in by the parent. The resolver cascade
 * (see `src/lib/vehicle-icons.ts`) goes through: project cache → bundled PNG
 * in `public/icons/vehicles/<id>.png` → stock-SGA probe → offscreen Three.js
 * render of the actual vehicle model → procedural faction-coloured initial.
 * The Three.js render fallback produces a posed shot of the real CoH2 mesh
 * with its diffuse textures, so even without a bundled icon set the user
 * sees the actual in-game asset rather than abstract pills.
 *
 * The vehicle's displayName is still surfaced — as an aria-label for screen
 * readers, a native `title` tooltip on hover, and a small text strip below
 * the icon so the pill stays scannable for users who don't recognise every
 * vehicle silhouette at a glance.
 */

import { useEffect, useRef, useState } from 'react'
import type { VehicleClass, VehicleSpec } from '@/lib/vehicles'
import LoadingBorder from './ui/loading-border'

// Class grouping is used to control the visual ORDER of pills
// (heaviest → lightest). The user asked us to remove the All/Super/Heavy/
// Medium/Light/Utility filter row that previously sat above this rail —
// the rail itself is now just an ordered horizontal scroller, with no
// separators between class groups.
const CLASS_ORDER: VehicleClass[] = ['super_heavy', 'heavy', 'medium', 'light', 'utility']

/** Per-vehicle icon resolver. Implemented in the parent so the menu stays
 *  agnostic of `project` / `installRoot` (which would otherwise have to be
 *  threaded through here and tracked for changes). May return null while
 *  resolving or on failure; the menu shows a faction-coloured placeholder
 *  in that window so the layout doesn't jump. */
export type VehicleIconResolver = (vehicle: VehicleSpec) => Promise<string | null>

interface VehicleMenuProps {
  vehicles: VehicleSpec[]
  selected: VehicleSpec | null
  onSelect: (vehicle: VehicleSpec) => void
  dirtyVehicles: Set<string>
  /** True while the parent is in the middle of swapping the rendered
   *  vehicle (model fetch + texture decode). Drives the rotating
   *  loading-beam around this rail. */
  loading?: boolean
  /** Async per-vehicle icon resolver. When omitted the menu falls back
   *  to text labels (legacy behaviour) — useful for tests and any future
   *  surface that doesn't have a project + install handle. */
  iconResolver?: VehicleIconResolver
}

export default function VehicleMenu({
  vehicles,
  selected,
  onSelect,
  dirtyVehicles,
  loading = false,
  iconResolver,
}: VehicleMenuProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll selected vehicle into view
  useEffect(() => {
    if (!selected || !scrollContainerRef.current) return
    const selectedPill = scrollContainerRef.current.querySelector(`[data-id="${selected.id}"]`)
    selectedPill?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selected])

  if (vehicles.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <LoadingBorder
        active={loading}
        radius={16}
        className="relative max-w-[min(85vw,800px)] rounded-2xl shadow-[var(--shadow-glass)] px-2 py-1.5"
        style={{
          background: 'rgba(20, 22, 28, 0.62)',
          backdropFilter: 'blur(28px) saturate(180%)',
          border: '0.5px solid rgba(255,255,255,0.10)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
        }}
      >
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-0 overflow-x-auto [&::-webkit-scrollbar]:h-0"
          style={{
            maskImage:
              'linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)',
          }}
        >
          {CLASS_ORDER.map(cls => ({ cls, group: vehicles.filter(v => v.class === cls) }))
            .filter(({ group }) => group.length > 0)
            .map(({ cls, group }) => (
              <div key={cls} className="flex items-center gap-0 shrink-0">
                {group.map(vehicle => {
                  const isActive = selected?.id === vehicle.id
                  const isDirty = dirtyVehicles.has(vehicle.id)
                  return (
                    <VehiclePill
                      key={vehicle.id}
                      vehicle={vehicle}
                      isActive={isActive}
                      isDirty={isDirty}
                      onSelect={onSelect}
                      iconResolver={iconResolver}
                    />
                  )
                })}
              </div>
            ))}
        </div>
      </LoadingBorder>
    </div>
  )
}

/**
 * Single vehicle pill — icon-dominant with a tiny text caption.
 *
 * Icon resolution is lazy: the effect kicks off `iconResolver` on mount
 * and cancellation-safely sets state when the URL arrives. While the
 * resolve is in flight the pill shows a faction-coloured square so the
 * layout doesn't shift when the icon lands a few hundred ms later. If
 * the resolver isn't wired (no parent passed `iconResolver`), we fall
 * back to the original text-only pill style — keeps legacy callers and
 * tests working without modification.
 */
function VehiclePill({
  vehicle,
  isActive,
  isDirty,
  onSelect,
  iconResolver,
}: {
  vehicle: VehicleSpec
  isActive: boolean
  isDirty: boolean
  onSelect: (v: VehicleSpec) => void
  iconResolver?: VehicleIconResolver
}) {
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  // Resolve the icon when the pill mounts (or the resolver/vehicle id
  // changes). Cancellation is via an `alive` flag — common React idiom
  // for "ignore late async results after unmount/dep change". Skipping
  // entirely when no resolver is provided keeps the legacy text-only
  // branch zero-cost.
  useEffect(() => {
    if (!iconResolver) return
    let alive = true
    iconResolver(vehicle)
      .then(url => {
        if (alive) setIconUrl(url)
      })
      .catch(() => {
        /* swallow — resolver is best-effort; fallback UI handles null */
      })
    return () => {
      alive = false
    }
  }, [iconResolver, vehicle])

  // Two visual layouts:
  //   - With iconResolver: 56x56 icon-dominant pill with caption strip.
  //   - Without: legacy text-only pill (backward compat with tests
  //     and any future surface that doesn't pass an icon resolver).
  if (!iconResolver) {
    return (
      <button
        data-id={vehicle.id}
        onClick={() => onSelect(vehicle)}
        className={`relative px-3 py-1.5 rounded-pill text-[11px] font-medium whitespace-nowrap transition-all duration-150 ${
          isActive
            ? 'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
            : 'text-[var(--color-text-2)] hover:bg-white/10 hover:text-white'
        }`}
      >
        {vehicle.displayName}
        {isDirty && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400 shadow-[0_0_4px_#fb923c]" />
        )}
      </button>
    )
  }

  return (
    <button
      data-id={vehicle.id}
      onClick={() => onSelect(vehicle)}
      title={vehicle.displayName}
      aria-label={vehicle.displayName}
      aria-pressed={isActive}
      className={`relative shrink-0 mx-0.5 rounded-xl transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        isActive
          ? 'bg-white/15 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.85),0_4px_12px_rgba(0,0,0,0.4)]'
          : 'hover:bg-white/10'
      }`}
      style={{ width: 64, height: 64, padding: 0 }}
    >
      <div
        className="w-full h-full rounded-md overflow-hidden flex flex-col items-center justify-center"
        style={{
          background: iconUrl
            ? 'transparent'
            : 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.18))',
        }}
      >
        {iconUrl ? (
          // The icon resolver cascade always returns *something* once it
          // settles (procedural placeholder is the floor), so `iconUrl`
          // becoming non-null is the steady state. The pill is sized at
          // 64x64 with zero padding so bundled CoH2 sprite-atlas icons
          // (also 64x64) render at *native 1:1* — no resampling, pixel-
          // perfect to the source. `object-contain` keeps the larger
          // 256x256 Three.js fallback renders aspect-correct as they
          // downscale into the same 64x64 slot, and the 64x64 SVG
          // procedural placeholder slots in unchanged.
          <img
            src={iconUrl}
            alt=""
            draggable={false}
            className="w-full h-full object-contain select-none pointer-events-none"
            style={{
              // Mild filter so non-painted source icons read against the
              // dark glass chrome — only applied when inactive so the
              // selected pill shows the asset at full fidelity.
              filter: isActive ? 'none' : 'brightness(0.95) contrast(1.05)',
            }}
          />
        ) : (
          // Pre-resolve placeholder — first letter of the displayName,
          // matches the procedural fallback's style so the visual stays
          // calm when the resolve completes a frame or two later.
          <span className="text-white/65 text-base font-semibold select-none">
            {vehicle.displayName.trim()[0]?.toUpperCase() ?? '?'}
          </span>
        )}
      </div>
      {/* Dirty indicator — sits above the icon, anchored to the pill's
       *  outer corner so it's visible against any icon content. */}
      {isDirty && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_6px_#fb923c]"
        />
      )}
    </button>
  )
}

