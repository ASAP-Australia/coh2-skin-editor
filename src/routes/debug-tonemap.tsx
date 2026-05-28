/**
 * Debug A/B route — pixel-precision verification of the diffuse + normal-map
 * flipY-mismatch fix that landed in `Viewport.tsx`.
 *
 * Each tile renders the unwrapped King Tiger diffuse on a flat plane with
 * the same 3-point Studio-Grid lighting and Neutral@1.0 tone mapping as the
 * actual Viewport. The four tiles differ only in WHICH textures and WHICH
 * flipY value the normal map gets:
 *
 *   TL  diffuse only                       — baseline ("how light alone hits flat")
 *   TR  diffuse + normal map (flipY=true)  — OLD BROKEN: cookie-cutter voids
 *   BL  diffuse + normal map (flipY=false) — FIX: voids should be gone
 *   BR  normal map alone (as diffuse)      — sanity preview of the normal map
 *
 * Required local assets (gitignored — `public/debug/.gitignore` excludes *.png):
 *   /debug/king_tiger.png       (decoded via tools/test-rgt-decode.ts)
 *   /debug/king_tiger_nrm.png   (decoded the same way)
 *
 * URL: http://localhost:5173/?debug=tonemap
 */

import { useEffect, useRef } from 'react'
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  MeshStandardMaterial,
  Color,
  Vector2,
  Texture,
  SRGBColorSpace,
  NoColorSpace,
  NeutralToneMapping,
  DoubleSide,
  ClampToEdgeWrapping,
} from 'three'

type PanelKind = 'diffuse-only' | 'normal-flipY-true' | 'normal-flipY-false' | 'normal-only'

interface Panel {
  id: string
  title: string
  subtitle: string
  kind: PanelKind
}

const PANELS: Panel[] = [
  {
    id: 'diffuse-only',
    title: 'Diffuse only',
    subtitle: 'Baseline (no normal map) — flat plane, lit',
    kind: 'diffuse-only',
  },
  {
    id: 'normal-flipY-true',
    title: 'Diffuse + Normal (flipY=true)',
    subtitle: 'OLD BROKEN — V-flipped vs diffuse → cookie-cutter voids',
    kind: 'normal-flipY-true',
  },
  {
    id: 'normal-flipY-false',
    title: 'Diffuse + Normal (flipY=false)',
    subtitle: 'FIX — matches diffuse flipY → voids gone',
    kind: 'normal-flipY-false',
  },
  {
    id: 'normal-only',
    title: 'Normal map preview',
    subtitle: 'The normal map itself (mapped as albedo)',
    kind: 'normal-only',
  },
]

interface Tile {
  panel: Panel
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  mesh: Mesh | null
  diffuseTex: Texture | null
  normalTex: Texture | null
  material: MeshStandardMaterial | null
  geom: PlaneGeometry | null
}

function buildTile(canvas: HTMLCanvasElement, panel: Panel): Tile {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true, // toDataURL / readPixels for the test harness
  })
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1.0

  const scene = new Scene()
  scene.background = new Color(0x18191c)

  const camera = new PerspectiveCamera(38, 1, 0.1, 100)
  camera.position.set(0, 0, 3)
  camera.lookAt(0, 0, 0)

  // Studio-Grid 3-point + hemi (same as Viewport's studio_grid preset).
  scene.add(new HemisphereLight(0xa0b0c8, 0x303030, 0.85))
  const key = new DirectionalLight(0xfff1d6, 1.45)
  key.position.set(7.4, 7.6, 7.4)
  scene.add(key)
  const fill = new DirectionalLight(0x90a8c8, 0.65)
  fill.position.set(-6, 4, -3)
  scene.add(fill)
  const rim = new DirectionalLight(0xb0c4d8, 0.75)
  rim.position.set(-2, 2, -8)
  scene.add(rim)

  return {
    panel,
    renderer,
    scene,
    camera,
    mesh: null,
    diffuseTex: null,
    normalTex: null,
    material: null,
    geom: null,
  }
}

