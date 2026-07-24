# ENGINE-MIGRATION-MAP
*Codebase snapshot: June 2026. Read-only audit — no code modified.*

---

## 1. Decal Editor (`DecalPackEditor.tsx` + `src/components/atlas/`)

### Current rendering engine
Pure CSS/DOM compositing. Each decal is a `<div>` child of the 128² canvas `<div ref={canvasRef}>`, positioned with `position:absolute; left/top; transform: translate(-50%,-50%) rotate(…deg) scale(…)`. There is no `<canvas>` element for the live interactive view; the `<canvas>` only materialises as an ephemeral **live-stroke overlay** (`liveStrokeCanvasRef`) during a Draw tool stroke (DecalPackEditor.tsx:1111–1116).

### State shape for decal objects
```ts
// decal-pack-project.ts
interface Decal {
  id: string
  sourceImageId: string   // key into project.sourceImages (dataUrl pool)
  x: number               // center in 128-space canvas coords
  y: number
  scale: number           // uniform scale
  rotation: number        // degrees
  flipH: boolean
  flipV: boolean
  opacity: number         // 0–1
  blendMode?: GlobalCompositeOperation
  tint?: { color: string; strength: number }
  brightness/contrast/saturation: number  // adjustment %
  visible: boolean
  locked: boolean
  mask?: { dataUrl: string; enabled: boolean }
  clippedToDecalBelow?: boolean
  name: string
  // v6 atlas-part/faction: stored in parts[N].shared[] or parts[N].overrides[faction][]
}
```
Decal state is a plain JS array in `project.decals` (v5) or `project.parts[N].shared / overrides[faction]` (v6). No engine object model — each decal is a POD record.

### Move / scale / rotate
- **Move**: `beginCanvasDrag` (DecalPackEditor.tsx:967–1064) listens to global `pointermove`, divides by `viewScale` to convert screen-delta → canvas-delta, mutates `decal.x / decal.y` directly through the history engine. No engine drag primitive.
- **Scale / rotate**: via shared `CanvasHandles.tsx` (editor-shared/CanvasHandles.tsx:115–228) — pure DOM handles rendered as `<div>` elements. They compute new `scale` / `rotation` from pointer deltas and call `onResize` / `onRotate` callbacks; the parent patches the Decal record through `history.mutate`.
- **Numeric inputs**: `TransformInputsRow.tsx` (editor-shared/TransformInputsRow.tsx) — paired UI for both editors.

### Blend modes / opacity / z-order
- `opacity` → `decal.opacity` (DecalPackEditor.tsx:209 rendered as CSS `opacity` on the layer `<div>`; also applied in `rasteriseDecal` as `ctx.globalAlpha`).
- `blendMode` → CSS `mix-blend-mode` on the layer `<div>` for the interactive preview; `ctx.globalCompositeOperation` in `rasteriseDecal` (decal-pack-export.ts:203–210).
- Z-order → array index in `cellDecals` (higher index = visually on top); reorder via `moveDecal` / drag-to-reorder (DecalPackEditor.tsx:892–956).

### Composite to atlas (export)
`rasteriseDecal(decal, bitmap, options?)` in `decal-pack-export.ts:158–225` draws ONE decal into a 128² `OffscreenCanvas` (or `HTMLCanvasElement`) using raw 2D context. The full atlas bake goes through `compositePartLayers` in `atlas-parts.ts` (imported async at DecalPackEditor.tsx:302). Export pipeline: `decal-pack-export.ts:exportDecalPackZip` → per-decal `rasteriseDecal` → PNG → ZIP.

### Per-slot reference preview (S5)
`compositePartLayers` (async) → `ctx.putImageData` into a 128² canvas → `out.toDataURL()` → `<img src={refPreviewDataUrl}>`. DecalPackEditor.tsx:277–336.

### Draw tool
Ephemeral `HTMLCanvasElement` overlaid on the canvas div (DecalPackEditor.tsx:1111–1114). On pointer-up: `drawImage(existingDataUrl, …)` + `drawImage(liveCanvas, 0,0)` → `offscreen.toDataURL('image/png')` → new `sourceImages[srcId].dataUrl`. Strokes commit by mutating the source image data-URL.

