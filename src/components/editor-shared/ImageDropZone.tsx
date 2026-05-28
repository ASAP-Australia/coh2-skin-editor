/**
 * ImageDropZone — wraps the canvas area to accept image drops, paste events,
 * and file-picker selections. The component is deliberately "dumb": it only
 * handles the raw file/blob hand-off and delegates persistence to the caller
 * via `onImport`.
 *
 * Imperative API: pass a ref to get an `openFilePicker()` handle so the
 * image-library "Add image" button can trigger the hidden <input> without
 * prop-drilling the ref into the canvas wrapper.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface ImageDropZoneHandle {
  /** Programmatically open the OS file picker. */
  openFilePicker(): void
}

export interface ImageDropZoneProps {
  /**
   * Called with the raw file/blob and an optional filename. The caller owns
   * persistence and project mutation — the drop zone is pure UI.
   */
  onImport: (blob: Blob, name?: string) => void
  /** Content rendered inside the drop zone wrapper. */
  children: React.ReactNode
  /** Optional className for the wrapper div. */
  className?: string
  /** Optional inline styles for the wrapper div. */
  style?: React.CSSProperties
  /** Optional pointer-down handler forwarded to the wrapper div. */
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  /**
   * Called when the drag-over state changes. Lets the parent mirror
   * the drag state for styling inner elements (e.g. canvas outline).
   */
  onDragStateChange?: (isDragging: boolean) => void
}

const ImageDropZone = forwardRef<ImageDropZoneHandle, ImageDropZoneProps>(function ImageDropZone(
  { onImport, children, className, style, onPointerDown, onDragStateChange },
  ref,
) {
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    openFilePicker() {
      fileInputRef.current?.click()
    },
  }))

  // ── Clipboard paste ──────────────────────────────────────────────────
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const items = ev.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          ev.preventDefault()
          const blob = item.getAsFile()
          if (blob) onImport(blob, blob.name || 'pasted-image')
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onImport])

  // ── Drag / drop ──────────────────────────────────────────────────────
  const handleDragOver = (ev: React.DragEvent) => {
    ev.preventDefault()
    if (!dragOver) {
      setDragOver(true)
      onDragStateChange?.(true)
    }
  }
  const handleDragLeave = () => {
    setDragOver(false)
    onDragStateChange?.(false)
  }
  const handleDrop = (ev: React.DragEvent) => {
    ev.preventDefault()
    setDragOver(false)
    onDragStateChange?.(false)
    const files = Array.from(ev.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    for (const file of files) onImport(file, file.name)
  }

  // ── File picker ──────────────────────────────────────────────────────
  const handleFileChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(ev.target.files ?? []).filter(f => f.type.startsWith('image/'))
    ev.target.value = ''
    for (const file of files) onImport(file, file.name)
  }

  return (
    <div
      className={className}
      style={style}
      data-drag-over={dragOver || undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPointerDown={onPointerDown}
    >
      {children}

      {/* Hidden file input — triggered imperatively via openFilePicker() */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  )
})

export default ImageDropZone
