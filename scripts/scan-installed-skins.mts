/**
 * Which installed skin SGA paints which vehicles?
 *
 * WHY: Layer C compares an editor render against an in-game capture. The first
 * real run failed because the two sides were not painted the same — the editor
 * renders the VANILLA diffuse while the game has custom skins equipped
 * (16 SGAs in mods/skins/ plus 32 in skins/subscriptions/). To build a valid
 * comparison the editor must render THE SAME skin the game used, so we first
 * have to know which SGA covers which vehicle.
 *
 * Prints, per skin SGA: the faction(s) and vehicle ids it contains, and the
 * diffuse texture members it ships.
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/scan-installed-skins.mts
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

const SKINS = '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins'

const dirs = [SKINS, path.join(SKINS, 'subscriptions')]
type Row = { file: string; where: string; vehicles: Set<string>; factions: Set<string>; difs: string[] }
const rows: Row[] = []

for (const d of dirs) {
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d).sort()) {
    // .disabled* files are inert — the game ignores them
    if (!f.toLowerCase().endsWith('.sga')) continue
    const fp = path.join(d, f)
    let arc
    try { arc = await SgaArchive.open(nodeFileShim(fp)) } catch { continue }
    let files: { path: string }[]
    try { files = arc.list() as { path: string }[] } catch { continue }
    const vehicles = new Set<string>(), factions = new Set<string>(), difs: string[] = []
    for (const m of files) {
      const p = m.path.toLowerCase().replace(/\\/g, '/')
      const mm = p.match(/art\/armies\/([a-z_]+)\/vehicles\/([a-z0-9_]+)\//)
      if (mm) { factions.add(mm[1]); vehicles.add(mm[2]) }
      if (p.includes('_dif')) difs.push(m.path)
    }
    if (vehicles.size) rows.push({ file: f, where: d.endsWith('subscriptions') ? 'subscriptions' : 'skins', vehicles, factions, difs })
  }
}

rows.sort((a, b) => b.vehicles.size - a.vehicles.size)
console.log(`=== ${rows.length} installed skin SGAs that paint vehicles ===\n`)
for (const r of rows) {
  console.log(`${r.file}  [${r.where}]`)
  console.log(`   factions: ${[...r.factions].join(', ')}`)
  console.log(`   vehicles: ${[...r.vehicles].slice(0, 14).join(', ')}${r.vehicles.size > 14 ? ` … (${r.vehicles.size})` : ''}`)
  if (r.difs.length) console.log(`   diffuse : ${r.difs.length} members, e.g. ${r.difs[0]}`)
  console.log()
}

// Which SGAs could have painted the German armour captured in-game?
const german = rows.filter(r => r.factions.has('german'))
console.log(`=== candidates for the captured GERMAN vehicles (${german.length}) ===`)
for (const r of german) console.log(`  ${r.file} [${r.where}] -> ${[...r.vehicles].join(', ')}`)
