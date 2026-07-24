# Honved Skin — Redesign Plan (Implementer Brief)

## Self-Contained Summary
Fix: camo paints over equipment, flat/over-bright, no weathering, no markings, not historical.
Root cause: both paths (procedural + AI) overwrite the entire atlas without UV masking.

---

## 1. Generation Pipeline — Ordered Stages

### Stage A — Start From Stock Diffuse (MANDATORY)
**Do NOT clear the canvas.** In `Editor.tsx:949–979` (`renderCamoPresetToOverlay`), the `vanillaDiffuseRef.current` draw at line 960 is correct; the bug is what follows.
For the AI path use `generateValidCoh2Texture` (`valid-coh2-texture.ts:288`) with `img2img strength 0.55` (lower than current 0.65 to preserve more stock UV detail for this pack's Panzer III/IV–class vehicles).

### Stage B — Equipment Mask (Armor-Only Camo)
**Source**: bundled body masks at `training/dataset/masks/full/german_<vehicleId>.png` loaded via `api.diffusion.getBodyMask('german', vehicleId)` (`electron/diffusion.ts:402`).

**Procedural path fix** (`camo-generator.ts:173–195`):
1. Remove `ctx.clearRect` + opaque base fill.
2. Replace with: draw vanilla diffuse first, then draw each camo blob with `globalCompositeOperation = 'source-atop'` clipped to mask region, so non-armor pixels (tracks, tools, fittings) remain byte-identical to vanilla.

**AI path** (already correct in `generateValidCoh2Texture`): per-pixel `result = mask × generated + (1−mask) × vanilla` at `valid-coh2-texture.ts:196` (`composite()` function). Verify `maskApplied` flag; if toast fires (TopBar.tsx:1276–1279), the vehicle is missing a German mask — must author one before shipping the pack.

### Stage C — Historical Hungarian 3-Tone Camo
Pattern: **Soft-edge irregular blotches** (not stripes), per Hungarian 1943–44 factory schemes.

| Role        | Color Name        | Hex       | RGB            |
|-------------|-------------------|-----------|----------------|
| Base        | Dark Green (Zöld) | `#3D4A2B` | 61, 74, 43     |
| Mid blotch  | Earth Brown (Barna)| `#6B4A28` | 107, 74, 40   |
| Accent blotch | Sand/Ochre (Sárga)| `#8C7040` | 140, 112, 64  |

Blob size: 12–18% of canvas width (200–370px on 2048 atlas), irregular polygon edges, ~30 blotches per pass. Apply only to armor mask region (Stage B).

SDXL prompt addition (AI path): `"Hungarian Honved army 1944 tank camouflage, dark green base with irregular brown and ochre blotches, matte finish, no gloss"` — remove current `"Pattern fills the entire frame edge-to-edge"` phrase from `generate-camo-diffusion.ts:130–145`.

### Stage D — Mute/Desaturate to Period Tone
After camo composite, apply a `hue-rotate(0deg) saturate(0.65) brightness(0.82)` CSS filter (or equivalent canvas pixel pass) to the armor region. This kills the video-game brightness and gives the faded wartime matte look. Hook: add as a `CanvasRenderingContext2D.filter` before `ctx.drawImage(composite)` in `renderCamoPresetToOverlay` (Editor.tsx:966–969).

### Stage E — Weathering Layer Stack
Insert **after** `cctx.drawImage(camo)` and **before** `ctx.drawImage(composite)` in `renderCamoPresetToOverlay` (Editor.tsx:966–969). For AI path: after `composite()` at `valid-coh2-texture.ts:328`.

Draw weathering PNGs as canvas overlays (store assets at `src/assets/weathering/honved/`):

| Layer       | Blend Mode | Alpha | Asset filename            | Region              |
|-------------|------------|-------|---------------------------|---------------------|
| Dust/mud    | multiply   | 0.35  | `mud_lower_hull.png`      | lower 30% of atlas  |
| Exhaust     | overlay    | 0.25  | `exhaust_streak.png`      | engine deck UV zone |
| Rain streaks| overlay    | 0.20  | `rain_vertical.png`       | upper hull panels   |
| Sun fade    | screen     | 0.15  | `sun_fade_top.png`        | top-facing surfaces |
| Dirt recess | multiply   | 0.40  | `dirt_ao.png`             | full armor mask     |

All PNGs are grayscale-tiled 512² tiled to 2048². Source from CC0 texture libraries (Poly Haven grunge/dirt maps).

### Stage F — Edge Chipping / Scratches / Bare Metal
Draw a `scratch_chips.png` (grayscale edge-wear map, sourced from CC0 or procedurally generated) at `globalAlpha 0.5`, blend mode `hard-light`. Then draw `bare_metal_reveal.png` (bright silver-grey `#8A8A8A`) at `globalAlpha 0.25` clipped to the same mask — this simulates paint worn to steel on high-contact edges. Hook: same layer stack as Stage E, drawn last in the weathering sequence.

### Stage G — Tactical Markings
Use the existing decal system: `paintDecals(renderCtx, veh.decals, activeDecalId)` in `paintCanvas` (Editor.tsx:1129), which stamps after the base diffuse is set.

**Hungarian national marking**: White-bordered black cross (Kereszt) — the Hungarian Cross, NOT the German Balkenkreuz. Add as a new `DecalType: 'hungarian_cross'` PNG asset (`src/assets/decals/hungarian_cross.png`, 256×256, white outline 8px, black fill). Placement: hull side panels, upper right, approximately UV coords (0.62, 0.38) on the German Panzer diffuse atlas.

**Tactical numbers**: White stencil font, 2–3 digits, placement left-front hull. Add as `DecalType: 'tactical_number'` with a configurable number string rendered via `ctx.fillText` in `paintDecals`, font `"bold 96px Arial"`, color `#FFFFFF`, stroke `#000000` 4px, position UV (0.15, 0.42).

---

## 2. Files / Functions to Change

| File | Change |
|------|--------|
| `camo-generator.ts:173–195` | Remove clearRect + opaque fill; implement mask-clipped blob drawing |
| `generate-camo-diffusion.ts:130–145` | Fix SDXL prompt; remove "edge-to-edge" phrase; add Hungarian camo description |
| `Editor.tsx:949–979` (`renderCamoPresetToOverlay`) | Add desaturate filter (Stage D) + weathering layer stack (Stage E+F) after camo composite |
| `valid-coh2-texture.ts:328` (after `composite()`) | Add weathering pass for AI path |
| `Editor.tsx:1129` (`paintDecals`) | Add `hungarian_cross` and `tactical_number` DecalType handlers |
| New: `src/assets/weathering/honved/*.png` | 6 weathering map assets (see Stage E table) |
| New: `src/assets/decals/hungarian_cross.png` | Hungarian cross national marking |

---

## 3. Compositing Order (Final)

```
1. vanillaDiffuse (full 2048×2048)
2. camo blobs (armor mask only, Stage B+C)
3. desaturate filter (Stage D)
4. mud/dust (Stage E, multiply 0.35)
5. exhaust streaks (Stage E, overlay 0.25)
6. rain streaks (Stage E, overlay 0.20)
7. sun fade (Stage E, screen 0.15)
8. dirt AO (Stage E, multiply 0.40)
9. scratch chips + bare metal (Stage F, hard-light 0.5 / normal 0.25)
10. decals: hungarian_cross + tactical_number (Stage G, normal 1.0)
11. bumpOverlay() → GPU upload
```

---

## 4. Verification (CDP Checklist)

- [ ] Tracks and road wheels retain vanilla color/detail (no camo tint)
- [ ] Tools (shovel, spare track links, jerry cans) retain vanilla texture
- [ ] Armor panels show dark green base + brown + ochre blotches, NOT uniform flat color
- [ ] Overall tone is desaturated/dark (not video-game bright)
- [ ] Lower hull shows mud accumulation
- [ ] Exhaust port shows streaking
- [ ] Hull edges show chip/scratch marks with metal color underneath
- [ ] Hungarian Cross visible on hull side, correct shape (NOT Balkenkreuz)
- [ ] Tactical number visible, white stencil with black outline
- [ ] `maskApplied` toast does NOT fire (mask resolved for all pack vehicles)

---

## 5. Top Risk

**Missing German body masks for Honved vehicle IDs.** The pack likely uses vehicle IDs that don't have a corresponding `german_<vehicleId>.png` in `training/dataset/masks/full/`. If `getBodyMask('german', vehicleId)` returns null, the equipment preservation entirely fails. **Verify this first** before any other work — run `api.diffusion.getBodyMask('german', vehicleId)` for each vehicle in the Honved pack and author missing masks (manually paint UV-space PNGs against the vanilla atlas) before implementing the pipeline changes. Without masks, Stage B cannot work and all other improvements are partial.
