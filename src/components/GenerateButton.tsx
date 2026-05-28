/**
 * GenerateButton — entry point for AI-assisted camo / decal / image
 * generation. Sits to the right of the bottom-center row (where
 * SeasonToggle used to live) and always shows the BorderBeam ocean
 * sweep so the user can spot the "AI feature" without reading the
 * label.
 *
 * Style mirrors SeasonToggle: same glass pill background, same height,
 * so the two read as siblings sharing a row.
 */

import { Sparkles } from 'lucide-react'
import BorderBeam from './ui/border-beam'

interface Props {
  onClick?: () => void
  /** Disable the button (e.g. while a generation is in flight). */
  disabled?: boolean
}

export default function GenerateButton({ onClick, disabled = false }: Props) {
  // borderRadius capped at 18px (matches the natural pill height).
  // Previously this was 9999, which degenerates the BorderBeam's conic
  // mask + clip-path geometry at extreme radii — the beam stopped
  // animating and the button visually "froze" so it read as broken.
  // 18 is enough to round the corners flush with `rounded-full` on a
  // ~26 px-tall pill, without overshooting the geometry.
  return (
    <BorderBeam
      colorVariant="ocean"
      duration={5}
      strength={0.9}
      borderRadius={18}
      borderWidth={1}
      className="inline-flex"
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label="Open AI camo generator"
        title="Generate camo with AI"
        className="relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-white cursor-pointer transition-all duration-150 select-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: 'rgba(20, 22, 28, 0.62)',
          backdropFilter: 'blur(28px) saturate(180%)',
          border: '0.5px solid rgba(255,255,255,0.10)',
          boxShadow: '0 8px 22px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
        }}
      >
        <Sparkles size={13} strokeWidth={2} />
        <span>Generate</span>
      </button>
    </BorderBeam>
  )
}
