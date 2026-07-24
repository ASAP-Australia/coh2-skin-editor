/**
 * StartScreenCard — "black modal" skin for the StartScreen surface.
 *
 * Design source: UI Experiment #01 by Sebastiano Guerriero
 * (https://lab01.dev/experiments/01/, dark theme). The user asked for
 * "the black modal with the top-left and bottom-right border light
 * effects, and the repeated pattern on the black to make it stand out" —
 * and, critically, that the pattern be THE ACTUAL grain the site renders,
 * not a CSS hatch/dot approximation.
 *
 * ── The three effects, mapped verbatim to the site ───────────────────────
 * Extracted from experiments/01/assets/css/experiment-01.css + index.html:
 *
 *   1. surface  — near-black fill. Site: `.container { background:
 *      hsl(from #111111 h s l / .85) }` over a lit bg image. We have no lit
 *      image behind us (near-black shader), so we fill an opaque near-black.
 *
 *   2. pattern  — the site's `.bg-noise` grain, NOT a hatch. Site markup:
 *        <figure class="bg-noise"><svg><filter id="noise-bg-fx">
 *          <feTurbulence baseFrequency="0.8" /></filter></svg></figure>
 *        .bg-noise { filter: url(#noise-bg-fx) grayscale(100%);
 *                    mix-blend-mode: screen; opacity: .1 (dark theme); }
 *      We ship that EXACT pipeline baked into a self-contained tiling SVG
 *      (public/textures/bg-noise.svg — feTurbulence baseFrequency 0.8 +
 *      saturate 0 + stitchTiles) and apply it with the site's screen blend
 *      and .1 opacity. This gives the identical organic film-grain the site
 *      renders, without a live CSS filter competing with the Three.js
 *      compositor. (Earlier revision used a repeating-linear-gradient hatch
 *      — the user compared them side by side and rejected it.)
 *
 *   3a/3b. blooms — the corner LIGHTS. Site: `.light { background: white;
 *      196×196px; border-radius:50%; blur(150px); mix-blend-mode:overlay }`
 *      positioned mostly OUTSIDE the card at top-left (t:-15 l:14) and
 *      bottom-right (b:-50 r:-30). Overlay-of-white barely reads on our
 *      near-black (the site's blooms read because their card sits over a
 *      LIT bg image); so we bake the same soft corner glow as a radial
 *      gradient and screen-blend it, which reproduces the *visible result*
 *      (a bright soft bloom pooling into each corner) on a dark ground.
 *
 *   4. border  — the masked corner-light ring. Site: `.container::after`
 *      is a 1.25px transparent border revealed as a ring via
 *      mask-composite:exclude, filled (dark theme) with
 *        linear-gradient(160deg, white/.30, white/.02 37%,
 *                                white/.05 70%, white/.10) border-box.
 *      Reproduced verbatim below.
 *
 * ── Why a portal ─────────────────────────────────────────────────────────
 * The card content sits inside AuthShell's <HeightTransition> (overflow:
 * clip) and below the wordmark, so an in-content overlay measured against
 * the card got clipped and mis-anchored (top-left glow landed above the
 * visible card). The robust fix locates the `.glass-3` card element
 * (position:relative + overflow:hidden) and PORTALs the effect layers in as
 * its direct children pinned to inset:0. The layers fill the ENTIRE card in
 * the card's own coordinate space; the card's overflow:hidden clips the
 * ring + blooms to the rounded rectangle for free (no radius math, no
 * ResizeObserver). They sit at z-0; StartScreen lifts interactive content to
 * z-10 and AuthShell lifts the wordmark/eyebrow to z-index:1, so the black
 * modal reads behind everything.
 */

