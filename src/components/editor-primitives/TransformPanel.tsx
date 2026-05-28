/**
 * TransformPanel — scale / rotation / opacity + flip + reorder controls.
 *
 * Composite that replaces DecalPackEditor's inline Transform block. Most
 * surfaces that let the user manipulate a single 2D layer will want this
 * exact set, so promoting it deduplicates the layout AND ensures every
 * future editor surface speaks the same control vocabulary.
 *
 * The panel owns no model — the caller passes the current transform
 * values and a single `onChange(patch)` callback. This keeps TransformPanel
 * usable for either a Decal (no `flipH/V` semantics in the model) or a
 * FaceplateLayer (full flip support) by passing `enableFlip={false}` when
 * the underlying model doesn't support flips.
 *
 * Reorder + duplicate + reset live behind boolean flags so the caller can
 * mix and match. Pass `null` to any reorder callback to omit the button.
 */

import { ChevronDown, ChevronUp, FlipHorizontal, FlipVertical } from 'lucide-react'
import SliderRow from './SliderRow'
import PanelHeading from './PanelHeading'
import PanelButton from './PanelButton'
import ToggleChip from './ToggleChip'

export interface LayerTransform {
  scale: number
  rotation: number
  opacity: number
  flipH?: boolean
  flipV?: boolean
}

interface Props {
  transform: LayerTransform
  onChange: (patch: Partial<LayerTransform>) => void
  /** Show Flip H / Flip V toggles. Default `true`. */
  enableFlip?: boolean
  /** Earlier / Later reorder buttons. Pass null to omit the row entirely. */
  onMoveEarlier?: (() => void) | null
  onMoveLater?: (() => void) | null
  /** Duplicate button (full-width). Pass null to omit. */
  onDuplicate?: (() => void) | null
  /** Reset position + rotation to canvas centre. Pass null to omit. */
  onResetTransform?: (() => void) | null
  /** Optional scale clamps (some layers shouldn't shrink past 5% or scale
   *  past 4×). Defaults match the DecalPackEditor's existing bounds. */
  scaleRange?: [number, number]
  /** Section heading. Default `"Transform"`. Pass `null` to suppress. */
  heading?: string | null
}

export default function TransformPanel({
  transform,
  onChange,
  enableFlip = true,
  onMoveEarlier,
  onMoveLater,
  onDuplicate,
  onResetTransform,
  scaleRange = [0.05, 4],
  heading = 'Transform',
}: Props) {
  return (
    <>
      {heading && <PanelHeading style={{ marginTop: 20 }}>{heading}</PanelHeading>}

      <SliderRow
        label="Scale"
        value={transform.scale}
        min={scaleRange[0]}
        max={scaleRange[1]}
        step={0.01}
        onChange={v => onChange({ scale: v })}
        format={v => `${v.toFixed(2)}×`}
        style={{ marginTop: 10 }}
      />
      <SliderRow
        label="Rotation"
        value={transform.rotation}
        min={-180}
        max={180}
        step={1}
        onChange={v => onChange({ rotation: v })}
        format={v => `${v.toFixed(0)}°`}
        style={{ marginTop: 10 }}
      />
      <SliderRow
        label="Opacity"
        value={transform.opacity}
        min={0}
        max={1}
        step={0.01}
        onChange={v => onChange({ opacity: v })}
        format={v => `${Math.round(v * 100)}%`}
        style={{ marginTop: 10 }}
      />

      {enableFlip && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <ToggleChip
            active={!!transform.flipH}
            onToggle={next => onChange({ flipH: next })}
            ariaLabel="Flip horizontally"
            flex
          >
            <FlipHorizontal size={12} aria-hidden /> <span>Flip H</span>
          </ToggleChip>
          <ToggleChip
            active={!!transform.flipV}
            onToggle={next => onChange({ flipV: next })}
            ariaLabel="Flip vertically"
            flex
          >
            <FlipVertical size={12} aria-hidden /> <span>Flip V</span>
          </ToggleChip>
        </div>
      )}

      {(onMoveEarlier || onMoveLater) && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {onMoveEarlier && (
            <PanelButton
              onClick={onMoveEarlier}
              flex
              title="Move earlier in stack"
              aria-label="Move earlier in stack"
              size="compact"
            >
              <ChevronUp size={12} aria-hidden /> <span>Earlier</span>
            </PanelButton>
          )}
          {onMoveLater && (
            <PanelButton
              onClick={onMoveLater}
              flex
              title="Move later in stack"
              aria-label="Move later in stack"
              size="compact"
            >
              <ChevronDown size={12} aria-hidden /> <span>Later</span>
            </PanelButton>
          )}
        </div>
      )}

      {onDuplicate && (
        <PanelButton
          onClick={onDuplicate}
          align="center"
          size="compact"
          style={{ width: '100%', marginTop: 6 }}
        >
          Duplicate
        </PanelButton>
      )}

      {onResetTransform && (
        <PanelButton
          onClick={onResetTransform}
          align="center"
          size="compact"
          title="Centre and clear rotation"
          style={{ width: '100%', marginTop: 6 }}
        >
          Centre &amp; reset
        </PanelButton>
      )}
    </>
  )
}
