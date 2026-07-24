# Unified Layer-Compositor Core — Implementation Plan

_Self-contained brief for implementation agents. Do NOT re-read the groundwork docs._

---

## CONSTRAINTS

Every phase must satisfy all of the following before the next phase begins:

1. **Byte-identical exports**
   - `composeFaceplateCanvas` output: existing golden pixel-sum tests in `src/lib/__tests__/faceplate-export-golden.test.ts` must stay green (zero diff in fingerprint).
   - `compositePartLayers` / `rasteriseDecal`: existing tests in `src/lib/__tests__/atlas-parts.test.ts` and `src/lib/__tests__/decal-pack-export.test.ts` must stay green.
   - Skin/texture diffuse: `persistBrushStroke()` writes `baseDiffuse.toDataURL('image/png')` to `customDiffuseUrl`; this path must remain unchanged. Export reads that URL via `effectiveCustomDiffuseUrl` — zero changes to `lib/mod-export.ts` or any SGA-writer byte logic.
   - **Never touch**: `src/lib/faceplate-mod-build.ts`, `src/lib/decal-mod-build.ts`, `src/lib/mod-export.ts`, `src/lib/sga-writer.ts`, `src/lib/rgt-writer.ts`.

2. **Live 3D CanvasTexture sync preserved**
   - `overlayCanvasRef.current` (`Editor.tsx:486–491`) is a single, stable `HTMLCanvasElement` allocated once and bound to `CanvasTexture` in `Viewport.tsx:3949–4001`. Its identity must never change.
   - The only GPU-upload path is: `overlayDirtyRef.current = true` → RAF tick at `Viewport.tsx:1245` → `overlayTexRef.current.needsUpdate = true`. Nothing may bypass or duplicate this path.

3. **Editor-history semantics preserved**
   - `useHistoryEngine` (`src/lib/editor-history.ts`) is already fully generic — zero changes to it.
   - Gesture granularity (`beginGesture` / `endGesture`) must wrap every drag and paint stroke in every editor, exactly as today.

4. **TypeScript clean + vitest green per phase**
   - Run `tsc --noEmit` and `vitest run` after each phase; zero new errors permitted.

5. **Dark-glass design** — no visual changes to chrome, no new CSS variables introduced in shared code.

6. **No eager project migration** — old `.json` projects must load in all three editors without modification. Version fields and magic strings are untouched.

---

## THE UNIFIED CORE

### Files to create: `src/lib/layer-compositor/`

#### `src/lib/layer-compositor/layer-model.ts`

Extract from `src/lib/faceplate-project.ts` (read-only copy — do not delete from faceplate-project.ts yet):

```ts
// Re-export the types that are already generic in faceplate-project.ts.
// faceplate-project.ts keeps its own copies until Phase 0 swap-over.
export type { BlendMode, BLEND_MODES } from '@/lib/faceplate-project'
export type { LayerShadow } from '@/lib/faceplate-project'
export type { LayerMask } from '@/lib/faceplate-project'
export type { ImageLayerFilters } from '@/lib/faceplate-project'
export type { BaseLayer } from '@/lib/faceplate-project'

/** Minimal project shape the compositor and generic panels need. */
export interface GenericLayerProject<L extends { id: string; visible: boolean }> {
  layers: L[]
  images: Record<string, { id: string; dataUrl: string; name: string }>
  backgroundColor?: string
}
```

`GenericLayerProject<L>` deliberately carries only what `composeLayers`, `LayersPanel`, and `PropertiesPanel` need. All faceplate/decal/texture meta fields (`guid`, `magic`, `parts`, `vehicles`, etc.) remain in their respective project types.

#### `src/lib/layer-compositor/compose-canvas.ts`

Extracted and parameterised from `composeFaceplateCanvas` (`FaceplateEditor.tsx:4956`).

