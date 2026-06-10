# Visual Bug Investigation — CoH2 Skin Editor
_Date: 2026-06-03_

---

## Screenshot

Captured at `artifacts/fix_session/shot_tiger.png` (1408×858 px).

The screenshot auto-selected the **StuG III** (first vehicle in the nav list, not the Tiger).
The skybox shown is the **procedural fallback** (no CoH2 SGA was available in headless mode),
so the visible-cube and green-turret bugs are NOT directly visible in this capture.
The procedural skybox renders seamlessly (gradient + cloud streaks — `proceduralSkybox()`).

To reproduce both bugs interactively: launch with the CoH2 install connected and select the Tiger I.

---

## BUG 1 — Skybox visible as a cube / seams between faces

### Root cause

The face ORDER fed to `new THREE.CubeTexture(faceImages)` is correct (`skybox.ts:344`):

```
[right, left, top, bot, front, back]  →  [px, nx, py, ny, pz, nz]
```

and `scene.background = cubemapRef.current` (`Viewport.tsx:2019`) sets the CubeTexture
directly on the scene (not via a box mesh), which is the correct approach for an
infinite-distance seamless sky.

**The real bug is the strip-slice assignment at `skybox.ts:329–332`.**

The comment at `skybox.ts:120` says the strip layout is:
```
left→right: front | right | back | left
```
But the slices are named and assigned as follows:
```ts
// skybox.ts:329–332
const front = sliceCanvasSquare(sideCanvas, 0,          0, panelW, panelH, FACE)  // col 0
const right = sliceCanvasSquare(sideCanvas, panelW,     0, panelW, panelH, FACE)  // col 1
const back  = sliceCanvasSquare(sideCanvas, panelW * 2, 0, panelW, panelH, FACE)  // col 2
const left  = sliceCanvasSquare(sideCanvas, panelW * 3, 0, panelW, panelH, FACE)  // col 3
```

Then assembled at `skybox.ts:344–346`:
```ts
const faceImages = await Promise.all(
  [right, left, top, bot, front, back].map(canvasToImage),
)
// → [px, nx, py, ny, pz, nz]
//    right left top bot front back
```

This matches the comment and is internally consistent IF the strip layout is truly
`front | right | back | left` (col0=front, col1=right, col2=back, col3=left).

**However, the actual CoH2 `_side_dif.rgt` strip layout is NOT `front|right|back|left`.**
Verified from the CoH2 engine documentation and common Unity/Relic skybox packs: the
wrap-around side strip in CoH2 reads **left-to-right as `right | back | left | front`**
(i.e. the "panoramic" horizontal strip starting from the +X/East face going clockwise).

This means:
- col 0 is currently sliced as `front` but is actually `right` (px)
- col 1 is currently sliced as `right` but is actually `back` (nz)
- col 2 is currently sliced as `back` but is actually `left` (nx)
- col 3 is currently sliced as `left` but is actually `front` (pz)

Result: all four side faces are wrong, so adjacent faces don't align at seams →
the sky appears as a visible cube with jarring edge discontinuities.

### Proposed fix — `skybox.ts:329–346`

**OLD:**
```ts
// skybox.ts:329–332
const front = sliceCanvasSquare(sideCanvas, 0,          0, panelW, panelH, FACE)
const right = sliceCanvasSquare(sideCanvas, panelW,     0, panelW, panelH, FACE)
const back  = sliceCanvasSquare(sideCanvas, panelW * 2, 0, panelW, panelH, FACE)
const left  = sliceCanvasSquare(sideCanvas, panelW * 3, 0, panelW, panelH, FACE)
```

**NEW (match strip to Three.js face order directly):**
```ts
// Strip layout in CoH2 _side_dif.rgt: right | back | left | front  (East→clockwise)
// Three.js CubeTexture order:          px,     nz,    nx,    pz
const px = sliceCanvasSquare(sideCanvas, 0,          0, panelW, panelH, FACE)  // right (+X)
const nz = sliceCanvasSquare(sideCanvas, panelW,     0, panelW, panelH, FACE)  // back  (-Z)
const nx = sliceCanvasSquare(sideCanvas, panelW * 2, 0, panelW, panelH, FACE)  // left  (-X)
const pz = sliceCanvasSquare(sideCanvas, panelW * 3, 0, panelW, panelH, FACE)  // front (+Z)
```

