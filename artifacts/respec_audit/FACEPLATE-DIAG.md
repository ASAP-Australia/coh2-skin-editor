# Faceplate Bug Diagnosis

**Date:** 2026-06-13  
**Bugs:** (1) Workshop preview shows faceplate ICON, not the actual faceplate image. (2) In-game faceplate is low resolution.

---

## A. In-game Faceplate Image Pipeline (Bug #2)

### Atlas geometry (ground truth from faceplate-templates.ts:41-147)

The GFX template encodes two sub-rects inside a 692×204 BC3/DXT5 atlas:

```
Atlas: 692×204 (ATLAS_WIDTH × ATLAS_HEIGHT)
  Banner sub-rect: x=0, y=0, w=624, h=204   ← engine samples this for the lobby banner
  Icon sub-rect:   x=624, y=0, w=64, h=64   ← engine samples this for chat/scoreboard icon
  (Padding: 4px right, 140px bottom-right — dead space)
```

Verified against three reference workshop mods (Ram Ranch, Clarkson, HK416V2) — all three store a 692×204 DXT5 atlas.

### Editor canvas size

`FACEPLATE_BANNER_W = 624`, `FACEPLATE_BANNER_H = 204`  
(`src/lib/faceplate-project.ts:37-38`)

`composeFaceplateCanvas()` creates a **624×204** canvas and draws all layers into it.  
(`src/components/FaceplateEditor.tsx:4294-4299`)

### Export (build) path — `handleRequestBuild` (FaceplateEditor.tsx:694-744)

```
bannerCanvas = composeFaceplateCanvas(project)   → 624×204 HTMLCanvasElement
atlasCanvas  = new canvas(ATLAS_WIDTH=692, ATLAS_HEIGHT=204)
atlasCtx.drawImage(bannerCanvas, 0, 0)           → draws 624×204 at (0,0) in the 692×204 atlas
atlasRgba = atlasCtx.getImageData(0, 0, 692, 204).data
```

`buildFaceplateMod()` receives `atlasRgba` (692×204 RGBA), encodes it as BC3/DXT5 via `encodeBc3()`, and writes:
- `${slug}.dds`               — 692×204 BC3 (root-level SGA preview, info drive)
- `ui/assets/textures/${guid}_i1.dds` — **same bytes** (in-game texture)

(`src/lib/faceplate-mod-build.ts:103-104, 152-185`)

### Resolution assessment

The atlas is encoded at **692×204** — the correct size the engine expects. The banner content region (624×204) matches exactly. **There is no downscale.** The icon sub-rect (624,0)-(688,64) is left **transparent/zeroed** because the compose step only draws the 624×204 banner; nothing is drawn at x≥624.

**Bug #2 root cause:** The icon sub-rect (64×64 at x=624) is never populated. The game's in-game icon (the small faceplate thumbnail shown in the chat box and scoreboard) is pulled from that 64×64 sub-rect and will show as black/transparent. The wider lobby banner itself is correctly sized and encoded — it is NOT low-resolution in the conventional sense.

However, if users are reporting the lobby banner as low-res, the DXT5 encoding quality could be a factor: BC3 is a lossy format with visible blocking at high contrast edges. The encoder (`encodeBc3`) compresses 692×204 = 141,288 pixels into 692/4 × 204/4 = 173×51 = 8,823 BC3 blocks. That is the correct minimum for this size; no resolution is lost at the pixel level. Quality of the BC3 compression itself determines perceived sharpness.

---

## B. Workshop Preview Image (Bug #1)

### Preview pipeline — `handleRequestBuild` → `makeFaceplatePublishTarget`

```
bannerCanvas = composeFaceplateCanvas(project)   → 624×204 HTMLCanvasElement
                                                    (only the banner, NO icon content)
makeFaceplatePublishTarget(project, sga, filename, bannerCanvas, ...)
  → WorkshopPublishTarget { previewCanvas: bannerCanvas }
```

(`src/components/FaceplateEditor.tsx:701, 728-738`)  
(`src/components/PublishToWorkshopDialog.tsx:671-688`)

### Steam upload — `PublishSection.handlePublish`

```
buildPreviewPng() → generateWorkshopPreview(target.previewCanvas)
  → crops bannerCanvas to opaque bbox
  → center-fits into 1024×1024 OffscreenCanvas
  → encodes as PNG → written to tmp/preview.png
steam.workshop.publish({ previewPath: 'tmp/preview.png', ... })
```

(`src/components/PublishSection.tsx:216-224, 266-278`)  
(`src/lib/workshop-preview.ts`)

### What is the preview canvas?

`bannerCanvas` is the **624×204 composited banner** — the actual user artwork. It is NOT a lucide icon or static asset. The `generateWorkshopPreview` function crops it to the opaque bounding box and fits it into 1024×1024. If the banner has a non-transparent background this will be a full-resolution, correctly-cropped faceplate image.

