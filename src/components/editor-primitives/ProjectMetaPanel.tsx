/**
 * ProjectMetaPanel — inline editor for the three identity fields of a
 * Coh2FaceplateProject / Coh2DecalPackProject (`author`, `packName`,
 * `packDescription`).
 *
 * Docks under the EditorHomeButton (top-left of every editor surface) so
 * the user can rename / re-author a pack without leaving the canvas or
 * digging through a settings dialog. The panel renders as a thin glass
 * card with three labeled fields in the explicit order the user spec'd:
 *
 *   1. Author          (single-line)
 *   2. Name            (single-line, used as the in-game pack title)
 *   3. Description     (multi-line, used as the in-game pack description)
 *
 * Behaviour:
 *   - Uncontrolled — caller passes initial values via `author`, `name`,
 *     and `description`, and the panel calls back via `onChange` on
 *     every keystroke. The caller owns persistence (the editor's
 *     `mutate(p => ...)` flow already pipes through localStorage, recent-
 *     project metadata, and live preview rebuilds).
 *   - The card collapses to a single 28px pill showing "Name · Author"
 *     and expands on click to reveal the three inputs. Click outside
 *     the panel or press Escape to collapse.
 *
 * Visual recipe mirrors EditorHomeButton: same glass background,
 * 12px radius, 0.5px hairline stroke, no-drag region so clicks land
 * on Electron despite sitting in the top drag-strip.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

interface Props {
  /** Current pack author. */
  author: string
  /** Current pack display name (in-game card title). */
  name: string
  /** Current pack description (in-game card body). */
  description: string
  /** Called whenever any of the three fields changes. */
  onChange: (next: { author: string; name: string; description: string }) => void
  /** Inline style override — primarily for positioning (top/left/right). */
  style?: CSSProperties
  /**
   * Optional starting open state. Useful for tests / Storybook previews.
   * Defaults to `false` so the panel sits collapsed and unobtrusive.
   */
  initialOpen?: boolean
}

export default function ProjectMetaPanel({
  author,
  name,
  description,
  onChange,
  style,
  initialOpen = false,
}: Props) {
  const [open, setOpen] = useState(initialOpen)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click + Escape. Mirrors the dismissal contract of
  // every other floating chrome surface in the editors (peel, modal).
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(ev: MouseEvent) {
      if (!rootRef.current) return
      if (ev.target instanceof Node && !rootRef.current.contains(ev.target)) {
        setOpen(false)
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const glass: CSSProperties = {
    background: 'rgba(17, 17, 17, 0.78)',
    backgroundImage:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
    backdropFilter: 'blur(40px) saturate(150%)',
    WebkitBackdropFilter: 'blur(40px) saturate(150%)',
    border: '0.5px solid rgba(255, 255, 255, 0.08)',
    boxShadow: 'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.2)',
    color: 'var(--color-text-2)',
    WebkitAppRegion: 'no-drag',
  } as CSSProperties

  // Collapsed pill — single line showing "Name · Author", click to expand.
  if (!open) {
    return (
      <div
        ref={rootRef}
        style={{
          ...glass,
          height: 28,
          borderRadius: 14,
          padding: '0 12px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: 280,
          cursor: 'pointer',
          ...style,
        }}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        aria-label="Edit pack name, author and description"
        title="Click to edit author / name / description"
        data-testid="project-meta-panel-pill"
        onKeyDown={ev => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'slashed-zero',
            fontSize: 11,
            fontWeight: 600,
            color: 'rgba(245,245,245,0.92)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 160,
          }}
        >
          {name || 'Untitled'}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'slashed-zero',
            fontSize: 10,
            color: 'rgba(245,245,245,0.55)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 100,
          }}
        >
          {author || 'Anonymous'}
        </span>
      </div>
    )
  }

  // Expanded card — three labeled inputs (Author / Name / Description).
  return (
    <div
      ref={rootRef}
      style={{
        ...glass,
        width: 280,
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        ...style,
      }}
      data-testid="project-meta-panel"
    >
      <MetaField
        label="Author"
        value={author}
        placeholder="Anonymous"
        onChange={v => onChange({ author: v, name, description })}
      />
      <MetaField
        label="Name"
        value={name}
        placeholder="Untitled"
        onChange={v => onChange({ author, name: v, description })}
      />
      <MetaField
        label="Description"
        value={description}
        placeholder="Pack description…"
        multiline
        onChange={v => onChange({ author, name, description: v })}
      />
    </div>
  )
}

interface MetaFieldProps {
  label: string
  value: string
  placeholder?: string
  multiline?: boolean
  onChange: (v: string) => void
}

function MetaField({ label, value, placeholder, multiline, onChange }: MetaFieldProps) {
  const baseInput: CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '0.5px solid rgba(255, 255, 255, 0.10)',
    borderRadius: 6,
    padding: '6px 8px',
    color: 'rgba(245,245,245,0.95)',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'slashed-zero',
    outline: 'none',
    resize: 'vertical',
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'rgba(245,245,245,0.55)',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={ev => onChange(ev.target.value)}
          rows={3}
          style={{ ...baseInput, minHeight: 48, lineHeight: 1.35 }}
          data-testid={`project-meta-${label.toLowerCase()}-input`}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={ev => onChange(ev.target.value)}
          style={baseInput}
          data-testid={`project-meta-${label.toLowerCase()}-input`}
        />
      )}
    </label>
  )
}
