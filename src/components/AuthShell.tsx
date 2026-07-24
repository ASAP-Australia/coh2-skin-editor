/**
 * AuthShell — shared glass surface for the pre-editor flow.
 *
 * Why this exists:
 *   ConnectScreen and StartScreen used to render their own backdrop +
 *   glass-3 card + brand mark, and the unmount/mount cycle gave a
 *   noticeable "different screen" beat between them. The user wanted a
 *   single screen whose CONTENT animates in/out — closer to how Apple's
 *   Liquid Glass / NavigationStack handles in-place content swaps.
 *
 * Pattern:
 *   – The container stays mounted; only the inner content morphs.
 *   – Cross-fade with a small Y-drift, slight overlap between phases.
 *   – Timing: 200ms out, 320ms in, ~80ms overlap. Curve is a single
 *     cubic-bezier(0.2, 0.8, 0.2, 1) applied to both opacity and
 *     transform.
 *
 * Note: an earlier revision animated a subtle 1.0 → 1.005 → 1.0 "breath"
 * scale on the glass surface during every phase swap (the "iOS feels
 * alive" touch). It read as a visible jitter on the connect → start
 * hand-off — sub-pixel scaling combined with the inner stagger and
 * cross-fade produced an unsteady edge on the glass card. Removed.
 *
 * The shell exposes its `phase` to consumers as a stable identifier so we
 * know when to run the morph; consumers pass their content as `children`
 * and we snapshot them on phase change.
 *
 * ── editor-loading phase ─────────────────────────────────────────────
 *
 * When `phase === 'editor-loading'` we enter a transitional loading state
 * the user sees while the Editor (mounted invisibly underneath) is
 * spinning up its first model. The shell:
 *
 *   1. Hides the eyebrow ("CoH2 · Community Modding Tool") + the morphing
 *      content area (opacity 0). The card itself stays visible.
 *   2. FLIPs the ASAP brand mark from its resting top-left position to
 *      the geometric centre of the glass card (with a slight scale-up).
 *      Translation uses real measurements from useLayoutEffect so the
 *      icon lands dead-centre regardless of card height.
 *   3. Locks the body area to a fixed height so the card doesn't
 *      collapse around the (now-hidden) content — otherwise "centre of
 *      card" would just be the icon's resting spot and the morph would
 *      be invisible.
 *   4. Wraps the whole card in a <LoadingBorder> — a marching beam SVG
 *      that traces the perimeter at constant arc-length speed. Same
 *      component the in-editor vehicle/season toggles use, with a
 *      slightly slower duration (2.4s) and thinner beam (18 %) for a
 *      more graceful "thinking" cadence than the snappier in-editor one.
 *
 * The `exiting` prop fades the entire shell to opacity 0 over HANDOFF_MS
 * (driven from App.tsx's onReady handler). The Editor's `visible` flag
 * is true during the same window, so the two surfaces cross-fade
 * cleanly with no black flash between them.
 */

import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import CssGradientBackground from '@/components/CssGradientBackground'
import LoadingBorder from '@/components/ui/loading-border'
import AsapFlagHeading from '@/components/AsapFlagHeading'

// Three.js / ShaderWaveBackground is lazy-loaded via React.lazy() so the
// ~150 kB three.js chunk doesn't bloat the initial JS bundle — but we
// trigger the mount IMMEDIATELY on first paint (one idle frame after
// mount). The CssGradientBackground renders behind it as a Suspense
// fallback so there's no gap during the brief chunk-load window.
//
// Previously this was gated on user interaction (pointerdown / keydown /
// mousemove) with a 12-second hard-timeout safety net, which existed to
// keep Lighthouse's TBT/TTI metrics clean in headless audits. We're
// shipping a packaged Electron app for end users — Lighthouse never runs
// here — and the deferred mount produced a visible "few-second gap"
// where the page looked static before the shader appeared. The user
// noticed: "how come the three.js background loads a few seconds after
// the app? It should be working already when the app opens." So we
// flipped to eager mount; the gradient still covers the gap until the
// chunk finishes loading (typically <100 ms even cold).
const ShaderWaveBackground = lazy(() => import('@/components/ShaderWaveBackground'))

