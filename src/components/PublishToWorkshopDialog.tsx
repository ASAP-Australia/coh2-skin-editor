/**
 * PublishToWorkshopDialog — generic Steam Workshop publish/update dialog.
 *
 * Accepts a project (skin / faceplate / decal-pack discriminated union) and
 * its build artifacts (already-built SGA bytes + a preview canvas), then:
 *
 *   1. Lets the user review / tweak the metadata (title, description,
 *      visibility, change note for updates).
 *   2. Generates a 512×512 preview PNG from the preview canvas (or lets
 *      the user pick a custom PNG).
 *   3. Creates a temp dir via `makeTmpPublishDir()`, writes the SGA +
 *      preview PNG there, and calls `steam.workshop.publish` or `.update`.
 *   4. On needsAgreement, shows a yellow banner linking to the agreement
 *      acceptance page.
 *   5. On success, shows a "View on Workshop" link + Done button.
 *   6. On error, shows a red banner with the error message.
 *
 * The dialog is stateless with regard to the build step — callers
 * (TopBar ExportPanel, FaceplateEditor, DecalPackEditor) are responsible
 * for building the SGA first and passing the bytes in. This keeps the
 * dialog thin and testable.
 */

import { useCallback, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { isElectron, makeTmpPublishDir, writeFile } from '@/lib/native-fs'
import type {
  PublishWorkshopInput,
  PublishWorkshopResult,
  UpdateWorkshopResult,
} from '@/lib/native-fs'
import type { Coh2SkinProject } from '@/lib/project'
import type { Coh2FaceplateProject } from '@/lib/faceplate-project'
import type { Coh2DecalPackProject } from '@/lib/decal-pack-project'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkshopProjectType = 'skin' | 'faceplate' | 'decal'

export interface WorkshopPublishTarget {
  type: WorkshopProjectType
  /** Display name for the pack. */
  packName: string
  /** Long description. */
  description: string
  /** Current workshopId — present and ≤5e9 means real Workshop ID → update. */
  workshopId?: string
  /** SGA bytes produced by the build pipeline. */
  sgaBytes: Uint8Array
  /** SGA filename (e.g. `<guid>.sga`). */
  sgaFilename: string
  /** Canvas to use for the auto-generated preview thumbnail.
   *  Must be drawable; the dialog renders it to a 512×512 PNG. */
  previewCanvas: HTMLCanvasElement | null
  /** Called after a successful publish with the new workshopId.
   *  The parent editor should persist this id into the project. */
  onPublished: (workshopId: string) => void
}

interface Props {
  open: boolean
  onClose: () => void
  target: WorkshopPublishTarget
}

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

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'success'; workshopId: string; needsAgreement: boolean }
  | { kind: 'error'; message: string }

