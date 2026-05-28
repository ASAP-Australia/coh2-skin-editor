/**
 * Tests for WipeMigrationScreen — the one-time first-launch screen that
 * clears pre-v1.0 fake-Workshop-ID SGAs from the user's CoH2 mods tree.
 *
 * Three contracts to pin:
 *
 *  1. Short-circuit behaviour — when there's nothing to clean (no
 *     modsPath, no electronAPI, empty scan), the screen never displays
 *     and onComplete fires immediately. Skipping the screen unnecessarily
 *     is what keeps fresh installs from staring at a useless dialog.
 *
 *  2. Two-step flow — review → confirm → done. We must never trash on
 *     the first button click; the user has to acknowledge what's going
 *     into the bin. This guards against accidental cleanup if the
 *     classifier ever misfires.
 *
 *  3. Completion side-effect — finishing (or skipping) sets the
 *     localStorage flag so subsequent sessions skip the screen.
 *
 * Test infra mirrors the rest of the suite: React 19 createRoot + act,
 * no @testing-library. window.electronAPI is duck-typed in beforeEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// React 19 emits "current testing environment is not configured to support
// act(...)" stderr noise unless this global flag is set. Setting it once at
// module scope rather than per-test keeps the suite output readable.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import WipeMigrationScreen, { WIPE_DONE_KEY } from '../WipeMigrationScreen'
import type { FakeIdEntry } from '@/lib/native-fs'

// ── Fixtures ─────────────────────────────────────────────────────────

const fakeEntries: FakeIdEntry[] = [
  {
    kind: 'skins',
    path: '/mods/skins/1700000000000111.sga',
    id: '1700000000000111',
    size: 12_345,
    reason: 'numeric-above-threshold',
  },
  {
    kind: 'decals',
    path: '/mods/decals/subscriptions/abc-decal.sga',
    id: 'abc-decal',
    size: 6_789,
    reason: 'non-numeric-basename',
  },
  {
    kind: 'faceplates',
    path: '/mods/faceplates/subscriptions/790bfac8d4e34a5b9c2f1e0d8a7b6c5e.sga',
    id: '790bfac8d4e34a5b9c2f1e0d8a7b6c5e',
    size: 23_456,
    reason: 'non-numeric-basename',
  },
]

// ── Render harness ───────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

function renderScreen(props: {
  modsPath: string | null
  onComplete: () => void
}): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(createElement(WipeMigrationScreen, props))
  })
  return container
}

/** Drain pending microtasks + scheduled React work so the post-mount
 *  useEffect's async scan resolves and we land in the next phase. */
async function flush() {
  await act(async () => {
    // Run microtasks, then setTimeout(0), then microtasks again — covers
    // both `await fetch`-style chains and React's scheduling queue.
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 0))
    await Promise.resolve()
  })
}

function findText(text: string | RegExp): HTMLElement | null {
  if (!container) return null
  const matcher =
    typeof text === 'string' ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : text
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, null)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const el = node as HTMLElement
    // Only consider elements whose direct text matches — avoids parents
    // that "contain" the text in their descendant subtree.
    const direct = Array.from(el.childNodes)
      .filter(c => c.nodeType === Node.TEXT_NODE)
      .map(c => c.textContent ?? '')
      .join(' ')
    if (matcher.test(direct)) return el
  }
  return null
}

function findClickable(label: string | RegExp): HTMLElement {
  if (!container) throw new Error('container not mounted')
  const matcher =
    typeof label === 'string'
      ? new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : label
  for (const el of Array.from(container.querySelectorAll('button, a'))) {
    const txt = (el.textContent ?? '').trim()
    if (matcher.test(txt)) return el as HTMLElement
  }
  throw new Error(`No button/link matching ${label.toString()}`)
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await flush()
}

// ── Mock IPC ─────────────────────────────────────────────────────────

interface MockApi {
  scanFakeIds: ReturnType<typeof vi.fn>
  trashFakeIds: ReturnType<typeof vi.fn>
}

function installMockApi(api?: Partial<MockApi>): MockApi {
  const merged: MockApi = {
    scanFakeIds: vi.fn(async () => [] as FakeIdEntry[]),
    trashFakeIds: vi.fn(async () => ({ trashed: [] as string[], failed: [] })),
    ...api,
  }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { mods: merged }
  return merged
}

