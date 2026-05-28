/**
 * Lightweight RGM loader for static scene props (HQ buildings, etc.).
 *
 * The vehicle loader in `Viewport.tsx` is heavily tuned for the editing
 * experience: normal/spec/gloss PBR maps, per-submesh material lookup,
 * intact/destroyed partitioning, decal overlay binding. None of that
 * matters for a backdrop HQ at 8 m distance behind fog.
 *
 * This module loads:
 *   1. The RGM bytes (from preload cache → fall back to scanning common
 *      structure-bearing SGAs).
 *   2. The first plausible diffuse RGT (textureSet ending `_dif`, falling
 *      back to `<basename>_dif.rgt` next to the RGM).
 *   3. Builds a `Group` of textured `MeshStandardMaterial` submeshes,
 *      with destroyed/wreck variants filtered out.
 *
 * No normal maps, no per-submesh material binding — just a clean static
 * silhouette. If the diffuse fails to load we fall back to a flat
 * faction-neutral grey so the prop is still visible.
 */

import {
  Group,
  Mesh,
  MeshStandardMaterial,
  CanvasTexture,
  Box3,
  Vector3,
  SRGBColorSpace,
  RepeatWrapping,
  DoubleSide,
  type Texture,
} from 'three'
import { SgaArchive } from './sga'
import { parseRgm } from './rgm'
import { decodeRgt } from './rgt'
import { bcToCanvas } from './bc-decode'
import { locateArchives } from './coh2-fs'
import { getPreloadedArchive, getPreloadedBytes, cacheArchive } from './preload'

/** SGAs likely to contain structure RGMs across all factions. Same list
 *  used by `preload.ts` minus the lobby/badge-only archive — order picks
 *  the densest SGAs first to minimise per-call SGA opens. */
const STRUCTURE_SGAS = [
  'ArtHigh.sga',
  'ArtHighXP1.sga',
  'ArtHighXP2.sga',
  'ArtArmies.sga',
  'ArtGermanEF.sga',
  'ArtSovietEF.sga',
  'ArtAEF.sga',
  'ArtBritish.sga',
  'ArtWestGerman.sga',
]

/** Patterns that flag a submesh as a destroyed/wreck/proxy variant — we
 *  drop these from the static prop so the silhouette stays clean. Mirrors
 *  the patterns in Viewport.tsx but kept local so the modules don't have
 *  a tight coupling. */
const SKIP_PATTERNS = [
  /destroy/i,
  /wreck/i,
  /destruction/i,
  /burnt/i,
  /broken/i,
  /\bdmg\b/i,
  /_dam_/i,
  /\bproxy\b/i,
  /\bcollision\b/i,
  /\bphys(?:ics)?\b/i,
  /\bshadow\b/i,
  /\bocclus(?:ion|der)\b/i,
  /\bremains\b/i,
  /\bcrater\b/i,
]
function shouldSkip(name: string): boolean {
  return SKIP_PATTERNS.some(re => re.test(name))
}

export interface LoadedStructure {
  /** Ready-to-add scene group. Caller positions/rotates as needed. */
  group: Group
  /** Approximate axis-aligned bounding-box dimensions in world units —
   *  useful if the caller wants to drop the prop on the ground plane. */
  size: { x: number; y: number; z: number }
}

/**
 * Load a single CoH2 structure RGM (HQ, supply tent, etc.) and return a
 * positioned `Group`. Throws on unrecoverable failure (file missing
 * or parse error) so the caller can decide whether to fall back to a
 * placeholder or just skip the prop.
 *
 * @param root        the user's CoH2 install handle
 * @param rgmPath     SGA-relative path, lower-cased
 *                    (e.g. `art/armies/german/structures/command_post/command_post.rgm`)
 */
