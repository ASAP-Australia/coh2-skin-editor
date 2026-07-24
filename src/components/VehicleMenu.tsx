/**
 * VehicleMenu — Wrapping grid of vehicle pills (all labels visible at once).
 *
 * Mounted bottom-center of the viewport. Shows only vehicles for the
 * currently selected faction (parent filters before passing). Pills wrap onto
 * multiple rows so every label is visible without horizontal scrolling. Active
 * vehicle
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

import { useEffect, useRef } from 'react'
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
  /**
   * Set of vehicle ids that are covered by a faction-default livery (camoPreset
   * or customDiffuseUrl set on the faction default). These get a small green
   * "covered" badge so the maker can tell the whole faction is covered without
   * visiting each vehicle individually. When omitted the badge is never shown
   * (legacy behaviour for tests / surfaces without a project).
   */
  coveredVehicles?: Set<string>
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
  coveredVehicles,
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

  // Flat, ordered list: heaviest → lightest (CLASS_ORDER), with any vehicle
  // whose class isn't enumerated appended at the end so nothing is dropped.
  // Rendered into a single wrapping flex container so ALL labels show at once.
  const orderedVehicles = [
    ...CLASS_ORDER.flatMap(cls => vehicles.filter(v => v.class === cls)),
    ...vehicles.filter(v => !CLASS_ORDER.includes(v.class)),
  ]

  return (
    <div className="flex flex-col items-center gap-1.5">
      <LoadingBorder
        active={loading}
        radius={16}
        className="glass-hud relative max-w-[94vw] overflow-hidden rounded-2xl px-2 py-1.5"
      >
        {/* Single horizontal row — every vehicle stays on ONE line and never
            wraps to a second row. Overflowing vehicles scroll horizontally
            (the active pill is kept in view via scrollIntoView). Ordered
            heaviest → lightest via CLASS_ORDER; any class not in that list is
            appended at the end so no vehicle is ever hidden. */}
        <div
          ref={scrollContainerRef}
          className="flex flex-nowrap items-center gap-0.5 overflow-x-auto custom-scrollbar"
        >
          {orderedVehicles.map(vehicle => {
            const isActive = selected?.id === vehicle.id
            const isDirty = dirtyVehicles.has(vehicle.id)
            const isCovered = coveredVehicles?.has(vehicle.id) ?? false
            return (
              <VehiclePill
                key={vehicle.id}
                vehicle={vehicle}
                isActive={isActive}
                isDirty={isDirty}
                isCovered={isCovered}
                onSelect={onSelect}
                iconResolver={iconResolver}
              />
            )
          })}
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
  isCovered,
  onSelect,
  iconResolver,
}: {
  vehicle: VehicleSpec
  isActive: boolean
  isDirty: boolean
  /** True when a faction-default livery covers this vehicle — shows a green dot badge. */
  isCovered: boolean
  onSelect: (v: VehicleSpec) => void
  iconResolver?: VehicleIconResolver
}) {
  // Two visual layouts:
  //   - With iconResolver: landscape (104px-wide) icon pill with a name
  //     caption below — wide cell suits the left-facing side-profile icons.
  //   - Without: legacy text-only pill (backward compat with tests
  //     and any future surface that doesn't pass an icon resolver).
  if (!iconResolver) {
    return (
      <button
        data-id={vehicle.id}
        onClick={() => onSelect(vehicle)}
        title={isCovered ? `${vehicle.displayName} — covered by faction-default livery` : vehicle.displayName}
        className={`relative px-3 py-1.5 rounded-pill text-[11px] font-medium whitespace-nowrap transition-all duration-150 cursor-pointer ${
          isActive
            ? 'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
            : 'text-[var(--color-text-2)] hover:bg-white/10 hover:text-white'
        }`}
      >
        {vehicle.displayName}
        {/* Coverage badge: green dot = faction-default livery covers this vehicle */}
        {isCovered && !isDirty && (
          <span
            aria-label="Covered by faction-default livery"
            className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#34d399]"
          />
        )}
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
      title={isCovered ? `${vehicle.displayName} — covered by faction-default livery` : vehicle.displayName}
      aria-label={isCovered ? `${vehicle.displayName} — covered by faction-default livery` : vehicle.displayName}
      aria-pressed={isActive}
      className={`relative shrink-0 mx-0.5 rounded-xl transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/70 flex flex-col items-center ${
        isActive
          ? 'bg-white/15 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.85),0_4px_12px_rgba(0,0,0,0.4)]'
          : 'hover:bg-white/10'
      }`}
      style={{ width: 'auto', padding: '4px 10px 5px' }}
    >
      {/* Icon strip removed — name-only layout */}
      {/* Name caption */}
      <span
        className={`whitespace-nowrap text-[11px] leading-tight font-medium select-none ${
          isActive ? 'text-white' : 'text-white/70'
        }`}
      >
        {vehicle.displayName}
      </span>
      {/* Coverage badge: small green dot at top-left corner = faction-default
       *  livery covers this vehicle. Mutually exclusive with dirty (orange):
       *  dirty takes priority since it reflects an explicit vehicle-specific
       *  edit that the maker should know about. */}
      {isCovered && !isDirty && (
        <span
          aria-hidden
          title="Covered by faction-default livery"
          className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]"
        />
      )}
      {/* Dirty indicator — anchored to the pill's outer corner so it's
       *  visible against any icon content. */}
      {isDirty && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_6px_#fb923c]"
        />
      )}
    </button>
  )
}

