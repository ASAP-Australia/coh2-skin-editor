import { useEffect, useRef, useState } from 'react'
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  OrthographicCamera,
  HemisphereLight,
  DirectionalLight,
  PCFSoftShadowMap,
  Color,
  Fog,
  Group,
  Mesh,
  BoxGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  CanvasTexture,
  CubeTexture,
  PMREMGenerator,
  Raycaster,
  GridHelper,
  SRGBColorSpace,
  NoColorSpace,
  RepeatWrapping,
  DoubleSide,
  ACESFilmicToneMapping,
  NeutralToneMapping,
  ReinhardToneMapping,
  type ToneMapping,
  type Material,
  type Texture,
  Box3,
  Vector3,
  Vector2,
  BufferGeometry,
  BufferAttribute,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { locateArchives } from '@/lib/coh2-fs'
import { SgaArchive } from '@/lib/sga'
import { parseRgm, type RgmModel } from '@/lib/rgm'
import { decodeRgt, rgtToCompressedTexture } from '@/lib/rgt'
import { bcToCanvas } from '@/lib/bc-decode'
import { rgmPath, type VehicleSpec } from '@/lib/vehicles'
import {
  type ScenePreset,
  type ToneMappingMode,
  SCENE_PRESETS,
  DEFAULT_PRESET_ID,
  applySeasonOverrides,
} from '@/lib/scene-settings'
import { loadSkybox, proceduralSkybox, listAvailableEnvs, filterEnvsBySeason } from '@/lib/skybox'
import { loadStructure } from '@/lib/structure-loader'
import { computeExplodeDirection } from '@/lib/explode-direction'
// PMREM IBL is active for the in_game_field preset — the scene
// `environment` is baked from the real CoH2 skybox CubeTexture
// (`ArtEnvironment.sga`) at ~0.3 intensity, with a per-vehicle
// `envMapIntensity = 0.15` so reflections are present but never wash
// the diffuse to white. Other presets (studio_grid / showcase) skip
// the env map and rely on hemi + directional/omni rigs only. See
// scene-settings.ts for the per-preset light recipes (each derived
// from corsix's coh2-explorer extraction of CoH2's shader constants).

interface Props {
  root: FileSystemDirectoryHandle
  vehicle: VehicleSpec | null
  overlayCanvas?: HTMLCanvasElement | null
  /** Bumped by the parent every time the overlay canvas is repainted
   *  (decal placed/moved/removed, camo applied, hover preview updated).
   *  Drives the render-on-demand loop's overlay-dirty flag — without
   *  this, the loop has no way to know the canvas changed and would
   *  either re-upload every frame (the old behaviour, ~1 GB/s of GPU
   *  traffic) or never re-upload at all. Numeric counter, not a real
   *  version — only equality matters. */
  overlayVersion?: number
  onModelLoaded?: (model: RgmModel, diffuseImage: HTMLCanvasElement | null) => void
  /** Fired when a season-driven diffuse rebind completes (the in-place
   *  swap path, NOT the full model reload). Editor uses this to drop
   *  the SeasonToggle's loading-border at the exact moment the new
   *  texture is on-screen, instead of relying on a fixed timer. */
  onSeasonReady?: () => void
  onPick?: (uv: { u: number; v: number }) => void
  onHover?: (uv: { u: number; v: number } | null) => void
  onReconnect?: () => void
  /** Parts list emitted once the model loads. */
  onPartsLoaded?: (parts: string[]) => void
  /** Fired when the user clicks a submesh while explode mode is active.
   *  Null = user clicked empty space (background). Used to focus a single
   *  part for inspection / painting. When NOT in explode mode the canvas
   *  click is routed to onPick (decal placement) instead. */
  onPartClick?: (partName: string | null) => void
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
  /** Show a single faction soldier behind the vehicle as a "crewman"
   *  stand-in.  Driven from the Editor's "Crew" toggle in the Scene
   *  panel.  The soldier is loaded via the existing structure-loader
   *  pipeline and scaled to match the vehicle's apparent size; it
   *  renders in T-pose because we don't decode .rga animations yet. */
  showCrew?: boolean
  /** Active scene preset — controls tone mapping, lighting, background. */
  preset?: ScenePreset
  /** Override the initial camera position+target. Useful for the demo
   *  scene's locked front-3/4 angle. Position/target are in world units. */
  cameraInitial?: { position: [number, number, number]; target: [number, number, number] }
  /** When false, OrbitControls user input is disabled (no orbit/pan/zoom).
   *  The render loop still calls `controls.update()` so damping settles
   *  correctly. Default true (free orbit, current behavior). */
  controlsEnabled?: boolean
  /** Optional Three.js linear fog. Used by the demo scene to "block the
   *  user from seeing beyond" — gives the staged HQ + troops + skybox a
   *  cinematic depth without exposing the world's edges. */
  fog?: { color: number; near: number; far: number } | null
  /** Optional backdrop scene (HQ + soldiers + decorative props) loaded
   *  for demo mode. Each entry is loaded via `loadStructure()` and added
   *  to its own scene group; the whole composition is torn down/re-built
   *  on identity change. Pass an empty array (or omit) to remove. The
   *  same `rgmPath` may appear multiple times with different transforms
   *  (e.g. four soldiers from one mesh) — we de-duplicate the underlying
   *  RGM read but instance the geometry per entry. */
  demoProps?: ReadonlyArray<{
    rgmPath: string
    position: [number, number, number]
    rotationY: number
    scale: number
  }>
}

// Map our preset tone-mapping enum to Three.js constants.
function toneMappingFromMode(mode: ToneMappingMode): ToneMapping {
  switch (mode) {
    case 'aces':
      return ACESFilmicToneMapping
    case 'neutral':
      return NeutralToneMapping
    case 'reinhard':
      return ReinhardToneMapping
  }
}

// ---------------------------------------------------------------------------
// Submesh classification — many vehicle .rgm files include both intact and
// destroyed/wreck variants, sometimes overlapping in world space. We split
// them by name pattern so the user always sees one variant cleanly.
// ---------------------------------------------------------------------------
const DESTROYED_PATTERNS = [
  // `/destroy/i` was a substring match → also matched `m10_tank_destroyer` and
  // `m36_tank_destroyer` (the AEF tank-destroyer class), classifying their
  // INTACT body submeshes as wreck. The intact bucket then ended up empty,
  // the fallback dumped every mesh into `visible`, and the user saw the wreck
  // and intact bodies overlapping — read as "M10 and M36 have the wrong /
  // shared texture". Require a non-letter boundary AFTER `destroy` so:
  //   `destroy`, `destroyed`, `destroy_chassis`  → match
  //   `destroyer`, `destroyer_left`              → DON'T match (the 'er'
  //                                                tail keeps it a noun)
  /destroy(?:ed)?(?![a-z])/i,
  /wreck/i,
  /destruction/i,
  /burnt/i,
  /broken/i,
  /\bdmg\b/i,
  /_dam_/i,
  // Relic ships several RGMs with a "wreak" typo in the wreck material
  // name (m5a1_stuart_wreak, jagdtiger_wreak, …). Without this, 25+
  // wreck submeshes on the M5 Stuart leak into the intact view because
  // their material name doesn't match /wreck/. Mirrored in tokenFor()
  // below so wheel/tread variants of the wreck submeshes also classify
  // correctly.
  /wreak/i,
  // Wheel-variant destroyed forms common on the German armored car (Sd.Kfz.
  // 222 / 250) — both intact AND damaged wheel submeshes were rendering at
  // the front-right / back-left positions because the original pattern list
  // only had `_dam_` (mid-segment) and `\bdmg\b`.
  //
  // Note `\b` is unhelpful here: `_` is a JS regex word char, so `\bdam\b`
  // does NOT match `_dam_`. Use explicit lookarounds against alphanumerics
  // so we match `dam`/`damage`/`damaged` as a path segment regardless of
  // the surrounding underscores. The `_d_<pos>` variant catches
  // `wheel_d_fr`, `tire_d_01` style names that some RGMs use.
  /(?<![a-z0-9])damaged?(?![a-z0-9])/i,
  /(?<![a-z0-9])dam(?![a-z0-9])/i,
  /_d_(?:fr|fl|rr|rl|front|back|rear|left|right|side|\d+)(?:_|$)/i,
  // Additional wreck abbreviations the Puma + Kübelwagen RGMs use that
  // the original list missed. The user reported the black "stripe under
  // wheels" + the front-right / back-left wheel clipping continued after
  // the first broadening; both turned out to be wreck submeshes whose
  // names use `_dmg_`, `_dst_`, or `_dest_` segments rather than the
  // full word `damaged`. These three are universally wreck abbreviations
  // in CoH2 RGM conventions and are extremely unlikely to appear in a
  // legitimate submesh name, so the false-positive risk is negligible.
  /(?<![a-z0-9])dmg(?![a-z0-9])/i,
  /(?<![a-z0-9])dst(?![a-z0-9])/i,
  /(?<![a-z0-9])dest(?![a-z0-9])/i,
  // Catch-all for any submesh whose name contains BOTH "wheel" and a
  // damage indicator in either order. Covers exotic naming like
  // `wheel_fr_dmg`, `dmg_wheel_01`, `wheel_destroyed_back_left` that
  // doesn't fit the position-suffix template above.
  /wheel[^a-z]*(?:dmg|dst|dest|destroyed|wreck|broken|dam)/i,
  /(?:dmg|dst|dest|destroyed|wreck|broken|dam)[^a-z]*wheel/i,
  // Critical/broken-tread gameplay overlay submeshes — the in-game
  // "tracks destroyed" state, whose geometry covers the same UV range
  // as the main tread_L / tread_R submeshes and z-fights with the
  // intact treads (reads as "two tracks" / doubled track texture).
  // Covers both word orders and singular/plural across the fleet:
  //   `tread_critical`, `treads_critical`        (IS-2, ISU-152, SU-85, Sturmtiger)
  //   `critical_tread`, `Critical_Treads`        (Panther, T-34/76, KV-1, Elefant)
  // `[^a-z]+` matches any non-alpha separator (underscore, comma, space,
  // bracket) so the compound mesh-name format
  // `merged material-[vehicle,matname]` is handled — the previous
  // `(?:^|_)` boundary missed `[sturmtiger,tread_critical]` because the
  // char before the token is `,`, not `_` or start-of-string.
  /critical[^a-z]+treads?(?![a-z])|treads?[^a-z]+critical(?![a-z])/i,
  // Some RGMs name the destroyed-namespace meshes via a secondary material
  // group (e.g. `merged material-[brummbar_wreck,Brummbar_Tread_Left]`) —
  // even though the inner mat is a "tread", the outer container is a wreck
  // namespace. The patterns above already match those because the bracketed
  // string contains "wreck". This list also covers low-detail / proxy /
  // collision / shadow geometry that some RGMs ship alongside the main
  // mesh and which renders at the same world position, causing z-fighting.
  /\bproxy\b/i,
  /\bcollision\b/i,
  /\bphys(?:ics)?\b/i,
  /\bshadow\b/i,
  /\bocclus(?:ion|der)\b/i,
  /\bremains\b/i,
  /\bcrater\b/i,
]
function isDestroyedMesh(name: string): boolean {
  return DESTROYED_PATTERNS.some(re => re.test(name))
}

/**
 * Some CoH2 RGMs ship the same submesh listed twice (Panther: `merged
 * material-[panther,panther]` × 2 plus tracks × 2). Both entries have the
 * same name, same material, and identical vertex counts; rendering both
 * produces z-fighting on every body panel and on the tracks. We dedupe on
 * (name, materialName) and keep the first occurrence — the duplicate is
 * always the same geometry.
 */
