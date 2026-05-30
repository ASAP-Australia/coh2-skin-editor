/**
 * Offline byte-level verifier for signed-template patches.
 *
 * Diffs a patched SGA against the original signed template and proves that
 * every changed byte falls inside one of the manifest's declared slot ranges.
 * The header + TOC + RSA signature block (everything outside the slot ranges)
 * must be byte-identical.
 *
 * Usage:
 *   npx tsx tools/verify-signed-patch.mts [path/to/patched.sga]
 *   # Default: most-recently-modified file in out/verification/signed/
 *
 * Exit code: 0 = PASS, 1 = FAIL or error.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TEMPLATE_PATH = path.resolve('tools/templates/signed/template_0001.sga')
const MANIFEST_PATH = path.resolve('public/keys/manifest.json')
const OUT_DIR = path.resolve('out/verification/signed')

const CHUNK = 4 * 1024 * 1024 // 4 MB read window

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function latestSga(dir: string): string {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sga'))
    .map(f => ({ f, mt: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mt - a.mt)
  if (!files.length) throw new Error(`No .sga files found in ${dir}`)
  return path.join(dir, files[0]!.f)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const patchedPath = process.argv[2] || latestSga(OUT_DIR)
  console.log(`Template : ${TEMPLATE_PATH}`)
  console.log(`Patched  : ${patchedPath}`)

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const key = manifest.keys[0]
  const rgtFiles: Record<string, { offset: number; length: number }> = key.rgtFiles

  // Build sorted list of [start, end) ranges declared in the manifest
  const slots: Array<[number, number]> = Object.values(rgtFiles).map(e => [e.offset, e.offset + e.length])
  slots.sort((a, b) => a[0] - b[0])

  const tStat = fs.statSync(TEMPLATE_PATH)
  const pStat = fs.statSync(patchedPath)
  console.log(`Template size : ${(tStat.size / 1024 / 1024).toFixed(1)} MB`)
  console.log(`Patched size  : ${(pStat.size / 1024 / 1024).toFixed(1)} MB`)

  if (tStat.size !== pStat.size) {
    console.error(`FAIL: file sizes differ — template ${tStat.size}, patched ${pStat.size}`)
    process.exit(1)
  }

  const totalBytes = tStat.size
  const tFd = fs.openSync(TEMPLATE_PATH, 'r')
  const pFd = fs.openSync(patchedPath, 'r')

  const tBuf = Buffer.alloc(CHUNK)
  const pBuf = Buffer.alloc(CHUNK)

  let offset = 0
  let tocDiffs = 0        // diffs outside any slot range → signature violation
  let slotDiffs = 0       // diffs inside a slot range → expected writes
  const changedRanges: Array<[number, number]> = []

  // Helper: is byte position inside any declared slot?
  function inSlot(pos: number): boolean {
    // Binary search in sorted slots
    let lo = 0, hi = slots.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const [s, e] = slots[mid]!
      if (pos >= s && pos < e) return true
      if (pos < s) hi = mid - 1
      else lo = mid + 1
    }
    return false
  }

  let inRun = false
  let runStart = 0
  let runInSlot = false

  while (offset < totalBytes) {
    const toRead = Math.min(CHUNK, totalBytes - offset)
    fs.readSync(tFd, tBuf, 0, toRead, offset)
    fs.readSync(pFd, pBuf, 0, toRead, offset)

    for (let i = 0; i < toRead; i++) {
      const globalPos = offset + i
      if (tBuf[i] !== pBuf[i]) {
        const slot = inSlot(globalPos)
        if (slot) slotDiffs++; else tocDiffs++

        if (!inRun) {
          inRun = true
          runStart = globalPos
          runInSlot = slot
        } else if (slot !== runInSlot) {
          // boundary — close previous run, start new
          changedRanges.push([runStart, globalPos - 1])
          runStart = globalPos
          runInSlot = slot
        }
      } else {
        if (inRun) {
          changedRanges.push([runStart, globalPos - 1])
          inRun = false
        }
      }
    }
    offset += toRead
    if (offset % (64 * 1024 * 1024) === 0) {
      process.stdout.write(`\r  scanned ${(offset / 1024 / 1024).toFixed(0)} / ${(totalBytes / 1024 / 1024).toFixed(0)} MB   `)
    }
  }
  if (inRun) changedRanges.push([runStart, totalBytes - 1])

  fs.closeSync(tFd)
  fs.closeSync(pFd)
  console.log()

  // ── Report ─────────────────────────────────────────────────────────────
  console.log('\n=== verify-signed-patch results ===')
  console.log(`  Changed ranges : ${changedRanges.length}`)
  console.log(`  Bytes in slots : ${slotDiffs}`)
  console.log(`  Bytes in TOC   : ${tocDiffs}  ← must be 0 for PASS`)

  if (changedRanges.length > 0 && changedRanges.length <= 200) {
    console.log('\nChanged ranges (start – end, in/out of slot):')
    for (const [s, e] of changedRanges) {
      const isSlot = inSlot(s)
      console.log(`  [${s.toString().padStart(12)}, ${e.toString().padStart(12)}]  ${isSlot ? 'IN slot' : 'OUT OF SLOT ← VIOLATION'}`)
    }
  } else if (changedRanges.length > 200) {
    console.log(`  (${changedRanges.length} ranges — too many to list individually)`)
  }

  const pass = tocDiffs === 0
  console.log(`\nTOC/signature region intact: ${pass ? 'PASS' : 'FAIL'}`)
  if (!pass) {
    console.error('  ERROR: bytes outside declared slot ranges were modified.')
    console.error('  The RSA signature is likely broken.')
    process.exit(1)
  }

  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
