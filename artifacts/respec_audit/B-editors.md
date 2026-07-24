# B — Photoshop-parity audit: Decal / Skin / Faceplate editors

Abbrev: **DPE**=src/components/DecalPackEditor.tsx, **FPE**=FaceplateEditor.tsx, **VTE**=VehicleTextureEditor.tsx, **ED**=Editor.tsx (skin 3D shell), **KSD**=editor-primitives/keyboard-shortcuts-data.ts. "Skin" column = ED+VTE+TopBar.tsx panels.

## 1. Feature matrix

| Feature | Decal pack | Faceplate | Skin (3D + texture) |
|---|---|---|---|
| Layer create | PARTIAL — only via image import/insignia (DPE:391-506); no blank layer | YES — image/text/shape/paint (FPE:354-388); **groups have no creation UI** (newGroupLayer faceplate-project.ts:693 never called from FPE) | NO layers — single paint surface (VTE:25-32, megatask/editors.md:160) |
| Layer reorder | YES — drag (DPE:824-853, 1902-1906) + buttons | PARTIAL — `[`/`]` keys only (FPE:481-486); no drag, no buttons | n/a |
| Visibility / opacity | YES — ctx menu Hide (DPE:2134), opacity slider | PARTIAL — Hide via ctx menu (FPE:2318); **opacity slider only for shape layers** (FPE:3145-3155); image/text/paint have none | n/a |
| Lock / rename | YES — pos lock (DPE:2031-2064); dbl-click rename (DPE:1923, 1977-2029) | PARTIAL — pos+aspect lock (FPE:2173-2242); **no layer rename** | n/a |
| Clipping mask | YES (badge) | YES (FPE:2244-2268) | NO |
| Move (drag+snap) | YES (DPE:864-955) — **not undoable** (`undoable:false`, no commit at pointer-up DPE:920-950) | YES (FPE:3854-3921) — **pushes one undo frame per pointermove tick** (FPE:3907 + mutate default FPE:302-306) | brush only; 3D decals drag-place |
| Scale / rotate | sliders + rotate±90° (DPE:2865-2891); no on-canvas handles | 8-handle resize + rotate handle (CanvasHandles.tsx:98-207, FPE:1764-1784) — **also per-tick undo frames** (FPE:1774-1783); no rotate90, no sliders | rotation slider step 5°, size slider (TopBar.tsx:871-888) |
| Flip H/V | YES | **NO UI** — flipH/V rendered (FPE:1508) but never settable | YES for image decals (TopBar.tsx:919-946) |
| Numeric inputs | X/Y only (DPE:3010, 3046); no W/H/angle | X/Y only (FPE:2802-2825) | none |
| Align to canvas | YES — 6 buttons (DPE:2907-2975) | YES — 7 buttons (FPE:3460-3510); **image layers use bounds=0** (FPE:3440-3456 returns 0 for non-text/shape) → "align left" puts image centre at x=0 | NO |
| Snapping | canvas centre/edges (DPE:894-901) + grid 4/8/16/32 (DPE:902-907, 2634) | canvas + sibling-layer centres (FPE:3879-3898); no grid | NO |
| Rulers / persistent guides | NO | NO | NO |
| Undo/redo | 50-deep dual stacks + Ctrl+Z/⇧Z/Y (DPE:140-141, 621-631) | same (FPE:302-349, 446-456) | labelled history (decal-history.ts:30-137), Ctrl+Z/Y + buttons (ED:1126-1145, VTE:327-399) — **snapshots only decals+mainDecalId (decal-history.ts:61-81); 'Paint stroke' commits (ED:1240, 1831) never restore pixels** |
| Blend modes | 16-mode select (DPE:3083) | **image layers only**, inside Adjust popover (FPE:1997-2008 — sole BlendModeSelect usage); text/shape/paint have none | NO |
| Adjustments | bright/contrast/sat + hue (DPE:3122), tint | 9-slider AdjustmentPanel + Curves modal (FPE:2009-2028, 1954-1970) | NO (AI camo instead) |
| Shortcut overlay | YES — F1 + ? button (DPE:616-620, 1677, 1709) | **NO** (only DPE mounts KeyboardShortcutsOverlay) | `?` ShortcutHelpSheet (ED:1847) |
| Tool-switch keys | NO | T only (FPE:469-472) | R/E/F/H (ED:1160-1172, 418) |
| Copy/paste/duplicate | Ctrl+C/V (DPE:685-708); **no Ctrl+D** (button only DPE:2860) | Ctrl+C/V multi (FPE:519-558), Ctrl+D (FPE:457-460) | NO copy/paste of 3D decals |
| Nudge | arrows, configurable 1/2/4/8 ×10 (DPE:164-166, 658-659) | arrows, fixed 1/10 (FPE:494-501); multi-selection not nudged | NO |
| Zoom | wheel 0.5–8× (DPE:746-752) + %/Fit/1:1 pill (DPE:2292-2374); "Fit"=fixed 4× | wheel 0.5–8× (FPE:621-630); pill removed by design (FPE:2525-2526) | none — fixed fit (VTE:250-285) |
| Pan / hand tool | NO | NO | NO (3D orbit only) |
| Eyedropper | YES, draw peel (DPE:968-985) — samples only the active decal's rasterised layer, not the full composite | YES (FPE:804-812, 3196-3209) | YES, Pick tool (VTE:188-196) |
| Swatches / colour | hex input (HexColorInput.tsx:4-8); no swatches/recents | same + BG solid/gradient, GradientFillEditor (FPE:3113-3120) | native picker + 12 swatches (VTE:62-65, 547-580) |
| Text tool | NO | YES — rich (font/size/weight/italic/spacing/line-height/para-align, FPE:2851-3021; click-to-place + dbl-click re-edit FPE:1372-1378) | NO (name/number stamps only) |
| Shape tools | NO | rect/circle/star/line + gradient + W/H sliders (FPE:3121-3144) | NO |
| Brush | size 1-40, hardness, opacity, erase, mirror X/Y (DPE:1010-1021); `[`/`]` size keys (DPE:632-644) | size/colour/opacity/erase/mirror (FPE:3162-3237); **no hardness, no [/] size keys** ([/]=layer order) | size 8-512/softness/opacity/mirror (VTE:515-541); **no shortcuts at all** (only Esc, VTE:233-239) |
| Pressure / tip shapes / flow | NO (no `pressure` reads anywhere; round tips only, brush.ts) | NO | NO |
| Layer masks | model only (not baked at export) | YES — add + hide/reveal paint (FPE:3515-3601) | NO |
| Image import | picker + batch 32 + drop + insignia modal (DPE:129, 2383) | drop/paste/picker (FPE:354-373) | via TopBar image decals |

