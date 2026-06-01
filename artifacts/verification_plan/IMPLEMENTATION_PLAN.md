# CoH2 Mod Artifact Verification — Implementation Plan

**Stage**: Synthesis / Implementation Brief  
**Date**: 2026-05-30  
**Executor**: downstream Sonnet agent reading ONLY this file

---

## 1. Verification Methodology

**The user cannot watch the game render** — they are playing another game on the same screen and explicitly forbid cursor control. Therefore **game launch is prohibited as a verification step**.

The single source of truth is **structural equivalence to the Wikinger skin mods** — a set of known-working CoH2 community skin SGAs installed on disk via Steam Workshop. These mods load correctly in the live engine, so any generated SGA whose internal drive/folder/file layout, file-naming conventions, and per-file format markers match the Wikinger references should likewise be accepted by the engine.

Concretely, "passes verification" means:
1. Our generated SGA parses cleanly through `SgaArchive.open` (the same reader CoH2 uses internally, already tested via `assertSgaParses` in the faceplate and decal builders).
2. The internal path table (drive → folder → file) matches the expected schema derived from the Wikinger golden references.
3. Each expected file type is present: `.rgt` for diffuse textures, `.rgd` for attrib chunks, `.dds` for UI icons/previews, `.ucs` for string tables, `.gfx` for UI layout.
4. For faceplates and decals: comparison is against real installed faceplate/decal Workshop SGAs on disk (golden references found — see §2). For vehicle skins: comparison is against the Wikinger skin SGAs.

No game launch. No cursor control. No screenshots required.

---

## 2. Golden Reference Files on Disk

### 2a. Wikinger Skin SGAs — vehicle skin golden references

All six files are in:
`~/.local/share/Steam/steamapps/common/Company of Heroes 2/userdata/209941315/ugc/referenced/`

| SGA filename | Full path | Expected faction(s) |
|---|---|---|
| `Wikinger Skins.sga` | `1669111214256583712/mods/skins/Wikinger Skins.sga` | german (OstHeer) |
| `Wikinger Skins OKW.sga` | `1789595341930052156/mods/skins/Wikinger Skins OKW.sga` | west_german (OKW) |
| `Wikinger Soviet Skins.sga` | `789756827192794018/mods/skins/Wikinger Soviet Skins.sga` | soviet |
| `Wikinger Skins US.sga` | `1728801381585855727/mods/skins/Wikinger Skins US.sga` | aef |
| `Wikinger Skins British.sga` | `1756940317247941225/mods/skins/Wikinger Skins British.sga` | british |
| `Wikinger Skins Extra.sga` | `1764867756234976550/mods/skins/Wikinger Skins Extra.sga` | supplemental (mixed) |

The verify script must open each of these with `SgaArchive.open` + `nodeFileShim` and call `.listPaths()` to enumerate their actual internal paths. Do NOT assume the faction mapping above is 100% complete — parse the actual paths; a file at `art/armies/soviet/vehicles/...` proves soviet coverage regardless of which SGA it lives in. The `Extra` SGA may contain additional vehicles for multiple factions.

**IMPORTANT — SGA v7 chunked-inflate caveat**: The Wikinger SGAs are v7 (not v10). Calling `.listPaths()` only reads the TOC (directory table), which does NOT decompress payloads. Path enumeration is safe and is NOT blocked by any inflate limitation. Decompressing a specific RGT payload (calling `.readByPath()` then `decodeRgt`) may fail on some heavily chunked files — use it optimistically with a try/catch fallback to synthesized buffers as specified in §3c.

### 2b. Faceplate golden references (REAL, on disk)

Three installed Workshop faceplate SGAs exist:

| SGA | Path |
|---|---|
| `HK416V2.sga` | `ugc/referenced/833577656980724769/mods/faceplates/HK416V2.sga` |
| `clarksonfaceplate.sga` | `ugc/referenced/1857182588366894237/mods/faceplates/clarksonfaceplate.sga` |
| `RamRanch_Faceplate1.sga` | `ugc/referenced/1843676213484654282/mods/faceplates/RamRanch_Faceplate1.sga` |

The verify script should open all three, extract their path tables, and confirm the expected faceplate schema (see §4). Use HK416V2 as the primary reference — the faceplate builder codebase already cites it as the authoritative proven example (faceplate-mod-build.ts:~124).

### 2c. Decal golden references (REAL, on disk)

Multiple installed Workshop decal SGAs exist:

