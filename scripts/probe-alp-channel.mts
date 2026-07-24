/**
 * probe-alp-channel.mts — READ-ONLY investigation of CoH2's `_alp` vehicle
 * texture channel. Decodes a representative sample of `*_alp.rgt` files from the
 * game's Art SGAs, plus the sibling `_dif` and `_spc` for spatial cross-check,
 * and reports dims / channel makeup / histogram / correlation. Writes decoded
 * PNGs + a JSON summary under artifacts/alp-probe/.
 *
 * Uses the repo's own decoders (src/lib/sga, src/lib/rgt, src/lib/bc-decode) so
 * the pixels match exactly what the editor would see.
 *
 * Run: npx tsx scripts/probe-alp-channel.mts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCanvas } from 'canvas'
import { SgaArchive } from '../src/lib/sga'
import { decodeRgt } from '../src/lib/rgt'
import { decodeBc1, decodeBc3 } from '../src/lib/bc-decode'

const ARCH = '/var/home/jflessenkemper/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
const OUT = 'artifacts/alp-probe'
fs.mkdirSync(OUT, { recursive: true })

function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => ({
    arrayBuffer: async () => {
      const len = (e ?? st.size) - s
      const b = Buffer.alloc(Math.max(0, len))
      if (len > 0) fs.readSync(fd, b, 0, len, s)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
    },
  } as Blob)
  return { name: path.basename(fp), size: st.size, slice } as unknown as File
}

function toRgba(bytes: Uint8Array) {
  const rgt = decodeRgt(bytes)
  const rgba = rgt.fourCC === 'DXT1'
    ? decodeBc1(rgt.pixels, rgt.width, rgt.height)
    : decodeBc3(rgt.pixels, rgt.width, rgt.height)
  return { rgt, rgba }
}

function writePng(name: string, rgba: Uint8ClampedArray, w: number, h: number) {
  const cv = createCanvas(w, h); const ctx = cv.getContext('2d')
  const id = ctx.createImageData(w, h); id.data.set(rgba); ctx.putImageData(id, 0, 0)
  fs.writeFileSync(path.join(OUT, name), cv.toBuffer('image/png'))
}

/** 16-bucket histogram of a single channel (0=R,1=G,2=B,3=A). */
function hist(rgba: Uint8ClampedArray, ch: number) {
  const buckets = new Array(16).fill(0)
  let min = 255, max = 0, sum = 0, n = 0
  for (let i = ch; i < rgba.length; i += 4) {
    const v = rgba[i]
    buckets[Math.min(15, v >> 4)]++
    if (v < min) min = v; if (v > max) max = v
    sum += v; n++
  }
  return { buckets, min, max, mean: +(sum / n).toFixed(1), n }
}

/** How many channels actually vary, and whether R==G==B everywhere (grayscale). */
function channelStats(rgba: Uint8ClampedArray) {
  let grayscale = true, aVaries = false, rgbVaries = false
  let a0 = rgba[3]
  const r0 = rgba[0], g0 = rgba[1], b0 = rgba[2]
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3]
    if (r !== g || g !== b) grayscale = false
    if (a !== a0) aVaries = true
    if (r !== r0 || g !== g0 || b !== b0) rgbVaries = true
  }
  return { grayscale, aVaries, rgbVaries }
}

/** Fraction of pixels that are near-binary (within tol of 0 or 255) on a channel. */
function binaryFraction(rgba: Uint8ClampedArray, ch: number, tol = 12) {
  let bin = 0, n = 0
  for (let i = ch; i < rgba.length; i += 4) {
    const v = rgba[i]
    if (v <= tol || v >= 255 - tol) bin++
    n++
  }
  return +(bin / n).toFixed(3)
}

/**
 * Pearson correlation between the _alp luminance and a comparison signal
 * (e.g. _dif luminance, or _spc luminance), resampled by nearest-neighbour to
 * a common grid. Positive → alp bright where comparison bright.
 */
