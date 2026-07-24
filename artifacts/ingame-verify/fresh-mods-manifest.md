# Fresh In-Game Mods — Install Manifest (2026-07-19T03:55:28.523Z)

Built via the CURRENT editor build code path (buildDecalMod / buildFaceplateMod are the
real builders; skin via buildSga + public/template German skin_pack + canvasToRgt — the
same writer/template/RGT path exportSkinPack uses at mod-export.ts:706). Each passed:
SgaArchive round-trip, per-file raw-zlib-decompress == declared length, and the structural
load-compatibility topology guard (4 drives in order / "" roots / no forward slash /
full ancestor chains / faceplate == 6 files incl. root .dds).

## 1. DECAL — Honvéd Kereszt national-insignia pack (5 factions incl. german/aef)
- Installed: `/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/decals/subscriptions/a1b2c3d4e5f60718293a4b5c6d7e8f90.sga`
- GUID / [ID]: `a1b2c3d4e5f60718293a4b5c6d7e8f90`  (slug `honved_kereszt_insignia`)
- Internal .rgd/.rgt/.dds names:
    - attrib/vehicle_decal/honved_kereszt_insignia_aef.rgd
    - attrib/vehicle_decal/honved_kereszt_insignia_british.rgd
    - attrib/vehicle_decal/honved_kereszt_insignia_german.rgd
    - attrib/vehicle_decal/honved_kereszt_insignia_soviet.rgd
    - attrib/vehicle_decal/honved_kereszt_insignia_west_german.rgd
    - honved_kereszt_insignia.dds
    - art/armies/aef/badges/a1b2c3d4e5f60718293a4b5c6d7e8f90/default_dif.rgt
    - art/armies/british/badges/a1b2c3d4e5f60718293a4b5c6d7e8f90/default_dif.rgt
    - art/armies/german/badges/a1b2c3d4e5f60718293a4b5c6d7e8f90/default_dif.rgt
    - art/armies/soviet/badges/a1b2c3d4e5f60718293a4b5c6d7e8f90/default_dif.rgt
    - art/armies/west_german/badges/a1b2c3d4e5f60718293a4b5c6d7e8f90/default_dif.rgt
    - ui/assets/textures/a1b2c3d4e5f60718293a4b5c6d7e8f90_i1.dds

## 2. FACEPLATE — "HONVÉD" short-text banner (exactly 6 files)
- Installed: `/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/faceplates/subscriptions/b2c3d4e5f60718293a4b5c6d7e8f90a1.sga`
- GUID / [ID]: `b2c3d4e5f60718293a4b5c6d7e8f90a1`  (slug `honved_faceplate`)
- Internal .rgd/.dds names:
    - attrib/faceplate/honved_faceplate_faceplate.rgd
    - honved_faceplate.dds
    - ui/assets/textures/b2c3d4e5f60718293a4b5c6d7e8f90a1_i1.dds

## 3. SKIN — German Tiger Honvéd camo (real 2048² tiger diffuse)
- Installed: `/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins/3907714500011001.sga`
- On-disk numeric id: `3907714500011001`   internal asset GUID: `3f7ce0a144bb4c0aa1de5f2b0c9e7a11`
- Internal RGTs (summer + winter):
    - art/armies/german/vehicles/tiger/skins/3f7ce0a144bb4c0aa1de5f2b0c9e7a11_summer/tiger_dif.rgt
    - art/armies/german/vehicles/tiger/skins/3f7ce0a144bb4c0aa1de5f2b0c9e7a11_winter/tiger_dif.rgt

## Verification grep (run after the next harness launch, once CoH2 rewrites warnings.log)
```
grep -iE 'a1b2c3d4e5f60718293a4b5c6d7e8f90|b2c3d4e5f60718293a4b5c6d7e8f90a1|3907714500011001|3f7ce0a144bb4c0aa1de5f2b0c9e7a11' "/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/warnings.log"
```

### PASS criterion (per GUID/id)
For EACH of the three ids the log must show an
    `ARC -- ... <id> ... [Sig:0]`
line (archive opened, unsigned OK) and MUST NOT be followed by
    `MOD -- Error loading mod pack '<id>...': invalid file structure`
or
    `MOD -- Error ... <something>.rgd not permitted`
for that same id. Absence of any `invalid file structure` / `not permitted` line for the
id == LOAD SUCCESS. (Decal/faceplate are keyed by the 32-hex GUID; the skin appears as the
numeric filename `3907714500011001.sga` and/or its internal GUID `3f7ce0a144bb4c0aa1de5f2b0c9e7a11`.)
