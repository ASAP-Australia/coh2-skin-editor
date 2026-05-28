/**
 * Tests for VoiceInput — the mic button that wraps Web Speech API.
 *
 * Pinned contract:
 *   1. Renders a single <button type="button"> with the lucide Mic
 *      icon when idle, MicOff when listening.
 *   2. title flips: "Speak your adjustment" → "Stop recording".
 *   3. Click toggles: first click starts recognition (listening=true),
 *      second click calls .stop() on the recogniser; .onend() then
 *      flips listening back to false.
 *   4. Successful `onresult` fires onTranscript(trimmed text).
 *   5. Error mapping:
 *        no-speech            → silent (onError NOT called)
 *        not-allowed          → "Microphone access denied"
 *        permission-denied    → "Microphone access denied"
 *        network              → "Speech recognition network error"
 *        other                → e.message (or "Speech error: <code>")
 *   6. If window.SpeechRecognition + webkitSpeechRecognition are BOTH
 *      missing → onError("Speech recognition is not available…") and
 *      no recogniser is constructed.
 *   7. If .start() throws → onError gets the thrown message, listening
 *      flips back off, and the recogniser ref is cleared so the next
 *      click can retry from scratch.
 *   8. disabled prop disables the button (no toggle on click).
 *
 * Test infra: React 19 createRoot + act + a hand-rolled mock
 * SpeechRecognition constructor stubbed onto window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import { VoiceInput } from '../VoiceInput'

// ── Mock SpeechRecognition ─────────────────────────────────────────────────

class MockRecogniser {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult:
    | ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void)
    | null = null
  onerror: ((e: { error: string; message?: string }) => void) | null = null
  onend: (() => void) | null = null
  onnomatch: (() => void) | null = null
  startCalls = 0
  stopCalls = 0
  startThrows: Error | null = null

  start() {
    this.startCalls += 1
    if (this.startThrows) throw this.startThrows
  }
  stop() {
    this.stopCalls += 1
    // Mirror real behaviour: .stop() triggers .onend() asynchronously.
    queueMicrotask(() => this.onend?.())
  }
  abort() {
    /* unused */
  }
  /**
   * Record this instance as the most-recently-constructed recogniser
   * so the test body can drive its handlers. Lives on the base class
   * so the subclass constructors don't have to reach for `this`
   * themselves.
   */
  register(): this {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- assigning to a module-scope sink is the entire point of this helper; aliasing is intentional and scoped.
    lastRecogniser = this
    return this
  }
  // EventTarget shape for the `extends EventTarget` declaration in the
  // component's ambient interface. jsdom's window already has these but
  // a hand-rolled class needs them to satisfy the runtime cast.
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true
  }
}

let lastRecogniser: MockRecogniser | null = null
let originalCtor: unknown
let originalWebkitCtor: unknown

function installMock() {
  const w = window as unknown as Record<string, unknown>
  originalCtor = w['SpeechRecognition']
  originalWebkitCtor = w['webkitSpeechRecognition']
  w['SpeechRecognition'] = class extends MockRecogniser {
    constructor() {
      super()
      this.register()
    }
  }
}

function uninstallMock() {
  const w = window as unknown as Record<string, unknown>
  if (originalCtor === undefined) delete w['SpeechRecognition']
  else w['SpeechRecognition'] = originalCtor
  if (originalWebkitCtor === undefined) delete w['webkitSpeechRecognition']
  else w['webkitSpeechRecognition'] = originalWebkitCtor
  lastRecogniser = null
}

// ── Render harness ─────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  onTranscript?: (text: string) => void
  onError?: (msg: string) => void
  disabled?: boolean
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(VoiceInput, {
        onTranscript: props.onTranscript ?? (() => {}),
        onError: props.onError,
        disabled: props.disabled,
      }),
    )
  })
  return container!
}

function btn(): HTMLButtonElement {
  return document.querySelector('button')! as HTMLButtonElement
}

