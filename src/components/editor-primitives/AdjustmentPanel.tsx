/**
 * AdjustmentPanel — the 8-slider Photoshop-style adjustment stack.
 *
 * Promotes the inline 8-filter stack from FaceplateEditor's `LeftToolbar`
 * into a self-contained composite primitive. The slot mapping (which slider
 * controls which CSS filter operator) lives here in ONE place, so any other
 * future image-editing surface (decal-pack composite preview, sticker
 * editor, faction-shield tinting) can drop AdjustmentPanel in without
 * duplicating the slot table.
 *
 * Identity awareness:
 *   • Each slider passes `identity={IMAGE_LAYER_FILTER_DEFAULTS[key]}` so
 *     the value readout dims when untouched.
 *   • The Reset button is disabled when every slider is at identity — read
 *     from the same `imageFilterCss(filters) === 'none'` check the editor
 *     used inline.
 *
 * Headings:
 *   • The panel renders its own "Adjustments" section heading on top so
 *     the caller doesn't have to remember to put one above it. Pass
 *     `heading={null}` to suppress (e.g. when nested inside an existing
 *     accordion).
 *
 * Progressive disclosure:
 *   • Only the three most-used sliders (Brightness / Contrast / Saturation)
 *     are visible by default. The remaining six (Hue, Blur, Sepia,
 *     Grayscale, Invert, Noise) live behind a collapsed "More adjustments"
 *     disclosure so the panel isn't a wall of nine controls. The disclosure
 *     auto-opens when any of those advanced sliders is off its identity
 *     value, so an active-but-hidden adjustment is never stranded.
 */

import { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  type ImageLayerFilters,
  IMAGE_LAYER_FILTER_DEFAULTS,
  imageFilterCss,
} from '@/lib/faceplate-project'
import SliderRow from './SliderRow'
import PanelHeading from './PanelHeading'
import PanelButton from './PanelButton'

interface Props {
  filters: ImageLayerFilters | undefined
  /** Patch updater — receives a partial filters object. Caller is
   *  responsible for merging onto the layer. */
  onChange: (patch: Partial<ImageLayerFilters>) => void
  /** Reset callback — caller should set the layer's `filters` to undefined
   *  (preferred — keeps the model clean) or to a fresh defaults clone. */
  onReset: () => void
  /** Section heading. Pass `null` to suppress. Default `"Adjustments"`. */
  heading?: string | null
}

