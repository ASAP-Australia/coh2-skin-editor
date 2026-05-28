/**
 * StartScreen — post-Connect routing decision (panel content only).
 *
 * After the user has authorised their CoH2 install, this panel offers
 * four paths:
 *   1. Continue last session  (only when a saved skin OR faceplate project exists)
 *   2. Open a recent project  (clickable cards above the buttons)
 *   3. New Skin Pack          → FactionPicker → NewProjectForm → Editor
 *   4. New Faceplate          → FaceplateEditor with a fresh project
 *   5. Load Project           → file picker accepting .coh2skin OR .coh2faceplate
 *
 * The three primary actions ("New Skin Pack", "New Faceplate", "Load
 * Project") render as faction-row–style buttons: a 40-px icon on the
 * left, a stacked title + sublabel on the right, and a chevron in the
 * trailing edge. This mirrors the FactionPicker so the user sees the
 * same row idiom across the early flow.
 *
 * The persistent glass shell (background, card, halo, brand mark, eyebrow)
 * is provided by AuthShell — see ConnectScreen for the same pattern. This
 * panel renders only its unique content, so the Connect → Start
 * transition reads as a single morphing surface rather than two screens.
 *
 * The `exiting` flag is preserved for compatibility with the multi-stage
 * flow (StartScreen → FactionPicker etc.), where AuthShell is no longer
 * the wrapping component but the same fade-out cue is still meaningful.
 */

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Clock, Plus, Sticker, Upload, UserSquare } from 'lucide-react'
import { BorderBeam } from '@/components/ui/border-beam'
import { type Coh2SkinProject, loadActive, readProjectFile } from '@/lib/project'
import {
  type Coh2FaceplateProject,
  loadActiveFaceplate,
  readFaceplateFile,
} from '@/lib/faceplate-project'
import {
  type Coh2DecalPackProject,
  loadActiveDecalPackFromLocal,
  tryParseDecalPackFile,
} from '@/lib/decal-pack-project'
import Stagger from '@/components/Stagger'

type AnyProject =
  | { kind: 'skin'; project: Coh2SkinProject }
  | { kind: 'faceplate'; project: Coh2FaceplateProject }
  | { kind: 'decalpack'; project: Coh2DecalPackProject }

interface Props {
  /** Drive a fade-out from the parent (set true just before navigating away). */
  exiting?: boolean
  onContinueSkin: (project: Coh2SkinProject) => void
  onNewSkin: () => void
  onNewFaceplate: () => void
  onNewDecalPack: () => void
  onLoadSkin: (project: Coh2SkinProject) => void
  onLoadFaceplate: (project: Coh2FaceplateProject) => void
  onLoadDecalPack: (project: Coh2DecalPackProject) => void
  /** Continue-card delegate when the most-recent project is a skin pack. */
  onOpenRecentFaceplate: (project: Coh2FaceplateProject) => void
  /** Continue-card delegate when the most-recent project is a decal pack. */
  onOpenRecentDecalPack: (project: Coh2DecalPackProject) => void
  /** Navigate to the saved-projects list instead of opening OS file picker. */
  onShowSavedProjects: () => void
}

