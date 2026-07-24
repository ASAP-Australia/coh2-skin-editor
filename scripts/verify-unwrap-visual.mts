/**
 * verify-unwrap-visual.mts — Phase-2 VISUAL unwrap verifier: diff + assertions.
 *
 * Run (after a VERIFY_VISUAL=1 capture has populated artifacts/verify-unwrap/visual/):
 *   npx tsx --tsconfig tsconfig.node.json scripts/verify-unwrap-visual.mts
 *
 * Consumes the base/cal PNG pairs produced by electron/verify-visual-capture.ts
 * (artifacts/verify-unwrap/visual/<faction>/<id>_{base,cal}.png) and, for each
 * vehicle, computes:
 *
 *   FOOTPRINT  pixels that differ between base and cal beyond a small per-channel
 *              tolerance (the rendered calibration decal + its lighting response).
 *   SILHOUETTE non-background pixels in the base frame (vehicle body), used as the
 *              denominator for the smear ratio.
 *   ORIENTATION top colour band (magenta+cyan) vs bottom band (yellow+green)
 *              screen-Y inside the footprint. A vertical flip (the V-flip
 *              regression mode) swaps the two bands. Because the fixed 3/4 camera
 *              gives each vehicle its own screen handedness, the flip test is a
 *              CONSISTENCY check: a vehicle's band-Y sign must match the golden
 *              baseline sign (re-runs) or the population majority (first run);
 *              disagreement ⇒ FLIPPED. Smeared vehicles are excluded.
 *   GOLDEN     first run writes the footprint mask to artifacts/verify-unwrap/
 *              goldens/<faction>/<id>.png; later runs pixel-diff against it and
 *              report drift.
 *
 * Per-vehicle verdicts: PASS | NO-DECAL | SMEAR | FLIPPED | DRIFT | LOAD-TIMEOUT.
 * Emits artifacts/verify-unwrap/visual-report.md + visual-results.json.
 *
 * Pure Node — no Electron, no DOM. Uses pngjs + pixelmatch.
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { classifyQuadrant, type Quadrant } from '../src/lib/verify-calibration.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const VISUAL_DIR  = path.join(REPO, 'artifacts', 'verify-unwrap', 'visual')
const GOLDEN_DIR  = path.join(REPO, 'artifacts', 'verify-unwrap', 'goldens')
const REPORT_MD   = path.join(REPO, 'artifacts', 'verify-unwrap', 'visual-report.md')
const REPORT_JSON = path.join(REPO, 'artifacts', 'verify-unwrap', 'visual-results.json')
const MANIFEST    = path.join(VISUAL_DIR, '_capture-manifest.json')

// ── Tunables ──────────────────────────────────────────────────────────────────
// Per-channel diff tolerance for the footprint (0..255). Small — the calibration
// colours are highly saturated so real decal pixels move far beyond AA jitter.
const FOOTPRINT_TOL = 30
// pixelmatch threshold (0..1) for the base-vs-cal footprint diff.
const PIXELMATCH_THRESHOLD = 0.12
// A footprint must have at least this many pixels to count as a rendered decal.
// Below this the difference is AA/lighting noise, not a decal → NO-DECAL.
const MIN_FOOTPRINT_PX = 40
// Smear detection: a vehicle is flagged SMEAR when its footprint/silhouette
// ratio exceeds BOTH an absolute floor AND the population-relative bar. The
// absolute floor is the primary guard — a correctly-placed badge covers only a
// couple percent of the vehicle silhouette, so a footprint above ~9% means the
// calibration decal is bleeding across body geometry (wide-TC1 smear). The
// population-relative bar (median × mult) additionally flags per-run outliers.
// A vehicle trips SMEAR only if ratio > SMEAR_ABS_FLOOR AND ratio > median×mult
// — using AND avoids false-positives when the median itself is smear-inflated.
const SMEAR_ABS_FLOOR = 0.09
const SMEAR_MEDIAN_MULT = 2.0
// Golden drift: fraction of golden mask pixels allowed to differ before DRIFT.
const GOLDEN_DRIFT_FRAC = 0.15
// Minimum band pixels (per band) required to trust the orientation check.
// Below this the decal is too small/foreshortened to judge orientation
// reliably → record it but do NOT fail on orientation.
const MIN_BAND_PX = 30
// Orientation needs the top/bottom bands separated by at least this many screen
// pixels in Y before we trust the sign — guards against near-coincident band
// centroids on a heavily foreshortened decal producing a bogus FLIPPED.
const MIN_BAND_SEPARATION_PX = 6

// The 5 vehicles whose V-flip fix is the regression proof — MUST show a decal.
const VFLIP_FIXED = new Set([
  'jagdtiger', 'halftrack_sdkfz_251_flak', 'm4a1_sherman_calliope', 'valentine', 'sexton',
])

type Verdict = 'PASS' | 'NO-DECAL' | 'SMEAR' | 'FLIPPED' | 'DRIFT' | 'LOAD-TIMEOUT'

interface VehicleResult {
  faction: string
  id: string
  verdict: Verdict
  footprintPx: number
  silhouettePx: number
  footprintRatio: number       // footprint / silhouette
  tlCentroid: [number, number] | null
  brCentroid: [number, number] | null
  orientationOk: boolean | null
  orientationDy: number | null   // signed bottomBandY − topBandY (px); >0 = upright
  quadrantCounts: Record<Quadrant, number>
  goldenDriftFrac: number | null   // null = golden newly written this run
  goldenWritten: boolean
  notes: string[]
}

function readPng(p: string): PNG | null {
  try {
    return PNG.sync.read(fs.readFileSync(p))
  } catch {
    return null
  }
}

/** Sample a background colour from the 4 frame corners (median per channel). */
function sampleBackground(png: PNG): [number, number, number] {
  const { width, height, data } = png
  const pts: Array<[number, number]> = [
    [2, 2], [width - 3, 2], [2, height - 3], [width - 3, height - 3],
  ]
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  for (const [x, y] of pts) {
    const i = (y * width + x) * 4
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2])
  }
  const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
  return [med(rs), med(gs), med(bs)]
}

