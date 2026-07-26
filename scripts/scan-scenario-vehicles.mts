/**
 * Which CoH2 scenarios actually contain PLACED VEHICLE entities?
 *
 * WHY: WorldBuilder can open a scenario and render it with the real engine, but
 * multiplayer maps contain only terrain + scenery — units are spawned at runtime
 * by the game, never stored in the map. So loading an MP map can never show a
 * vehicle. Rather than hunt through the GUI map by map, scan the .sgb payloads
 * for vehicle EBPS path strings and rank scenarios by how many they reference.
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/scan-scenario-vehicles.mts
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

// Archives most likely to hold placed vehicles: single-player/campaign and
// Theatre of War, where wrecks and scripted armour are authored into the map.
const ARCHIVES = ['SPScenariosEF.sga', 'MPXP1Scenarios.sga', 'MPScenarios.sga']

// Vehicle EBPS markers. Broad on purpose — we rank, we don't gate.
const NEEDLES = [
  'vehicles', 'panther', 'panzer', 'tiger', 'stug', 'sherman', 't34', 't_34',
  'halftrack', 'sdkfz', 'churchill', 'cromwell', 'wreck',
]

type Hit = { archive: string; scenario: string; sgbBytes: number; counts: Record<string, number>; total: number }
const hits: Hit[] = []

for (const arc of ARCHIVES) {
  const fp = path.join(ARCH, arc)
  if (!fs.existsSync(fp)) { console.log(`skip ${arc} (missing)`); continue }
  const a = await SgaArchive.open(nodeFileShim(fp))
  const sgbs = (a.list() as { path: string }[]).filter(f => f.path.toLowerCase().endsWith('.sgb'))
  console.log(`${arc}: scanning ${sgbs.length} .sgb …`)

  for (const s of sgbs) {
    const data = await a.readByPath(s.path)
    if (!data) continue
    // .sgb stores blueprint paths as ASCII; latin1 keeps byte==char so indexOf works.
    const text = Buffer.from(data).toString('latin1').toLowerCase()
    const counts: Record<string, number> = {}
    let total = 0
    for (const n of NEEDLES) {
      let c = 0, i = text.indexOf(n)
      while (i !== -1) { c++; i = text.indexOf(n, i + n.length) }
      if (c) { counts[n] = c; total += c }
    }
    if (total > 0) hits.push({ archive: arc, scenario: s.path, sgbBytes: data.byteLength, counts, total })
  }
}

hits.sort((x, y) => y.total - x.total)
console.log(`\n=== scenarios referencing vehicle-ish entities, strongest first ===`)
for (const h of hits.slice(0, 20)) {
  const top = Object.entries(h.counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => `${k}:${v}`).join(' ')
  console.log(`${String(h.total).padStart(5)}  ${(h.sgbBytes / 1e6).toFixed(1).padStart(5)}MB  ${h.scenario}`)
  console.log(`        ${top}`)
}
console.log(`\n${hits.length} scenarios with at least one hit`)
