/**
 * TemplatePicker — dropdown that lets the user seed a new project from
 * either a blank canvas, one of their previously-saved projects, or an
 * existing Steam Workshop subscription.
 *
 * Shape
 * ─────
 * Closed: a single button row showing the current selection (defaults to
 * "Blank"). Clicking it expands a 320px panel below with three sections:
 *
 *   1. Blank          — always present, always the first item.
 *   2. From saved     — the user's local recent projects of the matching
 *                       kind (faceplate / decal pack / skin pack).
 *   3. From Workshop  — Steam Workshop subscribed items detected on the
 *                       user's CoH2 install. Listed by Workshop ID +
 *                       optional name (we don't parse the .sga inside
 *                       this component — caller hands us a `name` field
 *                       when it knows one).
 *
 * Hover preview
 * ─────────────
 * Hovering an option for ≥120ms shows a small floating preview card to
 * the right of the dropdown. The card shows the option's thumbnail (when
 * supplied) at a comfortable 160×160px, with the option's name + a
 * source badge (Saved / Workshop). When no thumbnail is available we
 * fall back to a placeholder block with the option's name — the picker
 * still works, the user just doesn't see a real image.
 *
 * Selection contract
 * ──────────────────
 * The caller owns the selection state — the picker is fully controlled
 * via `value` + `onChange`. Selecting an option DOES NOT load its
 * contents; that's the caller's job (we don't know the schema). The
 * caller typically:
 *
 *   - On submit with `kind: 'blank'`: calls newFaceplate/Decal/Project
 *     and persists.
 *   - On submit with `kind: 'saved'`: calls loadFaceplateById /
 *     loadDecalPackById / loadRecentProject with the option's `id`,
 *     deep-clones the result, assigns a fresh id, then persists.
 *   - On submit with `kind: 'workshop'`: TODO in a follow-up iteration
 *     — for now we surface the option but the caller treats it as a
 *     name-only seed (project starts blank, name pre-fills from the
 *     workshop item's display name).
 *
 * Why a separate component
 * ────────────────────────
 * All three new-project forms (NewFaceplateForm, NewDecalPackForm,
 * NewProjectForm) need the same picker. Inlining it in each one would
 * triplicate ~250 lines of dropdown / hover-preview machinery and let
 * the three forms drift in look-and-feel. The picker keeps zero
 * knowledge of the underlying project schemas — it operates entirely
 * on opaque option records.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronDown, Sparkles, FolderOpen, Cloud, Package } from 'lucide-react'

/** Source of a template — drives the section header and badge styling. */
export type TemplateKind = 'blank' | 'saved' | 'stock' | 'workshop'

export interface TemplateOption {
  /** Stable id within the picker. For 'saved' use the project id; for
   *  'workshop' use the Workshop ID; for 'blank' use the literal 'blank'. */
  id: string
  /** Source — selects which section the option appears under. */
  kind: TemplateKind
  /** User-visible label. For 'saved' use the project's packName; for
   *  'workshop' use the item's display name (or "Workshop #<id>" when
   *  unknown); for 'blank' use the literal 'Blank canvas'. */
  name: string
  /** Optional subtitle line. Examples:
   *    'saved'    → "12 layers · 3 days ago"
   *    'workshop' → "Workshop ID 1234567890"
   *    'blank'    → "Start fresh with the default arrow background"
   */
  hint?: string
  /** Optional preview thumbnail (base64 data URL or absolute http(s) URL).
   *  Faceplate recent entries have these natively (they're written on
   *  every save). Decal-pack and skin-pack recent entries don't yet —
   *  the hover preview shows a placeholder block for those. Workshop
   *  items will get them once SGA → DDS extraction lands. */
  thumbnail?: string | null
}

interface Props {
  /** Currently selected option id. The caller seeds this with 'blank'
   *  on mount; the picker drives subsequent updates via `onChange`. */
  value: string
  /** Called when the user picks any option. The picker closes itself
   *  after a successful selection. */
  onChange: (option: TemplateOption) => void
  /** Full set of options. The picker handles bucketing into sections
   *  automatically based on each option's `kind`. The 'blank' option
   *  is REQUIRED — the picker asserts on its absence. */
  options: TemplateOption[]
  /** Whether the picker is disabled (e.g. form is submitting). Closed
   *  pickers can't be re-opened; an open picker stays open but the
   *  buttons inside don't fire. */
  disabled?: boolean
  /** Optional test/Storybook flag to start open. */
  initialOpen?: boolean
}

