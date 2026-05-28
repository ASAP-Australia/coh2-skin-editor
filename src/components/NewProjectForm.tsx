/**
 * NewProjectForm — third screen in the new-project flow (panel content only).
 *
 * After the user picks a faction we need a few pack-level fields before
 * opening the editor. Author is persisted to localStorage so it
 * pre-fills for future projects.
 *
 * The form does NOT block on the faction's RGM/RGT preload — that runs
 * in parallel from the moment the faction is picked. If the user submits
 * before preload finishes, the parent shows a small inline spinner; for
 * most users the preload completes during typing.
 *
 * Renders inside the persistent AuthShell card (no backdrop / glass /
 * brand mark of its own); only the inner content morphs.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { BorderBeam } from '@/components/ui/border-beam'
import { FACTION_ICON_SRC, FACTION_LABELS } from '@/lib/factions'
import type { Faction } from '@/lib/vehicles'
import TemplatePicker, { type TemplateOption } from '@/components/TemplatePicker'
import { listAllSkinProjects } from '@/lib/project'
import { detectWorkshopPath, listWorkshopItems } from '@/lib/native-fs'
import { listStockSkins } from '@/lib/stock-skins'

const AUTHOR_KEY = 'coh2-skin-author'

/** Template selection echoed back to the parent so the editor can seed
 *  the project state from the chosen source. Skin-pack equivalent of
 *  FaceplateTemplateSelection / DecalPackTemplateSelection. */
export interface ProjectTemplateSelection {
  id: string
  kind: 'blank' | 'saved' | 'stock' | 'workshop'
}

export interface ProjectFormResult {
  packName: string
  packDescription: string
  author: string
  template?: ProjectTemplateSelection
}

interface Props {
  exiting?: boolean
  faction: Faction
  /** True when the per-faction preload is still in flight; submit shows a spinner. */
  preloading?: boolean
  onSubmit: (result: ProjectFormResult) => void
  onBack: () => void
}