function dedupeSubmeshes<T extends { name: string; materialName: string | null }>(
  meshes: T[],
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const m of meshes) {
    const key = `${m.name}|${m.materialName ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

/**
 * Second-line dedup: collapse submeshes that survived the (name, material)
 * pass but are still geometrically identical — same vertex count, same
 * bounding-box centre, same bounding-box size (rounded to 1cm for floating-
 * point slack).
 *
 * Catches the LOD0+LOD1 case where a CoH2 RGM ships, say, two copies of an
 * exhaust pipe with different mesh names (`exhaust` and `exhaust_lod1`) and
 * different material slots, but the geometry is the same physical pipe at
 * the same position. Rendering both produces the "4 exhaust pipes" /
 * "z-fighting tracks" user complaints on Jagdtiger, Stormtiger, Panther.
 *
 * Conservative: ONLY collapses when fingerprint matches exactly. Two
 * distinct pipes that happen to share the same vertex count but sit at
 * different positions get different bbox centres and survive.
 *
 * Note: requires `computeBoundingBox()` to be safe to call on the geometry.
 * BufferGeometry.computeBoundingBox is idempotent and side-effect free
 * w.r.t. rendering state, so calling it twice (here + the diagnostic block
 * downstream) is fine.
 */
function dedupeByGeometry<
  T extends { name: string; materialName: string | null; geometry: BufferGeometry },
>(meshes: T[]): T[] {
  const seen = new Map<string, T>()
  const out: T[] = []
  for (const m of meshes) {
    const geom = m.geometry
    const pos = geom.attributes.position as BufferAttribute | undefined
    if (!pos) {
      // No position attribute → can't fingerprint geometrically; keep it.
      out.push(m)
      continue
    }
    geom.computeBoundingBox()
    const bb = geom.boundingBox
    if (!bb) {
      out.push(m)
      continue
    }
    const cx = ((bb.min.x + bb.max.x) * 0.5).toFixed(2)
    const cy = ((bb.min.y + bb.max.y) * 0.5).toFixed(2)
    const cz = ((bb.min.z + bb.max.z) * 0.5).toFixed(2)
    const sx = (bb.max.x - bb.min.x).toFixed(2)
    const sy = (bb.max.y - bb.min.y).toFixed(2)
    const sz = (bb.max.z - bb.min.z).toFixed(2)
    const key = `${pos.count}|${cx},${cy},${cz}|${sx},${sy},${sz}`
    if (seen.has(key)) {
      continue
    }
    seen.set(key, m)
    out.push(m)
  }
  return out
}

/**
 * Build a small procedural ground texture — base grey with high-frequency
 * pixel noise (gravel/dirt grain) plus a few low-frequency darker blotches
 * (mud patches) and lighter blotches (grass tufts). 256² is enough at the
 * demo's viewing distance, and tiles 20× across the 200 m plane so each
 * repeat covers ~10 m — close to CoH2's own ground-texture density. The
 * texture is grayscale-ish so it multiplies cleanly into whatever season
 * tint the material colour carries (warm earth in summer, pale snow in
 * winter). Uses a deterministic seed so reloads don't produce subtly
 * different ground every time the viewport mounts.
 */
function createGroundTexture(): Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Deterministic PRNG — mulberry32, seeded from a fixed constant.
  let seed = 0x9e3779b1
  const rand = () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Base — mid-grey so material.color multiplies into a believable dirt /
  // snow shade. Fill, then add per-pixel noise to sit ±18 around it.
  ctx.fillStyle = '#8a8a8a'
  ctx.fillRect(0, 0, size, size)
  const imageData = ctx.getImageData(0, 0, size, size)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * 36
    data[i] = clamp8(data[i] + n)
    data[i + 1] = clamp8(data[i + 1] + n)
    data[i + 2] = clamp8(data[i + 2] + n)
  }
  ctx.putImageData(imageData, 0, 0)

  // Mud patches — soft darker blotches (multiply darker into the base).
  for (let n = 0; n < 14; n++) {
    const x = rand() * size
    const y = rand() * size
    const r = 8 + rand() * 22
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(40, 35, 28, ${0.22 + rand() * 0.18})`)
    grad.addColorStop(1, 'rgba(40, 35, 28, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // Grass tufts — soft lighter+greener blotches.
  for (let n = 0; n < 18; n++) {
    const x = rand() * size
    const y = rand() * size
    const r = 4 + rand() * 14
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(150, 160, 110, ${0.18 + rand() * 0.2})`)
    grad.addColorStop(1, 'rgba(150, 160, 110, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(20, 20)
  texture.anisotropy = MAX_ANISO
  return texture
}

/**
 * Anisotropic filtering level applied to every diffuse / normal / slab
 * texture in the viewport.  16 is the practical ceiling for current
 * desktop GPUs (NVIDIA / AMD / Intel all expose it on WebGL2); modern
 * mobile chips support it too.  Lower values (4 / 8, the project's prior
 * defaults) caused visible shimmering "pixel dots" on the hull at close
 * zoom because the minification filter fell back to point sampling on
 * grazing-angle texels.  At 16 the GPU samples up to 16 trilinear taps
 * per pixel, smoothing the grain right up to the camera.
 */
const MAX_ANISO = 16

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * Pick the season-appropriate colour tint for the ground material.
 *
 * Two regimes:
 *   • Textured slab (`mat.map` set — real CoH2 grass RGT loaded): summer
 *     uses white (0xffffff, no tint) so the grass reads naturally; winter
 *     uses a cool blue-grey (0xc8d4dc) which multiplies into the grass
 *     for an overcast / frosted look without a real snow swap.
 *   • Procedural slab (no `mat.map`): the original demo fallback —
 *     warm-brown earth (0x6a5a3e) summer, pale snow (0xb4c2cf) winter.
 *
 * Splitting on `mat.map` rather than a hand-tagged flag means the
 * regime correctly tracks the actual texture state at call time (e.g. if
 * the RGT load failed silently and we fell back to procedural).
 */
function seasonGroundTint(mat: MeshStandardMaterial, season: 'summer' | 'winter'): number {
  const hasRealTexture = mat.map != null
  if (hasRealTexture) return season === 'winter' ? 0xc8d4dc : 0xffffff
  return season === 'winter' ? 0xb4c2cf : 0x6a5a3e
}

/**
 * Derive a "snow" canvas variant from a grass-textured canvas.
 *
 * Previously winter mode just multiplied a cool blue tint into the same
 * grass texture (see `seasonGroundTint()` textured-slab branch) — the
 * grass blades and dirt patches still showed through, which read as
 * "blue-tinted grass" rather than snow. This helper produces an actual
 * snow-coloured variant by:
 *   1. Drawing the grass canvas through a `saturate(0.12) brightness(1.6)
 *      contrast(0.82)` filter — colour is mostly gone, mids pushed up
 *      toward white, harsh contrast softened. What survives is the
 *      subtle luminance grain of the underlying grass — enough to keep
 *      the ground from looking like a flat painted sheet but no green
 *      breaks through.
 *   2. Multiplying a cool snow-white tint (#dce4ec) so the highlights
 *      pick up the same blue cast they'd get from an overcast sky.
 *   3. A light `screen` pass with a 22% white wash to lift the whole
 *      image one more stop so it reads as fresh snow rather than dirty
 *      slush.
 *
 * Filter availability: all browsers we target support `ctx.filter` for
 * CanvasRenderingContext2D (Chrome ≥ 52, Safari ≥ 15.4, Firefox ≥ 49).
 */
function makeSnowVariant(source: HTMLCanvasElement): HTMLCanvasElement {
  const w = source.width,
    h = source.height
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) return out
  // Step 1: desaturate + brighten the grass texture to "snow luminance".
  ctx.filter = 'saturate(0.12) brightness(1.6) contrast(0.82)'
  ctx.drawImage(source, 0, 0)
  ctx.filter = 'none'
  // Step 2: cool snow-white tint via multiply — only the cold pixels of
  // the tint survive, warm grass tones get pushed toward pale blue-grey.
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = 'rgb(220, 228, 236)'
  ctx.fillRect(0, 0, w, h)
  // Step 3: gentle screen lift for "fresh snow" rather than slush.
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  return out
}

export default function Viewport({
  root,
  vehicle,
  overlayCanvas,
  overlayVersion,
  onModelLoaded,
  onSeasonReady,
  onPick,
  onHover,
  onReconnect,
  onPartsLoaded,
  onPartClick,
  selectedPart,
  explodeAll,
  season,
  envArchive: _envArchive,
  envName: _envName,
  showDestroyed = false,
  showCrew = false,
  preset = SCENE_PRESETS[DEFAULT_PRESET_ID],
  cameraInitial,
  controlsEnabled = true,
  fog = null,
  demoProps,
}: Props) {
  // Latest preset — held in a ref so the once-only render loop (defined
  // in the init useEffect) can read fresh values without being re-created on
  // every prop tick. Preset-driven scene mutations live in the effect below.
  const presetRef = useRef<ScenePreset>(preset)
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern: render loop reads presetRef without re-registering
  presetRef.current = preset
  // Latest-value refs for explode state — the once-only RAF tick reads these
  // without needing to be recreated on every prop change.
  const explodeAllRef = useRef<boolean>(explodeAll)
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern
  explodeAllRef.current = explodeAll
  const selectedPartRef = useRef<string | null>(selectedPart)
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern
  selectedPartRef.current = selectedPart
  // Demo-mode props are also held via refs so the once-only init effect
  // can read the user's choice at boot without going stale.
  const cameraInitialRef = useRef<typeof cameraInitial>(cameraInitial)
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern
  cameraInitialRef.current = cameraInitial
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshGroupRef = useRef<Group | null>(null)
  /** Auto-scale factor applied to the loaded vehicle group (longest axis
   *  → 5 units in non-demo mode, 1 in demo mode). Crew loading uses this
   *  to size the soldier to match — without it, a 1.8 m soldier loaded
   *  at native CoH2 scale dwarfs a King Tiger that's been crunched to
   *  5 units long.  Set by the heavy model-load effect, read by the
   *  crew-loading effect.  ModelKey is bumped whenever the underlying
   *  group identity changes (model swap or season reload), so the crew
   *  effect re-runs and re-attaches the soldier to the new chassis. */
  const vehicleScaleRef = useRef<number>(1)
  const vehicleApparentLengthRef = useRef<number>(5)
  const [vehicleReadyTick, setVehicleReadyTick] = useState(0)
  const baseTextureRef = useRef<Texture | null>(null)
  /** Per-vehicle helper that re-runs ONLY the body-diffuse RGT search for
   *  a different season and rebinds the resulting texture in-place. Set
   *  by the heavy model-load effect after the model + initial diffuse
   *  finish loading; cleared when the vehicle changes. The season effect
   *  below calls this so toggling Summer ↔ Winter doesn't tear down the
   *  whole mesh group + materials + cubemap (which made the ground colour
   *  visibly lead the tank texture). */
  const seasonReloadRef = useRef<((season: 'summer' | 'winter') => Promise<void>) | null>(null)
  const overlayTexRef = useRef<CanvasTexture | null>(null)
  /** Set whenever the overlay canvas is repainted (decal place, camo apply,
   *  base diffuse swap). The animation loop reads + clears this so we only
   *  re-upload the 16 MB CanvasTexture when it actually changed — uploading
   *  every frame was costing ~1 GB/s of GPU bandwidth and was the dominant
   *  cause of camera-rotation jank. Anything that mutates the canvas must
   *  flip this true. */
  const overlayDirtyRef = useRef(true)
  /** Render-on-demand gate. We render only when something has changed:
   *  the camera moved, an overlay paint happened, an explode tween is
   *  in flight, the model loaded, etc. When the user is idle the loop
   *  short-circuits before `renderer.render()`, freeing the GPU for the
   *  rest of the page (and letting laptops actually idle). */
  const needsRenderRef = useRef(true)
  const raycasterRef = useRef(new Raycaster())
  const pointerRef = useRef(new Vector2())
  /** All preset-managed lights live in this group. The preset effect tears
   *  it down + rebuilds when the preset changes. */
  const sceneLightsRef = useRef<Group | null>(null)
  /** Optional reference grid (Studio Grid preset only). */
  const sceneGridRef = useRef<GridHelper | null>(null)
  const groundMeshRef = useRef<Mesh | null>(null)
  const groundMatRef = useRef<MeshStandardMaterial | null>(null)
  /** Cached slab textures, one per season. Both are built once when the
   *  grass RGT loads — the winter variant is a canvas-filter derivative of
   *  the summer grass (heavy desaturate + brighten + cool blue overlay) so
   *  no extra archive scan is needed. Season toggles just swap the .map
   *  pointer between these two refs, atomic with the body-diffuse swap. */
  const slabSummerTexRef = useRef<Texture | null>(null)
  const slabWinterTexRef = useRef<Texture | null>(null)
  /** Atomic season swap for the slab top material — set inside the slab
   *  build effect, called by `seasonReloadRef` so ground + chassis flip on
   *  the same render frame. */
  const slabSeasonSwapRef = useRef<((season: 'summer' | 'winter') => void) | null>(null)
  /** Latest season prop — held in a ref so the slab build effect can read
   *  the current value at mount without re-running on every toggle. */
  const seasonRef = useRef<'summer' | 'winter'>(season)
  // eslint-disable-next-line react-hooks/refs -- intentional "ref-as-latest-value" pattern
  seasonRef.current = season
  /** Group holding all CoH2 entity instanced-meshes (trees, fences, etc.).
   *  Recreated when the heightmap loads; visibility piggybacks on the
   *  ground mesh so the "show ground" preset toggle hides everything. */
  const sceneEntitiesRef = useRef<Group | null>(null)
  /** When a CoH2 scene is loaded, this is the half-extent (metres) of
   *  the cropped spawn area around world origin. OrbitControls clamps
   *  its target XZ within ±this so the user can't pan over the void
   *  edge. `null` means no CoH2 scene is loaded → no constraint. */
  const spawnAreaHalfRef = useRef<number | null>(null)
  /** Approximate terrain height at world origin (centre of crop) — used
   *  to keep the camera above the ground and the orbit target near the
   *  surface. Updated when the cropped terrain is built. */
  const terrainGroundYRef = useRef<number>(0)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  /** Cached CoH2 cubemap for the in-game preset (loaded lazily on first use). */
  const cubemapRef = useRef<CubeTexture | null>(null)
  const cubemapLoadingRef = useRef<Promise<CubeTexture | null> | null>(null)
  /** Cache key the current cubemapRef was loaded with, so we know to
   *  invalidate when the user switches map / season. Format:
   *  `${sceneMapId ?? 'default'}|${season}`. */
  const cubemapKeyRef = useRef<string | null>(null)
  /** PMREM-baked environment map derived from the current cubemap.
   *  Used as `scene.environment` so PBR materials (especially the
   *  unlit-sided foliage cards in `structure-loader`) get correct
   *  ambient pickup from the sky/ground hemisphere. Without IBL the
   *  shaded faces of leaf cards collapse to ~black under the
   *  in_game_field's modest hemi (0.7). Re-baked whenever the cubemap
   *  changes; disposed alongside it. */
  const envMapRef = useRef<Texture | null>(null)
  /** Scene map id (e.g. "langres", "lawsons_forest") set by the terrain
   *  effect when a CoH2 scene loads. Used by the skybox effect to prefer
   *  an env name that matches the loaded map. */
  const sceneMapIdRef = useRef<string | null>(null)

  // Explode animation state
  const submeshMapsRef = useRef<Map<string, Mesh>>(new Map())
  const origPosRef = useRef<Map<string, Vector3>>(new Map())
  const targetPosRef = useRef<Map<string, Vector3>>(new Map())
  const explodeProgressRef = useRef(1) // 1 = done animating

  // Explode interactive state
  /** Name of the mesh under the cursor while explode mode is active. */
  const hoveredPartRef = useRef<string | null>(null)
  /** Last raw pixel position sampled for hover throttling (explode mode). */
  const hoverLastPxRef = useRef<{ x: number; y: number } | null>(null)
  /** World-space centre of the currently-isolated part (for controls.target lerp). */
  const isolateTargetRef = useRef<Vector3 | null>(null)
  /** controls.target saved just before entering isolate mode so we can restore it. */
  const savedControlsTargetRef = useRef<Vector3 | null>(null)
  /** Bounding-box size of the full vehicle, set after each model load. */
  const vehicleSizeRef = useRef<Vector3>(new Vector3(5, 3, 8))

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
    const renderer = new WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: false,
      // DEV-only: lets external tools (Claude preview, Playwright) read the
      // canvas via toDataURL/readPixels. Three.js otherwise consumes the
      // swap-chain buffer on present, so screenshots come back blank.
      preserveDrawingBuffer: import.meta.env.DEV,
    })
    // Cap pixel ratio at 1.5 — uncapped DPR on a 2× Retina display means
    // 4× the fragment-shader work per frame for almost no perceptible
    // gain on a 3D viewport (vs UI text where the difference is sharp).
    // Drops camera-rotation cost ~2× on Retina and HiDPI Windows scaling.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    rendererRef.current = renderer
    // Output in SRGB color space — without this Three.js renders in linear
    // space and the result appears significantly darker than the source textures.
    renderer.outputColorSpace = SRGBColorSpace
    // Shadow mapping — the single biggest visual cue separating the
    // current "model-in-a-void" look from a real CoH2 in-game render is
    // the dark directional shadow under the chassis.  Without it the
    // tank reads as floating; with it, the tank is grounded.
    //   • PCFSoftShadowMap: percentage-closer filtered, fast on modern
    //     GPUs and gives a 2–3 px feathered penumbra that hides the
    //     1024 px shadow-map quantisation perfectly at our orbit
    //     distance.  Sharper algorithms (PCSS/VSM) are more expensive
    //     for a benefit that's invisible in this composition.
    //   • Only the In-Game Field preset's KEY directional light casts.
    //     The Studio Grid and Showcase rigs are intentionally
    //     omni-directional ("100 % illumination, no dark cavities");
    //     adding shadow-casters there would re-introduce the
    //     dark-spot problem we deliberately fixed.
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
    // Tone mapping + exposure — the preset effect writes the real values
    // immediately after init; these are just the boot fallback.
    const initial = presetRef.current
    renderer.toneMapping = toneMappingFromMode(initial.toneMapping)
    renderer.toneMappingExposure = initial.exposure
    const scene = new Scene()
    scene.background = new Color(0x0c0d10)
    sceneRef.current = scene
    // Dev-only: expose the scene + camera on window so manual probes can
    // walk the tree (bounding boxes, intersection checks, etc.) without
    // needing a screenshot. Stripped in production builds because
    // import.meta.env.DEV is statically replaced by Vite.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev-only: expose internals on window for manual probing in DevTools
      ;(window as any).__viewport_scene = scene
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same
      ;(window as any).__viewport_renderer = renderer
    }

    // Far plane = 2000 m so a fully-loaded CoH2 cubemap (rendered at
    // distance ≈ camera.far / sqrt(3) for a unit cube) doesn't get
    // clipped on big maps where the user has zoomed out to ~150 m.
    const camera = new PerspectiveCamera(38, 1, 0.1, 2000)
    // Caller-supplied initial pose (demo scene's locked front-3/4 angle)
    // wins over the default. Both are pre-load fallbacks that get refined
    // once the model's bbox is known further down in the load pipeline.
    const camInit = cameraInitialRef.current
    if (camInit) camera.position.set(...camInit.position)
    else camera.position.set(8, 4, 8)
    cameraRef.current = camera
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev-only: expose camera on window for manual probing
      ;(window as any).__viewport_camera = camera
    }

    const controls = new OrbitControls(camera, canvasRef.current)
    controls.enableDamping = true
    // Default damping (0.05) feels mushy at terrain scale — bump so the
    // camera settles in ~6 frames instead of ~30. Speeds are tuned for
    // 100 m+ orbit distances: zoomSpeed=1.6 makes wheel-zoom traverse the
    // 5→100 m range in ~12 notches instead of 50, rotateSpeed/panSpeed
    // give a ~1.5× faster swing per pixel of drag.
    controls.dampingFactor = 0.12
    controls.zoomSpeed = 1.6
    controls.rotateSpeed = 1.1
    controls.panSpeed = 1.4
    if (camInit) controls.target.set(...camInit.target)
    else controls.target.set(0, 1.2, 0)
    controls.autoRotateSpeed = 0.6
    controlsRef.current = controls
    // Wake the render-on-demand loop whenever the user touches the camera
    // — drag, wheel-zoom, pan. `controls.update()` returning true while
    // damping settles handles the tail; this fires the initial wake.
    // We also clamp the orbit target + camera position when a cropped
    // CoH2 scene is loaded:
    //   • target.x / target.z stay within the spawn area half-extent so
    //     the user can't pan past the void edge.
    //   • camera.y stays above (groundY + 1.5 m) so it can't dive under
    //     the terrain.
    //   • polar angle is capped at ~88° so looking straight down the
    //     horizon doesn't reveal the void floor.
    controls.addEventListener('change', () => {
      const half = spawnAreaHalfRef.current
      if (half != null) {
        // Clamp orbit target inside the playable area — prevents the
        // camera from drifting outward when the user pans across the
        // edge of the cropped terrain.
        controls.target.x = Math.max(-half, Math.min(half, controls.target.x))
        controls.target.z = Math.max(-half, Math.min(half, controls.target.z))
        // Keep target at terrain height so the orbit feels grounded.
        controls.target.y = Math.max(
          terrainGroundYRef.current - 1,
          Math.min(terrainGroundYRef.current + 4, controls.target.y),
        )
        // Don't let the camera dive below the terrain.
        const minCamY = terrainGroundYRef.current + 1.5
        if (camera.position.y < minCamY) camera.position.y = minCamY
      }
      needsRenderRef.current = true
    })

    // Lights live in a group owned by the preset effect — empty at boot,
    // populated by the first applyPreset() call.
    const lightsGroup = new Group()
    lightsGroup.name = '__sceneLights'
    sceneLightsRef.current = lightsGroup
    scene.add(lightsGroup)

    // Ground — terrain plane. Reads as dirt/grass at the demo composition
    // distance (camera ~13 m back, looking down at ~20°), so a flat solid
    // colour came across as a void rather than the floor of a clearing.
    // We bake a small procedural canvas — base earth tone with per-pixel
    // noise plus a few darker mud / lighter grass blotches — and tile it
    // 20× across the 200 m plane (≈10 m per repeat, matching CoH2's
    // texture density in actual battlefields). The material colour is
    // still season-driven (winter → snowy tint, otherwise → warm earth)
    // and multiplies into the map, so the texture brightens or cools
    // automatically with the season. Catches directional-light shadows.
    const groundGeo = new PlaneGeometry(200, 200, 1, 1)
    const groundMap = createGroundTexture()
    const groundMat = new MeshStandardMaterial({
      color: 0x6a5a3e, // warm dirt brown — multiplies into the texture
      map: groundMap,
      metalness: 0,
      roughness: 1.0,
    })
    groundMatRef.current = groundMat
    const ground = new Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    ground.visible = false // preset effect flips this
    groundMeshRef.current = ground
    scene.add(ground)

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      // OrbitControls.update() returns true while damping is still
      // settling (i.e. camera is logically moving even after the user
      // released). Treat that as a render trigger.
      const cameraMoving = controls.update()
      if (cameraMoving) needsRenderRef.current = true

      // Explode animation lerp — drives a render every frame while the
      // explode/implode tween is in flight, then stops.
      if (explodeProgressRef.current < 1) {
        explodeProgressRef.current = Math.min(1, explodeProgressRef.current + 0.06)
        const t = easeOut(explodeProgressRef.current)
        for (const [name, mesh] of submeshMapsRef.current) {
          const orig = origPosRef.current.get(name) ?? new Vector3()
          const target = targetPosRef.current.get(name) ?? orig
          mesh.position.lerpVectors(orig, target, t)
        }
        needsRenderRef.current = true
      }

      // ── Explode interactive: hover emissive + isolate visibility ──────────
      if (explodeAllRef.current) {
        const hoveredPart = hoveredPartRef.current
        const selectedPart = selectedPartRef.current

        for (const [name, mesh] of submeshMapsRef.current) {
          const mat = mesh.material as MeshStandardMaterial
          if (selectedPart) {
            // Isolate mode: selected → highlighted + visible; others → hidden
            if (name === selectedPart) {
              mesh.visible = true
              mat.emissive.setHex(0x2255aa)
              mat.emissiveIntensity = 0.3
            } else {
              mesh.visible = false
              mat.emissive.setHex(0x000000)
              mat.emissiveIntensity = 0
            }
          } else {
            // Full explode: all visible, hover gets a warm tint
            mesh.visible = true
            if (name === hoveredPart) {
              mat.emissive.setHex(0xffaa00)
              mat.emissiveIntensity = 0.18
            } else {
              mat.emissive.setHex(0x000000)
              mat.emissiveIntensity = 0
            }
          }
        }
        needsRenderRef.current = true
      }

      // ── OrbitControls.target lerp toward isolated part (or back on deselect) ─
      if (isolateTargetRef.current) {
        const dist = controls.target.distanceTo(isolateTargetRef.current)
        if (dist > 0.002) {
          controls.target.lerp(isolateTargetRef.current, 0.08)
          needsRenderRef.current = true
        } else {
          controls.target.copy(isolateTargetRef.current)
          // If this was a restore-back lerp (deselect path), stop once arrived
          if (!selectedPartRef.current) {
            isolateTargetRef.current = null
          }
          needsRenderRef.current = true
        }
      }

      // Overlay re-upload is the single most expensive thing this loop
      // can do — 2048² RGBA = 16 MB to the GPU. Only flip needsUpdate
      // on frames where something actually painted into the canvas.
      if (overlayDirtyRef.current && overlayTexRef.current) {
        overlayTexRef.current.needsUpdate = true
        overlayDirtyRef.current = false
        needsRenderRef.current = true
      }

      // Render-on-demand: if nothing changed this frame, skip the draw.
      // The RAF loop keeps spinning so we react instantly to the next
      // change, but the GPU goes quiet between interactions.
      if (!needsRenderRef.current) return
      renderer.render(scene, camera)
      needsRenderRef.current = false
    }
    tick()

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return
      const { clientWidth: w, clientHeight: h } = containerRef.current
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
      needsRenderRef.current = true
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      ro.disconnect()
      renderer.dispose()
    }
  }, [])

  // =========================================================================
  // Season change → swap diffuse + ground colour atomically
  //
  // Calls into seasonReloadRef set by the heavy model-load effect, which
  // captures the vehicle's archive context. The reload re-fetches just
  // the body diffuse RGT for the new season, decodes it, and rebinds it
  // on every body-tagged material in the same synchronous block as the
  // ground colour change — so the user reads it as one atomic swap rather
  // than the ground beating the tank texture. If the vehicle has no winter
  // variant the search falls through to the summer paths (existing
  // behaviour), but the ground tint still tracks the user's selection so
  // the toggle feels responsive.
  //
  // Skipped on first mount — the heavy effect computes the initial season
  // colour + diffuse together. Skipped also while seasonReloadRef is null
  // (between vehicle change and model finishing load).
  // =========================================================================
  const seasonInitialMountRef = useRef(true)
  useEffect(() => {
    if (seasonInitialMountRef.current) {
      seasonInitialMountRef.current = false
      return
    }
    const reload = seasonReloadRef.current
    if (!reload) {
      // No reload helper bound yet (model still loading) — fire the
      // ready signal anyway so the loading-border around the season
      // toggle doesn't get stuck waiting for a callback that will
      // never come.
      onSeasonReady?.()
      return
    }
    reload(season)
      .catch(e => console.warn('[viewport] season reload failed', e))
      .finally(() => onSeasonReady?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSeasonReady is a parent-supplied callback not wrapped in useCallback; adding it would re-fire the season reload on every parent render
  }, [season])

  // =========================================================================
  // Grass-textured ground slab
  //
  // Replaces the former CoH2 map / heightmap approach with a small "podium"
  // slab (BoxGeometry 10×0.2×10) wrapped with a CoH2 grass diffuse RGT
  // from ArtEnvironment.sga.  The slab top sits exactly at world Y=0 so
  // the vehicle (also at Y≈0) rests on it naturally.
  //
  // Size rationale: a King Tiger is ~7 m long, so 10 m square reads as a
  // tight display plinth — barely larger than the tank — rather than an
  // open field.  Single 1:1 UV coverage (no tiling) keeps the grass
  // looking like one natural patch instead of a checkerboard.
  //
  // The grass RGT path was found by scanning ArtEnvironment.sga for
  // /grass.*_dif\.rgt$/i — the best match is the nis_grass_plain_01 terrain
  // patch texture at 149 KB, which is a genuine CoH2 ground tile.
  //
  // Falls back silently to `createGroundTexture()` (the procedural canvas)
  // if the install is unavailable or the RGT can't be decoded.
  //
  // Deps: [root] only — the slab texture doesn't change with season.
  // =========================================================================
  useEffect(() => {
    const GRASS_RGT_PATH =
      'art/environment/objects/terrain/nis_grass_plain_01/swampy_field_01_dif.rgt'

    const scene = sceneRef.current
    if (!scene) return

    // Remove + dispose the old flat ground plane created at scene init.
    // (groundMeshRef still points at it; we replace the ref below.)
    const oldMesh = groundMeshRef.current
    if (oldMesh) {
      scene.remove(oldMesh)
      oldMesh.geometry.dispose()
      const oldMat = oldMesh.material as Material | Material[]
      const oldMats = Array.isArray(oldMat) ? oldMat : [oldMat]
      for (const m of oldMats) {
        if ((m as MeshStandardMaterial).map) {
          ;(m as MeshStandardMaterial).map!.dispose()
        }
        m.dispose()
      }
      groundMeshRef.current = null
      groundMatRef.current = null
    }

    let cancelled = false
    let slabSummerTex: Texture | null = null
    let slabWinterTex: Texture | null = null

    // Helper — apply the shared "single coverage, slight rotation" treatment
    // so both seasons share the same UV setup and the GPU sampling matches.
    const applySlabUv = (tex: Texture) => {
      tex.wrapS = tex.wrapT = RepeatWrapping
      tex.repeat.set(1, 1)
      tex.center.set(0.5, 0.5)
      tex.rotation = Math.PI / 7 // ~25° — breaks edge-alignment
      tex.anisotropy = MAX_ANISO
    }

    ;(async () => {
      // ── Try to load CoH2 grass RGT from ArtEnvironment.sga ───────────
      try {
        const archives = await locateArchives(root)
        if (!cancelled && archives) {
          const fh = await archives.getFileHandle('ArtEnvironment.sga')
          const file = await fh.getFile()
          const archive = await SgaArchive.open(file)
          const rgtBytes = await archive.readByPath(GRASS_RGT_PATH)
          if (rgtBytes && !cancelled) {
            const rgt = decodeRgt(rgtBytes)
            const cv = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
            // Summer: the grass canvas as-is.
            const summer = new CanvasTexture(cv)
            summer.colorSpace = SRGBColorSpace
            // **Wrap mode MUST be Repeat, not ClampToEdge.** Rotating the
            // UV square by 25° pushes the corners outside [0,1]; with
            // ClampToEdge the GPU samples the edge pixel row for every
            // out-of-range UV, producing radial "rainbow" streaks at the
            // four corners. RepeatWrapping wraps the texture content into
            // those corners — for a tileable grass RGT the seam is
            // essentially invisible.
            applySlabUv(summer)
            slabSummerTex = summer
            // Winter: derive a snow canvas from the same grass canvas via
            // `makeSnowVariant` (heavy desaturate + brighten + cool tint).
            // Builds in O(canvas px) on the main thread — for a 256² RGT
            // it's well under a millisecond, so we do it inline rather
            // than gating on an async worker. Result: toggling Summer ↔
            // Winter is a free texture-pointer swap, no archive scan.
            const winterCv = makeSnowVariant(cv)
            const winter = new CanvasTexture(winterCv)
            winter.colorSpace = SRGBColorSpace
            applySlabUv(winter)
            slabWinterTex = winter
          }
        }
      } catch (e) {
        console.log('[viewport] slab: grass RGT unavailable, using procedural fallback', e)
      }

      if (cancelled) {
        slabSummerTex?.dispose()
        slabWinterTex?.dispose()
        return
      }

      // Fall back to procedural if RGT load failed or install is absent.
      // No snow variant in the fallback path — `seasonGroundTint()` will
      // colour-tint it via the material's .color multiplier instead.
      if (!slabSummerTex) {
        const fallback = createGroundTexture()
        // Match the RGT path's UV treatment so the fallback reads the
        // same way visually. (Same wrap-mode reasoning as above — Repeat
        // avoids radial clamp streaks.)
        fallback.wrapS = fallback.wrapT = RepeatWrapping
        fallback.repeat.set(1, 1)
        fallback.center.set(0.5, 0.5)
        fallback.rotation = Math.PI / 7
        slabSummerTex = fallback
      }

      // ── Build the slab ────────────────────────────────────────────────
      // BoxGeometry(5, 0.2, 5): 5 m square, 20 cm thick.
      // Top face sits at Y = 0 when position.y = -0.10.
      // Tight plinth (was 7×7, originally 10×10) — the tank is auto-scaled
      // to a longest axis of ~5 units in editor mode, so a 5 m square
      // hugs the vehicle's silhouette closely and reads as a "tank
      // stand" rather than a slab the tank is parked on.
      //
      // Multi-material order is +X, -X, +Y(top), -Y(bottom), +Z, -Z.  The
      // top face gets the grass texture; the four side faces and the
      // hidden bottom get a solid dark-earth material instead.
      //
      // Why split the materials? Each face of a BoxGeometry has its own UV
      // square in [0,1]², independent of face aspect.  On a 5×0.2 m side
      // face that means the texture's V axis is compressed to the 20 cm
      // strip — combined with ClampToEdgeWrapping, the GPU stretches one
      // row of pixels around the whole edge, producing the rainbow vertical
      // "tearing" stripe seen on screen.  Painting the sides solid avoids
      // sampling the texture at those punishing UVs entirely.
      const slabGeo = new BoxGeometry(5, 0.2, 5)
      // Pick the season-matching texture at build time. If the winter
      // variant is missing (procedural fallback path), the summer texture
      // is used and `seasonGroundTint()` colour-multiplies it instead.
      const initialSlabTex =
        seasonRef.current === 'winter' && slabWinterTex ? slabWinterTex : slabSummerTex
      const slabMatTop = new MeshStandardMaterial({
        map: initialSlabTex,
        roughness: 0.95,
        metalness: 0,
      })
      // Initial color: white (no tint) when a real winter texture exists —
      // the texture itself carries the snow look. Falls back to legacy
      // colour-tint path when winter variant is missing (procedural slab).
      if (slabWinterTex) {
        slabMatTop.color.setHex(0xffffff)
      } else {
        slabMatTop.color.setHex(seasonGroundTint(slabMatTop, seasonRef.current))
      }
      // Edge / underside material — a darker earth tone that reads as a
      // soil cross-section poking out beneath the turf.  Slightly rougher
      // than the grass top so it matches in lighting response.
      const slabMatEdge = new MeshStandardMaterial({
        color: 0x2e2418, // dark loam — multiplies into ambient + key light
        roughness: 1.0,
        metalness: 0,
      })
      const slabMaterials: MeshStandardMaterial[] = [
        slabMatEdge, // +X
        slabMatEdge, // -X
        slabMatTop, // +Y (top — grass)
        slabMatEdge, // -Y (bottom — unseen but consistent)
        slabMatEdge, // +Z
        slabMatEdge, // -Z
      ]

      const slab = new Mesh(slabGeo, slabMaterials)
      slab.position.y = -0.1
      slab.receiveShadow = true
      // Mark so the preset's showGround gate treats this slab as valid
      // terrain (same semantics as the old __hasHeightmap flag).
      ;(slab as { __hasHeightmap?: boolean }).__hasHeightmap = true

      const sceneObj = sceneRef.current
      if (!sceneObj) {
        slabGeo.dispose()
        slabMatTop.dispose()
        slabMatEdge.dispose()
        slabSummerTex?.dispose()
        slabWinterTex?.dispose()
        return
      }
      sceneObj.add(slab)
      groundMeshRef.current = slab
      // groundMatRef still tracks the textured top so season-reload + the
      // "color the ground winter-blue" path keep working unchanged.
      groundMatRef.current = slabMatTop

      // Publish both textures for the season-swap helper.
      slabSummerTexRef.current = slabSummerTex
      slabWinterTexRef.current = slabWinterTex

      // Atomic season swap — flips the slab's .map between cached summer
      // and winter textures (when both exist) so the ground changes on
      // the same render frame as the chassis diffuse. No async work; the
      // textures were built at slab-load time.
      slabSeasonSwapRef.current = s => {
        const mat = groundMatRef.current
        if (!mat) return
        const summer = slabSummerTexRef.current
        const winter = slabWinterTexRef.current
        // Real winter texture available → pointer swap, neutralise tint.
        if (summer && winter) {
          mat.map = s === 'winter' ? winter : summer
          mat.color.setHex(0xffffff)
          mat.needsUpdate = true
          needsRenderRef.current = true
          return
        }
        // Fallback (procedural slab — no real RGT loaded). Keep the
        // legacy colour-tint behaviour so winter still reads as "frosted".
        mat.color.setHex(seasonGroundTint(mat, s))
        needsRenderRef.current = true
      }

      // Sync visibility with the current preset immediately.
      slab.visible = !!presetRef.current.showGround
      needsRenderRef.current = true
    })()

    return () => {
      cancelled = true
      // Drop the swap helper so a stale closure can't fire after teardown.
      slabSeasonSwapRef.current = null
      // Tear down the slab on effect cleanup (root change / unmount).
      // Slab now uses a 6-material array (grass top + dark-earth sides),
      // so handle both single + array cases defensively.
      const s = sceneRef.current
      const m = groundMeshRef.current
      if (m && s) {
        s.remove(m)
        m.geometry.dispose()
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        const disposedTextures = new Set<Texture>()
        for (const mm of mats) {
          const std = mm as MeshStandardMaterial
          // Multiple side materials may legitimately be the same object —
          // guard against double-dispose by tracking textures we've seen.
          if (std.map && !disposedTextures.has(std.map)) {
            disposedTextures.add(std.map)
            std.map.dispose()
          }
          std.dispose()
        }
        // Dispose the cached season textures separately — the material
        // pointed at one of them, the other was held only in the refs.
        const summer = slabSummerTexRef.current
        const winter = slabWinterTexRef.current
        if (summer && !disposedTextures.has(summer)) summer.dispose()
        if (winter && !disposedTextures.has(winter)) winter.dispose()
        slabSummerTexRef.current = null
        slabWinterTexRef.current = null
        groundMeshRef.current = null
        groundMatRef.current = null
      }
    }
  }, [root])

  // =========================================================================
  // controlsEnabled — toggles OrbitControls input without tearing them down.
  // Demo scene flips this off so the camera "idles on an angle" until the
  // user clicks Start editing, then it flips back on for free orbit.
  // =========================================================================
  useEffect(() => {
    const c = controlsRef.current
    if (!c) return
    c.enabled = controlsEnabled
    c.enableRotate = controlsEnabled
    c.enableZoom = controlsEnabled
    c.enablePan = controlsEnabled
  }, [controlsEnabled])

  // =========================================================================
  // fog — applies/removes a Three.js linear fog on the scene. Demo scene
  // uses this to "block the user from seeing beyond" — gives staged HQ +
  // troops + skybox a cinematic depth without revealing the world's edge.
  // =========================================================================
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    if (fog) {
      s.fog = new Fog(fog.color, fog.near, fog.far)
    } else {
      s.fog = null
    }
    needsRenderRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps -- property-level deps (fog?.color, fog?.near, fog?.far) are intentional; including the whole `fog` object would re-run the effect when the reference changes but values are identical
  }, [fog?.color, fog?.near, fog?.far])

  // =========================================================================
  // demoProps — async-load the full demo composition (HQ + soldiers + decor)
  // and parent each piece to the scene under one umbrella group. The same
  // `rgmPath` may appear multiple times (4 soldiers from one mesh); we load
  // the RGM once per unique path, then clone the prototype group for each
  // additional placement so geometry is shared but transforms are distinct.
  //
  // Re-runs whenever the composition's identity changes (new faction in
  // demo mode → swap HQ + soldier pose). Reads from the preload cache via
  // loadStructure() so most loads are instant.
  // =========================================================================
  const demoSceneGroupRef = useRef<Group | null>(null)
  /** Stable key derived from the demoProps array — comparing this avoids
   *  re-running the heavy load when React re-renders with a new array
   *  reference but identical contents. */
  const demoSceneKey = (demoProps ?? [])
    .map(p => `${p.rgmPath}|${p.position.join(',')}|${p.rotationY.toFixed(3)}|${p.scale}`)
    .join(';')
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    let cancelled = false

    // Tear down any prior composition. Dispose geometry once; materials
    // are shared across clones of the same prototype, so we keep a Set
    // and dispose each material exactly once.
    const prior = demoSceneGroupRef.current
    if (prior) {
      scene.remove(prior)
      const seenGeo = new Set<BufferGeometry>()
      const seenMat = new Set<Material>()
      prior.traverse(o => {
        const m = o as Mesh
        if (m.geometry && !seenGeo.has(m.geometry)) {
          seenGeo.add(m.geometry)
          m.geometry.dispose()
        }
        const mat = (m as Mesh).material as Material | Material[] | undefined
        const mats = Array.isArray(mat) ? mat : mat ? [mat] : []
        for (const x of mats) {
          if (x && !seenMat.has(x)) {
            seenMat.add(x)
            x.dispose()
          }
        }
      })
      demoSceneGroupRef.current = null
    }

    if (!demoProps || demoProps.length === 0) return

    const root_ = root
    ;(async () => {
      // Group every prop under one node so future tear-downs are a single
      // scene.remove() call. Soldiers + structures all live here.
      const sceneGroup = new Group()
      sceneGroup.name = '__demoScene'

      // Load each unique RGM at most once; reuse the prototype group for
      // duplicate paths (e.g. 4 instances of the same Pioneer mesh).
      const prototypeCache = new Map<string, Group>()
      for (const entry of demoProps) {
        if (cancelled) return
        let prototype = prototypeCache.get(entry.rgmPath)
        if (!prototype) {
          try {
            const { group } = await loadStructure(root_, entry.rgmPath)
            prototype = group
            prototypeCache.set(entry.rgmPath, prototype)
          } catch (e) {
            console.warn('[viewport] demo prop load failed:', entry.rgmPath, (e as Error).message)
            continue
          }
        }
        // Clone for placement. `clone(true)` does a recursive shallow
        // clone — geometries and materials are shared, only the Mesh
        // wrappers and transforms are duplicated. Three.js handles
        // independent Object3D transforms correctly here.
        const instance = prototype.clone(true)
        instance.position.set(...entry.position)
        instance.rotation.y = entry.rotationY
        instance.scale.setScalar(entry.scale)
        sceneGroup.add(instance)
      }

      if (cancelled) {
        // Dispose anything we just built — caller cancelled mid-flight.
        const seenGeo = new Set<BufferGeometry>()
        sceneGroup.traverse(o => {
          const m = o as Mesh
          if (m.geometry && !seenGeo.has(m.geometry)) {
            seenGeo.add(m.geometry)
            m.geometry.dispose()
          }
        })
        return
      }
      scene.add(sceneGroup)
      demoSceneGroupRef.current = sceneGroup
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, demoSceneKey])

  // =========================================================================
  // showCrew — loads/unloads a single faction soldier as a "crewman"
  // stand-in behind the focal vehicle.  Driven by the Editor's "Crew"
  // toggle in the Scene panel.
  //
  // Composition decision: a SINGLE soldier behind the chassis (not 4
  // scattered around it like the demo scene's old soldierCluster).
  // Reason: the user's reference shot showed crew ON the vehicle
  // (driver / commander), but real seat-point placement requires
  // hardpoint data from the game's blueprint files (which we don't
  // decode yet).  A single soldier 0.5 m behind the rear plate reads
  // cleanly as "the crew is here" without claiming geometry we can't
  // verify.
  //
  // Scaling: structure-loader returns soldiers at native CoH2 scale
  // (1 unit ≈ 1 m).  The vehicle has been auto-scaled (longest axis
  // → 5 units), so a native soldier would dwarf it.  We multiply by
  // vehicleScaleRef.current to keep proportions correct.
  //
  // Pose limitation: without an .rga animation decoder the soldier
  // renders in T-pose (arms straight out).  This is documented to the
  // user in the Scene panel's helper text under the toggle, so they
  // know to leave it off if the silhouette reads wrong.
  // =========================================================================
  const crewGroupRef = useRef<Group | null>(null)
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Tear down any prior crew on every change — the simplest correct
    // policy.  When the user toggles off, vehicle changes, or season
    // reloads, this clears the previous soldier; the load branch
    // below then re-builds if showCrew is still true.
    const prior = crewGroupRef.current
    if (prior) {
      scene.remove(prior)
      const seenGeo = new Set<BufferGeometry>()
      const seenMat = new Set<Material>()
      prior.traverse(o => {
        const m = o as Mesh
        if (m.geometry && !seenGeo.has(m.geometry)) {
          seenGeo.add(m.geometry)
          m.geometry.dispose()
        }
        const mat = m.material as Material | Material[] | undefined
        const mats = Array.isArray(mat) ? mat : mat ? [mat] : []
        for (const x of mats)
          if (x && !seenMat.has(x)) {
            seenMat.add(x)
            x.dispose()
          }
      })
      crewGroupRef.current = null
      needsRenderRef.current = true
    }

    if (!showCrew || !vehicle) return
    // Wait for at least one model load before placing the crewman.
    // vehicleReadyTick > 0 guarantees vehicleScaleRef + apparentLength
    // hold real values (not the boot-time defaults).
    if (vehicleReadyTick === 0) return

    // Faction → starter-infantry RGM path.  Same paths the disabled
    // soldierCluster in demo-scene.ts referenced — these are the units
    // that actually ship a unique RGM in retail (not the engineering
    // squads which reuse the pioneer mesh).
    const CREW_RGM_BY_FACTION: Record<string, string> = {
      german: 'art/armies/german/soldiers/pioneer/pioneer.rgm',
      west_german: 'art/armies/west_german/soldiers/assault_pioneer/assault_pioneer.rgm',
      soviet: 'art/armies/soviet/soldiers/conscript/conscript.rgm',
      aef: 'art/armies/aef/soldiers/rifleman/rifleman.rgm',
      british: 'art/armies/british/soldiers/tommy/tommy.rgm',
    }
    const rgmPath = CREW_RGM_BY_FACTION[vehicle.faction]
    if (!rgmPath) return

    let cancelled = false
    ;(async () => {
      try {
        const { group } = await loadStructure(root, rgmPath)
        if (cancelled) {
          // Dispose if cancelled mid-load — caller has unmounted or
          // toggled off in the meantime.
          const seenGeo = new Set<BufferGeometry>()
          group.traverse(o => {
            const m = o as Mesh
            if (m.geometry && !seenGeo.has(m.geometry)) {
              seenGeo.add(m.geometry)
              m.geometry.dispose()
            }
          })
          return
        }
        const wrapper = new Group()
        wrapper.name = '__crew'
        // Scale soldier to match the vehicle's apparent size.
        wrapper.scale.setScalar(vehicleScaleRef.current)
        // Position the soldier just behind the rear of the chassis.
        // vehicleApparentLengthRef holds longest-axis-after-scale; we
        // place at ~0.7 × half-length back along +z (camera looks down
        // -z so +z is "behind" from the orbit-default angle), sitting
        // on the ground plane.
        const halfLen = vehicleApparentLengthRef.current * 0.5
        wrapper.position.set(0, 0, halfLen + 0.4)
        // Face forward (toward the chassis) so the silhouette reads as
        // "crewman about to board" rather than "deserter".
        wrapper.rotation.y = Math.PI
        // Soldiers cast + receive shadow alongside the vehicle so the
        // contact shadow looks unified.
        group.traverse(o => {
          const m = o as Mesh
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Three.js Mesh type guard; isMesh not on base Object3D type
          if ((m as any).isMesh) {
            m.castShadow = true
            m.receiveShadow = true
          }
        })
        wrapper.add(group)
        scene.add(wrapper)
        crewGroupRef.current = wrapper
        needsRenderRef.current = true
      } catch (e) {
        console.warn('[viewport] crew load failed:', rgmPath, (e as Error).message)
      }
    })()

    return () => {
      cancelled = true
    }
    // vehicle.faction so a faction swap re-loads the right soldier;
    // vehicleReadyTick so a new model unblocks placement.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only vehicle?.faction is read inside; adding the whole `vehicle` object would re-run crew loading on every unrelated vehicle field change (e.g. id, name)
  }, [showCrew, vehicle?.faction, vehicleReadyTick, root])

  // =========================================================================
  // Active preset → renderer / lights / background / grid / autorotate
  //
  // Tears down the lights group and rebuilds it from the preset spec, swaps
  // the GridHelper, sets renderer tone-mapping + exposure, configures
  // background (color or — for in_game_field — async cubemap with procedural
  // fallback), and toggles ground visibility + autorotate.
  // =========================================================================
  useEffect(() => {
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const controls = controlsRef.current
    const lightsGroup = sceneLightsRef.current
    if (!renderer || !scene || !lightsGroup) return

    let cancelled = false

    // Apply season-aware lighting overrides — for `in_game_field` in winter
    // mode this swaps in cold blue sun + snow-bounce ambient + blue shadow
    // fill, replicating the actual lighting on CoH2 snow maps. Other
    // presets (studio/showcase) pass through unchanged. See
    // applySeasonOverrides() in scene-settings.ts for the data + sources.
    const effectivePreset = applySeasonOverrides(preset, season)

    // Tone mapping + exposure
    renderer.toneMapping = toneMappingFromMode(effectivePreset.toneMapping)
    renderer.toneMappingExposure = effectivePreset.exposure

    // ── Lights: tear down + rebuild ─────────────────────────────────────
    while (lightsGroup.children.length > 0) {
      const child = lightsGroup.children[0]
      lightsGroup.remove(child)
      // HemisphereLight / DirectionalLight have no resources to dispose
      // beyond removal from the scene graph.
    }
    const hemi = new HemisphereLight(
      effectivePreset.hemi.sky,
      effectivePreset.hemi.ground,
      effectivePreset.hemi.intensity,
    )
    lightsGroup.add(hemi)
    // Only the In-Game Field preset gets a shadow-casting key.  Studio
    // and Showcase use omni-directional fills by design — adding a
    // shadow caster there would re-introduce the dark-cavity problem.
    const enableShadowCaster = effectivePreset.id === 'in_game_field'
    effectivePreset.directionalLights.forEach((dl, i) => {
      const light = new DirectionalLight(dl.color, dl.intensity)
      light.position.set(dl.position[0], dl.position[1], dl.position[2])
      // First light in the preset's array IS the key.  Make it the sole
      // shadow caster — multiple casters quadruples the per-frame shadow
      // pass cost for a benefit (multi-side penumbras) that's invisible
      // in our orbit composition.
      if (enableShadowCaster && i === 0) {
        light.castShadow = true
        // Tight orthographic frustum sized for a King Tiger (~7 m long,
        // 3.7 m wide, 3 m tall) sat at the origin.  ±6 m on each axis
        // covers the model + crew + a generous halo for soldiers
        // standing on the hull, while keeping shadow-map texel density
        // high.  Wider bounds (e.g. ±20 m to cover the whole 100 m
        // ground plane) would smear the chassis shadow into 4-pixel
        // mush at 1024 px resolution.
        const cam = light.shadow.camera as OrthographicCamera
        cam.left = -6
        cam.right = 6
        cam.top = 6
        cam.bottom = -6
        cam.near = 0.5
        cam.far = 30
        light.shadow.mapSize.set(1024, 1024)
        // Tiny -ve bias avoids "shadow acne" (self-shadowing speckles
        // on lit faces) that PCF can't smooth away.  -0.0005 is the
        // smallest value that fully eliminates the acne on the King
        // Tiger's flat upper-hull plates without producing visible
        // peter-panning at the contact edge.
        light.shadow.bias = -0.0005
        light.shadow.normalBias = 0.02
        // Soft penumbra — radius is in shadow-map pixels.  3 px = ~1.5 °
        // of physical sun half-angle, slightly softer than a real
        // midday sun but reads as "cinematic" rather than "raytraced".
        light.shadow.radius = 3
        cam.updateProjectionMatrix()
      }
      lightsGroup.add(light)
    })
    if (effectivePreset.omniLights) {
      for (const ol of effectivePreset.omniLights) {
        // Omni-directional fill: implemented as DirectionalLights pointing
        // inward from each axis, so every facet of the model receives
        // light from at least 2 directions regardless of geometry winding.
        const light = new DirectionalLight(ol.color, ol.intensity)
        light.position.set(ol.position[0], ol.position[1], ol.position[2])
        lightsGroup.add(light)
      }
    }

    // ── Grid: swap ──────────────────────────────────────────────────────
    if (sceneGridRef.current) {
      scene.remove(sceneGridRef.current)
      ;(sceneGridRef.current.material as Material).dispose?.()
      sceneGridRef.current.geometry.dispose()
      sceneGridRef.current = null
    }
    if (preset.showGrid) {
      const grid = new GridHelper(10, 20, 0x444444, 0x2a2a2a)
      grid.name = '__sceneGrid'
      grid.position.y = 0.005 // hairline above ground plane to avoid z-fight
      sceneGridRef.current = grid
      scene.add(grid)
    }

    // ── Ground visibility ───────────────────────────────────────────────
    // Gate on `__hasHeightmap`: the initial 200×200 flat plane created at
    // scene-init is never user-facing — only show the ground after the
    // CoH2 heightmap effect has bound a real terrain geometry. Without
    // this gate, `preset.showGround = true` would expose the flat
    // placeholder while the heightmap is still decoding (or after it
    // fails to load entirely).
    if (groundMeshRef.current) {
      const hasHeightmap = !!(groundMeshRef.current as { __hasHeightmap?: boolean }).__hasHeightmap
      groundMeshRef.current.visible = preset.showGround && hasHeightmap
    }
    if (sceneEntitiesRef.current) {
      const hasHeightmap = !!(groundMeshRef.current as { __hasHeightmap?: boolean } | null)
        ?.__hasHeightmap
      sceneEntitiesRef.current.visible = preset.showGround && hasHeightmap
    }

    // ── Auto-rotate ─────────────────────────────────────────────────────
    if (controls) {
      if (preset.autoRotate === false) {
        controls.autoRotate = false
      } else {
        controls.autoRotate = true
        controls.autoRotateSpeed = typeof preset.autoRotate === 'number' ? preset.autoRotate : 0.6
      }
    }

    // ── Atmospheric fog ─────────────────────────────────────────────────
    // Only the in-game cubemap preset gets distance fog — studio/showcase
    // would dim the tank against their solid backdrop. Fog starts at 60 m
    // (well beyond the tank, which sits at <8 m radius from camera) and
    // fully obscures by 220 m, hiding the cropped terrain edge into the
    // sky horizon. Skips when the prop-driven `fog` is set (caller-driven
    // fog wins so demo-scene composition still works).
    if (!fog) {
      if (preset.background.kind === 'cubemap') {
        // Match the procedural-sky horizon hue at boot; once a real
        // cubemap loads, the fog reads as "haze" against it. Cool blue-
        // grey works for both summer green-russian and winter snow envs
        // because it's mid-saturation.
        const fogColor = season === 'winter' ? 0xb8c4d2 : 0xa8b6c8
        if (!(scene.fog instanceof Fog) || scene.fog.color.getHex() !== fogColor) {
          scene.fog = new Fog(fogColor, 60, 220)
        }
      } else {
        scene.fog = null
      }
    }

    // ── Background ──────────────────────────────────────────────────────
    if (preset.background.kind === 'color') {
      scene.background = new Color(preset.background.hex)
    } else {
      // Cubemap — try CoH2 ArtEnvironment.sga first, fall back to procedural
      // sky if the user hasn't connected a real install. The load is async;
      // show a procedural sky immediately so the viewport never goes black.
      ;(async () => {
        // Invalidate cache when the desired backdrop changes (user
        // loaded a different map, or switched season). Without this the
        // first map's sky stays glued onto every subsequent map.
        const desiredKey = `${sceneMapIdRef.current ?? 'default'}|${season}`
        if (cubemapRef.current && cubemapKeyRef.current !== desiredKey) {
          cubemapRef.current.dispose()
          cubemapRef.current = null
          cubemapKeyRef.current = null
        }
        if (!cubemapRef.current) {
          // StrictMode runs effects twice. The first run kicks off the
          // load and stores the promise on `cubemapLoadingRef`; its
          // cleanup then flips its local `cancelled` flag, but the
          // promise keeps running. The second run lands here with
          // `cubemapRef.current` still null and the promise still in
          // flight, so it must AWAIT the existing promise rather than
          // skipping ahead (the old code did the latter and fell
          // through with no scene.background applied → invisible sky).
          if (!cubemapLoadingRef.current) {
            cubemapLoadingRef.current = (async () => {
              // Try real CoH2 cubemap first. Earlier this hard-coded
              // `mission_06`, which doesn't exist in many retail installs —
              // the load logged `[skybox] no side texture found for mission_06`
              // and silently fell through to the procedural sky, making the
              // CoH2 lighting mode look identical to a hand-rolled gradient.
              // We now: 1) honour an explicit envName prop if supplied,
              // 2) probe a priority list, 3) fall through to whatever's in
              // the archive (listAvailableEnvs), and 4) only use procedural
              // when nothing else worked. The chosen env is cached in
              // cubemapRef so subsequent preset toggles are instant.
              try {
                const archives = await locateArchives(root)
                if (archives) {
                  try {
                    const fh = await archives.getFileHandle('ArtEnvironment.sga')
                    const file = await fh.getFile()
                    const archive = await SgaArchive.open(file)
                    const tryEnvs: string[] = []
                    // Caller-supplied env wins; otherwise prefer one whose
                    // name matches the loaded scene's map id. CoH2 envs and
                    // map ids share many names ("langreskaya",
                    // "lienne_forest", etc.) so a direct name probe nails
                    // the matching backdrop in 80%+ of cases. We try the
                    // raw id, with `_winter` suffix in winter, and a few
                    // common token sub-strings before falling through.
                    if (_envName) tryEnvs.push(_envName)
                    const mapId = sceneMapIdRef.current
                    if (mapId) {
                      if (season === 'winter') {
                        tryEnvs.push(`${mapId}_winter`, mapId, `${mapId}_summer`)
                      } else {
                        tryEnvs.push(mapId, `${mapId}_summer`, `${mapId}_winter`)
                      }
                      // Token fallback — e.g. "lawsons_forest" → "forest".
                      const tail = mapId.split('_').pop()
                      if (tail && tail !== mapId) tryEnvs.push(tail)
                    }
                    // Priority chain — Langreskaya as a generic green
                    // Russian woodland fallback, then Caen daylight, then
                    // mission_* variants → stormy as last-resort. Winter
                    // season tries the `_winter` suffix first for each id.
                    //
                    // After building the raw chain we filter by season
                    // so a winter request never accidentally falls back
                    // to `caen_midday` (clear sunny day) and vice-versa.
                    // `stormy_sky` is season-agnostic and stays in both.
                    const langresIds =
                      season === 'winter'
                        ? ['langreskaya_winter', 'langres_winter']
                        : ['langreskaya', 'langres', 'langreskaya_summer']
                    tryEnvs.push(
                      ...langresIds,
                      'caen_midday',
                      'caen_dawn',
                      'mission_01',
                      'mission_02',
                      'mission_03',
                      'mission_04',
                      'mission_05',
                      'mission_06',
                      'mission_07',
                      'foggy_autumn_day',
                      'caen_night',
                      'stormy_sky',
                    )
                    const seasonStrictEnvs = filterEnvsBySeason(tryEnvs, season)
                    for (const env of seasonStrictEnvs) {
                      const cube = await loadSkybox(archive, env)
                      if (cube) {
                        return cube
                      }
                    }
                    // Last resort: ask the archive what it has and try
                    // the first season-matched env. listAvailableEnvs
                    // returns ALL envs in the archive — filter them down
                    // so a winter session doesn't pick up a sunny env.
                    const available = filterEnvsBySeason(await listAvailableEnvs(archive), season)
                    for (const env of available) {
                      const cube = await loadSkybox(archive, env)
                      if (cube) {
                        return cube
                      }
                    }
                    console.warn(
                      '[viewport] in_game_field: no skyboxes loadable from ArtEnvironment.sga, using procedural',
                    )
                  } catch (e) {
                    console.warn('[viewport] in_game_field: archive read failed', e)
                  }
                }
              } catch {
                /* fall through */
              }
              // Procedural fallback — always succeeds.
              return await proceduralSkybox(season)
            })()
          }
          const cube = await cubemapLoadingRef.current
          // First arrival populates the ref; concurrent awaiters see it
          // already set and skip the assignment. Clear the loading slot
          // so a later desired-key change can kick off a fresh load.
          if (cube && !cubemapRef.current) {
            cubemapRef.current = cube
            cubemapKeyRef.current = desiredKey
          } else if (!cube) {
            // Cubemap loader failed quietly — the procedural fallback in
            // the preset effect handles the visual; no console noise on
            // the happy path. Surfaced via the disconnected-archive toast
            // upstream when the failure is user-actionable.
          }
          cubemapLoadingRef.current = null
        }
        if (cancelled) return
        // Only apply if we're still on a cubemap preset.
        if (presetRef.current.background.kind === 'cubemap' && cubemapRef.current) {
          scene.background = cubemapRef.current
          // Bake an IBL environment map from the same cubemap. PMREM
          // produces a prefiltered MIP chain so MeshStandardMaterial
          // can sample correctly across the roughness range. Without
          // this, the structure-loader's foliage cards (which have
          // outward-facing leaves but rely on ambient sky pickup for
          // the side facing away from the sun) render near-black.
          if (rendererRef.current) {
            // Dispose previous env so successive cubemap loads don't
            // leak GPU memory.
            if (envMapRef.current) {
              envMapRef.current.dispose()
              envMapRef.current = null
            }
            const pmrem = new PMREMGenerator(rendererRef.current)
            try {
              const env = pmrem.fromCubemap(cubemapRef.current).texture
              envMapRef.current = env
              scene.environment = env
              // Lowered from 0.65 → 0.3. Research into CoH2 / Essence
              // 3.0 (KGC 2013 rendering paper + community analysis)
              // shows CoH2 does not use prominent cubemap-based IBL
              // on vehicles — the dominant specular contribution comes
              // from the sun directional hitting the _spc map, with
              // sky bounce delivered via SH/hemisphere terms. At 0.65
              // we were stacking a strong cubemap IBL on top of the
              // hemi, which over-brightened lit faces (giving the
              // chrome-ball look) and added cubemap chromaticity that
              // the game's own renderer doesn't apply. 0.3 keeps just
              // enough environment lift for foliage / wreck props to
              // avoid black cavities; vehicle materials clamp further
              // down via per-material envMapIntensity (see below).
              ;(scene as { environmentIntensity?: number }).environmentIntensity = 0.3
            } catch (e) {
              // PMREM bake can fail on WebGL contexts that don't support
              // floating-point textures (some integrated GPUs). The scene
              // falls back to non-IBL shading which is visually acceptable;
              // we keep this single warn because it indicates a real
              // hardware limitation worth knowing about.
              console.warn('[viewport] PMREM bake failed, no IBL:', e)
            } finally {
              pmrem.dispose()
            }
          }
          needsRenderRef.current = true
        }
      })()
      // Immediate placeholder — grey-blue sky-ish color while the cubemap
      // resolves; avoids a flash of the previous preset's background.
      if (scene.background instanceof Color) {
        // leave existing color until cubemap arrives
      } else {
        scene.background = new Color(0x6a7d95)
      }
    }

    needsRenderRef.current = true
    return () => {
      cancelled = true
    }
  }, [preset, root, season, _envName, fog])

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
    setLoading(true)
    setErr(null)

    const run = async () => {
      try {
        const archives = await locateArchives(root)
        if (!archives) throw new Error('Archives folder not found.')
        // Search across every Art*.sga that ships with CoH2. Vehicle meshes
        // are usually in ArtHigh.sga but the diffuse RGTs live in faction-
        // specific archives (Tiger/Brummbär diffuse → ArtGermanEF.sga,
        // Sherman → ArtAEFSkins.sga, etc). Trying ArtHigh-only meant most
        // textures never loaded.
        const sgaCandidates = [
          'ArtHigh.sga',
          'ArtHighXP1.sga',
          'ArtHighXP2.sga',
          'ArtArmies.sga',
          'ArtGermanEF.sga',
          'ArtSovietEF.sga',
          'ArtAEF.sga',
          'ArtAEFSkins.sga',
          'ArtBritish.sga',
          'ArtWestGerman.sga',
        ]
        let sga: SgaArchive | null = null
        let rgmBytes: Uint8Array | null = null
        for (const sgaName of sgaCandidates) {
          try {
            const fh = await archives.getFileHandle(sgaName)
            const file = await fh.getFile()
            const a = await SgaArchive.open(file)
            const b = await a.readByPath(rgmPath(vehicle))
            if (b) {
              sga = a
              rgmBytes = b
              break
            }
          } catch (e) {
            console.log('[viewport] err on', sgaName, ':', String(e))
          }
        }
        if (!sga || !rgmBytes) {
          throw new Error(`Couldn't find ${rgmPath(vehicle)} in any of the loaded archives.`)
        }
        const model = parseRgm(rgmBytes)
        if (cancelled) return

        let diffuse: Texture | null = null
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
        // Always include vehicle.id itself first — many SGAs file textures
        // under the canonical id (e.g. king_tiger_sdkfz_182_dif.rgt) and
        // the alias list is just *additional* historical names. Pre-fix
        // behaviour ignored vehicle.id when an alias entry existed, which
        // silently broke winter-skin lookup for any aliased vehicle.
        const bases = [vehicle.id, ...(aliases[vehicle.id] ?? [])].filter(
          (v, i, a) => a.indexOf(v) === i,
        )
        // Try both vehicle.id and each alias as the folder name — CoH2's SGA
        // layout isn't consistent (puma_sdkfz_234/puma_dif vs puma/puma_dif).
        const dirCandidates = [vehicle.id, ...bases].map(
          d => `art/armies/${vehicle.faction}/vehicles/${d}/`,
        )
        const tsetPaths = candidates.map(c => c.replace(/\\/g, '/').toLowerCase() + '.rgt')
        const fallbackPaths = dirCandidates.flatMap(dirPath =>
          bases.flatMap(b => [
            `${dirPath}${b}_dif.rgt`,
            `${dirPath}${b}_hull_dif.rgt`,
            `${dirPath}${b}_default_dif.rgt`,
          ]),
        )

        // Winter variants — CoH2 ships them under skin-folder subdirs whose
        // name contains `winter`, e.g.
        //   art/armies/german/vehicles/tiger/skins/german_0001_winter/tiger_dif.rgt
        //   art/armies/west_german/vehicles/jagdpanzer_iv_.../skins/winter/<id>_dif.rgt
        //   art/armies/west_german/vehicles/.../skins/okw_0001_winter/<id>_dif.rgt
        // The previous toWinter() that just inserted `_winter` before `_dif`
        // produced paths that NEVER exist in any retail SGA — every winter
        // attempt fell through to the summer texture. We now scan the SGA's
        // full TOC for any `*winter*` skin folder matching one of our base
        // names; canonical `skins/winter/` wins, otherwise the lowest-id
        // numbered variant. This is asynchronous because we may need to open
        // multiple SGAs to find the texture's home archive — done lazily
        // below the main path-array assembly.
        const findWinterPathsInSga = (a: SgaArchive): string[] => {
          const all = a.list().map(f => f.path.toLowerCase())
          const factionRe = new RegExp(`^art/armies/${vehicle.faction.toLowerCase()}/vehicles/`)
          const hits: string[] = []
          for (const base of bases) {
            const baseLow = base.toLowerCase()
            const skinRe = new RegExp(
              `^art/armies/${vehicle.faction.toLowerCase()}/vehicles/[^/]+/skins/([^/]*winter[^/]*)/${baseLow}_dif\\.rgt$`,
            )
            const candidates = all.filter(p => factionRe.test(p) && skinRe.test(p))
            // Prefer canonical `skins/winter/` over numbered variants — feels
            // most "stock" and avoids picking an unusual unit camo.
            candidates.sort((p1, p2) => {
              const f1 = p1.match(skinRe)![1]
              const f2 = p2.match(skinRe)![1]
              if (f1 === 'winter' && f2 !== 'winter') return -1
              if (f2 === 'winter' && f1 !== 'winter') return 1
              return f1.localeCompare(f2)
            })
            hits.push(...candidates)
          }
          return hits
        }

        // Summer-path attempt list (always tried, regardless of season). The
        // winter-path attempt is interleaved on the season=winter branch, but
        // computed per-archive (since each SGA holds its own TOC).
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
          } catch {
            return null
          }
        }

        // Body-diffuse resolution. Strategy:
        //   1. Per archive: if season=winter, scan its TOC for matching
        //      `skins/*winter*/<base>_dif.rgt` and try those first.
        //   2. Fall through to deterministic summer paths (`tsetPaths` +
        //      `fallbackPaths`).
        // Doing winter per-archive lets us pick the *winter variant that
        // exists in this SGA* rather than guessing a path. Doing summer
        // last means winter-less vehicles still get a textured render.
        const findFirstReadable = async (
          a: SgaArchive,
          paths: string[],
        ): Promise<{ bytes: Uint8Array; path: string } | null> => {
          for (const p of paths) {
            const b = await a.readByPath(p)
            if (b) return { bytes: b, path: p }
          }
          return null
        }
        let rgtBytes: Uint8Array | null = null
        const archivesToTry: { name: string; archive: SgaArchive }[] = [
          { name: 'rgm SGA', archive: sga },
        ]
        for (const sgaName of sgaCandidates) {
          const a = await getArchive(sgaName)
          if (a && a !== sga) archivesToTry.push({ name: sgaName, archive: a })
        }
        // Search strategy — order matters because some archives (notably
        // ArtArmies.sga) contain shared *tread* textures whose names also
        // end in `_dif.rgt` and live under `art/armies/shared_textures/`.
        // If we iterate "winter then summer per-archive" we can land on
        // a tread texture in an early archive when the body diffuse is
        // hosted in a later one — wrapping the entire tank in repeating
        // tread caterpillar pattern. Instead: scan every archive for the
        // winter body first, then every archive for the summer body. The
        // body-only `allPaths` list is also filtered to exclude obviously
        // track/wheel paths to make the fallback robust against shared
        // texture pools.
        const isBodyPath = (p: string) =>
          !/\/(treads?|wheels?|tracks?)\//i.test(p) &&
          // `\b` is the wrong boundary here — `_` is a JS regex word char,
          // so `\btread_` never fires when the token is preceded by `_`
          // (e.g. `is2m_heavy_tank_treads_dif.rgt`). That caused IS-2 /
          // ISU-152's plural `_treads_dif` texture to slip into bodyPaths
          // and bind to the hull material — wrapping the tank in track
          // tread pattern (or its inverse: tracks ended up with no
          // texture and fell back to gunmetal). `(?:^|_)` is the explicit
          // start-or-underscore boundary that actually matches. Also
          // accept the plural `treads?|wheels?|tracks?` since CoH2's
          // texture naming is inconsistent across factions.
          !/(?:^|_)(treads?|wheels?|tracks?)_[a-z0-9_]*_dif\.rgt$/i.test(p)
        const bodyPaths = allPaths.filter(isBodyPath)
        if (season === 'winter') {
          outerWinter: for (const { archive: a } of archivesToTry) {
            const winter = findWinterPathsInSga(a)
            const hit = await findFirstReadable(a, winter)
            if (hit) {
              rgtBytes = hit.bytes
              break outerWinter
            }
          }
        }
        if (!rgtBytes) {
          outerSummer: for (const { archive: a } of archivesToTry) {
            const hit = await findFirstReadable(a, bodyPaths)
            if (hit) {
              rgtBytes = hit.bytes
              break outerSummer
            }
          }
        }
        if (!rgtBytes) {
          console.warn(
            '[viewport] no diffuse found; tried',
            allPaths.length,
            'summer paths across',
            sgaCandidates.length,
            'SGAs',
          )
        }
        if (rgtBytes) {
          try {
            const rgt = decodeRgt(rgtBytes)
            diffuseImage = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
            diffuse = new CanvasTexture(diffuseImage)
            // UVs are stored as (u, 1 - v_orig) per rgm.ts:412; flipY=true is required
            // so image rows sample in the correct orientation. flipY=false V-mirrors the texture.
            diffuse.flipY = true
            diffuse.colorSpace = SRGBColorSpace
            diffuse.wrapS = diffuse.wrapT = RepeatWrapping
            diffuse.anisotropy = MAX_ANISO
          } catch (e) {
            console.warn(
              `[viewport] diffuse decode failed:`,
              e instanceof Error ? e.message : String(e),
            )
            try {
              diffuse = rgtToCompressedTexture(decodeRgt(rgtBytes))
            } catch (e2) {
              console.warn(
                `[viewport] CompressedTexture fallback also failed:`,
                e2 instanceof Error ? e2.message : String(e2),
              )
            }
          }
        }
        if (cancelled) return

        // ── Normal map ─────────────────────────────────────────────────
        // Same fallback strategy as the diffuse — try every candidate
        // path across every cached SGA. Normal maps are stored in linear
        // space (NOT sRGB), and we set normalScale below.
        let normalTex: Texture | null = null
        const nrmFallbackPaths = dirCandidates.flatMap(dirPath =>
          bases.flatMap(b => [
            `${dirPath}${b}_nrm.rgt`,
            `${dirPath}${b}_hull_nrm.rgt`,
            `${dirPath}${b}_norm.rgt`,
            `${dirPath}${b}_n.rgt`,
            `${dirPath}${b}_default_nrm.rgt`,
          ]),
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
              if (b) {
                bytes = b
                break
              }
            }
          }
          if (bytes) {
            try {
              const rgt = decodeRgt(bytes)
              const cv = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
              normalTex = new CanvasTexture(cv)
              // Must match the diffuse: UVs are stored as (u, 1 - v_orig) per rgm.ts:412,
              // so flipY=true is the documented invariant. A mismatch with the diffuse
              // produces the cookie-cutter pure-black void bug.
              normalTex.flipY = true
              normalTex.colorSpace = NoColorSpace
              normalTex.wrapS = normalTex.wrapT = RepeatWrapping
              normalTex.anisotropy = MAX_ANISO
              break outerNrm
            } catch (e) {
              console.warn(
                `[viewport] normal decode failed for ${tryPath}:`,
                e instanceof Error ? e.message : String(e),
              )
            }
          }
        }
        if (cancelled) return

        const scene = sceneRef.current!
        const oldGroup = meshGroupRef.current
        if (oldGroup) {
          scene.remove(oldGroup)
          oldGroup.traverse(o => {
            if ((o as Mesh).geometry) (o as Mesh).geometry.dispose()
          })
        }
        if (baseTextureRef.current) baseTextureRef.current.dispose()
        baseTextureRef.current = diffuse

        // Sync the slab to the current season alongside the diffuse load
        // — the standalone season → ground useEffect was removed in favour
        // of an atomic swap. slabSeasonSwapRef handles both regimes:
        //   • real winter texture available → pointer-swap to snow canvas
        //   • procedural slab fallback → legacy colour-tint
        // Without this the ground would render its summer texture on
        // first paint regardless of the user's season selection.
        slabSeasonSwapRef.current?.(season)

        const group = new Group()
        const submeshMap = new Map<string, Mesh>()
        const origPos = new Map<string, Vector3>()

        // Dedupe first: some RGMs (Panther) list the same submesh entry
        // twice (same name, same material, same vertex count). Rendering
        // both causes track + hull z-fighting that flickers as the camera
        // moves. Keep the first occurrence of each (name, material) pair.
        // Then run a geometric dedup pass to catch LOD0/LOD1 cousins that
        // survived because their names or material slots differ slightly
        // (Jagdtiger 4 exhausts, Stormtiger track z-fight, Panther extras).
        const uniqueMeshes = dedupeByGeometry(dedupeSubmeshes(model.meshes))

        // Partition: intact vs destroyed. Many CoH2 .rgm files contain both
        // variants in the same file, overlapping in world space — rendering
        // both at once causes z-fighting (the "tiger clipping into destroyed
        // tiger" bug). We always render only one set; the showDestroyed prop
        // selects which. Match by submesh name AND material name so a tread
        // submesh whose container has "wreck" in its name (e.g.
        // `merged material-[brummbar_wreck,Brummbar_Tread_Left]`) is
        // correctly classified as wreck even though the leaf material is
        // `Brummbar_Tread_Left`.
        const intact: typeof model.meshes = []
        const destroyed: typeof model.meshes = []
        for (const sub of uniqueMeshes) {
          const matchTarget = `${sub.name} ${sub.materialName ?? ''}`
          if (isDestroyedMesh(matchTarget)) destroyed.push(sub)
          else intact.push(sub)
        }
        // Fallback: if showDestroyed is requested but no destroyed parts
        // were tagged, fall back to intact so we don't render an empty scene.
        const visible =
          showDestroyed && destroyed.length > 0
            ? destroyed
            : intact.length > 0
              ? intact
              : model.meshes

        // If the parser produced zero usable submeshes, the file uses a
        // format variant we don't decode yet (TRIM v5 packed stride — Tiger,
        // Churchill, M5 Stuart). Surface this clearly instead of an empty
        // viewport so the user knows what's wrong.
        if (visible.length === 0) {
          throw new Error(
            `${vehicle.displayName} uses a CoH2 mesh format the editor doesn't decode yet ` +
              `(TRIM v5 packed-stride). The skin export pipeline still works for this vehicle — ` +
              `pick another model from the nav for now.`,
          )
        }

        // ── Per-submesh texture binding ────────────────────────────────
        // Each submesh's MaterialName resolves to an MTRL chunk whose params
        // list the textures THAT submesh expects. The body atlas is the
        // common case; tracks reference a separate `*_track_dif.rgt` (a
        // small tiling tread tile) and skirts/wheels can reference yet
        // another atlas. Without this, every submesh got the body atlas →
        // tracks rendered the entire hull texture stretched across them.
        // The cache holds per-material PBR textures. Spec/gloss are added so
        // MeshPhysicalMaterial below can drive per-pixel highlights matching
        // CoH2's coh2_vehicle shader recipe (diffuse + normal + spec + gloss).
        const texCache = new Map<
          string,
          {
            diffuse: Texture | null
            normal: Texture | null
            specular: Texture | null
            roughness: Texture | null
          }
        >()
        // Pre-seed the cache with the body diffuse + normal we already loaded.
        // Spec/gloss aren't loaded up here — getTexturesForMaterial does that
        // on demand when the body submesh asks for its full PBR set.
        if (diffuse) {
          texCache.set('__body__', { diffuse, normal: normalTex, specular: null, roughness: null })
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
        // role determines colorSpace + whether to invert RGB at decode time.
        //   'diffuse' → sRGB albedo
        //   'normal'  → linear (no color space transform)
        //   'spec'    → linear specular intensity (R channel used)
        //   'gloss'   → linear, INVERTED to become Three.js roughness map
        //               (CoH2 gloss: high=smooth; Three.js roughness: high=rough)
        type TextureRole = 'diffuse' | 'normal' | 'spec' | 'gloss'
        const decodeTextureBytes = (bytes: Uint8Array, role: TextureRole): Texture | null => {
          try {
            const rgt = decodeRgt(bytes)
            const cv = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
            if (role === 'gloss') {
              // Invert RGB so the resulting texture works directly as
              // `roughnessMap` in Three.js (which reads the G channel).
              // CoH2 stores gloss as "1.0 = polished mirror, 0.0 = matte
              // fabric"; Three.js expects roughness as "0.0 = mirror,
              // 1.0 = matte" — i.e. the complement.
              const ctx = cv.getContext('2d')!
              const img = ctx.getImageData(0, 0, rgt.width, rgt.height)
              const d = img.data
              for (let i = 0; i < d.length; i += 4) {
                d[i] = 255 - d[i] // R
                d[i + 1] = 255 - d[i + 1] // G (the channel Three.js samples)
                d[i + 2] = 255 - d[i + 2] // B
                // alpha left intact
              }
              ctx.putImageData(img, 0, 0)
            }
            const t = new CanvasTexture(cv)
            // Must match the main body diffuse (line 541) and overlay texture
            // (line 919): flipY=true. UVs are stored with `v = 1 - v_orig` per
            // rgm.ts:412, and the canvas/PNG image data is top-down; flipY=true
            // is what makes those two conventions sample correctly together.
            // Earlier this was set to `false` as a debugging probe — that
            // produced a V-mirrored body texture (engine fan reading hull-front
            // texels), which manifested as "not unwrapped properly".
            t.flipY = true
            t.colorSpace = role === 'diffuse' ? SRGBColorSpace : NoColorSpace
            t.wrapS = t.wrapT = RepeatWrapping
            t.anisotropy = MAX_ANISO
            return t
          } catch (e) {
            console.warn(
              `[viewport] submesh texture decode failed (${role}):`,
              e instanceof Error ? e.message : String(e),
            )
            return null
          }
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
          // `wreak` is Relic's in-file typo on several wreck materials
          // (m5a1_stuart_wreak, jagdtiger_wreak, …). Treat it as wreck
          // so the texture lookup routes to *_wreck_dif and the mesh
          // gets filtered as destroyed downstream.
          if (/wreck|wreak/.test(mat)) return 'wreck'
          // Tread, track, AND wheel share the tread lookup path. Without
          // this, wheel submeshes fell through to the body branch which
          // resolved their diffuse from whichever `*_dif` TSET entry the
          // first-match scan landed on — for the King Tiger that was a
          // wheel-specific atlas whose albedo was authored as a near-flat
          // normal-map blue (~rgb(60,90,220)), so every road wheel showed
          // saturated cobalt concentric circles in the editor. Routing
          // wheel materials through the tread branch makes the lookup
          // prefer tread/wheel `_dif` entries and fall back cleanly to
          // the gunmetal default when none exists.
          //
          // BOUNDARY REQUIREMENT: the original `/tread|track|wheel/` was a
          // raw substring match which falsely classified halftrack body
          // materials (`m3_halftrack`, `m15a1_aa_halftrack`) as treads —
          // 'track' is literally a substring of 'halftrack'. The 12k-vert
          // chassis then bound to the tiny tile-able `..._tread_dif`
          // texture and tiled the tread pattern across the whole hull,
          // giving the "M3 Halftrack way too dark / textures not binding"
          // symptom. Require a non-letter boundary on both sides so
          // `halftrack` no longer matches `track`, but `track_left`,
          // `Tread_R`, `wheel_01`, and the plural `tracks`/`wheels`/`treads`
          // still do.
          if (/(?:^|[^a-z])(?:tread|track|wheel)s?(?![a-z])/i.test(mat)) return 'tread'
          // Body / default — let the matcher pick the plain `*_dif` not
          // qualified by `_tread_` / `_wreck_`.
          return ''
        }
        interface MaterialTextures {
          diffuse: Texture | null
          normal: Texture | null
          // Specular intensity (CoH2 `_spc`). Bound as `specularIntensityMap`
          // on MeshPhysicalMaterial → modulates how strongly each pixel
          // reflects light. Without this, painted-steel hulls look matte.
          specular: Texture | null
          // Inverted-gloss (CoH2 `_gls` with RGB inverted). Bound as
          // `roughnessMap` → bright pixels in CoH2 gloss become low-roughness
          // (smooth/shiny) in Three.js. This is the main reason the hull
          // looked "darker than it should be" before — we had a flat
          // roughness=0.85 with no gloss-driven highlights.
          roughness: Texture | null
        }
        const getTexturesForMaterial = async (
          materialName: string | null,
        ): Promise<MaterialTextures> => {
          const cacheKey = materialName ?? '__body__'
          if (texCache.has(cacheKey)) return texCache.get(cacheKey)! as MaterialTextures
          const token = materialName ? tokenFor(materialName) : ''
          let difPath: string | null
          let nrmPath: string | null
          let spcPath: string | null
          let glsPath: string | null
          // Build a token regex that matches the token as a leading,
          // middle, or trailing path segment — i.e. all of
          //   `tread_dif`, `panther_tread_dif`, `tread_left_dif`,
          //   `is2m_heavy_tank_treads_dif`, `t34_76_treads_dif`.
          // The original `_${token}_` form ONLY matched the middle case,
          // which lost any RGT whose basename leads with the token (very
          // common in CoH2 — e.g. `tread_left_dif`). Symptom: track texture
          // not rendering on Panther / Pz IV / Jagdpanzer / Luchs; the
          // material fell through to the dark-gunmetal fallback colour.
          //
          // The trailing `s?` handles the PLURAL form: many Soviet RGTs
          // (IS-2, ISU-152, T-34/76, T-34/85) name the track texture
          // `..._treads_dif` (plural) rather than `..._tread_dif`. Without
          // accepting the plural, IS-2 / ISU-152 tracks fell through to
          // the body atlas (because `isBodyPath` also missed the plural
          // form), wrapping the hull and tracks in the same diffuse.
          //
          // WRECK TENSE: many Soviet wreck textureSets are named
          // `_wrecked_*_dif` (past tense) rather than `_wreck_*_dif`.
          // T-34/76's `T34_76_Wrecked`, M3A1 Scout's `..._Wrecked`, and
          // SU-76M's `..._wrecked` all bound to `<NONE>` under the
          // singular-only regex, leaving destroyed variants with no
          // diffuse. Accept `wreck` / `wrecks` / `wrecked` for the
          // wreck token; other tokens stay singular+plural only.
          const tokenRe = (t: string) => {
            const suffix = t === 'wreck' ? '(?:s|ed)?' : 's?'
            return new RegExp(`(?:^|/|_)${t}${suffix}(?:_|/)`, 'i')
          }
          const isVariantPath = (p: string) =>
            tokenRe('wreck').test(p) ||
            tokenRe('tread').test(p) ||
            tokenRe('track').test(p) ||
            /\/badges\//i.test(p)
          if (token) {
            const re = tokenRe(token)
            difPath = findTset(p => re.test(p) && /_dif$/.test(p))
            nrmPath = findTset(p => re.test(p) && /_nrm$|_norm$/.test(p))
            spcPath = findTset(p => re.test(p) && /_spc$/.test(p))
            glsPath = findTset(p => re.test(p) && /_gls$/.test(p))
          } else {
            // Body: pick textures NOT qualified by wreck/tread/badges, preferring
            // ones whose basename matches the vehicle id. We use the same
            // segment-aware matcher so a leading-token path like
            // `tread_left_dif` is correctly rejected (the original substring
            // check `_tread_` missed it, occasionally letting a track texture
            // bind to the body material).
            const notVariant = (p: string) => !isVariantPath(p)
            const isBody = (p: string) => /_dif$/.test(p) && notVariant(p)
            const isBodyNrm = (p: string) => /_nrm$|_norm$/.test(p) && notVariant(p)
            const isBodySpc = (p: string) => /_spc$/.test(p) && notVariant(p)
            const isBodyGls = (p: string) => /_gls$/.test(p) && notVariant(p)
            const id = vehicle.id.toLowerCase()
            difPath = findTset(p => isBody(p) && p.includes(id)) ?? findTset(isBody)
            nrmPath = findTset(p => isBodyNrm(p) && p.includes(id)) ?? findTset(isBodyNrm)
            spcPath = findTset(p => isBodySpc(p) && p.includes(id)) ?? findTset(isBodySpc)
            glsPath = findTset(p => isBodyGls(p) && p.includes(id)) ?? findTset(isBodyGls)
          }
          let dTex: Texture | null = null
          let nTex: Texture | null = null
          let sTex: Texture | null = null
          let gTex: Texture | null = null
          // Per-decode yield: `await resolveRgtPath` yields the microtask
          // queue but not always a paint slot (cached resolves resolve
          // synchronously). After each heavy DXT decode + canvas
          // upload, hand a frame back to the browser so the loading-
          // border SVG animation gets a chance to repaint. Without
          // this, 4 back-to-back decodes per material × N materials
          // can stall the main thread for hundreds of ms.
          const decodeYield = () => new Promise<void>(r => requestAnimationFrame(() => r()))
          if (difPath) {
            const b = await resolveRgtPath(difPath)
            if (b) dTex = decodeTextureBytes(b, 'diffuse')
            await decodeYield()
          }
          if (nrmPath) {
            const b = await resolveRgtPath(nrmPath)
            if (b) nTex = decodeTextureBytes(b, 'normal')
            await decodeYield()
          }
          if (spcPath) {
            const b = await resolveRgtPath(spcPath)
            if (b) sTex = decodeTextureBytes(b, 'spec')
            await decodeYield()
          }
          if (glsPath) {
            const b = await resolveRgtPath(glsPath)
            if (b) gTex = decodeTextureBytes(b, 'gloss')
            await decodeYield()
          }
          // Fall back to body atlas channels if this material didn't resolve
          // its own — better than rendering pure black or matte plastic.
          //
          // BUT: only for the body itself. Tread / wreck materials have UVs
          // tuned for a small tileable texture (often repeating 30–50× across
          // the mesh), so binding the body atlas to those UVs tiles the entire
          // hull-paint atlas across the tracks → "repeated whole-texture-pack"
          // bug. For non-body materials, leave diffuse null when no token-
          // specific texture was found and let the material's flat fallback
          // colour render instead. We still let normal / spec / gloss inherit
          // the body's maps as a benign visual upgrade.
          const bodyCache = texCache.get('__body__') as MaterialTextures | undefined
          const isNonBody = token !== ''
          const result: MaterialTextures = {
            diffuse: dTex ?? (isNonBody ? null : (bodyCache?.diffuse ?? null)),
            normal: nTex ?? bodyCache?.normal ?? null,
            specular: sTex ?? bodyCache?.specular ?? null,
            roughness: gTex ?? bodyCache?.roughness ?? null,
          }
          texCache.set(cacheKey, result)
          return result
        }

        const isBodyMaterial = (mn: string | null): boolean => {
          if (!mn) return true // null materialName → assume body
          return tokenFor(mn) === ''
        }
        // Yield to the browser between heavy operations so the loading-
        // border's `stroke-dashoffset` animation (running on the main
        // thread) gets a frame slot to repaint. Each submesh iteration
        // can chain a synchronous DXT5 decode + CanvasTexture upload that
        // blocks for 20–60ms — without an interleaved rAF yield, those
        // back-to-back blocks starve the SVG paint pipeline and the beam
        // visibly stutters / freezes mid-march. The `will-change:
        // stroke-dashoffset` hint on the LoadingBorder paths is a hint
        // only; under sustained main-thread load Chromium still drops
        // the animation. rAF guarantees a paint opportunity.
        const yieldToBrowser = () => new Promise<void>(r => requestAnimationFrame(() => r()))
        for (const sub of visible) {
          // One yield per submesh keeps the loading beam smooth on
          // 20+ submesh vehicles (Panther, King Tiger). For cached
          // materials (most after the first few) this is the only
          // pause in the loop body, but it's enough — even cheap work
          // accumulated across 30 iterations was choking the SVG anim.
          await yieldToBrowser()
          if (cancelled) return
          const tex = await getTexturesForMaterial(sub.materialName)
          if (cancelled) return
          const subDiffuse = tex.diffuse
          const subNormal = tex.normal
          const subSpec = tex.specular
          const subRoughness = tex.roughness
          // Fallback flat colour when no diffuse texture was bound. Picked
          // per material token so tracks don't render the same khaki as
          // the body — dark gunmetal looks like a track, khaki looks like
          // a hull-coloured smear.
          const subToken = sub.materialName ? tokenFor(sub.materialName) : ''
          const fallbackColor =
            subToken === 'tread' ? 0x2a2c2e : subToken === 'wreck' ? 0x3a342c : 0x9aa18b
          // MeshPhysicalMaterial (rather than MeshStandardMaterial) so we can
          // wire up `specularIntensityMap` — CoH2's `_spc` texture maps cleanly
          // onto Three.js's PBR specular workflow. Without per-pixel specular,
          // painted-steel hulls look as matte as cloth and the diffuse's dim
          // base RGB never gets brightened by reflected light.
          //
          // Recipe (closest practical analogue of `coh2_vehicle` shader):
          //   • map               = diffuse atlas      (sRGB albedo)
          //   • normalMap         = normal atlas       (DX→GL via normalScale.y=-1)
          //   • roughnessMap      = inverted gloss     (CoH2 high-gloss → low rough)
          //   • specularIntensityMap = spec atlas      (where light reflects)
          //   • metalness         = 0                  (vehicles are dielectric)
          //   • roughness         = 1                  (let the map drive it; if no
          //                                             map, this is fully matte)
          //   • specularIntensity = 1                  (let the map drive it; if no
          //                                             map, this is full specular)
          const mat = new MeshPhysicalMaterial({
            map: subDiffuse,
            normalMap: subNormal,
            roughnessMap: subRoughness,
            specularIntensityMap: subSpec,
            color: subDiffuse ? 0xffffff : fallbackColor,
            metalness: 0,
            // If we have a roughness map we want it to fully drive roughness;
            // if not, fall back to a moderate roughness (0.55) so painted
            // surfaces still get some highlights instead of looking like felt.
            roughness: subRoughness ? 1.0 : 0.55,
            specularIntensity: subSpec ? 1.0 : 0.5,
            // Per-material env contribution. CoH2 uses a spec/gloss
            // material model (NOT modern metalness/roughness PBR) —
            // texture burn confirms _spc map drives a Blinn-Phong-ish
            // specular response, not a Cook-Torrance energy-conserving
            // BRDF. Spec/gloss materials get a far subtler IBL pickup
            // than full PBR materials, so we cap vehicles at 0.15
            // (was 0.2). Combines multiplicatively with the scene-
            // level environmentIntensity (now 0.3), giving an effective
            // vehicle env contribution of 0.15 × 0.3 ≈ 0.045 — enough
            // to keep deep-shade panels legible without the cubemap's
            // hue bleeding onto painted steel. Foliage / terrain /
            // wreck props inherit the full 0.3 scene knob.
            envMapIntensity: 0.15,
            // CoH2 RGM submeshes have inconsistent winding — some panels
            // (Puma turret, Panther skirts) end up with their normals
            // facing inwards, rendering as solid black. DoubleSide makes
            // both faces lit, masking the broken winding.
            side: DoubleSide,
          })
          // Y is negated to convert DX-convention normal maps (Y points down,
          // CoH2/Essence engine ships these) to Three.js / OpenGL convention
          // (Y points up). Without this, lighting on horizontal panels is
          // reversed — raised features look sunken and certain surfaces face
          // away from the key light, going near-black.
          if (subNormal)
            mat.normalScale = new Vector2(1.0, -1.0)
            // Mark whether this submesh uses the BODY diffuse — only those
            // get the editable overlay rebound onto them. Tracks/wheels/wrecks
            // keep their own (non-editable) tile/wreck textures.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom property on Three.js MeshStandardMaterial to track body-diffuse binding
          ;(mat as any).__usesBodyDiffuse = isBodyMaterial(sub.materialName)
          const m = new Mesh(sub.geometry, mat)
          m.name = sub.name
          // Vehicle submeshes both cast AND receive shadows.  Cast → the
          // chassis throws the deep contact shadow onto the ground that
          // the in-game render shows under every vehicle.  Receive →
          // self-shadowing (e.g. the turret shadowing the hull, the
          // gun-mantlet shadowing the front plate) which is the second
          // visual cue separating "real CoH2" from "scale-model lit
          // from above".  Cost is one extra shadow pass for the
          // in_game_field preset only — Studio/Showcase rigs don't have
          // a shadow caster so these flags are no-ops there.
          m.castShadow = true
          m.receiveShadow = true
          group.add(m)
          submeshMap.set(sub.name, m)
          origPos.set(sub.name, new Vector3(0, 0, 0))
        }

        // Auto-fit: scale model so longest axis = ~5 units, centre it
        // horizontally, and rest its tracks ON the ground (bbox.min.y = 0).
        const box = new Box3().setFromObject(group)
        const size = box.getSize(new Vector3())
        const longest = Math.max(size.x, size.y, size.z)
        const scale = longest > 0.0001 ? 5 / longest : 0.01
        group.scale.setScalar(scale)
        // Record the apparent size so the crew-loading effect can size
        // the soldier RGM proportionally (a soldier loaded at native
        // CoH2 scale would otherwise dwarf an auto-scaled vehicle).
        vehicleScaleRef.current = scale
        vehicleApparentLengthRef.current = longest * scale

        // ── Find the exact centre of the vehicle ────────────────────────
        // Bbox-of-body is skewed by long gun barrels; bbox-of-everything
        // is skewed by gun + antenna + turret bustles. The robust answer
        // is a triangle-area-weighted centroid of the body geometry —
        // that's the actual "centre of mass" of the painted hull, and it
        // lands squarely in the chassis regardless of how far the barrel
        // pokes. We compute it in group-local space, then apply the
        // group's uniform scale so the result is in world units.
        //
        // Body meshes are those whose material uses the body diffuse
        // (everything else is treads / wreck / proxy). A vehicle's body is
        // often split across multiple submeshes (hull + turret + skirts +
        // hatch) — aggregating the area-weighted centroid across ALL of
        // them gives a stable hull centroid. Using only the first body
        // mesh (e.g. a hatch) drifts the centroid into the hatch position,
        // causing the off-centre framing seen on some vehicles.
        const bodyMeshes = group.children.filter(
          c =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- checking custom __usesBodyDiffuse property set on Three.js materials above
            (c as any).material && (c as any).material.__usesBodyDiffuse,
        ) as Mesh[]
        const bodyMesh: Mesh | undefined = bodyMeshes[0]

        const centroidLocal = new Vector3()
        if (bodyMeshes.length > 0) {
          // Triangle-area-weighted centroid: each triangle contributes
          // its centroid scaled by its area, and the running totals are
          // normalised at the end across every body submesh. Pure vertex
          // average over-weights dense regions (tessellated lugs /
          // hatches) and under-weights sparse flat panels.
          const sum = new Vector3()
          let totalArea = 0
          const a = new Vector3(),
            b = new Vector3(),
            c = new Vector3()
          const ab = new Vector3(),
            ac = new Vector3(),
            cross = new Vector3()
          for (const m of bodyMeshes) {
            const geom = m.geometry
            const pos = geom.attributes.position as BufferAttribute | undefined
            const idx = geom.index
            if (!pos || !idx) continue
            const idxArr = idx.array as Uint16Array | Uint32Array
            const posArr = pos.array as Float32Array
            for (let i = 0; i < idxArr.length; i += 3) {
              const ia = idxArr[i] * 3,
                ib = idxArr[i + 1] * 3,
                ic = idxArr[i + 2] * 3
              a.set(posArr[ia], posArr[ia + 1], posArr[ia + 2])
              b.set(posArr[ib], posArr[ib + 1], posArr[ib + 2])
              c.set(posArr[ic], posArr[ic + 1], posArr[ic + 2])
              ab.subVectors(b, a)
              ac.subVectors(c, a)
              cross.crossVectors(ab, ac)
              const area = cross.length() * 0.5
              if (area <= 0) continue
              const cx = (a.x + b.x + c.x) / 3
              const cy = (a.y + b.y + c.y) / 3
              const cz = (a.z + b.z + c.z) / 3
              sum.x += cx * area
              sum.y += cy * area
              sum.z += cz * area
              totalArea += area
            }
          }
          if (totalArea > 0) centroidLocal.copy(sum).divideScalar(totalArea)
        }
        // Apply scale (group's uniform scale) to take centroid into the
        // post-scale, pre-position world-space frame.
        const centroidWorld = centroidLocal.clone().multiplyScalar(scale)

        // Recompute full bbox AFTER scaling so we know where the bottom
        // is (we want the lowest mesh — typically a track or skirt — to
        // rest on y=0, not the body's centroid).
        const scaledBox = new Box3().setFromObject(group)
        const scaledCenter = scaledBox.getCenter(new Vector3())

        // Centre X/Z on the body centroid (or on the bbox centre if no
        // body mesh was found), then push the lowest point of the
        // entire group down to y=0.
        const centerX = bodyMesh && centroidLocal.lengthSq() > 0 ? centroidWorld.x : scaledCenter.x
        const centerZ = bodyMesh && centroidLocal.lengthSq() > 0 ? centroidWorld.z : scaledCenter.z
        group.position.x = -centerX
        group.position.z = -centerZ
        group.position.y = -scaledBox.min.y
        scene.add(group)

        // Recentre orbit camera target on the model's actual centre so the
        // user orbits around the tank, not a hardcoded point in space.
        const finalBox = new Box3().setFromObject(group)
        const finalSize = finalBox.getSize(new Vector3())
        // Target the body's centroid (which now sits at world X/Z = 0
        // after the centring step above). Y uses the body centroid too,
        // promoted into world space (centroid in scaled-group coords +
        // group.position.y). If no body centroid was found, fall back to
        // the bbox midpoint.
        const finalCenter =
          bodyMesh && centroidLocal.lengthSq() > 0
            ? new Vector3(0, centroidWorld.y + group.position.y, 0)
            : finalBox.getCenter(new Vector3())
        // Re-frame the camera tightly on the freshly-loaded vehicle.
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
          // hull bottom. Z is NEGATIVE — CoH2 RGM vehicles load with their
          // front along -Z in world space, so a (+x, +y, +z) camera looks
          // at the back-right corner of the tank. Flipping Z to -1 puts
          // the camera on the front-right corner, which is the angle that
          // shows the most decal-relevant geometry (turret face, glacis,
          // mantlet, hull side) at once.
          const dir = new Vector3(1, 0.45, -1).normalize()
          cameraRef.current.position.copy(finalCenter).addScaledVector(dir, dist)
          cameraRef.current.lookAt(finalCenter)
          cameraRef.current.updateProjectionMatrix()
        }
        meshGroupRef.current = group
        submeshMapsRef.current = submeshMap
        origPosRef.current = origPos
        targetPosRef.current = new Map(
          Array.from(origPos.entries()).map(([k, v]) => [k, v.clone()]),
        )
        explodeProgressRef.current = 1
        vehicleSizeRef.current = finalSize.clone()
        // Reset hover/isolate state on new model load
        hoveredPartRef.current = null
        isolateTargetRef.current = null
        savedControlsTargetRef.current = null

        onPartsLoaded?.(Array.from(submeshMap.keys()))
        onModelLoaded?.(model, diffuseImage)
        // Tell the crew-loading effect the chassis is ready so it can
        // attach a faction soldier at the right scale + position.  The
        // tick changes per load so `useEffect([showCrew, vehicleReadyTick])`
        // re-runs correctly even when the user toggles to the same vehicle.
        setVehicleReadyTick(t => t + 1)
        // Bump tick → triggers the overlay-binding useEffect to rebind the
        // (possibly-fresh) overlay texture to all materials in the new mesh
        // group. Without this rebind the model would stay on its raw diffuse
        // texture and decals wouldn't show.
        setModelTick(t => t + 1)
        setLoading(false)
        needsRenderRef.current = true

        // ── Season-reload helper ─────────────────────────────────────────
        // Captures the archive-search context (sga, sgaCandidates, archive
        // cache, tset/fallback paths, current model) so a Summer ↔ Winter
        // toggle can re-run the body-diffuse RGT search alone — without
        // tearing down the geometry, materials, normals, spec, gloss,
        // overlay, or skybox. The actual rebind is synchronous: we await
        // the bytes, decode the texture, then apply the new map and the
        // matching ground colour in one block so they commit atomically.
        seasonReloadRef.current = async (newSeason: 'summer' | 'winter') => {
          // Mirror the heavy effect's resolution order: winter (per-archive
          // TOC scan for skins/*winter*/<base>_dif.rgt) → summer fallback.
          let bytes: Uint8Array | null = null
          const archivesToTry: { name: string; archive: SgaArchive }[] = [
            { name: 'rgm SGA', archive: sga },
          ]
          for (const sgaName of sgaCandidates) {
            const a = await getArchive(sgaName)
            if (a && a !== sga) archivesToTry.push({ name: sgaName, archive: a })
          }
          // Same archive-search ordering as the heavy effect: winter across
          // all archives first, then summer body-only paths across all
          // archives. Mixing per-archive (winter then summer for archive #1,
          // then move on) lands on shared tread textures in early archives
          // whenever the body diffuse lives in a later one.
          if (newSeason === 'winter') {
            outerWinter: for (const { archive: a } of archivesToTry) {
              const winter = findWinterPathsInSga(a)
              for (const p of winter) {
                const b = await a.readByPath(p)
                if (b) {
                  bytes = b
                  break outerWinter
                }
              }
            }
          }
          if (!bytes) {
            outerSummer: for (const { archive: a } of archivesToTry) {
              for (const p of bodyPaths) {
                const b = await a.readByPath(p)
                if (b) {
                  bytes = b
                  break outerSummer
                }
              }
            }
          }
          if (!bytes) {
            console.warn(`[viewport] season=${newSeason}: no diffuse found, keeping previous`)
            // Still flip the ground so the toggle feels responsive: real
            // snow texture if available, legacy colour-tint otherwise.
            slabSeasonSwapRef.current?.(newSeason)
            return
          }
          let newDiffuse: Texture | null
          let newImage: HTMLCanvasElement | null
          try {
            const rgt = decodeRgt(bytes)
            newImage = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
            newDiffuse = new CanvasTexture(newImage)
            newDiffuse.flipY = true
            newDiffuse.colorSpace = SRGBColorSpace
            newDiffuse.wrapS = newDiffuse.wrapT = RepeatWrapping
            newDiffuse.anisotropy = MAX_ANISO
          } catch (e) {
            console.warn(`[viewport] season=${newSeason}: decode failed`, e)
            return
          }
          // ── Atomic swap ────────────────────────────────────────────────
          // From here on we run synchronously so the new texture, the new
          // base reference, and the matching ground colour all commit on
          // the same render frame. No awaits past this point.
          if (baseTextureRef.current) baseTextureRef.current.dispose()
          baseTextureRef.current = newDiffuse

          // When no overlay is active, the body materials' .map IS the base
          // diffuse — swap it directly. When an overlay is active, .map
          // points at the overlay CanvasTexture; the overlay-rebuild path
          // (driven by the parent re-running the layering pipeline below)
          // will pick up the fresh base via baseTextureRef.
          const groupNow = meshGroupRef.current
          if (groupNow && !overlayTexRef.current) {
            groupNow.traverse(o => {
              const mesh = o as Mesh
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading custom __usesBodyDiffuse property on Three.js material
              const mat = mesh.material as any
              if (mat?.__usesBodyDiffuse) {
                mat.map = newDiffuse
                mat.needsUpdate = true
              }
            })
          }
          // Hand the new base canvas back to the parent so any overlay
          // re-render picks up the season-correct underlay.
          onModelLoaded?.(model, newImage)

          // Ground swap — same tick. slabSeasonSwapRef handles both:
          //   • real winter texture available → pointer swap to the cached
          //     snow canvas built from the grass RGT (proper snowy look).
          //   • procedural slab fallback → legacy colour-tint behaviour
          //     (warm brown summer / pale blue-grey winter).
          slabSeasonSwapRef.current?.(newSeason)
          needsRenderRef.current = true
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      }
    }
    run()
    return () => {
      cancelled = true
      // Drop the helper so a stale closure (pointing at the previous
      // vehicle's archive context) can never run after the model has
      // been swapped out.
      seasonReloadRef.current = null
    }
    // `season` intentionally excluded — handled by seasonReloadRef + the
    // separate season useEffect, which re-skin the model in place rather
    // than tearing the whole mesh group down on every Summer ↔ Winter flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onModelLoaded/onPartsLoaded are parent callbacks not wrapped in useCallback (adding them would reload the whole mesh on every parent render); season is deliberately excluded (handled by seasonReloadRef); only vehicle?.id is read, not the full object
  }, [root, vehicle?.id, showDestroyed])

  // =========================================================================
  // Overlay canvas → CanvasTexture
  // =========================================================================
  useEffect(() => {
    if (!meshGroupRef.current) return
    if (overlayCanvas) {
      if (!overlayTexRef.current) {
        overlayTexRef.current = new CanvasTexture(overlayCanvas)
      }
      // RE-APPLY texture properties on every effect run (not just initial create).
      // Without this, the overlayTexRef instance survives HMR with WHATEVER flipY
      // was set the first time it was created. Tracks/wheels rebuild a fresh
      // CanvasTexture per model load (so they always pick up the current code's
      // flipY), but the body's overlay texture is created once and persists —
      // which is exactly the asymmetry that caused "tracks render correctly,
      // body looks wrong" after the flipY=true fix landed via HMR.
      // Must match the diffuse's flipY=true (UVs stored as 1-v per rgm.ts:412).
      // The overlay canvas is painted top-down by Canvas2D drawImage, same
      // orientation as the diffuse PNG, so it samples correctly with flipY=true.
      overlayTexRef.current!.flipY = true
      overlayTexRef.current!.colorSpace = SRGBColorSpace
      overlayTexRef.current!.wrapS = overlayTexRef.current!.wrapT = RepeatWrapping
      // Initial bind needs an upload — flag the dirty bit so the loop's
      // gate runs once, then it stays quiet until something paints.
      overlayDirtyRef.current = true
      needsRenderRef.current = true
      meshGroupRef.current.traverse(o => {
        const m = o as Mesh
        if (m.isMesh) {
          const mat = m.material as MeshStandardMaterial
          // Only rebind the editable overlay onto submeshes that use the
          // BODY diffuse. Tracks/wheels keep their own (tile) textures so
          // we don't smear the hull atlas across treads.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading custom __usesBodyDiffuse property on Three.js material
          if ((mat as any).__usesBodyDiffuse) {
            mat.map = overlayTexRef.current
            mat.needsUpdate = true
          }
        }
      })
    } else if (baseTextureRef.current) {
      meshGroupRef.current.traverse(o => {
        const m = o as Mesh
        if (m.isMesh) {
          const mat = m.material as MeshStandardMaterial
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading custom __usesBodyDiffuse property on Three.js material
          if ((mat as any).__usesBodyDiffuse) {
            mat.map = baseTextureRef.current
            mat.needsUpdate = true
          }
        }
      })
    }
  }, [overlayCanvas, modelTick])

  // =========================================================================
  // Overlay paint signal — the parent (Editor) bumps `overlayVersion` every
  // time it repaints the 2048² canvas. We just flag the dirty bit so the
  // animation loop's gated re-upload runs once on the next frame.
  // =========================================================================
  useEffect(() => {
    overlayDirtyRef.current = true
    needsRenderRef.current = true
  }, [overlayVersion])

  // =========================================================================
  // Selected part / explodeAll → smart explode directions + isolate logic
  // =========================================================================
  useEffect(() => {
    if (!meshGroupRef.current) return
    const map = submeshMapsRef.current
    const vehicleId = vehicle?.id ?? null
    const vehicleSize = vehicleSizeRef.current

    // Compute vehicle bounding-box centre in local space (origin after
    // centring step, so usually ≈ (0,y,0) but compute it properly).
    const groupBox = new Box3().setFromObject(meshGroupRef.current)
    const vehicleCenter = groupBox.getCenter(new Vector3())

    // Clear all emissive tints and reset visibility eagerly.
    // The RAF tick will re-apply hover / isolate emissives each frame
    // while explode mode is active; clearing here ensures a clean state
    // on the first render after the effect runs.
    for (const mesh of map.values()) {
      ;(mesh.material as MeshStandardMaterial).emissive.setHex(0x000000)
      ;(mesh.material as MeshStandardMaterial).emissiveIntensity = 0
      mesh.visible = true
    }

    // Reset hover tracking on mode transitions
    hoveredPartRef.current = null
    hoverLastPxRef.current = null

    // Compute new explode targets
    const newTargets = new Map<string, Vector3>()
    if (explodeAll) {
      for (const [name, mesh] of map) {
        mesh.geometry.computeBoundingBox()
        const bboxCenter = new Vector3()
        mesh.geometry.boundingBox!.getCenter(bboxCenter)

        const dir = computeExplodeDirection(name, bboxCenter, vehicleSize, vehicleId, vehicleCenter)
        // Chassis / hull anchors return zero — keep them in place
        newTargets.set(name, dir.lengthSq() > 0 ? dir.multiplyScalar(0.5) : new Vector3(0, 0, 0))
      }

      // When entering explode mode, reset isolate state
      if (isolateTargetRef.current) {
        // Restore controls.target to saved position (or let savedControlsTargetRef
        // drive the lerp in the opposite direction — here we just clear the
        // isolate target so the lerp stops, and the saved target will be
        // restored by the deselect path below).
        isolateTargetRef.current = null
      }
      savedControlsTargetRef.current = null
    } else if (selectedPart && map.has(selectedPart)) {
      // ── Isolate mode: one part selected ────────────────────────────────
      const sel = map.get(selectedPart)!
      sel.geometry.computeBoundingBox()
      const bboxCenter = new Vector3()
      sel.geometry.boundingBox!.getCenter(bboxCenter)

      const dir = computeExplodeDirection(
        selectedPart,
        bboxCenter,
        vehicleSize,
        vehicleId,
        vehicleCenter,
      )

      for (const name of map.keys()) {
        newTargets.set(name, new Vector3(0, 0, 0))
      }
      newTargets.set(
        selectedPart,
        dir.lengthSq() > 0 ? dir.multiplyScalar(0.45) : new Vector3(0, 0, 0),
      )

      // Set up controls.target lerp toward this mesh's world-space centre.
      // Save the current target before moving so deselect can restore it.
      const controls = controlsRef.current
      if (controls) {
        if (!savedControlsTargetRef.current) {
          savedControlsTargetRef.current = controls.target.clone()
        }
        // World-space position = mesh world position + explode offset direction
        sel.geometry.computeBoundingBox()
        const worldCenter = new Vector3()
        sel.getWorldPosition(worldCenter)
        worldCenter.add(
          dir.lengthSq() > 0 ? dir.clone().normalize().multiplyScalar(0.45) : new Vector3(),
        )
        isolateTargetRef.current = worldCenter
      }
    } else {
      // ── Deselect / collapsed ─────────────────────────────────────────────
      for (const name of map.keys()) newTargets.set(name, new Vector3(0, 0, 0))

      // Restore controls.target to saved position (lerp driven by RAF tick)
      if (savedControlsTargetRef.current && controlsRef.current) {
        isolateTargetRef.current = savedControlsTargetRef.current.clone()
        savedControlsTargetRef.current = null
      } else {
        isolateTargetRef.current = null
      }
    }

    targetPosRef.current = newTargets
    explodeProgressRef.current = 0 // kick off animation
    needsRenderRef.current = true
  }, [selectedPart, explodeAll, vehicle])

  // =========================================================================
  // ESC key → deselect part in explode mode ("back to exploded view")
  // =========================================================================
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && explodeAll && selectedPart) {
        onPartClick?.(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [explodeAll, selectedPart, onPartClick])

  // =========================================================================
  // Camera reset — listens for the 'coh2:viewport-reset' custom event
  // dispatched by Editor.tsx when the user presses the R key.
  // Calls OrbitControls.reset() which snaps to the saved initial position
  // and target that were captured after the last model-fit.
  // =========================================================================
  useEffect(() => {
    const onReset = () => {
      const controls = controlsRef.current
      if (!controls) return
      controls.reset()
      needsRenderRef.current = true
    }
    window.addEventListener('coh2:viewport-reset', onReset)
    return () => window.removeEventListener('coh2:viewport-reset', onReset)
  }, [])

  // =========================================================================
  // Pointer raycasting → UV + part name
  //
  // `pickUV` returns both the UV (used by decal placement) and the hit
  // mesh's name (used by explode-mode part selection). One raycast call,
  // two consumers. Returns null when the pointer misses the vehicle.
  // =========================================================================
  const pickUV = (e: React.MouseEvent) => {
    if (!canvasRef.current || !cameraRef.current || !meshGroupRef.current) return null
    const rect = canvasRef.current.getBoundingClientRect()
    pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current)
    const hits = raycasterRef.current.intersectObject(meshGroupRef.current, true)
    if (!hits.length || !hits[0].uv) return null
    return { u: hits[0].uv.x, v: hits[0].uv.y, partName: hits[0].object.name || null }
  }

  // Canvas click handler — branches on explode mode.
  //
  // explode mode ON  → click selects the hit part (or clears selection on miss).
  //                    UV is ignored; we don't want to paint a decal while the
  //                    vehicle is in pieces.
  // explode mode OFF → click places a decal at the hit UV (existing behaviour).
  const handleCanvasClick = (e: React.MouseEvent) => {
    const hit = pickUV(e)
    if (explodeAll) {
      // Pass the part name (or null on miss → clears selection / back to exploded)
      onPartClick?.(hit?.partName ?? null)
      return
    }
    if (hit) onPick?.({ u: hit.u, v: hit.v })
  }

  // Hover in explode mode: re-enable raycasting but throttle to ~60 Hz by
  // skipping if the cursor hasn't moved >1px since last sample.  This avoids
  // the cost of an intersectObject() call on every single mousemove event
  // (which can fire 200+ times/sec on a high-polling mouse).
  const handleCanvasMove = (e: React.MouseEvent) => {
    if (!explodeAll) {
      // Normal mode: update brush preview UV
      const hit = pickUV(e)
      onHover?.(hit ? { u: hit.u, v: hit.v } : null)
      return
    }

    // Suppress hover UV in explode mode (don't move the brush cursor over parts)
    onHover?.(null)

    // Throttle: skip if cursor hasn't moved >1px
    const last = hoverLastPxRef.current
    if (last && Math.abs(e.clientX - last.x) <= 1 && Math.abs(e.clientY - last.y) <= 1) return
    hoverLastPxRef.current = { x: e.clientX, y: e.clientY }

    // Raycast only against VISIBLE meshes so hidden parts (isolate mode) don't
    // intercept hover.  We temporarily filter by name and re-enable visibility
    // temporarily is tricky, so we just let the raycaster work and check
    // whether the hit mesh is visible.
    const hit = pickUV(e)
    const hitName = hit?.partName ?? null

    // Only highlight visible meshes
    const newHovered =
      hitName !== null && (submeshMapsRef.current.get(hitName)?.visible ?? true) ? hitName : null

    if (newHovered !== hoveredPartRef.current) {
      hoveredPartRef.current = newHovered
      needsRenderRef.current = true

      // Update cursor: pointer over a part, grab otherwise
      if (canvasRef.current) {
        canvasRef.current.style.cursor = newHovered ? 'pointer' : 'grab'
      }
    }
  }

  const handleCanvasLeave = () => {
    onHover?.(null)
    if (explodeAll) {
      hoveredPartRef.current = null
      needsRenderRef.current = true
      if (canvasRef.current) canvasRef.current.style.cursor = ''
    }
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMove}
        onMouseLeave={handleCanvasLeave}
      />
      {(loading || err) && (
        <div
          className={`absolute inset-0 grid place-items-center ${err ? '' : 'pointer-events-none'}`}
        >
          <div className="glass-2 rounded-xl px-4 py-3 text-[12px] max-w-md">
            {err ? (
              <div className="space-y-2">
                <div className="text-red-300 leading-relaxed">{err}</div>
                {onReconnect && (
                  <button
                    onClick={onReconnect}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-black font-medium hover:bg-[var(--color-accent-strong)] transition"
                  >
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
