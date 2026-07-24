/**
 * scripts/verify-faceplate.mts
 *
 * Phase 3 (A) — Faceplate export round-trip verification.
 *
 * The faceplate export pipeline composites a 692×204 atlas (624×204 banner +
 * 64×64 icon sub-rect) and encodes it as BC3/DXT5 inside a 128-byte DDS
 * container — a LOSSY step. This script verifies that the lossy round-trip
 * stays within a sane tolerance and that the encoded output has the exact
 * dimensions/format the CoH2 engine requires.
 *
 * Pipeline (headless, pure Node — no Electron/GPU):
 *   1. Composite a representative faceplate atlas (image + text + shape layers)
 *      into an RGBA buffer via node-canvas (same JSDOM+canvas bootstrap the
 *      headless faceplate builder scripts/build-honved-faceplate.mts uses).
 *   2. Encode EXACTLY as the export path does:
 *        encodeBc3(atlasRgba, W, H)  →  wrapBc3InDds(bc3, W, H)
 *      (the identical calls buildFaceplateMod() makes in src/lib/faceplate-mod-build.ts).
 *   3. Decode the BC3 payload back with the app's own decoder decodeBc3().
 *   4. Per-pixel, per-channel compare decoded RGBA vs the pre-encode composite.
 *      Report max & mean per-channel delta. Report both including and excluding
 *      compression-block-edge pixels (blocks that straddle a hard colour edge
 *      carry almost all BC loss — a 4×4 block with two very different colours
 *      cannot be represented exactly by min-max endpoints).
 *   5. Validate the DDS header: magic 'DDS ', width, height, FOURCC 'DXT5',
 *      linearSize == BC3 byte count, payload length == blocks×16.
 *
 * PASS criteria (justification):
 *   The app's own BC3 encoder is documented as min-max (not least-squares);
 *   src/lib/__tests__/bc-encode.test.ts uses a ±32/channel per-pixel tolerance
 *   for solid-colour round-trips. Real content is mostly smooth regions with a
 *   few hard text/shape edges, so the AGGREGATE error is far smaller than the
 *   worst single pixel. We require:
 *     - mean per-channel delta ≤ 4/255   (whole atlas, incl. edges)
 *     - max per-channel delta  ≤ 48/255  (excluding block-edge pixels)
 *   plus DDS dimensions/format exactly correct. These thresholds are strict on
 *   the average (proves the bulk of the image is near-lossless) while allowing
 *   the handful of high-contrast block edges their intrinsic BC ceiling.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.node.json scripts/verify-faceplate.mts
 *
 * Outputs:
 *   artifacts/verify-unwrap/faceplate-report.md
 *   artifacts/verify-unwrap/faceplate-results.json
 */

