# RGM DATA/NODE Chunk Audit — Conclusive Findings

```

============================================================
VEHICLE: Tiger
============================================================
  Loaded: 518804 bytes from ArtHigh.sga

[DATA/NODE] 75 chunks - scene-graph transforms
  Structure confirmed: (meshName, meshName, boneName, rot3x3, trans3)
  Sample entries (first 5):
    mesh="orphan_Hatch_L" bone="orphan_hatch_l" trans=[-1.830, 2.616, -2.464]
    mesh="orphan_Hatch_R" bone="orphan_hatch_r" trans=[1.625, 2.560, -2.695]
    mesh="orphans_wheel_01" bone="orphans_wheel_01" trans=[-2.155, 0.882, 2.797]
    mesh="orphans_wheel_02" bone="orphans_wheel_02" trans=[-2.078, 0.663, -3.108]
    mesh="orphans_wheel_03" bone="orphans_wheel_03" trans=[2.158, 0.882, 2.797]
  VERDICT: NO decal-related names in any DATA/NODE entry

[DATA/MRKS] 1 chunk(s)
  Marker count: 1 (expected 55)
  All marker names:
    "marker_dmg_hull_hatch_rr" pos=[-0.000, NaN, -11.848]
  VERDICT: NO decal-related names in DATA/MRKS

[BINARY SCAN] Decal/insignia/badge/projector/teamcolor strings:
  offset 2825: ".....art\armies\german\badges\default_dif.DATADA..."
  offset 2894: ".....art\armies\german\badges\default_dif....FOL..."
  offset 3646: ".....art\armies\german\badges\default_dif.DATA.V..."

============================================================
VEHICLE: T34_76
============================================================
  Loaded: 797594 bytes from ArtHigh.sga

[DATA/NODE] 5 chunks - scene-graph transforms
  Structure confirmed: (meshName, meshName, boneName, rot3x3, trans3)
  Sample entries (first 5):
    mesh="merged material-[t34_76,T34_76_Healthy_Tread_L]" bone="" trans=[0.000, 0.000, 0.000]
    mesh="merged material-[t34_76,Critical_Treads]" bone="" trans=[0.000, 0.000, 0.000]
    mesh="merged material-[t34_76,T34_76_Wrecked]" bone="" trans=[0.000, 0.000, 0.000]
    mesh="merged material-[t34_76,T34_76_Healthy]" bone="" trans=[0.000, 0.000, 0.000]
    mesh="merged material-[t34_76,T34_76_Healthy_Tread_R]" bone="" trans=[0.000, 0.000, 0.000]
  VERDICT: NO decal-related names in any DATA/NODE entry

[DATA/MRKS] 1 chunk(s)
  Marker count: 1 (expected 55)
  All marker names:
    "marker_tank_barrel_end" pos=[47.875, 7.284200714978358e+27, 0.000]
  VERDICT: NO decal-related names in DATA/MRKS

[BINARY SCAN] Decal/insignia/badge/projector/teamcolor strings:
  offset 497: ".....art\armies\soviet\badges\default_dif.DATADA..."
  offset 574: "...C:art\armies\soviet\badges\default_dif....FOL..."
  offset 4597: ".....art\armies\soviet\badges\default_dif.DATA.V..."

============================================================
VEHICLE: M4A3E8
============================================================
  Loaded: 942272 bytes from ArtHighXP1.sga

[DATA/NODE] 65 chunks - scene-graph transforms
  Structure confirmed: (meshName, meshName, boneName, rot3x3, trans3)
  Sample entries (first 5):
    mesh="GEO_maingun_link" bone="" trans=[0.000, 0.000, 0.000]
    mesh="GEO_wheel_right_mid01_C" bone="bone_wheel_right_mid01_c" trans=[1.327, 0.395, -0.259]
    mesh="GEO_wheel_right_mid01_A" bone="bone_wheel_right_mid01_a" trans=[1.327, 0.395, 0.768]
    mesh="GEO_wheel_left_mid01_C" bone="bone_wheel_left_mid01_c" trans=[-1.327, 0.395, -0.259]
    mesh="GEO_wheel_left_mid01_A" bone="bone_wheel_left_mid01_a" trans=[-1.327, 0.395, 0.768]
  VERDICT: NO decal-related names in any DATA/NODE entry

[DATA/MRKS] 1 chunk(s)
  Marker count: 1 (expected 54)
  All marker names:
    "fx_exhaust_001" pos=[6.711377317648151e+21, -0.000, 0.000]
  VERDICT: NO decal-related names in DATA/MRKS

[BINARY SCAN] Decal/insignia/badge/projector/teamcolor strings:
  offset 3476: "........art\armies\aef\badges\default_dif.DATADA..."
  offset 3542: "....!...art\armies\aef\badges\default_dif....FOL..."
  offset 4663: "...."...art\armies\aef\badges\default_dif.DATA.V..."
  offset 6670: "...."...art\armies\aef\badges\default_dif.DATA.V..."

============================================================
CONCLUSIVE SUMMARY
============================================================
DATA/NODE: One chunk per FOLD/MESH. Contains (meshName, boneName, 3x3 rot, trans).
These are scene-graph transforms binding meshes to skeleton bones.
NO entry references decal/insignia/projector/national/badge/teamcolor.

DATA/MRKS: FX/animation anchor markers (barrel_end, weapon_attach, etc).
NO marker references decal/projector/insignia/badge.

Binary scan: The ONLY "badge"-like string found is the TSET path
"\armies\[faction]\badges\default_dif" — a TEXTURE SET reference,
not a placement/projector definition.

VERDICT: NO RGM chunk in any of the 3 vehicles (Tiger, T34_76, M4A3E8)
contains decal projector placement data. The RGM format holds:
  - TSET: texture set names (including badge texture sets)
  - MTRL: material definitions
  - FOLD/MESH: geometry (vertices, indices, UVs)
  - DATA/NODE: scene-graph transforms (mesh→bone bindings)
  - DATA/MRKS: FX/animation attach points
  - DATA/BONE: skeleton bones
None of these encode WHERE decals are projected. Decal placement
is driven by the Essence engine at runtime using world-space projection
onto the vehicle hull surface, not stored in the RGM.
```

