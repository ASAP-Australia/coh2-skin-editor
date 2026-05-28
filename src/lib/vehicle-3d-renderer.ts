/**
 * Offscreen Three.js vehicle silhouette renderer.
 *
 * Produces a 256² PNG of a vehicle posed at the classic CoH2 shop angle
 * (front-three-quarter, slight downward tilt) on a transparent background,
 * for use as the top-left badge in the tile compositor (step 7) and the
 * 3D body of the hover preview card (step 10).
 *
 * Why a dedicated module:
 *   - Keeps Three.js out of `vehicle-icons.ts`'s import graph so that
 *     module stays cheap to load and tree-shakes cleanly on the server
 *     build. We register here at runtime via `registerThreeRenderer`.
 *   - The Viewport component's loader is over-spec'd for a static
 *     thumbnail (per-submesh PBR maps, decal compositing, normal/spec
 *     binding). We reuse the lightweight `loadStructure()` helper —
 *     vehicle SGAs are part of its archive search list, so the same
 *     entry point works for vehicles even though it was written for
 *     buildings.
 *
 * Lifecycle:
 *   - One renderer + scene per install root; lazily created on first
 *     call, kept warm across subsequent calls so we don't pay the
 *     WebGL-context cost per thumbnail.
 *   - Each render adds the model to the scene, frames the camera, draws
 *     one frame, reads the canvas as a PNG data URL, then disposes the
 *     model + textures before returning.
 *
 * Concurrency:
 *   - All renders are serialised through a single in-flight promise to
 *     avoid two callers fighting over the same shared canvas. The grid
 *     in step 8 fires six requests in parallel and we don't want one
 *     stomping on another's pixels.
 */

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Box3,
  Vector3,
  Sphere,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  CanvasTexture,
  MeshStandardMaterial,
  type Object3D,
  type Mesh,
  type Material,
  type Texture,
} from 'three'
import { loadStructure } from './structure-loader'
import { VEHICLES, rgmPath } from './vehicles'
import { registerThreeRenderer } from './vehicle-icons'
import { bakeDecalOntoKingTigerDiffuse } from './king-tiger-decal-bake'

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/** Install the renderer for the current CoH2 install. Wires the lazy
 *  `vehicle-icons.ts` callback so the icon cascade can produce 3D
 *  silhouettes when no better source is available.
 *
 *  Returns a teardown function the caller can invoke on unmount to drop
 *  the WebGL context + release GPU memory. Safe to call multiple times
 *  with different roots — each call replaces the previous binding. */
export function installVehicleRenderer(root: FileSystemDirectoryHandle): () => void {
  const ctx = new RendererContext(root)
  registerThreeRenderer((vehicleId: string) => ctx.render(vehicleId))
  return () => {
    registerThreeRenderer(null)
    ctx.dispose()
  }
}

/** Standalone rendering entry point for callers that don't want to go
 *  through the icon cascade (e.g. the hover-card preview in step 10 that
 *  wants a larger canvas + the live decal overlay on top).
 *
 *  @param size  output edge in CSS pixels. 256 is the default badge size;
 *               step 10 will pass 512 for the hover card body. */
export async function renderVehicleSilhouette(
  root: FileSystemDirectoryHandle,
  vehicleId: string,
  size = 256,
): Promise<string | null> {
  const ctx = sharedContext ?? (sharedContext = new RendererContext(root))
  return await ctx.render(vehicleId, size)
}

/** Shared instance used by `renderVehicleSilhouette`. The `installVehicleRenderer`
 *  path creates its own context; we keep the standalone path independent so
 *  the hover card works even before the editor mounts the renderer. */
let sharedContext: RendererContext | null = null

// ─────────────────────────────────────────────────────────────────────────
// King Tiger decal preview renderer
// ─────────────────────────────────────────────────────────────────────────

