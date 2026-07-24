/**
 * Headless submesh-inventory dump for the camo-classification audit.
 *
 * For EVERY vehicle in src/lib/vehicles.ts VEHICLES, this:
 *   1. Opens the faction's candidate SGAs (lazy, like tools/test-export.ts) from
 *      the real CoH2 install and reads the vehicle's .rgm bytes (rgmPath()).
 *   2. Decodes the RGM via src/lib/rgm.ts parseRgm().
 *   3. Records, per submesh: name, materialName, triCount, position bbox
 *      (min/max XYZ from geometry.attributes.position) and UV0 bbox
 *      (u0,v0,u1,v1 from geometry.attributes.uv).
 *   4. Tags each vehicle's structure: 'mrgm-v8' if ANY submesh carries a real
 *      materialName (MRGM v8 merged), else 'trim-v5' (per-part, empty material).
 *      This mirrors src/lib/camo-mask.ts's classification.
 *
 * Writes:
 *   artifacts/camo-map/submesh-inventory.json   (full inventory)
 *   artifacts/camo-map/submesh-inventory.md      (short summary)
 *
 * NO dev server, NO game. Pure Node decode against archives on disk.
 *
 * Usage (from repo root — tsx rejects /tmp scripts):
 *   COH2_INSTALL="/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2" \
 *     npx tsx artifacts/camo-map/dump-submesh-inventory.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Node DOM shims (same as tools/test-export.ts) so the browser libs import ──
;(global as any).ImageData = NodeImageData as any
;(global as any).HTMLCanvasElement = class {} as any
;(global as any).Image = Image as any
;(global as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return createCanvas(1, 1) as unknown as HTMLCanvasElement
    if (tag === 'a') return { click() {}, href: '', download: '' }
    throw new Error(`document.createElement(${tag}) not supported in Node shim`)
  },
}
;(global as any).URL = URL

// Lib imports AFTER shims are installed.
import { SgaArchive } from '../../src/lib/sga'
import { parseRgm } from '../../src/lib/rgm'
import { VEHICLES, rgmPath, type Faction, type VehicleSpec } from '../../src/lib/vehicles'
import type * as THREE from 'three'

// ── Config ──────────────────────────────────────────────────────────────────
const INSTALL =
  process.env.COH2_INSTALL ||
  '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const ARCHIVES_DIR = path.join(INSTALL, 'CoH2', 'Archives')
const OUT_JSON = path.join(__dirname, 'submesh-inventory.json')
const OUT_MD = path.join(__dirname, 'submesh-inventory.md')

/** Per-faction candidate SGAs — mirrors FACTION_SGAS in src/lib/preload.ts. */
const FACTION_SGAS: Record<Faction, string[]> = {
  german: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtGermanEF.sga'],
  west_german: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtWestGerman.sga'],
  soviet: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtSovietEF.sga'],
  aef: [
    'ArtHigh.sga',
    'ArtHighXP1.sga',
    'ArtHighXP2.sga',
    'ArtArmies.sga',
    'ArtAEF.sga',
    'ArtAEFSkins.sga',
  ],
  british: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga', 'ArtBritish.sga'],
}

// ── Lazy Node File shim for multi-GB SGAs (same as tools/test-export.ts) ──────
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

const archiveCache = new Map<string, SgaArchive | null>()
async function openArchive(name: string): Promise<SgaArchive | null> {
  if (archiveCache.has(name)) return archiveCache.get(name)!
  const fp = path.join(ARCHIVES_DIR, name)
  if (!fs.existsSync(fp)) {
    archiveCache.set(name, null)
    return null
  }
  const a = await SgaArchive.open(nodeFileShim(fp))
  archiveCache.set(name, a)
  return a
}

/** Read a vehicle's .rgm bytes by trying each candidate SGA in order. */
async function readRgmBytes(v: VehicleSpec): Promise<{ bytes: Uint8Array; sga: string } | null> {
  const rp = rgmPath(v)
  for (const sgaName of FACTION_SGAS[v.faction]) {
    const a = await openArchive(sgaName)
    if (!a) continue
    const b = await a.readByPath(rp)
    if (b) return { bytes: b, sga: sgaName }
  }
  return null
}

