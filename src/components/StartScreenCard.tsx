/**
 * StartScreenCard — "black modal" skin for the StartScreen surface.
 *
 * Design source: UI Experiment #01 by Sebastiano Guerriero
 * (https://lab01.dev/#ui-experiment-1, dark theme). The user asked for
 * "the black modal with the top-left and bottom-right border light
 * effects, and the repeated pattern on the black to make it stand out".
 *
 * We can't restyle AuthShell's shared `.glass-3` card directly — that
 * surface is reused by ConnectScreen and every other pre-editor phase,
 * and AuthShell.test.tsx asserts on the `.glass-3` class. So this
 * component paints the black-modal treatment as layers that overlay the
 * host card. It renders inside StartScreen (which lives in the card's
 * `p-10` content area), then:
 *
 *   • surface + pattern  BLEED out to fill the whole card. The card is
 *     `overflow-hidden`, so a generously-oversized flat fill clips cleanly
 *     to the card's rounded rectangle — the entire interior reads black.
 *   • ring + corner blooms are positioned in CARD-SPACE via a measured
 *     rect of the nearest `.glass-3` ancestor, so the top-left /
 *     bottom-right corner lights and the masked border ring land exactly
 *     on the card's visible corners (they can't be corner-anchored to the
 *     oversized bleed box — that box's corners sit outside the card and
 *     would be clipped away).
 *
 * The four layers faithfully reproduce the experiment's dark theme:
 *   1. surface — near-black fill (experiment: hsl(from #111 h s l / .85)).
 *   2. pattern — the "repeated pattern": a fine diagonal hairline hatch +
 *      sparse dot matrix at ≤4% white so the black reads as textured.
 *      (Experiment used an SVG feTurbulence noise; a pure-CSS repeating
 *      pattern matches the user's explicit "repeated pattern" wording.)
 *   3. blooms — the corner LIGHTS (experiment `.light`: white circle,
 *      blur(150px), mix-blend-mode:overlay, top-left + bottom-right).
 *   4. border — the corner BORDER light (experiment `.container::after`:
 *      1.25px border, 160deg white→~0→faint gradient, revealed as a ring
 *      via mask + mask-composite:exclude). Verbatim dark-theme stops.
 */

import { useLayoutEffect, useRef, useState } from 'react'

interface Props {
  /** Corner radius of the host card — keep in sync with AuthShell (28). */
  radius?: number
}

// AuthShell card padding is `p-10` = 40px on every side. StartScreen renders
// inside that padding, so its content-box sits 40px in from the card edge on
// the left/right/bottom. (The TOP distance also includes the brand mark +
// eyebrow, which is why we measure the card rather than assume it.)
const CARD_PADDING = 40

interface CardRect {
  /** Offsets, in StartScreen-content-box space, of the card's four visible
   *  edges. left/right/bottom are the padding (40); top is measured. */
  top: number
  left: number
  right: number
  bottom: number
}

export default function StartScreenCard({ radius = 28 }: Props) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<CardRect | null>(null)

  // Measure the host `.glass-3` card so the ring + blooms can be placed in
  // card-space. left/right/bottom are known (p-10 = 40); we only need the
  // TOP offset (content-box top → card outer top), which varies with the
  // brand-mark canvas height, so we read it from the DOM.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const card = anchor.closest('.glass-3') as HTMLElement | null

    const measure = () => {
      if (!card) return
      const cb = card.getBoundingClientRect()
      const ab = anchor.getBoundingClientRect()
      // `anchor` is a zero-size marker at StartScreen's content-box top-left.
      // Distance from there UP to the card's outer top edge:
      const top = ab.top - cb.top
      setRect({ top, left: CARD_PADDING, right: CARD_PADDING, bottom: CARD_PADDING })
    }

    measure()
    // Re-measure on card resize (HeightTransition animates the card height,
    // and the brand-mark canvas can lay out a frame late). ResizeObserver is
    // absent in some test/jsdom environments — degrade gracefully to the
    // single synchronous measurement above.
    if (typeof ResizeObserver === 'undefined' || !card) return
    const ro = new ResizeObserver(measure)
    ro.observe(card)
    return () => ro.disconnect()
  }, [])

  // ── Layer 1+2: surface + pattern, bleeding to fill the whole card ──────
  // Oversized so it always covers the card top regardless of brand-mark
  // height; the card's `overflow-hidden` clips the flat fill seamlessly.
  const bleed = `-240px -${CARD_PADDING}px -${CARD_PADDING}px`

  return (
    <>
      {/* Zero-size anchor at StartScreen's content-box top-left, used to
          measure the card rect in card-space. */}
      <div ref={anchorRef} className="absolute left-0 top-0 h-0 w-0" aria-hidden />

      {/* Surface + pattern (bleeds; clipped to the card). */}
      <div
        aria-hidden
        className="pointer-events-none absolute z-0 overflow-hidden"
        style={{ inset: bleed }}
      >
        {/* 1. surface — opaque near-black fill (overrides the grey glass). */}
        <div className="absolute inset-0" style={{ background: '#0b0b0c' }} />

        {/* 2. pattern — diagonal hairline hatch + sparse dot matrix. */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: [
              'repeating-linear-gradient(45deg, rgba(255,255,255,0.028) 0, rgba(255,255,255,0.028) 0.5px, transparent 0.5px, transparent 7px)',
              'repeating-linear-gradient(-45deg, rgba(255,255,255,0.018) 0, rgba(255,255,255,0.018) 0.5px, transparent 0.5px, transparent 7px)',
              'radial-gradient(rgba(255,255,255,0.04) 0.6px, transparent 0.7px)',
            ].join(', '),
            backgroundSize: 'auto, auto, 24px 24px',
          }}
        />
      </div>

      {/* Ring + blooms in CARD-SPACE. Rendered only once the card rect is
          measured so the corner lights land on the card's real corners. */}
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-0 overflow-hidden"
          style={{
            top: -rect.top,
            left: -rect.left,
            right: -rect.right,
            bottom: -rect.bottom,
            borderRadius: radius,
          }}
        >
          {/* 3. blooms — corner LIGHTS (verbatim technique: white circle,
              heavy blur, overlay blend → glow, not a flat blob). */}
          <div
            className="absolute rounded-full"
            style={{
              width: 260,
              height: 260,
              top: -80,
              left: -40,
              background: '#ffffff',
              filter: 'blur(130px)',
              mixBlendMode: 'overlay',
              opacity: 0.95,
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              width: 260,
              height: 260,
              bottom: -90,
              right: -60,
              background: '#ffffff',
              filter: 'blur(130px)',
              mixBlendMode: 'overlay',
              opacity: 0.85,
            }}
          />

          {/* 4. border — masked corner-light ring (verbatim dark-theme
              gradient from `.container::after`). */}
          <div
            className="absolute inset-0"
            style={{
              borderRadius: radius,
              padding: 1.25,
              background:
                'linear-gradient(160deg, rgba(255,255,255,0.30), rgba(255,255,255,0.02) 37%, rgba(255,255,255,0.05) 70%, rgba(255,255,255,0.10))',
              WebkitMask:
                'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              WebkitMaskComposite: 'xor',
              mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              maskComposite: 'exclude',
            }}
          />
        </div>
      )}
    </>
  )
}
