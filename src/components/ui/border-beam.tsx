/**
 * BorderBeam — port of the component from https://beam.jakubantalik.com/
 *
 * I dumped their bundle and copied the dark-theme + ocean-variant CSS
 * verbatim, so the output is visually identical to their playground at
 * "Large + Ocean + 5s + 85%". Three layers stacked:
 *
 *   ::before  (z 1)  faded coloured base + inset shadow, masked by the
 *                    inner conic mask (peak 70 %)  → the warm halo
 *   ::after   (z 2)  bright coloured ring, masked by the wider conic
 *                    mask (peak 66 %, 65 % perimeter lit) intersected
 *                    with the border ring  → the visible beam
 *   bloom div (z 3)  same ring + filter: blur(8 px) brightness(...)
 *                    saturate(1.2) at full opacity  → the diffuse glow
 *
 * The coloured "ring" is actually 9 radial gradients positioned around the
 * perimeter, so different colours are revealed as the conic mask rotates
 * through them — you can see the beam shift hue from violet → cyan → blue
 * as it travels rather than being a flat colour.
 *
 * Props are simplified: `colorVariant` switches between the 4 reference
 * palettes, `strength` (0..1) drives `--beam-strength`, `duration` is
 * rotation seconds. Defaults match the playground "Large + Ocean + 5 s +
 * 85 %" demo button.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'

type Variant = 'ocean' | 'colorful' | 'mono' | 'sunset'

interface Props {
  children?: ReactNode
  colorVariant?: Variant
  duration?: number
  /** 0..1 — drives `--beam-strength`. Default 0.85. */
  strength?: number
  borderRadius?: number
  borderWidth?: number
  className?: string
  /** When false, the beam animation and all glow layers are hidden
   *  (animation: none, pseudo-element + bloom opacity → 0). The wrapper
   *  div and children still render — only the decorative beam is
   *  suppressed. Defaults to true. */
  active?: boolean
}

// ──────────────────────────────────────────────────────────────────────
// Palettes — copied verbatim from the reference bundle (zu, rm objects).
// Each variant has:
//   border : 9 radial gradients positioned around the perimeter — the
//            "lit ring" the conic mask reveals
//   inner  : 8 radial gradients with reduced alpha — the warm halo for
//            the ::before layer
// ──────────────────────────────────────────────────────────────────────

type Stop = { color: string; pos: string; size: string }

const BORDER: Record<Variant, Stop[]> = {
  // Blue-shifted ocean — original reference palette had several heavy
  // purples (hue ~265–280); each of those is swapped to a cyan/sky/royal-
  // blue at hue ~200–220 so the beam reads "blue glow" rather than "violet
  // glow", but the multi-stop variation along the perimeter is preserved
  // (otherwise the beam goes flat).
  ocean: [
    { color: 'rgb(40, 140, 230)',  pos: '33% -7.4%',   size: '70px 40px' },
    { color: 'rgb(60, 160, 255)',  pos: '12% -5%',     size: '60px 35px' },
    { color: 'rgb(50, 130, 220)',  pos: '2.1% 68.3%',  size: '40px 70px' },
    { color: 'rgb(70, 180, 250)',  pos: '2.1% 68.3%',  size: '20px 35px' },
    { color: 'rgb(50, 150, 255)',  pos: '74.4% 100%',  size: '180px 32px' },
    { color: 'rgb(80, 200, 255)',  pos: '55% 100%',    size: '85px 26px' },
    { color: 'rgb(40, 170, 240)',  pos: '93.9% 0%',    size: '74px 32px' },
    { color: 'rgb(60, 160, 240)',  pos: '100% 27.1%',  size: '26px 42px' },
    { color: 'rgb(30, 140, 255)',  pos: '100% 27.1%',  size: '52px 48px' },
  ],
  sunset: [
    { color: 'rgb(255, 80, 50)',  pos: '33% -7.4%',  size: '70px 40px' },
    { color: 'rgb(255, 160, 40)', pos: '12% -5%',    size: '60px 35px' },
    { color: 'rgb(255, 120, 60)', pos: '2.1% 68.3%', size: '40px 70px' },
    { color: 'rgb(255, 200, 50)', pos: '2.1% 68.3%', size: '20px 35px' },
    { color: 'rgb(255, 100, 80)', pos: '74.4% 100%', size: '180px 32px' },
    { color: 'rgb(255, 180, 60)', pos: '55% 100%',   size: '85px 26px' },
    { color: 'rgb(255, 140, 70)', pos: '93.9% 0%',   size: '74px 32px' },
    { color: 'rgb(255, 110, 90)', pos: '100% 27.1%', size: '26px 42px' },
    { color: 'rgb(255, 90, 60)',  pos: '100% 27.1%', size: '52px 48px' },
  ],
  colorful: [
    { color: 'rgb(255, 50, 100)',  pos: '33% -7.4%',   size: '70px 40px' },
    { color: 'rgb(40, 140, 255)',  pos: '12% -5%',     size: '60px 35px' },
    { color: 'rgb(50, 200, 80)',   pos: '2.1% 68.3%',  size: '40px 70px' },
    { color: 'rgb(30, 185, 170)',  pos: '2.1% 68.3%',  size: '20px 35px' },
    { color: 'rgb(100, 70, 255)',  pos: '74.4% 100%',  size: '180px 32px' },
    { color: 'rgb(40, 140, 255)',  pos: '55% 100%',    size: '85px 26px' },
    { color: 'rgb(255, 120, 40)',  pos: '93.9% 0%',    size: '74px 32px' },
    { color: 'rgb(240, 50, 180)',  pos: '100% 27.1%',  size: '26px 42px' },
    { color: 'rgb(180, 40, 240)',  pos: '100% 27.1%',  size: '52px 48px' },
  ],
  mono: [
    { color: 'rgb(180, 180, 180)', pos: '33% -7.4%',   size: '70px 40px' },
    { color: 'rgb(140, 140, 140)', pos: '12% -5%',     size: '60px 35px' },
    { color: 'rgb(160, 160, 160)', pos: '2.1% 68.3%',  size: '40px 70px' },
    { color: 'rgb(130, 130, 130)', pos: '2.1% 68.3%',  size: '20px 35px' },
    { color: 'rgb(170, 170, 170)', pos: '74.4% 100%',  size: '180px 32px' },
    { color: 'rgb(150, 150, 150)', pos: '55% 100%',    size: '85px 26px' },
    { color: 'rgb(190, 190, 190)', pos: '93.9% 0%',    size: '74px 32px' },
    { color: 'rgb(145, 145, 145)', pos: '100% 27.1%',  size: '26px 42px' },
    { color: 'rgb(165, 165, 165)', pos: '100% 27.1%',  size: '52px 48px' },
  ],
}