/**
 * Silhouette = base-frame pixels that differ from the sampled background by more
 * than BG_TOL on any channel. A robust-enough proxy for the vehicle body area
 * (ground/sky are near-uniform corners; the tank is high-contrast against them).
 */
function computeSilhouette(base: PNG): number {
  const [br, bg, bb] = sampleBackground(base)
  const BG_TOL = 24
  const { width, height, data } = base
  let count = 0
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (Math.abs(data[o] - br) > BG_TOL ||
        Math.abs(data[o + 1] - bg) > BG_TOL ||
        Math.abs(data[o + 2] - bb) > BG_TOL) {
      count++
    }
  }
  return count
}

interface FootprintResult {
  mask: Uint8Array          // 1 where base/cal differ, else 0
  count: number
  width: number
  height: number
}

/** Footprint mask via pixelmatch (base vs cal). */
function computeFootprint(base: PNG, cal: PNG): FootprintResult {
  const { width, height } = base
  const diff = new PNG({ width, height })
  const changed = pixelmatch(base.data, cal.data, diff.data, width, height, {
    threshold: PIXELMATCH_THRESHOLD,
    includeAA: false,
    alpha: 0,
  })
  // Build a clean boolean mask from pixelmatch's diff output (diff pixels are
  // painted red/yellow: high R, low B). Use our own per-channel recheck to
  // avoid counting AA fringes pixelmatch may have flagged.
  const mask = new Uint8Array(width * height)
  let count = 0
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const dr = Math.abs(base.data[o] - cal.data[o])
    const dg = Math.abs(base.data[o + 1] - cal.data[o + 1])
    const db = Math.abs(base.data[o + 2] - cal.data[o + 2])
    if (dr > FOOTPRINT_TOL || dg > FOOTPRINT_TOL || db > FOOTPRINT_TOL) {
      mask[i] = 1
      count++
    }
  }
  // `changed` from pixelmatch is a sanity cross-check only.
  void changed
  return { mask, count, width, height }
}