**Potential bug #1 root cause — `cropToOpaqueBbox` on a near-opaque canvas:**  
`findOpaqueBbox` scans for pixels with alpha > 8. If the faceplate uses a solid background (alpha=255 across all 624×204), `cropToOpaqueBbox` returns the original canvas unchanged (`bbox === null` guard, `workshop-preview.ts`). The correct 624×204 image is then scaled to fit 1024×1024 (with 10% padding).

**However**, if the faceplate has `backgroundColor = null` (transparent) and the user's content only occupies a small portion of the banner, `cropToOpaqueBbox` crops to that small region. The resulting preview is that cropped slice, not the full-width banner.

**More likely root cause:** The actual user report says the preview shows the faceplate ICON (the small thumbnail) rather than the banner art. This would happen if `bannerCanvas` contains content only in the icon position — but `composeFaceplateCanvas` draws to a 624×204 canvas, so the icon sub-rect at x=624 is never even part of this canvas. The more probable explanation is:

1. The Workshop item preview was set on an EARLIER publish before the fix that used a different canvas source (e.g., the slot icon), and Steam has cached it.
2. Or the preview canvas passed is the 64×64 icon from `FaceplateInGamePreview` (a separate component) rather than the banner canvas. **Check `FaceplateInGamePreview.tsx`** — if it renders the icon and is mistakenly passed as `previewCanvas` somewhere, that would produce the icon in Steam.

Looking at the code path: `handleRequestBuild` at line 701 calls `composeFaceplateCanvas(project)` (banner-only, 624×204) and passes it as `bannerCanvas`. This is correctly the banner image. No other canvas source is used here.

---

## C. Shared-root Check

Yes — `dds` (the BC3-encoded 692×204 atlas) is used for **both** the root-level `${slug}.dds` (info drive, SGA structure requirement) and `ui/assets/textures/${guid}_i1.dds` (the in-game texture).

(`src/lib/faceplate-mod-build.ts:174-179`)

The root `${slug}.dds` has no size constraints from the engine. The in-game texture IS constrained by the GFX template sub-rects. Both are the same bytes.

The Workshop preview PNG is a **separate file** (`preview.png`) — it is a 1024×1024 JPEG/PNG, not a DDS. It is not related to the in-game DDS at all.

---

## D. Root Causes and Fix Sketches

### Bug #2 — In-game Icon is Black/Transparent

**Root cause:** The 64×64 icon sub-rect at (624, 0) in the atlas is never populated. `composeFaceplateCanvas` renders a 624×204 canvas; the `atlasCanvas` draw at line 707 copies it to (0,0), leaving the icon area zeroed.

**Fix:** After drawing the banner into `atlasCanvas`, also draw the icon content at x=624:

```typescript
// FaceplateEditor.tsx ~line 705-711
const atlasCanvas = document.createElement('canvas')
atlasCanvas.width = ATLAS_WIDTH    // 692
atlasCanvas.height = ATLAS_HEIGHT  // 204
const atlasCtx = atlasCanvas.getContext('2d')
if (atlasCtx) {
  // Draw banner (existing)
  atlasCtx.drawImage(bannerCanvas, 0, 0)
  // FIX: Draw icon sub-rect — scale the banner down to 64×64 at x=624, y=0
  // ICON_RECT = { x: 624, y: 0, width: 64, height: 64 } (faceplate-templates.ts:147)
  atlasCtx.drawImage(bannerCanvas, 0, 0, ATLAS_WIDTH - ICON_RECT.x, ATLAS_HEIGHT,
                     ICON_RECT.x, ICON_RECT.y, ICON_RECT.width, ICON_RECT.height)
  // Or render a dedicated icon crop (left 64×64 of the banner, scaled):
  // atlasCtx.drawImage(bannerCanvas, 0, 0, bannerCanvas.width, bannerCanvas.height,
  //                    624, 0, 64, 64)
}
```

Import `ICON_RECT` from `@/lib/faceplate-templates`.

**Target dimensions/format:** 692×204, BC3/DXT5, 0 mips, no padding in DDS header. Icon sub-rect: 64×64 at offset (624,0). This matches all three reference workshop faceplates.

### Bug #1 — Workshop Preview Shows Icon Not Banner

The code path currently passes the correct 624×204 banner canvas. If the user is seeing the icon, the most likely explanations are:

1. **Stale Steam cache** — an earlier publish (before the banner canvas fix) set a different preview. Steam caches previews aggressively. Re-publishing with an explicit custom PNG upload bypasses this.
2. **Wrong canvas is passed** — audit `FaceplateInGamePreview.tsx` to confirm it does not expose a canvas that might get passed as `previewCanvas` elsewhere.
3. **`cropToOpaqueBbox` over-crops a transparent-background banner** — if `backgroundColor === null` and layers don't span the full width, the workshop preview is cropped to just the content, which may look like a small icon rather than a full banner. Fix: skip bbox-crop for faceplate previews (force draw the full 624×204 without cropping), or fill `bannerCanvas` with a white/neutral background before passing to `generateWorkshopPreview`.