/**
 * Render the King Tiger (king_tiger_sdkfz_182) with a user decal composited
 * onto the hullSideRight UV region, and return the result as a PNG data URL.
 *
 * Steps:
 *   1. Fetch the vanilla diffuse from `/debug/king_tiger.png`.
 *   2. Bake the decal into a 2048² composite canvas via
 *      `bakeDecalOntoKingTigerDiffuse`.
 *   3. Wrap in a THREE.CanvasTexture and swap onto all mesh materials.
 *   4. Render via the shared RendererContext (same camera/lighting as
 *      `renderVehicleSilhouette`) at the requested `size`.
 *   5. Restore the original materials and return the PNG data URL.
 *
 * Returns `null` when the install handle is missing (King Tiger RGM not
 * loadable) or when any step fails — callers should degrade gracefully.
 */
export async function renderKingTigerWithDecal(opts: {
  install: FileSystemDirectoryHandle
  decalCanvas: HTMLCanvasElement
  size?: number
}): Promise<string | null> {
  const { install, decalCanvas, size = 512 } = opts

  // 1. Fetch and decode the vanilla diffuse texture.
  let vanillaImg: HTMLImageElement
  try {
    vanillaImg = await loadImageFromUrl('/debug/king_tiger.png')
  } catch (e) {
    console.warn('[renderKingTigerWithDecal] failed to load vanilla diffuse:', (e as Error).message)
    return null
  }

  // 2. Bake decal into a composited 2048² canvas.
  let bakedCanvas: HTMLCanvasElement
  try {
    bakedCanvas = await bakeDecalOntoKingTigerDiffuse(vanillaImg, decalCanvas)
  } catch (e) {
    console.warn('[renderKingTigerWithDecal] bake failed:', (e as Error).message)
    return null
  }

  // 3. Build a CanvasTexture from the baked canvas.
  const bakedTexture = new CanvasTexture(bakedCanvas)
  bakedTexture.colorSpace = SRGBColorSpace

  // 4. Render via the shared RendererContext.
  const ctx = sharedContext ?? (sharedContext = new RendererContext(install))

  // Serialise behind the shared busy queue so we don't stomp on concurrent
  // renderVehicleSilhouette calls sharing the same canvas.
  const result = await ctx.renderWithTexture('king_tiger_sdkfz_182', bakedTexture, size)
  bakedTexture.dispose()
  return result
}

// ─────────────────────────────────────────────────────────────────────────
// Internal renderer
// ─────────────────────────────────────────────────────────────────────────

/** Camera pose constants. The angles match CoH2's customisation screen —
 *  the model sits ~25° below the camera and rotated 35° around its
 *  vertical axis so both the side profile and the front turret face read
 *  cleanly. Distance is computed at runtime from the model's bounding
 *  sphere so big tanks (Jagdtiger) don't poke out of frame. */
const CAM_AZIMUTH_DEG = 35 // horizontal rotation around model
const CAM_ELEVATION_DEG = 20 // looking down from this many degrees
const CAM_FOV_DEG = 28 // narrow FOV → near-orthographic look
const FIT_MARGIN = 1.15 // extra padding around the bounding sphere

