# CoH2 Community Modding Tool — Full UI Control Inventory (read-only recon)

Scope: every interactive control (button, toolbar item, menu, icon, slider, input, drop zone)
across the three editors (Skin, Faceplate, Decal-Pack), the shared primitives, chrome, and
start-screen/dialogs. Built by grepping `src/components/**` for `<button>`, `title=`,
`aria-label=`, `label=`, `placeholder=`, and `lucide-react` icon imports. Icon names are the
lucide-react component names.

Icon library: **lucide-react `^1.14.0`** (the ONLY icon lib; verified in `package.json`).

Legend for FLAG column:
- **A** = icon with no visible label AND no tooltip/title (discoverability problem)
- **B** = exposes engine/jargon internals to the user
- **C** = redundant / duplicate control
- **D** = icon poorly matches its function
- **E** = panel overloaded (control count noted)
- `—` = no flag

---

## Architecture note (important for the audit)

The app has **three separate full-screen editors**, each with its own toolbar/panel system:
1. **Skin editor** — 3D `Viewport.tsx` + `TopBar.tsx` panels + bottom `VehicleMenu`. Orchestrated by `Editor.tsx`.
2. **Faceplate editor** — 2D Konva canvas, `FaceplateEditor.tsx` (5,542 lines, single file).
3. **Decal-pack editor** — 2D Konva canvas, `DecalPackEditor.tsx` (3,733 lines, single file).

Two of the three (Faceplate, Decal-pack) are near-duplicate Photoshop-style editors with
overlapping-but-inconsistent toolbars (see FLAG C rows). Shared bits live in
`editor-primitives/` and `editor-shared/`.

**Stale docstring:** `TopBar.tsx:1-24` documents a `[Faction lobby ▾] [Paint][Compose][Publish]`
cluster bar with sub-tabs. That cluster/tab bar is **not rendered anywhere in the current
`TopBar.tsx` or `Editor.tsx`** — TopBar now only renders panel *bodies* keyed off `activePanel`,
the centered title pill, and the home button. There is no visible on-screen control that sets
`activePanel` to `decals`/`camo`/`scene`/`parts`/`reference` from within TopBar. This is a
navigation/discoverability gap worth confirming with the maintainer (FLAG A/architecture).

---

## AREA 1 — Top bar / chrome (window + title + home)

| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Chrome | Minimize | "Minimize" (aria/title only) | inline SVG dash | Minimize OS window | WindowControls.tsx:116,149 | — |
| Chrome | Maximize/Restore | "Maximize"/"Restore" (aria/title) | inline SVG | Toggle maximize | WindowControls.tsx:122 | — |
| Chrome | Close | "Close" (aria/title) | inline SVG × | Close window | WindowControls.tsx:127 | — |
| Title | Editor title pill | pack name text (editable) | state icon (sync) | Click to rename pack; opens PackIdentityPopover | TopBar.tsx:216; EditorTitlePill.tsx | — |
| Title | Home / Close-pack | none visible | (EditorHomeButton icon) | Return to StartScreen | TopBar.tsx:316; EditorHomeButton.tsx | A (icon-only home; has no title/aria in EditorHomeButton — verify) |
| Chrome | Live Sync badge (skin dot) | "Live Sync — {reason}" (aria/title) | CheckCircle2/XCircle/Loader2/Circle | At-a-glance autosync status; click toggles | LiveSyncBadge.tsx:14,48,210 | — |
| Chrome | Live Sync settings | "Live Sync settings" (aria) | (gear/Power/Upload/RotateCcw/Cloud/CloudOff) | Open sync settings popover | LiveSyncBadge.tsx:48,315 | — |
| Chrome | Workshop sync dot | "Workshop sync: {reason}" (aria) | Cloud / CloudOff | Workshop upload status | LiveSyncBadge.tsx:62 | — |

## AREA 2 — Skin editor: TopBar panels (left floating panel, `activePanel`-keyed)

Panel bodies render into a single 320px floating panel (`TopBar.tsx:331-362`). One panel visible at a time.

### 2a. View / Pack panel (`ViewPanel`, TopBar.tsx:470)
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| View panel | Pack name input | "Name" | none | Edit pack name | TopBar.tsx:491 | — |
| View panel | Description textarea | "Description" | none | Edit pack description | TopBar.tsx:503 | — |
| View panel | Save .coh2skin | "Save .coh2skin" | none | Download project file | TopBar.tsx:524 | B (`.coh2skin` file-ext jargon) |
| View panel | Load .coh2skin | "Load .coh2skin" | none | Load project file | TopBar.tsx:533 | B |
| View panel | Close pack | "Close pack" + "Back to start" | LogOut | Exit pack to StartScreen | TopBar.tsx:558,564 | — |
| View panel | Disconnect | "Disconnect" + "Pick different folder" | none | Drop FS handle, re-pick install | TopBar.tsx:571 | — |

