/**
 * probe-alp-anywhere.mts — READ-ONLY. Does ANY `_alp.rgt` exist anywhere in the
 * CoH2 Art SGAs (not just under vehicles/)? And does the tiger RGM *declare* a
 * `tiger_alp` TSET string even though no file ships? Confirms the "declared but
 * not packed" hypothesis.
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

let anyAlp = 0
const alpAll: string[] = []
for (const sga of SGAS) {
  let a: SgaArchive
  try { a = await SgaArchive.open(shim(path.join(ARCH, sga))) } catch { continue }
  for (const p of a.listPaths()) {
    if (/_alp\.rgt$/i.test(p)) { anyAlp++; if (alpAll.length < 40) alpAll.push(`${sga}: ${p}`) }
  }
}
console.log(`=== ANY *_alp.rgt anywhere in Art SGAs: ${anyAlp} ===`)
for (const e of alpAll) console.log('  ' + e)

// Now dig the tiger RGM for TSET path strings — does it *name* tiger_alp?
console.log('\n=== tiger.rgm TSET string scan ===')
for (const sga of ['ArtGermanEF.sga', 'ArtArmies.sga', 'ArtHigh.sga']) {
  let a: SgaArchive
  try { a = await SgaArchive.open(shim(path.join(ARCH, sga))) } catch { continue }
  const rgm = a.listPaths().find(p => /vehicles\/tiger\/tiger\.rgm$/i.test(p) || /tiger\/tiger\.rgm$/i.test(p))
  if (!rgm) { console.log(`  ${sga}: no tiger.rgm`); continue }
  const bytes = await a.readByPath(rgm)
  if (!bytes) { console.log(`  ${sga}: tiger.rgm readByPath null`); continue }
  // Scan the raw bytes for ASCII references to tiger_<suffix> texture-set names.
  const ascii = Buffer.from(bytes).toString('latin1')
  const found = new Set<string>()
  const re = /[a-z0-9\\/_]*tiger_[a-z0-9]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(ascii))) {
    const s = m[0]
    if (/_(dif|alp|nrm|spc|gls|tem|occ|drt)$/i.test(s)) found.add(s)
  }
  console.log(`  ${sga}: ${rgm}`)
  console.log(`     TSET-ish strings: ${[...found].sort().join('  |  ') || '(none matched)'}`)
  // Also whether the literal substring "_alp" appears at all in the RGM bytes.
  console.log(`     contains "_alp" substring: ${/_alp/i.test(ascii)}`)
  break
}
