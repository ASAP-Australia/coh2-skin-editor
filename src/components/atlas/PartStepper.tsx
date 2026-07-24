/**
 * PartStepper — ◀ Part Name (N/6) ▶ control for cycling atlas parts.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ATLAS_PART_DEFS, atlasPartLabel } from '@/lib/decal-pack-project'

interface Props {
  activeIndex: number                   // 0..5
  onChange: (index: number) => void
}

export default function PartStepper({ activeIndex, onChange }: Props) {
  const total = ATLAS_PART_DEFS.length  // 6
  const def = ATLAS_PART_DEFS[activeIndex]
  const prev = () => onChange((activeIndex - 1 + total) % total)
  const next = () => onChange((activeIndex + 1) % total)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        background: 'rgba(16,18,24,0.80)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        userSelect: 'none',
      }}
    >
      <button onClick={prev} aria-label="Previous part" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', padding: 2 }}>
        <ChevronLeft size={16} />
      </button>
      <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, minWidth: 160, textAlign: 'center' }}>
        {def ? atlasPartLabel(activeIndex) : '—'} ({activeIndex + 1}/{total})
        {def?.locked && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.5 }}>🔒</span>}
      </span>
      <button onClick={next} aria-label="Next part" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', padding: 2 }}>
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
