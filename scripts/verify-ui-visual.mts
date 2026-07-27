/**
 * UI VISUAL REGRESSION — compare captured screens against committed baselines.
 *
 * THE GAP THIS FILLS. `electron/ui-capture.ts` already drives all 20 UI states
 * and writes a PNG per state via Electron's `capturePage` (a real GPU
 * composite, and critically the only capture route on this machine that
 * reproduces colour correctly — see below). But nothing ever COMPARED those
 * PNGs across builds. They were eyeball-only, so any UI change could silently
 * break any of the 20 screens and no instrument would report it. That is the
 * same class of defect as a test that cannot fail.
 *
 * WHY NOT PLAYWRIGHT'S toHaveScreenshot: it would mean re-implementing the
 * navigation to all 20 states, which ui-capture.ts already does. Reusing the
 * existing harness keeps one source of truth for "how do I reach this screen".
 *
 * WHY NOT `import`/xdotool CAPTURES: captures taken through the nested KWin
 * session come out ~2x darker (measured: mean luminance 28 vs 51) because
 * colour management is not negotiated there. A brightness regression would be
 * invisible and a false one easy to invent. capturePage is the correct
 * instrument for anything about colour.
 *
 * THE 3D VIEWPORT IS NONDETERMINISTIC. Screens containing the Three.js canvas
 * differ run to run (GPU scheduling, animation phase, texture upload order).
 * They are compared with a loose gate that catches gross breakage — a blank or
 * black viewport — without flapping on normal jitter. Pure-chrome screens are
 * held to a strict gate.
 *
 * usage:
 *   npx tsx --tsconfig tsconfig.node.json scripts/verify-ui-visual.mts            # compare
 *   npx tsx --tsconfig tsconfig.node.json scripts/verify-ui-visual.mts --update   # re-baseline
 *
 * Capture first:  UI_CAPTURE=1 npx electron .
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from 'canvas'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAPTURED = path.join(ROOT, 'artifacts', 'redesign-v2', 'ui-verify')
// Baselines live OUTSIDE artifacts/ because .gitignore excludes artifacts/**/*.png
// — a baseline that cannot be committed is not a baseline.
const BASELINE = path.join(ROOT, 'e2e', 'ui-baselines')
const DIFF_DIR = path.join(ROOT, 'artifacts', 'ui-visual-diff')

/** Screens whose content includes the live Three.js canvas. */
const HAS_3D = new Set([
  'skin-editor', 'skin-camo-panel', 'skin-decals-panel', 'skin-scene-panel',
  'skin-template-pill', 'skin-decalpack-pill', 'decal-3d-preview',
  'texture-editor', 'texture-split',
])

/** Fraction of pixels allowed to differ beyond PIXEL_TOL. */
const GATE_CHROME = 0.002 // 0.2% — deterministic UI; a real change trips this
const GATE_3D = 0.35 // 35% — GPU jitter is large; this still catches a blank viewport
/** Per-channel difference below which two pixels count as equal (anti-aliasing). */
const PIXEL_TOL = 12

const UPDATE = process.argv.includes('--update')

/**
 * Comparison width. Both sides are normalised to this before diffing, and
 * baselines are STORED at it.
 *
 * Full-resolution baselines were 8 MB for 20 screens, and git keeps every
 * re-baseline forever — in a repo whose .git is already ~100 MB and which
 * tracks 108 binary fixtures, that is a clock. 800 px keeps a 0.2% gate
 * comfortably sensitive (the negative-control regression measured 0.49%) while
 * cutting storage ~4x, and downsampling also absorbs sub-pixel anti-aliasing
 * jitter that would otherwise cause false positives.
 */
const COMPARE_W = 800

async function pixels(fp: string) {
  const img = await loadImage(fp)
  const ow = img.width as number
  const oh = img.height as number
  const w = Math.min(COMPARE_W, ow)
  const h = Math.round((oh * w) / ow)
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.drawImage(img as never, 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h).data, w, h }
}

/** Write a screen to the baseline dir at COMPARE_W. */
async function writeBaseline(src: string, dest: string) {
  const img = await loadImage(src)
  const ow = img.width as number
  const oh = img.height as number
  const w = Math.min(COMPARE_W, ow)
  const h = Math.round((oh * w) / ow)
  const c = createCanvas(w, h)
  c.getContext('2d').drawImage(img as never, 0, 0, w, h)
  fs.writeFileSync(dest, c.toBuffer('image/png'))
}

/** Fraction of differing pixels, plus a diff image highlighting them. */
async function compare(aPath: string, bPath: string, outPath: string) {
  const a = await pixels(aPath)
  const b = await pixels(bPath)
  if (a.w !== b.w || a.h !== b.h) {
    return { differing: 1, note: `size ${a.w}x${a.h} vs ${b.w}x${b.h}` }
  }
  const c = createCanvas(a.w, a.h)
  const ctx = c.getContext('2d')
  const out = ctx.createImageData(a.w, a.h)
  let differing = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2])
    if (d > PIXEL_TOL) {
      differing++
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 255; out.data[i + 3] = 255
    } else {
      const g = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 6 + 40
      out.data[i] = out.data[i + 1] = out.data[i + 2] = g
      out.data[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, c.toBuffer('image/png'))
  return { differing: differing / (a.w * a.h), note: '' }
}

async function main() {
  if (!fs.existsSync(CAPTURED)) {
    console.error(`[ui-visual] no captures at ${CAPTURED}`)
    console.error('  run:  UI_CAPTURE=1 npx electron .')
    process.exit(2)
  }
  const shots = fs.readdirSync(CAPTURED).filter(f => f.endsWith('.png')).sort()
  if (!shots.length) { console.error('[ui-visual] no PNGs captured'); process.exit(2) }

  fs.mkdirSync(BASELINE, { recursive: true })

  if (UPDATE) {
    for (const s of shots) await writeBaseline(path.join(CAPTURED, s), path.join(BASELINE, s))
    console.log(`[ui-visual] re-baselined ${shots.length} screens -> ${path.relative(ROOT, BASELINE)}`)
    console.log('  REVIEW THE DIFF BEFORE COMMITTING — re-baselining hides regressions.')
    return
  }

  let failed = 0, missing = 0
  console.log(`[ui-visual] comparing ${shots.length} screens`)
  for (const s of shots) {
    const base = path.join(BASELINE, s)
    if (!fs.existsSync(base)) {
      console.log(`  NEW   ${s}  (no baseline — run with --update to accept)`)
      missing++
      continue
    }
    const is3d = HAS_3D.has(path.basename(s, '.png'))
    const gate = is3d ? GATE_3D : GATE_CHROME
    const { differing, note } = await compare(base, path.join(CAPTURED, s), path.join(DIFF_DIR, s))
    const pct = (differing * 100).toFixed(3)
    if (differing > gate) {
      console.log(`  FAIL  ${s.padEnd(26)} ${pct}% differ (gate ${(gate * 100).toFixed(1)}%${is3d ? ', 3D' : ''}) ${note}`)
      failed++
    } else {
      console.log(`  ok    ${s.padEnd(26)} ${pct}%${is3d ? ' (3D)' : ''}`)
    }
  }

  console.log()
  if (failed) {
    console.log(`[ui-visual] ${failed} screen(s) changed. Diffs (magenta = changed): ${path.relative(ROOT, DIFF_DIR)}`)
    console.log('  If the change is intended: re-run with --update, then eyeball the diffs before committing.')
    process.exit(1)
  }
  console.log(`[ui-visual] all screens match${missing ? ` (${missing} new, unbaselined)` : ''}.`)
}

main().catch(e => { console.error(e); process.exit(2) })