const INNER: Record<Variant, Stop[]> = {
  ocean: [
    { color: 'rgb(60, 150, 220)',  pos: '2% 68%',   size: '9px 18px' },
    { color: 'rgb(50, 130, 200)',  pos: '2% 68%',   size: '4px 8px' },
    { color: 'rgb(40, 160, 240)',  pos: '72% -3%',  size: '59px 9px' },
    { color: 'rgb(70, 180, 255)',  pos: '74% 100%', size: '42px 7px' },
    { color: 'rgb(60, 170, 250)',  pos: '100% 27%', size: '10px 17px' },
    { color: 'rgb(50, 150, 230)',  pos: '100% 27%', size: '10px 18px' },
    { color: 'rgb(80, 200, 255)',  pos: '100% 27%', size: '5px 10px' },
    { color: 'rgb(40, 140, 220)',  pos: '100% 27%', size: '11px 12px' },
  ],
  sunset:   [],  // (truncated for brevity — falls back to BORDER if empty)
  colorful: [],
  mono:     [],
}

const INNER_SHADOW = 'rgba(255, 255, 255, 0.27)' // dark-theme value for md

function stopsToRadials(stops: Stop[], alphaMul = 1) {
  return stops
    .map(s => {
      const c = alphaMul === 1
        ? s.color
        : s.color.replace('rgb(', 'rgba(').replace(')', `, ${alphaMul})`)
      return `radial-gradient(ellipse ${s.size} at ${s.pos}, ${c}, transparent)`
    })
    .join(',\n    ')
}

