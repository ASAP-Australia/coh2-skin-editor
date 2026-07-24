import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import ConnectScreen from '@/components/ConnectScreen'
import StartScreen from '@/components/StartScreen'
import SavedProjectsList from '@/components/SavedProjectsList'
import Editor from '@/components/Editor'
// FaceplateEditor is lazy-loaded to defer its module eval. A rolldown-vite
// production-chunk init-order bug throws "require_jsx_runtime is not a
// function" (minified: "g is not a function") at FaceplateEditor's EAGER
// module load, which blanks the whole app on the very first paint — every
// screen, not just the faceplate editor — because App statically imports it.
// Deferring the eval behind React.lazy() breaks that init-order cycle: the
// chunk only evaluates when the user navigates to the faceplate editor
// (rendered inside a <Suspense> boundary below), by which point the runtime
// chunk is fully initialised. Permanent fix, not a capture-only workaround —
// reverting to an eager import white-screens the shipped app.
const FaceplateEditor = lazy(() => import('@/components/FaceplateEditor'))
import DecalPackEditor from '@/components/DecalPackEditor'
import AuthShell from '@/components/AuthShell'
import WindowControls from '@/components/WindowControls'
import {
  type Coh2SkinProject,
  newProject,
  loadById as loadSkinById,
  loadActive as loadActiveProject,
  persistActive,
  readProjectFile,
} from '@/lib/project'
import {
  type Coh2FaceplateProject,
  newFaceplateProject,
  loadFaceplateById,
  readFaceplateFile,
} from '@/lib/faceplate-project'
import {
  type Coh2DecalPackProject,
  newDecalPackProject,
  loadDecalPackById,
  tryParseDecalPackFile,
} from '@/lib/decal-pack-project'
import type { DecalFaction } from '@/lib/decal-mod-templates'
import FactionChooserStep from '@/components/FactionChooserStep'
import { loadSavedHandle } from '@/lib/coh2-fs'
import { isElectron, detectInstallPath, nativePathToHandle, httpPathToHandle } from '@/lib/native-fs'
import { preloadCommonArchives } from '@/lib/preload'
import { VEHICLES, defaultVehicleForFaction, type VehicleSpec, type Faction } from '@/lib/vehicles'

// Lazy-loaded so Three.js stays out of the initial JS parse budget.
// The background warmup Viewport is only mounted after a successful Connect.
const ViewportBgWarmer = lazy(() => import('@/components/Viewport'))

// Guards the headless warmer against machines with no/broken WebGL: skips
// renderer construction (which would throw) and swallows any late throw so a
// broken GPU can never white-screen the app via the background warmer.
import ViewportGuard from '@/components/ViewportGuard'

// Audit runner — only loaded when ?audit=1 is in the URL. Lazy to keep
// Three.js out of the initial bundle when the normal app boots.
const AuditRunner = lazy(() => import('@/components/AuditRunner'))

/**
 * App routing — pre-Steam-flow rewire (May 2026).
 *
 * Top-level state machine:
 *
 *   probing → connect → start → ┬─ editor-loading → editor (skin)
 *                               │                  → faceplate
 *                               │                  → decal-pack
 *                               └─ saved-projects → (same three)
 *
 * `phase` is the single source of truth that AuthShell uses to morph
 * between its hosted screens (Connect, Start, SavedProjects, the
 * editor-loading FLIP animation). The three full-screen editors
 * (Editor / FaceplateEditor / DecalPackEditor) take over rendering
 * once we leave the AuthShell-hosted phases.
 *
 * "editor-loading" is a deliberate intermediate phase: AuthShell's
 * FLIP animation flies the ASAP wordmark from its resting top-left
 * position to the centre of the card while the editor mounts behind
 * the scenes. After the FLIP completes we swap to the editor's full-
 * screen render. This fixes the "ASAP logo stays in top-left while
 * the loading animation plays around the box" bug — the phase had
 * to be set BEFORE the parent unmounted AuthShell, not after.
 *
 * `installRoot` is the CoH2 install handle from ConnectScreen. Once
 * set it persists for the lifetime of the session; "Home" buttons in
 * the editors call `onDisconnect` which only navigates back to the
 * StartScreen, NOT back to ConnectScreen — the install handle stays
 * authorised so the user doesn't re-pick the folder on every project
 * switch.
 *
 * Faceplate / decal-pack projects live in App-level state because the
 * editors take a hydrated project object (not an id). The skin editor
 * is different — it reads `loadActive()` from localStorage, so we
 * `persistActive(project)` before navigating to it.
 */

