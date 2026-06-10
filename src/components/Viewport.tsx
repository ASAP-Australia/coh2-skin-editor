import { useCallback, useEffect, useRef, useState } from 'react'
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
  CylinderGeometry,
  PlaneGeometry,
  SphereGeometry,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  ShaderMaterial,
  CanvasTexture,
  CubeTexture,
  PMREMGenerator,
  Raycaster,
  GridHelper,
  SRGBColorSpace,
  NoColorSpace,
  RepeatWrapping,
  DoubleSide,
  BackSide,
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
  TextureLoader,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { locateArchives } from '@/lib/coh2-fs'
import { getPreloadedArchive, cacheArchive, getPreloadedBytes, cacheBytes, prefetchedTextures } from '@/lib/preload'
import { SgaArchive } from '@/lib/sga'
import { parseRgm, type RgmModel } from '@/lib/rgm'
import { decodeRgt, parseRgtHeader, rgtToCompressedTexture } from '@/lib/rgt'
import { bcToCanvas } from '@/lib/bc-decode'
import { decodeRgtFullOffThread } from '@/lib/decode-pool'
import { rgmPath, type VehicleSpec } from '@/lib/vehicles'
import {
  type ScenePreset,
  type ToneMappingMode,
  SCENE_PRESETS,
  DEFAULT_PRESET_ID,
  applySeasonOverrides,
} from '@/lib/scene-settings'
import { loadSkybox, proceduralSkybox, listAvailableEnvs, filterEnvsBySeason } from '@/lib/skybox'
// brown_mud_dry (Poly Haven, CC0): uniform dry-mud granules with no large
// distinctive features — chosen over excavated_soil_wall because a grain-only
// surface hides the tile seams when repeated, so the band doesn't read as
// "obviously repeating". Darkened at the material via a low color multiplier.
import dirtTextureUrl from '@/assets/textures/brown_mud_dry_2k.jpg'
import { loadStructure } from '@/lib/structure-loader'
import { computeExplodeDirection, computeExplodeOffset } from '@/lib/explode-direction'
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
  /** Ref that receives the `buildVehicleIntoCache` function once Viewport
   *  mounts. Editor uses this to trigger faction-first preloads without
   *  touching the active vehicle state. */
  preloadRef?: React.MutableRefObject<((spec: VehicleSpec, season: 'summer' | 'winter', eager?: boolean, cpuOnly?: boolean) => Promise<void>) | null>
  /** Ref that receives a `faceDecalSide` function once Viewport mounts.
   *  Calling it snaps the orbit camera to a right-side view of the vehicle
   *  (positive-X world direction) so a hull-right decal is immediately
   *  visible without the user having to orbit manually.  The snap is
   *  instantaneous and only fires once per call; the user can still orbit
   *  freely afterwards.  Ignored in demo mode / when no model is loaded. */
  faceDecalRef?: React.MutableRefObject<(() => void) | null>
  /** When true the Viewport operates in headless warm-up mode:
   *  - Creates renderer + camera so `buildVehicleIntoCache` (wired via
   *    `preloadRef`) works correctly.
   *  - Does NOT auto-load/render a default vehicle.
   *  - Skips UI-only effects (post-processing, season ground slab, etc.).
   *  All warm builds run with `cpuOnly=true` so GPU compile steps are
   *  deferred to the editor's own renderer (they don't transfer across
   *  WebGL contexts anyway). Normal Viewport usage is byte-for-byte
   *  unchanged — this flag has no effect when false (the default). */
  warmupOnly?: boolean
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
  // Destruction-state debris the Tiger I (and other RGMs) ship inside the
  // intact group: `Crushed_Mesh_01/02/03` (collapsed hull panels),
  // `geo_Body_Chunks_*` (broken-off body fragments), and `orphan_Hatch_*` /
  // `orphans_wheel_*` (parts flung off on death — duplicates of the intact
  // `geo_Hull_Hatch_*` / `geo_Wheel_*`). These leaked into the intact view
  // and rendered as wreckage on the pristine tank because no prior pattern
  // matched them. NOTE: use `(?![a-z])` (a letter-only negative lookahead),
  // NOT a trailing `\b`: `\b` treats `_` as a word char, so `\bcrushed\b`
  // never matches `Crushed_Mesh` (no boundary between `crushed` and `_`) —
  // which is why the earlier attempt silently did nothing. No leading `\b`
  // either, for the same reason (`geo_Body_Chunks` has `_` before the token).
  // These tokens are inherently destruction-only — safe to always hide.
  /crushed(?![a-z])/i,
  /orphans?(?![a-z])/i,
  /body_chunks?(?![a-z])/i,
  // High-detail "hero" RGMs (Tiger, Churchill, Easy 8, M5 Stuart, M4A3
  // Sherman) ship their wreck/crush state baked into the SAME file as named
  // `WRK_*` (wrecked gun barrel / turret / body) and `CRS_*` (crushed body /
  // turret / orphan) parts. Previously NOTHING matched these abbreviations,
  // so every hero model rendered a wrecked gun barrel + crushed body panels
  // overlapping the pristine tank. Match the `WRK`/`CRS` token at any
  // separator boundary (covers `WRK_maingun_barrel`, `CRS_body_01`,
  // `CRS_Orphan_03`). `(?![a-z])` so we only match the standalone prefix,
  // never a longer word that merely starts with those letters.
  /(?:^|[_\W])wrk(?![a-z])/i,
  /(?:^|[_\W])crs(?![a-z])/i,
]
function isDestroyedMesh(name: string): boolean {
  return DESTROYED_PATTERNS.some(re => re.test(name))
}

/**
 * Gameplay-VARIANT overlay meshes — alternate weapon/upgrade geometry that a
 * single RGM stacks on top of the base model so the engine can swap kit per
 * upgrade. The Churchill is the worst offender: its file carries the AVRE
 * Petard mortar turret (`GEO_turret_vert_mortar`, `GEO_avre_projectile`) and
 * the Crocodile flamethrower kit (`GEO_hull_mg_01_vert_flamethrower`,
 * `GEO_chassis_shaker_croctank`) layered over the standard 75mm Churchill.
 * Rendering them all at once is the "shows the mortar Churchill as well" bug.
 * We hide variants so the editor shows the BASE vehicle only.
 *
 * Scoped to Churchill-unique tokens on purpose — a bare `/mortar/` would also
 * hide the M21 Mortar Halftrack's PRIMARY weapon (`m1_81mm_mortar`), which is
 * the whole point of that vehicle. `turret_vert_mortar` is the variant turret;
 * `avre`/`flamethrower`/`croctank` never appear except as Churchill upgrades.
 * `goblins` is Relic's term for the little crew figures baked into hero RGMs
 * (Tiger) — never wanted in a skin-preview, always safe to drop.
 */
const VARIANT_PATTERNS: RegExp[] = [
  /turret_vert_mortar/i,
  /(?:^|[_\W])avre(?![a-z])/i,
  /flamethrower/i,
  /croctank/i,
  /goblins?(?![a-z])/i,
]
function isVariantMesh(name: string): boolean {
  return VARIANT_PATTERNS.some(re => re.test(name))
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
 * Triangle-area-weighted centroid of a vehicle group's BODY meshes (those
 * whose material carries the `__usesBodyDiffuse` flag), in group-local
 * pre-scale space. Returns (0,0,0) when no body mesh is present so callers
 * can fall back to a bbox centre.
 *
 * Why area-weighted: a long gun barrel (Tiger, Elefant) or any thin outlying
 * attachment (antenna, tow cable, spare track) drags a bounding-box centre to
 * one side, leaving the hull visibly off-pad while the barrel overhangs the
 * edge. Surface-area weighting makes thin/small parts contribute almost
 * nothing, so the heavy hull+turret mass lands dead-centre. Shared by the
 * live build path (run) and the warmup builder (buildVehicleIntoCache) so the
 * pre-built cache-hit copies centre identically to freshly-built ones.
 */
function computeBodyCentroidLocal(group: Group): Vector3 {
  const bodyMeshes = group.children.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom flag set on Three.js materials
    c => (c as any).material && (c as any).material.__usesBodyDiffuse,
  ) as Mesh[]
  const centroid = new Vector3()
  if (bodyMeshes.length === 0) return centroid
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
      sum.x += ((a.x + b.x + c.x) / 3) * area
      sum.y += ((a.y + b.y + c.y) / 3) * area
      sum.z += ((a.z + b.z + c.z) / 3) * area
      totalArea += area
    }
  }
  if (totalArea > 0) centroid.copy(sum).divideScalar(totalArea)
  return centroid
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

// Base radius (scene units) of the circular ground "slab" the vehicle sits
// on. The geometry is built at this radius once; the per-vehicle load effect
// then SCALES the slab in X/Z so the pad hugs each vehicle's footprint (a
// fixed pad looked far too large around small cars). 4.2 ≈ half the King
// Tiger's footprint diagonal, so scale ≈1 for the biggest vehicle and <1
// for everything smaller.
const SLAB_BASE_RADIUS = 4.2

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

// ── PMREM cache ───────────────────────────────────────────────────────────────
// Keyed by "presetId:season". Each entry is ~3 MB. With 2 presets × 2 seasons
// = 4 entries ≈ 12 MB — negligible. Cached textures are NEVER disposed on
// vehicle or season switch — only on full page reload.
const pmremCache = new Map<string, Texture>()

// ── Vehicle group LRU cache ───────────────────────────────────────────────────
const MAX_CACHED_VEHICLES = 4

interface CachedVehicleGroup {
  group: Group
  // The base diffuse CanvasTexture at time of cache insertion.
  // This is REPLACED on every swap-in with the current project's diffuse.
  baseDiffuse: Texture | null
  normalTex: Texture | null
  // Store model + diffuseCanvas so the fast path can replay onModelLoaded.
  model: import('@/lib/rgm').RgmModel | null
  diffuseCanvas: HTMLCanvasElement | null
  // submeshMap needed so the fast path can restore part-list + explode state.
  submeshMap: Map<string, Mesh> | null
  lastUsed: number
}

const vehicleGroupCache = new Map<string, CachedVehicleGroup>()

// ── Pinned vehicle cache ──────────────────────────────────────────────────────
// Holds faction-first vehicles (≤5). Never evicted — these stay warm for the
// lifetime of the page so switching factions is instant.
const pinnedVehicleCache = new Map<string, CachedVehicleGroup>()

function disposeVehicleGroup(entry: CachedVehicleGroup): void {
  entry.group.traverse(obj => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mats.forEach(m => {
      const mat = m as MeshStandardMaterial
      // Dispose all texture slots EXCEPT the body diffuse CanvasTexture —
      // that is managed by baseTextureRef / overlayTexRef and may still be
      // referenced by the active overlay. Disposing it here would break the
      // overlay compositor.
      ;[(mat as MeshPhysicalMaterial).normalMap,
        (mat as MeshPhysicalMaterial).roughnessMap,
        (mat as MeshPhysicalMaterial).metalnessMap]
        .forEach(t => t?.dispose())
      // DO NOT dispose mat.map — it is the body diffuse CanvasTexture owned by baseTextureRef.
      m.dispose()
    })
  })
}

