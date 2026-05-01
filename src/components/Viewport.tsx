import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { locateArchives } from '@/lib/coh2-fs'
import { SgaArchive } from '@/lib/sga'
import { parseRgm, type RgmModel } from '@/lib/rgm'
import { decodeRgt, rgtToCompressedTexture } from '@/lib/rgt'
import { bcToCanvas } from '@/lib/bc-decode'
import { rgmPath, type VehicleSpec } from '@/lib/vehicles'

interface Props {
  root: FileSystemDirectoryHandle
  vehicle: VehicleSpec | null
  /** When set, replaces the diffuse texture with this canvas (live decal preview). */
  overlayCanvas?: HTMLCanvasElement | null
  /** Reports back the loaded model so the editor can extract the diffuse pixels
   *  for the canvas painter. */
  onModelLoaded?: (model: RgmModel, diffuseImage: HTMLCanvasElement | null) => void
  /** Click on the model — surfaces the picked UV (in [0,1]) for decal placement. */
  onPick?: (uv: { u: number; v: number }) => void
  /** Hover over the model — same payload, fires every mousemove. Use with throttling. */
  onHover?: (uv: { u: number; v: number } | null) => void
}

/** Loads any vehicle from the user's CoH2 install + renders it. Replaces
 *  the textured surface with `overlayCanvas` when present (decal preview). */
export default function Viewport({ root, vehicle, overlayCanvas, onModelLoaded, onPick, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const meshGroupRef = useRef<THREE.Group | null>(null)
  const baseTextureRef = useRef<THREE.Texture | null>(null)
  const overlayTexRef = useRef<THREE.CanvasTexture | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // === scene init (run once)
  useEffect(() => {
    if (!canvasRef.current) return
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current, antialias: true, alpha: true,
    })
    renderer.setPixelRatio(window.devicePixelRatio)
    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200)
    camera.position.set(7, 4, 9)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, canvasRef.current)
    controls.enableDamping = true
    controls.target.set(0, 1.2, 0)

    // Lighting — softly key + ambient, period-photo feel
    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const key = new THREE.DirectionalLight(0xffeddd, 0.85)
    key.position.set(5, 8, 5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x9eb4d1, 0.35)
    fill.position.set(-5, 3, -4)
    scene.add(fill)

    // Subtle ground plane so the tank doesn't float in the void
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(20, 64),
      new THREE.MeshStandardMaterial({ color: 0x12141a, metalness: 0, roughness: 0.95, transparent: true, opacity: 0.7 }),
    )
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    // 3D reference grid — gives the viewport a sense of scale + a subtle
    // technical/CAD aesthetic that draws the eye to the tank in the centre.
    const grid = new THREE.GridHelper(40, 40, 0x2a2d33, 0x1a1d23)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.55
    grid.position.y = 0.01
    scene.add(grid)

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      controls.update()
      // Ensure overlayTex updates if its source canvas was repainted.
      if (overlayTexRef.current) overlayTexRef.current.needsUpdate = true
      renderer.render(scene, camera)
    }
    tick()

    // Resize observer — keep aspect tied to the container
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

  // === load vehicle whenever it changes
  useEffect(() => {
    if (!vehicle || !sceneRef.current) return
    let cancelled = false
    setLoading(true); setErr(null)

    const run = async () => {
      try {
        const archives = await locateArchives(root)
        if (!archives) throw new Error('Archives folder not found.')
        // Try ArtHigh first (highest LOD), then ArtArmies, then HighXP1/2
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
            if (b) { sga = a; rgmBytes = b; break }
          } catch {/* not in this SGA */}
        }
        if (!sga || !rgmBytes) {
          throw new Error(`Couldn't find ${rgmPath(vehicle)} in any of the loaded archives. The vehicle may live in a DLC archive we don't scan yet.`)
        }
        const model = parseRgm(rgmBytes)
        if (cancelled) return

        // Diffuse texture
        let diffuse: THREE.Texture | null = null
        let diffuseImage: HTMLCanvasElement | null = null
        const difTset = model.textureSets.find(t => t.endsWith(`${vehicle.id}_dif`))
                       ?? model.textureSets.find(t => /_dif$/i.test(t))
        if (difTset) {
          const path = difTset.replace(/\\/g, '/').toLowerCase() + '.rgt'
          const rgtBytes = await sga.readByPath(path)
          if (rgtBytes) {
            try {
              const rgt = decodeRgt(rgtBytes)
              // Software-decode BC bytes → 2D canvas the editor can paint on.
              // We pass the canvas back to the editor via onModelLoaded; the
              // editor then composites decals on it and gives it back to us
              // via overlayCanvas. The compressed-texture path is the fallback
              // for callers that don't need editing.
              diffuseImage = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
              diffuse = new THREE.CanvasTexture(diffuseImage)
              diffuse.flipY = true
              diffuse.colorSpace = THREE.SRGBColorSpace
              diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
              diffuse.anisotropy = 4
            } catch (e) {
              console.warn('texture software-decode failed, falling back to compressed', e)
              try {
                const rgt = decodeRgt(rgtBytes)
                diffuse = rgtToCompressedTexture(rgt)
              } catch {/* leave null */}
            }
          }
        }
        if (cancelled) return

        // Build group
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
        const mat = new THREE.MeshStandardMaterial({
          map: diffuse,
          color: diffuse ? 0xffffff : 0x9aa18b,
          metalness: 0.05, roughness: 0.85,
        })
        for (const sub of model.meshes) {
          const m = new THREE.Mesh(sub.geometry, mat)
          m.name = sub.name
          group.add(m)
        }
        const box = new THREE.Box3().setFromObject(group)
        const size = box.getSize(new THREE.Vector3())
        const longest = Math.max(size.x, size.y, size.z)
        const scale = longest > 0.0001 ? 5 / longest : 0.01
        group.scale.setScalar(scale)
        const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale)
        group.position.sub(center)
        group.position.y = 1.2
        scene.add(group)
        meshGroupRef.current = group

        onModelLoaded?.(model, diffuseImage)
        setLoading(false)
      } catch (e: any) {
        console.error(e)
        if (!cancelled) {
          setErr(e?.message ?? String(e))
          setLoading(false)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [root, vehicle?.id])

  // === overlay canvas → CanvasTexture swap
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
        if (m.isMesh && m.material) (m.material as THREE.MeshStandardMaterial).map = overlayTexRef.current
      })
    } else if (baseTextureRef.current) {
      meshGroupRef.current.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh && m.material) (m.material as THREE.MeshStandardMaterial).map = baseTextureRef.current
      })
    }
  }, [overlayCanvas])

  // === pointer events for raycast → UV
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
      {/* Edge vignette — focuses the eye on the centred model. Pointer-events
          off so it never blocks clicks or hover-pick on the canvas. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 35%, rgba(8,9,12,0.35) 75%, rgba(8,9,12,0.65) 100%)',
        }}
      />
      {(loading || err) && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="glass-2 rounded-xl px-4 py-3 text-[12px]">
            {err ? (
              <span className="text-red-300">Error: {err}</span>
            ) : (
              <span className="text-[var(--color-text-2)]">Loading {vehicle?.displayName}…</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
