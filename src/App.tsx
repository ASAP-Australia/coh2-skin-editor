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
    // ?demo=1 bypasses the Connect *screen* — but if the user has previously
    // authorized their CoH2 install, we still load real models from it. Only
    // when no saved handle is available does demo mode fall back to a stub
    // (which triggers the placeholder tank + procedural skybox in Viewport).
    const params = new URLSearchParams(location.search)
    const demo = params.get('demo') === '1'

    loadSavedHandle()
      .then(h => {
        if (h) { setInstallRoot(h); return }
        if (demo) {
          // No saved install — give the editor a stub so it can mount, and
          // the viewport will render the procedural demo scene.
          const stub = {
            name: 'Demo (no real install)',
            kind: 'directory' as const,
            getDirectoryHandle: async () => { throw new Error('demo mode — no real FS') },
            getFileHandle:      async () => { throw new Error('demo mode — no real FS') },
            entries:            async function*() {},
          }
          setInstallRoot(stub as unknown as FileSystemDirectoryHandle)
        }
      })
      .catch(() => {
        if (demo) {
          const stub = {
            name: 'Demo (no real install)',
            kind: 'directory' as const,
            getDirectoryHandle: async () => { throw new Error('demo mode — no real FS') },
            getFileHandle:      async () => { throw new Error('demo mode — no real FS') },
            entries:            async function*() {},
          }
          setInstallRoot(stub as unknown as FileSystemDirectoryHandle)
        }
      })
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

