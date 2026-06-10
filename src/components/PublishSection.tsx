/**
 * PublishSection — inline publish form for use inside PackIdentityPopover.
 *
 * Renders the Steam Workshop publish/update form inline (no Dialog wrapper).
 * Used by FaceplateEditor and DecalPackEditor as a `publishSection` prop on
 * PackIdentityPopover. The skin-pack ExportPanel callsite still uses the
 * standalone PublishToWorkshopDialog (different chrome context).
 *
 * State machine:
 *   idle (no target)   → shows glass selector disabled while building (or enabled to kick off build+publish)
 *   idle (has target)  → shows full form (visibility, change note)
 *   building           → SGA build in progress; selector disabled with spinner
 *   uploading          → inputs locked, spinner in submit button; calls onUploadStart
 *   idle (on success)  → returns directly to idle (silent); calls onUploadEnd
 *   (on error)         → stays idle; calls onPublishError + onUploadEnd; error shown in title pill
 *
 * The component owns form draft state and the phase state machine.
 * The parent owns the build step (isBuildingTarget / onRequestBuild).
 * When target === null and the user clicks a visibility, the component calls
 * onRequestBuild() and remembers the pending visibility. When target becomes
 * non-null (parent completed the build), the component auto-triggers publish.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { GlassSegmented } from '@/components/ui/glass-segmented'
import { isElectron, makeTmpPublishDir, writeFile } from '@/lib/native-fs'
import type {
  PublishWorkshopInput,
  PublishWorkshopResult,
  UpdateWorkshopResult,
} from '@/lib/native-fs'
import type { WorkshopPublishTarget, WorkshopProjectType } from '@/components/PublishToWorkshopDialog'
import { generateWorkshopPreview } from '@/lib/workshop-preview'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishSectionProps {
  /** null = not yet built; show "Build & publish" button */
  target: WorkshopPublishTarget | null
  /** Parent is building the SGA right now */
  isBuildingTarget: boolean
  /** Triggers parent's SGA build pipeline */
  onRequestBuild: () => void
  /** Emitted so parent can lock popover during upload */
  onUploadStart?: () => void
  /** Emitted when upload settles (success or error) */
  onUploadEnd?: () => void
  /** Emitted on publish error so the title pill can show an error state */
  onPublishError?: (message: string) => void
}

// ---------------------------------------------------------------------------
// Phase state machine
// ---------------------------------------------------------------------------

type Phase =
  | { kind: 'idle' }
  | { kind: 'building'; pendingVisibility: 0 | 1 | 2 | 3; pendingIndex: number }
  | { kind: 'uploading' }

// ---------------------------------------------------------------------------
// Real Workshop ID guard
// ---------------------------------------------------------------------------

/** Steam Workshop IDs are allocated sequentially and were around 3–5×10⁹ in
 *  late 2025. We reserve >1e15 for locally-generated fake IDs (see
 *  freshPackId in mod-export.ts). Anything ≤5e9 is treated as real. */
function isRealWorkshopId(id: string | undefined): id is string {
  if (!id) return false
  const n = Number(id)
  return Number.isFinite(n) && n > 0 && n <= 5_000_000_000
}

/**
 * Find the current user's existing Workshop item that matches a pack by its
 * title + kind tag, so a re-publish can update THAT item in place rather than
 * creating a duplicate.
 *
 * This is the pile-up guard: the per-project `workshopId` link normally routes
 * republishes to an update, but that link is lost when the user clears local
 * storage, re-imports a `.coh2faceplate` file, or publishes the same pack from
 * another machine. Without this lookup each such publish mints a brand-new
 * Workshop entry, leaving the user with a stack of identical items.
 *
 * Returns the workshopId of the SINGLE unambiguous match, or null when there
 * is no match — or more than one, in which case we refuse to guess which item
 * to overwrite and fall back to a normal publish. Best-effort: any Steam/IPC
 * failure yields null so publishing still proceeds (creating a new item is
 * preferable to blocking the user on a flaky lookup).
 */
