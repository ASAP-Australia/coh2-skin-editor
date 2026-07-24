/**
 * keyboard-shortcuts-data — default shortcut groups for KeyboardShortcutsOverlay.
 *
 * Extracted to a separate module so react-refresh doesn't complain about
 * non-component exports mixed into a component file.
 */

export interface ShortcutGroup {
  title: string
  rows: Array<[keys: string, action: string]>
}

export const DEFAULT_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Global',
    rows: [
      ['Esc', 'Close overlay / deselect'],
      ['F1', 'Show keyboard shortcuts'],
      ['Ctrl+S', 'Save & sync'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
      ['Ctrl+0', 'Fit to window'],
      ['Ctrl+1', '100% zoom'],
      ['Space + drag', 'Pan canvas'],
      ['Middle-drag', 'Pan canvas'],
    ],
  },
  {
    title: 'Faceplate composer',
    rows: [
      ['V', 'Select / move tool'],
      ['T', 'Text tool'],
      ['B', 'Draw (brush) tool'],
      ['E', 'Eraser tool'],
      ['I', 'Eyedropper'],
      ['S', 'Shapes tool'],
      ['Ctrl+G', 'Group selected layers'],
      ['Ctrl+Shift+G', 'Ungroup'],
      ['[', 'Move layer down'],
      [']', 'Move layer up'],
      ['↑ ↓ ← →', 'Nudge 1 px'],
      ['Shift+↑ ↓ ← →', 'Nudge 10 px'],
      ['Delete', 'Remove selected layer'],
      ['Ctrl+D', 'Duplicate layer'],
      ['Alt+drag', 'Duplicate layer in place'],
      ['Shift+click (layers)', 'Range-select layers'],
      ['Ctrl+C', 'Copy layer'],
      ['Ctrl+V', 'Paste layer'],
    ],
  },
  {
    title: 'Decal pack',
    rows: [
      ['N', 'Import image (new decal slot)'],
      ['[ (select)', 'Move decal down'],
      ['] (select)', 'Move decal up'],
      ['Delete', 'Remove decal'],
      ['Ctrl+D', 'Duplicate decal'],
      ['Ctrl+C', 'Copy decal'],
      ['Ctrl+V', 'Paste decal'],
      ['Esc', 'Deselect decal'],
    ],
  },
  {
    title: 'Vehicle editor',
    rows: [
      ['Ctrl+S', 'Save project'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      ['Ctrl+Y', 'Redo (alt)'],
      ['Delete', 'Remove selected decal'],
      ['Esc', 'Cancel / close panel'],
      ['R', 'Reset camera'],
      ['F or H', 'Toggle UI chrome'],
      ['?', 'Show this sheet'],
      ['LMB drag', 'Orbit camera'],
      ['RMB drag', 'Pan camera'],
      ['Wheel', 'Zoom'],
      ['Ctrl+V', 'Paste camo (Camo panel)'],
    ],
  },
]
