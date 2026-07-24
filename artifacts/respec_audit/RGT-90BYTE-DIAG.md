# RGT 90-Byte Size Delta — Forensic Audit

**Date:** 2026-06-13  
**Investigator:** Claude (automated)  
**Status:** RESOLVED — FRAMING fix implemented, 1893/1893 tests green

---

## Problem Statement

`patchExport` patches freshly-encoded BC3 RGT bytes into pre-signed slots in
`tools/templates/template_0001.sga`. The current `rgt-writer.ts` emits **4,194,826**
bytes for a 2048² BC3 RGT with `{ compress: false, format: 'bc3' }`. The template's
`tiger_dif.rgt` slot is **4,194,736** bytes. Delta: **+90 bytes**.

---

## Step 1 — Extract Template Slot

Used the SGA v7 TOC parser (same logic as `build-manifest.ts`) to locate
`tiger_dif.rgt` in `tools/templates/template_0001.sga`:

- **Absolute offset in SGA:** 218,145,441
- **Length:** 4,194,736 bytes

### Template tiger_dif.rgt structural dump

```
File header: 0..35 (36 bytes)  [Relic Chunky v3]
FOLD/TSET v1  name="art\armies\german\vehicles\tiger\tiger_dif"(43B)  hdr=71  payload=4194629  total=4194700  @36
  DATA/DATA v3  name=""(0B)  hdr=28  payload=8   total=36   @107
  FOLD/TXTR v1  name="<unnamed spooge object>"(24B)  hdr=52  payload=4194541  total=4194593  @143
    FOLD/DXTC v3  name=""(0B)  hdr=28  payload=4194513  total=4194541  @195
      DATA/TFMT v1  name=""(0B)  hdr=28  payload=25   total=53   @223
      DATA/TMAN v1  name=""(0B)  hdr=28  payload=100  total=128  @276
      DATA/TDAT v1  name=""(0B)  hdr=28  payload=4194304  total=4194332  @404
```

**FBIF chunk: ABSENT**

TMAN (mipCount=12):
```
mip[0..10]: unc=0 cmp=0   (empty slots)
mip[11]:    unc=4194304  cmp=4194304  (raw BC3, no zlib)
```

TFMT payload:
```
+0:  width  = 2048
+4:  height = 2048
+8:  unk1   = 1
+12: unk2   = 2
+16: format = 15 (BC3/DXT5)
+20: unk3   = 0
+24: byte   = 1413563393 (0x54414401)
```

---

## Step 2 — Fresh RGT structural dump

Generated via `canvasToRgt(canvas, internalName, { compress: false, format: 'bc3' })`
where `internalName = "art\\armies\\german\\vehicles\\tiger\\tiger_dif"`:

```
File header: 0..35 (36 bytes)
DATA/FBIF v2  name="FileBurnInfo"(13B)  hdr=41  payload=49  total=90  @36   ← EXTRA
FOLD/TSET v1  name="art\armies\german\vehicles\tiger\tiger_dif"(43B)  hdr=71  payload=4194629  total=4194700  @126
  DATA/DATA v3  name=""(0B)  hdr=28  payload=8   total=36   @197
  FOLD/TXTR v1  name="<unnamed spooge object>"(24B)  hdr=52  payload=4194541  total=4194593  @233
    FOLD/DXTC v3  name=""(0B)  hdr=28  payload=4194513  total=4194541  @285
      DATA/TFMT v1  name=""(0B)  hdr=28  payload=25   total=53   @313
      DATA/TMAN v1  name=""(0B)  hdr=28  payload=100  total=128  @366
      DATA/TDAT v1  name=""(0B)  hdr=28  payload=4194304  total=4194332  @494
```

**FBIF chunk: PRESENT — 90 bytes total (hdr=41 + payload=49)**

---

## Step 3 — Byte-Delta Breakdown