async function findMyMatchingWorkshopItem(
  packName: string,
  tags: string[],
): Promise<string | null> {
  try {
    const api = window.electronAPI
    if (!api) return null
    const mine = await api.steam.workshop.getMine()
    const wantTitle = packName.trim().toLowerCase()
    const wantTags = tags.map(t => t.toLowerCase())
    const matches = mine.filter(
      it =>
        it.title.trim().toLowerCase() === wantTitle &&
        wantTags.every(wt => it.tags.some(t => t.toLowerCase() === wt)),
    )
    return matches.length === 1 ? matches[0].workshopId : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Visibility options
// ---------------------------------------------------------------------------

// Left-to-right order: Unlisted (default, hidden from search) → Private →
// Friends only → Public (increasing public reach).  Unlisted sits on the far
// left so it is both the default and visually the "least public" choice.
const VISIBILITY_OPTIONS: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 3, label: 'Unlisted' },
  { value: 2, label: 'Private' },
  { value: 1, label: 'Friends only' },
  { value: 0, label: 'Public' },
]

// ---------------------------------------------------------------------------
// Inline style helpers (shared with PublishToWorkshopDialog)
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 8,
  padding: '7px 10px',
  fontSize: 12,
  color: 'rgba(247,247,250,0.92)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box' as const,
  transition: 'border-color 0.12s, box-shadow 0.12s',
}

// ---------------------------------------------------------------------------
// Sub-components (verbatim equivalents from PublishToWorkshopDialog)
// ---------------------------------------------------------------------------

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.08em',
          color: 'rgba(255,255,255,0.5)',
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PublishSection
// ---------------------------------------------------------------------------

