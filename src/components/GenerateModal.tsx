/**
 * GenerateModal — AI-assisted camo generation dialog.
 *
 * Opens from the bottom-right "Generate" button. Two sub-views:
 *   1. Main  — prompt textarea + Generate button; shows the AI's reply
 *              status (idle / running / error) and applies the resulting
 *              CamoPreset via the parent's onApply callback.
 *   2. Settings — provider picker (Anthropic / OpenAI / Google) and
 *              per-provider API-key inputs. Keys are written to OS
 *              keychain via the main process — they never live in the
 *              renderer except while typing.
 *
 * Decal / custom-image generation is stubbed with a "Coming soon" tab so
 * the UI doesn't promise capabilities the provider adapters can't deliver
 * yet (Tier-1 parameter gen for decals lands next; Tier-2 image gen
 * needs the gpt-image-1 / Imagen adapters).
 */

import { useEffect, useRef, useState } from 'react'
import { Settings, Sparkles, Key, Check, X, AlertCircle, Undo2, RefreshCw } from 'lucide-react'

import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'

import { isElectron } from '@/lib/native-fs'
import type { AiProvider, AiSettings } from '@/lib/ai/types'
import type { CamoPreset } from '@/lib/camo-generator'
import { generateCamoWithAi, refineCamoWithAi } from '@/lib/ai/generate-camo'
import { generateCamoImageWithAi, refineCamoImageWithAi } from '@/lib/ai/generate-camo-image'
import { generateDecalImageWithAi, refineDecalImageWithAi } from '@/lib/ai/generate-decal-image'
import { generateCamo } from '@/lib/camo-generator'
import { FACTION_LABELS } from '@/lib/factions'
import type { Faction } from '@/lib/vehicles'

/** Build a 64² preview dataURL for a CamoPreset — used in the
 *  conversation thumbnail strip. We render off-DOM and inline the
 *  result; it's tiny so we don't bother caching across re-renders. */
function camoPresetThumbnail(preset: CamoPreset): string {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  generateCamo(c, preset)
  return c.toDataURL('image/png')
}

type GenerateTab = 'camo' | 'image' | 'decals'

/** Where the generated asset gets written:
 *  - 'vehicle' → only the currently-selected vehicle changes
 *  - 'faction' → the faction default updates (inherited by every vehicle
 *                in this faction that doesn't have its own override) */
export type ApplyScope = 'vehicle' | 'faction' | 'all'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Context for the AI prompt — passed through to the model. */
  faction: Faction
  season: 'summer' | 'winter'
  vehicleName: string
  /** Apply the generated procedural preset (Tier 1). Scope decides
   *  whether it lands on this vehicle or the faction default. */
  onApplyCamo: (preset: CamoPreset, scope: ApplyScope) => void
  /** Apply an AI-generated camo image (Tier 2). Scope routes the same
   *  way as procedural. */
  onApplyCamoImage: (img: HTMLImageElement, scope: ApplyScope) => void
  /** Apply an AI-generated decal (alpha-keyed). Persists to the project
   *  image library and adds a placed instance at a sensible default
   *  position (per-vehicle for 'vehicle' scope, in the faction default
   *  decal list for 'faction' scope). */
  onApplyDecalImage: (
    img: { image: HTMLImageElement; dataUrl: string; width: number; height: number },
    scope: ApplyScope,
  ) => void
}

type View = 'main' | 'settings'
type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; label: string; provider: string; model: string }

/** One turn in the in-modal refinement conversation. Held in component
 *  state only — persistence to `project.generationSessions` happens in
 *  a later step (we don't carry full message history; refinement is
 *  stateless re-roll using the previous result + the new instruction). */
interface LocalTurn {
  id: string
  /** What the user typed for this turn ("dunkelgelb ambush", "less green"). */
  userInput: string
  provider: string
  model: string
  payload:
    | { kind: 'camo-preset'; preset: CamoPreset; thumb: string }
    | { kind: 'camo-image'; image: HTMLImageElement; thumb: string }
    | {
        kind: 'decal-image'
        image: HTMLImageElement
        dataUrl: string
        width: number
        height: number
        thumb: string
      }
}

function newTurnId(): string {
  return Math.random().toString(36).slice(2, 10)
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
  xai: 'xAI (Grok)',
}