### 2b. Decals panel (`DecalsPanel`, TopBar.tsx:588) — **overloaded, ~6 sub-sections**
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Decals | Template stamp grid (5-col) | image only (title=name·faction) | template SVG thumbnail | Arm one-click insignia stamp | TopBar.tsx:628,631 | — |
| Decals | Image library drop/list | "Image library" | (ImageLibrary internal) | Upload/manage stamps | TopBar.tsx:665; ImageLibrary.tsx | — |
| Decals | Cancel placement chip | "× Cancel" (title "Cancel placement (Esc)") | × glyph | Disarm place mode | TopBar.tsx:696 | — |
| Decals | Place-type grid | "+ Shield/Number/Name/Kills/Cross/Image" | none | Arm decal-placement mode | TopBar.tsx:711 | — |
| Decals | Decal row select | type + "(x,y) rot° size px" mono | none | Select placed decal | TopBar.tsx:798,844 | B (raw px/deg/coords displayed) |
| Decals | Main-decal star toggle | "Set/Unset as main decal" (aria) | Star | Mark tile-icon/preview badge decal | TopBar.tsx:829,841 | — |
| Decals | Remove decal | "Remove decal" (aria) | × glyph | Delete decal | TopBar.tsx:848 | — |
| Decals | Inherited decal (readonly) | "Edit via Generate Modal → All faction scope" (title) | Lock / Star | Show inherited faction-default decals | TopBar.tsx:765,768,775 | B (references nonexistent "Generate Modal") |
| Decals | Rotation slider | "Rotation °" | none | Rotate active decal | TopBar.tsx:865 | — |
| Decals | Size slider | "Size px" | none | Resize active decal | TopBar.tsx:874 | — |
| Decals | Kill rings slider | "Kill rings" | none | Count of kill rings | TopBar.tsx:883 | — |
| Decals | Opacity slider | "Opacity %" | none | Image decal opacity | TopBar.tsx:896 | — |
| Decals | Flip H | "H" | FlipHorizontal2 | Mirror decal horizontally | TopBar.tsx:913,924 | — |
| Decals | Flip V | "V" | FlipVertical2 | Mirror decal vertically | TopBar.tsx:927,938 | — |
| Decals | Text input | placeholder=tac/name | none | Number/name decal text | TopBar.tsx:946 | — |
| Decals | Clear all decals | "Clear all decals on this vehicle" | none | Remove all decals on vehicle | TopBar.tsx:785 | — |

### 2c. Camo panel (`CamoPanel`, TopBar.tsx:1059) — **MOST overloaded panel: ~10 sections, AI internals exposed**
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Camo | Apply-scope 3 options | "This vehicle only / Every {faction} vehicle / All 80 vehicles" | AlertTriangle (warn) | Set camo apply scope | TopBar.tsx:1410,1425,1456 | — |
| Camo | Camo prompt input | "Describe your camo" | none | Free-text camo prompt | TopBar.tsx:1465 | — |
| Camo | Preview | "Preview" | none | Render preset preview | TopBar.tsx:1477 | — |
| Camo | Apply to skin | "Apply to skin" | none | Apply procedural camo | TopBar.tsx:1487 | — |
| Camo | Paste/upload dropzone | "Paste (Ctrl+V), drop, or click…" | none | Import camo image | TopBar.tsx:1532 | — |
| Camo | Quick presets grid | preset labels | none | One-click camo presets | TopBar.tsx:1572 | — |
| Camo | Style adapter (LoRA) select | "Style adapter" / "None (base model)" | none | Pick diffusion LoRA | TopBar.tsx:1614,1620 | B (LoRA / `.safetensors` jargon) |
| Camo | Adapter strength slider | "Adapter strength" | none | LoRA weight 0–1.5 | TopBar.tsx:1636 | B (SDXL `<lora:name:weight>` weighting) |
| Camo | Valid CoH2 atlas mode | "Valid CoH2 atlas mode (preserve equipment + UV)" | checkbox | img2img mode toggle | TopBar.tsx:1653,1662 | B (atlas/UV/img2img internals) |
| Camo | Generate | "Generate" | none | Run local diffusion | TopBar.tsx:1668 | — |
| Camo | Status pill | "Engine not installed / No model in diffusion/models/ / Ready (cold) / …" | spinner | Diffusion sidecar state | TopBar.tsx:1347,1360-1375,1605 | B (sidecar/model-path jargon in user-facing labels) |
| Camo | Adjust prompt input + mic | placeholder "darker, more snow" | (VoiceInput mic) | img2img refine | TopBar.tsx:1702,1714 | — |
| Camo | Rewrite with Haiku toggle | "Rewrite with Haiku (better prompts, ~$0.0005/call)" | checkbox | LLM prompt-rewrite | TopBar.tsx:1722,1730 | B (exposes "Haiku" model + per-call $ cost) |
| Camo | Apply (adjust) | "Apply" | none | Apply adjustment | TopBar.tsx:1736 | — |
| Camo | Voice input mic | "Speak your adjustment"/"Stop recording" (title) | Mic / MicOff | Voice-to-text prompt | VoiceInput.tsx:18,144,148 | — |

