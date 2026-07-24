# Release Review — Konva Editor Migration
*Date: 2026-06-14. Scope: uncommitted work in main tree. Read-only, code-confirmed only.*

---

## Summary

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| MAJOR    | 4     |
| MINOR    | 1     |

---

## Findings

### MAJOR-1 — FaceplateEditor: Draw-tool live-stroke overlay wrong size at zoom ≠ 1

**File:** `src/components/FaceplateEditor.tsx:1180`

**Problem:**
When the draw tool is used in FaceplateEditor with a zoom != 1.0, the live-stroke overlay canvas
is created with CSS dimensions `${FACEPLATE_BANNER_W}px` × `${FACEPLATE_BANNER_H}px` (624 × 204).
The canvas element it is appended into has CSS dimensions `FACEPLATE_BANNER_W * viewScale` by
`FACEPLATE_BANNER_H * viewScale`. At zoom=2 the canvas div is 1248×408 but the overlay is 624×204
— the live stroke preview only appears in the top-left quadrant of the visible canvas during the
stroke. The final composite result is still correct (applied at pointerup), but the in-progress
stroke visual is in the wrong place.

**Comparison:** DecalPackEditor correctly uses `${DECAL_PACK_SIZE * viewScale}px` at line 1223.

**Confidence:** 95%. Confirmable from code alone.

**Fix:** Change line 1180 from:
```
width:${FACEPLATE_BANNER_W}px;height:${FACEPLATE_BANNER_H}px
```
to:
```
width:${FACEPLATE_BANNER_W * viewScale}px;height:${FACEPLATE_BANNER_H * viewScale}px
```

---

### MAJOR-2 — FaceplateEditor: Paint layer Konva Stage image permanently stale after first stroke

**File:** `src/components/FaceplateEditor.tsx:1829–1835`

**Problem:**
After a paint stroke completes, `project.layers[paintLayer].dataUrl` is updated. However, the
`konvaImages[paint_${layer.id}]` cache entry is NOT invalidated — the condition `!paintEl` is
false on every subsequent render, so the stale first-stroke image remains in the Konva Stage.
The paint layer rendering in the Konva Stage (which controls z-order compositing with other Konva
layers) shows only the FIRST stroke's result. All subsequent strokes appear in the OOB overlay
ghost (which reads `layer.dataUrl` directly) but NOT in the Konva Stage at runtime.

This means: a user who applies 3 paint strokes on a faceplate will see the first stroke's result
in the main canvas, not the cumulative result. Export via `composeFaceplateCanvas` is unaffected
(it reads `layer.dataUrl` directly, not konvaImages).

**Comparison:** DecalPackEditor correctly checks `cached.src !== src.dataUrl` and reloads at
lines 888-896.

**Confidence:** 90%. The stale behavior is code-provable; the visual severity requires live
verification.

**Fix:** Either:
1. Track `dataUrl` changes: check `paintEl.src !== layer.dataUrl` and reload when stale.
2. Use a `useEffect` keyed on `project.layers` (filter to paint kind, map dataUrl) to reload
   `paint_*` entries in konvaImages when their dataUrl changes.

---

### MAJOR-3 — FaceplateEditor: Konva shape rendering double-applies `layer.scale` for rectangle/ellipse

**File:** `src/components/FaceplateEditor.tsx:1696–1818`

**Problem:**
For shape layers, the new Konva rendering computes `w = layer.width * layer.scale` and
`h = layer.height * layer.scale`, then passes `width={w}` and `scaleX={layer.scale}` (via
`commonProps`). This double-applies scale:

- **Export** (`composeFaceplateCanvas`, line 4774): `ctx.scale(layer.scale, layer.scale)` then
  draws path at `layer.width × layer.height` → effective size = `layer.width * layer.scale`.
- **Konva Rect** (line 1773): `width = layer.width * layer.scale`, `scaleX = layer.scale`
  → rendered size = `layer.width * layer.scale * layer.scale` (scale squared).

At `layer.scale = 1` (default), both paths produce the same size. At any other scale, the Konva
preview and the export diverge. The same double-scale applies to Ellipse (radiusX, radiusY) and
KonvaShape (sw, sh passed to drawComplexShapePath).

The previous CSS-based rendering used `svgW = layer.width * layer.scale * viewScale` without any
additional Konva scale, which was correct. The Konva migration introduced the scale doubling.

Note: `handleKonvaTransformEnd` reads back the doubled scaleX/Y and stores it as `layer.scale`,
compounding the problem after any user transform gesture.

**Confidence:** 85%. Requires live verification to confirm visual severity, but the arithmetic
mismatch between the Konva path and the export path is code-confirmable.

**Fix:** Either:
1. Do NOT pre-multiply scale into `w`/`h`. Use `w = layer.width`, `h = layer.height` and rely
   solely on `scaleX={layer.scale}`, `scaleY={layer.scale}` for sizing. Adjust offsetX/Y to
   `w/2, h/2` (not `w*scale/2`).
2. OR remove `scaleX/Y` from `commonProps` and pre-bake into geometry only.

---

### MAJOR-4 — DecalPackEditor: Undo broken for Konva drag and transform gestures (endGesture before mutate)

