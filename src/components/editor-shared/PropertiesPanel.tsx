/**
 * PropertiesPanel — persistent Photoshop-style properties panel docked to the
 * right side of the editor (faceplate, decal, texture).
 *
 * Generic core section (all editors):
 *   • Opacity slider
 *   • Blend mode dropdown
 *   • Shadow controls
 *   • `layerTypeControls` render prop — host injects type-specific sections
 *
 * When nothing is selected, shows a clean empty-state.
 *
 * All mutations go through the shared `mutate` callback → history engine
 * (editor-history.ts). No per-pointer-move flooding.
 *
 * Faceplate-specific sections (Transform, Text, Shape, Image adjust, Align,
 * Document background) are rendered via `layerTypeControls` by
 * FaceplateEditor.  DecalPackEditor injects its own controls (flip, tint,
 * brightness/contrast/saturation) the same way.
 */

import React, { type CSSProperties } from 'react'
import {
  AlignCenter,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Bold,
  CaseSensitive,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  MoveHorizontal,
  MoveVertical,
  Palette,
  Slash,
  Sliders,
  Sun,
} from 'lucide-react'
import {
  type BlendMode,
  type FaceplateLayer,
  type ImageLayer,
  type TextLayer,
  type ShapeLayer,
  type GradientFill,
  type LayerShadow,
  type Coh2FaceplateProject,
  LAYER_SHADOW_DEFAULTS,
} from '@/lib/faceplate-project'
import type { GenericLayerProject, BaseLayer } from '@/lib/layer-compositor/layer-model'
import {
  EDITOR_ACCENT,
  EDITOR_TEXT_2,
  EDITOR_TEXT_3,
  EDITOR_TEXT_4,
} from '@/components/editor-primitives/tokens'
import BlendModeSelect from '@/components/editor-primitives/BlendModeSelect'
import HexColorInput from '@/components/editor-primitives/HexColorInput'
import SliderPopover from '@/components/editor-primitives/SliderPopover'
import GradientFillEditor from '@/components/editor-primitives/GradientFillEditor'
import AdjustmentPanel from '@/components/editor-primitives/AdjustmentPanel'
import TransformInputsRow from './TransformInputsRow'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PropertiesPanelProps<L extends BaseLayer = BaseLayer> {
  project: GenericLayerProject<L>
  selectedLayer: L | null
  /** All currently selected layer ids (for multi-select align). */
  multiSelectedIds?: Set<string>
  mutate: (
    fn: (p: GenericLayerProject<L>) => GenericLayerProject<L>,
    opts?: { undoable?: boolean },
  ) => void
  /** Canvas width in pixels — used for shape width slider max and align buttons. */
  canvasW?: number
  /** Canvas height in pixels — used for shape height slider max and align buttons. */
  canvasH?: number
  /** Whether the adjust-image expanded panel is open. Forwarded to layerTypeControls consumers. */
  adjustImageOpen?: boolean
  onToggleAdjustImage?: () => void
  /** Trigger the curves modal. Forwarded to layerTypeControls consumers. */
  onOpenCurves?: () => void
  /**
   * Host-supplied type-specific controls rendered below the generic section
   * (opacity, blend mode, shadow).  FaceplateEditor passes Transform / Text /
   * Shape / Image-adjust / Align / Document-BG here.  DecalPackEditor passes
   * flip, adjustments, tint, draw controls here.
   */
  layerTypeControls?: React.ReactNode
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapLayerGeneric<L extends BaseLayer>(
  p: GenericLayerProject<L>,
  id: string,
  fn: (l: L) => L,
): GenericLayerProject<L> {
  return { ...p, layers: p.layers.map(l => (l.id === id ? fn(l) : l)) }
}

// ── Inline styles ─────────────────────────────────────────────────────────────

const panelSurface: CSSProperties = {
  position: 'fixed',
  right: 12,
  // Float as a glass card: clear gap below title pill (~60px) and above bottom
  // tool pill (~100px) so there's visible breathing room all around the edges.
  top: 'calc(var(--app-top-inset, 0px) + 60px)',
  bottom: 100,
  zIndex: 38,
  display: 'flex',
  flexDirection: 'column',
  width: 228,
  // Match the glass-hud recipe exactly (same as BottomToolPill / AtlasViewPanel)
  // so all three floating surfaces read as one family.
  background: 'rgba(20,20,20,0.68)',
  backdropFilter: 'blur(36px) saturate(125%)',
  WebkitBackdropFilter: 'blur(36px) saturate(125%)',
  border: '0.5px solid rgba(255,255,255,0.10)',
  borderRadius: 16,
  boxShadow:
    '0 1px 1px rgba(0,0,0,0.30), 0 12px 30px rgba(0,0,0,0.46), inset 0 0.5px 0 rgba(255,255,255,0.10)',
  overflow: 'hidden',
}

// Collapsed surface: with no layer selected there is nothing to edit, so the
// panel shrinks to a slim content-sized pill anchored to the top rather than a
// near-full-height empty bordered box (VISION forbids "empty boxes"). Selecting
// a layer restores the full-height panel.
const panelSurfaceCollapsed: CSSProperties = {
  ...panelSurface,
  bottom: 'auto', // release full-height stretch → shrink to content
  height: 'auto',
}

const panelHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px 7px',
  borderBottom: '0.5px solid rgba(255,255,255,0.07)',
  flexShrink: 0,
}

const headingStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
  color: EDITOR_TEXT_3,
  margin: 0,
}

const scrollBody: CSSProperties = {
  overflowY: 'auto',
  flex: 1,
  padding: '10px 10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
}

export const sectionLabel: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: EDITOR_TEXT_4,
  marginBottom: 6,
}

export const divider: CSSProperties = {
  height: 0.5,
  background: 'rgba(255,255,255,0.07)',
  margin: '8px 0 6px',
}

export function iconBtnStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: 5,
    border: `1px solid ${active ? 'rgba(186,150,90,0.5)' : 'rgba(255,255,255,0.12)'}`,
    background: active ? 'rgba(186,150,90,0.15)' : 'rgba(255,255,255,0.04)',
    color: active ? EDITOR_ACCENT : EDITOR_TEXT_2,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  }
}

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}

/** Shared field style: consistent 26px height, dark glass inset */
export const fieldStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 26,
  background: 'rgba(255,255,255,0.05)',
  border: '0.5px solid rgba(255,255,255,0.12)',
  borderRadius: 5,
  color: EDITOR_TEXT_2,
  fontSize: 11,
  padding: '0 5px',
  outline: 'none',
  appearance: 'textfield',
  MozAppearance: 'textfield',
}


// ── Component ─────────────────────────────────────────────────────────────────

export default function PropertiesPanel<L extends BaseLayer = BaseLayer>({
  // project, multiSelectedIds, canvasW, canvasH are accepted but not consumed
  // directly — hosts pass them to their layerTypeControls instead.
  selectedLayer,
  mutate,
  layerTypeControls,
}: PropertiesPanelProps<L>) {
  const mutateLayer = (updater: (l: L) => L) => {
    if (!selectedLayer) return
    mutate(p => mapLayerGeneric(p, selectedLayer.id, updater))
  }

  // With no layer selected there is nothing to edit — collapse to a slim pill
  // instead of a full-height empty box. The empty-state hint stays in the DOM
  // (accessibility + tests) but reads as a compact one-liner under the heading.
  const collapsed = !selectedLayer

  return (
    <div
      data-testid="properties-panel"
      className={collapsed ? 'l01-ring l01-grain' : 'l01-ring l01-bloom l01-grain'}
      style={collapsed ? panelSurfaceCollapsed : panelSurface}
    >
      {/* ── Header ── */}
      <div style={collapsed ? { ...panelHeader, borderBottom: 'none' } : panelHeader}>
        <h3 style={headingStyle}>Properties</h3>
        {selectedLayer && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 500,
              color: EDITOR_TEXT_4,
              textTransform: 'capitalize',
            }}
          >
            {(selectedLayer as { kind?: string }).kind ?? 'layer'}
          </span>
        )}
      </div>

      {/* ── Body ── */}
      {collapsed ? (
        /* No layer selected — compact empty hint (kept in DOM for a11y + tests) */
        <p
          data-testid="properties-empty-state"
          style={{
            margin: 0,
            padding: '2px 12px 12px',
            fontSize: 10,
            lineHeight: 1.5,
            color: EDITOR_TEXT_4,
            textAlign: 'left',
          }}
        >
          Select a layer to edit its properties
        </p>
      ) : (
        <div className="custom-scrollbar" style={scrollBody}>
          <GenericLayerProperties
            layer={selectedLayer}
            mutateLayer={mutateLayer}
            layerTypeControls={layerTypeControls}
          />
        </div>
      )}
    </div>
  )
}

// ── Generic layer properties — opacity, blend, shadow, then host controls ─────