| SGA | Path |
|---|---|
| `HeinzBeanz.sga` | `ugc/referenced/787491413366287494/mods/decals/HeinzBeanz.sga` |
| `Kings Own Yorkshire Light Infantry.sga` | `ugc/referenced/998016607071565642/mods/decals/Kings Own Yorkshire Light Infantry.sga` |
| `Pepe.sga` | `ugc/referenced/84842615010567884/mods/decals/Pepe.sga` |
| `twitch_decals.sga` | `ugc/referenced/621843338758768249/mods/decals/twitch_decals.sga` |
| `Wolfenstein.sga` | `ugc/referenced/261590659825844599/mods/decals/Wolfenstein.sga` |
| `SeibaV2.sga` | `ugc/referenced/420313597253794271/mods/decals/SeibaV2.sga` |
| `decal test.sga` | `ugc/referenced/769486946910173080/mods/decals/decal test.sga` |

Use `HeinzBeanz.sga` and `Kings Own Yorkshire Light Infantry.sga` as primary references.

---

## 3. Spec for `tools/generate-all-artifacts.ts`

### 3a. File header and shims

Replicate the shim block from `tools/test-export.ts` lines 25–43 verbatim:

```typescript
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'

;(global as any).ImageData = NodeImageData as any
;(global as any).HTMLCanvasElement = class {} as any
;(global as any).Image = Image as any
;(global as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return createCanvas(1, 1) as unknown as HTMLCanvasElement
    if (tag === 'a') return { click() {}, href: '', download: '' }
    throw new Error(`document.createElement(${tag}) not supported in Node shim`)
  },
}
;(global as any).URL = URL
```

Then import the project libs:

```typescript
import { SgaArchive } from '../src/lib/sga'
import { decodeRgt } from '../src/lib/rgt'
import { bcToCanvas } from '../src/lib/bc-decode'
import { canvasToRgt } from '../src/lib/rgt-writer'
import { buildSga, type SgaInputFile } from '../src/lib/sga-writer'
import { VEHICLES, FACTIONS } from '../src/lib/vehicles'
import { buildFaceplateMod } from '../src/lib/faceplate-mod-build'
import { buildDecalMod } from '../src/lib/decal-mod-build'
import { newFaceplateProject } from '../src/lib/faceplate-project'
import { newDecalPackProject } from '../src/lib/decal-pack-project'
import { freshPackId, factionSgaCandidates, textureBaseNamesFor } from '../src/lib/mod-export'
```

### 3b. Env vars and CLI args

```
COH2_INSTALL  — path to CoH2 install dir (default: ~/.local/share/Steam/steamapps/common/Company of Heroes 2)
OUT_DIR       — output root (default: out/verification)
```

Output structure:
```
out/verification/
  faceplates/
    german_faceplate.sga
    west_german_faceplate.sga
    soviet_faceplate.sga
    aef_faceplate.sga
    british_faceplate.sga
  decals/
    decal_pack.sga
  skins/
    <numericId>_german.sga
    <numericId>_west_german.sga
    <numericId>_soviet.sga
    <numericId>_aef.sga
    <numericId>_british.sga
```

### 3c. Faceplate generation (5 artifacts, one per faction)

For each faction in `['german', 'west_german', 'soviet', 'aef', 'british']`:

1. Create project: `const proj = newFaceplateProject('Test Faceplate - ' + faction)` (from `src/lib/faceplate-project.ts:528`).
2. Synthesize atlas buffer: `new Uint8ClampedArray(692 * 204 * 4)` filled with a faction-specific solid color (e.g., `fillSolid(r, g, b)` where German = grey (128,128,128), OKW = dark grey (64,64,64), Soviet = red (180,20,20), AEF = olive (100,120,50), British = tan (200,160,80)). The exact color is irrelevant — only the byte count (565,024) and BC3 encoding path matter.
3. Call `await buildFaceplateMod({ project: proj, atlasRgba: atlas })`.
4. Write `result.sga` to `out/verification/faceplates/${faction}_faceplate.sga`.
5. Log `result.guid`, `result.slug`, `result.sgaFilename`.

**`buildFaceplateMod` is fully headless** — it calls `encodeBc3` + `buildSga`, neither of which requires DOM. Confirmed at faceplate-mod-build.ts:83–184.

### 3d. Decal pack generation (1 artifact, covers all 5 factions)

Use the **v5 path** (no `partRgbas` argument) — the v6 path calls `document.createElement('canvas')` at decal-mod-build.ts:~199 and is NOT headless.

