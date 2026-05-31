import { useEffect, useRef, useState } from 'react'
import ConnectScreen from '@/components/ConnectScreen'
import StartScreen from '@/components/StartScreen'
import SavedProjectsList from '@/components/SavedProjectsList'
import Editor from '@/components/Editor'
import FaceplateEditor from '@/components/FaceplateEditor'
import DecalPackEditor from '@/components/DecalPackEditor'
import AuthShell from '@/components/AuthShell'
import WindowControls from '@/components/WindowControls'
import {
  type Coh2SkinProject,
  loadById as loadSkinById,
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
import { loadSavedHandle } from '@/lib/coh2-fs'
import { isElectron, detectInstallPath, nativePathToHandle } from '@/lib/native-fs'
import { lazy, Suspense } from 'react'

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

/** Time we hold the editor-loading FLIP before swapping in the real
 *  editor surface. Tuned to overlap AuthShell.IN_MS (520) + the icon
 *  morph (~600 ms) so the user perceives a continuous "logo flies to
 *  centre → world opens behind it" motion rather than a hard cut. */
const EDITOR_LOADING_MS = 1200

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

export default function App() {
  const [installRoot, setInstallRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [phase, setPhase] = useState<Phase>(() => {
    // Synchronous flags that can be resolved on first render without any async work.
    const sParams = new URLSearchParams(location.search)
    if (sParams.get('screenshot') === '1') return 'connect'
    if (isElectron()) return 'connect'
    return 'probing'
  })
  /** Hydrated faceplate project, set just before navigating into the
   *  faceplate editor. Cleared on back-to-start. */
  const [faceplateProject, setFaceplateProject] = useState<Coh2FaceplateProject | null>(null)
  /** Hydrated decal-pack project, set just before navigating into the
   *  decal-pack editor. Cleared on back-to-start. */
  const [decalPackProject, setDecalPackProject] = useState<Coh2DecalPackProject | null>(null)
  /** Pending-load error surfaced above the AuthShell-hosted screens when
   *  a project file fails to open (corrupt JSON, unrecognised extension,
   *  unknown saved id, etc.). Dismissed explicitly by the user. */
  const [loadError, setLoadError] = useState<string | null>(null)

  const diskFileInputRef = useRef<HTMLInputElement>(null)

  // Mark body so CSS can shift top-anchored chrome below the WindowControls pill.
  useEffect(() => {
    if (isElectron()) document.body.classList.add('is-electron')
    return () => document.body.classList.remove('is-electron')
  }, [])

  // Boot: probe for a saved handle / Electron auto-detect / screenshot
  // harness flags, then settle on the appropriate first phase.
  // Note: synchronous phase initialization (screenshot/Electron) is handled
  // in the useState lazy initializer above; this effect only handles async probing.
  useEffect(() => {
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
      // Desktop: already set to 'connect' via lazy useState initializer — nothing to do.
      return
    }
    // Browser: try the saved File System Access handle. If it's still
    // authorised, skip Connect and land on StartScreen.
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
  // Each handler sets phase='editor-loading' SYNCHRONOUSLY before the
  // setTimeout that flips into the destination phase. AuthShell sees
  // the phase change immediately and starts the FLIP icon morph; by
  // the time EDITOR_LOADING_MS elapses the ASAP wordmark has settled
  // at the card's centre and the editor swap reads as continuous
  // motion rather than a cut.

  const openSkin = (project: Coh2SkinProject) => {
    persistActive(project)
    setPhase('editor-loading')
    window.setTimeout(() => setPhase('editor'), EDITOR_LOADING_MS)
  }

  const openFaceplate = (project: Coh2FaceplateProject) => {
    setFaceplateProject(project)
    setPhase('editor-loading')
    window.setTimeout(() => setPhase('faceplate'), EDITOR_LOADING_MS)
  }

  const openDecalPack = (project: Coh2DecalPackProject) => {
    setDecalPackProject(project)
    setPhase('editor-loading')
    window.setTimeout(() => setPhase('decal-pack'), EDITOR_LOADING_MS)
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

  // Probing or no install yet → AuthShell-hosted phases (connect /
  // start / saved-projects / editor-loading).
  const inAuthShell =
    phase === 'probing' ||
    phase === 'connect' ||
    phase === 'start' ||
    phase === 'saved-projects' ||
    phase === 'editor-loading'

  if (inAuthShell) {
    let panel: React.ReactNode = null

    if (phase === 'connect') {
      panel = (
        <ConnectScreen
          onConnected={h => {
            setInstallRoot(h)
            setPhase('start')
          }}
        />
      )
    } else if (phase === 'start') {
      panel = (
        <StartScreen
          onContinueSkin={openSkin}
          onNewSkin={() => {
            // The skin editor reads `loadActive()` on mount; clearing
            // the active-id pointer lets its `loadActive() ?? newProject()`
            // fallback create a fresh pack. Wrapped in try/catch so a
            // storage exception (e.g. private-mode quota) doesn't block
            // the user from starting a new pack.
            try {
              localStorage.removeItem('coh2-skin-active-project')
            } catch {
              /* ignore */
            }
            setPhase('editor-loading')
            window.setTimeout(() => setPhase('editor'), EDITOR_LOADING_MS)
          }}
          onNewFaceplate={() => openFaceplate(newFaceplateProject())}
          onNewDecalPack={() => openDecalPack(newDecalPackProject())}
          onLoadSkin={openSkin}
          onLoadFaceplate={openFaceplate}
          onLoadDecalPack={openDecalPack}
          onOpenRecentFaceplate={openFaceplate}
          onOpenRecentDecalPack={openDecalPack}
          onShowSavedProjects={() => setPhase('saved-projects')}
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
    // phase === 'editor-loading' → panel stays as last rendered panel
    // would be ideal, but AuthShell already retains the outgoing snapshot
    // via its internal `pending` ref. We pass `null` here; AuthShell
    // hides the panel body and runs the FLIP morph on the icon. This
    // is the explicit "logo flies to centre" moment.

    return (
      <>
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
        <AuthShell phase={phase}>{panel}</AuthShell>
        <input
          ref={diskFileInputRef}
          type="file"
          accept=".coh2skin,.coh2faceplate,.coh2decalpack,.json"
          onChange={onDiskFile}
          className="hidden"
          aria-label="Open project file from disk"
        />
      </>
    )
  }

  // Full-screen editors — replace AuthShell entirely.
  if (phase === 'editor' && installRoot) {
    return (
      <>
        <WindowControls />
        <Editor
          root={installRoot}
          onDisconnect={() => withViewTransition(() => setPhase('start'))}
        />
      </>
    )
  }
  if (phase === 'faceplate' && faceplateProject) {
    return (
      <>
        <WindowControls />
        <FaceplateEditor
          project={faceplateProject}
          onBack={() =>
            withViewTransition(() => {
              setFaceplateProject(null)
              setPhase('start')
            })
          }
        />
      </>
    )
  }
  if (phase === 'decal-pack' && decalPackProject) {
    return (
      <>
        <WindowControls />
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
      </>
    )
  }

  // Fallback — should not reach here in practice. If we do, kick back
  // to the connect phase so the user can recover.
  return (
    <>
      <WindowControls />
      <AuthShell phase="connect">
        <ConnectScreen
          onConnected={h => {
            setInstallRoot(h)
            setPhase('start')
          }}
        />
      </AuthShell>
    </>
  )
}
