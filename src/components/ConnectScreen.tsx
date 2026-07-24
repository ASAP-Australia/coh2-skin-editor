import { useEffect, useRef, useState, memo, lazy, Suspense } from 'react'
import { isSupported, locateArchives, pickInstall } from '@/lib/coh2-fs'
import { BorderBeam } from '@/components/ui/border-beam'
import { AnimatedSwap } from '@/components/ui/animated-swap'
import { isElectron, detectInstallPath, pickInstallPathNative, nativePathToHandle, initSteamNative } from '@/lib/native-fs'
import type { SteamInitInfo } from '@/lib/native-fs'
import { preloadFaction } from '@/lib/preload'
import { VEHICLES, FACTIONS, defaultVehicleForFaction, type Faction } from '@/lib/vehicles'

// Lazy-loaded so Three.js doesn't hit the initial JS parse budget. The
// headless warm Viewport is only mounted during the 'preloading' phase.
const Viewport = lazy(() => import('./Viewport'))
// Guards the headless warm Viewport on no/broken-WebGL machines: skips
// renderer construction and swallows late throws so it can't white-screen.
import ViewportGuard from '@/components/ViewportGuard'

/**
 * Isolated progress counter for the 'preloading' phase.
 *
 * WHY: `setLoadProgress` fires on every vehicle byte-read completion, which
 * would re-render the entire ConnectScreen component including BorderBeam
 * (which re-injects a <style> block on each render, compounding jank).
 *
 * FIX: progress is held in a ref on the parent and pushed imperatively into
 * this child via the `counterRef` handle. The parent never calls
 * `setLoadProgress` (the state is removed entirely), so BorderBeam's subtree
 * stays mounted and never re-renders on progress ticks. Only the
 * VehicleLoadCounter re-renders, which is a single text span.
 */
interface VehicleCounterHandle {
  update: (done: number, total: number) => void
}

interface VehicleCounterProps {
  total: number
  handleRef: React.MutableRefObject<VehicleCounterHandle | null>
}

const VehicleLoadCounter = memo(function VehicleLoadCounter({ total, handleRef }: VehicleCounterProps) {
  const [done, setDone] = useState(0)

  // Expose an imperative update so the parent can push progress without
  // triggering a re-render of ConnectScreen or any of its other children.
  useEffect(() => {
    handleRef.current = { update: (d: number) => setDone(d) }
    return () => { handleRef.current = null }
  }, [handleRef])

  return (
    <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
      Loading vehicles… {done}/{total}
    </span>
  )
})

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
type Phase = 'idle' | 'picking' | 'scanning' | 'linking-steam' | 'preloading' | 'success' | 'warning'

