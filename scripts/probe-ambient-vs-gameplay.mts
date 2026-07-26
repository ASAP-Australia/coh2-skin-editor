/**
 * Is the WorldBuilder-placeable `panzer_iv_hull` the SAME ASSET as the gameplay
 * Panzer IV that the skin editor paints?
 *
 * WHY THIS GATES EVERYTHING: 8p_tank_factory contains 10 x `panzer_iv_hull`, but
 * its EBPS path is  ebps\environment\art_ambient\objects\vehicles\military\...
 * i.e. an AMBIENT SCENERY PROP. If that prop carries its own baked model and
 * texture rather than the gameplay vehicle's RGM + _dif.rgt, then rendering it
 * in WorldBuilder proves nothing about the skin pipeline and the whole
 * offline-render route is void for Layer C.
 *
 * This lists every archive member matching each candidate and, for any RGM
 * found, pulls the texture path strings out of the binary so the two can be
 * compared directly.
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/probe-ambient-vs-gameplay.mts
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

// Only top-level archives (the install has a duplicated nested tree).
const archives = fs.readdirSync(ARCH).filter(f => f.toLowerCase().endsWith('.sga')).sort()

const AMBIENT = 'art_ambient'
const NEEDLE = 'panzer_iv'

type Row = { archive: string; path: string; size: number }
const ambientHits: Row[] = []
const gameplayHits: Row[] = []

for (const a of archives) {
  let arc
  try { arc = await SgaArchive.open(nodeFileShim(path.join(ARCH, a))) } catch { continue }
  let files: { path: string; size?: number }[]
  try { files = arc.list() as { path: string; size?: number }[] } catch { continue }
  for (const f of files) {
    const p = f.path.toLowerCase()
    if (!p.includes(NEEDLE)) continue
    const row = { archive: a, path: f.path, size: f.size ?? 0 }
    if (p.includes(AMBIENT) || p.includes('environment')) ambientHits.push(row)
    else gameplayHits.push(row)
  }
}

const show = (title: string, rows: Row[]) => {
  console.log(`\n=== ${title} (${rows.length}) ===`)
  for (const r of rows.slice(0, 40)) {
    console.log(`  ${(r.size / 1024).toFixed(0).padStart(7)} KB  [${r.archive}]  ${r.path}`)
  }
  if (rows.length > 40) console.log(`  … ${rows.length - 40} more`)
}

show('AMBIENT / environment panzer_iv assets (the WorldBuilder prop)', ambientHits)
show('GAMEPLAY panzer_iv assets (what the skin editor paints)', gameplayHits)

// Pull texture path strings out of any ambient RGM so we can see what it samples.
const rgms = ambientHits.filter(r => r.path.toLowerCase().endsWith('.rgm'))
console.log(`\n=== texture references inside ambient RGMs (${rgms.length} models) ===`)
for (const r of rgms.slice(0, 6)) {
  const arc = await SgaArchive.open(nodeFileShim(path.join(ARCH, r.archive)))
  const data = await arc.readByPath(r.path)
  if (!data) { console.log(`  ${r.path}: unreadable`); continue }
  const txt = Buffer.from(data).toString('latin1')
  const refs = [...new Set(txt.match(/[A-Za-z0-9_\\/.-]*(?:rgt|dds|_dif|_spc|_nrm)[A-Za-z0-9_\\/.-]*/g) || [])]
    .filter(s => s.length > 8).slice(0, 12)
  console.log(`\n  ${r.path}`)
  for (const t of refs) console.log(`      -> ${t}`)
  if (!refs.length) console.log('      (no texture strings found)')
}
