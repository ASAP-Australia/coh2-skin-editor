/**
 * installed-pack-info.ts — parse the human-readable pack name from a CoH2
 * `.info` file (the metadata blob embedded in every skin-pack / decal-pack SGA).
 *
 * `.info` format (ASCII, CRLF line endings, written by buildInfoFile /
 * rewriteInfo in this codebase):
 *
 *   hidden = false
 *   name = "Pack Display Name"
 *   description = "..."
 *   dependencies =
 *   {
 *   }
 *
 * This module is **pure TypeScript** (no Node.js imports) so it can run in the
 * browser test harness under vitest.  The actual file reading + decompression
 * lives in `electron/detect-coh2.ts` (Node-side, behind the IPC).
 */

/**
 * Parse the `name` field from a CoH2 `.info` file's text content.
 *
 * Accepts the raw UTF-8 text (CRLF or LF) and returns the bare display name
 * with internal escape sequences resolved:
 *   - `\\"`  → `"`
 *   - `\\\\` → `\`
 *   - `\\n`  → newline (rare, just in case)
 *
 * Returns `null` when no `name = "..."` line is present.
 */
export function parseInfoName(infoText: string): string | null {
  // Match `name = "..."` — allow optional whitespace around `=`.
  // The value is double-quoted; internal double-quotes are escaped as \".
  // Use a non-greedy match so the closing quote is the FIRST unescaped `"`.
  const m = infoText.match(/^\s*name\s*=\s*"((?:[^"\\]|\\.)*)"/m)
  if (!m) return null

  // Unescape the value.
  return m[1]
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .trim() || null
}

/**
 * Determine the pack type from the paths inside an SGA's TOC.
 *
 * We classify by looking for distinguishing attrib paths:
 *   - `attrib/skin_pack/`  → 'skin'
 *   - `attrib/decal/` or badge-style paths → 'decal'
 *   - `attrib/faceplate/` → 'faceplate'
 *
 * Falls back to `'unknown'` when neither pattern is present.
 */
export type PackType = 'skin' | 'decal' | 'faceplate' | 'unknown'

export function inferPackTypeFromPaths(paths: string[]): PackType {
  for (const p of paths) {
    const lc = p.replace(/\\/g, '/').toLowerCase()
    if (lc.includes('attrib/skin_pack/'))      return 'skin'
    if (lc.includes('attrib/vehicle_decal/'))  return 'decal'
    if (lc.includes('attrib/decal/'))          return 'decal'
    // Badge-style decal packs often live under art/armies/<faction>/badges/
    if (lc.includes('/badges/'))               return 'decal'
    if (lc.includes('attrib/faceplate/'))      return 'faceplate'
  }
  return 'unknown'
}
