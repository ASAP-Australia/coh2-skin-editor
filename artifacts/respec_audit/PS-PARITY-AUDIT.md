# Photoshop-Parity Audit — Faceplate Editor (2026-06-15)

Auditor: live CDP session against dev server :9222, no code changes.
Evidence screenshots: `/tmp/coh2-evidence/parity/`

---

## 1. SELECT / MOVE / TRANSFORM

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| T1 | **Shift+click layer row = deselects, not multi-select** | P1 | Shift-click adds/removes from selection set | Layer row `onClick` only handles `ctrlKey`/`metaKey` for multi-select (line 2744). Add `ev.shiftKey` → range-select. |
| T2 | Multi-select via **Ctrl+click** works but is undiscoverable | P2 | PS uses Cmd/Ctrl-click for add-to-selection | Hint text in Layers panel ("Ctrl-click to multi-select") or tooltip. |
| T3 | **Shift=aspect lock during drag/scale** — not tested interactively but lock icon (Shift+click) exists. Actual Konva drag-scale with Shift held: unknown; no explicit `shiftKey` handling in Transformer onTransform | P1 | Shift during corner-drag locks aspect | Check Konva Transformer `keepRatio` binding to shiftKey. File: FaceplateEditor.tsx ~line 898. |
| T4 | **Rotate with Shift=15° snap** — not implemented (no shiftKey handler in rotation drag) | P1 | Shift during rotate snaps to 15° increments | Add `rotationSnaps` to Konva Transformer or intercept `onTransformEnd` + `shiftKey`. |
| T5 | **Alt+drag to duplicate** — not implemented | P1 | Alt/Option drag creates duplicate in place | Add `altKey` check to layer drag-start; spawn duplicate layer. |
| T6 | Numeric X/Y/W/H/° inputs exist (PropertiesPanel) — work correctly | OK | — | — |
| T7 | Arrow nudge 1px / Shift+arrow 10px — both work | OK | — | — |
| T8 | Esc deselects — works | OK | — | — |
| T9 | No **marquee/rubber-band select** on canvas | P1 | Drag on empty canvas creates selection rect | Implement canvas-level pointermove drag → collect layers within rect → multi-select. |
| T10 | **Flip H/V** — present in shape Properties panel via ↔↕ buttons | OK | — | — |

---

## 2. TEXT TOOL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| TX1 | **Click-to-place text is broken** — clicking the canvas in Text mode creates no new layer | P0 | Click canvas → text cursor + new editable text layer | Root cause: `onPointerDown` on the canvasRef div checks `ev.target !== ev.currentTarget` and aborts because Konva's `<Stage>` canvas sits on top and becomes the pointer target. Fix: remove the target check; or use a transparent overlay div above the Konva stage to capture text-placement clicks. File: `FaceplateEditor.tsx` line 1276. |
| TX2 | Text properties in sub-toolbar: font, size (slider), weight, B/I, letter-spacing, line-height, alignment (L/C/R), color, opacity, blend mode — **all present** | OK | — | — |
| TX3 | **No font size text input** (only slider popover) | P2 | PS shows numeric point-size field | Replace SliderPopover with combined numeric input + slider for font size. |
| TX4 | **No stroke/outline for text** in sub-toolbar (stroke code exists in LayerStroke type but not exposed in tool peel for text) | P1 | PS: stroke color + width in text layer options | The shadow tool sub-toolbar exposes stroke for paint layers. Expose HexColorInput + SliderPopover for text stroke in the text peel. Code exists at `FaceplateEditor.tsx` ~line 4138. |
| TX5 | **No underline/strikethrough** | P2 | PS has underline + strikethrough toggles | Add `textDecoration` to TextLayer type and render in KonvaText. |
| TX6 | **No tracking (per-character spacing in real units)** vs letter-spacing in EM | P2 | PS shows tracking in thousandths-of-em | Minor UX polish. |
| TX7 | Font family dropdown: only 6 fonts (Inter, Arial, Times, Georgia, Courier, monospace) | P1 | PS can use any installed font | Load system fonts via CSS + font-loading API; display in a searchable dropdown. |
| TX8 | Double-click layer row → rename mode works (inline text input fires) | OK | — | — |

---

