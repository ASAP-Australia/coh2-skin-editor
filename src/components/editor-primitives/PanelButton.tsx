/**
 * PanelButton — small ghost button used inside editor side-panels.
 *
 * Consolidates the `toolbarButton` / `sidePanelButton` / `topbarButton`
 * inline-style atoms duplicated across both editors. Three size variants
 * map to the three places these buttons currently appear:
 *
 *   • `size="topbar"`  — taller, slightly heavier. Used in topbar action
 *     slots (Save, Undo, Export).
 *   • `size="medium"`  — the default. Used for primary in-panel actions
 *     ("+ Add text", "Reset adjustments", "Duplicate decal").
 *   • `size="compact"` — smaller, lighter. Used for inline tool buttons
 *     (Flip H, Flip V, Earlier, Later) where multiple sit side-by-side.
 *
 * Visual state:
 *   • Inactive: faint `rgba(255,255,255,0.03–0.04)` fill with thin border.
 *   • Active:   `rgba(120,180,255,0.18)` fill — the editor's blue accent at
 *     "this control IS selected" alpha. Use `active` for two-state toggles
 *     like Flip H/V.
 *   • Disabled: opacity 0.4 + cursor `default`. We don't pass the native
 *     `disabled` attribute because we still want pointer cursor recognition
 *     for buttons that GUARD an action but should still receive focus.
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import {
  panelButtonStyle,
  panelButtonLargeStyle,
  topbarButtonStyle,
  EDITOR_ACCENT_FILL_STRONG,
} from './tokens'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode
  /** Visual scale. Default `'medium'`. */
  size?: 'topbar' | 'medium' | 'compact'
  /** Two-state active flag. When true, fill becomes the blue accent. */
  active?: boolean
  /** Flex layout helper — pass `true` for buttons that should grow to fill
   *  a row (Flip H / Flip V live in a `flex` row at flex:1 each). */
  flex?: boolean
  /** Pass `'center'` for buttons whose icon+label should be centred. */
  align?: 'left' | 'center'
  style?: CSSProperties
}

export default function PanelButton({
  children,
  size = 'medium',
  active = false,
  flex = false,
  align,
  style,
  disabled,
  ...rest
}: Props) {
  const base: CSSProperties =
    size === 'topbar'
      ? topbarButtonStyle
      : size === 'compact'
        ? panelButtonStyle
        : panelButtonLargeStyle

  const merged: CSSProperties = {
    ...base,
    ...(active ? { background: EDITOR_ACCENT_FILL_STRONG } : {}),
    ...(flex ? { flex: 1, justifyContent: 'center', gap: 4 } : {}),
    ...(align === 'center' && !flex ? { justifyContent: 'center' } : {}),
    ...(disabled
      ? {
          opacity: 0.4,
          cursor: 'default',
        }
      : {}),
    ...style,
  }

  return (
    <button type="button" disabled={disabled} style={merged} {...rest}>
      {children}
    </button>
  )
}