// ── Geometry stats ────────────────────────────────────────────────────────────
type Vec3 = [number, number, number]
type Uv4 = [number, number, number, number]

interface SubmeshRecord {
  name: string
  materialName: string | null
  triCount: number
  bboxMin: Vec3
  bboxMax: Vec3
  /** [u0, v0, u1, v1] — min/max of the diffuse UV0 (geometry 'uv' attribute). */
  uv0Bbox: Uv4
}

function round(n: number, dp = 4): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

function submeshStats(geo: THREE.BufferGeometry): {
  triCount: number
  bboxMin: Vec3
  bboxMax: Vec3
  uv0Bbox: Uv4
} {
  const index = geo.getIndex()
  const posAttr = geo.getAttribute('position')
  const triCount = index ? Math.floor(index.count / 3) : Math.floor((posAttr?.count ?? 0) / 3)

  // Position bbox — prefer geometry.boundingBox (computed in buildGeometry),
  // else scan positions directly.
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const bb = geo.boundingBox
  if (bb) {
    minX = bb.min.x; minY = bb.min.y; minZ = bb.min.z
    maxX = bb.max.x; maxY = bb.max.y; maxZ = bb.max.z
  } else if (posAttr) {
    const p = posAttr.array as ArrayLike<number>
    for (let i = 0; i < posAttr.count; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
  }

  // UV0 bbox from the 'uv' attribute (diffuse channel 0).
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity
  const uvAttr = geo.getAttribute('uv')
  if (uvAttr) {
    const uv = uvAttr.array as ArrayLike<number>
    for (let i = 0; i < uvAttr.count; i++) {
      const u = uv[i * 2], v = uv[i * 2 + 1]
      if (u < u0) u0 = u; if (u > u1) u1 = u
      if (v < v0) v0 = v; if (v > v1) v1 = v
    }
  }
  const finite = (n: number) => (Number.isFinite(n) ? n : 0)

  return {
    triCount,
    bboxMin: [round(finite(minX), 3), round(finite(minY), 3), round(finite(minZ), 3)],
    bboxMax: [round(finite(maxX), 3), round(finite(maxY), 3), round(finite(maxZ), 3)],
    uv0Bbox: [round(finite(u0)), round(finite(v0)), round(finite(u1)), round(finite(v1))],
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
interface VehicleEntry {
  faction: Faction
  displayName: string
  sga: string
  structure: 'trim-v5' | 'mrgm-v8'
  submeshCount: number
  submeshes: SubmeshRecord[]
}

async function main() {
  if (!fs.existsSync(ARCHIVES_DIR)) {
    console.error(`FATAL: archives dir not found: ${ARCHIVES_DIR}`)
    process.exit(1)
  }
  console.log(`install:  ${INSTALL}`)
  console.log(`archives: ${ARCHIVES_DIR}`)
  console.log(`vehicles: ${VEHICLES.length}`)
  console.log()

  const vehicles: Record<string, VehicleEntry> = {}
  const failures: { id: string; faction: Faction; reason: string }[] = []
  let totalSubmeshes = 0
  let trimCount = 0
  let mrgmCount = 0

  for (const v of VEHICLES) {
    // Some ids repeat across factions (e.g. 'halftrack' german+soviet). Key the
    // output by "<id>" but disambiguate collisions with a "<id>@<faction>" key.
    let key = v.id
    if (vehicles[key]) key = `${v.id}@${v.faction}`

    let read: { bytes: Uint8Array; sga: string } | null = null
    try {
      read = await readRgmBytes(v)
    } catch (err) {
      failures.push({ id: v.id, faction: v.faction, reason: `read error: ${(err as Error).message}` })
      console.log(`  ✗ ${v.id.padEnd(30)} ${v.faction.padEnd(12)} READ ERROR: ${(err as Error).message}`)
      continue
    }
    if (!read) {
      failures.push({
        id: v.id,
        faction: v.faction,
        reason: `rgm not found in candidates [${FACTION_SGAS[v.faction].join(', ')}] at ${rgmPath(v)}`,
      })
      console.log(`  ✗ ${v.id.padEnd(30)} ${v.faction.padEnd(12)} NOT FOUND (${rgmPath(v)})`)
      continue
    }

    let model
    try {
      model = parseRgm(read.bytes)
    } catch (err) {
      failures.push({ id: v.id, faction: v.faction, reason: `parseRgm threw: ${(err as Error).message}` })
      console.log(`  ✗ ${v.id.padEnd(30)} ${v.faction.padEnd(12)} DECODE ERROR: ${(err as Error).message}`)
      continue
    }

    if (!model.meshes.length) {
      failures.push({ id: v.id, faction: v.faction, reason: `decoded but 0 submeshes (from ${read.sga})` })
      console.log(`  ✗ ${v.id.padEnd(30)} ${v.faction.padEnd(12)} 0 SUBMESHES (${read.sga})`)
      continue
    }

    const submeshes: SubmeshRecord[] = model.meshes.map(m => {
      const s = submeshStats(m.geometry)
      return {
        name: m.name,
        materialName: m.materialName,
        triCount: s.triCount,
        bboxMin: s.bboxMin,
        bboxMax: s.bboxMax,
        uv0Bbox: s.uv0Bbox,
      }
    })

    // Structure: MRGM v8 carries real materialNames on submeshes; TRIM v5 does not.
    const structure: 'trim-v5' | 'mrgm-v8' = submeshes.some(s => s.materialName != null)
      ? 'mrgm-v8'
      : 'trim-v5'
    if (structure === 'mrgm-v8') mrgmCount++
    else trimCount++
    totalSubmeshes += submeshes.length

    vehicles[key] = {
      faction: v.faction,
      displayName: v.displayName,
      sga: read.sga,
      structure,
      submeshCount: submeshes.length,
      submeshes,
    }
    console.log(
      `  ✓ ${v.id.padEnd(30)} ${v.faction.padEnd(12)} ${structure.padEnd(8)} ${String(submeshes.length).padStart(3)} submeshes  (${read.sga})`,
    )
  }

  const dumpedCount = Object.keys(vehicles).length
  const generated = new Date().toISOString()

  const outObj = { generated, vehicles }
  fs.writeFileSync(OUT_JSON, JSON.stringify(outObj, null, 2))

  const md = [
    '# Submesh Inventory — Camo Classification Audit',
    '',
    `Generated: ${generated}`,
    '',
    `- Registry vehicles: **${VEHICLES.length}**`,
    `- Vehicles dumped:   **${dumpedCount}**`,
    `- Failures:          **${failures.length}**`,
    `- Total submeshes:   **${totalSubmeshes}**`,
    '',
    '## Structure split',
    '',
    `- trim-v5: **${trimCount}**`,
    `- mrgm-v8: **${mrgmCount}**`,
    '',
    '## Failures',
    '',
    failures.length
      ? failures.map(f => `- \`${f.id}\` (${f.faction}): ${f.reason}`).join('\n')
      : '_none — all registry vehicles decoded_',
    '',
    `JSON: \`${OUT_JSON}\``,
    '',
  ].join('\n')
  fs.writeFileSync(OUT_MD, md)

  console.log()
  console.log('─'.repeat(72))
  console.log(`Dumped ${dumpedCount}/${VEHICLES.length} vehicles, ${totalSubmeshes} submeshes total`)
  console.log(`Structure: trim-v5=${trimCount}  mrgm-v8=${mrgmCount}`)
  if (failures.length) {
    console.log(`FAILURES (${failures.length}):`)
    for (const f of failures) console.log(`  - ${f.id} (${f.faction}): ${f.reason}`)
  } else {
    console.log('No failures — every registry vehicle decoded.')
  }
  console.log(`JSON: ${OUT_JSON}`)
  console.log(`MD:   ${OUT_MD}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
