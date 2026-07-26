/**
 * WHICH installed skin was the game actually rendering?
 *
 * WHY THIS IS THE LAYER C BLOCKER: compare-render.mts needs both sides painted
 * the same. The editor renders the vanilla diffuse; the game has custom skins
 * equipped. scan-installed-skins.mts found 31 skin SGAs that paint German
 * vehicles and most of them cover `tiger`, so disk inspection alone cannot say
 * which one won. This script decides it from PIXELS instead: decode each
 * candidate's tiger diffuse and score its colour signature against the actual
 * in-game capture. The best match is the skin to render on the editor side.
 *
 * Method: hue histogram (36 x 10-degree bins) intersection, exactly the metric
 * compare-render.mts uses, so the numbers are directly comparable. Hue is used
 * rather than RGB because the in-game frame is lit, shadowed and tone-mapped
 * while the texture is raw — absolute brightness is not comparable, hue family
 * largely is.
 *
 * CAVEAT, stated up front: a texture is a UV atlas, not a photograph. Its
 * histogram covers the WHOLE atlas (including faces never visible from one
 * camera), so scores are relative, not absolute. Treat this as a RANKING, and
 * only trust a winner that clearly separates from the pack.
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/identify-ingame-skin.mts [capture.png]
 */
import fs from 'fs'
import path from 'path'
import { createCanvas, loadImage } from 'canvas'
import { SgaArchive } from '../src/lib/sga'
import { decodeRgt } from '../src/lib/rgt'
import { decodeBc1, decodeBc3 } from '../src/lib/bc-decode'

function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size; const len = Math.max(0, e - start)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len > 0) fs.readSync(fd, b, 0, len, start); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: fp, size: stat.size, slice } as unknown as File
}

/** 36-bin hue histogram, normalised. Mirrors compare-render.mts exactly. */
function hueHist(rgba: Uint8ClampedArray | Uint8Array): Float64Array {
  const h = new Float64Array(36)
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]
    if (a < 250) continue                     // ignore transparent atlas gutters
    const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
    if (d <= 0.06 || mx <= 0.08) continue     // near-grey / near-black carry no hue
    let x = 0
    if (mx === r) x = ((g - b) / d) % 6
    else if (mx === g) x = (b - r) / d + 2
    else x = (r - g) / d + 4
    x = ((x * 60) + 360) % 360
    h[Math.min(35, Math.floor(x / 10))] += 1
  }
  const tot = h.reduce((s, v) => s + v, 0) || 1
  for (let i = 0; i < h.length; i++) h[i] /= tot
  return h
}

const intersect = (a: Float64Array, b: Float64Array) =>
  a.reduce((s, v, i) => s + Math.min(v, b[i]), 0)

const SKIN_ROOT = '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins'
const CAPTURE = process.argv[2] ?? 'artifacts/ingame-offscreen/CMP-game-tiger.png'

// ── reference: the in-game capture ───────────────────────────────────────────
const img = await loadImage(CAPTURE)
const c = createCanvas(img.width as number, img.height as number)
const ctx = c.getContext('2d')
ctx.drawImage(img as never, 0, 0)
const refHist = hueHist(ctx.getImageData(0, 0, c.width, c.height).data)
console.log(`reference: ${CAPTURE} (${c.width}x${c.height})\n`)

// ── candidates: every installed skin carrying a tiger diffuse ────────────────
type Cand = { file: string; where: string; member: string; score: number; px: number }
const cands: Cand[] = []

for (const where of [SKIN_ROOT, path.join(SKIN_ROOT, 'subscriptions')]) {
  if (!fs.existsSync(where)) continue
  for (const f of fs.readdirSync(where).sort()) {
    if (!f.toLowerCase().endsWith('.sga')) continue
    let arc
    try { arc = await SgaArchive.open(nodeFileShim(path.join(where, f))) } catch { continue }
    let members: { path: string }[]
    try { members = arc.list() as { path: string }[] } catch { continue }
    const tigerDif = members.find(m => {
      const p = m.path.toLowerCase().replace(/\\/g, '/')
      return p.includes('/vehicles/tiger/') && p.includes('_dif') && p.endsWith('.rgt')
    })
    if (!tigerDif) continue
    try {
      const raw = await arc.readByPath(tigerDif.path)
      if (!raw) continue
      const rgt = decodeRgt(raw)
      const rgba = rgt.fourCC === 'DXT1'
        ? decodeBc1(rgt.pixels, rgt.width, rgt.height)
        : decodeBc3(rgt.pixels, rgt.width, rgt.height)
      const score = intersect(refHist, hueHist(rgba))
      cands.push({ file: f, where: where.endsWith('subscriptions') ? 'subs' : 'skins', member: tigerDif.path, score, px: rgt.width })
    } catch (e) {
      console.log(`  (skip ${f}: ${(e as Error).message.slice(0, 60)})`)
    }
  }
}

cands.sort((a, b) => b.score - a.score)
console.log(`=== ${cands.length} candidate tiger skins, by hue-histogram match to the capture ===`)
for (const r of cands) {
  console.log(`  ${r.score.toFixed(4)}  ${r.file.padEnd(34)} [${r.where}]  ${r.px}px`)
}
if (cands.length >= 2) {
  const gap = cands[0].score - cands[1].score
  console.log(`\ntop-2 separation: ${gap.toFixed(4)}`)
  console.log(gap >= 0.05
    ? `=> "${cands[0].file}" is a CLEAR winner; render this skin on the editor side.`
    : `=> NO clear winner (gap < 0.05). Ranking is not decisive — do NOT pick one on this basis.`)
}
