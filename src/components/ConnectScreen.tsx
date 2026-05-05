import { useEffect, useState } from 'react'
import { isSupported, locateArchives, pickInstall } from '@/lib/coh2-fs'
import { BorderBeam } from '@/components/ui/border-beam'
import { defaultInstallPath } from '@/lib/ux'
import { isElectron, pickInstallPathNative, nativePathToHandle } from '@/lib/native-fs'

interface Props {
  onConnected: (handle: FileSystemDirectoryHandle) => void
}

/** First-run screen. Asks the user to point us at their CoH2 install once.
 *  After that, the page remembers the directory handle in IndexedDB and
 *  scans automatically on subsequent visits.
 *
 *  Visual: Apple-style dark glass — heavy backdrop blur, generous radius,
 *  hairline 0.5 px borders, soft inner highlight, single primary action.
 *  No noisy filesystem-path blocks or details/summary expanders — the
 *  native folder picker handles location guidance well enough. */
type Phase = 'idle' | 'picking' | 'scanning' | 'success' | 'error'

export default function ConnectScreen({ onConnected }: Props) {
  const [supported, setSupported] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  // Sheet-in-place state: when true the card body swaps to the Linux
  // bind-mount instructions instead of stacking a second modal on top
  // (Apple HIG: avoid modal-on-modal; expand the existing surface).
  const [showInstructions, setShowInstructions] = useState(false)
  const busy = phase === 'picking' || phase === 'scanning' || phase === 'success'
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (key: string, text: string) => {
    // Async clipboard with a synchronous fallback for older browsers / non-
    // HTTPS hosts (the static preview runs on http://localhost so the
    // navigator.clipboard call can fail on some Chromium builds).
    const writeSync = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
        return true
      } catch { return false }
    }
    const done = () => {
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 5000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => { if (writeSync()) done() })
    } else if (writeSync()) {
      done()
    }
  }

  // Only Linux/Steam-Deck and Windows — Feral pulled the CoH2 macOS port
  // from sale in 2023, it doesn't run on Apple Silicon, and there's no
  // path that works on a modern Mac. Better to leave it off than to
  // imply support that doesn't exist.
  const PATHS: Array<{ key: 'linux' | 'win'; path: string }> = [
    { key: 'win',   path: defaultInstallPath('win')   },
    { key: 'linux', path: defaultInstallPath('linux') },
  ]
  // Always show Windows first (the canonical path users will navigate to in
  // the picker) and Linux second (its path is only useful via the
  // Instructions modal that explains the bind-mount workaround).
  const orderedPaths = PATHS

  useEffect(() => { setSupported(isSupported()) }, [])

  const connect = async () => {
    setError(null); setPhase('picking')
    try {
      // In Electron: use native dialog.showOpenDialog instead of
      // the browser File System Access API picker.
      let handle: FileSystemDirectoryHandle | null | undefined
      if (isElectron()) {
        const nativePath = await pickInstallPathNative()
        if (!nativePath) { setPhase('idle'); return }
        handle = nativePathToHandle(nativePath)
      } else {
        handle = await pickInstall()
        if (!handle) { setPhase('idle'); return }
      }
      // Auto-validate: look for CoH2/Archives under the picked folder.
      // The "scanning" phase shows the animated dots so the user sees the
      // app actually doing something before bouncing back to the editor.
      setPhase('scanning')
      const archives = await locateArchives(handle)
      if (!archives) {
        setError("That folder doesn't look like a Company of Heroes 2 install — couldn't find CoH2/Archives. Try the parent folder of the game install.")
        setPhase('error')
        return
      }
      // Brief success state — green check + "Found" so the user gets a
      // clear "yes, that worked" beat before the editor swaps in.
      // 600 ms is long enough to register, short enough not to feel like
      // the app is stalling.
      setPhase('success')
      await new Promise(r => setTimeout(r, 600))
      onConnected(handle)
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setPhase('idle')
      } else if (err?.name === 'SecurityError' || /system files/i.test(err?.message ?? '')) {
        // Chrome's FS Access blocklist on Linux rejects: ~/.local, ~/.config,
        // ~/.cache, ~/.ssh, /etc, /var, /proc, /sys, /usr/bin etc.
        //
        // On atomic distros (Bazzite, Fedora Silverblue, openSUSE MicroOS,
        // Steam Deck SteamOS 3) the user's home directory is physically
        // located under /var/home/<user>/, with /home/<user> as a symlink.
        // Chrome canonicalises through the symlink and sees /var/... which
        // IS in the blocklist. So a bind mount under ~ doesn't help — the
        // canonical path is still /var/... A bind mount under /tmp does.
        setError(
          'Chrome blocks access to hidden system folders (anything under ~/.local, ~/.steam, /var, ' +
          '%APPDATA%, etc.). On Bazzite / Steam Deck / atomic distros the home folder is under ' +
          '/var/home/USER, which is also blocked, so a symlink under ~ does not help. Bind your Steam ' +
          'folder under /tmp instead — run these in a terminal once:\n\n' +
          '    sudo mkdir -p /tmp/coh2\n' +
          '    sudo mount --bind ~/.local/share/Steam /tmp/coh2\n\n' +
          'Then pick /tmp/coh2/steamapps/common/Company of Heroes 2/.'
        )
        setPhase('error')
      } else {
        setError(err?.message ?? String(err))
        setPhase('error')
      }
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center px-6">
      {/* Hero glass card — wider radius, deeper blur, layered borders. The
          inner highlight (1px white inset) is what gives this the Apple
          "frosted glass with a polished bezel" feel. */}
      <div
        className="relative max-w-md w-full glass-3 p-10 overflow-hidden"
        style={{
          borderRadius: 28,
          // Single hairline border + drop shadow + top inner highlight.
          // The earlier `0 0 0 0.5px white inset` duplicated the border
          // and produced a visible second ring/halo around the card.
          border: '0.5px solid rgb(255 255 255 / 0.10)',
          boxShadow:
            '0 24px 60px -16px rgb(0 0 0 / 0.55), ' +
            '0 1px 0 rgb(255 255 255 / 0.06) inset',
        }}
      >
        {/* Subtle Australian-flag-blue halo behind the brand mark */}
        <div
          aria-hidden
          className="absolute -top-20 -left-16 w-56 h-56 rounded-full pointer-events-none opacity-50 blur-3xl"
          style={{ background: 'rgba(1, 33, 105, 0.55)' }}
        />

        <div className="relative">
          {/* Brand mark — ASAP Australia logo. Click → opens the org on
              GitHub. Backed by a subtle Australian-flag-blue drop shadow so
              the white stars + crests don't disappear into the glass card. */}
          <a
            href="https://github.com/ASAP-Australia"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="ASAP Australia on GitHub"
            className="inline-block mb-7 transition hover:scale-[1.03] active:scale-[0.98]"
            style={{
              filter:
                'drop-shadow(0 0 14px rgba(1, 33, 105, 0.55)) ' +   // Aussie royal blue
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

          {/* Cool-silver eyebrow — matches the BorderBeam ocean palette and
              the Aussie-blue brand mark instead of fighting them with orange. */}
          <div className="text-[10px] uppercase tracking-[2.5px] font-semibold mb-3"
               style={{ color: 'oklch(0.86 0.05 220)' }}>
            CoH2 · Community Skin Editor
          </div>

          {/* Sheet-in-place: clicking the Linux row's "Instructions" button
              swaps the card body to the bind-mount steps. A "Back" link
              returns to the connect form. Same surface, two states — no
              modal stacked over the connect modal. */}
          {showInstructions ? (
            <button
              type="button"
              onClick={() => setShowInstructions(false)}
              className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-2)] hover:text-white cursor-pointer transition-colors"
            >
              <BackArrow />
              <span>Back to connect</span>
            </button>
          ) : null}

          <h1 className="text-[26px] font-semibold tracking-tight text-white leading-[1.15] mb-4">
            {showInstructions ? 'Linux / Steam Deck setup'
              : phase === 'scanning' ? 'Loading vehicle models…'
              : phase === 'success' ? 'Installation found'
              : 'Connect your CoH2 install'}
          </h1>

          {showInstructions ? (
            <InstructionsBody
              copied={copied === 'linux-bindmount'}
              onCopy={() => copy('linux-bindmount', 'sudo mkdir -p /tmp/coh2\nsudo mount --bind ~/.local/share/Steam /tmp/coh2')}
              onDone={() => setShowInstructions(false)}
            />
          ) : phase === 'scanning' || phase === 'success' ? (
            <div className="py-6 flex flex-col items-center text-center gap-3">
              {phase === 'scanning' ? <BigSpinner /> : <SuccessTick />}
              <div className="text-[13px] text-[var(--color-text-2)] leading-relaxed max-w-[260px]">
                {phase === 'scanning'
                  ? 'Indexing your installation and pre-loading the vehicle archives — usually a couple of seconds.'
                  : 'Found CoH2 archives. Loading the editor…'}
              </div>
            </div>
          ) : (
            <>
              <ul className="mb-5 space-y-1.5 text-[13px] text-[var(--color-text-2)] leading-snug">
                {[
                  'Reads vehicle meshes & base textures locally',
                  'Nothing uploaded — files stay on your machine',
                  'Grant access once; the browser remembers it',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span aria-hidden className="mt-[6px] size-1 rounded-full shrink-0"
                      style={{ background: 'oklch(0.85 0.10 220)' }} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              {/* Per-OS hints. Windows row shows the install path with a
                  Copy pill; Linux row is replaced with a single
                  "Instructions" button that opens the bind-mount modal,
                  since the displayed path can't be used directly anyway. */}
              <div className="mb-7 space-y-1.5">
                {orderedPaths.map(p => (
                  p.key === 'linux'
                    ? <LinuxInstructionsRow key="linux" onClick={() => setShowInstructions(true)} />
                    : <PathHint
                        key={p.key}
                        os={p.key}
                        path={p.path}
                        copied={copied === p.key}
                        onCopy={() => copy(p.key, p.path)}
                      />
                ))}
              </div>

              {!supported && (
                <div className="mb-5 px-3.5 py-2.5 rounded-2xl border border-red-400/25 bg-red-500/[0.06] text-[12px] text-red-200/90 leading-relaxed">
                  <b>Browser not supported.</b> This app uses the File System
                  Access API — please open it in Chrome, Edge, Brave or Opera.
                </div>
              )}

              {error && (
                <div className="mb-5 px-3.5 py-2.5 rounded-2xl border border-red-400/25 bg-red-500/[0.06] text-[12px] text-red-200/90 leading-relaxed whitespace-pre-line">
                  {error}
                </div>
              )}

              {/* Glass connect button — wrapped in BorderBeam, no spinner
                  inside; the loading affordance is the full-card view above. */}
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
                    boxShadow:
                      '0 1px 0 rgb(255 255 255 / 0.18) inset, ' +
                      '0 0 0 0.5px rgb(255 255 255 / 0.10) inset',
                  }}
                >
                  {/* While the OS picker is open, swap the text for a
                      spinner so the button reads as "working" without
                      shouting an instruction at the user. */}
                  {phase === 'picking'
                    ? <span className="inline-flex items-center justify-center"><InlineSpinner /></span>
                    : <span>Connect CoH2 install</span>}
                </button>
              </BorderBeam>
            </>
          )}

          {/* Bouncy spring on press — separated from `transition` so other
              state-driven CSS changes (hover bg) don't get the over-shoot.
              Spinner uses a 2π rotation on a conic-gradient half-arc
              (Apple's loading-circle idiom). */}
          {/* Spring-bounce press: applied to the BorderBeam WRAPPER (not the
              inner button) via :has(:active) so the beam shrinks together with
              the button. Background-fade stays on the button itself. */}
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

/** Bind-mount instructions content. Renders inside the existing connect
 *  card (sheet-in-place expansion) when the user clicks "Instructions" on
 *  the Linux row. No second modal — just a content swap on the same
 *  surface, with a "Back to connect" link in the card header. */
function InstructionsBody({ copied, onCopy, onDone }: {
  copied: boolean; onCopy: () => void; onDone: () => void
}) {
  // Esc returns to the connect form
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDone])
  return (
    <>
      <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mb-4">
        Chrome blocks web apps from reading hidden directories like
        {' '}<code className="text-[12px] text-white/85">~/.local</code>{' '}
        and anything under <code className="text-[12px] text-white/85">/var</code>
        {' '}— which is where Bazzite, Steam Deck and other atomic distros
        actually keep your home folder. A symlink doesn't help. The fix is
        a bind mount under <code className="text-[12px] text-white/85">/tmp</code>,
        which Chrome accepts. Run these once in a terminal (asks for your
        sudo password):
      </p>

      <div className="mb-4 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-black/30 flex items-center gap-2">
        <code className="text-[11.5px] text-white/90 font-mono leading-snug whitespace-pre overflow-x-auto flex-1">
{`sudo mkdir -p /tmp/coh2
sudo mount --bind ~/.local/share/Steam /tmp/coh2`}
        </code>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? 'Command copied' : 'Copy commands'}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 h-7 w-[80px] rounded-lg
                     text-[11px] font-medium leading-none cursor-pointer active:scale-[0.94]"
          style={{
            transition: 'background-color 160ms ease, color 160ms ease, transform 120ms',
            background: copied ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: copied ? '#ffffff' : 'var(--color-text-2)',
          }}
        >
          {copied ? (<><CheckIcon filled /><span>Copied</span></>)
                  : (<><CopyIcon /><span>Copy</span></>)}
        </button>
      </div>

      <p className="text-[12.5px] text-[var(--color-text-2)] leading-relaxed mb-6">
        Then come back here, click Connect, and pick
        {' '}<code className="text-[11.5px] text-white/85">/tmp/coh2/steamapps/common/Company of Heroes 2</code>.
        The bind goes away on reboot; re-run the second command after a
        reboot to restore it.
      </p>

      <BorderBeam colorVariant="ocean" duration={5} strength={0.85} borderRadius={16} borderWidth={1} className="bb-pressable">
        <button
          onClick={onDone}
          className="bb-connect relative w-full text-white font-semibold h-12 text-[14px] tracking-tight hover:bg-white/[0.10]"
          style={{
            borderRadius: 16,
            cursor: 'pointer',
            background: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            boxShadow:
              '0 1px 0 rgb(255 255 255 / 0.18) inset, ' +
              '0 0 0 0.5px rgb(255 255 255 / 0.10) inset',
          }}
        >
          Done
        </button>
      </BorderBeam>
    </>
  )
}

function BackArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 12L5 8l4.5-4" />
    </svg>
  )
}

/** Linux row — replaces the path-display + Copy pill with a single
 *  "Instructions" button. On Linux Chrome blocks the canonical install
 *  path entirely, so showing the path is misleading. The button opens
 *  the bind-mount modal where the actual fix lives. Same height + radius
 *  as PathHint so the two rows line up visually. */
function LinuxInstructionsRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show Linux setup instructions"
      className="w-full pl-3 pr-4 py-2.5 min-h-[40px] rounded-xl border border-white/[0.06] bg-white/[0.03]
                 hover:bg-white/[0.05] active:scale-[0.99] transition flex items-center gap-3 text-left
                 cursor-pointer"
    >
      <span className="shrink-0 grid place-items-center text-[var(--color-text-2)] w-6 h-6" aria-hidden>
        <OsIcon os="linux" />
      </span>
      <span className="flex-1 text-[12px] text-[var(--color-text-2)] leading-none">
        Linux / Steam Deck
      </span>
      <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-2)] leading-none">
        <InfoIcon />
        <span>Instructions</span>
      </span>
    </button>
  )
}

/** Per-OS path row. Layout (single line):
 *    [ OS icon ]  <path…>                          [ Copy / Copied pill ]
 *  The icon is centred vertically; the path is monospace, 10 px, nowrap +
 *  ellipsis with a title attribute so the full string is recoverable on
 *  hover. The copy pill sits top-right and flips to a "Copied" check for
 *  ~1.4 s after a successful clipboard write. */
