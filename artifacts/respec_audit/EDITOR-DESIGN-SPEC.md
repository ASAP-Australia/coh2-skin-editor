# Editor UX/visual perfection spec (grounded in CDP screenshots, 2026-06-15)

Quality bar = the START SCREEN (clean dark glass card, ASAP logo, COH2·COMMUNITY MODDING TOOL,
highlighted Continue card with blue glow, 2×2 action grid w/ colored accent icons, generous
spacing, muted uppercase labels). The editors must match this polish. Window 1376×816.

## Faceplate editor — problems seen (03-faceplate-selected.png)
P1 Canvas work surface near-invisible: banner is dark-on-dark, no clear editable-area boundary.
P2 Orphaned grid-snap button floats in a lone box above the bottom toolbar.
P3 Layers panel: secondary row (% / blend / ↵) looks tacked-on; dead space; weak selection state.
P4 Properties panel: cramped, small inputs, thin spacing, weak hierarchy; blend dropdown narrow.
P5 Decal editor structurally different (dense icon toolbar) — inconsistent with faceplate panels.

## Design direction
### Canvas work surface (P1) — biggest win
- Render the faceplate banner as a clearly-defined ELEVATED surface centered in the inset canvas
  area: banner-aspect frame, hairline/accent border, subtle drop shadow to lift off the bg, the
  transparency checker inside, and a small dimension chip ("692 × 204") at a corner.