const PROVIDER_HINTS: Record<AiProvider, string> = {
  anthropic: 'Get a key at console.anthropic.com — starts with sk-ant-…',
  openai: 'Get a key at platform.openai.com/api-keys — starts with sk-…',
  google: 'Get a key at aistudio.google.com/apikey — starts with AIza…',
  xai: 'Get a key at console.x.ai — starts with xai-…',
}

/** Providers that support Tier-2 image generation. Used by the
 *  "Custom image" tab to gate the Generate button + show a hint when
 *  the active provider can't service the request. */
const IMAGE_CAPABLE: Record<AiProvider, boolean> = {
  anthropic: false,
  openai: true,
  google: true,
  xai: true,
}

export default function GenerateModal({
  open,
  onOpenChange,
  faction,
  season,
  vehicleName,
  onApplyCamo,
  onApplyCamoImage,
  onApplyDecalImage,
}: Props) {
  const [view, setView] = useState<View>('main')
  const [tab, setTab] = useState<GenerateTab>('camo')
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [settings, setSettings] = useState<AiSettings | null>(null)
  /** Apply target — defaults to per-vehicle (less destructive). */
  const [scope, setScope] = useState<ApplyScope>('vehicle')
  /** Refinement conversations are tracked separately for each tab so the
   *  user can flip between Camo (procedural) and Custom image (Tier-2)
   *  without losing thumbnails on the other side. */
  const [camoTurns, setCamoTurns] = useState<LocalTurn[]>([])
  const [imageTurns, setImageTurns] = useState<LocalTurn[]>([])
  const [decalTurns, setDecalTurns] = useState<LocalTurn[]>([])
  const [activeCamoTurnIdx, setActiveCamoTurnIdx] = useState(-1)
  const [activeImageTurnIdx, setActiveImageTurnIdx] = useState(-1)
  const [activeDecalTurnIdx, setActiveDecalTurnIdx] = useState(-1)

  // A "session" is keyed by (tab, faction, vehicleName, season, scope) —
  // when any of these change, the current turn history is no longer
  // meaningful (it was a refinement of a *different* asset). Reset.
  // Tab change keeps both arrays intact (separate sessions per tab), but
  // the others apply to whichever tab is active. We track the last seen
  // values in a ref so we only reset on actual change, not on every
  // render.
  const sessionKey = `${faction}|${season}|${vehicleName}|${scope}`
  const lastSessionKey = useRef(sessionKey)
  useEffect(() => {
    if (lastSessionKey.current !== sessionKey) {
      lastSessionKey.current = sessionKey
      setCamoTurns([])
      setImageTurns([])
      setDecalTurns([])
      setActiveCamoTurnIdx(-1)
      setActiveImageTurnIdx(-1)
      setActiveDecalTurnIdx(-1)
    }
  }, [sessionKey])

  const turns = tab === 'camo' ? camoTurns : tab === 'image' ? imageTurns : decalTurns
  const activeTurnIdx =
    tab === 'camo' ? activeCamoTurnIdx : tab === 'image' ? activeImageTurnIdx : activeDecalTurnIdx
  const setTurns = tab === 'camo' ? setCamoTurns : tab === 'image' ? setImageTurns : setDecalTurns
  const setActiveTurnIdx =
    tab === 'camo'
      ? setActiveCamoTurnIdx
      : tab === 'image'
        ? setActiveImageTurnIdx
        : setActiveDecalTurnIdx

  // Simple linear search over at most 4 providers — useMemo overhead exceeds
  // the computation cost, so this is computed inline.
  const hasKey =
    settings != null &&
    (settings.providers.find(p => p.provider === settings.activeProvider)?.hasKey ?? false)

  // Fetch settings every time the modal opens (could change between sessions).
  useEffect(() => {
    if (!open) return
    if (!isElectron()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early-return branch with no async work; single setState before guard return
      setSettings({ activeProvider: 'anthropic', providers: [] })
      return
    }
    let cancelled = false
    window
      .electronAPI!.ai.getSettings()
      .then(s => {
        if (!cancelled) setSettings(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset transient state on close.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close; no async work, no cascading renders
      setStatus({ kind: 'idle' })
      setView('main')
    }
  }, [open])

  async function handleGenerate() {
    if (!isElectron()) {
      setStatus({ kind: 'error', message: 'AI generation requires the desktop app.' })
      return
    }
    if (!hasKey) {
      setView('settings')
      return
    }
    const ctx = {
      faction: FACTION_LABELS[faction] ?? faction,
      season,
      vehicleName,
      prompt: prompt.trim(),
    }
    const isRefine = turns.length > 0 && activeTurnIdx >= 0
    const activeTurn: LocalTurn | undefined = isRefine ? turns[activeTurnIdx] : undefined

    // Decals tab → image-gen with chroma-key alpha mask, drops into
    // the project image library + places one instance.
    if (tab === 'decals') {
      if (settings && !IMAGE_CAPABLE[settings.activeProvider]) {
        setStatus({
          kind: 'error',
          message: `${PROVIDER_LABELS[settings.activeProvider]} does not offer image generation. Switch to OpenAI, Google, or xAI in Settings.`,
        })
        return
      }
      setStatus({ kind: 'running' })
      try {
        const result =
          isRefine && activeTurn?.payload.kind === 'decal-image'
            ? await refineDecalImageWithAi(
                { faction: ctx.faction, vehicleName: ctx.vehicleName, prompt: ctx.prompt },
                activeTurn.userInput,
                ctx.prompt,
              )
            : await generateDecalImageWithAi({
                faction: ctx.faction,
                vehicleName: ctx.vehicleName,
                prompt: ctx.prompt,
              })
        onApplyDecalImage(
          {
            image: result.image,
            dataUrl: result.dataUrl,
            width: result.width,
            height: result.height,
          },
          scope,
        )
        const turn: LocalTurn = {
          id: newTurnId(),
          userInput: ctx.prompt,
          provider: result.provider,
          model: result.model,
          payload: {
            kind: 'decal-image',
            image: result.image,
            dataUrl: result.dataUrl,
            width: result.width,
            height: result.height,
            thumb: result.dataUrl,
          },
        }
        setTurns(prev => {
          const next = [...prev, turn]
          setActiveTurnIdx(next.length - 1)
          return next
        })
        setPrompt('')
        setStatus({
          kind: 'success',
          label: 'AI decal',
          provider: result.provider,
          model: result.model,
        })
      } catch (e) {
        setStatus({ kind: 'error', message: (e as Error).message })
      }
      return
    }

    // Image-gen tab → call provider's image endpoint and paint result
    // onto the diffuse canvas. The procedural Camo tab continues to use
    // the parameter-JSON path (much cheaper, faster, deterministic).
    if (tab === 'image') {
      // Block on providers that have no image endpoint (currently just
      // Anthropic) — surface a clear error rather than letting the
      // request 404 inside the main process.
      if (settings && !IMAGE_CAPABLE[settings.activeProvider]) {
        setStatus({
          kind: 'error',
          message: `${PROVIDER_LABELS[settings.activeProvider]} does not offer image generation. Switch to OpenAI, Google, or xAI in Settings.`,
        })
        return
      }
      setStatus({ kind: 'running' })
      try {
        const result =
          isRefine && activeTurn?.payload.kind === 'camo-image'
            ? await refineCamoImageWithAi(ctx, activeTurn.userInput, ctx.prompt)
            : await generateCamoImageWithAi(ctx)
        onApplyCamoImage(result.image, scope)
        const thumb = result.image.src // already a data URL from decode
        const turn: LocalTurn = {
          id: newTurnId(),
          userInput: ctx.prompt,
          provider: result.provider,
          model: result.model,
          payload: { kind: 'camo-image', image: result.image, thumb },
        }
        setTurns(prev => {
          const next = [...prev, turn]
          setActiveTurnIdx(next.length - 1)
          return next
        })
        setPrompt('') // clear for next refinement
        setStatus({
          kind: 'success',
          label: 'AI camo image',
          provider: result.provider,
          model: result.model,
        })
      } catch (e) {
        setStatus({ kind: 'error', message: (e as Error).message })
      }
      return
    }

    setStatus({ kind: 'running' })
    try {
      const result =
        isRefine && activeTurn?.payload.kind === 'camo-preset'
          ? await refineCamoWithAi(ctx, activeTurn.payload.preset, ctx.prompt)
          : await generateCamoWithAi(ctx)
      onApplyCamo(result.preset, scope)
      const turn: LocalTurn = {
        id: newTurnId(),
        userInput: ctx.prompt,
        provider: result.provider,
        model: result.model,
        payload: {
          kind: 'camo-preset',
          preset: result.preset,
          thumb: camoPresetThumbnail(result.preset),
        },
      }
      setTurns(prev => {
        const next = [...prev, turn]
        setActiveTurnIdx(next.length - 1)
        return next
      })
      setPrompt('')
      setStatus({
        kind: 'success',
        label: result.preset.label,
        provider: result.provider,
        model: result.model,
      })
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
    }
  }

  /** Re-apply the result of an earlier turn without re-calling the AI.
   *  Sets that turn as the active head of the conversation, so the next
   *  refinement branches off it. */
  function pickTurn(idx: number) {
    const t = turns[idx]
    if (!t) return
    if (t.payload.kind === 'camo-preset') {
      onApplyCamo(t.payload.preset, scope)
    } else if (t.payload.kind === 'camo-image') {
      onApplyCamoImage(t.payload.image, scope)
    } else if (t.payload.kind === 'decal-image') {
      onApplyDecalImage(
        {
          image: t.payload.image,
          dataUrl: t.payload.dataUrl,
          width: t.payload.width,
          height: t.payload.height,
        },
        scope,
      )
    }
    setActiveTurnIdx(idx)
    const label =
      t.payload.kind === 'camo-preset'
        ? t.payload.preset.label
        : t.payload.kind === 'camo-image'
          ? 'AI camo image'
          : 'AI decal'
    setStatus({ kind: 'success', label, provider: t.provider, model: t.model })
  }

  /** Wipe the current tab's conversation — back to a fresh generation. */
  function resetSession() {
    setTurns([])
    setActiveTurnIdx(-1)
    setPrompt('')
    setStatus({ kind: 'idle' })
  }

  // Close on Escape — replaces what base-ui's Dialog primitive did for
  // free. We attach to window so the panel doesn't need focus capture;
  // that matters because the user must be able to interact with the
  // viewport (orbit, zoom) while the panel is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) return null

  // Floating side panel — replaces the previous full-screen Dialog with
  // a non-blocking surface anchored to the right edge of the viewport.
  // Rationale: the user explicitly asked to be able to "chat with [the
  // AI] and look at our models and skins at the exact same time" — the
  // base-ui Dialog rendered a `bg-black/10 backdrop-blur-xs` overlay
  // that veiled the canvas and stole pointer events from OrbitControls.
  // A `fixed` panel without a backdrop sits on top of the chrome layer
  // but leaves the viewport fully interactive behind it.
  //
  // Positioning: top-1/2 centred vertically on the right side, inset
  // from the right edge by 16 px. Width 420 px gives the prompt
  // textarea + turn thumbnails enough room without dominating wide
  // monitors; on narrow viewports the max-width clamps it to the
  // visible region. Max-height 80vh + internal scroll so long turn
  // histories don't run off the screen.
  //
  // Z-index 40: above ScenePanel (z-30) so the panel reads as the
  // active surface when both are visible. ScenePanel sits on the same
  // right edge but is centred vertically (top-1/2) — the panel's
  // bottom-anchored layout (bottom-4) means they don't overlap on any
  // realistic viewport height.
  return (
    <div
      role="dialog"
      aria-label={view === 'main' ? 'Generate with AI' : 'AI Provider Settings'}
      className="fixed right-4 bottom-24 z-40 w-[420px] max-w-[calc(100vw-2rem)] max-h-[80vh] flex flex-col rounded-2xl text-sm text-popover-foreground ring-1 ring-foreground/10 shadow-[0_24px_60px_rgba(0,0,0,0.55)] animate-in fade-in-0 slide-in-from-right-4 duration-200"
      style={{
        background: 'rgba(20, 22, 28, 0.78)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
      }}
    >
      {/* Header — title + settings toggle + close. Tucked at top so the
          panel reads as a chat-style surface anchored from the top. */}
      <div className="flex flex-col gap-2 px-5 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading leading-none font-medium flex items-center gap-2">
            <Sparkles size={16} />
            {view === 'main' ? 'Generate with AI' : 'AI Provider Settings'}
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setView(v => (v === 'main' ? 'settings' : 'main'))}
              aria-label="Toggle settings"
            >
              {view === 'main' ? <Settings size={14} /> : <X size={14} />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              aria-label="Close generate panel"
            >
              <X size={14} />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {view === 'main'
            ? 'Describe what you want; the AI picks pattern + colours. Your input is sent to the provider you configured in Settings — no other data leaves your machine.'
            : 'API keys are stored encrypted in your OS keychain and never sent to the renderer process. Each request includes only the prompt and faction/season/vehicle context.'}
        </p>
      </div>

      {/* Body — scrollable so long turn histories or the Settings tab
          stay within the panel's max-height. The 'main' MainView and
          SettingsView were authored against the Dialog's full-content
          box; the `gap-6 p-5` here recreates that breathing room. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 grid gap-6">
        {view === 'main' ? (
          <MainView
            tab={tab}
            onTabChange={setTab}
            prompt={prompt}
            onPromptChange={setPrompt}
            status={status}
            hasKey={hasKey}
            providerLabel={settings ? PROVIDER_LABELS[settings.activeProvider] : '…'}
            activeProvider={settings?.activeProvider ?? 'anthropic'}
            faction={FACTION_LABELS[faction] ?? faction}
            factionRaw={faction}
            season={season}
            vehicleName={vehicleName}
            scope={scope}
            onScopeChange={setScope}
            turns={turns}
            activeTurnIdx={activeTurnIdx}
            onPickTurn={pickTurn}
            onResetSession={resetSession}
            onGenerate={handleGenerate}
            onOpenSettings={() => setView('settings')}
          />
        ) : (
          <SettingsView
            settings={settings}
            onChange={setSettings}
            onClose={() => setView('main')}
          />
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────────────────

interface MainViewProps {
  tab: GenerateTab
  onTabChange: (t: GenerateTab) => void
  prompt: string
  onPromptChange: (v: string) => void
  status: Status
  hasKey: boolean
  providerLabel: string
  activeProvider: AiProvider
  /** Display label, e.g. "OstHeer (Wehrmacht)". */
  faction: string
  /** Raw faction key, used by the scope toggle to render
   *  "Apply to all OstHeer vehicles". */
  factionRaw: Faction
  season: string
  vehicleName: string
  scope: ApplyScope
  onScopeChange: (s: ApplyScope) => void
  turns: LocalTurn[]
  activeTurnIdx: number
  onPickTurn: (idx: number) => void
  onResetSession: () => void
  onGenerate: () => void
  onOpenSettings: () => void
}

function MainView({
  tab,
  onTabChange,
  prompt,
  onPromptChange,
  status,
  hasKey,
  providerLabel,
  activeProvider,
  faction,
  factionRaw,
  season,
  vehicleName,
  scope,
  onScopeChange,
  turns,
  activeTurnIdx,
  onPickTurn,
  onResetSession,
  onGenerate,
  onOpenSettings,
}: MainViewProps) {
  const running = status.kind === 'running'
  // Decals + custom image both need a true image endpoint; gate them
  // together on the active provider's IMAGE_CAPABLE flag.
  const imageBlocked = (tab === 'image' || tab === 'decals') && !IMAGE_CAPABLE[activeProvider]
  const isRefine = turns.length > 0
  const placeholder = isRefine
    ? tab === 'camo'
      ? 'e.g. less green, more contrast, smaller blobs'
      : tab === 'image'
        ? 'e.g. darker palette, more weathered, less green'
        : 'e.g. smaller skull, add a red ring, less detail'
    : tab === 'camo'
      ? 'e.g. dunkelgelb base with red-brown disruptors, late-war ambush style'
      : tab === 'image'
        ? 'e.g. heavily weathered whitewash over dunkelgelb, chipped paint revealing rust'
        : 'e.g. SS Totenkopf skull insignia, white on black, stencil look'

  const scopeRow = (
    <ScopeToggle
      scope={scope}
      onChange={onScopeChange}
      vehicleLabel={vehicleName}
      factionLabel={faction}
      factionRaw={factionRaw}
      disabled={running}
    />
  )

  const thumbStrip = isRefine ? (
    <TurnStrip
      turns={turns}
      activeIdx={activeTurnIdx}
      onPick={onPickTurn}
      onReset={onResetSession}
      disabled={running}
    />
  ) : null

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={v => onTabChange(v as GenerateTab)} className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="camo" className="flex-1">
            Camo
          </TabsTrigger>
          <TabsTrigger value="decals" className="flex-1">
            Decals
          </TabsTrigger>
          <TabsTrigger value="image" className="flex-1">
            Custom image
          </TabsTrigger>
        </TabsList>

        <TabsContent value="camo" className="flex flex-col gap-3 pt-2">
          {scopeRow}
          {/* Context summary — what we'll tell the provider. */}
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Faction</span>: {faction}
            </div>
            <div>
              <span className="font-medium text-foreground">Season</span>: {season}
            </div>
            <div>
              <span className="font-medium text-foreground">Vehicle</span>: {vehicleName}
            </div>
            <div className="mt-1 text-[10px] opacity-70">
              Procedural mode — the model picks colours + pattern style, the app renders the pixels.
            </div>
          </div>

          {thumbStrip}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-prompt">{isRefine ? 'Refinement' : 'Prompt (optional)'}</Label>
            <Textarea
              id="ai-prompt"
              value={prompt}
              onChange={e => onPromptChange(e.target.value)}
              placeholder={placeholder}
              rows={3}
              disabled={running}
            />
          </div>

          <Footer
            running={running}
            hasKey={hasKey}
            providerLabel={providerLabel}
            disabled={false}
            disabledReason={null}
            isRefine={isRefine}
            onGenerate={onGenerate}
            onOpenSettings={onOpenSettings}
          />

          <StatusBanner status={status} />
        </TabsContent>

        <TabsContent value="image" className="flex flex-col gap-3 pt-2">
          {scopeRow}
          {/* Tier-2 image generation. Pushes the entire 2048² diffuse
              canvas to the AI-rendered output — no procedural fallback. */}
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Faction</span>: {faction}
            </div>
            <div>
              <span className="font-medium text-foreground">Season</span>: {season}
            </div>
            <div>
              <span className="font-medium text-foreground">Vehicle</span>: {vehicleName}
            </div>
            <div className="mt-1 text-[10px] opacity-70">
              Image mode — the AI renders a flat camo texture (gpt-image-1 / Imagen 3). Slower and
              more expensive than Camo mode, but supports free-form styles.
            </div>
          </div>

          {thumbStrip}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-image-prompt">{isRefine ? 'Refinement' : 'Describe the camo'}</Label>
            <Textarea
              id="ai-image-prompt"
              value={prompt}
              onChange={e => onPromptChange(e.target.value)}
              placeholder={placeholder}
              rows={3}
              disabled={running}
            />
          </div>

          {imageBlocked && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 flex items-start gap-2">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <div>
                {PROVIDER_LABELS[activeProvider]} has no image-generation endpoint. Switch to
                OpenAI, Google, or xAI in Settings to use this tab.
              </div>
            </div>
          )}

          <Footer
            running={running}
            hasKey={hasKey}
            providerLabel={providerLabel}
            disabled={imageBlocked}
            disabledReason={imageBlocked ? 'Anthropic does not support image gen' : null}
            isRefine={isRefine}
            onGenerate={onGenerate}
            onOpenSettings={onOpenSettings}
          />

          <StatusBanner status={status} />
        </TabsContent>

        <TabsContent value="decals" className="flex flex-col gap-3 pt-2">
          {scopeRow}
          {/* Decal generation — Tier 2 image-gen with a chroma-key
              alpha pass. Result lands in the project image library and
              one placed instance is created per scope. */}
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Faction</span>: {faction}
            </div>
            <div>
              <span className="font-medium text-foreground">Vehicle</span>: {vehicleName}
            </div>
            <div className="mt-1 text-[10px] opacity-70">
              Generates a flat emblem on a white background, then strips the background to
              transparent so it overlays cleanly on the camo. The decal lands in your image library
              and is placed at hull-centre — drag it from the Decals panel.
            </div>
          </div>

          {thumbStrip}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-decal-prompt">
              {isRefine ? 'Refinement' : 'Describe the insignia'}
            </Label>
            <Textarea
              id="ai-decal-prompt"
              value={prompt}
              onChange={e => onPromptChange(e.target.value)}
              placeholder={placeholder}
              rows={3}
              disabled={running}
            />
          </div>

          {imageBlocked && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 flex items-start gap-2">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <div>
                {PROVIDER_LABELS[activeProvider]} has no image-generation endpoint. Switch to
                OpenAI, Google, or xAI in Settings to use this tab.
              </div>
            </div>
          )}

          <Footer
            running={running}
            hasKey={hasKey}
            providerLabel={providerLabel}
            disabled={imageBlocked}
            disabledReason={imageBlocked ? 'Anthropic does not support image gen' : null}
            isRefine={isRefine}
            onGenerate={onGenerate}
            onOpenSettings={onOpenSettings}
          />

          <StatusBanner status={status} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface FooterProps {
  running: boolean
  hasKey: boolean
  providerLabel: string
  disabled: boolean
  disabledReason: string | null
  /** True when the user has at least one prior turn — switches button
   *  label from "Generate" to "Refine" so the action is unambiguous. */
  isRefine: boolean
  onGenerate: () => void
  onOpenSettings: () => void
}

// ─────────────────────────────────────────────────────────────────────────
// ScopeToggle — segmented control for "apply to this vehicle" vs
// "apply to all <faction> vehicles". Sits at the top of each tab so the
// user can't miss what scope they're about to commit to.
// ─────────────────────────────────────────────────────────────────────────

interface ScopeToggleProps {
  scope: ApplyScope
  onChange: (s: ApplyScope) => void
  vehicleLabel: string
  factionLabel: string
  factionRaw: Faction
  disabled: boolean
}

function ScopeToggle({ scope, onChange, vehicleLabel, factionLabel, disabled }: ScopeToggleProps) {
  const baseBtn =
    'flex-1 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ' +
    'disabled:opacity-50 disabled:cursor-not-allowed'
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Apply to</div>
      <div
        role="radiogroup"
        aria-label="Apply scope"
        className="inline-flex gap-1 rounded-md border border-border/60 bg-muted/30 p-1"
      >
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'vehicle'}
          onClick={() => onChange('vehicle')}
          disabled={disabled}
          className={`${baseBtn} ${
            scope === 'vehicle'
              ? 'bg-foreground/15 text-foreground border border-foreground/20'
              : 'text-muted-foreground hover:text-foreground border border-transparent'
          }`}
        >
          This vehicle
          <span className="ml-1 opacity-60">({vehicleLabel})</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'faction'}
          onClick={() => onChange('faction')}
          disabled={disabled}
          className={`${baseBtn} ${
            scope === 'faction'
              ? 'bg-foreground/15 text-foreground border border-foreground/20'
              : 'text-muted-foreground hover:text-foreground border border-transparent'
          }`}
        >
          All {factionLabel}
        </button>
      </div>
    </div>
  )
}

