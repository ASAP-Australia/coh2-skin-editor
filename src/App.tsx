import { useEffect, useState } from 'react'
import SteamGate from '@/components/SteamGate'
import Editor from '@/components/Editor'
import TitleBar from '@/components/TitleBar'
import WipeMigrationScreen, { WIPE_DONE_KEY } from '@/components/WipeMigrationScreen'
import { isElectron } from '@/lib/native-fs'

/**
 * App routing — v1.0 Steam-first.
 *
 * Boot order:
 *   1. SteamGate authenticates against Steam, validates CoH2 ownership,
 *      and hands us the install path Steam reports.
 *   2. WipeMigrationScreen runs a one-time scan of the CoH2 mods folder
 *      for pre-v1.0 fake-Workshop-ID SGAs that fail lobby validation.
 *      Auto-skips when the folder is clean (no entries) or when the
 *      migration has already completed (localStorage flag). Trashes
 *      fake-ID files via shell.trashItem() — recoverable from system
 *      Trash if anything is misclassified.
 *   3. Editor mounts with the install handle.
 *
 * Web build: SteamGate renders a "download the desktop app" branch.
 * Headless screenshot flag (`?headless=editor`) skips the gate the
 * same way the previous ConnectScreen path did, used by automated
 * screenshot smoke tests.
 */
export default function App() {
  const [installRoot, setInstallRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [steamId, setSteamId] = useState<string | null>(null)
  const [personaName, setPersonaName] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)
  // modsPath is the auto-detected absolute path to ~/Documents/My Games/
  // Company of Heroes 2/mods. Lifted from the IPC bridge once SteamGate
  // succeeds so the WipeMigrationScreen has somewhere to scan. `null`
  // disables the screen (and short-circuits straight to the editor).
  const [modsPath, setModsPath] = useState<string | null>(null)
  // wipeChecked goes true once the user has either completed the wipe
  // (or skipped it) in this session, OR the wipe-done localStorage flag
  // was set by a previous run. Both paths route past WipeMigrationScreen.
  const [wipeChecked, setWipeChecked] = useState(false)

  // Mark body so CSS can shift top-anchored chrome below the TitleBar pill.
  useEffect(() => {
    if (isElectron()) document.body.classList.add('is-electron')
    return () => document.body.classList.remove('is-electron')
  }, [])

  useEffect(() => {
    // Prime wipeChecked from localStorage — a user who completed (or
    // skipped) the wipe in a previous session shouldn't see the screen
    // again. Wrap in try/catch in case storage is unavailable.
    try {
      if (localStorage.getItem(WIPE_DONE_KEY)) setWipeChecked(true)
    } catch {
      // Treat unavailable storage as "already wiped" — better to skip
      // the screen than block users behind it.
      setWipeChecked(true)
    }
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
            // Resolve the mods folder eagerly so WipeMigrationScreen can
            // start scanning the moment we hand off. Failure here is
            // non-fatal — `null` makes the screen short-circuit.
            if (isElectron()) {
              window.electronAPI
                ?.detectCoh2Mods()
                .then(p => setModsPath(p))
                .catch(() => setModsPath(null))
            }
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

  if (!wipeChecked) {
    return (
      <>
        <TitleBar />
        <WipeMigrationScreen
          modsPath={modsPath}
          onComplete={() => setWipeChecked(true)}
        />
      </>
    )
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
