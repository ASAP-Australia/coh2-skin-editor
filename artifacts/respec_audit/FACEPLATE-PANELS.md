# FACEPLATE-PANELS.md

**Date:** 2026-06-15  
**Build state:** tsc clean, vitest 2000/2000 green (baseline 1990; +10 new)

---

## Panel Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [LAYERS PANEL]   [        CANVAS (624×204 Konva stage)        ]  [PROPERTIES PANEL]  │
│  (fixed, left:8)  [        centred, scrollable via pan/zoom    ]  (fixed, right:8)    │
│  width: 180px     [                                             ]  width: 220px        │
│  zIndex: 38       [  bottom pill tools (select/text/shapes/…)  ]  zIndex: 38          │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Layers panel**: `position: fixed; left: 8px; top: 50%; transform: translateY(-50%)`
- **Properties panel**: `position: fixed; right: 8px; top: 50%; transform: translateY(-50%)`
- Both use the same dark glass surface: `rgba(14,16,21,0.82)` + `backdrop-filter: blur(24px) saturate(160%)` + `0.5px solid rgba(255,255,255,0.09)` + `border-radius: 12px`
- The existing bottom toolbar pill, AtlasViewPanel right-edge pill, and ? button are unchanged.

---

## New Files

### `src/components/editor-shared/LayersPanel.tsx`
Persistent left-side Layers panel. Renders all layers in reverse z-order (top of stack first in panel). Each row has:
- **28px thumbnail** (same icon logic as old strip: T for text, SVG for shape, img for image, ✏ for paint)
- **Editable name** (double-click row triggers rename; Enter commits, Esc/blur also commits)
- **Visibility eye toggle** (`data-testid="visibility-toggle-{id}"`)
- **Compact opacity number input** (`data-testid="opacity-input-{id}"`)
- **Compact blend mode select** (`data-testid="blend-select-{id}"`)
- **Flip H / Flip V toggles** (image layers only; `data-testid="flip-h-{id}"`, `flip-v-{id}"`)
- **Lock position toggle** (icon: Lock/LockOpen)
- **Clip-to-below toggle** (`data-testid="clip-toggle-{id}"` — same testid as old strip)
- **Drag-to-reorder** (HTML5 drag; reuses `onLayerDragStart/Over/Drop/End` handlers)
- Active layer highlighted with `EDITOR_ACCENT` border/fill
- Scrollable with `className="custom-scrollbar"`

### `src/components/editor-shared/PropertiesPanel.tsx`
Persistent right-side Properties panel. Shows selected layer's editable properties:
- **Empty state** when nothing selected: "Select a layer to edit its properties" (`data-testid="properties-empty-state"`)
- **Transform section**: X/Y/W/H/° via `TransformInputsRow` (reused from `editor-shared/`)
- **Appearance section**: opacity number input (`data-testid="properties-opacity-input"`), `BlendModeSelect` (`data-testid="blend-mode-select"`), Flip H/V (image only)
- **Text section** (text layers): font family select, size `SliderPopover`, weight select, Bold/Italic toggles, alignment buttons, letter-spacing, line-height, `HexColorInput`
- **Shape section** (shape layers): `HexColorInput`, `GradientFillEditor`, width/height sliders
- **Adjust section** (image layers): Curves… button, Sliders expand toggle, `AdjustmentPanel`
- **Align section** (positionable layers): Center H + Center V shortcuts

---

## What Moved from Peels → Panels

| Feature | Old location (file:line) | New location |
|---------|--------------------------|--------------|
| X/Y/W/H/° transform | FaceplateEditor.tsx select-peel ~3357–3389 | PropertiesPanel Transform section |
| Flip H/V (image) | FaceplateEditor.tsx select-peel ~3391–3415 | PropertiesPanel Appearance + LayersPanel row |
| Opacity (positionable) | FaceplateEditor.tsx select-peel ~3417–3427 | PropertiesPanel Appearance + LayersPanel opacity input |
| Blend mode (text) | FaceplateEditor.tsx text-peel ~3671–3676 | PropertiesPanel Appearance |
| Blend mode (shape) | FaceplateEditor.tsx shapes-peel ~3802–3807 | PropertiesPanel Appearance |
| Blend mode (image) | FaceplateEditor.tsx adjustImage popover ~2431 | PropertiesPanel Appearance |
| Text font/size/weight/style/align/color | FaceplateEditor.tsx text-peel ~3464–3680 | PropertiesPanel Text section |
| Shape fill/gradient/width/height | FaceplateEditor.tsx shapes-peel ~3746–3810 | PropertiesPanel Shape section |
| Image adjust filters | FaceplateEditor.tsx adjustImage popover | PropertiesPanel Adjust section |
| Layer visibility toggle | Layer context menu only | LayersPanel eye button (every row) |
| Per-layer opacity | Not available in strip | LayersPanel compact number input |
| Per-layer blend | Not available in strip | LayersPanel compact select |
| Flip H/V per-row | Not available in strip | LayersPanel row (image layers) |
| Lock/clip per-row | FaceplateEditor.tsx strip ~2687–2800 | LayersPanel row (reused handlers) |