export async function loadStructure(
  root: FileSystemDirectoryHandle,
  rgmPath: string,
): Promise<LoadedStructure> {
  const path = rgmPath.toLowerCase()

  // 1. RGM bytes — preload cache first, then scan SGAs.
  let rgmBytes: Uint8Array | null = getPreloadedBytes(path)
  let homeArchive: SgaArchive | null = null
  if (!rgmBytes) {
    const archives = await locateArchives(root)
    if (!archives) throw new Error('Archives folder not found.')
    for (const sgaName of STRUCTURE_SGAS) {
      const cached = getPreloadedArchive(sgaName)
      let a: SgaArchive | null = cached
      if (!a) {
        try {
          const fh = await archives.getFileHandle(sgaName)
          const file = await fh.getFile()
          a = await SgaArchive.open(file)
          cacheArchive(sgaName, a)
        } catch {
          continue
        }
      }
      try {
        const b = await a.readByPath(path)
        if (b) {
          rgmBytes = b
          homeArchive = a
          break
        }
      } catch {
        /* try next */
      }
    }
  }
  if (!rgmBytes) throw new Error(`structure RGM not found: ${path}`)

  // 2. Parse mesh.
  const model = parseRgm(rgmBytes)

  // 3. Diffuse RGT — try every `_dif`-suffixed textureSet, then fall back
  //    to <dir>/<basename>_dif.rgt. Search the home SGA first, then any
  //    cached structure SGA.
  const diffuseTexture = await loadDiffuse(root, path, model.textureSets, homeArchive)

  // 4. Build the group. One Mesh per submesh, sharing the diffuse material
  //    (cheap — they all share the same atlas in CoH2 building RGMs).
  const group = new Group()
  group.name = `structure:${path}`

  const baseColor = diffuseTexture ? 0xffffff : 0x6a6660
  const material = new MeshStandardMaterial({
    map: diffuseTexture,
    color: baseColor,
    metalness: 0.05,
    roughness: 0.85,
    // CoH2 foliage RGMs use BC3 (DXT5) leaf cards: opaque RGB inside the
    // leaf silhouette, alpha=0 outside. Without alphaTest the canopy
    // renders as flat dark polygons (the empty card area). 0.5 is the
    // standard cutout threshold and is harmless on solid-alpha textures
    // (every texel passes). transparent stays false so depth sort still
    // works for opaque foliage cards.
    alphaTest: 0.5,
    transparent: false,
    // Foliage cards and many CoH2 building submeshes have inconsistent
    // winding; double-side keeps both faces visible without the user
    // seeing missing-back-face holes when orbiting.
    side: DoubleSide,
  })

  let added = 0
  for (const sub of model.meshes) {
    if (shouldSkip(`${sub.name} ${sub.materialName ?? ''}`)) continue
    const mesh = new Mesh(sub.geometry, material)
    mesh.name = sub.name
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    added++
  }

  // Some structure RGMs only ship destroyed/proxy variants — fall back
  // to rendering everything if the filter dropped everything.
  if (added === 0) {
    for (const sub of model.meshes) {
      const mesh = new Mesh(sub.geometry, material)
      mesh.name = sub.name
      group.add(mesh)
    }
  }

  // 5. Compute bounding box for the caller. Done after construction so
  //    we account for the whole assembled silhouette.
  const box = new Box3().setFromObject(group)
  const size = new Vector3()
  box.getSize(size)

  return {
    group,
    size: { x: size.x, y: size.y, z: size.z },
  }
}

/** Resolve and decode the structure's primary diffuse texture. Returns
 *  null on any failure — the caller falls back to the flat baseColor. */
async function loadDiffuse(
  root: FileSystemDirectoryHandle,
  rgmPath: string,
  textureSets: readonly string[],
  homeArchive: SgaArchive | null,
): Promise<Texture | null> {
  // 1. Build candidate paths.
  const dir = rgmPath.substring(0, rgmPath.lastIndexOf('/') + 1)
  const baseName = rgmPath.substring(rgmPath.lastIndexOf('/') + 1).replace(/\.rgm$/i, '')
  const tsetPaths = textureSets
    .map(t => t.replace(/\\/g, '/').toLowerCase())
    .filter(t => /_dif$/.test(t))
    .map(t => (t.endsWith('.rgt') ? t : t + '.rgt'))
  const fallbackPaths = [`${dir}${baseName}_dif.rgt`, `${dir}${baseName}_default_dif.rgt`]
  const allPaths = [...new Set([...tsetPaths, ...fallbackPaths])]

  // 2. Search home archive first, then preloaded SGAs, then anything we
  //    can open lazily.
  const archives = await locateArchives(root).catch(() => null)
  const tryArchive = async (a: SgaArchive, p: string) => {
    try {
      return await a.readByPath(p)
    } catch {
      return null
    }
  }

  for (const p of allPaths) {
    if (homeArchive) {
      const b = await tryArchive(homeArchive, p)
      if (b) return decodeToTexture(b)
    }
    for (const sgaName of STRUCTURE_SGAS) {
      let a = getPreloadedArchive(sgaName)
      if (!a && archives) {
        try {
          const fh = await archives.getFileHandle(sgaName)
          const file = await fh.getFile()
          a = await SgaArchive.open(file)
          cacheArchive(sgaName, a)
        } catch {
          continue
        }
      }
      if (!a) continue
      const b = await tryArchive(a, p)
      if (b) return decodeToTexture(b)
    }
  }
  return null
}

/** Decode RGT bytes into a Three.js sRGB texture. Returns null on
 *  decode failure (most commonly an unsupported BCn variant). */
function decodeToTexture(bytes: Uint8Array): Texture | null {
  try {
    const rgt = decodeRgt(bytes)
    const cv = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
    const t = new CanvasTexture(cv)
    // Match the vehicle pipeline's invariant — UVs are stored as
    // (u, 1 - v_orig) per rgm.ts, so flipY=true samples correctly.
    t.flipY = true
    t.colorSpace = SRGBColorSpace
    t.wrapS = t.wrapT = RepeatWrapping
    t.anisotropy = 4
    return t
  } catch (e) {
    console.warn('[structure-loader] diffuse decode failed:', (e as Error).message)
    return null
  }
}
