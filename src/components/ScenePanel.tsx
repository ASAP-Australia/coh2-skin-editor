/**
 * ScenePanel — right-edge environment-preset picker.
 *
 * Three vertically-stacked circular icon buttons (centered on the right
 * edge) for switching between scene presets:
 *   • In-Game Field (cubemap battlefield)
 *   • Studio Grid   (dark studio with reference grid)
 *   • Showcase      (black backdrop, omni light)
 *
 * Active preset is highlighted with the accent ring; tooltip shows the
 * preset's full label on hover. The active preset id is persisted by
 * the parent.
 */

import { Globe, Grid3x3, Lightbulb } from 'lucide-react'
import { type PresetId, SCENE_PRESETS } from '@/lib/scene-settings'

interface Props {
  presetId: PresetId
  setPresetId: (id: PresetId) => void
}

const PRESET_ICONS: Record<PresetId, React.ReactNode> = {
  in_game_field: <Globe size={20} />,
  studio_grid: <Grid3x3 size={20} />,
  showcase: <Lightbulb size={20} />,
}

const PRESET_ORDER: PresetId[] = ['in_game_field', 'studio_grid', 'showcase']

export default function ScenePanel({ presetId, setPresetId }: Props) {
  // No LoadingBorder here — the scene panel is a tight vertical stack of
  // 44 px circles, so a rotating beam around it traces a long thin
  // capsule and reads as a "stuck progress" glyph rather than a tasteful
  // accent. Users get plenty of feedback from the active-pill highlight
  // changing immediately on click + the scene actually swapping behind.
  return (
    <div
      className="fixed top-1/2 right-3 -translate-y-1/2 z-30 flex flex-col gap-2 p-1.5 rounded-2xl"
      style={{
        background: 'rgba(20, 22, 28, 0.62)',
        backdropFilter: 'blur(28px) saturate(180%)',
        border: '0.5px solid rgba(255,255,255,0.10)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)',
      }}
    >
      {PRESET_ORDER.map(id => {
        const active = presetId === id
        const preset = SCENE_PRESETS[id]
        return (
          <button
            key={id}
            type="button"
            onClick={() => setPresetId(id)}
            aria-pressed={active}
            title={`${preset.label} — ${preset.description}`}
            className={[
              'relative w-11 h-11 rounded-xl flex items-center justify-center',
              'transition-all duration-150 active:scale-95',
              active
                ? 'bg-white/95 text-black shadow-[inset_0_0.5px_0_rgb(255_255_255/0.8),0_2px_8px_rgba(0,0,0,0.25)]'
                : 'text-[var(--color-text-2)] hover:text-white hover:bg-white/10',
            ].join(' ')}
          >
            {PRESET_ICONS[id]}
          </button>
        )
      })}
    </div>
  )
}