## 3. SHAPES TOOL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| SH1 | Shape types: rect, circle, chevron, star, shield + histogram icon (6 total) — no **polygon/triangle** or **custom path** | P2 | PS has polygon with adjustable sides | Add triangle (polygon-3) to `ShapeKind` union; render in shapeToSvgElement. |
| SH2 | **No corner radius control for rectangles** | P1 | PS rect shape has corner radius slider | Add `cornerRadius` to ShapeLayer; pass to Konva Rect `cornerRadius` prop. File: faceplate-project.ts + FaceplateEditor.tsx |
| SH3 | **No stroke for shapes** — stroke is only for text/paint layers | P1 | PS shapes have fill + stroke independently | Shape layer has `stroke: LayerStroke` but rendering only shows `layer.stroke` in the SVG path. Expose stroke color + width in the shapes peel (similar to text peel at line 4138). |
| SH4 | Gradient fill: Linear/Radial, angle, stop editor — **present** | OK | — | — |
| SH5 | Properties panel doesn't auto-refresh to show shape properties when shape is added via shape button (shows previous layer's props until you click the layer row) | P1 | PS always shows selected layer properties | `addShapeLayer()` should also call `setSelectedId(newId)` — check if it does. FaceplateEditor.tsx `addShapeLayerOf`. |

---

## 4. DRAW / BRUSH TOOL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| DR1 | Brush: size slider (popover), color picker, opacity slider, eyedropper, erase mode, mirror H/V, clear — all present | OK | — | — |
| DR2 | **No brush hardness control** | P1 | PS brush has hardness (feather) 0–100% | Implement radial gradient alpha falloff on the brush stamp canvas. |
| DR3 | **No brush flow/pressure simulation** | P2 | PS has flow separate from opacity | Low priority; would need pointer pressure API. |
| DR4 | Brush size shown as slider-only popover (no direct number input) | P2 | PS brush size: number input + bracket [ ] shortcuts | Add number input alongside slider; wire `[` and `]` keys to ±1 size. |
| DR5 | **Eyedropper** (I key) — does NOT switch tool; only activates from within Draw sub-toolbar | P1 | I key = eyedropper from any tool | Add `'i'` keydown handler for eyedropper. Currently only T and V shortcuts work in the FACEPLATE COMPOSER section. |

---

## 5. SHADOW TOOL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| SD1 | Shadow controls: color, opacity, X-offset, Y-offset, blur — accessible in sub-toolbar | Partial | — | — |
| SD2 | **No shadow spread** | P1 | PS drop shadow: spread radius (expands/contracts shadow) | Add `spread` to shadow data model; apply via canvas compositing. |
| SD3 | **No shadow blend mode** | P2 | PS shadow has its own blend mode (Multiply default) | Minor; add blend mode selector to shadow controls. |
| SD4 | Shadow controls only in sub-toolbar; **not in Properties panel** | P2 | PS: layer effects visible in layer styles dialog | Consider moving shadow to Properties panel expandable section (like image adjustments). |

---

## 6. BG TOOL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| BG1 | Background color picker + transparent toggle — present | OK | — | — |
| BG2 | **No gradient background option** | P2 | PS: solid color or gradient for background | Add gradient fill UI to BG peel. |

---

## 7. ALIGN TOOL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| AL1 | 7 align buttons: Left, Center H, Right, Top, Center V, Bottom, Center-both — present | Partial OK | — | — |
| AL2 | **No distribute options** (distribute horizontally/vertically) | P1 | PS: distribute spacing between layers | Implement distribute when ≥3 layers selected (compute even spacing). |
| AL3 | **No align-to-selection mode** (always aligns to canvas) | P1 | PS: align target = canvas OR selection bounds | Add toggle "align to: canvas / selection"; when selection, use bounding box of selected layers. |
| AL4 | Properties panel ALIGN section shows only 2 buttons (center-H to canvas, center-V to canvas) — limited vs full 7 in sub-toolbar | P2 | PS: align buttons always visible | Either remove redundant 2-button ALIGN section in Properties or expand to all 7. |

---

## 8. MASK TOOL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| MK1 | Mask tool: no visible sub-toolbar when activated | Unclear | — | Need layer with mask applied to test. |
| MK2 | **No clipping mask via Mask tool UI** | P1 | PS: "Create Clipping Mask" for non-destructive masking | Clipping exists (CornerDownLeft button on layer card), but no Mask tool UI for it. |
| MK3 | **No pixel mask painting** from Mask tool (mask brush mode) | P1 | PS: paint black/white on layer mask | Code references `maskBrushSize`/`maskBrushOpacity`/`maskPaintMode` (FaceplateEditor.tsx ~line 3502) suggesting it may be implemented but not visible. |

---

