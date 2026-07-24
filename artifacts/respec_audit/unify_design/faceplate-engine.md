# Faceplate Layer-Compositor Engine — Extraction Design

> Read-only audit for the "unify editors" initiative.
> Goal: identify a reusable core that the decal + texture editors can adopt.

---

## 1. The Layer Model

**File:** `src/lib/faceplate-project.ts`

### Layer types (union: `FaceplateLayer` — line 459)

| Kind | Interface | Key-specific fields |
|---|---|---|
| `image` | `ImageLayer` (L277) | `imageId`, `scaleY`, `flipH`, `flipV`, `filters?: ImageLayerFilters`, `stroke?: LayerStroke` |
| `text` | `TextLayer` (L376) | `text`, `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `color`, `align`, `strokeColor`, `strokeWidth`, `letterSpacing`, `lineHeight`, `stroke` |
| `shape` | `ShapeLayer` (L309) | `shapeType: ShapeKind`, `width`, `height`, `fillColor`, `stroke`, `gradientFill`, `cornerRadius` |
| `paint` | `PaintLayer` (L417) | `dataUrl: string`, `width: 624`, `height: 204`, `stroke` |
| `group` | `GroupLayer` (L445) | `childIds: string[]`, `name`, `collapsed` |

### BaseLayer schema (L172) — shared by all except `GroupLayer`

- `id`, `x`, `y` (center-origin canvas pixels), `rotation` (degrees CW), `scale`, `opacity 0..1`
- `locked: boolean` (legacy), `lockFlags?: { position?, aspect? }` (L164)
- `visible: boolean`, `shadow?: LayerShadow` (L143), `blendMode?: BlendMode` (L62–99)
- `mask?: LayerMask` (L109) — white=visible, black=hidden, `enabled?`, `invert?`
- `clippedToLayerBelow?: boolean` (L218), `name?: string` (L222)

**Z-order:** `project.layers` is a flat array, bottom-first — last entry renders on top (L521 of composer loop: `for (const layer of p.layers)`). Groups reference child ids but children remain in the flat array.

**Canvas dimensions:** `FACEPLATE_BANNER_W = 624`, `FACEPLATE_BANNER_H = 204` (L37–38). These are baked into `PaintLayer.width/height` type literals and into `newPaintLayer()` (L783), making them the only structurally hardcoded-size layer type.

---

## 2. The Konva View

**File:** `src/components/FaceplateEditor.tsx`

### Stage setup (L2120–2137)

A single `<Stage>` at `FACEPLATE_BANNER_W * viewScale` × `FACEPLATE_BANNER_H * viewScale`, with `scaleX={viewScale}` / `scaleY={viewScale}`. All layer nodes live in one `<Layer>`.

### Node mapping (one Konva node per layer kind)

- **image** → `<KonvaImage>` with `image={konvaImages[layer.imageId]}` + `KonvaFilter[]` built by `buildKonvaImageFilters()` (L185–231) for live preview of filter adjustments. Cached via `node.cache()` when filters are active (L1098–1123).
- **text** → `<KonvaText>` with font/fill/stroke props read directly from the `TextLayer` schema.
- **shape** → `<KonvaShape>` with a `sceneFunc` that re-runs `shapeToPath2D()` — the same helper used by `composeFaceplateCanvas` so live preview matches export.
- **paint** → `<KonvaImage>` wrapping an offscreen `HTMLCanvasElement` so it composites at the correct z-order inside the Stage.
- **group** → no Konva node; children render independently via their own slots.

### Transformer & selection (L884–939)

`transformerRef` (Konva.Transformer) is attached to the primary + multi-selected node list via `attachTransformerToIds()` (L921). Transform is suppressed in draw/eraser/mask tool modes. `handleKonvaTransformEnd` (L942) reads `node.x/y/rotation/scaleX/scaleY` back to project state via `mutate` + `history.endGesture()`.

### Drag (L984–1047)

`handleKonvaDragEnd` is gesture-granular (one undo frame for multi-select group moves). Alt-drag clones a layer at drop position. `handleKonvaDragMove` (L1070) applies snap targets and moves companion nodes by the same delta.

### Draw / Paint / Mask overlays (L1487–1996)

When `activeTool === 'draw'|'eraser'|'mask'`, the Stage receives `pointerEvents: 'none'` and a raw `HTMLCanvasElement` is created as a live-stroke overlay appended to `canvasRef.current`. On pointer-up the stroke is composited into the `PaintLayer.dataUrl` via an offscreen canvas and committed via `mutate`. `history.beginGesture('Paint')` / `endGesture()` wrap the entire stroke into one undo frame.

### Pan/zoom (L543–548)

`usePanZoom` hook (`src/lib/use-pan-zoom.ts`). Returns `{ scale, offset, handlers, fitToWindow, resetTo100, setScale, isPanGesture }`. Zoom range `ZOOM_MIN=0.25 .. ZOOM_MAX=8` (L25–26 of use-pan-zoom.ts). Container gets `{...pz.handlers}`; content div gets `transform: translate(${pz.offset.x}px, ${pz.offset.y}px)` (L1419). The Konva Stage carries `scaleX/Y={viewScale}` and zero transform — the document surface wrapper holds the pan offset. `fitToWindow()` respects `FIT_INSET = { left:224, right:238, top:64, bottom:108 }` (L542) to clear floating panels.

### Document surface

The visible 624×204 canvas lives inside a `#2a2d3c` "document" surface `div` padded 24px on each side (L1416–1444). A `CanvasPlaceholder` (editor-primitive) is shown when `layers.length === 0` and no background color.