function GenericLayerProperties<L extends BaseLayer>({
  layer,
  mutateLayer,
  layerTypeControls,
}: {
  layer: L
  mutateLayer: (fn: (l: L) => L) => void
  layerTypeControls?: React.ReactNode
}) {
  const shadow = ((layer as { shadow?: LayerShadow }).shadow) ?? null

  return (
    <>
      {/* ── Appearance (Opacity + Blend Mode) — all layer types ── */}
      <section aria-label="Appearance">
        <p style={sectionLabel}>Appearance</p>
        {/* Opacity row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: EDITOR_TEXT_4,
              flexShrink: 0,
              width: 44,
            }}
          >
            Opacity
          </span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            aria-label="Layer opacity"
            data-testid="properties-opacity-input"
            value={Math.round((layer.opacity ?? 1) * 100)}
            onChange={ev => {
              const v = Math.max(0, Math.min(100, parseInt(ev.target.value) || 0)) / 100
              mutateLayer(l => ({ ...l, opacity: v }))
            }}
            style={{ ...fieldStyle, maxWidth: 52 }}
          />
          <span style={{ fontSize: 10, color: EDITOR_TEXT_4 }}>%</span>
        </div>

        {/* Blend mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: EDITOR_TEXT_4,
              flexShrink: 0,
              width: 44,
            }}
          >
            Blend
          </span>
          <BlendModeSelect
            value={(layer as { blendMode?: BlendMode }).blendMode}
            onChange={next => mutateLayer(l => ({ ...l, blendMode: next }))}
            label="Blend mode"
            style={{ flex: 1, minWidth: 0 }}
          />
        </div>
      </section>

      {/* ── Shadow (drop-shadow) ── */}
      <ShadowSection
        shadow={shadow}
        onUpdateShadow={newShadow => mutateLayer(l => ({ ...l, shadow: newShadow } as L))}
      />

      {/* ── Host-supplied type-specific controls ── */}
      {layerTypeControls}
    </>
  )
}

// ── Shadow section ─────────────────────────────────────────────────────────────

