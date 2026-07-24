# Vehicle Catalog — CoH2 Skin Editor

**Catalog source:** `src/lib/vehicles.ts` — `VEHICLES` array (lines 44–117)
**Model-path function:** `rgmPath(v)` at line 151–157
**Folder-alias map:** `VEHICLE_FOLDER_ALIAS` at line 140–144

## Resolution Pattern

All vehicle diffuse atlases are **2048×2048 px** (confirmed: `src/lib/mod-export.ts:224`, `src/lib/vehicle-uv-registry.ts:4`). The editor always composites to a fixed `2048² canvas` regardless of the native RGT resolution on disk.

## SGA Source Archives

The renderer searches these SGA archives (in order) via `src/lib/structure-loader.ts:44–54` and `Viewport.tsx`:
- `ArtHigh.sga`, `ArtHighXP1.sga`, `ArtHighXP2.sga`, `ArtArmies.sga`
- `ArtGermanEF.sga` (OstHeer), `ArtSovietEF.sga` (Soviet), `ArtAEF.sga` (USF), `ArtBritish.sga` (UKF), `ArtWestGerman.sga` (OKW)

## Vehicle-ID → Model-Path Resolution

```
rgmPath(v) = `art/armies/${v.faction}/vehicles/${folder}/${folder}.rgm`
```
where `folder = VEHICLE_FOLDER_ALIAS[v.id] ?? v.id`

**Active aliases (id ≠ folder):**
| Vehicle ID  | On-disk folder      | SGA         |
|-------------|---------------------|-------------|
| `centaur`   | `centaur_aa`        | ArtBritish  |
| `t_34_85`   | `t34_85`            | ArtSovietEF |
| `valentine` | `valentine_command` | ArtBritish  |

The shared id `halftrack` appears for both `german` (Sd.Kfz. 251) and `soviet` (Lend-Lease Truck); `findVehicleSpec()` uses faction hints to disambiguate.

## Full Vehicle Table (61 total)

### OstHeer / `german` — 10 vehicles

| Vehicle ID             | Display Name  | Class       | RGM Path |
|------------------------|---------------|-------------|----------|
| `tiger`                | Tiger I       | heavy       | `art/armies/german/vehicles/tiger/tiger.rgm` |
| `elefant`              | Elefant       | super_heavy | `art/armies/german/vehicles/elefant/elefant.rgm` |
| `brummbar`             | Brummbär      | heavy       | `art/armies/german/vehicles/brummbar/brummbar.rgm` |
| `stug_iii`             | StuG III      | medium      | `art/armies/german/vehicles/stug_iii/stug_iii.rgm` |
| `ostwind_flak_panzer`  | Ostwind       | medium      | `art/armies/german/vehicles/ostwind_flak_panzer/ostwind_flak_panzer.rgm` |
| `panzerwerfer`         | Panzerwerfer  | medium      | `art/armies/german/vehicles/panzerwerfer/panzerwerfer.rgm` |
| `halftrack`            | Sd.Kfz. 251   | utility     | `art/armies/german/vehicles/halftrack/halftrack.rgm` |
| `sdkfz_250`            | Sd.Kfz. 250   | utility     | `art/armies/german/vehicles/sdkfz_250/sdkfz_250.rgm` |
| `sdkfz_222`            | Sd.Kfz. 222   | light       | `art/armies/german/vehicles/sdkfz_222/sdkfz_222.rgm` |
| `opel_blitz`           | Opel Blitz    | utility     | `art/armies/german/vehicles/opel_blitz/opel_blitz.rgm` |

### OKW / `west_german` — 13 vehicles

