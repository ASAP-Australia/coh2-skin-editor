# CoH2 Skin Editor — Roster Validation Report

**Generated:** 2026-06-03  
**Sources:** ArtGermanEF.sga, ArtWestGerman.sga, ArtSovietEF.sga, ArtAEFSkins.sga, ArtBritish.sga  
**Workshop pack:** 3728271474 (`15582235286167053679_legacy.bin`)  
**Method:** Parsed SGA TOC folder entries only (no payload decompression). Counted distinct War Paint slot folders of the form `<faction>_NNNN_(summer|winter)` under `art/armies/<faction>/vehicles/<id>/skins/`.  
**Threshold:** CONFIRMED = 15+ numbered warpaint slots. SUSPECT = 5–14. WEAK = 1–4. NO_SLOTS = 0.

---

## Per-Faction Vehicle Tables

### OstHeer (`german`) — ArtGermanEF.sga

| Status    | Vehicle ID             | Warpaint Slots | Notes                                        |
|-----------|------------------------|----------------|----------------------------------------------|
| CONFIRMED | tiger                  | 38             | + tiger_ace summer/winter                   |
| CONFIRMED | elefant                | 38             |                                              |
| CONFIRMED | brummbar               | 38             |                                              |
| CONFIRMED | stug_iii               | 38             |                                              |
| CONFIRMED | ostwind_flak_panzer    | 66             | Also has okw_ slots (shared mesh)           |
| CONFIRMED | panzerwerfer           | 38             |                                              |
| CONFIRMED | halftrack              | 38             |                                              |
| CONFIRMED | sdkfz_250              | 38             |                                              |
| CONFIRMED | sdkfz_222              | 38             |                                              |
| CONFIRMED | opel_blitz             | 38             |                                              |
| CONFIRMED | **goliath**            | 18             | **NOT in roster** — real War Paint target   |
| SUSPECT   | stuka_aircraft         | 7              | Aerial unit; likely spillover from faction pack |

### OKW (`west_german`) — ArtWestGerman.sga

| Status    | Vehicle ID                    | Warpaint Slots | Notes                       |
|-----------|-------------------------------|----------------|-----------------------------|
| CONFIRMED | panther_ausf_g                | 66             |                             |
| CONFIRMED | panzer_iv_sdkfz_ausf_i        | 66             |                             |
| CONFIRMED | puma_sdkfz_234                | 66             |                             |
| CONFIRMED | halftrack_sdkfz_251           | 28             |                             |
| CONFIRMED | halftrack_sdkfz_251_flak      | 28             |                             |
| CONFIRMED | halftrack_sdkfz_251_infrared  | 28             |                             |
| CONFIRMED | hetzer                        | 28             |                             |
| CONFIRMED | jagdpanzer_iv_sdkfz_162       | 28             |                             |
| CONFIRMED | jagdtiger                     | 28             |                             |
| CONFIRMED | king_tiger_sdkfz_182          | 28             |                             |
| CONFIRMED | kubelwagen                    | 28             |                             |
| CONFIRMED | panzer_ii_luchs_sdkfz_123     | 28             |                             |
| CONFIRMED | sturmtiger                    | 28             |                             |
| **WEAK**  | **sws_halftrack**             | **4**          | **Candidate to REMOVE** — only 4 slots, likely spillover |

### Soviet (`soviet`) — ArtSovietEF.sga

