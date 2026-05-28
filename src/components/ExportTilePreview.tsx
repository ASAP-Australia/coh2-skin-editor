/**
 * ExportTilePreview — large hover card that mirrors the in-game CoH2
 * shop "skin preview" panel.
 *
 * Layout (top → bottom):
 *   1. Header strip: faction emblem · faction label · season pill
 *   2. Body: 3D vehicle render (rendered offscreen via step 9) with
 *      the slot's main decal stamped top-left, sat on a dark gradient
 *      so the silhouette pops the way it does in the shop.
 *   3. Footer: slot label + a small "what's in this slot" line
 *      summarising vehicle / faction-default counts.
 *
 * Positioning: the card is placed via fixed coordinates anchored to the
 * hovered tile's `DOMRect`. We try a left-of-tile placement first
 * (the export panel sits in the top-right cluster, so the card has
 * room on the left), and fall back to right-of-tile if the viewport
 * would clip the card.
 *
 * Lifecycle: re-renders the 3D body when the slot's primary vehicle
 * changes; the silhouette renderer in step 9 caches per-id, so most
 * hovers paint a thumbnail instantly.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Coh2SkinProject, ExportSlot } from '@/lib/project'
import { VEHICLES, type Faction, type VehicleSpec } from '@/lib/vehicles'
import { FACTION_COLORS, FACTION_ICONS, FACTION_LABELS } from '@/lib/factions'
// Dynamic import keeps Three.js out of the initial parse — vehicle-3d-renderer
// is only needed on hover and the module is already in the three chunk.
// renderVehicleSilhouette = () => import('@/lib/vehicle-3d-renderer').then(m => m.renderVehicleSilhouette)

interface Props {
  slot: ExportSlot
  anchorRect: DOMRect
  project: Coh2SkinProject
  installRoot: FileSystemDirectoryHandle
}

/** Render dimensions tuned to CoH2's skin tile (roughly 5:3 aspect on
 *  the unit preview area inside the shop card). */
const CARD_W = 340
const CARD_H = 280
const BODY_H = 180 // vehicle render height inside the card body
const RENDER_PX = 512 // offscreen render size — downsamples nicely

