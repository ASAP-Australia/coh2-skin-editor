/**
 * Minimal, dependency-free SHA-1 (FIPS 180-1) over a byte buffer.
 *
 * Browser-safe (no Node `crypto`, no WebCrypto async) so it can run inside the
 * pure-JS SGA writer synchronously while laying out the TOC. Used to compute the
 * `sha1_blocks` per-file verification hashes CoH2 requires on win-condition
 * (`.win`/`.scar`) archive files — see `sga-writer.ts`.
 *
 * Returns the 20-byte digest as a `Uint8Array`. Verified byte-identical to
 * Node's `crypto.createHash('sha1')` against the ModBuilder-burned reference
 * SGA hashes (2026-07-19).
 */
export function sha1(input: Uint8Array): Uint8Array {
  const ml = input.length * 8

  // Pad: append 0x80, then zeros, then 64-bit big-endian bit length.
  const withOne = input.length + 1
  const totalLen = ((withOne + 8 + 63) & ~63) // round up to multiple of 64
  const msg = new Uint8Array(totalLen)
  msg.set(input, 0)
  msg[input.length] = 0x80
  // 64-bit length, big-endian. Bit length fits well under 2^53 for our inputs;
  // write the low 32 bits, and derive the high 32 bits from ml / 2^32.
  const hi = Math.floor(ml / 0x100000000)
  const lo = ml >>> 0
  const dv = new DataView(msg.buffer)
  dv.setUint32(totalLen - 8, hi, false)
  dv.setUint32(totalLen - 4, lo, false)

  let h0 = 0x67452301
  let h1 = 0xEFCDAB89
  let h2 = 0x98BADCFE
  let h3 = 0x10325476
  let h4 = 0xC3D2E1F0

  const w = new Uint32Array(80)
  const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n))

  for (let off = 0; off < totalLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(off + i * 4, false)
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f: number, k: number
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
      else { f = b ^ c ^ d; k = 0xCA62C1D6 }

      const tmp = (rotl(a, 5) + f + e + k + w[i]) | 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = tmp
    }

    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }

  const out = new Uint8Array(20)
  const outv = new DataView(out.buffer)
  outv.setUint32(0, h0 >>> 0, false)
  outv.setUint32(4, h1 >>> 0, false)
  outv.setUint32(8, h2 >>> 0, false)
  outv.setUint32(12, h3 >>> 0, false)
  outv.setUint32(16, h4 >>> 0, false)
  return out
}
