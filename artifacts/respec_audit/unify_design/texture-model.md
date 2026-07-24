---
title: Texture/Skin Editor Model & Faceplate-Layer Compositor Migration Plan
type: design-doc
tags: [domain/skin-editor, domain/texture, domain/layer-compositor]
created: 2026-06-18
updated: 2026-06-18
---

# Texture Editor Model & Layer-Compositor Migration Plan

## 1. The Current Texture Editor (VehicleTextureEditor.tsx)

`VehicleTextureEditor.tsx` is a full-screen 2D raster paint surface for the vehicle's 2048×2048 diffuse atlas. Key facts:

**Canvas layout (VehicleTextureEditor.tsx:82–86)**
- `ATLAS = 2048` — the physical paint resolution (2048²).
- `VIEW = 1024` — on-screen `<canvas>` size. Every blit call scales the 2048² `overlayCanvas` down to 1024² for display: `ctx.drawImage(overlayCanvas, 0, 0, 2048, 2048, 0, 0, 1024, 1024)` (VehicleTextureEditor.tsx:211).

**Tools (VehicleTextureEditor.tsx:90–96)**
- `'brush'` — freehand paint, delegates to `paintBrushDab` / `paintBrushSegment` from `lib/brush.ts`.
- `'erase'` — restore vanilla pixels from the `vanillaDiffuse` canvas via `paintBrushDab` in erase mode.
- `'pick'` — one-shot eyedropper: samples `overlayCanvas` pixel via `samplePixel`, then snaps back to brush.
- Extras: UV unwrap overlay toggle (pre-rasterised `uvOverlay` offscreen canvas, VehicleTextureEditor.tsx:183–201); horizontal symmetry toggle (brush.ts symmetric dab mirroring).

**Paint target (VehicleTextureEditor.tsx:104–119)**
- `props.overlayCanvas` — the LIVE 2048² composited canvas fed to Three.js. Display-only in VTE.
- `props.baseDiffuse` — the mutable paint target canvas, owned by Editor.tsx. Strokes land here.
- `props.vanilla` — pristine, immutable copy of the CoH2 diffuse (used for erase-mode pixel lookup).

**Stroke lifecycle**
1. `onPointerDown` → `p.onStrokeBegin()` (snapshot history), `paintBrushDab` on `baseDiffuse.getContext('2d')`, `p.onComposite()`, `blit()`.
2. `onPointerMove` → `paintBrushSegment`, `p.onComposite()`, `blit()`.
3. `onPointerUp/Cancel/Leave` → `p.onStrokeEnd()` (persist to project).

**Pan/zoom (VehicleTextureEditor.tsx:160–166)**
- `usePanZoom` hook manages CSS `translate+scale` on a 1024² inner div. The atlas canvas is at natural size; scale does the zoom. Fit-to-window computed once at mount from `window.inner*`.

---

## 2. The Live 3D Sync (critical constraint)

This is the tightest constraint. Every stroke must feed the GPU on the same frame.

**Canvas chain (Editor.tsx:485–543)**
```
vanillaDiffuseRef  →  baseDiffuseRef  →  overlayCanvasRef  →  CanvasTexture(overlayCanvasRef)
  (pristine RGT)      (paint target)      (composite output)    (bound to body meshes in Three.js)
```

**overlayCanvasRef** is a single, lazily-initialised 2048² `HTMLCanvasElement` (Editor.tsx:486–491). It never changes identity across vehicle switches — Viewport keeps its `CanvasTexture` reference stable.

**CanvasTexture binding (Viewport.tsx:3948–4001)**
- On first mount (and each `modelTick` bump): `new CanvasTexture(overlayCanvas)` → `overlayTexRef.current`. Set `flipY=true`, `colorSpace=SRGBColorSpace`, `anisotropy=16`. Bound onto every mesh whose material carries `__usesBodyDiffuse`.
- Dirty-bit gate: `overlayDirtyRef` is flipped `true` whenever the parent calls `bumpOverlay()`. The RAF tick at Viewport.tsx:1245 checks `overlayDirtyRef.current` and sets `overlayTexRef.current.needsUpdate = true` — then clears the dirty bit. **This is the only GPU upload path.** Cost: 2048² RGBA = 16 MB per needsUpdate.

