import { useEffect, useState } from 'react'
import SteamGate from '@/components/SteamGate'
import Editor from '@/components/Editor'
import TitleBar from '@/components/TitleBar'
import { isElectron } from '@/lib/native-fs'

/**
 * App routing — v1.0 Steam-first.
 *
 * Boot order:
 *   1. SteamGate authenticates the user against Steam, validates CoH2
 *      ownership, and hands us the install path Steam reports.
 *   2. We mount the Editor with that handle. No second picker, no
 *      saved-handle dance — Steam is the single source of truth.
 *
 * Web build: the gate renders a "download the desktop app" branch.
 * Headless screenshot flag (`?headless=editor`) skips the gate the
 * same way the previous ConnectScreen path did, used by automated
 * screenshot smoke tests.
 */
export default function App() {
  const [installRoot, setInstallRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [steamId, setSteamId] = useState<string | null>(null)
  const [personaName, setPersonaName] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)

  // Mark body so CSS can shift top-anchored chrome below the TitleBar pill.
  useEffect(() => {
    if (isElectron()) document.body.classList.add('is-electron')
    return () => document.body.classList.remove('is-electron')
  }, [])

  useEffect(() => {
    // ?screenshot=1 forces the gate (no WebGL viewport) for headless captures.
    // ?headless=editor lets the screenshot harness skip the gate and land in
    // the editor directly. Used by HEADLESS_SCREENSHOT runs.
    const sParams = new URLSearchParams(location.search)
    if (sParams.get('screenshot') === '1') {
      setProbing(false)
      return
    }
    if (sParams.get('headless') === 'editor' && isElectron()) {
      import('@/lib/native-fs')
        .then(async ({ detectInstallPath, nativePathToHandle }) => {
          const p = await detectInstallPath()
          if (p) setInstallRoot(nativePathToHandle(p))
        })
        .finally(() => setProbing(false))
      return
    }
    setProbing(false)
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
        <SteamGate
          onAuthed={({ handle, steamId, personaName }) => {
            setSteamId(steamId)
            setPersonaName(personaName)
            setInstallRoot(handle)
          }}
        />
      </>
    )
  }

  // Persist the Steam identity onto the window so any deeply nested
  // publish-flow component can read it without piping it through every
  // Editor sub-tree prop. This is a v1.0 carve-out — see the v1.1 todo
  // to thread it through a proper context once the publish dialog lands.
  if (typeof window !== 'undefined') {
    ;(window as { __steam?: { id: string; name: string } }).__steam =
      steamId && personaName ? { id: steamId, name: personaName } : undefined
  }

  return (
    <>
      <TitleBar />
      <Editor
        root={installRoot}
        onDisconnect={() => {
          setInstallRoot(null)
          setSteamId(null)
          setPersonaName(null)
        }}
      />
    </>
  )
}
