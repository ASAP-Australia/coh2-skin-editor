# Faceplate Export Round-Trip Verification

_Generated 2026-07-20T06:24:24.907Z_

**Verdict: PASS**

Pure-Node round-trip of the faceplate export pipeline. Composites a
representative atlas (image + text + shape layers), encodes it with the
**actual export code** (`encodeBc3` + `wrapBc3InDds` from
`src/lib/faceplate-mod-build.ts`), decodes it back with the app decoder
(`decodeBc3`), and compares per pixel.

## Atlas

- Size: **692×204** (banner 624×204 + icon 64×64)
- Composited layers:
  - image layer: diagonal gradient + procedural dither (624×204 smooth fill)
  - shape layer: bordered rectangle + filled circle (hard edges)
  - text layer: "FACEPLATE" banner + accented subtitle (AA glyph edges)
  - icon sub-rect: emblem triangle on dark field (64×64)

## Per-channel deltas (RGB)

| Metric | Value (/255) | Threshold | OK |
|---|---|---|---|
| Mean (whole atlas, incl. edges) | 3.4964 | ≤ 4 | YES |
| Max (whole atlas, incl. edges) | 128 | — | — |
| Mean (excluding block edges) | 1.6911 | — | — |
| Max (excluding block edges) | 22 | ≤ 48 | YES |

Block-edge blocks (any R/G/B channel spanning > 64 within a 4×4 block): **1977 / 8823** (22.41%). These carry the intrinsic BC min-max ceiling and are excluded from the MAX check but still counted in the whole-atlas mean.

## DDS container / format

| Field | Value | Expected | OK |
|---|---|---|---|
| magic | `DDS ` | `DDS ` | YES |
| width | 692 | 692 | YES |
| height | 204 | 204 | YES |
| fourCC | `DXT5` | `DXT5` | YES |
| linearSize | 141168 | 141168 | YES |
| payload bytes | 141168 | 141168 | YES |

## Threshold justification

The app BC3 encoder is min-max (not least-squares); `bc-encode.test.ts`
uses a ±32/channel tolerance for solid-colour round-trips. Real content
is mostly smooth with a few hard text/shape edges, so the aggregate error
is far below the worst single pixel. We require mean ≤ 4/255 (proves the
bulk is near-lossless) and max ≤ 48/255 excluding block edges (allows the
high-contrast edge blocks their intrinsic BC ceiling).

## Limitation

Pure-JS pipeline: the export encoder (encodeBc3) and container wrapper (wrapBc3InDds) run headlessly — this exercises the ACTUAL export code, not a reimplementation. No native/binary encoder is involved, so the round-trip is complete with no unverified stages.
