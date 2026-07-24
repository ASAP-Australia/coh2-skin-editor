import { JSDOM } from 'jsdom'
import { readFile } from 'node:fs/promises'
const dom = new JSDOM('<!DOCTYPE html>')
;(globalThis as any).File = dom.window.File
;(globalThis as any).Blob = dom.window.Blob
const ROOT = '/var/home/jflessenkemper/dev/coh2-skin-editor'
const { SgaArchive } = await import(`${ROOT}/src/lib/sga.ts`)
const bytes = new Uint8Array(await readFile(`${ROOT}/artifacts/created-assets/faceplate-test.sga`))
const blob = new dom.window.Blob([bytes])
const arc: any = await (SgaArchive as any).open(blob)
const files = arc.list()
const atlas = files.find((f: any) => f.path.includes('_i1.dds'))
const buf: Uint8Array = await atlas.read()
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const magic = String.fromCharCode(...buf.slice(0, 4))
const size = dv.getUint32(4, true)
const height = dv.getUint32(12, true)
const width = dv.getUint32(16, true)
const linsz = dv.getUint32(20, true)
const fourcc = String.fromCharCode(...buf.slice(84, 88))
console.log(`atlas path: ${atlas.path}  decompressed=${buf.length} bytes`)
console.log(`magic="${magic}" size=${size} width=${width} height=${height} linearSize=${linsz} fourCC="${fourcc}"`)
const bc3Bytes = (692 / 4) * (204 / 4) * 16 // 141168
console.log(`expected BC3 payload=${bc3Bytes}, header+payload=${128 + bc3Bytes}, got=${buf.length}`)
const ok =
  magic === 'DDS ' && size === 124 && width === 692 && height === 204 && fourcc === 'DXT5' &&
  buf.length === 128 + bc3Bytes
console.log('ATLAS DDS VALID 692x204 DXT5:', ok)
if (!ok) process.exit(1)
console.log('PASS')