```ts
/**
 * Generic layer compositor — extracted from composeFaceplateCanvas.
 * Renders a GenericLayerProject<FaceplateLayer>-compatible layer list
 * into a canvasW × canvasH HTMLCanvasElement.
 *
 * Byte-identical with composeFaceplateCanvas when called with
 * canvasW=624, canvasH=204 on a Coh2FaceplateProject. Proven by golden test.
 */
export async function composeLayers<L extends BaseLayer>(
  layers: L[],
  images: Record<string, { id: string; dataUrl: string; name: string }>,
  canvasW: number,
  canvasH: number,
  backgroundColor: string | undefined,
  /** Host supplies per-layer rendering beyond the generic BaseLayer fields. */
  renderLayer: (ctx: CanvasRenderingContext2D, layer: L, byId: Map<string, HTMLImageElement>) => void,
): Promise<HTMLCanvasElement>
```

The generic loop handles: `layer.visible`, `layer.opacity`, `layer.blendMode`, `layer.shadow`, `layer.mask`, `layer.clippedToLayerBelow`. Each layer-kind branch is delegated to `renderLayer` — a host-supplied callback. For Phase 0, `FaceplateEditor.tsx` supplies its current switch/case logic as `renderLayer`, proving byte-identity before removing anything.

#### `src/components/editor-shared/LayersPanel.tsx` (genericized in place)

Replace the two faceplate-specific type parameters. The panel's DOM and interactions are already fully generic; only the prop types change:

```ts
// BEFORE
import { type Coh2FaceplateProject, type FaceplateLayer } from '@/lib/faceplate-project'
export interface LayersPanelProps {
  project: Coh2FaceplateProject
  mutate(fn: (p: Coh2FaceplateProject) => Coh2FaceplateProject, opts?): void
  getLayerLabel(layer: FaceplateLayer): string
  getLayerThumbnail(layer: FaceplateLayer): React.ReactNode
  // ...
}

// AFTER
import type { GenericLayerProject } from '@/lib/layer-compositor/layer-model'
export interface LayersPanelProps<L extends { id: string; visible: boolean; name?: string; blendMode?: BlendMode }> {
  project: GenericLayerProject<L>
  mutate(fn: (p: GenericLayerProject<L>) => GenericLayerProject<L>, opts?): void
  getLayerLabel(layer: L): string
  getLayerThumbnail(layer: L): React.ReactNode
  // all other props unchanged
}
```

`BLEND_MODES` and `BlendMode` move to `layer-model.ts` and are re-exported from `faceplate-project.ts` so existing imports compile without change.

#### `src/components/editor-shared/PropertiesPanel.tsx` (genericized in place)

`FACEPLATE_BANNER_W/H` usage (align/distribute at lines 787, 801, 1087–1099) is replaced with `props.canvasW` / `props.canvasH`. All layer-type-specific UI sections (text, shape, image filters) become optional `children` or host-injected render props. The generic panel retains: opacity slider, blend mode select, shadow controls, visibility toggle. Faceplate-specific sections move to a `FaceplatePropertiesExtension` component in `FaceplateEditor.tsx`.

```ts
// AFTER signature (abbreviated)
export interface PropertiesPanelProps<L extends BaseLayer> {
  project: GenericLayerProject<L>
  selectedLayer: L | null
  multiSelectedIds?: Set<string>
  canvasW: number
  canvasH: number
  mutate(fn: (p: GenericLayerProject<L>) => GenericLayerProject<L>, opts?): void
  /** Host renders type-specific controls below the generic section. */
  layerTypeControls?: React.ReactNode
  adjustImageOpen: boolean
  onToggleAdjustImage(): void
  onOpenCurves(): void
}
```

---

## PHASES

### Phase 0 — Extract core + refactor faceplate onto it (proving ground)

**Goal:** Extract `composeLayers` and generic panels; refactor `FaceplateEditor` as the first consumer. Faceplate golden tests prove byte-identity. All other editors unchanged.

**File ownership:**

| Action | File |
|---|---|
| CREATE | `src/lib/layer-compositor/layer-model.ts` |
| CREATE | `src/lib/layer-compositor/compose-canvas.ts` |
| CREATE | `src/lib/layer-compositor/index.ts` (barrel) |
| EDIT | `src/components/editor-shared/LayersPanel.tsx` — genericize props |
| EDIT | `src/components/editor-shared/PropertiesPanel.tsx` — genericize props, extract `canvasW/H` |
| EDIT | `src/components/FaceplateEditor.tsx` — (a) import `composeLayers` from core, make `composeFaceplateCanvas` a thin wrapper calling `composeLayers` with its `renderLayer`; (b) update `LayersPanel` / `PropertiesPanel` call sites with explicit type args + `canvasW={FACEPLATE_BANNER_W}` |

