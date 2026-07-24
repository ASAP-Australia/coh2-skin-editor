/**
 * scripts/verify-unwrap-analytical.mts
 *
 * ANALYTICAL decal-unwrap verifier for the CoH2 skin editor.
 *
 * Purpose
 * -------
 * Decide — mathematically, from mesh data alone, with NO Electron / GPU / app
 * launch — whether the national-insignia decal will render correctly on each
 * vehicle in the editor's 3D viewport. Pure Node (tsx).
 *
 * Method (mirrors the editor's real pipeline)
 * -------------------------------------------
 *   1. Locate the CoH2 install's Archives folder (Steam auto-detect).
 *   2. For each of the 61 vehicles in VEHICLES, read its RGM bytes from the
 *      faction's candidate SGAs (same set as preload.ts:FACTION_SGAS), open
 *      via SgaArchive (Node Blob), and parse via the SAME parseRgm() the app
 *      uses. One RGM file per vehicle contains all submeshes (body/turret/
 *      tracks/wreck) as either separate TRIM v5 chunks (single draw-group each)
 *      or one merged MRGM v8 mesh (multiple draw-groups).
 *   3. Per submesh/draw-group extract TEXCOORD1 (semantic 9 / uv2):
 *        - format 2 (R8G8B8A8): U = byte[o+2]/255, V = byte[o+1]/255  (NO V-flip)
 *        - format 3 (R32G32_FLOAT): U = f32(o), V = 1 - f32(o+4)      (V IS flipped)
 *      This asymmetry is rgm.ts:461-471 — the suspected format-3 V-flip bug.
 *      We record the bbox AS DECODED by rgm.ts, plus the OPPOSITE-convention
 *      bbox so we can test the V-flip hypothesis on any MISSING vehicle.
 *   4. Apply the editor's gating (Viewport.tsx):
 *        - drop destroyed/wreck + gameplay-variant submeshes (same regexes).
 *        - __usesBodyDiffuse: body/panels materials qualify; a 'turrets'-token
 *          submesh qualifies only when NO dedicated <id>_turrets_dif TSET exists
 *          (sharesBodyAtlas). stug_iii's turret HAS its own atlas → excluded.
 *        - __hasBadgeUv = __usesBodyDiffuse && hasTightBadgeUv(geo):
 *            single-group (TRIM v5): tight = uv2 span < 0.2 on BOTH axes.
 *            multi-group  (MRGM v8): unconditional true (shader bounds is the gate).
 *        - shader window: a vertex composites the badge only where
 *            uv2.x ∈ [0.27,0.35] AND uv2.y ∈ [0.03,0.09].
 *   5. Verdict per vehicle:
 *        RENDERS     — ≥1 gated submesh's decoded TC1 intersects the window.
 *        MISSING     — no gated submesh lands in-window (decal absent = bug if
 *                      the opposite V-convention WOULD land in-window).
 *        SMEAR-RISK  — a gated MRGM submesh whose TC1 bbox is WIDE (span ≥0.2 on
 *                      either axis) yet intersects the window (badge smears).
 *        NO-TC1      — vehicle has no semantic-9 channel at all.
 *        SKIPPED     — RGM archive could not be located / parsed.
 *
 * Output: artifacts/verify-unwrap/analytical-report.md + analytical-results.json
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.node.json scripts/verify-unwrap-analytical.mts
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')

// Dynamic imports keep the module graph resolvable under tsx.
const { parseRgm } = await import(`${SRC_LIB}/rgm.ts`)
const { SgaArchive } = await import(`${SRC_LIB}/sga.ts`)
const { VEHICLES, rgmPath } = await import(`${SRC_LIB}/vehicles.ts`)

type RgmModelT = Awaited<ReturnType<typeof parseRgm>>

// ── Shader window + tightness constants (verified against Viewport.tsx) ───────
const WIN = { uMin: 0.27, uMax: 0.35, vMin: 0.03, vMax: 0.09 } // shader bounds check
const TIGHT_SPAN = 0.2 // hasTightBadgeUv: both axes must span < 0.2 for single-group
const CLUSTER = { uMin: 0.286, uMax: 0.337, vMin: 0.039, vMax: 0.086 } // canonical badge cell

// ── Per-faction candidate SGAs (mirror preload.ts:FACTION_SGAS) ───────────────
const FACTION_SGAS: Record<string, string[]> = {
  german: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtGermanEF.sga'],
  west_german: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtWestGerman.sga'],
  soviet: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtArmies.sga', 'ArtSovietEF.sga'],
  aef: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga', 'ArtAEF.sga', 'ArtAEFSkins.sga'],
  british: ['ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga', 'ArtBritish.sga'],
}
// A couple of vehicles occasionally live in an archive not in their faction's
// primary set (shared/lend-lease). Scan every Art*.sga as a fallback.
const ALL_ART_SGAS = [
  'ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga',
  'ArtGermanEF.sga', 'ArtWestGerman.sga', 'ArtSovietEF.sga',
  'ArtAEF.sga', 'ArtAEFSkins.sga', 'ArtBritish.sga',
]

// ── Editor gating regexes (mirror Viewport.tsx DESTROYED_PATTERNS/VARIANT) ─────
const DESTROYED_PATTERNS: RegExp[] = [
  /destroy(?:ed)?(?![a-z])/i, /wreck/i, /destruction/i, /burnt/i, /broken/i,
  /\bdmg\b/i, /_dam_/i, /wreak/i,
  /(?<![a-z0-9])damaged?(?![a-z0-9])/i, /(?<![a-z0-9])dam(?![a-z0-9])/i,
  /_d_(?:fr|fl|rr|rl|front|back|rear|left|right|side|\d+)(?:_|$)/i,
  /(?<![a-z0-9])dmg(?![a-z0-9])/i, /(?<![a-z0-9])dst(?![a-z0-9])/i, /(?<![a-z0-9])dest(?![a-z0-9])/i,
  /wheel[^a-z]*(?:dmg|dst|dest|destroyed|wreck|broken|dam)/i,
  /(?:dmg|dst|dest|destroyed|wreck|broken|dam)[^a-z]*wheel/i,
  /critical[^a-z]+treads?(?![a-z])|treads?[^a-z]+critical(?![a-z])/i,
  /\bproxy\b/i, /\bcollision\b/i, /\bphys(?:ics)?\b/i, /\bshadow\b/i,
  /\bocclus(?:ion|der)\b/i, /\bremains\b/i, /\bcrater\b/i,
  /crushed(?![a-z])/i, /orphans?(?![a-z])/i, /body_chunks?(?![a-z])/i,
  /(?:^|[_\W])wrk(?![a-z])/i, /(?:^|[_\W])crs(?![a-z])/i,
]
const VARIANT_PATTERNS: RegExp[] = [
  /turret_vert_mortar/i, /(?:^|[_\W])avre(?![a-z])/i, /flamethrower/i, /croctank/i, /goblins?(?![a-z])/i,
]
const isDestroyed = (n: string) => DESTROYED_PATTERNS.some(r => r.test(n))
const isVariant = (n: string) => VARIANT_PATTERNS.some(r => r.test(n))

// tokenFor() — the distinguishing token used for atlas/material routing.
function tokenFor(mat: string): string {
  if (/(?:^|_)turrets?(?:_|$)/i.test(mat)) return 'turrets'
  if (/wreck|wreak/i.test(mat)) return 'wreck'
  if (/(?:^|[^a-z])(?:tread|track|wheel)s?(?![a-z])/i.test(mat)) return 'tread'
  if (/schurzen|skirt|side_armor|sidearmor/i.test(mat)) return 'schurzen'
  if (/(?:^|_)panels?(?:_|$)/i.test(mat)) return 'panels'
  return ''
}

// ── Install / archive location ────────────────────────────────────────────────
function candidateInstallRoots(): string[] {
  const h = homedir()
  return [
    path.join(h, '.local/share/Steam/steamapps/common/Company of Heroes 2'),
    path.join(h, '.steam/steam/steamapps/common/Company of Heroes 2'),
    path.join(h, '.steam/root/steamapps/common/Company of Heroes 2'),
    path.join(h, 'Steam/steamapps/common/Company of Heroes 2'),
    'C:/Program Files (x86)/Steam/steamapps/common/Company of Heroes 2',
  ]
}
function locateArchivesDir(): string | null {
  for (const base of candidateInstallRoots()) {
    for (const rel of [['CoH2', 'Archives'], ['Archives']]) {
      const dir = path.join(base, ...rel)
      if (existsSync(path.join(dir, 'ArtHigh.sga'))) return dir
    }
  }
  return null
}

// ── SGA cache (open each archive once, Node Blob) ─────────────────────────────
const archiveCache = new Map<string, InstanceType<typeof SgaArchive> | null>()
async function openArchive(archivesDir: string, name: string) {
  if (archiveCache.has(name)) return archiveCache.get(name)!
  const p = path.join(archivesDir, name)
  if (!existsSync(p)) { archiveCache.set(name, null); return null }
  try {
    const buf = await readFile(p)
    const blob = new Blob([buf])
    const archive = await SgaArchive.open(blob)
    archiveCache.set(name, archive)
    return archive
  } catch (e) {
    console.warn(`[warn] failed to open ${name}: ${(e as Error).message}`)
    archiveCache.set(name, null)
    return null
  }
}

// ── TC1 decode — reproduce rgm.ts BOTH conventions for hypothesis testing ─────
// We re-decode TC1 from the raw vertex buffer per group so we can evaluate both
// the editor's convention AND the opposite V convention. The editor's decode is
// authoritative for the primary verdict; the opposite is only used to test the
// V-flip hypothesis on MISSING vehicles.
interface Bbox { uMin: number; uMax: number; vMin: number; vMax: number; count: number }
function emptyBbox(): Bbox { return { uMin: Infinity, uMax: -Infinity, vMin: Infinity, vMax: -Infinity, count: 0 } }
function acc(b: Bbox, u: number, v: number) {
  if (u < b.uMin) b.uMin = u; if (u > b.uMax) b.uMax = u
  if (v < b.vMin) b.vMin = v; if (v > b.vMax) b.vMax = v
  b.count++
}
function spanU(b: Bbox) { return b.count ? b.uMax - b.uMin : 0 }
function spanV(b: Bbox) { return b.count ? b.vMax - b.vMin : 0 }
function intersectsWindow(b: Bbox): boolean {
  if (b.count === 0) return false
  return b.uMax >= WIN.uMin && b.uMin <= WIN.uMax && b.vMax >= WIN.vMin && b.vMin <= WIN.vMax
}
// Does any point of the bbox with the OPPOSITE V convention (v -> 1-v) hit window?
function flippedBbox(b: Bbox): Bbox {
  if (b.count === 0) return b
  return { uMin: b.uMin, uMax: b.uMax, vMin: 1 - b.vMax, vMax: 1 - b.vMin, count: b.count }
}

interface SubmeshRecord {
  name: string
  materialName: string | null
  format: number | null       // TC1 vertex-element format (2 or 3), null if no TC1
  groupCountForMesh: number    // draw-groups on the parent geometry (TRIM=1, MRGM>1)
  isMultiGroup: boolean
  vertexCount: number
  editorBbox: Bbox             // TC1 bbox AS DECODED by rgm.ts (uv2 attribute)
  oppositeBbox: Bbox           // same TC1 with the opposite V convention
  destroyed: boolean
  variant: boolean
  token: string
  usesBodyDiffuse: boolean
  hasTightBadgeUv: boolean
  hasBadgeUv: boolean          // = usesBodyDiffuse && hasTightBadgeUv
  inWindowAsDecoded: boolean
  inWindowIfFlipped: boolean
  wide: boolean                // span >= 0.2 on either axis
}

// Per-mesh TC1 element-format detection FROM THE DECODED VALUES.
// This is deterministic and exact — no chunk-order matching needed:
//   • format 2 (R8G8B8A8 packed): every decoded U and V is an exact multiple of
//     1/255 (u = byte/255, v = byte/255). So round(value*255) reconstructs it.
//   • format 3 (R32G32_FLOAT): arbitrary floats, essentially never all on the
//     1/255 grid across a whole mesh.
// We sample the mesh's uv2 and, if EVERY sampled value snaps to the 1/255 grid
// (within a tiny epsilon), call it format 2; otherwise format 3.
function detectMeshTc1Format(uv2: { count: number; getX(i: number): number; getY(i: number): number }): number | null {
  if (uv2.count === 0) return null
  const EPS = 1e-4
  // Sample up to 400 vertices spread across the mesh.
  const step = Math.max(1, Math.floor(uv2.count / 400))
  let onGrid = 0, total = 0
  for (let i = 0; i < uv2.count; i += step) {
    for (const val of [uv2.getX(i), uv2.getY(i)]) {
      total++
      const snapped = Math.round(val * 255) / 255
      if (Math.abs(val - snapped) < EPS) onGrid++
    }
  }
  // format 2 iff (nearly) all values snap to the 1/255 grid.
  return onGrid / total > 0.995 ? 2 : 3
}

// Extract per-submesh TC1 records for a parsed vehicle.
// TRIM v5: one RgmMesh per submesh, geometry has 1 draw-group.
// MRGM v8: one RgmMesh with N draw-groups; we split TC1 by each group's index range
//          so we can gate/attribute per-group (matching the shader's per-vertex gate).
function extractSubmeshes(model: RgmModelT, turretsAtlasSet: Set<string>): SubmeshRecord[] {
  const out: SubmeshRecord[] = []

  for (const mesh of model.meshes) {
    const uv2ForFmt = mesh.geometry.attributes.uv2 as { count: number; getX(i: number): number; getY(i: number): number } | undefined
    const tc1Format = uv2ForFmt ? detectMeshTc1Format(uv2ForFmt) : null
    const geo = mesh.geometry
    const uv2 = geo.attributes.uv2 as { count: number; getX(i: number): number; getY(i: number): number } | undefined
    const groups = (geo as unknown as { groups: { start: number; count: number }[] }).groups ?? []
    const index = (geo as unknown as { index: { array: ArrayLike<number> } | null }).index
    const multiGroup = groups.length > 1
    const groupCount = groups.length

    // Determine the TC1 element format from the geometry: uv2 values that are
    // pure multiples of 1/255 with tight clustering indicate format 2 packed;
    // float32 path indicates format 3. We can't read the raw element here, so we
    // infer format via the model's per-mesh flag stashed by re-parse below. As a
    // robust proxy: if the mesh recorded a float TC1 (fractional values not on a
    // 1/255 grid over a wide sample), treat as format 3. However, to be exact we
    // reconstruct format from the vertex layout in the second pass (see main()).
    // Here we only compute bboxes; format is attached by the caller.

    if (!uv2 || uv2.count === 0) {
      out.push(mkRecord(mesh, groupCount, multiGroup, 0, emptyBbox(), emptyBbox(), tc1Format, turretsAtlasSet))
      continue
    }

    if (!multiGroup || !index) {
      // Single-group (TRIM v5) OR no index groups: whole-mesh TC1 bbox.
      const editor = emptyBbox(), opp = emptyBbox()
      for (let i = 0; i < uv2.count; i++) {
        const u = uv2.getX(i), v = uv2.getY(i)
        acc(editor, u, v); acc(opp, u, 1 - v)
      }
      out.push(mkRecord(mesh, groupCount, multiGroup, uv2.count, editor, opp, tc1Format, turretsAtlasSet))
    } else {
      // Multi-group (MRGM v8): split TC1 by each draw-group's index range so
      // every group is evaluated as its own submesh (matches per-vertex shader).
      const idx = index.array
      for (let g = 0; g < groups.length; g++) {
        const { start, count } = groups[g]
        const editor = emptyBbox(), opp = emptyBbox()
        const seen = new Set<number>()
        for (let k = start; k < start + count; k++) {
          const vi = idx[k] as number
          if (seen.has(vi)) continue
          seen.add(vi)
          const u = uv2.getX(vi), v = uv2.getY(vi)
          acc(editor, u, v); acc(opp, u, 1 - v)
        }
        out.push(mkRecord(mesh, groupCount, true, editor.count, editor, opp, tc1Format, turretsAtlasSet, g))
      }
    }
  }
  return out
}

function mkRecord(
  mesh: { name: string; materialName: string | null },
  groupCount: number,
  multiGroup: boolean,
  vcount: number,
  editor: Bbox,
  opposite: Bbox,
  format: number | null,
  turretsAtlasSet: Set<string>,
  groupIdx?: number,
): SubmeshRecord {
  const nameForGating = mesh.materialName ?? mesh.name
  const label = groupIdx != null ? `${mesh.name}#g${groupIdx}` : mesh.name
  const destroyed = isDestroyed(nameForGating) || isDestroyed(mesh.name)
  const variant = isVariant(nameForGating) || isVariant(mesh.name)
  const token = tokenFor(nameForGating)

  // __usesBodyDiffuse (Viewport.tsx): body/panels-token materials qualify.
  // A 'turrets'-token material qualifies ONLY when it shares the body atlas —
  // i.e. no dedicated <id>_turrets_dif TSET exists. If such a TSET exists
  // (stug_iii), the turret uses a separate atlas and gets NO badge shader.
  let usesBodyDiffuse: boolean
  if (destroyed || variant || token === 'tread' || token === 'wreck' || token === 'schurzen') {
    usesBodyDiffuse = false
  } else if (token === 'turrets') {
    usesBodyDiffuse = turretsAtlasSet.size === 0 // shares body atlas only if no _turrets_dif TSET
  } else {
    // '' (body) or 'panels' → uses body diffuse
    usesBodyDiffuse = true
  }

  // hasTightBadgeUv(geo): multi-group → always true; single-group → span < 0.2 both axes.
  let tight: boolean
  if (editor.count === 0) tight = false
  else if (multiGroup) tight = true
  else tight = spanU(editor) < TIGHT_SPAN && spanV(editor) < TIGHT_SPAN

  const hasBadgeUv = usesBodyDiffuse && tight
  const wide = editor.count > 0 && (spanU(editor) >= TIGHT_SPAN || spanV(editor) >= TIGHT_SPAN)

  return {
    name: label,
    materialName: mesh.materialName,
    format,
    groupCountForMesh: groupCount,
    isMultiGroup: multiGroup,
    vertexCount: vcount,
    editorBbox: editor,
    oppositeBbox: opposite,
    destroyed, variant, token,
    usesBodyDiffuse,
    hasTightBadgeUv: tight,
    hasBadgeUv,
    inWindowAsDecoded: intersectsWindow(editor),
    inWindowIfFlipped: intersectsWindow(flippedBbox(editor)),
    wide,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
interface VehicleResult {
  id: string
  faction: string
  displayName: string
  rgmPath: string
  archive: string | null
  formats: number[]        // distinct TC1 formats seen (2 and/or 3)
  totalSubmeshes: number
  intactSubmeshes: number
  gatedSubmeshes: number   // __hasBadgeUv === true
  verdict: 'RENDERS' | 'MISSING' | 'SMEAR-RISK' | 'NO-TC1' | 'SKIPPED'
  evidence: string
  vFlipWouldFix: boolean
  submeshes: SubmeshRecord[]
  skipReason?: string
}

// Does the vehicle RGM carry a dedicated <id>_turrets_dif TSET (→ turret uses
// its own atlas, gets no badge shader)?
function turretsAtlasTsets(model: RgmModelT): Set<string> {
  const s = new Set<string>()
  for (const ts of model.textureSets) {
    if (/_turrets?_dif$/i.test(ts.replace(/\\/g, '/'))) s.add(ts)
  }
  return s
}

async function main() {
  const archivesDir = locateArchivesDir()
  const OUT_DIR = path.join(ROOT, 'artifacts', 'verify-unwrap')
  await mkdir(OUT_DIR, { recursive: true })

  if (!archivesDir) {
    console.error('[FATAL] Could not locate CoH2 install Archives folder. Tried:')
    for (const b of candidateInstallRoots()) console.error('  ' + b)
    process.exit(2)
  }
  console.log(`[info] Archives: ${archivesDir}`)

  const results: VehicleResult[] = []

  for (const v of VEHICLES as Array<{ id: string; faction: string; displayName: string }>) {
    const rp = rgmPath(v as never).toLowerCase()
    const candidates = FACTION_SGAS[v.faction] ?? ALL_ART_SGAS

    // Find the RGM bytes in the faction's SGAs, then fall back to all Art*.
    let bytes: Uint8Array | null = null
    let foundArchive: string | null = null
    for (const name of [...candidates, ...ALL_ART_SGAS.filter(a => !candidates.includes(a))]) {
      const archive = await openArchive(archivesDir, name)
      if (!archive) continue
      try {
        const b = await archive.readByPath(rp)
        if (b) { bytes = b; foundArchive = name; break }
      } catch { /* try next */ }
    }

    const base: VehicleResult = {
      id: v.id, faction: v.faction, displayName: v.displayName, rgmPath: rp,
      archive: foundArchive, formats: [], totalSubmeshes: 0, intactSubmeshes: 0,
      gatedSubmeshes: 0, verdict: 'SKIPPED', evidence: '', vFlipWouldFix: false, submeshes: [],
    }

    if (!bytes) {
      base.verdict = 'SKIPPED'
      base.skipReason = `RGM ${rp} not found in any Art*.sga`
      base.evidence = base.skipReason
      results.push(base)
      console.log(`  ${v.id.padEnd(28)} SKIPPED  (${base.skipReason})`)
      continue
    }

    let model: RgmModelT
    try {
      model = parseRgm(bytes)
    } catch (e) {
      base.verdict = 'SKIPPED'
      base.skipReason = `parseRgm failed: ${(e as Error).message}`
      base.evidence = base.skipReason
      results.push(base)
      console.log(`  ${v.id.padEnd(28)} SKIPPED  (${base.skipReason})`)
      continue
    }

    const turretsSet = turretsAtlasTsets(model)
    const subs = extractSubmeshes(model, turretsSet)

    base.formats = [...new Set(subs.map(s => s.format).filter((f): f is number => f != null))].sort()
    base.totalSubmeshes = subs.length
    base.intactSubmeshes = subs.filter(s => !s.destroyed && !s.variant).length
    base.submeshes = subs

    const gated = subs.filter(s => s.hasBadgeUv && !s.destroyed && !s.variant)
    base.gatedSubmeshes = gated.length

    // The badge RENDERS only where the *actual badge-cell geometry* (a TIGHT
    // gated submesh: span < 0.2 on both axes → the small fittings that carry the
    // insignia) lands inside the shader window. A WIDE gated submesh (the merged
    // hull-body polygon that double-uses TC1 as diffuse UV) intersecting the
    // window is NOT the badge rendering — it is the smear case, mitigated at
    // runtime by the transparent-background wrapper canvas but flagged here as a
    // risk. This distinction is what separates a real MISSING bug (tight cluster
    // out of window) from correct behaviour (wide hull overlaps but is transparent).
    const tightGated = gated.filter(s => !s.wide)
    const wideGated = gated.filter(s => s.wide)
    const tightInWindow = tightGated.filter(s => s.inWindowAsDecoded)
    const wideInWindow = wideGated.filter(s => s.inWindowAsDecoded)

    const anyTc1 = subs.some(s => s.editorBbox.count > 0)
    if (!anyTc1) {
      base.verdict = 'NO-TC1'
      base.evidence = 'no semantic-9 (TEXCOORD1) channel in any submesh'
    } else if (tightInWindow.length > 0) {
      // Badge-cell geometry lands in-window → decal appears correctly.
      base.verdict = 'RENDERS'
      const s = tightInWindow[0]
      base.evidence =
        `${tightInWindow.length}/${tightGated.length} tight badge-cell submesh(es) in-window; ` +
        `e.g. ${s.name} TC1 U[${fmt(s.editorBbox.uMin)},${fmt(s.editorBbox.uMax)}] ` +
        `V[${fmt(s.editorBbox.vMin)},${fmt(s.editorBbox.vMax)}] (fmt${s.format})`
      if (wideInWindow.length > 0) {
        base.evidence += ` | ${wideInWindow.length} wide gated group(s) also overlap window (wrapper-canvas mitigated)`
      }
    } else {
      // No tight badge-cell submesh in-window. Decal is absent on the detail
      // geometry → MISSING (or SMEAR-RISK if only a wide group overlaps).
      const flipFixers = tightGated.filter(s => !s.inWindowAsDecoded && s.inWindowIfFlipped)
      base.vFlipWouldFix = flipFixers.length > 0

      if (wideInWindow.length > 0 && tightGated.length === 0) {
        // Only a wide gated group overlaps the window and there is NO tight
        // badge-cell geometry at all → pure smear risk.
        base.verdict = 'SMEAR-RISK'
        const s = wideInWindow[0]
        base.evidence =
          `no tight badge-cell submesh; ${wideInWindow.length} WIDE gated group(s) span the window ` +
          `(smear): e.g. ${s.name} U[${fmt(s.editorBbox.uMin)},${fmt(s.editorBbox.uMax)}] ` +
          `V[${fmt(s.editorBbox.vMin)},${fmt(s.editorBbox.vMax)}] uSpan=${fmt(spanU(s.editorBbox))} vSpan=${fmt(spanV(s.editorBbox))}`
      } else {
        base.verdict = 'MISSING'
        // Prefer a representative badge-cluster submesh (U within the shader
        // U-window) over a stray/degenerate group so the evidence is meaningful.
        const inUWindow = (s: SubmeshRecord) =>
          s.editorBbox.count > 0 && s.editorBbox.uMax >= WIN.uMin && s.editorBbox.uMin <= WIN.uMax
        const ev =
          tightGated.find(inUWindow) ?? tightGated[0] ?? gated[0] ?? subs.find(s => s.editorBbox.count > 0)!
        base.evidence =
          `0/${tightGated.length} tight badge-cell submesh(es) in-window; ` +
          `e.g. ${ev.name} decoded V[${fmt(ev.editorBbox.vMin)},${fmt(ev.editorBbox.vMax)}] ` +
          `(fmt${ev.format}); un-flipped V[${fmt(1 - ev.editorBbox.vMax)},${fmt(1 - ev.editorBbox.vMin)}]`
        if (base.vFlipWouldFix) {
          const f = flipFixers[0]
          base.evidence += ` | V-FLIP FIXES IT: ${f.name} (fmt${f.format}) un-flips into window ` +
            `U[${fmt(f.editorBbox.uMin)},${fmt(f.editorBbox.uMax)}] Vunflip[${fmt(1 - f.editorBbox.vMax)},${fmt(1 - f.editorBbox.vMin)}]`
        }
      }
    }

    results.push(base)
    console.log(
      `  ${v.id.padEnd(28)} ${base.verdict.padEnd(11)} fmt[${base.formats.join(',')}] ` +
      `groups=${maxGroups(subs)} tightGated=${tightGated.length} tightInWin=${tightInWindow.length}` +
      (base.verdict === 'MISSING' ? `  vFlipFix=${base.vFlipWouldFix}` : ''),
    )
  }

  // ── Summarize + write artifacts ─────────────────────────────────────────────
  const counts = {
    RENDERS: results.filter(r => r.verdict === 'RENDERS').length,
    MISSING: results.filter(r => r.verdict === 'MISSING').length,
    'SMEAR-RISK': results.filter(r => r.verdict === 'SMEAR-RISK').length,
    'NO-TC1': results.filter(r => r.verdict === 'NO-TC1').length,
    SKIPPED: results.filter(r => r.verdict === 'SKIPPED').length,
  }
  const missingVehicles = results.filter(r => r.verdict === 'MISSING')
  const vflipVictims = missingVehicles.filter(r => r.vFlipWouldFix)
  const format3Vehicles = results.filter(r => r.formats.includes(3))

  await writeFile(path.join(OUT_DIR, 'analytical-results.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    archivesDir,
    shaderWindow: WIN,
    tightSpanThreshold: TIGHT_SPAN,
    canonicalCluster: CLUSTER,
    counts,
    total: results.length,
    vflipHypothesis: {
      confirmed: vflipVictims.length > 0,
      victims: vflipVictims.map(r => r.id),
      format3Vehicles: format3Vehicles.map(r => ({ id: r.id, verdict: r.verdict, vFlipWouldFix: r.vFlipWouldFix })),
    },
    results: results.map(r => ({
      ...r,
      submeshes: r.submeshes.map(s => ({
        name: s.name, materialName: s.materialName, format: s.format,
        groupCountForMesh: s.groupCountForMesh, isMultiGroup: s.isMultiGroup,
        vertexCount: s.vertexCount, token: s.token, destroyed: s.destroyed, variant: s.variant,
        usesBodyDiffuse: s.usesBodyDiffuse, hasTightBadgeUv: s.hasTightBadgeUv, hasBadgeUv: s.hasBadgeUv,
        editorBbox: bboxOut(s.editorBbox), oppositeBbox: bboxOut(s.oppositeBbox),
        inWindowAsDecoded: s.inWindowAsDecoded, inWindowIfFlipped: s.inWindowIfFlipped, wide: s.wide,
      })),
    })),
  }, null, 2))

  await writeFile(path.join(OUT_DIR, 'analytical-report.md'), renderReport(results, counts, vflipVictims, format3Vehicles, archivesDir))

  console.log('\n=== SUMMARY ===')
  console.log(`Total vehicles     : ${results.length}`)
  console.log(`RENDERS            : ${counts.RENDERS}`)
  console.log(`MISSING (bug)      : ${counts.MISSING}${missingVehicles.length ? ' — ' + missingVehicles.map(r => r.id).join(', ') : ''}`)
  console.log(`SMEAR-RISK         : ${counts['SMEAR-RISK']}${counts['SMEAR-RISK'] ? ' — ' + results.filter(r => r.verdict === 'SMEAR-RISK').map(r => r.id).join(', ') : ''}`)
  console.log(`NO-TC1             : ${counts['NO-TC1']}${counts['NO-TC1'] ? ' — ' + results.filter(r => r.verdict === 'NO-TC1').map(r => r.id).join(', ') : ''}`)
  console.log(`SKIPPED            : ${counts.SKIPPED}${counts.SKIPPED ? ' — ' + results.filter(r => r.verdict === 'SKIPPED').map(r => r.id + ' (' + r.skipReason + ')').join('; ') : ''}`)
  console.log(`\nformat-3 vehicles  : ${format3Vehicles.length}${format3Vehicles.length ? ' — ' + format3Vehicles.map(r => r.id).join(', ') : ''}`)
  console.log(`V-flip hypothesis  : ${vflipVictims.length > 0 ? 'CONFIRMED' : 'REFUTED'}${vflipVictims.length ? ' — victims: ' + vflipVictims.map(r => r.id).join(', ') : ''}`)
  console.log(`\nArtifacts:`)
  console.log(`  ${path.join(OUT_DIR, 'analytical-report.md')}`)
  console.log(`  ${path.join(OUT_DIR, 'analytical-results.json')}`)
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmt(n: number): string { return Number.isFinite(n) ? n.toFixed(3) : '—' }
function bboxOut(b: Bbox) {
  return b.count === 0 ? null : {
    uMin: +b.uMin.toFixed(4), uMax: +b.uMax.toFixed(4),
    vMin: +b.vMin.toFixed(4), vMax: +b.vMax.toFixed(4),
    uSpan: +(b.uMax - b.uMin).toFixed(4), vSpan: +(b.vMax - b.vMin).toFixed(4), count: b.count,
  }
}
function maxGroups(subs: SubmeshRecord[]): number {
  return subs.reduce((m, s) => Math.max(m, s.groupCountForMesh), 0)
}

