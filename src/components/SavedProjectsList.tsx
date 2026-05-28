/**
 * SavedProjectsList — shows all locally-saved projects grouped by type.
 *
 * Replaces the OS file-picker that previously fired on "Load Project".
 * The user can click any entry to load it directly, delete an entry via
 * the per-row trash affordance (with inline two-step confirm), or fall
 * back to the old disk-picker via "Open from disk…".
 */

import { useState } from 'react'
import {
  Layers,
  UserSquare,
  Sticker,
  ArrowLeft,
  HardDriveDownload,
  Trash2,
  Check,
  X,
} from 'lucide-react'
import { listAllSkinProjects, removeRecentProject, type RecentProjectEntry } from '@/lib/project'
import {
  listAllFaceplates,
  removeRecentFaceplate,
  type RecentFaceplateEntry,
} from '@/lib/faceplate-project'
import {
  listAllDecalPacks,
  removeRecentDecalPack,
  type RecentDecalPack,
} from '@/lib/decal-pack-project'

interface Props {
  onPickSkin: (id: string) => void
  onPickFaceplate: (id: string) => void
  onPickDecalPack: (id: string) => void
  onBack: () => void
  onPickFromDisk: () => void
}

/** Tiny relative-time formatter: "just now", "5m ago", "3h ago", "2d ago". */
function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  const days = Math.floor(d / 86_400_000)
  if (days < 2) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(Date.now() - d).toLocaleDateString()
}

