/**
 * live-sync-always-on.test.ts — v1.0 always-on live-sync behaviour lock.
 *
 * Live Sync is permanently enabled in v1.0. Every edit (decal drag, camo
 * change, name/icon update) is debounced and written into the user's CoH2
 * mods folder automatically — there is no opt-out toggle. This test pins
 * that contract so a future patch can't accidentally re-introduce the
 * Steam-first no-op or restore a default-disabled state.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('LiveSyncManager — v1.0 always on by default', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initialises in `idle` state (enabled)', async () => {
    vi.resetModules()
    const { getLiveSyncManager } = await import('../live-sync')
    const mgr = getLiveSyncManager()
    const snap = mgr.getSnapshot()
    expect(snap.state).toBe('idle')
    expect(snap.enabled).toBe(true)
  })

  it('schedule() transitions state to `queued` when enabled', async () => {
    vi.resetModules()
    const { getLiveSyncManager, scheduleLiveSync } = await import('../live-sync')
    const mgr = getLiveSyncManager()

    // Sanity: pre-schedule state is idle (enabled).
    expect(mgr.getSnapshot().state).toBe('idle')

    // Pump a schedule with a minimal skin-shaped project.
    const fakeProject = { id: 'p1', kind: 'skin' } as unknown as Parameters<typeof scheduleLiveSync>[1]
    scheduleLiveSync('skin', fakeProject)

    // State should now be 'queued' (not 'disabled' or unchanged)
    expect(mgr.getSnapshot().state).toBe('queued')
  })

  it('persists `true` in localStorage so the next session also starts enabled', async () => {
    vi.resetModules()
    const { getLiveSyncManager } = await import('../live-sync')
    // The singleton is lazy — touching getLiveSyncManager() triggers the
    // constructor which writes the localStorage flag.
    getLiveSyncManager()
    expect(localStorage.getItem('coh2-skin:live-sync-enabled')).toBe('true')
  })
})
