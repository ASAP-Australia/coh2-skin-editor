/**
 * Extract one complete scenario folder out of a CoH2 SGA so WorldBuilder can
 * File > Open it. Needed because WorldBuilder's New Scenario path crashes in
 * Offline Mode and zero .sgb files ship loose on disk.
 *
 * A scenario is a FOLDER of files (.sgb + .info + terrain/atlas data), not a
 * single file, so we extract the whole prefix.
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/extract-scenario.mts [substr]
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
const OUT = '/var/home/jflessenkemper/dev/coh2-skin-editor/artifacts/worldbuilder/scenarios'
const WANT = process.argv[2] ?? '2p_angoville_farms'

const a = await SgaArchive.open(nodeFileShim(path.join(ARCH, 'MPScenarios.sga')))
const all = a.list() as { path: string; length?: number; read: () => Promise<Uint8Array> }[]

// Find the folder containing the matching .sgb, then take every sibling file.
const hit = all.find(f => f.path.toLowerCase().endsWith('.sgb') && f.path.includes(WANT))
if (!hit) {
  console.error(`no .sgb matching "${WANT}"`)
  console.error('available (first 20):')
  all.filter(f => f.path.toLowerCase().endsWith('.sgb')).slice(0, 20).forEach(f => console.error('  ' + f.path))
  process.exit(1)
}
const folder = hit.path.slice(0, hit.path.lastIndexOf('/') + 1)
const members = all.filter(f => f.path.startsWith(folder))
console.log(`scenario folder: ${folder}`)
console.log(`members: ${members.length}`)

fs.mkdirSync(OUT, { recursive: true })
let bytes = 0
for (const m of members) {
  const data = await a.readByPath(m.path)
  if (!data) { console.log(`  SKIP (no data) ${m.path}`); continue }
  const dest = path.join(OUT, m.path)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, Buffer.from(data))
  bytes += data.byteLength
  console.log(`  ${data.byteLength.toString().padStart(9)} B  ${m.path}`)
}
console.log(`\nextracted ${members.length} files, ${(bytes / 1e6).toFixed(1)} MB`)
console.log(`open this in WorldBuilder:\n  ${path.join(OUT, hit.path)}`)