### 2d. Parts panel (`PartsPanel`, TopBar.tsx:982)
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Parts | Explode all | "Explode all" | none | Explode mesh view | TopBar.tsx:988 | — |
| Parts | Reset | "Reset" | none | Clear part selection | TopBar.tsx:1003 | — |
| Parts | Part list buttons | humanized mesh name (title=raw `tiger_body_lod0`) | none | Isolate a mesh part | TopBar.tsx:1014,1020,1028 | B (raw `_lod0` mesh IDs in tooltip) |

### 2e. Scene panel (`ScenePanelBody`, TopBar.tsx:1774)
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Scene | Season toggle | "☀ Summer / ❄ Winter" | emoji glyphs | Switch season | TopBar.tsx:1765,1782 | C (duplicates bottom `SeasonToggle`) |
| Scene | Crew toggle | "Hide / Show" | none | Show T-pose crew soldier | TopBar.tsx:1769,1792 | B ("T-pose — animation decoding TBD") |

### 2f. Reference panel (`ReferencePanel`, TopBar.tsx:958)
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Reference | (placeholder only) | "Coming soon…" | none | Not implemented | TopBar.tsx:958,963 | — (dead panel — no controls) |

## AREA 3 — Skin editor: bottom-center toolbar + right rail (Editor.tsx)

| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Bottom | Back to full view | "← Back to full view" (title "…(Esc)") | ← glyph | Exit isolated-part view | Editor.tsx:2193,2205 | — |
| Bottom | Template/Decal pills | "Template" / "Decal pack" | ChevronUp/Package/Sticker | Quick-pick template & decal pack | TemplateDecalPills.tsx:18,646,653,719 | — |
| Bottom | Season toggle | "Summer"/"Winter" | Sun / Snowflake | Switch season | SeasonToggle.tsx:13,36,43,66 | C (duplicates Scene-panel season toggle) |
| Bottom | Edit Texture | "Edit vehicle texture"/"Exit texture-edit mode" (aria) | Brush | Open full-screen texture editor | EditTextureButton.tsx:30,43,47 | — |
| Bottom | Vehicle menu pills | vehicle displayName (title/aria) | vehicle icon img | Select vehicle | VehicleMenu.tsx:169,195; also "Covered by faction-default livery" badge:183,224 | — |
| Right rail | Scene preset column | "{preset} — {description}" (title) | Globe / Grid3x3 / Lightbulb | Pick environment preset | ScenePanel.tsx:15,45,50 | D? (Grid3x3 for a scene preset reads as "grid/snap", not "environment") |

## AREA 4 — Skin editor: 3D Viewport (`Viewport.tsx`, 5,359 lines)

| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Viewport | Canvas (orbit/zoom) | none | none | Mouse-drag rotate / scroll zoom (no on-screen controls) | Viewport.tsx:5323 | — (no discoverable camera UI; drag-only) |
| Viewport | Reconnect (error state) | "Reconnect / pick install folder" | none | Recover from load error | Viewport.tsx:5339 | — |

## AREA 5 — Faceplate editor (`FaceplateEditor.tsx`, 5,542 lines) — **very dense; ~30 icon imports**

### 5a. Bottom tool pill (labelled — good)
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Tools | Select | "Select" | MousePointer2 | Selection tool | FaceplateEditor.tsx:1257 | — |
| Tools | Text | "Text" | Type | Place text | FaceplateEditor.tsx:1258 | — |
| Tools | Shapes | "Shapes" | Shapes | Draw shapes | FaceplateEditor.tsx:1259 | — |
| Tools | Draw | "Draw" | Pencil | Freehand brush | FaceplateEditor.tsx:1260 | — |
| Tools | Eraser | "Eraser" | Eraser | Erase | FaceplateEditor.tsx:1261 | — |
| Tools | Mask | "Mask" | Layers | Paint layer mask | FaceplateEditor.tsx:1262 | D (Layers icon for a MASK tool — mismatched; Layers reads as "layers panel") + B ("mask" concept) |
| Tools | Grid snap (extra) | "Snap" | Grid | Toggle grid snap | FaceplateEditor.tsx:3651 | — |

