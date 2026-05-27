/**
 * RGT (Relic Generic Texture) writer — the inverse of `rgt.ts`.
 *
 * Produces a Chunky v3 container wrapping a single zlib-compressed DXT mip
 * level. Real CoH2 RGT files include a full mip pyramid (12 mips for a
 * 2048² texture, smallest first); we only emit the top mip and zero out the
 * rest. The game's renderer doesn't strictly need the smaller mips for an
 * arbitrary-resolution texture — it'll fall back to bilinear minification.
 *
 * Chunky tree we emit (matches what we read in `rgm.ts`/`rgt.ts`):
 *
 *   FOLD/TSET v1 name="art\\armies\\…\\<entity>_dif"
 *     DATA/DATA v3                  (8 bytes scratch — observed in real RGTs)
 *     FOLD/TXTR v1
 *       FOLD/DXTC v3
 *         DATA/TFMT v1   25 bytes   (width, height, …, format)
 *         DATA/TMAN v1   100 bytes  (mip table — only the top mip carries data)
 *         DATA/TDAT v1   variable   (concatenated zlib mip blobs)
 *
 * Chunk header layout we use (matches the reader):
 *    4 bytes   kind  ("DATA"/"FOLD")
 *    4 bytes   fourCC
 *    4 bytes   version
 *    4 bytes   payload size
 *    4 bytes   name size
 *    8 bytes   reserved (0xFFFFFFFF, 0)
 *    N bytes   name
 *    M bytes   payload
 */

import { deflate } from 'pako'
import { encodeBc3 } from './bc-encode'

export interface RgtOptions {
  /** When false, store the top mip as raw BC3 bytes (no zlib). This produces a
   *  deterministic, content-independent byte length — required for the key-pool
   *  patch workflow where the TOC must stay byte-identical across all user skins. */
  compress?: boolean
}

