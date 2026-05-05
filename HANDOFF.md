# CoH2 Skin Editor — Handoff Brief

## Goal
Build a fully-featured CoH2 skin pack editor as a static GitHub-Pages-deployable React/TS web app. Apple-style dark glassmorphism. Read user's local CoH2 install directly via File System Access API; composite decals onto vanilla diffuse RGTs; export a CoH2-loadable `.sga` skin pack.

## Locations
- **Project**: `/home/jflessenkemper/dev/coh2-skin-editor`
- **CoH2 install**: `/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2`
- **Bind mount for Chrome** (workaround for Bazzite `/var` blocklist): `/tmp/coh2/...` → bound to `~/.local/share/Steam`
- **Mods folder** (skin install target): `~/.steam/steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins/`
- **CoH2 warnings.log**: `…/Documents/My Games/Company of Heroes 2/warnings.log`
- **Mod Tools**: `~/.steam/steam/steamapps/common/Company of Heroes 2 Tools/` (`ModBuilder.exe`, `ArchiveViewer.exe`, `RelicCore.dll` are .NET; `Burn.exe` is native x86)
- **Static dev server**: `http://localhost:45089/coh2-skin-editor/` (Vite-built `dist/` served by Python http)
- **Chrome with CDP**: launched via flatpak, port `9222`, helper script `/tmp/cdp.py`

## What works (extensively tested)
Editor UI is feature-complete:
- ASAP-Australia branded connect screen with Apple-style glassmorphism, BorderBeam (ported faithfully from beam.jakubantalik.com — three-layer conic-gradient masked rotating glow), spring-bounce press, 5-second copy pills, Linux Setup sheet-in-place expansion (no modal-on-modal — Apple HIG)
- 3D Three.js viewport with raycast-based decal placement
- 6 decal types (shield, number, name, kills, cross, custom image)
- Image library with drag-drop / clipboard paste
- Auto-save to localStorage, `.coh2skin` project save/load
- SGA build pipeline (Node test harness `tools/test-export.ts` produces structurally-valid 66 MB v7 SGAs in 15s, 19 vehicles)
- Install button writes `<numericId>.sga` to mods folder

## TWO OPEN BLOCKERS

### Blocker 1: SGA reader can't load Tiger I (v7 storage=1 chunked compression)
**Symptom**: Browser viewport throws `invalid stored block lengths` on `tiger.rgm` from `ArtHigh.sga`.