- The editable region must be instantly obvious. Add faint corner ticks or a 1px frame.
- Margins/background around it stay dark (#0a0b0e); the surface is one step lighter (#16181f) +
  shadow so it reads as "the document".
### Bottom area (P2)
- Remove the lone floating grid box. Move grid-snap into the bottom toolbar (a toggle button) OR
  into Properties > a "Snap" control. Bottom area = clean tool row only.
### Layers panel (P3)
- Row: [drag handle][28px thumb][name flex/truncate][eye][lock]. Selected = accent-tinted bg +
  2px left accent bar. Secondary (opacity+blend) on a tidy hover/selection-revealed line, aligned.
- Header "LAYERS" + count chip. 8px padding grid, subtle row hover, hairline separators.
- Graceful empty space (no awkward float). Consider a faint "drag layers to reorder" hint when 1 layer.
### Properties panel (P4)
- Consistent section block: uppercase muted label + divider + content. 8px grid.
- TRANSFORM: tidy 2-col grid (X/Y, W/H, ° ) with equal field widths, ~24-26px inputs.
- APPEARANCE: opacity field + full-width-ish blend dropdown.
- TEXT/SHAPE/IMAGE: grouped controls, consistent control heights, aligned.
- ALIGN: labeled icon group.
- Match start-screen type scale + muted label color; more breathing room.
### Consistency (P5) — after faceplate polished
- Bring the DECAL editor onto the SAME shared LayersPanel + PropertiesPanel (editor-shared/).

## Verification method
Implement → AppImage build+deploy → CDP harness screenshot (passive) → coordinator assesses image →
iterate. Batch improvements per build. Export byte-identical throughout (golden tests green).

---

## Visual overhaul pass 1 (2026-06-15)

### P1 — Canvas work surface

**File:** `src/components/FaceplateEditor.tsx` (lines ~1197–1257, ~1545–1593, ~2376–2380)

A new "document surface" wrapper `<div>` was inserted around the `canvasRef` div, inside `ImageDropZone`. The surface:
- **Background:** `#16181f` (one step lighter than the `#0a0b0e` editor bg)
- **Size:** `FACEPLATE_BANNER_W × viewScale + 48` × `FACEPLATE_BANNER_H × viewScale + 48` — 24px padding on each side so the checker breathes inside the surface
- **Border:** `1px solid rgba(255,255,255,0.13)` hairline
- **Shadow:** `0 32px 96px -24px rgba(0,0,0,0.80), 0 8px 32px -8px rgba(0,0,0,0.60), 0 0 0 1px rgba(0,0,0,0.40)` — multi-layer to lift the document off the bg
- **Dimension chip:** `"692 × 204"` at bottom-right of the surface, `rgba(247,247,250,0.28)`, 9px, tabular-nums
- **Pan/zoom offset:** moved from the `canvasRef` div to the new surface wrapper, so the shadow + surface move together with zoom
- The `canvasRef` div lost its old `boxShadow` and `transform`; now has only a subtle `inset 0 0 0 0.5px rgba(255,255,255,0.08)` inner highlight

### P2 — Remove orphaned grid button

**File:** `src/components/FaceplateEditor.tsx` (lines ~3168–3184, ~3507–3552)

- **Removed:** the standalone grid-snap button from the `FaceplateToolPeelBody` `'select'` case (was a lone Grid icon button)
- **Added:** grid-snap as a `ToolExtra` on `BottomToolPill` — `extras` prop with `id: 'grid-snap'`, `icon: <Grid size={20} />`, `label: 'Snap'`, `pressed: snapGrid`, `onClick: () => setSnapGrid(v => !v)`, `testId: 'grid-snap-toggle'`
- The `'select'` peel now returns `null` when `snapGrid` is false; shows only snap-step chips (4/8/16/32) when snap is active, prefixed with `STEP` label
- Bottom area is now a clean tool row with the Snap toggle as a native `extras` segment — no orphan boxes

### P3 — Layers panel polish

**File:** `src/components/editor-shared/LayersPanel.tsx`

- **Drag handle:** added `<GripVertical size={12} />` as first element in the primary row, `rgba(255,255,255,0.20)` color, `cursor: grab`
- **Left accent bar:** replaced `border` approach with `borderLeft: 2px solid EDITOR_ACCENT` for selected rows, `2px solid EDITOR_ACCENT + 66` for multi-select, `2px solid transparent` unselected — no layout shift
- **Row hover:** `rgba(255,255,255,0.04)` background on hover (no border); selected is `EDITOR_ACCENT + 1a` (~10% alpha)
- **Row border:** `borderRadius: '0 6px 6px 0'` when selected/multi (flat left edge against the accent bar); `6` otherwise
- **Hairline separator:** `borderBottom: 0.5px solid rgba(255,255,255,0.05)` between rows
- **Header count chip:** `countChipStyle` — 9px, `rgba(255,255,255,0.06)` bg, `0.5px solid rgba(255,255,255,0.10)` border, 4px radius, `padding: 1px 5px`
- **Empty state:** shows `"No layers yet.\nDrop an image or use a tool."` when 0 layers (was returning `null`)
- **Single-layer hint:** `"Drag to reorder · double-click to rename"` faint hint when exactly 1 layer
- **Secondary row:** unchanged (opacity + blend revealed on hover/select via `maxHeight` transition)

### P4 — Properties panel polish

**Files:** `src/components/editor-shared/PropertiesPanel.tsx`, `src/components/editor-shared/TransformInputsRow.tsx`, `src/components/editor-primitives/BlendModeSelect.tsx`

**PropertiesPanel changes:**
- **Divider spacing:** `margin: '8px 0 6px'` (was `2px 0`) — cleaner section breaks
- `scrollBody` gap reduced to 0 (sections self-space via dividers)
- `sectionLabel` fontWeight bumped 600 → 700
- **TRANSFORM:** now uses `TransformInputsRow layout="grid"` — a 3-row layout: X/Y row, W/H row, ° row, each with equal-width flex-1 inputs at 26px height and muted uppercase tags (X, Y, W, H, °) as 9px labels
- **APPEARANCE opacity:** rendered as labeled row with `Opacity` tag (44px wide), `maxWidth: 52px` input, `%` suffix — consistent 26px height
- **APPEARANCE blend:** full-width `BlendModeSelect` with `style={{ flex: 1, minWidth: 0 }}` so mode names never truncate; 44px `Blend` label prefix; 26px height select (updated in BlendModeSelect.tsx)
- All `sectionLabel` `marginTop: 6` overrides removed — divider provides the spacing

**TransformInputsRow changes (`layout="grid"`):**
- Added `layout?: 'row' | 'grid'` prop (default `'row'` keeps all existing usages unchanged)
- `NumFieldInline` helper: a standalone `<input>` that accepts an explicit `style` prop, 26px height, flex-1
- Grid layout: 3 `<div>` rows with `gap: 6`, `marginBottom: 4`

**BlendModeSelect changes:**
- Added `style?: CSSProperties` prop for wrapper div (spread via `...style`)
- Added `selectStyle?: CSSProperties` prop for the `<select>` element
- Select height changed `28 → 26` px for consistency with other inputs

### Test suite
- Baseline: 2000 tests, 111 files
- After pass 1: **2000 tests, 111 files** — all green
- `npx tsc -b`: clean (0 errors)

---

## Visual overhaul pass 2 (2026-06-15)

### Root cause of black canvas

**File:** `src/components/FaceplateEditor.tsx` (surface wrapper ~line 1212, canvas bg ~line 1611)

Pass 1 added a `#16181f` surface wrapper, but `#16181f` = rgb(22, 24, 31) is only 12 RGB points above the `#0a0b0e` editor bg rgb(10, 11, 14). At typical monitor brightness this difference is imperceptible — both read as solid black. The canvas interior fallback `#1a1c22` had the same problem. The Konva Stage's transparent canvas element overlays the div without filling it, so whatever the div's background is (nearly-black `#1a1c22`) was effectively invisible against the `#16181f` surface. Result: everything looked black.

### Fix 1 — Surface visibility

**File:** `src/components/FaceplateEditor.tsx` (surface wrapper and canvas bg styles)

- **Surface background:** `#16181f` → `#252836` (rgb(37,40,54) — clearly blue-tinted dark, 27 pts above `#0a0b0e`). Now unmistakably lighter than the void.
- **Surface border:** `rgba(255,255,255,0.13)` → `rgba(255,255,255,0.20)` — more visible hairline.
- **Surface shadow:** rewritten to an outward glow: `0 0 0 1px rgba(255,255,255,0.06), 0 16px 64px -8px rgba(0,0,0,0.90), 0 4px 16px -4px rgba(0,0,0,0.70)` — stronger lift off the bg.
- **Surface border-radius:** 4 → 6px — slight rounding matches the glass-card design language.
- **Canvas interior bg (transparent projects):** `#1a1c22` → `#141620` (rgb(20,22,32)) — sits clearly inside the `#252836` surface, providing a visible inset rectangle at the exact 624×204 editing area.
- **Dark checker:** replaced `rgba(255,255,255,0.07/0.03)` (invisible) with solid two-tone `#1c1f2d / #141620` — a clearly legible dark-mode transparency checker.
- **Canvas inner box-shadow:** changed from `inset 0 0 0 0.5px rgba(255,255,255,0.08)` to `inset 0 0 0 1px rgba(0,0,0,0.60)` — dark inset border delineates the canvas edge from the surface padding.
- **CanvasPlaceholder:** `background: '#1a1c22'` → `transparent` (the canvas div now carries the background); dashed outline opacity `0.12` → `0.18`; arrow/dot opacity `0.25` → `0.35`.
- **Dim chip color:** `rgba(247,247,250,0.28)` → `rgba(247,247,250,0.35)` — slightly more legible on the lighter surface.

**Stacking after fix:** editor root `#0a0b0e` → surface div `#252836` (visible) → canvas div `#141620` with checker (clearly inset rectangle) → Konva Stage (transparent canvas, layers on top). The document surface is now unmistakably the editable region.

### Fix 2 — Empty peel box above toolbar

**File:** `src/components/FaceplateEditor.tsx` (activeId condition ~line 3114)

**Root cause:** When `activeTool === 'select'` and a positionable layer is selected, `activeId` was set to `'select'`. But `FaceplateToolPeelBody` for `'select'` returns `null` when `!snapGrid` (snap is off by default). `ToolOptionsPeel` still rendered its glass container div (with `background/backdrop-filter/border/boxShadow`) but with empty children — creating the visible empty rounded glass box.

**Fix:** Added `&& snapGrid` to the select-case activeId condition:
```
selectedLayer && selectedLayer.kind !== 'paint' && selectedLayer.kind !== 'group' && snapGrid
  ? 'select'
  : null
```
Now the peel container never mounts for the select tool unless there is actual content (snap step chips) to display. No empty glass box.

### Fix 3 — Polish details
- Arrow guide opacity in `CanvasPlaceholder` bumped from 0.25 → 0.35 for better contrast against the darker `#141620` canvas background.
- Dim chip text in the surface slightly brighter (0.28 → 0.35) for legibility on the updated `#252836` surface.

### Test suite
- After pass 2: **2000 tests, 111 files** — all green
- `npx tsc -b`: clean (0 errors)