---

## 2. Faceplate Editor (`FaceplateEditor.tsx`)

### Current rendering engine
CSS/DOM compositing with full `composeFaceplateCanvas` (FaceplateEditor.tsx:4316) as the export path. Interactive view is a 624×204 `<div ref={canvasRef}>` containing absolutely-positioned layer elements; no persistent `<canvas>` for the interactive view.

### Layer model (types in `faceplate-project.ts`)
| Kind | Key fields |
|---|---|
| `text` | `x,y,scale,rotation,opacity,blendMode,fontFamily,fontSize,fontWeight,fontStyle,color,textAlign,letterSpacing,lineHeight,strokeWidth,strokeColor,stroke:{width,color}?,shadow?` |
| `image` | `x,y,scale,scaleY,rotation,opacity,blendMode,imageId,brightness,contrast,saturation,hue?,filter?,mask?:{dataUrl,enabled},clippedToLayerBelow?` |
| `paint` | `x,y (unused—full-banner),opacity,blendMode,dataUrl,mask?:{dataUrl,enabled},clippedToLayerBelow?,stroke?` |
| `shape` | `x,y,scale,scaleY,rotation,opacity,blendMode,kind:ShapeKind,fill:GradientFill\|string,strokeWidth,strokeColor,stroke?,shadow?` |
| `mask` | (not a standalone layer type — mask is a sub-property of image/paint) |

There is also a `curve` layer category referenced by `CurvesEditor.tsx` in the primitives; curves are applied as per-layer pixel-level transformations during export compositing (FaceplateEditor.tsx:4680 `getImageData` pass).

### Layer rendering in editor
- **text**: contenteditable `<div>` (editing) or styled `<div>` (display), absolutely positioned with CSS `transform: translate(-50%,-50%) rotate(…deg)`. FaceplateEditor.tsx:1298–1413.
- **image**: `<img>` element with CSS `transform: translate(-50%,-50%) rotate(…deg) scale(scaleX,scaleY)`, `imageFilterCss` for adjustments. FaceplateEditor.tsx:~1600.
- **paint**: `<img src={layer.dataUrl}>` full-banner. FaceplateEditor.tsx:~1500.
- **shape**: SVG or CSS `<div>` with border-radius. FaceplateEditor.tsx:~1700.

### Transforms / CanvasHandles
Shared `CanvasHandles.tsx` (same component as DPE). Image layers use non-uniform mode (`scaleY` prop set); text/shape use uniform mode. TransformInputsRow used in the select peel (FaceplateEditor.tsx:~2200+).

### Blend modes
CSS `mix-blend-mode` on layer `<div>`/`<img>` in editor; `ctx.globalCompositeOperation` in `composeFaceplateCanvas` (FaceplateEditor.tsx:4355).

### ICON_RECT / BANNER_RECT atlas composition
`composeFaceplateCanvas` (FaceplateEditor.tsx:4316) returns a 624×204 `HTMLCanvasElement`. Export code composites banner into a 692×204 atlas:
```ts
// FaceplateEditor.tsx:705–715 (handleRequestBuild)
atlasCtx.drawImage(bannerCanvas, 0, 0)                              // BANNER_RECT
atlasCtx.drawImage(bannerCanvas, 0,0,624,204, 628,0,64,64)         // ICON_RECT (scaled)
const atlasRgba = atlasCtx.getImageData(0,0,692,204).data
// → buildFaceplateMod({ atlasRgba }) → BC3-encode → SGA
```
`ICON_RECT` and `BANNER_RECT` constants live in `faceplate-templates.ts`.

### Draw / mask / paint tools
Identical pattern to Decal editor: ephemeral `HTMLCanvasElement` (`liveStrokeCanvasRef`) appended to canvasRef on pointerdown, composite-on-pointerup into `layer.dataUrl` (FaceplateEditor.tsx:906–1024). Mask tool uses a separate `liveMaskStrokeCanvasRef` and writes to `layer.mask.dataUrl` (FaceplateEditor.tsx:1026–1178).

