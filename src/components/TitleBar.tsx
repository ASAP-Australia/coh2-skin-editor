/**
 * TitleBar — custom frameless-window chrome for Electron.
 *
 * Distinct-from-Apple design: rectangular glass buttons with always-visible
 * icons, sized for hit-testing on Linux/Windows. Each button is its own
 * pill-rounded chip inside the parent glass strip. Hover deepens the
 * background; the close button gets a red wash. No traffic-light circles.
 *
 * Layout:
 *  • Thin (8 px) full-width drag strip at the very top — invisible drag handle.
 *  • Glass strip top-right hosting three buttons: minimize, maximize, close.
 *
 * On the web build (`isElectron() === false`) the component renders nothing.
 */

import { useEffect, useState } from 'react'
import { isElectron } from '@/lib/native-fs'

export default function TitleBar() {
  const inElectron = isElectron()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!inElectron) return
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      const m = await window.electronAPI?.isMaximized()
      setMaximized(!!m)
      setTimeout(poll, 1000)
    }
    poll()
    return () => { cancelled = true }
  }, [inElectron])

  if (!inElectron) return null

  const minimize = () => window.electronAPI?.windowMinimize()
  const maximize = async () => {
    await window.electronAPI?.windowMaximize()
    setMaximized(m => !m)
  }
  const close = () => window.electronAPI?.windowClose()

  return (
    <>
      {/* Thin draggable strip across the top — pointer-events still pass to
          the buttons because the buttons are positioned in their own layer. */}
      <div
        className="fixed top-0 left-0 right-0 h-2 z-[9998]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Glass strip with three rectangular buttons. Drag region applies to
          the strip itself (gaps between buttons), buttons opt out so clicks
          land on them. Double-click on the strip toggles maximize, like
          most desktop title bars. */}
      <div
        className="fixed top-2.5 right-3 z-[9999] flex items-center gap-0.5 rounded-xl p-0.5 shadow-[var(--shadow-glass)]"
        style={{
          WebkitAppRegion: 'drag',
          // Explicit dark backdrop instead of pure backdrop-blur so the
          // titlebar reads consistently when the 3D viewport behind it is
          // bright (e.g. Sky shader at noon).
          background: 'rgba(20, 22, 28, 0.78)',
          backdropFilter: 'blur(20px) saturate(140%)',
          WebkitBackdropFilter: 'blur(20px) saturate(140%)',
          border: '0.5px solid rgba(255, 255, 255, 0.08)',
        } as React.CSSProperties}
        onDoubleClick={maximize}
      >
        {/* Linux/Windows order: minimize, maximize, close (left → right) */}
        <ChromeButton variant="default" label="Minimize" onClick={minimize}>
          <MinimizeGlyph />
        </ChromeButton>
        <ChromeButton variant="default" label={maximized ? 'Restore' : 'Maximize'} onClick={maximize}>
          {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
        </ChromeButton>
        <ChromeButton variant="close" label="Close" onClick={close}>
          <CloseGlyph />
        </ChromeButton>
      </div>
    </>
  )
}

interface ChromeButtonProps {
  label: string
  variant: 'default' | 'close'
  onClick: () => void
  children: React.ReactNode
}

function ChromeButton({ label, variant, onClick, children }: ChromeButtonProps) {
  // Close uses a red hover wash so destruction reads at a glance, but the
  // resting state is glass-tinted not coloured — matches the rest of the chrome.
  const hover =
    variant === 'close'
      ? 'hover:bg-red-500/85 hover:text-white'
      : 'hover:bg-white/15 hover:text-white'

  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`
        grid place-items-center
        w-9 h-7 rounded-lg
        text-[var(--color-text-2)]
        transition-colors duration-150
        active:scale-[0.94]
        focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40
        ${hover}
      `}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Glyphs — flat 1.5 px stroke, currentColor. 12px so they read clearly
// against the 36×28 button.
// ---------------------------------------------------------------------------

function MinimizeGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
         strokeWidth="1.4" strokeLinecap="round">
      <path d="M2.5 6 H9.5" />
    </svg>
  )
}

function MaximizeGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
         strokeWidth="1.3">
      <rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.2" />
    </svg>
  )
}

function RestoreGlyph() {
  // Two stacked rounded rectangles — the canonical "windowed" / restore icon.
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
         strokeWidth="1.2">
      <rect x="2" y="3.6" width="6.4" height="6.4" rx="1" />
      <path d="M4 3.6 V2.6 A 0.8 0.8 0 0 1 4.8 1.8 H10 A 0.2 0.2 0 0 1 10.2 2 V7.2 A 0.8 0.8 0 0 1 9.4 8 H8.4" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 3 L9 9 M9 3 L3 9" />
    </svg>
  )
}