/** Build a complete .rgt byte stream from an HTML canvas. */
export function canvasToRgt(
  canvas: HTMLCanvasElement,
  internalName: string,
  options?: RgtOptions,
): Uint8Array {
  const compress = options?.compress ?? true

  // 1. Get RGBA pixels
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)

  // 2. Encode the top mip as BC3
  const dxt = encodeBc3(img.data, width, height)

  // 3. Build the mip table. We emit ONE real mip (the top one) and pad
  //    the rest with empty entries pointing at zero-length zlib streams,
  //    matching the mip count CoH2 expects (computed as ceil(log2(max))+1).
  const mipCount = Math.floor(Math.log2(Math.max(width, height))) + 1

  // Top mip: compressed or raw depending on options
  const topData: Uint8Array = compress ? deflate(dxt, { level: 6 }) : dxt
  // Empty placeholder for smaller mips
  const emptyZ = deflate(new Uint8Array(0), { level: 6 })
  const emptyRaw = new Uint8Array(0)
  const emptySlot = compress ? emptyZ : emptyRaw

  // Concatenate: smallest mip first … largest mip last (the rgt.ts reader
  // walks them in order and uses the LAST as the top mip). For the empty
  // mips we still emit a stream so byte-offset arithmetic is consistent.
  const mips: { unc: number; cmp: Uint8Array }[] = []
  for (let i = 0; i < mipCount - 1; i++) {
    mips.push({ unc: 0, cmp: emptySlot })
  }
  mips.push({ unc: dxt.length, cmp: topData })

  // 4. Build chunk payloads
  // TFMT: width, height, ?, ?, format=15 (DXT5 in CoH2 codebase), ?, ?, byte
  const tfmt = new Uint8Array(25)
  const tfmtView = new DataView(tfmt.buffer)
  tfmtView.setUint32( 0, width, true)
  tfmtView.setUint32( 4, height, true)
  tfmtView.setUint32( 8, 1, true)            // unknown — common value
  tfmtView.setUint32(12, 2, true)            // unknown — common value
  tfmtView.setUint32(16, 15, true)           // 15 = DXT5
  tfmtView.setUint32(20, 0, true)
  tfmt[24] = 1

  // TMAN: u32 mip_count, then per-mip { u32 unc, u32 cmp_size }
  const tmanSize = 4 + 8 * mipCount
  const tman = new Uint8Array(tmanSize)
  const tmanView = new DataView(tman.buffer)
  tmanView.setUint32(0, mipCount, true)
  for (let i = 0; i < mipCount; i++) {
    tmanView.setUint32(4 + i * 8,     mips[i].unc, true)
    tmanView.setUint32(4 + i * 8 + 4, mips[i].cmp.length, true)
  }

  // TDAT: concatenated compressed mip streams in mip order (smallest first)
  let tdatSize = 0
  for (const m of mips) tdatSize += m.cmp.length
  const tdat = new Uint8Array(tdatSize)
  {
    let o = 0
    for (const m of mips) { tdat.set(m.cmp, o); o += m.cmp.length }
  }

  // 5. Wrap in Chunky tree
  const dxtcChildren = concatChunks([
    dataChunk('TFMT', 1, '', tfmt),
    dataChunk('TMAN', 1, '', tman),
    dataChunk('TDAT', 1, '', tdat),
  ])
  const dxtc = foldChunk('DXTC', 3, '', dxtcChildren)
  const txtrChildren = dxtc
  const txtr = foldChunk('TXTR', 1, '<unnamed spooge object>', txtrChildren)
  const tsetData = dataChunk('DATA', 3, '', new Uint8Array(8))
  const tsetChildren = concatChunks([tsetData, txtr])
  const tset = foldChunk('TSET', 1, internalName, tsetChildren)

  // FBIF (FileBurnInfo) chunk — required by the CoH2 engine to recognise
  // the RGT as a valid custom skin texture. Payload: u32 op_len, op string,
  // then 20 zero bytes (tool info / timestamp — zeros are fine for custom skins).
  const enc = new TextEncoder()
  const fbifOp = enc.encode('generic-image to data-rgt')
  const fbifPayload = new Uint8Array(4 + fbifOp.length + 20)
  new DataView(fbifPayload.buffer).setUint32(0, fbifOp.length, true)
  fbifPayload.set(fbifOp, 4)
  const fbif = dataChunk('FBIF', 2, 'FileBurnInfo', fbifPayload)

  // 6. File header (16 magic + 20 fixed) — same shape we read
  const fileHeader = new Uint8Array(36)
  fileHeader.set(enc.encode('Relic Chunky'), 0)
  fileHeader[12] = 0x0d; fileHeader[13] = 0x0a; fileHeader[14] = 0x1a; fileHeader[15] = 0
  const fhView = new DataView(fileHeader.buffer)
  fhView.setUint32(16, 3, true)        // chunky version
  fhView.setUint32(20, 1, true)
  fhView.setUint32(24, 0x24, true)
  fhView.setUint32(28, 0x1c, true)
  fhView.setUint32(32, 1, true)

  const body = concatChunks([fbif, tset])
  const out = new Uint8Array(fileHeader.length + body.length)
  out.set(fileHeader, 0)
  out.set(body, fileHeader.length)
  return out
}

// ------------------------------ helpers ------------------------------

function chunkHeader(kind: 'DATA' | 'FOLD', fcc: string, version: number, name: string, payloadLen: number): Uint8Array {
  const enc = new TextEncoder()
  const nameBytes = name ? enc.encode(name + '\0') : new Uint8Array(0)
  const out = new Uint8Array(28 + nameBytes.length)
  const v = new DataView(out.buffer)
  out.set(enc.encode(kind), 0)
  // fourCC must be exactly 4 chars — pad with spaces if shorter
  const fccPad = (fcc + '    ').slice(0, 4)
  out.set(enc.encode(fccPad), 4)
  v.setUint32(8, version, true)
  v.setUint32(12, payloadLen, true)
  v.setUint32(16, nameBytes.length, true)
  v.setUint32(20, 0xffffffff, true)
  v.setUint32(24, 0, true)
  if (nameBytes.length) out.set(nameBytes, 28)
  return out
}

function dataChunk(fcc: string, version: number, name: string, payload: Uint8Array): Uint8Array {
  const head = chunkHeader('DATA', fcc, version, name, payload.length)
  const out = new Uint8Array(head.length + payload.length)
  out.set(head, 0)
  out.set(payload, head.length)
  return out
}

function foldChunk(fcc: string, version: number, name: string, children: Uint8Array): Uint8Array {
  const head = chunkHeader('FOLD', fcc, version, name, children.length)
  const out = new Uint8Array(head.length + children.length)
  out.set(head, 0)
  out.set(children, head.length)
  return out
}

function concatChunks(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
