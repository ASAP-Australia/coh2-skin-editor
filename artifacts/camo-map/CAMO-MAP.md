# Per-Vehicle Camo Classification Map — Review Table

Generated from `artifacts/camo-map/submesh-inventory.json` + the per-batch classifications.

Consumed by `src/lib/camo-mask.ts` via `src/lib/camo-vehicle-map.json`.


**Class semantics:** `armor` = camo painted (included). 
`tracks` / `wheels` / `equipment` / `wreck` / `other-excluded` = camo erased (excluded, vanilla restored).


## Summary

- Vehicles: **61**  |  Total submesh entries: **618**
- Included (armor, camo YES): **164**
- Excluded (camo NO): **454**  (tracks 102, wheels 131, equipment 26, wreck 195, other-excluded 0)
- Inventory coverage: **618/618** submeshes mapped (0 pattern-fallback hits).



## OstHeer (german)

### Brummbär — `brummbar` (mrgm-v8, 5 submeshes)

armor 2 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[brummbar,Brummbar_Tread_Left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[brummbar,Brummbar_Panels]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[brummbar,Brummbar_Body]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[brummbar,Brummbar_Wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[brummbar,Brummbar_Tread_Right]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Elefant — `elefant` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[elefant,Elefant_Tank_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[elefant,Elefant_critical_tre...` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[elefant,Elefant_Tank_tread_R]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[elefant,Elefant_Tank_tread_L]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[elefant,Elefant_Tank]` | armor | YES | Main hull/superstructure body — primary camo target |

### Opel Blitz — `opel_blitz` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[opel_blitz,Opel_Blitz_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[opel_blitz,Opel_Blitz]` | armor | YES | Main hull/superstructure body — primary camo target |

### Ostwind — `ostwind_flak_panzer` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[ostwind_flak_panzer,MAT_Ostw...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[ostwind_flak_panzer,MAT_Ostw...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[ostwind_flak_panzer,MAT_Ostw...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[ostwind_flak_panzer,MAT_Ostw...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Panzerwerfer — `panzerwerfer` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[panzerwerfer,German_SdKfz_4-...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[panzerwerfer,Panzerwerfer_cr...` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[panzerwerfer,panzerwerfer_wr...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[panzerwerfer,German_SdKfz_4-...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[panzerwerfer,German_SdKfz_4-...` | armor | YES | Main hull/superstructure body — primary camo target |

### Sd.Kfz. 222 — `sdkfz_222` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[sdkfz_222,Sdkfz_222]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[sdkfz_222,Sdkfz_222_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Sd.Kfz. 250 — `sdkfz_250` (mrgm-v8, 6 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 1 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[sdkfz_250,SHD_AX_Granatwerfe...` | equipment | no | Mounted weapon/MG kit — excluded |
| `merged material-[sdkfz_250,SHW_sdkfz_250]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[sdkfz_250,SHD_Tread_Right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[sdkfz_250,Critical_Treads]` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[sdkfz_250,SHW_250_Wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[sdkfz_250,SHD_Tread_Left]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Sd.Kfz. 251 — `halftrack` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[halftrack,MAT_Halftrack_trea...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack,MAT_Halftrack_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[halftrack,MAT_Halftrack_trea...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack,Halftrack_critical...` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[halftrack,MAT_Halftrack]` | armor | YES | Main hull/superstructure body — primary camo target |

### StuG III — `stug_iii` (mrgm-v8, 5 submeshes)

armor 2 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[stug_iii,stug_iii]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[stug_iii,sug_iii_turrets]` | armor | YES | Turret armor |
| `merged material-[stug_iii,stug_iii_tread_L]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[stug_iii,stug_iii_tread_R]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[stug_iii,stug_iii_wrecked]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Tiger I — `tiger` (trim-v5, 75 submeshes)

armor 21 · tracks 3 · wheels 27 · equipment 3 · wreck 21

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `Crushed_Mesh_01` | wreck | no | Crushed destruction chunk — keep vanilla |
| `geo_tread_left` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `geo_tread_right` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `Crushed_Mesh_02` | wreck | no | Crushed destruction chunk — keep vanilla |
| `Crushed_Mesh_03` | wreck | no | Crushed destruction chunk — keep vanilla |
| `Wrecked_Hull` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `geo_Engine_Vent_L` | armor | YES | Engine deck / access door — armor |
| `geo_Engine_door_Goblins` | armor | YES | Engine deck / access door — armor |
| `geo_Engine_door` | armor | YES | Engine deck / access door — armor |
| `geo_Hull_Hatch_L` | armor | YES | Armor hatch plate |
| `geo_Hull_Hatch_R` | armor | YES | Armor hatch plate |
| `Wrecked_Tiger_Turret` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `geo_Turret_Hatch_Loaders` | armor | YES | Armor hatch plate |
| `geo_Turret_Barrel_End` | armor | YES | Turret armor |
| `wreck_barrel` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `geo_Turret_Barrel` | armor | YES | Turret armor |
| `wreck_mantlet` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `geo_Turret_Goblins` | armor | YES | Turret armor |
| `geo_Turret_smoke_launcher` | armor | YES | Turret armor |
| `geo_Turret` | armor | YES | Turret armor |
| `geo_Turret_Back` | armor | YES | Turret armor |
| `GEO_MG42_Pintle` | equipment | no | Mounted weapon/MG kit — excluded |
| `geo_Turret_Hatch_Upper` | armor | YES | Armor hatch plate |
| `geo_Turret_Hatch_Upper_Goblins` | armor | YES | Armor hatch plate |
| `geo_Wheel_L01` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_L10` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R10` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R01` | wheels | no | Road wheel — running gear, excluded |
| `geo_Body_Goblins` | armor | YES | Main hull/superstructure body — primary camo target |
| `geo_Hull` | armor | YES | Main hull/superstructure body — primary camo target |
| `geo_Body_Chunks_MS` | armor | YES | Main hull/superstructure body — primary camo target |
| `geo_Accessory_Cable` | equipment | no | Stowed tow cable / kit — excluded |
| `geo_Cockpit_Goblins` | armor | YES | Front superstructure/plate — armor |
| `geo_Engine_Vent_R` | armor | YES | Engine deck / access door — armor |
| `geo_Front_treads` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `geo_Hull_MG42` | equipment | no | Mounted weapon/MG kit — excluded |
| `geo_Wheel_L07` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_L08` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_L09` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_L02` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_L03` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_L04` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_L05` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_L06` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R04` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R03` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R02` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R09` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R08` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R07` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R06` | wheels | no | Road wheel — running gear, excluded |
| `geo_Wheel_R05` | wheels | no | Road wheel — running gear, excluded |
| `critical_tread_LM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF3` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB3` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF3` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB3` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `orphans_wheel_06` | wheels | no | Detached road-wheel variant — excluded |
| `orphans_wheel_04` | wheels | no | Detached road-wheel variant — excluded |
| `orphans_wheel_07` | wheels | no | Detached road-wheel variant — excluded |
| `orphans_wheel_05` | wheels | no | Detached road-wheel variant — excluded |
| `orphans_wheel_03` | wheels | no | Detached road-wheel variant — excluded |
| `orphans_wheel_02` | wheels | no | Detached road-wheel variant — excluded |
| `orphans_wheel_01` | wheels | no | Detached road-wheel variant — excluded |
| `orphan_Hatch_R` | armor | YES | Armor hatch plate |
| `orphan_Hatch_L` | armor | YES | Armor hatch plate |


## OKW (west_german)

### Hetzer — `hetzer` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[hetzer,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[hetzer,hetzer_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[hetzer,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[hetzer,hetzer]` | armor | YES | Main hull/superstructure body — primary camo target |

### Jagdpanzer IV — `jagdpanzer_iv_sdkfz_162` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[jagdpanzer_iv_sdkfz_162,jagd...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[jagdpanzer_iv_sdkfz_162,trea...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[jagdpanzer_iv_sdkfz_162,trea...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[jagdpanzer_iv_sdkfz_162,jagd...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Jagdtiger — `jagdtiger` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[jagdtiger,jagdtiger]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[jagdtiger,jagdtiger_wreak]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[jagdtiger,left_tread]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[jagdtiger,right_tread]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### King Tiger — `king_tiger_sdkfz_182` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[king_tiger_sdkfz_182,tread_r...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[king_tiger_sdkfz_182,king_ti...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[king_tiger_sdkfz_182,tread_l...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[king_tiger_sdkfz_182,king_ti...` | armor | YES | Main hull/superstructure body — primary camo target |

### Kübelwagen — `kubelwagen` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[kubelwagen,kubelwagen_wrecked]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[kubelwagen,kubelwagen]` | armor | YES | Main hull/superstructure body — primary camo target |

### Luchs — `panzer_ii_luchs_sdkfz_123` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[panzer_ii_luchs_sdkfz_123,pa...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[panzer_ii_luchs_sdkfz_123,GE...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[panzer_ii_luchs_sdkfz_123,pa...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[panzer_ii_luchs_sdkfz_123,GE...` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Panther — `panther_ausf_g` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[panther_ausf_g,Panther_tread_L]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[panther_ausf_g,Panther_body]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[panther_ausf_g,Panther_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[panther_ausf_g,Panther_criti...` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[panther_ausf_g,Panther_tread_R]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Panzer IV — `panzer_iv_sdkfz_ausf_i` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[panzer_iv_sdkfz_ausf_i,tread...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[panzer_iv_sdkfz_ausf_i,panze...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[panzer_iv_sdkfz_ausf_i,tread...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[panzer_iv_sdkfz_ausf_i,panze...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[panzer_iv_sdkfz_ausf_i,tread...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Puma — `puma_sdkfz_234` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[puma_sdkfz_234,puma_234_heal...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[puma_sdkfz_234,puma_234_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Sd.Kfz. 251 — `halftrack_sdkfz_251` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[halftrack_sdkfz_251,treads_l...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack_sdkfz_251,sdkfz251...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[halftrack_sdkfz_251,treads_r...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack_sdkfz_251,sdkfz251...` | armor | YES | Main hull/superstructure body — primary camo target |

### Sd.Kfz. 251 Flak — `halftrack_sdkfz_251_flak` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[halftrack_sdkfz_251_flak,tre...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack_sdkfz_251_flak,hal...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[halftrack_sdkfz_251_flak,tre...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack_sdkfz_251_flak,hal...` | armor | YES | Main hull/superstructure body — primary camo target |

### Sd.Kfz. 251 IR — `halftrack_sdkfz_251_infrared` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[halftrack_sdkfz_251_infrared...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[halftrack_sdkfz_251_infrared...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack_sdkfz_251_infrared...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[halftrack_sdkfz_251_infrared...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack_sdkfz_251_infrared...` | wreck | no | Critical-damage mesh — keep vanilla look |

### Sturmtiger — `sturmtiger` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[sturmtiger,tread_critical]` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[sturmtiger,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[sturmtiger,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[sturmtiger,sturmtiger]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[sturmtiger,sturmtiger_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |


## Soviet

### IS-2 — `is2m_heavy_tank` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[is2m_heavy_tank,is2m_heavy_t...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[is2m_heavy_tank,is2m_heavy_t...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[is2m_heavy_tank,is2m_heavy_t...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[is2m_heavy_tank,is2m_tread_c...` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[is2m_heavy_tank,is2m_heavy_t...` | armor | YES | Main hull/superstructure body — primary camo target |

### ISU-152 — `isu152` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[isu152,ISU152_Healthy]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[isu152,ISU152_Tread_Left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[isu152,ISU152_Tread_Right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[isu152,ISU152_Tread_critical]` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[isu152,ISU152_Wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### KV-1 — `kv1_heavy_tank` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[kv1_heavy_tank,material_Crit...` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[kv1_heavy_tank,material_KV1_...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[kv1_heavy_tank,material_KV1_...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[kv1_heavy_tank,Material_KV1_...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[kv1_heavy_tank,Material_KV1_...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### KV-2 — `kv2_heavy_tank` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[kv2_heavy_tank,Material_KV2_...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[kv2_heavy_tank,material_Crit...` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[kv2_heavy_tank,material_KV2_...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[kv2_heavy_tank,Material_KV2_...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[kv2_heavy_tank,material_KV2_...` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Lend-Lease Truck — `halftrack@soviet` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[halftrack,MAT_Halftrack_trea...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack,MAT_Halftrack_trea...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[halftrack,MAT_halftrack_wrec...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[halftrack,MAT_halftrack]` | armor | YES | Main hull/superstructure body — primary camo target |

### M3A1 Scout — `m3a1_scout_car` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m3a1_scout_car,mat_M3A1_Scou...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[m3a1_scout_car,Soviet_M3A1_S...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### SU-76M — `su-76m` (mrgm-v8, 5 submeshes)

armor 1 · tracks 3 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[su-76m,su_76m_tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[su-76m,orphan_treads]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[su-76m,su_76m_tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[su-76m,su_76m]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[su-76m,su_76m_wrecked]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### SU-85 — `su85` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[su85,su85_tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[su85,su85_tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[su85,su85_tread_critical]` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[su85,Soviet_SU_85]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[su85,Soviet_SU_85_Wrecked]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### T-34/76 — `t34_76` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[t34_76,T34_76_Healthy_Tread_R]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[t34_76,T34_76_Healthy]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[t34_76,T34_76_Wrecked]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[t34_76,Critical_Treads]` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[t34_76,T34_76_Healthy_Tread_L]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### T-34/85 — `t_34_85` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[t34_85,Critical_Treads]` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[t34_85,T34_Tread_L]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[t34_85,T34_Tread_R]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[t34_85,Soviet_T34-85_Heavy_T...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[t34_85,Soviet_T34-85_Heavy_T...` | armor | YES | Main hull/superstructure body — primary camo target |

### T-70 — `t70m_light_tank` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[t70m_light_tank,Soviet_T70_M...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[t70m_light_tank,Soviet_T70M_...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[t70m_light_tank,Soviet_T70_M...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[t70m_light_tank,Soviet_T70M_...` | tracks | no | Track/tread run — tiling track material, camo excluded |

### US6 Studebaker — `us6_truck` (mrgm-v8, 3 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 1 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[us6_truck,us6_truck_wrecked]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[us6_truck,us6_truck]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[us6_truck,Cargo]` | equipment | no | Stowage/ammo load — excluded |


## USF (aef)

### AA Halftrack — `m15a1_aa_halftrack` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m15a1_aa_halftrack,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m15a1_aa_halftrack,m15a1_aa_...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m15a1_aa_halftrack,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m15a1_aa_halftrack,m15a1_aa_...` | armor | YES | Main hull/superstructure body — primary camo target |

### Calliope — `m4a1_sherman_calliope` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m4a1_sherman_calliope,tread_...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m4a1_sherman_calliope,tread_...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m4a1_sherman_calliope,sherma...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m4a1_sherman_calliope,sherma...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m4a1_sherman_calliope,sherma...` | armor | YES | Main hull/superstructure body — primary camo target |

### Dodge WC51 — `dodge_wc51` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[dodge_wc51,dodge_wc51_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[dodge_wc51,dodge_wc51]` | armor | YES | Main hull/superstructure body — primary camo target |

### Easy 8 — `m4a3e8_sherman_easy_8` (trim-v5, 65 submeshes)

armor 14 · tracks 2 · wheels 20 · equipment 3 · wreck 26

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `GEO_tread_left` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `GEO_tread_right` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `critical_tread_RM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `CRS_Orphan01` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan02` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan05` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan06` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan07` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan08` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan09` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan10` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan11` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan12` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan13` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan14` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan15` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan16` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `GEO_sprocket_right_rear` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_roller_right_rear` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_right_front` | wheels | no | Return roller — running gear, excluded |
| `GEO_sprocket_right_front` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_roller_left_rear` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_left_front` | wheels | no | Return roller — running gear, excluded |
| `GEO_sprocket_left_front` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_sprocket_left_rear` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_chassis_shaker` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `GEO_hatch_hull_left` | armor | YES | Armor hatch plate |
| `GEO_hatch_hull_right` | armor | YES | Armor hatch plate |
| `GEO_engine_door_left` | armor | YES | Engine deck / access door — armor |
| `GEO_engine_door_right` | armor | YES | Engine deck / access door — armor |
| `GEO_maingun_barrel` | armor | YES | Gun barrel/mantlet — armor per class def |
| `WRK_maingun_barrel` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_turret_vert` | armor | YES | Turret armor |
| `WRK_turret_vert` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_cupolahatch` | armor | YES | Armor hatch plate |
| `GEO_cupolahatch_left` | armor | YES | Armor hatch plate |
| `GEO_cupolahatch_right` | armor | YES | Armor hatch plate |
| `GEO_pintleArm` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_turret_horiz` | armor | YES | Turret armor |
| `GEO_hatch_turret_left01` | armor | YES | Armor hatch plate |
| `GEO_hatch_turret_right01` | armor | YES | Armor hatch plate |
| `GEO_hull_mg_01_barrel` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_hull_mg_01_vert` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_wheel_left_front_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_front_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_rear_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_rear_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_front_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_front_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_rear_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_rear_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid01_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid01_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid01_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid01_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_maingun_link` | armor | YES | Gun barrel/mantlet — armor per class def |

### Greyhound — `m8_greyhound` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m8_greyhound,m8_greyhound_wr...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m8_greyhound,m8_greyhound]` | armor | YES | Main hull/superstructure body — primary camo target |

### M10 Wolverine — `m10_tank_destroyer` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m10_tank_destroyer,m10_tank_...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m10_tank_destroyer,left_tread]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m10_tank_destroyer,m10_tank_...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[m10_tank_destroyer,right_tread]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### M20 — `m20_utility_car` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m20_utility_car,m20_greyhoun...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m20_utility_car,m20_greyhound]` | armor | YES | Main hull/superstructure body — primary camo target |

### M21 Mortar HT — `m21_mortar_halftrack` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 1 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m21_mortar_halftrack,m1_81mm...` | equipment | no | Mounted weapon/MG kit — excluded |
| `merged material-[m21_mortar_halftrack,m21_mor...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[m21_mortar_halftrack,tread_l...` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m21_mortar_halftrack,m21_mor...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m21_mortar_halftrack,tread_r...` | tracks | no | Track/tread run — tiling track material, camo excluded |

### M3 Halftrack — `m3_halftrack` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m3_halftrack,m3_halftrack]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[m3_halftrack,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m3_halftrack,m3_halftrack_wr...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m3_halftrack,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m3_halftrack,tread_criitcal]` | wreck | no | Critical-damage mesh — keep vanilla look |

### M36 Jackson — `m36_tank_destroyer` (mrgm-v8, 6 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 1 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m36_tank_destroyer,ammo_90mm]` | equipment | no | Stowage/ammo load — excluded |
| `merged material-[m36_tank_destroyer,m36_tank_...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m36_tank_destroyer,m36_tank_...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[m36_tank_destroyer,tread_cri...` | wreck | no | Critical-damage mesh — keep vanilla look |
| `merged material-[m36_tank_destroyer,right_tread]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m36_tank_destroyer,left_tread]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### M4A3 Sherman — `sherman_m4a3` (trim-v5, 88 submeshes)

armor 19 · tracks 2 · wheels 28 · equipment 3 · wreck 36

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `CRS_Orphan_02` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_03` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_04` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_05` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_09` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_10` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_11` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_12` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_14` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_15` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_16` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_01` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `critical_tread_LM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `GEO_sprocket_right_rear` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_roller_right_rear` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_right_mid01` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_right_front` | wheels | no | Return roller — running gear, excluded |
| `GEO_sprocket_right_front` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_roller_left_rear` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_left_mid01` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_left_front` | wheels | no | Return roller — running gear, excluded |
| `GEO_sprocket_left_front` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_sprocket_left_rear` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_chassis_shaker` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `GEO_hatch_hull_left` | armor | YES | Armor hatch plate |
| `GEO_hatch_hull_right` | armor | YES | Armor hatch plate |
| `GEO_engine_door_left` | armor | YES | Engine deck / access door — armor |
| `GEO_engine_door_right` | armor | YES | Engine deck / access door — armor |
| `GEO_maingun_barrel` | armor | YES | Gun barrel/mantlet — armor per class def |
| `GEO_105mm_barrel` | armor | YES | Gun barrel/mantlet — armor per class def |
| `WRK_105mm_barrel` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_maingun_barrel` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_turret_vert` | armor | YES | Turret armor |
| `GEO_105mm_mantlet` | armor | YES | Gun barrel/mantlet — armor per class def |
| `WRK_105mm_mantlet` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_mantlet` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_cupolahatch` | armor | YES | Armor hatch plate |
| `GEO_cupolahatch_left` | armor | YES | Armor hatch plate |
| `GEO_cupolahatch_right` | armor | YES | Armor hatch plate |
| `GEO_turret_horiz` | armor | YES | Turret armor |
| `GEO_hatch_turret_left01` | armor | YES | Armor hatch plate |
| `GEO_turret_mantle_mg_01` | equipment | no | Mounted weapon/MG kit — excluded |
| `WRK_cupolahatch` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_cupolahatch_right` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_cupolahatch_left` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_turret` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_hull_mg_01_barrel` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_hull_mg_01_vert` | equipment | no | Mounted weapon/MG kit — excluded |
| `WRK_dozer_housing` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_dozer_nose` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_dozer_shaft` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_dozer_blade` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_dozer_mount` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `WRK_Body` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_dozer_blade` | armor | YES | Live dozer assembly bolted to hull front, shares hull paint |
| `GEO_dozer_nose` | armor | YES | Live dozer assembly bolted to hull front, shares hull paint |
| `GEO_dozer_housing` | armor | YES | Live dozer assembly bolted to hull front, shares hull paint |
| `GEO_wheel_left_front_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_front_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_left_front` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_wheel_left_rear_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_rear_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_left_rear` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_wheel_right_front_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_front_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_right_front` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_wheel_right_rear_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_rear_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_right_rear` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_wheel_left_mid01_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid01_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_left_mid01` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_wheel_right_mid01_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid01_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_right_mid01` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_tread_right` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `GEO_tread_left` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `GEO_dozer_shaft` | armor | YES | Live dozer assembly bolted to hull front, shares hull paint |
| `GEO_dozer_mount` | armor | YES | Live dozer assembly bolted to hull front, shares hull paint |

### M5 Stuart — `m5a1_stuart` (trim-v5, 59 submeshes)

armor 8 · tracks 2 · wheels 22 · equipment 3 · wreck 24

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `GEO_tread_right` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `GEO_tread_left` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `critical_tread_LM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `CRS_Orphan_04` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_01` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_10` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_03` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_07` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_08` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_06` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_12` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_13` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_14` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_15` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `CRS_Orphan_05` | wreck | no | Crushed/orphan wreck fragment — keep vanilla |
| `GEO_sprocket_right_rear` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_roller_right_rear` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_right_mid01` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_right_front` | wheels | no | Return roller — running gear, excluded |
| `GEO_sprocket_right_front` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_roller_left_rear` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_left_mid01` | wheels | no | Return roller — running gear, excluded |
| `GEO_roller_left_front` | wheels | no | Return roller — running gear, excluded |
| `GEO_sprocket_left_front` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_sprocket_left_rear` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_chassis_shaker` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `GEO_hatch_hull_left` | armor | YES | Armor hatch plate |
| `GEO_hatch_hull_right` | armor | YES | Armor hatch plate |
| `GEO_maingun_barrel` | armor | YES | Gun barrel/mantlet — armor per class def |
| `WRK_maingun_barrel` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_turret_vert` | armor | YES | Turret armor |
| `GEO_turret_mg_01_barrel` | equipment | no | Mounted weapon/MG kit — excluded |
| `WRK_mantlet` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_cupolahatch_right` | armor | YES | Armor hatch plate |
| `GEO_turret_horiz` | armor | YES | Turret armor |
| `GEO_hull_mg_01_barrel` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_hull_mg_01_vert` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_engine_door_top` | armor | YES | Engine deck / access door — armor |
| `GEO_wheel_left_front_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_front_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_left_front` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_wheel_left_rear_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_rear_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_left_rear` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_wheel_right_front_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_front_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_right_front` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_wheel_right_rear_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_rear_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_right_rear` | wheels | no | Suspension/bogie — running gear, excluded |

### M8 Scott — `m8a1_hmc` (mrgm-v8, 5 submeshes)

armor 2 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m8a1_hmc,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m8a1_hmc,m5a1_stuart]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[m8a1_hmc,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m8a1_hmc,m8a1_hmc_wreak]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m8a1_hmc,m8a1_hmc]` | armor | YES | Main hull/superstructure body — primary camo target |

### Pershing — `m26_pershing` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m26_pershing,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m26_pershing,m26_pershing]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[m26_pershing,m26_pershing_wr...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m26_pershing,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Priest — `m7b1_priest` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m7b1_priest,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m7b1_priest,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m7b1_priest,m7b1_priest_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m7b1_priest,m7b1_priest]` | armor | YES | Main hull/superstructure body — primary camo target |

### Sherman 76mm — `m4a3_sherman_76mm` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[m4a3_sherman_76mm,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m4a3_sherman_76mm,m4a3_sherm...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[m4a3_sherman_76mm,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[m4a3_sherman_76mm,m4a3_sherm...` | armor | YES | Main hull/superstructure body — primary camo target |

### WC54 Ambulance — `dodge_wc54_ambulance` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[dodge_wc54_ambulance,wc54_am...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[dodge_wc54_ambulance,wc54_am...` | armor | YES | Main hull/superstructure body — primary camo target |


## UKF (british)

### AEC Armoured Car — `aec_armoured_car` (mrgm-v8, 2 submeshes)

armor 1 · tracks 0 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[aec_armoured_car,aec_amoured...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[aec_armoured_car,aec_amoured...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Centaur AA — `centaur` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[centaur_aa,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[centaur_aa,centaur_aa]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[centaur_aa,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[centaur_aa,centaur_aa_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Churchill — `churchill` (trim-v5, 101 submeshes)

armor 43 · tracks 2 · wheels 34 · equipment 10 · wreck 12

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `GEO_tread_right` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `GEO_tread_left` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `GEO_sprocket_right_rear` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_sprocket_right_front` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_sprocket_left_front` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_sprocket_left_rear` | wheels | no | Drive sprocket — running gear, excluded |
| `GEO_chassis_shaker` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `GEO_hatch_hull_left` | armor | YES | Armor hatch plate |
| `GEO_hatch_hull_right` | armor | YES | Armor hatch plate |
| `GEO_engine_door_left` | armor | YES | Engine deck / access door — armor |
| `GEO_engine_door_right` | armor | YES | Engine deck / access door — armor |
| `GEO_cupolahatch` | armor | YES | Armor hatch plate |
| `GEO_cupolahatch_left` | armor | YES | Armor hatch plate |
| `GEO_cupolahatch_right` | armor | YES | Armor hatch plate |
| `GEO_turret_horiz` | armor | YES | Turret armor |
| `GEO_hatch_turret_right01` | armor | YES | Armor hatch plate |
| `GEO_hatch_turret_right02` | armor | YES | Armor hatch plate |
| `GEO_turret_horiz_turretbox` | armor | YES | Turret armor |
| `CRS_turret_01` | armor | YES | Turret armor |
| `CRS_turret_02` | armor | YES | Turret armor |
| `CRS_turret_03` | armor | YES | Turret armor |
| `CRS_turret_04` | armor | YES | Turret armor |
| `GEO_turret_vert` | armor | YES | Turret armor |
| `GEO_turret_vert_mortar` | armor | YES | Turret armor |
| `GEO_maingun_barrel` | armor | YES | Gun barrel/mantlet — armor per class def |
| `WRK_maingun_barrel` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_turret_mg_01_barrel` | equipment | no | Mounted weapon/MG kit — excluded |
| `WRK_turret_vert` | wreck | no | Wreck-state geometry — keep vanilla burnt look |
| `GEO_avre_projectile` | equipment | no | Loaded ordnance/kit — excluded |
| `GEO_hull_mg_01_barrel` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_hull_mg_01_horiz` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_hull_mg_01_vert` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_hull_mg_01_vert_flamethrower` | equipment | no | Mounted weapon/MG kit — excluded |
| `GEO_driver_door_left` | armor | YES | Engine deck / access door — armor |
| `GEO_driver_door_right` | armor | YES | Engine deck / access door — armor |
| `GEO_back_door_bottom` | armor | YES | Engine deck / access door — armor |
| `GEO_hatch_hull_left02` | armor | YES | Armor hatch plate |
| `GEO_hatch_hull_right02` | armor | YES | Armor hatch plate |
| `GEO_chassis_shaker_rearcaps` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `GEO_chassis_shaker_catwalks` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `GEO_chassis_shaker_croctank` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `GEO_chassis_shaker_frontcaps` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `GEO_shovel` | equipment | no | Stowed tool — excluded |
| `GEO_sledge` | equipment | no | Stowed tool — excluded |
| `GEO_intake_left` | armor | YES | Armored engine-deck furniture, paints with hull |
| `GEO_intake_right` | armor | YES | Armored engine-deck furniture, paints with hull |
| `CRS_body_01` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_02` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_03` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_04` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_05` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_06` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_07` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_08` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_09` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_10` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_11` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_12` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `CRS_body_13` | armor | YES | Hull/body armor (crushable variant shares body UV) |
| `geo_hullgun_01` | equipment | no | Named hull-gun fitting — small weapon, excluded |
| `geo_hullgun_02` | equipment | no | Named hull-gun fitting — small weapon, excluded |
| `GEO_wheel_left_front_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_front_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid02_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid02_B` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid02_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_rear_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_rear_B` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_rear_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_front_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_front_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid02_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid02_B` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid02_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_rear_B` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_rear_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_rear_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid01_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid01_B` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_left_mid01_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid01_A` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid01_B` | wheels | no | Road wheel — running gear, excluded |
| `GEO_wheel_right_mid01_C` | wheels | no | Road wheel — running gear, excluded |
| `GEO_suspension_left_front` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_suspension_left_mid01` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_suspension_left_mid02` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_suspension_left_rear` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_suspension_right_front` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_suspension_right_mid01` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_suspension_right_mid02` | wheels | no | Suspension/bogie — running gear, excluded |
| `GEO_suspension_right_rear` | wheels | no | Suspension/bogie — running gear, excluded |
| `critical_tread_LM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_LB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB1` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RB2` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RM` | wreck | no | Critical-damage mesh — keep vanilla look |
| `critical_tread_RF1` | wreck | no | Critical-damage mesh — keep vanilla look |

### Comet — `comet` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[comet,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[comet,comet_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[comet,comet]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[comet,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Cromwell — `cromwell` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[cromwell,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[cromwell,cromwell]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[cromwell,cromwell_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[cromwell,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Firefly — `sherman_firefly` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[sherman_firefly,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[sherman_firefly,sherman_trea...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[sherman_firefly,sherman_page]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[sherman_firefly,sherman_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[sherman_firefly,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |

### Sexton SPG — `sexton` (mrgm-v8, 5 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 2

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[sexton,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[sexton,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[sexton,sexton]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[sexton,sexton_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[sexton,tread_wreck]` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Universal Carrier — `bren_carrier` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[bren_carrier,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[bren_carrier,bren_healthy_mat]` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[bren_carrier,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[bren_carrier,bren_carrier_wr...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |

### Valentine — `valentine` (mrgm-v8, 4 submeshes)

armor 1 · tracks 2 · wheels 0 · equipment 0 · wreck 1

| Submesh | Class | Camo | Note |
|---|---|:---:|---|
| `merged material-[valentine_command,valentine_...` | armor | YES | Main hull/superstructure body — primary camo target |
| `merged material-[valentine_command,tread_right]` | tracks | no | Track/tread run — tiling track material, camo excluded |
| `merged material-[valentine_command,valentine_...` | wreck | no | Wreck/destroyed body — keep vanilla burnt look |
| `merged material-[valentine_command,tread_left]` | tracks | no | Track/tread run — tiling track material, camo excluded |

