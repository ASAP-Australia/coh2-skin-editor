/**
 * Tests for the Toasts hook — push() adds items, items auto-dismiss
 * after 3.5s, kind drives the colour utility on each pill.
 *
 * The hook returns `{ api, node }` — `api.push(msg, kind?)` and `node` is
 * a React element to render. We mount a thin Harness so we can grab both.
 *
 * Timer tests use vitest fake timers and step through 3.5s windows with
 * vi.advanceTimersByTime. Each push restarts the dismiss timer (the
 * useEffect dep is `[items]`), so the dismiss strategy is "oldest-first,
 * one every 3.5s after the last push".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import { useToasts, type ToastApi, type ToastKind } from '../Toasts'

// ── Harness ──────────────────────────────────────────────────────────────────

/** Exposes the hook's `api` to the test via a ref-style assign callback. */
function Harness({ onApi }: { onApi: (api: ToastApi) => void }) {
  const { api, node } = useToasts()
  useEffect(() => {
    onApi(api)
    // we intentionally only capture api once — it's stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return node
}

// ── Test infra ───────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null
let api: ToastApi | null = null

function mountHarness() {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(Harness, {
        onApi: (a: ToastApi) => {
          api = a
        },
      }),
    )
  })
  return container
}

function listToasts(): string[] {
  if (!container) return []
  return Array.from(container.querySelectorAll('.fixed > div')).map(
    el => (el as HTMLElement).textContent ?? '',
  )
}

function push(msg: string, kind?: ToastKind) {
  if (!api) throw new Error('Toasts harness: api not yet captured')
  act(() => {
    api!.push(msg, kind)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // Drain any pending timers before unmount so React doesn't warn about
  // setState-after-unmount when timeouts fire on a torn root.
  act(() => {
    vi.runOnlyPendingTimers()
  })
  vi.useRealTimers()
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
  api = null
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useToasts — push', () => {
  it('renders nothing before any push', () => {
    mountHarness()
    expect(listToasts()).toEqual([])
  })

  it('push() adds one toast', () => {
    mountHarness()
    push('hello')
    expect(listToasts()).toEqual(['hello'])
  })

  it('default kind is "info" → dark glass background', () => {
    mountHarness()
    push('hello')
    const pill = container!.querySelector('.fixed > div') as HTMLDivElement
    // info uses bg-black/60 + border-white/10
    expect(pill.className).toContain('bg-black/60')
    expect(pill.className).toContain('text-white')
  })

  it('kind="success" → emerald background', () => {
    mountHarness()
    push('saved!', 'success')
    const pill = container!.querySelector('.fixed > div') as HTMLDivElement
    expect(pill.className).toContain('bg-emerald-600/30')
    expect(pill.className).toContain('text-emerald-100')
  })

  it('kind="error" → red background', () => {
    mountHarness()
    push('oh no', 'error')
    const pill = container!.querySelector('.fixed > div') as HTMLDivElement
    expect(pill.className).toContain('bg-red-700/40')
    expect(pill.className).toContain('text-red-100')
  })

  it('stacks multiple toasts in insertion order', () => {
    mountHarness()
    push('first')
    push('second')
    push('third')
    expect(listToasts()).toEqual(['first', 'second', 'third'])
  })
})

describe('useToasts — auto-dismiss timing', () => {
  it('drops the oldest toast after 3.5 s', () => {
    mountHarness()
    push('keep-me?')
    expect(listToasts()).toEqual(['keep-me?'])
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(listToasts()).toEqual([])
  })

  it('does not drop before 3.5 s elapses', () => {
    mountHarness()
    push('still-here')
    act(() => {
      vi.advanceTimersByTime(3499)
    })
    expect(listToasts()).toEqual(['still-here'])
  })

  it('drops oldest-first when multiple are stacked (one per 3.5 s tick)', () => {
    mountHarness()
    push('one')
    push('two')
    // 3.5s after the *last* push (the useEffect dep is items, so each
    // push restarts the timer) — drops 'one'
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(listToasts()).toEqual(['two'])

    // Another 3.5s drops 'two'
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(listToasts()).toEqual([])
  })

  it('pushing while dismiss is pending resets the timer', () => {
    mountHarness()
    push('first')
    act(() => {
      vi.advanceTimersByTime(2000) // 2s in
    })
    push('second') // resets the timer; now items.length===2

    // Without the reset, 1.5s more would dismiss 'first'. With the reset,
    // 'first' should still be present.
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(listToasts()).toEqual(['first', 'second'])
  })
})
