/**
 * probe-alp-env-decode.mts — READ-ONLY. No vehicle _alp exists, so decode the
 * building/environment _alp masks that DO exist to characterise what CoH2's
 * `_alp` channel-type actually is (its pixel makeup). Writes PNGs + stats.
 */
import * as fs from 'node:fs'; import * as path from 'node:path'
import { createCanvas } from 'canvas'
import { SgaArchive } from '../src/lib/sga'
import { decodeRgt } from '../src/lib/rgt'
import { decodeBc1, decodeBc3 } from '../src/lib/bc-decode'
const ARCH = '/var/home/jflessenkemper/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
const OUT = 'artifacts/alp-probe'
function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => ({ arrayBuffer: async () => {
    const len = (e ?? st.size) - s; const b = Buffer.alloc(Math.max(0, len))
    if (len > 0) fs.readSync(fd, b, 0, len, s)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  } } as Blob)
  return { name: path.basename(fp), size: st.size, slice } as unknown as File
}
function toRgba(bytes: Uint8Array) {
  const rgt = decodeRgt(bytes)
  const rgba = rgt.fourCC === 'DXT1' ? decodeBc1(rgt.pixels, rgt.width, rgt.height) : decodeBc3(rgt.pixels, rgt.width, rgt.height)
  return { rgt, rgba }
}
function stats(rgba: Uint8ClampedArray) {
  let gray = true, aVar = false; const a0 = rgba[3]
  const bR = new Array(16).fill(0), bA = new Array(16).fill(0)
  let rmin = 255, rmax = 0, amin = 255, amax = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3]
    if (r !== g || g !== b) gray = false
    if (a !== a0) aVar = true
    bR[r >> 4]++; bA[a >> 4]++
    if (r < rmin) rmin = r; if (r > rmax) rmax = r
    if (a < amin) amin = a; if (a > amax) amax = a
  }
  return { gray, aVar, bR, bA, rmin, rmax, amin, amax }
}
const TARGETS = [
  { sga: 'ArtEnvironment.sga', match: /eastern_rural\/shared_textures\/decals\/decal_eastern_rural_alp\.rgt$/i, label: 'env_decal_eastern_rural' },
  { sga: 'ArtAEF.sga',         match: /aef_camo_net_alp\.rgt$/i,                                                 label: 'env_aef_camo_net' },
]
for (const t of TARGETS) {
  const a = await SgaArchive.open(shim(path.join(ARCH, t.sga)))
  const p = a.listPaths().find(x => t.match.test(x))
  if (!p) { console.log(`${t.label}: not found`); continue }
  const bytes = await a.readByPath(p); if (!bytes) { console.log(`${t.label}: null`); continue }
  const { rgt, rgba } = toRgba(bytes); const s = stats(rgba)
  const cv = createCanvas(rgt.width, rgt.height); const ctx = cv.getContext('2d')
  const id = ctx.createImageData(rgt.width, rgt.height); id.data.set(rgba); ctx.putImageData(id, 0, 0)
  fs.writeFileSync(path.join(OUT, `${t.label}.png`), cv.toBuffer('image/png'))
  console.log(`\n### ${t.label}  ${p}`)
  console.log(`  ${rgt.width}x${rgt.height} ${rgt.fourCC} formatCode=${rgt.formatCode}`)
  console.log(`  grayscale=${s.gray} alphaVaries=${s.aVar}  R[${s.rmin}..${s.rmax}] A[${s.amin}..${s.amax}]`)
  console.log(`  R hist16: ${s.bR.join(',')}`)
  console.log(`  A hist16: ${s.bA.join(',')}`)
}
