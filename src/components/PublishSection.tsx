/**
 * PublishSection — inline publish form for use inside PackIdentityPopover.
 *
 * Renders the Steam Workshop publish/update form inline (no Dialog wrapper).
 * Used by FaceplateEditor and DecalPackEditor as a `publishSection` prop on
 * PackIdentityPopover. The skin-pack ExportPanel callsite still uses the
 * standalone PublishToWorkshopDialog (different chrome context).
 *
 * State machine:
 *   idle (no target)   → shows "Build & Publish" button calling onRequestBuild
 *   idle (has target)  → shows full form (title, desc, visibility, preview, change note)
 *   uploading          → inputs locked, spinner in submit button; calls onUploadStart
 *   success            → SuccessView; calls onUploadEnd
 *   error              → red banner above form; calls onUploadEnd
 *
 * The component owns form draft state and the phase state machine.
 * The parent owns the build step (isBuildingTarget / onRequestBuild).
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AnimatedSwap } from '@/components/ui/animated-swap'
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
}

// ---------------------------------------------------------------------------
// Phase state machine
// ---------------------------------------------------------------------------

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'success'; workshopId: string; needsAgreement: boolean }
  | { kind: 'error'; message: string }

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

const VISIBILITY_DESCRIPTIONS: Record<0 | 1 | 2 | 3, string> = {
  0: 'Anyone can find and subscribe via Workshop browse and search.',
  1: 'Only your Steam friends can see and subscribe.',
  2: 'Only you can see this item. No one else can download it.',
  3: 'Hidden from Workshop browse and search. Anyone with the direct link can subscribe.',
}

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
}

// ---------------------------------------------------------------------------
// Sub-components (verbatim equivalents from PublishToWorkshopDialog)
// ---------------------------------------------------------------------------

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase' as const,
          letterSpacing: '1.5px',
          color: 'rgba(247,247,250,0.4)',
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

function SmallSpinner() {
  return (
    <>
      <style>{`@keyframes ps-spin { to { transform: rotate(360deg); } }`}</style>
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          display: 'inline-block',
          flex: 'none',
          borderRadius: '50%',
          background:
            'conic-gradient(from 0deg, transparent 0%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.85) 100%)',
          WebkitMask: 'radial-gradient(circle, transparent 4px, #000 4.5px)',
          mask: 'radial-gradient(circle, transparent 4px, #000 4.5px)',
          animation: 'ps-spin 0.8s linear infinite',
        }}
      />
    </>
  )
}

function SuccessView({
  workshopId,
  needsAgreement,
  onDone,
}: {
  workshopId: string
  needsAgreement: boolean
  onDone: () => void
}) {
  const itemUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`
  const agreementUrl = `https://steamcommunity.com/sharedfiles/itemedittext/?id=${workshopId}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          background: 'rgba(34, 197, 94, 0.14)',
          border: '1px solid rgba(34, 197, 94, 0.35)',
          borderRadius: 10,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="11" fill="oklch(0.78 0.18 150)" />
          <path
            d="M7 12.5 L10.5 16 L17 9"
            stroke="#0b1410"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <div style={{ fontSize: 14, color: '#86efac', fontWeight: 600 }}>
          Item published to Steam Workshop
        </div>
      </div>

      {/* Subscriber Agreement banner */}
      {needsAgreement && (
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
          You need to accept the Workshop Subscriber Agreement before this item is visible.{' '}
          <a
            href={agreementUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#fbbf24', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Open Agreement page in browser
          </a>{' '}
          then come back and it will be live.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <a
          href={itemUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 40,
            borderRadius: 10,
            background: 'rgba(217,119,6,0.85)',
            color: '#000',
            fontWeight: 700,
            fontSize: 13,
            textDecoration: 'none',
            transition: 'background 0.12s',
          }}
        >
          View on Workshop ↗
        </a>
        <Button
          variant="ghost"
          onClick={onDone}
          style={{ height: 40, color: 'rgba(247,247,250,0.6)' }}
        >
          Done
        </Button>
      </div>
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
}: PublishSectionProps) {
  const isUpdate = isRealWorkshopId(target?.workshopId)

  // selectedIndex = position in VISIBILITY_OPTIONS array (0 = Unlisted, 3 = Public)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const visibility = VISIBILITY_OPTIONS[selectedIndex]!.value
  const [changeNote, setChangeNote] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  // Reset phase when target transitions from non-null back to null
  // (popover was closed and re-opened → fresh start). setState in effect
  // is intentional here: we sync form state to the incoming target value,
  // bounded to one extra render per target change, not a loop.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset-on-target-change */
  useEffect(() => {
    if (target === null) {
      setPhase({ kind: 'idle' })
      setChangeNote('')
      setSelectedIndex(0)
    } else {
      setPhase({ kind: 'idle' })
      setSelectedIndex(0)
    }
  }, [target])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Generate a 1024×1024 high-quality preview PNG from the preview canvas.
  // Uses OffscreenCanvas with step-down rendering and a dark gradient background
  // so Steam doesn't have to upscale a tiny source (e.g. the 64×64 decal icon).
  const buildPreviewPng = useCallback(async (): Promise<Uint8Array | null> => {
    const src = target?.previewCanvas
    if (!src) return null
    try {
      return await generateWorkshopPreview(src, target?.packName)
    } catch {
      return null
    }
  }, [target])

  const handlePublish = useCallback(async (clickedVisibility: 0 | 1 | 2 | 3, clickedIndex: number) => {
    if (!target) return

    if (!isElectron()) {
      setPhase({ kind: 'error', message: 'Publishing is only available in the desktop app.' })
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
      if (isUpdate && target.workshopId) {
        const result: UpdateWorkshopResult = await window.electronAPI!.steam.workshop.update(
          target.workshopId,
          input,
        )
        setPhase({ kind: 'success', workshopId: target.workshopId, needsAgreement: result.needsAgreement })
        target.onPublished(target.workshopId)
      } else {
        const result: PublishWorkshopResult = await window.electronAPI!.steam.workshop.publish(input)
        setPhase({ kind: 'success', workshopId: result.workshopId, needsAgreement: result.needsAgreement })
        target.onPublished(result.workshopId)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setPhase({ kind: 'error', message: msg })
    } finally {
      onUploadEnd?.()
    }
  }, [
    target,
    changeNote,
    buildPreviewPng,
    isUpdate,
    onUploadStart,
    onUploadEnd,
  ])

  const busy = phase.kind === 'uploading'
  const success = phase.kind === 'success'

  // ── Idle: no target yet — show Build & Publish trigger ──────────────────
  if (!target) {
    return (
      <div style={{ marginTop: 4 }}>
        <Button
          onClick={onRequestBuild}
          disabled={isBuildingTarget}
          style={{
            width: '100%',
            background: isBuildingTarget
              ? 'rgba(217,119,6,0.4)'
              : 'var(--color-accent, #d97706)',
            color: isBuildingTarget ? 'rgba(0,0,0,0.5)' : '#000',
            fontWeight: 700,
            borderRadius: 10,
          }}
        >
          {isBuildingTarget ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SmallSpinner />
              Building…
            </span>
          ) : (
            '↑ Build & Publish to Workshop'
          )}
        </Button>
      </div>
    )
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (success && phase.kind === 'success') {
    return (
      <div style={{ marginTop: 4 }}>
        <SuccessView
          workshopId={phase.workshopId}
          needsAgreement={phase.needsAgreement}
          onDone={() => setPhase({ kind: 'idle' })}
        />
      </div>
    )
  }

  // ── Form state (idle with target / uploading / error) ───────────────────
  return (
    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Error banner */}
      {phase.kind === 'error' && (
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(220, 38, 38, 0.18)',
            border: '1px solid rgba(220, 38, 38, 0.4)',
            borderRadius: 10,
            color: '#fca5a5',
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {phase.message}
        </div>
      )}

      {/* Glass segmented visibility selector — single click = publish at that visibility */}
      <FieldGroup label={busy ? (isUpdate ? 'Updating at visibility…' : 'Publishing at visibility…') : (isUpdate ? 'Update at visibility' : 'Publish at visibility')}>
        {/* Outer glass track */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            width: '100%',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.04)',
            padding: 4,
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxSizing: 'border-box',
            // CSS custom property drives the sliding pill position
            ['--selected-index' as string]: String(selectedIndex),
          }}
        >
          {/* Sliding highlight pill — absolutely positioned, slides via CSS left */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 4,
              bottom: 4,
              // width is (trackWidth - 2*padding) / numOptions; padding=4px each side
              width: 'calc((100% - 8px) / 4)',
              left: 'calc(4px + ((100% - 8px) / 4) * var(--selected-index, 0))',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.11)',
              boxShadow: '0 1px 0 rgba(255,255,255,0.15) inset, 0 0 0 1px rgba(255,255,255,0.07)',
              transition: 'left 300ms cubic-bezier(.32, .72, 0, 1)',
              pointerEvents: 'none',
            }}
          />
          {/* Option buttons rendered above the pill */}
          {VISIBILITY_OPTIONS.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              disabled={busy}
              onClick={() => handlePublish(opt.value, i)}
              style={{
                position: 'relative',
                zIndex: 1,
                flex: 1,
                padding: '6px 2px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: selectedIndex === i ? 600 : 500,
                border: 'none',
                background: 'transparent',
                cursor: busy ? 'progress' : 'pointer',
                color: selectedIndex === i
                  ? 'rgba(247,247,250,0.95)'
                  : 'rgba(247,247,250,0.52)',
                transition: 'color 200ms ease',
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap' as const,
                overflow: 'hidden' as const,
                textOverflow: 'ellipsis' as const,
              }}
            >
              {busy && selectedIndex === i ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <SmallSpinner />
                  {opt.label}
                </span>
              ) : (
                opt.label
              )}
            </button>
          ))}
        </div>

        {/* Visibility description — fades between options with AnimatedSwap */}
        <AnimatedSwap swapKey={visibility} block>
          <p style={{ fontSize: 12, color: 'rgba(247,247,250,0.50)', margin: 0, marginTop: 7, lineHeight: 1.45 }}>
            {VISIBILITY_DESCRIPTIONS[visibility]}
          </p>
        </AnimatedSwap>
      </FieldGroup>

      {isUpdate && (
        <FieldGroup label="Change note (optional)">
          <input
            value={changeNote}
            onChange={e => setChangeNote(e.target.value)}
            disabled={busy}
            placeholder="What changed in this update?"
            maxLength={8000}
            style={inputStyle}
          />
        </FieldGroup>
      )}
    </div>
  )
}
