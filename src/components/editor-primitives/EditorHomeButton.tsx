/**
 * EditorHomeButton — the "Home" icon glass pill that returns the user to the
 * StartScreen ("new pack" menu) from any editor surface.
 *
 * Visually a 1:1 clone of the in-vehicle-editor home button living inside
 * `TopBar.tsx` — same 36×36 hit area, same `rounded-xl` corner, same hover
 * recipe (text fades to white, background to `white/10`, 95% active scale).
 *
 * The vehicle editor wraps it inside a wider topbar; here we provide the
 * standalone variant so the faceplate / decal editors can dock it on its own
 * (no surrounding pill, no faction chip, no menu buttons).
 *
 * The button is a `no-drag` region so clicks land instead of being captured
 * by the Electron WindowControls drag-strip that sits in the top 40px.
 */

import type { CSSProperties } from 'react'
import { Home } from 'lucide-react'

interface Props {
  /** Click handler. Typically `() => onClose()` to return to the StartScreen. */
  onClick: () => void
  /** Accessible label. Default: `"Back to start screen"`. */
  label?: string
  /** Tooltip text. Default matches the TopBar home button copy. */
  title?: string
  /** Inline style override — primarily used to set positioning (`position:
   *  fixed`, top/right offsets) since the primitive is unopinionated about
   *  where it docks. */
  style?: CSSProperties
}

export default function EditorHomeButton({
  onClick,
  label = 'Back to start screen',
  title = 'Back to start — close this project and return to the new-pack menu',
  style,
}: Props) {
  // The button itself is a glass pill — the parent doesn't need to wrap it.
  // Background, blur, and stroke mirror the WindowControls pill recipe so
  // the home button and the close/minimize/maximize pill read as a matched
  // pair when they sit side-by-side in the top-right corner.
  const merged = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 12,
    background: 'rgba(17, 17, 17, 0.78)',
    backgroundImage:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
    backdropFilter: 'blur(40px) saturate(150%)',
    WebkitBackdropFilter: 'blur(40px) saturate(150%)',
    border: '0.5px solid rgba(255, 255, 255, 0.08)',
    boxShadow: 'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.2)',
    color: 'var(--color-text-2)',
    cursor: 'pointer',
    padding: 0,
    transition: 'all 150ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    // Electron-specific — same pattern used across all the other interactive
    // chrome that overlaps the top drag-strip.
    WebkitAppRegion: 'no-drag',
    ...style,
  } as CSSProperties

  // Tailwind handles the hover/active deltas (background tint, text colour,
  // active scale) because CSS-in-JS inline styles can't express `:hover` /
  // `:active`. Same approach used inside `TopBar`'s in-pill home button.
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className="l01-ring hover:text-white hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      style={merged}
    >
      <Home size={16} strokeWidth={2} aria-hidden />
    </button>
  )
}