```typescript
const proj = newDecalPackProject('Test Decal Pack')
// iconRgba: 64×64×4 = 16384 bytes — synthesized gradient
const iconRgba = new Uint8ClampedArray(64 * 64 * 4)
for (let i = 0; i < 64 * 64; i++) {
  iconRgba[i * 4 + 0] = (i % 64) * 4           // R
  iconRgba[i * 4 + 1] = Math.floor(i / 64) * 4  // G
  iconRgba[i * 4 + 2] = 128
  iconRgba[i * 4 + 3] = 255
}
// decalRgba: 1024×1024×4 — synthesized solid
const decalRgba = new Uint8ClampedArray(1024 * 1024 * 4).fill(200)
const result = await buildDecalMod({ project: proj, iconRgba, decalRgba })
fs.writeFileSync(path.join(OUT_DIR, 'decals/decal_pack.sga'), Buffer.from(result.sga))
```

**NOTE**: `buildDecalMod` (decal-mod-build.ts:136) calls `makeCanvasFromRgba` internally for the v5 path (line ~235). Trace that function — if it calls `document.createElement`, the node-canvas shim must be active (it is, per §3a). The shim's `createElement('canvas')` returns a `node-canvas` Canvas, so `makeCanvasFromRgba` will work.

### 3e. Vehicle skin generation (5 SGAs, one per faction, covering all 48 vehicles)

This section replicates the approach from `tools/test-export.ts` but replaces the Dutch Brigade demo project with Wikinger-derived content.

**CRITICAL: use `freshPackId()` from `src/lib/mod-export.ts:79` for the SGA filename** — it generates a 64-bit decimal integer string (`String(Date.now() * 1000 + Math.floor(Math.random() * 1000))`). The filename written to disk must be this numeric id, e.g. `1748600000000123.sga`. The guid (32 hex chars) is separate and used only internally.

#### Per-faction SGA build loop:

```
For each faction in ['german', 'west_german', 'soviet', 'aef', 'british']:
  newGuid = freshModGuid()  // 32-char hex from crypto.getRandomValues
  numericId = freshPackId()
  sgaFiles: SgaInputFile[] = []
  
  Open the Wikinger SGA for this faction (see §2a mapping) via nodeFileShim + SgaArchive.open.
  Call wikinger.listPaths() to get all internal paths.
  Filter to paths matching: art/armies/<faction>/vehicles/<vehicleId>/.../<basename>_dif.rgt
  
  For each VEHICLES entry with vSpec.faction === faction:
    Attempt to decode Wikinger RGT for this vehicle (see §3e-i).
    Build summer + winter RGT entries (see §3e-ii).
  
  Load template files from public/template/ (see §3e-iii).
  Call buildSga({ archiveName: newGuid, files: sgaFiles }).
  Write to out/verification/skins/${numericId}_${faction}.sga
```

#### §3e-i — Wikinger RGT decode (with synthesized fallback)

```typescript
// Try to read the Wikinger diffuse for this vehicle
// vehicleId matches the catalog; Wikinger may use aliases
const wikiPaths = wikinger.listPaths()
const basenames = textureBaseNamesFor(vSpec.id)  // from mod-export.ts:100

let rgtCanvas: Canvas | null = null
let outBase = basenames[0]

for (const base of basenames) {
  const candidatePath = `art/armies/${faction}/vehicles/${vSpec.id}/${base}_dif.rgt`
  // Also try without the vehicleId folder level (some Wikinger layouts omit it)
  const match = wikiPaths.find(p =>
    p.includes(`/vehicles/${vSpec.id}/`) && p.endsWith('_dif.rgt')
  ) ?? wikiPaths.find(p =>
    p.endsWith(`${base}_dif.rgt`)
  )
  if (match) {
    try {
      const bytes = await wikinger.readByPath(match)
      if (bytes) {
        const rgt = decodeRgt(bytes)
        rgtCanvas = bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC) as unknown as Canvas
        outBase = path.basename(match, '_dif.rgt')
        break
      }
    } catch (e) {
      // SGA v7 chunked-inflate failure — fall through to synthesized
      console.warn(`  WARN could not decode Wikinger RGT for ${vSpec.id}: ${e}`)
    }
  }
}

// Synthesized fallback: solid RGBA 2048×2048
if (!rgtCanvas) {
  rgtCanvas = createCanvas(2048, 2048)
  const ctx = rgtCanvas.getContext('2d')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, 2048, 2048)
  console.warn(`  SYNTH ${vSpec.id} — no Wikinger RGT found or decode failed; using grey solid`)
}

// Convert to RGT
const difTset = `art\\armies\\${faction}\\vehicles\\${vSpec.id}\\${outBase}_dif`
const rgtBytes = canvasToRgt(rgtCanvas as unknown as HTMLCanvasElement, difTset)

// Add summer + winter entries
for (const season of ['summer', 'winter'] as const) {
  sgaFiles.push({
    path: `art/armies/${faction}/vehicles/${vSpec.id}/skins/${newGuid}_${season}/${outBase}_dif.rgt`,
    bytes: rgtBytes,
    compress: false,
  })
}
```