function PathHint({ os, path, copied, onCopy }: {
  os: 'linux' | 'win'; path: string; copied: boolean; onCopy: () => void
}) {
  const label = os === 'linux' ? 'Linux / Steam Deck' : 'Windows'
  return (
    <div
      className="relative pl-3 py-2.5 min-h-[40px] rounded-xl border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05] transition-colors flex items-center gap-3"
      style={{ paddingRight: 86 }}
    >
      <span className="shrink-0 grid place-items-center text-[var(--color-text-2)] w-6 h-6" aria-label={label}>
        <OsIcon os={os} />
      </span>
      <code
        title={path}
        className="text-[11px] text-[var(--color-text-2)] font-mono leading-none whitespace-nowrap overflow-hidden text-ellipsis flex-1 self-center"
      >
        {path}
      </code>
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? `${label} install path copied` : `Copy ${label} install path`}
          className="inline-flex items-center justify-center gap-1.5 h-7 w-[80px] rounded-lg
                     text-[11px] font-medium leading-none cursor-pointer active:scale-[0.94]"
          style={{
            transition: 'background-color 160ms ease, color 160ms ease, transform 120ms',
            background: copied ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: copied ? '#ffffff' : 'var(--color-text-2)',
          }}
        >
          {copied ? (
            <>
              <CheckIcon filled />
              <span>Copied</span>
            </>
          ) : (
            <>
              <CopyIcon />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5" strokeLinecap="round" />
      <circle cx="8" cy="5.25" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  )
}

function CheckIcon({ filled = false }: { filled?: boolean }) {
  // Filled circle + white tick — matches the reference "Copied" pill.
  if (filled) {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="7" fill="oklch(0.78 0.18 150)" />
        <path d="M4.5 8.2 L7 10.6 L11.6 5.6"
              stroke="#0b1410" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    )
  }
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="oklch(0.85 0.16 145)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  )
}

