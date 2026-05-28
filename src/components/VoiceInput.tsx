/**
 * VoiceInput — a mic button that captures speech via the Web Speech API
 * and calls onTranscript() with the recognised text.
 *
 * Uses window.SpeechRecognition / window.webkitSpeechRecognition which is
 * built into Electron's Chromium — no extra packages needed.
 *
 * Behaviour:
 *   - Click once to start listening; click again (or wait for silence) to stop.
 *   - While listening: button shows a pulsing red dot.
 *   - On a successful transcript: calls onTranscript(text).
 *   - On "permission denied": calls onError("Microphone access denied").
 *   - On "no-speech": does nothing (user held the button by accident).
 *   - On other errors: calls onError(message).
 */

import { useCallback, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'

// ── Web Speech API type shim ───────────────────────────────────────────────────
// TypeScript's lib.dom.d.ts has SpeechRecognition but it's gated behind the
// `dom` lib and not always present in all tsconfig setups. We use an ambient
// cast to avoid adding lib entries or depending on @types/dom-speech.

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
}
interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionResult {
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  readonly isFinal: boolean
}
interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}
interface SpeechRecognitionErrorEvent {
  error: string
  message?: string
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onnomatch: (() => void) | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  const w = window as unknown as Record<string, unknown>
  const ctor = w['SpeechRecognition'] ?? w['webkitSpeechRecognition']
  return (ctor as new () => SpeechRecognitionInstance) ?? null
}

// ── Component ─────────────────────────────────────────────────────────────────

interface VoiceInputProps {
  /** Called when the API returns a final transcript. */
  onTranscript: (text: string) => void
  /** Called on non-fatal errors (permission denied, network, etc.).
   *  Parent can forward to toast(). */
  onError?: (message: string) => void
  disabled?: boolean
  className?: string
}

export function VoiceInput({ onTranscript, onError, disabled, className }: VoiceInputProps) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      onError?.('Speech recognition is not available in this browser.')
      return
    }

    const rec = new Ctor()
    recognitionRef.current = rec
    rec.lang = 'en-US'
    rec.continuous = false
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const text = e.results[0]?.[0]?.transcript?.trim()
      if (text) onTranscript(text)
    }

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech') {
        // User held the button but didn't speak — silent no-op
        return
      }
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        onError?.('Microphone access denied')
        return
      }
      if (e.error === 'network') {
        onError?.('Speech recognition network error')
        return
      }
      onError?.(e.message ?? `Speech error: ${e.error}`)
    }

    rec.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }

    try {
      rec.start()
      setListening(true)
    } catch (err) {
      setListening(false)
      recognitionRef.current = null
      onError?.(err instanceof Error ? err.message : 'Failed to start speech recognition')
    }
  }, [onTranscript, onError])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    // onend will fire and setListening(false)
  }, [])

  const toggle = () => {
    if (listening) stop()
    else start()
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={listening ? 'Stop recording' : 'Speak your adjustment'}
      className={[
        'relative flex items-center justify-center w-7 h-7 rounded-md transition',
        listening
          ? 'bg-red-600 text-white'
          : 'bg-white/5 text-[var(--color-text-2)] hover:text-white hover:bg-white/10',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {listening ? (
        <>
          {/* Pulsing ring animation */}
          <span className="absolute inset-0 rounded-md bg-red-500 opacity-40 animate-ping" />
          <MicOff size={13} className="relative z-10" />
        </>
      ) : (
        <Mic size={13} />
      )}
    </button>
  )
}