function correlate(
  a: Uint8ClampedArray, aw: number, ah: number, achan: number,
  b: Uint8ClampedArray, bw: number, bh: number, bchan: number,
  grid = 128,
) {
  const sampleLum = (rgba: Uint8ClampedArray, w: number, h: number, chan: number, gx: number, gy: number) => {
    const x = Math.min(w - 1, Math.floor((gx / grid) * w))
    const y = Math.min(h - 1, Math.floor((gy / grid) * h))
    const i = (y * w + x) * 4
    if (chan >= 0) return rgba[i + chan]
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  }
  const xs: number[] = [], ys: number[] = []
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    xs.push(sampleLum(a, aw, ah, achan, gx, gy))
    ys.push(sampleLum(b, bw, bh, bchan, gx, gy))
  }
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const a2 = xs[i] - mx, b2 = ys[i] - my
    num += a2 * b2; dx += a2 * a2; dy += b2 * b2
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? 0 : +(num / den).toFixed(3)
}

// Representative sample: hulls, turrets, a halftrack, across factions.
// Each entry: label, sga candidates, path-substring matcher for the vehicle.
const TARGETS: { label: string; sgas: string[]; match: RegExp }[] = [
  { label: 'tiger_hull',        sgas: ['ArtGermanEF.sga', 'ArtHigh.sga'],       match: /vehicles\/tiger\/tiger_/i },
  { label: 'king_tiger',        sgas: ['ArtWestGerman.sga', 'ArtHighXP1.sga'],  match: /king_tiger_sdkfz_182\/king_tiger_sdkfz_182_/i },
  { label: 'panther_turret',    sgas: ['ArtGermanEF.sga', 'ArtHigh.sga'],       match: /panther\/.*turret.*_/i },
  { label: 'halftrack',         sgas: ['ArtGermanEF.sga', 'ArtHigh.sga'],       match: /halftrack.*\/halftrack_/i },
  { label: 't34_soviet',        sgas: ['ArtSovietEF.sga', 'ArtHigh.sga'],       match: /t_?34.*\/t_?34.*_/i },
  { label: 'sherman_aef',       sgas: ['ArtAEFSkins.sga', 'ArtAEF.sga', 'ArtHighXP1.sga'], match: /sherman.*\/sherman.*_/i },
]

const results: any[] = []
const openCache = new Map<string, SgaArchive | null>()
async function open(sga: string): Promise<SgaArchive | null> {
  if (openCache.has(sga)) return openCache.get(sga)!
  const fp = path.join(ARCH, sga)
  if (!fs.existsSync(fp)) { openCache.set(sga, null); return null }
  try { const a = await SgaArchive.open(shim(fp)); openCache.set(sga, a); return a }
  catch (e) { console.log(`  open ${sga} threw ${String(e)}`); openCache.set(sga, null); return null }
}