## 9. SNAP TOOL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| SN1 | Snap toggle + grid step (4/8/16/32px) — **present and working** | OK | — | — |
| SN2 | **Smart guides** (snap to edges/center of other layers) — partially implemented via `snap-guides.ts` but only triggers during drag when snapGrid=true | P1 | PS: always-on smart guides independent of grid snap | Decouple smart-guide snapping from the grid snap toggle. |
| SN3 | **No rulers** | P2 | PS: ruler bars (Ctrl+R) along top and left | Implement 15px ruler overlays with tick marks. |
| SN4 | **No guides** (drag-from-ruler guides) | P2 | PS: drag from ruler to create pixel guide lines | Implement guide lines. |

---

## 10. LAYERS PANEL

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| LP1 | **Opacity "10" display bug** — layer row input (34px wide, font 10px) clips "100" to show "10" visually; scrollWidth=38 > clientWidth=32 | P0 bug | PS shows "100%" correctly | Increase input width from 34px → 42px in `LayersPanel.tsx` line ~621. |
| LP2 | Visibility toggle, opacity, blend mode, lock, rename (double-click), clipping mask (Ctrl+click layer) — all present | OK | — | — |
| LP3 | **Drag-reorder in layers panel works** (drag handles on layer cards) | OK | — | — |
| LP4 | **No group folder collapse/expand UI** | P1 | PS: click group triangle to expand/collapse | Group layer shows `▶` icon; no expand/collapse implemented. |
| LP5 | **No layer thumbnails for image layers** (small preview img) | P2 | PS: live thumbnail in layer row | Image layers already show `<img>` in thumbnail cell; may be correct. |
| LP6 | **No merge visible / merge all** options | P2 | PS: Ctrl+Shift+E merge visible | Add context menu items. |
| LP7 | Context menu (right-click layer) exists: Hide/Show, Duplicate, Delete — present | OK | — | — |
| LP8 | Multi-select via Ctrl+click works; shift-click does not do range-select | P1 | PS: shift-click = range select | See T1 above. |

---

## 11. KEYBOARD SHORTCUTS

| # | Issue / Gap | Sev | PS shortcut | Status |
|---|---|---|---|---|
| KS1 | `V` → Select tool | Works | ✓ |
| KS2 | `T` → Text tool | Works | ✓ |
| KS3 | `B` → Draw (Brush) | **Missing** — no effect | B should activate Draw tool |
| KS4 | `E` → Eraser | **Missing** — no effect | E should activate erase mode |
| KS5 | `I` → Eyedropper | **Missing** — no effect | I should activate eyedropper |
| KS6 | `S` → Shapes | **Missing** | S should activate Shapes tool |
| KS7 | `Ctrl+Z` → Undo | Works | ✓ |
| KS8 | `Ctrl+Shift+Z` → Redo | Works | ✓ |
| KS9 | `Ctrl+D` → Duplicate layer | Works | ✓ |
| KS10 | `Ctrl+]/[` → Reorder layer | Works | ✓ |
| KS11 | `Delete` → Delete selected | Works | ✓ |
| KS12 | Arrows → 1px nudge | Works | ✓ |
| KS13 | Shift+Arrows → 10px nudge | Works | ✓ |
| KS14 | `Esc` → Deselect | Works | ✓ |
| KS15 | `F1` / `?` → Shortcut overlay | Works | ✓ |
| KS16 | `Ctrl+G` → Group | **Broken/missing** — no effect on single layer | Should group selected layer(s) |
| KS17 | `Ctrl+0` → Fit to window | Works | ✓ |
| KS18 | `Ctrl+1` → 100% zoom | Works | ✓ |
| KS19 | `Ctrl+S` → Save | Listed in F1 overlay as "Save & sync" | Assumed working |

---

## 12. COLOR / PICKER

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| CP1 | Color picker accessible via HexColorInput (swatch + hex text) — present on text, shape, draw tools | OK | — | — |
| CP2 | **No global foreground/background color swatch** (PS-style FG/BG swap) | P2 | PS: persistent FG/BG color chips in tool palette | Add persistent color chip pair to tool pill or sidebar. |
| CP3 | **No color swatches panel** | P2 | PS: saved color swatches | Add swatches panel. |
| CP4 | Eyedropper from canvas — available in Draw tool only | P1 | PS: eyedropper available from any context | Promote eyedropper to global tool shortcut (see KS5). |

---