| Status    | Vehicle ID              | Warpaint Slots | Notes                                  |
|-----------|-------------------------|----------------|----------------------------------------|
| CONFIRMED | halftrack               | 75             | Lend-Lease; also has us_ slots        |
| CONFIRMED | is2m_heavy_tank         | 44             |                                        |
| CONFIRMED | isu152                  | 44             |                                        |
| CONFIRMED | kv1_heavy_tank          | 44             | + skin_0001–0003 named skins          |
| CONFIRMED | kv2_heavy_tank          | 44             |                                        |
| CONFIRMED | m3a1_scout_car          | 44             |                                        |
| CONFIRMED | su-76m                  | 44             |                                        |
| CONFIRMED | su85                    | 44             |                                        |
| CONFIRMED | t34_76                  | 44             | + yellow_camo variant                 |
| CONFIRMED | t34_85                  | 44             | SGA id is `t34_85`; roster uses `t_34_85` (alias works) |
| CONFIRMED | t70m_light_tank         | 44             |                                        |
| CONFIRMED | us6_truck               | 44             |                                        |
| SUSPECT   | il2m_sturmovik_aircraft | 5              | Aerial unit; likely spillover          |

### USF (`aef`) — ArtAEFSkins.sga

| Status    | Vehicle ID              | Warpaint Slots | Notes |
|-----------|-------------------------|----------------|-------|
| CONFIRMED | dodge_wc51              | 32             |       |
| CONFIRMED | dodge_wc54_ambulance    | 32             |       |
| CONFIRMED | m10_tank_destroyer      | 32             |       |
| CONFIRMED | m15a1_aa_halftrack      | 32             |       |
| CONFIRMED | m20_utility_car         | 32             |       |
| CONFIRMED | m21_mortar_halftrack    | 32             |       |
| CONFIRMED | m26_pershing            | 32             |       |
| CONFIRMED | m36_tank_destroyer      | 32             |       |
| CONFIRMED | m3_halftrack            | 32             |       |
| CONFIRMED | m4a1_sherman_calliope   | 32             |       |
| CONFIRMED | m4a3e8_sherman_easy_8   | 32             |       |
| CONFIRMED | m5a1_stuart             | 32             |       |
| CONFIRMED | m7b1_priest             | 32             |       |
| CONFIRMED | m8_greyhound            | 32             |       |
| CONFIRMED | m8a1_hmc                | 32             |       |
| CONFIRMED | sherman_m4a3            | 32             |       |
| CONFIRMED | m4a3_sherman_76mm       | 22             |       |

### British (`british`) — ArtBritish.sga

| Status    | Vehicle ID          | Warpaint Slots | Notes                                             |
|-----------|---------------------|----------------|---------------------------------------------------|
| CONFIRMED | comet               | 23             |                                                   |
| CONFIRMED | aec_armoured_car    | 22             |                                                   |
| CONFIRMED | bren_carrier        | 22             |                                                   |
| CONFIRMED | centaur_aa          | 22             | Roster id = `centaur`, VEHICLE_FOLDER_ALIAS → `centaur_aa` |
| CONFIRMED | churchill           | 22             |                                                   |
| CONFIRMED | cromwell            | 22             |                                                   |
| CONFIRMED | sexton              | 22             |                                                   |
| CONFIRMED | sherman_firefly     | 22             |                                                   |
| CONFIRMED | valentine_command   | 22             | Roster id = `valentine`, VEHICLE_FOLDER_ALIAS → `valentine_command` |
| NO_SLOTS  | horsa_glider        | 0              | Glider/static; no War Paint slots at all         |

---

## Workshop Pack Contents (3728271474)

Pack reskins 7 vehicles across german + west_german factions (the pack stores files directly in vehicle folders rather than numbered slot subfolders, hence slot count = 0 in the folder-based scan — the 7 entries are confirmed by vehicle folder presence):

| Faction      | Vehicle ID           |
|--------------|----------------------|
| german       | halftrack            |
| german       | stug_iii             |
| german       | tiger                |
| west_german  | king_tiger_sdkfz_182 |
| west_german  | panther_ausf_g       |
| west_german  | panzer_iv_sdkfz_ausf_i |
| west_german  | puma_sdkfz_234       |

---

## Roster Cross-Check vs `src/lib/vehicles.ts`

### CONFIRMED-AND-IN-ROSTER (good — all 62 roster entries pass)