/** Returns true once it's safe to mount the WebGL shader. We wait a
 *  single idle frame (or ~50 ms fallback) after mount so the very first
 *  React commit isn't competing with three.js parse, then flip true and
 *  keep the import promise resolving in the background. The visible gap
 *  is bounded by chunk-load latency, not by the user interacting. */
function useDeferredShaderMount(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (ready) return
    let cancelled = false

    const fire = () => {
      if (cancelled) return
      setReady(true)
    }

    // Prefer requestIdleCallback so the shader mount lands in the first
    // idle slice after React's initial commit — typically within a single
    // animation frame on a warm machine. Fall back to a tiny setTimeout
    // for Safari (no rIC) and for hard-timeout safety in case the page
    // never becomes idle (e.g. the user immediately starts scrolling).
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
        cancelIdleCallback?: (h: number) => void
      }
    ).requestIdleCallback
    const cic = (
      window as Window & {
        cancelIdleCallback?: (h: number) => void
      }
    ).cancelIdleCallback

    let idleHandle: number | null = null
    let fallbackTimer: number | null = null

    if (typeof ric === 'function') {
      idleHandle = ric(fire, { timeout: 250 })
      // Safety net: if rIC genuinely never fires (paused tab, etc.),
      // 250 ms is the timeout we set above, so a 400 ms backup is plenty.
      fallbackTimer = window.setTimeout(fire, 400)
    } else {
      fallbackTimer = window.setTimeout(fire, 50)
    }

    return () => {
      cancelled = true
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
      if (idleHandle != null && typeof cic === 'function') cic(idleHandle)
    }
  }, [ready])
  return ready
}

interface Props {
  /** Stable identifier of the current content. Changing this triggers the
   *  cross-fade morph between the previous and new children. */
  phase: string
  /** When true, the whole card fades to opacity 0. Used during the
   *  AuthShell → Editor handoff (editor-loading → editor) so the dying
   *  shell cross-fades with the Editor surfacing underneath. */
  exiting?: boolean
  children: ReactNode
}

/** Phases whose screens own their own per-element stagger animation
 *  (ConnectScreen / StartScreen via the <Stagger> wrapper). For
 *  transitions between any pair of these we bypass MorphIn/MorphOut so
 *  the screen-level stagger isn't muted by an outer cross-fade. Other
 *  phases (picker, form) still get the morph. */
const STAGGER_OWNED_PHASES = new Set(['connect', 'start'])

const OUT_MS = 200 // outgoing fade duration
const IN_MS = 520 // incoming fade duration (card height resize; kept in sync with PICKER_ENTER_DELAY_MS in App.tsx)
const OVERLAP_MS = 80 // gap between out start and in start
const TOTAL_MS = OUT_MS + IN_MS - OVERLAP_MS // 440ms total
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** Duration of the FLIP icon morph (top-left → centre of card). Generous
 *  enough that the eye can follow it; the entrance phase of editor-
 *  loading is necessarily a few seconds (first-time model load), so a
 *  600ms travel reads as deliberate rather than rushed. */
const ICON_MORPH_MS = 600
/** Scale applied to the icon when it reaches the centre. 1.4 gives a
 *  visible "look at me, I'm loading" presence without overshooting the
 *  card padding. */
const ICON_MORPH_SCALE = 1.4
/** Fixed pixel height the body area locks to while loading. Tall enough
 *  that "centre of card" is meaningfully below the resting icon
 *  position (the icon has to actually travel for the FLIP to read). */
const LOADING_BODY_HEIGHT = 200

