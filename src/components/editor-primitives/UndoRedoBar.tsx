/**
 * UndoRedoBar — the ONE shared Undo / Redo affordance for every canvas
 * editor (skin editor, FaceplateEditor, DecalPackEditor). R1: "render one
 * consistent Undo/Redo control in all three".
 *
 * Renders two icon-only glass-pill buttons using the same recipe as the
 * DecalPackEditor top-left cluster (36×36 rounded-xl glass chips with a
 * RotateCcw / RotateCw lucide icon), so the control reads identically no
 * matter which editor you're in. The keyboard shortcuts (Ctrl+Z / redo)
 * still drive the same history engine — these buttons exist so new users
 * discover that history exists at all, and the shortcut is taught via the
 * tooltip / aria-label.
 *
 * Placement is the caller's responsibility (typically inside the top-left
 * home-button cluster). The bar itself is layout-neutral: a flex row with
 * a 6px gap that the caller drops into their existing cluster.
 *
 * Contract pinned by UndoRedoBar.test.tsx:
 *   • exactly two <button type="button"> — one Undo, one Redo
 *   • each carries a leading lucide <svg> (aria-hidden)
 *   • aria-label + title encode gesture + shortcut ("Undo (Ctrl+Z)" …)
 *   • the two disabled flags are independent
 *   • clicking fires exactly its own handler; disabled swallows the click
 */

import { memo, type CSSProperties } from 'react'
import { RotateCcw, RotateCw } from 'lucide-react'

interface Props {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** Accessible label + tooltip for Undo. Encodes the keyboard shortcut so
   *  this control is where users learn it. Default: "Undo (Ctrl+Z)". */
  undoLabel?: string
  /** Accessible label + tooltip for Redo. Default: "Redo (Ctrl+Y)". */
  redoLabel?: string
  /** Pixel size of each chip (height + width). Default 36. */
  size?: number
}

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 12,
  background: 'rgba(15, 17, 22, 0.75)',
  backgroundImage:
    'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
  backdropFilter: 'blur(40px) saturate(150%)',
  WebkitBackdropFilter: 'blur(40px) saturate(150%)',
  border: '0.5px solid rgba(255,255,255,0.08)',
  boxShadow:
    'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(0,0,0,0.2)',
  color: 'var(--color-text-2)',
  cursor: 'pointer',
  padding: 0,
  transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  WebkitAppRegion: 'no-drag',
} as CSSProperties

const CHIP_CLASS =
  'hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-white/30 ' +
  'disabled:opacity-35 disabled:pointer-events-none'

const UndoRedoBar = memo(function UndoRedoBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoLabel = 'Undo (Ctrl+Z)',
  redoLabel = 'Redo (Ctrl+Y)',
  size = 36,
}: Props) {
  const iconSize = Math.round(size * 0.44)
  const dims: CSSProperties = { width: size, height: size }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        title={undoLabel}
        aria-label={undoLabel}
        disabled={!canUndo}
        onClick={onUndo}
        className={CHIP_CLASS}
        style={{ ...CHIP_STYLE, ...dims }}
      >
        <RotateCcw size={iconSize} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        title={redoLabel}
        aria-label={redoLabel}
        disabled={!canRedo}
        onClick={onRedo}
        className={CHIP_CLASS}
        style={{ ...CHIP_STYLE, ...dims }}
      >
        <RotateCw size={iconSize} strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
})

export default UndoRedoBar
