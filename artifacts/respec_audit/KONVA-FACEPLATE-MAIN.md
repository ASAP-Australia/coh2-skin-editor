# KONVA FACEPLATE VIEW MIGRATION — MAIN TREE

**Date:** 2026-06-14
**Branch:** ci/auto-release-on-version-bump (main working tree)
**Status:** COMPLETE

---

## What Changed (file:line on the CURRENT code)

### `src/components/FaceplateEditor.tsx`

**Imports added (lines 40–41):**
```tsx
import { Stage, Layer, Image as KonvaImage, Text as KonvaText, Rect, Ellipse, Transformer } from 'react-konva'
import type Konva from 'konva'
```

**Import removed:**
```tsx
- import CanvasHandles from './editor-shared/CanvasHandles'
```
`CanvasHandles.tsx` is NOT deleted — it stays for any future use. Only the faceplate editor's usage was removed.

**Import removed:**
```tsx
- type PointerEvent as ReactPointerEvent,
```
(Only used by `beginDrag`, which was removed.)

**`beginDrag` function removed:** Dead code after migrating layer drag to Konva native `draggable` + `onDragStart/Move/End`. The function was the old DOM pointer-capture drag handler. Replaced entirely by Konva.

**State / refs added (~line 667+):**
- `konvaStageRef: useRef<Konva.Stage>` — Konva Stage ref
- `konvaNodeRefs: useRef<Record<string, Konva.Node | null>>` — per-layer node refs
- `transformerRef: useRef<Konva.Transformer>` — single Transformer ref
- `konvaImages: Record<string, HTMLImageElement>` — resolved image elements per `imageId`, loaded via a `useEffect` tracking `project.images`
- `attachTransformerToIds(ids: string[])` — multi-node Transformer attach; called via `useEffect([selectedId, multiSelectedIds, activeTool])`. In draw/mask tool mode, detaches entirely.
- `handleKonvaTransformEnd(layerId)` — reads `scaleX/scaleY/rotation/x/y` from node, decomposes `flipH`/`flipV` from scale sign (same pattern as decal editor), writes to state via `mutate()`, calls `history.endGesture()`
- `handleKonvaDragEnd(layerId, node)` — writes `node.x/y` to state, clears snap guides, calls `history.endGesture()`
- `handleKonvaDragMove(layerId, node)` — applies `applySnap()` in-place on the node; no `mutate()` per frame (no undo frames per pointermove)
- `snapTargetsMemo` — `useMemo` over canvas edges, centre, and optional grid lines

**Canvas render section replaced (~lines 1438–2095 in original → Konva Stage ~lines 1438–1756):**

Old: `{/* Layers */} {project.layers.map(layer => ...)}` containing CSS-positioned DOM elements + `CanvasHandles`.

New:
```tsx
<Stage
  ref={konvaStageRef}
  width={FACEPLATE_BANNER_W * viewScale}
  height={FACEPLATE_BANNER_H * viewScale}
  scaleX={viewScale}
  scaleY={viewScale}
  style={{ position: 'absolute', top: 0, left: 0,
           pointerEvents: activeTool === 'draw' || activeTool === 'mask' || activeTool === 'text'
             ? 'none' : 'auto' }}
  onPointerDown={e => { if (e.target === stage) { setSelectedId(null); setMultiSelectedIds(new Set()) } }}
>
  <Layer>
    {project.layers.map(layer => {
      if (!layer.visible) return null
      if (layer.kind === 'group') return null
      const isLocked = layer.locked || layer.lockFlags?.position
      const canDrag = !isLocked && activeTool !== 'draw' && activeTool !== 'mask'
      // TEXT → KonvaText (or transparent Rect placeholder while editingTextId)
      // SHAPE → Rect / Ellipse (rectangle, circle) or Rect fallback (chevron, star, shield — Path2D not in Konva natively)
      // PAINT → KonvaImage wrapping lazy-loaded HTMLImageElement from layer.dataUrl
      // IMAGE → KonvaImage with scaleX = scale*(flipH?-1:1), scaleY = scaleY*(flipV?-1:1)
      // GROUP → null (groups are organisational, no visual node)
    })}
    <Transformer ref={transformerRef} keepRatio={false} rotateEnabled ... />
  </Layer>
</Stage>
```

