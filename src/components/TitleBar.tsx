/**
 * TitleBar — custom frameless-window chrome for Electron.
 *
 * Renders a draggable strip across the top of the window with three traffic-
 * light buttons (close / minimize / maximize) in the top-right corner.
 * When running in a browser the component still renders but buttons are no-ops.
 */

import { useEffect, useState } from 'react'
import { isElectron } from '@/lib/native-fs'

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const inElectron = isElectron()

  // Keep the maximized state in sync (e.g. if the user uses OS shortcuts)
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

  const minimize  = () => window.electronAPI?.windowMinimize()
  const maximize  = async () => {
    await window.electronAPI?.windowMaximize()
    setMaximized(m => !m)
  }
  const close     = () => window.electronAPI?.windowClose()

  return (
    <div
      className="fixed top-0 left-0 right-0 h-8 z-[9999] flex items-center justify-end pr-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="flex items-center gap-1.5 glass-2 rounded-pill px-2.5 py-1.5 shadow-[var(--shadow-glass)]"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Close — red */}
        <button
          onClick={close}
          title="Close"
          className="w-3 h-3 rounded-full bg-red-500/90 hover:bg-red-400 active:scale-90 transition-all focus:outline-none"
        />
        {/* Minimize — yellow */}
        <button
          onClick={minimize}
          title="Minimize"
          className="w-3 h-3 rounded-full bg-yellow-400/90 hover:bg-yellow-300 active:scale-90 transition-all focus:outline-none"
        />
        {/* Maximize / Restore — green */}
        <button
          onClick={maximize}
          title={maximized ? 'Restore' : 'Fullscreen'}
          className="w-3 h-3 rounded-full bg-green-500/90 hover:bg-green-400 active:scale-90 transition-all focus:outline-none"
        />
      </div>
    </div>
  )
}