export default function ConnectScreen({ onConnected }: Props) {
  const [supported] = useState(() => isSupported() || isElectron())
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [steamWarning, setSteamWarning] = useState<string | null>(null)
  const [detectedPath, setDetectedPath] = useState<string | null>(null)
  // Vehicle byte-preload progress — drives the green fill bar imperatively.
  // counterRef holds the imperative handle to VehicleLoadCounter (still kept
  // for the hidden DOM node; see below). Progress updates for the fill bar
  // go through progressFillRef so neither ConnectScreen nor BorderBeam
  // re-render on every tick — only the fill span's inline width changes.
  const counterRef = useRef<VehicleCounterHandle | null>(null)
  // Ref to the green progress fill <span> inside the button. Updated
  // imperatively on each preload tick so no state/re-render is needed.
  const progressFillRef = useRef<HTMLSpanElement | null>(null)

  // Push a progress fraction (0..1) to the fill bar without triggering
  // a React re-render. Called alongside counterRef.current?.update().
  const updateFill = (fraction: number) => {
    const el = progressFillRef.current
    if (!el) return
    el.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`
    el.style.animation = 'none'
  }
  // Snapshot of detectedPath at the moment the user clicks connect — frozen so
  // async detection can't mutate bullet #3 text mid-click. Kept in state (not
  // a ref) so it's safe to read during render.
  const [bulletThreeSnapshot, setBulletThreeSnapshot] = useState<string | null>(null)
  // 'warning' is intentionally NOT busy — the user can click again immediately.
  const busy = phase === 'picking' || phase === 'scanning' || phase === 'linking-steam' || phase === 'preloading' || phase === 'success'

  // The FileSystemDirectoryHandle of the CoH2 install. Set in state during
  // 'preloading' so a hidden <Viewport warmupOnly> can be rendered (it needs
  // root as a prop). Null at all other phases.
  const [warmupHandle, setWarmupHandle] = useState<FileSystemDirectoryHandle | null>(null)
  // Ref to the headless Viewport's buildVehicleIntoCache function, wired via
  // the preloadRef prop. Used to drive per-vehicle CPU builds at Connect.
  const viewportPreloadRef = useRef<((spec: import('@/lib/vehicles').VehicleSpec, season: 'summer' | 'winter', eager?: boolean, cpuOnly?: boolean) => Promise<void>) | null>(null)

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
      const archives = await locateArchives(handle)
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

      // Byte-preload every faction's vehicle RGM bytes into the module cache
      // (pure disk I/O — formerly done lazily when a skin pack was opened).
      // Doing it here, behind the Connect spinner with visible progress, means
      // the editor's per-vehicle GPU build later hits a warm bytesCache and
      // skips disk I/O. We don't know the pack's faction at connect, so preload
      // all factions in parallel (archive opens share a module cache, so the
      // common Art*.sga TOC parses only happen once). Per-faction errors are
      // non-fatal — Viewport falls back to its on-demand SGA search.
      setPhase('preloading')
      // Trigger the hidden warm Viewport mount by storing handle in state.
      // React will re-render and the <Viewport warmupOnly> will mount, creating
      // a renderer+camera and wiring viewportPreloadRef via the preloadRef prop.
      setWarmupHandle(handle!)
      // Initialise counter and fill bar to 0 (no ConnectScreen re-render).
      counterRef.current?.update(0, VEHICLES.length)
      updateFill(0)
      const total = VEHICLES.length
      const fractionByFaction = new Map<Faction, number>()
      // Throttle counter updates: only push when the rounded done-count actually
      // changes, avoiding dozens of identical re-renders of VehicleLoadCounter
      // during burst completions. The final forced update below guarantees the
      // counter always settles on the correct value.
      let lastDone = 0
      await Promise.allSettled(
        FACTIONS.map(({ id }) =>
          preloadFaction(handle!, id, p => {
            fractionByFaction.set(id, p.fraction)
            let sum = 0
            for (const f of fractionByFaction.values()) sum += f
            const avg = sum / FACTIONS.length
            // Scale bytes phase to 0–50 % of total so vehicle CPU-warm phase
            // can drive the second 50 %. Each phase independently goes 0→total.
            const rounded = Math.round(avg * total)
            if (rounded !== lastDone) {
              lastDone = rounded
              counterRef.current?.update(rounded, total)
              // Push 0→50% fill for the bytes phase.
              updateFill((rounded / total) * 0.5)
            }
          }),
        ),
      )

      // ── Vehicle CPU-warm phase ────────────────────────────────────────────
      // Bytes are in cache; now drive buildVehicleIntoCache (cpuOnly=true) for
      // every vehicle so pinnedVehicleCache is fully populated before the editor
      // opens. Opening a skin pack and switching vehicles will be instant cache
      // hits, with no loading overlay and no loading beam.
      //
      // Safety: if the headless Viewport fails to init (renderer error, WebGL
      // unavailable) viewportPreloadRef stays null and we skip gracefully.
      // The editor's on-demand fallback path remains intact.
      //
      // Wait up to 4 s for the Viewport to mount and wire viewportPreloadRef.
      const WARM_READY_TIMEOUT_MS = 4000
      const WARM_TOTAL_TIMEOUT_MS = 90000 // 90 s hard ceiling across all builds
      const warmReadyStart = Date.now()
      while (!viewportPreloadRef.current && Date.now() - warmReadyStart < WARM_READY_TIMEOUT_MS) {
        await new Promise<void>(r => setTimeout(r, 50))
      }

      const buildFn = viewportPreloadRef.current
      if (buildFn) {
        // Warm ONLY the default vehicle (german, toughest non-broken) so the
        // very first editor open is instant. ConnectScreen unmounts as soon as
        // onConnected() fires (App.tsx switches phase 'connect'→'start'), so
        // the headless Viewport is torn down regardless — there is no way to
        // keep a background pump alive here. All other vehicles build lazily
        // on first open via Viewport's on-demand path, which shows no spinner
        // and keeps the old model visible during the switch. The
        // WARM_TOTAL_TIMEOUT_MS safety ceiling still applies to this single build.
        const warmStart = Date.now()
        counterRef.current?.update(0, total)
        // CPU-warm phase: push fill from 50→100%.
        updateFill(0.5)
        const defaultVehicleId = defaultVehicleForFaction('german', new Set<string>())
        const firstSpec = VEHICLES.find(v => v.id === defaultVehicleId) ?? VEHICLES[0]
        if (firstSpec && Date.now() - warmStart < WARM_TOTAL_TIMEOUT_MS) {
          await buildFn(firstSpec, 'summer', true, true).catch(() => {/* non-fatal */})
        }
        counterRef.current?.update(total, total)
        updateFill(1)
      }

      // Unmount warm Viewport — clears the GL context before the editor mounts.
      setWarmupHandle(null)

      counterRef.current?.update(total, total)
      updateFill(1)

      setPhase('success')
      // Reduced from 900 ms — the success tick animation is visually
      // apparent within ~200 ms; the remaining time was dead wait.
      await new Promise(r => setTimeout(r, 200))
      onConnected(handle, resolvedSteamInfo)
    } catch (err: unknown) {
      // Ensure the warm Viewport is unmounted on any error path.
      setWarmupHandle(null)
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
    <>
    {/* ── Headless warm Viewport ───────────────────────────────────────────
        Mounted during 'preloading' so buildVehicleIntoCache (wired via
        viewportPreloadRef) can CPU-warm all 61 vehicles into
        pinnedVehicleCache. Container is 1×1 px, opacity:0, pointer-events:none
        so it is invisible and non-interactive. NOT display:none — a zero-size
        canvas can lose its WebGL context on some drivers.
        Unmounted once warm is complete (setWarmupHandle(null)) so the GL
        context is freed before the editor's Viewport mounts. */}
    {warmupHandle && (
      <div style={{
        position: 'fixed', left: 0, top: 0,
        width: 1, height: 1,
        opacity: 0, pointerEvents: 'none',
        overflow: 'hidden', zIndex: -1,
      }}>
        <Suspense fallback={null}>
          <ViewportGuard label="Connect warmer" silent>
            <Viewport
              root={warmupHandle}
              vehicle={null}
              selectedPart={null}
              explodeAll={false}
              season="summer"
              envArchive={null}
              envName=""
              controlsEnabled={false}
              warmupOnly={true}
              preloadRef={viewportPreloadRef}
            />
          </ViewportGuard>
        </Suspense>
      </div>
    )}
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
          idle → label (beam active), loading phases → spinner only + green
          progress fill left→right (beam hidden), success → green tick,
          warning → amber warning icon.

          Green progress fill: a linear-gradient background-image fills
          the button left-to-right. During indeterminate phases
          (picking/scanning/linking-steam) an infinite CSS keyframe
          animation sweeps across; during 'preloading' the fill is driven
          from 0→100 % via a CSS custom property animated via counterRef.
          After 'success' the fill remains at 100 % until unmount. */}
      <BorderBeam colorVariant="ocean" duration={5} strength={0.85} borderRadius={16} borderWidth={1} className="bb-pressable" active={phase === 'idle'}>
        <button
          disabled={!supported || busy}
          onClick={connect}
          className="bb-connect relative w-full text-white font-semibold h-12 text-[14px] tracking-tight
                     disabled:opacity-40 disabled:cursor-not-allowed
                     focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 focus-visible:outline-none"
          style={{
            borderRadius: 16,
            cursor: busy ? 'progress' : 'pointer',
            // Base glass background — the green fill overlays this via
            // a pseudo-element or second background-image layer.
            background: busy
              ? undefined
              : 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            boxShadow: '0 1px 0 rgb(255 255 255 / 0.14) inset',
            overflow: 'hidden',
          }}
        >
          {/* Green progress fill — absolutely positioned behind the
              button content, fills left→right while busy.
              Uses a two-stop linear-gradient clipped by background-size.
              The green colour matches InlineSuccessTick: oklch(0.78 0.18 150)
              ≈ rgb(60, 178, 100) — a tasteful success-green.
              During picking/scanning/linking-steam: indeterminate sweep
              via CSS animation (bb-connect-indeterminate keyframe).
              During preloading: --bb-fill-pct drives the width (updated
              imperatively via the progressFillRef on the div).
              During success: frozen at 100 % width.
              Not shown during idle or warning. */}
          {busy && (
            <span
              aria-hidden
              data-connect-fill
              style={{
                position: 'absolute',
                top: 0, left: 0, bottom: 0,
                borderRadius: 16,
                background: 'linear-gradient(to right, oklch(0.62 0.16 150 / 0.85), oklch(0.70 0.18 150 / 0.80))',
                // Width driven by phase:
                // - picking/scanning/linking-steam: animated sweep via keyframe
                // - preloading/success: driven by CSS var set imperatively
                width: phase === 'success' ? '100%' : undefined,
                animation: (phase === 'picking' || phase === 'scanning' || phase === 'linking-steam')
                  ? 'bb-connect-indeterminate 1.6s ease-in-out infinite'
                  : undefined,
                // preloading width set via inline style on the span element
                // via a ref (progressFillRef) — avoids re-rendering ConnectScreen.
                // For success we override to 100% above.
              }}
              ref={phase === 'preloading' ? progressFillRef : undefined}
            />
          )}
          {/* Fixed-size centered container — each state is absolutely
              positioned and cross-fades via opacity only (no translateY).
              The button's h-12 height is always preserved; the inner content
              never changes height so there is no positional jump.

              Loading phases (picking/scanning/linking-steam/preloading) all
              show only the spinner — no text — per UX spec. */}
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 280, height: 24 }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 160ms ease', opacity: phase === 'idle' ? 1 : 0, pointerEvents: 'none' }}>
              Connect CoH2 install
            </span>
            {/* Spinner — shown for ALL active loading phases (picking,
                scanning, linking-steam, preloading). No text alongside it;
                the green progress fill communicates progress visually. */}
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 160ms ease', opacity: (phase === 'picking' || phase === 'scanning' || phase === 'linking-steam' || phase === 'preloading') ? 1 : 0, pointerEvents: 'none' }}>
              <InlineSpinner />
            </span>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 160ms ease', opacity: phase === 'success' ? 1 : 0, pointerEvents: 'none' }}>
              <InlineSuccessTick />
            </span>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 160ms ease', opacity: phase === 'warning' ? 1 : 0, pointerEvents: 'none' }}>
              <InlineWarningIcon />
            </span>
          </span>
        </button>
      </BorderBeam>

      {/* bb-pressable / @keyframes bb-spinner-rotate are defined
          globally in index.css. bb-connect keeps its own transition here.
          bb-connect-indeterminate sweeps a green fill left→right repeatedly
          for the indeterminate loading phases (picking/scanning/linking-steam).
          The keyframe animates `width` from 0→75% then back — giving a
          "breathing" progress feel without a false sense of completion. */}
      <style>{`
        .bb-connect {
          transition: background-color 160ms ease-out;
        }
        @keyframes bb-connect-indeterminate {
          0%   { width: 0%;   opacity: 0.9; }
          60%  { width: 75%;  opacity: 0.85; }
          100% { width: 75%;  opacity: 0.85; }
        }
      `}</style>
      {/* VehicleLoadCounter is kept in the DOM during preloading so its
          imperative handle stays live — but it's visually hidden (the progress
          is communicated via the green fill bar, not text). */}
      {phase === 'preloading' && (
        <span style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', overflow: 'hidden', width: 0, height: 0 }} aria-hidden>
          <VehicleLoadCounter total={VEHICLES.length} handleRef={counterRef} />
        </span>
      )}
    </div>
    </>
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
