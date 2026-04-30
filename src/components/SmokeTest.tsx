import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { locateArchives } from '@/lib/coh2-fs'
import { SgaArchive } from '@/lib/sga'
import { parseRgm, type RgmMesh } from '@/lib/rgm'
import { decodeRgt, rgtToCompressedTexture } from '@/lib/rgt'

interface Props { root: FileSystemDirectoryHandle }

/** Smoke test: locate ArtHigh.sga, fish out the Tiger RGM, parse it, and
 *  render every submesh in a Three.js canvas. Surfaces parse errors clearly
 *  so we can iterate the loader without hunting through dev tools. */
export default function SmokeTest({ root }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('starting')
  const [stats, setStats] = useState<{
    archive: string
    fileSize: number
    submeshes: { name: string; tris: number; mat: string | null }[]
    textureSets: number
    materials: number
    totalTris: number
    diffuseFound?: boolean
    diffuseSize?: string
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    let renderer: THREE.WebGLRenderer | null = null
    let raf = 0
    let scene: THREE.Scene | null = null
    let camera: THREE.PerspectiveCamera | null = null
    let controls: OrbitControls | null = null

    const run = async () => {
      try {
        setStatus('locating Archives folder')
        const archives = await locateArchives(root)
        if (!archives) throw new Error("Couldn't find an Archives folder under the install. Did you pick the parent of CoH2/Archives?")
        setStatus('opening ArtHigh.sga')
        const fh = await archives.getFileHandle('ArtHigh.sga')
        const file = await fh.getFile()
        const sga = await SgaArchive.open(file)
        if (canceled) return
        setStatus(`reading tiger.rgm from ${file.name}`)
        const rgm = await sga.readByPath('art/armies/german/vehicles/tiger/tiger.rgm')
        if (!rgm) throw new Error('tiger.rgm not found in ArtHigh.sga')
        setStatus(`parsing ${rgm.byteLength.toLocaleString()} bytes`)
        const model = parseRgm(rgm)
        if (canceled) return
        const submeshes = model.meshes.map((m: RgmMesh) => ({
          name: m.name || '(unnamed)',
          tris: (m.geometry.getIndex()?.count ?? 0) / 3,
          mat: m.materialName,
        }))
        const totalTris = submeshes.reduce((s, x) => s + x.tris, 0)
        setStats({
          archive: file.name, fileSize: rgm.byteLength,
          submeshes, totalTris,
          textureSets: model.textureSets.length,
          materials: model.materials.size,
        })

        // Three.js scene
        if (!canvasRef.current) return
        renderer = new THREE.WebGLRenderer({
          canvas: canvasRef.current, antialias: true, alpha: true,
        })
        renderer.setPixelRatio(window.devicePixelRatio)
        const { clientWidth: w, clientHeight: h } = canvasRef.current
        renderer.setSize(w, h, false)
        scene = new THREE.Scene()
        scene.background = null
        camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 200)
        camera.position.set(8, 5, 10)
        controls = new OrbitControls(camera, canvasRef.current)
        controls.enableDamping = true
        controls.target.set(0, 1, 0)

        // Lights
        scene.add(new THREE.AmbientLight(0xffffff, 0.6))
        const key = new THREE.DirectionalLight(0xffffff, 0.9)
        key.position.set(5, 8, 6)
        scene.add(key)

        // Try to load the diffuse texture (tiger_dif.rgt) from the same archive.
        // CoH2's TSET names are backslash-paths inside the archive (e.g.
        // "art\\armies\\german\\vehicles\\tiger\\tiger_dif"). Append ".rgt".
        const difTset = model.textureSets.find(t => /tiger_dif$/i.test(t))
        let diffuse: THREE.Texture | null = null
        if (difTset) {
          setStatus(`loading diffuse texture: ${difTset.split(/[\\/]/).pop()}`)
          const path = difTset.replace(/\\/g, '/').toLowerCase() + '.rgt'
          const rgtBytes = await sga.readByPath(path)
          if (rgtBytes) {
            try {
              const rgt = decodeRgt(rgtBytes)
              diffuse = rgtToCompressedTexture(rgt)
              setStats(s => s ? { ...s, diffuseFound: true, diffuseSize: `${rgt.width}×${rgt.height} ${rgt.fourCC}` } : s)
            } catch (texErr) {
              console.warn('[smoke] texture decode failed', texErr)
            }
          }
        }

        const group = new THREE.Group()
        const mat = new THREE.MeshStandardMaterial({
          map: diffuse,
          color: diffuse ? 0xffffff : 0x9aa18b,
          metalness: 0.05, roughness: 0.85,
          flatShading: false,
        })
        for (const sub of model.meshes) {
          const mesh = new THREE.Mesh(sub.geometry, mat)
          mesh.name = sub.name
          group.add(mesh)
        }
        // Fit: scale so the longest axis is about 5 world units
        const box = new THREE.Box3().setFromObject(group)
        const size = box.getSize(new THREE.Vector3())
        const longest = Math.max(size.x, size.y, size.z)
        if (longest > 0.0001) group.scale.setScalar(5 / longest)
        // Recenter
        const center = box.getCenter(new THREE.Vector3()).multiplyScalar(5 / longest)
        group.position.sub(center)
        group.position.y += 1
        scene.add(group)

        const tick = () => {
          raf = requestAnimationFrame(tick)
          controls!.update()
          renderer!.render(scene!, camera!)
        }
        tick()
        setStatus('rendering')
      } catch (e: any) {
        console.error(e)
        if (!canceled) setErr(e?.message ?? String(e))
      }
    }
    run()
    return () => {
      canceled = true
      cancelAnimationFrame(raf)
      controls?.dispose()
      renderer?.dispose()
    }
  }, [root])

  return (
    <div className="flex flex-col gap-4 max-w-3xl w-full">
      <div className="glass-2 rounded-[var(--radius-panel)] p-5 shadow-[var(--shadow-glass)]">
        <div className="text-[10px] uppercase tracking-[2px] text-[var(--color-accent)] font-semibold mb-1">Smoke test</div>
        <div className="text-[15px] text-white font-semibold">RGM loader → Three.js — Tiger I</div>
        <div className="text-[12px] text-[var(--color-text-2)] mt-1">{err ? <span className="text-red-300">Error: {err}</span> : status}</div>
        {stats && (
          <div className="grid grid-cols-2 gap-3 mt-4 text-[11px]">
            <Stat label="Source archive" value={stats.archive} />
            <Stat label="RGM size" value={`${(stats.fileSize / 1024).toFixed(1)} KB`} />
            <Stat label="Submeshes" value={stats.submeshes.length.toString()} />
            <Stat label="Total triangles" value={stats.totalTris.toLocaleString()} />
            <Stat label="Texture sets" value={stats.textureSets.toString()} />
            <Stat label="Materials" value={stats.materials.toString()} />
            <Stat label="Diffuse" value={stats.diffuseSize ?? (stats.diffuseFound === false ? 'not found' : 'untextured')} />
          </div>
        )}
      </div>

      <div className="glass-2 rounded-[var(--radius-panel)] shadow-[var(--shadow-glass)] aspect-[4/3] overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {stats && (
        <details className="glass-2 rounded-[var(--radius-panel)] p-4 shadow-[var(--shadow-glass)]">
          <summary className="text-[12px] text-[var(--color-text-2)] cursor-pointer">
            Submesh detail ({stats.submeshes.length})
          </summary>
          <div className="mt-3 max-h-64 overflow-y-auto text-[11px] font-mono space-y-1">
            {stats.submeshes.map((s, i) => (
              <div key={i} className="flex justify-between gap-3 px-2 py-1 rounded hover:bg-white/5">
                <span className="text-[var(--color-text-2)] truncate">{s.name}</span>
                <span className="text-[var(--color-text-3)] tabular-nums">{s.tris.toLocaleString()} tris</span>
                <span className="text-[var(--color-text-3)] truncate max-w-[120px]">{s.mat ?? '—'}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-1 rounded-lg p-3">
      <div className="text-[9px] uppercase tracking-[1.5px] text-[var(--color-text-3)]">{label}</div>
      <div className="text-[13px] text-white font-medium tabular-nums truncate">{value}</div>
    </div>
  )
}
