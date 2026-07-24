# Analytical Decal-Unwrap Verification Report

_Generated 2026-07-20T06:26:09.559Z_

Pure-Node analytical check (no Electron/GPU). For each vehicle it parses the RGM with the
editor's own `parseRgm`, decodes TEXCOORD1 exactly as `rgm.ts` does, applies the editor's
gating (`Viewport.tsx`), and tests whether the national-insignia decal lands inside the badge
shader window **U∈[0.27,0.35] × V∈[0.03,0.09]**.

Archives: `/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives`

## Summary

| Verdict | Count |
|---|---|
| RENDERS | 61 |
| MISSING | 0 |
| SMEAR-RISK | 0 |
| NO-TC1 | 0 |
| SKIPPED | 0 |
| **Total** | **61** |

**V-flip hypothesis (format-3 vehicles): REFUTED.**

format-3 (R32G32_FLOAT TC1) vehicles: `jagdtiger` (RENDERS), `halftrack_sdkfz_251_flak` (RENDERS), `m4a1_sherman_calliope` (RENDERS), `sherman_m4a3` (RENDERS), `valentine` (RENDERS), `sexton` (RENDERS).

## Problem vehicles

_None — every located vehicle RENDERS or is NO-TC1 by design._

## Per-vehicle table

| Vehicle | Faction | Format(s) | Groups | Intact | Gated | Verdict | Evidence |
|---|---|---|---|---|---|---|---|
| tiger | german | 2 | 1 | 39 | 11 | RENDERS | 11/11 tight badge-cell submesh(es) in-window; e.g. geo_Engine_Vent_L TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) |
| elefant | german | 2 | 24 | 26 | 24 | RENDERS | 22/22 tight badge-cell submesh(es) in-window; e.g. merged material-[elefant,Elefant_Tank]#g1 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 2 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| brummbar | german | 2 | 53 | 57 | 55 | RENDERS | 50/50 tight badge-cell submesh(es) in-window; e.g. merged material-[brummbar,Brummbar_Panels]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 5 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| stug_iii | german | 2 | 33 | 41 | 30 | RENDERS | 27/27 tight badge-cell submesh(es) in-window; e.g. merged material-[stug_iii,stug_iii]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| ostwind_flak_panzer | german | 2 | 46 | 45 | 43 | RENDERS | 38/38 tight badge-cell submesh(es) in-window; e.g. merged material-[ostwind_flak_panzer,MAT_Ostwind]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 5 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| panzerwerfer | german | 2 | 30 | 33 | 30 | RENDERS | 26/26 tight badge-cell submesh(es) in-window; e.g. merged material-[panzerwerfer,German_SdKfz_4-1_Panzerwerfer]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| halftrack | german | 2 | 33 | 36 | 33 | RENDERS | 31/31 tight badge-cell submesh(es) in-window; e.g. merged material-[halftrack,MAT_Halftrack]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 2 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| sdkfz_250 | german | 2 | 26 | 29 | 26 | RENDERS | 23/23 tight badge-cell submesh(es) in-window; e.g. merged material-[sdkfz_250,SHW_sdkfz_250]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| sdkfz_222 | german | 2 | 51 | 51 | 51 | RENDERS | 48/48 tight badge-cell submesh(es) in-window; e.g. merged material-[sdkfz_222,Sdkfz_222]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| opel_blitz | german | 2 | 38 | 38 | 38 | RENDERS | 33/33 tight badge-cell submesh(es) in-window; e.g. merged material-[opel_blitz,Opel_Blitz]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 5 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| king_tiger_sdkfz_182 | west_german | 2 | 32 | 34 | 32 | RENDERS | 29/29 tight badge-cell submesh(es) in-window; e.g. merged material-[king_tiger_sdkfz_182,king_tiger_sdkfz_182]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| jagdtiger | west_german | 3 | 30 | 32 | 30 | RENDERS | 28/28 tight badge-cell submesh(es) in-window; e.g. merged material-[jagdtiger,jagdtiger]#g0 TC1 U[0.290,0.340] V[0.040,0.090] (fmt3) \| 2 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| sturmtiger | west_german | 2 | 38 | 40 | 38 | RENDERS | 35/35 tight badge-cell submesh(es) in-window; e.g. merged material-[sturmtiger,sturmtiger]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| panther_ausf_g | west_german | 2 | 48 | 50 | 48 | RENDERS | 41/41 tight badge-cell submesh(es) in-window; e.g. merged material-[panther_ausf_g,Panther_body]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 7 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| jagdpanzer_iv_sdkfz_162 | west_german | 2 | 38 | 40 | 38 | RENDERS | 36/36 tight badge-cell submesh(es) in-window; e.g. merged material-[jagdpanzer_iv_sdkfz_162,jagdpanzer_iv_sdkfz_162]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 2 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| panzer_iv_sdkfz_ausf_i | west_german | 2 | 49 | 51 | 49 | RENDERS | 44/44 tight badge-cell submesh(es) in-window; e.g. merged material-[panzer_iv_sdkfz_ausf_i,panzer_iv_sdkfz_ausf_i]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 5 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| hetzer | west_german | 2 | 32 | 34 | 32 | RENDERS | 4/30 tight badge-cell submesh(es) in-window; e.g. merged material-[hetzer,hetzer]#g1 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 1 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| puma_sdkfz_234 | west_german | 2 | 20 | 18 | 18 | RENDERS | 14/14 tight badge-cell submesh(es) in-window; e.g. merged material-[puma_sdkfz_234,puma_234_healthy]#g1 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| panzer_ii_luchs_sdkfz_123 | west_german | 2 | 25 | 23 | 21 | RENDERS | 17/17 tight badge-cell submesh(es) in-window; e.g. merged material-[panzer_ii_luchs_sdkfz_123,panzer_ii_luchs_sdkfz_123]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| kubelwagen | west_german | 2 | 13 | 13 | 13 | RENDERS | 10/10 tight badge-cell submesh(es) in-window; e.g. merged material-[kubelwagen,kubelwagen]#g3 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| halftrack_sdkfz_251 | west_german | 2 | 38 | 40 | 38 | RENDERS | 35/35 tight badge-cell submesh(es) in-window; e.g. merged material-[halftrack_sdkfz_251,sdkfz251_healthy]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| halftrack_sdkfz_251_flak | west_german | 3 | 34 | 36 | 34 | RENDERS | 28/28 tight badge-cell submesh(es) in-window; e.g. merged material-[halftrack_sdkfz_251_flak,halftrack_sdkfz_251_flak]#g0 TC1 U[0.290,0.340] V[0.040,0.090] (fmt3) \| 6 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| halftrack_sdkfz_251_infrared | west_german | 2 | 27 | 29 | 27 | RENDERS | 24/24 tight badge-cell submesh(es) in-window; e.g. merged material-[halftrack_sdkfz_251_infrared,halftrack_sdkfz_251_infrared]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| is2m_heavy_tank | soviet | 2 | 37 | 39 | 37 | RENDERS | 34/34 tight badge-cell submesh(es) in-window; e.g. merged material-[is2m_heavy_tank,is2m_heavy_tank]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| isu152 | soviet | 2 | 50 | 52 | 50 | RENDERS | 47/47 tight badge-cell submesh(es) in-window; e.g. merged material-[isu152,ISU152_Healthy]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| kv1_heavy_tank | soviet | 2 | 45 | 47 | 45 | RENDERS | 41/41 tight badge-cell submesh(es) in-window; e.g. merged material-[kv1_heavy_tank,Material_KV1_Healthy]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| kv2_heavy_tank | soviet | 2 | 42 | 44 | 42 | RENDERS | 39/39 tight badge-cell submesh(es) in-window; e.g. merged material-[kv2_heavy_tank,Material_KV2_Healthy]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 2 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| t34_76 | soviet | 2 | 41 | 43 | 41 | RENDERS | 37/37 tight badge-cell submesh(es) in-window; e.g. merged material-[t34_76,T34_76_Healthy]#g1 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| t_34_85 | soviet | 2 | 30 | 32 | 30 | RENDERS | 27/27 tight badge-cell submesh(es) in-window; e.g. merged material-[t34_85,Soviet_T34-85_Heavy_Tank]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| t70m_light_tank | soviet | 2 | 35 | 37 | 35 | RENDERS | 32/32 tight badge-cell submesh(es) in-window; e.g. merged material-[t70m_light_tank,Soviet_T70_M_Light_Tank]#g1 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| su85 | soviet | 2 | 35 | 37 | 35 | RENDERS | 33/33 tight badge-cell submesh(es) in-window; e.g. merged material-[su85,Soviet_SU_85]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 2 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| su-76m | soviet | 2 | 53 | 55 | 53 | RENDERS | 50/50 tight badge-cell submesh(es) in-window; e.g. merged material-[su-76m,su_76m]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m3a1_scout_car | soviet | 2 | 19 | 19 | 19 | RENDERS | 18/18 tight badge-cell submesh(es) in-window; e.g. merged material-[m3a1_scout_car,mat_M3A1_ScoutCar]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 1 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| halftrack | soviet | 2 | 66 | 68 | 66 | RENDERS | 62/62 tight badge-cell submesh(es) in-window; e.g. merged material-[halftrack,MAT_halftrack]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| us6_truck | soviet | 2 | 50 | 51 | 50 | RENDERS | 46/46 tight badge-cell submesh(es) in-window; e.g. merged material-[us6_truck,us6_truck]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m26_pershing | aef | 2 | 54 | 56 | 54 | RENDERS | 51/51 tight badge-cell submesh(es) in-window; e.g. merged material-[m26_pershing,m26_pershing]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m4a3e8_sherman_easy_8 | aef | 2 | 1 | 39 | 18 | RENDERS | 18/18 tight badge-cell submesh(es) in-window; e.g. GEO_sprocket_right_rear TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) |
| m4a3_sherman_76mm | aef | 2 | 44 | 46 | 44 | RENDERS | 39/39 tight badge-cell submesh(es) in-window; e.g. merged material-[m4a3_sherman_76mm,m4a3_sherman_76mm]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 5 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m4a1_sherman_calliope | aef | 3 | 48 | 50 | 48 | RENDERS | 29/29 tight badge-cell submesh(es) in-window; e.g. merged material-[m4a1_sherman_calliope,sherman_page]#g0 TC1 U[0.290,0.340] V[0.040,0.090] (fmt3) \| 19 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m10_tank_destroyer | aef | 2 | 40 | 42 | 40 | RENDERS | 37/37 tight badge-cell submesh(es) in-window; e.g. merged material-[m10_tank_destroyer,m10_tank_destroyer]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m36_tank_destroyer | aef | 2 | 38 | 42 | 40 | RENDERS | 37/37 tight badge-cell submesh(es) in-window; e.g. merged material-[m36_tank_destroyer,ammo_90mm]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m5a1_stuart | aef | 2 | 1 | 35 | 22 | RENDERS | 22/22 tight badge-cell submesh(es) in-window; e.g. GEO_sprocket_right_rear TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) |
| m8_greyhound | aef | 2 | 22 | 22 | 22 | RENDERS | 18/18 tight badge-cell submesh(es) in-window; e.g. merged material-[m8_greyhound,m8_greyhound]#g1 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m7b1_priest | aef | 2 | 37 | 39 | 37 | RENDERS | 36/36 tight badge-cell submesh(es) in-window; e.g. merged material-[m7b1_priest,m7b1_priest]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 1 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m3_halftrack | aef | 2 | 34 | 37 | 34 | RENDERS | 26/26 tight badge-cell submesh(es) in-window; e.g. merged material-[m3_halftrack,m3_halftrack]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 8 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m15a1_aa_halftrack | aef | 2 | 39 | 41 | 39 | RENDERS | 31/31 tight badge-cell submesh(es) in-window; e.g. merged material-[m15a1_aa_halftrack,m15a1_aa_halftrack]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 8 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m8a1_hmc | aef | 2 | 22 | 34 | 32 | RENDERS | 19/27 tight badge-cell submesh(es) in-window; e.g. merged material-[m8a1_hmc,m5a1_stuart]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 5 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m20_utility_car | aef | 2 | 19 | 19 | 19 | RENDERS | 16/16 tight badge-cell submesh(es) in-window; e.g. merged material-[m20_utility_car,m20_greyhound]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| m21_mortar_halftrack | aef | 2 | 30 | 33 | 30 | RENDERS | 22/22 tight badge-cell submesh(es) in-window; e.g. merged material-[m21_mortar_halftrack,m21_mortar_halftrack]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 8 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| dodge_wc51 | aef | 2 | 14 | 14 | 14 | RENDERS | 8/8 tight badge-cell submesh(es) in-window; e.g. merged material-[dodge_wc51,dodge_wc51]#g4 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 6 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| dodge_wc54_ambulance | aef | 2 | 14 | 14 | 14 | RENDERS | 7/7 tight badge-cell submesh(es) in-window; e.g. merged material-[dodge_wc54_ambulance,wc54_ambulance]#g7 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 7 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| sherman_m4a3 | aef | 2,3 | 1 | 52 | 29 | RENDERS | 29/29 tight badge-cell submesh(es) in-window; e.g. GEO_sprocket_right_rear TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) |
| churchill | british | 2 | 1 | 68 | 37 | RENDERS | 37/37 tight badge-cell submesh(es) in-window; e.g. GEO_sprocket_right_rear TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) |
| comet | british | 2 | 39 | 41 | 39 | RENDERS | 36/36 tight badge-cell submesh(es) in-window; e.g. merged material-[comet,comet]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| cromwell | british | 2 | 28 | 30 | 28 | RENDERS | 24/24 tight badge-cell submesh(es) in-window; e.g. merged material-[cromwell,cromwell]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 4 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| centaur | british | 2 | 25 | 27 | 25 | RENDERS | 22/22 tight badge-cell submesh(es) in-window; e.g. merged material-[centaur_aa,centaur_aa]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| sherman_firefly | british | 2 | 45 | 47 | 45 | RENDERS | 34/39 tight badge-cell submesh(es) in-window; e.g. merged material-[sherman_firefly,sherman_page]#g0 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 6 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| valentine | british | 2,3 | 44 | 46 | 44 | RENDERS | 41/41 tight badge-cell submesh(es) in-window; e.g. merged material-[valentine_command,valentine_command]#g0 TC1 U[0.290,0.340] V[0.040,0.090] (fmt3) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| sexton | british | 2,3 | 38 | 40 | 38 | RENDERS | 20/29 tight badge-cell submesh(es) in-window; e.g. merged material-[sexton,sexton]#g1 TC1 U[0.290,0.340] V[0.040,0.090] (fmt3) \| 8 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| aec_armoured_car | british | 2 | 21 | 21 | 21 | RENDERS | 18/18 tight badge-cell submesh(es) in-window; e.g. merged material-[aec_armoured_car,aec_amouredcar_page]#g1 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |
| bren_carrier | british | 2 | 28 | 30 | 28 | RENDERS | 3/25 tight badge-cell submesh(es) in-window; e.g. merged material-[bren_carrier,bren_healthy_mat]#g6 TC1 U[0.286,0.337] V[0.039,0.086] (fmt2) \| 3 wide gated group(s) also overlap window (wrapper-canvas mitigated) |

## Proposed rgm.ts fix (if V-flip confirmed)

_No fix proposed — no format-3 vehicle is MISSING due to the V-flip. The hypothesis is REFUTED_
_by the numbers below (any format-3 vehicle either RENDERS as-is, or its cluster does not land in_
_window under EITHER V convention — i.e. flipping V would not rescue it)._