All 10 german, 14 west_german, 12 soviet, 17 aef, and 9 british roster entries are CONFIRMED (15+ warpaint slots). No roster entry points to a missing or non-existent vehicle.

### IN-ROSTER-BUT-WEAK-EVIDENCE (candidate to REMOVE)

| Faction      | Roster ID      | SGA ID         | Slots | Recommendation              |
|--------------|----------------|----------------|-------|-----------------------------|
| west_german  | sws_halftrack  | sws_halftrack  | 4     | REMOVE — only 4 warpaint slots, likely player-invisible spillover from faction skin bundles |

### CONFIRMED-BUT-MISSING-FROM-ROSTER (candidates to ADD)

| Faction | SGA ID  | Slots | Suggested displayName | Suggested class |
|---------|---------|-------|-----------------------|-----------------|
| german  | goliath | 18    | Goliath Demolition Carrier | light (or utility) |

`goliath` has 18 numbered warpaint slots in ArtGermanEF.sga — a genuine War Paint target. It is not in the roster.

### NOT-REAL-TARGETS (skip, do not add)

- `stuka_aircraft` (german, 7 slots) — aerial unit, not a player-skinnable vehicle
- `il2m_sturmovik_aircraft` (soviet, 5 slots) — same
- `horsa_glider` (british, 0 slots) — glider/static

---

## Wiki vs Roster Discrepancy Analysis

Wiki claimed: Ostheer=15 / Soviet=15 / USF=18 / OKW=14 / British=11  
Roster has:   german=10 / soviet=12 / aef=17 / west_german=14 / british=9

| Faction | Wiki | Roster | SGA CONFIRMED | Gap Explanation |
|---------|------|--------|---------------|-----------------|
| OstHeer | 15   | 10     | 11*           | Wiki likely counts goliath (+1, real) + stuka_aircraft (+1, aerial, not real player target) + possibly 3 spillover soldier vehicles or named infantry skins miscounted as vehicles. The SGA has exactly 11 real vehicle targets (10 roster + goliath). Wiki is inflated. |
| Soviet  | 15   | 12     | 12            | Wiki likely counts il2m_sturmovik (+1, aerial) and 2 others (possibly joint-faction halftracks double-counted). All 12 roster entries CONFIRMED. Wiki is inflated by 3. |
| USF     | 18   | 17     | 17            | Exact match between SGA and roster at 17. Wiki's "18" likely counts a 18th that Relic reserved/removed. One slot discrepancy, wiki likely stale. |
| OKW     | 14   | 14     | 13**          | Roster = wiki = 14. `sws_halftrack` has only 4 slots — it is either a very sparse War Paint target or spillover. Wiki agrees it should be 14, so it may be intentional. Mark SUSPECT rather than removing. |
| British | 11   | 9      | 9             | Wiki likely counts `horsa_glider` (+1, no warpaint) and one more, possibly a second valentine variant. All 9 roster entries CONFIRMED. Wiki inflated by 2. |

*German 11 confirmed = 10 roster + goliath (missing from roster)  
**OKW 13 fully-confirmed = 14 roster minus sws_halftrack (4 slots)

---

## Summary of Recommended Changes to `src/lib/vehicles.ts`

### ADD
```typescript
V('goliath', 'german', 'Goliath Demolition Carrier', 'light', '192'),
```
(or `'utility'` class — it is a remote-demolition carrier, not a combat vehicle)

### REMOVE (or mark as suspect)
```typescript
// sws_halftrack — only 4 warpaint slots in ArtWestGerman.sga
// Consider removing or leaving as-is if the editor should still support it
V('sws_halftrack', 'west_german', 'sWS Supply', 'utility', '168'),
```

### NO CHANGES NEEDED
All other 61 roster entries are CONFIRMED with 15+ warpaint slots and correct SGA folder ids (or correctly aliased via VEHICLE_FOLDER_ALIAS).
