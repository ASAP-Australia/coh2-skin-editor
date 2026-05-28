/**
 * editor-clipboard — cross-editor clipboard channel via localStorage.
 *
 * Allows copying a layer or decal from FaceplateEditor or DecalPackEditor
 * and pasting into either. Works across browser tabs because localStorage
 * is shared per origin.
 *
 * Key: `coh2-skin:editor-clipboard`
 *
 * All operations are wrapped in try/catch — SSR environments or strict
 * privacy modes may throw on localStorage access.
 */

const STORAGE_KEY = 'coh2-skin:editor-clipboard'

export type ClipboardEntryKind = 'faceplate-layer' | 'decal'

const VALID_KINDS: ClipboardEntryKind[] = ['faceplate-layer', 'decal']
const VALID_EDITORS = ['faceplate', 'decal-pack'] as const

export interface ClipboardEntry {
  kind: ClipboardEntryKind
  /** Serialised JSON of the source object (e.g. ImageLayer, TextLayer, Decal). */
  payload: unknown
  /** Author/source metadata for debugging. */
  source: {
    editor: 'faceplate' | 'decal-pack'
    copiedAt: string
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

function isValidEntry(value: unknown): value is ClipboardEntry {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>

  if (!VALID_KINDS.includes(obj['kind'] as ClipboardEntryKind)) return false
  if (!('payload' in obj)) return false
  if (typeof obj['source'] !== 'object' || obj['source'] === null) return false

  const src = obj['source'] as Record<string, unknown>
  if (!VALID_EDITORS.includes(src['editor'] as 'faceplate' | 'decal-pack')) return false
  if (typeof src['copiedAt'] !== 'string') return false

  return true
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Serialise and persist a clipboard entry.  Overwrites any previous entry. */
export function writeClipboard(entry: ClipboardEntry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // localStorage unavailable — silently ignore
  }
}

/**
 * Deserialise and validate the stored clipboard entry.
 * Returns `null` (and clears the slot) if the stored value is missing,
 * malformed, or has an unknown kind / editor.
 */
export function readClipboard(): ClipboardEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      clearClipboard()
      return null
    }

    if (!isValidEntry(parsed)) {
      clearClipboard()
      return null
    }

    return parsed
  } catch {
    return null
  }
}

/** Remove the clipboard entry. */
export function clearClipboard(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