**outputBasename map** — copy from test-export.ts:193–206 exactly:
```typescript
const OUTPUT_BASENAME: Record<string, string> = {
  elefant:                 'elefant_hull',
  ostwind_flak_panzer:     'ostwind',
  sdkfz_222:               'sdkfz221',
  halftrack:               'halftrack',
  sdkfz_250:               'sdkfz250',
  king_tiger_sdkfz_182:    'kingtiger',
  puma_sdkfz_234:          'puma',
  jagdtiger:               'jagdtiger',
  jagdpanzer_iv_sdkfz_162: 'jagdpanzer_iv',
  panzer_ii_luchs_sdkfz_123: 'luchs',
  panzer_iv_sdkfz_ausf_i:  'panzeriv',
  m4a3e8_sherman_easy_8:   'm4a3e8_sherman',
  m4a3_sherman_76mm:       'm4a3_sherman_76',
  m4a1_sherman_calliope:   'm4a1_calliope',
  m10_tank_destroyer:      'm10',
  m36_tank_destroyer:      'm36',
  m15a1_aa_halftrack:      'm15_aa_halftrack',
  sherman_firefly:         'firefly',
  panther_ausf_g:          'panther',
}
// Usage: const outBase = OUTPUT_BASENAME[vSpec.id] ?? vSpec.id
```

#### §3e-ii — Template files (skin_pack attribs + UCS + INFO + GFX)

Copy the approach from test-export.ts:98–315. The `public/template/` directory already contains:
```
935a02ef44344ea29108b57b9cb7b9f5.info
attrib/skin_pack/german/caf_ss3_summer_heavy.rgd
attrib/skin_pack/german/caf_ss3_summer_light.rgd
attrib/skin_pack/german/caf_ss3_summer_medium.rgd
attrib/skin_pack/german/caf_ss3_winter_heavy.rgd
attrib/skin_pack/german/caf_ss3_winter_light.rgd
attrib/skin_pack/german/caf_ss3_winter_medium.rgd
english/english.ucs
ui/bin/935a02ef44344ea29108b57b9cb7b9f5.gfx
```

The `TEMPLATE_GUID = '935a02ef44344ea29108b57b9cb7b9f5'`.

For each template file:
- `.info` → rewrite name/description + GUID bytes, emit as `${newGuid}.info`
- `english.ucs` → `rewriteGuid(raw, newGuid)` → emit as `english/english.ucs`
- `.gfx` containing TEMPLATE_GUID → `rewriteGuid(raw, newGuid)` → emit as `ui/bin/${newGuid}.gfx`
- `.rgd` files → emit as-is at their `attrib/skin_pack/...` paths (the attrib RGDs reference the skin pack class, not the guid; no rewrite needed)

**NOTE**: The template only has `attrib/skin_pack/german/` RGDs. For non-German factions, reuse the same german RGDs at their original paths. The skin_pack attrib class is faction-agnostic (it defines the slot metadata for the entire pack entry, not per-vehicle textures). This matches what test-export.ts does — it never adjusts the faction of the attrib RGDs.

Also add: `ui/assets/textures/${newGuid}_i1.dds` — generate a 16×16 placeholder DDS. The simplest approach: call `buildFaceplateMod` with a 16×16 atlas and extract just the DDS, OR create a minimal DDS header manually. Easier option: synthesize a 64×64 solid DDS using the same `encodeBc3` + `wrapBc3InDds` functions used by the faceplate builder — import them directly:

```typescript
import { encodeBc3 } from '../src/lib/bc-encode'
import { wrapBc3InDds } from '../src/lib/dds-writer'  // verify actual path
const iconRgba = new Uint8ClampedArray(64 * 64 * 4).fill(128)
const iconDds = wrapBc3InDds(encodeBc3(iconRgba, 64, 64), 64, 64)
sgaFiles.push({ path: `ui/assets/textures/${newGuid}_i1.dds`, bytes: iconDds, compress: true })
```

If `dds-writer.ts` doesn't export `wrapBc3InDds` at that path, `grep -r wrapBc3InDds src/lib/` to find the actual export location before importing.

