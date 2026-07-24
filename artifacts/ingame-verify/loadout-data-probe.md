# CoH2 Equipped-Loadout Data Probe — Can we equip a skin by editing a local file?

**Probe date:** 2026-07-19 · Read-only investigation, no files edited, no game/Steam launch.

**Target skin:** SGA `3907714500011001.sga` (installed at `mods/skins/`), internal asset GUID `3f7ce0a144bb4c0aa1de5f2b0c9e7a11`, German Tiger, summer+winter. Goal: equip it in the German **Heavy (or Medium) × Summer** skin slot without driving the fiddly in-game 2D inventory UI.

---

## VERDICT (the key answer)

**The equipped loadout is SERVER-SIDE / Steam-Inventory-authoritative. It is NOT stored in any local, plaintext, editable file. There is no local file to edit to equip the skin. DO NOT attempt a file-based equip — it is not possible here, and the one file that even *could* hold per-user item state is AES-encrypted.**

CoH2's cosmetics are a Relic **War Spoils / Steam Inventory economy**. The client holds only encrypted/compressed *caches* of the server's item catalog and the user's item grants; the *equipped* mapping (which item occupies each vehicle-class × season slot) is resolved server-side at login and pushed to the client. Local edits to the cache files do not change what the server thinks is equipped, and would be overwritten (or rejected as a signature mismatch) on next login.

---

## (A) Which file holds the equipped loadout + its format

No local file holds an editable slot→skin mapping. Inventory of every candidate file in
`…/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/`:

| File | Size | Format | Contents (verified) | Loadout? |
|---|---|---|---|---|
| `76561198170207043item-coh2-coh2.dat` | 358 B | 8-byte header (`count=13`, `len=344`) + **standard base64** → 256 bytes of **AES-encrypted** data | Per-user item state keyed by SteamID64 `76561198170207043`. Decoded 256 bytes have Shannon entropy **7.23 bits/byte** and are not zlib-decompressible → encrypted, not readable/editable. No plaintext GUIDs, slot names, or factions. | **This is the equipped/owned item blob — but ENCRYPTED. Not editable.** |
| `ItemBundlesCache-coh2-coh2.dat` | 20 KB | 8-byte header + **zlib** → JSON | Steam-Inventory item catalog: `{itemBundleID, items:[{id, definitionID, durability, durabilityType, metadata, permissionFlags, permissionMask}]}`. Server economy data. | No. Catalog cache only. |
| `ItemCategoryCache-coh2-coh2.dat` | 28 KB | 8-byte header + **zlib** → JSON | Category catalog incl. the **exact slot category names**: `german_0001_summer_heavy`, `german_0002_winter_heavy`, `german_0003_summer_heavy`, `german_0004_summer_medium`, `skin_pack`, `vehicle_decal`, `Faceplate`, per-faction (`german`/`soviet`/`west_german`/`british`/`aef`). | No — defines the slot *taxonomy*, not what's equipped in each. |
| `live.dat` | 112 B | 8-byte header + **zlib** → JSON | `{"offlineTelemetryInfos":[…],"loginAttemptsFailed":0}` — login telemetry. | No. |
| `local.ini` | 1.4 KB | Plaintext INI | UI callouts (`callout_inventorybutton`), `latest_race=german`, last-match settings. Also `showcustomitems`, `showaestheticitems`, `showhistoricalskinsonly` toggles (visibility only). | No. |
| `AutomatchCache.dat` | 58 KB | Encrypted/opaque (not zlib, no header match) | Matchmaking cache. | No. |
| `GetAvailableAchievementsCache-*.dat` | 3.8 KB | zlib → JSON | Achievement list. | No. |
| `configuration_user.lua` / `configuration_system.lua` | — | Plaintext Lua | Video/audio/UI settings (incl. resolution, `showhistoricalskinsonly`). | No. |
| `steam_autocloud.vdf` | 52 B | Plaintext VDF | `{"accountid":"209941315"}` — just the account id. | No. |
| `savedShoppingCart.sav` | 12 B | 3 little-endian floats | Store cart state. | No. |

The **only** raw appearance of the skin GUID/id `3f7ce0a1…` / `3907714500011001` anywhere in the
tree is in `warnings.log` — the mod-**load** log (`[Sig:0]` load success), which is unrelated to
equipping. The `item-coh2` encrypted blob contains no plaintext of it.