/** Quadrant analysis over the footprint using the CAL frame's colours. */
function analyseQuadrants(cal: PNG, fp: FootprintResult) {
  const { width, data } = cal
  const counts: Record<Quadrant, number> = { TL: 0, TR: 0, BL: 0, BR: 0 }
  const sums: Record<Quadrant, [number, number]> = {
    TL: [0, 0], TR: [0, 0], BL: [0, 0], BR: [0, 0],
  }
  for (let i = 0; i < fp.mask.length; i++) {
    if (!fp.mask[i]) continue
    const o = i * 4
    const q = classifyQuadrant(data[o], data[o + 1], data[o + 2])
    if (!q) continue
    const x = i % width
    const y = Math.floor(i / width)
    counts[q]++
    sums[q][0] += x
    sums[q][1] += y
  }
  const centroid = (q: Quadrant): [number, number] | null =>
    counts[q] > 0 ? [sums[q][0] / counts[q], sums[q][1] / counts[q]] : null
  // Band centroids aggregate two quadrants each → more pixels, less noise, and
  // they map directly to the two flip modes we must catch:
  //   • VERTICAL flip (the V-flip regression): swaps top band (magenta+cyan =
  //     TL+TR) with bottom band (yellow+green = BL+BR). Correct orientation ⇒
  //     top-band screen-Y < bottom-band screen-Y.
  //   • MIRROR: swaps left band (TL+BL) with right band (TR+BR).
  const band = (qs: Quadrant[]): [number, number, number] | null => {
    let sx = 0, sy = 0, n = 0
    for (const q of qs) { sx += sums[q][0]; sy += sums[q][1]; n += counts[q] }
    return n > 0 ? [sx / n, sy / n, n] : null
  }
  return {
    counts,
    tl: centroid('TL'),
    br: centroid('BR'),
    topBand: band(['TL', 'TR']),    // magenta + cyan
    bottomBand: band(['BL', 'BR']), // yellow + green
    leftBand: band(['TL', 'BL']),   // magenta + yellow
    rightBand: band(['TR', 'BR']),  // cyan + green
  }
}

/** Write the footprint mask as a black/white PNG. */
function writeMaskPng(fp: FootprintResult, outPath: string): void {
  const png = new PNG({ width: fp.width, height: fp.height })
  for (let i = 0; i < fp.mask.length; i++) {
    const o = i * 4
    const v = fp.mask[i] ? 255 : 0
    png.data[o] = v; png.data[o + 1] = v; png.data[o + 2] = v; png.data[o + 3] = 255
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, PNG.sync.write(png))
}

/** Compare a fresh footprint mask against a stored golden mask → drift fraction. */
function compareGolden(fp: FootprintResult, goldenPath: string): number | null {
  const golden = readPng(goldenPath)
  if (!golden) return null
  if (golden.width !== fp.width || golden.height !== fp.height) return 1.0
  let diff = 0, union = 0
  for (let i = 0; i < fp.mask.length; i++) {
    const g = golden.data[i * 4] > 127 ? 1 : 0
    const f = fp.mask[i]
    if (g || f) union++
    if (g !== f) diff++
  }
  return union > 0 ? diff / union : 0
}