beforeEach(() => {
  installMock()
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
  uninstallMock()
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('VoiceInput — render', () => {
  it('renders a single button (type="button") with the Mic icon when idle', () => {
    render()
    expect(document.querySelectorAll('button')).toHaveLength(1)
    expect(btn().getAttribute('type')).toBe('button')
    // lucide-react Mic renders as <svg>.
    expect(btn().querySelector('svg')).not.toBeNull()
  })

  it('idle title reads "Speak your adjustment"', () => {
    render()
    expect(btn().getAttribute('title')).toBe('Speak your adjustment')
  })

  it('disabled prop disables the button', () => {
    render({ disabled: true })
    expect(btn().disabled).toBe(true)
  })
})

describe('VoiceInput — start / stop toggle', () => {
  it('first click constructs a recogniser and calls .start()', () => {
    render()
    act(() => {
      btn().click()
    })
    expect(lastRecogniser).not.toBeNull()
    expect(lastRecogniser!.startCalls).toBe(1)
    // Title flips while listening.
    expect(btn().getAttribute('title')).toBe('Stop recording')
  })

  it('configures the recogniser as a one-shot en-US recognition', () => {
    render()
    act(() => {
      btn().click()
    })
    expect(lastRecogniser!.lang).toBe('en-US')
    expect(lastRecogniser!.continuous).toBe(false)
    expect(lastRecogniser!.interimResults).toBe(false)
    expect(lastRecogniser!.maxAlternatives).toBe(1)
  })

  it('second click calls .stop() on the active recogniser', () => {
    render()
    act(() => {
      btn().click()
    })
    const rec = lastRecogniser!
    act(() => {
      btn().click()
    })
    expect(rec.stopCalls).toBe(1)
  })

  it('onend flips listening back off (title returns to idle)', async () => {
    render()
    act(() => {
      btn().click()
    })
    expect(btn().getAttribute('title')).toBe('Stop recording')
    await act(async () => {
      lastRecogniser!.onend?.()
    })
    expect(btn().getAttribute('title')).toBe('Speak your adjustment')
  })
})

describe('VoiceInput — transcript wiring', () => {
  it('onresult fires onTranscript with the trimmed transcript', () => {
    const onTranscript = vi.fn()
    render({ onTranscript })
    act(() => {
      btn().click()
    })
    act(() => {
      lastRecogniser!.onresult?.({
        results: { 0: { 0: { transcript: '  german ambush winter  ' } } },
      } as never)
    })
    expect(onTranscript).toHaveBeenCalledWith('german ambush winter')
  })

  it('empty/whitespace transcript does NOT fire onTranscript', () => {
    const onTranscript = vi.fn()
    render({ onTranscript })
    act(() => {
      btn().click()
    })
    act(() => {
      lastRecogniser!.onresult?.({
        results: { 0: { 0: { transcript: '   ' } } },
      } as never)
    })
    expect(onTranscript).not.toHaveBeenCalled()
  })
})

describe('VoiceInput — error mapping', () => {
  function startThenError(errorCode: string, message?: string) {
    const onError = vi.fn()
    render({ onError })
    act(() => {
      btn().click()
    })
    act(() => {
      lastRecogniser!.onerror?.({ error: errorCode, message })
    })
    return onError
  }

  it('no-speech is a silent no-op (onError NOT called)', () => {
    const onError = startThenError('no-speech')
    expect(onError).not.toHaveBeenCalled()
  })

  it('not-allowed → "Microphone access denied"', () => {
    const onError = startThenError('not-allowed')
    expect(onError).toHaveBeenCalledWith('Microphone access denied')
  })

  it('permission-denied → "Microphone access denied"', () => {
    const onError = startThenError('permission-denied')
    expect(onError).toHaveBeenCalledWith('Microphone access denied')
  })

  it('network → "Speech recognition network error"', () => {
    const onError = startThenError('network')
    expect(onError).toHaveBeenCalledWith('Speech recognition network error')
  })

  it('unknown error with message → forwards message verbatim', () => {
    const onError = startThenError('aborted', 'aborted because of foo')
    expect(onError).toHaveBeenCalledWith('aborted because of foo')
  })

  it('unknown error WITHOUT message → falls back to "Speech error: <code>"', () => {
    const onError = startThenError('unknown-thing')
    expect(onError).toHaveBeenCalledWith('Speech error: unknown-thing')
  })
})

describe('VoiceInput — environment guards', () => {
  it('missing API → onError + no recogniser constructed', () => {
    // Wipe both globals BEFORE rendering so getSpeechRecognition() returns null.
    const w = window as unknown as Record<string, unknown>
    delete w['SpeechRecognition']
    delete w['webkitSpeechRecognition']
    lastRecogniser = null
    const onError = vi.fn()
    render({ onError })
    act(() => {
      btn().click()
    })
    expect(onError).toHaveBeenCalledWith('Speech recognition is not available in this browser.')
    expect(lastRecogniser).toBeNull()
  })

  it('.start() throwing → onError fires and the button drops back to idle', () => {
    const w = window as unknown as Record<string, unknown>
    w['SpeechRecognition'] = class extends MockRecogniser {
      constructor() {
        super()
        this.register()
        this.startThrows = new Error('mic in use')
      }
    }
    const onError = vi.fn()
    render({ onError })
    act(() => {
      btn().click()
    })
    expect(onError).toHaveBeenCalledWith('mic in use')
    expect(btn().getAttribute('title')).toBe('Speak your adjustment')
  })

  it('falls back to webkitSpeechRecognition when SpeechRecognition is absent', () => {
    const w = window as unknown as Record<string, unknown>
    delete w['SpeechRecognition']
    w['webkitSpeechRecognition'] = class extends MockRecogniser {
      constructor() {
        super()
        this.register()
      }
    }
    render()
    act(() => {
      btn().click()
    })
    expect(lastRecogniser).not.toBeNull()
    expect(lastRecogniser!.startCalls).toBe(1)
  })
})