#### §3e-iii — Build the SGA

```typescript
const sgaBytes = await buildSga({ archiveName: newGuid, files: sgaFiles })
const outPath = path.join(OUT_DIR, 'skins', `${numericId}_${faction}.sga`)
fs.writeFileSync(outPath, Buffer.from(sgaBytes))
```

Use `buildSga` from `src/lib/sga-writer.ts` — same import as test-export.ts:49.

### 3f. Complete vehicles matrix (for reference during implementation)

Confirmed from `src/lib/vehicles.ts:32–92`:

| Faction | Vehicle IDs |
|---|---|
| german (9) | tiger, elefant, brummbar, stug_iii, ostwind_flak_panzer, panzerwerfer, halftrack, sdkfz_250, sdkfz_222 |
| west_german (10) | king_tiger_sdkfz_182, jagdtiger, sturmtiger, panther_ausf_g, jagdpanzer_iv_sdkfz_162, panzer_iv_sdkfz_ausf_i, hetzer, puma_sdkfz_234, panzer_ii_luchs_sdkfz_123, kubelwagen |
| soviet (11) | is2m_heavy_tank, isu152, kv1_heavy_tank, kv2_heavy_tank, t34_76, t_34_85, t70m_light_tank, su85, su-76m, m3a1_scout_car, halftrack |
| aef (11) | m26_pershing, m4a3e8_sherman_easy_8, m4a3_sherman_76mm, m4a1_sherman_calliope, m10_tank_destroyer, m36_tank_destroyer, m5a1_stuart, m8_greyhound, m7b1_priest, m3_halftrack, m15a1_aa_halftrack |
| british (7) | churchill, comet, cromwell, centaur, sherman_firefly, valentine, sexton |

Total: 48 vehicles across 5 factions.

---

## 4. Spec for `tools/verify-artifacts.ts`

### 4a. nodeFileShim — copy exactly from test-export.ts:142–157

```typescript
function nodeFileShim(fp: string): File {
  const fd = fs.openSync(fp, 'r')
  const stat = fs.statSync(fp)
  const slice = (start = 0, end?: number) => {
    const e = end ?? stat.size
    const len = Math.max(0, e - start)
    return {
      arrayBuffer: async () => {
        const buf = Buffer.alloc(len)
        if (len > 0) fs.readSync(fd, buf, 0, len, start)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      },
    } as Blob
  }
  return { name: path.basename(fp), size: stat.size, slice } as unknown as File
}
```

### 4b. Path extraction helper

```typescript
async function listSga(sgaPath: string): Promise<string[]> {
  const sga = await SgaArchive.open(nodeFileShim(sgaPath))
  return sga.listPaths()
}
```

Note: `SgaArchive.listPaths()` (sga.ts:297) returns `string[]` — all internal paths, slash-normalized, without drive prefix. Drive context is NOT included in the current `listPaths()` output. If drive distinction is needed, use `sga.list()` which exposes `SgaFile[]` with `.path` only. The drive name is encoded in the SGA folder hierarchy (the root-level folder name in the SGA = the drive alias). To extract drive info, you need to read the drive section of the TOC directly, or infer from path prefix (the sga.ts implementation does NOT currently surface drive names through `list()`). **Implication**: verify by path prefix instead of drive name — the paths already encode the drive semantically (attrib/, english/, ui/, art/ → different drives).

### 4c. Expected file schemas

#### Faceplate SGA — expected files (6 total):
```
attrib/faceplate/<slug>_faceplate.rgd     ← attrib drive
english/english.ucs                        ← english drive
<guid>.info                                ← info drive (root level)
ui/assets/textures/<guid>_i1.dds          ← data drive
ui/bin/<guid>.gfx                          ← data drive
```
Note: 5 files — the source description says 5; the .dds is the atlas. Confirmed from faceplate-mod-build.ts:142–167.

**Faceplate schema assertions**:
- Exactly 1 file matching `/attrib\/faceplate\/.+_faceplate\.rgd$/`
- Exactly 1 file `english/english.ucs`
- Exactly 1 file matching `/^[0-9a-f]{32}\.info$/`
- Exactly 1 file matching `/ui\/assets\/textures\/[0-9a-f]{32}_i1\.dds$/`
- Exactly 1 file matching `/ui\/bin\/[0-9a-f]{32}\.gfx$/`