### 5b. Top-right / floating icon buttons
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Toolbar | Adjust image panel | "Adjust image filters & blend"/"Hide Adjust panel" (title) | Sliders | Toggle image-adjust panel | FaceplateEditor.tsx:3613,3616,3636 | — |
| Toolbar | Insignia library | "Insignia library" (title/aria) | Library | Open insignia picker modal | FaceplateEditor.tsx:4262,4267 | — |
| Toolbar | Keyboard shortcuts | "Keyboard shortcuts (F1)" (title/aria) | HelpCircle | Open shortcuts overlay | FaceplateEditor.tsx:3663,3693 | — |
| Toolbar | Home | none visible | (EditorHomeButton) | Back to StartScreen | FaceplateEditor.tsx:2800 | A (icon-only, verify EditorHomeButton has aria) |
| Toolbar | Title pill / Export+Publish | pack name (opens popover w/ InGameTextButton + PublishSection) | state icon | Rename + build/export/publish | FaceplateEditor.tsx:2807; InGameTextButton.tsx | — |

### 5c. Text tool options peel (ToolOptionsPeel) — **icon-heavy row**
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Text opts | Font family | "Font family" (title/aria) | none (select) | Choose font | FaceplateEditor.tsx:4004 | — |
| Text opts | Font size | "Font size" (title) | none | Text size | FaceplateEditor.tsx:4032 | — |
| Text opts | Font weight | "Font weight" (title/aria) | none | Weight select | FaceplateEditor.tsx:4053 | — |
| Text opts | Bold | "Bold (toggle)" (title) | Bold | Toggle bold | FaceplateEditor.tsx:4093 | — |
| Text opts | Italic | "Italic" (title) | Italic | Toggle italic | FaceplateEditor.tsx:4108 | — |
| Text opts | Letter spacing | "Letter spacing" (title) | (CaseSensitive?) | Tracking | FaceplateEditor.tsx:4126 | — |
| Text opts | Line height | "Line height" (title) | (CornerDownLeft) | Leading | FaceplateEditor.tsx:4142 | — |
| Text opts | Align | "Align {align}" (title) | AlignCenter/AlignStartVertical/AlignEndVertical | Text align | FaceplateEditor.tsx:4158 | — |
| Text opts | Text colour | "Text colour" (title) | none (swatch) | Font colour | FaceplateEditor.tsx:4179 | — |
| Text opts | Opacity | "Opacity" (title) | none | Layer opacity | FaceplateEditor.tsx:4185 | — |
| Text opts | Blend mode | "Blend mode" (label) | none | Layer blend | FaceplateEditor.tsx:4198 | B (Photoshop blend-mode jargon for casual users) |

### 5d. Shapes tool options peel
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Shape opts | Shape kind | kind name (title/aria, e.g. "Rectangle") | Circle/Slash/Star/Shapes | Choose shape | FaceplateEditor.tsx:4253 | — |
| Shape opts | Insignia library | "Insignia library" (title/aria) | Library | Insert insignia shape | FaceplateEditor.tsx:4263 | C (duplicate of 5b insignia button) |
| Shape opts | Fill colour | "Fill colour" (title) | none | Shape fill | FaceplateEditor.tsx:4278 | — |
| Shape opts | Width / Height / Radius | "Width"/"Height"/"Radius" (title) | none | Shape dims | FaceplateEditor.tsx:4292,4304,4328 | — |
| Shape opts | Opacity / Blend | "Opacity" / "Blend mode" | none | Appearance | FaceplateEditor.tsx:4344,4357 | B (blend mode) |

### 5e. Draw/Brush tool options peel
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Brush opts | Brush size | "Brush size" (title) | none | Stroke width | FaceplateEditor.tsx:4370 | — |
| Brush opts | Brush colour | "Brush colour" (title) | none | Stroke colour | FaceplateEditor.tsx:4384 | — |
| Brush opts | Brush opacity | "Brush opacity" (title) | none | Stroke alpha | FaceplateEditor.tsx:4390 | — |
| Brush opts | Hardness | "Hardness" (title) | none | Edge softness | FaceplateEditor.tsx:4407 | — |
| Brush opts | Eyedropper | "Eyedropper — click canvas…" (title/aria) | Pipette | Sample colour | FaceplateEditor.tsx:4418,4420 | — |
| Brush opts | Erase toggle | "Erase mode ON…"/"Switch to erase mode" (title) | Eraser | Toggle erase | FaceplateEditor.tsx:4432 | C (redundant with dedicated Eraser tool at 1261) |
| Grid | Grid step cycle | "Grid step: {step}px"/"Grid step {step}px" | Grid | Cycle snap grid size | FaceplateEditor.tsx:3970 | — |