## 2. G1–G11 ground truth

Source list: .llm/megatask/editor-parity-audit.md:88-101; claimed done in .llm/megatask/todo.md:194-196 (G12 intentionally skipped). **All 11 are genuinely present in DPE**; logic pinned by src/lib/__tests__/decal-parity-features.test.ts (G3,4,5,7,8,9,10,11) and editor-undo-redo-stack.test.ts.

| G | What | Where | Caveat |
|---|---|---|---|
| G1 hardness | DPE:183-185, 1018-1021, 3208 | shadowBlur feather; decal-only — not ported to FPE brush |
| G2 shortcuts overlay | DPE:616-620, 1677, 1709 | **overlay data is wrong**: KSD:40-48 lists `N` new-slot, `Ctrl+D`, `[`/`]` move-decal — none bound in DPE (handler DPE:607-713); `[`/`]` actually = brush size |
| G3 drag-reorder | DPE:824-853, 1902-1906 | — |
| G4 rotate ±90° | DPE:2865-2891 (+normaliseRotation DPE:3313) | — |
| G5 align 6× | DPE:2907-2975 | — |
| G6 rename | DPE:172-174, 1977-2029 | decal-only; FPE layers still unnamed |
| G7 `[`/`]` size | DPE:632-644 | draw-mode only |
| G8 nudge step | DPE:164-166, 658-659, 2612 | FPE still fixed 1/10 |
| G9 multi-move | DPE:880-944 | moves are `undoable:false` with **no commit** → group move invisible to undo |
| G10 hue | DPE:3122 | — |
| G11 grid snap | DPE:168-170, 902-907, 2634 | decal-only |

## 3. Ranked gaps (pro-modder impact)