| Vehicle ID                       | Display Name        | Class       | RGM Path |
|----------------------------------|---------------------|-------------|----------|
| `king_tiger_sdkfz_182`           | King Tiger          | super_heavy | `art/armies/west_german/vehicles/king_tiger_sdkfz_182/king_tiger_sdkfz_182.rgm` |
| `jagdtiger`                      | Jagdtiger           | super_heavy | `art/armies/west_german/vehicles/jagdtiger/jagdtiger.rgm` |
| `sturmtiger`                     | Sturmtiger          | heavy       | `art/armies/west_german/vehicles/sturmtiger/sturmtiger.rgm` |
| `panther_ausf_g`                 | Panther             | heavy       | `art/armies/west_german/vehicles/panther_ausf_g/panther_ausf_g.rgm` |
| `jagdpanzer_iv_sdkfz_162`        | Jagdpanzer IV       | medium      | `art/armies/west_german/vehicles/jagdpanzer_iv_sdkfz_162/jagdpanzer_iv_sdkfz_162.rgm` |
| `panzer_iv_sdkfz_ausf_i`         | Panzer IV           | medium      | `art/armies/west_german/vehicles/panzer_iv_sdkfz_ausf_i/panzer_iv_sdkfz_ausf_i.rgm` |
| `hetzer`                         | Hetzer              | medium      | `art/armies/west_german/vehicles/hetzer/hetzer.rgm` |
| `puma_sdkfz_234`                 | Puma                | light       | `art/armies/west_german/vehicles/puma_sdkfz_234/puma_sdkfz_234.rgm` |
| `panzer_ii_luchs_sdkfz_123`      | Luchs               | light       | `art/armies/west_german/vehicles/panzer_ii_luchs_sdkfz_123/panzer_ii_luchs_sdkfz_123.rgm` |
| `kubelwagen`                     | Kübelwagen          | utility     | `art/armies/west_german/vehicles/kubelwagen/kubelwagen.rgm` |
| `halftrack_sdkfz_251`            | Sd.Kfz. 251         | utility     | `art/armies/west_german/vehicles/halftrack_sdkfz_251/halftrack_sdkfz_251.rgm` |
| `halftrack_sdkfz_251_flak`       | Sd.Kfz. 251 Flak    | utility     | `art/armies/west_german/vehicles/halftrack_sdkfz_251_flak/halftrack_sdkfz_251_flak.rgm` |
| `halftrack_sdkfz_251_infrared`   | Sd.Kfz. 251 IR      | utility     | `art/armies/west_german/vehicles/halftrack_sdkfz_251_infrared/halftrack_sdkfz_251_infrared.rgm` |

### Soviet / `soviet` — 12 vehicles

| Vehicle ID          | Display Name        | Class       | RGM Path |
|---------------------|---------------------|-------------|----------|
| `is2m_heavy_tank`   | IS-2                | heavy       | `art/armies/soviet/vehicles/is2m_heavy_tank/is2m_heavy_tank.rgm` |
| `isu152`            | ISU-152             | super_heavy | `art/armies/soviet/vehicles/isu152/isu152.rgm` |
| `kv1_heavy_tank`    | KV-1                | heavy       | `art/armies/soviet/vehicles/kv1_heavy_tank/kv1_heavy_tank.rgm` |
| `kv2_heavy_tank`    | KV-2                | heavy       | `art/armies/soviet/vehicles/kv2_heavy_tank/kv2_heavy_tank.rgm` |
| `t34_76`            | T-34/76             | medium      | `art/armies/soviet/vehicles/t34_76/t34_76.rgm` |
| `t_34_85`           | T-34/85             | medium      | `art/armies/soviet/vehicles/t34_85/t34_85.rgm` _(alias)_ |
| `t70m_light_tank`   | T-70                | light       | `art/armies/soviet/vehicles/t70m_light_tank/t70m_light_tank.rgm` |
| `su85`              | SU-85               | medium      | `art/armies/soviet/vehicles/su85/su85.rgm` |
| `su-76m`            | SU-76M              | medium      | `art/armies/soviet/vehicles/su-76m/su-76m.rgm` |
| `m3a1_scout_car`    | M3A1 Scout          | light       | `art/armies/soviet/vehicles/m3a1_scout_car/m3a1_scout_car.rgm` |
| `halftrack`         | Lend-Lease Truck    | utility     | `art/armies/soviet/vehicles/halftrack/halftrack.rgm` _(shared id — disambiguated by faction hint)_ |
| `us6_truck`         | US6 Studebaker      | utility     | `art/armies/soviet/vehicles/us6_truck/us6_truck.rgm` |

### USF / `aef` — 17 vehicles