#### Decal SGA — expected files (15 total):
```
attrib/vehicle_decal/<slug>_german.rgd
attrib/vehicle_decal/<slug>_west_german.rgd
attrib/vehicle_decal/<slug>_soviet.rgd
attrib/vehicle_decal/<slug>_aef.rgd
attrib/vehicle_decal/<slug>_british.rgd
english/english.ucs
<guid>.info
<slug>.dds                                  ← info drive root (preview texture)
art/armies/german/badges/<guid>/default_dif.rgt
art/armies/west_german/badges/<guid>/default_dif.rgt
art/armies/soviet/badges/<guid>/default_dif.rgt
art/armies/aef/badges/<guid>/default_dif.rgt
art/armies/british/badges/<guid>/default_dif.rgt
ui/assets/textures/<guid>_i1.dds
ui/bin/<guid>.gfx
```
Confirmed from decal-mod-build.ts:256–288.

**Decal schema assertions**:
- Exactly 5 files matching `/attrib\/vehicle_decal\/.+_(german|west_german|soviet|aef|british)\.rgd$/`
- Exactly 1 file `english/english.ucs`
- Exactly 1 file matching `/^[0-9a-f]{32}\.info$/`
- Exactly 1 file matching `/^.+\.dds$/` at root level (no folder prefix) — this is the `<slug>.dds`
- Exactly 5 files matching `/art\/armies\/(german|west_german|soviet|aef|british)\/badges\/[0-9a-f]{32}\/default_dif\.rgt$/`
- Exactly 1 file matching `/ui\/assets\/textures\/[0-9a-f]{32}_i1\.dds$/`
- Exactly 1 file matching `/ui\/bin\/[0-9a-f]{32}\.gfx$/`

#### Vehicle skin SGA — expected files per vehicle per faction:
For each vehicle `V` in faction `F`, for each season `S` in `[summer, winter]`:
```
art/armies/<F>/vehicles/<V>/skins/<guid>_<S>/<outputBasename>_dif.rgt
```
Plus template files:
```
<guid>.info
attrib/skin_pack/german/caf_ss3_summer_heavy.rgd
attrib/skin_pack/german/caf_ss3_summer_light.rgd
attrib/skin_pack/german/caf_ss3_summer_medium.rgd
attrib/skin_pack/german/caf_ss3_winter_heavy.rgd
attrib/skin_pack/german/caf_ss3_winter_light.rgd
attrib/skin_pack/german/caf_ss3_winter_medium.rgd
english/english.ucs
ui/bin/<guid>.gfx
ui/assets/textures/<guid>_i1.dds
```
Total = (N_vehicles × 2 seasons) + 10 template files per faction SGA.

**Vehicle skin schema assertions**:
- For each vehicle in faction: 2 RGT files present (summer + winter), paths match `art/armies/<faction>/vehicles/<vehicleId>/skins/.../<outBase>_dif.rgt`
- Exactly 6 files matching `/attrib\/skin_pack\/german\/caf_ss3_(summer|winter)_(heavy|light|medium)\.rgd$/`
- Exactly 1 `english/english.ucs`
- Exactly 1 `<guid>.info`
- Exactly 1 `ui/bin/<guid>.gfx`
- Exactly 1 `ui/assets/textures/<guid>_i1.dds`

**Wikinger comparison assertions** (for each faction):
1. Open the matching Wikinger SGA and call `.listPaths()`.
2. Extract all `art/armies/<faction>/vehicles/<vehicleId>/...` paths.
3. For each vehicleId in our matrix: confirm the Wikinger SGA contains at least one path for that vehicleId under `art/armies/<faction>/vehicles/<vehicleId>/`. Mark as REFERENCE_MISSING if absent (not a failure of our build — a gap in the Wikinger coverage, probably for DLC-exclusive vehicles).
4. For each vehicleId where Wikinger has coverage: assert our generated SGA also has 2 RGT files under `art/armies/<faction>/vehicles/<vehicleId>/skins/`.
5. Compare path TEMPLATE: Wikinger uses `art/armies/<faction>/vehicles/<vehicleId>/<outBase>_dif.rgt` (no skins/ subfolder — these are the vanilla textures). Our output uses `art/armies/<faction>/vehicles/<vehicleId>/skins/<guid>_<season>/<outBase>_dif.rgt` (skin subfolder — correct for a skin pack mod). Both are valid; they serve different purposes. Assert the `<outBase>` basename matches between Wikinger's path and our skin path.

### 4d. Output format

Emit a PASS/FAIL table per artifact to stdout and to `out/verification/report.txt`:

```
ARTIFACT                           STATUS   DETAILS
─────────────────────────────────────────────────────────────────────────
faceplates/german_faceplate.sga    PASS     5 files, schema OK
faceplates/soviet_faceplate.sga    FAIL     missing: attrib/faceplate/...
decals/decal_pack.sga              PASS     15 files, schema OK
skins/<id>_german.sga              PASS     28 RGTs + 10 template files; 9/9 vehicles Wikinger-confirmed
skins/<id>_soviet.sga              WARN     22 RGTs + 10 template files; 2/11 vehicles REFERENCE_MISSING (DLC?)
...
```

Exit code 0 if all PASS, 1 if any FAIL.

### 4e. Wikinger-specific assertions (path equivalence)

For each vehicle covered by both our SGA and the Wikinger reference:

```typescript
// Wikinger path: art/armies/german/vehicles/tiger/tiger_dif.rgt
// Our path:      art/armies/german/vehicles/tiger/skins/<guid>_summer/tiger_dif.rgt
// 
// Assert: basename(wikiPath) === basename(ourPath)
// i.e., 'tiger_dif.rgt' === 'tiger_dif.rgt'   → PASS
//       'kingtiger_dif.rgt' vs 'king_tiger_sdkfz_182_dif.rgt' → FAIL (outputBasename mismatch)
```

---

## 5. Likely Divergences and Fixes

### 5a. Faceplate

**Most likely divergence**: Atlas buffer dimension mismatch. `buildFaceplateMod` asserts `atlasRgba.length === 692 * 204 * 4 = 565024` (faceplate-mod-build.ts:88). If the synthesized buffer is wrong size, it will throw, not silently corrupt. **Fix**: ensure `new Uint8ClampedArray(692 * 204 * 4)` — not a rounded power-of-two.

**Less likely**: `makeSlug(packName)` returning empty. `buildFaceplateMod:99` falls back to `'faceplate'` string, so this is handled.

**No golden faceplate divergence expected** — real faceplate SGAs (HK416V2, clarkson, RamRanch) are on disk and were used to validate the builder. The code already cites HK416V2 as the authoritative example.

### 5b. Decal pack

**Most likely divergence**: `makeCanvasFromRgba` in the v5 path (decal-mod-build.ts:235) calls into node-canvas. If it uses a pattern like `new OffscreenCanvas(...)` instead of `document.createElement('canvas')`, the shim won't cover it. **Diagnosis**: grep for `makeCanvasFromRgba` implementation. If it's browser-only, add a second shim: `(global as any).OffscreenCanvas = createCanvas`. **Fix location**: add to the shim block in generate-all-artifacts.ts before the decal import.

**Second likely issue**: `binariseMask` (line ~232) clamps alpha. This is pure JS computation — no DOM — so no issue.

**Root `.dds` placement**: The `<slug>.dds` must be at the SGA root (no folder prefix) to land in the "info" drive. The sga-writer's `driveOf()` function routes based on path prefix. If `slug.dds` doesn't match any prefix, it goes to the root/info drive. Confirmed correct (decal-mod-build.ts:281 places it without a folder prefix).

### 5c. Vehicle skin

**Most likely divergence**: outputBasename mismatch vs Wikinger. If Wikinger stores `panther_dif.rgt` under `art/armies/west_german/vehicles/panther_ausf_g/` and our generator uses `panther_ausf_g_dif.rgt` (id-verbatim), the basename compare will FAIL. **Fix**: ensure the `OUTPUT_BASENAME` map (§3e-i) is applied and matches exactly what Wikinger uses. The verify script will catch this and print the specific mismatch.

**Second likely divergence**: Wikinger `Extra.sga` may contain vehicles for factions whose primary SGA was checked but didn't have that vehicle. The verify script should check ALL six Wikinger SGAs for a given vehicleId (not just the "primary" one) before marking REFERENCE_MISSING.