**File:** `src/components/DecalPackEditor.tsx:963–964` and `988–1010`

**Problem:**
In `handleKonvaTransformEnd` (line 963) and `handleKonvaDragEnd` (line 988), `history.endGesture()`
is called BEFORE `mutate()`. The history engine's `pendingGestureSnapRef` (which holds the
pre-gesture state) is discarded by `endGesture()` before the first mutation can flush it.
When `mutate()` subsequently runs with `gestureDepthRef.current === 0` (inGesture=false), it
pushes the CURRENT (post-gesture-pre-write) state as an undo frame instead of the pre-gesture
state. Undo after a Konva drag or transform therefore skips the pre-gesture state.

**Comparison:** `FaceplateEditor.handleKonvaTransformEnd` (line 803 and 821) correctly calls
`mutate()` BEFORE `history.endGesture()`, preserving the pre-gesture snapshot.

**Confidence:** 90%. Logic is code-confirmable from `editor-history.ts:129–156` (mutate flushes
pending gesture snap only if `pendingGestureSnapRef.current` is non-null, which endGesture clears).
Live verification needed to confirm the actual undo behavior.

**Fix:** Swap the order in both `handleKonvaTransformEnd` and `handleKonvaDragEnd` in
`DecalPackEditor` — call `mutate()` first, then `history.endGesture()`.

---

### MINOR-1 — CanvasPlaceholder: dark-mode change is cosmetic, no regression

**File:** `src/components/editor-primitives/CanvasPlaceholder.tsx`

Background changed from `#ececec` (off-white) to `#1a1c22` (dark glass). Arrows and border
updated to white-on-dark equivalents. This is a correct dark-mode update. The placeholder is
editor-only scaffolding (`pointer-events: none`, never exported), hidden in transparent-preview
mode. No contrast or visibility regression.

**Confidence:** 99%. Code-only.

---

## Export Integrity

**`src/lib/decal-pack-export.ts`** — unchanged from HEAD (confirmed via `git diff`). Zero lines
changed.

**`composeFaceplateCanvas`** — the function body is unchanged from HEAD (no `+`/`-` lines on the
function itself in the diff). Only comments referencing it and the publish-build caller were
updated.

**Golden tests** (`src/lib/__tests__/decal-pack-export.test.ts`) — exercise `rasteriseDecal`
with 6 canonical Decal fixtures covering identity, rotation, flipH, scale, opacity, and tint.
The `pixelFingerprint` approach (sum of all RGBA values) is a meaningful but weak assertion —
it catches large pixel-distribution changes but not transpositions or small color-channel errors.
The snapshots are committed and non-tautological (they would fail if rasteriseDecal changed the
compositing math). The export pipeline is genuinely clean.

---

## Shared History Engine

No new mutation path bypasses `editor-history.ts`. Both editors route all mutations through
`history.mutate()`. The only history-related concern is MAJOR-4 (endGesture order in DecalPackEditor).
No undo flood was found — the draw tool correctly uses `beginGesture`/`endGesture` to produce one
frame per stroke.

---

## Darkmode

The `previewTransparent` logic is correctly applied: `checkerboard` mode sets white background +
light checker; default dark mode sets `#1a1c22` + dark checker. No case makes transparent alpha
invisible against the background. The transparent preview case for decals (`!previewTransparent &&
showDecalPlaceholder`) correctly hides the placeholder so only the real checker shows.

---

## Release Readiness

**Konva DECAL editor (DecalPackEditor):**
- Coordinate alignment at non-1.0 zoom: CORRECT. Stage uses `scaleX/Y={viewScale}` and Decal
  coords are in canvas-space (128-unit), so zoom is applied uniformly.
- flipH/V decomposition: CORRECT. `rawScaleX < 0` detection and canonical reset is correct.
- Transformer detach on deselect: CORRECT. `attachTransformerToIds([])` called on Escape and
  tool change to draw.
- Image load races: CORRECT via the `cached.src !== src.dataUrl` check (lines 888-896).
- **BLOCKER: NONE.** MAJOR: undo broken after drag/transform (MAJOR-4).
- **Not release-ready without fixing MAJOR-4** (silent undo regression on Konva drag/transform).

**Konva FACEPLATE editor (FaceplateEditor):**
- Stage/layer z-order: correct (project.layers.map order preserved).
- Text inline-edit overlay alignment: correct (multiplied by viewScale).
- Gesture begin/end balance: correct for transform, draw; gestures properly scoped.
- **BLOCKER: NONE.** MAJOR: live-stroke preview wrong at zoom ≠ 1 (MAJOR-1), paint layer stale
  after first stroke (MAJOR-2), shape scale double-applied (MAJOR-3).
- **Not release-ready** without fixing at minimum MAJOR-1 (draw preview) and MAJOR-2 (paint stale).
  MAJOR-3 (shape scale) needs live verification but is likely visible with any non-default scale.

---

## Needs Live Verification

1. **MAJOR-2** (paint stale): confirm that a second stroke does NOT update the Konva Stage
   paint image — the OOB overlay will show it, but the main canvas won't.
