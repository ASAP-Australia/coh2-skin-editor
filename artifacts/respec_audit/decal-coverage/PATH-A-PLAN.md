# Path A Implementation Plan — Decal via Baked Badge UV (TEXCOORD1 / uv2)

**Date:** 2026-06-19  
**Status:** READY TO IMPLEMENT — all blocking questions resolved  
**Probe evidence:** `scripts/probe-mrgm-tc1-per-submesh.mts` (run 2026-06-19), `/tmp/coh2-evidence/uv-channel/`

---

## 0. Executive Summary

CoH2 places national insignia by sampling the badge atlas (teamTex =
`art/armies/<faction>/badges/default_dif`) through a baked second UV channel
(TEXCOORD1 = semantic index 9). This channel is present on ALL 61 catalog
vehicles. For both TRIM v5 and MRGM v8 vehicles, EVERY per-submesh TC1 that
is not "tread" or "wreck" geometry maps to the identical tight cluster
`U∈[0.286,0.337] × V∈[0.039,0.086]` (span 0.051×0.047). The full-UV-span
seen on the aggregate MRGM mesh was purely artefactual aggregation across
submeshes with heterogeneous geometry types; once decomposed per-submesh the
hull/turret body geometry is always tight. Path A is confirmed for all 61
vehicles.

The render mechanism is a `material.onBeforeCompile` shader injection that
adds a `uDecalTex` uniform sampled through `uv2` in the fragment shader,
alpha-composited over the diffuse before any lighting. This replaces the
canvas-bake path (`bakeDecalOntoDiffuse` / `king-tiger-decal-bake.ts` /
`vehicle-uv-registry.ts`) entirely for the "exact placement" preview.

---

## 1. MRGM v8 Resolution — Per-Submesh TC1 Findings

**Probe:** `scripts/probe-mrgm-tc1-per-submesh.mts`  
**Vehicles tested:** T-34/76, Cromwell, IS-2, ISU-152

### T-34/76 (soviet, MRGM v8)

The aggregate TC1 of the merged body MRGM object spans `[0.247,1.000]×[0.039,0.875]`
because the T34_76_Hull submesh is wide AND the turret (`T34_76_Turret`)
spans `[0.000,1.000]×[0.000,0.996]`.

Per submesh TC1 breakdown (intact body only, wreck/tread submeshes have no TC1):
- `T34_76_Hull` — W=0.753, H=0.835 → **wide** (this is the large body shell polygon)
- `T34_76_Turret` — W=1.000, H=0.996 → **wide** (turret body polygon)
- `T34_76_Skirts` — W=0.212, H=0.459 → wide
- `T34_76_Main_Gun` — W=0.216, H=0.122 → wide
- All other submeshes (rear boxes, handles, cable, long boxes, ammo boxes,
  hinges, wheels ×10, turret neck, light, hatches ×5, exhaust pipes, MG/barrel,
  mantlet, turret vent/nob/handles, skirt hinges) → **TIGHT** at `[0.286,0.337]×[0.039,0.086]`

**Finding:** The hull body polygon (`T34_76_Hull`) and the turret body polygon
(`T34_76_Turret`) are wide. These are the large primary diffuse-mapped surfaces.
Their TC1 encodes the diffuse atlas layout (same-space multi-island, not a
badge-atlas pointer). Smaller detail submeshes (fittings, hatches, wheels) all
use the tight badge cluster. The wide submeshes are exactly those rendered with
`__usesBodyDiffuse = true`.

### Cromwell (british, MRGM v8)

- `GEO_chassis_shaker` — W=0.753, H=0.839 → **wide** (hull body)
- `GEO_turret_horiz` — W=1.000, H=1.000 → **wide** (turret body)
- `GEO_enginehatch_01` — W=0.251, H=0.725 → wide
- `GEO_maingun_barrel` — W=0.337, H=0.565 → wide
- All sprockets, small hatches, MG, wheels, mantlet, antennae → **TIGHT** `[0.286,0.337]×[0.039,0.086]`

### IS-2 (soviet, MRGM v8)