**overlayVersion prop (Editor.tsx:542–543, Viewport.tsx:4008–4011)**
- `bumpOverlay()` increments `overlayVersion` state. The `useEffect([overlayVersion])` in Viewport flips `overlayDirtyRef = true` and `needsRenderRef = true`. This is the async signal crossing the parent→child boundary.

**paintCanvas / repaint (Editor.tsx:862–930)**
- `paintCanvas()`: draws `baseDiffuse` (or `decalPreviewCanvas`) onto `overlayCanvasRef`, then paints decals + hover ghost on top. Does NOT bump overlay.
- `repaint()`: calls `paintCanvas()` then `bumpOverlay()`. All real state changes (decal placed, camo applied, stroke via viewport brush) route through `repaint()`.

**In-viewport brush** (Editor.tsx:1262–1300): The viewport `onHover` callback, when `brushOn && pointerDownRef`, calls `paintBrushSegment` directly on `baseDiffuse`, then `repaint()`. The 3D surface repaints synchronously on the same event cycle.

**VTE brush callback** (VehicleTextureEditor.tsx:116–119): `onComposite` → calls `repaint()` in Editor, which composites `baseDiffuse` → `overlayCanvas` → bumps `overlayVersion` → Viewport's RAF uploads to GPU next tick.

---

## 3. The Diffuse/Export Contract

**Persistence**: Stroke end → `persistBrushStroke()` (Editor.tsx:1028–1045): `baseDiffuse.toDataURL('image/png')` → stored as `project.vehicles[id].customDiffuseUrl`. Cost is ~30–80 ms per stroke end on a 2048² canvas.

**Export pipeline** (`lib/mod-export.ts`, `composeVehicleDiffuse`):
- Fast path (Editor.tsx:227–237): if `customDiffuseUrl` exists, `drawImage(img, 0, 0, 2048, 2048)` onto a fresh 2048² canvas.
- Slow path: SGA read → BC1/BC3 decode → `bcToCanvas` → paint decals via `decal-painter`.
- Re-encode: `canvasToRgt(canvas, difTset, { compress:false, format:'bc3', fbif:false })` → 4,194,736-byte BC3 blob → patched into the signed template SGA (mod-export.ts:554).

**Export contract**: The export reads `effectiveCustomDiffuseUrl(project, vehicleId, faction)` (project.ts:505–513) — per-vehicle override first, then `factionDefaults[faction].customDiffuseUrl`. Any layer compositor that writes its output to `customDiffuseUrl` is export-compatible with zero further changes.

---

## 4. Faction/All-Scope Diffuse (factionDefaults, CamoPanel)

`project.factionDefaults[faction].customDiffuseUrl` (project.ts:95–100) holds a faction-wide diffuse applied to every vehicle in that faction unless overridden per-vehicle. Scope is set by `applyCamoImage(img, 'faction' | 'all')` (Editor.tsx:789–846):
- `'faction'`: writes to `factionDefaults[vehicle.faction].customDiffuseUrl`.
- `'all'`: writes to ALL faction defaults and wipes per-vehicle overrides.

The resolution chain (`effectiveCustomDiffuseUrl`) means a faction-scoped layer-compositor output is automatically inherited by all unvisited vehicles — the export pipeline already handles this correctly (mod-export.ts:178–193, `collectExportVehicleIds`).

On vehicle load, `effectiveCustomDiffuseUrl` is called in the `onModelLoaded` callback (Editor.tsx:1562–1583) to restore the saved diffuse into `baseDiffuseRef` and `overlayCanvasRef`, followed by `repaint()` + `bumpOverlay()`.

---

## 5. The Layer-Compositor Mapping Question

### Proposed Architecture

A faceplate-style layer compositor for the texture editor would maintain a stack of typed layers — each produces a 2048² contribution — and composites them sequentially into a single 2048² canvas that IS `baseDiffuseRef`. That canvas feeds `overlayCanvasRef` (which feeds `CanvasTexture`) and `customDiffuseUrl` (which feeds export), so both consumers remain unchanged.

**Proposed layer types:**

| Layer | Purpose | Canvas2D operation |
|---|---|---|
| `BaseDiffuse` (bottom, locked) | Vanilla CoH2 RGT pixels | `drawImage(vanillaDiffuseRef)` |
| `CamoLayer` | Procedural camo preset or imported image | `multiply` blend over BaseDiffuse |
| `PaintLayer` | Freehand brush strokes (current baseDiffuse role) | `source-over` at brush opacity |
| `DecalMarkings` | Shield, number, name, kills, image decals | `paintDecals()` output (existing) |

