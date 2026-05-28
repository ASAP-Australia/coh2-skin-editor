import { describe, it, expect } from 'vitest'
import { defaultInstallPath, defaultModsPath, osLabel, relTime, type OS } from '../ux'

// ---------------------------------------------------------------------------
// defaultInstallPath
// ---------------------------------------------------------------------------

describe('defaultInstallPath', () => {
  it('returns a Windows path for win', () => {
    const p = defaultInstallPath('win')
    expect(p).toContain('Program Files')
    expect(p).toContain('Company of Heroes 2')
  })

  it('returns a macOS path for mac', () => {
    const p = defaultInstallPath('mac')
    expect(p).toContain('Library/Application Support')
    expect(p).toContain('Company of Heroes 2')
  })

  it('returns a Linux path for linux', () => {
    const p = defaultInstallPath('linux')
    expect(p).toContain('.local/share/Steam')
    expect(p).toContain('Company of Heroes 2')
  })

  it('returns a generic path for other', () => {
    const p = defaultInstallPath('other')
    expect(p).toContain('Company of Heroes 2')
  })

  it('uses backslashes for Windows path', () => {
    expect(defaultInstallPath('win')).toMatch(/\\/)
  })

  it('uses forward slashes for Linux path', () => {
    expect(defaultInstallPath('linux')).toMatch(/\//)
  })
})

// ---------------------------------------------------------------------------
// defaultModsPath
// ---------------------------------------------------------------------------

describe('defaultModsPath', () => {
  it('returns a Windows mods path containing mods/skins', () => {
    const p = defaultModsPath('win')
    expect(p).toContain('mods')
    expect(p).toContain('skins')
  })

  it('returns a macOS mods path', () => {
    const p = defaultModsPath('mac')
    expect(p).toContain('mods')
    expect(p).toContain('skins')
  })

  it('returns a Linux mods path', () => {
    const p = defaultModsPath('linux')
    expect(p).toContain('mods')
    expect(p).toContain('skins')
  })

  it('returns a generic mods path for other', () => {
    const p = defaultModsPath('other')
    expect(p).toContain('mods')
    expect(p).toContain('skins')
  })

  it('Windows mods path includes Company of Heroes 2', () => {
    expect(defaultModsPath('win')).toContain('Company of Heroes 2')
  })
})

// ---------------------------------------------------------------------------
// osLabel
// ---------------------------------------------------------------------------

describe('osLabel', () => {
  const cases: Array<[OS, string]> = [
    ['win', 'Windows'],
    ['mac', 'macOS'],
    ['linux', 'Linux / Steam Deck'],
    ['other', 'your OS'],
  ]

  for (const [os, label] of cases) {
    it(`returns "${label}" for ${os}`, () => {
      expect(osLabel(os)).toBe(label)
    })
  }

  it('contains "Steam Deck" in the Linux label', () => {
    expect(osLabel('linux')).toContain('Steam Deck')
  })
})

// ---------------------------------------------------------------------------
// relTime
// ---------------------------------------------------------------------------

describe('relTime', () => {
  it('returns "never" for undefined', () => {
    expect(relTime(undefined)).toBe('never')
  })

  it('returns "just now" for a future timestamp (clock drift)', () => {
    const future = new Date(Date.now() + 5_000).toISOString()
    expect(relTime(future)).toBe('just now')
  })

  it('returns "just now" for timestamps within 5 seconds', () => {
    const recent = new Date(Date.now() - 2_000).toISOString()
    expect(relTime(recent)).toBe('just now')
  })

  it('returns seconds ago for 5-59 seconds', () => {
    const t = new Date(Date.now() - 30_000).toISOString()
    expect(relTime(t)).toBe('30s ago')
  })

  it('returns minutes ago for 1-59 minutes', () => {
    const t = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(relTime(t)).toBe('5m ago')
  })

  it('returns hours ago for 1+ hours', () => {
    const t = new Date(Date.now() - 2 * 3_600_000).toISOString()
    expect(relTime(t)).toBe('2h ago')
  })

  it('boundary: exactly 5 seconds ago is "just now"', () => {
    const t = new Date(Date.now() - 4_999).toISOString()
    expect(relTime(t)).toBe('just now')
  })

  it('boundary: 60 seconds ago is "1m ago"', () => {
    const t = new Date(Date.now() - 60_000).toISOString()
    expect(relTime(t)).toBe('1m ago')
  })
})