class RendererContext {
  private renderer: WebGLRenderer | null = null
  private scene: Scene | null = null
  private camera: PerspectiveCamera | null = null
  private root: FileSystemDirectoryHandle
  private busy: Promise<unknown> = Promise.resolve()
  private modelCache = new Map<string, { dataUrl: string; size: number }>()

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root
  }

  /** Render the vehicle substituting all mesh materials with the supplied
   *  texture. Used by `renderKingTigerWithDecal` so it can share the
   *  existing camera/lighting rig without forking the full render path. */
  async renderWithTexture(
    vehicleId: string,
    texture: Texture,
    size: number,
  ): Promise<string | null> {
    const next = this.busy.then(() => this.renderInnerWithTexture(vehicleId, texture, size))
    this.busy = next.catch(() => undefined)
    return await next
  }

  private async renderInnerWithTexture(
    vehicleId: string,
    texture: Texture,
    size: number,
  ): Promise<string | null> {
    const spec = VEHICLES.find(v => v.id === vehicleId)
    if (!spec) return null

    const { renderer, scene, camera } = this.ensureContext(size)

    let loaded: Awaited<ReturnType<typeof loadStructure>>
    try {
      loaded = await loadStructure(this.root, rgmPath(spec))
    } catch (e) {
      console.warn('[vehicle-3d-renderer] load failed:', (e as Error).message)
      return null
    }

    const group = loaded.group

    // Override every mesh material with the baked texture. We swap back
    // after the render so we don't pollute any cached mesh objects.
    const originalMaterials = new Map<Mesh, Material | Material[]>()
    group.traverse(obj => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      originalMaterials.set(mesh, mesh.material)
      const mat = new MeshStandardMaterial({ map: texture })
      mesh.material = mat
    })

    const bbox = new Box3().setFromObject(group)
    const centre = new Vector3()
    bbox.getCenter(centre)
    group.position.sub(centre)
    scene.add(group)

    const sphere = new Sphere()
    bbox.setFromObject(group).getBoundingSphere(sphere)
    const fitDist = (sphere.radius * FIT_MARGIN) / Math.tan((CAM_FOV_DEG * Math.PI) / 360)

    const az = (CAM_AZIMUTH_DEG * Math.PI) / 180
    const el = (CAM_ELEVATION_DEG * Math.PI) / 180
    camera.position.set(
      Math.sin(az) * Math.cos(el) * fitDist,
      Math.sin(el) * fitDist,
      Math.cos(az) * Math.cos(el) * fitDist,
    )
    camera.lookAt(0, 0, 0)
    camera.near = fitDist * 0.05
    camera.far = fitDist * 5
    camera.updateProjectionMatrix()

    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')

    // Clean up overridden materials, then dispose the group.
    group.traverse(obj => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      const overrideMat = mesh.material
      const orig = originalMaterials.get(mesh)
      if (orig !== undefined) mesh.material = orig
      // Dispose the override material (NOT the texture — caller owns it).
      if (Array.isArray(overrideMat)) {
        overrideMat.forEach(m => m.dispose())
      } else {
        overrideMat.dispose()
      }
    })

    scene.remove(group)
    disposeGroup(group)

    return dataUrl
  }

  /** Queue a render and return the resulting PNG data URL. Returns null
   *  when the vehicle is unknown or the RGM can't be loaded — callers
   *  fall back to the procedural placeholder. */
  async render(vehicleId: string, size = 256): Promise<string | null> {
    // Cache hit short-circuits the whole pipeline. Same `(id, size)` is
    // hit on every grid re-render, so this matters.
    const cacheKey = vehicleId
    const cached = this.modelCache.get(cacheKey)
    if (cached && cached.size === size) return cached.dataUrl

    // Serialise — the grid in step 8 fires six parallel resolves and we
    // share a single canvas, so we have to drain them one at a time.
    const next = this.busy.then(() => this.renderInner(vehicleId, size))
    this.busy = next.catch(() => undefined)
    const out = await next
    if (out) this.modelCache.set(cacheKey, { dataUrl: out, size })
    return out
  }

  private async renderInner(vehicleId: string, size: number): Promise<string | null> {
    const spec = VEHICLES.find(v => v.id === vehicleId)
    if (!spec) return null

    const { renderer, scene, camera } = this.ensureContext(size)

    // 1. Load model bytes + textures via the lightweight loader (no
    //    decals / normal maps — we just want a clean silhouette).
    let loaded: Awaited<ReturnType<typeof loadStructure>>
    try {
      loaded = await loadStructure(this.root, rgmPath(spec))
    } catch (e) {
      console.warn('[vehicle-3d-renderer] load failed:', (e as Error).message)
      return null
    }

    const group = loaded.group

    // 2. Centre + auto-frame. We re-centre on the bounding sphere so the
    //    camera math doesn't have to know which way the artist anchored
    //    the model in its source file. Some CoH2 RGMs are tracked-origin
    //    (origin at ground), others are turret-origin — both work after
    //    this normalisation.
    const bbox = new Box3().setFromObject(group)
    const centre = new Vector3()
    bbox.getCenter(centre)
    group.position.sub(centre)
    scene.add(group)

    const sphere = new Sphere()
    bbox.setFromObject(group).getBoundingSphere(sphere)
    const fitDist = (sphere.radius * FIT_MARGIN) / Math.tan((CAM_FOV_DEG * Math.PI) / 360)

    const az = (CAM_AZIMUTH_DEG * Math.PI) / 180
    const el = (CAM_ELEVATION_DEG * Math.PI) / 180
    camera.position.set(
      Math.sin(az) * Math.cos(el) * fitDist,
      Math.sin(el) * fitDist,
      Math.cos(az) * Math.cos(el) * fitDist,
    )
    camera.lookAt(0, 0, 0)
    camera.near = fitDist * 0.05
    camera.far = fitDist * 5
    camera.updateProjectionMatrix()

    // 3. Render — single frame, no animation loop. The renderer is
    //    `preserveDrawingBuffer: true` so `toDataURL` returns valid
    //    pixels (otherwise WebGL clears between RAFs).
    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')

    // 4. Tear down the model so we don't accumulate GPU buffers across
    //    calls. Geometries + materials are shared inside `loadStructure`
    //    so we only have to dispose once per object, but we walk the
    //    tree to catch anything weird.
    scene.remove(group)
    disposeGroup(group)

    return dataUrl
  }

  /** Lazily create the renderer + scene. Sized to `size`; if a later
   *  call passes a different size we resize the canvas instead of
   *  rebuilding (renderer setSize is cheap and keeps the GL context). */
  private ensureContext(size: number): {
    renderer: WebGLRenderer
    scene: Scene
    camera: PerspectiveCamera
  } {
    if (!this.renderer) {
      const canvas = document.createElement('canvas')
      const renderer = new WebGLRenderer({
        canvas,
        alpha: true, // transparent background — caller decides bg
        antialias: true,
        preserveDrawingBuffer: true, // required for toDataURL after render
        powerPreference: 'low-power', // we render at most one frame per call
      })
      renderer.setPixelRatio(1) // 256² is already crisp; no DPR scaling
      renderer.outputColorSpace = SRGBColorSpace
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.0
      renderer.setClearColor(0x000000, 0) // alpha 0 → transparent

      const scene = new Scene()

      // Three-light rig — hemisphere for ambient + key/fill directionals
      // for definition. Tuned warm so steel-grey tanks don't read flat
      // grey on the tile.
      const hemi = new HemisphereLight(0xb8c4d6, 0x2a2620, 0.9)
      scene.add(hemi)

      const key = new DirectionalLight(0xffe9c8, 1.6)
      key.position.set(1.2, 1.8, 1.0)
      scene.add(key)

      const fill = new DirectionalLight(0x6f88b8, 0.6)
      fill.position.set(-1.5, 0.4, -0.6)
      scene.add(fill)

      const rim = new DirectionalLight(0xffffff, 0.7)
      rim.position.set(-0.4, 0.6, -1.6)
      scene.add(rim)

      const camera = new PerspectiveCamera(CAM_FOV_DEG, 1, 0.1, 200)

      this.renderer = renderer
      this.scene = scene
      this.camera = camera
    }

    if (this.renderer.domElement.width !== size) {
      this.renderer.setSize(size, size, false)
    }
    return { renderer: this.renderer, scene: this.scene!, camera: this.camera! }
  }

  /** Drop the WebGL context + GPU buffers. Called from
   *  `installVehicleRenderer`'s teardown. */
  dispose(): void {
    this.modelCache.clear()
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.forceContextLoss()
      this.renderer = null
    }
    this.scene = null
    this.camera = null
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Load a URL into a decoded HTMLImageElement. Used by `renderKingTigerWithDecal`
 *  to fetch the vanilla King Tiger diffuse from `/debug/king_tiger.png`. */
function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

/** Walk a Three.js group and dispose every geometry/material/texture it
 *  owns. Necessary because `loadStructure` allocates fresh buffers per
 *  call and the WebGL driver won't reclaim them without an explicit
 *  `dispose()`. */
function disposeGroup(group: Object3D): void {
  group.traverse(obj => {
    const mesh = obj as Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) {
        mat.forEach(disposeMaterial)
      } else if (mat) {
        disposeMaterial(mat as Material)
      }
    }
  })
}

function disposeMaterial(mat: Material): void {
  // Standard / Physical materials carry their textures on named slots;
  // walking the keys is the simplest way to catch them all without
  // hard-coding the slot list.
  for (const key of Object.keys(mat) as Array<keyof typeof mat>) {
    const v = (mat as unknown as Record<string, unknown>)[key as string]
    if (v && typeof v === 'object' && (v as Texture).isTexture) {
      ;(v as Texture).dispose()
    }
  }
  mat.dispose()
}
