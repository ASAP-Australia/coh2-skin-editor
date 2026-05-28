/**
 * SteamGate — first-run Steam authentication screen for v1.0.
 *
 * Replaces ConnectScreen. The Steam-first design (.llm/steam-first-design.md)
 * makes a live Steamworks connection a hard requirement: every Workshop
 * publish needs the user's SteamID, and the multiplayer lobby validation
 * bug only goes away when items go through real Workshop IDs instead of
 * the locally-generated fake ones that mod-export used to produce.
 *
 * Three branches:
 *
 *   1. `no-steam`       — Steam isn't running. CTA: "Open Steam" (best
 *                         effort via `steam://open/main`) + Retry button.
 *   2. `no-game`        — User doesn't own CoH2 on this account. CTA:
 *                         link to the CoH2 store page + Quit.
 *   3. `init-failed`    — Generic SDK failure (corrupt steam_appid.txt,
 *                         32-bit pipe mismatch, etc.). Show the message
 *                         verbatim + Retry / Quit.
 *
 * On success, we pass Steam's reported install path up via `onAuthed`.
 * The Steam SDK's `appInstallDir` is more reliable than our heuristic
 * registry / Proton-prefix detection because it asks Steam itself,
 * which always knows where it put the bytes.
 *
 * Outside Electron (web build), Steam isn't reachable — we render a
 * landing-only message pointing users at the desktop release. The
 * editor never starts in the browser per v1.0 scope (see todo).
 */

import { useCallback, useEffect, useState } from 'react'
import { BorderBeam } from '@/components/ui/border-beam'
import {
  isElectron,
  nativePathToHandle,
  type SteamInitError,
  type SteamInitResult,
} from '@/lib/native-fs'

interface Props {
  /** Called once Steam confirms the user owns CoH2. We forward the
   *  install path so App.tsx can mount the editor without an extra
   *  picker step. */
  onAuthed: (args: {
    handle: FileSystemDirectoryHandle
    steamId: string
    personaName: string
  }) => void
}

type Phase =
  | { kind: 'probing' }
  | { kind: 'authed'; personaName: string }
  | { kind: 'no-steam'; error: SteamInitError }
  | { kind: 'no-game'; error: SteamInitError }
  | { kind: 'init-failed'; error: SteamInitError }
  | { kind: 'no-electron' }
  | { kind: 'install-not-found'; personaName: string; installPath: string | null }

