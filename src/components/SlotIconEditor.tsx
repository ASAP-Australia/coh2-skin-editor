/**
 * SlotIconEditor — full-screen overlay for editing a single export-slot icon.
 *
 * WHY THIS EXISTS: lets users swap the per-slot thumbnail (slotIcon) that
 * overrides the procedurally composed tile in the pack-identity popover.
 * Draft state is captured on mount; onSave fires only on explicit "Save".
 * Back arrow / Escape are true no-ops.
 */

import { type CSSProperties, type DragEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { ExportSlot } from '@/lib/project'

interface Props {
  slot: ExportSlot
  /** Called when the user saves a new icon (data URL) or clears it (null). */
  onSave: (next: string | null) => void
  /** Called when the user navigates back without saving. */
  onBack: () => void
}

// Center-crop resize — same algorithm as PackIdentityPopover, 256px target.
function resizeImageFile(file: File, sizePx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = sizePx
        canvas.height = sizePx
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not get 2d context'))
          return
        }
        // Center-crop (object-fit: cover)
        const scale = Math.max(sizePx / img.width, sizePx / img.height)
        const sw = sizePx / scale
        const sh = sizePx / scale
        const sx = (img.width - sw) / 2
        const sy = (img.height - sh) / 2
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sizePx, sizePx)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = src
    }
    reader.onerror = () => reject(new Error('File read failed'))
    reader.readAsDataURL(file)
  })
}

function cap(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s
}
const RESIZE_PX = 256

