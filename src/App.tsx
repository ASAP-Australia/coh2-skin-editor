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
    // ?demo=1 bypasses Connect with a no-op stub handle. Useful for
    // visual testing the editor surfaces in headless preview where the
    // real FS Access API is gated by user gesture. The Viewport will
    // fail to load any vehicle (no archives accessible) and just show
    // its loading state — that's fine for verifying menus.
    const params = new URLSearchParams(location.search)
    if (params.get('demo') === '1') {
      const stub = {
        name: 'Demo (no real install)',
        kind: 'directory' as const,
        getDirectoryHandle: async () => { throw new Error('demo mode — no real FS') },
        getFileHandle:      async () => { throw new Error('demo mode — no real FS') },
        entries:            async function*() {},
      }
      setInstallRoot(stub as unknown as FileSystemDirectoryHandle)
      setProbing(false)
      return
    }
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