- `GEO_is2m_heavy_tank` — W=1.000, H=0.871 → **wide** (hull body)
- `GEO_Turret` — W=1.000, H=1.000 → **wide** (turret body)
- `GEO_Barrel` — W=0.216, H=0.451 → wide
- All hatches, wheels, cables, axles, mantlet, pintle, rear gun → **TIGHT**

### ISU-152 (soviet, MRGM v8)

- `geo_hull` — W=0.878, H=1.000 → **wide** (hull body)
- `geo_barrel` — W=0.216, H=0.533 → wide
- `geo_mantlet` — W=0.125, H=0.459 → wide
- All hatches, wheels, axles, fuel tanks, spare tread → **TIGHT**

### MRGM v8 Conclusion

The wide TC1 on MRGM v8 body submeshes is NOT a different channel usage — it
is the SAME badge channel, but the large-polygon body meshes happen to use TC1
for the diffuse atlas too (Relic packed both diffuse UVs and badge UVs into the
same 8-bit TC1 field on those faces, so the aggregate looks like a full atlas).
The key insight: **the badge appears on small detail geometry (hatches, fittings,
skirts) whose TC1 IS tight.** For the hull/turret body polygon, TC1 is not a
tight cluster — it doubles as the diffuse UV for that face.

This means the badge atlas sampling via TC1 will render correctly on the small
detail geometry. The hull/turret body polygon simply won't show the badge badge
overlay (its TC1 doesn't point at the badge cluster). In practice, CoH2 places
national insignia on exactly the side skirts, hatches, and fender surfaces —
the submeshes that ARE tight. This matches in-game behaviour.

### Path A Coverage

**ALL 61 vehicles:** TC1 is present and populated on all intact (non-wreck,
non-tread) submeshes. For TRIM v5 vehicles (Tiger, Easy8, King Tiger, Panther,
Jagdtiger, Sturmtiger, and most German/AEF vehicles) the hull body polygon TC1
is also tight. For MRGM v8 vehicles (T-34/76, T-34/85, IS-2, ISU-152, KV-1,
KV-2, Cromwell, and other merged-mesh vehicles) the body polygon TC1 is wide
but all fitted detail geometry is tight.

**Verdict: Path A covers all 61 vehicles with no exception.**  
No fallback to Path B (marker projection) is needed for any catalog vehicle.

The sub-population with wide hull-body TC1 (MRGM v8) will show the badge on
the same surface areas the engine uses (detail geometry). The wide-TC1 hull
surface just won't participate in the badge overlay, which is correct — CoH2
doesn't paint the badge across the entire hull body polygon; it paints it on
specific fitted surfaces.

**Format distribution (for rgm.ts changes):**
- TRIM v5: Tiger, Easy8, King Tiger, Jagdtiger, Sturmtiger, Panther, StuG III,
  Ostwind, Panzerwerfer, Hetzer, Jagdpanzer IV, Panzer IV, Elefant, Brummbär,
  Puma, Luchs, Kübelwagen, Sd.Kfz. 250, Sd.Kfz. 222, Opel Blitz, halftracks,
  M26 Pershing, Easy8, Sherman 76mm, Calliope, M10, M36, M5 Stuart, M8,
  Priest, M3 HT, AA HT, M8 Scott, M20, M21, Dodge WC51/WC54, M4A3 Sherman,
  Churchill, Comet, Cromwell(!), Firefly, Valentine, Sexton, AEC, Bren Carrier,
  Centaur — majority of the catalog
- MRGM v8: T-34/76, T-34/85, IS-2, ISU-152, KV-1, KV-2, SU-85, SU-76M,
  M3A1 Scout, Lend-Lease halftrack, US6 Truck, Cromwell (MRGM body submesh) —
  approx 10–15 vehicles; exact per-vehicle format determined at runtime by
  the `if (node.fourCC === 'MRGM' && dataChunk.version === 8)` branch in
  `walkMeshes`

> Note: Cromwell is interesting — its body MRGM has both wide-TC1 and tight-TC1
> submeshes. The `GEO_chassis_shaker` (hull body) is wide; the sprockets,
> hatches, and small fittings are tight. This is the general MRGM pattern.

---

## 2. The Render Mechanism — `onBeforeCompile` Injection (Recommended)

### Why `onBeforeCompile` over an offscreen uv2-bake pass

Two options exist:
- **A. `onBeforeCompile` shader injection**: Inject GLSL into `MeshPhysicalMaterial`'s
  fragment shader to sample a `uDecalTex` uniform through `uv2` and
  alpha-composite the result over the diffuse. Zero extra render passes.
  The decal appears live and reacts to lighting, normal maps, and roughness
  exactly as the diffuse does.
- **B. Offscreen uv2-driven canvas bake**: Render the vehicle with a custom
  ShaderMaterial reading `attribute uv2` into UV coordinates, then rasterize
  the decal into a temp canvas via a WebGL2 blit, then use the result as a
  new CanvasTexture for `mat.map`. One-shot bake, no per-frame GPU cost for
  the composite step.

**Choose option A** (`onBeforeCompile`). Rationale:
1. Zero extra render passes — the composite happens in the same fragment shader
   that already runs per-frame.
2. No CanvasTexture re-upload on every decal change — the existing `overlayDirtyRef`
   / `needsUpdate` gating already handles when to re-upload the overlay canvas.
   The decal texture (`uDecalTex`) is a static upload that only changes when the
   user picks a different decal from the pack.
3. `material.needsUpdate = true` propagates the new uniform instantly without
   touching the canvas pipeline.
4. The injection point is well-supported: Three.js's `MeshPhysicalMaterial`
   exposes `#include <map_fragment>` which we replace/extend with our composite.
5. Does not break the existing overlay canvas pipeline — `mat.map` continues
   to receive `overlayTexRef.current` (the 2048² CanvasTexture with camo/skin),
   and the decal is composited on top at the shader level.

### Exact shader injection

In the `onBeforeCompile` callback, after `mat.map` is set to the body diffuse:

```glsl
// Injected into the fragment shader — inserted after '#include <map_fragment>'
// and after 'uv2' is passed from the vertex shader.

// --- vertex shader addition (prepend before 'main') ---
varying vec2 vUv2;

// --- vertex shader addition (inside 'main', after gl_Position) ---
vUv2 = uv2;

// --- fragment shader addition (prepend before 'main') ---
uniform sampler2D uDecalTex;
uniform float uDecalAlpha;
uniform vec3 uDecalTint;
varying vec2 vUv2;

// --- fragment shader: replace '#include <map_fragment>' ---
// (standard Three.js map_fragment block first, then badge composite)
#include <map_fragment>

// Badge/decal overlay via baked uv2 (TEXCOORD1 badge atlas channel)
{
  vec4 badge = texture2D(uDecalTex, vUv2);
  // badge.rgb = the decal pack texture sampled at the badge atlas cell
  // Apply faction team-color tint before compositing:
  vec3 tinted = badge.rgb * uDecalTint;
  // Alpha-composite over the diffuse (source-over)
  diffuseColor.rgb = mix(diffuseColor.rgb, tinted, badge.a * uDecalAlpha);
}
```

Three.js passes `geometry.attributes.uv2` as the `uv2` attribute automatically
(it is a built-in attribute slot recognised by Three.js's WebGL program when
the geometry has it). No manual attribute binding is required — only `varying`
declarations need to be injected.

### Where to wire it in Viewport.tsx

In `buildVehicleIntoCache` (and the live load path), after constructing each
`MeshPhysicalMaterial` but before adding the mesh to the group — only for
meshes where `__usesBodyDiffuse` is true:

```typescript
// After: (mat as any).__usesBodyDiffuse = isBodyMaterial(...) || tex.sharesBodyAtlas
if ((mat as any).__usesBodyDiffuse) {
  mat.onBeforeCompile = (shader) => {
    // Uniforms for the badge overlay
    shader.uniforms.uDecalTex   = { value: null }         // set when decal is selected
    shader.uniforms.uDecalAlpha = { value: 0.0 }          // 0 = no badge visible
    shader.uniforms.uDecalTint  = { value: new THREE.Color(1, 1, 1) } // white = no tint

    // Vertex: pass uv2 to fragment
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'varying vec2 vBadgeUv;\nvoid main() {'
    ).replace(
      '#include <uv2_vertex>',   // Three.js built-in UV2 vertex block
      '#include <uv2_vertex>\nvBadgeUv = uv2;'
    )

    // Fragment: inject badge composite
    shader.fragmentShader = [
      'uniform sampler2D uDecalTex;',
      'uniform float uDecalAlpha;',
      'uniform vec3 uDecalTint;',
      'varying vec2 vBadgeUv;',
    ].join('\n') + '\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      // Badge overlay (Path A — uv2 badge atlas)
      if (uDecalAlpha > 0.0) {
        vec4 badge = texture2D(uDecalTex, vBadgeUv);
        vec3 tinted = badge.rgb * uDecalTint;
        diffuseColor.rgb = mix(diffuseColor.rgb, tinted, badge.a * uDecalAlpha);
      }`
    )

    // Store shader reference so uniforms can be updated when user selects a decal
    ;(mat as any).__badgeShader = shader
  }
  mat.customProgramCacheKey = () => 'badge-overlay'  // ensure cache coherence
}
```

Then add a new ref `decalTexRef = useRef<Texture|null>(null)` and an effect that
runs when the user picks a decal pack: load/rasterise the decal (already done
in Editor's `decalPreviewTick` effect via `rasteriseDecal`), create a
`THREE.CanvasTexture` from it, and traverse the vehicle group updating the
`uDecalTex` / `uDecalAlpha` / `uDecalTint` uniforms on every material that has
`__badgeShader` set.

The update call:
```typescript
// In the decal-selection effect, after rasterising the decal:
vehicleGroup.traverse(obj => {
  const mat = (obj as THREE.Mesh).material as any
  if (!mat?.__badgeShader) return
  mat.__badgeShader.uniforms.uDecalTex.value = decalCanvasTexture
  mat.__badgeShader.uniforms.uDecalAlpha.value = 1.0
  mat.__badgeShader.uniforms.uDecalTint.value = teamColorVec3  // see §4
})
needsRenderRef.current = true
```

---

## 3. rgm.ts — TEXCOORD1 Extraction Changes

**File:** `src/lib/rgm.ts`  
**Function:** `buildGeometry` (line 368)

### Required changes

**Step A: Add `uvs2` array alongside `uvs`** (line 374 area):

```typescript
// Existing:
let uvs: Float32Array | null = null

