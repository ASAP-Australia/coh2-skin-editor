/**
 * Decode candidate CoH2 ground textures to PNG so they can be eyeballed and
 * compared before one is chosen for the viewport's ground pad.
 *
 * WHY: the pad currently uses a single tile (nis_grass_plain_01/
 * swampy_field_01_dif.rgt) on a small slab, which reads as a display plinth
 * rather than a piece of battlefield. The scenario files do NOT ship a usable
 * ready-made ground picture — `_tdm.dds` is 2048² R16G16_UINT (a terrain
 * material INDEX map, not a photograph) and `_mm.tga` is the tactical minimap
 * with red pathing lines baked in. The real options are the shipped terrain
 * tiles and the large painted battlefield-background textures under
 * art/environment/nature/bgs/.
 *
 * usage: npx tsx --tsconfig tsconfig.node.json scripts/dump-terrain-textures.mts
 * out:   artifacts/terrain-pad/<name>.png
 */
import fs from 'fs'
import path from 'path'
import { createCanvas } from 'canvas'
import { SgaArchive } from '../src/lib/sga'
import { decodeRgt } from '../src/lib/rgt'
import { decodeBc1, decodeBc3 } from '../src/lib/bc-decode'

function shim(fp: string): File {
  const fd = fs.openSync(fp, 'r'); const st = fs.statSync(fp)
  const slice = (s = 0, e?: number) => {
    const en = e ?? st.size; const l = Math.max(0, en - s)
    return { arrayBuffer: async () => { const b = Buffer.alloc(l); if (l > 0) fs.readSync(fd, b, 0, l, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: fp, size: st.size, slice } as unknown as File
}

const ARCH = '/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
const OUT = 'artifacts/terrain-pad'
fs.mkdirSync(OUT, { recursive: true })

const WANT = [
  'art/environment/nature/bgs/chernyayevsky_battlefield/tex_chernyayevsky_battlefield_bg_dif.rgt',
  'art/environment/nature/bgs/kholodnaya_ferma_battlefield/tex_kholodnaya_ferma_battlefield_bg_dif.rgt',
  'art/environment/nature/bgs/mp_flooded_fields/tex_floodedfileds_bg_dif.rgt',
  'art/environment/nature/bgs/okariver_battlefield/tex_okariver_battlefield_bg_dif.rgt',
  'art/environment/nature/bgs/snowtown_frontline/tex_snowtown_frontline_bg_dif.rgt',
  'art/environment/objects/terrain/nis_grass_plain_01/swampy_field_01_dif.rgt',
  'art/environment/objects/terrain/muddy_waters_01/mud_dry_02_dif.rgt',
]

const arc = await SgaArchive.open(shim(path.join(ARCH, 'ArtEnvironment.sga')))
const all = arc.list() as { path: string }[]
const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/')

for (const w of WANT) {
  const m = all.find(x => norm(x.path) === w)
  if (!m) { console.log(`MISSING  ${w}`); continue }
  const raw = await arc.readByPath(m.path)
  if (!raw) { console.log(`UNREADABLE  ${w}`); continue }
  try {
    const r = decodeRgt(raw)
    const px = r.fourCC === 'DXT1'
      ? decodeBc1(r.pixels, r.width, r.height)
      : decodeBc3(r.pixels, r.width, r.height)
    const c = createCanvas(r.width, r.height)
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(r.width, r.height)
    img.data.set(px)
    ctx.putImageData(img, 0, 0)
    const out = path.join(OUT, path.basename(w, '.rgt') + '.png')
    fs.writeFileSync(out, c.toBuffer('image/png'))
    console.log(`${String(r.width).padStart(5)}x${String(r.height).padEnd(5)} ${r.fourCC}  -> ${out}`)
  } catch (e) {
    console.log(`DECODE FAIL  ${w}: ${(e as Error).message.slice(0, 60)}`)
  }
}