1. **Paint-stroke undo is a no-op in the skin editor (correctness bug).** decal-history snapshots/restores only `decals`+`mainDecalId` (decal-history.ts:61-81) yet ED commits 'Paint'/'Paint stroke'/'Clear paint' (ED:971, 1240, 1831) — Ctrl+Z toasts "Undo: Paint" and VTE buttons enable, but pixels never revert. Fix: extend `EditSnapshot` with optional `diffuseSnapshot: ImageData|dataUrl` captured in `commit()` when label starts with 'Paint'/'Clear', restored in `applySnapshot` onto `baseDiffuseRef` + `repaint()`. Files: src/lib/decal-history.ts, ED (pass canvas getter). ~60 LOC.
2. **One-undo-frame-per-gesture.** FPE drag pushes a frame per pointermove (FPE:3907) and so do resize/rotate (FPE:1774-1783) — a 1 s drag burns ~60 of 50 frames and floods localStorage (FPE:296-322); DPE drag commits nothing (DPE:920-950). Fix both with the same pattern: mutate `{undoable:false}` during move, push one frame at gesture start (commit before first move) — mirror DPE's `mutate` options (DPE:254-275). Files: FPE beginDrag/handle callbacks, DPE beginCanvasDrag onUp. ~40 LOC.
3. **Port the G-pack to FPE** (it's the editor where pros spend most time): F1 overlay mount (copy DPE:1709), zoom %/Fit/1:1 pill (copy DPE:2292-2374 verbatim — note FPE:2525 says it was removed by design; re-confirm with user), flip H/V buttons in select peel (model already renders flipH FPE:1508; mirror TopBar.tsx:919-946), rotate±90 (copy DPE:2865), drag-reorder + rename in layer strip (copy DPE:824-853, 1977-2029), grid snap (copy DPE:902-907), nudge-step control (copy DPE:2612), universal layer-opacity SliderPopover (generalise FPE:3145-3155 to all kinds), BlendModeSelect for text/shape/paint peels (reuse FPE:1997 pattern). ~300 LOC total, all existing primitives.
4. **Shortcut truth + gaps.** Fix KSD:37-48 to match real bindings; add Ctrl+D duplicate (handler exists FPE:457 — copy into DPE:607 effect calling onDuplicateDecal), Esc-deselect in DPE, and `N` new-blank-decal or remove it from KSD. ~25 LOC.
5. **Zoom/pan ergonomics.** No Space-drag pan anywhere; DPE "Fit" is hardcoded 4× (DPE:2335), VTE has no zoom at all — painting a 2048² atlas through a ~1024 px viewport. Shared `usePanZoom` hook (wheel=zoom at cursor, Space/middle-drag=pan, Ctrl+0 fit, Ctrl+1 100%) applied to DPE/FPE stage transform and VTE blit rect. ~150 LOC.
6. **On-canvas transform handles for DPE.** CanvasHandles is faceplate-typed (CanvasHandles.tsx:46-58); adapt to `Decal` (scale uniform) and mount beside snap guides; today scale/rotate require leaving the canvas for the Transform peel. ~80 LOC.
7. **FPE image-layer align bug** — compute image bounds `img.width*scale` (data available via project.images) instead of 0 at FPE:3440-3456. ~10 LOC.
8. **Numeric W/H + angle fields.** Extend the X/Y row (DPE:3010, FPE:2802) with W/H (scale-derived) and angle inputs; or add type-in to SliderPopover (it's slider-only, SliderPopover.tsx:147-150). ~60 LOC.
9. **Texture-editor brush shortcuts + pressure.** `[`/`]` size (copy DPE:632-644 into VTE key effect at VTE:233), read `e.pressure` to modulate size/opacity in VTE:183-223/brush.ts. ~30 LOC.
10. **3D decal precision** (TopBar): rotation slider step is 5° (TopBar.tsx:877); add numeric entry + step 1. ~15 LOC.

## 4. Pain points beyond features

- **Eyedropper (DPE) samples the active decal's own raster, not what's under the cursor** (DPE:970-980 uses `rasteriseDecal(activeDecal)`) — colours from underlying layers can't be picked; async `.then` can also race a fast second click.
- **Faceplate re-encodes the full 624×204 PNG on every mutation** (FPE:574-596, no debounce) + synchronous localStorage per drag tick (FPE:285-295) — visible drag jank risk on large packs.
- **Clipboard rejects cross-editor pastes by design** (FPE:541-542, DPE:695) — a modder can't move a logo from faceplate to decal pack without re-importing.
- **Multi-select asymmetry:** FPE multi-delete/copy but no group drag (FPE:3854 single layer) and no multi-nudge (FPE:497-501); DPE group drag exists (G9) but no multi-align/delete.
- **Select peels under-used:** FPE select peel is X/Y only (FPE:2761-2835); blend/adjust hidden behind a per-thumbnail "Adjust" button (FPE:1912-1920) — discoverability cost.
- Design language to reuse for any new control: BottomToolPill+ToolOptionsPeel (DPE:2285-2289, FPE:2519), glass pill chrome (VTE:288-325), SliderPopover/PanelButton/GlassModal primitives, right-edge AtlasViewPanel (DPE:2380), TopBar glass-pop dropdown for skin-editor panels (TopBar.tsx:318-355).