export default function SteamGate({ onAuthed }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'probing' })

  const probe = useCallback(async () => {
    if (!isElectron()) {
      setPhase({ kind: 'no-electron' })
      return
    }
    setPhase({ kind: 'probing' })
    try {
      const result: SteamInitResult = await window.electronAPI!.steam.init()
      if (!result.ok) {
        const err = result.error
        if (err.code === 'no-steam') setPhase({ kind: 'no-steam', error: err })
        else if (err.code === 'no-game') setPhase({ kind: 'no-game', error: err })
        else setPhase({ kind: 'init-failed', error: err })
        return
      }
      // Steam returned the install path. Try to mount it.
      if (!result.info.installPath) {
        setPhase({
          kind: 'install-not-found',
          personaName: result.info.personaName,
          installPath: null,
        })
        return
      }
      const handle = nativePathToHandle(result.info.installPath)
      setPhase({ kind: 'authed', personaName: result.info.personaName })
      // Tiny pause so the success state has time to render before we
      // unmount this screen.
      await new Promise(r => setTimeout(r, 600))
      onAuthed({
        handle,
        steamId: result.info.steamId,
        personaName: result.info.personaName,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPhase({
        kind: 'init-failed',
        error: { code: 'init-failed', message: msg },
      })
    }
  }, [onAuthed])

  const retry = useCallback(async () => {
    if (isElectron()) await window.electronAPI!.steam.reset()
    void probe()
  }, [probe])

  // Auto-probe on mount. probe() is async — setState calls happen in the
  // Promise resolution, not synchronously; the rule fires a false positive here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- probe() is async; setState happens in Promise resolution, not synchronously
    void probe()
  }, [probe])

  return (
    <div className="min-h-dvh grid place-items-center px-6">
      <div
        className="relative max-w-md w-full glass-3 p-10 overflow-hidden"
        style={{
          borderRadius: 28,
          boxShadow: '0 30px 80px -24px rgb(0 0 0 / 0.55)',
        }}
      >
        {/* Aussie-blue ambient halo, same as ConnectScreen for visual continuity */}
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
              src={`${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}asap-logo.png`}
              alt="ASAP Australia"
              width={56}
              height={56}
              className="block rounded-2xl"
              draggable={false}
            />
          </a>

          <div
            className="text-[10px] uppercase tracking-[2.5px] font-semibold mb-3"
            style={{ color: 'oklch(0.86 0.05 220)' }}
          >
            CoH2 · Community Skin Editor
          </div>

          <PhaseContent phase={phase} onRetry={retry} />

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
            .bb-connect:not(:disabled):hover {
              background: rgba(255,255,255,0.10) !important;
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

// ── Phase content ─────────────────────────────────────────────────────

function PhaseContent({
  phase,
  onRetry,
}: {
  phase: Phase
  onRetry: () => void
}) {
  switch (phase.kind) {
    case 'probing':
      return (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight text-white leading-[1.15] mb-4">
            Connecting to Steam…
          </h1>
          <div className="py-6 flex flex-col items-center text-center gap-3">
            <BigSpinner />
            <div className="text-[13px] text-[var(--color-text-2)] leading-relaxed max-w-[260px]">
              Checking your Steam library for Company of Heroes 2.
            </div>
          </div>
        </>
      )

    case 'authed':
      return (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight text-white leading-[1.15] mb-4">
            Welcome, {phase.personaName}
          </h1>
          <div className="py-6 flex flex-col items-center text-center gap-3">
            <SuccessTick />
            <div className="text-[13px] text-[var(--color-text-2)] leading-relaxed max-w-[260px]">
              Signed in. Loading the editor…
            </div>
          </div>
        </>
      )

    case 'no-steam':
      return (
        <BranchCard
          title="Start Steam to continue"
          message="This tool publishes to the Steam Workshop, so it needs a live Steam connection. Open Steam and click Retry."
          primary={{
            label: 'Open Steam',
            href: 'steam://open/main',
          }}
          secondary={{ label: 'Retry', onClick: onRetry }}
        />
      )

    case 'no-game':
      return (
        <BranchCard
          title="Company of Heroes 2 not in your library"
          message="The editor is a community modding tool for CoH2 — Steam doesn't see the game on this account. If you own it on another account, sign in as that user from Steam and retry."
          primary={{
            label: 'View on Steam',
            href: 'https://store.steampowered.com/app/231430/',
          }}
          secondary={{ label: 'Retry', onClick: onRetry }}
        />
      )

    case 'init-failed':
      return (
        <BranchCard
          title="Couldn't reach Steam"
          message={phase.error.message || 'Steam SDK initialisation failed for an unknown reason.'}
          secondary={{ label: 'Retry', onClick: onRetry }}
        />
      )

    case 'no-electron':
      return (
        <BranchCard
          title="Open the desktop app to continue"
          message="This is the web preview. The editor publishes to the Steam Workshop and only runs in the desktop release."
          primary={{
            label: 'Download the desktop app',
            href: 'https://github.com/ASAP-Australia/coh2-skin-editor/releases',
          }}
        />
      )

    case 'install-not-found':
      return (
        <BranchCard
          title="Couldn't locate your CoH2 install"
          message={
            phase.installPath
              ? `Steam reported "${phase.installPath}", but that folder is missing or inaccessible. Verify game files in Steam, then retry.`
              : "Steam couldn't tell us where Company of Heroes 2 is installed. Try verifying game files from your Steam library, then click Retry."
          }
          secondary={{ label: 'Retry', onClick: onRetry }}
        />
      )
  }
}

interface ActionLink {
  label: string
  href: string
}
interface ActionButton {
  label: string
  onClick: () => void
}

function BranchCard({
  title,
  message,
  primary,
  secondary,
}: {
  title: string
  message: string
  primary?: ActionLink
  secondary?: ActionButton
}) {
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight text-white leading-[1.15] mb-4">
        {title}
      </h1>
      <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mb-5 whitespace-pre-line">
        {message}
      </p>
      <div className="flex flex-col gap-3">
        {primary && (
          <BorderBeam
            colorVariant="ocean"
            duration={5}
            strength={0.85}
            borderRadius={16}
            borderWidth={1}
            className="bb-pressable"
          >
            <a
              href={primary.href}
              target={primary.href.startsWith('http') ? '_blank' : undefined}
              rel={primary.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="bb-connect relative w-full text-white font-semibold h-12 text-[14px] tracking-tight
                         flex items-center justify-center"
              style={{
                borderRadius: 16,
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.06)',
                backdropFilter: 'blur(20px) saturate(160%)',
                WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                boxShadow: '0 1px 0 rgb(255 255 255 / 0.14) inset',
                textDecoration: 'none',
              }}
            >
              {primary.label}
            </a>
          </BorderBeam>
        )}
        {secondary && (
          <button
            onClick={secondary.onClick}
            className="relative w-full text-white/85 h-11 text-[13px] tracking-tight
                       rounded-2xl border border-white/[0.10] hover:bg-white/[0.06]
                       hover:border-white/[0.18] transition-colors"
          >
            {secondary.label}
          </button>
        )}
      </div>
    </>
  )
}

// ── Spinners / ticks ─────────────────────────────────────────────────

function BigSpinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 36,
        height: 36,
        display: 'inline-block',
        flex: 'none',
        borderRadius: '50%',
        background:
          'conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.95) 100%)',
        WebkitMask: 'radial-gradient(circle, transparent 12px, #000 12.8px)',
        mask: 'radial-gradient(circle, transparent 12px, #000 12.8px)',
        animation: 'bb-spinner-rotate 0.9s linear infinite',
      }}
    />
  )
}

function SuccessTick() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="oklch(0.78 0.18 150)" />
      <path
        d="M7 12.5 L10.5 16 L17 9"
        stroke="#0b1410"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
