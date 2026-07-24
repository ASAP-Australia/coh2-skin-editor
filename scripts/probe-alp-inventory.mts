/**
 * probe-alp-inventory.mts — READ-ONLY. Enumerate the vehicle-texture channel
 * suffixes actually present inside CoH2's Art SGAs. Answers: do `_alp.rgt`
 * files exist at all? What suffixes DO ship next to `_dif.rgt`?
 */
import * as fs from 'node:fs'; import * as path from 'node:path'
import { SgaArchive } from '../src/lib/sga'

const ARCH = '/var/home/jflessenkemper/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => ({ arrayBuffer: async () => {
    const len = (e ?? st.size) - s; const b = Buffer.alloc(Math.max(0, len))
    if (len > 0) fs.readSync(fd, b, 0, len, s)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  } } as Blob)
  return { name: path.basename(fp), size: st.size, slice } as unknown as File
}

const SGAS = fs.readdirSync(ARCH).filter(f => /^Art.*\.sga$/i.test(f))
console.log('SGAs:', SGAS.join(', '))

const suffixTally: Record<string, number> = {}
let totalAlp = 0
const alpExamples: string[] = []
const tigerSiblings: string[] = []

for (const sga of SGAS) {
  const fp = path.join(ARCH, sga)
  let a: SgaArchive
  try { a = await SgaArchive.open(shim(fp)) } catch (e) { console.log(`${sga}: open threw ${String(e)}`); continue }
  const paths = a.listPaths()
  const vehRgts = paths.filter(p => /vehicles\//i.test(p) && /\.rgt$/i.test(p))
  // Tally the _xxx suffix just before .rgt for vehicle textures.
  for (const p of vehRgts) {
    const m = p.match(/_([a-z0-9]+)\.rgt$/i)
    const suf = m ? m[1].toLowerCase() : '(none)'
    suffixTally[suf] = (suffixTally[suf] ?? 0) + 1
    if (suf === 'alp') { totalAlp++; if (alpExamples.length < 25) alpExamples.push(`${sga}: ${p}`) }
  }
  // Collect every sibling of any tiger texture (all suffixes) to show what
  // channels actually ship for a canonical hull.
  for (const p of paths) {
    if (/vehicles\/tiger\/tiger_[a-z0-9]+\.rgt$/i.test(p)) tigerSiblings.push(`${sga}: ${p}`)
  }
  console.log(`${sga}: ${paths.length} files, ${vehRgts.length} vehicle .rgt`)
}

console.log('\n=== Vehicle-texture suffix tally (all SGAs) ===')
for (const [suf, n] of Object.entries(suffixTally).sort((a, b) => b[1] - a[1])) {
  console.log(`  _${suf.padEnd(10)} ${n}`)
}
console.log(`\nTOTAL _alp.rgt vehicle files: ${totalAlp}`)
console.log('\n=== _alp examples (up to 25) ===')
for (const e of alpExamples) console.log('  ' + e)
console.log('\n=== tiger/* .rgt siblings (all suffixes) ===')
for (const e of [...new Set(tigerSiblings)].sort()) console.log('  ' + e)
