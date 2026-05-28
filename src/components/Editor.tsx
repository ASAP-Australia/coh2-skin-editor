import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Viewport from './Viewport'
import TopMenu from './TopMenu'
import FactionNav from './FactionNav'
import ScenePanel from './ScenePanel'
import { useToasts } from './Toasts'
import { VEHICLES } from '@/lib/vehicles'
import {
  type Coh2SkinProject, type Decal, type DecalType,
  newProject, getOrInitVehicle, persistActive, loadActive,
  addImageFromFile,
} from '@/lib/project'
import { paintDecals, type RenderContext } from '@/lib/decal-painter'
// (relTime removed with bottom-right "saved Xs ago" indicator)
import { SgaArchive } from '@/lib/sga'
import { generateCamo, type CamoPreset } from '@/lib/camo-generator'
import { type PresetId, loadPresetId, persistPresetId } from '@/lib/scene-settings'

interface Props {
  root: FileSystemDirectoryHandle
  onDisconnect: () => void
}

export default function Editor({ root, onDisconnect }: Props) {
  const { api: toast, node: toastNode } = useToasts()
  const [project, setProject] = useState<Coh2SkinProject>(() => loadActive() ?? newProject('My Skin Pack'))
  const [season, setSeason] = useState<'summer' | 'winter'>('summer')
  const [presetId, setPresetId] = useState<PresetId>(() => loadPresetId())
  // Default to Brummbär — Tiger has a packed-stride RGM variant the parser
  // doesn't handle yet (every submesh skipped → empty viewport). Brummbär is
  // a well-tested model. Users can still pick Tiger from the nav and (when
  // the parser ships) it will start working. Also clobber any persisted
  // lastVehicleId == 'tiger' so existing users don't get an empty viewport.
  const [vehicleId, setVehicleId] = useState<string>(() => {
    const saved = project.lastVehicleId
    if (!saved || saved === 'tiger') return 'brummbar'
    return saved
  })
  const [activeMenu, setActiveMenu] = useState<'view' | 'decals' | 'reference' | 'export' | 'parts' | 'camo' | 'scene' | null>(null)
  const [placeMode, setPlaceMode] = useState<DecalType | 'off'>('off')
  // Exploded parts view
  const [parts, setParts] = useState<string[]>([])
  const [selectedPart, setSelectedPart] = useState<string | null>(null)
  const [explodeAll, setExplodeAll] = useState(false)
  // Environment / skybox
  const [envArchive, setEnvArchive] = useState<SgaArchive | null>(null)
  const [envName, setEnvName] = useState('mission_06')
  // Toggle between intact and destroyed/wrecked variants of the model.
  const [showDestroyed] = useState(false)
  // Camo state — stored separately from project (not persisted, preview only)
  const [camoPreset, setCamoPreset] = useState<CamoPreset | null>(null)
  const [camoPrompt, setCamoPrompt] = useState('')
  const [activeDecalId, setActiveDecalId] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [pendingImageId, setPendingImageId] = useState<string | null>(null)
  // (Per-second tick for the saved-ago indicator removed with the indicator.)

  // Idle-fade the chrome so the tank takes over when the user is just
  // orbiting. Mouse movement / interaction wakes it up; 4s without
  // activity fades to 35% opacity. Pressing F or H also force-hides.
  const [chromeVisible, setChromeVisible] = useState(true)
  const [chromeForcedHidden, setChromeForcedHidden] = useState(false)
  useEffect(() => {
    let timer: number | undefined
    const wake = () => {
      setChromeVisible(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setChromeVisible(false), 4000)
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
        setActiveMenu(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const showChrome = chromeVisible && !chromeForcedHidden

  // Persist the active scene preset whenever it changes.
  useEffect(() => { persistPresetId(presetId) }, [presetId])

  const vehicle = useMemo(() => VEHICLES.find(v => v.id === vehicleId) ?? VEHICLES[0], [vehicleId])
  const veh = useMemo(() => getOrInitVehicle(project, vehicle.id), [project, vehicle.id])

  // ---- offscreen 2048² canvas where we composite the diffuse + decals.
  // Stored in state (lazy initializer) so the canvas reference is stable
  // and accessible in JSX without touching a ref during render.
  const [overlayCanvas] = useState<HTMLCanvasElement>(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 2048
    return c
  })
  const overlayCanvasRef = useRef<HTMLCanvasElement>(overlayCanvas)
  const baseDiffuseRef = useRef<HTMLCanvasElement | null>(null)

  // Apply camo to the base diffuse canvas
  const applyCamo = useCallback((preset: CamoPreset) => {
    const cv = overlayCanvasRef.current
    if (!cv) return
    const tmp = document.createElement('canvas')
    tmp.width = tmp.height = 2048
    generateCamo(tmp, preset)
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, 2048, 2048)
    ctx.drawImage(tmp, 0, 0)
    // Also paint over baseDiffuse ref so it persists through repaint
    if (baseDiffuseRef.current) {
      const bctx = baseDiffuseRef.current.getContext('2d')
      if (bctx) { bctx.clearRect(0, 0, 2048, 2048); bctx.drawImage(tmp, 0, 0) }
    }
    setCamoPreset(preset)
  }, [])

  // Repaint whenever the project / vehicle / hover changes
  const repaint = useCallback(() => {
    const cv = overlayCanvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, 2048, 2048)
    if (baseDiffuseRef.current) ctx.drawImage(baseDiffuseRef.current, 0, 0, 2048, 2048)
    const renderCtx: RenderContext = {
      ctx, palette: project.palette,
      defaultTac: vehicle.defaultTac,
      vehicleName: veh.name ?? '',
      tac: veh.tac ?? vehicle.defaultTac,
      images: project.images ?? {},
    }
    paintDecals(renderCtx, veh.decals, activeDecalId)
    // Hover preview — translucent ghost of the next-place decal
    if (hover && placeMode !== 'off') {
      ctx.globalAlpha = 0.55
      paintDecals(renderCtx, [{
        id: -1, type: placeMode, x: hover.x, y: hover.y, rot: 0,
        size: defaultSize(placeMode),
      }], -1)
      ctx.globalAlpha = 1
    }
  }, [project.palette, vehicle.defaultTac, veh.name, veh.tac, veh.decals, activeDecalId, hover, placeMode])

  useEffect(() => {
    repaint()
    persistActive(project)
  }, [repaint, project])

  // ---- decal manipulation helpers
  const updateProject = (mut: (p: Coh2SkinProject) => void) => {
    setProject(p => {
      const copy = structuredClone(p)
      mut(copy)
      return copy
    })
  }
  const addDecal = (uv: { u: number; v: number }) => {
    if (placeMode === 'off') return
    const x = Math.round(uv.u * 2048)
    const y = Math.round((1 - uv.v) * 2048)
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      const newId = (v.decals.reduce((m, d) => Math.max(m, d.id), 0) ?? 0) + 1
      const d: Decal = {
        id: newId, type: placeMode as DecalType, x, y, rot: 0,
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
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      const d = v.decals.find(x => x.id === id)
      if (d) Object.assign(d, patch)
    })
  }
  const removeDecal = (id: number) => {
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      v.decals = v.decals.filter(x => x.id !== id)
    })
    if (activeDecalId === id) setActiveDecalId(null)
  }
  const clearDecals = () => {
    updateProject(p => {
      const v = getOrInitVehicle(p, vehicle.id)
      v.decals = []
    })
    setActiveDecalId(null)
  }

  // ---- viewport hover throttle (rAF)
  const hoverPendingRef = useRef(false)
  const onHover = useCallback((uv: { u: number; v: number } | null) => {
    if (placeMode === 'off') {
      if (hover) setHover(null)
      return
    }
    if (hoverPendingRef.current) return
    hoverPendingRef.current = true
    requestAnimationFrame(() => {
      hoverPendingRef.current = false
      if (!uv) { setHover(null); return }
      setHover({ x: Math.round(uv.u * 2048), y: Math.round((1 - uv.v) * 2048) })
    })
  }, [placeMode, hover])

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
          } catch {/* fall through to image handler */}
        }
        if (f.type.startsWith('image/')) {
          const copy = structuredClone(project)
          const id = await addImageFromFile(copy, f)
          setProject(copy)
          setPendingImageId(id)
          setPlaceMode('image')
          setActiveMenu('decals')
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
  }, [project, toast])

  return (
    <div className="h-dvh w-full relative overflow-hidden">
      <Viewport
        root={root}
        vehicle={vehicle}
        overlayCanvas={overlayCanvas}
        onModelLoaded={(_model, diffuseImg) => {
          baseDiffuseRef.current = diffuseImg
          repaint()
        }}
        onPick={addDecal}
        onHover={onHover}
        onReconnect={onDisconnect}
        onPartsLoaded={setParts}
        selectedPart={selectedPart}
        explodeAll={explodeAll}
        season={season}
        envArchive={envArchive}
        envName={envName}
        showDestroyed={showDestroyed}
        presetId={presetId}
      />

      {/* Chrome-fade wrapper: everything inside fades away when the user is
          idle / has hit F to focus on the tank. Pointer events ignore the
          dimmed state so a wake-up movement still hits a button cleanly. */}
      <div className={`contents transition-opacity duration-300 ${showChrome ? 'opacity-100' : 'opacity-0'}`}>
        <TopMenu
          active={activeMenu}
          setActive={setActiveMenu}
          project={project}
          setProject={setProject}
          vehicle={vehicle}
          season={season}
          setSeason={setSeason}
          placeMode={placeMode}
          setPlaceMode={setPlaceMode}
          activeDecalId={activeDecalId}
          setActiveDecalId={setActiveDecalId}
          updateDecal={updateDecal}
          removeDecal={removeDecal}
          clearDecals={clearDecals}
          onDisconnect={onDisconnect}
          overlayCanvas={overlayCanvas}
          toast={toast.push}
          pendingImageId={pendingImageId}
          setPendingImageId={setPendingImageId}
          installRoot={root}
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
        />

        <FactionNav
          project={project}
          currentId={vehicle.id}
          onPick={(id) => {
            setVehicleId(id)
            setActiveDecalId(null)
            updateProject(p => { p.lastVehicleId = id })
          }}
        />

        {/* Intact/Wrecked toggle removed at user request — viewer always
            shows the intact variant. `showDestroyed` stays wired (always
            false) so Viewport's submesh classifier still filters wrecks out. */}

        {/* Auto-save indicator removed at user request — was reading
            as cluttering the dark viewport. Save state still happens via
            the "saved Xs ago" line inside the View menu. */}
      </div>

      {/* Scene preset picker — always visible (not dimmed with the rest of
          the chrome) so the user can switch environment without having to
          first wake the UI. ScenePanel positions itself via `fixed`. */}
      <ScenePanel presetId={presetId} setPresetId={setPresetId} />

      {/* Persistent — never dims. Toast notifications + a 'wake' affordance
          so the user knows the chrome is just hidden, not gone. */}
      {!showChrome && (
        <div
          className="absolute inset-0 cursor-default"
          onMouseMove={() => setChromeVisible(true)}
        />
      )}

      {toastNode}
    </div>
  )
}

function defaultSize(t: DecalType | 'off'): number {
  switch (t) {
    case 'shield': return 110
    case 'number': return 110
    case 'name':   return 56
    case 'kills':  return 200
    case 'cross':  return 100
    default:       return 100
  }
}