## (B) Local-editable vs server-side — SERVER-SIDE (confirmed multiple ways)

1. **The item economy is Steam Inventory / War Spoils.** `ItemBundlesCache` uses the classic Steam
   Inventory schema (`definitionID`, `durability`, `permissionMask`, `metadata:{"dlc":1}`). These are
   server-granted items; the client caches the catalog but the authoritative owned/equipped state
   lives on Relic's servers and is re-fetched at login (see `live.dat` login telemetry + the
   `*Cache*` naming — these are server-response caches).
2. **The per-user item blob is AES-encrypted (7.23 bits/byte entropy, non-decompressible).** Even if
   it *did* contain the equipped mapping, it is signed/encrypted and cannot be hand-edited; a tampered
   blob would fail the server signature check at login.
3. **Prior research already reached this conclusion.** `artifacts/ingame-verify/vehicle-visual-plan.md`
   and `ingame-reference.md`: skins are equipped only via the in-game **army customizer** (player card
   → weapons-case icon → drag onto Light/Medium/Heavy × Summer/Winter slot), governed by War Spoils 2.0
   (one item per type per loadout). No file-edit path is documented because none exists.
4. **The editor repo confirms it never touches the loadout.** Grepping `coh2-skin-editor/src` for
   `loadout|item-coh2|ItemBundlesCache|steam.?inventory|definitionID|permissionMask` returns **zero**
   hits against any CoH2 user-data/`.dat` parsing. The only `loadout`/`slot` matches are the editor's
   *own* export-slot model (`ExportSlot`, `syncLiveStateToActiveSlot`, faceplate-preview comments) —
   i.e. which class/season slot a skin is *authored for* inside the SGA, not the game's equipped state.
   The editor writes SGAs into `mods/skins/`; it has no concept of, and no code to write, the equipped
   loadout.

## (C) If local-editable — N/A

Not applicable. There is no plaintext local slot→skin structure to change, and the only per-user
item file is encrypted and server-signed. No safe local-edit procedure exists.

## (D) Steam Cloud overwrite risk (secondary confirmation it's not the store)

Steam Cloud manifest for AppId 231430
(`~/.local/share/Steam/userdata/209941315/231430/remotecache.vdf`) syncs **only**:
`configuration_user.lua`, `flipchart.log`, `loading.log`, `news.log`, `shrink.log`, and a couple of
`mods/**` SGAs/previews. It does **NOT** sync `item-coh2*.dat`, `ItemBundlesCache`, `ItemCategoryCache`,
`local.ini`, `live.dat`, or `AutomatchCache.dat`. That these item files are *excluded* from Cloud is
itself evidence they are throwaway local caches of server state — the server, not Cloud, is the source
of truth. (Bonus: even a hypothetical local edit couldn't propagate via Cloud since these files aren't
in the manifest.)

---

## RECOMMENDATION

**DON'T touch any file. There is no file-based shortcut.** Equipping is server-side (Steam Inventory /
War Spoils); the equipped slot→skin mapping is not present in any editable local file, and the one file
that holds per-user item state (`76561198170207043item-coh2-coh2.dat`) is AES-encrypted and
server-signed. Editing it (or the zlib caches) will at best do nothing and at worst desync/ corrupt the
client's item state at next login.

**The only path to equip the Honvéd Tiger in German Heavy/Medium Summer is the in-game army-customizer
UI** (player card → weapons-case icon ≈ (1328, 76) → drag the skin onto the Heavy×Summer slot), driven
via the harness — exactly the fiddly flow this probe hoped to bypass. Since the skin already LOADS
(`[Sig:0]`) and the class/season taxonomy is confirmed (`german_0003_summer_heavy` etc. exist in
`ItemCategoryCache`), the remaining work is UI driving, not data editing.

### Files cited (all absolute)
- User-data dir: `/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/`
- Cloud manifest: `/var/home/jflessenkemper/.local/share/Steam/userdata/209941315/231430/remotecache.vdf`
- Prior research: `.../coh2-skin-editor/artifacts/ingame-verify/vehicle-visual-plan.md`, `ingame-reference.md`
- Wiki: `/var/home/jflessenkemper/llm-wiki/wiki/concepts/coh2-harness-driving.md` (skin picker = weapons-case icon; loadout UI flow never completed via file editing)