| Vehicle ID                 | Display Name     | Class   | RGM Path |
|----------------------------|------------------|---------|----------|
| `m26_pershing`             | Pershing         | heavy   | `art/armies/aef/vehicles/m26_pershing/m26_pershing.rgm` |
| `m4a3e8_sherman_easy_8`    | Easy 8           | medium  | `art/armies/aef/vehicles/m4a3e8_sherman_easy_8/m4a3e8_sherman_easy_8.rgm` |
| `m4a3_sherman_76mm`        | Sherman 76mm     | medium  | `art/armies/aef/vehicles/m4a3_sherman_76mm/m4a3_sherman_76mm.rgm` |
| `m4a1_sherman_calliope`    | Calliope         | medium  | `art/armies/aef/vehicles/m4a1_sherman_calliope/m4a1_sherman_calliope.rgm` |
| `m10_tank_destroyer`       | M10 Wolverine    | medium  | `art/armies/aef/vehicles/m10_tank_destroyer/m10_tank_destroyer.rgm` |
| `m36_tank_destroyer`       | M36 Jackson      | medium  | `art/armies/aef/vehicles/m36_tank_destroyer/m36_tank_destroyer.rgm` |
| `m5a1_stuart`              | M5 Stuart        | light   | `art/armies/aef/vehicles/m5a1_stuart/m5a1_stuart.rgm` |
| `m8_greyhound`             | Greyhound        | light   | `art/armies/aef/vehicles/m8_greyhound/m8_greyhound.rgm` |
| `m7b1_priest`              | Priest           | medium  | `art/armies/aef/vehicles/m7b1_priest/m7b1_priest.rgm` |
| `m3_halftrack`             | M3 Halftrack     | utility | `art/armies/aef/vehicles/m3_halftrack/m3_halftrack.rgm` |
| `m15a1_aa_halftrack`       | AA Halftrack     | utility | `art/armies/aef/vehicles/m15a1_aa_halftrack/m15a1_aa_halftrack.rgm` |
| `m8a1_hmc`                 | M8 Scott         | medium  | `art/armies/aef/vehicles/m8a1_hmc/m8a1_hmc.rgm` |
| `m20_utility_car`          | M20              | light   | `art/armies/aef/vehicles/m20_utility_car/m20_utility_car.rgm` |
| `m21_mortar_halftrack`     | M21 Mortar HT    | utility | `art/armies/aef/vehicles/m21_mortar_halftrack/m21_mortar_halftrack.rgm` |
| `dodge_wc51`               | Dodge WC51       | utility | `art/armies/aef/vehicles/dodge_wc51/dodge_wc51.rgm` |
| `dodge_wc54_ambulance`     | WC54 Ambulance   | utility | `art/armies/aef/vehicles/dodge_wc54_ambulance/dodge_wc54_ambulance.rgm` |
| `sherman_m4a3`             | M4A3 Sherman     | medium  | `art/armies/aef/vehicles/sherman_m4a3/sherman_m4a3.rgm` |

### UKF / `british` — 9 vehicles

| Vehicle ID        | Display Name      | Class   | RGM Path |
|-------------------|-------------------|---------|----------|
| `churchill`       | Churchill         | heavy   | `art/armies/british/vehicles/churchill/churchill.rgm` |
| `comet`           | Comet             | medium  | `art/armies/british/vehicles/comet/comet.rgm` |
| `cromwell`        | Cromwell          | medium  | `art/armies/british/vehicles/cromwell/cromwell.rgm` |
| `centaur`         | Centaur AA        | medium  | `art/armies/british/vehicles/centaur_aa/centaur_aa.rgm` _(alias)_ |
| `sherman_firefly` | Firefly           | medium  | `art/armies/british/vehicles/sherman_firefly/sherman_firefly.rgm` |
| `valentine`       | Valentine         | light   | `art/armies/british/vehicles/valentine_command/valentine_command.rgm` _(alias)_ |
| `sexton`          | Sexton SPG        | medium  | `art/armies/british/vehicles/sexton/sexton.rgm` |
| `aec_armoured_car`| AEC Armoured Car  | light   | `art/armies/british/vehicles/aec_armoured_car/aec_armoured_car.rgm` |
| `bren_carrier`    | Universal Carrier | utility | `art/armies/british/vehicles/bren_carrier/bren_carrier.rgm` |

## Summary

| Faction     | Count |
|-------------|-------|
| USF (aef)   | 17    |
| OKW         | 13    |
| Soviet      | 12    |
| OstHeer     | 10    |
| UKF         | 9     |
| **TOTAL**   | **61** |

## Diffuse Atlas Resolution

All editing and export uses a fixed **2048×2048 px** canvas (see `src/lib/mod-export.ts:224`, `src/lib/brush.ts:91`, `src/lib/vehicle-uv-registry.ts:4`). The native RGT files on disk may be smaller (loaded via `decodeRgt` → `bcToCanvas`, width/height from RGT header), but the editor always normalises to 2048².
