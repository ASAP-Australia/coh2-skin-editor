import { useEffect, useState } from 'react'

/**
 * First-run onboarding tour. 3 steps, dismissible at any time, "remember"
 * flag stored in localStorage so it never reappears for a returning user.
 *
 * The Editor mounts this once at the root. It self-gates on the
 * `coh2-skin-editor:onboarded` localStorage key so it only ever appears on
 * first run unless the user explicitly resets it (e.g. via a future
 * "replay tour" button in Help).
 */

// Bumped -v2 → -v3 so users who already dismissed the previous 4-step
// tour see the updated "paint by hand" step on next launch — it now
// references the bottom-row "Edit texture" pill that was added for v1.0.
// The pill is the new fastest path into brush mode (one click vs.
// opening Paint → Brush); without re-triggering the tour, returning
// users would never discover it from the in-product copy. One-time
// re-trigger only — the new key is then set to '1' on dismiss like
// before, so the tour doesn't haunt anyone.
const STORAGE_KEY = 'coh2-skin-editor:onboarded-v3'

interface Step {
  title: string
  body: string
  hint?: string
}

const STEPS: Step[] = [
  {
    title: 'Pick a vehicle',
    body: "Your faction is locked to this pack — close it from the Publish tab if you want to start a new one. Pick any vehicle from the bottom strip; each has its own UV layout, so decals follow that vehicle's coordinate system.",
    hint: 'Rotate the tank with left-click drag, pan with right-click, zoom with the wheel.',
  },
  {
    title: 'Apply a camo',
    body: 'Open Paint → Camo. Describe the look you want ("german ambush winter") or pick a Quick preset. Toggle "Apply to" between This vehicle / This faction / All vehicles to skin one tank or your whole army in one click.',
    hint: "Paste any image with Ctrl+V into the Camo panel to use it as your skin's diffuse.",
  },
  {
    title: 'Paint by hand',
    body: "Click the green Edit texture pill at the bottom of the screen (next to Generate) to drop straight into brush mode — no menu hunting. Size, softness, opacity, colour swatches, and an eyedropper that samples whatever's on the model. Hold the mouse to drag a stroke; Ctrl+Z undoes each one. Toggle the FlipHorizontal2 button in the Brush panel for mirrored painting if you want both sides of the tank to stay in sync (off by default).",
    hint: 'Edit texture → Brush → Decals → Camo are stacked as layers — brush on top of a camo, decals on top of brush.',
  },
  {
    title: 'Place decals + export',
    body: "Paint → Decals stamps tactical numbers, names, kill rings, shields, balkenkreuz / red star templates, or imported PNGs onto the tank. When you're happy, head to Publish → Export to write a working CoH2 skin pack.",
    hint: 'Press ? any time to see all keyboard shortcuts.',
  },
]

export default function OnboardingOverlay() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const forceTour = new URLSearchParams(window.location.search).get('tour') === '1'
      // ?tour=1 forces the tour regardless of saved flag/project state.
      if (!forceTour) {
        if (window.localStorage.getItem(STORAGE_KEY) === '1') return
        const hasProject = Object.keys(window.localStorage).some(k => k.startsWith('coh2.project.'))
        if (hasProject) {
          window.localStorage.setItem(STORAGE_KEY, '1')
          return
        }
      }
      const t = window.setTimeout(() => setOpen(true), 600)
      return () => window.clearTimeout(t)
    } catch {
      /* tolerate */
    }
  }, [])

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* tolerate */
    }
    setOpen(false)
  }

  if (!open) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center pointer-events-auto">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        role="button"
        aria-label="Dismiss onboarding"
        tabIndex={0}
        onClick={dismiss}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Escape') dismiss()
        }}
      />
      <div
        className="relative glass-3 rounded-[var(--radius-panel)] p-7 max-w-md w-[90%]"
        style={{ boxShadow: 'var(--shadow-glass)' }}
      >
        <div className="flex items-center gap-1.5 mb-4">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all duration-200 ${
                i === step ? 'w-6 bg-[var(--color-accent)]' : 'w-3 bg-[var(--color-stroke-2)]'
              }`}
            />
          ))}
          <button
            onClick={dismiss}
            className="ml-auto text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] px-1 py-0.5"
          >
            skip
          </button>
        </div>

        <h2 className="text-[var(--color-text-1)] text-base font-medium mb-2">{current.title}</h2>
        <p className="text-[12px] text-[var(--color-text-2)] leading-relaxed mb-3">
          {current.body}
        </p>
        {current.hint && (
          <p className="text-[11px] text-[var(--color-text-3)] mb-4 leading-relaxed">
            {current.hint}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 mt-5">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-[12px] text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-30 disabled:cursor-not-allowed px-1"
          >
            ← back
          </button>
          <div className="text-[11px] text-[var(--color-text-3)]">
            {step + 1} / {STEPS.length}
          </div>
          {isLast ? (
            <button
              onClick={dismiss}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--color-accent)] text-black hover:opacity-90
                         focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 focus-visible:outline-none"
            >
              Start designing
            </button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--color-accent)] text-black hover:opacity-90
                         focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 focus-visible:outline-none"
            >
              next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
