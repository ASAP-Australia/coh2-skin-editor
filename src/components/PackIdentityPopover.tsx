/**
 * PackIdentityPopover — shared glassmorphism popover for editing pack identity
 * fields (name, description, author) and an optional in-game icon.
 *
 * WHY SHARED: FaceplateEditor, DecalPackEditor, and the upcoming SkinPackEditor
 * all had or will have an inline rename popover. Extracting this component
 * ensures a single source of truth for the glass chrome, animation, keyboard
 * handling, and icon-slot logic, rather than three diverging hand-rolled copies.
 *
 * ICON SLOT CONTRACT: When `iconSlot` is provided the popover handles the full
 * read→resize→export pipeline internally (FileReader → offscreen 64×64 Canvas →
 * PNG dataURL). The parent only receives the final base64 data URL via
 * `iconSlot.onChange`. The parent is also responsible for persisting it — the
 * popover itself is stateless with respect to the committed icon.
 *
 * DRAFT STATE: All fields are captured into local draft state when `open` flips
 * true. Edits never reach the parent until `onSave` fires, so pressing Escape
 * or clicking outside genuinely cancels without side-effects.
 */

import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackIdentityPopoverProps {
  /** Controlled open state. Parent owns it so the toggle button can flip it. */
  open: boolean
  /** Called when the popover requests to close (Escape, outside click, Save). */
  onClose: () => void

  /** Pack identity fields — all controlled. */
  name: string
  description: string
  author: string

  /** Called whenever any identity field changes — autosync (no Save button).
   *  Parent batches into a single setProject mutation per keystroke; debouncing
   *  is the parent's choice. The popover always sends the *current* draft for
   *  all three fields so the parent can treat each callback as a snapshot. */
  onSave: (next: { name: string; description: string; author: string }) => void

  /** Optional icon slot. */
  iconSlot?: {
    label: string
    currentDataUrl: string | null
    fallbackHint?: string
    onChange: (next: string | null) => void
    sizePx?: number
  }

  /** Extra content rendered below the icon slot. */
  extraSection?: ReactNode

  /** Optional render slot at the bottom of the popover (after Author). Used by
   *  Faceplate/DecalPack editors to embed the "Publish to Workshop" button here
   *  instead of a separate floating top-right button. */
  publishSlot?: ReactNode

  /** Anchor positioning override — forwarded to the root div. */
  style?: CSSProperties
}

// ---------------------------------------------------------------------------
// Tiny click-outside hook
// ---------------------------------------------------------------------------

function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: () => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [ref, handler, enabled])
}

// ---------------------------------------------------------------------------
// Icon resize helper — reads a File, crops/scales to sizePx×sizePx PNG
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared inline style fragments
// ---------------------------------------------------------------------------

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.06)',
  border: '0.5px solid rgba(255,255,255,0.16)',
  borderRadius: 6,
  color: 'rgba(247,247,250,0.92)',
  fontSize: 13,
  fontWeight: 500,
  padding: '5px 8px',
  outline: 'none',
  fontFamily: 'inherit',
}

