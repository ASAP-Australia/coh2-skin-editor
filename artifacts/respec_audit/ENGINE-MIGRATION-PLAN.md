# Engine migration plan — Konva under the compositor editors (2026-06-13)

Decision (user picked Option A): swap the hand-rolled canvas engine under the editors for an
OSS engine, keep ALL CoH2 pipelines (atlas slots, live 3D sync, SGA export, shared history).

## Engine choice — VERIFIED
- **Konva.js + react-konva** for the compositor editors (decal + faceplate). MIT; active
  (v10.3.0, Apr 2026); declarative React; `Konva.Transformer` replaces custom CanvasHandles;
  blend modes via globalCompositeOperation native; ~45 KB; ESM-only (we're on Vite — fine).
  Docs explicitly recommend external-state-driven undo → COEXISTS with editor-history.ts.
  Risk: solo maintainer (pin versions, watch repo).
- Fabric.js v7 rejected: no React binding, ~550 KB, its loadFromJSON undo fights our
  synchronous history engine.
- **Skin texture editor: NO engine.** baseDiffuseRef/overlayCanvasRef → three.js CanvasTexture
  live-sync is a hard constraint Konva can't own cleanly. Keep the custom raster brush
  (brush.ts). Engine swap does NOT touch the skin painter.

## Current state (both compositor editors are CSS/DOM, not canvas)
- Decal: each Decal = absolutely-positioned <div>; Decal records (x,y,scale,rotation,opacity,
  blendMode) map 1:1 to Konva Image nodes. Draw-tool raster stroke stays custom. rasteriseDecal
  reads plain Decal records → export UNTOUCHED.
- Faceplate: text/image/shape layers = positioned HTML; paint+mask layers are raster blobs;
  curves use getImageData passes. composeFaceplateCanvas reads project state → export UNTOUCHED.

## Migration seams (shared)
- editor-shared/CanvasHandles.tsx → Konva.Transformer (both editors).
- use-pan-zoom.ts → Konva Stage scale/position (both editors); keep shortcuts/data.
- editor-history.ts → PRESERVED as-is (snapshots plain-JS state; Konva's own history stays off).
- TransformInputsRow.tsx → keep; drives the same state Konva renders from.
- Editor.tsx overlayCanvasRef/baseDiffuseRef/overlayVersion → HARD DO-NOT-DISTURB (skin path).

## Phased plan (each phase = own effort, verify before next)
- **Phase 0 (S):** add konva + react-konva; spike a throwaway Konva stage rendering one decal
  with Transformer + pan/zoom, confirm it feeds the same state shape and exports identically.
  Pin versions. Confirm Vite/electron build + bundle delta acceptable.
- **Phase 1 (L):** migrate DecalPackEditor view layer to a Konva Stage/Layer; Decal divs → Image
  nodes; CanvasHandles → Transformer; pan/zoom → Stage. Keep draw-tool raster + reference
  previews + export path byte-identical. Full vitest + live CDP parity check vs current build.
- **Phase 2 (L):** migrate FaceplateEditor text/image/shape layers to Konva nodes; paint/mask
  raster layers drawn on a Konva.Image-wrapped offscreen canvas; curves stay getImageData.
  composeFaceplateCanvas output must stay pixel-identical (banner+icon atlas). Verify in-game.
- **Phase 3 (S):** delete dead custom handles/engine code now unused; reconcile shortcut data.

## Effort / risk
- ~2 L-effort editor rewrites + 2 S. Risk: export-output drift (guard: golden-image tests on
  composeFaceplateCanvas / rasteriseDecal before+after must match), and re-introducing the undo
  bugs we just fixed (guard: editor-history.ts untouched; reuse its tests).
- NOT a fit to start mid-campaign: the current spec (rounds 1-3 + faceplate) is ~closed and
  deployed. Recommend finishing close-out (in-game faceplate verify + PASS report + wiki),
  then run the Konva migration as its own campaign/session with sign-off.
