// Quick test to see TRIM v5 parsing output
import fs from 'fs'
import path from 'path'
import os from 'os'
import { inflate } from 'pako'

const expandPath = (p: string) => p.replace('~', os.homedir())

// Minimal types and functions matching the real code
interface Chunk {
  kind: 'DATA' | 'FOLD'
  fourCC: string
  version: number
  payloadOffset: number
  payloadSize: number
  name: string
}

class Reader {
  pos = 0
  constructor(private buf: Uint8Array, private offset: number = 0) {}
  u32() {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset + this.pos, 4).getUint32(0, true)
    this.pos += 4
    return v
  }
  bytes(n: number) {
    const b = this.buf.slice(this.offset + this.pos, this.offset + this.pos + n)
    this.pos += n
    return b
  }
}

function formatSize(fmt: number): number {
  if (fmt === 2) return 4
  if (fmt === 3) return 8
  if (fmt === 4) return 12
  if (fmt === 5) return 16
  if (fmt === 13) return 4
  return 0
}

function parseTrimV5Test(u8: Uint8Array, payloadOffset: number, payloadSize: number) {
  const r = new Reader(u8, payloadOffset)

  // Diagnostic hex dump
  const diagHex: string[] = []
  for (let i = 0; i < Math.min(32, payloadSize); i += 4) {
    const val = new DataView(u8.buffer, u8.byteOffset + payloadOffset + i, 4).getUint32(0, true)
    diagHex.push(`${val.toString(16).padStart(8, '0')}`)
  }
  console.log('[TRIM v5] First bytes:', diagHex.join(' '))

  const v1 = r.u32()
  const v2 = r.u32()
  const numInput = r.u32()

  console.log(`[TRIM v5] v1=${v1} (expect 5), v2=${v2} (expect 0), numInput=${numInput}`)

  if (numInput === 0 || numInput > 100) {
    console.log('[TRIM v5] ERROR: numInput looks wrong!')
    return
  }

  const inputLayout = []
  for (let i = 0; i < numInput; i++) {
    const semantic = r.u32()
    r.bytes(4) // skip
    const format = r.u32()
    const size = formatSize(format)
    inputLayout.push({ semantic, format, size })
    console.log(`  input[${i}]: semantic=${semantic}, format=${format}, size=${size}`)
  }

  const numVerts = r.u32()
  const stride = r.u32()
  const computedStride = inputLayout.reduce((s: number, e: any) => s + e.size, 0)

  console.log(`[TRIM v5] numVerts=${numVerts}, stride=${stride} (computed=${computedStride})`)

  const vbuf = r.bytes(numVerts * stride)
  const numIdx = r.u32()
  console.log(`[TRIM v5] numIndices=${numIdx}`)
}

// Load King Tiger and test
const coH2Path = expandPath('~/.local/share/Steam/steamapps/common/Company of Heroes 2')

// For now just read raw SGA and find the file
const sgaPath = path.join(coH2Path, 'CoH2/Archives/ArtHighXP1.sga')
console.log('Reading', sgaPath)

const sgaBuf = fs.readFileSync(sgaPath)
console.log('SGA size:', sgaBuf.length)

console.log('✓ File loaded, ready to parse when Electron runs the actual app')