export default function PublishToWorkshopDialog({ open, onClose, target }: Props) {
  const isUpdate = isRealWorkshopId(target.workshopId)

  const [title, setTitle] = useState(target.packName)
  const [description, setDescription] = useState(target.description)
  const [visibility, setVisibility] = useState<0 | 1 | 2 | 3>(0)
  const [changeNote, setChangeNote] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  // Preview image state: null = use auto-generated, string = custom data URL
  const [customPreviewDataUrl, setCustomPreviewDataUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-generate a 512×512 PNG from the preview canvas
  const generatePreviewPng = useCallback((): Uint8Array | null => {
    const src = target.previewCanvas
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
  }, [target.previewCanvas])

  const handleCustomPreview = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setCustomPreviewDataUrl(reader.result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handlePublish = useCallback(async () => {
    if (!isElectron()) {
      setPhase({ kind: 'error', message: 'Publishing is only available in the desktop app.' })
      return
    }

    setPhase({ kind: 'uploading' })

    try {
      // 1. Make temp dir
      const tmpDir = await makeTmpPublishDir()

      // 2. Write SGA bytes to temp dir
      const sgaPath = `${tmpDir}/${target.sgaFilename}`
      await writeFile(sgaPath, target.sgaBytes.buffer as ArrayBuffer)

      // 3. Write preview PNG to temp dir
      let previewPath: string
      if (customPreviewDataUrl) {
        // Custom preview — decode base64 → bytes
        const b64 = customPreviewDataUrl.replace(/^data:[^;]+;base64,/, '')
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        previewPath = `${tmpDir}/preview.png`
        await writeFile(previewPath, bytes.buffer as ArrayBuffer)
      } else {
        const pngBytes = generatePreviewPng()
        if (!pngBytes) throw new Error('Failed to generate preview image. Make sure the editor canvas is loaded.')
        previewPath = `${tmpDir}/preview.png`
        await writeFile(previewPath, pngBytes.buffer as ArrayBuffer)
      }

      // 4. Build publish input
      const tagsByType: Record<WorkshopProjectType, string[]> = {
        skin: ['Skin'],
        faceplate: ['Faceplate'],
        decal: ['Decal'],
      }
      const input: PublishWorkshopInput = {
        contentPath: tmpDir,
        previewPath,
        title: title.trim() || target.packName,
        description: description.trim(),
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
    }
  }, [
    target,
    title,
    description,
    visibility,
    changeNote,
    customPreviewDataUrl,
    generatePreviewPng,
    isUpdate,
  ])

  const handleClose = () => {
    // Reset ephemeral state on close so re-opening feels fresh
    setPhase({ kind: 'idle' })
    setChangeNote('')
    setCustomPreviewDataUrl(null)
    onClose()
  }

  const busy = phase.kind === 'uploading'
  const success = phase.kind === 'success'

  // The preview thumbnail to show in the sidebar
  const previewThumbUrl: string | null = (() => {
    if (customPreviewDataUrl) return customPreviewDataUrl
    if (!target.previewCanvas) return null
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(target.previewCanvas, 0, 0, 128, 128)
      return c.toDataURL('image/png')
    } catch {
      return null
    }
  })()

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent
        className="max-w-lg w-full"
        style={{
          background: 'rgba(10, 11, 14, 0.96)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20,
          boxShadow: '0 32px 80px -24px rgba(0,0,0,0.7)',
          color: 'rgba(247,247,250,0.92)',
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'white', fontSize: 18, fontWeight: 700 }}>
            {isUpdate ? 'Update Workshop Item' : 'Publish to Workshop'}
          </DialogTitle>
        </DialogHeader>

        {/* Success state */}
        {success && phase.kind === 'success' && (
          <SuccessView
            workshopId={phase.workshopId}
            needsAgreement={phase.needsAgreement}
            onDone={handleClose}
          />
        )}

        {/* Form state (idle / uploading / error) */}
        {!success && (
          <div className="space-y-4">
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

            {/* Two-column: form fields + preview thumbnail */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {/* Form fields */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <FieldGroup label="Title">
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    disabled={busy}
                    maxLength={128}
                    placeholder={target.packName}
                    className="w-full"
                    style={inputStyle}
                  />
                </FieldGroup>

                <FieldGroup label="Description">
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    disabled={busy}
                    rows={4}
                    placeholder="Describe your mod for Workshop browsers…"
                    style={{ ...inputStyle, resize: 'vertical' as const, minHeight: 80 }}
                  />
                </FieldGroup>

                <FieldGroup label="Visibility">
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

              {/* Preview thumbnail */}
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                <div
                  style={{
                    width: 112,
                    height: 112,
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.10)',
                    background: 'rgba(255,255,255,0.03)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {previewThumbUrl ? (
                    <img
                      src={previewThumbUrl}
                      alt="Workshop preview thumbnail"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ fontSize: 11, color: 'rgba(247,247,250,0.3)', textAlign: 'center', padding: 8 }}>
                      No preview
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    fontSize: 10,
                    color: 'var(--color-accent, #d97706)',
                    background: 'none',
                    border: 'none',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  Upload custom PNG
                </button>
                {customPreviewDataUrl && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCustomPreviewDataUrl(null)}
                    style={{
                      fontSize: 10,
                      color: 'rgba(247,247,250,0.4)',
                      background: 'none',
                      border: 'none',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      padding: 0,
                    }}
                  >
                    Use auto-generated
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleCustomPreview}
                />
                <div style={{ fontSize: 9, color: 'rgba(247,247,250,0.28)', textAlign: 'center', maxWidth: 112 }}>
                  512×512 min recommended
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer (only shown when not in success state) */}
        {!success && (
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={busy}
              style={{ color: 'rgba(247,247,250,0.55)' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePublish}
              disabled={busy}
              style={{
                background: busy ? 'rgba(217,119,6,0.4)' : 'var(--color-accent, #d97706)',
                color: busy ? 'rgba(0,0,0,0.5)' : '#000',
                fontWeight: 700,
                borderRadius: 10,
                minWidth: 130,
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
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Success view
// ---------------------------------------------------------------------------

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
// Helper sub-components
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

function SmallSpinner() {
  return (
    <>
      <style>{`@keyframes ptw-spin { to { transform: rotate(360deg); } }`}</style>
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
          animation: 'ptw-spin 0.8s linear infinite',
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Helper: project-type factory (used by editor integration hooks below)
// ---------------------------------------------------------------------------

/**
 * Build a `WorkshopPublishTarget` for a skin project. The caller must supply
 * the already-built SGA bytes (from exportSkinPack / patchExport) and a
 * canvas to use as the preview thumbnail.
 */
export function makeSkinPublishTarget(
  project: Coh2SkinProject,
  sgaBytes: Uint8Array,
  sgaFilename: string,
  previewCanvas: HTMLCanvasElement | null,
  onPublished: (workshopId: string) => void,
): WorkshopPublishTarget {
  return {
    type: 'skin',
    packName: project.packName,
    description: project.packDescription,
    workshopId: project.workshopId,
    sgaBytes,
    sgaFilename,
    previewCanvas,
    onPublished,
  }
}

/**
 * Build a `WorkshopPublishTarget` for a faceplate project.
 */
export function makeFaceplatePublishTarget(
  project: Coh2FaceplateProject,
  sgaBytes: Uint8Array,
  sgaFilename: string,
  previewCanvas: HTMLCanvasElement | null,
  onPublished: (workshopId: string) => void,
): WorkshopPublishTarget {
  return {
    type: 'faceplate',
    packName: project.packName,
    description: project.packDescription,
    workshopId: project.workshopId,
    sgaBytes,
    sgaFilename,
    previewCanvas,
    onPublished,
  }
}

/**
 * Build a `WorkshopPublishTarget` for a decal-pack project.
 */
export function makeDecalPublishTarget(
  project: Coh2DecalPackProject,
  sgaBytes: Uint8Array,
  sgaFilename: string,
  previewCanvas: HTMLCanvasElement | null,
  onPublished: (workshopId: string) => void,
): WorkshopPublishTarget {
  return {
    type: 'decal',
    packName: project.packName,
    description: project.packDescription,
    workshopId: project.workshopId,
    sgaBytes,
    sgaFilename,
    previewCanvas,
    onPublished,
  }
}