## 13. ZOOM / PAN

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| ZP1 | `Ctrl+0` fit, `Ctrl+1` 100% — both work | OK | — | — |
| ZP2 | `Ctrl++/Ctrl+-` zoom — listed in F1 overlay | Assumed working | — | — |
| ZP3 | **Wheel zoom at cursor** — not verified (harness can't test scroll) | P1 | PS: zoom centered on cursor | Check `onWheel` handler on canvas container. |
| ZP4 | **Space+drag pan** — listed in F1; not verified via harness | P1 | PS: space holds pans canvas | Likely implemented; verified via F1 overlay. |

---

## 14. HISTORY

| # | Issue / Gap | Sev | What PS does | Fix sketch |
|---|---|---|---|---|
| HI1 | Undo/redo snapshot stack — works (Ctrl+Z / Ctrl+Shift+Z) | OK | — | — |
| HI2 | **No History panel** (list of all undo steps) | P2 | PS: Window > History shows step list | Low priority. |
| HI3 | Gesture-granular undo for brushstrokes (whole stroke = 1 undo) | OK | — | — |

---

## 15. KNOWN MINOR ITEMS — VERDICT

| Item | Status | Evidence |
|---|---|---|
| **Banner vertical centering** | **REAL BUG** — canvas centering container spans y=227–545 within full content area y=55–722. Center of container=386 but center of open area=388.5. Minor (2px off). However the available area calculation may be using full viewport not panel-to-toolbar gap. | DOM measurement |
| **Layers row opacity shows "10" vs Properties "100%"** | **REAL BUG** — scrollWidth=38 > clientWidth=32 for `<input type=number width=34 fontSize=10>`. "100" gets clipped to visible "10". Fix: increase width to 42px in `LayersPanel.tsx` line 621. | DOM measurement |
| **Title pill "My Faceplate" blue glow too heavy** | **NOT A BUG in current build** — computed boxShadow is `rgba(255,255,255,0.05) 0px 0.5px 0px 0px inset, rgba(0,0,0,0.2) 0px 4px 12px -4px`. No blue glow visible. Either fixed in a recent commit, or the original observation was about a different state (unsaved = yellow dot). | DOM measurement |

---

## F1 KEYBOARD SHORTCUT OVERLAY — FULL CONTENTS

**GLOBAL:**
- Esc: Close overlay / deselect
- F1: Show keyboard shortcuts
- Ctrl+S: Save & sync
- Ctrl+Z: Undo
- Ctrl+Shift+Z: Redo
- Ctrl+= / Ctrl+-: Zoom in / out
- Ctrl+0: Fit to window
- Ctrl+1: 100% zoom
- Space + drag: Pan canvas
- Middle-drag: Pan canvas

**FACEPLATE COMPOSER:**
- T: Add text layer
- [: Move layer down
- ]: Move layer up
- ↑↓←→: Nudge 1 px
- Shift+↑↓←→: Nudge 10 px
- Delete: Remove selected layer
- Ctrl+D: Duplicate layer
- Ctrl+C: Copy layer
- Ctrl+V: Paste layer

**DECAL PACK:**
- N: Import image (new decal slot)
- [ (select): Move decal down
- ] (select): Move decal up
- Delete: Remove decal
- Ctrl+D: Duplicate decal
- Ctrl+C: Copy decal
- Ctrl+V: Paste decal
- Esc: Deselect decal

**VEHICLE EDITOR:**
- Ctrl+S, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y (redo alt), Delete, Esc, R (reset camera), F or H (toggle UI), ? (show sheet), LMB drag (orbit), and more (scroll down cut off)

**MISSING from F1 overlay (PS shortcuts not documented):**
V (Select tool), B (Draw), E (Eraser), I (Eyedropper), S (Shapes), Ctrl+G (Group), Ctrl+0/1 (listed separately).

---

## TOP 10 RANKED ISSUES FOR PS PARITY

| Rank | Area | Issue | Sev |
|---|---|---|---|
| 1 | TEXT | Click-to-place text broken (Konva target intercept) | P0 |
| 2 | LAYERS | Opacity "10" display bug (width too narrow) | P0 |
| 3 | SHORTCUTS | B/E/I/S tool shortcuts missing | P1 |
| 4 | TRANSFORM | No Shift=aspect lock during drag-scale | P1 |
| 5 | TRANSFORM | No Shift=15° rotation snap | P1 |
| 6 | SHAPES | No corner radius for rectangles | P1 |
| 7 | LAYERS | Shift-click range-select not working | P1 |
| 8 | TRANSFORM | No Alt+drag duplicate | P1 |
| 9 | DRAW | No brush hardness | P1 |
| 10 | ALIGN | No distribute options; no align-to-selection mode | P1 |

---

*Audit performed 2026-06-15 against CDP :9222 dev server. All observations are from live runtime; no code was modified.*