## What Was Removed / Hidden
- **Old 44px layer thumbnail strip** (`FaceplateEditor.tsx:2555–2895`) — disabled with `{false && ...}` wrapper to keep code stable, replaced by `LayersPanel`.
- **`adjustImageOpen` Sliders button** from the bottom toolbar remains but now controls the expand state of the AdjustmentPanel inside PropertiesPanel (not a separate floating popover).
- **The contextual peels for select/text/shapes** are KEPT in the bottom toolbar — they still function and the shapes-tool peel still shows the add-shape buttons. The Properties panel adds always-visible editing without removing peel discovery paths. No duplicate controls: the shapes peel's add-shape buttons are not in the Properties panel.

## Reused Handlers (no rewrites)
- `mutate` / `mapLayer` — all mutations go through the shared history engine
- `onLayerDragStart` / `onLayerDragOver` / `onLayerDrop` / `onLayerDragEnd` — passed as props to LayersPanel
- `renamingLayerId` / `setRenamingLayerId` — same state, same handlers
- `TransformInputsRow` — imported from `editor-shared/`, identical to select-peel usage
- `BlendModeSelect`, `AdjustmentPanel`, `GradientFillEditor`, `SliderPopover`, `HexColorInput` — imported from `editor-primitives/`, same props

## New vs Existing Code
- **New**: `LayersPanel.tsx` (~340 lines), `PropertiesPanel.tsx` (~400 lines)
- **Modified**: `FaceplateEditor.tsx` — added 2 imports, ~80 lines of helper callbacks, replaced old strip block (341 lines) with 20-line `<LayersPanel>` invocation, added 10-line `<PropertiesPanel>` invocation
- **Modified**: `editorWiring.test.tsx` — updated 1 existing test + added 10 new tests

## Suite Count
- **Baseline**: 1990 tests / 111 files
- **Final**: 2000 tests / 111 files (+10 new tests)
- **tsc**: Clean (0 errors)
- **Export golden tests**: Unchanged (not touching composeFaceplateCanvas or sga-writer.ts)

---

## LIVE-PASS Checklist

- [ ] Layers panel visible on left with header "LAYERS" and layer count badge
- [ ] All layers listed in z-order (top of stack first in panel)
- [ ] Each row shows: thumbnail, name, eye button, opacity input, blend select
- [ ] Image layer rows show Flip H and Flip V buttons
- [ ] Clicking a row selects that layer (Konva Transformer appears)
- [ ] Dragging rows reorders layers (undo works)
- [ ] Double-clicking row opens inline rename input; Enter commits; Esc cancels
- [ ] Opacity input changes layer opacity (undo works, one frame per change)
- [ ] Blend select changes layer blend mode (undo works)
- [ ] Visibility eye toggle hides/shows layer
- [ ] Properties panel visible on right with header "PROPERTIES"
- [ ] Properties panel shows empty-state when no layer selected
- [ ] Properties panel shows Transform X/Y/W/H/° when a positionable layer is selected
- [ ] Properties panel shows Opacity + Blend for all layer types
- [ ] Properties panel shows Flip H/V for image layers
- [ ] Properties panel shows Text section (font/size/weight/style/align/color) for text layers
- [ ] Properties panel shows Shape section (fill/gradient/size) for shape layers
- [ ] Properties panel shows Adjust section with Curves… + filter sliders for image layers
- [ ] Export is byte-identical (faceplate-export-golden.test.ts green)
- [ ] tsc clean, vitest 2000/2000 green

---

## Refinement pass — 2026-06-15

### Layout: Real Edge Docks + Inset Canvas

**Before:** both panels were `position: fixed; top: 50%; transform: translateY(-50%)` floating boxes with `zIndex: 38`, overlapping the Konva canvas.

**After:** panels are still `position: fixed` but now span the full usable vertical range:
- `top: calc(var(--app-top-inset, 0px) + 68px)` — clears the 44px title pill (12px from top + 44px height + 12px margin)
- `bottom: 108px` — clears the bottom toolbar (24px offset + 44px pill + 8px peel gap + 32px breathing room)