const SECTION_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
  marginBottom: 4,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PackIdentityPopover({
  open,
  onClose,
  name,
  description,
  author,
  onSave,
  iconSlot,
  extraSection,
  publishSlot,
  style,
}: PackIdentityPopoverProps) {
  // ----- Draft state -------------------------------------------------------
  const [draftName, setDraftName] = useState(name)
  const [draftDesc, setDraftDesc] = useState(description)
  const [draftAuthor, setDraftAuthor] = useState(author)

  // Capture fresh draft whenever the popover opens. The setStates here
  // intentionally run inside the effect because they read prop values
  // captured at the moment the popover transitions to `open` — the
  // `useState(name)` initialiser would only ever see the first render's
  // values, which is wrong when the parent re-renders with a different
  // pack name. The cascade-render that lint warns about is bounded
  // (open flips at most once per popover lifecycle), so the perf cost
  // is negligible compared to the correctness win.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset-on-open */
  useEffect(() => {
    if (open) {
      setDraftName(name)
      setDraftDesc(description)
      setDraftAuthor(author)
    }
  }, [open, name, description, author])
  /* eslint-enable react-hooks/set-state-in-effect */

  // ----- Animation (mount/unmount with opacity+scale+translateY) -----------
  const ANIM_MS = 180
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  // Mount/visible split lets us run the enter transition on first paint
  // and run the exit transition before unmount. setState in this effect
  // is the canonical pattern for that — there's no external system to
  // sync with, but the schedule (rAF for in, setTimeout for out) needs
  // React state changes at specific times. Lint rule disabled with
  // justification.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional mount/visible transition orchestration */
  useEffect(() => {
    if (open) {
      setMounted(true)
      // Next frame: trigger transition to visible
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
      return () => cancelAnimationFrame(raf)
    } else {
      setVisible(false)
      const t = setTimeout(() => setMounted(false), ANIM_MS)
      return () => clearTimeout(t)
    }
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  // ----- Refs & focus -------------------------------------------------------
  const popoverRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus name input on open — ref callback pattern to satisfy jsx-a11y/no-autofocus
  const nameRefCallback = useCallback(
    (el: HTMLInputElement | null) => {
      // Store in ref for later keyboard use
      ;(nameInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
      if (el && open) el.focus()
    },
    [open],
  )

  // ----- Click outside closes (cancels) ------------------------------------
  const handleClose = useCallback(() => onClose(), [onClose])
  useClickOutside(popoverRef, handleClose, mounted)

  // ----- Autosync helper ----------------------------------------------------
  // No explicit Save button — every keystroke pushes a fresh snapshot to the
  // parent. We still keep draft state so the inputs are controlled locally
  // (the parent's setProject may coalesce or normalise values), but commit
  // happens immediately rather than on a button click. Empty name falls back
  // to the parent's previous name so the user can't accidentally blank it.
  const sync = useCallback(
    (next: { name?: string; description?: string; author?: string }) => {
      const n = next.name ?? draftName
      const d = next.description ?? draftDesc
      const a = next.author ?? draftAuthor
      onSave({ name: n.trim() || name, description: d, author: a })
    },
    [draftName, draftDesc, draftAuthor, name, onSave],
  )

  // ----- Icon pick ----------------------------------------------------------
  const sizePx = iconSlot?.sizePx ?? 64

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file || !iconSlot) return
      try {
        const dataUrl = await resizeImageFile(file, sizePx)
        iconSlot.onChange(dataUrl)
      } catch {
        // Silently ignore — bad file
      }
      // Reset so the same file can be re-picked
      e.target.value = ''
    },
    [iconSlot, sizePx],
  )

  // ----- Early bail ---------------------------------------------------------
  if (!mounted) return null

  // ----- Render -------------------------------------------------------------
  const easing = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
  const transition = `opacity ${ANIM_MS}ms ${easing}, transform ${ANIM_MS}ms ${easing}`

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      aria-label="Pack identity"
      style={{
        position: 'absolute',
        top: 44,
        left: '50%',
        transform: visible
          ? 'translateX(-50%) translateY(0) scale(1)'
          : 'translateX(-50%) translateY(-4px) scale(0.98)',
        opacity: visible ? 1 : 0,
        transition,
        background: 'rgba(20, 22, 28, 0.96)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '0.5px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        padding: '12px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        zIndex: 60,
        width: 320,
        maxHeight: '70vh',
        overflowY: 'auto',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {/* ── Icon slot ─────────────────────────────────────────────────────── */}
      {iconSlot && (
        <div>
          <div style={SECTION_LABEL_STYLE}>{iconSlot.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Preview square */}
            <div
              style={{
                width: sizePx,
                height: sizePx,
                flexShrink: 0,
                borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '0.5px solid rgba(255,255,255,0.14)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {iconSlot.currentDataUrl ? (
                <img
                  src={iconSlot.currentDataUrl}
                  alt="Icon preview"
                  style={{ width: sizePx, height: sizePx, objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <span
                  style={{
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.3)',
                    textAlign: 'center',
                    padding: '4px 6px',
                    lineHeight: 1.3,
                  }}
                >
                  {iconSlot.fallbackHint ?? 'No icon'}
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '0.5px solid rgba(255,255,255,0.18)',
                  borderRadius: 6,
                  color: 'rgba(247,247,250,0.85)',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Replace
              </button>
              {iconSlot.currentDataUrl !== null && (
                <button
                  type="button"
                  onClick={() => iconSlot.onChange(null)}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '0.5px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    color: 'rgba(247,247,250,0.55)',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* ── Name ─────────────────────────────────────────────────────────── */}
      <div>
        <div style={SECTION_LABEL_STYLE}>Name</div>
        <input
          ref={nameRefCallback}
          type="text"
          value={draftName}
          onChange={e => {
            const v = e.target.value
            setDraftName(v)
            sync({ name: v })
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') onClose()
          }}
          placeholder="Pack name"
          style={INPUT_STYLE}
        />
      </div>

      {/* ── Description ───────────────────────────────────────────────────── */}
      <div>
        <div style={SECTION_LABEL_STYLE}>Description</div>
        <textarea
          value={draftDesc}
          onChange={e => {
            const v = e.target.value
            setDraftDesc(v)
            sync({ description: v })
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Short description (optional)"
          rows={3}
          style={{
            ...INPUT_STYLE,
            resize: 'vertical',
            lineHeight: 1.5,
          }}
        />
      </div>

      {/* ── Author ────────────────────────────────────────────────────────── */}
      <div>
        <div style={SECTION_LABEL_STYLE}>Author</div>
        <input
          type="text"
          value={draftAuthor}
          onChange={e => {
            const v = e.target.value
            setDraftAuthor(v)
            sync({ author: v })
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') onClose()
          }}
          placeholder="Your name or handle"
          style={INPUT_STYLE}
        />
      </div>

      {/* ── Extra section (caller-supplied) ──────────────────────────────── */}
      {extraSection}

      {/* ── Publish slot (caller-supplied) ───────────────────────────────── */}
      {publishSlot && (
        <div style={{ marginTop: 4 }}>
          {publishSlot}
        </div>
      )}
    </div>
  )
}