export default function NewProjectForm({ exiting, faction, preloading, onSubmit, onBack }: Props) {
  const [packName, setPackName] = useState('')
  const [packDescription, setPackDescription] = useState('')
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [submitted, setSubmitted] = useState(false)
  const [templateId, setTemplateId] = useState<string>('blank')
  const [templateKind, setTemplateKind] = useState<ProjectTemplateSelection['kind']>('blank')
  const [workshopTemplates, setWorkshopTemplates] = useState<TemplateOption[]>([])
  const nameRef = useRef<HTMLInputElement>(null)

  // Stock skins — fully static, derived from the VEHICLES catalog.
  const stockTemplates = useMemo<TemplateOption[]>(() => {
    return listStockSkins().map(s => ({
      id: `stock:${s.id}`,
      kind: 'stock' as const,
      name: s.name,
      hint: s.sgaName,
      thumbnail: null,
    }))
  }, [])

  // Saved templates depend on the picked faction (same-faction packs sort
  // first), so derive via useMemo rather than initialising in state — the
  // user can re-pick the faction via the chip-back affordance and the
  // ordering should refresh accordingly.
  const savedTemplates = useMemo<TemplateOption[]>(() => {
    // listAllSkinProjects walks every healthy `coh2.project.<id>` snapshot
    // — not the 12-entry recent registry — so packs the user made months
    // ago still appear here, and broken/corrupt snapshots are silently
    // excluded so they can't crash the editor on click.
    const recent = listAllSkinProjects()
    const sorted = [...recent].sort((a, b) => {
      if (a.faction === faction && b.faction !== faction) return -1
      if (b.faction === faction && a.faction !== faction) return 1
      return b.lastEditedAt - a.lastEditedAt
    })
    return sorted.map(r => ({
      id: r.id,
      kind: 'saved' as const,
      name: r.name || 'Untitled pack',
      hint: `${FACTION_LABELS[r.faction]} · ${r.vehicleCount} vehicle${r.vehicleCount === 1 ? '' : 's'} · ${formatTimeAgo(r.lastEditedAt)}`,
      thumbnail: r.thumbnail ?? null,
    }))
  }, [faction])

  // Autofocus name on mount — AuthShell handles the entrance animation,
  // we just need to focus once it settles.
  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 380)
    return () => window.clearTimeout(t)
  }, [])

  // Workshop section — async IPC into electron main.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const root = await detectWorkshopPath()
        if (cancelled || !root) return
        const items = await listWorkshopItems(root)
        if (cancelled) return
        setWorkshopTemplates(
          items.map(item => ({
            id: `workshop:${item.id}`,
            kind: 'workshop' as const,
            name: `Workshop #${item.id}`,
            hint: item.sgaPath ? 'Pre-fills name from workshop archive' : 'Legacy workshop item (.bin format)',
            thumbnail: null,
          })),
        )
      } catch {
        /* best-effort */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const templateOptions = useMemo<TemplateOption[]>(
    () => [
      {
        id: 'blank',
        kind: 'blank' as const,
        name: 'Blank canvas',
        hint: 'Start with empty vehicle slots',
        thumbnail: null,
      },
      ...savedTemplates,
      ...stockTemplates,
      ...workshopTemplates,
    ],
    [savedTemplates, stockTemplates, workshopTemplates],
  )

  const trimmedName = packName.trim()
  const canSubmit = trimmedName.length > 0 && !submitted

  const submit = () => {
    if (!canSubmit) return
    setSubmitted(true)
    try {
      localStorage.setItem(AUTHOR_KEY, author.trim())
    } catch {
      /* ignore */
    }
    onSubmit({
      packName: trimmedName,
      packDescription: packDescription.trim(),
      author: author.trim() || 'Anonymous',
      template: { id: templateId, kind: templateKind },
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Submit on Cmd/Ctrl+Enter from any field; plain Enter only from the
    // single-line name field (so users can write multi-line descriptions).
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      role="presentation"
      onKeyDown={onKeyDown}
      style={{
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateY(-4px)' : 'translateY(0)',
        transition:
          'opacity 360ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      {/* Faction confirmation chip — clickable to step back. Bare emblem
          (no tinted disc behind), matching the picker's clean look. */}
      <button
        onClick={onBack}
        disabled={submitted}
        className="inline-flex items-center gap-2 mb-5 pl-1 pr-3 py-1 rounded-full
                   border border-white/[0.08] bg-white/[0.04]
                   hover:bg-white/[0.08] hover:border-white/15 transition-all
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <img
          src={FACTION_ICON_SRC[faction]}
          alt=""
          draggable={false}
          style={{
            width: 24,
            height: 24,
            objectFit: 'contain',
            flexShrink: 0,
            userSelect: 'none',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 1.5px 3px rgba(0,0,0,0.5))',
          }}
        />
        <span className="text-[11px] font-medium tracking-[1px] uppercase text-foreground/90">
          {FACTION_LABELS[faction]}
        </span>
        <span className="text-[10px] text-muted-foreground">change</span>
      </button>

      <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground leading-[1.15] mb-1">
        Pack details
      </h1>
      <p className="text-[12px] text-muted-foreground mb-5">
        You can edit any of these later from the View panel.
      </p>

      {/* Template */}
      <Field label="Template">
        <TemplatePicker
          value={templateId}
          onChange={opt => {
            setTemplateId(opt.id)
            setTemplateKind(opt.kind)
            if (opt.kind !== 'blank' && packName.trim() === '') {
              setPackName(opt.name)
            }
          }}
          options={templateOptions}
          disabled={submitted}
        />
      </Field>

      {/* Name */}
      <Field label="Pack name" required>
        <input
          ref={nameRef}
          value={packName}
          onChange={e => setPackName(e.target.value)}
          placeholder="e.g. Operation Market Garden"
          maxLength={60}
          className="w-full bg-black/30 rounded-lg px-3 py-2 text-[13px] border border-white/10 text-white placeholder:text-white/25
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
        />
      </Field>

      {/* Description */}
      <Field label="Description">
        <textarea
          value={packDescription}
          onChange={e => setPackDescription(e.target.value)}
          placeholder="What's the theme, unit, or campaign? Shown in-game and on Workshop."
          rows={3}
          maxLength={400}
          className="w-full bg-black/30 rounded-lg px-3 py-2 text-[12px] border border-white/10 text-white placeholder:text-white/25
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40 resize-none leading-relaxed"
        />
      </Field>

      {/* Author */}
      <Field label="Author">
        <input
          value={author}
          onChange={e => setAuthor(e.target.value)}
          placeholder="Your handle or studio"
          maxLength={40}
          className="w-full bg-black/30 rounded-lg px-3 py-2 text-[13px] border border-white/10 text-white placeholder:text-white/25
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
        />
      </Field>

      {/* Submit */}
      <div className="mt-6">
        <BorderBeam
          colorVariant="ocean"
          duration={5}
          strength={0.85}
          borderRadius={16}
          borderWidth={1}
          className="bb-pressable"
        >
          <button
            disabled={!canSubmit}
            onClick={submit}
            className="bb-cta relative w-full text-foreground font-semibold h-12 text-[14px] tracking-tight
                       disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
            style={{
              borderRadius: 16,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              background: 'rgba(255, 255, 255, 0.06)',
              backdropFilter: 'blur(20px) saturate(160%)',
              WebkitBackdropFilter: 'blur(20px) saturate(160%)',
              boxShadow: '0 1px 0 rgb(255 255 255 / 0.14) inset',
            }}
          >
            {submitted && preloading ? (
              <>
                <InlineSpinner />
                <span>Preloading {FACTION_LABELS[faction]} vehicles…</span>
              </>
            ) : (
              <>
                <span>Create &amp; preview</span>
                <ArrowRight className="size-4" aria-hidden />
              </>
            )}
          </button>
        </BorderBeam>
      </div>

      {/* Back navigation is provided by the faction chip at the top of the
          form ("change" affordance) — no redundant back button down here. */}

      <style>{`
        .bb-pressable {
          transition: transform 240ms cubic-bezier(.4, 1.6, .5, 1);
          will-change: transform;
          transform-origin: center;
          display: block;
        }
        .bb-pressable:has(button:not(:disabled):active) {
          transform: scale(0.95);
          transition: transform 90ms cubic-bezier(.3, 0, .7, 1);
        }
        .bb-cta {
          transition: background-color 160ms ease-out;
        }
        .bb-cta:not(:disabled):hover {
          background: rgba(255, 255, 255, 0.10) !important;
        }
        @keyframes npf-spinner-rotate {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

/** Tiny relative-time formatter for saved-template hints. Local copy of
 *  the helper used in NewFaceplateForm / NewDecalPackForm — kept here
 *  so the three forms don't have to import a shared module just for
 *  one trivial format helper. */
function formatTimeAgo(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} mo ago`
  const years = Math.round(months / 12)
  return `${years} yr${years === 1 ? '' : 's'} ago`
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground font-medium">
          {label}
          {required && <span className="text-[var(--color-accent)] ml-1">*</span>}
        </span>
        {hint && <span className="text-[10px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

function InlineSpinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 16,
        height: 16,
        display: 'inline-block',
        flex: 'none',
        borderRadius: '50%',
        background:
          'conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.30) 30%, rgba(255,255,255,0.95) 100%)',
        WebkitMask: 'radial-gradient(circle, transparent 5px, #000 5.5px)',
        mask: 'radial-gradient(circle, transparent 5px, #000 5.5px)',
        animation: 'npf-spinner-rotate 0.9s linear infinite',
      }}
    />
  )
}
