/**
 * editor-primitives — shared UI library for the image-editor surfaces.
 *
 * Every primitive in this folder shares one design language:
 *
 *   • Dark glass surfaces (rgb(15 17 22) base + backdrop blur 20–48px +
 *     saturate 150–170% + 0.5px hairline stroke). The canonical recipe
 *     lives in `index.css` as the `glass-1..4` utilities; the inline
 *     `tokens.ts` atoms here are runtime mirrors callers can spread into
 *     React `style` props.
 *
 *   • Blue selection accent (`rgba(120,180,255,…)`) for "this is what you
 *     picked" states — slider thumbs, layer-row active fills, canvas
 *     handles, drop-zone outlines. Intentionally distinct from the brand
 *     orange `--color-accent`, which signals "this is an action you can
 *     take".
 *
 *   • 10/11/12/13px type ladder with tabular-nums for value readouts and
 *     uppercase + 1.5 letter-spacing for section headings.
 *
 * USING THE LIBRARY:
 *
 *   import {
 *     EditorHomeButton, BottomToolPill, ToolOptionsPeel,
 *     PanelHeading, PanelButton, IconButton, ToggleChip,
 *     SliderRow, LayerRow,
 *     GlassModal, GlassToast,
 *     AdjustmentPanel, TransformPanel,
 *   } from '@/components/editor-primitives'
 *
 * The primitives are intentionally NOT styled with Tailwind utilities —
 * they emit inline style objects so callers can extend them via the
 * `style` prop without paying for class-name resolution churn at runtime.
 * (The shadcn-derived `Button`, `Card`, `Input`, etc. in `src/components/ui`
 * remain the right choice for non-editor chrome.)
 *
 * NOTE: the v1.0 redesign retired the `GlassPanel`, `GlassTopbar`, and
 * `GlassBackChip` primitives — the editors no longer use a topbar / side-
 * panel layout. Their roles are now covered by `EditorHomeButton`,
 * `BottomToolPill`, and `ToolOptionsPeel`. `ColorSwatchPicker` was also
 * retired in favour of the native `<input type="color">` rendered inline
 * inside the Background tool peel.
 *
 * See `tokens.ts` for the rationale + the full atom inventory.
 */

export { default as CanvasPlaceholder } from './CanvasPlaceholder'
export { default as GlassModal } from './GlassModal'
export { default as GlassToast } from './GlassToast'
export { default as EditorHomeButton } from './EditorHomeButton'
export { default as ProjectMetaPanel } from './ProjectMetaPanel'
// LobbyPreviewPanel removed in v1.0 — the in-editor player-card mock did
// not accurately represent the actual CoH2 customisation screen layout.
export { default as BottomToolPill } from './BottomToolPill'
export type { ToolDef } from './BottomToolPill'
export { default as UndoRedoBar } from './UndoRedoBar'
export { default as ToolOptionsPeel } from './ToolOptionsPeel'

export { default as PanelHeading } from './PanelHeading'
export { default as PanelButton } from './PanelButton'
export { default as IconButton } from './IconButton'
export { default as ToggleChip } from './ToggleChip'
export { default as SliderRow } from './SliderRow'
export { default as SliderPopover } from './SliderPopover'

export { default as LayerRow } from './LayerRow'

export { default as AdjustmentPanel } from './AdjustmentPanel'
export { default as TransformPanel } from './TransformPanel'
export type { LayerTransform } from './TransformPanel'

export { default as EditorTitlePill } from './EditorTitlePill'
export type { EditorTitlePillProps } from './EditorTitlePill'

export { default as BlendModeSelect } from './BlendModeSelect'
export type { BlendModeSelectProps } from './BlendModeSelect'

export { default as GradientFillEditor } from './GradientFillEditor'
export type { GradientFillEditorProps } from './GradientFillEditor'

export { default as CurvesEditor } from './CurvesEditor'
export type { CurvesEditorProps } from './CurvesEditor'

// Tokens are re-exported for surfaces that need to extend primitives or
// build one-off micro-controls in the same visual language.
export {
  EDITOR_ACCENT,
  EDITOR_ACCENT_FILL,
  EDITOR_ACCENT_FILL_STRONG,
  EDITOR_ACCENT_BORDER,
  EDITOR_TEXT_1,
  EDITOR_TEXT_2,
  EDITOR_TEXT_3,
  EDITOR_TEXT_4,
  EDITOR_STROKE_1,
  topbarButtonStyle,
  panelButtonStyle,
  panelButtonLargeStyle,
  sectionHeadingStyle,
} from './tokens'
