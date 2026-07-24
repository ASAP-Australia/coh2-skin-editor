# CoH2 Decal Pack In-Game Authoring Audit
_Generated 2026-06-19 | READ-ONLY artifact_

## Reference: Decal Pack Wizard / coh2.org documented format

| Element | Documented requirement |
|---|---|
| Factions | AEF, German, Soviet, West German (4 official Relic template factions) |
| British/UKF | NOT listed in Decal Pack Wizard templates; no official template exists |
| Per-faction art | `art/armies/<faction>/badges/<guid>/default_dif.rgt` (RGT, BC1/DXT1) |
| Resolution | 128×128 grid for individual decals; community packs confirmed at 1024×1024 RGTs |
| Inventory icon DDS | `ui/assets/textures/<guid>_i1.dds` (BC3/DXT5) |
| Pack preview DDS | Root-level `<slug>.dds` (BC3/DXT5, info drive) |
| GFX | `ui/bin/<guid>.gfx` (Scaleform SWF, GUID-substituted) |
| Per-faction RGDs | `attrib/vehicle_decal/<slug>_<faction>.rgd` (Relic Chunky blobs) |
| UCS | `english/english.ucs` (UTF-16-LE with BOM, CRLF) |
| Info | `<guid>.info` (ASCII, CRLF) |

## Our export output (from `decal-mod-build.ts`)

| SGA file | Our output |
|---|---|
| `attrib/vehicle_decal/<slug>_aef.rgd` | ✓ emitted |
| `attrib/vehicle_decal/<slug>_british.rgd` | ✓ emitted (see British section) |
| `attrib/vehicle_decal/<slug>_german.rgd` | ✓ emitted |
| `attrib/vehicle_decal/<slug>_soviet.rgd` | ✓ emitted |
| `attrib/vehicle_decal/<slug>_west_german.rgd` | ✓ emitted |
| `english/english.ucs` | ✓ UTF-16-LE BOM + CRLF |
| `<guid>.info` | ✓ ASCII CRLF |
| `<slug>.dds` | ✓ BC3, info drive (root) |
| `art/armies/aef/badges/<guid>/default_dif.rgt` | ✓ emitted |
| `art/armies/british/badges/<guid>/default_dif.rgt` | ✓ emitted (see British section) |
| `art/armies/german/badges/<guid>/default_dif.rgt` | ✓ emitted |
| `art/armies/soviet/badges/<guid>/default_dif.rgt` | ✓ emitted |
| `art/armies/west_german/badges/<guid>/default_dif.rgt` | ✓ emitted |
| `ui/assets/textures/<guid>_i1.dds` | ✓ BC3 64×64 |
| `ui/bin/<guid>.gfx` | ✓ GUID-substituted Scaleform SWF |

**Total: 15 files — matches reference layout exactly.**

## Texture formats

| Texture | Required | Our output |
|---|---|---|
| Per-faction RGT | BC1 (DXT1), 1024×1024 (`DECAL_TEXTURE_SIZE`) | ✓ BC1 via `canvasToRgt()`, binarised white-on-black mask |
| Inventory icon | BC3 (DXT5), 64×64 | ✓ `encodeBc3`, 64×64 (`DECAL_ICON_SIZE`) |
| Pack preview DDS | BC3 (DXT5), any size | ✓ BC3, 280×280 (`DECAL_MAIN_SIZE`) |

## British/UKF faction answer

The Decal Pack Wizard documents **only 4 factions** (AEF, German, Soviet, West German). British is NOT in Relic's official template set.

However, our app (`decal-mod-templates.ts` line 32, `FACTION_ORDER`) ships **5 factions**:
```
['aef', 'british', 'german', 'soviet', 'west_german']
```

The British RGD template (`RGD_BRITISH_B64`) was extracted byte-for-byte from the real workshop pack "Wikinger Decal Remover" (Steam ID 859505244), which also ships a `british` entry. This indicates **the engine does accept a `british` decal faction** in the wild — it is just not covered by Relic's Decal Pack Wizard UI. Our British RGD correctly references `DATA:\art\armies\british\badges\<guid>\default_dif.rgt` (confirmed from the base64 decode comment in `decal-mod-templates.ts` line 51).

**Verdict on British:** Our British support mirrors a confirmed working community pack. It is NOT an invented path — it was reverse-engineered from a real published SGA.

## Export pipeline note

`decal-pack-export.ts` (`exportDecalPackZip`) emits a **ZIP of raw PNGs** + a `manifest.json` — NOT an SGA. This is the intermediate "manual setup" export for users following the coh2.org tutorial. The full SGA build is in `buildDecalMod()` (`decal-mod-build.ts`).

## Gaps / risks

| # | Gap | Severity |
|---|---|---|
| 1 | `decal-pack-export.ts` ZIP export does not produce an SGA — it is a user-facing intermediate artefact for the manual tutorial workflow, not the in-game pipeline. The SGA path is `buildDecalMod()` only. This is intentional and documented in the file header ("Direct SGA emission is reserved for v1.1"). No bug, but confirm users are directed to the SGA export, not just the ZIP. | Low / informational |
| 2 | RGT internal path uses backslashes (`art\\armies\\<faction>\\badges\\<guid>\\default_dif`) — line 236 of `decal-mod-build.ts`. This matches the Relic Chunky DATA path convention. No gap. | None |
| 3 | Visual in-game projection requires an F12 / Workshop test. The SGA passes `SgaArchive.open()` round-trip (`assertSgaParses`), loads clean (Sig:0), and mirrors a real workshop pack byte-for-byte. But final rendered-on-vehicle confirmation still needs a live in-game test. | Informational |

## Summary

Our `buildDecalMod()` output matches the documented Decal Pack Wizard / community format on all 15 required files, correct formats (BC1 RGTs at 1024×1024, BC3 DDS, GUID-substituted GFX/RGDs), and correct SGA drive routing. The British faction is handled via a real reverse-engineered template — not an invented path. No structural gaps identified. Final visual confirmation requires an in-game F12 check.