export default function ExportTilePreview({ slot, anchorRect, project, installRoot }: Props) {
  // 1. Pick the slot's primary vehicle (same logic as the grid tile).
  const { vehicleSpec, faction } = useMemo(() => pickPrimaryVehicle(slot), [slot])

  // 2. Resolve the main decal image — slot snapshot is authoritative,
  //    NOT live state.
  const decalUrl = useMemo(() => resolveSlotMainDecal(slot, project), [slot, project])

  // 3. Kick off the offscreen 3D render. The `vehicle-3d-renderer`
  //    module caches per-id, so re-hovering the same slot is instant.
  //    Dynamic import keeps Three.js out of the initial parse.
  const [bodyUrl, setBodyUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to null at effect start to clear stale URL; single setState with no cascade
    setBodyUrl(null)
    if (!vehicleSpec) return
    ;(async () => {
      try {
        const { renderVehicleSilhouette } = await import('@/lib/vehicle-3d-renderer')
        if (cancelled) return
        const url = await renderVehicleSilhouette(installRoot, vehicleSpec.id, RENDER_PX)
        if (!cancelled) setBodyUrl(url)
      } catch (e) {
        console.warn('[ExportTilePreview] silhouette render failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [vehicleSpec, installRoot])

  // 4. Position. Default is to the left of the tile so we don't cover
  //    the source. Flip if we'd overflow the viewport on either side.
  const [pos, setPos] = useState<{ left: number; top: number }>(() => placeCard(anchorRect))
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- position computed from stable rect measurement, single setState
    setPos(placeCard(anchorRect))
  }, [anchorRect])

  // 5. Counts for the footer line.
  const slotSummary = useMemo(() => summariseSlot(slot), [slot])

  return (
    <div
      ref={cardRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: CARD_W,
        height: CARD_H,
        pointerEvents: 'none', // never intercept hover — the source tile owns enter/leave
        zIndex: 100,
      }}
      className="
        rounded-xl overflow-hidden
        bg-[#0d1420]
        ring-1 ring-[#caa45a]/40
        shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_0_1px_rgba(202,164,90,0.15)]
      "
    >
      {/* HEADER: faction emblem + label + season pill */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-[#caa45a]/20"
        style={{
          background: `linear-gradient(90deg, ${FACTION_COLORS[faction]}33 0%, transparent 70%)`,
        }}
      >
        <div
          className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center"
          style={{ background: FACTION_COLORS[faction] }}
        >
          {FACTION_ICONS[faction]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-[#caa45a] font-semibold leading-none">
            {FACTION_LABELS[faction]}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5 leading-none truncate">
            {vehicleSpec?.displayName ?? 'No vehicle assigned'}
          </div>
        </div>
        <div
          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded
                        bg-black/50 text-[#caa45a] border border-[#caa45a]/30"
        >
          {slot.season}
        </div>
      </div>

      {/* BODY: 3D render with main decal stamped top-left */}
      <div
        className="relative"
        style={{
          height: BODY_H,
          background: 'radial-gradient(ellipse at 50% 35%, #1a2333 0%, #060b14 75%)',
        }}
      >
        {bodyUrl ? (
          <img
            src={bodyUrl}
            alt=""
            className="w-full h-full object-contain"
            style={{ filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.5))' }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
              {vehicleSpec ? 'rendering…' : 'no vehicle'}
            </div>
          </div>
        )}

        {/* Main decal badge — top-left, mirroring CoH2's customization
            screen which puts the unit insignia on the upper port flank. */}
        {decalUrl && (
          <div
            className="absolute top-2 left-2 w-12 h-12 rounded-md overflow-hidden
                          bg-black/50 ring-1 ring-[#caa45a]/40 p-1.5"
          >
            <img src={decalUrl} alt="" className="w-full h-full object-contain" />
          </div>
        )}

        {/* Faceted gold corner accents — purely cosmetic, mimics the
            shop card's bevelled inner border. */}
        <CornerAccent corner="tl" />
        <CornerAccent corner="tr" />
        <CornerAccent corner="bl" />
        <CornerAccent corner="br" />
      </div>

      {/* FOOTER: slot label + content summary */}
      <div className="px-3 py-2 bg-black/30">
        <div className="text-[12px] font-semibold text-white/90 truncate leading-tight">
          {slot.label || `${capitalise(slot.season)} slot ${slot.slotIdx + 1}`}
        </div>
        <div className="text-[10px] text-zinc-500 leading-tight mt-0.5 truncate">{slotSummary}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Decorations
// ─────────────────────────────────────────────────────────────────────────

// Hoisted outside the component so the object isn't re-created on every render.
const CORNER_CLASSES: Record<'tl' | 'tr' | 'bl' | 'br', string> = {
  tl: 'top-0 left-0',
  tr: 'top-0 right-0 rotate-90',
  bl: 'bottom-0 left-0 -rotate-90',
  br: 'bottom-0 right-0 rotate-180',
}

/** Small gold corner tick — matches the bevel on CoH2's shop card
 *  inner frame. Position is determined by which corner we're rendering
 *  so all four can share a single component. */
function CornerAccent({ corner }: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const map = CORNER_CLASSES
  return (
    <svg
      className={`absolute ${map[corner]} pointer-events-none`}
      width={12}
      height={12}
      viewBox="0 0 12 12"
    >
      <path d="M 0 2 L 0 0 L 2 0" stroke="#caa45a" strokeWidth={1.2} fill="none" opacity={0.55} />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Positioning
// ─────────────────────────────────────────────────────────────────────────

/** Compute fixed coords for the card, preferring left-of-anchor (the
 *  export panel sits top-right so there's almost always room there).
 *  Falls back to right-of-anchor or bottom-stacked if the viewport
 *  would clip. */
function placeCard(rect: DOMRect): { left: number; top: number } {
  const margin = 12
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Preferred: card sits to the left of the tile, vertically centred.
  let left = rect.left - CARD_W - margin
  let top = rect.top + rect.height / 2 - CARD_H / 2

  if (left < margin) {
    // Try right side instead.
    left = rect.right + margin
    if (left + CARD_W > vw - margin) {
      // Tile is wide / centred — drop the card below it.
      left = Math.max(
        margin,
        Math.min(vw - CARD_W - margin, rect.left + rect.width / 2 - CARD_W / 2),
      )
      top = rect.bottom + margin
    }
  }

  // Vertical clamp.
  top = Math.max(margin, Math.min(vh - CARD_H - margin, top))
  return { left, top }
}

// ─────────────────────────────────────────────────────────────────────────
// Slot inspection helpers
// ─────────────────────────────────────────────────────────────────────────

/** Decide which vehicle this slot showcases. Falls back to the first
 *  vehicle of the slot's primary faction if the snapshot is empty. */
function pickPrimaryVehicle(slot: ExportSlot): {
  vehicleSpec: VehicleSpec | null
  faction: Faction
} {
  const stateVehicles = Object.values(slot.state.vehicles)
  const faction: Faction = slot.factions[0] ?? 'german'
  const primaryId = stateVehicles[0]?.id ?? null
  if (primaryId) {
    const spec = VEHICLES.find(v => v.id === primaryId) ?? null
    if (spec) return { vehicleSpec: spec, faction: spec.faction }
  }
  const fallback = VEHICLES.find(v => v.faction === faction) ?? null
  return { vehicleSpec: fallback, faction }
}

/** Resolve the slot's main decal to a data URL. Reads from the slot
 *  snapshot (NOT live state) so inactive slots show their own decal. */
function resolveSlotMainDecal(slot: ExportSlot, project: Coh2SkinProject): string | null {
  // 1. Slot-level override.
  if (slot.mainDecalId != null) {
    return findDecalImage(slot, project, slot.mainDecalId)
  }
  // 2. Per-vehicle / faction-default fallback on the primary vehicle.
  const stateVehicles = Object.values(slot.state.vehicles)
  const faction: Faction = slot.factions[0] ?? 'german'
  const primary = stateVehicles[0]
  const id = primary?.mainDecalId ?? slot.state.factionDefaults[faction]?.mainDecalId ?? null
  if (id == null) return null
  return findDecalImage(slot, project, id)
}

function findDecalImage(
  slot: ExportSlot,
  project: Coh2SkinProject,
  decalId: number,
): string | null {
  for (const v of Object.values(slot.state.vehicles)) {
    const hit = v.decals.find(d => d.id === decalId)
    if (hit?.imageId) return project.images[hit.imageId]?.dataUrl ?? null
  }
  for (const fd of Object.values(slot.state.factionDefaults)) {
    const hit = fd?.decals.find(d => d.id === decalId)
    if (hit?.imageId) return project.images[hit.imageId]?.dataUrl ?? null
  }
  return null
}

/** Human-readable single-line summary of what's in a slot — used in the
 *  card footer to give the user a quick "what does this slot have on it"
 *  read without enumerating every vehicle. */
function summariseSlot(slot: ExportSlot): string {
  const vehicleCount = Object.keys(slot.state.vehicles).length
  const factionCount = Object.values(slot.state.factionDefaults).filter(Boolean).length
  if (vehicleCount === 0 && factionCount === 0) return 'empty slot — no edits yet'
  const parts: string[] = []
  if (vehicleCount) parts.push(`${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'}`)
  if (factionCount) parts.push(`${factionCount} faction default${factionCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

function capitalise(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1)
}