### Export coupling
`composeFaceplateCanvas(project: Coh2FaceplateProject): Promise<HTMLCanvasElement>` (FaceplateEditor.tsx:4316) is the primary seam. Callers receive an `HTMLCanvasElement`; they call `getImageData` to obtain `Uint8ClampedArray` → `buildFaceplateMod` → SGA.

---

## 3. Skin Texture Editor (`VehicleTextureEditor.tsx` + `Editor.tsx` paint path)

### Current rendering engine
Raw 2D Canvas (`CanvasRenderingContext2D`) for painting; Three.js `CanvasTexture` for the 3D viewport.

### Raster paint pipeline (brush strokes)
- **Canvases**: `baseDiffuseRef` (Editor.tsx:469) — a 2048² `HTMLCanvasElement` holding the current painted diffuse; `overlayCanvasRef` (Editor.tsx:462–468) — a 2048² `HTMLCanvasElement` compositing base+decals for the GPU.
- **Brush**: `paintBrushDab` / `paintBrushSegment` in `brush.ts` draw directly onto `baseDiffuseRef.current` via `ctx.arc / ctx.fill`. `VehicleTextureEditor.tsx:263` shows `ctx.drawImage(p.overlayCanvas, …)` for the 2D atlas view display.
- **Stroke commit**: After each stroke, `onComposite()` callback calls `repaint()` in Editor.tsx:904, which composites base+decals via `paintDecals` into `overlayCanvasRef`, then calls `bumpOverlay()` (Editor.tsx:520) to increment `overlayVersion`.
- **Undo snapshot**: `history.commit('stroke')` in `decal-history.ts` captures `baseDiffuseRef.current.toDataURL()` as the snapshot; restoring calls `ctx.drawImage(img, 0,0)` then `repaint()` (Editor.tsx:140–147, wired through `onDiffuseRestoredRef`).

### Live-sync repaint path to Three.js viewport
`overlayVersion` state (Editor.tsx:519) is passed as a prop to `<Viewport overlayVersion={overlayVersion}>` (Editor.tsx:1503). Inside `Viewport.tsx`, on `overlayVersion` change, the already-bound `CanvasTexture` has `needsUpdate = true` set (Viewport.tsx:785–822), which triggers Three.js to re-upload the 2048² canvas to the GPU on the next render frame. The `CanvasTexture` wraps `overlayCanvasRef.current` directly — it is never recreated; the same canvas element is mutated in place and only `needsUpdate` toggles.

**Critical constraint**: any engine swap for this editor must preserve the ability to paint onto an `HTMLCanvasElement` and then trigger `texture.needsUpdate` on the Three.js `CanvasTexture` wrapping that exact element.

### Export coupling
`mod-export.ts:exportSkinMod` reads `baseDiffuseRef.current` (passed as an `HTMLCanvasElement`) → `ctx.getImageData(0,0,2048,2048).data` → `canvasToRgt` → BC3 RGT → SGA. No object-model serialisation — the canvas pixel data IS the export input.

---

## 4. Shared Infrastructure

### `src/lib/editor-history.ts`
Generic `useHistoryEngine<S>` hook (editor-history.ts:48). Stores plain JS snapshots (`pastRef / futureRef` arrays of `{snap: S, label}`). Custom `HistoryAdapter<S, Snap>` allows callers to store a _projection_ instead of the full state — used by `decal-history.ts` which stores `{project, diffuseDataUrl}` pairs so brush-stroke undos restore both the project state and the canvas pixels. The engine provides `beginGesture / endGesture` for multi-tick drag gestures (one undo frame per drag). **An engine's own serialization would coexist (not replace)**: Konva/Fabric's node tree is not serialized; the existing plain-JS snapshot approach snapshots the editor's state objects, which would continue to be the source of truth. The engine's state is derived from project state on each render, not the other way around.