function evictLruEntry(): void {
  if (vehicleGroupCache.size <= MAX_CACHED_VEHICLES) return
  let oldest = Infinity
  let oldestKey = ''
  vehicleGroupCache.forEach((entry, key) => {
    if (entry.lastUsed < oldest) { oldest = entry.lastUsed; oldestKey = key }
  })
  if (!oldestKey) return
  const entry = vehicleGroupCache.get(oldestKey)!
  // Never dispose a group still referenced by the pinned cache.
  const isPinned = Array.from(pinnedVehicleCache.values()).some(e => e.group === entry.group)
  if (!isPinned) disposeVehicleGroup(entry)
  vehicleGroupCache.delete(oldestKey)
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
  preloadRef,
  faceDecalRef,
  warmupOnly = false,
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
  /** Timestamp (performance.now()) of the last camera interaction — set by
   *  OrbitControls 'change' and the damping tail in the tick. Background
   *  vehicle preloads poll this and defer their heavy GPU work until the
   *  user has been idle for a beat, so orbiting never janks. */
  const lastInteractionRef = useRef(0)
  /** Cached result of `locateArchives(root)`. Keyed by the `root` handle's
   *  identity so a reconnect (new root) triggers a fresh resolve while
   *  vehicle-switches within the same session reuse the cached handle,
   *  eliminating up to 4 IPC round-trips per switch. */
  const archivesHandleRef = useRef<{ root: FileSystemDirectoryHandle; archives: FileSystemDirectoryHandle | null } | null>(null)
  const raycasterRef = useRef(new Raycaster())
  const pointerRef = useRef(new Vector2())
  /** All preset-managed lights live in this group. The preset effect tears
   *  it down + rebuilds when the preset changes. */
  const sceneLightsRef = useRef<Group | null>(null)
  /** Optional reference grid (Studio Grid preset only). */
  const sceneGridRef = useRef<GridHelper | null>(null)
  const groundMeshRef = useRef<Mesh | null>(null)
  const groundMatRef = useRef<MeshStandardMaterial | null>(null)
  /** Set true once the camera has been framed on the FIRST vehicle of the
   *  session. After that, vehicle switches must NOT move the camera or the
   *  orbit pivot — the user keeps their current view/zoom across switches. */
  const cameraFramedRef = useRef(false)
  /** Cached slab textures, one per season. Both are built once when the
   *  grass RGT loads — the winter variant is a canvas-filter derivative of
   *  the summer grass (heavy desaturate + brighten + cool blue overlay) so
   *  no extra archive scan is needed. Season toggles just swap the .map
   *  pointer between these two refs, atomic with the body-diffuse swap. */
  const slabSummerTexRef = useRef<Texture | null>(null)
  const slabWinterTexRef = useRef<Texture | null>(null)
  /** Atomic season swap for the slab top material — set inside the slab
   *  build effect, called by the season useEffect (applySeasonToGroup) so
   *  ground + chassis flip on the same render frame. */
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
  /** Seamless gradient sky sphere (large inverted sphere, BackSide, no seams).
   *  Replaces scene.background = cubemap so the visible sky is seamless while
   *  scene.environment (PMREM IBL) is kept for correct vehicle lighting. */
  const skyMeshRef = useRef<Mesh | null>(null)
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
  // Previous hover/selection state — used in the RAF tick to gate the
  // unconditional needsRenderRef + shadowDirty so we don't re-render
  // every frame at 60 fps just because explode mode is active.
  const prevHoveredPartRef = useRef<string | null>(null)
  const prevSelectedPartRef = useRef<string | null>(null)
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
    // Manual shadow updates. By default Three.js re-renders the shadow
    // map (a full-scene depth pass from the light's POV) on EVERY
    // renderer.render() — including every frame of a camera orbit, even
    // though orbiting moves only the camera while the model and light
    // stay put, so the shadow is pixel-identical frame to frame. We
    // disable auto-update and flag needsUpdate in the render loop only
    // when something that actually changes the shadow happens (model
    // swap, explode/upgrade visibility, preset/light/season change).
    // Net effect: ~one fewer full-scene pass per orbit frame, shadows
    // visually unchanged. needsUpdate is true now for the first draw.
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    // Tone mapping + exposure — the preset effect writes the real values
    // immediately after init; these are just the boot fallback.
    const initial = presetRef.current
    renderer.toneMapping = toneMappingFromMode(initial.toneMapping)
    renderer.toneMappingExposure = initial.exposure
    const scene = new Scene()
    // Boot fallback — preset effect overwrites this immediately on mount;
    // use neutral dark grey so non-cubemap presets never flash pitch-black.
    scene.background = new Color(0x404448)
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
      lastInteractionRef.current = performance.now()
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

    // ── Gradient sky sphere ──────────────────────────────────────────────
    // Large inverted sphere with a procedural GLSL gradient shader.
    // Replaces scene.background = cubemap for the visible sky so there are:
    //   • no cube seams / visible corners
    //   • no gray underside (looking down at the tank shows sky, not a face)
    //   • no clouds (plain sunny sky)
    // scene.environment (the PMREM IBL used for vehicle lighting) is kept
    // untouched — only the VISIBLE background changes.
    // The sphere moves with the camera in the RAF tick so it's always centred.
    const skyGeo = new SphereGeometry(900, 32, 16)
    const skyMat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uSunDirection: { value: new Vector3(0.4, 0.7, 0.3).normalize() },
        // Summer defaults; the preset/season effect overwrites these per
        // season so the VISIBLE sky actually flips with the season toggle
        // (B1). Previously these were fixed summer-blue, so "Winter" only
        // changed the IBL bake and the visible dome stayed summer.
        uZenith:       { value: new Color(0x1a4a8a) },  // deep blue zenith
        uMidSky:       { value: new Color(0x4a90d9) },  // mid-blue
        uHorizon:      { value: new Color(0xb0cce8) },  // pale horizon haze
        uBelow:        { value: new Color(0x87CEEB) },  // sky-blue below horizon
        uSunGlow:      { value: 0.6 },                  // sun-disk strength
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDirection;
        uniform vec3 uZenith;
        uniform vec3 uMidSky;
        uniform vec3 uHorizon;
        uniform vec3 uBelow;
        uniform float uSunGlow;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          // t = +1 at zenith, 0 at horizon, -1 at nadir.
          float t = dir.y;
          // Fully continuous vertical gradient. Both the above-horizon and
          // below-horizon ramps use smoothstep, whose derivative is ZERO at
          // t = 0 — so the two halves meet at uHorizon with matching slope
          // and there is no bright ring / slope break at the horizon (B2:
          // the old branch used pow(t,0.5) above and a linear ramp below,
          // which produced a visible seam line where the slopes disagreed).
          float up   = smoothstep(0.0, 0.55, t);        // horizon → zenith
          float lift = smoothstep(0.0, 0.22, t);        // horizon → mid-sky
          vec3  above = mix(mix(uHorizon, uMidSky, lift), uZenith, up);
          float down  = smoothstep(0.0, -0.45, t);      // horizon → below
          vec3  below = mix(uHorizon, uBelow, down);
          vec3  sky   = (t >= 0.0) ? above : below;
          // Subtle sun-glow disk (dimmed to near-zero in overcast winter).
          float sunDot = max(0.0, dot(dir, normalize(uSunDirection)));
          sky += vec3(1.0, 0.95, 0.85) * pow(sunDot, 64.0) * uSunGlow;
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    })
    const skyMesh = new Mesh(skyGeo, skyMat)
    skyMesh.name = '__skySphere'
    skyMesh.visible = false // preset effect enables this for cubemap presets
    skyMesh.renderOrder = -1
    skyMeshRef.current = skyMesh
    scene.add(skyMesh)

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      // Anything an effect dirtied since the last frame (model load,
      // preset/season/light swap, ground toggle, …) needs a shadow
      // rebuild — capture it before the camera branch flips the flag.
      const externalDirty = needsRenderRef.current
      // Set when something that actually changes the shadow shape moves
      // (explode lerp, explode/upgrade visibility). Pure camera motion
      // does NOT set this, so orbits skip the shadow pass.
      let shadowDirty = false
      // OrbitControls.update() returns true while damping is still
      // settling (i.e. camera is logically moving even after the user
      // released). Treat that as a render trigger.
      const cameraMoving = controls.update()
      if (cameraMoving) {
        needsRenderRef.current = true
        lastInteractionRef.current = performance.now()
      }

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
        shadowDirty = true // meshes moved → shadow shape changes
      }

      // ── Explode interactive: hover emissive + isolate visibility ──────────
      if (explodeAllRef.current) {
        const hoveredPart = hoveredPartRef.current
        const selectedPart = selectedPartRef.current

        // Only rebuild emissives + dirty the renderer when hover or selection
        // actually changed. Previously these were set unconditionally every
        // frame, which forced a full render + shadow pass at 60 fps even when
        // the user wasn't hovering over anything — the main source of lag with
        // a vehicle loaded in explode mode.
        const hoverChanged =
          hoveredPart !== prevHoveredPartRef.current ||
          selectedPart !== prevSelectedPartRef.current
        if (hoverChanged) {
          prevHoveredPartRef.current = hoveredPart
          prevSelectedPartRef.current = selectedPart

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
              // Full explode: all parts visible; hover gets a warm tint
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
          shadowDirty = true // part visibility may have changed → shadows
        }
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
      // Keep the sky sphere centred on the camera so it always fills the
      // background regardless of how far the user has orbited.
      if (skyMeshRef.current?.visible) {
        skyMeshRef.current.position.copy(camera.position)
      }
      // Rebuild the shadow map only when geometry/visibility changed
      // (shadowDirty) or an effect dirtied the scene since last frame
      // (externalDirty). Pure camera orbits hit neither, so the shadow
      // pass is skipped while dragging — the dominant per-frame saving.
      // Three.js auto-resets needsUpdate to false after the draw.
      if (shadowDirty || externalDirty) renderer.shadowMap.needsUpdate = true
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
  // Centralised season re-skinning (applySeasonToGroup)
  //
  // Works uniformly for live-built, warmup-built, and cache-hit mesh groups.
  // The build paths tag every paintable material (body + turrets + panels)
  // with `__seasonPaint`, `__seasonToken`, and `__summerMap`, and stamp the
  // group with `__seasonFaction` / `__seasonBases` / `__seasonModel`. This
  // helper then:
  //   • lazily resolves the matching winter atlas PER TOKEN (so the StuG's
  //     superstructure/turret + side skirts swap, not just the hull),
  //     caching the decoded winter texture on the material;
  //   • swaps each material's diffuse to the season target (winter atlas, or
  //     the summer atlas as a fallback when no winter variant exists);
  //   • applies a subtle cool "frost" emissive in winter so the season reads
  //     visually even where CoH2's winter diffuse barely differs from summer;
  //   • keeps the editable overlay base (baseTextureRef + onModelLoaded) in
  //     sync so painted decals recomposite over the season-correct hull.
  // Replaces the old hull-only seasonReloadRef which silently skipped the
  // turret/panel atlases and never bound on cache-hit (warmed) vehicles.
  // =========================================================================
  const SEASON_SGA_CANDIDATES = [
    'ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga',
    'ArtGermanEF.sga', 'ArtSovietEF.sga', 'ArtAEF.sga', 'ArtAEFSkins.sga',
    'ArtBritish.sga', 'ArtWestGerman.sga',
  ]

  /** Open a candidate archive, preferring the module-level preload cache and
   *  falling back to the resolved Archives dir handle (shared back on success). */
  const openSeasonArchive = useCallback(async (name: string): Promise<SgaArchive | null> => {
    const pre = getPreloadedArchive(name)
    if (pre) return pre
    const dir = archivesHandleRef.current?.archives
    if (!dir) return null
    try {
      const fh = await dir.getFileHandle(name)
      const file = await fh.getFile()
      const a = await SgaArchive.open(file)
      cacheArchive(name, a)
      return a
    } catch { return null }
  }, [])

  /** Decode RGT bytes → diffuse CanvasTexture (mirrors decodeTextureBytes's
   *  'diffuse' branch: sRGB, flipY, repeat wrap, max anisotropy). */
  const decodeSeasonDiffuse = useCallback((bytes: Uint8Array): Texture | null => {
    try {
      const rgt = decodeRgt(bytes)
      const cv = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
      const t = new CanvasTexture(cv)
      t.flipY = true
      t.colorSpace = SRGBColorSpace
      t.wrapS = t.wrapT = RepeatWrapping
      t.anisotropy = MAX_ANISO
      return t
    } catch { return null }
  }, [])

  /** Resolve the winter variant of an atlas for a given token (''=body,
   *  'turrets', 'panels') by TOC-scanning candidate archives for
   *  `skins/<*winter*>/<base><suffix>_dif.rgt`, preferring the canonical
   *  `winter` folder. Returns decodable bytes or null. */
  const resolveWinterDiffuse = useCallback(async (
    faction: string, bases: string[], token: string,
  ): Promise<Uint8Array | null> => {
    const factionLow = faction.toLowerCase()
    const suffix = token === 'turrets' ? '_turrets' : token === 'panels' ? '_panels' : ''
    for (const baseRaw of bases) {
      const fname = `${String(baseRaw).toLowerCase()}${suffix}_dif.rgt`
      const esc = fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const skinRe = new RegExp(
        `^art/armies/${factionLow}/vehicles/[^/]+/skins/([^/]*winter[^/]*)/${esc}$`,
      )
      for (const name of SEASON_SGA_CANDIDATES) {
        const a = await openSeasonArchive(name)
        if (!a) continue
        const hits = a.list().map(f => f.path.toLowerCase()).filter(p => skinRe.test(p))
        if (!hits.length) continue
        hits.sort((p1, p2) => {
          const f1 = p1.match(skinRe)![1], f2 = p2.match(skinRe)![1]
          if (f1 === 'winter' && f2 !== 'winter') return -1
          if (f2 === 'winter' && f1 !== 'winter') return 1
          return f1.localeCompare(f2)
        })
        for (const p of hits) {
          const cached = getPreloadedBytes(p)
          if (cached) return cached
          const b = await a.readByPath(p)
          if (b) { cacheBytes(p, b); return b }
        }
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- SEASON_SGA_CANDIDATES is a stable literal recreated each render but never changes
  }, [openSeasonArchive])

  /** Re-skin a mesh group for the given season. Async (lazy winter resolve)
   *  but commits maps synchronously once textures are ready. */
  const applySeasonToGroup = useCallback(async (
    group: Group | null, newSeason: 'summer' | 'winter',
  ): Promise<void> => {
    if (!group) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom season props stamped at build time
    const g = group as any
    const faction: string = g.__seasonFaction ?? ''
    const bases: string[] = g.__seasonBases ?? []
    const model: RgmModel | null = g.__seasonModel ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paintMats: any[] = []
    group.traverse(o => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mat = (o as Mesh).material as any
      if (mat?.__seasonPaint) paintMats.push(mat)
    })

    // Winter: lazily resolve + cache each material's winter atlas, deduped by
    // token so each of body/turrets/panels is fetched at most once.
    if (newSeason === 'winter' && faction) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byToken = new Map<string, any[]>()
      for (const mat of paintMats) {
        if (mat.__winterResolved) continue
        const tok: string = mat.__seasonToken ?? ''
        const arr = byToken.get(tok) ?? []
        arr.push(mat)
        byToken.set(tok, arr)
      }
      for (const [tok, mats] of byToken) {
        const bytes = await resolveWinterDiffuse(faction, bases, tok)
        const tex = bytes ? decodeSeasonDiffuse(bytes) : null
        for (const mat of mats) {
          mat.__winterMap = tex // null → falls back to summer atlas below
          mat.__winterResolved = true
        }
      }
    }

    const overlayActive = !!overlayTexRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pick = (mat: any): Texture | null =>
      newSeason === 'winter'
        ? (mat.__winterMap ?? mat.__summerMap ?? null)
        : (mat.__summerMap ?? null)

    let bodyTarget: Texture | null = null
    for (const mat of paintMats) {
      const target = pick(mat)
      if (mat.__usesBodyDiffuse) {
        if (target) bodyTarget = target
        // Body .map is the overlay canvas when an overlay is active; in that
        // case we swap the underlying base (below) instead of the map.
        if (!overlayActive && target) { mat.map = target; mat.needsUpdate = true }
      } else if (target) {
        mat.map = target
        mat.needsUpdate = true
      }
      // Frost: faint cool emissive sheen in winter; restore captured baseline
      // in summer. Cheap, uniform, and reads as "winter" even when the winter
      // diffuse is nearly identical to summer (true for most CoH2 vehicles).
      if (newSeason === 'winter') {
        if (mat.__summerEmissive === undefined) {
          mat.__summerEmissive = {
            hex: mat.emissive?.getHex?.() ?? 0x000000,
            intensity: mat.emissiveIntensity ?? 1,
          }
        }
        mat.emissive?.setHex?.(0x3a4654)
        mat.emissiveIntensity = 0.14
        mat.needsUpdate = true
      } else if (mat.__summerEmissive !== undefined) {
        mat.emissive?.setHex?.(mat.__summerEmissive.hex)
        mat.emissiveIntensity = mat.__summerEmissive.intensity
        mat.needsUpdate = true
      }
    }

    // Body base bookkeeping: point baseTextureRef at the season base and, when
    // an overlay is active, hand the parent the season base canvas so decals
    // recomposite over it. We never dispose here — the summer base lives in the
    // vehicle cache and winter bases are cached on the material.
    if (bodyTarget) {
      baseTextureRef.current = bodyTarget
      const img = (bodyTarget as Texture).image
      if (overlayActive && model && img instanceof HTMLCanvasElement) {
        onModelLoaded?.(model, img)
      }
    }

    slabSeasonSwapRef.current?.(newSeason)
    needsRenderRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onModelLoaded is a parent callback not wrapped in useCallback; including it would re-create this helper each parent render (harmless, but it's only invoked imperatively from effects so identity churn doesn't matter)
  }, [resolveWinterDiffuse, decodeSeasonDiffuse])

  // Pre-resolve + cache the winter diffuse atlas for every season-paint
  // material in a group WITHOUT mutating the live display: it never swaps
  // mat.map, the slab, or emissive — it only fetches+decodes each token's
  // winter RGT once and stamps __winterMap/__winterResolved on the materials.
  // The Connect-time warmup calls this so the FIRST Summer↔Winter toggle for
  // ANY vehicle is a pure in-place map swap with zero async SGA read/decode —
  // i.e. no season loading beam ever, matching "no loading except at Connect".
  const prewarmWinterAtlases = useCallback(async (
    group: Group | null, faction: string, bases: string[],
  ): Promise<void> => {
    if (!group || !faction) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byToken = new Map<string, any[]>()
    group.traverse(o => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mat = (o as Mesh).material as any
      if (!mat?.__seasonPaint || mat.__winterResolved) return
      const tok: string = mat.__seasonToken ?? ''
      const arr = byToken.get(tok) ?? []
      arr.push(mat)
      byToken.set(tok, arr)
    })
    for (const [tok, mats] of byToken) {
      const bytes = await resolveWinterDiffuse(faction, bases, tok)
      const tex = bytes ? decodeSeasonDiffuse(bytes) : null
      for (const mat of mats) {
        mat.__winterMap = tex // null → toggle falls back to summer atlas
        mat.__winterResolved = true
      }
    }
  }, [resolveWinterDiffuse, decodeSeasonDiffuse])

  // =========================================================================
  // Season change → swap diffuse + ground colour atomically
  //
  // Delegates to applySeasonToGroup, which re-skins every season-tagged
  // material (hull + turret + panel atlases) on the live mesh group in place
  // — re-fetching the winter RGT per token, rebinding the maps, applying the
  // frost emissive, and flipping the ground slab in the same pass — so the
  // user reads it as one atomic swap rather than the ground beating the tank
  // texture. If the vehicle has no winter variant the per-token resolve falls
  // back to the summer map, but the ground tint still tracks the selection so
  // the toggle feels responsive.
  //
  // Skipped on first mount — the heavy effect computes the initial season
  // together. Skipped also while the group isn't season-paint-ready yet
  // (between vehicle change and model finishing load).
  // =========================================================================
  const seasonInitialMountRef = useRef(true)
  useEffect(() => {
    if (seasonInitialMountRef.current) {
      seasonInitialMountRef.current = false
      return
    }
    const grp = meshGroupRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- season tag stamped at build time
    if (!grp || !(grp as any).__seasonPaintReady) {
      // No re-skinnable group bound yet (model still loading, or an old build
      // without season tags) — fire the ready signal anyway so the loading-
      // border around the season toggle doesn't get stuck waiting.
      onSeasonReady?.()
      return
    }
    applySeasonToGroup(grp, season)
      .catch(e => console.warn('[viewport] season apply failed', e))
      .finally(() => onSeasonReady?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSeasonReady is a parent callback not wrapped in useCallback; applySeasonToGroup is stable via useCallback; only `season` should re-fire this effect
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
    // CC0 dirt texture (Poly Haven "Excavated Soil Wall", 2K JPG, bundled).
    // Replaces game mud_dry_02_dif.rgt (512×512 DXT1) — same visual intent
    // (soil cross-section on the plinth side) but higher resolution and
    // no SGA dependency. One texture for both seasons.

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

    // Helper — apply the shared "single coverage, slight rotation" treatment
    // so both seasons share the same UV setup and the GPU sampling matches.
    const applySlabUv = (tex: Texture) => {
      tex.wrapS = tex.wrapT = RepeatWrapping
      tex.repeat.set(1, 1)
      tex.center.set(0.5, 0.5)
      tex.rotation = Math.PI / 7 // ~25° — breaks edge-alignment
      tex.anisotropy = MAX_ANISO
    }

    // ── Build the slab IMMEDIATELY with a procedural fallback texture ──
    // The CoH2 grass RGT lives in ArtEnvironment.sga, a large archive whose
    // open+decode previously gated the ENTIRE slab construction — so the
    // ground appeared seconds after the vehicle (or never, if the scan was
    // slow). We now build the slab synchronously with a cheap procedural
    // grass texture and add it to the scene on THIS frame, then load the
    // real RGT grass + CC0 dirt asynchronously and hot-swap them into the
    // live materials when ready. Result: the pad is always present instantly.
    //
    // Circular plinth. CylinderGeometry group order is: 0 = lateral side,
    // 1 = top cap, 2 = bottom cap. The top cap gets the grass texture; the
    // curved side + bottom get tiled dirt. Radius 4.2 (Ø8.4) circumscribes
    // even the King Tiger (longest ≈10 native → ~7.2 units at WORLD_SCALE,
    // half-extent 3.6) with margin so tracks/barrel don't overhang the disc.
    const SLAB_RADIUS = SLAB_BASE_RADIUS
    const SLAB_HEIGHT = 0.2
    const slabGeo = new CylinderGeometry(SLAB_RADIUS, SLAB_RADIUS, SLAB_HEIGHT, 64)

    // Procedural fallback grass top — no SGA dependency, builds in <1ms.
    const fallbackTop = createGroundTexture()
    fallbackTop.wrapS = fallbackTop.wrapT = RepeatWrapping
    fallbackTop.repeat.set(1, 1)
    fallbackTop.center.set(0.5, 0.5)
    fallbackTop.rotation = Math.PI / 7

    const slabMatTop = new MeshStandardMaterial({
      map: fallbackTop,
      roughness: 0.95,
      metalness: 0,
    })
    slabMatTop.color.setHex(seasonGroundTint(slabMatTop, seasonRef.current))
    // Edge + bottom: flat dark-earth colour now; swapped to tiled dirt once
    // the bundled texture finishes loading below.
    const slabMatEdge = new MeshStandardMaterial({
      map: null,
      color: 0x2e2418,
      roughness: 1.0,
      metalness: 0,
    })
    const slabMatBot = new MeshStandardMaterial({
      map: null,
      color: 0x2e2418,
      roughness: 1.0,
      metalness: 0,
    })
    // CylinderGeometry group order: 0 = side, 1 = top cap, 2 = bottom cap.
    const slabMaterials: MeshStandardMaterial[] = [slabMatEdge, slabMatTop, slabMatBot]

    const slab = new Mesh(slabGeo, slabMaterials)
    slab.position.y = -0.1
    slab.receiveShadow = true
    // Mark so the preset's showGround gate treats this slab as valid terrain.
    ;(slab as { __hasHeightmap?: boolean }).__hasHeightmap = true
    scene.add(slab)
    groundMeshRef.current = slab
    groundMatRef.current = slabMatTop
    slabSummerTexRef.current = fallbackTop
    slabWinterTexRef.current = null
    slab.visible = !!presetRef.current.showGround
    needsRenderRef.current = true

    // Atomic season swap — flips the slab's .map between cached summer and
    // winter textures (when both exist). Reads the refs dynamically, so once
    // the async loader publishes real summer/winter RGT textures below this
    // closure automatically uses them; until then it falls back to colour-tint.
    slabSeasonSwapRef.current = s => {
      const mat = groundMatRef.current
      if (!mat) return
      const summer = slabSummerTexRef.current
      const winter = slabWinterTexRef.current
      if (summer && winter) {
        mat.map = s === 'winter' ? winter : summer
        mat.color.setHex(0xffffff)
        mat.needsUpdate = true
        needsRenderRef.current = true
        return
      }
      mat.color.setHex(seasonGroundTint(mat, s))
      needsRenderRef.current = true
    }

    // ── Async: load real grass RGT + CC0 dirt, hot-swap into live materials ─
    ;(async () => {
      // ── Try to load CoH2 grass RGT from ArtEnvironment.sga ───────────
      let realSummer: Texture | null = null
      let realWinter: Texture | null = null
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
            const summer = new CanvasTexture(cv)
            summer.colorSpace = SRGBColorSpace
            applySlabUv(summer)
            realSummer = summer
            // Winter: derive a snow canvas from the same grass canvas.
            const winterCv = makeSnowVariant(cv)
            const winter = new CanvasTexture(winterCv)
            winter.colorSpace = SRGBColorSpace
            applySlabUv(winter)
            realWinter = winter
          }
        }
      } catch (e) {
        console.log('[viewport] slab: grass RGT unavailable, keeping procedural fallback', e)
      }

      // ── Load CC0 bundled dirt texture (side + bottom UV) ──────────────
      let dirtTex: Texture | null = null
      let dirtTexBot: Texture | null = null
      if (!cancelled) {
        try {
          const loader = new TextureLoader()
          const dt = await new Promise<Texture>((resolve, reject) => {
            loader.load(dirtTextureUrl, resolve, undefined, reject)
          })
          if (!cancelled) {
            dt.colorSpace = SRGBColorSpace
            const SIDE_CIRCUMFERENCE = 2 * Math.PI * SLAB_RADIUS
            const DIRT_TILE_M = 1.0 // world size of one tile — hides tiling
            dt.wrapS = dt.wrapT = RepeatWrapping
            dt.repeat.set(SIDE_CIRCUMFERENCE / DIRT_TILE_M, SLAB_HEIGHT / DIRT_TILE_M)
            dt.anisotropy = MAX_ANISO
            dirtTex = dt
            const dtBot = dt.clone()
            dtBot.colorSpace = SRGBColorSpace
            dtBot.wrapS = dtBot.wrapT = RepeatWrapping
            dtBot.repeat.set(1, 1)
            dtBot.center.set(0.5, 0.5)
            dtBot.rotation = Math.PI / 7
            dtBot.anisotropy = MAX_ANISO
            dtBot.needsUpdate = true
            dirtTexBot = dtBot
          }
        } catch (e) {
          console.log('[viewport] slab: CC0 dirt texture failed to load', e)
        }
      }

      if (cancelled) {
        realSummer?.dispose()
        realWinter?.dispose()
        dirtTex?.dispose()
        dirtTexBot?.dispose()
        return
      }

      // ── Hot-swap the real grass into the top material ─────────────────
      if (realSummer) {
        const oldTop = slabMatTop.map
        slabMatTop.map =
          seasonRef.current === 'winter' && realWinter ? realWinter : realSummer
        if (realWinter) slabMatTop.color.setHex(0xffffff)
        else slabMatTop.color.setHex(seasonGroundTint(slabMatTop, seasonRef.current))
        slabMatTop.needsUpdate = true
        // Publish for the season-swap helper. Cleanup reads these refs.
        slabSummerTexRef.current = realSummer
        slabWinterTexRef.current = realWinter
        // Free the procedural fallback texture we just replaced.
        if (oldTop && oldTop !== realSummer) oldTop.dispose()
      }

      // ── Hot-swap the dirt into the edge + bottom materials ────────────
      if (dirtTex) {
        slabMatEdge.map = dirtTex
        slabMatEdge.color.setHex(0x584636)
        slabMatEdge.needsUpdate = true
        slabMatBot.map = dirtTexBot ?? dirtTex
        slabMatBot.color.setHex(0x584636)
        slabMatBot.needsUpdate = true
      }

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
      // Solid-colour preset — hide sky sphere, use scene.background directly.
      if (skyMeshRef.current) skyMeshRef.current.visible = false
      scene.background = new Color(preset.background.hex)
    } else {
      // Cubemap preset — use the gradient sky sphere for the VISIBLE
      // background (seamless, no cube corners, no gray underside) and keep
      // scene.environment (PMREM) for vehicle IBL lighting.
      if (skyMeshRef.current) {
        skyMeshRef.current.visible = true
        // B1: drive the visible gradient dome from the season. Summer is a
        // clear blue CoH2 sky; winter is a cold, flat, overcast sky (pale
        // blue-grey, near-white horizon haze, no sun disk).
        const sm = skyMeshRef.current.material as ShaderMaterial
        const u = sm.uniforms
        if (u?.uZenith) {
          if (season === 'winter') {
            u.uZenith.value.set(0x6c7d92)   // cold grey-blue zenith
            u.uMidSky.value.set(0x95a3b6)   // muted slate
            u.uHorizon.value.set(0xd2dae4)  // pale near-white haze
            u.uBelow.value.set(0xc0c9d4)    // cool grey below horizon
            u.uSunGlow.value = 0.06          // overcast → no real sun disk
          } else {
            u.uZenith.value.set(0x1a4a8a)
            u.uMidSky.value.set(0x4a90d9)
            u.uHorizon.value.set(0xb0cce8)
            u.uBelow.value.set(0x87ceeb)
            u.uSunGlow.value = 0.6
          }
        }
      }
      scene.background = null  // sky sphere provides the visual background
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
                    // Season-specific canonical skies — verified paths in
                    // ArtEnvironment.sga (see game-skybox-assets.md §4).
                    // These are tried first so a normal install always gets
                    // the best-matching sky without falling through the
                    // full chain.
                    const canonicalSkies =
                      season === 'winter'
                        ? ['cold_clear_day_00', 'cloudy_day_00']
                        : ['sun_day_clouds_00', 'sunny_day_clouds', 'cloudy_day_00', 'green_yellow_cloudy']
                    const langresIds =
                      season === 'winter'
                        ? ['langreskaya_winter', 'langres_winter']
                        : ['langreskaya', 'langres', 'langreskaya_summer']
                    tryEnvs.push(
                      ...canonicalSkies,
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
              try {
                return await proceduralSkybox(season)
              } catch (e) {
                console.warn('[viewport] proceduralSkybox failed, using plain colour', e)
                return null
              }
            })()
          }
          let cube: CubeTexture | null
          try {
            cube = await cubemapLoadingRef.current
          } finally {
            // Always clear the loading slot so a later desired-key change
            // can kick off a fresh load, even if the await threw.
            cubemapLoadingRef.current = null
          }
          // First arrival populates the ref; concurrent awaiters see it
          // already set and skip the assignment.
          if (cube && !cubemapRef.current) {
            cubemapRef.current = cube
            cubemapKeyRef.current = desiredKey
          } else if (!cube) {
            // Procedural fallback failed — sky sphere still provides the
            // visual background; no scene.background needed.
            needsRenderRef.current = true
          }
        }
        // Only apply if we're still on a cubemap preset.
        if (presetRef.current.background.kind === 'cubemap') {
          if (!cancelled && cubemapRef.current) {
            // scene.background stays null — the gradient sky sphere provides
            // the visible background.  We still bake a PMREM from the
            // cubemap so vehicle IBL / reflections use correct sky colours.
            if (rendererRef.current) {
              const pmremKey = `${preset.id}:${season}`
              const cached = pmremCache.get(pmremKey)
              if (cached) {
                envMapRef.current = cached
                scene.environment = cached
                ;(scene as { environmentIntensity?: number }).environmentIntensity = 0.55
              } else {
                // Dispose previous env only on a cache miss (new preset/season combo).
                if (envMapRef.current && !Array.from(pmremCache.values()).includes(envMapRef.current)) {
                  envMapRef.current.dispose()
                }
                envMapRef.current = null
                const pmrem = new PMREMGenerator(rendererRef.current)
                try {
                  const env = pmrem.fromCubemap(cubemapRef.current).texture
                  pmremCache.set(pmremKey, env)
                  envMapRef.current = env
                  scene.environment = env
                  // Raised from 0.3 → 0.4 to lift shadowed areas (e.g.
                  // Ostwind flak-gun cage) without reintroducing harsh
                  // specular. Vehicle materials clamp further down via
                  // per-material envMapIntensity (see below).
                  ;(scene as { environmentIntensity?: number }).environmentIntensity = 0.55
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
            }
            needsRenderRef.current = true
          } else if (!cubemapRef.current) {
            // No cubemap loaded yet — sky sphere is already visible (set
            // above before the async block); just ensure a render fires.
            needsRenderRef.current = true
          }
        }
        if (cancelled) return
        if (presetRef.current.background.kind === 'cubemap' && !cubemapRef.current) {
          if (rendererRef.current) {
            const pmremKey = `roomenv:${season}`
            const cached = pmremCache.get(pmremKey)
            if (cached) {
              envMapRef.current = cached
              scene.environment = cached
              ;(scene as { environmentIntensity?: number }).environmentIntensity = 0.3
            } else {
              if (envMapRef.current && !Array.from(pmremCache.values()).includes(envMapRef.current)) {
                envMapRef.current.dispose()
              }
              envMapRef.current = null
              const pmrem = new PMREMGenerator(rendererRef.current)
              try {
                pmrem.compileEquirectangularShader()
                const env = pmrem.fromScene(new RoomEnvironment()).texture
                pmremCache.set(pmremKey, env)
                envMapRef.current = env
                scene.environment = env
                ;(scene as { environmentIntensity?: number }).environmentIntensity = 0.3
              } catch (e) {
                console.warn('[viewport] RoomEnvironment PMREM bake failed, no IBL:', e)
              } finally { pmrem.dispose() }
            }
          }
          needsRenderRef.current = true
        }
      })()
      // scene.background is null; the gradient sky sphere (already made
      // visible above) covers the canvas so there's no flash of black.
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
    // warmupOnly: no vehicle to render — the headless Viewport exists solely
    // so buildVehicleIntoCache can be driven via preloadRef.
    if (warmupOnly) return
    if (!vehicle || !sceneRef.current) return
    let cancelled = false
    setErr(null)

    const run = async () => {
      console.log(`[viewport] heavy effect run() start — vehicle=${vehicle?.id} season=${showDestroyed}`)
      try {
        // Cache the locateArchives result by root identity to avoid 4 IPC
        // round-trips on every vehicle switch. Re-resolve only when root changes.
        if (!archivesHandleRef.current || archivesHandleRef.current.root !== root) {
          const resolved = await locateArchives(root)
          archivesHandleRef.current = { root, archives: resolved }
        }
        const archives = archivesHandleRef.current.archives
        console.log(`[viewport] locateArchives done: ${archives ? 'found (cached)' : 'null'}`)
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
        // Warm rgmArchiveCache with preloaded archives so the RGM search
        // below reuses already-opened SGAs (skipping fileStat + header IPC).
        const rgmArchiveCache = new Map<string, SgaArchive>()
        for (const sgaName of sgaCandidates) {
          const pre = getPreloadedArchive(sgaName)
          if (pre) rgmArchiveCache.set(sgaName, pre)
        }

        // ── Group cache hit — fast path ──────────────────────────────────────
        // Check pinned cache first, then LRU cache.
        const cachedEntry = pinnedVehicleCache.get(vehicle.id) ?? vehicleGroupCache.get(vehicle.id)
        if (cachedEntry) {
          // Only bump lastUsed for LRU entries (pinned entries have no eviction).
          if (!pinnedVehicleCache.has(vehicle.id)) cachedEntry.lastUsed = Date.now()
          const fastScene = sceneRef.current!
          const oldGroup = meshGroupRef.current
          if (oldGroup && oldGroup !== cachedEntry.group) {
            fastScene.remove(oldGroup)
            // Old group stays in cache if it is a cached vehicle;
            // only dispose if not in cache (i.e. evicted entry already cleaned up).
            const isStillCached =
              Array.from(vehicleGroupCache.values()).some(e => e.group === oldGroup) ||
              Array.from(pinnedVehicleCache.values()).some(e => e.group === oldGroup)
            if (!isStillCached) {
              disposeVehicleGroup({ group: oldGroup, baseDiffuse: null, normalTex: null,
                model: null, diffuseCanvas: null, submeshMap: null, lastUsed: 0 })
            }
          }
          fastScene.add(cachedEntry.group)
          meshGroupRef.current = cachedEntry.group
          if (cachedEntry.submeshMap) submeshMapsRef.current = cachedEntry.submeshMap
          // Restore baseDiffuse so the overlay-binding useEffect can rebind correctly.
          if (cachedEntry.baseDiffuse) {
            if (baseTextureRef.current && baseTextureRef.current !== cachedEntry.baseDiffuse) {
              baseTextureRef.current.dispose()
            }
            baseTextureRef.current = cachedEntry.baseDiffuse
          }
          onPartsLoaded?.(Array.from(cachedEntry.submeshMap?.keys() ?? []))
          if (cachedEntry.model) onModelLoaded?.(cachedEntry.model, cachedEntry.diffuseCanvas)
          setModelTick(t => t + 1)

          // On a vehicle SWITCH the pad and camera are intentionally left
          // UNTOUCHED: the ground pad stays a constant size for every vehicle
          // and the camera keeps the user's current orbit/zoom — switching
          // must not resize the pad or move the view. Both are set ONCE, on the
          // first vehicle, in the build path below. We only frame here in the
          // unlikely case the very first vehicle of the session landed in this
          // cache-hit path before the build path ever ran.
          {
            const cbox = new Box3().setFromObject(cachedEntry.group)
            const csize = cbox.getSize(new Vector3())
            vehicleSizeRef.current = csize.clone()
            if (!cameraFramedRef.current) {
              const ccenter = cbox.getCenter(new Vector3())
              // Group is centred by its area-weighted body centroid at X/Z=0,
              // so the orbit pivot is (0, midHeight, 0) — not the world bbox
              // centre (a long gun barrel offsets that toward the muzzle).
              const cTarget = new Vector3(0, ccenter.y, 0)
              if (controlsRef.current) {
                controlsRef.current.target.copy(cTarget)
                controlsRef.current.update()
              }
              if (cameraRef.current) {
                const FIXED_FRAME_RADIUS = 4.8
                const fovRad = (cameraRef.current.fov * Math.PI) / 180
                const dist = (FIXED_FRAME_RADIUS / Math.sin(fovRad / 2)) * 0.85
                const dir = new Vector3(1, 0.45, -1).normalize()
                cameraRef.current.position.copy(cTarget).addScaledVector(dir, dist)
                cameraRef.current.lookAt(cTarget)
                cameraRef.current.updateProjectionMatrix()
              }
              cameraFramedRef.current = true
            }
          }

          setLoading(false)
          needsRenderRef.current = true
          // Apply the CURRENT season to this cached/warmed group unconditionally.
          // A cached group may have been left in a stale season (e.g. winter
          // stamped in a prior pass), and the season useEffect skips the initial
          // mount — so without this the cache-hit fast path could render the
          // wrong season. Re-stamping summer is a cheap material map swap.
          applySeasonToGroup(cachedEntry.group, season)
            .catch(e => console.warn('[viewport] cache-hit season apply failed', e))
          return  // exit run() — no parse/decode/build needed
        }

        // Cache miss confirmed. Only show the loading overlay on the FIRST
        // ever build (cold connect, no model on screen yet). For vehicle
        // SWITCHES we keep the previous model visible and hot-swap it only
        // once the new one is built (see the deferred old-group removal after
        // scene.add below), so the user NEVER sees a spinner while browsing —
        // "no loading in the app except on the connect button".
        if (!meshGroupRef.current) setLoading(true)

        let rgmBytes: Uint8Array | null = null
        for (const sgaName of sgaCandidates) {
          try {
            let a: SgaArchive
            if (rgmArchiveCache.has(sgaName)) {
              a = rgmArchiveCache.get(sgaName)!
              console.log(`[viewport] rgm-search: ${sgaName} (preload cache hit)`)
            } else {
              console.log(`[viewport] rgm-search: getFileHandle(${sgaName})…`)
              const fh = await archives.getFileHandle(sgaName)
              console.log(`[viewport] rgm-search: getFile(${sgaName})…`)
              const file = await fh.getFile()
              console.log(`[viewport] rgm-search: SgaArchive.open(${sgaName})…`)
              a = await SgaArchive.open(file)
              rgmArchiveCache.set(sgaName, a)
              cacheArchive(sgaName, a)
            }
            console.log(`[viewport] rgm-search: readByPath(${sgaName})…`)
            const b = await a.readByPath(rgmPath(vehicle))
            if (b) {
              sga = a
              rgmBytes = b
              console.log(`[viewport] rgm found in ${sgaName}`)
              break
            }
          } catch (e) {
            console.log('[viewport] err on', sgaName, ':', String(e))
          }
        }
        if (!sga || !rgmBytes) {
          throw new Error(`Couldn't find ${rgmPath(vehicle)} in any of the loaded archives.`)
        }
        console.log(`[viewport] RGM found, parsing — vehicle=${vehicle?.id}`)
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
          // Non-standard diffuse basenames verified from CoH2 SGAs (2026-06):
          sherman_m4a3:     ['sherman_page', 'sherman_m4a3'],
          aec_armoured_car: ['aec_armouredcar_page', 'aec_armoured_car'],
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

        // Summer-path attempt list. Winter re-skinning is handled in place by
        // the season useEffect (applySeasonToGroup), not here — the heavy
        // model-load always builds the summer body diffuse.
        const allPaths = [...new Set([...tsetPaths, ...fallbackPaths])]

        // Open archives lazily but cache them — without this we re-open every
        // SGA (~50 MB+, TOC parse) for every path candidate, ballooning load
        // time to 30+ s for vehicles whose diffuse isn't in the RGM's home SGA.
        const archiveCache = new Map<string, SgaArchive>()
        const getArchive = async (name: string): Promise<SgaArchive | null> => {
          if (archiveCache.has(name)) return archiveCache.get(name)!
          // Check the module-level preload cache first — preloadCommonArchives/
          // preloadFaction already opened and parsed these SGAs; reusing them
          // skips the fileStat + header-read IPC calls on every item.
          const preloaded = getPreloadedArchive(name)
          if (preloaded) {
            archiveCache.set(name, preloaded)
            return preloaded
          }
          try {
            console.log(`[viewport] getArchive: opening ${name} (no preload cache hit)`)
            const t0 = Date.now()
            const fh = await archives.getFileHandle(name)
            const file = await fh.getFile()
            const a = await SgaArchive.open(file)
            console.log(`[viewport] getArchive: ${name} opened in ${Date.now()-t0}ms`)
            archiveCache.set(name, a)
            // Share back into preload cache for subsequent items
            cacheArchive(name, a)
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
            // Check module-level bytes cache first — avoids re-reading large
            // files (e.g. 2 MB winter skin RGTs) on subsequent items.
            const cached = getPreloadedBytes(p)
            if (cached) { console.log(`[viewport] findFirstReadable cache hit: ${p}`); return { bytes: cached, path: p } }
            const t0 = Date.now()
            const b = await a.readByPath(p)
            const dt = Date.now() - t0
            if (dt > 1000) console.log(`[viewport] readByPath(${p}) took ${dt}ms, got ${b ? b.byteLength : 'null'} bytes`)
            if (b) {
              cacheBytes(p, b)
              return { bytes: b, path: p }
            }
          }
          return null
        }
        let rgtBytes: Uint8Array | null = null
        const archivesToTry: { name: string; archive: SgaArchive }[] = [
          { name: 'rgm SGA', archive: sga },
        ]
        for (const sgaName of sgaCandidates) {
          console.log(`[viewport] opening ${sgaName}…`)
          const a = await getArchive(sgaName)
          console.log(`[viewport] ${sgaName}: ${a ? 'ok' : 'null'}`)
          if (a && a !== sga) archivesToTry.push({ name: sgaName, archive: a })
        }
        console.log(`[viewport] getArchive loop done, archivesToTry=${archivesToTry.length}`)
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
          // `(?:_[a-z0-9]+)*` is OPTIONAL so this matches the PLAIN
          // `treads_dif.rgt` / `tracks_dif.rgt` / `wheels_dif.rgt` basenames
          // too — not just the `treads_left_dif` multi-token form. The old
          // pattern required a token between `treads` and `_dif`, so a bare
          // `treads_dif.rgt` slipped through and bound to the hull (e.g. the
          // Ostwind, whose tsets carry NO id-matching `_dif`, sorted the short
          // `treads_dif` first → whole tank wrapped in the dark track texture
          // and looked "burnt out").
          !/(?:^|[_/])(treads?|wheels?|tracks?)(?:_[a-z0-9]+)*_dif\.rgt$/i.test(p)
        const bodyPaths = allPaths.filter(isBodyPath)
        // NOTE: the body diffuse is ALWAYS resolved as SUMMER here, even when
        // the user is on Winter. Winter re-skinning (body + turret + panel
        // atlases + frost) is applied uniformly afterwards by
        // applySeasonToGroup, which also keeps __summerMap correctly labelled
        // so a later Winter→Summer toggle restores the true summer atlas.
        // (Previously this block special-cased the winter body atlas, which
        // mislabelled __summerMap as winter and left turrets/skirts in summer.)
        if (!rgtBytes) {
          outerSummer: for (const { name: aName, archive: a } of archivesToTry) {
            console.log(`[viewport] summer search in ${aName}: ${bodyPaths.length} paths`)
            const hit = await findFirstReadable(a, bodyPaths)
            if (hit) {
              console.log(`[viewport] summer texture found: ${hit.path} in ${aName}`)
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
          console.log(`[viewport] decoding diffuse texture (${rgtBytes.byteLength} bytes)`)
          try {
            const t0 = Date.now()
            // Combined off-thread inflate + BC decode: only the cheap chunky
            // header parse runs on the main thread; the zlib inflate and BC
            // decode both happen in a worker (single round-trip).
            const header = parseRgtHeader(rgtBytes)
            const dec = await decodeRgtFullOffThread(header)
            const rgba = dec.rgba
            diffuseImage = document.createElement('canvas')
            diffuseImage.width = dec.width
            diffuseImage.height = dec.height
            const diffuseCtx = diffuseImage.getContext('2d')!
            diffuseCtx.putImageData(
              new ImageData(
                new Uint8ClampedArray(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer),
                dec.width,
                dec.height,
              ),
              0,
              0,
            )
            diffuse = new CanvasTexture(diffuseImage)
            console.log(`[viewport] diffuse decoded in ${Date.now()-t0}ms (worker)`)
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

        // Fast path — consume pre-built CompressedTexture from idle prefetch.
        const prefetchedNrm = prefetchedTextures.get(`${vehicle.id}:nrm`)
        if (prefetchedNrm) {
          normalTex = prefetchedNrm
        } else {
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
              normalTex = rgtToCompressedTexture(rgt)
              // rgtToCompressedTexture sets colorSpace = SRGBColorSpace by default;
              // override to NoColorSpace — normal maps must be sampled as linear data.
              normalTex.colorSpace = NoColorSpace
              // flipY=true is already set by rgtToCompressedTexture (CoH2 D3D UV convention).
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
        } // end else (no prefetched normal)
        if (cancelled) return

        const scene = sceneRef.current!
        // Capture the currently-displayed group but DON'T remove it yet. We
        // keep the previous vehicle on screen through the (possibly
        // multi-second) build of the new one so the viewport never goes blank
        // or shows a loading spinner on a switch. It is removed + disposed
        // immediately AFTER the new group is added to the scene (below).
        const oldGroup = meshGroupRef.current
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
          // Drop gameplay-variant overlays (Churchill mortar/AVRE/Crocodile,
          // hero-RGM crew "goblins") entirely — they belong to neither the
          // intact nor the wreck view, just clutter the base vehicle.
          if (isVariantMesh(matchTarget)) continue
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
          // Check bytes cache first
          const cached = getPreloadedBytes(candidate)
          if (cached) return cached
          const direct = await sga!.readByPath(candidate)
          if (direct) { cacheBytes(candidate, direct); return direct }
          for (const sgaName of sgaCandidates) {
            const a = await getArchive(sgaName)
            if (!a) continue
            const b = await a.readByPath(candidate)
            if (b) { cacheBytes(candidate, b); return b }
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
        // Off-thread path: inflate + BC decode both happen in a worker via
        // decodeRgtFullOffThread (same as the body diffuse at line 2906).
        // Only `putImageData` and — for gloss — the RGB inversion run on the
        // main thread, which is unavoidable (DOM canvas / pixel transform).
        // The previous synchronous path (pako.inflate + bcToCanvas on the main
        // thread) blocked for 20–60 ms per texture × 4 textures per material.
        const decodeTextureBytes = async (bytes: Uint8Array, role: TextureRole): Promise<Texture | null> => {
          try {
            const header = parseRgtHeader(bytes)
            const dec = await decodeRgtFullOffThread(header)
            const rgba = dec.rgba
            // For gloss: invert RGB channels so the texture works directly as
            // `roughnessMap` in Three.js (reads G channel).
            // CoH2 stores gloss as "1.0 = polished mirror, 0.0 = matte fabric";
            // Three.js expects roughness as "0.0 = mirror, 1.0 = matte".
            if (role === 'gloss') {
              for (let i = 0; i < rgba.length; i += 4) {
                rgba[i] = Math.max(26, 255 - rgba[i])         // R (clamp floor ≈ 0.10 roughness)
                rgba[i + 1] = Math.max(26, 255 - rgba[i + 1]) // G (the channel Three.js samples)
                rgba[i + 2] = Math.max(26, 255 - rgba[i + 2]) // B
                // alpha left intact
              }
            }
            const cv = document.createElement('canvas')
            cv.width = dec.width
            cv.height = dec.height
            const ctx = cv.getContext('2d')!
            ctx.putImageData(
              new ImageData(
                new Uint8ClampedArray(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer),
                dec.width,
                dec.height,
              ),
              0,
              0,
            )
            const t = new CanvasTexture(cv)
            // Must match the main body diffuse (line 541) and overlay texture
            // (line 919): flipY=true. UVs are stored with `v = 1 - v_orig` per
            // rgm.ts:412, and the canvas/PNG image data is top-down; flipY=true
            // is what makes those two conventions sample correctly together.
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
        // Schurzen / side-armour skirt meshes — these are bolt-on upgrade
        // panels and do not share the vehicle body diffuse. No dedicated
        // TSET exists for them in standard CoH2 packs so we leave them
        // untextured (Three.js default grey) rather than binding the wrong
        // body atlas. Recognised by name anywhere in the material string.
        const isSchurzenMesh = (name: string) =>
          /schurzen|skirt|side_armor|sidearmor/i.test(name)
        const tokenFor = (mat: string): string => {
          // Pull the distinguishing token from a material name.
          // `wreak` is Relic's in-file typo on several wreck materials
          // (m5a1_stuart_wreak, jagdtiger_wreak, …). Treat it as wreck
          // so the texture lookup routes to *_wreck_dif and the mesh
          // gets filtered as destroyed downstream.
          // `turrets` routing: StuG III has a separate `sug_iii_turrets`
          // material (Relic typo — missing 't') with its own atlas
          // `stug_iii_turrets_dif`. Without this branch both the hull
          // and turrets materials fall through to the body scan, which
          // finds both `stug_iii_dif` and `stug_iii_turrets_dif` as
          // candidates and lets whichever is first in the TSET array win
          // for both meshes — so one of them always gets the wrong atlas.
          if (/(?:^|_)turrets?(?:_|$)/i.test(mat)) return 'turrets'
          if (/wreck|wreak/i.test(mat)) return 'wreck'
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
          // Schurzen / skirt / side-armour: no body-diffuse fallback —
          // return a sentinel so the caller skips texture assignment.
          if (isSchurzenMesh(mat)) return 'schurzen'
          // `panels` routing: Brummbär has a separate `Brummbar_Panels`
          // material with its own atlas `brummbar_panels_dif`. Without
          // this branch both body meshes fall through to the body scan
          // and compete for the same `brummbar_dif`, stretching the
          // panels texture (authored for a different UV layout).
          if (/(?:^|_)panels?(?:_|$)/i.test(mat)) return 'panels'
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
            tokenRe('panels').test(p) ||
            tokenRe('turrets').test(p) ||
            /\/badges\//i.test(p) ||
            isSchurzenMesh(p)
          if (token === 'schurzen') {
            // Schurzen meshes have no dedicated TSET — leave all paths null
            // so the mesh renders with the Three.js default grey material
            // rather than the body diffuse.
            difPath = null
            nrmPath = null
            spcPath = null
            glsPath = null
          } else if (token) {
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
          const decodeYield = () => new Promise<void>(r => setTimeout(r, 0))
          if (difPath) {
            const b = await resolveRgtPath(difPath)
            if (b) dTex = await decodeTextureBytes(b, 'diffuse')
            await decodeYield()
          }
          if (nrmPath) {
            const b = await resolveRgtPath(nrmPath)
            if (b) nTex = await decodeTextureBytes(b, 'normal')
            await decodeYield()
          }
          if (spcPath) {
            const b = await resolveRgtPath(spcPath)
            if (b) sTex = await decodeTextureBytes(b, 'spec')
            await decodeYield()
          }
          if (glsPath) {
            const b = await resolveRgtPath(glsPath)
            if (b) gTex = await decodeTextureBytes(b, 'gloss')
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
          // Turret shares the body diffuse atlas (no dedicated tiger_turret_dif); its
          // UVs map into the body atlas, so fall back to body diffuse rather than the
          // flat olive fallback. Treads/wreck still stay null (their UVs tile).
          const sharesBodyAtlas = token === 'turrets'
          const result: MaterialTextures = {
            diffuse: dTex ?? ((isNonBody && !sharesBodyAtlas) ? null : (bodyCache?.diffuse ?? null)),
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
          const tex = await getTexturesForMaterial(sub.materialName ?? sub.name)
          if (cancelled) return
          const subDiffuse = tex.diffuse
          const subNormal = tex.normal
          const subSpec = tex.specular
          const subRoughness = tex.roughness
          // Fallback flat colour when no diffuse texture was bound. Picked
          // per material token so tracks don't render the same khaki as
          // the body — dark gunmetal looks like a track, khaki looks like
          // a hull-coloured smear.
          const subToken = tokenFor(sub.materialName ?? sub.name)
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
            envMapIntensity: 0.3,
            // CoH2 RGM submeshes have inconsistent winding — some panels
            // (Puma turret, Panther skirts) end up with their normals
            // facing inwards, rendering as solid black. DoubleSide makes
            // both faces lit, masking the broken winding.
            side: DoubleSide,
            // Tread/track submeshes share UV space with other geometry at
            // the same world position and z-fight without a polygon offset.
            // Push tread fragments slightly closer to the camera so they
            // win the depth test consistently against the hull floor.
            ...(subToken === 'tread' ? {
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            } : {}),
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
          // Season tagging — paintable atlases (body, turret, panels) get
          // re-skinned by applySeasonToGroup on Summer↔Winter toggle. Tread/
          // wheel/wreck atlases are season-invariant so stay untagged.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom season props on Three.js material
          ;(mat as any).__seasonPaint = subToken === '' || subToken === 'turrets' || subToken === 'panels'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(mat as any).__seasonToken = subToken
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(mat as any).__summerMap = subDiffuse
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

        // Season context for applySeasonToGroup — captures everything the
        // central re-skinner needs to resolve winter atlases lazily and rebind
        // them across vehicle switches (incl. warmed cache-hit copies).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom season props on Three.js Group
        ;(group as any).__seasonFaction = vehicle.faction
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(group as any).__seasonBases = bases
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(group as any).__seasonModel = model
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(group as any).__seasonPaintReady = true

        // Pre-resolve the winter atlas for the displayed vehicle too (the
        // warmup queue skips the current vehicle, so without this the very
        // first Summer↔Winter toggle would lazily fetch+decode and flash the
        // season beam). Fire-and-forget so it never delays first paint; it
        // only stamps __winterMap on the materials for an instant later swap.
        void prewarmWinterAtlases(group, vehicle.faction, bases)

        // Auto-fit: scale model so longest axis = ~5 units, centre it
        // horizontally, and rest its tracks ON the ground (bbox.min.y = 0).
        //
        // Fix: exclude helper/wreck/proxy/orphan meshes from the bounding-box
        // used for scale computation. On the Tiger I, Crushed_Mesh_*, orphan_*
        // and similar non-renderable helpers sit far from the tank origin and
        // inflate `longest` from ~7.5 to ~10.2, causing the tank to be scaled
        // to a sliver (scale ~0.49 instead of ~0.66). We still include all
        // children in the later finalBox so the ground-plane rest is correct.
        const HELPER_NAME_RE = /crushed|proxy|marker|wreck|destroy|spawn|orphan/i
        const fitChildren = group.children.filter(
          c => !HELPER_NAME_RE.test(c.name ?? ''),
        )
        const fitBox = new Box3()
        for (const c of fitChildren) fitBox.expandByObject(c)
        // Fall back to the full group box if all children are helpers.
        const box = fitBox.isEmpty() ? new Box3().setFromObject(group) : fitBox
        const size = box.getSize(new Vector3())
        const longest = Math.max(size.x, size.y, size.z)
        // TRUE 1:1 RELATIVE SCALE. RGM native units are ~metres, so a single
        // constant scale preserves real in-game size differences — a King
        // Tiger is genuinely longer than a StuG and should look it. The old
        // `5/longest` normalised every vehicle to the same on-screen length,
        // which made the King Tiger's long gun barrel eat the size budget and
        // left its hull looking SMALLER than tinier vehicles. 0.72 keeps the
        // StuG (native longest ≈6.91) looking ≈as it did before (its old
        // scale was 5/6.91 = 0.7237) while every other vehicle now scales
        // proportionally to it.
        const WORLD_SCALE = 0.72
        const scale = longest > 0.0001 ? WORLD_SCALE : 0.01
        group.scale.setScalar(scale)
        // Record the apparent size so the crew-loading effect can size
        // the soldier RGM proportionally (a soldier loaded at native
        // CoH2 scale would otherwise dwarf an auto-scaled vehicle).
        vehicleScaleRef.current = scale
        vehicleApparentLengthRef.current = longest * scale

        // ── Find the exact centre of the vehicle ────────────────────────
        // REQ-1: Use the XZ centre of the SAME debris-excluded fitBox that
        // drives the scale computation (above). This guarantees the model's
        // geometric centre lands at world X=0, Z=0 — exactly over the pad
        // centre — for every vehicle without skew from long gun barrels,
        // area-weighting bias, or body-mesh detection failures.
        //
        // The fitBox is in group-local pre-scale space. Multiplying its
        // centre by `scale` converts it to post-scale world-space (group
        // position is still (0,0,0) at this point, so local == world).
        const fitBoxCenter = box.getCenter(new Vector3())
        // World-space XZ centre after auto-scale is applied.
        const fitCenterX = fitBoxCenter.x * scale
        const fitCenterZ = fitBoxCenter.z * scale

        // Keep the area-weighted centroid only for the CAMERA TARGET Y
        // (so the orbit pivot sits at the hull's visual centre of mass,
        // not at the bbox midpoint which can be dragged upward by a tall
        // gun mantlet or downward by deep track skirts).
        const bodyMeshes = group.children.filter(
          c =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- checking custom __usesBodyDiffuse property set on Three.js materials above
            (c as any).material && (c as any).material.__usesBodyDiffuse,
        ) as Mesh[]
        const bodyMesh: Mesh | undefined = bodyMeshes[0]

        // Triangle-area-weighted body centroid (local pre-scale space).
        // Drives both the XZ pad-centring (below) and the camera-target Y.
        const centroidLocal = computeBodyCentroidLocal(group)
        // Scale centroid Y into post-scale world space (camera target pivot).
        const centroidWorldY = centroidLocal.y * scale

        // Recompute full bbox AFTER scaling so we know where the bottom
        // is (we want the lowest mesh — typically a track or skirt — to
        // rest on y=0, not the body's centroid).
        const scaledBox = new Box3().setFromObject(group)

        // Centre the vehicle's BODY centre-of-mass exactly over the pad centre
        // (world X=0, Z=0). We use the area-weighted body centroid rather than
        // the bounding-box centre because the bbox is fragile: a long gun
        // barrel (Tiger, Elefant) or any small outlying attachment (antenna,
        // tow cable, spare track) drags the box centre to one side, leaving the
        // hull visibly off-pad while the barrel overhangs the edge — which is
        // exactly the "Tiger isn't centred" report. Surface-area weighting
        // makes thin/small parts contribute little, so the heavy hull+turret
        // mass lands dead-centre for every vehicle. Falls back to the
        // debris-excluded fitBox centre only when no body mesh was detected.
        const centerX = centroidLocal.lengthSq() > 0 ? centroidLocal.x * scale : fitCenterX
        const centerZ = centroidLocal.lengthSq() > 0 ? centroidLocal.z * scale : fitCenterZ
        group.position.x = -centerX
        group.position.z = -centerZ
        group.position.y = -scaledBox.min.y

        if (cancelled) return

        // Add the group to the live scene FIRST so the vehicle appears and
        // OrbitControls stay responsive during shader/texture warmup.
        scene.add(group)

        // Hot-swap: now that the new vehicle is on screen, retire the previous
        // one. Deferring removal until here (rather than before the build) is
        // what lets a switch happen with zero blank frames and no spinner.
        if (oldGroup && oldGroup !== group) {
          scene.remove(oldGroup)
          // Only dispose geometry if the group is not held by either cache.
          const oldStillCached =
            Array.from(vehicleGroupCache.values()).some(e => e.group === oldGroup) ||
            Array.from(pinnedVehicleCache.values()).some(e => e.group === oldGroup)
          if (!oldStillCached) {
            oldGroup.traverse(o => {
              if ((o as Mesh).geometry) (o as Mesh).geometry.dispose()
            })
          }
        }

        // ── Shader & texture warmup (background) ────────────────────────────
        // Run compileAsync + initTexture AFTER scene.add so the user can orbit
        // immediately. Guard against the group being removed/cancelled before
        // the async compile resolves. compileAsync is a no-op if
        // KHR_parallel_shader_compile is unavailable (falls back to sync).
        if (rendererRef.current && cameraRef.current) {
          const renderer = rendererRef.current
          const camera = cameraRef.current
          const capturedGroup = group
          // Use queueMicrotask so this yields to the rAF loop first.
          queueMicrotask(async () => {
            if (cancelled) return
            // Check the group is still in the live scene (not evicted/replaced)
            if (!sceneRef.current?.children.includes(capturedGroup)) return
            const stagingScene = new Scene()
            stagingScene.environment = sceneRef.current?.environment ?? null
            stagingScene.add(capturedGroup)
            try {
              await renderer.compileAsync(stagingScene, camera)
            } catch (e) {
              console.warn('[viewport] compileAsync failed (non-fatal):', e)
            }
            stagingScene.remove(capturedGroup)
            // CRITICAL: stagingScene.add() above reparented the group OUT of the
            // live scene (an Object3D can only have one parent), and the remove()
            // just orphaned it. Re-attach to the live scene or the vehicle never
            // renders — it vanishes one microtask after scene.add(group) above.
            if (cancelled) return
            if (sceneRef.current && capturedGroup.parent !== sceneRef.current) {
              sceneRef.current.add(capturedGroup)
            }
            if (!sceneRef.current?.children.includes(capturedGroup)) return
            // Force synchronous GPU texture upload for all textures in the group.
            capturedGroup.traverse(o => {
              const mesh = o as Mesh
              if (!mesh.isMesh) return
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
              mats.forEach(m => {
                const mat = m as MeshStandardMaterial
                ;[mat.map, (mat as MeshPhysicalMaterial).normalMap,
                  (mat as MeshPhysicalMaterial).roughnessMap,
                  (mat as MeshPhysicalMaterial).metalnessMap]
                  .forEach(t => { if (t) renderer.initTexture(t) })
              })
            })
            needsRenderRef.current = true
          })
        }

        // Recentre orbit camera target on the model's actual centre so the
        // user orbits around the tank, not a hardcoded point in space.
        const finalBox = new Box3().setFromObject(group)
        const finalSize = finalBox.getSize(new Vector3())

        // ── CONSTANT ground pad ───────────────────────────────────────────
        // Every vehicle sits on the SAME pad size (scale 1 = SLAB_BASE_RADIUS,
        // sized to fit the largest vehicle). Previously the pad was fitted to
        // each vehicle's footprint, so it visibly resized on every switch — the
        // user wants the pad to stay consistent across all vehicles.
        const slabMesh = groundMeshRef.current
        if (slabMesh) {
          // Constant pad, reduced a quarter from the full base radius (0.75).
          slabMesh.scale.x = 0.75
          slabMesh.scale.z = 0.75
        }

        // Target the body's centroid Y (which gives the best orbit pivot),
        // at X/Z=0 (the pad centre, where the model is now guaranteed to sit).
        const finalCenter =
          bodyMesh && centroidLocal.lengthSq() > 0
            ? new Vector3(0, centroidWorldY + group.position.y, 0)
            : finalBox.getCenter(new Vector3())
        // Frame the camera ONCE — on the first vehicle of the session. Every
        // switch after that keeps the user's current orbit/zoom; the camera
        // must NOT jump when changing vehicles. FIXED framing: the distance is
        // computed from a CONSTANT reference radius (≈ half a King Tiger's
        // bounding-sphere diagonal, the largest vehicle), so the first vehicle
        // is consistently framed regardless of which one it is.
        if (!cameraFramedRef.current) {
          if (controlsRef.current) {
            controlsRef.current.target.copy(finalCenter)
            controlsRef.current.update()
          }
          if (cameraRef.current) {
            const FIXED_FRAME_RADIUS = 4.8
            const fovRad = (cameraRef.current.fov * Math.PI) / 180
            const dist = (FIXED_FRAME_RADIUS / Math.sin(fovRad / 2)) * 0.85
            // Slightly elevated 3/4 view. Z is NEGATIVE — CoH2 RGM vehicles
            // load with their front along -Z in world space, so a (+x,+y,-z)
            // camera looks at the front-right corner of the tank, the angle
            // that shows the most decal-relevant geometry (turret face,
            // glacis, mantlet, hull side) at once.
            const dir = new Vector3(1, 0.45, -1).normalize()
            cameraRef.current.position.copy(finalCenter).addScaledVector(dir, dist)
            cameraRef.current.lookAt(finalCenter)
            cameraRef.current.updateProjectionMatrix()
          }
          cameraFramedRef.current = true
        }
        meshGroupRef.current = group
        // Store in LRU cache. normalTex and diffuse captured from closure above.
        vehicleGroupCache.set(vehicle.id, {
          group,
          baseDiffuse: diffuse,
          normalTex: normalTex ?? null,
          model,
          diffuseCanvas: diffuseImage,
          submeshMap,
          lastUsed: Date.now(),
        })
        evictLruEntry()
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

        // Cold build while the user is on Winter: re-skin to winter (body +
        // turret + panel atlases + frost) BEFORE handing the base canvas to
        // the parent, so overlay compositing uses the winter base. With no
        // overlay active yet, applySeasonToGroup swaps maps directly and sets
        // baseTextureRef to the winter body texture.
        if (season === 'winter') {
          await applySeasonToGroup(group, 'winter')
          const wb = baseTextureRef.current?.image
          if (wb instanceof HTMLCanvasElement) diffuseImage = wb
        }
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
    }
    // `season` intentionally excluded — re-skinning Summer ↔ Winter is handled
    // in place by the separate season useEffect (applySeasonToGroup) rather
    // than tearing the whole mesh group down on every flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onModelLoaded/onPartsLoaded are parent callbacks not wrapped in useCallback (adding them would reload the whole mesh on every parent render); season is deliberately excluded (handled by the season useEffect); only vehicle?.id is read, not the full object
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
      // Anisotropic filtering: match all other diffuse textures (MAX_ANISO=16).
      // Without this the overlay defaults to anisotropy=1, which makes decals
      // and painted regions appear blurry/soft at grazing angles compared to
      // the underlying hull detail.
      overlayTexRef.current!.anisotropy = MAX_ANISO
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
      // B6: radial "unwrap" explosion. Build a LOCAL-space centre + size from
      // the submeshes' own geometry-bbox centroids (mesh.position ≈ 0 for
      // imported RGM, so geometry space == group-local space, which is the
      // space mesh.position offsets are applied in). The old code mixed this
      // geometry-local bboxCenter with the WORLD-space `vehicleCenter`, so the
      // radial directions were wrong and only the name-heuristic parts (treads
      // /wheels) moved while the hull stayed put.
      const localBox = new Box3()
      const partCenters = new Map<string, Vector3>()
      for (const [name, mesh] of map) {
        mesh.geometry.computeBoundingBox()
        const c = mesh.geometry.boundingBox!.getCenter(new Vector3())
        partCenters.set(name, c)
        localBox.expandByPoint(c)
      }
      const localCenter = localBox.getCenter(new Vector3())
      const localSize = localBox.getSize(new Vector3())

      for (const [name] of map) {
        const bboxCenter = partCenters.get(name)!
        const off = computeExplodeOffset(name, bboxCenter, localSize, vehicleId, localCenter)
        newTargets.set(name, off)
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
  // modelTick is bumped (setModelTick(t => t + 1)) at both the slow-path
  // load completion and the fast-path cache hit, so adding it here ensures
  // the effect re-runs after submeshMapsRef.current is fully populated.
  // Without it the effect fires synchronously during the async model load
  // with an empty/stale submeshMap and animates nothing.
  }, [selectedPart, explodeAll, vehicle, modelTick])

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

  // ── Faction-first vehicle preload ─────────────────────────────────────────
  // Builds a vehicle's Group + textures in the background and stores it in
  // `pinnedVehicleCache`, WITHOUT touching the displayed vehicle. Exposed to
  // Editor via `preloadRef` so the faction-first prefetch can fire from
  // onModelLoaded without needing internal Viewport state.
  //
  // Design choice: we duplicate the cache-miss build sequence from `run()`
  // rather than extracting a shared helper, because `run()` captures ≥15
  // closure variables (vehicle, season, sga, archiveCache, getArchive,
  // bodyPaths, candidates, …) that are scoped inside
  // the heavy load effect and cannot be referenced outside it without a
  // substantial refactor that risks the active-load path. The duplication is
  // self-contained inside this callback and does NOT touch any ref that
  // affects the live render (meshGroupRef, submeshMapsRef, baseTextureRef,
  // setLoading, setErr, setModelTick, onModelLoaded, onPartsLoaded, etc.).
  const buildVehicleIntoCache = useCallback(async (
    spec: VehicleSpec,
    targetSeason: 'summer' | 'winter',
    eager = false,
    cpuOnly = false,
  ): Promise<void> => {
    if (pinnedVehicleCache.has(spec.id) || vehicleGroupCache.has(spec.id)) return
    // cpuOnly mode (Connect-time warm): renderer not required for CPU phases.
    // Normal mode: require both renderer and camera (GPU compile phases need them).
    if (!cpuOnly && (!rendererRef.current || !cameraRef.current)) return
    if (!cameraRef.current) return

    // Interaction-aware gate: background preloads must never run their heavy
    // decode / GPU-upload / shader-compile work while the user is actively
    // orbiting the current vehicle. Park here until the camera has been idle
    // for IDLE_MS (or a hard ceiling elapses, so a fidgety user can't starve
    // the preload forever). Each heavy phase awaits this before proceeding.
    //
    // EAGER mode (post-Connect "prepare all vehicles" batch): skip the idle
    // gate entirely and build flat-out. The user is watching a progress
    // indicator during this phase, so brief jank is expected and acceptable —
    // the whole point is to warm EVERY vehicle as fast as possible so that
    // once it finishes, switching between vehicles is a pure cache hit with
    // zero loading. Idle-gating here was what starved warmup (a user who keeps
    // orbiting never lets it complete), which is exactly the "still loading on
    // switch" complaint this mode fixes.
    const IDLE_MS = 450
    const waitForIdle = async (): Promise<void> => {
      if (eager) return
      const ceiling = performance.now() + 8000
      while (
        performance.now() - lastInteractionRef.current < IDLE_MS &&
        performance.now() < ceiling
      ) {
        await new Promise<void>(r => setTimeout(r, 120))
      }
    }
    await waitForIdle()

    const archives = await locateArchives(root)
    if (!archives) return

    const sgaCandidates = [
      'ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga',
      'ArtGermanEF.sga', 'ArtSovietEF.sga', 'ArtAEF.sga', 'ArtAEFSkins.sga',
      'ArtBritish.sga', 'ArtWestGerman.sga',
    ]

    // Locate the RGM bytes
    let sga: SgaArchive | null = null
    let rgmBytes: Uint8Array | null = null
    const rgmArchiveCache = new Map<string, SgaArchive>()
    for (const sgaName of sgaCandidates) {
      const pre = getPreloadedArchive(sgaName)
      if (pre) rgmArchiveCache.set(sgaName, pre)
    }

    // Re-check after warm (race: another buildVehicleIntoCache completed meanwhile)
    if (pinnedVehicleCache.has(spec.id) || vehicleGroupCache.has(spec.id)) return

    for (const sgaName of sgaCandidates) {
      try {
        let a: SgaArchive
        if (rgmArchiveCache.has(sgaName)) {
          a = rgmArchiveCache.get(sgaName)!
        } else {
          const fh = await archives.getFileHandle(sgaName)
          const file = await fh.getFile()
          a = await SgaArchive.open(file)
          rgmArchiveCache.set(sgaName, a)
          cacheArchive(sgaName, a)
        }
        const b = await a.readByPath(rgmPath(spec))
        if (b) { sga = a; rgmBytes = b; break }
      } catch { /* continue */ }
    }
    if (!sga || !rgmBytes) return

    const model = parseRgm(rgmBytes)

    // ── Archive helper (mirrors run()) ─────────────────────────────────────
    const archiveCache = new Map<string, SgaArchive>()
    const getArchive = async (name: string): Promise<SgaArchive | null> => {
      if (archiveCache.has(name)) return archiveCache.get(name)!
      const preloaded = getPreloadedArchive(name)
      if (preloaded) { archiveCache.set(name, preloaded); return preloaded }
      try {
        const fh = await archives.getFileHandle(name)
        const file = await fh.getFile()
        const a = await SgaArchive.open(file)
        archiveCache.set(name, a)
        cacheArchive(name, a)
        return a
      } catch { return null }
    }

    // ── Texture path helpers (mirrors run()) ───────────────────────────────
    const lower = (s: string) => s.toLowerCase()
    const id = spec.id.toLowerCase()
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
    const bases = [spec.id, ...(aliases[spec.id] ?? [])].filter((v, i, a) => a.indexOf(v) === i)
    const dirCandidates = [spec.id, ...bases].map(d => `art/armies/${spec.faction}/vehicles/${d}/`)
    const candidates = model.textureSets
      .filter(t => !isDestroyedMesh(t) && /_dif$/i.test(t))
      .sort((a, b) => {
        const aMatch = lower(a).includes(id) ? 0 : 1
        const bMatch = lower(b).includes(id) ? 0 : 1
        if (aMatch !== bMatch) return aMatch - bMatch
        return a.length - b.length
      })
    const tsetPaths = candidates.map(c => c.replace(/\\/g, '/').toLowerCase() + '.rgt')
    const fallbackPaths = dirCandidates.flatMap(dirPath =>
      bases.flatMap(b => [
        `${dirPath}${b}_dif.rgt`, `${dirPath}${b}_hull_dif.rgt`, `${dirPath}${b}_default_dif.rgt`,
      ]),
    )

    const findWinterPathsInSga = (a: SgaArchive): string[] => {
      const all = a.list().map(f => f.path.toLowerCase())
      const factionRe = new RegExp(`^art/armies/${spec.faction.toLowerCase()}/vehicles/`)
      const hits: string[] = []
      for (const base of bases) {
        const baseLow = base.toLowerCase()
        const skinRe = new RegExp(
          `^art/armies/${spec.faction.toLowerCase()}/vehicles/[^/]+/skins/([^/]*winter[^/]*)/${baseLow}_dif\\.rgt$`,
        )
        const cs = all.filter(p => factionRe.test(p) && skinRe.test(p))
        cs.sort((p1, p2) => {
          const f1 = p1.match(skinRe)![1]; const f2 = p2.match(skinRe)![1]
          if (f1 === 'winter' && f2 !== 'winter') return -1
          if (f2 === 'winter' && f1 !== 'winter') return 1
          return f1.localeCompare(f2)
        })
        hits.push(...cs)
      }
      return hits
    }

    const isBodyPath = (p: string) =>
      !/\/(treads?|wheels?|tracks?)\//i.test(p) &&
      !/(?:^|_)(treads?|wheels?|tracks?)_[a-z0-9_]*_dif\.rgt$/i.test(p)
    const bodyPaths = [...new Set([...tsetPaths, ...fallbackPaths])].filter(isBodyPath)

    const findFirstReadable = async (
      a: SgaArchive, paths: string[],
    ): Promise<Uint8Array | null> => {
      for (const p of paths) {
        const cached = getPreloadedBytes(p)
        if (cached) return cached
        const b = await a.readByPath(p)
        if (b) { cacheBytes(p, b); return b }
      }
      return null
    }

    const archivesToTry: { archive: SgaArchive }[] = [{ archive: sga }]
    for (const sgaName of sgaCandidates) {
      const a = await getArchive(sgaName)
      if (a && a !== sga) archivesToTry.push({ archive: a })
    }

    // Re-check again after all the async archive opens — another call may
    // have completed while we were awaiting.
    if (pinnedVehicleCache.has(spec.id) || vehicleGroupCache.has(spec.id)) return

    let rgtBytes: Uint8Array | null = null
    if (targetSeason === 'winter') {
      outer: for (const { archive: a } of archivesToTry) {
        const winter = findWinterPathsInSga(a)
        const b = await findFirstReadable(a, winter)
        if (b) { rgtBytes = b; break outer }
      }
    }
    if (!rgtBytes) {
      outer2: for (const { archive: a } of archivesToTry) {
        const b = await findFirstReadable(a, bodyPaths)
        if (b) { rgtBytes = b; break outer2 }
      }
    }

    let diffuse: import('three').Texture | null = null
    let diffuseImage: HTMLCanvasElement | null = null
    if (rgtBytes) {
      try {
        await waitForIdle()
        // Combined off-thread inflate + BC decode: only the cheap chunky header
        // parse stays on the main thread; the ~3s zlib inflate AND the BC decode
        // run in a worker (single round-trip). See decodeRgtFullOffThread.
        const header = parseRgtHeader(rgtBytes)
        const dec = await decodeRgtFullOffThread(header)
        const rgba = dec.rgba
        diffuseImage = document.createElement('canvas')
        diffuseImage.width = dec.width
        diffuseImage.height = dec.height
        diffuseImage.getContext('2d')!.putImageData(
          new ImageData(
            new Uint8ClampedArray(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer),
            dec.width, dec.height,
          ), 0, 0,
        )
        diffuse = new CanvasTexture(diffuseImage)
        diffuse.flipY = true
        diffuse.colorSpace = SRGBColorSpace
        diffuse.wrapS = diffuse.wrapT = RepeatWrapping
        diffuse.anisotropy = MAX_ANISO
      } catch (e) {
        console.warn('[viewport:preload] diffuse decode failed:', e)
        try {
          const header = parseRgtHeader(rgtBytes)
          const dec = await decodeRgtFullOffThread(header)
          const cv = document.createElement('canvas')
          cv.width = dec.width
          cv.height = dec.height
          const ctx = cv.getContext('2d')!
          ctx.putImageData(
            new ImageData(
              new Uint8ClampedArray(dec.rgba.buffer.slice(dec.rgba.byteOffset, dec.rgba.byteOffset + dec.rgba.byteLength) as ArrayBuffer),
              dec.width, dec.height,
            ),
            0, 0,
          )
          diffuse = new CanvasTexture(cv)
          diffuse.flipY = true
          diffuse.colorSpace = SRGBColorSpace
          diffuse.wrapS = diffuse.wrapT = RepeatWrapping
          diffuse.anisotropy = MAX_ANISO
        } catch { /* silent */ }
      }
    }

    // Normal map
    let normalTex: import('three').Texture | null = null
    const nrmFallbackPaths = dirCandidates.flatMap(dirPath =>
      bases.flatMap(b => [
        `${dirPath}${b}_nrm.rgt`, `${dirPath}${b}_hull_nrm.rgt`,
        `${dirPath}${b}_norm.rgt`, `${dirPath}${b}_n.rgt`,
        `${dirPath}${b}_default_nrm.rgt`,
      ]),
    )
    const nrmTsetPaths = (model.textureSets ?? [])
      .filter(t => /_nrm$|_norm$/i.test(t) && !isDestroyedMesh(t))
      .map(t => t.replace(/\\/g, '/').toLowerCase() + '.rgt')
    const allNrmPaths = [...new Set([...nrmFallbackPaths, ...nrmTsetPaths])]
    const prefetchedNrm = prefetchedTextures.get(`${spec.id}:nrm`)
    if (prefetchedNrm) {
      normalTex = prefetchedNrm
    } else {
      outer3: for (const tryPath of allNrmPaths) {
        let bytes: Uint8Array | null = getPreloadedBytes(tryPath) ?? await sga.readByPath(tryPath)
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
            const header = parseRgtHeader(bytes)
            const dec = await decodeRgtFullOffThread(header)
            const cv = document.createElement('canvas')
            cv.width = dec.width
            cv.height = dec.height
            const ctx = cv.getContext('2d')!
            ctx.putImageData(
              new ImageData(
                new Uint8ClampedArray(dec.rgba.buffer.slice(dec.rgba.byteOffset, dec.rgba.byteOffset + dec.rgba.byteLength) as ArrayBuffer),
                dec.width, dec.height,
              ),
              0, 0,
            )
            normalTex = new CanvasTexture(cv)
            normalTex.colorSpace = NoColorSpace
            normalTex.flipY = true
            normalTex.wrapS = normalTex.wrapT = RepeatWrapping
            normalTex.anisotropy = MAX_ANISO
            break outer3
          } catch { /* continue */ }
        }
      }
    }

    // Build the Three.js Group (intact submeshes only, showDestroyed=false)
    await waitForIdle()
    const uniqueMeshes = dedupeByGeometry(dedupeSubmeshes(model.meshes))
    const intact: typeof model.meshes = []
    for (const sub of uniqueMeshes) {
      const t = `${sub.name} ${sub.materialName ?? ''}`
      if (isVariantMesh(t)) continue // drop variant/crew overlays (Churchill mortar/AVRE/croc, crew goblins)
      if (!isDestroyedMesh(t)) intact.push(sub)
    }
    if (intact.length === 0) return // unsupported mesh format — skip silently

    const texCache2 = new Map<string, { diffuse: import('three').Texture | null; normal: import('three').Texture | null; specular: import('three').Texture | null; roughness: import('three').Texture | null }>()
    if (diffuse) texCache2.set('__body__', { diffuse, normal: normalTex, specular: null, roughness: null })

    const tsetsLower = model.textureSets.map(t => t.replace(/\\/g, '/').toLowerCase())
    const findTset2 = (predicate: (p: string) => boolean): string | null => {
      for (const t of tsetsLower) if (predicate(t)) return t; return null
    }
    const isSchurzenMesh = (name: string) => /schurzen|skirt|side_armor|sidearmor/i.test(name)
    const tokenFor2 = (mat: string): string => {
      if (/(?:^|_)turrets?(?:_|$)/i.test(mat)) return 'turrets'
      if (/wreck|wreak/i.test(mat)) return 'wreck'
      if (/(?:^|[^a-z])(?:tread|track|wheel)s?(?![a-z])/i.test(mat)) return 'tread'
      if (isSchurzenMesh(mat)) return 'schurzen'
      if (/(?:^|_)panels?(?:_|$)/i.test(mat)) return 'panels'
      return ''
    }
    const tokenRe2 = (t: string) => {
      const suffix = t === 'wreck' ? '(?:s|ed)?' : 's?'
      return new RegExp(`(?:^|/|_)${t}${suffix}(?:_|/)`, 'i')
    }
    const isVariantPath2 = (p: string) =>
      tokenRe2('wreck').test(p) || tokenRe2('tread').test(p) || tokenRe2('track').test(p) ||
      tokenRe2('panels').test(p) || tokenRe2('turrets').test(p) || /\/badges\//i.test(p) || isSchurzenMesh(p)
    const resolveRgtPath2 = async (rawPath: string): Promise<Uint8Array | null> => {
      const norm = rawPath.replace(/\\/g, '/').toLowerCase()
      const candidate = norm.endsWith('.rgt') ? norm : `${norm}.rgt`
      const cached = getPreloadedBytes(candidate)
      if (cached) return cached
      const direct = await sga!.readByPath(candidate)
      if (direct) { cacheBytes(candidate, direct); return direct }
      for (const sgaName of sgaCandidates) {
        const a = await getArchive(sgaName)
        if (!a) continue
        const b = await a.readByPath(candidate)
        if (b) { cacheBytes(candidate, b); return b }
      }
      return null
    }
    const decodeTexBytes2 = async (bytes: Uint8Array, role: 'diffuse' | 'normal' | 'spec' | 'gloss'): Promise<import('three').Texture | null> => {
      try {
        // Combined off-thread inflate + BC decode (mirrors body-diffuse path):
        // only the cheap chunky header parse stays on the main thread.
        const header = parseRgtHeader(bytes)
        const dec = await decodeRgtFullOffThread(header)
        const rgba = dec.rgba
        const cv = document.createElement('canvas')
        cv.width = dec.width
        cv.height = dec.height
        const ctx = cv.getContext('2d')!
        if (role === 'gloss') {
          // Gloss inversion: roughness = max(26, 255 - gloss)
          const d = rgba
          for (let i = 0; i < d.length; i += 4) {
            d[i] = Math.max(26, 255 - d[i])
            d[i + 1] = Math.max(26, 255 - d[i + 1])
            d[i + 2] = Math.max(26, 255 - d[i + 2])
          }
        }
        ctx.putImageData(
          new ImageData(
            new Uint8ClampedArray(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer),
            dec.width, dec.height,
          ), 0, 0,
        )
        const t = new CanvasTexture(cv)
        t.flipY = true
        t.colorSpace = role === 'diffuse' ? SRGBColorSpace : NoColorSpace
        t.wrapS = t.wrapT = RepeatWrapping
        t.anisotropy = MAX_ANISO
        return t
      } catch { return null }
    }
    const getTexForMat2 = async (materialName: string | null) => {
      const cacheKey = materialName ?? '__body__'
      if (texCache2.has(cacheKey)) return texCache2.get(cacheKey)!
      const token = materialName ? tokenFor2(materialName) : ''
      let difPath: string | null; let nrmPath: string | null; let spcPath: string | null; let glsPath: string | null
      const notVariant2 = (p: string) => !isVariantPath2(p)
      const specId = spec.id.toLowerCase()
      if (token === 'schurzen') {
        difPath = nrmPath = spcPath = glsPath = null
      } else if (token) {
        const re = tokenRe2(token)
        difPath = findTset2(p => re.test(p) && /_dif$/.test(p))
        nrmPath = findTset2(p => re.test(p) && /_nrm$|_norm$/.test(p))
        spcPath = findTset2(p => re.test(p) && /_spc$/.test(p))
        glsPath = findTset2(p => re.test(p) && /_gls$/.test(p))
      } else {
        const isBody = (p: string) => /_dif$/.test(p) && notVariant2(p)
        const isBodyNrm = (p: string) => /_nrm$|_norm$/.test(p) && notVariant2(p)
        const isBodySpc = (p: string) => /_spc$/.test(p) && notVariant2(p)
        const isBodyGls = (p: string) => /_gls$/.test(p) && notVariant2(p)
        difPath = findTset2(p => isBody(p) && p.includes(specId)) ?? findTset2(isBody)
        nrmPath = findTset2(p => isBodyNrm(p) && p.includes(specId)) ?? findTset2(isBodyNrm)
        spcPath = findTset2(p => isBodySpc(p) && p.includes(specId)) ?? findTset2(isBodySpc)
        glsPath = findTset2(p => isBodyGls(p) && p.includes(specId)) ?? findTset2(isBodyGls)
      }
      // Resolve byte arrays for all four slots concurrently, then fire their
      // worker decodes concurrently via Promise.all so round-trips don't serialize.
      const [difBytes, nrmBytes, spcBytes, glsBytes] = await Promise.all([
        difPath ? resolveRgtPath2(difPath) : Promise.resolve(null),
        nrmPath ? resolveRgtPath2(nrmPath) : Promise.resolve(null),
        spcPath ? resolveRgtPath2(spcPath) : Promise.resolve(null),
        glsPath ? resolveRgtPath2(glsPath) : Promise.resolve(null),
      ])
      const [dTex, nTex, sTex, gTex] = await Promise.all([
        difBytes ? decodeTexBytes2(difBytes, 'diffuse') : Promise.resolve(null),
        nrmBytes ? decodeTexBytes2(nrmBytes, 'normal') : Promise.resolve(null),
        spcBytes ? decodeTexBytes2(spcBytes, 'spec') : Promise.resolve(null),
        glsBytes ? decodeTexBytes2(glsBytes, 'gloss') : Promise.resolve(null),
      ])
      const bodyCache2 = texCache2.get('__body__')
      const isNonBody = token !== ''
      // Turret shares the body diffuse atlas (e.g. Tiger I has no dedicated
      // tiger_turret_dif); its UVs map into the body atlas, so fall back to the
      // body diffuse rather than the flat olive (0x9aa18b) fallback. Treads /
      // wreck stay null (their UVs tile a small texture). MUST mirror the live
      // path (getTexturesForMaterial) — without it, warmed turrets render
      // untextured pale-green while the live build looks correct.
      const sharesBodyAtlas = token === 'turrets'
      const result = {
        diffuse: dTex ?? ((isNonBody && !sharesBodyAtlas) ? null : (bodyCache2?.diffuse ?? null)),
        normal: nTex ?? bodyCache2?.normal ?? null,
        specular: sTex ?? bodyCache2?.specular ?? null,
        roughness: gTex ?? bodyCache2?.roughness ?? null,
      }
      texCache2.set(cacheKey, result)
      return result
    }

    const group = new Group()
    const submeshMap = new Map<string, Mesh>()
    for (const sub of intact) {
      const tex = await getTexForMat2(sub.materialName ?? sub.name)
      const subToken = tokenFor2(sub.materialName ?? sub.name)
      const fallbackColor = subToken === 'tread' ? 0x2a2c2e : subToken === 'wreck' ? 0x3a342c : 0x9aa18b
      const mat = new MeshPhysicalMaterial({
        map: tex.diffuse,
        normalMap: tex.normal,
        roughnessMap: tex.roughness,
        specularIntensityMap: tex.specular,
        color: tex.diffuse ? 0xffffff : fallbackColor,
        metalness: 0,
        roughness: tex.roughness ? 1.0 : 0.55,
        specularIntensity: tex.specular ? 1.0 : 0.5,
        envMapIntensity: 0.3,
        side: DoubleSide,
        ...(subToken === 'tread' ? { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 } : {}),
      })
      if (tex.normal) mat.normalScale = new Vector2(1.0, -1.0)
      ;(mat as any).__usesBodyDiffuse = tokenFor2(sub.materialName ?? sub.name) === '' // eslint-disable-line @typescript-eslint/no-explicit-any
      // Season tagging — mirrors the live build path so warmed cache-hit
      // groups re-skin identically on Summer↔Winter toggle.
      ;(mat as any).__seasonPaint = subToken === '' || subToken === 'turrets' || subToken === 'panels' // eslint-disable-line @typescript-eslint/no-explicit-any
      ;(mat as any).__seasonToken = subToken // eslint-disable-line @typescript-eslint/no-explicit-any
      ;(mat as any).__summerMap = tex.diffuse // eslint-disable-line @typescript-eslint/no-explicit-any
      const m = new Mesh(sub.geometry, mat)
      m.name = sub.name
      m.castShadow = true
      m.receiveShadow = true
      group.add(m)
      submeshMap.set(sub.name, m)
    }

    // Season context (mirrors run()) so warmed groups re-skin on toggle.
    ;(group as any).__seasonFaction = spec.faction // eslint-disable-line @typescript-eslint/no-explicit-any
    ;(group as any).__seasonBases = bases // eslint-disable-line @typescript-eslint/no-explicit-any
    ;(group as any).__seasonModel = model // eslint-disable-line @typescript-eslint/no-explicit-any
    ;(group as any).__seasonPaintReady = true // eslint-disable-line @typescript-eslint/no-explicit-any

    // Auto-fit (mirrors run())
    const HELPER_NAME_RE_P = /crushed|proxy|marker|wreck|destroy|spawn|orphan/i
    const fitChildren = group.children.filter(c => !HELPER_NAME_RE_P.test(c.name ?? ''))
    const fitBox = new Box3()
    for (const c of fitChildren) fitBox.expandByObject(c)
    const box = fitBox.isEmpty() ? new Box3().setFromObject(group) : fitBox
    const size = box.getSize(new Vector3())
    const longest = Math.max(size.x, size.y, size.z)
    // TRUE 1:1 RELATIVE SCALE — MUST match the live build path (run()).
    // A warmed group is shown verbatim by the cache-hit fast path, which
    // does NOT re-scale; if this baked the old `5/longest` normalisation the
    // pre-built vehicles would display at the wrong size (every vehicle the
    // same on-screen length) and silently regress the B1 1:1 fix.
    const WORLD_SCALE = 0.72
    const scale = longest > 0.0001 ? WORLD_SCALE : 0.01
    group.scale.setScalar(scale)
    const scaledBox = new Box3().setFromObject(group)
    // Centre the area-weighted BODY centroid over the pad origin (X=0, Z=0)
    // and rest the lowest mesh on Y=0 — IDENTICAL to run(). Must use the same
    // centroid (not bbox centre) so warmed cache-hit copies sit on the pad the
    // same way freshly-built ones do; otherwise a long-gun vehicle (Tiger)
    // would render off-centre when shown from the pinned cache.
    const fitBoxCenter = box.getCenter(new Vector3())
    const centroidLocal = computeBodyCentroidLocal(group)
    const centerX = centroidLocal.lengthSq() > 0 ? centroidLocal.x * scale : fitBoxCenter.x * scale
    const centerZ = centroidLocal.lengthSq() > 0 ? centroidLocal.z * scale : fitBoxCenter.z * scale
    group.position.x = -centerX
    group.position.z = -centerZ
    group.position.y = -scaledBox.min.y

    // GPU warmup on a staging scene (no live scene touched). compileAsync +
    // initTexture are the single biggest main-thread janks in a preload, so
    // wait for the user to stop orbiting before kicking them off.
    //
    // cpuOnly: skip GPU steps entirely — these GL calls are bound to this
    // renderer's context and do NOT transfer to the editor's renderer, so
    // doing them here would waste main-thread time. The editor's renderer
    // will re-upload on first draw (cheap: decoded bytes already in JS heap).
    if (!cpuOnly) {
      await waitForIdle()
      const stagingScene = new Scene()
      stagingScene.add(group)
      try {
        await rendererRef.current!.compileAsync(stagingScene, cameraRef.current!)
      } catch (e) {
        console.warn('[viewport:preload] compileAsync failed (non-fatal):', e)
      }
      stagingScene.remove(group)
      group.traverse(o => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach(m => {
          const mat = m as MeshStandardMaterial
          ;[mat.map, (mat as MeshPhysicalMaterial).normalMap,
            (mat as MeshPhysicalMaterial).roughnessMap,
            (mat as MeshPhysicalMaterial).metalnessMap]
            .forEach(t => { if (t) rendererRef.current!.initTexture(t) })
        })
      })
    }

    // Final guard: another call may have completed while GPU warmup ran
    if (pinnedVehicleCache.has(spec.id) || vehicleGroupCache.has(spec.id)) {
      // Dispose the redundant group we just built
      disposeVehicleGroup({ group, baseDiffuse: null, normalTex: null, model: null, diffuseCanvas: null, submeshMap: null, lastUsed: 0 })
      return
    }

    pinnedVehicleCache.set(spec.id, {
      group,
      baseDiffuse: diffuse,
      normalTex: normalTex ?? null,
      model,
      diffuseCanvas: diffuseImage,
      submeshMap,
      lastUsed: Date.now(),
    })
    // Pre-resolve the winter atlas now (still behind the Connect circle) so the
    // first Summer↔Winter toggle for this vehicle is instant — no season beam.
    await prewarmWinterAtlases(group, spec.faction, bases)
    console.log(`[viewport:preload] pinned ${spec.id} (${spec.faction}) for instant swap`)
  }, [root, prewarmWinterAtlases])

  // Wire buildVehicleIntoCache to the preloadRef so Editor can call it
  useEffect(() => {
    if (!preloadRef) return
    preloadRef.current = buildVehicleIntoCache
    return () => { preloadRef.current = null }
  }, [preloadRef, buildVehicleIntoCache])

  // Wire faceDecalSide to faceDecalRef so Editor can call it after a decal
  // bake completes, snapping the camera to the right-side hull view so the
  // newly applied decal is immediately visible without orbiting.
  //
  // "Right side" in CoH2 RGM world space = camera at (+X, y, 0) looking toward
  // origin.  The hullSideRight UV rect is painted onto the vehicle's positive-X
  // face, so approaching from +X (dir = (-1, 0.3, 0) normalised) shows it.
  //
  // We keep the current controls.target Y so the camera pivots around the same
  // hull-centre height; only azimuth changes.  Distance is preserved from the
  // current camera radius so zoom is unchanged.  needsRender is flagged so the
  // frame fires without user input.
  useEffect(() => {
    if (!faceDecalRef) return
    const faceDecalSide = () => {
      const camera = cameraRef.current
      const controls = controlsRef.current
      if (!camera || !controls) return
      const target = controls.target.clone()
      // Current orbit radius — preserve user's zoom level
      const radius = camera.position.distanceTo(target)
      // Approach from +X at a slight elevation (0.3) so the upper hull panel
      // is in frame.  Z=0 so we're looking straight at the right side, not
      // at an angle.
      const dir = new Vector3(-1, 0.3, 0).normalize()
      camera.position.copy(target).addScaledVector(dir, radius)
      camera.lookAt(target)
      camera.updateProjectionMatrix()
      controls.update()
      needsRenderRef.current = true
    }
    faceDecalRef.current = faceDecalSide
    return () => { faceDecalRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- faceDecalRef is a stable ref; cameraRef/controlsRef/needsRenderRef are also stable refs never changing identity
  }, [faceDecalRef])

  // =========================================================================
  // Background GPU warm for Connect-warmed cache entries (editor mode only)
  // =========================================================================
  // When the fleet was warmed at Connect with cpuOnly=true, the cached Groups
  // carry no GPU state. On first draw Three.js re-uploads textures and
  // recompiles shaders synchronously, causing a brief hitch per vehicle switch.
  //
  // Fix: after the editor's renderer is live (modelTick > 0 = first model
  // loaded), run compileAsync over every cached Group that hasn't been GPU-
  // compiled by this renderer yet. compileAsync is ASYNC and non-blocking —
  // it does NOT stall the render loop or main thread between frames. We
  // throttle to a few entries per idle slot so the editor stays responsive.
  //
  // warmupOnly: skip — the headless Viewport's renderer is discarded; GPU
  //             state built here would not transfer to the editor anyway.
  useEffect(() => {
    if (warmupOnly) return
    if (modelTick === 0) return // renderer not ready yet
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!renderer || !camera) return

    let cancelled = false
    // Collect all groups that haven't been GPU-compiled by this renderer.
    // We mark compiled groups with a WeakSet keyed to the renderer instance
    // so we don't re-run on vehicle switch (modelTick bumps each load).
    const allEntries = [
      ...Array.from(pinnedVehicleCache.values()),
      ...Array.from(vehicleGroupCache.values()),
    ]
    const toWarm = allEntries.filter(e => !(e.group as { __gpuWarmed?: boolean }).__gpuWarmed)
    if (toWarm.length === 0) return

    const scheduleNext: (fn: () => void) => void =
      typeof requestIdleCallback === 'function'
        ? fn => requestIdleCallback(fn, { timeout: 1000 })
        : fn => window.setTimeout(fn, 16)

    let idx = 0
    const pump = () => {
      if (cancelled) return
      const entry = toWarm[idx++]
      if (!entry) return // all done
      const r = rendererRef.current
      const c = cameraRef.current
      if (!r || !c) return // renderer gone (unmounted)
      const staging = new Scene()
      staging.add(entry.group)
      r.compileAsync(staging, c).then(() => {
        if (!cancelled) {
          staging.remove(entry.group)
          // Mark so we don't re-compile on the next modelTick bump.
          ;(entry.group as { __gpuWarmed?: boolean }).__gpuWarmed = true
          scheduleNext(pump)
        }
      }).catch(() => {
        if (!cancelled) scheduleNext(pump)
      })
    }

    // Kick off up to 2 concurrent warm lanes.
    for (let i = 0; i < Math.min(2, toWarm.length); i++) scheduleNext(pump)

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once after first model load; modelTick dep intentional
  }, [warmupOnly, modelTick])

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