/** OS glyphs — drawn as SVG paths so they inherit currentColor like the
 *  rest of the UI. 18 px so they read clearly next to the 11 px monospace
 *  path text. */
function OsIcon({ os }: { os: 'linux' | 'win' }) {
  // Both icons render at 20×20 inside the 24×24 slot so they sit on the
  // same vertical centre regardless of the SVG's internal padding.
  if (os === 'win') {
    return (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" className="block" aria-hidden>
        <path d="M0 1.7L6.5.83v6.4H0V1.7zm7.3-.97L16 0v7.3H7.3V.73zM0 8.77h6.5v6.4L0 14.3V8.77zM7.3 8.77H16V16l-8.7-1.27V8.77z" />
      </svg>
    )
  }
  // Linux — Simple Icons Tux silhouette. ViewBox 24×24, content slightly
  // bottom-heavy → render at 20×20 to match Windows and let the flex slot
  // do the centring without one row reading taller than the other.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="block" aria-hidden>
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" />
    </svg>
  )
}

/** Inline button-size spinner — 18 px, sits inline in the Connect button
 *  while the OS file picker is open. Same visual idiom as BigSpinner. */
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
 *  scanning view. 36 px disc with a fading conic tail rotating once per 0.9 s. */
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

/** Filled green disc + white tick for the brief success state right
 *  before we hand off to the editor. Matches the Copied pill's check. */
function SuccessTick() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="oklch(0.78 0.18 150)" />
      <path d="M7 12.5 L10.5 16 L17 9"
            stroke="#0b1410" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}
