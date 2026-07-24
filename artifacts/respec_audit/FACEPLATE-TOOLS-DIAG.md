# FACEPLATE-TOOLS-DIAG.md

**Date:** 2026-06-15  
**Method:** Read-only static analysis of `src/components/FaceplateEditor.tsx` (5 185 lines) and supporting files.

---

## 1. What the right-edge vertical pill actually is

The user's screenshot shows a **two-button vertical pill** at the right edge, mid-screen. This is `AtlasViewPanel` (`src/components/AtlasViewPanel.tsx`, line 42), rendered at `FaceplateEditor.tsx:2880`.

| Button | Icon | Mode toggled | What changes |
|--------|------|-------------|--------------|
| Top | `LayoutTemplate` | `template` | Editor scaffolding (dashed border, corner arrows) |
| Bottom | `Grid3x3` | `checkerboard` | Light grey checker behind layers (alpha preview) |

The third mode (`in_game` / Eye icon) was intentionally removed: `atlas-view-settings.ts:94` — `ATLAS_VIEW_MODE_ORDER: ['template', 'checkerboard']`. The `Eye` icon code still exists but is never rendered. This is NOT the layers panel.

There is **no dedicated layers panel button** — layers live in the permanent left-side strip (see §4).

---

## 2. Feature location table

| # | Feature | File:line | Rendering location | Visibility condition | How to reveal |
|---|---------|-----------|-------------------|---------------------|--------------|
| 1 | **Flip H** | FaceplateEditor.tsx:3395–3413 | Select peel (bottom-centre, above pill) | Select tool active **AND** an **image** layer is selected | Click Select tool → click an image layer on canvas or in layers strip |
| 2 | **Flip V** | FaceplateEditor.tsx:3404–3413 | Select peel | Same as Flip H | Same as Flip H |
| 3 | **Layer RENAME** | FaceplateEditor.tsx:2574–2578 | Left-side layer strip thumbnail | Always visible once layers exist; rename input opens on **double-click** of thumbnail | Double-click any thumbnail in the left-side strip |
| 4 | **Layer DRAG-REORDER** | FaceplateEditor.tsx:2551–2595 | Left-side layer strip | Always available once layers exist; HTML5 drag on thumbnails | Drag one thumbnail over another in the left-side strip |
| 5 | **GRID SNAP toggle** | FaceplateEditor.tsx:3429–3458 | Select peel | Select tool active **AND** a positionable (non-paint, non-group) layer is selected | Click Select → click a layer → Grid icon appears in peel |
| 6 | **GRID SNAP step (4/8/16/32)** | FaceplateEditor.tsx:3439–3457 | Select peel | Same as Grid snap, AND snap must be ON | Same as Grid snap; step buttons appear after enabling snap |
| 7 | **OPACITY slider** (all layer types) | FaceplateEditor.tsx:3417–3427 (image/shape/text), 3660–3669 (text), 3791–3800 (shape) | Select peel (image/shape via `posLayer`); Text peel; Shapes peel | Select peel: select tool + any positionable layer. Text peel: text tool + text layer selected | Click Select → click layer; OR switch to corresponding tool + select layer |
| 8 | **BLEND MODE selector** (image) | FaceplateEditor.tsx:2431–2442 | Adjust Image popover (top-right, opt-in) | `adjustImageOpen === true` AND selected layer is `image` kind | Select an image layer → click the Sliders icon (appears bottom-centre beside peel) → see Blend mode at top of Adjust panel |
| 9 | **BLEND MODE selector** (text) | FaceplateEditor.tsx:3671–3676 | Text peel | Text tool active AND a text layer is selected | Click Text tool → click a text layer |
| 10 | **BLEND MODE selector** (shape) | FaceplateEditor.tsx:3802–3807 | Shapes peel | Shapes tool active AND a shape layer is selected | Click Shapes tool → click a shape layer |
| 11 | **F1 / "?" shortcut overlay** | FaceplateEditor.tsx:3043–3078 | Full-screen modal | `shortcutsOpen === true` | Press F1, OR click the "?" button (bottom-right, always visible) |
| 12 | **Numeric transform inputs X/Y/W/H/°** | FaceplateEditor.tsx:3357–3389 (via `TransformInputsRow`) | Select peel | Select tool active AND a positionable layer (not paint, not group) is selected | Click Select → click any non-paint, non-group layer |
| 13 | **On-canvas Konva Transformer handles** | FaceplateEditor.tsx:1930–1941 | Konva Stage (on-canvas) | Always rendered; `visible` = `activeTool !== 'draw' && activeTool !== 'mask'`. Nodes attached only when `selectedId`/`multiSelectedIds` are non-empty (via `attachTransformerToIds` at line 766) | Click Select → click any layer on canvas |

