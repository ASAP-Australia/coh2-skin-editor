/**
 * Tests for the visibilityToSteamString helper in electron/steam.ts.
 *
 * Root cause context: steamworks.js ships a `const enum UgcItemVisibility`
 * in its .d.ts with integer values 0–3, but the underlying Rust/NAPI
 * binding deserialises `visibility` as a string enum at runtime. Passing
 * the integer 2 for "Private" (or any other raw integer) causes Steam's
 * SDK to return "a parameter is invalid". The fix is to map each integer
 * to its PascalCase string variant name before the IPC call reaches
 * steamworks.js.
 *
 * These tests are pure-function unit tests; no Steam client is required.
 */

import { visibilityToSteamString } from '../steam'

describe('visibilityToSteamString', () => {
  it('maps 0 → "Public"', () => {
    expect(visibilityToSteamString(0)).toBe('Public')
  })

  it('maps 1 → "FriendsOnly"', () => {
    expect(visibilityToSteamString(1)).toBe('FriendsOnly')
  })

  it('maps 2 → "Private"', () => {
    // This is the bug case: the integer 2 was previously sent to steamworks.js,
    // which rejected it with "a parameter is invalid".
    expect(visibilityToSteamString(2)).toBe('Private')
  })

  it('maps 3 → "Unlisted"', () => {
    expect(visibilityToSteamString(3)).toBe('Unlisted')
  })

  it('throws a clear error for an unknown value', () => {
    expect(() => visibilityToSteamString(99)).toThrow(
      'Unknown Workshop visibility value: 99',
    )
  })

  it('throws for negative values', () => {
    expect(() => visibilityToSteamString(-1)).toThrow(
      'Unknown Workshop visibility value: -1',
    )
  })
})