| Component      | Template | Fresh    | Delta   |
|----------------|----------|----------|---------|
| File header    | 36 B     | 36 B     | 0       |
| **FBIF chunk** | **0 B**  | **90 B** | **+90** |
| TSET chunk     | 4194700 B| 4194700 B| 0       |
| DATA/DATA      | 36 B     | 36 B     | 0       |
| TXTR fold      | 4194593 B| 4194593 B| 0       |
| DXTC fold      | 4194541 B| 4194541 B| 0       |
| TFMT           | 53 B     | 53 B     | 0       |
| TMAN           | 128 B    | 128 B    | 0       |
| TDAT           | 4194332 B| 4194332 B| 0       |
| **TOTAL**      | **4194736**| **4194826**| **+90** |

**The 90-byte delta is entirely and solely the FBIF chunk.**

FBIF breakdown:
- chunk header: 28 + 13 (nameSize "FileBurnInfo\0") = 41 bytes
- payload: 4 (u32 op_len) + 25 (op string "generic-image to data-rgt") + 20 (zero padding) = 49 bytes
- Total: 41 + 49 = **90 bytes**

---

## Step 4 — Classification: FRAMING (fixable)

The FBIF chunk is a Relic metadata preamble (`FileBurnInfo`) that `rgt-writer.ts`
emits to help the CoH2 engine recognise unsigned custom-skin RGTs as valid.

The pre-signed `template_0001.sga` slots were built by Relic's own signing tool,
which did NOT include FBIF — the RSA signature already establishes legitimacy.
The FBIF chunk is **framing metadata**, not texture content, and contains zero
information that affects how the texture renders. It is structurally independent
of the RSA signature region.

**Verdict: FRAMING-FIXABLE.** Suppressing FBIF for the signed-patch path reduces
the output from 4,194,826 to exactly 4,194,736 bytes — byte-length-identical to
the template slot.

---

## Step 5 — Fix Implemented

### `src/lib/rgt-writer.ts`

Added `fbif?: boolean` option to `RgtOptions` (defaults `true` — preserves existing
unsigned/decal path behaviour). When `false`, the FBIF chunk is omitted:

```typescript
// New option in RgtOptions:
fbif?: boolean  // default true; set false for signed-patch path (no FBIF in template slots)

// Body assembly now conditional:
const emitFbif = options?.fbif ?? true
const body = emitFbif ? concatChunks([fbif, tset]) : tset
```

### `src/lib/mod-export.ts`

`patchExport` call updated to pass `fbif: false`:

```typescript
// Before:
const rgtBytes = canvasToRgt(composed.canvas, difTset, { compress: false, format: 'bc3' })

// After:
const rgtBytes = canvasToRgt(composed.canvas, difTset, { compress: false, format: 'bc3', fbif: false })
```

### `src/lib/__tests__/rgt-writer-format.test.ts`

Added exact-size pin test:
```typescript
it('patchExport path: 2048×2048 BC3 compress:false fbif:false is EXACTLY 4,194,736 bytes', () => {
  const canvas = solidCanvas(2048, 2048)
  const internalName = 'art\\armies\\german\\vehicles\\tiger\\tiger_dif'
  const rgt = canvasToRgt(canvas, internalName, { compress: false, format: 'bc3', fbif: false })
  expect(rgt.length).toBe(4_194_736)
})
```

Note: the exact byte count is specific to this internal name length (43B incl. null).
The `patchExport` pipeline always uses the canonical internal name, so the slot
length in the manifest (from `build-manifest.ts`) will match for each vehicle.

---

## Verification

```
tsc --noEmit:  CLEAN (no errors)
vitest run:    1893/1893 tests PASS
```

- Existing FBIF test (`rgt-roundtrip.test.ts` line 691) calls `canvasToRgt` with
  no options → `emitFbif` defaults `true` → test still passes.
- BC1 decal path: unaffected (no `fbif` option passed → defaults to `true`).
- Unsigned export path (`exportSkinPack`): unaffected (does not call with `fbif: false`).