const SECTION_LABEL: Record<TemplateKind, string> = {
  blank: 'Start fresh',
  saved: 'From your saved projects',
  stock: 'From game files',
  workshop: 'From Steam Workshop',
}

const SECTION_ICON: Record<TemplateKind, typeof Sparkles> = {
  blank: Sparkles,
  saved: FolderOpen,
  stock: Package,
  workshop: Cloud,
}

export default function TemplatePicker({
  value,
  onChange,
  options,
  disabled = false,
  initialOpen = false,
}: Props) {
  const [open, setOpen] = useState(initialOpen)
  const [hovered, setHovered] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.id === value) ?? options[0]
  const SelectedIcon = selected ? SECTION_ICON[selected.kind] : Sparkles

  // Outside-click + Escape close. Skip when the picker isn't open so we
  // don't leak listeners on idle forms.
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

  // Group options by section so we can render headers in a single pass.
  // 'workshop' is intentionally excluded — the on-submit handler is not
  // yet wired (see TODO in file header) so we hide it to avoid a broken
  // affordance. The 'workshop' TemplateKind type member is retained for
  // future use; options with kind:'workshop' are silently dropped here.
  const grouped: Record<Exclude<TemplateKind, 'workshop'>, TemplateOption[]> = {
    blank: [],
    saved: [],
    stock: [],
  }
  for (const o of options) {
    if (o.kind !== 'workshop') grouped[o.kind].push(o)
  }

  const hoveredOption = hovered ? options.find(o => o.id === hovered) : null

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', width: '100%' }}
      data-testid="template-picker-root"
    >
      {/* Trigger row */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        data-testid="template-picker-trigger"
        data-state={open ? 'open' : 'closed'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose template"
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg
                   bg-black/30 border border-white/10
                   hover:bg-black/40 hover:border-white/20
                   focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40
                   transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        <SelectedIcon size={14} className="text-white/60 shrink-0" aria-hidden />
        <span className="text-[13px] text-white flex-1 truncate">
          {selected?.name ?? 'Blank canvas'}
        </span>
        <ChevronDown
          size={14}
          className="text-white/40 shrink-0 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="listbox"
          aria-label="Available templates"
          data-testid="template-picker-panel"
          style={panelStyle}
        >
          {(['blank', 'saved', 'stock'] as Exclude<TemplateKind, 'workshop'>[]).map(kind => {
            const items = grouped[kind]
            // 'blank' always shown; others suppressed when empty so the
            // panel doesn't show empty section headers.
            if (kind !== 'blank' && items.length === 0) return null
            return (
              <Section
                key={kind}
                kind={kind}
                items={items}
                selectedId={value}
                hoveredId={hovered}
                onHover={setHovered}
                onPick={opt => {
                  onChange(opt)
                  setOpen(false)
                  setHovered(null)
                }}
              />
            )
          })}
        </div>
      )}

      {/* Hover preview card */}
      {open && hoveredOption && (
        <div
          role="tooltip"
          aria-label={`Preview of ${hoveredOption.name}`}
          data-testid="template-picker-preview"
          style={previewStyle}
        >
          {hoveredOption.thumbnail ? (
            <img
              src={hoveredOption.thumbnail}
              alt={hoveredOption.name}
              style={{
                width: 160,
                height: 160,
                objectFit: 'cover',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
              }}
            />
          ) : (
            <div style={previewPlaceholderStyle}>
              <span style={{ fontSize: 10, color: 'rgba(247,247,250,0.5)' }}>No preview</span>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(247,247,250,0.92)' }}>
            {hoveredOption.name}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 9,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'rgba(247,247,250,0.5)',
            }}
          >
            {hoveredOption.kind === 'blank'
              ? 'Default'
              : hoveredOption.kind === 'saved'
                ? 'Saved project'
                : hoveredOption.kind === 'stock'
                  ? 'Game files'
                  : 'Workshop'}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Section ────────────────────────────────────────────────────────────────

interface SectionProps {
  kind: TemplateKind
  items: TemplateOption[]
  selectedId: string
  hoveredId: string | null
  onHover: (id: string | null) => void
  onPick: (opt: TemplateOption) => void
}

function Section({ kind, items, selectedId, hoveredId, onHover, onPick }: SectionProps) {
  const Icon = SECTION_ICON[kind]
  return (
    <div data-testid={`template-picker-section-${kind}`}>
      <div style={sectionHeaderStyle}>
        <Icon size={10} aria-hidden />
        <span>{SECTION_LABEL[kind]}</span>
      </div>
      {items.length === 0 ? (
        <div style={emptyHintStyle}>
          {kind === 'saved'
            ? 'No saved projects of this kind yet.'
            : kind === 'stock'
              ? 'No game SGAs detected — check CoH2 install path.'
              : 'No workshop subscriptions detected.'}
        </div>
      ) : (
        items.map(opt => {
          const isSelected = opt.id === selectedId
          const isHovered = opt.id === hoveredId
          return (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              data-testid={`template-picker-option-${opt.id}`}
              onClick={() => onPick(opt)}
              onMouseEnter={() => onHover(opt.id)}
              // Only clear when this option WAS the hovered one — the
              // adjacent option's mouseenter will fire next and immediately
              // replace it, so the preview card doesn't flicker between
              // hover transitions.
              onMouseLeave={() => {
                if (hoveredId === opt.id) onHover(null)
              }}
              onFocus={() => onHover(opt.id)}
              style={{
                ...optionStyle,
                background: isSelected
                  ? 'rgba(74, 145, 255, 0.18)'
                  : isHovered
                    ? 'rgba(255, 255, 255, 0.06)'
                    : 'transparent',
              }}
            >
              <div style={optionNameStyle}>{opt.name}</div>
              {opt.hint && <div style={optionHintStyle}>{opt.hint}</div>}
            </button>
          )
        })
      )}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  right: 0,
  zIndex: 50,
  maxHeight: 320,
  overflowY: 'auto',
  borderRadius: 12,
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: 'rgba(15, 17, 22, 0.92)',
  backgroundImage: 'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
  backdropFilter: 'blur(40px) saturate(150%)',
  WebkitBackdropFilter: 'blur(40px) saturate(150%)',
  border: '0.5px solid rgba(255, 255, 255, 0.10)',
  boxShadow: 'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 10px 32px rgba(0, 0, 0, 0.55)',
}

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px 4px',
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'rgba(247,247,250,0.45)',
}

const optionStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left' as const,
  padding: '6px 8px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  transition: 'background-color 100ms ease-out',
  fontFamily: 'inherit',
  color: 'inherit',
}

const optionNameStyle: CSSProperties = {
  fontSize: 12,
  color: 'rgba(247,247,250,0.92)',
}

const optionHintStyle: CSSProperties = {
  marginTop: 1,
  fontSize: 10,
  color: 'rgba(247,247,250,0.5)',
}

const emptyHintStyle: CSSProperties = {
  padding: '4px 8px 6px',
  fontSize: 10,
  color: 'rgba(247,247,250,0.4)',
  fontStyle: 'italic',
}

const previewStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 'calc(100% + 12px)',
  zIndex: 51,
  width: 176,
  padding: 8,
  borderRadius: 12,
  background: 'rgba(15, 17, 22, 0.92)',
  backgroundImage: 'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
  backdropFilter: 'blur(40px) saturate(150%)',
  WebkitBackdropFilter: 'blur(40px) saturate(150%)',
  border: '0.5px solid rgba(255, 255, 255, 0.10)',
  boxShadow: 'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 10px 32px rgba(0, 0, 0, 0.55)',
  pointerEvents: 'none',
}

const previewPlaceholderStyle: CSSProperties = {
  width: 160,
  height: 160,
  borderRadius: 8,
  background:
    'repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 6px, rgba(255,255,255,0.02) 6px 12px)',
  border: '0.5px dashed rgba(255,255,255,0.12)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}