type Phase =
  | 'probing'
  | 'connect'
  | 'start'
  | 'saved-projects'
  | 'editor-loading'
  | 'editor'
  | 'faceplate'
  | 'decal-pack'
  | 'faction-chooser-skin'
  | 'faction-chooser-decal'

// EDITOR_LOADING_MS and EDITOR_LOADING_MIN_MS removed (Phase 3 — F2c/F1/F3):
// faceplate/decal-pack open directly via withViewTransition; skin editor uses
// onReady-driven setPhase('editor') with no minimum hold.

/**
 * Wraps a synchronous state-update callback in the View Transitions API
 * if the browser supports it (Electron 41+) and the user hasn't requested
 * reduced motion. Falls back to calling the callback directly so the logic
 * is identical in all environments.
 *
 * Used for top-level screen swaps (e.g. editor → start, connect → start)
 * so they receive the global slide-up-out / slide-down-in keyframes from
 * index.css rather than being hard cuts.
 */
function withViewTransition(update: () => void): void {
  if (
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    typeof document.startViewTransition === 'function'
  ) {
    document.startViewTransition(update)
  } else {
    update()
  }
}

// ── Audit gate: check at module load time, before hooks ───────────────────
const IS_AUDIT_MODE = new URLSearchParams(location.search).get('audit') === '1'

// ── Archive warmup guard ───────────────────────────────────────────────────
// Module-level so StrictMode's double-invocation of effects doesn't fire two
// parallel warmup runs for the same root. Reset to null when root changes.
let _warmedRoot: FileSystemDirectoryHandle | null = null

