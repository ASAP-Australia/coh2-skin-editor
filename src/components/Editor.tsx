import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useDecalHistory } from '@/lib/decal-history'
const Viewport = lazy(() => import('./Viewport'))
import TopBar from './TopBar'
import ScenePanel from './ScenePanel'
import FactionPanel from './FactionPanel'
import VehicleMenu, { type VehicleIconResolver } from './VehicleMenu'
import TemplateDecalPills from './TemplateDecalPills'
import SeasonToggle from './SeasonToggle'
import ExplodeButton from './ExplodeButton'
import EditTextureButton from './EditTextureButton'
import VehicleTextureEditor from './VehicleTextureEditor'
import { extractBodyUvWireframe } from '@/lib/uv-wireframe'
import ShortcutHelpSheet from './ShortcutHelpSheet'
import OnboardingOverlay from './OnboardingOverlay'
import { SlotIconEditor } from './SlotIconEditor'
import { useToasts } from './Toasts'
import { VEHICLES, FACTIONS, vehiclesForFaction, defaultVehicleForFaction, type Faction } from '@/lib/vehicles'
import {
  type Coh2SkinProject,
  type Decal,
  type DecalType,
  newProject,
  getOrInitVehicle,
  getOrInitFactionDefault,
  persistActive,
  loadActive,
  addImageFromFile,
  syncLiveStateToActiveSlot,
  loadSlotIntoLiveState,
  effectiveCamoPreset,
  effectiveCustomDiffuseUrl,
} from '@/lib/project'
import { paintDecals, type RenderContext } from '@/lib/decal-painter'
import {
  DEFAULT_BRUSH,
  paintBrushDab,
  paintBrushSegment,
  samplePixel,
  type BrushSettings,
} from '@/lib/brush'
// (relTime removed with bottom-right "saved Xs ago" indicator)
import { SgaArchive } from '@/lib/sga'
import { scheduleLiveSync } from '@/lib/live-sync'
import { generateCamo, type CamoPreset } from '@/lib/camo-generator'
// vehicle-3d-renderer is dynamically imported so its Three.js dependency
// doesn't land in the main chunk — it's only needed after the editor mounts.
// The import() call is placed inside the useEffect below so bundlers see it
// as a code-split boundary rather than a static dep.
import { type PresetId, SCENE_PRESETS, loadPresetId, persistPresetId } from '@/lib/scene-settings'
import { schedulePrefetch } from '@/lib/preload'
import { resolveVehicleIcon } from '@/lib/vehicle-icons'
import { loadDecalPackById } from '@/lib/decal-pack-project'
import { rasteriseDecal } from '@/lib/decal-pack-export'
import { bakeDecalOntoDiffuse } from '@/lib/king-tiger-decal-bake'
import { resolveDecalUvRect } from '@/lib/vehicle-uv-registry'
import type { RgmMesh } from '@/lib/rgm'

// Models with known parser defects (packed-stride RGM variants where every
// submesh is skipped → empty viewport). Verified 2026-06-02 via
// tools/check-submeshes.ts against the real CoH2 SGAs: tiger=75 submeshes,
// king_tiger_sdkfz_182=4 submeshes — both render fine. Set is empty until
// a genuinely-broken (0-submesh) model is found.
const BROKEN_MODELS = new Set<string>([])

// Safe starting vehicle per faction — toughest renderable vehicle per
// faction, computed from vehiclesForFaction (sorted heavy→light) skipping
// any BROKEN_MODELS entries. Hoisted so the computation runs once.
const FACTION_DEFAULT_VEHICLE: Record<import('@/lib/vehicles').Faction, string> = {
  german:      defaultVehicleForFaction('german',      BROKEN_MODELS),
  west_german: defaultVehicleForFaction('west_german', BROKEN_MODELS),
  soviet:      defaultVehicleForFaction('soviet',      BROKEN_MODELS),
  aef:         defaultVehicleForFaction('aef',         BROKEN_MODELS),
  british:     defaultVehicleForFaction('british',     BROKEN_MODELS),
}

interface Props {
  root: FileSystemDirectoryHandle
  onDisconnect: () => void
  /** "Close pack" — drops the current pack/faction state and routes the
   *  user back to StartScreen so they can pick another pack or start a
   *  new one. Distinct from `onDisconnect` (which un-authorises the install
   *  itself and sends them to ConnectScreen). */
  onClosePack?: () => void
  /** Optional override for the initial project state. When provided, this
   *  takes precedence over `loadActive()`. The new-project flow passes
   *  the freshly-built project here so the editor opens with the user's
   *  name/description/author already in place. */
  initialProject?: Coh2SkinProject
  /** Initial vehicle faction — used to seed the bottom row with the
   *  chosen faction's vehicles. If omitted, falls back to whatever the
   *  project's lastVehicleId resolves to. */
  initialFaction?: Faction
  /** When false, the Editor renders with opacity 0 + pointer-events
   *  none so it can mount invisibly behind a loading-state AuthShell
   *  while the Viewport warms up. Defaults to true. */
  visible?: boolean
  /** Fires exactly once, on the FIRST `onModelLoaded` callback from the
   *  Viewport. Used by App.tsx to detect when the editor-loading state
   *  has produced a fully-rendered first vehicle and it's safe to
   *  unmount the loading-state AuthShell. */
  onReady?: () => void
}

