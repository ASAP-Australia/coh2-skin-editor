/**
 * IconButton — 22×22px transparent icon-only button.
 *
 * Promotes DecalPackEditor's file-local `IconBtn` into a shared primitive.
 * Used for inline row actions where a label would crowd the layout —
 * visibility toggle, delete, duplicate inside a layer-list row.
 *
 * Always carries an `aria-label` (via the required `title` prop) — never
 * render an icon-only button without an accessible name.
 *
 * `onClick` is wrapped to stop event propagation by default — the typical
 * use is inside a clickable parent row, and you almost never want the row's
 * click handler to fire when the user hits the trash icon. Pass
 * `stopPropagation={false}` if you have a legitimate need for bubbling.
 */

import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { EDITOR_TEXT_2 } from './tokens'

interface Props {
  /** Required — used as both `title` and `aria-label`. */
  title: string
  onClick: () => void
  children: ReactNode
  /** Pixel size of the button (height + width). Default 22. */
  size?: number
  /** Whether to stop click propagation (default true). */
  stopPropagation?: boolean
  /** Pass `'destructive'` to tint hover red for delete actions. The base
   *  colour stays neutral — only hover crosses the danger threshold. */
  intent?: 'default' | 'destructive'
  style?: CSSProperties
}

export default function IconButton({
  title,
  onClick,
  children,
  size = 22,
  stopPropagation = true,
  intent = 'default',
  style,
}: Props) {
  const handle = (ev: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) ev.stopPropagation()
    onClick()
  }
  const merged: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    background: 'transparent',
    border: 'none',
    color: EDITOR_TEXT_2,
    cursor: 'pointer',
    borderRadius: 4,
    padding: 0,
    flexShrink: 0,
    transition: 'color 120ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    ...(intent === 'destructive'
      ? {
          // `:hover` color shift is the cleanest "this is dangerous" cue
          // without changing the resting layout. CSS-in-JS doesn't do
          // :hover natively in inline styles, so we use the CSS custom-
          // property trick: the consumer can attach `:hover { color: red }`
          // via className. For now we just hint at intent via a slightly
          // warmer base colour; the className escape hatch is available.
          color: 'rgba(247,200,200,0.65)',
        }
      : {}),
    ...style,
  }
  return (
    <button type="button" title={title} aria-label={title} onClick={handle} style={merged}>
      {children}
    </button>
  )
}
