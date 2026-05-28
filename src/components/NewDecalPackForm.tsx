/**
 * NewDecalPackForm — prompts for decal-pack metadata before entering the
 * DecalPackEditor.
 *
 * Visual + interaction parity with NewFaceplateForm: same Stagger / BorderBeam
 * styling, same Cmd/Ctrl+Enter submit, same persistent-AuthShell card layout.
 * Only the field labels, placeholders, and the AUTHOR_KEY differ — decal-pack
 * makers may want a different "author" default than faceplate makers (e.g. a
 * studio handle for one and a Steam handle for the other).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { BorderBeam } from '@/components/ui/border-beam'
import TemplatePicker, { type TemplateOption } from '@/components/TemplatePicker'
import { listAllDecalPacks } from '@/lib/decal-pack-project'
import { detectWorkshopPath, listWorkshopItems } from '@/lib/native-fs'
import { listStockSkins } from '@/lib/stock-skins'

const AUTHOR_KEY = 'coh2-decalpack-author'

/** Template selection echoed back to the parent so the editor can seed
 *  the project state from the chosen source. Mirror of
 *  FaceplateTemplateSelection — see NewFaceplateForm.tsx for the rationale. */
export interface DecalPackTemplateSelection {
  id: string
  kind: 'blank' | 'saved' | 'stock' | 'workshop'
}

export interface DecalPackFormResult {
  name: string
  description: string
  author: string
  template?: DecalPackTemplateSelection
}

interface Props {
  exiting?: boolean
  onSubmit: (values: DecalPackFormResult) => void
  onCancel: () => void
}

export default function NewDecalPackForm({ exiting, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [submitted, setSubmitted] = useState(false)
  const [templateId, setTemplateId] = useState<string>('blank')
  const [templateKind, setTemplateKind] = useState<DecalPackTemplateSelection['kind']>('blank')
  // Saved templates: localStorage read in a lazy initialiser (see
  // matching pattern in NewFaceplateForm). Thumbnails are populated
  // lazily by DecalPackEditor's compose-first-decal effect (writes via
  // updateRecentDecalPackThumbnail) so users who have opened a pack
  // since the feature shipped will see the first-decal preview on
  // hover; older entries show the placeholder until their next save.
  const [savedTemplates] = useState<TemplateOption[]>(() => {
    // listAllDecalPacks walks every healthy `coh2.decalpack.<id>` snapshot
    // — not the 12-entry recent registry — so decal packs the user made
    // months ago still appear here, and broken/corrupt snapshots are
    // silently excluded so they can't crash the editor on click.
    const recent = listAllDecalPacks()
    return recent.map(r => ({
      id: r.id,
      kind: 'saved' as const,
      name: r.packName || 'Untitled decal pack',
      hint: `${r.decalCount} decal${r.decalCount === 1 ? '' : 's'} · ${formatTimeAgo(new Date(r.lastEditedAt).getTime())}`,
      thumbnail: r.thumbnail ?? null,
    }))
  })
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

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 380)
    return () => window.clearTimeout(t)
  }, [])

  // Workshop section — async IPC into electron main. Empty on browser
  // hosts or when the user has no CoH2 subscriptions.
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
        hint: 'Start with an empty decal pack',
        thumbnail: null,
      },
      ...savedTemplates,
      ...stockTemplates,
      ...workshopTemplates,
    ],
    [savedTemplates, stockTemplates, workshopTemplates],
  )

  const trimmedName = name.trim()
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
      name: trimmedName,
      description: description.trim(),
      author: author.trim() || 'Anonymous',
      template: { id: templateId, kind: templateKind },
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
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
      <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground leading-[1.15] mb-1">
        Decal pack details
      </h1>
      <p className="text-[12px] text-muted-foreground mb-5">
        You can edit any of these later from the View panel.
      </p>

      <Field label="Template">
        <TemplatePicker
          value={templateId}
          onChange={opt => {
            setTemplateId(opt.id)
            setTemplateKind(opt.kind)
            if (opt.kind !== 'blank' && name.trim() === '') {
              setName(opt.name)
            }
          }}
          options={templateOptions}
          disabled={submitted}
        />
      </Field>

      <Field label="Decal pack name" required>
        <input
          ref={nameRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Eastern Front Insignia"
          maxLength={60}
          className="w-full bg-black/30 rounded-lg px-3 py-2 text-[13px] border border-white/10 text-white placeholder:text-white/25
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40"
        />
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What kind of decals does this pack include? Shown in-game and on Workshop."
          rows={3}
          maxLength={400}
          className="w-full bg-black/30 rounded-lg px-3 py-2 text-[12px] border border-white/10 text-white placeholder:text-white/25
                     focus:outline-none focus:border-[var(--color-accent)] focus:bg-black/40 resize-none leading-relaxed"
        />
      </Field>

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
            <span>Create &amp; open</span>
            <ArrowRight className="size-4" aria-hidden />
          </button>
        </BorderBeam>
      </div>

      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitted}
          className="text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>

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
      `}</style>
    </div>
  )
}

/** Tiny relative-time formatter for the saved-templates hint. Mirror of
 *  the helper in NewFaceplateForm.tsx — kept inline since both forms
 *  use a single-line version of the same logic. */
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