function attachMesh(tile: Tile, diffuseImg: HTMLImageElement, normalImg: HTMLImageElement) {
  const { kind } = tile.panel

  // The diffuse panel uses the actual diffuse PNG; the "normal-only" sanity tile
  // uses the normal map as albedo so we can SEE what the normal map encodes.
  const albedoImg = kind === 'normal-only' ? normalImg : diffuseImg

  const diffuseTex = new Texture(albedoImg)
  diffuseTex.colorSpace = kind === 'normal-only' ? NoColorSpace : SRGBColorSpace
  // Match the actual Viewport.tsx convention for the diffuse: flipY=false. The
  // PlaneGeometry's default UVs combined with flipY=false render the texture
  // upside-down, but that's fine for a pixel-comparison test — what we care
  // about is whether the normal-map mismatch produces voids on top.
  diffuseTex.flipY = false
  diffuseTex.wrapS = diffuseTex.wrapT = ClampToEdgeWrapping
  diffuseTex.anisotropy = 4
  diffuseTex.needsUpdate = true

  let normalTex: Texture | null = null
  if (kind === 'normal-flipY-true' || kind === 'normal-flipY-false') {
    normalTex = new Texture(normalImg)
    normalTex.colorSpace = NoColorSpace // normal maps are linear
    normalTex.flipY = kind === 'normal-flipY-true' // <-- the variable under test
    normalTex.wrapS = normalTex.wrapT = ClampToEdgeWrapping
    normalTex.anisotropy = 4
    normalTex.needsUpdate = true
  }

  const geom = new PlaneGeometry(2, 2)
  const mat = new MeshStandardMaterial({
    map: diffuseTex,
    normalMap: normalTex,
    metalness: 0.05,
    roughness: 0.85,
    side: DoubleSide,
  })
  if (normalTex) mat.normalScale = new Vector2(1.0, 1.0)
  const mesh = new Mesh(geom, mat)
  tile.scene.add(mesh)
  tile.mesh = mesh
  tile.diffuseTex = diffuseTex
  tile.normalTex = normalTex
  tile.material = mat
  tile.geom = geom
}

function disposeTile(tile: Tile) {
  if (tile.mesh) tile.scene.remove(tile.mesh)
  tile.geom?.dispose()
  tile.material?.dispose()
  tile.diffuseTex?.dispose()
  tile.normalTex?.dispose()
  tile.renderer.dispose()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = err => reject(err)
    img.src = src
  })
}

export default function DebugTonemapRoute() {
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([null, null, null, null])

  useEffect(() => {
    const canvases = canvasRefs.current
    if (canvases.some(c => !c)) return

    const tiles: Tile[] = PANELS.map((p, i) => buildTile(canvases[i]!, p))

    const resize = () => {
      tiles.forEach(t => {
        const c = t.renderer.domElement
        const w = c.clientWidth,
          h = c.clientHeight
        if (w === 0 || h === 0) return
        t.renderer.setSize(w, h, false)
        t.camera.aspect = w / h
        t.camera.updateProjectionMatrix()
      })
    }

    const renderAll = () => {
      tiles.forEach(t => t.renderer.render(t.scene, t.camera))
    }

    let cancelled = false
    Promise.all([loadImage('/debug/king_tiger.png'), loadImage('/debug/king_tiger_nrm.png')])
      .then(([diffuseImg, normalImg]) => {
        if (cancelled) return
        tiles.forEach(t => attachMesh(t, diffuseImg, normalImg))
        resize()
        renderAll()
        requestAnimationFrame(() => {
          resize()
          renderAll()
        })
      })
      .catch(err => {
        console.error('[debug-tonemap] failed to load assets', err)
      })

    const onResize = () => {
      resize()
      renderAll()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      tiles.forEach(disposeTile)
    }
  }, [])

  return (
    <div
      className="min-h-dvh w-full flex flex-col"
      style={{ background: '#0c0d10', color: '#fff' }}
    >
      <div className="px-6 py-4 text-[12px] tracking-[2px] uppercase text-white/70">
        Normal-map flipY A/B - King Tiger diffuse + normal
      </div>
      <div
        className="flex-1 grid gap-3 px-3 pb-3 min-h-0"
        style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}
      >
        {PANELS.map((p, i) => (
          <PanelTile
            key={p.id}
            canvasRef={el => {
              canvasRefs.current[i] = el
            }}
            title={p.title}
            subtitle={p.subtitle}
          />
        ))}
      </div>
    </div>
  )
}

function PanelTile({
  canvasRef,
  title,
  subtitle,
}: {
  canvasRef: (el: HTMLCanvasElement | null) => void
  title: string
  subtitle: string
}) {
  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{ background: '#18191c', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
      <div
        className="absolute top-3 left-3 px-2.5 py-1.5 rounded-lg text-[11px] tracking-tight pointer-events-none"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
      >
        <div className="font-semibold text-white">{title}</div>
        <div className="text-white/65 text-[10px]">{subtitle}</div>
      </div>
    </div>
  )
}
