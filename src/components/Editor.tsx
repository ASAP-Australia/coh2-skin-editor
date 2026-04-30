import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Viewport from './Viewport'
import TopMenu from './TopMenu'
import PackIconCard from './PackIconCard'
import FactionNav from './FactionNav'
import { VEHICLES } from '@/lib/vehicles'
import {
  type Coh2SkinProject, type Decal, type DecalType,
  newProject, getOrInitVehicle, persistActive, loadActive,
} from '@/lib/project'
import { paintDecals, type RenderContext } from '@/lib/decal-painter'

interface Props {
  root: FileSystemDirectoryHandle
  onDisconnect: () => void
}

export default function Editor({ root, onDisconnect }: Props) {
  const [project, setProject] = useState<Coh2SkinProject>(() => loadActive() ?? newProject('My Skin Pack'))
  const [season, setSeason] = useState<'summer' | 'winter'>('summer')
  const [vehicleId, setVehicleId] = useState<string>(project.lastVehicleId ?? 'tiger')
  const [activeMenu, setActiveMenu] = useState<'view' | 'decals' | 'reference' | 'export' | null>(null)
  const [placeMode, setPlaceMode] = useState<DecalType | 'off'>('off')
  const [activeDecalId, setActiveDecalId] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)

  const vehicle = useMemo(() => VEHICLES.find(v => v.id === vehicleId) ?? VEHICLES[0], [vehicleId])
  const veh = useMemo(() => getOrInitVehicle(project, vehicle.id), [project, vehicle.id])

  // ---- offscreen 2048² canvas where we composite the diffuse + decals
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!overlayCanvasRef.current) {
    const c = document.createElement('canvas')
    c.width = c.height = 2048
    overlayCanvasRef.current = c
  }
  const baseDiffuseRef = useRef<HTMLCanvasElement | null>(null)

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
      v.decals.push({
        id: newId, type: placeMode as DecalType, x, y, rot: 0,
        size: defaultSize(placeMode),
        kills: placeMode === 'kills' ? 8 : undefined,
      })
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

  return (
    <div className="min-h-dvh w-full relative overflow-hidden">
      <Viewport
        root={root}
        vehicle={vehicle}
        overlayCanvas={overlayCanvasRef.current}
        onModelLoaded={(_model, diffuseImg) => {
          baseDiffuseRef.current = diffuseImg
          repaint()
        }}
        onPick={addDecal}
        onHover={onHover}
      />

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
        overlayCanvas={overlayCanvasRef.current}
      />

      <PackIconCard
        packName={project.packName}
        diffuseCanvas={baseDiffuseRef.current}
        palette={project.palette}
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
