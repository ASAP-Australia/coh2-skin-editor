/**
 * Vitest benchmarks for the hot paths in the faceplate mod pipeline.
 *
 * Run with:
 *   npm run bench
 *
 * These cover:
 *   1. BC3 encode  — 692×204 RGBA atlas → BC3 blocks (the real faceplate size)
 *   2. wrapBc3InDds — header assembly + Uint8Array construction (near-instant baseline)
 *   3. buildFaceplateMod — full orchestrator (encode + DDS wrap + SGA archive build)
 *
 * The synthetic gradient atlas mirrors the one in scripts/build-test-faceplate.mts
 * so the benchmark exercises the same pixel-access pattern as production use.
 */

import { bench, describe } from 'vitest'
import { encodeBc3 } from '@/lib/bc-encode'
import { buildFaceplateMod, wrapBc3InDds } from '@/lib/faceplate-mod-build'
import { ATLAS_WIDTH, ATLAS_HEIGHT } from '@/lib/faceplate-templates'
import { newFaceplateProject } from '@/lib/faceplate-project'

// ─── Synthetic gradient atlas (692×204 RGBA) ─────────────────────────────────
// Mirrors build-test-faceplate.mts so the pixel-access pattern is realistic.
// Built once at module load time and shared across all bench iterations.

function makeSyntheticAtlas(): Uint8ClampedArray {
  const w = ATLAS_WIDTH // 692
  const h = ATLAS_HEIGHT // 204
  const out = new Uint8ClampedArray(w * h * 4)

  // Default: black, fully opaque
  for (let i = 3; i < out.length; i += 4) out[i] = 255

  // Banner region (x: 0..624, y: 0..204): warm red→orange gradient.
  // The engine samples this exact sub-rect from the 692×204 atlas — see
  // faceplate-templates.ts BANNER_RECT.
  for (let y = 0; y < 204; y++) {
    for (let x = 0; x < 624; x++) {
      const i = (y * w + x) * 4
      const t = x / 624
      out[i] = 0xff
      out[i + 1] = Math.floor(0x40 + 0xa0 * t)
      out[i + 2] = Math.floor(0x20 + 0x40 * (y / 204))
      out[i + 3] = 255
    }
  }

  // Icon region (x: 624..688, y: 0..64): cyan with a white corner triangle.
  // Engine samples 64×64 from this corner — see ICON_RECT.
  for (let y = 0; y < 64; y++) {
    for (let x = 624; x < 688; x++) {
      const i = (y * w + x) * 4
      out[i] = 0
      out[i + 1] = 200
      out[i + 2] = 220
      out[i + 3] = 255
      if (x - 624 + y < 20) {
        out[i] = 255
        out[i + 1] = 255
        out[i + 2] = 255
      }
    }
  }
  return out
}

const ATLAS = makeSyntheticAtlas()
// Pre-encode the BC3 payload so wrapBc3InDds doesn't re-encode in its bench.
const BC3 = encodeBc3(ATLAS, ATLAS_WIDTH, ATLAS_HEIGHT)

// Stable fixed GUID (avoids crypto.getRandomValues() overhead inside the loop)
const FIXED_GUID = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'

// Project used for the full orchestrator bench
const PROJECT = newFaceplateProject('Bench Faceplate')
PROJECT.packDescription = 'Benchmark-generated faceplate for perf measurement'

// ─── Benchmarks ──────────────────────────────────────────────────────────────

describe('faceplate perf', () => {
  bench('bc3 encode 692x204', () => {
    encodeBc3(ATLAS, ATLAS_WIDTH, ATLAS_HEIGHT)
  })

  bench('wrapBc3InDds header assembly', () => {
    wrapBc3InDds(BC3, ATLAS_WIDTH, ATLAS_HEIGHT)
  })

  bench('buildFaceplateMod end-to-end', async () => {
    await buildFaceplateMod({
      project: PROJECT,
      atlasRgba: ATLAS,
      guid: FIXED_GUID,
    })
  })
})
