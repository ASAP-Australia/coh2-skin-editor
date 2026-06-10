# Build Internals: `buildVehicleIntoCache` & Cache Portability

## Make-or-break verdict

**Cached vehicles ARE NOT portable to a second renderer without re-doing the
GPU-bound work (shader compile + texture upload), but all CPU-side work
(parse, decode, geometry, material, mesh assembly) IS portable and freely
reusable by any renderer.**

The cache stores `CachedVehicleGroup` (Viewport.tsx:629–641), whose core
payload is:

```ts
group: THREE.Group          // Mesh + MeshPhysicalMaterial + CanvasTexture
baseDiffuse: THREE.Texture  // CanvasTexture wrapping an HTMLCanvasElement
normalTex: THREE.Texture    // CanvasTexture from rgtToCompressedTexture
model: RgmModel             // raw JS parse result
diffuseCanvas: HTMLCanvasElement
submeshMap: Map<string, Mesh>
```

`THREE.Group`, `THREE.Mesh`, `THREE.MeshPhysicalMaterial`, and
`THREE.CanvasTexture` are **CPU-side JS objects** — they carry no GL handle
until a renderer actually draws them (or calls `initTexture`/`compileAsync`).
Nothing stored in the cache is bound to renderer A's GL context.

When renderer B first encounters these objects it will re-upload the textures
(cheap — bytes already decoded, just a `gl.texImage2D`) and recompile the
shader programs once (cheap on a warm driver cache). The decoded RGBA pixel
data and the buffer geometry arrays are already in JS heap and require no
re-parsing. The cost difference is: full warmup ≈ SGA-fetch + BC-decode +
geometry-build + GPU-upload; second renderer ≈ GPU-upload only.

Both caches are **module-level singletons** (Viewport.tsx:643, 648):

```ts
const vehicleGroupCache = new Map<string, CachedVehicleGroup>()  // line 643
const pinnedVehicleCache = new Map<string, CachedVehicleGroup>() // line 648
```

They survive React remounts and any number of `new WebGLRenderer(...)` calls.
A Connect-screen renderer A can warm the CPU side and the Editor's renderer B
inherits the same JS objects.

---

## Step-by-step build path for one vehicle

All code is in `buildVehicleIntoCache` (Viewport.tsx:4135–4638).

### 1. Early guard (line 4141)
```ts
if (!rendererRef.current || !cameraRef.current) return
```
The renderer is required here **only to gate entry** (no renderer = no GPU
phase, so the function bails rather than doing half-work). The CPU-side build
(phases 2–5 below) does not itself touch the renderer at all.

### 2. SGA fetch + RGM parse — CPU only (lines 4183–4209)
`getPreloadedArchive` / `SgaArchive.open` / `a.readByPath` fetch raw bytes.
`parseRgm(rgmBytes)` → JS `RgmModel`. No GL calls.

### 3. Diffuse decode — CPU/worker async (lines 4336–4358)
```ts
const rgt = decodeRgt(rgtBytes)                  // CPU: header parse
const rgba = await decodeRgtOffThread(rgt)        // Worker: BC1/BC3 decompress
diffuseImage = document.createElement('canvas')
diffuseImage.getContext('2d')!.putImageData(...)
diffuse = new CanvasTexture(diffuseImage)          // CPU: JS object, no GPU yet
```
`decodeRgtOffThread` (decode-pool.ts:65) dispatches to a round-robin Worker
pool (2–8 workers, capped by `navigator.hardwareConcurrency`). BC decode is
**fully off-thread and async**. The resulting `CanvasTexture` wraps an
`HTMLCanvasElement`; the GPU upload is lazy and happens only on first render.

### 4. Normal/specular/roughness decode — CPU, synchronous (lines 4362–4399, 4450–4471)
Non-body submesh textures use `rgtToCompressedTexture` / `bcToCanvas` +
`new CanvasTexture(cv)` — synchronous on the main thread. This is the primary
jank risk for submesh-heavy vehicles (4–6 extra textures per vehicle, ~2–5 ms
each on main thread). The diffuse decode (the largest texture) is off-thread.

