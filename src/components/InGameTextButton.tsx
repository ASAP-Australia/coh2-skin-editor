/**
 * InGameTextButton — quick-edit popover for the in-game pack text.
 *
 * Lives in the bottom-dock badge cluster, immediately to the LEFT of the
 * Live Sync badge in both the FaceplateEditor and DecalPackEditor. The
 * button is intentionally NOT a re-purposing of `LiveSyncBadge` — that
 * badge is a single-click on/off toggle (and the error-state fallback for
 * "missing mods folder"), so overloading it with a "open a menu" gesture
 * would be ambiguous to the user.
 *
 * What it edits
 * ─────────────
 * The `name` and `description` strings that the engine renders for the
 * faceplate / decal-pack:
 *
 *   • `name`        — the bold serif title in the hover card and the
 *                     player-badge label (faceplate) / pack header text
 *                     above the decal grid (decal).
 *   • `description` — the body text on the in-game info card (read by the
 *                     game from the `mod.relativechunkydescription` field
 *                     at build time; persisted on the project so Live Sync
 *                     re-emits it).
 *
 * Why a separate quick-editor
 * ───────────────────────────
 * `ProjectMetaPanel` (top-left of the editor) already exposes the same
 * three fields (author / name / description), but the user has to scroll
 * their eyes all the way back to the top-left of the viewport — and on
 * the in-game view mode the editor canvas is covered by the preview
 * overlay anyway. Putting the quick-edit popover next to the Live Sync
 * badge means the user can iterate on the in-game text without leaving
 * the lower-right of the screen where the preview is.
 *
 * Anchoring
 * ─────────
 * The popover is positioned with `position: absolute; bottom: 100%;
 * right: 0` so it floats UP above the button. The badge cluster sits
 * directly above the BottomToolPill, so "above the button" reads as
 * "above the pill" to the user — which is what they asked for.
 *
 * Dismissal
 * ─────────
 * Mirror of `ProjectMetaPanel`'s contract:
 *   • Escape closes it.
 *   • Outside-click closes it.
 *   • Clicking the button while open toggles it shut (so the same gesture
 *     opens AND closes).
 *
 * Persistence
 * ───────────
 * Uncontrolled — caller owns the `name` / `description` values via props
 * and gets `onChange` callbacks. The caller already has a `mutate(p => …)`
 * pipeline wired to localStorage / recent-projects / Live Sync, so a
 * single `onChange` call routes the edit through that path.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Type } from 'lucide-react'

interface Props {
  /** Current in-game pack name (hover-card title / player-badge label). */
  name: string
  /** Current in-game pack description (hover-card body text). */
  description: string
  /**
   * Called whenever either field changes. Caller owns persistence —
   * passing the next pair so the caller can do a single mutate.
   */
  onChange: (next: { name: string; description: string }) => void
  /**
   * Kind of project — only affects the help copy + field labels so the
   * popover reads as "this edits the FACEPLATE text" vs "this edits the
   * DECAL PACK text". The data shape is identical.
   */
  kind: 'faceplate' | 'decal'
  /**
   * Optional initial open state — primarily for tests / Storybook.
   * Defaults to `false` so the button sits collapsed in the badge cluster.
   */
  initialOpen?: boolean
}

const KIND_COPY = {
  faceplate: {
    aria: 'Edit in-game faceplate text',
    title: 'Edit in-game text',
    heading: 'In-game faceplate text',
    hint: 'Shown in the loadout hover card and player badge.',
    nameLabel: 'Name',
    namePlaceholder: 'Faceplate name',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Hover-card description…',
  },
  decal: {
    aria: 'Edit in-game decal pack text',
    title: 'Edit in-game text',
    heading: 'In-game decal pack text',
    hint: 'Shown above the decal grid and in the equip card.',
    nameLabel: 'Pack name',
    namePlaceholder: 'Decal pack name',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Pack description…',
  },
} as const

