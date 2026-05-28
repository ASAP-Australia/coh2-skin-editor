/**
 * ExplodeButton — toggles the vehicle "exploded view" in the 3D scene.
 *
 * Sits to the LEFT of SeasonToggle in the bottom-center row, mirroring
 * GenerateButton's placement on the right. Same glass pill background,
 * same 26 px-tall height, so the row reads as three siblings:
 *
 *   [ Explode ]  [ Summer / Winter ]  [ Generate ]
 *
 * When `active` is true (parts are exploded), the icon label flips to
 * "Collapse" so users immediately understand the click will reassemble
 * the vehicle. The icon stays the same — visual consistency over
 * label-driven recognition.
 *
 * The actual explode animation lives in Viewport.tsx — this button only
 * toggles the `explodeAll` state that drives `targetPosRef` lerping in
 * the render-on-demand tick loop. We don't need any animation state of
 * our own; the parent React state IS the animation trigger.
 */

import { Bomb } from 'lucide-react'

interface Props {
  active: boolean
  onClick?: () => void
  /** Hide the button entirely (e.g. while no vehicle is loaded). */
  disabled?: boolean
}

export default function ExplodeButton({ active, onClick, disabled = false }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={active ? 'Collapse exploded vehicle view' : 'Explode vehicle into parts'}
      title={active ? 'Reassemble (E)' : 'Explode into parts (E)'}
      className="relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-all duration-150 select-none disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        // Active state uses a warmer "fired" tint so the user can tell at a
        // glance which mode they're in without reading the label. The
        // backdrop blur + saturate matches GenerateButton + SeasonToggle so
        // the three pills in the row visually anchor together.
        background: active ? 'rgba(190, 90, 40, 0.62)' : 'rgba(20, 22, 28, 0.62)',
        color: active ? '#fff' : 'rgb(229, 231, 235)',
        backdropFilter: 'blur(28px) saturate(180%)',
        border: active
          ? '0.5px solid rgba(255, 180, 120, 0.45)'
          : '0.5px solid rgba(255,255,255,0.10)',
        boxShadow: active
          ? '0 8px 22px rgba(180, 70, 30, 0.45), inset 0 0.5px 0 rgba(255,200,150,0.25)'
          : '0 8px 22px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
      }}
    >
      <Bomb size={13} strokeWidth={2} />
      <span>{active ? 'Collapse' : 'Explode'}</span>
    </button>
  )
}
