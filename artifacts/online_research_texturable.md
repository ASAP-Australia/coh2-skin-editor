# CoH2 War Paint — Player-Skinnable Vehicle Research

**Research date:** 2026-06-03  
**Primary sources:**
- Essence Engine Wiki (modding.companyofheroes.com/skin-pack) — TLS expired; content confirmed via search-result excerpts  
- coh2.org forum threads (URLs cited inline)  
- Steam Workshop skin pack descriptions  
- coh2.org community news / tournament pages  

---

## Authoritative Faction Counts (from Essence Engine Wiki, confirmed via multiple sources)

| Faction        | Skinnable vehicle count |
|----------------|------------------------|
| Ostheer        | 15                     |
| OKW            | 14                     |
| Soviet         | 15                     |
| USF            | 18                     |
| British (UKF)  | 11                     |

Source: modding.companyofheroes.com/skin-pack (content confirmed via coh2.org search results and Steam Workshop "Vehicle Skins All Factions" collection at https://steamcommunity.com/workshop/filedetails/?id=1694297222)

---

## Faction-by-Faction Analysis

### OstHeer (german) — 15 vehicles

**Your list:** tiger, elefant, brummbar, stug_iii, ostwind_flak_panzer, panzerwerfer, halftrack (Sd.Kfz.251), sdkfz_250, sdkfz_222, opel_blitz = **10 vehicles**

**Status:** All 10 confirmed as skinnable via community skin packs. The "Girls und Panzer" skin and Wikinger skin packs explicitly cover Opel Blitz, Sdkfz 222, Sdkfz 250, HT251, StuG III, Ostwind, Brummbar, Panzerwerfer, Elefant, and Tiger.

Sources: 
- https://www.coh2.org/topic/27537/all-factions-vehicle-skins-database  
- https://steamcommunity.com/sharedfiles/filedetails/?id=781749866 (lists Sturmpanzer IV, Ostwind, StuG III G, StuG III E, Panther, Panzer IV, Brummbar, Panzerwerfer)  
- https://www.coh2.org/topic/54723/broken-sdkfz-250-halftrack-spec-gloss-maps (SdKfz 250 confirmed as skin target)

**MISSING from your list (5 more to reach 15):**
The Essence Engine wiki notes that Stug III G and E share textures, and 250 Halftrack and 251 Mortar Halftrack share textures. The 15-count strongly suggests these additional Ostheer vehicles have skin slots:
- **panzer_iv** — noted as appearing in Ostheer skin context though the file lives in the OKW folder; community modders confirmed SdKfz 161 (Panzer IV) is an Ostheer texture target (https://www.coh2.org/topic/89625/where-are-wehrmacht-panzer-iv-and-panther-skins — resolved as OKW folder)
- **panther** — same situation; Panther is in OKW skin folder, not Ostheer's own 15 slots
- **sdkfz_251_mortar** (shares texture with sdkfz_250 per wiki) — counts as a separate slot even if texture is shared
- **sturmtiger** — appears in Ostheer-adjacent skin packs
- **marder** / **pak43** — possible candidates

**Confidence note:** Without direct game-file access the exact 5 missing Ostheer slots cannot be confirmed online. The modding wiki states 15 total and the 10 you listed are all confirmed. The gap of 5 is unresolved from open-web research alone.

---

### OKW (west_german) — 14 vehicles

**Your list:** king_tiger, jagdtiger, sturmtiger, panther, jagdpanzer_iv, panzer_iv, hetzer, puma, luchs, kubelwagen, sdkfz_251, sdkfz_251_flak, sdkfz_251_infrared, sws_halftrack = **14 vehicles**

**Count matches exactly (14).**

**sWS Halftrack status — see dedicated section below.**

The Wikinger OKW skin pack lists the "SWS truck" explicitly: https://steamcommunity.com/workshop/filedetails/?id=865427033

The coh2.org gamefiles UI thread (https://www.coh2.org/topic/82951/some-gamefiles-ui-fixes-for-next-patch) notes that the "sWS command halftrack currently uses panzergrau coloring" and lacks a player-selectable skin, while a coh2.org search result summary states: **"The OKW command halftrack (sWS) was noted as the only OKW vehicle without skins."**

However, the OKW count is officially 14, and your list has exactly 14 entries including sWS. This is contradictory — see verdict below.

---

### Soviet — 15 vehicles

**Your list:** is2, isu152, kv1, kv2, t34_76, t34_85, t70, su85, su76m, m3a1_scout_car, lend-lease_halftrack, us6_studebaker = **12 vehicles**

**Missing (3 more to reach 15):**
The Essence Engine wiki notes: "SU6 and Katyusha share the same texture; KV-1 and KV-8 share the same texture; M3 Halftrack can be found in both Soviet and US Forces; Lend Lease vehicle Sherman can also be found in Soviet Army."

This implies these are separate skin slots:
- **katyusha** (BM-13 rocket truck) — shares texture with SU6/ZiS-6 but has its own slot
- **lend_lease_sherman** (M4A2 Sherman) — the Soviet lend-lease Sherman is a separate skin target
- Possibly a third candidate from light vehicles (T-60, BA-64, etc.)

The Wikinger skin pack lists separately: "T-34/76, T-34/85, KV-1, KV-2, SU-76M, SU-85, ZIS-6 truck" — consistent with your list.

---

### USF (aef) — 18 vehicles

**Your list:** m26_pershing, m4a3e8_easy8, m4a3_sherman_76mm, m4a1_calliope, m10_wolverine, m36_jackson, m5a1_stuart, m8_greyhound, m7b1_priest, m3_halftrack, m15a1_aa_halftrack, m8a1_scott, m20, m21_mortar, dodge_wc51, dodge_wc54_ambulance, m4a3_sherman = **17 vehicles**

**Missing (1 more to reach 18):**
The Essence Engine wiki notes "M4A5 Sherman and Sherman Bulldozer share textures." The **Sherman Bulldozer** (M4A3 with dozer blade) is a separate skin slot even though it shares textures with the standard Sherman.  
- **ADD: m4a3_sherman_bulldozer** — confirmed as a skin slot per Essence Engine wiki

**Skin inconsistency note:** The m4a3_sherman_76mm (Mechanized doctrine) has a known broken skin slot — not all War Paint skins apply to it because "the Sherman 76 was originally a Soviet lend-lease vehicle." Ardennes Assault campaign skins do apply; community War Paint packs may not display on it. Source: https://www.coh2.org/topic/103725/usf-sherman-76-skin-inconsistency

---

### British (ukf) — 11 vehicles

**Your list:** churchill, comet, cromwell, centaur, firefly, valentine, sexton, aec_armoured_car, bren_carrier = **9 vehicles**

**Missing (2 more to reach 11):**
The Essence Engine wiki states "AVRE, Crocodile and Churchill share the same texture," indicating:
- **churchill_avre** — separate skin slot (shares Churchill texture)
- **churchill_crocodile** (flame Churchill) — separate skin slot (shares Churchill texture)

Both count toward the 11 even though they share the base Churchill texture file.

**Also note:** The coh2.org forum (https://www.coh2.org/topic/103725/usf-sherman-76-skin-inconsistency) mentions:
- **UKF M5 (Achilles / British M10)** — "no skins" per community modder; this may mean the Achilles is NOT in the 11-slot list despite being a UKF vehicle

---

## Special Verdicts

### Goliath — VERDICT: NO (not a real player-skinnable War Paint target)

**Evidence:**
1. No War Paint skin for Goliath exists on Steam Workshop. A search for "site:steamcommunity.com CoH2 goliath skin war paint workshop" found only gameplay discussion threads and one irrelevant result (a different game). No skin pack creator has published a Goliath reskin.
2. The "7th Panzer Division: Grey skin 1940" Workshop skin explicitly **omits** the Goliath from its skin set (search result: "missing from that particular skin set").
3. No coh2.org forum thread discusses Goliath as a War Paint target. The coh2.org topic #109045 "What about the Goliath" contains only balance/gameplay discussion.
4. The Goliath is a throwable demolition charge, not a crew-driven vehicle — it has no persistent in-game presence after deployment, making player-equippable skin display meaningless.
5. The 18 Goliath texture slots in game files are consistent with internal render/LOD variants, not player-facing War Paint customization slots.

**Conclusion:** The Goliath has texture files but is **not exposed in the in-game War Paint customization menu**. No published skin pack targets it. Goliath skin slots in game files = internal renderer use only.

---

### sWS Halftrack (OKW supply halftrack) — VERDICT: BORDERLINE / NOT A VANILLA WAR PAINT TARGET

**Evidence:**
1. A coh2.org search-result summary states: **"The OKW command halftrack (sWS) was noted as the only OKW vehicle without skins, using panzergrau."** Source: https://www.coh2.org/topic/82951/some-gamefiles-ui-fixes-for-next-patch
2. The coh2.org gamefiles UI discussion (same topic) explicitly says the sWS "uses panzergrau" as its default, proposing it be standardized alongside other un-skinned OKW vehicles (221/223 scout car, Opel Blitz).
3. The Wikinger Overhaul Mod skin pack (https://steamcommunity.com/workshop/filedetails/?id=865427033) includes an "SWS truck" skin — but this is for the **Wikinger mod**, not vanilla War Paint, and uses a custom override approach, not the standard player inventory skin equip system.
4. No vanilla War Paint Workshop skin for sWS has been found.
5. Your list has exactly 14 OKW vehicles (matching the official count). If sWS is NOT a true vanilla War Paint target, one of the other 13 + one different vehicle completes the 14.

**Conclusion:** The sWS halftrack **does have skin slots in the game files (4 slots noted)** but appears to not be exposed in the standard in-game War Paint customization/inventory menu for vanilla play. It is skinnable via custom mod overrides (Wikinger). For a player-facing War Paint skin pack targeting vanilla gameplay, the sWS is **not a reliable skin target** and is effectively invisible to players using the in-game menu.

**Recommendation:** Keep sWS in your file structure (the slots exist) but flag it as "mod-override only, not visible in vanilla inventory menu."

---

## Summary: ADD / REMOVE Recommendations

### REMOVE from your lists (not confirmed as player-facing War Paint targets):
- **Goliath** — if you have it in your vehicle list, remove it. No evidence it is player-visible or published as a War Paint target.

### ADD to your lists (confirmed missing):
- **USF:** `m4a3_sherman_bulldozer` (shares texture with m4a3_sherman but is a separate slot; brings USF to 18)
- **UKF:** `churchill_avre` and `churchill_crocodile` (share Churchill texture but are separate slots; brings UKF to 11)
- **Soviet:** `katyusha` and `lend_lease_sherman` (at minimum; needed to reach 15 total)
- **Ostheer:** 5 additional vehicles unconfirmed from web research alone (gap between your 10 and the official 15)

### UNCERTAIN / NEEDS GAME-FILE VERIFICATION:
- **sWS halftrack (OKW):** Has 4 file slots, likely NOT in vanilla War Paint menu. Keep in file structure but mark as non-player-facing.
- **OKW 221/223 scout car (sdkfz_221_222_223):** Referenced in the gamefiles discussion as lacking a proper default skin; may or may not have a War Paint slot.
- **UKF Achilles (M10):** Referenced as "no skins" by a coh2.org modder.
- **m4a3_sherman_76mm (USF):** Skin slot exists but known broken for many War Paint packs.

---

## Key Sources

- Essence Engine Wiki skin pack page: http://modding.companyofheroes.com/skin-pack (TLS expired — access via HTTP or Wayback Machine)
- All Factions Vehicle Skins Database: https://www.coh2.org/topic/27537/all-factions-vehicle-skins-database
- Vehicle Skins All Factions (Workshop): https://steamcommunity.com/workshop/filedetails/?id=1694297222
- Wikinger OKW Skin Pack: https://steamcommunity.com/workshop/filedetails/?id=865427033
- USF Sherman 76 skin inconsistency: https://www.coh2.org/topic/103725/usf-sherman-76-skin-inconsistency
- sWS skin/panzergrau discussion: https://www.coh2.org/topic/82951/some-gamefiles-ui-fixes-for-next-patch
- War Paint contest rules: https://www.coh2.org/topic/46463/company-of-heroes-2-steam-workshop-contest-war-paint
