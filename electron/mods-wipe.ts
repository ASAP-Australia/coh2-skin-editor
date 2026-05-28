/**
 * mods-wipe.ts — one-time migration to clear pre-v1.0 "fake Workshop ID" SGAs
 * from the CoH2 mods tree.
 *
 * The bug: pre-v1.0 Live Sync dropped built .sga packs into
 *
 *   <modsRoot>/decals/subscriptions/<32-hex-guid>.sga
 *   <modsRoot>/faceplates/subscriptions/<32-hex-guid>.sga
 *   <modsRoot>/skins/<numericId>.sga         (numericId ≈ Date.now()*1000)
 *
 * Decals and faceplates used a 32-hex GUID basename; skins used a fake
 * 16-digit numeric ID derived from `Date.now()`. Either way these basenames
 * don't correspond to a real Steam Workshop file ID, so when the user joined
 * a multiplayer lobby CoH2 asked Steam "do these IDs exist?" and Steam said
 * no — the lobby kicked them with a Workshop-validation error.
 *
 * v1.0 fixes the bug at the source (Live Sync is disabled; the only path
 * for skins/decals/faceplates to reach the game is Steam Workshop publish +
 * subscribe), but every user who tried v0.x has a folder full of these
 * fake-ID files sitting in their mods tree. They'll keep failing lobby
 * validation until the files are gone.
 *
 * This module:
 *   1. Scans the four buckets that the old Live Sync wrote to.
 *   2. Classifies each .sga as "fake" or "real" by basename:
 *        • non-numeric basename (e.g. 32-hex GUID) → fake (locally-derived)
 *        • numeric basename ≥ FAKE_ID_THRESHOLD     → fake (Date-based)
 *        • numeric basename < FAKE_ID_THRESHOLD     → real Workshop sub
 *   3. Moves each fake file to the OS trash via `shell.trashItem()` — NOT
 *      `fs.unlink()`. If we misclassify a real subscription the user can
 *      restore it from trash; permanent deletion would be unrecoverable.
 *
 * The threshold (10^11) is chosen to sit above the highest real Workshop
 * file ID (~5×10^9 in late 2025) and well below the fake-ID range (1.7×10^15
 * from `Date.now() * 1000`). Workshop's counter would have to grow ~30×
 * before we'd start classifying real IDs as fake.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { shell } from 'electron'

/** Buckets the pre-v1.0 Live Sync wrote to, mapped to their on-disk layout. */
const BUCKETS: { kind: FakeIdKind; subdir: string }[] = [
  { kind: 'decals', subdir: path.join('decals', 'subscriptions') },
  { kind: 'faceplates', subdir: path.join('faceplates', 'subscriptions') },
  { kind: 'extension', subdir: path.join('extension', 'subscriptions') },
  // CoH2 scans mods/skins/ DIRECTLY for `%I64u.sga` (no subscriptions/ sublayer).
  { kind: 'skins', subdir: 'skins' },
]

/** Threshold separating "real Workshop ID" from "fake Date-based ID".
 *  Workshop's file-ID counter is monotonically increasing and sat around
 *  5×10^9 in late 2025; the fake ID generator produced values ~1.7×10^15.
 *  Anything ≥ 10^11 is treated as fake. */
export const FAKE_ID_THRESHOLD = 100_000_000_000n // 1e11

export type FakeIdKind = 'decals' | 'faceplates' | 'extension' | 'skins'

export interface FakeIdEntry {
  kind: FakeIdKind
  /** Absolute path to the .sga file on disk. */
  path: string
  /** Basename without the `.sga` extension. */
  id: string
  /** File size in bytes (cheap stat). */
  size: number
  /** Why we flagged this entry — useful for the UI's reveal-details mode. */
  reason: 'non-numeric-basename' | 'numeric-above-threshold'
}

export interface TrashResult {
  /** Absolute paths that were successfully moved to trash. */
  trashed: string[]
  /** Paths that failed, with the error message from the OS. */
  failed: { path: string; error: string }[]
}