### `editor-shared/CanvasHandles.tsx`
DOM-only resize/rotate handles (CanvasHandles.tsx:73–312). Geometry-only props (`x,y,rotation,scale,scaleY,viewScale,bboxW,bboxH`). Emits `onResize(ResizeTransform)` / `onRotate(degrees)`. If Konva/Fabric is used, these handles would be replaced by the engine's own transformer widget; the `ResizeTransform` callbacks would be replaced by engine events.

### `editor-shared/TransformInputsRow.tsx`
Numeric X/Y/W/H/angle inputs (TransformInputsRow.tsx:1–50). Decoupled — calls `onChangeX/Y/W/H/Angle` callbacks. Survives an engine migration as-is if the parent binds to engine events.

### `src/lib/use-pan-zoom.ts`
Wheel + Space/middle-drag pan hook (use-pan-zoom.ts:105). Produces `{scale, offset, handlers}`. `scale` is used as `viewScale` in coordinate math (e.g. `(clientX - rect.left) / viewScale`). Konva/Fabric each have their own stage zoom/pan — this hook would be replaced by the engine's stage-level transform, but the `scale` value it produces currently threads through ALL drag/brush coordinate calculations, so every pointer handler would need updating.

---

## 5. Export Coupling Summary

| Editor | Export entry point | What it consumes | Format produced |
|---|---|---|---|
| Decal | `decal-pack-export.ts:exportDecalPackZip` | `rasteriseDecal(decal, bitmap)` → per-decal `OffscreenCanvas` | PNG blobs in ZIP |
| Decal (SGA) | `decal-mod-build.ts:buildDecalMod` | `partsForBake(project)` → `Uint8ClampedArray` per-part/faction | BC3 DDS in SGA |
| Faceplate | `faceplate-mod-build.ts:buildFaceplateMod` | `composeFaceplateCanvas(project)` → `getImageData` → `Uint8ClampedArray` | BC3 DDS in SGA |
| Skin | `mod-export.ts:exportSkinMod` | `baseDiffuseRef.current` (2048² `HTMLCanvasElement`) → `getImageData` | BC3 DDS in SGA |

---

## 6. Migration Assessment per Editor

### 6a. Decal Editor → Konva/Fabric fit: **GOOD — clean object-model map**

Each `Decal` record maps 1:1 to a Konva `Image` node (x, y, scaleX=scale, scaleY=scale, rotation, opacity, globalCompositeOperation, listening). The v6 atlas-part / faction inheritance adds bookkeeping complexity but the layer model stays flat per-cell. Konva's `Transformer` widget replaces `CanvasHandles.tsx` and `TransformInputsRow.tsx` adapter logic. Konva's stage pan/zoom replaces `use-pan-zoom.ts`.

Export seam is **independent** of the engine: `rasteriseDecal` / `compositePartLayers` use their own off-screen 2D canvases and take the plain-JS `Decal` record as input. As long as project state stays in the existing POD format (which it would under an engine migration that only replaces the interactive view), export is untouched.

Draw tool is raster (paint onto `sourceImages[srcId].dataUrl`) — this is a raster overlay inside the per-decal source image, not an engine layer. Keep it as a raw-canvas stroke that mutates the data URL, as today.

**Files rewritten**: DecalPackEditor.tsx (stage setup, layer rendering, handle wiring) — **L**  
**Files wrapped**: CanvasHandles.tsx replaced by Konva Transformer — **S**  
**Files untouched**: editor-history.ts, TransformInputsRow.tsx (could survive), decal-pack-export.ts, decal-pack-project.ts, atlas-parts.ts, use-pan-zoom.ts (replaced by Konva stage)

### 6b. Faceplate Editor → Konva/Fabric fit: **MODERATE — mixed raster/object model**