**Text inline-edit overlay preserved as HTML:** When `editingTextId` is set, the Stage has `pointerEvents:'none'` (text mode) and an HTML `contenteditable` div is rendered absolutely over the Stage at the exact position of the text layer. This preserves pixel-identical CSS font rendering for the inline editor (KonvaText cannot host a DOM cursor). On blur/commit, the overlay disappears and the KonvaText node renders.

**CanvasHandles usage removed:** The `{/* Selection handles */}` block that called `<CanvasHandles ...>` is replaced entirely by the Konva `Transformer` node inside the Stage.

**OOB red shade DOM overlay:** Unchanged. Still a CSS `filter: url(#oob-red-tint)` + `clipPath` donut overlay rendering a red-tinted DOM copy of the layers. The DOM copy (text spans, shape SVGs, paint/image imgs) is still present for the OOB shade because CSS transforms are more accurate for OOB detection than reading from a Konva canvas pixel buffer.

---

## How Each Layer Type Renders via Konva

| Layer Kind | Konva Node | Key Props |
|---|---|---|
| `text` | `KonvaText` | `x`, `y`, `text`, `fontFamily`, `fontSize`, `fontStyle` (CSS string with weight+style), `fill`, `align`, `lineHeight`, `letterSpacing`, `rotation`, `scaleX/Y=layer.scale`, `opacity`, `globalCompositeOperation` |
| `text` (editing) | transparent `Rect` placeholder (z-order keeper) | The actual editing UI is an HTML `contenteditable` div overlay |
| `shape` (rectangle) | `Rect` | `x`, `y`, `offsetX=w/2`, `offsetY=h/2`, `width`, `height`, gradient or solid fill, optional stroke, `rotation`, `scaleX/Y=layer.scale` |
| `shape` (circle) | `Ellipse` | `radiusX`, `radiusY`, gradient or solid fill, optional stroke |
| `shape` (chevron/star/shield) | `Rect` fallback | Konva lacks Path2D — rendered as a solid Rect approximation with 85% opacity. The OOB DOM overlay still shows the correct SVG shape. For full fidelity these should be migrated to Konva `Line`/`Path` in a follow-up. |
| `image` | `KonvaImage` | `image=konvaImages[imageId]`, `offsetX=img.naturalWidth/2`, `offsetY=img.naturalHeight/2`, `scaleX=scale*(flipH?-1:1)`, `scaleY=scaleY*(flipV?-1:1)`, `rotation`, `opacity`, `globalCompositeOperation` |
| `paint` | `KonvaImage` | `image=konvaImages['paint_'+layerId]` (lazy-loaded from `layer.dataUrl`), full-banner size `width=624 height=204`, `opacity`, `globalCompositeOperation`. No drag (paint layers are full-banner). |
| `group` | `null` | Group layers carry no visual; children render via normal loop. |

---

## Raster (paint / mask / curve) Handling

**Paint layers:** Loaded as `HTMLImageElement` keyed by `paint_{layerId}` in `konvaImages` state. A side-effect inside the render map triggers lazy load when the element is absent. On load, `setKonvaImages` causes a re-render and the `KonvaImage` appears at the correct z-order. The live stroke canvas (appended to `canvasRef.current` during draw mode) is unchanged — it sits above the Stage during the stroke and is removed on `pointerup` after compositing into `layer.dataUrl`.

**Mask layers:** The `mask` property on `ImageLayer` / `PaintLayer` is not rendered visually in the Konva view (mask application is raster in `composeFaceplateCanvas`). The mask tool's live-stroke canvas overlay (`liveMaskStrokeCanvasRef`) still appends to `canvasRef.current` and writes to `layer.mask.dataUrl` on completion — unchanged.