**Implementation anchors:**

- `composeFaceplateCanvas` at `FaceplateEditor.tsx:4956` becomes:
  ```ts
  export async function composeFaceplateCanvas(p: Coh2FaceplateProject): Promise<HTMLCanvasElement> {
    return composeLayers(p.layers, p.images, FACEPLATE_BANNER_W, FACEPLATE_BANNER_H, p.backgroundColor, faceplateRenderLayer)
  }
  ```
  where `faceplateRenderLayer` is the existing switch/case block extracted inline to a named function just above. Its logic is IDENTICAL — not rewritten.

- `LayersPanel` call site in `FaceplateEditor.tsx` — add `<LayersPanel<FaceplateLayer> project={project} ...>`.
- `PropertiesPanel` call site — add `canvasW={FACEPLATE_BANNER_W} canvasH={FACEPLATE_BANNER_H}`.
- `faceplate-project.ts` continues to export `BlendMode`, `BLEND_MODES`, `BaseLayer`, etc. — `layer-model.ts` re-exports them (no duplication).

**Tests to add:**

- `src/lib/__tests__/compose-canvas-golden.test.ts` — calls `composeLayers` directly with `FACEPLATE_BANNER_W/H` and the faceplate `renderLayer`, asserts pixel fingerprint equals `composeFaceplateCanvas` output on the same project. Proves extraction is byte-identical.
- Existing `faceplate-export-golden.test.ts` stays green (no change to the export function signature).
- Add a test confirming `LayersPanel` does NOT import from `faceplate-project` (mirrors the existing `canvas-handles-transform.test.ts` pattern at line 29).

**Verification commands:**
```bash
tsc --noEmit
vitest run src/lib/__tests__/faceplate-export-golden.test.ts
vitest run src/lib/__tests__/compose-canvas-golden.test.ts
vitest run src/lib/__tests__/atlas-parts.test.ts      # should be untouched
```

**Done when:**
- [ ] `tsc --noEmit` clean
- [ ] All existing faceplate golden tests green
- [ ] New `compose-canvas-golden` test green
- [ ] `LayersPanel` + `PropertiesPanel` no longer import from `faceplate-project`
- [ ] `DecalPackEditor.tsx` and `Editor.tsx` / `VehicleTextureEditor.tsx` are UNCHANGED

---

### Phase 1 — Decal editor adopts the core

**Goal:** `DecalPackEditor` uses `LayersPanel<Decal>` and `PropertiesPanel<Decal>`. The active compositor canvas is sized to the active slot's region. Export pipeline (`compositePartLayers`, `rasteriseDecal`) is UNCHANGED.

**Prerequisite:** Phase 0 complete and green.

**File ownership:**

| Action | File |
|---|---|
| EDIT | `src/components/editor-shared/LayersPanel.tsx` — no code change (already generic from Phase 0); DecalPackEditor just imports it |
| EDIT | `src/components/editor-shared/PropertiesPanel.tsx` — no code change; DecalPackEditor imports it |
| EDIT | `src/components/DecalPackEditor.tsx` — (a) replace bespoke layers list UI with `<LayersPanel<Decal>>`; (b) replace bespoke properties UI with `<PropertiesPanel<Decal> canvasW={activePartDef.region.w} canvasH={activePartDef.region.h}>`; (c) add draw-tool mutable-source extension via `layerTypeControls` render prop |

**Key implementation details:**

The `Decal` type (`decal-pack-project.ts`) must satisfy `BaseLayer` structurally. Verify: `Decal` has `id`, `visible`, `opacity`, `blendMode`, `shadow`, `mask`— all present (confirmed at `decal-pack-project.ts:130-210`). Add a type assertion in a test to lock this down.