export default function App() {
  const [installRoot, setInstallRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [phase, setPhase] = useState<Phase>(() => {
    // Synchronous flags that can be resolved on first render without any async work.
    const sParams = new URLSearchParams(location.search)
    if (sParams.get('screenshot') === '1') return 'connect'
    // Electron: start as 'probing' so the async auto-detect runs before
    // anything is shown. The useEffect below resolves to 'start' (detected)
    // or 'connect' (not found). Headless mode also starts here and the effect
    // handles it. The old hard-coded 'connect' caused ConnectScreen to flash
    // even when auto-detect would succeed.
    if (isElectron()) return 'probing'
    return 'probing'
  })
  /** Hydrated faceplate project, set just before navigating into the
   *  faceplate editor. Cleared on back-to-start. */
  const [faceplateProject, setFaceplateProject] = useState<Coh2FaceplateProject | null>(null)
  /** Hydrated decal-pack project, set just before navigating into the
   *  decal-pack editor. Cleared on back-to-start. */
  const [decalPackProject, setDecalPackProject] = useState<Coh2DecalPackProject | null>(null)
  /** Faction chosen in the faction-chooser step (faction-first new-pack flow),
   *  carried into the skin editor mount. null = no chooser pick (legacy flow). */
  const [chosenFaction, setChosenFaction] = useState<Faction | null>(null)
  /** Pending-load error surfaced above the AuthShell-hosted screens when
   *  a project file fails to open (corrupt JSON, unrecognised extension,
   *  unknown saved id, etc.). Dismissed explicitly by the user. */
  const [loadError, setLoadError] = useState<string | null>(null)

  const diskFileInputRef = useRef<HTMLInputElement>(null)

  // ── Background vehicle warmer ─────────────────────────────────────────────
  // After Connect completes, a headless warmupOnly Viewport is kept alive at
  // App level (outside all phase-conditional renders) to fill pinnedVehicleCache
  // for every vehicle that ConnectScreen didn't warm. ConnectScreen only warmed
  // the default 'elefant' before transitioning, so the remaining ~60 vehicles
  // would show a build delay on first selection without this background fill.
  //
  // The handle drives the hidden Viewport JSX below; set to null to unmount and
  // free the GL context once all vehicles are cached.
  const [bgWarmupHandle, setBgWarmupHandle] = useState<FileSystemDirectoryHandle | null>(null)
  // Ref wired to the headless Viewport's buildVehicleIntoCache function.
  const bgWarmupPreloadRef = useRef<((spec: VehicleSpec, season: 'summer' | 'winter', eager?: boolean, cpuOnly?: boolean) => Promise<void>) | null>(null)
  // Guard: only start one warmer per install-root.
  const bgWarmupFiredRef = useRef<FileSystemDirectoryHandle | null>(null)

  // Mark body so CSS can shift top-anchored chrome below the WindowControls pill.
  useEffect(() => {
    if (isElectron()) document.body.classList.add('is-electron')
    return () => document.body.classList.remove('is-electron')
  }, [])

  // Background archive warmup — once a CoH2 install is connected, open the
  // common SGAs in the background so the FIRST vehicle load isn't cold (it
  // would otherwise open ~10 archives serially on first click). Fire-and-
  // forget; never blocks the UI. `_warmedRoot` (module-level) guards against
  // StrictMode's double effect invocation for the same root.
  useEffect(() => {
    if (!installRoot || _warmedRoot === installRoot) return
    _warmedRoot = installRoot
    const root = installRoot
    const warm = () => { void preloadCommonArchives(root).catch(() => {}) }
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }).requestIdleCallback
    if (ric) ric(warm, { timeout: 2000 })
    else window.setTimeout(warm, 400)
  }, [installRoot])

  // Background vehicle warmer — idle-paced pump that fills pinnedVehicleCache
  // for all vehicles after ConnectScreen transitions to 'start'. Runs in a
  // concurrency-limited (LANES≈3) requestIdleCallback loop so it yields to
  // any UI interaction happening in parallel.
  //
  // Starts once bgWarmupHandle is set (triggered by onConnected) and a
  // buildVehicleIntoCache function is available via bgWarmupPreloadRef (wired
  // by the headless Viewport rendered below). The effect waits up to 4 s for
  // the preloadRef to be populated (Viewport lazy-loads Three.js), then drives
  // the pump. Tears down the headless Viewport via setBgWarmupHandle(null)
  // when all vehicles are cached or on abort.
  useEffect(() => {
    if (!bgWarmupHandle) return
    if (bgWarmupFiredRef.current === bgWarmupHandle) return
    bgWarmupFiredRef.current = bgWarmupHandle

    // The default vehicle warmed by ConnectScreen — on the Electron auto-detect
    // path ConnectScreen never runs, so elefant is never pre-warmed. Promote it
    // to the front so "New Skin" (which always opens elefant) gets a cache hit.
    const defaultId = defaultVehicleForFaction('german', new Set<string>())
    // Also promote the last-used vehicle from the active project so "Continue"
    // is guaranteed to hit the cache before the user can click it.
    const activeLastVehicleId: string | null = (() => {
      try { return loadActiveProject()?.lastVehicleId ?? null } catch { return null }
    })()
    // Build a dedup'd list of priority ids (filter falsy, then dedup).
    const priorityIds = Array.from(
      new Set([defaultId, activeLastVehicleId].filter((id): id is string => !!id))
    )
    const priorityVehicles = priorityIds
      .map(id => VEHICLES.find(v => v.id === id))
      .filter((v): v is typeof VEHICLES[number] => v !== undefined)
    // Remaining vehicles in VEHICLES array order, excluding already-prioritised ids.
    const rest = VEHICLES.filter(v => !priorityIds.includes(v.id))
    const remaining = [...priorityVehicles, ...rest]

    let aborted = false
    const LANES = 3

    const pump = async (): Promise<void> => {
      // Wait up to 4 s for the headless Viewport to mount and wire the preloadRef.
      const deadline = Date.now() + 4000
      while (!bgWarmupPreloadRef.current && Date.now() < deadline) {
        await new Promise<void>(r => setTimeout(r, 50))
      }
      const buildFn = bgWarmupPreloadRef.current
      if (!buildFn || aborted) { setBgWarmupHandle(null); return }

      // Idle-paced concurrency-limited warm: dispatch LANES builds at a time,
      // each wrapped in a requestIdleCallback so they yield to user interaction.
      // cpuOnly=true (last arg): background builds skip GPU compile, which
      // cannot transfer across GL contexts anyway — the editor's own Viewport
      // will GPU-compile on first actual display.
      const warmOne = (spec: VehicleSpec): Promise<void> =>
        new Promise<void>(resolve => {
          const ric = (window as unknown as {
            requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number
          }).requestIdleCallback
          const run = () => {
            if (aborted) { resolve(); return }
            buildFn(spec, 'summer', false, true)
              .catch(() => {/* non-fatal */})
              .finally(resolve)
          }
          if (ric) ric(run, { timeout: 2000 })
          else window.setTimeout(run, 100)
        })

      for (let i = 0; i < remaining.length && !aborted; i += LANES) {
        const batch = remaining.slice(i, i + LANES)
        await Promise.all(batch.map(warmOne))
      }

      // All warmed (or aborted). Tear down the headless Viewport to free GL context.
      if (!aborted) setBgWarmupHandle(null)
    }

    void pump()
    return () => { aborted = true }
  }, [bgWarmupHandle])

  // Boot: probe for a saved handle / Electron auto-detect / screenshot
  // harness flags, then settle on the appropriate first phase.
  // Note: synchronous phase initialization (screenshot/Electron) is handled
  // in the useState lazy initializer above; this effect only handles async probing.
  useEffect(() => {
    // Tell Electron the React tree has painted so it can reveal the window
    // immediately (otherwise main.ts waits out a 6s safety timeout). Two rAFs
    // ensures we're past the first committed paint.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { window.electronAPI?.signalRendererReady?.() } catch { /* non-electron */ }
    }))

    const sParams = new URLSearchParams(location.search)
    if (sParams.get('screenshot') === '1') {
      // Already set to 'connect' via lazy useState initializer — nothing async to do.
      return
    }
    if (isElectron() && sParams.get('headless') === 'editor') {
      // Headless harness wants to land directly in the skin editor.
      detectInstallPath()
        .then(p => {
          if (p) {
            setInstallRoot(nativePathToHandle(p))
            setPhase('editor')
          } else {
            setPhase('connect')
          }
        })
        .catch(() => setPhase('connect'))
      return
    }
    if (isElectron()) {
      // Desktop: auto-detect the CoH2 install and skip ConnectScreen entirely.
      // Fall back to ConnectScreen only when detection fails (install not found
      // or Steam not accessible). The Steam-check inside ConnectScreen still
      // gates the real 'linking-steam' step; we skip the VISUAL screen, not
      // the Steam handshake — ConnectScreen.connect() is still called via
      // onConnected from the ConnectScreen when the user retries after an error.
      //
      // NOTE: We go to 'connect' here so ConnectScreen auto-fires its connect()
      // logic on mount. To truly bypass the button-click we set phase to
      // 'auto-connecting' and handle it below.
      detectInstallPath()
        .then(p => {
          if (p) {
            // Auto-detected: skip ConnectScreen UI and jump straight to start.
            // The Steam init and archive preload that ConnectScreen normally
            // does are deferred — ConnectScreen performs those on user click,
            // but here we go straight to 'start'. Steam is still initialised
            // lazily by the rest of the app when needed (Workshop publishing etc).
            setInstallRoot(nativePathToHandle(p))
            setBgWarmupHandle(nativePathToHandle(p))
            setPhase('start')
          } else {
            // Install not found — show ConnectScreen for manual pick.
            setPhase('connect')
          }
        })
        .catch(() => setPhase('connect'))
      return
    }
    // Browser: first try the /__coh2/detect dev bridge (DEV only), then
    // fall back to the saved File System Access handle, then ConnectScreen.
    if (import.meta.env.DEV) {
      fetch('/__coh2/detect')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((data: { installPath: string }) => {
          if (data?.installPath) {
            const h = httpPathToHandle(data.installPath)
            setInstallRoot(h)
            setBgWarmupHandle(h)
            setPhase('start')
          } else {
            return Promise.reject()
          }
        })
        .catch(() => {
          // Bridge unavailable — fall back to saved handle then ConnectScreen.
          loadSavedHandle()
            .then(h => {
              if (h) {
                setInstallRoot(h)
                setPhase('start')
              } else {
                setPhase('connect')
              }
            })
            .catch(() => setPhase('connect'))
        })
      return
    }
    // Browser production: try the saved File System Access handle.
    loadSavedHandle()
      .then(h => {
        if (h) {
          setInstallRoot(h)
          setPhase('start')
        } else {
          setPhase('connect')
        }
      })
      .catch(() => setPhase('connect'))
  }, [])

  // ── Open-project routing helpers ─────────────────────────────────────
  //
  // Skin editor: sets phase='editor-loading', Editor mounts invisibly,
  // onReady fires immediately on first model load → setPhase('editor').
  // Faceplate/decal-pack: wrapped in withViewTransition for a smooth slide.

  const openSkin = (project: Coh2SkinProject) => {
    persistActive(project)
    // Open the skin editor DIRECTLY — same as faceplate/decal-pack. No
    // intermediate 'editor-loading' card; the Viewport loads the vehicle
    // in place inside the already-visible editor.
    withViewTransition(() => setPhase('editor'))
  }

  const openFaceplate = (project: Coh2FaceplateProject) => {
    setFaceplateProject(project)
    withViewTransition(() => setPhase('faceplate'))
  }

  const openDecalPack = (project: Coh2DecalPackProject) => {
    setDecalPackProject(project)
    withViewTransition(() => setPhase('decal-pack'))
  }

  // ── Saved-projects → load by id helpers ──────────────────────────────

  const pickSavedSkin = (id: string) => {
    const p = loadSkinById(id)
    if (!p) {
      setLoadError(`Could not load skin pack "${id}".`)
      return
    }
    openSkin(p)
  }
  const pickSavedFaceplate = (id: string) => {
    const p = loadFaceplateById(id)
    if (!p) {
      setLoadError(`Could not load faceplate "${id}".`)
      return
    }
    openFaceplate(p)
  }
  const pickSavedDecalPack = (id: string) => {
    const p = loadDecalPackById(id)
    if (!p) {
      setLoadError(`Could not load decal pack "${id}".`)
      return
    }
    openDecalPack(p)
  }

  // ── Disk-picker fallback (SavedProjectsList.onPickFromDisk) ──────────
  //
  // Hidden <input type="file"> driven by ref. Accepts any of the three
  // project formats and routes based on parsed content. Same shape as
  // the StartScreen's internal file picker, hoisted here so we have a
  // single source of truth for the load flow.

  const onDiskFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const lower = file.name.toLowerCase()
    try {
      if (lower.endsWith('.coh2faceplate')) {
        openFaceplate(await readFaceplateFile(file))
        return
      }
      if (lower.endsWith('.coh2decalpack')) {
        const text = await file.text()
        const parsed = tryParseDecalPackFile(text)
        if (!parsed) {
          setLoadError(`"${file.name}" is not a valid .coh2decalpack file.`)
          return
        }
        openDecalPack(parsed)
        return
      }
      if (lower.endsWith('.coh2skin') || lower.endsWith('.json')) {
        // Try skin → faceplate → decal pack in order.
        try {
          openSkin(await readProjectFile(file))
          return
        } catch {
          /* try faceplate */
        }
        try {
          openFaceplate(await readFaceplateFile(file))
          return
        } catch {
          /* try decal pack */
        }
        try {
          const text = await file.text()
          const parsed = tryParseDecalPackFile(text)
          if (parsed) {
            openDecalPack(parsed)
            return
          }
        } catch {
          /* fall through */
        }
        setLoadError(
          `"${file.name}" is not a valid .coh2skin, .coh2faceplate, or .coh2decalpack file.`,
        )
        return
      }
      setLoadError(
        `"${file.name}" has an unrecognised extension — expected .coh2skin, .coh2faceplate, or .coh2decalpack.`,
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }

  const triggerDiskPicker = () => diskFileInputRef.current?.click()


  // ── Render ───────────────────────────────────────────────────────────

  // Audit mode: ?audit=1 → bypass normal app, mount real-pipeline audit runner.
  if (IS_AUDIT_MODE) {
    return (
      <Suspense fallback={<div style={{ color: '#666', fontFamily: 'monospace', padding: 24 }}>Loading audit runner…</div>}>
        <AuditRunner />
      </Suspense>
    )
  }

  // ── Background warmer Viewport ───────────────────────────────────────────
  // Rendered whenever bgWarmupHandle is set (Connect→onwards). Identical in
  // setup to ConnectScreen's headless warm Viewport: 1×1 px, opacity 0,
  // warmupOnly=true, wired via bgWarmupPreloadRef. Survives all phase
  // transitions because it lives at App level, outside phase-conditional renders.
  // Torn down (bgWarmupHandle→null) once the pump finishes or unmounts.
  const bgWarmerNode = bgWarmupHandle ? (
    <div style={{
      position: 'fixed', left: 0, top: 0,
      width: 1, height: 1,
      opacity: 0, pointerEvents: 'none',
      overflow: 'hidden', zIndex: -1,
    }}>
      <Suspense fallback={null}>
        <ViewportGuard label="Background warmer" silent>
          <ViewportBgWarmer
            root={bgWarmupHandle}
            vehicle={null}
            selectedPart={null}
            explodeAll={false}
            season="summer"
            envArchive={null}
            envName=""
            controlsEnabled={false}
            warmupOnly={true}
            preloadRef={bgWarmupPreloadRef}
          />
        </ViewportGuard>
      </Suspense>
    </div>
  ) : null

  // ── AuthShell-hosted panel (connect / start / saved-projects / probing / editor-loading) ──
  const inAuthShell =
    phase === 'probing' ||
    phase === 'connect' ||
    phase === 'start' ||
    phase === 'saved-projects' ||
    phase === 'editor-loading' ||
    phase === 'faction-chooser-skin' ||
    phase === 'faction-chooser-decal'

  let panel: React.ReactNode = null
  if (phase === 'connect') {
    panel = (
      <ConnectScreen
        onConnected={h => {
          setInstallRoot(h)
          setBgWarmupHandle(h)
          setPhase('start')
        }}
      />
    )
  } else if (phase === 'start') {
    panel = (
      <StartScreen
        onContinueSkin={openSkin}
        onNewSkin={() => {
          try {
            localStorage.removeItem('coh2-skin-active-project')
          } catch {
            /* ignore */
          }
          setChosenFaction(null)
          withViewTransition(() => setPhase('faction-chooser-skin'))
        }}
        onNewFaceplate={() => openFaceplate(newFaceplateProject())}
        onNewDecalPack={() => withViewTransition(() => setPhase('faction-chooser-decal'))}
        onLoadSkin={openSkin}
        onLoadFaceplate={openFaceplate}
        onLoadDecalPack={openDecalPack}
        onOpenRecentFaceplate={openFaceplate}
        onOpenRecentDecalPack={openDecalPack}
        onShowSavedProjects={() => setPhase('saved-projects')}
      />
    )
  } else if (phase === 'faction-chooser-skin') {
    panel = (
      <FactionChooserStep
        title="Which faction?"
        subtitle="Pick the army your skin belongs to."
        onBack={() => withViewTransition(() => setPhase('start'))}
        onPick={f => {
          setChosenFaction(f)
          withViewTransition(() => setPhase('editor'))
        }}
      />
    )
  } else if (phase === 'faction-chooser-decal') {
    panel = (
      <FactionChooserStep
        title="Which faction?"
        subtitle="Pick the army this decal pack is for."
        onBack={() => withViewTransition(() => setPhase('start'))}
        onPick={f => {
          // Faction and DecalFaction share the same string literals; all 5 skin
          // factions are valid DecalFaction members (decal-mod-templates.ts:32).
          openDecalPack(newDecalPackProject('My Decal Pack', f as DecalFaction))
        }}
      />
    )
  } else if (phase === 'saved-projects') {
    panel = (
      <SavedProjectsList
        onPickSkin={pickSavedSkin}
        onPickFaceplate={pickSavedFaceplate}
        onPickDecalPack={pickSavedDecalPack}
        onBack={() => setPhase('start')}
        onPickFromDisk={triggerDiskPicker}
      />
    )
  } else if (phase === 'probing') {
    panel = (
      <div className="text-[12px] text-[var(--color-text-3)] tracking-[2px] uppercase">
        Loading…
      </div>
    )
  }
  // phase === 'editor-loading' → panel = null; AuthShell runs FLIP morph.

  // Unified return tree — ONE stable <Editor> element whose position in
  // the tree is fixed. Prevents React unmount/remount at the editor-loading
  // → editor phase flip (which was causing double Viewport re-init).
  //
  // glass-frame: the outermost wrapper that provides the glass border,
  //   20 px corner radius, squircle corner-shape, and reference box-shadow.
  //   The window is OPAQUE (transparent:false) and body paints a dark
  //   surround (#1a1a1a), so this renders as a glass CARD floating on a
  //   dark page — matching the lab01.dev reference.
  // glass-frame-inner: clips child content at 16 px radius so app chrome
  //   doesn't bleed past the glass ring; carries the #0D0D0D dark background
  //   and the inset white-/15 ring. Its FIRST child is a blurred spotlight
  //   (the light source that sells the glass); the app content sits in a
  //   relative z-10 wrapper above it.
  return (
    <div className="glass-frame">
    <div className="glass-frame-inner">
      {/* Spotlight — soft top-left light source behind the app content.
          aria-hidden background layer; app content (below) sits above via
          its own stacking context (relative + z-10). */}
      <span
        aria-hidden="true"
        className="rounded-full"
        style={{
          position: 'absolute',
          width: 320,
          height: 320,
          borderRadius: 9999,
          background: '#fff',
          left: -160,
          top: -160,
          filter: 'blur(100px)',
          mixBlendMode: 'overlay',
          opacity: 0.3,
          pointerEvents: 'none',
        }}
      />
      {/* Inset glass edge — rendered ABOVE the app content (z-60) so the
          full-bleed background can't paint over it. This is the reference's
          "inset-ring on an overlay div" technique: an inset box-shadow on
          glass-frame-inner itself sits UNDER the content and gets covered, so
          the crisp 1px white edge looks missing. borderRadius matches the
          inner panel; corner-shape (global) makes it follow the squircle. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 16,
          pointerEvents: 'none',
          zIndex: 60,
          boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.15)',
        }}
      />
      <div className="relative z-10 w-full h-full">
      <WindowControls />
      {loadError && (
        <div
          className="fixed top-10 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full px-3.5 py-2.5 rounded-2xl border border-red-400/25 bg-red-500/[0.06] text-[12px] text-red-200/90 leading-relaxed flex items-start gap-2"
          role="alert"
        >
          <span className="flex-1 whitespace-pre-line">{loadError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setLoadError(null)}
            className="shrink-0 text-red-200/60 hover:text-red-200/90 transition-colors leading-none"
          >
            ✕
          </button>
        </div>
      )}
      {inAuthShell && <AuthShell phase={phase}>{panel}</AuthShell>}
      {/* Single persistent Editor element. Mounts as soon as editor-loading
          begins (hidden via visible=false) so the Viewport warms up behind
          the AuthShell FLIP animation. Stays mounted as visible=true once
          the editor phase is active. Stable tree position = no remount. */}
      {phase === 'editor' && installRoot && (
        <Editor
          root={installRoot}
          initialFaction={chosenFaction ?? undefined}
          initialProject={chosenFaction ? newProject('My Skin Pack', chosenFaction) : undefined}
          onDisconnect={() => withViewTransition(() => setPhase('start'))}
          onClosePack={() => withViewTransition(() => setPhase('start'))}
          visible={true}
        />
      )}
      {phase === 'faceplate' && faceplateProject && (
        <Suspense fallback={null}>
          <FaceplateEditor
            project={faceplateProject}
            onBack={() =>
              withViewTransition(() => {
                setFaceplateProject(null)
                setPhase('start')
              })
            }
          />
        </Suspense>
      )}
      {phase === 'decal-pack' && decalPackProject && (
        <DecalPackEditor
          project={decalPackProject}
          onBack={() =>
            withViewTransition(() => {
              setDecalPackProject(null)
              setPhase('start')
            })
          }
          installRoot={installRoot}
        />
      )}
      <input
        ref={diskFileInputRef}
        type="file"
        accept=".coh2skin,.coh2faceplate,.coh2decalpack,.json"
        onChange={onDiskFile}
        className="hidden"
        aria-label="Open project file from disk"
      />
      {bgWarmerNode}
      </div>
    </div>
    </div>
  )
}
