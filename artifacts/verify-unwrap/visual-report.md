# Visual Unwrap Verifier — Phase 2 Report

Generated: 2026-07-19T01:00:57.628Z
Golden mode: **baseline-write** (first run — goldens written)

## Summary

| Verdict | Count |
| --- | --- |
| PASS | 60 |
| NO-DECAL | 0 |
| SMEAR | 1 |
| FLIPPED | 0 |
| DRIFT | 0 |
| LOAD-TIMEOUT | 0 |
| **TOTAL** | **61** |

Median footprint/silhouette ratio: `0.0396` — SMEAR threshold (2×): `0.0900`

## V-flip regression proof

The 5 previously V-flip-broken vehicles MUST now render the calibration decal:

| Vehicle | Renders decal | Footprint px | Verdict |
| --- | --- | --- | --- |
| jagdtiger | ✅ YES | 28986 | PASS |
| halftrack_sdkfz_251_flak | ✅ YES | 17278 | PASS |
| m4a1_sherman_calliope | ✅ YES | 21826 | PASS |
| valentine | ✅ YES | 14784 | PASS |
| sexton | ✅ YES | 3354 | PASS |

**All 5 V-flip-fixed vehicles render the calibration decal.**

## Per-vehicle results

| Faction | Vehicle | Verdict | Footprint | Silhouette | Ratio | TL→BR ok | Golden drift | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aef | dodge_wc51 | PASS | 17262 | 435742 | 0.0396 | — | written | golden written (first run); orientation baselined (dy=30.2) |
| aef | dodge_wc54_ambulance | PASS | 11292 | 435218 | 0.0259 | — | written | golden written (first run); orientation baselined (dy=-34.8) |
| aef | m10_tank_destroyer | PASS | 16411 | 438629 | 0.0374 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| aef | m15a1_aa_halftrack | PASS | 23939 | 437343 | 0.0547 | — | written | golden written (first run); orientation baselined (dy=-12.9) |
| aef | m20_utility_car | PASS | 21800 | 431572 | 0.0505 | — | written | golden written (first run); orientation baselined (dy=-21.2) |
| aef | m21_mortar_halftrack | PASS | 21640 | 437615 | 0.0494 | — | written | golden written (first run); orientation baselined (dy=13.9) |
| aef | m26_pershing | PASS | 21561 | 439057 | 0.0491 | — | written | golden written (first run); orientation baselined (dy=-92.2) |
| aef | m3_halftrack | PASS | 21168 | 435922 | 0.0486 | — | written | golden written (first run); orientation baselined (dy=9.0) |
| aef | m36_tank_destroyer | PASS | 21173 | 440797 | 0.0480 | — | written | golden written (first run); orientation baselined (dy=-53.6) |
| aef | m4a1_sherman_calliope | PASS | 21826 | 445116 | 0.0490 | — | written | golden written (first run); orientation baselined (dy=-30.5) |
| aef | m4a3_sherman_76mm | PASS | 13849 | 440553 | 0.0314 | — | written | golden written (first run); orientation baselined (dy=61.9) |
| aef | m4a3e8_sherman_easy_8 | PASS | 7113 | 444201 | 0.0160 | — | written | golden written (first run); orientation baselined (dy=43.5) |
| aef | m5a1_stuart | PASS | 3866 | 437687 | 0.0088 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| aef | m7b1_priest | PASS | 26601 | 438371 | 0.0607 | — | written | golden written (first run); orientation baselined (dy=31.3) |
| aef | m8_greyhound | PASS | 13475 | 432462 | 0.0312 | — | written | golden written (first run); orientation baselined (dy=17.6) |
| aef | m8a1_hmc | PASS | 14645 | 435848 | 0.0336 | — | written | golden written (first run); orientation baselined (dy=14.4) |
| aef | sherman_m4a3 | PASS | 6362 | 444654 | 0.0143 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| british | aec_armoured_car | PASS | 17070 | 436712 | 0.0391 | — | written | golden written (first run); orientation baselined (dy=-28.6) |
| british | bren_carrier | PASS | 4271 | 430322 | 0.0099 | — | written | golden written (first run); orientation baselined (dy=56.6) |
| british | centaur | PASS | 25080 | 439302 | 0.0571 | — | written | golden written (first run); orientation baselined (dy=37.2) |
| british | churchill | PASS | 8447 | 440477 | 0.0192 | — | written | golden written (first run); orientation baselined (dy=37.3) |
| british | comet | PASS | 26165 | 441369 | 0.0593 | — | written | golden written (first run); orientation baselined (dy=-58.8) |
| british | cromwell | PASS | 33901 | 439124 | 0.0772 | — | written | golden written (first run); orientation baselined (dy=-30.5) |
| british | sexton | PASS | 3354 | 440741 | 0.0076 | — | written | golden written (first run); orientation baselined (dy=27.3) |
| british | sherman_firefly | PASS | 11807 | 440814 | 0.0268 | — | written | golden written (first run); orientation baselined (dy=-16.6) |
| british | valentine | PASS | 14784 | 432778 | 0.0342 | — | written | golden written (first run); orientation baselined (dy=45.0) |
| german | brummbar | PASS | 20142 | 439167 | 0.0459 | — | written | golden written (first run); orientation baselined (dy=53.9) |
| german | elefant | SMEAR | 46969 | 452420 | 0.1038 | — | written | golden written (first run); ratio 0.1038 > abs-floor 0.09 AND > 2× median 0.0396 |
| german | halftrack | PASS | 15594 | 437136 | 0.0357 | — | written | golden written (first run); orientation baselined (dy=-9.7) |
| german | opel_blitz | PASS | 30257 | 445011 | 0.0680 | — | written | golden written (first run); orientation baselined (dy=30.3) |
| german | ostwind_flak_panzer | PASS | 18685 | 441678 | 0.0423 | — | written | golden written (first run); orientation baselined (dy=9.3) |
| german | panzerwerfer | PASS | 12755 | 436348 | 0.0292 | — | written | golden written (first run); orientation baselined (dy=27.1) |
| german | sdkfz_222 | PASS | 16612 | 437988 | 0.0379 | — | written | golden written (first run); orientation baselined (dy=19.2) |
| german | sdkfz_250 | PASS | 10963 | 433346 | 0.0253 | — | written | golden written (first run); orientation baselined (dy=24.4) |
| german | stug_iii | PASS | 9979 | 436476 | 0.0229 | — | written | golden written (first run); orientation baselined (dy=79.2) |
| german | tiger | PASS | 12066 | 447391 | 0.0270 | — | written | golden written (first run); orientation baselined (dy=83.3) |
| soviet | halftrack | PASS | 21460 | 439644 | 0.0488 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | is2m_heavy_tank | PASS | 23603 | 441210 | 0.0535 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | isu152 | PASS | 26251 | 440822 | 0.0596 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | kv1_heavy_tank | PASS | 19879 | 438741 | 0.0453 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | kv2_heavy_tank | PASS | 21486 | 447638 | 0.0480 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | m3a1_scout_car | PASS | 10995 | 434008 | 0.0253 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | su-76m | PASS | 16654 | 434837 | 0.0383 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | su85 | PASS | 20332 | 435365 | 0.0467 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | t_34_85 | PASS | 19963 | 439422 | 0.0454 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | t34_76 | PASS | 18126 | 439243 | 0.0413 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | t70m_light_tank | PASS | 7693 | 431745 | 0.0178 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| soviet | us6_truck | PASS | 21480 | 447411 | 0.0480 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| west_german | halftrack_sdkfz_251 | PASS | 14439 | 434646 | 0.0332 | — | written | golden written (first run); orientation baselined (dy=-89.6) |
| west_german | halftrack_sdkfz_251_flak | PASS | 17278 | 436850 | 0.0396 | — | written | golden written (first run); orientation baselined (dy=-71.5) |
| west_german | halftrack_sdkfz_251_infrared | PASS | 18784 | 438656 | 0.0428 | — | written | golden written (first run); orientation baselined (dy=-51.0) |
| west_german | hetzer | PASS | 7211 | 431202 | 0.0167 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| west_german | jagdpanzer_iv_sdkfz_162 | PASS | 16635 | 434506 | 0.0383 | — | written | golden written (first run); orientation baselined (dy=35.4) |
| west_german | jagdtiger | PASS | 28986 | 450323 | 0.0644 | — | written | golden written (first run); orientation baselined (dy=7.3) |
| west_german | king_tiger_sdkfz_182 | PASS | 31899 | 447830 | 0.0712 | — | written | golden written (first run); orientation baselined (dy=48.1) |
| west_german | kubelwagen | PASS | 8041 | 431368 | 0.0186 | — | written | golden written (first run); orientation baselined (dy=-17.3) |
| west_german | panther_ausf_g | PASS | 18970 | 439046 | 0.0432 | — | written | golden written (first run); orientation baselined (dy=68.5) |
| west_german | panzer_ii_luchs_sdkfz_123 | PASS | 14823 | 432824 | 0.0342 | — | written | orientation indeterminate — bands too small / coincident; golden written (first run) |
| west_german | panzer_iv_sdkfz_ausf_i | PASS | 25390 | 437107 | 0.0581 | — | written | golden written (first run); orientation baselined (dy=87.8) |
| west_german | puma_sdkfz_234 | PASS | 21695 | 434138 | 0.0500 | — | written | golden written (first run); orientation baselined (dy=-31.7) |
| west_german | sturmtiger | PASS | 10685 | 443782 | 0.0241 | — | written | golden written (first run); orientation baselined (dy=29.9) |

## Problem vehicles

- **german/elefant** → SMEAR: golden written (first run); ratio 0.1038 > abs-floor 0.09 AND > 2× median 0.0396