export default function InGameTextButton({
  name,
  description,
  onChange,
  kind,
  initialOpen = false,
}: Props) {
  const [open, setOpen] = useState(initialOpen)
  const rootRef = useRef<HTMLDivElement>(null)
  const copy = KIND_COPY[kind]

  // Outside-click + Escape close. Skip when the popover isn't mounted so
  // we don't leak listeners on idle editors.
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

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      data-testid="in-game-text-root"
    >
      {/* Trigger — same 28×28 inline-icon recipe as the LiveSyncBadge
       *  inline variant so the two read as siblings in the badge row. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={copy.title}
        aria-label={copy.aria}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="in-game-text-button"
        data-state={open ? 'open' : 'closed'}
        className={
          'relative shrink-0 inline-flex items-center justify-center rounded-xl ' +
          'transition-all duration-150 cursor-pointer outline-none ' +
          'focus-visible:ring-2 focus-visible:ring-white/70 ' +
          'hover:bg-white/10 hover:scale-[1.06] active:scale-95'
        }
        style={{
          width: 28,
          height: 28,
          background: 'transparent',
          border: 'none',
        }}
      >
        <Type size={16} className={open ? 'text-amber-300' : 'text-white/70'} aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={copy.heading}
          data-testid="in-game-text-popover"
          style={popoverStyle}
        >
          <div style={headingStyle}>{copy.heading}</div>
          <div style={hintStyle}>{copy.hint}</div>
          <TextField
            label={copy.nameLabel}
            value={name}
            placeholder={copy.namePlaceholder}
            onChange={v => onChange({ name: v, description })}
            testId="in-game-text-name-input"
          />
          <TextField
            label={copy.descriptionLabel}
            value={description}
            placeholder={copy.descriptionPlaceholder}
            multiline
            onChange={v => onChange({ name, description: v })}
            testId="in-game-text-description-input"
          />
        </div>
      )}
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const popoverStyle: CSSProperties = {
  position: 'absolute',
  // Anchor ABOVE the trigger button (the cluster sits directly above the
  // BottomToolPill, so visually this lands above the pill — matching the
  // "small menu opens above the pill" brief).
  bottom: 'calc(100% + 8px)',
  // Right-align with the badge cluster so the popover doesn't drift off
  // the bottom-dock's right edge on narrower viewports.
  right: 0,
  width: 280,
  borderRadius: 12,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'rgba(15, 17, 22, 0.85)',
  backgroundImage: 'linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
  backdropFilter: 'blur(40px) saturate(150%)',
  WebkitBackdropFilter: 'blur(40px) saturate(150%)',
  border: '0.5px solid rgba(255, 255, 255, 0.10)',
  boxShadow: 'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 10px 32px rgba(0, 0, 0, 0.55)',
  // Defensive: float just above the BottomToolPill but below any modal
  // dialogs the editor might pop later.
  zIndex: 45,
  // Click events must reach inputs — the parent dock uses no-drag, but
  // the popover is rendered as a child so it inherits.
  WebkitAppRegion: 'no-drag',
} as CSSProperties

const headingStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(247,247,250,0.92)',
  letterSpacing: '0.02em',
}

const hintStyle: CSSProperties = {
  fontSize: 10,
  color: 'rgba(247,247,250,0.55)',
  marginTop: -4,
  marginBottom: 2,
  lineHeight: 1.35,
}

const baseInputStyle: CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '0.5px solid rgba(255, 255, 255, 0.10)',
  borderRadius: 6,
  padding: '6px 8px',
  color: 'rgba(247,247,250,0.95)',
  fontSize: 11,
  fontFamily: 'inherit',
  outline: 'none',
  resize: 'vertical',
}

const labelStyle: CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'rgba(247,247,250,0.55)',
  fontWeight: 600,
}

// ─── Subcomponent ────────────────────────────────────────────────────────────

interface TextFieldProps {
  label: string
  value: string
  placeholder?: string
  multiline?: boolean
  onChange: (v: string) => void
  testId: string
}

function TextField({ label, value, placeholder, multiline, onChange, testId }: TextFieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={ev => onChange(ev.target.value)}
          rows={3}
          style={{ ...baseInputStyle, minHeight: 48, lineHeight: 1.35 }}
          data-testid={testId}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={ev => onChange(ev.target.value)}
          style={baseInputStyle}
          data-testid={testId}
        />
      )}
    </label>
  )
}
