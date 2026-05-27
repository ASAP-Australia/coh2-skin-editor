/**
 * WipeMigrationScreen — one-time clean-up of pre-v1.0 fake-Workshop-ID SGAs.
 *
 * Pre-v1.0 Live Sync wrote built skin/decal/faceplate packs into
 *   ~/Documents/My Games/Company of Heroes 2/mods/{decals,faceplates,
 *    extension}/subscriptions/ and …/mods/skins/
 * using basenames that look like Workshop IDs but aren't (32-hex GUIDs
 * for decals/faceplates, Date.now()*1000 numerics for skins). CoH2's
 * lobby validation asks Steam to confirm those IDs and fails the join
 * because Steam doesn't recognise them — that's the multiplayer bug
 * that drove the Steam-first v1.0 architecture.
 *
 * On the first launch of v1.0 we run a one-shot scan via the
 * `mods.scanFakeIds` IPC bridge. Three outcomes:
 *
 *   • mods folder undetected → silently skip (nothing to clean).
 *   • zero entries           → silently skip (clean install).
 *   • ≥1 entry               → show this screen and ask the user to
 *                              trash them (recoverable) or skip.
 *
 * Either path through the screen sets a localStorage flag so the
 * screen never re-renders on subsequent launches even if the user
 * dismissed it without trashing.
 *
 * Trash, not unlink. Electron's shell.trashItem() routes through the
 * OS Recycle Bin / Trash so a misclassified real subscription stays
 * recoverable. The path-containment check in mods-wipe.ts adds belt-
 * and-braces protection against a renderer compromise.
 */

import { useCallback, useEffect, useState } from 'react'
import { BorderBeam } from '@/components/ui/border-beam'
import type { FakeIdEntry, TrashResult } from '@/lib/native-fs'

/** localStorage key set once the user finishes (or skips) the migration.
 *  We never auto-clear this — re-running the wipe is a settings-menu
 *  action, not something we surprise the user with at boot. */
export const WIPE_DONE_KEY = 'coh2-skin:wipe-fake-ids-done'

interface Props {
  /** Auto-detected mods-folder absolute path. The component scans this
   *  path on mount and trashes within it on confirmation. If `null`
   *  the migration short-circuits and onComplete() fires immediately. */
  modsPath: string | null
  /** Called once the migration is finished (trashed, skipped, or
   *  short-circuited). App.tsx swaps to the Editor on this callback. */
  onComplete: () => void
}

type Phase =
  | { kind: 'scanning' }
  | { kind: 'review'; entries: FakeIdEntry[] }
  | { kind: 'confirm'; entries: FakeIdEntry[] }
  | { kind: 'trashing'; entries: FakeIdEntry[] }
  | { kind: 'done'; result: TrashResult }
  | { kind: 'error'; message: string }

export default function WipeMigrationScreen({ modsPath, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' })

  /** Mark the migration done in localStorage and signal the parent. */
  const finish = useCallback(() => {
    try {
      localStorage.setItem(WIPE_DONE_KEY, new Date().toISOString())
    } catch {
      // localStorage unavailable (private mode / quota) — swallow; the
      // migration just re-runs next session, which is harmless.
    }
    onComplete()
  }, [onComplete])

  // Scan on mount. If anything is missing — modsPath is null, the IPC
  // bridge is gone, the scan throws — short-circuit to onComplete so a
  // user without a CoH2 install doesn't get stuck.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!modsPath) {
        finish()
        return
      }
      const api = window.electronAPI
      if (!api?.mods?.scanFakeIds) {
        finish()
        return
      }
      try {
        const entries = await api.mods.scanFakeIds(modsPath)
        if (cancelled) return
        if (entries.length === 0) {
          finish()
          return
        }
        setPhase({ kind: 'review', entries })
      } catch (err) {
        if (cancelled) return
        // Scan-time errors are non-fatal: we don't want a corrupt mods
        // folder to block the user out of the editor. Log + skip.
        // eslint-disable-next-line no-console
        console.warn('[wipe-migration] scan failed', err)
        finish()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modsPath, finish])

  const startTrash = useCallback(async () => {
    if (phase.kind !== 'confirm') return
    if (!modsPath) {
      finish()
      return
    }
    const api = window.electronAPI
    if (!api?.mods?.trashFakeIds) {
      finish()
      return
    }
    setPhase({ kind: 'trashing', entries: phase.entries })
    try {
      const result = await api.mods.trashFakeIds(
        phase.entries.map(e => e.path),
        modsPath,
      )
      setPhase({ kind: 'done', result })
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [phase, modsPath, finish])

  return (
    <div className="min-h-dvh w-full flex items-center justify-center px-6 py-12">
      <div
        className="relative w-full max-w-[640px] p-8 rounded-3xl"
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          backdropFilter: 'blur(28px) saturate(140%)',
          WebkitBackdropFilter: 'blur(28px) saturate(140%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow:
            '0 14px 48px rgba(0, 0, 0, 0.42), 0 1px 0 rgba(255,255,255,0.08) inset',
        }}
      >
        <div
          className="text-[10px] uppercase tracking-[2.5px] font-semibold mb-3"
          style={{ color: 'oklch(0.86 0.05 220)' }}
        >
          One-time cleanup
        </div>

        <PhaseBody
          phase={phase}
          onReview={() => {
            if (phase.kind === 'review')
              setPhase({ kind: 'confirm', entries: phase.entries })
          }}
          onConfirm={() => void startTrash()}
          onCancel={() => {
            if (phase.kind === 'confirm')
              setPhase({ kind: 'review', entries: phase.entries })
          }}
          onSkip={finish}
          onContinue={finish}
        />
      </div>
    </div>
  )
}

