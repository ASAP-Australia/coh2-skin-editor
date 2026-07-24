/**
 * FactionChooserStep — lightweight faction chooser for the faction-first
 * new-pack flow (Phase-2 SLICE 1).
 *
 * Rendered inside the persistent AuthShell card (like FactionPicker), it shows
 * the same 5 CoH2 faction rows (emblem + label + sublabel) but WITHOUT the
 * FactionPicker's prefetch/preload/`NewProjectForm`-prefetch coupling. Its
 * `onPick(faction)` goes straight to the editor with a generic default pack
 * name — no intermediate details form (VISION: "simple but powerful, no
 * boxes"). ONE component serves BOTH the skin and decal new-flows; the caller
 * passes `title`/`subtitle` so the copy differs per flow.
 *
 * Not to be confused with the legacy `FactionPicker.tsx`, which remains in the
 * tree (still tested, still importable for a future "advanced new" path).
 */

import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { FACTION_ICON_SRC, FACTION_LABELS } from '@/lib/factions'
import type { Faction } from '@/lib/vehicles'
import Stagger from '@/components/Stagger'

interface Props {
  /** Drive a fade-out from the parent (set true just before navigating away). */
  exiting?: boolean
  /** Heading, e.g. "Which faction?". */
  title: string
  /** Sub-copy under the heading — differs per new-flow (skin vs decal). */
  subtitle: string
  onPick: (faction: Faction) => void
  onBack: () => void
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

export default function FactionChooserStep({ exiting, title, subtitle, onPick, onBack }: Props) {
  /** Locks once a faction is picked so the user can't double-click. */
  const [picked, setPicked] = useState<Faction | null>(null)

  const handlePick = (fac: Faction) => {
    if (picked) return
    setPicked(fac)
    onPick(fac)
  }

  return (
    <Stagger mode={exiting ? 'exit' : 'enter'}>
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
        {title}
      </h1>

      <p className="text-[12px] text-muted-foreground mb-5">{subtitle}</p>

      {/* Faction rows splat directly into Stagger so each row is its own
          child — matching FactionPicker's reverse-order exit read on Back.
          Row spacing comes from per-row `mb-2` rather than a wrapping
          `flex-col gap-2`, since wrapping them would collapse the five rows
          into a single Stagger child. */}
      {FACTIONS.map((fac, i) => {
        const isPicked = picked === fac
        const isDimmed = picked != null && !isPicked
        const isLast = i === FACTIONS.length - 1
        return (
          <button
            key={fac}
            onClick={() => handlePick(fac)}
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
