# Decal Editor Model — Layer-Compositor Migration Audit

> Goal: document the decal editor precisely enough to plan migrating it onto a
> shared layer-compositor core (the faceplate engine).
> All citations are `file:line`.

---

## 1. The DECAL PROJECT Model

### Schema: `Coh2DecalPackProject` (`decal-pack-project.ts`)

**Magic / version** (`decal-pack-project.ts:255-279`)  
`magic: 'coh2-decalpack-project'`, `version: 5 | 6`.  
v6 introduced the 6-part atlas. v1–v5 carried a flat `decals: Decal[]`.

**Source images** (`decal-pack-project.ts:313`)  
`sourceImages: Record<string, DecalSourceImage>` — base64 data URLs, natural width/height, stable id.

**6-part atlas structure** (`decal-pack-project.ts:246-253`)  
```
ATLAS_PART_DEFS[6] = [
  { name: 'Weathering Strips', region: { x:0,   y:0,   w:340, h:1024 }, locked: true },
  { name: 'Main Hull Badge',   region: { x:340, y:0,   w:684, h:512  } },
  { name: 'Turret Mini-Badges',region: { x:820, y:0,   w:204, h:512  } },
  { name: 'Unit Banner',       region: { x:400, y:400, w:624, h:300  } },
  { name: 'Commander Crest',   region: { x:600, y:600, w:424, h:200  } },
  { name: 'Reverse Hull Text', region: { x:200, y:800, w:824, h:224  } },
]
```
Each part lives in the 1024×1024 RGT coordinate space at `(region.x, region.y)`.

**`AtlasPart`** (`decal-pack-project.ts:229-243`)  
```
interface AtlasPart {
  index: number           // 0-based → ATLAS_PART_DEFS
  name: string
  shared: Decal[]         // layers for all factions unless overridden
  overrides?: Partial<Record<DecalFaction, Decal[]>>  // per-faction fork
  activeLayerId: string | null
  locked?: boolean        // part 0 (Weathering Strips) is locked
}
```
`project.parts[i].overrides[faction]` — absent key means "inherit shared".  
Fork-on-write: the first edit to a faction cell copies `shared` into `overrides[faction]` (`DecalPackEditor.tsx:413-414`).

**`Decal` record** (`decal-pack-project.ts:130-210`)  
Each layer carries geometry in the slot's pixel space (origin = top-left of `ATLAS_PART_DEFS[i].region`):
- `x`, `y` — centre position (part-local pixels)
- `scale` — uniform multiplier (1 = source 1:1)
- `rotation` — degrees CW
- `flipH`, `flipV` — boolean
- `opacity` — 0..1
- `blendMode?: DecalBlendMode` — maps to `globalCompositeOperation` (v4+)
- `tint?`, `stroke?`, `mask?`, `clippedToDecalBelow?` (v4+)
- `brightness?`, `contrast?`, `saturation?`, `hueRotate?` — CSS filter floats (v3+/v6.1)
- `visible: boolean`

**Active-cell selection** (`decal-pack-project.ts:320-327`)  
`project.activePartIndex` (0-based), `project.activeFaction: DecalFaction | null` (null = shared).

**Draw-tool raster** (`DecalPackEditor.tsx:1182-1360`)  
The draw tool paints directly onto `sourceImages[decal.sourceImageId].dataUrl` via an off-screen 128×128 canvas composited with the existing dataUrl, replacing it in the project. This mutates the source image, not the layer geometry.

---

## 2. The EDITOR UI (`DecalPackEditor.tsx`)

**Konva stage** (`DecalPackEditor.tsx:1643-1767`)  
`react-konva` `<Stage>` scaled by `viewScale` (pixel ratio of the CSS canvas div to 128 px).  
Each `Decal` in `cellDecals` maps to a `<KonvaImage>` with `x/y` in 128-space, `scaleX/Y` encoding `flipH/V × scale`, `rotation`, `opacity`, `globalCompositeOperation`.  
A single `<Transformer>` provides drag-resize-rotate handles.

**Pan/zoom** (`DecalPackEditor.tsx:670-675`)  
`usePanZoom` hook; the outer fixed wrapper receives wheel + pointer handlers; the canvas `div` translates by `pz.offset` and scales by `zoom`. Canvas size = `DECAL_PACK_SIZE × zoom` px.

**Part selector: `PartStepper`** (`DecalPackEditor.tsx:103`)  
Prev/Next buttons stepping `activePartIndex` 0–5; shows `ATLAS_PART_DEFS[i].name`.

