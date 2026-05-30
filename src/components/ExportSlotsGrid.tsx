/**
 * ExportSlotsGrid — the 6-tile shop-style grid for the Export panel.
 *
 *   ┌─────┬─────┬─────┐
 *   │ S 1 │ S 2 │ S 3 │   summer slots (slotIdx 0..2)
 *   ├─────┼─────┼─────┤
 *   │ W 1 │ W 2 │ W 3 │   winter slots (slotIdx 0..2)
 *   └─────┴─────┴─────┘
 *
 * Each tile is a thumbnail composed by `composeTileIcon`:
 *   - camo background (slot-specific)
 *   - top-left: vehicle silhouette of the slot's primary vehicle
 *   - top-right: the slot's main decal
 *
 * Clicking a tile syncs the live state into the current slot, then
 * loads the target slot's state. Step 10 wires the hover-preview
 * card on top of this grid.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Coh2SkinProject, ExportSlot } from '@/lib/project'
import { composeTileIcon } from '@/lib/tile-icon-compositor'
// Layer-derivation + hashing live in `@/lib/slot-thumbnail` so SlotIconGrid
// can reuse them without forcing react-refresh to treat this file as
// "mixed-export" (it would otherwise lose HMR for the component).
import { deriveLayersForSlot, hashSlot } from '@/lib/slot-thumbnail'

interface Props {
  project: Coh2SkinProject
  activeSlotIdx: number
  onSelectSlot: (slotIdx: number) => void
  /** Optional — passed through to the vehicle-icon resolver so the
   *  stock-SGA probe path can run. */
  installRoot?: FileSystemDirectoryHandle | null
  /** Optional render hook for the hover preview card (step 10). Called
   *  with the slot when the user hovers, and `null` when they leave. */
  onHoverSlot?: (slot: ExportSlot | null, anchorRect: DOMRect | null) => void
}

/** Cache of composed thumbnails keyed by slot id + a state hash. We
 *  recompute only when the hash changes — composing is async and
 *  involves a chain of image decodes, so caching keeps the grid
 *  smooth on re-render. */
type ThumbCache = Record<string, string>

export default function ExportSlotsGrid({
  project,
  activeSlotIdx,
  onSelectSlot,
  installRoot,
  onHoverSlot,
}: Props) {
  const slots = project.exportSlots
  // Split into the two seasonal rows in display order. We preserve
  // the original index from `project.exportSlots` alongside each slot
  // so the click handler can dispatch to the right global slot —
  // filter+sort would otherwise lose that anchor.
  const indexed: { slot: ExportSlot; srcIdx: number }[] = slots.map((s, i) => ({
    slot: s,
    srcIdx: i,
  }))
  const summer = indexed
    .filter(x => x.slot.season === 'summer')
    .sort((a, b) => a.slot.slotIdx - b.slot.slotIdx)
  const winter = indexed
    .filter(x => x.slot.season === 'winter')
    .sort((a, b) => a.slot.slotIdx - b.slot.slotIdx)

  // Hash each slot's relevant inputs so we know when to recompute.
  // `state` and `mainDecalId` change → re-render thumb.
  const stateHashes = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of slots) m[s.id] = hashSlot(s)
    return m
  }, [slots])

  const [thumbs, setThumbs] = useState<ThumbCache>({})
  // Track what we've already computed so the effect can short-circuit.
  const lastHashRef = useRef<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const s of slots) {
        const h = stateHashes[s.id]
        if (lastHashRef.current[s.id] === h) continue
        const layers = deriveLayersForSlot(s, project, installRoot)
        try {
          const dataUrl = await composeTileIcon(await layers)
          if (cancelled) return
          lastHashRef.current[s.id] = h
          setThumbs(prev => ({ ...prev, [s.id]: dataUrl }))
        } catch (e) {
          // Compositor failures shouldn't crash the panel — log and
          // leave the tile thumbless (the placeholder will render).
          console.warn('[ExportSlotsGrid] failed to compose thumb', s.id, e)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [stateHashes, project, installRoot, slots])

  return (
    <div className="flex flex-col gap-1.5">
      <RowLabel label="Summer" />
      <SlotRow
        slots={summer}
        activeSlotIdx={activeSlotIdx}
        onSelectSlot={onSelectSlot}
        thumbs={thumbs}
        onHoverSlot={onHoverSlot}
      />
      <RowLabel label="Winter" />
      <SlotRow
        slots={winter}
        activeSlotIdx={activeSlotIdx}
        onSelectSlot={onSelectSlot}
        thumbs={thumbs}
        onHoverSlot={onHoverSlot}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Row + tile
// ─────────────────────────────────────────────────────────────────────────

function RowLabel({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-3)]">{label}</div>
  )
}

interface SlotRowProps {
  slots: { slot: ExportSlot; srcIdx: number }[]
  activeSlotIdx: number
  onSelectSlot: (globalIdx: number) => void
  thumbs: ThumbCache
  onHoverSlot?: (slot: ExportSlot | null, anchorRect: DOMRect | null) => void
}

function SlotRow({ slots, activeSlotIdx, onSelectSlot, thumbs, onHoverSlot }: SlotRowProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {slots.map(({ slot: s, srcIdx }) => (
        <SlotTile
          key={s.id}
          slot={s}
          active={srcIdx === activeSlotIdx}
          thumbUrl={thumbs[s.id]}
          onSelect={() => onSelectSlot(srcIdx)}
          onHover={anchor => onHoverSlot?.(anchor ? s : null, anchor)}
        />
      ))}
    </div>
  )
}

interface SlotTileProps {
  slot: ExportSlot
  active: boolean
  thumbUrl: string | undefined
  onSelect: () => void
  onHover: (anchorRect: DOMRect | null) => void
}

const SlotTile = memo(function SlotTile({
  slot,
  active,
  thumbUrl,
  onSelect,
  onHover,
}: SlotTileProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const isEmpty = Object.keys(slot.state.vehicles).length === 0
  const handleMouseEnter = useCallback(
    () => onHover(ref.current?.getBoundingClientRect() ?? null),
    [onHover],
  )
  const handleMouseLeave = useCallback(() => onHover(null), [onHover])
  return (
    <button
      ref={ref}
      onClick={onSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-label={`${slot.label || cap(slot.season) + ' ' + (slot.slotIdx + 1)} — ${slot.season} slot ${slot.slotIdx + 1}${active ? ' (active)' : ''}`}
      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-black/80
        ${
          active
            ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/40'
            : 'border-white/10 hover:border-white/40'
        }`}
      title={`${slot.label || '(no label)'} — ${slot.season} slot ${slot.slotIdx + 1}`}
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-white/5 text-[10px] text-[var(--color-text-3)]">
          {isEmpty ? 'empty' : '…'}
        </div>
      )}
      {/* Bottom strip with the slot's label. Fades from transparent to
          dark so the camo behind remains legible. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-left">
        <div className="text-[10px] font-medium text-white/90 truncate">
          {slot.label || `${cap(slot.season)} ${slot.slotIdx + 1}`}
        </div>
      </div>
    </button>
  )
})

function cap(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1)
}

// Helpers (`deriveLayersForSlot`, `hashSlot`, and their privates) live in
// `@/lib/slot-thumbnail` — pulled out so SlotIconGrid can share them and
// react-refresh stops complaining about mixed exports from this file.
