import fs from 'fs'
import path from 'path'
import { SgaArchive } from '../src/lib/sga'
import { parseRgm } from '../src/lib/rgm'
import { decodeRgt } from '../src/lib/rgt'
import { decodeBc1, decodeBc3 } from '../src/lib/bc-decode'
import { VEHICLES, rgmPath } from '../src/lib/vehicles'

function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size
    const len = Math.max(0, e - start)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len > 0) fs.readSync(fd, b, 0, len, start); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: path.basename(fp), size: stat.size, slice } as unknown as File
}

const ARCH = '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
const SGA_NAMES = [
  'ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga',
  'ArtGermanEF.sga', 'ArtSovietEF.sga', 'ArtAEF.sga', 'ArtAEFSkins.sga',
  'ArtBritish.sga', 'ArtWestGerman.sga',
]

const t0open = performance.now()
const archives: { name: string; a: SgaArchive }[] = []
for (const name of SGA_NAMES) {
  const fp = path.join(ARCH, name)
  if (!fs.existsSync(fp)) continue
  archives.push({ name, a: await SgaArchive.open(nodeFileShim(fp)) })
}
console.log(`Opened ${archives.length} SGAs in ${(performance.now() - t0open).toFixed(0)}ms\n`)

const DESTROYED = /destroy(?:ed)?(?![a-z])|wreck|wreak|destruction|burnt|broken|\bdmg\b|_dam_|crushed|orphan|body_chunks|critical|proxy|collision|phys|shadow|remains|crater/i
const isBodyPath = (p: string) =>
  !/\/(treads?|wheels?|tracks?)\//i.test(p) &&
  !/(?:^|[_/])(treads?|wheels?|tracks?)(?:_[a-z0-9]+)*_dif\.rgt$/i.test(p)

async function readAcross(p: string): Promise<Uint8Array | null> {
  for (const { a } of archives) { const b = await a.readByPath(p); if (b) return b }
  return null
}

interface Row { id: string; faction: string; ms: number; parseMs: number; readMs: number; decodeMs: number; px: number; ok: boolean }
const rows: Row[] = []

const tAll = performance.now()
for (const v of VEHICLES) {
  const vt0 = performance.now()
  let parseMs = 0, readMs = 0, decodeMs = 0, px = 0, ok = false
  try {
    // 1. Locate + parse RGM
    const rgmBytes = await readAcross(rgmPath(v))
    if (!rgmBytes) { rows.push({ id: v.id, faction: v.faction, ms: performance.now() - vt0, parseMs, readMs, decodeMs, px, ok: false }); continue }
    const p0 = performance.now()
    const model = parseRgm(rgmBytes)
    parseMs = performance.now() - p0

    // 2. Resolve body diffuse path (mirrors Viewport)
    const id = v.id.toLowerCase()
    const candidates = model.textureSets
      .filter(t => !DESTROYED.test(t) && /_dif$/i.test(t))
      .sort((a, b) => {
        const am = a.toLowerCase().includes(id) ? 0 : 1
        const bm = b.toLowerCase().includes(id) ? 0 : 1
        if (am !== bm) return am - bm
        return a.length - b.length
      })
    const tsetPaths = candidates.map(c => c.replace(/\\/g, '/').toLowerCase() + '.rgt')
    const folder = rgmPath(v).split('/').slice(0, -1).join('/')
    const fallback = [`${folder}/${v.id}_dif.rgt`, `${folder}/${v.id}_hull_dif.rgt`]
    const bodyPaths = [...new Set([...tsetPaths, ...fallback])].filter(isBodyPath)

    // 3. Read + decode body diffuse
    const r0 = performance.now()
    let difBytes: Uint8Array | null = null
    for (const bp of bodyPaths) { difBytes = await readAcross(bp); if (difBytes) break }
    readMs = performance.now() - r0
    if (difBytes) {
      const d0 = performance.now()
      const rgt = decodeRgt(difBytes)
      px = rgt.width * rgt.height
      if (rgt.fourCC === 'DXT1') decodeBc1(rgt.pixels, rgt.width, rgt.height)
      else decodeBc3(rgt.pixels, rgt.width, rgt.height)
      decodeMs = performance.now() - d0
      ok = true
    }
  } catch { /* count as fail */ }
  rows.push({ id: v.id, faction: v.faction, ms: performance.now() - vt0, parseMs, readMs, decodeMs, px, ok })
}
const totalMs = performance.now() - tAll

rows.sort((a, b) => b.ms - a.ms)
console.log('Slowest 12 vehicles (ms total | parse | read | decode | MP | ok):')
for (const r of rows.slice(0, 12)) {
  console.log(`  ${r.ms.toFixed(0).padStart(5)} | ${r.parseMs.toFixed(0).padStart(4)} | ${r.readMs.toFixed(0).padStart(4)} | ${r.decodeMs.toFixed(0).padStart(5)} | ${(r.px/1e6).toFixed(1)}MP | ${r.ok ? 'ok' : 'FAIL'} ${r.id}`)
}
const failed = rows.filter(r => !r.ok)
const sumParse = rows.reduce((s, r) => s + r.parseMs, 0)
const sumRead = rows.reduce((s, r) => s + r.readMs, 0)
const sumDecode = rows.reduce((s, r) => s + r.decodeMs, 0)
console.log(`\n=== TOTALS over ${rows.length} vehicles ===`)
console.log(`  SERIAL wall time:  ${(totalMs/1000).toFixed(1)}s  (${totalMs.toFixed(0)}ms)`)
console.log(`  parse:  ${(sumParse/1000).toFixed(1)}s`)
console.log(`  read:   ${(sumRead/1000).toFixed(1)}s`)
console.log(`  decode: ${(sumDecode/1000).toFixed(1)}s  <-- parallelizable across workers`)
console.log(`  failed/no-diffuse: ${failed.length}${failed.length ? ' (' + failed.map(f => f.id).join(', ') + ')' : ''}`)
const cores = (await import('os')).cpus().length
console.log(`  CPU cores available: ${cores}`)

// Projected PARALLEL wall time, modelling the app's actual Connect warmup:
//   - decode runs on a pool of min(8, cores) workers  -> divide by pool size
//   - read (SGA blob I/O) overlaps across LANES        -> divide by lanes
//   - parse stays serial on the main thread            -> full cost
// This mirrors decode-pool.ts POOL_SIZE + Editor.tsx LANES.
const pool = Math.max(2, Math.min(8, cores))
const lanes = Math.max(2, Math.min(8, cores))
const projDecode = sumDecode / pool
const projRead = sumRead / lanes
const projWall = sumParse + projRead + projDecode
console.log(`\n=== PROJECTED PARALLEL (pool=${pool} workers, lanes=${lanes}) ===`)
console.log(`  parse (serial):   ${(sumParse/1000).toFixed(1)}s`)
console.log(`  read  (/${lanes} lanes): ${(projRead/1000).toFixed(1)}s`)
console.log(`  decode(/${pool} workers): ${(projDecode/1000).toFixed(1)}s`)
console.log(`  projected wall:   ~${(projWall/1000).toFixed(1)}s  (vs ${(totalMs/1000).toFixed(1)}s serial)`)
