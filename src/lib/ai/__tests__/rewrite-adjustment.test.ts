/**
 * Tests for ai/rewrite-adjustment — the optional Claude Haiku prompt
 * rewriter that takes a casual adjustment phrase ("darker, more snow")
 * and rewrites it into a precise SDXL prompt fragment using a
 * 32-entry embedded WWII camo glossary.
 *
 * Contract pinned here:
 *
 *  Empty / whitespace input
 *  - Returns the original string unchanged, untouched by either the
 *    glossary pass or the AI call.
 *
 *  Local glossary expansion (no `window.electronAPI` available)
 *  - When no Electron host is present, the function falls back to a
 *    local glossary expansion: it scans the input for any glossary
 *    alias, and if any are found, returns
 *    `<original-without-trailing-comma>, <desc1>, <desc2>, …` with
 *    duplicate descriptions deduplicated.
 *  - When no aliases match, the input is returned verbatim.
 *  - Aliases match case-insensitively.
 *  - Aliases with hyphens (e.g. "ss pea-dot") still match — the
 *    matcher uses a character-class boundary, not `\b`.
 *  - Aliases sharing the same entry (`'hinterhalt'` and `'ambush'`)
 *    yield only ONE copy of the entry's description.
 *  - When the input has a trailing comma + whitespace, the
 *    expansion strips it before joining.
 *
 *  Electron AI path (`window.electronAPI.ai.complete` available)
 *  - On success, returns the AI's `text.trim()`.
 *  - When the AI returns an empty / whitespace-only string, falls
 *    back to the local glossary-expanded form.
 *  - When the AI call rejects (key not set, network error, rate
 *    limit), falls back to the local glossary-expanded form.
 *  - The AI is called with provider=anthropic, model=claude-haiku-4-5,
 *    maxTokens=128, temperature=0.3.
 *
 *  No DOM rendering needed — this is a pure async string transform
 *  that only touches `window.electronAPI`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rewriteAdjustment } from '../rewrite-adjustment'

type AiCompleteFn = (req: {
  provider?: string
  model?: string
  system?: string
  user?: string
  maxTokens?: number
  temperature?: number
}) => Promise<{ text: string; provider?: string; model?: string }>

// We intentionally re-declare `electronAPI` as the narrow shape this test
// cares about (`{ ai?: { complete } }`) — the production ElectronAPI is
// wide (16+ IPC bindings) but rewriteAdjustment only touches the `ai`
// branch. Casting through `unknown` keeps the test self-contained without
// having to mock every unrelated handler.
interface WindowWithElectron {
  electronAPI?: { ai?: { complete: AiCompleteFn } }
}

function setAi(complete: AiCompleteFn) {
  ;(window as unknown as WindowWithElectron).electronAPI = { ai: { complete } }
}

function clearAi() {
  delete (window as unknown as WindowWithElectron).electronAPI
}

beforeEach(() => {
  clearAi()
})

afterEach(() => {
  clearAi()
  vi.restoreAllMocks()
})

// ── Empty / whitespace passthrough ──────────────────────────────────────

describe('rewriteAdjustment — empty / whitespace input', () => {
  it('returns an empty string unchanged', async () => {
    const out = await rewriteAdjustment('')
    expect(out).toBe('')
  })

  it('returns a whitespace-only string unchanged', async () => {
    const out = await rewriteAdjustment('   \t\n  ')
    expect(out).toBe('   \t\n  ')
  })

  it('does NOT call the AI for empty input even when electronAPI is set', async () => {
    const complete = vi.fn(async () => ({ text: 'should-not-be-used' }))
    setAi(complete)
    const out = await rewriteAdjustment('')
    expect(out).toBe('')
    expect(complete).not.toHaveBeenCalled()
  })
})

// ── Local glossary expansion (no Electron host) ─────────────────────────

describe('rewriteAdjustment — local glossary expansion (no electronAPI)', () => {
  it('returns the input verbatim when no glossary alias matches', async () => {
    const out = await rewriteAdjustment('a really cool sky')
    expect(out).toBe('a really cool sky')
  })

  it('appends the canonical description when a glossary alias is mentioned', async () => {
    const out = await rewriteAdjustment('hinterhalt please')
    expect(out).toContain('hinterhalt please')
    expect(out).toContain('Hinterhalt ambush pattern')
  })

  it('treats aliases case-insensitively', async () => {
    const out = await rewriteAdjustment('HINTERHALT')
    expect(out).toContain('Hinterhalt ambush pattern')
  })

  it('matches aliases that contain spaces (e.g. "pea dot")', async () => {
    const out = await rewriteAdjustment('give me pea dot please')
    expect(out).toContain('Waffen-SS Erbsenmuster pea-dot')
  })

  it('matches aliases that contain hyphens (e.g. "pea-dot")', async () => {
    const out = await rewriteAdjustment('give me pea-dot please')
    expect(out).toContain('Waffen-SS Erbsenmuster pea-dot')
  })

  it('deduplicates when two aliases of the SAME entry are mentioned', async () => {
    // 'hinterhalt' and 'ambush' both map to the same description entry.
    const out = await rewriteAdjustment('hinterhalt ambush')
    const matches = out.match(/Hinterhalt ambush pattern/g)
    expect(matches?.length).toBe(1)
  })

  it('joins multiple distinct entries with ", "', async () => {
    // 'dunkelgelb' and 'winter' are two separate glossary entries.
    const out = await rewriteAdjustment('dunkelgelb winter')
    expect(out).toContain('Wehrmacht dunkelgelb base')
    expect(out).toContain('Winter whitewash overlay')
  })

  it('strips a trailing comma + whitespace before appending', async () => {
    const out = await rewriteAdjustment('caunter, ')
    // No double-comma or stray trailing space before the description.
    expect(out).not.toMatch(/,,\s/)
    expect(out).toContain('caunter')
    expect(out).toContain('Caunter scheme three-colour')
  })

  it('only matches aliases at character-class boundaries (does not match inside words)', async () => {
    // 'rain' is an alias. Embedded in 'training' it should NOT match —
    // boundary regex is `[^a-z0-9]<alias>[^a-z0-9]`, and 't' and 'i' are
    // a-z so no boundary.
    const out = await rewriteAdjustment('training pattern')
    expect(out).toBe('training pattern')
  })

  it('matches the same alias separated by other tokens (e.g. "snow on the tank")', async () => {
    const out = await rewriteAdjustment('snow on the tank')
    expect(out).toContain('Winter whitewash overlay')
  })

  it('matches an alias surrounded by punctuation (commas)', async () => {
    const out = await rewriteAdjustment('something, ambush, more stuff')
    expect(out).toContain('Hinterhalt ambush pattern')
  })

  it('handles SS pea-dot (multi-token alias with leading "ss")', async () => {
    const out = await rewriteAdjustment('ss pea dot for the panther')
    expect(out).toContain('Waffen-SS Erbsenmuster pea-dot')
  })

  it('caunter alias expands to the Caunter scheme description', async () => {
    const out = await rewriteAdjustment('caunter scheme please')
    expect(out).toContain('Caunter scheme three-colour hard-edge geometric pattern')
  })
})

// ── Electron AI success path ────────────────────────────────────────────

describe('rewriteAdjustment — Electron AI success path', () => {
  it('returns the AI text trimmed when the call succeeds', async () => {
    const complete = vi.fn(async () => ({
      text: '  dark muted earth tones, heavy snow camouflage  ',
    }))
    setAi(complete)

    const out = await rewriteAdjustment('darker, more snow')
    expect(out).toBe('dark muted earth tones, heavy snow camouflage')
    expect(complete).toHaveBeenCalledOnce()
  })

  it('forwards the call with provider=anthropic, model=claude-haiku-4-5', async () => {
    const complete = vi.fn(async () => ({ text: 'rewritten' }))
    setAi(complete)

    await rewriteAdjustment('darker')

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
      }),
    )
  })

  it('forwards the call with maxTokens=128, temperature=0.3', async () => {
    const complete = vi.fn(async () => ({ text: 'rewritten' }))
    setAi(complete)

    await rewriteAdjustment('darker')

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 128,
        temperature: 0.3,
      }),
    )
  })

  it('forwards a non-empty system prompt and the trimmed user adjustment', async () => {
    const complete = vi.fn(async () => ({ text: 'rewritten' }))
    setAi(complete)

    await rewriteAdjustment('  darker, more snow  ')

    // Vitest's `mock.calls` is typed as a tuple variant (`unknown[][]`)
    // when the function is `vi.fn(async () => ...)` — TypeScript can't
    // see through to the AiCompleteFn signature. Narrow manually.
    const calls = complete.mock.calls as unknown as Array<[Parameters<AiCompleteFn>[0]]>
    expect(calls.length).toBeGreaterThan(0)
    const args = calls[0][0]
    expect(typeof args.system).toBe('string')
    expect((args.system ?? '').length).toBeGreaterThan(50)
    expect(args.user).toBe('darker, more snow')
  })
})

// ── Electron AI fallback paths ──────────────────────────────────────────

describe('rewriteAdjustment — Electron AI fallback paths', () => {
  it('falls back to local glossary expansion when the AI returns an empty string', async () => {
    const complete = vi.fn(async () => ({ text: '' }))
    setAi(complete)

    const out = await rewriteAdjustment('hinterhalt please')
    // Empty AI text → expandedLocal fallback (which contains the
    // glossary description).
    expect(out).toContain('Hinterhalt ambush pattern')
    expect(complete).toHaveBeenCalledOnce()
  })

  it('falls back to local glossary expansion when the AI returns whitespace only', async () => {
    const complete = vi.fn(async () => ({ text: '   \n  ' }))
    setAi(complete)

    const out = await rewriteAdjustment('hinterhalt please')
    expect(out).toContain('Hinterhalt ambush pattern')
  })

  it('falls back to local glossary expansion when the AI call rejects', async () => {
    const complete = vi.fn(async () => {
      throw new Error('rate limit')
    })
    setAi(complete)

    const out = await rewriteAdjustment('hinterhalt please')
    expect(out).toContain('Hinterhalt ambush pattern')
    expect(complete).toHaveBeenCalledOnce()
  })

  it('falls back to the original string when the AI rejects AND no glossary alias matched', async () => {
    const complete = vi.fn(async () => {
      throw new Error('no key')
    })
    setAi(complete)

    const out = await rewriteAdjustment('a really cool sky')
    expect(out).toBe('a really cool sky')
  })
})
