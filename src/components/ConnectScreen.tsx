import { useEffect, useState } from 'react'
import { isSupported, locateArchives, pickInstall } from '@/lib/coh2-fs'
import { BorderBeam } from '@/components/ui/border-beam'
import { AnimatedSwap } from '@/components/ui/animated-swap'
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
type Phase = 'idle' | 'picking' | 'scanning' | 'linking-steam' | 'success' | 'warning'

export default function ConnectScreen({ onConnected }: Props) {
  const [supported] = useState(() => isSupported() || isElectron())
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [steamWarning, setSteamWarning] = useState<string | null>(null)
  const [detectedPath, setDetectedPath] = useState<string | null>(null)
  // Snapshot of detectedPath at the moment the user clicks connect — frozen so
  // async detection can't mutate bullet #3 text mid-click. Kept in state (not
  // a ref) so it's safe to read during render.
  const [bulletThreeSnapshot, setBulletThreeSnapshot] = useState<string | null>(null)
  // 'warning' is intentionally NOT busy — the user can click again immediately.
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
    // Freeze bullet #3 text before any async work begins.
    setBulletThreeSnapshot(detectedPath)
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
        setPhase('warning')
        await new Promise(r => setTimeout(r, 1500))
        setPhase('idle')
        return
      }

      // Initialise Steam identity — HARD requirement.
      // If Steam isn't running or CoH2 isn't owned, block and show an inline
      // message beneath the button. The user must launch Steam and retry.
      let resolvedSteamInfo: SteamInitInfo | undefined
      if (isElectron()) {
        setPhase('linking-steam')
        try {
          const result = await initSteamNative()
          if (result?.ok) {
            resolvedSteamInfo = result.info
          } else if (result && !result.ok) {
            const msg =
              result.error.code === 'no-steam'
                ? "Steam isn't running. Launch Steam, then click Connect again."
                : result.error.code === 'no-game'
                  ? "CoH2 isn't found on your Steam account. Make sure you own the game, then click Connect again."
                  : "Steam init failed. Make sure Steam is running, then click Connect again."
            setSteamWarning(msg)
            setPhase('warning')
            await new Promise(r => setTimeout(r, 1500))
            setPhase('idle')
            return
          }
        } catch {
          setSteamWarning("Steam isn't running. Launch Steam, then click Connect again.")
          setPhase('warning')
          await new Promise(r => setTimeout(r, 1500))
          setPhase('idle')
          return
        }

        // resolvedSteamInfo must be set to proceed
        if (!resolvedSteamInfo) {
          setSteamWarning("Steam isn't running. Launch Steam, then click Connect again.")
          setPhase('warning')
          await new Promise(r => setTimeout(r, 1500))
          setPhase('idle')
          return
        }
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
        setPhase('warning')
        await new Promise(r => setTimeout(r, 1500))
        setPhase('idle')
      }
    }
  }

  return (
    <div>
      {/* h2 because AuthShell provides the sr-only h1 product heading;
          reduced to text-[20px] font-medium per heading hierarchy audit. */}
      <h2 className="text-[20px] font-medium tracking-tight text-white leading-[1.15] mb-4">
        Connect your CoH2 install
      </h2>

      <ul className="mb-5 space-y-1.5 text-[13px] text-[var(--color-text-2)] leading-snug">
        {[
          'Reads vehicle meshes & base textures locally',
          'Nothing uploaded — files stay on your machine',
          // Use the state snapshot once a click is in progress so async
          // detection cannot swap this text mid-transition.
          (phase === 'idle' ? detectedPath : bulletThreeSnapshot)
            ? 'Steam install detected automatically'
            : 'Pick your Company of Heroes 2 folder',
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span aria-hidden className="mt-[6px] size-1 rounded-full shrink-0"
              style={{ background: 'oklch(0.85 0.10 220)' }} />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {/* Steam requirement note — inline small, amber tone, beneath bullet list.
          Visible until user clicks Connect again (cleared at top of connect()). */}
      <AnimatedSwap swapKey={steamWarning ? 'shown' : 'hidden'} block>
        {steamWarning ? (
          <p className="mb-4 text-[12px] leading-relaxed"
             style={{ color: 'oklch(0.85 0.12 75)' }}>
            {steamWarning}
          </p>
        ) : null}
      </AnimatedSwap>

      {!supported && (
        <div className="mb-5 px-3.5 py-2.5 rounded-2xl border border-red-400/25 bg-red-500/[0.06] text-[12px] text-red-200/90 leading-relaxed">
          <b>Browser not supported.</b> This app uses the File System
          Access API — please open it in Chrome, Edge, Brave or Opera,
          or use the desktop app.
        </div>
      )}

      {/* Error banner — animates in when an error appears, out when cleared. */}
      <AnimatedSwap swapKey={error ? `err-${error}` : 'no-error'} block>
        {error ? (
          <div className="mb-5 px-3.5 py-2.5 rounded-2xl border border-red-400/25 bg-red-500/[0.06] text-[12px] text-red-200/90 leading-relaxed whitespace-pre-line">
            {error}
          </div>
        ) : null}
      </AnimatedSwap>

      {/* Single primary action — auto-detects when in Electron, else
          opens the FS picker. Button morphs its content per phase:
          idle → label, picking/scanning/linking-steam → spinner only (no text),
          success → inline green tick, warning → inline yellow warning icon. */}
      <BorderBeam colorVariant="ocean" duration={5} strength={0.85} borderRadius={16} borderWidth={1} className="bb-pressable">
        <button
          disabled={!supported || busy}
          onClick={connect}
          className="bb-connect relative w-full text-white font-semibold h-12 text-[14px] tracking-tight
                     disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/[0.10]
                     focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 focus-visible:outline-none"
          style={{
            borderRadius: 16,
            cursor: busy ? 'progress' : 'pointer',
            background: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            boxShadow: '0 1px 0 rgb(255 255 255 / 0.14) inset',
          }}
        >
          {/* AnimatedSwap drives the downward-cascade transition between
              button states. picking/scanning/linking-steam all share the same
              key 'spinning' so they don't animate between each other (all show
              the plain spinner and the visual difference would be imperceptible). */}
          <AnimatedSwap
            swapKey={
              phase === 'picking' || phase === 'scanning' || phase === 'linking-steam'
                ? 'spinning'
                : phase
            }
          >
            {phase === 'picking' || phase === 'scanning' || phase === 'linking-steam' ? (
              <span className="inline-flex items-center justify-center" style={{ minWidth: 180 }}>
                <InlineSpinner />
              </span>
            ) : phase === 'success' ? (
              <span className="inline-flex items-center justify-center" style={{ minWidth: 180 }}>
                <InlineSuccessTick />
              </span>
            ) : phase === 'warning' ? (
              <span className="inline-flex items-center justify-center" style={{ minWidth: 180 }}>
                <InlineWarningIcon />
              </span>
            ) : (
              <span style={{ minWidth: 180, display: 'inline-flex', justifyContent: 'center' }}>Connect CoH2 install</span>
            )}
          </AnimatedSwap>
        </button>
      </BorderBeam>

      {/* bb-pressable / bb-cta / @keyframes bb-spinner-rotate are defined
          globally in index.css. bb-connect keeps its own transition here. */}
      <style>{`
        .bb-connect {
          transition: background-color 160ms ease-out;
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

/** Inline-sized (18 px) amber warning triangle for use inside the connect button.
 *  Shown during the 'warning' phase (1500 ms hold) when any error path fires. */
function InlineWarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden style={{ flex: 'none' }}>
      {/* Filled amber triangle */}
      <path d="M12 2.5 L22 20.5 H2 Z" fill="oklch(0.85 0.18 85)" />
      {/* Exclamation stem */}
      <rect x="11" y="9" width="2" height="6" rx="1" fill="#2a1a00" />
      {/* Exclamation dot */}
      <rect x="11" y="16.5" width="2" height="2" rx="1" fill="#2a1a00" />
    </svg>
  )
}
