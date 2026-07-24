# MTRL / Shader System Audit — Vehicle Materials

**Verified:** 2026-06-19  
**Source:** Binary decode of ArtHigh.sga (Tiger I, T-34/76) and ArtHighXP1.sga (M4A3E8 Easy 8),
plus Data.sga `shaderdatabase/coh2_vehicle.shader` + `coh2_vehicle_uvanim.shader`.

---

## 1. Shader names used by vehicle bodies

| Vehicle | Main body MTRL | Shader |
|---------|---------------|--------|
| Tiger I (GER) | `MAT_Tiger` | **`coh2_vehicle`** |
| T-34/76 (SOV) | `T34_76_Healthy` | **`coh2_vehicle`** |
| M4A3E8 Easy 8 (AEF) | `m4a3e8_sherman_easy_8` | **`coh2_vehicle`** |
| All tracks (all) | `MAT_Tiger_tread_L/R`, `T34_76_Healthy_Tread_*`, `tread_left/right` | `coh2_vehicle_uvanim` |
| Wrecked (Tiger, T-34) | `MAT_Tiger_Wrecked`, `T34_76_Wrecked`, `m4a3e8_..._wreck` | `coh2_object` or `coh2_vehicle` |

All living vehicle hulls across all three factions use **`coh2_vehicle`** without exception.

---

## 2. MTRL VAR bindings — `coh2_vehicle` material (Tiger I example, identical on all 3)

```
VAR type=9  diffusetex  → art\armies\german\vehicles\tiger\tiger_dif
VAR type=9  alphatex    → art\armies\german\vehicles\tiger\tiger_alp
VAR type=9  normalmap   → art\armies\german\vehicles\tiger\tiger_nrm
VAR type=9  glosstex    → art\armies\german\vehicles\tiger\tiger_gls
VAR type=9  speculartex → art\armies\german\vehicles\tiger\tiger_spc
VAR type=9  teamtex     → art\armies\german\badges\default_dif
VAR type=5  teamcolour  → 16 bytes all-zero (4 × float32 = 0,0,0,0)
```

Type 9 = texture path (lpstr). Type 5 = Vector4f encoded as a 16-byte lpstr blob.

---

## 3. Shader variable list (from `Data.sga/shaderdatabase/coh2_vehicle.shader`)

```
diffuseTex    Texture   Static
alphaTex      Texture   Static
normalMap     Texture   Static
glossTex      Texture   Static
specularTex   Texture   Static
teamTex       Texture   Static    ← decal/badge texture slot
teamColour    Vector4f  Static    ← RGBA tint applied to teamTex
EnvMapDiffuse Texture   Dynamic
EnvMapSpecular Texture  Dynamic
```

`coh2_vehicle_uvanim` (treads) drops `teamTex`/`teamColour` and adds `diffuse_OffsetU/V float Animated`.

---

## 4. Decal/teamcolor binding — is projection present?

**No projection matrix, UV scale/offset, or world-space placement params exist in the MTRL.**

The `teamtex` slot binds a flat 2D texture (`badges/default_dif`). `teamcolour` is a static RGBA Vector4f tint (all-zero = transparent/unset in the base game files). The shader samples the badge texture using the mesh's own UV1 channel (`component_list` declares `UV0, UV1`), not a projected coordinate.

**Conclusion:** Decal/badge placement is **not a material-level parameter**. The material binds only:
1. Which badge atlas texture to sample (`teamtex`)
2. A global RGBA tint for it (`teamcolour`)

UV positioning of the badge on the vehicle surface is determined by the mesh's UV1 unwrap at model-authoring time, which is baked into the `.rgm` geometry — not configurable in the MTRL chunk. The engine reads UV1 from the vertex buffer and the material provides no offset, matrix, or projection to relocate it at runtime.

---

## 5. TSET references

Each vehicle `.rgm` carries 16 TSET (texture-set) chunks naming the full set of available RGT files (`_dif`, `_alp`, `_nrm`, `_spc`, `_gls`, `_treads_*`, `_wrecked_*`). The `badges/default_dif` TSET is always present as the second entry. The MTRL `teamtex` VAR explicitly references that TSET path string.

---

## 6. Evidence summary

| Claim | Evidence |
|-------|----------|
| Shader = `coh2_vehicle` | FOLD/MTRL → DATA/INFO lpstr decoded from binary |
| teamtex binds badge atlas | VAR key=`teamtex` type=9 value=`art\armies\{faction}\badges\default_dif` |
| teamcolour is Vector4f tint | VAR key=`teamcolour` type=5, 16-byte payload = four 0.0 floats; shader def confirms `Vector4f` |
| No projection params | Exhaustive VAR enumeration: only 7 vars in main body MTRL, none are matrix/offset/UV scale |
| Badge UV is mesh-baked | `component_list = Position, Normal, Tangent, Binormal, UV0, UV1` in shader; no runtime UV transform |