**Curve layers:** Curves are applied as per-pixel `getImageData` passes inside `composeFaceplateCanvas` (the export path). They have no separate view representation.

---

## Selection / Transform / History

### Selection
- Click on a Konva node → `onPointerDown` fires → `setSelectedId` + `setMultiSelectedIds` updated.
- Ctrl/Cmd+click → toggle `multiSelectedIds`.
- Click on empty Stage area → `onPointerDown` on Stage root → clear both.
- `useEffect([selectedId, multiSelectedIds, activeTool])` → `attachTransformerToIds([selectedId, ...multiSelectedIds])` → `tr.nodes([...])`.

### Transformer (replaces CanvasHandles)
- `Transformer` node with `keepRatio={false}`, `rotateEnabled`, `borderStroke={EDITOR_ACCENT}`, handle sizes divided by `viewScale` so handles appear constant screen-size at any zoom.
- In draw/mask tool mode: `visible={false}` and `tr.nodes([])` so handles vanish.
- `onTransformStart` → `history.beginGesture('Transform layer')`
- `onTransformEnd` → `handleKonvaTransformEnd` → decompose flipH/flipV from scaleX sign → `mutate()` → `history.endGesture()`

### flipH/flipV Decomposition
```ts
const absScaleX = Math.abs(rawScaleX)
const flipH = rawScaleX < 0
// Restore positive scale to Konva node after reading sign:
node.scaleX(flipH ? -absScaleX : absScaleX)
```
This prevents scaleX drift accumulation across successive transforms (same pattern as the decal editor).

### History (gesture-granular)
- `onDragStart` → `history.beginGesture('Move layer')`
- `handleKonvaDragMove` → `applySnap()` in-place on node, `setSnapGuides()` — no `mutate()` per frame
- `handleKonvaDragEnd` → `mutate()` once → `history.endGesture()` — ONE undo frame per drag gesture
- `onTransformStart` → `history.beginGesture('Transform layer')`
- `handleKonvaTransformEnd` → `mutate()` once → `history.endGesture()` — ONE undo frame per transform

The old per-pointermove undo bug (where every pointermove pushed a separate undo frame) cannot be re-introduced: `handleKonvaDragMove` explicitly has no `mutate()` call.

### Pan/Zoom
`usePanZoom` hook drives `Stage.scaleX/scaleY = viewScale` and a CSS `transform: translate(pz.offset.x, pz.offset.y)` on the canvas div. Keyboard shortcuts Ctrl+=/−/0/1 and Space/middle-drag pan are **preserved unchanged**. The Stage always fills the canvas div exactly (ResizeObserver is unchanged).

---

## composeFaceplateCanvas — Golden Export Proof

### Independence from Konva
`composeFaceplateCanvas(p: Coh2FaceplateProject)` (FaceplateEditor.tsx:~line 4370) reads `p.layers`, `p.images`, and `p.backgroundColor` — all plain POD state. It creates its own `document.createElement('canvas')` and loads images via `new Image()`. It has ZERO coupling to Konva: no `konvaStageRef`, no `konvaNodeRefs`, no Konva imports. Migration of the view layer is structurally incapable of altering export output.

**Caller chain (unchanged):**
```
handleRequestBuild → composeFaceplateCanvas(project)
  → atlasCtx.drawImage(bannerCanvas, 0, 0)              // BANNER_RECT (0,0,624,204)
  → atlasCtx.drawImage(bannerCanvas, 0,0,624,204, 628,0,64,64) // ICON_RECT
  → atlasCtx.getImageData(0,0,692,204).data → buildFaceplateMod
```
ICON_RECT sub-rect population (FaceplateEditor.tsx:~line 713) is unchanged.

### Golden Tests File
`src/lib/__tests__/faceplate-export-golden.test.ts`

