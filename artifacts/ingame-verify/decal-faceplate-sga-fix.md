# Decal + Faceplate SGA "invalid file structure" — Post-Mortem (2026-07-19)

## Symptom (in-game, `captures/warnings_gen4_boot.log`)

CoH2 rejected several editor-exported decal + faceplate SGAs at load:

```
MOD -- Error loading mod pack 'c6e8e078...': krispy_kreme_decal_aef.rgd not permitted.
MOD -- Error loading mod pack '...\mods\decals\Krispy_Kreme_Decal.sga': invalid file structure.
MOD -- Error loading mod pack '780b367c...': my_decal_pack_aef.rgd not permitted.
MOD -- Error loading mod pack 'aadd6753...': krispy_kreme_faceplate_faceplate.rgd not permitted.
MOD -- Error loading mod pack '...\faceplates\Krispy_Kreme_Faceplate.sga': invalid file structure.
MOD -- Error loading mod pack '0d6098c0...': my_faceplate_faceplate.rgd not permitted.
```

(The signed 152 MB faceplate `1777889949970245.sga` failing "not unsigned" is a copied Workshop item, NOT editor output — ignored.)

## Root cause: STALE PRE-FIX ARTIFACTS (not a current-code bug)

The failing SGAs on disk were built by the **OLD `sga-writer.ts`** that predates the
2026-06-10 folder-hierarchy fix. Byte-level TOC dump (`/tmp/sga-toc-dump.mjs`) shows the
two structural violations the CoH2 loader rejects:

### Divergence 1 — flat, forward-slash, leaf-only folder table (decal + faceplate)

Failing `Krispy_Kreme_Decal.sga` (10 folders):

```
FOLDER[0] name="attrib/vehicle_decal" sub[1..1) file[0..5)   ← FORWARD SLASH, empty sub-range, no "" root, no "attrib" parent
FOLDER[3] name="art/armies/aef/badges/<guid>" sub[4..4) ...   ← FORWARD SLASHES, leaf-only (no art, art\armies… ancestors)
```

CoH2's loader requires the **complete backslash hierarchy**: an empty-string `""` root
folder per drive, every intermediate ancestor (`art`, `art\armies`, `art\armies\aef`,
`…\badges`, `…\<guid>`), and real parent→children sub-ranges. Forward slashes + leaf-only
+ empty sub-ranges → the loader can't resolve the `.rgd`'s folder → `.rgd not permitted`
→ `invalid file structure`.

### Divergence 2 — faceplate missing the 6th file (root preview `.dds`)

Failing `Krispy_Kreme_Faceplate.sga` has only **5 files** (no root `.dds`). A loadable
faceplate needs **6**: the root `<slug>.dds` preview on the `info` drive.

## Ground truth (working packs that load clean `[Sig:0]`, same warnings.log)

| Working pack | files | folders | folder table |
|---|---|---|---|
| `KrispyKremeProbe.sga` (editor, decal) | 15 | 28 | backslash, `""` roots, full tree |
| `04cd6b0d…sga` (editor, unsigned decal) | 15 | 28 | backslash, `""` roots, full tree |
| `079246d340…sga` (Honvéd faceplate) | 6 | 11 | backslash, `""` roots, full tree, root `.dds` present |

## Current code path is ALREADY CORRECT — proven by rebuild

Built real SGAs through the actual editor code (`scripts/dump-editor-sgas.mts` →
`buildDecalMod` / `buildFaceplateMod`) and diffed topology (`/tmp/sga-topo.mjs`):

- **Editor decal** — DRIVE ORDER matches ground truth; folder name+sub-range tree is
  **GUID-normalized byte-identical** to the working unsigned `04cd6b0d`; 15/15 files
  raw-zlib-decompress to declared length.
- **Editor faceplate** — DRIVE ORDER + FULL FOLDER TREE (name+range shape) **identical**
  to the working Honvéd `079246…`; 6 files incl. the root `krispy_kreme_faceplate.dds`;
  6/6 files decompress cleanly.

`src/lib/sga-writer.ts` (the `FolderNode` tree builder + `driveOf`) emits backslashes,
the `""` roots, the full ancestor chain, and real sub-ranges. `buildDecalMod` and
`buildFaceplateMod` both call `buildSga` with the default `driveLayout:'skin'`
(4 drives) and include the root `.dds`. **No build-code change was required.**

## Skins: unaffected

`src/lib/mod-export.ts:706` calls `buildSga({ archiveName, files })` with the default
`'skin'` layout (unchanged). Only `scripts/build-verify-gamemode.mts` uses
`driveLayout:'gamemode'`. Skins were never regressed.

## The fix that matters: a permanent in-repo structural guard

Since the code was already correct, the durable fix is a **regression guard** so this
can never silently return. `src/lib/__tests__/sga-roundtrip.test.ts` gained
`describe('SGA v7 — structural load-compatibility guard (decal + faceplate)')` with
`rawTopology()` + `assertLoadableSkinLayoutTopology()`, asserting on REAL
`buildDecalMod`/`buildFaceplateMod` output:

1. 4 canonical drives in order (`attrib`/`locale`/`info`/`data`);
2. every drive's root folder name is `""`;
3. **no forward slash** in any folder name;
4. the **complete ancestor chain** exists for every leaf folder;
5. faceplate emits **exactly 6 files** incl. the root preview `.dds`;
6. the default skin export path stays on the 4-drive layout (no regression).

## Validation gate

- `npx tsc -b` — clean (exit 0)
- full suite — **2142/2142** (was 2139; +3 structural guards)
- `sga-roundtrip.test.ts` — **61/61**
- `scripts/verify-faceplate.mts` — PASS (texture round-trip)
- current-editor decal 15/15 + faceplate 6/6 files raw-zlib-decompress to declared length

## Confidence each mod-type will load in-game

- **Decal — HIGH.** Editor output is folder-tree byte-identical to the working unsigned
  `04cd6b0d` that loads clean `[Sig:0]`.
- **Faceplate — HIGH.** Editor output is folder-tree identical to the working Honvéd
  `079246…` (6 files incl. root `.dds`) that loads clean.
- **Skin — HIGH (unchanged).** Same writer/layout that has loaded clean since 2026-06-10.

The stale `Krispy_Kreme_*.sga` on disk must be **re-exported** from the current editor to
pick up the correct structure — they were not overwritten this session (no reinstall into
the Steam mods dir per the run brief). In-game re-verify via the harness next.

## Tools (this session)

- `/tmp/sga-toc-dump.mjs` — raw v7 TOC dumper (drives/folders/files, storage/verif bytes)
- `/tmp/sga-topo.mjs` — topology signature diff + per-file zlib-decompress integrity
- `scripts/dump-editor-sgas.mts` — build real decal+faceplate SGAs via the editor code path