## AREA 6 — Decal-pack editor (`DecalPackEditor.tsx`, 3,733 lines) — **near-duplicate of Faceplate**

### 6a. Bottom tool pill
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Tools | Select | "Select" | MousePointer2 | Selection | DecalPackEditor.tsx:1436 | — |
| Tools | Images | "Images" | ImageIcon | Image drawer | DecalPackEditor.tsx:1437 | — |
| Tools | Transform | "Transform" | Sliders | Transform tool | DecalPackEditor.tsx:1438 | D (Sliders icon usually = adjustments, not transform) |
| Tools | Tint | "Tint" | Droplet | Colour tint | DecalPackEditor.tsx:1439 | — |
| Tools | Draw | "Draw" | Pencil | Freehand | DecalPackEditor.tsx:1440 | — |
| Tools | Snap (extra) | "Snap" | Grid | Grid snap toggle | DecalPackEditor.tsx:2641 | — |

### 6b. Top toolbar (undo/redo/zoom/insignia) — icon-only, but tooltipped
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Toolbar | Undo | "Undo (Ctrl+Z)" (title/aria) | RotateCcw | Undo | DecalPackEditor.tsx:2106 | C (skin editor removed its UndoRedoBar; inconsistent across editors) |
| Toolbar | Redo | "Redo (Ctrl+Shift+Z)" (title/aria) | RotateCw | Redo | DecalPackEditor.tsx:2136 | — |
| Toolbar | Fit zoom | "Fit to window (Ctrl+0)" (title/aria) | Maximize2 | Fit canvas | DecalPackEditor.tsx:2693 | — |
| Toolbar | 100% zoom | "Actual size (100%) (Ctrl+1)" (title/aria) | (Crosshair/1:1) | Reset zoom | DecalPackEditor.tsx:2725 | — |
| Toolbar | Insignia library | (opens "Insignia Library" modal) | Library | Insert insignia | DecalPackEditor.tsx:52,2754 | C (same insignia modal as Faceplate — 3rd copy) |

### 6c. Selected-decal action strip (icon-only, all tooltipped — dense ~14 buttons)
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Decal ops | Scale | "Scale" (title) | none/slider | Scale decal | DecalPackEditor.tsx:3162 | E (14-button strip) |
| Decal ops | Rotation | "Rotation" (title) | none | Rotate | DecalPackEditor.tsx:3173 | E |
| Decal ops | Opacity | "Opacity" (title) | none | Alpha | DecalPackEditor.tsx:3184 | E |
| Decal ops | Flip H | "Flip horizontally" (title/aria) | FlipHorizontal2 | Mirror | DecalPackEditor.tsx:3194 | E |
| Decal ops | Flip V | "Flip vertically" (title/aria) | FlipVertical2 | Mirror | DecalPackEditor.tsx:3203 | E |
| Decal ops | Move earlier | "Move earlier in stack" (title/aria) | (ChevronUp) | Z-order up | DecalPackEditor.tsx:3212 | E |
| Decal ops | Move later | "Move later in stack" (title/aria) | (ChevronDown) | Z-order down | DecalPackEditor.tsx:3220 | E |
| Decal ops | Duplicate | "Duplicate decal" (title/aria) | Copy | Duplicate | DecalPackEditor.tsx:3228 | E |
| Decal ops | Rotate 90° CW | "Rotate 90° clockwise" (title/aria) | RotateCw | Rotate | DecalPackEditor.tsx:3237 | E; C (overlaps Rotation slider) |
| Decal ops | Rotate 90° CCW | "Rotate 90° counter-clockwise" (title/aria) | RotateCcw | Rotate | DecalPackEditor.tsx:3250 | E; C |
| Decal ops | Centre + clear rot | "Centre and clear rotation" (title/aria) | Crosshair | Recenter | DecalPackEditor.tsx:3263 | E |
| Decal ops | Align L/C/R | "Align left/centre/right" (title/aria) | AlignStartVertical/AlignCenter/AlignEndVertical | Align X | DecalPackEditor.tsx:3290,3303,3311 | E |
| Decal ops | Align T/C/B | "Align top/centre/bottom" (title/aria) | AlignStartHorizontal/AlignCenterVertical/AlignEndHorizontal | Align Y | DecalPackEditor.tsx:3325,3338,3346 | E |
| Decal ops | Brightness/Blend | "Brightness"/"Blend" | Contrast/Sun/Droplet/Palette | Adjustments | DecalPackEditor.tsx:3414,3418 | B (blend) |
| Decal ops | Snap-to-grid toggle | "Snap to grid ON/OFF" (title) | Grid | Toggle snap | DecalPackEditor.tsx:3011 | C (duplicate of Snap in tool pill 2641) |
| Decal ops | Nudge | "Nudge" | none | Arrow-key nudge label | DecalPackEditor.tsx:2983 | — |
| Images | Add image as decal | "Add \"{name}\" as a new decal" (title/aria) | none (thumb) | Insert image | DecalPackEditor.tsx:3118 | — |

