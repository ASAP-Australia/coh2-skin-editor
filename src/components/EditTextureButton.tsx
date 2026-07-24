/**
 * EditTextureButton — bottom-row glass pill that flips the editor into
 * direct texture-painting mode for the currently-selected vehicle.
 *
 * The user's request: "have an up menu pill that allows you to … press
 * edit, and it takes you to the vehicle editing screen … or the editing
 * view. Maybe don't take them to a new editor — we just, like, take them
 * to the [brush] editor, and then they can come back, or they can edit
 * on the three-d model as it is."
 *
 * This pill clicks-through to the existing brush flow rather than
 * routing to a new view — exactly the in-place behaviour the user asked
 * for. One click does three things:
 *   • opens the Brush panel  (`setActivePanel('brush')`)
 *   • enables paint mode     (`setBrushOn(true)`)
 *   • clears the "symmetric" flag on the brush settings so the user
 *     starts in plain one-sided painting. The user explicitly asked for
 *     symmetry to be disable-able from this entry point — defaulting to
 *     off here satisfies that without requiring an extra step.
 *
 * Visually mirrors `GenerateButton` so the pill controls feel like a family.
 * Same glass background, same height, same hover affordance.
 *
 * Pressed state: when the brush is already on, the pill renders as
 * pressed (brighter background + accent text) so the user has a clear
 * "you are currently editing the texture" signal — clicking it again
 * exits paint mode and closes the brush panel.
 */

import { Brush } from 'lucide-react'

interface Props {
  /** Whether the brush is currently active. Drives the pressed/idle styling. */
  brushOn: boolean
  /** Click handler — flips the editor into/out of texture-edit mode. */
  onClick: () => void
  /** Disable while no vehicle is loaded (there's nothing to paint on). */
  disabled?: boolean
}

export default function EditTextureButton({ brushOn, onClick, disabled = false }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={brushOn ? 'Exit texture-edit mode' : 'Edit vehicle texture'}
      aria-pressed={brushOn}
      title={
        brushOn
          ? 'Exit texture-edit mode (return to viewing)'
          : 'Edit the vehicle texture — paint directly on the 3D model'
      }
      data-testid="edit-texture-pill"
      className={
        'l01-ring relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-all duration-150 select-none disabled:opacity-50 disabled:cursor-not-allowed' +
        // Inactive surface = shared `glass-pill` recipe; active swaps to the
        // green "editing" tint below.
        (brushOn ? '' : ' glass-pill')
      }
      style={
        brushOn
          ? {
              background: 'rgba(160, 200, 90, 0.85)',
              color: 'rgb(20, 24, 12)',
              backdropFilter: 'blur(36px) saturate(160%)',
              WebkitBackdropFilter: 'blur(36px) saturate(160%)',
              border: '0.5px solid rgba(255,255,255,0.30)',
              boxShadow:
                '0 8px 22px rgba(120, 160, 60, 0.40), inset 0 0.5px 0 rgba(255,255,255,0.30)',
              fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
              fontVariantNumeric: 'slashed-zero',
            }
          : {
              color: 'rgb(229, 231, 235)',
              fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
              fontVariantNumeric: 'slashed-zero',
            }
      }
    >
      <Brush size={13} strokeWidth={2} />
      <span>{brushOn ? 'Editing texture' : 'Edit texture'}</span>
    </button>
  )
}
