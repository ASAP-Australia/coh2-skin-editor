import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { isSupported, pickInstall } from '@/lib/coh2-fs'

interface Props {
  onConnected: (handle: FileSystemDirectoryHandle) => void
}

/** First-run screen. Asks the user to point us at their CoH2 install once.
 *  After that, the page remembers the directory handle in IndexedDB and
 *  scans automatically on subsequent visits. */
export default function ConnectScreen({ onConnected }: Props) {
  const [supported, setSupported] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setSupported(isSupported()) }, [])

  const connect = async () => {
    setError(null); setBusy(true)
    try {
      const handle = await pickInstall()
      if (handle) onConnected(handle)
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // User cancelled — silent
      } else {
        setError(err?.message ?? String(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center px-6">
      <div className="max-w-md w-full glass-2 rounded-[var(--radius-panel)] p-8 shadow-[var(--shadow-glass)]">
        <div className="size-12 rounded-2xl bg-[var(--color-accent)] grid place-items-center text-black text-xl font-bold mb-6">
          C
        </div>
        <div className="text-[10px] uppercase tracking-[2px] text-[var(--color-accent)] font-semibold mb-2">
          Company of Heroes 2 — community skin editor
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-3">
          Connect your CoH2 install to continue
        </h1>
        <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mb-6">
          This editor reads vehicle meshes and base textures directly from your
          local Company of Heroes 2 installation. Nothing is uploaded — every
          file stays on your machine. You'll grant access once; the browser
          remembers it for next time.
        </p>

        {!supported && (
          <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-950/20 text-[12px] text-red-300">
            <b>Browser not supported.</b> This app needs the File System Access
            API. Please use the latest <b>Chrome</b>, <b>Edge</b>, <b>Brave</b>,
            or <b>Opera</b>. Firefox and Safari can't run it.
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-950/20 text-[12px] text-red-300">
            {error}
          </div>
        )}

        <Button
          disabled={!supported || busy}
          onClick={connect}
          className="w-full rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-black font-semibold h-11"
        >
          {busy ? 'Waiting for permission…' : 'Connect CoH2 install'}
        </Button>

        <details className="mt-6 text-[12px] text-[var(--color-text-3)]">
          <summary className="cursor-pointer hover:text-[var(--color-text-2)] select-none">
            Where is my CoH2 install folder?
          </summary>
          <div className="mt-3 leading-relaxed">
            <p>The most reliable choice: the Steam app folder for CoH2.</p>
            <ul className="mt-2 space-y-1">
              <li>
                <span className="text-[var(--color-text-2)]">Windows:</span>{' '}
                <code className="text-[10px] bg-black/30 rounded px-1 py-0.5">
                  …\Steam\steamapps\common\Company of Heroes 2\
                </code>
              </li>
              <li>
                <span className="text-[var(--color-text-2)]">Linux/Steam Deck:</span>{' '}
                <code className="text-[10px] bg-black/30 rounded px-1 py-0.5">
                  …/Steam/steamapps/common/Company of Heroes 2/
                </code>
              </li>
              <li>
                <span className="text-[var(--color-text-2)]">Mac (Proton/Wine):</span>{' '}
                <code className="text-[10px] bg-black/30 rounded px-1 py-0.5">
                  …/SteamLibrary/steamapps/common/Company of Heroes 2/
                </code>
              </li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  )
}