export default function StartScreen({
  exiting,
  onContinueSkin,
  onNewSkin,
  onNewFaceplate,
  onNewDecalPack,
  onLoadSkin,
  onLoadFaceplate,
  onLoadDecalPack,
  onOpenRecentFaceplate,
  onOpenRecentDecalPack,
  onShowSavedProjects,
}: Props) {
  const [savedSkin, setSavedSkin] = useState<Coh2SkinProject | null>(null)
  const [savedFaceplate, setSavedFaceplate] = useState<Coh2FaceplateProject | null>(null)
  const [savedDecalPack, setSavedDecalPack] = useState<Coh2DecalPackProject | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only effect reading from localStorage; synchronous, no cascade
    setSavedSkin(loadActive())
    setSavedFaceplate(loadActiveFaceplate())
    setSavedDecalPack(loadActiveDecalPackFromLocal())
  }, [])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Sniff the magic header by extension. All three formats are JSON with a
    // magic string at the top level — we try the appropriate reader based
    // on the file extension, falling back to "try all" for files without
    // a recognisable extension.
    const lower = file.name.toLowerCase()
    try {
      if (lower.endsWith('.coh2faceplate')) {
        onLoadFaceplate(await readFaceplateFile(file))
        return
      }
      if (lower.endsWith('.coh2decalpack')) {
        const text = await file.text()
        const parsed = tryParseDecalPackFile(text)
        if (!parsed) {
          setLoadError(`"${file.name}" is not a valid .coh2decalpack file.`)
          return
        }
        onLoadDecalPack(parsed)
        return
      }
      if (lower.endsWith('.coh2skin') || lower.endsWith('.json')) {
        // Try all three formats — JSON files without one of the dedicated
        // extensions could be any of them.
        const resolved = await tryAllFormats(file)
        if (!resolved) {
          setLoadError(
            `"${file.name}" is not a valid .coh2skin, .coh2faceplate, or .coh2decalpack file.`,
          )
          return
        }
        if (resolved.kind === 'skin') onLoadSkin(resolved.project)
        else if (resolved.kind === 'faceplate') onLoadFaceplate(resolved.project)
        else onLoadDecalPack(resolved.project)
        return
      }
      setLoadError(
        `"${file.name}" has an unrecognised extension — expected .coh2skin, .coh2faceplate, or .coh2decalpack.`,
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Row definitions ────────────────────────────────────────────────────
  // Build the visible rows up-front so Stagger gets a stable list.
  //
  // The "Pick a starting point" / "Welcome back" title + blurb pair were
  // removed in v1.0: the four colour-coded action tiles below carry their
  // own labels ("New Skin Pack", "New Faceplate", …) and the eyebrow
  // ("CoH2 · Community Modding Tool") above the card already names the
  // surface, so a second heading just adds visual noise.
  const rows: React.ReactNode[] = []

  // Continue last session — rendered as a BorderBeam-wrapped card when
  // there's an active project (any kind). When multiple kinds have active
  // sessions, surface whichever was edited most recently.
  const candidates: AnyProject[] = []
  if (savedSkin) candidates.push({ kind: 'skin', project: savedSkin })
  if (savedFaceplate) candidates.push({ kind: 'faceplate', project: savedFaceplate })
  if (savedDecalPack) candidates.push({ kind: 'decalpack', project: savedDecalPack })
  const lastEdited =
    candidates.length > 0
      ? candidates.reduce((latest, cur) =>
          Date.parse(cur.project.modifiedAt) >= Date.parse(latest.project.modifiedAt)
            ? cur
            : latest,
        )
      : null

  if (lastEdited) {
    const continueLabel =
      lastEdited.kind === 'skin'
        ? 'Skin pack'
        : lastEdited.kind === 'faceplate'
          ? 'Faceplate'
          : 'Decal pack'
    rows.push(
      <BorderBeam
        key="continue"
        colorVariant="ocean"
        duration={5}
        strength={0.7}
        borderRadius={16}
        borderWidth={1}
        className="bb-pressable mb-4"
      >
        <button
          onClick={() => {
            if (lastEdited.kind === 'skin') onContinueSkin(lastEdited.project)
            else if (lastEdited.kind === 'faceplate') onOpenRecentFaceplate(lastEdited.project)
            else onOpenRecentDecalPack(lastEdited.project)
          }}
          className="bb-cta relative w-full text-left px-4 py-3 border border-white/[0.08]
                     hover:border-white/15 transition-all duration-150
                     flex items-center gap-3"
          style={{
            borderRadius: 16,
            background: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
          }}
        >
          <Clock className="size-5 text-foreground/70 flex-shrink-0" aria-hidden />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground leading-none">
              Continue · {continueLabel}
            </div>
            <div className="text-[15px] font-medium text-foreground truncate leading-tight">
              {lastEdited.project.packName || 'Untitled project'}
            </div>
            <div className="text-[11px] text-muted-foreground/80 leading-none">
              {relTimeFromIso(lastEdited.project.modifiedAt)}
            </div>
          </div>
        </button>
      </BorderBeam>,
    )
  }

  if (loadError) {
    rows.push(
      <div
        key="load-error"
        className="mb-3 px-3.5 py-2.5 rounded-2xl border border-red-400/25 bg-red-500/[0.06] text-[12px] text-red-200/90 leading-relaxed whitespace-pre-line"
      >
        {loadError}
      </div>,
    )
  }

  // Recent projects strip — removed in v1.0. The user explicitly asked
  // for a quieter welcome surface: just "Continue" + the four primary
  // action tiles. The recents data is still persisted in localStorage
  // (so anything saved elsewhere — e.g. the per-kind "Load Project" file
  // picker — keeps working), it just doesn't surface here.

  // ── Four primary action rows (iOS Settings–style coloured tiles) ──────
  //
  // Each row's icon sits inside a tinted gradient square — a direct lift
  // from Apple's Settings.app pattern (orange Music, blue Mail, green
  // Messages…) so the user can scan the menu by colour instead of by
  // text. The four actions read at a glance:
  //
  //   • New Skin Pack   — Brigade orange (matches the app's accent
  //                       colour + reads as "paint / livery")
  //   • New Faceplate   — Apple blue (profile / identity)
  //   • New Decal Pack  — Apple purple (creative compose / sticker)
  //   • Load Project    — Apple green (positive, "open from disk")
  //
  // The colours are kept low-saturation against the glass card so they
  // don't fight the dark background; the icon glyph stays white for
  // contrast (Apple's convention).
  rows.push(
    <ActionRow
      key="new-skin"
      icon={<Plus className="size-5 text-white" aria-hidden strokeWidth={2.2} />}
      tone="orange"
      title="New Skin Pack"
      sublabel="Paint a vehicle livery"
      onClick={onNewSkin}
    />,
  )
  rows.push(
    <ActionRow
      key="new-faceplate"
      icon={<UserSquare className="size-5 text-white" aria-hidden strokeWidth={2.2} />}
      tone="blue"
      title="New Faceplate"
      sublabel="Player profile banner"
      onClick={onNewFaceplate}
    />,
  )
  rows.push(
    <ActionRow
      key="new-decal-pack"
      icon={<Sticker className="size-5 text-white" aria-hidden strokeWidth={2.2} />}
      tone="purple"
      title="New Decal Pack"
      sublabel="A set of vehicle decals"
      onClick={onNewDecalPack}
    />,
  )
  rows.push(
    <ActionRow
      key="load-project"
      icon={<Upload className="size-5 text-white" aria-hidden strokeWidth={2.2} />}
      tone="green"
      title="Load Project"
      sublabel="Browse saved projects"
      onClick={onShowSavedProjects}
    />,
  )

  return (
    // No bottom padding — the last action row provides its own breathing
    // room via the card's outer padding. The previous `pb-1` added an
    // extra 4 px below the "Load Project" row that read as dead space.
    //
    // initialDelay = 520ms matches AuthShell's HeightTransition `IN_MS`
    // — the card grows from Connect's natural height (~195 px) to
    // Start's full height (~480 px) over that interval, and the user
    // explicitly asked for the buttons to wait for the resize before
    // staggering in. Without the delay, the rows fade in while the card
    // is still mid-grow and the layout jitters under the cursor as the
    // user reads them. With the delay, the card settles first, THEN
    // the rows arrive top-down into a stable container.
    <div>
      <Stagger mode={exiting ? 'exit' : 'enter'} initialDelay={exiting ? 0 : 520}>
        {rows}
      </Stagger>

      <input
        ref={fileInputRef}
        type="file"
        accept=".coh2skin,.coh2faceplate,.coh2decalpack,.json"
        onChange={onFile}
        className="hidden"
      />

      <style>{`
        .bb-pressable {
          transition: transform 240ms cubic-bezier(.4, 1.6, .5, 1);
          will-change: transform;
          transform-origin: center;
        }
        .bb-pressable:has(button:not(:disabled):active) {
          transform: scale(0.95);
          transition: transform 90ms cubic-bezier(.3, 0, .7, 1);
        }
        .bb-cta {
          transition: background-color 160ms ease-out;
        }
        .bb-cta:not(:disabled):hover {
          background: rgba(255, 255, 255, 0.10) !important;
        }
        .recent-card:hover {
          transform: scale(1.02);
          background: rgba(255, 255, 255, 0.09) !important;
          border-color: rgba(var(--color-accent, 255 255 255) / 0.25) !important;
        }
        .recent-card:active {
          transform: scale(0.97);
          transition-duration: 90ms;
        }
        .action-row:hover {
          background: rgba(255,255,255,0.08) !important;
          border-color: rgba(255,255,255,0.15) !important;
        }
        .action-row:hover .action-row__chevron {
          opacity: 0.7;
          transform: translateX(2px);
        }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// ActionRow — faction-picker-style row used for the three primary CTAs.
// 40-px icon on the left, stacked title + sublabel in the middle, chevron
// on the right. The chevron is hidden by default and fades in on hover so
// the row feels alive rather than always-noisy.
// ─────────────────────────────────────────────────────────────────────────

/** Colour tones supported by `ActionRow`. These map to the iOS Settings-
 *  style icon tile palette — saturated-enough to read at a glance against
 *  the dark glass card, dim-enough not to compete with the rest of the
 *  UI. Each tone is a top-to-bottom gradient so the tile reads as a tiny
 *  3D pillow under glass; the inset white highlight at the top mimics
 *  light hitting a curved bevel (same trick the glass-N utilities use).
 *  Inner shadow at the bottom adds depth. */
type ActionTone = 'orange' | 'blue' | 'purple' | 'green'

const TONE_BG: Record<ActionTone, string> = {
  // Brigade orange — matches `--color-accent` defined in index.css.
  orange: 'linear-gradient(180deg, oklch(0.72 0.20 45) 0%, oklch(0.58 0.18 45) 100%)',
  // Apple system blue.
  blue: 'linear-gradient(180deg, oklch(0.72 0.18 245) 0%, oklch(0.55 0.18 250) 100%)',
  // Apple system purple — slightly cooler than the OS hue to harmonise
  // with the cool-tinted dark background tokens.
  purple: 'linear-gradient(180deg, oklch(0.66 0.22 305) 0%, oklch(0.50 0.20 305) 100%)',
  // Apple system green.
  green: 'linear-gradient(180deg, oklch(0.74 0.16 145) 0%, oklch(0.55 0.16 145) 100%)',
}

/** Matching focus-ring hue for each tone. Kept distinct from the tile
 *  background so keyboard focus is still visible against the gradient. */
const TONE_RING: Record<ActionTone, string> = {
  orange: 'oklch(0.72 0.20 45 / 0.55)',
  blue: 'oklch(0.72 0.18 245 / 0.55)',
  purple: 'oklch(0.66 0.22 305 / 0.55)',
  green: 'oklch(0.74 0.16 145 / 0.55)',
}

function ActionRow({
  icon,
  title,
  sublabel,
  tone,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  sublabel: string
  /** Optional. When omitted, falls back to the original neutral glass
   *  tile (kept for any future caller that doesn't want a coloured
   *  icon). All four StartScreen rows opt in. */
  tone?: ActionTone
  onClick: () => void
}) {
  // Resolve the tile background + focus ring for the requested tone.
  // Falling back to the original neutral glass tile when `tone` is
  // undefined preserves the old visual for any non-StartScreen reuse.
  const tileBg = tone ? TONE_BG[tone] : 'rgba(255,255,255,0.06)'
  const tileRing = tone ? TONE_RING[tone] : 'rgba(255,255,255,0.08)'
  return (
    <button
      onClick={onClick}
      // Vertical gap between adjacent action tiles. Bumped from the
      // previous 20 px (mb-5) → 28 px so the four coloured tiles read
      // as distinct cards rather than a single grouped slab. Explicit
      // pixel value via the arbitrary-value bracket so the spacing is
      // impossible to confuse with a typo in the Tailwind step scale.
      // Vertical gap between adjacent action tiles. Earlier revision
      // used mb-[28px] which made a Continue + 4-action stack visibly
      // taller than the card padding allowance — the bottom tile read
      // as "breaking out of the menu" (user feedback). 12 px keeps the
      // tiles distinct (each one still reads as its own card thanks to
      // the border + tonal icon) without producing dead space between
      // them. The card's HeightTransition ratchet picks up the new
      // height automatically.
      className="action-row group relative w-full text-left px-4 py-3 rounded-2xl
                 border border-white/[0.08] bg-white/[0.04]
                 transition-all duration-200 flex items-center gap-3
                 mb-3 last:mb-0"
    >
      <span
        aria-hidden
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: tileBg,
          // Hairline that softens the tile edge against the glass card.
          // The inset highlight on top + soft inset shadow at the bottom
          // give the tile a tiny pillow-under-glass depth, matching the
          // iOS Settings icons exactly.
          border: `1px solid ${tileRing}`,
          boxShadow:
            tone != null
              ? 'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.35)'
              : 'none',
        }}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-foreground leading-tight">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{sublabel}</div>
      </div>
      <ArrowRight
        size={16}
        strokeWidth={2}
        className="action-row__chevron text-muted-foreground opacity-0 transition-all duration-200"
        aria-hidden
      />
    </button>
  )
}

/** Lightweight relative-time formatter — "2m ago", "3h ago", "yesterday". */
function relTimeFromIso(iso: string | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 2) return 'yesterday'
  if (day < 7) return `${day}d ago`
  return new Date(t).toLocaleDateString()
}

/** Last-resort loader for .json or extensionless files: tries the skin
 *  parser first, then faceplate, then decal-pack. Returns null when none
 *  of the magic headers match. */
async function tryAllFormats(file: File): Promise<AnyProject | null> {
  try {
    return { kind: 'skin', project: await readProjectFile(file) }
  } catch {
    /* fall through to faceplate */
  }
  try {
    return { kind: 'faceplate', project: await readFaceplateFile(file) }
  } catch {
    /* fall through to decal pack */
  }
  try {
    const text = await file.text()
    const parsed = tryParseDecalPackFile(text)
    if (parsed) return { kind: 'decalpack', project: parsed }
  } catch {
    /* fall through */
  }
  return null
}