**Third likely divergence**: The `attrib/skin_pack/german/` RGDs are used for ALL factions' SGAs. If CoH2 validates that the `attrib/skin_pack/` faction subdirectory matches the actual faction of the skin pack, non-german faction SGAs will fail to load. **Diagnosis**: parse one of the Wikinger SGAs for a non-German faction and check whether it has `attrib/skin_pack/west_german/...` or `attrib/skin_pack/german/...`. **Fix**: if Wikinger shows `west_german`, `soviet`, etc. subdirs, generate per-faction RGD templates. For now, the template only has `german` — may need extending.
- **Fix location**: `public/template/attrib/skin_pack/` — add new faction subdirs with renamed copies. OR confirm from Wikinger that all factions use the same `german` attrib class (likely, as it's the original OstHeer template CoH2 ships with).

**Fourth consideration**: The Wikinger SGAs may be v7 with chunked zlib streams that pako.inflate handles via retry logic (sga.ts:360–365 tries `inflate` then `inflateRaw`). The path enumeration (`listPaths`) does NOT decompress, so it's safe. Reading individual RGTs may fail for a few vehicles — the synthesized fallback (§3e-i) handles this gracefully.

### 5d. SGA v7 vs output v4/v2

Check `src/lib/sga-writer.ts` to confirm what SGA version the writer emits. If it emits v4 (the version CoH2 expects for skin packs), all is well. If it emits v7 (the version used by Wikinger), ensure the `SgaArchive` reader can parse it (it can — the reader handles both v7 and v10). The Wikinger mods are v7; if `buildSga` emits a different version, it's still valid as long as CoH2 accepts it. Workshop skin packs are commonly v4 — verify against the reference decal/faceplate SGAs.

---

## 6. Runnable Commands

### Step 1: Install dependencies (if not already done)
```bash
cd /var/home/jflessenkemper/dev/coh2-skin-editor
npm install
```

### Step 2: Generate all artifacts
```bash
cd /var/home/jflessenkemper/dev/coh2-skin-editor
mkdir -p out/verification/{faceplates,decals,skins}

COH2_INSTALL="/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2" \
  OUT_DIR=out/verification \
  npx tsx tools/generate-all-artifacts.ts
```

Expected output: console log per artifact, total file counts, SYNTH warnings for any Wikinger vehicle whose RGT couldn't be decoded.

### Step 3: Verify all artifacts
```bash
cd /var/home/jflessenkemper/dev/coh2-skin-editor

WIKINGER_BASE="/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/userdata/209941315/ugc/referenced" \
  npx tsx tools/verify-artifacts.ts \
  --generated-dir out/verification \
  --wikinger-base "$WIKINGER_BASE" \
  | tee out/verification/report.txt

echo "Exit code: $?"
```

### Step 4: Spot-check a Wikinger path table (optional diagnostic)
```bash
cd /var/home/jflessenkemper/dev/coh2-skin-editor
npx tsx -e "
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SgaArchive } from './src/lib/sga'
const fp = '/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/userdata/209941315/ugc/referenced/1669111214256583712/mods/skins/Wikinger Skins.sga'
const fd = fs.openSync(fp, 'r')
const stat = fs.statSync(fp)
const file = { name: path.basename(fp), size: stat.size, slice: (s=0,e?) => { const len=Math.max(0,(e??stat.size)-s); return { arrayBuffer: async () => { const b=Buffer.alloc(len); if(len>0) fs.readSync(fd,b,0,len,s); return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) } } } }
const sga = await SgaArchive.open(file as unknown as File)
sga.listPaths().slice(0,30).forEach(p => console.log(p))
"
```

### Per-step verification checkpoints

| Step | PASS criterion |
|---|---|
| generate-all-artifacts completes | Exit code 0; files exist in out/verification/{faceplates,decals,skins}/ |
| Faceplate SGAs | Each parses without throw; exactly 5 files each |
| Decal SGA | Parses; exactly 15 files; `art/armies/*/badges/*/default_dif.rgt` × 5 present |
| Skin SGAs | Each parses; vehicle count × 2 RGT files + 10 template files present |
| verify-artifacts.ts | Exit code 0; report.txt shows all PASS (WARN on REFERENCE_MISSING is allowed) |

---

## 7. Implementation Checklist for Downstream Agent

- [ ] Verify `wrapBc3InDds` import path by grepping `src/lib/` before writing the import
- [ ] Verify `encodeBc3` import path by grepping `src/lib/`
- [ ] Copy `nodeFileShim` exactly from test-export.ts:142–157
- [ ] Copy shim block exactly from test-export.ts:25–43
- [ ] Do NOT import or call `buildDutchBrigadeDemo` anywhere
- [ ] Use `freshPackId()` from mod-export.ts:79 for skin SGA filenames
- [ ] Use v5 decal path (no `partRgbas` in `buildDecalMod` call)
- [ ] Use `new Uint8ClampedArray(692 * 204 * 4)` for faceplate atlas (not 692*204*3)
- [ ] Open ALL six Wikinger SGAs before finalizing REFERENCE_MISSING counts
- [ ] Check public/template/ files exist before reading; warn and skip if missing
- [ ] Output directory: `out/verification/` (relative to project root `coh2-skin-editor/`)
- [ ] Report file: `out/verification/report.txt`