/** Convert a RecentDecalPack's ISO lastEditedAt string to ms for relTime. */
function isoToMs(iso: string | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/** Discriminator for the delete-row callback so a single confirm-id
 *  state works across all three groups without id collisions. */
type Group = 'skin' | 'faceplate' | 'decal'

export default function SavedProjectsList({
  onPickSkin,
  onPickFaceplate,
  onPickDecalPack,
  onBack,
  onPickFromDisk,
}: Props) {
  // Lists are mirrored into local state so deletes can re-render without
  // a parent refresh. Reads from localStorage happen once on mount via
  // the initialiser. We use the `listAll*` readers (NOT the 12-entry
  // `getRecent*` registries) so the load-project menu shows every healthy
  // snapshot the user still has on disk — projects they made months ago
  // were previously invisible here once they fell off the recent list.
  // Broken/corrupt snapshots are silently excluded by the loader-validity
  // gate so they can't crash the editor on click. The custom scrollbar
  // below handles arbitrarily-long lists.
  const [skins, setSkins] = useState<RecentProjectEntry[]>(() => listAllSkinProjects())
  const [faceplates, setFaceplates] = useState<RecentFaceplateEntry[]>(() => listAllFaceplates())
  const [decalPacks, setDecalPacks] = useState<RecentDecalPack[]>(() => listAllDecalPacks())

  // Track which row is currently in "confirm delete" state so only one
  // row at a time shows the confirm UI. The key is `${group}:${id}` so
  // ids that collide across groups don't tangle.
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const isEmpty = skins.length === 0 && faceplates.length === 0 && decalPacks.length === 0

  const handleDelete = (group: Group, id: string) => {
    if (group === 'skin') {
      removeRecentProject(id)
      setSkins(prev => prev.filter(e => e.id !== id))
    } else if (group === 'faceplate') {
      removeRecentFaceplate(id)
      setFaceplates(prev => prev.filter(e => e.id !== id))
    } else {
      removeRecentDecalPack(id)
      setDecalPacks(prev => prev.filter(e => e.id !== id))
    }
    setConfirmKey(null)
  }

  return (
    <div>
      {/* Subtle back affordance — v1.0 user feedback: "get rid of the back
       * button and get rid of the 'Saved projects' [header]. Is there a
       * better way we can do the back button thing?"
       *
       * The previous centered title + Back row chewed ~48 px of vertical
       * space inside the AuthShell card. That pushed the scrolling list
       * down so its 40vh ceiling was hitting the card's own ceiling on
       * 720p viewports — projects visibly clipped under the "Open from
       * disk…" CTA.
       *
       * New approach: drop the explicit heading entirely (the user
       * already knows where they are — they just tapped "Load project")
       * and shrink the back affordance to a small ghost-chip floating
       * top-left of the panel content. Keyboard-focusable, screen-reader
       * labelled, but visually disappears into the surface until hovered.
       */}
      <button
        type="button"
        onClick={onBack}
        className="group mb-3 -ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg
                   text-[11px] uppercase tracking-[1.2px]
                   text-muted-foreground/70 hover:text-foreground
                   hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none
                   transition-colors duration-150"
        aria-label="Back to start"
      >
        <ArrowLeft
          size={12}
          aria-hidden
          className="transition-transform group-hover:-translate-x-0.5"
        />
        <span>Back</span>
      </button>

      {isEmpty ? (
        <div className="text-center py-6">
          <p className="text-[13px] text-muted-foreground mb-4">No saved projects yet.</p>
          <button
            type="button"
            onClick={onPickFromDisk}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium
                       border border-white/10 bg-white/[0.04] hover:bg-white/[0.08]
                       text-muted-foreground hover:text-foreground transition-colors"
          >
            <HardDriveDownload size={14} aria-hidden />
            Open from disk…
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Scrollable list area —
           *
           * v1.0 user feedback: "the load project has too many projects,
           * they break out of the menu, add a custom scrollbar to the
           * right." The previous implementation already opted in to the
           * `.custom-scrollbar` class, but the wrapper had `pr-3 -mr-2`
           * which pulled the scroll container's right edge 8 px PAST the
           * AuthShell card's content area — the 12 px scrollbar then sat
           * partially outside the card and got clipped by the card's
           * `overflow-hidden`, leaving only a sliver of rail visible.
           * Fixing that by:
           *
           *   1. Dropping `-mr-2` entirely so the scroll box stays inside
           *      the card content area.
           *   2. Using `pr-2` (8 px right padding) for breathing room
           *      between the rows and the scrollbar rail without pushing
           *      the rail off the card.
           *   3. Tightening the height cap to `min(40vh, 320px)` so even
           *      on a 720p viewport (Electron default) the bottom
           *      "Open from disk…" CTA stays on-screen.
           *
           * The `.custom-scrollbar` class (defined in index.css) renders
           * a 12 px themed rail with a visible thumb that brightens on
           * hover — overriding the app-wide "hide all scrollbars" default
           * so users with many projects can see at a glance that the
           * list is scrollable. data-testid lets unit tests assert the
           * wiring. */}
          <div
            data-testid="saved-projects-scroll"
            className="custom-scrollbar overflow-y-auto pr-2"
            style={{
              // Reclaim the space the Saved-projects header + Back button
              // used to occupy (~48 px) — bumped from 320 to 360 px on
              // large viewports so two full sections fit before scrolling
              // kicks in. The 50vh ceiling guarantees the bottom
              // "Open from disk…" CTA stays on-screen even on a 720p
              // Electron window with multiple sections expanded.
              maxHeight: 'min(50vh, 360px)',
            }}
          >
            <div className="space-y-5">
              {/* Skin packs */}
              {skins.length > 0 && (
                <Section title="Skin packs" icon={<Layers size={14} aria-hidden />}>
                  {skins.map((entry: RecentProjectEntry) => (
                    <ProjectRow
                      key={entry.id}
                      title={entry.name}
                      subtitle={relTime(entry.lastEditedAt)}
                      onClick={() => onPickSkin(entry.id)}
                      confirming={confirmKey === `skin:${entry.id}`}
                      onArmDelete={() => setConfirmKey(`skin:${entry.id}`)}
                      onConfirmDelete={() => handleDelete('skin', entry.id)}
                      onCancelDelete={() => setConfirmKey(null)}
                    />
                  ))}
                </Section>
              )}

              {/* Faceplates */}
              {faceplates.length > 0 && (
                <Section title="Faceplates" icon={<UserSquare size={14} aria-hidden />}>
                  {faceplates.map((entry: RecentFaceplateEntry) => (
                    <ProjectRow
                      key={entry.id}
                      title={entry.name}
                      subtitle={relTime(entry.lastEditedAt)}
                      onClick={() => onPickFaceplate(entry.id)}
                      confirming={confirmKey === `faceplate:${entry.id}`}
                      onArmDelete={() => setConfirmKey(`faceplate:${entry.id}`)}
                      onConfirmDelete={() => handleDelete('faceplate', entry.id)}
                      onCancelDelete={() => setConfirmKey(null)}
                    />
                  ))}
                </Section>
              )}

              {/* Decal packs */}
              {decalPacks.length > 0 && (
                <Section title="Decal packs" icon={<Sticker size={14} aria-hidden />}>
                  {decalPacks.map((entry: RecentDecalPack) => (
                    <ProjectRow
                      key={entry.id}
                      title={entry.packName}
                      subtitle={relTime(isoToMs(entry.lastEditedAt))}
                      onClick={() => onPickDecalPack(entry.id)}
                      confirming={confirmKey === `decal:${entry.id}`}
                      onArmDelete={() => setConfirmKey(`decal:${entry.id}`)}
                      onConfirmDelete={() => handleDelete('decal', entry.id)}
                      onCancelDelete={() => setConfirmKey(null)}
                    />
                  ))}
                </Section>
              )}
            </div>
          </div>

          {/* Disk fallback — pinned below the scroll area so it remains
           *  reachable no matter how many projects the user has saved. */}
          <div className="pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onPickFromDisk}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px]
                         border border-white/[0.06] bg-transparent hover:bg-white/[0.04]
                         text-muted-foreground hover:text-foreground transition-colors"
            >
              <HardDriveDownload size={13} aria-hidden />
              Open from disk…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <span className="text-muted-foreground/70">{icon}</span>
        <span className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground font-medium">
          {title}
        </span>
      </div>
      <div className="rounded-2xl overflow-hidden border border-white/[0.08]">{children}</div>
    </div>
  )
}

/**
 * Row layout:
 *
 *   [────── main load-button ──────][trash / confirm cluster]
 *
 * The main load action and the delete action live as siblings in a flex
 * row, NOT nested — nested <button> is invalid HTML and breaks keyboard
 * a11y. The whole row keeps its rounded-card look via the surrounding
 * Section wrapper.
 *
 * Delete UX: clicking the trash icon "arms" the row — the trash icon is
 * replaced by an inline confirm cluster (✓ delete / ✕ cancel) and the
 * row tints red. Only one row can be armed at a time (managed by the
 * parent's `confirmKey` state), so clicking trash on a different row
 * disarms the previous one automatically.
 */
function ProjectRow({
  title,
  subtitle,
  onClick,
  confirming,
  onArmDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  title: string
  subtitle: string
  onClick: () => void
  confirming: boolean
  onArmDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  return (
    <div
      data-testid="saved-project-row"
      className={`w-full flex items-stretch border-b border-white/[0.06] last:border-b-0 transition-colors duration-150 ${
        confirming ? 'bg-red-500/[0.08]' : 'bg-white/[0.03] hover:bg-white/[0.06]'
      }`}
    >
      {/* Main load-the-project button — fills the row except for the
       *  trailing trash/confirm cluster. */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left px-4 py-3 flex items-center gap-3
                   hover:bg-white/[0.04] focus:bg-white/[0.04] focus:outline-none
                   transition-colors duration-150"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-foreground truncate">{title}</div>
          <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{subtitle}</div>
        </div>
      </button>

      {/* Delete affordance — armed/unarmed in-place to keep the row
       *  layout stable. Stop click propagation so the underlying row
       *  doesn't catch the click (defensive — they're siblings, not
       *  nested, so propagation wouldn't fire the main button — but
       *  this also blocks any future wrapper handler). */}
      {confirming ? (
        <div className="flex items-stretch shrink-0 border-l border-white/[0.06]">
          <button
            type="button"
            data-testid="confirm-delete"
            onClick={e => {
              e.stopPropagation()
              onConfirmDelete()
            }}
            aria-label={`Confirm delete ${title}`}
            className="px-3 flex items-center justify-center text-red-300 hover:text-red-200
                       hover:bg-red-500/15 focus:bg-red-500/15 focus:outline-none
                       transition-colors duration-150"
          >
            <Check size={14} aria-hidden />
          </button>
          <button
            type="button"
            data-testid="cancel-delete"
            onClick={e => {
              e.stopPropagation()
              onCancelDelete()
            }}
            aria-label={`Cancel delete ${title}`}
            className="px-3 flex items-center justify-center text-muted-foreground
                       hover:text-foreground hover:bg-white/[0.06] focus:bg-white/[0.06]
                       focus:outline-none border-l border-white/[0.04]
                       transition-colors duration-150"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="arm-delete"
          onClick={e => {
            e.stopPropagation()
            onArmDelete()
          }}
          aria-label={`Delete ${title}`}
          title="Delete"
          className="px-3 flex items-center justify-center shrink-0 border-l border-white/[0.06]
                     text-muted-foreground/60 hover:text-red-300 hover:bg-red-500/10
                     focus:text-red-300 focus:bg-red-500/10 focus:outline-none
                     transition-colors duration-150"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}
