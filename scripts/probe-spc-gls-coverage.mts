/**
 * probe-spc-gls-coverage.mts — READ-ONLY. Which vehicles actually ship
 * _spc/_gls/_alp RGT files vs only _dif/_nrm? Context for the _alp finding:
 * confirms _alp is uniquely absent (0) while _spc/_gls ship for a subset.
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
const SGAS = ['ArtGermanEF.sga', 'ArtWestGerman.sga', 'ArtSovietEF.sga', 'ArtAEFSkins.sga', 'ArtAEF.sga', 'ArtBritish.sga']
const spcExamples: string[] = []
for (const sga of SGAS) {
  let a: SgaArchive
  try { a = await SgaArchive.open(shim(path.join(ARCH, sga))) } catch { continue }
  const paths = a.listPaths().filter(p => /vehicles\//i.test(p) && /_(spc|gls|alp)\.rgt$/i.test(p))
  for (const p of paths) if (spcExamples.length < 40) spcExamples.push(`${sga}: ${p}`)
}
console.log('=== vehicle _spc/_gls/_alp examples (up to 40) ===')
for (const e of spcExamples) console.log('  ' + e)
// King tiger sibling check
for (const sga of ['ArtWestGerman.sga']) {
  const a = await SgaArchive.open(shim(path.join(ARCH, sga)))
  const kt = a.listPaths().filter(p => /king_tiger_sdkfz_182\/king_tiger_sdkfz_182_[a-z0-9]+\.rgt$/i.test(p)).sort()
  console.log('\n=== king_tiger sibling RGTs ===')
  for (const p of kt) console.log('  ' + p)
}