function Footer({
  running,
  hasKey,
  providerLabel,
  disabled,
  disabledReason,
  isRefine,
  onGenerate,
  onOpenSettings,
}: FooterProps) {
  const idle = isRefine ? 'Refine' : 'Generate'
  const busy = isRefine ? 'Refining…' : 'Generating…'
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[11px] text-muted-foreground">
        {disabledReason ? (
          <span className="text-amber-400 flex items-center gap-1">
            <AlertCircle size={12} /> {disabledReason}
          </span>
        ) : hasKey ? (
          <>
            Using <span className="text-foreground">{providerLabel}</span>
          </>
        ) : (
          <span className="text-amber-400 flex items-center gap-1">
            <AlertCircle size={12} /> No API key — click {idle} to add one
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onOpenSettings}>
          <Settings size={13} /> Settings
        </Button>
        <Button onClick={onGenerate} disabled={running || disabled} size="sm">
          <Sparkles size={13} />
          {running ? busy : idle}
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// TurnStrip — horizontal thumbnail row of every result the user's
// produced in this session. Clicking a thumbnail re-applies that
// version (and sets it as the head for the next refinement). The
// "Reset" button at the right collapses back to a fresh first-turn
// generation.
// ─────────────────────────────────────────────────────────────────────────

interface TurnStripProps {
  turns: LocalTurn[]
  activeIdx: number
  onPick: (idx: number) => void
  onReset: () => void
  disabled: boolean
}

function TurnStrip({ turns, activeIdx, onPick, onReset, disabled }: TurnStripProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Conversation ({turns.length} turn{turns.length === 1 ? '' : 's'})
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Start a new session"
        >
          <RefreshCw size={11} /> New session
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {turns.map((t, i) => {
          const active = i === activeIdx
          // userInput is empty for the very first turn when the user
          // didn't type anything; show "(auto)" so they know which is
          // which in the strip.
          const tip = `Turn ${i + 1}: ${t.userInput || '(auto)'}\n${t.provider} (${t.model})`
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(i)}
              disabled={disabled}
              title={tip}
              className={`relative shrink-0 w-12 h-12 rounded-md overflow-hidden border-2 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-foreground/80 ring-2 ring-foreground/20'
                  : 'border-border/60 hover:border-foreground/40'
              }`}
              aria-label={`Re-apply turn ${i + 1}`}
              aria-pressed={active}
            >
              <img src={t.payload.thumb} alt="" className="w-full h-full object-cover" />
              <span className="absolute bottom-0 right-0 px-1 text-[9px] font-medium bg-black/60 text-white leading-none rounded-tl-sm">
                {i + 1}
              </span>
              {active && (
                <span className="absolute top-0 left-0 p-0.5 bg-foreground/80 text-background rounded-br-md">
                  <Undo2 size={8} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StatusBanner({ status }: { status: Status }) {
  if (status.kind === 'idle') return null
  if (status.kind === 'running') {
    return (
      <div className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
        Talking to the model…
      </div>
    )
  }
  if (status.kind === 'success') {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 flex items-start gap-2">
        <Check size={14} className="mt-0.5 shrink-0" />
        <div>
          Applied <span className="font-medium">{status.label}</span> from {status.provider} (
          {status.model})
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 flex items-start gap-2">
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 whitespace-pre-wrap break-words">{status.message}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Settings view
// ─────────────────────────────────────────────────────────────────────────

interface SettingsViewProps {
  settings: AiSettings | null
  onChange: (s: AiSettings) => void
  onClose: () => void
}

function SettingsView({ settings, onChange, onClose }: SettingsViewProps) {
  const [draftKeys, setDraftKeys] = useState<Partial<Record<AiProvider, string>>>({})
  const [savingFor, setSavingFor] = useState<AiProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!settings) return <div className="text-xs text-muted-foreground">Loading…</div>

  async function refresh() {
    if (!isElectron()) return
    const s = await window.electronAPI!.ai.getSettings()
    onChange(s)
  }

  async function setActive(p: AiProvider) {
    if (!isElectron()) return
    await window.electronAPI!.ai.setActiveProvider(p)
    await refresh()
  }

  async function saveKey(p: AiProvider) {
    const k = draftKeys[p]
    if (!k) return
    setSavingFor(p)
    setError(null)
    try {
      await window.electronAPI!.ai.setKey(p, k)
      setDraftKeys(d => ({ ...d, [p]: '' }))
      await refresh()
    } catch (e) {
      setError(`Failed to save key for ${p}: ${(e as Error).message}`)
    } finally {
      setSavingFor(null)
    }
  }

  async function clearKey(p: AiProvider) {
    setError(null)
    try {
      await window.electronAPI!.ai.clearKey(p)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Active provider</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map(p => {
            const active = settings.activeProvider === p
            const cfg = settings.providers.find(x => x.provider === p)
            return (
              <button
                key={p}
                onClick={() => setActive(p)}
                className={`rounded-md border px-2 py-2 text-xs transition-colors ${
                  active
                    ? 'border-foreground/60 bg-foreground/10 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="font-medium">{PROVIDER_LABELS[p]}</div>
                <div className="mt-0.5 text-[10px] opacity-70">
                  {cfg?.hasKey ? 'Key set' : 'No key'}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map(p => {
        const cfg = settings.providers.find(x => x.provider === p)
        const has = cfg?.hasKey ?? false
        const saving = savingFor === p
        return (
          <div key={p} className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5">
              <Key size={12} />
              {PROVIDER_LABELS[p]} API key
              {has && <span className="text-[10px] text-emerald-400">(saved)</span>}
            </Label>
            <div className="flex gap-1.5">
              <Input
                type="password"
                value={draftKeys[p] ?? ''}
                onChange={e => setDraftKeys(d => ({ ...d, [p]: e.target.value }))}
                placeholder={has ? '••••••••  (replace)' : 'Paste API key'}
                disabled={saving}
              />
              <Button onClick={() => saveKey(p)} disabled={saving || !draftKeys[p]} size="sm">
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {has && (
                <Button
                  variant="outline"
                  onClick={() => clearKey(p)}
                  disabled={saving}
                  size="sm"
                  aria-label="Remove key"
                >
                  <X size={13} />
                </Button>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">{PROVIDER_HINTS[p]}</div>
          </div>
        )
      })}

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}