/**
 * Classify a single SGA basename (no extension) as fake or not.
 *
 * Exported for unit testing — the scanner uses this internally.
 * Returns `null` if the basename is a plausibly-real Workshop ID.
 */
export function classifyFakeId(
  basename: string,
): { reason: FakeIdEntry['reason'] } | null {
  // All-digits → numeric ID. Otherwise it's a 32-hex GUID or some other
  // non-Workshop format — definitely fake.
  if (!/^\d+$/.test(basename)) {
    return { reason: 'non-numeric-basename' }
  }
  // Use BigInt for the comparison: `Date.now() * 1000 + salt` is well within
  // Number.MAX_SAFE_INTEGER, but parsing through BigInt is robust against
  // future drift and avoids accidental loss of precision.
  let parsed: bigint
  try {
    parsed = BigInt(basename)
  } catch {
    return { reason: 'non-numeric-basename' }
  }
  if (parsed >= FAKE_ID_THRESHOLD) {
    return { reason: 'numeric-above-threshold' }
  }
  return null
}

/**
 * Walk the four pre-v1.0 Live Sync buckets under `modsRoot` and return
 * every .sga whose basename trips the fake-ID heuristic.
 *
 * Synchronous + fs.readdirSync — these directories typically hold at most
 * a few dozen entries, and the migration screen only runs once per user.
 * The cost of an async pump is not worth the complexity.
 *
 * Returns an empty array if `modsRoot` doesn't exist or none of the
 * buckets exist (which is the case for users who never ran v0.x).
 */
export function scanFakeIdSgas(modsRoot: string): FakeIdEntry[] {
  const out: FakeIdEntry[] = []
  if (!modsRoot || typeof modsRoot !== 'string') return out
  let modsStat: fs.Stats
  try {
    modsStat = fs.statSync(modsRoot)
  } catch {
    return out
  }
  if (!modsStat.isDirectory()) return out

  for (const bucket of BUCKETS) {
    const dir = path.join(modsRoot, bucket.subdir)
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      // Bucket missing → user never built that item type. Skip silently.
      continue
    }
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.sga')) continue
      const full = path.join(dir, entry)
      const base = entry.slice(0, -'.sga'.length)
      const verdict = classifyFakeId(base)
      if (!verdict) continue
      let size: number
      try {
        size = fs.statSync(full).size
      } catch {
        // Disappeared between readdir and stat — skip.
        continue
      }
      out.push({
        kind: bucket.kind,
        path: full,
        id: base,
        size,
        reason: verdict.reason,
      })
    }
  }
  return out
}

/**
 * Move each given path to the OS trash. Uses Electron's
 * `shell.trashItem()` so the user can restore from Recycle Bin / Trash
 * if we misidentified a real Workshop subscription.
 *
 * Validates that every path actually lives under `expectedModsRoot` —
 * the IPC handler passes the auto-detected mods folder, and the renderer
 * can only supply paths the scanner already returned. This belt-and-
 * braces check guards against a renderer compromise feeding us a path
 * like `/etc/passwd`.
 */
export async function trashFakeIdSgas(
  paths: string[],
  expectedModsRoot: string,
): Promise<TrashResult> {
  const trashed: string[] = []
  const failed: { path: string; error: string }[] = []
  const rootResolved = path.resolve(expectedModsRoot)
  for (const p of paths) {
    const resolved = path.resolve(p)
    // path containment check — the resolved file must sit under the
    // mods folder we were told to operate on. `relative` returning a
    // string that starts with `..` means we escaped.
    const rel = path.relative(rootResolved, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      failed.push({ path: p, error: 'path is outside the mods folder' })
      continue
    }
    if (!resolved.toLowerCase().endsWith('.sga')) {
      failed.push({ path: p, error: 'refusing to trash non-.sga file' })
      continue
    }
    try {
      await shell.trashItem(resolved)
      trashed.push(resolved)
    } catch (err) {
      failed.push({
        path: p,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { trashed, failed }
}
