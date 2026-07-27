import { describe, it, expect } from 'vitest'
import { liveSyncTooltip, EQUIP_HINT } from '../live-sync'

/**
 * "Synced" reads as "done", but CoH2 will not show a skin until it is EQUIPPED,
 * and the equipped loadout is server-side so nothing local can set it.
 *
 * Verified in-game 2026-07-27: a skin built by this app, installed to
 * mods/skins/, did NOT appear on the vehicles — they rendered default camo —
 * even though the pack is byte-structurally identical to third-party skins the
 * engine does render. Without the hint a user reasonably concludes the app is
 * broken, so these tests pin it in place.
 */
describe('liveSyncTooltip', () => {
  it('says Live Sync is off when disabled, and never nags about equipping', () => {
    const t = liveSyncTooltip(false, 'whatever', 'idle')
    expect(t).toBe('Click to rename — Live Sync is off')
    expect(t).not.toContain('equip')
  })

  it('shows the reason but NOT the equip hint while still working', () => {
    for (const s of ['idle', 'syncing', 'queued', 'error'] as const) {
      const t = liveSyncTooltip(true, 'Building and writing mod…', s)
      expect(t).toContain('Building and writing mod…')
      expect(t, `state ${s} should not claim it is installed yet`).not.toContain(EQUIP_HINT)
    }
  })

  it('appends the equip step ONCE synced — the whole point', () => {
    const t = liveSyncTooltip(true, 'Synced just now', 'synced')
    expect(t).toContain('Synced just now')
    expect(t).toContain(EQUIP_HINT)
  })

  it('the hint names the actual UI path and the Custom Games constraint', () => {
    // Both details are load-bearing: the weapons-case route is the only way in,
    // and custom skins never render in Automatch, so a user testing there would
    // see nothing and blame the app.
    expect(EQUIP_HINT).toMatch(/player card/i)
    expect(EQUIP_HINT).toMatch(/weapons-case/i)
    expect(EQUIP_HINT).toMatch(/custom games/i)
  })

  it('honours a custom prefix (the editors use different nouns)', () => {
    expect(liveSyncTooltip(true, 'Synced just now', 'synced', 'Pack name')).toMatch(/^Pack name — /)
    expect(liveSyncTooltip(false, '', 'idle', 'Project name')).toBe('Project name — Live Sync is off')
  })
})
