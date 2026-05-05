import { useEffect, useState } from 'react'
import ConnectScreen from '@/components/ConnectScreen'
import Editor from '@/components/Editor'
import TitleBar from '@/components/TitleBar'
import { loadSavedHandle } from '@/lib/coh2-fs'
import { isElectron, detectInstallPath, nativePathToHandle } from '@/lib/native-fs'

/**
 * App routing: pick between the first-run "connect" flow and the editor
 * proper. We probe IndexedDB for a saved handle on mount; if found and the
 * user still grants permission, we skip straight to the editor.
 */
export default function App() {
  const [installRoot, setInstallRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [probing, setProbing] = useState(true)

  // Mark body so CSS can shift top-anchored chrome below the TitleBar pill.
  useEffect(() => {
    if (isElectron()) document.body.classList.add('is-electron')
    return () => document.body.classList.remove('is-electron')
  }, [])

  useEffect(() => {
    // In Electron: auto-detect CoH2 install; no user gesture required.
    if (isElectron()) {
      detectInstallPath().then(p => {
        if (p) setInstallRoot(nativePathToHandle(p))
        // If not found, fall through to ConnectScreen (manual pick)
      }).catch(() => {/* ignore — ConnectScreen handles manual pick */}).finally(() => setProbing(false))
      return
    }

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
      <>
        <TitleBar />
        <div className="min-h-dvh grid place-items-center">
          <div className="text-[12px] text-[var(--color-text-3)] tracking-[2px] uppercase">
            Loading…
          </div>
        </div>
      </>
    )
  }

  if (!installRoot) {
    return (
      <>
        <TitleBar />
        <ConnectScreen onConnected={setInstallRoot} />
      </>
    )
  }

  return (
    <>
      <TitleBar />
      <Editor root={installRoot} onDisconnect={() => setInstallRoot(null)} />
    </>
  )
}

