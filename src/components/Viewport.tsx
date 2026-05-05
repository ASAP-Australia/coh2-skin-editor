import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { locateArchives } from '@/lib/coh2-fs'
import { SgaArchive } from '@/lib/sga'
import { parseRgm, type RgmModel } from '@/lib/rgm'
import { decodeRgt, rgtToCompressedTexture } from '@/lib/rgt'
import { bcToCanvas } from '@/lib/bc-decode'
import { rgmPath, type VehicleSpec } from '@/lib/vehicles'
// Sky / PMREM env removed — they were washing the model to white. Studio
// lighting only now (HemisphereLight + 3 directional lights) so diffuse
// + normal maps read cleanly against a dark backdrop.

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
  // (skyRef / pmremRef removed with Three.Sky)

  // Explode animation state
  const submeshMapsRef   = useRef<Map<string, THREE.Mesh>>(new Map())
  const origPosRef       = useRef<Map<string, THREE.Vector3>>(new Map())
  const targetPosRef     = useRef<Map<string, THREE.Vector3>>(new Map())
  const explodeProgressRef = useRef(1) // 1 = done animating

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // Bumps each time a new model finishes loading, so the overlay-binding
  // useEffect re-runs and rebinds the texture to the freshly-built materials.
  // Without this, the binding only runs on first overlayCanvas-prop change
  // (which happens before the first model load completes).
  const [modelTick, setModelTick] = useState(0)

  // =========================================================================
  // Scene init (once)
  // =========================================================================
  useEffect(() => {
    if (!canvasRef.current) return
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true, alpha: false })
    renderer.setPixelRatio(window.devicePixelRatio)
    // Output in SRGB color space — without this Three.js renders in linear
    // space and the result appears significantly darker than the source textures.
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // Mild ACES filmic tone map keeps bright highlights from clipping.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    const scene = new THREE.Scene()
    // Dark studio backdrop — near-black, slight cool tint. Replaces the
    // Three.Sky atmospheric shader which was bleeding bright sky into the
    // backdrop-blur chrome and washing the model to white.
    scene.background = new THREE.Color(0x0a0b0e)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)
    camera.position.set(8, 4, 8)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, canvasRef.current)
    controls.enableDamping = true
    controls.target.set(0, 1.2, 0)
    controlsRef.current = controls

    // ── Studio lighting (no IBL/env) ─────────────────────────────────────
    // Hemisphere supplies a soft cool-from-above / warm-from-below ambient
    // tint that fills the dark side of the model. Three directional lights
    // form a 3-point: key (warm front-right), fill (cool front-left), rim
    // (cool back). No env map, no PMREM — keeps materials reading their
    // diffuse + normal maps cleanly without sky-tint washout.
    // Hemisphere provides the sky/ground ambient fill. The sky colour is a
    // cool blue-grey (overcast European sky), the ground colour is a warm
    // olive to simulate light bouncing off grass/earth. Relatively bright so
    // the shadow side of the tank never goes full-black.
    const ambient = new THREE.HemisphereLight(0xb0c0d0, 0x504030, 0.80)
    ambientRef.current = ambient as unknown as THREE.AmbientLight
    scene.add(ambient)

    // Key light — warm front-right, simulates European afternoon sun.
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.40)
    sun.position.set(5, 8, 5)
    sunRef.current = sun
    scene.add(sun)

    // Fill light — cool front-left, lifts the shadow-side faces.
    const fill = new THREE.DirectionalLight(0x90a8c8, 0.65)
    fill.position.set(-6, 4, -3)
    fillRef.current = fill
    scene.add(fill)

    // Rim / back light — separates the tank from the dark background.
    const rim = new THREE.DirectionalLight(0xb0c4e0, 0.70)
    rim.position.set(-2, 2, -8)
    scene.add(rim)

    // Ground — clean dark plane. Catches subtle shadows from the directional
    // lights but doesn't compete with the model.
    const groundGeo = new THREE.PlaneGeometry(200, 200, 1, 1)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1c1e22, metalness: 0, roughness: 1.0,
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
  // Season → lighting + ground color
  // =========================================================================
  useEffect(() => {
    // Summer: warm front-right key, neutral fills, dark earth ground.
    // Winter: cooler blue-white sun (snow-sky bounce), brighter fill to
    //         simulate snow-reflected light, pale grey ground.
    if (!sunRef.current || !fillRef.current || !sceneRef.current) return
    if (season === 'winter') {
      sunRef.current.color.setHex(0xd8e8ff)   // cooler, snow-sky
      sunRef.current.intensity = 1.20
      fillRef.current.color.setHex(0xb0c8ff)  // blue-white bounce
      fillRef.current.intensity = 0.75
      if (groundMatRef.current) groundMatRef.current.color.setHex(0x9aabb8) // snowy pale
      sceneRef.current.background = new THREE.Color(0x0d1016)  // slightly cooler dark
    } else {
      sunRef.current.color.setHex(0xfff4e0)   // warm summer key
      sunRef.current.intensity = 1.40
      fillRef.current.color.setHex(0x90a8c8)  // cool fill
      fillRef.current.intensity = 0.65
      if (groundMatRef.current) groundMatRef.current.color.setHex(0x1c1e22) // dark earth
      sceneRef.current.background = new THREE.Color(0x0a0b0e)
    }
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
        // Search across every Art*.sga that ships with CoH2. Vehicle meshes
        // are usually in ArtHigh.sga but the diffuse RGTs live in faction-
        // specific archives (Tiger/Brummbär diffuse → ArtGermanEF.sga,
        // Sherman → ArtAEFSkins.sga, etc). Trying ArtHigh-only meant most
        // textures never loaded.
        const sgaCandidates = [
          'ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga',
          'ArtArmies.sga',
          'ArtGermanEF.sga', 'ArtSovietEF.sga',
          'ArtAEF.sga', 'ArtAEFSkins.sga',
          'ArtBritish.sga', 'ArtWestGerman.sga',
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
        // Build a list of candidate paths to search.
        // 1. Whatever the RGM's textureSets advertise (preferred — they're authoritative)
        // 2. Hardcoded fallbacks based on vehicle.id (mirrors tools/test-export.ts).
        //    Some vehicles have non-obvious basenames (elefant → elefant_hull etc).
        const aliases: Record<string, string[]> = {
          elefant: ['elefant_hull', 'elefant'],
          ostwind_flak_panzer: ['ostwind', 'ostwind_flak_panzer'],
          sdkfz_222: ['sdkfz221', 'sdkfz_222'],
          panther_ausf_g: ['panther', 'panther_ausf_g'],
          king_tiger_sdkfz_182: ['kingtiger'],
          puma_sdkfz_234: ['puma'],
          jagdpanzer_iv_sdkfz_162: ['jagdpanzer_iv'],
          panzer_ii_luchs_sdkfz_123: ['luchs'],
          panzer_iv_sdkfz_ausf_i: ['panzeriv'],
          m4a3e8_sherman_easy_8: ['m4a3e8_sherman'],
          m4a3_sherman_76mm: ['m4a3_sherman_76'],
          m4a1_sherman_calliope: ['m4a1_calliope'],
          m10_tank_destroyer: ['m10'],
          m36_tank_destroyer: ['m36'],
          m15a1_aa_halftrack: ['m15_aa_halftrack'],
          sherman_firefly: ['firefly'],
        }
        const bases = aliases[vehicle.id] ?? [vehicle.id]
        const dirPath = `art/armies/${vehicle.faction}/vehicles/${vehicle.id}/`
        const tsetPaths = candidates.map(c => c.replace(/\\/g, '/').toLowerCase() + '.rgt')
        const fallbackPaths = bases.flatMap(b => [
          `${dirPath}${b}_dif.rgt`,
          `${dirPath}${b}_hull_dif.rgt`,
        ])
        const allPaths = [...new Set([...tsetPaths, ...fallbackPaths])]

        // Open archives lazily but cache them — without this we re-open every
        // SGA (~50 MB+, TOC parse) for every path candidate, ballooning load
        // time to 30+ s for vehicles whose diffuse isn't in the RGM's home SGA.
        const archiveCache = new Map<string, SgaArchive>()
        const getArchive = async (name: string): Promise<SgaArchive | null> => {
          if (archiveCache.has(name)) return archiveCache.get(name)!
          try {
            const fh = await archives.getFileHandle(name)
            const file = await fh.getFile()
            const a = await SgaArchive.open(file)
            archiveCache.set(name, a)
            return a
          } catch { return null }
        }

        let rgtBytes: Uint8Array | null = null
        let foundPath = ''
        // For each path, try the RGM's home SGA first, then every other.
        outerDif: for (const tryPath of allPaths) {
          const direct = await sga.readByPath(tryPath)
          if (direct) { rgtBytes = direct; foundPath = `${tryPath} (rgm SGA)`; break outerDif }
          for (const sgaName of sgaCandidates) {
            const a = await getArchive(sgaName)
            if (!a) continue
            const b = await a.readByPath(tryPath)
            if (b) { rgtBytes = b; foundPath = `${tryPath} (${sgaName})`; break outerDif }
          }
        }
        if (rgtBytes) {
          console.log('[viewport] diffuse FOUND', foundPath, rgtBytes.length, 'bytes')
        } else {
          console.warn('[viewport] no diffuse found; tried', allPaths.length, 'paths across', sgaCandidates.length, 'SGAs')
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
        if (cancelled) return

        // ── Normal map ─────────────────────────────────────────────────
        // Same fallback strategy as the diffuse — try every candidate
        // path across every cached SGA. Normal maps are stored in linear
        // space (NOT sRGB), and we set normalScale below.
        let normalTex: THREE.Texture | null = null
        const nrmFallbackPaths = bases.flatMap(b => [
          `${dirPath}${b}_nrm.rgt`,
          `${dirPath}${b}_hull_nrm.rgt`,
          `${dirPath}${b}_norm.rgt`,
          `${dirPath}${b}_n.rgt`,
        ])
        // Filter destroyed/wreck variants — same patterns as the diffuse
        // ranker so we don't accidentally bind the wrecked normal to the
        // intact hull (which produces inverted shading on visible panels).
        const nrmTsetPaths = (model.textureSets ?? [])
          .filter(t => /_nrm$|_norm$/i.test(t) && !isDestroyedMesh(t))
          .map(t => t.replace(/\\/g, '/').toLowerCase() + '.rgt')
        // Hardcoded fallbacks come FIRST so we prefer
        // `<vehicle>_hull_nrm.rgt` over an arbitrary textureSet entry.
        const allNrmPaths = [...new Set([...nrmFallbackPaths, ...nrmTsetPaths])]

        outerNrm: for (const tryPath of allNrmPaths) {
          const direct = await sga.readByPath(tryPath)
          let bytes = direct
          if (!bytes) {
            for (const sgaName of sgaCandidates) {
              const a = await getArchive(sgaName)
              if (!a) continue
              const b = await a.readByPath(tryPath)
              if (b) { bytes = b; break }
            }
          }
          if (bytes) {
            try {
              const rgt = decodeRgt(bytes)
              const cv = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
              normalTex = new THREE.CanvasTexture(cv)
              normalTex.flipY = true
              normalTex.colorSpace = THREE.NoColorSpace
              normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping
              normalTex.anisotropy = 4
              console.log('[viewport] normal FOUND', tryPath, bytes.length, 'bytes')
              break outerNrm
            } catch {/* try next path */}
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

        // If the parser produced zero usable submeshes, the file uses a
        // format variant we don't decode yet (TRIM v5 packed stride — Tiger,
        // Churchill, M5 Stuart). Surface this clearly instead of an empty
        // viewport so the user knows what's wrong.
        if (visible.length === 0) {
          throw new Error(
            `${vehicle.displayName} uses a CoH2 mesh format the editor doesn't decode yet ` +
            `(TRIM v5 packed-stride). The skin export pipeline still works for this vehicle — ` +
            `pick another model from the nav for now.`
          )
        }

        for (const sub of visible) {
          const mat = new THREE.MeshStandardMaterial({
            map: diffuse,
            normalMap: normalTex,
            color: diffuse ? 0xffffff : 0x9aa18b,
            metalness: 0.05, roughness: 0.85,
          })
          // Mild normal-map intensity so panel-line/rivet detail reads
          // without going CGI-rough.
          if (normalTex) mat.normalScale = new THREE.Vector2(1.0, 1.0)
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
        // Pull camera back to frame the bounding sphere with a tight margin.
        // 0.85× rather than 1.15× — earlier framing left ~30% empty space on
        // every edge, making the tank read as a small thumbnail in a vast dark
        // void. The user wants the tank to FILL the viewport.
        if (cameraRef.current) {
          const radius = finalSize.length() * 0.5
          const fovRad = (cameraRef.current.fov * Math.PI) / 180
          const dist = (radius / Math.sin(fovRad / 2)) * 0.85
          // Slightly elevated 3/4 view, tracking the model's actual centre
          // so the camera target sits on the tank's centre of mass not its
          // hull bottom.
          const dir = new THREE.Vector3(1, 0.45, 1).normalize()
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
        // Bump tick → triggers the overlay-binding useEffect to rebind the
        // (possibly-fresh) overlay texture to all materials in the new mesh
        // group. Without this rebind the model would stay on its raw diffuse
        // texture and decals wouldn't show.
        setModelTick(t => t + 1)
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
        if (m.isMesh) {
          const mat = m.material as THREE.MeshStandardMaterial
          mat.map = overlayTexRef.current
          // needsUpdate forces Three.js to recompile the shader with the
          // new map. Without it, materials created with no map (or a null
          // map) keep their compiled-without-texture shader → uvs get
          // ignored → tank renders pure white.
          mat.needsUpdate = true
        }
      })
    } else if (baseTextureRef.current) {
      meshGroupRef.current.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          const mat = m.material as THREE.MeshStandardMaterial
          mat.map = baseTextureRef.current
          mat.needsUpdate = true
        }
      })
    }
  }, [overlayCanvas, modelTick])

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