A "compositor" function would run top-to-bottom, drawing each visible layer onto a scratch 2048² canvas, then `ctx.drawImage(scratch, 0, 0)` into `overlayCanvasRef`. The result IS the diffuse — no second encoding step. After compositor runs, call `bumpOverlay()`.

**Composite-on-change → CanvasTexture**: Each layer-model mutation triggers `composite()` → `bumpOverlay()` — same signal already used. The dirty-bit gate in Viewport ensures only one 16 MB GPU upload fires per frame even if multiple layers change simultaneously.

**PaintLayer as the brush target**: The brush tools continue operating on a 2048² `HTMLCanvasElement` (the PaintLayer's internal canvas). Stroke ends snapshot that canvas to `customDiffuseUrl` — unchanged from today.

---

## 6. What It Already Shares vs. Bespoke

| | Already shared | Bespoke to texture editor |
|---|---|---|
| Shell chrome | `BottomToolPill`, `ToolOptionsPeel`, glass pill styles, `KeyboardShortcutsOverlay` | None — VTE already reuses all of these |
| Brush helpers | `lib/brush.ts` (`paintBrushDab`, `paintBrushSegment`, `samplePixel`) | No — already shared |
| Undo/redo history | `useDecalHistory` (via Editor.tsx callbacks `onStrokeBegin`/`onStrokeEnd`) | VTE delegates back to Editor — shared |
| Pan/zoom | `usePanZoom` hook | Shared with Atlas preview |
| Layer UI primitives | `LayerRow`, `LayersPanel` from `editor-shared/` | Currently unused in VTE — would be adopted |
| Canvas size | 624×204 (faceplate) vs 2048² (texture) | Entirely bespoke — 10× larger in each dimension, 100× more pixels |
| Compositor model | `composeFaceplateCanvas` (async, sequential 2D drawImage) | Structurally identical; only differs in canvas dimensions |
| Export path | Faceplate: `canvasToRgt` → SGA. Texture: `toDataURL` → `customDiffuseUrl` → `composeVehicleDiffuse` | Different downstream, but compositor output contract is the same (a canvas) |

---

## Key Challenges and Risks

### (a) Per-stroke live GPU sync at 2048²
**Risk: HIGH.** The faceplate compositor composites a 624×204 canvas (~750K pixels) and the comment in faceplate-project.ts:148 describes this as "~5ms on a modern CPU." A 2048² canvas is ~4.2M pixels — 5.6× more. Full recomposite per dab at fast drag speeds (dozens of events/second) could exceed 16 ms frame budget.

**Mitigation**: Do NOT recomposite all layers on every dab. The PaintLayer is the only layer changing during a stroke. Only repaint the PaintLayer's contribution onto `overlayCanvas` — maintain a "paint scratch" canvas as before, then drawImage the other layers (BaseDiffuse+Camo+Decals) once at stroke start as a "below-paint" snapshot. After stroke end, run the full compositor and snapshot to `customDiffuseUrl`. This preserves the existing per-dab latency (~1–2 ms for a 2048² drawImage) with no regression.

### (b) Base-diffuse layering (vanilla as bottom layer)
**Risk: MEDIUM.** The vanilla canvas (`vanillaDiffuseRef`) changes on every vehicle load and season switch. In a layer model it becomes the `BaseDiffuse` layer. Season switches already replace `baseDiffuseRef` — the layer compositor must observe the same signal and replace its `BaseDiffuse` layer canvas without invalidating higher layers. The existing `onModelLoaded` callback already serialises this: it sets `vanillaDiffuseRef` then calls `repaint()`. A layer-aware compositor can hook the same callback.

### (c) Export compatibility
**Risk: LOW.** The export reads `customDiffuseUrl` — a PNG data URL. As long as the compositor writes the composited 2048² canvas to `toDataURL('image/png')` at stroke end (same as `persistBrushStroke()` today), the export pipeline is byte-compatible. The RGT encoder (`canvasToRgt`) takes a `HTMLCanvasElement` — the compositor output canvas satisfies this directly.

**Critical invariant**: the `overlayCanvasRef` canvas identity must never change — Viewport's `CanvasTexture` is bound to it. The compositor must always paint INTO `overlayCanvasRef.current`, never replace it.
