import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { locateArchives } from '@/lib/coh2-fs'
import { SgaArchive } from '@/lib/sga'
import { parseRgm, type RgmModel } from '@/lib/rgm'
import { decodeRgt, rgtToCompressedTexture } from '@/lib/rgt'
import { bcToCanvas } from '@/lib/bc-decode'
import { rgmPath, type VehicleSpec } from '@/lib/vehicles'
// (skybox helpers retained in lib/ for reference but no longer used — Three.Sky drives the backdrop)

interface LightingPreset {
  ambientColor: number; ambientIntensity: number
  sunColor: number; sunIntensity: number
  sunElevation: number // degrees above horizon
  fillColor: number; fillIntensity: number
  fogColor: number; fogNear: number; fogFar: number
}

const LIGHTING: Record<'summer' | 'winter', LightingPreset> = {
  summer: {
    ambientColor: 0xd4b896, ambientIntensity: 0.55,
    sunColor: 0xffeddd,    sunIntensity: 0.85, sunElevation: 45,
    fillColor: 0x9eb4d1,   fillIntensity: 0.35,
    fogColor: 0xc8b89a,    fogNear: 30, fogFar: 90,
  },
  winter: {
    ambientColor: 0x9ab4cc, ambientIntensity: 0.50,
    sunColor: 0xe8f0ff,     sunIntensity: 0.75, sunElevation: 20,
    fillColor: 0x7090b0,    fillIntensity: 0.30,
    fogColor: 0xc5d5e8,     fogNear: 25, fogFar: 75,
  },
}

interface Props {
  root: FileSystemDirectoryHandle
  vehicle: VehicleSpec | null
  overlayCanvas?: HTMLCanvasElement | null
  onModelLoaded?: (model: RgmModel, diffuseImage: HTMLCanvasElement | null) => void
  onPick?: (uv: { u: number; v: number }) => void
  onHover?: (uv: { u: number; v: number } | null) => void
  onReconnect?: () => void
  /** Parts list emitted once the model loads. */
  onPartsLoaded?: (parts: string[]) => void
  /** Highlight + explode this submesh name. Null = deselect all. */
  selectedPart: string | null
  /** Explode all parts outward simultaneously. */
  explodeAll: boolean
  /** Current season — controls lighting + skybox + terrain. */
  season: 'summer' | 'winter'
  /** ArtEnvironment.sga archive for skybox + terrain. Null = plain background. */
  envArchive: SgaArchive | null
  /** Environment name to use (e.g. "mission_06"). */
  envName: string
  /** When true, show the wrecked/destroyed variant of the model instead of
   *  the intact one. Many CoH2 RGM files bundle both variants in submesh
   *  groups whose names contain "destroyed" / "wreck" — toggling this swaps
   *  which set is rendered. */
  showDestroyed?: boolean
}

// ---------------------------------------------------------------------------
// Submesh classification — many vehicle .rgm files include both intact and
// destroyed/wreck variants, sometimes overlapping in world space. We split
// them by name pattern so the user always sees one variant cleanly.
// ---------------------------------------------------------------------------
const DESTROYED_PATTERNS = [
  /destroy/i, /wreck/i, /destruction/i, /burnt/i, /broken/i, /\bdmg\b/i, /_dam_/i,
]
function isDestroyedMesh(name: string): boolean {
  return DESTROYED_PATTERNS.some(re => re.test(name))
}