function uninstallMockApi() {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
}

// ── Suite ────────────────────────────────────────────────────────────

describe('WipeMigrationScreen', () => {
  beforeEach(() => {
    localStorage.clear()
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
    uninstallMockApi()
    vi.restoreAllMocks()
  })

  it('skips entirely when modsPath is null', async () => {
    const onComplete = vi.fn()
    renderScreen({ modsPath: null, onComplete })
    await flush()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('skips when electronAPI is missing', async () => {
    uninstallMockApi()
    const onComplete = vi.fn()
    renderScreen({ modsPath: '/mods', onComplete })
    await flush()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('skips when the scan returns zero entries', async () => {
    const api = installMockApi()
    const onComplete = vi.fn()
    renderScreen({ modsPath: '/mods', onComplete })
    await flush()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(api.scanFakeIds).toHaveBeenCalledWith('/mods')
  })

  it('shows the review screen when fakes are found', async () => {
    installMockApi({ scanFakeIds: vi.fn(async () => fakeEntries) })
    const onComplete = vi.fn()
    renderScreen({ modsPath: '/mods', onComplete })
    await flush()
    expect(findText(/Old mod files found/)).not.toBeNull()
    // Kind list shows the three buckets we put fakes in.
    expect(findText(/^decals$/i)).not.toBeNull()
    expect(findText(/^faceplates$/i)).not.toBeNull()
    expect(findText(/^skins$/i)).not.toBeNull()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('skip-for-now finishes without trashing and sets the localStorage flag', async () => {
    const api = installMockApi({ scanFakeIds: vi.fn(async () => fakeEntries) })
    const onComplete = vi.fn()
    renderScreen({ modsPath: '/mods', onComplete })
    await flush()

    await click(findClickable(/Skip for now/))
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(api.trashFakeIds).not.toHaveBeenCalled()
    expect(localStorage.getItem(WIPE_DONE_KEY)).toBeTruthy()
  })

  it('two-step flow: review → confirm → trash → done → continue', async () => {
    const trashFakeIds = vi.fn(async (paths: string[]) => ({
      trashed: paths,
      failed: [] as { path: string; error: string }[],
    }))
    installMockApi({
      scanFakeIds: vi.fn(async () => fakeEntries),
      trashFakeIds,
    })
    const onComplete = vi.fn()
    renderScreen({ modsPath: '/mods', onComplete })
    await flush()

    // Review → Confirm.
    await click(findClickable(/Review & trash/))
    expect(findText(/Move these to Trash\?/)).not.toBeNull()
    expect(trashFakeIds).not.toHaveBeenCalled() // not yet

    // Confirm → Trashing → Done.
    await click(findClickable(/^Move to Trash$/))
    expect(trashFakeIds).toHaveBeenCalledTimes(1)
    expect(trashFakeIds).toHaveBeenCalledWith(
      fakeEntries.map(e => e.path),
      '/mods',
    )
    expect(findText(/All clean/)).not.toBeNull()

    // Continue → onComplete.
    await click(findClickable(/Continue to editor/))
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(WIPE_DONE_KEY)).toBeTruthy()
  })

  it('confirm → Back returns to the review screen without trashing', async () => {
    const api = installMockApi({ scanFakeIds: vi.fn(async () => fakeEntries) })
    renderScreen({ modsPath: '/mods', onComplete: vi.fn() })
    await flush()

    await click(findClickable(/Review & trash/))
    expect(findText(/Move these to Trash\?/)).not.toBeNull()

    await click(findClickable(/^Back$/))
    expect(findText(/Old mod files found/)).not.toBeNull()
    expect(api.trashFakeIds).not.toHaveBeenCalled()
  })

  it('renders the partial-failure summary when some files fail to trash', async () => {
    installMockApi({
      scanFakeIds: vi.fn(async () => fakeEntries),
      trashFakeIds: vi.fn(async () => ({
        trashed: [fakeEntries[0]!.path],
        failed: [{ path: fakeEntries[1]!.path, error: 'disk error' }],
      })),
    })
    renderScreen({ modsPath: '/mods', onComplete: vi.fn() })
    await flush()

    await click(findClickable(/Review & trash/))
    await click(findClickable(/^Move to Trash$/))

    expect(findText(/Partial cleanup/)).not.toBeNull()
    expect(findText(/disk error/)).not.toBeNull()
  })
})