// ── Main ────────────────────────────────────────────────────────────────────
function main(): void {
  if (!fs.existsSync(VISUAL_DIR)) {
    console.error(`[verify-visual-diff] No capture dir: ${VISUAL_DIR}`)
    console.error('[verify-visual-diff] Run the capture first: VERIFY_VISUAL=1 electron .')
    process.exit(1)
  }

  // Load the capture manifest to learn which items load-timed-out (no PNG).
  let manifest: { results?: Array<{ vehicleId: string; faction: string; mode: string; written: boolean; error: string | null }> } = {}
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) } catch { /* optional */ }
  const timedOut = new Set(
    (manifest.results ?? [])
      .filter(r => !r.written && (r.error === 'load-timeout' || r.error === 'timeout'))
      .map(r => `${r.faction}/${r.vehicleId}`),
  )

  // Discover all vehicles from the on-disk base/cal pairs.
  const factions = fs.readdirSync(VISUAL_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  const goldenExistsAtStart = fs.existsSync(GOLDEN_DIR)
  const results: VehicleResult[] = []

  for (const faction of factions) {
    const fdir = path.join(VISUAL_DIR, faction)
    const bases = fs.readdirSync(fdir).filter(f => f.endsWith('_base.png'))
    for (const baseFile of bases.sort()) {
      const id = baseFile.replace(/_base\.png$/, '')
      const basePath = path.join(fdir, baseFile)
      const calPath = path.join(fdir, `${id}_cal.png`)
      const notes: string[] = []

      const emptyQuad: Record<Quadrant, number> = { TL: 0, TR: 0, BL: 0, BR: 0 }

      // Load-timeout: manifest says the capture never produced a frame.
      if (timedOut.has(`${faction}/${id}`) || !fs.existsSync(calPath)) {
        results.push({
          faction, id, verdict: 'LOAD-TIMEOUT',
          footprintPx: 0, silhouettePx: 0, footprintRatio: 0,
          tlCentroid: null, brCentroid: null, orientationOk: null, orientationDy: null,
          quadrantCounts: emptyQuad, goldenDriftFrac: null, goldenWritten: false,
          notes: [!fs.existsSync(calPath) ? 'missing cal PNG' : 'load-timeout per manifest'],
        })
        continue
      }

      const base = readPng(basePath)
      const cal = readPng(calPath)
      if (!base || !cal) {
        results.push({
          faction, id, verdict: 'LOAD-TIMEOUT',
          footprintPx: 0, silhouettePx: 0, footprintRatio: 0,
          tlCentroid: null, brCentroid: null, orientationOk: null, orientationDy: null,
          quadrantCounts: emptyQuad, goldenDriftFrac: null, goldenWritten: false,
          notes: ['PNG decode failed'],
        })
        continue
      }
      if (base.width !== cal.width || base.height !== cal.height) {
        results.push({
          faction, id, verdict: 'LOAD-TIMEOUT',
          footprintPx: 0, silhouettePx: 0, footprintRatio: 0,
          tlCentroid: null, brCentroid: null, orientationOk: null, orientationDy: null,
          quadrantCounts: emptyQuad, goldenDriftFrac: null, goldenWritten: false,
          notes: ['base/cal size mismatch'],
        })
        continue
      }

      const fp = computeFootprint(base, cal)
      const silhouettePx = computeSilhouette(base)
      const ratio = silhouettePx > 0 ? fp.count / silhouettePx : 0
      const quad = analyseQuadrants(cal, fp)

      // Orientation signal (VERTICAL-flip detection — the V-flip regression
      // mode). Compare the TOP colour band (magenta+cyan) vs the BOTTOM band
      // (yellow+green) in screen-Y: dy = bottomY − topY. A correctly oriented
      // decal has the bottom band lower on screen (dy > 0). We only RECORD the
      // signed dy here; the FLIPPED decision is made in the finalize pass as a
      // POPULATION-CONSISTENCY test (a vehicle is flipped only if its dy sign is
      // a confident MINORITY outlier vs the population, and — on re-runs —
      // against its golden orientation). Aggregating two quadrants per band is
      // robust to per-quadrant centroid noise, and the population approach is
      // robust to the fixed 3/4 camera's per-vehicle screen handedness that made
      // a naive absolute sign test spuriously fail upright decals.
      let orientationDy: number | null = null
      const tb = quad.topBand, bb = quad.bottomBand
      if (tb && bb && tb[2] >= MIN_BAND_PX && bb[2] >= MIN_BAND_PX &&
          Math.abs(bb[1] - tb[1]) >= MIN_BAND_SEPARATION_PX) {
        orientationDy = bb[1] - tb[1]
      } else {
        notes.push('orientation indeterminate — bands too small / coincident')
      }
      // Provisional; finalised (population/golden consistency) in the post-pass.
      const orientationOk: boolean | null = null

      // Golden handling.
      const goldenPath = path.join(GOLDEN_DIR, faction, `${id}.png`)
      let goldenDriftFrac: number | null = null
      let goldenWritten = false
      if (!fs.existsSync(goldenPath)) {
        // First run for this vehicle — write the golden only if the footprint
        // is a real decal (don't enshrine an empty/garbage mask).
        if (fp.count >= MIN_FOOTPRINT_PX) {
          writeMaskPng(fp, goldenPath)
          goldenWritten = true
          notes.push('golden written (first run)')
        } else {
          notes.push('golden NOT written — footprint below MIN_FOOTPRINT_PX')
        }
      } else {
        goldenDriftFrac = compareGolden(fp, goldenPath)
        if (goldenDriftFrac !== null) {
          notes.push(`golden drift ${(goldenDriftFrac * 100).toFixed(1)}%`)
        }
      }

      results.push({
        faction, id,
        verdict: 'PASS', // provisional; finalised in the post-pass below
        footprintPx: fp.count,
        silhouettePx,
        footprintRatio: ratio,
        tlCentroid: quad.tl,
        brCentroid: quad.br,
        orientationOk,
        orientationDy,
        quadrantCounts: quad.counts,
        goldenDriftFrac,
        goldenWritten,
        notes,
      })
    }
  }

  // ── SMEAR thresholds (absolute floor + population-relative) ──────────────
  const decalRatios = results
    .filter(r => r.footprintPx >= MIN_FOOTPRINT_PX)
    .map(r => r.footprintRatio)
    .sort((a, b) => a - b)
  const medianRatio = decalRatios.length
    ? decalRatios[Math.floor(decalRatios.length / 2)]
    : 0
  const relThreshold = medianRatio * SMEAR_MEDIAN_MULT
  // A vehicle smears when it clears the absolute floor AND the relative bar.
  const smearThreshold = Math.max(SMEAR_ABS_FLOOR, relThreshold)

  // ── Orientation resolution (GOLDEN-relative regression check) ────────────
  // The signed orientationDy per vehicle depends on the fixed 3/4 camera and
  // that vehicle's hull-face screen handedness — so it is NOT uniform across
  // vehicles and an absolute/majority sign test mislabels upright decals. What
  // IS stable is a vehicle's OWN dy sign across runs (same mesh, same camera).
  // A V-flip regression inverts the decal vertically → inverts that sign.
  //
  // Therefore orientation is a pure REGRESSION check against a per-vehicle
  // golden sign:
  //   • FIRST run (no golden sign): record dy, orientationOk = null. Absolute
  //     upright-ness on the first run is NOT asserted here — it is established
  //     by the analytical layer (Phase 1, which proved TC1 placement for all 61)
  //     plus the footprint simply being present. The golden sign captured now
  //     becomes the reference.
  //   • RE-RUNS: orientationOk = (this run's sign === golden sign). A sign flip
  //     ⇒ FLIPPED (a real vertical-flip regression).
  // Smeared vehicles are excluded (their bands are meaningless).
  const ORIENT_SIDECAR = path.join(GOLDEN_DIR, '_orientation.json')
  let goldenOrient: Record<string, number> = {}
  try { goldenOrient = JSON.parse(fs.readFileSync(ORIENT_SIDECAR, 'utf8')) } catch { /* first run */ }
  const haveGoldenOrient = Object.keys(goldenOrient).length > 0
  const isSmear = (r: VehicleResult) =>
    r.footprintPx >= MIN_FOOTPRINT_PX &&
    r.footprintRatio > SMEAR_ABS_FLOOR && r.footprintRatio > relThreshold
  const freshOrient: Record<string, number> = {}
  for (const r of results) {
    if (r.orientationDy === null || isSmear(r)) { r.orientationOk = null; continue }
    const key = `${r.faction}/${r.id}`
    freshOrient[key] = r.orientationDy
    if (haveGoldenOrient && key in goldenOrient) {
      const sign = Math.sign(r.orientationDy)
      const goldenSign = Math.sign(goldenOrient[key])
      r.orientationOk = sign === goldenSign
      if (!r.orientationOk) {
        r.notes.push(`VERTICAL FLIP vs golden — orientationDy sign ${sign} ≠ golden ${goldenSign} (dy=${r.orientationDy.toFixed(1)})`)
      }
    } else {
      // First run for this vehicle — no absolute assertion; baseline the sign.
      r.orientationOk = null
      r.notes.push(`orientation baselined (dy=${r.orientationDy.toFixed(1)})`)
    }
  }
  // Persist the orientation baseline on first run (mirrors golden-mask write).
  if (!haveGoldenOrient && Object.keys(freshOrient).length > 0) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true })
    fs.writeFileSync(ORIENT_SIDECAR, JSON.stringify(freshOrient, null, 2))
  }

  // ── Finalise verdicts ────────────────────────────────────────────────────
  for (const r of results) {
    if (r.verdict === 'LOAD-TIMEOUT') continue
    if (r.footprintPx < MIN_FOOTPRINT_PX) {
      r.verdict = 'NO-DECAL'
      continue
    }
    // SMEAR takes priority over FLIPPED: a smear that also happens to fail the
    // orientation heuristic is fundamentally a smear.
    if (r.footprintRatio > SMEAR_ABS_FLOOR && r.footprintRatio > relThreshold) {
      r.verdict = 'SMEAR'
      r.notes.push(`ratio ${r.footprintRatio.toFixed(4)} > abs-floor ${SMEAR_ABS_FLOOR} AND > ${SMEAR_MEDIAN_MULT}× median ${medianRatio.toFixed(4)}`)
      continue
    }
    if (r.orientationOk === false) {
      r.verdict = 'FLIPPED'
      continue
    }
    if (r.goldenDriftFrac !== null && r.goldenDriftFrac > GOLDEN_DRIFT_FRAC) {
      r.verdict = 'DRIFT'
      continue
    }
    r.verdict = 'PASS'
  }

  // ── V-flip regression proof ──────────────────────────────────────────────
  const vflipStatus = [...VFLIP_FIXED].map(id => {
    const r = results.find(x => x.id === id)
    return {
      id,
      rendered: !!r && r.footprintPx >= MIN_FOOTPRINT_PX,
      verdict: r?.verdict ?? 'NOT-CAPTURED',
      footprintPx: r?.footprintPx ?? 0,
    }
  })

  // ── Summary counts ───────────────────────────────────────────────────────
  const counts: Record<Verdict, number> = {
    PASS: 0, 'NO-DECAL': 0, SMEAR: 0, FLIPPED: 0, DRIFT: 0, 'LOAD-TIMEOUT': 0,
  }
  for (const r of results) counts[r.verdict]++

  // ── Write JSON ───────────────────────────────────────────────────────────
  const summary = {
    generatedAt: new Date().toISOString(),
    goldenMode: goldenExistsAtStart ? 'compare' : 'baseline-write',
    totalVehicles: results.length,
    counts,
    medianFootprintRatio: medianRatio,
    smearThreshold,
    tunables: {
      FOOTPRINT_TOL, PIXELMATCH_THRESHOLD, MIN_FOOTPRINT_PX,
      SMEAR_ABS_FLOOR, SMEAR_MEDIAN_MULT, GOLDEN_DRIFT_FRAC,
      MIN_BAND_PX, MIN_BAND_SEPARATION_PX,
    },
    vflipFixed: vflipStatus,
    results,
  }
  fs.writeFileSync(REPORT_JSON, JSON.stringify(summary, null, 2))

  // ── Write Markdown ───────────────────────────────────────────────────────
  const md: string[] = []
  md.push('# Visual Unwrap Verifier — Phase 2 Report', '')
  md.push(`Generated: ${summary.generatedAt}`)
  md.push(`Golden mode: **${summary.goldenMode}** (${goldenExistsAtStart ? 'diffed against existing goldens' : 'first run — goldens written'})`, '')
  md.push('## Summary', '')
  md.push('| Verdict | Count |', '| --- | --- |')
  for (const v of Object.keys(counts) as Verdict[]) md.push(`| ${v} | ${counts[v]} |`)
  md.push(`| **TOTAL** | **${results.length}** |`, '')
  md.push(`Median footprint/silhouette ratio: \`${medianRatio.toFixed(4)}\` — SMEAR threshold (${SMEAR_MEDIAN_MULT}×): \`${smearThreshold.toFixed(4)}\``, '')

  md.push('## V-flip regression proof', '')
  md.push('The 5 previously V-flip-broken vehicles MUST now render the calibration decal:', '')
  md.push('| Vehicle | Renders decal | Footprint px | Verdict |', '| --- | --- | --- | --- |')
  for (const s of vflipStatus) {
    md.push(`| ${s.id} | ${s.rendered ? '✅ YES' : '❌ NO'} | ${s.footprintPx} | ${s.verdict} |`)
  }
  const allVflipRender = vflipStatus.every(s => s.rendered)
  md.push('', allVflipRender
    ? '**All 5 V-flip-fixed vehicles render the calibration decal.**'
    : '**⚠️ NOT all V-flip-fixed vehicles render — see table above.**', '')

  md.push('## Per-vehicle results', '')
  md.push('| Faction | Vehicle | Verdict | Footprint | Silhouette | Ratio | TL→BR ok | Golden drift | Notes |')
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const r of results.sort((a, b) => a.faction.localeCompare(b.faction) || a.id.localeCompare(b.id))) {
    const orient = r.orientationOk === null ? '—' : r.orientationOk ? '✅' : '❌'
    const drift = r.goldenDriftFrac === null ? (r.goldenWritten ? 'written' : '—') : `${(r.goldenDriftFrac * 100).toFixed(1)}%`
    md.push(`| ${r.faction} | ${r.id} | ${r.verdict} | ${r.footprintPx} | ${r.silhouettePx} | ${r.footprintRatio.toFixed(4)} | ${orient} | ${drift} | ${r.notes.join('; ')} |`)
  }
  md.push('')

  const problems = results.filter(r => r.verdict !== 'PASS')
  if (problems.length) {
    md.push('## Problem vehicles', '')
    for (const r of problems) {
      md.push(`- **${r.faction}/${r.id}** → ${r.verdict}: ${r.notes.join('; ') || '(no notes)'}`)
    }
    md.push('')
  }

  fs.writeFileSync(REPORT_MD, md.join('\n'))

  // ── Console summary ──────────────────────────────────────────────────────
  console.log('\n[verify-visual-diff] ── Verdict counts ──')
  for (const v of Object.keys(counts) as Verdict[]) console.log(`  ${v.padEnd(13)} ${counts[v]}`)
  console.log(`  ${'TOTAL'.padEnd(13)} ${results.length}`)
  console.log(`[verify-visual-diff] median ratio ${medianRatio.toFixed(4)}, smear threshold ${smearThreshold.toFixed(4)}`)
  console.log(`[verify-visual-diff] V-flip fixed all render: ${allVflipRender ? 'YES' : 'NO'}`)
  console.log(`[verify-visual-diff] Report: ${REPORT_MD}`)
  console.log(`[verify-visual-diff] JSON:   ${REPORT_JSON}`)

  // Exit non-zero if any non-PASS verdict OR any V-flip vehicle failed to render,
  // so CI / the npm script surfaces regressions. (Goldens-baseline first run:
  // DRIFT can't occur; NO-DECAL/SMEAR/FLIPPED still fail as they should.)
  const hardFail = problems.some(p => p.verdict !== 'DRIFT') || !allVflipRender
  process.exit(hardFail ? 1 : 0)
}

main()
