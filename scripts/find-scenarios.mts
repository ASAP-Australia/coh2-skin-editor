/**
 * Locate .sgb scenario files inside CoH2's SGA archives.
 *
 * WHY: WorldBuilder's "New Scenario / Blank Terrain" path crashes deterministically
 * in Offline Mode, and "Use Template" is disabled. File > Open is the remaining
 * route, but ZERO .sgb files exist loose on disk — every stock scenario is packed
 * inside an SGA. This finds one small enough to extract and open.
 */
import fs from 'fs'
import path from 'path'
import { SgaArchive } from '../src/lib/sga'

function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size; const len = Math.max(0, e - start)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len > 0) fs.readSync(fd, b, 0, len, start); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: fp, size: stat.size, slice } as unknown as File
}

const ARCH = '/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'

// Scenario-bearing archives, smallest first so we fail fast on cheap ones.
const CANDIDATES = fs.readdirSync(ARCH)
  .filter(f => /scenario|mission|sp|mp/i.test(f) && f.toLowerCase().endsWith('.sga'))
  .map(f => ({ f, size: fs.statSync(path.join(ARCH, f)).size }))
  .sort((a, b) => a.size - b.size)

console.log(`scanning ${CANDIDATES.length} candidate archives\n`)

let totalSgb = 0
for (const { f, size } of CANDIDATES) {
  const fp = path.join(ARCH, f)
  let a
  try {
    a = await SgaArchive.open(nodeFileShim(fp))
  } catch (e) {
    console.log(`${f} (${(size / 1e6).toFixed(0)} MB) — OPEN FAILED: ${e}`)
    continue
  }
  const all = a.list() as { path: string; size?: number }[]
  const sgb = all.filter(x => x.path.toLowerCase().endsWith('.sgb'))
  totalSgb += sgb.length
  console.log(`${f} (${(size / 1e6).toFixed(0)} MB): ${all.length} entries, ${sgb.length} .sgb`)
  for (const s of sgb.slice(0, 8)) {
    console.log(`    ${s.path}${s.size != null ? `  (${s.size} B)` : ''}`)
  }
  if (sgb.length > 8) console.log(`    … ${sgb.length - 8} more`)
}
console.log(`\nTOTAL .sgb found: ${totalSgb}`)