### 5. BufferGeometry + MeshPhysicalMaterial assembly — CPU only (lines 4523–4554)
`sub.geometry` is already a `BufferGeometry` from `parseRgm`. A new
`MeshPhysicalMaterial` is created with `map`, `normalMap`, etc. set to the
just-decoded textures. No renderer call. Group assembled with `group.add(m)`.

### 6. GPU warmup — GPU-context-bound, uses `rendererRef.current` (lines 4596–4616)
```ts
const stagingScene = new Scene()
stagingScene.add(group)
await rendererRef.current!.compileAsync(stagingScene, cameraRef.current!)  // line 4600
stagingScene.remove(group)
group.traverse(o => {
  ...
  rendererRef.current!.initTexture(t)   // line 4614
})
```
`compileAsync` compiles GLSL programs; `initTexture` force-uploads texture
data to the GPU. These are the **only renderer calls** in the entire build.
They require renderer A's GL context. If renderer B later shows the same
group, Three.js will re-run both steps once on first render — at low cost
because the JS-side decoded data is already in memory.

### 7. Cache insertion (lines 4625–4633)
`pinnedVehicleCache.set(spec.id, { group, baseDiffuse, normalTex, model,
diffuseCanvas, submeshMap, lastUsed })` — pure JS.

---

## Cost split per vehicle

| Phase | Thread | Renderer required? | Rough share |
|---|---|---|---|
| SGA fetch + RGM parse | Main (async IO) | No | ~10 % |
| Diffuse BC decode | Worker (off-thread) | No | ~30 % |
| Submesh tex decodes | Main (sync) | No | ~20 % |
| Geometry/material assembly | Main (sync) | No | ~10 % |
| `compileAsync` + `initTexture` | Main (GL) | YES | ~30 % |

The GPU phase (compileAsync + initTexture) is the dominant main-thread jank
source. BC decode is the dominant wall-clock source but is off-thread. A
second renderer re-pays only the ~30 % GPU phase (one-time, on first draw).

---

## Can the CPU-side build succeed with NO renderer?

Yes, phases 2–5 require no renderer. The only blocker is the early-exit guard
at line 4141 (`if (!rendererRef.current ...) return`). Removing or relaxing
that guard would allow the CPU-side build to proceed with no renderer;
the GPU phase at lines 4596–4616 would need to be skipped (or deferred).
The cached group would be fully usable by any renderer — it would just pay
the GPU-upload cost on first draw rather than during warmup.

---

## `eager` parameter and idle gate (lines 4138–4168)

```ts
const waitForIdle = async (): Promise<void> => {
  if (eager) return         // skip idle gate entirely in eager mode
  ...  // 450 ms camera-idle wait, hard ceiling 8 s
}
```
`eager = true` disables the 450 ms camera-idle gate at **three points**:
after initial entry (line 4168), before diffuse decode (line 4338), and
before Group assembly (line 4402). This lets the Connect-screen batch run
at full speed.

`preloadRef` is wired at Viewport.tsx:4641–4645:
```ts
useEffect(() => {
  if (!preloadRef) return
  preloadRef.current = buildVehicleIntoCache
  return () => { preloadRef.current = null }
}, [preloadRef, buildVehicleIntoCache])
```
Editor calls `preloadRef.current(spec, season, /*eager=*/true)` to trigger
the batch. The ref is stable across renders once the Viewport mounts.

---

## Cache display path (how cached vehicles are shown)

At Viewport.tsx:2559–2635, on vehicle switch:
```ts
const cachedEntry = pinnedVehicleCache.get(vehicle.id) ?? vehicleGroupCache.get(vehicle.id)
if (cachedEntry) {
  fastScene.add(cachedEntry.group)   // line 2577
  ...
  return  // skip all parse/decode/build
}
```
The cached `group` is added directly to `sceneRef.current` (the Editor's live
scene). The renderer that previously ran `compileAsync` on it may or may not
be the same one that draws it. If it is a new renderer, Three.js re-uploads on
the next `renderer.render()` call — transparent to the caller.
