/**
 * SkinPackInGamePreview — wraps the 6-tile shop-style grid plus its
 * 3D-render hover card into a single "as seen in game" surface for the
 * skin-pack export panel/modal.
 *
 * The grid and card components already exist (`ExportSlotsGrid`,
 * `ExportTilePreview`) and were originally embedded in the Export panel
 * sidebar. This wrapper presents them in a labelled frame with a small
 * caption so users staring at the Export button can see the in-game
 * presentation BEFORE they install — no need to discover the sidebar
 * version separately.
 *
 * Lifecycle: re-mounting cost is zero because the inner ExportSlotsGrid
 * caches composed tile thumbnails by slot-hash, and ExportTilePreview's
 * 3D renderer caches per vehicle id.
 */

import { useState } from 'react'
import type { Coh2SkinProject, ExportSlot } from '@/lib/project'
import ExportSlotsGrid from './ExportSlotsGrid'
import ExportTilePreview from './ExportTilePreview'

interface Props {
  project: Coh2SkinProject
  activeSlotIdx: number
  onSelectSlot: (slotIdx: number) => void
  installRoot: FileSystemDirectoryHandle | null
}

export default function SkinPackInGamePreview({
  project,
  activeSlotIdx,
  onSelectSlot,
  installRoot,
}: Props) {
  const [hover, setHover] = useState<{ slot: ExportSlot; anchor: DOMRect } | null>(null)

  return (
    <div
      role="region"
      aria-label="In-game preview of how your skin pack will appear in the customisation screen"
      style={{
        background: 'linear-gradient(180deg, #0d1420 0%, #0a0e18 100%)',
        border: '1px solid rgba(202, 164, 90, 0.18)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <PreviewHeading>As seen in-game — Customise → Skins</PreviewHeading>

      {/* Column headers naming the canonical CoH2 weight classes the
          three columns map to. In-game the slots are addressed as
          "Light Summer", "Medium Summer", "Heavy Summer" (and the
          winter equivalents) — surfacing the labels here lets users
          see at a glance which column will be applied to which tank
          weight class when their pack is installed. */}
      <div
        aria-hidden="true"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          fontSize: 9,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: 'rgba(202, 164, 90, 0.7)',
          paddingInline: 2,
        }}
      >
        <span style={{ textAlign: 'center' }}>Light</span>
        <span style={{ textAlign: 'center' }}>Medium</span>
        <span style={{ textAlign: 'center' }}>Heavy</span>
      </div>

      <ExportSlotsGrid
        project={project}
        activeSlotIdx={activeSlotIdx}
        onSelectSlot={onSelectSlot}
        installRoot={installRoot}
        onHoverSlot={(slot, anchor) => {
          if (slot && anchor) setHover({ slot, anchor })
          else setHover(null)
        }}
      />

      <p
        style={{
          margin: 0,
          fontSize: 10,
          color: 'rgba(247,247,250,0.45)',
          lineHeight: 1.5,
        }}
      >
        Six slots: three summer + three winter, applied by tank weight (light / medium / heavy).
        Hover any tile to see the lobby info card — the same view other players see in the customise
        screen.
      </p>

      {/* The hover preview overlays as a fixed-position card so it
          escapes our card's overflow box. */}
      {hover && installRoot && (
        <ExportTilePreview
          slot={hover.slot}
          anchorRect={hover.anchor}
          project={project}
          installRoot={installRoot}
        />
      )}
    </div>
  )
}

function PreviewHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: '#caa45a',
      }}
    >
      {children}
    </h3>
  )
}
