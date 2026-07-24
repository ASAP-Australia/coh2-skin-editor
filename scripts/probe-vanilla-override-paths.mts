/**
 * scripts/probe-vanilla-override-paths.mts
 *
 * NON-DESTRUCTIVE probe. Finds the EXACT vanilla default art paths we must
 * override for a GLOBAL (no-loadout) camo + national-insignia override:
 *   (a) the Tiger's DEFAULT skin diffuse RGT path (no GUID / no _summer loadout),
 *   (b) the German DEFAULT national-insignia badge atlas RGT path (no-GUID default).
 *
 * Reads the REAL CoH2 archives with the repo's own SgaArchive reader (Node File
 * shim). Prints verbatim internal paths + RGT dims/format. Never guesses.
 *
 * Run: npx tsx scripts/probe-vanilla-override-paths.mts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'

// canvas/DOM shims (mirror tools/test-export.ts) so decodeRgt/bcToCanvas work.
;(global as any).ImageData = NodeImageData as any
;(global as any).HTMLCanvasElement = class {} as any
;(global as any).Image = Image as any
;(global as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return createCanvas(1, 1) as unknown as HTMLCanvasElement
    throw new Error(`createElement(${tag}) unsupported`)
  },
}
;(global as any).URL = URL

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const { SgaArchive } = await import(`${ROOT}/src/lib/sga.ts`)
const { decodeRgt } = await import(`${ROOT}/src/lib/rgt.ts`)

const INSTALL = process.env.COH2_INSTALL
  || '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES = path.join(INSTALL, 'CoH2/Archives')

function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size
    const len = Math.max(0, e - start)
    return {
      arrayBuffer: async () => {
        const buf = Buffer.alloc(len)
        if (len > 0) fs.readSync(fd, buf, 0, len, start)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      },
    } as Blob
  }
  return { name: path.basename(fp), size: stat.size, slice } as unknown as File
}

// Which archives to scan for each concern.
const ART_SGAS = [
  'ArtGermanEF.sga', 'ArtArmies.sga', 'ArtHigh.sga', 'ArtWestGerman.sga',
  'ArtAEF.sga', 'ArtSovietEF.sga', 'ArtBritish.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga',
]

// ── Scan every art SGA, collect matching internal paths ─────────────────────
async function scan(pred: (p: string) => boolean, sgas: string[] = ART_SGAS): Promise<Map<string, string[]>> {
  const hits = new Map<string, string[]>() // sga -> matching paths
  for (const name of sgas) {
    const fp = path.join(ARCHIVES, name)
    if (!fs.existsSync(fp)) continue
    const a = await SgaArchive.open(nodeFileShim(fp))
    const matched = a.listPaths().filter(pred)
    if (matched.length) hits.set(name, matched.sort())
  }
  return hits
}

async function decodeAt(sga: string, internalPath: string) {
  const fp = path.join(ARCHIVES, sga)
  const a = await SgaArchive.open(nodeFileShim(fp))
  const bytes = await a.readByPath(internalPath)
  if (!bytes) return null
  const rgt = decodeRgt(bytes)
  return { bytes: bytes.length, width: rgt.width, height: rgt.height, fourCC: rgt.fourCC }
}

console.log('=== (2a) Tiger DEFAULT diffuse — vanilla no-loadout path ===')
// The camo skin READS the vanilla via art/armies/german/vehicles/tiger/tiger_dif.rgt.
// Confirm the exact on-disk path(s) for the Tiger hull diffuse. Also enumerate any
// tiger _dif variants so we can see the default (no skins/<guid>_summer subdir) one.
{
  const tigerDif = await scan(p =>
    /(?:^|\/)art\/armies\/german\/vehicles\/tiger\//i.test(p) && /_dif\.rgt$/i.test(p))
  for (const [sga, paths] of tigerDif) {
    console.log(`\n[${sga}]`)
    for (const p of paths) console.log('   ', p)
  }
  // The DEFAULT (no-loadout) diffuse is the one NOT under a skins/<guid>_season subdir.
  let defaultPath: string | null = null, defaultSga: string | null = null
  for (const [sga, paths] of tigerDif) {
    for (const p of paths) {
      if (!/\/skins\//i.test(p)) { defaultPath = p; defaultSga = sga; break }
    }
    if (defaultPath) break
  }
  console.log(`\n  >>> DEFAULT (no-loadout) Tiger diffuse: ${defaultPath ?? 'NOT FOUND'}  [${defaultSga}]`)
  if (defaultPath && defaultSga) {
    const d = await decodeAt(defaultSga, defaultPath)
    console.log('  >>> decode:', JSON.stringify(d))
  }
}

console.log('\n\n=== (2b) German DEFAULT national-insignia badge atlas — no-GUID default ===')
// Contrast with the GUID-scoped decal path art\armies\<faction>\badges\<guid>\default_dif.rgt
// (decal-mod-build.ts:236). The VANILLA default is the no-GUID one:
//   art\armies\german\badges\default_dif.rgt  (or default_dif with no <guid> subdir).
{
  const badge = await scan(p =>
    /(?:^|\/)art\/armies\/german\/badges\//i.test(p) && /\.rgt$/i.test(p))
  for (const [sga, paths] of badge) {
    console.log(`\n[${sga}]`)
    for (const p of paths) console.log('   ', p)
  }
  // Default = no-GUID: art/armies/german/badges/default_dif.rgt (badges/<file>, no extra subdir).
  let defPath: string | null = null, defSga: string | null = null
  for (const [sga, paths] of badge) {
    for (const p of paths) {
      const rel = p.replace(/^.*art\/armies\/german\/badges\//i, '')
      // no-GUID default = exactly "default_dif.rgt" (no <guid>/ prefix)
      if (/^default_dif\.rgt$/i.test(rel)) { defPath = p; defSga = sga; break }
    }
    if (defPath) break
  }
  console.log(`\n  >>> DEFAULT (no-GUID) German badge atlas: ${defPath ?? 'NOT FOUND'}  [${defSga}]`)
  if (defPath && defSga) {
    const d = await decodeAt(defSga, defPath)
    console.log('  >>> decode:', JSON.stringify(d))
  }
  // Also show ALL factions' default badge path for completeness.
  const allBadges = await scan(p => /(?:^|\/)art\/armies\/[a-z_]+\/badges\/default_dif\.rgt$/i.test(p))
  console.log('\n  All-faction no-GUID default badge atlases:')
  for (const [sga, paths] of allBadges) for (const p of paths) console.log(`    [${sga}] ${p}`)
}

console.log('\n[done] probe complete.')