---

## 3. The Panels

### LayersPanel (`src/components/editor-shared/LayersPanel.tsx`)

**Props interface** (`LayersPanelProps`, L58–83):

```ts
project: Coh2FaceplateProject        // full project — reads layers + images
selectedId: string | null
multiSelectedIds: Set<string>
renamingLayerId: string | null
dragLayerId: string | null
dragOverLayerId: string | null
mutate(fn, opts?): void              // goes through history engine
onSelectLayer(id, multi?, shift?): void
onStartRename / onEndRename
onDragStart / onDragOver / onDrop / onDragEnd
getLayerLabel(layer): string         // host supplies display logic
getLayerThumbnail(layer): ReactNode  // host supplies thumbnail rendering
onContextMenu(id, x, y): void
onClickOutside?(): void
```

**Faceplate coupling:** The panel imports `Coh2FaceplateProject` and `FaceplateLayer` from `faceplate-project.ts` (L38). It reads `project.layers` and uses `BlendMode` / `BLEND_MODES` from the same file. `getLayerLabel` and `getLayerThumbnail` are injected by the host, so layer-type display logic is host-controlled — this is a seam for extraction. The `mapLayer` helper is redeclared inline (L185–189) rather than imported from the host.

**Genericity rating:** Medium. The panel's DOM structure and interactions are fully generic; the only coupling is the `Coh2FaceplateProject` type signature. Parameterizing it over a generic project/layer interface would decouple it completely.

### PropertiesPanel (`src/components/editor-shared/PropertiesPanel.tsx`)

**Props interface** (`PropertiesPanelProps`, L71–85):

```ts
project: Coh2FaceplateProject
selectedLayer: FaceplateLayer | null
multiSelectedIds?: Set<string>
mutate(fn, opts?): void
adjustImageOpen: boolean
onToggleAdjustImage(): void
onOpenCurves(): void
```

**Faceplate coupling:** Imports `FACEPLATE_BANNER_W`, `FACEPLATE_BANNER_H`, `LAYER_SHADOW_DEFAULTS`, layer types directly from `faceplate-project.ts` (L43–55). Internally renders type-specific UI branches for text/shape/image. Canvas dimensions are used for the align/distribute calculations. More faceplate-coupled than LayersPanel — would need the canvas size passed as props and the layer type guards kept generic.

---

## 4. The History Engine

**File:** `src/lib/editor-history.ts`

