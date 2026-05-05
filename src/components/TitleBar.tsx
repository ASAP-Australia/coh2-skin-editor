/**
 * TitleBar — custom frameless-window chrome for Electron.
 *
 * Two pieces:
 *  • A thin (8 px) drag strip at the very top, full-width, so the user can
 *    grab the window from anywhere across the top edge. It's invisible but
 *    catches drags via -webkit-app-region: drag.
 *  • A glass pill in the top-right with three traffic-light buttons
 *    (minimize / maximize / close — Linux/Windows order). Buttons opt out
 *    of the drag region so clicks land on them; the pill's background is
 *    draggable too so you can grab it directly.
 *
 * Hover state reveals macOS-style glyphs inside each circle (− / ⇱ / ×) so
 * the action is clear without a separate label. When running in a browser
 * (`isElectron() === false`) the component renders nothing — no stray pill
 * appears on the GitHub Pages build.
 */

import { useEffect, useState } from 'react'
import { isElectron } from '@/lib/native-fs'

export default function TitleBar() {
  const inElectron = isElectron()
  const [maximized, setMaximized] = useState(false)
  const [hovered, setHovered] = useState<'min' | 'max' | 'close' | null>(null)

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

  // Show glyphs only when the user hovers the pill — matches macOS Big Sur+
  // traffic-light behaviour. Render glyphs on every button when *any*
  // button is hovered (so the user can read all three options).
  const anyHovered = hovered !== null

  return (
    <>
      {/* Thin drag strip — full width across the top. 8 px high so it's a
          comfortable drag target without eating clicks from anything below. */}
      <div
        className="fixed top-0 left-0 right-0 h-2 z-[9998] pointer-events-auto"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Glass pill — top-right, sits flush to top so OS-style alignment
          reads cleanly. Drags via the pill bg; buttons opt out. */}
      <div
        className="fixed top-2 right-3 z-[9999] flex items-center gap-1.5 glass-2 rounded-pill px-2.5 py-1.5 shadow-[var(--shadow-glass)]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        onDoubleClick={maximize}
      >
        {/* Linux / Windows order: minimize, maximize, close (left → right) */}
        <TrafficLight
          color="yellow"
          label="Minimize"
          glyph="min"
          show={anyHovered}
          onClick={minimize}
          onHover={h => setHovered(h ? 'min' : null)}
        />
        <TrafficLight
          color="green"
          label={maximized ? 'Restore' : 'Maximize'}
          glyph={maximized ? 'restore' : 'max'}
          show={anyHovered}
          onClick={maximize}
          onHover={h => setHovered(h ? 'max' : null)}
        />
        <TrafficLight
          color="red"
          label="Close"
          glyph="close"
          show={anyHovered}
          onClick={close}
          onHover={h => setHovered(h ? 'close' : null)}
        />
      </div>
    </>
  )
}

interface TrafficLightProps {
  color: 'red' | 'yellow' | 'green'
  label: string
  glyph: 'close' | 'min' | 'max' | 'restore'
  show: boolean
  onClick: () => void
  onHover: (hovered: boolean) => void
}

function TrafficLight({ color, label, glyph, show, onClick, onHover }: TrafficLightProps) {
  const bg =
    color === 'red'    ? 'bg-red-500/95 hover:bg-red-400'
    : color === 'yellow' ? 'bg-yellow-400/95 hover:bg-yellow-300'
                         : 'bg-green-500/95 hover:bg-green-400'

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      title={label}
      aria-label={label}
      className={`relative w-3 h-3 rounded-full ${bg} active:scale-90 transition-all focus:outline-none grid place-items-center`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Glyph fades in when any button in the group is hovered. The dark
          colour mimics macOS — the glyph is the *negative* of the dot. */}
      <span
        className={`pointer-events-none transition-opacity duration-100 ${show ? 'opacity-80' : 'opacity-0'}`}
        style={{ color: 'rgba(0, 0, 0, 0.7)' }}
        aria-hidden
      >
        <Glyph kind={glyph} />
      </span>
    </button>
  )
}

function Glyph({ kind }: { kind: 'close' | 'min' | 'max' | 'restore' }) {
  const stroke = 'currentColor'
  switch (kind) {
    case 'close':
      return (
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
          <path d="M2 2 L8 8 M8 2 L2 8" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'min':
      return (
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
          <path d="M2 5 H8" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'max':
      return (
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
          <path d="M3 3 H7 V7 H3 Z" stroke={stroke} strokeWidth="1.2" />
        </svg>
      )
    case 'restore':
      return (
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
          <path d="M3 4 H7 V8 H3 Z M5 4 V2 H9 V6 H7" stroke={stroke} strokeWidth="1" />
        </svg>
      )
  }
}
