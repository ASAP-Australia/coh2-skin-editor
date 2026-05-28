import { useId } from 'react'
import { Eraser, FlipHorizontal2 } from 'lucide-react'
import type { BrushSettings } from '@/lib/brush'

interface Props {
  brushOn: boolean
  setBrushOn: (v: boolean) => void
  settings: BrushSettings
  setSettings: (s: BrushSettings) => void
  /** Open an eyedropper. Editor wires this to a one-shot pick mode that
   *  samples the next viewport click and writes the colour back via
   *  `setSettings`. */
  onEyedrop?: () => void
  /** Commit the painted result to the project's customDiffuseUrl so it
   *  survives a reload. The Editor owns the canvas → dataURL snapshot. */
  onSave?: () => void
  /** Wipe the painted layer back to the vanilla diffuse. */
  onClear?: () => void
}

const SWATCHES = [
  '#7a8a4e',
  '#4a5c28',
  '#c8aa6a',
  '#3e2a12',
  '#e0dcd4',
  '#2a3e1a',
  '#6a4a28',
  '#8a2a1a',
  '#c8a020',
  '#1a1a1a',
  '#d8843a',
  '#2c3c22',
]

export default function BrushPanel(p: Props) {
  const id = useId()

  return (
    <div className="space-y-3">
      <Row>
        <button
          onClick={() => p.setBrushOn(!p.brushOn)}
          className={`flex-1 px-3 py-2 rounded-lg text-[11px] font-medium transition ${
            p.brushOn
              ? 'bg-[var(--color-accent)] text-black shadow-[0_2px_8px_rgb(0_0_0/0.25)]'
              : 'bg-white/5 border border-white/10 text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:border-white/20'
          }`}
        >
          {p.brushOn ? 'Brush ON · click viewport to paint' : 'Enable brush'}
        </button>
        {/* Eraser toggle — when active, strokes restore the vanilla diffuse
            within the brush radius instead of painting colour. Visually
            highlighted so the user always knows they are in erase mode. */}
        <button
          onClick={() =>
            p.setSettings({
              ...p.settings,
              mode: p.settings.mode === 'erase' ? 'paint' : 'erase',
            })
          }
          title={p.settings.mode === 'erase' ? 'Switch to paint mode' : 'Switch to eraser mode'}
          aria-label="Toggle eraser mode"
          aria-pressed={p.settings.mode === 'erase'}
          className={`shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors ${
            p.settings.mode === 'erase'
              ? 'bg-sky-500/80 text-white shadow-[0_2px_8px_rgb(0_0_0/0.25)]'
              : 'bg-white/5 border border-white/10 text-[var(--color-text-2)] hover:text-white hover:border-white/20'
          }`}
        >
          <Eraser size={13} />
        </button>
        {/* Horizontal-symmetry toggle. When active, each dab is mirrored
            across the canvas centre line so left and right halves of a
            vehicle stay in sync. Defaults OFF — the user's bedtime request
            was that symmetry on the texture must be disable-able from the
            Edit-Texture entry point. With OFF as the default, "disable" is
            free; the toggle is here for users who explicitly want the
            mirrored mode. The icon (FlipHorizontal2) mirrors the metaphor
            used by DecalPackEditor's flip-X button so the visual language
            stays consistent across the editor. */}
        <button
          onClick={() =>
            p.setSettings({
              ...p.settings,
              symmetric: !p.settings.symmetric,
            })
          }
          title={
            p.settings.symmetric
              ? 'Symmetric brush is ON — disable for one-sided painting'
              : 'Symmetric brush is OFF — enable to mirror dabs across canvas centre'
          }
          aria-label="Toggle symmetric brush"
          aria-pressed={!!p.settings.symmetric}
          data-testid="brush-symmetry-toggle"
          className={`shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors ${
            p.settings.symmetric
              ? 'bg-emerald-500/80 text-white shadow-[0_2px_8px_rgb(0_0_0/0.25)]'
              : 'bg-white/5 border border-white/10 text-[var(--color-text-2)] hover:text-white hover:border-white/20'
          }`}
        >
          <FlipHorizontal2 size={13} />
        </button>
      </Row>

      <Slider
        id={`${id}-size`}
        label="Size"
        value={p.settings.size}
        min={8}
        max={512}
        step={1}
        suffix="px"
        onChange={v => p.setSettings({ ...p.settings, size: v })}
      />
      <Slider
        id={`${id}-soft`}
        label="Softness"
        value={p.settings.softness}
        min={0}
        max={1}
        step={0.05}
        suffix=""
        onChange={v => p.setSettings({ ...p.settings, softness: v })}
      />
      <Slider
        id={`${id}-op`}
        label="Opacity"
        value={p.settings.opacity}
        min={0.05}
        max={1}
        step={0.05}
        suffix=""
        onChange={v => p.setSettings({ ...p.settings, opacity: v })}
      />

      <div>
        <Label>Colour</Label>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="color"
            value={p.settings.color}
            onChange={e => p.setSettings({ ...p.settings, color: e.target.value })}
            className="w-8 h-8 rounded-md border border-white/10 bg-transparent cursor-pointer"
            aria-label="Brush colour"
          />
          {p.onEyedrop && (
            <button
              onClick={p.onEyedrop}
              className="px-2 py-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-[var(--color-text-2)] hover:text-white hover:border-white/20 transition-colors"
            >
              Eyedropper
            </button>
          )}
        </div>
        <div className="grid grid-cols-6 gap-1 mt-2">
          {SWATCHES.map(c => (
            <button
              key={c}
              onClick={() => p.setSettings({ ...p.settings, color: c })}
              className="aspect-square rounded-md border border-white/10 hover:border-white/40 transition-colors"
              style={{ background: c }}
              aria-label={`Set brush colour to ${c}`}
            />
          ))}
        </div>
      </div>

      {(p.onSave || p.onClear) && (
        <div className="flex gap-1.5 pt-1">
          {p.onClear && (
            <button
              onClick={p.onClear}
              className="flex-1 px-2 py-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-[var(--color-text-2)] hover:text-white hover:border-white/20 transition-colors"
            >
              Clear paint
            </button>
          )}
          {p.onSave && (
            <button
              onClick={p.onSave}
              className="flex-1 px-2 py-1.5 rounded-lg text-[10px] bg-[var(--color-accent)] text-black font-medium hover:opacity-90"
            >
              Bake into diffuse
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[1.5px] text-[var(--color-text-3)] font-medium mb-0.5">
      {children}
    </div>
  )
}

function Slider(props: {
  id?: string
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <Label>{props.label}</Label>
        <span className="text-[10px] text-zinc-400 font-mono">
          {props.value.toFixed(props.step >= 1 ? 0 : 2)}
          {props.suffix}
        </span>
      </div>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={e => props.onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </div>
  )
}
