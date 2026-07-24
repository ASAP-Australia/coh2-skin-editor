/**
 * diagnose-faceplate-sga.mts — Phase 1 diagnostic for N5 faceplate SGA failure
 *
 * Usage:
 *   npx tsx scripts/diagnose-faceplate-sga.mts
 *
 * Dumps the file trees of:
 *   (a) The failing evidence artifact: /tmp/coh2-evidence/a-sweep/respec-faceplate.sga
 *   (b) A known-good Workshop faceplate from the subscriptions folder
 *   (c) A freshly built pack from buildFaceplateMod with a synthetic 692×204 atlas
 *
 * Then diffs (b) vs (c) to identify missing files and drive assignment errors.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve repo root relative to this script
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, '..')

// Dynamically import from the built TS modules via tsx path aliases
// tsx runs in the repo root so tsconfig paths resolve
const { SgaArchive } = await import('../src/lib/sga.ts')
const { buildFaceplateMod, generateGuid, wrapBc3InDds } = await import('../src/lib/faceplate-mod-build.ts')
const { ATLAS_WIDTH, ATLAS_HEIGHT } = await import('../src/lib/faceplate-templates.ts')

// Evidence output dir
const EVIDENCE_DIR = '/tmp/coh2-evidence/p1'
mkdirSync(EVIDENCE_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Helper: open SGA from file path and dump its tree
// ---------------------------------------------------------------------------
async function dumpSga(sgaPath: string, label: string): Promise<Array<{path: string; size: number}>> {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`TREE: ${label}`)
  console.log(`File: ${sgaPath}`)
  console.log('='.repeat(70))

  let bytes: Buffer
  try {
    bytes = readFileSync(sgaPath)
  } catch (e) {
    console.log(`  ERROR: cannot read file — ${e}`)
    return []
  }
  console.log(`  Size on disk: ${bytes.length.toLocaleString()} bytes`)

  // Build a File-like Blob for SgaArchive.open
  const blob = new Blob([bytes])
  let archive: Awaited<ReturnType<typeof SgaArchive.open>>
  try {
    archive = await SgaArchive.open(blob as unknown as File)
  } catch (e) {
    console.log(`  ERROR: SgaArchive.open failed — ${e}`)
    return []
  }

  const files = archive.list()
  const entries = files.map(f => ({ path: f.path, size: f.length }))

  if (entries.length === 0) {
    console.log('  (no files in archive)')
  } else {
    for (const e of entries) {
      console.log(`  [${e.size.toString().padStart(10)} B]  ${e.path}`)
    }
    console.log(`  TOTAL: ${entries.length} file(s)`)
  }

  return entries
}

// ---------------------------------------------------------------------------
// (a) The failing evidence artifact
// ---------------------------------------------------------------------------
const ARTIFACT_PATH = '/tmp/coh2-evidence/a-sweep/respec-faceplate.sga'
const artifactTree = await dumpSga(ARTIFACT_PATH, '(a) Evidence artifact — KNOWN FAILING')

// ---------------------------------------------------------------------------
// (b) Known-good Workshop faceplate
// ---------------------------------------------------------------------------
const WORKSHOP_PATH = '/home/jflessenkemper/.steam/steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/faceplates/subscriptions/1394135665.sga'
const workshopTree = await dumpSga(WORKSHOP_PATH, '(b) Known-good Workshop faceplate (1394135665.sga)')

// ---------------------------------------------------------------------------
// (c) Fresh buildFaceplateMod output with synthetic 692×204 atlas
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`)
console.log('TREE: (c) Fresh buildFaceplateMod output — SYNTHETIC ATLAS')
console.log('='.repeat(70))

// Synthesise atlas (same pattern as end-to-end test lines 327-356)
const atlas = new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4)
for (let y = 0; y < ATLAS_HEIGHT; y++) {
  for (let x = 0; x < ATLAS_WIDTH; x++) {
    const i = (y * ATLAS_WIDTH + x) * 4
    if (x < 600 && y < 170) {
      const t = x / 600
      atlas[i] = 0xff
      atlas[i + 1] = Math.floor(0x40 + 0xa0 * t)
      atlas[i + 2] = Math.floor(0x20 + 0x40 * (y / 170))
      atlas[i + 3] = 255
    } else if (x >= 600 && x < 692 && y < 92) {
      atlas[i] = 0
      atlas[i + 1] = 200
      atlas[i + 2] = 220
      atlas[i + 3] = 255
    } else {
      atlas[i] = 0; atlas[i + 1] = 0; atlas[i + 2] = 0; atlas[i + 3] = 255
    }
  }
}

const fakeProject = {
  packName: 'Phase1 Test Faceplate',
  packDescription: 'Diagnostic pack for N5 Phase 1 verification',
  author: 'diagnose-faceplate-sga',
  // minimal fields that buildFaceplateMod needs via the project type
} as import('../src/lib/faceplate-project.ts').Coh2FaceplateProject

const pinGuid = 'aabbccdd11223344aabbccdd11223344'
const result = await buildFaceplateMod({ project: fakeProject, atlasRgba: atlas, guid: pinGuid })
console.log(`  Built SGA size: ${result.sga.length.toLocaleString()} bytes, guid=${result.guid}`)

// Write to evidence dir so the harness can install it
const trueSgaPath = path.join(EVIDENCE_DIR, 'true-faceplate.sga')
const buf = Buffer.from(result.sga.buffer, result.sga.byteOffset, result.sga.byteLength)
writeFileSync(trueSgaPath, buf)
console.log(`  Written to: ${trueSgaPath}`)

// Open and dump
const builtTree = await dumpSga(trueSgaPath, '(c) Fresh buildFaceplateMod output — AFTER build')

// ---------------------------------------------------------------------------
// Diff: workshop (b) vs built (c)
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`)
console.log('DIFF: Workshop (b) vs buildFaceplateMod (c)')
console.log('='.repeat(70))

// Normalize paths: strip the GUID/slug from dynamic filenames to get structural paths
function normalizePath(p: string, guid: string, slug: string): string {
  return p
    .replace(new RegExp(guid, 'gi'), '<GUID>')
    .replace(new RegExp(slug, 'gi'), '<SLUG>')
}

const wNorm = workshopTree.map(e => normalizePath(e.path, '', '')).sort()
const bNorm = builtTree.map(e => normalizePath(e.path, pinGuid, 'phase1_test_faceplate')).sort()

// Also do a raw structural comparison: which path prefixes / drive roots are present?
const wDrives = new Set(workshopTree.map(e => e.path.split('/')[0]))
const bDrives = new Set(builtTree.map(e => e.path.split('/')[0]))

console.log(`  Workshop (b) top-level folders/roots: ${[...wDrives].join(', ')}`)
console.log(`  Built    (c) top-level folders/roots: ${[...bDrives].join(', ')}`)
console.log(`  Workshop (b) file count: ${workshopTree.length}`)
console.log(`  Built    (c) file count: ${builtTree.length}`)

// Find paths in (b) that have no equivalent in (c) — structurally
console.log('\n  Paths in (b) NOT structurally equivalent in (c):')
let missingCount = 0
for (const wPath of workshopTree) {
  // Check if any built path has the same folder structure + extension
  const wExt = path.extname(wPath.path)
  const wDir = wPath.path.includes('/') ? wPath.path.split('/').slice(0, -1).join('/') : '<root>'
  const found = builtTree.some(bPath => {
    const bDir = bPath.path.includes('/') ? bPath.path.split('/').slice(0, -1).join('/') : '<root>'
    return path.extname(bPath.path) === wExt && bDir === wDir
  })
  if (!found) {
    console.log(`    MISSING in (c): ${wPath.path}  (${wPath.size} B, dir=${wDir}, ext=${wExt})`)
    missingCount++
  }
}
if (missingCount === 0) console.log('    (none — file sets are structurally equivalent)')

console.log('\n  Paths in (c) NOT structurally equivalent in (b):')
let extraCount = 0
for (const bPath of builtTree) {
  const bExt = path.extname(bPath.path)
  const bDir = bPath.path.includes('/') ? bPath.path.split('/').slice(0, -1).join('/') : '<root>'
  const found = workshopTree.some(wPath => {
    const wDir = wPath.path.includes('/') ? wPath.path.split('/').slice(0, -1).join('/') : '<root>'
    return path.extname(wPath.path) === bExt && wDir === bDir
  })
  if (!found) {
    console.log(`    EXTRA in (c): ${bPath.path}  (${bPath.size} B, dir=${bDir}, ext=${bExt})`)
    extraCount++
  }
}
if (extraCount === 0) console.log('    (none)')

// ---------------------------------------------------------------------------
// Save tree dumps to evidence dir
// ---------------------------------------------------------------------------
const report = {
  artifact: artifactTree,
  workshop: workshopTree,
  built: builtTree,
  builtSga: trueSgaPath,
  builtGuid: result.guid,
}
writeFileSync(path.join(EVIDENCE_DIR, 'tree-dump.json'), JSON.stringify(report, null, 2))
console.log(`\nTree dump saved to: ${EVIDENCE_DIR}/tree-dump.json`)
console.log(`True faceplate SGA: ${trueSgaPath}`)
console.log(`GUID: ${result.guid}`)
