/**
 * ToggleChip — two-state pill toggle (off / on).
 *
 * The off state uses the standard panel-button surface; the on state lights
 * up with the editor blue accent. Use for binary tool states like Flip H,
 * Flip V, "lock layer", or future "lock aspect ratio" controls.
 *
 * For brush-tool style "ENABLE / ON" indicators where the on state should
 * feel like an action (orange accent + glow), use a `PanelButton` with the
 * `active` prop and a custom `style` override instead — that's a more
 * affirming visual class than the subtle blue ToggleChip presents.
 */

import type { CSSProperties, ReactNode } from 'react'
import PanelButton from './PanelButton'

interface Props {
  /** Current on/off state. */
  active: boolean
  /** Toggle callback. Receives the new state (i.e. `!active`). */
  onToggle: (next: boolean) => void
  children: ReactNode
  /** Required accessible label — matches IconButton's contract. */
  ariaLabel: string
  /** Layout: pass `flex={true}` for two-up rows (Flip H + Flip V). */
  flex?: boolean
  /** Visual scale — passes through to PanelButton. Default `'compact'`. */
  size?: 'topbar' | 'medium' | 'compact'
  /** Optional inline style overrides — passed through to PanelButton. */
  style?: CSSProperties
}

export default function ToggleChip({
  active,
  onToggle,
  children,
  ariaLabel,
  flex = false,
  size = 'compact',
  style,
}: Props) {
  return (
    <PanelButton
      active={active}
      flex={flex}
      size={size}
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={() => onToggle(!active)}
      style={style}
    >
      {children}
    </PanelButton>
  )
}
