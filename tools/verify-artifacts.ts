/**
 * Structural verification of generated SGA artifacts.
 *
 * Parses generated SGAs and compares their internal path tables against
 * real Workshop/Wikinger reference mods. Emits a PASS/FAIL table.
 *
 * Usage:
 *   WIKINGER_BASE="..." npx tsx tools/verify-artifacts.ts \
 *     --generated-dir out/verification \
 *     --wikinger-base "$WIKINGER_BASE" \
 *     | tee out/verification/report.txt
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { SgaArchive } from '../src/lib/sga'
import { VEHICLES } from '../src/lib/vehicles'
import { OUTPUT_BASENAME, vehicleFolder } from '../src/lib/mod-export'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag)
  if (i >= 0) {
    const val = process.argv[i + 1] ?? ''
    if (val && !val.startsWith('--')) return val
  }
  return fallback ?? ''
}

const GENERATED_DIR = arg('--generated-dir', 'out/verification')
const WIKINGER_BASE = arg('--wikinger-base',
  process.env.WIKINGER_BASE ||
  '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/userdata/209941315/ugc/referenced')

const FACEPLATE_REFS = [
  path.join(WIKINGER_BASE, '833577656980724769/mods/faceplates/HK416V2.sga'),
  path.join(WIKINGER_BASE, '1857182588366894237/mods/faceplates/clarksonfaceplate.sga'),
  path.join(WIKINGER_BASE, '1843676213484654282/mods/faceplates/RamRanch_Faceplate1.sga'),
]

const DECAL_REFS = [
  path.join(WIKINGER_BASE, '787491413366287494/mods/decals/HeinzBeanz.sga'),
  path.join(WIKINGER_BASE, '998016607071565642/mods/decals/Kings Own Yorkshire Light Infantry.sga'),
]

const WIKINGER_SGAS: Record<string, string> = {
  german:      path.join(WIKINGER_BASE, '1669111214256583712/mods/skins/Wikinger Skins.sga'),
  west_german: path.join(WIKINGER_BASE, '1789595341930052156/mods/skins/Wikinger Skins OKW.sga'),
  soviet:      path.join(WIKINGER_BASE, '789756827192794018/mods/skins/Wikinger Soviet Skins.sga'),
  aef:         path.join(WIKINGER_BASE, '1728801381585855727/mods/skins/Wikinger Skins US.sga'),
  british:     path.join(WIKINGER_BASE, '1756940317247941225/mods/skins/Wikinger Skins British.sga'),
  extra:       path.join(WIKINGER_BASE, '1764867756234976550/mods/skins/Wikinger Skins Extra.sga'),
}

// OUTPUT_BASENAME and vehicleFolder are imported from mod-export (single source of truth)
// No local copy here — prevents drift.

// ---------------------------------------------------------------------------
// SGA helpers
// ---------------------------------------------------------------------------

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

async function listSga(sgaPath: string): Promise<string[]> {
  const sga = await SgaArchive.open(nodeFileShim(sgaPath))
  return sga.listPaths()
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

interface VerifyResult {
  artifact: string
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'
  details: string
}

const results: VerifyResult[] = []

function pass(artifact: string, details: string) {
  results.push({ artifact, status: 'PASS', details })
}
function fail(artifact: string, details: string) {
  results.push({ artifact, status: 'FAIL', details })
}
function warn(artifact: string, details: string) {
  results.push({ artifact, status: 'WARN', details })
}
function skip(artifact: string, details: string) {
  results.push({ artifact, status: 'SKIP', details })
}

// ---------------------------------------------------------------------------
// Faceplate verification
// ---------------------------------------------------------------------------

async function verifyFaceplates(): Promise<void> {
  console.log('\n=== Verifying Faceplates ===')

  // First, parse golden references to understand expected schema
  for (const refPath of FACEPLATE_REFS) {
    if (!fs.existsSync(refPath)) {
      console.log(`  REF missing: ${path.basename(refPath)}`)
      continue
    }
    try {
      const paths = await listSga(refPath)
      console.log(`  REF ${path.basename(refPath)}: ${paths.length} files`)
      for (const p of paths.slice(0, 10)) console.log(`    ${p}`)
    } catch (e) {
      console.warn(`  REF error: ${refPath}: ${e}`)
    }
  }

  const faceplatesDir = path.join(GENERATED_DIR, 'faceplates')
  if (!fs.existsSync(faceplatesDir)) {
    for (const f of ['german', 'west_german', 'soviet', 'aef', 'british']) {
      skip(`faceplates/${f}_faceplate.sga`, 'faceplates dir missing')
    }
    return
  }

  const files = fs.readdirSync(faceplatesDir).filter(f => f.endsWith('.sga'))

  for (const faction of ['german', 'west_german', 'soviet', 'aef', 'british']) {
    const fname = `${faction}_faceplate.sga`
    const sgaPath = path.join(faceplatesDir, fname)
    if (!fs.existsSync(sgaPath)) {
      fail(`faceplates/${fname}`, 'file not found')
      continue
    }

    try {
      const paths = await listSga(sgaPath)
      const issues: string[] = []

      // Schema assertions
      const rgdCount = paths.filter(p => /attrib\/faceplate\/.+_faceplate\.rgd$/.test(p)).length
      if (rgdCount !== 1) issues.push(`expected 1 attrib/faceplate/*.rgd, got ${rgdCount}`)

      const ucsCount = paths.filter(p => p === 'english/english.ucs').length
      if (ucsCount !== 1) issues.push(`expected 1 english/english.ucs, got ${ucsCount}`)

      const infoCount = paths.filter(p => /^[0-9a-f]{32}\.info$/.test(p)).length
      if (infoCount !== 1) issues.push(`expected 1 <guid>.info, got ${infoCount}`)

      const ddsCount = paths.filter(p => /ui\/assets\/textures\/[0-9a-f]{32}_i1\.dds$/.test(p)).length
      if (ddsCount !== 1) issues.push(`expected 1 ui/assets/textures/<guid>_i1.dds, got ${ddsCount}`)

      const gfxCount = paths.filter(p => /ui\/bin\/[0-9a-f]{32}\.gfx$/.test(p)).length
      if (gfxCount !== 1) issues.push(`expected 1 ui/bin/<guid>.gfx, got ${gfxCount}`)

      if (issues.length === 0) {
        pass(`faceplates/${fname}`, `${paths.length} files, schema OK`)
      } else {
        fail(`faceplates/${fname}`, issues.join('; '))
      }
    } catch (e) {
      fail(`faceplates/${fname}`, `parse error: ${e}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Decal verification
// ---------------------------------------------------------------------------

async function verifyDecals(): Promise<void> {
  console.log('\n=== Verifying Decals ===')

  // Parse golden references
  for (const refPath of DECAL_REFS) {
    if (!fs.existsSync(refPath)) {
      console.log(`  REF missing: ${path.basename(refPath)}`)
      continue
    }
    try {
      const paths = await listSga(refPath)
      console.log(`  REF ${path.basename(refPath)}: ${paths.length} files`)
      for (const p of paths.slice(0, 20)) console.log(`    ${p}`)
    } catch (e) {
      console.warn(`  REF error: ${refPath}: ${e}`)
    }
  }

  const sgaPath = path.join(GENERATED_DIR, 'decals/decal_pack.sga')
  if (!fs.existsSync(sgaPath)) {
    fail('decals/decal_pack.sga', 'file not found')
    return
  }

  try {
    const paths = await listSga(sgaPath)
    const issues: string[] = []

    // 5 per-faction RGDs — test longer tokens first so 'west_german' doesn't
    // get double-counted by the plain 'german' check (_west_german ends with _german).
    // We match by extracting the exact faction slug: `attrib/vehicle_decal/<slug>_<faction>.rgd`
    const factions = ['german', 'west_german', 'soviet', 'aef', 'british']
    for (const f of factions) {
      // Anchor the faction token: must be immediately preceded by '_' and
      // must be the last path segment before '.rgd', so e.g.
      //   attrib/vehicle_decal/foo_west_german.rgd   matches 'west_german' but NOT 'german'
      //   attrib/vehicle_decal/foo_german.rgd         matches 'german'
      // Strategy: check for exact token by testing that the faction string is not preceded
      // by more faction text — simplest: for 'german' ensure it's not '_west_german'.
      const rgdCount = paths.filter(p => {
        if (!p.startsWith('attrib/vehicle_decal/') || !p.endsWith('.rgd')) return false
        const base = path.basename(p, '.rgd')  // e.g. "foo_west_german" or "foo_german"
        // Extract faction token: everything after the last occurrence of `_${f}` must be empty
        const suffix = `_${f}`
        if (!base.endsWith(suffix)) return false
        // Ensure a longer faction token doesn't match: for 'german', reject '_west_german'
        if (f === 'german' && base.endsWith('_west_german')) return false
        return true
      }).length
      if (rgdCount !== 1) issues.push(`expected 1 attrib/vehicle_decal/*_${f}.rgd, got ${rgdCount}`)
    }

    const ucsCount = paths.filter(p => p === 'english/english.ucs').length
    if (ucsCount !== 1) issues.push(`expected 1 english/english.ucs, got ${ucsCount}`)

    const infoCount = paths.filter(p => /^[0-9a-f]{32}\.info$/.test(p)).length
    if (infoCount !== 1) issues.push(`expected 1 <guid>.info, got ${infoCount}`)

    // Root-level .dds (slug.dds, no folder prefix)
    const rootDdsCount = paths.filter(p => /^[^/]+\.dds$/.test(p)).length
    if (rootDdsCount !== 1) issues.push(`expected 1 root-level <slug>.dds, got ${rootDdsCount}`)

    // 5 per-faction badge RGTs
    for (const f of factions) {
      const rgtCount = paths.filter(p =>
        new RegExp(`art/armies/${f}/badges/[0-9a-f]{32}/default_dif\\.rgt$`).test(p)
      ).length
      if (rgtCount !== 1) issues.push(`expected 1 art/armies/${f}/badges/<guid>/default_dif.rgt, got ${rgtCount}`)
    }

    const iconDdsCount = paths.filter(p => /ui\/assets\/textures\/[0-9a-f]{32}_i1\.dds$/.test(p)).length
    if (iconDdsCount !== 1) issues.push(`expected 1 ui/assets/textures/<guid>_i1.dds, got ${iconDdsCount}`)

    const gfxCount = paths.filter(p => /ui\/bin\/[0-9a-f]{32}\.gfx$/.test(p)).length
    if (gfxCount !== 1) issues.push(`expected 1 ui/bin/<guid>.gfx, got ${gfxCount}`)

    if (issues.length === 0) {
      pass('decals/decal_pack.sga', `${paths.length} files, schema OK`)
    } else {
      fail('decals/decal_pack.sga', issues.join('; '))
    }
  } catch (e) {
    fail('decals/decal_pack.sga', `parse error: ${e}`)
  }
}

// ---------------------------------------------------------------------------
// Vehicle skin verification
// ---------------------------------------------------------------------------

async function verifySkins(): Promise<void> {
  console.log('\n=== Verifying Vehicle Skins ===')

  // Load all Wikinger paths upfront (lazy — TOC only)
  const wikiPaths: Record<string, string[]> = {}
  for (const [key, sgaPath] of Object.entries(WIKINGER_SGAS)) {
    if (fs.existsSync(sgaPath)) {
      try {
        wikiPaths[key] = await listSga(sgaPath)
      } catch (e) {
        console.warn(`  WARN could not list ${key} Wikinger SGA: ${e}`)
        wikiPaths[key] = []
      }
    } else {
      wikiPaths[key] = []
    }
  }

  const skinsDir = path.join(GENERATED_DIR, 'skins')
  if (!fs.existsSync(skinsDir)) {
    for (const f of ['german', 'west_german', 'soviet', 'aef', 'british']) {
      skip(`skins/<id>_${f}.sga`, 'skins dir missing')
    }
    return
  }

  const skinFiles = fs.readdirSync(skinsDir).filter(f => f.endsWith('.sga'))

  for (const faction of ['german', 'west_german', 'soviet', 'aef', 'british'] as const) {
    const sgaFile = skinFiles.find(f => f.endsWith(`_${faction}.sga`))
    if (!sgaFile) {
      fail(`skins/<id>_${faction}.sga`, 'file not found')
      continue
    }

    const sgaPath = path.join(skinsDir, sgaFile)
    try {
      const paths = await listSga(sgaPath)
      const issues: string[] = []
      const vehicleIssues: string[] = []

      const factionVehicles = VEHICLES.filter(v => v.faction === faction)

      // Collect all Wikinger paths for this faction (from primary + extra)
      const allWikiPaths = [...(wikiPaths[faction] ?? []), ...(wikiPaths.extra ?? [])]

      let wikiConfirmed = 0
      let wikiMissing = 0

      for (const vSpec of factionVehicles) {
        const outBase = OUTPUT_BASENAME[vSpec.id] ?? vSpec.id
        const outFolder = vehicleFolder(vSpec.id)

        // Check our SGA has summer + winter RGTs under the REAL folder name
        const ourRgts = paths.filter(p =>
          p.includes(`/vehicles/${outFolder}/skins/`) && p.endsWith(`/${outBase}_dif.rgt`)
        )
        if (ourRgts.length !== 2) {
          vehicleIssues.push(`${vSpec.id}: expected 2 RGTs (summer+winter) in vehicles/${outFolder}/, got ${ourRgts.length}`)
        }

        // Check Wikinger reference — search by real folder name
        const wikiMatch = allWikiPaths.find(p =>
          p.includes(`/vehicles/${outFolder}/`) && p.endsWith('_dif.rgt')
        )
        if (!wikiMatch) {
          wikiMissing++
          // Note but don't fail — DLC vehicles may not be in Wikinger
        } else {
          wikiConfirmed++
          // Check basename equivalence
          const wikiBase = path.basename(wikiMatch, '_dif.rgt')
          if (wikiBase !== outBase) {
            vehicleIssues.push(`${vSpec.id}: basename mismatch — Wikinger has '${wikiBase}', we use '${outBase}'`)
          }
        }
      }

      // Template files assertions
      const attribCount = paths.filter(p =>
        /attrib\/skin_pack\/german\/caf_ss3_(summer|winter)_(heavy|light|medium)\.rgd$/.test(p)
      ).length
      if (attribCount !== 6) issues.push(`expected 6 attrib/skin_pack/german/*.rgd, got ${attribCount}`)

      const ucsCount = paths.filter(p => p === 'english/english.ucs').length
      if (ucsCount !== 1) issues.push(`expected 1 english/english.ucs, got ${ucsCount}`)

      const infoCount = paths.filter(p => /^[0-9a-f]{32}\.info$/.test(p)).length
      if (infoCount !== 1) issues.push(`expected 1 <guid>.info, got ${infoCount}`)

      const gfxCount = paths.filter(p => /ui\/bin\/[0-9a-f]{32}\.gfx$/.test(p)).length
      if (gfxCount !== 1) issues.push(`expected 1 ui/bin/<guid>.gfx, got ${gfxCount}`)

      const iconDdsCount = paths.filter(p => /ui\/assets\/textures\/[0-9a-f]{32}_i1\.dds$/.test(p)).length
      if (iconDdsCount !== 1) issues.push(`expected 1 ui/assets/textures/<guid>_i1.dds, got ${iconDdsCount}`)

      const allIssues = [...issues, ...vehicleIssues]
      const rgtCount = paths.filter(p => p.endsWith('_dif.rgt')).length
      const summary = `${rgtCount} RGTs + ${paths.length - rgtCount} template files; ${wikiConfirmed}/${factionVehicles.length} vehicles Wikinger-confirmed`
        + (wikiMissing > 0 ? `; ${wikiMissing} REFERENCE_MISSING (DLC?)` : '')

      if (allIssues.length === 0) {
        if (wikiMissing > 0) {
          warn(`skins/${sgaFile}`, summary)
        } else {
          pass(`skins/${sgaFile}`, summary)
        }
      } else {
        fail(`skins/${sgaFile}`, summary + ' | ISSUES: ' + allIssues.join('; '))
      }
    } catch (e) {
      fail(`skins/${sgaFile}`, `parse error: ${e}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Report output
// ---------------------------------------------------------------------------

function printReport(): boolean {
  const COL1 = 46
  const COL2 = 7

  const header = 'ARTIFACT'.padEnd(COL1) + 'STATUS'.padEnd(COL2) + 'DETAILS'
  const sep = '─'.repeat(100)

  const lines = [header, sep]
  for (const r of results) {
    lines.push(r.artifact.padEnd(COL1) + r.status.padEnd(COL2) + r.details)
  }
  lines.push(sep)

  const allPassed = results.every(r => r.status === 'PASS' || r.status === 'WARN')
  const anyFailed = results.some(r => r.status === 'FAIL')
  lines.push(anyFailed ? 'OVERALL: FAIL' : 'OVERALL: PASS')

  const report = lines.join('\n')
  console.log('\n' + report)

  // Write to file
  const reportPath = path.join(GENERATED_DIR, 'report.txt')
  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  fs.writeFileSync(reportPath, report + '\n')
  console.log(`\nReport written to: ${reportPath}`)

  return !anyFailed
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Generated dir: ${GENERATED_DIR}`)
  console.log(`Wikinger base: ${WIKINGER_BASE}`)

  // Guard: WIKINGER_BASE must be a non-empty path pointing to an existing directory.
  if (!WIKINGER_BASE || !fs.existsSync(WIKINGER_BASE)) {
    console.error(`ERROR: WIKINGER_BASE ("${WIKINGER_BASE}") does not exist or is empty.`)
    console.error('       Set WIKINGER_BASE to the path containing the Wikinger Workshop mods, e.g.:')
    console.error('       WIKINGER_BASE="~/.local/share/Steam/steamapps/common/Company of Heroes 2/userdata/209941315/ugc/referenced"')
    process.exit(1)
  }

  await verifyFaceplates()
  await verifyDecals()
  await verifySkins()

  const passed = printReport()
  process.exit(passed ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