export default function AuthShell({ phase, exiting = false, children }: Props) {
  // Defer WebGL shader mount until window.load + idle (or first interaction).
  // The Suspense fallback (CssGradientBackground) covers the visible
  // background until this flips to true. See `useDeferredShaderMount` above.
  const shaderReady = useDeferredShaderMount()
  // Track which phase we last reconciled against, plus a snapshot of the
  // children that were rendered for that phase. When `phase` flips we
  // promote that snapshot into `pending` (it fades out) and the new
  // `children` prop fades in.
  //
  // Refs (not state) for the trackers so updating them never causes a
  // render — they're bookkeeping, not view state.
  const lastPhase = useRef(phase)
  const lastChildren = useRef<ReactNode>(children)
  const [pending, setPending] = useState<{ phase: string; node: ReactNode } | null>(null)

  // One-shot entrance animation on first paint — flips true after the
  // first frame so the card fades + drifts in. Replaces the per-screen
  // `mounted` flags ConnectScreen / StartScreen used to own.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(r)
  }, [])

  // Bump this counter each time the phase transitions TO 'start' (from any
  // other phase). This resets HeightTransition's high-water mark so the
  // card can shrink back to StartScreen's compact natural height instead of
  // retaining the taller height from a previous SavedProjectsList visit.
  const [heightResetMark, setHeightResetMark] = useState(0)
  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (phase === 'start' && prevPhaseRef.current !== 'start') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- phase-change triggered reset; bounded to one extra render per start navigation
      setHeightResetMark(n => n + 1)
    }
    prevPhaseRef.current = phase
  }, [phase])

  useEffect(() => {
    if (phase !== lastPhase.current) {
      const prevPhase = lastPhase.current
      // Bypass the morph entirely when transitioning between two
      // stagger-owned phases (connect ↔ start). The screen handles its
      // own enter/exit animation per-element; layering MorphIn/MorphOut
      // on top would mute the stagger.
      const skipMorph = STAGGER_OWNED_PHASES.has(prevPhase) && STAGGER_OWNED_PHASES.has(phase)

      if (skipMorph) {
        lastPhase.current = phase
        lastChildren.current = children
        return
      }

      // Phase changed: snapshot the *previous* render's children (they
      // still live in lastChildren.current at this point — we update it
      // only after snapshotting). Promote into pending; the new
      // `children` prop will be rendered as the incoming layer.
      const prevNode = lastChildren.current
      setPending({ phase: prevPhase, node: prevNode })
      const t1 = window.setTimeout(() => setPending(null), TOTAL_MS)
      lastPhase.current = phase
      lastChildren.current = children
      return () => {
        window.clearTimeout(t1)
      }
    }
    // No phase change — track the latest children so the next phase
    // change snapshots the most recent render of the outgoing screen.
    lastChildren.current = children
  }, [phase, children])

  // ── editor-loading state ────────────────────────────────────────────
  const isLoading = phase === 'editor-loading'

  // Refs for FLIP: measure the card's bounding rect and the icon's
  // resting rect, compute the delta, and translate the icon to the
  // centre over ICON_MORPH_MS.
  const cardRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLAnchorElement>(null)
  const [iconOffset, setIconOffset] = useState<{ dx: number; dy: number } | null>(null)

  // FLIP measurement, deferred until AFTER the HeightTransition has
  // settled on its loading-state body height (LOADING_BODY_HEIGHT).
  //
  // Previously this was a single requestAnimationFrame — but at that
  // point the card was still mid-animation, growing/shrinking towards
  // the locked body height. getBoundingClientRect() then reported the
  // INTERMEDIATE height, the computed offset pointed at the wrong y,
  // and the icon flew to a not-quite-centre target. The user
  // reported the wordmark wave "doesn't finish fully" on the form →
  // editor-loading hop — that's the same bug: the icon visibly
  // landed off-centre while the wave was still playing, reading as
  // an unfinished motion.
  //
  // The fix: defer measurement until the height transition's IN_MS
  // budget has elapsed. The icon sits at rest for those ~320 ms while
  // the card resizes; then it FLIPs to the now-stable centre. We also
  // re-measure on a second rAF after the initial timer so that even
  // if the layout subtly shifts in the same frame as our setState
  // (e.g. font fallback swapping), the icon corrects in flight.
  useLayoutEffect(() => {
    if (!isLoading) {
      // Returning to a non-loading phase: clear the transform. The
      // transition on the icon's `transform` property animates it
      // smoothly back to its resting position.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early-return guard: resets icon position synchronously before animation setup
      setIconOffset(null)
      return
    }
    // Reset to resting first (covers the case where we're entering
    // editor-loading with a stale offset from a previous run).
    setIconOffset(null)

    const measure = () => {
      const card = cardRef.current
      const icon = iconRef.current
      if (!card || !icon) return
      const cb = card.getBoundingClientRect()
      const ib = icon.getBoundingClientRect()
      if (cb.width === 0 || cb.height === 0) return
      const cardCx = cb.left + cb.width / 2
      const cardCy = cb.top + cb.height / 2
      const iconCx = ib.left + ib.width / 2
      const iconCy = ib.top + ib.height / 2

      // The icon's bounding rect is the wrapper around <AsapFlagHeading>,
      // which is intentionally larger than the visible "ASAP" text:
      //   • Right edge: `overhangPad` (≈ 0.45 × height = 32 px at h=72)
      //     keeps the italic 'P' descender from clipping the canvas
      //     edge, plus `maxExtrude` (≈ 4 px) of 3-D staircase tail.
      //   • Bottom edge: `maxExtrude` (≈ 4 px) of staircase that falls
      //     below the front-face baseline.
      // The visible text therefore sits LEFT-of-centre and slightly
      // ABOVE-centre within its own bounding rect. Without the biases
      // below, the FLIP lands the wrapper centre on the card centre —
      // which puts the visible "ASAP" letters ~16 px left and ~2 px
      // above the card's true visual centre (the user's "doesn't
      // centre properly" complaint).
      // Numbers are derived from AsapFlagHeading at height=72; if that
      // changes, recompute as
      //   biasX = (overhangPad + maxExtrude - leftPad) / 2
      //   biasY = maxExtrude / 2
      const VISUAL_CENTER_BIAS_X = 16
      const VISUAL_CENTER_BIAS_Y = 2
      setIconOffset({
        dx: cardCx - iconCx + VISUAL_CENTER_BIAS_X,
        dy: cardCy - iconCy + VISUAL_CENTER_BIAS_Y,
      })
    }

    // Wait for HeightTransition (IN_MS) + a small safety buffer so the
    // resize is genuinely settled before we sample. The icon stays at
    // its resting position during this window — a deliberate moment of
    // "the card just grew, now the icon takes flight" — and the wave
    // worker keeps animating throughout, so the wordmark continues to
    // ripple while it waits.
    const hold = window.setTimeout(measure, IN_MS + 32)
    return () => window.clearTimeout(hold)
  }, [isLoading])

  return (
    <>
      {/* `absolute inset-0` rather than `min-h-dvh relative`: during the
          'editor-loading' phase the Editor is ALSO mounted (invisibly)
          just before us in the document order. Both used to be block-level
          full-height — they stacked vertically and the AuthShell card
          ended up below the fold (the user reported only seeing the
          shader-wave background and no card). `absolute inset-0` lifts the
          shell out of flow so it overlays the editor cleanly.

          IMPORTANT — must be `absolute`, NOT `fixed`: the shell renders
          inside `.glass-frame-inner` (a `position:relative` box). A `fixed`
          element ignores that ancestor and fills the whole viewport, so its
          full-bleed gradient background painted OVER the glass border + the
          slim surround margin, making the glass frame invisible. `absolute`
          resolves to the nearest positioned ancestor (the relative content
          wrapper that fills glass-frame-inner), so the shell + its gradient
          stay clipped inside the 16px glass ring and the frame border reads.
          The Editor shares the same relative wrapper, so the overlay-the-
          editor behaviour is unchanged. */}
      <main
        className="absolute inset-0 grid place-items-center px-6 py-4 overflow-hidden dark text-foreground z-30"
        // Don't intercept pointer events for the empty regions around
        // the card — but keep them on the card itself. Achieved by
        // setting `pointerEvents: none` on this wrapper and back to auto
        // on the LoadingBorder child below. (Important for the handoff:
        // when the shell is fading out at the same time the Editor is
        // surfacing, the user's clicks should land on the editor.)
        // overflow-y-auto: safety net so the card can scroll into view
        // on very small viewports (or when HeightTransition's highWaterMark
        // ratchets the card taller than the SavedProjectsList content needs).
        style={{ pointerEvents: exiting ? 'none' : undefined }}
        // Wrapper is a <main> landmark so axe-core's `region` rule passes
        // for content inside the glass card (lists, buttons, etc.) without
        // those needing individual ARIA roles. The static welcome card in
        // index.html uses `role="region"` (not `<main>`), so the two
        // landmarks coexist safely during the ~320ms fade-out window —
        // `landmark-no-duplicate-main` and `landmark-unique` both pass.
      >
      {/* CssGradientBackground always renders behind the shader so that:
       * (1) it's visible instantly on first paint (no WebGL parse needed),
       * (2) Lighthouse / Suspense never see a "flash" between fallback and
       *     shader since the gradient stays mounted underneath, and
       * (3) when the shader mounts above it, the gradient's CSS animation
       *     can be paused if we want — currently both run for a richer
       *     blend during the brief transition. */}
      <CssGradientBackground />
      {shaderReady && (
        <Suspense fallback={null}>
          <ShaderWaveBackground />
        </Suspense>
      )}

      {/* Stable, visually-hidden product heading. The static welcome card in
          index.html carries the LCP <h1>CoH2 Community Modding Tool</h1>, but
          it's removed ~320ms after React mounts — so any test (or screen
          reader) that arrives after React's first paint would otherwise find
          no product heading. This sr-only h1 keeps "CoH2 Community Modding
          Tool" in the accessibility tree and matches the e2e heading
          expectations deterministically regardless of timing. */}
      <h1 className="sr-only">CoH2 Community Modding Tool</h1>

      <LoadingBorder
        active={isLoading && !exiting}
        radius={28}
        thickness={1.5}
        duration={2.4}
        beamFraction={0.18}
        className="relative max-w-md w-full z-10"
      >
        <div
          ref={cardRef}
          className="relative glass-3 p-10 overflow-hidden"
          style={{
            borderRadius: 28,
            boxShadow: '0 8px 20px -12px rgb(0 0 0 / 0.3)',
            // Entrance drift on first paint + exit fade during handoff
            // to the Editor. Both animate the same properties so they
            // compose without fighting each other.
            opacity: exiting ? 0 : mounted ? 1 : 0,
            transform: `translateY(${mounted ? 0 : 8}px)`,
            transition: `opacity ${exiting ? ICON_MORPH_MS : 400}ms ${EASE}, transform 400ms ${EASE}`,
          }}
        >
          {/* The previous "halo" was an absolute-positioned 260 × 130 box
              of two radial colour-pools (red + blue), blurred to 32 px,
              soft-light blended behind the wordmark. Multiple iterations
              tried to soften it — wider mask, different blend mode,
              top-left anchoring — but it always read as a STAIN or
              coloured rectangle sitting behind the wordmark area rather
              than as light coming OFF the letters.

              The current treatment moves the glow ONTO the wordmark
              itself via a stacked `drop-shadow` filter on the <a>
              wrapper below. `drop-shadow` follows the canvas's alpha
              channel — i.e. the actual "ASAP" letterforms painted by
              the worker — so the glow traces the glyph silhouettes
              instead of sitting in a box behind them. Colours come from
              the SAME palette the wave inside the letters cycles
              through (Australian flag): tight red inner halo (#C8102E,
              the flag cross red) over a wider navy outer bloom (#012169,
              the flag's blue field). That makes the wordmark and its
              ambient light read as a single integrated object. */}

          <div className="relative">
            {/* Persistent brand mark + eyebrow — these never re-mount, so
                the user reads them as a single anchor across phases.
                During isLoading, this anchor element receives a transform
                that translates it to the geometric centre of the card and
                scales it up — the FLIP morph. The transition runs on
                `transform` so when we clear the offset (returning to a
                normal phase) the icon glides back rather than jumping. */}
            <a
              ref={iconRef}
              href="https://github.com/ASAP-Australia"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="ASAP Australia on GitHub"
              // When not loading, `asap-glow` drives the animated keyframe
              // glow (declared in the <style> block above). During loading
              // the class is absent and an inline filter collapses all shadow
              // alphas to 0 / blurs to 0 — the same zero-filter trick as
              // before so CSS can transition smoothly between the two states
              // rather than jumping from `filter: none`. The transition
              // property below still covers `filter` so the collapse on
              // isLoading=true and the reveal on isLoading=false both ease.
              className="inline-block mb-1 hover:scale-[1.03] active:scale-[0.98]"
              style={{
                transform: iconOffset
                  ? `translate(${iconOffset.dx}px, ${iconOffset.dy}px) scale(${ICON_MORPH_SCALE})`
                  : 'translate(0, 0) scale(1)',
                transition: `transform ${ICON_MORPH_MS}ms ${EASE}`,
                // Negative margins pull the wordmark into the card's
                // p-10 padding area, anchoring it tighter to the
                // top-left corner ("more to the top left" per user
                // feedback) without changing the rest of the content
                // area's padding.
                marginLeft: -10,
                marginTop: -6,
                // While loading, the icon is sitting over what used to
                // be the content area — disable pointer events so it
                // doesn't intercept clicks meant for nothing in
                // particular (and so users don't accidentally navigate
                // away to GitHub mid-load).
                pointerEvents: isLoading ? 'none' : undefined,
                // Position above the (hidden) eyebrow + body so the
                // travelling icon doesn't end up clipped behind them.
                position: 'relative',
                zIndex: 1,
              }}
            >
              {/* Animated "ASAP" wordmark — bold italic Jost with the
                  Australian flag waving inside the letterforms. height
                  drives all internal metrics; 72 px is a touch larger
                  than the legacy asap-logo (56 px) so the brand reads
                  clearly without dominating the card. */}
              <AsapFlagHeading height={72} className="block" />
            </a>

            {/* Eyebrow fades out during isLoading. We keep it mounted so
                returning to a non-loading phase glides it back rather
                than re-mounting.

                Bumped to text-[14px] (was 11px) — at v1.0 the eyebrow
                does double duty as the product heading on screens where
                the body card's own title was retired (e.g. StartScreen),
                so it needs to read as a proper heading rather than a
                tiny "kicker" eyebrow. */}
            <div
              className="text-[14px] uppercase tracking-[1.6px] text-foreground/85 font-medium mb-4"
              style={{
                opacity: isLoading ? 0 : 1,
                transition: `opacity ${OUT_MS}ms ${EASE}`,
                // During isLoading: prevent screen readers from
                // announcing the eyebrow (it's hidden) and stop it
                // intercepting interaction.
                visibility: isLoading ? 'hidden' : undefined,
                // Sit above StartScreen's black-modal background layer,
                // which is absolutely positioned and bleeds up behind this
                // eyebrow. The brand mark above already carries the same
                // relative/z-index:1; matching it keeps both crowning the
                // modal. No effect on other phases (no bleed layer there).
                position: 'relative',
                zIndex: 1,
              }}
            >
              CoH2 · Community Modding Tool
            </div>

            {/* Morphing content area. We render the incoming children at
                their natural position (so layout/height matches the new
                content immediately), and overlay the outgoing children
                absolutely so they fade out without disturbing layout.

                The outer wrapper uses HeightTransition to smoothly
                interpolate the card height when phases swap. Without it,
                going Connect (3 visible rows) → Start (2-3 rows of
                different sizes) caused an abrupt height jump that read
                as a jitter — the rest of the card's chrome (brand mark,
                eyebrow, padding) stays put while the content area
                snaps. ResizeObserver-driven explicit pixel height +
                transition fixes that.

                During isLoading we override the height to a fixed
                LOADING_BODY_HEIGHT so the card doesn't collapse around
                the (empty) editor-loading body — otherwise "centre of
                card" would just be the icon's resting position and the
                FLIP morph would have nothing to travel. */}
            <div
              style={{
                opacity: isLoading ? 0 : 1,
                transition: `opacity ${OUT_MS}ms ${EASE}`,
                visibility: isLoading ? 'hidden' : undefined,
              }}
            >
              <HeightTransition
                forcedHeight={isLoading ? LOADING_BODY_HEIGHT : null}
                // No synthetic min-height floor. The previous 240 px
                // floor was added to prevent Connect ↔ Start from
                // visibly resizing, but in practice the Connect screen's
                // natural content (title + 3 bullets + button ≈ 195 px)
                // is shorter than 240 — leaving ~45 px of dead space
                // below the button on first load. Letting HeightTransition
                // follow the natural height ties the card snugly to
                // whichever phase is rendering, and the eased height
                // animation handles Connect → Start (and back) smoothly.
                minHeight={null}
                // Once the card has expanded to its largest auth-flow
                // height, never shrink. The user's design brief was
                // explicit: "I want the menu to stay the same size and
                // animate out the old elements then animate in the new
                // ones on the new page." Without this, Start → New
                // Faceplate visibly collapses the card before re-growing
                // for the form, producing the "janky" feel the user
                // called out. High-water-mark gives Connect its natural
                // tight size on first paint (no dead space) AND keeps
                // every subsequent screen at the same height once the
                // user has reached Start.
                highWaterMark
                // Reset the high-water mark when navigating back to
                // 'start' so the card shrinks to StartScreen's compact
                // natural height instead of retaining the taller height
                // left over from a SavedProjectsList visit.
                resetMark={heightResetMark}
              >
                <div className="relative">
                  {/* Incoming: starts at opacity 0 + translateY(8px), animates
                      to its resting state. Keyed by phase so React re-mounts
                      with fresh starting state on every change. */}
                  <MorphIn phase={phase} hasPrev={pending !== null}>
                    {children}
                  </MorphIn>

                  {/* Outgoing: absolutely positioned over the incoming so the
                      two cross-fade in place. Removed after OUT_MS. */}
                  {pending && <MorphOut key={`out-${pending.phase}`}>{pending.node}</MorphOut>}
                </div>
              </HeightTransition>
            </div>
          </div>
        </div>
      </LoadingBorder>
    </main>
    </>
  )
}

