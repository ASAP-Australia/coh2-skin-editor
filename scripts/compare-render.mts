/**
 * LAYER C — editor-render vs game-render structural comparison.
 *
 * HONEST SCOPE. The game's renderer cannot be byte-matched by Three.js: CoH2's
 * coh2_vehicle shader is a compiled .fxo with its own BRDF, spherical-harmonic
 * ambient (SHLight), env-map IBL, tonemapping and post. So this layer does NOT
 * attempt pixel equality. It answers a narrower, still-useful question:
 *
 *   "Is the RIGHT TEXTURE on the RIGHT VEHICLE in the RIGHT PLACES,
 *    with the right colour relationships?"
 *
 * What it CAN prove:  camo/decal present, correct spatial layout, hue family
 *                     preserved, markings where expected.
 * What it CANNOT prove: shader equality, exact luminance, specular response.
 *
 * Metrics (all scale-normalised, so editor and game captures need not match
 * resolution — only framing):
 *   - SSIM on luminance (structure; robust to global brightness/contrast shift)
 *   - Edge-map IoU (layout / marking placement — the decal test)
 *   - Hue histogram intersection (colour family, ignores lighting intensity)
 *
 * Run: npx tsx scripts/compare-render.mts <editor.png> <game.png> [--json]
 *      npx tsx scripts/compare-render.mts --selftest
 */
import * as fs from 'node:fs'
import { createCanvas, loadImage, type Canvas } from 'canvas'

const N = 256 // common working resolution

type Gray = { d: Float64Array; w: number; h: number }

async function toWorking(p: string): Promise<{ gray: Gray; hue: Float64Array }> {
  const img = await loadImage(p)
  const c = createCanvas(N, N)
  const ctx = c.getContext('2d')
  ctx.drawImage(img as any, 0, 0, N, N)
  const px = ctx.getImageData(0, 0, N, N).data
  const gray = new Float64Array(N * N)
  const hue = new Float64Array(36) // 10° bins
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
    gray[j] = 0.299 * r + 0.587 * g + 0.114 * b
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
    if (d > 0.06 && mx > 0.08) { // ignore near-grey / near-black: no meaningful hue
      let h = 0
      if (mx === r) h = ((g - b) / d) % 6
      else if (mx === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h = ((h * 60) + 360) % 360
      hue[Math.min(35, Math.floor(h / 10))] += 1
    }
  }
  const tot = hue.reduce((a, b) => a + b, 0) || 1
  for (let i = 0; i < hue.length; i++) hue[i] /= tot
  return { gray: { d: gray, w: N, h: N }, hue }
}

/** Global SSIM with 8x8 windows (structure only — brightness/contrast tolerant). */
function ssim(a: Gray, b: Gray): number {
  const C1 = 0.01 ** 2, C2 = 0.03 ** 2, W = 8
  let acc = 0, n = 0
  for (let by = 0; by + W <= a.h; by += W) {
    for (let bx = 0; bx + W <= a.w; bx += W) {
      let ma = 0, mb = 0
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const i = (by + y) * a.w + bx + x
        ma += a.d[i]; mb += b.d[i]
      }
      const cnt = W * W; ma /= cnt; mb /= cnt
      let va = 0, vb = 0, cov = 0
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const i = (by + y) * a.w + bx + x
        const da = a.d[i] - ma, db = b.d[i] - mb
        va += da * da; vb += db * db; cov += da * db
      }
      va /= cnt - 1; vb /= cnt - 1; cov /= cnt - 1
      acc += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
      n++
    }
  }
  return n ? acc / n : 0
}

/** Sobel edge mask at a relative threshold, then IoU. Tests LAYOUT/markings. */
function edgeIoU(a: Gray, b: Gray): number {
  const edges = (g: Gray) => {
    const out = new Float64Array(g.w * g.h)
    let mx = 0
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x
      const gx = g.d[i - 1] - g.d[i + 1], gy = g.d[i - g.w] - g.d[i + g.w]
      const m = Math.hypot(gx, gy); out[i] = m; if (m > mx) mx = m
    }
    const th = mx * 0.25
    const bm = new Uint8Array(g.w * g.h)
    for (let i = 0; i < out.length; i++) bm[i] = out[i] >= th ? 1 : 0
    return bm
  }
  const ea = edges(a), eb = edges(b)
  let inter = 0, uni = 0
  for (let i = 0; i < ea.length; i++) { if (ea[i] || eb[i]) uni++; if (ea[i] && eb[i]) inter++ }
  return uni ? inter / uni : 0
}