export default function Editor({
  root,
  onDisconnect,
  onClosePack,
  initialProject,
  initialFaction,
  visible = true,
  onReady,
}: Props) {
  const { api: toast, node: toastNode } = useToasts()
  const [project, setProject] = useState<Coh2SkinProject>(
    () => initialProject ?? loadActive() ?? newProject('My Skin Pack'),
  )

  // ---- undo/redo history — declared early so applyDecalImage and other
  // callbacks defined before the decal-helpers block can call history.commit().
  // The refs are assigned on every render so getters are always current.
  const projectRef = useRef<Coh2SkinProject>(null as unknown as Coh2SkinProject)
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern: ref is updated every render so callbacks always see current project without stale closures
  projectRef.current = project
  // vehicleIdRef is populated below once vehicleId state is available;
  // we declare the ref here and assign it at the vehicleId declaration site.
  const vehicleIdRef = useRef<string>('')
  const history = useDecalHistory(
    useCallback(() => projectRef.current, []),
    setProject,
    useCallback(() => vehicleIdRef.current, []),
  )

  const [season, setSeason] = useState<'summer' | 'winter'>('summer')
  // Default to Brummbär — both Tiger I and King Tiger have a packed-stride
  // RGM variant the parser doesn't handle yet (every submesh skipped →
  // empty viewport that reads as "the app is broken" to a first-time user).
  // Brummbär is a well-tested model. Users can still pick Tiger from the
  // nav and (when the parser ships) it will start working. We also clobber
  // any persisted lastVehicleId pointing at known-broken models so
  // returning users don't get a grey-blocks viewport.
  //
  // When a faction is supplied via `initialFaction` (i.e. the user just
  // ran the new-project flow), seed with the first non-broken vehicle of
  // that faction so the editor lands on a real choice for the user's army
  // rather than whichever vehicle the last edited project left behind.
  // (BROKEN_MODELS and FACTION_DEFAULT_VEHICLE are module-level constants.)
  const [vehicleId, setVehicleId] = useState<string>(() => {
    if (initialFaction) return FACTION_DEFAULT_VEHICLE[initialFaction]
    const saved = project.lastVehicleId
    if (!saved || BROKEN_MODELS.has(saved)) return FACTION_DEFAULT_VEHICLE['german']
    return saved
  })
  // Keep the vehicleId ref in sync so history getters always read the
  // latest vehicle without re-registering on every vehicleId change.
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern
  vehicleIdRef.current = vehicleId
  // selectedFaction drives the VehicleMenu. Initialized from initialFaction
  // when provided, otherwise inferred from the resolved vehicleId above.
  const [selectedFaction, setSelectedFaction] = useState<Faction>(() => {
    if (initialFaction) return initialFaction
    const saved = project.lastVehicleId
    const resolvedId = !saved || BROKEN_MODELS.has(saved) ? FACTION_DEFAULT_VEHICLE['german'] : saved
    return VEHICLES.find(v => v.id === resolvedId)?.faction ?? 'german'
  })
  const [activePanel, setActivePanel] = useState<
    'view' | 'decals' | 'reference' | 'export' | 'parts' | 'camo' | 'scene' | 'brush' | null
  >(null)
  const [placeMode, setPlaceModeState] = useState<DecalType | 'off'>('off')
  // Brush tool — direct paint onto the diffuse atlas. Mutually exclusive
  // with decal placement: turning the brush on suppresses placeMode (and
  // vice versa) so a viewport click is never ambiguous.
  const [brushOn, setBrushOnState] = useState(false)
  const [brushSettings, setBrushSettings] = useState<BrushSettings>(DEFAULT_BRUSH)
  /** One-shot eyedropper. When true, the next viewport click samples the
   *  pixel under the cursor into brushSettings.color instead of painting. */
  const [eyedropPending, setEyedropPending] = useState(false)
  /** Last canvas-space point of an active brush stroke. Used by the drag-
   *  paint path to interpolate dabs between two pointer-move events so a
   *  fast drag produces a continuous line rather than scattered dots. */
  const lastBrushPtRef = useRef<{ x: number; y: number } | null>(null)
  /** True while the primary mouse button is held — tracked at document
   *  level because Viewport.tsx only exposes onClick / onHover, not down/
   *  up. Drag-paint reads this from hover events to decide whether to
   *  draw a segment vs. just preview a cursor. */
  const pointerDownRef = useRef(false)
  // Mutual-exclusion setters: any time one tool is enabled, the other is
  // forced off. Wrap the raw state setters so every entry point routes
  // through the lock.
  const setPlaceMode = useCallback((m: DecalType | 'off') => {
    setPlaceModeState(m)
    if (m !== 'off') setBrushOnState(false)
  }, [])
  const setBrushOn = useCallback((v: boolean) => {
    setBrushOnState(v)
    if (v) setPlaceModeState('off')
  }, [])
  // Exploded parts view
  const [parts, setParts] = useState<string[]>([])
  const [selectedPart, setSelectedPart] = useState<string | null>(null)
  const [explodeAll, setExplodeAll] = useState(false)
  /** Incremented after each undo/redo/stroke so the VehicleTextureEditor
   *  receives fresh `canUndo`/`canRedo` props (the history stacks live in
   *  refs and don't otherwise trigger re-renders).
   *  The _value_ is read as `void _historyGeneration` to make the lint
   *  happy; what matters is the re-render triggered by the setter. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_historyGeneration, setHistoryGeneration] = useState(0)
  // Toggle handler shared between the ExplodeButton click and the E-key
  // global shortcut. Wrapped in useCallback so the bottom-row JSX doesn't
  // re-create the inline lambda on every Editor render.
  const toggleExplode = useCallback(() => {
    setExplodeAll(prev => {
      const next = !prev
      // Activating explode: clear any single-part isolate selection so all
      // parts start in the full-explode spread.
      // Deactivating explode: clear selection so the viewport collapses cleanly.
      setSelectedPart(null)
      return next
    })
  }, [])
  // E-key shortcut → toggle explode. Listens for the custom event the
  // global keydown handler dispatches (mirrors the R-key viewport-reset
  // pattern further down).
  useEffect(() => {
    const onToggle = () => toggleExplode()
    window.addEventListener('coh2:toggle-explode', onToggle)
    return () => window.removeEventListener('coh2:toggle-explode', onToggle)
  }, [toggleExplode])
  // Environment / skybox
  const [envArchive, setEnvArchive] = useState<SgaArchive | null>(null)
  const [envName, setEnvName] = useState('mission_06')
  // Toggle between intact and destroyed/wrecked variants of the model.
  const [showDestroyed] = useState(false)
  // Show crew — when on, a single soldier from the vehicle's faction is
  // loaded behind the chassis as a stand-in crewman.  Default OFF
  // because soldiers currently render in T-pose (no RGA decoder yet);
  // the toggle exists so the user can opt in to the in-game-style
  // "tank-with-crew" composition and opt back out if the T-pose reads
  // wrong.  Persisted to localStorage so it survives reloads.
  // Default OFF for everyone — the soldier currently renders in T-pose
  // (no .rga animation decoder), which the user consistently reported as
  // visual clutter ("get rid of that soldier model"). The key is versioned
  // (`-v2`) so any pre-existing `'1'` from earlier dev sessions is ignored;
  // the toggle is still available in Scene → Crew for users who want to
  // opt in, and their choice persists under the new key.
  const [showCrew, setShowCrewState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem('coh2-skin-editor:show-crew-v2') === '1'
    } catch {
      return false
    }
  })
  const setShowCrew = useCallback((v: boolean) => {
    setShowCrewState(v)
    try {
      window.localStorage.setItem('coh2-skin-editor:show-crew-v2', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])
  // Camo state — stored separately from project (not persisted, preview only)
  const [camoPreset, setCamoPreset] = useState<CamoPreset | null>(null)
  const [camoPrompt, setCamoPrompt] = useState('')
  const [activeDecalId, setActiveDecalId] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [pendingImageId, setPendingImageId] = useState<string | null>(null)
  // Scene preset (right-side panel). Loaded synchronously from localStorage
  // so the very first render uses the user's saved choice — avoids a
  // one-frame flash of the default.
  const [presetId, setPresetIdState] = useState<PresetId>(() => loadPresetId())
  // Per-control loading flags. Each one is set true on a user click that
  // kicks off async work and cleared either by a completion signal from
  // the Viewport (vehicle: onModelLoaded) or a min-duration timer (season,
  // preset: no exposed completion signal — the timer is generous enough
  // that the underlying op is virtually always done by then). Each flag
  // drives the LoadingBorder beam around its owning UI control.
  const [vehicleLoading, setVehicleLoading] = useState(false)
  const [seasonLoading, setSeasonLoading] = useState(false)
  // When the season toggle is clicked, the Viewport can resolve the swap
  // almost instantly if both texture sets are already decoded into the
  // GPU cache (e.g. winter→summer→winter while staying on the same
  // vehicle). In that case `onSeasonReady` fires within ~10 ms of the
  // click — too fast for the LoadingBorder beam to even appear, let alone
  // complete a sweep. Tracking the start time and enforcing a min-display
  // window of 600 ms guarantees the beam always reads as a smooth pulse.
  const seasonLoadingStartedAtRef = useRef<number>(0)
  const seasonLoadingClearTimerRef = useRef<number | null>(null)
  const SEASON_MIN_LOADING_MS = 600
  const setPresetId = useCallback((id: PresetId) => {
    setPresetIdState(id)
    persistPresetId(id)
  }, [])
  // Wrappers that also flip the matching loading flag so the LoadingBorder
  // beam fires the moment a click lands. The original setters are passed
  // to TopBar (which mutates these too) so it gets the loading behaviour
  // for free.
  const handleSetSeason = useCallback(
    (s: 'summer' | 'winter') => {
      if (s !== season) {
        setSeasonLoading(true)
        seasonLoadingStartedAtRef.current = performance.now()
        // Clear any pending "delayed off" from a previous swap so the next
        // onSeasonReady starts a fresh min-window.
        if (seasonLoadingClearTimerRef.current != null) {
          window.clearTimeout(seasonLoadingClearTimerRef.current)
          seasonLoadingClearTimerRef.current = null
        }
      }
      setSeason(s)
    },
    [season],
  )
  const handleSetVehicleId = useCallback(
    (id: string) => {
      if (id !== vehicleId) setVehicleLoading(true)
      setVehicleId(id)
    },
    [vehicleId],
  )
  // Called by Viewport once the new season's textures are bound. May
  // arrive in <10 ms for cached swaps; in that case we hold the loading
  // flag up to `SEASON_MIN_LOADING_MS` so the beam has time to sweep.
  const handleSeasonReady = useCallback(() => {
    const elapsed = performance.now() - seasonLoadingStartedAtRef.current
    const remaining = Math.max(0, SEASON_MIN_LOADING_MS - elapsed)
    if (seasonLoadingClearTimerRef.current != null) {
      window.clearTimeout(seasonLoadingClearTimerRef.current)
    }
    seasonLoadingClearTimerRef.current = window.setTimeout(() => {
      setSeasonLoading(false)
      seasonLoadingClearTimerRef.current = null
    }, remaining)
  }, [])
  // Both vehicle- and season-loading are cleared by precise completion
  // callbacks from the Viewport (`onModelLoaded` and `onSeasonReady`),
  // not by fixed timers. We keep one safety timeout per flag so a
  // never-firing callback (load error, archive missing) doesn't strand
  // the beam forever — but in the common case the flag flips off the
  // exact frame the new texture/model is on-screen, no glitch, no
  // arbitrary minimum-display window.
  useEffect(() => {
    if (!seasonLoading) return
    const t = window.setTimeout(() => setSeasonLoading(false), 8000)
    return () => window.clearTimeout(t)
  }, [seasonLoading])
  useEffect(() => {
    if (!vehicleLoading) return
    const t = window.setTimeout(() => setVehicleLoading(false), 12000)
    return () => window.clearTimeout(t)
  }, [vehicleLoading])

  // Step 9: register the offscreen Three.js renderer with the icon
  // cascade in `vehicle-icons.ts`. The cascade falls through to this
  // when no bundled / stock-SGA icon exists, producing a posed
  // silhouette of the actual vehicle model. Unmounting tears down
  // the WebGL context so swapping packs doesn't leak GPU buffers.
  // Dynamic import keeps vehicle-3d-renderer (and its Three.js dep) out
  // of the initial JS parse — it's loaded asynchronously once the editor
  // mounts, so it never delays first paint.
  useEffect(() => {
    let teardown: (() => void) | undefined
    let cancelled = false
    import('@/lib/vehicle-3d-renderer')
      .then(({ installVehicleRenderer }) => {
        if (!cancelled) teardown = installVehicleRenderer(root)
      })
      .catch(() => {
        /* non-fatal — icon cascade has static fallbacks */
      })
    return () => {
      cancelled = true
      teardown?.()
    }
  }, [root])

  const preset = SCENE_PRESETS[presetId]
  // (Per-second tick for the saved-ago indicator removed with the indicator.)

  // Idle-fade the chrome so the tank takes over when the user is just
  // orbiting. Mouse movement / interaction wakes it up; 12 s without
  // activity fades to 35 % opacity. Earlier 4 s felt too aggressive — it
  // dimmed mid-thought while the user was reading a vehicle name or
  // deciding which decal to place. 12 s reads as "you're definitely not
  // looking at the chrome anymore" without ever interrupting an in-flight
  // read. Pressing F or H also force-hides.
  const [chromeVisible, setChromeVisible] = useState(true)
  const [chromeForcedHidden, setChromeForcedHidden] = useState(false)
  useEffect(() => {
    let timer: number | undefined
    const wake = () => {
      setChromeVisible(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setChromeVisible(false), 12000)
    }
    wake()
    document.addEventListener('mousemove', wake)
    document.addEventListener('keydown', wake)
    document.addEventListener('click', wake)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousemove', wake)
      document.removeEventListener('keydown', wake)
      document.removeEventListener('click', wake)
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F' || e.key === 'h' || e.key === 'H') {
        // Don't intercept if the user is editing a text field
        const t = e.target as HTMLElement
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
        setChromeForcedHidden(v => !v)
      } else if (e.key === 'Escape') {
        setChromeForcedHidden(false)
        setActivePanel(null)
        setPlaceMode('off')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setPlaceMode])
  const showChrome = chromeVisible && !chromeForcedHidden

  const vehicle = useMemo(() => VEHICLES.find(v => v.id === vehicleId) ?? VEHICLES[0], [vehicleId])
  const veh = useMemo(() => getOrInitVehicle(project, vehicle.id), [project, vehicle.id])

  // Keep selectedFaction in sync with the active vehicle's faction. TopBar's
  // faction picker switches by setting vehicleId; this effect mirrors that
  // back into selectedFaction so the bottom VehicleMenu reflects the change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived state from a prop; single setState, no cascade
    setSelectedFaction(vehicle.faction)
  }, [vehicle.faction])

  // Debug / screenshot harness: `?hideTank=1` suppresses the focal vehicle
  // so we can iterate on terrain, sky, and entity rendering without the
  // tank in frame. Read once at mount — toggling at runtime would require
  // tearing down the vehicle's resources, which the screenshot harness
  // doesn't need. Wired by the Electron headless flow via HEADLESS_HIDE_TANK.
  const hideTank = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('hideTank') === '1'
  }, [])

  // Vehicles for the current faction (for the bottom-left VehicleMenu).
  // Driven by selectedFaction so the menu updates immediately when the
  // user picks a new faction — before the vehicle swap finishes loading.
  // Sorted toughest→weakest via vehiclesForFaction (super_heavy first).
  const factionVehicles = useMemo(
    () => vehiclesForFaction(selectedFaction),
    [selectedFaction],
  )
  // Set of vehicle ids with at least one placed decal — drives the orange
  // "dirty" dot on each vehicle pill.
  const dirtyVehicles = useMemo(() => {
    const s = new Set<string>()
    for (const [id, v] of Object.entries(project.vehicles ?? {})) {
      if ((v.decals?.length ?? 0) > 0) s.add(id)
    }
    return s
  }, [project.vehicles])

  // ---- offscreen 2048² canvas where we composite the diffuse + decals.
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // eslint-disable-next-line react-hooks/refs -- lazy initialization: ref is only written when null, safe to call during render per React docs on lazy ref init
  if (!overlayCanvasRef.current) {
    const c = document.createElement('canvas')
    c.width = c.height = 2048
    overlayCanvasRef.current = c
  }
  const baseDiffuseRef = useRef<HTMLCanvasElement | null>(null)
  /** Immutable snapshot of the *vanilla* CoH2 diffuse atlas for the
   *  current vehicle. `baseDiffuseRef` gets mutated each time we apply
   *  camo / imported skin, so we need a pristine copy to re-composite
   *  against when the user picks a different preset (and to avoid the
   *  "camo eats every rivet/grille/hatch detail" symptom from compositing
   *  camo directly onto the previously-composited atlas). Repopulated on
   *  every model load. */
  const vanillaDiffuseRef = useRef<HTMLCanvasElement | null>(null)
  /**
   * RGM meshes from the most recently loaded model. Stored so the
   * decal-pack preview effect can run the vertex-probe UV derivation
   * without going through the Viewport render pipeline.
   * Set by the onModelLoaded callback; cleared to null on vehicle switch
   * before the new model arrives.
   */
  const loadedMeshesRef = useRef<RgmMesh[] | null>(null)
  /**
   * Pre-baked decal-pack preview canvas: the current baseDiffuse composited
   * with the first visible decal from project.decalPackRef baked into the
   * vehicle's hull-right UV rect. Null when no decalPackRef is set or when
   * the rect cannot be resolved — in which case behavior is identical to
   * the no-decalPackRef path.
   *
   * Used by paintCanvas as a drop-in replacement for baseDiffuseRef: when
   * non-null it is drawn in place of baseDiffuseRef so the decal preview
   * is always visible below user-placed skin decals. When null the paint
   * path falls through to baseDiffuseRef unchanged.
   *
   * Updated by the decalPreviewTick effect below; cleared synchronously
   * whenever decalPackRef is absent.
   */
  const decalPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  /**
   * Tick counter bumped in onModelLoaded. The decal-pack preview effect
   * depends on this so it re-bakes whenever a new vehicle model loads —
   * the new model may have a different UV layout, and baseDiffuseRef is
   * replaced each load so any baked preview for the previous vehicle must
   * be regenerated.
   */
  const [decalPreviewTick, setDecalPreviewTick] = useState(0)
  /** Bumps each time we repaint or apply camo. The Viewport reads this
   *  via the `overlayVersion` prop and uses it to gate when the 2048²
   *  CanvasTexture is re-uploaded to the GPU. Without it the viewport
   *  has no way to tell that this offscreen canvas changed and used to
   *  re-upload every frame (~1 GB/s of wasted bandwidth, the dominant
   *  cause of camera-rotation jank). */
  const [overlayVersion, setOverlayVersion] = useState(0)
  const bumpOverlay = useCallback(() => setOverlayVersion(v => v + 1), [])

  // ---- Decal-pack preview composite effect --------------------------------
  //
  // When project.decalPackRef is set AND a vehicle model has been loaded,
  // this effect:
  //   1. Loads the decal pack from localStorage via loadDecalPackById.
  //   2. Rasterises the first visible decal tile to a 128×128 canvas.
  //   3. Resolves the hull-right UV rect for the current vehicle (JSON
  //      registry first, vertex probe second, null = skip).
  //   4. Bakes the decal into a copy of the current baseDiffuse at that
  //      rect and stores it in decalPreviewCanvasRef.
  //   5. Calls repaint() so paintCanvas picks up the new preview canvas.
  //
  // When decalPackRef is absent or no model is loaded, the preview canvas
  // is cleared so paintCanvas falls back to plain baseDiffuse — behavior
  // is IDENTICAL to the no-decalPackRef path (purely additive).
  //
  // Note: repaint is defined below this block; the hook is hoisted safely
  // because all state/refs it closes over are stable by the time it runs.
  // We access repaint via a ref to avoid a circular dep with the useEffect.
  const repaintRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const decalPackRef = project.decalPackRef
    // Fast path: no decal pack → clear preview and exit
    if (!decalPackRef) {
      decalPreviewCanvasRef.current = null
      // repaintRef may not be set on the very first tick (mount order).
      // The subsequent repaint from onModelLoaded covers this case.
      repaintRef.current?.()
      return
    }

    // Load the decal pack synchronously from localStorage.
    const pack = loadDecalPackById(decalPackRef.id)
    if (!pack) {
      decalPreviewCanvasRef.current = null
      repaintRef.current?.()
      return
    }

    // Scope gate: when the user pinned the decal preview to a single vehicle,
    // clear the preview on every other vehicle.
    if (project.decalScope === 'vehicle'
        && project.decalScopeVehicleId
        && project.decalScopeVehicleId !== vehicleId) {
      decalPreviewCanvasRef.current = null
      repaintRef.current?.()
      return
    }

    // Find the first visible decal tile to preview.
    // v6 packs use parts[].shared; v5 and earlier use decals[].
    const allDecals = pack.parts
      ? pack.parts.flatMap(p => p.shared.filter(d => d.visible))
      : pack.decals.filter(d => d.visible)
    const firstDecal = allDecals[0]
    if (!firstDecal) {
      decalPreviewCanvasRef.current = null
      repaintRef.current?.()
      return
    }

    const srcImage = pack.sourceImages[firstDecal.sourceImageId]
    if (!srcImage) {
      decalPreviewCanvasRef.current = null
      repaintRef.current?.()
      return
    }

    // Resolve the UV rect for this vehicle. JSON-only on first load (meshes
    // may be null if the model hasn't finished loading yet); the effect
    // re-runs on decalPreviewTick when meshes arrive.
    const rect = resolveDecalUvRect(vehicleId, loadedMeshesRef.current)
    if (!rect) {
      // No rect available yet — clear preview (graceful skip).
      decalPreviewCanvasRef.current = null
      repaintRef.current?.()
      return
    }

    const base = baseDiffuseRef.current
    if (!base) {
      decalPreviewCanvasRef.current = null
      repaintRef.current?.()
      return
    }

    // Rasterise the decal to a canvas. We need a decoded image element for
    // rasteriseDecal. Load it asynchronously and bake on completion.
    const img = new Image()
    img.onload = () => {
      // Rasterise the decal tile at 4× (512²) so the bake DOWNscales into the
      // hull atlas rect (~320-512px) instead of upscaling a soft 128 tile —
      // keeps the previewed badge crisp.
      const decalCanvas = rasteriseDecal(firstDecal, img, { supersample: 4 })
      // bakeDecalOntoDiffuse expects an HTMLCanvasElement; OffscreenCanvas
      // is also valid but the type is CanvasImageSource which both satisfy.
      // Cast so TypeScript is happy — the runtime drawImage accepts both.
      const bakedCanvas = bakeDecalOntoDiffuse(
        base,
        decalCanvas as HTMLCanvasElement,
        rect,
      )
      decalPreviewCanvasRef.current = bakedCanvas
      repaintRef.current?.()
      // Snap the camera to the right-side hull view so the newly baked decal
      // is immediately visible.  Only fires if Viewport has wired up the
      // faceDecalRef (i.e. Viewport is mounted and a model is loaded).
      viewportFaceDecalRef.current?.()
    }
    img.onerror = () => {
      // Image decode failed — clear preview silently.
      decalPreviewCanvasRef.current = null
      repaintRef.current?.()
    }
    img.src = srcImage.dataUrl
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.decalPackRef, project.decalScope, project.decalScopeVehicleId, vehicleId, decalPreviewTick])
  // ^ vehicleId ensures the effect re-runs when the user switches vehicles.
  //   decalPreviewTick ensures it re-runs when a new model loads (new baseDiffuse).

  // Per-slot icon editor — null means not open; number is the global
  // exportSlots index being edited. Opened from the SlotIconGrid inside
  // the PackIdentityPopover.
  const [slotIconEditingIdx, setSlotIconEditingIdx] = useState<number | null>(null)

  // A3: full-screen vehicle-texture editor. The "Edit texture" pill opens
  // this proper editor screen (live atlas + brush + back button) instead of
  // the cramped Decals side panel it used to toggle.
  const [textureEditorOpen, setTextureEditorOpen] = useState(false)
  // UV-layout wireframe (flat segments [x0,y0,x1,y1,…] in 0..1) for the active
  // vehicle's body meshes — drives the texture editor's "unwrap" overlay.
  const [uvLines, setUvLines] = useState<Float32Array | null>(null)

  // Save indicator — 'saved' for 1.5 s after each auto-save, then clears.
  const [saveIndicator, setSaveIndicator] = useState<'saved' | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  // Apply camo to the base diffuse canvas + persist to project state.
  //
  // Scope handling:
  //   - 'vehicle' (default): writes project.vehicles[id].camoPreset, so
  //                          the preset survives reload AND is the only
  //                          thing the renderer needs to resurrect the
  //                          camo when switching back to this vehicle.
  //   - 'faction'          : writes project.factionDefaults[f].camoPreset,
  //                          which becomes the implicit default for
  //                          every vehicle in the faction without its
  //                          own override.
  //
  // The visible canvas always updates regardless of scope — we render
  // the new preset into the active vehicle's overlay immediately so the
  // user sees the change without waiting for a re-resolve.
  // Pure render step: vanilla * generated camo → overlay + baseDiffuse.
  // Used by both the user-clicked `applyCamo` and the auto-apply effect
  // that materialises a project-saved preset on vehicle load. Does not
  // touch project state — caller decides whether to persist.
  const renderCamoPresetToOverlay = useCallback(
    (preset: CamoPreset) => {
      const cv = overlayCanvasRef.current
      if (!cv) return
      const camo = document.createElement('canvas')
      camo.width = camo.height = 2048
      generateCamo(camo, preset)
      const composite = document.createElement('canvas')
      composite.width = composite.height = 2048
      const cctx = composite.getContext('2d')!
      if (vanillaDiffuseRef.current) {
        cctx.drawImage(vanillaDiffuseRef.current, 0, 0, 2048, 2048)
        cctx.globalCompositeOperation = 'multiply'
        cctx.drawImage(camo, 0, 0)
        cctx.globalCompositeOperation = 'source-over'
      } else {
        cctx.drawImage(camo, 0, 0)
      }
      const ctx = cv.getContext('2d')!
      ctx.clearRect(0, 0, 2048, 2048)
      ctx.drawImage(composite, 0, 0)
      if (baseDiffuseRef.current) {
        const bctx = baseDiffuseRef.current.getContext('2d')
        if (bctx) {
          bctx.clearRect(0, 0, 2048, 2048)
          bctx.drawImage(composite, 0, 0)
        }
      }
      bumpOverlay()
    },
    [bumpOverlay],
  )

  const applyCamo = useCallback(
    (preset: CamoPreset, scope: 'vehicle' | 'faction' | 'all' = 'vehicle') => {
      renderCamoPresetToOverlay(preset)
      setCamoPreset(preset)
      // Persist to project state — scope-aware.
      // eslint-disable-next-line react-hooks/immutability -- updateProject is declared below; hoisting is intentional (function expr in component body, used in callback above)
      updateProject(p => {
        if (scope === 'all') {
          // Set preset on every faction default and wipe per-vehicle overrides
          // so the bulk apply propagates to every vehicle in every faction.
          for (const { id: factionId } of FACTIONS) {
            const fd = getOrInitFactionDefault(p, factionId)
            fd.camoPreset = preset
            fd.customDiffuseUrl = null
          }
          // Clear per-vehicle overrides so faction defaults win.
          for (const v of Object.values(p.vehicles)) {
            v.camoPreset = null
            v.customDiffuseUrl = null
          }
        } else if (scope === 'faction') {
          const fd = getOrInitFactionDefault(p, vehicle.faction)
          fd.camoPreset = preset
          // Persisting at faction scope intentionally leaves per-vehicle
          // camoPreset overrides alone — the user explicitly opted into
          // faction-scope, but we don't wipe their bespoke vehicle tweaks
          // without an extra confirm.
        } else {
          const v = getOrInitVehicle(p, vehicle.id)
          v.camoPreset = preset
          // Clear custom diffuse URL so the procedural preset wins next
          // time the canvas re-resolves (otherwise the imported image
          // would override). User can re-import if they want both.
          v.customDiffuseUrl = null
        }
      })
    },
    [renderCamoPresetToOverlay, vehicle.id, vehicle.faction],
  )

  // Apply an AI-generated or imported camo image directly onto the
  // diffuse canvas + persist its data URL to project state.
  //
  // Scope routing matches applyCamo. The image is converted to a data
  // URL once (~few hundred KB) and stored — cheaper than re-running the
  // AI call to reproduce it after a reload.
  const applyCamoImage = useCallback(
    (img: HTMLImageElement, scope: 'vehicle' | 'faction' | 'all' = 'vehicle') => {
      const cv = overlayCanvasRef.current
      if (!cv) return
      const ctx = cv.getContext('2d')!
      ctx.clearRect(0, 0, 2048, 2048)
      ctx.drawImage(img, 0, 0, 2048, 2048)
      if (baseDiffuseRef.current) {
        const bctx = baseDiffuseRef.current.getContext('2d')
        if (bctx) {
          bctx.clearRect(0, 0, 2048, 2048)
          bctx.drawImage(img, 0, 0, 2048, 2048)
        }
      }
      setCamoPreset(null)
      bumpOverlay()
      // Convert to PNG data URL for persistence. Done off the visible
      // canvas so we capture exactly what's on the model right now.
      let dataUrl: string | null = null
      try {
        const snap = document.createElement('canvas')
        snap.width = snap.height = 2048
        const sctx = snap.getContext('2d')
        if (sctx) {
          sctx.drawImage(img, 0, 0, 2048, 2048)
          dataUrl = snap.toDataURL('image/png')
        }
      } catch (e) {
        console.warn('[editor] applyCamoImage: failed to snapshot to data URL', e)
      }
      if (!dataUrl) return
      updateProject(p => {
        if (scope === 'all') {
          // Apply to every faction default and wipe per-vehicle overrides so
          // the bulk apply propagates to every vehicle across all factions.
          for (const { id: factionId } of FACTIONS) {
            const fd = getOrInitFactionDefault(p, factionId)
            fd.customDiffuseUrl = dataUrl
            fd.camoPreset = null
          }
          // Clear per-vehicle overrides so faction defaults win.
          for (const v of Object.values(p.vehicles)) {
            v.customDiffuseUrl = null
            v.camoPreset = null
          }
        } else if (scope === 'faction') {
          const fd = getOrInitFactionDefault(p, vehicle.faction)
          fd.customDiffuseUrl = dataUrl
          fd.camoPreset = null
        } else {
          const v = getOrInitVehicle(p, vehicle.id)
          v.customDiffuseUrl = dataUrl
          v.camoPreset = null
        }
      })
    },
    [bumpOverlay, vehicle.id, vehicle.faction],
  )

  // Stable refs so the repaint callback can read the latest hover/placeMode
  // without them appearing in its dependency array.  This prevents repaint
  // from recreating its identity on every mouse-move event, which in turn
  // prevents the [repaint, project] useEffect from firing on every hover —
  // the root cause of the 16 MB GPU texture upload per pointermove event.
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  hoverRef.current = hover
  const placeModeRef = useRef<DecalType | 'off'>('off')
  placeModeRef.current = placeMode

  // Core canvas repaint — composites baseDiffuse + decals + (optional)
  // hover ghost onto the 2048² overlay canvas.
  // Does NOT call bumpOverlay() so it can be used for hover-preview-only
  // redraws without triggering a GPU texture re-upload.
  const paintCanvas = useCallback(() => {
    const cv = overlayCanvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, 2048, 2048)
    // Use the decal-pack preview canvas (baseDiffuse + baked decal) when
    // available, otherwise fall back to bare baseDiffuse. When
    // decalPreviewCanvasRef is null (no decalPackRef set, or rect unresolved),
    // this path is IDENTICAL to the original behavior.
    const baseSource = decalPreviewCanvasRef.current ?? baseDiffuseRef.current
    if (baseSource) ctx.drawImage(baseSource, 0, 0, 2048, 2048)
    const renderCtx: RenderContext = {
      ctx,
      palette: project.palette,
      defaultTac: vehicle.defaultTac,
      vehicleName: veh.name ?? '',
      tac: veh.tac ?? vehicle.defaultTac,
      images: project.images ?? {},
    }
    paintDecals(renderCtx, veh.decals, activeDecalId)
    // Hover preview — translucent ghost of the next-place decal.
    // Reads hover/placeMode from refs so this callback is stable.
    const hoverNow = hoverRef.current
    const placeModeNow = placeModeRef.current
    if (hoverNow && placeModeNow !== 'off') {
      ctx.globalAlpha = 0.55
      paintDecals(
        renderCtx,
        [
          {
            id: -1,
            type: placeModeNow,
            x: hoverNow.x,
            y: hoverNow.y,
            rot: 0,
            size: defaultSize(placeModeNow),
          },
        ],
        -1,
      )
      ctx.globalAlpha = 1
    }
  }, [
    project.palette,
    project.images,
    vehicle.defaultTac,
    veh.name,
    veh.tac,
    veh.decals,
    activeDecalId,
    // hover and placeMode are intentionally omitted — read from stable refs
    // so this callback does NOT recreate on every mouse-move event.
  ])

  // Repaint committed content AND trigger GPU upload.  Use this whenever
  // real project state changes (decal placed, palette changed, etc.).
  const repaint = useCallback(() => {
    paintCanvas()
    bumpOverlay()
  }, [paintCanvas, bumpOverlay])
  // Keep repaintRef current so the decal-preview effect (declared before
  // repaint to avoid a circular dep) can call repaint() after async bake.
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" to bridge declaration order
  repaintRef.current = repaint

  // Hover-preview repaint — repaints the canvas so the ghost decal moves
  // with the cursor, but does NOT bump overlayVersion so no GPU re-upload
  // happens.  Called from a separate effect that tracks only hover/placeMode.
  useEffect(() => {
    paintCanvas()
    // Intentionally NOT calling bumpOverlay() here — hover movement is
    // cosmetic preview and must not trigger the 16 MB overlayTex upload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, placeMode, paintCanvas])

  useEffect(() => {
    repaint()
    persistActive(project)
    // v1.0: Live Sync is permanently on — every persist triggers a
    // debounced .sga rebuild. Rapid changes (e.g. brush dabs) coalesce
    // into a single export 1500 ms after the last one.
    scheduleLiveSync('skin', project)
    // Flash the save indicator briefly after each persist.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: save indicator is updated synchronously then auto-cleared via setTimeout
    setSaveIndicator('saved')
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => setSaveIndicator(null), 1500)
  }, [repaint, project])

  // ---- decal manipulation helpers
  const updateProject = (mut: (p: Coh2SkinProject) => void) => {
    setProject(p => {
      const copy = structuredClone(p)
      mut(copy)
      return copy
    })
  }

  // Snapshot the painted baseDiffuse → PNG data URL → persist as the
  // vehicle's customDiffuseUrl. Runs synchronously (toDataURL on a 2048²
  // canvas is ~30–80 ms in practice). We snapshot AFTER each stroke ends
  // rather than after every dab so a long drag-paint doesn't pay the
  // encoding cost per pointer-move event.
  const persistBrushStroke = useCallback(() => {
    const base = baseDiffuseRef.current
    if (!base) return
    let dataUrl: string | null = null
    try {
      dataUrl = base.toDataURL('image/png')
    } catch (e) {
      console.warn('[editor] persistBrushStroke: toDataURL failed', e)
      return
    }
    if (!dataUrl) return
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      v.customDiffuseUrl = dataUrl!
      v.camoPreset = null
      p.lastVehicleId = vehicle.id
    })
  }, [vehicle.id])

  // Wipe paint back to the pristine vanilla diffuse and clear the
  // persisted customDiffuseUrl so a reload doesn't restore the wipe-out.
  const clearBrushPaint = useCallback(() => {
    const base = baseDiffuseRef.current
    const vanilla = vanillaDiffuseRef.current
    if (!base) return
    const bctx = base.getContext('2d')
    if (!bctx) return
    bctx.clearRect(0, 0, 2048, 2048)
    if (vanilla) bctx.drawImage(vanilla, 0, 0)
    history.commit('Clear paint')
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      v.customDiffuseUrl = null
    })
    repaint()
  }, [history, repaint, vehicle.id])

  const addDecal = (uv: { u: number; v: number }) => {
    // Eyedropper has priority over both brush and decal placement — the
    // user explicitly opted into "sample the next click" mode, so this
    // click is consumed by colour-sampling regardless of other state.
    if (eyedropPending) {
      const base = baseDiffuseRef.current
      if (base) {
        const x = Math.round(uv.u * 2048)
        const y = Math.round((1 - uv.v) * 2048)
        const ctx = base.getContext('2d')
        if (ctx) {
          const c = samplePixel(ctx, x, y)
          setBrushSettings(s => ({ ...s, color: c }))
          toast.push(`Picked ${c}`, 'success')
        }
      }
      setEyedropPending(false)
      return
    }
    if (brushOn) {
      const base = baseDiffuseRef.current
      if (!base) return
      const x = Math.round(uv.u * 2048)
      const y = Math.round((1 - uv.v) * 2048)
      const ctx = base.getContext('2d')
      if (!ctx) return
      // Click = single dab. History was already snapshotted in the
      // document-level mousedown handler so Ctrl+Z rolls back the whole
      // stroke (click or drag) as one unit. We persist here because a
      // pure click never fires the drag-paint path that mouseup uses to
      // detect end-of-stroke.
      paintBrushDab(ctx, x, y, brushSettings, vanillaDiffuseRef.current)
      lastBrushPtRef.current = { x, y }
      repaint()
      persistBrushStroke()
      return
    }
    if (placeMode === 'off') return
    const x = Math.round(uv.u * 2048)
    const y = Math.round((1 - uv.v) * 2048)
    history.commit('Place decal')
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      const newId = (v.decals.reduce((m, d) => Math.max(m, d.id), 0) ?? 0) + 1
      const d: Decal = {
        id: newId,
        type: placeMode as DecalType,
        x,
        y,
        rot: 0,
        size: defaultSize(placeMode),
        kills: placeMode === 'kills' ? 8 : undefined,
        imageId: placeMode === 'image' ? (pendingImageId ?? undefined) : undefined,
        opacity: placeMode === 'image' ? 1 : undefined,
      }
      v.decals.push(d)
      p.lastVehicleId = vehicle.id
      setActiveDecalId(newId)
    })
  }
  const updateDecal = (id: number, patch: Partial<Decal>) => {
    history.commit('Edit decal')
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      const d = v.decals.find(x => x.id === id)
      if (d) Object.assign(d, patch)
    })
  }
  const removeDecal = (id: number) => {
    history.commit('Remove decal')
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      v.decals = v.decals.filter(x => x.id !== id)
    })
    if (activeDecalId === id) setActiveDecalId(null)
  }
  const clearDecals = () => {
    history.commit('Clear decals')
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      v.decals = []
    })
    setActiveDecalId(null)
  }

  // Toggle a placed decal's "main" status. Clicking the same decal
  // again unsets it (null). Writes to the vehicle override; the user
  // can also set a faction-default main from the faction-scope flow,
  // but per-vehicle takes precedence in the resolver.
  const setMainDecalId = useCallback(
    (id: number | null) => {
      history.commit('Set main decal')
      updateProject(p => {
        const v = getOrInitVehicle(p, vehicle.id)
        v.mainDecalId = (v.mainDecalId ?? null) === id ? null : id
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- history & updateProject are stable refs from useReducer-style hooks
    [vehicle.id],
  )

  // Switch which export slot is being edited. The "active slot" mirror
  // model means writes always land on the live state, then sync into
  // the corresponding slot's snapshot on switch. We sync the current
  // slot first (so its edits aren't lost), then load the target.
  const switchActiveSlot = useCallback(
    (slotIdx: number) => {
      if (slotIdx === project.activeSlotIdx) return
      updateProject(p => {
        syncLiveStateToActiveSlot(p)
        loadSlotIntoLiveState(p, slotIdx)
      })
      // Clear transient selection state — the new slot's decal ids may
      // not exist on the current vehicle.
      setActiveDecalId(null)
    },
    [project.activeSlotIdx],
  )

  // ---- keyboard shortcuts (Ctrl+Z/Y, Ctrl+S, Delete, R, Escape)
  // Stable refs let the handler always read the latest state without
  // being re-registered on every render.
  const activeDecalIdRef = useRef(activeDecalId)
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern so keyboard handler always sees current value
  activeDecalIdRef.current = activeDecalId
  const removeDecalRef = useRef(removeDecal)
  // eslint-disable-next-line react-hooks/refs -- same pattern
  removeDecalRef.current = removeDecal

  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const t = e.target as HTMLElement | null
      const inText =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t?.isContentEditable ?? false)

      // ── Ctrl+S / Cmd+S ── save
      if (mod && e.key === 's') {
        e.preventDefault()
        persistActive(projectRef.current)
        toast.push('Saved', 'success')
        return
      }

      // ── Ctrl+Z / Cmd+Z ── undo
      if (mod && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        if (history.canUndo()) {
          const snap = history.undo()
          if (snap) toast.push(`Undo: ${snap.label}`, 'info')
          setHistoryGeneration(g => g + 1)
        }
        return
      }

      // ── Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y ── redo
      if ((mod && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) {
        e.preventDefault()
        if (history.canRedo()) {
          const snap = history.redo()
          if (snap) toast.push(`Redo: ${snap.label}`, 'info')
          setHistoryGeneration(g => g + 1)
        }
        return
      }

      // ─── shortcuts below bail when typing in a text field ───
      if (inText) return

      // ── Delete / Backspace ── remove active decal
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeDecalIdRef.current != null) {
          removeDecalRef.current(activeDecalIdRef.current)
          setActiveDecalId(null)
        }
        return
      }

      // ── R ── reset camera via custom event (no modifier)
      if (!mod && !e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R')) {
        window.dispatchEvent(new CustomEvent('coh2:viewport-reset'))
        return
      }

      // ── E ── toggle explode mode (no modifier). Mirrors the pill button
      // in the bottom-center row. We dispatch a custom event so we don't
      // have to thread setExplodeAll through this ref-based handler — the
      // bottom row already owns the state.
      if (!mod && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        window.dispatchEvent(new CustomEvent('coh2:toggle-explode'))
        return
      }
    }

    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
    // history and toast are stable (useCallback/useMemo inside hooks).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast])

  // ---- viewport hover throttle (rAF)
  const hoverPendingRef = useRef(false)
  const onHover = useCallback(
    (uv: { u: number; v: number } | null) => {
      // Drag-paint path. When the brush is on AND the mouse button is held,
      // every hover event is a stroke continuation. We interpolate dabs
      // between successive points so a fast drag still produces a solid
      // line. The pointerDownRef is maintained by a document-level
      // mousedown/up listener installed below.
      if (brushOn && pointerDownRef.current && uv) {
        const base = baseDiffuseRef.current
        if (!base) return
        const ctx = base.getContext('2d')
        if (!ctx) return
        const x = Math.round(uv.u * 2048)
        const y = Math.round((1 - uv.v) * 2048)
        const last = lastBrushPtRef.current
        if (last)
          paintBrushSegment(ctx, last.x, last.y, x, y, brushSettings, vanillaDiffuseRef.current)
        else paintBrushDab(ctx, x, y, brushSettings, vanillaDiffuseRef.current)
        lastBrushPtRef.current = { x, y }
        repaint()
        return
      }
      if (placeMode === 'off') {
        if (hover) setHover(null)
        return
      }
      if (hoverPendingRef.current) return
      hoverPendingRef.current = true
      requestAnimationFrame(() => {
        hoverPendingRef.current = false
        if (!uv) {
          setHover(null)
          return
        }
        setHover({ x: Math.round(uv.u * 2048), y: Math.round((1 - uv.v) * 2048) })
      })
    },
    [placeMode, hover, brushOn, brushSettings, repaint],
  )

  // Track primary mouse button state at the document level so onHover can
  // distinguish "casual mouse-over" from "actively drawing a stroke".
  // Viewport.tsx only emits onClick + onHover (no down/up), and adding a
  // pointer-down prop would require more invasive surgery. On mouseup
  // during a brush stroke we persist the painted result — encoding the
  // 2048² atlas to a PNG data URL is too expensive to do per dab, so we
  // batch it to one snapshot per stroke (matching the "release the mouse"
  // mental boundary the user already has).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      pointerDownRef.current = true
      if (brushOn) {
        // Begin a new stroke — the first dab is fired by the onClick (the
        // viewport's onPick), but we still need history bookkeeping here
        // because onClick only fires on mouseup-without-drag and a drag-
        // paint stroke would never commit history otherwise.
        history.commit('Paint stroke')
        lastBrushPtRef.current = null
      }
    }
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return
      const wasDown = pointerDownRef.current
      pointerDownRef.current = false
      if (wasDown && brushOn && lastBrushPtRef.current) {
        // Stroke ended — snapshot once.
        persistBrushStroke()
        lastBrushPtRef.current = null
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseup', onUp)
    }
  }, [brushOn, history, persistBrushStroke])

  // Whole-document drag & drop — accepts:
  //   • image files     → import to library, prep image-place mode
  //   • .coh2skin files → load project (with confirm)
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      const types = Array.from(e.dataTransfer?.items ?? []).map(i => i.kind)
      if (types.includes('file')) e.preventDefault()
    }
    const onDrop = async (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      for (const f of files) {
        if (f.name.toLowerCase().endsWith('.coh2skin') || f.type === 'application/json') {
          try {
            const text = await f.text()
            const obj = JSON.parse(text)
            if (obj?.magic === 'coh2-skin-project') {
              setProject(obj)
              toast.push(`Loaded ${obj.packName} (previous saved in browser)`, 'success')
              return
            }
          } catch {
            /* fall through to image handler */
          }
        }
        if (f.type.startsWith('image/')) {
          const copy = structuredClone(project)
          const id = await addImageFromFile(copy, f)
          setProject(copy)
          setPendingImageId(id)
          setPlaceMode('image')
          setActivePanel('decals')
          toast.push(`Imported ${f.name} — click on the tank to place`, 'success')
          return
        }
      }
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [project, setPlaceMode, toast])

  // (handleUndo / handleRedo were previously passed to a visible UndoRedoBar
  // in the top-right; the bar was removed in favour of WindowControls. The
  // keyboard shortcut handler below calls history.undo / history.redo
  // directly, so no callback wrappers are needed.)

  // Stable handler for the eyedropper — toast.push is stable, so this never
  // needs to change.
  const handleStartEyedrop = useCallback(() => {
    setEyedropPending(true)
    toast.push('Click the tank to sample colour', 'info')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stable handler for VehicleMenu onSelect — handleSetVehicleId is already
  // a useCallback, so this only changes when vehicleId does (handled inside).
  const handleVehicleSelect = useCallback(
    (v: typeof vehicle) => {
      handleSetVehicleId(v.id)
      setActiveDecalId(null)
      setPlaceMode('off')
    },
    [handleSetVehicleId, setPlaceMode],
  )

  // C1: left-edge faction switcher. Switching faction lands on a vehicle of
  // that faction — preferring one the pack already has (so the user returns
  // to their own work-in-progress), else the faction's safe default vehicle.
  const handleSelectFaction = useCallback(
    (f: Faction) => {
      if (f === selectedFaction) return
      const existing = Object.keys(project.vehicles ?? {}).find(
        id => VEHICLES.find(v => v.id === id)?.faction === f,
      )
      handleSetVehicleId(existing ?? FACTION_DEFAULT_VEHICLE[f])
      setActiveDecalId(null)
      setPlaceMode('off')
    },
    [selectedFaction, project.vehicles, handleSetVehicleId, setPlaceMode],
  )

  // Factions the pack already touches — drives the presence dot on the
  // FactionPanel tiles. Derived from the project's edited vehicles.
  const packFactions = useMemo(() => {
    const set = new Set<Faction>()
    for (const id of Object.keys(project.vehicles ?? {})) {
      const f = VEHICLES.find(v => v.id === id)?.faction
      if (f) set.add(f)
    }
    return [...set]
  }, [project.vehicles])

  // Stable per-vehicle icon resolver wired into the VehicleMenu pills.
  // The cascade in `vehicle-icons.ts` does:
  //   1. project.vehicleIcons cache (instant after first resolve)
  //   2. bundled PNG at /icons/vehicles/<id>.png
  //   3. stock-SGA probe (currently a stub returning null)
  //   4. offscreen Three.js render of the actual vehicle model
  //   5. procedural faction-coloured initial (always succeeds)
  //
  // Because the cascade reads project.vehicleIcons and writes back into
  // it on success, repeated resolves for the same id are O(1) — the
  // expensive Three.js render path runs at most once per session per
  // vehicle, then survives via the in-memory project state. We pull the
  // current project + install root from refs so the callback identity
  // stays stable (memoised with [] deps) and the VehicleMenu doesn't
  // re-fire its per-pill resolve effect on every parent re-render.
  // Pulls project from a ref so the callback identity stays stable
  // across re-renders (only `root` changes it), which keeps the
  // VehicleMenu from re-firing its per-pill resolve effect needlessly.
  const resolveIcon = useCallback<VehicleIconResolver>(
    v => resolveVehicleIcon(projectRef.current, v.id, v.faction, { installRoot: root, render3d: false }),
    [root],
  )

  // Stable getter for the vanilla diffuse canvas — reads a ref so it never
  // needs to be recreated. Passed to TopBar to avoid an inline lambda.
  const getVanillaAtlas = useCallback(() => baseDiffuseRef.current, [])

  // Fires `onReady` exactly once — on the FIRST onModelLoaded callback
  // from the Viewport. Subsequent loads (vehicle swap, season swap) are
  // ignored. Used by App.tsx to unmount the loading-state AuthShell the
  // moment the user's first vehicle is fully on-screen.
  const readyFiredRef = useRef(false)

  // Ref to Viewport's `buildVehicleIntoCache` function. Set by Viewport on
  // mount via the preloadRef prop, nulled on unmount.
  const viewportPreloadRef = useRef<((spec: import('@/lib/vehicles').VehicleSpec, season: 'summer' | 'winter', eager?: boolean) => Promise<void>) | null>(null)

  // Ref to Viewport's `faceDecalSide` function. Set by Viewport on mount via
  // the faceDecalRef prop, nulled on unmount.  Called after a successful decal
  // bake so the camera snaps to the hull-right side and the decal is
  // immediately visible without the user having to orbit.
  const viewportFaceDecalRef = useRef<(() => void) | null>(null)

  // Guard: faction-first preload fires at most once per session.
  const factionPreloadFiredRef = useRef(false)

  // overlayCanvasRef.current is initialized via the lazy-init guard above and
  // is stable across renders; it's safe to read here for passing to children.
  // eslint-disable-next-line react-hooks/refs -- offscreen canvas ref is set before this point via lazy-init guard and does not change
  const overlayCanvas = overlayCanvasRef.current

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-black"
      style={{
        // When invisible, the Editor mounts BEHIND the loading-state
        // AuthShell — viewport spins up its first model, no UI is
        // shown. Opacity transition handles the fade-in once the
        // parent flips `visible` true (which is paired with the
        // AuthShell's fade-out, so the two cross over without a flash).
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 320ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      {/* Viewport fills the screen — auto-scaled vehicle, free-orbit camera,
          and one of the three scene presets driving lighting + background
          (in_game_field / studio_grid / showcase). No staged composition
          or fog; the tank is the focal subject and the preset chrome
          carries the rest. Lazy-loaded so Three.js doesn't block the
          initial JS parse on first paint. */}
      <Suspense fallback={<div className="absolute inset-0 bg-black" />}>
        <Viewport
          root={root}
          vehicle={hideTank ? null : vehicle}
          overlayCanvas={overlayCanvas}
          overlayVersion={overlayVersion}
          onModelLoaded={(model, diffuseImg) => {
            baseDiffuseRef.current = diffuseImg
            // Store loaded meshes for the decal-pack preview UV probe.
            // Clearing the preview canvas here ensures a stale baked canvas
            // from the previous vehicle doesn't flash on screen while the
            // new one is being baked asynchronously.
            loadedMeshesRef.current = model ? model.meshes : null
            decalPreviewCanvasRef.current = null
            // Bump tick so the decal-preview effect re-fires with the new
            // baseDiffuse and meshes.
            setDecalPreviewTick(t => t + 1)
            // Extract the body UV wireframe so the texture editor can draw
            // the "unwrap" overlay on top of the flat atlas. Cheap (one pass
            // over body-mesh triangle edges); recomputed per model load.
            setUvLines(model ? extractBodyUvWireframe(model) : null)
            // Snapshot the pristine vanilla diffuse so applyCamo can
            // multiply-blend its procedural pattern over rivets/hatches/
            // welds without those details being eaten by every successive
            // camo application. Clone into a fresh canvas — baseDiffuseRef
            // gets mutated on every camo/decal pass.
            if (diffuseImg) {
              const clone = document.createElement('canvas')
              clone.width = clone.height = 2048
              clone.getContext('2d')!.drawImage(diffuseImg, 0, 0)
              vanillaDiffuseRef.current = clone
            } else {
              vanillaDiffuseRef.current = null
            }
            // Restore any persisted painted / pasted diffuse for this
            // vehicle first — customDiffuseUrl takes priority over a saved
            // camo preset because if both are set the user's later edit
            // (paint or paste) wins. Without this restore, switching
            // vehicles and back would silently lose every brush stroke
            // even though the data is still in the project (and would
            // export correctly).
            const savedDiffuse = diffuseImg
              ? effectiveCustomDiffuseUrl(projectRef.current, vehicle.id, vehicle.faction)
              : null
            if (savedDiffuse && diffuseImg) {
              const img = new Image()
              img.onload = () => {
                const cv = overlayCanvasRef.current
                if (!cv) return
                const ctx = cv.getContext('2d')!
                ctx.clearRect(0, 0, 2048, 2048)
                ctx.drawImage(img, 0, 0, 2048, 2048)
                if (baseDiffuseRef.current) {
                  const bctx = baseDiffuseRef.current.getContext('2d')
                  if (bctx) {
                    bctx.clearRect(0, 0, 2048, 2048)
                    bctx.drawImage(img, 0, 0, 2048, 2048)
                  }
                }
                bumpOverlay()
                repaint()
              }
              img.src = savedDiffuse
            } else {
              // No persisted paint — fall back to materialising any saved
              // camo preset. (If neither is set, repaint just shows vanilla.)
              const savedPreset = effectiveCamoPreset(
                projectRef.current,
                vehicle.id,
                vehicle.faction,
              )
              if (savedPreset && diffuseImg) {
                renderCamoPresetToOverlay(savedPreset)
                setCamoPreset(savedPreset)
              }
            }
            repaint()
            // Authoritative completion signal for the vehicle-loading beam.
            // (onModelLoaded is also fired by the season-reload helper, in
            // which case clearing vehicleLoading here is a harmless no-op
            // because it should already be false.) Also clears season-
            // loading: a fresh model load implicitly satisfies any pending
            // season swap that was queued for the same vehicle.
            setVehicleLoading(false)
            setSeasonLoading(false)
            // Seed the overlay with the freshly-decoded base diffuse. The
            // overlay canvas is what body materials bind as their `map`; for a
            // vanilla vehicle (no decals/camo) nothing else triggers a repaint
            // after this async callback sets baseDiffuseRef via a ref (which
            // does not re-render). Without this, the overlay stays the initial
            // blank canvas and the hull renders flat gray while tracks (non-
            // body materials, which keep their own texture) look fine.
            repaint()
            // Prefetch normal maps for adjacent vehicles in this faction
            // during idle time, so subsequent vehicle loads skip BC decode.
            const factionVehicles = vehiclesForFaction(vehicle.faction)
            const idx = factionVehicles.findIndex(v => v.id === vehicle.id)
            const adjacent = [factionVehicles[idx - 1]?.id, factionVehicles[idx + 1]?.id].filter(Boolean) as string[]
            schedulePrefetch(adjacent)
            // First-time-only handoff: tells App.tsx the editor-loading
            // AuthShell (the Connect loading circle) can fade out and the
            // Editor can become visible. Guarded by a ref (not state) so the
            // gating is synchronous and doesn't depend on React batching.
            const fireReady = () => {
              if (readyFiredRef.current) return
              readyFiredRef.current = true
              onReady?.()
            }
            // FULL warmup — runs once per session after the first model is
            // ready. Builds EVERY vehicle of EVERY faction into the pinned
            // cache (no eviction) so that, after Connect, switching to ANY
            // vehicle in ANY faction is a pure cache hit with zero loading and
            // no pad/camera change. The user's directive: "no loading except at
            // the connect button — everything loaded into RAM."
            //
            // REVEAL IMMEDIATELY: fireReady() is called as soon as the user's
            // first vehicle is on screen. The fleet warmup continues in the
            // background behind the now-visible editor. This removes the "stare
            // at the loading circle while 60 OTHER vehicles build" UX problem.
            //
            // NOTE: the vehicle RGM *bytes* are now preloaded during the
            // Connect screen's 'preloading' phase (ConnectScreen.tsx →
            // preloadFaction for every faction), so each buildVehicleIntoCache
            // below hits a warm bytesCache and skips disk I/O — only the GPU
            // mesh/texture build happens here.
            //
            // NO FALLBACK: every machine warms the full fleet at Connect. The
            // user's directive — "no fall back, optimise so all computers can
            // load it at once." We removed the old ≥4 GB deviceMemory gate.
            if (!factionPreloadFiredRef.current) {
              factionPreloadFiredRef.current = true
              // Pre-resolve EVERY vehicle's strip icon into the project cache,
              // in parallel, so the VehicleMenu rail never shows a placeholder→
              // icon pop after Connect. These are cheap bundled-PNG fetches;
              // fire-and-forget.
              void Promise.all(
                VEHICLES.map(v =>
                  resolveVehicleIcon(projectRef.current, v.id, v.faction, {
                    installRoot: root,
                    render3d: false,
                  }).catch(() => {}),
                ),
              )

              // The full fleet was CPU-warmed at Connect (ConnectScreen's
              // headless Viewport). Every vehicle is already in pinnedVehicleCache
              // — switching is a cache hit, so this vehicle is already rendered.
              // Reveal instantly: no background build loop needed.
              fireReady()
            } else {
              // Warmup already fired this session — reveal immediately.
              fireReady()
            }
          }}
          onSeasonReady={handleSeasonReady}
          onPick={addDecal}
          onHover={onHover}
          onReconnect={onDisconnect}
          onPartsLoaded={setParts}
          onPartClick={part => {
            // Explode-mode part picker.
            //   Clicking a part: select it for isolate inspection.
            //     explodeAll stays true so Viewport's isolate logic kicks in
            //     (hides other meshes, lerps controls.target toward the part).
            //   Clicking empty space / ESC: deselect → back to full exploded view.
            if (part) {
              setSelectedPart(part)
              // explodeAll remains true — isolate mode is a sub-state of explode
            } else {
              setSelectedPart(null)
              // Keep explodeAll on so all parts re-appear in exploded positions
            }
          }}
          selectedPart={selectedPart}
          explodeAll={explodeAll}
          season={season}
          envArchive={envArchive}
          envName={envName}
          showDestroyed={showDestroyed}
          showCrew={showCrew}
          preset={preset}
          controlsEnabled={true}
          preloadRef={viewportPreloadRef}
          faceDecalRef={viewportFaceDecalRef}
        />
      </Suspense>

      {/* Floating chrome — fades on idle.
       *
       *  `select-none` on the inner wrapper propagates to every chrome
       *  child (TopBar, VehicleMenu, SeasonToggle, GenerateButton,
       *  ScenePanel). Without this, dragging *from* a pill caption (text
       *  node selectable by default) into the viewport starts a text
       *  selection drag instead of an OrbitControls rotate — the user
       *  reported the tank refusing to rotate when their click began
       *  near labels like "Sturmtiger" or "Summer". */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-500"
        style={{ opacity: showChrome ? 1 : 0.35 }}
      >
        <div className="pointer-events-auto select-none">
          {/* Top-left: faction lobby + 7 menu buttons + dropdown panel */}
          <TopBar
            activePanel={activePanel}
            setActivePanel={setActivePanel}
            project={project}
            setProject={setProject}
            vehicle={vehicle}
            setVehicleId={handleSetVehicleId}
            season={season}
            setSeason={handleSetSeason}
            placeMode={placeMode}
            setPlaceMode={setPlaceMode}
            activeDecalId={activeDecalId}
            setActiveDecalId={setActiveDecalId}
            updateDecal={updateDecal}
            removeDecal={removeDecal}
            clearDecals={clearDecals}
            setMainDecalId={setMainDecalId}
            switchActiveSlot={switchActiveSlot}
            onDisconnect={onDisconnect}
            onClosePack={onClosePack}
            factionLocked={!!onClosePack}
            overlayCanvas={overlayCanvas}
            toast={toast.push}
            pendingImageId={pendingImageId}
            setPendingImageId={setPendingImageId}
            installRoot={root}
            onEditSlotIcon={setSlotIconEditingIdx}
            parts={parts}
            selectedPart={selectedPart}
            setSelectedPart={setSelectedPart}
            explodeAll={explodeAll}
            setExplodeAll={setExplodeAll}
            envArchive={envArchive}
            setEnvArchive={setEnvArchive}
            envName={envName}
            setEnvName={setEnvName}
            camoPrompt={camoPrompt}
            setCamoPrompt={setCamoPrompt}
            camoPreset={camoPreset}
            onApplyCamo={applyCamo}
            onApplyCamoImage={applyCamoImage}
            getVanillaAtlas={getVanillaAtlas}
            showCrew={showCrew}
            setShowCrew={setShowCrew}
            brushOn={brushOn}
            setBrushOn={setBrushOn}
            brushSettings={brushSettings}
            setBrushSettings={setBrushSettings}
            startEyedrop={handleStartEyedrop}
            clearBrushPaint={clearBrushPaint}
          />

          {/* Save indicator — fades in briefly after each auto-save.
               Inline style override applies the same --app-top-inset shim
               used by TopBar so the pill clears the Demo banner. */}
          {saveIndicator && (
            <div
              className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-40
                         text-[10px] text-[var(--color-text-3)] px-2 py-0.5 rounded-full
                         bg-black/30 border border-white/10 transition-opacity duration-300"
              style={{ top: 'calc(0.75rem + var(--app-top-inset, 0px))' }}
            >
              Saved
            </div>
          )}

          {/* Top-right was the visible undo/redo pair. The user asked for
              window controls (close / fullscreen / minimize-in-Electron) in
              that slot instead — those live in <WindowControls /> mounted at
              the App level, which now renders on both Electron and the web.
              Undo / Redo are still bound to Ctrl+Z / Ctrl+Y via the
              keyboard handlers in this component. */}

          {/* Left edge: faction switcher (C1) — mirrors ScenePanel on the
              right. A pack spans multiple factions, so this jumps between
              them rather than locking one at create time. */}
          <FactionPanel
            selected={selectedFaction}
            onSelect={handleSelectFaction}
            packFactions={packFactions}
          />

          {/* Right edge: 3 stacked scene-preset icons */}
          <ScenePanel presetId={presetId} setPresetId={setPresetId} />

          {/* Bottom-center: SeasonToggle + GenerateButton + VehicleMenu.
              Faction picking lives in the TopBar (lobby icon); this strip is
              purely vehicle navigation. Centered via left-1/2 + translate so
              it stays visually balanced regardless of vehicle-row width. */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex flex-col gap-2 items-center">
            <div className="flex items-center justify-center gap-4">
              {/* Explode: toggles the CAD-style exploded view so the user
               *  can see every submesh separately. Click an exploded part
               *  in the viewport to isolate it; click Collapse to reassemble.
               *  Hidden until a vehicle is loaded — there's nothing to
               *  explode otherwise. */}
              <ExplodeButton active={explodeAll} disabled={!vehicle} onClick={toggleExplode} />
              {/* "Back" affordance — visible only while a part is isolated
               *  inside explode mode. Clicking returns to the full exploded
               *  view without collapsing (ESC does the same). */}
              {explodeAll && selectedPart && (
                <button
                  type="button"
                  onClick={() => setSelectedPart(null)}
                  className="relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-all duration-150 select-none"
                  style={{
                    background: 'rgba(20, 22, 28, 0.72)',
                    color: 'rgb(229, 231, 235)',
                    backdropFilter: 'blur(36px) saturate(160%)',
                    border: '0.5px solid rgba(255,255,255,0.18)',
                    boxShadow:
                      '0 8px 22px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
                  }}
                  title="Back to exploded view (Esc)"
                  aria-label="Back to exploded view"
                >
                  ← Back to exploded view
                </button>
              )}
              <SeasonToggle value={season} onChange={handleSetSeason} loading={seasonLoading} />
              {/* Edit Texture pill — opens the FULL-SCREEN vehicle-texture
                  editor (A3): the live in-game atlas shown large, with brush
                  tools and a back button in the top-left. Previously this
                  merely toggled the cramped Decals side panel. */}
              <EditTextureButton
                brushOn={textureEditorOpen}
                disabled={!vehicle}
                onClick={() => setTextureEditorOpen(true)}
              />
            </div>
            {/* Template + decal-pack quick-pick pills, sitting directly above
                the vehicle selector rail. Template selection clones a fresh
                project (same contract as the centre-title identity popover);
                decal-pack selection records an association on the project. */}
            <TemplateDecalPills
              project={project}
              setProject={setProject}
              faction={vehicle.faction}
              onVehicleChange={handleSetVehicleId}
              currentVehicleId={vehicleId}
              installRoot={root}
            />
            <VehicleMenu
              vehicles={factionVehicles}
              selected={vehicle}
              onSelect={handleVehicleSelect}
              dirtyVehicles={dirtyVehicles}
              loading={vehicleLoading}
              iconResolver={resolveIcon}
            />
          </div>
        </div>
      </div>

      {/* Chrome-wake is handled by the document-level `mousemove` listener
       *  installed in the wake effect above (line ~235). We previously
       *  rendered an `absolute inset-0` overlay here whenever the chrome
       *  faded — its only job was to fire `setChromeVisible(true)` on
       *  mousemove. But that overlay sat between the user and the canvas
       *  and silently swallowed every mousedown that landed in faded-
       *  chrome state. The user clicked the tank to begin rotating, the
       *  overlay ate the pointerdown, OrbitControls never saw the gesture,
       *  and the tank refused to rotate until the user clicked a SECOND
       *  time (after the first click had woken the chrome and unmounted
       *  the overlay). Removing the overlay restores the rotation gesture
       *  on first click; the document-level wake listener still fires the
       *  moment the user moves the mouse over the editor at all. */}

      {/* Per-slot icon editor — full-screen overlay, opened from the
          SlotIconGrid inside the PackIdentityPopover. Rendered as a sibling
          of the floating-chrome div so it covers the entire editor surface. */}
      {slotIconEditingIdx !== null && project.exportSlots[slotIconEditingIdx] != null && (
        <SlotIconEditor
          slot={project.exportSlots[slotIconEditingIdx]!}
          onSave={next => {
            setProject(p => {
              const updated = structuredClone(p)
              const s = updated.exportSlots[slotIconEditingIdx!]
              if (s) {
                s.slotIcon = next ?? undefined
              }
              updated.modifiedAt = new Date().toISOString()
              return updated
            })
            setSlotIconEditingIdx(null)
          }}
          onBack={() => setSlotIconEditingIdx(null)}
        />
      )}

      {/* A3: full-screen vehicle-texture editor overlay. */}
      {textureEditorOpen && vehicle && overlayCanvasRef.current && (
        <VehicleTextureEditor
          overlayCanvas={overlayCanvasRef.current}
          baseDiffuse={baseDiffuseRef.current}
          vanilla={vanillaDiffuseRef.current}
          version={overlayVersion}
          brush={brushSettings}
          setBrush={setBrushSettings}
          onStrokeBegin={() => { history.commit('Paint'); setHistoryGeneration(g => g + 1) }}
          onComposite={repaint}
          onStrokeEnd={persistBrushStroke}
          onClear={clearBrushPaint}
          onBack={() => setTextureEditorOpen(false)}
          onUndo={() => { const s = history.undo(); if (s) toast.push(`Undo: ${s.label}`, 'info'); setHistoryGeneration(g => g + 1) }}
          canUndo={history.canUndo()}
          onRedo={() => { const s = history.redo(); if (s) toast.push(`Redo: ${s.label}`, 'info'); setHistoryGeneration(g => g + 1) }}
          canRedo={history.canRedo()}
          vehicleName={veh.name ?? vehicle.id}
          uvLines={uvLines}
        />
      )}

      {toastNode}

      <ShortcutHelpSheet />
      <OnboardingOverlay />

    </div>
  )
}

// ---------------------------------------------------------------------------
// SyncStatusPill — a small textual Live-Sync indicator that sits above the
// bottom vehicle toolbar. The TopBar already shows an icon-only LiveSyncBadge
// but the user couldn't tell at a glance whether autosync was running, so we
// surface a labelled pill near the action surface (paint / generate / vehicle
// switch) where they care about it most.
// ---------------------------------------------------------------------------
// SyncStatusPill is ready to drop into the vehicle toolbar when needed —
// kept here for easy re-activation (see comment block above).
// function SyncStatusPill() { ... }

function defaultSize(t: DecalType | 'off'): number {
  switch (t) {
    case 'shield':
      return 110
    case 'number':
      return 110
    case 'name':
      return 56
    case 'kills':
      return 200
    case 'cross':
      return 100
    default:
      return 100
  }
}
