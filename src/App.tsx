import { useEffect, useState } from 'react'
import ConnectScreen from '@/components/ConnectScreen'
import SmokeTest from '@/components/SmokeTest'
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

/** Smoke-test stage — proves the SGA + RGM pipeline end-to-end by loading
 *  the Tiger from the user's installed ArtHigh.sga and rendering it in
 *  Three.js. Replaced with the real editor surface in the next commits. */
function Editor({ root, onDisconnect }: {
  root: FileSystemDirectoryHandle
  onDisconnect: () => void
}) {
  return (
    <div className="min-h-dvh px-6 py-10 flex flex-col items-center gap-6">
      <header className="max-w-3xl w-full flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[2px] text-[var(--color-accent)] font-semibold">
            Connected — {root.name}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Company of Heroes 2 — community skin editor
          </h1>
        </div>
        <button
          onClick={onDisconnect}
          className="text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] underline"
        >
          Disconnect
        </button>
      </header>
      <SmokeTest root={root} />
    </div>
  )
}