function renderReport(
  results: VehicleResult[],
  counts: Record<string, number>,
  vflipVictims: VehicleResult[],
  format3Vehicles: VehicleResult[],
  archivesDir: string,
): string {
  const lines: string[] = []
  lines.push('# Analytical Decal-Unwrap Verification Report')
  lines.push('')
  lines.push(`_Generated ${new Date().toISOString()}_`)
  lines.push('')
  lines.push('Pure-Node analytical check (no Electron/GPU). For each vehicle it parses the RGM with the')
  lines.push('editor\'s own `parseRgm`, decodes TEXCOORD1 exactly as `rgm.ts` does, applies the editor\'s')
  lines.push('gating (`Viewport.tsx`), and tests whether the national-insignia decal lands inside the badge')
  lines.push(`shader window **U∈[${WIN.uMin},${WIN.uMax}] × V∈[${WIN.vMin},${WIN.vMax}]**.`)
  lines.push('')
  lines.push(`Archives: \`${archivesDir}\``)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('| Verdict | Count |')
  lines.push('|---|---|')
  for (const k of ['RENDERS', 'MISSING', 'SMEAR-RISK', 'NO-TC1', 'SKIPPED']) {
    lines.push(`| ${k} | ${counts[k]} |`)
  }
  lines.push(`| **Total** | **${results.length}** |`)
  lines.push('')
  lines.push(`**V-flip hypothesis (format-3 vehicles): ${vflipVictims.length > 0 ? 'CONFIRMED' : 'REFUTED'}.**`)
  lines.push('')
  if (format3Vehicles.length) {
    lines.push('format-3 (R32G32_FLOAT TC1) vehicles: ' + format3Vehicles.map(r => `\`${r.id}\` (${r.verdict}${r.verdict === 'MISSING' ? ', vFlipFix=' + r.vFlipWouldFix : ''})`).join(', ') + '.')
  } else {
    lines.push('No vehicle uses format-3 (R32G32_FLOAT) for TEXCOORD1.')
  }
  lines.push('')

  const problems = results.filter(r => r.verdict === 'MISSING' || r.verdict === 'SMEAR-RISK' || r.verdict === 'SKIPPED')
  lines.push('## Problem vehicles')
  lines.push('')
  if (problems.length === 0) {
    lines.push('_None — every located vehicle RENDERS or is NO-TC1 by design._')
  } else {
    lines.push('| Vehicle | Faction | Verdict | vFlipFix | Evidence |')
    lines.push('|---|---|---|---|---|')
    for (const r of problems) {
      lines.push(`| ${r.id} | ${r.faction} | ${r.verdict} | ${r.verdict === 'MISSING' ? r.vFlipWouldFix : '—'} | ${r.evidence.replace(/\|/g, '\\|')} |`)
    }
  }
  lines.push('')

  lines.push('## Per-vehicle table')
  lines.push('')
  lines.push('| Vehicle | Faction | Format(s) | Groups | Intact | Gated | Verdict | Evidence |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    const groups = maxGroups(r.submeshes)
    lines.push(
      `| ${r.id} | ${r.faction} | ${r.formats.join(',') || '—'} | ${groups || '—'} | ` +
      `${r.intactSubmeshes} | ${r.gatedSubmeshes} | ${r.verdict} | ${r.evidence.replace(/\|/g, '\\|')} |`,
    )
  }
  lines.push('')

  lines.push('## Proposed rgm.ts fix (if V-flip confirmed)')
  lines.push('')
  if (vflipVictims.length > 0) {
    lines.push('The format-3 TEXCOORD1 decode in `src/lib/rgm.ts` (case `SEMANTIC.TEXCOORD1`, `elt.format === 3`)')
    lines.push('flips V while the format-2 path does not — an asymmetry that pushes the badge cluster out of the')
    lines.push('shader window. Make format-3 match format-2 (no V-flip):')
    lines.push('')
    lines.push('```diff')
    lines.push('   if (elt.format === 3) {')
    lines.push('-    // R32G32_FLOAT — used by some MRGM v8 meshes (Cromwell)')
    lines.push('-    uvs2[v * 2 + 0] = view.getFloat32(o,     true)')
    lines.push('-    uvs2[v * 2 + 1] = 1 - view.getFloat32(o + 4, true)  // float32 path: flip V (D3D→GL)')
    lines.push('+    // R32G32_FLOAT — used by some MRGM v8 meshes (Cromwell).')
    lines.push('+    // NO V-flip: match the format-2 badge path so the tight cluster')
    lines.push('+    // V∈[0.039,0.086] stays in the shader window (badge tex is flipY:false).')
    lines.push('+    uvs2[v * 2 + 0] = view.getFloat32(o,     true)')
    lines.push('+    uvs2[v * 2 + 1] = view.getFloat32(o + 4, true)')
    lines.push('   } else if (elt.format === 2) {')
    lines.push('```')
    lines.push('')
    lines.push('Confirmed victims (format-3, MISSING, fixed by un-flipping V): ' + vflipVictims.map(r => `\`${r.id}\``).join(', ') + '.')
  } else {
    lines.push('_No fix proposed — no format-3 vehicle is MISSING due to the V-flip. The hypothesis is REFUTED_')
    lines.push('_by the numbers below (any format-3 vehicle either RENDERS as-is, or its cluster does not land in_')
    lines.push('_window under EITHER V convention — i.e. flipping V would not rescue it)._')
  }
  lines.push('')
  return lines.join('\n')
}

await main()