**Canvas inset math:** `ImageDropZone` padding changed from symmetric `80px / 80px` to:
- `paddingLeft: 226px` = 210px Layers dock + 16px gap
- `paddingRight: 244px` = 228px Properties dock + 16px gap

`usePanZoom.fitToWindow()` uses `getBoundingClientRect()` of the `pzContainerRef` (still `inset:0`, full viewport), but the `ImageDropZone` inside it now centres the banner in the padded area. Result: the banner fit-to-window scales against the 226–244px inset space, so NO part of the banner is ever hidden behind a panel.

**Dock widths:**
- Layers dock: **210px** (was 180px — +30px to eliminate horizontal scrollbar, accommodate name label)
- Properties dock: **228px** (was 220px — +8px to give sections more breathing room)

### What was removed: select-tool peel redundancy

The `select` tool peel in `FaceplateToolPeelBody` previously rendered:
- `TransformInputsRow` (X/Y/W/H/°)
- Flip H / Flip V toggles (image layers)
- Opacity `SliderPopover`
- Grid snap toggle + step buttons

All three transform/flip/opacity controls are **now in the Properties panel** (right dock). The select peel now renders **only the grid snap toggle + step buttons** — zero duplicate controls. The `TransformInputsRow` import was removed from `FaceplateEditor.tsx`.

### Layers row redesign

**Before:** all controls in one horizontal row (thumb + name + eye + opacity + blend + flip H + flip V + lock + clip) → ~240px+ of content crammed into a 180px column, forcing horizontal scrollbar.

**After:** clean two-row structure at 210px width:

**Primary row (always visible):**
`[28px thumbnail] [name — flex, truncates with ellipsis] [18px eye] [16px lock]`
→ No horizontal overflow. Name gets ~120px and truncates gracefully.

**Secondary row (always in DOM; fades in on hover/selection):**
`[34px indent] [% + 34px opacity input] [blend select — flex] [16px clip-to-below]`
→ `opacity: 0; maxHeight: 0` when not active → `opacity: 1; maxHeight: 24px` on hover or selection (100ms CSS transition).
→ Always in DOM for accessibility and test queries; visually collapsed for unselected rows.

**Flip H/V removed from the row** — they live in Properties > Appearance section where they're always visible and context-appropriate.

### Visual tokens applied

Both panels now use identical glass surface:
- `background: rgba(14,16,21,0.86)` (matches BottomToolPill surface)
- `backdropFilter: blur(28px) saturate(160%)`
- `border: 0.5px solid rgba(255,255,255,0.09)` — same hairline as bottom pill
- `borderRadius: 12px` — same as bottom pill
- Section labels: 9–10px uppercase, `letterSpacing: 1.2–1.4`, `color: EDITOR_TEXT_4`
- Input fields: `height: 20–26px`, `borderRadius: 4–5px`, `background: rgba(255,255,255,0.05)`, `border: 0.5px solid rgba(255,255,255,0.12)`
- 8px spacing grid throughout; `gap: 4–8px` between controls

### Suite count & build status

- **Tests:** 2000 passed / 2000 total (111 files) ✓
- **tsc:** 0 errors ✓
- **Golden exports:** unchanged (composeFaceplateCanvas + sga-writer.ts untouched) ✓

### LIVE-PASS Checklist (Refinement pass)

- [ ] Panels don't overlap the banner at any window size (banner fully visible between docks)
- [ ] Panels don't overlap the title pill or the bottom tool row
- [ ] No duplicate transform controls (X/Y/W/H/° only in Properties panel, NOT in select peel)
- [ ] Select peel shows ONLY grid snap toggle when a positionable layer is selected
- [ ] Layers panel is 210px wide, no horizontal scrollbar at any content length
- [ ] Layer rows: primary row shows thumbnail + name + eye + lock; no overflow
- [ ] Layer row secondary controls (opacity, blend, clip) appear on hover/selection
- [ ] Flip H/V NOT in layer rows — only in Properties > Appearance
- [ ] Properties panel is 228px wide, sections separated by dividers, labels aligned
- [ ] Glass surface matches bottom tool pill exactly (same color/blur/border/radius tokens)

---

## Decal Editor Reuse Opportunity
`LayersPanel.tsx` and `PropertiesPanel.tsx` are factored into `src/components/editor-shared/` with clean props interfaces. `DecalPackEditor` could adopt the same panels by passing its own `project`, `mutate`, `selectedLayer`, `getLayerLabel`, `getLayerThumbnail` callbacks — no component logic changes needed. Recommend implementing in a follow-up ticket to avoid scope creep here.
