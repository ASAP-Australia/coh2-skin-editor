/**
 * uv-wireframe — extract the UV-space triangle wireframe of a vehicle's
 * BODY meshes for the texture editor's "unwrap" overlay.
 *
 * The Vehicle Texture Editor paints on the flat 2048² body diffuse atlas.
 * Without a guide the painter has no idea which atlas region maps to the
 * hull front, the engine deck, the side skirts, etc. This helper projects
 * the model's body geometry into UV space and returns the unique triangle
 * edges as flat line segments, so the editor can draw them on top of the
 * atlas — effectively "unwrapping" the vehicle onto its texture.
 *
 * Only BODY-atlas meshes are included. Tread / wheel / track / wreck atlases
 * tile their UVs (the same small texture repeats dozens of times), so their
 * UV islands would smear chaotically across the body atlas; turret / panel
 * meshes map into SEPARATE atlases (e.g. stug_iii_turrets_dif) and would land
 * in the wrong place on the body atlas. Both are excluded.
 *
 * Coordinate convention: the returned (x, y) are the raw geometry `uv`
 * attribute values (u, 1 - v_raw), matching how the diffuse texture is sampled
 * with flipY=true. A UV vertex therefore maps to atlas/canvas pixel
 * `(x * W, (1 - y) * H)` — the editor applies that flip when drawing.
 */
import type { RgmModel } from '@/lib/rgm'

/** Material names that do NOT paint onto the editable body diffuse atlas. */
const NON_BODY_RE =
  /tread|wheel|track|wreck|wreak|turret|panels?|schurzen|zimmerit|skirt|sidearmor|side_armor|applique|badge/i

/**
 * Build a flat Float32Array of UV line segments [x0,y0,x1,y1, …] (each value
 * in 0..1) for every unique triangle edge across the model's body meshes.
 * Returns an empty array when the model has no body geometry with UVs.
 */
export function extractBodyUvWireframe(model: RgmModel): Float32Array {
  const segs: number[] = []
  for (const mesh of model.meshes) {
    const mat = mesh.materialName ?? ''
    if (mat && NON_BODY_RE.test(mat)) continue
    const geo = mesh.geometry
    const uvAttr = geo.getAttribute('uv')
    if (!uvAttr) continue
    const uv = uvAttr.array as ArrayLike<number>
    const index = geo.getIndex()

    // Dedup shared edges within this mesh so we draw each seam once instead
    // of twice (two adjacent triangles share an edge).
    const seen = new Set<number>()
    const VCOUNT = uvAttr.count
    const edge = (i: number, j: number) => {
      const a = Math.min(i, j)
      const b = Math.max(i, j)
      const key = a * VCOUNT + b
      if (seen.has(key)) return
      seen.add(key)
      segs.push(uv[a * 2], uv[a * 2 + 1], uv[b * 2], uv[b * 2 + 1])
    }

    if (index) {
      const idx = index.array as ArrayLike<number>
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2]
        edge(a, b); edge(b, c); edge(c, a)
      }
    } else {
      // Non-indexed: every 3 consecutive vertices form a triangle.
      for (let v = 0; v + 2 < VCOUNT; v += 3) {
        edge(v, v + 1); edge(v + 1, v + 2); edge(v + 2, v)
      }
    }
  }
  return new Float32Array(segs)
}