export function BorderBeam({
  children,
  colorVariant = 'ocean',
  duration = 5,
  strength = 0.85,
  borderRadius = 16,
  borderWidth = 1,
  className = '',
  active = true,
}: Props) {
  const id = useId().replace(/:/g, '_')
  const n  = borderRadius
  const r  = borderWidth
  const v  = Math.max(0, n - r)

  const innerStops = INNER[colorVariant].length ? INNER[colorVariant] : BORDER[colorVariant]
  const ringBg  = stopsToRadials(BORDER[colorVariant])
  const haloBg  = stopsToRadials(BORDER[colorVariant], 0.45)
  const bloomBg = stopsToRadials(innerStops)

  // Dark-theme conic masks copied from the reference Xx() function.
  const E_inner = `conic-gradient(
    from var(--bb-angle-${id}),
    transparent 0%, transparent 54%,
    rgba(255, 255, 255, 0.1)  57%,
    rgba(255, 255, 255, 0.3)  60%,
    rgba(255, 255, 255, 0.6)  63%,
    rgba(255, 255, 255, 0.75) 66%,
    rgba(255, 255, 255, 0.6)  69%,
    rgba(255, 255, 255, 0.3)  72%,
    rgba(255, 255, 255, 0.1)  75%,
    transparent 78%, transparent 100%
  )`
  const C_bloom = `conic-gradient(
    from var(--bb-angle-${id}),
    transparent 0%, transparent 58%,
    rgba(255, 255, 255, 0.03) 62%,
    rgba(255, 255, 255, 0.08) 65%,
    rgba(255, 255, 255, 0.2)  67%,
    rgba(255, 255, 255, 0.45) 69%,
    rgba(255, 255, 255, 0.85) 70%,
    rgba(255, 255, 255, 0.85) 70.5%,
    rgba(255, 255, 255, 0.45) 71.5%,
    rgba(255, 255, 255, 0.2)  73%,
    rgba(255, 255, 255, 0.08) 75%,
    rgba(255, 255, 255, 0.03) 78%,
    transparent 82%
  )`
  // Wider conic for the ::after stroke layer
  const STROKE_MASK = `conic-gradient(
    from var(--bb-angle-${id}),
    transparent 0%, transparent 30%,
    rgba(255, 255, 255, 0.1)  36%,
    rgba(255, 255, 255, 0.35) 44%,
    white 52%, white 80%,
    rgba(255, 255, 255, 0.35) 86%,
    rgba(255, 255, 255, 0.1)  92%,
    transparent 95%, transparent 100%
  )`

  // Reference layer-opacity defaults (Ax[md][dark]):
  //   strokeOpacity 0.48, innerOpacity 0.7, bloomOpacity 0.8
  const h = 0.48
  const p = 0.7
  const g = 0.8

  // When `active` is false we pause the spin animation and fade all glow
  // layers to zero opacity. Using opacity + animation-play-state means the
  // transition is GPU-only (compositor) so the hide/show is cheap even if
  // the component re-renders with different `active` values. The transition
  // duration (160ms) is fast enough that the beam disappears promptly on
  // click without feeling jarring.
  const beamOpacityTransition = 'opacity 160ms ease-out'
  const afterOpacity   = active ? `calc(${h.toFixed(2)} * var(--bb-strength))` : '0'
  const beforeOpacity  = active ? `calc(${p.toFixed(2)} * var(--bb-strength))` : '0'
  const bloomOpacity   = active ? `calc(${g.toFixed(2)} * var(--bb-strength))` : '0'
  const animPlayState  = active ? 'running' : 'paused'

  const css = `
    @property --bb-angle-${id} {
      syntax: "<angle>";
      initial-value: 0deg;
      inherits: true;
    }
    [data-beam="${id}"] {
      position: relative;
      border-radius: ${n}px;
      overflow: hidden;
      isolation: isolate;
      --bb-strength: ${strength};
      animation: bb-spin-${id} ${duration}s linear infinite;
      animation-play-state: ${animPlayState};
    }
    @keyframes bb-spin-${id} {
      to { --bb-angle-${id}: 360deg; }
    }

    /* ::after — the bright stroke (z 2) */
    [data-beam="${id}"]::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: ${v}px;
      padding: ${r}px;
      clip-path: inset(0 round ${n}px);
      background: ${E_inner}, ${ringBg};
      -webkit-mask:
        ${STROKE_MASK},
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);
              mask:
        ${STROKE_MASK},
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: source-in, xor;
              mask-composite: intersect, exclude;
      pointer-events: none;
      z-index: 2;
      opacity: ${afterOpacity};
      transition: ${beamOpacityTransition};
    }

    /* ::before — the warm halo / inner glow (z 1) */
    [data-beam="${id}"]::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: ${n}px;
      background: ${haloBg};
      box-shadow: inset 0 0 9px 1px ${INNER_SHADOW};
      -webkit-mask-image:
        ${STROKE_MASK},
        linear-gradient(white, transparent 28px, transparent calc(100% - 28px), white),
        linear-gradient(to right, white, transparent 28px, transparent calc(100% - 28px), white);
      -webkit-mask-composite: source-in, source-over;
      mask-image:
        ${STROKE_MASK},
        linear-gradient(white, transparent 28px, transparent calc(100% - 28px), white),
        linear-gradient(to right, white, transparent 28px, transparent calc(100% - 28px), white);
      mask-composite: intersect, add;
      pointer-events: none;
      z-index: 1;
      opacity: ${beforeOpacity};
      transition: ${beamOpacityTransition};
      clip-path: inset(0 round ${n}px);
    }

    /* Bloom div — diffuse halo (z 3) */
    [data-beam="${id}"] [data-beam-bloom] {
      position: absolute;
      inset: 0;
      border-radius: ${v}px;
      clip-path: inset(0 round ${n}px);
      background: ${C_bloom}, ${bloomBg};
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask-composite: exclude;
      padding: ${r}px;
      filter: blur(8px) brightness(1.3) saturate(1.2);
      pointer-events: none;
      z-index: 3;
      opacity: ${bloomOpacity};
      transition: ${beamOpacityTransition};
    }

    @media (prefers-reduced-motion: reduce) {
      [data-beam="${id}"] { animation: none; }
    }
  `

  return (
    <div data-beam={id} className={className}>
      <style>{css}</style>
      {children}
      <div data-beam-bloom aria-hidden />
    </div>
  )
}

export default BorderBeam