`mutateActiveCell` remains the sole owner of fork-on-write. The `LayersPanel` `mutate` prop receives a wrapper:
```ts
mutate={(fn) => {
  mutateActiveCell(project, cellDecals => {
    const synthetic = { layers: cellDecals, images: project.sourceImages }
    return fn(synthetic).layers
  })
}}
```
The `PropertiesPanel` receives the same wrapping pattern. The compositor is NEVER told about factions.

Draw-tool source-image mutation (`DecalPackEditor.tsx:1297-1360`): passed as `layerTypeControls` JSX into `PropertiesPanel` — the panel renders it below the generic section. No change to the draw-tool logic itself.

`PartStepper` + `FactionRow` + `FactionPartMatrix` remain host UI above the compositor — zero changes.

**Tests to add:**

- `src/lib/__tests__/decal-adopts-core.test.ts`:
  - Assert `Decal` satisfies `BaseLayer` constraint (compile-time: `const _: BaseLayer = {} as Decal`).
  - Assert `compositePartLayers` output (pixel fingerprint) is unchanged when called with the same fixture project before and after this phase (compare against a stored fingerprint from Phase 0).
- Keep all existing `atlas-parts.test.ts`, `decal-pack-export.test.ts` green.

**Verification commands:**
```bash
tsc --noEmit
vitest run src/lib/__tests__/atlas-parts.test.ts
vitest run src/lib/__tests__/decal-pack-export.test.ts
vitest run src/lib/__tests__/decal-adopts-core.test.ts
```

**Done when:**
- [ ] `tsc --noEmit` clean
- [ ] All decal export tests green
- [ ] `DecalPackEditor` uses `LayersPanel<Decal>` and `PropertiesPanel<Decal>`
- [ ] Fork-on-write (`mutateActiveCell`) still the sole mutation path for cell layers
- [ ] `compositePartLayers` source unchanged

---

### Phase 2 — Texture editor adopts the core (layer stack + incremental paint path)

**Goal:** `VehicleTextureEditor` / `Editor.tsx` gains a typed layer stack (`BaseDiffuse`, `PaintLayer`). The compositor writes into `overlayCanvasRef`. Full composite runs at stroke end only; per-dab path is incremental. Live 3D sync unchanged. Export unchanged.

**Prerequisite:** Phase 1 complete and green.

**File ownership:**

| Action | File |
|---|---|
| CREATE | `src/lib/texture-layer-model.ts` — `TextureLayer` union + `TextureLayerProject` extending `GenericLayerProject<TextureLayer>` |
| EDIT | `src/components/Editor.tsx` — add `textureLayersRef`, `belowPaintSnapshotRef`; wire `onStrokeBegin/End` to full composite; wire `onComposite` (per-dab) to incremental composite |
| EDIT | `src/components/VehicleTextureEditor.tsx` — (a) thread `belowPaintSnapshot` prop; (b) incremental dab: blit snapshot + PaintLayer only; (c) stroke end: call full `composeLayers` path |

**Layer model (`src/lib/texture-layer-model.ts`):**

```ts
type TextureLayerKind = 'base-diffuse' | 'paint'

interface BaseDiffuseLayer extends BaseLayer {
  kind: 'base-diffuse'
  // no extra fields — data comes from vanillaDiffuseRef
}

interface TexturePaintLayer extends BaseLayer {
  kind: 'paint'
  // no dataUrl — the canvas is the live baseDiffuseRef
}

export type TextureLayer = BaseDiffuseLayer | TexturePaintLayer

export interface TextureLayerProject extends GenericLayerProject<TextureLayer> {
  canvasW: 2048
  canvasH: 2048
}
```

**Critical perf constraint — incremental paint path:**

The 2048² canvas has ~4.2M pixels. Full `composeLayers` per dab would exceed the 16 ms frame budget at fast drag speeds. The mitigation is mandatory:

1. **At `onStrokeBegin`** (pointer down): capture a "below-paint" snapshot of all layers BELOW the `PaintLayer` composited into a 2048² offscreen canvas (`belowPaintSnapshotRef`). This is a single `composeLayers` call — ~5-10 ms, happens once per stroke.
2. **Per dab (`onComposite`)**: draw `belowPaintSnapshotRef` into `overlayCanvasRef` (one `drawImage`, ~1-2 ms), then draw `baseDiffuseRef` (the PaintLayer canvas) on top (one `drawImage`, ~1-2 ms). Total per-dab: ~2-4 ms. Call `bumpOverlay()`.
3. **At `onStrokeEnd`**: run full `composeLayers` into `overlayCanvasRef`, then `bumpOverlay()`, then `persistBrushStroke()` (existing). The below-paint snapshot is freed.

Implementation anchor in `Editor.tsx`:
```ts
// At stroke begin
const belowSnapshot = document.createElement('canvas')
belowSnapshot.width = belowSnapshot.height = 2048
const belowLayers = textureLayers.filter(l => l.kind !== 'paint')
await composeLayers(belowLayers, {}, 2048, 2048, undefined, textureRenderLayer)
  .then(c => belowSnapshot.getContext('2d')!.drawImage(c, 0, 0))
belowPaintSnapshotRef.current = belowSnapshot

// Per dab (onComposite) — synchronous, no await
const ov = overlayCanvasRef.current!
const ctx = ov.getContext('2d')!
ctx.clearRect(0, 0, 2048, 2048)
ctx.drawImage(belowPaintSnapshotRef.current!, 0, 0)
ctx.drawImage(baseDiffuseRef.current!, 0, 0)
bumpOverlay()

// At stroke end — full composite
const full = await composeLayers(textureLayers, {}, 2048, 2048, undefined, textureRenderLayer)
overlayCanvasRef.current!.getContext('2d')!.drawImage(full, 0, 0)
bumpOverlay()
persistBrushStroke()
```

**BaseDiffuse season/vehicle staleness guard:**

The existing `onModelLoaded` callback (`Editor.tsx:1562-1583`) already: sets `vanillaDiffuseRef`, then calls `repaint()`. In Phase 2, `repaint()` must also rebuild `belowPaintSnapshotRef` so the next stroke sees the new season texture. Add one call to `rebuildBelowPaintSnapshot()` at the end of the `onModelLoaded` sequence.

**`overlayCanvasRef` identity invariant:** The compositor ALWAYS calls `ctx.drawImage(composedCanvas, 0, 0)` INTO `overlayCanvasRef.current`. The compositor result canvas is a scratch canvas that is immediately discarded. `overlayCanvasRef.current` never changes identity.

**Export compatibility:** `persistBrushStroke()` (`Editor.tsx:1028-1045`) calls `baseDiffuseRef.current!.toDataURL('image/png')`. `baseDiffuseRef` is the PaintLayer's live canvas — unchanged. The export reads `customDiffuseUrl` via `effectiveCustomDiffuseUrl` — unchanged. Zero changes to `mod-export.ts`.

**Tests to add:**

- `src/lib/__tests__/texture-layer-model.test.ts`:
  - Assert `TextureLayer` satisfies `BaseLayer` constraint.
  - Assert incremental composite (below-snapshot + paint blit) produces same pixel fingerprint as full composite on a synthetic 64×64 canvas (scale-down for test speed).
  - Assert `overlayCanvasRef` identity is preserved across a synthetic stroke begin/end cycle.

**Verification commands:**
```bash
tsc --noEmit
vitest run src/lib/__tests__/texture-layer-model.test.ts
vitest run src/lib/__tests__/faceplate-export-golden.test.ts
vitest run src/lib/__tests__/atlas-parts.test.ts
vitest run
```

**Done when:**
- [ ] `tsc --noEmit` clean
- [ ] `vitest run` fully green (all suites)
- [ ] Incremental paint path confirmed: full composite only at stroke begin and stroke end
- [ ] `baseDiffuseRef` / `overlayCanvasRef` identities unchanged
- [ ] `persistBrushStroke` unmodified
- [ ] Season/vehicle switch invalidates `belowPaintSnapshotRef` via `onModelLoaded`

---

## SEQUENCING & RISK

### Phase gate order

```
Phase 0 (faceplate proving ground)
    ↓ [faceplate golden green]
Phase 1 (decal adopts core)
    ↓ [decal export tests green]
Phase 2 (texture adopts core)
```