**Faction selector: `FactionRow`** (`atlas/FactionRow.tsx:16-118`)  
Horizontal pill: one "Shared" tab (null) + 5 faction icon buttons. Sets `activeFaction`.

**Active-cell resolution** (`DecalPackEditor.tsx:371-379`)  
`cellDecals = activeFaction !== null ? (part.overrides?.[activeFaction] ?? part.shared) : part.shared`.  
Display falls back to shared if no override yet (inheritance for preview, fork-on-write for edits).

**FactionPartMatrix** (`DecalPackEditor.tsx:104`)  
Condensed 5×6 grid overview of all cells; toggled by a button in the toolbar.

**S5 default-slot reference** (`DecalPackEditor.tsx:281-341`)  
A `useEffect` composites `part.shared` layers via `compositePartLayers` into a 128×128 data URL shown as a right-panel "Preview" — shared layers only (faction overrides not shown).

**Shared component usage**  
- `ImageDropZone` (`editor-shared/ImageDropZone.tsx`) — wraps the whole editor; drop triggers `onImport`.  
- `TransformInputsRow` (`editor-shared/TransformInputsRow.tsx`) — numeric x/y/scale/rotation inputs in the Transform peel.  
- `useHistoryEngine` (`lib/editor-history`) — 50-deep undo stack; `beginGesture` / `endGesture` wraps drag+paint strokes.  
- `BlendModeSelect`, `BottomToolPill`, `ToolOptionsPeel`, `SliderPopover` — from `editor-primitives`.

---

## 3. The EXPORT — Contract to Preserve

### `rasteriseDecal` (`decal-pack-export.ts:158-306`)
Renders one `Decal` into a `DECAL_PACK_SIZE × DECAL_PACK_SIZE` (128×128) RGBA canvas.  
Transform order: translate → rotate → flip × scale → drawImage → tint → stroke → mask → clip.  
Supersample flag (`options.supersample`) scales the canvas up (e.g. ×4 = 512×512) while keeping 128-space coordinates. At `supersample=1` the output is byte-identical.

### `compositePartLayers` (`atlas-parts.ts:26-88`)
Composites a `Decal[]` list into a `partW × partH` RGBA buffer:
1. Each layer is rasterised at 128×128 via `rasteriseDecal`.
2. The 128×128 canvas is blit'd into the part canvas at `(layer.x − 64, layer.y − 64)` — part-local pixels.

### `partsForBake` (`atlas-parts.ts:103-135`)
For each part index 0–5:
- `entry.shared` = `compositePartLayers(part.shared, w, h, sourceImages)`
- `entry[faction]` = `compositePartLayers(part.overrides[faction], w, h, ...)` if override exists

Returns `Array<Partial<Record<DecalFaction | 'shared', Uint8ClampedArray>>>`.

### `buildDecalMod` (`decal-mod-build.ts:136-300`)
v6 path (`partRgbas` present):  
For each faction, blits each part's RGBA (prefer `partRgbas[i][faction]`, else `partRgbas[i].shared`) onto a blank 1024×1024 canvas at `(ATLAS_PART_DEFS[i].region.x, .region.y)`.  
The resulting 1024×1024 is binarised (luma+alpha threshold) → BC1 DXT1 RGT → `art/armies/<faction>/badges/<guid>/default_dif.rgt`.  
Five RGDs (per-faction attribute files) + UCS + INFO + icon/thumbnail DDS + GFX template → SGA archive verified with a round-trip parse.

**The bytes-identical constraint** lives in: `rasteriseDecal` (single-layer bake, supersample=1), `compositePartLayers` (multi-layer blit into part region), and `binariseMask` + `canvasToRgt` (DXT1 encoding). These three functions are the export pipeline's stable contract. None of them should change.

---

## 4. Mapping Question: Slot → Compositor Instance

**Current state**: each `AtlasPart` (index 0–5) is a "slot" with dimensions `ATLAS_PART_DEFS[i].region.{w, h}`. Its layer list `Decal[]` is conceptually equivalent to a faceplate compositor canvas — same `x/y/scale/rotation/opacity/blendMode/tint/stroke` geometry, same Konva rendering, same undo engine. The only differences are:
1. The slot has a *fixed, non-square* size (e.g. 684×512 for Main Hull Badge) vs. the faceplate's fixed square output.
2. Each slot has a **shared × 5-faction** matrix rather than a single layer stack.
3. The layer coordinate space is already part-local (not atlas-local), so `layer.x = 0` means the top-left of the slot — identical to a faceplate canvas origin.