export default function Viewport({
  root, vehicle, overlayCanvas, onModelLoaded, onPick, onHover, onReconnect,
  onPartsLoaded, selectedPart, explodeAll, season,
  envArchive: _envArchive, envName: _envName,
  showDestroyed = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const sceneRef     = useRef<THREE.Scene | null>(null)
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef  = useRef<OrbitControls | null>(null)
  const meshGroupRef = useRef<THREE.Group | null>(null)
  const baseTextureRef   = useRef<THREE.Texture | null>(null)
  const overlayTexRef    = useRef<THREE.CanvasTexture | null>(null)
  const raycasterRef     = useRef(new THREE.Raycaster())
  const pointerRef       = useRef(new THREE.Vector2())
  const ambientRef       = useRef<THREE.AmbientLight | null>(null)
  const sunRef           = useRef<THREE.DirectionalLight | null>(null)
  const fillRef          = useRef<THREE.DirectionalLight | null>(null)
  const groundMeshRef    = useRef<THREE.Mesh | null>(null)
  const groundMatRef     = useRef<THREE.MeshStandardMaterial | null>(null)
  const skyRef           = useRef<Sky | null>(null)
  const pmremRef         = useRef<THREE.PMREMGenerator | null>(null)

  // Explode animation state
  const submeshMapsRef   = useRef<Map<string, THREE.Mesh>>(new Map())
  const origPosRef       = useRef<Map<string, THREE.Vector3>>(new Map())
  const targetPosRef     = useRef<Map<string, THREE.Vector3>>(new Map())
  const explodeProgressRef = useRef(1) // 1 = done animating

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // =========================================================================
  // Scene init (once)
  // =========================================================================
  useEffect(() => {
    if (!canvasRef.current) return
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)
    camera.position.set(8, 4, 8)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, canvasRef.current)
    controls.enableDamping = true
    controls.target.set(0, 1.2, 0)
    controlsRef.current = controls

    // Lights — refs so we can update them when season changes
    const ambient = new THREE.AmbientLight(0xffffff, 0.55)
    ambientRef.current = ambient
    scene.add(ambient)

    const sun = new THREE.DirectionalLight(0xffeddd, 0.85)
    sun.position.set(5, 8, 5)
    sunRef.current = sun
    scene.add(sun)

    const fill = new THREE.DirectionalLight(0x9eb4d1, 0.35)
    fill.position.set(-5, 3, -4)
    fillRef.current = fill
    scene.add(fill)

    // Realistic procedural sky — Three's Sky shader (Preetham/Hosek-Wilkie
    // atmospheric scattering). Looks far better than a gradient cubemap.
    const sky = new Sky()
    sky.scale.setScalar(450000)
    const skySun = new THREE.Vector3()
    const skyUniforms = sky.material.uniforms
    // Tuned for a calmer, deeper-blue daytime sky — the previous default
    // (rayleigh 1.5, turbidity 8, low sun) put a lot of bright haze around
    // the horizon which then washed-out the glassmorphic chrome that uses
    // backdrop-blur. Higher rayleigh + cooler params keep the upper hemisphere
    // saturated blue and the horizon a soft warm haze rather than full white.
    skyUniforms.turbidity.value      = 4
    skyUniforms.rayleigh.value       = 3
    skyUniforms.mieCoefficient.value = 0.005
    skyUniforms.mieDirectionalG.value= 0.7
    // Higher sun = darker, more saturated background, less haze in viewport
    const phi   = THREE.MathUtils.degToRad(90 - 65)   // elevation 65°
    const theta = THREE.MathUtils.degToRad(180)       // azimuth
    skySun.setFromSphericalCoords(1, phi, theta)
    skyUniforms.sunPosition.value.copy(skySun)
    scene.add(sky)
    skyRef.current = sky

    // PMREM-baked environment so the model picks up sky reflections / IBL
    const pmremGen = new THREE.PMREMGenerator(renderer)
    pmremRef.current = pmremGen
    const envSceneForPmrem = new THREE.Scene()
    const envSky = new Sky()
    envSky.scale.setScalar(450000)
    envSky.material.uniforms.turbidity.value       = skyUniforms.turbidity.value
    envSky.material.uniforms.rayleigh.value        = skyUniforms.rayleigh.value
    envSky.material.uniforms.mieCoefficient.value  = skyUniforms.mieCoefficient.value
    envSky.material.uniforms.mieDirectionalG.value = skyUniforms.mieDirectionalG.value
    envSky.material.uniforms.sunPosition.value.copy(skySun)
    envSceneForPmrem.add(envSky)
    scene.environment = pmremGen.fromScene(envSceneForPmrem).texture

    // Ground — large, gently coloured plane. No procedural noise — clean
    // PBR material so the tank reads as the visual subject. The skybox
    // tints it via env lighting, so don't fight it with a strong colour.
    const groundGeo = new THREE.PlaneGeometry(200, 200, 1, 1)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x4a463c, metalness: 0, roughness: 1.0,
    })
    groundMatRef.current = groundMat
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    groundMeshRef.current = ground
    scene.add(ground)

    // Subtle contact-shadow grid only — helps spatial reading without the
    // "techy" look of a full grid helper.
    const grid = new THREE.GridHelper(60, 30, 0x000000, 0x000000)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.10
    grid.position.y = 0.005
    scene.add(grid)

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      controls.update()
      if (overlayTexRef.current) overlayTexRef.current.needsUpdate = true

      // Explode animation lerp
      if (explodeProgressRef.current < 1) {
        explodeProgressRef.current = Math.min(1, explodeProgressRef.current + 0.06)
        const t = easeOut(explodeProgressRef.current)
        for (const [name, mesh] of submeshMapsRef.current) {
          const orig   = origPosRef.current.get(name) ?? new THREE.Vector3()
          const target = targetPosRef.current.get(name) ?? orig
          mesh.position.lerpVectors(orig, target, t)
        }
      }

      renderer.render(scene, camera)
    }
    tick()

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return
      const { clientWidth: w, clientHeight: h } = containerRef.current
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      ro.disconnect()
      renderer.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // =========================================================================
  // Season → lighting
  // =========================================================================
  useEffect(() => {
    const p = LIGHTING[season]
    if (ambientRef.current) {
      ambientRef.current.color.setHex(p.ambientColor)
      ambientRef.current.intensity = p.ambientIntensity
    }
    if (sunRef.current) {
      const elev = (p.sunElevation * Math.PI) / 180
      sunRef.current.position.set(Math.cos(elev) * 6, Math.sin(elev) * 8, 5)
      sunRef.current.color.setHex(p.sunColor)
      sunRef.current.intensity = p.sunIntensity
    }
    if (fillRef.current) {
      fillRef.current.color.setHex(p.fillColor)
      fillRef.current.intensity = p.fillIntensity
    }
    // No fog — the Sky shader handles atmospheric falloff. Clamp to null
    // in case a previous run left a fog instance on the scene.
    if (sceneRef.current) sceneRef.current.fog = null
  }, [season])

  // Env archive override is intentionally disabled — the Three.Sky shader
  // and the clean PBR ground look better than the CoH2 sky/terrain RGTs
  // pulled from ArtEnvironment.sga (which were the source of the "weird
  // ground texture" complaint). Keeping the archive plumbing in place so
  // the env switcher in TopMenu still wires up; just no longer applied.

  // =========================================================================
  // Load vehicle model
  // =========================================================================
  useEffect(() => {
    if (!vehicle || !sceneRef.current) return
    let cancelled = false
    setLoading(true); setErr(null)

    // Detect demo mode by the stub handle's name (set in App.tsx).
    const isDemo = root?.name === 'Demo (no real install)'

    const buildPlaceholderTank = () => {
      // Block-out tank silhouette so demo mode reads as "tank-shaped" — the
      // actual model loads once the user connects their CoH2 install.
      const scene = sceneRef.current!
      const oldGroup = meshGroupRef.current
      if (oldGroup) {
        scene.remove(oldGroup)
        oldGroup.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose() })
      }
      const group = new THREE.Group()
      const matBody = new THREE.MeshStandardMaterial({ color: 0x6e6a55, metalness: 0.1, roughness: 0.85 })
      const matTreads = new THREE.MeshStandardMaterial({ color: 0x2a2823, metalness: 0.05, roughness: 0.95 })
      // Hull
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.8), matBody)
      hull.position.y = 0.85; group.add(hull)
      // Turret
      const turret = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 1.4), matBody)
      turret.position.y = 1.6; group.add(turret)
      // Barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 16), matBody)
      barrel.rotation.z = Math.PI / 2
      barrel.position.set(2.0, 1.7, 0); group.add(barrel)
      // Tracks
      for (const z of [-1.0, 1.0]) {
        const track = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.4), matTreads)
        track.position.set(0, 0.35, z); group.add(track)
      }
      group.position.y = 0.4
      scene.add(group)
      meshGroupRef.current = group
      submeshMapsRef.current = new Map()
      origPosRef.current = new Map()
      targetPosRef.current = new Map()
      explodeProgressRef.current = 1
      onPartsLoaded?.([])
      onModelLoaded?.({ meshes: [], textureSets: [], materials: new Map() } as any, null)
    }

    const run = async () => {
      if (isDemo) {
        buildPlaceholderTank()
        setLoading(false)
        return
      }
      try {
        const archives = await locateArchives(root)
        if (!archives) throw new Error('Archives folder not found.')
        const sgaCandidates = [
          'ArtHigh.sga', 'ArtArmies.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtAEF.sga',
        ]
        let sga: SgaArchive | null = null
        let rgmBytes: Uint8Array | null = null
        for (const sgaName of sgaCandidates) {
          try {
            const fh = await archives.getFileHandle(sgaName)
            const file = await fh.getFile()
            const a = await SgaArchive.open(file)
            const b = await a.readByPath(rgmPath(vehicle))
            console.log('[viewport] tried', sgaName, 'for', rgmPath(vehicle), '→', b ? `FOUND ${b.length} bytes` : 'not found')
            if (b) { sga = a; rgmBytes = b; break }
          } catch (e) {
            console.log('[viewport] err on', sgaName, ':', String(e))
          }
        }
        if (!sga || !rgmBytes) {
          throw new Error(`Couldn't find ${rgmPath(vehicle)} in any of the loaded archives.`)
        }
        const model = parseRgm(rgmBytes)
        if (cancelled) return

        let diffuse: THREE.Texture | null = null
        let diffuseImage: HTMLCanvasElement | null = null
        // Texture lookup priority — try several patterns so vehicles with
        // unconventional naming (Tiger I → 'tiger_dif', some have 'tiger_hull_dif')
        // still resolve. Skip destroyed/wreck textures.
        const lower = (s: string) => s.toLowerCase()
        const id = vehicle.id.toLowerCase()
        const candidates = model.textureSets
          .filter(t => !isDestroyedMesh(t) && /_dif$/i.test(t))
          .sort((a, b) => {
            // Prefer tsets whose basename includes the vehicle id
            const aMatch = lower(a).includes(id) ? 0 : 1
            const bMatch = lower(b).includes(id) ? 0 : 1
            if (aMatch !== bMatch) return aMatch - bMatch
            // Then prefer shorter (less likely to be a hull/turret variant)
            return a.length - b.length
          })
        const difTset = candidates[0]
        if (difTset) {
          const path = difTset.replace(/\\/g, '/').toLowerCase() + '.rgt'
          // Try the SGA that held the RGM first (most common), then fall
          // through to every other candidate. CoH2 splits some vehicles —
          // mesh in ArtHigh.sga, diffuse in ArtArmies.sga.
          let rgtBytes = await sga.readByPath(path)
          if (!rgtBytes) {
            for (const sgaName of sgaCandidates) {
              try {
                const fh = await archives.getFileHandle(sgaName)
                const file = await fh.getFile()
                const a = await SgaArchive.open(file)
                const b = await a.readByPath(path)
                if (b) {
                  console.log('[viewport] diffuse', path, '← fallback', sgaName, b.length, 'bytes')
                  rgtBytes = b
                  break
                }
              } catch {/* ignore */}
            }
          }
          if (rgtBytes) {
            try {
              const rgt = decodeRgt(rgtBytes)
              diffuseImage = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
              diffuse = new THREE.CanvasTexture(diffuseImage)
              diffuse.flipY = true
              diffuse.colorSpace = THREE.SRGBColorSpace
              diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
              diffuse.anisotropy = 4
            } catch {
              try { diffuse = rgtToCompressedTexture(decodeRgt(rgtBytes)) } catch {/* ignore */}
            }
          }
        }
        if (cancelled) return

        const scene = sceneRef.current!
        const oldGroup = meshGroupRef.current
        if (oldGroup) {
          scene.remove(oldGroup)
          oldGroup.traverse(o => {
            if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose()
          })
        }
        if (baseTextureRef.current) baseTextureRef.current.dispose()
        baseTextureRef.current = diffuse

        const group = new THREE.Group()
        const submeshMap = new Map<string, THREE.Mesh>()
        const origPos    = new Map<string, THREE.Vector3>()

        // Partition: intact vs destroyed. Many CoH2 .rgm files contain both
        // variants in the same file, overlapping in world space — rendering
        // both at once causes z-fighting (the "tiger clipping into destroyed
        // tiger" bug). We always render only one set; the showDestroyed prop
        // selects which.
        const intact:    typeof model.meshes = []
        const destroyed: typeof model.meshes = []
        for (const sub of model.meshes) {
          if (isDestroyedMesh(sub.name)) destroyed.push(sub)
          else intact.push(sub)
        }
        // Fallback: if showDestroyed is requested but no destroyed parts
        // were tagged, fall back to intact so we don't render an empty scene.
        const visible = showDestroyed && destroyed.length > 0 ? destroyed
                      : intact.length > 0 ? intact
                      : model.meshes

        for (const sub of visible) {
          const mat = new THREE.MeshStandardMaterial({
            map: diffuse,
            color: diffuse ? 0xffffff : 0x9aa18b,
            metalness: 0.05, roughness: 0.85,
          })
          const m = new THREE.Mesh(sub.geometry, mat)
          m.name = sub.name
          group.add(m)
          submeshMap.set(sub.name, m)
          origPos.set(sub.name, new THREE.Vector3(0, 0, 0))
        }

        // Auto-fit: scale model so longest axis = ~5 units, centre it
        // horizontally, and rest its tracks ON the ground (bbox.min.y = 0).
        const box = new THREE.Box3().setFromObject(group)
        const size = box.getSize(new THREE.Vector3())
        const longest = Math.max(size.x, size.y, size.z)
        const scale = longest > 0.0001 ? 5 / longest : 0.01
        group.scale.setScalar(scale)
        // Recompute box AFTER scaling so we can correctly place it on the ground
        const scaledBox = new THREE.Box3().setFromObject(group)
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3())
        // Centre X/Z, then push the bottom of the bbox down to y=0
        group.position.x = -scaledCenter.x
        group.position.z = -scaledCenter.z
        group.position.y = -scaledBox.min.y
        scene.add(group)

        // Recentre orbit camera target on the model's actual centre so the
        // user orbits around the tank, not a hardcoded point in space.
        const finalBox = new THREE.Box3().setFromObject(group)
        const finalCenter = finalBox.getCenter(new THREE.Vector3())
        const finalSize = finalBox.getSize(new THREE.Vector3())
        if (controlsRef.current) {
          controlsRef.current.target.copy(finalCenter)
          controlsRef.current.update()
        }
        // Pull camera back to frame the bounding sphere, with a comfortable margin
        if (cameraRef.current) {
          const radius = finalSize.length() * 0.5
          const fovRad = (cameraRef.current.fov * Math.PI) / 180
          const dist = (radius / Math.sin(fovRad / 2)) * 1.15
          // Maintain 3/4 viewing angle: front-right + slightly elevated
          const dir = new THREE.Vector3(1, 0.55, 1).normalize()
          cameraRef.current.position.copy(finalCenter).addScaledVector(dir, dist)
          cameraRef.current.lookAt(finalCenter)
          cameraRef.current.updateProjectionMatrix()
        }
        meshGroupRef.current = group
        submeshMapsRef.current = submeshMap
        origPosRef.current = origPos
        targetPosRef.current = new Map(Array.from(origPos.entries()).map(([k, v]) => [k, v.clone()]))
        explodeProgressRef.current = 1

        onPartsLoaded?.(Array.from(submeshMap.keys()))
        onModelLoaded?.(model, diffuseImage)
        setLoading(false)
      } catch (e: any) {
        console.error(e)
        if (!cancelled) { setErr(e?.message ?? String(e)); setLoading(false) }
      }
    }
    run()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, vehicle?.id, showDestroyed])

  // =========================================================================
  // Overlay canvas → CanvasTexture
  // =========================================================================
  useEffect(() => {
    if (!meshGroupRef.current) return
    if (overlayCanvas) {
      if (!overlayTexRef.current) {
        overlayTexRef.current = new THREE.CanvasTexture(overlayCanvas)
        overlayTexRef.current.flipY = true
        overlayTexRef.current.colorSpace = THREE.SRGBColorSpace
        overlayTexRef.current.wrapS = overlayTexRef.current.wrapT = THREE.RepeatWrapping
      }
      meshGroupRef.current.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) (m.material as THREE.MeshStandardMaterial).map = overlayTexRef.current
      })
    } else if (baseTextureRef.current) {
      meshGroupRef.current.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) (m.material as THREE.MeshStandardMaterial).map = baseTextureRef.current
      })
    }
  }, [overlayCanvas])

  // =========================================================================
  // Selected part → explode / emissive highlight
  // =========================================================================
  useEffect(() => {
    if (!meshGroupRef.current) return
    const map = submeshMapsRef.current

    // Clear all emissive tints
    for (const mesh of map.values()) {
      ;(mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000)
      ;(mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0
    }

    // Compute new explode targets
    const newTargets = new Map<string, THREE.Vector3>()
    if (explodeAll) {
      for (const [name, mesh] of map) {
        const centroid = new THREE.Vector3()
        mesh.geometry.computeBoundingBox()
        mesh.geometry.boundingBox!.getCenter(centroid)
        const dir = centroid.clone().normalize()
        if (dir.lengthSq() < 0.0001) dir.set(0, 1, 0)
        newTargets.set(name, dir.multiplyScalar(0.5))
      }
    } else if (selectedPart && map.has(selectedPart)) {
      const sel = map.get(selectedPart)!
      ;(sel.material as THREE.MeshStandardMaterial).emissive.setHex(0x2255aa)
      ;(sel.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25

      const centroid = new THREE.Vector3()
      sel.geometry.computeBoundingBox()
      sel.geometry.boundingBox!.getCenter(centroid)
      const dir = centroid.clone().normalize()
      if (dir.lengthSq() < 0.0001) dir.set(0, 1, 0)
      for (const name of map.keys()) {
        newTargets.set(name, new THREE.Vector3(0, 0, 0))
      }
      newTargets.set(selectedPart, dir.multiplyScalar(0.45))
    } else {
      for (const name of map.keys()) newTargets.set(name, new THREE.Vector3(0, 0, 0))
    }

    targetPosRef.current = newTargets
    explodeProgressRef.current = 0  // kick off animation
  }, [selectedPart, explodeAll])

  // =========================================================================
  // Pointer raycasting → UV
  // =========================================================================
  const pickUV = (e: React.MouseEvent) => {
    if (!canvasRef.current || !cameraRef.current || !meshGroupRef.current) return null
    const rect = canvasRef.current.getBoundingClientRect()
    pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current)
    const hits = raycasterRef.current.intersectObject(meshGroupRef.current, true)
    if (!hits.length || !hits[0].uv) return null
    return { u: hits[0].uv.x, v: hits[0].uv.y }
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        onClick={e => { const uv = pickUV(e); if (uv) onPick?.(uv) }}
        onMouseMove={e => { onHover?.(pickUV(e)) }}
        onMouseLeave={() => onHover?.(null)}
      />
      {(loading || err) && (
        <div className={`absolute inset-0 grid place-items-center ${err ? '' : 'pointer-events-none'}`}>
          <div className="glass-2 rounded-xl px-4 py-3 text-[12px] max-w-md">
            {err ? (
              <div className="space-y-2">
                <div className="text-red-300 leading-relaxed">{err}</div>
                {onReconnect && (
                  <button onClick={onReconnect}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-black font-medium hover:bg-[var(--color-accent-strong)] transition">
                    Reconnect / pick install folder
                  </button>
                )}
              </div>
            ) : (
              <span className="text-[var(--color-text-2)]">Loading {vehicle?.displayName}…</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}