export function SlotIconEditor({ slot, onSave, onBack }: Props) {
  // Draft state — not committed to parent until Save is clicked.
  const [draft, setDraft] = useState<string | null>(slot.slotIcon ?? null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fade-in: double-rAF triggers the opacity transition after mount.
  // The setVisible runs inside the rAF callback so it's already wrapped
  // by an async boundary — react-hooks/set-state-in-effect does not flag
  // it (no eslint-disable needed).
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true))
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // Keyboard shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onBack()
      if (e.key === 'Enter' && draft !== (slot.slotIcon ?? null)) onSave(draft)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [draft, slot.slotIcon, onSave, onBack])

  // File-processing shared by click-pick and drag-drop.
  const processFile = useCallback(async (file: File) => {
    try {
      const dataUrl = await resizeImageFile(file, RESIZE_PX)
      setDraft(dataUrl)
    } catch {
      // Silently ignore — bad file / non-image
    }
  }, [])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) await processFile(file)
      e.target.value = ''
    },
    [processFile],
  )

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) await processFile(file)
    },
    [processFile],
  )

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setDragOver(false), [])

  const handleCommit = useCallback(() => {
    onSave(draft)
  }, [draft, onSave])

  const handleClear = useCallback(() => {
    onSave(null)
  }, [onSave])

  // Title prefers the slot-position label (e.g. "Summer 1") because
  // `slot.label` defaults to the *pack* name — showing it here would read
  // as "Edit icon — My Skin Pack" which obscures which seasonal slot the
  // user is editing. The custom label (if it differs from the default)
  // appears as the secondary subtitle so it's not lost.
  const positionLabel = `${cap(slot.season)} ${slot.slotIdx + 1}`
  const customLabel = slot.label && slot.label !== positionLabel ? slot.label : null
  const isDirty = draft !== (slot.slotIcon ?? null)

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    background: 'rgba(15, 17, 22, 0.96)',
    backdropFilter: 'blur(40px) saturate(150%)',
    WebkitBackdropFilter: 'blur(40px) saturate(150%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    opacity: visible ? 1 : 0,
    transition: 'opacity 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  }

  const backBtnStyle: CSSProperties = {
    position: 'absolute',
    top: 'calc(12px + var(--app-top-inset, 0px))',
    left: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 10,
    background: 'rgba(15, 17, 22, 0.75)',
    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
    backdropFilter: 'blur(40px) saturate(150%)',
    WebkitBackdropFilter: 'blur(40px) saturate(150%)',
    border: '0.5px solid rgba(255,255,255,0.10)',
    boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.06), 0 4px 12px -4px rgba(0,0,0,0.25)',
    color: 'rgba(247,247,250,0.88)',
    cursor: 'pointer',
  }

  const titleStyle: CSSProperties = {
    position: 'absolute',
    top: 'calc(12px + var(--app-top-inset, 0px))',
    left: '50%',
    transform: 'translateX(-50%)',
    height: 36,
    display: 'flex',
    alignItems: 'center',
    fontSize: 14,
    fontWeight: 700,
    color: 'rgba(247,247,250,0.88)',
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  }

  const dropZoneStyle: CSSProperties = {
    width: 300,
    height: 300,
    borderRadius: 16,
    border: dragOver ? '1.5px solid var(--color-accent)' : '0.5px solid rgba(255,255,255,0.14)',
    background: dragOver ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    overflow: 'hidden',
    transition: 'border-color 120ms ease, background 120ms ease',
    position: 'relative',
  }

  return (
    <div style={overlayStyle}>
      {/* Back button */}
      <button type="button" style={backBtnStyle} onClick={onBack} aria-label="Back">
        <ArrowLeft size={18} strokeWidth={2} />
      </button>

      {/* Title — position-anchored so users always know which slot they
          are editing. A subtitle with the custom slot label (if any)
          appears under it so the data isn't hidden. */}
      <div style={titleStyle}>
        <span>Edit icon — {positionLabel}</span>
        {customLabel ? (
          <span
            style={{
              marginLeft: 10,
              fontSize: 12,
              fontWeight: 500,
              color: 'rgba(247,247,250,0.55)',
            }}
          >
            {customLabel}
          </span>
        ) : null}
      </div>

      {/* Body — vertically centered */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          padding: '80px 24px 40px',
        }}
      >
        {/* Preview / drop zone */}
        <div
          role="button"
          tabIndex={0}
          style={dropZoneStyle}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          aria-label="Drop an image here or click to pick a file"
        >
          {draft ? (
            <img
              src={draft}
              alt="Icon preview"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: 24,
                pointerEvents: 'none',
              }}
            >
              <div style={{ fontSize: 32, lineHeight: 1, color: 'rgba(255,255,255,0.2)' }}>↓</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
                Drop an image here
                <br />
                or click to pick a file
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>
                PNG · JPEG · WebP
              </div>
            </div>
          )}

          {/* Drag-over hint overlay */}
          {dragOver && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.4)',
                color: 'rgba(255,255,255,0.85)',
                fontSize: 13,
                fontWeight: 600,
                pointerEvents: 'none',
              }}
            >
              Drop to set icon
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          aria-label="Choose slot icon"
        />

        {/* Hint under the drop zone */}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', textAlign: 'center' }}>
          Resized to 256×256 on save
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleCommit}
            disabled={!isDirty}
            style={{
              background: isDirty ? 'var(--color-accent)' : 'rgba(255,255,255,0.08)',
              border: 'none',
              borderRadius: 8,
              color: isDirty ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.35)',
              fontSize: 13,
              fontWeight: 700,
              padding: '9px 28px',
              cursor: isDirty ? 'pointer' : 'default',
              transition: 'background 150ms ease, color 150ms ease',
              letterSpacing: '0.02em',
            }}
          >
            Save
          </button>

          {slot.slotIcon && (
            <button
              type="button"
              onClick={handleClear}
              style={{
                background: 'rgba(220,60,60,0.12)',
                border: '0.5px solid rgba(220,60,60,0.3)',
                borderRadius: 8,
                color: 'rgba(255,120,120,0.85)',
                fontSize: 13,
                fontWeight: 600,
                padding: '9px 20px',
                cursor: 'pointer',
              }}
            >
              Clear icon
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
