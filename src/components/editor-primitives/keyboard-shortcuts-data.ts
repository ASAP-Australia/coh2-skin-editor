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
    ],
  },
  {
    title: 'Faceplate composer',
    rows: [
      ['T', 'Add text layer'],
      ['[', 'Move layer down'],
      [']', 'Move layer up'],
      ['↑ ↓ ← →', 'Nudge 1 px'],
      ['Shift+↑ ↓ ← →', 'Nudge 10 px'],
      ['Delete', 'Remove selected layer'],
      ['Ctrl+D', 'Duplicate layer'],
      ['Ctrl+C', 'Copy layer'],
      ['Ctrl+V', 'Paste layer'],
    ],
  },
  {
    title: 'Decal pack',
    rows: [
      ['N', 'New decal slot'],
      ['[', 'Move decal down'],
      [']', 'Move decal up'],
      ['Delete', 'Remove decal'],
      ['Ctrl+D', 'Duplicate decal'],
      ['Ctrl+C', 'Copy decal'],
      ['Ctrl+V', 'Paste decal'],
    ],
  },
  {
    title: 'Vehicle editor',
    rows: [
      ['E', 'Toggle explode view / eyedropper'],
      ['F', 'Toggle chrome visibility'],
      ['H', 'Hide chrome layer'],
      ['Ctrl+Z', 'Undo paint stroke'],
    ],
  },
]
