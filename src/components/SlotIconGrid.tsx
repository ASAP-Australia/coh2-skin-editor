/**
 * SlotIconGrid — 3×2 thumbnail grid for the pack-identity popover.
 *
 * WHY THIS EXISTS: the PackIdentityPopover now needs a click-to-edit grid of
 * slot icons so users can swap the per-slot thumbnail images without leaving
 * the popover flow. This component renders the same seasonal layout as
 * ExportSlotsGrid but with purely edit semantics — no active-slot ring, just
 * hover affordance, and each tile calls `onSlotClick` instead of switching
 * the active edit slot.
 *
 * THUMBNAIL PIPELINE: if the slot has a user-supplied `slotIcon` data URL, we
 * show it directly. Otherwise we fall back to the same `composeTileIcon` +
 * `deriveLayersForSlot` pipeline that ExportSlotsGrid uses, reusing the
 * exported helpers so the logic stays in one place.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Coh2SkinProject, ExportSlot } from '@/lib/project'
import { composeTileIcon } from '@/lib/tile-icon-compositor'
import { deriveLayersForSlot, hashSlot } from '@/lib/slot-thumbnail'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  project: Coh2SkinProject
  onSlotClick: (slotIdx: number) => void
  installRoot?: FileSystemDirectoryHandle | null
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThumbCache = Record<string, string>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cap(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlotIconGrid({ project, onSlotClick, installRoot }: Props) {
  const slots = project.exportSlots

  // Attach global slot index alongside each slot entry so click handler
  // dispatches the right index.
  const indexed = slots.map((slot, srcIdx) => ({ slot, srcIdx }))
  const summer = indexed
    .filter(x => x.slot.season === 'summer')
    .sort((a, b) => a.slot.slotIdx - b.slot.slotIdx)
  const winter = indexed
    .filter(x => x.slot.season === 'winter')
    .sort((a, b) => a.slot.slotIdx - b.slot.slotIdx)

  // Hash each slot to detect when a fallback thumbnail needs recomputing.
  // Slots with a user-supplied slotIcon skip the compositor entirely so
  // only their slotIcon string is hashed.
  const stateHashes = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of slots) {
      m[s.id] = s.slotIcon ? `icon:${s.slotIcon.slice(0, 32)}` : hashSlot(s)
    }
    return m
  }, [slots])

  const [thumbs, setThumbs] = useState<ThumbCache>({})
  const lastHashRef = useRef<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const s of slots) {
        const h = stateHashes[s.id]
        if (lastHashRef.current[s.id] === h) continue

        // If the slot has a user icon we just store it directly — no compositor.
        if (s.slotIcon) {
          if (cancelled) return
          lastHashRef.current[s.id] = h
          setThumbs(prev => ({ ...prev, [s.id]: s.slotIcon! }))
          continue
        }

        // Fallback: compose from camo/vehicle/decal layers.
        try {
          const layers = await deriveLayersForSlot(s, project, installRoot)
          const dataUrl = await composeTileIcon(layers)
          if (cancelled) return
          lastHashRef.current[s.id] = h
          setThumbs(prev => ({ ...prev, [s.id]: dataUrl }))
        } catch (e) {
          console.warn('[SlotIconGrid] failed to compose thumb', s.id, e)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [stateHashes, project, installRoot, slots])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <RowLabel label="Summer" />
      <SlotRow slots={summer} thumbs={thumbs} onSlotClick={onSlotClick} />
      <RowLabel label="Winter" />
      <SlotRow slots={winter} thumbs={thumbs} onSlotClick={onSlotClick} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row label
// ---------------------------------------------------------------------------

function RowLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--color-text-3)',
      }}
    >
      {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row of 3 tiles
// ---------------------------------------------------------------------------

interface SlotRowProps {
  slots: { slot: ExportSlot; srcIdx: number }[]
  thumbs: ThumbCache
  onSlotClick: (srcIdx: number) => void
}

function SlotRow({ slots, thumbs, onSlotClick }: SlotRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        // Size columns to the 80px tile, NOT 1fr. With `repeat(3, 1fr)` the
        // columns stretched to fill the popover while the tiles stayed pinned
        // at 80px, so the surplus column width rendered as a big gap BETWEEN
        // the icons ("space between the summer/winter icons is too wide").
        // Fixed 80px tracks + an 8px gap keeps the three icons snug.
        gridTemplateColumns: 'repeat(3, 80px)',
        justifyContent: 'start',
        gap: 8,
      }}
    >
      {slots.map(({ slot: s, srcIdx }) => (
        <SlotTile
          key={s.id}
          slot={s}
          thumbUrl={thumbs[s.id]}
          srcIdx={srcIdx}
          onSlotClick={onSlotClick}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Individual tile
// ---------------------------------------------------------------------------

interface SlotTileProps {
  slot: ExportSlot
  thumbUrl: string | undefined
  srcIdx: number
  onSlotClick: (srcIdx: number) => void
}

function SlotTile({ slot, thumbUrl, srcIdx, onSlotClick }: SlotTileProps) {
  const [hovered, setHovered] = useState(false)
  const label = slot.label || `${cap(slot.season)} ${slot.slotIdx + 1}`
  const caption = `${cap(slot.season)} ${slot.slotIdx + 1}`

  return (
    <button
      type="button"
      title={`Edit icon — ${label}`}
      aria-label={`Edit icon for ${label}`}
      onClick={() => onSlotClick(srcIdx)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        width: 80,
        height: 80,
        flexShrink: 0,
        borderRadius: 8,
        overflow: 'hidden',
        border: hovered
          ? '0.5px solid rgba(255,255,255,0.4)'
          : '0.5px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.05)',
        cursor: 'pointer',
        padding: 0,
        transition: 'border-color 120ms ease',
        display: 'block',
      }}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: 'rgba(255,255,255,0.3)',
          }}
        >
          …
        </div>
      )}

      {/* Bottom gradient strip with slot caption */}
      <div
        style={{
          position: 'absolute',
          inset: 'auto 0 0 0',
          background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
          padding: '6px 4px 3px',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.9)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {caption}
        </div>
      </div>
    </button>
  )
}