// ── Phase body ────────────────────────────────────────────────────────

function PhaseBody({
  phase,
  onReview,
  onConfirm,
  onCancel,
  onSkip,
  onContinue,
}: {
  phase: Phase
  onReview: () => void
  onConfirm: () => void
  onCancel: () => void
  onSkip: () => void
  onContinue: () => void
}) {
  switch (phase.kind) {
    case 'scanning':
      return (
        <>
          <Heading>Checking your mods folder…</Heading>
          <div className="py-4 flex items-center gap-4">
            <Spinner />
            <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed">
              Looking for old skin / decal / faceplate packs that need to be
              re-published through the Steam Workshop.
            </p>
          </div>
        </>
      )

    case 'review':
      return (
        <>
          <Heading>Old mod files found</Heading>
          <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mb-4">
            We found {phase.entries.length} pack
            {phase.entries.length === 1 ? '' : 's'} in your CoH2 mods folder
            from an earlier version of this editor. They use locally-generated
            IDs that Steam doesn't recognise — multiplayer lobbies will reject
            you while they're present.
          </p>
          <EntryList entries={phase.entries} />
          <p className="text-[12px] text-[var(--color-text-3)] leading-relaxed mt-4 mb-5">
            We'll move them to your system Trash, not delete them — if any of
            these turn out to be a real Workshop subscription you can restore
            it from there.
          </p>
          <ButtonRow>
            <PrimaryButton onClick={onReview}>Review &amp; trash</PrimaryButton>
            <SecondaryButton onClick={onSkip}>Skip for now</SecondaryButton>
          </ButtonRow>
        </>
      )

    case 'confirm':
      return (
        <>
          <Heading>Move these to Trash?</Heading>
          <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mb-4">
            About to send {phase.entries.length} file
            {phase.entries.length === 1 ? '' : 's'} to your system Trash. You
            can drag them back later from Recycle Bin / Trash if you change
            your mind.
          </p>
          <EntryList entries={phase.entries} />
          <ButtonRow className="mt-5">
            <PrimaryButton onClick={onConfirm}>Move to Trash</PrimaryButton>
            <SecondaryButton onClick={onCancel}>Back</SecondaryButton>
          </ButtonRow>
        </>
      )

    case 'trashing':
      return (
        <>
          <Heading>Cleaning up…</Heading>
          <div className="py-4 flex items-center gap-4">
            <Spinner />
            <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed">
              Trashing {phase.entries.length} file
              {phase.entries.length === 1 ? '' : 's'} from
              your CoH2 mods folder.
            </p>
          </div>
        </>
      )

    case 'done': {
      const total = phase.result.trashed.length + phase.result.failed.length
      const allOk = phase.result.failed.length === 0
      return (
        <>
          <Heading>{allOk ? 'All clean' : 'Partial cleanup'}</Heading>
          <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mb-4">
            {allOk
              ? `Trashed ${phase.result.trashed.length} of ${total} file${total === 1 ? '' : 's'}. Multiplayer lobby validation will pass on your next match.`
              : `Trashed ${phase.result.trashed.length} of ${total} file${total === 1 ? '' : 's'}. The rest are listed below and can be removed manually if needed.`}
          </p>
          {!allOk && (
            <ul
              className="text-[12px] text-[var(--color-text-3)] leading-relaxed mb-4 max-h-40 overflow-auto pr-2"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
            >
              {phase.result.failed.map(f => (
                <li key={f.path} className="mb-1">
                  {f.path} — {f.error}
                </li>
              ))}
            </ul>
          )}
          <ButtonRow>
            <PrimaryButton onClick={onContinue}>Continue to editor</PrimaryButton>
          </ButtonRow>
        </>
      )
    }

    case 'error':
      return (
        <>
          <Heading>Couldn't finish cleanup</Heading>
          <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mb-5 whitespace-pre-line">
            {phase.message}
          </p>
          <ButtonRow>
            <PrimaryButton onClick={onContinue}>Continue anyway</PrimaryButton>
          </ButtonRow>
        </>
      )
  }
}