### 6d. Faction override row (Decal-pack)
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Faction | Copy to override | "Copy shared layers into this faction's override…" (title) | none | Fork faction override | DecalPackEditor.tsx:2322 | B ("shared layers / override" concept) |
| Faction | Return to shared | "Return to editing shared layers" (title) | none | Exit override | DecalPackEditor.tsx:2339 | B |

## AREA 7 — Shared editor primitives (`editor-primitives/`, `editor-shared/`)

| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Layers | Layer visibility | "Hide/Show layer" (title/aria) | Eye / EyeOff | Toggle visibility | LayersPanel.tsx:520,530 | — |
| Layers | Lock indicator | (title) | Lock / LockOpen | Locked state | LayersPanel.tsx:536,558,560 | — |
| Layers | Drag handle | none | GripVertical | Reorder layer | LayersPanel.tsx (import:26) | A (drag handle icon has no title/aria — verify) |
| Layers | Rename | "{label} — double-click to rename" (title) | none | Rename layer | LayersPanel.tsx:501 | — |
| Layers | Opacity | "Opacity" (title/aria) | none | Layer opacity | LayersPanel.tsx:586,611 | — |
| Layers | Blend mode | "Blend mode" (aria) | none | Layer blend | LayersPanel.tsx:637 | B (blend jargon) |
| Props | Appearance/opacity | "Layer opacity" (aria) | none | Opacity | PropertiesPanel.tsx:298,320 | — |
| Props | Blend mode | "Blend mode" (label) | none | Blend | PropertiesPanel.tsx:350 | B |
| Props | Shadow colour/opacity/X/Y/blur | "Shadow …" (title) | none | Drop-shadow controls | PropertiesPanel.tsx:409-462 | E (5+ shadow fields) |
| Props | Flip H/V | "Flip horizontally/vertically" (title/aria) | none | Mirror | PropertiesPanel.tsx:621,635 | — |
| Props | Font family | "Font family" (aria) | none | Font | PropertiesPanel.tsx:659 | — |
| Transform | Move earlier/later | "Move earlier/later in stack" (title/aria) | ChevronUp/ChevronDown | Z-order | TransformPanel.tsx:19,125,136 | — |
| Transform | Centre+clear rot | "Centre and clear rotation" (title) | none | Recenter | TransformPanel.tsx:162 | — |
| Transform | Flip H/V | (FlipHorizontal/FlipVertical icons) | FlipHorizontal/FlipVertical | Mirror | TransformPanel.tsx:19 | — |
| Adjust | 9 sliders | Brightness/Contrast/Saturation/Hue/Blur/Sepia/Grayscale/Invert/Noise | none | Image filters | AdjustmentPanel.tsx:69-149 | E (9 sliders in one panel) |
| Curves | Tone Curves modal + presets | "Tone Curves" / "Apply {preset} preset" (aria) | none | Curve editor | CurvesEditor.tsx:367,403,454 | B ("Tone Curves" — advanced) |
| Gradient | Angle / stops / remove | "Angle"/"Stop {n} colour/position"/"Remove stop {n}" (title/aria) | none | Gradient fill | GradientFillEditor.tsx:194,225,229,239 | — |
| Slider popover | Generic slider | "{title}" (title/aria) | none | Popover slider | SliderPopover.tsx:123,149 | — |
| IconButton | Generic icon btn | title=aria=title prop | (varies) | Reusable icon button (always has title) | IconButton.tsx:76 | — |
| ToggleChip | Generic toggle | (ariaLabel) | (varies) | Reusable toggle | ToggleChip.tsx:48 | — |
| ToolOptionsPeel | Peel container | "{label} options"/"Tool options" (aria) | none | Tool-option drawer | ToolOptionsPeel.tsx:89 | — |

## AREA 8 — Atlas viewer subcomponents (`components/atlas/`, `AtlasViewPanel.tsx`)

| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Atlas | View-mode segmented | "{mode} — {description}" (title/aria) | LayoutTemplate / Grid3x3 / Eye | Switch atlas view mode | AtlasViewPanel.tsx:17,48,53 | — |
| Atlas | Prev/Next part | "Previous/Next part" (aria) | ChevronLeft / ChevronRight | Step mesh part | atlas/PartStepper.tsx:4,32,39 | — |
| Atlas | Prev/Next faction | "Previous/Next faction" (aria) | ChevronLeft / ChevronRight | Step faction | atlas/AtlasPreview3D.tsx:14,194,203 | — |
| Atlas | Shared-layers cell | "Shared layers — apply to all factions" (title) | none | Select shared | atlas/FactionRow.tsx:54 | B ("shared layers" concept) |
| Atlas | Faction override cell | "{faction} override" (title) | none | Select override | atlas/FactionRow.tsx:87; FactionPartMatrix.tsx:51 | B |

