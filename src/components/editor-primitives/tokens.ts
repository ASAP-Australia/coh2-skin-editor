/**
 * tokens.ts — shared style atoms for the editor primitive library.
 *
 * The image-editor surfaces (FaceplateEditor, DecalPackEditor, BrushPanel,
 * future tool panels) all need to feel like a single, cohesive product. They
 * share:
 *
 *   • A dark glass language (rgb(15 17 22) base, blur 20–48px, saturate 150%+,
 *     0.5px hairline strokes at low alpha, inset top-edge highlight) — see
 *     index.css `@utility glass-1..4` for the canonical recipe.
 *
 *   • A blue "active / selected" accent (rgba(120,180,255,0.95)) used by
 *     CanvasHandles, layer-list active states, slider thumbs, drop-zone
 *     dashed outlines. This is INTENTIONALLY distinct from --color-accent
 *     (Brigade orange), which signals user-initiated state changes (brush
 *     ON, accept button, callout). Blue = "this is the thing you picked";
 *     orange = "we did the thing you asked".
 *
 *   • A unified typography ladder: 10/11/12/13px with tabular-nums for value
 *     readouts and uppercase + 1.5 letter-spacing for section headings.
 *
 * The constants below are the ONLY values primitives should pull from for
 * these surfaces — if you find yourself inlining rgba(247,247,250,…) or a
 * 0.5px border in a new editor primitive, promote it here first.
 *
 * Centralising into module-scoped constants (rather than CSS variables) is
 * deliberate: the inline-style style objects below are used both as React
 * `style` props (where CSS variables resolve fine) and as base styles spread
 * into other inline-style objects (e.g. `{...sidePanelButton, flex: 1}`).
 * Spreading CSS-variable strings is opaque to TS, but spreading typed
 * CSSProperties keeps autocompletion working everywhere a primitive is
 * extended.
 */

import type { CSSProperties } from 'react'

// ── Color atoms ────────────────────────────────────────────────────────────

/** Blue selection accent. Matches CanvasHandles' fill colour exactly so the
 *  active state in any layer-list row, slider thumb, modal CTA, etc. visually
 *  rhymes with the on-canvas selection outline. */
export const EDITOR_ACCENT = 'rgba(120,180,255,0.95)'

/** Soft fills derived from EDITOR_ACCENT — used for active-state backgrounds
 *  (10% alpha) and borders (30% alpha) in LayerRow / ToggleChip. */
export const EDITOR_ACCENT_FILL = 'rgba(120,180,255,0.10)'
export const EDITOR_ACCENT_BORDER = 'rgba(120,180,255,0.30)'

/** A slightly stronger fill for two-state buttons (Flip H / Flip V toggles). */
export const EDITOR_ACCENT_FILL_STRONG = 'rgba(120,180,255,0.18)'

/** Primary / secondary / tertiary text on glass surfaces. Aligns with the
 *  --color-text-1..3 OKLCH ladder in index.css but expressed as rgba so we
 *  can compose into other rgba values without `color-mix`. */
export const EDITOR_TEXT_1 = 'rgba(247,247,250,0.92)'
export const EDITOR_TEXT_2 = 'rgba(247,247,250,0.70)'
export const EDITOR_TEXT_3 = 'rgba(247,247,250,0.50)'
export const EDITOR_TEXT_4 = 'rgba(247,247,250,0.35)'

/** Hairline stroke — matches --color-stroke-1 in index.css. Only the
 *  faintest tier survived the redesign; the 0.10 and 0.18 alpha variants
 *  were inlined at their callsites (chip borders) so we don't carry the
 *  whole ladder as exported tokens. Re-add a tier here if a primitive
 *  ever needs to share the value across files. */
export const EDITOR_STROKE_1 = 'rgba(255,255,255,0.06)'

/* Glass-surface ladder (LOW = rgba(15,16,20,0.50), MID = rgba(15,16,20,0.85),
 * HI = rgba(15,17,22,0.75)) was retired with the GlassPanel/GlassTopbar
 * primitives in v1.0. Every remaining callsite that needs the HI tier
 * (WindowControls, EditorHomeButton, the PreviewChip wrapper inside
 * FaceplateInGamePreview / DecalPackInGamePreview) inlines the literal so
 * the recipe stays readable at the surface. If a future primitive needs
 * the shared ladder, restore the three `export const`s here. */

// ── Reusable inline-style atoms ────────────────────────────────────────────
//
// The v1.0 redesign retired the glass-surface helper objects
// (`glassMicroSurface`, `glassPanelSurface`, `glassTopbarSurface`) along with
// the primitives that consumed them (GlassPanel / GlassTopbar / GlassBackChip).
// The few remaining glass chips (WindowControls, EditorHomeButton, the
// PreviewChip wrapper inside the in-game previews) emit their surface inline
// so the recipe is readable at the callsite. If a fresh primitive ever needs
// the canonical recipe again, restore both the helper objects and the
// EDITOR_SURFACE_* fill tokens together — they were five lines each.

/** Topbar action button — Save / Undo / etc. */
export const topbarButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  color: EDITOR_TEXT_1,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
}

/** In-panel ghost button — Add / Reset / Duplicate / etc. The smaller form
 *  used inside left/right asides. */
export const panelButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 8px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  color: EDITOR_TEXT_1,
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
}

/** The larger form of in-panel button — used by FaceplateEditor for the
 *  "+ Add text" / "Reset adjustments" buttons. Same shape, more vertical
 *  padding so it visually anchors the empty-state. */
export const panelButtonLargeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: EDITOR_TEXT_1,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
}

/** Section heading — used inside left/right panels to delimit logical
 *  groups ("Tools", "Adjustments", "Decals", "Transform"). 10px uppercase
 *  with 1.5 letter-spacing is the iOS Control Center pattern. */
export const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  color: EDITOR_TEXT_3,
}
