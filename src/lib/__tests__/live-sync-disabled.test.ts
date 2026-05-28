/**
 * live-sync-disabled.test.ts — v1.0 Steam-first behaviour lock.
 *
 * The pre-v1.0 LiveSyncManager wrote built SGAs into the user's CoH2
 * mods/{decals,faceplates,extension,skins}/subscriptions/ tree on every
 * edit. The Steam-first architecture (.llm/steam-first-design.md) forbids
 * any app-side writes to that tree — Steam handles the placement as a
 * side effect of publishing. To keep existing UI bindings (the
 * LiveSyncBadge in the editor toolbar) compiling without a sweep, the
 * class and its observable API survive, but every entry point is a
 * no-op. This test pins that contract so a future patch can't quietly
 * re-enable the sink and re-introduce the lobby-validation bug.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('LiveSyncManager — v1.0 disabled by default', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initialises in `disabled` state with the Steam-first reason string', async () => {
    vi.resetModules()
    const { getLiveSyncManager } = await import('../live-sync')
    const mgr = getLiveSyncManager()
    const snap = mgr.getSnapshot()
    expect(snap.state).toBe('disabled')
    expect(snap.enabled).toBe(false)
    expect(snap.reason.toLowerCase()).toContain('workshop')
  })

  it('schedule() is a no-op — state never leaves `disabled`', async () => {
    vi.resetModules()
    const { getLiveSyncManager, scheduleLiveSync } = await import('../live-sync')
    const mgr = getLiveSyncManager()

    // Sanity: pre-schedule state.
    expect(mgr.getSnapshot().state).toBe('disabled')

    // Pump a schedule with a minimal skin-shaped project. We don't expose
    // the project types to the module here so we cast through unknown —
    // the goal is to prove schedule() returns without mutating state, not
    // to exercise the (now-dead) export pipeline.
    const fakeProject = { id: 'p1', kind: 'skin' } as unknown as Parameters<typeof scheduleLiveSync>[1]
    scheduleLiveSync('skin', fakeProject)

    expect(mgr.getSnapshot().state).toBe('disabled')
  })

  it('persists `disabled` in localStorage so the next session starts off too', async () => {
    vi.resetModules()
    const { getLiveSyncManager } = await import('../live-sync')
    // The singleton is lazy — touching getLiveSyncManager() triggers the
    // constructor which writes the localStorage flag.
    getLiveSyncManager()
    expect(localStorage.getItem('coh2-skin:live-sync-enabled')).toBe('false')
  })
})
