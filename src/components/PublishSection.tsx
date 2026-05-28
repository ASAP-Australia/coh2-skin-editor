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
import { isElectron, makeTmpPublishDir, writeFile } from '@/lib/native-fs'
import type {
  PublishWorkshopInput,
  PublishWorkshopResult,
  UpdateWorkshopResult,
} from '@/lib/native-fs'
import type { WorkshopPublishTarget, WorkshopProjectType } from '@/components/PublishToWorkshopDialog'

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

const VISIBILITY_OPTIONS: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: 'Public' },
  { value: 1, label: 'Friends only' },
  { value: 2, label: 'Private' },
  { value: 3, label: 'Unlisted' },
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

  const [visibility, setVisibility] = useState<0 | 1 | 2 | 3>(0)
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
    } else {
      setPhase({ kind: 'idle' })
    }
  }, [target])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-generate a 512×512 PNG from the preview canvas
  const generatePreviewPng = useCallback((): Uint8Array | null => {
    const src = target?.previewCanvas
    if (!src) return null
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 512
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(src, 0, 0, 512, 512)
      const dataUrl = c.toDataURL('image/png')
      const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    } catch {
      return null
    }
  }, [target?.previewCanvas])

  const handlePublish = useCallback(async () => {
    if (!target) return

    if (!isElectron()) {
      setPhase({ kind: 'error', message: 'Publishing is only available in the desktop app.' })
      onUploadEnd?.()
      return
    }

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
      const pngBytes = generatePreviewPng()
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
        visibility,
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
    visibility,
    changeNote,
    generatePreviewPng,
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

      {/* Visibility selector */}
      <FieldGroup label="Visibility">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {VISIBILITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={busy}
                onClick={() => setVisibility(opt.value)}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 500,
                  border: '1px solid',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  transition: 'all 0.12s',
                  borderColor:
                    visibility === opt.value
                      ? 'var(--color-accent, #d97706)'
                      : 'rgba(255,255,255,0.12)',
                  background:
                    visibility === opt.value
                      ? 'rgba(217, 119, 6, 0.22)'
                      : 'rgba(255,255,255,0.04)',
                  color:
                    visibility === opt.value
                      ? '#fbbf24'
                      : 'rgba(247,247,250,0.65)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'rgba(247,247,250,0.55)', margin: 0, marginTop: 2 }}>
            {VISIBILITY_DESCRIPTIONS[visibility]}
          </p>
        </div>
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

      {/* Submit button */}
      <Button
        onClick={handlePublish}
        disabled={busy}
        style={{
          background: busy ? 'rgba(217,119,6,0.4)' : 'var(--color-accent, #d97706)',
          color: busy ? 'rgba(0,0,0,0.5)' : '#000',
          fontWeight: 700,
          borderRadius: 10,
          width: '100%',
        }}
      >
        {busy ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SmallSpinner />
            Uploading…
          </span>
        ) : isUpdate ? (
          'Update Workshop Item'
        ) : (
          'Publish to Workshop'
        )}
      </Button>
    </div>
  )
}
