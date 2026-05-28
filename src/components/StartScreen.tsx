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
import { Clock } from 'lucide-react'
import { GiPaintBrush, GiShield, GiPaintBucket, GiOpenFolder } from 'react-icons/gi'
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

  // ── Project type buttons: 2-column half-width grid + full-width Load ──
  // The three "new project" buttons sit in a CSS grid (2 cols, gap-3).
  // With three items the first two share row 1 and the third sits
  // half-width on row 2 (left-aligned), matching the grid cell size.
  // Each button uses a neutral glass background; colour is expressed only
  // through the lucide icon (Paintbrush amber / IdCard sky / Sticker emerald)
  // so the visual hierarchy is icon-led rather than background-led.
  // Load Project keeps the full-width ActionRow treatment below the grid.
  // ── 2×2 grid for the four project-action buttons ─────────────────────
  // Row 1: Skin Pack + Faceplate. Row 2: Decal Pack + Load Project.
  // All four use neutral glass backgrounds; colour is carried by the icon.
  rows.push(
    <div key="new-project-grid" className="grid grid-cols-2 gap-3 mb-3">
      <GridButton
        icon={<GiPaintBrush className="text-amber-400 flex-shrink-0" style={{ width: 24, height: 24 }} aria-hidden />}
        title="New Skin Pack"
        sublabel="Paint a vehicle livery"
        onClick={onNewSkin}
      />
      <GridButton
        icon={<GiShield className="text-sky-400 flex-shrink-0" style={{ width: 24, height: 24 }} aria-hidden />}
        title="New Faceplate"
        sublabel="Player profile banner"
        onClick={onNewFaceplate}
      />
      <GridButton
        icon={<GiPaintBucket className="text-emerald-400 flex-shrink-0" style={{ width: 24, height: 24 }} aria-hidden />}
        title="New Decal Pack"
        sublabel="A set of vehicle decals"
        onClick={onNewDecalPack}
      />
      <GridButton
        icon={<GiOpenFolder className="text-violet-400 flex-shrink-0" style={{ width: 24, height: 24 }} aria-hidden />}
        title="Load Project"
        sublabel="Open saved project"
        onClick={onShowSavedProjects}
      />
    </div>,
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
// GridButton — compact half-width card used in the 2-column new-project
// grid. Neutral glass background; the colour lives on the icon only so
// the visual hierarchy is icon-led rather than background-led.
// ─────────────────────────────────────────────────────────────────────────

function GridButton({
  icon,
  title,
  sublabel,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  sublabel: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="action-row group relative w-full min-h-[64px] cursor-pointer text-left px-3.5 py-3 rounded-2xl
                 border border-white/[0.08] bg-white/[0.04]
                 transition-all duration-200 flex items-center gap-2.5"
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-foreground leading-tight truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">{sublabel}</div>
      </div>
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