function ShadowSection({
  shadow: shadowProp,
  onUpdateShadow,
}: {
  shadow: LayerShadow | null
  /** Called with the new (or undefined for identity) shadow value. */
  onUpdateShadow: (shadow: LayerShadow | undefined) => void
}) {
  const shadow = shadowProp ?? LAYER_SHADOW_DEFAULTS

  const hexFromRgba = (rgba: string): string => {
    const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!m) return '#000000'
    const r = parseInt(m[1]).toString(16).padStart(2, '0')
    const g = parseInt(m[2]).toString(16).padStart(2, '0')
    const b = parseInt(m[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  const alphaFromRgba = (rgba: string): number => {
    const m = rgba.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)/)
    return m ? parseFloat(m[1]) : 0.5
  }
  const buildRgba = (hex: string, alpha: number): string => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }

  const hexColor = hexFromRgba(shadow.color)
  const shadowAlpha = alphaFromRgba(shadow.color)

  const updateShadow = (patch: Partial<LayerShadow>) => {
    const merged = { ...shadow, ...patch }
    const isIdentity = merged.offsetX === 0 && merged.offsetY === 0 && merged.blur === 0
    onUpdateShadow(isIdentity ? undefined : merged)
  }

  return (
    <section aria-label="Shadow" data-testid="shadow-section">
      <div style={divider} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <Sun size={12} color={EDITOR_TEXT_4} />
        <p style={{ ...sectionLabel, margin: 0 }}>Shadow</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Colour + Opacity row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <HexColorInput
            value={hexColor}
            onChange={hex => updateShadow({ color: buildRgba(hex, shadowAlpha) })}
            title="Shadow colour"
            size={22}
          />
          <SliderPopover
            icon={<CaseSensitive size={13} />}
            title="Shadow opacity"
            min={0}
            max={1}
            step={0.05}
            value={shadowAlpha}
            identity={0.5}
            format={v => `${Math.round(v * 100)}%`}
            onChange={v => updateShadow({ color: buildRgba(hexColor, v) })}
          />
        </div>
        {/* Offset + Blur row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SliderPopover
            icon={<MoveHorizontal size={13} />}
            title="Shadow offset X"
            min={-50}
            max={50}
            step={1}
            value={shadow.offsetX}
            identity={0}
            format={v => `${v}px`}
            onChange={v => updateShadow({ offsetX: v })}
          />
          <SliderPopover
            icon={<MoveVertical size={13} />}
            title="Shadow offset Y"
            min={-50}
            max={50}
            step={1}
            value={shadow.offsetY}
            identity={0}
            format={v => `${v}px`}
            onChange={v => updateShadow({ offsetY: v })}
          />
          <SliderPopover
            icon={<Slash size={13} />}
            title="Shadow blur"
            min={0}
            max={50}
            step={1}
            value={shadow.blur}
            identity={0}
            format={v => `${v}px`}
            onChange={v => updateShadow({ blur: v })}
          />
        </div>
      </div>
    </section>
  )
}

// ── FaceplatePropertiesExtension ──────────────────────────────────────────────
//
// Faceplate-specific layer properties: Transform, Text, Shape, Image adjust,
// Align, Document Background.  Rendered via the `layerTypeControls` prop of
// PropertiesPanel by FaceplateEditor.
//
// All types are scoped to faceplate — they do NOT pollute the generic panel.

function mapFaceplateLayer(
  p: Coh2FaceplateProject,
  id: string,
  fn: (l: FaceplateLayer) => FaceplateLayer,
): Coh2FaceplateProject {
  return { ...p, layers: p.layers.map(l => (l.id === id ? fn(l) : l)) }
}

export interface FaceplatePropertiesExtensionProps {
  project: Coh2FaceplateProject
  selectedLayer: FaceplateLayer
  multiSelectedIds: Set<string>
  mutate: (
    fn: (p: Coh2FaceplateProject) => Coh2FaceplateProject,
    opts?: { undoable?: boolean },
  ) => void
  canvasW?: number
  canvasH?: number
  adjustImageOpen: boolean
  onToggleAdjustImage: () => void
  onOpenCurves: () => void
}

export function FaceplatePropertiesExtension({
  project,
  selectedLayer: layer,
  multiSelectedIds,
  mutate,
  canvasW,
  canvasH,
  adjustImageOpen,
  onToggleAdjustImage,
  onOpenCurves,
}: FaceplatePropertiesExtensionProps) {
  const mutateLayer = (updater: (l: FaceplateLayer) => FaceplateLayer) => {
    mutate(p => mapFaceplateLayer(p, layer.id, updater))
  }

  const isPaint = layer.kind === 'paint'
  const isGroup = layer.kind === 'group'
  const posLayer =
    !isPaint && !isGroup
      ? (layer as ImageLayer | TextLayer | ShapeLayer)
      : null

  // Compute natural dimensions for W/H display
  let naturalW = 1
  let naturalH = 1
  let displayW = 0
  let displayH = 0
  if (posLayer) {
    if (posLayer.kind === 'image') {
      const img = project.images[posLayer.imageId]
      naturalW = img?.width ?? 1
      naturalH = img?.height ?? 1
    } else if (posLayer.kind === 'shape') {
      naturalW = posLayer.width
      naturalH = posLayer.height
    } else {
      naturalW = 100
      naturalH = posLayer.fontSize
    }
    displayW = naturalW * posLayer.scale
    displayH =
      posLayer.kind === 'image'
        ? naturalH * ((posLayer as ImageLayer).scaleY ?? posLayer.scale)
        : naturalH * posLayer.scale
  }

  const imgLayer = layer.kind === 'image' ? (layer as ImageLayer) : null
  const textLayer = layer.kind === 'text' ? (layer as TextLayer) : null
  const shapeLayer = layer.kind === 'shape' ? (layer as ShapeLayer) : null

  const fonts = [
    'Inter, system-ui, sans-serif',
    'Arial, Helvetica, sans-serif',
    '"Times New Roman", Georgia, serif',
    'Georgia, serif',
    '"Courier New", monospace',
    'monospace',
  ]

  return (
    <>
      {/* ── Transform ── */}
      {posLayer && (
        <section aria-label="Transform">
          <div style={divider} />
          <p style={sectionLabel}>Transform</p>
          <TransformInputsRow
            x={posLayer.x}
            y={posLayer.y}
            w={displayW}
            h={displayH}
            angle={posLayer.rotation}
            onChangeX={v => mutateLayer(l => ({ ...l, x: v }))}
            onChangeY={v => mutateLayer(l => ({ ...l, y: v }))}
            onChangeW={v => {
              const nat =
                posLayer.kind === 'image'
                  ? (project.images[(posLayer as ImageLayer).imageId]?.width ?? 1)
                  : posLayer.kind === 'shape'
                    ? (posLayer as ShapeLayer).width
                    : 100
              const newScale = Math.max(0.01, v / nat)
              mutateLayer(l => ({ ...l, scale: newScale }))
            }}
            onChangeH={v => {
              if (posLayer.kind === 'image') {
                const nat = project.images[(posLayer as ImageLayer).imageId]?.height ?? 1
                const newScaleY = Math.max(0.01, v / nat)
                mutateLayer(l =>
                  l.kind === 'image' ? ({ ...l, scaleY: newScaleY } as ImageLayer) : l,
                )
              } else if (posLayer.kind === 'shape') {
                const nat = (posLayer as ShapeLayer).height
                const newScale = Math.max(0.01, v / nat)
                mutateLayer(l => ({ ...l, scale: newScale }))
              } else {
                const newScale = Math.max(0.01, v / (posLayer as TextLayer).fontSize)
                mutateLayer(l => ({ ...l, scale: newScale }))
              }
            }}
            onChangeAngle={v => mutateLayer(l => ({ ...l, rotation: v }))}
            layout="grid"
          />
        </section>
      )}

      {/* ── Flip H/V — image layers only ── */}
      {imgLayer && !isGroup && (
        <section aria-label="Flip">
          <div style={divider} />
          <div style={{ ...rowStyle, marginTop: 2 }}>
            <button
              type="button"
              title="Flip horizontally"
              aria-label="Flip horizontally"
              aria-pressed={!!imgLayer.flipH}
              onClick={() =>
                mutateLayer(l =>
                  l.kind === 'image' ? { ...l, flipH: !(l as ImageLayer).flipH } : l,
                )
              }
              style={iconBtnStyle(!!imgLayer.flipH)}
            >
              <FlipHorizontal2 size={12} />
            </button>
            <button
              type="button"
              title="Flip vertically"
              aria-label="Flip vertically"
              aria-pressed={!!imgLayer.flipV}
              onClick={() =>
                mutateLayer(l =>
                  l.kind === 'image' ? { ...l, flipV: !(l as ImageLayer).flipV } : l,
                )
              }
              style={iconBtnStyle(!!imgLayer.flipV)}
            >
              <FlipVertical2 size={12} />
            </button>
          </div>
        </section>
      )}

      {/* ── Text options ── */}
      {textLayer && (
        <section aria-label="Text">
          <div style={divider} />
          <p style={sectionLabel}>Text</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <select
              value={textLayer.fontFamily}
              aria-label="Font family"
              onChange={e =>
                mutateLayer(l =>
                  l.kind === 'text' ? ({ ...l, fontFamily: e.target.value } as TextLayer) : l,
                )
              }
              style={{
                width: '100%',
                height: 26,
                background: 'rgba(255,255,255,0.05)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                borderRadius: 5,
                color: EDITOR_TEXT_2,
                fontSize: 11,
                padding: '0 6px',
                cursor: 'pointer',
              }}
            >
              {fonts.map(f => (
                <option key={f} value={f} style={{ background: '#1a1c22' }}>
                  {f.split(',')[0].replace(/"/g, '')}
                </option>
              ))}
            </select>

            <div style={rowStyle}>
              <SliderPopover
                icon={<CaseSensitive size={13} />}
                title="Font size"
                min={8}
                max={200}
                step={1}
                value={Math.round(textLayer.fontSize)}
                format={v => `${v}px`}
                onChange={v =>
                  mutateLayer(l =>
                    l.kind === 'text'
                      ? ({ ...l, fontSize: Math.max(8, Math.min(200, v)) } as TextLayer)
                      : l,
                  )
                }
              />
              <select
                value={textLayer.fontWeight}
                aria-label="Font weight"
                onChange={e => {
                  const next = Number(e.target.value)
                  mutateLayer(l =>
                    l.kind === 'text' ? ({ ...l, fontWeight: next } as TextLayer) : l,
                  )
                }}
                style={{
                  height: 26,
                  background: 'rgba(255,255,255,0.05)',
                  border: '0.5px solid rgba(255,255,255,0.12)',
                  borderRadius: 5,
                  color: EDITOR_TEXT_2,
                  fontSize: 11,
                  padding: '0 4px',
                  cursor: 'pointer',
                }}
              >
                {(
                  [
                    [300, 'Light'],
                    [400, 'Regular'],
                    [500, 'Medium'],
                    [600, 'Semibold'],
                    [700, 'Bold'],
                    [800, 'Extrabold'],
                    [900, 'Black'],
                  ] as const
                ).map(([w, lbl]) => (
                  <option key={w} value={w} style={{ background: '#1a1c22' }}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            <div style={rowStyle}>
              <button
                style={iconBtnStyle(textLayer.fontWeight >= 700)}
                title="Bold"
                aria-pressed={textLayer.fontWeight >= 700}
                onClick={() =>
                  mutateLayer(l =>
                    l.kind === 'text'
                      ? ({
                          ...l,
                          fontWeight: (l as TextLayer).fontWeight >= 700 ? 400 : 700,
                        } as TextLayer)
                      : l,
                  )
                }
              >
                <Bold size={12} />
              </button>
              <button
                style={iconBtnStyle(textLayer.fontStyle === 'italic')}
                title="Italic"
                aria-pressed={textLayer.fontStyle === 'italic'}
                onClick={() =>
                  mutateLayer(l =>
                    l.kind === 'text'
                      ? ({
                          ...l,
                          fontStyle:
                            (l as TextLayer).fontStyle === 'italic' ? 'normal' : 'italic',
                        } as TextLayer)
                      : l,
                  )
                }
              >
                <Italic size={12} />
              </button>
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  style={iconBtnStyle(textLayer.align === align)}
                  title={`Align ${align}`}
                  aria-pressed={textLayer.align === align}
                  onClick={() =>
                    mutateLayer(l =>
                      l.kind === 'text' ? ({ ...l, align } as TextLayer) : l,
                    )
                  }
                >
                  {align === 'left' ? (
                    <AlignStartVertical size={12} />
                  ) : align === 'center' ? (
                    <AlignCenter size={12} />
                  ) : (
                    <AlignEndVertical size={12} />
                  )}
                </button>
              ))}
            </div>

            <div style={rowStyle}>
              <SliderPopover
                icon={<MoveHorizontal size={13} />}
                title="Letter spacing"
                min={-2}
                max={10}
                step={0.1}
                value={textLayer.letterSpacing ?? 0}
                identity={0}
                format={v => `${v.toFixed(1)}px`}
                onChange={v =>
                  mutateLayer(l =>
                    l.kind === 'text' ? ({ ...l, letterSpacing: v } as TextLayer) : l,
                  )
                }
              />
              <SliderPopover
                icon={<MoveVertical size={13} />}
                title="Line height"
                min={0.8}
                max={2.5}
                step={0.05}
                value={textLayer.lineHeight ?? 1.2}
                identity={1.2}
                format={v => v.toFixed(2)}
                onChange={v =>
                  mutateLayer(l =>
                    l.kind === 'text' ? ({ ...l, lineHeight: v } as TextLayer) : l,
                  )
                }
              />
              <HexColorInput
                value={textLayer.color}
                onChange={hex =>
                  mutateLayer(l =>
                    l.kind === 'text' ? ({ ...l, color: hex } as TextLayer) : l,
                  )
                }
                title="Text colour"
                size={22}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Shape options ── */}
      {shapeLayer && (
        <section aria-label="Shape">
          <div style={divider} />
          <p style={sectionLabel}>Shape</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={rowStyle}>
              <HexColorInput
                value={shapeLayer.fillColor}
                onChange={hex =>
                  mutateLayer(l =>
                    l.kind === 'shape' ? ({ ...l, fillColor: hex } as ShapeLayer) : l,
                  )
                }
                title="Fill colour"
                size={22}
              />
              <GradientFillEditor
                value={(shapeLayer as ShapeLayer).gradientFill as GradientFill | undefined}
                onChange={next =>
                  mutateLayer(l =>
                    l.kind === 'shape' ? ({ ...l, gradientFill: next } as ShapeLayer) : l,
                  )
                }
              />
            </div>
            <div style={rowStyle}>
              <SliderPopover
                icon={<MoveHorizontal size={13} />}
                title="Width"
                min={20}
                max={canvasW ?? 624}
                step={1}
                value={shapeLayer.width}
                format={v => `${Math.round(v)}px`}
                onChange={v =>
                  mutateLayer(l =>
                    l.kind === 'shape' ? ({ ...l, width: v } as ShapeLayer) : l,
                  )
                }
              />
              <SliderPopover
                icon={<MoveVertical size={13} />}
                title="Height"
                min={20}
                max={canvasH ?? 204}
                step={1}
                value={shapeLayer.height}
                format={v => `${Math.round(v)}px`}
                onChange={v =>
                  mutateLayer(l =>
                    l.kind === 'shape' ? ({ ...l, height: v } as ShapeLayer) : l,
                  )
                }
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Image adjust ── */}
      {imgLayer && (
        <section aria-label="Adjust image">
          <div style={divider} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <p style={{ ...sectionLabel, margin: 0 }}>Adjust</p>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                title="Curves & tone presets"
                onClick={onOpenCurves}
                style={{
                  background: 'rgba(186,150,90,0.10)',
                  border: '1px solid rgba(186,150,90,0.25)',
                  borderRadius: 5,
                  color: 'rgba(186,150,90,0.85)',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 7px',
                  cursor: 'pointer',
                }}
              >
                Curves…
              </button>
              <button
                type="button"
                aria-label={adjustImageOpen ? 'Hide adjust filters' : 'Show adjust filters'}
                aria-pressed={adjustImageOpen}
                title={adjustImageOpen ? 'Hide filters' : 'Show filters'}
                onClick={onToggleAdjustImage}
                style={iconBtnStyle(adjustImageOpen)}
              >
                <Sliders size={12} />
              </button>
            </div>
          </div>
          {adjustImageOpen && (
            <AdjustmentPanel
              filters={imgLayer.filters}
              heading={null}
              onChange={patch =>
                mutateLayer(l =>
                  l.kind === 'image'
                    ? ({ ...l, filters: { ...(l.filters ?? {}), ...patch } } as ImageLayer)
                    : l,
                )
              }
              onReset={() =>
                mutateLayer(l =>
                  l.kind === 'image' ? ({ ...l, filters: undefined } as ImageLayer) : l,
                )
              }
            />
          )}
        </section>
      )}

      {/* ── Align — shown when ≥1 positionable layer selected ── */}
      {posLayer && (
        <FaceplateAlignSection
          layer={layer}
          project={project}
          multiSelectedIds={multiSelectedIds}
          mutate={mutate}
          canvasW={canvasW}
          canvasH={canvasH}
        />
      )}

      {/* ── Document / Canvas background ── */}
      <FaceplateDocumentSection project={project} mutate={mutate} />
    </>
  )
}

// ── Document section ─────────────────────────────────────────────────────────

function FaceplateDocumentSection({
  project,
  mutate,
}: {
  project: Coh2FaceplateProject
  mutate: FaceplatePropertiesExtensionProps['mutate']
}) {
  const isTransparent = project.backgroundColor === null

  const toggleBtnStyle = (active: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: 5,
    border: `1px solid ${active ? 'rgba(186,150,90,0.5)' : 'rgba(255,255,255,0.12)'}`,
    background: active ? 'rgba(186,150,90,0.15)' : 'rgba(255,255,255,0.04)',
    color: active ? EDITOR_ACCENT : EDITOR_TEXT_2,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  })

  return (
    <>
      <div style={divider} />
      <section aria-label="Document">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Palette size={12} color={EDITOR_TEXT_4} />
          <p style={{ ...sectionLabel, margin: 0 }}>Background</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <HexColorInput
            value={isTransparent ? '#000000' : (project.backgroundColor ?? '#000000')}
            onChange={hex => {
              if (!isTransparent) mutate(p => ({ ...p, backgroundColor: hex }))
            }}
            title="Background colour"
            size={22}
          />
          <button
            type="button"
            title={isTransparent ? 'Switch to solid colour' : 'Switch to transparent background'}
            aria-label={isTransparent ? 'Switch to solid colour' : 'Switch to transparent background'}
            aria-pressed={isTransparent}
            data-testid="bg-transparent-toggle"
            onClick={() => mutate(p => ({ ...p, backgroundColor: isTransparent ? '#000000' : null }))}
            style={toggleBtnStyle(isTransparent)}
          >
            <Slash size={12} />
          </button>
          <span style={{ fontSize: 10, color: EDITOR_TEXT_4 }}>
            {isTransparent ? 'Transparent' : 'Solid'}
          </span>
        </div>
      </section>
    </>
  )
}

// ── Align section ──────────────────────────────────────────────────────────────

function FaceplateAlignSection({
  layer,
  project,
  multiSelectedIds,
  mutate,
  canvasW = 624,
  canvasH = 204,
}: {
  layer: FaceplateLayer
  project: Coh2FaceplateProject
  multiSelectedIds: Set<string>
  mutate: FaceplatePropertiesExtensionProps['mutate']
  canvasW?: number
  canvasH?: number
}) {
  const allSelectedIds = new Set([layer.id, ...multiSelectedIds])
  const allSelectedLayers = project.layers.filter(
    l => allSelectedIds.has(l.id) && l.kind !== 'group',
  )
  const canDistribute = allSelectedLayers.length >= 3
  const isMulti = allSelectedIds.size >= 2

  const layerBox = (l: FaceplateLayer): { x: number; y: number; hw: number; hh: number } | null => {
    if (l.kind === 'text') {
      const lines = l.text.split('\n')
      const longestLine = Math.max(...lines.map(ln => ln.length), 1)
      const hw = (longestLine * l.fontSize * l.scale * 0.6) / 2
      const hh = (lines.length * l.fontSize * l.scale * 1.2) / 2
      return { x: l.x, y: l.y, hw, hh }
    }
    if (l.kind === 'shape') return { x: l.x, y: l.y, hw: (l.width * l.scale) / 2, hh: (l.height * l.scale) / 2 }
    if (l.kind === 'image') {
      const w = 100 * l.scale; const h = 100 * (l.scaleY ?? l.scale)
      return { x: l.x, y: l.y, hw: w / 2, hh: h / 2 }
    }
    return null
  }

  const alignAll = (updater: (l: FaceplateLayer, box: { x: number; y: number; hw: number; hh: number } | null) => FaceplateLayer) => {
    mutate(p => ({
      ...p,
      layers: p.layers.map(l => allSelectedIds.has(l.id) ? updater(l, layerBox(l)) : l),
    }))
  }

  const distributeH = () => {
    const sorted = [...allSelectedLayers].sort((a, b) => (layerBox(a)?.x ?? 0) - (layerBox(b)?.x ?? 0))
    if (sorted.length < 3) return
    const firstBox = layerBox(sorted[0]); const lastBox = layerBox(sorted[sorted.length - 1])
    if (!firstBox || !lastBox) return
    const totalSpan = (lastBox.x + lastBox.hw) - (firstBox.x - firstBox.hw)
    const totalLayerW = sorted.reduce((s, l) => s + (layerBox(l)?.hw ?? 0) * 2, 0)
    const gap = (totalSpan - totalLayerW) / (sorted.length - 1)
    let cursor = firstBox.x - firstBox.hw
    mutate(p => {
      const positions = new Map<string, number>()
      for (const l of sorted) { const b = layerBox(l); if (!b) continue; positions.set(l.id, cursor + b.hw); cursor += b.hw * 2 + gap }
      return { ...p, layers: p.layers.map(l => positions.has(l.id) ? { ...l, x: positions.get(l.id)! } : l) }
    })
  }

  const distributeV = () => {
    const sorted = [...allSelectedLayers].sort((a, b) => (layerBox(a)?.y ?? 0) - (layerBox(b)?.y ?? 0))
    if (sorted.length < 3) return
    const firstBox = layerBox(sorted[0]); const lastBox = layerBox(sorted[sorted.length - 1])
    if (!firstBox || !lastBox) return
    const totalSpan = (lastBox.y + lastBox.hh) - (firstBox.y - firstBox.hh)
    const totalLayerH = sorted.reduce((s, l) => s + (layerBox(l)?.hh ?? 0) * 2, 0)
    const gap = (totalSpan - totalLayerH) / (sorted.length - 1)
    let cursor = firstBox.y - firstBox.hh
    mutate(p => {
      const positions = new Map<string, number>()
      for (const l of sorted) { const b = layerBox(l); if (!b) continue; positions.set(l.id, cursor + b.hh); cursor += b.hh * 2 + gap }
      return { ...p, layers: p.layers.map(l => positions.has(l.id) ? { ...l, y: positions.get(l.id)! } : l) }
    })
  }

  return (
    <section aria-label="Align" data-testid="align-section">
      <div style={divider} />
      <p style={sectionLabel}>Align{isMulti ? ' (multi)' : ''}</p>
      <div style={{ ...rowStyle, flexWrap: 'wrap', gap: 4 }}>
        <button style={iconBtnStyle(false)} title="Align Left" onClick={() => alignAll((l, b) => b ? { ...l, x: b.hw } : l)}>
          <AlignStartVertical size={12} />
        </button>
        <button style={iconBtnStyle(false)} title="Center Horizontally" onClick={() => alignAll((l) => ({ ...l, x: canvasW / 2 }))}>
          <AlignCenterVertical size={12} />
        </button>
        <button style={iconBtnStyle(false)} title="Align Right" onClick={() => alignAll((l, b) => b ? { ...l, x: canvasW - b.hw } : l)}>
          <AlignEndVertical size={12} />
        </button>
        <button style={iconBtnStyle(false)} title="Align Top" onClick={() => alignAll((l, b) => b ? { ...l, y: b.hh } : l)}>
          <AlignStartHorizontal size={12} />
        </button>
        <button style={iconBtnStyle(false)} title="Center Vertically" onClick={() => alignAll((l) => ({ ...l, y: canvasH / 2 }))}>
          <AlignCenter size={12} />
        </button>
        <button style={iconBtnStyle(false)} title="Align Bottom" onClick={() => alignAll((l, b) => b ? { ...l, y: canvasH - b.hh } : l)}>
          <AlignEndHorizontal size={12} />
        </button>
        {isMulti && (
          <>
            <button
              style={{ ...iconBtnStyle(false), opacity: canDistribute ? 1 : 0.35, cursor: canDistribute ? 'pointer' : 'not-allowed' }}
              title={canDistribute ? 'Distribute horizontally' : 'Select 3+ layers to distribute'}
              onClick={canDistribute ? distributeH : undefined}
              disabled={!canDistribute}
            >
              <AlignHorizontalSpaceAround size={12} />
            </button>
            <button
              style={{ ...iconBtnStyle(false), opacity: canDistribute ? 1 : 0.35, cursor: canDistribute ? 'pointer' : 'not-allowed' }}
              title={canDistribute ? 'Distribute vertically' : 'Select 3+ layers to distribute'}
              onClick={canDistribute ? distributeV : undefined}
              disabled={!canDistribute}
            >
              <AlignVerticalSpaceAround size={12} />
            </button>
          </>
        )}
      </div>
    </section>
  )
}
