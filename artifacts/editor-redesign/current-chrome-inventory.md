# Editor Chrome Inventory — current visual-styling map

Read-only survey of WHERE the three editors' visual chrome is defined, so a
lab01.dev-inspired reskin can restyle surfaces without breaking behavior or the
~2189-test suite.

- Repo: `/var/home/jflessenkemper/dev/coh2-skin-editor`
- Stack: React 19 + TS 6 + **Tailwind v4** (CSS-config, NO `tailwind.config.*`) + Three.js, Electron/Vite.
- OFF-LIMITS (reference aesthetic only, do NOT restyle): `src/components/StartScreen.tsx`,
  `src/components/StartScreenCard.tsx`, `src/components/AuthShell.tsx` (+ their tests). These
  already carry the target lab01.dev look (superellipse corners, `glass-3` cards, glass-frame window).

---

## 1. Design tokens & utilities (the theming CORE)

**`src/index.css` (582 lines) is the single source of truth for the whole surface language.** Tailwind v4, no JS config.

- **Font pipeline:** `@import "@fontsource-variable/geist"` (`index.css:4`); `--font-sans: 'Geist Variable'`
  (`index.css:317`, also `@theme inline` block 315-355). `body` font-family stack `index.css:292-293`.
  `package.json` dep `@fontsource-variable/geist ^5.2.8`.
- **`@theme` design tokens** (`index.css:29-68`) — the coherent-reskin dial:
  - Colors: `--color-app-bg` / `--color-app-bg-deep` (31-32); `--color-glass-1..4` (35-38, white-alpha tints);
    `--color-stroke-1..3` (41-43); `--color-text-1..3` OKLCH (46-48); `--color-accent` = Brigade orange +
    `-soft`/`-strong` (51-53); `--color-blue/green/red` (55-57).
  - Radii: `--radius-card:18px` `--radius-panel:22px` `--radius-pill:9999px` `--radius-input:10px` (60-63).
  - Shadows: `--shadow-glass` (66), `--shadow-pop` (67).
- **`glass-*` utilities** (`@utility`, `index.css:87-145`) — the frosted-glass recipes:
  - `glass-1/2/3` (87-110): dark base `rgb(15 17 22 / .65–.80)` + white gradient + `backdrop-filter: blur(32–44px) saturate(140–160%)` + 0.5px hairline. Used by **menus/dialogs/cards** over dimmed content.
  - `glass-hud` / `glass-pill` / `glass-pop` (125-145): base `rgb(20 22 28 / .62–.72)`, blur 36px, deep OUTSET float shadow. **THE editor-chrome recipe** — docks/rails/pills/popovers over the live viewport. `glass-hud`=panels/rails, `glass-pill`=bottom control pills, `glass-pop`=popovers.
  - `glass-frame` / `glass-frame-inner` (175-207): outer window ring + inner 16px-radius clip. App.tsx/AuthShell/WindowControls only — window chrome, effectively OFF-LIMITS.
- **Global squircle:** `*,::before,::after { corner-shape: superellipse(1.33) }` (163-167); `.rounded-full { corner-shape: round }` (171-173). This is the lab01.dev signature already applied app-wide.
- **shadcn bridge:** `@theme inline` (315-355) + `:root`/`.dark` (357-424) map shadcn vars (`--background`, `--card`, `--primary`, `--radius:0.625rem`…). The shadcn `ui/` components read THESE, not the glass tokens.
- **Misc utilities:** `.custom-scrollbar` (461-506), View-Transition keyframes (524-539), `bb-pressable`/`bb-cta` CTA press animation (557-572), `liveSyncWsPulse` (579).