for (const t of TARGETS) {
  let alpPath: string | null = null, difPath: string | null = null, spcPath: string | null = null
  let archive: SgaArchive | null = null, sgaUsed = ''
  for (const sga of t.sgas) {
    const a = await open(sga); if (!a) continue
    const paths = a.listPaths()
    const alp = paths.find(p => t.match.test(p) && /_alp\.rgt$/i.test(p))
    if (!alp) continue
    alpPath = alp; archive = a; sgaUsed = sga
    const stem = alp.replace(/_alp\.rgt$/i, '')
    difPath = paths.find(p => p === `${stem}_dif.rgt`) ?? paths.find(p => t.match.test(p) && /_dif\.rgt$/i.test(p)) ?? null
    spcPath = paths.find(p => p === `${stem}_spc.rgt`) ?? paths.find(p => t.match.test(p) && /_spc\.rgt$/i.test(p)) ?? null
    break
  }
  if (!alpPath || !archive) {
    console.log(`\n### ${t.label}: NO _alp.rgt found in ${t.sgas.join(', ')}`)
    results.push({ label: t.label, found: false, searched: t.sgas })
    continue
  }
  const alpBytes = await archive.readByPath(alpPath)
  if (!alpBytes) { console.log(`### ${t.label}: readByPath null for ${alpPath}`); continue }
  const { rgt: alpRgt, rgba: alpRgba } = toRgba(alpBytes)
  const cs = channelStats(alpRgba)
  const hR = hist(alpRgba, 0), hA = hist(alpRgba, 3)
  const binR = binaryFraction(alpRgba, 0), binA = binaryFraction(alpRgba, 3)

  // Cross-correlate alp (use the varying channel) vs dif albedo + spc.
  const alpChan = cs.grayscale ? 0 : (cs.aVaries && !cs.rgbVaries ? 3 : 0)
  let corrDif: number | null = null, corrSpc: number | null = null
  let difInfo = '', spcInfo = ''
  if (difPath) {
    const b = await archive.readByPath(difPath)
    if (b) { const { rgt, rgba } = toRgba(b); difInfo = `${rgt.width}x${rgt.height} ${rgt.fourCC}`
      corrDif = correlate(alpRgba, alpRgt.width, alpRgt.height, alpChan, rgba, rgt.width, rgt.height, -1) }
  }
  if (spcPath) {
    const b = await archive.readByPath(spcPath)
    if (b) { const { rgt, rgba } = toRgba(b); spcInfo = `${rgt.width}x${rgt.height} ${rgt.fourCC}`
      corrSpc = correlate(alpRgba, alpRgt.width, alpRgt.height, alpChan, rgba, rgt.width, rgt.height, -1) }
  }

  // Write PNGs: the alp as-is (RGBA), and the isolated alpha channel as gray.
  writePng(`${t.label}_alp_rgba.png`, alpRgba, alpRgt.width, alpRgt.height)
  const gray = new Uint8ClampedArray(alpRgba.length)
  for (let i = 0; i < alpRgba.length; i += 4) {
    const v = alpRgba[i + alpChan]
    gray[i] = gray[i + 1] = gray[i + 2] = v; gray[i + 3] = 255
  }
  writePng(`${t.label}_alp_chan${alpChan}.png`, gray, alpRgt.width, alpRgt.height)

  const rec = {
    label: t.label, found: true, sga: sgaUsed,
    alpPath, difPath, spcPath,
    dims: `${alpRgt.width}x${alpRgt.height}`, fourCC: alpRgt.fourCC, formatCode: alpRgt.formatCode,
    channelStats: cs, analysedChannel: alpChan,
    histR: hR, histA: hA, binaryFracR: binR, binaryFracA: binA,
    corrWithDifAlbedo: corrDif, corrWithSpc: corrSpc,
    difInfo, spcInfo,
  }
  results.push(rec)
  console.log(`\n### ${t.label}  (${sgaUsed})`)
  console.log(`  alp: ${alpPath}`)
  console.log(`  dims ${rec.dims} ${alpRgt.fourCC} formatCode=${alpRgt.formatCode}`)
  console.log(`  grayscale(R=G=B)=${cs.grayscale}  alphaVaries=${cs.aVaries}  rgbVaries=${cs.rgbVaries}  analysedChan=${alpChan}`)
  console.log(`  R  min/mean/max=${hR.min}/${hR.mean}/${hR.max}  binaryFrac=${binR}`)
  console.log(`  A  min/mean/max=${hA.min}/${hA.mean}/${hA.max}  binaryFrac=${binA}`)
  console.log(`  R histogram(16): ${hR.buckets.join(',')}`)
  console.log(`  A histogram(16): ${hA.buckets.join(',')}`)
  console.log(`  corr(alp, dif-albedo)=${corrDif}   corr(alp, spc)=${corrSpc}`)
  console.log(`  dif=${difInfo || 'n/a'}  spc=${spcInfo || 'n/a'}`)
}

fs.writeFileSync(path.join(OUT, 'alp-probe-summary.json'), JSON.stringify(results, null, 2))
console.log(`\nWrote ${path.join(OUT, 'alp-probe-summary.json')} and PNGs to ${OUT}/`)