---

## 3. Key gating conditions for the Select peel (most new tools live here)

```
ToolOptionsPeel activeId = (FaceplateEditor.tsx:2936–2955):
  IF activeTool === 'select'
    AND selectedLayer !== null
    AND selectedLayer.kind !== 'paint'
    AND selectedLayer.kind !== 'group'
  → shows 'select'   ← THIS is what gates X/Y/W/H, Flip H/V, Opacity, Grid Snap
  ELSE → null (peel collapses)
```

The peel is gated on **both** conditions simultaneously. If either is false — wrong tool, or no layer selected — the entire peel is invisible and there is no placeholder.

---

## 4. The left-side Layers strip

`FaceplateEditor.tsx:2466–2805` — a fixed, vertically-centred column on the **left** edge, `position: fixed, left: 12, top: 50%, transform: translateY(-50%)`, zIndex 38. It is:

- **Always visible when `project.layers.length > 0`** (line 2467)
- Contains thumbnail buttons for every layer
- Each thumbnail has: click-to-select, double-click-to-rename input, HTML5 drag for reorder, lock/unlock icon (bottom-right), clipping-mask toggle (top-left, `CornerDownLeft` icon), context menu on right-click

This strip is **not behind any panel button** — it appears automatically once a layer exists. The screenshot faceplate has a visible banner, implying layers do exist, so the strip should be present. If the user doesn't notice it, it is a **discoverability problem**: the strip is only 44px wide, docked to the far left edge, uses 9px labels, and has no header label or disclosure affordance.

---

## 5. Verdict: (a) Discoverability, not a regression or missing feature

All nine parity features are present in the current tree (latest commit `4431b69` — "feat: editor parity + harness"). Nothing is commented out or behind a feature flag.

**The root cause is that every "new" tool is contextual and hidden until the user performs a two-step action that is not surfaced anywhere in the always-visible UI:**

1. **Select tool must be active** — the bottom pill defaults to Select, but after clicking Text/Draw/etc the user may not realise they need to switch back.
2. **A layer must be selected** — clicking empty canvas deselects. The peel shows nothing when no layer is selected, with zero indication that selecting a layer would reveal more controls.
3. **Flip H/V additionally requires the selected layer to be an `image` kind** — not shown for text or shape layers.
4. **Blend mode for images** is behind a second opt-in: select an image layer first, then click the `Sliders` icon that appears in the bottom row beside the peel. The icon itself is unlabelled (icon-only button) and appears/disappears depending on layer selection.

The left-side layer strip (rename, reorder, lock) is always visible once layers exist but is easily overlooked — it is 44px wide, flush to the left edge, uses 9px font, and has no header.

---

## 6. Exact click-path to reveal each new tool

| Feature | Click-path |
|---------|-----------|
| X/Y/W/H numeric inputs | Select tool (bottom pill) → click any image/text/shape layer |
| Konva transform handles | Same as above (handles appear on canvas immediately) |
| Flip H / Flip V | Select tool → click an **image** layer specifically |
| Opacity slider | Select tool → click any layer (not paint/group); OR Text tool → click a text layer; OR Shapes tool → click a shape layer |
| Grid snap + step | Select tool → click any layer → Grid icon in peel → click to enable; step buttons appear |
| Blend mode (image) | Select any image layer → click the **Sliders icon** that appears to the right of the peel → top of Adjust panel shows "Blend mode" |
| Blend mode (text) | Text tool → click a text layer |
| Blend mode (shape) | Shapes tool → click a shape layer |
| Layer rename | Double-click any thumbnail in the **left-side layer strip** |
| Layer reorder | Drag one thumbnail over another in the left-side layer strip |
| F1 / shortcuts | Press F1, or click "?" button bottom-right |

---

## 7. UX fix recommendation (since a pro user couldn't find them)

The peel silently collapses to nothing when no layer is selected. A one-line fix would make the gap visible: show a muted "Select a layer to see transform options" hint inside the peel when `activeTool === 'select'` but `selectedLayer` is null (matches the pattern already used for the Text tool's empty state at `FaceplateEditor.tsx:3679`). This mirrors existing code and requires a 3-line change.

For the Flip H/V image-only gate: either add a tooltip on the select peel saying "Flip: image layers only", or extend Flip to work on shapes/text (just negate their `scale`).

For the Blend mode image path: the Sliders button has `title="Adjust image filters & blend"` but is icon-only and appears/disappears with selection — consider labelling it "Adjust" in text, or moving Blend mode into the Select peel alongside Opacity (as it is for text and shapes).
