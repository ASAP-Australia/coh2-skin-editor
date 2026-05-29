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
import {
  SCENE_PRESETS, DEFAULT_PRESET_ID, applySeasonOverrides,
  type PresetId, type ToneMappingMode,
} from '@/lib/scene-settings'

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
  /** Active scene preset. Defaults to DEFAULT_PRESET_ID ('in_game_field'). */
  presetId?: PresetId
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
  presetId = DEFAULT_PRESET_ID,
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
  const rendererRef      = useRef<THREE.WebGLRenderer | null>(null)
  const skyRef           = useRef<Sky | null>(null)
  const pmremRef         = useRef<THREE.PMREMGenerator | null>(null)
  /** All lights that belong to the active preset (built + added in the
   *  preset-change useEffect). Teardown removes these before rebuilding. */
  const presetLightsRef  = useRef<THREE.Light[]>([])

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
    // Tone-mapping and exposure are now applied by the preset-change useEffect
    // below — initialise with neutral defaults that the preset effect will
    // immediately overwrite on first render.
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.0
    rendererRef.current = renderer
    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)
    camera.position.set(8, 4, 8)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, canvasRef.current)
    controls.enableDamping = true
    controls.target.set(0, 1.2, 0)
    controlsRef.current = controls

    // Realistic procedural sky — Three's Sky shader (Preetham/Hosek-Wilkie
    // atmospheric scattering). Used as the scene background for the
    // in_game_field preset. Also baked into a PMREM env map so the model
    // picks up sky reflections / IBL.
    const sky = new Sky()
    sky.scale.setScalar(450000)
    const skySun = new THREE.Vector3()
    const skyUniforms = sky.material.uniforms
    // Tuned for a calmer, deeper-blue daytime sky — higher rayleigh keeps
    // the upper hemisphere saturated blue and the horizon a soft warm haze.
    skyUniforms.turbidity.value       = 4
    skyUniforms.rayleigh.value        = 3
    skyUniforms.mieCoefficient.value  = 0.005
    skyUniforms.mieDirectionalG.value = 0.7
    // Higher sun elevation (65°) = darker, more saturated background
    const phi   = THREE.MathUtils.degToRad(90 - 65)  // elevation 65°
    const theta = THREE.MathUtils.degToRad(180)       // azimuth
    skySun.setFromSphericalCoords(1, phi, theta)
    skyUniforms.sunPosition.value.copy(skySun)
    sky.visible = false  // hidden by default; preset effect enables it for in_game_field
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

    // Ground — large, gently coloured plane. The warm earthy tint (0x4a463c)
    // complements the sky IBL tint on the model in in_game_field mode.
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
      pmremGen.dispose()
      renderer.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // =========================================================================
  // Preset + season → lights, tone-mapping, background
  //
  // Runs whenever presetId or season changes. Tears down all lights added
  // by the previous preset run, then rebuilds from SCENE_PRESETS[presetId]
  // with season overrides applied on top (only in_game_field reacts to season
  // — see applySeasonOverrides in scene-settings.ts).
  // =========================================================================
  useEffect(() => {
    const scene = sceneRef.current
    const renderer = rendererRef.current
    if (!scene || !renderer) return

    // ── Tear down previous preset lights ──────────────────────────────────
    for (const light of presetLightsRef.current) {
      scene.remove(light)
      light.dispose?.()
    }
    presetLightsRef.current = []

    // ── Resolve the effective preset (with season overrides) ──────────────
    const base = SCENE_PRESETS[presetId]
    const preset = applySeasonOverrides(base, season)

    // ── Tone-mapping ──────────────────────────────────────────────────────
    const tmMap: Record<ToneMappingMode, THREE.ToneMapping> = {
      aces:     THREE.ACESFilmicToneMapping,
      neutral:  THREE.NeutralToneMapping,
      reinhard: THREE.ReinhardToneMapping,
    }
    renderer.toneMapping = tmMap[preset.toneMapping]
    renderer.toneMappingExposure = preset.exposure

    // ── Background ────────────────────────────────────────────────────────
    if (preset.background.kind === 'color') {
      // Hide Sky for non-atmospheric presets
      if (skyRef.current) skyRef.current.visible = false
      scene.background = new THREE.Color(preset.background.hex)
    } else {
      // in_game_field cubemap: use the Three.Sky atmospheric shader as
      // the background. The PMREM env is baked once at init and lives in
      // scene.environment for IBL reflections on the model.
      if (skyRef.current) {
        skyRef.current.visible = true
        scene.background = null  // Sky mesh IS the background
      } else {
        scene.background = new THREE.Color(0x0a0b0e)
      }
    }

    // ── Hemisphere light ──────────────────────────────────────────────────
    const hemi = new THREE.HemisphereLight(
      preset.hemi.sky, preset.hemi.ground, preset.hemi.intensity,
    )
    // Keep ambientRef / sunRef / fillRef pointed at the first two directional
    // lights so any external code that historically read them still works.
    ambientRef.current = hemi as unknown as THREE.AmbientLight
    scene.add(hemi)
    presetLightsRef.current.push(hemi)

    // ── Directional lights ────────────────────────────────────────────────
    preset.directionalLights.forEach((spec, i) => {
      const dl = new THREE.DirectionalLight(spec.color, spec.intensity)
      dl.position.set(...spec.position)
      scene.add(dl)
      presetLightsRef.current.push(dl)
      if (i === 0) sunRef.current = dl
      if (i === 1) fillRef.current = dl
    })

    // ── Omni fill lights (studio_grid + showcase) ─────────────────────────
    if (preset.omniLights) {
      for (const spec of preset.omniLights) {
        const dl = new THREE.DirectionalLight(spec.color, spec.intensity)
        dl.position.set(...spec.position)
        scene.add(dl)
        presetLightsRef.current.push(dl)
      }
    }

    // ── Ground plane visibility ───────────────────────────────────────────
    if (groundMeshRef.current) {
      groundMeshRef.current.visible = preset.showGround
    }
    // ── Grid helper ───────────────────────────────────────────────────────
    // Remove any existing grid helpers from the scene before possibly
    // re-adding one for studio_grid preset.
    scene.children
      .filter(c => c instanceof THREE.GridHelper)
      .forEach(c => scene.remove(c))
    if (preset.showGrid) {
      const grid = new THREE.GridHelper(60, 30, 0x000000, 0x000000)
      ;(grid.material as THREE.Material).transparent = true
      ;(grid.material as THREE.Material).opacity = 0.10
      grid.position.y = 0.005
      scene.add(grid)
    }

    // ── Auto-rotate ───────────────────────────────────────────────────────
    if (controlsRef.current) {
      if (preset.autoRotate === false) {
        controlsRef.current.autoRotate = false
      } else if (preset.autoRotate === true) {
        controlsRef.current.autoRotate = true
        controlsRef.current.autoRotateSpeed = 0.6
      } else {
        controlsRef.current.autoRotate = true
        controlsRef.current.autoRotateSpeed = preset.autoRotate
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, season])

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
      onModelLoaded?.({ meshes: [], textureSets: [], materials: new Map() } as unknown as RgmModel, null)
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
          ostwind_flak_panzer: ['ostwind_flak_panzer', 'ostwind', 'ostwind_flakpanzer'],
          sdkfz_222: ['sdkfz_222', 'sdkfz222', 'sdkfz221'],
          panther_ausf_g: ['panther', 'panther_ausf_g', 'pzkpfw_v_panther'],
          king_tiger_sdkfz_182: ['kingtiger', 'king_tiger', 'tiger_ii'],
          puma_sdkfz_234: ['puma', 'sdkfz_234', 'sdkfz234_puma'],
          jagdpanzer_iv_sdkfz_162: ['jagdpanzer_iv', 'jagdpanzeriv', 'jagdpanzer'],
          panzer_ii_luchs_sdkfz_123: ['luchs', 'panzer_ii_luchs', 'pzkpfw_ii'],
          panzer_iv_sdkfz_ausf_i: ['panzeriv', 'panzer_iv', 'pzkpfw_iv'],
          hetzer: ['hetzer', 'jagdpanzer_38t', 'jagdpanzer_38'],
          jagdtiger: ['jagdtiger'],
          sturmtiger: ['sturmtiger', 'sturmpanzer'],
          tiger: ['tiger', 'tiger_i', 'pzkpfw_vi_tiger'],
          brummbar: ['brummbar', 'sturmpanzer_iv'],
          kubelwagen: ['kubelwagen', 'kuebelwagen'],
          m4a3e8_sherman_easy_8: ['m4a3e8_sherman', 'm4a3e8', 'sherman_easy_8'],
          m4a3_sherman_76mm: ['m4a3_sherman_76', 'm4a3_76mm', 'sherman_76mm'],
          m4a1_sherman_calliope: ['m4a1_calliope', 'm4a1_sherman', 'sherman_calliope'],
          m10_tank_destroyer: ['m10', 'm10_wolverine'],
          m36_tank_destroyer: ['m36', 'm36_jackson'],
          m15a1_aa_halftrack: ['m15_aa_halftrack', 'm15a1', 'm16_halftrack'],
          sherman_firefly: ['firefly', 'sherman_firefly', 'sherman_vc'],
        }
        const bases = aliases[vehicle.id] ?? [vehicle.id]
        // Try both vehicle.id and each alias as the folder name — CoH2's SGA
        // layout isn't consistent (puma_sdkfz_234/puma_dif vs puma/puma_dif).
        const dirCandidates = [vehicle.id, ...bases].map(d =>
          `art/armies/${vehicle.faction}/vehicles/${d}/`
        )
        const tsetPaths = candidates.map(c => c.replace(/\\/g, '/').toLowerCase() + '.rgt')
        const fallbackPaths = dirCandidates.flatMap(dirPath =>
          bases.flatMap(b => [
            `${dirPath}${b}_dif.rgt`,
            `${dirPath}${b}_hull_dif.rgt`,
            `${dirPath}${b}_default_dif.rgt`,
          ])
        )
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
            // flipY=true is the third leg of the canonical 3-flip identity
            // (see MODEL_EXTRACTION.md §7). Parser flips V at decode time;
            // CanvasTexture's flipY=true uploads the canvas right-side-up
            // for GL; sampling with the flipped UVs lands on the correct
            // texel on a top-down decoded canvas.
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
        const nrmFallbackPaths = dirCandidates.flatMap(dirPath =>
          bases.flatMap(b => [
            `${dirPath}${b}_nrm.rgt`,
            `${dirPath}${b}_hull_nrm.rgt`,
            `${dirPath}${b}_norm.rgt`,
            `${dirPath}${b}_n.rgt`,
            `${dirPath}${b}_default_nrm.rgt`,
          ])
        )
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

        // ── Per-submesh texture binding ────────────────────────────────
        // Each submesh's MaterialName resolves to an MTRL chunk whose params
        // list the textures THAT submesh expects. The body atlas is the
        // common case; tracks reference a separate `*_track_dif.rgt` (a
        // small tiling tread tile) and skirts/wheels can reference yet
        // another atlas. Without this, every submesh got the body atlas →
        // tracks rendered the entire hull texture stretched across them.
        const texCache = new Map<string, { diffuse: THREE.Texture | null; normal: THREE.Texture | null }>()
        // Pre-seed the cache with the body diffuse + normal we already loaded.
        if (diffuse) {
          texCache.set('__body__', { diffuse, normal: normalTex })
        }
        const resolveRgtPath = async (rawPath: string): Promise<Uint8Array | null> => {
          // Material params come Windows-style with backslashes, no extension.
          const norm = rawPath.replace(/\\/g, '/').toLowerCase()
          const candidate = norm.endsWith('.rgt') ? norm : `${norm}.rgt`
          const direct = await sga!.readByPath(candidate)
          if (direct) return direct
          for (const sgaName of sgaCandidates) {
            const a = await getArchive(sgaName)
            if (!a) continue
            const b = await a.readByPath(candidate)
            if (b) return b
          }
          return null
        }
        const decodeTextureBytes = (
          bytes: Uint8Array,
          isNormal: boolean,
        ): THREE.Texture | null => {
          try {
            const rgt = decodeRgt(bytes)
            const cv = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
            const t = new THREE.CanvasTexture(cv)
            t.flipY = true
            t.colorSpace = isNormal ? THREE.NoColorSpace : THREE.SRGBColorSpace
            t.wrapS = t.wrapT = THREE.RepeatWrapping
            t.anisotropy = 4
            return t
          } catch { return null }
        }
        // CoH2 MTRL chunks don't expose texture-path params via our parser
        // (`params: []` in real captures), so we derive the per-material
        // textures from the model's textureSets by name-matching the
        // material's distinguishing token.
        //
        //   material `sturmtiger`     → first textureSet ending `_dif` not in `_wreck_` / `_tread_`
        //   material `tread_left/...` → first textureSet matching `*_tread_dif`
        //   material `*_wreck`        → first textureSet matching `*_wreck_dif`
        //
        // This is robust to the various CoH2 naming conventions because
        // the textureSets list is authoritative — it's literally what the
        // game ships.
        const tsetsLower = model.textureSets.map(t => t.replace(/\\/g, '/').toLowerCase())
        const findTset = (predicate: (path: string) => boolean): string | null => {
          for (const t of tsetsLower) if (predicate(t)) return t
          return null
        }
        const tokenFor = (mat: string): string => {
          // Pull the distinguishing token from a material name.
          if (/wreck/.test(mat))     return 'wreck'
          if (/tread|track/.test(mat)) return 'tread'
          // Body / default — let the matcher pick the plain `*_dif` not
          // qualified by `_tread_` / `_wreck_`.
          return ''
        }
        const getTexturesForMaterial = async (
          materialName: string | null,
        ): Promise<{ diffuse: THREE.Texture | null; normal: THREE.Texture | null }> => {
          const cacheKey = materialName ?? '__body__'
          if (texCache.has(cacheKey)) return texCache.get(cacheKey)!
          const token = materialName ? tokenFor(materialName) : ''
          let difPath: string | null
          let nrmPath: string | null
          if (token) {
            difPath = findTset(p => p.includes(`_${token}_`) && /_dif$/.test(p))
            nrmPath = findTset(p => p.includes(`_${token}_`) && /_nrm$|_norm$/.test(p))
          } else {
            // Body: pick a `_dif` that's NOT wreck/tread-qualified, prefer
            // ones whose basename matches the vehicle id.
            const isBody = (p: string) => /_dif$/.test(p) && !/_wreck_|_tread_|_track_|\/badges\//.test(p)
            difPath = findTset(p => isBody(p) && p.includes(vehicle.id.toLowerCase()))
                   ?? findTset(isBody)
            const isBodyNrm = (p: string) =>
              (/_nrm$|_norm$/.test(p)) && !/_wreck_|_tread_|_track_|\/badges\//.test(p)
            nrmPath = findTset(p => isBodyNrm(p) && p.includes(vehicle.id.toLowerCase()))
                   ?? findTset(isBodyNrm)
          }
          let dTex: THREE.Texture | null = null
          let nTex: THREE.Texture | null = null
          if (difPath) {
            const b = await resolveRgtPath(difPath)
            if (b) dTex = decodeTextureBytes(b, false)
          }
          if (nrmPath) {
            const b = await resolveRgtPath(nrmPath)
            if (b) nTex = decodeTextureBytes(b, true)
          }
          // Fall back to body atlas if this material didn't resolve a
          // diffuse — better than rendering pure black.
          const result = {
            diffuse: dTex ?? texCache.get('__body__')?.diffuse ?? null,
            normal:  nTex ?? texCache.get('__body__')?.normal  ?? null,
          }
          texCache.set(cacheKey, result)
          return result
        }

        const isBodyMaterial = (mn: string | null): boolean => {
          if (!mn) return true  // null materialName → assume body
          return tokenFor(mn) === ''
        }
        for (const sub of visible) {
          const tex = await getTexturesForMaterial(sub.materialName)
          if (cancelled) return
          const subDiffuse = tex.diffuse
          const subNormal  = tex.normal
          const mat = new THREE.MeshStandardMaterial({
            map: subDiffuse,
            normalMap: subNormal,
            color: subDiffuse ? 0xffffff : 0x9aa18b,
            metalness: 0.05, roughness: 0.85,
            // CoH2 RGM submeshes have inconsistent winding — some panels
            // (Puma turret, Panther skirts) end up with their normals
            // facing inwards, rendering as solid black. DoubleSide makes
            // both faces lit, masking the broken winding.
            side: THREE.DoubleSide,
          })
          if (subNormal) mat.normalScale = new THREE.Vector2(1.0, 1.0)
          // Mark whether this submesh uses the BODY diffuse — only those
          // get the editable overlay rebound onto them. Tracks/wheels/wrecks
          // keep their own (non-editable) tile/wreck textures.
          ;(mat as THREE.MeshStandardMaterial & { __usesBodyDiffuse?: boolean }).__usesBodyDiffuse = isBodyMaterial(sub.materialName)
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
      } catch (e: unknown) {
        console.error(e)
        if (!cancelled) { setErr((e as { message?: string })?.message ?? String(e)); setLoading(false) }
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
        // Same canonical flipY=true as the diffuse — keeps the unwrap
        // identity in §7 of MODEL_EXTRACTION.md intact through the
        // overlay-compositing path.
        overlayTexRef.current.flipY = true
        overlayTexRef.current.colorSpace = THREE.SRGBColorSpace
        overlayTexRef.current.wrapS = overlayTexRef.current.wrapT = THREE.RepeatWrapping
      }
      meshGroupRef.current.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          const mat = m.material as THREE.MeshStandardMaterial
          // Only rebind the editable overlay onto submeshes that use the
          // BODY diffuse. Tracks/wheels keep their own (tile) textures so
          // we don't smear the hull atlas across treads.
          if ((mat as THREE.MeshStandardMaterial & { __usesBodyDiffuse?: boolean }).__usesBodyDiffuse) {
            mat.map = overlayTexRef.current
            mat.needsUpdate = true
          }
        }
      })
    } else if (baseTextureRef.current) {
      meshGroupRef.current.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          const mat = m.material as THREE.MeshStandardMaterial
          if ((mat as THREE.MeshStandardMaterial & { __usesBodyDiffuse?: boolean }).__usesBodyDiffuse) {
            mat.map = baseTextureRef.current
            mat.needsUpdate = true
          }
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
