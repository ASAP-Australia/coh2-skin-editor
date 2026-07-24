import fs from 'fs'
import { SgaArchive } from '../src/lib/sga'

function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size; const len = Math.max(0, e - start)
    return { arrayBuffer: async () => { const b = Buffer.alloc(len); if (len > 0) fs.readSync(fd, b, 0, len, start); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } as Blob
  }
  return { name: fp, size: stat.size, slice } as unknown as File
}

const ARCH = '/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
for (const sgaN of ['ArtAEF.sga', 'ArtArmies.sga', 'ArtHigh.sga']) {
  const fp = ARCH + '/' + sgaN
  if (!fs.existsSync(fp)) continue
  const a = await SgaArchive.open(nodeFileShim(fp))
  const files = a.list().filter((f: { path: string }) => f.path.toLowerCase().includes('m4') || f.path.toLowerCase().includes('sherman'))
  if (files.length > 0) { files.forEach((f: { path: string }) => console.log(sgaN + ':  ' + f.path)); break }
}