**`src/components/editor-primitives/tokens.ts` (146 lines) is the SECOND core** — runtime inline-style
mirrors of the glass system (used as React `style` props, which can't reference CSS `@utility` classes):
- Color atoms: `EDITOR_ACCENT` = `rgba(120,180,255,0.95)` (blue "selected", deliberately ≠ brand orange),
  `EDITOR_ACCENT_FILL/_BORDER/_FILL_STRONG` (46-50), `EDITOR_TEXT_1..4` (55-58), `EDITOR_STROKE_1` (65).
- Inline-style objects: `topbarButtonStyle` (87), `panelButtonStyle` (105), `panelButtonLargeStyle` (121),
  `sectionHeadingStyle` (139). Re-exported via `editor-primitives/index.ts:86-100`.

> Note: the glass surface exists in **two parallel definitions** — CSS `@utility glass-*` (for `className`)
> and inline `backdropFilter` literals (for `style` props). A coherent reskin must touch BOTH.

---

## 2. Shared primitives

### `src/components/editor-primitives/**` (styled with INLINE style objects, not Tailwind — by design, see index.ts:31)
| Component | Surface it paints | Uses |
|---|---|---|
| `EditorTitlePill.tsx` | Centered glass title pill (pack name + live-sync + rename/publish popover). BorderBeam when unacknowledged. | all 3 editors (via TopBar / editor top) |
| `BottomToolPill.tsx` | **`glass-hud`** bottom-center tool dock (56×56 segments, `role="toolbar"`). | Faceplate, DecalPack |
| `UndoRedoBar.tsx` | Two 36×36 **`glass-pill`** icon chips (Undo/Redo). | all 3 editors |
| `ToolOptionsPeel.tsx` | Floating glass "peel" above BottomToolPill (lighter sub-layer, radius 14). | Faceplate, DecalPack |
| `PanelButton.tsx` | Ghost button (topbar/medium/compact); active = blue `EDITOR_ACCENT_FILL_STRONG`. | panels in all editors |
| `PanelHeading.tsx` | 10px uppercase section heading (`sectionHeadingStyle`). | all panels |
| `IconButton.tsx` | 22×22 transparent icon button (row actions). | LayerRow, panels |
| `ToggleChip.tsx` | Two-state pill (off=panel button, on=blue). Wraps PanelButton. | Flip H/V etc. |
| `SliderRow.tsx` | Label + range + value readout; blue thumb (orange via `accent` prop). | Faceplate/DecalPack/Brush |
| `SliderPopover.tsx` | 28×28 icon button → floating vertical-slider popover. | tool peels |
| `LayerRow.tsx` | Layer/decal list row (thumb + rename + eye + trash); active = blue accent. | Layers lists |
| `AdjustmentPanel.tsx` / `TransformPanel.tsx` | Grouped slider panels. | Faceplate |
| `GlassModal.tsx` | Centered modal dialog surface. | confirmations |
| `GlassToast.tsx` | Toast surface (editor-scoped). | editors |
| `EditorHomeButton.tsx` | Top-left glass "home/back" chip (inlines HI glass literal). | all 3 editors |
| `ProjectMetaPanel.tsx` | Project metadata panel. | editors |
| `BlendModeSelect.tsx` / `GradientFillEditor.tsx` / `CurvesEditor.tsx` / `HexColorInput.tsx` / `CanvasPlaceholder.tsx` | Specialized controls. | editors |

### `src/components/editor-shared/**`
| Component | Surface | Uses |
|---|---|---|
| `LayersPanel.tsx` | Left-docked **`glass-hud`** Photoshop-style layers panel (180px). (inlines glass-hud recipe — comment line 97) | Faceplate |
| `PropertiesPanel.tsx` | Right-docked **`glass-hud`** properties panel (opacity/blend/shadow). (inlines glass-hud — line 121) | Faceplate, DecalPack, texture |
| `TransformInputsRow.tsx` | X/Y/W/H/angle number inputs. | DecalPack + Faceplate |
| `CanvasHandles.tsx` | On-canvas resize/rotate handles (blue `EDITOR_ACCENT` fill — matches tokens). | editors |
| `ImageDropZone.tsx` | Invisible drop/paste wrapper (no visible chrome). | editors |

### `src/components/ui/**` (shadcn-derived — read `:root`/`.dark`/`@theme inline` vars, NOT glass tokens)
`button, card (glass-2), dialog (glass-3), dropdown-menu (glass-3), select (glass-3), glass-segmented, input, label, slider, switch, tabs, textarea, tooltip, badge, avatar, progress, separator, border-beam, loading-border, animated-swap`. Card/dialog/dropdown/select pull in `glass-2`/`glass-3`.

---

## 3. Per-editor chrome (major surfaces + where styled + blast radius)

Editor sizes: `Editor.tsx` 2609, `TopBar.tsx` 1874, `VehicleTextureEditor.tsx` 1014,
`DecalPackEditor.tsx` 4009, `FaceplateEditor.tsx` 5699, `Viewport.tsx` 5458 lines.

### A. Skin editor = `Editor.tsx` + `TopBar.tsx` + `VehicleTextureEditor.tsx`
| Surface | Where styled | Blast radius |
|---|---|---|
| Panels toggle cluster (top) | `Editor.tsx:2307` `className="glass-hud …"` | shared class — low |
| Export/HUD clusters | `Editor.tsx:2352, 2397` `glass-hud`; **inline** `backdropFilter` `Editor.tsx:2469` | mixed — 1 inline literal |
| Title pill + rename/publish popover | `TopBar.tsx` renders `EditorTitlePill`; popover `TopBar.tsx:333` `glass-pop` | shared primitive + 1 class |
| Vehicle menu (bottom-center pills) | `VehicleMenu.tsx:102` `glass-hud`; active pill `bg-white/95` | shared class, but **active style hand-rolled** |
| Scene preset picker (right edge) | `ScenePanel.tsx:39` `glass-hud`; active `bg-white/95 text-black` | shared class + hand-rolled active |
| Faction switcher (left edge) | `FactionPanel.tsx:35` `glass-hud`; active `bg-white/95` | shared class + hand-rolled active |
| Season toggle | `SeasonToggle.tsx:30` `glass-pill` (segmented) | shared class |
| "Edit texture" pill | `EditTextureButton.tsx:59` `glass-pill`; active state **inline** `backdropFilter` `:66` | 1 inline literal |
| Texture editor chrome | `VehicleTextureEditor.tsx` **inline** `backdropFilter: blur(40px) saturate(150%)` at `:534, :683`; pill `glass-pill` `:776 bottom:24` | **2 inline literals** |
| Toasts (app-wide) | `Toasts.tsx:31` Tailwind (`bg-black/60 backdrop-blur-md` etc.) — NOT glass utility | hand-rolled, **test-pinned** |

### B. `DecalPackEditor.tsx` (4009)
- Home cluster, `BottomToolPill`, `ToolOptionsPeel`, `PropertiesPanel`, `AtlasViewPanel` (all shared).
- **Hand-rolled inline `backdropFilter` surfaces** at `:2246 (blur20/sat160)`, `:2339 (blur40/sat150)`,
  `:2479 (blur20/sat160)`, `:2534 (blur8)` — popovers/overlays not on the glass utility. **4 inline literals.**

### C. `FaceplateEditor.tsx` (5699)
- `LayersPanel` (left), `PropertiesPanel` (right), `BottomToolPill`, `ToolOptionsPeel`, `AtlasViewPanel`, `EditorTitlePill` (all shared).
- Fit insets constant `:553`. Toolbar `role="toolbar"` `:3196`.
- **Hand-rolled inline `backdropFilter`** at `:2949 (blur40/sat150)`, `:3066 (blur24/sat180)`. **2 inline literals.**

### Shared "active-pill" pattern (bg-white/95)
`VehicleMenu, ScenePanel, FactionPanel, AtlasViewPanel` all encode the SELECTED pill as `bg-white/95 text-black`
inline. There's no shared constant — reskinning the active state = 4 edits (and 2 are test-pinned; see §4).

---

## 4. Test coupling (what a pure reskin could break)

Testing-Library `getByTitle`/`getByLabelText`/`getByRole('toolbar')` returned **zero** matches — tests do
NOT query by title/label text. Instead they use `container.querySelector('.class')` + `className.toContain(...)`.
So aria-labels/titles are safe to keep; **class-name substrings are the fragile surface.** No visual snapshots.

**HIGH risk (assert exact chrome class strings — a reskin that renames/removes these breaks them):**
- `__tests__/Toasts.test.tsx:113,121,129` — asserts `bg-black/60`, `bg-emerald-600/30`, `bg-red-700/40`,
  `text-white/emerald-100/red-100` on the toast pill (`.fixed > div`). Also `.fixed` structural selector.
- `__tests__/ScenePanel.test.tsx:147,149,150` — asserts active `bg-white/95`, inactive `.not bg-white/95`.
- `__tests__/VehicleMenu.test.tsx:245,247,260-262` — asserts `bg-white/95` (active) + `.bg-orange-400` dot presence.
- `__tests__/WindowControls.test.tsx:114,119,187,264-273` — asserts `fixed top-5 right-5 z-[9999]`,
  `h-10`, `hover:bg-red-500/70`, `hover:bg-white/10` (window chrome — OFF-LIMITS anyway).
- `__tests__/TokensPreview.test.tsx:103-104,158-161` — asserts `--color-glass-1/-4` CSS vars resolve AND
  `.glass-1..4` elements render. **NOTE: TokensPreview.tsx is an ORPHAN** (not mounted in App.tsx/main.tsx —
  only its own test imports it). Renaming any glass token/utility breaks this test even though nothing ships it.

**MEDIUM risk (assert `.glass-3`/`.glass-frame-inner` presence — mostly OFF-LIMITS surfaces):**
- `__tests__/AuthShell.test.tsx:310-311` (`.glass-3`), `__tests__/OnboardingOverlay.test.tsx:63-65` (`.glass-3`),
  `__tests__/CssGradientBackground.test.tsx:89` + `ShaderWaveBackground.test.tsx:92` (`.glass-frame-inner`).
  Only OnboardingOverlay is in-scope; the rest are start-screen/window.

**LOW risk (className/style asserts unrelated to glass chrome):** `AsapFlagHeading, ExportSlotsGrid,
ExportTilePreview, ImageLibrary, SavedProjectsList, StartScreen, BrushPanel, CanvasPlaceholder,
ConnectScreen, editorWiring, FaceplateInGamePreview, HexColorInput, Stagger` — assert on layout/state
classes or inline geometry, not the glass surface language.

**Reskin test-safety rule:** keep the `glass-1..4/hud/pill/pop/frame` utility NAMES and the `--color-glass-*`
token NAMES (change their VALUES freely). Keep `bg-white/95` as the active-pill marker, or update
ScenePanel/VehicleMenu tests in lockstep. Keep Toasts' `bg-black/60 | bg-emerald-600/30 | bg-red-700/40`
kind-classes or update `Toasts.test.tsx`.

---

## 5. Theming seams — coherent-reskin leverage ranking

There ARE two central seams that restyle ALL editors coherently: `index.css` `@theme` + `@utility glass-*`,
and `editor-primitives/tokens.ts`. Changing VALUES there cascades everywhere. The hand-rolled surfaces
(inline `backdropFilter` literals in the 3 big editors, `bg-white/95` active pills) must be edited individually.

**Top-5 highest-leverage files for a coherent reskin:**
1. **`src/index.css`** — `@theme` tokens + `glass-*` utilities + squircle + scrollbar + CTA anims. Change token/utility VALUES here and the entire app (glass color, blur, radius, shadow, accent) shifts at once. Keep NAMES for test safety.
2. **`src/components/editor-primitives/tokens.ts`** — runtime inline-style mirrors (`EDITOR_ACCENT`, `EDITOR_TEXT_*`, `topbar/panelButtonStyle`, `sectionHeadingStyle`). Governs every primitive rendered via `style` props (which can't read `@utility` classes). Must move in lockstep with #1 or the two glass definitions diverge.
3. **`src/components/editor-primitives/index.ts` + the primitive `.tsx` files** — `BottomToolPill, EditorTitlePill, LayerRow, PanelButton, SliderRow, ToolOptionsPeel, UndoRedoBar…`. One edit per primitive restyles that surface across all 3 editors. Highest structural leverage after the two token files.
4. **`src/components/editor-shared/{LayersPanel,PropertiesPanel}.tsx`** — the docked panels shared across editors; each INLINES the glass-hud recipe (LayersPanel:97, PropertiesPanel:121) rather than using the class, so they need per-file edits but each covers all editors that mount them.
5. **The 3 editor shells `Editor.tsx` / `DecalPackEditor.tsx` / `FaceplateEditor.tsx`** — the hand-rolled inline `backdropFilter` literals (8 total: Editor:2469, DecalPack:2246/2339/2479/2534, Faceplate:2949/3066, plus VehicleTextureEditor:534/683, EditTextureButton:66) live here and do NOT flow from #1. These are the highest blast-radius PER-FILE edits and the ones most likely to look "off" if #1 changes but they don't.

Runner-up: `VehicleMenu/ScenePanel/FactionPanel/AtlasViewPanel` share the `glass-hud` class (flows from #1) but hand-roll the `bg-white/95` active state (4 edits, 2 test-pinned).

---

## 6. Performance context (backdrop-filter over live Three.js viewport)

The skin editor's chrome floats over a **live Three.js `Viewport.tsx` (5458 lines)** render — every
`backdrop-filter: blur()` surface over it re-samples the GPU framebuffer each frame (expensive).

**Chrome OVER the live viewport (backdrop-filter cost is real — keep blur radii sane):**
- `VehicleMenu` (bottom pills), `ScenePanel` (right), `FactionPanel` (left), `SeasonToggle`,
  `EditTextureButton`, `Editor.tsx` HUD clusters, `EditorTitlePill`/`TopBar` popover — all `glass-hud/pill/pop`
  (blur 36px) or inline blur(36–40px) sitting on the animated 3D scene. Blur ≥44px here would tank FPS.

**Chrome over STATIC areas (2D canvas / dimmed backdrop — cheaper):**
- `FaceplateEditor` / `DecalPackEditor` panels sit over a 2D Konva-style work canvas (`LayersPanel`,
  `PropertiesPanel`, `BottomToolPill`, `ToolOptionsPeel`, `AtlasViewPanel`) — static backdrop, blur cost negligible.
- Dialogs/modals (`GlassModal`, shadcn `dialog`/`dropdown`/`select` `glass-3`) render over a dimmed overlay — cheap.

**Reskin implication:** the `glass-hud`/`glass-pill`/`glass-pop` blur values in `index.css:125-145` are the
viewport-critical ones; the `glass-1..4` (menus/dialogs) values are not. If the lab01.dev look wants heavier
blur, raise it on `glass-1..4` freely but keep `glass-hud/pill/pop` ≤ ~40px to protect viewport FPS.
