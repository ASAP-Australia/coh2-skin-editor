import { useEffect, useState } from 'react'
import { isSupported, locateArchives, pickInstall } from '@/lib/coh2-fs'
import { BorderBeam } from '@/components/ui/border-beam'
import { isElectron, detectInstallPath, pickInstallPathNative, nativePathToHandle } from '@/lib/native-fs'

interface Props {
  onConnected: (handle: FileSystemDirectoryHandle) => void
}

/**
 * First-run screen — single "Connect CoH2" button.
 *
 * In Electron we auto-detect the Steam install path for the host OS and
 * connect with one click. If auto-detect fails the same button falls
 * back to the native folder picker. In a browser (no Electron) we use
 * the File System Access API picker instead.
 *
 * Apple-style dark glass card, BorderBeam ocean accent on the action,
 * spring-bounce press, no per-OS helpers, no path hints, no instructions
 * sheet. The button does the right thing automatically.
 */
type Phase = 'idle' | 'picking' | 'scanning' | 'success' | 'error'

export default function ConnectScreen({ onConnected }: Props) {
  const [supported, setSupported] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [detectedPath, setDetectedPath] = useState<string | null>(null)
  const busy = phase === 'picking' || phase === 'scanning' || phase === 'success'

  // In Electron: probe the OS for a default Steam path so we can show
  // it on the button (e.g. "Connect CoH2 install (auto-detected)") and
  // skip the picker entirely.
  useEffect(() => {
    setSupported(isSupported() || isElectron())
    if (isElectron()) {
      detectInstallPath().then(p => setDetectedPath(p)).catch(() => {/* ignore */})
    }
  }, [])

  const connect = async () => {
    setError(null); setPhase('picking')
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
      const archives = await locateArchives(handle)
      if (!archives) {
        setError("That folder doesn't look like a Company of Heroes 2 install — couldn't find CoH2/Archives.")
        setPhase('error')
        return
      }
      setPhase('success')
      await new Promise(r => setTimeout(r, 600))
      onConnected(handle)
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setPhase('idle')
      } else {
        setError(err?.message ?? String(err))
        setPhase('error')
      }
    }
  }

  const buttonLabel =
    phase === 'picking'  ? <InlineSpinner /> :
    phase === 'scanning' ? 'Scanning archives…' :
    phase === 'success'  ? 'Connected' :
    detectedPath         ? 'Connect (auto-detected)' :
                           'Connect CoH2 install'

  return (
    <div className="min-h-dvh grid place-items-center px-6">
      {/* glass-3 already supplies border + inset highlight + radius. Adding
          the outer drop shadow on top of that gave a doubled-up "stamped"
          ring. Now we let the utility handle the surface and add ONE soft
          ambient drop shadow. */}
      <div
        className="relative max-w-md w-full glass-3 p-10 overflow-hidden"
        style={{
          borderRadius: 28,
          boxShadow: '0 30px 80px -24px rgb(0 0 0 / 0.55)',
        }}
      >
        {/* Aussie-blue ambient halo */}
        <div
          aria-hidden
          className="absolute -top-20 -left-16 w-56 h-56 rounded-full pointer-events-none opacity-50 blur-3xl"
          style={{ background: 'rgba(1, 33, 105, 0.55)' }}
        />

        <div className="relative">
          {/* Brand mark */}
          <a
            href="https://github.com/ASAP-Australia"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="ASAP Australia on GitHub"
            className="inline-block mb-7 transition hover:scale-[1.03] active:scale-[0.98]"
            style={{
              filter:
                'drop-shadow(0 0 14px rgba(1, 33, 105, 0.55)) ' +
                'drop-shadow(0 6px 18px rgba(1, 33, 105, 0.35))',
            }}
          >
            <img
              src={`${(import.meta as any).env?.BASE_URL ?? '/'}asap-logo.png`}
              alt="ASAP Australia"
              width={56}
              height={56}
              className="block rounded-2xl"
              draggable={false}
            />
          </a>

          <div className="text-[10px] uppercase tracking-[2.5px] font-semibold mb-3"
               style={{ color: 'oklch(0.86 0.05 220)' }}>
            CoH2 · Community Skin Editor
          </div>

          <h1 className="text-[26px] font-semibold tracking-tight text-white leading-[1.15] mb-4">
            {phase === 'scanning' ? 'Loading vehicle models…'
              : phase === 'success' ? 'Installation found'
              : 'Connect your CoH2 install'}
          </h1>

          {phase === 'scanning' || phase === 'success' ? (
            <div className="py-6 flex flex-col items-center text-center gap-3">
              {phase === 'scanning' ? <BigSpinner /> : <SuccessTick />}
              <div className="text-[13px] text-[var(--color-text-2)] leading-relaxed max-w-[260px]">
                {phase === 'scanning'
                  ? 'Indexing your installation and pre-loading vehicle archives — usually a couple of seconds.'
                  : 'Found CoH2 archives. Loading the editor…'}
              </div>
            </div>
          ) : (
            <>
              <ul className="mb-5 space-y-1.5 text-[13px] text-[var(--color-text-2)] leading-snug">
                {[
                  'Reads vehicle meshes & base textures locally',
                  'Nothing uploaded — files stay on your machine',
                  detectedPath ? 'Steam install detected automatically' : 'Pick your Company of Heroes 2 folder',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span aria-hidden className="mt-[6px] size-1 rounded-full shrink-0"
                      style={{ background: 'oklch(0.85 0.10 220)' }} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

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
                  opens the FS picker. No per-OS instructions UI. */}
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
                    // Single subtle inset top-edge highlight only. The
                    // BorderBeam parent already paints the perimeter glow,
                    // so a second inset border-line + outer halo (previous
                    // version) read as a doubled drop shadow.
                    boxShadow: '0 1px 0 rgb(255 255 255 / 0.14) inset',
                  }}
                >
                  {phase === 'picking'
                    ? <span className="inline-flex items-center justify-center"><InlineSpinner /></span>
                    : <span>{buttonLabel}</span>}
                </button>
              </BorderBeam>
            </>
          )}

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
      </div>
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

/** Apple-style indeterminate loading ring scaled up for the full-card
 *  scanning view. */
function BigSpinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 36, height: 36, display: 'inline-block', flex: 'none',
        borderRadius: '50%',
        background:
          'conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.95) 100%)',
        WebkitMask:
          'radial-gradient(circle, transparent 12px, #000 12.8px)',
        mask:
          'radial-gradient(circle, transparent 12px, #000 12.8px)',
        animation: 'bb-spinner-rotate 0.9s linear infinite',
      }}
    />
  )
}

function SuccessTick() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="oklch(0.78 0.18 150)" />
      <path d="M7 12.5 L10.5 16 L17 9"
            stroke="#0b1410" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}
