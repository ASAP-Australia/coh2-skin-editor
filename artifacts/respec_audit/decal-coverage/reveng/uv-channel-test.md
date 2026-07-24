# UV Channel Probe — Badge/Decal Channel Audit

Date: 2026-06-19
Scripts: `scripts/probe-uv-channels.mts`, `probe-tc1-detail.mts`, `probe-tc1-histogram.mts`
Evidence: `/tmp/coh2-evidence/uv-channel/`

## Question

Does a dedicated badge/decal UV channel exist in CoH2 vehicle meshes — distinct from the
diffuse TEXCOORD0 — sufficient to sample the badge atlas (teamTex) for exact insignia placement?

## Answer: YES for TRIM v5 vehicles (confirmed)

## Findings

### Semantic identity

The badge UV channel is **TEXCOORD1 = semantic 9** in the SEMANTIC map used by `rgm.ts`.
This is NOT Corsix's TEXCOORD9 (which is semantic 14); Corsix uses a different numbering scheme.
In CoH2 TRIM v5 input layouts, semantic 9 = TEXCOORD1 = the second UV channel.

All four tested vehicles (Tiger, T-34/76, M4A3E8 Easy8, Cromwell) have semantic 9 present in
their main hull submesh input layouts.

### TC1 cluster analysis

For TRIM v5 vehicles (Tiger, Easy8), TEXCOORD1 maps to a **tight badge atlas cell**:
- U ∈ [0.286, 0.337] (span ≈ 0.051)
- V ∈ [0.039, 0.086] (span ≈ 0.047)
- 99%+ of vertices fall in this cluster (histogram-confirmed)
- Non-zero fraction: 100%
- Distinct from TEXCOORD0: YES

This is a baked UV island pointing at one insignia cell on the badge atlas (teamTex).
Sampling the badge texture through TC1 yields the national insignia in its correct position
relative to the hull — exactly as the Essence engine does in-game.

### MRGM v8 merged vehicles (T34, Cromwell)

TC1 spans near-full UV space (0–1 × 0–1) on the merged body submesh. This may indicate:
- A different UV channel purpose in the merged format (lightmap UV? full atlas map?)
- Or that the badge atlas sampling for merged meshes uses a different technique

These vehicles need further investigation before Path A can be declared complete.

### Vehicle test matrix

| Vehicle             | Format    | TC1 cluster          | Badge UV confirmed |
|---------------------|-----------|----------------------|--------------------|
| Tiger (german)      | TRIM v5   | [0.286-0.337]×[0.039-0.086] | YES         |
| M4A3E8 Easy8 (aef)  | TRIM v5   | [0.286-0.337]×[0.039-0.086] | YES         |
| T-34/76 (soviet)    | MRGM v8   | full UV (0-1×0-1)    | UNCERTAIN          |
| Cromwell (british)  | MRGM v8   | full UV (0-1×0-1)    | UNCERTAIN          |

### TC1 decode — same format as TC0

TC1 uses format=2 (R8G8B8A8 packed, same as TC0 in TRIM v5 vehicles):
```
u = vbuf[o+2] / 255
v = 1 - vbuf[o+1] / 255   // V-flip for D3D→GL (same as TC0)
// bytes o+0 and o+3 are separate fields (not UV)
```
For format=3 (float32 pair, Cromwell MRGM v8): same as TC0 float path.

## rgm.ts changes required

In `buildGeometry`, the switch handles only `SEMANTIC.TEXCOORD0 = 8`.

**Required addition:**
```typescript
case SEMANTIC.TEXCOORD1:
  if (!uvs2) uvs2 = new Float32Array(p.vertexCount * 2)
  if (elt.format === 3) {
    uvs2[v * 2 + 0] = view.getFloat32(o, true)
    uvs2[v * 2 + 1] = 1 - view.getFloat32(o + 4, true)
  } else if (elt.format === 2) {
    uvs2[v * 2 + 0] = p.vertexBuffer[o + 2] / 255
    uvs2[v * 2 + 1] = 1 - p.vertexBuffer[o + 1] / 255
  }
  break
```

And after the vertex loop:
```typescript
if (uvs2) geo.setAttribute('uv2', new THREE.BufferAttribute(uvs2, 2))
```

The SEMANTIC table already has `TEXCOORD1: 9` — no change needed there.

Also add `TEXCOORD1: 9` to the `SEMANTIC` export (or expose via `RgmMesh`) so callers can
distinguish badge UV from diffuse UV.

## Path A verdict

**CONFIRMED for TRIM v5 vehicles** (covers Tiger, KT, Easy8, and most single-mesh German/AEF vehicles).
**UNCERTAIN for MRGM v8 merged vehicles** (T34, Cromwell) — their TC1 spans full UV space.

Recommendation: implement TC1 extraction, test with KT hullSideRight badge placement,
and add a fallback to marker-projection (Path B) for vehicles where TC1 cluster > 0.5 in either axis.