`useHistoryEngine<S, Snap>` (L48) — generic, project-type-agnostic. Takes:
- `getState: () => S` — stable getter
- `setState: React.Dispatch<React.SetStateAction<S>>` — React state setter
- `options.adapter?: HistoryAdapter<S, Snap>` — for partial snapshots (e.g. canvas pixels separate from JSON state)
- `options.limit?: number` (default 50)
- `options.onPersist?: (next: S) => void` — called after every mutate/undo/redo for auto-save
- `options.onAfterRestore?: (snap: Snap) => void` — for side effects post-undo (e.g. reloading canvas)

Returns `{ mutate, commit, beginGesture, endGesture, undo, redo, canUndo, canRedo }`.

**Gesture-granular:** `beginGesture(label)` lazily captures a snapshot (only pushed to undo stack on first `mutate`), so no-op clicks don't pollute the undo stack (L97–116). `endGesture()` finalizes (L118). The faceplate editor wraps drag transforms and paint strokes with `history.beginGesture / endGesture` (e.g., L976, L1607, L1635). **Already fully generic — zero faceplate coupling.**

---

## 5. Compose / Export

**Function:** `composeFaceplateCanvas(p: Coh2FaceplateProject): Promise<HTMLCanvasElement>` (L4956, `FaceplateEditor.tsx`)

Creates a `624×204` canvas, fills background, then iterates `p.layers` bottom-to-top:
- text: ctx translate/rotate/scale, font/fill/stroke (L4991–5054)
- paint: drawImage full-banner (L5057–5149)
- shape: Path2D + fill/stroke ± gradient (L5152–5220)
- group: skipped — children already in flat loop (L5227)
- image: ctx translate/rotate/scale + flipH/V + CSS filters + noise (L5229–5406)

Each layer applies `opacity`, `blendMode`, `shadow`, `mask`, `clippedToLayerBelow` uniformly.

**Faceplate-specific parts:**

1. Canvas size is hardcoded to `FACEPLATE_BANNER_W × FACEPLATE_BANNER_H` (L4957–4958).
2. The compose function lives in `FaceplateEditor.tsx` (noted as tight coupling to inline shape helpers — comment at L4926).
3. The **atlas packaging** (`composeFaceplateCanvas` → `atlasCanvas 692×204` → draw banner at x=0 + icon sub-rect at x=624,y=0) is in `handleRequestBuild` (L1272–1291), using constants from `faceplate-templates.ts`: `ATLAS_WIDTH=692`, `ATLAS_HEIGHT=204`, `BANNER_RECT={x:0,y:0,w:624,h:204}`, `ICON_RECT={x:624,y:0,w:64,h:64}` (faceplate-templates.ts L126–147). This atlas layout and the `inventoryIcon` override (project field L537) are entirely faceplate-specific.

**Generic part:** The per-layer compositing loop (opacity + blendMode + shadow + mask + clippedToLayerBelow) is fully generic and can be parameterized by `canvasWidth`, `canvasHeight`.

---

## 6. The Toolbar

**BottomToolPill** (`src/components/editor-primitives/BottomToolPill.tsx`, L25–66):

Generic: `tools: readonly ToolDef<TId>[]`, `activeId: TId | null`, `onSelect(id): void`, `extras?: ToolExtra[]`. Fully type-parameterized — zero domain coupling.

**Faceplate tool set** (`FaceplateEditor.tsx` L1255–1262):

```ts
type FaceplateToolId = 'select' | 'text' | 'shapes' | 'draw' | 'eraser' | 'mask'
const FACEPLATE_TOOLS: readonly ToolDef<FaceplateToolId>[] = [ ... ]
```

**ToolOptionsPeel** (`editor-primitives/ToolOptionsPeel.tsx`): generic floating panel for options; takes `activeId`, `label`, `children`. Zero domain coupling.

Each tool peel's content (brush sliders, shape picker, mask controls) is faceplate-authored JSX inside `FaceplateEditor.tsx`. The peel container is generic; the content is domain-specific.

---

## 7. What's Already Shared vs. Faceplate-Specific