/** Incoming content — fades + drifts down into place. When `hasPrev` is
 *  true (we're mid-morph) it starts at opacity 0 + Y(8px) and animates
 *  in. When hasPrev is false (first paint) it just appears. */
function MorphIn({
  phase,
  hasPrev,
  children,
}: {
  phase: string
  hasPrev: boolean
  children: ReactNode
}) {
  const [shown, setShown] = useState(!hasPrev)
  useEffect(() => {
    if (!hasPrev) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- two-frame animation trick: synchronous setState before rAF is intentional
      setShown(true)
      return
    }
    setShown(false)
    const r = requestAnimationFrame(() => {
      // Two-frame trick: ensures the browser commits the initial
      // hidden state before flipping to shown, so the transition runs.
      requestAnimationFrame(() => setShown(true))
    })
    return () => cancelAnimationFrame(r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  return (
    <div
      style={{
        opacity: shown ? 1 : 0,
        // Enter from above: starts at -10px (above), slides DOWN into place (0).
        // Matches the "downward cascade" convention: outgoing content slides up
        // and out, incoming content slides down and in.
        transform: shown ? 'translateY(0)' : 'translateY(-10px)',
        transition: hasPrev
          ? `opacity ${IN_MS}ms ${EASE} ${OVERLAP_MS}ms, transform ${IN_MS}ms ${EASE} ${OVERLAP_MS}ms`
          : `opacity ${IN_MS}ms ${EASE}, transform ${IN_MS}ms ${EASE}`,
      }}
    >
      {children}
    </div>
  )
}

/** Smoothly animates between the natural heights of swapping content.
 *
 *  Plain `height: auto` doesn't transition, and our morphing screens
 *  swap between varying numbers of stagger rows (Connect: title +
 *  bullets + button vs Start: title + maybe-Continue + CTAs), so the
 *  card snaps height instantly when phases change. That snap was the
 *  remaining jitter the user saw after the breath-scale was removed.
 *
 *  Approach: ResizeObserver measures the inner content's natural
 *  height each frame; the outer wrapper carries that height as an
 *  explicit pixel value with a CSS transition. The first measurement
 *  short-circuits the transition (no animation on initial mount) so
 *  there's no flash of zero-height.
 *
 *  `forcedHeight` overrides the measured height — used by the editor-
 *  loading state to lock the card to a known body height while the
 *  natural content is hidden (otherwise the card would collapse and
 *  there'd be nowhere for the FLIP icon to travel to). */
function HeightTransition({
  children,
  forcedHeight,
  minHeight,
  highWaterMark = false,
  resetMark = 0,
}: {
  children: ReactNode
  forcedHeight?: number | null
  minHeight?: number | null
  /** When true, the card's effective height never shrinks below the
   *  largest natural height observed so far. Designed for the auth flow
   *  where the user wants the menu to stay the same size between
   *  Start → New Faceplate / Decal Pack / Skin Pack instead of visibly
   *  collapsing and re-growing. The high-water mark resets only on
   *  unmount (i.e. once per session); `forcedHeight` still overrides
   *  it for the editor-loading lock. */
  highWaterMark?: boolean
  /** Bumping this number resets the high-water mark back to zero so the
   *  card can shrink to its natural content height. Used when navigating
   *  back to a phase (e.g. 'start') that should restore compact sizing. */
  resetMark?: number
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const firstObservation = useRef(true)
  // High-water-mark of all natural heights observed for this mount.
  // Lives in state (not a ref) because it directly drives render — the
  // card's effective height is `max(natural, peak)`. Reading a ref during
  // render is flagged by react-hooks/refs; using state keeps the ratchet
  // visible to React and re-renders the wrapper when the floor moves up.
  const [peakNaturalHeight, setPeakNaturalHeight] = useState(0)

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    // Initial measurement — set without animation by toggling the
    // wrapper into a "first-measurement" mode through the ref flag.
    setHeight(el.offsetHeight)
    firstObservation.current = false

    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height
      if (typeof h === 'number') setHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset the high-water mark whenever the parent bumps `resetMark`.
  // This allows the card to shrink back to its natural content height —
  // e.g. after returning from the SavedProjectsList back to StartScreen.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset triggered by prop change
  useEffect(() => {
    setPeakNaturalHeight(0)
  }, [resetMark])

  // Ratchet the high-water mark whenever a taller natural height shows
  // up. Done in an effect (not during render) so React's strict-mode
  // double-invoke and the react-hooks/set-state-in-effect rule are both
  // satisfied. The functional updater means we never read peak during
  // render to compute its next value.
  useEffect(() => {
    if (!highWaterMark || height == null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-way ratchet: setState only fires when the measured height exceeds the recorded peak; the functional updater guards against stale-closure cascades.
    setPeakNaturalHeight(prev => (height > prev ? height : prev))
  }, [highWaterMark, height])

  // forcedHeight wins outright (loading state needs an exact lock).
  // Otherwise the effective height is the natural measurement, clamped
  // to minHeight if one was passed — that keeps the card from shrinking
  // when content swaps to something shorter (Connect → Welcome back).
  // High-water-mark further ratchets the floor up to the largest
  // natural height we've ever seen during this mount.
  const peakFloor = highWaterMark ? peakNaturalHeight : 0
  const naturalOrFloor =
    height != null
      ? Math.max(height, minHeight ?? 0, peakFloor)
      : (minHeight ?? null) !== null && peakFloor > 0
        ? Math.max(minHeight ?? 0, peakFloor)
        : (minHeight ?? null)
  const effectiveHeight = forcedHeight != null ? forcedHeight : naturalOrFloor

  return (
    <div
      style={{
        height: effectiveHeight ?? 'auto',
        // Skip the transition until we have our first measurement,
        // otherwise the card animates from 0 → real height on mount.
        transition: effectiveHeight === null ? undefined : `height ${IN_MS}ms ${EASE}`,
        // `overflow: clip` clips overflowing content without creating a new
        // scroll container (unlike `overflow: hidden`). This is critical for
        // the SavedProjectsList custom-scrollbar: `overflow: hidden` on an
        // ancestor can suppress WebKit's scrollbar rendering even when the
        // scroll container itself is entirely within the ancestor's bounds,
        // because WebKit composites the scrollbar on the scroll container's
        // layer — and `overflow: hidden` creates a stacking context that
        // clips layer-composited children. `overflow: clip` avoids that
        // stacking-context side-effect while still preventing layout overflow.
        overflow: 'clip',
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  )
}

/** Outgoing content — fades + drifts up. Sits absolutely over the
 *  incoming so they cross-fade without re-layouting. */
function MorphOut({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(false))
    return () => cancelAnimationFrame(r)
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: shown ? 1 : 0,
        // Exit upward: slides UP and out (0 → -10px). Paired with MorphIn's
        // "enter from above" so the eye reads a consistent downward cascade:
        // content flows in from the top and exits through the top.
        transform: shown ? 'translateY(0)' : 'translateY(-10px)',
        transition: `opacity ${OUT_MS}ms ${EASE}, transform ${OUT_MS}ms ${EASE}`,
        // Don't intercept clicks — the incoming UI under us should be
        // interactive immediately even before the fade-out completes.
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  )
}
