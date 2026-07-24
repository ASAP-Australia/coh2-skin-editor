# CoH2 Decal Projection — Game Shader & Data Reverse Engineering

## Summary

No world-space GPU decal projector exists for vehicle national insignia. The
"decal projection" is **UV-space texture painting on the vehicle diffuse**, not
a runtime screen-space or world-space projection pass.

---

## Shader pipeline for vehicles

**Shader name**: `coh2_vehicle`
**Source reference**: `coh2_vehicle.shader` extracted from
`CoH2/Archives/Data.sga` (Data.sga → file index `coh2_vehicle.shader`, 885 B)

Variable list (from `coh2_vehicle.shader`):
```
diffuseTex   – Texture  (Static)   main diffuse/albedo
alphaTex     – Texture  (Static)
normalMap    – Texture  (Static)
glossTex     – Texture  (Static)
specularTex  – Texture  (Static)
teamTex      – Texture  (Static)   team-color mask / _tem texture
teamColour   – Vector4f (Static)   RGBA player-team color constant
EnvMapDiffuse  – Texture (Dynamic)
EnvMapSpecular – Texture (Dynamic)
```

Compiled binary: `coh2_vehicle.fxo` (279,716 B, stored compressed in Data.sga).
String table of `coh2_vehicle.fxo` confirms samplers:
`DiffuseSampler`, `NormalMapSampler`, `TeamSampler`, bound to `diffuseTex`,
`teamTex`, `teamColour`, `HighlightColour_Diffuse`, `HighlightColour_Specular`.

Script references: both D3D9 and D3D11 databases point to `coh2_vehicle.fx`
(the source HLSL, not shipped — only the compiled `.fxo` is present in the
archive).

The technique list (`coh2_vehicle.fxstr`, 13,998 B) lists gbuffer modes
(`gbuffer`, `gbuffer|camouflage=on`, `gbuffer|artlow=on`, etc.) and lighting
modes. **No technique or pass name mentions decal, projector, national,
or insignia.**

---

## Tiger material assignments (confirmed from `tiger.rgm`)

`tiger.rgm` → ArtHigh.sga (518,804 B). MTRL chunks:

| Material       | Shader                |
|----------------|-----------------------|
| MAT_Tiger      | `coh2_vehicle`        |
| MAT_Tiger_tread_L | `coh2_vehicle_uvanim` |
| MAT_Tiger_tread_R | `coh2_vehicle_uvanim` |
| MAT_Tiger_Wrecked | `coh2_object`      |

Texture sets referenced (from tiger.rgm TSET):
```
art\armies\german\vehicles\tiger\tiger_dif
art\armies\german\vehicles\tiger\tiger_nrm
art\armies\german\vehicles\tiger\tiger_gls
art\armies\german\vehicles\tiger\tiger_spc
art\armies\german\vehicles\tiger\tiger_alp
```
No `_tem` (team texture) file is referenced in the base tiger.rgm — the team
texture binding is resolved by the engine at runtime from the skin-pack RGD.

---

## _tem textures (team-color mask)

The `teamTex` sampler binds to `*_tem.rgt` files. Examples found:
- `ArtWestGerman.sga`: `jagdtiger_tem.rgt` (11,898 B), `sturmtiger_tem.rgt`
  (11,928 B), `sturmtiger_tread_tem.rgt` (1,677 B)
- `ArtGermanEF.sga`: `grenadier_hat_tem.rgt`, `vehicle_crew_body_tem.rgt`, etc.
- `Data.sga`: `m8_tiger_hunting_overpaint_tem.rgt` (11,935 B)

These are small textures (1–12 KB) that encode a single-channel mask defining
which UV pixels receive the player's `teamColour` tint. They are UV-space
masks, not world-space projectors.

---

## attrib\vehicle_decal RGD files — what they actually are

Files in `AttribArchive.sga` → folder `attrib\vehicle_decal` (file indices
11882–11901) include `gcs_decal_german.rgd`, `halloween_decal_01.rgd`,
`stripes_only.rgd`, etc.

Hex analysis of `gcs_decal_german.rgd` (432 B, Chunky DATAAEGD v1):
- References `DATA:\art\armies\common\badges\gcs_german_dif` — a **badge/
  emblem texture** placed as a **2D ground decal** on the battlefield (circle
  marker under a unit), NOT a vehicle skin decal.
- Contains `server_item.lua` path and faction string `german` — inventory/
  store item descriptor.
- No projector matrix, no UV rect, no vehicle reference.

These are **in-game UI/cosmetic ground markers** sold in the store. They are
entirely unrelated to vehicle skin national insignia.

---

## terraindecal shader

`terraindecal.shader` (331 B, Data.sga): only `diffuseTex` + `UV0`. Script
references `terraindecal.fx`. This is the ground-projection decal system
(blood splats, road decals, hedgerow markings, battlefield circle markers).
Vehicle insignia do not use this path.

---

## Where decal/insignia positioning comes from

The decal positions are **not engine-driven, not data-file driven, not shader
constants**. They are painted directly into the vehicle diffuse texture
(`*_dif.rgt`) at specific **UV pixel rectangles** that correspond to physical
hull surfaces.

The UV rect for each vehicle is determined by the mesh UV unwrap (authored in
3ds Max, baked into the RGM geometry at art time). The skin editor project
tracks these per-vehicle as hand-authored/reverse-engineered JSON files:

```
src/lib/vehicle-uv-regions/king_tiger_sdkfz_182.json  → hullSideRight {x:410, y:1320, w:360, h:340}
src/lib/vehicle-uv-regions/tiger.json
src/lib/vehicle-uv-regions/t34_76.json
... (16 vehicles total)
```

The King Tiger's `hullSideRight` rect was confirmed against the SS Totenkopf
community skin's Balkenkreuz placement at UV pixel ~(590, 1490).

---

## Conclusion

| Question | Answer |
|----------|--------|
| Is there a GPU world-space decal projector for insignia? | **No** |
| Where do projector positions come from? | **They don't exist.** Insignia is UV-painted. |
| What shader handles vehicles? | `coh2_vehicle` (Data.sga → `coh2_vehicle.fxo`, 280 KB compiled) |
| What is `teamTex`? | UV-space team-color mask (`*_tem.rgt`, 1–12 KB) |
| What is `terraindecal`? | Ground-projection system (road marks, battle markers). Not used for vehicles. |
| What are `attrib\vehicle_decal` RGDs? | Store inventory descriptors for in-game ground markers, not vehicle skins. |
| Where does the insignia rect come from? | Art-time UV unwrap in the RGM mesh, hand-catalogued per vehicle in `vehicle-uv-regions/*.json`. |

---

## Key file paths

| File | Archive | Note |
|------|---------|------|
| `coh2_vehicle.shader` | `Data.sga` | Vehicle shader variable/technique declaration |
| `coh2_vehicle.fxo` | `Data.sga` | Compiled D3D9+D3D11 binary shader (280 KB) |
| `coh2_vehicle.fxstr` | `Data.sga` | Technique/parameter binary dictionary (14 KB) |
| `terraindecal.shader` | `Data.sga` | Ground projection system (unrelated to vehicles) |
| `tiger.rgm` | `ArtHigh.sga` | Tiger mesh with MTRL → `coh2_vehicle` binding |
| `jagdtiger_tem.rgt` | `ArtWestGerman.sga` | Example _tem team-color mask (12 KB) |
| `gcs_decal_german.rgd` | `AttribArchive.sga` | Store ground-marker item (NOT vehicle insignia) |
| `king_tiger_sdkfz_182.json` | `src/lib/vehicle-uv-regions/` | UV rect data for decal placement |
