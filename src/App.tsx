import { useEffect, useState } from 'react'
import ConnectScreen from '@/components/ConnectScreen'
import { loadSavedHandle } from '@/lib/coh2-fs'

/**
 * App routing: pick between the first-run "connect" flow and the editor
 * proper. We probe IndexedDB for a saved handle on mount; if found and the
 * user still grants permission, we skip straight to the editor.
 */
export default function App() {
  const [installRoot, setInstallRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [probing, setProbing] = useState(true)

  useEffect(() => {
    loadSavedHandle()
      .then(h => { if (h) setInstallRoot(h) })
      .catch(() => {})
      .finally(() => setProbing(false))
  }, [])

  if (probing) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <div className="text-[12px] text-[var(--color-text-3)] tracking-[2px] uppercase">
          Loading…
        </div>
      </div>
    )
  }

  if (!installRoot) {
    return <ConnectScreen onConnected={setInstallRoot} />
  }

  return <Editor root={installRoot} onDisconnect={() => setInstallRoot(null)} />
}

/** Stub — the real editor surface (viewport, decal tray, faction nav, etc.)
 *  drops in here as separate components in subsequent commits. For now we
 *  just confirm the install is connected and show what we found. */
function Editor({ root, onDisconnect }: {
  root: FileSystemDirectoryHandle
  onDisconnect: () => void
}) {
  return (
    <div className="min-h-dvh grid place-items-center px-6">
      <div className="max-w-md w-full glass-2 rounded-[var(--radius-panel)] p-8 shadow-[var(--shadow-glass)]">
        <div className="text-[10px] uppercase tracking-[2px] text-[var(--color-accent)] font-semibold mb-2">
          Connected
        </div>
        <h1 className="text-xl font-semibold tracking-tight mb-3">
          {root.name}
        </h1>
        <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mb-4">
          Your CoH2 install is connected. Mesh + texture loading pipeline is
          being wired in — once the SGA reader and RGM loader land, this
          screen becomes the actual viewport with decal placement.
        </p>
        <button
          onClick={onDisconnect}
          className="text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] underline"
        >
          Disconnect / pick a different folder
        </button>
      </div>
    </div>
  )
}
