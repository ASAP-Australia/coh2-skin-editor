/**
 * WindowControls — Floating window close/minimize/maximize buttons for Electron.
 *
 * Positioned in top-right corner as a small glass pill. Only renders in Electron.
 */

import { useEffect, useState } from 'react'
import { isElectron } from '@/lib/native-fs'

export default function WindowControls() {
  const inElectron = isElectron()
  const [maximized, setMaximized] = useState(false)
  // Web fallback uses the Fullscreen API for maximize. We track that state
  // so the glyph swaps between Maximize → Restore correctly in both runtimes.
  const [fullscreen, setFullscreen] = useState(false)

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
    return () => {
      cancelled = true
    }
  }, [inElectron])

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Previously gated on Electron only — the user asked for window-style
  // controls in the top-right regardless of runtime, so we render in both
  // and map each glyph to the cheapest reasonable web equivalent:
  //   • minimize: no-op on web (the button hides itself in web mode)
  //   • maximize: toggles document fullscreen
  //   • close:    calls window.close() — fails silently on tabs the page
  //               didn't open (browser policy), which is acceptable.

  const minimize = () => window.electronAPI?.windowMinimize()
  const maximize = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await document.documentElement.requestFullscreen()
    }
    setMaximized(m => !m)
  }
  const close = () => {
    if (inElectron) {
      window.electronAPI?.windowClose()
    } else {
      // Best-effort — may be blocked by the browser if the page wasn't opened
      // by a script. There's no userful fallback so we just attempt it.
      window.close()
    }
  }
  const showMaxRestore = inElectron ? maximized : fullscreen

  return (
    <>
      {/* HOI4-style top grab strip — Electron-only. On the web there's no
          window to drag, and the strip would silently block clicks on
          anything that overlaps it in the top 40 px (TopBar slot icon!),
          so we skip rendering it entirely off-Electron. */}
      {inElectron && (
        <div
          aria-hidden
          className="fixed top-0 left-0 right-0 h-10 z-[1]"
          style={
            {
              WebkitAppRegion: 'drag',
              background: 'transparent',
            } as React.CSSProperties
          }
        />
      )}
      <div
        className="fixed top-3 right-3 flex items-center gap-0 z-[9999]"
        style={
          {
            WebkitAppRegion: 'no-drag',
            background: 'rgba(15, 17, 22, 0.75)',
            backgroundImage:
              'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
            backdropFilter: 'blur(40px) saturate(150%)',
            WebkitBackdropFilter: 'blur(40px) saturate(150%)',
            border: '0.5px solid rgba(255, 255, 255, 0.08)',
            boxShadow:
              'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.2)',
            borderRadius: '8px',
            // Parent's 8px corners must clip the children's hover backgrounds —
            // without this, hovering the leftmost / rightmost button fills its
            // rectangular bounds and the colour bleeds past the rounded corner,
            // producing visible square edges over the glass pill.
            overflow: 'hidden',
          } as React.CSSProperties
        }
        onDoubleClick={maximize}
      >
        {/* Minimize — only meaningful in Electron. Hidden on the web. */}
        {inElectron && (
          <ChromeButton variant="default" label="Minimize" onClick={minimize}>
            <MinimizeGlyph />
          </ChromeButton>
        )}
        <ChromeButton
          variant="default"
          label={showMaxRestore ? 'Restore' : 'Maximize'}
          onClick={maximize}
        >
          {showMaxRestore ? <RestoreGlyph /> : <MaximizeGlyph />}
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
  const closeHoverBg = 'hover:bg-red-500/70'
  const closeHoverText = 'hover:text-white'
  const defaultHoverBg = 'hover:bg-white/10'
  const defaultHoverText = 'hover:text-white/80'

  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`
        grid place-items-center
        w-9 h-7
        text-[var(--color-text-2)]
        transition-all duration-150
        active:scale-[0.94]
        focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30
        ${variant === 'close' ? `${closeHoverBg} ${closeHoverText}` : `${defaultHoverBg} ${defaultHoverText}`}
      `}
      style={{ WebkitAppRegion: 'no-drag', cursor: 'pointer' } as React.CSSProperties}
    >
      {children}
    </button>
  )
}

function MinimizeGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <path d="M2.5 6 H9.5" />
    </svg>
  )
}

function MaximizeGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.2" />
    </svg>
  )
}

function RestoreGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="2" y="3.6" width="6.4" height="6.4" rx="1" />
      <path d="M4 3.6 V2.6 A 0.8 0.8 0 0 1 4.8 1.8 H10 A 0.2 0.2 0 0 1 10.2 2 V7.2 A 0.8 0.8 0 0 1 9.4 8 H8.4" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M3 3 L9 9 M9 3 L3 9" />
    </svg>
  )
}
