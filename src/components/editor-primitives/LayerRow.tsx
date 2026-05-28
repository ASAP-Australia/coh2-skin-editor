/**
 * LayerRow — generic row for editor layer / decal lists.
 *
 * Promotes the DecalPackEditor decal-row pattern (thumbnail + inline-rename
 * input + visibility + delete) into a shared primitive. The active state
 * uses the editor's blue selection accent — exactly matching the on-canvas
 * selection outline so the visual association is automatic.
 *
 * Slots:
 *   • Leading thumbnail (URL or React node — e.g. for text-layer icons).
 *   • Editable name (text input, click stops row-click propagation).
 *   • Trailing action slot (typically Eye / Trash IconButtons; caller
 *     supplies via `actions` for full flexibility).
 *
 * Keyboard:
 *   • Row is `role="button" tabIndex={0}` so it's reachable via Tab.
 *   • Enter / Space activate the row (call `onSelect`).
 *   • The rename input handles its own typing — clicking it stops the
 *     row's onClick from firing.
 *
 * Drag-reorder is NOT included here — the existing editors use Earlier /
 * Later buttons in the Transform panel for reordering, and adding a drag
 * handle would change the visual layout. We can layer that on top later
 * via a `dragHandle?: ReactNode` slot if v1.1 needs it.
 */

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { EDITOR_ACCENT_BORDER, EDITOR_ACCENT_FILL, EDITOR_TEXT_1 } from './tokens'

interface Props {
  /** Whether this row is the active / selected entry. */
  active: boolean
  /** Visibility flag — controls the row's overall opacity so hidden layers
   *  remain identifiable but visually receded. */
  visible: boolean
  onSelect: () => void
  /** Leading thumbnail. Pass a string URL (rendered as background-image of
   *  a 28×28 swatch) or a React node (rendered inside a 28×28 cell). */
  thumbnail: string | ReactNode
  /** Layer / decal name. Always editable inline. */
  name: string
  onRename: (next: string) => void
  /** Trailing action slot — typically two IconButtons (Eye + Trash). The
   *  buttons should stop their own click propagation so they don't trigger
   *  row selection. */
  actions?: ReactNode
  /** Optional id for keyboard navigation hooks (data-* attribute). */
  id?: string
}

const thumbStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 4,
  background: 'rgba(0,0,0,0.45)',
  backgroundSize: 'contain',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'center',
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
}

export default function LayerRow({
  active,
  visible,
  onSelect,
  thumbnail,
  name,
  onRename,
  actions,
  id,
}: Props) {
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      data-layer-id={id}
      onClick={onSelect}
      onKeyDown={onKey}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        background: active ? EDITOR_ACCENT_FILL : 'transparent',
        border: active ? `1px solid ${EDITOR_ACCENT_BORDER}` : '1px solid transparent',
        borderRadius: 6,
        cursor: 'pointer',
        opacity: visible ? 1 : 0.45,
      }}
    >
      {typeof thumbnail === 'string' ? (
        <div
          style={{
            ...thumbStyle,
            backgroundImage: `url(${thumbnail})`,
          }}
        />
      ) : (
        <div style={thumbStyle}>{thumbnail}</div>
      )}
      <input
        value={name}
        onChange={ev => onRename(ev.target.value)}
        onClick={ev => ev.stopPropagation()}
        aria-label="Layer name"
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          color: EDITOR_TEXT_1,
          fontSize: 11,
          outline: 'none',
          padding: 0,
        }}
      />
      {actions}
    </div>
  )
}