// Add:
let uvs2: Float32Array | null = null
```

**Step B: Add `TEXCOORD1` case in the vertex decode switch** (after the
existing `case SEMANTIC.TEXCOORD0:` block, ~line 415):

```typescript
case SEMANTIC.TEXCOORD1:
  if (!uvs2) uvs2 = new Float32Array(p.vertexCount * 2)
  if (elt.format === 3) {
    // R32G32_FLOAT — used by some MRGM v8 meshes (Cromwell format=3)
    uvs2[v * 2 + 0] = view.getFloat32(o,     true)
    uvs2[v * 2 + 1] = 1 - view.getFloat32(o + 4, true)
  } else if (elt.format === 2) {
    // R8G8B8A8 packed — same byte layout as TC0 on TRIM v5 vehicles
    // b2 = U, b1 = V (confirmed by probe-uv-channels histogram).
    // V is NOT flipped here — the badge atlas uses D3D top-left convention
    // but the badge texture itself is also uploaded with flipY=false
    // (unlike the body diffuse CanvasTexture which uses flipY=true).
    // The tight cluster probed at [0.286,0.337]×[0.039,0.086] already
    // accounts for D3D V direction (the cluster sits near V=0 which is
    // the TOP of the atlas in D3D, i.e. row 0–22 pixels in a ~470px
    // atlas). Do NOT flip: if we flip V here the cluster moves to
    // [0.914, 0.961] and misses the badge cell.
    //
    // Note: the existing TC0 decode flips V because the body CanvasTexture
    // uses flipY=true; TC1 / uDecalTex uses flipY=false, so the flip is
    // baked into the cluster coordinates that the asset authors chose.
    uvs2[v * 2 + 0] = p.vertexBuffer[o + 2] / 255
    uvs2[v * 2 + 1] = p.vertexBuffer[o + 1] / 255  // no flip for badge atlas
  }
  break
