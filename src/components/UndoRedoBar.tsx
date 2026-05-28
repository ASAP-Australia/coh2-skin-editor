/**
 * UndoRedoBar — small floating chrome chip that exposes Undo / Redo as
 * visible buttons. The keyboard shortcuts (Ctrl+Z / Ctrl+Y) still drive
 * the same DecalHistory instance; this just gives new users a clickable
 * affordance so they know history exists at all.
 *
 * Mounted in the top chrome strip beside the TopBar so it's always
 * reachable without overlapping the viewport's interactive area.
 */

import { memo } from 'react'
import { Undo2, Redo2 } from 'lucide-react'

interface Props {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

const UndoRedoBar = memo(function UndoRedoBar({ canUndo, canRedo, onUndo, onRedo }: Props) {
  return (
    <div
      className="flex items-center gap-0.5 px-1 py-0.5 rounded-full
                 bg-black/35 border border-white/[0.08]
                 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_0.5px_0_rgba(255,255,255,0.08)]"
      style={{ backdropFilter: 'blur(24px) saturate(160%)' }}
    >
      <IconChip disabled={!canUndo} onClick={onUndo} label="Undo (Ctrl+Z)">
        <Undo2 className="size-3.5" aria-hidden />
      </IconChip>
      <IconChip disabled={!canRedo} onClick={onRedo} label="Redo (Ctrl+Y)">
        <Redo2 className="size-3.5" aria-hidden />
      </IconChip>
    </div>
  )
})

export default UndoRedoBar

function IconChip({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center size-7 rounded-full
                  transition-colors
                  ${
                    disabled
                      ? 'text-foreground/30 cursor-not-allowed'
                      : 'text-foreground/85 hover:text-foreground hover:bg-white/[0.08]'
                  }`}
    >
      {children}
    </button>
  )
}
