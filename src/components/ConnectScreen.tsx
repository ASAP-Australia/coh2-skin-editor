import { useEffect, useState } from 'react'
import { isSupported, locateArchives, pickInstall } from '@/lib/coh2-fs'
import { BorderBeam } from '@/components/ui/border-beam'
import { isElectron, detectInstallPath, pickInstallPathNative, nativePathToHandle, initSteamNative } from '@/lib/native-fs'
import type { SteamInitInfo } from '@/lib/native-fs'

interface Props {
  onConnected: (handle: FileSystemDirectoryHandle, steamInfo?: SteamInitInfo) => void
  /** When true, the screen plays its exit animation (caller-controlled
   *  transition flag). Does not affect internal behaviour. */
  exiting?: boolean
}

/**
 * First-run screen — single "Connect CoH2" button.
 *
 * In Electron we auto-detect the Steam install path for the host OS and
 * connect with one click. If auto-detect fails the same button falls
 * back to the native folder picker. In a browser (no Electron) we use
 * the File System Access API picker instead.
 *
 * Renders ONLY the inner content (heading + bullets + button). The
 * outer chrome — ASAP wordmark, "CoH2 · Community Modding Tool" eyebrow,
 * dark glass card, ambient halo, drop shadow — is owned by AuthShell.
 * Earlier revisions of this file shipped their own outer card with a
 * duplicate ASAP logo + product eyebrow + "CoH2 · Community Skin
 * Editor" sub-heading, which read as two stacked cards under the
 * AuthShell brand mark on first run.
 */
type Phase = 'idle' | 'picking' | 'scanning' | 'linking-steam' | 'success' | 'error'