## MRKS Raw String Scan

```

=== Tiger ===
MRKS payload size=5226
All strings in MRKS payload (122 total):
  "marker_dmg_hull_hatch_rr"
  "bone_chassis_shakerI"
  "marker_dmg_hull_hatch_rl"
  "bone_chassis_shakerC"
  "marker_dmg_hull_hatch_engine_l"
  "bone_chassis_shaker"
  "B?S;O"
  "jW1?KV"
  "marker_dmg_hull_hatch_engine_r"
  "bone_chassis_shaker!"
  "marker_dmg_hull_hatch_fl"
  "bone_chassis_shaker"
  "=fEn"
  "marker_dmg_hull_hatch_fr"
  "bone_chassis_shaker7z"
  "!(~?"
  "marker_dmg_hull_peephole"
  "bone_chassis_shaker36O:"
  "marker_exhaust_l"
  "bone_chassis_shaker"
  "S@lR"
  "marker_exhaust_r"
  "bone_chassis_shaker"
  "S@lR"
  "marker_smokelauncher_hull_r"
  "bone_chassis_shaker6"
  "marker_smokelauncher_hull_l"
  "bone_chassis_shakerc"
  "marker_smokelauncher_hull_rl"
  "bone_chassis_shakerrw8?U"
  "a5?1F"
  "q_n>"
  "marker_dmg_hull_hatch_engine_r01"
  "bone_chassis_shakerQ<"
  "?jA">"
  "4K?svN"
  "marker_dmg_hull_hatch_engine_l01"
  "bone_chassis_shakerf"
  "B?T;O"
  "marker_dmg_hull_hatch_rc"
  "bone_chassis_shaker"
  "marker_dmg_hull_fuel_drip"
  "bone_chassis_shakerAk"
  "marker_main_fire"
  "bone_chassis_shaker"
  "marker_fire03"
  "bone_chassis_shaker"
  "|?I""
  "marker_fire04"
  "bone_chassis_shaker"
  "marker_dmg_turret_gun_crack_01"
  "bone_turret"
  "marker_dmg_turret_gun_crack_02"
  "bone_turret"
  "marker_dmg_turret_gun_crack_03"
  "bone_turret"
  "4CO<eL"
  "marker_rain_02"
  "bone_turret"
  "a=pV"
  "marker_fire02"
  "bone_turret"
  "K?pm"
  "marker_fire01"
  "bone_turret"
  "marker_tiger_barrel_end"
  "bone_turret_barrel"
  "marker_tiger_mg42_coaxial"
  "bone_turret_barrel"
  "marker_dmg_turret_hatch_r"
  "bone_turret_barrel"
  "ii?"x"
  "marker_dmg_turret_hatch_l"
  "bone_turret_barrel"
  "marker_dmg_turret_hatch_03"
  "bone_turret_barrelz"
  "S2%?"
  "marker_cannon_shockwave"
  "bone_turret_barrel"
  "marker_wrecked_barrel_end"
  "bone_turret_barrel"
  "marker_crewabandon"
  "base_gunner_bone"
  "marker_fx_smoke_launcher"
  "bone_turret"
  "marker_fx_smoke_launcher2"
  "bone_turretN"
  ">oXw"
  "marker_flare"
  "bone_turretw"
  "marker_tiger_mg42_hull"
  "bone_hull_mg_barrel"
  "4]|a40a"
  "4]|a4i"
  "marker_headlight"
  "bone_chassis_shaker"
  "marker_headlight2"
  "bone_chassis_shaker"
  "marker_tread_lr_rotate"
  "bone_master"
  "marker_tread_lf_rotate"
  "bone_master"
  "marker_tread_rf_rotate"
  "bone_master"
  "marker_tread_rr_rotate"
  "bone_master"
  "marker_track_upper_r"
  "marker_track_upper_l"
  "?di)"
  "marker_destruction"
  "marker_fx_ui"
  "marker_treadmarks_fr"
  "marker_treadmarks_rl"
  "marker_treadmarks_rr"
  "marker_treadmarks_fl"
  "marker_treadmarks_rr_top"
  "marker_treadmarks_rl_top"
  "Fw?F"
  "h?Na"
  "marker_treadmarks_fl_top"
  "marker_treadmarks_fr_top"
  "n?0a"

=== T34_76 ===
MRKS payload size=5605
All strings in MRKS payload (144 total):
  "marker_tank_barrel_end"
  "bone_barrel"
  "marker_cannon_shockwave"
  "bone_barrel"
  "marker_maingun_wrecked"
  "bone_mantlet"
  "marker_coaxialgun_muzzle"
  "bone_mantlet"
  "marker_turret_hole_76_right"
  "bone_turretw"
  "marker_turret_hole_76_left"
  "bone_turretw"
  "marker_turret_76_vent"
  "bone_turretw"
  "marker_pistol_port_l"
  "bone_turretw"
  "marker_pistol_port_r"
  "bone_turretx"
  "marker_crewabandon"
  "bone_turret"
  "marker_hullgun_muzzle"
  "bone_mg_barrel"
  "marker_exhaust_left"
  "bone_chassis_shakerx"
  "y9_@"
  "marker_exhaust_right"
  "bone_chassis_shakerx"
  "#?{9_@"
  "marker_engine_vent_back_left"
  "bone_chassis_shakerw"
  "marker_engine_vent_back_right"
  "bone_chassis_shakerw"
  "marker_engine_vent_top_mid"
  "bone_chassis_shakerw"
  "marker_engine_hatch"
  "bone_chassis_shakerw"
  "marker_front_hatch"
  "bone_chassis_shakerw"
  "marker_headlight"
  "bone_chassis_shaker"
  "marker_wreck_driver"
  "bone_chassis_shaker"
  "W}?x"
  "g\s?"
  "marker_wreck_turret_l"
  "bone_chassis_shakerC"
  "marker_wreck_turret_r"
  "bone_chassis_shaker"
  ">5GA"
  "marker_wreck_engine"
  "bone_chassis_shakerW"
  "e?{u"
  "marker_wreck_vent_01"
  "bone_chassis_shaker"
  "}?)`"
  "marker_wreck_vent_02"
  "bone_chassis_shaker"
  "}?)`"
  "marker_wreck_vent_03"
  "bone_chassis_shaker"
  "}?(`"
  "marker_wreck_vent_04"
  "bone_chassis_shaker"
  "}?(`"
  "B4>/"
  "marker_wreck_turret_base_l"
  "bone_chassis_shaker"
  "+4k?"
  "x/>2S"
  "y?0<c"
  "marker_wreck_turret_base_r"
  "bone_chassis_shaker"
  "marker_wreck_under_r"
  "bone_chassis_shaker"
  "marker_wreck_under_l"
  "bone_chassis_shaker"
  "marker_wreck_sidefire_l"
  "bone_chassis_shaker"
  "marker_wreck_sidefire_r"
  "bone_chassis_shaker"
  "marker_destruction"
  "bone_chassis_shakerw"
  "marker_fx_ui"
  "bone_chassis_shakerw"
  "slot_marker01"
  "bone_chassis"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker02"
  "bone_chassisr~"
  "GS>-"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker03"
  "bone_chassis"
  "g?\!"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker04"
  "bone_chassis"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker05"
  "bone_chassis"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker06"
  "bone_chassis"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "marker_tread_lr_rotate"
  "bone_l_suspension_02"
  "marker_tread_lf_rotate"
  "bone_l_suspension_02"
  "marker_tread_rf_rotate"
  "bone_l_suspension_02"
  "[2@>"
  "marker_tread_rr_rotate"
  "bone_l_suspension_02"
  "marker_track_upper_r"
  "marker_track_upper_l"
  "marker_treadmarks_fr"
  "marker_treadmarks_rl"
  "marker_treadmarks_rr"
  "marker_treadmarks_fl"
  "marker_treadmarks_rr_top"
  "marker_treadmarks_rl_top"
  "Fw?F"
  "h?Na"
  "marker_treadmarks_fl_top"
  "marker_treadmarks_fr_top"
  "n?0a"