import { createCanvas } from 'canvas'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── JSDOM bootstrap (so @/lib/* can reference HTMLCanvasElement etc.) ─────────
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as Record<string, unknown>).document = dom.window.document
;(globalThis as Record<string, unknown>).HTMLCanvasElement = dom.window.HTMLCanvasElement
;(globalThis as Record<string, unknown>).ImageData = dom.window.ImageData
;(globalThis as Record<string, unknown>).File = dom.window.File
const origCreateElement = dom.window.document.createElement.bind(dom.window.document)
;(dom.window.document as unknown as Record<string, unknown>).createElement = (tag: string, ...args: unknown[]) => {
  if (tag === 'canvas') return createCanvas(256, 256) as unknown as HTMLCanvasElement
  return origCreateElement(tag as keyof HTMLElementTagNameMap, ...(args as [ElementCreationOptions?]))
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')
const OUT_DIR = path.join(ROOT, 'artifacts', 'verify-unwrap')

// ─── Pull the REAL export encoder + wrapper + atlas constants + decoder ───────
// Resolve via explicit absolute .ts paths (same pattern as the analytical
// script) — tsx doesn't resolve the vite `@/` alias for these dynamic imports.
const { encodeBc3 } = await import(`${SRC_LIB}/bc-encode.ts`)
const { decodeBc3 } = await import(`${SRC_LIB}/bc-decode.ts`)
const { wrapBc3InDds } = await import(`${SRC_LIB}/faceplate-mod-build.ts`)
const { ATLAS_WIDTH, ATLAS_HEIGHT, BANNER_RECT, ICON_RECT } = await import(`${SRC_LIB}/faceplate-templates.ts`)

// ─── Thresholds (see header for justification) ────────────────────────────────
const MEAN_THRESHOLD = 4 // per-channel mean delta, /255, whole atlas
const MAX_THRESHOLD = 48 // per-channel max delta, /255, excluding block edges

// ─── Composite a representative faceplate atlas ───────────────────────────────
// We construct a project with the three layer kinds the editor supports —
// image (a synthetic photographic-style gradient/noise fill), text, and shape —
// so the round-trip exercises smooth regions, hard-edged glyphs, and geometric
// primitives (the content that stresses a block compressor the hardest).
function compositeAtlas(): { rgba: Uint8ClampedArray; layerSummary: string[] } {
  const canvas = createCanvas(ATLAS_WIDTH, ATLAS_HEIGHT)
  const ctx = canvas.getContext('2d')
  const summary: string[] = []

  const BW = BANNER_RECT.width // 624
  const BH = BANNER_RECT.height // 204

  // ── IMAGE LAYER: a smooth diagonal gradient + subtle procedural noise, the
  //    kind of photographic/painterly fill an image layer carries. Smooth
  //    gradients are where a good round-trip must be near-lossless. ──────────
  const grad = ctx.createLinearGradient(0, 0, BW, BH)
  grad.addColorStop(0, '#12324f')
  grad.addColorStop(0.5, '#2a5d7a')
  grad.addColorStop(1, '#0d1b26')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, BW, BH)
  // Fine deterministic dither so it's not a perfectly flat gradient.
  const img = ctx.getImageData(0, 0, BW, BH)
  const d = img.data
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      const i = (y * BW + x) * 4
      const n = ((x * 131 + y * 977) % 17) - 8 // −8..+8 deterministic
      d[i] = Math.max(0, Math.min(255, d[i] + n))
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
    }
  }
  ctx.putImageData(img, 0, 0)
  summary.push('image layer: diagonal gradient + procedural dither (624×204 smooth fill)')

  // ── SHAPE LAYER: a bright bordered rounded rectangle + a filled circle.
  //    Hard geometric edges — the classic BC block-edge stress case. ────────
  ctx.strokeStyle = '#ffcf40'
  ctx.lineWidth = 6
  ctx.strokeRect(24, 24, BW - 48, BH - 48)
  ctx.beginPath()
  ctx.arc(Math.round(BW * 0.12), Math.round(BH / 2), 42, 0, Math.PI * 2)
  ctx.fillStyle = '#c0392b'
  ctx.fill()
  summary.push('shape layer: bordered rectangle + filled circle (hard edges)')

  // ── TEXT LAYER: large banner glyphs + a subtitle, with accents so the
  //    glyph coverage is dense. High-contrast anti-aliased text edges. ──────
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2
  ctx.font = `bold ${Math.round(BH * 0.5)}px "DejaVu Sans", "Liberation Sans", Arial, sans-serif`
  ctx.fillText('FACEPLATE', Math.round(BW * 0.58), Math.round(BH * 0.42))
  ctx.font = `${Math.round(BH * 0.13)}px "DejaVu Sans", "Liberation Sans", Arial, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText('ROUND-TRIP VERIFICATION · ÉÁŰ', Math.round(BW * 0.58), Math.round(BH * 0.78))
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  summary.push('text layer: "FACEPLATE" banner + accented subtitle (AA glyph edges)')

  // ── ICON SUB-RECT (64×64 at x=624): a small themed emblem. ───────────────
  const IX = ICON_RECT.x
  const IY = ICON_RECT.y
  const ISZ = ICON_RECT.width
  ctx.fillStyle = '#1a1a2d'
  ctx.fillRect(IX, IY, ISZ, ISZ)
  ctx.beginPath()
  ctx.moveTo(IX + ISZ / 2, IY + 8)
  ctx.lineTo(IX + ISZ - 8, IY + ISZ - 8)
  ctx.lineTo(IX + 8, IY + ISZ - 8)
  ctx.closePath()
  ctx.fillStyle = '#ffcf40'
  ctx.fill()
  summary.push('icon sub-rect: emblem triangle on dark field (64×64)')

  const atlasImageData = ctx.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
  return { rgba: new Uint8ClampedArray(atlasImageData.data.buffer.slice(0)), layerSummary: summary }
}

// ─── Block-edge classification ────────────────────────────────────────────────
// A 4×4 BC block is a "hard-edge block" if ANY of its R/G/B channels spans more
// than the threshold within the block. BC3 compresses each 4×4 block with a
// single interpolated colour line, so a block whose content crosses a hard
// colour edge (white glyph on dark ground, a saturated border stripe, etc.)
// cannot be represented exactly — that intrinsic BC ceiling is what we exclude
// from the MAX check (edge blocks are still counted in the whole-atlas mean).
// We classify PER CHANNEL (not luminance) because chroma edges — e.g. a bright
// yellow border on a dark field — carry large BC error while luminance moves
// only moderately.
const BLOCK_SPAN_THRESHOLD = 64 // per-channel spread within one 4×4 block
function isHardEdgeBlock(orig: Uint8ClampedArray, bx: number, by: number, w: number, h: number): boolean {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0
  for (let py = 0; py < 4; py++) {
    const sy = Math.min(by * 4 + py, h - 1)
    for (let px = 0; px < 4; px++) {
      const sx = Math.min(bx * 4 + px, w - 1)
      const i = (sy * w + sx) * 4
      if (orig[i] < rMin) rMin = orig[i]
      if (orig[i] > rMax) rMax = orig[i]
      if (orig[i + 1] < gMin) gMin = orig[i + 1]
      if (orig[i + 1] > gMax) gMax = orig[i + 1]
      if (orig[i + 2] < bMin) bMin = orig[i + 2]
      if (orig[i + 2] > bMax) bMax = orig[i + 2]
    }
  }
  const maxSpan = Math.max(rMax - rMin, gMax - gMin, bMax - bMin)
  return maxSpan > BLOCK_SPAN_THRESHOLD
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Faceplate export round-trip verification ===')
  console.log(`Atlas: ${ATLAS_WIDTH}×${ATLAS_HEIGHT} (banner ${BANNER_RECT.width}×${BANNER_RECT.height} + icon ${ICON_RECT.width}×${ICON_RECT.height})`)

  // 1. Composite
  const { rgba: orig, layerSummary } = compositeAtlas()
  console.log('\nComposited layers:')
  for (const l of layerSummary) console.log(`  - ${l}`)

  // 2. Encode EXACTLY as export does
  const bc3 = encodeBc3(orig, ATLAS_WIDTH, ATLAS_HEIGHT)
  const dds = wrapBc3InDds(bc3, ATLAS_WIDTH, ATLAS_HEIGHT)

  // 3. Decode back with the app's own decoder
  const decoded = decodeBc3(bc3, ATLAS_WIDTH, ATLAS_HEIGHT)

  // 4. Per-channel deltas (RGB; alpha is a constant 255 here so it's noise-free)
  const W = ATLAS_WIDTH
  const H = ATLAS_HEIGHT
  const blocksW = Math.ceil(W / 4)
  const blocksH = Math.ceil(H / 4)

  let sumAll = 0
  let countAll = 0
  let maxAll = 0
  let sumNonEdge = 0
  let countNonEdge = 0
  let maxNonEdge = 0
  let hardEdgeBlocks = 0

  // Precompute per-block hard-edge flags.
  const edgeFlag = new Uint8Array(blocksW * blocksH)
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      const hard = isHardEdgeBlock(orig, bx, by, W, H)
      edgeFlag[by * blocksW + bx] = hard ? 1 : 0
      if (hard) hardEdgeBlocks++
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const bIdx = Math.floor(y / 4) * blocksW + Math.floor(x / 4)
      const isEdge = edgeFlag[bIdx] === 1
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(orig[i + c] - decoded[i + c])
        sumAll += delta
        countAll++
        if (delta > maxAll) maxAll = delta
        if (!isEdge) {
          sumNonEdge += delta
          countNonEdge++
          if (delta > maxNonEdge) maxNonEdge = delta
        }
      }
    }
  }

  const meanAll = sumAll / countAll
  const meanNonEdge = countNonEdge ? sumNonEdge / countNonEdge : 0

  // 5. DDS header / format validation
  const dv = new DataView(dds.buffer, dds.byteOffset, dds.byteLength)
  const magic = String.fromCharCode(dds[0], dds[1], dds[2], dds[3])
  const ddsHeight = dv.getUint32(12, true)
  const ddsWidth = dv.getUint32(16, true)
  const linearSize = dv.getUint32(20, true)
  const fourCC = String.fromCharCode(dds[84], dds[85], dds[86], dds[87])
  const expectedBc3Len = blocksW * blocksH * 16
  const payloadLen = dds.length - 128

  const ddsChecks = {
    magicOk: magic === 'DDS ',
    widthOk: ddsWidth === ATLAS_WIDTH,
    heightOk: ddsHeight === ATLAS_HEIGHT,
    fourCCOk: fourCC === 'DXT5',
    linearSizeOk: linearSize === bc3.length,
    payloadLenOk: payloadLen === expectedBc3Len && bc3.length === expectedBc3Len,
  }
  const ddsAllOk = Object.values(ddsChecks).every(Boolean)

  // ── Verdict ──
  const meanOk = meanAll <= MEAN_THRESHOLD
  const maxOk = maxNonEdge <= MAX_THRESHOLD
  const pass = meanOk && maxOk && ddsAllOk

  const results = {
    generatedAt: new Date().toISOString(),
    pipeline: 'headless: node-canvas composite → encodeBc3 → wrapBc3InDds → decodeBc3',
    atlas: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, bannerRect: BANNER_RECT, iconRect: ICON_RECT },
    layers: layerSummary,
    thresholds: { meanPerChannel: MEAN_THRESHOLD, maxPerChannelExclEdges: MAX_THRESHOLD },
    deltas: {
      meanPerChannelAll: +meanAll.toFixed(4),
      maxPerChannelAll: maxAll,
      meanPerChannelNonEdge: +meanNonEdge.toFixed(4),
      maxPerChannelNonEdge: maxNonEdge,
    },
    blocks: {
      total: blocksW * blocksH,
      hardEdge: hardEdgeBlocks,
      hardEdgePct: +((hardEdgeBlocks / (blocksW * blocksH)) * 100).toFixed(2),
    },
    dds: {
      totalBytes: dds.length,
      headerBytes: 128,
      payloadBytes: payloadLen,
      magic,
      width: ddsWidth,
      height: ddsHeight,
      fourCC,
      linearSize,
      expectedBc3Len,
      checks: ddsChecks,
      allOk: ddsAllOk,
    },
    checks: { meanOk, maxOk, ddsAllOk },
    verdict: pass ? 'PASS' : 'FAIL',
    limitation:
      'Pure-JS pipeline: the export encoder (encodeBc3) and container wrapper ' +
      '(wrapBc3InDds) run headlessly — this exercises the ACTUAL export code, ' +
      'not a reimplementation. No native/binary encoder is involved, so the ' +
      'round-trip is complete with no unverified stages.',
  }

  // ── Write JSON + Markdown ──
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, 'faceplate-results.json'), JSON.stringify(results, null, 2))

  const md: string[] = []
  md.push('# Faceplate Export Round-Trip Verification')
  md.push('')
  md.push(`_Generated ${results.generatedAt}_`)
  md.push('')
  md.push(`**Verdict: ${results.verdict}**`)
  md.push('')
  md.push('Pure-Node round-trip of the faceplate export pipeline. Composites a')
  md.push('representative atlas (image + text + shape layers), encodes it with the')
  md.push('**actual export code** (`encodeBc3` + `wrapBc3InDds` from')
  md.push('`src/lib/faceplate-mod-build.ts`), decodes it back with the app decoder')
  md.push('(`decodeBc3`), and compares per pixel.')
  md.push('')
  md.push('## Atlas')
  md.push('')
  md.push(`- Size: **${ATLAS_WIDTH}×${ATLAS_HEIGHT}** (banner ${BANNER_RECT.width}×${BANNER_RECT.height} + icon ${ICON_RECT.width}×${ICON_RECT.height})`)
  md.push('- Composited layers:')
  for (const l of layerSummary) md.push(`  - ${l}`)
  md.push('')
  md.push('## Per-channel deltas (RGB)')
  md.push('')
  md.push('| Metric | Value (/255) | Threshold | OK |')
  md.push('|---|---|---|---|')
  md.push(`| Mean (whole atlas, incl. edges) | ${meanAll.toFixed(4)} | ≤ ${MEAN_THRESHOLD} | ${meanOk ? 'YES' : 'NO'} |`)
  md.push(`| Max (whole atlas, incl. edges) | ${maxAll} | — | — |`)
  md.push(`| Mean (excluding block edges) | ${meanNonEdge.toFixed(4)} | — | — |`)
  md.push(`| Max (excluding block edges) | ${maxNonEdge} | ≤ ${MAX_THRESHOLD} | ${maxOk ? 'YES' : 'NO'} |`)
  md.push('')
  md.push(`Block-edge blocks (any R/G/B channel spanning > ${BLOCK_SPAN_THRESHOLD} within a 4×4 block): **${hardEdgeBlocks} / ${blocksW * blocksH}** (${results.blocks.hardEdgePct}%). These carry the intrinsic BC min-max ceiling and are excluded from the MAX check but still counted in the whole-atlas mean.`)
  md.push('')
  md.push('## DDS container / format')
  md.push('')
  md.push('| Field | Value | Expected | OK |')
  md.push('|---|---|---|---|')
  md.push(`| magic | \`${magic}\` | \`DDS \` | ${ddsChecks.magicOk ? 'YES' : 'NO'} |`)
  md.push(`| width | ${ddsWidth} | ${ATLAS_WIDTH} | ${ddsChecks.widthOk ? 'YES' : 'NO'} |`)
  md.push(`| height | ${ddsHeight} | ${ATLAS_HEIGHT} | ${ddsChecks.heightOk ? 'YES' : 'NO'} |`)
  md.push(`| fourCC | \`${fourCC}\` | \`DXT5\` | ${ddsChecks.fourCCOk ? 'YES' : 'NO'} |`)
  md.push(`| linearSize | ${linearSize} | ${bc3.length} | ${ddsChecks.linearSizeOk ? 'YES' : 'NO'} |`)
  md.push(`| payload bytes | ${payloadLen} | ${expectedBc3Len} | ${ddsChecks.payloadLenOk ? 'YES' : 'NO'} |`)
  md.push('')
  md.push('## Threshold justification')
  md.push('')
  md.push('The app BC3 encoder is min-max (not least-squares); `bc-encode.test.ts`')
  md.push('uses a ±32/channel tolerance for solid-colour round-trips. Real content')
  md.push('is mostly smooth with a few hard text/shape edges, so the aggregate error')
  md.push('is far below the worst single pixel. We require mean ≤ 4/255 (proves the')
  md.push('bulk is near-lossless) and max ≤ 48/255 excluding block edges (allows the')
  md.push('high-contrast edge blocks their intrinsic BC ceiling).')
  md.push('')
  md.push('## Limitation')
  md.push('')
  md.push(results.limitation)
  md.push('')
  await writeFile(path.join(OUT_DIR, 'faceplate-report.md'), md.join('\n'))

  // ── Console summary ──
  console.log('\n=== SUMMARY ===')
  console.log(`Mean per-channel (all)      : ${meanAll.toFixed(4)}/255  (threshold ≤ ${MEAN_THRESHOLD})  ${meanOk ? 'OK' : 'FAIL'}`)
  console.log(`Max  per-channel (all)      : ${maxAll}/255`)
  console.log(`Mean per-channel (non-edge) : ${meanNonEdge.toFixed(4)}/255`)
  console.log(`Max  per-channel (non-edge) : ${maxNonEdge}/255  (threshold ≤ ${MAX_THRESHOLD})  ${maxOk ? 'OK' : 'FAIL'}`)
  console.log(`Hard-edge blocks            : ${hardEdgeBlocks}/${blocksW * blocksH} (${results.blocks.hardEdgePct}%)`)
  console.log(`DDS format                  : ${ddsAllOk ? 'OK' : 'FAIL'}  (${ddsWidth}×${ddsHeight} ${fourCC}, linearSize ${linearSize})`)
  console.log(`\nVERDICT: ${results.verdict}`)
  console.log('\nArtifacts:')
  console.log(`  ${path.join(OUT_DIR, 'faceplate-report.md')}`)
  console.log(`  ${path.join(OUT_DIR, 'faceplate-results.json')}`)

  if (!pass) process.exitCode = 1
}

await main()