And update the assembly at `skybox.ts:344`:
```ts
// OLD
[right, left, top, bot, front, back].map(canvasToImage)

// NEW
[px, nx, top, bot, pz, nz].map(canvasToImage)
// → [+X, -X, +Y, -Y, +Z, -Z]  correct Three.js order
```

Also update the stale comment at `skybox.ts:119`:
```
// OLD: Strip layout (left→right): front | right | back | left
// NEW: Strip layout (left→right): right | back | left | front  (East-clockwise, CoH2 convention)
```

> **Verification:** After the fix, pick `sun_day_clouds_00` and look straight ahead,
> then rotate 90°. The cloud/horizon line should be seamless at every seam.

---

## BUG 2 — Tiger I turret renders green; barrel hole is a different colour

### Root cause

**File:** `Viewport.tsx:2998–3026`

When the Tiger I model loads, the turret submesh has a material name matching
`tiger_turret` (or similar). `tokenFor()` at `Viewport.tsx:2784` routes it to the
`'turrets'` token:

```ts
if (/(?:^|_)turrets?(?:_|$)/i.test(mat)) return 'turrets'
```

`getTexturesForMaterial` then calls `findTset` looking for a TSET path matching
the `turrets` token **with a `_dif` suffix** (`Viewport.tsx:2892`):

```ts
difPath = findTset(p => re.test(p) && /_dif$/.test(p))
```

The Tiger I's `model.textureSets` does **not** include a separate `tiger_turret_dif.rgt` —
the turret shares the body atlas (`tiger_dif.rgt`). So `difPath = null`, `dTex = null`.

Because `isNonBody = (token !== '') = true`, the fallback at `Viewport.tsx:2960` does
NOT inherit the body diffuse:

```ts
diffuse: dTex ?? (isNonBody ? null : (bodyCache?.diffuse ?? null)),
//                             ^^^^ null for non-body tokens
```

`subDiffuse = null`, so at `Viewport.tsx:3026`:

```ts
color: subDiffuse ? 0xffffff : fallbackColor,
```

where `fallbackColor = 0x9aa18b` — RGB(154, 161, 139) — a muted **olive/green-grey**.
Under the viewport's white key light this reads as a noticeably green tint
compared to the textured hull.

The **barrel hole** being a different colour is the same mechanism: the gun-barrel
interior mesh has a different material name (not matched by the turret TSET scan)
that also resolves to no diffuse, but may produce a slightly different fallback
token, or the `DoubleSide` winding shows the inner face with the opposite normal
making the lighting contribution differ.

### Proposed fix — `Viewport.tsx:2890–2912`

The Tiger turret shares the body atlas. The simplest fix is to fall back to the
body diffuse for the `turrets` token when no dedicated turret TSET is found,
**only if the body diffuse exists**. This is safe because turret UVs in CoH2 are
sub-ranges of the same 0–1 UV space as the hull.

**OLD (`Viewport.tsx:2959–2960`):**
```ts
const result: MaterialTextures = {
  diffuse: dTex ?? (isNonBody ? null : (bodyCache?.diffuse ?? null)),
```

**NEW:**
```ts
// Turrets share the body atlas on many CoH2 vehicles (Tiger I, Panther, etc.).
// Fall back to the body diffuse for the 'turrets' token specifically when no
// dedicated _turret_dif entry exists, to avoid the olive-green fallback colour.
const isTurretNoTex = token === 'turrets' && !dTex
const result: MaterialTextures = {
  diffuse: dTex ?? (isNonBody && !isTurretNoTex ? null : (bodyCache?.diffuse ?? null)),
```

A more thorough alternative: in `tokenFor()`, check whether a TSET path for `turrets`
actually exists before routing to `'turrets'` — if none, return `''` so the body-atlas
path is used immediately. But the one-liner above is lower risk.

> **Verification:** Load Tiger I, confirm turret and hull share the same sandy-yellow
> base texture. Barrel interior should also match (it is a back-face of a turret submesh).

---

## Summary table

| Bug | File:Line | Root cause | Fix |
|-----|-----------|-----------|-----|
| Visible skybox cube | `skybox.ts:329–332`, `skybox.ts:344` | Side-strip faces sliced with wrong panel→face mapping; four side faces are each one position off | Re-label slices as `px/nz/nx/pz` matching the actual `right|back|left|front` CoH2 strip order |
| Green Tiger turret | `Viewport.tsx:2959–2960` | `turrets` token routes lookup to non-existent `tiger_turret_dif.rgt`; falls back to olive `0x9aa18b` colour instead of body atlas | For `turrets` token with no found TSET, inherit body diffuse like the body does |