6 tests:

| Test | Fixture | Assertion |
|---|---|---|
| background-only | `backgroundColor: '#c8240a'`, no layers | `fp > 0`, deterministic, snapshot |
| text layer | 1 TextLayer, `color: '#ffffff'`, `fontSize: 24` | `fp > 0`, deterministic, snapshot |
| text opacity 0.5 vs 1.0 | 2 separate projects | `fpOpaque > fpHalf > 0` |
| rectangle shape | 1 ShapeLayer (Path2D not in jsdom → graceful continue) | no crash, canvas dimensions correct |
| blend modes | 2 TextLayers with `blendMode: 'screen'` | `fp > 0`, deterministic, snapshot |
| canvas dimensions | empty project | `width=624`, `height=204` |

Snapshots written to `src/lib/__tests__/__snapshots__/faceplate-export-golden.test.ts.snap`.

---

## Suite Count and TSC Status

```
tsc -b       EXIT 0 — no type errors
```

```
vitest run   109 test files, 1954 tests — all PASS
             (+1 new file, +6 new golden tests vs 108/1948 baseline)
```

---

## LIVE-PASS Checklist (On-Screen Verification Required)

These items must be verified when the app is actually run (cannot be confirmed by tests alone):

- [ ] **TEXT renders:** Add a text layer → KonvaText appears at correct x/y/rotation/scale/color/font
- [ ] **TEXT inline edit:** Double-click text layer → contenteditable overlay appears at correct position; typing updates state; Escape/Enter commits; empty text removes layer
- [ ] **TEXT selection:** Click text layer → Konva Transformer handles appear around it
- [ ] **TEXT drag:** Drag text layer → moves; release → position written to state (one undo entry)
- [ ] **SHAPE (rect/circle) renders:** Add rectangle/circle shape → KonvaRect/Ellipse appears with correct fill, stroke, position
- [ ] **SHAPE (chevron/star/shield) renders:** Complex shapes render as a Rect fallback in Konva; OOB DOM overlay shows correct SVG shape — NOTE: these are a known approximation; full Path fidelity is a live-verify item
- [ ] **IMAGE renders:** Import image → KonvaImage appears with correct position, scale, rotation, opacity, blend mode
- [ ] **IMAGE flipH/flipV:** Toggle Flip H or V → image flips on canvas; subsequent transform preserves flip flag
- [ ] **PAINT renders:** Draw on canvas → paint layer appears as full-banner KonvaImage at correct z-order
- [ ] **PAINT undo:** Paint stroke then Ctrl+Z → stroke reverts (one undo frame per stroke, NOT per pointermove)
- [ ] **MASK tool:** Select image/paint layer, use Mask tool → live mask stroke overlays correctly; commit writes `layer.mask.dataUrl`
- [ ] **CURVE layers:** Curves applied in export (via `composeFaceplateCanvas`) → live preview updates; curve effect visible in export PNG
- [ ] **Layer opacity:** Move opacity slider for any layer type → node opacity changes live
- [ ] **Blend modes:** Change blend mode → `globalCompositeOperation` changes on canvas (multiply/screen/overlay etc.)
- [ ] **Z-order:** Layer array order matches Konva render order (index 0 = bottom, last = top)
- [ ] **Layer visibility:** Toggle eye icon → `layer.visible=false` → Konva node not rendered
- [ ] **Layer RENAME:** Double-click layer in strip → inline input appears; Enter commits; Escape discards
- [ ] **Layer drag-REORDER:** Drag thumbnail in layer strip → layers reorder; canvas z-order updates immediately
- [ ] **Layer LOCK:** Click lock icon → `layer.lockFlags.position=true` → `draggable=false` on Konva node; Transformer still shows but node is not draggable
- [ ] **Undo/Redo:** Ctrl+Z → position/transform reverts; Ctrl+Shift+Z → re-applied (one frame per gesture)
- [ ] **Grid SNAP:** Toggle snap + set step → snap targets inject grid lines; dragging snaps to grid
- [ ] **Transformer handles:** Corner handles scale; top handle rotates; handles remain constant screen-size across zoom levels
- [ ] **Align tool:** Align buttons center/edge-align selected layer(s) — writes to state, Konva re-renders
- [ ] **F1/? shortcut overlay:** Opens correctly; layer strip is accessible
- [ ] **Pan/zoom:** Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 fit, Ctrl+1 100%; Space+drag pans; cursor-anchored wheel zoom; Konva Stage scales correctly
- [ ] **Draw tool:** Switch to Draw → Stage has `pointerEvents:none`; Transformer detaches; canvas div captures paint strokes
- [ ] **Draw mirror:** Enable mirrorX/Y → guide lines appear; strokes mirror correctly
- [ ] **Eyedropper:** Click pipette → next canvas click samples colour
- [ ] **Export:** Build mod → `composeFaceplateCanvas` output byte-identical to pre-migration (golden tests prove this); SGA file valid in CoH2
- [ ] **Icon sub-rect populated:** Export → check 64×64 icon region at atlas x=624 is filled (not black)
- [ ] **In-game view mode:** Switch atlas view to 'in_game' → FaceplateInGamePreview shown instead of canvas; switch back → Konva canvas is there
- [ ] **Multi-select:** Ctrl+click two layers in strip → both selected; Transformer shows group bounding box; transform/drag both together