## AREA 9 — Start screen, faction/vehicle pickers, dialogs, overlays

| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Start | New Skin Pack | "New Skin Pack" (title) | Layers | Create skin pack | StartScreen.tsx:29,249 | — |
| Start | New Faceplate | "New Faceplate" (title) | Frame | Create faceplate | StartScreen.tsx:255 | — |
| Start | New Decal Pack | "New Decal Pack" (title) | Stamp | Create decal pack | StartScreen.tsx:261 | — |
| Start | Load Project | "Load Project" (title) | FolderOpen | Open file | StartScreen.tsx:267,298 | — |
| Faction | Faction picker tiles | title=FACTION_LABELS | faction img (alt="") | Choose faction | FactionPicker.tsx:15,124; alt empty:29 | A? (img alt="", relies on title only — verify screen-reader) |
| Faction | Prev/Next arrows | ArrowLeft/ArrowRight | ArrowLeft/ArrowRight | Cycle factions | FactionPicker.tsx:15 | A (arrows have no aria-label — verify) |
| Faction | Faction panel buttons | title=FACTION_LABELS | FACTION_ICONS + span label | Choose faction | FactionPanel.tsx:40,45,54,56 | — |
| Saved | Back to start | "Back to start" (aria) + "Back" | (arrow) | Return | SavedProjectsList.tsx:226,233 | — |
| Saved | Project rows | name + relTime | Layers/UserSquare/Sticker (section) | Open recent | SavedProjectsList.tsx:311,341,371 | — |
| Saved | Remove from Workshop | "Remove {name} from Workshop"/"Confirm…"/"Cancel…" (aria) | none | Workshop delete flow | SavedProjectsList.tsx:543,559,577 | — |
| Publish | Title / Description / Change note | "Title"/"Description"/"Change note (optional)" | none | Workshop metadata | PublishToWorkshopDialog.tsx:372,392,421 | — |
| Publish | Upload custom preview | "Upload a custom preview PNG image" (aria) | none | Preview image | PublishToWorkshopDialog.tsx:472,521 | — |
| Publish | Revert preview | "Revert to auto-generated preview" (aria) | none | Reset preview | PublishToWorkshopDialog.tsx:496 | — |
| Publish | Visibility | "Visibility" (label) | none | Public/friends/private | PublishSection.tsx:536 | — |
| Image lib | Drop/browse | "Drop image or click to browse" (aria) | none | Add image | ImageLibrary.tsx:78,98 | — |
| Image lib | Delete image | "Delete {name}" (title) | × glyph | Remove image | ImageLibrary.tsx:132 | — |
| Template | Template dropdown | "Choose template" (aria) | ChevronDown/Sparkles/FolderOpen/Cloud/Package | Pick template source | TemplatePicker.tsx:58,184,208 | — |
| Pack ID | Pack icon slot | "Click to replace · Right-click to clear"/"Click to upload icon" (title/aria) | none | Set pack icon | PackIdentityPopover.tsx:322,389 | — |
| Pack ID | Name/desc/author inputs | placeholders | none | Pack metadata | PackIdentityPopover.tsx:417,443,476 | — |
| New forms | Template / Name / Description / Author | "Template"/"{X} name"/"Description"/"Author" | ArrowRight (next) | Project creation forms | NewProjectForm/NewDecalPackForm/NewFaceplateForm .tsx:231-277 | — |
| Slot icon | Back | "Back" (aria) | ArrowLeft | Exit slot editor | SlotIconEditor.tsx:11,209 | — |
| Slot icon | Drop/pick icon | "Drop an image here or click…" (aria) | none | Set slot icon | SlotIconEditor.tsx:256,315 | — |
| Slot grid | Season icon cells | "Edit icon — {label}"/"Edit icon for {label}" (title/aria) | none | Open icon editor | SlotIconGrid.tsx:194,196 | — |
| Onboarding | Dismiss | "Dismiss onboarding" (aria) | none | Close overlay | OnboardingOverlay.tsx:96 | — |
| Shortcuts | Open/Close sheet | "Keyboard shortcuts"/"Close keyboard shortcuts" (aria) | none | Shortcut help | ShortcutHelpSheet.tsx:72,79 | — |
| In-game text | Edit in-game text | "Edit in-game text" (title) / kind-specific aria | Type | Edit in-game name/desc | InGameTextButton.tsx:59,147,150 | — |