export default function ConnectScreen({ onConnected }: Props) {
  const [supported] = useState(() => isSupported() || isElectron())
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [steamWarning, setSteamWarning] = useState<string | null>(null)
  const [steamInfo, setSteamInfo] = useState<SteamInitInfo | null>(null)
  const [detectedPath, setDetectedPath] = useState<string | null>(null)
  const busy = phase === 'picking' || phase === 'scanning' || phase === 'linking-steam' || phase === 'success'

  // In Electron: probe the OS for a default Steam path so we can show
  // it on the button (e.g. "Connect CoH2 install (auto-detected)") and
  // skip the picker entirely.
  useEffect(() => {
    if (isElectron()) {
      detectInstallPath().then(p => setDetectedPath(p)).catch(() => {/* ignore */})
    }
  }, [])

  const connect = async () => {
    setError(null); setSteamWarning(null); setPhase('picking')
    try {
      let handle: FileSystemDirectoryHandle | null | undefined

      if (isElectron()) {
        // Try auto-detect first
        let nativePath = detectedPath ?? await detectInstallPath()
        if (!nativePath) {
          // Fall back to manual picker
          nativePath = await pickInstallPathNative()
          if (!nativePath) { setPhase('idle'); return }
        }
        handle = nativePathToHandle(nativePath)
      } else {
        handle = await pickInstall()
        if (!handle) { setPhase('idle'); return }
      }

      // Validate: archives folder must exist under the picked root.
      setPhase('scanning')
      const t0 = Date.now()
      const archives = await locateArchives(handle)
      const elapsed = Date.now() - t0
      if (elapsed < 350) await new Promise(r => setTimeout(r, 350 - elapsed))
      if (!archives) {
        setError("That folder doesn't look like a Company of Heroes 2 install — couldn't find CoH2/Archives.")
        setPhase('error')
        return
      }

      // Initialise Steam identity — soft failure only.
      // We don't block the editor if Steam isn't running; the user can still
      // edit skins locally. Publishing to Workshop will be unavailable.
      let resolvedSteamInfo: SteamInitInfo | undefined
      if (isElectron()) {
        setPhase('linking-steam')
        try {
          const result = await initSteamNative()
          if (result?.ok) {
            resolvedSteamInfo = result.info
            setSteamInfo(result.info)
          } else if (result && !result.ok) {
            const msg =
              result.error.code === 'no-steam'
                ? 'Steam not detected — you can still edit, but Workshop publishing is disabled.'
                : result.error.code === 'no-game'
                  ? 'CoH2 not found on your Steam account — publishing to Workshop is disabled.'
                  : 'Steam init failed — Workshop publishing is disabled.'
            setSteamWarning(msg)
          }
        } catch {
          setSteamWarning('Steam not detected — you can still edit, but Workshop publishing is disabled.')
        }
        await new Promise(r => setTimeout(r, 250))
      }

      setPhase('success')
      await new Promise(r => setTimeout(r, 1400))
      onConnected(handle, resolvedSteamInfo)
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string }
      if (e?.name === 'AbortError') {
        setPhase('idle')
      } else {
        setError(e?.message ?? String(err))
        setPhase('error')
      }
    }
  }

  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-tight text-white leading-[1.15] mb-4">
        Connect your CoH2 install
      </h1>

      <ul className="mb-5 space-y-1.5 text-[13px] text-[var(--color-text-2)] leading-snug">
        {[
          'Reads vehicle meshes & base textures locally',
          'Nothing uploaded — files stay on your machine',
          detectedPath ? 'Steam install detected automatically' : 'Pick your Company of Heroes 2 folder',
          ...(steamInfo ? [`Signed in to Steam as ${steamInfo.personaName}`] : []),
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span aria-hidden className="mt-[6px] size-1 rounded-full shrink-0"
              style={{ background: 'oklch(0.85 0.10 220)' }} />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {steamWarning && (
        <div className="mb-5 px-3.5 py-2.5 rounded-2xl border border-yellow-400/25 bg-yellow-500/[0.06] text-[12px] text-yellow-200/90 leading-relaxed">
          {steamWarning}
        </div>
      )}

      {!supported && (
        <div className="mb-5 px-3.5 py-2.5 rounded-2xl border border-red-400/25 bg-red-500/[0.06] text-[12px] text-red-200/90 leading-relaxed">
          <b>Browser not supported.</b> This app uses the File System
          Access API — please open it in Chrome, Edge, Brave or Opera,
          or use the desktop app.
        </div>
      )}

      {error && (
        <div className="mb-5 px-3.5 py-2.5 rounded-2xl border border-red-400/25 bg-red-500/[0.06] text-[12px] text-red-200/90 leading-relaxed whitespace-pre-line">
          {error}
        </div>
      )}

      {/* Single primary action — auto-detects when in Electron, else
          opens the FS picker. Button morphs its content per phase:
          idle → label, picking → spinner, scanning → spinner + text,
          success → inline green tick + "Connected". */}
      <BorderBeam colorVariant="ocean" duration={5} strength={0.85} borderRadius={16} borderWidth={1} className="bb-pressable">
        <button
          disabled={!supported || busy}
          onClick={connect}
          className="bb-connect relative w-full text-white font-semibold h-12 text-[14px] tracking-tight
                     disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/[0.10]"
          style={{
            borderRadius: 16,
            cursor: busy ? 'progress' : 'pointer',
            background: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            boxShadow: '0 1px 0 rgb(255 255 255 / 0.14) inset',
          }}
        >
          {phase === 'picking' ? (
            <span className="inline-flex items-center justify-center">
              <InlineSpinner />
            </span>
          ) : phase === 'scanning' ? (
            <span className="inline-flex items-center justify-center">
              <InlineSpinner />
            </span>
          ) : phase === 'linking-steam' ? (
            <span className="inline-flex items-center justify-center gap-2 text-[13px]">
              <InlineSpinner />
              <span>Connecting Steam…</span>
            </span>
          ) : phase === 'success' ? (
            <span className="inline-flex items-center justify-center">
              <InlineSuccessTick />
            </span>
          ) : (
            <span>Connect CoH2 install</span>
          )}
        </button>
      </BorderBeam>

      <style>{`
        .bb-pressable {
          transition: transform 240ms cubic-bezier(.4, 1.6, .5, 1);
          will-change: transform;
          transform-origin: center;
          display: block;
        }
        .bb-pressable:has(button:not(:disabled):active) {
          transform: scale(0.95);
          transition: transform 90ms cubic-bezier(.3, 0, .7, 1);
        }
        .bb-connect {
          transition: background-color 160ms ease-out;
        }
        @keyframes bb-spinner-rotate {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

/** Inline button-size spinner — 18 px conic-gradient half-arc rotating once
 *  per 0.9 s. Apple's loading-circle idiom. */
function InlineSpinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 18, height: 18, display: 'inline-block', flex: 'none',
        borderRadius: '50%',
        background:
          'conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.30) 30%, rgba(255,255,255,0.95) 100%)',
        WebkitMask:
          'radial-gradient(circle, transparent 6px, #000 6.5px)',
        mask:
          'radial-gradient(circle, transparent 6px, #000 6.5px)',
        animation: 'bb-spinner-rotate 0.9s linear infinite',
      }}
    />
  )
}

/** Inline-sized (18 px) green tick for use inside the connect button. */
function InlineSuccessTick() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="11" fill="oklch(0.78 0.18 150)" />
      <path d="M7 12.5 L10.5 16 L17 9"
            stroke="#0b1410" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}
