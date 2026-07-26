/**
 * Dump the .info manifest (and file list) of the installed ASAP Verify
 * win-condition SGA.
 *
 * WHY: the mod has never appeared in CoH2's Win Condition dropdown across every
 * generation built so far. A raw string scan of the SGA finds only the GUID and
 * no human-readable name, which suggests the .info either declares no UIName or
 * points at a UCS locstring that does not resolve — either of which would make
 * the entry invisible (or blank) in the list. This prints the manifest verbatim
 * so the actual declared name can be read instead of guessed.
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/dump-gamemode-info.mts
 */
import fs from 'fs'
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

const SGA = process.argv[2] ?? '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/gamemode/a5a90ec1f00f4b7e9c0d3a2b1e4f5a60.sga'

const arc = await SgaArchive.open(nodeFileShim(SGA))
const files = arc.list() as { path: string; size?: number }[]
console.log(`=== ${SGA}`)
console.log(`=== ${files.length} members ===`)
for (const f of files) console.log(`  ${String(f.size ?? 0).padStart(7)} B  ${f.path}`)

for (const f of files) {
  const p = f.path.toLowerCase()
  if (!(p.endsWith('.info') || p.endsWith('.win'))) continue
  const data = await arc.readByPath(f.path)
  if (!data) { console.log(`\n--- ${f.path}: UNREADABLE ---`); continue }
  console.log(`\n──────── ${f.path} (${data.byteLength} B) ────────`)
  console.log(Buffer.from(data).toString('utf8'))
}