**Proposed mapping**:

> A **slot** becomes a **compositor instance** whose canvas is sized to `(region.w, region.h)`. The shared compositor core receives a `Decal[]` list and renders it into that canvas. Part selection and faction selection become *host-level routing* that feeds a different `Decal[]` (shared or override) to the same compositor.

Concretely:

```
<CompositorCanvas
  width={ATLAS_PART_DEFS[activePartIndex].region.w}
  height={ATLAS_PART_DEFS[activePartIndex].region.h}
  layers={cellDecals}         // already resolved by host
  activeLayerId={cellActiveLayerId}
  onLayerChange={(updater) => mutateActiveCell(p, updater)}
/>
```

The `PartStepper` + `FactionRow` remain host UI above the compositor. They change `activePartIndex` / `activeFaction`, which drives `cellDecals` resolution (shared vs. override with fork-on-write). The compositor itself is stateless with respect to the part×faction matrix — it only sees the resolved `Decal[]` for the current cell.

**Shared / override semantics** map cleanly: the host resolves the cell before passing to the compositor; the compositor's `onLayerChange` callback receives the mutator which the host wraps in `mutateActiveCell` (fork-on-write is encapsulated there). The compositor never needs to know about factions.

**Export stays unchanged**: `compositePartLayers` already operates on a `Decal[]` + `(partW, partH)`, which is exactly what the compositor renders. The export contract (`rasteriseDecal` → blit at part-local coords → 1024×1024 atlas) is independent of what UI renders those layers.

---

## 5. What the Decal Editor Shares vs. What Is Bespoke

**Shared with faceplate**:
- `ImageDropZone` (`editor-shared/ImageDropZone.tsx`) — identical import and wire-up
- `TransformInputsRow` (`editor-shared/TransformInputsRow.tsx`) — same numeric inputs
- `useHistoryEngine` (`lib/editor-history`) — same engine, same `beginGesture`/`endGesture` API
- `react-konva` `Stage + Layer + KonvaImage + Transformer` — same integration pattern
- `usePanZoom` — same hook
- `BottomToolPill`, `ToolOptionsPeel`, `SliderPopover`, `BlendModeSelect`, `EditorHomeButton`, `GlassModal` — shared primitives

**Decal-bespoke**:
- `PartStepper` + `FactionRow` + `FactionPartMatrix` — part×faction host UI
- `mutateActiveCell` + `setActiveCellLayerId` — fork-on-write cell routing (no faceplate equivalent)
- Draw tool — raster paint onto `sourceImages[id].dataUrl` (faceplate has no such tool)
- `rasteriseDecal` — the single-layer bake (faceplate uses its own compositing path)
- `compositePartLayers` / `partsForBake` — atlas-specific multi-layer bake helpers
- `ATLAS_PART_DEFS` + 6-part project schema (v6)
- `buildDecalMod` SGA builder — entirely separate from `buildFaceplateMod`

---

## Proposal Summary

A decal slot maps to a compositor instance sized `(region.w × region.h)`. The compositor core (Konva Stage, layer list, transform handles, history, blend modes) is shared; the part×faction matrix and fork-on-write routing remain as thin host UI above it. The export pipeline (`rasteriseDecal` → `compositePartLayers` → atlas blit → DXT1 RGT) is untouched.

---

## Top 3 Risks

1. **Byte-identical export**: `rasteriseDecal` uses canvas 2D API rendering; any change to how layers are passed to it (e.g., pre-scaling for non-128 canvas) must not alter the 128×128 blit into `compositePartLayers`. The blit arithmetic `(layer.x − 64, layer.y − 64)` in `atlas-parts.ts:79-84` must be preserved exactly.

2. **Part × faction / shared-override model**: the fork-on-write mechanic (`mutateActiveCell`, `DecalPackEditor.tsx:401-426`) is the semantic glue. Migrating to a shared compositor must not dissolve this — the compositor must remain oblivious to factions, and the host must remain the sole owner of cell resolution and fork logic.

3. **Draw tool source-mutation**: the draw tool writes back to `sourceImages[id].dataUrl` (`DecalPackEditor.tsx:1297-1360`), making source images mutable at runtime. A shared compositor core that treats source images as read-only would need an explicit mutable-source-image extension point; this has no faceplate analogue.