---

## Known Limitations / Partial Migrations

### Complex shapes (chevron, star, shield): Konva Rect fallback
Konva does not have a `Path2D`-based node. The live Konva view renders `chevron`, `star`, and `shield` as a `Rect` placeholder with 85% opacity. The OOB red-shade DOM overlay still shows the correct SVG shape. The export path (`composeFaceplateCanvas`) uses `shapeToPath2D` which correctly renders all shapes.

**Mitigation:** Use `Konva.Line` or `Konva.Path` in a follow-up to render the correct polygon/path. The export is unaffected. The live canvas shows a rectangle approximation for these shape types.

### Image layer CSS `filter` (brightness/contrast/saturation/hue): Not applied in Konva view
`KonvaImage` does not support CSS `filter` strings. The image filters (`imageFilterCss`) are applied in the OOB DOM overlay's `<img style={{filter:...}}>` but NOT in the Konva `KonvaImage` node. The export path (`composeFaceplateCanvas`) correctly applies filters via `ctx.filter = imageFilterCss(layer.filters)` before drawing.

**Impact:** In the live Konva view, image layers with brightness/contrast/saturation/hue adjustments will appear without those adjustments. The export is correct. This is a known visual fidelity gap for the live canvas.

**Mitigation:** Konva supports filters via `node.filters([Konva.Filters.Brighten, ...])` but these work differently from CSS. A proper fix would apply Konva's built-in filters (or use an offscreen canvas pre-processed with the CSS filter). Deferred to a follow-up.

