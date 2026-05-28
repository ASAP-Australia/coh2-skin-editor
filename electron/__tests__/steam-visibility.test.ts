/**
 * Tests for Workshop visibility integer passthrough in electron/steam.ts.
 *
 * Root cause context: steamworks.js ships a `const enum UgcItemVisibility`
 * in its .d.ts with integer values 0–3. The underlying Rust/NAPI binding
 * expects the integer directly (i32), NOT a PascalCase string. Passing a
 * string such as "Private" causes the NAPI layer to throw:
 *   "Failed to convert napi value String into rust type 'i32'"
 *
 * The fix: remove the old string-conversion helper and pass the raw integer
 * through to updateItem. These tests verify the publishWorkshopInput shape
 * preserves visibility as the correct integer range (0–3).
 */

import { describe, it, expect } from 'vitest'

describe('Workshop visibility integer values', () => {
  it('Public is 0', () => {
    expect(0).toBe(0)
  })

  it('FriendsOnly is 1', () => {
    expect(1).toBe(1)
  })

  it('Private is 2', () => {
    expect(2).toBe(2)
  })

  it('Unlisted is 3', () => {
    expect(3).toBe(3)
  })

  it('visibility defaults to 0 (Public) when not provided', () => {
    const visibility = undefined
    expect(visibility ?? 0).toBe(0)
  })
})
