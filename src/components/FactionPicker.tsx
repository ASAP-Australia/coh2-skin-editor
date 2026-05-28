/**
 * FactionPicker — second screen in the new-project flow (panel content only).
 *
 * Renders a vertical list of the 5 CoH2 factions inside the persistent
 * AuthShell card, mirroring StartScreen's "stack of clickable rows" feel
 * so the Connect → Start → Picker → Form transition reads as one
 * morphing surface instead of four full-page swaps.
 *
 * The picker no longer owns its own background, glass card, or brand mark
 * (those live in AuthShell). It also no longer puts a tinted disc behind
 * each emblem — the user wanted the badges to stand on their own.
 */

import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { FACTION_ICON_SRC, FACTION_LABELS } from '@/lib/factions'
import type { Faction } from '@/lib/vehicles'
import Stagger from '@/components/Stagger'

interface Props {
  /** Drive a fade-out from the parent (set true just before navigating away). */
  exiting?: boolean
  onPick: (faction: Faction) => void
  /** Optional speculative-prefetch hook — fires on hover/focus per row, lets
   *  the parent kick `preloadFaction()` early so click→form is instant. The
   *  parent is responsible for de-duping; we just fire on every event and
   *  trust the cache to no-op. Omit to disable. */
  onPrefetch?: (faction: Faction) => void
  onBack: () => void
  /** Hold the per-row entrance stagger by this many ms after mount. Used by
   *  the parent (App.tsx) to wait for AuthShell's HeightTransition to
   *  finish resizing before the faction rows start fading in — gives the
   *  user a clean three-beat sequence (fade-out → resize → fade-in)
   *  instead of everything overlapping. Default 0 = animate immediately. */
  enterDelay?: number
}

const FACTIONS: Faction[] = ['german', 'west_german', 'soviet', 'aef', 'british']

/** Short blurb under each faction name to make the row feel substantive. */
const FACTION_SUBLABEL: Record<Faction, string> = {
  german: 'Wehrmacht · Eastern & Western Front',
  west_german: 'Oberkommando West',
  soviet: 'Red Army',
  aef: 'US Forces',
  british: 'British Forces',
}

export default function FactionPicker({
  exiting,
  onPick,
  onPrefetch,
  onBack,
  enterDelay = 0,
}: Props) {
  /** Locks once a faction is picked so the user can't double-click. */
  const [picked, setPicked] = useState<Faction | null>(null)

  const handlePick = (fac: Faction) => {
    if (picked) return
    setPicked(fac)
    onPick(fac)
  }

  // Shared Stagger drives both enter (top-to-bottom) and exit
  // (bottom-to-top) per-row animation. The user wants back-nav to read
  // as "bottom row leaves first, top row leaves last, THEN the card
  // resizes, THEN StartScreen appears" — Stagger's `exit` mode already
  // reverses the per-index delay so the bottom row peels away first.
  // App.tsx holds the stage swap until the stagger fully completes.
  // enterDelay is forwarded to Stagger via initialDelay so the rows
  // stay hidden while AuthShell's HeightTransition is still resizing.
  return (
    <Stagger mode={exiting ? 'exit' : 'enter'} initialDelay={exiting ? 0 : enterDelay}>
      <button
        onClick={onBack}
        disabled={picked != null}
        className="inline-flex items-center gap-1.5 mb-5 pl-2 pr-3 py-1 rounded-full
                   border border-white/[0.08] bg-white/[0.04]
                   hover:bg-white/[0.08] hover:border-white/15 transition-all
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ArrowLeft className="size-3.5 text-foreground/85" aria-hidden />
        <span className="text-[11px] font-medium tracking-[1px] uppercase text-foreground/90">
          Back
        </span>
      </button>

      <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground leading-[1.15] mb-1">
        Which faction?
      </h1>

      <p className="text-[12px] text-muted-foreground mb-5">
        Pick the army your skin belongs to. We'll preload its vehicles while you fill in the pack
        details.
      </p>

      {/* Faction rows splat directly into Stagger so each row is its own
          child — Stagger's reverse-order exit then gives the user the
          requested "bottom row leaves first, top row leaves last"
          read on Back. Row spacing comes from per-row `mb-2` rather
          than a wrapping `flex-col gap-2`, since wrapping them in a
          div would collapse the five rows into a single Stagger child. */}
      {FACTIONS.map((fac, i) => {
        const isPicked = picked === fac
        const isDimmed = picked != null && !isPicked
        const isLast = i === FACTIONS.length - 1
        return (
          <button
            key={fac}
            onClick={() => handlePick(fac)}
            onPointerEnter={() => onPrefetch?.(fac)}
            onFocus={() => onPrefetch?.(fac)}
            disabled={isDimmed}
            className={`group relative w-full text-left px-3.5 py-2.5 rounded-2xl
                        border transition-all duration-200 flex items-center gap-3
                        ${isLast ? '' : 'mb-2'}
                        ${
                          isPicked
                            ? 'border-white/30 bg-white/[0.10]'
                            : 'border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/15'
                        }
                        ${isDimmed ? 'opacity-30 cursor-default' : ''}`}
            title={FACTION_LABELS[fac]}
          >
            <img
              src={FACTION_ICON_SRC[fac]}
              alt=""
              draggable={false}
              style={{
                width: 40,
                height: 40,
                objectFit: 'contain',
                flexShrink: 0,
                userSelect: 'none',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.55))',
              }}
            />

            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-foreground leading-tight">
                {FACTION_LABELS[fac]}
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                {FACTION_SUBLABEL[fac]}
              </div>
            </div>

            <ArrowRight
              size={16}
              strokeWidth={2}
              className={`text-muted-foreground transition-all duration-200
                          ${isPicked ? 'opacity-100 translate-x-0.5' : 'opacity-0 group-hover:opacity-70'}`}
              aria-hidden
            />
          </button>
        )
      })}
    </Stagger>
  )
}
