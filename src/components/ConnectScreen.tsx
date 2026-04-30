import { useEffect, useState } from 'react'
import { isSupported, pickInstall } from '@/lib/coh2-fs'
import { defaultInstallPath, detectOS, osLabel } from '@/lib/ux'

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
  const os = detectOS()
  const expectedPath = defaultInstallPath(os)

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

        <button
          disabled={!supported || busy}
          onClick={connect}
          style={{ background: 'oklch(0.66 0.180 45)' }}
          className="w-full rounded-xl text-black font-semibold h-11 text-[14px]
                     hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Waiting for permission…' : 'Connect CoH2 install'}
        </button>

        <div className="mt-4 px-3 py-2.5 rounded-lg bg-black/30 border border-white/5">
          <div className="text-[10px] uppercase tracking-[1.5px] text-[var(--color-text-3)] font-medium mb-1.5">
            On {osLabel(os)}, look here
          </div>
          <code className="text-[10px] text-[var(--color-text-2)] block break-all leading-relaxed">
            {expectedPath}
          </code>
        </div>

        <details className="mt-3 text-[11px] text-[var(--color-text-3)]">
          <summary className="cursor-pointer hover:text-[var(--color-text-2)] select-none">
            Other operating systems
          </summary>
          <ul className="mt-2 space-y-1.5">
            {(['win', 'linux', 'mac'] as const).filter(o => o !== os).map(o => (
              <li key={o}>
                <span className="text-[var(--color-text-2)]">{osLabel(o)}:</span>{' '}
                <code className="text-[10px] bg-black/30 rounded px-1 py-0.5 break-all">
                  {defaultInstallPath(o)}
                </code>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  )
}
