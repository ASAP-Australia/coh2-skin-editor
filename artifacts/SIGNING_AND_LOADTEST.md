# Signed-Template Patch Path — How It Works and How to Test

## Overview

CoH2 only loads skin packs that carry a valid Relic RSA signature. We cannot
compute the signature ourselves (private key is held by Relic). The workaround
is the **signed-template patch path**: a pre-signed SGA (`template_0001.sga`)
ships inside the repo. The export pipeline overwrites only the raw texture
payload bytes at known offsets, leaving the signed TOC and header untouched.
Because the RSA signature covers the TOC — not the data section — the
signature stays valid after the patch.

## Key limitation: baked basenames

The signed template was built with the vehicle texture basenames that were
current at template-creation time (e.g. `m10_dif.rgt`, `kingtiger_dif.rgt`,
`panther_dif.rgt`). The manifest (`public/keys/manifest.json`) maps slot paths
to byte offsets using those same old basenames. If the canonical output
basename for a vehicle has been corrected since then (tracked in
`OUTPUT_BASENAME` in `src/lib/mod-export.ts`), the corrected texture name will
**not** appear in the signed template's TOC. The engine therefore loads the
correct texture bytes but under the old path — which may or may not match
what the `.rgd` skin-pack attribute files reference.

**Full correctness requires re-signing the template** (see below). The current
patch path is sufficient to prove the signature-preservation mechanism works.

## Running the load test

### 1. Generate the candidate pack

```bash
npx tsx tools/patch-signed-pack.mts
# Outputs: out/verification/signed/<numericId>.sga
```

### 2. Verify the signature region offline (no game needed)

```bash
npx tsx tools/verify-signed-patch.mts
# Prints: "TOC/signature region intact: PASS" or "FAIL"
```

### 3. Install and test in-game

Make sure CoH2 is not already running, then:

```bash
# Copy the pack to the mods/skins folder and print instructions:
./tools/ingame-load-test.sh

# Or copy AND launch CoH2 automatically (Steam single-game lock applies):
./tools/ingame-load-test.sh --launch
```

The script copies the `.sga` into:
```
~/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/
  Documents/My Games/Company of Heroes 2/mods/skins/<numericId>.sga
```

After the game starts, inspect the engine log for verdict:
```
~/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/
  Documents/My Games/Company of Heroes 2/warnings.log
```

Success: lines containing the numeric ID with `loaded` / `registered`.
Failure: `not signed`, `not unsigned`, `invalid signature`.

## Re-signing the template (to fix baked basenames)

To produce a correctly signed template with the current canonical vehicle
basenames, publish a real Workshop skin pack and extract the signed SGA:

1. **Export a full skin pack** from the editor UI (Publish flow), choosing a
   project that covers all 47 vehicles across all five factions.
2. **Publish via the in-app publish button** (or `steamcmd` +
   `workshop_build_item`). Steam signs the SGA before uploading.
3. **Download the signed SGA** from the Workshop item's UGC storage:
   ```
   ~/.local/share/Steam/steamapps/common/Company of Heroes 2/
     userdata/<userId>/ugc/referenced/<workshopId>/mods/skins/<numericId>.sga
   ```
4. **Replace the template**:
   ```bash
   cp <downloaded>.sga tools/templates/signed/template_0001.sga
   ```
5. **Regenerate the manifest** (reads byte offsets from the new template):
   ```bash
   npx tsx tools/build-manifest.ts
   # Rewrites public/keys/manifest.json
   ```
6. Commit both files. Future patch exports will use the new basenames.

## Files involved

| File | Purpose |
|------|---------|
| `tools/templates/signed/template_0001.sga` | Pre-signed 394 MB template SGA |
| `public/keys/manifest.json` | Slot paths → byte offsets in the template |
| `src/lib/mod-export.ts` | `patchExport()`, `outputBasename()`, `vehicleFolder()` |
| `tools/patch-signed-pack.mts` | Headless CLI patcher |
| `tools/verify-signed-patch.mts` | Offline byte-diff verifier |
| `tools/ingame-load-test.sh` | Turnkey install + launch script |