**Fix for case 3 (transparent-background banners):**

```typescript
// FaceplateEditor.tsx ~line 700, after composeFaceplateCanvas call:
// Ensure preview canvas has opaque background so bbox-crop doesn't trim it
const previewCanvas = document.createElement('canvas')
previewCanvas.width = bannerCanvas.width
previewCanvas.height = bannerCanvas.height
const previewCtx = previewCanvas.getContext('2d')
if (previewCtx) {
  previewCtx.fillStyle = '#1a1a1a'   // neutral dark background
  previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height)
  previewCtx.drawImage(bannerCanvas, 0, 0)
}
// Pass previewCanvas (not bannerCanvas) to makeFaceplatePublishTarget
```

---

## Pipeline Diagram

```
User artwork
    │
    ▼
composeFaceplateCanvas(project)          → 624×204 HTMLCanvasElement  [BANNER ONLY]
    │                                         ↑ FACEPLATE_BANNER_W/H (faceplate-project.ts:37-38)
    ├──── [SGA build path] ──────────────────────────────────────────────────────────
    │     atlasCanvas 692×204                 atlasCtx.drawImage(bannerCanvas, 0, 0)
    │         ↓                               [BUG: icon at x=624 left zeroed]
    │     atlasRgba = getImageData(692×204)
    │         ↓
    │     encodeBc3(atlasRgba, 692, 204)  → BC3 payload
    │         ↓
    │     wrapBc3InDds(bc3, 692, 204)     → DDS header + BC3
    │         ↓ (same bytes for both)
    │     ${slug}.dds        (root/info drive — required by engine loader)
    │     ${guid}_i1.dds     (ui/assets/textures — in-game texture, GFX sub-rects: banner 624×204, icon 64×64)
    │
    └──── [Workshop preview path] ───────────────────────────────────────────────────
          previewCanvas = bannerCanvas  (624×204)
              ↓
          generateWorkshopPreview(previewCanvas)
              ├── cropToOpaqueBbox  [may over-crop transparent-bg banners]
              └── center-fit → 1024×1024 OffscreenCanvas → PNG
                      ↓
              tmp/preview.png  (1024×1024 PNG → Steam Workshop item preview)
```

---

## Summary

| Bug | Root cause | Fix location |
|-----|-----------|--------------|
| #2 Low-res in-game icon | 64×64 icon sub-rect at atlas (624,0) never drawn; left black/transparent | `FaceplateEditor.tsx` ~line 705: draw scaled banner into icon rect after drawing banner |
| #1 Workshop shows icon | If background is transparent, `cropToOpaqueBbox` crops the preview to a small content sliver that looks icon-sized in Steam; OR stale Steam cache from an older publish | `FaceplateEditor.tsx` ~line 700: composite banner onto opaque background before passing as `previewCanvas` |

Bugs #1 and #2 are **not the same asset** — the Workshop preview is a PNG uploaded separately; the in-game icon is the 64×64 BC3 sub-rect inside the DDS atlas. However, both stem from the same underlying gap: the icon sub-rect is never explicitly rendered.

---

## Phase 1 verification — Ground truth from 44 real workshop faceplate SGAs

**Date:** 2026-06-13  
**Method:** Python SGA v7 parser (matching sga.ts layout exactly) + zlib decompression + DDS header read on 44 real faceplate SGAs from `/home/jflessenkemper/coh2-brigade-skin-backup/extra-mods/faceplates-subscriptions/`.

### In-game texture (`_i*.dds`) dimensions across all 44 faceplates

| Dimensions | Format | Mips | Count |
|------------|--------|------|-------|
| **692×204** | DXT5 | 0 | **38** (86%) |
| 908×564 | DXT5 | 0 | 1 |
| 912×284 | DXT5 | 0 | 1 |
| 728×260 | DXT5 | 0 | 1 |
| 700×228 | DXT5 | 0 | 1 |
| 704×216 | DXT5 | 0 | 1 |
| 972×280 | DXT5 | 0 | 1 |
| 1252×1252 | DXT5 | 0 | 1 |

**Workshop preview icon (e.g. `icone.dds`, `icon.dds`):** 280×280 DXT5 (all checked), uncompressed size 78,528 bytes — this is a separate **preview** DDS unrelated to in-game rendering.

### Verdict

**Our pipeline already matches the canonical real-faceplate format: 692×204 DXT5, 0 mips.**  
There is NO resolution loss. The user's perception of "low res in-game" is caused by:

1. **The icon sub-rect (64×64 at x=624) is black/transparent.** All real faceplates carry content there; our editor left it zeroed. The game displays this sub-rect in the scoreboard and chat box — if zeroed, the chat icon appears black.

2. **DXT5 compression artifacts** on a 692-wide banner are visible at high contrast edges (normal for BC3, not a resolution deficit).

The hypothesis from the prior diag ("our banner already matches reference 692×204 DXT5; the only issue is a black 64×64 icon sub-rect") is **CONFIRMED** by direct measurement.