=== M4A3E8 ===
MRKS payload size=5417
All strings in MRKS payload (158 total):
  "fx_exhaust_001"
  "bone_chassis_shaker"
  "fx_dmg_hull_002"
  "bone_chassis_shakerY"
  "fx_dmg_hull_003"
  "bone_chassis_shaker"
  "1?/1"
  "fx_dmg_hull_001"
  "bone_chassis_shaker"
  "fx_dmg_engine_001"
  "bone_chassis_shakere"
  "fx_dmg_engine_002"
  "bone_chassis_shaker"
  "zD1>"
  "=gU{?"
  "fx_exhaust_002"
  "bone_chassis_shaker"
  "fx_dmg_hull_004"
  "bone_chassis_shaker"
  "\5*w{?"
  "n5*w{?"
  "fx_dmg_engine_003"
  "bone_chassis_shaker"
  "_rig_hatch_hull_left"
  "bone_chassis_shaker"
  "s?*("
  "_rig_hatch_hull_right"
  "bone_chassis_shaker"
  "=s?,"
  "_rig_engine_door_left"
  "bone_chassis_shakerx"
  "_rig_engine_door_right"
  "bone_chassis_shaker"
  "=5N[?"
  "_rig_turret_horiz"
  "bone_chassis_shaker"
  "fx_muzzle_maingun"
  "bone_maingun_barrel"
  "?]|a"
  "3]|a4"
  "fx_dmg_maingun"
  "bone_maingun_barrel"
  "?]|a"
  ":?z>/?]|a"
  "fx_maingun_shockwave"
  "bone_maingun_barrel"
  "]|a4"
  "]|a4"
  "<54<"
  "'@r}"
  "fx_muzzle_turret_hmg"
  "bone_turret_vert"
  "_rig_cupolahatch_left"
  "bone_cupolahatch"
  "_rig_cupolahatch_right"
  "bone_cupolahatch"
  ">?gy"
  "fx_top_hatch"
  "bone_cupolahatch"
  "fx_dmg_turret_001"
  "bone_turret_horiz"
  "fx_dmg_turret_002"
  "bone_turret_horiz1"
  ";^l_?J"
  "fx_dmg_turret_003"
  "bone_turret_horiz"
  "_rig_hatch_turret_left01"
  "bone_turret_horiz"
  "r?|`"
  "_rig_hatch_turret_right01"
  "bone_turret_horiz"
  "fx_smoke_launcher"
  "bone_turret_horiz"
  "_rig_hull_mg_01_horiz"
  "bone_chassis_shaker"
  "?0aQ"
  "0aQ5"
  "fx_muzzle_hull_hmg_01"
  "bone_hull_mg_01_barrel"
  "slot_marker01"
  "bone_chassis_shaker"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker02"
  "bone_chassis_shaker1~"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker03"
  "bone_chassis_shaker>"
  "g?mg"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker04"
  "bone_chassis_shakerq~"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker05"
  "bone_chassis_shaker"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "slot_marker06"
  "bone_chassis_shaker"
  "marker_type"
  "combat slot"
  "marker_subtype"
  "infantry only"
  "fx_track_kickup_fr"
  "bone_root"
  "fx_track_kickup_bl"
  "bone_root"
  "fx_track_kickup_br"
  "bone_root"
  "fx_track_kickup_fl"
  "bone_root"
  "fx_track_upper_r"
  "bone_root"
  "fx_track_upper_l"
  "bone_root"
  "fx_destruction"
  "bone_rootw"
  "fx_ui"
  "bone_rootw"
  "fx_track_rotate_bl"
  "bone_root"
  "fx_track_rotate_fl"
  "bone_root"
  "fx_track_rotate_fr"
  "bone_root"
  "fx_track_rotate_br"
  "bone_root"
  "fx_track_kickdown_br"
  "bone_root"
  "fx_track_kickdown_bl"
  "bone_root"
  "3p>@"
  "fx_track_kickdown_fl"
  "bone_root"
  "Z}z?"
  "fx_track_kickdown_fr"
  "bone_root"
  "Fw?U"
  "fx_bulldozer01"
  "bone_rootZ"
  "fx_bulldozer02"
  "bone_root"
  "fx_bulldozer03"
  "bone_rootYA"
  "G?q{"

--- Conclusion ---
All MRKS strings listed above. If no *** DECAL *** flags appear,
DATA/MRKS contains only FX/animation/weapon markers (confirmed).
```