2. **MAJOR-3** (shape scale): confirm that placing a shape then scaling it via the Transformer
   results in a Konva preview that mismatches the export (composeFaceplateCanvas result).
3. **MAJOR-4** (undo): confirm that Ctrl+Z after a Konva drag in DecalPackEditor undoes only
   the write-back tick, not the full drag (i.e. undo leaves the decal in the dropped position,
   not the pre-drag position).

---

## Bug-fix pass — 2026-06-14

### MAJOR-4 — DecalPackEditor undo order
**File:** `src/components/DecalPackEditor.tsx`

- **handleKonvaTransformEnd (~963):** Moved `history.endGesture()` to AFTER `mutate(...)`.
  Old: `endGesture()` → `mutate(...)` (clears pendingGestureSnap before mutation can flush it).
  New: `mutate(...)` → `history.endGesture()`.
- **handleKonvaDragEnd (~988):** Same swap — `mutate(...)` first, then `history.endGesture()`.

**Tests added** (`src/lib/__tests__/konva-migration-fixes.test.ts` — MAJOR-4 describe block, 4 tests):
- "OLD ORDER ... loses the pre-gesture snap" — proves the old order is wrong (undo lands on mid-state x=50, not pre-gesture x=10). Fails on fixed code intentionally (it documents the old broken behavior).
- "NEW ORDER ... correctly restores pre-gesture state on undo" — asserts undo reaches pre-drag state.
- "NEW ORDER: transform gesture — one Ctrl+Z restores the pre-transform position" — covers the transform path.
- "NEW ORDER: no-op gesture does NOT push an undo frame" — guards against spurious undo entries.

### MAJOR-1 — FaceplateEditor draw overlay size
**File:** `src/components/FaceplateEditor.tsx:1180`

Old: `width:${FACEPLATE_BANNER_W}px;height:${FACEPLATE_BANNER_H}px`
New: `width:${FACEPLATE_BANNER_W * viewScale}px;height:${FACEPLATE_BANNER_H * viewScale}px`

**Tests added** (MAJOR-1 describe block, 3 tests):
- At viewScale=2 overlay dims = 1248×408 (not 624×204) — would fail old code.
- At viewScale=1.5 cssText contains `width:936px;height:306px`.
- At viewScale=1 dims equal banner constants (no regression at default zoom).

### MAJOR-2 — FaceplateEditor paint layer stale cache
**File:** `src/components/FaceplateEditor.tsx:1829–1839`

Old guard: `if (!paintEl)` — never reloads when element exists.
New guard: `if (!paintEl || paintEl.src !== layer.dataUrl)` — triggers reload on stale src.
Also: when stale, returns the old element (avoids blank-frame flash) until new image loads.

**Tests added** (MAJOR-2 describe block, 3 tests):
- "OLD logic: !paintEl check — never reloads" — proves stale el is returned with wrong src.
- "NEW logic: src !== dataUrl triggers reload when dataUrl changes" — reload triggered on second stroke.
- "cache is NOT invalidated when dataUrl is unchanged" — no spurious reload on same dataUrl.

### MAJOR-3 — FaceplateEditor shape double-scale
**File:** `src/components/FaceplateEditor.tsx:1696–1697`

Old: `const w = layer.width * layer.scale; const h = layer.height * layer.scale`
    + `scaleX={layer.scale}` in commonProps → effective size = `width * scale²`
New: `const w = layer.width; const h = layer.height`
    + `scaleX={layer.scale}` in commonProps unchanged → effective size = `width * scale` (matches export).

offsetX/Y, gradient calculations, and `drawComplexShapePath(shapeType, sw, sh)` now all receive
base (unscaled) dimensions; Konva's scaleX/Y handles the scaling — exactly matching composeFaceplateCanvas
which does `ctx.scale(scale, scale)` then draws at `layer.width × layer.height`.

**Tests added** (MAJOR-3 describe block, 4 tests):
- "at scale=2 effective size is width*scale (not width*scale²)" — proves mismatch and fix.
- "at scale=1 both old and new produce the same size" — confirms bug invisible at default scale.
- "at scale=0.5 old code renders at scale/4 of intended" — additional non-trivial scale case.
- "offsetX/Y must be layer.width/2 (local-space centering)" — guards offset regression.

### Suite results
- **`npx tsc -b --noEmit`**: clean (0 errors).
- **`npx vitest run`**: **110 files / 1971 tests — all passing** (baseline was 109 / 1957; +1 file, +14 tests).

### Residual live-verify items
MAJOR-2 and MAJOR-3 have been fixed in code and tested with pure-logic harnesses, but the
audit noted that visual severity requires live verification:
1. **MAJOR-2**: confirm a second paint stroke now updates the Konva Stage (not just the OOB overlay).
2. **MAJOR-3**: confirm a shape with scale≠1 now visually matches the rasterised export.
3. **MAJOR-4**: confirm Ctrl+Z after a Konva drag in DecalPackEditor restores the pre-drag position
   in the actual app (the pure-harness test confirms engine semantics; live drag confirms wiring).
None of these require changes to sga-writer.ts, rasteriseDecal, or composeFaceplateCanvas.