export default function AdjustmentPanel({
  filters,
  onChange,
  onReset,
  heading = 'Adjustments',
}: Props) {
  const f = filters ?? {}
  // Any filter active? Used to enable/disable the Reset button. Reuses the
  // same `imageFilterCss` helper the renderer uses for the live preview,
  // so the "is at identity" check matches what the canvas would draw.
  // Noise is a post-process pass not covered by imageFilterCss, so we check
  // it separately: if noise > 0 the panel is not at identity.
  const hasActiveFilters =
    imageFilterCss(filters) !== 'none' || (!!filters?.noise && filters.noise > 0)

  // Progressive disclosure: is any of the six advanced sliders off identity?
  // If so we force the "More adjustments" section open so a hidden-but-active
  // adjustment is never stranded out of view.
  const advancedActive =
    (f.hueRotate ?? IMAGE_LAYER_FILTER_DEFAULTS.hueRotate) !== IMAGE_LAYER_FILTER_DEFAULTS.hueRotate ||
    (f.blur ?? IMAGE_LAYER_FILTER_DEFAULTS.blur) !== IMAGE_LAYER_FILTER_DEFAULTS.blur ||
    (f.sepia ?? IMAGE_LAYER_FILTER_DEFAULTS.sepia) !== IMAGE_LAYER_FILTER_DEFAULTS.sepia ||
    (f.grayscale ?? IMAGE_LAYER_FILTER_DEFAULTS.grayscale) !== IMAGE_LAYER_FILTER_DEFAULTS.grayscale ||
    (f.invert ?? IMAGE_LAYER_FILTER_DEFAULTS.invert) !== IMAGE_LAYER_FILTER_DEFAULTS.invert ||
    (!!f.noise && f.noise > 0)

  const [moreOpen, setMoreOpen] = useState(false)
  const showMore = moreOpen || advancedActive

  // useCallback per slider would be overkill — these are file-local fns.
  const set = useCallback((patch: Partial<ImageLayerFilters>) => onChange(patch), [onChange])

  return (
    <>
      {heading && <PanelHeading style={{ marginTop: 4 }}>{heading}</PanelHeading>}
      <SliderRow
        label="Brightness"
        min={0}
        max={2}
        step={0.01}
        value={f.brightness ?? IMAGE_LAYER_FILTER_DEFAULTS.brightness}
        identity={IMAGE_LAYER_FILTER_DEFAULTS.brightness}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => set({ brightness: v })}
      />
      <SliderRow
        label="Contrast"
        min={0}
        max={2}
        step={0.01}
        value={f.contrast ?? IMAGE_LAYER_FILTER_DEFAULTS.contrast}
        identity={IMAGE_LAYER_FILTER_DEFAULTS.contrast}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => set({ contrast: v })}
      />
      <SliderRow
        label="Saturation"
        min={0}
        max={2}
        step={0.01}
        value={f.saturate ?? IMAGE_LAYER_FILTER_DEFAULTS.saturate}
        identity={IMAGE_LAYER_FILTER_DEFAULTS.saturate}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => set({ saturate: v })}
      />
      <PanelButton
        onClick={() => setMoreOpen(o => !o)}
        // Auto-open (advancedActive) locks the toggle open — a hidden active
        // slider must stay reachable, so disable collapsing while it holds.
        disabled={advancedActive}
        size="compact"
        style={{ width: '100%', marginTop: 4 }}
        aria-expanded={showMore}
        title={
          advancedActive
            ? 'More adjustments (kept open — advanced slider in use)'
            : showMore
              ? 'Hide advanced adjustments'
              : 'Show advanced adjustments'
        }
      >
        {showMore ? (
          <ChevronDown size={12} aria-hidden />
        ) : (
          <ChevronRight size={12} aria-hidden />
        )}{' '}
        <span>More adjustments</span>
      </PanelButton>
      {showMore && (
        <>
      <SliderRow
        label="Hue"
        min={-180}
        max={180}
        step={1}
        value={f.hueRotate ?? IMAGE_LAYER_FILTER_DEFAULTS.hueRotate}
        identity={IMAGE_LAYER_FILTER_DEFAULTS.hueRotate}
        format={v => `${Math.round(v)}°`}
        onChange={v => set({ hueRotate: v })}
      />
      <SliderRow
        label="Blur"
        min={0}
        max={10}
        step={0.1}
        value={f.blur ?? IMAGE_LAYER_FILTER_DEFAULTS.blur}
        identity={IMAGE_LAYER_FILTER_DEFAULTS.blur}
        format={v => `${v.toFixed(1)}px`}
        onChange={v => set({ blur: v })}
      />
      <SliderRow
        label="Sepia"
        min={0}
        max={1}
        step={0.01}
        value={f.sepia ?? IMAGE_LAYER_FILTER_DEFAULTS.sepia}
        identity={IMAGE_LAYER_FILTER_DEFAULTS.sepia}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => set({ sepia: v })}
      />
      <SliderRow
        label="Grayscale"
        min={0}
        max={1}
        step={0.01}
        value={f.grayscale ?? IMAGE_LAYER_FILTER_DEFAULTS.grayscale}
        identity={IMAGE_LAYER_FILTER_DEFAULTS.grayscale}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => set({ grayscale: v })}
      />
      <SliderRow
        label="Invert"
        min={0}
        max={1}
        step={0.01}
        value={f.invert ?? IMAGE_LAYER_FILTER_DEFAULTS.invert}
        identity={IMAGE_LAYER_FILTER_DEFAULTS.invert}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => set({ invert: v })}
      />
      <SliderRow
        label="Noise"
        min={0}
        max={1}
        step={0.01}
        value={f.noise ?? 0}
        identity={0}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => set({ noise: v === 0 ? undefined : v })}
      />
        </>
      )}
      <PanelButton
        onClick={onReset}
        disabled={!hasActiveFilters}
        style={{ marginTop: 4 }}
        align="center"
      >
        Reset adjustments
      </PanelButton>
    </>
  )
}
