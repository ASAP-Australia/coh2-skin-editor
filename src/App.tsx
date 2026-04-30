import { useEffect, useState } from 'react'
import ConnectScreen from '@/components/ConnectScreen'
import Editor from '@/components/Editor'
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