**Root cause**: SGA v7 uses **chunked block compression** for storage type 1. Each file is split into ~256 KB pages, each independently compressed. `tiger.rgm` has `length=213324, storeLen=518804` (storeLen > length proves it's chunked, not monolithic zlib). Our `src/lib/sga.ts` `readFile()` calls `pako.inflate(rawBytes)` on the whole stored block, which fails because the data is multiple concatenated chunks.

**Note**: Just fixed `folderForFile()` to return the SMALLEST-range folder (was returning first-match = root drive folder, breaking path lookup). After that fix, the file IS found at the right path but inflate fails.

**Raw bytes** of stored tiger.rgm start with `78 da ec bd ...` — that's a valid zlib header but the stream extends past one chunk's payload.

**Fix needed**: Implement chunked decoder in `readFile()`. Likely format: iterate while bytes remain, each chunk = `u32 stored_size, u32 actual_size, then stored_size bytes (zlib if stored<actual, raw otherwise)`. Need to verify exact header layout. Best source: decompile `RelicCore.dll` `Archive` class' file-read method (decompiled at `/tmp/reliccore_decomp/RelicCore.decompiled.cs`).

### Blocker 2: Engine rejects exports as `'not unsigned'`
**Symptom**: When SGA installed at `mods/skins/<numericId>.sga`, CoH2's warnings.log shows:
```
ARC -- ...skins\<id>.sga ... [Sig:1232860824956446041]
MOD -- Error loading mod pack ...: not unsigned.
```

**What's verified**:
- ✅ Filename must match `%I64u.sga` (decimal u64) — fixed in writer
- ✅ Page size `0x00040000` at TOC bytes 188-191 — fixed
- ✅ Section size at 184-187 = `header_size` — fixed
- ✅ Format works: a renamed copy of a working Workshop sub at `mods/skins/8888888888888888.sga` loads with `Sig:0` (control verified)
- ✅ Sig is content-derived (changing 8 bytes of data block shifted Sig by +15872)
- ✅ Two HMAC-MD5 keys found in `RelicCoH2.exe`: `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` and `FDC245E1-D96A-44BD-B147-A89BD47F43FB`
- ✅ Corsix's CoH1 v4 uses same idiom: `MD5InitKey(KEY) → MD5(KEY || data)`. None of our HMAC-MD5/MD5(K||region) trials matched the engine's reported Sig
- ✅ `Ver` field IS confirmed = `MD5(toc_bytes)` (no key)
- ✅ `ID` field IS the archive name string (no hash)
- ✅ v7 SGA header has NO inline MD5 fields (unlike v4) — confirmed in `RelicCore.dll` decomp: `if (Version < 6) { FileMD5 = ... }`

**What's left**: Disassemble the `[Sig:%llu]` log site in `RelicCoH2.exe` via Ghidra. **Ghidra is installed**, project at `/tmp/ghidra-proj/`, the binary was already imported (`coh2.rep/idata/`). Need a script to find xrefs to file offset `0x1f5dc18` (the format string), trace back through the printf args, identify the function computing the Sig u64.

Key offsets in `RelicCoH2.exe`:
- `[Sig:%llu]` format string: file `0x1f5dc18` → VMA `0x141EFFE18`
- GUID 1 key: file `0x241d120` → VMA `0x14241F320`, 4 xrefs at `0x140343a96`, `0x140347708`
- GUID 2 key: file `0x1fd44f8` → VMA `0x141FD66F8`, 1 xref at `0x140dfc62a`
- `MOD -- Error loading mod pack ...: not unsigned.` at file `0x1fe170c`

Bisect script `/tmp/coh2_loop.sh` automates: build → install → launch CoH2 → wait for log → kill → parse — one cycle ~30 s.

## Big trap on Linux/Bazzite
Chrome's FS Access API blocks `~/.local`, `~/.steam`, AND **`/var`** (Bazzite stores home under `/var/home/USER/`). A symlink under `~` resolves canonically to `/var/...` and gets blocked. Solution baked into the app: bind mount under `/tmp`:
```bash
sudo mkdir -p /tmp/coh2
sudo mount --bind ~/.local/share/Steam /tmp/coh2
```
Then pick `/tmp/coh2/steamapps/common/Company of Heroes 2/`.

## Recent code changes not yet verified
- `src/lib/sga.ts` `folderForFile()` now picks smallest range (just added — NOT verified end-to-end yet because chunked storage blocks Tiger I before path lookup matters)
- `src/components/Viewport.tsx` has temporary console.log diagnostic that should be removed once stable

## Practical recommendation for next session
1. **First**: implement chunked storage decoder in `src/lib/sga.ts`. Decompile `RelicCore.dll` `Archive` class and look at `readFile`/decompression code (decomp already at `/tmp/reliccore_decomp/RelicCore.decompiled.cs` — search for `MD5_LENGTH`, line ~440, then look for read methods). Once Tiger I loads, the editor is fully usable.
2. **Then**: tackle Sig algorithm via Ghidra. Project already imported. Write a Java/Python script to find function containing the xref at VMA `0x140940b07` (where the printf is called) and decompile it to find which hash is fed to `%llu`.

## Style/UX preferences user has expressed
- Apple HIG over generic web modals
- No modal-on-modal stacking; sheet-in-place expansion preferred
- BorderBeam should match `beam.jakubantalik.com` exactly (three-layer)
- Glass design — no orange anywhere except brand accents
- Cool-silver/cyan-blue palette over purple
- Press-down + spring-bounce on every interactive button
- ASAP Australia logo + Australian-blue halo as brand mark
- Loading affordances on the BUTTON not in surrounding UI
- Width-stable pills (no shape change on state swap)

## TODO carry-over
1. Implement chunked storage in `sga.ts` `readFile()` → unblocks Tiger I model loading
2. Ghidra Sig algorithm → unblocks in-game skin loading
3. Test bind mount at `/tmp/coh2` end-to-end via real Chrome (last attempt: picker open, ydotool input went to wrong window — focus issue)
4. Once skin loads in CoH2, verify in skirmish; user wanted "create your own random custom mod end to end with the app"

## How to drive Chrome silently
`/tmp/cdp.py` accepts: `shot <out>`, `eval <expr>`, `click <selector>`, `type <text>`, `enter`. Chrome window is currently minimized. CDP works regardless of window state. **Native file pickers** require keyboard focus on the picker — that's the unsolved input-routing problem.

---

Pass this brief to the next session along with: "Continue from blocker 1 (chunked storage decoder), then blocker 2 (Sig RE)."