// ── Sub-components ─────────────────────────────────────────────────────

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-[24px] font-semibold tracking-tight text-white leading-[1.2] mb-3">
      {children}
    </h1>
  )
}

function EntryList({ entries }: { entries: FakeIdEntry[] }) {
  // Group by kind so the list reads as `decals (3)`, `faceplates (1)`, etc.
  const byKind = new Map<FakeIdEntry['kind'], FakeIdEntry[]>()
  for (const e of entries) {
    const prev = byKind.get(e.kind) ?? []
    prev.push(e)
    byKind.set(e.kind, prev)
  }
  const kindOrder: FakeIdEntry['kind'][] = ['decals', 'faceplates', 'extension', 'skins']
  return (
    <div
      className="rounded-xl border border-white/[0.08] bg-white/[0.02] max-h-44 overflow-auto"
      style={{ scrollbarWidth: 'thin' }}
    >
      <ul className="text-[12px] divide-y divide-white/[0.05]">
        {kindOrder
          .filter(k => byKind.has(k))
          .map(k => (
            <li key={k} className="px-4 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-white/85 capitalize">{k}</span>
                <span className="text-[var(--color-text-3)] tabular-nums">
                  {byKind.get(k)!.length}
                </span>
              </div>
              <div
                className="text-[11px] text-[var(--color-text-3)] mt-0.5"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
              >
                {byKind.get(k)!
                  .slice(0, 2)
                  .map(e => e.id.slice(0, 10) + (e.id.length > 10 ? '…' : ''))
                  .join('  ·  ')}
                {byKind.get(k)!.length > 2 ? `  +${byKind.get(k)!.length - 2} more` : ''}
              </div>
            </li>
          ))}
      </ul>
    </div>
  )
}

function ButtonRow({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={`flex flex-col gap-2.5 ${className}`}>{children}</div>
}

function PrimaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <BorderBeam
      colorVariant="ocean"
      duration={5}
      strength={0.85}
      borderRadius={16}
      borderWidth={1}
      className="bb-pressable"
    >
      <button
        onClick={onClick}
        className="bb-connect relative w-full text-white font-semibold h-12 text-[14px] tracking-tight
                   flex items-center justify-center"
        style={{
          borderRadius: 16,
          cursor: 'pointer',
          background: 'rgba(255, 255, 255, 0.06)',
          backdropFilter: 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: 'blur(20px) saturate(160%)',
          boxShadow: '0 1px 0 rgb(255 255 255 / 0.14) inset',
        }}
      >
        {children}
      </button>
    </BorderBeam>
  )
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="relative w-full text-white/85 h-11 text-[13px] tracking-tight
                 rounded-2xl border border-white/[0.10] hover:bg-white/[0.06]
                 hover:border-white/[0.18] transition-colors"
    >
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 28,
        height: 28,
        display: 'inline-block',
        flex: 'none',
        borderRadius: '50%',
        background:
          'conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.95) 100%)',
        WebkitMask: 'radial-gradient(circle, transparent 10px, #000 10.6px)',
        mask: 'radial-gradient(circle, transparent 10px, #000 10.6px)',
        animation: 'bb-spinner-rotate 0.9s linear infinite',
      }}
    />
  )
}