const hueIntersection = (a: Float64Array, b: Float64Array) =>
  a.reduce((s, v, i) => s + Math.min(v, b[i]), 0)

/**
 * Thresholds — CALIBRATED AGAINST AN UNRELATED-PAIR BASELINE, not guessed.
 *
 * `--selftest` measures two genuinely unrelated app screenshots. Result:
 *     ssim 0.4716   edgeIoU 0.0125   hue 0.1927
 *
 * That is the floor a metric must clear to mean anything. Note SSIM scores
 * **0.47 on unrelated images** (both are dark, and SSIM rewards that), so an
 * SSIM gate below ~0.5 would pass literally any pair — a test that cannot
 * fail. My first draft used 0.35 and would have done exactly that.
 *
 * Therefore:
 *   - edgeIoU and hue are the LOAD-BEARING gates (unrelated: 0.01 / 0.19).
 *   - SSIM is gated well above its unrelated baseline, and treated as
 *     corroborating rather than decisive.
 * Re-run --selftest if these are ever adjusted.
 */
const GATE = { ssim: 0.60, edgeIoU: 0.20, hue: 0.45 }

async function compare(pa: string, pb: string) {
  const A = await toWorking(pa), B = await toWorking(pb)
  const s = ssim(A.gray, B.gray)
  const e = edgeIoU(A.gray, B.gray)
  const h = hueIntersection(A.hue, B.hue)
  const pass = s >= GATE.ssim && e >= GATE.edgeIoU && h >= GATE.hue
  return { ssim: +s.toFixed(4), edgeIoU: +e.toFixed(4), hue: +h.toFixed(4), pass }
}

async function selftest() {
  // Validate the metrics behave before trusting them on real pairs:
  // identical → ~1; unrelated → clearly lower. A metric that scores everything
  // high is worse than none (the lesson from the camo-mask test suite).
  const shots = 'artifacts/redesign-v2/ui-verify'
  const a = `${shots}/skin-editor.png`
  const b = `${shots}/faceplate-editor.png`
  if (!fs.existsSync(a) || !fs.existsSync(b)) { console.error('selftest needs UI captures'); process.exit(2) }
  const same = await compare(a, a)
  const diff = await compare(a, b)
  console.log('SELFTEST — metric sanity')
  console.log(`  identical pair : ssim ${same.ssim}  edgeIoU ${same.edgeIoU}  hue ${same.hue}  (expect ~1)`)
  console.log(`  unrelated pair : ssim ${diff.ssim}  edgeIoU ${diff.edgeIoU}  hue ${diff.hue}  (expect clearly lower)`)
  const ok = same.ssim > 0.99 && same.edgeIoU > 0.99 && diff.ssim < same.ssim - 0.2 && diff.edgeIoU < same.edgeIoU - 0.2
  console.log(ok ? '  RESULT: metrics discriminate correctly ✓' : '  RESULT: METRICS DO NOT DISCRIMINATE — do not trust them ✗')
  process.exit(ok ? 0 : 1)
}

const args = process.argv.slice(2)
if (args[0] === '--selftest') { selftest() }
else if (args.length >= 2) {
  compare(args[0], args[1]).then(r => {
    if (args.includes('--json')) console.log(JSON.stringify(r, null, 1))
    else {
      console.log(`LAYER C — structural comparison`)
      console.log(`  editor: ${args[0]}`)
      console.log(`  game  : ${args[1]}`)
      console.log(`  SSIM (structure)        ${r.ssim}   gate >= ${GATE.ssim}`)
      console.log(`  edge IoU (layout)       ${r.edgeIoU}   gate >= ${GATE.edgeIoU}`)
      console.log(`  hue intersection        ${r.hue}   gate >= ${GATE.hue}`)
      console.log(`  => ${r.pass ? 'PASS' : 'FAIL'}  (proves texture/layout/colour correspondence, NOT renderer equality)`)
    }
    process.exit(r.pass ? 0 : 1)
  })
} else {
  console.error('usage: compare-render.mts <editor.png> <game.png> [--json] | --selftest')
  process.exit(2)
}