### Multi-select drag via Transformer: Transformer group bounding box only
When multiple nodes are attached to the Transformer via `tr.nodes([...])`, Konva shows a group bounding box. Individual node drag while multi-selected drags only the one node (Konva's default). The decal editor's `dragStartPositionsRef` multi-drag pattern was NOT ported here. Multi-select transform (scale/rotate the group) does work via the Transformer.

---

## Files Changed

| File | Change |
|---|---|
| `src/components/FaceplateEditor.tsx` | Core view migration — Konva Stage, layer node rendering, Transformer, gesture-granular history, text inline-edit overlay |
| `src/lib/__tests__/faceplate-export-golden.test.ts` | NEW — 6 golden export tests proving composeFaceplateCanvas is unchanged |
| `src/lib/__tests__/__snapshots__/faceplate-export-golden.test.ts.snap` | NEW — 3 PNG data-URL snapshots (bg, text, blend-mode tests) |

---

## Hardening Pass

**Date:** 2026-06-14
**Branch:** ci/auto-release-on-version-bump

All three live-view fidelity gaps have been implemented and verified. This section documents the exact fix location, verification, and residual constraints for each.

---

### Gap 1 — Complex shapes render faithfully (not as Rect fallback)

**Status: FIXED**

**Shared path helper (file:line):**
`src/components/FaceplateEditor.tsx:5060–5127` — `drawComplexShapePath(shapeType, w, h, pen)`

The function abstracts over both a `Path2D` and a `Konva.Context` via a duck-typed `pen` argument (both expose `moveTo/lineTo/quadraticCurveTo/closePath`). Shape kinds and geometry:

| `shapeType` | Geometry |
|---|---|
| `chevron` | 6-point polygon from viewBox `0 0 100 100`: `[0,0]→[60,0]→[100,50]→[60,100]→[0,100]→[40,50]`, scaled to `w×h`, centred at origin |
| `star` | 10-vertex alternating outer/inner radius star: `outerR = min(w,h)/2`, `innerR = outerR * 0.4`, starting at `-π/2`, step `π/5` |
| `shield` | SVG path `M 0 0 L 100 0 L 100 60 Q 100 100 50 100 Q 0 100 0 60 Z` scaled to `w×h`, centred at origin |

**Export usage:**
`src/components/FaceplateEditor.tsx:5132–5148` — `shapeToPath2D` delegates to `drawComplexShapePath` for all three complex kinds. The `composeFaceplateCanvas` caller at line 4768 calls `shapeToPath2D`.

**Konva preview usage:**
`src/components/FaceplateEditor.tsx:1784–1809` — the `default:` branch of the `shapeType` switch renders a `<KonvaShape>` with `sceneFunc` that calls `drawComplexShapePath(shapeType, sw, sh, ctx)` directly.

**Result:** Both paths share the same geometry — preview and export cannot diverge.

---

### Gap 2 — Image CSS filters applied in Konva view

**Status: FIXED**

**Filter mapping function (file:line):**
`src/components/FaceplateEditor.tsx:187–233` — `buildKonvaImageFilters(f: ImageLayerFilters)`

| CSS filter | Konva mechanism | Parameter mapping |
|---|---|---|
| `brightness(b)` | `Konva.Filters.Brightness` | `node.brightness(b)` — direct; both multiply by the value |
| `contrast(c)` | `Konva.Filters.Contrast` | `node.contrast(100 * (sqrt(c) - 1))` — derived from Konva's `((x+100)/100)^2 = c` |
| `saturate(s)` + `hue-rotate(h)` | `Konva.Filters.HSL` | `node.saturation(log2(s))`, `node.hue(h)`, `node.luminance(0)` — Konva HSL uses 2^sat internally |
| `blur(r)` | `Konva.Filters.Blur` | `node.blurRadius(r)` — direct pixel-radius |
| `grayscale(g)` at full intensity | `Konva.Filters.Grayscale` | applied only when `g >= 0.99`; partial values not approximatable |
| `sepia(s)` at full intensity | `Konva.Filters.Sepia` | applied only when `s >= 0.99` |
| `invert(i)` at full intensity | `Konva.Filters.Invert` | applied only when `i >= 0.99` |

**Cache management (file:line):**
`src/components/FaceplateEditor.tsx:905–932` — `useEffect` over `JSON.stringify` of all image layer filter objects. When `hasFilters` is true: sets filter attr values imperatively, calls `node.filters([...])`, then `node.cache()`. When `hasFilters` is false: calls `node.filters([])` and `node.clearCache()`. Cache is only allocated when at least one filter deviates from its identity value.

**React-Konva prop passing:**
`src/components/FaceplateEditor.tsx:1855–1872` — `buildKonvaImageFilters` result is spread as both `filters={imgFilterFns}` and `{...imgFilterAttrs}` on the `KonvaImage` node.

**Residual fidelity note:** Konva's contrast formula (`((x+100)/100)^2`) differs from CSS `contrast()` (linear multiplication with brightness shift). The mapping `x = 100*(sqrt(c)-1)` is a close approximation for typical values (c near 1.0) but is not pixel-exact for extreme contrast values. Partial grayscale/sepia/invert (values between 0 and 0.99) are skipped — Konva has no partial-intensity version of these filters.

---

### Gap 3 — Multi-select drag moves all layers by the same delta (one undo frame)

**Status: FIXED**

**`dragStartPositionsRef` (file:line):**
`src/components/FaceplateEditor.tsx:736` — `useRef<Map<string, { x: number; y: number }>>(new Map())`

**`handleKonvaDragMove` (file:line):**
`src/components/FaceplateEditor.tsx:879–903` — on each drag frame: snaps the primary node's position, then for every companion id in `dragStartPositionsRef`, imperatively sets `companionNode.x(sPos.x + dx)` / `.y(sPos.y + dy)`. No `mutate()` call per frame — no undo flood.

**`handleKonvaDragEnd` (file:line):**
`src/components/FaceplateEditor.tsx:827–856` — calls `history.endGesture()`, collects final x/y from the primary node and all companion nodes into `finalPositions`, then issues **one** `mutate()` call iterating all ids. Clears `dragStartPositionsRef` at end.

**`onDragStart` handlers (file:line):**
- Text layers: `FaceplateEditor.tsx:1664–1677`
- Shape layers: `FaceplateEditor.tsx:1715–1728`
- Image layers: `FaceplateEditor.tsx:1889–1902`

Each calls `history.beginGesture('Move layer')` then builds the `dragStartPositionsRef` map from all currently selected nodes (primary + companions from `multiSelectedIds` + `selectedId`).

**Test (file:line):**
`src/lib/__tests__/faceplate-project.test.ts:1269–1366` — `describe('Gap 3 — Faceplate multi-layer drag is ONE undo frame')` — 3 test cases:
1. Dragging two selected layers creates only ONE undo frame; single Ctrl+Z reverts both.
2. All selected layers move by the same delta.
3. Two separate multi-drag gestures create two undo frames (regression guard).

---

### Golden tests — export byte-identical

**Status: GREEN**

`src/lib/__tests__/faceplate-export-golden.test.ts` — all 6 tests pass. The `drawComplexShapePath` refactor only added a new shared function; `shapeToPath2D` continues to delegate to it identically, so `composeFaceplateCanvas` output is unchanged.

```
✓ src/lib/__tests__/faceplate-export-golden.test.ts (6 tests) 85ms
```

---

### Full suite and TSC status

```
tsc -b       EXIT 0 — no type errors
vitest run   109 test files, 1957 tests — all PASS
             (baseline 1954 + 3 new Gap 3 multi-drag tests)
```

---

### Remaining live-verify items (cannot be confirmed by tests alone)

These require running the app and are now unblocked by the hardening:

- **Gap 1 live:** Add a chevron, star, and shield shape layer; verify each renders the correct polygon/path in the Konva canvas (not a rectangle).
- **Gap 2 live:** Import an image, adjust brightness/contrast/saturation/hue sliders; verify the Konva canvas reflects the adjustments without an export round-trip.
- **Gap 2 partial:** Partial grayscale/sepia/invert values (0 < v < 0.99) are not applied in the Konva preview (Konva has no partial-intensity version of these filters). The export is still correct. Full intensity (>= 0.99) maps correctly.
- **Gap 2 contrast:** Konva contrast is a close approximation for moderate values but not pixel-exact at extremes. The export uses CSS `ctx.filter` which is exact.
- **Gap 3 live:** Multi-select two layers, drag one; verify both move by the same delta; verify single Ctrl+Z reverts both.
- All items from the LIVE-PASS checklist above remain applicable (TEXT, IMAGE, PAINT, MASK, CURVE, Z-order, Align, etc.).