Phase 1 can begin the moment Phase 0 passes all verification commands. Phase 2 can begin the moment Phase 1 passes. No parallel phase execution — each phase modifies shared files (`editor-shared/`).

### Top 5 risks + guards

**Risk 1 — Export drift from composeLayers refactor** (HIGH)
_Symptom:_ `composeFaceplateCanvas` pixel fingerprint changes after Phase 0.
_Guard:_ The `compose-canvas-golden.test.ts` added in Phase 0 asserts `composeLayers(...faceplateRenderLayer)` fingerprint == `composeFaceplateCanvas` fingerprint on identical projects. Run this before removing any code from `FaceplateEditor.tsx`. If it fails, the `renderLayer` extraction is wrong — do not proceed to Phase 1.

**Risk 2 — 2048² per-dab perf regression** (HIGH)
_Symptom:_ Brush strokes stutter at fast speeds in the texture editor.
_Guard:_ The incremental paint path is mandatory and must be implemented as specified (below-paint snapshot at stroke begin, two drawImages per dab). Add a performance assertion in the test: simulate 60 synthetic dabs on a 2048² canvas and assert each completes in <5 ms (using `performance.now()` in vitest-browser or a jsdom canvas stub). If any dab exceeds the budget, the full-composite path leaked into the dab loop.

**Risk 3 — Panel-decoupling regressions to faceplate** (MEDIUM)
_Symptom:_ `PropertiesPanel` or `LayersPanel` loses faceplate-specific behavior (align buttons use wrong dimensions, blend mode dropdown missing a mode, etc.) after Phase 0 genericization.
_Guard:_ Add an explicit regression test: `PropertiesPanel` with `canvasW=624 canvasH=204` renders align buttons clamped to `[0..624]` / `[0..204]`. Derive this test from reading the existing align logic at `PropertiesPanel.tsx:1087–1099` before editing.

**Risk 4 — Fork-on-write double-source-of-truth** (MEDIUM)
_Symptom:_ After Phase 1, `LayersPanel` or `PropertiesPanel` mutates `project.layers` directly (bypassing `mutateActiveCell`), causing the faction override to be written into the wrong cell or not forked.
_Guard:_ The `mutate` prop passed to `LayersPanel` and `PropertiesPanel` in `DecalPackEditor` must ONLY call `mutateActiveCell` — never `history.mutate` directly. Assert this in a test: mock `mutateActiveCell` and `history.mutate`; dispatch a layer visibility toggle via the panel; assert `mutateActiveCell` called once and `history.mutate` called zero times directly.

**Risk 5 — BaseDiffuse season staleness** (LOW-MEDIUM)
_Symptom:_ After a vehicle/season switch, the `belowPaintSnapshotRef` still contains the old season's pixels, so the next stroke composites against a stale below-layer.
_Guard:_ `rebuildBelowPaintSnapshot()` must be called at the end of `onModelLoaded` (verified by a test that switches season twice and asserts `belowPaintSnapshotRef` pixel fingerprint changes after each switch). Add this test in `src/lib/__tests__/texture-layer-model.test.ts`.

---

## OUT OF SCOPE

- Do NOT rewrite the slot/faction model (`AtlasPart`, `mutateActiveCell`, `FactionRow`, `PartStepper`, `FactionPartMatrix`).
- Do NOT change export formats — RGT, SGA, PNG output bytes must be identical.
- Do NOT merge the three editors into one component — they remain `FaceplateEditor.tsx`, `DecalPackEditor.tsx`, `Editor.tsx`/`VehicleTextureEditor.tsx`, sharing only the core library.
- Do NOT migrate the Konva view layer — the faceplate Konva Stage stays in `FaceplateEditor.tsx`; decal Konva Stage stays in `DecalPackEditor.tsx`. Phase 0-2 are model/panel extractions, not view-layer moves.
- Do NOT add a `CamoLayer` or `DecalMarkings` layer type in Phase 2 — the `BaseDiffuse` + `PaintLayer` two-layer stack is the complete Phase 2 scope. Camo and decal marking layers are a future extension.
- Do NOT change `useHistoryEngine` — it is already fully generic.
