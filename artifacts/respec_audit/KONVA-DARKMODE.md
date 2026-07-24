# KONVA DARKMODE — Canvas Surface Darkening

**Date:** 2026-06-14
**Branch:** ci/auto-release-on-version-bump
**Status:** COMPLETE

---

## Problem

The Konva migration left the editor canvas surfaces in a mixed state:

| Surface | Old color | Issue |
|---|---|---|
| `CanvasPlaceholder` (both editors) | `#ececec` (light grey) | Glaringly light inside a dark `#0a0b0e` editor |
| `CanvasPlaceholder` dashed border | `rgba(0,0,0,0.30)` | Dark border on light surface → swapped |
| `CanvasPlaceholder` arrows + dot | `rgba(0,0,0,0.30/0.35)` | Dark strokes on light surface → swapped |
| `CanvasPlaceholder` labels | `rgba(0,0,0,0.55)` on `rgba(255,255,255,0.6)` | Light badge on light surface |
| DecalPackEditor canvas div (non-transparent) | `background: checkerBackground()` — transparent base, barely-visible white tints | No explicit dark canvas surface; relies on app base bleeding through |
| FaceplateEditor canvas div (`backgroundColor=null`) | `background: checkerBackground()` — transparent base | Same: no explicit dark surface |

---

## Changes (file:line)

### 1. `src/components/editor-primitives/CanvasPlaceholder.tsx`

All inline style changes:

| Property | Old value | New value | Token / rationale |
|---|---|---|---|
| `containerStyle.background` | `#ececec` | `#1a1c22` | One step above editor base `#0a0b0e`; same `rgb(15-17-22)` family as glass surfaces |
| `containerStyle.outline` | `2px dashed rgba(0,0,0,0.30)` | `2px dashed rgba(255,255,255,0.12)` | Light hairline on dark surface; matches `EDITOR_STROKE_1` tonally |
| `labelStyle.color` | `rgba(0,0,0,0.55)` | `rgba(247,247,250,0.50)` | `EDITOR_TEXT_3` — tertiary label on dark |
| `labelStyle.background` | `rgba(255,255,255,0.6)` | `rgba(255,255,255,0.06)` | Glass micro-badge (matches `EDITOR_STROKE_1` fill family) |
| `captionStyle.color` | `rgba(0,0,0,0.45)` | `rgba(247,247,250,0.35)` | `EDITOR_TEXT_4` — quaternary on dark |
| `captionStyle.background` | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.04)` | Faintest glass fill |
| `dotStyle.background` | `rgba(0,0,0,0.35)` | `rgba(247,247,250,0.25)` | Soft light dot on dark |
| SVG arrow `stroke` (×2) | `rgba(0,0,0,0.30)` | `rgba(247,247,250,0.25)` | Light arrows on dark surface |

### 2. `src/components/DecalPackEditor.tsx`

**Lines ~1579–1581 (canvas div background):**

Old:
```ts
background: previewTransparent ? '#ffffff' : checkerBackground(),
backgroundImage: previewTransparent ? lightCheckerBackground() : undefined,
backgroundSize: previewTransparent ? '16px 16px' : '24px 24px',
```

New:
```ts
backgroundColor: previewTransparent ? '#ffffff' : '#1a1c22',
backgroundImage: previewTransparent ? lightCheckerBackground() : darkCheckerBackground(),
backgroundSize: '16px 16px',
```

- `#1a1c22` is now the explicit dark canvas surface (not relying on transparent CSS passthrough).
- `darkCheckerBackground()` = `repeating-conic-gradient(rgba(255,255,255,0.07) 0% 25%, rgba(255,255,255,0.03) 25% 50%)` layered over the dark base, visible as a subtle 16px checker pattern indicating transparency.
- Old `checkerBackground()` function removed (had transparent base; replaced by explicit `#1a1c22` + `darkCheckerBackground()`).
- New `darkCheckerBackground()` function added at ~line 3738.
- Transparent-preview mode unchanged: `#ffffff` base + `lightCheckerBackground()` for classic Photoshop checker.

### 3. `src/components/FaceplateEditor.tsx`

**Lines ~1460–1466 (canvas div background):**

Old:
```ts
background: previewTransparent ? '#ffffff' : (project.backgroundColor ?? 'transparent'),
backgroundImage: previewTransparent
  ? lightCheckerBackground()
  : project.backgroundColor === null
    ? checkerBackground()
    : 'none',
backgroundSize: '24px 24px',
```

New:
```ts
backgroundColor: previewTransparent
  ? '#ffffff'
  : (project.backgroundColor ?? '#1a1c22'),
backgroundImage: previewTransparent
  ? lightCheckerBackground()
  : project.backgroundColor === null
    ? darkCheckerBackground()
    : 'none',
backgroundSize: '16px 16px',
```

