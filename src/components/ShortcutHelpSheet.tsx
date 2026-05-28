import { useEffect, useState } from 'react'

/**
 * Press-and-hold "?" reveals the shortcut cheat-sheet. Self-contained — no
 * trigger UI of its own; the parent mounts it once and the global key
 * listener handles open/close. Releasing the key (or pressing Escape)
 * closes the sheet.
 *
 * Built with the brand glass tokens so it sits inside the existing visual
 * language without pulling in the shadcn neutral scale.
 */

type Row = { keys: string[]; label: string }

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'Editing',
    rows: [
      { keys: ['Ctrl', 'S'], label: 'Save project' },
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
      { keys: ['Ctrl', 'Y'], label: 'Redo (alt)' },
      { keys: ['Delete'], label: 'Remove selected decal' },
      { keys: ['Esc'], label: 'Cancel placement / close panel' },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: ['R'], label: 'Reset camera' },
      { keys: ['F', 'or', 'H'], label: 'Toggle UI chrome' },
      { keys: ['?'], label: 'Show this sheet' },
    ],
  },
  {
    title: 'Mouse',
    rows: [
      { keys: ['LMB drag'], label: 'Orbit camera' },
      { keys: ['RMB drag'], label: 'Pan camera' },
      { keys: ['Wheel'], label: 'Zoom' },
      { keys: ['Ctrl', 'V'], label: 'Paste camo (Camo panel)' },
    ],
  },
]

export default function ShortcutHelpSheet() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inText =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t?.isContentEditable ?? false)
      if (inText) return
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setOpen(o => !o)
        return
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop — closes the sheet when clicked */}
      <button
        type="button"
        aria-label="Close keyboard shortcuts"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog is ARIA-interactive; jsx-a11y rule is a known false-positive for role="dialog" */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative glass-2 rounded-[var(--radius-panel)] p-6 max-w-2xl w-[90%] max-h-[80vh] overflow-y-auto"
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false)
        }}
        style={{ boxShadow: 'var(--shadow-glass)' }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-[var(--color-text-1)] text-lg font-medium">Keyboard shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]"
          >
            close (Esc)
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {GROUPS.map(group => (
            <div key={group.title}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-3)] mb-2">
                {group.title}
              </div>
              <ul className="space-y-1.5">
                {group.rows.map((row, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-[var(--color-text-2)]">{row.label}</span>
                    <span className="flex gap-1 flex-shrink-0">
                      {row.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-[var(--color-glass-2)] border border-[var(--color-stroke-1)] text-[var(--color-text-1)]"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