Object-model layers (text, image, shape) map to Konva nodes. However:
- `paint` layers are raster blobs (`dataUrl`) — handled as `Image` nodes loading the data URL, BUT painting onto them requires a raster brush overlay (same pattern as skin texture editor). Not directly Konva-native.
- `mask` painting (hide/reveal) writes to `layer.mask.dataUrl` — also raster.
- Curves (`CurvesEditor`) apply pixel-level LUT transforms — these need `getImageData` passes, which means off-screen canvas compositing on top of Konva nodes.
- `composeFaceplateCanvas` is the export path and runs completely off-screen — it reads project state, not the Konva node tree. It remains independent of the engine migration.

Konva's `Transformer` replaces `CanvasHandles.tsx`. The `blendMode` / `opacity` per-node map directly.

**Files rewritten**: FaceplateEditor.tsx (stage, layer rendering, draw/mask tool handlers) — **L**  
**Files wrapped**: CanvasHandles.tsx → Konva Transformer — **S**  
**Files untouched**: editor-history.ts, faceplate-project.ts, faceplate-mod-build.ts, composeFaceplateCanvas function (can stay in the same file), use-pan-zoom.ts (replaced by Konva stage)

### 6c. Skin Texture Editor → Konva/Fabric fit: **POOR — fundamentally raster; keep custom brush**

This editor is entirely raster:
- `baseDiffuseRef` is a raw 2048² `HTMLCanvasElement` that brushes paint directly onto.
- The Three.js `CanvasTexture` wraps this exact `HTMLCanvasElement`; `needsUpdate` must fire after each stroke to upload to GPU.
- Decal overlays are composited via `paintDecals` (raw 2D context) into `overlayCanvasRef`.
- Undo snapshots are `toDataURL()` snapshots of the raw canvas.

An engine like Konva/Fabric would manage its own pixel buffer — binding it to Three.js's `CanvasTexture` is non-trivial (Konva stages render to their own managed canvas, not an arbitrary external one). The brush dab/segment implementation (`brush.ts:paintBrushDab / paintBrushSegment`) draws directly onto the client's `CanvasRenderingContext2D`, which is exactly what Three.js sees via the `CanvasTexture` reference.

**Verdict**: Keep custom brush paint pipeline for the skin texture editor. Konva/Fabric would add complexity without benefit here since there are no object-model layers — only a flat raster canvas.

**Files rewritten (if any engine used for decal overlay positioning)**: Editor.tsx partial — **M** (only the decal-placement overlay rendering; brush/camo/texture pipeline stays)  
**Files untouched**: VehicleTextureEditor.tsx brush handlers, brush.ts, decal-painter.ts, mod-export.ts, vehicle-3d-renderer.ts/Viewport.tsx CanvasTexture wiring

---

## 7. Integration Seams

| Seam file | Role | Migration impact |
|---|---|---|
| `editor-shared/CanvasHandles.tsx` | Resize+rotate handles, shared by DPE+FPE | Replace with engine Transformer (Konva/Fabric); geometry-only interface makes this straightforward |
| `editor-shared/TransformInputsRow.tsx` | Numeric transform inputs, shared by DPE+FPE | Bind to engine node events instead of callback props; low-effort wrapper |
| `src/lib/use-pan-zoom.ts` | Wheel+Space pan/zoom, consumed by all three editors | Replace with engine's own stage pan/zoom for DPE/FPE; skin editor can keep it or use Konva's wheel handler |
| `src/lib/editor-history.ts` | Undo/redo engine, all three editors | Preserve as-is; continues to snapshot plain-JS project state. Engine's own history (if any) is redundant and should be disabled |
| `src/lib/decal-pack-export.ts:rasteriseDecal` | Per-decal 2D-context bake, DPE export | Untouched — reads `Decal` records, not engine nodes |
| `src/components/FaceplateEditor.tsx:composeFaceplateCanvas` (line 4316) | Off-screen export composer, FPE export | Untouched — reads `Coh2FaceplateProject` state, not engine nodes |
| `src/components/Editor.tsx` (`overlayCanvasRef` + `baseDiffuseRef` + `overlayVersion`) | Raster brush + Three.js CanvasTexture sync | Must be preserved for skin texture editor; central constraint of any GPU-texture migration |
