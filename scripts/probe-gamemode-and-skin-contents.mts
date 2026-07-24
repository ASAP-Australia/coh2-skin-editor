/**
 * scripts/probe-gamemode-and-skin-contents.mts
 *
 * NON-DESTRUCTIVE. Answers the MECHANISM question:
 *  1. Does a working gamemode/win-condition SGA carry ART data (art\... .rgt)?
 *     -> inspect the 43 MB workshop gamemode 536957797.sga contents.
 *  2. Does a skin SGA override art BY PATH? -> inspect an installed skin SGA's
 *     internal paths (do they include the vanilla base path or only guid-scoped?).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const { SgaArchive } = await import(`${ROOT}/src/lib/sga.ts`)

function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size
    const len = Math.max(0, e - start)
    return { arrayBuffer: async () => { const buf = Buffer.alloc(len); if (len > 0) fs.readSync(fd, buf, 0, len, start); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } } as Blob
  }
  return { name: path.basename(fp), size: stat.size, slice } as unknown as File
}

const MODS = '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods'

async function summarize(fp: string, label: string) {
  if (!fs.existsSync(fp)) { console.log(`\n### ${label}: MISSING ${fp}`); return }
  const a = await SgaArchive.open(nodeFileShim(fp))
  const paths = a.listPaths()
  const exts = new Map<string, number>()
  for (const p of paths) { const m = p.match(/\.[a-z0-9]+$/i); const e = m ? m[0].toLowerCase() : '(none)'; exts.set(e, (exts.get(e) ?? 0) + 1) }
  const arts = paths.filter(p => /\.rgt$/i.test(p))
  const dirs = new Set<string>()
  for (const p of arts) dirs.add(p.split('/').slice(0, -1).join('/'))
  console.log(`\n### ${label}  (${paths.length} files, ${(fs.statSync(fp).size/1024/1024).toFixed(1)} MB)`)
  console.log('  ext tally:', [...exts.entries()].sort((x,y)=>y[1]-x[1]).map(([e,n])=>`${e}:${n}`).join('  '))
  console.log(`  .rgt count: ${arts.length}`)
  // Show up to 12 sample rgt dirs to reveal whether they are guid-scoped or base paths.
  console.log('  sample .rgt dirs (up to 15):')
  for (const d of [...dirs].sort().slice(0, 15)) console.log('    ', d)
  // Does it carry a BASE (no-loadout, no /skins/<guid>/) tiger diffuse?
  const baseTiger = paths.filter(p => /art\/armies\/german\/vehicles\/tiger\/tiger_dif\.rgt$/i.test(p))
  const guidTiger = paths.filter(p => /art\/armies\/german\/vehicles\/tiger\/skins\/[^/]+\/tiger_dif\.rgt$/i.test(p))
  console.log(`  base tiger_dif (override candidate): ${baseTiger.length ? baseTiger.join(', ') : 'none'}`)
  console.log(`  guid-scoped tiger_dif (loadout):     ${guidTiger.length ? guidTiger.slice(0,3).join(', ') + (guidTiger.length>3?` … +${guidTiger.length-3}`:'') : 'none'}`)
  return paths
}

// 1) The 43 MB workshop gamemode — does a win-condition mod ride art data?
await summarize(path.join(MODS, 'gamemode/subscriptions/536957797.sga'), 'GAMEMODE 536957797 (43MB workshop)')

// 2) The big installed skins — are they base-path or guid-scoped overrides?
await summarize(path.join(MODS, 'skins/1781062056355021.sga'), 'SKIN 1781062056355021 (11.5MB, our verified [Sig:0])')
await summarize(path.join(MODS, 'skins/1779088672641532.sga'), 'SKIN 1779088672641532 (152MB workshop)')

console.log('\n[done]')
