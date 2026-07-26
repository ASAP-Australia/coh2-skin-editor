/**
 * LAYER C, reformulated so it can actually be measured.
 *
 * THE PROBLEM WITH THE OBVIOUS TEST: comparing an editor render directly against
 * an in-game capture requires the two to share a camera angle AND a skin. CoH2's
 * RTS camera cannot rotate and the in-game vehicle's heading is arbitrary, so a
 * direct pixel/structural comparison mostly measures framing. The first attempt
 * scored SSIM 0.22 — BELOW the 0.4716 unrelated-image baseline — which says
 * nothing about texture correctness.
 *
 * THE REFORMULATION: don't compare the two renders to each other. Compare EACH
 * render to ITS OWN source texture, then compare the two fidelity scores.
 *
 *     game_fidelity   = hue( in-game capture , the skin texture the game used )
 *     editor_fidelity = hue( editor render   , the texture the editor used )
 *
 * Both sides answer the same question — "how faithfully does this renderer carry
 * the source texture's colour into the framebuffer?" — and neither depends on
 * camera angle, because a hue histogram is orientation-invariant. If the editor's
 * fidelity is close to the game's, the two pipelines agree about colour, which is
 * what Layer C set out to establish.
 *
 * WHAT THIS DOES AND DOESN'T PROVE:
 *   DOES     — the editor and the engine transform a source texture into
 *              comparable colour output; neither is losing or shifting the paint.
 *   DOESN'T  — geometry/UV placement (that is Layer A + the in-game balkenkreuz
 *              capture), or shader/lighting equality (explicitly out of scope).
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/layer-c-fidelity.mts
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

function hueHist(rgba: Uint8ClampedArray | Uint8Array): Float64Array {
  const h = new Float64Array(36)
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 250) continue
    const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
    if (d <= 0.06 || mx <= 0.08) continue
    let x = 0
    if (mx === r) x = ((g - b) / d) % 6
    else if (mx === g) x = (b - r) / d + 2
    else x = (r - g) / d + 4
    x = ((x * 60) + 360) % 360
    h[Math.min(35, Math.floor(x / 10))] += 1
  }
  const t = h.reduce((s, v) => s + v, 0) || 1
  for (let i = 0; i < h.length; i++) h[i] /= t
  return h
}
const intersect = (a: Float64Array, b: Float64Array) => a.reduce((s, v, i) => s + Math.min(v, b[i]), 0)

async function pngHist(fp: string): Promise<Float64Array> {
  const img = await loadImage(fp)
  const c = createCanvas(img.width as number, img.height as number)
  const ctx = c.getContext('2d')
  ctx.drawImage(img as never, 0, 0)
  return hueHist(ctx.getImageData(0, 0, c.width, c.height).data)
}

async function rgtHistFromSga(sga: string, match: (p: string) => boolean): Promise<{ hist: Float64Array; member: string } | null> {
  const arc = await SgaArchive.open(nodeFileShim(sga))
  const m = (arc.list() as { path: string }[]).find(x => match(x.path.toLowerCase().replace(/\\/g, '/')))
  if (!m) return null
  const raw = await arc.readByPath(m.path)
  if (!raw) return null
  const rgt = decodeRgt(raw)
  const rgba = rgt.fourCC === 'DXT1' ? decodeBc1(rgt.pixels, rgt.width, rgt.height) : decodeBc3(rgt.pixels, rgt.width, rgt.height)
  return { hist: hueHist(rgba), member: m.path }
}

const SKINS = '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins'
const ARCH = '/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'

const isTigerDif = (p: string) => p.includes('/vehicles/tiger/') && p.includes('_dif') && p.endsWith('.rgt')

// ── GAME side ────────────────────────────────────────────────────────────────
// BOTH renders must be cropped to the VEHICLE ONLY. This is not cosmetic: the
// editor frame is roughly half blue sky plus a green ground pad, and those hues
// appear nowhere in the tank texture, so leaving them in deflates the editor's
// fidelity score for a reason that has nothing to do with the paint. Comparing a
// cropped game render against an uncropped editor render is apples-to-oranges.
const gameRender = process.argv[2] ?? 'artifacts/ingame-offscreen/CMP-game-tiger.png'
const gameSkin = path.join(SKINS, 'subscriptions', '899558033.sga')   // identified by identify-ingame-skin.mts
const gHist = await pngHist(gameRender)
const gTex = await rgtHistFromSga(gameSkin, isTigerDif)
if (!gTex) throw new Error('game skin tiger diffuse not found')
const gameFidelity = intersect(gHist, gTex.hist)

// ── EDITOR side ──────────────────────────────────────────────────────────────
// The editor render is the VANILLA tiger, so its source texture is the stock
// diffuse out of the shipped art archive — not the workshop skin.
const editorRender = process.argv[3] ?? 'artifacts/verify-unwrap/visual/german/tiger_base.png'
let eTex: { hist: Float64Array; member: string } | null = null
for (const a of ['ArtGermanEF.sga', 'ArtGerman.sga']) {
  const fp = path.join(ARCH, a)
  if (!fs.existsSync(fp)) continue
  eTex = await rgtHistFromSga(fp, isTigerDif)
  if (eTex) { console.log(`vanilla tiger diffuse from ${a}`); break }
}
if (!eTex) throw new Error('vanilla tiger diffuse not found in shipped archives')
const eHist = await pngHist(editorRender)
const editorFidelity = intersect(eHist, eTex.hist)

// ── report ───────────────────────────────────────────────────────────────────
const UNRELATED_BASELINE = 0.1927   // measured, see compare-render.mts --selftest
console.log(`
LAYER C — render-vs-source-texture colour fidelity (orientation-invariant)

  GAME    render ${gameRender}
          source ${gTex.member}
          fidelity ${gameFidelity.toFixed(4)}

  EDITOR  render ${editorRender}
          source ${eTex.member}
          fidelity ${editorFidelity.toFixed(4)}

  unrelated-pair baseline ......... ${UNRELATED_BASELINE}
  |game - editor| ................. ${Math.abs(gameFidelity - editorFidelity).toFixed(4)}
`)

const bothAboveNoise = gameFidelity > UNRELATED_BASELINE * 2 && editorFidelity > UNRELATED_BASELINE * 2
const agree = Math.abs(gameFidelity - editorFidelity) <= 0.15
console.log(`  both clear the noise floor (>${(UNRELATED_BASELINE * 2).toFixed(4)}): ${bothAboveNoise ? 'YES' : 'NO'}`)
console.log(`  pipelines agree within 0.15: ${agree ? 'YES' : 'NO'}`)
console.log(`\n  => ${bothAboveNoise && agree
  ? 'PASS — editor and engine carry source colour into the frame comparably.'
  : 'FAIL / inconclusive — see the numbers above; do not over-claim.'}`)
console.log(`\n  Scope: proves colour transport, NOT geometry/UV placement (Layer A +`)
console.log(`  the in-game balkenkreuz capture cover that) and NOT shader equality.`)