### Already shared (`editor-shared/`, `editor-primitives/`)

| File | Status |
|---|---|
| `editor-primitives/BottomToolPill` | Generic (TId-parameterized) |
| `editor-primitives/ToolOptionsPeel` | Generic |
| `editor-primitives/AdjustmentPanel` | Generic (filter sliders) |
| `editor-primitives/BlendModeSelect` | Generic |
| `editor-primitives/GradientFillEditor` | Generic |
| `editor-primitives/CurvesEditor` | Generic |
| `editor-primitives/TransformPanel` | Generic |
| `editor-primitives/SliderRow / SliderPopover / etc.` | Generic |
| `editor-shared/LayersPanel` | Med-generic (project type is faceplate) |
| `editor-shared/PropertiesPanel` | Low-generic (imports canvas dims + all layer types) |
| `editor-shared/ImageDropZone` | Generic |
| `editor-shared/TransformInputsRow` | Generic |
| `editor-shared/CanvasHandles` | Generic |
| `lib/editor-history` | Fully generic |
| `lib/use-pan-zoom` | Fully generic |

### Faceplate-specific (must be parameterized or replaced per consumer)

1. **`faceplate-project.ts`** — the `Coh2FaceplateProject` / `FaceplateLayer` schema with `FACEPLATE_BANNER_W/H` baked into `PaintLayer` type literals and constructors.
2. **`composeFaceplateCanvas`** — hardcoded `624×204` output; the atlas packaging (692×204 atlas, icon sub-rect) and `inventoryIcon` logic.
3. **`faceplate-mod-build.ts`** / `faceplate-templates.ts` — mod export pipeline, atlas dimensions, CoH2-specific GFX/SGA plumbing.

---

## Proposed Reusable Core Boundary

### Extract: `layer-compositor-core/`

```
lib/
  layer-compositor-core/
    layer-model.ts       ← BaseLayer, BlendMode, LayerMask, LayerShadow, ImageLayerFilters
                           (no canvas-size constants, no PaintLayer hardcoded dims)
    compose-canvas.ts    ← composeLayers(layers, images, canvasW, canvasH, bg) — parameterized
    editor-history.ts    ← already generic, just re-export
    use-pan-zoom.ts      ← already generic, just re-export
components/
  editor-shared/
    LayersPanel.tsx      ← genericize: Project<L extends BaseLayer> instead of Coh2FaceplateProject
    PropertiesPanel.tsx  ← genericize: canvasW/H as props; layer-type sections injected as children
```

### What each consumer supplies

| Consumer | Canvas size | Export mapping | Extra UI |
|---|---|---|---|
| **Faceplate** | `624×204` → atlas `692×204` | banner rect + icon sub-rect + SGA build | inventoryIcon picker, faction/workshop |
| **Decal** | per-decal cell size | direct PNG per cell, decal-pack SGA | slot/cell selector, per-slot mask |
| **Texture** | per-vehicle atlas tile | rgt/bc-encode pipeline | UV wireframe overlay, vehicle picker |

### Top 3 things that are faceplate-specific and must be parameterized

1. **Canvas dimensions + PaintLayer type literals** (`FACEPLATE_BANNER_W=624`, `FACEPLATE_BANNER_H=204` are structural, not just display). A generic core must accept `(canvasW, canvasH)` and construct PaintLayer with those values, not literal `624×204` types.

2. **Atlas packaging** — the `692×204` atlas layout (banner at x=0, icon sub-rect at x=624) and the `inventoryIcon` override are entirely faceplate-specific. Each consumer supplies its own "compose to exportable canvas" function wrapping the generic layer compositor.

3. **Project schema identity** (`magic: 'coh2-faceplate-project'`, `guid`, `workshopId`, faction/slot concepts) — `LayersPanel` and `PropertiesPanel` currently import `Coh2FaceplateProject` directly. Genericizing requires a minimal `GenericLayerProject<L>` interface carrying only `{ layers: L[], images, backgroundColor }`, leaving meta fields per-consumer.