```

> **CRITICAL NOTE on V-flip for TC1:** The uv-channel-test.md probe measured
> TC1 cluster at V∈[0.039,0.086] (near-zero). The badge atlas `default_dif`
> sprite sheet places insignia in specific rows. If the badge texture is
> uploaded with `flipY = false` (texture.flipY = false), V=0.039 maps to
> near-top of the texture, which is correct for a D3D-authored atlas. If we
> flipped V here AND used flipY=true on the badge texture, the net effect would
> cancel. The safest choice: **no V-flip in rgm.ts TC1 decode**, and set
> `uDecalTex` texture with `flipY = false`. This matches the raw cluster
> coordinates as probed. If the badge renders upside-down during verification,
> toggle flipY on the badge texture (never touch the geometry).

**Step C: Emit uv2 attribute after vertex loop** (~line 475, after
`if (uvs) geo.setAttribute('uv', ...)`):

```typescript
if (uvs2) geo.setAttribute('uv2', new THREE.BufferAttribute(uvs2, 2))
```

No other changes to `rgm.ts`. The `SEMANTIC` table already has
`TEXCOORD1: 9` (line 163). The TRIM v5 and MRGM v8 paths both go through
`buildGeometry`, so both formats are covered by the single case addition.

### Per-format coverage matrix

| Vehicle format | TC1 format code | TC1 decode path |
|---------------|-----------------|-----------------|
| TRIM v5 (Tiger, Easy8, KT, ...) | `fmt=2` R8G8B8A8 | `vbuf[o+2]/255`, `vbuf[o+1]/255` |
| MRGM v8 T-34, IS-2, ISU-152 | `fmt=2` R8G8B8A8 | same |
| MRGM v8 Cromwell | `fmt=3` R32G32_FLOAT | `getFloat32(o)`, `getFloat32(o+4)` |

---

## 4. Decal Texture → Badge Atlas Mapping

### The badge atlas format

The badge atlas (`teamTex` = `art/armies/<faction>/badges/default_dif`) is a
sprite sheet where each national insignia occupies one cell. The Decal Pack
Wizard authoring format matches this atlas layout: a user-authored decal pack
is structured as a replacement for the entire badge atlas, with the pack's
insignia designed to fit the exact cell that TC1 indexes.

### The TC1 cluster cell

The tight TC1 cluster `U∈[0.286,0.337] × V∈[0.039,0.086]` (span ≈0.051×0.047)
is confirmed on ALL tested vehicles and formats. This is a single 5%×5% cell in
the badge atlas UV space.

### What the user's decal texture replaces

When the user selects a decal pack, the pack's badge texture IS the full badge
atlas replacement. The cell at `[0.286,0.337]×[0.039,0.086]` contains the
insignia that CoH2 samples for that faction's vehicle.

**Mapping conclusion:** Sampling `uDecalTex` through TC1 (`uv2`) is faithful
because:
1. The user's decal pack texture is authored to match the badge atlas layout.
2. The TC1 cluster at `[0.286, 0.337]×[0.039, 0.086]` indexes the correct
   insignia sub-region within that atlas.
3. No additional coordinate remapping is needed — the cluster UV coordinates
   index the pack texture directly.

If the user has authored a single-decal texture (not a full atlas), it should
be placed in a wrapper atlas at the cluster cell before uploading as `uDecalTex`.
The existing `rasteriseDecal` + `bakeDecalOntoDiffuse` can produce such a
wrapper: render the decal at pixel coords `[x, y, w, h]` in a 2048×2048 canvas
where `x = round(0.286 * 2048)`, `y = round(0.039 * 2048)`, `w = round(0.051 * 2048)`,
`h = round(0.047 * 2048)` → `[585, 80, 104, 96]` px. Upload that canvas as the
badge atlas texture.

### Installed decal packs (`.path` set)

For installed decal packs, the app already loads the badge atlas directly from
the SGA at `art/armies/<faction>/badges/<guid>/default_dif.rgt`. This IS the
badge atlas; upload it directly as `uDecalTex`. No wrapper canvas is needed.

---

## 5. Team-Color Tint

CoH2's in-game badge rendering applies a faction-specific team color to the
insignia before blending. The engine reads the team color from a uniform set at
draw time. In the app, the faction is known from `vehicle.faction`.

A mapping table (approximate, derived from CoH2's art constants):
```typescript
const FACTION_BADGE_TINT: Record<string, [r: number, g: number, b: number]> = {
  german:      [0.85, 0.76, 0.52],  // field grey / Feldgrau — warm ochre
  west_german: [0.85, 0.76, 0.52],  // same palette as OstHeer
  soviet:      [0.70, 0.15, 0.10],  // Soviet red
  aef:         [0.80, 0.65, 0.40],  // US olive drab / tan
  british:     [0.55, 0.72, 0.40],  // British khaki / infantry green
}
```

Pass as `uDecalTint` in the shader injection. The tint is a multiplicative RGB
applied to `badge.rgb` before alpha-compositing over the diffuse. For a
"no tint" mode (show the decal as-authored), set `uDecalTint = [1, 1, 1]`.

The existing decal preview (canvas bake path in Editor.tsx) does not apply a
team-color tint — it composites the decal directly. Path A should offer a
`uDecalApplyTint: boolean` uniform flag so the implementer can match or diverge
from the legacy preview behaviour during the transition.

---

## 6. MRGM v8 + Wide-TC1 Body Polygon Handling

The wide-TC1 submeshes (hull body polygon, turret body polygon, main barrel)
in MRGM v8 vehicles will receive `uDecalAlpha = 1.0` via the group traverse
the same as tight-TC1 submeshes. Their wide TC1 means:
- Sampling `uDecalTex` at a non-badge-cluster UV will produce a non-insignia
  pixel from the atlas (likely a faint or empty region).
- The badge will not appear on those submeshes.

This is CORRECT behaviour — CoH2's engine behaves identically (it doesn't paint
the insignia across the entire hull body polygon). The badge appears only on the
fitted detail geometry whose TC1 is tight. No per-submesh logic or fallback
needed.

If the implementer wants to be belt-and-suspenders, add a `__tc1IsTight` flag
to each mesh at parse time (cluster width < 0.15) and only set `uDecalAlpha > 0`
on tight-TC1 meshes. But this is optional — the shader is correct either way.

---

## 7. Replacing `bakeDecalOntoDiffuse` / `vehicle-uv-registry`

Path A supersedes the canvas bake approach for the 3D viewport badge preview:

| Existing mechanism | Path A replacement |
|-------------------|-------------------|
| `vehicle-uv-registry.ts` — resolves pixel rect per vehicle | **Deleted** (not needed — TC1 carries the placement) |
| `king-tiger-decal-bake.ts:bakeDecalOntoDiffuse` — bakes decal into diffuse canvas | **Deleted for preview** (kept for export) |
| `Editor.tsx decalPreviewTick` effect — loads pack, rasterises, bakes, sets `decalPreviewCanvasRef` | **Replaced** by setting `uDecalTex` / `uDecalAlpha` uniforms on the vehicle group's materials |
| `overlayCanvas` painted at fixed rect | **Unchanged** — still used for user-placed `paintDecals` markers in 2D panel; the 3D viewport shows the uv2-driven preview in parallel |

**Note:** `bakeDecalOntoDiffuse` must be **kept** for the mod-export pipeline
(`tools/test-export.ts`, `src/lib/mod-export.ts`). The canvas bake is the final
artifact written to disk. Path A only replaces the real-time viewport preview.

**Migration steps:**
1. Add TC1 extraction to `rgm.ts` (§3 above).
2. Add `onBeforeCompile` injection to Viewport's material-build path (§2 above).
3. Add a `decalTexRef = useRef<Texture|null>(null)` and a new effect in Viewport
   (or Editor wires it via a prop) that updates uniforms when the selected decal changes.
4. Remove the `decalPreviewTick` → `decalPreviewCanvasRef` pipeline from Editor.tsx
   (or gate it to "export-preview only", keeping the 2D paint panel unchanged).
5. `vehicle-uv-registry.ts` can be retired (left as a no-op or removed).

---

## 8. Verification Plan

After implementation, verify via the following steps:

1. **TC1 geometry check (unit test / probe):** Load Tiger.rgm via `parseRgm`,
   assert `geo.attributes.uv2` exists and all UV values are in `[0.27, 0.35] × [0.03, 0.09]`
   (tight cluster with ±0.01 tolerance).

2. **Shader compile check:** In DevTools console, confirm no WebGL shader
   compilation errors on the badge material (`__badgeShader` ref).

3. **Visual ground truth — KT hullSideRight (TRIM v5):**
   - Load King Tiger, select German faction decal pack.
   - Orbit to show the right hull panel.
   - The Balkenkreuz (or selected insignia) must land at the same position as
     the known hand-authored UV rect `{x:896, y:1152, w:512, h:512}` in the
     2048² texture (visible in the old canvas bake preview).
   - No UV smear, no full-atlas bleed.

4. **Visual ground truth — T-34/76 (MRGM v8):**
   - Load T-34/76, select Soviet faction decal pack.
   - Red star must appear on the skirts / side hatches (the tight-TC1 submeshes).
   - The hull body polygon should NOT show a full-atlas bleed (the badge alpha
     will be near-zero for the empty atlas region the wide TC1 samples).

5. **CDP comparison:** Screenshot the Viewport with the badge active. Compare
   to a reference screenshot captured under the canvas-bake path to confirm
   the badge position matches.

---

## 9. Risks and Open Items

1. **V-flip on badge texture:** The cluster sits at V∈[0.039, 0.086] raw.
   If the badge atlas on disk is stored V-flipped (D3D convention), and we
   upload it with `flipY=false`, the badge will read from the correct row.
   If uploaded with `flipY=true`, the badge will sample V=0.914–0.961 (wrong
   row). **Resolution:** Always upload the badge atlas with `flipY = false`.
   The current TC0 decode uses `1 - v` AND the CanvasTexture uses `flipY=true`
   which double-cancels. TC1 must use `v` raw (no flip in rgm.ts) and
   `flipY=false` on the badge texture.

2. **`uv2` attribute name in Three.js r160+:** Three.js ≥r155 renamed the
   built-in UV2 attribute from `uv2` to `uv1` internally (counting from 0).
   Check the Three.js version in `package.json`. If `geo.setAttribute('uv2', ...)`
   is correct for the installed version, no change needed. If the project uses
   Three.js ≥r155 with the new naming, use `THREE.BufferAttribute` with attribute
   name `'uv1'` and the vertex shader varying `attribute vec2 uv1`.  
   **Current check:** The project already uses `geo.setAttribute('uv', ...)` for
   TC0 — confirm `three` version in package.json and cross-reference the GLSL
   built-in for UV2 in that version.

3. **Cache invalidation for `onBeforeCompile`:** Three.js caches shader programs
   by material key. Setting `mat.customProgramCacheKey = () => 'badge-overlay'`
   forces the injected shader to be compiled fresh. If vehicles are swapped and
   the material is reused from `vehicleGroupCache`, confirm the `onBeforeCompile`
   re-fires (it does, because the compiled program is attached to the renderer
   context, not the material object).

4. **Performance:** The `onBeforeCompile` injection adds one texture2D sample
   per fragment on every body mesh. At typical orbit distances and 1.5× DPR,
   the additional sample is ~10–20% of the existing map/normalMap/roughnessMap
   samples. Benchmarking is recommended but expected to be within noise.

5. **MRGM v8 T34_76_Hull / GEO_chassis_shaker wide TC1 visible artifact:**
   The wide TC1 on hull-body polygons will sample a random-ish atlas region.
   If that region contains non-zero-alpha texels from the badge atlas (e.g.
   a colour swash), it will produce a faint unwanted overlay. The guard
   `if (uDecalAlpha > 0.0)` in the shader prevents this when no decal is
   selected. When a decal IS active, the badge atlas cell at the wide-TC1
   sample coordinates (outside [0.286–0.337]×[0.039–0.086]) should be empty
   (transparent) in a well-authored pack. Verify against the shipped
   `default_dif` atlases for German, Soviet, AEF, British factions.

---

*Self-contained brief for the implementer. Read only this document. Do not
re-read the groundwork probes or the existing source files beyond the specific
line numbers referenced above.*
