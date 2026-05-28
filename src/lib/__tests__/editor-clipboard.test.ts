/**
 * Tests for editor-clipboard (localStorage-backed cross-editor clipboard).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  writeClipboard,
  readClipboard,
  clearClipboard,
  type ClipboardEntry,
} from '../editor-clipboard'

const SAMPLE: ClipboardEntry = {
  kind: 'faceplate-layer',
  payload: { type: 'text', content: 'Hello', x: 10, y: 20 },
  source: { editor: 'faceplate', copiedAt: '2026-01-01T00:00:00.000Z' },
}

const STORAGE_KEY = 'coh2-skin:editor-clipboard'

beforeEach(() => {
  localStorage.clear()
})

describe('writeClipboard / readClipboard', () => {
  it('write then read returns the same entry', () => {
    writeClipboard(SAMPLE)
    expect(readClipboard()).toEqual(SAMPLE)
  })

  it('writing twice keeps only the latest entry', () => {
    const first: ClipboardEntry = {
      kind: 'decal',
      payload: { id: 'old' },
      source: { editor: 'decal-pack', copiedAt: '2026-01-01T00:00:00.000Z' },
    }
    const second: ClipboardEntry = {
      kind: 'faceplate-layer',
      payload: { id: 'new' },
      source: { editor: 'faceplate', copiedAt: '2026-01-02T00:00:00.000Z' },
    }
    writeClipboard(first)
    writeClipboard(second)
    expect(readClipboard()).toEqual(second)
  })

  it('returns null when nothing is stored', () => {
    expect(readClipboard()).toBeNull()
  })
})

describe('clearClipboard', () => {
  it('empties the clipboard slot', () => {
    writeClipboard(SAMPLE)
    clearClipboard()
    expect(readClipboard()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('readClipboard — invalid data handling', () => {
  it('returns null and clears when stored JSON is invalid', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{')
    expect(readClipboard()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('returns null and clears when kind is unknown', () => {
    const bad = {
      kind: 'unknown-kind',
      payload: {},
      source: { editor: 'faceplate', copiedAt: '2026-01-01' },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bad))
    expect(readClipboard()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('returns null and clears when source.editor is unknown', () => {
    const bad = {
      kind: 'decal',
      payload: {},
      source: { editor: 'unknown-editor', copiedAt: '2026-01-01' },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bad))
    expect(readClipboard()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('returns null and clears when payload key is missing', () => {
    const bad = { kind: 'decal', source: { editor: 'decal-pack', copiedAt: '2026-01-01' } }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bad))
    expect(readClipboard()).toBeNull()
  })

  it('returns null and clears when source is missing copiedAt', () => {
    const bad = { kind: 'decal', payload: {}, source: { editor: 'decal-pack' } }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bad))
    expect(readClipboard()).toBeNull()
  })

  it('works with decal kind and decal-pack editor', () => {
    const entry: ClipboardEntry = {
      kind: 'decal',
      payload: { decalId: 'abc' },
      source: { editor: 'decal-pack', copiedAt: '2026-06-01T12:00:00.000Z' },
    }
    writeClipboard(entry)
    expect(readClipboard()).toEqual(entry)
  })
})

describe('cross-editor kind mismatch detection', () => {
  it('faceplate-layer entry from faceplate editor reads back correctly', () => {
    const entry: ClipboardEntry = {
      kind: 'faceplate-layer',
      payload: { id: 'layer_abc', kind: 'text' },
      source: { editor: 'faceplate', copiedAt: new Date().toISOString() },
    }
    writeClipboard(entry)
    const read = readClipboard()
    expect(read).not.toBeNull()
    expect(read!.kind).toBe('faceplate-layer')
    expect(read!.source.editor).toBe('faceplate')
  })

  it('decal entry from decal-pack editor reads back correctly', () => {
    const entry: ClipboardEntry = {
      kind: 'decal',
      payload: { id: 'decal_xyz' },
      source: { editor: 'decal-pack', copiedAt: new Date().toISOString() },
    }
    writeClipboard(entry)
    const read = readClipboard()
    expect(read).not.toBeNull()
    expect(read!.kind).toBe('decal')
    expect(read!.source.editor).toBe('decal-pack')
  })

  it('caller code can detect cross-editor mismatch by checking kind vs expected', () => {
    // Simulate: faceplate editor copied a layer, decal-pack editor tries to paste
    const faceplateEntry: ClipboardEntry = {
      kind: 'faceplate-layer',
      payload: { id: 'layer_fp', kind: 'image' },
      source: { editor: 'faceplate', copiedAt: new Date().toISOString() },
    }
    writeClipboard(faceplateEntry)
    const read = readClipboard()
    // The decal-pack editor should ignore entries where kind !== 'decal'
    const isDecalEntry = read?.kind === 'decal'
    expect(isDecalEntry).toBe(false)
  })

  it('caller code can detect cross-editor mismatch by checking source.editor', () => {
    // Simulate: decal-pack copied a decal, faceplate editor tries to paste
    const decalEntry: ClipboardEntry = {
      kind: 'decal',
      payload: { id: 'decal_d1' },
      source: { editor: 'decal-pack', copiedAt: new Date().toISOString() },
    }
    writeClipboard(decalEntry)
    const read = readClipboard()
    // The faceplate editor should ignore entries where source.editor !== 'faceplate'
    const isFaceplateEntry = read?.source.editor === 'faceplate'
    expect(isFaceplateEntry).toBe(false)
  })
})