import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * NOISE_SVG — the site's `.bg-noise` grain, verbatim, as an inline
 * data:image/svg+xml URI. This is UI Experiment #01's exact recipe:
 *   <filter><feTurbulence baseFrequency="0.8"/></filter> + grayscale.
 * A feComponentTransfer stretches the mid-gray turbulence toward the
 * highlights so the grain reads on our near-black ground (the site's grain
 * reads at .1 opacity only because its card sits over a lit bg image); the
 * feTurbulence(0.8) grain SHAPE is unchanged. `stitchTiles="stitch"` makes
 * the 180×180 tile repeat seamlessly. Inlined (not a /textures/*.svg file)
 * so it resolves under the packaged app's file:// origin, where an absolute
 * path would 404. The `#` in url(#n) is encoded as %23; quotes use single so
 * the whole thing sits inside a double-quoted CSS url("...").
 */
const NOISE_SVG =
  "data:image/svg+xml," +
  "%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E" +
  "%3Cfilter id='n' x='0' y='0' width='100%25' height='100%25'%3E" +
  "%3CfeTurbulence type='turbulence' baseFrequency='0.8' numOctaves='1' stitchTiles='stitch' result='t'/%3E" +
  "%3CfeColorMatrix in='t' type='saturate' values='0' result='g'/%3E" +
  "%3CfeComponentTransfer in='g'%3E" +
  "%3CfeFuncR type='linear' slope='2.2' intercept='-0.3'/%3E" +
  "%3CfeFuncG type='linear' slope='2.2' intercept='-0.3'/%3E" +
  "%3CfeFuncB type='linear' slope='2.2' intercept='-0.3'/%3E" +
  "%3C/feComponentTransfer%3E%3C/filter%3E" +
  "%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E"

interface Props {
  /** Corner radius of the host card — keep in sync with AuthShell (28). */
  radius?: number
}

export default function StartScreenCard({ radius = 28 }: Props) {
  // The mount target is the `.glass-3` card element itself. We locate the
  // nearest `.glass-3` and portal the effect stack in as a direct child of
  // that card so it fills the whole card in card-space (clipped by the
  // card's own overflow:hidden). There is exactly one `.glass-3` card
  // mounted during the Start phase (AuthShell's shared surface).
  const [card, setCard] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const el = document.querySelector('.glass-3') as HTMLElement | null
    setCard(el)
  }, [])

  if (!card) return null

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{ borderRadius: radius, overflow: 'hidden' }}
    >
      {/* 1. surface — opaque near-black fill (site: hsl(from #111 h s l / .85)
          over a lit image; we have no lit image, so fill opaque near-black
          so the whole card interior reads black — the ground the grain and
          blooms need). */}
      <div className="absolute inset-0" style={{ background: '#0b0b0c' }} />

      {/* 2. pattern — the site's ACTUAL `.bg-noise` grain: feTurbulence
          baseFrequency 0.8 + grayscale, inlined as a self-contained
          data:image/svg+xml URI (see NOISE_SVG below). A data-URI is used
          rather than a /textures/*.svg file because the packaged app loads
          over file://, where an absolute "/textures/..." path resolves to the
          filesystem root and 404s — the data-URI works identically under
          file:// and http://. The tile repeats; feTurbulence stitchTiles keeps
          it seamless. Applied with the site's screen blend; opacity is lifted
          above the site's .1 because our card sits on a near-black shader
          (the site's .1 reads because its card sits over a LIT bg image). */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${NOISE_SVG}")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '180px 180px',
          mixBlendMode: 'screen',
          opacity: 0.55,
        }}
      />

      {/* 3a. bloom — TOP-LEFT corner light. The site's `.light` is a white
          196px circle, blur(150px), overlay-blended, anchored just outside
          the top-left corner. We bake the same soft glow as a radial gradient
          (no runtime blur() — it runs beside a live Three.js viewport) and
          screen-blend it so the bright bloom pools into the corner on the
          dark ground. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(48% 46% at 4% 2%, rgba(255,255,255,0.42), rgba(255,255,255,0.14) 34%, rgba(255,255,255,0.03) 55%, transparent 72%)',
          mixBlendMode: 'screen',
        }}
      />

      {/* 3b. bloom — BOTTOM-RIGHT corner light (site anchors it further off
          the corner: b:-50 r:-30 → a slightly wider, softer pool). */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(52% 50% at 98% 100%, rgba(255,255,255,0.34), rgba(255,255,255,0.10) 36%, rgba(255,255,255,0.02) 58%, transparent 74%)',
          mixBlendMode: 'screen',
        }}
      />

      {/* 4. border — masked corner-light ring, verbatim dark-theme gradient
          from the site's `.container::after`:
            linear-gradient(160deg, white/.30, white/.02 37%,
                                    white/.05 70%, white/.10)
          A 1.25px border revealed as a ring by masking out the interior
          (mask-composite:exclude). Catches a bright glint at the top-left,
          fades along the edges, and picks back up at the bottom-right. */}
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
    </div>,
    card,
  )
}