- When `backgroundColor` is `null` (true transparency): shows `#1a1c22` dark surface + `darkCheckerBackground()` checker.
- When `backgroundColor` is a user-set color (e.g. `#c8240a`): unchanged — shows the project fill color.
- When `backgroundColor` is `undefined` (not yet set): falls to `#1a1c22` (dark surface, no checker — `undefined === null` is false).
- Old `checkerBackground()` function replaced by `darkCheckerBackground()` at ~line 5160.
- Transparent-preview mode unchanged.

---

## Design Token Mapping

| Token | Value | Used in |
|---|---|---|
| App editor base | `#0a0b0e` | Editor root div (unchanged, both editors) |
| Dark canvas surface | `#1a1c22` | Canvas div background (both editors), `CanvasPlaceholder` |
| `EDITOR_TEXT_3` | `rgba(247,247,250,0.50)` | `CanvasPlaceholder` dimension label |
| `EDITOR_TEXT_4` | `rgba(247,247,250,0.35)` | `CanvasPlaceholder` "Editor guide — not exported" caption |
| `EDITOR_STROKE_1` tonal | `rgba(255,255,255,0.06)` | `CanvasPlaceholder` label badge background |
| Dark checker | `rgba(255,255,255,0.07/0.03)` | `darkCheckerBackground()` overlay on `#1a1c22` |

---

## What Did NOT Change

- **Konva Stage** (`<Stage>` component): remains transparent — it is an HTML `<canvas>` element that blends content over the canvas div's CSS background. No Konva `Rect` background was added; the CSS `backgroundColor` on the container div provides the dark surface.
- **Transparent-preview mode** (`previewMode === 'checkerboard'`): intentionally shows the classic light Photoshop checker (`#ffffff` + `lightCheckerBackground()`). Users need the light checker to judge alpha=0 regions against an in-game-like surface.
- **Export pipeline** (`composeFaceplateCanvas`, `rasteriseDecal`, `compositePartLayers`): zero changes. Golden tests still green.
- **Glass toolbars, bottom pills, side panels**: unchanged — they were already dark-mode consistent.

---

## Suite Count and TSC Status

```
tsc -b       EXIT 0 — no type errors
vitest run   109 test files, 1957 tests — all PASS (baseline 1957, no regression)
```

---

## Live-Pass Checklist (dark-mode verification)

Open the app and check visually:

- [ ] **Canvas working area (both editors):** The 128×128 decal canvas and the 624×204 faceplate banner should have a dark surface (`#1a1c22`) rather than being indistinguishable from the dark void margins.
- [ ] **Dark checker on canvas:** A faint 16px checker pattern should be visible over the `#1a1c22` surface, indicating that the canvas area represents transparency (alpha=0). It should be subtle — not as high-contrast as the light Photoshop checker.
- [ ] **Transparent-preview mode (checkerboard):** Switching to the "checkerboard" / "transparent" preview mode should still show the classic light grey/white Photoshop checker on a white base — unchanged from before.
- [ ] **Empty canvas placeholder:** When there is no active decal (DecalPackEditor) or no layers + no backgroundColor (FaceplateEditor), the `CanvasPlaceholder` should show:
  - Dark `#1a1c22` background
  - White-ish dashed border (subtle hairline)
  - Light-colored dimension label (e.g. "128 × 128 px") with a very faint glass badge
  - Light-colored diagonal arrows pointing toward corners
  - Light center dot
  - Italic caption "Editor guide — not exported"
- [ ] **Faceplate with explicit background color:** When a faceplate project has a `backgroundColor` set (e.g. dark red `#c8240a`), the canvas should show that color (unchanged behavior — only `null`/`undefined` backgrounds are affected).
- [ ] **Decal content contrast:** Decals (which may be light-colored or have light edges) should still read clearly against the `#1a1c22` dark canvas. Brighter decal pixels pop against the dark surface.
- [ ] **Layer content contrast (FaceplateEditor):** Text layers, shape layers, image layers should all remain clearly readable against the dark canvas surface.
- [ ] **Surrounding margins:** The canvas margins (outside the 128×128 or 624×204 rect) should remain the deep `#0a0b0e` base — darker than the canvas surface, so the canvas reads as an elevated working plane.
- [ ] **OOB (out-of-bounds) red zone:** The red OOB shade overlay should still appear when decals/layers spill past the canvas boundary — it renders as a CSS overlay on top of the dark surface.
- [ ] **Glass chrome (toolbars, pills):** Bottom tool pills and side panels should look unchanged — still glass-dark. The dark canvas should feel like it belongs to the same surface family.
