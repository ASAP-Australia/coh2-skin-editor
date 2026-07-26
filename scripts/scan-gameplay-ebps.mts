/**
 * Do any CoH2 scenarios place GAMEPLAY vehicles (ebps/races/...), or only
 * ambient scenery props (ebps/environment/art_ambient/...)?
 *
 * This decides whether WorldBuilder can ever be used to verify the skin
 * pipeline. Scenery armour is bespoke "parked_vehicles" art that shares no
 * texture with the gameplay vehicle (see probe-ambient-vs-gameplay.mts), so
 * only a races/ entity would be a valid Layer C subject.
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/scan-gameplay-ebps.mts
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
const ARCHIVES = ['SPScenariosEF.sga', 'MPScenarios.sga', 'MPXP1Scenarios.sga']

type Hit = { scenario: string; races: string[]; ambient: number }
const hits: Hit[] = []

for (const a of ARCHIVES) {
  const fp = path.join(ARCH, a)
  if (!fs.existsSync(fp)) continue
  const arc = await SgaArchive.open(nodeFileShim(fp))
  const sgbs = (arc.list() as { path: string }[]).filter(f => f.path.toLowerCase().endsWith('.sgb'))
  console.log(`${a}: ${sgbs.length} scenarios`)
  for (const s of sgbs) {
    const data = await arc.readByPath(s.path)
    if (!data) continue
    const txt = Buffer.from(data).toString('latin1').toLowerCase()

    // Gameplay entity blueprint paths look like: ebps\races\<race>\vehicles\<unit>
    const races = [...new Set(txt.match(/ebps[\\/]races[\\/][a-z_]+[\\/]vehicles[\\/][a-z0-9_]+/g) || [])]
    let ambient = 0, i = txt.indexOf('art_ambient')
    while (i !== -1) { ambient++; i = txt.indexOf('art_ambient', i + 11) }
    if (races.length) hits.push({ scenario: s.path, races, ambient })
  }
}

hits.sort((x, y) => y.races.length - x.races.length)
console.log(`\n=== scenarios placing GAMEPLAY vehicles (ebps/races/*/vehicles/*) ===`)
if (!hits.length) {
  console.log('  NONE. No scenario places a gameplay vehicle entity.')
  console.log('  => WorldBuilder can only ever show ambient scenery armour,')
  console.log('     which is the wrong asset for skin verification.')
} else {
  for (const h of hits.slice(0, 15)) {
    console.log(`\n  ${h.scenario}  (${h.races.length} distinct, art_ambient refs: ${h.ambient})`)
    for (const r of h.races.slice(0, 10)) console.log(`      ${r}`)
  }
}
console.log(`\n${hits.length} scenarios with gameplay vehicle entities`)