export function PublishSection({
  target,
  isBuildingTarget,
  onRequestBuild,
  onUploadStart,
  onUploadEnd,
  onPublishError,
}: PublishSectionProps) {
  const isUpdate = isRealWorkshopId(target?.workshopId)

  // selectedIndex = position in VISIBILITY_OPTIONS array (0 = Unlisted, 3 = Public)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [changeNote, setChangeNote] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // needsAgreementUrl: set when the first-publish response requires a Workshop
  // agreement acceptance before the item is visible. Cleared on popover reset.
  const [needsAgreementUrl, setNeedsAgreementUrl] = useState<string | null>(null)

  // pendingPublishRef holds the visibility/index selected while target === null.
  // When target transitions null→non-null (build completed), we fire the publish.
  const pendingPublishRef = useRef<{ visibility: 0 | 1 | 2 | 3; index: number } | null>(null)

  // workshopIdRef always holds the LATEST workshopId, updated every render.
  // handlePublish reads from this ref instead of closing over target?.workshopId,
  // which avoids a stale-closure bug: when the useEffect fires handlePublish after
  // a null→non-null target transition, the callback captured during the null render
  // would compute isUpdate=false and call publish instead of update.
  const workshopIdRef = useRef<string | undefined>(target?.workshopId)
  workshopIdRef.current = target?.workshopId

  // Generate a 1024×1024 high-quality preview PNG from the preview canvas.
  // Uses OffscreenCanvas with step-down rendering on a transparent background
  // so Steam doesn't have to upscale a tiny source (e.g. the 64×64 decal icon).
  const buildPreviewPng = useCallback(async (): Promise<Uint8Array | null> => {
    const src = target?.previewCanvas
    if (!src) return null
    try {
      return await generateWorkshopPreview(src)
    } catch {
      return null
    }
  }, [target])

  // handlePublish must be declared BEFORE the useEffects that reference it
  // to satisfy React Compiler's temporal-dead-zone checks.
  const handlePublish = useCallback(async (clickedVisibility: 0 | 1 | 2 | 3, clickedIndex: number) => {
    // No SGA yet — kick off the build and remember which visibility to publish at.
    // The useEffect watching `target` will auto-trigger us again once the build
    // sets target to non-null.
    if (!target) {
      setSelectedIndex(clickedIndex)
      setPhase({ kind: 'building', pendingVisibility: clickedVisibility, pendingIndex: clickedIndex })
      pendingPublishRef.current = { visibility: clickedVisibility, index: clickedIndex }
      onRequestBuild()
      return
    }

    if (!isElectron()) {
      onPublishError?.('Publishing is only available in the desktop app.')
      onUploadEnd?.()
      return
    }

    // Slide the indicator to the clicked option, then lock it there during upload
    setSelectedIndex(clickedIndex)
    setPhase({ kind: 'uploading' })
    onUploadStart?.()

    try {
      // 1. Make temp dir
      const tmpDir = await makeTmpPublishDir()

      // 2. Write SGA bytes to temp dir.
      // Pass the Uint8Array directly — writeFile() normalises it to an owned
      // ArrayBuffer, which avoids the byteOffset trap: if sgaBytes is a view
      // over a larger backing buffer (common when built with DataView/slice),
      // `.buffer` would send the WHOLE parent buffer with garbage bytes at the
      // start, producing a corrupt SGA that Steam rejects silently.
      const sgaPath = `${tmpDir}/${target.sgaFilename}`
      await writeFile(sgaPath, target.sgaBytes)
      console.log('[workshop:publish] step=sga-written path=%s byteLength=%d', sgaPath, target.sgaBytes.byteLength)

      // 3. Write preview PNG to temp dir.
      // generateWorkshopPreview renders a 1024×1024 OffscreenCanvas so Steam
      // doesn't have to upscale a tiny source image (e.g. the 64×64 decal icon).
      const pngBytes = await buildPreviewPng()
      if (!pngBytes) throw new Error('Failed to generate preview image. Make sure the editor canvas is loaded.')
      // Steam rejects preview images > 1 MB ("a parameter is invalid").
      // Log the size so we can diagnose if a complex canvas exceeds the limit.
      const ONE_MB = 1_048_576
      if (pngBytes.byteLength > ONE_MB) {
        console.warn('[workshop:publish] preview PNG is %d bytes (> 1 MB) — Steam may reject it', pngBytes.byteLength)
      }
      const previewPath = `${tmpDir}/preview.png`
      await writeFile(previewPath, pngBytes)
      console.log('[workshop:publish] step=preview-written path=%s byteLength=%d', previewPath, pngBytes.byteLength)

      // 4. Build publish input — title/description come from the pack itself
      const tagsByType: Record<WorkshopProjectType, string[]> = {
        skin: ['Skin'],
        faceplate: ['Faceplate'],
        decal: ['Decal'],
      }
      const input: PublishWorkshopInput = {
        contentPath: tmpDir,
        previewPath,
        title: target.packName,
        description: target.description,
        tags: tagsByType[target.type],
        visibility: clickedVisibility,
        changeNote: changeNote.trim() || undefined,
      }

      // 5. Publish or update
      // Read workshopId from the ref (always current) to avoid the stale-closure
      // bug where isUpdate would be false in the callback captured when target was null.
      const isUpdate = isRealWorkshopId(workshopIdRef.current)
      if (isUpdate && target.workshopId) {
        const result: UpdateWorkshopResult = await window.electronAPI!.steam.workshop.update(
          target.workshopId,
          input,
        )
        target.onPublished(target.workshopId)
        // If agreement is needed, show a compact inline notice instead of
        // replacing the selector with a full success view.
        if (result.needsAgreement) {
          const agreementUrl = `https://steamcommunity.com/sharedfiles/itemedittext/?id=${target.workshopId}`
          setNeedsAgreementUrl(agreementUrl)
        }
        // Always return to the idle visibility selector (silent success).
        setPhase({ kind: 'idle' })
        setSelectedIndex(clickedIndex)
      } else {
        // No persisted Workshop link for this pack. Before minting a NEW
        // Workshop entry, check whether the user already has an item for this
        // same pack (same title + kind tag) — if so, update it in place so we
        // don't pile up duplicates when the local link was lost (storage
        // cleared, project re-imported, or published from another machine).
        const existingId = await findMyMatchingWorkshopItem(target.packName, input.tags)
        if (existingId) {
          const result: UpdateWorkshopResult = await window.electronAPI!.steam.workshop.update(
            existingId,
            input,
          )
          target.onPublished(existingId)
          if (result.needsAgreement) {
            const agreementUrl = `https://steamcommunity.com/sharedfiles/itemedittext/?id=${existingId}`
            setNeedsAgreementUrl(agreementUrl)
          }
          setPhase({ kind: 'idle' })
          setSelectedIndex(clickedIndex)
        } else {
          const result: PublishWorkshopResult = await window.electronAPI!.steam.workshop.publish(input)
          target.onPublished(result.workshopId)
          if (result.needsAgreement) {
            const agreementUrl = `https://steamcommunity.com/sharedfiles/itemedittext/?id=${result.workshopId}`
            setNeedsAgreementUrl(agreementUrl)
          }
          setPhase({ kind: 'idle' })
          setSelectedIndex(clickedIndex)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onPublishError?.(msg)
      setPhase({ kind: 'idle' })
    } finally {
      onUploadEnd?.()
    }
  }, [
    target,
    changeNote,
    buildPreviewPng,
    onRequestBuild,
    onUploadStart,
    onUploadEnd,
    onPublishError,
  ])

  // Sync form state when target changes.
  // • null → null: nothing new; keep any in-progress building phase.
  // • null → non-null: build just completed — if we have a pending publish,
  //   fire it immediately (the effect runs after render so target is stable).
  // • non-null → null: popover closed/reopened; reset to idle.
  // setState in effect is intentional: bounded to one extra render per target
  // transition, not a loop.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset-on-target-change */
  useEffect(() => {
    if (target === null) {
      // If we're NOT mid-build, fully reset (popover closed without building).
      // If we ARE mid-build (phase.kind === 'building'), preserve that phase so
      // the selector stays disabled while isBuildingTarget is true.
      setPhase(prev => prev.kind === 'building' ? prev : { kind: 'idle' })
      setChangeNote('')
      setNeedsAgreementUrl(null)
      if (!pendingPublishRef.current) setSelectedIndex(0)
    } else {
      // target just became non-null (build completed).
      const pending = pendingPublishRef.current
      if (pending) {
        // Fire the deferred publish with the pre-selected visibility.
        pendingPublishRef.current = null
        // handlePublish is stable across renders (useCallback with target dep).
        // We schedule it in a microtask so React finishes committing first.
        Promise.resolve().then(() => handlePublish(pending.visibility, pending.index))
      } else {
        setPhase({ kind: 'idle' })
        setSelectedIndex(0)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handlePublish intentionally omitted; called only on target null→non-null transition
  }, [target])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Detect build failure: isBuildingTarget went false while target is still null.
  // In that case the parent's handleRequestBuild caught an error and didn't set
  // a publishTarget — reset our phase to idle and surface error via the title pill.
  useEffect(() => {
    if (!isBuildingTarget && target === null && pendingPublishRef.current) {
      // Build finished without producing a target → treat as build error.
      pendingPublishRef.current = null
      onPublishError?.('SGA build failed. Check the console for details and try again.')
      setPhase({ kind: 'idle' })
      onUploadEnd?.()
    }
  }, [isBuildingTarget, target, onUploadEnd, onPublishError])

  // busy = uploading OR building (SGA build in progress before upload)
  const building = phase.kind === 'building' || isBuildingTarget
  const busy = phase.kind === 'uploading' || building

  // ── Form state (idle / uploading / building) ────────────────────────────
  return (
    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Workshop agreement notice — shown after first publish when Steam
          requires the user to accept the Subscriber Agreement before the
          item becomes visible. Errors are surfaced in the title pill instead
          of here. */}
      {needsAgreementUrl && (
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(234, 179, 8, 0.18)',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            borderRadius: 10,
            fontSize: 12,
            color: '#fde68a',
            lineHeight: 1.5,
          }}
        >
          Workshop agreement required.{' '}
          <a
            href={needsAgreementUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#fbbf24', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Open agreement page ↗
          </a>
        </div>
      )}

      {/* Glass segmented visibility selector — single click = build (if needed) + publish at that visibility */}
      <FieldGroup label={
        building ? 'Building…'
        : phase.kind === 'uploading' ? 'Uploading…'
        : 'Visibility'
      }>
        <GlassSegmented
          options={VISIBILITY_OPTIONS}
          selectedIndex={selectedIndex}
          disabled={busy}
          onClick={(value, index) => handlePublish(value as 0 | 1 | 2 | 3, index)}
        />
      </FieldGroup>

      {isUpdate && (
        <FieldGroup label="Change note (optional)">
          <input
            value={changeNote}
            onChange={e => setChangeNote(e.target.value)}
            disabled={busy}
            placeholder="What changed in this update?"
            maxLength={8000}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.30)'
              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.07)'
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = ''
              e.currentTarget.style.boxShadow = ''
            }}
            style={inputStyle}
          />
        </FieldGroup>
      )}
    </div>
  )
}
