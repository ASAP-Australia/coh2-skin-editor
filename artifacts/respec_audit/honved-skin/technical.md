# Honved Skin — Technical Audit

## Root Cause: Full-canvas overwrite, no equipment preservation

**Procedural path** (`camo-generator.ts:173–195` → `Editor.tsx:949–979`):
`generateCamo()` calls `ctx.clearRect(0, 0, W, H)` then fills the entire canvas with `preset.colors[0]`
before drawing blobs/stripes. In `renderCamoPresetToOverlay` (Editor.tsx:949) the result is
composited over vanillaDiffuse via `globalCompositeOperation = 'multiply'`, which is sound — but
the camo canvas is already 100% opaque flat colour, so multiply simply tints the stock texture
with the flat camo hue rather than preserving equipment. Result: tracks/tools/fittings receive the
same colour tint as the armour, and the blobs paint over every UV region equally.

**AI flat-patch path** (`generate-camo-diffusion.ts:130–145`): prompt explicitly requests
"Pattern fills the entire frame edge-to-edge." → SDXL generates a seamless tileable 1024² image
with NO UV awareness. `applyCamoImage` (Editor.tsx:1028–1034) draws it at `2048×2048` with a plain
`drawImage` — no mask, no stock-diffuse underlay. This completely replaces the entire atlas.

Both paths lack weathering and produce over-bright flat colours because there is no darkening,
dirt, or AO pass layered on top.

## Equipment Mask — Recommended Approach

**Use the existing bundled body masks** (`training/dataset/masks/full/<faction>_<vehicleId>.png`).
The infrastructure is already complete: `valid-coh2-texture.ts` (`generateValidCoh2Texture`, line 288)
does the full pipeline — vanilla atlas as img2img init → body mask load via `api.diffusion.getBodyMask`
(electron/diffusion.ts:402) → per-pixel composite `result = mask × generated + (1−mask) × vanilla`.
This guarantees equipment pixels are byte-identical to vanilla.

German and Soviet masks exist for most vehicles (see `training/dataset/masks/full/german_*.png`,
`soviet_*.png`). **The Honved skin uses German OKW/German vehicles** — check which vehicle IDs
map to the pack, then verify `getBodyMask('german', vehicleId)` returns non-null. When `maskApplied`
is false (TopBar.tsx:1276–1279), a toast already warns the user — that is the immediate signal
for the Honved pack vehicles missing masks.

Do NOT use the procedural `renderCamoPresetToOverlay` path for the Honved pack; use
`generateValidCoh2Texture` (requires diffusion engine + LoRA).

For the procedural fallback: restrict camo to body panels by replacing the multiply-over-vanilla
approach with: draw vanilla first, then draw camo blobs only inside regions NOT classified as
equipment — which requires a mask. The bundled PNGs are the most reliable source since they were
authored against the actual UV atlas.

## Stock-Diffuse Compositing — Where it happens

`renderCamoPresetToOverlay` in `Editor.tsx:949–979`:
```
vanillaDiffuse → composite canvas
  cctx.drawImage(vanillaDiffuseRef.current, 0, 0, 2048, 2048)  // line 960
  cctx.globalCompositeOperation = 'multiply'
  cctx.drawImage(camo, 0, 0)                                   // line 962
```
This IS compositing over the stock diffuse — the bug is that the camo is an opaque flat fill,
so multiply = tint, not "apply camo to armour only."

For AI path: `generateValidCoh2Texture` feeds vanilla atlas into img2img (strength 0.65) so the
stock diffuse's UV structure survives. The client-side `composite()` function (valid-coh2-texture.ts:196)
then restores equipment pixels exactly.

The stock diffuse is loaded from SGA via `readInstalledDecalImage` / vanilla RGT decode and
placed into `vanillaDiffuseRef.current` in Editor.tsx (see `TemplateDecalPills.tsx:414` for the
async load path).

## Weathering + Markings Hook-in Points

Both belong **after** the camo/mask composite and **before** the final `bumpOverlay()` call
(which uploads the texture to the GPU).

1. **Weathering layer**: insert between `cctx.drawImage(camo)` and `ctx.drawImage(composite)` in
   `renderCamoPresetToOverlay` (Editor.tsx:966–969). Draw a dirt/grime/AO PNG at low opacity
   (`globalAlpha ~0.3`, blend mode `multiply` or `overlay`) using the same UV-space masks.
   For AI path: add as a post-composite step in `generateValidCoh2Texture` after the `composite()`
   call (valid-coh2-texture.ts:328), drawing a weathering canvas over the final image before
   returning it.

2. **Tactical markings (Hungarian cross, numbers)**: use the existing decal system.
   `paintDecals(renderCtx, veh.decals, activeDecalId)` in `paintCanvas` (Editor.tsx:1129) is the
   final layer drawn on top of the base diffuse. Numbers/crosses are added as `DecalType` entries
   via `veh.decals`. The Hungarian cross would be a new decal type or an imported PNG sticker
   placed via the Decals panel — no pipeline change needed, just a new decal asset + placement.
   These render after camo and after weathering because `paintCanvas` reads `baseDiffuseRef`
   (which already holds the camo-composited result) and then stamps decals on top.