## AREA 10 — Full-screen Vehicle Texture editor (`VehicleTextureEditor.tsx`)

| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Texture | Back to 3D view | "Back to 3D view" (title/aria) + "Back" | (arrow) | Exit editor | VehicleTextureEditor.tsx:454,466 | — |
| Texture | Undo | "Undo (Ctrl+Z)" (title/aria) | (Undo icon) | Undo stroke | VehicleTextureEditor.tsx:472 | — |
| Texture | Redo | "Redo (Ctrl+Shift+Z)" (title/aria) | (Redo icon) | Redo stroke | VehicleTextureEditor.tsx:485 | — |
| Texture | Fit to window | "Fit texture to window (Ctrl+0)" (title/aria) | (Maximize) | Fit zoom | VehicleTextureEditor.tsx:550 | — |
| Texture | 100% zoom | "100% zoom (Ctrl+1)" (title/aria) | none | Reset zoom | VehicleTextureEditor.tsx:562 | — |
| Texture | Download PNG | "Download {vehicle}.png — full 2048² composited texture" (title/aria) | (Download) | Export atlas PNG | VehicleTextureEditor.tsx:577 | B (raw "2048² composited texture" atlas jargon) |
| Texture | Keyboard shortcuts | "Keyboard shortcuts (F1 or ?)" (title/aria) | (Help) | Shortcut help | VehicleTextureEditor.tsx:589 | — |
| Texture | Brush controls | (BrushPanel: size/softness/opacity/colour/eraser/symmetry) | Eraser/FlipHorizontal2 | Paint settings | BrushPanel.tsx:2,43,56,83,110-182 | — |

### BrushPanel controls (used by texture editor)
| Area | Control | Label | Icon | Purpose | file:line | FLAG |
|---|---|---|---|---|---|---|
| Brush | Eraser toggle | "Switch to paint/eraser mode" (title), "Toggle eraser mode" (aria) | Eraser | Paint/erase | BrushPanel.tsx:56,63,64 | — |
| Brush | Symmetry toggle | "Toggle symmetric brush" (aria) | FlipHorizontal2 | Mirror strokes | BrushPanel.tsx:83,95 | — |
| Brush | Size / Softness / Opacity | "Size"/"Softness"/"Opacity" | none | Brush params | BrushPanel.tsx:110,120,130 | — |
| Brush | Colour swatches | "Set brush colour to {c}" (aria), "Brush colour" (aria) | none | Pick colour | BrushPanel.tsx:147,165 | — |

---

## Cross-cutting observations for the UX audit

1. **Blend mode / opacity / mask / override / atlas / UV / LoRA / img2img / sidecar** vocabulary is
   surfaced directly to end-users across the Camo panel, both 2D editors, and the atlas viewer.
   This is the single biggest "engine jargon exposed" cluster (many FLAG B rows).
2. **Three overlapping toolbars** (Skin texture editor, Faceplate, Decal-pack) with inconsistent
   affordances: Decal-pack has an on-canvas Undo/Redo bar, Faceplate removed its Undo/Redo buttons
   (keyboard only), Skin editor removed its `UndoRedoBar` entirely. Same actions, three different
   discoverability levels (FLAG C).
3. **The Insignia Library modal is opened from 3 different buttons** (Faceplate top-right, Faceplate
   shapes peel, Decal-pack toolbar) — one shared modal, three entry points (FLAG C).
4. **Season toggle appears twice** in the skin editor (Scene panel + bottom `SeasonToggle`) (FLAG C).
5. **Icon-function mismatches (FLAG D):** Mask tool uses the `Layers` icon (reads as "layers panel");
   Decal-pack "Transform" tool uses `Sliders` (reads as "adjustments"); ScenePanel environment preset
   uses `Grid3x3` (reads as "grid/snap").
6. **Overloaded panels (FLAG E):** Camo panel (~10 sections incl. AI stack), Decals panel (~6 sections),
   AdjustmentPanel (9 sliders), Decal-pack per-decal action strip (~14 icon buttons), PropertiesPanel
   shadow section (5+ fields).
7. **Icon-only, no-label, verify-tooltip (FLAG A):** `EditorHomeButton` (used by all 3 editors) and the
   `GripVertical` drag handle and `FactionPicker` arrows/tiles rely on icon-only presentation — need to
   confirm each has a `title`/`aria-label` (EditorHomeButton and FactionPicker arrows were not confirmed
   to carry one in this pass).
8. **Stale `TopBar.tsx` docstring** describes a Paint/Compose/Publish cluster nav that no longer exists;
   there is no visible in-panel control that switches `activePanel` — a real navigation gap to confirm.
